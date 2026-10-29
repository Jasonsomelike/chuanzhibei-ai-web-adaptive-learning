import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMBEDDING_CACHE_LIMIT,
  EMBEDDINGS_BATCH_SIZE,
  clearEmbeddingCache,
  embedResultOf,
  embedTexts,
  embeddingCacheSize,
} from "@/lib/embeddingClient";

interface EmbedCall {
  readonly url: string;
  readonly texts: readonly string[];
  readonly headers: Record<string, string>;
}

/**
 * 假向量服务：按请求里的 texts 生成同维向量。
 * 默认不回 model 字段（服务端会回显自报的模型名，这里省略等价于「与请求一致」）。
 */
function stubEmbeddings(
  respond: (texts: readonly string[]) => Response | Promise<Response> = (texts) =>
    jsonResponse({ dim: 3, vectors: texts.map(textVector) }),
): EmbedCall[] {
  const calls: EmbedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body)) as { texts: string[] };
      calls.push({
        url,
        texts: body.texts,
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return respond(body.texts);
    }),
  );
  return calls;
}

function textVector(text: string): number[] {
  return [text.length, 1, 0];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearEmbeddingCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("embedTexts 请求形状", () => {
  it("POST /api/llm/embeddings，只带 texts，不出现 model / baseUrl / apiKey", async () => {
    const calls = stubEmbeddings();

    const outcome = await embedTexts(["第一段", "第二段"], { model: "text-embedding-v3" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/llm/embeddings");
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].texts).toEqual(["第一段", "第二段"]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.model).toBe("text-embedding-v3");
      expect(outcome.dim).toBe(3);
      expect(outcome.vectors).toHaveLength(2);
    }
  });

  it("超过 64 条按 64 条一批拆分", async () => {
    const calls = stubEmbeddings();
    const texts = Array.from({ length: EMBEDDINGS_BATCH_SIZE + 5 }, (_, i) => `片段${i}`);

    const outcome = await embedTexts(texts, { model: "text-embedding-v3" });

    expect(calls).toHaveLength(2);
    expect(calls[0].texts).toHaveLength(EMBEDDINGS_BATCH_SIZE);
    expect(calls[1].texts).toHaveLength(5);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.vectors).toHaveLength(texts.length);
  });

  it("空输入不发请求", async () => {
    const calls = stubEmbeddings();
    const outcome = await embedTexts([]);
    expect(calls).toHaveLength(0);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.vectors).toEqual([]);
  });
});

describe("embedTexts 的降级信号", () => {
  it("404（账号没存配置）返回 unavailable，供调用方写 unsupported", async () => {
    stubEmbeddings(() =>
      jsonResponse({ error: { code: "CONFIG_MISSING", message: "该账号还没有保存模型配置" } }, 404),
    );

    const outcome = await embedTexts(["问"], { model: "m" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("unavailable");
      expect(outcome.status).toBe(404);
      expect(outcome.detail).toContain("没有保存模型配置");
    }
  });

  it("503（没有可用的 embedding 配置）同样返回 unavailable", async () => {
    stubEmbeddings(() =>
      jsonResponse({ error: { code: "EMBEDDING_UNAVAILABLE", message: "当前没有可用的向量化配置" } }, 503),
    );

    const outcome = await embedTexts(["问"], { model: "m" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("unavailable");
  });

  it("401 返回 unauthorized，而不是 unavailable（登录态问题不该把向量能力标成不支持）", async () => {
    stubEmbeddings(() => jsonResponse({ error: { code: "unauthorized", message: "请先登录" } }, 401));

    const outcome = await embedTexts(["问"], { model: "m" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("unauthorized");
  });

  it("网络错误返回 network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const outcome = await embedTexts(["问"], { model: "m" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("network");
  });

  it("响应条数不一致时整批丢弃", async () => {
    stubEmbeddings(() => jsonResponse({ model: "m", dim: 3, vectors: [[1, 0, 0]] }));

    const outcome = await embedTexts(["一", "二"], { model: "m" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid");
  });

  it("返回的模型与配置不一致时判 invalid（不同模型的向量不能混用）", async () => {
    stubEmbeddings(() => jsonResponse({ model: "other-model", dim: 3, vectors: [[1, 0, 0]] }));

    const outcome = await embedTexts(["问"], { model: "text-embedding-v3" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("invalid");
      expect(outcome.detail).toContain("other-model");
    }
  });
});

describe("embedTexts 的内存 LRU", () => {
  it("同 model + 同文本第二次不再请求", async () => {
    const calls = stubEmbeddings();

    await embedTexts(["同一段文本"], { model: "m" });
    await embedTexts(["同一段文本"], { model: "m" });

    expect(calls).toHaveLength(1);
    expect(embeddingCacheSize()).toBe(1);
  });

  it("换模型后缓存不串用", async () => {
    const calls = stubEmbeddings();

    await embedTexts(["同一段文本"], { model: "m-a" });
    await embedTexts(["同一段文本"], { model: "m-b" });

    expect(calls).toHaveLength(2);
    expect(embeddingCacheSize()).toBe(2);
  });

  it("只请求缺失的那几条", async () => {
    const calls = stubEmbeddings();

    await embedTexts(["甲", "乙"], { model: "m" });
    await embedTexts(["甲", "乙", "丙"], { model: "m" });

    expect(calls).toHaveLength(2);
    expect(calls[1].texts).toEqual(["丙"]);
  });

  it("容量不超过上限，最旧的先淘汰", async () => {
    const calls = stubEmbeddings();
    const total = EMBEDDING_CACHE_LIMIT + 1;
    for (let i = 0; i < total; i += 1) {
      await embedTexts([`文本${i}`], { model: "m" });
    }
    expect(embeddingCacheSize()).toBe(EMBEDDING_CACHE_LIMIT);

    // 第一条已被淘汰：再请求一次会重新发请求
    await embedTexts(["文本0"], { model: "m" });
    expect(calls).toHaveLength(total + 1);
  });

  it("embedResultOf 把失败结果折成 null，成功原样返回", async () => {
    stubEmbeddings();
    const ok = await embedTexts(["一段"], { model: "m" });
    expect(embedResultOf(ok)).toEqual(
      ok.ok ? { model: ok.model, dim: ok.dim, vectors: ok.vectors } : null,
    );

    stubEmbeddings(() => jsonResponse({ error: { message: "nope" } }, 503));
    const bad = await embedTexts(["另一段"], { model: "m" });
    expect(embedResultOf(bad)).toBeNull();
  });
});
