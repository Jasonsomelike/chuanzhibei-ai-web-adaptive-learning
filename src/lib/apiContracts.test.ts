/**
 * apiContracts 的契约测试。
 *
 * 这里的断言是「别的波次可以照着依赖」的那部分：合法样例必须过，
 * 越界字段（尤其是密钥与模型名）必须被拒绝，边界数字必须写死在这里，
 * 这样常量被顺手改大时测试会先响。
 */

import { describe, expect, it } from "vitest";

import {
  API_ERROR_CODES,
  CONFIG_PROVIDERS,
  apiErrorBody,
  apiErrorCodes,
  apiErrorStatus,
  configPut,
  embeddings,
  kbPut,
  kbQuery,
  llmChat,
  memoriesPut,
  search,
  tts,
} from "@/lib/apiContracts";
import { MAX_DIRECTION_CHUNKS } from "@/lib/knowledge";

interface SafeParse {
  safeParse(value: unknown): { success: boolean };
}

function accepts(schema: SafeParse, value: unknown): boolean {
  return schema.safeParse(value).success;
}

const TS = "2026-10-29T08:00:00.000Z";

const DOC = {
  id: "doc-6f1c",
  directionId: "dir-1",
  title: "数据结构讲义",
  fileName: "数据结构讲义.pdf",
  kind: "pdf",
  size: 1024,
  pageCount: 3,
  charCount: 900,
  chunkCount: 1,
  kcIds: ["ds01"],
  createdAt: TS,
};

const CHUNK = {
  id: "doc-6f1c:0",
  docId: "doc-6f1c",
  directionId: "dir-1",
  title: "数据结构讲义",
  section: "第1页",
  text: "数组是一段连续内存，按下标计算地址的时间复杂度是 O(1)。",
  index: 0,
};

const KB_PUT = { doc: DOC, chunks: [CHUNK], baseUpdatedAt: null };

const CHAT = { messages: [{ role: "user", content: "什么是数组？" }] };

const LLM_CONFIG = {
  provider: "llm",
  kind: "openai-compatible",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-test",
  model: "deepseek-chat",
};

const ERROR_CARD = {
  id: "mem-error-q1",
  kind: "error",
  kcId: "ds01",
  questionId: "q1",
  prompt: "数组随机访问的时间复杂度？",
  chosen: "O(n)",
  correction: "O(1)：下标直接计算地址。",
  createdAt: TS,
  lastSeenAt: TS,
  status: "open",
  streak: 0,
  reviewCount: 1,
};

const CONFUSION_CARD = {
  id: "mem-conf-ds01-ds02",
  kind: "confusion",
  kcId: "ds01",
  withKcId: "ds02",
  prompt: "数组与链表的区别",
  correction: "",
  createdAt: TS,
  lastSeenAt: TS,
  status: "resolved",
  resolvedAt: TS,
  streak: 4,
  reviewCount: 3,
};

// ── 错误码 ────────────────────────────────────────────────────────

describe("apiErrorCodes", () => {
  it("错误码集合稳定（改动即破坏兼容）", () => {
    expect([...API_ERROR_CODES].sort()).toEqual([
      "bad_request",
      "conflict",
      "forbidden",
      "internal",
      "not_found",
      "payload_too_large",
      "provider_error",
      "provider_not_configured",
      "provider_timeout",
      "rate_limited",
      "search_exhausted",
      "secret_key_missing",
      "tts_unavailable",
      "unauthorized",
    ]);
  });

  it("对象与列表一一对应且没有重复值", () => {
    expect(Object.values(apiErrorCodes)).toEqual([...API_ERROR_CODES]);
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });

  it("每个错误码都有 4xx/5xx 状态码", () => {
    for (const code of API_ERROR_CODES) {
      expect(apiErrorStatus[code]).toBeGreaterThanOrEqual(400);
      expect(apiErrorStatus[code]).toBeLessThan(600);
    }
  });

  it("接受合法错误响应体", () => {
    expect(
      accepts(apiErrorBody, {
        error: { code: "conflict", message: "文档已被其它设备修改，请刷新后重试", requestId: "r-1" },
      }),
    ).toBe(true);
  });

  it("拒绝未知错误码、缺 message 与多余字段", () => {
    expect(accepts(apiErrorBody, { error: { code: "boom", message: "x" } })).toBe(false);
    expect(accepts(apiErrorBody, { error: { code: "conflict" } })).toBe(false);
    expect(accepts(apiErrorBody, { error: { code: "conflict", message: "x", detail: "y" } })).toBe(
      false,
    );
  });
});

