/**
 * upstream 的行为测试：请求体复用、头过滤、端点拼接、脱敏、SSE 透传、配置解密。
 *
 * 配置读取用注入的假 Db，行形状与 userSecrets.ts 的写入完全一致；
 * 密文由 secretCrypto.sealSecret 生成（AAD 绑定 userId/kind），
 * 这样测的是真实「加密方 → 解密方」链路，而不是测试自己拼的 base64。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LlmConfigError } from "@/lib/upstream";
import {
  buildUpstreamChatBody,
  endpointFor,
  filterExtraHeaders,
  isLlmConfigError,
  loadLlmConfigForUser,
  redactSecrets,
  sseProxyStream,
} from "@/lib/upstream";
import { sealSecret, type SecretEnv } from "@/lib/secretCrypto";

const rowRef: { current: Record<string, unknown> | null } = { current: null };

const fakeDb = {
  run: async (): Promise<number> => 0,
  all: async (): Promise<unknown[]> => [],
  one: async (): Promise<Record<string, unknown> | null> => rowRef.current,
};

vi.mock("@/lib/db", () => ({
  getDb: async () => fakeDb,
}));

/** 32 字节随机数的标准 base64；测试里固定值即可。 */
const MASTER = Buffer.alloc(32, 7).toString("base64");
const sealedEnv: SecretEnv = { ALP_SECRET_KEY: MASTER };
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ["ALP_SECRET_KEY", "ALP_SECRET_KEY_ID"]) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env["ALP_SECRET_KEY"] = MASTER;
  rowRef.current = null;
});

