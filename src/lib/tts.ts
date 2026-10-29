/**
 * 浏览器 / 在线 TTS 运行时。
 *
 * 边界：
 * - 密钥只存 localStorage，请求由浏览器直接发往用户填的端点，不经过本项目后端。
 * - 朗读前先清洗文本：只把回答正文发给语音服务，引用标记与 Markdown 不进音频。
 * - 在线失败（CORS / HTTP / 播放）一律回退浏览器语音，并返回可展示的中文原因。
 * - 模块顶层不碰 window / speechSynthesis / Audio，SSR 与测试环境可以安全 import。
 */

export type TtsEngine = "browser" | "openai-compatible";

export interface TtsConfig {
  readonly engine: TtsEngine;
  /** 浏览器语音的 name（兼容 voiceURI）；为空时用系统默认音色。 */
  readonly browserVoice?: string;
  /** 0.8–1.2，超出范围在解析与播放时都会被夹紧。 */
  readonly rate: number;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly voice?: string;
}

export const TTS_STORAGE_KEY = "alp.tts.v1";

/** 单次朗读的正文上限；超出部分不发送、不播放。 */
export const SPEECH_MAX_CHARS = 2000;

export const RATE_MIN = 0.8;
export const RATE_MAX = 1.2;

export const DEFAULT_TTS_CONFIG: TtsConfig = Object.freeze({
  engine: "browser",
  rate: 1,
});

export interface SpeechText {
  readonly text: string;
  readonly truncated: boolean;
}

export interface SpeakRemoteResult {
  readonly ok: boolean;
  /** 在线失败并回退浏览器语音时，给用户看的中文原因。 */
  readonly fallbackReason?: string;
}

// ── 配置 ──────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? undefined : text;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rate));
}

function rateOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return clampRate(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return clampRate(parsed);
  }
  return 1;
}

function defaultConfig(): TtsConfig {
  return { ...DEFAULT_TTS_CONFIG };
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 把 localStorage 里的原始值或任意对象归一化为 TtsConfig。
 *
 * 坏存档不能让设置页白屏：任何字段不合法都退回该项默认值，而不是整份丢弃。
 */
export function parseTtsConfig(raw: unknown): TtsConfig {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return defaultConfig();
    }
  }
  if (!isRecord(value)) return defaultConfig();

  const browserVoice = optionalText(value.browserVoice);
  const baseUrl = optionalText(value.baseUrl);
  const apiKey = optionalText(value.apiKey);
  const model = optionalText(value.model);
  const voice = optionalText(value.voice);

  return {
    engine: value.engine === "openai-compatible" ? "openai-compatible" : "browser",
    rate: rateOf(value.rate),
    ...(browserVoice !== undefined ? { browserVoice } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(voice !== undefined ? { voice } : {}),
  };
}

export function loadTtsConfig(): TtsConfig {
  const storage = browserStorage();
  if (storage === null) return defaultConfig();
  try {
    const raw = storage.getItem(TTS_STORAGE_KEY);
    return raw === null ? defaultConfig() : parseTtsConfig(raw);
  } catch {
    return defaultConfig();
  }
}

export function saveTtsConfig(config: TtsConfig): void {
  const storage = browserStorage();
  if (storage === null) return;
  try {
    storage.setItem(TTS_STORAGE_KEY, JSON.stringify(parseTtsConfig(config)));
  } catch {
    // 隐私模式或配额满：配置存不下，但当前会话仍可继续使用
  }
}

/** 在线引擎缺哪些必填项；空数组表示可以发请求。设置页据此禁用「试听」。 */
export function ttsConfigIssues(config: TtsConfig): string[] {
  if (config.engine !== "openai-compatible") return [];

  const issues: string[] = [];
  const baseUrl = config.baseUrl?.trim() ?? "";
  if (baseUrl === "") {
    issues.push("API 地址");
  } else {
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        issues.push("API 地址（只支持 http/https）");
      } else if (
        typeof window !== "undefined" &&
        window.location?.protocol === "https:" &&
        url.protocol === "http:"
      ) {
        issues.push("API 地址（HTTPS 页面不能请求 HTTP）");
      }
    } catch {
      issues.push("API 地址（格式不合法）");
    }
  }

  if ((config.apiKey ?? "").trim() === "") issues.push("API Key");
  if ((config.model ?? "").trim() === "") issues.push("模型名");
  if ((config.voice ?? "").trim() === "") issues.push("音色");
  return issues;
}

