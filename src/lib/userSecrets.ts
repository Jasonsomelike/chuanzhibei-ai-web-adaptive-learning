/**
 * user_secrets 访问层：加密落库、解密读取、对外公开形状。
 *
 * 边界：
 * - 明文只出现在 readSecretPayload 的返回值里；任何返回给浏览器的对象
 *   必须先经过 toPublicConfig，它只含白名单字段与掩码 hint。
 * - options_json 只存 SECRET_OPTION_KEYS 白名单里的非敏感字段（会进入 /api/config
 *   的公开响应）；apiKey / extraHeaders / embeddingApiKey 一律进密文。
 * - 内存后端默认拒绝写入：重启即丢、多实例各存各的，等于没保存。
 *   本地测试需要显式设 ALP_ALLOW_MEMORY_SECRETS=1。
 */

import { dbBackend, type Db } from "@/lib/db";
import {
  currentSecretKeyId,
  maskSecret,
  openSecret,
  sealSecret,
  secretHint,
  SecretCryptoError,
  type SecretEnv,
} from "@/lib/secretCrypto";

export { maskSecret };

// ── 类型与白名单 ──────────────────────────────────────────────────

/** configPut 的判别值，同时也是 user_secrets.kind 的取值。 */
export const SECRET_KINDS = ["llm", "search-deepseek", "search-tavily", "tts"] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

export function isSecretKind(value: string): value is SecretKind {
  return (SECRET_KINDS as readonly string[]).includes(value);
}

/**
 * options_json 的白名单。
 *
 * 这里只放「出现在公开响应里也不泄露任何凭据」的字段；
 * extraHeaders（可能含 Authorization）与任何 *ApiKey 都不在名单里。
 */
export const SECRET_OPTION_KEYS = [
  "contextWindowTokens", "responseReserveTokens", "retrievalMaxTokens",
  "embeddingBaseUrl",
  "embeddingModel",
  "embeddingStatus",
  "thinking",
  "thinkingStatus",
  "verification",
  "voice",
  "format",
  "protocol",
  "rate",
  "browserVoice",
] as const;
export type SecretOptionKey = (typeof SECRET_OPTION_KEYS)[number];
export type SecretOptionValue = string | number | boolean;
export type SecretOptions = Partial<Record<SecretOptionKey, SecretOptionValue>>;

/** 加密负载。字段固定，未知字段在写入时直接拒绝。 */
export interface SecretPayload {
  readonly apiKey?: string;
  /** 仅在服务端代发时使用，可能含 Authorization；因此只能进密文。 */
  readonly extraHeaders?: string;
  readonly embeddingApiKey?: string;
}

const PAYLOAD_KEYS = ["apiKey", "extraHeaders", "embeddingApiKey"] as const;

export type UserSecretErrorCode =
  | "INVALID_INPUT"
  | "INVALID_OPTIONS"
  | "SECRET_TOO_SHORT"
  | "SECRET_STORAGE_UNAVAILABLE"
  | "SECRET_UNREADABLE";

export class UserSecretError extends Error {
  readonly code: UserSecretErrorCode;

  constructor(code: UserSecretErrorCode, message: string) {
    super(message);
    this.name = "UserSecretError";
    this.code = code;
  }
}

/** 数据库行。字段名与 SCHEMA 一致；只有本模块与路由应该接触它。 */
export interface UserSecretRow {
  readonly user_id: string;
  readonly kind: string;
  readonly label: string;
  readonly api: string;
  readonly base_url: string;
  readonly model: string;
  readonly options_json: string;
  readonly secret_ct: string;
  readonly secret_iv: string;
  readonly secret_tag: string;
  readonly secret_kid: string;
  readonly secret_hint: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * 公开配置：可以直接 JSON 序列化给浏览器。
 *
 * 刻意没有 ct / iv / tag / apiKey / extraHeaders 字段——不是靠调用方记得删，
 * 而是类型上就不存在。
 */
export interface PublicUserSecret {
  readonly kind: SecretKind;
  readonly label: string;
  readonly api: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly options: SecretOptions;
  /** 掩码后的密钥末位（已存库的 hint，不重新解密）。 */
  readonly hint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveUserSecretInput {
  readonly kind: SecretKind;
  readonly label?: string;
  /** 对 llm 是协议（openai-compatible / anthropic），对搜索/TTS 是供应商或引擎标识。 */
  readonly api: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly options?: unknown;
  readonly payload?: unknown;
  /** 测试注入时钟；缺省用当前时间。 */
  readonly now?: string;
}

export interface LoadedUserSecret {
  readonly row: UserSecretRow;
  readonly payload: SecretPayload;
  /** 与 toPublicConfig(row) 相同，避免调用方自己再转一次。 */
  readonly config: PublicUserSecret;
}

// ── 输入清洗 ──────────────────────────────────────────────────────

/**
 * 写侧严格：未知字段直接报错，而不是悄悄丢掉。
 * 静默丢弃会让「用户以为保存了 extraHeaders / apiKey」与事实不符，
 * 而把未知字段原样写进公开列则可能泄露凭据——两种都不行。
 */
export function normalizeSecretOptions(raw: unknown): SecretOptions {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new UserSecretError("INVALID_OPTIONS", "options 必须是对象。");
  }

