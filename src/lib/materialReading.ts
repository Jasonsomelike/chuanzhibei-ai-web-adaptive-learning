/**
 * 教材原文阅读视图的数据拼装（纯函数，可在 Node 里直接测）。
 *
 * 用户此前只能看到「覆盖章节：第3章、第4章」这样的目录级信息，
 * 看不到内置教材 / 讲义到底写了什么。这里把 MaterialPack 的片段
 * 按来源 → 章节两级分组，供知识口径面板的「查看原文」折叠区渲染。
 *
 * 顺序约定：章节按「第 N 章」的数字升序，无数字的章节名排在有数字的后面，
 * 同章内按片段数组原顺序（内置包的片段本身就是按节编排的）。
 */

import type { MaterialChunk, MaterialPack, MaterialSource } from "@/lib/materials";

export interface SourceChapterGroup {
  readonly chapter: string;
  readonly chunks: readonly MaterialChunk[];
}

export interface SourceReadingView {
  readonly source: MaterialSource;
  readonly chapters: readonly SourceChapterGroup[];
  /** 该来源的片段总字数（码点），用于折叠区标题。 */
  readonly totalChars: number;
}

const CHAPTER_NUMBER = /第\s*(\d+)\s*章/;

function chapterSortKey(chapter: string): number | null {
  const match = CHAPTER_NUMBER.exec(chapter);
  return match ? Number(match[1]) : null;
}

/** 章节排序：有章号的按号升序，无章号的排后面并按名称稳定排序。 */
export function compareChapters(a: string, b: string): number {
  const na = chapterSortKey(a);
  const nb = chapterSortKey(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 码点数；与上传链路的口径一致（重叠片段之和不等于正文总数，不要求对齐）。 */
export function charCountOf(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** 把一个来源的全部片段按章节分组，章节按章号升序。 */
export function chaptersOfChunks(
  chunks: readonly MaterialChunk[],
): readonly SourceChapterGroup[] {
  const byChapter = new Map<string, MaterialChunk[]>();
  for (const chunk of chunks) {
    const list = byChapter.get(chunk.chapter);
    if (list) list.push(chunk);
    else byChapter.set(chunk.chapter, [chunk]);
  }
  return [...byChapter.entries()]
    .sort(([a], [b]) => compareChapters(a, b))
    .map(([chapter, grouped]) => ({ chapter, chunks: grouped }));
}

/** 资料包 → 每来源一份阅读视图；没有片段的来源仍然出现（显示「未提供片段」）。 */
export function readingViewsOf(pack: MaterialPack): readonly SourceReadingView[] {
  return pack.sources.map((source) => {
    const chunks = pack.chunks.filter((chunk) => chunk.sourceId === source.id);
    return {
      source,
      chapters: chaptersOfChunks(chunks),
      totalChars: chunks.reduce((sum, chunk) => sum + charCountOf(chunk.text), 0),
    };
  });
}
