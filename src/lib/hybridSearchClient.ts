/**
 * 混合检索：BM25 + 向量召回，用 RRF 融合后取前 k 条。
 *
 * 边界：
 * - 排序与融合的纯函数在 hybrid.ts / vector.ts / rag.ts；本文件只负责
 *   「什么时候取向量、两路怎么合并、缺向量时怎么退化」。
 * - 向量表由调用方准备（vectorCache.ensureVectors），这里不读存储、不写缓存；
 *   查询向量通过注入的 embed 获取（embeddingClient.embedTexts 的适配）。
 * - 任意一路为空都不算错误：两路皆空返回 []，向量不可用只退回 BM25，
 *   并用 retrievalNotice(false) 说明「本次未使用语义检索」。
 * - usedVector 表示「语义检索真的参与了排序」，不是「向量路有命中」：
 *   查询向量拿到了、索引里也有向量，即使没有一条过阈值，也算用过语义检索。
 */

import {
  RRF_CANDIDATES,
  RRF_K,
  VECTOR_MIN_SCORE,
  dedupeAdjacentChunks,
  reciprocalRankFusion,
  retrievalNotice,
  type AdjacentChunk,
} from "@/lib/hybrid";
import type { UploadChunk, UploadHit } from "@/lib/knowledge";
import type { EmbeddingResult } from "@/lib/embeddingClient";
import { buildIndex, search, type Bm25Index } from "@/lib/rag";
import { isValidVector, topKNormalized } from "@/lib/vector";

/** BM25 召回条数。与向量路一致，避免某一路用长尾挤掉另一路的头部。 */
export const HYBRID_BM25_CANDIDATES = 20;

/** 向量召回条数。 */
export const HYBRID_VECTOR_CANDIDATES = 20;

/** 默认注入条数。 */
export const HYBRID_DEFAULT_TOP_K = 3;

/** 参与检索的文档：必须带文档内序号，才能做相邻切块去重。 */
export interface HybridDoc extends AdjacentChunk {
  /** 展示标题；缺省退回正文前 60 个字符。 */
  readonly title?: string;
}

/** 查询嵌入：返回 null 表示这次没有向量能力。 */
export type EmbedQuery = (texts: readonly string[]) => Promise<EmbeddingResult | null>;

export interface RetrieverOptions<T extends HybridDoc> {
  readonly docs: readonly T[];
  /** 文档 id → 向量；只包含已缓存/刚嵌入的条目，可以小于 docs。 */
  readonly vectors: ReadonlyMap<string, Float32Array>;
  /** 向量模型名；空串表示没有配置向量能力。 */
  readonly model: string;
  readonly embed: EmbedQuery;
  /** 去同一文档内内容重叠的相邻切块，默认关。上传资料应打开。 */
  readonly dedupeAdjacent?: boolean;
}

export interface HybridHit<T extends HybridDoc> {
  readonly doc: T;
  readonly score: number;
}

export interface HybridRetrieval<T extends HybridDoc> {
  readonly hits: readonly HybridHit<T>[];
  /** 语义检索是否参与了排序。 */
  readonly usedVector: boolean;
  /** 未使用语义检索时的说明；使用了为 null。 */
  readonly notice: string | null;
}

export interface Retriever<T extends HybridDoc> {
  retrieve(query: string, k?: number): Promise<HybridRetrieval<T>>;
}

function titleOf(doc: HybridDoc): string {
  const title = doc.title?.trim() ?? "";
  if (title !== "") return title;
  return doc.text.trim().slice(0, 60);
}

/**
 * 用查询文本取查询向量。
 * embed 约定不抛错；仍然包一层，避免一个实现异常把整次问答打断。
 */
async function queryVector(
  embed: EmbedQuery,
  query: string,
  model: string,
): Promise<Float32Array | null> {
  try {
    const embedded = await embed([query]);
    if (embedded === null) return null;
    const embeddedModel = embedded.model.trim();
    if (embeddedModel !== "" && embeddedModel !== model) return null;
    const first = embedded.vectors[0];
    if (first === undefined) return null;
    const vector = Float32Array.from(first);
    return isValidVector(vector, embedded.dim > 0 ? embedded.dim : undefined) ? vector : null;
  } catch {
    return null;
  }
}

