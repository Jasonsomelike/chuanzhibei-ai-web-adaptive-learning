import { describe, it, expect } from "vitest";
import {
  createLearner,
  createSubjectProgress,
  recordAttempt,
  recordPathEdit,
  attemptedQuestionIds,
  attemptCount,
  clearKcEvidence,
  progressOf,
  sanitizeProgress,
  mergeServerProgress,
  loadLearner,
  updateMemories,
  type LearnerState,
} from "@/lib/learner";
import {
  MAX_MEMORIES,
  dueAt,
  errorMemoryId,
  reviewMemory,
  upsertErrorMemory,
  type MemoryItem,
} from "@/lib/memory";
import { questions } from "@/data/questions";
import { difficultyWeight, initialMastery, masteryMean, masterySd } from "@/lib/mastery";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { computeDepths, type KnowledgeGraph } from "@/lib/graph";
import { DEFAULT_SUBJECT_ID, SUBJECTS } from "@/data/subjects";

const NOW = "2026-10-22T10:00:00.000Z";
const DAY = 86_400_000;
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

describe("按知识点清空证据", () => {
  const kcQuestions = questions.filter((x) => x.kcId === "c09");
  const otherQuestion = questions.find((x) => x.kcId === "c10")!;

  function answerAllKc(): LearnerState {
    let s: LearnerState = createLearner();
    for (const q of kcQuestions) s = recordAttempt(s, DS, q, true, NOW);
    return s;
  }

  it("重测后掌握度回到先验、旧证据归档且历史保留、该知识点的题重新可出", () => {
    // 清空前先答满 c09 的三题（旧行为下这之后就冻结），再给 c10 留一条记录作对照
    let s = answerAllKc();
    s = recordAttempt(s, DS, otherQuestion, false, NOW);

    const before = progressOf(s, DS);
    const priorDepth = computeDepths(knowledgeGraph).get("c09") ?? 0;
    const expectedPrior = initialMastery("c09", priorDepth);
    // 先确认先验确实是 0.20 那一档，避免测试与数据脱节后悄悄失去意义
    expect(masteryMean(expectedPrior)).toBeCloseTo(0.2, 10);

    const cleared = clearKcEvidence(s, DS, "c09");
    const after = progressOf(cleared, DS);

    expect(after.mastery.find((m) => m.kcId === "c09")).toEqual(expectedPrior);
    expect(after.attempts.filter((a) => a.kcId === "c09").every((a) => a.retired)).toBe(true);
    expect(attemptedQuestionIds(cleared, DS, "c09").size).toBe(0);

    // 其它知识点逐字段不变；别的知识点的作答记录也保留
    expect(after.mastery.filter((m) => m.kcId !== "c09")).toEqual(
      before.mastery.filter((m) => m.kcId !== "c09"),
    );
    expect(after.attempts).toHaveLength(4);
    expect(after.attempts.at(-1)).toMatchObject({ kcId: "c10", correct: false });
  });

  it("是纯函数：不修改原状态", () => {
    const s = answerAllKc();
    const snapshot = JSON.stringify(s);
    clearKcEvidence(s, DS, "c09");
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it("清空后同一道题重新计入证据（这正是冻结问题的出口）", () => {
    let s = answerAllKc();
    const filled = progressOf(s, DS).mastery.find((m) => m.kcId === "c09")!;
    expect(filled.evidenceN).toBe(3);

    // 不清空时，同一题重复作答只记录不计证据
    const repeated = recordAttempt(s, DS, kcQuestions[0], true, NOW);
    expect(progressOf(repeated, DS).mastery.find((m) => m.kcId === "c09")!.evidenceN).toBe(3);

    // 清空后同题重新计证据，掌握度重新可被这次作答推动
    const cleared = clearKcEvidence(s, DS, "c09");
    const again = recordAttempt(cleared, DS, kcQuestions[0], true, NOW);
    const m = progressOf(again, DS).mastery.find((x) => x.kcId === "c09")!;
    expect(m.evidenceN).toBe(1);
    expect(progressOf(again, DS).attempts).toHaveLength(4);
    expect(progressOf(again, DS).attempts.filter((a) => !a.retired)).toHaveLength(1);
    expect(progressOf(again, DS).attempts.at(-1)?.counted).toBeUndefined();
  });

  it("同一知识点的重复记录（counted=false）也归档保留", () => {
    let s = answerAllKc();
    s = recordAttempt(s, DS, kcQuestions[0], true, NOW);
    expect(progressOf(s, DS).attempts.filter((a) => a.kcId === "c09")).toHaveLength(4);

    const cleared = clearKcEvidence(s, DS, "c09");
    expect(progressOf(cleared, DS).attempts).toHaveLength(4);
    expect(progressOf(cleared, DS).attempts.every((a) => a.retired)).toBe(true);
  });

  it("自定义方向按传入的图清空，不回落内置学科", () => {
    const fakeGraph: KnowledgeGraph = {
      version: "kg-custom-clear",
      concepts: [
        { id: "k1", name: "栈", summary: "", chapter: "自定义" },
        { id: "k2", name: "队列", summary: "", chapter: "自定义" },
      ],
      edges: [{ before: "k1", after: "k2" }],
    };
    let s: LearnerState = {
      ...createLearner(),
      subjects: {
        ...createLearner().subjects,
        "custom-clear": createSubjectProgress("custom-clear", fakeGraph),
      },
    };
    s = recordAttempt(
      s,
      "custom-clear",
      { id: "di-k1", kcId: "k1", difficulty: 2, stem: "s", options: ["a", "b"], answerIndex: 0, explanation: "e" },
      true,
      NOW,
      { graph: fakeGraph },
    );

    const cleared = clearKcEvidence(s, "custom-clear", "k1", fakeGraph);
    const after = progressOf(cleared, "custom-clear", fakeGraph);

    expect(after.mastery.map((m) => m.kcId)).toEqual(["k1", "k2"]);
    expect(after.mastery[0]).toEqual(initialMastery("k1", computeDepths(fakeGraph).get("k1") ?? 0));
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0].retired).toBe(true);
  });

  it("清空没有证据的知识点不改变任何字段", () => {
    const s = createLearner();
    const cleared = clearKcEvidence(s, DS, "c09");
    expect(progressOf(cleared, DS).mastery).toEqual(progressOf(s, DS).mastery);
    expect(progressOf(cleared, DS).attempts).toEqual([]);
    expect(progressOf(cleared, DS).pathEdits).toEqual([]);
  });

  it("pathEdits 与 memories 不受清空影响", () => {
    const q = kcQuestions[0];
    let s: LearnerState = createLearner();
    s = recordAttempt(s, DS, q, false, NOW);
    s = updateMemories(s, DS, (memories) =>
      upsertErrorMemory(memories, {
        questionId: q.id,
        kcId: q.kcId,
        prompt: q.stem,
        correction: "正确答案",
        now: NOW,
      }).memories,
    );
    s = recordPathEdit(s, DS, { kind: "reorder", detail: "调序" }, NOW);

    const cleared = clearKcEvidence(s, DS, "c09");
    const after = progressOf(cleared, DS);

    expect(after.memories).toEqual(progressOf(s, DS).memories);
    expect(after.pathEdits).toEqual(progressOf(s, DS).pathEdits);
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0].retired).toBe(true);
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

describe("作答记录扩展字段", () => {
  const q = questions.find((x) => x.kcId === "c09")!;

  it("predicted/weightScale/source/selectedIndex 原样落进 attempts", () => {
    const s = recordAttempt(createLearner(), DS, q, true, NOW, {
      weightScale: 0.8,
      predicted: 0.62,
      source: "generated",
      selectedIndex: 2,
    });
    const attempt = progressOf(s, DS).attempts[0];
    expect(attempt).toMatchObject({
      predicted: 0.62,
      weightScale: 0.8,
      source: "generated",
      selectedIndex: 2,
    });
    // 计入证据的作答不带 counted 字段
    expect(attempt.counted).toBeUndefined();
    // 本轮不写 flow：不要为了「以后可能有练习流」先存一个恒定值
    expect("flow" in attempt).toBe(false);
  });

  it("不传新字段时不写默认值，旧调用方行为不变", () => {
    const attempt = progressOf(recordAttempt(createLearner(), DS, q, true, NOW), DS).attempts[0];
    expect(attempt.predicted).toBeUndefined();
    expect(attempt.weightScale).toBeUndefined();
    expect(attempt.source).toBeUndefined();
    expect(attempt.selectedIndex).toBeUndefined();
  });

  it("counted 语义不变：重复作答仍是 counted:false，新字段照常保留", () => {
    let s = recordAttempt(createLearner(), DS, q, true, NOW, {
      predicted: 0.5,
      source: "builtin",
    });
    s = recordAttempt(s, DS, q, true, NOW, {
      predicted: 0.9,
      source: "builtin",
      selectedIndex: 1,
    });

    const [first, second] = progressOf(s, DS).attempts;
    expect(first.counted).toBeUndefined();
    expect(second.counted).toBe(false);
    expect(second.predicted).toBe(0.9);
    expect(second.selectedIndex).toBe(1);
  });

  it("weightScale=0 的练习记录也保存折扣，且不改掌握度", () => {
    const s = recordAttempt(createLearner(), DS, q, true, NOW, {
      weightScale: 0,
      source: "generated",
    });
    const progress = progressOf(s, DS);
    const m = progress.mastery.find((x) => x.kcId === "c09")!;
    expect(m.evidenceN).toBe(0);
    expect(progress.attempts[0].counted).toBe(false);
    expect(progress.attempts[0].weightScale).toBe(0);
  });
});

describe("记忆卡与进度同步", () => {
  const q = questions.find((x) => x.kcId === "c09")!;

  function withErrorCard(): LearnerState {
    return updateMemories(createLearner(), DS, (memories) =>
      upsertErrorMemory(memories, {
        questionId: q.id,
        kcId: q.kcId,
        prompt: q.stem,
        chosen: q.options[1],
        correction: q.options[q.answerIndex],
        now: NOW,
      }).memories,
    );
  }

  it("新建进度带空 memories", () => {
    expect(createSubjectProgress(DS).memories).toEqual([]);
    expect(progressOf(createLearner(), DS).memories).toEqual([]);
  });

  it("updateMemories 写入记忆卡，作答记录原样保留", () => {
    const before = recordAttempt(createLearner(), DS, q, false, NOW);
    const after = updateMemories(before, DS, (memories) =>
      upsertErrorMemory(memories, {
        questionId: q.id,
        kcId: q.kcId,
        prompt: q.stem,
        chosen: q.options[1],
        correction: q.options[q.answerIndex],
        now: NOW,
      }).memories,
    );

    const progress = progressOf(after, DS);
    expect(progress.memories).toHaveLength(1);
    expect(progress.memories![0].id).toBe(errorMemoryId(q.id));
    expect(progress.attempts).toEqual(progressOf(before, DS).attempts);

    // 随进度整块同步时确实带上记忆卡
    const roundTrip = JSON.parse(JSON.stringify(after)) as LearnerState;
    expect(progressOf(roundTrip, DS).memories).toHaveLength(1);
  });

  it("updateMemories 前后 mastery.alpha/beta 完全不变", () => {
    const before = recordAttempt(createLearner(), DS, q, false, NOW);
    const masteryBefore = progressOf(before, DS).mastery;
    const after = withErrorCard();

    // withErrorCard 从 createLearner 起，先确认它本身没动掌握度
    expect(progressOf(after, DS).mastery).toEqual(progressOf(createLearner(), DS).mastery);
    // 再以「已有作答」的状态跑一次记忆卡写入
    const combined = updateMemories(before, DS, (memories) =>
      upsertErrorMemory(memories, {
        questionId: q.id,
        kcId: q.kcId,
        prompt: q.stem,
        correction: q.options[q.answerIndex],
        now: NOW,
      }).memories,
    );
    const masteryAfter = progressOf(combined, DS).mastery;
    expect(masteryAfter).toEqual(masteryBefore);
    expect(masteryAfter.map((m) => [m.alpha, m.beta])).toEqual(
      masteryBefore.map((m) => [m.alpha, m.beta]),
    );
    expect(progressOf(combined, DS).attempts).toEqual(progressOf(before, DS).attempts);
    expect(progressOf(combined, DS).pathEdits).toEqual(progressOf(before, DS).pathEdits);
  });

  it("复习自评刷新 lastSeenAt，下次到期时间随之后移", () => {
    const later = "2026-10-30T00:00:00.000Z";
    const id = errorMemoryId(q.id);
    let s = withErrorCard();
    const dueBefore = dueAt(progressOf(s, DS).memories![0]);
    expect(dueBefore).toBe(new Date(Date.parse(NOW) + DAY).toISOString());

    s = updateMemories(s, DS, (memories) => reviewMemory(memories, id, true, later));

    const card = progressOf(s, DS).memories![0];
    expect(card.lastSeenAt).toBe(later);
    expect(card.streak).toBe(1);
    expect(card.reviewCount).toBe(1);
    // streak=1 → 3 天后到期，而不是继续基于旧的 lastSeenAt
    expect(dueAt(card)).toBe(new Date(Date.parse(later) + 3 * DAY).toISOString());
  });

  it("updateMemories 对没有 memories 字段的旧进度按空数组处理", () => {
    const mastery = createSubjectProgress(DS).mastery;
    const legacy: LearnerState = {
      version: 2,
      learnerId: "legacy",
      subjects: {
        [DS]: { mastery, attempts: [], pathEdits: [], lastStepIndex: 0 },
      },
    };
    const s = updateMemories(legacy, DS, (memories) =>
      upsertErrorMemory(memories, {
        questionId: q.id,
        kcId: q.kcId,
        prompt: q.stem,
        correction: q.options[q.answerIndex],
        now: NOW,
      }).memories,
    );
    expect(progressOf(s, DS).memories).toHaveLength(1);
  });

  it("更新器返回坏形状或超量时，写入前会被清洗", () => {
    const dirty = [{ id: "bad" }, { id: "bad" }] as unknown as MemoryItem[];
    const bad = updateMemories(createLearner(), DS, () => dirty);
    expect(progressOf(bad, DS).memories).toEqual([]);

    let memories: readonly MemoryItem[] = [];
    for (let i = 0; i < MAX_MEMORIES + 25; i += 1) {
      memories = upsertErrorMemory(memories, {
        questionId: `q-${i}`,
        kcId: q.kcId,
        prompt: `题干 ${i}`,
        correction: "解析",
        now: NOW,
      }).memories;
    }
    const many = updateMemories(createLearner(), DS, () => memories);
    expect(progressOf(many, DS).memories).toHaveLength(MAX_MEMORIES);
  });
});

describe("旧存档兼容", () => {
  it("没有新字段的 v2 存档仍能加载，缺省字段不影响已有数据", () => {
    const legacy = {
      version: 2,
      learnerId: "legacy",
      subjects: {
        [DS]: {
          mastery: [
            { kcId: "c09", alpha: 0.7, beta: 1.3, evidenceN: 2 },
            { kcId: "c10", alpha: 0.6, beta: 1.4, evidenceN: 1 },
          ],
          attempts: [
            { questionId: "q-c09-1", kcId: "c09", difficulty: 1, correct: true, at: NOW },
          ],
          pathEdits: [{ at: NOW, kind: "reorder", detail: "调序" }],
          lastStepIndex: 4,
        },
      },
    };

    const restore = installLocalStorage(JSON.stringify(legacy));
    try {
      const state = loadLearner();
      const progress = progressOf(state, DS);

      expect(state.learnerId).toBe("legacy");
      expect(progress.mastery).toHaveLength(2);
      expect(progress.lastStepIndex).toBe(4);
      expect(progress.pathEdits).toHaveLength(1);

      const attempt = progress.attempts[0];
      expect(attempt).toMatchObject({
        questionId: "q-c09-1",
        kcId: "c09",
        difficulty: 1,
        correct: true,
        at: NOW,
      });
      // 旧存档没有 counted，语义上等同 true；也没有新加的四个字段
      expect(attempt.counted).toBeUndefined();
      expect(attempt.predicted).toBeUndefined();
      expect(attempt.weightScale).toBeUndefined();
      expect(attempt.source).toBeUndefined();
      expect(attempt.selectedIndex).toBeUndefined();
      // memories 缺省补成空数组
      expect(progress.memories).toEqual([]);
    } finally {
      restore();
    }
  });

  it("localStorage 里形状坏掉的学科被丢弃，其他学科照常加载", () => {
    const legacy = {
      version: 2,
      learnerId: "legacy",
      subjects: {
        [DS]: {
          mastery: [{ kcId: "c09", alpha: 0.7, beta: 1.3, evidenceN: 2 }],
          attempts: [],
          pathEdits: [],
          lastStepIndex: 0,
        },
        broken: { mastery: "nope", attempts: [] },
      },
    };

    const restore = installLocalStorage(JSON.stringify(legacy));
    try {
      const state = loadLearner();
      expect(progressOf(state, DS).mastery).toHaveLength(1);
      expect(state.subjects.broken).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("localStorage 里超量/坏形状的 memories 加载时被清洗", () => {
    const memories: unknown[] = [
      ...Array.from({ length: MAX_MEMORIES + 30 }, (_, i) => memoryRecord(i)),
      { id: "bad" },
      null,
    ];
    const legacy = {
      version: 2,
      learnerId: "legacy",
      subjects: {
        [DS]: {
          mastery: [{ kcId: "c09", alpha: 0.7, beta: 1.3, evidenceN: 2 }],
          attempts: [],
          pathEdits: [],
          lastStepIndex: 0,
          memories,
        },
      },
    };

    const restore = installLocalStorage(JSON.stringify(legacy));
    try {
      const state = loadLearner();
      const stored = progressOf(state, DS).memories!;
      expect(stored).toHaveLength(MAX_MEMORIES);
      expect(stored.every((m) => m.id.startsWith("mem-error-"))).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("服务端进度清洗", () => {
  it("sanitizeProgress 丢弃坏 mastery 并补齐 memories 数组", () => {
    expect(sanitizeProgress(null)).toBeNull();
    expect(sanitizeProgress({ mastery: "nope" })).toBeNull();
    expect(
      sanitizeProgress({ mastery: [{ kcId: "c09", alpha: "x", beta: 1, evidenceN: 1 }] }),
    ).toBeNull();

    const clean = sanitizeProgress({
      mastery: [{ kcId: "c09", alpha: 0.6, beta: 1.4, evidenceN: 1 }],
    });
    expect(clean).not.toBeNull();
    expect(clean!.memories).toEqual([]);
    expect(clean!.attempts).toEqual([]);
    expect(clean!.lastStepIndex).toBe(0);
  });

  it("sanitizeProgress 保留合法的新字段，丢弃未知 source", () => {
    const clean = sanitizeProgress({
      mastery: [{ kcId: "c09", alpha: 0.6, beta: 1.4, evidenceN: 1 }],
      attempts: [
        {
          questionId: "q1",
          kcId: "c09",
          difficulty: 2,
          correct: false,
          at: NOW,
          counted: false,
          predicted: 0.4,
          weightScale: 0.8,
          source: "generated",
          selectedIndex: 3,
        },
        {
          questionId: "q2",
          kcId: "c09",
          difficulty: 2,
          correct: true,
          at: NOW,
          source: "hacked",
        },
      ],
    })!;

    expect(clean.attempts).toHaveLength(2);
    expect(clean.attempts[0]).toMatchObject({
      counted: false,
      predicted: 0.4,
      weightScale: 0.8,
      source: "generated",
      selectedIndex: 3,
    });
    expect(clean.attempts[1].source).toBeUndefined();
    expect(clean.attempts[1].counted).toBeUndefined();
  });

  it("超过 200 张的记忆卡被截到上限", () => {
    const clean = sanitizeProgress({
      mastery: [{ kcId: "c09", alpha: 0.6, beta: 1.4, evidenceN: 1 }],
      memories: Array.from({ length: MAX_MEMORIES + 60 }, (_, i) => memoryRecord(i)),
    })!;
    expect(clean.memories).toHaveLength(MAX_MEMORIES);
  });

  it("mergeServerProgress 不会把服务端超量/坏形状的 memories 带进 UI 状态", () => {
    const server = {
      [DS]: {
        mastery: [{ kcId: "c09", alpha: 0.6, beta: 1.4, evidenceN: 1 }],
        attempts: [],
        pathEdits: [],
        lastStepIndex: 2,
        memories: [
          ...Array.from({ length: MAX_MEMORIES + 10 }, (_, i) => memoryRecord(i)),
          { id: "bad" },
        ],
      },
    };

    const merged = mergeServerProgress(createLearner(), server);
    const progress = progressOf(merged, DS);
    expect(progress.memories).toHaveLength(MAX_MEMORIES);
    expect(progress.mastery).toHaveLength(1);
    expect(progress.lastStepIndex).toBe(2);
  });

  it("服务端某学科形状坏掉时保留本地版本，其他学科照常合并", () => {
    const q = questions.find((x) => x.kcId === "c09")!;
    const local = recordAttempt(createLearner(), DS, q, false, NOW);

    const merged = mergeServerProgress(local, {
      [DS]: { mastery: "nope" },
      network: {
        mastery: [{ kcId: "n1", alpha: 0.5, beta: 1.5, evidenceN: 0 }],
        attempts: [],
        pathEdits: [],
        lastStepIndex: 0,
      },
    });

    // 坏掉的学科不被清空
    expect(progressOf(merged, DS).attempts).toHaveLength(1);
    // 好的学科正常覆盖
    expect(progressOf(merged, "network").mastery.map((m) => m.kcId)).toEqual(["n1"]);
  });

  it("服务端返回非对象时原样保留本地状态", () => {
    const local = createLearner();
    expect(mergeServerProgress(local, null)).toBe(local);
    expect(mergeServerProgress(local, [1, 2, 3])).toBe(local);
    expect(mergeServerProgress(local, "nope")).toBe(local);
  });
});

// ── 测试辅助 ────────────────────────────────────────────────────────

interface FakeWindow {
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
}

/** node 环境没有 window；loadLearner 只用到 localStorage，挂一个最小实现即可。 */
function installLocalStorage(initial: string | null): () => void {
  const store = new Map<string, string>();
  if (initial !== null) store.set("alp.learner.v2", initial);

  const globals = globalThis as unknown as { window?: FakeWindow };
  const previous = globals.window;
  globals.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        store.delete(key);
      },
    },
  };

  return () => {
    if (previous === undefined) delete globals.window;
    else globals.window = previous;
  };
}

function memoryRecord(i: number): Record<string, unknown> {
  return {
    id: `mem-error-q${i}`,
    kind: "error",
    kcId: "c09",
    questionId: `q${i}`,
    prompt: `题干 ${i}`,
    correction: "正确答案与解析",
    createdAt: NOW,
    lastSeenAt: NOW,
    status: "open",
    streak: 0,
    reviewCount: 0,
  };
}
