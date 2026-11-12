import { describe, it, expect } from "vitest";
import { chapterKcIds } from "@/lib/chapters";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { planPath } from "@/lib/plan";
import { summarizeCounterfactual } from "@/lib/planDiff";

/*
 * 用 chapterKcIds 取「第8章 排序」的目标，而不是写死 id 列表：
 * 图谱增删知识点时这里跟着变，测试不会悄悄只覆盖旧数据。
 * 当前是 6 个目标点（不是 7）。
 */
const TARGETS = chapterKcIds(knowledgeGraph, ["第8章 排序"]);

function planWith(budgetMinutes: number) {
  return planPath({
    graph: knowledgeGraph,
    mastery: [],
    budgetMinutes,
    targets: TARGETS,
    timeEstimates:knowledgeGraph.concepts.map(c=>({kcId:c.id,learnMinutes:15,reviewMinutes:8,lowMinutes:5,highMinutes:20,confidence:"low",reason:"固定测试输入：验证阻塞与反事实汇总"})),
  });
}

describe("反事实汇总", () => {
  it("第8章 6 个 targets", () => {
    expect(TARGETS).toHaveLength(6);
  });

  it("预算 240/90/30 时的 deferred/blocked 数量分别是 0/0、3/5、3/9", () => {
    const table = [
      { budget: 240, deferred: 0, blocked: 0 },
      { budget: 90, deferred: 3, blocked: 5 },
      { budget: 30, deferred: 3, blocked: 9 },
    ] as const;

    for (const row of table) {
      const result = planWith(row.budget);
      expect([result.deferred.length, result.blocked.length]).toEqual([
        row.deferred,
        row.blocked,
      ]);
    }
  });

  it("预算 90 的阻塞点顺序与阻塞者", () => {
    const result = planWith(90);
    const summary = summarizeCounterfactual(result, []);

    expect(summary.deferred).toEqual(result.deferred);
    expect(summary.blocked).toEqual(["c11", "c37", "c12", "c39", "c40"]);
    expect(summary.blockedByOf("c12")).toEqual(["c09", "c11"]);
    expect(summary.blockedByOf("c01")).toEqual([]);
  });

  it("当前预算 30（2 步）对对照预算 90：5 个阻塞点都不在当前路径", () => {
    const current = planWith(30);
    const counterfactual = planWith(90);
    expect(current.steps).toHaveLength(2);

    const summary = summarizeCounterfactual(counterfactual, current.steps);
    expect(summary.blocked).toEqual(["c11", "c37", "c12", "c39", "c40"]);
    expect(summary.blockedNotInPath).toHaveLength(5);
    expect(summary.blockedNotInPath).toEqual(summary.blocked);
  });

  it("当前路径里已有的阻塞点不计入 blockedNotInPath", () => {
    /*
     * 90 分钟路径包含 c36，而 30 分钟对照预算下 c36 被阻塞。
     * 这个点要在步骤卡上标「因先修阻塞」，但不能再列进「不在当前路径」清单。
     */
    const current = planWith(90);
    const counterfactual = planWith(30);
    const summary = summarizeCounterfactual(counterfactual, current.steps);

    expect(summary.blocked).toContain("c36");
    expect(summary.blockedNotInPath).not.toContain("c36");
    expect(summary.blockedNotInPath).toHaveLength(summary.blocked.length - 1);
  });

  it("没有对照预算时返回空汇总", () => {
    const summary = summarizeCounterfactual(null, planWith(90).steps);

    expect(summary.deferred).toEqual([]);
    expect(summary.blocked).toEqual([]);
    expect(summary.blockedNotInPath).toEqual([]);
    expect(summary.blockedByOf("c11")).toEqual([]);
  });
});
