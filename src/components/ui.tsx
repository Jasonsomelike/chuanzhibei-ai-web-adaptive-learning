/**
 * 界面共用的展示组件。刻意保持小而直白，不做过度抽象。
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { NavLinks } from "@/components/nav-links";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {hint ? <p className="mt-1 text-sm text-[var(--ink-soft)]">{hint}</p> : null}
    </div>
  );
}

/**
 * 掌握度条。同时显示点估计与不确定度——这是本项目与普通进度条的区别。
 *
 * probabilityAbove 是 P(真实掌握度 > 阈值)，与 sd 含义不同：
 * sd 是「我们有多不确定」，P 是「达标有多可能」。两者都显示，
 * 因为它们回答的问题不一样（精度 vs 决策）。
 *
 * evidenceShortfall 描述「为什么证据不算充分」，两种原因要分开说：
 *   count —— 题目数量不够（还能继续测）
 *   precision —— 题数够了但 sd 仍 > 0.20（对错分裂，题库可能已经出完）
 * 混成一句「未达 N 题门槛」会在 n 已经等于 N 时自相矛盾。
 */
export function MasteryBar({
  mean,
  sd,
  evidenceN,
  label,
  probabilityAbove,
  evidenceShortfall,
  evidenceTarget,
}: {
  mean: number;
  sd: number;
  evidenceN: number;
  label?: string;
  probabilityAbove?: number;
  /** 证据不足的原因；null/undefined 表示已充分。 */
  evidenceShortfall?: "count" | "precision" | null;
  /** 条数不足时的门槛值，用于文案。 */
  evidenceTarget?: number;
}) {
  const pct = Math.round(mean * 100);
  const margin = Math.round(sd * 100);
  const low = Math.max(0, Math.round((mean - sd) * 100));
  const high = Math.min(100, Math.round((mean + sd) * 100));

  return (
    <div>
      {label ? (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
          <span className="text-[var(--ink-soft)]">{label}</span>
          <span className="tabular shrink-0 text-[var(--ink)]">
            {evidenceN === 0 ? "未测评" : `${pct}% ±${margin}`}
          </span>
        </div>
      ) : null}
      {/*
        进度条是「非文本元素」，填充与轨道之间需 ≥3:1（SC 1.4.11）。
        用 accent 实色 + accent-soft 区间 + line 轨道，三层可区分。
      */}
      <div
        className="relative h-2 overflow-hidden rounded-full bg-[var(--line)]"
        role="img"
        aria-label={
          evidenceN === 0
            ? "尚未测评"
            : `掌握度 ${pct}%，不确定区间 ${low}% 到 ${high}%`
        }
      >
        <div
          className="absolute inset-y-0 bg-[var(--accent-soft)]"
          style={{ left: `${low}%`, width: `${Math.max(0, high - low)}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-[var(--accent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      {evidenceN > 0 ? (
        <p className="mt-1 text-xs text-[var(--ink-faint)]">
          {probabilityAbove !== undefined
            ? `P(已掌握) = ${Math.round(probabilityAbove * 100)}%`
            : null}
          {evidenceShortfall === "count" ? (
            <span className="ml-2 text-[var(--warn)]">
              已测 {evidenceN} 题
              {evidenceTarget ? `，未达 ${evidenceTarget} 题门槛` : ""}，掌握度仅供参考
            </span>
          ) : evidenceShortfall === "precision" ? (
            <span className="ml-2 text-[var(--warn)]">
              已测 {evidenceN} 题，题数够了但答案对错分裂，不确定度仍偏大（±
              {Math.round(sd * 100)}），掌握度仅供参考
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "accent";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-[var(--line)] text-[var(--ink-soft)]",
    good: "bg-[var(--good-soft)] text-[var(--good)]",
    warn: "bg-[var(--warn-soft)] text-[var(--warn)]",
    bad: "bg-[var(--bad-soft)] text-[var(--bad)]",
    accent: "bg-[var(--accent-soft)] text-[var(--accent)]",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
}) {
  const styles =
    variant === "primary"
      ? "bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90"
      : "border border-[var(--line-strong)] text-[var(--ink)] hover:bg-[var(--line)]";
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-opacity ${styles}`}
    >
      {children}
    </Link>
  );
}

/**
 * 顶部导航。
 *
 * 链接与登录态在 NavLinks 里（客户端组件），因为要根据登录状态渲染。
 * 这个外层保持服务端组件，避免整页变成客户端。
 */
export function Nav() {
  return (
    <header className="border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--accent)] text-xs text-[var(--on-accent)]">
            路
          </span>
          <span className="hidden sm:inline">可解释的自适应学习路径</span>
          <span className="sm:hidden">学习路径</span>
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