  const out: SecretOptions = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(SECRET_OPTION_KEYS as readonly string[]).includes(key)) {
      throw new UserSecretError(
        "INVALID_OPTIONS",
        `options 不接受字段 ${key}；密钥类字段（apiKey / extraHeaders）必须放在 payload 里加密。`,
      );
    }
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new UserSecretError("INVALID_OPTIONS", `options.${key} 只能是字符串、数字或布尔值。`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new UserSecretError("INVALID_OPTIONS", `options.${key} 不是有限数字。`);
    }
    out[key as SecretOptionKey] = value;
  }
  return out;
}

/** 读侧宽容：旧版本或手工改动可能留下坏 JSON，公开响应不应因此 500。 */
export function parseSecretOptions(json: string): SecretOptions {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const out: SecretOptions = {};
  for (const key of SECRET_OPTION_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

export function normalizeSecretPayload(raw: unknown): SecretPayload {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new UserSecretError("INVALID_INPUT", "payload 必须是对象。");
  }

  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(PAYLOAD_KEYS as readonly string[]).includes(key)) {
      throw new UserSecretError("INVALID_INPUT", `payload 不接受字段 ${key}。`);
    }
  }

  const out: { apiKey?: string; extraHeaders?: string; embeddingApiKey?: string } = {};
  for (const key of ["apiKey", "embeddingApiKey"] as const) {
    const value = record[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") {
      throw new UserSecretError("INVALID_INPUT", `payload.${key} 必须是字符串。`);
    }
    if (Array.from(value).length < 8) {
      throw new UserSecretError(
        "SECRET_TOO_SHORT",
        `${key} 至少 8 个字符；当前值过短，未保存任何内容。`,
      );
    }
    out[key] = value;
  }

  const headers = record.extraHeaders;
  if (headers !== undefined && headers !== null && headers !== "") {
    if (typeof headers !== "string") {
      throw new UserSecretError("INVALID_INPUT", "payload.extraHeaders 必须是字符串。");
    }
    if (headers.length > 2000) {
      throw new UserSecretError("INVALID_INPUT", "payload.extraHeaders 超过 2000 字符。");
    }
    if (headers.trim() !== "") out.extraHeaders = headers;
  }

  return out;
}

/** 读侧宽容：解密后的 JSON 由本模块写入，坏字段丢弃即可，不必让整条配置失效。 */
function parseSecretPayload(raw: unknown): SecretPayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new UserSecretError("SECRET_UNREADABLE", "解密后的内容不是对象，疑似损坏。");
  }
  const record = raw as Record<string, unknown>;
  const out: { apiKey?: string; extraHeaders?: string; embeddingApiKey?: string } = {};
  for (const key of ["apiKey", "embeddingApiKey"] as const) {
    const value = record[key];
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  if (typeof record.extraHeaders === "string" && record.extraHeaders !== "") {
    out.extraHeaders = record.extraHeaders;
  }
  return out;
}

function assertUser(userId: string): void {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new UserSecretError("INVALID_INPUT", "userId 不能为空。");
  }
}

function assertKind(kind: string): asserts kind is SecretKind {
  if (!isSecretKind(kind)) {
    throw new UserSecretError(
      "INVALID_INPUT",
      `未知的配置类型 ${kind}；只接受 ${SECRET_KINDS.join(" / ")}。`,
    );
  }
}

