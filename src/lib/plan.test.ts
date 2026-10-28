import { describe, it, expect, vi, afterEach } from "vitest";
import {
  planPath,
  checkPrereqOrder,
  masteredSet,
  computeInputHash,
  computePathHash,
  applyManualOrder,
  movedKcIds,
  ALGO_VERSION,
  DEFAULT_MASTERY_TARGET,
  type PlanInput,
  type PlanResult,
  type PathStep,
} from "@/lib/plan";
import { initialMastery, updateMastery, type MasteryState, type Difficulty } from "@/lib/mastery";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { computeDepths } from "@/lib/graph";

/**
 * golden 字面量。重新生成：
 *   node node_modules/tsx/dist/cli.mjs scripts/path-hash.ts
 */
// 2026-10-26：inputHash 改为覆盖图谱内容（concepts/edges），
// 此字面量随之更新；pathHash 未变（ad7c…），因为排序逻辑没动。
const GOLDEN_INPUT_HASH = "f9f9999230b4c06be74c235e4f7bedc39dcb7c4b947dea80f4dbb89539e61ecd";
const GOLDEN_PATH_HASH = "ad7ccec537db36ee7b0070aca3f9f99006e92521e16ce2608def4df76f2b9e66";

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
    const input = baseInput();
    const result = planPath(input);
    expect(
      checkPrereqOrder(knowledgeGraph, result.steps, { mastered: masteredSet(input.mastery) }),
    ).toEqual([]);
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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("hash 不含模型信息：外部状态不可用时输出逐位一致", () => {
    /*
     * 先说清这条测试**不**证明什么：PlanInput 里没有 modelVersion 字段，
     * canonicalPlanJson 也只序列化 steps + algoVersion + kgVersion，
     * 所以下面「两个 modelVersion 同 hash」是结构上必然成立的，它不是证据。
     * 真正被锁住的是后半段：把 fetch / Math.random / Date.now 全部换成
     * 「一调用就抛」之后，planPath 仍给出同一个 pathHash，证明它不读外部状态。
     * 顺带锁住「多传未知字段会被丢弃、不会渗进指纹」这一点。
     */
    const withGpt = planPath({ ...baseInput(), modelVersion: "gpt-4o" } as PlanInput);
    const withClaude = planPath({ ...baseInput(), modelVersion: "claude" } as PlanInput);
    expect(withGpt.pathHash).toBe(withClaude.pathHash);

    vi.stubGlobal("fetch", () => {
      throw new Error("planPath 不应发起网络请求");
    });
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("planPath 不应依赖随机数");
    });
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("planPath 不应依赖当前时间");
    });

    // 外部状态全部不可用，输出必须与刚才逐位一致
    const offline = planPath({ ...baseInput(), modelVersion: "gpt-4o" } as PlanInput);
    expect(offline.steps).toEqual(withGpt.steps);
    expect(offline.pathHash).toBe(withGpt.pathHash);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(nowSpy).not.toHaveBeenCalled();
    expect(ALGO_VERSION).toBe("plan-v2");
  });
});

