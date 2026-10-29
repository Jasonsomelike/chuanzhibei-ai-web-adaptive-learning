"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { readAloudLabel } from "@/components/tutor-logic";
import {
  loadTtsConfig,
  prepareSpeechText,
  speakBrowser,
  speakRemote,
  stopSpeaking,
} from "@/lib/tts";

/*
 * 同一时刻只朗读一条回答。
 *
 * tts.ts 是全局单例（speechSynthesis / Audio），但页面里每条消息各有一个按钮；
 * 用模块级 activeId + 订阅把「谁在播」同步给所有按钮，否则切换朗读时
 * 上一条仍显示「停止」，用户会以为两条在同时播。
 */
let activeId: string | null = null;
const listeners = new Set<() => void>();

function setActive(id: string | null): void {
  if (activeId === id) return;
  activeId = id;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  return activeId;
}

function getServerSnapshot(): string | null {
  return null;
}

/**
 * 单条回答的朗读按钮。
 *
 * 朗读在点击时才读配置，设置页改完音色 / 引擎后下一条消息立即生效。
 * 在线语音失败会回退浏览器语音，并把原因显示在按钮下方，不静默失败。
 */
export function ReadAloud({
  id,
  text,
  disabled = false,
}: {
  readonly id: string;
  readonly text: string;
  /** 流式生成中不允许朗读半截内容。 */
  readonly disabled?: boolean;
}) {
  const active = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const speaking = active === id;

  useEffect(() => {
    return () => {
      // 离开页面 / 消息被清空时停掉属于本按钮的声音，避免后台继续播
      if (activeId === id) {
        stopSpeaking();
        setActive(null);
      }
    };
  }, [id]);

  const toggle = async (): Promise<void> => {
    if (speaking || busy) {
      stopSpeaking();
      setActive(null);
      setBusy(false);
      return;
    }

    const speech = prepareSpeechText(text);
    if (speech.text === "") {
      setFallback("这条回答没有可朗读的正文。");
      return;
    }

    const config = loadTtsConfig();
    const speechApi = typeof window === "undefined" ? undefined : window.speechSynthesis;
    if (
      config.engine === "browser" &&
      (speechApi === undefined || typeof speechApi?.speak !== "function")
    ) {
      setFallback("当前浏览器不支持内置语音，请到设置页配置在线语音。");
      return;
    }

    setFallback(null);
    setTruncated(speech.truncated);
    setBusy(true);
    setActive(id);

    try {
      if (config.engine === "openai-compatible") {
        const result = await speakRemote(text, config);
        if (result.fallbackReason !== undefined && result.fallbackReason !== "") {
          setFallback(result.fallbackReason);
        }
      } else {
        await speakBrowser(text, config);
      }
    } catch (err) {
      setFallback(`朗读失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (activeId === id) setActive(null);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={disabled}
          aria-pressed={speaking}
          className="rounded-lg border border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--ink-soft)] hover:bg-[var(--line)] disabled:opacity-40"
        >
          {readAloudLabel(speaking, busy)}
        </button>
        {truncated ? (
          <span className="text-xs text-[var(--ink-faint)]">只朗读前 2000 字</span>
        ) : null}
      </div>
      {fallback !== null && fallback !== "" ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--warn)]">{fallback}</p>
      ) : null}
    </div>
  );
}
