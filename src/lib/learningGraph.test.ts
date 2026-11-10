import { describe, expect, it } from "vitest";
import { SUBJECTS } from "@/data/subjects";
import { initialMastery } from "@/lib/mastery";
import { planPath } from "@/lib/plan";
import { layoutLearningNodes, learningEdgeVisual, learningGraphFileName, learningGraphNodes, relatedLearningNodes } from "@/lib/learningGraph";
import type { KnowledgeGraph } from "@/lib/graph";

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
