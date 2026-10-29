/**
 * 服务端批量向量化。
 *
 * 解析顺序（先到先得，全部缺省则返回 null，调用方退回 BM25）：
 * 1. ALP_EMBED_BASE_URL / ALP_EMBED_API_KEY / ALP_EMBED_MODEL 三项齐全；
 * 2. llm 行 options.embeddingBaseUrl + payload.embeddingApiKey + options.embeddingModel
 *    （允许「DeepSeek 当聊天、阿里云当向量」这种跨供应商组合）；
 * 3. llm 行同源：options.baseUrl + payload.apiKey + options.embeddingModel；
 * 4. null。
 *
 * 「没配 embedding」是正常状态，不是错误：任何失败（未配置、SSRF 拒绝、上游超时、
 * 维度不一致、非有限数）都返回 null，由 /api/embeddings 统一回 503，客户端继续
 * 走 BM25。绝不能把坏向量写进索引——维度错了不会报错，只会让排序永远错下去。
 */

import {
  assertUpstreamAllowed,
  guardedRequest,
} from "@/lib/ssrfGuard";
import { loadLlmConfigForUser } from "@/lib/upstream";

export const EMBEDDING_TIMEOUT_MS = 20_000;
/** 64 条 × 4096 维的 JSON 浮点大约 5MB，留三倍余量。 */
export const EMBEDDING_MAX_BYTES = 16 * 1024 * 1024;

export interface EmbeddingResult {
  readonly model: string;
  readonly dim: number;
  readonly vectors: readonly (readonly number[])[];
}

interface EmbeddingSource {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/**
 * 按四级顺序解析向量化端点。读配置失败（含未配置）一律 null；
 * 只有非 LlmConfigError 的意外（例如数据库驱动抛错）也吞掉——调用方只关心能不能用。
 */
async function resolveSource(userId: string): Promise<EmbeddingSource | null> {
  const baseUrl = (process.env.ALP_EMBED_BASE_URL ?? "").trim();
  const apiKey = (process.env.ALP_EMBED_API_KEY ?? "").trim();
  const model = (process.env.ALP_EMBED_MODEL ?? "").trim();
  if (baseUrl !== "" && apiKey !== "" && model !== "") {
    return { baseUrl, apiKey, model };
  }

  try {
    const config = await loadLlmConfigForUser(userId);
    const embeddingBaseUrl = config.options.embeddingBaseUrl;
    const embeddingModel = config.options.embeddingModel;
    if (
      embeddingBaseUrl !== undefined &&
      embeddingModel !== undefined &&
      config.payload.embeddingApiKey !== undefined
    ) {
      return {
        baseUrl: embeddingBaseUrl,
        apiKey: config.payload.embeddingApiKey,
        model: embeddingModel,
      };
    }
    if (embeddingModel !== undefined) {
      return {
        baseUrl: config.options.baseUrl,
        apiKey: config.payload.apiKey,
        model: embeddingModel,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 批量向量化。成功时 vectors 与 texts 一一对应且维度一致；
 * 任何一步失败都返回 null，不抛。
 */
export async function embedTextsForUser(
  userId: string,
  texts: readonly string[],
  signal?: AbortSignal,
): Promise<EmbeddingResult | null> {
  if (texts.length === 0) return null;

  try {
    const source = await resolveSource(userId);
    if (source === null) return null;

    const endpoint = `${source.baseUrl.trim().replace(/\/+$/, "")}/embeddings`;
    const target = await assertUpstreamAllowed(endpoint);
    const response = await guardedRequest(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${source.apiKey}`,
      },
      body: JSON.stringify({ model: source.model, input: texts }),
      timeoutMs: EMBEDDING_TIMEOUT_MS,
      maxBytes: EMBEDDING_MAX_BYTES,
      signal,
    });

    if (response.status < 200 || response.status >= 300) return null;

    let json: unknown;
    try {
      json = JSON.parse(response.body.toString("utf8"));
    } catch {
      return null;
    }

    return parseEmbeddingResponse(json, texts.length, source.model);
  } catch {
    // 网络、DNS、SSRF、解析——对调用方都是「这次没有向量」
    return null;
  }
}

/**
 * 校验 OpenAI 兼容的 /embeddings 响应。
 * data 顺序即输入顺序；长度必须正好等于请求条数，否则宁可整批丢弃。
 */
function parseEmbeddingResponse(
  json: unknown,
  expected: number,
  requestedModel: string,
): EmbeddingResult | null {
  if (typeof json !== "object" || json === null) return null;
  const record = json as Record<string, unknown>;

  const data = record["data"];
  if (!Array.isArray(data) || data.length !== expected) return null;

  const vectors: number[][] = [];
  let dim = -1;

  for (const item of data) {
    if (typeof item !== "object" || item === null) return null;
    const embedding = (item as Record<string, unknown>)["embedding"];
    if (!Array.isArray(embedding) || embedding.length === 0) return null;
    if (dim === -1) dim = embedding.length;
    else if (embedding.length !== dim) return null;

    const vector: number[] = [];
    for (const value of embedding) {
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      vector.push(value);
    }
    vectors.push(vector);
  }

  if (dim <= 0) return null;

  const model =
    typeof record["model"] === "string" && record["model"] !== ""
      ? record["model"]
      : requestedModel;

  return { model, dim, vectors };
}
