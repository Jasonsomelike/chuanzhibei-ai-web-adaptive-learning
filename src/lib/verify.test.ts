import { describe, it, expect } from "vitest";
import {
  EVIDENCE_CHECK,
  EVIDENCE_INCOMPLETE,
  MAX_CLAIMS,
  MIN_QUOTE_CHARS,
  applyItemEvidence,
  buildClaimVerifyPrompt,
  buildItemEvidencePrompt,
  extractClaims,
  isPassingCheck,
  isSubstantiveQuote,
  parseClaimVerdicts,
  parseItemEvidenceBatch,
  quoteIsVerbatim,
  stripNonEvidenceBlocks,
  summarizeClaimVerdicts,
  type Claim,
  type EvidenceItem,
} from "@/lib/verify";

const CONTEXT = `[教材·《数据结构（C 语言版）》·第3章 栈与队列·第45–46页]
栈是限定仅在表尾进行插入和删除操作的线性表。栈顶是允许插入和删除的一端，栈底是固定的一端。栈具有后进先出的特性，最后进入的元素最先被取出。`;

const ITEMS: readonly EvidenceItem[] = [
  {
    stem: "栈的插入和删除操作发生在哪一端？",
    options: ["栈顶", "栈底", "任意一端", "两端同时"],
    answerText: "栈顶",
  },
  {
    stem: "栈的存取特性是什么？",
    options: ["先进先出", "后进先出", "随机存取", "两端存取"],
    answerText: "后进先出",
  },
];

const QUOTE_TOP = "栈顶是允许插入和删除的一端";
const QUOTE_LIFO = "栈具有后进先出的特性，最后进入的元素最先被取出";

function batchOf(...entries: readonly Record<string, unknown>[]): unknown {
  return { verdicts: entries };
}

describe("常量与 quote 校验", () => {
  it("最小引用长度是 12 个码点", () => {
    expect(MIN_QUOTE_CHARS).toBe(12);
  });

  it("逐字 quote 通过，只忽略空白", () => {
    expect(quoteIsVerbatim(QUOTE_TOP, CONTEXT)).toBe(true);
    // 原文与 quote 的换行/空格不同不应失配
    expect(quoteIsVerbatim("栈顶是 允许插入和删除的一端", CONTEXT)).toBe(true);
    expect(quoteIsVerbatim("栈顶是允许插入和删除的两端", CONTEXT)).toBe(false);
    expect(quoteIsVerbatim("", CONTEXT)).toBe(false);
  });

  it("实质字符校验挡住抬头、标点与数字", () => {
    expect(isSubstantiveQuote(QUOTE_TOP)).toBe(true);
    expect(isSubstantiveQuote("后进先出")).toBe(false);
    expect(
      isSubstantiveQuote(
        "[教材·《数据结构（C 语言版）》·第3章 栈与队列·第45–46页]",
      ),
    ).toBe(false);
    expect(isSubstantiveQuote("1. 2. 3. 4. 5. 6.")).toBe(false);
  });

  it("stripNonEvidenceBlocks 去掉口径指令、保留摘录与抬头", () => {
    const dirty = `${CONTEXT}

【口径分歧｜尚未选定】A 称「甲」；B 称「乙」；请同时列出两种说法，不要替用户选择

【口径裁定｜以此为准】某主题：按《书》第1页的说法——「甲」；不要再列出其他来源的不同说法。`;
    const clean = stripNonEvidenceBlocks(dirty);
    expect(clean).toContain("栈顶是允许插入和删除的一端");
    expect(clean).toContain("[教材·《数据结构（C 语言版）》");
    expect(clean).not.toContain("口径分歧");
    expect(clean).not.toContain("口径裁定");
    expect(clean).not.toContain("请同时列出两种说法");
    expect(stripNonEvidenceBlocks("【口径分歧｜尚未选定】只有指令")).toBe("");
  });
});

describe("出题侧整批提示词", () => {
  it("包含整批题干与选项，且要求逐字引用", () => {
    const prompt = buildItemEvidencePrompt(ITEMS, CONTEXT);
    expect(prompt).toContain("第 1 题：栈的插入和删除操作发生在哪一端？");
    expect(prompt).toContain("A. 栈顶");
    expect(prompt).toContain("第 2 题：栈的存取特性是什么？");
    expect(prompt).toContain("B. 后进先出");
    expect(prompt).toContain("至少 12 个字符");
    expect(prompt).toContain("itemIndex 从 1 开始");
  });

  it("不把口径指令带进核对提示词", () => {
    const dirty = `${CONTEXT}

【口径分歧｜尚未选定】请同时列出两种说法，不要替用户选择`;
    expect(buildItemEvidencePrompt(ITEMS, dirty)).not.toContain("请同时列出两种说法");
  });

  it("没有原文或没有题目时返回空串（调用方跳过 L6）", () => {
    expect(buildItemEvidencePrompt(ITEMS, "")).toBe("");
    expect(buildItemEvidencePrompt(ITEMS, "   \n  ")).toBe("");
    expect(buildItemEvidencePrompt([], CONTEXT)).toBe("");
  });
});

