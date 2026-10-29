/**
 * RAG 检索评测：评测集解析与指标计算。
 *
 * 为什么不复用 rag.ts 的 snippet：
 * search() 返回的 snippet 是 `text.slice(0, 160)`，而 40 篇知识库正文有
 * 230–322 个码点，例题解析大多落在 160 字之后。用 snippet 判「金句是否
 * 被检索到」会把大量真实命中记成未命中——这是上一版评测的 blocker。
 * 这里改为在 top3 文档的**全文**里找 goldPhrase，corpus 由调用方传入完整正文。
 *
 * 这个模块是纯函数：不读文件、不联网、不依赖 kb.ts，评测集与语料都由调用方给。
 */

export const EVAL_CATEGORIES = [
  "literal",
  "paraphrase",
  "answer-absent",
  "out-of-domain",
] as const;

export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export interface EvalItem {
  readonly id: string;
  readonly category: EvalCategory;
  readonly query: string;
  /** 能回答该问题的知识点。answer-absent / out-of-domain 必须为空。 */
  readonly goldKcIds: readonly string[];
  /** 相关但答不上该问题的知识点。answer-absent 必须非空。 */
  readonly relatedKcIds: readonly string[];
  /** 逐字摘自语料正文的金句；literal / paraphrase 必填。 */
  readonly goldPhrase?: string;
}

export class EvalDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalDataError";
  }
}

/** 检索器只需返回按相关度降序的 kcId，BM25、向量、RRF 结果都能直接接入。 */
export interface RankedDocRef {
  readonly kcId: string;
}

export type EvalRetriever = (query: string, k: number) => readonly RankedDocRef[];

export const RECALL_K = 3;
export const MRR_K = 10;

export interface RatioStat {
  /** 分子可能是小数（多 gold 时按每条的召回比例累加）。 */
  readonly numerator: number;
  readonly denominator: number;
  /** 分母为 0 时为 0，避免 NaN 污染报告。 */
  readonly value: number;
}

export type CategoryCounts = Readonly<Record<EvalCategory, number>>;

export interface ItemEvalResult {
  readonly id: string;
  readonly category: EvalCategory;
  /** 前 3 条命中的 kcId，供脚本逐条排查。 */
  readonly top3: readonly string[];
  /** 多 gold 时取「top3 收回的 gold 比例」；无 gold 为 null。 */
  readonly recallAt3: number | null;
  /** 第一个 gold 在 top10 中的名次（1 起）；未命中或没有 gold 为 null。 */
  readonly firstGoldRank: number | null;
  readonly goldPhraseInFullText: boolean | null;
  readonly relatedHit: boolean | null;
  readonly empty: boolean;
}

export interface RetrievalEvalResult {
  readonly total: number;
  readonly counts: CategoryCounts;
  readonly recallAt3: RatioStat;
  readonly recallAt3Literal: RatioStat;
  readonly recallAt3Paraphrase: RatioStat;
  readonly mrrAt10: RatioStat;
  readonly goldPhraseInFullText: RatioStat;
  readonly answerAbsentRelatedHit: RatioStat;
  /** answer-absent 完全检索为空的比例（另一种可接受的拒答形态）。 */
  readonly answerAbsentEmpty: RatioStat;
  readonly outOfDomainEmpty: RatioStat;
  /** out-of-domain 仍然返回了文档的比例，即「把无关内容当成依据」。 */
  readonly outOfDomainFalseContext: RatioStat;
  /** answer-absent ∪ out-of-domain 的总体空检索率。 */
  readonly unanswerableEmpty: RatioStat;
  readonly items: readonly ItemEvalResult[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(lineNo: number, message: string): never {
  throw new EvalDataError(`评测集第 ${lineNo} 行：${message}`);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  lineNo: number,
  required: boolean,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    if (required) fail(lineNo, `缺少字段 ${key}`);
    return undefined;
  }
  if (typeof value !== "string") fail(lineNo, `字段 ${key} 必须是字符串`);
  const trimmed = value.trim();
  // 可选字段的空白值按「未提供」处理，避免空金句混进统计。
  if (trimmed.length === 0) {
    if (required) fail(lineNo, `字段 ${key} 不能为空`);
    return undefined;
  }
  return trimmed;
}

function readIdList(record: Record<string, unknown>, key: string, lineNo: number): string[] {
  const value = record[key];
  if (!Array.isArray(value)) fail(lineNo, `字段 ${key} 必须是字符串数组`);
  const ids: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      fail(lineNo, `字段 ${key} 只能包含非空字符串`);
    }
    const id = raw.trim();
    if (ids.includes(id)) fail(lineNo, `字段 ${key} 中的 ${id} 重复`);
    ids.push(id);
  }
  return ids;
}