describe("golden case：把当前输出固定住", () => {
  /**
   * 这两个字面量一旦变化，说明排序规则、图谱或哈希口径变了。
   * 改算法必须同时改这里，并在提交信息里说明为什么。
   * 重新生成：node node_modules/tsx/dist/cli.mjs scripts/path-hash.ts
   */
  const GOLDEN_INPUT = baseInput({ budgetMinutes: 120 });

  it("空掌握度 + 120 分钟预算的输入/路径指纹固定", () => {
    const result = planPath(GOLDEN_INPUT);
    expect(result.steps.length).toBeGreaterThan(0);

    // 首次生成后固定，后续任何算法改动都会让这条测试红
    expect(computeInputHash(GOLDEN_INPUT)).toBe(GOLDEN_INPUT_HASH);
    expect(result.pathHash).toBe(GOLDEN_PATH_HASH);
  });

  it("把某一步 estMinutes 改 1 分钟，pathHash 必须变", () => {
    const result = planPath(GOLDEN_INPUT);
    const tampered = {
      ...result,
      steps: result.steps.map((s, i) => (i === 0 ? { ...s, estMinutes: s.estMinutes + 1 } : s)),
    };
    expect(computePathHash(tampered)).not.toBe(result.pathHash);
  });

  it("路径步骤数量与预算的对应关系稳定", () => {
    const r120 = planPath(baseInput({ budgetMinutes: 120 }));
    const r30 = planPath(baseInput({ budgetMinutes: 30 }));
    // 30 分钟最多 2 步（每步 15 分钟）
    expect(r30.steps.length).toBeLessThanOrEqual(2);
    expect(r120.steps.length).toBeLessThanOrEqual(8);
  });

  it("深度先验进入输入指纹，但同一预算下路径未必变（覆盖范围说明）", () => {
    /*
     * golden case 的掌握度全用 initialMastery(c.id, 0)，depth 分支没被覆盖：
     * 改 priorMastery(depth) 不会让 golden 变红。这条补上那个缺口。
     *
     * 实测：用真实深度建快照，inputHash 一定变（α/β 不同），
     * 但 120 分钟预算下的路径**恰好相同**——排序第一关键字是深度，
     * 同深度内先验又一致，ZPD 距离的差异不足以改变前 8 步的顺序。
     * 所以这条只锁输入指纹；把「路径也变」写进断言会是假承诺。
     */
    const depths = computeDepths(knowledgeGraph);
    const byDepth = knowledgeGraph.concepts.map((c) =>
      initialMastery(c.id, depths.get(c.id) ?? 0),
    );
    const flat = knowledgeGraph.concepts.map((c) => initialMastery(c.id, 0));

    expect(
      computeInputHash({ graph: knowledgeGraph, mastery: byDepth, budgetMinutes: 120 }),
    ).not.toBe(computeInputHash({ graph: knowledgeGraph, mastery: flat, budgetMinutes: 120 }));

    // 两种先验确实不同（深度 > 0 的点 α 更低）
    const deepByDepth = byDepth.find((m) => m.kcId === "c40")!;
    const deepFlat = flat.find((m) => m.kcId === "c40")!;
    expect(deepByDepth.alpha).toBeLessThan(deepFlat.alpha);
  });
});

