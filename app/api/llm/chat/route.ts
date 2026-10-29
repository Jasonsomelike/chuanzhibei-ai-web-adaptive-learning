/**
 * POST /api/llm/chat —— 服务端代发对话（OpenAI 兼容 / Anthropic）。
 *
 * 为什么需要它：浏览器直连受 CORS 与混合内容限制，且密钥一旦进前端就会被
 * DevTools 抄走。这里让服务端持有用户存在库里的密钥（user_secrets 加密存储），
 * 客户端只发消息。
 *
 * 安全边界（每一条都必须保持）：
 * - 请求体里不允许出现 baseUrl / apiKey / model：它们只能来自 /api/config，
 *   由 apiContracts.llmChat 的 strictObject 拒绝。kind 是本地扩展字段，
 *   只用于「页面读到的配置是否已被别的设备改掉」的 409 检查。
 * - 目标地址必须过 assertUpstreamAllowed（形状 + DNS 逐条判定 + 钉 IP），
 *   传输只能走 guardedRequest；本文件不出现全局 fetch。
 * - 错误详情先过 redactSecrets 再出网：供应商经常把整个请求头回显进错误体。
 * - 流式响应的头只设三个：Content-Type / Cache-Control / X-Accel-Buffering。
 */

import type { Readable } from "node:stream";

import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorCodes, llmChat } from "@/lib/apiContracts";
import { assertMutationOrigin, jsonError, readJsonObject, requireApiUser } from "@/lib/routeAuth";
import {
  assertUpstreamAllowed,
  guardedRequest,
  isSsrfGuardError,
  isUpstreamRequestError,
  type AllowedTarget,
  type GuardedRequestOptions,
} from "@/lib/ssrfGuard";
import {
  buildUpstreamChatBody,
  endpointFor,
  filterExtraHeaders,
  isLlmConfigError,
  loadLlmConfigForUser,
  redactSecrets,
  sseProxyStream,
  type LlmConfig,
  type LlmConfigErrorCode,
  type RedactSecret,
} from "@/lib/upstream";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 50 条 × 16000 字符的消息体在最坏情况下约 1.6MB。 */
const MAX_CHAT_BODY_BYTES = 2 * 1024 * 1024;

/** 流式对话可能持续几分钟；非流式（出题、核对）给两分钟足够。 */
const STREAM_TIMEOUT_MS = 300_000;
const NON_STREAM_TIMEOUT_MS = 120_000;
const MAX_UPSTREAM_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;

/**
 * llmChat + 可选的 kind。kind 不在 apiContracts 里，因为它是「客户端读过的配置版本」
 * 的提示，不是请求语义的一部分；扩展后 strict 仍然拒绝 baseUrl / apiKey / model。
 */
const chatRequest = llmChat.extend({
  kind: z.enum(["openai-compatible", "anthropic"]).optional(),
});

function configErrorResponse(err: { readonly code: LlmConfigErrorCode }): NextResponse {
  switch (err.code) {
    case "CONFIG_MISSING":
      return jsonError(404, "CONFIG_MISSING", "该账号还没有保存模型配置");
    case "KEY_ENC_UNAVAILABLE":
      return jsonError(503, "KEY_ENC_UNAVAILABLE", "服务端未配置密钥主密钥，暂时无法代发");
    case "KEY_KID_UNKNOWN":
      return jsonError(500, "KEY_KID_UNKNOWN", "保存的密钥使用了未知的密钥版本");
    case "SECRET_UNREADABLE":
      return jsonError(500, "SECRET_UNREADABLE", "保存的密钥无法解密，请重新保存配置");
    case "CONFIG_INVALID":
      return jsonError(500, "CONFIG_INVALID", "保存的模型配置不完整，请重新保存");
  }
}

function upstreamFailureResponse(err: unknown): NextResponse {
  if (isUpstreamRequestError(err)) {
    switch (err.reason) {
      case "timeout":
        return jsonError(504, apiErrorCodes.providerTimeout, "上游模型响应超时");
      case "aborted":
        return jsonError(499, apiErrorCodes.providerError, "客户端已断开");
      case "too-large":
        return jsonError(502, apiErrorCodes.providerError, "上游响应超过体积上限");
      case "network":
        return jsonError(502, apiErrorCodes.providerError, "无法连接上游模型服务");
    }
  }
  return jsonError(502, apiErrorCodes.providerError, "上游请求失败");
}

