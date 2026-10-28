import { describe, it, expect } from "vitest";
import {
  parseBatch,
  normalizeText,
  checkItem,
  checkBatch,
  contentHashOf,
  compareSolverAnswers,
  buildSolverPrompt,
  parseSolverAnswers,
  tierToDifficulty,
  difficultyLabelIssue,
  kcEvidenceTarget,
  ITEMS_PER_KC,
  type RawItem,
} from "@/lib/itemgen";

const NOW = "2026-10-26T10:00:00.000Z";

function goodItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    difficulty: "advanced",
    difficultyReason: "需要理解并应用栈的后进先出性质",
    stem: "设栈的入栈序列为 1,2,3，则下列哪个不可能是出栈序列？",
    options: ["3,2,1", "1,2,3", "2,1,3", "3,1,2"],
    answerText: "3,1,2",
    explanation:
      "若 3 先出栈，说明 1、2 都已入栈，栈内自底向上为 1,2，栈顶是 2，因此下一个只能出 2 而不能出 1。",
    ...overrides,
  };
}

const META = { directionId: "dir-1", kcId: "k1", now: NOW };

describe("L1 结构校验", () => {
  it("合法批次通过", () => {
    const r = parseBatch({ items: [goodItem()] });
    expect(r.ok).toBe(true);
  });

  it("选项不是 4 个时整批失败", () => {
    const r = parseBatch({ items: [goodItem({ options: ["a", "b", "c"] })] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("结构不合格");
  });

  it("难度档位不在三档内时失败", () => {
    const r = parseBatch({ items: [{ ...goodItem(), difficulty: "hard" }] });
    expect(r.ok).toBe(false);
  });

  it("items 为空时失败", () => {
    expect(parseBatch({ items: [] }).ok).toBe(false);
  });

  it("非对象输入失败而不抛异常", () => {
    expect(parseBatch(null).ok).toBe(false);
    expect(parseBatch("不是 JSON").ok).toBe(false);
  });
});

describe("归一化", () => {
  it("去空白、统一小写、去尾部标点", () => {
    expect(normalizeText("  Stack 是 后进先出。 ")).toBe("stack是后进先出");
    expect(normalizeText("O(1)")).toBe("o(1)");
    expect(normalizeText("A、B、C")).toBe("a、b、c");
  });
});

describe("L2/L3 单题校验", () => {
  it("干净的题判为 accepted 并记录通过项", () => {
    const { item, issues } = checkItem(goodItem(), META);
    expect(issues).toEqual([]);
    expect(item.status).toBe("accepted");
    expect(item.answerIndex).toBe(3);
    expect(item.difficulty).toBe(3);
    expect(item.source).toBe("generated");
    expect(item.checks).toContain("答案唯一匹配");
    expect(item.checks.length).toBeGreaterThanOrEqual(5);
  });

  it("answerText 与选项对不上时判为 rejected（答案不可知，不能判分）", () => {
    /*
     * 曾经把 L3 失败降级成 practice 并把 answerIndex 兜底成 0，
     * 于是诊断按选项 A 判分：学生选真正正确的项也会被判错。
     * 答案不可知时唯一诚实的做法是不展示这道题。
     */
    const { item, issues } = checkItem(goodItem({ answerText: "以上都不对" }), META);
    expect(item.status).toBe("rejected");
    expect(issues.join()).toContain("answerText 与任何选项都不逐字相同");
  });

  it("选项重复判为 rejected", () => {
    const { item, issues } = checkItem(
      goodItem({ options: ["A 选项", "A 选项", "B", "C"] }),
      META,
    );
    expect(item.status).toBe("rejected");
    expect(issues.join()).toContain("选项归一化后存在重复");
  });

  it("空白差异不算重复", () => {
    const { item } = checkItem(
      goodItem({ options: ["O(n)", "o(n) ", "O(n log n)", "O(1)"] }),
      META,
    );
    // 归一化后前两项相同 → rejected
    expect(item.status).toBe("rejected");
  });

  it("禁用表述判为 rejected", () => {
    for (const bad of ["以上都对", "以上都不对", "无法确定", "All of the above"]) {
      const { item } = checkItem(
        goodItem({ options: ["A", "B", "C", bad], answerText: "A" }),
        META,
      );
      expect(item.status).toBe("rejected");
    }
  });

  it("题干过短判为 rejected", () => {
    const { item } = checkItem(goodItem({ stem: "栈是？" }), META);
    expect(item.status).toBe("rejected");
  });

  it("解析过短判为 rejected", () => {
    const { item } = checkItem(goodItem({ explanation: "因为栈。" }), META);
    expect(item.status).toBe("rejected");
  });

  it("解析不含答案片段时判为 rejected（方案 L2 规则）", () => {
    const { item, issues } = checkItem(
      goodItem({
        answerText: "栈顶元素必须先于栈底元素弹出",
        options: ["栈顶元素必须先于栈底元素弹出", "栈底元素先出", "同时出", "无顺序"],
        explanation:
          "栈只允许在栈顶插入删除，所以顺序受到严格限制，需要逐步模拟每次进出栈的过程才能判断。",
      }),
      META,
    );
    expect(item.status).toBe("rejected");
    expect(issues.join()).toContain("解析未包含正确选项");
  });

  it("短答案不做解析片段检查（可判定性边界）", () => {
    const { item, issues } = checkItem(goodItem(), META);
    expect(item.status).toBe("accepted");
    expect(issues).toEqual([]);
  });

  it("同 KC 内题干重复判为 rejected", () => {
    const seen = new Set([normalizeText(goodItem().stem)]);
    const { item } = checkItem(goodItem(), { ...META, seenStems: seen });
    expect(item.status).toBe("rejected");
  });

  it("难度三档映射到 2/3/4", () => {
    expect(tierToDifficulty("basic")).toBe(2);
    expect(tierToDifficulty("advanced")).toBe(3);
    expect(tierToDifficulty("challenge")).toBe(4);
    for (const tier of ["basic", "advanced", "challenge"] as const) {
      const { item } = checkItem(goodItem({ difficulty: tier }), META);
      expect([2, 3, 4]).toContain(item.difficulty);
    }
  });
});

describe("整批校验", () => {
  it("同批内重复题干只保留第一题", () => {
    const results = checkBatch(
      { items: [goodItem(), goodItem({ options: ["3,2,1", "1,2,3", "2,1,3", "3,1,2"] })] },
      META,
    );
    expect(results).toHaveLength(2);
    expect(results[0].item.status).toBe("accepted");
    expect(results[1].item.status).toBe("rejected");
  });

  it("每题的 contentHash 稳定且互不相同", () => {
    const a = checkItem(goodItem(), META).item;
    const b = checkItem(goodItem(), META).item;
    const c = checkItem(goodItem({ stem: "另一道完全不同的题目内容在这里出现？" }), META).item;
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.id).toBe(b.id);
    expect(a.contentHash).not.toBe(c.contentHash);
  });

  it("contentHash 与选项顺序无关，与文本有关", () => {
    const base = { kcId: "k1", stem: "s", options: ["a", "b"], explanation: "e" };
    expect(contentHashOf(base)).toBe(contentHashOf(base));
    expect(contentHashOf(base)).not.toBe(contentHashOf({ ...base, stem: "s2" }));
  });
});

describe("L4 双解校验协议", () => {
  const items = [
    { stem: "题目一", options: ["甲", "乙", "丙", "丁"] },
    { stem: "题目二", options: ["A", "B", "C", "D"] },
  ];

  it("反转选项顺序时选项文本集合不变", () => {
    const normal = buildSolverPrompt(items, false);
    const reversed = buildSolverPrompt(items, true);
    expect(normal).not.toBe(reversed);
    for (const opt of ["甲", "乙", "丙", "丁"]) {
      expect(reversed).toContain(opt);
    }
    // 反转后第一个选项应是原来的最后一个
    expect(reversed.indexOf("丁")).toBeLessThan(reversed.indexOf("甲"));
  });

  it("提示词不给答案与解析", () => {
    const prompt = buildSolverPrompt(items, false);
    expect(prompt).not.toContain("解析");
    expect(prompt).not.toContain("正确答案是");
    expect(prompt).toContain("answerText");
  });

  it("两次一致才算通过", () => {
    expect(compareSolverAnswers(["甲", "C"], ["甲", "C"], ["甲", "C"])).toEqual([true, true]);
  });

  it("任一次不一致即不通过", () => {
    // 第一次不一致：第 1 题选了乙
    expect(compareSolverAnswers(["甲", "C"], ["乙", "C"], ["甲", "C"])).toEqual([false, true]);
    // 第二次（反转顺序）不一致：第 1 题选了乙
    expect(compareSolverAnswers(["甲", "C"], ["甲", "C"], ["乙", "C"])).toEqual([false, true]);
  });

  it("比对忽略空白与大小写", () => {
    expect(compareSolverAnswers(["O(n)"], ["o(n) "], [" O(N)"])).toEqual([true]);
  });
});

describe("L4 批解按下标落槽", () => {
  /*
   * 两次批解是并发发出的，模型返回的数组顺序与题号没有任何约定。
   * 按数组顺序取会让正确答案整体错位，全部被判成「两次不一致」，
   * 于是整批题被降级为 practice——这正是缺陷 3 的表现。
   */
  it("乱序 answers 逐位对齐到题号", () => {
    const { answers, issues } = parseSolverAnswers(
      {
        answers: [
          { index: 3, answerText: "丙" },
          { index: 1, answerText: "甲" },
          { index: 4, answerText: "丁" },
          { index: 2, answerText: "乙" },
        ],
      },
      4,
    );
    expect(answers).toEqual(["甲", "乙", "丙", "丁"]);
    expect(issues).toEqual([]);
  });

  it("缺一条时对应槽位留空，其余仍按 index 对齐", () => {
    const { answers, issues } = parseSolverAnswers(
      {
        answers: [
          { index: 3, answerText: "丙" },
          { index: 1, answerText: "甲" },
        ],
      },
      4,
    );
    expect(answers).toEqual(["甲", "", "丙", ""]);
    expect(issues).toEqual([]);
  });

  it("重复 index 取最后一条并记 issue", () => {
    const { answers, issues } = parseSolverAnswers(
      {
        answers: [
          { index: 1, answerText: "甲" },
          { index: 1, answerText: "乙" },
        ],
      },
      2,
    );
    expect(answers).toEqual(["乙", ""]);
    expect(issues).toHaveLength(1);
    expect(issues.join("；")).toContain("重复");
  });

  it("越界 index 丢弃并记 issue，不影响合法项", () => {
    const { answers, issues } = parseSolverAnswers(
      {
        answers: [
          { index: 0, answerText: "零" },
          { index: 1, answerText: "甲" },
          { index: 5, answerText: "越界" },
        ],
      },
      2,
    );
    expect(answers).toEqual(["甲", ""]);
    expect(issues).toHaveLength(2);
    expect(issues.join("；")).toContain("越界");
  });

  it("提示词要求 index 从 1 开始且覆盖每一题", () => {
    const prompt = buildSolverPrompt(
      [{ stem: "题目一", options: ["甲", "乙", "丙", "丁"] }],
      false,
    );
    expect(prompt).toContain("从 1 开始");
    expect(prompt).toContain("覆盖每一题");
    expect(prompt).not.toContain("解析");
    expect(prompt).not.toContain("正确答案是");
  });
});

describe("L5 难度理由", () => {
  it("理由与档位相符时无问题", () => {
    expect(difficultyLabelIssue(goodItem())).toBeNull();
  });

  it("理由缺失时提示", () => {
    expect(difficultyLabelIssue(goodItem({ difficultyReason: undefined }))).toContain("缺少难度理由");
  });

  it("理由与档位不符时提示", () => {
    const issue = difficultyLabelIssue(
      goodItem({ difficulty: "challenge", difficultyReason: "这是一道基础记忆题" }),
    );
    expect(issue).toContain("不匹配");
  });
});

describe("证据门槛按题目来源区分（回归）", () => {
  /**
   * 此前 ensureItems 一律用 ITEMS_PER_KC=4 判断缓存命中，
   * 导致「已有 3 道人工校准题」的知识点仍被判不足、白跑一次生成并报假失败。
   */
  it("含生成题时要求 4 道", () => {
    expect(kcEvidenceTarget(["generated"])).toBe(ITEMS_PER_KC);
    expect(kcEvidenceTarget(["generated", "manual"])).toBe(ITEMS_PER_KC);
  });

  it("只有人工题与借用题时只需 3 道", () => {
    expect(kcEvidenceTarget(["manual"])).toBe(3);
    expect(kcEvidenceTarget(["borrowed"])).toBe(3);
    expect(kcEvidenceTarget(["manual", "borrowed"])).toBe(3);
  });

  it("三档难度映射到 2/3/4", () => {
    expect(tierToDifficulty("basic")).toBe(2);
    expect(tierToDifficulty("advanced")).toBe(3);
    expect(tierToDifficulty("challenge")).toBe(4);
  });
});
