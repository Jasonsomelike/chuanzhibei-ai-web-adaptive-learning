import { describe, it, expect } from "vitest";
import {
  indexGraph,
  validateGraph,
  computeDepths,
  prerequisiteClosure,
  topologicalOrder,
  type KnowledgeGraph,
} from "@/lib/graph";
import { knowledgeGraph } from "@/data/knowledge-graph";

describe("真实知识图谱", () => {
  it("结构合法：无环、无重复边、无悬空引用", () => {
    const issues = validateGraph(knowledgeGraph);
    expect(issues).toEqual([]);
  });

  it("包含 40 个知识点与 60 条先修边", () => {
    expect(knowledgeGraph.concepts).toHaveLength(40);
    expect(knowledgeGraph.edges).toHaveLength(60);
  });

  it("每个知识点的 id 唯一", () => {
    const ids = knowledgeGraph.concepts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("图校验能发现问题", () => {
  const base: KnowledgeGraph = {
    version: "test",
    concepts: [
      { id: "a", name: "A", summary: "", chapter: "c" },
      { id: "b", name: "B", summary: "", chapter: "c" },
    ],
    edges: [{ before: "a", after: "b" }],
  };

  it("检测环", () => {
    const cyclic: KnowledgeGraph = {
      ...base,
      edges: [
        { before: "a", after: "b" },
        { before: "b", after: "a" },
      ],
    };
    const kinds = validateGraph(cyclic).map((i) => i.kind);
    expect(kinds).toContain("cycle");
  });

  it("检测自环", () => {
    const selfLoop: KnowledgeGraph = { ...base, edges: [{ before: "a", after: "a" }] };
    expect(validateGraph(selfLoop).map((i) => i.kind)).toContain("self-loop");
  });

  it("检测重复边", () => {
    const dup: KnowledgeGraph = {
      ...base,
      edges: [
        { before: "a", after: "b" },
        { before: "a", after: "b" },
      ],
    };
    expect(validateGraph(dup).map((i) => i.kind)).toContain("duplicate-edge");
  });

  it("检测指向不存在知识点的边", () => {
    const dangling: KnowledgeGraph = { ...base, edges: [{ before: "a", after: "zzz" }] };
    expect(validateGraph(dangling).map((i) => i.kind)).toContain("missing-node");
  });
});

describe("先修深度", () => {
  it("根为 0，子为父的最大深度 + 1", () => {
    const g: KnowledgeGraph = {
      version: "t",
      concepts: [
        { id: "a", name: "A", summary: "", chapter: "c" },
        { id: "b", name: "B", summary: "", chapter: "c" },
        { id: "c", name: "C", summary: "", chapter: "c" },
      ],
      edges: [
        { before: "a", after: "b" },
        { before: "b", after: "c" },
      ],
    };
    const d = computeDepths(g);
    expect(d.get("a")).toBe(0);
    expect(d.get("b")).toBe(1);
    expect(d.get("c")).toBe(2);
  });

  it("真实图谱的最大深度在合理范围（5–12 层）", () => {
    const depths = computeDepths(knowledgeGraph);
    const max = Math.max(...depths.values());
    expect(max).toBeGreaterThanOrEqual(5);
    expect(max).toBeLessThanOrEqual(12);
  });
});

describe("先修闭包", () => {
  it("包含全部传递前驱，不含自身", () => {
    const g: KnowledgeGraph = {
      version: "t",
      concepts: [
        { id: "a", name: "A", summary: "", chapter: "c" },
        { id: "b", name: "B", summary: "", chapter: "c" },
        { id: "c", name: "C", summary: "", chapter: "c" },
      ],
      edges: [
        { before: "a", after: "b" },
        { before: "b", after: "c" },
      ],
    };
    const closure = prerequisiteClosure(g, "c");
    expect([...closure].sort()).toEqual(["a", "b"]);
    expect(closure.has("c")).toBe(false);
  });

  it("在真实图谱上：关键路径的闭包包含它的全部上游", () => {
    const closure = prerequisiteClosure(knowledgeGraph, "c40");
    const idx = indexGraph(knowledgeGraph);
    expect(closure.size).toBeGreaterThan(10);
    for (const p of idx.predecessors.get("c40") ?? []) {
      expect(closure.has(p)).toBe(true);
    }
  });
});

describe("拓扑排序", () => {
  it("满足所有先修约束", () => {
    const order = topologicalOrder(knowledgeGraph);
    const pos = new Map(order.map((id, i) => [id, i]));
    expect(order).toHaveLength(40);

    for (const e of knowledgeGraph.edges) {
      const a = pos.get(e.before);
      const b = pos.get(e.after);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a as number).toBeLessThan(b as number);
    }
  });

  it("同一输入两次得到完全相同的顺序（可复现的前提）", () => {
    const a = topologicalOrder(knowledgeGraph);
    const b = topologicalOrder(knowledgeGraph);
    expect(a).toEqual(b);
  });

  it("能对子集排序，且子集内仍满足约束", () => {
    const subset = new Set(["c01", "c02", "c05", "c09"]);
    const order = topologicalOrder(knowledgeGraph, subset);
    expect(order).toHaveLength(4);
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const e of knowledgeGraph.edges) {
      if (!subset.has(e.before) || !subset.has(e.after)) continue;
      expect(pos.get(e.before) as number).toBeLessThan(pos.get(e.after) as number);
    }
  });
});
