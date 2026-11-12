import { describe, it, expect } from "vitest";
import {
  CHAPTERS_STORAGE_KEY,
  chaptersOf,
  chapterKcIds,
  chapterScope,
} from "@/lib/chapters";
import { SUBJECTS } from "@/data/subjects";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { planPath, checkPrereqOrder } from "@/lib/plan";
import type { KnowledgeGraph } from "@/lib/graph";

/** 造一张只关心章节归属的图，先修边按需补充。 */
function graphWithChapters(
  entries: readonly (readonly [string, string])[],
  edges: KnowledgeGraph["edges"] = [],
): KnowledgeGraph {
  return {
    version: "test",
    concepts: entries.map(([id, chapter]) => ({ id, name: id, summary: "", chapter })),
    edges,
  };
}

const CH5 = "第5章 树与二叉树";
const CH8 = "第8章 排序";

describe("章节汇总", () => {
  it("九个学科的章节数依次是 8/8/9/7/8/8/8/8/8，每科 40 个知识点", () => {
    expect(SUBJECTS).toHaveLength(9);
    expect(SUBJECTS.map((s) => chaptersOf(s.graph).length)).toEqual([8, 8, 9, 7, 8, 8, 8, 8, 8]);
    for (const s of SUBJECTS) {
      expect(s.graph.concepts).toHaveLength(40);
      expect(chaptersOf(s.graph).reduce((sum, ch) => sum + ch.count, 0)).toBe(40);
    }
  });

  it("按章号数值排序，第10章排在第9章之后", () => {
    const graph = graphWithChapters([
      ["k1", "第10章 进阶"],
      ["k2", "第9章 综合"],
      ["k3", "第2章 基础"],
    ]);
    expect(chaptersOf(graph).map((c) => c.name)).toEqual([
      "第2章 基础",
      "第9章 综合",
      "第10章 进阶",
    ]);
  });

  it("章号解析失败时按名称兜底，并排在编号章节之后", () => {
    const graph = graphWithChapters([
      ["k1", "附录 B"],
      ["k2", "第1章 绪论"],
      ["k3", "附录 A"],
    ]);
    expect(chaptersOf(graph).map((c) => c.name)).toEqual(["第1章 绪论", "附录 A", "附录 B"]);
  });

  it("同名章节合并，kcIds 保持 graph.concepts 原顺序", () => {
    const graph = graphWithChapters([
      ["k1", "第1章 绪论"],
      ["k2", "第2章 线性表"],
      ["k3", "第1章 绪论"],
    ]);
    const chapters = chaptersOf(graph);
    expect(chapters.map((c) => c.name)).toEqual(["第1章 绪论", "第2章 线性表"]);
    expect(chapters[0].kcIds).toEqual(["k1", "k3"]);
    expect(chapters[0].count).toBe(2);
    expect(chapters[1].kcIds).toEqual(["k2"]);
  });
});

describe("章节选点", () => {
  it("多章取并集并按 id 升序输出", () => {
    const ids = chapterKcIds(knowledgeGraph, [CH5, "第1章 绪论"]);
    expect(ids).toEqual([
      "c01",
      "c02",
      "c03",
      "c04",
      "c15",
      "c16",
      "c17",
      "c18",
      "c19",
      "c20",
      "c21",
    ]);
    expect([...ids].sort()).toEqual(ids);
  });

  it("未知章名安全忽略", () => {
    expect(chapterKcIds(knowledgeGraph, ["第99章 不存在"])).toEqual([]);
    expect(chapterKcIds(knowledgeGraph, ["第99章 不存在", CH8])).toEqual(
      chapterKcIds(knowledgeGraph, [CH8]),
    );
    expect(chapterScope(knowledgeGraph, ["第99章 不存在"])).toEqual({
      targets: [],
      prerequisiteExtra: [],
      scopeSize: 0,
    });
  });

  it("重复章名只计一次", () => {
    expect(chapterKcIds(knowledgeGraph, [CH8, CH8])).toEqual(chapterKcIds(knowledgeGraph, [CH8]));
  });

  it("同一组章名顺序颠倒，输出完全相同", () => {
    const names = [CH5, CH8];
    const reversed = [...names].reverse();
    expect(chapterKcIds(knowledgeGraph, reversed)).toEqual(chapterKcIds(knowledgeGraph, names));
    expect(chapterScope(knowledgeGraph, reversed)).toEqual(chapterScope(knowledgeGraph, names));
  });

  it("第8章的知识点集合长度为 6", () => {
    const targets = chapterKcIds(knowledgeGraph, ["第8章 排序"]);
    expect(targets).toHaveLength(6);
  });
});

describe("章节范围与预算", () => {
  it("第5章的候选范围：targets 7 个、先修补充 8 个、scopeSize 15", () => {
    const scope = chapterScope(knowledgeGraph, [CH5]);
    expect(scope.targets).toHaveLength(7);
    expect(scope.prerequisiteExtra).toHaveLength(8);
    // scopeSize 是候选范围（targets ∪ prerequisiteExtra），不是预算内步数
    expect(scope.scopeSize).toBe(15);
    expect([...scope.targets].sort()).toEqual(scope.targets);
    expect([...scope.prerequisiteExtra].sort()).toEqual(scope.prerequisiteExtra);
  });

  it("预算 600 时 planPath 排入全部 15 个候选知识点", () => {
    const scope = chapterScope(knowledgeGraph, [CH5]);
    const result = planPath({
      graph: knowledgeGraph,
      mastery: [],
      budgetMinutes: 600,
      targets: scope.targets,
    });
    expect(result.steps).toHaveLength(15);
    // 传完整图 + 收窄 targets 时，严格先修校验不会把外章先修判成违规
    expect(checkPrereqOrder(knowledgeGraph, result.steps, { mastered: new Set() })).toEqual([]);
  });

  it("规则初估下预算 90 时排得下 9 步，与候选范围 15 是两回事", () => {
    const scope = chapterScope(knowledgeGraph, [CH5]);
    const result = planPath({
      graph: knowledgeGraph,
      mastery: [],
      budgetMinutes: 90,
      targets: scope.targets,
    });
    // 候选范围仍是 15；预算内真正排出的步数由 planPath 决定
    expect(scope.scopeSize).toBe(15);
    expect(result.steps).toHaveLength(9);
    expect(result.totalMinutes).toBeLessThanOrEqual(90);
  });
});

describe("存储键", () => {
  it("固定为 alp.chapters.v1，路径页与登出清理共用", () => {
    expect(CHAPTERS_STORAGE_KEY).toBe("alp.chapters.v1");
  });
});
