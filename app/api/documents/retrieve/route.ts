import { enforceRateLimit } from "@/lib/rateLimit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  assertMutationOrigin,
  readJsonObject,
  requireApiUser,
  jsonError,
} from "@/lib/routeAuth";
import { retrieveDocuments } from "@/lib/documentRetrieval";
import { DocumentError } from "@/lib/documentReferences";
import {
  LearningContextError,
  loadLearningCourse,
} from "@/lib/learningContext";
import { loadLlmConfigForUser, isLlmConfigError } from "@/lib/upstream";
export const runtime = "nodejs";
const schema = z.strictObject({
  providerMode: z.enum(["local", "server"]).default("server"),
  targetId: z.string().min(1).max(100),
  query: z.string().min(1).max(16000),
  documentIds: z.array(z.string().uuid()).max(20),
  occupiedTokens: z.number().int().min(0).max(2_000_000).default(0),
  contextWindowTokens: z.number().int().min(4096).max(2_000_000).optional(),
  responseReserveTokens: z.number().int().min(256).max(128000).optional(),
  retrievalMaxTokens: z.number().int().min(256).max(128000).optional(),
});
export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, "documents-retrieve", 30);
  if (rateLimited !== null) return rateLimited;
  const origin = assertMutationOrigin(request);
  if (origin) return origin;
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const raw = await readJsonObject(request, 80 * 1024);
  if (!raw.ok) return raw.response;
  const parsed = schema.safeParse(raw.value);
  if (!parsed.success) return jsonError(400, "bad_request", "检索参数不正确。");
  const b = parsed.data;
  const db = await getDb();
  try {
    await loadLearningCourse(db, auth.user.id, b.targetId);
    let config = b;
    try {
      if (b.providerMode === "server")
        config = {
          ...b,
          ...(await loadLlmConfigForUser(auth.user.id)).options,
        };
    } catch (e) {
      if (!isLlmConfigError(e) || e.code !== "CONFIG_MISSING") throw e;
    }
    return NextResponse.json(
      await retrieveDocuments(
        db,
        auth.user.id,
        b.targetId,
        b.query,
        b.documentIds,
        config,
        b.occupiedTokens,
      ),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return jsonError(
      e instanceof DocumentError || e instanceof LearningContextError
        ? e.status
        : 500,
      "document_error",
      e instanceof DocumentError || e instanceof LearningContextError
        ? e.message
        : "资料检索失败，请重试。",
    );
  }
}
