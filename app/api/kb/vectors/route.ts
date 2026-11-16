/**
 * /api/kb/vectors：本地 512 维向量的独立读写通道。
 *
 * GET  ?directionId=[&model=] → {model, dim, chunkIds}
 *      kbStore 在 chunks 同步完成后用它判断哪些 chunk 已有向量，只嵌缺口。
 * POST {model?, vectors:[{chunkId, vec}]} → {stored, model, dim}
 *      每批 ≤32 条、请求体 ≤512KB；向量不随文档 PUT 提交。
 *
 * 两个入口都要求登录。POST 额外要求同源、限量读取请求体；GET 没有请求体，
 * 但仍走 assertMutationOrigin 以保持「/api/kb 下所有入口同源」的一致口径。
 *
 * 向量表没有 direction_id：GET 的方向过滤在 kbVector.listStoredVectorChunkIds
 * 里通过 JOIN kb_chunks 完成；POST 的归属由 (user_id, chunk_id) 复合外键保证。
 */

import { enforceRateLimit } from "@/lib/rateLimit";
import { NextResponse } from "next/server";

import { apiErrorCodes } from "@/lib/apiContracts";
import { getDb } from "@/lib/db";
import { listStoredVectorChunkIds, storeKbVectors } from "@/lib/kbVector";
import { assertMutationOrigin, jsonError, readLimitedText, requireApiUser } from "@/lib/routeAuth";
import {
  KB_LOCAL_VECTOR_DIM,
  KB_LOCAL_VECTOR_MODEL,
  KB_VECTOR_UPLOAD_MAX_BYTES,
  kbVectorUpload,
  type KbVectorListResult,
  type KbVectorUploadResult,
} from "@/lib/vectorContracts";

export const runtime = "nodejs";

const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function validId(value: string): boolean {
  return value.length > 0 && value.length <= 120 && ENTITY_ID.test(value);
}

function param(url: URL, name: string): string {
  return (url.searchParams.get(name) ?? "").trim();
}

/** model 只接受本地模型标识；省略时也用本地模型。 */
function parseModel(raw: string): string | null {
  if (raw === "") return KB_LOCAL_VECTOR_MODEL;
  return raw === KB_LOCAL_VECTOR_MODEL ? raw : null;
}

export async function GET(request: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const origin = assertMutationOrigin(request);
  if (origin !== null) return origin;

  const url = new URL(request.url);
  const directionId = param(url, "directionId");
  if (!validId(directionId)) {
    return jsonError(400, apiErrorCodes.badRequest, "directionId 不合法");
  }

  const model = parseModel(param(url, "model"));
  if (model === null) {
    return jsonError(400, apiErrorCodes.badRequest, "model 只能是本地嵌入模型");
  }

  const db = await getDb();
  const chunkIds = await listStoredVectorChunkIds(db, guard.user.id, directionId, model);

  const body: KbVectorListResult = {
    model,
    dim: KB_LOCAL_VECTOR_DIM,
    chunkIds,
  };
  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, "kb-vectors", 240);
  if (rateLimited !== null) return rateLimited;
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const origin = assertMutationOrigin(request);
  if (origin !== null) return origin;

  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return jsonError(415, apiErrorCodes.badRequest, "请求体必须是 application/json");
  }

  // 边读边计数：chunked 请求没有 Content-Length，只看头会被绕过
  const body = await readLimitedText(request, KB_VECTOR_UPLOAD_MAX_BYTES);
  if (!body.ok) return body.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return jsonError(400, apiErrorCodes.badRequest, "请求体不是合法 JSON");
  }

  const upload = kbVectorUpload.safeParse(parsed);
  if (!upload.success) {
    return jsonError(
      400,
      apiErrorCodes.badRequest,
      "向量请求体不符合契约（每批 ≤32 条、每条 512 维有限值）",
    );
  }

  const db = await getDb();
  const stored = await storeKbVectors(db, guard.user.id, upload.data);

  const result: KbVectorUploadResult = {
    stored,
    model: upload.data.model ?? KB_LOCAL_VECTOR_MODEL,
    dim: KB_LOCAL_VECTOR_DIM,
  };
  return NextResponse.json(result);
}
