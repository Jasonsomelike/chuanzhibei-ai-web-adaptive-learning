import { describe, it, expect } from "vitest";
import {
  createLearner,
  recordAttempt,
  recordPathEdit,
  attemptedQuestionIds,
  type LearnerState,
} from "@/lib/learner";
import { questions } from "@/data/questions";
import { masteryMean, masterySd } from "@/lib/mastery";
import { knowledgeGraph } from "@/data/knowledge-graph";

const NOW = "2026-10-22T10:00:00.000Z";

describe("新建学习者", () => {
  it("为全部 40 个知识点建立先验掌握度", () => {
    const state = createLearner();
    expect(state.mastery).toHaveLength(knowledgeGraph.concepts.length);
    expect(state.attempts).toHaveLength(0);
    expect(state.pathEdits).toHaveLength(0);
  });

  it("根节点先验高于深层节点", () => {
    const state = createLearner();
    const c01 = state.mastery.find((m) => m.kcId === "c01");
    const deep = state.mastery.find((m) => m.kcId === "c40");
    expect(c01).toBeDefined();
    expect(deep).toBeDefined();
    expect(masteryMean(c01!)).toBeGreaterThan(masteryMean(deep!));
  });
});

describe("记录作答", () => {
  const q = questions.find((x) => x.kcId === "c09")!;

  it("答对提升该知识点掌握度，不影响其他知识点", () => {
    const before = createLearner();
    const after = recordAttempt(before, q, true, NOW);

    const beforeC09 = before.mastery.find((m) => m.kcId === "c09")!;
    const afterC09 = after.mastery.find((m) => m.kcId === "c09")!;
    expect(masteryMean(afterC09)).toBeGreaterThan(masteryMean(beforeC09));

    const beforeC10 = before.mastery.find((m) => m.kcId === "c10")!;
    const afterC10 = after.mastery.find((m) => m.kcId === "c10")!;
    expect(afterC10).toEqual(beforeC10);
  });

  it("答错降低掌握度", () => {
    const before = createLearner();
    const after = recordAttempt(before, q, false, NOW);
    const b = before.mastery.find((m) => m.kcId === "c09")!;
    const a = after.mastery.find((m) => m.kcId === "c09")!;
    expect(masteryMean(a)).toBeLessThan(masteryMean(b));
  });

  it("追加作答记录，保留时间戳与难度", () => {
    const after = recordAttempt(createLearner(), q, true, NOW);
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0]).toMatchObject({
      questionId: q.id,
      kcId: q.kcId,
      difficulty: q.difficulty,
      correct: true,
      at: NOW,
    });
  });

  it("是纯函数：不修改原状态", () => {
    const before = createLearner();
    const snapshot = JSON.stringify(before);
    recordAttempt(before, q, true, NOW);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("多次作答累加证据", () => {
    let s: LearnerState = createLearner();
    const kcQuestions = questions.filter((x) => x.kcId === "c09");
    for (const question of kcQuestions) s = recordAttempt(s, question, true, NOW);

    const m = s.mastery.find((x) => x.kcId === "c09")!;
    expect(m.evidenceN).toBe(3);

    // 实测值：c09 先验 0.20（深度 3），三题难度 1/2/3 全对后
    // 掌握度 0.68、sd 0.190 —— 刚好进入「证据充分」档（sd ≤ 0.20）
    expect(masteryMean(m)).toBeCloseTo(0.68, 2);
    expect(masterySd(m)).toBeLessThanOrEqual(0.2);
  });

  it("同一知识点的三题难度有梯度，恰好覆盖易中难", () => {
    // 难度梯度是「3 题可达证据充分」的前提，不是随意排的
    const kcQuestions = questions.filter((x) => x.kcId === "c09");
    const difficulties = kcQuestions.map((q) => q.difficulty).sort();
    expect(difficulties).toEqual([1, 2, 3]);
  });
});

describe("已做过的题", () => {
  it("返回该知识点下已作答的题目 id", () => {
    const qs = questions.filter((x) => x.kcId === "c09");
    let s: LearnerState = createLearner();
    s = recordAttempt(s, qs[0], true, NOW);
    s = recordAttempt(s, qs[1], false, NOW);

    const ids = attemptedQuestionIds(s, "c09");
    expect(ids.has(qs[0].id)).toBe(true);
    expect(ids.has(qs[1].id)).toBe(true);
    expect(ids.has(qs[2].id)).toBe(false);
  });

  it("不包含其他知识点的题", () => {
    const qs = questions.filter((x) => x.kcId === "c09");
    const s = recordAttempt(createLearner(), qs[0], true, NOW);
    expect(attemptedQuestionIds(s, "c10").size).toBe(0);
  });
});

describe("手动改路径的记录", () => {
  it("追加编辑记录并带时间戳", () => {
    const s = recordPathEdit(createLearner(), { kind: "reorder", detail: "把 c05 移到前面" }, NOW);
    expect(s.pathEdits).toHaveLength(1);
    expect(s.pathEdits[0]).toMatchObject({
      kind: "reorder",
      detail: "把 c05 移到前面",
      at: NOW,
    });
  });

  it("支持三种编辑类型", () => {
    let s = createLearner();
    s = recordPathEdit(s, { kind: "add", detail: "加 c40" }, NOW);
    s = recordPathEdit(s, { kind: "remove", detail: "删 c39" }, NOW);
    s = recordPathEdit(s, { kind: "reorder", detail: "调序" }, NOW);
    expect(s.pathEdits.map((e) => e.kind)).toEqual(["add", "remove", "reorder"]);
  });
});