const DEFAULT_LABELS: Record<SecretKind, string> = {
  llm: "文本模型",
  "search-deepseek": "DeepSeek 搜索",
  "search-tavily": "Tavily 搜索",
  tts: "语音合成",
};

function requiresApiKey(kind: SecretKind): boolean {
  return kind === "llm" || kind === "search-deepseek" || kind === "search-tavily";
}

// ── SQL ───────────────────────────────────────────────────────────

/*
 * 参数顺序与列顺序一致；db.ts 的内存实现按这个顺序解码。
 * created_at 不在 DO UPDATE SET 里：重复保存是更新，不是重建，首次创建时间要保留。
 */
const UPSERT_SQL = `INSERT INTO user_secrets (
  user_id, kind, label, api, base_url, model, options_json,
  secret_ct, secret_iv, secret_tag, secret_kid, secret_hint, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
ON CONFLICT (user_id, kind) DO UPDATE SET
  label = EXCLUDED.label,
  api = EXCLUDED.api,
  base_url = EXCLUDED.base_url,
  model = EXCLUDED.model,
  options_json = EXCLUDED.options_json,
  secret_ct = EXCLUDED.secret_ct,
  secret_iv = EXCLUDED.secret_iv,
  secret_tag = EXCLUDED.secret_tag,
  secret_kid = EXCLUDED.secret_kid,
  secret_hint = EXCLUDED.secret_hint,
  updated_at = EXCLUDED.updated_at`;

const SELECT_ONE_SQL = "SELECT * FROM user_secrets WHERE user_id = $1 AND kind = $2";
const SELECT_ALL_SQL = "SELECT * FROM user_secrets WHERE user_id = $1 ORDER BY kind ASC";
const DELETE_SQL = "DELETE FROM user_secrets WHERE user_id = $1 AND kind = $2";

// ── 公开形状 ──────────────────────────────────────────────────────

/**
 * 把数据库行转成可公开的对象。
 *
 * kind 由本模块与 /api/config 的判别联合共同约束，库里不会出现别的值；
 * 真要出现，调用方拿到的仍是字符串，不会因此拿到任何密文字段。
 */
