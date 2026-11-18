import { describe, expect, it } from "vitest";

import {
  DEEPSEEK_SEARCH_URL,
  isDeepSeekBaseUrl,
  MAX_SEARCH_COUNT,
  searchDeepSeek,
  searchTavily,
  searchWikipedia,
  SearchUpstreamError,
  SEARCH_TIMEOUT_MS,
  TAVILY_SEARCH_URL,
  WIKIPEDIA_SEARCH_URL,
} from "@/lib/serverSearch";

describe("端点与超时常量", () => {
  it("三家端点写死，默认超时 15 秒", () => {
    expect(DEEPSEEK_SEARCH_URL).toBe("https://api.deepseek.com/v1/tools/search");
    expect(TAVILY_SEARCH_URL).toBe("https://api.tavily.com/search");
    expect(WIKIPEDIA_SEARCH_URL).toBe("https://zh.wikipedia.org/w/api.php");
    expect(SEARCH_TIMEOUT_MS).toBe(15_000);
  });
});

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

function fetchReturning(make: () => Response): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return make();
  }) as typeof fetch;
  return { impl, calls };
}

function bodyOf(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

function headerOf(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

describe("searchDeepSeek", () => {
  it("固定端点、Bearer 与 query/count/need_content 三字段", async () => {
    const { impl, calls } = fetchReturning(() =>
      jsonResponse({
        results: [
          { title: "A", url: "https://a.example/x", summary: "摘要 A", rerank_score: 0.9 },
          { title: "B", url: "https://b.example/y", snippet: "摘要 B" },
        ],
      }),
    );

    const results = await searchDeepSeek("  sk-ds-secret  ", "  栈   与队列 ", 3, {
      fetchImpl: impl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(DEEPSEEK_SEARCH_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(headerOf(calls[0], "authorization")).toBe("Bearer sk-ds-secret");
    expect(bodyOf(calls[0])).toEqual({
      query: "栈 与队列",
      count: 3,
      need_content: true,
    });
    expect(results.map((item) => item.url)).toEqual([
      "https://a.example/x",
      "https://b.example/y",
    ]);
    expect(results.every((item) => item.provider === "deepseek")).toBe(true);
  });

  it("count 越界夹紧到 1..MAX_SEARCH_COUNT", async () => {
    const { impl, calls } = fetchReturning(() =>
      jsonResponse({ results: [{ title: "A", url: "https://a.example" }] }),
    );
    await searchDeepSeek("k", "q", 99, { fetchImpl: impl });
    await searchDeepSeek("k", "q", 0, { fetchImpl: impl });

    expect(bodyOf(calls[0]).count).toBe(MAX_SEARCH_COUNT);
    expect(bodyOf(calls[1]).count).toBe(1);
  });

  it("没有密钥时不发请求，错误 kind 为 auth", async () => {
    const { impl, calls } = fetchReturning(() => jsonResponse({ results: [] }));
    await expect(searchDeepSeek("   ", "q", 3, { fetchImpl: impl })).rejects.toMatchObject({
      kind: "auth",
    });
    expect(calls).toHaveLength(0);
  });

  it("401 归为 auth，错误信息里的密钥被替换", async () => {
    const { impl } = fetchReturning(() =>
      textResponse("invalid api key: sk-ds-secret", 401),
    );

    const error = await searchDeepSeek("sk-ds-secret", "q", 3, { fetchImpl: impl }).catch(
      (value: unknown) => value,
    );

    expect(error).toBeInstanceOf(SearchUpstreamError);
    expect((error as SearchUpstreamError).kind).toBe("auth");
    expect((error as SearchUpstreamError).status).toBe(401);
    expect((error as SearchUpstreamError).message).not.toContain("sk-ds-secret");
    expect((error as SearchUpstreamError).message).toContain("***");
  });

  it("429 归为 rate-limit，500 归为 http", async () => {
    const rate = fetchReturning(() => textResponse("slow down", 429));
    await expect(
      searchDeepSeek("k", "q", 3, { fetchImpl: rate.impl }),
    ).rejects.toMatchObject({ kind: "rate-limit", status: 429 });

    const http = fetchReturning(() => textResponse("boom", 500));
    await expect(
      searchDeepSeek("k", "q", 3, { fetchImpl: http.impl }),
    ).rejects.toMatchObject({ kind: "http", status: 500 });
  });

  it("非 JSON 归为 parse，0 条结果归为 empty", async () => {
    const bad = fetchReturning(() => textResponse("<html>gateway</html>", 200));
    await expect(
      searchDeepSeek("k", "q", 3, { fetchImpl: bad.impl }),
    ).rejects.toMatchObject({ kind: "parse" });

    const empty = fetchReturning(() => jsonResponse({ results: [] }));
    await expect(
      searchDeepSeek("k", "q", 3, { fetchImpl: empty.impl }),
    ).rejects.toMatchObject({ kind: "empty" });
  });

  it("超时归为 timeout，且不会等到 15 秒", async () => {
    const impl = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as typeof fetch;

    await expect(
      searchDeepSeek("k", "q", 3, { fetchImpl: impl, timeoutMs: 5 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("响应头到了但正文一直不结束时也会超时", async () => {
    // 模拟「连上了、发了头、再也不发正文」；计时器必须覆盖 res.text()。
    const { impl } = fetchReturning(() =>
      new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      searchDeepSeek("k", "q", 3, { fetchImpl: impl, timeoutMs: 5 }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("3xx 不自动跟随，归为 http", async () => {
    const { impl } = fetchReturning(() => new Response("", { status: 302 }));
    await expect(
      searchDeepSeek("k", "q", 3, { fetchImpl: impl }),
    ).rejects.toMatchObject({ kind: "http", status: 302 });
  });
});

describe("searchTavily", () => {
  it("固定端点与浏览器直连同一套请求字段", async () => {
    const { impl, calls } = fetchReturning(() =>
      jsonResponse({
        results: [{ title: "T", url: "https://t.example/a", content: "内容" }],
      }),
    );

    const results = await searchTavily("tvly-secret", "图论", { fetchImpl: impl });

    expect(calls[0].url).toBe(TAVILY_SEARCH_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(headerOf(calls[0], "authorization")).toBe("Bearer tvly-secret");
    expect(bodyOf(calls[0])).toMatchObject({
      query: "图论",
      search_depth: "basic",
      max_results: 4,
      include_answer: false,
      include_raw_content: false,
    });
    expect(results[0].provider).toBe("tavily");
  });
});

describe("searchWikipedia", () => {
  it("免密钥、固定 zh.wikipedia.org，返回带 oldid 的稳定链接", async () => {
    const { impl, calls } = fetchReturning(() =>
      jsonResponse({
        query: {
          pages: {
            "11": {
              pageid: 11,
              title: "栈",
              fullurl: "https://zh.wikipedia.org/wiki/%E6%A0%88",
              extract: "栈是一种后进先出的数据结构。",
              index: 1,
              revisions: [{ revid: 12345 }],
            },
          },
        },
      }),
    );

    const results = await searchWikipedia("栈", { fetchImpl: impl });

    expect(calls[0].url.startsWith(`${WIKIPEDIA_SEARCH_URL}?`)).toBe(true);
    const query = new URL(calls[0].url).searchParams;
    expect(query.get("gsrsearch")).toBe("栈");
    expect(query.get("generator")).toBe("search");
    expect(headerOf(calls[0], "authorization")).toBeNull();
    expect(results[0].provider).toBe("wikipedia");
    expect(results[0].url).toContain("oldid=12345");
  });
});

describe("isDeepSeekBaseUrl", () => {
  it("只认 https 的 api.deepseek.com，拒绝相似域名与 http", () => {
    expect(isDeepSeekBaseUrl("https://api.deepseek.com")).toBe(true);
    expect(isDeepSeekBaseUrl("https://api.deepseek.com/v1")).toBe(true);
    expect(isDeepSeekBaseUrl("https://API.DEEPSEEK.COM./v1")).toBe(true);
    expect(isDeepSeekBaseUrl("http://api.deepseek.com/v1")).toBe(false);
    expect(isDeepSeekBaseUrl("https://api.deepseek.com.evil.example/v1")).toBe(false);
    expect(isDeepSeekBaseUrl("https://api.deepseek.cn/v1")).toBe(false);
    expect(isDeepSeekBaseUrl("")).toBe(false);
    expect(isDeepSeekBaseUrl(undefined)).toBe(false);
  });
});
