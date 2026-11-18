import { describe, expect, it } from "vitest";
import { SUBJECTS } from "@/data/subjects";
import { initialMastery } from "@/lib/mastery";
import { planPath } from "@/lib/plan";
import { layoutLearningNodes, learningEdgeVisual, learningGraphFileName, learningGraphNodes, relatedLearningNodes } from "@/lib/learningGraph";
import type { KnowledgeGraph } from "@/lib/graph";
import { learningNodeSize, routeLearningEdges, segmentCrossesRect } from "./learningGraphLayout";

describe("先修图谱使用真实规划与证据", () => {
  const subject = SUBJECTS[0];
  const mastery = subject.graph.concepts.map(concept => initialMastery(concept.id, 0));
  const plan = planPath({ graph: subject.graph, mastery, budgetMinutes: 60 });
  it("未测评没有掌握度数值，显示安排数与原规划一致", () => {
    const nodes = learningGraphNodes(subject.graph, mastery, plan, plan.steps);
    expect(nodes.filter(node => node.status === "planned").map(node => node.id).sort()).toEqual(plan.steps.map(step => step.kcId).sort());
    expect(nodes.every(node => node.mean === null && node.sd === null)).toBe(true);
    expect(nodes.every(node => !node.reason?.includes("%"))).toBe(true);
    expect(nodes.filter(node => node.status === "blocked").map(node => node.id).sort()).toEqual(plan.blocked.map(step => step.kcId).sort());
  });
  it("手动顺序、移除与知识点稳定标识一致，原数据不变", () => {
    const reordered = [...plan.steps.slice(1)].reverse();
    const nodes = learningGraphNodes(subject.graph, mastery, plan, reordered);
    expect(nodes.find(node => node.id === plan.steps[0].kcId)?.status).toBe("removed");
    expect(nodes.find(node => node.id === reordered[0].kcId)?.order).toBe(1);
    expect(plan.steps[0].kcId).toBe(subject.graph.concepts[0].id);
  });
  it("预算扩大后图谱安排与新规划一致，阻塞原因逐条保留", () => {
    const larger = planPath({ graph: subject.graph, mastery, budgetMinutes: 120 });
    const nodes = learningGraphNodes(subject.graph, mastery, larger, larger.steps);
    expect(nodes.filter(node => node.status === "planned")).toHaveLength(larger.steps.length);
    for (const blocked of larger.blocked) expect(nodes.find(node => node.id === blocked.kcId)?.blockedBy).toEqual(blocked.by);
  });
  it("达到学习阈值需要实际证据，不能仅凭先验显示掌握", () => {
    const modified = mastery.map((state, index) => index < 2 ? { ...state, alpha: 99, beta: 1, evidenceN: index } : state);
    const result = planPath({ graph: subject.graph, mastery: modified, budgetMinutes: 60 });
    const nodes = learningGraphNodes(subject.graph, modified, result, result.steps);
    expect(nodes.find(node => node.id === modified[0].kcId)?.mean).toBeNull();
    expect(nodes.find(node => node.id === modified[0].kcId)?.status).not.toBe("mastered");
    expect(nodes.find(node => node.id === modified[1].kcId)?.status).toBe("mastered");
  });
  it("合流图中完整保留跨支路先修，不因节点已在集合中跳过祖先", () => {
    const graph: KnowledgeGraph = { version: "test", concepts: ["a", "b", "c", "d", "e"].map(id => ({ id, name: id, chapter: "", summary: "" })), edges: [{ before: "a", after: "b" }, { before: "c", after: "b" }, { before: "d", after: "c" }, { before: "b", after: "e" }] };
    const steps = ["a", "e"].map(kcId => ({ kcId, kind: "learn" as const, estMinutes: 15, reason: "test", source: "algorithm" as const }));
    expect([...relatedLearningNodes(graph, steps)].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("过滤不可见兄弟后布局紧凑，同一输入布局确定", () => {
    const nodes = learningGraphNodes(subject.graph, mastery, plan, plan.steps);
    const subset = nodes.filter(node => plan.steps.some(step => step.kcId === node.id));
    const first = layoutLearningNodes(subset);
    expect(first).toEqual(layoutLearningNodes(subset));
    expect(Math.max(...first.map(node => node.position.y))).toBeLessThan(first.length * 120);
    expect(new Set(first.map(node => `${node.position.x}:${node.position.y}`)).size).toBe(first.length);
  });
  it("窄屏保留真实先修层级、节点身份与独立位置", () => {
    const nodes = learningGraphNodes(subject.graph, mastery, plan, plan.steps);
    const compact = layoutLearningNodes(nodes, "compact");
    for (const node of compact) for (const id of node.prerequisites) {
      expect(compact.find(n => n.id === id)!.position.y + learningNodeSize("compact").height).toBeLessThan(node.position.y);
    }
    expect(new Set(compact.map(node => `${node.position.x}:${node.position.y}`)).size).toBe(compact.length);
    expect(compact.map(({position: _position,...node}) => node)).toEqual(nodes.map(({position: _position,...node}) => node));
  });
  it("选中知识点呈现完整先修与相邻分支，切换方向不改变节点或证据", () => {
    const focusedPlan = planPath({ graph: subject.graph, mastery, targets: ["c09"], budgetMinutes: 60 });
    const related = relatedLearningNodes(subject.graph, focusedPlan.steps, "c09");
    expect([...related].sort()).toEqual(["c01", "c02", "c05", "c06", "c09", "c10", "c11", "c12"]);
    const subset = learningGraphNodes(subject.graph, mastery, focusedPlan, focusedPlan.steps).filter(node => related.has(node.id));
    const horizontal = layoutLearningNodes(subset);
    const vertical = layoutLearningNodes(subset, "vertical");
    expect(vertical.map(({ position: _position, ...node }) => node)).toEqual(horizontal.map(({ position: _position, ...node }) => node));
    expect(vertical.find(node => node.id === "c01")!.position.y).toBeLessThan(vertical.find(node => node.id === "c09")!.position.y);
    expect(new Set(vertical.map(node => `${node.position.x}:${node.position.y}`)).size).toBe(vertical.length);
    expect(subset.every(node => node.mean === null)).toBe(true);
  });
});

describe.each(SUBJECTS)("$name 图谱几何", subject => {
  it.each(["horizontal", "vertical", "compact"] as const)("%s 无矩形重叠，全部真实先修边绕开其他节点", direction => {
    const mastery = subject.graph.concepts.map(c => initialMastery(c.id, 0));
    const plan = planPath({ graph: subject.graph, mastery, budgetMinutes: 90 });
    const source = learningGraphNodes(subject.graph, mastery, plan, plan.steps);
    const nodes = layoutLearningNodes(source, direction), size = learningNodeSize(direction);
    const reversed = layoutLearningNodes([...source].reverse(), direction);
    for (const node of nodes) expect(reversed.find(n => n.id === node.id)?.position).toEqual(node.position);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].position, b = nodes[j].position;
      expect(a.x + size.width <= b.x || b.x + size.width <= a.x || a.y + size.height <= b.y || b.y + size.height <= a.y).toBe(true);
    }
    const routes = routeLearningEdges(nodes, direction);
    expect(routes.size).toBe(subject.graph.edges.length);
    for (const edge of subject.graph.edges) {
      const points = routes.get(`${edge.before}-${edge.after}`)!;
      expect(points.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < points.length; i++) for (const node of nodes) {
        expect(segmentCrossesRect(points[i-1], points[i], { ...node.position, ...size }), `${edge.before} → ${edge.after} crosses ${node.id}`).toBe(false);
      }
    }
  });
});

describe("learningEdgeVisual：先修边的视觉规则", () => {
  const ctx = (overrides?: Partial<Parameters<typeof learningEdgeVisual>[2]>) => ({
    selectedId: null as string | null,
    showAll: false,
    isBlockedTarget: (id: string) => id === "blocked-kc",
    ...overrides,
  });

  it("常态：普通边全量显示", () => {
    expect(learningEdgeVisual("a", "b", ctx())).toEqual({ tone: "plain", emphasized: false, opacity: 1, dashed: false });
  });

  it("选中节点的相连边高亮强调，其余边淡化", () => {
    expect(learningEdgeVisual("a", "sel", ctx({ selectedId: "sel" }))).toEqual({ tone: "accent", emphasized: true, opacity: 1, dashed: false });
    expect(learningEdgeVisual("sel", "b", ctx({ selectedId: "sel" }))).toEqual({ tone: "accent", emphasized: true, opacity: 1, dashed: false });
    expect(learningEdgeVisual("a", "b", ctx({ selectedId: "sel" }))).toEqual({ tone: "plain", emphasized: false, opacity: 0.3, dashed: false });
  });

  it("指向 blocked 节点的边永远是警示虚线，选中时加粗不改色", () => {
    expect(learningEdgeVisual("a", "blocked-kc", ctx())).toEqual({ tone: "warn", emphasized: false, opacity: 1, dashed: true });
    expect(learningEdgeVisual("sel", "blocked-kc", ctx({ selectedId: "blocked-kc" }))).toEqual({ tone: "warn", emphasized: true, opacity: 1, dashed: true });
    expect(learningEdgeVisual("a", "blocked-kc", ctx({ selectedId: "other" }))).toEqual({ tone: "warn", emphasized: false, opacity: 0.3, dashed: true });
  });

  it("全科模式无选中时整体降权让节点颜色可读", () => {
    expect(learningEdgeVisual("a", "b", ctx({ showAll: true }))).toEqual({ tone: "plain", emphasized: false, opacity: 0.55, dashed: false });
    // 有选中项时选中淡化规则优先于全科降权
    expect(learningEdgeVisual("a", "b", ctx({ showAll: true, selectedId: "sel" }))).toEqual({ tone: "plain", emphasized: false, opacity: 0.3, dashed: false });
  });

  it("源节点是 blocked 目标的判断只看 target，不影响反向边", () => {
    expect(learningEdgeVisual("blocked-kc", "b", ctx()).tone).toBe("plain");
  });
});

describe("learningGraphFileName：导出文件名", () => {
  it("包含目标名与 ISO 日期段", () => {
    expect(learningGraphFileName("数据结构", "2026-11-10T08:00:00.000Z")).toBe("先修图谱-数据结构-2026-11-10.png");
  });

  it("目标名里的非法字符替换为连字符", () => {
    expect(learningGraphFileName('a/b:c "d"', "2026-11-10T08:00:00.000Z")).toBe("先修图谱-a-b-c-d-2026-11-10.png");
  });

  it("非法时间戳退回 export 段；空名退回默认", () => {
    expect(learningGraphFileName("数据结构", "not-a-date")).toBe("先修图谱-数据结构-export.png");
    expect(learningGraphFileName("///", "2026-11-10T08:00:00.000Z")).toBe("先修图谱-学习目标-2026-11-10.png");
  });
});