describe("出题侧整批解析", () => {
  it("逐字 quote 且答案一致时通过", () => {
    const results = parseItemEvidenceBatch(
      batchOf(
        { itemIndex: 1, answerText: "栈顶", quote: QUOTE_TOP, verdict: "supported" },
        { itemIndex: 2, answerText: "后进先出", quote: QUOTE_LIFO, verdict: "supported" },
      ),
      ITEMS,
      CONTEXT,
    );

    expect(results).toHaveLength(ITEMS.length);
    expect(results.map((r) => r.outcome)).toEqual(["passed", "passed"]);
    expect(results[0]?.verdict).toBe("supported");
    expect(results[0]?.quote).toBe(QUOTE_TOP);
    expect(results[1]?.quote).toBe(QUOTE_LIFO);

    const decision = applyItemEvidence({ status: "accepted" }, results[0] ?? null);
    expect(decision).toEqual({
      status: "accepted",
      check: EVIDENCE_CHECK,
      passed: true,
    });
  });

  it("编造 quote 判 not_found 并降 practice", () => {
    const [result] = parseItemEvidenceBatch(
      batchOf({
        itemIndex: 1,
        answerText: "栈顶",
        quote: "栈必须在队尾进行插入和删除操作",
        verdict: "supported",
      }),
      [ITEMS[0]],
      CONTEXT,
    );

    expect(result?.outcome).toBe("failed");
    expect(result?.verdict).toBe("not_found");
    expect(result?.reason).toContain("逐字");

    const decision = applyItemEvidence({ status: "accepted" }, result ?? null);
    expect(decision.status).toBe("practice");
    expect(decision.check).toContain(`${EVIDENCE_CHECK}：未通过`);
    expect(decision.passed).toBe(false);
    expect(isPassingCheck(decision.check ?? "")).toBe(false);
  });

  it("2–4 个常见字即使逐字出现也判 not_found", () => {
    const results = parseItemEvidenceBatch(
      batchOf(
        { itemIndex: 1, answerText: "栈顶", quote: "栈顶", verdict: "supported" },
        { itemIndex: 2, answerText: "后进先出", quote: "后进先出", verdict: "supported" },
      ),
      ITEMS,
      CONTEXT,
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.outcome === "failed")).toBe(true);
    expect(results.every((r) => r.verdict === "not_found")).toBe(true);
    expect(results[0]?.reason).toContain("不足 12");
    expect(results[1]?.reason).toContain("不足 12");
  });

  it("只拿引用抬头冒充依据判 not_found", () => {
    const [result] = parseItemEvidenceBatch(
      batchOf({
        itemIndex: 1,
        answerText: "栈顶",
        quote: "[教材·《数据结构（C 语言版）》·第3章 栈与队列·第45–46页]",
        verdict: "supported",
      }),
      [ITEMS[0]],
      CONTEXT,
    );

    expect(result?.outcome).toBe("failed");
    expect(result?.verdict).toBe("not_found");
    expect(result?.reason).toContain("抬头");
  });

  it("核对答案与生成器答案不一致时降 practice", () => {
    const [result] = parseItemEvidenceBatch(
      batchOf({
        itemIndex: 1,
        answerText: "栈底",
        quote: QUOTE_TOP,
        verdict: "supported",
      }),
      [ITEMS[0]],
      CONTEXT,
    );

    expect(result?.outcome).toBe("failed");
    expect(result?.verdict).toBe("not_found");
    expect(result?.reason).toContain("不一致");

    const decision = applyItemEvidence({ status: "accepted" }, result ?? null);
    expect(decision.status).toBe("practice");
    expect(decision.check).toContain("不一致");
  });

  it("verdict 为 unable 时降 practice", () => {
    const [result] = parseItemEvidenceBatch(
      batchOf({ itemIndex: 1, answerText: "栈顶", quote: "", verdict: "unable" }),
      [ITEMS[0]],
      CONTEXT,
    );

    expect(result?.outcome).toBe("failed");
    expect(result?.verdict).toBe("unable");
    expect(result?.reason).toContain("不足以判断");

    const decision = applyItemEvidence({ status: "accepted" }, result ?? null);
    expect(decision.status).toBe("practice");
    expect(decision.check).toContain("未通过（原文不足以判断）");
  });

  it("空原文整批 skip，不追加检查项也不改状态", () => {
    const results = parseItemEvidenceBatch(
      batchOf(
        { itemIndex: 1, answerText: "栈顶", quote: QUOTE_TOP, verdict: "supported" },
        { itemIndex: 2, answerText: "后进先出", quote: QUOTE_LIFO, verdict: "supported" },
      ),
      ITEMS,
      "",
    );

    expect(results).toHaveLength(ITEMS.length);
    expect(results.every((r) => r.outcome === "skipped")).toBe(true);

    const decision = applyItemEvidence({ status: "accepted" }, results[0] ?? null);
    expect(decision).toEqual({ status: "accepted", check: null, passed: false });
  });

  it("itemIndex 缺项与越界都不移位，输出长度仍等于题数", () => {
    const results = parseItemEvidenceBatch(
      batchOf(
        // 第 1 题缺失
        { itemIndex: 2, answerText: "后进先出", quote: QUOTE_LIFO, verdict: "supported" },
        // 越界项丢弃
        { itemIndex: 9, answerText: "栈顶", quote: QUOTE_TOP, verdict: "supported" },
        { itemIndex: 0, answerText: "栈顶", quote: QUOTE_TOP, verdict: "supported" },
        { itemIndex: "x", answerText: "栈顶", quote: QUOTE_TOP, verdict: "supported" },
      ),
      ITEMS,
      CONTEXT,
    );

    expect(results).toHaveLength(2);
    expect(results[0]?.outcome).toBe("unverified");
    expect(results[0]?.reason).toContain("缺少第 1 题");
    expect(results[1]?.outcome).toBe("passed");

    const decision = applyItemEvidence({ status: "accepted" }, results[0] ?? null);
    expect(decision.status).toBe("accepted");
    expect(decision.check).toBe(EVIDENCE_INCOMPLETE);
    expect(isPassingCheck(decision.check ?? "")).toBe(false);
  });

  it("字符串 itemIndex 也能按题号落位", () => {
    const [result] = parseItemEvidenceBatch(
      batchOf({ itemIndex: "1", answerText: "栈顶", quote: QUOTE_TOP, verdict: "supported" }),
      [ITEMS[0]],
      CONTEXT,
    );
    expect(result?.outcome).toBe("passed");
  });

  it("JSON 不可解析时整批 unverified，保留 accepted", () => {
    const results = parseItemEvidenceBatch("not json", ITEMS, CONTEXT);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.outcome === "unverified")).toBe(true);
    expect(results.every((r) => r.reason === "核对输出无法解析")).toBe(true);

    const decision = applyItemEvidence({ status: "accepted" }, results[0] ?? null);
    expect(decision.status).toBe("accepted");
    expect(decision.check).toBe(EVIDENCE_INCOMPLETE);
  });

  it("缺 verdicts 数组时整批 unverified", () => {
    const results = parseItemEvidenceBatch({ items: [] }, ITEMS, CONTEXT);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.outcome === "unverified")).toBe(true);
    expect(results[0]?.reason).toContain("verdicts");
  });

  it("applyItemEvidence 对 null 结果按未完成处理", () => {
    expect(applyItemEvidence({ status: "accepted" }, null)).toEqual({
      status: "accepted",
      check: EVIDENCE_INCOMPLETE,
      passed: false,
    });
  });
});

