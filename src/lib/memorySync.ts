/**
 * 记忆卡同步：本机（匿名）与账号（服务端）之间的剥离、合并与回填。
 *
 * 纯函数层，不读写存储、不发请求：
 * - 进度落库前用 stripMemories 把记忆卡摘出去（记忆卡单独存、条数受 MAX_MEMORIES 约束），
 *   读取后再用 withMemories 装回去。
 * - 匿名进度并入账号时用 mergeMemories 做并集，冲突以 lastSeenAt 较新者为准：
 *   复习时间已经落盘，是两边都能比较的唯一可靠顺序。
 * - memoriesEqual 给调用方判断「合并后是否有变化」，避免无意义的写回。
 */

import {
  MAX_MEMORIES,
  parseMemories,
  type MemoryItem,
} from "@/lib/memory";
import type { LearnerState, SubjectProgress } from "@/lib/learner";

/**
 * 去掉全部学科的记忆卡，其余字段原样保留。
 *
 * 返回值里不会出现 memories 键（不是空数组）：落库的进度与被剥离的记忆卡
 * 必须是两份互不重叠的数据，否则「写入时带 memories、读取时从别处补」
 * 会让同一张卡出现两个真相。
 */
export function stripMemories(state: LearnerState): LearnerState {
  let removed = false;
  const subjects: Record<string, SubjectProgress> = {};

  for (const [subjectId, progress] of Object.entries(state.subjects)) {
    if (progress.memories === undefined) {
      subjects[subjectId] = progress;
      continue;
    }
    removed = true;
    subjects[subjectId] = copyWithoutMemories(progress);
  }

  return removed ? { ...state, subjects } : state;
}

/**
 * 把一份记忆卡列表装回某学科。
 *
 * 输入按不可信数据处理（服务端返回、localStorage 旧存档都可能超量或形状坏掉），
 * 统一走 parseMemories 清洗与限容。学科不存在时补一份空进度：
 * 只有记忆卡、没有掌握度是合法状态，调用方随后可以正常开始诊断。
 */
export function withMemories(
  state: LearnerState,
  subjectId: string,
  memories: unknown,
): LearnerState {
  if (subjectId.trim() === "") return state;

  const existing = state.subjects[subjectId];
  const progress: SubjectProgress = existing ?? {
    mastery: [],
    attempts: [],
    pathEdits: [],
    lastStepIndex: 0,
  };

  return {
    ...state,
    subjects: {
      ...state.subjects,
      [subjectId]: { ...progress, memories: parseMemories(memories) },
    },
  };
}

/**
 * 合并两边的记忆卡。
 *
 * 先各自清洗（坏记录丢弃、同侧重复 id 只留第一条），再按 id 求并集：
 * 只在一侧出现的直接保留，两侧都有的比较 lastSeenAt，较新者整张胜出
 * （不做字段级拼接——prompt 与 correction 来自同一次作答，拆开组合会自相矛盾）。
 * 时间相同保留本机（本地参数在前），保证同样输入永远得到同样输出。
 */
export function mergeMemories(local: unknown, remote: unknown): MemoryItem[] {
  const merged = [...parseMemories(local)];
  const indexById = new Map(merged.map((item, index) => [item.id, index] as const));

  for (const item of parseMemories(remote)) {
    const index = indexById.get(item.id);
    if (index === undefined) {
      indexById.set(item.id, merged.length);
      merged.push(item);
      continue;
    }

    const current = merged[index];
    if (Date.parse(item.lastSeenAt) > Date.parse(current.lastSeenAt)) {
      merged[index] = item;
    }
  }

  return capToLimit(merged);
}

/**
 * 判断两份记忆卡在语义上是否相同。
 *
 * 与顺序无关：服务端可能按写入顺序返回，本机按展示顺序排列。
 * 逐字段比较（而不是只看 id 或 lastSeenAt），否则复习状态或 streak 变了
 * 也会被当成「没有变化」而漏同步。
 */
export function memoriesEqual(
  a: readonly MemoryItem[],
  b: readonly MemoryItem[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  const left = a.map(canonicalMemory).sort();
  const right = b.map(canonicalMemory).sort();
  return left.every((value, index) => value === right[index]);
}

/** 超过上限时保留 lastSeenAt 较新的，同时间保留原位置靠前的；其余按原顺序返回。 */
function capToLimit(items: readonly MemoryItem[]): MemoryItem[] {
  if (items.length <= MAX_MEMORIES) return [...items];

  const kept = items
    .map((item, index) => ({ item, index, at: Date.parse(item.lastSeenAt) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .slice(0, MAX_MEMORIES)
    .sort((a, b) => a.index - b.index);

  return kept.map((entry) => entry.item);
}

/**
 * 字段排序后序列化，作为整张卡的指纹。
 *
 * 不依赖对象字面量的键顺序：同一张卡从 localStorage 与服务端读出来时，
 * 键顺序可能不同，但字段值相同时必须判为相等。
 */
function canonicalMemory(item: MemoryItem): string {
  const entries = Object.entries(item)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

function copyWithoutMemories(progress: SubjectProgress): SubjectProgress {
  return {
    mastery: progress.mastery,
    attempts: progress.attempts,
    pathEdits: progress.pathEdits,
    lastStepIndex: progress.lastStepIndex,
  };
}
