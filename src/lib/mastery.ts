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
  const w = difficultyWeight(difficulty);
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
 * 是否已经「观测足够」——只用来决定还要不要继续出题，
 * 不要用它表达学生学得好不好。
 */
export function hasEnoughEvidence(state: MasteryState): boolean {
  return masterySd(state) <= CONFIDENCE_SD_THRESHOLD;
}

/**
 * 界面上展示的置信描述。以观测次数为主信息，sd 只作为精度注记。
 * 这样避免了「答对 2 题反而掉档」的观感问题。
 */
export function describeConfidence(state: MasteryState): string {
  const n = state.evidenceN;
  if (n === 0) return "尚未测评";
  const pct = Math.round(masteryMean(state) * 100);
  const margin = Math.round(masterySd(state) * 100);
  return `已测 ${n} 题 · 掌握度 ${pct}%（±${margin}）`;
}
