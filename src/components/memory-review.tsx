"use client";

/**
 * 记忆复习区：只显示到期的错题 / 易混卡。
 *
 * 复习自评只调整复习计划（lastSeenAt / streak / status），不调用 recordAttempt，
 * 因此不会改动掌握度的 α/β。页面通过 onReview 把更新组合进一次 setLearner。
 */

import { useId, useMemo, useState } from "react";
import {
  dueAt,
  dueMemories,
  memoryStats,
  type MemoryItem,
} from "@/lib/memory";

export interface MemoryReviewProps {
  /** 该目标的全部记忆卡（含未到期与已解决）。 */
  readonly memories: readonly MemoryItem[];
  /** 当前时间（ISO）。由页面传入，组件本身不读时钟。 */
  readonly now: string;
  /** 知识点名称查询，用于把 kcId 显示成人能读的名字。 */
  readonly kcName?: (kcId: string) => string;
  /** 自评「记住了 / 没记住」。页面负责调用 reviewMemory 并写回。 */
  readonly onReview: (id: string, remembered: boolean) => void;
  readonly className?: string;
}

/**
 * 一句话统计；没有记忆卡时返回空串，调用方据此整块省略。
 */
export function memoryReviewSummary(
  memories: readonly MemoryItem[],
  now: string,
): string {
  const stats = memoryStats(memories, now);
  if (stats.open + stats.resolved === 0) return "";

  const parts = [`记忆卡 ${stats.open} 张未解决`];
  parts.push(stats.due > 0 ? `其中 ${stats.due} 张已到期` : "目前没有到期卡片");
  if (stats.resolved > 0) parts.push(`已解决 ${stats.resolved} 张`);
  return parts.join(" · ");
}

/** 最近一张 open 卡片的到期时间；没有时返回 null。 */
export function nextDueAt(memories: readonly MemoryItem[]): string | null {
  let best: string | null = null;
  for (const item of memories) {
    const at = dueAt(item);
    if (at === null) continue;
    if (best === null || at < best) best = at;
  }
  return best;
}

export function memoryKindLabel(item: MemoryItem): string {
  return item.kind === "confusion" ? "易混" : "错题";
}

/**
 * 卡片背面的答案文本。
 *
 * 易混卡允许只写「和谁混了」而不写区别（标记时用户可能还没想清楚），
 * 这时给一句可执行的提示，而不是显示一片空白。
 */
export function memoryAnswerText(item: MemoryItem): string {
  const correction = item.correction.trim();
  if (correction !== "") return correction;
  return item.kind === "confusion"
    ? "还没有填写两者的区别，可对照这两个知识点各写一句定义再复习。"
    : "还没有可展示的解析。";
}

/** 只显示日期部分：跨设备/时区渲染一致，也避免把时间戳原样丢给用户。 */
export function formatDueDate(iso: string): string {
  return iso.slice(0, 10);
}

export function MemoryReview({
  memories,
  now,
  kcName,
  onReview,
  className = "",
}: MemoryReviewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  /** 卡片折叠状态：默认收起，标题与统计始终可见，展开看到期卡列表。 */
  const [collapsed, setCollapsed] = useState(true);
  const bodyId = useId();
  const due = useMemo(() => dueMemories(memories, now), [memories, now]);
  const summary = memoryReviewSummary(memories, now);

  if (summary === "") return null;

  const label = (kcId: string): string => kcName?.(kcId) ?? kcId;
  const nextAt = nextDueAt(memories);

  return (
    <section
      id="memory-review"
      aria-label="记忆复习"
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 ${className}`}
    >
      <h2 className="text-lg font-semibold tracking-tight">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(value => !value)}
          className="cursor-interaction flex items-center gap-1.5 rounded-md text-left"
        >
          记忆复习
          <span
            aria-hidden="true"
            className={`text-base leading-none text-[var(--ink-faint)] transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
          >
            ▾
          </span>
        </button>
      </h2>
      <p className="mt-1.5 text-xs text-[var(--ink-soft)]">{summary}</p>

      {!collapsed ? (
        <>
      {due.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          {nextAt === null
            ? "全部记忆卡都已解决。"
            : `目前没有到期卡片；最近一张将在 ${formatDueDate(nextAt)} 到期。`}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {due.map((item) => {
            const revealed = openId === item.id;
            return (
              <li
                key={item.id}
                className="rounded-lg border border-[var(--line)] px-3 py-2.5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--ink-faint)]">
                  <span>
                    {memoryKindLabel(item)} · {label(item.kcId)}
                    {item.kind === "confusion" && item.withKcId !== undefined
                      ? ` ↔ ${label(item.withKcId)}`
                      : ""}
                  </span>
                  <span>
                    复习 {item.reviewCount} 次 · 连续记住 {item.streak}/4
                  </span>
                </div>

                <p className="mt-1 text-sm leading-relaxed">{item.prompt}</p>
                {item.chosen !== undefined && item.chosen !== "" ? (
                  <p className="mt-1 text-xs text-[var(--bad)]">你选了：{item.chosen}</p>
                ) : null}

                {revealed ? (
                  <div className="mt-2 rounded-lg bg-[var(--canvas)] p-3 text-sm">
                    <p className="whitespace-pre-wrap wrap-anywhere leading-relaxed">
                      {memoryAnswerText(item)}
                    </p>
                    {item.note !== undefined && item.note !== "" ? (
                      <p className="mt-1 text-xs text-[var(--ink-soft)]">备注：{item.note}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onReview(item.id, true);
                          setOpenId(null);
                        }}
                        className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--on-accent)]"
                      >
                        记住了
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onReview(item.id, false);
                          setOpenId(null);
                        }}
                        className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
                      >
                        没记住
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpenId(item.id)}
                    className="mt-2 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
                  >
                    显示答案
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-[var(--ink-faint)]">
        复习自评只调整下次到期时间，不计入掌握度（α/β 不变）。
      </p>
        </>
      ) : null}
    </section>
  );
}