/** 用户可能把完整端点粘进 baseUrl；这里避免拼成 /audio/speech/audio/speech。 */
export function ttsEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return /\/audio\/speech$/i.test(base) ? base : `${base}/audio/speech`;
}

// ── 文本清洗 ──────────────────────────────────────────────────────

function escapeEntity(entity: string): string {
  switch (entity) {
    case "&nbsp;":
      return " ";
    case "&amp;":
      return "&";
    case "&lt;":
      return "<";
    case "&gt;":
      return ">";
    case "&quot;":
      return '"';
    case "&#39;":
      return "'";
    default:
      return entity;
  }
}

/**
 * 清洗朗读文本。
 *
 * 只清「怎么读」层面的噪音，不改变语义：引用标记、Markdown 结构、代码块与链接
 * 都不该念出来。模型回答里的思考过程由调用方负责不传入。
 */
export function prepareSpeechText(text: string, maxChars = SPEECH_MAX_CHARS): SpeechText {
  let cleaned = text.replace(/\r\n?/g, "\n");

  // 代码块整段不读；流式回答里未闭合的围栏也直接截掉
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "\n");
  cleaned = cleaned.replace(/~~~[\s\S]*?~~~/g, "\n");
  cleaned = cleaned.replace(/```[\s\S]*$/g, "\n");
  cleaned = cleaned.replace(/~~~[\s\S]*$/g, "\n");

  // 链接保留文字，图片保留 alt
  cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // 引用抬头与编号：教材 / 讲义 / 上传资料 / 网页 / kcId
  cleaned = cleaned.replace(/[\[【](?:教材|讲义)(?:·[^\]】]*)?[\]】]/g, " ");
  cleaned = cleaned.replace(/[\[【]\s*(?:资料|网络)\s*\d+\s*[\]】]/gi, " ");
  cleaned = cleaned.replace(/[\[【][a-z][a-z0-9_]{0,15}[\]】]/gi, " ");

  // 裸链接与常见 HTML 实体
  cleaned = cleaned.replace(/https?:\/\/[^\s，。；！？、）)】\]}]+/gi, " ");
  cleaned = cleaned.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => escapeEntity(entity));

  // 行首结构：标题、引用、列表、表格分隔线
  cleaned = cleaned.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, "");
  cleaned = cleaned.replace(/^[ \t]{0,3}>[ \t]?/gm, "");
  cleaned = cleaned.replace(/^[ \t]{0,3}(?:[-*+•]|\d{1,2}[.、)）])[ \t]+/gm, "");
  cleaned = cleaned.replace(/^[ \t]*\|?[ \t:|-]+\|?[ \t]*$/gm, "");

  // 强调与删除线
  cleaned = cleaned.replace(/~~([^~\n]+)~~/g, "$1");
  cleaned = cleaned.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  cleaned = cleaned.replace(/__([^_\n]+)__/g, "$1");
  cleaned = cleaned.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, "$1");
  cleaned = cleaned.replace(/(?<![\w])_([^_\n]+)_(?![\w])/g, "$1");

  // 行内代码保留内容，去掉反引号
  cleaned = cleaned.replace(/`([^`\n]+)`/g, "$1");
  cleaned = cleaned.replace(/`/g, "");

  // 表格：先去掉行首尾竖线，再把单元格之间的竖线读成停顿
  cleaned = cleaned.replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, "$1");
  cleaned = cleaned.replace(/^[ \t]*\|[ \t]*/gm, "");
  cleaned = cleaned.replace(/[ \t]*\|[ \t]*$/gm, "");
  cleaned = cleaned.replace(/[ \t]*\|[ \t]*/g, "，");
  cleaned = cleaned.replace(/，{2,}/g, "，");

  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/^[，、]+|[，、]+$/g, "");
  cleaned = cleaned.replace(/\s+([，。！？；：、）】」』])/g, "$1");
  cleaned = cleaned.replace(/([（【「『])\s+/g, "$1");
  cleaned = cleaned.replace(/[\[【]\s*[\]】]/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : SPEECH_MAX_CHARS;
  const points = Array.from(cleaned);
  if (points.length <= limit) return { text: cleaned, truncated: false };
  return { text: points.slice(0, limit).join("").trimEnd(), truncated: true };
}

export function cleanTextForSpeech(text: string, maxChars = SPEECH_MAX_CHARS): string {
  return prepareSpeechText(text, maxChars).text;
}

// ── 播放状态 ──────────────────────────────────────────────────────

type AudioCtor = new (src?: string) => HTMLAudioElement;

interface AudioSession {
  readonly audio: HTMLAudioElement;
  readonly url: string;
  /** 停止时调用；幂等。 */
  readonly cancel: () => void;
}

let activeAudio: AudioSession | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let browserFinish: (() => void) | null = null;
let remoteFetch: AbortController | null = null;
/** 每次 stop 自增；异步链路回来时据此确认自己仍是当前会话。 */
let generation = 0;

function speechApi(): SpeechSynthesis | null {
  const api = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return api !== undefined && typeof api.speak === "function" ? api : null;
}

function utteranceCtor(): typeof SpeechSynthesisUtterance | null {
  const ctor = (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
    .SpeechSynthesisUtterance;
  return typeof ctor === "function" ? ctor : null;
}

function audioCtor(): AudioCtor | null {
  const ctor = (globalThis as { Audio?: AudioCtor }).Audio;
  return typeof ctor === "function" ? ctor : null;
}

function createObjectUrl(blob: Blob): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  try {
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

function revokeObjectUrl(url: string): void {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // 已经 revoke 过或环境不支持，忽略
  }
}

function findBrowserVoice(name: string | undefined): SpeechSynthesisVoice | undefined {
  const wanted = name?.trim();
  if (wanted === undefined || wanted === "") return undefined;
  const voices = listBrowserVoices();
  return voices.find((voice) => voice.name === wanted) ?? voices.find((voice) => voice.voiceURI === wanted);
}

export function listBrowserVoices(): SpeechSynthesisVoice[] {
  const api = speechApi();
  if (api === null || typeof api.getVoices !== "function") return [];
  try {
    return api.getVoices();
  } catch {
    return [];
  }
}

/** 系统音色列表异步就绪；设置页订阅后重新 listBrowserVoices()。 */
export function subscribeBrowserVoices(listener: () => void): () => void {
  const api = speechApi();
  if (api === null || typeof api.addEventListener !== "function") return () => {};
  api.addEventListener("voiceschanged", listener);
  return () => {
    try {
      api.removeEventListener("voiceschanged", listener);
    } catch {
      // ignore
    }
  };
}

export function isSpeaking(): boolean {
  const api = speechApi();
  if (api !== null && (api.speaking || api.pending)) return true;
  const session = activeAudio;
  return session !== null && session.audio.paused === false;
}

export function stopSpeaking(): void {
  generation += 1;

  const finish = browserFinish;
  browserFinish = null;
  activeUtterance = null;
  const api = speechApi();
  try {
    api?.cancel();
  } catch {
    // 某些浏览器在未朗读时 cancel 也会抛错
  }
  finish?.();

  const session = activeAudio;
  activeAudio = null;
  session?.cancel();

  const controller = remoteFetch;
  remoteFetch = null;
  try {
    controller?.abort();
  } catch {
    // ignore
  }
}

// ── 浏览器语音 ────────────────────────────────────────────────────

/**
 * 用系统语音朗读；Promise 在读完、出错或被 stopSpeaking 打断时 resolve。
 * 不 reject：朗读失败不应变成页面的未处理异常。
 */
export async function speakBrowser(text: string, config: TtsConfig): Promise<void> {
  const spoken = prepareSpeechText(text).text;
  stopSpeaking();
  if (spoken === "") return;

  const api = speechApi();
  const Utterance = utteranceCtor();
  if (api === null || Utterance === null) return;

  const utterance = new Utterance(spoken);
  const voice = findBrowserVoice(config.browserVoice);
  if (voice !== undefined) {
    utterance.voice = voice;
    utterance.lang = voice.lang !== "" ? voice.lang : "zh-CN";
  } else {
    utterance.lang = "zh-CN";
  }
  utterance.rate = clampRate(config.rate);
  activeUtterance = utterance;

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (browserFinish === finish) browserFinish = null;
      if (activeUtterance === utterance) activeUtterance = null;
      resolve();
    };

    browserFinish = finish;
    utterance.onend = finish;
    utterance.onerror = finish;
    try {
      api.speak(utterance);
    } catch {
      finish();
    }
  });
}

// ── 在线语音 ──────────────────────────────────────────────────────

const REMOTE_TIMEOUT_MS = 30_000;

type RemoteRequest =
  | { readonly kind: "audio"; readonly blob: Blob }
  | { readonly kind: "error"; readonly reason: string }
  | { readonly kind: "aborted" };

type PlayOutcome =
  | { readonly kind: "ended" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "error"; readonly reason: string };

function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const anySignal = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anySignal === "function") return anySignal([a, b]);
  if (a.aborted) return a;
  if (b.aborted) return b;

  const controller = new AbortController();
  const abort = () => controller.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function httpReason(status: number): string {
  if (status === 401 || status === 403) return "密钥无效或无权限";
  if (status === 404) return "端点或模型不存在";
  if (status === 429) return "请求过于频繁或额度不足";
  if (status >= 500) return "语音服务暂时不可用";
  return "请求被拒绝";
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

function playFailureReason(error: unknown): string {
  const name = errorName(error);
  if (name === "NotAllowedError") {
    return "浏览器阻止了自动播放，已改用浏览器内置语音";
  }
  if (name === "NotSupportedError") {
    return "在线语音的音频格式不受支持，已改用浏览器内置语音";
  }
  return "在线语音播放失败，已改用浏览器内置语音";
}

async function requestRemoteSpeech(
  input: string,
  config: TtsConfig,
  signal: AbortSignal | undefined,
): Promise<RemoteRequest> {
  if (typeof fetch !== "function") {
    return { kind: "error", reason: "当前环境不支持网络请求，已改用浏览器内置语音" };
  }

  const controller = new AbortController();
  remoteFetch = controller;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REMOTE_TIMEOUT_MS);
  const requestSignal = signal !== undefined ? combineSignals(signal, controller.signal) : controller.signal;

  try {
    const res = await fetch(ttsEndpoint(config.baseUrl ?? ""), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(config.apiKey ?? "").trim()}`,
      },
      body: JSON.stringify({
        model: (config.model ?? "").trim(),
        voice: (config.voice ?? "").trim(),
        input,
        response_format: "mp3",
        speed: clampRate(config.rate),
      }),
      signal: requestSignal,
    });

    if (!res.ok) {
      return {
        kind: "error",
        reason: `在线语音请求失败（HTTP ${res.status}：${httpReason(res.status)}），已改用浏览器内置语音`,
      };
    }

    const contentType = res.headers?.get("content-type") ?? "";
    if (/application\/json|text\//i.test(contentType)) {
      return {
        kind: "error",
        reason: "在线语音返回的不是音频（可能是错误信息），已改用浏览器内置语音",
      };
    }

    const blob = await res.blob();
    if (blob.size === 0) {
      return { kind: "error", reason: "在线语音返回了空音频，已改用浏览器内置语音" };
    }
    if (controller.signal.aborted) return { kind: "aborted" };
    return { kind: "audio", blob };
  } catch {
    if (signal?.aborted) return { kind: "aborted" };
    if (controller.signal.aborted) {
      return timedOut
        ? { kind: "error", reason: "在线语音请求超时（30 秒），已改用浏览器内置语音" }
        : { kind: "aborted" };
    }
    // fetch 抛 TypeError 的常见原因就是 CORS（混合内容在设置页已拦截）
    return { kind: "error", reason: "该语音服务不允许浏览器直连，已改用浏览器内置语音" };
  } finally {
    clearTimeout(timer);
    if (remoteFetch === controller) remoteFetch = null;
  }
}

