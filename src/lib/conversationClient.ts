"use client";

import {
  archivedMessage,
  conversationSummary,
  type ArchiveContent,
  type ArchivedMessage,
  type ConversationSummary,
} from "./conversationContracts";
import { localConversationRepository } from "./conversationLocal";

export type ConversationMode = "active" | "archived" | "trash";
export type ConversationPatch = Partial<
  Pick<ConversationSummary, "title" | "pinned" | "archived">
> & { trash?: boolean };
export interface ConversationPage {
  conversation: ConversationSummary;
  messages: ArchivedMessage[];
  before: number | null;
}
export interface ConversationRepository {
  list(
    mode: ConversationMode,
    query: string,
    cursor?: string,
  ): Promise<{
    conversations: ConversationSummary[];
    nextCursor: string | null;
    storage?: string;
  }>;
  create(targetId: string, targetName: string): Promise<ConversationSummary>;
  page(id: string, before?: number): Promise<ConversationPage>;
  append(
    conversation: ConversationSummary,
    userId: string,
    assistantId: string,
    content: ArchiveContent,
  ): Promise<{
    conversation: ConversationSummary;
    user: ArchivedMessage;
    assistant: ArchivedMessage;
  }>;
  save(
    record: ArchivedMessage,
    content: ArchiveContent,
    state: ArchivedMessage["state"],
  ): Promise<ArchivedMessage>;
  message(id: string, messageId: string): Promise<ArchivedMessage>;
  interrupt(id: string, messageId: string): Promise<ArchivedMessage>;
  update(
    conversation: ConversationSummary,
    patch: ConversationPatch,
  ): Promise<ConversationSummary>;
  branch(id: string, messageId: string): Promise<ConversationSummary>;
}
export class ArchiveClientError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.json();
  if (!response.ok)
    throw new ArchiveClientError(
      typeof raw.error === "string" ? raw.error : "会话操作失败，请重试。",
      response.status,
    );
  return raw;
}
export const remoteConversationRepository: ConversationRepository = {
  async list(mode, query, cursor) {
    const raw = await api(
      `/api/conversations?${new URLSearchParams({ mode, q: query, ...(cursor ? { cursor } : {}) })}`,
    );
    return {
      conversations: conversationSummary.array().parse(raw.conversations),
      nextCursor: raw.nextCursor,
      storage: raw.storage,
    };
  },
  async create(targetId) {
    return conversationSummary.parse(
      (await api("/api/conversations", "POST", { action: "create", targetId }))
        .conversation,
    );
  },
  async page(id, before) {
    const raw = await api(
      `/api/conversations/messages?${new URLSearchParams({ conversationId: id, ...(before ? { before: String(before) } : {}) })}`,
    );
    return {
      conversation: conversationSummary.parse(raw.conversation),
      messages: archivedMessage.array().parse(raw.messages),
      before: raw.before,
    };
  },
  async append(conversation, userId, assistantId, content) {
    const raw = await api("/api/conversations/messages", "POST", {
      conversationId: conversation.id,
      revision: conversation.revision,
      user: { id: userId, content },
      assistantId,
    });
    return {
      conversation: conversationSummary.parse(raw.conversation),
      user: archivedMessage.parse(raw.user),
      assistant: archivedMessage.parse(raw.assistant),
    };
  },
  async save(record, content, state) {
    const write = async (revision: number) =>
      archivedMessage.parse(
        (
          await api("/api/conversations/messages", "PUT", {
            conversationId: record.conversationId,
            id: record.id,
            revision,
            content,
            state,
          })
        ).message,
      );
    try {
      return await write(record.revision);
    } catch (failure) {
      if (!(failure instanceof ArchiveClientError) || failure.status !== 409)
        throw failure;
      const latest = archivedMessage.parse(
        (
          await api(
            `/api/conversations/messages?${new URLSearchParams({ conversationId: record.conversationId, messageId: record.id })}`,
          )
        ).message,
      );
      if (JSON.stringify(latest.content) === JSON.stringify(content))
        return latest;
      if (JSON.stringify(latest.content) !== JSON.stringify(record.content))
        throw failure;
      // A grading result may advance the message revision without changing the answer text.
      return write(latest.revision);
    }
  },
  async message(id, messageId) {
    return archivedMessage.parse(
      (
        await api(
          `/api/conversations/messages?${new URLSearchParams({ conversationId: id, messageId })}`,
        )
      ).message,
    );
  },
  async interrupt(id, messageId) {
    return archivedMessage.parse(
      (
        await api("/api/conversations/messages", "PATCH", {
          conversationId: id,
          id: messageId,
        })
      ).message,
    );
  },
  async update(conversation, patch) {
    return conversationSummary.parse(
      (
        await api("/api/conversations", "POST", {
          action: "update",
          id: conversation.id,
          revision: conversation.revision,
          ...patch,
        })
      ).conversation,
    );
  },
  async branch(id, messageId) {
    return conversationSummary.parse(
      (
        await api("/api/conversations", "POST", {
          action: "branch",
          id,
          messageId,
        })
      ).conversation,
    );
  },
};
export const conversationRepository = (
  signedIn: boolean,
): ConversationRepository =>
  signedIn ? remoteConversationRepository : localConversationRepository;
