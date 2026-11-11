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
 * 总结不随重训队列清空而消失：答对毕业的错题仍能在总结里展开复习。
 */

import { useId, useMemo, useState } from "react";
import type { Question } from "@/data/questions";
import type { AttemptRecord } from "@/lib/learner";
import {
  historicalWrongQuestionIds,
  lastWrongQuestionIds,
  summarizeErrorsByKc,
  type ErrorKcSummary,
} from "@/lib/errorRetrain";
import {
  buildErrorSummaryMarkdown,
  errorSummaryFileName,
  lastWrongAttemptOf,
  type SummaryKcOverview,
  type SummaryReadingEntry,
} from "@/lib/errorSummaryMd";

export interface ErrorRetrainProps {
  /** 该目标全部历史作答（含仅练习）。 */
  readonly attempts: readonly AttemptRecord[];
  /** 题库：内置学科传全部题，自定义方向传已落库的题。 */
  readonly questions: readonly Question[];
  readonly kcName: (kcId: string) => string;
  /** 学习目标显示名，用于导出文档标题与文件名。 */
  readonly targetName: string;
  /** 按知识点归组的教材 / 讲义 / 上传资料摘录（与出题引用同源）；缺省时文档不含摘录区块。 */
  readonly readingByKc?: Readonly<Record<string, readonly SummaryReadingEntry[]>>;
  /** 知识点背景信息（章节 / 概述 / 先修 / 掌握度）；缺省时总结只显示题面与解析。 */
  readonly kcOverview?: Readonly<Record<string, SummaryKcOverview>>;
  /** 点击「重做这道题」：页面把该题设为当前题并滚动到答题区。 */
  readonly onRetrainQuestion: (question: Question) => void;
  /** 队列里还有待重训错题时加警示描边，提示「这里有错题要处理」；队列清空只展示总结时不警示。 */
  readonly emphasis?: boolean;
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
  targetName,
  readingByKc,
  kcOverview,
  onRetrainQuestion,
  emphasis = false,
  className = "",
}: ErrorRetrainProps) {
  /** 展开的总结知识点；null 表示全部收起。 */
  const [expandedKc, setExpandedKc] = useState<string | null>(null);
  /** 导出失败原因（下载被浏览器拦截等）；成功时不显示。 */
  const [downloadError, setDownloadError] = useState<string | null>(null);
  /** 面板折叠状态：默认收起，标题与计数始终可见，展开看题目与总结。 */
  const [collapsed, setCollapsed] = useState(true);
  const bodyId = useId();

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

  /** 历史错题（含已毕业）：总结详情用它，队列清空后仍可复习。 */
  const wrongQuestions = useMemo(
    () =>
      historicalWrongQuestionIds(attempts)
        .map((id) => questionById.get(id))
        .filter((q): q is Question => q !== undefined),
    [attempts, questionById],
  );

  /** 每道历史错题最近一次计入证据的错答下标，用于展开区还原「你选了」。 */
  const chosenByQuestion = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const question of wrongQuestions) {
      const attempt = lastWrongAttemptOf(attempts, question.id);
      map.set(question.id, attempt?.selectedIndex ?? null);
    }
    return map;
  }, [wrongQuestions, attempts]);

  const summaries = useMemo(() => summarizeErrorsByKc(attempts), [attempts]);

  /** 生成 Markdown 并触发浏览器下载。纯前端，无网络请求。 */
  const downloadSummary = (): void => {
    setDownloadError(null);
    const exportedAt = new Date().toISOString();
    const markdown = buildErrorSummaryMarkdown({
      targetName,
      attempts,
      questions,
      kcName,
      readingByKc,
      kcOverview,
      exportedAt,
    });
    if (markdown === "") return;

    try {
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = errorSummaryFileName(targetName, exportedAt);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Blob URL 已被浏览器接管，尽快释放
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(
        `下载失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  /** 队列清空但仍有历史错题时保留面板——总结与下载不消失，只有重训列表隐藏。 */
  if (retrainQuestions.length === 0 && summaries.length === 0) return null;

  return (
    <section
      aria-label="错题重训"
      className={`rounded-xl border bg-[var(--surface)] p-5 ${emphasis && retrainQuestions.length > 0 ? "error-retrain-emphasis" : "border-[var(--line)]"} ${className}`}
    >
      <h2 className="text-lg font-semibold tracking-tight">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(value => !value)}
          className="cursor-interaction flex items-center gap-1.5 rounded-md text-left"
        >
          错题重训与总结
          <span
            aria-hidden="true"
            className={`text-base leading-none text-[var(--ink-faint)] transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
          >
            ▾
          </span>
        </button>
      </h2>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--ink-soft)]">{retrainQuestions.length > 0 ? `${retrainQuestions.length} 道题待重训` : "无待重训题目"}</span>
        <button
          type="button"
          onClick={downloadSummary}
          title="把错题知识点总结导出为 Markdown 文件下载"
          className="shrink-0 rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs text-[var(--ink-soft)] hover:bg-[var(--line)]"
        >
          下载总结（.md）
        </button>
      </div>
      {downloadError !== null ? (
        <p role="alert" className="mt-2 text-xs text-[var(--bad)]">
          {downloadError}
        </p>
      ) : null}
      {!collapsed ? (
        <>
      {retrainQuestions.length > 0 ? (<>
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
      </>) : null}

      {summaries.length > 0 ? (
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <h3 className="text-sm font-semibold tracking-tight">错题知识点总结</h3>
          <p className="mt-1 text-xs text-[var(--ink-faint)]">
            按知识点汇总历史错题；点开看每题的完整选项、你的选择与解析（来自题库，不是模型生成）。
          </p>
          <ul className="mt-2 space-y-2">
            {summaries.map((row: ErrorKcSummary) => {
              const kcQuestions = wrongQuestions.filter((q) => q.kcId === row.kcId);
              const open = expandedKc === row.kcId;
              const overview = kcOverview?.[row.kcId];
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
                  {overview ? (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">
                      {overview.chapter !== "" ? `${overview.chapter} · ` : ""}
                      {overview.masteryLabel !== null ? `当前掌握度 ${overview.masteryLabel} · ` : ""}
                      {overview.prerequisiteNames.length > 0
                        ? `先修：${overview.prerequisiteNames.join("、")}`
                        : "无先修，可从这里建立基础"}
                    </p>
                  ) : null}
                  {overview !== undefined && overview.summary.trim() !== "" ? (
                    <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">{overview.summary}</p>
                  ) : null}
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
                          {kcQuestions.map((question) => {
                            const chosenIndex = chosenByQuestion.get(question.id) ?? null;
                            return (
                              <div
                                key={question.id}
                                className="rounded-md bg-[var(--canvas)] px-3 py-2"
                              >
                                <dt className="text-xs text-[var(--ink-soft)]">{question.stem}</dt>
                                <dd className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
                                  <ul className="space-y-0.5">
                                    {question.options.map((option, index) => {
                                      const isCorrect = index === question.answerIndex;
                                      const isChosen = chosenIndex === index;
                                      return (
                                        <li key={index} className={isChosen && !isCorrect ? "text-[var(--bad)]" : ""}>
                                          {String.fromCharCode(65 + index)}. {option}
                                          {isCorrect ? "（✓ 正确）" : ""}
                                          {isChosen ? "（✗ 你选了）" : ""}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                  <p className="mt-1.5">
                                    正确答案：{question.options[question.answerIndex]}
                                    。{question.explanation}
                                  </p>
                                </dd>
                              </div>
                            );
                          })}
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
        </>
      ) : null}
    </section>
  );
}
