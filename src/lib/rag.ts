/**
 * 轻量 RAG：对知识点文档做检索，为导师对话提供依据。
 *
 * 设计取舍（见 research/06-synthesis.md §3.2）：
 * - 不装向量数据库。40 个知识点的文档只有几十 KB，进程内 BM25 足够，
 *   且没有额外运维负担。
 * - 中文用 bigram 切分做 BM25，不引分词库（避免 bundle 膨胀与词典维护）。
 * - 检索结果必须带 kcId，让回答可以引用具体知识点，而不是泛泛而谈。
 *
 * 这个模块是纯函数，不依赖网络，可以在测试里完整验证。
 */

export interface KbDocument {
  readonly kcId: string;
  readonly title: string;
  readonly text: string;
}

export interface RetrievedDoc {
  readonly kcId: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
}

/**
 * 中文 bigram 切分：把「时间复杂度」切成
 * 「时间」「间复」「复杂」「杂度」「度分」「分析」，外加单字。
 *
 * 单字用于兜底（短查询、专有名词），但单字区分度低，检索时会降权，
 * 否则「量子纠缠」里的「子」会命中「二叉树」——这是实测到的噪声。
 */
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[\s\p{P}]+/gu, " ").trim();
  const tokens: string[] = [];

  for (const chunk of normalized.split(" ")) {
    if (chunk.length === 0) continue;
    // 纯 ASCII 词直接作为 token
    if (/^[a-z0-9_]+$/.test(chunk)) {
      tokens.push(chunk);
      continue;
    }
    // 中文：bigram 为主，单字为辅
    for (let i = 0; i < chunk.length; i += 1) {
      if (i + 1 < chunk.length) tokens.push(chunk.slice(i, i + 2));
      tokens.push(chunk[i]);
    }
  }

  return tokens;
}

/**
 * 单字 token 的权重折扣。
 *
 * 中文单字信息量低（「子」「的」「是」到处都是），
 * 与 bigram 同等对待会让检索结果充满噪声。
 * 0.35 是实测出来的值：既保留了短查询的召回，又压住了跨领域误命中。
 */
const SINGLE_CHAR_WEIGHT = 0.35;

/** 低于这个分数视为不相关。宁可不给依据，也不给无关依据。 */
const MIN_SCORE = 0.5;

/**
 * 域外门控。
 *
 * MIN_SCORE 只保证「词面上有命中」，挡不住「红烧肉怎么做才好吃？」这类问题：
 * 疑问句式里的「怎么 / 什么 / 如何」在中文语料里到处都能凑出分数。
 * 门控只问一件事：这条查询里有没有一个承载主题、且语料里真实存在的多字词，
 * 出现在 top1 文档里。疑问词与功能词不算主题词。
 *
 * 判定顺序：
 *   1. 查询里没有语料真实存在的主题词 → 域外，整体清空；
 *   2. 主题词出现在 top1 标题里 → 放行；
 *   3. 主题词出现在正文里，且不是虚词开头的跨词 bigram（「…的路…」）→ 放行。
 *
 * 这样「红黑树和 AVL 树的旋转有什么区别」会通过（avl / 旋转 命中），
 * 「明天上海会下雨吗」「推荐一条北京三日游的路线」会清空，而不会因为查询长、
 * 覆盖率被稀释就把「有相关点但教材没展开」的问题一并清掉。
 */
/** 只出现在句首/词首的虚词：以它们开头的 bigram 多是跨词边界（「…的路…」）。 */
const PARTICLE_START = new Set(['的', '了', '是', '和', '与', '及', '或', '而', '也', '都', '就', '才', '被', '把']);

const GENERIC_QUERY_TOKENS = new Set([
  '什么', '怎么', '怎样', '如何', '为何', '为什', '哪些', '哪个', '多少', '是否',
  '可以', '应该', '需要', '如果', '以及', '因为', '所以', '但是', '而且', '或者',
  '还是', '一样', '这个', '那个', '这些', '那些', '我们', '你们', '他们', '它的',
  '其中', '之间', '之后', '之前', '的话', '相比', '比如', '这种', '一条', '一个',
]);

/** BM25 参数。k1 控制词频饱和，b 控制长度归一化强度。 */
const K1 = 1.5;
const B = 0.75;

export interface Bm25Index {
  readonly docs: readonly KbDocument[];
  readonly docTokens: readonly string[][];
  /** 只含标题的切分，供可选标题加权；默认搜索不读它。 */
  readonly titleTokens: readonly string[][];
  readonly docLengths: readonly number[];
  readonly avgLength: number;
  readonly df: ReadonlyMap<string, number>;
}