export function toPublicConfig(row: UserSecretRow): PublicUserSecret {
  return {
    kind: row.kind as SecretKind,
    label: row.label,
    api: row.api,
    baseUrl: row.base_url,
    model: row.model,
    options: parseSecretOptions(row.options_json ?? "{}"),
    hint: row.secret_hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────

/**
 * 内存后端拒绝写密钥。
 *
 * 返回给路由的是一句话 + 可判别错误码；本地测试显式设 ALP_ALLOW_MEMORY_SECRETS=1 放行，
 * 避免「测试里能存、线上重启就丢」的假成功。
 */
export function assertSecretStorageAvailable(env: SecretEnv = process.env): void {
  if (dbBackend() !== "memory") return;
  const flag = (env.ALP_ALLOW_MEMORY_SECRETS ?? "").trim().toLowerCase();
  if (flag === "1" || flag === "true") return;
  throw new UserSecretError(
    "SECRET_STORAGE_UNAVAILABLE",
    "当前是内存数据库：保存的密钥会在重启后丢失，多实例之间也不共享。请配置 DATABASE_URL；本地测试可设 ALP_ALLOW_MEMORY_SECRETS=1。",
  );
}

/**
 * 保存（新建或覆盖）一条配置。
 *
 * 顺序：参数校验 → 后端检查 → options/payload 清洗 → 加密 → upsert → 读回。
 * payload 为空（例如 TTS 的浏览器语音）时三个密文字段都写空串，
 * 表示「没有需要加密的内容」，读取时直接返回 {}。
 */
export async function saveUserSecret(
  db: Db,
  userId: string,
  input: SaveUserSecretInput,
  env: SecretEnv = process.env,
): Promise<PublicUserSecret> {
  assertUser(userId);
  assertKind(input.kind);
  assertSecretStorageAvailable(env);

  const api = input.api.trim();
  if (api === "") {
    throw new UserSecretError("INVALID_INPUT", "api 不能为空。");
  }
  const options = normalizeSecretOptions(input.options);
  const payload = normalizeSecretPayload(input.payload);
  if (requiresApiKey(input.kind) && payload.apiKey === undefined) {
    throw new UserSecretError("INVALID_INPUT", `${input.kind} 配置必须提供 apiKey。`);
  }

  const scope = { userId, kind: input.kind };
  const sealed =
    Object.keys(payload).length === 0
      ? null
      : sealSecret(JSON.stringify(payload), scope, env);

  const primarySecret = payload.apiKey ?? payload.embeddingApiKey ?? "";
  const hint = sealed === null ? "••••" : secretHint(primarySecret);
  const label = (input.label ?? "").trim() || DEFAULT_LABELS[input.kind];
  const now = input.now ?? new Date().toISOString();

  await db.run(UPSERT_SQL, [
    userId,
    input.kind,
    label,
    api,
    input.baseUrl ?? "",
    input.model ?? "",
    JSON.stringify(options),
    sealed?.ct ?? "",
    sealed?.iv ?? "",
    sealed?.tag ?? "",
    sealed?.kid ?? currentSecretKeyId(env),
    hint,
    now,
    now,
  ]);

  const row = await getUserSecretRow(db, userId, input.kind);
  if (row === null) {
    throw new Error("user_secrets 写入后读回为空；内存实现与 Postgres 的 SQL 形状可能已经分叉。");
  }
  return toPublicConfig(row);
}

/** 读取一行原始数据；路由需要解密时用 loadUserSecret。 */
export async function getUserSecretRow(
  db: Db,
  userId: string,
  kind: SecretKind,
): Promise<UserSecretRow | null> {
  assertUser(userId);
  assertKind(kind);
  return db.one<UserSecretRow>(SELECT_ONE_SQL, [userId, kind]);
}

/** 列出公开配置（不含任何密文或明文密钥）。 */
export async function listUserSecrets(db: Db, userId: string): Promise<PublicUserSecret[]> {
  assertUser(userId);
  const rows = await db.all<UserSecretRow>(SELECT_ALL_SQL, [userId]);
  return rows.map(toPublicConfig);
}

/** 删除一条配置，返回是否真的删到了行。 */
export async function deleteUserSecret(
  db: Db,
  userId: string,
  kind: SecretKind,
): Promise<boolean> {
  assertUser(userId);
  assertKind(kind);
  const affected = await db.run(DELETE_SQL, [userId, kind]);
  return affected > 0;
}

/**
 * 解密一行配置，供服务端代理使用（LLM / 搜索 / TTS / embeddings）。
 *
 * userId 必须与行内 user_id 一致：即使路由鉴权出错拿到别人的行，
 * AAD 也会让解密失败，不会把别人的密钥发出去。
 */
export function readSecretPayload(
  row: UserSecretRow,
  userId: string = row.user_id,
  env: SecretEnv = process.env,
): SecretPayload {
  if (userId !== row.user_id) {
    throw new SecretCryptoError("SECRET_UNREADABLE", "密文与请求的用户不一致。");
  }

  const ct = (row.secret_ct ?? "").trim();
  if (ct === "") {
    if ((row.secret_iv ?? "") !== "" || (row.secret_tag ?? "") !== "") {
      throw new SecretCryptoError("SECRET_UNREADABLE", "user_secrets 只有 iv/tag 而没有密文，疑似损坏。");
    }
    return {};
  }

  const plaintext = openSecret(
    { ct: row.secret_ct, iv: row.secret_iv, tag: row.secret_tag, kid: row.secret_kid },
    { userId: row.user_id, kind: row.kind },
    env,
  );

  let raw: unknown;
  try {
    raw = JSON.parse(plaintext);
  } catch {
    throw new UserSecretError("SECRET_UNREADABLE", "密文解开后不是合法 JSON，疑似损坏。");
  }
  return parseSecretPayload(raw);
}

/** 路由最常用的一次性读取：行 + 公开配置 + 解密负载。 */
export async function loadUserSecret(
  db: Db,
  userId: string,
  kind: SecretKind,
  env: SecretEnv = process.env,
): Promise<LoadedUserSecret | null> {
  const row = await getUserSecretRow(db, userId, kind);
  if (row === null) return null;
  return {
    row,
    payload: readSecretPayload(row, userId, env),
    config: toPublicConfig(row),
  };
}
