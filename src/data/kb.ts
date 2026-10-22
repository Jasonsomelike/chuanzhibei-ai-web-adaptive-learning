/**
 * 把知识图谱与题库变成可检索的知识库文档。
 *
 * 每个知识点一篇文档：名称、章节、要掌握什么、题目解析。
 * 检索到某篇文档时，导师就能引用具体的知识点与解析，而不是泛泛而谈。
 */

import { knowledgeGraph } from "@/data/knowledge-graph";
import { questionsForKc } from "@/data/questions";
import { buildIndex, type KbDocument, type Bm25Index } from "@/lib/rag";

export const kbDocuments: readonly KbDocument[] = knowledgeGraph.concepts.map((c) => {
  const qs = questionsForKc(c.id);
  const qa = qs
    .map((q, i) => `第${i + 1}题（难度${q.difficulty}）：${q.stem} 解析：${q.explanation}`)
    .join(" ");

  return {
    kcId: c.id,
    title: c.name,
    text: `${c.chapter}。${c.summary}。常见考点与解析：${qa}`,
  };
});

/** 全局索引，模块加载时构建一次（40 篇文档，构建开销可忽略）。 */
export const kbIndex: Bm25Index = buildIndex(kbDocuments);
