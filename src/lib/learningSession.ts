/** Latest teaching checkpoint per account/course. CAS prevents concurrent turns overwriting each other. */
import { z } from "zod";
import type { Db } from "@/lib/db";
import { workflowSnapshot } from "@/lib/learningWorkflowContracts";

const sessionData = z.object({
  version: z.literal(1), snapshot: workflowSnapshot,
  turns: z.array(z.object({ question: z.string().max(1000), answer: z.string().max(1500) })).max(4),
});
export type LearningSession = z.infer<typeof sessionData>;
export interface SessionRow { revision: string; data: string }

export async function readLearningSession(db: Db, userId: string, targetId: string) {
  const row = await db.one<SessionRow>(
    "SELECT * FROM learning_sessions WHERE user_id = $1 AND target_id = $2", [userId, targetId],
  );
  if (!row) return { revision: null, session: null };
  let raw: unknown;
  try { raw = JSON.parse(row.data); } catch { throw new Error("教学会话存档损坏"); }
  const parsed = sessionData.safeParse(raw);
  if (!parsed.success || parsed.data.snapshot.targetId !== targetId) throw new Error("教学会话存档不合法");
  return { revision: row.revision, session: parsed.data };
}

export async function saveLearningSession(db: Db, userId: string, targetId: string, base: string | null, data: LearningSession): Promise<boolean> {
  const parsed = sessionData.parse(data);
  const changed = await db.run(
    `INSERT INTO learning_sessions (user_id, target_id, revision, data) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, target_id) DO UPDATE SET revision = $3, data = $4
     WHERE learning_sessions.revision = $5 AND $5 IS NOT NULL`,
    [userId, targetId, parsed.snapshot.runId, JSON.stringify(parsed), base],
  );
  return changed === 1;
}
