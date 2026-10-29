import { describe, it, expect } from "vitest";
import {
  tokenize,
  buildIndex,
  search,
  type Bm25Index,
  type KbDocument,
  type RetrievedDoc,
} from "@/lib/rag";
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
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.kcId).toMatch(/^c\d+$/);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.snippet.length).toBeGreaterThan(0);
    }
  });
});

describe("域外门控", () => {
  it("域外问题返回空，而不是硬塞看似相关的知识点", () => {
    expect(search(kbIndex, "红烧肉怎么做才好吃？", 3)).toEqual([]);
  });

  it("域内同义问法仍然命中", () => {
    const results = search(kbIndex, "什么是渐进分析方法？", 3);
    expect(results.map((r) => r.kcId)).toContain("c04");
  });

  it("单字查询没有非单字词可比，仍按分数返回", () => {
    expect(search(kbIndex, "栈", 3).map((r) => r.kcId)).toContain("c09");
  });

  it("常见短查询不会被中位数或命中数条件误杀", () => {
    // 「排序」命中大量同分文档，top1 相对中位数并不突出，但它确实是域内主题
    expect(search(kbIndex, "排序", 3).length).toBeGreaterThan(0);
    // 「平衡树」的第二个 bigram「衡树」跨了词典里的「平衡二叉树」，不能因此清空
    expect(search(kbIndex, "平衡树", 3).map((r) => r.kcId)).toContain("c32");
  });

  it("只命中一个通用词时清空，不把整条查询当成命中", () => {
    const docs: KbDocument[] = [
      { kcId: "x", title: "排序", text: "排序算法怎么实现，怎么排序，怎么分析" },
      { kcId: "y", title: "图", text: "图的遍历与最短路径" },
    ];
    const index = buildIndex(docs);
    // 「红烧肉怎么做才好吃」里只有「怎么」在 x 中出现，覆盖率 1/8
    expect(search(index, "红烧肉怎么做才好吃", 3)).toEqual([]);
  });

  it("候选分数持平时视为没有突出命中", () => {
    const repeated = "排序算法排序算法排序算法排序算法排序算法";
    const docs: KbDocument[] = [
      { kcId: "a", title: "排序", text: repeated },
      { kcId: "b", title: "排序", text: repeated },
      { kcId: "c", title: "排序", text: repeated },
    ];
    const index = buildIndex(docs);
    // 三篇同分且都过 MIN_SCORE：top1 等于中位数，门控按「没有峰」处理
    expect(search(index, "排序算法", 3)).toEqual([]);
  });
});

/**
 * 标题加权上线前的实现，原样复制在这里作为参照。
 *
 * search 对外只暴露保留 4 位小数的分数，所以「逐位一致」是在
 * 公开输出层面比较：分数、顺序、截断都必须完全相同。
 */
function legacySearch(index: Bm25Index, query: string, k = 3): RetrievedDoc[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const n = index.docs.length;
  const scores: number[] = new Array(n).fill(0);

  for (const q of new Set(qTokens)) {
    const dfq = index.df.get(q);
    if (!dfq) continue;
    const idf = Math.log(1 + (n - dfq + 0.5) / (dfq + 0.5));
    const weight = q.length === 1 ? 0.35 : 1;

    for (let i = 0; i < n; i += 1) {
      const tf = index.docTokens[i].filter((t) => t === q).length;
      if (tf === 0) continue;
      const lenNorm = 1 - 0.75 + (0.75 * index.docLengths[i]) / index.avgLength;
      scores[i] += weight * idf * ((tf * (1.5 + 1)) / (tf + 1.5 * lenNorm));
    }
  }

  return scores
    .map((score, i) => ({ i, score }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i))
    .slice(0, k)
    .map(({ i, score }) => ({
      kcId: index.docs[i].kcId,
      title: index.docs[i].title,
      snippet: index.docs[i].text.slice(0, 160),
      score: Number(score.toFixed(4)),
    }));
}

describe("BM25 标题加权", () => {
  const docs: KbDocument[] = [
    { kcId: "both", title: "heap 线性表", text: "heap heap heap 的插入与删除" },
    { kcId: "title-only", title: "heap", text: "一种完全二叉树" },
    { kcId: "other", title: "栈", text: "后进先出" },
  ];
  const index = buildIndex(docs);

  it("buildIndex 单独保留标题切分，不混入正文", () => {
    expect(index.titleTokens).toHaveLength(docs.length);
    expect(index.titleTokens[0]).toEqual(tokenize("heap 线性表"));
    expect(index.titleTokens[2]).toEqual(tokenize("栈"));
    expect(index.titleTokens[2]).not.toContain("后进");
    expect(index.docTokens[2]).toContain("后进");
  });

  it("默认不读标题加权，通过门控的结果与旧实现逐位一致", () => {
    for (const query of ["heap", "树", "heap 树", "栈", "不存在"]) {
      for (const target of [index, kbIndex]) {
        const legacy = legacySearch(target, query, 10);
        const gated = search(target, query, 10);
        /*
         * 门控是整体放行或整体清空，不会改写分数、顺序或截断，
         * 因此结果必须是旧实现的严格前缀；「heap 树」这类域外查询会被清空。
         */
        expect(gated).toEqual(legacy.slice(0, gated.length));
      }
    }

    // 域内查询必须完整通过，否则上面的前缀断言会退化成 0 === 0
    const legacy = legacySearch(kbIndex, "时间复杂度怎么算", 10);
    expect(legacy.length).toBeGreaterThan(0);
    expect(search(kbIndex, "时间复杂度怎么算", 10)).toEqual(legacy);
  });

  it("titleBoost 为 1、非有限值或不大于 1 时与默认完全相同", () => {
    const query = "栈和队列的区别";
    const baseline = search(kbIndex, query, 10);
    expect(search(kbIndex, query, 10, { titleBoost: 1 })).toEqual(baseline);
    expect(search(kbIndex, query, 10, { titleBoost: 0.5 })).toEqual(baseline);
    expect(search(kbIndex, query, 10, { titleBoost: Number.NaN })).toEqual(baseline);
    expect(search(kbIndex, query, 10, { titleBoost: Number.POSITIVE_INFINITY })).toEqual(baseline);
  });

  it("大于 1 时，只给标题命中追加正向分数", () => {
    const plain = search(index, "heap", 10);
    const boosted = search(index, "heap", 10, { titleBoost: 2 });

    const plainById = new Map(plain.map((r) => [r.kcId, r.score] as const));
    const boostedById = new Map(boosted.map((r) => [r.kcId, r.score] as const));

    expect(boostedById.get("both")!).toBeGreaterThan(plainById.get("both")!);
    // 「other」正文与标题都不含 heap，分数不变。
    expect(plainById.has("other")).toBe(false);
    expect(boostedById.has("other")).toBe(false);
  });

  it("标题命中的文档能被加权抬过 MIN_SCORE", () => {
    const plain = search(index, "heap", 10).map((r) => r.kcId);
    expect(plain).toEqual(["both"]);

    const boosted = search(index, "heap", 10, { titleBoost: 5 }).map((r) => r.kcId);
    expect(boosted).toContain("title-only");
    expect(boosted[0]).toBe("both");
  });

  it("加权后仍然按分数降序、同分按文档顺序", () => {
    const results = search(index, "heap", 10, { titleBoost: 5 });
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});
