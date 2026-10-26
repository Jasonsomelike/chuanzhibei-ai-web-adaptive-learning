/**
 * 自定义学习方向。
 *
 * 用户用自然语言描述想学什么，AI 把它拆成知识点与先修关系，
 * 形成一张可规划路径的小型知识图谱。
 *
 * 为什么生成的是「图谱」而不是「课程列表」：
 * 本项目所有能力（路径规划、掌握度、反事实）都建立在先修 DAG 上。
 * 生成一份带先修关系的图，自定义方向就能复用全部现有能力，
 * 不需要为它单独写一套推荐逻辑。
 *
 * 生成的两条路径：
 *   1. 配置了模型供应商 → 由 LLM 按 schema 生成，再用代码校验
 *   2. 未配置 → 用关键词规则从已有学科里挑选相关知识点拼装（降级但可用）
 *
 * 无论哪条路径，**结果都必须过校验**：无环、边不悬空、题数够。
 * 不合格的图宁可拒绝，也不能塞进路径规划——那会让 plan 崩溃或给出荒唐路径。
 */

import type { KnowledgeGraph, PrerequisiteEdge, KnowledgeConcept } from "@/lib/graph";
import { validateGraph } from "@/lib/graph";
import type { Question } from "@/data/questions";
import { SUBJECTS } from "@/data/subjects";

