/**
 * HTTP 请求体的唯一契约来源。
 *
 * wave 2 的路由与 wave 3 的客户端都从这里 import，不得再各自写一份请求体或校验。
 * 本文件只定义请求体与错误码；响应形状由各路由决定，但任何响应都不许出现明文密钥。
 *
 * 全文件 strictObject：未知字段一律拒绝。这不是风格偏好，而是安全边界的一部分——
 * 如果 /api/llm/chat 能接受 baseUrl / apiKey / model，就等于告诉客户端「密钥应该随请求走」，
 * 迟早有人把它写进 URL、日志或前端状态。密钥只出现在 configPut 里。
 */

import { z } from "zod";

import {
  MAX_DIRECTION_CHUNKS,
  MAX_FILE_BYTES,
  MAX_FILE_CHARS,
  MAX_PDF_PAGES,
  type UploadChunk,
  type UploadDoc,
} from "@/lib/knowledge";
import {
  MAX_CORRECTION_CHARS,
  MAX_MEMORIES,
  MAX_PROMPT_CHARS,
  type MemoryItem,
} from "@/lib/memory";
import type { ProviderKind, ThinkingStatus } from "@/lib/provider";
import type { ThinkingStrength } from "@/lib/reasoning";
import {
  RATE_MAX,
  RATE_MIN,
  SPEECH_MAX_CHARS,
  type TtsConfig,
  type TtsEngine,
} from "@/lib/tts";
import { MAX_SEARCH_QUERY_CHARS, type WebProvider } from "@/lib/websearch";

// ── 共用原子 ──────────────────────────────────────────────────────

/** 客户端生成的实体 id：doc-<uuid>、<docId>:<序号>、方向 uuid 都落在这个字符集里。 */
const entityId = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u, "id 只能由字母、数字与 . _ : - 组成");

/** 学科 id 是 data/subjects 里的 slug，会进存储键与 URL，必须是安全字符。 */
const subjectId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/u, "学科 id 必须是 slug");

/** ISO 8601；项目里 createdAt / lastSeenAt 均由 new Date().toISOString() 生成。 */
const timestamp = z.iso.datetime();

/**
 * http(s) 地址。协议白名单只做到这里：
 * 服务端代发还要在代理层做 DNS 解析与私有网段拦截（SSRF），
 * 而浏览器直连模式允许 http://localhost，所以不能在这里只放 https。
 */
const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);

/** 密钥原文不 trim：首尾有空格说明用户粘错了，应在设置页提示，而不是在这里悄悄修正。 */
const secret = z.string().min(1).max(4096);

const PROVIDER_KINDS = ["openai-compatible", "anthropic"] as const satisfies readonly ProviderKind[];
const THINKING_STRENGTHS = ["off", "standard", "deep"] as const satisfies readonly ThinkingStrength[];
/**
 * 服务端代发的调用用途。服务端据此决定思考档：
 * tutor 与缺省沿用账号配置，items/verify/direction 强制关闭思考——
 * 出题、批解、核对都是「一次拿到完整 JSON」的调用，思考 token 会把预算吃光。
 */
export const CHAT_PURPOSES = ["tutor", "items", "verify", "direction"] as const;
export type ChatPurpose = (typeof CHAT_PURPOSES)[number];
const THINKING_STATUSES = [
  "unknown",
  "verified",
  "verified-empty",
  "unsupported",
] as const satisfies readonly ThinkingStatus[];
const TTS_ENGINES = ["browser", "openai-compatible"] as const satisfies readonly TtsEngine[];

// ── PUT /api/config ───────────────────────────────────────────────

/** configPut 的判别值，也是 /api/config/[provider] 的路径段。 */
export const CONFIG_PROVIDERS = ["llm", "search-deepseek", "search-tavily", "tts"] as const;
export type ConfigProvider = (typeof CONFIG_PROVIDERS)[number];

/**
 * 文本模型配置。服务端代发时 baseUrl / apiKey / model 都从这里读，
 * 因此它们永远不进入 llmChat。
 */
