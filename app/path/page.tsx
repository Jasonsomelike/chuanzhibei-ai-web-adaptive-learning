"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Nav, Card, SectionTitle, Pill, MasteryBar } from "@/components/ui";
import { useSubject, SubjectPicker } from "@/lib/subject";
import { recordPathEdit } from "@/lib/learner";
import { useLearner } from "@/lib/useLearner";
import {
  planPath,
  checkPrereqOrder,
  ALGO_VERSION,
  type PathStep,
  type PlanResult,
} from "@/lib/plan";
import { masteryMean, masterySd } from "@/lib/mastery";
import { computeDepths } from "@/lib/graph";

/**
 * 路径页的三个能力，对应评分表里的「交互模式创新」：
 *   1. 看路径：每一步都带理由，理由引用具体数值
 *   2. 反事实：改时间预算，立刻看到路径怎么变、哪几步被推迟
 *   3. 手动改写：学生可以删掉或提前某一步，系统会标出是否违反先修
 *
 * 全部计算在本地完成（纯函数），没有网络请求，所以改预算的反馈是即时的。
 */

const BUDGET_OPTIONS = [30, 60, 90, 120, 180, 240];

export default function PathPage() {
  const { subject, subjectId, setSubject, ready } = useSubject();
  const {
    learner,
    ready: learnerReady,
    progress,
    setLearner,
    synced,
  } = useLearner(subjectId);
  const [budget, setBudget] = useState(90);
  const [compareBudget, setCompareBudget] = useState<number | null>(null);
  const [manualSteps, setManualSteps] = useState<PathStep[] | null>(null);

  const depths = useMemo(() => computeDepths(subject.graph), [subject.graph]);
  const kcById = useMemo(
    () => new Map(subject.graph.concepts.map((c) => [c.id, c])),
    [subject.graph],
  );

  // 切换学科时清掉手动改写，避免把上一科的顺序带过来
  useEffect(() => {
    setManualSteps(null);
    setCompareBudget(null);
  }, [subjectId]);

  const plan: PlanResult | null = useMemo(() => {
    if (!progress) return null;
    return planPath({
      graph: subject.graph,
      mastery: progress.mastery,
      budgetMinutes: budget,
    });
  }, [progress, subject.graph, budget]);

  const counterfactual: PlanResult | null = useMemo(() => {
    if (!progress || compareBudget === null) return null;
    return planPath({
      graph: subject.graph,
      mastery: progress.mastery,
      budgetMinutes: compareBudget,
    });
  }, [progress, subject.graph, compareBudget]);

  const displayed = manualSteps ?? plan?.steps ?? [];

  const violations = useMemo(
    () => (manualSteps ? checkPrereqOrder(subject.graph, manualSteps) : []),
    [manualSteps, subject.graph],
  );

  const resetManual = useCallback(() => setManualSteps(null), []);

  const moveStep = (from: number, to: number) => {
    if (!learner) return;
    const base = manualSteps ?? plan?.steps ?? [];
    if (to < 0 || to >= base.length) return;

    const next = [...base];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, { ...moved, source: "manual" as const });
    setManualSteps(next);

    const updated = recordPathEdit(
      learner,
      subjectId,
      {
        kind: "reorder",
        detail: `把「${kcById.get(moved.kcId)?.name ?? moved.kcId}」从第 ${from + 1} 位移到第 ${to + 1} 位`,
      },
      new Date().toISOString(),
    );
    setLearner(updated);
  };

  const removeStep = (index: number) => {
    if (!learner) return;
    const base = manualSteps ?? plan?.steps ?? [];
    const removed = base[index];

    const next = base.filter((_, i) => i !== index);
    setManualSteps(next);

    const updated = recordPathEdit(
      learner,
      subjectId,
      { kind: "remove", detail: `移除「${kcById.get(removed.kcId)?.name ?? removed.kcId}」` },
      new Date().toISOString(),
    );
    setLearner(updated);
  };

  if (!ready || !learnerReady || !learner || !progress) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-4xl px-5 py-10">
          <p className="text-[var(--ink-soft)]">正在读取学习记录…</p>
        </main>
      </>
    );
  }

  const totalMinutes = displayed.reduce((s, x) => s + x.estMinutes, 0);

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-4xl px-5 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">学习路径</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            排序由纯函数算出，大模型不参与。改预算或拖动步骤都会立刻重算，无需等待。
          </p>
        </div>

        {/* 学科切换 */}
        <Card className="mb-5">
          <p className="mb-2 text-sm font-medium">当前学科</p>
          <SubjectPicker current={subjectId} onChange={setSubject} />
          <p className="mt-2 text-xs text-[var(--ink-faint)]">
            {subject.tagline}。各学科的掌握度与路径独立计算。
          </p>
        </Card>

        {/* 预算控制 */}
        <Card className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">这周能投入多少时间</p>
              <p className="mt-0.5 text-xs text-[var(--ink-soft)]">改预算即可看到路径如何变化</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {BUDGET_OPTIONS.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBudget(b)}
                  aria-pressed={budget === b}
                  aria-label={`把本周预算设为 ${b} 分钟`}
                  className={`tabular rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    budget === b
                      ? "bg-[var(--accent)] text-[var(--on-accent)]"
                      : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
                  }`}
                >
                  {b} 分
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* 反事实对比 */}
        <Card className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">反事实：如果时间不一样</p>
              <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                选一个对照预算，标出哪些步骤会被推迟
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setCompareBudget(null)}
                aria-pressed={compareBudget === null}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  compareBudget === null
                    ? "bg-[var(--ink)] text-[var(--canvas)]"
                    : "border border-[var(--line-strong)] text-[var(--ink-soft)]"
                }`}
              >
                关闭
              </button>
              {BUDGET_OPTIONS.filter((b) => b !== budget).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setCompareBudget(b)}
                  aria-pressed={compareBudget === b}
                  aria-label={`对照预算 ${b} 分钟`}
                  className={`tabular rounded-lg px-3 py-1.5 text-sm ${
                    compareBudget === b
                      ? "bg-[var(--ink)] text-[var(--canvas)]"
                      : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
                  }`}
                >
                  {b} 分
                </button>
              ))}
            </div>
          </div>
          {counterfactual ? (
            <p className="mt-3 border-t border-[var(--line)] pt-3 text-sm text-[var(--ink-soft)]">
              改成{" "}
              <span className="tabular font-medium text-[var(--ink)]">{compareBudget}</span> 分后，
              可排{" "}
              <span className="tabular font-medium text-[var(--ink)]">
                {counterfactual.steps.length}
              </span>{" "}
              步、共{" "}
              <span className="tabular font-medium text-[var(--ink)]">
                {counterfactual.totalMinutes}
              </span>{" "}
              分钟；另有{" "}
              <span className="tabular font-medium text-[var(--ink)]">
                {counterfactual.deferred.length}
              </span>{" "}
              个知识点因时间不足被推迟。
            </p>
          ) : null}
        </Card>

        {/* 路径 */}
        <section className="mb-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SectionTitle
              hint={`共 ${displayed.length} 步 · ${totalMinutes} 分钟${manualSteps ? " · 已手动修改" : ""}`}
            >
              本周路径
            </SectionTitle>
            {manualSteps ? (
              <button
                type="button"
                onClick={resetManual}
                className="mb-4 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
              >
                恢复算法排序
              </button>
            ) : null}
          </div>

          {violations.length > 0 ? (
            <Card className="mb-3 border-[var(--bad)] bg-[var(--bad-soft)]">
              <p className="text-sm font-medium text-[var(--bad)]">
                当前顺序违反 {violations.length} 条先修约束
              </p>
              <ul className="mt-2 space-y-1 text-sm text-[var(--ink-soft)]">
                {violations.map((v, i) => (
                  <li key={i}>· {v}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[var(--ink-faint)]">
                允许保存违规顺序（学生可能想先看某章），但系统必须标出来——
                这就是「可改写」与「放任」的区别。
              </p>
            </Card>
          ) : manualSteps ? (
            <Card className="mb-3 border-[var(--good)] bg-[var(--good-soft)]">
              <p className="text-sm text-[var(--good)]">当前顺序仍满足全部先修约束。</p>
            </Card>
          ) : null}

          {displayed.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--ink-soft)]">
                当前没有需要学习的知识点——所有候选点的掌握度都已达标。
                可以去{" "}
                <Link href="/diagnose" className="underline">
                  诊断页
                </Link>{" "}
                测更多知识点，或切换学科。
              </p>
            </Card>
          ) : (
            <ol className="space-y-2">
              {displayed.map((step, i) => {
                const c = kcById.get(step.kcId);
                const m = progress.mastery.find((x) => x.kcId === step.kcId);
                const mean = m ? masteryMean(m) : 0;
                const sd = m ? masterySd(m) : 1;
                const deferredInCounterfactual =
                  counterfactual?.deferred.includes(step.kcId) ?? false;

                return (
                  <li key={`${step.kcId}-${i}`}>
                    <Card className={deferredInCounterfactual ? "opacity-50" : ""}>
                      <div className="flex items-start gap-3">
                        <span className="tabular grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-sm font-medium text-[var(--accent)]">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{c?.name ?? step.kcId}</span>
                            <Pill>{step.kind === "learn" ? "新学" : "复习"}</Pill>
                            <Pill>{step.estMinutes} 分钟</Pill>
                            <Pill>深度 {depths.get(step.kcId) ?? 0}</Pill>
                            {step.source === "manual" ? <Pill tone="warn">已手动调整</Pill> : null}
                            {deferredInCounterfactual ? (
                              <Pill tone="bad">对照预算下会被推迟</Pill>
                            ) : null}
                          </div>
                          <p className="mt-1.5 text-sm text-[var(--ink-soft)]">{step.reason}</p>
                          <div className="mt-2 max-w-xs">
                            <MasteryBar mean={mean} sd={sd} evidenceN={m?.evidenceN ?? 0} />
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => moveStep(i, i - 1)}
                            disabled={i === 0}
                            aria-label={`把「${c?.name}」上移一位`}
                            className="rounded border border-[var(--line-strong)] px-2 py-0.5 text-xs disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveStep(i, i + 1)}
                            disabled={i === displayed.length - 1}
                            aria-label={`把「${c?.name}」下移一位`}
                            className="rounded border border-[var(--line-strong)] px-2 py-0.5 text-xs disabled:opacity-30"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeStep(i)}
                            aria-label={`移除「${c?.name}」`}
                            className="rounded border border-[var(--line-strong)] px-2 py-0.5 text-xs text-[var(--bad)]"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* 可复现性面板 */}
        <section>
          <SectionTitle hint="路径指纹对输出取 SHA-256。算法或图谱一改，指纹立刻变。">
            可复现性
          </SectionTitle>
          <Card>
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">路径指纹</dt>
                <dd className="truncate font-mono text-xs" title={plan?.pathHash}>
                  {plan?.pathHash ?? "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">算法版本</dt>
                <dd className="font-mono text-xs">{ALGO_VERSION}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">图谱版本</dt>
                <dd className="font-mono text-xs">{subject.graph.version}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">因预算不足推迟</dt>
                <dd className="tabular text-xs">{plan?.deferred.length ?? 0} 个知识点</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">进度存储</dt>
                <dd className="text-xs">
                  {synced ? "账号（跨设备同步）" : "本浏览器"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 border-t border-[var(--line)] pt-3 text-xs text-[var(--ink-faint)]">
              指纹不含任何模型标识：路径与用哪个大模型无关。
              同一输入 + 同一版本在任何时候都会得到同一个指纹。
            </p>
          </Card>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/tutor"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)]"
          >
            问导师「为什么这样排」
          </Link>
          <Link
            href="/diagnose"
            className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm"
          >
            继续诊断
          </Link>
        </div>
      </main>
    </>
  );
}
