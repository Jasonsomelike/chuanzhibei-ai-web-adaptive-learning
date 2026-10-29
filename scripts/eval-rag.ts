/**
 * RAG 检索评测脚本。
 *
 * 用法：
 *   npm run eval:rag                       # BM25 基线 + title 加权；有向量来源时附混合列
 *   npm run eval:rag -- --title-boost 3    # 调整标题词频放大倍数（默认 2）
 *   npm run eval:rag -- --mode hybrid --vectors scripts/eval-data/vectors.json
 *
 * 混合检索的来源二选一：
 *   1. --vectors <json>：{ "documents": { "c01": [...] }, "queries": { "lit-01": [...] } }
 *      queries 可省略，此时剩余的查询向量用 embedding 端点补算；
 *   2. ALP_EMBED_BASE_URL / ALP_EMBED_API_KEY / ALP_EMBED_MODEL 三个环境变量。
 * 两者都没有时打印「混合检索：未测」并以 0 退出——没测就是没测，不编数字。
 *
 * 退出码：0 = 跑完（含未测混合）；1 = 评测集/运行错误。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { kbDocuments } from "@/data/kb";
import { RRF_K, VECTOR_MIN_SCORE, reciprocalRankFusion } from "@/lib/hybrid";
import { buildIndex, search, type Bm25Index } from "@/lib/rag";
import { topKNormalized } from "@/lib/vector";
import {
  countByCategory,
  evaluateRetrieval,
  parseEvalItems,
  type EvalItem,
  type EvalRetriever,
  type RatioStat,
  type RetrievalEvalResult,
} from "@/lib/ragEval";

// tsx 不会自动读取 .env.local；不先加载，ALP_EMBED_* 永远读不到。
try {
  process.loadEnvFile(".env.local");
} catch {
  // 文件不存在或运行环境不支持时继续：变量也可能由 shell 直接提供。
}

const EVAL_DATA_URL = new URL("./eval-data/rag-eval-50.jsonl", import.meta.url);
const EXPECTED_TOTAL = 50;
const EXPECTED_COUNTS = {
  literal: 15,
  paraphrase: 15,
  "answer-absent": 10,
  "out-of-domain": 10,
} as const;

const EMBED_BATCH_SIZE = 32;

interface ScriptArgs {
  readonly mode: "auto" | "hybrid";
  readonly titleBoost: number;
  readonly vectorsPath: string | null;
  readonly verbose: boolean;
}

interface EmbeddingConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

interface VectorFile {
  readonly documents: Map<string, readonly number[]>;
  readonly queries: Map<string, readonly number[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTitleBoost(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new Error(`--title-boost 需要 1–10 的整数，收到 ${raw}`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): ScriptArgs {
  let mode: ScriptArgs["mode"] = "auto";
  let titleBoost = 2;
  let vectorsPath: string | null = null;
  let verbose = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--mode") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--mode 需要值（hybrid）");
      if (value !== "hybrid") throw new Error(`不支持的 --mode：${value}（目前只有 hybrid）`);
      mode = "hybrid";
      i += 1;
    } else if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (value !== "hybrid") throw new Error(`不支持的 --mode：${value}（目前只有 hybrid）`);
      mode = "hybrid";
    } else if (arg === "--title-boost") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--title-boost 需要数字");
      titleBoost = parseTitleBoost(value);
      i += 1;
    } else if (arg.startsWith("--title-boost=")) {
      titleBoost = parseTitleBoost(arg.slice("--title-boost=".length));
    } else if (arg === "--vectors") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--vectors 需要文件路径");
      vectorsPath = value;
      i += 1;
    } else if (arg.startsWith("--vectors=")) {
      const value = arg.slice("--vectors=".length);
      if (value.length === 0) throw new Error("--vectors 需要文件路径");
      vectorsPath = value;
    } else if (arg === "--verbose") {
      verbose = true;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  return { mode, titleBoost, vectorsPath, verbose };
}

function loadItems(): EvalItem[] {
  const items = parseEvalItems(readFileSync(EVAL_DATA_URL, "utf8"));
  const problems: string[] = [];
  const counts = countByCategory(items);

  if (items.length !== EXPECTED_TOTAL) {
    problems.push(`期望 ${EXPECTED_TOTAL} 条，实际 ${items.length} 条`);
  }
  for (const [category, expected] of Object.entries(EXPECTED_COUNTS)) {
    const actual = counts[category as keyof typeof EXPECTED_COUNTS];
    if (actual !== expected) {
      problems.push(`${category} 期望 ${expected} 条，实际 ${actual} 条`);
    }
  }

  const docsById = new Map(kbDocuments.map((doc) => [doc.kcId, doc]));
  if (docsById.size !== 40) problems.push(`kbDocuments 期望 40 篇，实际 ${docsById.size} 篇`);

  for (const item of items) {
    for (const kcId of [...item.goldKcIds, ...item.relatedKcIds]) {
      if (!docsById.has(kcId)) problems.push(`${item.id}：知识点 ${kcId} 不在 kbDocuments 中`);
    }
    const phrase = item.goldPhrase;
    if (phrase !== undefined) {
      const goldTexts = item.goldKcIds.map((kcId) => docsById.get(kcId)?.text ?? "");
      if (!goldTexts.some((text) => text.includes(phrase))) {
        problems.push(`${item.id}：goldPhrase 不是 goldKcIds 正文的逐字子串`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`评测集校验失败：\n  - ${problems.join("\n  - ")}`);
  }
  return items;
}

function buildCorpus(): ReadonlyMap<string, string> {
  return new Map(kbDocuments.map((doc) => [doc.kcId, `${doc.title}\n${doc.text}`]));
}

function bm25Retriever(index: Bm25Index, titleBoost = 1): EvalRetriever {
  return (query, k) => search(index, query, k, { titleBoost });
}

function readEmbeddingConfig(): EmbeddingConfig | null {
  const baseUrl = process.env.ALP_EMBED_BASE_URL?.trim() ?? "";
  const apiKey = process.env.ALP_EMBED_API_KEY?.trim() ?? "";
  const model = process.env.ALP_EMBED_MODEL?.trim() ?? "";
  if (baseUrl.length === 0 || apiKey.length === 0 || model.length === 0) return null;
  return { baseUrl, apiKey, model };
}

function parseVectorMap(value: unknown, label: string): Map<string, readonly number[]> {
  if (!isRecord(value)) {
    throw new Error(`向量文件字段 ${label} 必须是对象：{ "kcId": [数字...] }`);
  }
  const map = new Map<string, readonly number[]>();
  for (const [key, raw] of Object.entries(value)) {
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      !raw.every((x) => typeof x === "number" && Number.isFinite(x))
    ) {
      throw new Error(`向量文件 ${label}.${key} 必须是非空有限数字数组`);
    }
    map.set(key, raw as number[]);
  }
  return map;
}

function loadVectorFile(path: string): VectorFile {
  const fullPath = resolve(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`读取向量文件失败（${fullPath}）：${reason}`);
  }
  if (!isRecord(parsed)) throw new Error("向量文件顶层必须是 JSON 对象");

  const documents = parseVectorMap(parsed.documents, "documents");
  if (documents.size === 0) throw new Error("向量文件的 documents 不能为空");
  const queries =
    parsed.queries === undefined
      ? new Map<string, readonly number[]>()
      : parseVectorMap(parsed.queries, "queries");
  return { documents, queries };
}

async function embedBatch(config: EmbeddingConfig, texts: readonly string[]): Promise<number[][]> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/embeddings`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input: texts }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`embedding 请求失败（${endpoint}）：${reason}`);
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`embedding 请求失败：HTTP ${response.status} ${bodyText.slice(0, 300)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error("embedding 响应不是合法 JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.data)) {
    throw new Error("embedding 响应缺少 data 数组");
  }
  const data = parsed.data;
  if (data.length !== texts.length) {
    throw new Error(`embedding 返回 ${data.length} 条，期望 ${texts.length} 条`);
  }

  const vectors: Array<number[] | undefined> = new Array(data.length);
  data.forEach((row, rowIndex) => {
    if (!isRecord(row) || !Array.isArray(row.embedding)) {
      throw new Error(`embedding 第 ${rowIndex} 条缺少 embedding 数组`);
    }
    const embedding = row.embedding;
    if (
      embedding.length === 0 ||
      !embedding.every((x) => typeof x === "number" && Number.isFinite(x))
    ) {
      throw new Error(`embedding 第 ${rowIndex} 条不是非空有限数字数组`);
    }
    const position = typeof row.index === "number" ? row.index : rowIndex;
    if (!Number.isInteger(position) || position < 0 || position >= data.length) {
      throw new Error(`embedding 第 ${rowIndex} 条的 index 非法：${String(row.index)}`);
    }
    vectors[position] = embedding as number[];
  });
  if (vectors.some((vector) => vector === undefined)) {
    throw new Error("embedding 响应的 index 不完整");
  }
  return vectors as number[][];
}

async function embedAll(config: EmbeddingConfig, texts: readonly string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    vectors.push(...(await embedBatch(config, texts.slice(start, start + EMBED_BATCH_SIZE))));
  }
  return vectors;
}

/**
 * 构造混合检索器：BM25 top-k 与向量 top-k 做 RRF。
 * 返回 null 表示既没有 --vectors 也没有 embedding 配置。
 */
