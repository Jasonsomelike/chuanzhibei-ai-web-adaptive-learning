"use client";

/**
 * 全站动效的运行时：useStaggerIn（入场 / 追加内容）、useSwapIn（切换）、
 * useHoverLift（悬停抬升）与 <MotionScope>（服务端页面的一次性入口）。
 *
 * 约定：
 * - 只动 transform 与 opacity，参数来自 motion-plan.ts（有单测守着区间）；
 * - 每个元素只播一次：给节点打 data-motion-done，流式 patch 只改文本、
 *   不会产生新节点，因此不会重播；
 * - prefers-reduced-motion 命中时直接给节点打 done、不建 tween，终态由
 *   DOM 本身与 globals.css 里的 reduce 规则保证；
 * - 不注册 scroll 监听，不做滚动劫持 / parallax / 无限循环。
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { gsap } from "gsap";

import {
  REDUCE_QUERY,
  planAppear,
  planEntrance,
  planHighlight,
  planHover,
  shouldPlay,
} from "@/components/motion-plan";

/* 服务端没有 window，useLayoutEffect 会告警；客户端用 layout effect 在首帧前落位。 */
export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** 默认选择器：带 data-motion 且没有标 data-motion-manual 的节点（后者由专门 hook 接管）。 */
export const MOTION_SELECTOR = "[data-motion]:not([data-motion-manual])";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.dataset.reducedMotion === "true" || window.matchMedia(REDUCE_QUERY).matches;
}

function hasPlayed(element: HTMLElement): boolean {
  return element.dataset.motionDone === "1";
}

function markPlayed(element: HTMLElement): void {
  element.dataset.motionDone = "1";
}

/**
 * 入场与追加：把 root 里所有还没播过的 [data-motion] 元素组成一批，
 * 一次 fromTo（带 stagger）、每个 0.3s、间隔 0.055s 播完。
 *
 * 没有依赖数组是刻意的：列表是异步来的（方向市场、我的方向、导师消息），
 * 新节点可能在任意一次渲染后出现；每帧只做一次属性查询，已播过的节点
 * 直接跳过，因此不会重播，也不会在流式 patch 时新建 tween。
 */
export function useStaggerIn(
  rootRef: RefObject<HTMLElement | null>,
  selector: string = MOTION_SELECTOR,
): void {
  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    const fresh = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
      (element) => !hasPlayed(element),
    );
    if (fresh.length === 0) return;

    // 先落终态标记：reduce 用户与之后的渲染都不会再看到这批元素。
    for (const element of fresh) markPlayed(element);
    if (!shouldPlay("entrance", { reducedMotion: prefersReducedMotion() })) return;

    const plan = planEntrance(fresh.length);
    if (plan === null) return;

    const context = gsap.context(() => gsap.fromTo(fresh, plan.from, {
      ...plan.to,
      duration: plan.duration,
      stagger: plan.stagger,
      ease: plan.ease,
      overwrite: "auto",
    }), root);
    return () => context.revert();
  });
}

/**
 * 内容切换：trigger 变化时把 ref 指向的容器淡入 + 上移 8px。
 *
 * 首次挂载不播（由 useStaggerIn 负责页面入场），所以设置页切分区、
 * 登录页切登录/注册都只在用户操作时播一次。
 */
export function useSwapIn(
  ref: RefObject<HTMLElement | null>,
  trigger: string | number | null,
): void {
  const previousRef = useRef<string | number | null>(trigger);
  const mountedRef = useRef(false);

  useIsoLayoutEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      previousRef.current = trigger;
      return;
    }
    if (trigger === previousRef.current) return;

    const element = ref.current;
    /*
     * 目标还没挂载（首题在异步选题后才出现）时不消费这次触发：
     * 等下一次渲染元素到位后再播，否则第一次切换会被静默丢掉。
     */
    if (element === null) return;
    previousRef.current = trigger;
    if (!shouldPlay("swap", { reducedMotion: prefersReducedMotion() })) return;

    const plan = planAppear();
    const context = gsap.context(() => gsap.fromTo(element, plan.from, {
      ...plan.to,
      duration: plan.duration,
      ease: plan.ease,
      overwrite: "auto",
    }), element);
    return () => context.revert();
    /*
     * 不写依赖数组：目标可能比 trigger 晚一次渲染才挂载（首题异步选题、
     * 面板条件渲染），依赖数组会让「元素到位」这次渲染不再执行，
     * 首次切换就被静默丢掉。每帧只做一次 ref 读与字符串比较。
     */
  });
}

