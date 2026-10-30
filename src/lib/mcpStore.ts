/**
 * 用户自建 MCP 服务器的配置存储。
 *
 * 为什么另起一张表（db.ts 的 mcp_servers，W0 已建）：user_secrets 的主键是
 * (user_id, kind)，一行只能放一个服务器；而且鉴权头必须与 URL/白名单分开加密。
 *
 * 边界：
 * - 鉴权头只进密文列 auth_ct/auth_iv/auth_tag：明文、header 名与格式都在
 *   sealSecret 的 JSON 里，AAD 用 kind=`mcp:<serverId>`，同一用户的两个服务器
 *   密文不可互换；
 * - 公开响应只有 authHint（末 4 位掩码），类型上不存在密文字段；
 * - URL 只能来自用户配置：写库前过 assertUpstreamAllowed（形状 + DNS + 内网判定），
 *   Agent 真正请求时还会再过一次并走 guardedRequest（mcpClient.ts）；
 * - 内存后端保存密钥默认拒绝（与 userSecrets 同一开关 ALP_ALLOW_MEMORY_SECRETS），
 *   否则「测试里能存、线上重启就丢」会变成假成功。
 */

import { MCP_SERVER_SQL, type Db } from "@/lib/db";
import {
  currentSecretKeyId,
  openSecret,
  sealSecret,
  secretHint,
  type SecretEnv,
} from "@/lib/secretCrypto";
import { assertUpstreamAllowed, isSsrfGuardError } from "@/lib/ssrfGuard";
import { assertSecretStorageAvailable } from "@/lib/userSecrets";
import { isValidMcpServerId } from "@/lib/mcpClient";

/** 单用户服务器上限：防止一个账号拖垮每次 Agent 请求的扇出。 */
export const MAX_MCP_SERVERS_PER_USER = 20;

/** 单个服务器的工具白名单上限。 */
export const MAX_ALLOWED_TOOLS = 50;

/** 鉴权头的头名必须能出现在 HTTP 里（RFC 7230 token）。 */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;

/** URL 长度与 checkUrlShape 的上限一致。 */
const MAX_URL_CHARS = 2048;

const TOOL_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/u;

export type McpStoreErrorCode =
  | "INVALID_INPUT"
  | "INVALID_URL"
  | "TOO_MANY_SERVERS"
  | "SECRET_UNREADABLE";

export class McpStoreError extends Error {
  readonly code: McpStoreErrorCode;

  constructor(code: McpStoreErrorCode, message: string) {
    super(message);
    this.name = "McpStoreError";
    this.code = code;
  }
}

/** 数据库行（字段名与 SCHEMA 一致）。只有本模块与 /api/agent 应该接触它。 */
export interface McpServerRow {
  readonly user_id: string;
  readonly server_id: string;
  readonly label: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly allowed_tools_json: string;
  readonly auth_ct: string;
  readonly auth_iv: string;
  readonly auth_tag: string;
  readonly auth_kid: string;
  readonly auth_hint: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * 公开形状：可以直接进 JSON 响应。
 *
 * 刻意没有 auth_ct/auth_iv/auth_tag/auth_kid——不是靠调用方记得删，而是类型上不存在。
 */
export interface PublicMcpServer {
  readonly serverId: string;
  readonly label: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly allowedTools: readonly string[];
  readonly authConfigured: boolean;
  /** 掩码后的末 4 位；没有鉴权头时为空串。 */
  readonly authHint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 鉴权头。v1 只支持一个头，足够覆盖 Authorization / X-API-Key 两类服务器。 */
export interface McpAuthHeaderInput {
  readonly name: string;
  readonly value: string;
}

export interface SaveMcpServerInput {
  readonly serverId: string;
  readonly label?: string;
  readonly url: string;
  readonly enabled?: boolean;
  readonly allowedTools?: readonly string[];
  /** undefined = 保留已存的鉴权头；null = 清除；对象 = 重新加密保存。 */
  readonly auth?: McpAuthHeaderInput | null;
  /** 测试注入时钟。 */
  readonly now?: string;
}

/** 加密作用域的 kind：AAD 绑定到具体服务器。 */
export function mcpSecretKind(serverId: string): string {
  return `mcp:${serverId}`;
}

function assertUserId(userId: string): void {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new McpStoreError("INVALID_INPUT", "userId 不能为空。");
  }
}

function assertServerId(serverId: string): void {
  if (!isValidMcpServerId(serverId)) {
    throw new McpStoreError(
      "INVALID_INPUT",
      "serverId 只允许字母、数字、下划线与连字符，且以字母或数字开头（≤32 字符）。",
    );
  }
}

function normalizeLabel(label: string | undefined, serverId: string): string {
  const trimmed = (label ?? "").trim();
  if (trimmed === "") return serverId;
  if (trimmed.length > 60) {
    throw new McpStoreError("INVALID_INPUT", "label 超过 60 字符。");
  }
  return trimmed;
}

function normalizeUrl(raw: string): string {
  const url = raw.trim();
  if (url === "") throw new McpStoreError("INVALID_INPUT", "url 不能为空。");
  if (url.length > MAX_URL_CHARS) {
    throw new McpStoreError("INVALID_INPUT", `url 超过 ${MAX_URL_CHARS} 字符。`);
  }
  return url;
}

/**
 * 白名单清洗：只接受合法工具名，去重保序，超上限直接报错。
 *
 * 未知字段不静默丢弃：静默丢弃会让用户以为「勾了但没生效」，而多出来的条目
 * 最终仍要在 tools/list 取交集时被剔掉——两种失败模式下用户看到的界面必须一致。
 */
export function normalizeAllowedTools(raw: readonly string[] | undefined): string[] {
  if (raw === undefined) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new McpStoreError("INVALID_INPUT", "allowedTools 只能包含字符串。");
    }
    const name = entry.trim();
    if (!TOOL_SEGMENT.test(name)) {
      throw new McpStoreError("INVALID_INPUT", `allowedTools 里的工具名不合法：${entry}`);
    }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length > MAX_ALLOWED_TOOLS) {
      throw new McpStoreError("INVALID_INPUT", `allowedTools 最多 ${MAX_ALLOWED_TOOLS} 条。`);
    }
  }
  return out;
}

