/**
 * 学习者状态：按学科隔离。
 *
 * 关键设计：每个学科有独立的掌握度与作答记录。
 * 数据结构答过的题不会影响计算机网络——不同学科的知识点没有可比性。
 * 学科之间只共享「学习者身份」与界面偏好。
 *
 * 存储：localStorage。换成 Postgres 只需替换读写函数，业务代码不用动。
 */

import {
  initialMastery,
  updateMasteryScaled,
  type MasteryState,
  type Difficulty,
} from "@/lib/mastery";
import { computeDepths, type KnowledgeGraph } from "@/lib/graph";
import { getSubject, DEFAULT_SUBJECT_ID } from "@/data/subjects";
import type { Question } from "@/data/questions";

const STORAGE_KEY = "alp.learner.v2";

/** 一次作答记录。保留它才能解释「为什么你的掌握度是这个数」。 */
export interface AttemptRecord {
  readonly questionId: string;
  readonly kcId: string;
  readonly difficulty: Difficulty;
  readonly correct: boolean;
  /** ISO 时间戳。 */
  readonly at: string;
  /**
   * 这次作答是否计入掌握度。缺省（旧存档）视为 true。
   * false 的两种来源：同一题重复作答、仅练习题（校验未通过，weightScale=0）。
   */
  readonly counted?: boolean;
}

/** 手动改写路径时的一条记录。 */
export interface PathEdit {
  readonly at: string;
  readonly kind: "reorder" | "remove" | "add";
  readonly detail: string;
}

/** 单个学科的学习状态。 */
export interface SubjectProgress {
  readonly mastery: readonly MasteryState[];
  readonly attempts: readonly AttemptRecord[];
  readonly pathEdits: readonly PathEdit[];
  readonly lastStepIndex: number;
}

/** 学习者完整状态：按学科分组。 */
export interface LearnerState {
  readonly version: 2;
  readonly learnerId: string;
  /** 学科 id → 该学科的进度。 */
  readonly subjects: Readonly<Record<string, SubjectProgress>>;
}

/** 新建一个学科进度。掌握度按图谱深度给先验。 */
export function createSubjectProgress(
  subjectId: string,
  graph?: KnowledgeGraph,
): SubjectProgress {
  const subject = getSubject(subjectId);
  // 自定义方向没有 Subject 记录，必须把图传进来；缺省才走内置学科
  const g = graph ?? subject.graph;
  const depths = computeDepths(g);
  const mastery = g.concepts.map((c) => initialMastery(c.id, depths.get(c.id) ?? 0));
  return { mastery, attempts: [], pathEdits: [], lastStepIndex: 0 };
}

/** 新建空白学习者。 */
export function createLearner(learnerId = "demo-learner"): LearnerState {
  return {
    version: 2,
    learnerId,
    subjects: { [DEFAULT_SUBJECT_ID]: createSubjectProgress(DEFAULT_SUBJECT_ID) },
  };
}

/** 取某学科的进度；不存在则新建（不写回，由调用方决定）。 */
export function progressOf(
  state: LearnerState,
  subjectId: string,
  graph?: KnowledgeGraph,
): SubjectProgress {
  return state.subjects[subjectId] ?? createSubjectProgress(subjectId, graph);
}

/**
 * 记录一次作答，返回新的学习者状态（纯函数）。
 *
 * 同一道题在同一学科里重复作答只记录、不重复计证据。
 * 否则把一道题连点 5 次就能把掌握度推到 0.77——那不是测评，是刷分。
 * 重复作答仍然入 attempts（`counted: false`），界面上能看到「这题做过」。
 *
 * opts.weightScale 用于「仅练习」的题（生成题未过答案校验）：传 0 表示不计证据。
 * 折扣不在这里做——折扣要改的是 α/β 的增量，而 updateMastery 不认识折扣，
 * 所以由调用方把 difficulty 折算后传入，或在 mastery 层用 updateMasteryScaled。
 */
export function recordAttempt(
  state: LearnerState,
  subjectId: string,
  question: Question,
  correct: boolean,
  now: string,
  opts?: { readonly graph?: KnowledgeGraph; readonly weightScale?: number },
): LearnerState {
  const progress = progressOf(state, subjectId, opts?.graph);

  const alreadyCounted = progress.attempts.some(
    (a) => a.questionId === question.id && a.kcId === question.kcId && a.counted !== false,
  );
  const weightScale = opts?.weightScale ?? 1;
  const counted = !alreadyCounted && weightScale > 0;

  const mastery = counted
    ? progress.mastery.map((m) =>
        m.kcId === question.kcId
          ? updateMasteryScaled(m, correct, question.difficulty, weightScale)
          : m,
      )
    : progress.mastery;

  const attempt: AttemptRecord = {
    questionId: question.id,
    kcId: question.kcId,
    difficulty: question.difficulty,
    correct,
    at: now,
    ...(counted ? {} : { counted: false }),
  };

  return {
    ...state,
    subjects: {
      ...state.subjects,
      [subjectId]: {
        ...progress,
        mastery,
        attempts: [...progress.attempts, attempt],
      },
    },
  };
}

/**
 * 记录一次手动改路径。
 *
 * 必须传 graph：自定义方向没有 Subject 记录，不传会按内置学科建出
 * c01–c40 的掌握度，把方向自己的 k1/k2… 覆盖掉——诊断页随后会认为
 * 「这个方向没有任何知识点」，显示成「诊断完成」。
 */
export function recordPathEdit(
  state: LearnerState,
  subjectId: string,
  edit: Omit<PathEdit, "at">,
  now: string,
  graph?: KnowledgeGraph,
): LearnerState {
  const progress = progressOf(state, subjectId, graph);
  return {
    ...state,
    subjects: {
      ...state.subjects,
      [subjectId]: {
        ...progress,
        pathEdits: [...progress.pathEdits, { ...edit, at: now }],
      },
    },
  };
}

/** 某个知识点已经做过的题 id 集合，避免重复出同一题。 */
export function attemptedQuestionIds(
  state: LearnerState,
  subjectId: string,
  kcId: string,
  graph?: KnowledgeGraph,
): Set<string> {
  const progress = progressOf(state, subjectId, graph);
  return new Set(
    progress.attempts.filter((a) => a.kcId === kcId).map((a) => a.questionId),
  );
}

/** 某学科的总作答数。 */
export function attemptCount(
  state: LearnerState,
  subjectId: string,
  graph?: KnowledgeGraph,
): number {
  return progressOf(state, subjectId, graph).attempts.length;
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
    if (parsed.version !== 2 || typeof parsed.subjects !== "object" || !parsed.subjects) {
      return createLearner();
    }

    return {
      version: 2,
      learnerId: parsed.learnerId ?? "demo-learner",
      subjects: parsed.subjects,
    };
  } catch {
    return createLearner();
  }
}

/** 写入 localStorage。写失败时静默降级，不影响当前会话。 */
export function saveLearner(state: LearnerState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存不进去就算了，内存里的状态仍然有效
  }
}

/** 清空存档。界面上要有这个按钮——否则演示时没法重来。 */
export function resetLearner(): LearnerState {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  return createLearner();
}
