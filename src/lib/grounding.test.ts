import { describe, expect, it } from "vitest";

import {
  buildAnswerPlan,
  screenWebResults,
  type WebScreenInput,
} from "@/lib/grounding";
import type { MaterialExcerpt } from "@/lib/materials";
import type { WebResult } from "@/lib/websearch";
import {
  buildTutorUserPrompt,
  citedMaterialSources,
  ensureAnswerDeclaration,
} from "@/components/tutor-logic";

function web(title: string, snippet: string): WebResult {
  return {
    title,
    snippet,
    url: `https://example.com/${encodeURIComponent(title)}`,
    provider: "wikipedia",
  };
}

const CONTEXT: WebScreenInput = {
  directionTerms: ["数据结构", "第5章 树与二叉树"],
  kcNames: ["树的基本概念", "二叉树的遍历", "哈夫曼树"],
  question: "什么是树",
};

const RELEVANT = web(
  "树（数据结构）",
  "树是一种抽象数据类型；二叉树是常见的树结构，每个结点最多有两个子树。",
);
const BTRFS = web(
  "Btrfs",
  "Btrfs 是一个 Linux 文件系统，使用 B 树组织磁盘上的数据，支持快照与校验。",
);
const BUDDHISM = web(
  "菩提树",
  "菩提树在佛教经典中具有象征意义，传说佛陀在菩提树下悟道。",
);
const PLANT = web("树 - 维基百科", "树是木本植物，具有树干、树枝与树根。");
const TITLE_MISMATCH = web(
  "Linux 内核文件系统",
  "本章介绍数据结构在文件系统中的应用，其中顺带提到 B 树。",
);

describe("screenWebResults", () => {
  it("保留与方向相关的网页，丢掉只共享「树」的文件系统 / 宗教网页", () => {
    const result = screenWebResults([RELEVANT, BTRFS, BUDDHISM, PLANT], CONTEXT);

    expect(result.kept.map((item) => item.result.title)).toEqual(["树（数据结构）"]);

    const byTitle = new Map(result.dropped.map((item) => [item.result.title, item]));
    expect(byTitle.get("Btrfs")?.reason).toBe("generic-only");
    expect(byTitle.get("菩提树")?.reason).toBe("generic-only");
    expect(byTitle.get("树 - 维基百科")?.reason).toBe("generic-only");
    expect(byTitle.get("Btrfs")?.detail).toContain("泛词");
  });

  it("标题与主题无关、只有正文顺带提到上下文词的也丢掉", () => {
    const result = screenWebResults([TITLE_MISMATCH], CONTEXT);
    expect(result.kept).toEqual([]);
    expect(result.dropped[0]?.reason).toBe("title-mismatch");
  });

  it("标题是泛词但正文给出完整方向名时仍可保留", () => {
    const genericTitleRelevant = web(
      "树 - 维基百科",
      "在数据结构中，树是一种非线性结构；二叉树、哈夫曼树都属于树。",
    );
    const result = screenWebResults([genericTitleRelevant], CONTEXT);
    expect(result.kept.map((item) => item.result.title)).toEqual(["树 - 维基百科"]);
  });

  it("按分数排序，最相关的排在最前", () => {
    const weak = web("二叉树", "二叉树是一种树结构。");
    const strong = web(
      "树（数据结构）",
      "树是数据结构中的非线性结构，二叉树的遍历是常见考点。",
    );
    const result = screenWebResults([weak, strong], CONTEXT);
    expect(result.kept[0]?.result.title).toBe("树（数据结构）");
  });

  it("上下文为空时不放行任何网页，也不抛错", () => {
    const empty: WebScreenInput = { directionTerms: [], kcNames: [], question: "" };
    const result = screenWebResults([RELEVANT, BTRFS], empty);
    expect(result.kept).toEqual([]);
    expect(result.dropped.every((item) => item.reason !== "title-mismatch")).toBe(true);
  });

  it("中英混合问题「什么是 B 树」能保留 B 树页面", () => {
    const result = screenWebResults(
      [web("B树 - 维基百科", "B树是一种自平衡的多路搜索树，常用于数据库索引。")],
      {
        directionTerms: ["数据结构"],
        kcNames: ["树的基本概念", "二叉树的遍历"],
        question: "什么是B树",
      },
    );
    expect(result.kept.map((item) => item.result.title)).toEqual(["B树 - 维基百科"]);
  });

  it("方向词里的 B 树页面在操作系统方向下仍可命中", () => {
    const osContext: WebScreenInput = {
      directionTerms: ["操作系统", "文件系统"],
      kcNames: ["文件系统的实现", "磁盘调度"],
      question: "Btrfs 是什么文件系统",
    };
    const btrfs = web(
      "Btrfs - 维基百科",
      "Btrfs 是一种 Linux 文件系统，使用 B 树管理磁盘数据。",
    );
    const result = screenWebResults([btrfs], osContext);
    expect(result.kept.map((item) => item.result.title)).toEqual(["Btrfs - 维基百科"]);
  });
});

