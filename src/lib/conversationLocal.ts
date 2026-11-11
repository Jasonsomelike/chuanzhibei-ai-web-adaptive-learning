/** Anonymous conversations stay in IndexedDB. Images never enter localStorage. */
import {
  archiveContent,
  type ArchivedMessage,
  type ConversationSummary,
} from "./conversationContracts";
import type { ConversationRepository } from "./conversationClient";

let opening: Promise<IDBDatabase> | null = null;
function database() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("alp-tutor-conversations", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("conversations", { keyPath: "id" });
      const messages = request.result.createObjectStore("messages", {
        keyPath: ["conversationId", "id"],
      });
      messages.createIndex("sequence", ["conversationId", "seq"], {
        unique: true,
      });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      opening = null;
      reject(new Error("本机会话存储不可用，请检查浏览器存储权限。"));
    };
  });
  return opening;
}
function read<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  work: (meta: IDBObjectStore, messages: IDBObjectStore) => Promise<T>,
) {
  const db = await database();
  const tx = db.transaction(["conversations", "messages"], mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("本机会话未能保存，内容仍保留在页面。"));
  });
  try {
    const result = await work(
      tx.objectStore("conversations"),
      tx.objectStore("messages"),
    );
    await done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already ended */
    }
    await done.catch(() => undefined);
    throw error;
  }
}
async function requireMeta(store: IDBObjectStore, id: string) {
  const meta = await read<ConversationSummary | undefined>(store.get(id));
  if (!meta) throw new Error("本机会话不存在。");
  return meta;
}
function writable(meta: ConversationSummary) {
  if (meta.archived || meta.deletedAt) throw new Error("请先恢复会话后继续。");
}
const keyRange = (id: string, before = Number.MAX_SAFE_INTEGER) =>
  IDBKeyRange.bound([id, 0], [id, before], false, true);
