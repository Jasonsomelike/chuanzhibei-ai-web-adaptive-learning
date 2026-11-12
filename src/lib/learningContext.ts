import { ruleTimeEstimates, type LearningTimeResult } from "./learningTime";
/** 登录学习上下文：身份、课程及判分依据均从服务端解析，模型不能提供掌握度。 */
import { SUBJECTS, DEFAULT_SUBJECT_ID, type Subject } from "@/data/subjects";
import type { Question } from "@/data/questions";
import type { Db } from "@/lib/db";
import { validateGraph, type KnowledgeGraph } from "@/lib/graph";
import { createSubjectProgress, sanitizeProgress, type SubjectProgress } from "@/lib/learner";
import { updateMasteryScaled, hasEnoughEvidence, masteryMean, masterySd, type MasteryState } from "@/lib/mastery";
import { computeInputHash, planPath } from "@/lib/plan";
import { buildIndex, search } from "@/lib/rag";
import { callReadOnlyToolText, TOOLS } from "@/lib/tools";
import type { AgentToolSpec } from "@/lib/agent";
import { prerequisiteClosure } from "@/lib/graph";
import { buildUploadIndex, retrieveUploads, type UploadHit } from "@/lib/knowledge";
import { rowToChunk, type KbChunkRow } from "@/lib/kbServer";
import { getMaterialPack } from "@/data/materials";
import { buildMaterialContext, defaultSelectionFor } from "@/lib/materials";

export class LearningContextError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface LearningCourse extends Subject {
  readonly kind: "subject" | "direction";
  readonly questionPolicy?: ReadonlyMap<string, { readonly accepted: boolean; readonly source: string }>;
}

export async function loadLearningCourse(db: Db, userId: string, id = DEFAULT_SUBJECT_ID): Promise<LearningCourse> {
  const builtin = SUBJECTS.find((subject) => subject.id === id);
  if (builtin) return { ...builtin, kind: "subject" };
  const row = await db.one<{ user_id: string; is_public: boolean; title: string; description: string; graph_json: string }>(
    "SELECT * FROM directions WHERE id = $1", [id],
  );
  if (!row) throw new LearningContextError(404, "学习方向不存在");
  if (!row.is_public && row.user_id !== userId) throw new LearningContextError(403, "无权访问这个学习方向");
  const graph = JSON.parse(row.graph_json) as KnowledgeGraph;
  if (validateGraph(graph).some((issue) => issue.kind !== "isolated")) throw new LearningContextError(422, "方向图谱不合法");
  const rows = await db.all<{ id: string; kc_id: string; difficulty: Question["difficulty"]; stem: string; options_json: string; answer_index: number; explanation: string; source: string; status: string }>(
    "SELECT * FROM direction_items WHERE direction_id = $1 ORDER BY created_at", [id],
  );
  return {
    id, kind: "direction", name: row.title, tagline: row.description, syllabus: "自定义方向", graph,
    questions: rows.map((item) => ({ id: item.id, kcId: item.kc_id, difficulty: item.difficulty, stem: item.stem,
      options: JSON.parse(item.options_json) as string[], answerIndex: item.answer_index, explanation: item.explanation })),
    questionPolicy: new Map(rows.map((item) => [item.id, { accepted: item.status === "accepted", source: item.source }])),
  };
}

export type EvidenceStatus = "unobserved" | "insufficient" | "needs_review" | "likely_mastered";
export function evidenceStatus(mastery: MasteryState, generated = false): EvidenceStatus {
  if (mastery.evidenceN === 0) return "unobserved";
  if (!hasEnoughEvidence(mastery, generated ? 4 : 3)) return "insufficient";
  return masteryMean(mastery) >= 0.6 ? "likely_mastered" : "needs_review";
}

