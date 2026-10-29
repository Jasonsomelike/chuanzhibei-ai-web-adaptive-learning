import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SEARCH_CONFIG,
  SEARCH_CACHE_TTL_MS,
  SEARCH_CONFIG_KEY,
  SEARCH_TIMEOUT_MS,
  SearchError,
  loadSearchConfig,
  resolveSearchProvider,
  saveSearchConfig,
  searchCacheKey,
  searchTavily,
  searchWeb,
  searchWikipedia,
  type SearchConfig,
} from "@/lib/searchClient";

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

function config(overrides: Partial<SearchConfig> = {}): SearchConfig {
  return { ...DEFAULT_SEARCH_CONFIG, ...overrides };
}

function stubBrowser(): { localStorage: MemoryStorage; sessionStorage: MemoryStorage } {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage, sessionStorage });
  return { localStorage, sessionStorage };
}

type FetchHandler = (url: string, init: RequestInit) => Promise<Response> | Response;

function stubFetch(handler: FetchHandler): {
  calls: { url: string; init: RequestInit }[];
  mock: ReturnType<typeof vi.fn>;
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const mock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const requestInit = init ?? {};
      calls.push({ url, init: requestInit });
      return handler(url, requestInit);
    },
  );
  vi.stubGlobal("fetch", mock);
  return { calls, mock };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function searchErrorOf(promise: Promise<unknown>): Promise<SearchError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SearchError) return err;
    throw err;
  }
  throw new Error("预期搜索失败，但它成功了");
}

const tavilyPayload = {
  results: [
    { title: "栈", url: "https://example.com/stack", content: "后进先出" },
    { title: "队列", url: "https://example.com/queue", content: "先进先出" },
  ],
};

const wikiPayload = {
  query: {
    pages: {
      // pageid 作为对象键会按数字大小重排；index 才是检索顺序
      "2": {
        title: "队列",
        index: 2,
        extract: "先进先出。",
        fullurl: "https://zh.wikipedia.org/wiki/队列",
        revisions: [{ revid: 22, timestamp: "2026-01-01T00:00:00Z" }],
      },
      "1": {
        title: "栈",
        index: 1,
        extract: "后进先出。",
        fullurl: "https://zh.wikipedia.org/wiki/栈",
        revisions: [{ revid: 11, timestamp: "2026-01-01T00:00:00Z" }],
      },
    },
  },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("搜索配置", () => {
  it("SSR（没有 window）时返回默认值，保存不抛错", () => {
    vi.stubGlobal("window", undefined);

    expect(loadSearchConfig()).toEqual(DEFAULT_SEARCH_CONFIG);
    expect(() =>
      saveSearchConfig(config({ provider: "tavily", tavilyApiKey: "k", defaultOn: true })),
    ).not.toThrow();
  });

  it("三个字段完整往返（保存后刷新仍在）", () => {
    const { localStorage } = stubBrowser();

    saveSearchConfig(
      config({ provider: "tavily", tavilyApiKey: "  tvly-secret  ", defaultOn: true }),
    );

    expect(loadSearchConfig()).toEqual({
      provider: "tavily",
      tavilyApiKey: "tvly-secret",
      defaultOn: true,
    });

    const raw = JSON.parse(localStorage.getItem(SEARCH_CONFIG_KEY) ?? "null") as Record<
      string,
      unknown
    >;
    expect(Object.keys(raw).sort()).toEqual(["defaultOn", "provider", "tavilyApiKey"]);
  });

  it("坏 JSON 与非法字段回落到默认值", () => {
    const { localStorage } = stubBrowser();

    localStorage.setItem(SEARCH_CONFIG_KEY, "{not json");
    expect(loadSearchConfig()).toEqual(DEFAULT_SEARCH_CONFIG);

    localStorage.setItem(
      SEARCH_CONFIG_KEY,
      JSON.stringify({ provider: "brave", tavilyApiKey: 42, defaultOn: "true" }),
    );
    expect(loadSearchConfig()).toEqual({
      provider: "wikipedia",
      tavilyApiKey: "",
      defaultOn: false,
    });
  });

  it("localStorage 属性访问就抛错时仍读到默认值，保存不冒泡", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
      sessionStorage: new MemoryStorage(),
    });

    expect(loadSearchConfig()).toEqual(DEFAULT_SEARCH_CONFIG);
    expect(() => saveSearchConfig(DEFAULT_SEARCH_CONFIG)).not.toThrow();
  });

  it("localStorage 的 getItem/setItem 抛错也不冒泡", () => {
    const broken = {
      length: 0,
      clear() {
        throw new Error("denied");
      },
      getItem() {
        throw new Error("denied");
      },
      key() {
        throw new Error("denied");
      },
      removeItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    } as Storage;

    vi.stubGlobal("window", { localStorage: broken, sessionStorage: new MemoryStorage() });

    expect(loadSearchConfig()).toEqual(DEFAULT_SEARCH_CONFIG);
    expect(() => saveSearchConfig(config({ provider: "tavily", tavilyApiKey: "k" }))).not.toThrow();
  });

  it("没有 Tavily 密钥时选定维基百科并说明原因", () => {
    expect(resolveSearchProvider(config({ provider: "tavily", tavilyApiKey: "  " }))).toEqual({
      provider: "wikipedia",
      notice: expect.stringContaining("维基百科"),
    });
    expect(resolveSearchProvider(config({ provider: "tavily", tavilyApiKey: "k" }))).toEqual({
      provider: "tavily",
      notice: null,
    });
  });
});

