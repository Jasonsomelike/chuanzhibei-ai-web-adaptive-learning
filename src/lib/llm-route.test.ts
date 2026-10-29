/**
 * 两条 LLM 路由的边界测试：鉴权、同源、内容类型、strict 请求体、
 * 配置错误码映射、kind 过期检查、embedding 参数上限。
 *
 * 这些用例全部在「读配置 / 校验请求体」阶段结束，不发起任何真实网络请求：
 * 全局 fetch 被替换成抛错实现，DNS 也就不会被触碰。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SecretEnv } from "@/lib/secretCrypto";

const currentUser: {
  value: { id: string; email: string; displayName: string; createdAt: string } | null;
} = { value: null };

const rowRef: { current: Record<string, unknown> | null } = { current: null };

const fakeDb = {
  run: async (): Promise<number> => 0,
  all: async (): Promise<unknown[]> => [],
  one: async (): Promise<Record<string, unknown> | null> => rowRef.current,
};

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => currentUser.value,
}));

vi.mock("@/lib/db", () => ({
  getDb: async () => fakeDb,
}));

const { POST: chatPost } = await import("../../app/api/llm/chat/route");
const { POST: embeddingsPost } = await import("../../app/api/llm/embeddings/route");

const { sealSecret } = await import("@/lib/secretCrypto");

/** 32 字节随机数的标准 base64；测试里固定值即可。 */
const MASTER = Buffer.alloc(32, 9).toString("base64");
const sealedEnv: SecretEnv = { ALP_SECRET_KEY: MASTER };
const saved = new Map<string, string | undefined>();
const MANAGED_ENV = [
  "ALP_SECRET_KEY",
  "ALP_SECRET_KEY_ID",
  "ALP_EMBED_BASE_URL",
  "ALP_EMBED_API_KEY",
  "ALP_EMBED_MODEL",
] as const;

beforeEach(() => {
  for (const key of MANAGED_ENV) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env["ALP_SECRET_KEY"] = MASTER;
  currentUser.value = {
    id: "u1",
    email: "u@test.local",
    displayName: "测试用户",
    createdAt: "2026-10-29T00:00:00.000Z",
  };
  rowRef.current = null;

  vi.stubGlobal("fetch", () => {
    throw new Error("路由测试不允许发起网络请求");
  });
});

afterEach(() => {
  for (const key of MANAGED_ENV) {
    const previous = saved.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  saved.clear();
  vi.unstubAllGlobals();
});

const MESSAGES = [{ role: "user", content: "你好" }];

interface RequestOptions {
  readonly origin?: string | null;
  readonly host?: string;
  readonly contentType?: string;
  readonly rawBody?: string;
}

function request(
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Request {
  const origin = options.origin === undefined ? "http://localhost" : options.origin;
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "application/json",
    host: options.host ?? "localhost",
  };
  if (origin !== null) headers["origin"] = origin;

  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  });
}

async function errorCode(response: Response): Promise<string> {
  const data = (await response.json()) as { error?: { code?: string } };
  return data.error?.code ?? "";
}

interface LlmRowInput {
  readonly api?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly optionsJson?: Record<string, unknown>;
  readonly payload?: Record<string, string>;
  readonly sealWith?: SecretEnv;
  readonly tamperCt?: boolean;
}

function llmRow(input: LlmRowInput = {}): Record<string, unknown> {
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
    options_json: JSON.stringify(input.optionsJson ?? {}),
    secret_ct: ct,
    secret_iv: sealed?.iv ?? "",
    secret_tag: sealed?.tag ?? "",
    secret_kid: sealed?.kid ?? "v1",
    secret_hint: "••••",
    created_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z",
  };
}

