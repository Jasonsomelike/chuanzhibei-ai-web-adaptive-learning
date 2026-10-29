/**
 * 服务端语音合成：MiMo 的 chat/completions 音频模态 + OpenAI 兼容 /audio/speech。
 *
 * 边界：
 * - 两套协议不能混用。MiMo 只走 `{baseUrl}/chat/completions`（请求带
 *   modalities/audio，音频在 choices[0].message.audio.data）；其余供应商走
 *   `{baseUrl}/audio/speech`。调用方用 api=mimo|speech 明确选一条路。
 * - 所有请求都经 ssrfGuard.guardedRequest：地址必须过 assertUpstreamAllowed
 *   （只允许 https，DNS 解析后逐条拒绝环回/私网/链路本地/云元数据，连接钉在
 *   已判定的 IP 上），重定向一律不跟随。
 * - 60 秒超时、10MB 响应上限；超限与超时都抛可分类错误，绝不把半个音频
 *   当成功返回。
 * - 错误信息只带截断并脱敏的上游正文；密钥永远不进 message。
 */

import {
  assertUpstreamAllowed,
  guardedRequest,
  SsrfGuardError,
  UpstreamRequestError,
  type AllowedTarget,
  type GuardedResponse,
} from "@/lib/ssrfGuard";
import {
  buildMimoTtsBody,
  decodeBase64Audio,
  mimoEndpoint,
  parseMimoTtsResponse,
  MIMO_AUDIO_MIME,
} from "@/lib/mimo";
import { ttsEndpoint } from "@/lib/tts";

export const TTS_TIMEOUT_MS = 60_000;
export const MAX_TTS_RESPONSE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MIMO_VOICE = "茉莉";

/** 上游错误正文保留长度；够定位问题即可。 */
const MAX_DETAIL_CHARS = 200;
/** 非 2xx 时最多读取多少字节用于报错。 */
const MAX_ERROR_DETAIL_BYTES = 2048;

export interface TtsRow {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model?: string;
  readonly voice?: string;
  /** mimo | speech；缺省时按 protocol / baseUrl 推断。 */
  readonly api?: string;
  readonly protocol?: string;
}

export type TtsApi = "mimo" | "speech";

export type TtsErrorKind =
  | "blocked" // 地址不安全或域名不可解析
  | "config" // 行里缺 model / baseUrl / apiKey
  | "auth" // 上游 401/403
  | "rate-limit" // 上游 429
  | "timeout" // 60 秒未响应
  | "http" // 其余非 2xx、重定向、网络不可达
  | "parse" // JSON / base64 / 音频字段不合法
  | "empty" // 上游返回空音频
  | "too-large"; // 超过 10MB

export class TtsUpstreamError extends Error {
  readonly kind: TtsErrorKind;
  readonly status: number | null;

  constructor(kind: TtsErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "TtsUpstreamError";
    this.kind = kind;
    this.status = status;
  }
}

export interface SynthesizedAudio {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: string;
}

/** 传给 ssrfGuard 的传输参数；测试据此断言 60s / 10MB 没有被改掉。 */
export interface TtsTransportOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

function sanitize(raw: string, secrets: readonly string[]): string {
  let text = raw.replace(/\s+/g, " ").trim();
  for (const secret of secrets) {
    if (secret.trim() === "") continue;
    text = text.split(secret).join("***");
  }
  return text.slice(0, MAX_DETAIL_CHARS);
}

function httpFailure(
  status: number,
  detail: string,
  secrets: readonly string[],
): TtsUpstreamError {
  const suffix = detail === "" ? "" : `：${sanitize(detail, secrets)}`;
  if (status === 401 || status === 403) {
    return new TtsUpstreamError("auth", `语音供应商拒绝了密钥（HTTP ${status}）${suffix}`, status);
  }
  if (status === 429) {
    return new TtsUpstreamError(
      "rate-limit",
      `语音供应商限流或额度不足（HTTP 429）${suffix}`,
      status,
    );
  }
  return new TtsUpstreamError("http", `语音合成失败（HTTP ${status}）${suffix}`, status);
}

function translateTransportError(
  error: unknown,
  timeoutMs: number,
  maxBytes: number,
): TtsUpstreamError {
  if (error instanceof SsrfGuardError) {
    return new TtsUpstreamError("blocked", `语音服务地址不可用：${error.message}`);
  }
  if (error instanceof UpstreamRequestError) {
    switch (error.reason) {
      case "timeout":
        return new TtsUpstreamError(
          "timeout",
          `语音合成超时（${Math.round(timeoutMs / 1000)} 秒）`,
        );
      case "too-large":
        return new TtsUpstreamError(
          "too-large",
          `语音响应超过 ${Math.round(maxBytes / (1024 * 1024))}MB 上限`,
        );
      case "aborted":
        return new TtsUpstreamError("http", "语音请求已取消");
      case "network":
        return new TtsUpstreamError("http", "语音服务网络不可达");
    }
  }
  return new TtsUpstreamError("http", "语音合成失败");
}

function headerText(res: GuardedResponse, name: string): string {
  const raw = res.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? "").toLowerCase();
}

function toBytes(body: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(body);
}

/**
 * 校验地址并发请求。非 2xx 在这里统一转成 TtsUpstreamError，
 * 调用方只处理 2xx 的正文。
 */
