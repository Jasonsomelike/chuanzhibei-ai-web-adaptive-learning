/**
 * 章节视图：把知识点按 chapter 字段聚合成「章」，供路径页选择学习范围。
 *
 * 章节只是界面上的分组，不是规划算法的一等输入。planPath 只认 targets 列表，
 * 先修约束必须在完整图上检查——这一点见 chapterScope 上方的约束说明。
 */

import { prerequisiteClosure, type KnowledgeGraph } from "./graph";

/** 路径页与登出清理共用的 localStorage 键：记住用户当前勾选的章节。 */
export const CHAPTERS_STORAGE_KEY = "alp.chapters.v1";

/** 一个 localStorage 键里按目标 id 存章名列表。 */
export type ChapterStore = Record<string, readonly string[]>;

/**
 * 读回某目标的章节选择。读不出来或格式损坏时一律当「没选」：
 * 宁可回到整科，也不让坏数据缩窄范围。
 * 学习路径页与设置的学习数据面板共用同一份选择，两边口径才会一致。
 */
export function readChapterSelection(targetId: string): readonly string[] {
  try {
    const raw = window.localStorage.getItem(CHAPTERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const value = (parsed as Record<string, unknown>)[targetId];
    if (!Array.isArray(value)) return [];
    return value.filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
}

/** 一个章节及其包含的知识点。 */
export interface Chapter {
  readonly name: string;
  /** 按 graph.concepts 的原顺序排列，同名章节合并时也保持这一顺序。 */
  readonly kcIds: readonly string[];
  readonly count: number;
}

/** 选中章节后交给 planPath 的候选范围。 */
export interface ChapterScope {
  /** 选中章节的知识点并集，按 id 升序。 */
  readonly targets: readonly string[];
  /** 目标先修闭包中不属于目标的点，按 id 升序。 */
  readonly prerequisiteExtra: readonly string[];
  /**
   * targets ∪ prerequisiteExtra 的大小。
   * 语义是「候选范围」而不是预算内步数——实际排几步由 planPath 按预算决定。
   */
  readonly scopeSize: number;
}

/** 从「第 N 章 ...」里取章号；取不到返回 null，由调用方按名称兜底。 */
function chapterNumber(name: string): number | null {
  const match = /第\s*(\d+)\s*章/.exec(name);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) ? n : null;
}

function compareChapterName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareChapters(a: Chapter, b: Chapter): number {
  const na = chapterNumber(a.name);
  const nb = chapterNumber(b.name);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  // 编号相同、或有一方无法解析时按名称兜底；
  // 能解析出编号的章节整体排在纯文字章节之前，避免「附录」插进第 5 章与第 6 章之间。
  if (na !== null && nb === null) return -1;
  if (na === null && nb !== null) return 1;
  return compareChapterName(a.name, b.name);
}

/**
 * 汇总图中的章节。
 *
 * 按章号数值排序，而不是按字符串——字符串会把「第10章」排到「第2章」前面。
 * 同名章节合并成一个条目，知识点保持 graph.concepts 的原始顺序。
 */
export function chaptersOf(graph: KnowledgeGraph): Chapter[] {
  const byName = new Map<string, string[]>();
  for (const c of graph.concepts) {
    const ids = byName.get(c.chapter);
    if (ids) {
      ids.push(c.id);
    } else {
      byName.set(c.chapter, [c.id]);
    }
  }

  return [...byName.entries()]
    .map(([name, kcIds]) => ({ name, kcIds, count: kcIds.length }))
    .sort(compareChapters);
}

/**
 * 选中章节的知识点并集，按 id 升序。
 *
 * 排序不是为了好看：targets 会进入 computeInputHash，
 * 固定输出顺序让「同一组章节、不同勾选顺序」得到完全相同的输入。
 * 未知章名与重复章名都被安全忽略。
 */
export function chapterKcIds(graph: KnowledgeGraph, names: readonly string[]): string[] {
  const wanted = new Set(names);
  const ids = new Set<string>();
  for (const c of graph.concepts) {
    if (wanted.has(c.chapter)) ids.add(c.id);
  }
  return [...ids].sort();
}

/**
 * 选中章节的候选范围：目标点 + 目标先修闭包中落在章外的点。
 *
 * 禁止把选中章节过滤成子图再传给 planPath。
 * checkPrereqOrder 的严格模式（src/lib/plan.ts:375-404）要求每个步骤的先修
 * 要么在路径里、要么在 mastered 里；外章先修被过滤掉后两者都不满足，
 * 整条路径会被判成违规。正确做法是始终传完整图，只把 targets 收窄。
 */
export function chapterScope(graph: KnowledgeGraph, names: readonly string[]): ChapterScope {
  const targets = chapterKcIds(graph, names);
  const targetSet = new Set(targets);

  const extra = new Set<string>();
  for (const id of targets) {
    for (const p of prerequisiteClosure(graph, id)) {
      if (!targetSet.has(p)) extra.add(p);
    }
  }

  const prerequisiteExtra = [...extra].sort();
  return {
    targets,
    prerequisiteExtra,
    scopeSize: targetSet.size + prerequisiteExtra.length,
  };
}
