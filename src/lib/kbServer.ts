/**
 * 服务端知识库：行映射、上传校验、文档级 LWW 写入与向量分页。
 *
 * 与浏览器侧的 kbStore.ts 共用同一套行校验规则；这里不碰 IndexedDB，
 * 只通过 db.ts 的 Db 接口读写 kb_docs / kb_chunks。
 *
 * 并发策略是「文档级 LWW + 前置 CAS」：客户端提交 baseUpdatedAt，
 * 与库中版本不一致就整单拒绝，先于任何写入返回，避免半份文档落库。
 * 片段不做独立版本号：它们属于文档，随文档一起被替换。
 */

import type { Db } from "@/lib/db";
import type { KbChunkInput, KbDocInput, KbPut } from "@/lib/apiContracts";
import { MAX_EMBEDDING_DIM } from "@/lib/apiContracts";
import type { UploadChunk, UploadDoc, UploadKind } from "@/lib/knowledge";

/** 单次 PUT 的默认请求体上限（32MB）。可用 ALP_MAX_KB_BYTES 覆盖。 */
export const DEFAULT_MAX_KB_PUT_BYTES = 32 * 1024 * 1024;

function envPositiveInt(name: string, fallback: number): number {
  try {
    const raw = process.env?.[name];
    if (typeof raw !== "string" || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.max(1, Math.floor(value));
  } catch {
    return fallback;
  }
}

/**
 * 文档 PUT 的请求体上限。
 *
 * 32MB 是应用自己的安全上限，不是平台限制：Vercel/反代的请求体上限另算，
 * 超出平台限制的部署仍需把单次同步拆小。向量不再随文档 PUT 提交；
 * 这份余量留给正文与元数据。
 */
export const MAX_KB_PUT_BYTES = envPositiveInt("ALP_MAX_KB_BYTES", DEFAULT_MAX_KB_PUT_BYTES);

/** 向量分页上限；默认 100。 */
export const KB_VECTOR_PAGE_DEFAULT = 100;
export const KB_VECTOR_PAGE_MAX = 100;

// ── 数据库行 ──────────────────────────────────────────────────────

/** 列名与 db.ts 的 SCHEMA 一致；数值列在 Postgres 驱动里可能是字符串。 */
export interface KbDocRow {
  readonly user_id?: string;
  readonly doc_id: string;
  readonly direction_id: string;
  readonly title: string;
  readonly file_name: string;
  readonly kind: string;
  readonly size: number | string;
  readonly page_count: number | string | null;
  readonly char_count: number | string;
  readonly chunk_count: number | string;
  readonly kc_ids_json: string | null;
  readonly created_at: string;
  readonly updated_at: string | number;
}

export interface KbChunkRow {
  readonly user_id?: string;
  readonly chunk_id: string;
  readonly doc_id: string;
  readonly direction_id: string;
  readonly idx: number | string;
  readonly title: string;
  readonly section: string;
  readonly page_from: number | string | null;
  readonly page_to: number | string | null;
  readonly text: string;
  readonly embedding: string | null;
  readonly embedding_model: string | null;
  readonly embedding_dim: number | string | null;
  readonly updated_at?: string | number;
}

function toInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function optionalInt(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = toInt(value, Number.NaN);
  return Number.isFinite(n) ? n : undefined;
}

function toKind(value: unknown): UploadKind {
  return value === "md" || value === "pdf" || value === "txt" ? value : "txt";
}

function parseKcIds(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const id of parsed) {
    if (typeof id !== "string") continue;
    const value = id.trim();
    if (value === "" || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

/**
 * 版本的唯一解析入口：TEXT 列既可能存毫秒数（本模块写入），
 * 也可能存 ISO（历史行），两种都还原成同一个数字再比较。
 */
export function rowUpdatedAt(row: { readonly updated_at: string | number }): number {
  const raw = row.updated_at;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text !== "") {
      const numeric = Number(text);
      if (Number.isFinite(numeric)) return Math.trunc(numeric);
      const parsed = Date.parse(text);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

export function rowToDoc(row: KbDocRow): UploadDoc {
  const pageCount = optionalInt(row.page_count);
  return {
    id: row.doc_id,
    directionId: row.direction_id,
    title: row.title ?? "",
    fileName: row.file_name,
    kind: toKind(row.kind),
    size: toInt(row.size),
    ...(pageCount !== undefined && pageCount > 0 ? { pageCount } : {}),
    charCount: toInt(row.char_count),
    chunkCount: toInt(row.chunk_count),
    kcIds: parseKcIds(row.kc_ids_json),
    createdAt: row.created_at,
    updatedAt: rowUpdatedAt(row),
  };
}

/** page_count 列 NOT NULL：非 PDF 存 0，读回时再折叠成「没有页码」。 */
export function docToRow(userId: string, doc: UploadDoc, updatedAt: number): KbDocRow {
  return {
    user_id: userId,
    doc_id: doc.id,
    direction_id: doc.directionId,
    title: doc.title,
    file_name: doc.fileName,
    kind: doc.kind,
    size: doc.size,
    page_count: doc.pageCount ?? 0,
    char_count: doc.charCount,
    chunk_count: doc.chunkCount,
    kc_ids_json: JSON.stringify(doc.kcIds),
    created_at: doc.createdAt,
    updated_at: String(updatedAt),
  };
}

/**
 * 解析向量列。有限数、非空、长度等于 dim 才返回；
 * 维度不符的向量若参与 cosine，会让排序永远错下去且不报错。
 */
export function parseEmbedding(raw: unknown, dim: unknown): readonly number[] | null {
  const expected = optionalInt(dim);
  if (expected === undefined || expected < 1 || expected > MAX_EMBEDDING_DIM) return null;

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length !== expected) return null;

  const out: number[] = [];
  for (const value of parsed) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    out.push(value);
  }
  return out;
}

export function rowToChunk(row: KbChunkRow): UploadChunk {
  const embedding = parseEmbedding(row.embedding, row.embedding_dim);
  const pageFrom = optionalInt(row.page_from);
  const pageTo = optionalInt(row.page_to);
  const model = row.embedding_model;
  return {
    id: row.chunk_id,
    docId: row.doc_id,
    directionId: row.direction_id,
    title: row.title ?? "",
    section: row.section ?? "",
    ...(pageFrom !== undefined && pageFrom > 0 ? { pageFrom } : {}),
    ...(pageTo !== undefined && pageTo > 0 ? { pageTo } : {}),
    text: row.text,
    index: toInt(row.idx),
    ...(embedding !== null && typeof model === "string" && model.trim() !== ""
      ? { embedding, embeddingModel: model, embeddingDim: embedding.length }
      : {}),
  };
}

export function chunkToRow(userId: string, chunk: UploadChunk, updatedAt: number): KbChunkRow {
  const hasEmbedding =
    chunk.embedding !== undefined &&
    chunk.embeddingModel !== undefined &&
    chunk.embeddingDim !== undefined;
  return {
    user_id: userId,
    chunk_id: chunk.id,
    doc_id: chunk.docId,
    direction_id: chunk.directionId,
    idx: chunk.index,
    title: chunk.title,
    section: chunk.section,
    page_from: chunk.pageFrom ?? null,
    page_to: chunk.pageTo ?? null,
    text: chunk.text,
    embedding: hasEmbedding ? JSON.stringify(chunk.embedding) : null,
    embedding_model: hasEmbedding ? (chunk.embeddingModel ?? null) : null,
    embedding_dim: hasEmbedding ? (chunk.embeddingDim ?? null) : null,
    updated_at: String(updatedAt),
  };
}

/** 默认响应不带向量：一份方向的全部片段可能有几百条，向量只按分页接口取。 */
export function stripChunkEmbedding(chunk: UploadChunk): UploadChunk {
  return {
    id: chunk.id,
    docId: chunk.docId,
    directionId: chunk.directionId,
    title: chunk.title,
    section: chunk.section,
    ...(chunk.pageFrom !== undefined ? { pageFrom: chunk.pageFrom } : {}),
    ...(chunk.pageTo !== undefined ? { pageTo: chunk.pageTo } : {}),
    text: chunk.text,
    index: chunk.index,
  };
}

// ── 上传校验 ──────────────────────────────────────────────────────

/**
 * 与 kbStore.ts:190-212 的 validateImportRows 同一套规则。
 *
 * 字数不要求等于片段正文之和（相邻块有重叠），但 chunkCount 必须严格一致；
 * 片段必须属于同一文档与同一方向，否则检索会把引用挂到错误的来源上。
 */
export function validateUploadPayload(
  doc: Pick<KbDocInput, "id" | "directionId" | "charCount" | "chunkCount">,
  chunks: readonly Pick<KbChunkInput, "id" | "docId" | "directionId" | "text" | "index">[],
): string | null {
  if (doc.id.trim() === "") return "文档 id 为空，未写入任何内容。";
  if (doc.directionId.trim() === "") return "文档没有所属方向，未写入任何内容。";
  if (chunks.length === 0) return "这份文件没有可导入的正文，未写入任何内容。";
  if (doc.charCount <= 0) return "这份文件没有可导入的正文，未写入任何内容。";
  if (doc.chunkCount !== chunks.length) {
    return `文档记录的段数（${doc.chunkCount}）与实际片段数（${chunks.length}）不一致，未写入任何内容。`;
  }

  const ids = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.id.trim() === "") return "片段 id 为空，未写入任何内容。";
    if (ids.has(chunk.id)) return `片段 id 重复（${chunk.id}），未写入任何内容。`;
    if (chunk.docId !== doc.id) return "片段的 docId 与文档不一致，未写入任何内容。";
    if (chunk.directionId !== doc.directionId) return "片段的方向与文档不一致，未写入任何内容。";
    if (chunk.text.trim() === "") return "存在空片段，未写入任何内容。";
    if (!Number.isInteger(chunk.index) || chunk.index < 0) {
      return "片段序号无效，未写入任何内容。";
    }
    ids.add(chunk.id);
  }
  return null;
}

