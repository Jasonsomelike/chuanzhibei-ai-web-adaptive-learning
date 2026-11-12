import { sha256Sync } from "./sha256";
export { sha256Sync } from "./sha256";
import { ruleTimeEstimates, type TimeEstimate } from "./learningTime";
/**
 * 路径规划：纯函数，不调用 LLM。
 *
 * 这是整个项目的核心承诺：同一个输入 + 同一版本 → 同一条路径，
 * 可以逐位复现（path_hash 哈希输出），LLM API 不可用时仍然出同一条路径。
 *
 * 因此本文件不允许出现：Date.now()、Math.random()、网络请求、任何 LLM 调用。
 * 所有输入都从参数进来，所有输出都从返回值出去。
 */

import {
  computeDepths,
  indexGraph,
  prerequisiteClosure,
  topologicalOrder,
  type KnowledgeGraph,
} from "./graph";
import { masteryMean, masterySd, type MasteryState } from "./mastery";

/** 算法版本号。改了排序规则必须改它，否则历史路径的 hash 会误导人。 */
export const ALGO_VERSION = "plan-v3";

/** 一个学习步骤。 */
export interface PathStep {
  readonly kcId: string;
  /** learn = 首次学习；review = 复习巩固。 */
  readonly kind: "learn" | "review";
  /** 预计用时（分钟）。 */
  readonly estMinutes: number;
  /** 排序依据，用于界面解释「为什么这一步排在这里」。 */
  readonly reason: string;
  /** 手动改写产生的步骤为 manual，其余为 algorithm。 */
  readonly source: "algorithm" | "manual";
}

/** 规划输入。全部显式传入，便于序列化与复现。 */
export interface PlanInput {
  readonly graph: KnowledgeGraph;
  readonly mastery: readonly MasteryState[];
  /** 本轮可投入的总时长（分钟）。 */
  readonly budgetMinutes: number;
  /** 目标知识点；为空则对全部未掌握知识点规划。 */
  readonly targets?: readonly string[];
  /** 认为「已掌握」的阈值。 */
  readonly masteryTarget?: number;
  readonly timeEstimates?: readonly TimeEstimate[];
}

/**
 * 一个被阻塞的知识点。
 *
 * `by` 列出导致它排不进来的先修点。语义只有一种：
 * 「先修点自己没装进预算（deferred）或先修点也被阻塞（blocked）」。
 * 先修点不在候选集里（未被要求学）不算阻塞——那是目标范围之外，不是排不下。
 */
export interface BlockedStep {
  readonly kcId: string;
  readonly by: readonly string[];
}

/** 规划结果。 */
export interface PlanResult {
  readonly steps: readonly PathStep[];
  /** 总用时。 */
  readonly totalMinutes: number;
  /** 自己装不进预算的知识点。 */
  readonly deferred: readonly string[];
  /** 因先修被推迟而无法排入的知识点。 */
  readonly blocked: readonly BlockedStep[];
  /** 输出指纹。只覆盖 steps + 版本号，不含题目与模型信息。 */
  readonly pathHash: string;
  readonly algoVersion: string;
  readonly kgVersion: string;
}

export const DEFAULT_MASTERY_TARGET = 0.6;


/**
 * 规划一条学习路径。
 *
 * 三步：
 *   1. 硬约束——先修闭包里的点如果还没掌握，必须排进来（不能跳级）
 *   2. 软排序——按「先修深度升序 + ZPD 距离升序」排，让下一步总是「跳一跳够得着」
 *   3. 装包——按排序贪心装入预算，装不下的进 deferred
 *
 * 为什么不用 0-1 背包做最优解：知识点之间有先修约束，不能只按价值密度挑；
 * 而且贪心+拓扑序的结果可解释（每一步都能说清为什么在这），
 * 对答辩和用户信任都比「最优但说不清」更有价值。
 */
