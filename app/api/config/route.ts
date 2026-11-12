import { readContextBudget } from "@/lib/contextBudget";
/**
 * 用户级供应商配置：GET 掩码回显 / PUT 加密保存 / DELETE 删除。
 *
 * 边界：
 * - 任何响应都不含明文密钥或密文字段。GET 只经过 toPublicConfig（userSecrets.ts）
 *   取白名单字段；PUT 的返回值同样只取 toPublicConfig。
 * - 写入统一走 userSecrets.ts：加密、内存后端拦截、options 白名单都在那里，
 *   路由不自己拼 SQL，也不自己实现 AES。
 * - 用户填的 baseUrl 必须过 assertUpstreamAllowed（ssrfGuard.ts）：
 *   形状 → 字面量内网地址 → DNS 逐条判定，任一条内网就拒绝。
 *   服务端要代发请求，配置入口是唯一的拦截时机（代理层会再按钉住的 IP 复查）。
 * - 内存后端拒绝写密钥：重启即丢、多实例各存各的，等于没保存。
 *   测试可设 ALP_ALLOW_MEMORY_SECRETS=1 放行。
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CONFIG_PROVIDERS,
  apiErrorCodes,
  configPut,
  llmConfigPut,
  searchDeepseekConfigPut,
  searchTavilyConfigPut,
  ttsConfigPut,
  type ConfigProvider,
} from "@/lib/apiContracts";
import { getDb, type Db } from "@/lib/db";
import { assertMutationOrigin, jsonError, readJsonObject, requireApiUser } from "@/lib/routeAuth";
import { SecretCryptoError } from "@/lib/secretCrypto";
import { assertUpstreamAllowed, isSsrfGuardError } from "@/lib/ssrfGuard";
import {
  UserSecretError,
  assertSecretStorageAvailable,
  deleteUserSecret,
  getUserSecretRow,
  listUserSecrets,
  readSecretPayload,
  saveUserSecret,
  type PublicUserSecret,
  type SaveUserSecretInput,
  type SecretOptions,
  type SecretPayload,
} from "@/lib/userSecrets";

export const runtime = "nodejs";

/** 配置请求体上限：最大的 llm 配置也只有几 KB。 */
const MAX_CONFIG_BODY_BYTES = 32 * 1024;

/**
 * apiContracts.configPut 里 apiKey 是必填的（min 1）。
 *
 * 但设置页「只改模型、不动密钥」时不该被迫把明文再发一遍（浏览器也不该留着明文），
 * 所以这里派生一份只在 apiKey 上放宽的 schema：空串/缺省都表示「沿用已存的密文」。
 * 其余字段仍然来自 apiContracts 的 strictObject，未知字段照旧拒绝。
 */
const optionalKey = z.string().max(4096).optional();

const configPutBody = z.discriminatedUnion("provider", [
  llmConfigPut.extend({ apiKey: optionalKey }),
  searchDeepseekConfigPut.extend({ apiKey: optionalKey }),
  searchTavilyConfigPut.extend({ apiKey: optionalKey }),
  ttsConfigPut.extend({ apiKey: optionalKey }),
]);

type ConfigPutBody = z.infer<typeof configPutBody>;

type ParsedBody = { readonly ok: true; readonly body: ConfigPutBody } | { readonly ok: false; readonly message: string };

/**
 * 先按 apiContracts.configPut 原样校验；失败后再用「apiKey 为空/缺省」的派生
 * schema 复核。只有这一种差异会被放行，其它任何不符仍然 400。
 * 这样「改了模型但不想重发密钥」的请求既不丢旧密钥，也没有在契约之外开口子。
 */