afterEach(() => {
  for (const key of ["ALP_SECRET_KEY", "ALP_SECRET_KEY_ID"]) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

interface SecretRowInput {
  readonly api?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly options?: Record<string, unknown>;
  /** 不传表示没有密文（secret_ct 为空）。 */
  readonly payload?: Record<string, string>;
  readonly sealWith?: SecretEnv;
  readonly tamperCt?: boolean;
}

function secretRow(input: SecretRowInput = {}): Record<string, unknown> {
  const sealed =
    input.payload === undefined
      ? null
      : sealSecret(
          JSON.stringify(input.payload),
          { userId: "u1", kind: "llm" },
          input.sealWith ?? sealedEnv,
        );

  let ct = sealed?.ct ?? "";
  if (input.tamperCt === true && ct !== "") {
    const bytes = Buffer.from(ct, "base64");
    bytes[0] = (bytes[0] as number) ^ 0xff;
    ct = bytes.toString("base64");
  }

  return {
    user_id: "u1",
    kind: "llm",
    label: "文本模型",
    api: input.api ?? "openai-compatible",
    base_url: input.baseUrl ?? "https://api.deepseek.com/v1",
    model: input.model ?? "deepseek-chat",
    options_json: JSON.stringify(input.options ?? {}),
    secret_ct: ct,
    secret_iv: sealed?.iv ?? "",
    secret_tag: sealed?.tag ?? "",
    secret_kid: sealed?.kid ?? "v1",
    secret_hint: "••••",
    created_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z",
  };
}

// ── buildUpstreamChatBody ─────────────────────────────────────────

const MESSAGES = [
  { role: "system" as const, content: "你是助教" },
  { role: "user" as const, content: "第一问" },
  { role: "assistant" as const, content: "第一答" },
  { role: "user" as const, content: "第二问" },
];

describe("buildUpstreamChatBody", () => {
  it("OpenAI 兼容：保留多轮消息、system 在首位、stream 透传", () => {
    const body = buildUpstreamChatBody("openai-compatible", "deepseek-chat", {
      messages: MESSAGES,
      temperature: 0.4,
      maxTokens: 512,
      stream: true,
    });

    expect(body["model"]).toBe("deepseek-chat");
    expect(body["stream"]).toBe(true);
    expect(body["temperature"]).toBe(0.4);
    expect(body["max_tokens"]).toBe(512);
    expect(body["messages"]).toEqual(MESSAGES);
  });

  it("Anthropic：system 提到顶层，messages 不含 system 角色", () => {
    const body = buildUpstreamChatBody("anthropic", "claude-sonnet", {
      messages: MESSAGES,
      maxTokens: 256,
      stream: false,
    });

    expect(body["system"]).toBe("你是助教");
    expect(body["messages"]).toEqual([
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答" },
      { role: "user", content: "第二问" },
    ]);
    expect(body["stream"]).toBe(false);
  });

  it("思考档位复用 buildChatBody 的规则：deep 删采样参数并抬高 max_tokens", () => {
    const body = buildUpstreamChatBody(
      "openai-compatible",
      "glm-4",
      { messages: MESSAGES, temperature: 0.4, maxTokens: 100, stream: true },
      "deep",
    );

    expect(body["temperature"]).toBeUndefined();
    expect(body["reasoning_effort"]).toBe("high");
    expect(body["max_tokens"]).toBe(20_480);
  });

  it("Anthropic + deep 写 thinking.budget_tokens", () => {
    const body = buildUpstreamChatBody(
      "anthropic",
      "claude",
      { messages: MESSAGES, maxTokens: 100, stream: true },
      "deep",
    );
    expect(body["thinking"]).toEqual({ type: "enabled", budget_tokens: 16_384 });
    expect(body["temperature"]).toBeUndefined();
  });
});

// ── filterExtraHeaders ────────────────────────────────────────────

describe("filterExtraHeaders", () => {
  it("拒绝会改变连接目标或分帧的头", () => {
    const headers = filterExtraHeaders(
      JSON.stringify({
        Host: "evil.example",
        "content-length": "999",
        Connection: "keep-alive",
        "Transfer-Encoding": "chunked",
        TE: "trailers",
        Trailer: "x",
        Cookie: "session=1",
        "Proxy-Authorization": "Basic x",
        "proxy-connection": "keep-alive",
        "X-Custom": "ok",
      }),
    );

    expect(headers).toEqual({ "x-custom": "ok" });
  });

  it("键名统一小写，非法键与 CRLF 值丢弃，非字符串值丢弃", () => {
    const headers = filterExtraHeaders(
      JSON.stringify({
        "X-Trace-Id": "abc",
        "bad header": "x",
        "X-Newline": "a\r\nInjected: 1",
        "X-Number": 42,
      }),
    );
    expect(headers).toEqual({ "x-trace-id": "abc" });
  });

  it("非法 JSON / 空串 / 数组都返回空对象", () => {
    expect(filterExtraHeaders(undefined)).toEqual({});
    expect(filterExtraHeaders("")).toEqual({});
    expect(filterExtraHeaders("{not json")).toEqual({});
    expect(filterExtraHeaders("[1,2]")).toEqual({});
    expect(filterExtraHeaders('"text"')).toEqual({});
  });
});

// ── endpointFor ───────────────────────────────────────────────────

describe("endpointFor", () => {
  it("OpenAI 兼容追加 /chat/completions，并对末尾斜杠归一", () => {
    expect(endpointFor("openai-compatible", "https://api.deepseek.com/v1")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
    expect(endpointFor("openai-compatible", "https://api.deepseek.com/v1///")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
  });

  it("Anthropic 追加 /messages", () => {
    expect(endpointFor("anthropic", "https://api.anthropic.com/v1/")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });

  it("空 baseUrl 抛错", () => {
    expect(() => endpointFor("openai-compatible", "   ")).toThrow();
  });
});

// ── redactSecrets ─────────────────────────────────────────────────

describe("redactSecrets", () => {
  it("替换 apiKey、embeddingApiKey 与额外头的值", () => {
    const text = "key=sk-chat-1234567890 emb=sk-embed-0987654321 trace=trace-value-123";
    const out = redactSecrets(text, {
      apiKey: "sk-chat-1234567890",
      embeddingApiKey: "sk-embed-0987654321",
      extraHeaders: JSON.stringify({ "X-Trace": "trace-value-123" }),
    });

    expect(out).not.toContain("sk-chat-1234567890");
    expect(out).not.toContain("sk-embed-0987654321");
    expect(out).not.toContain("trace-value-123");
    expect(out).toContain("[redacted]");
  });

  it("兜底替换 Bearer 令牌（用户改过 key 后旧值已不在配置里）", () => {
    const out = redactSecrets("Authorization: Bearer abcdefghijklmnop123456", {});
    expect(out).toBe("Authorization: Bearer [redacted]");
  });

  it("不替换过短的值，避免把正常文本毁掉", () => {
    expect(redactSecrets("en v1 ok", { apiKey: "en" })).toBe("en v1 ok");
  });
});

// ── sseProxyStream ────────────────────────────────────────────────

const encoder = new TextEncoder();

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

describe("sseProxyStream", () => {
  it("按块原样转发，不合并也不重编码", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"a\":1}\n\n"));
        controller.enqueue(encoder.encode("data: {\"a\":2}\n\n"));
        controller.close();
      },
    });

    const out = await readAll(sseProxyStream(source, { heartbeatMs: 0 }));
    expect(out).toBe("data: {\"a\":1}\n\ndata: {\"a\":2}\n\n");
  });

  it("中途错误先写一条 error 帧再关闭，且 message 已脱敏", async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: partial\n\n"));
        // 下一拍再出错：同步 error() 会清空尚未被读取的队列，模拟不了「读了一半」。
        setTimeout(
          () => controller.error(new Error("upstream died with sk-secret-key-123456")),
          5,
        );
      },
    });

    const out = await readAll(
      sseProxyStream(source, {
        heartbeatMs: 0,
        secret: { apiKey: "sk-secret-key-123456" },
      }),
    );

    expect(out.startsWith("data: partial\n\n")).toBe(true);
    const errorLine = out.slice("data: partial\n\n".length).trim();
    const payload = JSON.parse(errorLine.replace(/^data:\s*/, "")) as {
      error: { message: string };
    };
    expect(payload.error.message).toContain("[redacted]");
    expect(payload.error.message).not.toContain("sk-secret-key-123456");
    expect(out.endsWith("\n\n")).toBe(true);
  });

  it("signal 中止后不再向下游写数据", async () => {
    const controller = new AbortController();
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode("data: first\n\n"));
      },
    });

    const stream = sseProxyStream(source, {
      signal: controller.signal,
      heartbeatMs: 0,
    });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n");

    controller.abort();
    const second = await reader.read();
    expect(second.done).toBe(true);
  });

  it("空闲时发送注释心跳，客户端按 SSE 规范会忽略", async () => {
    const source = new ReadableStream<Uint8Array>({
      start() {
        // 永不发送业务数据
      },
    });

    const reader = sseProxyStream(source, { heartbeatMs: 10 }).getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(": ping\n\n");
    await reader.cancel();
  });
});

