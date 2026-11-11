import { getDb } from "@/lib/db";
import { restoreLearningTask } from "@/lib/learningAssessment";
import { LearningContextError } from "@/lib/learningContext";
import { requireApiUser } from "@/lib/routeAuth";
import { readLearningSession } from "@/lib/learningSession";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const targetId = new URL(request.url).searchParams.get("targetId");
  if (!targetId || targetId.length > 100) return Response.json({ error: "缺少有效课程" }, { status: 400 });
  try {
    const db = await getDb();
    const restored = await restoreLearningTask(db,auth.user.id,targetId);
    const legacy = new URL(request.url).searchParams.get("legacy") === "1";
    return Response.json({ ...restored,...(legacy ? { turns:(await readLearningSession(db,auth.user.id,targetId)).session?.turns ?? [] } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof LearningContextError ? error.message : "读取教学会话失败" },
      { status: error instanceof LearningContextError ? error.status : 500 });
  }
}
