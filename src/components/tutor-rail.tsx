"use client";

import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AppDialog } from "@/components/primitives/dialog";
import { Icon } from "@/components/icons";

/** Materials are on demand on every screen, leaving the conversation as the main stage. */
export function TutorRail({ children, course, sourceRequest = 0, sourcePanel }: { children: ReactNode; course: string; sourceRequest?: number; sourcePanel?: ReactNode }) {
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!sourceRequest) return;
    setTab(0);
    setOpen(true);
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>("[data-citation-source]")?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [sourceRequest]);
  const panels = Children.toArray(children);
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const focusComposer = useRef(false);
  const labels = ["教材阅读", "我的资料", "学习设置"];
  const contents = <div className="tutor-rail-content" onClick={event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-material-ask]")) return;
    if (open) { focusComposer.current = true; setOpen(false); }
    else document.getElementById("q")?.focus();
  }}>
    <div className="workspace-tabs" role="tablist" aria-label="课程学习材料" ref={tabs}>
      {labels.map((label, index) => <button key={label} id={`${id}-tab-${index}`} role="tab" type="button" tabIndex={tab === index ? 0 : -1} aria-selected={tab === index} aria-controls={`${id}-panel-${index}`} onClick={() => setTab(index)} onKeyDown={event => {
        let next = tab;
        if (event.key === "ArrowRight") next = (tab + 1) % labels.length;
        else if (event.key === "ArrowLeft") next = (tab + labels.length - 1) % labels.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = labels.length - 1;
        else return;
        event.preventDefault(); setTab(next); tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>{label}</button>)}
    </div>
    {labels.map((label, index) => <div key={label} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} id={`${id}-panel-${index}`} hidden={tab !== index} className="tutor-rail-panel" tabIndex={0}>
      <p className="mb-4 border-b border-[var(--line)] pb-3 text-xs text-[var(--ink-faint)]">{course} · {label}</p>
      {index === 0 ? sourcePanel : null}
      {panels[index]}
    </div>)}
  </div>;
  return <>
    <div className="tutor-material-trigger"><AppDialog open={open} onOpenChange={setOpen} onCloseAutoFocus={event => { if (focusComposer.current) { event.preventDefault(); focusComposer.current = false; document.getElementById("q")?.focus(); } }} drawer title="课程学习材料" description="阅读教材、查看上传资料，或调整当前课程的学习设置。" trigger={<button type="button" className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--accent)]"><Icon name="book" size={18} /><span>教材与引用</span></button>}>{open ? contents : null}</AppDialog></div>
  </>;
}
