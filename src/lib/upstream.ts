/**
 * 服务端代发上游请求的构造层：请求体、请求头、端点、脱敏、SSE 透传，
 * 以及从 user_secrets 读回 llm 配置（含密钥解密）。
 *
 * 边界：
 * - 不发请求。真正的传输只有 ssrfGuard.guardedRequest，路由不得直接用 fetch。
 * - 上游响应字节原样转发（SSE 透传），中途出错才合成一条 data: {"error":...}，
 *   且 message 先过 redactSecrets，避免供应商把整个请求头（含 key）回显进错误体。
 * - 配置行由 userSecrets.ts 写入（AES-256-GCM + AAD 绑定 user/kind），
 *   这里只读：base_url / model / options_json 是明文列，apiKey / extraHeaders /
 *   embeddingApiKey 在解密后的 payload 里。解密失败按原因分级报错，
 *   绝不把「解不开」降级成「当没有密钥」。
 */

import { Readable } from "node:stream";

import { getDb } from "@/lib/db";
import {
  anthropicContentOf,
  buildChatBody,
  contentTextOf,
  ProviderCapabilityError,
  type ChatContent,
  type ChatToolChoice,
  type ChatToolDefinition,
  type ProviderKind,
} from "@/lib/provider";
import type { ThinkingStrength } from "@/lib/reasoning";
import { SecretCryptoError } from "@/lib/secretCrypto";
import {
  UserSecretError,
  loadUserSecret,
  parseSecretOptions,
  type LoadedUserSecret,
  type SecretOptions,
} from "@/lib/userSecrets";

// ── 请求体 ────────────────────────────────────────────────────────

export type UpstreamRole = "system" | "user" | "assistant" | "tool";

/** assistant 消息里的函数调用；字段名沿用 OpenAI wire format（snake_case）。 */
export interface UpstreamToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface UpstreamMessage {
  readonly role: UpstreamRole;
  readonly content: ChatContent;
  readonly tool_calls?: readonly UpstreamToolCall[];
  readonly tool_call_id?: string;
}

export interface UpstreamChatRequest {
  readonly messages: readonly UpstreamMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stream: boolean;
  /** 要求上游返回 JSON 对象；OpenAI 兼容协议写 response_format。 */
  readonly jsonMode?: boolean;
  /** 函数工具定义。只有 OpenAI 兼容协议会透传；Anthropic 收到时显式报错。 */
  readonly tools?: readonly ChatToolDefinition[];
  readonly toolChoice?: ChatToolChoice;
}

/** 拒绝用户通过 extraHeaders 覆盖的传输层头：它们会改变连接目标或分帧。 */
const FORBIDDEN_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "te",
  "trailer",
  "cookie",
]);

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * 过滤用户配置的额外请求头。
 *
 * 返回小写键名；非法 JSON 返回空对象（与 provider.ts 的 browser 直连行为一致），
 * 不因为一个可选字段把整次对话打断。头名不合法、值含 CR/LF、命中禁用名单的条目丢弃。
 */
export function filterExtraHeaders(raw: string | undefined): Record<string, string> {
  const text = (raw ?? "").trim();
  if (text === "") return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const key = name.trim().toLowerCase();
    if (!HEADER_NAME.test(key)) continue;
    if (FORBIDDEN_HEADERS.has(key) || key.startsWith("proxy-")) continue;
    if (key === "" || /[\r\n]/.test(value)) continue;
    out[key] = value;
  }
  return out;
}

/** 拼接协议端点。baseUrl 末尾斜杠会被去掉，避免 //chat/completions。 */
export function endpointFor(kind: ProviderKind, baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base === "") throw new Error("上游 baseUrl 为空");
  return `${base}${kind === "anthropic" ? "/messages" : "/chat/completions"}`;
}

/**
 * 构造上游对话请求体。
 *
 * 复用 provider.buildChatBody 的思考字段规则（以及 OpenAI 兼容协议的 jsonMode →
 * response_format、tools → tools/tool_choice）：浏览器直连与服务端代发必须写出同一份
 * 请求体，否则「设置页能用的思考档位 / JSON 模式 / 工具」切到服务端模式就失效。
 *
 * messages 不能再压成「一条 system + 最后一条 user」：工具轮依赖
 * assistant.tool_calls 与 role:"tool" 的 tool_call_id 一一对应，任何一条丢失，
 * 上游都会 400 或把工具结果当成普通用户输入。
 */