// ── 向量生成（可注入） ────────────────────────────────────────────

export interface EmbeddingBatch {
  readonly model: string;
  readonly dim: number;
  readonly vectors: readonly (readonly number[])[];
}

/**
 * 与 serverEmbedding.ts 的 embedTextsForUser 同形。
 *
 * 文档 PUT 不再调用它：512 维本地向量走 POST /api/kb/vectors，
 * 外部嵌入由客户端显式放进 chunks[].embedding。保留类型只为不破坏
 * 仍传 {embedTexts} 的调用方。
 */
export type EmbedTextsForUser = (
  userId: string,
  texts: readonly string[],
  signal?: AbortSignal,
) => Promise<EmbeddingBatch | null>;

/** @deprecated 向量不再随文档 PUT 自动生成；字段仅用于兼容旧调用点。 */
export interface KbPutDeps {
  readonly embedTexts?: EmbedTextsForUser;
}

function toUploadChunk(input: KbChunkInput): UploadChunk {
  const pageFrom = input.pageFrom;
  const pageTo = input.pageTo;
  return {
    id: input.id,
    docId: input.docId,
    directionId: input.directionId,
    title: input.title,
    section: input.section,
    ...(pageFrom !== undefined ? { pageFrom } : {}),
    ...(pageTo !== undefined ? { pageTo } : {}),
    text: input.text,
    index: input.index,
    ...(input.embedding !== undefined
      ? {
          embedding: [...input.embedding],
          embeddingModel: input.embeddingModel,
          embeddingDim: input.embeddingDim,
        }
      : {}),
  };
}

