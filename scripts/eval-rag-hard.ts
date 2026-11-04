/** 人工标注的片段级歧义/否定/迁移查询，不把知识点级命中当成原文命中。 */
import { readFileSync } from "node:fs";
import { MATERIAL_PACKS } from "../src/data/materials/index";
import { buildIndex, search } from "../src/lib/rag";

interface Case { id: string; query: string; gold: string[] }
const cases = readFileSync(new URL("./eval-data/rag-hard.jsonl", import.meta.url), "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line) as Case);
const corpus = MATERIAL_PACKS.flatMap((pack) => pack.chunks.map((chunk) => ({ kcId: chunk.id, title: chunk.section, text: chunk.text })));
const ids = new Set(corpus.map((doc) => doc.kcId));
for (const item of cases) {
  if (!item.id || !item.query || item.gold.some((id) => !ids.has(id))) throw new Error(`评测标注不合法：${item.id}`);
}
const arms = [
  { name: "无检索", rank: (_query: string) => [] as string[] },
  { name: "BM25（当前默认）", rank: (() => { const index = buildIndex(corpus); return (query: string) => search(index, query, 20).map((hit) => hit.kcId); })() },
  { name: "标题加权（仅实验）", rank: (() => { const index = buildIndex(corpus.map((doc) => ({ ...doc, text: `${doc.title} ${doc.title} ${doc.text}` }))); return (query: string) => search(index, query, 20).map((hit) => hit.kcId); })() },
];
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const scores: number[][] = [];
console.log(`片段级 hard 集：${cases.length} 查询 · ${corpus.length} 原文片段（人工标签，未经过独立教师复核）`);
for (const arm of arms) {
  const recalls3: number[] = []; const recalls20: number[] = []; const ndcgs: number[] = []; const absent: number[] = [];
  for (const item of cases) {
    const ranked = arm.rank(item.query);
    if (item.gold.length === 0) { absent.push(Number(ranked.length === 0)); continue; }
    const gold = new Set(item.gold);
    recalls3.push(ranked.slice(0, 3).filter((id) => gold.has(id)).length / gold.size);
    recalls20.push(ranked.slice(0, 20).filter((id) => gold.has(id)).length / gold.size);
    const dcg = ranked.slice(0, 10).reduce((sum, id, index) => sum + (gold.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
    const ideal = Array.from({ length: Math.min(10, gold.size) }, (_, index) => 1 / Math.log2(index + 2)).reduce((a, b) => a + b, 0);
    ndcgs.push(dcg / ideal);
  }
  scores.push(ndcgs);
  console.log(`${arm.name}: recall@3=${mean(recalls3).toFixed(3)} recall@20=${mean(recalls20).toFixed(3)} nDCG@10=${mean(ndcgs).toFixed(3)} 无答案空检索=${mean(absent).toFixed(3)}`);
}
// 固定随机种子的配对 bootstrap：比较同一查询的实验臂与默认臂，不伪造向量结果。
let seed = 20261104;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const differences = scores[1].map((score, index) => scores[2][index] - score);
const samples = Array.from({ length: 2000 }, () => mean(Array.from({ length: differences.length }, () => differences[Math.floor(random() * differences.length)]))).sort((a, b) => a - b);
console.log(`标题加权相对默认的 nDCG 差值=${mean(differences).toFixed(3)}，配对 bootstrap 95% 区间=[${samples[50].toFixed(3)}, ${samples[1949].toFixed(3)}]`);
console.log("向量与 RRF：未测；本评测不证明学习效果，也不把无答案场景的相关片段视为可回答证据。");
