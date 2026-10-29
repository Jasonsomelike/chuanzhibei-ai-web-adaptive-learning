/**
 * POST /api/tts：服务端语音合成代理。
 *
 * 边界：
 * - 必须登录（401）且同源（403）；Content-Type 必须是 JSON（415），正文 1–2000 字（400）。
 * - tts 行缺失或关键字段为空一律 404：让客户端明确回退浏览器语音，而不是反复重试。
 * - base_url 先过 ssrfGuard.assertUpstreamAllowed（https + 解析后禁内网/环回/元数据），
 *   再交给 synthesizeMimo / synthesizeSpeech；两者内部经 guardedRequest 再校验一次。
 * - 成功只返回音频字节与 audio/mpeg；失败返回 { error, code }，上游详情已在
 *   serverTts 内脱敏并截断到 200 字符，响应里绝不出现密钥。
 */

import { NextResponse } from "next/server";

import { tts, type ApiErrorCode } from "@/lib/apiContracts";
import { getCurrentUser } from "@/lib/auth";
import { MAX_TTS_BODY_BYTES } from "@/lib/bodyLimit";
import { getDb } from "@/lib/db";
import { sameOriginFromRequest } from "@/lib/origin";
import { readLimitedText } from "@/lib/routeAuth";
import { SecretCryptoError } from "@/lib/secretCrypto";
import { assertUpstreamAllowed, SsrfGuardError } from "@/lib/ssrfGuard";
import {
  resolveTtsApi,
  synthesizeMimo,
  synthesizeSpeech,
  TtsUpstreamError,
  type TtsRow,
} from "@/lib/serverTts";
import { loadUserSecret, UserSecretError, type LoadedUserSecret } from "@/lib/userSecrets";

export const runtime = "nodejs";

function failure(status: number, code: ApiErrorCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function ttsFailure(error: unknown): NextResponse {
  if (error instanceof SsrfGuardError) {
    return failure(502, "provider_error", `语音服务地址不可用：${error.message}`);
  }
  if (error instanceof TtsUpstreamError) {
    switch (error.kind) {
      case "rate-limit":
        return failure(429, "rate_limited", error.message);
      case "timeout":
        return failure(504, "provider_timeout", error.message);
      case "config":
        // 行存在但字段不全：这是配置问题，不是上游故障。
        return failure(409, "provider_not_configured", error.message);
      case "auth":
      case "blocked":
      case "http":
      case "parse":
      case "empty":
      case "too-large":
        return failure(502, "provider_error", error.message);
    }
  }
  return failure(502, "provider_error", "语音合成失败，请稍后再试");
}

/** 把 user_secrets 的行与公开 options 拼成 serverTts 需要的形状。 */
function toTtsRow(
  row: { readonly base_url: string; readonly model: string; readonly api: string },
  apiKey: string,
  options: Readonly<Record<string, string | number | boolean | undefined>>,
): TtsRow {
  const voice = typeof options.voice === "string" ? options.voice.trim() : "";
  const protocol = typeof options.protocol === "string" ? options.protocol.trim() : "";
  return {
    baseUrl: row.base_url,
    apiKey,
    model: row.model,
    api: row.api,
    ...(voice !== "" ? { voice } : {}),
    ...(protocol !== "" ? { protocol } : {}),
  };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return failure(401, "unauthorized", "请先登录");

  if (!sameOriginFromRequest(request)) {
    return failure(403, "forbidden", "请求来源不可信");
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return failure(415, "bad_request", "只接受 application/json");
  }

  // 正文上限 2000 字，所以体积上限可以很小；先限量读包再解析，
  // 避免裸 request.json() 把任意大的包收进内存。
  const raw = await readLimitedText(request, MAX_TTS_BODY_BYTES);
  if (!raw.ok) {
    // 保持本路由的 { error, code } 错误体，让 tts 客户端仍能读到错误码。
    if (raw.response.status === 413) {
      return failure(413, "payload_too_large", `请求体超过 ${MAX_TTS_BODY_BYTES} 字节上限`);
    }
    return raw.response;
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.text);
  } catch {
    return failure(400, "bad_request", "请求体不是合法 JSON");
  }

  const parsed = tts.safeParse(body);
  if (!parsed.success) {
    // zod 的默认英文消息不适合直接展示；长度是唯一可能的原因（空串也在其中）。
    return failure(400, "bad_request", "朗读文本必须是 1–2000 字");
  }

  let loaded: LoadedUserSecret | null;
  try {
    const db = await getDb();
    loaded = await loadUserSecret(db, user.id, "tts");
  } catch (error) {
    if (error instanceof SecretCryptoError || error instanceof UserSecretError) {
      return failure(
        500,
        "secret_key_missing",
        "无法读取已保存的语音密钥，请检查服务端 ALP_SECRET_KEY",
      );
    }
    return failure(500, "internal", "读取语音配置失败，请稍后再试");
  }

  const apiKey = (loaded?.payload.apiKey ?? "").trim();
  if (loaded === null || loaded.row.base_url.trim() === "" || apiKey === "") {
    return failure(404, "provider_not_configured", "语音服务未配置，请到设置页填写");
  }

  const row = toTtsRow(loaded.row, apiKey, loaded.config.options);
  const api = resolveTtsApi(row);

  try {
    // 路由层先挡一次；synthesize* 内部的 guardedRequest 还会再判一次（纵深防御）。
    await assertUpstreamAllowed(row.baseUrl);

    const audio =
      api === "mimo"
        ? await synthesizeMimo(row, parsed.data.text, row.voice)
        : await synthesizeSpeech(row, parsed.data.text);

    return new Response(audio.bytes, {
      status: 200,
      headers: {
        // 两条协议都请求 mp3；对外统一标 audio/mpeg，客户端只需一套播放逻辑。
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.bytes.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return ttsFailure(error);
  }
}
