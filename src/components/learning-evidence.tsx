"use client";
import { useMemo } from "react";
import type { KnowledgeGraph } from "@/lib/graph";
import type { SubjectProgress } from "@/lib/learner";
import { learningReport } from "@/lib/learningReport";

export function LearningEvidence({ graph, progress, budgetMinutes }: {
  graph: KnowledgeGraph; progress: SubjectProgress; budgetMinutes: number;
}) {
  const report = useMemo(() => learningReport(graph, progress, budgetMinutes), [graph, progress, budgetMinutes]);
  const names = new Map(graph.concepts.map((c) => [c.id, c.name]));
  return (
    <details className="mb-5 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <summary className="cursor-pointer text-sm font-medium">学习证据与路径变化 · {progress.attempts.length} 次作答</summary>
      {report ? <div className="mt-3 space-y-3 text-sm text-[var(--ink-soft)]">
        <p>最近一次：{names.get(report.last.kcId)} · {report.last.correct ? "答对" : "答错"}。同样的 {budgetMinutes} 分钟预算下，
          {report.added.length + report.removed.length > 0 ? `新增 ${report.added.length} 步、移出 ${report.removed.length} 步。` : "步骤范围保持不变，推荐依据已随证据更新。"}</p>
        {report.added.length > 0 ? <p>新纳入：{report.added.map((id) => names.get(id)).join("、")}</p> : null}
        {report.removed.length > 0 ? <p>移出本次计划：{report.removed.map((id) => names.get(id)).join("、")}</p> : null}
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <p>作答前路径<br /><code className="wrap-anywhere">{report.before.pathHash}</code></p>
          <p>作答后路径<br /><code className="wrap-anywhere">{report.after.pathHash}</code></p>
        </div>
        {report.archived > 0 ? <p>已保留 {report.archived} 条重测前的历史记录，当前估计只使用本轮有效证据。</p> : null}
      </div> : <p className="mt-3 text-sm text-[var(--ink-soft)]">尚无有效作答证据。当前计划按先修顺序探索，不代表你不会这些知识点。</p>}
      {progress.attempts.length > 0 ? <div className="mt-4 max-h-64 space-y-2 overflow-y-auto border-t border-[var(--line)] pt-3">
        {progress.attempts.slice(-30).reverse().map((attempt, index) => <p key={attempt.attemptId ?? `${attempt.at}:${index}`} className="text-xs text-[var(--ink-soft)]">
          <time>{attempt.at.slice(0, 10)}</time> · {names.get(attempt.kcId) ?? attempt.kcId} · {attempt.correct ? "答对" : "答错"} · {attempt.retired ? "历史已归档" : attempt.counted === false ? "仅练习 / 重复作答" : "当前证据"}
        </p>)}
      </div> : null}
    </details>
  );
}
