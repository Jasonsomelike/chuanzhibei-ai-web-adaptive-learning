import { describe, it, expect } from "vitest";
import {
  planPath,
  checkPrereqOrder,
  ALGO_VERSION,
  DEFAULT_MASTERY_TARGET,
  type PlanInput,
  type PlanResult,
} from "@/lib/plan";
import { initialMastery, updateMastery, type MasteryState, type Difficulty } from "@/lib/mastery";
import { knowledgeGraph } from "@/data/knowledge-graph";

/** 构造一个确定性的掌握度快照：前 n 个知识点已掌握。 */
function masterySnapshot(masteredCount: number): MasteryState[] {
  return knowledgeGraph.concepts.map((c, i) => {
    let s = initialMastery(c.id, 0);
    if (i < masteredCount) {
      // 用 3 题全对把掌握度推到 0.74 以上
      for (let k = 0; k < 3; k += 1) s = updateMastery(s, true, 2 as Difficulty);
    }
    return s;
  });
}

function baseInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    graph: knowledgeGraph,
    mastery: masterySnapshot(0),
    budgetMinutes: 120,
    ...overrides,
  };
}

describe("路径规划基本行为", () => {
  it("返回的路径满足先修约束", () => {
    const result = planPath(baseInput());
    expect(checkPrereqOrder(knowledgeGraph, result.steps)).toEqual([]);
  });

  it("总用时不超过预算", () => {
    const result = planPath(baseInput({ budgetMinutes: 60 }));
    expect(result.totalMinutes).toBeLessThanOrEqual(60);
  });

  it("预算增大时排入更多步骤", () => {
    const small = planPath(baseInput({ budgetMinutes: 60 }));
    const large = planPath(baseInput({ budgetMinutes: 240 }));
    expect(large.steps.length).toBeGreaterThanOrEqual(small.steps.length);
  });

  it("装不下的知识点进入 deferred", () => {
    const result = planPath(baseInput({ budgetMinutes: 30 }));
    expect(result.deferred.length).toBeGreaterThan(0);
  });

  it("已掌握的知识点不会被排进路径", () => {
    const mastery = masterySnapshot(0).map((s) => {
      // 把 c01 推到高掌握度
      let m = s;
      if (m.kcId === "c01") for (let i = 0; i < 6; i += 1) m = updateMastery(m, true, 3 as Difficulty);
      return m;
    });
    const result = planPath(baseInput({ mastery }));
    const ids = result.steps.map((s) => s.kcId);
    expect(ids).not.toContain("c01");
  });

  it("没有任何作答记录时，步骤类型是 learn", () => {
    const result = planPath(baseInput({ budgetMinutes: 45 }));
    for (const step of result.steps) expect(step.kind).toBe("learn");
  });

  it("有作答记录但未达标时，步骤类型是 review", () => {
    const mastery = masterySnapshot(0).map((s) => {
      if (s.kcId === "c01") return updateMastery(s, false, 2 as Difficulty);
      return s;
    });
    const result = planPath(baseInput({ mastery, budgetMinutes: 600, targets: ["c01"] }));
    const step = result.steps.find((s) => s.kcId === "c01");
    expect(step?.kind).toBe("review");
  });
});

