/**
 * 错题知识点总结 → Markdown 文档（纯函数，可在 Node 里直接测）。
 *
 * 数据口径与 errorRetrain.ts 完全一致：只认 `counted !== false` 的作答，
 * 汇总全部历史错题（含答对毕业的）；传入 onlyQuestionIds 时只导出所选的题。
 * 每题可附带学习者笔记（notes），导出是本地拼装（错因 = 题库解析），
 * 不调用模型；生成的 Markdown 直接可读，也可导入任何笔记软件。
 *
 * 日期由调用方传入，模块不取时钟，输出完全可复现。
 */

import type { Question } from "@/data/questions";
import type { AttemptRecord, SubjectNote } from "@/lib/learner";
import { historicalWrongQuestionIds, summarizeErrorsByKc } from "@/lib/errorRetrain";

export interface SummaryReadingEntry {
  /** 引用抬头，例如「[教材·《数据结构（C 语言版）》·第3章 栈·第45–46页]」。 */
  readonly label: string;
  /** 原文正文（可含换行）。 */
  readonly text: string;
}

/** 知识点的背景信息，让总结文档脱离应用也能读懂。 */
export interface SummaryKcOverview {
  readonly chapter: string;
  /** 图谱里的一句话概述；可为空串。 */
  readonly summary: string;
  readonly prerequisiteNames: readonly string[];
  /** 已格式化的掌握度标签（如「42% ±18（3 条证据）」）；未测评时为 null。 */
  readonly masteryLabel: string | null;
}

export interface SummaryExportInput {
  /** 学习目标显示名，写进文档标题。 */
  readonly targetName: string;
  /** 该目标全部历史作答（含仅练习）。 */
  readonly attempts: readonly AttemptRecord[];
  /** 题库（内置学科全部题，或方向已落库的题）。 */
  readonly questions: readonly Question[];
  readonly kcName: (kcId: string) => string;
  /** 导出日期（ISO 或 yyyy-mm-dd），写进文档头部。 */
  readonly exportedAt: string;
  /**
   * 按知识点准备的教材 / 讲义 / 上传资料摘录，与出题引用同源（同一合并包与口径）。
   * 缺省或某知识点缺项时该节省略——资料是增强，不是硬依赖。
   */
  readonly readingByKc?: Readonly<Record<string, readonly SummaryReadingEntry[]>>;
  /** 知识点背景信息（章节 / 概述 / 先修 / 掌握度）；缺省时文档不含概况块。 */
  readonly kcOverview?: Readonly<Record<string, SummaryKcOverview>>;
  /** 只导出这些题（题目 id，按历史错题顺序）；缺省导出全部历史错题（含已毕业）。 */
  readonly onlyQuestionIds?: readonly string[];
  /** 题目笔记（题目 id → 笔记）。有笔记的题在解析后附「我的笔记」。 */
  readonly notes?: Readonly<Record<string, SubjectNote>>;
}

/** 每个 KC 最多写入的摘录段数；更多段落以计数说明，不无限拉长文档。 */
const MAX_READING_ENTRIES_PER_KC = 4;

/** 找一道题最近一次「计入证据的答错」作答，用于还原「你选了哪项」。 */
export function lastWrongAttemptOf(
  attempts: readonly AttemptRecord[],
  questionId: string,
): AttemptRecord | null {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (attempt.questionId === questionId && !attempt.correct && attempt.counted !== false) {
      return attempt;
    }
  }
  return null;
}

/** 输出某知识点在文档里的背景块（章节 / 掌握度 / 概述 / 先修）。 */
function pushKcOverview(lines: string[], overview: SummaryKcOverview | undefined): void {
  if (!overview) return;
  const facts: string[] = [];
  if (overview.chapter.trim() !== "") facts.push(`章节：${overview.chapter}`);
  if (overview.masteryLabel !== null) facts.push(`当前掌握度：${overview.masteryLabel}`);
  if (facts.length === 0 && overview.summary.trim() === "" && overview.prerequisiteNames.length === 0) return;
  lines.push("");
  if (facts.length > 0) lines.push(`> ${facts.join(" · ")}`);
  if (overview.summary.trim() !== "") lines.push(`> ${overview.summary}`);
  if (overview.prerequisiteNames.length > 0) {
    lines.push(`> 先修：${overview.prerequisiteNames.join("、")}`);
  }
}

/** 转义 Markdown 表格与正文里有歧义的竖线，避免把表格撑破。 */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  return new Date(ms).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** 下载文件名里的日期段：非法时间戳退回「export」。 */
function fileDateStamp(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms)
    ? new Date(ms).toISOString().slice(0, 10)
    : "export";
}

