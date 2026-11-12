import { timeEstimate } from "./learningTime";
/** Browser-safe contracts for the learning supervisor. No answers or model credentials. */
import { z } from "zod";

export const teachingIntent = z.enum(["explain", "hint", "practice", "review_path", "analyze_error"]);
export type TeachingIntent = z.infer<typeof teachingIntent>;
export const INTENT_LABELS: Record<TeachingIntent, string> = {
  explain: "知识讲解", hint: "分级提示", practice: "独立练习", review_path: "学情与路径", analyze_error: "错因分析",
};
export const workflowSnapshot = z.object({
  version: z.literal("learning-workflow-v1"),
  runId: z.string().uuid(),
  targetId: z.string().min(1),
  intent: teachingIntent,
  routeReason: z.string().max(200),
  focusKcId: z.string().nullable(),
  focusName: z.string().nullable(),
  budgetMinutes: z.number().int().min(5).max(480),
  planTargets: z.array(z.string()).max(200).optional(),
  resumedTurns: z.number().int().min(0).max(4),
  status: z.enum(["running", "awaiting_answer", "complete", "failed"]),
  persisted: z.boolean(),
  stages: z.array(z.object({
    node: z.enum(["supervisor", "context", "planner", "retriever", "tutor", "exercise", "verifier", "checkpoint", "estimator", "time_validator"]),
    label: z.string().max(120), status: z.enum(["running", "complete", "failed"]),
  })).max(12),
  timeEstimation:z.object({source:z.enum(["llm","rules"]),fingerprint:z.string(),model:z.string().optional(),notice:z.string().optional(),estimates:z.array(timeEstimate).max(500)}).optional(),
  plan: z.object({
    pathHash: z.string(), inputHash: z.string(), totalMinutes: z.number(),
    steps: z.array(z.object({ kcId: z.string(), name: z.string(), kind: z.enum(["learn", "review"]), estMinutes: z.number(), reason: z.string() })).max(200),
    deferredCount: z.number(), blockedCount: z.number(),
  }).optional(),
  exercise: z.object({ questionId: z.string(), kcId: z.string(), stem: z.string(), options: z.array(z.string()).min(2).max(20), repeated: z.boolean() }).optional(),
  verification: z.object({ status: z.enum(["passed", "guarded"]), checks: z.array(z.string()).max(10), issues: z.array(z.string()).max(10) }).optional(),
});
export type WorkflowSnapshot = z.infer<typeof workflowSnapshot>;

export const answerRequest = z.strictObject({
  targetId: z.string().min(1).max(100), runId: z.string().uuid(),
  questionId: z.string().min(1).max(100), selectedIndex: z.number().int().min(0).max(19),
  conversationId: z.string().uuid().optional(), messageId: z.string().uuid().optional(),
}).refine(body => Boolean(body.conversationId) === Boolean(body.messageId), "会话与回答标识必须同时提供");

export const assessmentResult = z.object({
  runId: z.string().uuid(), questionId: z.string(), selectedIndex: z.number().int(),
  correct: z.boolean(), answerIndex: z.number().int(), explanation: z.string(),
  counted: z.boolean(), evidenceN: z.number(), evidenceStatus: z.string(),
  duplicate: z.boolean(), workflow: workflowSnapshot,
});
export type AssessmentResult = z.infer<typeof assessmentResult>;
