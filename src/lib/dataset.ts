/**
 * 数据集校验：覆盖全部学科。
 *
 * 这些检查必须能在 CI 里跑，而不是靠人眼看：
 *   1. 每个知识点恰好 3 题（决定「证据充分」是否可达，见 research/06-synthesis.md §1.2）
 *   2. 题目引用的知识点都存在
 *   3. 每题的答案下标与解析都不为空
 *   4. 图无环、无重复边、无孤立点
 *   5. 难度均值落在模型假设的区间内
 */

import { SUBJECTS, type Subject } from "@/data/subjects";
import { validateGraph, indexGraph } from "@/lib/graph";
import type { Question } from "@/data/questions";

export interface DatasetIssue {
  readonly severity: "error" | "warning";
  readonly subject: string;
  readonly detail: string;
}

export const QUESTIONS_PER_KC = 3;

/** 难度均值的设计区间。超出会让「3 题可达证据充分」的结论失效。 */
export const MEAN_DIFFICULTY_RANGE = { min: 1.8, max: 2.9 };

/** 校验单个学科。 */
export function validateSubject(subject: Subject): DatasetIssue[] {
  const issues: DatasetIssue[] = [];
  const { graph, questions } = subject;
  const kcIds = new Set(graph.concepts.map((c) => c.id));

  // 1. 图结构
  for (const issue of validateGraph(graph)) {
    issues.push({
      severity: "error",
      subject: subject.id,
      detail: `[图] ${issue.kind}: ${issue.detail}`,
    });
  }

  // 2. 每 KC 的题数
  const countByKc = new Map<string, number>();
  for (const q of questions) countByKc.set(q.kcId, (countByKc.get(q.kcId) ?? 0) + 1);
  for (const kc of kcIds) {
    const n = countByKc.get(kc) ?? 0;
    if (n !== QUESTIONS_PER_KC) {
      issues.push({
        severity: "error",
        subject: subject.id,
        detail: `[题库] ${kc} 有 ${n} 题，应为 ${QUESTIONS_PER_KC} 题。题数不足会让「证据充分」档位不可达`,
      });
    }
  }

  // 3. 题目指向不存在的 KC + 自身完整性
  const seenIds = new Set<string>();
  for (const q of questions) {
    if (!kcIds.has(q.kcId)) {
      issues.push({
        severity: "error",
        subject: subject.id,
        detail: `[题库] ${q.id} 指向不存在的知识点 ${q.kcId}`,
      });
    }
    if (seenIds.has(q.id)) {
      issues.push({ severity: "error", subject: subject.id, detail: `[题库] 题目 id 重复：${q.id}` });
    }
    seenIds.add(q.id);

    if (q.answerIndex < 0 || q.answerIndex >= q.options.length) {
      issues.push({
        severity: "error",
        subject: subject.id,
        detail: `[题库] ${q.id} 的答案下标 ${q.answerIndex} 越界`,
      });
    }
    if (q.options.length !== 4) {
      issues.push({
        severity: "warning",
        subject: subject.id,
        detail: `[题库] ${q.id} 有 ${q.options.length} 个选项，通常应为 4 个`,
      });
    }
    if (q.explanation.trim().length < 10) {
      issues.push({
        severity: "warning",
        subject: subject.id,
        detail: `[题库] ${q.id} 的解析过短，无法起到解释作用`,
      });
    }
  }

  // 4. 孤立点
  const idx = indexGraph(graph);
  for (const c of graph.concepts) {
    const preds = idx.predecessors.get(c.id) ?? [];
    const succs = idx.successors.get(c.id) ?? [];
    if (preds.length === 0 && succs.length === 0 && graph.concepts.length > 1) {
      issues.push({
        severity: "warning",
        subject: subject.id,
        detail: `[图] ${c.id}（${c.name}）既无前驱也无后继，可能是漏连`,
      });
    }
  }

  // 5. 难度均值：偏离模型假设会让「3 题够用」失效
  if (questions.length > 0) {
    const mean = questions.reduce((s, q) => s + q.difficulty, 0) / questions.length;
    if (mean < MEAN_DIFFICULTY_RANGE.min || mean > MEAN_DIFFICULTY_RANGE.max) {
      issues.push({
        severity: "warning",
        subject: subject.id,
        detail: `[题库] 难度均值 ${mean.toFixed(2)} 超出设计区间 ${MEAN_DIFFICULTY_RANGE.min}–${MEAN_DIFFICULTY_RANGE.max}，需重新核对「3 题/KC 是否仍能让 sd≤0.20」`,
      });
    }
  }

  return issues;
}

/** 校验全部学科，并检查学科之间 id 不冲突。 */
export function validateDataset(): DatasetIssue[] {
  const issues: DatasetIssue[] = [];

  for (const s of SUBJECTS) {
    issues.push(...validateSubject(s));
  }

  // 学科 id 必须唯一
  const ids = new Set<string>();
  for (const s of SUBJECTS) {
    if (ids.has(s.id)) {
      issues.push({ severity: "error", subject: s.id, detail: `学科 id 重复：${s.id}` });
    }
    ids.add(s.id);
  }

  // 学科内的知识点 id 前缀不同，但题目 id 仍要全局唯一
  const qIds = new Map<string, string>();
  for (const s of SUBJECTS) {
    for (const q of s.questions) {
      const prev = qIds.get(q.id);
      if (prev && prev !== s.id) {
        issues.push({
          severity: "error",
          subject: s.id,
          detail: `题目 id ${q.id} 与学科 ${prev} 冲突`,
        });
      }
      qIds.set(q.id, s.id);
    }
  }

  return issues;
}

/** 单学科统计。 */
export function subjectStats(subject: Subject) {
  const byDifficulty = new Map<number, number>();
  for (const q of subject.questions) {
    byDifficulty.set(q.difficulty, (byDifficulty.get(q.difficulty) ?? 0) + 1);
  }
  const meanDifficulty =
    subject.questions.length > 0
      ? subject.questions.reduce((s, q) => s + q.difficulty, 0) / subject.questions.length
      : 0;

  return {
    kcCount: subject.graph.concepts.length,
    edgeCount: subject.graph.edges.length,
    qCount: subject.questions.length,
    chapterCount: new Set(subject.graph.concepts.map((c) => c.chapter)).size,
    meanDifficulty,
    byDifficulty: Object.fromEntries([...byDifficulty].sort((a, b) => a[0] - b[0])),
  };
}

/** 取某学科的题目按知识点分组（供页面使用）。 */
export function groupQuestions(questions: readonly Question[]): Map<string, Question[]> {
  const map = new Map<string, Question[]>();
  for (const q of questions) {
    const list = map.get(q.kcId) ?? [];
    list.push(q);
    map.set(q.kcId, list);
  }
  return map;
}
