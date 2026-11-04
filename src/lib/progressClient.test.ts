import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearProgressSyncCache, mergeProgressEvidence, pushProgress } from "@/lib/progressClient";
import { createSubjectProgress, type AttemptRecord } from "@/lib/learner";
const attempt = (id: string): AttemptRecord => ({ attemptId: id, questionId: id, kcId: "c01", difficulty: 1, correct: true, at: "2026-11-04T00:00:00Z", selectedIndex: 0 });
const progress = (id: string) => ({ ...createSubjectProgress("data-structures"), attempts: [attempt(id)] });
beforeEach(clearProgressSyncCache);
afterEach(() => vi.unstubAllGlobals());
it("合并跨设备记录时按稳定 id 去重，归档标记不能被旧副本撤回", () => {
  const remote = { ...progress("a"), attempts: [{ ...attempt("a"), retired: true }] };
  expect(mergeProgressEvidence(remote, progress("a")).attempts).toEqual(remote.attempts);
  expect(mergeProgressEvidence(progress("a"), progress("b")).attempts).toHaveLength(2);
});
it("冲突后拉取另一设备的证据并以新版本重试", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ progress: { "data-structures": progress("remote") }, revisions: { "data-structures": "rev2" } }))
    .mockResolvedValueOnce(Response.json({ updatedAt: "rev3", progress: mergeProgressEvidence(progress("remote"), progress("local")) }));
  vi.stubGlobal("fetch", fetcher);
  const saved = await pushProgress("alice", "data-structures", progress("local"), () => true);
  expect(saved?.attempts).toHaveLength(2);
  const retry = JSON.parse(fetcher.mock.calls[2][1].body);
  expect(retry.baseRevision).toBe("rev2");
  expect(retry.progress.attempts.map((a: AttemptRecord) => a.attemptId)).toEqual(["remote", "local"]);
});
it("账号变化后不执行排队请求", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await pushProgress("alice", "data-structures", progress("local"), () => false)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
