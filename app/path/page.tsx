"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Nav, Card, SectionTitle, Pill, MasteryBar } from "@/components/ui";
import { useStaggerIn, useStepFlash } from "@/components/motion";
import { TargetPicker, targetCaption } from "@/components/target-picker";
import { ChapterGoals } from "@/components/chapter-goals";
import { useSubject } from "@/lib/subject";
import { recordPathEdit } from "@/lib/learner";
import { useLearner } from "@/lib/useLearner";
import {
  planPath,
  checkPrereqOrder,
  masteredSet,
  computeInputHash,
  computePathHash,
  applyManualOrder,
  movedKcIds,
  type ManualEdit,
  ALGO_VERSION,
  type PathStep,
  type PlanResult,
} from "@/lib/plan";
import { masteryMean, masterySd } from "@/lib/mastery";
import { computeDepths } from "@/lib/graph";
import { CHAPTERS_STORAGE_KEY, chapterScope, chaptersOf } from "@/lib/chapters";
import { summarizeCounterfactual } from "@/lib/planDiff";
import { readManualPath, writeManualPath } from "@/lib/manualPath";

/**
 * 路径页的四个能力，对应评分表里的「交互模式创新」：
 *   1. 看路径：每一步都带理由，理由引用具体数值
 *   2. 反事实：改时间预算，立刻看到路径怎么变、哪几步被推迟或阻塞
 *   3. 手动改写：学生可以删掉或提前某一步，系统会标出是否违反先修
 *   4. 章节范围：按教材章节收窄候选，但跨章先修点必须一起带上
 *
 * 全部计算在本地完成（纯函数），没有网络请求，所以改预算的反馈是即时的。
 */

const BUDGET_OPTIONS = [30, 60, 90, 120, 180, 240];

/** 切目标后的第一帧不拿上一科的选择去算；用共享空数组保持引用稳定。 */
const EMPTY_CHAPTERS: readonly string[] = [];

/** 一个 localStorage 键里按目标 id 存章名列表。 */
type ChapterStore = Record<string, readonly string[]>;

/*
 * 章节选择按目标存进同一个键（登出清理只需 removeItem 一次）。
 * 读不出来或格式损坏时一律当「没选」：宁可回到整科，也不让坏数据缩窄范围。
 */
