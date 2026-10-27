/**
 * 掌握度模型：难度加权 Beta-Bernoulli 后验。
 *
 * 选它而不选 BKT / DKT 的原因见 research/06-synthesis.md §1.3：
 * 一个班 30–60 人、每知识点 3 题，BKT 的四个参数无法识别；
 * Beta 后验只需两个数（α、β），且能同时给出掌握度与不确定度。
 */

/** 先验强度：等价于「2 个虚拟观测」。越大越保守，越不容易被少数几题带跑。 */
export const PRIOR_STRENGTH = 2;

/** 难度权重系数。w = W_BASE + W_PER_DIFFICULTY · d */
export const W_BASE = 0.5;
export const W_PER_DIFFICULTY = 0.25;

/** 一个知识点的能力状态。alpha/beta 是 Beta 分布的两个参数。 */
export interface MasteryState {
  readonly kcId: string;
  readonly alpha: number;
  readonly beta: number;
  /** 已用于更新的题目作答次数。 */
  readonly evidenceN: number;
}

/** 题目难度，1（最易）到 5（最难）。 */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

/**
 * 难度权重：答对一道难题比答对一道易题提供更多「会了」的证据。
 *
 * 注意 d=2 时 w=1.0、d=3 时 w=1.25。这个取值是产品假设，不是文献结论
 * （见 06-synthesis §1.3）。凡是「几题够用」的结论都依赖这个映射，
 * 所以难度标签的准确性直接影响题库规模，不能随便标。
 */
export function difficultyWeight(d: Difficulty): number {
  return W_BASE + W_PER_DIFFICULTY * d;
}

/**
 * 先验掌握度按图谱深度递减：根节点 0.35，每深一层 −0.05，下限 0.10。
 * 含义是「越靠上的基础概念，默认学生越可能已经会了」。
 */
export function priorMastery(depth: number): number {
  return Math.max(0.1, 0.35 - 0.05 * Math.max(0, depth));
}

/** 建一个全新的掌握度状态。 */
export function initialMastery(kcId: string, depth: number): MasteryState {
  const p = priorMastery(depth);
  return {
    kcId,
    alpha: PRIOR_STRENGTH * p,
    beta: PRIOR_STRENGTH * (1 - p),
    evidenceN: 0,
  };
}

/**
 * 用一次作答更新状态。
 *
 * 答对加 α、答错加 β，加的量是难度权重 w。
 * 这是纯函数：不修改入参，返回新对象。
 */
export function updateMastery(
  state: MasteryState,
  correct: boolean,
  difficulty: Difficulty,
): MasteryState {
  return updateMasteryScaled(state, correct, difficulty, 1);
}

/**
 * 带证据折扣的更新。weightScale=0.8 表示「这条证据只算八成」。
 *
 * 生成题的难度标签来自模型，可信度低于人工校准的内置题，
 * 所以打折而不是直接采信；weightScale=0 用于「仅练习」题（完全不进证据）。
 */
export function updateMasteryScaled(
  state: MasteryState,
  correct: boolean,
  difficulty: Difficulty,
  weightScale: number,
): MasteryState {
  // 0 权重 = 这条证据不算数，连 evidenceN 也不该涨
  if (weightScale <= 0) return state;
  const w = difficultyWeight(difficulty) * weightScale;
  return {
    kcId: state.kcId,
    alpha: state.alpha + (correct ? w : 0),
    beta: state.beta + (correct ? 0 : w),
    evidenceN: state.evidenceN + 1,
  };
}

/** 掌握度点估计 = Beta 分布的均值。 */
export function masteryMean(state: MasteryState): number {
  return state.alpha / (state.alpha + state.beta);
}

/**
 * 掌握度标准差 = Beta 分布的标准差。
 *
 * 它是「我们有多不确定」，不是「学生学得好不好」。sd 在 α≈β 时最大，
 * 所以同一知识点做 3 题时「对 2 题」的 sd 反而比「对 1 题」大。
 * 界面上不要把 sd 直接翻译成「证据充分/不足」而不显示观测次数 n。
 */
export function masterySd(state: MasteryState): number {
  const { alpha: a, beta: b } = state;
  const n = a + b;
  return Math.sqrt((a * b) / (n * n * (n + 1)));
}

/** 置信档位：sd 阈值。 */
export const CONFIDENCE_SD_THRESHOLD = 0.2;