/** 一个自定义方向。 */
export interface CustomDirection {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  /** 基于哪个学科的知识点池（生成时参考），仅作展示。 */
  readonly subjectId: string;
  readonly description: string;
  readonly graph: KnowledgeGraph;
  readonly questions: readonly Question[];
  readonly isPublic: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 生成结果的原始形态（LLM 返回这个，再转成 CustomDirection）。 */
export interface DirectionDraft {
  readonly title: string;
  readonly description: string;
  readonly concepts: readonly { id: string; name: string; summary: string }[];
  readonly edges: readonly { before: string; after: string }[];
}

export const MIN_CONCEPTS = 5;
export const MAX_CONCEPTS = 20;

/** 校验一个生成的方向是否可用。返回问题列表，空数组表示合格。 */
export function validateDraft(draft: DirectionDraft): string[] {
  const issues: string[] = [];

  if (draft.title.trim().length === 0) issues.push("标题为空");
  if (draft.title.length > 60) issues.push("标题过长（上限 60 字）");
  if (draft.description.trim().length === 0) issues.push("描述为空");

  const n = draft.concepts.length;
  if (n < MIN_CONCEPTS) issues.push(`知识点太少（${n} 个，至少 ${MIN_CONCEPTS} 个）`);
  if (n > MAX_CONCEPTS) issues.push(`知识点太多（${n} 个，最多 ${MAX_CONCEPTS} 个）`);

  const ids = new Set<string>();
  for (const c of draft.concepts) {
    if (!/^[a-z][a-z0-9_]{0,15}$/.test(c.id)) {
      issues.push(`知识点 id「${c.id}」不合规（需小写字母开头，只含小写字母数字下划线，≤16 字符）`);
    }
    if (ids.has(c.id)) issues.push(`知识点 id 重复：${c.id}`);
    ids.add(c.id);
    if (c.name.trim().length === 0) issues.push(`知识点 ${c.id} 名称为空`);
    if (c.name.length > 40) issues.push(`知识点 ${c.id} 名称过长`);
  }

  // 边必须两端都存在，且不能自环
  for (const e of draft.edges) {
    if (!ids.has(e.before)) issues.push(`边 ${e.before}→${e.after}：${e.before} 不存在`);
    if (!ids.has(e.after)) issues.push(`边 ${e.before}→${e.after}：${e.after} 不存在`);
    if (e.before === e.after) issues.push(`知识点 ${e.before} 自己指向自己`);
  }

  // 用真实的图校验器检查环与重复边
  const graph: KnowledgeGraph = {
    version: "draft",
    concepts: draft.concepts.map((c) => ({ ...c, chapter: "自定义" })),
    edges: draft.edges,
  };
  for (const issue of validateGraph(graph)) {
    if (issue.kind === "cycle") issues.push(`存在环：${issue.detail}`);
    if (issue.kind === "duplicate-edge") issues.push(`重复边：${issue.detail}`);
  }

  return issues;
}

/** 把草稿转成可规划的图谱与题库。 */
export function draftToDirection(
  draft: DirectionDraft,
  meta: {
    id: string;
    userId: string;
    subjectId: string;
    isPublic: boolean;
    now: string;
  },
): CustomDirection {
  const concepts: KnowledgeConcept[] = draft.concepts.map((c) => ({
    id: c.id,
    name: c.name,
    summary: c.summary,
    chapter: "自定义",
  }));

  const edges: PrerequisiteEdge[] = draft.edges.map((e) => ({
    before: e.before,
    after: e.after,
  }));

  return {
    id: meta.id,
    userId: meta.userId,
    title: draft.title.trim(),
    subjectId: meta.subjectId,
    description: draft.description.trim(),
    graph: { version: `custom-${meta.id}`, concepts, edges },
    // 自定义方向没有题库——路径规划不需要题，诊断才会用到。
    // 这是有意的取舍：生成可信的题目需要学科知识，模型生成容易出错，
    // 宁可不提供诊断，也不提供错题。
    questions: [],
    isPublic: meta.isPublic,
    createdAt: meta.now,
    updatedAt: meta.now,
  };
}

// ── 无模型时的降级生成 ────────────────────────────────────────────

/**
 * 关键词规则生成：从已有学科的题库与图谱里挑出与描述相关的知识点。
 *
 * 这不是「假装 AI 生成」，而是诚实地复用已有内容：
 * 用户说「我想学树结构」，就从数据结构里挑出所有树相关知识点与它们的先修链。
 * 界面会标注这是「从现有学科挑选」而非「新生成」。
 */
export function composeFromExisting(description: string): DirectionDraft | null {
  const text = description.toLowerCase();

  // 关键词 → 学科 id。命中越多，优先用该学科。
  const keywords: Record<string, string[]> = {
    "data-structures": ["数据结构", "算法", "树", "图", "排序", "查找", "栈", "队列", "链表", "哈希", "复杂度"],
    network: ["网络", "tcp", "ip", "协议", "路由", "http", "子网", "socket", "dns"],
    os: ["操作系统", "进程", "线程", "内存", "调度", "死锁", "文件系统", "虚拟内存", "并发"],
    "linear-algebra": ["线性代数", "矩阵", "行列式", "特征值", "向量", "二次型", "秩"],
    python: ["python", "脚本", "函数式", "装饰器", "迭代器", "类", "模块", "异常"],
    probability: ["概率", "统计", "随机变量", "期望", "方差", "假设检验", "分布", "中心极限"],
    "discrete-math": ["离散", "集合", "关系", "图论", "群", "布尔", "逻辑", "组合"],
    "machine-learning": ["机器学习", "模型", "训练", "回归", "分类", "聚类", "神经网络", "梯度"],
    "academic-writing": ["写作", "论文", "摘要", "引用", "学术英语", "论证", "文献"],
  };

  // 统计每个学科命中的关键词数
  let bestSubject: string | null = null;
  let bestHits = 0;
  for (const [subjectId, words] of Object.entries(keywords)) {
    const hits = words.filter((w) => text.includes(w)).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestSubject = subjectId;
    }
  }

  if (!bestSubject || bestHits === 0) return null;

  const subject = SUBJECTS.find((s) => s.id === bestSubject);
  if (!subject) return null;

  // 从该学科里挑与描述最相关的知识点：名称或摘要命中关键词的优先
  const matchedWords = (keywords[bestSubject] ?? []).filter((w) => text.includes(w));

  const scored = subject.graph.concepts.map((c) => {
    const hay = `${c.name} ${c.summary} ${c.chapter}`.toLowerCase();
    const score = matchedWords.filter((w) => hay.includes(w)).length;
    return { concept: c, score };
  });