// ── 写入 ──────────────────────────────────────────────────────────

export type PutKbResult =
  | {
      readonly ok: true;
      readonly doc: UploadDoc;
      readonly updatedAt: number;
      readonly storedChunks: number;
      readonly deletedChunks: number;
      readonly embeddedChunks: number;
    }
  | { readonly ok: false; readonly reason: "invalid" | "conflict"; readonly message: string };

const DOC_COLUMNS =
  "user_id, doc_id, direction_id, title, file_name, kind, size, page_count, char_count, chunk_count, kc_ids_json, created_at, updated_at";

const DOC_UPDATE = `direction_id = EXCLUDED.direction_id, title = EXCLUDED.title,
  file_name = EXCLUDED.file_name, kind = EXCLUDED.kind, size = EXCLUDED.size,
  page_count = EXCLUDED.page_count, char_count = EXCLUDED.char_count,
  chunk_count = EXCLUDED.chunk_count, kc_ids_json = EXCLUDED.kc_ids_json,
  created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`;

const CHUNK_COLUMNS =
  "user_id, chunk_id, doc_id, direction_id, idx, title, section, page_from, page_to, text, embedding, embedding_model, embedding_dim, updated_at";

const CHUNK_UPDATE = `doc_id = EXCLUDED.doc_id, direction_id = EXCLUDED.direction_id,
  idx = EXCLUDED.idx, title = EXCLUDED.title, section = EXCLUDED.section,
  page_from = EXCLUDED.page_from, page_to = EXCLUDED.page_to, text = EXCLUDED.text,
  embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model,
  embedding_dim = EXCLUDED.embedding_dim, updated_at = EXCLUDED.updated_at`;