describe("先修闭包装包（回归）", () => {
  /**
   * 合成图：a→b，a 是 learn（15 分钟）、b 是 review（8 分钟）。
   * 预算 10 分钟时旧实现会推迟 a 却排进 b——「先修没排、后继却排了」。
   * 这条用例在旧代码上必然失败，因为 a 被 deferred 而 b 进了 steps。
   */
  it("先修被推迟时，后继必须被阻塞而不是排进路径", () => {
    const graph = {
      version: "kg-test-v1",
      concepts: [
        { id: "a", name: "A", summary: "", chapter: "t" },
        { id: "b", name: "B", summary: "", chapter: "t" },
      ],
      edges: [{ before: "a", after: "b" }],
    };
    const mastery = [
      initialMastery("a", 0),
      updateMastery(initialMastery("b", 1), true, 2 as Difficulty),
    ];

    const result = planPath({ graph, mastery, budgetMinutes: 10 });
    expect(result.steps.map((s) => s.kcId)).toEqual([]);
    expect(result.deferred).toEqual(["a"]);
    expect(result.blocked).toEqual([{ kcId: "b", by: ["a"] }]);
  });

  /**
   * 混合证据：偶数下标的知识点答错 2 题，奇数下标全对 3 题。
   * 这样 ZPD 距离不再单调跟随深度，贪心会把某些后继排到先修前面。
   */
  function mixedMastery(): MasteryState[] {
    return knowledgeGraph.concepts.map((c, i) => {
      let s = initialMastery(c.id, 0);
      if (i % 2 === 0) {
        for (let k = 0; k < 2; k += 1) s = updateMastery(s, false, 2 as Difficulty);
      } else {
        for (let k = 0; k < 3; k += 1) s = updateMastery(s, true, 2 as Difficulty);
      }
      return s;
    });
  }

  it("任何预算下都不出现「先修被推迟、后继却在路径」", () => {
    const mastery = mixedMastery();
    for (const budget of [8, 30, 45, 60, 90, 120, 180, 240, 360, 600]) {
      const result = planPath(baseInput({ mastery, budgetMinutes: budget }));
      const stepIds = new Set(result.steps.map((s) => s.kcId));
      const mastered = masteredSet(mastery);

      for (const step of result.steps) {
        const preds = knowledgeGraph.edges
          .filter((e) => e.after === step.kcId)
          .map((e) => e.before);
        for (const p of preds) {
          if (mastered.has(p)) continue;
          expect(stepIds.has(p)).toBe(true);
        }
      }
    }
  });

  it("小预算下 blocked 非空，且 blocked 的每个点都有明确的阻塞者", () => {
    const result = planPath(baseInput({ mastery: mixedMastery(), budgetMinutes: 60 }));
    expect(result.blocked.length).toBeGreaterThan(0);
    for (const b of result.blocked) {
      expect(b.by.length).toBeGreaterThan(0);
      expect(result.deferred.includes(b.kcId)).toBe(false);
      expect(result.steps.map((s) => s.kcId)).not.toContain(b.kcId);
    }
  });

  it("checkPrereqOrder 用 mastered 校验算法输出不报违规", () => {
    const mastery = mixedMastery();
    for (const budget of [45, 120, 240]) {
      const result = planPath(baseInput({ mastery, budgetMinutes: budget }));
      expect(
        checkPrereqOrder(knowledgeGraph, result.steps, { mastered: masteredSet(mastery) }),
      ).toEqual([]);
    }
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

  it("先修不在路径里且未声明已掌握时，算违规", () => {
    const onlyLeaf = [
      { kcId: "c05", kind: "learn" as const, estMinutes: 15, reason: "", source: "algorithm" as const },
    ];
    // 旧行为把「先修不在路径」一律当已掌握，正好掩盖了「先修被推迟、后继却排进」的 bug
    const violations = checkPrereqOrder(knowledgeGraph, onlyLeaf, { mastered: new Set() });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join("\n")).toContain("未标记为已掌握");
  });

  it("先修不在路径里但显式传入 mastered 时，不算违规", () => {
    const onlyLeaf = [
      { kcId: "c05", kind: "learn" as const, estMinutes: 15, reason: "", source: "algorithm" as const },
    ];
    const mastered = new Set(["c01", "c02"]);
    expect(checkPrereqOrder(knowledgeGraph, onlyLeaf, { mastered })).toEqual([]);
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

describe("手动顺序重放", () => {
  const step = (kcId: string, source: "algorithm" | "manual" = "algorithm"): PathStep => ({
    kcId,
    kind: "learn",
    estMinutes: 15,
    reason: "",
    source,
  });

  it("edit 为 null 时原样返回", () => {
    const steps = [step("a"), step("b")];
    expect(applyManualOrder(steps, null)).toEqual(steps);
  });

  it("按用户顺序重排，但不改写 source", () => {
    /*
     * 旧实现给 order 里的每个点都写 source: "manual"，
     * 点一次 ↑ 后整条路径都显示「已手动调整」。
     * 哪些点真的动了应由 movedKcIds 比较位置得出。
     */
    const result = applyManualOrder([step("a"), step("b"), step("c")], {
      order: ["c", "a", "b"],
      removed: [],
    });
    expect(result.map((s) => s.kcId)).toEqual(["c", "a", "b"]);
    expect(result.every((s) => s.source === "algorithm")).toBe(true);
  });

  it("移除的点不会再被追加回末尾", () => {
    /*
     * 回归：旧实现只把 kcId 从 order 里去掉，第二个循环又把
     * plan.steps 里「不在 order」的它追加回来，于是「移除」是空操作。
     */
    const steps = [step("a"), step("b"), step("c")];
    const result = applyManualOrder(steps, { order: ["a", "c"], removed: ["b"] });
    expect(result.map((s) => s.kcId)).toEqual(["a", "c"]);
    expect(result.map((s) => s.kcId)).not.toContain("b");
  });

  it("移除 + 重排同时生效", () => {
    const steps = [step("a"), step("b"), step("c"), step("d")];
    const result = applyManualOrder(steps, { order: ["d", "a", "c"], removed: ["b"] });
    expect(result.map((s) => s.kcId)).toEqual(["d", "a", "c"]);
  });

  it("预算收缩后，装不下的点自动消失", () => {
    /*
     * 这是「手动 16 步 → 预算改 30 分钟仍显示 16 步」的回归：
     * 重放的对象是当前预算的 steps，不在里面的 kcId 会被跳过。
     */
    const smallBudgetSteps = [step("a"), step("b")];
    const result = applyManualOrder(smallBudgetSteps, { order: ["c", "b", "a"], removed: [] });
    expect(result.map((s) => s.kcId)).toEqual(["b", "a"]);
  });

  it("新预算下才装得下的点追加在末尾，保持算法次序", () => {
    const result = applyManualOrder([step("a"), step("b"), step("c"), step("d")], {
      order: ["c", "a"],
      removed: [],
    });
    expect(result.map((s) => s.kcId)).toEqual(["c", "a", "b", "d"]);
    // 追加的点保持算法来源，不冒充手动调整
    expect(result[2].source).toBe("algorithm");
    expect(result[3].source).toBe("algorithm");
  });

  it("order 里有不存在的 kcId 时忽略，不抛错", () => {
    const result = applyManualOrder([step("a")], { order: ["nope", "a"], removed: [] });
    expect(result.map((s) => s.kcId)).toEqual(["a"]);
  });
});

describe("哪些点被真的挪动过", () => {
  const step = (kcId: string): PathStep => ({
    kcId,
    kind: "learn",
    estMinutes: 15,
    reason: "",
    source: "algorithm",
  });

  it("位置没变的点不算挪动", () => {
    const planSteps = [step("a"), step("b"), step("c")];
    const moved = movedKcIds(planSteps, planSteps);
    expect(moved.size).toBe(0);
  });

  it("只有真正换了位置的点被标记", () => {
    const planSteps = [step("a"), step("b"), step("c")];
    const displayed = [step("c"), step("a"), step("b")];
    const moved = movedKcIds(displayed, planSteps);
    // c 从 2→0、a 从 0→1 都变了；b 从 1→2 也变了
    expect([...moved].sort()).toEqual(["a", "b", "c"]);
  });

  it("交换两个相邻点时只标记这两个", () => {
    const planSteps = [step("a"), step("b"), step("c"), step("d")];
    const displayed = [step("a"), step("c"), step("b"), step("d")];
    const moved = movedKcIds(displayed, planSteps);
    expect([...moved].sort()).toEqual(["b", "c"]);
  });

  it("被移除的点不出现在结果里", () => {
    const planSteps = [step("a"), step("b")];
    const displayed = [step("a")];
    const moved = movedKcIds(displayed, planSteps);
    expect(moved.has("b")).toBe(false);
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

describe("输入指纹必须覆盖图谱内容", () => {
  /**
   * 这组是回归测试。此前 inputHash 只放 graph.version，
   * 改了边却没 bump version 时 inputHash 不变而 pathHash 变了，
   * 界面上「输入指纹相同 → 路径指纹必然相同」的提示就是假的。
   */
  it("改一条边、不改版本号，inputHash 必须变", () => {
    const mastery = masterySnapshot(0);
    const base = {
      graph: knowledgeGraph,
      mastery,
      budgetMinutes: 120,
    };

    const edited = {
      ...base,
      graph: {
        ...knowledgeGraph,
        edges: knowledgeGraph.edges.slice(1), // 少一条边，version 不动
      },
    };

    expect(computeInputHash(edited)).not.toBe(computeInputHash(base));
  });

  it("改知识点集合、不改版本号，inputHash 必须变", () => {
    const mastery = masterySnapshot(0);
    const base = { graph: knowledgeGraph, mastery, budgetMinutes: 120 };
    const edited = {
      ...base,
      graph: {
        ...knowledgeGraph,
        concepts: knowledgeGraph.concepts.slice(1),
      },
    };

    expect(computeInputHash(edited)).not.toBe(computeInputHash(base));
  });

  it("边的书写顺序不影响指纹", () => {
    const mastery = masterySnapshot(0);
    const a = { graph: knowledgeGraph, mastery, budgetMinutes: 120 };
    const b = {
      ...a,
      graph: { ...knowledgeGraph, edges: [...knowledgeGraph.edges].reverse() },
    };

    expect(computeInputHash(b)).toBe(computeInputHash(a));
  });

  it("输入指纹相同则路径指纹必然相同", () => {
    const input = baseInput({ budgetMinutes: 120 });
    const copy = { ...input, graph: { ...knowledgeGraph } };

    expect(computeInputHash(copy)).toBe(computeInputHash(input));
    expect(planPath(copy).pathHash).toBe(planPath(input).pathHash);
  });
});