export const llmConfigPut = z.strictObject({
  provider: z.literal("llm"),
  label: z.string().trim().min(1).max(60).optional(),
  kind: z.enum(PROVIDER_KINDS),
  baseUrl: httpUrl,
  apiKey: secret,
  model: z.string().trim().min(1).max(120),
  /** 额外请求头，JSON 字符串；形状由代理层解析并限制键名。 */
  extraHeaders: z.string().max(2000).optional(),
  thinking: z.enum(THINKING_STRENGTHS).optional(),
  thinkingStatus: z.enum(THINKING_STATUSES).optional(),
  verification: z.boolean().optional(),
  /** 向量模型单独配置时用；三项都缺省表示不做向量检索，只走 BM25。 */
  embeddingBaseUrl: httpUrl.optional(),
  embeddingModel: z.string().trim().min(1).max(120).optional(),
  /** 缺省表示复用 llm 的 apiKey。 */
  embeddingApiKey: secret.optional(),
});

/** DeepSeek 官方搜索密钥单独存一行：它和文本模型的 key 可以不是同一个账号。 */
export const searchDeepseekConfigPut = z.strictObject({
  provider: z.literal("search-deepseek"),
  apiKey: secret,
  /** 允许改地址以便走自建中转；固定端点见旧方案 https://api.deepseek.com/v1/tools/search。 */
  baseUrl: httpUrl.optional(),
});

export const searchTavilyConfigPut = z.strictObject({
  provider: z.literal("search-tavily"),
  apiKey: secret,
});

/**
 * TTS 配置。protocol 区分两种线上协议：
 * - speech：POST {baseUrl}/audio/speech（OpenAI 兼容）
 * - chat-audio：POST {baseUrl}/chat/completions + modalities:["audio"]（小米 mimo，
 *   实测其 /audio/speech 返回 404，必须走 chat 接口的音频输出）
 * engine 区分「用浏览器语音」与「用线上供应商」；browser 时 baseUrl / apiKey 无意义。
 */
export const ttsConfigPut = z.strictObject({
  provider: z.literal("tts"),
  engine: z.enum(TTS_ENGINES),
  protocol: z.enum(["speech", "chat-audio"]).default("speech"),
  rate: z.number().min(RATE_MIN).max(RATE_MAX).default(1),
  browserVoice: z.string().trim().min(1).max(120).optional(),
  baseUrl: httpUrl.optional(),
  apiKey: secret.optional(),
  model: z.string().trim().min(1).max(120).optional(),
  voice: z.string().trim().min(1).max(120).optional(),
});

export const configPut = z.discriminatedUnion("provider", [
  llmConfigPut,
  searchDeepseekConfigPut,
  searchTavilyConfigPut,
  ttsConfigPut,
]);

export type ConfigPut = z.infer<typeof configPut>;
export type LlmConfig = z.infer<typeof llmConfigPut>;
export type SearchDeepseekConfig = z.infer<typeof searchDeepseekConfigPut>;
export type SearchTavilyConfig = z.infer<typeof searchTavilyConfigPut>;
export type TtsConfigPut = z.infer<typeof ttsConfigPut>;

// ── POST /api/llm/chat ────────────────────────────────────────────

/**
 * 单条消息的正文上限。导师提示词含教材摘录（≤2400 字）与上传资料（3×500 字），
 * 16k 足够宽裕；再大说明调用方把整份文档塞进来了。
 */
export const CHAT_MESSAGE_MAX_CHARS = 16_000;

export const chatMessage = z.strictObject({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(CHAT_MESSAGE_MAX_CHARS),
});

/**
 * 服务端代发的对话请求。
 *
 * 刻意没有 baseUrl / apiKey / model，也没有 provider 选择：这些一律来自
 * 当前登录用户在 /api/config 保存的 llm 配置。请求体里出现它们就说明客户端越界了。
 */
export const llmChat = z.strictObject({
  messages: z.array(chatMessage).min(1).max(50),
  temperature: z.number().min(0).max(2).optional(),
  /** 只防跑飞，真实上限由供应商决定。 */
  maxTokens: z.number().int().min(1).max(32_000).optional(),
  /** 缺省按流式（SSE）返回；出题、核对等一次性调用显式传 false。 */
  stream: z.boolean().default(true),
  /**
   * 调用用途。缺省时服务端沿用账号保存的思考档（旧客户端的既有行为）；
   * 显式给出 items/verify/direction 时服务端关闭思考，避免 JSON 输出被推理吃光。
   */
  purpose: z.enum(CHAT_PURPOSES).optional(),
  /**
   * 要求上游返回 JSON 对象（OpenAI 兼容协议写 response_format）。
   * 缺省 false，与本轮之前的请求体完全一致。
   */
  jsonMode: z.boolean().default(false),
});