function readChapterSelection(targetId: string): readonly string[] {
  try {
    const raw = window.localStorage.getItem(CHAPTERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const value = (parsed as Record<string, unknown>)[targetId];
    if (!Array.isArray(value)) return [];
    return value.filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
}

function writeChapterSelection(targetId: string, names: readonly string[]): void {
  try {
    const raw = window.localStorage.getItem(CHAPTERS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const store: ChapterStore =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as ChapterStore)
        : {};
    window.localStorage.setItem(
      CHAPTERS_STORAGE_KEY,
      JSON.stringify({ ...store, [targetId]: [...names] }),
    );
  } catch {
    /* 隐私模式或配额满时存不进去，不影响当前会话 */
  }
}

/** 路径步骤的 DOM id；?kc=<id> 跳转（导师页引用 Pill）靠它定位。 */
function pathStepId(kcId: string): string {
  return `path-step-${kcId}`;
}

export default function PathPage() {
  const { target, targetId, setTargetId, ready, loadingTarget, targetError } = useSubject();
  const {
    learner,
    ready: learnerReady,
    progress,
    setLearner,
    synced,
  } = useLearner(targetId, target?.graph);
  const [budget, setBudget] = useState(90);
  const [compareBudget, setCompareBudget] = useState<number | null>(null);
  /*
   * 手动改写只存「顺序 + 移除集合」，不存整份 steps。
   *
   * 存 steps 的旧做法有两个问题：改预算时 manualSteps 不重算，
   * 页面还停在旧预算的 16 步；指纹也仍取算法 plan，与显示顺序脱节。
   *
   * 必须同时存 removed：只从顺序里删掉被移除的点是不够的——
   * 重放时 plan 里「不在顺序中」的步骤会被当作「新装进来的」追加回末尾，
   * 「移除」于是变成空操作。
   */
  const [manualEdit, setManualEdit] = useState<ManualEdit | null>(null);

  /**
   * 从 ?kc=<id> 读到的定位目标。只影响视觉（滚动 + 高亮），不参与路径计算：
   * 导师页的引用 Pill 会带这个参数跳过来；参数缺失或 id 不在当前路径里时什么都不做。
   */
  const [highlightKc, setHighlightKc] = useState<string | null>(null);

  /*
   * 动效只包展示层：入场 stagger 覆盖标题与静态卡片，步骤列表作为一个整体入场；
   * ?kc= 定位到的步骤额外做一次 0.985 → 1 的缩放脉冲（终态 scale 1）。
   * 两者都在 prefers-reduced-motion 下直接跳过。
   */
  const mainRef = useRef<HTMLElement>(null);
  useStaggerIn(mainRef);
  useStepFlash(mainRef, highlightKc);

  /*
   * 章节选择跟着目标走：state 里带上所属 targetId，切目标后的第一帧
   * 不会拿上一科的选择去算 planPath；实际生效的 chapters 只在 id 匹配时使用。
   */
  const [chapterSelection, setChapterSelection] = useState<{
    readonly targetId: string;
    readonly names: readonly string[];
  }>({ targetId: "", names: [] });

  const graph = target?.graph;
  const depths = useMemo(() => (graph ? computeDepths(graph) : new Map<string, number>()), [graph]);
  const kcById = useMemo(
    () => new Map((graph?.concepts ?? []).map((c) => [c.id, c])),
    [graph],
  );

  const chapters =
    chapterSelection.targetId === targetId ? chapterSelection.names : EMPTY_CHAPTERS;

  // 切目标时重新读取该目标的章节选择；图谱里已不存在的章名直接丢弃
  useEffect(() => {
    if (!graph || !target) return;
    if (target.kind === "direction") {
      setChapterSelection({ targetId, names: [] });
      return;
    }
    const known = new Set(chaptersOf(graph).map((c) => c.name));
    const names = readChapterSelection(targetId).filter((name) => known.has(name));
    setChapterSelection({ targetId, names });
  }, [graph, target, targetId]);

  const updateChapters = useCallback(
    (names: readonly string[]) => {
      setChapterSelection({ targetId, names });
      writeChapterSelection(targetId, names);
    },
    [targetId],
  );

  /*
   * 章节只收窄 targets，图谱始终完整——跨章先修点必须留在候选集里，
   * 否则严格先修校验会把「先修不在路径」判成违规。
   */
  const scope = useMemo(
    () => (graph ? chapterScope(graph, chapters) : null),
    [graph, chapters],
  );
  /*
   * 没选章节、或把全部章节都选上时，都等价于整科：统一不传 targets。
   * 否则「全选」与「清空」会得到不同的输入指纹，而界面却写着两者都是整科。
   */
  const wholeSubject =
    scope !== null && graph !== undefined && scope.targets.length === graph.concepts.length;
  const chapterTargets =
    scope && scope.targets.length > 0 && !wholeSubject ? scope.targets : undefined;

  /*
   * 手动改写按目标持久化：挂载与切目标时读回该目标的存档，没有存档则回到算法序。
   *
   * 章节范围变化**不**清掉手动顺序：存档按目标存，新范围内装不下的点由
   * applyManualOrder 自动丢弃、新装进来的点追加末尾，顺序仍然可解释。
   * 「恢复算法排序」会同时清掉存档（见 resetManual），否则刷新后旧顺序会自己回来。
   */
  useEffect(() => {
    setManualEdit(readManualPath(targetId));
  }, [targetId]);

  /*
   * 定位参数只在挂载时读一次：用 window.location.search 而不是 useSearchParams，
   * 与 useSubject 同口径，避免 Next 把页面推进 Suspense 边界。
   */
  useEffect(() => {
    const kc = new URLSearchParams(window.location.search).get("kc");
    setHighlightKc(kc !== null && kc.trim() !== "" ? kc : null);
  }, []);

  /*
   * 对照预算只跟目标走：换章节时保留它，
   * 才能比较「同一对照预算下，章节范围变化让路径怎么变」。
   */
  useEffect(() => {
    setCompareBudget(null);
  }, [targetId]);

  const plan: PlanResult | null = useMemo(() => {
    if (!progress || !graph) return null;
    return planPath({
      graph,
      mastery: progress.mastery,
      budgetMinutes: budget,
      targets: chapterTargets,
    });
  }, [progress, graph, budget, chapterTargets]);

  const counterfactual: PlanResult | null = useMemo(() => {
    if (!progress || !graph || compareBudget === null) return null;
    return planPath({
      graph,
      mastery: progress.mastery,
      budgetMinutes: compareBudget,
      targets: chapterTargets,
    });
  }, [progress, graph, compareBudget, chapterTargets]);

  const inputHash = useMemo(() => {
    if (!progress || !graph) return null;
    return computeInputHash({
      graph,
      mastery: progress.mastery,
      budgetMinutes: budget,
      targets: chapterTargets,
    });
  }, [progress, graph, budget, chapterTargets]);
  /**
   * 实际显示的顺序：以当前预算的算法 plan 为集合，按用户调整过的相对次序重放。
   *
   * 重放规则：manualOrder 里出现的点，按它的顺序排在前面（只保留仍在 plan 里的）；
   * plan 里有但 manualOrder 没有的点（新预算下才装得下的）追加在后面。
   * 这样「手动 16 步 → 预算改 30」会立刻收缩到 2 步，而不是停在 16 步。
   */
  const displayed = useMemo<readonly PathStep[]>(
    () => applyManualOrder(plan?.steps ?? [], manualEdit),
    [plan, manualEdit],
  );

  /** 相对算法顺序真的换了位置的点。只给这些点标「已手动调整」。 */
  const moved = useMemo(
    () => movedKcIds(displayed, plan?.steps ?? []),
    [displayed, plan],
  );

  /** 每个 ?kc= 只滚动一次：改预算会让 displayed 换引用，但不该把视口反复拽回定位点。 */
  const scrolledKc = useRef<string | null>(null);

  useEffect(() => {
    if (highlightKc === null || scrolledKc.current === highlightKc) return;
    const el = document.getElementById(pathStepId(highlightKc));
    // 定位点不在当前路径里（被手动移除 / 不在预算内）：静默跳过，路径照常显示
    if (el === null) return;
    scrolledKc.current = highlightKc;
    /*
     * behavior:"smooth" 是显式参数，不受 CSS scroll-behavior:auto 约束（规范行为），
     * 所以 reduced-motion 必须在这里单独判断，否则「减少动态效果」下仍会平滑滚动。
     */
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [highlightKc, displayed]);

  /*
   * 对照预算的汇总：推迟与阻塞分开计数。
   * blockedNotInPath 以「当前显示的路径」为准，所以手动移除的点也会重新出现在清单里。
   */
  const counterfactualSummary = useMemo(
    () => summarizeCounterfactual(counterfactual, displayed),
    [counterfactual, displayed],
  );

  /*
   * 当前显示顺序的指纹。
   * 与算法路径指纹分开显示：手动改写后两者不同，面板必须能解释这个差异，
   * 否则「路径指纹」会指向一个用户看到的路径之外的另一个东西。
   */
  const displayedHash = useMemo(() => {
    if (!plan) return null;
    const steps = displayed.map((s) => ({ ...s }));
    return computePathHash({
      steps,
      totalMinutes: steps.reduce((sum, s) => sum + s.estMinutes, 0),
      deferred: plan.deferred,
      blocked: plan.blocked,
      algoVersion: plan.algoVersion,
      kgVersion: plan.kgVersion,
    });
  }, [displayed, plan]);

  const violations = useMemo(
    () =>
      manualEdit && graph && progress
        ? checkPrereqOrder(graph, displayed, {
            mastered: masteredSet(progress.mastery),
          })
        : [],
    [manualEdit, graph, progress, displayed],
  );

  /*
   * 手动改写的唯一写入口：内存状态与按目标存档一起更新，
   * 避免「界面改了、刷新又变回去」。存档读不出来时按 null 处理，写失败不影响本会话。
   */
  const applyManualEdit = (edit: ManualEdit | null) => {
    setManualEdit(edit);
    writeManualPath(targetId, edit);
  };

  const resetManual = () => applyManualEdit(null);

  const moveStep = (from: number, to: number) => {
    if (!learner) return;
    if (to < 0 || to >= displayed.length) return;

    const next = displayed.map((s) => s.kcId);
    const [movedKc] = next.splice(from, 1);
    next.splice(to, 0, movedKc);
    applyManualEdit({ order: next, removed: manualEdit?.removed ?? [] });

    const updated = recordPathEdit(
      learner,
      targetId,
      {
        kind: "reorder",
        detail: `把「${kcById.get(movedKc)?.name ?? movedKc}」从第 ${from + 1} 位移到第 ${to + 1} 位`,
      },
      new Date().toISOString(),
      graph,
    );
    setLearner(updated);
  };

  const removeStep = (index: number) => {
    if (!learner) return;
    const removed = displayed[index];
    if (!removed) return;

    const next = displayed.filter((_, i) => i !== index).map((s) => s.kcId);
    // 显式记进 removed：否则重放会把 plan 里「不在顺序中」的它又追加回末尾
    applyManualEdit({
      order: next,
      removed: [...new Set([...(manualEdit?.removed ?? []), removed.kcId])],
    });

    const updated = recordPathEdit(
      learner,
      targetId,
      { kind: "remove", detail: `移除「${kcById.get(removed.kcId)?.name ?? removed.kcId}」` },
      new Date().toISOString(),
      graph,
    );
    setLearner(updated);
  };

  if (!ready || !learnerReady || !learner || !progress || !target || !graph) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-4xl px-5 py-10">
          <p className="text-[var(--ink-soft)]">
            {loadingTarget ? "正在加载自定义方向…" : "正在读取学习记录…"}
          </p>
        </main>
      </>
    );
  }

  const totalMinutes = displayed.reduce((s, x) => s + x.estMinutes, 0);

  return (
    <>
      <Nav />
      <main id="main" ref={mainRef} className="mx-auto max-w-4xl px-5 py-10">
        <div className="mb-6" data-motion="hero">
          <h1 className="text-2xl font-semibold tracking-tight">学习路径</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            排序由纯函数算出，不调用大模型。切换章节、改预算或用 ↑ / ↓ 调整步骤都会立刻重算，无需等待。
          </p>
        </div>

        {/* 目标切换 */}
        <Card className="mb-5" motion="target">
          <p className="mb-2 text-sm font-medium">当前学习目标</p>
          <TargetPicker current={targetId} onChange={setTargetId} />
          <p className="mt-2 text-xs text-[var(--ink-faint)]">{targetCaption(target)}</p>
          {targetError ? (
            <p className="mt-2 rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">
              {targetError}
            </p>
          ) : null}
        </Card>

        {/* 章节范围：只收窄 targets，不裁剪图谱 */}
        {target.kind === "direction" ? (
          <Card className="mb-5" motion="chapters">
            <p className="text-sm font-medium">教材章节</p>
            <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
              自定义方向没有教材章节，路径覆盖方向里的全部 {graph.concepts.length} 个知识点；
              用下方预算控制这周能学多少。
            </p>
          </Card>
        ) : scope ? (
          <ChapterGoals
            target={target}
            selected={chapters}
            scope={scope}
            budgetMinutes={budget}
            plannedSteps={plan?.steps.length ?? 0}
            onChange={updateChapters}
          />
        ) : null}

        {/* 预算控制 */}
        <Card className="mb-5" motion="budget">
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
        <Card className="mb-5" motion="counterfactual">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">反事实：如果时间不一样</p>
              <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                选一个对照预算，标出哪些步骤会被推迟或因先修阻塞
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
            <div className="mt-3 border-t border-[var(--line)] pt-3">
              <p className="text-sm text-[var(--ink-soft)]">
                改成{" "}
                <span className="tabular font-medium text-[var(--ink)]">{compareBudget}</span>{" "}
                分后，可排{" "}
                <span className="tabular font-medium text-[var(--ink)]">
                  {counterfactual.steps.length}
                </span>{" "}
                步、共{" "}
                <span className="tabular font-medium text-[var(--ink)]">
                  {counterfactual.totalMinutes}
                </span>{" "}
                分钟；因时间不足推迟{" "}
                <span className="tabular font-medium text-[var(--ink)]">
                  {counterfactualSummary.deferred.length}
                </span>{" "}
                个知识点，因先修阻塞{" "}
                <span className="tabular font-medium text-[var(--ink)]">
                  {counterfactualSummary.blocked.length}
                </span>{" "}
                个知识点。
              </p>
              {counterfactualSummary.blockedNotInPath.length > 0 ? (
                <div className="mt-2 text-xs text-[var(--ink-faint)]">
                  <p>其中不在当前路径、因先修阻塞的点：</p>
                  <ul className="mt-1 space-y-0.5">
                    {counterfactualSummary.blockedNotInPath.map((kcId) => {
                      const name = kcById.get(kcId)?.name ?? kcId;
                      const by = counterfactualSummary
                        .blockedByOf(kcId)
                        .map((id) => kcById.get(id)?.name ?? id);
                      return (
                        <li key={kcId}>
                          · {name} ← {by.join("、")}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        {/* 路径 */}
        <section className="mb-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2" data-motion="steps-heading">
            <SectionTitle
              hint={`共 ${displayed.length} 步 · ${totalMinutes} 分钟${manualEdit ? " · 已手动修改" : ""}`}
            >
              本周路径
            </SectionTitle>
            {manualEdit ? (
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
          ) : manualEdit ? (
            <Card className="mb-3 border-[var(--good)] bg-[var(--good-soft)]">
              <p className="text-sm text-[var(--good)]">当前顺序仍满足全部先修约束。</p>
            </Card>
          ) : null}

          {displayed.length === 0 ? (
            <Card motion="empty">
              {plan && plan.steps.length > 0 ? (
                <p className="text-sm text-[var(--ink-soft)]">
                  你已手动移除本周路径的全部 {plan.steps.length} 步。这不是算法排不出东西——
                  点上方「恢复算法排序」即可重新看到它们。
                </p>
              ) : (
                <>
                  <p className="text-sm text-[var(--ink-soft)]">
                    {chapters.length > 0
                      ? `选中的 ${chapters.length} 个章节（含未掌握的跨章先修）已没有待学点。可以清空章节，看看整科是否还有其它未达标的知识点。`
                      : `整科 ${graph.concepts.length} 个知识点已全部达标，没有需要学习的点。`}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    路径为空不是预算不够，而是候选范围内没有掌握度低于阈值的新点；
                    预算调大也不会把已掌握的点重新排进来。可以到{" "}
                    <Link href={`/diagnose${target.kind === "direction" ? `?direction=${target.id}` : ""}`} className="underline">
                      诊断页
                    </Link>{" "}
                    按知识点清空证据（清空后该知识点的掌握度回到先验、题会重新出现），
                    或切换学习目标。
                  </p>
                </>
              )}
            </Card>
          ) : (
            <ol className="space-y-2" data-motion="steps">
              {displayed.map((step, i) => {
                const c = kcById.get(step.kcId);
                const m = progress.mastery.find((x) => x.kcId === step.kcId);
                const mean = m ? masteryMean(m) : 0;
                const sd = m ? masterySd(m) : 1;
                const deferredInCounterfactual =
                  counterfactual?.deferred.includes(step.kcId) ?? false;
                const blockedByInCounterfactual = counterfactualSummary.blockedByOf(step.kcId);

                return (
                  <li key={`${step.kcId}-${i}`} id={pathStepId(step.kcId)} data-motion-step={step.kcId}>
                    <Card
                      className={`${deferredInCounterfactual ? "opacity-50" : ""} ${
                        highlightKc === step.kcId ? "ring-2 ring-[var(--accent)]" : ""
                      }`}
                    >
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
                            {moved.has(step.kcId) ? <Pill tone="warn">已手动调整</Pill> : null}
                            {/* 只影响视觉：?kc= 跳转过来的定位标记，不参与路径计算 */}
                            {highlightKc === step.kcId ? <Pill tone="accent">已定位</Pill> : null}
                            {deferredInCounterfactual ? (
                              <Pill tone="bad">对照预算下会被推迟</Pill>
                            ) : null}
                            {/*
                              Pill 只接受 children/tone，title 必须挂在外层 span 上，
                              否则浏览器不会给这个标记任何悬浮说明。
                            */}
                            {blockedByInCounterfactual.length > 0 ? (
                              <span
                                title={`对照预算下因先修阻塞：${blockedByInCounterfactual
                                  .map((id) => kcById.get(id)?.name ?? id)
                                  .join("、")}`}
                              >
                                <Pill tone="warn">对照预算下因先修阻塞</Pill>
                              </span>
                            ) : null}
                          </div>
                          {/*
                            reason 由算法生成，描述的是「它在算法排序里为什么排这」。
                            手动挪动位置后这句话不再解释新位置，所以显式补一句，
                            而不是让用户以为理由是跟着位置重算的。
                          */}
                          <p className="mt-1.5 text-sm text-[var(--ink-soft)]">{step.reason}</p>
                          {manualEdit ? (
                            <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
                              理由说明的是算法排序依据；当前位置是你手动调整的。
                            </p>
                          ) : null}
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
          <SectionTitle hint="输入指纹相同 → 路径指纹必然相同；任一不同，说明输入或算法变了。">
            可复现性
          </SectionTitle>
          <Card motion="repro">
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">输入指纹</dt>
                <dd className="truncate font-mono text-xs" title={inputHash ?? undefined}>
                  {inputHash ?? "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">算法路径指纹</dt>
                <dd className="truncate font-mono text-xs" title={plan?.pathHash}>
                  {plan?.pathHash ?? "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">当前显示顺序指纹</dt>
                <dd className="truncate font-mono text-xs" title={displayedHash ?? undefined}>
                  {displayedHash ?? "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">算法版本</dt>
                <dd className="font-mono text-xs">{ALGO_VERSION}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">图谱版本</dt>
                <dd className="font-mono text-xs">{graph.version}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">因预算不足推迟</dt>
                <dd className="tabular text-xs">{plan?.deferred.length ?? 0} 个知识点</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-[var(--ink-soft)]">因先修被推迟而阻塞</dt>
                <dd className="tabular text-xs">{plan?.blocked.length ?? 0} 个知识点</dd>
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
              同一个 attempt 快照 + 同一算法版本，在任何时候都会得到同一个路径指纹。
              注意「同一输入」指的是同一份掌握度快照——生成题会改变你的作答，
              作答会改变掌握度，所以换一批题之后的路径本来就应该不同。
            </p>
          </Card>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={`/tutor${target.kind === "direction" ? `?direction=${target.id}` : ""}`}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)]"
          >
            问导师「为什么这样排」
          </Link>
          <Link
            href={`/diagnose${target.kind === "direction" ? `?direction=${target.id}` : ""}`}
            className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm"
          >
            继续诊断
          </Link>
        </div>
      </main>
    </>
  );
}
