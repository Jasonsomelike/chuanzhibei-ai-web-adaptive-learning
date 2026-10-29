import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PRESETS,
  checkBaseUrl,
  effectiveProviderMode,
  hydrateProviderFromServer,
  isProviderReady,
  isLocalAddress,
  loadProvider,
  maskKey,
  saveProvider,
  testConnection,
  type ProviderConfig,
} from "@/lib/provider";

/** 内存版 localStorage；vitest 的 node 环境没有 window。 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("预设列表", () => {
  it("不含 Ollama 预设（这是公网 Web 服务，不该突出本地部署）", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(ids).not.toContain("ollama");
    const labels = PRESETS.map((p) => p.label);
    expect(labels.some((l) => l.includes("Ollama") && !l.includes("自定义"))).toBe(false);
  });

  it("自定义拆成 OpenAI 兼容与 Anthropic 兼容两个", () => {
    const custom = PRESETS.filter((p) => p.id.startsWith("custom"));
    expect(custom).toHaveLength(2);
    expect(custom.map((p) => p.kind).sort()).toEqual(["anthropic", "openai-compatible"]);
  });

  it("包含 Anthropic 官方预设，且协议为 anthropic", () => {
    const anthropic = PRESETS.find((p) => p.id === "anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic!.kind).toBe("anthropic");
    expect(anthropic!.baseUrl).toContain("anthropic.com");
  });

  it("云端预设都用 https，避免混合内容", () => {
    for (const p of PRESETS.filter((x) => x.cloud)) {
      expect(p.baseUrl.startsWith("https://")).toBe(true);
    }
  });

  it("预设 id 唯一", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Base URL 预校验", () => {
  it("空地址", () => {
    expect(checkBaseUrl("").kind).toBe("empty");
    expect(checkBaseUrl("   ").kind).toBe("empty");
  });

  it("非法地址", () => {
    expect(checkBaseUrl("not-a-url").kind).toBe("invalid");
    expect(checkBaseUrl("ftp://example.com").kind).toBe("invalid");
  });

  it("检测用户误把完整端点粘进 Base URL", () => {
    const r = checkBaseUrl("https://api.deepseek.com/v1/chat/completions");
    expect(r.kind).toBe("has-endpoint");
    if (r.kind === "has-endpoint") {
      expect(r.detail).toContain("/chat/completions");
    }
  });

  it("检测 Anthropic 的 /messages 后缀", () => {
    expect(checkBaseUrl("https://api.anthropic.com/v1/messages").kind).toBe("has-endpoint");
  });

  it("合法的 https 地址通过", () => {
    expect(checkBaseUrl("https://api.deepseek.com/v1").kind).toBe("ok");
  });

  /**
   * 这组是本次故障的回归测试。
   * 用户在 https 站点上填 http:// 地址，浏览器按 Mixed Content 直接拦截，
   * 表现为 4ms 内 TypeError: Failed to fetch —— 与 CORS 表现相同但原因不同。
   */
  describe("混合内容（HTTPS 页面 + HTTP 地址）", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("https 页面下 http 地址被判为 mixed-content", () => {
      vi.stubGlobal("window", { location: { protocol: "https:" } });
      const r = checkBaseUrl("http://1.92.81.144:8788/v1");
      expect(r.kind).toBe("mixed-content");
      if (r.kind === "mixed-content") {
        expect(r.detail).toContain("HTTPS");
        expect(r.detail).toContain("Mixed Content");
      }
    });

    it("http 页面下 http 地址是允许的（本地开发场景）", () => {
      vi.stubGlobal("window", { location: { protocol: "http:" } });
      expect(checkBaseUrl("http://localhost:11434/v1").kind).toBe("ok");
    });

    it("https 页面下 https 地址不受影响", () => {
      vi.stubGlobal("window", { location: { protocol: "https:" } });
      expect(checkBaseUrl("https://api.deepseek.com/v1").kind).toBe("ok");
    });
  });
});

