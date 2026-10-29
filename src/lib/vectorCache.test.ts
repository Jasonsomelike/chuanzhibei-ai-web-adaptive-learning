import { describe, expect, it } from "vitest";

import type { EmbeddingResult } from "@/lib/embeddingClient";
import {
  VECTOR_BATCH_SIZE,
  clearVectorCache,
  createMemoryVectorStore,
  ensureVectors,
  vectorCacheKey,
  type VectorDoc,
} from "@/lib/vectorCache";

/** 假嵌入：向量首分量是文本长度，其余分量固定，方便断言取到的是哪一段。 */
function fakeEmbed(
  model = "text-embedding-v3",
  dim = 3,
): { embed: (texts: readonly string[]) => Promise<EmbeddingResult | null>; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    embed: async (texts) => {
      calls.push([...texts]);
      return {
        model,
        dim,
        vectors: texts.map((text) => [text.length, 1, 0].slice(0, dim)),
      };
    },
  };
}

function docsOf(count: number): VectorDoc[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `chunk-${i}`,
    text: `第${i}段正文，长度不同${"…".repeat(i % 5)}`,
  }));
}

describe("ensureVectors", () => {
  it("缺失按 32 条一批嵌入并写回，第二次全部命中缓存", async () => {
    const store = createMemoryVectorStore();
    const docs = docsOf(40);
    const first = fakeEmbed();

    const vectors = await ensureVectors(docs, "text-embedding-v3", first.embed, store);

    expect(vectors.size).toBe(40);
    expect(first.calls).toHaveLength(2);
    expect(first.calls[0]).toHaveLength(VECTOR_BATCH_SIZE);
    expect(first.calls[1]).toHaveLength(8);
    expect(vectors.get("chunk-0")?.length).toBe(3);

    // 第二次：缓存命中，一次嵌入都不发
    const second = fakeEmbed();
    const again = await ensureVectors(docs, "text-embedding-v3", second.embed, store);
    expect(second.calls).toHaveLength(0);
    expect(again.size).toBe(40);
  });

  it("模型为空或没有片段时不发请求", async () => {
    const store = createMemoryVectorStore();
    const fake = fakeEmbed();

    expect((await ensureVectors(docsOf(3), "  ", fake.embed, store)).size).toBe(0);
    expect((await ensureVectors([], "m", fake.embed, store)).size).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  it("模型不同不共用缓存；clearVectorCache 只清指定模型", async () => {
    const store = createMemoryVectorStore();
    const docs = docsOf(3);

    await ensureVectors(docs, "model-a", fakeEmbed("model-a").embed, store);
    const b = fakeEmbed("model-b");
    await ensureVectors(docs, "model-b", b.embed, store);
    expect(b.calls).toHaveLength(1);

    // 清掉 model-a 后，model-a 重新嵌入；model-b 仍然命中
    await clearVectorCache("model-a", store);
    const a2 = fakeEmbed("model-a");
    await ensureVectors(docs, "model-a", a2.embed, store);
    expect(a2.calls).toHaveLength(1);

    const b2 = fakeEmbed("model-b");
    await ensureVectors(docs, "model-b", b2.embed, store);
    expect(b2.calls).toHaveLength(0);
  });

  it("空模型不会清掉全部缓存", async () => {
    const store = createMemoryVectorStore();
    const docs = docsOf(2);
    await ensureVectors(docs, "model-a", fakeEmbed("model-a").embed, store);

    await clearVectorCache("   ", store);

    const again = fakeEmbed("model-a");
    await ensureVectors(docs, "model-a", again.embed, store);
    expect(again.calls).toHaveLength(0);
  });

  it("维度与模型记录不符的缓存被忽略并重新嵌入", async () => {
    const docs = [{ id: "chunk-1", text: "一段正文" }];
    const store = createMemoryVectorStore([
      // 同一模型下残留的旧维度向量（2 维）
      [vectorCacheKey("m", "一段正文"), Float32Array.of(1, 0)],
      // 模型维度记录：3 维
      ["m:dim", Float32Array.of(3)],
    ]);
    const fake = fakeEmbed("m", 3);

    const vectors = await ensureVectors(docs, "m", fake.embed, store);

    expect(fake.calls).toHaveLength(1);
    expect(vectors.get("chunk-1")?.length).toBe(3);
  });

  it("嵌入不可用时保留已命中的缓存，缺失片段自然退化", async () => {
    const store = createMemoryVectorStore();
    const docs = docsOf(2);
    await ensureVectors(docs, "m", fakeEmbed("m").embed, store);

    const missing = [...docs, { id: "chunk-new", text: "新片段" }];
    const failing = async (): Promise<EmbeddingResult | null> => null;
    const vectors = await ensureVectors(missing, "m", failing, store);

    expect(vectors.has("chunk-0")).toBe(true);
    expect(vectors.has("chunk-1")).toBe(true);
    expect(vectors.has("chunk-new")).toBe(false);
  });

  it("重复 id 只嵌入一次", async () => {
    const store = createMemoryVectorStore();
    const fake = fakeEmbed("m");
    const docs = [
      { id: "same", text: "正文" },
      { id: "same", text: "正文" },
    ];

    const vectors = await ensureVectors(docs, "m", fake.embed, store);

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toHaveLength(1);
    expect(vectors.size).toBe(1);
  });

  it("模型名与请求不符的批次整批丢弃", async () => {
    const store = createMemoryVectorStore();
    const docs = docsOf(2);
    const other = fakeEmbed("another-model");

    const vectors = await ensureVectors(docs, "m", other.embed, store);

    expect(vectors.size).toBe(0);
  });
});
