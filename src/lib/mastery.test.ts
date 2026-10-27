import { describe, it, expect } from "vitest";
import {
  difficultyWeight,
  initialMastery,
  updateMastery,
  updateMasteryScaled,
  masteryMean,
  masterySd,
  masteryProbAbove,
  predictCorrect,
  hasEnoughEvidence,
  priorMastery,
  EVIDENCE_TARGET,
  type Difficulty,
} from "@/lib/mastery";

describe("难度权重", () => {
  it("按 w = 0.5 + 0.25·d 计算", () => {
    expect(difficultyWeight(1)).toBeCloseTo(0.75, 10);
    expect(difficultyWeight(2)).toBeCloseTo(1.0, 10);
    expect(difficultyWeight(3)).toBeCloseTo(1.25, 10);
    expect(difficultyWeight(4)).toBeCloseTo(1.5, 10);
    expect(difficultyWeight(5)).toBeCloseTo(1.75, 10);
  });

  it("d=2 才是 w=1.0，d=3 是 1.25 —— 这是文档里曾经搞错的地方", () => {
    // research/06-synthesis.md §1.2 的表格一度标注「d=3 即 w=1.0」，
    // 与同节公式矛盾。这条测试把正确关系锁死，防止回退。
    expect(difficultyWeight(2)).toBe(1.0);
    expect(difficultyWeight(3)).not.toBe(1.0);
  });
});

describe("先验掌握度", () => {
  it("根节点为 0.35，每深一层减 0.05，下限 0.10", () => {
    expect(priorMastery(0)).toBeCloseTo(0.35, 10);
    expect(priorMastery(1)).toBeCloseTo(0.3, 10);
    expect(priorMastery(3)).toBeCloseTo(0.2, 10);
    expect(priorMastery(10)).toBe(0.1);
  });
});

describe("Beta 后验更新", () => {
  it("答对加 α、答错加 β，增量等于难度权重", () => {
    const s0 = initialMastery("c01", 0); // α=0.7, β=1.3
    const s1 = updateMastery(s0, true, 3);
    expect(s1.alpha).toBeCloseTo(0.7 + 1.25, 10);
    expect(s1.beta).toBeCloseTo(1.3, 10);
    expect(s1.evidenceN).toBe(1);

    const s2 = updateMastery(s0, false, 2);
    expect(s2.alpha).toBeCloseTo(0.7, 10);
    expect(s2.beta).toBeCloseTo(1.3 + 1.0, 10);
  });

  it("是纯函数：不修改入参", () => {
    const s0 = initialMastery("c01", 0);
    const snapshot = { ...s0 };
    updateMastery(s0, true, 2);
    expect(s0).toEqual(snapshot);
  });
});

describe("掌握度与不确定度", () => {
  it("均值等于 α/(α+β)", () => {
    const s = { kcId: "c01", alpha: 6, beta: 3, evidenceN: 5 };
    expect(masteryMean(s)).toBeCloseTo(6 / 9, 10);
  });

  it("sd 符合 Beta 分布标准差公式", () => {
    const s = { kcId: "c01", alpha: 6, beta: 3, evidenceN: 5 };
    const expected = Math.sqrt((6 * 3) / (81 * 10));
    expect(masterySd(s)).toBeCloseTo(expected, 10);
  });

  it("证据越多，sd 越小", () => {
    let s = initialMastery("c01", 0);
    const sds = [masterySd(s)];
    for (let i = 0; i < 6; i += 1) {
      s = updateMastery(s, true, 2);
      sds.push(masterySd(s));
    }
    for (let i = 1; i < sds.length; i += 1) {
      expect(sds[i]).toBeLessThan(sds[i - 1]);
    }
  });

  /**
   * 这一组是「置信档位不能只看 sd」的证据。
   * 同一知识点做 3 题（d=2），答对 2 题的 sd 反而比答对 1 题大。
   */
  it("非全对情形下 sd 非单调：答对 2 题比答对 1 题更不确定", () => {
    const sdFor = (correct: number, total: number): number => {
      let s = initialMastery("c01", 0);
      for (let i = 0; i < total; i += 1) {
        s = updateMastery(s, i < correct, 2 as Difficulty);
      }
      return masterySd(s);
    };

    const sd1 = sdFor(1, 3);
    const sd2 = sdFor(2, 3);
    expect(sd2).toBeGreaterThan(sd1);
    // 正因为如此，界面上必须显示观测次数，不能只显示档位
  });

  it("3 题全对（d=2）可达到「证据充分」", () => {
    let s = initialMastery("c01", 0);
    for (let i = 0; i < 3; i += 1) s = updateMastery(s, true, 2 as Difficulty);
    expect(hasEnoughEvidence(s)).toBe(true);
  });

  it("2 题全对（d=2）达不到「证据充分」", () => {
    let s = initialMastery("c01", 0);
    for (let i = 0; i < 2; i += 1) s = updateMastery(s, true, 2 as Difficulty);
    expect(hasEnoughEvidence(s)).toBe(false);
  });

  it("hasEnoughEvidence 同时要求条数与 sd，可指定生成题的门槛 4", () => {
    // 用 depth=13（先验 0.10）复现 EVIDENCE_TARGET 的推导：
    // 生成题按 weightScale=0.8 打折后，3 题 sd=0.2116 不达标、4 题 sd=0.1911 达标。
    let s = initialMastery("c01", 13);
    for (let i = 0; i < 3; i += 1) s = updateMasteryScaled(s, true, 2 as Difficulty, 0.8);
    // 条数够 3，但 sd 仍 > 0.20 → 不算充分（这正是 sd 判据在起作用）
    expect(s.evidenceN).toBe(3);
    expect(masterySd(s)).toBeCloseTo(0.2116, 3);
    expect(hasEnoughEvidence(s)).toBe(false);
    expect(hasEnoughEvidence(s, EVIDENCE_TARGET.generated)).toBe(false);

    s = updateMasteryScaled(s, true, 2 as Difficulty, 0.8);
    expect(hasEnoughEvidence(s, EVIDENCE_TARGET.generated)).toBe(true);
    expect(masterySd(s)).toBeCloseTo(0.1911, 3);
    expect(masterySd(s)).toBeLessThanOrEqual(0.2);
  });

  it("weightScale=0 的练习不改变状态", () => {
    const s = initialMastery("c01", 0);
    expect(updateMasteryScaled(s, true, 3, 0)).toEqual(s);
  });

  it("weightScale=0.8 的增量是默认的八成", () => {
    const s = initialMastery("c01", 0);
    const full = updateMastery(s, true, 3);
    const scaled = updateMasteryScaled(s, true, 3, 0.8);
    expect(scaled.alpha - s.alpha).toBeCloseTo((full.alpha - s.alpha) * 0.8, 10);
    expect(scaled.evidenceN).toBe(1);
  });
});