export type ChatMessage = z.infer<typeof chatMessage>;
export type LlmChat = z.infer<typeof llmChat>;

// ── POST /api/embeddings ──────────────────────────────────────────

export const EMBEDDINGS_MAX_TEXTS = 64;
export const EMBEDDINGS_MAX_TEXT_CHARS = 8000;

/** 批量向量化。模型与地址来自 llm 配置里的 embedding* 三项，请求体不携带。 */
export const embeddings = z.strictObject({
  texts: z
    .array(z.string().trim().min(1).max(EMBEDDINGS_MAX_TEXT_CHARS))
    .min(1)
    .max(EMBEDDINGS_MAX_TEXTS),
});

export type Embeddings = z.infer<typeof embeddings>;

// ── POST /api/search ──────────────────────────────────────────────

/**
 * 三家搜索供应商。新增供应商必须同时改这里与 /api/search 的分支，
 * 否则穷尽 switch 的 never 检查会编译失败。
 */
export const SEARCH_PROVIDERS = ["deepseek", "tavily", "wikipedia"] as const satisfies readonly WebProvider[];
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

/**
 * 搜索代理请求。供应商必须显式指定，不做「自动回退」——回退顺序属于服务端策略，
 * 由响应里的实际 provider 告知客户端；请求体里写死一个才能在失败时报清是谁失败。
 */
export const search = z.strictObject({
  provider: z.enum(SEARCH_PROVIDERS),
  query: z.string().trim().min(1).max(MAX_SEARCH_QUERY_CHARS),
});

export type SearchRequest = z.infer<typeof search>;

// ── POST /api/tts ─────────────────────────────────────────────────

/** 朗读请求。音色、模型、端点都来自 tts 配置，请求体只带要读的正文。 */
export const tts = z.strictObject({
  text: z.string().trim().min(1).max(SPEECH_MAX_CHARS),
});

export type TtsRequest = z.infer<typeof tts>;

// ── PUT /api/kb ───────────────────────────────────────────────────

/** 单块正文上限。正常切块 ≤ CHUNK_SIZE(500)，8000 只为挡住异常大的包。 */
const MAX_CHUNK_SYNC_CHARS = 8000;

/** 向量维度上限；常见 embedding 模型在 768–3072 之间。 */
export const MAX_EMBEDDING_DIM = 4096;

export const kbDoc = z.strictObject({
  id: entityId,
  directionId: entityId,
  /** 允许空串：展示名回退到 fileName / id 是 knowledge.ts 已有行为。 */
  title: z.string().trim().max(200),
  fileName: z.string().trim().min(1).max(255),
  kind: z.enum(["md", "txt", "pdf"]),
  size: z.number().int().min(0).max(MAX_FILE_BYTES),
  pageCount: z.number().int().min(1).max(MAX_PDF_PAGES).optional(),
  charCount: z.number().int().min(0).max(MAX_FILE_CHARS),
  chunkCount: z.number().int().min(0).max(MAX_DIRECTION_CHUNKS),
  kcIds: z.array(z.string().trim().min(1).max(120)).max(200),
  createdAt: timestamp,
  /**
   * 同步版本号（Unix 毫秒）。用数字而不是 ISO 串：CAS 的相等比较不该依赖格式化，
   * 两台设备也不可能把同一个毫秒写成两种字符串。本地新建的文档没有这个字段。
   */
  updatedAt: z.number().int().min(0).optional(),
});

export type KbDocInput = z.infer<typeof kbDoc>;

export const kbChunk = z
  .strictObject({
    id: entityId,
    docId: entityId,
    directionId: entityId,
    title: z.string().trim().max(200),
    section: z.string().trim().max(200),
    pageFrom: z.number().int().min(1).max(MAX_PDF_PAGES).optional(),
    pageTo: z.number().int().min(1).max(MAX_PDF_PAGES).optional(),
    text: z
      .string()
      .max(MAX_CHUNK_SYNC_CHARS)
      .refine((value) => value.trim() !== "", "片段正文不能为空"),
    index: z.number().int().min(0).max(MAX_DIRECTION_CHUNKS - 1),
    /** 可选：没配 embedding 能力时不写这三个字段，检索自动退化为 BM25。 */
    embedding: z.array(z.number().finite()).min(1).max(MAX_EMBEDDING_DIM).optional(),
    embeddingModel: z.string().trim().min(1).max(120).optional(),
    embeddingDim: z.number().int().min(1).max(MAX_EMBEDDING_DIM).optional(),
  })
  .superRefine((chunk, ctx) => {
    if (chunk.embedding === undefined) {
      if (chunk.embeddingModel !== undefined || chunk.embeddingDim !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["embeddingModel"],
          message: "没有 embedding 时不应带 embeddingModel / embeddingDim",
        });
      }
      return;
    }
    if (chunk.embeddingModel === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["embeddingModel"],
        message: "带向量时必须记录 embeddingModel",
      });
    }
    if (chunk.embeddingDim === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["embeddingDim"],
        message: "带向量时必须记录 embeddingDim",
      });
    } else if (chunk.embeddingDim !== chunk.embedding.length) {
      ctx.addIssue({
        code: "custom",
        path: ["embeddingDim"],
        message: "embeddingDim 必须等于向量长度",
      });
    }
  });