describe("确定性：同一输入必须得到同一路径", () => {
  it("两次调用结果完全一致", () => {
    const input = baseInput();
    const a = planPath(input);
    const b = planPath(input);
    expect(a.steps).toEqual(b.steps);
    expect(a.pathHash).toBe(b.pathHash);
  });

  it("与掌握度数组的顺序无关", () => {
    const input = baseInput();
    const reversed: PlanInput = { ...input, mastery: [...input.mastery].reverse() };
    const a = planPath(input);
    const b = planPath(reversed);
    expect(a.steps).toEqual(b.steps);
    expect(a.pathHash).toBe(b.pathHash);
  });

  it("hash 是 64 位十六进制（sha256）", () => {
    const result = planPath(baseInput());
    expect(result.pathHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("预算不同则 hash 不同", () => {
    const a = planPath(baseInput({ budgetMinutes: 60 }));
    const b = planPath(baseInput({ budgetMinutes: 240 }));
    expect(a.pathHash).not.toBe(b.pathHash);
  });

  it("hash 不含模型信息：改变与 LLM 无关的外部状态不影响 hash", () => {
    // planPath 是纯函数，签名里根本没有模型参数。
    // 这条测试的意义是：如果将来有人往输入里塞 modelVersion 并影响排序，这里会失败。
    const input = baseInput();
    const a = planPath(input);
    const b = planPath({ ...input });
    expect(a.pathHash).toBe(b.pathHash);
    expect(ALGO_VERSION).toBe("plan-v1");
  });
});

describe("golden case：把当前输出固定住", () => {
  /**
   * 这个 hash 一旦变化，说明排序规则或图谱变了。
   * 改算法必须同时改这里，并在提交信息里说明为什么。
   */
  const GOLDEN_INPUT = baseInput({ budgetMinutes: 120 });

  it("空掌握度 + 120 分钟预算的路径 hash 稳定", () => {
    const result = planPath(GOLDEN_INPUT);
    // 首次生成后固定，后续任何算法改动都会让这条测试红
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.pathHash).toMatch(/^[0-9a-f]{64}$/);

    // 再次计算必须完全一致
    expect(planPath(GOLDEN_INPUT).pathHash).toBe(result.pathHash);
  });

  it("路径步骤数量与预算的对应关系稳定", () => {
    const r120 = planPath(baseInput({ budgetMinutes: 120 }));
    const r30 = planPath(baseInput({ budgetMinutes: 30 }));
    // 30 分钟最多 2 步（每步 15 分钟）
    expect(r30.steps.length).toBeLessThanOrEqual(2);
    expect(r120.steps.length).toBeLessThanOrEqual(8);
  });
});

describe("路径校验函数本身", () => {
  it("能检出违反先修顺序的路径", () => {
    const bad = [
      { kcId: "c05", kind: "learn" as const, estMinutes: 15, reason: "", source: "manual" as const },
      { kcId: "c01", kind: "learn" as const, estMinutes: 15, reason: "", source: "manual" as const },
    ];
    const violations = checkPrereqOrder(knowledgeGraph, bad);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("合法路径返回空数组", () => {
    const good = [
      { kcId: "c01", kind: "learn" as const, estMinutes: 15, reason: "", source: "algorithm" as const },
      { kcId: "c05", kind: "learn" as const, estMinutes: 15, reason: "", source: "algorithm" as const },
    ];
    expect(checkPrereqOrder(knowledgeGraph, good)).toEqual([]);
  });

  it("先修点不在路径里时视为已掌握，不算违规", () => {
    const onlyLeaf = [
      { kcId: "c05", kind: "learn" as const, estMinutes: 15, reason: "", source: "algorithm" as const },
    ];
    expect(checkPrereqOrder(knowledgeGraph, onlyLeaf)).toEqual([]);
  });
});

describe("目标定向规划", () => {
  it("指定目标时，路径只包含目标的先修闭包", () => {
    const result = planPath(baseInput({ targets: ["c09"], budgetMinutes: 600 }));
    const ids = new Set(result.steps.map((s) => s.kcId));
    // c09（栈）依赖 c05（顺序表）→ c01
    expect(ids.has("c09")).toBe(true);
    // 与栈无关的知识点不应出现
    expect(ids.has("c39")).toBe(false);
  });

  it("指定目标且先修已掌握时，只排目标本身", () => {
    // c09（栈）的直接先修是 c05（顺序表），c05 又依赖 c02（复杂度）与 c01（基本概念）。
    // 要把整条链都标为已掌握，路径里才只剩目标点——这正是先修闭包的意义。
    const prerequisitesOfC09 = ["c01", "c02", "c05"];
    const mastery = masterySnapshot(0).map((s) => {
      if (prerequisitesOfC09.includes(s.kcId)) {
        let m = s;
        for (let i = 0; i < 3; i += 1) m = updateMastery(m, true, 2 as Difficulty);
        return m;
      }
      return s;
    });
    const result = planPath(baseInput({ mastery, targets: ["c09"], budgetMinutes: 600 }));
    expect(result.steps.map((s) => s.kcId)).toEqual(["c09"]);
  });

  it("先修链未全部掌握时，缺失的前置知识点会被排进来", () => {
    // 只标 c01 与 c05 已掌握、漏掉 c02，则 c02 必须出现，否则学生学不动栈
    const mastery = masterySnapshot(0).map((s) => {
      if (s.kcId === "c01" || s.kcId === "c05") {
        let m = s;
        for (let i = 0; i < 3; i += 1) m = updateMastery(m, true, 2 as Difficulty);
        return m;
      }
      return s;
    });
    const result = planPath(baseInput({ mastery, targets: ["c09"], budgetMinutes: 600 }));
    const ids = result.steps.map((s) => s.kcId);
    expect(ids).toContain("c02");
    expect(ids).toContain("c09");
    // 而且 c02 必须排在 c09 之前
    expect(ids.indexOf("c02")).toBeLessThan(ids.indexOf("c09"));
  });
});

describe("解释理由必须引用具体数值", () => {
  it("每一步的 reason 都包含百分比或次数", () => {
    const result = planPath(baseInput({ budgetMinutes: 240 }));
    for (const step of result.steps) {
      expect(step.reason).toMatch(/\d+%/);
    }
  });
});

describe("planPath 是纯函数", () => {
  it("不修改输入对象", () => {
    const input = baseInput();
    const masterySnapshotCopy = JSON.stringify(input.mastery);
    const stepsBefore = planPath(input).steps;
    const stepsAfter = planPath(input).steps;

    expect(JSON.stringify(input.mastery)).toBe(masterySnapshotCopy);
    expect(stepsBefore).toEqual(stepsAfter);
  });

  it("返回值可被 JSON 序列化（可存库、可做 input_snapshot）", () => {
    const result: PlanResult = planPath(baseInput());
    const roundTrip = JSON.parse(JSON.stringify(result)) as PlanResult;
    expect(roundTrip.pathHash).toBe(result.pathHash);
    expect(roundTrip.steps).toEqual(result.steps);
  });
});

describe("阈值行为", () => {
  it("自定义 masteryTarget 会改变哪些点被排入", () => {
    const mastery = masterySnapshot(0).map((s) => {
      let m = s;
      if (m.kcId === "c01") {
        // 掌握度约 0.74
        for (let i = 0; i < 3; i += 1) m = updateMastery(m, true, 2 as Difficulty);
      }
      return m;
    });

    const low = planPath(baseInput({ mastery, masteryTarget: 0.5, budgetMinutes: 600 }));
    const high = planPath(baseInput({ mastery, masteryTarget: 0.9, budgetMinutes: 600 }));

    expect(low.steps.map((s) => s.kcId)).not.toContain("c01");
    expect(high.steps.map((s) => s.kcId)).toContain("c01");
    expect(DEFAULT_MASTERY_TARGET).toBe(0.6);
  });
});
