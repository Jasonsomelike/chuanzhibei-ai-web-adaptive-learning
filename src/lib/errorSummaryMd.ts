/**
 * 错题知识点总结 → Markdown 文档（纯函数，可在 Node 里直接测）。
 *
 * 数据口径与 errorRetrain.ts 完全一致：只认 `counted !== false` 的作答，
 * 只汇总「最近一次做错」的题。导出是本地拼装（错因 = 题库解析），
 * 不调用模型；生成的 Markdown 直接可读，也可导入任何笔记软件。
 *
 * 日期由调用方传入，模块不取时钟，输出完全可复现。
 */

import type { Question } from "@/data/questions";
import type { AttemptRecord } from "@/lib/learner";
import { lastWrongQuestionIds, summarizeErrorsByKc } from "@/lib/errorRetrain";

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

/** 生成完整 Markdown 文本。没有错题时返回空串，调用方据此禁用按钮。 */
export function buildErrorSummaryMarkdown(input: SummaryExportInput): string {
  const retrainIds = lastWrongQuestionIds(input.attempts);
  if (retrainIds.length === 0) return "";

  const questionById = new Map(input.questions.map((q) => [q.id, q] as const));
  const summaries = summarizeErrorsByKc(input.attempts);

  const lines: string[] = [];
  lines.push(`# 错题知识点总结 · ${input.targetName}`);
  lines.push("");
  lines.push(`- 导出日期：${formatDate(input.exportedAt)}`);
  lines.push(
    `- 口径：只统计计入证据的作答；「最近一次做错」的 ${retrainIds.length} 道题进入重训清单，答对后自动移出。`,
  );
  lines.push(
    "- 说明：错因来自题库解析，不是模型生成。同一道题只计一次证据，重做毕业记忆卡但不改掌握度。",
  );
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

    const kcQuestions = retrainIds
      .map((id) => questionById.get(id))
      .filter((q): q is Question => q !== undefined && q.kcId === row.kcId);

    if (kcQuestions.length === 0) {
      lines.push("");
      lines.push("（该知识点的错题不在当前题库中，可能是方向题目已删除。）");
      continue;
    }

    for (const question of kcQuestions) {
      lines.push("");
      lines.push(`**${escapeCell(question.stem)}**`);
      lines.push("");
      const correct = question.options[question.answerIndex] ?? "";
      lines.push(`- 正确答案：${escapeCell(correct)}`);
      lines.push(`- 解析：${escapeCell(question.explanation)}`);
      lines.push(`- 难度：${question.difficulty}`);
    }
  }

  return lines.join("\n") + "\n";
}

/** 建议的下载文件名，例如「错题总结-数据结构-2026-10-29.md」。 */
export function errorSummaryFileName(targetName: string, exportedAt: string): string {
  const safeName = targetName.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
  return `错题总结-${safeName || "学习目标"}-${fileDateStamp(exportedAt)}.md`;
}
