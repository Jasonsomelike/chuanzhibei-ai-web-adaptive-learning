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
    Partial<Pick<AttemptRecord, "at" | "counted" | "selectedIndex">>,
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

  it("答错后答对毕业的题也进入导出（复习不随毕业消失）", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [
        attempt({ questionId: "q1", kcId: "k1", correct: false, at: "2026-10-27T00:00:00.000Z" }),
        attempt({ questionId: "q1", kcId: "k1", correct: true, at: NOW }),
      ],
    });
    expect(md).toContain("第一题");
    expect(md).toContain("历史错题共 1 道（含已重做答对的）");
  });

  it("onlyQuestionIds 只导出所选的题，按知识点分组", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [
        attempt({ questionId: "q1", kcId: "k1", correct: false }),
        attempt({ questionId: "q2", kcId: "k2", correct: false }),
      ],
      onlyQuestionIds: ["q2"],
    });
    expect(md).not.toContain("第一题");
    expect(md).toContain("已选择 1 道题");
    expect(md).toContain("### 知识点二");
    expect(md).not.toContain("### 知识点一");
  });

  it("onlyQuestionIds 选中不存在或不在历史错题里的 id 时返回空串", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false })],
      onlyQuestionIds: ["q2", "missing"],
    });
    expect(md).toBe("");
  });

  it("notes 有笔记的题在解析后附「我的笔记」", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false })],
      notes: { q1: { text: "混淆了线性表和栈的出入顺序\n下次先画图", at: NOW } },
    });
    expect(md).toContain("> 我的笔记：混淆了线性表和栈的出入顺序");
    expect(md).toContain("> 下次先画图");
  });

  it("notes 缺省或空文本时不出现笔记区块", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false })],
      notes: { q2: { text: "  ", at: NOW } },
    });
    expect(md).not.toContain("我的笔记");
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

  it("readingByKc 提供摘录时写入教材与讲义区块", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false })],
      readingByKc: {
        k1: [{ label: "[教材·《教材》·第3章 栈·第45–46页]", text: "栈是后进先出的线性表。" }],
      },
    });
    expect(md).toContain("- 复习材料：摘自你当前口径选中的教材 / 讲义 / 上传资料，与出题引用同源。");
    expect(md).toContain("教材与讲义摘录（当前口径选中来源，与出题引用同源）：");
    expect(md).toContain("- [教材·《教材》·第3章 栈·第45–46页]");
    expect(md).toContain("  栈是后进先出的线性表。");
  });

  it("摘录超过每 KC 上限时截断并说明剩余数量", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false })],
      readingByKc: {
        k1: Array.from({ length: 6 }, (_, index) => ({ label: `[教材·片段${index + 1}]`, text: `正文${index + 1}` })),
      },
    });
    expect(md).toContain("[教材·片段4]");
    expect(md).not.toContain("[教材·片段5]");
    expect(md).toContain("（另有 2 段摘录未列入，可在诊断页「教材原文」查看全部。）");
  });

  it("未提供 readingByKc 时不出现复习材料说明与摘录区块", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false })],
    });
    expect(md).not.toContain("复习材料");
    expect(md).not.toContain("教材与讲义摘录");
  });

  it("题目展开完整选项，正确项与错选项分别标注", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false, selectedIndex: 0 })],
    });
    expect(md).toContain("选项：");
    expect(md).toContain("- A. 甲（✗ 你选了）");
    expect(md).toContain("- B. 乙（✓ 正确）");
    expect(md).toContain("- C. 丙");
    expect(md).toContain("- 你选了：甲");
  });

  it("「你选了」取最近一次计入证据的答错作答，忽略仅练习记录", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      questions: [{ ...QUESTIONS[0], id: "q-practice" }],
      attempts: [
        attempt({ questionId: "q-practice", kcId: "k1", correct: false, counted: false, selectedIndex: 2 }),
        // 重训清单口径来自计入证据的作答；这里补一条计入的错答让题目进入文档
        attempt({ questionId: "q-practice", kcId: "k1", correct: false, selectedIndex: 3 }),
      ],
    });
    expect(md).toContain("- 你选了：丁");
    expect(md).not.toContain("- 你选了：丙");
  });

  it("kcOverview 写入章节 / 掌握度 / 概述 / 先修背景块", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false })],
      kcOverview: {
        k1: {
          chapter: "第3章 栈与队列",
          summary: "栈是限定仅在表尾进行插入或删除的线性表。",
          prerequisiteNames: ["线性表"],
          masteryLabel: "42% ±18（3 条证据）",
        },
      },
    });
    expect(md).toContain("> 章节：第3章 栈与队列 · 当前掌握度：42% ±18（3 条证据）");
    expect(md).toContain("> 栈是限定仅在表尾进行插入或删除的线性表。");
    expect(md).toContain("> 先修：线性表");
  });

  it("kcOverview 缺项时优雅跳过背景块", () => {
    const md = buildErrorSummaryMarkdown({
      ...BASE,
      attempts: [attempt({ questionId: "q1", kcId: "k1", correct: false })],
      kcOverview: {},
    });
    expect(md).not.toContain("> 章节：");
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
