/** Exercise submission is an explicit user action; LLM text never updates learning evidence. */
import type { Db } from "@/lib/db";
import { evidenceStatus, loadLearningContext, recomputeProgress, type LearningContext } from "@/lib/learningContext";
import { readLearningSession } from "@/lib/learningSession";
import { answerRequest, assessmentResult, type AssessmentResult, type WorkflowSnapshot } from "@/lib/learningWorkflowContracts";
import { computeInputHash, planPath } from "@/lib/plan";
import { getArchivedMessage, getConversation, saveConversationAssessment } from "@/lib/conversationStore";

export class AssessmentError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function resultFor(context: LearningContext, snapshot: WorkflowSnapshot, questionId: string, selectedIndex: number, duplicate: boolean): AssessmentResult {
  const q = context.course.questions.find(q => q.id === questionId)!;
  const attempt = context.progress.attempts.find(a => a.attemptId === `${snapshot.runId}:${q.id}`)!;
  const mastery = context.progress.mastery.find(m => m.kcId === q.kcId)!;
  const input = { graph: context.course.graph, mastery: context.progress.mastery, budgetMinutes: snapshot.budgetMinutes, targets: snapshot.planTargets,timeEstimates:snapshot.timeEstimation?.estimates };
  const plan = planPath(input);
  return { runId: snapshot.runId, questionId: q.id, selectedIndex, correct: selectedIndex === q.answerIndex,
    answerIndex: q.answerIndex, explanation: q.explanation, counted: attempt.counted === true,
    evidenceN: mastery.evidenceN, evidenceStatus: evidenceStatus(mastery, context.course.questionPolicy?.get(q.id)?.source === "generated"), duplicate,
    workflow: { ...snapshot, status: "complete", stages: [
      ...snapshot.stages.filter(s => s.node !== "checkpoint"),
      { node: "exercise" as const, label: attempt.counted ? "已核对选项并记录学习证据" : "已核对选项，重复题不重复计证据", status: "complete" as const },
      { node: "planner" as const, label: "已按最新作答证据重新计算路径", status: "complete" as const },
    ].slice(-12),
    plan: { pathHash: plan.pathHash, inputHash: computeInputHash(input), totalMinutes: plan.totalMinutes,
      steps: plan.steps.map(step => ({ ...step, name: context.course.graph.concepts.find(c => c.id === step.kcId)!.name })),
      deferredCount: plan.deferred.length, blockedCount: plan.blocked.length } },
  };
}

