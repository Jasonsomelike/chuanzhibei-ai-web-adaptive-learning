import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderConfig } from "@/lib/provider";
import {
  CALL_MODE_KEY,
  DEFAULT_CALL_MODE,
  applyServerConfigToProvider,
  deleteConfig,
  explainConfigError,
  fetchConfigs,
  hydrateProviderFromServer,
  loadCallMode,
  parseServerConfigs,
  saveCallMode,
  saveConfig,
  type ServerConfigEntry,
  type ServerConfigs,
} from "@/lib/serverConfig";

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

function entry(overrides: Partial<ServerConfigEntry> = {}): ServerConfigEntry {
  return {
    configured: true,
    hint: "••••abcd",
    label: "我的 DeepSeek",
    api: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    options: {},
    updatedAt: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

function emptyEntry(): ServerConfigEntry {
  return entry({
    configured: false,
    hint: "",
    label: "",
    api: "",
    baseUrl: "",
    model: "",
    options: {},
    updatedAt: "",
  });
}

function configs(llm: ServerConfigEntry): ServerConfigs {
  return {
    llm,
    "search-deepseek": emptyEntry(),
    "search-tavily": emptyEntry(),
    tts: emptyEntry(),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): {
  calls: { url: string; init: RequestInit }[];
  mock: ReturnType<typeof vi.fn>;
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    return handler(url, requestInit);
  });
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 模式存储 ──────────────────────────────────────────────────────

describe("调用模式", () => {
  it("没有存档时默认 server", () => {
    expect(loadCallMode()).toBe(DEFAULT_CALL_MODE);
    expect(DEFAULT_CALL_MODE).toBe("server");
  });

  it("local / server 往返，坏值回落到默认", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });

    saveCallMode("local");
    expect(storage.getItem(CALL_MODE_KEY)).toBe("local");
    expect(loadCallMode()).toBe("local");

    saveCallMode("server");
    expect(loadCallMode()).toBe("server");

    storage.setItem(CALL_MODE_KEY, "server!");
    expect(loadCallMode()).toBe("server");
  });

  it("localStorage 抛错时不冒泡", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(loadCallMode()).toBe("server");
    expect(() => saveCallMode("local")).not.toThrow();
  });
});

// ── GET /api/config ───────────────────────────────────────────────

describe("fetchConfigs", () => {
  it("200 时解析四个 kind，缺项给空槽位", async () => {
    stubFetch(() =>
      jsonResponse({
        config: {
          llm: entry({ options: { thinking: "deep", verification: true, embeddingModel: "bge" } }),
        },
      }),
    );

    const result = await fetchConfigs();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.configs.llm).toMatchObject({
      configured: true,
      hint: "••••abcd",
      label: "我的 DeepSeek",
      api: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      options: { thinking: "deep", verification: true, embeddingModel: "bge" },
    });
    for (const kind of ["search-deepseek", "search-tavily", "tts"] as const) {
      expect(result.configs[kind]).toEqual(emptyEntry());
    }
  });

  it("401 返回 UNAUTHORIZED（未登录不是网络错误）", async () => {
    stubFetch(() =>
      jsonResponse({ error: { code: "unauthorized", message: "请先登录" } }, 401),
    );

    const result = await fetchConfigs();

    expect(result).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    if (!result.ok) expect(result.message).toContain("登录");
  });

  it("网络异常折成 NETWORK，不抛错", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const result = await fetchConfigs();

    expect(result).toMatchObject({ ok: false, code: "NETWORK" });
  });

  it("200 但没有 config 字段时是 BAD_RESPONSE", async () => {
    stubFetch(() => jsonResponse({ ok: true }));

    const result = await fetchConfigs();

    expect(result).toMatchObject({ ok: false, code: "BAD_RESPONSE" });
  });
});

// ── 写入 / 删除 ───────────────────────────────────────────────────

