import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { kbDocuments } from "@/data/kb";
import {
  EvalDataError,
  countByCategory,
  evaluateRetrieval,
  parseEvalItems,
  type EvalItem,
  type EvalRetriever,
} from "@/lib/ragEval";

function jsonl(...items: unknown[]): string {
  return items.map((item) => JSON.stringify(item)).join("\n");
}

function item(partial: Partial<EvalItem> & Pick<EvalItem, "id" | "category" | "query">): EvalItem {
  return {
    goldKcIds: [],
    relatedKcIds: [],
    ...partial,
  };
}

describe("parseEvalItems：按类别校验", () => {
  it("四类合法条目都能解析", () => {
    const raw = jsonl(
      {
        id: "lit-1",
        category: "literal",
        query: "q1",
        goldKcIds: ["c01"],
        relatedKcIds: [],
        goldPhrase: "金句一",
      },
      {
        id: "para-1",
        category: "paraphrase",
        query: "q2",
        goldKcIds: ["c02"],
        relatedKcIds: [],
        goldPhrase: "金句二",
      },
      {
        id: "abs-1",
        category: "answer-absent",
        query: "q3",
        goldKcIds: [],
        relatedKcIds: ["c03", "c04"],
      },
      {
        id: "ood-1",
        category: "out-of-domain",
        query: "q4",
        goldKcIds: [],
        relatedKcIds: [],
      },
    );

    const items = parseEvalItems(raw);
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({
      id: "lit-1",
      category: "literal",
      query: "q1",
      goldKcIds: ["c01"],
      relatedKcIds: [],
      goldPhrase: "金句一",
    });
    expect(countByCategory(items)).toEqual({
      literal: 1,
      paraphrase: 1,
      "answer-absent": 1,
      "out-of-domain": 1,
    });
  });

  it("忽略空行与行尾换行", () => {
    const raw =
      jsonl(
        {
          id: "ood-1",
          category: "out-of-domain",
          query: "q",
          goldKcIds: [],
          relatedKcIds: [],
        },
      ) + "\n\n";
    expect(parseEvalItems(raw)).toHaveLength(1);
  });

  it("literal 的 goldKcIds 不能为空", () => {
    const raw = jsonl({
      id: "a",
      category: "literal",
      query: "q",
      goldKcIds: [],
      relatedKcIds: [],
      goldPhrase: "x",
    });
    expect(() => parseEvalItems(raw)).toThrow(EvalDataError);
    expect(() => parseEvalItems(raw)).toThrow(/第 1 行：literal 的 goldKcIds 不能为空/);
  });

  it("literal 必须有 goldPhrase", () => {
    const raw = jsonl({
      id: "a",
      category: "literal",
      query: "q",
      goldKcIds: ["c01"],
      relatedKcIds: [],
    });
    expect(() => parseEvalItems(raw)).toThrow(/literal 必须有 goldPhrase/);
  });

  it("paraphrase 的 goldPhrase 不能是空白", () => {
    const raw = jsonl({
      id: "a",
      category: "paraphrase",
      query: "q",
      goldKcIds: ["c01"],
      relatedKcIds: [],
      goldPhrase: "   ",
    });
    expect(() => parseEvalItems(raw)).toThrow(/必须有 goldPhrase/);
  });

  it("answer-absent 的 goldKcIds 必须为空", () => {
    const raw = jsonl({
      id: "a",
      category: "answer-absent",
      query: "q",
      goldKcIds: ["c01"],
      relatedKcIds: ["c02"],
    });
    expect(() => parseEvalItems(raw)).toThrow(/answer-absent 的 goldKcIds 必须为空/);
  });

  it("answer-absent 的 relatedKcIds 不能为空", () => {
    const raw = jsonl({
      id: "a",
      category: "answer-absent",
      query: "q",
      goldKcIds: [],
      relatedKcIds: [],
    });
    expect(() => parseEvalItems(raw)).toThrow(/answer-absent 的 relatedKcIds 不能为空/);
  });

  it("out-of-domain 的 goldKcIds 必须为空", () => {
    const raw = jsonl({
      id: "a",
      category: "out-of-domain",
      query: "q",
      goldKcIds: ["c01"],
      relatedKcIds: [],
    });
    expect(() => parseEvalItems(raw)).toThrow(/out-of-domain 的 goldKcIds 必须为空/);
  });

  it("out-of-domain 的 relatedKcIds 必须为空", () => {
    const raw = jsonl({
      id: "a",
      category: "out-of-domain",
      query: "q",
      goldKcIds: [],
      relatedKcIds: ["c01"],
    });
    expect(() => parseEvalItems(raw)).toThrow(/out-of-domain 的 relatedKcIds 必须为空/);
  });

  it("id 重复时报错并给出行号", () => {
    const raw = jsonl(
      {
        id: "dup",
        category: "out-of-domain",
        query: "q1",
        goldKcIds: [],
        relatedKcIds: [],
      },
      {
        id: "dup",
        category: "out-of-domain",
        query: "q2",
        goldKcIds: [],
        relatedKcIds: [],
      },
    );
    expect(() => parseEvalItems(raw)).toThrow(/第 2 行：id dup 重复/);
  });

  it("未知类别报错", () => {
    const raw = jsonl({
      id: "a",
      category: "unknown",
      query: "q",
      goldKcIds: [],
      relatedKcIds: [],
    });
    expect(() => parseEvalItems(raw)).toThrow(/未知类别 unknown/);
  });

  it("坏 JSON 带行号报错", () => {
    expect(() => parseEvalItems("{not json}")).toThrow(/第 1 行：不是合法 JSON/);
  });

  it("行内容不是对象时报错", () => {
    expect(() => parseEvalItems("[1,2,3]")).toThrow(/每行必须是一个 JSON 对象/);
  });

  it("goldKcIds 不是数组时报错", () => {
    const raw = jsonl({
      id: "a",
      category: "literal",
      query: "q",
      goldKcIds: "c01",
      relatedKcIds: [],
      goldPhrase: "x",
    });
    expect(() => parseEvalItems(raw)).toThrow(/字段 goldKcIds 必须是字符串数组/);
  });

  it("数组元素为空串或重复时报错", () => {
    const withEmpty = jsonl({
      id: "a",
      category: "literal",
      query: "q",
      goldKcIds: ["c01", " "],
      relatedKcIds: [],
      goldPhrase: "x",
    });
    expect(() => parseEvalItems(withEmpty)).toThrow(/只能包含非空字符串/);

    const withDuplicate = jsonl({
      id: "a",
      category: "literal",
      query: "q",
      goldKcIds: ["c01", "c01"],
      relatedKcIds: [],
      goldPhrase: "x",
    });
    expect(() => parseEvalItems(withDuplicate)).toThrow(/goldKcIds 中的 c01 重复/);
  });

  it("空评测集报错", () => {
    expect(() => parseEvalItems("\n\n")).toThrow(/评测集为空/);
  });
});

