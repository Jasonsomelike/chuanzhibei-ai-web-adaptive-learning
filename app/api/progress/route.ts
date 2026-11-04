import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertMutationOrigin, readLimitedText } from "@/lib/routeAuth";
import { loadLearningCourse, recomputeProgress, LearningContextError } from "@/lib/learningContext";
import { getDb } from "@/lib/db";
import { sanitizeProgress, type SubjectProgress } from "@/lib/learner";

export const runtime = "nodejs";

/**
 * 学习进度同步。
 *
 * 登录后进度存服务端（按用户 × 学科一行），未登录时前端仍用 localStorage。
 * 两者不冲突：登录时以服务端为准，登出后回落到本地。
 *
 * 之所以整块存 JSON 而不是拆成「每次作答一行」：
 * 一次诊断的进度是一个整体，整块存取能保证一致性，
 * 且省掉复杂的事务。代价是无法做跨用户的作答级分析——本期不需要。
 */

interface SyncBody {
  subjectId?: unknown;
  progress?: unknown;
  baseRevision?: unknown;
}

/** GET：取当前用户的全部进度。 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = await getDb();
  const rows = await db.all<{ subject_id: string; data: string; updated_at: string }>(
    "SELECT * FROM progress WHERE user_id = $1",
    [user.id],
  );

  const progress: Record<string, unknown> = {};
  const revisions: Record<string, string> = {};
  for (const row of rows) {
    try {
      const course = await loadLearningCourse(db, user.id, row.subject_id);
      progress[row.subject_id] = recomputeProgress(JSON.parse(row.data), course);
      revisions[row.subject_id] = row.updated_at;
    } catch {
      // 单条损坏不影响其他学科
    }
  }

  return NextResponse.json({ progress, revisions }, { headers: { "Cache-Control": "no-store" } });
}

/** POST：保存某学科的进度。 */
export async function POST(request: Request) {
  const origin = assertMutationOrigin(request);
  if (origin !== null) return origin;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: SyncBody;
  const limited = await readLimitedText(request, 1024 * 1024);
  if (!limited.ok) return limited.response;
  try {
    body = JSON.parse(limited.text) as SyncBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const subjectId = typeof body.subjectId === "string" ? body.subjectId : "";
  if (subjectId === "") {
    return NextResponse.json({ error: "缺少 subjectId" }, { status: 400 });
  }

  if (typeof body.progress !== "object" || body.progress === null) {
    return NextResponse.json({ error: "progress 必须是对象" }, { status: 400 });
  }
  if (!sanitizeProgress(body.progress)) return NextResponse.json({ error: "progress 结构不合法" }, { status: 400 });

  // 简单体量限制：单学科进度不应超过 512KB
  let json = JSON.stringify(body.progress);
  if (json.length > 512 * 1024) {
    return NextResponse.json({ error: "进度数据过大" }, { status: 413 });
  }

  const db = await getDb();
  let validated;
  try {
    const course = await loadLearningCourse(db, user.id, subjectId);
    validated = recomputeProgress(body.progress, course);
    json = JSON.stringify(validated);
  } catch (error) {
    return NextResponse.json({ error: error instanceof LearningContextError ? error.message : "学习数据无法校验" },
      { status: error instanceof LearningContextError ? error.status : 400 });
  }
  const existing = await db.one<{ updated_at: string }>("SELECT * FROM progress WHERE user_id = $1 AND subject_id = $2", [user.id, subjectId]);
  const base = typeof body.baseRevision === "string" ? body.baseRevision : null;
  if ((existing?.updated_at ?? null) !== base) return NextResponse.json({ error: "进度已在其他设备更新，请合并后重试", code: "revision_conflict" }, { status: 409 });
  const now = new Date(Math.max(Date.now(), Date.parse(existing?.updated_at ?? "") + 1 || 0)).toISOString();

  const changed = await db.run(
    `INSERT INTO progress (user_id, subject_id, data, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, subject_id) DO UPDATE SET data = $3, updated_at = $4
     WHERE progress.updated_at = $5 AND $5 IS NOT NULL`,
    [user.id, subjectId, json, now, base],
  );
  if (changed === 0) return NextResponse.json({ error: "进度版本冲突", code: "revision_conflict" }, { status: 409 });

  return NextResponse.json({ ok: true, updatedAt: now, progress: validated });
}

/** DELETE：清空当前用户的全部进度。 */
export async function DELETE(request: Request) {
  const origin = assertMutationOrigin(request);
  if (origin !== null) return origin;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = await getDb();
  await db.run("DELETE FROM progress WHERE user_id = $1", [user.id]);

  return NextResponse.json({ ok: true });
}

/** 供前端判断是否登录、以及拿到服务端进度时使用的形状。 */
export interface ServerProgress {
  readonly progress: Record<string, SubjectProgress>;
}