export function buildIndex(docs: readonly KbDocument[]): Bm25Index {
  const docTokens = docs.map((d) => tokenize(`${d.title} ${d.text}`));
  const titleTokens = docs.map((d) => tokenize(d.title));
  const docLengths = docTokens.map((t) => t.length);
  const avgLength = docLengths.reduce((a, b) => a + b, 0) / Math.max(1, docLengths.length);

  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  return { docs, docTokens, titleTokens, docLengths, avgLength, df };
}

export interface SearchOptions {
  /**
   * 标题加权倍数，默认 1。
   *
   * 1 表示完全不读 titleTokens——不是「加 0」，而是整段分支都不执行，
   * 保证分数与未加权实现逐位一致。大于 1 时每条命中的标题词额外追加
   * (titleBoost - 1) * idf * tf / (tf + K1)；小于等于 1 或非有限值按 1 处理。
   */
  readonly titleBoost?: number;
}

/**
 * 域外门控：判断这次排序结果值不值得作为依据返回。
 *
 * ranked 是已按分数降序、且已过 MIN_SCORE 的完整候选（还没按 k 截断），
 * 门控要看整条分布，不能只看最后返回的那几条。
 */
function passesRelevanceGate(
  index: Bm25Index,
  qTokens: readonly string[],
  ranked: readonly { readonly i: number; readonly score: number }[],
): boolean {
  if (ranked.length === 0) return false;

  const multiTokens = [...new Set(qTokens)].filter((token) => token.length > 1);
  // 纯单字查询（「栈」「树」）没有主题词可判，交给 MIN_SCORE。
  if (multiTokens.length === 0) return true;

  const topTitle = new Set(index.titleTokens[ranked[0].i]);
  const topTokens = new Set(index.docTokens[ranked[0].i]);
  const contentTokens = multiTokens.filter(
    (token) => !GENERIC_QUERY_TOKENS.has(token) && (index.df.get(token) ?? 0) > 0,
  );
  // 查询里没有一个语料真实存在的主题词：这是域外问题，整体清空。
  if (contentTokens.length === 0) return false;
  // 标题命中，或「正文命中且这个词至少出现在 2 篇文档里」。
  // 后者挡的是「推荐一条北京三日游的路线」里的跨词 bigram「的路」：
  // 它只在某一篇正文里出现一次，不能证明这篇文档在讲同一件事。
  return contentTokens.some(
    (token) => topTitle.has(token) || (topTokens.has(token) && !PARTICLE_START.has(token[0])),
  );
}

/**
 * 检索。返回按分数降序的前 k 条。
 * 分数为 0 的文档不返回——宁可不给依据，也不给无关依据。
 * 过了 MIN_SCORE 但没过域外门控时整体返回 []，不返回「最不跑题」的那几条。
 */
export function search(
  index: Bm25Index,
  query: string,
  k = 3,
  opts: SearchOptions = {},
): RetrievedDoc[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const rawBoost = opts.titleBoost ?? 1;
  const titleBoost = Number.isFinite(rawBoost) && rawBoost > 1 ? rawBoost : 1;
  const useTitleBoost = titleBoost > 1;

  const n = index.docs.length;
  const scores: number[] = new Array(n).fill(0);

  for (const q of new Set(qTokens)) {
    const dfq = index.df.get(q);
    if (!dfq) continue;
    // BM25 的 IDF（加 1 防止负值）
    const idf = Math.log(1 + (n - dfq + 0.5) / (dfq + 0.5));
    // 单字降权：区分度低，不加权会淹没 bigram 的贡献
    const weight = q.length === 1 ? SINGLE_CHAR_WEIGHT : 1;

    for (let i = 0; i < n; i += 1) {
      const tokens = index.docTokens[i];
      const tf = tokens.filter((t) => t === q).length;
      if (tf === 0) continue;
      const lenNorm = 1 - B + (B * index.docLengths[i]) / index.avgLength;
      scores[i] += weight * idf * ((tf * (K1 + 1)) / (tf + K1 * lenNorm));
    }

    // 标题加权只做加法追加，不改变上面的任何一项，默认路径与旧实现逐位一致。
    if (useTitleBoost) {
      for (let i = 0; i < n; i += 1) {
        const titleTf = index.titleTokens[i].filter((t) => t === q).length;
        if (titleTf === 0) continue;
        scores[i] += (titleBoost - 1) * idf * (titleTf / (titleTf + K1));
      }
    }
  }

  const ranked = scores
    .map((score, i) => ({ i, score }))
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i));

  // 门控在截断之前看完整候选分布；没过门控就整体清空，不挑「最像」的几条。
  if (!passesRelevanceGate(index, qTokens, ranked)) return [];

  return ranked.slice(0, k).map(({ i, score }) => ({
    kcId: index.docs[i].kcId,
    title: index.docs[i].title,
    snippet: index.docs[i].text.slice(0, 160),
    score: Number(score.toFixed(4)),
  }));
}
