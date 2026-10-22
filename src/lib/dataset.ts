/**
 * 题库与图谱的一致性校验。
 *
 * 这些检查必须能在 CI 里跑，而不是靠人眼看：
 *   1. 每个知识点恰好 3 题（决定「证据充分」是否可达，见 research/06-synthesis.md §1.2）
 *   2. 题目引用的知识点都存在
 *   3. 每题的答案下标与解析都不为空
 *   4. 图无环、无重复边、无孤立点
 *
 * 单独写成模块而不是放在测试里，是为了让 `npm run kg:validate` 能在
 * 提交前的 CI 里当作硬门禁跑。
 */

import { questions } from "@/data/questions";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { validateGraph, indexGraph } from "@/lib/graph";

export interface DatasetIssue {
  readonly severity: "error" | "warning";
  readonly detail: string;
}

export const QUESTIONS_PER_KC = 3;

/** 返回所有问题。空数组表示数据集健康。 */
export function validateDataset(): DatasetIssue[] {
  const issues: DatasetIssue[] = [];
  const idx = indexGraph(knowledgeGraph);
  const kcIds = new Set(knowledgeGraph.concepts.map((c) => c.id));

  // 1. 图结构
  for (const issue of validateGraph(knowledgeGraph)) {
    issues.push({ severity: "error", detail: `[图] ${issue.kind}: ${issue.detail}` });
  }

  // 2. 每 KC 的题数
  const countByKc = new Map<string, number>();
  for (const q of questions) {
    countByKc.set(q.kcId, (countByKc.get(q.kcId) ?? 0) + 1);
  }
  for (const kc of kcIds) {
    const n = countByKc.get(kc) ?? 0;
    if (n !== QUESTIONS_PER_KC) {
      issues.push({
        severity: "error",
        detail: `[题库] ${kc} 有 ${n} 题，应为 ${QUESTIONS_PER_KC} 题。题数不足会让「证据充分」档位不可达`,
      });
    }
  }

  // 3. 题目指向不存在的 KC
  for (const q of questions) {
    if (!kcIds.has(q.kcId)) {
      issues.push({ severity: "error", detail: `[题库] ${q.id} 指向不存在的知识点 ${q.kcId}` });
    }
  }

  // 4. 题目自身完整性
  const seenIds = new Set<string>();
  for (const q of questions) {
    if (seenIds.has(q.id)) {
      issues.push({ severity: "error", detail: `[题库] 题目 id 重复：${q.id}` });
    }
    seenIds.add(q.id);

    if (q.answerIndex < 0 || q.answerIndex >= q.options.length) {
      issues.push({ severity: "error", detail: `[题库] ${q.id} 的答案下标 ${q.answerIndex} 越界` });
    }
    if (q.options.length !== 4) {
      issues.push({ severity: "warning", detail: `[题库] ${q.id} 有 ${q.options.length} 个选项，通常应为 4 个` });
    }
    if (q.explanation.trim().length < 10) {
      issues.push({ severity: "warning", detail: `[题库] ${q.id} 的解析过短，无法起到解释作用` });
    }
  }

  // 5. 孤立点：没有任何先修关系的知识点，通常是漏连了边
  for (const c of knowledgeGraph.concepts) {
    const preds = idx.predecessors.get(c.id) ?? [];
    const succs = idx.successors.get(c.id) ?? [];
    if (preds.length === 0 && succs.length === 0 && knowledgeGraph.concepts.length > 1) {
      issues.push({ severity: "warning", detail: `[图] ${c.id}（${c.name}）既无前驱也无后继，可能是漏连` });
    }
  }

  return issues;
}

/** 数据集统计，用于 README 与界面展示。 */
export function datasetStats() {
  const kcCount = knowledgeGraph.concepts.length;
  const edgeCount = knowledgeGraph.edges.length;
  const qCount = questions.length;

  const byDifficulty = new Map<number, number>();
  for (const q of questions) {
    byDifficulty.set(q.difficulty, (byDifficulty.get(q.difficulty) ?? 0) + 1);
  }

  // 难度均值决定 w，进而决定「几题够用」，所以要在界面上可见
  const meanDifficulty = questions.reduce((s, q) => s + q.difficulty, 0) / qCount;

  return {
    kcCount,
    edgeCount,
    qCount,
    meanDifficulty,
    byDifficulty: Object.fromEntries([...byDifficulty].sort((a, b) => a[0] - b[0])),
  };
}