describe("searchTavily", () => {
  it("POST /search，Bearer 头、basic、4 条，且不请求 raw_content", async () => {
    const { calls } = stubFetch(() => jsonResponse(tavilyPayload));

    const results = await searchTavily("  栈   队列 ", " tvly-test-key ");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.tavily.com/search");
    expect(calls[0].init.method).toBe("POST");

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tvly-test-key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      query: "栈 队列",
      search_depth: "basic",
      max_results: 4,
      include_answer: false,
      include_raw_content: false,
    });
    expect(body).not.toHaveProperty("raw_content");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "栈",
      url: "https://example.com/stack",
      snippet: "后进先出",
      provider: "tavily",
    });
  });

  it("空密钥不发请求", async () => {
    const { mock } = stubFetch(() => jsonResponse(tavilyPayload));

    const err = await searchErrorOf(searchTavily("栈", "   "));

    expect(err.kind).toBe("no-key");
    expect(mock).not.toHaveBeenCalled();
  });

  it("429 归为限流，并给中文提示", async () => {
    stubFetch(() => new Response("rate limited", { status: 429 }));

    const err = await searchErrorOf(searchTavily("栈", "key"));

    expect(err.kind).toBe("rate-limit");
    expect(err.message).toContain("限流");
  });

  it("401 归为密钥无效", async () => {
    stubFetch(() => new Response("invalid key", { status: 401 }));

    const err = await searchErrorOf(searchTavily("栈", "key"));

    expect(err.kind).toBe("auth");
    expect(err.message).toContain("密钥");
  });

  it("5xx 归为服务暂时不可用", async () => {
    stubFetch(() => new Response("oops", { status: 503 }));

    const err = await searchErrorOf(searchTavily("栈", "key"));

    expect(err.kind).toBe("http");
    expect(err.message).toContain("503");
  });

  it("CORS/网络失败（fetch 抛 TypeError）归为浏览器直连问题", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const err = await searchErrorOf(searchTavily("栈", "key"));

    expect(err.kind).toBe("cors");
    expect(err.message).toContain("浏览器直连");
  });

  it("响应不是 JSON 时归为解析失败", async () => {
    stubFetch(() => new Response("not json", { status: 200 }));

    const err = await searchErrorOf(searchTavily("栈", "key"));

    expect(err.kind).toBe("parse");
    expect(err.message).toContain("解析");
  });

  it("0 条结果归为空结果", async () => {
    stubFetch(() => jsonResponse({ results: [] }));

    const err = await searchErrorOf(searchTavily("栈", "key"));

    expect(err.kind).toBe("empty");
    expect(err.message).toContain("没有找到可用结果");
  });

  it("15 秒未响应归为超时", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );

    const pending = searchErrorOf(searchTavily("栈", "key"));
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS);
    const err = await pending;

    expect(err.kind).toBe("timeout");
    expect(err.message).toContain("15");
  });
});