describe("导师侧引用切分与核对", () => {
  const ANSWER =
    "栈是后进先出的结构[stack]。栈顶是允许插入和删除的一端[stack]。模型编造的内容[web]。";

  it("抽取引用前的那句话，忽略未知 id", () => {
    const claims = extractClaims(ANSWER, ["stack"]);
    expect(claims).toEqual([
      { id: "c1", kcId: "stack", text: "栈是后进先出的结构" },
      { id: "c2", kcId: "stack", text: "栈顶是允许插入和删除的一端" },
    ]);
  });

  it("同一 id + 同一句话只保留一次，最多 5 条", () => {
    expect(extractClaims("同一句话[stack]。同一句话[stack]。", ["stack"])).toHaveLength(1);

    const many = Array.from({ length: 7 }, (_, i) => `第${i + 1}句话是有效内容[stack]。`).join("");
    expect(extractClaims(many, ["stack"])).toHaveLength(MAX_CLAIMS);
  });

  it("大小写不同的引用 id 仍能匹配", () => {
    const claims = extractClaims("栈顶是允许插入和删除的一端[STACK]。", ["stack"]);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.kcId).toBe("stack");
  });

  it("提示词使用完整注入上下文，而不是第一条摘录", () => {
    const claims: readonly Claim[] = [
      { id: "c1", kcId: "stack", text: "栈顶是允许插入和删除的一端" },
    ];
    const twoExcerpts = `[教材·《数据结构（C 语言版）》·第3章 栈与队列·第45页]
栈顶是允许插入和删除的一端。

[讲义·《第3章补充》·第3章 栈与队列·第2页]
出栈顺序遵循后进先出。`;

    const prompt = buildClaimVerifyPrompt(claims, twoExcerpts);
    expect(prompt).toContain("[c1] 栈顶是允许插入和删除的一端");
    expect(prompt).toContain("栈顶是允许插入和删除的一端");
    expect(prompt).toContain("出栈顺序遵循后进先出");
    expect(prompt).toContain("至少 12 个字符");
    expect(buildClaimVerifyPrompt(claims, "")).toBe("");
  });

  it("逐字 quote 通过，编造 quote 判 not_found", () => {
    const claims = extractClaims(ANSWER, ["stack"]);
    const verdicts = parseClaimVerdicts(
      [
        {
          id: "c1",
          verdict: "supported",
          quote: "栈是限定仅在表尾进行插入和删除操作的线性表",
        },
        {
          id: "c2",
          verdict: "supported",
          quote: "这句话不在原文里但长度足够",
        },
      ],
      claims,
      CONTEXT,
    );

    expect(verdicts).toHaveLength(claims.length);
    expect(verdicts[0]?.verdict).toBe("supported");
    expect(verdicts[0]?.quote).toContain("栈是限定");
    expect(verdicts[1]?.verdict).toBe("not_found");
    expect(verdicts[1]?.reason).toContain("逐字");
  });

  it("缺条与非法 JSON 都记为 unable，不删条目", () => {
    const claims = extractClaims(ANSWER, ["stack"]);
    const parsed = parseClaimVerdicts(
      [
        {
          id: "c1",
          verdict: "supported",
          quote: "栈是限定仅在表尾进行插入和删除操作的线性表",
        },
      ],
      claims,
      CONTEXT,
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[1]?.verdict).toBe("unable");
    expect(parsed[1]?.reason).toContain("缺少");

    const broken = parseClaimVerdicts("not json", claims, CONTEXT);
    expect(broken).toHaveLength(2);
    expect(broken.every((v) => v.verdict === "unable")).toBe(true);
  });

  it("没有原文时兜底为 unable，而不是误判未找到依据", () => {
    const claims = extractClaims(ANSWER, ["stack"]);
    const verdicts = parseClaimVerdicts(
      [{ id: "c1", verdict: "supported", quote: "栈是限定仅在表尾进行插入和删除操作的线性表" }],
      claims,
      "",
    );
    expect(verdicts).toHaveLength(2);
    expect(verdicts.every((v) => v.verdict === "unable")).toBe(true);
    expect(verdicts[0]?.reason).toContain("没有可核对");
  });

  it("汇总只统计实际核对结果", () => {
    const claims = extractClaims(ANSWER, ["stack"]);
    const verdicts = parseClaimVerdicts(
      [
        {
          id: "c1",
          verdict: "supported",
          quote: "栈是限定仅在表尾进行插入和删除操作的线性表",
        },
        { id: "c2", verdict: "not_found", quote: "" },
      ],
      claims,
      CONTEXT,
    );
    const summary = summarizeClaimVerdicts(verdicts);
    expect(summary.total).toBe(2);
    expect(summary.supported).toBe(1);
    expect(summary.notFound).toBe(1);
    expect(summary.contradicted).toBe(0);
    expect(summary.unable).toBe(0);
    expect(summary.text).toBe("2 条引用中 1 条有原文支持，1 条未找到依据。");

    expect(summarizeClaimVerdicts([]).text).toBe("本次回答没有可核对的引用");
  });
});

describe("isPassingCheck", () => {
  it("依据核对通过项为 true，未通过/未完成为 false", () => {
    expect(isPassingCheck("依据核对")).toBe(true);
    expect(isPassingCheck("依据核对：未通过（核对答案与生成答案不一致）")).toBe(false);
    expect(isPassingCheck("依据核对：未完成")).toBe(false);
    // 半角冒号同样不能漏进通过项
    expect(isPassingCheck("依据核对:未完成")).toBe(false);
  });

  it("普通检查项仍算通过，提示与依据出处不算", () => {
    expect(isPassingCheck("双解校验")).toBe(true);
    expect(isPassingCheck("题干长度")).toBe(true);
    expect(isPassingCheck("提示：难度理由与档位不匹配")).toBe(false);
    expect(isPassingCheck("依据：[教材·《数据结构（C 语言版）》]")).toBe(false);
    expect(isPassingCheck("")).toBe(false);
  });
});
