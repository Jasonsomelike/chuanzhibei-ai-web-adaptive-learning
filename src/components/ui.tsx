/**
 * 界面共用的展示组件。刻意保持小而直白，不做过度抽象。
 */

import Link from "next/link";
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 ${className}`}
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
      {hint ? (
        <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{hint}</p>
      ) : null}
    </div>
  );
}

/** 掌握度条。同时显示点估计与不确定度——这是本项目与普通进度条的区别。 */
export function MasteryBar({
  mean,
  sd,
  evidenceN,
  label,
}: {
  mean: number;
  sd: number;
  evidenceN: number;
  label?: string;
}) {
  const pct = Math.round(mean * 100);
  const margin = Math.round(sd * 100);
  // 不确定度区间：均值 ± 一个标准差
  const low = Math.max(0, Math.round((mean - sd) * 100));
  const high = Math.min(100, Math.round((mean + sd) * 100));

  return (
    <div>
      {label ? (
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span className="text-[var(--color-ink-soft)]">{label}</span>
          <span className="tabular text-[var(--color-ink)]">
            {evidenceN === 0 ? "未测评" : `${pct}% ±${margin}`}
          </span>
        </div>
      ) : null}
      <div
        className="relative h-2 overflow-hidden rounded-full bg-[var(--color-line)]"
        role="img"
        aria-label={
          evidenceN === 0
            ? "尚未测评"
            : `掌握度 ${pct}%，不确定区间 ${low}% 到 ${high}%`
        }
      >
        {/* 不确定区间用浅色铺底，点估计用实色覆盖 */}
        <div
          className="absolute inset-y-0 bg-[var(--color-accent-soft)]"
          style={{ left: `${low}%`, width: `${Math.max(0, high - low)}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-[var(--color-accent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
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
    neutral:
      "bg-[var(--color-line)] text-[var(--color-ink-soft)]",
    good: "bg-[var(--color-good-soft)] text-[var(--color-good)]",
    warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
    bad: "bg-[var(--color-bad-soft)] text-[var(--color-bad)]",
    accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
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
      ? "bg-[var(--color-accent)] text-white hover:opacity-90"
      : "border border-[var(--color-line)] text-[var(--color-ink)] hover:bg-[var(--color-line)]";
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-opacity ${styles}`}
    >
      {children}
    </Link>
  );
}

/** 顶部导航。保持极简：三个入口，不堆功能。 */
export function Nav() {
  return (
    <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--color-accent)] text-xs text-white">
            路
          </span>
          <span className="hidden sm:inline">可解释的自适应学习路径</span>
          <span className="sm:hidden">学习路径</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/diagnose"
            className="rounded-md px-3 py-1.5 text-[var(--color-ink-soft)] hover:bg-[var(--color-line)] hover:text-[var(--color-ink)]"
          >
            诊断
          </Link>
          <Link
            href="/path"
            className="rounded-md px-3 py-1.5 text-[var(--color-ink-soft)] hover:bg-[var(--color-line)] hover:text-[var(--color-ink)]"
          >
            路径
          </Link>
          <Link
            href="/tutor"
            className="rounded-md px-3 py-1.5 text-[var(--color-ink-soft)] hover:bg-[var(--color-line)] hover:text-[var(--color-ink)]"
          >
            导师
          </Link>
        </nav>
      </div>
    </header>
  );
}
