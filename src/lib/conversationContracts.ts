/** Archive content is user-owned text. Learning proofs are a separate server-only field. */
import { z } from "zod";
import { assessmentResult, workflowSnapshot } from "./learningWorkflowContracts";
import { base64BytesOfDataUrl, IMAGE_MAX_BYTES, IMAGE_MAX_COUNT, IMAGE_MAX_EDGE } from "./image";

export const ARCHIVE_BODY_BYTES = 2400 * 1024;
export const ARCHIVE_MESSAGE_BYTES = 2200 * 1024;
export const ARCHIVE_PAGE_BYTES = 2400 * 1024;
const short = z.string().max(1000);
const text = z.string().max(200_000);
const invalidUnicode = /[\u0000\uD800-\uDFFF]/u;
export const archiveLabel = z.string().refine(value => !invalidUnicode.test(value), "文字包含不受支持的字符");
function validStrings(content: unknown): boolean {
  const queue: unknown[] = [content];
  while (queue.length) {
    const value = queue.pop();
    if (typeof value === "string" && invalidUnicode.test(value)) return false;
    if (Array.isArray(value)) queue.push(...value);
    else if (value && typeof value === "object") queue.push(...Object.values(value));
  }
  return true;
}
const nullableText = text.nullable();
export const archiveId = z.string().uuid();
export const archiveImage = z.object({
  id: z.string().min(1).max(100), name: z.string().max(250),
  dataUrl: z.string().max(560_000).regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/u)
    .refine(value => base64BytesOfDataUrl(value) <= IMAGE_MAX_BYTES, "图片超过存档上限"),
  bytes: z.number().int().min(1).max(IMAGE_MAX_BYTES),
  width: z.number().int().min(1).max(IMAGE_MAX_EDGE), height: z.number().int().min(1).max(IMAGE_MAX_EDGE),
  quality: z.number().min(0).max(1),
});
const uploadHit = z.object({ score: z.number().finite(), chunk: z.object({
  id: short, docId: short, directionId: short, title: short, section: short,
  text, index: z.number().int().min(0), pageFrom: z.number().int().positive().optional(), pageTo: z.number().int().positive().optional(),
}) });
const webHit = z.object({
  title: short, url: z.string().max(4000).regex(/^https?:\/\//u), snippet: text,
  provider: z.enum(["tavily", "wikipedia", "deepseek"]), revision: short.optional(), ref: z.number().int().positive(), label: short,
});
const toolTrace = z.object({ id: short, name: short, serverId: short.nullable(), argsPreview: text,
  ok: z.boolean().nullable(), truncated: z.boolean(), durationMs: z.number().nonnegative().nullable(), preview: nullableText });
const agentNotice = z.object({ level: z.enum(["info", "warn"]), message: text });
const agentDone = z.strictObject({
  stopReason: z.enum(["stop", "max_steps", "loop_detected", "budget", "aborted", "error"]),
  steps: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative(),
  uploads: z.array(uploadHit).max(100).optional(), materialContext: text.optional(), materialSources: z.array(short).max(100).optional(),
});
export const archiveContent = z.strictObject({
  text: text.default(""), reasoning: text.default(""),
  citations: z.array(z.object({ kcId: short, title: short })).max(200).default([]),
  claims: z.array(z.object({ id: short, kcId: short, text })).max(200).default([]),
  generatedByLlm: z.boolean().default(false), note: text.optional(), sources: z.array(short).max(200).default([]),
  materialContext: text.optional(), originals: z.array(z.object({ kcId: short, label: short, text })).max(200).optional(),
  conflicts: z.array(text).max(100).default([]), streaming: z.boolean().default(false),
  thinkingRequested: z.boolean().default(false), thinkingDowngraded: z.boolean().default(false),
  webHits: z.array(webHit).max(100).default([]), webUsed: z.array(z.number().int()).max(100).default([]),
  webError: nullableText.default(null), webNotice: nullableText.default(null), webFromCache: z.boolean().default(false),
  uploadHits: z.array(uploadHit).max(100).default([]), uploadUsed: z.array(z.number().int()).max(100).default([]),
  verdicts: z.array(z.object({ id: short, verdict: z.enum(["supported", "not_found", "contradicted", "unable"]), quote: text, reason: nullableText })).max(200).nullable().default(null),
  verificationError: nullableText.default(null), verificationSkipped: nullableText.default(null), checking: z.boolean().default(false),
  finishReason: short.nullable().default(null), images: z.number().int().min(0).max(IMAGE_MAX_COUNT).default(0),
  attachments: z.array(archiveImage).max(IMAGE_MAX_COUNT).default([]),
  agentTools: z.array(toolTrace).max(200).default([]), agentNotices: z.array(agentNotice).max(100).default([]), agentDone: agentDone.nullable().default(null),
}).superRefine((content, context) => {
  if (!validStrings(content)) context.addIssue({ code: "custom", message: "文字包含不受支持的字符" });
});
export type ArchiveContent = z.infer<typeof archiveContent>;
export const archivedProof = z.object({ workflow: workflowSnapshot, assessment: assessmentResult.nullable().default(null) }).superRefine((proof, context) => {
  if (!validStrings(proof)) context.addIssue({ code: "custom", message: "教学记录包含不受支持的字符" });
  if (proof.assessment && (proof.assessment.runId !== proof.workflow.runId || proof.assessment.workflow.runId !== proof.workflow.runId || proof.assessment.workflow.targetId !== proof.workflow.targetId || proof.assessment.questionId !== proof.workflow.exercise?.questionId)) context.addIssue({ code: "custom", message: "作答结果与教学轮次不一致" });
});
export type ArchivedProof = z.infer<typeof archivedProof>;
export const archivedMessage = z.object({
  id: archiveId, conversationId: archiveId, seq: z.number().int().positive(), role: z.enum(["user", "assistant"]),
  createdAt: z.string(), revision: z.number().int().nonnegative(), state: z.enum(["pending", "complete", "interrupted"]),
  inheritedFrom: archiveId.nullable(), content: archiveContent, proof: archivedProof.nullable(),
});
export type ArchivedMessage = z.infer<typeof archivedMessage>;
export const conversationSummary = z.object({
  id: archiveId, targetId: z.string(), targetName: z.string(), title: z.string(),
  pinned: z.boolean(), archived: z.boolean(), deletedAt: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(), revision: z.number().int().nonnegative(), lastSeq: z.number().int().nonnegative(),
  parentId: archiveId.nullable(), parentMessageId: archiveId.nullable(),
});
export type ConversationSummary = z.infer<typeof conversationSummary>;
export const conversationMutation = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), targetId: archiveLabel.min(1).max(100), title: archiveLabel.trim().min(1).max(100).optional() }),
  z.strictObject({ action: z.literal("update"), id: archiveId, revision: z.number().int().nonnegative(), title: archiveLabel.trim().min(1).max(100).optional(), pinned: z.boolean().optional(), archived: z.boolean().optional(), trash: z.boolean().optional() }),
  z.strictObject({ action: z.literal("branch"), id: archiveId, messageId: archiveId, title: archiveLabel.trim().min(1).max(100).optional() }),
]);
export const turnRequest = z.strictObject({
  conversationId: archiveId, revision: z.number().int().nonnegative(),
  user: z.strictObject({ id: archiveId, content: archiveContent }), assistantId: archiveId,
});
export const messageUpdate = z.strictObject({
  conversationId: archiveId, id: archiveId, revision: z.number().int().nonnegative(),
  content: archiveContent, state: z.enum(["pending", "complete", "interrupted"]),
});