async function postAudio(
  baseUrl: string,
  headers: Readonly<Record<string, string>>,
  body: string,
  secrets: readonly string[],
  options: TtsTransportOptions,
): Promise<GuardedResponse> {
  const timeoutMs = options.timeoutMs ?? TTS_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_TTS_RESPONSE_BYTES;

  let target: AllowedTarget;
  try {
    target = await assertUpstreamAllowed(baseUrl);
  } catch (error) {
    throw translateTransportError(error, timeoutMs, maxBytes);
  }

  let res: GuardedResponse;
  try {
    res = await guardedRequest(target, {
      method: "POST",
      headers,
      body,
      timeoutMs,
      maxBytes,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  } catch (error) {
    throw translateTransportError(error, timeoutMs, maxBytes);
  }

  if (res.status >= 300 && res.status < 400) {
    throw new TtsUpstreamError(
      "http",
      `语音供应商返回了重定向（HTTP ${res.status}），已拒绝跟随`,
      res.status,
    );
  }
  if (res.status < 200 || res.status >= 300) {
    const detail = res.body.subarray(0, MAX_ERROR_DETAIL_BYTES).toString("utf8");
    throw httpFailure(res.status, detail, secrets);
  }
  return res;
}

/**
 * 行里的 api 字段归一；只认 mimo | speech。
 *
 * 注意 /api/config 把 tts 的 `api` 列存成引擎（browser / openai-compatible），
 * 真正的协议在 options.protocol（speech / chat-audio）。因此 protocol 必须先于
 * 「openai-compatible 就一定是 /audio/speech」这种猜测——否则 MiMo 会被送去
 * 它明确返回 404 的 /audio/speech。
 */
export function resolveTtsApi(row: Pick<TtsRow, "api" | "protocol" | "baseUrl">): TtsApi {
  const api = (row.api ?? "").trim().toLowerCase();
  if (api === "mimo" || api === "chat-audio" || api === "chat_audio") return "mimo";
  if (api === "speech") return "speech";

  const protocol = (row.protocol ?? "").trim().toLowerCase();
  if (protocol === "chat-audio" || protocol === "chat_audio") return "mimo";
  if (protocol === "speech") return "speech";

  // 老配置没有 protocol 字段：mimo 的地址里通常带 mimo，其余按 speech 处理。
  return /mimo/i.test(row.baseUrl) ? "mimo" : "speech";
}

function requireText(value: string | undefined, label: string): string {
  const text = (value ?? "").trim();
  if (text === "") throw new TtsUpstreamError("config", `语音配置缺少${label}`);
  return text;
}

function parseAudioJson(bytes: Uint8Array<ArrayBuffer>, secrets: readonly string[]): unknown {
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TtsUpstreamError(
      "parse",
      `语音供应商返回了无法解析的数据${text === "" ? "" : `：${sanitize(text, secrets)}`}`,
    );
  }
}

/**
 * MiMo：POST {baseUrl}/chat/completions。
 *
 * 路径由 mimoEndpoint 唯一决定，测试断言它绝不能出现 /audio/speech。
 */
export async function synthesizeMimo(
  row: TtsRow,
  text: string,
  voice?: string,
  options: TtsTransportOptions = {},
): Promise<SynthesizedAudio> {
  const baseUrl = requireText(row.baseUrl, "服务地址");
  const apiKey = requireText(row.apiKey, "密钥");
  const model = requireText(row.model, "模型名");
  const chosenVoice = (voice ?? row.voice ?? DEFAULT_MIMO_VOICE).trim() || DEFAULT_MIMO_VOICE;

  const endpoint = mimoEndpoint(baseUrl);
  if (endpoint === "") throw new TtsUpstreamError("config", "语音配置缺少服务地址");

  const res = await postAudio(
    endpoint,
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    JSON.stringify(buildMimoTtsBody({ model, text, voice: chosenVoice })),
    [apiKey],
    options,
  );

  const parsed = parseAudioJson(toBytes(res.body), [apiKey]);
  const data = parseMimoTtsResponse(parsed);
  if (data === null) {
    throw new TtsUpstreamError("parse", "MiMo 响应里没有音频数据");
  }
  const bytes = decodeBase64Audio(data);
  if (bytes === null) {
    throw new TtsUpstreamError("parse", "MiMo 返回的音频 base64 无法解码");
  }
  if (bytes.byteLength === 0) {
    throw new TtsUpstreamError("empty", "MiMo 返回了空音频");
  }
  return { bytes, contentType: MIMO_AUDIO_MIME };
}

/** OpenAI 兼容 /audio/speech：直接返回音频字节，不解析 JSON。 */
export async function synthesizeSpeech(
  row: TtsRow,
  text: string,
  options: TtsTransportOptions = {},
): Promise<SynthesizedAudio> {
  const baseUrl = requireText(row.baseUrl, "服务地址");
  const apiKey = requireText(row.apiKey, "密钥");
  const model = requireText(row.model, "模型名");

  const res = await postAudio(
    ttsEndpoint(baseUrl),
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    JSON.stringify({
      model,
      voice: (row.voice ?? "").trim(),
      input: text,
      response_format: "mp3",
      speed: 1,
    }),
    [apiKey],
    options,
  );

  const contentType = headerText(res, "content-type");
  if (/application\/json|text\//i.test(contentType)) {
    throw new TtsUpstreamError("parse", "语音端点返回的不是音频（可能是错误信息）");
  }
  const bytes = toBytes(res.body);
  if (bytes.byteLength === 0) {
    throw new TtsUpstreamError("empty", "语音端点返回了空音频");
  }

  return {
    bytes,
    contentType: contentType.startsWith("audio/")
      ? contentType.split(";")[0].trim()
      : "audio/mpeg",
  };
}