// ── configPut ─────────────────────────────────────────────────────

describe("configPut", () => {
  it("接受最小 llm 配置", () => {
    expect(accepts(configPut, LLM_CONFIG)).toBe(true);
  });

  it("llm 分支支持 embeddingBaseUrl / embeddingModel / embeddingApiKey", () => {
    const parsed = configPut.parse({
      ...LLM_CONFIG,
      embeddingBaseUrl: "https://api.openai.com/v1",
      embeddingModel: "text-embedding-3-small",
      embeddingApiKey: "sk-embedding",
    });
    expect(parsed.provider).toBe("llm");
    if (parsed.provider !== "llm") throw new Error("判别失败");
    expect(parsed.embeddingBaseUrl).toBe("https://api.openai.com/v1");
    expect(parsed.embeddingModel).toBe("text-embedding-3-small");
    expect(parsed.embeddingApiKey).toBe("sk-embedding");
  });

  it("llm 的 embedding 三项都可省略（只走 BM25）", () => {
    const parsed = configPut.parse(LLM_CONFIG);
    if (parsed.provider !== "llm") throw new Error("判别失败");
    expect(parsed.embeddingModel).toBeUndefined();
  });

  it("拒绝 llm 缺少 apiKey / baseUrl / model", () => {
    for (const field of ["apiKey", "baseUrl", "model"]) {
      const sample: Record<string, unknown> = { ...LLM_CONFIG };
      delete sample[field];
      expect(accepts(configPut, sample)).toBe(false);
    }
  });

  it("拒绝未知 kind、非 http(s) 地址与越界字段", () => {
    expect(accepts(configPut, { ...LLM_CONFIG, kind: "openai" })).toBe(false);
    expect(accepts(configPut, { ...LLM_CONFIG, baseUrl: "ftp://example.com/v1" })).toBe(false);
    expect(accepts(configPut, { ...LLM_CONFIG, baseUrl: "不是地址" })).toBe(false);
    expect(accepts(configPut, { ...LLM_CONFIG, endpoint: "https://example.com" })).toBe(false);
    expect(accepts(configPut, { ...LLM_CONFIG, embeddingBaseUrl: "ws://example.com" })).toBe(false);
  });

  it("接受 search-deepseek 与 search-tavily 两个独立密钥槽", () => {
    expect(accepts(configPut, { provider: "search-deepseek", apiKey: "sk-ds" })).toBe(true);
    expect(
      accepts(configPut, {
        provider: "search-deepseek",
        apiKey: "sk-ds",
        baseUrl: "https://proxy.example.com/v1",
      }),
    ).toBe(true);
    expect(accepts(configPut, { provider: "search-tavily", apiKey: "tvly-1" })).toBe(true);
    expect(accepts(configPut, { provider: "search-deepseek" })).toBe(false);
    expect(accepts(configPut, { provider: "search-tavily", apiKey: "tvly-1", baseUrl: "https://x.com" }))
      .toBe(false);
  });

  it("tts 分支默认 speech + rate=1，并接受 mimo 的 chat-audio", () => {
    const browser = configPut.parse({ provider: "tts", engine: "browser" });
    expect(browser.provider).toBe("tts");
    if (browser.provider !== "tts") throw new Error("判别失败");
    expect(browser.protocol).toBe("speech");
    expect(browser.rate).toBe(1);

    const mimo = configPut.parse({
      provider: "tts",
      engine: "openai-compatible",
      protocol: "chat-audio",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-tts",
      model: "mimo",
      voice: "茉莉",
    });
    expect(mimo.provider).toBe("tts");
    if (mimo.provider !== "tts") throw new Error("判别失败");
    expect(mimo.protocol).toBe("chat-audio");
    expect(mimo.voice).toBe("茉莉");
  });

  it("拒绝越界 rate、未知 protocol 与多余字段", () => {
    expect(accepts(configPut, { provider: "tts", engine: "browser", rate: 1.5 })).toBe(false);
    expect(accepts(configPut, { provider: "tts", engine: "browser", rate: 0.5 })).toBe(false);
    expect(accepts(configPut, { provider: "tts", engine: "browser", protocol: "mp3" })).toBe(false);
    expect(accepts(configPut, { provider: "tts", engine: "browser", text: "hi" })).toBe(false);
  });

  it("拒绝未知 provider 与跨分支字段", () => {
    expect(accepts(configPut, { provider: "openai", apiKey: "sk" })).toBe(false);
    // llm 配置里塞 tts 的 text：严格模式必须拒绝。
    expect(accepts(configPut, { ...LLM_CONFIG, text: "读一下" })).toBe(false);
  });

  it("四个判别值都在 CONFIG_PROVIDERS 里", () => {
    const samples = [
      LLM_CONFIG,
      { provider: "search-deepseek", apiKey: "sk-ds" },
      { provider: "search-tavily", apiKey: "tvly-1" },
      { provider: "tts", engine: "browser" },
    ];
    for (const sample of samples) {
      expect(CONFIG_PROVIDERS).toContain(sample.provider);
      expect(accepts(configPut, sample)).toBe(true);
    }
  });
});

