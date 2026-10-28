/**
 * 反事实对比：把「对照预算」的规划结果整理成页面直接可用的汇总。
 *
 * 只做汇总，不重新规划。输入就是 planPath 的返回值，
 * 保证页面上的推迟/阻塞数字与可复现性面板引用的是同一份结果。
 */

import type { PlanResult } from "./plan";

/** 一次反事实对比的汇总。 */
export interface CounterfactualSummary {
  /** 对照预算下因时间不足、自己装不进预算的点，保持 planPath 的输出顺序。 */
  readonly deferred: readonly string[];
  /** 对照预算下因先修被推迟或阻塞而排不进来的点，保持 planPath 的输出顺序。 */
  readonly blocked: readonly string[];
  /** blocked 中不在当前路径上的点，顺序与 blocked 一致。 */
  readonly blockedNotInPath: readonly string[];
  /** 该点在对照预算下被哪些先修点阻塞；没有被阻塞时返回空数组。 */
  readonly blockedByOf: (kcId: string) => readonly string[];
}

const EMPTY: readonly string[] = [];

/**
 * 汇总对照预算的结果。
 *
 * currentSteps 传当前页面正在显示的步骤（含手动改写）：
 * 同一个点可能「当前路径里有、对照预算下被阻塞」，这种点要标在步骤卡上，
 * 但不能列进「不在当前路径」的清单——两份信息回答的是不同问题。
 */
export function summarizeCounterfactual(
  counterfactual: PlanResult | null,
  currentSteps: readonly { readonly kcId: string }[],
): CounterfactualSummary {
  if (!counterfactual) {
    return { deferred: EMPTY, blocked: EMPTY, blockedNotInPath: EMPTY, blockedByOf: () => EMPTY };
  }

  const byId = new Map(counterfactual.blocked.map((b) => [b.kcId, b.by]));
  const blocked = counterfactual.blocked.map((b) => b.kcId);
  const inPath = new Set(currentSteps.map((s) => s.kcId));

  return {
    deferred: counterfactual.deferred,
    blocked,
    blockedNotInPath: blocked.filter((kcId) => !inPath.has(kcId)),
    blockedByOf: (kcId) => byId.get(kcId) ?? EMPTY,
  };
}
