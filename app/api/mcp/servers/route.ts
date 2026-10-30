/**
 * 用户自建 MCP 服务器的 CRUD：GET 列表 / PUT 保存 / DELETE 删除。
 *
 * 边界：
 * - 全部要求登录 + 同源（requireApiUser / assertMutationOrigin）：这是写密钥的入口；
 * - 请求体只接受 serverId/label/url/enabled/allowedTools/auth，未知字段直接 400
 *   （strictObject）。模型地址、密钥、服务器 id 都不允许出现在查询参数里；
 * - 响应只回 PublicMcpServer（authConfigured + authHint），类型上不存在密文字段；
 * - 加密、内存后端拦截、SSRF 判定全部在 mcpStore.ts 里做，路由不自己拼 SQL、不自己实现 AES；
 * - DELETE 用查询参数 ?serverId=，不接收请求体（避免「删哪个」与 body 解析顺序耦合）。
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorCodes } from "@/lib/apiContracts";
import { getDb } from "@/lib/db";
import {
  McpStoreError,
  deleteMcpServer,
  listMcpServers,
  saveMcpServer,
} from "@/lib/mcpStore";
import { assertMutationOrigin, jsonError, readJsonObject, requireApiUser } from "@/lib/routeAuth";
import { SecretCryptoError } from "@/lib/secretCrypto";
import { UserSecretError } from "@/lib/userSecrets";

export const runtime = "nodejs";

/** 配置体都很小：最多 50 条工具名 + 一个鉴权头。 */
const MAX_MCP_SERVERS_BODY_BYTES = 16 * 1024;

const authHeader = z.strictObject({
  name: z.string().trim().min(1).max(64),
  value: z.string().min(1).max(2048),
});

/** auth 的三种语义：缺省 = 保留、null = 清除、对象 = 重新保存。 */
const putBody = z.strictObject({
  serverId: z.string().trim().min(1).max(32),
  label: z.string().trim().max(60).optional(),
  url: z.string().trim().min(1).max(2048),
  enabled: z.boolean().optional(),
  allowedTools: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  auth: authHeader.nullable().optional(),
});

function storeErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof McpStoreError) {
    switch (err.code) {
      case "INVALID_INPUT":
      case "INVALID_URL":
        return jsonError(400, apiErrorCodes.badRequest, err.message);
      case "TOO_MANY_SERVERS":
        return jsonError(409, "TOO_MANY_SERVERS", err.message);
      case "SECRET_UNREADABLE":
        return jsonError(409, "SECRET_UNREADABLE", err.message);
    }
  }
  if (err instanceof UserSecretError) {
    if (err.code === "SECRET_STORAGE_UNAVAILABLE") {
      return jsonError(503, "PERSISTENCE_UNAVAILABLE", err.message);
    }
    if (
      err.code === "INVALID_INPUT" ||
      err.code === "INVALID_OPTIONS" ||
      err.code === "SECRET_TOO_SHORT"
    ) {
      return jsonError(400, apiErrorCodes.badRequest, err.message);
    }
  }
  if (err instanceof SecretCryptoError) {
    if (err.code === "KEY_ENC_UNAVAILABLE") {
      return jsonError(503, "KEY_ENC_UNAVAILABLE", err.message);
    }
    return jsonError(409, "SECRET_UNREADABLE", "保存的鉴权头无法加密，请检查服务端密钥配置。");
  }
  return null;
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  try {
    const db = await getDb();
    const servers = await listMcpServers(db, auth.user.id);
    return NextResponse.json(
      { servers },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return jsonError(500, apiErrorCodes.internal, "读取 MCP 服务器配置失败");
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const crossSite = assertMutationOrigin(request);
  if (crossSite) return crossSite;

  const raw = await readJsonObject(request, MAX_MCP_SERVERS_BODY_BYTES);
  if (!raw.ok) return raw.response;

  const parsed = putBody.safeParse(raw.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}：` : "";
    return jsonError(400, apiErrorCodes.badRequest, `${where}${issue?.message ?? "请求体不符合契约"}`);
  }
  const body = parsed.data;

  try {
    const db = await getDb();
    const server = await saveMcpServer(db, auth.user.id, {
      serverId: body.serverId,
      ...(body.label === undefined ? {} : { label: body.label }),
      url: body.url,
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(body.allowedTools === undefined ? {} : { allowedTools: body.allowedTools }),
      ...(body.auth === undefined ? {} : { auth: body.auth }),
    });
    return NextResponse.json({ server }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const mapped = storeErrorResponse(err);
    if (mapped !== null) return mapped;
    return jsonError(500, apiErrorCodes.internal, "保存 MCP 服务器配置失败");
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const crossSite = assertMutationOrigin(request);
  if (crossSite) return crossSite;

  const serverId = (new URL(request.url).searchParams.get("serverId") ?? "").trim();
  if (serverId === "") {
    return jsonError(400, apiErrorCodes.badRequest, "缺少 serverId");
  }

  try {
    const db = await getDb();
    const removed = await deleteMcpServer(db, auth.user.id, serverId);
    return NextResponse.json(
      { ok: true, removed },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const mapped = storeErrorResponse(err);
    if (mapped !== null) return mapped;
    return jsonError(500, apiErrorCodes.internal, "删除 MCP 服务器配置失败");
  }
}
