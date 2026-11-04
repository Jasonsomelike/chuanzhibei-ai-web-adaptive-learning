"use client";

import { useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { prefersReducedMotion, useIsoLayoutEffect } from "@/components/motion";

/** Only animates presentation. Evidence is committed immediately by the existing submit action. */
export function useDiagnosticFeedback(root: RefObject<HTMLElement | null>, revealed: boolean, answerId: string | null, completed: number, cap: number) {
  const previous = useRef(completed / cap);
  useIsoLayoutEffect(() => {
    const from = previous.current;
    const to = completed / cap;
    previous.current = to;
    if (!root.current) return;
    const meter = root.current.querySelector<HTMLElement>("[data-diagnostic-meter]");
    if (prefersReducedMotion()) { if (meter) meter.style.transform = `scaleX(${to})`; return; }
    const context = gsap.context(() => {
      if (meter && from !== to) gsap.fromTo(meter, { scaleX: from }, { scaleX: to, duration: 0.45, ease: "power2.out", overwrite: "auto" });
      if (revealed) {
        const timeline = gsap.timeline();
        timeline.fromTo("[data-answer-feedback]", { opacity: 0, y: 9 }, { opacity: 1, y: 0, duration: 0.25, clearProps: "opacity,transform" });
        timeline.fromTo("[data-evidence-update]", { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: 0.22, clearProps: "opacity,transform" }, "-=0.06");
      }
    }, root);
    return () => { context.revert(); if (meter) meter.style.transform = `scaleX(${to})`; };
  }, [root, revealed, answerId, completed, cap]);
}
