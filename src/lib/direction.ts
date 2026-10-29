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
import { validateGraph, topologicalOrder } from "@/lib/graph";
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
export const MAX_TITLE_LENGTH = 60;

/**
 * 用用户输入的标题覆盖草稿标题。纯函数，不修改原草稿。
 *
 * 空标题不在这里回退到 draft.title：用户明确清空输入时，
 * 悄悄换回生成时的标题会让人误以为修改已生效。
 * 空标题交给 validateTitle / validateDraft 拒绝。
 */
export function withTitle(draft: DirectionDraft, title: string): DirectionDraft {
  return { ...draft, title: title.trim() };
}

/**
 * 校验用户输入的方向名。返回问题列表，空数组表示合格。
 *
 * 按去首尾空白后的长度判断，与 withTitle 提交给服务端的值保持一致；
 * 服务端 validateDraft 的 ≤60 字校验仍是最终防线。
 */
export function validateTitle(title: string): string[] {
  const issues: string[] = [];
  const trimmed = title.trim();
  if (trimmed.length === 0) issues.push("方向名不能为空");
  if (trimmed.length > MAX_TITLE_LENGTH) {
    issues.push(`方向名过长（上限 ${MAX_TITLE_LENGTH} 字，当前 ${trimmed.length} 字）`);
  }
  return issues;
}

/** 校验一个生成的方向是否可用。返回问题列表，空数组表示合格。 */
export function validateDraft(draft: DirectionDraft): string[] {
  const issues: string[] = [];

  if (draft.title.trim().length === 0) issues.push("标题为空");
  if (draft.title.length > MAX_TITLE_LENGTH) {
    issues.push(`标题过长（上限 ${MAX_TITLE_LENGTH} 字）`);
  }
  if (draft.description.trim().length === 0) issues.push("描述为空");

  const n = draft.concepts.length;
  if (n < MIN_CONCEPTS) issues.push(`知识点太少（${n} 个，至少 ${MIN_CONCEPTS} 个）`);
  if (n > MAX_CONCEPTS) issues.push(`知识点太多（${n} 个，最多 ${MAX_CONCEPTS} 个）`);

  const ids = new Set<string>();
  /*
   * 名称也要去重：两个 id 不同但同名的知识点，在诊断页会显示成两个一模一样的
   * 「栈」，学生无法判断自己在测哪个；路径页的步骤也分不清。
   * 用归一化后的名称比对，避免「栈 」与「栈」逃过检查。
   */
  const names = new Map<string, string>();
  for (const c of draft.concepts) {
    if (!/^[a-z][a-z0-9_]{0,15}$/.test(c.id)) {
      issues.push(`知识点 id「${c.id}」不合规（需小写字母开头，只含小写字母数字下划线，≤16 字符）`);
    }
    if (ids.has(c.id)) issues.push(`知识点 id 重复：${c.id}`);
    ids.add(c.id);
    if (c.name.trim().length === 0) issues.push(`知识点 ${c.id} 名称为空`);
    if (c.name.length > 40) issues.push(`知识点 ${c.id} 名称过长`);

    const nameKey = c.name.replace(/\s+/g, "").toLowerCase();
    if (nameKey !== "") {
      const dup = names.get(nameKey);
      if (dup !== undefined) {
        issues.push(`知识点名称重复：「${c.name}」同时用于 ${dup} 与 ${c.id}`);
      } else {
        names.set(nameKey, c.id);
      }
    }
  }

  /*
   * 边不能为空：0 条边的图没有先修约束，路径规划会退化成「按 id 排序」，
   * 与「带先修关系的小型知识图谱」这个承诺不符。
   *
   * 不要求边数达到 n−1：从学科里挑选相关知识点时，选中的子图本来就可能不连通
   * （比如「哈希表」只命中一个点，其余是补进来的基础点）。要求连通会把
   * 合法的降级结果判成不合格，反而逼用户去改一个他无法改的图。
   */
  if (draft.edges.length === 0) {
    issues.push("没有任何先修关系：请至少给出一条「不掌握前者，后者就学不动」的边");
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

  /*
   * 命中不足 MIN_CONCEPTS 时补基础点，但两条约束：
   *   1. **命中的点必须全部保留**。旧实现直接取 `scored.slice(0, N)`（图谱顺序），
   *      实测「哈希表」时命中的 c34 被挤出前 5，描述却写「其中 1 个与哈希直接相关」，
   *      5 个里 0 个相关——这是把 bug 写进了文案。
   *   2. 补进来的点不能说成「相关」，描述里要如实区分。
   */
  const hitCount = picked.length;
  const supplemented = hitCount < MIN_CONCEPTS;
  const targetSize = supplemented ? Math.max(MIN_CONCEPTS, hitCount + 3) : hitCount;
  const pickedIds = new Set(picked.map((x) => x.concept.id));
  // 先放命中的点，再按图谱顺序补 score=0 的基础点，直到凑够 targetSize
  const chosen = supplemented
    ? [...picked, ...scored.filter((x) => !pickedIds.has(x.concept.id))].slice(0, targetSize)
    : picked;

  const idMap = new Map<string, string>();
  /*
   * 输出顺序按拓扑序，不按关键词得分。
   * 下游（诊断页的懒生成）会按数组顺序兜底选第一个待测点，
   * 按得分排会让「多级反馈队列调度」(depth 7) 排在「进程的概念」(depth 0) 前面。
   */
  const ordered = topologicalOrder(subject.graph, new Set(chosen.map((x) => x.concept.id)));
  const byId = new Map(chosen.map((x) => [x.concept.id, x]));
  ordered.forEach((id, i) => idMap.set(id, `k${i + 1}`));

  // 只保留两端都在选中集合里的边
  const edges = subject.graph.edges
    .filter((e) => idMap.has(e.before) && idMap.has(e.after))
    .map((e) => ({ before: idMap.get(e.before)!, after: idMap.get(e.after)! }));

  const summary = supplemented
    ? `从「${subject.name}」中挑选了 ${chosen.length} 个知识点：其中 ${hitCount} 个与「${matchedWords.join("、")}」直接相关，其余是学习该主题所需的基础知识点（按图谱顺序补充）。`
    : `从「${subject.name}」中挑选了 ${chosen.length} 个与「${matchedWords.join("、")}」相关的知识点。`;

  return {
    title: `${subject.name} · 自选专题`,
    description: summary,
    concepts: ordered
      .map((id) => byId.get(id))
      .filter((x): x is NonNullable<typeof x> => x !== undefined)
      .map((x) => ({
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
6. 如果用户描述太模糊，就按最合理的理解生成，不要反问。
7. concepts 数组请按先修顺序排列：没有前置的排前面，依赖越深的排越后面。
   这个顺序会被用作「先测哪个知识点」的兜底依据，乱序会让诊断从最难的点开始。`;

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
