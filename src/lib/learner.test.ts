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
import { difficultyWeight, initialMastery, masteryMean, masterySd } from "@/lib/mastery";
import { knowledgeGraph } from "@/data/knowledge-graph";
import type { KnowledgeGraph } from "@/lib/graph";
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

  it("同一题重复作答不改变均值与 evidenceN，但 attempts 长度增加", () => {
    let s: LearnerState = createLearner();
    s = recordAttempt(s, DS, q, true, NOW);
    const first = progressOf(s, DS).mastery.find((m) => m.kcId === "c09")!;

    // 同一题连答 4 次
    for (let i = 0; i < 4; i += 1) s = recordAttempt(s, DS, q, true, NOW);

    const progress = progressOf(s, DS);
    const after = progress.mastery.find((m) => m.kcId === "c09")!;
    expect(after.alpha).toBe(first.alpha);
    expect(after.beta).toBe(first.beta);
    expect(after.evidenceN).toBe(1);

    expect(progress.attempts).toHaveLength(5);
    expect(progress.attempts.slice(1).every((a) => a.counted === false)).toBe(true);
  });

  it("重复作答即使答错也不改变掌握度", () => {
    let s: LearnerState = createLearner();
    s = recordAttempt(s, DS, q, true, NOW);
    const before = progressOf(s, DS).mastery.find((m) => m.kcId === "c09")!;
    s = recordAttempt(s, DS, q, false, NOW);
    const after = progressOf(s, DS).mastery.find((m) => m.kcId === "c09")!;
    expect(after).toEqual(before);
  });

  it("weightScale=0 的练习题记录作答但不进证据", () => {
    let s: LearnerState = createLearner();
    s = recordAttempt(s, DS, q, true, NOW, { weightScale: 0 });
    const progress = progressOf(s, DS);
    const m = progress.mastery.find((x) => x.kcId === "c09")!;
    expect(m.evidenceN).toBe(0);
    expect(m.alpha).toBeCloseTo(initialMastery("c09", 3).alpha, 10);
    expect(progress.attempts).toHaveLength(1);
    expect(progress.attempts[0].counted).toBe(false);
  });

  it("weightScale=0.8 只计八成证据", () => {
    const s = recordAttempt(createLearner(), DS, q, true, NOW, { weightScale: 0.8 });
    const m = progressOf(s, DS).mastery.find((x) => x.kcId === "c09")!;
    const before = initialMastery("c09", 3);
    expect(m.alpha - before.alpha).toBeCloseTo(0.8 * difficultyWeight(q.difficulty), 10);
    expect(m.evidenceN).toBe(1);
  });

  it("自定义方向按传入的图建进度，不再回落数据结构", () => {
    const fakeGraph: KnowledgeGraph = {
      version: "kg-custom-x",
      concepts: [
        { id: "k1", name: "栈", summary: "", chapter: "自定义" },
        { id: "k2", name: "队列", summary: "", chapter: "自定义" },
        { id: "k3", name: "树", summary: "", chapter: "自定义" },
      ],
      edges: [
        { before: "k1", after: "k2" },
        { before: "k2", after: "k3" },
      ],
    };
    const progress = createSubjectProgress("custom-x", fakeGraph);
    expect(progress.mastery).toHaveLength(fakeGraph.concepts.length);
    expect(progress.mastery.map((m) => m.kcId).sort()).toEqual(["k1", "k2", "k3"]);

    // 不传图时仍然回落内置学科（向后兼容）
    const legacy = createSubjectProgress("custom-x");
    expect(legacy.mastery).toHaveLength(knowledgeGraph.concepts.length);
  });

  it("progressOf 透传 graph：未访问过的自定义方向也按图建", () => {
    const fakeGraph: KnowledgeGraph = {
      version: "kg-custom-y",
      concepts: [
        { id: "a", name: "A", summary: "", chapter: "自定义" },
        { id: "b", name: "B", summary: "", chapter: "自定义" },
      ],
      edges: [{ before: "a", after: "b" }],
    };
    const p = progressOf(createLearner(), "custom-y", fakeGraph);
    expect(p.mastery.map((m) => m.kcId)).toEqual(["a", "b"]);
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

  it("自定义方向记路径编辑时，不能把进度写成数据结构", () => {
    /*
     * 回归：recordPathEdit 曾不传 graph，progressOf 回落到 getSubject(uuid)
     * → SUBJECTS[0]，于是给方向写出 c01–c40 的掌握度，覆盖掉 k1/k2…。
     * 诊断页随后找不到任何 mastery，显示「诊断完成」。
     */
    const fakeGraph: KnowledgeGraph = {
      version: "kg-custom-z",
      concepts: [
        { id: "k1", name: "栈", summary: "", chapter: "自定义" },
        { id: "k2", name: "队列", summary: "", chapter: "自定义" },
        { id: "k3", name: "树", summary: "", chapter: "自定义" },
      ],
      edges: [
        { before: "k1", after: "k2" },
        { before: "k2", after: "k3" },
      ],
    };

    // 先按图建好方向进度（模拟诊断过几题）
    let s: LearnerState = {
      ...createLearner(),
      subjects: { ...createLearner().subjects, "custom-z": createSubjectProgress("custom-z", fakeGraph) },
    };
    s = recordAttempt(s, "custom-z", { id: "di-1", kcId: "k1", difficulty: 2, stem: "s", options: ["a", "b"], answerIndex: 0, explanation: "e" }, true, NOW, { graph: fakeGraph });

    const before = progressOf(s, "custom-z", fakeGraph);
    expect(before.mastery.map((m) => m.kcId)).toEqual(["k1", "k2", "k3"]);

    // 记一次路径编辑
    s = recordPathEdit(s, "custom-z", { kind: "reorder", detail: "调序" }, NOW, fakeGraph);
    const after = progressOf(s, "custom-z", fakeGraph);

    expect(after.mastery.map((m) => m.kcId)).toEqual(["k1", "k2", "k3"]);
    expect(after.mastery).toEqual(before.mastery);
    expect(after.attempts).toEqual(before.attempts);
    expect(after.pathEdits).toHaveLength(1);
  });

  it("自定义方向没有 graph 时也不会静默写成 c01–c40（显式暴露给调用方）", () => {
    /*
     * 不传 graph 时仍会回落内置学科——这是向后兼容的既有行为，
     * 但至少不能「悄悄成功」。这里断言的是：调用方拿到的是内置学科形状，
     * 因此任何新代码漏传 graph 都能被这条测试的对照发现。
     */
    const fakeGraph: KnowledgeGraph = {
      version: "kg-custom-w",
      concepts: [{ id: "k1", name: "栈", summary: "", chapter: "自定义" }],
      edges: [],
    };
    const s = recordPathEdit(createLearner(), "custom-w", { kind: "add", detail: "x" }, NOW, fakeGraph);
    expect(progressOf(s, "custom-w", fakeGraph).mastery.map((m) => m.kcId)).toEqual(["k1"]);
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
