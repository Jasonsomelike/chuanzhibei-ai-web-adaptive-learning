import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  assertMutationOrigin,
  jsonError,
  readJsonObject,
  requireApiUser,
} from "@/lib/routeAuth";
import {
  LearningContextError,
  loadLearningContext,
} from "@/lib/learningContext";
import { isLlmConfigError, loadLlmConfigForUser } from "@/lib/upstream";
import { estimateLearningTime } from "@/lib/learningTimeServer";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  const origin = assertMutationOrigin(request);
  if (origin) return origin;
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const raw = await readJsonObject(request, 4096);
  if (!raw.ok) return raw.response;
  const parsed = z
    .strictObject({ targetId: z.string().min(1).max(100) })
    .safeParse(raw.value);
  if (!parsed.success) return jsonError(400, "bad_request", "请选择当前课程。");
  try {
    const db = await getDb();
    const context = await loadLearningContext(
      db,
      auth.user.id,
      parsed.data.targetId,
    );
    let config = null;
    try {
      config = await loadLlmConfigForUser(auth.user.id);
    } catch (e) {
      if (!isLlmConfigError(e) || e.code !== "CONFIG_MISSING") throw e;
    }
    return NextResponse.json(
      await estimateLearningTime(
        db,
        auth.user.id,
        context,
        config,
        request.signal,
      ),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return jsonError(
      e instanceof LearningContextError ? e.status : 500,
      "time_estimation_error",
      e instanceof LearningContextError
        ? e.message
        : "时长估算暂时不可用，仍可使用规则初估。",
    );
  }
}
