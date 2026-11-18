import { enforceRateLimit } from "@/lib/rateLimit";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  assertMutationOrigin,
  jsonError,
  readJsonObject,
  requireApiUser,
} from "@/lib/routeAuth";
import { documentRequest } from "@/lib/documentContracts";
import {
  createDocumentImport,
  DocumentError,
  processDocumentImport,
  putDocumentPart,
} from "@/lib/documentStore";
import {
  LearningContextError,
  checkDocumentTarget,
} from "@/lib/learningContext";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, "documents", 120);
  if (rateLimited !== null) return rateLimited;
  const origin = assertMutationOrigin(request);
  if (origin) return origin;
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const raw = await readJsonObject(request, 720 * 1024);
  if (!raw.ok) return raw.response;
  const parsed = documentRequest.safeParse(raw.value);
  if (!parsed.success)
    return jsonError(400, "bad_request", "附件请求格式不正确。");
  const body = parsed.data;
  const db = await getDb();
  try {
    let result;
    if (body.action === "create") {
      await checkDocumentTarget(db, auth.user.id, body.targetId, body.draftKey);
      result = await createDocumentImport(db, auth.user.id, body);
    } else if (body.action === "part")
      result = await putDocumentPart(
        db,
        auth.user.id,
        body.id,
        body.index,
        body.data,
      );
    else result = await processDocumentImport(db, auth.user.id, body.id);
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof DocumentError || error instanceof LearningContextError)
      return jsonError(error.status, "document_error", error.message);
    return jsonError(
      500,
      "document_error",
      "附件处理失败，已上传的分片会保留以便重试。",
    );
  }
}
