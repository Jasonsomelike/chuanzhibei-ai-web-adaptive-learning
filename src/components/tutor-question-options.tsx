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

/** 每个档位的实际行为（与 tutoringPolicy / offlineTutoringText 的口径一致）。 */
const levelNotes: Record<HelpLevel, string> = {
  hint: "只给一个思考方向和一个反问，不揭示最终答案；等你独立尝试后再继续。",
  steps: "只指出关键步骤和检验方法，最后一步留给你自己完成。",
  explain: "给出答案、依据和例子，再附一道迁移练习；引用的知识点与资料会标注出处。",
};

type HelpProps = { level: HelpLevel; onChange: (level: HelpLevel) => void; disabled: boolean };

/** 三档讲解方式的说明框：当前档位高亮，文案按项目真实行为撰写。 */
export function HelpLevelExplainer({ level }: { level: HelpLevel }) {
  return <div className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
    <p className="text-[11px] leading-relaxed text-[var(--ink-faint)]">三种讲解方式 · 越往后给得越多（未配置模型时：提示与步骤退化为通用学习引导，「完整讲解」展示检索到的资料解析并标注来源。）</p>
    <ul className="mt-1.5 grid gap-1.5 md:grid-cols-3">
      {levels.map((item, index) => {
        const active = item.id === level;
        return <li key={item.id} className={`rounded-lg px-2.5 py-2 transition-colors ${active ? "bg-[var(--accent-soft)]" : ""}`}>
          <span className={`text-xs font-medium ${active ? "text-[var(--accent)]" : "text-[var(--ink-soft)]"}`}>
            {index + 1} · {item.label}
          </span>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--ink-faint)]">{levelNotes[item.id]}</p>
        </li>;
      })}
    </ul>
  </div>;
}

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
      <HelpLevelExplainer level={level} />
      <label><span>联网查找资料</span><input type="checkbox" role="switch" checked={webOn} disabled={disabled} onChange={toggleWeb} /></label>
      <p>搜索来源为{provider}，外部网页需自行核对。 <Link href="/settings?panel=search">搜索设置</Link></p>
      <button type="button" className="tutor-options-done" onClick={() => setOpen(false)}>完成</button>
    </div>
  </AppDialog></span>;
}
