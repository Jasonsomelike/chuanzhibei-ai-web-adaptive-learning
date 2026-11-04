"use client";

/**
 * 界面共用的展示组件。刻意保持小而直白，不做过度抽象。
 *
 * 本模块带 "use client"：折叠面板需要本地展开状态。
 * 其余组件无副作用，可以在服务端组件里直接使用。
 */

import Link from "next/link";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { NavLinks } from "@/components/nav-links";
import { BrandMark } from "@/components/brand-mark";

/* ── 表单与设置页的排版原语 ───────────────────────────────── */

/**
 * 轻量分组容器。
 *
 * 设置页刻意不用「每块一张同样重的卡片」：分组之间靠间距 + 顶部细线分层，
 * 只有真正需要独立边界的内容（账号配置、结果报告）才套 Panel。
 */
export function SettingsGroup({
  title,
  hint,
  children,
  className = "",
}: {
  title?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border-t border-[var(--line)] pt-5 first:border-t-0 first:pt-0 ${className}`}
    >
      {title !== undefined || hint !== undefined ? (
        <div className="mb-3 max-w-[62ch]">
          {title !== undefined ? (
            <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          ) : null}
          {hint !== undefined ? (
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-faint)]">{hint}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * 设置页的一个分区：分区标题 + 一行用途说明。
 *
 * 说明只解释「这个分区决定什么」，不重复表单 hint；
 * 分区内部的层级交给 SettingsGroup。
 */
export function SettingsSection({
  title,
  hint,
  children,
}: {
  title: ReactNode;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="max-w-[62ch]">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--ink-soft)]">{hint}</p>
      </div>
      <div className="mt-5 space-y-6">{children}</div>
    </section>
  );
}

/** 比 Card 更轻的独立块：只描边、不铺底色，避免整页都是同一种卡片。 */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-[var(--line)] p-4 sm:p-5 ${className}`}>
      {children}
    </div>
  );
}

/* 输入框统一高度与描边；主题色一律走 CSS 变量。 */
export const inputClass =
  "w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm";

export const monoInputClass = `${inputClass} font-mono`;

/**
 * 表单行：Label 在上、输入在下、说明统一 12px 灰字并限制行宽。
 *
 * 不支持「左标签右输入」的硬排——窄屏会错位，长说明也会把输入挤成一条缝。
 */
export function FormRow({
  label,
  hint,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex h-full min-w-0 flex-col ${className}`}>
      <span className="block text-sm font-medium">{label}</span>
      {hint !== undefined ? (
        <span className="mt-0.5 block max-w-[52ch] text-xs leading-relaxed text-[var(--ink-faint)]">
          {hint}
        </span>
      ) : null}
      <span className="mt-auto block pt-2">{children}</span>
    </label>
  );
}

/** 只有语义成对的短字段才用两列；其余一律单列。 */
export function FormGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`grid gap-4 sm:grid-cols-2 ${className}`}>{children}</div>;
}

/** 低强调的危险操作：纯文字链接样式，不和主按钮并排抢注意力。 */
export function DangerButton({
  children,
  onClick,
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-1.5 py-1 text-xs font-medium text-[var(--bad)] underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * 折叠面板。
 *
 * 用 grid-template-rows 0fr → 1fr 做高度过渡：不需要测量高度，
 * 也不会在收起时留下可聚焦的隐形内容（inert + aria-hidden）。
 * prefers-reduced-motion 由 globals.css 统一把 transition 压到 0.01ms。
 */
export function Collapse({
  title,
  hint,
  children,
  defaultOpen = false,
  className = "",
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-md py-2 text-left text-sm text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
      >
        <span className="min-w-0">
          <span className="block font-medium">{title}</span>
          {hint !== undefined ? (
            <span className="mt-0.5 block max-w-[52ch] text-xs leading-relaxed text-[var(--ink-faint)]">
              {hint}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className={`shrink-0 text-base leading-none text-[var(--ink-faint)] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>
      <div
        id={panelId}
        inert={!open}
        aria-hidden={!open}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`pt-2 ${open ? "visible" : "invisible"}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Card({
  children,
  className = "",
  motion,
}: {
  children: ReactNode;
  className?: string;
  /** 动效标记：带这个属性的卡片会被 useStaggerIn 纳入一次性入场（见 motion.tsx）。 */
  motion?: string;
}) {
  return (
    <div
      data-motion={motion}
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
  motion,
}: {
  children: ReactNode;
  hint?: string;
  /** 动效标记：标题组参与入场 stagger。 */
  motion?: string;
}) {
  return (
    <div data-motion={motion} className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {hint ? <p className="mt-1 wrap-anywhere text-sm text-[var(--ink-soft)]">{hint}</p> : null}
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
 * 链接与登录态在 NavLinks 里，因为要根据登录状态渲染。
 * Nav 本身无状态，跟随本模块作为客户端组件渲染，不引入额外数据依赖。
 */
export function Nav() {
  return (
    <header className="border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
        <Link href="/" className="flex min-w-0 max-w-full items-center gap-2 font-semibold">
          <BrandMark size={28} className="shrink-0" />
          <span className="truncate">智慧学伴</span>
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
