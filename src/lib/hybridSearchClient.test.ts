import { describe, expect, it } from "vitest";

import type { EmbeddingResult } from "@/lib/embeddingClient";
import { RRF_K } from "@/lib/hybrid";
import {
  createRetriever,
  hybridDocsFromChunks,
  retrieveUploadsHybrid,
} from "@/lib/hybridSearchClient";
import type { UploadChunk } from "@/lib/knowledge";
import { createMemoryVectorStore, ensureVectors } from "@/lib/vectorCache";

/** 文本 → 向量。没列出的文本给一个与三组都只部分相似的单位向量。 */
const EMBEDDINGS: Readonly<Record<string, readonly number[]>> = {
  // 与 c3 语义相同，但用词与任何片段都不重合（BM25 无命中）
  "zzzz qqqq": [1, 0, 0],
  "语义相关片段，用词与问题不重合": [1, 0, 0],
  "栈是后进先出的线性表，只能在栈顶插入和删除": [0, 1, 0],
  "队列是先进先出，只能在队尾插入": [0, 0, 1],
};

function fakeEmbed(texts: readonly string[]): Promise<EmbeddingResult> {
  return Promise.resolve({
    model: "text-embedding-v3",
    dim: 3,
    vectors: texts.map((text) => [...(EMBEDDINGS[text] ?? [0, 0.5, 0.5])]),
  });
}

function chunk(overrides: Partial<UploadChunk> & Pick<UploadChunk, "id" | "text" | "index">): UploadChunk {
  return {
    docId: "doc-1",
    directionId: "dir-1",
    title: "数据结构讲义",
    section: "第1章",
    ...overrides,
  };
}

const BASE_CHUNKS: readonly UploadChunk[] = [
  chunk({ id: "c1", index: 0, text: "栈是后进先出的线性表，只能在栈顶插入和删除" }),
  chunk({ id: "c2", index: 1, text: "队列是先进先出，只能在队尾插入" }),
  chunk({ id: "c3", index: 2, text: "语义相关片段，用词与问题不重合" }),
];

async function buildVectors(chunks: readonly UploadChunk[]): Promise<ReadonlyMap<string, Float32Array>> {
  const store = createMemoryVectorStore();
  return ensureVectors(
    chunks.map((item) => ({ id: item.id, text: item.text })),
    "text-embedding-v3",
    fakeEmbed,
    store,
  );
}

describe("createRetriever：两路融合", () => {
  it("BM25 与向量各召回一条，RRF 后两路都在，命中两路的排第一", async () => {
    const vectors = await buildVectors(BASE_CHUNKS);
    const retriever = createRetriever({
      docs: hybridDocsFromChunks(BASE_CHUNKS),
      vectors,
      model: "text-embedding-v3",
      embed: fakeEmbed,
    });

    const result = await retriever.retrieve("栈顶插入", 3);

    expect(result.usedVector).toBe(true);
    expect(result.notice).toBeNull();
    const ids = result.hits.map((hit) => hit.doc.id);
    expect(ids[0]).toBe("c1"); // BM25 与向量都命中，RRF 分数最高
    expect(ids).toContain("c2"); // 只有向量路命中
    expect(result.hits[0].score).toBeLessThanOrEqual(2 / (RRF_K + 1));
  });

  it("只有向量路命中时仍返回结果（BM25 为空不算失败）", async () => {
    const vectors = await buildVectors(BASE_CHUNKS);
    const retriever = createRetriever({
      docs: hybridDocsFromChunks(BASE_CHUNKS),
      vectors,
      model: "text-embedding-v3",
      embed: fakeEmbed,
    });

    const result = await retriever.retrieve("zzzz qqqq", 3);

    expect(result.usedVector).toBe(true);
    expect(result.hits.map((hit) => hit.doc.id)).toEqual(["c3"]);
  });

  it("取前 k 条", async () => {
    const vectors = await buildVectors(BASE_CHUNKS);
    const retriever = createRetriever({
      docs: hybridDocsFromChunks(BASE_CHUNKS),
      vectors,
      model: "text-embedding-v3",
      embed: fakeEmbed,
    });

    const result = await retriever.retrieve("栈顶插入", 1);
    expect(result.hits).toHaveLength(1);
  });
});