describe("本地地址识别", () => {
  it("识别 localhost 与回环地址", () => {
    expect(isLocalAddress("http://localhost:11434/v1")).toBe(true);
    expect(isLocalAddress("http://127.0.0.1:8080/v1")).toBe(true);
  });

  it("识别私有网段", () => {
    expect(isLocalAddress("http://192.168.1.10:8080/v1")).toBe(true);
    expect(isLocalAddress("http://10.0.0.5/v1")).toBe(true);
    expect(isLocalAddress("http://172.16.0.1/v1")).toBe(true);
    expect(isLocalAddress("http://172.31.255.1/v1")).toBe(true);
  });

  it("公网地址不算本地", () => {
    expect(isLocalAddress("https://api.deepseek.com/v1")).toBe(false);
    expect(isLocalAddress("http://1.92.81.144:8788/v1")).toBe(false);
    expect(isLocalAddress("http://172.32.0.1/v1")).toBe(false);
  });

  it("非法地址返回 false 而不是抛错", () => {
    expect(isLocalAddress("garbage")).toBe(false);
  });
});

describe("密钥打码", () => {
  it("保留首尾各 4 位，中间打码", () => {
    const masked = maskKey("fake-prefix-1234567890-tail");
    expect(masked.startsWith("fake")).toBe(true);
    expect(masked.endsWith("tail")).toBe(true);
    expect(masked).toContain("•");
    expect(masked).not.toContain("1234567890");
  });

  it("短密钥全部打码", () => {
    expect(maskKey("abc")).toBe("•••");
  });
});

describe("testConnection 的静态校验分支", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const base: ProviderConfig = {
    label: "test",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "key",
    model: "m",
  };

  it("混合内容在发请求前就被拦下，并给出分类与建议", async () => {
    vi.stubGlobal("window", { location: { protocol: "https:" } });

    const result = await testConnection({ ...base, baseUrl: "http://1.92.81.144:8788/v1" });

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("mixed-content");
    expect(result.latencyMs).toBe(0); // 没有发出请求
    expect(result.hints?.some((h) => h.includes("HTTPS"))).toBe(true);
  });

  it("地址含完整端点时提示删掉后缀", async () => {
    const result = await testConnection({
      ...base,
      baseUrl: "https://api.example.com/v1/chat/completions",
    });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("precheck");
    expect(result.detail).toContain("/chat/completions");
  });

  it("额外请求头非法 JSON 时提前报错", async () => {
    const result = await testConnection({ ...base, extraHeaders: "{not json" });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("precheck");
    expect(result.detail).toContain("JSON");
  });

  it("空地址时报错而不是发请求", async () => {
    const result = await testConnection({ ...base, baseUrl: "" });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("precheck");
  });
});

describe("testConnection 的请求构造", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const base: ProviderConfig = {
    label: "test",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret-key",
    model: "test-model",
  };

  it("OpenAI 兼容协议：打 /chat/completions，密钥走 Authorization", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "可用" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const result = await testConnection(base);

    expect(result.ok).toBe(true);
    expect(capturedUrl).toBe("https://api.example.com/v1/chat/completions");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-key");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("Anthropic 协议：打 /messages，密钥走 x-api-key，带版本头与浏览器直连声明", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ content: [{ type: "text", text: "可用" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const result = await testConnection({
      ...base,
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
    });

    expect(result.ok).toBe(true);
    expect(capturedUrl).toBe("https://api.anthropic.com/v1/messages");

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("secret-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    // 缺这个头 Anthropic 会拒绝浏览器直连
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers.Authorization).toBeUndefined();
  });

  it("401 归为鉴权失败并提示检查密钥", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid key", { status: 401 })),
    );
    const result = await testConnection(base);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("auth");
    expect(result.detail).toContain("401");
  });

  it("404 提示检查 /v1 与模型名", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    const result = await testConnection(base);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("not-found");
    expect(result.hints?.some((h) => h.includes("/v1"))).toBe(true);
  });

  it("429 归为限流", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    const result = await testConnection(base);
    expect(result.failure).toBe("rate-limit");
  });

  it("5xx 归为供应商故障", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 503 })),
    );
    const result = await testConnection(base);
    expect(result.failure).toBe("server");
  });

  it("网络错误归为 cors 并给出排查建议", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await testConnection(base);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("cors");
    expect(result.hints?.length).toBeGreaterThan(0);
  });

  it("返回空内容时报响应异常而不是成功", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const result = await testConnection(base);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("response");
  });
});