describe("saveConfig", () => {
  it("按契约发 PUT /api/config，空密钥不发（沿用已存密文）", async () => {
    const { calls } = stubFetch(() => jsonResponse({ config: entry() }));

    const result = await saveConfig({
      provider: "llm",
      kind: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/config");
    expect(calls[0].init.method).toBe("PUT");
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      provider: "llm",
      kind: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "",
    });
  });

  it("503 KEY_ENC_UNAVAILABLE 给出可操作的人话", async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: "KEY_ENC_UNAVAILABLE", message: "缺少 ALP_SECRET_KEY" } },
        503,
      ),
    );

    const result = await saveConfig({
      provider: "search-tavily",
      apiKey: "tvly-x",
    });

    expect(result).toMatchObject({ ok: false, code: "KEY_ENC_UNAVAILABLE" });
    if (!result.ok) {
      expect(result.message).toContain("ALP_SECRET_KEY");
      expect(result.message).toContain("无法加密保存");
    }
  });

  it("503 PERSISTENCE_UNAVAILABLE 说明内存后端会丢数据", async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: "PERSISTENCE_UNAVAILABLE", message: "内存后端" } },
        503,
      ),
    );

    const result = await saveConfig({ provider: "tts", engine: "browser", protocol: "speech", rate: 1 });

    expect(result).toMatchObject({ ok: false, code: "PERSISTENCE_UNAVAILABLE" });
    if (!result.ok) expect(result.message).toContain("重启");
  });

  it("409 CONFLICT_STALE 提示刷新后重填", async () => {
    stubFetch(() =>
      jsonResponse({ error: { code: "CONFLICT_STALE", message: "版本不一致" } }, 409),
    );

    const result = await saveConfig({
      provider: "search-deepseek",
      apiKey: "sk-deepseek",
    });

    expect(result).toMatchObject({ ok: false, code: "CONFLICT_STALE" });
    if (!result.ok) expect(result.message).toContain("刷新");
  });

  it("400 的人话直接取服务端 message", async () => {
    stubFetch(() =>
      jsonResponse({ error: { code: "bad_request", message: "baseUrl：地址不合法" } }, 400),
    );

    const result = await saveConfig({
      provider: "llm",
      kind: "openai-compatible",
      baseUrl: "not-a-url",
      apiKey: "sk-x",
      model: "deepseek-chat",
    });

    expect(result).toMatchObject({ ok: false, code: "INVALID" });
    if (!result.ok) expect(result.message).toBe("baseUrl：地址不合法");
  });

  it("401 同样归为 UNAUTHORIZED", async () => {
    stubFetch(() => jsonResponse({ error: { code: "unauthorized" } }, 401));

    const result = await saveConfig({ provider: "search-tavily", apiKey: "tvly-x" });

    expect(result).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
});

