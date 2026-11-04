"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip.Provider delayDuration={350}><Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content sideOffset={7} className="z-[100] max-w-64 rounded-lg bg-[var(--ink)] px-3 py-2 text-xs leading-relaxed text-[var(--canvas)] shadow-lg">{label}<Tooltip.Arrow className="fill-[var(--ink)]" /></Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}