// ── llmChat ──────────────────────────────────────────────────────

describe("llmChat", () => {
  it("接受最小对话并默认流式", () => {
    const parsed = llmChat.parse(CHAT);
    expect(parsed.stream).toBe(true);
    expect(parsed.messages).toHaveLength(1);
  });

  it("接受 system / assistant 角色与非流式参数", () => {
    expect(
      accepts(llmChat, {
        messages: [
          { role: "system", content: "你是助教" },
          { role: "user", content: "问题" },
          { role: "assistant", content: "回答" },
        ],
        temperature: 0.3,
        maxTokens: 1024,
        stream: false,
      }),
    ).toBe(true);
  });

  it("拒绝 baseUrl / apiKey / model：它们只能来自 /api/config", () => {
    for (const field of ["baseUrl", "apiKey", "model"]) {
      expect(accepts(llmChat, { ...CHAT, [field]: "x" })).toBe(false);
    }
  });

  it("拒绝 provider / endpoint 等其它多余字段", () => {
    expect(accepts(llmChat, { ...CHAT, provider: "deepseek" })).toBe(false);
    expect(accepts(llmChat, { ...CHAT, headers: {} })).toBe(false);
    // 思考档只能由服务端按 purpose 取，客户端不能直接写字段
    expect(accepts(llmChat, { ...CHAT, thinking: "deep" })).toBe(false);
  });

  it("purpose 只接受四个用途值，缺省为 undefined", () => {
    expect(llmChat.parse(CHAT).purpose).toBeUndefined();
    for (const purpose of ["tutor", "items", "verify", "direction"]) {
      expect(accepts(llmChat, { ...CHAT, purpose })).toBe(true);
    }
    expect(accepts(llmChat, { ...CHAT, purpose: "agent" })).toBe(false);
    expect(accepts(llmChat, { ...CHAT, purpose: "" })).toBe(false);
  });

  it("jsonMode 缺省 false，只接受布尔值", () => {
    expect(llmChat.parse(CHAT).jsonMode).toBe(false);
    expect(accepts(llmChat, { ...CHAT, jsonMode: true })).toBe(true);
    expect(accepts(llmChat, { ...CHAT, jsonMode: false })).toBe(true);
    expect(accepts(llmChat, { ...CHAT, jsonMode: "true" })).toBe(false);
    expect(accepts(llmChat, { ...CHAT, jsonMode: 1 })).toBe(false);
  });

  it("拒绝空消息、未知角色与越界正文", () => {
    expect(accepts(llmChat, { messages: [] })).toBe(false);
    expect(accepts(llmChat, { messages: [{ role: "user", content: "" }] })).toBe(false);
    expect(accepts(llmChat, { messages: [{ role: "tool", content: "x" }] })).toBe(false);
    expect(accepts(llmChat, { messages: [{ role: "developer", content: "x" }] })).toBe(false);
    expect(accepts(llmChat, { messages: [{ role: "user", content: "a".repeat(256_001) }] })).toBe(false);
    expect(accepts(llmChat, { messages: [{ role: "user", content: "a".repeat(256_000) }] })).toBe(true);
  });

  it("content 允许「文本 + 图片」parts，最多 4 段", () => {
    const image = {
      type: "image_url",
      image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
    };
    expect(
      accepts(llmChat, {
        messages: [{ role: "user", content: [{ type: "text", text: "这张图是什么" }, image] }],
      }),
    ).toBe(true);
    expect(
      accepts(llmChat, {
        messages: [
          { role: "user", content: Array.from({ length: 4 }, () => ({ type: "text", text: "x" })) },
        ],
      }),
    ).toBe(true);
    expect(
      accepts(llmChat, {
        messages: [
          { role: "user", content: Array.from({ length: 5 }, () => ({ type: "text", text: "x" })) },
        ],
      }),
    ).toBe(false);
    // 纯图片也可以：前端允许「只贴图不写字」。
    expect(accepts(llmChat, { messages: [{ role: "user", content: [image] }] })).toBe(true);
  });

  it("图片只接受 data:image/(jpeg|png|webp|gif);base64，拒绝 http(s) URL", () => {
    const withUrl = (url: string) => ({
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url } }] }],
    });
    for (const mime of ["jpeg", "png", "webp", "gif"]) {
      expect(accepts(llmChat, withUrl(`data:image/${mime};base64,AAAA`)), mime).toBe(true);
    }
    for (const url of [
      "https://example.com/a.png",
      "http://example.com/a.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,",
      "data:text/html;base64,PHNjcmlwdD4=",
    ]) {
      expect(accepts(llmChat, withUrl(url)), url).toBe(false);
    }
  });

  it("一条消息最多 3 张图片", () => {
    const image = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };
    expect(
      accepts(llmChat, { messages: [{ role: "user", content: [image, image, image] }] }),
    ).toBe(true);
    expect(
      accepts(llmChat, {
        messages: [{ role: "user", content: [image, image, image, { type: "text", text: "x" }] }],
      }),
    ).toBe(true);
    expect(
      accepts(llmChat, {
        messages: [{ role: "user", content: [image, image, image, image] }],
      }),
    ).toBe(false);
  });

  it("assistant 允许 tool_calls（正文可为空），tool 消息必须带 tool_call_id", () => {
    const call = {
      id: "call_1",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"北京"}' },
    };
    expect(
      accepts(llmChat, {
        messages: [{ role: "assistant", content: "", tool_calls: [call] }],
      }),
    ).toBe(true);
    expect(
      accepts(llmChat, {
        messages: [
          { role: "assistant", content: "", tool_calls: [call] },
          { role: "tool", content: "晴", tool_call_id: "call_1" },
        ],
      }),
    ).toBe(true);
    expect(
      accepts(llmChat, {
        messages: [{ role: "tool", content: "晴" }],
      }),
    ).toBe(false);
    // tool_calls 只能出现在 assistant 消息上
    expect(
      accepts(llmChat, {
        messages: [{ role: "user", content: "问", tool_calls: [call] }],
      }),
    ).toBe(false);
    // tool_call_id 也只能出现在 tool 消息上
    expect(
      accepts(llmChat, {
        messages: [{ role: "assistant", content: "答", tool_call_id: "call_1" }],
      }),
    ).toBe(false);
    // 普通 assistant 正文仍不能为空
    expect(accepts(llmChat, { messages: [{ role: "assistant", content: "" }] })).toBe(false);
    expect(
      accepts(llmChat, {
        messages: [{ role: "assistant", content: "x", tool_calls: [{ ...call, type: "other" }] }],
      }),
    ).toBe(false);
  });

  it("接受 tools 与 toolChoice，但拒绝不合法工具名", () => {
    const tool = {
      type: "function",
      function: { name: "get_weather", parameters: { type: "object" } },
    };
    expect(accepts(llmChat, { ...CHAT, tools: [tool], toolChoice: "auto" })).toBe(true);
    expect(
      accepts(llmChat, {
        ...CHAT,
        tools: [tool],
        toolChoice: { type: "function", function: { name: "get_weather" } },
      }),
    ).toBe(true);
    expect(accepts(llmChat, { ...CHAT, tools: [{ ...tool, function: { name: "带空格 名" } }] })).toBe(
      false,
    );
    expect(accepts(llmChat, { ...CHAT, tools: [tool], toolChoice: "always" })).toBe(false);
  });

  it("拒绝超过 50 条消息与越界采样参数", () => {
    const many = Array.from({ length: 51 }, () => ({ role: "user", content: "x" }));
    expect(accepts(llmChat, { messages: many })).toBe(false);
    expect(accepts(llmChat, { ...CHAT, temperature: 2.5 })).toBe(false);
    expect(accepts(llmChat, { ...CHAT, maxTokens: 0 })).toBe(false);
    expect(accepts(llmChat, { ...CHAT, maxTokens: 1.5 })).toBe(false);
  });
});