function docParams(row: KbDocRow): unknown[] {
  return [
    row.user_id,
    row.doc_id,
    row.direction_id,
    row.title,
    row.file_name,
    row.kind,
    row.size,
    row.page_count,
    row.char_count,
    row.chunk_count,
    row.kc_ids_json,
    row.created_at,
    row.updated_at,
  ];
}

function chunkParams(row: KbChunkRow): unknown[] {
  return [
    row.user_id,
    row.chunk_id,
    row.doc_id,
    row.direction_id,
    row.idx,
    row.title,
    row.section,
    row.page_from,
    row.page_to,
    row.text,
    row.embedding,
    row.embedding_model,
    row.embedding_dim,
    row.updated_at,
  ];
}

/**
 * 写入一份文档及其全部片段。
 *
 * 顺序固定：CAS 检查 → upsert doc → upsert chunks → 删除本次列表外的旧片段。
 * 向量不再在 PUT 里生成或补齐；512 维本地向量走 POST /api/kb/vectors。
 * CAS 在任何写操作之前，因此 409 时不会留下任何行；片段替换是「先 upsert 再删」，
 * 中途失败最多留下多余的旧片段，不会出现文档存在而片段全丢。
 */
export async function putKbDocument(
  db: Db,
  userId: string,
  body: KbPut,
  _deps: KbPutDeps = {},
): Promise<PutKbResult> {
  const payloadError = validateUploadPayload(body.doc, body.chunks);
  if (payloadError !== null) {
    return { ok: false, reason: "invalid", message: payloadError };
  }

  const existingRow = await db.one<KbDocRow>(
    "SELECT * FROM kb_docs WHERE user_id = $1 AND doc_id = $2",
    [userId, body.doc.id],
  );
  const existingUpdatedAt = existingRow === null ? null : rowUpdatedAt(existingRow);

  if (existingRow === null) {
    if (body.baseUpdatedAt !== null) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "版本冲突：服务端没有这份文档（可能已被其它设备删除），但 baseUpdatedAt 不是空；请刷新后重试。",
      };
    }
  } else if (body.baseUpdatedAt === null) {
    return {
      ok: false,
      reason: "conflict",
      message:
        "版本冲突：文档已存在（可能已在其它设备导入），但 baseUpdatedAt 为空；请刷新后重试。",
    };
  } else if (body.baseUpdatedAt !== existingUpdatedAt) {
    return {
      ok: false,
      reason: "conflict",
      message: `版本冲突：文档已被其它设备修改（服务端版本 ${existingUpdatedAt ?? 0}，提交基于 ${body.baseUpdatedAt}）；本地内容未覆盖服务端。`,
    };
  }

  const updatedAt = Math.max(Date.now(), (existingUpdatedAt ?? 0) + 1);
  const doc: UploadDoc = {
    id: body.doc.id,
    directionId: body.doc.directionId,
    title: body.doc.title,
    fileName: body.doc.fileName,
    kind: body.doc.kind,
    size: body.doc.size,
    ...(body.doc.pageCount !== undefined ? { pageCount: body.doc.pageCount } : {}),
    charCount: body.doc.charCount,
    chunkCount: body.doc.chunkCount,
    kcIds: [...body.doc.kcIds],
    createdAt: body.doc.createdAt,
    updatedAt,
  };

  const docRow = docToRow(userId, doc, updatedAt);
  const claimed = await db.run(
    `INSERT INTO kb_docs (${DOC_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (user_id, doc_id) DO UPDATE SET ${DOC_UPDATE}
     WHERE kb_docs.updated_at = $14 AND $14 IS NOT NULL`,
    [...docParams(docRow), existingRow?.updated_at ?? null],
  );
  if (claimed === 0) return { ok: false, reason: "conflict", message: "文档已在另一设备更新，本地修改已保留，请刷新后重试。" };

  const inputChunks = body.chunks.map(toUploadChunk);
  const chunks = inputChunks;

  for (const chunk of chunks) {
    const row = chunkToRow(userId, chunk, updatedAt);
    await db.run(
      `INSERT INTO kb_chunks (${CHUNK_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (user_id, chunk_id) DO UPDATE SET ${CHUNK_UPDATE}`,
      chunkParams(row),
    );
  }

  /*
   * 删除本次列表外的旧片段：先 SELECT id 再逐个 DELETE。
   * 不用一条 `DELETE ... WHERE chunk_id <> ALL`，因为内存实现只认固定删除形状；
   * 参数顺序固定为 (user_id, chunk_id)，与 db.ts 的分支一一对应。
   *
   * 必须在 JS 里再按 doc_id 过滤：内存实现只按 direction_id 过滤，
   * 同一方向的其它文档也会被返回；直接按 keep 删除会误删别的文档的片段。
   */
  const keep = new Set(chunks.map((chunk) => chunk.id));
  const existingIds = await db.all<{ chunk_id: string; doc_id: string }>(
    "SELECT chunk_id, doc_id FROM kb_chunks WHERE user_id = $1 AND doc_id = $2 ORDER BY chunk_id",
    [userId, doc.id],
  );
  let deletedChunks = 0;
  for (const row of existingIds) {
    if (row.doc_id !== doc.id) continue;
    if (keep.has(row.chunk_id)) continue;
    deletedChunks += await db.run(
      "DELETE FROM kb_chunks WHERE user_id = $1 AND chunk_id = $2",
      [userId, row.chunk_id],
    );
  }

  return {
    ok: true,
    doc,
    updatedAt,
    storedChunks: chunks.length,
    deletedChunks,
    embeddedChunks: chunks.filter((chunk) => chunk.embedding !== undefined).length,
  };
}

