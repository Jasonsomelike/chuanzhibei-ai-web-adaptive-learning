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
 * 疑问句式里的「怎么 / 什么 / 如何」在中文语料里到处都能凑出分数，
 * 于是域外问题也会拿到 3 条带引用的知识点。退出前再看三件事：
 *   1. top1 相对候选分数中位数——分布是否真的有峰，而不是一堆同分噪声；
 *   2. top1 对查询非单字词的覆盖率——是否真的在讲同一件事；
 *   3. 命中的不同非单字词个数——避免单个「怎么」把整条查询带进来。
 *
 * 查询里没有非单字词（「栈」「树」）时跳过覆盖率与中位数判断：
 * 单字查询本来就宽，拿中位数去卡只会误杀合法短查询。
 * 查询只有一个非单字词时同样不卡中位数——命中的文档都同样切题；
 * 命中数按「至少一半、最多 2 个」要求，避免「平衡树」这种两个 bigram
 * 里有一个是跨词边界的查询被误杀。
 */
const GATE_MIN_TOP_MEDIAN_RATIO = 1.2;
const GATE_MIN_COVERAGE = 0.2;
const GATE_MIN_MULTI_HITS = 2;
/** 候选少于 3 条时中位数没有区分力（可能等于 top1 本身），跳过该条件。 */
const GATE_MIN_POOL_FOR_MEDIAN = 3;

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
  if (multiTokens.length === 0) return true;

  const topTokens = new Set(index.docTokens[ranked[0].i]);
  const hits = multiTokens.filter((token) => topTokens.has(token)).length;

  if (hits / multiTokens.length < GATE_MIN_COVERAGE) return false;
  /*
   * 「至少 2 个非单字命中」是对长查询的锚点要求。查询本身只有两个
   * 非单字词时（「平衡树」→ 平衡 / 衡树），要求 2 个可能超过真实词形覆盖，
   * 按「至少一半」放宽，避免把正常短查询整体清空。
   */
  const requiredHits = Math.min(GATE_MIN_MULTI_HITS, Math.ceil(multiTokens.length / 2));
  if (hits < requiredHits) return false;

  // 只有一个非单字词时，命中该词的文档同样切题，中位数没有区分意义。
  if (multiTokens.length >= 2 && ranked.length >= GATE_MIN_POOL_FOR_MEDIAN) {
    const sorted = ranked.map((item) => item.score).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (ranked[0].score < median * GATE_MIN_TOP_MEDIAN_RATIO) return false;
  }

  return true;
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
