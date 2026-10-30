/**
 * 本地向量（pgvector）的请求/响应契约与纯函数。
 *
 * 边界：
 * - 只描述「浏览器本地模型产出什么、路由接受什么、SQL 参数怎么排」；
 *   不碰 Db、不读环境变量、不发请求。
 * - 向量表 kb_chunk_vectors **没有 direction_id**：按方向查询时必须 JOIN
 *   kb_chunks（见 db.ts 的 KB_VECTOR_SQL），这里不提供任何假设 direction_id
 *   在向量表上的 SQL。
 * - 只承载 512 维本地模型；1024/1536 维外部嵌入继续走 kb_chunks 的 TEXT 列，
 *   不进入本模块。
 *
 * 为什么把校验放在 zod 之外再写一遍：zod 的 `.finite()` 能挡 NaN/Infinity，
 * 但挡不住「512 个分量全为 0」。零范数向量会让余弦距离变成 NaN，pgvector 会
 * 把它排在任意位置而不报错；必须在入库前显式拒绝。
 */

import { z } from "zod";

/** 本地模型的稳定标识；也是 kb_chunk_vectors.model 的值。 */
export const KB_LOCAL_VECTOR_MODEL = "bge-small-zh-v1.5-q8";

/** bge-small-zh-v1.5 的向量维度。表列固定为 vector(512)。 */
export const KB_LOCAL_VECTOR_DIM = 512;

/** 单次上传的条数上限。与 512KB 请求体上限共同约束一批数据。 */
export const KB_VECTOR_BATCH_MAX = 32;

/** POST /api/kb/vectors 的请求体上限（字节）。32 条 × 512 维 JSON ≈ 20KB。 */
export const KB_VECTOR_UPLOAD_MAX_BYTES = 512 * 1024;

/** POST /api/kb/similar 的请求体上限（字节）。单个 512 维向量 ≈ 10KB。 */
export const KB_SIMILAR_MAX_BYTES = 64 * 1024;

export const KB_SIMILAR_DEFAULT_LIMIT = 8;
export const KB_SIMILAR_MAX_LIMIT = 50;

