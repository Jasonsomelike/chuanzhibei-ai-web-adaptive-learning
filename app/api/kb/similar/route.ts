/**
 * POST /api/kb/similar：只接收查询向量，服务端做精确余弦扫描。
 *
 * 请求：{directionId, vector:[512 floats], model?, limit?}
 * 响应：{model, dim, hits:[{chunkId, score}]}
 *
 * SQL 固定为 KB_VECTOR_SQL.similar：
 *   FROM kb_chunk_vectors v JOIN kb_chunks c ON ...
 *   WHERE v.user_id=$1 AND c.direction_id=$2 AND v.model=$3
 *   ORDER BY v.vec <=> $4::vector(512) LIMIT $5
 * 向量表没有 direction_id，方向必须来自 JOIN；默认不启用 HNSW，也不做
 * SET LOCAL（Neon HTTP 每次 query 独立，SET LOCAL 不会保留）。
 *
 * 登录、同源、限量读取请求体三件套与 /api/kb/vectors 的 POST 一致。
 */

import { enforceRateLimit } from "@/lib/rateLimit";
import { NextResponse } from "next/server";

import { apiErrorCodes } from "@/lib/apiContracts";
import { getDb } from "@/lib/db";
import { querySimilarChunks } from "@/lib/kbVector";
import { assertMutationOrigin, jsonError, readLimitedText, requireApiUser } from "@/lib/routeAuth";
import {
  KB_LOCAL_VECTOR_DIM,
  KB_LOCAL_VECTOR_MODEL,
  KB_SIMILAR_DEFAULT_LIMIT,
  KB_SIMILAR_MAX_BYTES,
  kbSimilarRequest,
  type KbSimilarResult,
} from "@/lib/vectorContracts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, "kb-similar", 60);
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

  const body = await readLimitedText(request, KB_SIMILAR_MAX_BYTES);
  if (!body.ok) return body.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return jsonError(400, apiErrorCodes.badRequest, "请求体不是合法 JSON");
  }

  const query = kbSimilarRequest.safeParse(parsed);
  if (!query.success) {
    return jsonError(
      400,
      apiErrorCodes.badRequest,
      "相似查询请求体不符合契约（directionId + 512 维有限查询向量）",
    );
  }

  const model = query.data.model ?? KB_LOCAL_VECTOR_MODEL;
  const limit = query.data.limit ?? KB_SIMILAR_DEFAULT_LIMIT;
  const db = await getDb();
  const hits = await querySimilarChunks(
    db,
    guard.user.id,
    query.data.directionId,
    query.data.vector,
    limit,
    model,
  );

  const result: KbSimilarResult = { model, dim: KB_LOCAL_VECTOR_DIM, hits };
  return NextResponse.json(result);
}
