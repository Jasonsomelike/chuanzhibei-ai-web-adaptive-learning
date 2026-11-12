import type { TimeEstimate } from "./learningTime";
import { computeDepths, type KnowledgeGraph } from "@/lib/graph";
import { initialMastery, updateMasteryScaled } from "@/lib/mastery";
import { planPath } from "@/lib/plan";
import type { SubjectProgress } from "@/lib/learner";

/** 从保留的证据重建最近一次作答前后版本，无需额外复制路径快照。 */
export function learningReport(graph: KnowledgeGraph, progress: SubjectProgress, budgetMinutes: number,timeEstimates?:readonly TimeEstimate[]) {
  const active = progress.attempts.filter((a) => !a.retired && a.counted !== false && (a.weightScale ?? 1) > 0);
  const last = active.at(-1);
  if (!last) return null;
  const depths = computeDepths(graph);
  const states = new Map(graph.concepts.map((c) => [c.id, initialMastery(c.id, depths.get(c.id) ?? 0)]));
  for (const attempt of active.slice(0, -1)) {
    const m = states.get(attempt.kcId);
    if (m) states.set(m.kcId, updateMasteryScaled(m, attempt.correct, attempt.difficulty, attempt.weightScale ?? 1));
  }
  const before = planPath({ graph, mastery: [...states.values()], budgetMinutes,timeEstimates });
  const after = planPath({ graph, mastery: progress.mastery, budgetMinutes,timeEstimates });
  const beforeIds = new Set(before.steps.map((step) => step.kcId));
  const afterIds = new Set(after.steps.map((step) => step.kcId));
  return { last, before, after,
    added: after.steps.filter((step) => !beforeIds.has(step.kcId)).map((step) => step.kcId),
    removed: before.steps.filter((step) => !afterIds.has(step.kcId)).map((step) => step.kcId),
    archived: progress.attempts.filter((attempt) => attempt.retired).length,
  };
}
