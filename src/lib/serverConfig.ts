/**
 * 调用模式与账号级供应商配置。
 *
 * 两种模式：
 * - server（默认）：密钥加密存在账号里，对话 / 搜索 / 语音由本项目服务端代发；
 * - local：配置只在本浏览器 localStorage，请求由浏览器直连供应商（BYOK）。
 *
 * 边界：
 * - GET /api/config 只返回掩码 hint，任何字段都不含明文密钥；本模块也不缓存密钥。
 * - 模式键是 alp.callmode.v1。不能复用 alp.mode：后者是明暗模式（themes.ts）。
 * - 所有 localStorage 读写都包 try/catch：隐私模式、配额耗尽时页面仍能打开。
 * - 本模块的存储键与 searchClient / tts 各自的键互不复用，清除时要分别调用各自的
 *   clear 函数（设置页的「清除」按钮就是这么做的）。
 */

import type { ProviderConfig, ProviderKind, ThinkingStatus } from "@/lib/provider";
import type { ThinkingStrength } from "@/lib/reasoning";

export type CallMode = "server" | "local";

export const CALL_MODE_KEY = "alp.callmode.v1";
/** 默认走服务端：未登录时由界面降级为本机模式，但存储值不擅自改写。 */
export const DEFAULT_CALL_MODE: CallMode = "server";

export const CONFIG_KINDS = ["llm", "search-deepseek", "search-tavily", "tts"] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];

/** options 是公开白名单字段（userSecrets.SECRET_OPTION_KEYS），不含任何密钥。 */
export type ServerConfigOptions = Readonly<Record<string, string | number | boolean>>;

export interface ServerConfigEntry {
  readonly configured: boolean;
  /** 已存密钥的掩码（只露末 4 位）；未配置时为空串。 */
  readonly hint: string;
  readonly label: string;
  /** 对 llm 是协议，对搜索是供应商，对 tts 是引擎。 */
  readonly api: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly options: ServerConfigOptions;
  readonly updatedAt: string;
}

export type ServerConfigs = Readonly<Record<ConfigKind, ServerConfigEntry>>;

/** 账号里 llm 行的可解释结果；provider 只在 server 模式且配置齐全时非 null。 */
export interface ServerProviderState {
  readonly mode: CallMode;
  readonly serverConfigured: boolean;
  readonly provider: ProviderConfig | null;
  readonly label: string;
  readonly api: ProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly options: ServerLlmOptions;
}

export interface ServerLlmOptions {
  readonly thinking: ThinkingStrength;
  readonly thinkingStatus: ThinkingStatus;
  readonly verification: boolean;
  readonly embeddingBaseUrl?: string;
  readonly embeddingModel?: string;
}

// ── 存储 ──────────────────────────────────────────────────────────

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadCallMode(): CallMode {
  const store = browserStorage();
  if (store === null) return DEFAULT_CALL_MODE;
  try {
    return store.getItem(CALL_MODE_KEY) === "local" ? "local" : DEFAULT_CALL_MODE;
  } catch {
    return DEFAULT_CALL_MODE;
  }
}

export function saveCallMode(mode: CallMode): void {
  const store = browserStorage();
  if (store === null) return;
  try {
    store.setItem(CALL_MODE_KEY, mode === "local" ? "local" : "server");
  } catch {
    // 隐私模式或配额满：本次会话仍按内存里的选择工作
  }
}

// ── 错误 ──────────────────────────────────────────────────────────

export type ConfigErrorCode =
  | "UNAUTHORIZED"
  | "KEY_ENC_UNAVAILABLE"
  | "PERSISTENCE_UNAVAILABLE"
  | "CONFLICT_STALE"
  | "SECRET_UNREADABLE"
  | "INVALID"
  | "BAD_RESPONSE"
  | "NETWORK"
  | "INTERNAL";

export interface ConfigFailure {
  readonly ok: false;
  readonly code: ConfigErrorCode;
  readonly message: string;
}

/**
 * 错误码 → 人话。message 来自服务端时优先用它（已是不含密钥的中文短句），
 * 但两个 503 与 409 必须给出「怎么办」，不能只回显 code。
 */
