"use client";

/**
 * 知识库的浏览器侧存储适配器（IndexedDB）。
 *
 * 从 kbStore.ts 抽出来单独成文件：kbStore 负责存储契约、容量预算与 React 订阅，
 * kbRemote 负责账号同步；两者都依赖这里的本地读写，但不应该互相 import。
 * 本文件只依赖 kbStore 的类型（type-only），运行时不形成环。
 *
 * IndexedDB 事务在事件循环让出后会失效，因此 putRows / removeRows 事务内不 await：
 * 所有写入同步排进同一个事务，失败由事务整体回滚。
 */

import type { UploadChunk, UploadDoc } from "@/lib/knowledge";
import type { KbStorage, KbStorageEstimate } from "@/lib/kbStore";

export const KB_DB_NAME = "alp-kb-v1";
export const KB_DOC_STORE = "docs";
export const KB_CHUNK_STORE = "chunks";

let dbPromise: Promise<IDBDatabase> | null = null;

/** 打开数据库。失败不缓存 rejected promise，下一次操作还能重试。 */
export function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前环境不支持 IndexedDB"));
  }
  if (dbPromise !== null) return dbPromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(KB_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KB_DOC_STORE)) {
        const docs = db.createObjectStore(KB_DOC_STORE, { keyPath: "id" });
        docs.createIndex("directionId", "directionId", { unique: false });
      }
      if (!db.objectStoreNames.contains(KB_CHUNK_STORE)) {
        const chunks = db.createObjectStore(KB_CHUNK_STORE, { keyPath: "id" });
        chunks.createIndex("directionId", "directionId", { unique: false });
        chunks.createIndex("docId", "docId", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // 另一个标签页升级 / 删除数据库时主动让路，否则会一直 blocked
      db.onversionchange = () => {
        db.close();
        if (dbPromise === opening) dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("无法打开 IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB 被其它标签页占用，请关闭其它页面后重试"));
  });

  dbPromise = opening;
  opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  return opening;
}

function readAll<T>(storeName: string, indexName: string, key: string): Promise<T[]> {
  return openDatabase().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).index(indexName).getAll(key);
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error ?? new Error("读取 IndexedDB 失败"));
        transaction.onabort = () => reject(transaction.error ?? new Error("读取 IndexedDB 被中止"));
      }),
  );
}

function getDocRow(docId: string): Promise<UploadDoc | null> {
  return openDatabase().then(
    (db) =>
      new Promise<UploadDoc | null>((resolve, reject) => {
        const transaction = db.transaction(KB_DOC_STORE, "readonly");
        const request = transaction.objectStore(KB_DOC_STORE).get(docId);
        request.onsuccess = () => resolve((request.result as UploadDoc | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error("读取 IndexedDB 失败"));
        transaction.onabort = () => reject(transaction.error ?? new Error("读取 IndexedDB 被中止"));
      }),
  );
}

/** 一份文档与它的全部片段必须在同一个 readwrite 事务里写入。 */
async function putRows(doc: UploadDoc, chunks: readonly UploadChunk[]): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([KB_DOC_STORE, KB_CHUNK_STORE], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("写入 IndexedDB 失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("写入 IndexedDB 被回滚"));

    try {
      transaction.objectStore(KB_DOC_STORE).put(doc);
      const chunkStore = transaction.objectStore(KB_CHUNK_STORE);
      // 事务内不 await：所有 put 同步排进同一个事务，失败由事务整体回滚
      for (const chunk of chunks) chunkStore.put(chunk);
    } catch (err) {
      transaction.abort();
      reject(err);
    }
  });
}

async function removeRows(docId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([KB_DOC_STORE, KB_CHUNK_STORE], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("删除 IndexedDB 失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("删除 IndexedDB 被回滚"));

    const chunkStore = transaction.objectStore(KB_CHUNK_STORE);
    const keys = chunkStore.index("docId").getAllKeys(docId);
    keys.onsuccess = () => {
      for (const key of keys.result) chunkStore.delete(key);
      transaction.objectStore(KB_DOC_STORE).delete(docId);
    };
    keys.onerror = () => {
      transaction.abort();
      reject(keys.error ?? new Error("读取待删除片段失败"));
    };
  });
}

export function createIndexedDbStorage(): KbStorage {
  return {
    listDocs: (directionId) => readAll<UploadDoc>(KB_DOC_STORE, "directionId", directionId),
    listChunks: (directionId) => readAll<UploadChunk>(KB_CHUNK_STORE, "directionId", directionId),
    getDoc: getDocRow,
    putDocWithChunks: putRows,
    removeDoc: removeRows,
    async estimate(): Promise<KbStorageEstimate> {
      if (typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function") {
        return {};
      }
      try {
        const { usage, quota } = await navigator.storage.estimate();
        return { usage, quota };
      } catch {
        return {};
      }
    },
  };
}

/** 当前浏览器可用的存储；Node / SSR 返回 null，调用方据此显示「不支持」。 */
export function getDefaultKbStorage(): KbStorage | null {
  if (typeof indexedDB === "undefined") return null;
  return createIndexedDbStorage();
}

/** 关掉当前连接。删除数据库前必须先关，否则本标签页自己就会 blocked。 */
export function closeKbDb(): void {
  const pending = dbPromise;
  dbPromise = null;
  if (pending === null) return;
  pending.then((db) => db.close()).catch(() => undefined);
}

/**
 * 清空整个知识库数据库（换账号、调试重置）。
 *
 * 必须先关连接再 deleteDatabase：本标签页持着连接时 delete 永远等不到 success。
 * 其它标签页仍持连接时浏览器会派发 onblocked；这里等 2s 后照样 resolve，
 * 不让调用方的 Promise 永久悬挂——删除会在对方关闭页面后由浏览器继续完成。
 */
export async function clearKbDatabase(): Promise<void> {
  closeKbDb();
  if (typeof indexedDB === "undefined") return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(done, 2000);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(KB_DB_NAME);
    } catch {
      clearTimeout(timer);
      done();
      return;
    }
    request.onsuccess = () => {
      clearTimeout(timer);
      done();
    };
    request.onerror = () => {
      clearTimeout(timer);
      done();
    };
    // onblocked 不提前结束：给其它标签页 2s 让路，超时由上面的 timer resolve
  });
}