async function buildHybridRetriever(
  args: ScriptArgs,
  items: readonly EvalItem[],
  corpus: ReadonlyMap<string, string>,
  baselineIndex: Bm25Index,
): Promise<EvalRetriever | null> {
  const config = readEmbeddingConfig();
  if (args.vectorsPath === null && config === null) return null;

  let documentVectors: Map<string, readonly number[]>;
  let queryVectors: Map<string, readonly number[]>;
  if (args.vectorsPath !== null) {
    const loaded = loadVectorFile(args.vectorsPath);
    documentVectors = new Map(loaded.documents);
    queryVectors = new Map(loaded.queries);
  } else {
    documentVectors = new Map();
    queryVectors = new Map();
  }

  if (config !== null) {
    const missingDocs = kbDocuments.filter((doc) => !documentVectors.has(doc.kcId));
    if (missingDocs.length > 0) {
      const texts = missingDocs.map((doc) => corpus.get(doc.kcId) ?? `${doc.title}\n${doc.text}`);
      const embedded = await embedAll(config, texts);
      missingDocs.forEach((doc, index) => documentVectors.set(doc.kcId, embedded[index]));
    }

    const missingItems = items.filter((item) => !queryVectors.has(item.id));
    if (missingItems.length > 0) {
      const embedded = await embedAll(
        config,
        missingItems.map((item) => item.query),
      );
      missingItems.forEach((item, index) => queryVectors.set(item.id, embedded[index]));
    }
  }

  const missingDocIds = kbDocuments
    .filter((doc) => !documentVectors.has(doc.kcId))
    .map((doc) => doc.kcId);
  if (missingDocIds.length > 0) {
    throw new Error(
      `缺少 ${missingDocIds.length} 篇文档向量（${missingDocIds.join(", ")}）；` +
        "请补全 --vectors 的 documents，或配置 ALP_EMBED_BASE_URL / ALP_EMBED_API_KEY / ALP_EMBED_MODEL",
    );
  }

  const missingQueryIds = items.filter((item) => !queryVectors.has(item.id)).map((item) => item.id);
  if (missingQueryIds.length > 0) {
    throw new Error(
      `缺少 ${missingQueryIds.length} 条查询向量（${missingQueryIds.join(", ")}）；` +
        "请补全 --vectors 的 queries，或配置 ALP_EMBED_*",
    );
  }

  const documentVectorIndex = new Map<string, Float32Array>();
  for (const doc of kbDocuments) {
    const vector = documentVectors.get(doc.kcId);
    if (vector === undefined) throw new Error(`缺少文档向量：${doc.kcId}`);
    documentVectorIndex.set(doc.kcId, Float32Array.from(vector));
  }

  const dimension = documentVectorIndex.get(kbDocuments[0].kcId)?.length ?? 0;
  for (const [kcId, vector] of documentVectorIndex) {
    if (vector.length !== dimension) {
      throw new Error(`文档 ${kcId} 的向量维度 ${vector.length} 与 ${dimension} 不一致`);
    }
  }

  // evaluateRetrieval 只把 query 文本传进来，这里按文本绑定已算好的查询向量。
  const queryVectorByText = new Map<string, Float32Array>();
  for (const item of items) {
    const vector = queryVectors.get(item.id);
    if (vector === undefined) throw new Error(`缺少查询向量：${item.id}`);
    if (vector.length !== dimension) {
      throw new Error(`查询 ${item.id} 的向量维度 ${vector.length} 与文档维度 ${dimension} 不一致`);
    }
    if (queryVectorByText.has(item.query)) {
      throw new Error(`评测集中 query 文本重复，无法按文本绑定向量：${item.query}`);
    }
    queryVectorByText.set(item.query, Float32Array.from(vector));
  }

  return (query, k) => {
    const queryVector = queryVectorByText.get(query);
    if (queryVector === undefined) throw new Error(`没有查询「${query}」的向量`);

    const lexical = search(baselineIndex, query, k).map((doc) => ({ id: doc.kcId }));
    // 与生产检索同一口径：低于 VECTOR_MIN_SCORE 的向量结果不进融合，不凑满 k 条。
    const vectorHits = topKNormalized(queryVector, documentVectorIndex, k, VECTOR_MIN_SCORE);
    const fused = reciprocalRankFusion(
      [lexical, vectorHits.map((hit) => ({ id: hit.id }))],
      { k: RRF_K, candidates: k },
    );
    return fused.slice(0, k).map((hit) => ({ kcId: hit.id }));
  };
}