describe("evaluateRetrieval：全文金句判定", () => {
  it("金句在 160 字之后也能命中（证明没走 snippet）", () => {
    const longBody = "甲".repeat(200) + "关键金句";
    // 先确认这个金句确实落在 rag.ts snippet 的 160 字截断之外
    expect(longBody.indexOf("关键金句")).toBeGreaterThan(160);

    const corpus = new Map([["d1", `标题\n${longBody}`]]);
    const items: EvalItem[] = [
      item({
        id: "lit",
        category: "literal",
        query: "q",
        goldKcIds: ["d1"],
        goldPhrase: "关键金句",
      }),
    ];
    const retrieve: EvalRetriever = () => [{ kcId: "d1" }];

    const result = evaluateRetrieval(items, retrieve, corpus);
    expect(result.goldPhraseInFullText).toEqual({ numerator: 1, denominator: 1, value: 1 });
  });

  it("金句不在全文时不命中", () => {
    const corpus = new Map([["d1", "甲".repeat(200)]]);
    const items: EvalItem[] = [
      item({
        id: "lit",
        category: "literal",
        query: "q",
        goldKcIds: ["d1"],
        goldPhrase: "关键金句",
      }),
    ];
    expect(evaluateRetrieval(items, () => [{ kcId: "d1" }], corpus).goldPhraseInFullText.value).toBe(0);
  });

  it("只查 top3：金句在第 4 条文档里不算命中", () => {
    const corpus = new Map([
      ["d1", "丙"],
      ["d2", "丁"],
      ["d3", "戊"],
      ["d4", "关键金句"],
    ]);
    const items: EvalItem[] = [
      item({
        id: "lit",
        category: "literal",
        query: "q",
        goldKcIds: ["d1"],
        goldPhrase: "关键金句",
      }),
    ];
    const retrieve: EvalRetriever = () =>
      ["d1", "d2", "d3", "d4"].map((kcId) => ({ kcId }));

    expect(evaluateRetrieval(items, retrieve, corpus).goldPhraseInFullText.value).toBe(0);
  });

  it("检索结果不在语料里时抛错，而不是静默算未命中", () => {
    const items: EvalItem[] = [
      item({
        id: "lit",
        category: "literal",
        query: "q",
        goldKcIds: ["d1"],
        goldPhrase: "金句",
      }),
    ];
    expect(() =>
      evaluateRetrieval(items, () => [{ kcId: "ghost" }], new Map([["d1", "金句"]])),
    ).toThrow(/不在语料中/);
  });
});

