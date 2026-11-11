"use client";

/**
 * 错题本：全部历史错题的复习与重做页面。
 *
 * 三个区块：
 * ① 知识点总结报告——按知识点汇总错题数与掌握度，一眼看出哪里不会；
 * ② 错题清单——按知识点筛选，勾选后导出成错题知识总结文档（.md，带教材 /
 *    讲义 / 上传资料摘录与自己的笔记）；每题可写笔记备注；
 * ③ 重做入口——单题 / 按知识点 / 按错题顺序，跳诊断页走同一条作答管线
 *    （掌握度、记忆卡、预测校准全部复用，不另开写入路径）。
 *
 * 数据与诊断页同源：useSubject 定目标，useLearner 拿进度；
 * 教材摘录与出题引用同口径（合并包 + 资料选择追加上传来源）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Download } from "lucide-react";
import type { Question } from "@/data/questions";
import type { DirectionItem } from "@/lib/itemgen";
import { useSubject } from "@/lib/subject";
import { useAuth } from "@/lib/useAuth";
import { useLearner } from "@/lib/useLearner";
import { withQuestionNote } from "@/lib/learner";
import { historicalWrongQuestionIds, summarizeErrorsByKc } from "@/lib/errorRetrain";
import {
  buildErrorSummaryMarkdown,
  errorSummaryFileName,
  lastWrongAttemptOf,
  type SummaryKcOverview,
} from "@/lib/errorSummaryMd";
import { masteryMean, masterySd } from "@/lib/mastery";
import { indexGraph } from "@/lib/graph";
import { kcReadingViews } from "@/lib/kcMaterialReading";
import { useMaterialPack } from "@/lib/materialStore";
import { mergePacks } from "@/lib/materials";
import { uploadsToPack } from "@/lib/knowledge";
import { useKnowledgeBase } from "@/lib/kbStore";
import { Nav, Card } from "@/components/ui";
import { TargetPicker } from "@/components/target-picker";

export default function MistakesPage() {
  const { target, targetId, setTargetId, ready, targetError } = useSubject();
  const { user } = useAuth();
  const { learner, ready: learnerReady, progress, setLearner } = useLearner(targetId, target?.graph);

  // 方向目标：拉全量已落库题（与诊断页同口径过滤 rejected）
  const [directionItems, setDirectionItems] = useState<DirectionItem[]>([]);
  useEffect(() => {
    if (target?.kind !== "direction") {
      setDirectionItems([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/directions/items?directionId=${encodeURIComponent(target.id)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = (await res.json()) as { items?: DirectionItem[] };
          if (!cancelled) setDirectionItems(data.items ?? []);
        }
      } catch {
        /* 拉不到就按空题库处理，界面给出空态 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  const questions = useMemo<readonly Question[]>(() => {
    if (!target) return [];
    if (target.kind === "subject") return target.questions;
    return directionItems.filter((item) => item.status !== "rejected");
  }, [target, directionItems]);

  // 教材 / 讲义 / 上传资料合并包（与诊断页阅读与导出同口径）
  const { pack: materialPack, selection: materialSelection } = useMaterialPack(targetId, target?.graph);
  const directionIdForKb = target?.kind === "direction" ? target.id : "";
  const { docs: kbDocs, chunks: kbChunks } = useKnowledgeBase(directionIdForKb, user?.id);
  const uploadedPack = useMemo(
    () =>
      uploadsToPack(
        kbDocs.filter((doc) => doc.directionId === directionIdForKb),
        kbChunks.filter((chunk) => chunk.directionId === directionIdForKb),
      ),
    [kbDocs, kbChunks, directionIdForKb],
  );
  const readingSelection = useMemo(
    () => ({
      ...materialSelection,
      sourceIds: [
        ...materialSelection.sourceIds,
        ...uploadedPack.sources
          .map((source) => source.id)
          .filter((id) => !materialSelection.sourceIds.includes(id)),
      ],
    }),
    [materialSelection, uploadedPack],
  );
  const readingPack = useMemo(
    () => (uploadedPack.chunks.length > 0 ? mergePacks([materialPack, uploadedPack]) : materialPack),
    [materialPack, uploadedPack],
  );

  const kcNameMap = useMemo(
    () => new Map((target?.graph?.concepts ?? []).map((concept) => [concept.id, concept.name])),
    [target],
  );
  const kcName = useCallback((kcId: string) => kcNameMap.get(kcId) ?? kcId, [kcNameMap]);

  /** 按知识点归组的教材 / 讲义 / 上传资料摘录，供导出文档使用。 */
  const readingByKc = useMemo(() => {
    const graph = target?.graph;
    if (!graph) return {};
    const map: Record<string, { label: string; text: string }[]> = {};
    for (const view of kcReadingViews(readingPack, graph.concepts, readingSelection)) {
      for (const item of view.items) {
        if (!item.hasContent || item.entries.length === 0) continue;
        map[item.kcId] = item.entries.map((entry) => ({ label: entry.label, text: entry.text }));
      }
    }
    return map;
  }, [target, readingPack, readingSelection]);

  /** 知识点概况（章节 / 概述 / 先修 / 掌握度），让总结文档脱离应用也能读懂。 */
  const kcOverview = useMemo<Record<string, SummaryKcOverview>>(() => {
    const graph = target?.graph;
    if (!graph) return {};
    const index = indexGraph(graph);
    const states = new Map((progress?.mastery ?? []).map((state) => [state.kcId, state]));
    const map: Record<string, SummaryKcOverview> = {};
    for (const concept of graph.concepts) {
      const state = states.get(concept.id);
      const evidenceN = state?.evidenceN ?? 0;
      map[concept.id] = {
        chapter: concept.chapter,
        summary: concept.summary ?? "",
        prerequisiteNames: [...(index.predecessors.get(concept.id) ?? [])].map(
          (id) => kcNameMap.get(id) ?? id,
        ),
        masteryLabel:
          state && evidenceN > 0
            ? `${Math.round(masteryMean(state) * 100)}% ±${Math.round(masterySd(state) * 100)}（${evidenceN} 条证据）`
            : null,
      };
    }
    return map;
  }, [target, progress, kcNameMap]);

  const attempts = progress?.attempts ?? [];
  const notes = progress?.notes ?? {};

  const wrongIds = useMemo(() => historicalWrongQuestionIds(attempts), [attempts]);
  const wrongQuestions = useMemo(
    () =>
      wrongIds
        .map((id) => questions.find((q) => q.id === id))
        .filter((q): q is Question => q !== undefined),
    [wrongIds, questions],
  );
  const summaries = useMemo(() => summarizeErrorsByKc(attempts), [attempts]);

  const [kcFilter, setKcFilter] = useState<string>("all");
  const filteredQuestions = useMemo(
    () => (kcFilter === "all" ? wrongQuestions : wrongQuestions.filter((q) => q.kcId === kcFilter)),
    [wrongQuestions, kcFilter],
  );

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // 目标或筛选变化时清空选择，避免导出带进看不见的题
  useEffect(() => {
    setSelectedIds(new Set());
  }, [targetId, kcFilter]);

  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** 已显示答案的题：展开时先只给题目与选项自测，点了「显示答案」才看解析。 */
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(new Set());
  /** 笔记草稿：题目 id → 未保存文本。保存成功后从草稿里清出。 */
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 保存一条题目笔记；文本为空即删除该条。 */
  const saveNote = (questionId: string) => {
    if (!learner || !progress) return;
    const text = noteDrafts[questionId];
    if (text === undefined) return;
    const updated = withQuestionNote(progress, questionId, text, new Date().toISOString());
    setLearner({ ...learner, subjects: { ...learner.subjects, [targetId]: updated } });
    setNoteDrafts((prev) => {
      const { [questionId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
    setSavedNoteId(questionId);
  };

  /** 把勾选的错题导出成知识点总结文档（带摘录与笔记）。 */
  const exportSelected = () => {
    if (selectedIds.size === 0) return;
    setExporting(true);
    setExportError(null);
    try {
      const exportedAt = new Date().toISOString();
      const markdown = buildErrorSummaryMarkdown({
        targetName: target?.name ?? targetId,
        attempts,
        questions,
        kcName,
        exportedAt,
        readingByKc,
        kcOverview,
        onlyQuestionIds: [...selectedIds],
        notes,
      });
      if (markdown === "") {
        setExportError("所选题目没有可导出的历史错题记录。");
        return;
      }
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = errorSummaryFileName(target?.name ?? targetId, exportedAt);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  /** 重做入口：跳诊断页带队列，作答走既有 submit 流程。 */
  const diagnoseBase = `/diagnose?${target?.kind === "direction" ? `direction=${targetId}` : `subject=${targetId}`}`;
  const redoHref = (ids: readonly string[], label: string) =>
    `${diagnoseBase}&redo=${encodeURIComponent(ids.join(","))}&redoLabel=${encodeURIComponent(label)}`;

  const loading = !ready || !learnerReady;

  if (loading) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-7xl px-5 py-8 sm:px-8" aria-busy="true">
          <p className="text-sm text-[var(--ink-faint)]">正在读取错题本…</p>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">错题本</h1>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              全部历史错题（含已重做答对的）· 总结报告 / 勾选导出 / 笔记备注 / 按知识点或顺序重做
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <TargetPicker current={targetId} onChange={setTargetId} presentation="select" currentName={target?.name} />
            <Link href={diagnoseBase} className="inline-flex items-center gap-1.5 text-sm text-[var(--accent)] underline underline-offset-2">
              去作答新题<ArrowUpRight size={16} />
            </Link>
          </div>
        </header>

        {targetError !== null ? (
          <p role="alert" className="mb-5 text-xs text-[var(--bad)]">{targetError}</p>
        ) : null}

        {wrongQuestions.length === 0 ? (
          <Card className="mb-5">
            <p className="text-sm">这个学习目标还没有历史错题。</p>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              在<Link href={diagnoseBase} className="text-[var(--accent)] underline">诊断测评</Link>里答错且有计入证据的题会自动出现在这里。
            </p>
          </Card>
        ) : (
          <>
            {/* ── ① 知识点总结报告 ── */}
            <Card className="mb-5">
              <h2 className="text-lg font-semibold tracking-tight">知识点总结报告</h2>
              <p className="mt-1 text-xs text-[var(--ink-faint)]">按历史错题数排序；结合掌握度看哪个知识点不太会。</p>
              <ul className="mt-3 divide-y divide-[var(--line)]">
                {summaries.map((row) => {
                  const kcQuestionIds = wrongQuestions
                    .filter((q) => q.kcId === row.kcId)
                    .map((q) => q.id);
                  const mastery = kcOverview[row.kcId]?.masteryLabel ?? null;
                  return (
                    <li key={row.kcId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{kcName(row.kcId)}</p>
                        <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
                          错 {row.wrongCount} / 测 {row.totalCount}
                          {row.recentWrongStreak > 0 ? ` · 近期连续答错 ${row.recentWrongStreak} 题` : ""}
                          {row.lastWrongAt !== null ? ` · 最近答错 ${row.lastWrongAt.slice(0, 10)}` : ""}
                          {mastery !== null ? ` · 掌握度 ${mastery}` : " · 尚未掌握到有证据"}
                        </p>
                      </div>
                      {kcQuestionIds.length > 0 ? (
                        <Link
                          href={redoHref(kcQuestionIds, kcName(row.kcId))}
                          className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--on-accent)]"
                        >
                          按知识点重做（{kcQuestionIds.length} 题）
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>

            {/* ── ② 错题清单 ── */}
            <Card className="mb-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight">错题清单</h2>
                <label className="flex items-center gap-2 text-xs text-[var(--ink-soft)]">
                  按知识点筛选
                  <select
                    value={kcFilter}
                    onChange={(event) => setKcFilter(event.target.value)}
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-xs"
                    aria-label="按知识点筛选错题"
                  >
                    <option value="all">全部（{wrongQuestions.length} 题）</option>
                    {summaries.map((row) => (
                      <option key={row.kcId} value={row.kcId}>
                        {kcName(row.kcId)}（{wrongQuestions.filter((q) => q.kcId === row.kcId).length} 题）
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={exportSelected}
                  disabled={selectedIds.size === 0 || exporting}
                  title="把勾选的错题导出为知识点总结文档（含教材摘录与笔记）"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Download size={14} />
                  导出所选（{selectedIds.size} 题）
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set(filteredQuestions.map((q) => q.id)))}
                  className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs text-[var(--ink-soft)]"
                >
                  全选当前筛选
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-soft)]"
                >
                  清空选择
                </button>
                <Link
                  href={filteredQuestions.length > 0 ? redoHref(filteredQuestions.map((q) => q.id), kcFilter === "all" ? "按错题顺序" : kcName(kcFilter)) : "#"}
                  aria-disabled={filteredQuestions.length === 0}
                  className={`rounded-lg border px-3 py-1.5 text-xs ${filteredQuestions.length > 0 ? "border-[var(--accent)] text-[var(--accent)]" : "pointer-events-none border-[var(--line)] text-[var(--ink-faint)]"}`}
                >
                  {kcFilter === "all" ? "按错题顺序全部重做" : `按错题顺序重做「${kcName(kcFilter)}」`}
                </Link>
              </div>
              {exportError !== null ? (
                <p role="alert" className="mt-2 text-xs text-[var(--bad)]">{exportError}</p>
              ) : null}

              <ul className="mt-3 space-y-2">
                {filteredQuestions.map((question) => {
                  const expanded = expandedId === question.id;
                  const revealed = revealedIds.has(question.id);
                  const wrongAttempt = lastWrongAttemptOf(attempts, question.id);
                  const chosen = wrongAttempt?.selectedIndex;
                  const note = notes[question.id];
                  const draft = noteDrafts[question.id];
                  return (
                    <li key={question.id} className="rounded-lg border border-[var(--line)] px-3 py-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <label className="flex min-w-0 flex-1 items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(question.id)}
                            onChange={() => toggleSelected(question.id)}
                            className="mt-1"
                            aria-label={`选择错题：${question.stem}`}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm">{question.stem}</span>
                            <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                              {kcName(question.kcId)} · 难度 {question.difficulty}
                              {wrongAttempt !== null ? ` · 最近答错 ${wrongAttempt.at.slice(0, 10)}` : ""}
                              {note !== undefined ? " · 📝 有笔记" : ""}
                            </span>
                          </span>
                        </label>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedId(expanded ? null : question.id);
                              // 收起即重置自测：下次展开重新只看题目与选项
                              if (expanded) {
                                setRevealedIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(question.id);
                                  return next;
                                });
                              }
                            }}
                            aria-expanded={expanded}
                            className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs text-[var(--ink-soft)]"
                          >
                            {expanded ? "收起" : "展开自测"}
                          </button>
                          <Link
                            href={redoHref([question.id], "单题重做")}
                            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--on-accent)]"
                          >
                            重做这道题
                          </Link>
                        </div>
                      </div>

                      {expanded ? (
                        <div className="mt-2 rounded-md bg-[var(--canvas)] px-3 py-2">
                          <ul className="space-y-0.5 text-xs leading-relaxed text-[var(--ink-soft)]">
                            {question.options.map((option, index) => {
                              const isCorrect = revealed && index === question.answerIndex;
                              const isChosen = chosen === index;
                              return (
                                <li key={index} className={isChosen && !isCorrect ? "text-[var(--bad)]" : ""}>
                                  {String.fromCharCode(65 + index)}. {option}
                                  {isCorrect ? "（✓ 正确）" : ""}
                                  {isChosen ? "（✗ 你选了）" : ""}
                                </li>
                              );
                            })}
                          </ul>
                          {revealed ? (
                            <>
                              <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-soft)]">
                                正确答案：{question.options[question.answerIndex]}。{question.explanation}
                              </p>
                              {kcOverview[question.kcId] !== undefined && kcOverview[question.kcId].summary.trim() !== "" ? (
                                <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">{kcOverview[question.kcId].summary}</p>
                              ) : null}
                              {(readingByKc[question.kcId] ?? []).slice(0, 2).map((entry) => (
                                <details key={entry.label} className="mt-2">
                                  <summary className="cursor-pointer text-xs text-[var(--accent)]">{entry.label}</summary>
                                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[var(--ink-soft)]">{entry.text}</p>
                                </details>
                              ))}
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setRevealedIds((prev) => new Set(prev).add(question.id))}
                              className="mt-2 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs text-[var(--ink-soft)]"
                            >
                              显示答案与解析
                            </button>
                          )}
                        </div>
                      ) : null}

                      <div className="mt-2">
                        <label className="block text-xs text-[var(--ink-faint)]" htmlFor={`note-${question.id}`}>
                          笔记备注{savedNoteId === question.id && noteDrafts[question.id] === undefined ? "（已保存）" : ""}
                        </label>
                        <textarea
                          id={`note-${question.id}`}
                          rows={2}
                          value={draft ?? note?.text ?? ""}
                          onChange={(event) => setNoteDrafts((prev) => ({ ...prev, [question.id]: event.target.value }))}
                          onBlur={() => {
                            if (draft !== undefined && draft !== (note?.text ?? "")) saveNote(question.id);
                          }}
                          placeholder="写给自己的复习提示，导出总结文档时会附在题目后面"
                          className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
                        />
                        {draft !== undefined && draft !== (note?.text ?? "") ? (
                          <button
                            type="button"
                            onClick={() => saveNote(question.id)}
                            className="mt-1 rounded-lg border border-[var(--accent)] px-3 py-1 text-xs text-[var(--accent)]"
                          >
                            保存笔记
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
                {filteredQuestions.length === 0 ? (
                  <li className="py-3 text-sm text-[var(--ink-soft)]">这个筛选下没有历史错题。</li>
                ) : null}
              </ul>
            </Card>
          </>
        )}
      </main>
    </>
  );
}