describe("推理模型的连通性判定（回归）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const base: ProviderConfig = {
    label: "test",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "key",
    model: "reasoning-model",
  };

  /*
   * 实测：deepseek 推理模型会把 16 个 token 全用在 reasoning_content 上，
   * content 为空、finish_reason=length。旧逻辑判成「响应异常」，
   * 用户第一次测连通性就看到红框，以为地址填错了。
   */
  it("200 + finish_reason=length + 正文为空，判为连通而不是失败", async () => {
    let sentBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sentBody = init.body;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "", reasoning_content: "先想一想" }, finish_reason: "length" }],
            usage: { total_tokens: 64 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const result = await testConnection(base);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("推理");
    // 请求本身要留出足够预算，否则连通性永远测不出正文
    expect(JSON.parse(sentBody).max_tokens).toBe(64);
  });

  it("正常 stop 但正文为空仍判失败（不放松真正的异常）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "  " }, finish_reason: "stop" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const result = await testConnection(base);
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("response");
  });
});

describe("ProviderConfig 持久化（thinking / thinkingStatus / verification）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const base: ProviderConfig = {
    label: "持久化测试",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    model: "m",
  };

  it("保存后重新读取，thinking / thinkingStatus / verification 三项仍在", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });

    saveProvider({ ...base, thinking: "deep", thinkingStatus: "unsupported", verification: false });
    const loaded = loadProvider();

    expect(loaded).not.toBeNull();
    expect(loaded!.thinking).toBe("deep");
    expect(loaded!.thinkingStatus).toBe("unsupported");
    expect(loaded!.verification).toBe(false);
  });

  it("旧存档没有这三个字段时给默认值：off / unknown / true", () => {
    const storage = memoryStorage();
    storage.setItem(
      "alp.provider.v1",
      JSON.stringify({
        label: "旧存档",
        kind: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "m",
      }),
    );
    vi.stubGlobal("window", { localStorage: storage });

    const loaded = loadProvider();

    expect(loaded!.thinking).toBe("off");
    expect(loaded!.thinkingStatus).toBe("unknown");
    expect(loaded!.verification).toBe(true);
  });

  it("保存时缺省字段也会显式落盘，避免「没存过」与「显式关闭」混淆", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });

    saveProvider({ ...base, thinkingStatus: "verified" });
    const raw = JSON.parse(storage.getItem("alp.provider.v1") ?? "{}") as Record<string, unknown>;

    expect(raw.thinking).toBe("off");
    expect(raw.thinkingStatus).toBe("verified");
    expect(raw.verification).toBe(true);
  });
});

// ── server 模式（服务端代发） ────────────────────────────────────

describe("server 模式：读档与就绪判定", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const serverBase: ProviderConfig = {
    label: "服务端配置",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "",
    model: "deepseek-chat",
    mode: "server",
    serverConfigured: true,
  };

  it("旧存档有 apiKey 且没有 mode 时按 local 解释", () => {
    const storage = memoryStorage();
    storage.setItem(
      "alp.provider.v1",
      JSON.stringify({
        label: "旧存档",
        kind: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "m",
      }),
    );
    vi.stubGlobal("window", { localStorage: storage });

    const loaded = loadProvider();
    expect(loaded).not.toBeNull();
    expect(effectiveProviderMode(loaded!)).toBe("local");
    expect(isProviderReady(loaded)).toBe(true);
  });

  it("server 模式允许 apiKey 为空，且不会把残留的 key 读回内存", () => {
    const storage = memoryStorage();
    storage.setItem(
      "alp.provider.v1",
      JSON.stringify({ ...serverBase, apiKey: "stale-key" }),
    );
    vi.stubGlobal("window", { localStorage: storage });

    const loaded = loadProvider();
    expect(loaded).not.toBeNull();
    expect(loaded!.mode).toBe("server");
    expect(loaded!.apiKey).toBe("");
    expect(loaded!.serverConfigured).toBe(true);
    expect(loaded!.embeddingStatus).toBe("unknown");
  });

  it("server 模式 serverConfigured=false 时视为未配置", () => {
    const storage = memoryStorage();
    storage.setItem(
      "alp.provider.v1",
      JSON.stringify({ ...serverBase, serverConfigured: false }),
    );
    vi.stubGlobal("window", { localStorage: storage });

    expect(loadProvider()).toBeNull();
  });

  it("saveProvider 在 server 模式不写 apiKey", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });

    saveProvider({ ...serverBase, apiKey: "should-not-persist" });
    const raw = JSON.parse(storage.getItem("alp.provider.v1") ?? "{}") as Record<string, unknown>;

    expect(raw.mode).toBe("server");
    expect(raw.apiKey).toBe("");
  });

  it("isProviderReady：local 看三项，server 只看 serverConfigured", () => {
    expect(isProviderReady(null)).toBe(false);
    expect(
      isProviderReady({
        label: "l",
        kind: "openai-compatible",
        baseUrl: "https://api.example.com/v1",
        apiKey: "",
        model: "m",
      }),
    ).toBe(false);
    expect(isProviderReady(serverBase)).toBe(true);
    expect(isProviderReady({ ...serverBase, serverConfigured: false })).toBe(false);
  });
});

