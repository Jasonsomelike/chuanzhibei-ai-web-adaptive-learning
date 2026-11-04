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
import { parseMemories, type MemoryItem } from "@/lib/memory";

const STORAGE_KEY = "alp.learner.v2";

/**
 * 题目来源。内置题库题没有来源字段，写入作答记录时归为 builtin，
 * 这样「生成题打 0.8 折」的判定不必依赖 id 前缀（手动题也是 di- 开头）。
 */
export type AttemptSource = "builtin" | "generated" | "borrowed" | "manual";

/** 一次作答记录。保留它才能解释「为什么你的掌握度是这个数」。 */
export interface AttemptRecord {
  readonly attemptId?: string;
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
  /**
   * 作答前系统给出的预测正确率（0–1）。旧存档没有这个字段，
   * 校准只统计带预测值的记录，缺失的条数单独展示。
   */
  readonly predicted?: number;
  /** 本次证据的折扣：1 = 全额，0.8 = 生成题，0 = 仅练习。 */
  readonly weightScale?: number;
  readonly source?: AttemptSource;
  /** 学生选中的选项下标，用于记忆卡展示「你选了…」。 */
  readonly selectedIndex?: number;
  /** 已归档的重测前证据：保留历史，但不进入本轮掌握度。 */
  readonly retired?: boolean;
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
  /**
   * 记忆卡。可选是为了让没有这个字段的旧存档仍能加载；
   * 新建与清洗过的进度一律给数组，业务代码不必再判 undefined。
   */
  readonly memories?: readonly MemoryItem[];
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
  return { mastery, attempts: [], pathEdits: [], lastStepIndex: 0, memories: [] };
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

/** recordAttempt 的可选参数。graph 用于自定义方向，其余字段原样落进作答记录。 */
export interface RecordAttemptOptions {
  readonly attemptId?: string;
  readonly graph?: KnowledgeGraph;
  readonly weightScale?: number;
  readonly predicted?: number;
  readonly source?: AttemptSource;
  readonly selectedIndex?: number;
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
 *
 * predicted / source / selectedIndex 只是随记录落盘，供校准与记忆卡读取，
 * 不参与 counted 判定，也不改变 α/β 的更新规则。
 */
export function recordAttempt(
  state: LearnerState,
  subjectId: string,
  question: Question,
  correct: boolean,
  now: string,
  opts?: RecordAttemptOptions,
): LearnerState {
  const progress = progressOf(state, subjectId, opts?.graph);

  const alreadyCounted = progress.attempts.some(
    (a) => !a.retired && a.questionId === question.id && a.kcId === question.kcId && a.counted !== false,
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
    attemptId: opts?.attemptId ?? `${question.id}:${now}:${progress.attempts.length}`,
    questionId: question.id,
    kcId: question.kcId,
    difficulty: question.difficulty,
    correct,
    at: now,
    ...(counted ? {} : { counted: false }),
    ...(opts?.predicted !== undefined ? { predicted: opts.predicted } : {}),
    ...(opts?.weightScale !== undefined ? { weightScale: opts.weightScale } : {}),
    ...(opts?.source !== undefined ? { source: opts.source } : {}),
    ...(opts?.selectedIndex !== undefined ? { selectedIndex: opts.selectedIndex } : {}),
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
 * 清空某个知识点的作答证据（纯函数）。
 *
 * 为什么需要显式清空：内置题每个知识点只有 3 道，答满 3 题就达到证据门槛
 * （mastery.ts 的 EVIDENCE_TARGET），而同一题重复作答 `counted=false` 不改变 α/β，
 * 于是答完后再答掌握度也永远停在首次测评的结果。要让「学会之后再测一次」
 * 真正影响路径，只能清空该知识点的证据重测——这必须是显式按钮 + 二次确认的操作，
 * 不能在答题流程里自动触发。
 *
 * 语义：
 *   - 该 KC 的 mastery 回到与新建进度一致的先验（按图谱深度，evidenceN 归零）
 *   - 该 KC 的旧作答归档保留，attemptedQuestionIds 只查看本轮有效记录
 *   - 其它知识点、其它学科、pathEdits 与 memories 原样保留
 *
 * graph 与 recordAttempt 同义：自定义方向必须传，否则会回落内置学科建进度。
 */
export function clearKcEvidence(
  state: LearnerState,
  subjectId: string,
  kcId: string,
  graph?: KnowledgeGraph,
): LearnerState {
  const progress = progressOf(state, subjectId, graph);
  const g = graph ?? getSubject(subjectId).graph;
  const prior = initialMastery(kcId, computeDepths(g).get(kcId) ?? 0);

  return {
    ...state,
    subjects: {
      ...state.subjects,
      [subjectId]: {
        ...progress,
        mastery: progress.mastery.map((m) => (m.kcId === kcId ? prior : m)),
        attempts: progress.attempts.map((a) => a.kcId === kcId ? { ...a, retired: true } : a),
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

/** 记忆卡更新器：拿当前列表，返回新列表。 */
export type MemoryUpdater = (memories: readonly MemoryItem[]) => readonly MemoryItem[];

/**
 * 只改某学科的记忆卡，掌握度与作答记录原样返回（纯函数）。
 *
 * 记忆卡的创建/复习自评不计证据，所以不能借 recordAttempt 顺手写入；
 * 页面要把 `updateMemories(recordAttempt(...), ...)` 组合成一次 setLearner，
 * 分两次写会用同一个旧 state 覆盖掉刚写入的 attempts。
 *
 * 返回值再过一遍 parseMemories：容量与字段范围在入口收口，
 * 调用方即使传回带坏记录或超量（>200）的数组，也不会原样写进进度。
 */
export function updateMemories(
  state: LearnerState,
  subjectId: string,
  updater: MemoryUpdater,
  graph?: KnowledgeGraph,
): LearnerState {
  const progress = progressOf(state, subjectId, graph);
  const memories = parseMemories(updater(progress.memories ?? []));
  return {
    ...state,
    subjects: {
      ...state.subjects,
      [subjectId]: { ...progress, memories },
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
    progress.attempts.filter((a) => !a.retired && a.kcId === kcId).map((a) => a.questionId),
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

// ── 持久化与清洗 ────────────────────────────────────────────────────

/**
 * 清洗一份学科进度。localStorage 与服务端拉回的 JSON 都是不可信输入，
 * 出口只放形状正确的字段；返回 null 表示这份数据没法用，
 * 调用方应保留本地版本或新建进度，而不是把半截掌握度带进界面。
 *
 * memories 交给 memory.ts 的 parseMemories：逐条校验、按 id 去重、
 * 最多保留 MAX_MEMORIES 张。超过上限或形状坏掉的记录不会原样进 UI。
 */
export function sanitizeProgress(raw: unknown): SubjectProgress | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.mastery)) return null;

  const mastery: MasteryState[] = [];
  const seenKc = new Set<string>();
  for (const entry of raw.mastery) {
    const clean = sanitizeMastery(entry);
    if (!clean || seenKc.has(clean.kcId)) continue;
    seenKc.add(clean.kcId);
    mastery.push(clean);
  }
  // 有掌握度但一条都认不出：这份进度一定是坏的。
  // 返回空数组会让诊断页以为「所有知识点都测完了」，所以整份丢弃。
  if (raw.mastery.length > 0 && mastery.length === 0) return null;

  const attempts = Array.isArray(raw.attempts)
    ? raw.attempts
        .map(sanitizeAttempt)
        .filter((a): a is AttemptRecord => a !== null)
    : [];
  const pathEdits = Array.isArray(raw.pathEdits)
    ? raw.pathEdits.map(sanitizePathEdit).filter((e): e is PathEdit => e !== null)
    : [];

  return {
    mastery,
    attempts,
    pathEdits,
    lastStepIndex: isCount(raw.lastStepIndex) ? raw.lastStepIndex : 0,
    memories: parseMemories(raw.memories),
  };
}

/**
 * 合并服务端拉回的进度。
 *
 * 服务端存的是整块 JSON，可能是旧版本写入或被人为篡改的；
 * 直接展开会把超过 200 张或形状坏掉的 memories 原样带进界面。
 * 清洗失败的学科保留本地版本——一次坏数据不该把整科掌握度清空。
 */
export function mergeServerProgress(local: LearnerState, raw: unknown): LearnerState {
  if (!isRecord(raw)) return local;

  const subjects: Record<string, SubjectProgress> = { ...local.subjects };
  for (const [subjectId, value] of Object.entries(raw)) {
    const progress = sanitizeProgress(value);
    if (progress) subjects[subjectId] = progress;
  }
  return { ...local, subjects };
}

/**
 * 从 localStorage 读。任何异常都返回新状态——
 * 损坏的存档不该让整个应用白屏。
 *
 * 旧存档没有 predicted / weightScale / source / selectedIndex / memories，
 * 清洗时会按缺省处理，不影响已有掌握度与作答记录。
 */
export function loadLearner(): LearnerState {
  if (typeof window === "undefined") return createLearner();

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createLearner();

    const parsed = JSON.parse(raw) as Partial<LearnerState>;
    if (parsed.version !== 2 || !isRecord(parsed.subjects)) {
      return createLearner();
    }

    const subjects: Record<string, SubjectProgress> = {};
    for (const [subjectId, value] of Object.entries(parsed.subjects)) {
      const progress = sanitizeProgress(value);
      if (progress) subjects[subjectId] = progress;
    }

    return {
      version: 2,
      learnerId: parsed.learnerId ?? "demo-learner",
      subjects,
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

// ── 形状校验 ────────────────────────────────────────────────────────

function sanitizeMastery(raw: unknown): MasteryState | null {
  if (!isRecord(raw)) return null;
  const { kcId, alpha, beta, evidenceN } = raw;
  if (!isNonEmptyString(kcId)) return null;
  if (!isNonNegativeNumber(alpha) || !isNonNegativeNumber(beta)) return null;
  if (!isNonNegativeNumber(evidenceN)) return null;
  return { kcId, alpha, beta, evidenceN: Math.floor(evidenceN) };
}

function sanitizeAttempt(raw: unknown): AttemptRecord | null {
  if (!isRecord(raw)) return null;
  const { questionId, kcId, difficulty, correct, at } = raw;
  if (!isNonEmptyString(questionId) || !isNonEmptyString(kcId)) return null;
  if (!isDifficulty(difficulty)) return null;
  if (typeof correct !== "boolean") return null;
  if (!isNonEmptyString(at)) return null;

  return {
    questionId,
    kcId,
    difficulty,
    correct,
    at,
    ...(typeof raw.attemptId === "string" && raw.attemptId.length <= 250 ? { attemptId: raw.attemptId } : {}),
    // counted 只认显式的 false；旧存档缺字段就是「计入」
    ...(raw.counted === false ? { counted: false } : {}),
    ...(isFiniteNumber(raw.predicted) ? { predicted: raw.predicted } : {}),
    ...(isFiniteNumber(raw.weightScale) ? { weightScale: raw.weightScale } : {}),
    ...(isAttemptSource(raw.source) ? { source: raw.source } : {}),
    ...(isCount(raw.selectedIndex) ? { selectedIndex: raw.selectedIndex } : {}),
    ...(raw.retired === true ? { retired: true } : {}),
  };
}

function sanitizePathEdit(raw: unknown): PathEdit | null {
  if (!isRecord(raw)) return null;
  const { at, kind, detail } = raw;
  if (!isNonEmptyString(at) || !isNonEmptyString(detail)) return null;
  if (kind !== "reorder" && kind !== "remove" && kind !== "add") return null;
  return { at, kind, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

/** 计数与下标：非负整数。 */
function isCount(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isAttemptSource(value: unknown): value is AttemptSource {
  return (
    value === "builtin" ||
    value === "generated" ||
    value === "borrowed" ||
    value === "manual"
  );
}