function playAudioBlob(blob: Blob, token: number, signal?: AbortSignal): Promise<PlayOutcome> {
  const Ctor = audioCtor();
  if (Ctor === null) {
    return Promise.resolve({ kind: "error", reason: "当前浏览器不支持音频播放，已改用浏览器内置语音" });
  }

  const url = createObjectUrl(blob);
  if (url === null) {
    return Promise.resolve({
      kind: "error",
      reason: "无法为在线语音创建播放地址，已改用浏览器内置语音",
    });
  }

  let audio: HTMLAudioElement;
  try {
    audio = new Ctor(url);
  } catch {
    revokeObjectUrl(url);
    return Promise.resolve({ kind: "error", reason: "在线语音播放器初始化失败，已改用浏览器内置语音" });
  }

  return new Promise<PlayOutcome>((resolve) => {
    let done = false;
    let onAbort: (() => void) | null = null;
    const finish = (outcome: PlayOutcome) => {
      if (done) return;
      done = true;
      if (onAbort !== null) signal?.removeEventListener("abort", onAbort);
      if (activeAudio?.audio === audio) activeAudio = null;
      try {
        audio.pause();
      } catch {
        // ignore
      }
      try {
        audio.removeAttribute("src");
      } catch {
        // ignore
      }
      try {
        audio.load();
      } catch {
        // ignore
      }
      revokeObjectUrl(url);
      resolve(outcome);
    };

    onAbort = () => finish({ kind: "cancelled" });
    signal?.addEventListener("abort", onAbort, { once: true });

    // stopSpeaking / 调用方 signal 可能发生在 fetch 返回与创建播放器之间
    if (signal?.aborted) {
      finish({ kind: "cancelled" });
      return;
    }
    if (token !== generation) {
      finish({ kind: "cancelled" });
      return;
    }

    activeAudio = { audio, url, cancel: () => finish({ kind: "cancelled" }) };
    audio.onended = () => finish({ kind: "ended" });
    audio.onerror = () =>
      finish({ kind: "error", reason: "在线语音播放失败（音频格式不受支持），已改用浏览器内置语音" });

    let played: Promise<void> | void;
    try {
      played = audio.play();
    } catch (error) {
      finish({ kind: "error", reason: playFailureReason(error) });
      return;
    }
    if (played !== undefined) {
      played.catch((error: unknown) => {
        if (errorName(error) === "AbortError") {
          finish({ kind: "cancelled" });
        } else {
          finish({ kind: "error", reason: playFailureReason(error) });
        }
      });
    }
  });
}