// ── 读取 ──────────────────────────────────────────────────────────

export async function listDirectionDocs(
  db: Db,
  userId: string,
  directionId: string,
): Promise<UploadDoc[]> {
  const rows = await db.all<KbDocRow>(
    "SELECT * FROM kb_docs WHERE user_id = $1 AND direction_id = $2 ORDER BY created_at",
    [userId, directionId],
  );
  return rows.map(rowToDoc);
}

export async function getKbDoc(
  db: Db,
  userId: string,
  docId: string,
): Promise<UploadDoc | null> {
  const row = await db.one<KbDocRow>(
    "SELECT * FROM kb_docs WHERE user_id = $1 AND doc_id = $2",
    [userId, docId],
  );
  return row === null ? null : rowToDoc(row);
}

export async function listDirectionChunks(
  db: Db,
  userId: string,
  directionId: string,
): Promise<UploadChunk[]> {
  const rows = await db.all<KbChunkRow>(
    "SELECT * FROM kb_chunks WHERE user_id = $1 AND direction_id = $2 ORDER BY doc_id, idx",
    [userId, directionId],
  );
  return rows.map(rowToChunk);
}

export interface KbVectorChunk {
  readonly id: string;
  readonly embedding: readonly number[];
  readonly embeddingModel: string;
  readonly embeddingDim: number;
}

