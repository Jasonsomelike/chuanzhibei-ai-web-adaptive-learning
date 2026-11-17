"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { useClientSnapshot } from "@/lib/useClientSnapshot";

const WIDTH_KEY = "alp.tutor.history-width";
const DEFAULT_WIDTH = 292;
function readWidth() {
  try { const value = Number(localStorage.getItem(WIDTH_KEY)); return Number.isFinite(value) && value >= 240 && value <= 480 ? value : DEFAULT_WIDTH; }
  catch { return DEFAULT_WIDTH; }
}

/** Keep the conversation mounted while changing sizes or switching to the drawer. */
export function TutorWorkspace({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  const panel = usePanelRef();
  const [wide, setWide] = useState(false);
  const stored = useClientSnapshot(readWidth, DEFAULT_WIDTH);
  const preferred = useRef<number | null>(null);
  useEffect(() => {
    if (!element.current) return;
    const measure = () => setWide(window.innerWidth >= 1024 && (element.current?.clientWidth ?? 0) >= 860);
    const observer = new ResizeObserver(measure);
    observer.observe(element.current);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => { if (wide) panel.current?.resize(preferred.current ?? stored); }, [wide, stored, panel]);
  const save = (width: number) => {
    preferred.current = Math.max(240, Math.min(480, width));
    try { localStorage.setItem(WIDTH_KEY, String(preferred.current)); } catch { /* Resizing works even when storage is unavailable. */ }
  };
  return <Group elementRef={element} className="tutor-workspace tutor-resizable" data-split={wide ? "wide" : "drawer"} orientation="horizontal" disabled={!wide} style={{ height: "var(--tutor-workspace-height)", minHeight: 0 }}
    onLayoutChanged={(layout, meta) => {
      if (!wide || !meta.isUserInteraction || !element.current) return;
      // The imperative ref still describes the previous render inside this callback.
      // Use the completed layout and the available panel area instead.
      const separator = element.current.querySelector<HTMLElement>(".tutor-resize-handle");
      save((element.current.clientWidth - (separator?.offsetWidth ?? 9)) * layout["tutor-history"] / 100);
    }}>
    <Panel id="tutor-history" className="tutor-history-panel" panelRef={panel} defaultSize={DEFAULT_WIDTH} minSize={wide ? 240 : 0} maxSize={wide ? 480 : 0} groupResizeBehavior="preserve-pixel-size" style={{ overflow: "visible" }}>
      {sidebar}
    </Panel>
    <Separator className="tutor-resize-handle" aria-label="调整历史会话栏宽度" title="拖动或用方向键调整；双击恢复默认宽度" disabled={!wide} disableDoubleClick
      onDoubleClick={() => { panel.current?.resize(DEFAULT_WIDTH); save(DEFAULT_WIDTH); }}><span /></Separator>
    <Panel id="tutor-conversation" className="tutor-conversation-panel" minSize={wide ? 600 : 0} style={{ overflow: "hidden" }}>{children}</Panel>
  </Group>;
}
