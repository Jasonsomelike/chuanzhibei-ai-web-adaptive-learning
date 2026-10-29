/**
 * 服务端记忆卡：清洗、LWW 合并与显式删除。
 *
 * 与知识库不同，记忆卡的「快照 PUT」不是替换语义：只更新提交里出现的卡，
 * 不在列表里的 mem_id 原样保留。两台设备各删各的却都以为成功，
 * 是同步里最难解释的状态；因此删除只走显式 DELETE，PUT 永远不会删行。
 *
 * 版本号取 max(lastSeenAt, createdAt)：这两个时间都由客户端作答/复习时写入，
 * 比服务器接收时间更能代表「这张卡实际更新的时刻」。服务端接收时间会让
 * 时钟快的设备永远赢。
 */

import type { Db } from "@/lib/db";
import { parseMemories, type MemoryItem } from "@/lib/memory";

/** 单次 PUT /api/memories 的请求体上限。 */
export const MAX_MEMORIES_PUT_BYTES = 1024 * 1024;

export interface MemoriesRow {
  readonly user_id?: string;
  readonly mem_id: string;
  readonly subject_id: string;
  readonly kind: string;
  readonly kc_id: string;
  readonly with_kc_id: string | null;
  readonly question_id: string | null;
  readonly status: string;
  readonly payload: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export type MemoriesPayloadResult =
  | { readonly ok: true; readonly subjectId: string; readonly memories: readonly MemoryItem[] }
  | { readonly ok: false; readonly error: string };

const SUBJECT_ID = /^[a-z0-9][a-z0-9-]*$/u;

/**
 * 校验并清洗 PUT 请求体。
 *
 * 只做「形状是否可解释」的判断：合法条目进 parseMemories 清洗（丢弃坏记录、
 * 同 id 只留第一条、字段截断），不因为一条坏卡拒绝整份快照——
 * 客户端同步的是本机已有数据，一条损坏不应让其余全部卡都存不上。
 */
export function validateMemoriesPayload(raw: unknown): MemoriesPayloadResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "请求体必须是 JSON 对象" };
  }

  const body = raw as Record<string, unknown>;
  if (typeof body.subjectId !== "string") {
    return { ok: false, error: "缺少 subjectId" };
  }
  const subjectId = body.subjectId.trim();
  if (subjectId === "" || subjectId.length > 64 || !SUBJECT_ID.test(subjectId)) {
    return { ok: false, error: "subjectId 必须是 slug" };
  }
  if (!Array.isArray(body.memories)) {
    return { ok: false, error: "memories 必须是数组" };
  }

  /*
   * parseMemories 自带 MAX_MEMORIES 上限（memory.ts 的领域常量），
   * 这是清洗函数的既有语义，不是本轮新增的服务端配额；除此之外不做条数与容量判断。
   */
  return { ok: true, subjectId, memories: parseMemories(body.memories) };
}

/** 卡片版本号（Unix 毫秒）：lastSeenAt 与 createdAt 的较大者。 */
export function memoryUpdatedAt(item: Pick<MemoryItem, "createdAt" | "lastSeenAt">): number {
  const lastSeen = Date.parse(item.lastSeenAt);
  const created = Date.parse(item.createdAt);
  const values = [lastSeen, created].filter((value) => Number.isFinite(value));
  return values.length === 0 ? 0 : Math.max(...values);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface PutMemoriesResult {
  readonly stored: number;
  readonly skippedStale: number;
}

/**
 * LWW upsert：只为提交里出现的卡写行。
 *
 * existing.updated_at 严格大于 incoming 才跳过；相等时写入，
 * 因为相等通常意味着同一张卡重复提交，结果应保持一致。
 */
export async function putMemories(
  db: Db,
  userId: string,
  subjectId: string,
  memories: readonly MemoryItem[],
): Promise<PutMemoriesResult> {
  const existingRows = await db.all<{ mem_id: string; updated_at: string }>(
    "SELECT mem_id, updated_at FROM memories WHERE user_id = $1",
    [userId],
  );
  const existing = new Map<string, number>();
  for (const row of existingRows) {
    const ms = Date.parse(row.updated_at);
    existing.set(row.mem_id, Number.isFinite(ms) ? ms : 0);
  }

  let stored = 0;
  let skippedStale = 0;

  for (const item of memories) {
    const incoming = memoryUpdatedAt(item);
    const current = existing.get(item.id);
    if (current !== undefined && current > incoming) {
      skippedStale += 1;
      continue;
    }

    await db.run(
      `INSERT INTO memories
         (user_id, mem_id, subject_id, kind, kc_id, with_kc_id, question_id, status, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id, mem_id) DO UPDATE SET
         subject_id = EXCLUDED.subject_id,
         kind = EXCLUDED.kind,
         kc_id = EXCLUDED.kc_id,
         with_kc_id = EXCLUDED.with_kc_id,
         question_id = EXCLUDED.question_id,
         status = EXCLUDED.status,
         payload = EXCLUDED.payload,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at`,
      [
        userId,
        item.id,
        subjectId,
        item.kind,
        item.kcId,
        item.withKcId ?? null,
        item.questionId ?? null,
        item.status,
        JSON.stringify(item),
        item.createdAt,
        toIso(incoming),
      ],
    );
    stored += 1;
  }

  return { stored, skippedStale };
}

/**
 * 读取某学科的全部记忆卡。
 *
 * 行的 payload 是不可信输入（可能是旧版本写的、也可能被手工改坏），
 * 统一回到 parseMemories 清洗；单行 JSON 损坏只丢这一张卡。
 */
export async function listMemories(
  db: Db,
  userId: string,
  subjectId: string,
): Promise<MemoryItem[]> {
  const rows = await db.all<MemoriesRow>(
    "SELECT * FROM memories WHERE user_id = $1 AND subject_id = $2",
    [userId, subjectId],
  );

  const raw: unknown[] = [];
  for (const row of rows) {
    try {
      raw.push(JSON.parse(row.payload));
    } catch {
      // 单行损坏不影响其余卡
    }
  }
  return [...parseMemories(raw)];
}

/** 显式删除一张卡，返回真实删除数。 */
export async function deleteMemory(db: Db, userId: string, memId: string): Promise<number> {
  return db.run("DELETE FROM memories WHERE user_id = $1 AND mem_id = $2", [userId, memId]);
}

/** 显式清空一个学科的记忆卡，返回真实删除数。 */
export async function deleteSubjectMemories(
  db: Db,
  userId: string,
  subjectId: string,
): Promise<number> {
  return db.run("DELETE FROM memories WHERE user_id = $1 AND subject_id = $2", [
    userId,
    subjectId,
  ]);
}