export function explainConfigError(code: ConfigErrorCode, message?: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "登录后才能保存到账号。未登录时请切到「本机」模式，密钥只留在这个浏览器。";
    case "KEY_ENC_UNAVAILABLE":
      return "服务端没有配置密钥主密钥（ALP_SECRET_KEY），暂时无法加密保存。请联系部署者配置后再试。";
    case "PERSISTENCE_UNAVAILABLE":
      return "服务端当前使用内存存储，保存会随重启丢失，因此拒绝写入密钥。请改用持久化数据库或临时切到「本机」模式。";
    case "CONFLICT_STALE":
      return "配置在别处已被修改，请刷新页面后重新填写。";
    case "SECRET_UNREADABLE":
      return "已保存的密文无法解密（多为服务端更换了主密钥），请重新填写密钥。";
    case "INVALID":
      return message !== undefined && message !== "" ? message : "请求被服务端拒绝，请检查填写内容。";
    case "BAD_RESPONSE":
      return "服务端返回了无法识别的响应，请稍后重试。";
    case "NETWORK":
      return "无法连接服务端，请检查网络后重试。";
    case "INTERNAL":
      return message !== undefined && message !== "" ? message : "服务端处理失败，请稍后再试。";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 两种错误体都要认：路由的 {error:{code,message}} 与搜索/TTS 的 {error,code}。 */
function errorOf(body: unknown): { code: string; message: string } {
  if (!isRecord(body)) return { code: "", message: "" };
  const nested = body.error;
  if (isRecord(nested)) {
    return { code: textOf(nested.code), message: textOf(nested.message) };
  }
  return { code: textOf(body.code), message: textOf(body.error) };
}

function knownCode(code: string): ConfigErrorCode | null {
  switch (code) {
    case "UNAUTHORIZED":
    case "KEY_ENC_UNAVAILABLE":
    case "PERSISTENCE_UNAVAILABLE":
    case "CONFLICT_STALE":
    case "SECRET_UNREADABLE":
    case "BAD_RESPONSE":
    case "NETWORK":
    case "INTERNAL":
      return code;
    case "unauthorized":
      return "UNAUTHORIZED";
    case "bad_request":
    case "payload_too_large":
      return "INVALID";
    case "internal":
      return "INTERNAL";
    default:
      return null;
  }
}

function fail(code: ConfigErrorCode, message?: string): ConfigFailure {
  return { ok: false, code, message: explainConfigError(code, message) };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

// ── 响应形状 ──────────────────────────────────────────────────────

function emptyEntry(): ServerConfigEntry {
  return {
    configured: false,
    hint: "",
    label: "",
    api: "",
    baseUrl: "",
    model: "",
    options: {},
    updatedAt: "",
  };
}

function normalizeOptions(raw: unknown): ServerConfigOptions {
  if (!isRecord(raw)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

function parseEntry(raw: unknown): ServerConfigEntry {
  if (!isRecord(raw)) return emptyEntry();
  return {
    configured: raw.configured === true,
    hint: textOf(raw.hint),
    label: textOf(raw.label),
    api: textOf(raw.api),
    baseUrl: textOf(raw.baseUrl),
    model: textOf(raw.model),
    options: normalizeOptions(raw.options),
    updatedAt: textOf(raw.updatedAt),
  };
}

export function parseServerConfigs(raw: unknown): ServerConfigs {
  const source = isRecord(raw) ? raw : {};
  const out = {} as Record<ConfigKind, ServerConfigEntry>;
  for (const kind of CONFIG_KINDS) out[kind] = parseEntry(source[kind]);
  return out;
}

// ── 网络 ──────────────────────────────────────────────────────────

export type ConfigsResult =
  | { readonly ok: true; readonly configs: ServerConfigs }
  | ConfigFailure;

/** GET /api/config。401 单独成码，设置页据此提示「登录后可保存到账号」。 */
export async function fetchConfigs(signal?: AbortSignal): Promise<ConfigsResult> {
  let res: Response;
  try {
    res = await fetch("/api/config", { cache: "no-store", ...(signal ? { signal } : {}) });
  } catch {
    return fail("NETWORK");
  }

  const body = await readJson(res);
  if (res.status === 401) return fail("UNAUTHORIZED");

  if (!res.ok) {
    const { code, message } = errorOf(body);
    const mapped = knownCode(code);
    return fail(mapped ?? "INTERNAL", message === "" ? undefined : message);
  }

  if (!isRecord(body) || !("config" in body)) return fail("BAD_RESPONSE");
  return { ok: true, configs: parseServerConfigs(body.config) };
}

export interface LlmConfigInput {
  readonly provider: "llm";
  readonly label?: string;
  readonly kind: ProviderKind;
  readonly baseUrl: string;
  /** 缺省/空串表示沿用已存的密文，不会把明文再传一遍。 */
  readonly apiKey?: string;
  readonly model: string;
  readonly extraHeaders?: string;
  readonly thinking?: ThinkingStrength;
  readonly thinkingStatus?: ThinkingStatus;
  readonly verification?: boolean;
  readonly embeddingBaseUrl?: string;
  readonly embeddingModel?: string;
  readonly embeddingApiKey?: string;
}

export interface SearchDeepSeekConfigInput {
  readonly provider: "search-deepseek";
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

export interface SearchTavilyConfigInput {
  readonly provider: "search-tavily";
  readonly apiKey?: string;
}

export interface TtsConfigInput {
  readonly provider: "tts";
  readonly engine: "browser" | "openai-compatible";
  readonly protocol: "speech" | "chat-audio";
  readonly rate: number;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly voice?: string;
  readonly browserVoice?: string;
}

export type SaveConfigInput =
  | LlmConfigInput
  | SearchDeepSeekConfigInput
  | SearchTavilyConfigInput
  | TtsConfigInput;

export type SaveConfigResult =
  | { readonly ok: true; readonly entry: ServerConfigEntry }
  | ConfigFailure;

export async function saveConfig(
  input: SaveConfigInput,
  signal?: AbortSignal,
): Promise<SaveConfigResult> {
  let res: Response;
  try {
    res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      ...(signal ? { signal } : {}),
    });
  } catch {
    return fail("NETWORK");
  }

  const body = await readJson(res);
  if (res.status === 401) return fail("UNAUTHORIZED");

  if (!res.ok) {
    const { code, message } = errorOf(body);
    const mapped = knownCode(code);
    return fail(mapped ?? "INTERNAL", message === "" ? undefined : message);
  }

  if (!isRecord(body) || !isRecord(body.config)) return fail("BAD_RESPONSE");
  return { ok: true, entry: parseEntry(body.config) };
}

export type DeleteConfigResult =
  | { readonly ok: true; readonly deleted: boolean }
  | ConfigFailure;

/** DELETE /api/config?kind=。删除是幂等的：没删到行也返回 deleted=false。 */
export async function deleteConfig(
  kind: ConfigKind,
  signal?: AbortSignal,
): Promise<DeleteConfigResult> {
  let res: Response;
  try {
    res = await fetch(`/api/config?kind=${encodeURIComponent(kind)}`, {
      method: "DELETE",
      ...(signal ? { signal } : {}),
    });
  } catch {
    return fail("NETWORK");
  }

  const body = await readJson(res);
  if (res.status === 401) return fail("UNAUTHORIZED");

  if (!res.ok) {
    const { code, message } = errorOf(body);
    const mapped = knownCode(code);
    return fail(mapped ?? "INTERNAL", message === "" ? undefined : message);
  }

  return { ok: true, deleted: isRecord(body) && body.deleted === true };
}

// ── 解析 ──────────────────────────────────────────────────────────

function providerKindOf(api: string): ProviderKind {
  return api.trim() === "anthropic" ? "anthropic" : "openai-compatible";
}

function thinkingOf(value: unknown): ThinkingStrength {
  return value === "standard" || value === "deep" ? value : "off";
}

function thinkingStatusOf(value: unknown): ThinkingStatus {
  return value === "verified" || value === "verified-empty" || value === "unsupported"
    ? value
    : "unknown";
}

function optionalText(value: unknown): string | undefined {
  const text = textOf(value).trim();
  return text === "" ? undefined : text;
}

export function parseLlmOptions(options: ServerConfigOptions): ServerLlmOptions {
  const embeddingBaseUrl = optionalText(options.embeddingBaseUrl);
  const embeddingModel = optionalText(options.embeddingModel);
  return {
    thinking: thinkingOf(options.thinking),
    thinkingStatus: thinkingStatusOf(options.thinkingStatus),
    verification: options.verification !== false,
    ...(embeddingBaseUrl !== undefined ? { embeddingBaseUrl } : {}),
    ...(embeddingModel !== undefined ? { embeddingModel } : {}),
  };
}

/**
 * 由「当前模式 + GET /api/config 的结果」决定界面与调用链用哪套配置。
 *
 * 纯函数：不读存储、不发请求。没有 llm 行（或删除后）时 serverConfigured=false
 * 且 provider=null，调用方必须回到本机模式或提示去保存，不能拿空配置去发请求。
 *
 * server 模式下返回的 ProviderConfig 故意把 apiKey 留空：密钥只在服务端，
 * 这个对象只用于界面回显与 protoc 判断，绝不能拿去浏览器直连。
 */
export function applyServerConfigToProvider(
  current: CallMode,
  configs: ServerConfigs | null,
): ServerProviderState {
  const entry = configs?.llm ?? emptyEntry();
  const options = parseLlmOptions(entry.options);
  const baseUrl = entry.baseUrl.trim();
  const model = entry.model.trim();
  const serverConfigured = entry.configured && baseUrl !== "" && model !== "";
  const label = entry.label.trim() === "" ? "账号配置" : entry.label.trim();
  const api = providerKindOf(entry.api);

  const provider: ProviderConfig | null =
    current === "server" && serverConfigured
      ? {
          label,
          kind: api,
          baseUrl: baseUrl.replace(/\/+$/, ""),
          apiKey: "",
          model,
          thinking: options.thinking,
          thinkingStatus: options.thinkingStatus,
          verification: options.verification,
        }
      : null;

  return {
    mode: current,
    serverConfigured,
    provider,
    label,
    api,
    baseUrl,
    model,
    options,
  };
}

export type HydrateResult =
  | {
      readonly ok: true;
      readonly state: ServerProviderState;
      readonly error: null;
    }
  | {
      readonly ok: false;
      readonly state: ServerProviderState;
      readonly error: ConfigFailure;
    };

/**
 * 挂载时把账号里的配置读回来。
 *
 * 失败也返回可用的 state（mode 保留、provider=null），界面据此显示
 * 「未配置 / 未登录」而不是白屏；error 里有可直接展示的人话。
 */
export async function hydrateProviderFromServer(
  mode: CallMode,
  signal?: AbortSignal,
): Promise<HydrateResult> {
  const result = await fetchConfigs(signal);
  if (!result.ok) {
    return { ok: false, state: applyServerConfigToProvider(mode, null), error: result };
  }
  return { ok: true, state: applyServerConfigToProvider(mode, result.configs), error: null };
}
