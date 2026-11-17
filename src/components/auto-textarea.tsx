"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const element = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = element.current;
    if (!input) return;
    let width = -1;
    const resize = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(180, Math.max(48, input.scrollHeight))}px`;
    };
    resize();
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width;
      if (next === undefined || next === width) return;
      width = next;
      resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={element} />;
}