  const picked = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CONCEPTS);

  // 命中的点太少就取该学科前若干基础点，保证至少 MIN_CONCEPTS 个
  const chosen = picked.length >= MIN_CONCEPTS
    ? picked
    : scored.slice(0, Math.max(MIN_CONCEPTS, picked.length + 3));

  const idMap = new Map<string, string>();
  chosen.forEach((x, i) => idMap.set(x.concept.id, `k${i + 1}`));

  // 只保留两端都在选中集合里的边
  const edges = subject.graph.edges
    .filter((e) => idMap.has(e.before) && idMap.has(e.after))
    .map((e) => ({ before: idMap.get(e.before)!, after: idMap.get(e.after)! }));

  return {
    title: `${subject.name} · 自选专题`,
    description: `从「${subject.name}」中挑选了 ${chosen.length} 个与「${matchedWords.join("、")}」相关的知识点。`,
    concepts: chosen.map((x) => ({
      id: idMap.get(x.concept.id)!,
      name: x.concept.name,
      summary: x.concept.summary,
    })),
    edges,
  };
}

// ── 给 LLM 的提示词 ────────────────────────────────────────────────

export const DIRECTION_SYSTEM_PROMPT = `你是课程设计助手。用户会描述想学的主题，你要把它拆成一张有先修关系的小型知识图谱。

严格输出 JSON，不要任何解释文字、不要 markdown 代码块。格式：

{
  "title": "不超过 20 字的标题",
  "description": "一到两句话说明这个方向包含什么",
  "concepts": [
    { "id": "k1", "name": "知识点名称（不超过 15 字）", "summary": "一句话说明要掌握什么" }
  ],
  "edges": [
    { "before": "k1", "after": "k2" }
  ]
}

硬性规则：
1. concepts 数量必须在 5 到 20 之间。
2. id 必须是小写字母开头、只含小写字母数字下划线、不超过 16 字符。建议用 k1、k2 这样递增。
3. edges 的 before/after 必须是 concepts 里存在的 id，不能自环，不能成环。
4. 先修关系必须是真实的「不掌握前者，后者就学不动」，不要按列表顺序硬连。
5. 不要生成与主题无关的知识点。宁可少而准，不要多而杂。
6. 如果用户描述太模糊，就按最合理的理解生成，不要反问。`;

/** 从 LLM 返回的文本里抽出 JSON。模型常包代码块或加解释，需要容错。 */
export function extractJson(text: string): unknown | null {
  const trimmed = text.trim();

  // 直接就是 JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    /* 继续尝试 */
  }

  // 去掉 ```json ``` 包裹
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* 继续 */
    }
  }

  // 抓第一个 { 到最后一个 } 之间的内容
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* 失败 */
    }
  }

  return null;
}

/** 把 unknown 收窄成 DirectionDraft，字段缺失返回 null。 */
export function coerceDraft(raw: unknown): DirectionDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.title !== "string" || typeof o.description !== "string") return null;
  if (!Array.isArray(o.concepts) || !Array.isArray(o.edges)) return null;

  const concepts: { id: string; name: string; summary: string }[] = [];
  for (const c of o.concepts) {
    if (typeof c !== "object" || c === null) continue;
    const cc = c as Record<string, unknown>;
    if (typeof cc.id !== "string" || typeof cc.name !== "string") continue;
    concepts.push({
      id: cc.id,
      name: cc.name,
      summary: typeof cc.summary === "string" ? cc.summary : "",
    });
  }

  const edges: { before: string; after: string }[] = [];
  for (const e of o.edges) {
    if (typeof e !== "object" || e === null) continue;
    const ee = e as Record<string, unknown>;
    if (typeof ee.before !== "string" || typeof ee.after !== "string") continue;
    edges.push({ before: ee.before, after: ee.after });
  }

  return { title: o.title, description: o.description, concepts, edges };
}