export async function assessLearningExercise(db: Db, userId: string, raw: unknown): Promise<AssessmentResult> {
  const body = answerRequest.parse(raw);
  // Ownership comes from the authenticated user, never from the request body.
  const archived = body.conversationId && body.messageId ? await getArchivedMessage(db, userId, body.conversationId, body.messageId) : null;
  if (archived && body.conversationId) {
    const conversation = await getConversation(db, userId, body.conversationId);
    if (conversation.targetId !== body.targetId || archived.inheritedFrom || conversation.archived || conversation.deletedAt) throw new AssessmentError(409, "请在原会话中提交练习；已归档或删除的会话需要先恢复。");
    if (archived.proof?.assessment) {
      const result = archived.proof.assessment;
      if (result.runId !== body.runId || result.questionId !== body.questionId || result.selectedIndex !== body.selectedIndex) throw new AssessmentError(409, "本次练习已提交，不能修改选项。");
      return { ...result, duplicate: true };
    }
  }
  const snapshot = archived ? archived.proof?.workflow : (await readLearningSession(db, userId, body.targetId)).session?.snapshot;
  const persist = async (result: AssessmentResult) => {
    if (!archived || !body.conversationId || !body.messageId) return result;
    const normalized = assessmentResult.parse(result);
    const saved = await saveConversationAssessment(db, userId, body.conversationId, body.messageId, { workflow: normalized.workflow, assessment: normalized });
    if (saved) return normalized;
    const existing = (await getArchivedMessage(db, userId, body.conversationId, body.messageId)).proof?.assessment;
    if (existing && existing.selectedIndex === body.selectedIndex) return { ...existing, duplicate: true };
    throw new AssessmentError(409, "练习结果已在另一设备更新，请重新载入。");
  };
  const exercise = snapshot?.exercise;
  if (!snapshot || snapshot.runId !== body.runId || !snapshot.persisted || !exercise || exercise.questionId !== body.questionId || snapshot.status !== "awaiting_answer") {
    throw new AssessmentError(409, "练习检查点已过期，请重新发起练习任务");
  }
  for (let retry = 0; retry < 3; retry++) {
    const context = await loadLearningContext(db, userId, body.targetId);
    const q = context.course.questions.find(q => q.id === body.questionId && q.kcId === exercise.kcId);
    if (!q || q.stem !== exercise.stem || JSON.stringify(q.options) !== JSON.stringify(exercise.options) ||
      context.course.kind !== "subject" && !context.course.questionPolicy?.get(q.id)?.accepted) {
      throw new AssessmentError(409, "题目或审核状态已变化，请重新选题");
    }
    if (body.selectedIndex >= q.options.length) throw new AssessmentError(400, "选项不存在");
    const attemptId = `${body.runId}:${q.id}`;
    const existing = context.progress.attempts.find(a => a.attemptId === attemptId);
    if (existing) {
      if (existing.retired) throw new AssessmentError(409, "本次练习证据已归档，请重新发起练习");
      if (existing.selectedIndex !== body.selectedIndex) throw new AssessmentError(409, "本次练习已提交，不能修改选项");
      return persist(resultFor(context, snapshot, q.id, body.selectedIndex, true));
    }
    const now = new Date(Math.max(Date.now(), (Date.parse(context.revision ?? "") || 0) + 1)).toISOString();
    const progress = recomputeProgress({ ...context.progress, attempts: [...context.progress.attempts, {
      attemptId, questionId: q.id, kcId: q.kcId, selectedIndex: body.selectedIndex,
      difficulty: q.difficulty, correct: body.selectedIndex === q.answerIndex, at: now,
    }] }, context.course);
    const changed = await db.run(
      `INSERT INTO progress (user_id, subject_id, data, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, subject_id) DO UPDATE SET data = $3, updated_at = $4
       WHERE progress.updated_at = $5 AND $5 IS NOT NULL`,
      [userId, body.targetId, JSON.stringify(progress), now, context.revision],
    );
    if (changed === 1) return persist(resultFor({ ...context, progress, revision: now }, snapshot, q.id, body.selectedIndex, false));
  }
  throw new AssessmentError(409, "学习进度正在其他设备更新，请稍后重新提交");
}

/** Recover a pending or already answered exercise on reload, using verified attempts as truth. */
export async function restoreLearningTask(db: Db, userId: string, targetId: string) {
  const context = await loadLearningContext(db, userId, targetId);
  const stored = await readLearningSession(db, userId, targetId);
  const snapshot = stored.session?.snapshot ?? null;
  if (!snapshot) return { workflow: null, assessment: null };
  const attempt = context.progress.attempts.find(a => a.attemptId === `${snapshot.runId}:${snapshot.exercise?.questionId}`);
  const exercise = snapshot.exercise;
  if (exercise) {
    const q = context.course.questions.find(q => q.id === exercise.questionId && q.kcId === exercise.kcId);
    if (!q || q.stem !== exercise.stem || JSON.stringify(q.options) !== JSON.stringify(exercise.options) || attempt?.retired ||
      context.course.kind !== "subject" && !context.course.questionPolicy?.get(exercise.questionId)?.accepted) {
      return { workflow: { ...snapshot, status: "failed" as const, persisted: false,
        stages: [...snapshot.stages.slice(0, 11), { node: "exercise" as const, label: "题目或学习证据已变化，请重新发起练习", status: "failed" as const }] }, assessment: null };
    }
  }
  if (snapshot.exercise && attempt?.selectedIndex !== undefined && context.course.questions.some(q => q.id === snapshot.exercise!.questionId)) {
    const assessment = resultFor(context, snapshot, snapshot.exercise.questionId, attempt.selectedIndex, true);
    return { workflow: assessment.workflow, assessment };
  }
  return { workflow: snapshot, assessment: null };
}
