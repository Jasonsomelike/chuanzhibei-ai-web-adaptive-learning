/**
 * 混合检索的纯函数层：RRF 融合、相邻切块去重、检索提示文案。
 *
 * 边界：
 * - 只做排序与文案，不发请求、不读存储。BM25 在 rag.ts，向量在 vector.ts，
 *   嵌入向量的获取在调用方。
 * - 所有阈值集中在本模块：调用方从 hybrid 取常量，避免三处各写一个 0.25。
 * - 输出顺序必须确定：RRF 同分按 id 升序，去重保留排名靠前的那一条。
 */

export interface RankedRef {
  readonly id: string;
}

export interface RrfHit {
  readonly id: string;
  readonly score: number;
}

export interface RrfOptions {
  /** RRF 公式里的平滑常数，默认 60；与返回条数无关。 */
  readonly k?: number;
  /** 每路的权重，按 lists 的顺序取；缺省为 1，非正数或非有限值按 0 计。 */
  readonly weights?: readonly number[];
  /** 每路参与融合的最大名次，默认 20（RRF_CANDIDATES）。 */
  readonly candidates?: number;
}

export interface FuseOptions extends RrfOptions {
  /** 返回条数，默认 HYBRID_TOP_K。 */
  readonly topK?: number;
}

export interface FusedHit<T> {
  readonly item: T;
  readonly score: number;
}

/** RRF 平滑常数。60 来自原论文的默认值，rank1 与 rank3 的相对差约 3.2%。 */
export const RRF_K = 60;

/** 每路召回的候选数；向量路取 top-20 再融合，避免长尾噪声占据榜位。 */
export const RRF_CANDIDATES = 20;

/** 融合后的注入条数：3 条依据足够回答，再多只会稀释提示词。 */
export const HYBRID_TOP_K = 3;

/** 低于这个余弦分数视为不相关；与 BM25 的 MIN_SCORE 一样，宁可不给依据。 */
export const VECTOR_MIN_SCORE = 0.25;

/** 相邻切块至少共享这么多码点才算重复，避免把正常的共同短语当成重叠。 */
export const MIN_ADJACENT_OVERLAP = 20;

function safeK(k: number | undefined): number {
  return k !== undefined && Number.isFinite(k) && k > 0 ? k : RRF_K;
}

function safeCandidates(candidates: number | undefined): number {
  return candidates !== undefined && Number.isFinite(candidates) && candidates >= 1
    ? Math.floor(candidates)
    : RRF_CANDIDATES;
}

function weightAt(weights: readonly number[] | undefined, index: number): number {
  const raw = weights?.[index];
  if (raw === undefined) return 1;
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reciprocal Rank Fusion：score(id) = Σ weight_i / (k + rank_i)。
 *
 * - rank 从 1 起，只按名次不看原始分数，BM25 与余弦的尺度差异因此无关紧要；
 * - 同一路里重复出现的 id 只计第一次，名次按去重后的顺序数；
 * - 不返回 0 分的条目：只出现在被权重清零或超出 candidates 名次的条目不会入榜。
 */
export function reciprocalRankFusion(
  lists: readonly (readonly RankedRef[])[],
  opts: RrfOptions = {},
): RrfHit[] {
  const rrfK = safeK(opts.k);
  const candidates = safeCandidates(opts.candidates);
  const scores = new Map<string, number>();

  lists.forEach((list, listIndex) => {
    const weight = weightAt(opts.weights, listIndex);
    if (weight === 0) return;

    const seen = new Set<string>();
    let rank = 0;
    for (const item of list) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rank += 1;
      if (rank > candidates) break;
      scores.set(item.id, (scores.get(item.id) ?? 0) + weight / (rrfK + rank));
    }
  });

  const hits: RrfHit[] = [];
  for (const [id, score] of scores) {
    if (id !== "" && score > 0) hits.push({ id, score });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return compareIds(a.id, b.id);
  });
  return hits;
}

/**
 * 先融合再取前 topK 条，并把原始对象一并带回来。
 *
 * 同一个 id 在多路里出现时取第一次出现的对象（列表顺序优先），
 * 分数仍然合并计算；调用方不需要再按 id 回表。
 */
export function fuseTopK<T extends RankedRef>(
  lists: readonly (readonly T[])[],
  opts: FuseOptions = {},
): FusedHit<T>[] {
  const requested = opts.topK ?? HYBRID_TOP_K;
  const limit = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
  if (limit === 0) return [];

  const firstById = new Map<string, T>();
  for (const list of lists) {
    for (const item of list) {
      if (item.id === "" || firstById.has(item.id)) continue;
      firstById.set(item.id, item);
    }
  }

  const out: FusedHit<T>[] = [];
  for (const hit of reciprocalRankFusion(lists, opts)) {
    const item = firstById.get(hit.id);
    if (item === undefined) continue;
    out.push({ item, score: hit.score });
    if (out.length === limit) break;
  }
  return out;
}

export interface AdjacentChunk {
  readonly id: string;
  readonly docId: string;
  /** 同一文档内的切块序号，从 0 起。 */
  readonly index: number;
  readonly text: string;
}

function codepoints(text: string): string[] {
  return Array.from(text);
}

/** before 的尾部与 after 的头部是否至少有 need 个码点相同。 */
function sharesOverlap(before: string, after: string, need: number): boolean {
  const a = codepoints(before);
  const b = codepoints(after);
  if (a.length < need || b.length < need) return false;
  for (let i = 0; i < need; i += 1) {
    if (a[a.length - need + i] !== b[i]) return false;
  }
  return true;
}

function positionKey(docId: string, index: number): string {
  return `${docId}\u0000${index}`;
}

/**
 * 去掉同一文档里内容重叠的相邻切块。
 *
 * 上传资料按 50 个码点重叠切块（knowledge.ts 的 CHUNK_OVERLAP），
 * 检索同时命中 chunk i 与 i+1 时，注入两份几乎相同的正文只会浪费上下文。
 * 保留输入顺序靠前（排名更高）的那一条，并支持先命中 i+1 再命中 i 的逆序。
 */
export function dedupeAdjacentChunks<T extends AdjacentChunk>(
  chunks: readonly T[],
  minOverlap = MIN_ADJACENT_OVERLAP,
): T[] {
  const need = Number.isFinite(minOverlap) ? Math.max(1, Math.floor(minOverlap)) : MIN_ADJACENT_OVERLAP;

  const kept: T[] = [];
  const byPosition = new Map<string, T>();

  for (const chunk of chunks) {
    const key = positionKey(chunk.docId, chunk.index);
    if (byPosition.has(key)) continue;

    const before = byPosition.get(positionKey(chunk.docId, chunk.index - 1));
    const after = byPosition.get(positionKey(chunk.docId, chunk.index + 1));
    const overlapsBefore = before !== undefined && sharesOverlap(before.text, chunk.text, need);
    const overlapsAfter = after !== undefined && sharesOverlap(chunk.text, after.text, need);
    if (overlapsBefore || overlapsAfter) continue;

    byPosition.set(key, chunk);
    kept.push(chunk);
  }

  return kept;
}

/** 未使用语义检索时的提示；导师页直接展示，null 表示不提。 */
export function retrievalNotice(usedVector: boolean): string | null {
  return usedVector ? null : "本次未使用语义检索（未配置 embedding 模型）";
}
