import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ user: { id: "alice" } as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => auth.user }));
import { GET, POST } from "../../app/api/progress/route";
import { __resetMemoryDbForTests } from "@/lib/db";
import { createLearner, recordAttempt, progressOf } from "@/lib/learner";
import { SUBJECTS } from "@/data/subjects";

const subject = SUBJECTS[0];
const q = subject.questions[0];
const progress = () => progressOf(recordAttempt(createLearner(), subject.id, q, true, "2026-11-04T00:00:00Z", { selectedIndex: q.answerIndex }), subject.id);
const request = (body: unknown) => new Request("http://localhost/api/progress", {
  method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => { __resetMemoryDbForTests(); auth.user = { id: "alice" }; });
describe("进度版本与重算", () => {
  it("服务端重新判分，拒绝客户端直接伪造掌握度", async () => {
    const p = progress();
    const response = await POST(request({ subjectId: subject.id, progress: { ...p, mastery: p.mastery.map((m) => ({ ...m, alpha: 999, evidenceN: 99 })) } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.progress.mastery[0].evidenceN).toBe(1);
    expect(body.progress.mastery[0].alpha).toBeLessThan(5);
    const read = await (await GET()).json();
    expect(read.revisions[subject.id]).toBe(body.updatedAt);
  });
  it("两个设备提交同一版本时只有一个成功，另一台收到 409", async () => {
    const first = await (await POST(request({ subjectId: subject.id, progress: progress(), baseRevision: null }))).json();
    const writes = await Promise.all([1, 2].map(() => POST(request({ subjectId: subject.id, progress: progress(), baseRevision: first.updatedAt }))));
    expect(writes.map((res) => res.status).sort()).toEqual([200, 409]);
    expect((await POST(request({ subjectId: subject.id, progress: progress() }))).status).toBe(409);
  });
  it("隔离账号，未知课程与无权方向不会被保存", async () => {
    expect((await POST(request({ subjectId: "unknown", progress: progress() }))).status).toBe(404);
    await POST(request({ subjectId: subject.id, progress: progress() }));
    auth.user = { id: "bob" };
    expect((await (await GET()).json()).progress).toEqual({});
    auth.user = null;
    expect((await GET()).status).toBe(401);
  });
  it("拒绝 null、数组与过大的请求", async () => {
    expect((await POST(request(null))).status).toBe(400);
    expect((await POST(request([]))).status).toBe(400);
    expect((await POST(request({ subjectId: subject.id, progress: { payload: "x".repeat(1024 * 1024) } }))).status).toBe(413);
  });
});
