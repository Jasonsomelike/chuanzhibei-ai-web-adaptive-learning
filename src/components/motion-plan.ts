/**
 * 动效参数与判定：纯数据 + 纯函数，不 import gsap / React。
 *
 * 为什么单独拆一份：vitest 跑在 node 环境（vitest.config.ts:7），直接 import
 * 带 gsap 的模块会把浏览器分支拉进测试进程。这里只放可以离线断言的部分——
 * 时长与间隔是否在约定区间、减少动态效果时是否一律不播、动画属性是否只有
 * transform 与 opacity——motion.tsx 与测试共用同一份常量，避免两边各自写一遍。
 *
 * 约定（任务书 / ADR 2026-10-30 §9 的收窄版）：
 * - 入场时长 0.25–0.4s，卡片间隔 0.04–0.08s；
 * - 只动 transform（x/y/scale）与 opacity，不动颜色、尺寸、布局；
 * - 不做滚动劫持 / parallax / 逐字打字机 / 无限循环；
 * - prefers-reduced-motion 命中时全部跳过，直接停在终态。
 */

/** 只有用户没有要求「减少动态效果」时才建动画。 */
export const MOTION_QUERY = "(prefers-reduced-motion: no-preference)";

/** 用户要求减少动态效果。 */
export const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** 入场参数允许区间；planEntrance 会把越界值夹回来。 */
export const ENTRANCE_RANGE = {
  minDuration: 0.25,
  maxDuration: 0.4,
  minStagger: 0.04,
  maxStagger: 0.08,
} as const;

export const DEFAULT_ENTRANCE = {
  duration: 0.3,
  stagger: 0.055,
  distance: 10,
  ease: "power2.out",
} as const;

/** 题卡切换 / 分区切换：比入场略短，避免每次切换都像换页。 */
export const DEFAULT_APPEAR = {
  duration: 0.28,
  distance: 8,
  fromOpacity: 0.6,
  ease: "power2.out",
} as const;

/** 路径步骤定位：只做一次轻微缩放，到位后回到 1，不改变尺寸。 */
export const DEFAULT_HIGHLIGHT = {
  duration: 0.34,
  scaleFrom: 0.985,
  ease: "power2.out",
} as const;

/** 市场卡片 hover：2px 抬升，移出即回落。 */
export const DEFAULT_HOVER = {
  duration: 0.18,
  lift: -2,
  ease: "power2.out",
} as const;

/** 允许被动画的属性白名单；测试据此断言「只动 transform 与 opacity」。 */
export const MOTION_PROPERTIES = ["opacity", "x", "y", "scale"] as const;

export type MotionProperty = (typeof MOTION_PROPERTIES)[number];

export interface EntrancePlan {
  readonly from: { readonly opacity: number; readonly y: number };
  readonly to: { readonly opacity: number; readonly y: number };
  readonly duration: number;
  readonly stagger: number;
  readonly ease: string;
}

export interface AppearPlan {
  readonly from: { readonly opacity: number; readonly y: number };
  readonly to: { readonly opacity: number; readonly y: number };
  readonly duration: number;
  readonly ease: string;
}

export interface HighlightPlan {
  readonly from: { readonly scale: number };
  readonly to: { readonly scale: number };
  readonly duration: number;
  readonly ease: string;
}

export interface HoverPlan {
  readonly from: { readonly y: number };
  readonly to: { readonly y: number };
  readonly duration: number;
  readonly ease: string;
}

export interface EntranceOverrides {
  readonly duration?: number;
  readonly stagger?: number;
  readonly distance?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * 一组元素的入场参数。
 *
 * count 为 0 时返回 null：没有目标就不该建 timeline（也避免空 tween 的告警）。
 * 时长与间隔都被夹进约定区间，调用方传错值也不会破坏「0.25–0.4s / 0.04–0.08s」。
 */
export function planEntrance(count: number, overrides: EntranceOverrides = {}): EntrancePlan | null {
  if (count <= 0) return null;
  const duration = clamp(
    overrides.duration ?? DEFAULT_ENTRANCE.duration,
    ENTRANCE_RANGE.minDuration,
    ENTRANCE_RANGE.maxDuration,
  );
  const stagger = clamp(
    overrides.stagger ?? DEFAULT_ENTRANCE.stagger,
    ENTRANCE_RANGE.minStagger,
    ENTRANCE_RANGE.maxStagger,
  );
  const distance = overrides.distance ?? DEFAULT_ENTRANCE.distance;
  return {
    from: { opacity: 0, y: distance },
    to: { opacity: 1, y: 0 },
    duration,
    stagger,
    ease: DEFAULT_ENTRANCE.ease,
  };
}

/** 内容切换（诊断题卡、设置分区、登录模式）：淡入 + 8px 上移。 */
export function planAppear(): AppearPlan {
  return {
    from: { opacity: DEFAULT_APPEAR.fromOpacity, y: DEFAULT_APPEAR.distance },
    to: { opacity: 1, y: 0 },
    duration: DEFAULT_APPEAR.duration,
    ease: DEFAULT_APPEAR.ease,
  };
}

/** 路径步骤被定位时的一次性缩放脉冲；终态就是 scale 1。 */
export function planHighlight(): HighlightPlan {
  return {
    from: { scale: DEFAULT_HIGHLIGHT.scaleFrom },
    to: { scale: 1 },
    duration: DEFAULT_HIGHLIGHT.duration,
    ease: DEFAULT_HIGHLIGHT.ease,
  };
}

/** 市场卡片 hover 抬升与回落。 */
export function planHover(): HoverPlan {
  return {
    from: { y: 0 },
    to: { y: DEFAULT_HOVER.lift },
    duration: DEFAULT_HOVER.duration,
    ease: DEFAULT_HOVER.ease,
  };
}

export interface PlayContext {
  /** 系统「减少动态效果」是否开启。 */
  readonly reducedMotion: boolean;
  /** 该元素是否已经播过（同一节点只播一次，流式 patch 不重放）。 */
  readonly done?: boolean;
  /** 设备是否有 hover 能力；触摸设备不做悬停动效。 */
  readonly hoverCapable?: boolean;
}

/**
 * 是否允许播这个动效。
 *
 * 三处调用：入场（done 用来挡重播）、切换、hover。
 * 任何一条不满足都返回 false，调用方据此直接落到终态，不建 tween。
 */
export function shouldPlay(kind: "entrance" | "swap" | "hover", context: PlayContext): boolean {
  if (context.reducedMotion) return false;
  if (kind === "entrance" && context.done === true) return false;
  if (kind === "hover" && context.hoverCapable === false) return false;
  return true;
}