describe("evaluateRetrieval：分类指标", () => {
  const corpus = new Map([
    ["d1", "标题\n金句甲"],
    ["d2", "标题\n金句乙"],
    ["d3", "标题\n丙的正文"],
    ["d4", "标题\n丁的正文"],
  ]);

  const items: EvalItem[] = [
    item({
      id: "lit-1",
      category: "literal",
      query: "q1",
      goldKcIds: ["d1"],
      goldPhrase: "金句甲",
    }),
    item({
      id: "para-1",
      category: "paraphrase",
      query: "q2",
      goldKcIds: ["d2"],
      goldPhrase: "金句乙",
    }),
    item({
      id: "abs-1",
      category: "answer-absent",
      query: "q3",
      relatedKcIds: ["d3"],
    }),
    item({
      id: "ood-1",
      category: "out-of-domain",
      query: "q4",
    }),
  ];

  const ranking: Record<string, string[]> = {
    q1: ["d2", "d1", "d3", "d4"],
    q2: ["d4", "d3", "d2"],
    q3: ["d3", "d1"],
    q4: [],
  };
  const retrieve: EvalRetriever = (query, k) =>
    (ranking[query] ?? []).slice(0, k).map((kcId) => ({ kcId }));

  it("recall@3 / MRR@10 / 金句 / 拒答指标都符合手算结果", () => {
    const result = evaluateRetrieval(items, retrieve, corpus);

    expect(result.total).toBe(4);
    expect(result.counts).toEqual({
      literal: 1,
      paraphrase: 1,
      "answer-absent": 1,
      "out-of-domain": 1,
    });

    expect(result.recallAt3).toEqual({ numerator: 2, denominator: 2, value: 1 });
    expect(result.recallAt3Literal).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(result.recallAt3Paraphrase).toEqual({ numerator: 1, denominator: 1, value: 1 });

    // q1 首个 gold 在第 2 位，q2 在第 3 位 → (1/2 + 1/3) / 2
    expect(result.mrrAt10.value).toBeCloseTo((1 / 2 + 1 / 3) / 2, 10);
    expect(result.mrrAt10.denominator).toBe(2);

    expect(result.goldPhraseInFullText).toEqual({ numerator: 2, denominator: 2, value: 1 });
    expect(result.answerAbsentRelatedHit).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(result.answerAbsentEmpty.value).toBe(0);
    expect(result.outOfDomainEmpty).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(result.outOfDomainFalseContext).toEqual({ numerator: 0, denominator: 1, value: 0 });
    expect(result.unanswerableEmpty).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
  });

  it("retrieve 拿到的是 k=10（MRR@10 的口径）", () => {
    let seen = 0;
    evaluateRetrieval([items[0]], (_query, k) => {
      seen = k;
      return [];
    }, corpus);
    expect(seen).toBe(10);
  });
});

