"use client";

import { Children, useId, useRef, useState, type ReactNode } from "react";
import { AppDialog } from "@/components/primitives/dialog";
import { Icon } from "@/components/icons";

/** The same material/settings panels serve the desktop reading rail and mobile drawer. */
export function TutorRail({ children, course }: { children: ReactNode; course: string }) {
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState(false);
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
      {panels[index]}
    </div>)}
  </div>;
  return <>
    <aside className="tutor-rail" aria-label="课程学习材料">{!open ? contents : null}</aside>
    <div className="tutor-mobile-materials"><AppDialog open={open} onOpenChange={setOpen} onCloseAutoFocus={event => { if (focusComposer.current) { event.preventDefault(); focusComposer.current = false; document.getElementById("q")?.focus(); } }} drawer title="课程学习材料" description="阅读教材、查看上传资料，或调整当前课程的学习设置。" trigger={<button type="button" className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--accent)]"><Icon name="book" size={18} />教材与学习设置</button>}>{open ? contents : null}</AppDialog></div>
  </>;
}