// ── loadLlmConfigForUser ──────────────────────────────────────────

async function expectConfigError(
  row: Record<string, unknown> | null,
): Promise<LlmConfigError> {
  rowRef.current = row;
  const error = await loadLlmConfigForUser("u1").catch((err: unknown) => err);
  expect(isLlmConfigError(error)).toBe(true);
  if (!isLlmConfigError(error)) throw new Error("应为 LlmConfigError");
  return error;
}

describe("loadLlmConfigForUser", () => {
  it("行不存在 → CONFIG_MISSING", async () => {
    const err = await expectConfigError(null);
    expect(err.code).toBe("CONFIG_MISSING");
  });

  it("读回明文列与解密后的 payload", async () => {
    rowRef.current = secretRow({
      options: {
        thinking: "standard",
        embeddingBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        embeddingModel: "text-embedding-v3",
      },
      payload: {
        apiKey: "sk-chat-1",
        embeddingApiKey: "sk-embed-1",
        extraHeaders: JSON.stringify({ "X-Trace": "trace-1" }),
      },
    });

    const config = await loadLlmConfigForUser("u1");
    expect(config.api).toBe("openai-compatible");
    expect(config.options.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(config.options.model).toBe("deepseek-chat");
    expect(config.options.thinking).toBe("standard");
    expect(config.options.embeddingBaseUrl).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    expect(config.options.embeddingModel).toBe("text-embedding-v3");
    expect(config.options.extraHeaders).toBe(JSON.stringify({ "X-Trace": "trace-1" }));
    expect(config.payload.apiKey).toBe("sk-chat-1");
    expect(config.payload.embeddingApiKey).toBe("sk-embed-1");
  });

  it("Anthropic 协议与缺省思考档位", async () => {
    rowRef.current = secretRow({ api: "anthropic", payload: { apiKey: "sk-ant-1" } });
    const config = await loadLlmConfigForUser("u1");
    expect(config.api).toBe("anthropic");
    expect(config.options.thinking).toBe("off");
  });

  it("缺主密钥 → KEY_ENC_UNAVAILABLE", async () => {
    const row = secretRow({ payload: { apiKey: "sk-chat-1" } });
    delete process.env["ALP_SECRET_KEY"];
    const err = await expectConfigError(row);
    expect(err.code).toBe("KEY_ENC_UNAVAILABLE");
  });

  it("未知 kid → KEY_KID_UNKNOWN", async () => {
    const row = secretRow({
      payload: { apiKey: "sk-chat-1" },
      sealWith: { ALP_SECRET_KEY: MASTER, ALP_SECRET_KEY_ID: "rotated-kid" },
    });
    const err = await expectConfigError(row);
    expect(err.code).toBe("KEY_KID_UNKNOWN");
  });

  it("密文被篡改 → SECRET_UNREADABLE", async () => {
    const err = await expectConfigError(
      secretRow({ payload: { apiKey: "sk-chat-1" }, tamperCt: true }),
    );
    expect(err.code).toBe("SECRET_UNREADABLE");
  });

  it("没有密文（secret_ct 为空）→ SECRET_UNREADABLE", async () => {
    const err = await expectConfigError(secretRow());
    expect(err.code).toBe("SECRET_UNREADABLE");
  });

  it("base_url 为空 → CONFIG_INVALID", async () => {
    const err = await expectConfigError(
      secretRow({ baseUrl: "", payload: { apiKey: "sk-chat-1" } }),
    );
    expect(err.code).toBe("CONFIG_INVALID");
  });

  it("未知协议 → CONFIG_INVALID", async () => {
    const err = await expectConfigError(
      secretRow({ api: "mistral", payload: { apiKey: "sk-chat-1" } }),
    );
    expect(err.code).toBe("CONFIG_INVALID");
  });
});
