"use client";

/**
 * 错题重训与知识点总结面板。
 *
 * 数据口径在 errorRetrain.ts（纯函数）：只认 `counted !== false` 的作答，
 * 「答错后已答对」的题自动退出队列。重训会真正调用 onRetrainQuestion
 * 让页面把该题设为当前题；作答走诊断页既有的 submit 流程，
 * 掌握度、记忆卡、预测校准全部复用，不另开一条写入路径。
 *
 * 错题知识点总结是本地拼装（错因 = 该题解析），不调用模型——
 * 没配密钥也能看；解释文案如实标注来源是题库解析。
 */

import { useMemo, useState } from "react";
import type { Question } from "@/data/questions";
import type { AttemptRecord } from "@/lib/learner";
import {
  lastWrongQuestionIds,
  summarizeErrorsByKc,
  type ErrorKcSummary,
} from "@/lib/errorRetrain";

export interface ErrorRetrainProps {
  /** 该目标全部历史作答（含仅练习）。 */
  readonly attempts: readonly AttemptRecord[];
  /** 题库：内置学科传全部题，自定义方向传已落库的题。 */
  readonly questions: readonly Question[];
  readonly kcName: (kcId: string) => string;
  /** 点击「重做这道题」：页面把该题设为当前题并滚动到答题区。 */
  readonly onRetrainQuestion: (question: Question) => void;
  readonly className?: string;
}

/** 面板可见性判定：没有任何计入证据的错题时整块不渲染。 */
export function hasRetrainableErrors(attempts: readonly AttemptRecord[]): boolean {
  return lastWrongQuestionIds(attempts).length > 0;
}

function formatAt(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "时间未知";
  return new Date(ms).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function ErrorRetrainPanel({
  attempts,
  questions,
  kcName,
  onRetrainQuestion,
  className = "",
}: ErrorRetrainProps) {
  /** 展开的总结知识点；null 表示全部收起。 */
  const [expandedKc, setExpandedKc] = useState<string | null>(null);

  const questionById = useMemo(
    () => new Map(questions.map((q) => [q.id, q] as const)),
    [questions],
  );

  const retrainIds = useMemo(() => lastWrongQuestionIds(attempts), [attempts]);
  const retrainQuestions = useMemo(
    () =>
      retrainIds
        .map((id) => questionById.get(id))
        .filter((q): q is Question => q !== undefined),
    [retrainIds, questionById],
  );

  const summaries = useMemo(() => summarizeErrorsByKc(attempts), [attempts]);

  if (retrainQuestions.length === 0) return null;

  return (
    <section
      aria-label="错题重训"
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">错题重训</h2>
        <span className="text-xs text-[var(--ink-soft)]">
          {retrainQuestions.length} 道题最近一次做错 · 答对后自动移出队列
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">
        重做答对会毕业对应的错题记忆卡；答错则记忆卡重新到期、回到复习队列。
        同一道题只计一次证据（防刷分），所以重做不改动掌握度——想让掌握度真正回升，
        请在「诊断完成」卡片里清空该知识点的证据后重测。
      </p>

      <ul className="mt-3 space-y-2">
        {retrainQuestions.map((question) => (
          <li
            key={question.id}
            className="rounded-lg border border-[var(--line)] px-3 py-2.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm">{question.stem}</p>
                <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
                  {kcName(question.kcId)} · 难度 {question.difficulty}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRetrainQuestion(question)}
                className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--on-accent)]"
              >
                重做这道题
              </button>
            </div>
          </li>
        ))}
      </ul>

      {summaries.length > 0 ? (
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <h3 className="text-sm font-semibold tracking-tight">错题知识点总结</h3>
          <p className="mt-1 text-xs text-[var(--ink-faint)]">
            按知识点汇总历史错题；点开看每题的解析（来自题库，不是模型生成）。
          </p>
          <ul className="mt-2 space-y-2">
            {summaries.map((row: ErrorKcSummary) => {
              const kcQuestions = retrainQuestions.filter((q) => q.kcId === row.kcId);
              const open = expandedKc === row.kcId;
              return (
                <li key={row.kcId} className="rounded-lg border border-[var(--line)] px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{kcName(row.kcId)}</span>
                    <span className="tabular text-xs text-[var(--ink-soft)]">
                      错 {row.wrongCount} / 测 {row.totalCount}
                      {row.recentWrongStreak > 0
                        ? ` · 近期连续答错 ${row.recentWrongStreak} 题`
                        : ""}
                      {row.lastWrongAt !== null ? ` · 最近答错 ${formatAt(row.lastWrongAt)}` : ""}
                    </span>
                  </div>
                  {kcQuestions.length > 0 ? (
                    <>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpandedKc(open ? null : row.kcId)}
                        className="mt-1.5 text-xs text-[var(--accent)] underline underline-offset-2"
                      >
                        {open ? "收起总结" : `查看总结（${kcQuestions.length} 题解析）`}
                      </button>
                      {open ? (
                        <dl className="mt-2 space-y-2">
                          {kcQuestions.map((question) => (
                            <div
                              key={question.id}
                              className="rounded-md bg-[var(--canvas)] px-3 py-2"
                            >
                              <dt className="text-xs text-[var(--ink-soft)]">{question.stem}</dt>
                              <dd className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
                                正确答案：{question.options[question.answerIndex]}
                                。{question.explanation}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