/** 重放题库中可核对的选项，忽略客户端的 alpha/beta、对错、难度和权重。 */
export function recomputeProgress(raw: unknown, course: LearningCourse): SubjectProgress {
  const clean = sanitizeProgress(raw);
  const prior = createSubjectProgress(course.id, course.graph);
  if (!clean) return prior;
  const questions = new Map(course.questions.map((question) => [question.id, question]));
  const mastery = new Map(prior.mastery.map((m) => [m.kcId, m]));
  const countedIds = new Set<string>();
  const attempts = clean.attempts.map((attempt) => {
    const question = questions.get(attempt.questionId);
    const selected = attempt.selectedIndex;
    const valid = question && question.kcId === attempt.kcId && selected !== undefined &&
      selected >= 0 && selected < question.options.length;
    if (!valid || !question) return { ...attempt, retired: true, counted: false, weightScale: 0 };
    const policy = course.questionPolicy?.get(question.id);
    const weight = course.kind === "subject" ? 1 : policy?.accepted ? (policy.source === "generated" ? 0.8 : 1) : 0;
    const correct = selected === question.answerIndex;
    const counted = !attempt.retired && weight > 0 && !countedIds.has(question.id);
    if (counted) {
      countedIds.add(question.id);
      const m = mastery.get(question.kcId);
      if (m) mastery.set(m.kcId, updateMasteryScaled(m, correct, question.difficulty, weight));
    }
    return { ...attempt, correct, difficulty: question.difficulty, counted, weightScale: weight,
      source: course.kind === "subject" ? "builtin" as const : policy?.source === "generated" ? "generated" as const : policy?.source === "borrowed" ? "borrowed" as const : "manual" as const };
  });
  return { ...clean, mastery: [...mastery.values()], attempts };
}

export interface LearningContext {
  readonly timeEstimation?:LearningTimeResult;
  readonly uploadNotice?:string;
  readonly course: LearningCourse;
  readonly progress: SubjectProgress;
  readonly revision: string | null;
  readonly uploads: readonly { readonly kcId: string; readonly title: string; readonly text: string; readonly docId: string; readonly pageFrom?: number }[];
  readonly uploadHits: readonly UploadHit[];
  readonly uploadScanLimited: boolean;
  readonly materialSourceIds?: readonly string[];
}

export async function loadLearningContext(db: Db, userId: string, targetId?: string, question = "", materialSourceIds?: readonly string[]): Promise<LearningContext> {
  const course = await loadLearningCourse(db, userId, targetId);
  const [row, chunks] = await Promise.all([
    db.one<{ data: string; updated_at: string }>("SELECT * FROM progress WHERE user_id = $1 AND subject_id = $2", [userId, course.id]),
    db.all<KbChunkRow>(
      "SELECT * FROM kb_chunks WHERE user_id = $1 AND direction_id = $2 ORDER BY doc_id, idx LIMIT 2001", [userId, course.id]),
  ]);
  let raw: unknown = null;
  try { raw = row ? JSON.parse(row.data) : null; } catch { /* 损坏的旧快照使用先验 */ }
  const uploadChunks = chunks.slice(0, 2000).map(rowToChunk);
  const uploadHits = question ? retrieveUploads(buildUploadIndex(uploadChunks), uploadChunks, question, 3) : [];
  return { course, progress: recomputeProgress(raw, course), revision: row?.updated_at ?? null,
    uploadHits,
    uploadScanLimited: chunks.length > 2000,
    materialSourceIds,
    uploads: uploadHits.map(({ chunk }, index) => ({ kcId: `资料${index + 1}`, docId: chunk.docId,
      title: chunk.title, text: chunk.text, ...(chunk.pageFrom ? { pageFrom: chunk.pageFrom } : {}) })) };
}

/** 工具参数不再暴露 mastery，学科固定为页面当前目标。公开 MCP 的模拟接口保持独立。 */
export function learningAgentTools(): AgentToolSpec[] {
  const tools:AgentToolSpec[]=TOOLS.map((tool) => {
    const properties = { ...(tool.inputSchema.properties as Record<string, unknown> ?? {}) };
    delete properties.mastery;
    delete properties.subject;
    return { name: tool.name, description: `${tool.description} 使用当前账号、当前课程的服务端学习证据，不接受自报掌握度。`,
      parameters: { ...tool.inputSchema, properties, additionalProperties: false }, serverId: null };
  });
  tools.push({name:"estimate_learning_time",description:"读取本轮经校验的知识点时长估算、依据和区间。估算已由前置 Agent 完成；此工具只读，不接受模型改写时长。可指定 kcIds 查路径中某几步的依据。",parameters:{type:"object",properties:{kcIds:{type:"array",items:{type:"string"},maxItems:20}},additionalProperties:false},serverId:null});
  return tools;
}

