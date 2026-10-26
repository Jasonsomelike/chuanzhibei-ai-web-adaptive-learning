import { describe, it, expect } from "vitest";
import {
  validateDraft,
  draftToDirection,
  composeFromExisting,
  extractJson,
  coerceDraft,
  MIN_CONCEPTS,
  MAX_CONCEPTS,
  type DirectionDraft,
} from "@/lib/direction";

/** 构造一个合法的最小草稿。 */
function validDraft(overrides: Partial<DirectionDraft> = {}): DirectionDraft {
  return {
    title: "树结构入门",
    description: "从基本概念到平衡树",
    concepts: [
      { id: "k1", name: "树的基本概念", summary: "结点、度、层次" },
      { id: "k2", name: "二叉树", summary: "左右孩子" },
      { id: "k3", name: "二叉树遍历", summary: "先中后序" },
      { id: "k4", name: "二叉排序树", summary: "中序有序" },
      { id: "k5", name: "平衡二叉树", summary: "平衡因子与旋转" },
    ],
    edges: [
      { before: "k1", after: "k2" },
      { before: "k2", after: "k3" },
      { before: "k3", after: "k4" },
      { before: "k4", after: "k5" },
    ],
    ...overrides,
  };
}

describe("方向草稿校验", () => {
  it("合法草稿没有问题", () => {
    expect(validateDraft(validDraft())).toEqual([]);
  });

  it("拒绝知识点太少", () => {
    const d = validDraft({
      concepts: [{ id: "k1", name: "A", summary: "" }],
      edges: [],
    });
    const issues = validateDraft(d);
    expect(issues.some((i) => i.includes("太少"))).toBe(true);
  });

  it("拒绝知识点太多", () => {
    const many = Array.from({ length: MAX_CONCEPTS + 1 }, (_, i) => ({
      id: `k${i + 1}`,
      name: `点${i + 1}`,
      summary: "",
    }));
    const issues = validateDraft(validDraft({ concepts: many, edges: [] }));
    expect(issues.some((i) => i.includes("太多"))).toBe(true);
  });

  it("拒绝空标题与空描述", () => {
    expect(validateDraft(validDraft({ title: "  " })).some((i) => i.includes("标题"))).toBe(true);
    expect(
      validateDraft(validDraft({ description: " " })).some((i) => i.includes("描述")),
    ).toBe(true);
  });

  it("拒绝不合规的知识点 id", () => {
    const bad = validDraft();
    const concepts = [...bad.concepts];
    concepts[0] = { id: "K1", name: "大写不行", summary: "" };
    const issues = validateDraft({ ...bad, concepts });
    expect(issues.some((i) => i.includes("不合规"))).toBe(true);
  });

  it("拒绝重复的知识点 id", () => {
    const d = validDraft();
    const concepts = [...d.concepts, { id: "k1", name: "重复", summary: "" }];
    const issues = validateDraft({ ...d, concepts });
    expect(issues.some((i) => i.includes("重复"))).toBe(true);
  });

  it("拒绝悬空的边", () => {
    const issues = validateDraft(
      validDraft({ edges: [{ before: "k1", after: "nope" }] }),
    );
    expect(issues.some((i) => i.includes("不存在"))).toBe(true);
  });

  it("拒绝自环", () => {
    const issues = validateDraft(validDraft({ edges: [{ before: "k1", after: "k1" }] }));
    expect(issues.some((i) => i.includes("自己指向自己"))).toBe(true);
  });

  it("拒绝成环的图 —— 这是最关键的一条，有环的图会让路径规划死循环", () => {
    const issues = validateDraft(
      validDraft({
        edges: [
          { before: "k1", after: "k2" },
          { before: "k2", after: "k3" },
          { before: "k3", after: "k1" },
        ],
      }),
    );
    expect(issues.some((i) => i.includes("环"))).toBe(true);
  });

  it("拒绝重复边", () => {
    const issues = validateDraft(
      validDraft({
        edges: [
          { before: "k1", after: "k2" },
          { before: "k1", after: "k2" },
        ],
      }),
    );
    expect(issues.some((i) => i.includes("重复边"))).toBe(true);
  });
});