describe("预测正确率", () => {
  /**
   * 数值表固定住 logit 口径。改动 beta 或加入猜测率下限都会让这些数变，
   * 而它们直接决定诊断页选哪道题，所以必须显式锁定。
   */
  it("掌握度 0.35 时，难度 1..5 的预测值固定", () => {
    const expected = [0.641, 0.495, 0.35, 0.228, 0.14];
    for (let d = 1; d <= 5; d += 1) {
      expect(predictCorrect(0.35, d as Difficulty)).toBeCloseTo(expected[d - 1], 3);
    }
  });

  it("掌握度 0.70 时，难度 1..5 的预测值固定", () => {
    const expected = [0.886, 0.81, 0.7, 0.562, 0.413];
    for (let d = 1; d <= 5; d += 1) {
      expect(predictCorrect(0.7, d as Difficulty)).toBeCloseTo(expected[d - 1], 3);
    }
  });

  it("难度 3 时预测值等于掌握度本身", () => {
    expect(predictCorrect(0.42, 3)).toBeCloseTo(0.42, 10);
  });

  it("随难度单调递减，且落在 (0,1) 内", () => {
    let prev = 1;
    for (let d = 1; d <= 5; d += 1) {
      const p = predictCorrect(0.5, d as Difficulty);
      expect(p).toBeLessThan(prev);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
      prev = p;
    }
  });
});

describe("P(掌握度 > 阈值)", () => {
  it("Beta(1,1) 在 0.6 处等于 0.4（均匀分布）", () => {
    const s = { kcId: "k", alpha: 1, beta: 1, evidenceN: 0 };
    expect(masteryProbAbove(s, 0.6)).toBeCloseTo(0.4, 8);
  });

  it("Beta(6,3) 在 0.5 处等于 0.855469", () => {
    const s = { kcId: "k", alpha: 6, beta: 3, evidenceN: 5 };
    expect(masteryProbAbove(s, 0.5)).toBeCloseTo(0.855469, 5);
  });

  it("Beta(2,2) 在 0.5 处等于 0.5（对称）", () => {
    const s = { kcId: "k", alpha: 2, beta: 2, evidenceN: 0 };
    expect(masteryProbAbove(s, 0.5)).toBeCloseTo(0.5, 8);
  });

  it("Beta(10,2) 在 0.6 处等于 0.969767（数值积分独立核过）", () => {
    const s = { kcId: "k", alpha: 10, beta: 2, evidenceN: 0 };
    expect(masteryProbAbove(s, 0.6)).toBeCloseTo(0.969767, 5);
  });

  it("3 题全对后 P(p>0.6) 仍不到 0.9 —— 这正是不拿它当停测准则的原因", () => {
    let s = initialMastery("c01", 0);
    for (let i = 0; i < 3; i += 1) s = updateMastery(s, true, 2 as Difficulty);
    const p = masteryProbAbove(s, 0.6);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.9);
  });
});