/**
 * 解析 JSONL 评测集，并按类别校验字段。
 *
 * 校验规则是评测口径的一部分：
 * - literal / paraphrase：goldKcIds 非空，goldPhrase 非空；
 * - answer-absent：goldKcIds 为空，relatedKcIds 非空；
 * - out-of-domain：goldKcIds 与 relatedKcIds 都为空。
 * id 重复、类型不符、空行以外的坏行都会带上行号报错，避免悄悄少测几条。
 */
export function parseEvalItems(raw: string): EvalItem[] {
  const lines = raw.split(/\r?\n/);
  const items: EvalItem[] = [];
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.trim().length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      fail(lineNo, "不是合法 JSON");
    }
    if (!isRecord(parsed)) fail(lineNo, "每行必须是一个 JSON 对象");

    const id = readString(parsed, "id", lineNo, true) as string;
    if (seen.has(id)) fail(lineNo, `id ${id} 重复`);
    seen.add(id);

    const category = readString(parsed, "category", lineNo, true) as string;
    if (!(EVAL_CATEGORIES as readonly string[]).includes(category)) {
      fail(lineNo, `未知类别 ${category}（可选：${EVAL_CATEGORIES.join(" / ")}）`);
    }

    const query = readString(parsed, "query", lineNo, true) as string;
    const goldKcIds = readIdList(parsed, "goldKcIds", lineNo);
    const relatedKcIds = readIdList(parsed, "relatedKcIds", lineNo);
    const goldPhrase = readString(parsed, "goldPhrase", lineNo, false);

    switch (category as EvalCategory) {
      case "literal":
      case "paraphrase":
        if (goldKcIds.length === 0) fail(lineNo, `${category} 的 goldKcIds 不能为空`);
        if (goldPhrase === undefined) fail(lineNo, `${category} 必须有 goldPhrase`);
        break;
      case "answer-absent":
        if (goldKcIds.length > 0) fail(lineNo, "answer-absent 的 goldKcIds 必须为空");
        if (relatedKcIds.length === 0) fail(lineNo, "answer-absent 的 relatedKcIds 不能为空");
        break;
      case "out-of-domain":
        if (goldKcIds.length > 0) fail(lineNo, "out-of-domain 的 goldKcIds 必须为空");
        if (relatedKcIds.length > 0) fail(lineNo, "out-of-domain 的 relatedKcIds 必须为空");
        break;
    }

    items.push({
      id,
      category: category as EvalCategory,
      query,
      goldKcIds,
      relatedKcIds,
      ...(goldPhrase !== undefined ? { goldPhrase } : {}),
    });
  });

  if (items.length === 0) throw new EvalDataError("评测集为空");
  return items;
}

export function countByCategory(items: readonly EvalItem[]): CategoryCounts {
  const counts: Record<EvalCategory, number> = {
    literal: 0,
    paraphrase: 0,
    "answer-absent": 0,
    "out-of-domain": 0,
  };
  for (const item of items) counts[item.category] += 1;
  return counts;
}

function ratio(numerator: number, denominator: number): RatioStat {
  return { numerator, denominator, value: denominator === 0 ? 0 : numerator / denominator };
}

/**
 * 跑一遍检索并汇总指标。
 *
 * 每条只调用一次 retrieve(query, 10)：前 3 条用于 recall@3 / 金句判定，
 * 完整 10 条用于 MRR@10。默认检索器是分数降序，因此 top10 的前缀就是 top3。
 *
 * goldPhraseInFullText 在 corpus（kcId → 完整正文）里做 includes，
 * 不使用检索结果自带的 160 字 snippet。
 */
