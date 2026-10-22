/**
 * 学习者会话状态。
 *
 * 存储位置：localStorage。选它而不是数据库的原因：
 * 预指导阶段没有部署数据库的条件，而 localStorage 足以支撑
 * 「跨会话记得住」这个承诺——刷新、关标签页、第二天再来，状态都在。
 *
 * 数据结构刻意做成可序列化的纯 JSON，将来换成 Postgres 时
 * 只需要换掉读写函数，业务代码不用动。
 */

import { initialMastery, updateMastery, type MasteryState, type Difficulty } from "@/lib/mastery";
import { computeDepths } from "@/lib/graph";
import { knowledgeGraph } from "@/data/knowledge-graph";
import type { Question } from "@/data/questions";

const STORAGE_KEY = "alp.learner.v1";

/** 一次作答记录。保留它才能解释「为什么你的掌握度是这个数」。 */
export interface AttemptRecord {
  readonly questionId: string;
  readonly kcId: string;
  readonly difficulty: Difficulty;
  readonly correct: boolean;
  /** ISO 时间戳。 */
  readonly at: string;
}

/** 手动改写路径时的一条记录。 */
export interface PathEdit {
  readonly at: string;
  readonly kind: "reorder" | "remove" | "add";
  readonly detail: string;
}

/** 学习者完整状态。 */
export interface LearnerState {
  readonly version: 1;
  /** 学生标识，预指导阶段用固定值，将来接登录后换成真实 id。 */
  readonly learnerId: string;
  readonly mastery: readonly MasteryState[];
  readonly attempts: readonly AttemptRecord[];
  readonly pathEdits: readonly PathEdit[];
  /** 上次看到哪一步，用于「继续上次的学习」。 */
  readonly lastStepIndex: number;
}

/** 新建一个空白学习者。掌握度按图谱深度给先验。 */
export function createLearner(learnerId = "demo-learner"): LearnerState {
  const depths = computeDepths(knowledgeGraph);
  const mastery = knowledgeGraph.concepts.map((c) =>
    initialMastery(c.id, depths.get(c.id) ?? 0),
  );

  return {
    version: 1,
    learnerId,
    mastery,
    attempts: [],
    pathEdits: [],
    lastStepIndex: 0,
  };
}

/** 记录一次作答，返回新的学习者状态（纯函数）。 */
export function recordAttempt(
  state: LearnerState,
  question: Question,
  correct: boolean,
  now: string,
): LearnerState {
  const mastery = state.mastery.map((m) =>
    m.kcId === question.kcId ? updateMastery(m, correct, question.difficulty) : m,
  );

  const attempt: AttemptRecord = {
    questionId: question.id,
    kcId: question.kcId,
    difficulty: question.difficulty,
    correct,
    at: now,
  };

  return {
    ...state,
    mastery,
    attempts: [...state.attempts, attempt],
  };
}

/** 记录一次手动改路径。 */
export function recordPathEdit(state: LearnerState, edit: Omit<PathEdit, "at">, now: string): LearnerState {
  return {
    ...state,
    pathEdits: [...state.pathEdits, { ...edit, at: now }],
  };
}

/** 某个知识点已经做过的题 id 集合，避免重复出同一题。 */
export function attemptedQuestionIds(state: LearnerState, kcId: string): Set<string> {
  return new Set(
    state.attempts.filter((a) => a.kcId === kcId).map((a) => a.questionId),
  );
}

// ── 持久化 ──────────────────────────────────────────────────────────

/**
 * 从 localStorage 读。任何异常都返回新状态——
 * 损坏的存档不该让整个应用白屏。
 */
export function loadLearner(): LearnerState {
  if (typeof window === "undefined") return createLearner();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createLearner();

    const parsed = JSON.parse(raw) as Partial<LearnerState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.mastery)) return createLearner();

    // 图谱改版后，存档里可能有已不存在的知识点；补齐缺失项
    const existing = new Set(parsed.mastery.map((m) => m.kcId));
    const depths = computeDepths(knowledgeGraph);
    const filled = knowledgeGraph.concepts
      .filter((c) => !existing.has(c.id))
      .map((c) => initialMastery(c.id, depths.get(c.id) ?? 0));

    return {
      version: 1,
      learnerId: parsed.learnerId ?? "demo-learner",
      mastery: [...parsed.mastery, ...filled],
      attempts: parsed.attempts ?? [],
      pathEdits: parsed.pathEdits ?? [],
      lastStepIndex: parsed.lastStepIndex ?? 0,
    };
  } catch {
    return createLearner();
  }
}

/** 写入 localStorage。写失败（隐私模式、配额满）时静默降级，不影响当前会话。 */
export function saveLearner(state: LearnerState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存不进去就算了，内存里的状态仍然有效
  }
}

/** 清空存档，回到初始状态。界面上要有这个按钮——否则演示时没法重来。 */
export function resetLearner(): LearnerState {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  return createLearner();
}
