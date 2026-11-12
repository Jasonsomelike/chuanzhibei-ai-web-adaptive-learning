"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SUBJECTS } from "@/data/subjects";
import { AppDialog } from "@/components/primitives/dialog";
import { Icon } from "@/components/icons";

const shortcuts = [
  { label: "诊断测评", hint: "了解当前基础", href: "/diagnose" },
  { label: "错题本", hint: "复习历史错题，勾选导出总结", href: "/mistakes" },
  { label: "学习路径", hint: "安排时间与下一步", href: "/path" },
  { label: "课程导师", hint: "阅读资料，带着卡点提问", href: "/tutor" },
  { label: "我的方向", hint: "上传课程资料", href: "/directions" },
  { label: "设置中心", hint: "模型、主题与账号设置", href: "/settings" },
];

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setOpen(value => !value);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const search = query.trim().toLocaleLowerCase();
  const entries = [...shortcuts, ...SUBJECTS.map(subject => ({ label: subject.name, hint: subject.tagline, href: `/diagnose?subject=${subject.id}` }))]
    .filter(item => !search || `${item.label} ${item.hint}`.toLocaleLowerCase().includes(search));

  return <AppDialog open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery(""); }}
    title="快速前往" description="搜索课程与功能；Tab 选择，Enter 打开，Esc 关闭。"
    trigger={<button type="button" className="command-trigger" aria-label="搜索课程与功能"><Icon name="search" size={17} /><span className="hidden xl:inline">搜索课程与功能</span><kbd className="hidden text-[10px] sm:inline">Ctrl K</kbd></button>}>
    <label className="flex items-center gap-3 rounded-xl border border-[var(--line-strong)] px-3"><Icon name="search" /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索课程与功能" placeholder="输入课程或功能名称…" className="w-full bg-transparent py-3 text-sm outline-none" onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); resultsRef.current?.querySelector<HTMLAnchorElement>("a")?.focus(); } }} /></label>
    <div ref={resultsRef} className="mt-3 grid max-h-[50vh] gap-1 overflow-y-auto" aria-label="搜索结果">
      {entries.map(item => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="flex items-center justify-between gap-3 rounded-lg px-3 py-3 hover:bg-[var(--accent-soft)] focus:bg-[var(--accent-soft)]"><span className="min-w-0"><span className="block text-sm font-medium">{item.label}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{item.hint}</span></span><Icon name="arrow" size={17} /></Link>)}
      {entries.length === 0 ? <p role="status" className="p-5 text-sm text-[var(--ink-faint)]">没有匹配的课程或功能，换一个关键词试试。</p> : null}
    </div>
  </AppDialog>;
}