describe("searchWikipedia", () => {
  it("GET Action API：origin=*、extracts/revisions、3 条与 oldid 链接", async () => {
    const { calls } = stubFetch(() => jsonResponse(wikiPayload));

    const results = await searchWikipedia("栈 队列");

    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("GET");
    expect((calls[0].init.headers as Record<string, string>).Accept).toBe("application/json");

    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe("https://zh.wikipedia.org/w/api.php");
    // 必须是字面量 origin=*；服务端按原样匹配
    expect(calls[0].url).toContain("origin=*");
    expect(url.searchParams.get("origin")).toBe("*");
    expect(url.searchParams.get("action")).toBe("query");
    expect(url.searchParams.get("generator")).toBe("search");
    expect(url.searchParams.get("gsrsearch")).toBe("栈 队列");
    expect(url.searchParams.get("gsrlimit")).toBe("3");
    expect(url.searchParams.get("prop")).toBe("extracts|info|revisions");
    expect(url.searchParams.get("exintro")).toBe("1");
    expect(url.searchParams.get("explaintext")).toBe("1");
    expect(url.searchParams.get("inprop")).toBe("url");
    expect(url.searchParams.get("rvprop")).toBe("ids|timestamp");
    expect(url.searchParams.get("format")).toBe("json");

    // index 排序，不按 pageid 数字键
    expect(results.map((r) => r.title)).toEqual(["栈", "队列"]);
    expect(results[0].provider).toBe("wikipedia");
    expect(results[0].url).toBe("https://zh.wikipedia.org/wiki/%E6%A0%88?oldid=11");
    expect(results[0].revision).toBe("11");
  });

  it("0 条结果归为空结果", async () => {
    stubFetch(() => jsonResponse({ query: { pages: {} } }));

    const err = await searchErrorOf(searchWikipedia("无此条目"));

    expect(err.kind).toBe("empty");
    expect(err.message).toContain("没有找到可用结果");
  });

  it("429 也归为限流", async () => {
    stubFetch(() => new Response("rate limited", { status: 429 }));

    const err = await searchErrorOf(searchWikipedia("栈"));

    expect(err.kind).toBe("rate-limit");
  });
});

describe("searchWeb", () => {
  it("没填 Tavily 密钥时自动走维基百科，并说明原因", async () => {
    const { calls } = stubFetch(() => jsonResponse(wikiPayload));

    const outcome = await searchWeb("栈", config({ provider: "tavily", tavilyApiKey: "  " }));

    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith("https://zh.wikipedia.org/w/api.php?")).toBe(true);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();

    expect(outcome.provider).toBe("wikipedia");
    expect(outcome.notice).toContain("Tavily");
    expect(outcome.notice).toContain("维基百科");
    expect(outcome.error).toBeNull();
    expect(outcome.errorKind).toBeNull();
    expect(outcome.fromCache).toBe(false);
    expect(outcome.results.map((r) => r.title)).toEqual(["栈", "队列"]);
  });

  it("有密钥时走 Tavily", async () => {
    const { calls } = stubFetch(() => jsonResponse(tavilyPayload));

    const outcome = await searchWeb(
      "栈",
      config({ provider: "tavily", tavilyApiKey: "tvly-k" }),
    );

    expect(calls[0].url).toBe("https://api.tavily.com/search");
    expect(outcome.provider).toBe("tavily");
    expect(outcome.notice).toBeNull();
    expect(outcome.error).toBeNull();
    expect(outcome.results).toHaveLength(2);
  });

  it("搜索失败只返回错误信息，不向调用方抛错", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const outcome = await searchWeb("栈", config());

    expect(outcome.results).toEqual([]);
    expect(outcome.errorKind).toBe("cors");
    expect(outcome.error).toContain("浏览器直连");
  });

  it("检索词为空时不发请求", async () => {
    const { mock } = stubFetch(() => jsonResponse(wikiPayload));

    const outcome = await searchWeb("   ", config());

    expect(mock).not.toHaveBeenCalled();
    expect(outcome.errorKind).toBe("empty");
  });

  it("外部取消时不发请求，也不报成超时", async () => {
    const controller = new AbortController();
    controller.abort();
    const { mock } = stubFetch(() => jsonResponse(wikiPayload));

    const outcome = await searchWeb("栈", config(), controller.signal);

    expect(mock).not.toHaveBeenCalled();
    expect(outcome.errorKind).toBe("aborted");
    expect(outcome.results).toEqual([]);
  });

  it("超时折成可展示的错误而不是 reject", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );

    const pending = searchWeb("栈", config());
    const assertion = expect(pending).resolves.toMatchObject({
      errorKind: "timeout",
      results: [],
    });
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS);
    await assertion;
  });
});

