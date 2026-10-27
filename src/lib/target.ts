/**
 * 学习目标：内置学科与自定义方向共用一个形状。
 *
 * 为什么统一：路径规划只吃 graph + mastery，诊断只额外需要题库。
 * 把两者做成同一形状后，planPath、useLearner、路径页、诊断页都不需要分支，
 * 「自定义方向被当成数据结构来测」这类 bug 也就没有滋生的地方。
 *
 * 题目来源二选一：
 *   subject   —— 内置题库（静态数据）
 *   direction —— 按需生成/手动录入，落在 direction_items
 */

import type { KnowledgeGraph } from "@/lib/graph";
import type { Question } from "@/data/questions";
import type { DirectionItem } from "@/lib/itemgen";
import type { Subject } from "@/data/subjects";

export interface SubjectTarget {
  readonly kind: "subject";
  readonly id: string;
  readonly name: string;
  readonly graph: KnowledgeGraph;
  readonly questions: readonly Question[];
  /** 学科专属的展示信息，方向没有。 */
  readonly tagline?: string;
  readonly syllabus?: string;
}

export interface DirectionTarget {
  readonly kind: "direction";
  readonly id: string;
  readonly name: string;
  readonly graph: KnowledgeGraph;
  readonly description?: string;
}

export type LearningTarget = SubjectTarget | DirectionTarget;

/** 从内置学科构造目标。 */
export function targetFromSubject(subject: Subject): SubjectTarget {
  return {
    kind: "subject",
    id: subject.id,
    name: subject.name,
    graph: subject.graph,
    questions: subject.questions,
    tagline: subject.tagline,
    syllabus: subject.syllabus,
  };
}

/** 从方向接口返回的数据构造目标。 */
export function targetFromDirection(input: {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly graph: KnowledgeGraph;
}): DirectionTarget {
  return {
    kind: "direction",
    id: input.id,
    name: input.title,
    graph: input.graph,
    description: input.description,
  };
}

/**
 * 一个目标里有哪些题。
 *
 * 方向目标的题目不在内存里，必须由调用方按 KC 拉取后传入；
 * 不传就是空数组——诊断页据此判断「这个 KC 还没题，需要生成」。
 */
export function questionsOf(
  target: LearningTarget,
  directionItems?: readonly DirectionItem[],
): readonly Question[] {
  if (target.kind === "subject") return target.questions;
  return directionItems ?? [];
}

/** 目标在 URL 与 localStorage 里的参数名。 */
export function targetQuery(target: LearningTarget): string {
  return target.kind === "subject"
    ? `?subject=${encodeURIComponent(target.id)}`
    : `?direction=${encodeURIComponent(target.id)}`;
}
