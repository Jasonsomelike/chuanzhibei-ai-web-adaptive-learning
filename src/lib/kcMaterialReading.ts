/**
 * 按知识点组织的教材原文阅读视图（纯函数，可在 Node 里直接测）。
 *
 * 诊断页此前只能出题，看不到教材本身。这里把「内置教材/讲义 + 上传资料」
 * 合并包（与出题引用同源）按知识点分组：每个知识点列出引用它的全部片段，
 * 按来源优先级 → 同章优先 → 页码排序（与 chunksForConcept 一致），
 * 让学生「先读原文再答题」。
 *
 * 只包含用户选中来源（selection）里的片段——与出题口径一致，
 * 未选中的来源不出现，避免「出题不用它、阅读却显示它」的错位。
 */

import type { KnowledgeConcept } from "@/lib/graph";
import type { MaterialChunk, MaterialPack, MaterialSelection } from "@/lib/materials";
import { citationLabel, excerptFor } from "@/lib/materials";

/** 一个知识点下的原文条目：引用抬头 + 正文。 */
export interface KcReadingEntry {
  readonly kcId: string;
  readonly kcName: string;
  readonly chapter: string;
  /** 按出题同源排序的片段；引用抬头可直接复用 citationLabel。 */
  readonly entries: readonly { readonly label: string; readonly text: string }[];
  /** 有原文的知识点才为 true；false 时界面显示「暂无原文」。 */
  readonly hasContent: boolean;
}

/**
 * 图谱 → 每知识点一份阅读视图。
 *
 * 每个知识点单独取 excerptFor（最高优先级一条）不够展示——
 * 这里改用 chunksForConcept 的排序直接过滤合并包，把该知识点
 * 命中的全部片段按同源顺序列出，引用抬头与出题/引用核对一致。
 */
export function kcReadingViews(
  pack: MaterialPack,
  concepts: readonly KnowledgeConcept[],
  selection: MaterialSelection,
): readonly KcReadingView[] {
  const rank = new Map<string, number>();
  selection.sourceIds.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  const selected = new Set(selection.sourceIds);
  const sourceById = new Map(pack.sources.map((s) => [s.id, s] as const));

  const conceptsOut: KcReadingEntry[] = concepts.map((concept) => {
    const matched = pack.chunks
      .filter((chunk) => selected.has(chunk.sourceId) && chunk.kcIds.includes(concept.id))
      .sort((a, b) => {
        const ra = rank.get(a.sourceId) ?? 0;
        const rb = rank.get(b.sourceId) ?? 0;
        if (ra !== rb) return ra - rb;
        const ca = a.chapter === concept.chapter ? 0 : 1;
        const cb = b.chapter === concept.chapter ? 0 : 1;
        if (ca !== cb) return ca - cb;
        return compareChunkOrder(a, b);
      });

    const entries = matched
      .map((chunk) => {
        const source = sourceById.get(chunk.sourceId);
        if (!source) return null;
        const text = chunk.text.trim();
        if (text === "") return null;
        const excerpt = {
          chunkId: chunk.id,
          sourceId: chunk.sourceId,
          sourceTitle: source.title,
          kind: source.kind,
          chapter: chunk.chapter,
          section: chunk.section,
          pageFrom: chunk.pageFrom ?? null,
          pageTo: chunk.pageTo ?? null,
          text,
          truncated: false,
        };
        return { label: citationLabel(excerpt), text };
      })
      .filter((entry): entry is { label: string; text: string } => entry !== null);

    return {
      kcId: concept.id,
      kcName: concept.name,
      chapter: concept.chapter,
      entries,
      hasContent: entries.length > 0,
    };
  });

  return groupReadingViews(conceptsOut);
}

export interface KcReadingView {
  readonly chapter: string;
  readonly items: readonly KcReadingEntry[];
  /** 该章有原文的知识点数，用于折叠区标题。 */
  readonly withContentCount: number;
}

/** 片段排序兜底：页码升序（无页码最后），再按 id 稳定排序。 */
function compareChunkOrder(a: MaterialChunk, b: MaterialChunk): number {
  const pa = a.pageFrom ?? Number.POSITIVE_INFINITY;
  const pb = b.pageFrom ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 按章节名把知识点分组，保持图谱原顺序（concepts 本身按章节编排）。 */
function groupReadingViews(entries: readonly KcReadingEntry[]): readonly KcReadingView[] {
  const views: { chapter: string; items: KcReadingEntry[]; withContentCount: number }[] = [];
  const byChapter = new Map<string, { chapter: string; items: KcReadingEntry[]; withContentCount: number }>();
  for (const entry of entries) {
    let view = byChapter.get(entry.chapter);
    if (!view) {
      view = {
        chapter: entry.chapter,
        items: [],
        withContentCount: 0,
      };
      byChapter.set(entry.chapter, view);
      views.push(view);
    }
    view.items.push(entry);
    if (entry.hasContent) view.withContentCount += 1;
  }
  return views;
}

/** 当前目标是否有任何可读原文（决定诊断页是否渲染阅读模块）。 */
export function hasReadingContent(views: readonly KcReadingView[]): boolean {
  return views.some((view) => view.withContentCount > 0);
}

/**
 * 「当前题的知识点原文」快捷入口：复用 excerptFor 的同源判据取最高优先级一条。
 * 没有命中返回 null，调用方隐藏入口而不是显示空卡片。
 */
export function topExcerptLabel(
  pack: MaterialPack,
  concept: KnowledgeConcept | undefined,
  selection: MaterialSelection,
): string | null {
  if (!concept) return null;
  const excerpt = excerptFor(pack, concept, selection);
  return excerpt ? citationLabel(excerpt) : null;
}