describe("hydrateProviderFromServer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubConfig(body: unknown, status = 200): Array<{ url: string; init?: RequestInit }> {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    return calls;
  }

  it("服务端有 llm 行：写 mode=server / serverConfigured=true，apiKey 为空并带上 options", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const calls = stubConfig({
      config: {
        llm: {
          configured: true,
          hint: "sk-…abcd",
          label: "团队 DeepSeek",
          api: "anthropic",
          baseUrl: "https://api.example.com/v1/",
          model: "claude-sonnet",
          options: {
            thinking: "deep",
            thinkingStatus: "unsupported",
            verification: false,
            embeddingModel: "text-embedding-v3",
            embeddingStatus: "available",
          },
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      },
    });

    const hydrated = await hydrateProviderFromServer();

    expect(calls[0].url).toBe("/api/config");
    expect(calls[0].init?.cache).toBe("no-store");
    expect(hydrated).not.toBeNull();
    expect(hydrated!.mode).toBe("server");
    expect(hydrated!.serverConfigured).toBe(true);
    expect(hydrated!.apiKey).toBe("");
    expect(hydrated!.label).toBe("团队 DeepSeek");
    expect(hydrated!.kind).toBe("anthropic");
    expect(hydrated!.baseUrl).toBe("https://api.example.com/v1");
    expect(hydrated!.model).toBe("claude-sonnet");
    expect(hydrated!.thinking).toBe("deep");
    expect(hydrated!.thinkingStatus).toBe("unsupported");
    expect(hydrated!.verification).toBe(false);
    expect(hydrated!.embeddingModel).toBe("text-embedding-v3");
    expect(hydrated!.embeddingStatus).toBe("available");
    expect(isProviderReady(hydrated)).toBe(true);

    // 已持久化，且磁盘上没有明文 key 可抄
    const raw = JSON.parse(storage.getItem("alp.provider.v1") ?? "{}") as Record<string, unknown>;
    expect(raw.mode).toBe("server");
    expect(raw.apiKey).toBe("");
    expect(raw.serverConfigured).toBe(true);
  });

  it("服务端没有 llm 行：serverConfigured=false，且不覆盖可用的本地配置", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    saveProvider({
      label: "本地 BYOK",
      kind: "openai-compatible",
      baseUrl: "https://api.example.com/v1",
      apiKey: "local-key",
      model: "m",
    });
    stubConfig({ config: { llm: { configured: false, options: {} } } });

    const hydrated = await hydrateProviderFromServer();

    expect(hydrated).not.toBeNull();
    expect(hydrated!.serverConfigured).toBe(false);
    expect(hydrated!.mode).toBe("local");
    expect(hydrated!.apiKey).toBe("local-key");
    // 本地存档原样保留
    const raw = JSON.parse(storage.getItem("alp.provider.v1") ?? "{}") as Record<string, unknown>;
    expect(raw.apiKey).toBe("local-key");
  });

  it("登录态 401 时什么都不改", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const before = JSON.stringify({ label: "本地", apiKey: "k" });
    storage.setItem("alp.provider.v1", before);
    stubConfig({ error: { code: "unauthorized", message: "请先登录" } }, 401);

    await expect(hydrateProviderFromServer()).resolves.toBeNull();
    expect(storage.getItem("alp.provider.v1")).toBe(before);
  });

  it("网络错误 / 响应形状不对时返回 null，不动本地状态", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.setItem("alp.provider.v1", "{}");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(hydrateProviderFromServer()).resolves.toBeNull();

    stubConfig({ nope: true });
    await expect(hydrateProviderFromServer()).resolves.toBeNull();
    expect(storage.getItem("alp.provider.v1")).toBe("{}");
  });
});
