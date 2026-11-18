import { BookOpen, CircleHelp, ClipboardList, Palette, ShieldCheck, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRef, type KeyboardEvent } from "react";

const categories = [
  { id: "appearance", label: "外观", icon: Palette },
  { id: "mode", label: "模型与工具", icon: SlidersHorizontal },
  { id: "materials", label: "资料与口径", icon: BookOpen },
  { id: "learning-data", label: "学习数据", icon: ClipboardList },
  { id: "privacy", label: "账号与隐私", icon: ShieldCheck },
] as const;

const modelTabs = [
  { id: "mode", label: "调用模式" }, { id: "provider", label: "模型供应商" },
  { id: "thinking", label: "思考与核对" }, { id: "tone", label: "语气" },
  { id: "tts", label: "语音朗读" }, { id: "search", label: "联网搜索" },
  { id: "agent", label: "智能体与工具" }, { id: "vector", label: "向量检索" },
] as const;

export type SectionId = (typeof categories | typeof modelTabs)[number]["id"];
type Props = { active: SectionId; select: (id: SectionId) => void };
export const resolvePanel = (id: string | null): SectionId =>
  [...categories, ...modelTabs].find(section => section.id === id)?.id ?? "appearance";
export const isModelPanel = (id: SectionId) => modelTabs.some(tab => tab.id === id);
export const panelAttrs = (id: SectionId, active: SectionId) => ({
  role: isModelPanel(id) ? "tabpanel" : "region",
  id: `settings-panel-${id}`,
  "aria-labelledby": `settings-${isModelPanel(id) ? "tab" : "category"}-${id}`,
  hidden: id !== active,
});

export function CategoryNav({ active, select }: Props) {
  return <nav aria-label="设置分区" data-motion="nav">
    <div className="settings-category-nav">{categories.map(({ id, label, icon: Icon }) =>
      <button key={id} id={`settings-category-${id}`} type="button"
        aria-current={(id === active || id === "mode" && isModelPanel(active)) || undefined}
        onClick={() => select(id)}><Icon size={20} />{label}</button>)}
      <Link href="/guide"><CircleHelp size={20} />使用帮助</Link>
    </div>
  </nav>;
}

export function ModelTabs({ active, select }: Props) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  function move(event: KeyboardEvent, index: number) {
    const last = modelTabs.length - 1;
    const positions: Record<string, number> = {
      ArrowLeft: (index + last) % modelTabs.length, ArrowRight: (index + 1) % modelTabs.length,
      ArrowUp: (index + last) % modelTabs.length, ArrowDown: (index + 1) % modelTabs.length,
      Home: 0, End: last,
    };
    const next = positions[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(modelTabs[next].id);
    tabs.current[next]?.focus();
  }
  return <div className="settings-model-tabs" role="tablist" aria-label="模型与工具分区">
    {modelTabs.map(({ id, label }, i) => <button key={id} ref={el => { tabs.current[i] = el; }}
      type="button" role="tab" id={`settings-tab-${id}`} aria-controls={`settings-panel-${id}`}
      aria-selected={active === id} tabIndex={active === id ? 0 : -1}
      onClick={() => select(id)} onKeyDown={e => move(e, i)}>{label}</button>)}
  </div>;
}