export function callLearningTool(context: LearningContext, name: string, args: Record<string, unknown>, budgetMinutes = 90): string {
  const { course, progress } = context;
  if (args.mastery !== undefined) throw new Error("掌握度由服务端作答证据计算，不能由模型提供");
  if (args.subject !== undefined && args.subject !== course.id) throw new Error("工具仅能读取当前学习目标");
  const provenance = { targetId: course.id, targetName: course.name, source: "server-validated-attempts", revision: context.revision,
    inputHash: computeInputHash({ graph: course.graph, mastery: progress.mastery, budgetMinutes,timeEstimates:context.timeEstimation?.estimates }) };
  if (name === "list_subjects") return callReadOnlyToolText(name, {});
  if(name==="estimate_learning_time") {
    const ids=args.kcIds;
    if(ids!==undefined&&(!Array.isArray(ids)||ids.length>20||ids.some(id=>typeof id!=="string"||!course.graph.concepts.some(c=>c.id===id))))throw new Error("时长查询只能指定本课程知识点。");
    const all=context.timeEstimation?.estimates??ruleTimeEstimates(course.graph,progress.mastery);
    const estimates=Array.isArray(ids)?all.filter(e=>ids.includes(e.kcId)):all.slice(0,8);
    return JSON.stringify({...provenance,source:context.timeEstimation?.source??"rules",model:context.timeEstimation?.model,fingerprint:context.timeEstimation?.fingerprint,estimates,notice:estimates.length<all.length?"按 kcIds 读取其他步骤的估算依据。":undefined});
  }
  if (name === "get_learner_state") return JSON.stringify({ ...provenance,
    observedCount: progress.mastery.filter((m) => m.evidenceN > 0).length,
    unobservedCount: progress.mastery.filter((m) => m.evidenceN === 0).length,
    concepts: [...progress.mastery].sort((a, b) => b.evidenceN - a.evidenceN).map((m) => ({
    kcId: m.kcId, name: course.graph.concepts.find((c) => c.id === m.kcId)?.name, evidenceN: m.evidenceN,
    status: evidenceStatus(m, progress.attempts.some((a) => !a.retired && a.kcId === m.kcId && a.source === "generated")), mean: m.evidenceN > 0 ? masteryMean(m) : null,
    sd: m.evidenceN > 0 ? masterySd(m) : null,
  })) });
  if (name === "plan_path") {
    const requested = args.budgetMinutes ?? budgetMinutes;
    if (typeof requested !== "number" || !Number.isFinite(requested) || requested < 5 || requested > 480) throw new Error("学习预算必须是 5–480 分钟");
    const targets = Array.isArray(args.targets) ? args.targets.filter((id): id is string => typeof id === "string") : undefined;
    if (targets?.some((id) => !course.graph.concepts.some((c) => c.id === id))) throw new Error("目标知识点不属于当前课程");
    const input = { graph: course.graph, mastery: progress.mastery, budgetMinutes: requested, targets,timeEstimates:context.timeEstimation?.estimates };
    return JSON.stringify({ ...provenance, inputHash: computeInputHash(input), ...planPath(input),
      evidenceNote: "未观测的知识点按基础顺序探索，不代表学生薄弱。" });
  }
  if (name === "get_prerequisites") {
    if (typeof args.kcId !== "string" || !course.graph.concepts.some((c) => c.id === args.kcId)) throw new Error("知识点不属于当前课程");
    return JSON.stringify({ ...provenance, prerequisites: [...prerequisiteClosure(course.graph, args.kcId)] });
  }
  if (name === "search_knowledge") {
    if (typeof args.query !== "string" || !args.query.trim()) throw new Error("检索问题不能为空");
    const docs = course.graph.concepts.map((c) => ({ kcId: c.id, title: c.name, text: `${c.chapter}。${c.summary}。` +
      course.questions.filter((q) => q.kcId === c.id).map((q) => `${q.stem} ${q.explanation}`).join(" ") }));
    const hits = search(buildIndex(docs), args.query, 3);
    const pack = getMaterialPack(course.id);
    const selection = context.materialSourceIds === undefined ? defaultSelectionFor(pack) : {
      sourceIds: context.materialSourceIds.filter((id) => pack.sources.some((source) => source.id === id)), resolutions: {},
    };
    const material = buildMaterialContext(pack, course.graph.concepts.filter((c) => hits.some((hit) => hit.kcId === c.id)), selection);
    // 优先保留原文；即使工具结果被截断，也不会只剩知识摘要而丢掉教材依据。
    return JSON.stringify({ ...provenance, material: material.text, materialSources: material.citations.map((citation) => citation.label), uploads: context.uploads, uploadNotice:context.uploadNotice, hits });
  }
  throw new Error(`未知工具：${name}`);
}
