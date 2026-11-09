"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { assessmentResult, INTENT_LABELS, type AssessmentResult, type TeachingIntent, type WorkflowSnapshot } from "@/lib/learningWorkflowContracts";

export function TeachingTaskCard({ workflow, query, onFollowup, onAssessed, initialAssessment, disabled = false }: {
  workflow: WorkflowSnapshot; query: string;
  onFollowup: (intent: TeachingIntent, question: string) => void;
  onAssessed: () => void;
  initialAssessment?: AssessmentResult | null;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [assessment, setAssessment] = useState<AssessmentResult | null>(initialAssessment ?? null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const current = assessment?.workflow ?? workflow;
  const exercise = current.exercise;
  const focus = current.focusName ?? "当前知识点";
  const planUrl = `/path${query}&budget=${current.budgetMinutes}${current.focusKcId ? `&kc=${encodeURIComponent(current.focusKcId)}` : ""}${current.planTargets?.length ? `&targets=${encodeURIComponent(current.planTargets.join(","))}` : ""}`;
  const submit = async () => {
    if (selected === null || !exercise || submitting.current || disabled) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/agent/answer", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId: current.targetId, runId: current.runId, questionId: exercise.questionId, selectedIndex: selected }),
        signal: AbortSignal.timeout(20_000),
      });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(typeof raw === "object" && raw !== null && "error" in raw && typeof raw.error === "string" ? raw.error : "练习提交失败");
      const parsed = assessmentResult.parse(raw);
      setAssessment(parsed); onAssessed();
    } catch (error) { setError(error instanceof Error ? error.message : "练习提交失败，请重试"); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <section aria-label="教学任务" data-teaching-task className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{INTENT_LABELS[current.intent]}{current.focusName ? ` · ${current.focusName}` : ""}</h3>
      <span className="text-xs text-[var(--ink-faint)]" role="status">{current.status === "running" ? "正在处理" : current.status === "failed" ? "任务中断" : assessment ? "已核对作答并更新计划" : current.status === "awaiting_answer" ? "等待作答" : "任务完成"}</span>
    </div>
    <p className="mt-2 text-xs text-[var(--ink-soft)]">{current.routeReason}{current.resumedTurns > 0 ? ` 已衔接最近 ${current.resumedTurns} 轮教学记录。` : ""}</p>
    {exercise ? <fieldset className="mt-4" disabled={busy || assessment !== null || disabled || !current.persisted || current.status === "failed"}>
      <legend className="font-medium leading-relaxed">{exercise.stem}</legend>
      <div className="mt-3 space-y-2">{exercise.options.map((option, index) => <label key={index} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 has-checked:border-[var(--accent)]">
        <input className="mt-1" type="radio" name={`exercise-${current.runId}`} value={index} checked={(assessment?.selectedIndex ?? selected) === index} onChange={() => setSelected(index)} />
        <span>{String.fromCharCode(65 + index)}. {option}</span>
      </label>)}</div>
      {!assessment ? <button type="button" onClick={() => void submit()} disabled={selected === null || busy || !current.persisted} className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 text-[var(--on-accent)] disabled:opacity-50">{busy ? "正在核对…" : "提交练习并更新计划"}</button> : null}
      {exercise.repeated ? <p className="mt-2 text-xs text-[var(--ink-faint)]">这是重复练习，不重复增加学习证据。</p> : null}
    </fieldset> : null}
    {error ? <p role="alert" className="mt-3 text-[var(--warn)]">{error}</p> : null}
    {assessment ? <div role="status" data-assessment className="mt-3 border-l-2 border-[var(--accent)] pl-3 leading-relaxed">
      <p className="font-medium">{assessment.correct ? "回答正确" : `本题正确选项为 ${String.fromCharCode(65 + assessment.answerIndex)}`}</p>
      <p className="mt-1">{assessment.explanation}</p>
      <p className="mt-2 text-xs text-[var(--ink-soft)]">{assessment.counted ? "本题已计入学习证据" : "本题未重复增加证据"}；当前知识点有 {assessment.evidenceN} 条证据。{assessment.evidenceStatus === "insufficient" ? "证据仍不足，继续独立练习后再判断掌握情况。" : assessment.evidenceStatus === "needs_review" ? "现有证据提示需要复习。" : assessment.evidenceStatus === "likely_mastered" ? "现有证据支持可能掌握。" : "尚未形成有效测评证据。"}</p>
    </div> : null}
    {current.plan ? <div className="mt-4 border-t border-[var(--line)] pt-3" data-workflow-plan>
      <p className="font-medium">{assessment ? "作答后的学习计划" : "本次学习计划"} · {current.budgetMinutes} 分钟预算</p>
      <ol className="mt-2 space-y-2">{current.plan.steps.slice(0, 4).map((step, index) => <li key={step.kcId} className="flex justify-between gap-3"><Link href={`/path${query}&kc=${encodeURIComponent(step.kcId)}&budget=${current.budgetMinutes}${current.planTargets?.length ? `&targets=${encodeURIComponent(current.planTargets.join(","))}` : ""}`} className="text-[var(--accent)] underline">{index + 1}. {step.name}</Link><span className="shrink-0 text-xs text-[var(--ink-soft)]">{step.estMinutes} 分钟</span></li>)}</ol>
      <p className="mt-2 text-xs text-[var(--ink-faint)]">共 {current.plan.steps.length} 步，预计 {current.plan.totalMinutes} 分钟；预算暂缓 {current.plan.deferredCount} 项，先修阻塞 {current.plan.blockedCount} 项。</p>
      <Link href={planUrl} className="mt-2 inline-block text-[var(--accent)] underline">查看完整路径与先修关系 →</Link>
    </div> : null}
    {current.status !== "running" && current.status !== "failed" ? <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={disabled} onClick={() => onFollowup("hint", `请继续引导我理解${focus}，先给一个思考问题。`)} className="rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-50">继续引导</button>
      <button type="button" disabled={disabled} onClick={() => onFollowup("practice", `请给我一道关于${focus}的独立练习。`)} className="rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-50">{assessment ? "再做一道题" : "用一道题检查理解"}</button>
      {assessment && !assessment.correct ? <button type="button" disabled={disabled} onClick={() => onFollowup("analyze_error", `请分析刚才${focus}这道题的错因，先问我解题思路。`)} className="rounded-lg border border-[var(--line)] px-3 py-2 disabled:opacity-50">分析这次错因</button> : null}
    </div> : null}
    <details className="mt-3 text-xs text-[var(--ink-soft)]">
      <summary className="cursor-pointer">任务过程与规则核验</summary>
      <ol className="mt-2 space-y-1">{current.stages.map((stage, index) => <li key={`${stage.node}-${index}`}>{stage.status === "complete" ? "✓" : stage.status === "failed" ? "!" : "…"} {stage.label}</li>)}</ol>
      {current.verification ? <p className="mt-2">已检查：{current.verification.checks.join("、")}。规则核验不等于语义事实核实。</p> : null}
      {current.plan ? <p className="mt-2 break-all font-mono">pathHash: {current.plan.pathHash}</p> : null}
      {!current.persisted && current.status !== "running" ? <p className="mt-2">检查点未保存，请重新发起任务后再作答。</p> : null}
    </details>
  </section>;
}
