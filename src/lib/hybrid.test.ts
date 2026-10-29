import { describe, it, expect } from "vitest";

import {
  HYBRID_TOP_K,
  MIN_ADJACENT_OVERLAP,
  RRF_CANDIDATES,
  RRF_K,
  VECTOR_MIN_SCORE,
  dedupeAdjacentChunks,
  fuseTopK,
  reciprocalRankFusion,
  retrievalNotice,
  type AdjacentChunk,
} from "@/lib/hybrid";

const ids = (...values: string[]) => values.map((id) => ({ id }));

describe("常量", () => {
  it("RRF 与混合检索阈值集中在本模块", () => {
    expect(RRF_K).toBe(60);
    expect(RRF_CANDIDATES).toBe(20);
    expect(HYBRID_TOP_K).toBe(3);
    expect(VECTOR_MIN_SCORE).toBe(0.25);
  });
});

describe("reciprocalRankFusion", () => {
  it("rank1 为 1/(60+1)，rank3 为 1/(60+3)", () => {
    const hits = reciprocalRankFusion([ids("a", "b", "c")]);
    expect(hits.map((h) => h.id)).toEqual(["a", "b", "c"]);
    expect(hits[0].score).toBeCloseTo(1 / 61, 12);
    expect(hits[2].score).toBeCloseTo(1 / 63, 12);
  });

  it("k=60 时 rank1 与 rank3 的相对差约 3.2%", () => {
    const [first, , third] = reciprocalRankFusion([ids("a", "b", "c")]);
    const relative = (first.score - third.score) / first.score;
    // 1 - 61/63 = 2/63 ≈ 3.1746%
    expect(relative).toBeCloseTo(2 / 63, 10);
    expect(relative).toBeGreaterThan(0.031);
    expect(relative).toBeLessThan(0.032);
  });

  it("空输入、空列表、单条列表都能处理", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
    const single = reciprocalRankFusion([ids("only")]);
    expect(single).toHaveLength(1);
    expect(single[0].score).toBeCloseTo(1 / 61, 12);
  });

  it("多路融合把同一 id 的分数相加", () => {
    const hits = reciprocalRankFusion([ids("a", "b"), ids("a", "c")]);
    const byId = new Map(hits.map((h) => [h.id, h.score] as const));
    expect(byId.get("a")).toBeCloseTo(1 / 61 + 1 / 61, 12);
    expect(byId.get("b")).toBeCloseTo(1 / 62, 12);
    expect(byId.get("c")).toBeCloseTo(1 / 62, 12);
  });

  it("同分按 id 升序，与列表顺序无关", () => {
    const hits = reciprocalRankFusion([ids("b", "a"), ids("a", "b")]);
    expect(hits.map((h) => h.id)).toEqual(["a", "b"]);
    expect(hits[0].score).toBe(hits[1].score);
  });

  it("同一路内重复 id 只计第一次，名次按去重后的顺序数", () => {
    const hits = reciprocalRankFusion([ids("a", "a", "b")]);
    const byId = new Map(hits.map((h) => [h.id, h.score] as const));
    expect(byId.get("a")).toBeCloseTo(1 / 61, 12);
    expect(byId.get("b")).toBeCloseTo(1 / 62, 12);
  });

  it("weights 按路生效，缺省为 1，非正数按 0 计", () => {
    const lists = [ids("a"), ids("b")];
    const weighted = reciprocalRankFusion(lists, { weights: [2] });
    const byId = new Map(weighted.map((h) => [h.id, h.score] as const));
    expect(byId.get("a")).toBeCloseTo(2 / 61, 12);
    expect(byId.get("b")).toBeCloseTo(1 / 61, 12);

    const excluded = reciprocalRankFusion(lists, { weights: [0, 1] });
    expect(excluded.map((h) => h.id)).toEqual(["b"]);

    const negative = reciprocalRankFusion(lists, { weights: [-1, Number.NaN] });
    expect(negative).toEqual([]);
  });

  it("k 可自定义；非法 k 回落到默认值", () => {
    const custom = reciprocalRankFusion([ids("a")], { k: 1 });
    expect(custom[0].score).toBeCloseTo(0.5, 12);

    const fallback = reciprocalRankFusion([ids("a")], { k: 0 });
    expect(fallback[0].score).toBeCloseTo(1 / 61, 12);
  });

  it("每路默认只融合前 RRF_CANDIDATES 名", () => {
    const long = Array.from({ length: RRF_CANDIDATES + 5 }, (_, i) => ({
      id: `k${String(i).padStart(2, "0")}`,
    }));
    const hitIds = reciprocalRankFusion([long]).map((h) => h.id);
    expect(hitIds).toHaveLength(RRF_CANDIDATES);
    expect(hitIds).toContain(`k${String(RRF_CANDIDATES - 1).padStart(2, "0")}`);
    expect(hitIds).not.toContain(`k${String(RRF_CANDIDATES).padStart(2, "0")}`);

    expect(reciprocalRankFusion([long], { candidates: 2 }).map((h) => h.id)).toEqual(["k00", "k01"]);
  });

  it("空 id 不入榜", () => {
    expect(reciprocalRankFusion([ids("", "a")]).map((h) => h.id)).toEqual(["a"]);
  });
});