/** 读侧宽容：坏 JSON 或非法条目丢弃，不让一条坏配置拖垮整个 Agent 请求。 */
export function parseAllowedTools(json: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    if (!TOOL_SEGMENT.test(entry)) continue;
    if (out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= MAX_ALLOWED_TOOLS) break;
  }
  return out;
}

function normalizeAuth(auth: McpAuthHeaderInput): { readonly name: string; readonly value: string } {
  const name = auth.name.trim().toLowerCase();
  const value = auth.value;
  if (!HEADER_NAME.test(name)) {
    throw new McpStoreError("INVALID_INPUT", "鉴权头的头名不合法。");
  }
  if (name.startsWith("proxy-") || name === "host" || name === "content-length") {
    throw new McpStoreError("INVALID_INPUT", `鉴权头不能是 ${name}。`);
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new McpStoreError("INVALID_INPUT", "鉴权头的值不能为空。");
  }
  if (value.length > 2048 || /[\r\n]/u.test(value)) {
    throw new McpStoreError("INVALID_INPUT", "鉴权头的值不合法（含换行或超过 2048 字符）。");
  }
  return { name, value };
}

/**
 * 写侧必须过 SSRF 判定。
 *
 * 与 /api/config 的理由相同：服务端随后会替用户请求这个地址，配置入口是
 * 唯一能提前拒绝「明显不可能合法」地址的时机；请求层仍会再判一次。
 */
async function assertUrlAllowed(url: string): Promise<void> {
  try {
    await assertUpstreamAllowed(url);
  } catch (err) {
    if (isSsrfGuardError(err)) {
      throw new McpStoreError("INVALID_URL", `MCP 服务器地址不被允许：${err.message}`);
    }
    throw new McpStoreError("INVALID_URL", "MCP 服务器地址无法校验。");
  }
}

