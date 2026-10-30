import { describe, expect, it } from "vitest";

import {
  RUBRIC_DIMENSIONS,
  TUTOR_EVAL_CASES,
  buildJudgePrompt,
  deterministicAnswerFor,
  evaluateHardGates,
  judgeAnswerByRules,
  judgementsFromLlm,
  validateLlmJudge,
  type CaseJudgement,
  type RubricId,
  type TutorEvalCase,
} from "@/lib/tutorEval";

function caseById(id: string): TutorEvalCase {
  const found = TUTOR_EVAL_CASES.find((testCase) => testCase.id === id);
  if (found === undefined) throw new Error(`没有 ${id}`);
  return found;
}

function scoreOf(judgement: CaseJudgement, id: RubricId): number {
  return judgement.scores.find((entry) => entry.id === id)?.score ?? -1;
}

function totalOf(judgement: CaseJudgement): number {
  return judgement.scores.reduce((sum, entry) => sum + entry.score, 0);
}

const GOOD_ANSWER = [
  "结论：栈是后进先出，队列是先进先出。",
  "解释：插入和删除的位置不同，所以出栈与出队顺序相反。",
  "例子：把 1、2、3 依次压栈，弹出顺序是 3、2、1；入队则仍是 1、2、3。",
  "下一步：打开教材第 3 章做 2 道入栈出栈题，写出每一步的栈顶。",
].join("\n");

const BAD_ANSWER =
  "首先，这个问题很复杂。总的来说，你要多练习。栈和队列都是线性表，区别很大。最后，祝你学习进步。";

describe("评测集", () => {
  it("10 条中文问题，id 唯一，场景覆盖教材 / 摘要 / 资料没有 / 两说 / 上传 / 网络", () => {
    expect(TUTOR_EVAL_CASES).toHaveLength(10);
    expect(new Set(TUTOR_EVAL_CASES.map((item) => item.id)).size).toBe(10);
    for (const testCase of TUTOR_EVAL_CASES) {
      expect(testCase.question).toMatch(/[\u4e00-\u9fa5]/);
      expect(testCase.question.trim()).not.toBe("");
    }
    const kinds = new Set(TUTOR_EVAL_CASES.map((item) => item.kind));
    expect([...kinds].sort()).toEqual([
      "answer-absent",
      "conflict",
      "grounded",
      "knowledge-only",
      "upload-only",
      "web-only",
    ]);
  });

  it("8 个维度，硬门只有 R1≥1、R5=2、R7=2", () => {
    expect(RUBRIC_DIMENSIONS.map((item) => item.id)).toEqual([
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "R6",
      "R7",
      "R8",
    ]);
    const gates = RUBRIC_DIMENSIONS.filter((item) => item.gate !== null);
    expect(gates.map((item) => [item.id, item.gate, item.op])).toEqual([
      ["R1", 1, ">="],
      ["R5", 2, "="],
      ["R7", 2, "="],
    ]);
  });
});

describe("规则评分能区分好 / 坏样例", () => {
  it("好样例：结构齐、结论先、例子具体、无禁语，硬门全过", () => {
    const good = judgeAnswerByRules({ case: caseById("t01"), answer: GOOD_ANSWER });
    expect(good.scores.map((entry) => entry.score)).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    expect(evaluateHardGates([good]).every((gate) => gate.passed)).toBe(true);
  });

  it("坏样例：没有结构、没有例子、命中禁语，三个硬门全挂", () => {
    const bad = judgeAnswerByRules({ case: caseById("t02"), answer: BAD_ANSWER });
    expect(scoreOf(bad, "R1")).toBe(0);
    expect(scoreOf(bad, "R5")).toBe(0);
    expect(scoreOf(bad, "R7")).toBe(0);
    const gates = evaluateHardGates([bad]);
    expect(gates.map((gate) => gate.passed)).toEqual([false, false, false]);

    const good = judgeAnswerByRules({ case: caseById("t01"), answer: GOOD_ANSWER });
    expect(totalOf(good)).toBeGreaterThan(totalOf(bad) + 8);
  });

  it("声明落在结论之后：R4 只给 1 分，不按通过处理", () => {
    const answer = [
      "结论：先学栈是因为路径按先修关系排。",
      "解释：栈是队列的先修。",
      "例子：「栈是后进先出的线性表」。",
      "下一步：看第 3 章第 1 节。",
      "以下内容不是来自你的教材，只是课程知识点摘要。",
    ].join("\n");
    const judgement = judgeAnswerByRules({ case: caseById("t02"), answer });
    expect(scoreOf(judgement, "R4")).toBe(1);
    // 声明句本身写对了，R8 仍然给 2：位置与内容是两件事。
    expect(scoreOf(judgement, "R8")).toBe(2);
  });

  it("结论长度边界：≤40 给 2，41–60 给 1，更长给 0", () => {
    const body = [
      "解释：乙。",
      "例子：「丙丁戊己」。",
      "下一步：做第 1 题。",
    ];
    const at40 = judgeAnswerByRules({
      case: caseById("t01"),
      answer: `结论：${"甲".repeat(39)}。\n${body.join("\n")}`,
    });
    expect(scoreOf(at40, "R3")).toBe(2);

    const at60 = judgeAnswerByRules({
      case: caseById("t01"),
      answer: `结论：${"甲".repeat(45)}。\n${body.join("\n")}`,
    });
    expect(scoreOf(at60, "R3")).toBe(1);

    const over60 = judgeAnswerByRules({
      case: caseById("t01"),
      answer: `结论：${"甲".repeat(61)}。\n${body.join("\n")}`,
    });
    expect(scoreOf(over60, "R3")).toBe(0);
  });
});