/**
 * 每个知识点要多少条证据才算「测够了」。
 *
 * 内置题 3 条即可：实测 360 个 KC 全对 3 题后 sd 最大 0.196（≤0.20）。
 * 生成题按 weightScale=0.8 打折后需要 4 条：depth=13、d=2、4 题全对 sd=0.1911，
 * 3 题只有 0.2116（不达标）。这个差别不是审美，是 sd 阈值算出来的。
 */
export const EVIDENCE_TARGET = { builtin: 3, generated: 4 } as const;

/**
 * 是否已经「观测足够」——只用来决定还要不要继续出题，
 * 不要用它表达学生学得好不好。
 *
 * 两个条件都要满足：
 *   1. 证据条数 ≥ target（防止「一道题答对就停」）
 *   2. sd ≤ CONFIDENCE_SD_THRESHOLD（防止「条数够但答案分裂」——
 *      同一知识点对错各半时 sd 反而更大，条数达标不等于精度达标）
 *
 * 第 2 条曾经只写在 README 里、代码里没调用（CONFIDENCE_SD_THRESHOLD 全仓库无引用）。
 * 现在它是真实判据：diagnose 页的停测与结果卡的「证据不足」提示都走这里。
 * 实测 360 个 KC 全对 3 题 sd 最大 0.196，所以内置题不会因为第 2 条被卡住。
 */
export function hasEnoughEvidence(
  state: MasteryState,
  target: number = EVIDENCE_TARGET.builtin,
): boolean {
  return state.evidenceN >= target && masterySd(state) <= CONFIDENCE_SD_THRESHOLD;
}

/**
 * 给定掌握度 p 与题目难度 d，预测答对的概率。
 *
 * 逻辑斯蒂：logit(q) = logit(p) − β·(d − 3)，即难度每升一档，答对几率乘以 e^-β。
 * 用 logit 而不是直接减，是因为 p 接近 0/1 时概率不能越界。
 *
 * 不叠加猜测率下限：四选一有 0.25 的瞎猜概率，理论上应写成
 * floor + (1−floor)·q，但那样 d=3 时预测值变成 0.51，
 * 与「难度 3 对应掌握度本身」的直觉冲突，也让选题的 0.65 目标失去意义。
 * 本项目选择保留「预测值可直接与掌握度比较」这个性质，代价是低掌握度时略低估。
 * 这是产品假设，不是文献结论。
 */
export function predictCorrect(p: number, d: Difficulty, beta = 0.6): number {
  const clamped = Math.min(0.999, Math.max(0.001, p));
  const logit = Math.log(clamped / (1 - clamped)) - beta * (d - 3);
  return 1 / (1 + Math.exp(-logit));
}

/**
 * P(真实掌握度 > threshold)，即 Beta 后验的生存函数。
 *
 * 用于界面展示（MasteryBar 的第二行小字），**不作为停测准则**：
 * 实测 360 个知识点「3 题全对」后 P(p>0.6) 最高只有 0.848，
 * 达不到常见的 0.90；要达标得把每题数从 3 提到 4–5，会破坏题库设计。
 */
export function masteryProbAbove(state: MasteryState, threshold: number): number {
  return 1 - regularizedIncompleteBeta(threshold, state.alpha, state.beta);
}

/**
 * 正则化不完全 Beta 函数 I_x(a,b)。
 *
 * 用连分式（Lentz 算法）实现，只依赖 Math.exp / Math.log，
 * 浏览器与 Node 结果一致——这是它必须自己写而不引库的原因：
 * 引一个数值库会把「同一个数在任何环境都一样」变成依赖。
 */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // 对称性：x > (a+1)/(a+b+2) 时用 1 − I_{1−x}(b,a) 收敛更快
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  const logBeta = logGamma(a + b) - logGamma(a) - logGamma(b);
  const front = Math.exp(logBeta + a * Math.log(x) + b * Math.log(1 - x));

  // Lentz 连分式
  const TINY = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;

    aa = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < 1e-12) break;
  }

  return (front * h) / a;
}

/** Lanczos 近似的 ln Γ(x)，只用于 Beta 归一化常数。 */
function logGamma(x: number): number {
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // 反射公式
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let sum = coef[0];
  for (let i = 1; i < g + 2; i += 1) sum += coef[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}
