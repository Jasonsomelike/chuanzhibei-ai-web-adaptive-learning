import { describe, it, expect } from "vitest";

import {
  cosine,
  dot,
  isValidVector,
  normalizeVector,
  topKNormalized,
} from "@/lib/vector";

function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("isValidVector", () => {
  it("接受有限、非零范数的 Float32Array", () => {
    expect(isValidVector(vec(1, 2, 3))).toBe(true);
  });

  it("拒绝非 Float32Array", () => {
    expect(isValidVector([1, 2, 3])).toBe(false);
    expect(isValidVector(new Float64Array([1, 2, 3]))).toBe(false);
    expect(isValidVector("1,2,3")).toBe(false);
    expect(isValidVector(null)).toBe(false);
    expect(isValidVector(undefined)).toBe(false);
  });

  it("拒绝空向量", () => {
    expect(isValidVector(vec())).toBe(false);
  });

  it("拒绝 NaN 与 Infinity", () => {
    expect(isValidVector(vec(1, Number.NaN))).toBe(false);
    expect(isValidVector(vec(1, Number.POSITIVE_INFINITY))).toBe(false);
    expect(isValidVector(vec(Number.NEGATIVE_INFINITY, 1))).toBe(false);
  });

  it("拒绝零范数", () => {
    expect(isValidVector(vec(0, 0, 0))).toBe(false);
  });

  it("传 dim 时拒绝维度不符", () => {
    expect(isValidVector(vec(1, 2, 3), 3)).toBe(true);
    expect(isValidVector(vec(1, 2, 3), 2)).toBe(false);
    expect(isValidVector(vec(1, 2, 3), 1536)).toBe(false);
  });
});

describe("normalizeVector", () => {
  it("返回单位向量且不修改入参", () => {
    const input = vec(3, 4);
    const normalized = normalizeVector(input);
    expect(normalized).not.toBeNull();
    expect(Array.from(input)).toEqual([3, 4]);
    expect(normalized![0]).toBeCloseTo(0.6, 6);
    expect(normalized![1]).toBeCloseTo(0.8, 6);
  });

  it("无效输入返回 null", () => {
    expect(normalizeVector(vec(0, 0))).toBeNull();
    expect(normalizeVector(vec(Number.NaN, 1))).toBeNull();
    expect(normalizeVector(vec(1, Number.POSITIVE_INFINITY))).toBeNull();
  });

  it("dim 不符返回 null", () => {
    expect(normalizeVector(vec(1, 2, 3), 2)).toBeNull();
    expect(normalizeVector(vec(1, 2, 3), 3)).not.toBeNull();
  });
});

describe("dot", () => {
  it("计算点积", () => {
    expect(dot(vec(1, 2, 3), vec(4, 5, 6))).toBe(32);
  });

  it("维度不同返回 null，而不是截断后硬算", () => {
    expect(dot(vec(1, 2), vec(1, 2, 3))).toBeNull();
    expect(dot(vec(), vec())).toBeNull();
  });

  it("含 NaN / Infinity 返回 null", () => {
    expect(dot(vec(1, Number.NaN), vec(1, 1))).toBeNull();
    expect(dot(vec(1, 1), vec(1, Number.POSITIVE_INFINITY))).toBeNull();
  });

  it("零向量点积是 0（点积本身不要求非零范数）", () => {
    expect(dot(vec(0, 0), vec(1, 2))).toBe(0);
  });
});

describe("cosine", () => {
  it("同向为 1，正交为 0，反向为 -1", () => {
    expect(cosine(vec(1, 0), vec(2, 0))).toBe(1);
    expect(cosine(vec(1, 0), vec(0, 5))).toBe(0);
    expect(cosine(vec(1, 0), vec(-3, 0))).toBe(-1);
  });

  it("45 度夹角约为 0.7071", () => {
    expect(cosine(vec(1, 0), vec(1, 1))!).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("零范数、NaN、维度不符都返回 null", () => {
    expect(cosine(vec(0, 0), vec(1, 0))).toBeNull();
    expect(cosine(vec(Number.NaN, 1), vec(1, 0))).toBeNull();
    expect(cosine(vec(1, 0), vec(1, 0, 0))).toBeNull();
  });
});

describe("topKNormalized", () => {
  const query = vec(1, 0);

  it("按余弦分数降序返回", () => {
    const vectors = new Map<string, Float32Array>([
      ["low", vec(0, 1)],
      ["high", vec(1, 0.1)],
      ["mid", vec(1, 1)],
    ]);
    const hits = topKNormalized(query, vectors, 3, -1);
    expect(hits.map((h) => h.id)).toEqual(["high", "mid", "low"]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(hits[1].score).toBeGreaterThan(hits[2].score);
  });

  it("低于 minScore 的条目不返回", () => {
    const vectors = new Map<string, Float32Array>([
      ["good", vec(1, 0)],
      ["orthogonal", vec(0, 1)],
    ]);
    expect(topKNormalized(query, vectors, 5, 0.25).map((h) => h.id)).toEqual(["good"]);
  });

  it("尊重 k，且对小数与 <=0 的 k 做确定处理", () => {
    const vectors = new Map<string, Float32Array>([
      ["a", vec(1, 0)],
      ["b", vec(1, 0.01)],
      ["c", vec(1, 0.02)],
    ]);
    expect(topKNormalized(query, vectors, 2, -1)).toHaveLength(2);
    expect(topKNormalized(query, vectors, 1.9, -1)).toHaveLength(1);
    expect(topKNormalized(query, vectors, 0, -1)).toEqual([]);
    expect(topKNormalized(query, vectors, Number.NaN, -1)).toEqual([]);
  });

  it("同分按 id 升序，即使 Map 插入顺序相反", () => {
    const vectors = new Map<string, Float32Array>([
      ["b", vec(1, 0)],
      ["a", vec(1, 0)],
      ["c", vec(1, 0)],
    ]);
    expect(topKNormalized(query, vectors, 3, -1).map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("跳过维度不符与无效向量，不当作 0 分", () => {
    const vectors = new Map<string, Float32Array>([
      ["ok", vec(1, 0)],
      ["wrong-dim", vec(1, 0, 0)],
      ["nan", vec(Number.NaN, 1)],
      ["zero", vec(0, 0)],
    ]);
    expect(topKNormalized(query, vectors, 5, -1).map((h) => h.id)).toEqual(["ok"]);
  });

  it("无效 query 或空索引返回空数组", () => {
    expect(topKNormalized(vec(0, 0), new Map([["a", vec(1, 0)]]), 3, -1)).toEqual([]);
    expect(topKNormalized(query, new Map(), 3, -1)).toEqual([]);
  });

  it("minScore 为 NaN 时不返回任何条目", () => {
    expect(topKNormalized(query, new Map([["a", vec(1, 0)]]), 3, Number.NaN)).toEqual([]);
  });

  it("返回的分数在 [-1, 1] 内", () => {
    const vectors = new Map<string, Float32Array>([
      ["a", vec(1, 0)],
      ["b", vec(-1, 0)],
    ]);
    for (const hit of topKNormalized(query, vectors, 2, -1)) {
      expect(hit.score).toBeGreaterThanOrEqual(-1);
      expect(hit.score).toBeLessThanOrEqual(1);
    }
  });
});