/**
 * 质量门槛。
 *
 * 只打印指标、永远 exit 0 的评测等于没有评测：检索退化或换了 chunk 参数都不会红。
 * 阈值取设计文档 §10.4 的发布线；混合检索只在真的测到向量时才判（否则会把
 * 「没配 embedding」当成失败）。
 */
const GATE_RECALL_AT_3 = 0.9;
const GATE_GOLD_PHRASE = 0.95;

function checkGate(label: string, result: RetrievalEvalResult): boolean {
  const failures: string[] = [];
  if (result.recallAt3.value < GATE_RECALL_AT_3) {
    failures.push(`recall@3 ${result.recallAt3.value.toFixed(3)} < ${GATE_RECALL_AT_3}`);
  }
  if (result.goldPhraseInFullText.value < GATE_GOLD_PHRASE) {
    failures.push(`金句命中 ${result.goldPhraseInFullText.value.toFixed(3)} < ${GATE_GOLD_PHRASE}`);
  }
  if (failures.length === 0) return true;
  console.log(`GATE 未通过（${label}）：${failures.join("；")}`);
  return false;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatRatio(stat: RatioStat): string {
  return `${stat.value.toFixed(3)}（${formatNumber(stat.numerator)}/${stat.denominator}）`;
}

function printReport(label: string, result: RetrievalEvalResult, verbose: boolean): void {
  console.log(`\n[${label}]`);
  console.log(
    `  recall@3                 ${formatRatio(result.recallAt3)}` +
      `   字面 ${formatRatio(result.recallAt3Literal)} / 同义 ${formatRatio(result.recallAt3Paraphrase)}`,
  );
  console.log(`  MRR@10                   ${formatRatio(result.mrrAt10)}`);
  console.log(`  goldPhraseInFullText     ${formatRatio(result.goldPhraseInFullText)}`);
  console.log(`  answer-absent relatedHitRate   ${formatRatio(result.answerAbsentRelatedHit)}`);
  console.log(
    `  out-of-domain emptyRate        ${formatRatio(result.outOfDomainEmpty)}` +
      `   falseContextRate ${formatRatio(result.outOfDomainFalseContext)}`,
  );
  console.log(`  unanswerableEmptyRate    ${formatRatio(result.unanswerableEmpty)}   （answer-absent ∪ out-of-domain）`);

  if (verbose) {
    console.log("  逐条结果：");
    for (const row of result.items) {
      const recall = row.recallAt3 === null ? "-" : row.recallAt3.toFixed(2);
      const rank = row.firstGoldRank === null ? "-" : String(row.firstGoldRank);
      const phrase =
        row.goldPhraseInFullText === null ? "-" : row.goldPhraseInFullText ? "hit" : "miss";
      const related = row.relatedHit === null ? "-" : row.relatedHit ? "hit" : "miss";
      console.log(
        `    ${row.id.padEnd(8)} ${row.category.padEnd(13)} ` +
          `top3=[${row.top3.join(", ")}] recall=${recall} rank=${rank} phrase=${phrase} related=${related}`,
      );
    }
  }
}

interface Variant {
  readonly label: string;
  readonly result: RetrievalEvalResult;
}

const COMPARISON_METRICS: ReadonlyArray<{
  readonly label: string;
  readonly value: (result: RetrievalEvalResult) => string;
}> = [
  { label: "recall@3", value: (r) => r.recallAt3.value.toFixed(3) },
  { label: "recall@3 literal", value: (r) => r.recallAt3Literal.value.toFixed(3) },
  { label: "recall@3 paraphrase", value: (r) => r.recallAt3Paraphrase.value.toFixed(3) },
  { label: "MRR@10", value: (r) => r.mrrAt10.value.toFixed(3) },
  { label: "goldPhraseInFullText", value: (r) => r.goldPhraseInFullText.value.toFixed(3) },
  { label: "answer-absent relatedHit", value: (r) => r.answerAbsentRelatedHit.value.toFixed(3) },
  { label: "out-of-domain empty", value: (r) => r.outOfDomainEmpty.value.toFixed(3) },
  { label: "out-of-domain falseContext", value: (r) => r.outOfDomainFalseContext.value.toFixed(3) },
  { label: "unanswerableEmpty", value: (r) => r.unanswerableEmpty.value.toFixed(3) },
];

/** 两列（或三列）横向对比；标签都是 ASCII，终端里能对齐。 */
function printComparison(variants: readonly Variant[]): void {
  if (variants.length === 0) return;
  const metricWidth = Math.max(...COMPARISON_METRICS.map((metric) => metric.label.length)) + 2;
  const columnWidth = 12;

  console.log("\n对比（列 = 检索配置，值 = 指标）");
  console.log(
    "metric".padEnd(metricWidth) +
      variants.map((variant) => variant.label.padEnd(columnWidth)).join(""),
  );
  for (const metric of COMPARISON_METRICS) {
    console.log(
      metric.label.padEnd(metricWidth) +
        variants.map((variant) => metric.value(variant.result).padEnd(columnWidth)).join(""),
    );
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const items = loadItems();
  const corpus = buildCorpus();
  const counts = countByCategory(items);
  const index = buildIndex(kbDocuments);

  console.log("RAG 检索评测");
  console.log("═".repeat(72));
  console.log(`评测集：scripts/eval-data/rag-eval-50.jsonl（${items.length} 条）`);
  console.log(
    `分类：literal ${counts.literal} / paraphrase ${counts.paraphrase} / ` +
      `answer-absent ${counts["answer-absent"]} / out-of-domain ${counts["out-of-domain"]}`,
  );
  console.log(`语料：kbDocuments ${kbDocuments.length} 篇完整正文（title+text）；金句在 top3 全文判定`);
  console.log(`模式：${args.mode}；title 加权 ×${args.titleBoost}`);

  const baseline = evaluateRetrieval(items, bm25Retriever(index, 1), corpus);
  printReport("BM25 基线", baseline, args.verbose);
  const variants: Variant[] = [{ label: "BM25", result: baseline }];

  if (args.titleBoost > 1) {
    const boosted = evaluateRetrieval(items, bm25Retriever(index, args.titleBoost), corpus);
    printReport(`BM25 + title×${args.titleBoost}`, boosted, args.verbose);
    variants.push({ label: `title×${args.titleBoost}`, result: boosted });
  }

  const hybrid = await buildHybridRetriever(args, items, corpus, index);
  if (hybrid === null) {
    console.log(
      "\n混合检索：未测（未提供 --vectors，且未配置 " +
        "ALP_EMBED_BASE_URL / ALP_EMBED_API_KEY / ALP_EMBED_MODEL）",
    );
    printComparison(variants);
    return checkGate("BM25 基线", baseline) ? 0 : 1;
  }

  const hybridResult = evaluateRetrieval(items, hybrid, corpus);
  printReport(`BM25 + 向量 RRF（k=${RRF_K}）`, hybridResult, args.verbose);
  variants.push({ label: "hybrid RRF", result: hybridResult });
  printComparison(variants);
  const gateOk = checkGate("BM25 基线", baseline) && checkGate("hybrid RRF", hybridResult);
  return gateOk ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`\nFAIL ${message}`);
  process.exitCode = 1;
}