describe("evaluateRetrieval：边界口径", () => {
  it("多 gold 时 recall@3 按收回比例计算", () => {
    const corpus = new Map([
      ["d1", "一"],
      ["d2", "二"],
      ["d3", "三"],
      ["d4", "四"],
    ]);
    const items: EvalItem[] = [
      item({
        id: "lit",
        category: "literal",
        query: "q",
        goldKcIds: ["d1", "d2"],
        goldPhrase: "一",
      }),
    ];
    const retrieve: EvalRetriever = (_query, k) =>
      ["d1", "d3", "d4"].slice(0, k).map((kcId) => ({ kcId }));

    const result = evaluateRetrieval(items, retrieve, corpus);
    expect(result.recallAt3).toEqual({ numerator: 0.5, denominator: 1, value: 0.5 });
    // 第一个 gold 在 top10 第 1 位
    expect(result.mrrAt10.value).toBe(1);
  });

  it("out-of-domain 返回了文档时 falseContextRate 为 1", () => {
    const corpus = new Map([["d1", "正文"]]);
    const items: EvalItem[] = [item({ id: "ood", category: "out-of-domain", query: "q" })];
    const result = evaluateRetrieval(items, () => [{ kcId: "d1" }], corpus);

    expect(result.outOfDomainEmpty).toEqual({ numerator: 0, denominator: 1, value: 0 });
    expect(result.outOfDomainFalseContext).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(result.unanswerableEmpty.value).toBe(0);
  });

  it("没有 gold 的条目不计入 recall / MRR 分母", () => {
    const items: EvalItem[] = [
      item({ id: "ood", category: "out-of-domain", query: "q" }),
      item({ id: "abs", category: "answer-absent", query: "q2", relatedKcIds: ["d1"] }),
    ];
    const result = evaluateRetrieval(items, () => [], new Map());
    expect(result.recallAt3).toEqual({ numerator: 0, denominator: 0, value: 0 });
    expect(result.mrrAt10).toEqual({ numerator: 0, denominator: 0, value: 0 });
    expect(result.unanswerableEmpty.value).toBe(1);
  });
});

describe("真实评测集 rag-eval-50.jsonl", () => {
  const raw = readFileSync(
    new URL("../../scripts/eval-data/rag-eval-50.jsonl", import.meta.url),
    "utf8",
  );
  const items = parseEvalItems(raw);

  it("50 条，分类计数 15/15/10/10", () => {
    expect(items).toHaveLength(50);
    expect(countByCategory(items)).toEqual({
      literal: 15,
      paraphrase: 15,
      "answer-absent": 10,
      "out-of-domain": 10,
    });
  });

  it("id 与 query 都唯一", () => {
    expect(new Set(items.map((entry) => entry.id)).size).toBe(50);
    expect(new Set(items.map((entry) => entry.query)).size).toBe(50);
  });

  it("gold/related 知识点都来自 kb.ts 的 40 篇", () => {
    const known = new Set(kbDocuments.map((doc) => doc.kcId));
    for (const entry of items) {
      for (const kcId of [...entry.goldKcIds, ...entry.relatedKcIds]) {
        expect(known.has(kcId), `${entry.id} 引用了不存在的 ${kcId}`).toBe(true);
      }
    }
  });

  it("每条 goldPhrase 都是对应 gold 正文的逐字子串", () => {
    const docs = new Map(kbDocuments.map((doc) => [doc.kcId, doc]));
    for (const entry of items) {
      if (entry.goldPhrase === undefined) continue;
      const found = entry.goldKcIds.some((kcId) =>
        (docs.get(kcId)?.text ?? "").includes(entry.goldPhrase as string),
      );
      expect(found, `${entry.id} 的 goldPhrase 不在 gold 正文中`).toBe(true);
    }
  });

  it("40 篇正文都超过 160 字（snippet 必然截断，全文判定才有意义）", () => {
    expect(kbDocuments).toHaveLength(40);
    for (const doc of kbDocuments) {
      expect(doc.text.length, `${doc.kcId} 正文不足 161 字`).toBeGreaterThan(160);
    }
  });
});