/** 与 apiContracts.entityId 同一条安全字符集；本模块不依赖 apiContracts 的内部常量。 */
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function entityIdField(label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label}不能为空`)
    .max(120, `${label}过长`)
    .regex(ENTITY_ID, `${label}包含不允许的字符`);
}

export const kbEntityId = entityIdField("id");

/**
 * 向量的纯校验：返回 null 表示可用，否则返回人话原因。
 *
 * 检查顺序固定为「数组 → 维度 → 有限值 → 范数」：先报维度能让
 * 「把 1024 维外部向量误传给本地接口」得到明确提示，而不是笼统的
 * 「包含非法数值」。
 */
export function vectorProblem(vector: unknown, dim = KB_LOCAL_VECTOR_DIM): string | null {
  if (!Array.isArray(vector)) return "向量必须是数组。";
  if (!Number.isInteger(dim) || dim < 1) return "向量维度配置无效。";
  if (vector.length !== dim) {
    return `向量维度必须是 ${dim}（收到 ${vector.length}）。`;
  }
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `向量第 ${index + 1} 个分量不是有限数。`;
    }
  }
  const norm = Math.hypot(...(vector as number[]));
  if (!Number.isFinite(norm) || norm <= 0) return "向量范数为 0，无法计算余弦相似度。";
  return null;
}

/** 上传的单条向量。字段只允许 chunkId 与 vec。 */
export const kbVectorItem = z
  .strictObject({
    chunkId: entityIdField("chunkId"),
    vec: z.array(z.number().finite()).length(KB_LOCAL_VECTOR_DIM),
  })
  .superRefine((item, ctx) => {
    const problem = vectorProblem(item.vec);
    if (problem !== null) {
      ctx.addIssue({ code: "custom", path: ["vec"], message: problem });
    }
  });

export type KbVectorItem = z.infer<typeof kbVectorItem>;

/**
 * POST /api/kb/vectors 的请求体。
 *
 * 顶层只允许 model 与 vectors；model 省略时按本地模型处理。
 * 不接收 directionId / docId：向量表不存方向，归属由 kb_chunks 的复合外键保证。
 */
export const kbVectorUpload = z.strictObject({
  model: z.literal(KB_LOCAL_VECTOR_MODEL).optional(),
  vectors: z.array(kbVectorItem).min(1).max(KB_VECTOR_BATCH_MAX),
});

export type KbVectorUpload = z.infer<typeof kbVectorUpload>;

/** POST /api/kb/similar 的请求体。查询向量必须恰好 512 维。 */
export const kbSimilarRequest = z.strictObject({
  directionId: entityIdField("directionId"),
  model: z.literal(KB_LOCAL_VECTOR_MODEL).optional(),
  vector: z
    .array(z.number().finite())
    .length(KB_LOCAL_VECTOR_DIM)
    .superRefine((vector, ctx) => {
      const problem = vectorProblem(vector);
      if (problem !== null) {
        ctx.addIssue({ code: "custom", path: [], message: problem });
      }
    }),
  limit: z.number().int().min(1).max(KB_SIMILAR_MAX_LIMIT).optional(),
});

export type KbSimilarRequest = z.infer<typeof kbSimilarRequest>;

// ── 响应形状 ──────────────────────────────────────────────────────

export interface KbVectorUploadResult {
  readonly stored: number;
  readonly model: string;
  readonly dim: number;
}

export interface KbVectorListResult {
  readonly model: string;
  readonly dim: number;
  /** 已经写入向量表的 chunkId；按字典序去重。 */
  readonly chunkIds: readonly string[];
}

export interface KbSimilarHit {
  readonly chunkId: string;
  readonly score: number;
}

export interface KbSimilarResult {
  readonly model: string;
  readonly dim: number;
  readonly hits: readonly KbSimilarHit[];
}

// ── 批切分与 SQL 参数 ────────────────────────────────────────────

/**
 * 把任意长度的数组切成每批不超过 32 条。
 *
 * 传入更大的 size 也会被夹到 KB_VECTOR_BATCH_MAX：调用方不能靠传参
 * 绕过「一批 ≤32 条」的服务端约束。size 非正/非有限按 32 处理。
 */
export function batchVectors<T>(
  items: readonly T[],
  size: number = KB_VECTOR_BATCH_MAX,
): T[][] {
  const raw = Number.isFinite(size) ? Math.floor(size) : KB_VECTOR_BATCH_MAX;
  const limit = Math.min(KB_VECTOR_BATCH_MAX, raw >= 1 ? raw : KB_VECTOR_BATCH_MAX);
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += limit) {
    out.push(items.slice(start, start + limit));
  }
  return out;
}

/**
 * 序列化成 pgvector 认的文本格式 `[0.1,0.2]`。
 *
 * 不能直接传 JS 数组：Neon 驱动会把它序列化成 `{0.1,0.2}`，那是 Postgres
 * 数组字面量，不是 vector 输入。所有分量必须已在调用前通过 vectorProblem。
 */
export function vectorToSqlText(vector: readonly number[]): string {
  return `[${vector.map((value) => String(value)).join(",")}]`;
}

/**
 * KB_VECTOR_SQL.similar 的参数顺序：user_id, direction_id, model, query, limit。
 * 单独导出是为了让「参数形状」可以在不连库的情况下断言。
 */
export function similarParams(
  userId: string,
  directionId: string,
  model: string,
  vector: readonly number[],
  limit: number,
): unknown[] {
  return [userId, directionId, model, vectorToSqlText(vector), limit];
}

/**
 * 把 `SELECT chunk_id, 1 - (vec <=> $4) AS score` 的行映射成响应。
 *
 * 驱动对 numeric 可能返回字符串；NaN/Infinity（零范数、维度损坏）一律丢弃，
 * 不当作 0 分混进结果。分数夹到 [-1,1]，同分按 chunkId 升序保证确定性。
 */
export function mapSimilarRows(rows: readonly unknown[]): KbSimilarHit[] {
  const hits: KbSimilarHit[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as { chunk_id?: unknown; chunkId?: unknown; score?: unknown };
    const rawId = typeof record.chunk_id === "string" ? record.chunk_id : record.chunkId;
    const chunkId = typeof rawId === "string" ? rawId.trim() : "";
    if (chunkId === "" || seen.has(chunkId)) continue;

    const rawScore = record.score;
    const score =
      typeof rawScore === "number"
        ? rawScore
        : typeof rawScore === "string" && rawScore.trim() !== ""
          ? Number(rawScore)
          : Number.NaN;
    if (!Number.isFinite(score)) continue;

    seen.add(chunkId);
    hits.push({ chunkId, score: Math.min(1, Math.max(-1, score)) });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0;
  });
  return hits;
}

/** 向量表里已有 chunkId 的映射；重复与空串直接丢弃。 */
export function mapStoredChunkIds(rows: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as { chunk_id?: unknown; chunkId?: unknown };
    const raw = typeof record.chunk_id === "string" ? record.chunk_id : record.chunkId;
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (id !== "") ids.add(id);
  }
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
