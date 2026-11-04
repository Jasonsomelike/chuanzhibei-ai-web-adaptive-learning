import { sanitizeProgress, type SubjectProgress, type AttemptRecord } from "@/lib/learner";

const revisions = new Map<string, string | null>();
const accepted = new Map<string, SubjectProgress>();
const queues = new Map<string, Promise<unknown>>();
const keyOf = (owner: string, subject: string) => `${owner}:${subject}`;

export function rememberProgressRevisions(owner: string, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  for (const [subject, revision] of Object.entries(raw)) {
    if (typeof revision === "string") revisions.set(keyOf(owner, subject), revision);
  }
}

export function mergeProgressEvidence(remote: SubjectProgress, local: SubjectProgress): SubjectProgress {
  const attempts = new Map<string, AttemptRecord>();
  for (const attempt of [...remote.attempts, ...local.attempts]) {
    const id = attempt.attemptId ?? `${attempt.questionId}:${attempt.kcId}:${attempt.at}:${attempt.selectedIndex ?? ""}`;
    const previous = attempts.get(id);
    attempts.set(id, previous?.retired ? { ...attempt, retired: true } : attempt);
  }
  const edits = new Map([...remote.pathEdits, ...local.pathEdits].map((edit) => [`${edit.at}:${edit.kind}:${edit.detail}`, edit]));
  return { ...local, attempts: [...attempts.values()].sort((a, b) => a.at.localeCompare(b.at)), pathEdits: [...edits.values()] };
}

/** 同一目标串行写；409 时先拉取另一设备证据，合并后重试，绝不静默覆盖。 */
export function pushProgress(owner: string, subjectId: string, progress: SubjectProgress,
  stillOwner: () => boolean, keepalive = false): Promise<SubjectProgress | null> {
  const key = keyOf(owner, subjectId);
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => null).then(async () => {
    let pending = accepted.has(key) && progress.attempts.length > 0
      ? mergeProgressEvidence(accepted.get(key)!, progress) : progress;
    for (let retry = 0; retry < 3; retry += 1) {
      if (!stillOwner()) return null;
      const response = await fetch("/api/progress", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, progress: pending, baseRevision: revisions.get(key) ?? null }),
        signal: AbortSignal.timeout(15_000),
        ...(keepalive ? { keepalive: true } : {}),
      });
      if (response.status === 409) {
        const latest = await fetch("/api/progress", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!latest.ok || !stillOwner()) return null;
        const body = await latest.json() as { progress?: Record<string, unknown>; revisions?: unknown };
        rememberProgressRevisions(owner, body.revisions);
        const remote = sanitizeProgress(body.progress?.[subjectId]);
        if (remote) pending = mergeProgressEvidence(remote, pending);
        continue;
      }
      if (!response.ok || !stillOwner()) return null;
      const body = await response.json() as { updatedAt?: string; progress?: unknown };
      if (typeof body.updatedAt === "string") revisions.set(key, body.updatedAt);
      const saved = sanitizeProgress(body.progress) ?? pending;
      accepted.set(key, saved);
      return saved;
    }
    return null;
  }).catch(() => null).finally(() => { if (queues.get(key) === run) queues.delete(key); });
  queues.set(key, run);
  return run;
}

export function clearProgressSyncCache(): void { revisions.clear(); accepted.clear(); }