/**
 * 路径步骤定位：?kc= 命中的那一步做一次 0.985 → 1 的缩放脉冲。
 * 只按 data-motion-step 的值查找（KC id 里可能有「.」等字符，不用拼选择器）。
 */
export function useStepFlash(
  rootRef: RefObject<HTMLElement | null>,
  key: string | null,
): void {
  const previousRef = useRef<string | null>(key);

  useIsoLayoutEffect(() => {
    if (key === previousRef.current) return;
    if (key === null) {
      previousRef.current = null;
      return;
    }

    const root = rootRef.current;
    // ?kc= 在路径还没算出来时就设好了：等列表挂载后再消费这次触发。
    if (root === null) return;

    const element = Array.from(root.querySelectorAll<HTMLElement>("[data-motion-step]")).find(
      (candidate) => candidate.dataset.motionStep === key,
    );
    // 定位点不在当前路径里：不消费触发，用户把它改回路径后仍能闪一次。
    if (element === undefined) return;
    previousRef.current = key;
    if (!shouldPlay("swap", { reducedMotion: prefersReducedMotion() })) return;

    const plan = planHighlight();
    const context = gsap.context(() => gsap.fromTo(element, plan.from, {
      ...plan.to,
      duration: plan.duration,
      ease: plan.ease,
      overwrite: "auto",
    }), root);
    return () => context.revert();
    /*
     * 同样不写依赖数组：?kc= 在首屏由 effect 写入，而路径要等学习记录
     * 读完才渲染出步骤。依赖 key 的话，元素到位那次渲染不会再执行本 effect。
     * 已播过（previous === key）时第一行就返回，代价只是一次比较。
     */
  });
}

/**
 * 卡片悬停抬升：事件委托到 root，按 [data-motion-hover] 找目标。
 *
 * 只在「无减少动态效果」且设备有 hover 能力时挂监听；触摸设备与
 * reduced-motion 用户完全不注册，因此不会出现点按后卡片悬空。
 */
export function useHoverLift(
  rootRef: RefObject<HTMLElement | null>,
  selector: string = "[data-motion-hover]",
): void {
  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    const hoverCapable =
      typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;
    if (!shouldPlay("hover", { reducedMotion: prefersReducedMotion(), hoverCapable })) return;

    const plan = planHover();
    const elementOf = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      const candidate = target.closest<HTMLElement>(selector);
      return candidate !== null && root.contains(candidate) ? candidate : null;
    };
    const isInternalMove = (element: HTMLElement, related: EventTarget | null): boolean =>
      related instanceof Node && element.contains(related);

    const enter = (event: PointerEvent): void => {
      const element = elementOf(event.target);
      if (element === null || isInternalMove(element, event.relatedTarget)) return;
      gsap.to(element, {
        ...plan.to,
        duration: plan.duration,
        ease: plan.ease,
        overwrite: "auto",
      });
    };
    const leave = (event: PointerEvent): void => {
      const element = elementOf(event.target);
      if (element === null || isInternalMove(element, event.relatedTarget)) return;
      gsap.to(element, {
        ...plan.from,
        duration: plan.duration,
        ease: plan.ease,
        overwrite: "auto",
      });
    };

    root.addEventListener("pointerover", enter);
    root.addEventListener("pointerout", leave);
    return () => {
      root.removeEventListener("pointerover", enter);
      root.removeEventListener("pointerout", leave);
      const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
      gsap.killTweensOf(elements);
      gsap.set(elements, { clearProps: "transform" });
    };
  }, [rootRef, selector]);
}

/**
 * 服务端页面的动效入口：包一层客户端作用域，让页面继续在服务端渲染
 * （app/page.tsx 要读 9 个学科的图谱，整页 "use client" 会把数据打进客户端包）。
 */
export function MotionScope({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useStaggerIn(ref);
  return (
    <div ref={ref} data-motion-scope="" className={className}>
      {children}
    </div>
  );
}
