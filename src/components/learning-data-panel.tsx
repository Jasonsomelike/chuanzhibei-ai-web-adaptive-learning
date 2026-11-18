"use client";

/**
 * 设置 · 学习数据面板：作答证据回顾与路径可复现性指纹。
 *
 * 与学习路径页同源同参：同一目标、同一章节口径（共用 localStorage 里的
 * 章节选择）、按路径页默认 60 分钟预算重算，因此这里的指纹与路径页的
 * 算法指纹一致（路径页手动调整过的「当前显示顺序指纹」是其局部状态，不在此页）。
 * 只读展示：调整章节与预算请回学习路径页。
 */

import { useMemo, useState } from "react";
import { useSubject } from "@/lib/subject";
import { useLearner } from "@/lib/useLearner";import { chapterScope, readChapterSelection } from "@/lib/chapters";
import { planPath, computeInputHash, ALGO_VERSION } from "@/lib/plan";
import { useLearningTime } from "@/lib/useLearningTime";
import { LearningTimeNote } from "@/components/learning-time-note";
import { LearningEvidence } from "@/components/learning-evidence";
import { TargetPicker } from "@/components/target-picker";

/** 未加载完成时的共享空选择：字面量 [] 每次渲染都是新引用，会让下游 useMemo 失效。 */
const EMPTY_CHAPTERS: readonly string[] = [];

export function LearningDataPanel() {
  const { target, targetId, setTargetId, ready, targetError } = useSubject();
  const { learner, ready: learnerReady, progress, synced } = useLearner(targetId, target?.graph);
  /** 与学习路径页的默认预算一致；路径页的临时预算调整不进设置。 */
  const budget = 60;
  const timing=useLearningTime(targetId,target?.graph,progress);

  // 章节口径：与学习路径页共用同一份 localStorage 选择。
  // target 挂载后才出现（subject hook 在客户端读取），此时在渲染期同步一次选择；
  // SSR 与 hydration 期间 target 为空，两侧渲染一致。
  const [chapterState, setChapterState] = useState<{ readonly id: string; readonly value: readonly string[] }>({ id: "", value: [] });
  if (target && chapterState.id !== targetId) {
    setChapterState({ id: targetId, value: readChapterSelection(targetId) });
  }
  const chapters = target && chapterState.id === targetId ? chapterState.value : EMPTY_CHAPTERS;

  const scope = useMemo(
    () => (target?.graph ? chapterScope(target.graph, chapters) : null),
    [target, chapters],
  );
  const wholeSubject =
    scope !== null && target?.graph !== undefined && scope.targets.length === target.graph.concepts.length;
  const chapterTargets =
    scope && scope.targets.length > 0 && !wholeSubject ? scope.targets : undefined;

  const plan = useMemo(() => {
    if (!target?.graph || !progress) return null;
    return planPath({
      graph: target.graph,
      mastery: progress.mastery,
      budgetMinutes: budget,
      targets: chapterTargets,
      timeEstimates:timing.estimates,
    });
  }, [target, progress, chapterTargets,timing.estimates]);

  const inputHash = useMemo(() => {
    if (!target?.graph || !progress) return null;
    return computeInputHash({
      graph: target.graph,
      mastery: progress.mastery,
      budgetMinutes: budget,
      targets: chapterTargets,
      timeEstimates:timing.estimates,
    });
  }, [target, progress, chapterTargets,timing.estimates]);

  if (!ready || !learnerReady || !learner || !progress || !target) {
    return (
      <p className="text-sm text-[var(--ink-soft)]" aria-busy="true">
        正在读取学习数据…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">学习数据 · 证据与可复现</h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
          当前目标「{target.name}」的作答证据、路径变化原因与算法指纹；按学习路径页默认
          {" "}{budget} 分钟预算与同一份章节口径重算。只读展示，调整章节与预算请回学习路径页。
        </p>
        <div className="mt-3 max-w-sm">
          <TargetPicker current={targetId} onChange={setTargetId} presentation="select" currentName={target.name} />
        </div>
      </div>

      {targetError !== null ? (
        <p role="alert" className="text-xs text-[var(--bad)]">{targetError}</p>
      ) : null}

      <LearningTimeNote timing={timing}/>
      <LearningEvidence timeEstimates={timing.estimates} graph={target.graph} progress={progress} budgetMinutes={budget} />

      <div className="rounded-xl border border-[var(--line)] p-4" data-technical-details>
        <p className="text-sm font-medium">技术详情 · 可复现性</p>
        <dl className="mt-3 space-y-2 text-sm">
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
            <dt className="text-[var(--ink-soft)]">算法版本</dt>
            <dd className="font-mono text-xs">{ALGO_VERSION}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--ink-soft)]">图谱版本</dt>
            <dd className="font-mono text-xs">{target.graph.version}</dd>
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
            <dd className="text-xs">{synced ? "账号（跨设备同步）" : "本浏览器"}</dd>
          </div>
        </dl>
        <p className="mt-3 border-t border-[var(--line)] pt-3 text-xs leading-relaxed text-[var(--ink-faint)]">
          指纹不含任何模型标识：路径与用哪个大模型无关。
          同一个 attempt 快照 + 同一算法版本，在任何时候都会得到同一个路径指纹。
          注意「同一输入」指的是同一份掌握度快照——生成题会改变你的作答，
          作答会改变掌握度，所以换一批题之后的路径本来就应该不同。
        </p>
      </div>
    </div>
  );
}
