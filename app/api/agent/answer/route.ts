import { getDb } from "@/lib/db";
import { answerRequest } from "@/lib/learningWorkflowContracts";
import { assessLearningExercise, AssessmentError } from "@/lib/learningAssessment";
import { LearningContextError } from "@/lib/learningContext";
import { assertMutationOrigin, readLimitedText, requireApiUser } from "@/lib/routeAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const origin = assertMutationOrigin(request);
  if (origin) return origin;
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return Response.json({ error: "请求体必须是 application/json" }, { status: 415 });
  const limited = await readLimitedText(request, 4096);
  if (!limited.ok) return limited.response;
  let raw: unknown;
  try { raw = JSON.parse(limited.text); } catch { return Response.json({ error: "请求体不是 JSON" }, { status: 400 }); }
  const parsed = answerRequest.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "练习提交参数不合法" }, { status: 400 });
  try {
    return Response.json(await assessLearningExercise(await getDb(), auth.user.id, parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof AssessmentError || error instanceof LearningContextError ? error.message : "练习提交失败，请重试" },
      { status: error instanceof AssessmentError || error instanceof LearningContextError ? error.status : 500 });
  }
}
