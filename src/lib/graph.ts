/**
 * 知识图谱：知识点（KC）与先修关系（DAG）。
 *
 * 图是「能不能学」的硬约束来源——先修未达标的知识点不能排进路径。
 * 这里只放类型与图算法，具体数据在 src/data/knowledge-graph.ts。
 */

/** 一个知识点。 */
export interface KnowledgeConcept {
  readonly id: string;
  readonly name: string;
  /** 一句话说明这个知识点要学生掌握什么。 */
  readonly summary: string;
  /** 所属章节，用于界面分组。 */
  readonly chapter: string;
}

/** 一条先修边：before 必须在 after 之前掌握。 */
export interface PrerequisiteEdge {
  readonly before: string;
  readonly after: string;
}

/** 完整知识图谱。 */
export interface KnowledgeGraph {
  readonly version: string;
  readonly concepts: readonly KnowledgeConcept[];
  readonly edges: readonly PrerequisiteEdge[];
}

/** 图校验失败的具体原因。 */
export interface GraphIssue {
  readonly kind: "missing-node" | "cycle" | "duplicate-edge" | "self-loop" | "isolated";
  readonly detail: string;
}

/** 建索引：id → 知识点、id → 后继、id → 前驱。 */
export interface GraphIndex {
  readonly byId: ReadonlyMap<string, KnowledgeConcept>;
  readonly successors: ReadonlyMap<string, readonly string[]>;
  readonly predecessors: ReadonlyMap<string, readonly string[]>;
}

export function indexGraph(graph: KnowledgeGraph): GraphIndex {
  const byId = new Map<string, KnowledgeConcept>();
  for (const c of graph.concepts) byId.set(c.id, c);

  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const c of graph.concepts) {
    successors.set(c.id, []);
    predecessors.set(c.id, []);
  }
  for (const e of graph.edges) {
    successors.get(e.before)?.push(e.after);
    predecessors.get(e.after)?.push(e.before);
  }

  // 排序让下游算法与哈希都稳定，不受数据书写顺序影响
  for (const list of successors.values()) list.sort();
  for (const list of predecessors.values()) list.sort();

  return { byId, successors, predecessors };
}

/**
 * 校验图结构。返回所有问题，不是遇到第一个就停——
 * 一次跑完能让人一口气改完，而不是改一条跑一次。
 */
export function validateGraph(graph: KnowledgeGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set(graph.concepts.map((c) => c.id));

  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (!ids.has(e.before)) {
      issues.push({ kind: "missing-node", detail: `边 ${e.before} → ${e.after}：${e.before} 不在知识点里` });
    }
    if (!ids.has(e.after)) {
      issues.push({ kind: "missing-node", detail: `边 ${e.before} → ${e.after}：${e.after} 不在知识点里` });
    }
    if (e.before === e.after) {
      issues.push({ kind: "self-loop", detail: `知识点 ${e.before} 自己指向自己` });
    }
    const key = `${e.before}→${e.after}`;
    if (seen.has(key)) {
      issues.push({ kind: "duplicate-edge", detail: `重复的边 ${key}` });
    }
    seen.add(key);
  }

  // 环检测：三色标记 DFS
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);
  const stack: string[] = [];

  const visit = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    for (const e of graph.edges) {
      if (e.before !== id) continue;
      const next = e.after;
      if (!ids.has(next)) continue;
      const c = color.get(next);
      if (c === GRAY) {
        const start = stack.indexOf(next);
        const loop = [...stack.slice(start), next].join(" → ");
        issues.push({ kind: "cycle", detail: `存在环：${loop}` });
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const id of ids) {
    if (color.get(id) === WHITE) visit(id);
  }

  return issues;
}

/** 每个知识点的先修深度：根为 0，取所有前驱深度的最大值 + 1。 */
export function computeDepths(graph: KnowledgeGraph): ReadonlyMap<string, number> {
  const idx = indexGraph(graph);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  const resolve = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // 环：validateGraph 会单独报，这里不崩
    visiting.add(id);
    const preds = idx.predecessors.get(id) ?? [];
    const d = preds.length === 0 ? 0 : Math.max(...preds.map(resolve)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };

  for (const c of graph.concepts) resolve(c.id);
  return depth;
}

/**
 * 先修闭包：要学 target，必须先学的全部知识点（不含 target 本身）。
 * 用迭代而不是递归，避免大图上爆栈。
 */
export function prerequisiteClosure(graph: KnowledgeGraph, target: string): Set<string> {
  const idx = indexGraph(graph);
  const result = new Set<string>();
  const queue = [...(idx.predecessors.get(target) ?? [])];

  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (result.has(id) || id === target) continue;
    result.add(id);
    for (const p of idx.predecessors.get(id) ?? []) queue.push(p);
  }

  return result;
}

/**
 * 拓扑序（Kahn 算法）。同层按 id 字典序出队，
 * 保证同一张图每次得到完全相同的顺序——这是路径可复现的前提之一。
 */
export function topologicalOrder(graph: KnowledgeGraph, subset?: ReadonlySet<string>): string[] {
  const idx = indexGraph(graph);
  const nodes = subset ? [...subset].filter((id) => idx.byId.has(id)) : [...idx.byId.keys()];
  const nodeSet = new Set(nodes);

  const indegree = new Map<string, number>();
  for (const id of nodes) {
    const preds = (idx.predecessors.get(id) ?? []).filter((p) => nodeSet.has(p));
    indegree.set(id, preds.length);
  }

  const ready = nodes.filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  const order: string[] = [];

  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    for (const next of idx.successors.get(id) ?? []) {
      if (!nodeSet.has(next)) continue;
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }

  return order;
}