// ── embeddings ───────────────────────────────────────────────────

describe("embeddings", () => {
  it("接受 1 条与 64 条文本", () => {
    expect(accepts(embeddings, { texts: ["数组"] })).toBe(true);
    expect(accepts(embeddings, { texts: Array.from({ length: 64 }, () => "数组") })).toBe(true);
  });

  it("拒绝 65 条、空数组与空文本", () => {
    expect(accepts(embeddings, { texts: Array.from({ length: 65 }, () => "数组") })).toBe(false);
    expect(accepts(embeddings, { texts: [] })).toBe(false);
    expect(accepts(embeddings, { texts: [""] })).toBe(false);
    expect(accepts(embeddings, { texts: ["   "] })).toBe(false);
  });

  it("单条 8000 字通过，8001 字拒绝", () => {
    expect(accepts(embeddings, { texts: ["a".repeat(8000)] })).toBe(true);
    expect(accepts(embeddings, { texts: ["a".repeat(8001)] })).toBe(false);
  });

  it("拒绝在请求体里指定模型或地址", () => {
    expect(accepts(embeddings, { texts: ["数组"], model: "text-embedding-3-small" })).toBe(false);
    expect(accepts(embeddings, { texts: ["数组"], baseUrl: "https://api.openai.com/v1" })).toBe(false);
  });
});