export function buildUpstreamChatBody(
  kind: ProviderKind,
  model: string,
  request: UpstreamChatRequest,
  strength: ThinkingStrength = "off",
): Record<string, unknown> {
  /*
   * system 可能带 parts。之前直接 join(content) 会把数组变成 "[object Object]"；
   * 这里只取文本片段，图片不会进 system（Anthropic 的 system 也只收字符串）。
   */
  const systemText = request.messages
    .filter((message) => message.role === "system")
    .map((message) => contentTextOf(message.content))
    .join("\n\n");

  if (kind === "anthropic" && request.messages.some(isToolMessage)) {
    throw new ProviderCapabilityError(
      "tools",
      "Anthropic 协议不支持工具消息（role=tool / assistant.tool_calls）：请换用 OpenAI 兼容模型",
    );
  }

  const dialogue = request.messages
    .filter((message) => message.role !== "system")
    .map(toOpenAiMessage);

  const lastUser = [...request.messages]
    .reverse()
    .find((message) => message.role === "user");
  const fallback = request.messages[request.messages.length - 1];
  const built = buildChatBody(
    kind,
    { model },
    {
      system: systemText === "" ? undefined : systemText,
      // 基底只用来复用思考/工具规则，messages 随后会被完整 dialogue 替换。
      user: contentTextOf(lastUser?.content ?? fallback?.content ?? ""),
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      jsonMode: request.jsonMode === true,
      ...(request.tools !== undefined ? { tools: request.tools } : {}),
      ...(request.toolChoice !== undefined ? { toolChoice: request.toolChoice } : {}),
    },
    strength,
  );

  const body = built.body;
  body.stream = request.stream;
  if (kind === "anthropic") {
    // Anthropic 的 system 在顶层，messages 里不能出现 system 角色；
    // 图片 parts 在这里转成 base64 image block，history 顺序保持不变。
    body.messages =
      dialogue.length > 0
        ? request.messages
            .filter((message) => message.role !== "system")
            .map((message) => ({
              role: message.role,
              content: anthropicContentOf(message.content),
            }))
        : [{ role: "user", content: "" }];
  } else {
    body.messages =
      systemText === "" ? dialogue : [{ role: "system", content: systemText }, ...dialogue];
  }
  return body;
}

/** 工具消息或带 tool_calls 的 assistant 消息：Anthropic 分支无法表达。 */
function isToolMessage(message: UpstreamMessage): boolean {
  return message.role === "tool" || (message.tool_calls?.length ?? 0) > 0;
}

function toOpenAiMessage(message: UpstreamMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    ...(message.tool_calls !== undefined ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id !== undefined ? { tool_call_id: message.tool_call_id } : {}),
  };
}

// ── 脱敏 ──────────────────────────────────────────────────────────

export interface RedactSecret {
  readonly apiKey?: string;
  readonly extraHeaders?: string;
  readonly embeddingApiKey?: string;
}

const REDACTED = "[redacted]";

/**
 * 把已知密钥与额外请求头的值替换成 [redacted]。
 *
 * 只替换长度 ≥ 4 的值：短值（如 "en"、"v1"）在正常文本里到处都是，
 * 替换它们会把错误信息毁掉，却挡不住任何真实泄露——真实的 key 远长于此。
 */
export function redactSecrets(text: string, secret: RedactSecret): string {
  let out = text;
  const values = new Set<string>();

  for (const value of [secret.apiKey, secret.embeddingApiKey]) {
    if (typeof value === "string" && value.length >= 4) values.add(value);
  }
  for (const value of Object.values(filterExtraHeaders(secret.extraHeaders))) {
    if (value.length >= 4) values.add(value);
  }

  // 长的先替换：短串恰好是长串前缀时，先替换长串才不会被切碎。
  for (const value of [...values].sort((a, b) => b.length - a.length)) {
    out = out.split(value).join(REDACTED);
  }

  // 兜底：上游有时回显 Authorization，但用户改过 key 后旧值已不在配置里。
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/-]{12,}=*/g, `Bearer ${REDACTED}`);
}

