import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PRESETS,
  checkBaseUrl,
  isLocalAddress,
  maskKey,
  testConnection,
  type ProviderConfig,
} from "@/lib/provider";

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
        return new Response(JSON.stringify({ content: [{ text: "可用" }] }), {
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