describe("deleteConfig", () => {
  it("DELETE /api/config?kind=llm，返回 deleted", async () => {
    const { calls } = stubFetch(() => jsonResponse({ ok: true, deleted: true }));

    const result = await deleteConfig("llm");

    expect(result).toEqual({ ok: true, deleted: true });
    expect(calls[0].url).toBe("/api/config?kind=llm");
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("没有行时 deleted=false 仍算成功", async () => {
    stubFetch(() => jsonResponse({ ok: true, deleted: false }));

    await expect(deleteConfig("tts")).resolves.toEqual({ ok: true, deleted: false });
  });
});

// ── 解析 ──────────────────────────────────────────────────────────

describe("applyServerConfigToProvider", () => {
  it("server 模式 + 有 llm 行：给出去掉尾斜杠的地址与解析后的 options", () => {
    const state = applyServerConfigToProvider(
      "server",
      configs(
        entry({
          baseUrl: "https://api.deepseek.com/v1/",
          options: {
            thinking: "deep",
            thinkingStatus: "verified",
            verification: false,
            embeddingBaseUrl: "https://api.siliconflow.cn/v1",
            embeddingModel: "BAAI/bge-m3",
          },
        }),
      ),
    );

    expect(state.mode).toBe("server");
    expect(state.serverConfigured).toBe(true);
    expect(state.label).toBe("我的 DeepSeek");
    expect(state.api).toBe("openai-compatible");
    expect(state.baseUrl).toBe("https://api.deepseek.com/v1/");
    expect(state.model).toBe("deepseek-chat");
    expect(state.options).toEqual({
      thinking: "deep",
      thinkingStatus: "verified",
      verification: false,
      embeddingBaseUrl: "https://api.siliconflow.cn/v1",
      embeddingModel: "BAAI/bge-m3",
    });

    const provider = state.provider as ProviderConfig;
    expect(provider).toMatchObject({
      label: "我的 DeepSeek",
      kind: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "",
      model: "deepseek-chat",
      thinking: "deep",
      thinkingStatus: "verified",
      verification: false,
    });
  });

  it("没有 llm 行时 serverConfigured=false、provider=null", () => {
    const state = applyServerConfigToProvider("server", configs(emptyEntry()));

    expect(state.serverConfigured).toBe(false);
    expect(state.provider).toBeNull();
    expect(state.options).toEqual({
      thinking: "off",
      thinkingStatus: "unknown",
      verification: true,
    });
  });

  it("删除后（行被清空）立即回到未配置，不保留上一次的地址", () => {
    const before = applyServerConfigToProvider("server", configs(entry()));
    expect(before.serverConfigured).toBe(true);

    const after = applyServerConfigToProvider("server", configs(emptyEntry()));
    expect(after.serverConfigured).toBe(false);
    expect(after.provider).toBeNull();
    expect(after.baseUrl).toBe("");
    expect(after.model).toBe("");
    expect(after.label).toBe("账号配置");
  });

  it("local 模式不把账号配置当成本机供应商，但仍报告服务端有没有存", () => {
    const state = applyServerConfigToProvider("local", configs(entry()));

    expect(state.mode).toBe("local");
    expect(state.serverConfigured).toBe(true);
    expect(state.provider).toBeNull();
  });

  it("configs 为 null、api 非法、options 类型错都不抛错", () => {
    const nullState = applyServerConfigToProvider("server", null);
    expect(nullState.serverConfigured).toBe(false);
    expect(nullState.provider).toBeNull();

    const weird = applyServerConfigToProvider(
      "server",
      configs(
        entry({
          api: "grpc",
          options: { thinking: 42, thinkingStatus: "bogus", verification: "yes" },
        }),
      ),
    );
    expect(weird.api).toBe("openai-compatible");
    expect(weird.options.thinking).toBe("off");
    expect(weird.options.thinkingStatus).toBe("unknown");
    expect(weird.options.verification).toBe(true);
  });

  it("configured=true 但地址/模型为空仍视为不可用", () => {
    const state = applyServerConfigToProvider(
      "server",
      configs(entry({ baseUrl: "  ", model: "" })),
    );

    expect(state.serverConfigured).toBe(false);
    expect(state.provider).toBeNull();
  });

  it("anthropic 协议被识别", () => {
    const state = applyServerConfigToProvider(
      "server",
      configs(entry({ api: "anthropic", baseUrl: "https://api.anthropic.com/v1" })),
    );

    expect(state.api).toBe("anthropic");
    expect(state.provider?.kind).toBe("anthropic");
  });
});

describe("parseServerConfigs", () => {
  it("非对象输入返回四个空槽位；options 只保留标量", () => {
    const parsed = parseServerConfigs({
      llm: { configured: true, options: { thinking: "deep", nested: { a: 1 }, n: 2 } },
    });

    expect(parsed.llm.configured).toBe(true);
    expect(parsed.llm.options).toEqual({ thinking: "deep", n: 2 });
    expect(parseServerConfigs(null).tts).toEqual(emptyEntry());
  });
});

describe("hydrateProviderFromServer", () => {
  it("成功时返回解析后的 state", async () => {
    stubFetch(() => jsonResponse({ config: { llm: entry() } }));

    const result = await hydrateProviderFromServer("server");

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.state.provider?.model).toBe("deepseek-chat");
  });

  it("401 时保留模式并返回可展示错误", async () => {
    stubFetch(() => jsonResponse({ error: { code: "unauthorized" } }, 401));

    const result = await hydrateProviderFromServer("local");

    expect(result.ok).toBe(false);
    expect(result.state.mode).toBe("local");
    expect(result.state.provider).toBeNull();
    expect(result.error).toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("explainConfigError", () => {
  it("每个码都有非空人话，且不带原始 code", () => {
    const codes = [
      "UNAUTHORIZED",
      "KEY_ENC_UNAVAILABLE",
      "PERSISTENCE_UNAVAILABLE",
      "CONFLICT_STALE",
      "SECRET_UNREADABLE",
      "INVALID",
      "BAD_RESPONSE",
      "NETWORK",
      "INTERNAL",
    ] as const;
    for (const code of codes) {
      const text = explainConfigError(code);
      expect(text.length).toBeGreaterThan(4);
      expect(text).not.toContain(code);
    }
  });
});
