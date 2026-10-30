/**
 * 浏览器语音输入：运行时特性检测、配置、转写拼接与错误码翻译。
 *
 * 边界（与 ADR 的阶段 6 决定一致）：
 * - 只用 Web Speech API，不做服务端 ASR、不上传音频、不做连续识别；
 * - 支持性在运行时判断：window.SpeechRecognition ?? window.webkitSpeechRecognition；
 * - lang=zh-CN、continuous=false、interimResults=true；
 * - 只把转写结果交给调用方填空，**不自动发送**；错误只映射成人话，**不重试**；
 * - 本模块不碰 React / DOM 事件，单测用假识别器驱动 result / error / end。
 */

/** 识别语言。只做中文输入，与导师页的提示词语言一致。 */
export const SPEECH_LANG = "zh-CN";

/** 输入框的最大长度；与导师页 input 的 maxLength 保持一致。 */
export const SPEECH_INPUT_MAX_CHARS = 500;

export interface SpeechAlternativeLike {
  readonly transcript: string;
}

/** SpeechRecognitionResult 的最小形状：下标 0 是最可信的候选。 */
export interface SpeechResultLike {
  readonly isFinal?: boolean;
  readonly length?: number;
  readonly [index: number]: SpeechAlternativeLike | undefined;
}

export interface SpeechResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechResultLike | undefined;
}

export interface SpeechResultEventLike {
  readonly resultIndex?: number;
  readonly results: SpeechResultListLike;
}

export interface SpeechErrorEventLike {
  readonly error?: string;
  readonly message?: string;
}

/**
 * 识别器的结构化类型。
 *
 * TS 的 lib.dom 没有稳定的 SpeechRecognition 声明（各家实现仍是前缀），
 * 因此这里只声明本模块真正会碰到的字段。
 */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface SpeechScope {
  readonly SpeechRecognition?: SpeechRecognitionCtor;
  readonly webkitSpeechRecognition?: SpeechRecognitionCtor;
  readonly isSecureContext?: boolean;
}

export type SpeechUnavailableReason = "unsupported" | "insecure" | "server";

export type SpeechSupport =
  | { readonly ok: true; readonly create: () => SpeechRecognitionLike }
  | { readonly ok: false; readonly reason: SpeechUnavailableReason; readonly message: string };

/**
 * 运行时检测。
 *
 * 不传 scope 时读 window；服务端渲染（没有 window）直接返回 unsupported，
 * 页面在挂载后重新检测，避免 hydration 前后文案不一致。
 */
export function detectSpeechSupport(scope?: SpeechScope): SpeechSupport {
  if (scope === undefined && typeof window === "undefined") {
    return {
      ok: false,
      reason: "server",
      message: "语音输入只在浏览器里可用；请在浏览器中打开本页。",
    };
  }
  const source: SpeechScope | undefined =
    scope ?? (window as unknown as SpeechScope);

  if (source.isSecureContext === false) {
    return {
      ok: false,
      reason: "insecure",
      message: "语音识别需要 HTTPS（或 localhost）：当前页面不是安全上下文，浏览器不会开放麦克风。",
    };
  }

  const ctor = source.SpeechRecognition ?? source.webkitSpeechRecognition;
  if (ctor === undefined) {
    return {
      ok: false,
      reason: "unsupported",
      message:
        "当前浏览器不支持 Web Speech 语音识别（Chrome / Edge 可用）；请改用键盘输入。",
    };
  }

  return {
    ok: true,
    create: () => configureSpeechRecognition(new ctor()),
  };
}

/** 统一配置：中文、单轮、要临时结果。 */
export function configureSpeechRecognition(
  recognition: SpeechRecognitionLike,
): SpeechRecognitionLike {
  recognition.lang = SPEECH_LANG;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}

/**
 * 把识别错误码翻成人话。
 *
 * 每条都给出下一步动作；不出现「请重试」——本模块明确不自动重试，
 * 用户点按钮才会重新开始一轮。
 */
export function speechErrorText(code: string): string {
  switch (code) {
    case "not-allowed":
      return "麦克风权限被拒绝：点地址栏左侧的站点图标，把「麦克风」改为允许；系统「隐私与安全 → 麦克风」里也要允许浏览器使用。";
    case "service-not-allowed":
      return "浏览器禁用了语音识别服务（可能被策略或隐私设置关闭）；请改用键盘输入。";
    case "audio-capture":
      return "没有找到可用的麦克风：检查系统输入设备或插上麦克风后再点一次。";
    case "no-speech":
      return "没有听到声音：靠近麦克风、说慢一点，再点一次。";
    case "network":
      return "语音识别要连到浏览器厂商的服务，当前网络不可用；可以改用键盘输入。";
    case "aborted":
      return "语音输入已停止。";
    case "language-not-supported":
      return "当前浏览器不支持中文（zh-CN）语音识别；请改用键盘输入。";
    case "bad-grammar":
      return "浏览器无法解析这次语音；请再说一次，或改用键盘输入。";
    case "not-allowed-by-permissions-policy":
      return "页面被权限策略禁止使用麦克风（可能嵌在 iframe 里）；请在独立标签页打开，或改用键盘输入。";
    default:
      return `语音识别失败${code === "" ? "" : `（${code}）`}；请改用键盘输入。`;
  }
}

