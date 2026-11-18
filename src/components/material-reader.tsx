"use client";

/**
 * 诊断页的教材原文阅读模块。
 *
 * 数据口径在 kcMaterialReading.ts（纯函数）：与出题引用同源——
 * 同一个合并包（内置教材/讲义 + 我的笔记 + 上传资料）、同一份来源选择，
 * 未选中的来源不出现，避免「出题不用它、阅读却显示它」的错位。
 *
 * 按章节折叠分组，每章内按知识点列出片段。整体默认收起：
 * 阅读是辅助，不能把答题界面顶到第二屏。
 */

import { useId, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import type { KnowledgeConcept } from "@/lib/graph";
import type { MaterialPack, MaterialSelection } from "@/lib/materials";
import {
  hasReadingContent,
  kcReadingViews,
  type KcReadingView,
} from "@/lib/kcMaterialReading";

export interface MaterialReaderProps {
  readonly pack: MaterialPack;
  readonly concepts: readonly KnowledgeConcept[];
  readonly selection: MaterialSelection;
  readonly className?: string;
  readonly variant?: "card" | "workbench";
  readonly onAsk?: (text: string, source: string) => void;
}

export function MaterialReader({
  pack,
  concepts,
  selection,
  className = "",
  variant = "card",
  onAsk,
}: MaterialReaderProps) {
  const [openChapter, setOpenChapter] = useState<string | null>(null);
  const chapterId = useId();

  const views = useMemo(
    () => kcReadingViews(pack, concepts, selection),
    [pack, concepts, selection],
  );

  if (!hasReadingContent(views)) return variant === "workbench" ? <div className="py-8 text-sm leading-relaxed text-[var(--ink-soft)]"><Icon name="book" size={28} className="mb-4 text-[var(--accent)]" /><p>当前选中的资料中还没有可阅读的原文。</p><p className="mt-2 text-xs text-[var(--ink-faint)]">在「我的资料」上传教材，或在学习设置中切换资料来源。</p></div> : null;

  const readableViews = views.filter((view: KcReadingView) => view.withContentCount > 0);
  const totalEntries = readableViews.reduce((sum, v) => sum + v.withContentCount, 0);
  const activeChapter = readableViews.find(view => view.chapter === openChapter) ?? readableViews[0];

  if (variant === "workbench") return <section aria-label="教材原文" className="workbench-reader">
    <label htmlFor={chapterId} className="mb-2 block text-xs text-[var(--ink-faint)]">阅读章节 · 共 {readableViews.length} 章</label>
    <select id={chapterId} value={activeChapter.chapter} onChange={event => setOpenChapter(event.target.value)} className="mb-6 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm">{readableViews.map(view => <option key={view.chapter} value={view.chapter}>{view.chapter}</option>)}</select>
    <div className="space-y-8">{activeChapter.items.filter(item => item.hasContent).map(item => <article key={item.kcId}>
      <h2 className="text-lg font-semibold">{item.kcName}</h2>
      {item.entries.map((entry, index) => <div key={`${item.kcId}-${index}`} className="mt-3">
        <p className="text-[11px] leading-relaxed text-[var(--ink-faint)]">{entry.label}</p>
        <p className="mt-3 whitespace-pre-wrap wrap-anywhere text-[var(--ink)]">{entry.text}</p>
        {onAsk ? <button type="button" data-material-ask onClick={() => onAsk(entry.text, entry.label)} className="mt-3 inline-flex items-center gap-2 text-xs text-[var(--accent)] underline underline-offset-4"><Icon name="chat" size={15} />围绕这段提问</button> : null}
      </div>)}
    </article>)}</div>
  </section>;

  return (
    <section
      aria-label="教材原文"
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">教材原文</h2>
        <span className="text-xs text-[var(--ink-soft)]">
          {readableViews.length} 章 · {totalEntries} 段（当前口径选中来源）
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">
        阅读课程原文，提问和练习时可按同一出处核对。
        注意教材与课堂讲义可能使用不同的页码或符号约定。
      </p>

      <ul className="mt-3 space-y-2">
        {readableViews.map((view) => {
          const open = openChapter === view.chapter;
          return (
            <li key={view.chapter} className="rounded-lg border border-[var(--line)]">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenChapter(open ? null : view.chapter)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--line)]"
              >
                <span className="min-w-0 font-medium">{view.chapter}</span>
                <span className="shrink-0 text-xs text-[var(--ink-faint)]">
                  {view.withContentCount} 个知识点有原文 {open ? "▾" : "▸"}
                </span>
              </button>

              {open ? (
                <div className="space-y-3 border-t border-[var(--line)] px-3 py-3">
                  {view.items.map((item) => (
                    <div key={item.kcId}>
                      <p className="text-sm font-medium">
                        {item.kcName}
                        {item.chapter !== "" ? (
                          <span className="ml-2 text-xs font-normal text-[var(--ink-faint)]">
                            {item.chapter}
                          </span>
                        ) : null}
                      </p>
                      {item.hasContent ? (
                        <ul className="mt-1.5 space-y-2">
                          {item.entries.map((entry, index) => (
                            <li
                              key={`${item.kcId}-${index}`}
                              className="rounded-md bg-[var(--canvas)] px-3 py-2"
                            >
                              <p className="text-xs text-[var(--ink-faint)]">{entry.label}</p>
                              <p className="mt-0.5 whitespace-pre-wrap wrap-anywhere text-xs leading-relaxed text-[var(--ink-soft)]">
                                {entry.text}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-[var(--ink-faint)]">
                          暂无原文：当前口径选中的来源没有覆盖这个知识点，出题将回退模型通用知识（不编造页码）。
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
