import { describe, it, expect } from "vitest";
import { tokenize, buildIndex, search, type KbDocument } from "@/lib/rag";
import { kbDocuments, kbIndex } from "@/data/kb";

describe("中文 bigram 切分", () => {
  it("中文按 bigram + 单字切分", () => {
    const tokens = tokenize("时间复杂度");
    // 5 个字 → 4 个 bigram：时间、间复、复杂、杂度
    expect(tokens).toContain("时间");
    expect(tokens).toContain("间复");
    expect(tokens).toContain("复杂");
    expect(tokens).toContain("杂度");
    // 单字也要有，用于短查询兜底
    expect(tokens).toContain("时");
    expect(tokens).toContain("度");
  });

  it("六字词产生五个 bigram", () => {
    const tokens = tokenize("时间复杂度分析");
    expect(tokens).toContain("度分");
    expect(tokens).toContain("分析");
  });

  it("英文单词整体保留", () => {
    expect(tokenize("O(n log n)")).toContain("log");
    expect(tokenize("KMP algorithm")).toContain("kmp");
    expect(tokenize("KMP algorithm")).toContain("algorithm");
  });

  it("标点被剥离", () => {
    const tokens = tokenize("栈，后进先出。");
    expect(tokens).not.toContain("，");
    expect(tokens).not.toContain("。");
  });

  it("空输入返回空数组", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("BM25 检索", () => {
  const docs: KbDocument[] = [
    { kcId: "a", title: "栈", text: "后进先出，只允许在栈顶操作" },
    { kcId: "b", title: "队列", text: "先进先出，队尾入队头出" },
    { kcId: "c", title: "二叉树", text: "每个结点最多两个孩子，有先中后序遍历" },
  ];
  const index = buildIndex(docs);

  it("能检索到相关文档", () => {
    const results = search(index, "栈");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].kcId).toBe("a");
  });

  it("结果按分数降序", () => {
    const results = search(index, "先进先出");
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("无相关词时返回空，而不是硬塞结果", () => {
    const results = search(index, "量子纠缠");
    expect(results).toEqual([]);
  });

  it("尊重 top-k 限制", () => {
    expect(search(index, "遍历", 1).length).toBeLessThanOrEqual(1);
  });

  it("空查询返回空", () => {
    expect(search(index, "")).toEqual([]);
  });
});

describe("真实知识库", () => {
  it("40 个知识点各一篇文档", () => {
    expect(kbDocuments).toHaveLength(40);
  });

  it("检索「时间复杂度」命中复杂度相关知识点", () => {
    const results = search(kbIndex, "时间复杂度怎么算", 3);
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.kcId);
    expect(ids).toContain("c02");
  });

  it("检索「快速排序」命中排序相关知识点", () => {
    const results = search(kbIndex, "快速排序最坏情况", 3);
    const ids = results.map((r) => r.kcId);
    expect(ids.some((id) => id === "c37" || id === "c40")).toBe(true);
  });

  it("检索「哈希冲突」命中哈希表", () => {
    const results = search(kbIndex, "哈希冲突怎么处理", 3);
    expect(results.map((r) => r.kcId)).toContain("c34");
  });

  it("每条结果都带可引用的 kcId 与标题", () => {
    const results = search(kbIndex, "栈和队列的区别", 3);
    for (const r of results) {
      expect(r.kcId).toMatch(/^c\d+$/);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.snippet.length).toBeGreaterThan(0);
    }
  });
});
