import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db";
import { loadLearningCourse } from "./learningContext";
import { CONVERSATION_SQL as SQL, type ConversationMessageRow, type ConversationRow } from "./conversationSql";
import {
  ARCHIVE_MESSAGE_BYTES, ARCHIVE_PAGE_BYTES, archiveContent, archiveLabel, archivedProof, conversationSummary,
  messageUpdate, turnRequest, type ArchiveContent, type ArchivedMessage, type ArchivedProof, type ConversationSummary,
} from "./conversationContracts";

export class ConversationError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function summary(row: ConversationRow): ConversationSummary {
  return conversationSummary.parse({ id: row.id, targetId: row.target_id, targetName: row.target_name, title: row.title,
    pinned: row.pinned, archived: row.archived, deletedAt: row.deleted_at, createdAt: row.created_at,
    updatedAt: row.updated_at, revision: row.revision, lastSeq: row.last_seq, parentId: row.parent_id, parentMessageId: row.parent_message_id });
}
export function messageFromRow(row: ConversationMessageRow): ArchivedMessage {
  try {
    return { id: row.id, conversationId: row.conversation_id, seq: row.seq, role: row.role,
      createdAt: row.created_at, revision: row.revision, state: row.state, inheritedFrom: row.inherited_from,
      content: archiveContent.parse(JSON.parse(row.data)), proof: row.proof ? archivedProof.parse(JSON.parse(row.proof)) : null };
  } catch { throw new ConversationError(500, "消息存档读取失败，请重试；现有记录未被修改。"); }
}
function contentJson(value: unknown) {
  const content = archiveContent.parse(value);
  const json = JSON.stringify(content);
  if (Buffer.byteLength(json, "utf8") > ARCHIVE_MESSAGE_BYTES) throw new ConversationError(413, "这一轮内容过大，未保存或截断；请减少附图后重试。");
  return { content, json };
}
function writable(conversation: ConversationSummary) {
  if (conversation.deletedAt) throw new ConversationError(409, "请先从回收站恢复会话。");
  if (conversation.archived) throw new ConversationError(409, "请先取消归档，再继续会话。");
}
export async function getConversation(db: Db, userId: string, id: string) {
  const row = await db.one<ConversationRow>(SQL.byId, [userId, id]);
  if (!row) throw new ConversationError(404, "会话不存在或无权访问。");
  return summary(row);
}
export async function getArchivedMessage(db: Db, userId: string, id: string, messageId: string) {
  const row = await db.one<ConversationMessageRow>(SQL.message, [userId, id, messageId]);
  if (!row) throw new ConversationError(404, "消息不存在或无权访问。");
  return messageFromRow(row);
}
const listCursor = z.strictObject({ pinned: z.boolean(), updatedAt: z.string().max(64), id: z.string().uuid() });
export async function listConversations(db: Db, userId: string, options: { mode?: "active" | "archived" | "trash"; query?: string; cursor?: string } = {}) {
  let cursor: z.infer<typeof listCursor> | null = null;
  if (options.cursor) {
    try { cursor = listCursor.parse(JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"))); }
    catch { throw new ConversationError(400, "会话分页位置无效，请重新加载。"); }
  }
  const rows = await db.all<ConversationRow>(SQL.list, [userId, options.mode ?? "active", options.query?.trim() ?? "", cursor?.pinned ?? null, cursor?.updatedAt ?? "", cursor?.id ?? "", 51]);
  const items = rows.slice(0, 50).map(summary);
  const last = items.at(-1);
  return { conversations: items, nextCursor: rows.length > 50 && last ? Buffer.from(JSON.stringify({ pinned: last.pinned, updatedAt: last.updatedAt, id: last.id })).toString("base64url") : null };
}
export async function createConversation(db: Db, userId: string, targetId: string, title = "新会话") {
  const course = await loadLearningCourse(db, userId, targetId);
  const id = randomUUID(), now = new Date().toISOString();
  await db.run(SQL.create, [userId, id, targetId, archiveLabel.parse(course.name), title, now]);
  return getConversation(db, userId, id);
}
export async function updateConversation(db: Db, userId: string, body: { id: string; revision: number; title?: string; pinned?: boolean; archived?: boolean; trash?: boolean }) {
  const current = await getConversation(db, userId, body.id);
  const changed = await db.run(SQL.update, [userId, body.id, body.revision, body.title ?? current.title,
    body.pinned ?? current.pinned, body.trash === false ? false : body.archived ?? current.archived,
    body.trash === undefined ? current.deletedAt : body.trash ? new Date().toISOString() : null, new Date().toISOString()]);
  if (changed !== 1) throw new ConversationError(409, "会话已在其他窗口更新，请重新载入后操作。");
  return getConversation(db, userId, body.id);
}
export async function readConversationPage(db: Db, userId: string, id: string, before = Number.MAX_SAFE_INTEGER) {
  const conversation = await getConversation(db, userId, id);
  const rows = await db.all<ConversationMessageRow>(SQL.messages, [userId, id, before, 21, ARCHIVE_PAGE_BYTES - 16 * 1024]);
  const descending: ArchivedMessage[] = [];
  let bytes = Buffer.byteLength(JSON.stringify(conversation), "utf8") + 1024;
  for (const row of rows.slice(0,20)) {
    const message = messageFromRow(row);
    const size = Buffer.byteLength(JSON.stringify(message), "utf8");
    if (descending.length && bytes + size > ARCHIVE_PAGE_BYTES) break;
    if (bytes + size > ARCHIVE_PAGE_BYTES) throw new ConversationError(413, "这条消息超出当前读取容量，原始存档仍保留。");
    bytes += size;
    descending.push(message);
  }
  const oldest = descending.at(-1)?.seq;
  return { conversation, messages: descending.reverse(), before: oldest && oldest > 1 ? oldest : null };
}
export async function appendConversationTurn(db: Db, userId: string, raw: unknown) {
  const body = turnRequest.parse(raw);
  if (body.user.id === body.assistantId) throw new ConversationError(400, "本轮消息标识重复。");
  const conversation = await getConversation(db, userId, body.conversationId);
  writable(conversation);
  const { content: userContent } = contentJson({ text: body.user.content.text, attachments: body.user.content.attachments, images: body.user.content.attachments.length });
  if (!userContent.text.trim() && !userContent.attachments.length) throw new ConversationError(400, "请先输入问题或附图。");
  const pair = await db.all<ConversationMessageRow>(SQL.pair, [userId, body.conversationId, body.user.id, body.assistantId]);
  const existing = pair.find(row => row.id === body.user.id);
  if (existing) {
    const assistantRow = pair.find(row => row.id === body.assistantId);
    if (!assistantRow) throw new ConversationError(409, "本轮消息记录不完整，请重新载入。");
    const assistant = messageFromRow(assistantRow);
    if (existing.role !== "user" || assistant.role !== "assistant" || assistant.seq !== existing.seq + 1 || JSON.stringify(messageFromRow(existing).content) !== JSON.stringify(userContent)) throw new ConversationError(409, "消息标识已被另一轮使用。");
    return { conversation, user: messageFromRow(existing), assistant };
  }
  if (pair.length) throw new ConversationError(409, "消息标识已被另一轮使用。");
  const data = [{ id: body.user.id, role: "user", content: userContent, state: "complete" }, { id: body.assistantId, role: "assistant", content: archiveContent.parse({ streaming: true }), state: "pending" }];
  const title = Array.from(userContent.text.trim().replace(/\s+/gu," ") || "图片提问").slice(0, 40).join("");
  const now = new Date().toISOString();
  const changed = await db.run(SQL.append, [userId, body.conversationId, body.revision, now, JSON.stringify(data), title]);
  if (changed !== 2) throw new ConversationError(409, "会话已在另一设备更新。请重新载入后继续，或从当前轮次新建分支。");
  const baseMessage = { conversationId: body.conversationId, createdAt: now, revision: 0, inheritedFrom: null, proof: null };
  return { conversation: { ...conversation, revision: conversation.revision + 1, lastSeq: conversation.lastSeq + 2, updatedAt: now, title: conversation.lastSeq === 0 && conversation.title === "新会话" ? title : conversation.title },
    user: { ...baseMessage, id: body.user.id, seq: conversation.lastSeq + 1, role: "user" as const, state: "complete" as const, content: userContent },
    assistant: { ...baseMessage, id: body.assistantId, seq: conversation.lastSeq + 2, role: "assistant" as const, state: "pending" as const, content: archiveContent.parse({ streaming: true }) } };
}
export async function updateArchivedMessage(db: Db, userId: string, raw: unknown) {
  const body = messageUpdate.parse(raw);
  const current = await getArchivedMessage(db, userId, body.conversationId, body.id);
  if (current.state !== "pending" && body.state === "pending") throw new ConversationError(409, "已结束的回答不能重新变为生成中。");
  if (body.content.attachments.length) throw new ConversationError(400, "回答不能附加提问图片。");
  const { json } = contentJson({ ...body.content, streaming: body.state === "pending" && body.content.streaming });
  const changed = await db.run(SQL.updateMessage, [userId, body.conversationId, body.id, body.revision, json, body.state, new Date().toISOString()]);
  if (changed !== 1) throw new ConversationError(409, "消息已更新、正在生成或是继承记录；现有内容未被覆盖。");
  return getArchivedMessage(db, userId, body.conversationId, body.id);
}
export async function branchConversation(db: Db, userId: string, id: string, messageId: string, title?: string) {
  const original = await getConversation(db, userId, id);
  const message = await getArchivedMessage(db, userId, id, messageId);
  const forkId = randomUUID();
  const changed = await db.run(SQL.branch, [userId, id, messageId, forkId, title ?? `${Array.from(original.title).slice(0,80).join("")} · 分支`, new Date().toISOString()]);
  if (changed !== message.seq) throw new ConversationError(409, "只能从已结束的一轮回答新建分支，请先等待或停止生成。");
  return getConversation(db, userId, forkId);
}

/** Called by the agent route only; never exposed as a client mutation. */
export async function claimConversationAgent(db: Db, userId: string, id: string, messageId: string, targetId: string) {
  const conversation = await getConversation(db, userId, id);
  writable(conversation);
  if (conversation.targetId !== targetId) throw new ConversationError(400, "会话课程与本次教学目标不一致。");
  const assistant = await getArchivedMessage(db, userId, id, messageId);
  const prefix = await db.all<ConversationMessageRow>(SQL.messages, [userId, id, assistant.seq, 9, ARCHIVE_PAGE_BYTES - 16 * 1024]);
  const question = prefix.find(row => row.seq === assistant.seq - 1 && row.role === "user");
  if (!question) throw new ConversationError(409, "本轮提问记录不完整，请重新载入。");
  const token = randomUUID();
  const changed = await db.run(SQL.claimAgent, [userId, id, messageId, token]);
  if (changed !== 1) throw new ConversationError(409, "这条教学回答已开始或已完成，请重新载入查看。");
  return { token, question: messageFromRow(question), history: prefix.filter(row => row.seq < question.seq).reverse().map(messageFromRow) };
}
export async function saveConversationAgent(db: Db, userId: string, id: string, messageId: string, token: string, content: ArchiveContent, proof: ArchivedProof | null, state: ArchivedMessage["state"]) {
  const { json } = contentJson(content);
  const verified = proof ? JSON.stringify(archivedProof.parse(proof)) : null;
  return await db.run(SQL.saveAgent, [userId, id, messageId, token, json, verified, state, new Date().toISOString()]) === 1;
}
export async function saveConversationAssessment(db: Db, userId: string, id: string, messageId: string, proof: ArchivedProof) {
  const verified = archivedProof.parse(proof);
  return await db.run(SQL.saveAssessment, [userId, id, messageId, proof.workflow.runId, JSON.stringify(verified)]) === 1;
}
