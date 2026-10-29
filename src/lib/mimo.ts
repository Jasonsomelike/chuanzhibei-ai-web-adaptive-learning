/**
 * MiMo 语音合成：走 chat/completions 的音频模态。
 *
 * 与 OpenAI 兼容语音端点不是同一套协议，请求体与响应位置都不同：
 * 请求要带 modalities 与 audio 字段，音频以 base64 放在
 * choices[0].message.audio.data，而不是直接返回音频字节。
 * 混用两套协议会得到 404 或一段 JSON 被当成音频播放，所以这里只提供
 * 唯一正确的拼装与解析路径，不保留其他格式分支。
 *
 * 纯函数模块：不发请求、不碰 window / Audio，可在服务端与测试环境直接 import。
 */

export interface MimoTtsInput {
  readonly model: string;
  readonly text: string;
  readonly voice: string;
  /**
   * MiMo 的音频模态只产出 mp3；类型上锁死，避免调用方把旧配置里的
   * wav / opus 带进请求体。缺省等同于 "mp3"。
   */
  readonly format?: "mp3";
}

export interface MimoTtsBody {
  readonly model: string;
  readonly messages: readonly [
    { readonly role: "assistant"; readonly content: string },
  ];
  readonly modalities: readonly ["audio"];
  readonly audio: { readonly voice: string; readonly format: "mp3" };
}

/** 浏览器播放时给 Blob 用的 MIME；与 audio.format=mp3 保持一致。 */
export const MIMO_AUDIO_MIME = "audio/mpeg";

/** 已经带端点的地址原样返回，避免拼成 /chat/completions/chat/completions。 */
function hasChatPath(base: string): boolean {
  return /\/chat\/completions$/i.test(base);
}

/**
 * 由 API 根地址得到聊天补全端点。
 *
 * 空地址返回空串：相对路径不可能被 fetch，调用方应先做配置完整性校验，
 * 拿到空串就不要再发请求。
 */
export function mimoEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base === "") return "";
  return hasChatPath(base) ? base : `${base}/chat/completions`;
}

/** 严格产出 MiMo 音频模态的请求体；不接受的字段一个都不多写。 */
export function buildMimoTtsBody(input: MimoTtsInput): MimoTtsBody {
  return {
    model: input.model,
    messages: [{ role: "assistant", content: input.text }],
    modalities: ["audio"],
    audio: { voice: input.voice, format: "mp3" },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从聊天补全响应里取音频 base64。
 *
 * 形状不对、字段为空都返回 null，由调用方决定回退策略；
 * 这里不抛错，坏响应不该让朗读按钮变成未处理异常。
 */
export function parseMimoTtsResponse(raw: unknown): string | null {
  if (!isRecord(raw) || !Array.isArray(raw.choices)) return null;
  const first = raw.choices[0];
  if (!isRecord(first)) return null;

  const message = first.message;
  if (!isRecord(message)) return null;

  const audio = message.audio;
  if (!isRecord(audio)) return null;

  const data = audio.data;
  if (typeof data !== "string") return null;
  const trimmed = data.trim();
  return trimmed === "" ? null : trimmed;
}

/** 容忍 data URI 前缀与换行：不同网关对 base64 的包装不一致。 */
const DATA_URI_PREFIX = /^data:[^,]*;base64,/i;

/**
 * base64 → 音频字节。
 *
 * 非法字符、长度只差 1 位（base64 不可能出现）与解码异常都返回 null。
 * 返回 ArrayBuffer 背书的 Uint8Array，可直接作为 BlobPart 交给播放器。
 */
export function decodeBase64Audio(base64: string): Uint8Array<ArrayBuffer> | null {
  const raw = base64.trim().replace(DATA_URI_PREFIX, "").replace(/\s+/g, "");
  if (raw === "") return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) return null;
  // 余 1 位无法由任何字节序列编码出来，atob 在部分实现里会静默丢弃。
  if (raw.length % 4 === 1) return null;

  const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  if (typeof atob !== "function") return null;

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}
