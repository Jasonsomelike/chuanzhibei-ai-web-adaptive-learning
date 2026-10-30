import { describe, expect, it } from "vitest";

import type { KnowledgeGraph } from "@/lib/graph";
import type { MaterialPack } from "@/lib/materials";
import {
  hasReadingContent,
  kcReadingViews,
  topExcerptLabel,
} from "@/lib/kcMaterialReading";

const GRAPH: KnowledgeGraph = {
  version: "test",
  concepts: [
    { id: "k1", name: "概念一", summary: "", chapter: "第3章 栈" },
    { id: "k2", name: "概念二", summary: "", chapter: "第3章 栈" },
    { id: "k3", name: "概念三", summary: "", chapter: "第4章 串" },
  ],
  edges: [],
};

function pack(partial?: Partial<MaterialPack>): MaterialPack {
  return {
    id: "p",
    title: "包",
    sources: [
      { id: "textbook", kind: "textbook", title: "教材" },
      { id: "upload-doc", kind: "lecture", title: "我的讲义" },
    ],
    chunks: [
      {
        id: "c1",
        sourceId: "textbook",
        kcIds: ["k1"],
        chapter: "第3章 栈",
        section: "3.1 定义",
        pageFrom: 45,
        pageTo: 46,
        text: "栈是后进先出的线性表。",
      },
      {
        id: "c2",
        sourceId: "textbook",
        kcIds: ["k1", "k2"],
        chapter: "第3章 栈",
        section: "3.2 存储",
        pageFrom: 47,
        text: "顺序栈用数组存放元素。",
      },
      {
        id: "c3",
        sourceId: "upload-doc",
        kcIds: ["k1"],
        chapter: "第3章 栈",
        section: "我的笔记",
        text: "我自己补的讲义片段。",
      },
    ],
    claims: [],
    ...partial,
  };
}

const BOTH_SELECTED = { sourceIds: ["textbook", "upload-doc"], resolutions: {} } as const;
const ONLY_TEXTBOOK = { sourceIds: ["textbook"], resolutions: {} } as const;
const NOTHING_SELECTED = { sourceIds: [], resolutions: {} } as const;

describe("kcReadingViews", () => {
  it("按知识点列出全部命中片段，引用抬头含来源与页码", () => {
    const views = kcReadingViews(pack(), GRAPH.concepts, BOTH_SELECTED);
    const k1 = views.flatMap((v) => v.items).find((i) => i.kcId === "k1")!;

    // c1 只绑 k1；c2 绑 k1+k2 → k1 命中 c1、c2、c3 共 3 条
    expect(k1.hasContent).toBe(true);
    expect(k1.entries).toHaveLength(3);
    expect(k1.entries[0].label).toBe("[教材·《教材》·第3章 栈·第45–46页]");
    expect(k1.entries[0].text).toBe("栈是后进先出的线性表。");
    expect(k1.entries[2].label).toBe("[讲义·《我的讲义》·第3章 栈]");
    // 多知识点共享的 c2 也完整出现在 k2 名下
    const k2 = views.flatMap((v) => v.items).find((i) => i.kcId === "k2")!;
    expect(k2.entries).toHaveLength(1);
    expect(k2.entries[0].text).toBe("顺序栈用数组存放元素。");
  });

  it("未选中的来源不出现（与出题口径一致）", () => {
    const views = kcReadingViews(pack(), GRAPH.concepts, ONLY_TEXTBOOK);
    const k1 = views.flatMap((v) => v.items).find((i) => i.kcId === "k1")!;
    expect(k1.entries).toHaveLength(2);
    expect(k1.entries.every((e) => e.label.startsWith("[教材"))).toBe(true);
  });

  it("没有命中片段的知识点标记 hasContent=false", () => {
    const views = kcReadingViews(pack(), GRAPH.concepts, BOTH_SELECTED);
    const k3 = views.flatMap((v) => v.items).find((i) => i.kcId === "k3")!;
    expect(k3.hasContent).toBe(false);
    expect(k3.entries).toHaveLength(0);
  });

  it("按章节分组，并统计有原文的知识点数", () => {
    const views = kcReadingViews(pack(), GRAPH.concepts, BOTH_SELECTED);
    expect(views.map((v) => v.chapter)).toEqual(["第3章 栈", "第4章 串"]);
    expect(views[0].withContentCount).toBe(2);
    expect(views[1].withContentCount).toBe(0);
  });

  it("空选择时全部知识点 hasContent=false", () => {
    const views = kcReadingViews(pack(), GRAPH.concepts, NOTHING_SELECTED);
    expect(hasReadingContent(views)).toBe(false);
  });
});

describe("hasReadingContent", () => {
  it("任一知识点有原文即返回 true", () => {
    const views = kcReadingViews(pack(), GRAPH.concepts, ONLY_TEXTBOOK);
    expect(hasReadingContent(views)).toBe(true);
  });

  it("空数组返回 false", () => {
    expect(hasReadingContent([])).toBe(false);
  });
});

describe("topExcerptLabel", () => {
  it("返回最高优先级一条的引用抬头", () => {
    expect(topExcerptLabel(pack(), GRAPH.concepts[0], BOTH_SELECTED)).toBe(
      "[教材·《教材》·第3章 栈·第45–46页]",
    );
  });

  it("concept 缺省或没有命中时返回 null", () => {
    expect(topExcerptLabel(pack(), undefined, BOTH_SELECTED)).toBe(null);
    expect(topExcerptLabel(pack(), GRAPH.concepts[2], BOTH_SELECTED)).toBe(null);
  });
});
