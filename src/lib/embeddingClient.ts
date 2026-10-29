/**
 * 浏览器侧的批量向量化客户端。
 *
 * 边界：
 * - 只发一段文本数组给 /api/llm/embeddings；模型、地址、密钥全部在服务端配置里，
 *   请求体不带它们（apiContracts.embeddings 是 strictObject）。
 * - 「没有向量能力」是正常降级信号：404（账号没存 llm 配置）/ 503（没有可用的
 *   embedding 配置）折成 code="unavailable"，调用方据此把 embeddingStatus
 *   写成 unsupported 并退回 BM25，不弹错误框。
 * - 其余失败（网络、5xx、响应形状不对）不改变 embeddingStatus：一次网络抖动
 *   不该把「服务端支持向量」永久记成不支持。
 * - 内存 LRU ≤50 条：同一段文本在一次会话里不重复付费；键是 model + 文本散列。
 *   只用 32 位散列做键，理论上可能碰撞，但缓存只影响一次会话内的复用，
 *   碰撞的后果是拿到另一段文本的向量——概率极低，且只在本标签页内。
 */

import { fnv1a } from "@/lib/embedding";

export const EMBEDDINGS_ENDPOINT = "/api/llm/embeddings";

/** 与服务端 embeddings schema 的上限一致：一次最多 64 条。 */
export const EMBEDDINGS_BATCH_SIZE = 64;

/** 单批超时。向量化通常 1–3 秒，20 秒还没回来就该退回 BM25。 */
export const EMBEDDINGS_TIMEOUT_MS = 20_000;

/** 内存 LRU 容量。50 条足够覆盖一次问答的查询与常用片段。 */
export const EMBEDDING_CACHE_LIMIT = 50;

export interface EmbedTextsOptions {
  /**
   * 期望的向量模型名，用于缓存键与响应校验。
   * 服务端返回的 model 与它不同时判 invalid——不同模型的向量不能放进同一个索引。
   */
  readonly model?: string;
  readonly signal?: AbortSignal;
  /** 单批超时毫秒数，默认 EMBEDDINGS_TIMEOUT_MS。 */
  readonly timeoutMs?: number;
}

export interface EmbeddingResult {
  readonly model: string;
  readonly dim: number;
  /** 与输入一一对应；每条都是有限数。 */
  readonly vectors: readonly (readonly number[])[];
}

export type EmbeddingFailureCode =
  | "unavailable" // 404 / 503：没有可用的向量化配置（正常降级）
  | "unauthorized" // 401：未登录
  | "http" // 其它非 2xx
  | "invalid" // 响应形状不对 / 模型与请求不符
  | "network" // 断网、超时
  | "aborted"; // 调用方取消

export type EmbedTextsOutcome =
  | ({ readonly ok: true } & EmbeddingResult)
  | {
      readonly ok: false;
      readonly code: EmbeddingFailureCode;
      /** 可直接展示的中文短句。 */
      readonly detail: string;
      readonly status?: number;
    };

// ── 内存 LRU ──────────────────────────────────────────────────────

const cache = new Map<string, readonly number[]>();

function cacheKey(model: string, text: string): string {
  return `${model}:${fnv1a(text)}`;
}

function remember(key: string, vector: readonly number[]): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, vector);
  while (cache.size > EMBEDDING_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 测试与登出时清空；缓存里是向量，不含密钥。 */
export function clearEmbeddingCache(): void {
  cache.clear();
}

export function embeddingCacheSize(): number {
  return cache.size;
}

// ── 请求 ──────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

/** 服务端的错误体是 {error:{code,message}}；取不到就回空串。 */
async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  if (text.trim() === "") return "";
  try {
    const message = asRecord(asRecord(JSON.parse(text) as unknown)["error"])["message"];
    if (typeof message === "string" && message.trim() !== "") return message.trim();
  } catch {
    // 不是 JSON：当作纯文本用
  }
  return text.trim().slice(0, 200);
}

function failure(
  code: EmbeddingFailureCode,
  detail: string,
  status?: number,
): EmbedTextsOutcome {
  return { ok: false, code, detail, ...(status !== undefined ? { status } : {}) };
}

function finiteVector(raw: unknown, dim: number): readonly number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (dim !== -1 && raw.length !== dim) return null;
  const out: number[] = [];
  for (const value of raw) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    out.push(value);
  }
  return out;
}

/**
 * 校验 /api/llm/embeddings 的响应。
 * 长度必须与请求条数一致、所有向量维度一致、分量都是有限数；
 * 有任何一条不合格就整批丢弃，绝不往索引里写半批坏向量。
 */
function parseBatch(
  json: unknown,
  expected: number,
  requestedModel: string,
): EmbedTextsOutcome {
  const record = asRecord(json);
  const raw = record["vectors"];
  const declaredDim = record["dim"];
  const responseModel = typeof record["model"] === "string" ? record["model"].trim() : "";

  if (!Array.isArray(raw) || raw.length !== expected) {
    return failure("invalid", "向量服务返回的条数与请求不一致");
  }
  const dim = typeof declaredDim === "number" && declaredDim > 0 ? declaredDim : -1;

  const vectors: (readonly number[])[] = [];
  let resolvedDim = dim;
  for (const item of raw) {
    const vector = finiteVector(item, resolvedDim);
    if (vector === null) return failure("invalid", "向量服务返回了无效向量");
    if (resolvedDim === -1) resolvedDim = vector.length;
    vectors.push(vector);
  }
  if (resolvedDim <= 0) return failure("invalid", "向量服务返回了空向量");

  if (requestedModel !== "" && responseModel !== "" && responseModel !== requestedModel) {
    // 不同模型的向量不能混在一个索引里比较
    return failure(
      "invalid",
      `向量模型与配置不一致（期望 ${requestedModel}，实际 ${responseModel}）`,
    );
  }

  return {
    ok: true,
    model: responseModel !== "" ? responseModel : requestedModel,
    dim: resolvedDim,
    vectors,
  };
}

