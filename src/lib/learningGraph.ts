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

/** Keep the prerequisite chain and nearby branches; the selected concept anchors exploration. */
export function relatedLearningNodes(graph: KnowledgeGraph, steps: readonly PathStep[], focusedId?: string): Set<string> {
  const index = indexGraph(graph);
  const related = new Set(steps.map(step => step.kcId));
  if (focusedId && index.byId.has(focusedId)) related.add(focusedId);
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const prerequisite of index.predecessors.get(id) ?? []) {
      related.add(prerequisite); visit(prerequisite);
    }
  };
  for (const step of steps) visit(step.kcId);
  if (focusedId && index.byId.has(focusedId)) visit(focusedId);
  const depths = computeDepths(graph);
  const upcoming = new Set<string>();
  if (focusedId) {
    const byDepth = (a: string, b: string) => (depths.get(a) ?? 0) - (depths.get(b) ?? 0) || a.localeCompare(b);
    // Balance two immediate applications with two nearby alternatives. Cross-course
    // uses (e.g. stacks in DFS) remain available in the full graph and search.
    [...(index.successors.get(focusedId) ?? [])].filter(id => !related.has(id)).sort(byDepth).slice(0, 2).forEach(id => upcoming.add(id));
    const siblings = new Set<string>();
    for (const predecessor of index.predecessors.get(focusedId) ?? []) for (const sibling of index.successors.get(predecessor) ?? []) if (!related.has(sibling)) siblings.add(sibling);
    const chapter = index.byId.get(focusedId)?.chapter;
    [...siblings].sort((a,b) => Number(index.byId.get(b)?.chapter === chapter) - Number(index.byId.get(a)?.chapter === chapter) || byDepth(a,b)).slice(0, 2).forEach(id => upcoming.add(id));
  }
  const nearby = [...upcoming].sort((a, b) => (depths.get(a) ?? 0) - (depths.get(b) ?? 0) || a.localeCompare(b));
  for (const step of steps) for (const successor of index.successors.get(step.kcId) ?? []) if (!related.has(successor)) upcoming.add(successor);
  const limit = focusedId ? 4 : steps.length > 4 ? 0 : 2;
  const ordered = [...nearby, ...[...upcoming].filter(id => !nearby.includes(id)).sort((a, b) => (depths.get(a) ?? 0) - (depths.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0))];
  ordered.slice(0, limit).forEach(id => related.add(id));
  return related;
}

/** Compact only visible rows; hidden siblings must never create large empty bands. */
export function layoutLearningNodes(nodes: readonly LearningGraphNode[], direction: "horizontal" | "vertical" | "compact" = "horizontal"): LearningGraphNode[] {
  const columns = new Map<number, LearningGraphNode[]>();
  for (const node of nodes) { const list = columns.get(node.position.x) ?? []; list.push(node); columns.set(node.position.x, list); }
  const layers = [...columns.entries()].sort(([a], [b]) => a - b);
  const bands = new Map<number, LearningGraphNode[]>();
  for (const [depth, [, list]] of layers.entries()) {
    let band = depth;
    if (direction === "compact") band = Math.min(depth, 2);
    else if (direction === "horizontal" && layers.length > 4) band = Math.floor((depth * 2 + 1) / 3);
    bands.set(band, [...(bands.get(band) ?? []), ...list]);
  }
  const maxRows = Math.max(1, ...[...bands.values()].map(list => list.length));
  return [...bands.entries()].flatMap(([depth, list]) => list.map((node, row) => {
    const offset = maxRows - list.length;
    let position = { x: depth * 230, y: row * 160 + offset * 80 };
    if (direction === "vertical") position = { x: row * 240 + offset * 120, y: depth * 112 };
    else if (direction === "compact") position = { x: depth * 132, y: row * 112 + offset * 56 };
    return { ...node, position };
  }));
}