/**
 * 在线朗读。Promise 在音频读完、失败回退浏览器语音读完、或被停止时 resolve。
 * 在线失败不会 reject，而是回退浏览器语音并返回 fallbackReason。
 */
export async function speakRemote(
  text: string,
  config: TtsConfig,
  signal?: AbortSignal,
): Promise<SpeakRemoteResult> {
  const spoken = prepareSpeechText(text).text;
  if (spoken === "") return { ok: false };
  if (signal?.aborted) return { ok: false };

  if (config.engine !== "openai-compatible") {
    await speakBrowser(spoken, config);
    return { ok: true };
  }

  const issues = ttsConfigIssues(config);
  if (issues.length > 0) {
    await speakBrowser(spoken, config);
    return {
      ok: false,
      fallbackReason: `在线语音配置不完整（缺少${issues.join("、")}），已改用浏览器内置语音`,
    };
  }

  stopSpeaking();
  const token = generation;

  const request = await requestRemoteSpeech(spoken, config, signal);
  if (request.kind === "aborted") return { ok: false };
  if (request.kind === "error") {
    if (token !== generation) return { ok: false };
    await speakBrowser(spoken, config);
    return { ok: false, fallbackReason: request.reason };
  }

  const played = await playAudioBlob(request.blob, token, signal);
  if (played.kind === "ended") return { ok: true };
  if (played.kind === "cancelled") return { ok: false };

  if (token !== generation) return { ok: false };
  await speakBrowser(spoken, config);
  return { ok: false, fallbackReason: played.reason };
}