describe("默认答案（无模型拼装）", () => {
  it("10 条逐条过硬门", () => {
    const judgements = TUTOR_EVAL_CASES.map((testCase) =>
      judgeAnswerByRules({ case: testCase, answer: deterministicAnswerFor(testCase) }),
    );
    const gates = evaluateHardGates(judgements);
    expect(gates.map((gate) => [gate.id, gate.passed])).toEqual([
      ["R1", true],
      ["R5", true],
      ["R7", true],
    ]);
    for (const judgement of judgements) {
      expect(scoreOf(judgement, "R7")).toBe(2);
      expect(scoreOf(judgement, "R1")).toBeGreaterThanOrEqual(1);
    }
  });

  it("两说并存场景把分歧写进解释，并保留两边出处", () => {
    const answer = deterministicAnswerFor(caseById("t05"));
    expect(answer).toContain("两说并存");
    expect((answer.match(/称「/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(judgeAnswerByRules({ case: caseById("t05"), answer }).scores.find((entry) => entry.id === "R8")?.score).toBe(2);
  });
});

describe("LLM judge 的 quote 校验", () => {
  const answers = new Map([["t01", "结论：甲。\n例子：「乙丙丁戊」。"]]);

  const scores = '{"R1":2,"R2":2,"R3":2,"R4":2,"R5":2,"R6":2,"R7":2,"R8":2}';

  it("quote 是答案子串时接受，代码块包裹也能解析", () => {
    const raw = [
      "```json",
      `[{"id":"t01","quote":"结论：甲。","scores":${scores},"reason":"结构齐"}]`,
      "```",
    ].join("\n");
    const result = validateLlmJudge(raw, answers);
    expect(result.rejected).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.scores.R1).toBe(2);
  });

  it("quote 不是答案子串时整条作废", () => {
    const raw = `[{"id":"t01","quote":"这不是答案里的话","scores":${scores},"reason":"x"}]`;
    const result = validateLlmJudge(raw, answers);
    expect(result.items).toEqual([]);
    expect(result.rejected.map((item) => item.id)).toEqual(["t01"]);
    expect(result.rejected[0]?.reason).toContain("quote 不是答案子串");
  });

  it("漏条、重复、非法分数与非法 JSON 都不放行", () => {
    expect(
      validateLlmJudge("[]", new Map([["t01", "甲"], ["t02", "乙"]])).rejected.map(
        (item) => item.id,
      ),
    ).toEqual(["t01", "t02"]);

    expect(
      validateLlmJudge(
        `[{"id":"t01","quote":"甲","scores":${scores}},{"id":"t01","quote":"甲","scores":${scores}}]`,
        new Map([["t01", "甲"]]),
      ).rejected.some((item) => item.reason === "重复评分"),
    ).toBe(true);

    expect(
      validateLlmJudge(
        '[{"id":"t01","quote":"甲","scores":{"R1":3,"R2":2,"R3":2,"R4":2,"R5":2,"R6":2,"R7":2,"R8":2}}]',
        new Map([["t01", "甲"]]),
      ).rejected[0]?.reason,
    ).toContain("R1 不是 0/1/2");

    expect(validateLlmJudge("not json", new Map([["t01", "甲"]])).rejected[0]?.id).toBe("*");
  });

  it("judge 提示词带全部条目与 quote 要求", () => {
    const prompt = buildJudgePrompt(
      TUTOR_EVAL_CASES.map((testCase) => ({
        id: testCase.id,
        question: testCase.question,
        answer: deterministicAnswerFor(testCase),
      })),
    );
    for (const testCase of TUTOR_EVAL_CASES) expect(prompt).toContain(testCase.id);
    expect(prompt).toContain("quote");
    expect(prompt).toContain("逐字");
  });

  it("judge 漏掉的条目按 0 分参与硬门，不会被静默跳过", () => {
    const judgements = judgementsFromLlm(TUTOR_EVAL_CASES, {
      items: [],
      rejected: [],
    });
    expect(judgements).toHaveLength(10);
    const gate = evaluateHardGates(judgements).find((item) => item.id === "R5");
    expect(gate?.passed).toBe(false);
    expect(gate?.failedCaseIds).toHaveLength(10);
  });
});