// ── SSE 透传 ──────────────────────────────────────────────────────

export interface SseProxyOptions {
  /** 客户端断开信号：一旦中止就取消读取并销毁上游。 */
  readonly signal?: AbortSignal;
  readonly secret?: RedactSecret;
  /** 心跳间隔；<= 0 关闭。默认 15 秒。 */
  readonly heartbeatMs?: number;
}

const HEARTBEAT_FRAME = ": ping\n\n";

/**
 * 把上游字节流原样包装成 Response body。
 *
 * 不解析、不重编码、不缓冲整段：SSE 的 data 帧可能被任意切开，逐块转发才能让
 * 首字延迟等于上游的首字延迟。唯一主动插入的帧是注释心跳，客户端会忽略它。
 *
 * 中途错误的处理顺序是硬要求：先 enqueue 一条 error 帧再 close。直接 close 会让
 * 客户端把「截断」当成正常结束，正文看起来像说了一半就没了。
 */
export function sseProxyStream(
  body: Readable | ReadableStream<Uint8Array>,
  options: SseProxyOptions = {},
): ReadableStream<Uint8Array> {
  const web = toWebStream(body);
  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? 15_000;

  let closed = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let onAbort: (() => void) | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const stamp = (): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(HEARTBEAT_FRAME));
        } catch {
          // controller 已关闭：心跳晚于结束，忽略
        }
      };

      if (heartbeatMs > 0) heartbeat = setInterval(stamp, heartbeatMs);

      const cleanup = (): void => {
        if (heartbeat !== null) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (onAbort !== null && options.signal) {
          options.signal.removeEventListener("abort", onAbort);
          onAbort = null;
        }
      };

      const close = (): void => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      };

      const fail = (err: unknown): void => {
        if (closed) return;
        const message = redactSecrets(
          err instanceof Error ? err.message : String(err),
          options.secret ?? {},
        );
        const frame = `data: ${JSON.stringify({ error: { message } })}\n\n`;
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // controller 已关闭
        }
        close();
      };

      const cancelUpstream = (): void => {
        if (closed) return;
        closed = true;
        cleanup();
        void reader?.cancel().catch(() => undefined);
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      };

      const streamReader = web.getReader();
      reader = streamReader;

      onAbort = cancelUpstream;
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted === true) cancelUpstream();

      const pump = async (): Promise<void> => {
        try {
          for (;;) {
            const { done, value } = await streamReader.read();
            if (closed) return;
            if (done) {
              close();
              return;
            }
            if (value !== undefined) controller.enqueue(value);
          }
        } catch (err) {
          fail(err);
        }
      };
      void pump();
    },

    cancel() {
      // 客户端断开（或响应被丢弃）：取消读取会销毁 Readable.toWeb 包装的 Node 流。
      closed = true;
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (onAbort !== null && options.signal) {
        options.signal.removeEventListener("abort", onAbort);
        onAbort = null;
      }
      void reader?.cancel().catch(() => undefined);
    },
  });
}

function toWebStream(
  body: Readable | ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  if (typeof (body as Readable).pipe === "function") {
    return Readable.toWeb(body as Readable) as unknown as ReadableStream<Uint8Array>;
  }
  return body as ReadableStream<Uint8Array>;
}

// ── 配置读取 ──────────────────────────────────────────────────────

export type LlmConfigErrorCode =
  | "CONFIG_MISSING"
  | "CONFIG_INVALID"
  | "SECRET_UNREADABLE"
  | "KEY_KID_UNKNOWN"
  | "KEY_ENC_UNAVAILABLE";

export class LlmConfigError extends Error {
  readonly code: LlmConfigErrorCode;

  constructor(code: LlmConfigErrorCode, message: string) {
    super(message);
    this.name = "LlmConfigError";
    this.code = code;
  }
}

export function isLlmConfigError(value: unknown): value is LlmConfigError {
  return value instanceof LlmConfigError;
}

