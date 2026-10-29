/**
 * 健康检查。
 *
 * 边界：
 * - 公开响应永远只有 {ok:true}。它会被监控、探活、甚至被第三方看到，
 *   任何「哪个组件没配好」的信息都不该无条件暴露。
 * - 只有请求头 `Authorization: Bearer <HEALTH_TOKEN>` 与 env 完全一致时，
 *   才多回 keyEncryption 与 db 两个不含任何密钥片段的指示。
 * - 未配置 HEALTH_TOKEN 时，详细分支永远不打开：没有可比的秘密，
 *   就不能把「请求头长得对」当成授权。
 * - 比较走常量时间摘要，避免按字节试探 token。
 */

import { NextResponse } from "next/server";

import { dbBackend } from "@/lib/db";
import { timingSafeEqualText } from "@/lib/routeAuth";
import { resolveSecretKey } from "@/lib/secretCrypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KeyEncryptionState = "ok" | "missing" | "invalid";

export async function GET(request: Request) {
  const token = (process.env.HEALTH_TOKEN ?? "").trim();
  if (token === "") return publicOnly();

  const header = (request.headers.get("authorization") ?? "").trim();
  if (!(await timingSafeEqualText(header, `Bearer ${token}`))) return publicOnly();

  return NextResponse.json(
    {
      ok: true,
      keyEncryption: keyEncryptionState(),
      db: dbBackend(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

function publicOnly(): NextResponse {
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

/**
 * 只回答「主密钥能不能用」：missing 表示没配，invalid 表示配了但不是
 * 32 字节标准 base64。两者都不回显任何密钥内容。
 */
function keyEncryptionState(): KeyEncryptionState {
  if ((process.env.ALP_SECRET_KEY ?? "").trim() === "") return "missing";
  try {
    resolveSecretKey();
    return "ok";
  } catch {
    return "invalid";
  }
}