export interface SpeechTranscript {
  /** 已定稿的文本（isFinal）。 */
  readonly finalText: string;
  /** 还会变的临时文本（interimResults）。 */
  readonly interimText: string;
}

/**
 * 把一次 result 事件拆成「已定稿 / 临时」两段。
 *
 * resultIndex 之前的条目已经在先前事件里定稿过；从 resultIndex 开始读，
 * 避免同一句被重复追加。没有 resultIndex 时从头读，调用方按整段替换。
 */
export function transcriptOf(event: SpeechResultEventLike): SpeechTranscript {
  const results = event.results;
  const start =
    typeof event.resultIndex === "number" && event.resultIndex >= 0
      ? Math.floor(event.resultIndex)
      : 0;

  let finalText = "";
  let interimText = "";
  for (let index = start; index < results.length; index += 1) {
    const result = results[index];
    if (result === undefined) continue;
    const alternative = result[0];
    const transcript = alternative?.transcript ?? "";
    if (transcript === "") continue;
    if (result.isFinal === true) finalText += transcript;
    else interimText += transcript;
  }
  return { finalText, interimText };
}

function isAsciiWordChar(char: string): boolean {
  return /[A-Za-z0-9]/.test(char);
}

/**
 * 把转写追加到输入框已有内容之后。
 *
 * 中文直接相接；两侧都是 ASCII 字母/数字时补一个空格，
 * 否则“hello”“world”两段会粘成 helloworld。
 * 超过输入框上限时保留前 maxChars 个码点（与输入框 maxLength 一致）。
 */
export function appendTranscript(
  current: string,
  addition: string,
  maxChars: number = SPEECH_INPUT_MAX_CHARS,
): string {
  const extra = addition.trim();
  if (extra === "") return current;

  const base = current.replace(/\s+$/u, "");
  let joined: string;
  if (base === "") {
    joined = extra;
  } else {
    const last = base.slice(-1);
    const first = extra.slice(0, 1);
    joined = isAsciiWordChar(last) && isAsciiWordChar(first) ? `${base} ${extra}` : `${base}${extra}`;
  }

  const limit =
    Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : SPEECH_INPUT_MAX_CHARS;
  const points = Array.from(joined);
  return points.length <= limit ? joined : points.slice(0, limit).join("");
}

export interface SpeechHandlers {
  /** 定稿文本：只填空，不自动发送。 */
  readonly onFinal: (text: string) => void;
  /** 临时文本：用于展示「正在识别」，不写进输入框。 */
  readonly onInterim: (text: string) => void;
  /** 人话错误；调用方只展示，不重试。 */
  readonly onError: (message: string, code: string) => void;
  /** 识别结束（正常或出错后都会触发）。 */
  readonly onEnd: () => void;
  readonly onStart?: () => void;
}

export interface SpeechSession {
  /** 开始识别；返回 null 表示已开始，否则返回不能开始的原因。 */
  start(): string | null;
  stop(): void;
  abort(): void;
}

/**
 * 绑定一次识别会话。
 *
 * 事件只在这里翻译一次：result → 定稿/临时文本，error → 人话 + end。
 * 不自动重启（continuous=false 且不监听 end 再 start），
 * 因为自动 restart 很容易在权限被拒时变成死循环。
 */
export function createSpeechSession(
  recognition: SpeechRecognitionLike,
  handlers: SpeechHandlers,
): SpeechSession {
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    handlers.onEnd();
  };

  recognition.onstart = () => {
    handlers.onStart?.();
  };
  recognition.onresult = (event) => {
    const { finalText, interimText } = transcriptOf(event);
    if (finalText !== "") handlers.onFinal(finalText);
    handlers.onInterim(interimText);
  };
  recognition.onerror = (event) => {
    const code = (event?.error ?? "").trim();
    handlers.onError(speechErrorText(code), code);
    // 部分实现出错后不会触发 onend；这里主动收尾一次，保证按钮能复位
    finish();
  };
  recognition.onend = () => {
    finish();
  };

  return {
    start(): string | null {
      try {
        recognition.start();
        return null;
      } catch (err) {
        const message =
          err instanceof Error && err.message.trim() !== ""
            ? `无法开始语音识别：${err.message}`
            : "无法开始语音识别：可能已经在识别中；请稍后再点一次。";
        handlers.onError(message, "start-failed");
        return message;
      }
    },
    stop(): void {
      try {
        recognition.stop();
      } catch {
        // 已经结束或实现不支持 stop；不影响界面复位
        finish();
      }
    },
    abort(): void {
      try {
        recognition.abort();
      } catch {
        // 同上
      }
      finish();
    },
  };
}