// ── search ───────────────────────────────────────────────────────

describe("search", () => {
  it("接受三家供应商（穷尽三选一）", () => {
    for (const provider of ["deepseek", "tavily", "wikipedia"]) {
      expect(accepts(search, { provider, query: "数组与链表" })).toBe(true);
    }
  });

  it("拒绝未知供应商与缺少 supplier", () => {
    expect(accepts(search, { provider: "bing", query: "数组" })).toBe(false);
    expect(accepts(search, { query: "数组" })).toBe(false);
  });

  it("query 120 字通过，121 字、空串与纯空白拒绝", () => {
    expect(accepts(search, { provider: "tavily", query: "教".repeat(120) })).toBe(true);
    expect(accepts(search, { provider: "tavily", query: "教".repeat(121) })).toBe(false);
    expect(accepts(search, { provider: "tavily", query: "" })).toBe(false);
    expect(accepts(search, { provider: "tavily", query: "   " })).toBe(false);
  });

  it("拒绝把密钥或结果条数塞进请求体", () => {
    expect(accepts(search, { provider: "tavily", query: "数组", apiKey: "tvly-1" })).toBe(false);
    expect(accepts(search, { provider: "tavily", query: "数组", limit: 10 })).toBe(false);
  });
});

// ── tts ──────────────────────────────────────────────────────────

