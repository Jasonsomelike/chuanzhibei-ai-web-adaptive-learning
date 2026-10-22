import { describe, it, expect } from "vitest";
import {
  difficultyWeight,
  initialMastery,
  updateMastery,
  masteryMean,
  masterySd,
  hasEnoughEvidence,
  describeConfidence,
  priorMastery,
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
});

describe("置信描述", () => {
  it("以观测次数为主信息，而不是只给档位", () => {
    let s = initialMastery("c01", 0);
    expect(describeConfidence(s)).toBe("尚未测评");

    s = updateMastery(s, true, 2);
    const text = describeConfidence(s);
    expect(text).toContain("已测 1 题");
    expect(text).toContain("%");
    expect(text).toContain("±");
  });
});