async function message(store: IDBObjectStore, id: string, messageId: string) {
  const record = await read<ArchivedMessage | undefined>(
    store.get([id, messageId]),
  );
  if (!record) throw new Error("本机消息不存在。");
  return record;
}
export const localConversationRepository: ConversationRepository = {
  async list(mode, query) {
    return transact("readonly", async (meta) => ({
      conversations: (await read<ConversationSummary[]>(meta.getAll()))
        .filter((item) =>
          mode === "trash"
            ? !!item.deletedAt
            : !item.deletedAt && item.archived === (mode === "archived"),
        )
        .filter((item) =>
          item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        )
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            b.updatedAt.localeCompare(a.updatedAt),
        ),
      nextCursor: null,
      storage: "local",
    }));
  },
  async create(targetId, targetName) {
    const now = new Date().toISOString();
    const meta: ConversationSummary = {
      id: crypto.randomUUID(),
      targetId,
      targetName,
      title: "新会话",
      pinned: false,
      archived: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 0,
      lastSeq: 0,
      parentId: null,
      parentMessageId: null,
    };
    return transact("readwrite", async (store) => {
      await read(store.add(meta));
      return meta;
    });
  },
  async page(id, before) {
    return transact("readonly", async (meta, messages) => {
      const conversation = await requireMeta(meta, id);
      const items: ArchivedMessage[] = [];
      await new Promise<void>((resolve, reject) => {
        const cursor = messages
          .index("sequence")
          .openCursor(keyRange(id, before), "prev");
        cursor.onerror = () => reject(cursor.error);
        cursor.onsuccess = () => {
          if (!cursor.result || items.length >= 20) {
            resolve();
            return;
          }
          items.push(cursor.result.value as ArchivedMessage);
          cursor.result.continue();
        };
      });
      return {
        conversation,
        messages: items.reverse(),
        before: items[0]?.seq > 1 ? items[0].seq : null,
      };
    });
  },
  async append(conversation, userId, assistantId, content) {
    return transact("readwrite", async (meta, messages) => {
      const current = await requireMeta(meta, conversation.id);
      writable(current);
      if (current.revision !== conversation.revision)
        throw new Error("会话已在其他窗口更新，请重新载入。");
      const now = new Date().toISOString();
      const base = {
        conversationId: conversation.id,
        createdAt: now,
        revision: 0,
        inheritedFrom: null,
        proof: null,
      };
      const user: ArchivedMessage = {
        ...base,
        id: userId,
        seq: current.lastSeq + 1,
        role: "user",
        state: "complete",
        content,
      };
      const assistant: ArchivedMessage = {
        ...base,
        id: assistantId,
        seq: current.lastSeq + 2,
        role: "assistant",
        state: "pending",
        content: archiveContent.parse({ streaming: true }),
      };
      const updated = {
        ...current,
        revision: current.revision + 1,
        lastSeq: current.lastSeq + 2,
        updatedAt: now,
        title:
          current.lastSeq === 0 && current.title === "新会话"
            ? Array.from(content.text.trim() || "图片提问")
                .slice(0, 40)
                .join("")
            : current.title,
      };
      await read(messages.add(user));
      await read(messages.add(assistant));
      await read(meta.put(updated));
      return { conversation: updated, user, assistant };
    });
  },
  async save(record, content, state) {
    return transact("readwrite", async (meta, messages) => {
      writable(await requireMeta(meta, record.conversationId));
      const current = await message(messages, record.conversationId, record.id);
      if (
        current.revision !== record.revision ||
        current.inheritedFrom ||
        current.role !== "assistant"
      )
        throw new Error("消息已更新，请重新载入后继续。");
      const updated = {
        ...current,
        content,
        state,
        revision: current.revision + 1,
      };
      await read(messages.put(updated));
      return updated;
    });
  },
  async message(id, messageId) {
    return transact("readonly", async (_meta, messages) =>
      message(messages, id, messageId),
    );
  },
  async interrupt(id, messageId) {
    return transact("readwrite", async (meta, messages) => {
      writable(await requireMeta(meta, id));
      const current = await message(messages, id, messageId);
      if (current.inheritedFrom || current.role !== "assistant")
        throw new Error("继承记录不能中止。");
      if (current.state !== "pending") return current;
      const updated: ArchivedMessage = {
        ...current,
        state: "interrupted",
        revision: current.revision + 1,
        content: { ...current.content, streaming: false, checking: false },
      };
      await read(messages.put(updated));
      return updated;
    });
  },
  async update(conversation, patch) {
    return transact("readwrite", async (meta) => {
      const current = await requireMeta(meta, conversation.id);
      if (current.revision !== conversation.revision)
        throw new Error("会话已在其他窗口更新，请重新载入。");
      const { trash, ...fields } = patch;
      const updated = {
        ...current,
        ...fields,
        deletedAt:
          trash === undefined
            ? current.deletedAt
            : trash
              ? new Date().toISOString()
              : null,
        archived:
          trash === false ? false : (patch.archived ?? current.archived),
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await read(meta.put(updated));
      return updated;
    });
  },
  async branch(id, messageId) {
    return transact("readwrite", async (meta, messages) => {
      const original = await requireMeta(meta, id),
        point = await message(messages, id, messageId);
      if (
        original.deletedAt ||
        point.role !== "assistant" ||
        point.state === "pending"
      )
        throw new Error("请从已结束的回答新建分支。");
      const now = new Date().toISOString();
      const fork: ConversationSummary = {
        ...original,
        id: crypto.randomUUID(),
        title: `${original.title} · 分支`,
        pinned: false,
        archived: false,
        revision: 0,
        lastSeq: point.seq,
        parentId: id,
        parentMessageId: messageId,
        createdAt: now,
        updatedAt: now,
      };
      const prefix = await read<ArchivedMessage[]>(
        messages.index("sequence").getAll(keyRange(id, point.seq + 1)),
      );
      await read(meta.add(fork));
      for (const item of prefix)
        await read(
          messages.add({
            ...item,
            conversationId: fork.id,
            inheritedFrom: id,
            revision: 0,
          }),
        );
      return fork;
    });
  },
};