export interface KbVectorPage {
  readonly vectors: readonly KbVectorChunk[];
  /** 下一页游标；没有更多时为 null。 */
  readonly next: string | null;
}

/** limit 夹在 1..100；非数字按默认值处理。 */
export function clampVectorLimit(raw: number | null): number {
  if (raw === null || !Number.isFinite(raw)) return KB_VECTOR_PAGE_DEFAULT;
  return Math.min(KB_VECTOR_PAGE_MAX, Math.max(1, Math.trunc(raw)));
}

/**
 * 按 chunk_id 升序分页取向量。
 *
 * 游标是「上一页最后一条的 chunk_id」，不含在下一页里。
 * 多取一条用来判断是否还有下一页：否则末页会先返回一个非空 next，
 * 客户端要多发一次注定为空的请求才能收到 null。
 */
export async function listDirectionVectors(
  db: Db,
  userId: string,
  directionId: string,
  after: string | null,
  limit: number,
): Promise<KbVectorPage> {
  const pageSize = clampVectorLimit(limit);
  const rows = await db.all<KbChunkRow>(
    `SELECT chunk_id, embedding, embedding_model, embedding_dim
       FROM kb_chunks
      WHERE user_id = $1 AND direction_id = $2 AND chunk_id > $3
      ORDER BY chunk_id
      LIMIT $4`,
    [userId, directionId, after ?? "", pageSize + 1],
  );

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const vectors: KbVectorChunk[] = [];
  for (const row of pageRows) {
    const embedding = parseEmbedding(row.embedding, row.embedding_dim);
    if (embedding === null) continue;
    const model = typeof row.embedding_model === "string" ? row.embedding_model.trim() : "";
    if (model === "") continue;
    vectors.push({
      id: row.chunk_id,
      embedding,
      embeddingModel: model,
      embeddingDim: embedding.length,
    });
  }

  /*
   * 游标取本页最后一条原始行（即使它没有合法向量），保证下一页从它之后开始，
   * 否则一条坏向量会让分页原地打转。
   */
  return {
    vectors,
    next: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].chunk_id : null,
  };
}

/** 删除一篇文档及其片段，返回真实删除数。 */
export async function deleteKbDoc(
  db: Db,
  userId: string,
  docId: string,
): Promise<{ deletedDocs: number; deletedChunks: number }> {
  // 先删片段再删文档：Postgres 的外键级联会先删片段，反过来就永远数不到片段数
  const deletedChunks = await db.run(
    "DELETE FROM kb_chunks WHERE user_id = $1 AND doc_id = $2",
    [userId, docId],
  );
  const deletedDocs = await db.run("DELETE FROM kb_docs WHERE user_id = $1 AND doc_id = $2", [
    userId,
    docId,
  ]);
  return { deletedDocs, deletedChunks };
}

/** 删除一个方向下的全部文档与片段，返回真实删除数。 */
export async function deleteKbDirection(
  db: Db,
  userId: string,
  directionId: string,
): Promise<{ deletedDocs: number; deletedChunks: number }> {
  const deletedChunks = await db.run(
    "DELETE FROM kb_chunks WHERE user_id = $1 AND direction_id = $2",
    [userId, directionId],
  );
  const deletedDocs = await db.run(
    "DELETE FROM kb_docs WHERE user_id = $1 AND direction_id = $2",
    [userId, directionId],
  );
  return { deletedDocs, deletedChunks };
}