describe("createRetriever：向量不可用与两路皆空", () => {
  const docs = hybridDocsFromChunks(BASE_CHUNKS);

  it("没有向量表时不调用 embed，只用 BM25 并给出 notice", async () => {
    let embedCalls = 0;
    const retriever = createRetriever({
      docs,
      vectors: new Map(),
      model: "text-embedding-v3",
      embed: async (texts) => {
        embedCalls += 1;
        return fakeEmbed(texts);
      },
    });

    const result = await retriever.retrieve("栈顶插入", 3);

    expect(embedCalls).toBe(0);
    expect(result.usedVector).toBe(false);
    expect(result.notice).toContain("未使用语义检索");
    // "插入" 同时出现在 c1/c2，BM25 命中两条；排序以 BM25 分数为准
    expect(result.hits.map((hit) => hit.doc.id)).toEqual(["c1", "c2"]);
  });

  it("查询向量拿不到时退回 BM25 并带 notice", async () => {
    const vectors = await buildVectors(BASE_CHUNKS);
    const retriever = createRetriever({
      docs,
      vectors,
      model: "text-embedding-v3",
      embed: async () => null,
    });

    const result = await retriever.retrieve("栈顶插入", 3);

    expect(result.usedVector).toBe(false);
    expect(result.notice).not.toBeNull();
    expect(result.hits.map((hit) => hit.doc.id)).toEqual(["c1", "c2"]);
  });

  it("两路皆空返回 []", async () => {
    const retriever = createRetriever({
      docs,
      vectors: new Map(),
      model: "text-embedding-v3",
      embed: fakeEmbed,
    });

    const result = await retriever.retrieve("zzzz qqqq", 3);

    expect(result.hits).toEqual([]);
    expect(result.usedVector).toBe(false);
    expect(result.notice).not.toBeNull();
  });

  it("k<=0 时不返回任何命中", async () => {
    const vectors = await buildVectors(BASE_CHUNKS);
    const retriever = createRetriever({
      docs,
      vectors,
      model: "text-embedding-v3",
      embed: fakeEmbed,
    });

    const result = await retriever.retrieve("栈顶插入", 0);
    expect(result.hits).toEqual([]);
  });
});

describe("createRetriever：相邻切块去重", () => {
  const overlapping: readonly UploadChunk[] = [
    chunk({ id: "s0", index: 0, text: `${"甲".repeat(100)}${"乙".repeat(100)}` }),
    chunk({ id: "s1", index: 1, text: `${"乙".repeat(100)}${"丙".repeat(100)}` }),
  ];

  it("打开 dedupeAdjacent 后只保留排名靠前的相邻块", async () => {
    const retriever = createRetriever({
      docs: hybridDocsFromChunks(overlapping),
      vectors: new Map(),
      model: "",
      embed: fakeEmbed,
      dedupeAdjacent: true,
    });

    const result = await retriever.retrieve("乙乙乙乙", 3);
    expect(result.hits.map((hit) => hit.doc.id)).toEqual(["s0"]);
  });

  it("关闭时两条都保留", async () => {
    const retriever = createRetriever({
      docs: hybridDocsFromChunks(overlapping),
      vectors: new Map(),
      model: "",
      embed: fakeEmbed,
    });

    const result = await retriever.retrieve("乙乙乙乙", 3);
    expect(result.hits.map((hit) => hit.doc.id).sort()).toEqual(["s0", "s1"]);
  });
});

describe("retrieveUploadsHybrid", () => {
  it("把融合结果的 id 映射回 UploadChunk，并透传 usedVector / notice", async () => {
    const vectors = await buildVectors(BASE_CHUNKS);
    const retriever = createRetriever({
      docs: hybridDocsFromChunks(BASE_CHUNKS),
      vectors,
      model: "text-embedding-v3",
      embed: fakeEmbed,
      dedupeAdjacent: true,
    });

    const result = await retrieveUploadsHybrid(retriever, BASE_CHUNKS, "栈顶插入", 3);

    expect(result.usedVector).toBe(true);
    expect(result.notice).toBeNull();
    expect(result.hits.map((hit) => hit.chunk.id)).toContain("c1");
    expect(result.hits[0].chunk.text).toContain("栈");
    expect(result.hits[0].score).toBeGreaterThan(0);
  });

  it("映射不到原文的 id 被跳过", async () => {
    const retriever = createRetriever({
      docs: hybridDocsFromChunks(BASE_CHUNKS),
      vectors: new Map(),
      model: "",
      embed: fakeEmbed,
    });

    // 只传一半片段：命中的 c2 在 chunks 里不存在，不能凭空造一条引用
    const result = await retrieveUploadsHybrid(retriever, [BASE_CHUNKS[0]], "栈顶插入", 3);

    expect(result.hits.map((hit) => hit.chunk.id)).toEqual(["c1"]);
  });
});