describe("POST /api/llm/chat：准入", () => {
  it("未登录 401", async () => {
    currentUser.value = null;
    const response = await chatPost(request("/api/llm/chat", { messages: MESSAGES }));
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
  });

  it("跨站 POST 403", async () => {
    const response = await chatPost(
      request("/api/llm/chat", { messages: MESSAGES }, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("forbidden");
  });

  it("非 JSON 内容类型 415", async () => {
    const response = await chatPost(
      request("/api/llm/chat", { messages: MESSAGES }, { contentType: "text/plain" }),
    );
    expect(response.status).toBe(415);
  });

  it("非法 JSON 400", async () => {
    const response = await chatPost(
      request("/api/llm/chat", null, { rawBody: "{not json" }),
    );
    expect(response.status).toBe(400);
  });

  it("strict 请求体拒绝 baseUrl / apiKey / model", async () => {
    for (const field of ["baseUrl", "apiKey", "model"]) {
      const response = await chatPost(
        request("/api/llm/chat", { messages: MESSAGES, [field]: "x" }),
      );
      expect(response.status, field).toBe(400);
    }
  });

  it("空消息数组与未知角色 400", async () => {
    expect((await chatPost(request("/api/llm/chat", { messages: [] }))).status).toBe(400);
    expect(
      (
        await chatPost(
          request("/api/llm/chat", { messages: [{ role: "tool", content: "x" }] }),
        )
      ).status,
    ).toBe(400);
  });
});

describe("POST /api/llm/chat：配置错误映射", () => {
  it("没有 llm 行 404 CONFIG_MISSING", async () => {
    const response = await chatPost(request("/api/llm/chat", { messages: MESSAGES }));
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("CONFIG_MISSING");
  });

  it("body.kind 与行 api 不符 409 CONFIG_STALE", async () => {
    rowRef.current = llmRow({ payload: { apiKey: "sk-chat-1" } });
    const response = await chatPost(
      request("/api/llm/chat", { messages: MESSAGES, kind: "anthropic" }),
    );
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("CONFIG_STALE");
  });

  it("密文被篡改 500 SECRET_UNREADABLE", async () => {
    rowRef.current = llmRow({ payload: { apiKey: "sk-chat-1" }, tamperCt: true });

    const response = await chatPost(request("/api/llm/chat", { messages: MESSAGES }));
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("SECRET_UNREADABLE");
  });

  it("未知 kid 500 KEY_KID_UNKNOWN", async () => {
    rowRef.current = llmRow({
      payload: { apiKey: "sk-chat-1" },
      sealWith: { ALP_SECRET_KEY: MASTER, ALP_SECRET_KEY_ID: "rotated-kid" },
    });

    const response = await chatPost(request("/api/llm/chat", { messages: MESSAGES }));
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("KEY_KID_UNKNOWN");
  });

  it("缺主密钥 503 KEY_ENC_UNAVAILABLE", async () => {
    rowRef.current = llmRow({ payload: { apiKey: "sk-chat-1" } });
    delete process.env["ALP_SECRET_KEY"];

    const response = await chatPost(request("/api/llm/chat", { messages: MESSAGES }));
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("KEY_ENC_UNAVAILABLE");
  });

  it("保存的上游是内网地址时 502，且不会去连接", async () => {
    rowRef.current = llmRow({
      baseUrl: "https://169.254.169.254/v1",
      payload: { apiKey: "sk-chat-1" },
    });

    const response = await chatPost(request("/api/llm/chat", { messages: MESSAGES }));
    expect(response.status).toBe(502);
    expect(await errorCode(response)).toBe("provider_error");
  });
});

describe("POST /api/llm/embeddings：参数上限", () => {
  it("未登录 401", async () => {
    currentUser.value = null;
    const response = await embeddingsPost(request("/api/llm/embeddings", { texts: ["甲"] }));
    expect(response.status).toBe(401);
  });

  it("跨站 POST 403", async () => {
    const response = await embeddingsPost(
      request("/api/llm/embeddings", { texts: ["甲"] }, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("非 JSON 内容类型 415", async () => {
    const response = await embeddingsPost(
      request("/api/llm/embeddings", { texts: ["甲"] }, { contentType: "text/plain" }),
    );
    expect(response.status).toBe(415);
  });

  it("texts 超过 64 条 400", async () => {
    const texts = Array.from({ length: 65 }, () => "甲");
    const response = await embeddingsPost(request("/api/llm/embeddings", { texts }));
    expect(response.status).toBe(400);
  });

  it("单条超过 8000 字符 400", async () => {
    const response = await embeddingsPost(
      request("/api/llm/embeddings", { texts: ["a".repeat(8001)] }),
    );
    expect(response.status).toBe(400);
  });

  it("空数组、空串、非字符串数组 400", async () => {
    expect((await embeddingsPost(request("/api/llm/embeddings", { texts: [] }))).status).toBe(400);
    expect((await embeddingsPost(request("/api/llm/embeddings", { texts: [""] }))).status).toBe(400);
    expect((await embeddingsPost(request("/api/llm/embeddings", { texts: [1] }))).status).toBe(400);
    expect((await embeddingsPost(request("/api/llm/embeddings", { texts: "甲" }))).status).toBe(400);
  });

  it("没有可用向量化配置时 503 EMBEDDING_UNAVAILABLE", async () => {
    const response = await embeddingsPost(
      request("/api/llm/embeddings", { texts: ["甲"] }),
    );
    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("EMBEDDING_UNAVAILABLE");
  });
});
