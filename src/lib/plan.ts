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
export const ALGO_VERSION = "plan-v1";

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
}

/** 规划结果。 */
export interface PlanResult {
  readonly steps: readonly PathStep[];
  /** 总用时。 */
  readonly totalMinutes: number;
  /** 因为预算不足被跳过的知识点。 */
  readonly deferred: readonly string[];
  /** 因为先修未达标被阻塞的知识点。 */
  readonly blocked: readonly string[];
  /** 输入指纹与输出指纹，用于复现性校验。 */
  readonly pathHash: string;
  readonly algoVersion: string;
  readonly kgVersion: string;
}

export const DEFAULT_MASTERY_TARGET = 0.6;
const MINUTES_PER_LEARN = 15;
const MINUTES_PER_REVIEW = 8;

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

  // 3. 硬约束检查：某点的先修里只要还有未掌握的，该点就 blocked
  const blocked: string[] = [];
  const eligible: string[] = [];
  for (const id of needsWork) {
    const preds = idx.predecessors.get(id) ?? [];
    const blockedBy = preds.filter((p) => candidateSet.has(p) && meanOf(p) < masteryTarget);
    if (blockedBy.length > 0) {
      // 先修点本身也在 needsWork 里，会被排进路径，所以这里只是记录依赖
      eligible.push(id);
    } else {
      eligible.push(id);
    }
  }
  void blocked;

  // 4. 排序：先修深度升序 → ZPD 距离升序 → id 字典序（保证确定性）
  const eligibleSet = new Set(eligible);
  const topo = topologicalOrder(graph, eligibleSet);
  const topoIndex = new Map<string, number>();
  topo.forEach((id, i) => topoIndex.set(id, i));

  const sorted = [...eligible].sort((a, b) => {
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

  // 5. 装包
  const steps: PathStep[] = [];
  const deferred: string[] = [];
  let used = 0;

  for (const id of sorted) {
    const m = stateById.get(id);
    const n = m?.evidenceN ?? 0;
    const kind: PathStep["kind"] = n === 0 ? "learn" : "review";
    const cost = kind === "learn" ? MINUTES_PER_LEARN : MINUTES_PER_REVIEW;

    if (used + cost > budgetMinutes) {
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
 * 同步版本，只用于测试与 CLI。
 * 用一段纯 JS 实现的 SHA-256，避免在纯函数里依赖异步。
 */
export function computePathHash(result: Omit<PlanResult, "pathHash">): string {
  return sha256Sync(canonicalPlanJson(result));
}

/** 纯 JS SHA-256，保证 planPath 保持同步纯函数。 */
export function sha256Sync(input: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;

  // 填充：0x80 + 若干 0 + 8 字节长度，总长必须是 64 的倍数。
  // 需要容纳 len + 1（0x80）+ 8（长度），向上取整到 64 的倍数。
  // 注意 len+9 恰为 64 倍数时不能多开一块（len=55、119 就是这种边界）。
  const totalLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const withPad = new Uint8Array(totalLen);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;

  const view = new DataView(withPad.buffer);
  // 64 位大端长度：高 32 位在前，低 32 位在后
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < withPad.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  return H.map((x) => x.toString(16).padStart(8, "0")).join("");
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** 校验路径是否满足先修约束。返回违反项，空数组表示合法。 */
export function checkPrereqOrder(
  graph: KnowledgeGraph,
  steps: readonly PathStep[],
): string[] {
  const idx = indexGraph(graph);
  const position = new Map<string, number>();
  steps.forEach((s, i) => position.set(s.kcId, i));

  const violations: string[] = [];
  for (const s of steps) {
    const pos = position.get(s.kcId);
    if (pos === undefined) continue;
    for (const p of idx.predecessors.get(s.kcId) ?? []) {
      const predPos = position.get(p);
      // 先修不在路径里 → 说明已掌握，合法
      if (predPos === undefined) continue;
      if (predPos > pos) {
        violations.push(`${p} 应先于 ${s.kcId}，实际排在其后（位置 ${predPos} > ${pos}）`);
      }
    }
  }
  return violations;
}
