import { beforeEach, describe, expect, it } from "vitest";
import { SUBJECTS } from "@/data/subjects";
import { createSubjectProgress, createLearner, recordAttempt, clearKcEvidence, progressOf } from "@/lib/learner";
import { callLearningTool, learningAgentTools, loadLearningContext, recomputeProgress, evidenceStatus, type LearningCourse } from "@/lib/learningContext";
import { __resetMemoryDbForTests, getDb } from "@/lib/db";
import { computeInputHash } from "@/lib/plan";

const course: LearningCourse = { ...SUBJECTS[0], kind: "subject" };
const question = course.questions[0];
const now = "2026-11-04T01:00:00.000Z";
const answered = () => progressOf(recordAttempt(createLearner(), course.id, question, true, now,
  { selectedIndex: question.answerIndex }), course.id);

beforeEach(() => __resetMemoryDbForTests());
describe("服务端学习证据", () => {
  it("忽略伪造掌握度、对错、难度与权重，按题库选项重算", () => {
    const progress = answered();
    const raw = { ...progress, mastery: progress.mastery.map((m) => ({ ...m, alpha: 999, evidenceN: 999 })),
      attempts: [{ ...progress.attempts[0], selectedIndex: (question.answerIndex + 1) % 4, correct: true, difficulty: 5, weightScale: 999 }] };
    const result = recomputeProgress(raw, course);
    expect(result.attempts[0].correct).toBe(false);
    expect(result.attempts[0].difficulty).toBe(question.difficulty);
    expect(result.attempts[0].weightScale).toBe(1);
    const m = result.mastery.find((entry) => entry.kcId === question.kcId)!;
    expect(m.evidenceN).toBe(1);
    expect(m.alpha).toBe(createSubjectProgress(course.id).mastery.find((entry) => entry.kcId === m.kcId)!.alpha);
  });
  it("未知题目、缺少选项、同题重复都不能增加有效证据", () => {
    const progress = answered();
    const attempt = progress.attempts[0];
    const result = recomputeProgress({ ...progress, attempts: [attempt, attempt,
      { ...attempt, questionId: "made-up" }, { ...attempt, selectedIndex: undefined }] }, course);
    expect(result.mastery.find((m) => m.kcId === question.kcId)?.evidenceN).toBe(1);
    expect(result.attempts).toHaveLength(4);
  });
  it("归档旧记录不删历史，重测同题仅计新证据", () => {
    let learner = recordAttempt(createLearner(), course.id, question, false, now, { selectedIndex: (question.answerIndex + 1) % 4 });
    learner = clearKcEvidence(learner, course.id, question.kcId);
    learner = recordAttempt(learner, course.id, question, true, now, { selectedIndex: question.answerIndex });
    const result = recomputeProgress(progressOf(learner, course.id), course);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].counted).toBe(false);
    expect(result.attempts[1].counted).toBe(true);
    expect(result.mastery.find((m) => m.kcId === question.kcId)?.evidenceN).toBe(1);
  });
  it("零记录为未知，少量证据为不足", () => {
    expect(evidenceStatus(createSubjectProgress(course.id).mastery[0])).toBe("unobserved");
    expect(evidenceStatus(answered().mastery[0])).toBe("insufficient");
  });
});

describe("Agent 绑定上下文", () => {
  it("读取当前账号记录且拒绝模型伪造或跨科参数", async () => {
    const db = await getDb();
    await db.run("INSERT INTO progress (user_id, subject_id, data, updated_at) VALUES ($1,$2,$3,$4)",
      ["alice", course.id, JSON.stringify(answered()), now]);
    const context = await loadLearningContext(db, "alice", course.id);
    const text = callLearningTool(context, "get_learner_state", {});
    expect(JSON.parse(text).concepts[0].evidenceN).toBe(1);
    expect(JSON.parse(text).concepts[1].mean).toBeNull();
    expect(() => callLearningTool(context, "plan_path", { mastery: [] })).toThrow("不能由模型提供");
    expect(() => callLearningTool(context, "get_learner_state", { subject: "network" })).toThrow("当前学习目标");
    const other = await loadLearningContext(db, "bob", course.id);
    expect(JSON.parse(callLearningTool(other, "get_learner_state", {})).concepts[0].evidenceN).toBe(0);
  });
  it("工具 schema 不提供 mastery；路径可复现且预算、知识点需校验", async () => {
    for (const tool of learningAgentTools()) expect(tool.parameters.properties).not.toHaveProperty("mastery");
    const context = await loadLearningContext(await getDb(), "alice", course.id);
    expect(callLearningTool(context, "plan_path", { budgetMinutes: 30 })).toBe(callLearningTool(context, "plan_path", { budgetMinutes: 30 }));
    const plan = JSON.parse(callLearningTool(context, "plan_path", { budgetMinutes: 60 }, 90));
    expect(plan.inputHash).toBe(computeInputHash({ graph: course.graph, mastery: context.progress.mastery, budgetMinutes: 60 }));
    expect(() => callLearningTool(context, "plan_path", { budgetMinutes: Infinity })).toThrow();
    expect(() => callLearningTool(context, "plan_path", { targets: ["outside"] })).toThrow();
  });
  it("自定义方向按权限加载，不回落内置课程", async () => {
    const db = await getDb();
    const graph = { version: "custom-v1", concepts: [{ id: "k1", name: "自定义基础", chapter: "第一章", summary: "只属于本课程" }], edges: [] };
    await db.run("INSERT INTO directions (id,user_id,title,subject_id,description,graph_json,is_public,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      ["custom", "alice", "我的课程", "custom", "", JSON.stringify(graph), false, now, now]);
    await expect(loadLearningContext(db, "bob", "custom")).rejects.toMatchObject({ status: 403 });
    const context = await loadLearningContext(db, "alice", "custom");
    const result = JSON.parse(callLearningTool(context, "get_learner_state", {}));
    expect(result.targetId).toBe("custom");
    expect(result.concepts.map((c: { kcId: string }) => c.kcId)).toEqual(["k1"]);
    await expect(loadLearningContext(db, "alice", "missing")).rejects.toMatchObject({ status: 404 });
  });
});