function parseBody(value: Record<string, unknown>): ParsedBody {
  const strict = configPut.safeParse(value);
  if (strict.success) return { ok: true, body: strict.data };

  const lax = configPutBody.safeParse(value);
  if (lax.success) return { ok: true, body: lax.data };

  const issue = lax.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}：` : "";
  return { ok: false, message: `${where}${issue?.message ?? "请求体不符合契约"}` };
}

/** GET 里每个 kind 的固定槽位：未配置时字段齐全但为空，客户端不必判 undefined。 */
interface PublicConfigEntry {
  readonly configured: boolean;
  readonly hint: string;
  readonly label: string;
  readonly api: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly options: SecretOptions;
  readonly updatedAt: string;
}

function emptyEntry(): PublicConfigEntry {
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

function toEntry(row: PublicUserSecret): PublicConfigEntry {
  return {
    configured: true,
    hint: row.hint,
    label: row.label,
    api: row.api,
    baseUrl: row.baseUrl,
    model: row.model,
    options: row.options,
    updatedAt: row.updatedAt,
  };
}

/** GET 的完整形状：四个 kind 永远都在，未配置的 configured=false。 */
function publicConfig(rows: readonly PublicUserSecret[]): Record<ConfigProvider, PublicConfigEntry> {
  const byKind = new Map(rows.map((row) => [row.kind, row]));
  const out = {} as Record<ConfigProvider, PublicConfigEntry>;
  for (const kind of CONFIG_PROVIDERS) {
    const row = byKind.get(kind);
    out[kind] = row === undefined ? emptyEntry() : toEntry(row);
  }
  return out;
}

function isConfigProvider(value: string): value is ConfigProvider {
  return (CONFIG_PROVIDERS as readonly string[]).includes(value);
}

/** GET：只回公开字段（含掩码 hint），永远不含 secret_ct / secret_iv / secret_tag。 */
export async function GET() {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    const db = await getDb();
    const rows = await listUserSecrets(db, auth.user.id);
    return NextResponse.json(
      { config: publicConfig(rows) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return jsonError(500, apiErrorCodes.internal, "读取配置失败");
  }
}

/** PUT：校验 → 上游地址检查 → 合并旧密钥 → 加密 upsert。 */
export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const crossSite = assertMutationOrigin(request);
  if (crossSite) return crossSite;

  const raw = await readJsonObject(request, MAX_CONFIG_BODY_BYTES);
  if (!raw.ok) return raw.response;

  const parsedBody = parseBody(raw.value);
  if (!parsedBody.ok) return jsonError(400, apiErrorCodes.badRequest, parsedBody.message);
  const body = parsedBody.body;

  // 内存后端在任何写入之前拒绝：先于加密与 upsert，保证「不写库」。
  const memory = storageUnavailable();
  if (memory !== null) return memory;

  const badUrl = await checkUpstreams(body);
  if (badUrl !== null) return badUrl;

  const newApiKey = text(body.apiKey);
  const newEmbeddingApiKey = body.provider === "llm" ? text(body.embeddingApiKey) : undefined;
  const headersProvided = body.provider === "llm" && body.extraHeaders !== undefined;

  let db: Db;
  try {
    db = await getDb();
  } catch {
    return jsonError(500, apiErrorCodes.internal, "连接配置存储失败");
  }

  let payload: SecretPayload;
  try {
    const existing = await getUserSecretRow(db, auth.user.id, body.provider);
    const old =
      existing === null
        ? {}
        : readOldPayload(existing, auth.user.id, newApiKey !== undefined);

    const apiKey = newApiKey ?? old.apiKey;
    if (requiresApiKey(body.provider) && apiKey === undefined) {
      return jsonError(400, apiErrorCodes.badRequest, "apiKey 不能为空：该供应商必须先保存一次密钥");
    }

    const embeddingApiKey = newEmbeddingApiKey ?? old.embeddingApiKey;
    const extraHeaders = headersProvided
      ? text(headersOf(body)) ?? undefined
      : old.extraHeaders;

    payload = {
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(embeddingApiKey === undefined ? {} : { embeddingApiKey }),
      ...(extraHeaders === undefined ? {} : { extraHeaders }),
    };
  } catch (err) {
    const response = secretErrorResponse(err);
    if (response) return response;
    return jsonError(500, apiErrorCodes.internal, "读取已保存的配置失败");
  }

  try {
    const saved = await saveUserSecret(db, auth.user.id, toSaveInput(body, payload));
    return NextResponse.json(
      { config: toEntry(saved) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const response = secretErrorResponse(err);
    if (response) return response;
    return jsonError(500, apiErrorCodes.internal, "保存配置失败");
  }
}

/** DELETE ?kind=：幂等；返回是否真的删到了行。 */
export async function DELETE(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const crossSite = assertMutationOrigin(request);
  if (crossSite) return crossSite;

  const kind = (new URL(request.url).searchParams.get("kind") ?? "").trim();
  if (!isConfigProvider(kind)) {
    return jsonError(
      400,
      apiErrorCodes.badRequest,
      "kind 必须是 llm / search-deepseek / search-tavily / tts",
    );
  }

  // 删除也走同一道门：内存后端下本来就没有可持久化的行，
  // 回一句「已删除」是假话。
  const memory = storageUnavailable();
  if (memory !== null) return memory;

  try {
    const db = await getDb();
    const deleted = await deleteUserSecret(db, auth.user.id, kind);
    return NextResponse.json({ ok: true, deleted }, { headers: { "cache-control": "no-store" } });
  } catch {
    return jsonError(500, apiErrorCodes.internal, "删除配置失败");
  }
}

// ── 辅助 ──────────────────────────────────────────────────────────

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value === "" ? undefined : value;
}

function headersOf(body: ConfigPutBody): string | undefined {
  return body.provider === "llm" ? body.extraHeaders : undefined;
}

function requiresApiKey(kind: ConfigProvider): boolean {
  // TTS 的浏览器语音没有密钥，服务端也不能强迫用户编一个。
  return kind === "llm" || kind === "search-deepseek" || kind === "search-tavily";
}

/**
 * 读已有行的明文负载。
 *
 * 主密钥轮换后旧密文解不开，这是运维问题而不是用户数据坏了。此时只要请求带了
 * 新 apiKey（一次完整覆盖），就把旧负载当成空，让这次保存把行改写成新密钥下的
 * 密文；没带新密钥则必须报错——否则「沿用旧密钥」会悄悄变成「没有密钥」。
 *
 * 代价：轮换后旧行的 embeddingApiKey / extraHeaders 一起作废，需要用户重填。
 */
function readOldPayload(
  row: Parameters<typeof readSecretPayload>[0],
  userId: string,
  canOverwrite: boolean,
): SecretPayload {
  try {
    return readSecretPayload(row, userId);
  } catch (err) {
    if (canOverwrite && isUnreadableSecret(err)) return {};
    throw err;
  }
}

function isUnreadableSecret(err: unknown): boolean {
  if (err instanceof SecretCryptoError) {
    return err.code === "SECRET_UNREADABLE" || err.code === "KEY_KID_UNKNOWN";
  }
  if (err instanceof UserSecretError) return err.code === "SECRET_UNREADABLE";
  return false;
}

/** 返回 null 表示放行；返回响应则代表调用方应直接返回它。 */
function storageUnavailable(): NextResponse | null {
  try {
    assertSecretStorageAvailable();
    return null;
  } catch (err) {
    // assertSecretStorageAvailable 只抛 UserSecretError；其它异常仍按存储不可用处理，
    // 因为此时继续写库正是我们要避免的事。
    return secretErrorResponse(err) ?? jsonError(503, "PERSISTENCE_UNAVAILABLE", "配置存储不可用");
  }
}

async function checkUpstreams(body: ConfigPutBody): Promise<NextResponse | null> {
  const urls: string[] = [];
  if (body.provider === "llm") {
    urls.push(body.baseUrl);
    if (body.embeddingBaseUrl !== undefined) urls.push(body.embeddingBaseUrl);
  } else if (body.provider === "tts" && body.baseUrl !== undefined) {
    urls.push(body.baseUrl);
  } else if (body.provider === "search-deepseek" && body.baseUrl !== undefined) {
    urls.push(body.baseUrl);
  }

  for (const url of urls) {
    try {
      await assertUpstreamAllowed(url);
    } catch (err) {
      if (isSsrfGuardError(err)) {
        return jsonError(400, apiErrorCodes.badRequest, `上游地址不允许：${err.message}`);
      }
      return jsonError(400, apiErrorCodes.badRequest, "上游地址无法校验");
    }
  }
  return null;
}

function toSaveInput(body: ConfigPutBody, payload: SecretPayload): SaveUserSecretInput {
  switch (body.provider) {
    case "llm": {
      const options: SecretOptions = {
        ...(body.embeddingBaseUrl === undefined ? {} : { embeddingBaseUrl: body.embeddingBaseUrl }),
        ...(body.embeddingModel === undefined ? {} : { embeddingModel: body.embeddingModel }),
        ...(body.thinking === undefined ? {} : { thinking: body.thinking }),
        ...(body.thinkingStatus === undefined ? {} : { thinkingStatus: body.thinkingStatus }),
        ...(body.verification === undefined ? {} : { verification: body.verification }),
        ...readContextBudget(body),
      };
      return {
        kind: "llm",
        label: body.label,
        api: body.kind,
        baseUrl: body.baseUrl,
        model: body.model,
        options,
        payload,
      };
    }
    case "search-deepseek":
      return {
        kind: "search-deepseek",
        api: "deepseek",
        baseUrl: body.baseUrl ?? "",
        model: "",
        payload,
      };
    case "search-tavily":
      return { kind: "search-tavily", api: "tavily", baseUrl: "", model: "", payload };
    case "tts":
      return {
        kind: "tts",
        api: body.engine,
        baseUrl: body.baseUrl ?? "",
        model: body.model ?? "",
        options: {
          protocol: body.protocol,
          rate: body.rate,
          ...(body.voice === undefined ? {} : { voice: body.voice }),
          ...(body.browserVoice === undefined ? {} : { browserVoice: body.browserVoice }),
        },
        payload,
      };
  }
}

/**
 * 存储层与加密层的错误 → HTTP 响应。
 *
 * 两个 503 码不在 apiContracts.apiErrorCodes 里，但方案明确要求：
 * - KEY_ENC_UNAVAILABLE：服务端没配 ALP_SECRET_KEY，拒绝加密落库；
 * - PERSISTENCE_UNAVAILABLE：内存后端，保存等于没保存。
 * 用大写是因为它们来自 secretCrypto / userSecrets 的内部错误码，
 * 与代理路由（app/api/llm/*）保持同一串值；契约里的码仍是小写。
 * 其余客户端可修正的错误一律 400；「已存密文解不开」是 409（需要用户重填）。
 */
function secretErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof UserSecretError) {
    switch (err.code) {
      case "SECRET_STORAGE_UNAVAILABLE":
        return jsonError(503, "PERSISTENCE_UNAVAILABLE", err.message);
      case "SECRET_UNREADABLE":
        return jsonError(409, "SECRET_UNREADABLE", err.message);
      case "INVALID_INPUT":
      case "INVALID_OPTIONS":
      case "SECRET_TOO_SHORT":
        return jsonError(400, apiErrorCodes.badRequest, err.message);
    }
  }
  if (err instanceof SecretCryptoError) {
    switch (err.code) {
      case "KEY_ENC_UNAVAILABLE":
        return jsonError(503, "KEY_ENC_UNAVAILABLE", err.message);
      case "KEY_KID_UNKNOWN":
      case "SECRET_UNREADABLE":
        return jsonError(409, err.code, err.message);
      case "SECRET_TOO_SHORT":
      case "INVALID_ARGUMENT":
        return jsonError(400, apiErrorCodes.badRequest, err.message);
    }
  }
  return null;
}
