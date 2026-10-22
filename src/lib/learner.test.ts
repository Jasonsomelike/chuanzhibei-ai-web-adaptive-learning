import { describe, it, expect } from "vitest";
import {
  createLearner,
  createSubjectProgress,
  recordAttempt,
  recordPathEdit,
  attemptedQuestionIds,
  attemptCount,
  progressOf,
  type LearnerState,
} from "@/lib/learner";
import { questions } from "@/data/questions";
import { masteryMean, masterySd } from "@/lib/mastery";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { DEFAULT_SUBJECT_ID, SUBJECTS } from "@/data/subjects";

const NOW = "2026-10-22T10:00:00.000Z";
const DS = DEFAULT_SUBJECT_ID;

describe("新建学习者", () => {
  it("初始只包含默认学科", () => {
    const state = createLearner();
    expect(Object.keys(state.subjects)).toEqual([DS]);
    expect(state.version).toBe(2);
  });

  it("默认学科为全部知识点建立先验掌握度", () => {
    const state = createLearner();
    const progress = progressOf(state, DS);
    expect(progress.mastery).toHaveLength(knowledgeGraph.concepts.length);
    expect(progress.attempts).toHaveLength(0);
    expect(progress.pathEdits).toHaveLength(0);
  });

  it("根节点先验高于深层节点", () => {
    const progress = createSubjectProgress(DS);
    const c01 = progress.mastery.find((m) => m.kcId === "c01");
    const deep = progress.mastery.find((m) => m.kcId === "c40");
    expect(c01).toBeDefined();
    expect(deep).toBeDefined();
    expect(masteryMean(c01!)).toBeGreaterThan(masteryMean(deep!));
  });

  it("每个学科都有独立的进度结构", () => {
    for (const s of SUBJECTS) {
      const p = createSubjectProgress(s.id);
      expect(p.mastery).toHaveLength(s.graph.concepts.length);
      // 知识点 id 必须属于该学科
      const ids = new Set(s.graph.concepts.map((c) => c.id));
      for (const m of p.mastery) expect(ids.has(m.kcId)).toBe(true);
    }
  });
});

describe("学科隔离：这是多学科的关键约束", () => {
  it("在一个学科作答不影响其他学科", () => {
    const q = questions.find((x) => x.kcId === "c09")!;
    const before = createLearner();
    const after = recordAttempt(before, DS, q, true, NOW);

    // 默认学科变了
    const dsAfter = progressOf(after, DS);
    expect(dsAfter.attempts).toHaveLength(1);

    // 其他学科仍然是空的
    for (const s of SUBJECTS) {
      if (s.id === DS) continue;
      const p = progressOf(after, s.id);
      expect(p.attempts).toHaveLength(0);
    }
  });

  it("各学科的掌握度互不干扰", () => {
    const q = questions.find((x) => x.kcId === "c09")!;
    const state = recordAttempt(createLearner(), DS, q, true, NOW);

    const dsMastery = progressOf(state, DS).mastery.find((m) => m.kcId === "c09")!;
    expect(dsMastery.evidenceN).toBe(1);

    // 网络学科里没有 c09，取它的第一个知识点验证未被影响
    const network = SUBJECTS.find((s) => s.id === "network")!;
    const nProgress = progressOf(state, network.id);
    for (const m of nProgress.mastery) expect(m.evidenceN).toBe(0);
  });
});

