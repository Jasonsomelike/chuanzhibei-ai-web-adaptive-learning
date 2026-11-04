"use client";

import { useRef, type RefObject } from "react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { prefersReducedMotion, useIsoLayoutEffect } from "@/components/motion";

gsap.registerPlugin(Flip);

/** Capture in the action handler, before React changes order; animate stable KC identities. */
export function usePathFlip(root: RefObject<HTMLElement | null>, signature: string) {
  const pending = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const capture = () => {
    if (!root.current || prefersReducedMotion()) { pending.current = null; return; }
    pending.current = Flip.getState(root.current.querySelectorAll("[data-flip-id]"));
  };
  useIsoLayoutEffect(() => {
    const previous = pending.current;
    pending.current = null;
    if (!previous || !root.current || prefersReducedMotion()) return;
    const context = gsap.context(() => {
      Flip.from(previous, { duration: 0.42, ease: "power2.inOut", nested: true, prune: true,
        onEnter: elements => gsap.fromTo(elements, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.25, clearProps: "opacity,transform" }),
      });
    }, root);
    return () => context.revert();
  }, [root, signature]);
  return capture;
}