describe("草稿转方向", () => {
  it("生成带版本的图谱，题库为空", () => {
    const d = draftToDirection(validDraft(), {
      id: "abc",
      userId: "u1",
      subjectId: "custom",
      isPublic: false,
      now: "2026-10-26T00:00:00.000Z",
    });
    expect(d.graph.version).toBe("custom-abc");
    expect(d.graph.concepts).toHaveLength(5);
    expect(d.graph.edges).toHaveLength(4);
    // 自定义方向不提供题库——生成可信题目需要学科知识，宁可不给也不给错题
    expect(d.questions).toHaveLength(0);
    expect(d.isPublic).toBe(false);
  });

  it("知识点都带上「自定义」章节标记", () => {
    const d = draftToDirection(validDraft(), {
      id: "x",
      userId: "u",
      subjectId: "custom",
      isPublic: true,
      now: "2026-10-26T00:00:00.000Z",
    });
    for (const c of d.graph.concepts) expect(c.chapter).toBe("自定义");
  });
});

describe("从现有学科拼装（无模型时的降级）", () => {
  it("能识别「树结构」并挑出相关知识点", () => {
    const d = composeFromExisting("我想系统学一遍树结构");
    expect(d).not.toBeNull();
    expect(d!.concepts.length).toBeGreaterThanOrEqual(MIN_CONCEPTS);
    expect(d!.title).toContain("数据结构");
    // 应该挑到树相关而非排序相关
    const names = d!.concepts.map((c) => c.name).join(" ");
    expect(names).toMatch(/树/);
  });

  it("能识别网络相关描述", () => {
    const d = composeFromExisting("我想了解 TCP 协议和路由");
    expect(d).not.toBeNull();
    expect(d!.title).toContain("计算机网络");
  });

  it("能识别操作系统相关描述", () => {
    const d = composeFromExisting("进程调度和死锁怎么理解");
    expect(d).not.toBeNull();
    expect(d!.title).toContain("操作系统");
  });

  it("完全无关的描述返回 null 而不是硬凑", () => {
    expect(composeFromExisting("我想学做红烧肉")).toBeNull();
    expect(composeFromExisting("")).toBeNull();
  });

  it("拼装出的边两端都在选中集合里", () => {
    const d = composeFromExisting("数据结构里的图和树");
    expect(d).not.toBeNull();
    const ids = new Set(d!.concepts.map((c) => c.id));
    for (const e of d!.edges) {
      expect(ids.has(e.before)).toBe(true);
      expect(ids.has(e.after)).toBe(true);
    }
  });

  it("拼装结果能通过自身校验", () => {
    for (const desc of ["树结构", "网络协议", "进程调度", "矩阵和特征值", "python 装饰器"]) {
      const d = composeFromExisting(desc);
      if (d) expect(validateDraft(d)).toEqual([]);
    }
  });
});

describe("从模型输出抽取 JSON", () => {
  it("直接是 JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("包在 markdown 代码块里", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("前后有解释文字", () => {
    expect(extractJson('好的，这是结果：\n{"a":1}\n希望有帮助')).toEqual({ a: 1 });
  });

  it("完全不是 JSON 返回 null", () => {
    expect(extractJson("我无法完成这个任务")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});

describe("把 unknown 收窄成草稿", () => {
  it("合法结构转换成功", () => {
    const d = coerceDraft({
      title: "t",
      description: "d",
      concepts: [{ id: "k1", name: "n", summary: "s" }],
      edges: [{ before: "k1", after: "k2" }],
    });
    expect(d).not.toBeNull();
    expect(d!.concepts).toHaveLength(1);
    expect(d!.edges).toHaveLength(1);
  });

  it("缺字段返回 null", () => {
    expect(coerceDraft({ title: "t" })).toBeNull();
    expect(coerceDraft(null)).toBeNull();
    expect(coerceDraft("string")).toBeNull();
  });

  it("跳过字段不完整的条目而不是整体失败", () => {
    const d = coerceDraft({
      title: "t",
      description: "d",
      concepts: [{ id: "k1", name: "n" }, { name: "缺 id" }, null],
      edges: [{ before: "k1" }, { before: "k1", after: "k2" }],
    });
    expect(d!.concepts).toHaveLength(1);
    expect(d!.edges).toHaveLength(1);
  });

  it("summary 缺失时补空串", () => {
    const d = coerceDraft({
      title: "t",
      description: "d",
      concepts: [{ id: "k1", name: "n" }],
      edges: [],
    });
    expect(d!.concepts[0].summary).toBe("");
  });
});
