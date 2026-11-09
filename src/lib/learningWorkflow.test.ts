import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUBJECTS } from "@/data/subjects";
import { createSubjectProgress } from "@/lib/learner";
import { callLearningTool, type LearningContext } from "@/lib/learningContext";
import { prepareTeachingTask, routeTeachingTask, runTeachingWorkflow, verifyTeachingResponse } from "@/lib/learningWorkflow";
import { readLearningSession, saveLearningSession } from "@/lib/learningSession";
import { __resetMemoryDbForTests, getDb } from "@/lib/db";
import { assessLearningExercise, restoreLearningTask } from "@/lib/learningAssessment";
import { DEFAULT_AGENT_LIMITS, type AgentEvent } from "@/lib/agentContracts";

const course = { ...SUBJECTS[0], kind: "subject" as const };
const context = (): LearningContext => ({ course, progress: createSubjectProgress(course.id), revision: null, uploads: [], uploadHits: [], uploadScanLimited: false });
beforeEach(() => { __resetMemoryDbForTests(); });

describe("Learning Supervisor", () => {
  it.each([
    ["今天只有30分钟，先学什么？", "review_path"], ["请出一道练习题", "practice"],
    ["为什么刚才答错了？", "analyze_error"], ["不要给答案，只给提示", "hint"], ["什么是线性表？", "explain"],
  ])("routes %s", (question, intent) => expect(routeTeachingTask({ question }).intent).toBe(intent));

  it("explicit task and budget override text; time-only follow-up preserves budget", () => {
    expect(routeTeachingTask({ question: "讲解一下，今天30分钟", intent: "hint", budgetMinutes: 60 })).toMatchObject({ intent: "hint", budgetMinutes: 60 });
    const task = prepareTeachingTask(context(), { question: "今天30分钟先学什么" }, null);
    expect(routeTeachingTask({ question: "继续讲" }, task.snapshot).budgetMinutes).toBe(30);
  });

  it("plans before LLM and does not turn unobserved concepts into weak points", () => {
    const c = context(); const task = prepareTeachingTask(c, { question: "今天30分钟先学什么" }, null);
    const actual = JSON.parse(callLearningTool(c, "plan_path", { budgetMinutes: 30 }));
    expect(task.snapshot.plan?.pathHash).toBe(actual.pathHash);
    expect(task.snapshot.plan?.totalMinutes).toBeLessThanOrEqual(30);
    expect(task.initialToolResults[0].text).toContain('"mean":null');
    expect(task.policy).toContain("不要自行重排");
    expect(task.snapshot.focusKcId).toBe(actual.steps[0].kcId);
  });

  it("time budgets understand hours and do not override an explicit exercise intent", () => {
    expect(routeTeachingTask({ question: "用半小时练习" })).toMatchObject({ intent: "practice", budgetMinutes: 30 });
    expect(routeTeachingTask({ question: "只有1小时" }).budgetMinutes).toBe(60);
  });

  it("validates and carries focus across follow-ups, while reset removes short-term memory", () => {
    const name = course.graph.concepts[5].name;
    const first = prepareTeachingTask(context(), { question: `请讲解${name}` }, null);
    const previous = { version: 1 as const, snapshot: first.snapshot, turns: [{ question: "前文", answer: "引导" }] };
    const next = prepareTeachingTask(context(), { question: "继续出一道练习" }, previous);
    expect(next.snapshot.focusKcId).toBe(first.snapshot.focusKcId);
    expect(next.snapshot.resumedTurns).toBe(1);
    const reset = prepareTeachingTask(context(), { question: "讲解", resetSession: true }, previous);
    expect(reset.history).toEqual([]);
    expect(reset.snapshot.resumedTurns).toBe(0);
  });

  it("exercise artifact has no answer/explanation and chooses unanswered items", () => {
    const c = context();
    const task = prepareTeachingTask(c, { question: `练习${course.graph.concepts[0].name}`, intent: "practice" }, null);
    expect(task.snapshot.exercise).toBeDefined();
    expect(Object.keys(task.snapshot.exercise!)).not.toContain("answerIndex");
    expect(Object.keys(task.snapshot.exercise!)).not.toContain("explanation");
    const q = course.questions.find(q => q.id === task.snapshot.exercise!.questionId)!;
    const next = prepareTeachingTask({ ...c, progress: { ...c.progress, attempts: [{ questionId: q.id, kcId: q.kcId, selectedIndex: 0, correct: false, difficulty: q.difficulty, at: "2026-11-09T00:00:00Z" }] } }, { question: `练习${course.graph.concepts[0].name}`, intent: "practice" }, null);
    expect(next.snapshot.exercise?.questionId).not.toBe(q.id);
  });

  it("rule verifier masks forged citation IDs and fingerprints without claiming fact verification", () => {
    const c = context(); const task = prepareTeachingTask(c, { question: "解释" }, null);
    const reviewed = verifyTeachingResponse(`合法 [${course.graph.concepts[0].id}]，伪造 [c999] [资料1] ${"f".repeat(64)}`, task, c);
    expect(reviewed.text).not.toContain("[c999]"); expect(reviewed.text).not.toContain("[资料1]");
    expect(reviewed.text).not.toContain("f".repeat(64));
    expect(reviewed.verification.status).toBe("guarded");
  });

  it("practice pauses without a model call and emits exactly one done", async () => {
    const c = context(); const task = prepareTeachingTask(c, { question: "练习", intent: "practice" }, null);
    const events: AgentEvent[] = []; const callModel = vi.fn();
    await runTeachingWorkflow({ task, context: c, runner: { question: "练习", systemPrompt: "", tools: [], limits: DEFAULT_AGENT_LIMITS, callModel, callTool: vi.fn() }, emit: e => events.push(e), checkpoint: async () => true });
    expect(callModel).not.toHaveBeenCalled();
    expect(events.filter(e => e.type === "done")).toHaveLength(1);
    expect(task.snapshot.status).toBe("awaiting_answer");
    expect(task.snapshot.persisted).toBe(true);
  });

  it("LLM cannot reach planner tools from the tutor role; reviewed text only is published", async () => {
    const c = context(); const task = prepareTeachingTask(c, { question: "解释" }, null);
    const events: AgentEvent[] = [];
    await runTeachingWorkflow({ task, context: c, runner: { question: "解释", systemPrompt: "", tools: [{ name: "plan_path", serverId: null, description: "", parameters: {} }], limits: DEFAULT_AGENT_LIMITS,
      callModel: async req => { expect(req.tools).toEqual([]); return { text: "伪造 [c999]", toolCalls: [] }; }, callTool: vi.fn() }, emit: e => events.push(e), checkpoint: async () => true });
    expect(events.find(e => e.type === "text")).toMatchObject({ text: expect.not.stringContaining("[c999]") });
    expect(task.snapshot.verification?.status).toBe("guarded");
  });

  it("cancelled or failed runs do not overwrite the previous checkpoint", async () => {
    const c = context(); const task = prepareTeachingTask(c, { question: "解释" }, null);
    const checkpoint = vi.fn(); const events: AgentEvent[] = [];
    const controller = new AbortController(); controller.abort();
    await runTeachingWorkflow({ task, context: c, runner: { question: "解释", systemPrompt: "", tools: [], limits: DEFAULT_AGENT_LIMITS, callModel: vi.fn(), callTool: vi.fn(), signal: controller.signal }, emit: e => events.push(e), checkpoint });
    expect(checkpoint).not.toHaveBeenCalled(); expect(task.snapshot.status).toBe("failed");
    expect(events.filter(e => e.type === "done")).toHaveLength(1);
  });
});