describe("30 分钟会话缓存", () => {
  it("同供应商同查询命中缓存；空白归一化算同一查询", async () => {
    const { sessionStorage } = stubBrowser();
    const { mock } = stubFetch(() => jsonResponse(tavilyPayload));
    const cfg = config({ provider: "tavily", tavilyApiKey: "k" });

    const first = await searchWeb("栈 队列", cfg);
    const second = await searchWeb("  栈   队列  ", cfg);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.results).toEqual(first.results);
    expect(second.error).toBeNull();
    expect(sessionStorage.getItem(searchCacheKey("tavily", "栈 队列"))).not.toBeNull();
    expect(searchCacheKey("wikipedia", " 栈 ")).toBe("alp.websearch.v1:wikipedia:栈");
  });

  it("不同供应商的缓存互不串用", async () => {
    stubBrowser();
    const { mock } = stubFetch((url) =>
      jsonResponse(url.includes("tavily") ? tavilyPayload : wikiPayload),
    );

    await searchWeb("栈", config({ provider: "wikipedia" }));
    await searchWeb("栈", config({ provider: "tavily", tavilyApiKey: "k" }));

    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("超过 30 分钟重新请求", async () => {
    const { sessionStorage } = stubBrowser();
    const { mock } = stubFetch(() => jsonResponse(tavilyPayload));
    const cfg = config({ provider: "tavily", tavilyApiKey: "k" });

    await searchWeb("栈", cfg);

    const key = searchCacheKey("tavily", "栈");
    const entry = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
      at: number;
      results: unknown[];
    };
    entry.at = Date.now() - SEARCH_CACHE_TTL_MS - 1;
    sessionStorage.setItem(key, JSON.stringify(entry));

    const second = await searchWeb("栈", cfg);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(second.fromCache).toBe(false);
  });

  it("失败不缓存：第二次仍会重新请求", async () => {
    stubBrowser();
    const { mock } = stubFetch(() => new Response("rate limited", { status: 429 }));
    const cfg = config({ provider: "tavily", tavilyApiKey: "k" });

    const first = await searchWeb("栈", cfg);
    const second = await searchWeb("栈", cfg);

    expect(first.errorKind).toBe("rate-limit");
    expect(second.errorKind).toBe("rate-limit");
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("0 结果不缓存", async () => {
    stubBrowser();
    const { mock } = stubFetch(() => jsonResponse({ results: [] }));
    const cfg = config({ provider: "tavily", tavilyApiKey: "k" });

    await searchWeb("栈", cfg);
    await searchWeb("栈", cfg);

    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("坏缓存当未命中，不影响本次搜索", async () => {
    const { sessionStorage } = stubBrowser();
    sessionStorage.setItem(searchCacheKey("wikipedia", "栈"), "{not json");
    const { mock } = stubFetch(() => jsonResponse(wikiPayload));

    const outcome = await searchWeb("栈", config());

    expect(mock).toHaveBeenCalledTimes(1);
    expect(outcome.fromCache).toBe(false);
    expect(outcome.error).toBeNull();
    expect(outcome.results).toHaveLength(2);
  });

  it("sessionStorage 属性访问抛错时搜索照常返回", async () => {
    vi.stubGlobal("window", {
      localStorage: new MemoryStorage(),
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    stubFetch(() => jsonResponse(wikiPayload));

    const outcome = await searchWeb("栈", config());

    expect(outcome.error).toBeNull();
    expect(outcome.fromCache).toBe(false);
    expect(outcome.results).toHaveLength(2);
  });

  it("sessionStorage 的读写方法抛错时搜索照常返回", async () => {
    const broken = {
      length: 0,
      clear() {
        throw new Error("denied");
      },
      getItem() {
        throw new Error("denied");
      },
      key() {
        throw new Error("denied");
      },
      removeItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    } as Storage;

    vi.stubGlobal("window", { localStorage: new MemoryStorage(), sessionStorage: broken });
    stubFetch(() => jsonResponse(wikiPayload));

    const outcome = await searchWeb("栈", config());

    expect(outcome.error).toBeNull();
    expect(outcome.results).toHaveLength(2);
  });
});