async function requestBatch(
  texts: readonly string[],
  requestedModel: string,
  options: EmbedTextsOptions,
): Promise<EmbedTextsOutcome> {
  const timeoutMs = options.timeoutMs ?? EMBEDDINGS_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const res = await fetch(EMBEDDINGS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
      signal,
    });

    if (res.status === 404 || res.status === 503) {
      const detail = await errorDetail(res);
      return failure(
        "unavailable",
        detail !== "" ? detail : "服务端没有可用的向量化配置",
        res.status,
      );
    }
    if (res.status === 401) {
      return failure("unauthorized", "请先登录后再使用语义检索", 401);
    }
    if (!res.ok) {
      const detail = await errorDetail(res);
      return failure("http", detail !== "" ? detail : `向量化失败（HTTP ${res.status}）`, res.status);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return failure("invalid", "向量服务返回了无法解析的数据");
    }
    return parseBatch(json, texts.length, requestedModel);
  } catch (err) {
    if (isAbortError(err)) {
      if (options.signal?.aborted) return failure("aborted", "向量化已取消");
      return failure("network", `向量化超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    return failure("network", `向量化请求失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── 对外入口 ──────────────────────────────────────────────────────

/**
 * 批量向量化。输入超过 64 条时按 64 条分批顺序请求；
 * 任何一批失败都整次返回失败（保持 vectors 与 texts 一一对应）。
 */
export async function embedTexts(
  texts: readonly string[],
  options: EmbedTextsOptions = {},
): Promise<EmbedTextsOutcome> {
  const requestedModel = (options.model ?? "").trim();
  const inputs = texts.map((text) => text.trim());

  if (inputs.length === 0) {
    return { ok: true, model: requestedModel, dim: 0, vectors: [] };
  }
  if (inputs.some((text) => text === "")) {
    return failure("invalid", "嵌入文本不能为空");
  }

  const keys = inputs.map((text) => cacheKey(requestedModel, text));
  const slots: (readonly number[] | undefined)[] = new Array(inputs.length).fill(undefined);
  const missing: number[] = [];
  inputs.forEach((_text, index) => {
    const hit = cache.get(keys[index]);
    if (hit !== undefined) slots[index] = hit;
    else missing.push(index);
  });

  let dim = -1;
  let resolvedModel = requestedModel;

  const fill = async (indexes: readonly number[]): Promise<EmbedTextsOutcome | null> => {
    for (let start = 0; start < indexes.length; start += EMBEDDINGS_BATCH_SIZE) {
      const slice = indexes.slice(start, start + EMBEDDINGS_BATCH_SIZE);
      const outcome = await requestBatch(
        slice.map((index) => inputs[index]),
        requestedModel,
        options,
      );
      if (!outcome.ok) return outcome;

      if (dim === -1) dim = outcome.dim;
      else if (outcome.dim !== dim) return failure("invalid", "不同批次的向量维度不一致");
      resolvedModel = outcome.model;

      slice.forEach((index, offset) => {
        const vector = outcome.vectors[offset];
        slots[index] = vector;
        remember(keys[index], vector);
      });
    }
    return null;
  };

  const failed = await fill(missing);
  if (failed !== null) return failed;

  if (dim === -1) {
    // 全部命中缓存：维度以缓存为准；缓存条目互相不一致说明被污染了
    const dims = new Set(slots.map((vector) => vector?.length ?? 0));
    if (dims.size > 1) return failure("invalid", "缓存中的向量维度不一致");
    dim = slots[0]?.length ?? 0;
  }

  /*
   * 维度统一：与本次维度不符的缓存视为污染（模型同名但换了供应商/维度）。
   * 丢掉后补一轮，避免坏向量长期占据缓存键。
   */
  const stale: number[] = [];
  slots.forEach((vector, index) => {
    if (vector !== undefined && vector.length !== dim) {
      cache.delete(keys[index]);
      slots[index] = undefined;
      stale.push(index);
    }
  });
  if (stale.length > 0) {
    const refill = await fill(stale);
    if (refill !== null) return refill;
  }

  const vectors: (readonly number[])[] = [];
  for (const slot of slots) {
    if (slot === undefined) return failure("invalid", "向量结果不完整");
    vectors.push(slot);
  }

  return { ok: true, model: resolvedModel, dim, vectors };
}

/** 从统一结果里取「给缓存/检索用」的向量表；失败返回 null。 */
export function embedResultOf(outcome: EmbedTextsOutcome): EmbeddingResult | null {
  return outcome.ok
    ? { model: outcome.model, dim: outcome.dim, vectors: outcome.vectors }
    : null;
}