async function pending(user = "alice") {
  const db = await getDb();
  const task = prepareTeachingTask(context(), { question: "练习", intent: "practice", budgetMinutes: 30 }, null);
  task.snapshot.status = "awaiting_answer"; task.snapshot.persisted = true;
  await saveLearningSession(db, user, course.id, null, { version: 1, snapshot: task.snapshot, turns: [] });
  const q = course.questions.find(q => q.id === task.snapshot.exercise!.questionId)!;
  const body = { targetId: course.id, runId: task.snapshot.runId, questionId: q.id, selectedIndex: q.answerIndex };
  return { db, task, q, body };
}

describe("durable learning checkpoints and assessment", () => {
  it("isolates accounts/courses and rejects concurrent checkpoint replacement", async () => {
    const { db, task } = await pending();
    expect((await readLearningSession(db, "bob", course.id)).session).toBeNull();
    expect((await readLearningSession(db, "alice", SUBJECTS[1].id)).session).toBeNull();
    const a = prepareTeachingTask(context(), { question: "讲解" }, null).snapshot;
    const b = prepareTeachingTask(context(), { question: "讲解" }, null).snapshot;
    const results = await Promise.all([a, b].map(snapshot => saveLearningSession(db, "alice", course.id, task.snapshot.runId, { version: 1, snapshot, turns: [] })));
    expect(results.sort()).toEqual([false, true]);
  });

  it("grades, records verified evidence and replans; replay is idempotent", async () => {
    const { db, body } = await pending();
    const first = await assessLearningExercise(db, "alice", body);
    expect(first).toMatchObject({ correct: true, counted: true, duplicate: false, evidenceN: 1, evidenceStatus: "insufficient" });
    expect(first.workflow.plan?.totalMinutes).toBeLessThanOrEqual(30);
    const second = await assessLearningExercise(db, "alice", body);
    expect(second).toMatchObject({ duplicate: true, evidenceN: 1 });
    const stored = await db.one<{ data: string }>("SELECT * FROM progress WHERE user_id = $1 AND subject_id = $2", ["alice", course.id]);
    expect(JSON.parse(stored!.data).attempts).toHaveLength(1);
    const restored = await restoreLearningTask(db, "alice", course.id);
    expect(restored.assessment?.correct).toBe(true); expect(restored.workflow?.status).toBe("complete");
  });

  it("does not trust claimed correctness, mastery or invalid options", async () => {
    const { db, body } = await pending();
    await expect(assessLearningExercise(db, "alice", { ...body, correct: true })).rejects.toThrow();
    await expect(assessLearningExercise(db, "alice", { ...body, selectedIndex: 19 })).rejects.toThrow("选项不存在");
    await expect(assessLearningExercise(db, "bob", body)).rejects.toThrow("已过期");
    const wrong = await assessLearningExercise(db, "alice", { ...body, selectedIndex: (body.selectedIndex + 1) % 4 });
    expect(wrong.correct).toBe(false); expect(wrong.evidenceN).toBe(1);
    await expect(assessLearningExercise(db, "alice", body)).rejects.toThrow("不能修改");
  });

  it("concurrent submissions record one attempt and preserve unrelated progress", async () => {
    const { db, body } = await pending();
    const results = await Promise.all([assessLearningExercise(db, "alice", body), assessLearningExercise(db, "alice", body)]);
    expect(results.filter(r => !r.duplicate)).toHaveLength(1);
    const restored = await restoreLearningTask(db, "alice", course.id);
    expect(restored.assessment?.evidenceN).toBe(1);
  });

  it("stale cards cannot submit after a new task replaces the checkpoint", async () => {
    const { db, body, task } = await pending();
    const next = prepareTeachingTask(context(), { question: "解释" }, null);
    await saveLearningSession(db, "alice", course.id, task.snapshot.runId, { version: 1, snapshot: next.snapshot, turns: [] });
    await expect(assessLearningExercise(db, "alice", body)).rejects.toThrow("已过期");
  });

  it("changed question content makes restored and submitted cards unusable", async () => {
    const { db, body, task } = await pending();
    task.snapshot.exercise!.stem = "旧版本题目";
    await saveLearningSession(db, "alice", course.id, task.snapshot.runId, { version: 1, snapshot: task.snapshot, turns: [] });
    await expect(assessLearningExercise(db, "alice", body)).rejects.toThrow("已变化");
    expect((await restoreLearningTask(db, "alice", course.id)).workflow).toMatchObject({ status: "failed", persisted: false });
  });
});
