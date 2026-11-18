"use client";

import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AppDialog } from "@/components/primitives/dialog";
import { Icon } from "@/components/icons";
import { useClientSnapshot } from "@/lib/useClientSnapshot";

/** Materials are on demand on every screen, leaving the conversation as the main stage. */
export function TutorRail({ children, course, sourceRequest = 0, sourcePanel }: { children: ReactNode; course: string; sourceRequest?: number; sourcePanel?: ReactNode }) {
  const [tab, setTab] = useState(0);
  // ?materials=1 深链只在客户端可读；override 为 null 时跟随深链值
  const openFromUrl = useClientSnapshot(
    () => new URLSearchParams(window.location.search).get("materials") === "1",
    false,
  );
  const [openOverride, setOpen] = useState<boolean | null>(null);
  const open = openOverride ?? openFromUrl;
  // 引用跳转请求是计数器：变化时在渲染期同步 Tab 与展开状态（React 的 adjust-on-change 模式）
  const [seenRequest, setSeenRequest] = useState(sourceRequest);
  if (sourceRequest !== seenRequest) {
    setSeenRequest(sourceRequest);
    if (sourceRequest) {
      setTab(0);
      setOpen(true);
    }
  }
  // 聚焦是 DOM 操作，留在 effect；状态调整已移到渲染期
  useEffect(() => {
    if (!sourceRequest) return;
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>("[data-citation-source]")?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [sourceRequest]);
  const panels = Children.toArray(children);
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const focusComposer = useRef(false);
  const labels = ["教材阅读", "我的资料", "学习设置"];
  function selectTab(index: number) {
    if (index === tab) return;
    tabs.current?.closest(".app-dialog-body")?.scrollTo({ top: 0, behavior: "instant" });
    setTab(index);
  }
  const toolbar = <div className="workspace-tabs" role="tablist" aria-label="课程学习材料" ref={tabs}>
      {labels.map((label, index) => <button key={label} id={`${id}-tab-${index}`} role="tab" type="button" tabIndex={tab === index ? 0 : -1} aria-selected={tab === index} aria-controls={`${id}-panel-${index}`} onClick={() => selectTab(index)} onKeyDown={event => {
        let next = tab;
        if (event.key === "ArrowRight") next = (tab + 1) % labels.length;
        else if (event.key === "ArrowLeft") next = (tab + labels.length - 1) % labels.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = labels.length - 1;
        else return;
        event.preventDefault(); selectTab(next); tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>{label}</button>)}
    </div>;
  const contents = <div onClick={event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-material-ask]")) return;
    focusComposer.current = true;
    setOpen(false);
  }}>
    {labels.map((label, index) => <div key={label} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} id={`${id}-panel-${index}`} hidden={tab !== index} tabIndex={0}>
      {index === 0 ? sourcePanel : null}
      {panels[index]}
    </div>)}
  </div>;
  return <>
    <div className="tutor-material-trigger"><AppDialog open={open} onOpenChange={setOpen} onCloseAutoFocus={event => { if (focusComposer.current) { event.preventDefault(); focusComposer.current = false; document.getElementById("q")?.focus(); } }} drawer title="课程学习材料" description={course} toolbar={toolbar} trigger={<button type="button" className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--accent)]"><Icon name="book" size={18} /><span>教材与引用</span></button>}>{open ? contents : null}</AppDialog></div>
  </>;
}