describe("记录作答", () => {
  const q = questions.find((x) => x.kcId === "c09")!;

  it("答对提升该知识点掌握度，不影响同科其他知识点", () => {
    const before = createLearner();
    const after = recordAttempt(before, DS, q, true, NOW);

    const beforeC09 = progressOf(before, DS).mastery.find((m) => m.kcId === "c09")!;
    const afterC09 = progressOf(after, DS).mastery.find((m) => m.kcId === "c09")!;
    expect(masteryMean(afterC09)).toBeGreaterThan(masteryMean(beforeC09));

    const beforeC10 = progressOf(before, DS).mastery.find((m) => m.kcId === "c10")!;
    const afterC10 = progressOf(after, DS).mastery.find((m) => m.kcId === "c10")!;
    expect(afterC10).toEqual(beforeC10);
  });

  it("答错降低掌握度", () => {
    const before = createLearner();
    const after = recordAttempt(before, DS, q, false, NOW);
    const b = progressOf(before, DS).mastery.find((m) => m.kcId === "c09")!;
    const a = progressOf(after, DS).mastery.find((m) => m.kcId === "c09")!;
    expect(masteryMean(a)).toBeLessThan(masteryMean(b));
  });

  it("追加作答记录，保留时间戳与难度", () => {
    const after = recordAttempt(createLearner(), DS, q, true, NOW);
    const attempts = progressOf(after, DS).attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
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
    recordAttempt(before, DS, q, true, NOW);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("多次作答累加证据", () => {
    let s: LearnerState = createLearner();
    const kcQuestions = questions.filter((x) => x.kcId === "c09");
    for (const question of kcQuestions) s = recordAttempt(s, DS, question, true, NOW);

    const m = progressOf(s, DS).mastery.find((x) => x.kcId === "c09")!;
    expect(m.evidenceN).toBe(3);

    // 实测值：c09 先验 0.20（深度 3），三题难度 1/2/3 全对后
    // 掌握度 0.68、sd 0.190 —— 刚好进入「证据充分」档（sd ≤ 0.20）
    expect(masteryMean(m)).toBeCloseTo(0.68, 2);
    expect(masterySd(m)).toBeLessThanOrEqual(0.2);
  });

  it("同一知识点的三题难度有梯度，恰好覆盖易中难", () => {
    const kcQuestions = questions.filter((x) => x.kcId === "c09");
    const difficulties = kcQuestions.map((q2) => q2.difficulty).sort();
    expect(difficulties).toEqual([1, 2, 3]);
  });
});

describe("已做过的题", () => {
  it("返回该学科该知识点下已作答的题目 id", () => {
    const qs = questions.filter((x) => x.kcId === "c09");
    let s: LearnerState = createLearner();
    s = recordAttempt(s, DS, qs[0], true, NOW);
    s = recordAttempt(s, DS, qs[1], false, NOW);

    const ids = attemptedQuestionIds(s, DS, "c09");
    expect(ids.has(qs[0].id)).toBe(true);
    expect(ids.has(qs[1].id)).toBe(true);
    expect(ids.has(qs[2].id)).toBe(false);
  });

  it("不包含其他知识点的题", () => {
    const qs = questions.filter((x) => x.kcId === "c09");
    const s = recordAttempt(createLearner(), DS, qs[0], true, NOW);
    expect(attemptedQuestionIds(s, DS, "c10").size).toBe(0);
  });

  it("attemptCount 按学科统计", () => {
    const qs = questions.filter((x) => x.kcId === "c09");
    let s = createLearner();
    s = recordAttempt(s, DS, qs[0], true, NOW);
    s = recordAttempt(s, DS, qs[1], true, NOW);
    expect(attemptCount(s, DS)).toBe(2);

    const network = SUBJECTS.find((x) => x.id === "network")!;
    expect(attemptCount(s, network.id)).toBe(0);
  });
});

describe("手动改路径的记录", () => {
  it("追加编辑记录并带时间戳", () => {
    const s = recordPathEdit(
      createLearner(),
      DS,
      { kind: "reorder", detail: "把 c05 移到前面" },
      NOW,
    );
    const edits = progressOf(s, DS).pathEdits;
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      kind: "reorder",
      detail: "把 c05 移到前面",
      at: NOW,
    });
  });

  it("支持三种编辑类型，且只影响当前学科", () => {
    let s = createLearner();
    s = recordPathEdit(s, DS, { kind: "add", detail: "加 c40" }, NOW);
    s = recordPathEdit(s, DS, { kind: "remove", detail: "删 c39" }, NOW);
    s = recordPathEdit(s, DS, { kind: "reorder", detail: "调序" }, NOW);
    expect(progressOf(s, DS).pathEdits.map((e) => e.kind)).toEqual([
      "add",
      "remove",
      "reorder",
    ]);

    const os = SUBJECTS.find((x) => x.id === "os")!;
    expect(progressOf(s, os.id).pathEdits).toHaveLength(0);
  });
});

describe("进度结构完整性", () => {
  it("progressOf 对未访问的学科返回新建进度而不是 undefined", () => {
    const s = createLearner();
    const p = progressOf(s, "network");
    expect(p).toBeDefined();
    expect(p.mastery.length).toBeGreaterThan(0);
    expect(p.attempts).toHaveLength(0);
  });

  it("状态可 JSON 往返（可存库）", () => {
    const q = questions.find((x) => x.kcId === "c09")!;
    const s = recordAttempt(createLearner(), DS, q, true, NOW);
    const roundTrip = JSON.parse(JSON.stringify(s)) as LearnerState;
    expect(roundTrip.version).toBe(2);
    expect(progressOf(roundTrip, DS).attempts).toHaveLength(1);
  });
});
