import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/rateLimit";

import type { AllowedTarget } from "@/lib/ssrfGuard";

/**
 * 两个代理路由的边界：鉴权、匿名维基、配置回退、TTS 输入校验与上游失败。
 *
 * 这里 mock 掉 serverSearch / serverTts 的网络实现与 userSecrets 的读库，
 * 只验证路由自己的决策；请求拼装与错误分类由各自的单测覆盖。
 */

const h = vi.hoisted(() => {
  const secrets = new Map<string, unknown>();
  return {
    secrets,
    getCurrentUser: vi.fn(),
    loadUserSecret: vi.fn(),
    searchDeepSeek: vi.fn(),
    searchTavily: vi.fn(),
    searchWikipedia: vi.fn(),
    synthesizeMimo: vi.fn(),
    synthesizeSpeech: vi.fn(),
    assertUpstreamAllowed: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  getCurrentUser: h.getCurrentUser,
}));

vi.mock("@/lib/db", () => ({
  getDb: async () => ({
    run: async () => 1,
    all: async () => [],
    one: async () => null,
  }),
}));

vi.mock("@/lib/userSecrets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/userSecrets")>();
  return { ...actual, loadUserSecret: h.loadUserSecret };
});

vi.mock("@/lib/serverSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/serverSearch")>();
  return {
    ...actual,
    searchDeepSeek: h.searchDeepSeek,
    searchTavily: h.searchTavily,
    searchWikipedia: h.searchWikipedia,
  };
});

vi.mock("@/lib/serverTts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/serverTts")>();
  return {
    ...actual,
    synthesizeMimo: h.synthesizeMimo,
    synthesizeSpeech: h.synthesizeSpeech,
  };
});

vi.mock("@/lib/ssrfGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ssrfGuard")>();
  return { ...actual, assertUpstreamAllowed: h.assertUpstreamAllowed };
});

const { POST: searchPost } = await import("../../app/api/search/route");
const { POST: ttsPost } = await import("../../app/api/tts/route");
const { TtsUpstreamError } = await import("@/lib/serverTts");
const { SsrfGuardError } = await import("@/lib/ssrfGuard");
const { SecretCryptoError } = await import("@/lib/secretCrypto");

import type {
  LoadedUserSecret,
  SecretKind,
  SecretOptions,
  UserSecretRow,
} from "@/lib/userSecrets";

const USER = { id: "u1", email: "u@test.local", displayName: "U", createdAt: "2026-01-01" };

interface SecretSpec {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly api?: string;
  readonly options?: SecretOptions;
}

function secret(kind: SecretKind, spec: SecretSpec = {}): LoadedUserSecret {
  const row: UserSecretRow = {
    user_id: USER.id,
    kind,
    label: "",
    api: spec.api ?? "",
    base_url: spec.baseUrl ?? "",
    model: spec.model ?? "",
    options_json: JSON.stringify(spec.options ?? {}),
    secret_ct: "",
    secret_iv: "",
    secret_tag: "",
    secret_kid: "",
    secret_hint: "••••",
    created_at: "",
    updated_at: "",
  };
  return {
    row,
    payload: spec.apiKey === undefined ? {} : { apiKey: spec.apiKey },
    config: {
      kind,
      label: "",
      api: row.api,
      baseUrl: row.base_url,
      model: row.model,
      options: spec.options ?? {},
      hint: "••••",
      createdAt: "",
      updatedAt: "",
    },
  };
}

function allowedTarget(raw: string): AllowedTarget {
  const url = new URL(raw);
  return { url, hostname: url.hostname, pinned: "93.184.216.34", servername: url.hostname };
}