export type KbChunkInput = z.infer<typeof kbChunk>;

/**
 * 整篇文档 + 全部片段的写入。
 *
 * baseUpdatedAt 是乐观并发的前置条件：客户端最后读到的 doc.updatedAt，
 * 新建传 null。服务端只在当前值严格相等时写入，否则返回 409 conflict；
 * 这条规则让「两台设备同时改同一份文档」有确定结果，而不是后写者悄悄覆盖。
 */
export const kbPut = z.strictObject({
  doc: kbDoc,
  chunks: z.array(kbChunk).min(1).max(MAX_DIRECTION_CHUNKS),
  baseUpdatedAt: z.number().int().min(0).nullable(),
});

export type KbPut = z.infer<typeof kbPut>;

// ── POST /api/kb/query ────────────────────────────────────────────

export const KB_QUERY_DEFAULT_LIMIT = 50;
export const KB_QUERY_MAX_LIMIT = 200;

/**
 * 知识库读取。directionId 与 docId 二选一：前者按方向列文档，后者列单篇片段。
 *
 * vectors 省略表示只用 BM25——这是没配 embedding 时的降级路径，不是错误；
 * 传了才会做向量召回并与 BM25 用 RRF 融合。空数组没有意义，会被拒绝。
 * after 是上一次响应给的游标（按 updatedAt / index 升序），省略表示从头。
 */
export const kbQuery = z
  .strictObject({
    directionId: entityId.optional(),
    docId: entityId.optional(),
    vectors: z
      .array(z.array(z.number().finite()).min(1).max(MAX_EMBEDDING_DIM))
      .min(1)
      .max(8)
      .optional(),
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(KB_QUERY_MAX_LIMIT).default(KB_QUERY_DEFAULT_LIMIT),
  })
  .refine((value) => (value.directionId === undefined) !== (value.docId === undefined), {
    message: "directionId 与 docId 必须且只能提供一个",
    path: ["directionId"],
  });

export type KbQuery = z.infer<typeof kbQuery>;

// ── PUT /api/memories ─────────────────────────────────────────────

/**
 * 一张记忆卡。kind 与字段的对应关系必须与 memory.ts 的 parseMemories 一致：
 * 错题卡必须带 questionId，易混卡必须带 withKcId；否则服务端存下去也会在读取时被丢掉。
 */
export const memoryItem = z
  .strictObject({
    id: entityId,
    kind: z.enum(["error", "confusion"]),
    kcId: z.string().trim().min(1).max(120),
    withKcId: z.string().trim().min(1).max(120).optional(),
    questionId: z.string().trim().min(1).max(160).optional(),
    prompt: z.string().min(1).max(MAX_PROMPT_CHARS),
    chosen: z.string().max(2000).optional(),
    /** 易混卡的 correction 允许空串（ConfusionMemoryInput 的默认值）。 */
    correction: z.string().max(MAX_CORRECTION_CHARS),
    note: z.string().max(2000).optional(),
    createdAt: timestamp,
    lastSeenAt: timestamp,
    status: z.enum(["open", "resolved"]),
    resolvedAt: timestamp.optional(),
    streak: z.number().int().min(0).max(4),
    reviewCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((item, ctx) => {
    if (item.kind === "error" && item.questionId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["questionId"],
        message: "错题卡必须带 questionId",
      });
    }
    if (item.kind === "confusion" && item.withKcId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["withKcId"],
        message: "易混卡必须带 withKcId",
      });
    }
  });

export type MemoryItemInput = z.infer<typeof memoryItem>;

