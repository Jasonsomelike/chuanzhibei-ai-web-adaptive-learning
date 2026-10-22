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

/** BM25 参数。k1 控制词频饱和，b 控制长度归一化强度。 */
const K1 = 1.5;
const B = 0.75;

export interface Bm25Index {
  readonly docs: readonly KbDocument[];
  readonly docTokens: readonly string[][];
  readonly docLengths: readonly number[];
  readonly avgLength: number;
  readonly df: ReadonlyMap<string, number>;
}

export function buildIndex(docs: readonly KbDocument[]): Bm25Index {
  const docTokens = docs.map((d) => tokenize(`${d.title} ${d.text}`));
  const docLengths = docTokens.map((t) => t.length);
  const avgLength = docLengths.reduce((a, b) => a + b, 0) / Math.max(1, docLengths.length);

  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  return { docs, docTokens, docLengths, avgLength, df };
}

/**
 * 检索。返回按分数降序的前 k 条。
 * 分数为 0 的文档不返回——宁可不给依据，也不给无关依据。
 */
export function search(index: Bm25Index, query: string, k = 3): RetrievedDoc[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

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
  }

  const ranked = scores
    .map((score, i) => ({ i, score }))
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i))
    .slice(0, k);

  return ranked.map(({ i, score }) => ({
    kcId: index.docs[i].kcId,
    title: index.docs[i].title,
    snippet: index.docs[i].text.slice(0, 160),
    score: Number(score.toFixed(4)),
  }));
}
