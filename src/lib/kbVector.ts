/**
 * 服务端向量表读写（kb_chunk_vectors）。
 *
 * 设计约束（对应 ADR 评审问题 3–6 的修正）：
 * - 向量表不存 direction_id：按方向读取/相似查询都必须 JOIN kb_chunks，
 *   直接复用 db.ts 的 KB_VECTOR_SQL，不在本文件另写一份 SQL。
 * - 默认精确余弦扫描，不启用 HNSW、不执行 CONCURRENTLY、不使用 SET LOCAL。
 * - 一批 ≤32 条由 vectorContracts 的 zod schema 与 batchVectors 双重保证；
 *   本模块按单行 upsert 写入，内存实现与 Postgres 共用同一形状。
 * - user_id 只能由路由从会话传入；本模块不接收客户端提供的 userId。
 */

import type { Db } from "@/lib/db";
import { KB_VECTOR_SQL, listKbChunkVectorsByDirection } from "@/lib/db";
import {
  KB_LOCAL_VECTOR_DIM,
  KB_LOCAL_VECTOR_MODEL,
  mapSimilarRows,
  similarParams,
  vectorToSqlText,
  type KbSimilarHit,
  type KbVectorItem,
  type KbVectorUpload,
} from "@/lib/vectorContracts";

/**
 * 一批向量写入。返回实际尝试写入的条数。
 *
 * 每条单独 upsert：内存实现只认单行形状，Postgres 侧多行 INSERT 也没有必要
 * ——一批最多 32 条，且请求本身已经是批量的。外键 (user_id, chunk_id) 会拒绝
 * 不属于当前用户的 chunkId；调用方把数据库错误翻译成 4xx/5xx。
 */
export async function storeKbVectors(
  db: Db,
  userId: string,
  upload: KbVectorUpload,
): Promise<number> {
  const model = upload.model ?? KB_LOCAL_VECTOR_MODEL;
  const updatedAt = new Date().toISOString();

  let stored = 0;
  for (const item of upload.vectors) {
    await db.run(KB_VECTOR_SQL.upsert, [
      userId,
      item.chunkId,
      model,
      KB_LOCAL_VECTOR_DIM,
      vectorToSqlText(item.vec),
      updatedAt,
    ]);
    stored += 1;
  }
  return stored;
}

/**
 * 列出某方向已经写入本地向量的 chunkId。
 *
 * SQL 走 `FROM kb_chunk_vectors v JOIN kb_chunks c`，方向过滤在 c 上；
 * 因此跨方向写入的向量不会出现在这个方向的结果里。
 */
export async function listStoredVectorChunkIds(
  db: Db,
  userId: string,
  directionId: string,
  model: string = KB_LOCAL_VECTOR_MODEL,
): Promise<readonly string[]> {
  const rows = await listKbChunkVectorsByDirection(db, userId, directionId, model);
  const ids: string[] = [];
  for (const row of rows) {
    if (row.dim !== KB_LOCAL_VECTOR_DIM) continue;
    const id = typeof row.chunk_id === "string" ? row.chunk_id.trim() : "";
    if (id !== "") ids.push(id);
  }
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 精确余弦相似度查询。
 *
 * 内存后端没有 pgvector，`<=>` 查询按 db.ts 的约定返回空数组；
 * 调用方不需要区分「没有向量」与「后端不支持」，两者都退化为 BM25。
 */
export async function querySimilarChunks(
  db: Db,
  userId: string,
  directionId: string,
  vector: readonly number[],
  limit: number,
  model: string = KB_LOCAL_VECTOR_MODEL,
): Promise<KbSimilarHit[]> {
  const rows = await db.all<Record<string, unknown>>(
    KB_VECTOR_SQL.similar,
    similarParams(userId, directionId, model, vector, limit),
  );
  return mapSimilarRows(rows).slice(0, limit);
}

/** 校验一批上传项；路由在 zod 之后还会调用，便于单测直接断言纯函数。 */
export function uploadItemsOf(upload: KbVectorUpload): readonly KbVectorItem[] {
  return upload.vectors;
}