describe("fuseTopK", () => {
  const A = { id: "a", text: "来自 BM25" };
  const B = { id: "b", text: "来自 BM25" };
  const C = { id: "c", text: "来自向量" };
  const D = { id: "d", text: "来自向量" };

  it("默认返回 HYBRID_TOP_K 条，并带回原始对象", () => {
    const fused = fuseTopK([[A], [C, D]]);
    expect(fused).toHaveLength(HYBRID_TOP_K);
    expect(fused[0].item).toBe(A);
    expect(fused[0].score).toBeCloseTo(1 / 61, 12);
    expect(fused.map((f) => f.item.id)).toEqual(["a", "c", "d"]);
  });

  it("同一 id 取第一次出现的对象，分数仍然合并", () => {
    const vectorCopy = { id: "a", text: "来自向量" };
    const fused = fuseTopK([[A], [vectorCopy, B]]);
    expect(fused[0].item).toBe(A);
    expect(fused[0].score).toBeCloseTo(1 / 61 + 1 / 61, 12);
  });

  it("topK 为 0 / 负数返回空", () => {
    expect(fuseTopK([[A]], { topK: 0 })).toEqual([]);
    expect(fuseTopK([[A]], { topK: -1 })).toEqual([]);
  });

  it("透传 RRF 选项", () => {
    const fused = fuseTopK([[A], [B]], { weights: [1, 3], topK: 2 });
    expect(fused[0].item).toBe(B);
    expect(fused[0].score).toBeCloseTo(3 / 61, 12);
  });
});

function chunk(id: string, docId: string, index: number, text: string): AdjacentChunk {
  return { id, docId, index, text };
}

describe("dedupeAdjacentChunks", () => {
  const shared = "重".repeat(50);

  it("同文档相邻切块共享 50 码点重叠时只保留排名靠前的一条", () => {
    const first = chunk("c0", "doc", 0, "甲".repeat(100) + shared);
    const second = chunk("c1", "doc", 1, shared + "乙".repeat(100));
    expect(dedupeAdjacentChunks([first, second])).toEqual([first]);
  });

  it("逆序命中（先 c1 后 c0）也保留排名靠前的那条", () => {
    const first = chunk("c0", "doc", 0, "甲".repeat(100) + shared);
    const second = chunk("c1", "doc", 1, shared + "乙".repeat(100));
    expect(dedupeAdjacentChunks([second, first])).toEqual([second]);
  });

  it("不相邻的切块即使内容重叠也保留", () => {
    const first = chunk("c0", "doc", 0, "甲".repeat(100) + shared);
    const third = chunk("c2", "doc", 2, shared + "乙".repeat(100));
    expect(dedupeAdjacentChunks([first, third])).toHaveLength(2);
  });

  it("不同文档相同序号不互相去重", () => {
    const a = chunk("a", "doc-a", 0, "甲".repeat(100) + shared);
    const b = chunk("b", "doc-b", 1, shared + "乙".repeat(100));
    expect(dedupeAdjacentChunks([a, b])).toHaveLength(2);
  });

  it("相邻但重叠不足阈值时保留", () => {
    const brief = "短".repeat(10);
    const a = chunk("c0", "doc", 0, "甲".repeat(100) + brief);
    const b = chunk("c1", "doc", 1, brief + "乙".repeat(100));
    expect(dedupeAdjacentChunks([a, b])).toHaveLength(2);
    expect(dedupeAdjacentChunks([a, b], 10)).toHaveLength(1);
  });

  it("同一位置重复出现只保留第一条", () => {
    const a = chunk("a", "doc", 0, "甲".repeat(100));
    const copy = chunk("b", "doc", 0, "另一个 id 的同一段");
    expect(dedupeAdjacentChunks([a, copy])).toEqual([a]);
  });

  it("空输入与单条输入原样返回", () => {
    expect(dedupeAdjacentChunks([])).toEqual([]);
    const only = chunk("a", "doc", 0, "正文");
    expect(dedupeAdjacentChunks([only])).toEqual([only]);
  });

  it("默认阈值与 CHUNK_OVERLAP 兼容", () => {
    expect(MIN_ADJACENT_OVERLAP).toBe(20);
  });
});

describe("retrievalNotice", () => {
  it("使用了语义检索时不提示", () => {
    expect(retrievalNotice(true)).toBeNull();
  });

  it("未使用语义检索时给出可直接展示的中文提示", () => {
    expect(retrievalNotice(false)).toBe("本次未使用语义检索（未配置 embedding 模型）");
  });
});
