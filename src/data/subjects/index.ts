/**
 * 学科注册表。
 *
 * 应用支持多学科，每个学科有独立的图谱与题库。
 * 新增学科只需在这里加一条，页面与校验脚本会自动适配。
 *
 * 为什么每个学科都是 40 点 / 60 边 / 120 题：
 * 这不是巧合，而是由「3 题/知识点可达证据充分」这个模型约束反推出来的
 * （见 research/06-synthesis.md §1.2）。学科之间规模一致，
 * 才能用同一套参数与同一套 UI，不必为每个学科单独调参。
 */

import type { KnowledgeGraph } from "@/lib/graph";
import type { Question } from "@/data/questions";

import { knowledgeGraph as dataStructuresGraph } from "@/data/knowledge-graph";
import { questions as dataStructuresQuestions } from "@/data/questions";
import { networkGraph, networkQuestions } from "@/data/subjects/network";
import { osGraph, osQuestions } from "@/data/subjects/os";
import { linearAlgebraGraph, linearAlgebraQuestions } from "@/data/subjects/linear-algebra";
import { pythonGraph, pythonQuestions } from "@/data/subjects/python";

export interface Subject {
  /** URL 与存储用的稳定 id。 */
  readonly id: string;
  /** 界面显示名。 */
  readonly name: string;
  /** 一句话说明这门课覆盖什么。 */
  readonly tagline: string;
  /** 教材体系参照，用于说明知识点划分依据。 */
  readonly syllabus: string;
  readonly graph: KnowledgeGraph;
  readonly questions: readonly Question[];
}

export const SUBJECTS: readonly Subject[] = [
  {
    id: "data-structures",
    name: "数据结构",
    tagline: "复杂度、线性表、树、图、查找、排序",
    syllabus: "国内高校通用大纲（C 语言描述）",
    graph: dataStructuresGraph,
    questions: dataStructuresQuestions,
  },
  {
    id: "network",
    name: "计算机网络",
    tagline: "分层模型、IP 与子网、TCP 可靠传输、应用层协议",
    syllabus: "谢希仁体系，8 章",
    graph: networkGraph,
    questions: networkQuestions,
  },
  {
    id: "os",
    name: "操作系统",
    tagline: "进程与线程、调度、同步与死锁、内存与文件系统",
    syllabus: "汤小丹体系，9 章",
    graph: osGraph,
    questions: osQuestions,
  },
  {
    id: "linear-algebra",
    name: "线性代数",
    tagline: "行列式、矩阵、线性方程组、特征值、二次型",
    syllabus: "同济版体系，7 章",
    graph: linearAlgebraGraph,
    questions: linearAlgebraQuestions,
  },
  {
    id: "python",
    name: "Python 程序设计",
    tagline: "类型与字符串、容器、流程控制、函数、OOP、工程实践",
    syllabus: "8 章，面向零基础到进阶",
    graph: pythonGraph,
    questions: pythonQuestions,
  },
];

/** 默认学科。 */
export const DEFAULT_SUBJECT_ID = "data-structures";

export function getSubject(id: string | null | undefined): Subject {
  if (!id) return SUBJECTS[0];
  return SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[0];
}

/** 某学科的题目按知识点分组。 */
export function questionsByKc(subject: Subject): Map<string, readonly Question[]> {
  const map = new Map<string, Question[]>();
  for (const c of subject.graph.concepts) map.set(c.id, []);
  for (const q of subject.questions) {
    map.get(q.kcId)?.push(q);
  }
  return map;
}

/** 全学科统计，用于关于页与校验。 */
export function allSubjectsStats() {
  return SUBJECTS.map((s) => ({
    id: s.id,
    name: s.name,
    concepts: s.graph.concepts.length,
    edges: s.graph.edges.length,
    questions: s.questions.length,
    chapters: new Set(s.graph.concepts.map((c) => c.chapter)).size,
  }));
}