export function evaluateRetrieval(
  items: readonly EvalItem[],
  retrieve: EvalRetriever,
  corpus: ReadonlyMap<string, string>,
): RetrievalEvalResult {
  const perItem: ItemEvalResult[] = [];

  let recallSum = 0;
  let literalRecallSum = 0;
  let literalCount = 0;
  let paraphraseRecallSum = 0;
  let paraphraseCount = 0;
  let answerableCount = 0;
  let mrrSum = 0;

  let phraseHits = 0;
  let phraseCount = 0;

  let answerAbsentCount = 0;
  let answerAbsentHitCount = 0;
  let answerAbsentEmptyCount = 0;

  let outOfDomainCount = 0;
  let outOfDomainEmptyCount = 0;

  let unanswerableCount = 0;
  let unanswerableEmptyCount = 0;

  for (const item of items) {
    const ranked = retrieve(item.query, MRR_K);
    const top3 = ranked.slice(0, RECALL_K);
    const top3Ids = top3.map((doc) => doc.kcId);
    const allIds = ranked.map((doc) => doc.kcId);
    const empty = ranked.length === 0;

    let recallAt3: number | null = null;
    let firstGoldRank: number | null = null;
    if (item.goldKcIds.length > 0) {
      const gold = new Set(item.goldKcIds);
      const retrievedGold = new Set(top3Ids.filter((id) => gold.has(id)));
      recallAt3 = retrievedGold.size / gold.size;

      const index = allIds.findIndex((id) => gold.has(id));
      firstGoldRank = index >= 0 ? index + 1 : null;

      recallSum += recallAt3;
      answerableCount += 1;
      mrrSum += firstGoldRank === null ? 0 : 1 / firstGoldRank;

      if (item.category === "literal") {
        literalRecallSum += recallAt3;
        literalCount += 1;
      } else if (item.category === "paraphrase") {
        paraphraseRecallSum += recallAt3;
        paraphraseCount += 1;
      }
    }

    let goldPhraseInFullText: boolean | null = null;
    if (item.goldPhrase !== undefined) {
      let found = false;
      for (const kcId of top3Ids) {
        const text = corpus.get(kcId);
        if (text === undefined) {
          throw new EvalDataError(`检索结果 ${kcId} 不在语料中，无法做全文金句判定`);
        }
        if (text.includes(item.goldPhrase)) {
          found = true;
          break;
        }
      }
      goldPhraseInFullText = found;
      phraseCount += 1;
      if (found) phraseHits += 1;
    }

    let relatedHit: boolean | null = null;
    if (item.category === "answer-absent") {
      answerAbsentCount += 1;
      const related = new Set(item.relatedKcIds);
      relatedHit = top3Ids.some((id) => related.has(id));
      if (relatedHit) answerAbsentHitCount += 1;
      if (empty) answerAbsentEmptyCount += 1;
    }

    if (item.category === "out-of-domain") {
      outOfDomainCount += 1;
      if (empty) outOfDomainEmptyCount += 1;
    }

    if (item.category === "answer-absent" || item.category === "out-of-domain") {
      unanswerableCount += 1;
      if (empty) unanswerableEmptyCount += 1;
    }

    perItem.push({
      id: item.id,
      category: item.category,
      top3: top3Ids,
      recallAt3,
      firstGoldRank,
      goldPhraseInFullText,
      relatedHit,
      empty,
    });
  }

  return {
    total: items.length,
    counts: countByCategory(items),
    recallAt3: ratio(recallSum, answerableCount),
    recallAt3Literal: ratio(literalRecallSum, literalCount),
    recallAt3Paraphrase: ratio(paraphraseRecallSum, paraphraseCount),
    mrrAt10: ratio(mrrSum, answerableCount),
    goldPhraseInFullText: ratio(phraseHits, phraseCount),
    answerAbsentRelatedHit: ratio(answerAbsentHitCount, answerAbsentCount),
    answerAbsentEmpty: ratio(answerAbsentEmptyCount, answerAbsentCount),
    outOfDomainEmpty: ratio(outOfDomainEmptyCount, outOfDomainCount),
    outOfDomainFalseContext: ratio(outOfDomainCount - outOfDomainEmptyCount, outOfDomainCount),
    unanswerableEmpty: ratio(unanswerableEmptyCount, unanswerableCount),
    items: perItem,
  };
}