export function planPath(input: PlanInput): PlanResult {
  const { graph, mastery, budgetMinutes } = input;
  const masteryTarget = input.masteryTarget ?? DEFAULT_MASTERY_TARGET;

  const costs = new Map((input.timeEstimates ?? ruleTimeEstimates(graph,mastery)).map(e=>[e.kcId,e]));
  const fallbackCosts = new Map(ruleTimeEstimates(graph,mastery).map(e=>[e.kcId,e]));
  const idx = indexGraph(graph);
  const depths = computeDepths(graph);

  const stateById = new Map<string, MasteryState>();
  for (const m of mastery) stateById.set(m.kcId, m);

  const meanOf = (id: string): number => {
    const s = stateById.get(id);
    return s ? masteryMean(s) : 0;
  };
  const sdOf = (id: string): number => {
    const s = stateById.get(id);
    return s ? masterySd(s) : 1;
  };

  // 1. 候选集：目标点的先修闭包 ∪ 目标点本身
  const targetIds = input.targets && input.targets.length > 0 ? input.targets : [...idx.byId.keys()];
  const candidateSet = new Set<string>();
  for (const t of targetIds) {
    if (!idx.byId.has(t)) continue;
    candidateSet.add(t);
    for (const p of prerequisiteClosure(graph, t)) candidateSet.add(p);
  }

  // 2. 已掌握的点不需要再排；未达标的都要排
  const needsWork = [...candidateSet].filter((id) => meanOf(id) < masteryTarget);
  const needsWorkSet = new Set(needsWork);

  // 3. 排序：先修深度升序 → ZPD 距离升序 → id 字典序（保证确定性）
  const topo = topologicalOrder(graph, needsWorkSet);
  const topoIndex = new Map<string, number>();
  topo.forEach((id, i) => topoIndex.set(id, i));

  const sorted = [...needsWork].sort((a, b) => {
    const da = depths.get(a) ?? 0;
    const db = depths.get(b) ?? 0;
    if (da !== db) return da - db;

    // ZPD 距离：离掌握阈值越近越优先（跳一跳够得着）
    const za = Math.abs(masteryTarget - meanOf(a));
    const zb = Math.abs(masteryTarget - meanOf(b));
    if (Math.abs(za - zb) > 1e-9) return za - zb;

    // 不确定性大的先做——多测一题能获得更多信息
    const sa = sdOf(a);
    const sb = sdOf(b);
    if (Math.abs(sa - sb) > 1e-9) return sb - sa;

    // 最后用拓扑序与 id 兜底，保证完全确定
    const ta = topoIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
    const tb = topoIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  /*
   * 4. 装包：按排序贪心，但先修必须已装进路径（或已掌握）。
   *
   * 贪心顺序不等于拓扑序——ZPD 更近的后继可能排到先修前面。
   * 因此这里显式检查：先修落在 deferred 或 blocked 时，该点也必须阻塞。
   * 否则会产出「先修不在路径、后继却在路径」的非法结果，
   * 而 checkPrereqOrder 把「先修不在路径」当已掌握，校验不出来。
   */
  const steps: PathStep[] = [];
  const deferred: string[] = [];
  const blocked: BlockedStep[] = [];
  const deferredSet = new Set<string>();
  const blockedSet = new Set<string>();
  let used = 0;

  /*
   * sorted 按深度升序，而深度严格递增，所以任何先修都排在它的后继之前。
   * 这一条保证了「处理到某点时，先修的去向（装进/推迟/阻塞）已经确定」。
   */
  for (const id of sorted) {
    const preds = (idx.predecessors.get(id) ?? []).filter((p) => needsWorkSet.has(p));
    const hardBlocked = preds.filter((p) => deferredSet.has(p) || blockedSet.has(p));
    if (hardBlocked.length > 0) {
      blockedSet.add(id);
      blocked.push({ kcId: id, by: [...hardBlocked].sort() });
      continue;
    }

    const m = stateById.get(id);
    const n = m?.evidenceN ?? 0;
    const kind: PathStep["kind"] = n === 0 ? "learn" : "review";
    const estimate = costs.get(id) ?? fallbackCosts.get(id)!;
    const proposed = kind === "learn" ? estimate.learnMinutes : estimate.reviewMinutes;
    const cost = Number.isInteger(proposed) && proposed >= 2 && proposed <= 120 ? proposed : (kind === "learn" ? fallbackCosts.get(id)!.learnMinutes : fallbackCosts.get(id)!.reviewMinutes);

    if (used + cost > budgetMinutes) {
      deferredSet.add(id);
      deferred.push(id);
      continue;
    }

    used += cost;
    steps.push({
      kcId: id,
      kind,
      estMinutes: cost,
      reason: explainStep(kind, meanOf(id), sdOf(id), depths.get(id) ?? 0, masteryTarget),
      source: "algorithm",
    });
  }

  const result: Omit<PlanResult, "pathHash"> = {
    steps,
    totalMinutes: used,
    deferred,
    blocked,
    algoVersion: ALGO_VERSION,
    kgVersion: graph.version,
  };

  return { ...result, pathHash: computePathHash(result) };
}

/** 给每一步一句人话理由。理由必须引用具体数值，不能是套话。 */
function explainStep(
  kind: PathStep["kind"],
  mean: number,
  sd: number,
  depth: number,
  target: number,
): string {
  const pct = Math.round(mean * 100);
  const margin = Math.round(sd * 100);
  if (kind === "learn") {
    return `尚无作答记录，先修深度 ${depth}，先建立基线（当前掌握度 ${pct}% ±${margin}）`;
  }
  const gap = Math.round((target - mean) * 100);
  return `已掌握 ${pct}%（±${margin}），距目标还差 ${gap} 个百分点，复习巩固`;
}

/**
 * 对影响排序的量做规范化 JSON，再取 sha256。
 *
 * 刻意不包含 model_version：plan 不调 LLM，路径与模型无关。
 * 如果某个字段变了而 steps 没变、hash 却变了，那个字段就不该在这里。
 */
function canonicalPlanJson(result: Omit<PlanResult, "pathHash">): string {
  return JSON.stringify({
    steps: result.steps.map((s) => ({
      kcId: s.kcId,
      kind: s.kind,
      estMinutes: s.estMinutes,
      source: s.source,
    })),
    algoVersion: result.algoVersion,
    kgVersion: result.kgVersion,
  });
}

/** sha256，浏览器与 Node 都能用。 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 输入指纹：对「影响排序的全部输入」取规范化 JSON 再哈希。
 *
 * 与 pathHash 分开是为了定位问题：两个指纹都相同 → 路径必然相同；
 * inputHash 相同而 pathHash 不同 → 算法或图谱变了；
 * inputHash 不同 → 输入变了（学生又答了题，这是正常现象）。
 *
 * 只纳入 planPath 真正读的字段。题目的难度与内容不在其中——
 * 它们通过「学生答对/答错」影响 mastery，而 mastery 已经在输入里。
 */
export function computeInputHash(input: PlanInput): string {
  const mastery = [...input.mastery]
    .map((m) => ({ kcId: m.kcId, alpha: m.alpha, beta: m.beta, evidenceN: m.evidenceN }))
    .sort((a, b) => (a.kcId < b.kcId ? -1 : a.kcId > b.kcId ? 1 : 0));

  /*
   * 图谱必须按内容纳入，不能只放 version。
   *
   * 只放版本号时，改了边却没 bump version，inputHash 不变而 pathHash 变了，
   * 界面上「输入指纹相同 → 路径指纹必然相同」的提示就是假的。
   * 排序后再序列化，保证边的书写顺序不影响指纹。
   */
  const concepts = input.graph.concepts.map((c) => ({id:c.id,summary:c.summary})).sort((a,b)=>a.id.localeCompare(b.id));
  const edges = input.graph.edges.map((e) => `${e.before}>${e.after}`).sort();

  return sha256Sync(
    JSON.stringify({
      budgetMinutes: input.budgetMinutes,
      target: input.masteryTarget ?? DEFAULT_MASTERY_TARGET,
      targets: [...(input.targets ?? [])].sort(),
      mastery,
      timeEstimates: (input.timeEstimates ?? ruleTimeEstimates(input.graph,input.mastery)).map(e=>({kcId:e.kcId,learn:e.learnMinutes,review:e.reviewMinutes})).sort((a,b)=>a.kcId.localeCompare(b.kcId)),
      kgVersion: input.graph.version,
      concepts,
      edges,
    }),
  );
}

/**
 * 同步版本，只用于测试与 CLI。
 * 用一段纯 JS 实现的 SHA-256，避免在纯函数里依赖异步。
 */
export function computePathHash(result: Omit<PlanResult, "pathHash">): string {
  return sha256Sync(canonicalPlanJson(result));
}

/** 纯 JS SHA-256，保证 planPath 保持同步纯函数。 */

/**
 * 校验路径是否满足先修约束。返回违反项，空数组表示合法。
 *
 * 先修既不在路径里、也不在 mastered 里 → 报违规。
 * 旧版把「先修不在路径」一律当作已掌握，于是「先修被预算推迟、后继却在路径」
 * 这种真实违规会被放过；传 mastered 才能区分「学过了」与「漏排了」。
 *
 * opts 不传 = 旧宽松语义（未出现在路径中的先修视为已掌握），保留给只想查顺序的调用方；
 * 传 opts（哪怕 mastered 为空集）= 严格语义。路径页与诊断页必须传严格模式。
 */
export function checkPrereqOrder(
  graph: KnowledgeGraph,
  steps: readonly PathStep[],
  opts?: { readonly mastered?: ReadonlySet<string> },
): string[] {
  const idx = indexGraph(graph);
  const strict = opts !== undefined;
  const mastered = opts?.mastered ?? new Set<string>();
  const position = new Map<string, number>();
  steps.forEach((s, i) => position.set(s.kcId, i));

  const violations: string[] = [];
  for (const s of steps) {
    const pos = position.get(s.kcId);
    if (pos === undefined) continue;
    for (const p of idx.predecessors.get(s.kcId) ?? []) {
      const predPos = position.get(p);
      if (predPos === undefined) {
        if (strict && !mastered.has(p)) {
          violations.push(`${p} 是 ${s.kcId} 的先修，但不在路径中，也未标记为已掌握`);
        }
        continue;
      }
      if (predPos > pos) {
        violations.push(`${p} 应先于 ${s.kcId}，实际排在其后（位置 ${predPos} > ${pos}）`);
      }
    }
  }
  return violations;
}

/** 由掌握度快照算出「已达阈值」的 kcId 集合，供 checkPrereqOrder 使用。 */
export function masteredSet(
  mastery: readonly MasteryState[],
  threshold = DEFAULT_MASTERY_TARGET,
): Set<string> {
  return new Set(mastery.filter((m) => masteryMean(m) >= threshold).map((m) => m.kcId));
}

/** 用户对路径的手动改动：调整过的顺序 + 显式移除的点。 */
export interface ManualEdit {
  /** 调整后的 kcId 顺序。不在当前 plan 里的 id 会被忽略。 */
  readonly order: readonly string[];
  /** 被用户显式移除的 kcId。重放时必须排除，否则「移除」等于空操作。 */
  readonly removed: readonly string[];
}

/**
 * 把用户手动改动重放到当前算法的步骤集合上。
 *
 * 用途：手动改写只存 kcId 顺序与移除集合，不存整份 steps。预算变化后算法会给出
 * 新的步骤集合，这时用这里重放——用户调整过的相对次序保留，新预算下装不下的点
 * 自动消失，新装进来的点追加在末尾。
 *
 * 两条必须遵守的语义：
 *   1. `removed` 里的点绝不出现。旧实现只从 order 里删掉它，第二个循环又会把
 *      plan.steps 里「不在 order」的步骤全部追加回来，于是「移除」什么也没做。
 *   2. **不改写 `source`**。旧实现给 order 里的每个点都标 manual，
 *      点一次上移后整条路径都显示「已手动调整」。哪些点真的动了由调用方比较位置得出。
 */
export function applyManualOrder(
  steps: readonly PathStep[],
  edit: ManualEdit | null,
): readonly PathStep[] {
  if (!edit) return steps;

  const removed = new Set(edit.removed);
  const pool = steps.filter((s) => !removed.has(s.kcId));
  const byId = new Map(pool.map((s) => [s.kcId, s]));

  const ordered: PathStep[] = [];
  for (const kcId of edit.order) {
    const step = byId.get(kcId);
    if (!step) continue;
    ordered.push(step);
    byId.delete(kcId);
  }
  // 新预算下才装得下的点（或用户没排到的点）：追加在末尾，保持算法给的相对次序
  for (const step of pool) {
    if (byId.has(step.kcId)) ordered.push(step);
  }
  return ordered;
}

/**
 * 相对算法顺序，哪些点被用户真的挪动过。
 *
 * 判据是**相对次序**而不是绝对下标：删掉一步会让后面所有点的下标都变，
 * 按「位置是否变化」判断会把整条路径都标成手动。
 * 这里比较的是「在共同出现的点上，相对顺序是否被打破」。
 *
 * 只标参与顺序变化的点；被移除的点不在结果里（它们不显示）。
 */
export function movedKcIds(
  displayed: readonly PathStep[],
  planSteps: readonly PathStep[],
): Set<string> {
  const planIndex = new Map(planSteps.map((s, i) => [s.kcId, i]));
  const common = displayed.filter((s) => planIndex.has(s.kcId));

  const moved = new Set<string>();
  /*
   * 对每个点，检查它相对其它共同点的次序是否与算法一致。
   * 只要有一个点的相对关系反了，两端都算「被动过」——
   * 用户看到的就是这两个点交换了位置。
   */
  for (let i = 0; i < common.length; i += 1) {
    for (let j = i + 1; j < common.length; j += 1) {
      const a = common[i].kcId;
      const b = common[j].kcId;
      const pa = planIndex.get(a)!;
      const pb = planIndex.get(b)!;
      // 显示顺序是 a 在 b 前；算法顺序却是 b 在 a 前 → 两者相对次序被打破
      if (pa > pb) {
        moved.add(a);
        moved.add(b);
      }
    }
  }
  return moved;
}