/**
 * 整科记忆卡快照。memories 是该学科的全量列表（允许为空，表示清空）；
 * 服务端不做「按 id 增删」的增量协议，避免两台设备各删各的却都以为成功。
 * 重复 id 直接拒绝：一份快照里同一张卡出现两次，合并结果无从解释。
 */
export const memoriesPut = z
  .strictObject({
    subjectId,
    memories: z.array(memoryItem).max(MAX_MEMORIES),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.memories.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["memories", index, "id"],
          message: `记忆卡 id 重复：${item.id}`,
        });
      }
      seen.add(item.id);
    });
  });

export type MemoriesPut = z.infer<typeof memoriesPut>;

// ── 错误码 ────────────────────────────────────────────────────────

/**
 * 所有 API 错误码。值直接出现在响应体的 error.code 里，客户端按它分支；
 * 改动任何一个字符串都算破坏兼容，测试里有一份写死的稳定性断言。
 */
export const apiErrorCodes = {
  /** 请求体不符合本文件的 schema。 */
  badRequest: "bad_request",
  /** 未登录；需要密钥或需要写库的路由一律 401，且不写任何数据。 */
  unauthorized: "unauthorized",
  /** 登录了，但资源不属于当前用户。 */
  forbidden: "forbidden",
  notFound: "not_found",
  /** baseUpdatedAt 与库中版本不一致（含「以为不存在，其实已存在」）。 */
  conflict: "conflict",
  payloadTooLarge: "payload_too_large",
  /** 该供应商还没配置；这是「去设置页填一下」，不是上游故障。 */
  providerNotConfigured: "provider_not_configured",
  providerError: "provider_error",
  providerTimeout: "provider_timeout",
  /** 所有搜索供应商都失败（含未配置与上游错误），响应里带逐家原因。 */
  searchExhausted: "search_exhausted",
  /** TTS 未配置或合成失败；客户端应回退浏览器语音。 */
  ttsUnavailable: "tts_unavailable",
  /** 服务端缺少 ALP_SECRET_KEY，拒绝保存密钥而不是明文落库。 */
  secretKeyMissing: "secret_key_missing",
  rateLimited: "rate_limited",
  internal: "internal",
} as const;

export type ApiErrorCode = (typeof apiErrorCodes)[keyof typeof apiErrorCodes];

/**
 * 全部错误码，顺序与声明顺序一致。
 * z.enum 需要非空元组；对象字面量保证至少一项，因此这里的断言不会落空。
 */
export const API_ERROR_CODES = Object.freeze(
  Object.values(apiErrorCodes) as [ApiErrorCode, ...ApiErrorCode[]],
);

/** 错误码 → HTTP 状态码。漏写一个新错误码会让 satisfies 编译失败。 */
export const apiErrorStatus = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  provider_not_configured: 409,
  provider_error: 502,
  provider_timeout: 504,
  search_exhausted: 502,
  tts_unavailable: 503,
  secret_key_missing: 500,
  rate_limited: 429,
  internal: 500,
} as const satisfies Record<ApiErrorCode, number>;

/** 统一的错误响应体。message 是可直接展示的中文短句，不含密钥与上游原始体。 */
export const apiErrorBody = z.strictObject({
  error: z.strictObject({
    code: z.enum(API_ERROR_CODES),
    message: z.string().trim().min(1).max(500),
    /** 便于把浏览器报错与服务端日志对上；不含任何用户数据。 */
    requestId: z.string().trim().min(1).max(120).optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof apiErrorBody>;

// ── 与领域类型的编译期对齐 ────────────────────────────────────────

/**
 * 只在类型层使用：断言契约的输出能赋值给领域接口。
 * knowledge.ts / memory.ts / tts.ts 以后加必填字段而这里没跟上时，编译直接失败。
 */
type AssignableTo<Base, T extends Base> = T;

export type KbDocContractCheck = AssignableTo<UploadDoc, z.infer<typeof kbDoc>>;
export type KbChunkContractCheck = AssignableTo<UploadChunk, z.infer<typeof kbChunk>>;
export type MemoryItemContractCheck = AssignableTo<MemoryItem, z.infer<typeof memoryItem>>;
export type TtsConfigContractCheck = AssignableTo<TtsConfig, z.infer<typeof ttsConfigPut>>;
/** websearch.ts 新增供应商而这里没跟上时编译失败，避免 /api/search 漏分支。 */
export type SearchProviderContractCheck = AssignableTo<WebProvider, SearchProvider>;