export function toPublicMcpServer(row: McpServerRow): PublicMcpServer {
  return {
    serverId: row.server_id,
    label: row.label,
    url: row.url,
    enabled: row.enabled === true,
    allowedTools: parseAllowedTools(row.allowed_tools_json ?? "[]"),
    authConfigured: (row.auth_ct ?? "") !== "",
    authHint: row.auth_hint ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────

export async function listMcpServers(
  db: Db,
  userId: string,
): Promise<PublicMcpServer[]> {
  assertUserId(userId);
  const rows = await db.all<McpServerRow>(MCP_SERVER_SQL.list, [userId]);
  return rows.map(toPublicMcpServer);
}

export async function getMcpServerRow(
  db: Db,
  userId: string,
  serverId: string,
): Promise<McpServerRow | null> {
  assertUserId(userId);
  assertServerId(serverId);
  return db.one<McpServerRow>(MCP_SERVER_SQL.byId, [userId, serverId]);
}

/**
 * 新建或覆盖一个服务器。
 *
 * 鉴权头的三种语义（undefined / null / 对象）必须区分：设置页只改 URL 时不带
 * auth 字段，若当成「清空」就会把用户的 token 悄悄删掉。
 */
export async function saveMcpServer(
  db: Db,
  userId: string,
  input: SaveMcpServerInput,
  env: SecretEnv = process.env,
): Promise<PublicMcpServer> {
  assertUserId(userId);
  assertServerId(input.serverId);

  const url = normalizeUrl(input.url);
  await assertUrlAllowed(url);

  const label = normalizeLabel(input.label, input.serverId);
  const allowedTools = normalizeAllowedTools(input.allowedTools);
  const existing = await getMcpServerRow(db, userId, input.serverId);

  if (existing === null) {
    const rows = await db.all<McpServerRow>(MCP_SERVER_SQL.list, [userId]);
    if (rows.length >= MAX_MCP_SERVERS_PER_USER) {
      throw new McpStoreError(
        "TOO_MANY_SERVERS",
        `最多只能配置 ${MAX_MCP_SERVERS_PER_USER} 个 MCP 服务器。`,
      );
    }
  }

  const kind = mcpSecretKind(input.serverId);
  const scope = { userId, kind };

  let sealed = {
    ct: existing?.auth_ct ?? "",
    iv: existing?.auth_iv ?? "",
    tag: existing?.auth_tag ?? "",
    kid: existing?.auth_kid ?? "",
  };
  let hint = existing?.auth_hint ?? "";

  if (input.auth === null) {
    sealed = { ct: "", iv: "", tag: "", kid: "" };
    hint = "";
  } else if (input.auth !== undefined) {
    const auth = normalizeAuth(input.auth);
    assertSecretStorageAvailable(env);
    const sealedSecret = sealSecret(JSON.stringify({ headers: { [auth.name]: auth.value } }), scope, env);
    sealed = sealedSecret;
    hint = secretHint(auth.value);
  }

  const now = input.now ?? new Date().toISOString();
  const createdAt = existing?.created_at ?? now;

  await db.run(MCP_SERVER_SQL.upsert, [
    userId,
    input.serverId,
    label,
    url,
    input.enabled ?? existing?.enabled ?? true,
    JSON.stringify(allowedTools),
    sealed.ct,
    sealed.iv,
    sealed.tag,
    sealed.ct === "" ? "" : sealed.kid || currentSecretKeyId(env),
    hint,
    createdAt,
    now,
  ]);

  const row = await getMcpServerRow(db, userId, input.serverId);
  if (row === null) {
    throw new Error("mcp_servers 写入后读回为空；内存实现与 Postgres 的 SQL 形状可能已经分叉。");
  }
  return toPublicMcpServer(row);
}

export async function deleteMcpServer(
  db: Db,
  userId: string,
  serverId: string,
): Promise<boolean> {
  assertUserId(userId);
  assertServerId(serverId);
  const removed = await db.run(MCP_SERVER_SQL.deleteById, [userId, serverId]);
  return removed > 0;
}

/**
 * 解密并返回鉴权头（给 mcpClient 用）。
 *
 * 任何「解不开」都折成 SECRET_UNREADABLE：告诉调用方是 tag 错还是 AAD 错，
 * 只会泄露「猜对了哪个字段」。调用方应把它当成「该服务器暂不可用」处理。
 */
export async function readMcpAuthHeaders(
  db: Db,
  userId: string,
  serverId: string,
  env: SecretEnv = process.env,
): Promise<Record<string, string>> {
  const row = await getMcpServerRow(db, userId, serverId);
  if (row === null || (row.auth_ct ?? "") === "") return {};

  let plaintext: string;
  try {
    plaintext = openSecret(
      { ct: row.auth_ct, iv: row.auth_iv, tag: row.auth_tag, kid: row.auth_kid },
      { userId, kind: mcpSecretKind(serverId) },
      env,
    );
  } catch {
    throw new McpStoreError("SECRET_UNREADABLE", "保存的 MCP 鉴权头无法解密，请重新保存。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new McpStoreError("SECRET_UNREADABLE", "保存的 MCP 鉴权头已损坏，请重新保存。");
  }
  if (typeof parsed !== "object" || parsed === null) return {};

  const headers = (parsed as Record<string, unknown>).headers;
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) return {};

  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (!HEADER_NAME.test(name)) continue;
    if (typeof value !== "string" || value === "" || /[\r\n]/u.test(value)) continue;
    out[name] = value;
  }
  return out;
}
