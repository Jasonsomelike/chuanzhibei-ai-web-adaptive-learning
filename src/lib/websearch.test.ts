import { describe, expect, it } from "vitest";

import {
  MAX_SEARCH_QUERY_CHARS,
  MAX_SNIPPET_CHARS,
  MAX_WEB_RESULTS,
  buildSearchQuery,
  formatWebContext,
  normalizeTavily,
  normalizeWikipedia,
  parseWebCitations,
  webCitationLabel,
  webHits,
  type WebResult,
} from "@/lib/websearch";

function points(text: string): number {
  return Array.from(text).length;
}

function webResult(overrides: Partial<WebResult> = {}): WebResult {
  return {
    title: "栈",
    url: "https://example.com/stack",
    snippet: "后进先出",
    provider: "tavily",
    ...overrides,
  };
}

describe("buildSearchQuery", () => {
  it("把问题与前几个知识点名拼在一起，且不超过 120 个码点", () => {
    const query = buildSearchQuery("栈和队列有什么区别？", ["栈", "队列", "循环队列"]);

    expect(query).toContain("栈和队列有什么区别？");
    expect(query).toContain("栈");
    expect(query).toContain("队列");
    expect(query).toContain("循环队列");
    expect(points(query)).toBeLessThanOrEqual(MAX_SEARCH_QUERY_CHARS);
  });

  it("问题很长时先截问题，仍保留第一个知识点名", () => {
    const query = buildSearchQuery("为".repeat(400), ["栈", "队列"]);

    expect(points(query)).toBe(MAX_SEARCH_QUERY_CHARS);
    expect(query.endsWith(" 栈")).toBe(true);
  });

  it("知识点名去重、忽略空白", () => {
    const query = buildSearchQuery("两种结构有什么区别？", ["", "  二叉树  ", "二叉树", " 遍历 "]);

    expect(query).toBe("两种结构有什么区别？ 二叉树 遍历");
  });

  it("问题为空时退化为知识点名", () => {
    expect(buildSearchQuery("   ", ["栈", "队列"])).toBe("栈 队列");
  });

  it("没有知识点名时只截问题", () => {
    expect(buildSearchQuery("为".repeat(200), [])).toBe("为".repeat(MAX_SEARCH_QUERY_CHARS));
  });

  it("单个知识点名占满预算时优先保留问题", () => {
    expect(buildSearchQuery("问题", ["知".repeat(MAX_SEARCH_QUERY_CHARS - 1)])).toBe("问题");
  });
});

