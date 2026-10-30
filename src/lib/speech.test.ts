import { describe, expect, it } from "vitest";

import {
  SPEECH_LANG,
  appendTranscript,
  createSpeechSession,
  detectSpeechSupport,
  speechErrorText,
  transcriptOf,
  type SpeechErrorEventLike,
  type SpeechRecognitionLike,
  type SpeechResultEventLike,
} from "@/lib/speech";

class FakeRecognition implements SpeechRecognitionLike {
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 3;
  onresult: ((event: SpeechResultEventLike) => void) | null = null;
  onerror: ((event: SpeechErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  starts = 0;
  stops = 0;
  aborts = 0;
  throwOnStart = false;

  start(): void {
    this.starts += 1;
    if (this.throwOnStart) throw new Error("already started");
    this.onstart?.();
  }
  stop(): void {
    this.stops += 1;
  }
  abort(): void {
    this.aborts += 1;
  }
}

function result(items: readonly { text: string; final: boolean }[]): SpeechResultEventLike {
  const list = items.map((item) => {
    const entry: { isFinal: boolean; length: number; 0: { transcript: string } } = {
      isFinal: item.final,
      length: 1,
      0: { transcript: item.text },
    };
    return entry;
  });
  return { results: list };
}

describe("detectSpeechSupport", () => {
  it("没有 window（服务端渲染）时明确说只在浏览器可用", () => {
    expect(detectSpeechSupport()).toMatchObject({ ok: false, reason: "server" });
  });

  it("没有 SpeechRecognition / webkitSpeechRecognition 时给出替代路径", () => {
    const support = detectSpeechSupport({});
    expect(support.ok).toBe(false);
    if (support.ok) return;
    expect(support.reason).toBe("unsupported");
    expect(support.message).toContain("Chrome");
    expect(support.message).toContain("键盘输入");
  });

  it("非安全上下文直接拒绝，并说明需要 HTTPS", () => {
    const support = detectSpeechSupport({ isSecureContext: false, SpeechRecognition: FakeRecognition });
    expect(support.ok).toBe(false);
    if (support.ok) return;
    expect(support.reason).toBe("insecure");
    expect(support.message).toContain("HTTPS");
  });

  it("找到构造器时按 zh-CN / 单轮 / 临时结果配置", () => {
    const support = detectSpeechSupport({ SpeechRecognition: FakeRecognition });
    expect(support.ok).toBe(true);
    if (!support.ok) return;
    const recognition = support.create();
    expect(recognition.lang).toBe(SPEECH_LANG);
    expect(recognition.continuous).toBe(false);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.maxAlternatives).toBe(1);
  });

  it("webkit 前缀也能识别", () => {
    const support = detectSpeechSupport({ webkitSpeechRecognition: FakeRecognition });
    expect(support.ok).toBe(true);
  });
});

describe("transcriptOf", () => {
  it("定稿与临时结果分开返回", () => {
    const event = result([
      { text: "栈是", final: true },
      { text: "后进先出", final: false },
    ]);
    expect(transcriptOf(event)).toEqual({ finalText: "栈是", interimText: "后进先出" });
  });

  it("有 resultIndex 时只读新增部分，避免重复追加", () => {
    const event: SpeechResultEventLike = {
      resultIndex: 1,
      results: [
        { isFinal: true, length: 1, 0: { transcript: "栈是" } },
        { isFinal: true, length: 1, 0: { transcript: "后进先出" } },
      ],
    };
    expect(transcriptOf(event)).toEqual({ finalText: "后进先出", interimText: "" });
  });

  it("空结果与缺失候选不产生文本", () => {
    expect(transcriptOf({ results: [] })).toEqual({ finalText: "", interimText: "" });
    expect(transcriptOf({ results: [{ isFinal: true, length: 0 }] })).toEqual({
      finalText: "",
      interimText: "",
    });
  });
});

describe("appendTranscript", () => {
  it("只填空：中文直接相接，不自动发送", () => {
    expect(appendTranscript("", "栈是什么")).toBe("栈是什么");
    expect(appendTranscript("请解释", "栈是什么")).toBe("请解释栈是什么");
  });

  it("ASCII 单词之间补空格", () => {
    expect(appendTranscript("hello", "world")).toBe("hello world");
    expect(appendTranscript("hello ", "world")).toBe("hello world");
  });

  it("空白转写不改变输入框", () => {
    expect(appendTranscript("已有内容", "   ")).toBe("已有内容");
  });

  it("超过上限时按码点截断", () => {
    // ASCII 边界补空格后是 "aaaa bcdef"，再按 6 个码点截断
    expect(appendTranscript("a".repeat(4), "bcdef", 6)).toBe("aaaa b");
    expect(appendTranscript("请解释", "栈是什么", 4)).toBe("请解释栈");
  });
});

describe("speechErrorText", () => {
  it("权限、网络、设备错误都给出可执行说明", () => {
    expect(speechErrorText("not-allowed")).toContain("麦克风权限被拒绝");
    expect(speechErrorText("network")).toContain("改用键盘输入");
    expect(speechErrorText("audio-capture")).toContain("麦克风");
    expect(speechErrorText("no-speech")).toContain("靠近麦克风");
    expect(speechErrorText("aborted")).toContain("已停止");
  });

  it("未知错误码原文回显，不假装成功", () => {
    expect(speechErrorText("weird-code")).toContain("weird-code");
    expect(speechErrorText("weird-code")).toContain("键盘输入");
  });
});

describe("createSpeechSession", () => {
  it("result / error / end 都只走一次对应回调", () => {
    const recognition = new FakeRecognition();
    const finals: string[] = [];
    const interims: string[] = [];
    const errors: string[] = [];
    const ends: string[] = [];
    let starts = 0;

    const session = createSpeechSession(recognition, {
      onFinal: (text) => finals.push(text),
      onInterim: (text) => interims.push(text),
      onError: (message) => errors.push(message),
      onEnd: () => ends.push("end"),
      onStart: () => {
        starts += 1;
      },
    });

    expect(session.start()).toBeNull();
    expect(starts).toBe(1);

    recognition.onresult?.(result([{ text: "栈", final: true }, { text: "后进", final: false }]));
    expect(finals).toEqual(["栈"]);
    expect(interims).toEqual(["后进"]);

    recognition.onerror?.({ error: "not-allowed" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("麦克风权限被拒绝");
    // 出错后立即收尾；随后到达的 onend 不能再触发一次
    recognition.onend?.();
    expect(ends).toEqual(["end"]);
  });

  it("start 抛异常时返回原因且不自动重试", () => {
    const recognition = new FakeRecognition();
    recognition.throwOnStart = true;
    const errors: string[] = [];

    const session = createSpeechSession(recognition, {
      onFinal: () => {},
      onInterim: () => {},
      onError: (message) => errors.push(message),
      onEnd: () => {},
    });

    const problem = session.start();
    expect(problem).toContain("already started");
    expect(errors).toHaveLength(1);
    expect(recognition.starts).toBe(1);
  });

  it("stop / abort 调用底层识别器", () => {
    const recognition = new FakeRecognition();
    const session = createSpeechSession(recognition, {
      onFinal: () => {},
      onInterim: () => {},
      onError: () => {},
      onEnd: () => {},
    });
    session.start();
    session.stop();
    session.abort();
    expect(recognition.stops).toBe(1);
    expect(recognition.aborts).toBe(1);
  });
});