export function createRetriever<T extends HybridDoc>(options: RetrieverOptions<T>): Retriever<T> {
  const index: Bm25Index = buildIndex(
    options.docs.map((doc) => ({ kcId: doc.id, title: titleOf(doc), text: doc.text })),
  );
  const byId = new Map(options.docs.map((doc) => [doc.id, doc] as const));
  const model = options.model.trim();

  return {
    async retrieve(query, k = HYBRID_DEFAULT_TOP_K) {
      const limit = Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 0;
      const hasVectors = model !== "" && options.vectors.size > 0;

      const bm25 = search(index, query, HYBRID_BM25_CANDIDATES)
        .filter((hit) => byId.has(hit.kcId))
        .map((hit) => ({ id: hit.kcId }));

      let vectorHits: { id: string }[] = [];
      let usedVector = false;
      if (hasVectors) {
        const vector = await queryVector(options.embed, query, model);
        if (vector !== null) {
          usedVector = true;
          vectorHits = topKNormalized(
            vector,
            options.vectors,
            HYBRID_VECTOR_CANDIDATES,
            // 与 hybrid.ts 的阈值同源，避免这里另写一个 0.25
            VECTOR_MIN_SCORE,
          ).map((hit) => ({ id: hit.id }));
        }
      }

      const empty = { hits: [] as HybridHit<T>[], usedVector, notice: retrievalNotice(usedVector) };
      if (limit === 0) return empty;
      if (bm25.length === 0 && vectorHits.length === 0) return empty;

      const fused = reciprocalRankFusion([bm25, vectorHits], {
        k: RRF_K,
        weights: [1, 1],
        candidates: RRF_CANDIDATES,
      });

      let ordered: HybridHit<T>[] = [];
      for (const hit of fused) {
        const doc = byId.get(hit.id);
        if (doc !== undefined) ordered.push({ doc, score: hit.score });
      }

      if (options.dedupeAdjacent) {
        const scoreById = new Map(ordered.map((hit) => [hit.doc.id, hit.score] as const));
        ordered = dedupeAdjacentChunks(ordered.map((hit) => hit.doc)).map((doc) => ({
          doc,
          score: scoreById.get(doc.id) ?? 0,
        }));
      }

      return {
        hits: ordered.slice(0, limit),
        usedVector,
        notice: retrievalNotice(usedVector),
      };
    },
  };
}

/**
 * UploadChunk → 检索文档。id 就是 chunk.id，回答里的 [资料n] 仍按命中顺序编号。
 */
export function hybridDocsFromChunks(chunks: readonly UploadChunk[]): HybridDoc[] {
  return chunks.map((chunk) => ({
    id: chunk.id,
    docId: chunk.docId,
    index: chunk.index,
    text: chunk.text,
    title: chunk.title,
  }));
}

export interface UploadHybridRetrieval {
  readonly hits: readonly UploadHit[];
  readonly usedVector: boolean;
  readonly notice: string | null;
}

/**
 * 上传资料的混合检索。把融合结果的 doc.id 映射回原始片段；
 * 相邻切块去重由 retriever 的 dedupeAdjacent 选项负责（上传资料应打开）。
 * 映射不到的 id 直接跳过——宁可不给依据，也不给一条对不上原文的引用。
 */
export async function retrieveUploadsHybrid(
  retriever: Retriever<HybridDoc>,
  chunks: readonly UploadChunk[],
  query: string,
  k: number = HYBRID_DEFAULT_TOP_K,
): Promise<UploadHybridRetrieval> {
  const result = await retriever.retrieve(query, k);
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk] as const));

  const hits: UploadHit[] = [];
  for (const hit of result.hits) {
    const chunk = byId.get(hit.doc.id);
    if (chunk !== undefined) hits.push({ chunk, score: hit.score });
  }

  return { hits, usedVector: result.usedVector, notice: result.notice };
}
