import { computeDepths, indexGraph, type KnowledgeGraph } from "@/lib/graph";
import { masteryMean, masterySd, type MasteryState } from "@/lib/mastery";
import { masteredSet, type PathStep, type PlanResult } from "@/lib/plan";

export type LearningNodeStatus = "planned" | "mastered" | "deferred" | "blocked" | "available" | "removed";
export const LEARNING_STATUS_LABELS: Record<LearningNodeStatus, string> = {
  planned: "本次学习", mastered: "已达学习阈值", deferred: "预算暂缓", blocked: "先修阻塞", available: "范围外", removed: "手动移除",
};
export interface LearningGraphNode {
  id: string; name: string; chapter: string; summary: string;
  status: LearningNodeStatus; evidenceN: number; mean: number | null; sd: number | null;
  prerequisites: string[]; blockedBy: string[]; order: number | null; reason: string | null;
  position: { x: number; y: number };
}

/** Pure view model: never manufacture mastery or prerequisite edges for a visual effect. */
export function learningGraphNodes(graph: KnowledgeGraph, mastery: readonly MasteryState[], plan: PlanResult, steps: readonly PathStep[]): LearningGraphNode[] {
  const index = indexGraph(graph);
  const depths = computeDepths(graph);
  const states = new Map(mastery.map(state => [state.kcId, state]));
  const mastered = masteredSet(mastery.filter(state => state.evidenceN > 0));
  const scheduled = new Map(steps.map((step, order) => [step.kcId, { step, order }]));
  const originalSteps = new Set(plan.steps.map(step => step.kcId));
  const deferred = new Set(plan.deferred);
  const blocked = new Map(plan.blocked.map(item => [item.kcId, item.by]));
  const rowByDepth = new Map<number, number>();
  return [...graph.concepts].sort((a, b) => (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0) || a.id.localeCompare(b.id)).map(concept => {
    const state = states.get(concept.id);
    const evidenceN = state?.evidenceN ?? 0;
    const scheduledStep = scheduled.get(concept.id);
    const depth = depths.get(concept.id) ?? 0;
    const row = rowByDepth.get(depth) ?? 0;
    rowByDepth.set(depth, row + 1);
    return { ...concept,
      status: scheduledStep ? "planned" : mastered.has(concept.id) ? "mastered" : originalSteps.has(concept.id) ? "removed" : blocked.has(concept.id) ? "blocked" : deferred.has(concept.id) ? "deferred" : "available",
      evidenceN, mean: state && evidenceN > 0 ? masteryMean(state) : null, sd: state && evidenceN > 0 ? masterySd(state) : null,
      prerequisites: [...(index.predecessors.get(concept.id) ?? [])], blockedBy: [...(blocked.get(concept.id) ?? [])],
      order: scheduledStep ? scheduledStep.order + 1 : null, reason: scheduledStep ? evidenceN === 0 ? "尚无作答证据，先按先修顺序探索；诊断后会根据结果调整。" : scheduledStep.step.reason : null,
      position: { x: depth * 250, y: row * 120 },
    };
  });
}

/** The complete prerequisite chain plus at most two upcoming nodes keeps the opening graph readable. */
export function relatedLearningNodes(graph: KnowledgeGraph, steps: readonly PathStep[]): Set<string> {
  const index = indexGraph(graph);
  const related = new Set(steps.map(step => step.kcId));
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const prerequisite of index.predecessors.get(id) ?? []) {
      related.add(prerequisite); visit(prerequisite);
    }
  };
  for (const step of steps) visit(step.kcId);
  const depths = computeDepths(graph);
  const upcoming = new Set<string>();
  for (const step of steps) for (const successor of index.successors.get(step.kcId) ?? []) if (!related.has(successor)) upcoming.add(successor);
  const limit = steps.length > 4 ? 0 : 2;
  [...upcoming].sort((a, b) => (depths.get(a) ?? 0) - (depths.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0)).slice(0, limit).forEach(id => related.add(id));
  return related;
}

/** Compact only visible rows; hidden siblings must never create large empty bands. */
export function layoutLearningNodes(nodes: readonly LearningGraphNode[]): LearningGraphNode[] {
  const columns = new Map<number, LearningGraphNode[]>();
  for (const node of nodes) { const list = columns.get(node.position.x) ?? []; list.push(node); columns.set(node.position.x, list); }
  const maxRows = Math.max(1, ...[...columns.values()].map(list => list.length));
  return [...columns.entries()].flatMap(([x, list]) => list.map((node, row) => ({ ...node, position: { x, y: row * 120 + (maxRows - list.length) * 60 } })));
}