describe("tts", () => {
  it("2000 字通过，2001 字拒绝", () => {
    expect(accepts(tts, { text: "读".repeat(2000) })).toBe(true);
    expect(accepts(tts, { text: "读".repeat(2001) })).toBe(false);
  });

  it("拒绝空文本与请求体里的端点 / 音色", () => {
    expect(accepts(tts, { text: "" })).toBe(false);
    expect(accepts(tts, { text: "   " })).toBe(false);
    expect(accepts(tts, { text: "你好", voice: "茉莉" })).toBe(false);
    expect(accepts(tts, { text: "你好", baseUrl: "https://api.example.com/v1" })).toBe(false);
  });
});

// ── kbPut ────────────────────────────────────────────────────────

describe("kbPut", () => {
  it("接受新建（baseUpdatedAt=null）与带 updatedAt 的更新", () => {
    expect(accepts(kbPut, KB_PUT)).toBe(true);
    expect(accepts(kbPut, { ...KB_PUT, doc: { ...DOC, updatedAt: 1_700_000_000_000 } })).toBe(true);
    expect(accepts(kbPut, { ...KB_PUT, baseUpdatedAt: 0 })).toBe(true);
  });

  it("baseUpdatedAt 必须是数字或 null", () => {
    const { baseUpdatedAt, ...without } = KB_PUT;
    expect(baseUpdatedAt).toBeNull();
    expect(accepts(kbPut, without)).toBe(false);
    expect(accepts(kbPut, { ...KB_PUT, baseUpdatedAt: -1 })).toBe(false);
    expect(accepts(kbPut, { ...KB_PUT, baseUpdatedAt: 1.5 })).toBe(false);
    expect(accepts(kbPut, { ...KB_PUT, baseUpdatedAt: TS })).toBe(false);
  });

  it("updatedAt 是毫秒数字，不接受 ISO 串", () => {
    expect(accepts(kbPut, { ...KB_PUT, doc: { ...DOC, updatedAt: TS } })).toBe(false);
  });

  it("接受一组自洽的向量字段", () => {
    const embedded = {
      ...CHUNK,
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: "text-embedding-3-small",
      embeddingDim: 3,
    };
    expect(accepts(kbPut, { ...KB_PUT, chunks: [embedded] })).toBe(true);
  });

  it("向量维度必须等于向量长度，且不能缺模型名", () => {
    const mismatch = {
      ...CHUNK,
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: "text-embedding-3-small",
      embeddingDim: 2,
    };
    expect(accepts(kbPut, { ...KB_PUT, chunks: [mismatch] })).toBe(false);

    const noModel = { ...CHUNK, embedding: [0.1, 0.2], embeddingDim: 2 };
    expect(accepts(kbPut, { ...KB_PUT, chunks: [noModel] })).toBe(false);

    const noDim = { ...CHUNK, embedding: [0.1, 0.2], embeddingModel: "m" };
    expect(accepts(kbPut, { ...KB_PUT, chunks: [noDim] })).toBe(false);
  });

  it("没有向量时不许带 embeddingModel / embeddingDim", () => {
    expect(accepts(kbPut, { ...KB_PUT, chunks: [{ ...CHUNK, embeddingModel: "m" }] })).toBe(false);
    expect(accepts(kbPut, { ...KB_PUT, chunks: [{ ...CHUNK, embeddingDim: 3 }] })).toBe(false);
  });

  it("拒绝空片段与纯空白正文", () => {
    expect(accepts(kbPut, { ...KB_PUT, chunks: [] })).toBe(false);
    expect(accepts(kbPut, { ...KB_PUT, chunks: [{ ...CHUNK, text: "   " }] })).toBe(false);
    expect(accepts(kbPut, { ...KB_PUT, chunks: [{ ...CHUNK, text: "a".repeat(8001) }] })).toBe(false);
  });

  it("片段数上限 5 万：到上限通过、多 1 段拒绝", () => {
    // 默认值写死在这里：常量被顺手改大/改小时测试先响（部署可用 ALP_MAX_KB_DIRECTION_CHUNKS 覆盖）。
    expect(MAX_DIRECTION_CHUNKS).toBe(50_000);
    const chunksOf = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...CHUNK, id: `doc-6f1c:${index}` }));
    expect(accepts(kbPut, { ...KB_PUT, chunks: chunksOf(MAX_DIRECTION_CHUNKS) })).toBe(true);
    expect(accepts(kbPut, { ...KB_PUT, chunks: chunksOf(MAX_DIRECTION_CHUNKS + 1) })).toBe(false);
  });

  it("拒绝越界文档字段与未知字段", () => {
    expect(accepts(kbPut, { ...KB_PUT, doc: { ...DOC, kind: "docx" } })).toBe(false);
    expect(accepts(kbPut, { ...KB_PUT, doc: { ...DOC, chunkCount: MAX_DIRECTION_CHUNKS + 1 } })).toBe(
      false,
    );
    expect(accepts(kbPut, { ...KB_PUT, doc: { ...DOC, createdAt: "2026-10-29" } })).toBe(false);
    expect(accepts(kbPut, { ...KB_PUT, doc: { ...DOC, ownerId: "u1" } })).toBe(false);
    expect(accepts(kbPut, { ...KB_PUT, chunks: [{ ...CHUNK, score: 0.9 }] })).toBe(false);
  });
});