/** 上游错误体可能回显密钥；截断后统一脱敏。 */
function safeDetail(text: string, secret: RedactSecret): string {
  const trimmed = text.trim();
  if (trimmed === "") return "上游拒绝了这次请求";
  return redactSecrets(trimmed.slice(0, 800), secret);
}

/** 读完一小段错误体并销毁流：错误响应不能挂着不消费。 */
async function drainStream(stream: Readable, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      total += buffer.length;
      if (total > limit) break;
      chunks.push(buffer);
    }
  } catch {
    // 错误体读不全不影响错误码
  } finally {
    stream.destroy();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function buildHeaders(config: LlmConfig): Record<string, string> {
  // 用户额外头先合并，协议必需头最后写：extraHeaders 不能覆盖 Authorization / x-api-key。
  const headers: Record<string, string> = {
    ...filterExtraHeaders(config.options.extraHeaders),
  };
  headers["content-type"] = "application/json";
  headers["accept"] = "text/event-stream, application/json";
  if (config.api === "anthropic") {
    headers["x-api-key"] = config.payload.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["authorization"] = `Bearer ${config.payload.apiKey}`;
  }
  return headers;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const crossSite = assertMutationOrigin(request);
  if (crossSite) return crossSite;

  const raw = await readJsonObject(request, MAX_CHAT_BODY_BYTES);
  if (!raw.ok) return raw.response;

  const parsed = chatRequest.safeParse(raw.value);
  if (!parsed.success) {
    return jsonError(
      400,
      apiErrorCodes.badRequest,
      "请求体不符合约定（不接受 baseUrl / apiKey / model）",
    );
  }
  const body = parsed.data;

  let config: LlmConfig;
  try {
    config = await loadLlmConfigForUser(auth.user.id);
  } catch (err) {
    if (isLlmConfigError(err)) return configErrorResponse(err);
    return jsonError(500, apiErrorCodes.internal, "读取模型配置失败");
  }

  if (body.kind !== undefined && body.kind !== config.api) {
    return jsonError(409, "CONFIG_STALE", "配置已被更新，请刷新页面后重试");
  }

  let target: AllowedTarget;
  try {
    target = await assertUpstreamAllowed(endpointFor(config.api, config.options.baseUrl));
  } catch (err) {
    if (isSsrfGuardError(err)) {
      return jsonError(502, apiErrorCodes.providerError, "上游地址不被允许");
    }
    return jsonError(502, apiErrorCodes.providerError, "上游地址无法解析");
  }

  const secret: RedactSecret = {
    apiKey: config.payload.apiKey,
    embeddingApiKey: config.payload.embeddingApiKey,
    extraHeaders: config.options.extraHeaders,
  };
  const headers = buildHeaders(config);
  const requestBody = JSON.stringify(
    buildUpstreamChatBody(
      config.api,
      config.options.model,
      {
        messages: body.messages,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        stream: body.stream,
      },
      config.options.thinking ?? "off",
    ),
  );

  const baseOptions: GuardedRequestOptions = {
    method: "POST",
    headers,
    body: requestBody,
    timeoutMs: body.stream ? STREAM_TIMEOUT_MS : NON_STREAM_TIMEOUT_MS,
    maxBytes: MAX_UPSTREAM_BYTES,
    signal: request.signal,
  };

  if (body.stream) {
    let upstream;
    try {
      upstream = await guardedRequest(target, { ...baseOptions, stream: true });
    } catch (err) {
      return upstreamFailureResponse(err);
    }

    if (upstream.status < 200 || upstream.status >= 300) {
      const detail = await drainStream(upstream.stream, MAX_ERROR_BYTES);
      return jsonError(
        502,
        apiErrorCodes.providerError,
        `上游返回 HTTP ${upstream.status}：${safeDetail(detail, secret)}`,
      );
    }

    return new Response(
      sseProxyStream(upstream.stream, {
        signal: request.signal,
        secret,
        heartbeatMs: 15_000,
      }),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
        },
      },
    );
  }

  let upstream;
  try {
    upstream = await guardedRequest(target, baseOptions);
  } catch (err) {
    return upstreamFailureResponse(err);
  }

  const text = upstream.body.toString("utf8");
  if (upstream.status < 200 || upstream.status >= 300) {
    return jsonError(
      502,
      apiErrorCodes.providerError,
      `上游返回 HTTP ${upstream.status}：${safeDetail(text, secret)}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return jsonError(502, apiErrorCodes.providerError, "上游返回的不是 JSON");
  }

  return NextResponse.json(json);
}
