"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Globe } from "lucide-react";
import type { HelpLevel } from "@/lib/tutorPreferences";
import { AppDialog } from "./primitives/dialog";

const levels = [
  { id: "hint", label: "给我提示" },
  { id: "steps", label: "引导步骤" },
  { id: "explain", label: "完整讲解" },
] as const;

type HelpProps = { level: HelpLevel; onChange: (level: HelpLevel) => void; disabled: boolean };

export function HelpLevelChoices({ level, onChange, disabled }: HelpProps) {
  return <fieldset disabled={disabled}><legend className="sr-only">希望学伴怎样帮你？</legend>
    <div className="segmented max-w-sm">{levels.map((item, index) =>
      <button type="button" key={item.id} aria-pressed={item.id === level} onClick={() => onChange(item.id)}>
        {index + 1} · {item.label}
      </button>)}</div>
  </fieldset>;
}

export function MobileQuestionOptions({ level, onChange, disabled, webOn, toggleWeb, provider }: HelpProps & {
  webOn: boolean; toggleWeb: () => void; provider: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const phone = window.matchMedia("(max-width: 768px)");
    const closeOnDesktop = () => { if (!phone.matches) setOpen(false); };
    phone.addEventListener("change", closeOnDesktop);
    return () => phone.removeEventListener("change", closeOnDesktop);
  }, [open]);
  const label = levels.find(item => item.id === level)!.label;
  return <span className="tutor-mobile-options"><AppDialog
    title="提问选项" description="选择导师的讲解方式，以及是否参考外部网页。"
    open={open} onOpenChange={setOpen}
    trigger={<button type="button" aria-label={`提问选项：${label}${webOn ? "，已联网" : ""}`}>
      {label}{webOn && <Globe size={14} />}<ChevronDown size={14} />
    </button>}>
    <div className="tutor-options-sheet">
      <h3>讲解方式</h3><HelpLevelChoices level={level} onChange={onChange} disabled={disabled} />
      <label><span>联网查找资料</span><input type="checkbox" role="switch" checked={webOn} disabled={disabled} onChange={toggleWeb} /></label>
      <p>搜索来源为{provider}，外部网页需自行核对。 <Link href="/settings?panel=search">搜索设置</Link></p>
      <button type="button" className="tutor-options-done" onClick={() => setOpen(false)}>完成</button>
    </div>
  </AppDialog></span>;
}