describe("buildAnswerPlan", () => {
  it("教材命中时走 grounded，以教材为准并允许网络补充", () => {
    const plan = buildAnswerPlan({ materialHits: 2, webHits: 3, generalAllowed: true });
    expect(plan.mode).toBe("grounded");
    expect(plan.mustUseMaterial).toBe(true);
    expect(plan.webAllowed).toBe(true);
    expect(plan.declaration).toContain("教材");
    expect(plan.declaration).toContain("出处");
  });

  it("教材未命中且允许通用知识时必须声明「不是来自你的教材」", () => {
    const plan = buildAnswerPlan({ materialHits: 0, webHits: 2, generalAllowed: true });
    expect(plan.mode).toBe("general-only");
    expect(plan.mustUseMaterial).toBe(false);
    expect(plan.webAllowed).toBe(true);
    expect(plan.declaration).toContain("不是来自你的教材");
  });

  it("教材未命中且不允许通用知识时只给拒绝提示", () => {
    const plan = buildAnswerPlan({ materialHits: 0, webHits: 3, generalAllowed: false });
    expect(plan.mode).toBe("refuse-hint");
    expect(plan.webAllowed).toBe(false);
    expect(plan.declaration).toContain("没有找到");
  });

  it("坏输入按 0 命中处理，不因 NaN / 负数放行", () => {
    expect(
      buildAnswerPlan({ materialHits: Number.NaN, webHits: -1, generalAllowed: false }).mode,
    ).toBe("refuse-hint");
    expect(
      buildAnswerPlan({ materialHits: -3, webHits: Number.NaN, generalAllowed: true }).mode,
    ).toBe("general-only");
  });
});

describe("ensureAnswerDeclaration", () => {
  const generalPlan = buildAnswerPlan({
    materialHits: 0,
    webHits: 0,
    generalAllowed: true,
  });
  const groundedPlan = buildAnswerPlan({
    materialHits: 1,
    webHits: 0,
    generalAllowed: true,
  });
  const refusePlan = buildAnswerPlan({
    materialHits: 0,
    webHits: 0,
    generalAllowed: false,
  });

  it("通用知识回答缺声明时补在最前面", () => {
    const text = ensureAnswerDeclaration("树是一种抽象数据类型。", generalPlan);
    expect(text.startsWith(generalPlan.declaration)).toBe(true);
    expect(text).toContain("树是一种抽象数据类型");
  });

  it("已经声明过时不重复添加", () => {
    const reply = `${generalPlan.declaration}\n\n树是一种抽象数据类型。`;
    expect(ensureAnswerDeclaration(reply, generalPlan)).toBe(reply);
  });

  it("教材命中时不改写回答", () => {
    expect(ensureAnswerDeclaration("树是…… [c15]", groundedPlan)).toBe("树是…… [c15]");
  });

  it("不允许通用知识时只保留拒绝提示", () => {
    expect(ensureAnswerDeclaration("模型自己编的答案", refusePlan)).toBe(
      refusePlan.declaration,
    );
  });
});

const EXCERPT_TREE: MaterialExcerpt = {
  chunkId: "chunk-tree",
  sourceId: "src-textbook",
  sourceTitle: "数据结构（C 语言版）",
  kind: "textbook",
  chapter: "第5章 树与二叉树",
  section: "5.1",
  pageFrom: 120,
  pageTo: 121,
  text: "树是 n 个结点的有限集合。",
  truncated: false,
};

describe("citedMaterialSources", () => {
  it("只列出真正被引用的知识点对应的教材出处", () => {
    const excerpts = new Map<string, MaterialExcerpt>([["c15", EXCERPT_TREE]]);
    expect(citedMaterialSources(excerpts, ["c15"])).toEqual([
      "[教材·《数据结构（C 语言版）》·第5章 树与二叉树·第120–121页]",
    ]);
    expect(citedMaterialSources(excerpts, [])).toEqual([]);
    expect(citedMaterialSources(excerpts, ["c99"])).toEqual([]);
  });
});

describe("提示词口径", () => {
  it("通用知识模式把声明句与「无关网页忽略」写进提示词", () => {
    const plan = buildAnswerPlan({ materialHits: 0, webHits: 1, generalAllowed: true });
    const prompt = buildTutorUserPrompt({
      question: "什么是树",
      docs: [],
      mastery: [],
      materialContext: "",
      uploadContext: "",
      webContext: "[网络1] 《树》 example.com",
      plan,
    });

    expect(prompt).toContain(plan.declaration);
    expect(prompt).toContain("不是来自你的教材");
    expect(prompt).toContain("与当前方向无关的网页一律忽略");
    expect(prompt).toContain("没有检索到相关知识点");
  });

  it("教材命中时要求只依据摘录并给出处", () => {
    const plan = buildAnswerPlan({ materialHits: 1, webHits: 0, generalAllowed: true });
    const prompt = buildTutorUserPrompt({
      question: "什么是树",
      docs: [],
      mastery: [],
      materialContext: "[教材·《A》·第1页]\n树是有限结点集合。",
      uploadContext: "",
      webContext: "",
      plan,
    });

    expect(prompt).toContain("教材 / 上传资料已命中");
    expect(prompt).toContain("不得用网络结果替代教材");
    expect(prompt).toContain("本次没有可注入的网络结果");
  });
});
