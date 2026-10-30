import { describe, expect, it } from "vitest";

import type { Question } from "@/data/questions";
import type { AttemptRecord } from "@/lib/learner";
import { buildErrorSummaryMarkdown, errorSummaryFileName } from "@/lib/errorSummaryMd";

const NOW = "2026-10-29T08:00:00.000Z";

function question(partial: Pick<Question, "id" | "kcId" | "stem"> & Partial<Question>): Question {
  return {
    difficulty: 2,
    options: ["甲", "乙", "丙", "丁"],
    answerIndex: 1,
    explanation: "因为乙满足定义。",
    ...partial,
  };
}

function attempt(
  partial: Pick<AttemptRecord, "questionId" | "kcId" | "correct"> &
    Partial<Pick<AttemptRecord, "at" | "counted">>,
): AttemptRecord {
  return {
    difficulty: 2,
    at: NOW,
    ...partial,
  };
}

const QUESTIONS: readonly Question[] = [
  question({ id: "q1", kcId: "k1", stem: "第一题 | 带竖线" }),
  question({ id: "q2", kcId: "k2", stem: "第二题", difficulty: 3 }),
];

const KC_NAME = (kcId: string) => (kcId === "k1" ? "知识点一" : "知识点二");

const BASE = {
  targetName: "数据结构",
  questions: QUESTIONS,
  kcName: KC_NAME,
  exportedAt: NOW,
} as const;

describe("buildErrorSummaryMarkdown", () => {
  it("没有错题时返回空串", () => {
    expect(
      buildErrorSummaryMarkdown({
        ...BASE,
        attempts: [attempt({ questionId: "q1", kcId: "k1", correct: true })],
      }),
    ).toBe("");
  });

  it("标题、口径与汇总表齐全", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [
        attempt({ questionId: "q1", kcId: "k1", correct: false }),
        attempt({ questionId: "q2", kcId: "k2", correct: true }),
        attempt({ questionId: "q2", kcId: "k2", correct: false }),
      ],
    });

    expect(md).toContain("# 错题知识点总结 · 数据结构");
    expect(md).toContain("导出日期：2026/10/29");
    expect(md).toContain("## 知识点汇总");
    expect(md).toContain("| 知识点一 | 1 | 1 |");
    expect(md).toContain("| 知识点二 | 1 | 2 | 1 题 |");
  });

  it("题干里的竖线被转义，不破坏表格之外的正文", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false })],
    });
    expect(md).toContain("第一题 \\| 带竖线");
  });

  it("只汇总最近一次做错的题；答错后答对的不出现", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [
        attempt({ questionId: "q1", kcId: "k1", correct: false, at: "2026-10-27T00:00:00.000Z" }),
        attempt({ questionId: "q1", kcId: "k1", correct: true, at: NOW }),
      ],
    });
    expect(md).toBe("");
  });

  it("仅练习题不进入导出", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [
        attempt({ questionId: "q1", kcId: "k1", correct: false, counted: false }),
      ],
    });
    expect(md).toBe("");
  });

  it("错题清单按知识点分组并含解析与难度", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [
        attempt({ questionId: "q1", kcId: "k1", correct: false }),
        attempt({ questionId: "q2", kcId: "k2", correct: false }),
      ],
    });

    expect(md).toContain("## 错题清单（按知识点）");
    expect(md).toContain("### 知识点一");
    expect(md).toContain("- 正确答案：乙");
    expect(md).toContain("- 解析：因为乙满足定义。");
    expect(md).toContain("- 难度：3");
  });

  it("题库中已不存在的错题给出如实说明", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [
        attempt({ questionId: "q-gone", kcId: "k1", correct: false }),
        attempt({ questionId: "q1", kcId: "k1", correct: false }),
      ],
    });
    expect(md).toContain("### 知识点一");
    // q1 在题库 → 题干与解析进入清单
    expect(md).toContain("第一题");
    // q-gone 不在题库 → 汇总行仍在，但清单里只有 q1
    expect(md).not.toContain("q-gone");
  });

  it("输出以单个换行结尾", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false })],
    });
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});

describe("errorSummaryFileName", () => {
  it("包含目标名与日期", () => {
    expect(errorSummaryFileName("数据结构", NOW)).toBe("错题总结-数据结构-2026-10-29.md");
  });

  it("文件名里的非法字符被替换", () => {
    expect(errorSummaryFileName('a/b:c?"d"', NOW)).toBe("错题总结-a-b-c-d-2026-10-29.md");
  });

  it("非法时间戳退回 export 段", () => {
    expect(errorSummaryFileName("数据结构", "not-a-date")).toBe("错题总结-数据结构-export.md");
  });
});