/** 生成完整 Markdown 文本。没有可导出的错题时返回空串，调用方据此禁用按钮。 */
export function buildErrorSummaryMarkdown(input: SummaryExportInput): string {
  const historical = historicalWrongQuestionIds(input.attempts);
  const selected = input.onlyQuestionIds ? new Set(input.onlyQuestionIds) : null;
  const scopedIds = selected ? historical.filter((id) => selected.has(id)) : historical;
  if (scopedIds.length === 0) return "";

  const questionById = new Map(input.questions.map((q) => [q.id, q] as const));
  /** 范围内且题库可辨认的题，按知识点计数——没有题的行不出现在文档里。 */
  const kcScoped = new Map<string, number>();
  for (const id of scopedIds) {
    const question = questionById.get(id);
    if (question) kcScoped.set(question.kcId, (kcScoped.get(question.kcId) ?? 0) + 1);
  }
  const summaries = summarizeErrorsByKc(input.attempts).filter(
    (row) => (kcScoped.get(row.kcId) ?? 0) > 0,
  );
  if (summaries.length === 0) return "";

  const hasReading = Object.values(input.readingByKc ?? {}).some((entries) => entries.length > 0);

  const lines: string[] = [];
  lines.push(`# 错题知识点总结 · ${input.targetName}`);
  lines.push("");
  lines.push(`- 导出日期：${formatDate(input.exportedAt)}`);
  lines.push(
    `- 口径：只统计计入证据的作答；${
      selected !== null ? `已选择 ${scopedIds.length} 道题` : `历史错题共 ${scopedIds.length} 道（含已重做答对的）`
    }进入本总结。`,
  );
  lines.push(
    "- 说明：错因来自题库解析，不是模型生成。同一道题只计一次证据，重做毕业记忆卡但不改掌握度。",
  );
  if (hasReading) {
    lines.push(
      "- 复习材料：摘自你当前口径选中的教材 / 讲义 / 上传资料，与出题引用同源。",
    );
  }
  lines.push("");

  // ── 知识点汇总表 ──
  lines.push("## 知识点汇总");
  lines.push("");
  lines.push("| 知识点 | 答错 | 测评 | 近期连续答错 | 最近答错 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of summaries) {
    lines.push(
      `| ${escapeCell(input.kcName(row.kcId))} | ${row.wrongCount} | ${row.totalCount} | ${
        row.recentWrongStreak > 0 ? `${row.recentWrongStreak} 题` : "—"
      } | ${row.lastWrongAt !== null ? formatDate(row.lastWrongAt) : "—"} |`,
    );
  }
  lines.push("");

  // ── 按知识点展开的错题清单 ──
  lines.push("## 错题清单（按知识点）");
  for (const row of summaries) {
    lines.push("");
    lines.push(`### ${input.kcName(row.kcId)}`);
    pushKcOverview(lines, input.kcOverview?.[row.kcId]);

    const kcQuestions = scopedIds
      .map((id) => questionById.get(id))
      .filter((q): q is Question => q !== undefined && q.kcId === row.kcId);

    if (kcQuestions.length === 0) {
      lines.push("");
      lines.push("（该知识点的错题不在当前题库中，可能是方向题目已删除。）");
      continue;
    }

    for (const question of kcQuestions) {
      const wrongAttempt = lastWrongAttemptOf(input.attempts, question.id);
      lines.push("");
      lines.push(`**${escapeCell(question.stem)}**`);
      lines.push("");
      lines.push("选项：");
      question.options.forEach((option, index) => {
        const marks: string[] = [];
        if (index === question.answerIndex) marks.push("✓ 正确");
        if (wrongAttempt?.selectedIndex === index) marks.push("✗ 你选了");
        lines.push(
          `- ${String.fromCharCode(65 + index)}. ${escapeCell(option)}${marks.length > 0 ? `（${marks.join("，")}）` : ""}`,
        );
      });
      lines.push("");
      if (wrongAttempt?.selectedIndex !== undefined) {
        const chosen = question.options[wrongAttempt.selectedIndex] ?? "未记录";
        lines.push(`- 你选了：${escapeCell(chosen)}`);
      }
      const correct = question.options[question.answerIndex] ?? "";
      lines.push(`- 正确答案：${escapeCell(correct)}`);
      lines.push(`- 解析：${escapeCell(question.explanation)}`);
      lines.push(`- 难度：${question.difficulty}`);

      const note = input.notes?.[question.id];
      if (note !== undefined && note.text.trim() !== "") {
        lines.push("");
        const noteLines = note.text.trim().split(/\r?\n/);
        lines.push(`> 我的笔记：${noteLines[0]}`);
        for (const extra of noteLines.slice(1)) lines.push(`> ${extra}`);
      }
    }

    const readings = input.readingByKc?.[row.kcId] ?? [];
    if (readings.length > 0) {
      lines.push("");
      lines.push("教材与讲义摘录（当前口径选中来源，与出题引用同源）：");
      const shown = readings.slice(0, MAX_READING_ENTRIES_PER_KC);
      for (const entry of shown) {
        lines.push(`- ${entry.label}`);
        for (const textLine of entry.text.split(/\r?\n/)) lines.push(`  ${textLine}`);
      }
      if (readings.length > shown.length) {
        lines.push(`（另有 ${readings.length - shown.length} 段摘录未列入，可在诊断页「教材原文」查看全部。）`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

/** 建议的下载文件名，例如「错题总结-数据结构-2026-10-29.md」。 */
export function errorSummaryFileName(targetName: string, exportedAt: string): string {
  const safeName = targetName.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
  return `错题总结-${safeName || "学习目标"}-${fileDateStamp(exportedAt)}.md`;
}
