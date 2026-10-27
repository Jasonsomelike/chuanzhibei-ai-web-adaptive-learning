/**
 * 无模型时的降级：按知识点名称从内置题库借用题目。
 *
 * 纯函数、无网络、无 provider 依赖，所以服务端也能调用——
 * 服务端要用它独立复算「这道题是不是真的借来的」，
 * 不能只信客户端声称的 source="borrowed"。
 */

import type { KnowledgeConcept } from "@/lib/graph";
import type { Question } from "@/data/questions";
import { SUBJECTS } from "@/data/subjects";
import { contentHashOf, normalizeText, ITEMS_PER_KC, type DirectionItem } from "@/lib/itemgen";

/**
 * 无模型时的降级：按知识点名称从内置题库借用题目。
 *
 * 只在名字**归一化后完全相同**时借用——「栈」借「栈」可以，
 * 「栈的应用」借「栈」不行：题目问的是原知识点，换个名字就答非所问。
 *
 * 借用题的难度标签来自人工校准的内置题库，所以不打折（weightScale=1）。
 * 找不到同名知识点时返回空数组，调用方据此报「无题」。
 */
export function borrowItems(
  concept: KnowledgeConcept,
  meta: { readonly directionId: string; readonly now: string },
): DirectionItem[] {
  const want = normalizeText(concept.name);
  if (want === "") return [];

  for (const subject of SUBJECTS) {
    const kc = subject.graph.concepts.find((c) => normalizeText(c.name) === want);
    if (!kc) continue;

    const questions: readonly Question[] = subject.questions.filter((q) => q.kcId === kc.id);
    if (questions.length === 0) continue;

    return questions.slice(0, ITEMS_PER_KC).map((q) => ({
      ...q,
      // id 加方向前缀，避免与内置题库的 id 撞车（诊断页靠 id 去重）
      id: `di-${meta.directionId.slice(0, 8)}-${q.id}`,
      directionId: meta.directionId,
      source: "borrowed" as const,
      status: "accepted" as const,
      checks: ["借用自内置题库（人工校准的难度标签）"],
      contentHash: contentHashOf({
        kcId: concept.id,
        stem: q.stem,
        options: q.options,
        explanation: q.explanation,
      }),
      createdAt: meta.now,
    }));
  }

  return [];
}
