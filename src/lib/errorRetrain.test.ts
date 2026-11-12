import { describe, expect, it } from "vitest";

import type { AttemptRecord } from "@/lib/learner";
import { historicalWrongQuestionIds, lastWrongQuestionIds, summarizeErrorsByKc } from "@/lib/errorRetrain";

function attempt(
  partial: Pick<AttemptRecord, "questionId" | "kcId" | "correct"> &
    Partial<Pick<AttemptRecord, "at" | "counted" | "difficulty">>,
): AttemptRecord {
  return {
    difficulty: 2,
    at: "2026-10-28T00:00:00.000Z",
    ...partial,
  };
}

describe("lastWrongQuestionIds", () => {
  it("最近一次答错才入选；答错后答对的题自动退出", () => {
    const ids = lastWrongQuestionIds([
      attempt({ questionId: "q1", kcId: "k1", correct: false }),
      attempt({ questionId: "q1", kcId: "k1", correct: true }),
      attempt({ questionId: "q2", kcId: "k1", correct: true }),
      attempt({ questionId: "q2", kcId: "k1", correct: false }),
      attempt({ questionId: "q3", kcId: "k2", correct: false }),
    ]);
    expect(ids).toEqual(["q2", "q3"]);
  });

  it("仅练习题（counted=false）不入选，即使最近一次是错的", () => {
    const ids = lastWrongQuestionIds([
      attempt({ questionId: "q1", kcId: "k1", correct: false, counted: false }),
    ]);
    expect(ids).toEqual([]);
  });

  it("空记录返回空队列", () => {
    expect(lastWrongQuestionIds([])).toEqual([]);
  });

  it("按首次答错先后排列并去重", () => {
    const ids = lastWrongQuestionIds([
      attempt({ questionId: "qa", kcId: "k1", correct: false, at: "2026-10-27T00:00:00.000Z" }),
      attempt({ questionId: "qb", kcId: "k1", correct: false, at: "2026-10-28T00:00:00.000Z" }),
      attempt({ questionId: "qa", kcId: "k1", correct: false, at: "2026-10-29T00:00:00.000Z" }),
    ]);
    expect(ids).toEqual(["qa", "qb"]);
  });
});

describe("historicalWrongQuestionIds", () => {
  it("答错后答对毕业的题也入选（复习总结不随毕业消失）", () => {
    const ids = historicalWrongQuestionIds([
      attempt({ questionId: "q1", kcId: "k1", correct: false }),
      attempt({ questionId: "q1", kcId: "k1", correct: true }),
      attempt({ questionId: "q2", kcId: "k1", correct: true }),
      attempt({ questionId: "q3", kcId: "k2", correct: false }),
    ]);
    expect(ids).toEqual(["q1", "q3"]);
  });

  it("仅练习题（counted=false）不算历史错题", () => {
    const ids = historicalWrongQuestionIds([
      attempt({ questionId: "q1", kcId: "k1", correct: false, counted: false }),
    ]);
    expect(ids).toEqual([]);
  });

  it("空记录返回空数组", () => {
    expect(historicalWrongQuestionIds([])).toEqual([]);
  });
});

describe("summarizeErrorsByKc", () => {
  it("按知识点汇总错题数与总作答数", () => {
    const rows = summarizeErrorsByKc([
      attempt({ questionId: "q1", kcId: "k1", correct: false }),
      attempt({ questionId: "q2", kcId: "k1", correct: true }),
      attempt({ questionId: "q3", kcId: "k1", correct: false }),
      attempt({ questionId: "q4", kcId: "k2", correct: false }),
    ]);
    expect(rows).toHaveLength(2);
    const k1 = rows.find((r) => r.kcId === "k1")!;
    expect(k1.wrongCount).toBe(2);
    expect(k1.totalCount).toBe(3);
  });

  it("recentWrongStreak 被一次答对截断", () => {
    const rows = summarizeErrorsByKc([
      attempt({ questionId: "q1", kcId: "k1", correct: false }),
      attempt({ questionId: "q2", kcId: "k1", correct: false }),
      attempt({ questionId: "q3", kcId: "k1", correct: true }),
      attempt({ questionId: "q4", kcId: "k1", correct: false }),
    ]);
    expect(rows[0].wrongCount).toBe(3);
    expect(rows[0].recentWrongStreak).toBe(1);
  });

  it("lastWrongAt 记录最近一次答错时间", () => {
    const rows = summarizeErrorsByKc([
      attempt({ questionId: "q1", kcId: "k1", correct: false, at: "2026-10-27T00:00:00.000Z" }),
      attempt({ questionId: "q2", kcId: "k1", correct: false, at: "2026-10-29T00:00:00.000Z" }),
    ]);
    expect(rows[0].lastWrongAt).toBe("2026-10-29T00:00:00.000Z");
  });

  it("仅练习题不进入汇总", () => {
    const rows = summarizeErrorsByKc([
      attempt({ questionId: "q1", kcId: "k1", correct: false, counted: false }),
    ]);
    expect(rows).toEqual([]);
  });

  it("错得多的知识点排在前面", () => {
    const rows = summarizeErrorsByKc([
      attempt({ questionId: "q1", kcId: "ka", correct: false }),
      attempt({ questionId: "q2", kcId: "kb", correct: false }),
      attempt({ questionId: "q3", kcId: "kb", correct: false }),
    ]);
    expect(rows.map((r) => r.kcId)).toEqual(["kb", "ka"]);
  });

  it("全对时返回空数组", () => {
    const rows = summarizeErrorsByKc([
      attempt({ questionId: "q1", kcId: "k1", correct: true }),
    ]);
    expect(rows).toEqual([]);
  });
});