describe("normalizeTavily", () => {
  it("取 title/url/content 并截断 content", () => {
    const long = "甲".repeat(MAX_SNIPPET_CHARS + 50);
    const results = normalizeTavily({
      results: [
        { title: " 栈（数据结构） ", url: " https://example.com/stack ", content: long },
        { title: "队列", url: "https://example.com/queue", content: "先进\n先出" },
      ],
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "栈（数据结构）",
      url: "https://example.com/stack",
      provider: "tavily",
    });
    expect(points(results[0].snippet)).toBe(MAX_SNIPPET_CHARS);
    expect(results[1].snippet).toBe("先进 先出");
  });

  it("标题为空时用域名兜底", () => {
    const [result] = normalizeTavily({
      results: [{ title: "  ", url: "https://www.example.org/queue", content: "先进先出" }],
    });

    expect(result.title).toBe("example.org");
  });

  it("丢弃非 http(s) 链接与非对象条目", () => {
    const results = normalizeTavily({
      results: [
        { title: "空链接", url: "" },
        { title: "脚本", url: "javascript:alert(1)" },
        { title: "相对路径", url: "/wiki/Stack" },
        null,
        "文本",
        { title: "正常", url: "https://ok.example/a", content: "ok" },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://ok.example/a");
  });

  it("按 URL 去重并限制条数", () => {
    const duplicated = normalizeTavily({
      results: [
        { title: "一", url: "https://example.com/a", content: "a" },
        { title: "二", url: "https://example.com/a", content: "b" },
      ],
    });
    expect(duplicated).toHaveLength(1);

    const many = normalizeTavily({
      results: Array.from({ length: MAX_WEB_RESULTS + 2 }, (_, i) => ({
        title: `结果${i}`,
        url: `https://example.com/${i}`,
        content: "x",
      })),
    });
    expect(many).toHaveLength(MAX_WEB_RESULTS);
  });

  it("坏响应返回空数组", () => {
    expect(normalizeTavily(null)).toEqual([]);
    expect(normalizeTavily({})).toEqual([]);
    expect(normalizeTavily({ results: "不是数组" })).toEqual([]);
  });
});

describe("normalizeWikipedia", () => {
  it("query.pages 是对象：先 Object.values 再按 index 排序", () => {
    const results = normalizeWikipedia({
      query: {
        pages: {
          // pageid 作为对象键会按数字大小排列；index 才是检索相关度顺序
          "200": {
            pageid: 200,
            title: "栈",
            index: 1,
            extract: "后进先出。\n\n只能在栈顶插入和删除。",
            fullurl: "https://zh.wikipedia.org/wiki/%E6%A0%88",
            revisions: [{ revid: 1234567 }],
          },
          "100": {
            pageid: 100,
            title: "队列",
            index: 2,
            extract: "先进先出。",
            fullurl: "https://zh.wikipedia.org/wiki/%E9%98%9F%E5%88%97",
            revisions: [{ revid: 7654321 }],
          },
        },
      },
    });

    expect(results.map((r) => r.title)).toEqual(["栈", "队列"]);
    expect(results[0].provider).toBe("wikipedia");
    expect(results[0].snippet).toBe("后进先出。 只能在栈顶插入和删除。");
  });

  it("有 revisions 时链接带 oldid，并保留 revision", () => {
    const [result] = normalizeWikipedia({
      query: {
        pages: {
          "1": {
            title: "栈",
            index: 1,
            extract: "后进先出",
            fullurl: "https://zh.wikipedia.org/wiki/%E6%A0%88",
            revisions: [{ revid: 1234567, timestamp: "2026-01-01T00:00:00Z" }],
          },
        },
      },
    });

    expect(result.url).toBe("https://zh.wikipedia.org/wiki/%E6%A0%88?oldid=1234567");
    expect(result.revision).toBe("1234567");
  });

  it("已有查询串与锚点时 oldid 追加在锚点之前", () => {
    const [result] = normalizeWikipedia({
      query: {
        pages: {
          "1": {
            title: "X",
            index: 1,
            fullurl: "https://zh.wikipedia.org/wiki/X?utm=1#History",
            revisions: [{ revid: "9" }],
          },
        },
      },
    });

    expect(result.url).toBe("https://zh.wikipedia.org/wiki/X?utm=1&oldid=9#History");
    expect(result.revision).toBe("9");
  });

  it("没有 revisions 时不编 oldid", () => {
    const [result] = normalizeWikipedia({
      query: {
        pages: {
          "1": {
            title: "图",
            index: 1,
            extract: "图论",
            fullurl: "https://zh.wikipedia.org/wiki/Graph",
          },
        },
      },
    });

    expect(result.url).toBe("https://zh.wikipedia.org/wiki/Graph");
    expect(result.revision).toBeUndefined();
  });

  it("缺 URL 的页面无法引用，直接丢弃", () => {
    const results = normalizeWikipedia({
      query: { pages: { "1": { title: "无链接", index: 1, extract: "正文" } } },
    });

    expect(results).toEqual([]);
  });

  it("空 pages、数组形式与坏响应都不抛错", () => {
    expect(normalizeWikipedia({ query: { pages: {} } })).toEqual([]);
    expect(normalizeWikipedia({})).toEqual([]);
    expect(normalizeWikipedia(null)).toEqual([]);

    const [result] = normalizeWikipedia({
      query: {
        pages: [
          {
            title: "数组页",
            index: 1,
            extract: "正文",
            fullurl: "https://zh.wikipedia.org/wiki/Array",
          },
        ],
      },
    });
    expect(result.title).toBe("数组页");
  });
});

describe("formatWebContext", () => {
  it("空结果不生成空的网络上下文", () => {
    expect(formatWebContext([])).toBe("");
    expect(formatWebContext([webResult({ url: "javascript:alert(1)" })])).toBe("");
  });

  it("网络块带独立抬头与 [网络n]，与教材/讲义格式不同", () => {
    const text = formatWebContext([
      webResult({ title: "栈", url: "https://zh.wikipedia.org/wiki/Stack", snippet: "后进先出" }),
      webResult({ title: "队列", url: "https://example.com/queue", snippet: "先进先出" }),
    ]);

    expect(text).toContain("网络检索结果");
    expect(text).toContain("不可信");
    expect(text).toContain("[网络1] 《栈》 zh.wikipedia.org");
    expect(text).toContain("[网络2] 《队列》 example.com");
    expect(text).toContain("后进先出");
    expect(text).toContain("先进先出");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("[教材·");
    expect(text).not.toContain("[讲义·");
  });

  it("只有一条结果时引用范围写成 [网络1]", () => {
    const text = formatWebContext([webResult()]);

    expect(text).toContain("引用时写 [网络1]，");
    expect(text).not.toContain("…");
  });

  it("摘要为空时只输出抬头", () => {
    const text = formatWebContext([webResult({ snippet: "   " })]);

    expect(text.endsWith("[网络1] 《栈》 example.com")).toBe(true);
  });

  it("手动传入的超长摘要也会被截断", () => {
    const text = formatWebContext([
      webResult({ snippet: "甲".repeat(MAX_SNIPPET_CHARS + 10) }),
    ]);

    expect(text).toContain("甲".repeat(MAX_SNIPPET_CHARS));
    expect(text).not.toContain("甲".repeat(MAX_SNIPPET_CHARS + 1));
  });

  it("最多注入四条结果", () => {
    const results = Array.from({ length: MAX_WEB_RESULTS + 2 }, (_, i) =>
      webResult({ title: `结果${i}`, url: `https://example.com/${i}` }),
    );
    const text = formatWebContext(results);

    expect(text).toContain(`[网络${MAX_WEB_RESULTS}]`);
    expect(text).not.toContain(`[网络${MAX_WEB_RESULTS + 1}]`);
  });
});

describe("parseWebCitations", () => {
  it("只返回回答里实际出现且在范围内的 [网络n]", () => {
    const answer = "栈后进先出[网络1]；队列先进先出[网络3]；重复[网络1]，越界[网络5]，零[网络0]。";

    expect(parseWebCitations(answer, 4)).toEqual(new Set([1, 3]));
    expect(parseWebCitations(answer, 1)).toEqual(new Set([1]));
  });

  it("没有引用时返回空集合，不把全部结果当已使用", () => {
    expect(parseWebCitations("这段回答没有引用任何网页。", 4)).toEqual(new Set());
    expect(parseWebCitations("", 4)).toEqual(new Set());
  });

  it("支持全角括号与括号内空格", () => {
    expect(parseWebCitations("【网络2】 与 [网络 4]", 4)).toEqual(new Set([2, 4]));
  });

  it("忽略没有括号的写法与非法条数", () => {
    expect(parseWebCitations("网络1", 4)).toEqual(new Set());
    expect(parseWebCitations("[网络1]", 0)).toEqual(new Set());
    expect(parseWebCitations("[网络1]", Number.NaN)).toEqual(new Set());
  });
});

describe("webCitationLabel 与 webHits", () => {
  it("抬头是《标题》加域名，并去掉 www.", () => {
    expect(
      webCitationLabel({
        title: " 栈 ",
        url: "https://www.example.com/a",
        snippet: "",
        provider: "tavily",
      }),
    ).toBe("《栈》 example.com");
  });

  it("空标题用「未命名来源」，非法 URL 不带域名", () => {
    expect(
      webCitationLabel({ title: "", url: "https://example.com/a", snippet: "", provider: "tavily" }),
    ).toBe("《未命名来源》 example.com");
    expect(
      webCitationLabel({ title: "无链接", url: "不是 URL", snippet: "", provider: "tavily" }),
    ).toBe("《无链接》");
  });

  it("编号从 1 开始、跳过非法与重复 URL", () => {
    const hits = webHits([
      webResult({ title: "一", url: "https://example.com/a" }),
      webResult({ title: "重复", url: "https://example.com/a" }),
      webResult({ title: "脚本", url: "javascript:alert(1)" }),
      webResult({ title: "二", url: "https://example.com/b" }),
    ]);

    expect(hits.map((h) => h.ref)).toEqual([1, 2]);
    expect(hits.map((h) => h.title)).toEqual(["一", "二"]);
    expect(hits[0].label).toBe(webCitationLabel(hits[0]));
  });
});

describe("检索结果闭环", () => {
  it("归一化 → 上下文 → 引用解析互相对齐", () => {
    const results = normalizeTavily({
      results: [
        { title: "栈", url: "https://example.com/stack", content: "后进先出" },
        { title: "队列", url: "https://example.com/queue", content: "先进先出" },
      ],
    });
    const context = formatWebContext(results);
    const answer = "先看栈[网络1]，再看队列[网络2]，不引用第三条[网络3]。";

    expect(context).toContain("[网络1] 《栈》 example.com");
    expect(context).toContain("[网络2] 《队列》 example.com");
    expect(parseWebCitations(answer, results.length)).toEqual(new Set([1, 2]));
  });
});
