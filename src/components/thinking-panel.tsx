"use client";

import { useEffect, useRef, useState } from "react";

import { thinkingPanelMode } from "@/components/tutor-logic";

/**
 * 思考过程面板。
 *
 * 为什么默认展开、正文一开始就折叠：思考内容只在正文尚未出现时有阅读价值；
 * 正文开始后还占着半屏，会让人把推理当成答案的一部分。折叠后仍可手动展开。
 *
 * 不忠实声明必须固定在面板里：模型给出的推理并不保证是它真正的决策过程
 * （Turpin et al. 2023），把它当解释展示会制造虚假信任。
 */
export function ThinkingPanel({
  reasoning,
  textStarted,
  streaming,
  enabled,
}: {
  readonly reasoning: string;
  /** 正文是否已经开始输出。从 false 变 true 的那一次自动折叠。 */
  readonly textStarted: boolean;
  readonly streaming: boolean;
  /** 本次请求是否真的开启了思考（设置档位关、或端点不支持时为 false）。 */
  readonly enabled: boolean;
}) {
  const mode = thinkingPanelMode({ reasoning, enabled });
  const [open, setOpen] = useState(true);
  const collapsedOnce = useRef(false);

  useEffect(() => {
    if (!textStarted || collapsedOnce.current) return;
    collapsedOnce.current = true;
    setOpen(false);
  }, [textStarted]);

  if (mode === "hidden") return null;

  if (mode === "empty") {
    return (
      <p className="mb-3 text-xs leading-relaxed text-[var(--ink-faint)]">
        {streaming
          ? "已开启思考，正在等待模型返回思考内容…"
          : "本次模型没有返回可展示的思考内容（部分供应商只返回摘要或不返回）。"}
      </p>
    );
  }

  return (
    <div className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--line)]/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-medium text-[var(--ink-soft)]">
          思考过程（模型生成，可能不完整 / 不忠实）
        </span>
        <span className="shrink-0 text-xs text-[var(--ink-faint)]">
          {/*
            正文已经开始输出后就不再是「思考中」：流式还没结束，
            但模型此刻在写答案，不是在思考。只看 streaming 会把两个阶段说反。
          */}
          {streaming && !textStarted ? "思考中… · " : ""}
          {open ? "收起" : "展开"}
        </span>
      </button>
      {open ? (
        <div className="border-t border-[var(--line)] px-3 py-2">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--ink-soft)]">
            {reasoning}
          </pre>
          <p className="mt-2 text-xs leading-relaxed text-[var(--ink-faint)]">
            思考过程可能不忠实；判分与引用以正文和出处为准。
          </p>
        </div>
      ) : null}
    </div>
  );
}
