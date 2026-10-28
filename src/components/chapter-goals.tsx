"use client";

/**
 * 路径页的章节范围选择。
 *
 * 章节只收窄 planPath 的 targets，不裁剪图谱：跨章先修点必须留在候选集里，
 * 否则严格先修校验会把整条路径判成违规（见 chapters.ts 的 chapterScope）。
 */

import { Card } from "@/components/ui";
import { chaptersOf, type ChapterScope } from "@/lib/chapters";
import type { LearningTarget } from "@/lib/target";

export function ChapterGoals({
  target,
  selected,
  scope,
  budgetMinutes,
  plannedSteps,
  onChange,
}: {
  target: LearningTarget;
  selected: readonly string[];
  /** 由页面按同一份选中章名算出，保证汇总与 planPath 的 targets 同源。 */
  scope: ChapterScope;
  budgetMinutes: number;
  /** 当前预算下 planPath 真正排入的步数，不是候选范围大小。 */
  plannedSteps: number;
  onChange: (next: readonly string[]) => void;
}) {
  // 自定义方向没有教材章节，范围就是整个方向；页面另有说明，这里不渲染选择器
  if (target.kind === "direction") return null;

  const chapters = chaptersOf(target.graph);
  const selectedSet = new Set(selected);
  const allSelected = chapters.length > 0 && chapters.every((c) => selectedSet.has(c.name));
  const totalConcepts = target.graph.concepts.length;

  const toggle = (name: string) => {
    onChange(
      selectedSet.has(name) ? selected.filter((n) => n !== name) : [...selected, name],
    );
  };

  return (
    <Card className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">教材章节</p>
          <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
            可多选；一章也不选 = 整科。选中章节会自动带上未掌握的跨章先修点，
            所以选第 5 章也可能看到第 1–4 章的点。
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onChange(chapters.map((c) => c.name))}
            disabled={allSelected}
            className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs disabled:opacity-40"
          >
            全选
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={selected.length === 0}
            className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-xs disabled:opacity-40"
          >
            清空
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {chapters.map((chapter) => {
          const active = selectedSet.has(chapter.name);
          return (
            <button
              key={chapter.name}
              type="button"
              onClick={() => toggle(chapter.name)}
              aria-pressed={active}
              aria-label={`${active ? "取消" : "选择"}「${chapter.name}」，${chapter.count} 个知识点`}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-[var(--accent)] text-[var(--on-accent)]"
                  : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
              }`}
            >
              {chapter.name}
              <span className="tabular ml-1.5 text-xs opacity-70">{chapter.count} 点</span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 border-t border-[var(--line)] pt-3 text-sm text-[var(--ink-soft)]">
        {selected.length === 0 ? (
          <>
            未选章节 = 整科 {totalConcepts} 个知识点 · 当前预算 {budgetMinutes} 分钟排入{" "}
            <span className="tabular font-medium text-[var(--ink)]">{plannedSteps}</span> 步。
          </>
        ) : allSelected ? (
          <>
            {chapters.length} 章全选 = 整科 {totalConcepts} 个知识点 · 当前预算 {budgetMinutes}{" "}
            分钟排入 <span className="tabular font-medium text-[var(--ink)]">{plannedSteps}</span>{" "}
            步。
          </>
        ) : (
          <>
            候选 <span className="tabular font-medium text-[var(--ink)]">{scope.scopeSize}</span>{" "}
            个知识点（含{" "}
            <span className="tabular font-medium text-[var(--ink)]">
              {scope.prerequisiteExtra.length}
            </span>{" "}
            个先修点）· 当前预算排入{" "}
            <span className="tabular font-medium text-[var(--ink)]">{plannedSteps}</span> 步。
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-[var(--ink-faint)]">
        候选范围由「选中章节 + 先修闭包」决定，预算只决定其中排入几步——两者不是一回事。
      </p>
    </Card>
  );
}