// ── kbQuery ──────────────────────────────────────────────────────

describe("kbQuery", () => {
  it("directionId 与 docId 各自单独出现时通过", () => {
    expect(accepts(kbQuery, { directionId: "dir-1" })).toBe(true);
    expect(accepts(kbQuery, { docId: "doc-6f1c" })).toBe(true);
  });

  it("两者同时出现或都不出现时拒绝，并把错误指向 directionId", () => {
    for (const sample of [{ directionId: "dir-1", docId: "doc-6f1c" }, {}]) {
      const result = kbQuery.safeParse(sample);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.join(".") === "directionId")).toBe(
          true,
        );
      }
    }
  });

  it("limit 默认 50，边界 1 与 200 通过、0 与 201 拒绝", () => {
    expect(kbQuery.parse({ directionId: "dir-1" }).limit).toBe(50);
    expect(accepts(kbQuery, { directionId: "dir-1", limit: 1 })).toBe(true);
    expect(accepts(kbQuery, { directionId: "dir-1", limit: 200 })).toBe(true);
    expect(accepts(kbQuery, { directionId: "dir-1", limit: 0 })).toBe(false);
    expect(accepts(kbQuery, { directionId: "dir-1", limit: 201 })).toBe(false);
  });

  it("vectors 可省略（纯 BM25 降级），但不能为空数组或含非有限数", () => {
    expect(accepts(kbQuery, { directionId: "dir-1" })).toBe(true);
    expect(accepts(kbQuery, { directionId: "dir-1", vectors: [[0.1, 0.2]] })).toBe(true);
    expect(accepts(kbQuery, { directionId: "dir-1", vectors: [] })).toBe(false);
    expect(accepts(kbQuery, { directionId: "dir-1", vectors: [[]] })).toBe(false);
    expect(accepts(kbQuery, { directionId: "dir-1", vectors: [[Number.POSITIVE_INFINITY]] })).toBe(
      false,
    );
    expect(accepts(kbQuery, { directionId: "dir-1", vectors: [[Number.NaN]] })).toBe(false);
  });

  it("after 是非负整数游标", () => {
    expect(accepts(kbQuery, { directionId: "dir-1", after: 0 })).toBe(true);
    expect(accepts(kbQuery, { directionId: "dir-1", after: 1.5 })).toBe(false);
    expect(accepts(kbQuery, { directionId: "dir-1", after: -1 })).toBe(false);
  });

  it("拒绝未知字段", () => {
    expect(accepts(kbQuery, { directionId: "dir-1", provider: "browser" })).toBe(false);
    expect(accepts(kbQuery, { directionId: "dir-1", limit: 10, offset: 5 })).toBe(false);
  });
});

