/**
 * /api/kb：账号级知识库同步。
 *
 * GET   ?directionId=                         → {docs, chunks}（默认不含向量）
 * GET   ?directionId=&vectors=1&after=&limit= → {vectors, next}（chunk_id 升序，after 不含）
 * GET   ?docId=                               → {doc} 或 404
 * PUT   {doc, chunks, baseUpdatedAt}          → 文档级 LWW；版本不符 409 且不写任何行
 * DELETE ?docId= | ?directionId=              → {deletedDocs, deletedChunks}
 *
 * 服务端不设条数/容量配额：容量只在浏览器侧为 IndexedDB 预算服务；
 * 账号同步的目的就是让用户换设备后拿回全部资料。
 */

import { enforceRateLimit } from "@/lib/rateLimit";
import { NextResponse } from "next/server";

import { apiErrorCodes, kbPut } from "@/lib/apiContracts";
import { getDb } from "@/lib/db";
import {
  MAX_KB_PUT_BYTES,
  clampVectorLimit,
  deleteKbDirection,
  deleteKbDoc,
  getKbDoc,
  listDirectionChunks,
  listDirectionDocs,
  listDirectionVectors,
  putKbDocument,
  stripChunkEmbedding,
} from "@/lib/kbServer";
import { assertMutationOrigin, jsonError, readLimitedText, requireApiUser } from "@/lib/routeAuth";
import { embedTextsForUser } from "@/lib/serverEmbedding";

export const runtime = "nodejs";

/** 与 apiContracts 的 entityId 同一条安全字符集；查询参数不走 zod，需要手动挡。 */
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function validId(value: string): boolean {
  return value.length > 0 && value.length <= 120 && ENTITY_ID.test(value);
}

function param(url: URL, name: string): string {
  return (url.searchParams.get(name) ?? "").trim();
}

export async function GET(request: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const docId = param(url, "docId");
  const directionId = param(url, "directionId");
  const wantsVectors = url.searchParams.get("vectors") === "1";

  if (docId !== "" && directionId !== "") {
    return jsonError(400, apiErrorCodes.badRequest, "docId 与 directionId 只能提供一个");
  }
  if (docId === "" && directionId === "") {
    return jsonError(400, apiErrorCodes.badRequest, "缺少 docId 或 directionId");
  }

  const db = await getDb();

  if (docId !== "") {
    if (!validId(docId)) {
      return jsonError(400, apiErrorCodes.badRequest, "docId 不合法");
    }
    const doc = await getKbDoc(db, guard.user.id, docId);
    if (doc === null) {
      return jsonError(404, apiErrorCodes.notFound, "文档不存在");
    }
    return NextResponse.json({ doc });
  }

  if (!validId(directionId)) {
    return jsonError(400, apiErrorCodes.badRequest, "directionId 不合法");
  }

  if (wantsVectors) {
    const afterRaw = url.searchParams.get("after");
    const after = afterRaw === null || afterRaw.trim() === "" ? null : afterRaw.trim();
    if (after !== null && !validId(after)) {
      return jsonError(400, apiErrorCodes.badRequest, "after 不合法");
    }
    const limitRaw = url.searchParams.get("limit");
    const limit =
      limitRaw === null || limitRaw.trim() === "" ? null : Number(limitRaw);
    const page = await listDirectionVectors(
      db,
      guard.user.id,
      directionId,
      after,
      clampVectorLimit(limit === null || Number.isNaN(limit) ? null : limit),
    );
    return NextResponse.json(page);
  }

  const [docs, chunks] = await Promise.all([
    listDirectionDocs(db, guard.user.id, directionId),
    listDirectionChunks(db, guard.user.id, directionId),
  ]);

  return NextResponse.json({ docs, chunks: chunks.map(stripChunkEmbedding) });
}

export async function PUT(request: Request) {
  const rateLimited = enforceRateLimit(request, "kb-write", 30);
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

  // 必须边读边计数：chunked 请求没有 Content-Length，只查头会被绕过
  const body = await readLimitedText(request, MAX_KB_PUT_BYTES);
  if (!body.ok) return body.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return jsonError(400, apiErrorCodes.badRequest, "请求体不是合法 JSON");
  }

  const payload = kbPut.safeParse(parsed);
  if (!payload.success) {
    return jsonError(400, apiErrorCodes.badRequest, "知识库请求体不符合契约");
  }

  const db = await getDb();
  const result = await putKbDocument(db, guard.user.id, payload.data, {
    embedTexts: embedTextsForUser,
  });

  if (!result.ok) {
    return result.reason === "conflict"
      ? jsonError(409, "CONFLICT_STALE", result.message)
      : jsonError(400, apiErrorCodes.badRequest, result.message);
  }

  return NextResponse.json({
    doc: result.doc,
    updatedAt: result.updatedAt,
    storedChunks: result.storedChunks,
    deletedChunks: result.deletedChunks,
    embeddedChunks: result.embeddedChunks,
  });
}

export async function DELETE(request: Request) {
  const rateLimited = enforceRateLimit(request, "kb-write", 30);
  if (rateLimited !== null) return rateLimited;
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const origin = assertMutationOrigin(request);
  if (origin !== null) return origin;

  const url = new URL(request.url);
  const docId = param(url, "docId");
  const directionId = param(url, "directionId");

  if (docId !== "" && directionId !== "") {
    return jsonError(400, apiErrorCodes.badRequest, "docId 与 directionId 只能提供一个");
  }
  if (docId === "" && directionId === "") {
    return jsonError(400, apiErrorCodes.badRequest, "缺少 docId 或 directionId");
  }

  if (docId !== "" && !validId(docId)) {
    return jsonError(400, apiErrorCodes.badRequest, "docId 不合法");
  }
  if (directionId !== "" && !validId(directionId)) {
    return jsonError(400, apiErrorCodes.badRequest, "directionId 不合法");
  }

  const db = await getDb();
  const deleted =
    docId !== ""
      ? await deleteKbDoc(db, guard.user.id, docId)
      : await deleteKbDirection(db, guard.user.id, directionId);

  return NextResponse.json(deleted);
}