function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.secrets.clear();
  for (const mock of [
    h.getCurrentUser,
    h.loadUserSecret,
    h.searchDeepSeek,
    h.searchTavily,
    h.searchWikipedia,
    h.synthesizeMimo,
    h.synthesizeSpeech,
    h.assertUpstreamAllowed,
  ]) {
    mock.mockReset();
  }

  h.getCurrentUser.mockResolvedValue(USER);
  h.loadUserSecret.mockImplementation(
    async (_db: unknown, _userId: string, kind: string) => h.secrets.get(kind) ?? null,
  );
  h.searchDeepSeek.mockResolvedValue([]);
  h.searchTavily.mockResolvedValue([]);
  h.searchWikipedia.mockResolvedValue([]);
  h.synthesizeMimo.mockResolvedValue({
    bytes: new Uint8Array([0x49, 0x44, 0x33]),
    contentType: "audio/mpeg",
  });
  h.synthesizeSpeech.mockResolvedValue({
    bytes: new Uint8Array([0xff, 0xfb]),
    contentType: "audio/mpeg",
  });
  h.assertUpstreamAllowed.mockImplementation(async (raw: string) => allowedTarget(raw));
});

beforeEach(() => {
  resetRateLimits();
});

describe("POST /api/search", () => {
  it("未登录访问 deepseek / tavily 返回 401，且不调用供应商", async () => {
    h.getCurrentUser.mockResolvedValue(null);

    for (const provider of ["deepseek", "tavily"]) {
      const res = await searchPost(jsonRequest("/api/search", { provider, query: "栈" }));
      expect(res.status).toBe(401);
      const data = (await res.json()) as { code: string };
      expect(data.code).toBe("unauthorized");
    }

    expect(h.searchDeepSeek).not.toHaveBeenCalled();
    expect(h.searchTavily).not.toHaveBeenCalled();
    expect(h.loadUserSecret).not.toHaveBeenCalled();
  });

  it("wikipedia 免密钥，匿名也能拿到结果", async () => {
    h.getCurrentUser.mockResolvedValue(null);
    h.searchWikipedia.mockResolvedValue([
      {
        title: "栈",
        url: "https://zh.wikipedia.org/wiki/%E6%A0%88",
        snippet: "后进先出",
        provider: "wikipedia",
      },
    ]);

    const res = await searchPost(
      jsonRequest("/api/search", { provider: "wikipedia", query: "栈" }),
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as { provider: string; results: unknown[] };
    expect(data.provider).toBe("wikipedia");
    expect(data.results).toHaveLength(1);
    expect(h.searchWikipedia).toHaveBeenCalledWith("栈");
    expect(h.getCurrentUser).not.toHaveBeenCalled();
    expect(h.loadUserSecret).not.toHaveBeenCalled();
  });

  it("deepseek 缺搜索行且没有可回退的 llm 行时返回 404", async () => {
    const res = await searchPost(
      jsonRequest("/api/search", { provider: "deepseek", query: "栈" }),
    );

    expect(res.status).toBe(404);
    const data = (await res.json()) as { code: string; error: string };
    expect(data.code).toBe("provider_not_configured");
    expect(data.error).not.toContain("API");
    expect(h.searchDeepSeek).not.toHaveBeenCalled();
  });

  it("search-deepseek 行优先于 llm 行", async () => {
    h.secrets.set("search-deepseek", secret("search-deepseek", { apiKey: "sk-search-secret" }));
    h.secrets.set(
      "llm",
      secret("llm", { apiKey: "sk-llm-secret", baseUrl: "https://api.deepseek.com/v1" }),
    );
    h.searchDeepSeek.mockResolvedValue([
      { title: "R", url: "https://r.example", snippet: "", provider: "deepseek" },
    ]);

    const res = await searchPost(
      jsonRequest("/api/search", { provider: "deepseek", query: "栈", count: 5 }),
    );

    expect(res.status).toBe(200);
    expect(h.searchDeepSeek).toHaveBeenCalledWith("sk-search-secret", "栈", 5);
  });

  it("llm 行 base_url 是 api.deepseek.com 时才回退复用它的密钥", async () => {
    h.secrets.set(
      "llm",
      secret("llm", { apiKey: "sk-llm-secret", baseUrl: "https://api.deepseek.com/v1" }),
    );
    h.searchDeepSeek.mockResolvedValue([
      { title: "R", url: "https://r.example", snippet: "", provider: "deepseek" },
    ]);

    const res = await searchPost(
      jsonRequest("/api/search", { provider: "deepseek", query: "栈" }),
    );

    expect(res.status).toBe(200);
    expect(h.searchDeepSeek).toHaveBeenCalledWith("sk-llm-secret", "栈", undefined);
  });

  it("llm 行是别的域名时拒绝回退（密钥不属于 DeepSeek）", async () => {
    h.secrets.set(
      "llm",
      secret("llm", { apiKey: "sk-relay-secret", baseUrl: "https://api.jasonsome.cn/v1" }),
    );

    const res = await searchPost(
      jsonRequest("/api/search", { provider: "deepseek", query: "栈" }),
    );

    expect(res.status).toBe(404);
    expect(h.searchDeepSeek).not.toHaveBeenCalled();
  });

  it("tavily 缺行返回 404，有行时用行里的密钥", async () => {
    const missing = await searchPost(
      jsonRequest("/api/search", { provider: "tavily", query: "栈" }),
    );
    expect(missing.status).toBe(404);

    h.secrets.set("search-tavily", secret("search-tavily", { apiKey: "tvly-secret" }));
    h.searchTavily.mockResolvedValue([
      { title: "T", url: "https://t.example", snippet: "", provider: "tavily" },
    ]);
    const res = await searchPost(
      jsonRequest("/api/search", { provider: "tavily", query: "栈" }),
    );
    expect(res.status).toBe(200);
    expect(h.searchTavily).toHaveBeenCalledWith("tvly-secret", "栈");
  });

  it("密钥解不开返回 500 secret_key_missing，不泄露密文", async () => {
    h.loadUserSecret.mockRejectedValue(
      new SecretCryptoError("KEY_ENC_UNAVAILABLE", "未配置 ALP_SECRET_KEY"),
    );
    const res = await searchPost(
      jsonRequest("/api/search", { provider: "deepseek", query: "栈" }),
    );

    expect(res.status).toBe(500);
    const data = (await res.json()) as { code: string; error: string };
    expect(data.code).toBe("secret_key_missing");
    expect(data.error).not.toContain("未配置 ALP_SECRET_KEY");
  });

  it("数据库故障返回 500 internal，不误报成缺主密钥", async () => {
    h.loadUserSecret.mockRejectedValue(new Error("connection reset"));
    const res = await searchPost(
      jsonRequest("/api/search", { provider: "deepseek", query: "栈" }),
    );

    expect(res.status).toBe(500);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("internal");
  });

  it("请求体不合法返回 400；跨站来源返回 403", async () => {
    const bad = await searchPost(jsonRequest("/api/search", { provider: "brave", query: "栈" }));
    expect(bad.status).toBe(400);

    const crossSite = await searchPost(
      jsonRequest("/api/search", { provider: "wikipedia", query: "栈" }, {
        origin: "https://evil.example",
      }),
    );
    expect(crossSite.status).toBe(403);
  });

  it("300KB 请求体在解析前返回 413，且不调用供应商", async () => {
    const res = await searchPost(
      jsonRequest("/api/search", { provider: "wikipedia", query: "x".repeat(300 * 1024) }),
    );

    expect(res.status).toBe(413);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("payload_too_large");
    expect(h.searchWikipedia).not.toHaveBeenCalled();
  });
});

describe("POST /api/tts", () => {
  function storeMimo(): void {
    h.secrets.set(
      "tts",
      secret("tts", {
        apiKey: "sk-mimo-secret",
        baseUrl: "https://mimo.example.com/v1",
        model: "mimo-v2-flash",
        api: "mimo",
        options: { voice: "茉莉" },
      }),
    );
  }

  it("未登录返回 401", async () => {
    h.getCurrentUser.mockResolvedValue(null);
    const res = await ttsPost(jsonRequest("/api/tts", { text: "你好" }));
    expect(res.status).toBe(401);
    expect(h.synthesizeMimo).not.toHaveBeenCalled();
  });

  it("非 JSON Content-Type 返回 415", async () => {
    const res = await ttsPost(
      new Request("http://localhost/api/tts", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "text/plain" },
        body: "你好",
      }),
    );
    expect(res.status).toBe(415);
  });

  it("正文超过 2000 字返回 400", async () => {
    const res = await ttsPost(jsonRequest("/api/tts", { text: "字".repeat(2001) }));
    expect(res.status).toBe(400);
    const data = (await res.json()) as { code: string; error: string };
    expect(data.code).toBe("bad_request");
    expect(data.error).toContain("2000");
    expect(h.synthesizeMimo).not.toHaveBeenCalled();
  });

  it("tts 行缺失返回 404", async () => {
    const res = await ttsPost(jsonRequest("/api/tts", { text: "你好" }));
    expect(res.status).toBe(404);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("provider_not_configured");
  });

  it("mimo 行返回 audio/mpeg 字节", async () => {
    storeMimo();

    const res = await ttsPost(jsonRequest("/api/tts", { text: "你好" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0x49, 0x44, 0x33]);
    expect(h.assertUpstreamAllowed).toHaveBeenCalledWith("https://mimo.example.com/v1");
    expect(h.synthesizeMimo).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-mimo-secret",
        api: "mimo",
        voice: "茉莉",
      }),
      "你好",
      "茉莉",
    );
    expect(h.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("api 列是引擎名、protocol=chat-audio 时仍走 mimo 而不是 /audio/speech", async () => {
    // 这是 /api/config 的真实存法：api=openai-compatible，协议在 options.protocol。
    h.secrets.set(
      "tts",
      secret("tts", {
        apiKey: "sk-mimo-secret",
        baseUrl: "https://mimo.example.com/v1",
        model: "mimo-v2-flash",
        api: "openai-compatible",
        options: { voice: "茉莉", protocol: "chat-audio" },
      }),
    );

    const res = await ttsPost(jsonRequest("/api/tts", { text: "你好" }));

    expect(res.status).toBe(200);
    expect(h.synthesizeMimo).toHaveBeenCalledTimes(1);
    expect(h.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("mimo 解析失败返回 502，错误里不带密钥", async () => {
    storeMimo();
    h.synthesizeMimo.mockRejectedValue(
      new TtsUpstreamError("parse", "MiMo 响应里没有音频数据"),
    );

    const res = await ttsPost(jsonRequest("/api/tts", { text: "你好" }));

    expect(res.status).toBe(502);
    const data = (await res.json()) as { code: string; error: string };
    expect(data.code).toBe("provider_error");
    expect(data.error).toContain("没有音频数据");
    expect(JSON.stringify(data)).not.toContain("sk-mimo-secret");
  });

  it("base_url 不安全时返回 502，且不调用合成", async () => {
    storeMimo();
    h.assertUpstreamAllowed.mockRejectedValue(
      new SsrfGuardError("blocked-address", "目标是内网地址 10.0.0.8（private）"),
    );

    const res = await ttsPost(jsonRequest("/api/tts", { text: "你好" }));

    expect(res.status).toBe(502);
    expect(h.synthesizeSpeech).not.toHaveBeenCalled();
    expect(h.synthesizeMimo).not.toHaveBeenCalled();
  });

  it("speech 行走 synthesizeSpeech", async () => {
    h.secrets.set(
      "tts",
      secret("tts", {
        apiKey: "sk-tts-secret",
        baseUrl: "https://tts.example.com/v1",
        model: "tts-1",
        api: "speech",
        options: { voice: "alloy", protocol: "speech" },
      }),
    );

    const res = await ttsPost(jsonRequest("/api/tts", { text: "你好" }));

    expect(res.status).toBe(200);
    expect(h.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(h.synthesizeMimo).not.toHaveBeenCalled();
  });

  it("解密失败返回 500 secret_key_missing", async () => {
    h.loadUserSecret.mockRejectedValue(
      new SecretCryptoError("KEY_ENC_UNAVAILABLE", "未配置 ALP_SECRET_KEY"),
    );
    const res = await ttsPost(jsonRequest("/api/tts", { text: "你好" }));
    expect(res.status).toBe(500);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("secret_key_missing");
  });

  it("300KB 请求体在解析前返回 413，且不调用合成", async () => {
    storeMimo();
    const res = await ttsPost(jsonRequest("/api/tts", { text: "x".repeat(300 * 1024) }));

    expect(res.status).toBe(413);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("payload_too_large");
    expect(h.synthesizeMimo).not.toHaveBeenCalled();
    expect(h.synthesizeSpeech).not.toHaveBeenCalled();
  });
});