// ── memoriesPut ──────────────────────────────────────────────────

describe("memoriesPut", () => {
  it("接受错题卡与易混卡的全量快照", () => {
    expect(accepts(memoriesPut, { subjectId: "data-structures", memories: [ERROR_CARD, CONFUSION_CARD] }))
      .toBe(true);
  });

  it("允许空数组（清空该学科）", () => {
    expect(accepts(memoriesPut, { subjectId: "data-structures", memories: [] })).toBe(true);
  });

  it("错题卡缺 questionId、易混卡缺 withKcId 时拒绝", () => {
    const { questionId, ...errorWithoutQuestion } = ERROR_CARD;
    expect(questionId).toBe("q1");
    expect(
      accepts(memoriesPut, { subjectId: "data-structures", memories: [errorWithoutQuestion] }),
    ).toBe(false);

    const { withKcId, ...confusionWithoutWith } = CONFUSION_CARD;
    expect(withKcId).toBe("ds02");
    expect(
      accepts(memoriesPut, { subjectId: "data-structures", memories: [confusionWithoutWith] }),
    ).toBe(false);
  });

  it("prompt 与 correction 的边界固定为 200 / 600", () => {
    const base = { subjectId: "data-structures" };
    expect(
      accepts(memoriesPut, { ...base, memories: [{ ...ERROR_CARD, prompt: "提".repeat(200) }] }),
    ).toBe(true);
    expect(
      accepts(memoriesPut, { ...base, memories: [{ ...ERROR_CARD, prompt: "提".repeat(201) }] }),
    ).toBe(false);
    expect(
      accepts(memoriesPut, {
        ...base,
        memories: [{ ...ERROR_CARD, correction: "解".repeat(600) }],
      }),
    ).toBe(true);
    expect(
      accepts(memoriesPut, {
        ...base,
        memories: [{ ...ERROR_CARD, correction: "解".repeat(601) }],
      }),
    ).toBe(false);
  });

  it("拒绝越界 streak、未知 status 与非法时间戳", () => {
    const base = { subjectId: "data-structures" };
    expect(accepts(memoriesPut, { ...base, memories: [{ ...ERROR_CARD, streak: 5 }] })).toBe(false);
    expect(accepts(memoriesPut, { ...base, memories: [{ ...ERROR_CARD, status: "done" }] })).toBe(
      false,
    );
    expect(
      accepts(memoriesPut, { ...base, memories: [{ ...ERROR_CARD, lastSeenAt: "2026-10-29" }] }),
    ).toBe(false);
  });

  it("重复 id 的快照拒绝，错误指向第二张卡", () => {
    const result = memoriesPut.safeParse({
      subjectId: "data-structures",
      memories: [ERROR_CARD, { ...ERROR_CARD }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "memories.1.id")).toBe(
        true,
      );
    }
  });

  it("subjectId 必须是 slug", () => {
    expect(accepts(memoriesPut, { subjectId: "Data Structures", memories: [] })).toBe(false);
    expect(accepts(memoriesPut, { subjectId: "", memories: [] })).toBe(false);
    expect(accepts(memoriesPut, { subjectId: "machine-learning", memories: [] })).toBe(true);
  });

  it("最多 200 张卡，201 张拒绝", () => {
    const cardsOf = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...ERROR_CARD, id: `mem-error-q${index}` }));
    expect(accepts(memoriesPut, { subjectId: "data-structures", memories: cardsOf(200) })).toBe(
      true,
    );
    expect(accepts(memoriesPut, { subjectId: "data-structures", memories: cardsOf(201) })).toBe(
      false,
    );
  });

  it("拒绝未知字段", () => {
    expect(
      accepts(memoriesPut, {
        subjectId: "data-structures",
        memories: [{ ...ERROR_CARD, difficulty: 3 }],
      }),
    ).toBe(false);
    expect(
      accepts(memoriesPut, { subjectId: "data-structures", memories: [], updatedAt: 1 }),
    ).toBe(false);
  });
});
