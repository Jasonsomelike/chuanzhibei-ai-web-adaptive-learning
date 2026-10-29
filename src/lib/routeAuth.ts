/**
 * API 路由的公共守卫：登录、同源、统一错误体、限量读取请求体。
 *
 * 为什么返回 `{ok:false,response}` 而不是抛异常：现有路由都是「提前 return」风格。
 * 抛异常要求每个 handler 包 try/catch，漏一处就会把内部错误变成 500 且可能带出堆栈。
 *
 * 请求体必须边读边计数：chunked 请求没有 Content-Length，只查头会让任意大的包
 * 绕过上限把进程内存吃满。超限时主动 cancel 流，剩下的字节不再收。
 */

import { NextResponse } from "next/server";

import { apiErrorCodes } from "@/lib/apiContracts";
import { getCurrentUser, type PublicUser } from "@/lib/auth";
import { sameOriginFromRequest } from "@/lib/origin";

/** 失败分支。调用方直接 `return guard.response`，不再拼错误体。 */
export interface Rejection {
  readonly ok: false;
  readonly response: NextResponse;
}

export type AuthGuard = { readonly ok: true; readonly user: PublicUser } | Rejection;
export type TextGuard = { readonly ok: true; readonly text: string } | Rejection;
export type JsonObjectGuard =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | Rejection;

/**
 * 本项目的 JSON 请求体都很小：最大的 configPut 也就几 KB。
 * 32KB 留足余量，同时挡住把整份文档塞进配置的调用方式。
 */
export const DEFAULT_MAX_JSON_BYTES = 32 * 1024;

/**
 * 统一错误响应体。`code` 用 apiContracts 的 `apiErrorCodes`；
 * 参数类型放宽到 string 只是因为 503 的两个码（见 app/api/config/route.ts）
 * 还没进契约，等契约补齐后应收窄为 ApiErrorCode。
 */
export function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/** 要求已登录。未登录一律 401，且调用方不得在此之前读写任何用户数据。 */
export async function requireApiUser(): Promise<AuthGuard> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, response: jsonError(401, apiErrorCodes.unauthorized, "请先登录") };
  }
  return { ok: true, user };
}

/**
 * 有副作用的请求必须同源。放行返回 null，拒绝返回可直接 return 的响应。
 *
 * 只相信浏览器写的 Origin / Sec-Fetch-Site（见 origin.ts 的边界说明），
 * 因此 curl 这类不带 Origin 的写请求会被拒——这正是想要的行为：
 * 密钥写入不接受跨站页面代发。
 */
export function assertMutationOrigin(request: Request): NextResponse | null {
  if (sameOriginFromRequest(request)) return null;
  return jsonError(403, apiErrorCodes.forbidden, "跨站请求被拒绝");
}

/**
 * 读取文本请求体，超过 maxBytes 返回 413。
 *
 * 计数发生在读取流的过程中，并额外用 Content-Length 提前拒绝，
 * 两种来源取更严格的结果：头部可以低估，但流里的真实字节数不会。
 */
export async function readLimitedText(
  request: Request,
  maxBytes: number,
): Promise<TextGuard> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      await request.body?.cancel().catch(() => undefined);
      return tooLarge(maxBytes);
    }
  }

  const stream = request.body;
  if (stream === null) return { ok: true, text: "" };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(concat(chunks, total));
  } catch {
    return { ok: false, response: jsonError(400, apiErrorCodes.badRequest, "请求体不是合法 UTF-8") };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { ok: true, text };
}

/** readLimitedText + Content-Type 校验 + JSON 对象解析。 */
export async function readJsonObject(
  request: Request,
  maxBytes: number = DEFAULT_MAX_JSON_BYTES,
): Promise<JsonObjectGuard> {
  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    // apiContracts 没有单独的 415 错误码；状态码按 HTTP 语义给 415，
    // code 仍取契约里的 bad_request，客户端不必为 415 再记一个新字符串。
    return {
      ok: false,
      response: jsonError(415, apiErrorCodes.badRequest, "请求体必须是 application/json"),
    };
  }

  const body = await readLimitedText(request, maxBytes);
  if (!body.ok) return body;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return { ok: false, response: jsonError(400, apiErrorCodes.badRequest, "请求体不是合法 JSON") };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: jsonError(400, apiErrorCodes.badRequest, "请求体必须是 JSON 对象") };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

/**
 * 常量时间比较两个字符串。
 *
 * 先各自 SHA-256 再逐字节比较：这样比较耗时不随「第几个字节不同」变化，
 * 也不会因长度不同而提前返回。用于 /api/health 的 Bearer token 校验。
 */
export async function timingSafeEqualText(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const left = new Uint8Array(hashA);
  const right = new Uint8Array(hashB);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}

function tooLarge(maxBytes: number): Rejection {
  return {
    ok: false,
    response: jsonError(
      413,
      apiErrorCodes.payloadTooLarge,
      `请求体超过 ${maxBytes} 字节上限`,
    ),
  };
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