export interface LlmOptions {
  readonly baseUrl: string;
  readonly model: string;
  /** 存在密文 payload 里：可能含 Authorization，因此不能放进 options_json。 */
  readonly extraHeaders?: string;
  readonly thinking?: ThinkingStrength;
  readonly embeddingBaseUrl?: string;
  readonly embeddingModel?: string;
}

export interface LlmSecrets {
  readonly apiKey: string;
  readonly embeddingApiKey?: string;
}

export interface LlmConfig {
  readonly api: ProviderKind;
  readonly options: LlmOptions;
  /** 解密后的密钥；绝不写日志、绝不进响应。 */
  readonly payload: LlmSecrets;
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function thinkingValue(options: SecretOptions): ThinkingStrength {
  const value = options["thinking"];
  return value === "standard" || value === "deep" ? value : "off";
}

function parseKind(raw: unknown): ProviderKind {
  if (raw === "anthropic") return "anthropic";
  if (raw === "openai-compatible") return "openai-compatible";
  throw new LlmConfigError("CONFIG_INVALID", `未知的供应商协议：${String(raw)}`);
}

/** 把 userSecrets / secretCrypto 的错误折成本路由的四个码；不认识的返回 null。 */
function toLlmConfigError(err: unknown): LlmConfigError | null {
  if (err instanceof SecretCryptoError) {
    switch (err.code) {
      case "KEY_ENC_UNAVAILABLE":
        return new LlmConfigError("KEY_ENC_UNAVAILABLE", err.message);
      case "KEY_KID_UNKNOWN":
        return new LlmConfigError("KEY_KID_UNKNOWN", err.message);
      case "SECRET_UNREADABLE":
        return new LlmConfigError("SECRET_UNREADABLE", err.message);
      default:
        return new LlmConfigError("CONFIG_INVALID", err.message);
    }
  }
  if (err instanceof UserSecretError) {
    return err.code === "SECRET_UNREADABLE"
      ? new LlmConfigError("SECRET_UNREADABLE", err.message)
      : new LlmConfigError("CONFIG_INVALID", err.message);
  }
  return null;
}

function toLlmConfig(loaded: LoadedUserSecret): LlmConfig {
  const { row, payload } = loaded;
  const api = parseKind(row.api);
  const baseUrl = textValue(row.base_url);
  const model = textValue(row.model);
  if (baseUrl === undefined || model === undefined) {
    throw new LlmConfigError("CONFIG_INVALID", "llm 配置缺 baseUrl 或 model");
  }
  if (payload.apiKey === undefined) {
    throw new LlmConfigError("SECRET_UNREADABLE", "配置里没有保存 apiKey");
  }

  const options = parseSecretOptions(row.options_json ?? "{}");
  const embeddingBaseUrl = textValue(options["embeddingBaseUrl"]);
  const embeddingModel = textValue(options["embeddingModel"]);

  return {
    api,
    options: {
      baseUrl,
      model,
      ...(payload.extraHeaders === undefined ? {} : { extraHeaders: payload.extraHeaders }),
      thinking: thinkingValue(options),
      ...(embeddingBaseUrl === undefined ? {} : { embeddingBaseUrl }),
      ...(embeddingModel === undefined ? {} : { embeddingModel }),
    },
    payload: {
      apiKey: payload.apiKey,
      ...(payload.embeddingApiKey === undefined
        ? {}
        : { embeddingApiKey: payload.embeddingApiKey }),
    },
  };
}

/**
 * 读当前用户的 llm 配置并解密。
 *
 * 行不存在是 CONFIG_MISSING（客户端该去设置页），不是上游故障；
 * 解密失败按 KEY_ENC_UNAVAILABLE / KEY_KID_UNKNOWN / SECRET_UNREADABLE 分级。
 */
export async function loadLlmConfigForUser(userId: string): Promise<LlmConfig> {
  const db = await getDb();
  let loaded: LoadedUserSecret | null;
  try {
    loaded = await loadUserSecret(db, userId, "llm");
  } catch (err) {
    throw toLlmConfigError(err) ?? err;
  }
  if (loaded === null) {
    throw new LlmConfigError("CONFIG_MISSING", "该账号还没有保存 llm 配置");
  }
  return toLlmConfig(loaded);
}
