import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockChatRequest {
  readonly system?: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly jsonMode?: boolean;
  readonly timeoutMs?: number;
}

const chat = vi.hoisted(() => ({
  calls: [] as MockChatRequest[],
  responder: null as null | ((req: MockChatRequest) => { text: string; finishReason: string | null }),
}));

vi.mock("@/lib/chat", () => ({
  callChat: async (_provider: unknown, req: MockChatRequest) => {
    chat.calls.push(req);
    if (chat.responder === null) throw new Error("测试里不访问模型");
    return chat.responder(req);
  },
}));

import type { ProviderConfig } from "@/lib/provider";
import type { Claim, EvidenceItem } from "@/lib/verify";
import { verifyItemEvidence, verifyTutorClaims } from "@/lib/verifyClient";

const PROVIDER: ProviderConfig = {
  label: "测试供应商",
  kind: "openai-compatible",
  baseUrl: "https://example.invalid/v1",
  apiKey: "test-key",
  model: "test-model",
};

const CONTEXT = `[教材·《数据结构（C 语言版）》·第3章 栈与队列·第45–46页]
栈是限定仅在表尾进行插入和删除操作的线性表。栈顶是允许插入和删除的一端，栈底是固定的一端。栈具有后进先出的特性，最后进入的元素最先被取出。`;

const CLAIMS: readonly Claim[] = [
  { id: "c1", kcId: "stack", text: "栈是后进先出的结构" },
  { id: "c2", kcId: "stack", text: "栈顶是允许插入和删除的一端" },
];

const QUOTE_STACK = "栈是限定仅在表尾进行插入和删除操作的线性表";
const QUOTE_TOP = "栈顶是允许插入和删除的一端";

function respond(body: unknown): void {
  chat.responder = () => ({ text: JSON.stringify(body), finishReason: "stop" });
}

beforeEach(() => {
  chat.calls.length = 0;
  chat.responder = null;
});

describe("verifyTutorClaims（导师引用核对）", () => {
  it("逐字 quote 通过，请求参数固定为低温、600 token、30 秒", async () => {
    respond([
      { id: "c1", verdict: "supported", quote: QUOTE_STACK },
      { id: "c2", verdict: "supported", quote: QUOTE_TOP },
    ]);

    const verdicts = await verifyTutorClaims(PROVIDER, CLAIMS, CONTEXT);

    expect(verdicts.map((v) => v.verdict)).toEqual(["supported", "supported"]);
    expect(verdicts[0].quote).toBe(QUOTE_STACK);
    expect(chat.calls).toHaveLength(1);
    // 核对一律 thinking off：不传任何思考参数，温度 0
    expect(chat.calls[0]).toMatchObject({
      maxTokens: 600,
      temperature: 0,
      jsonMode: true,
      timeoutMs: 30000,
    });
  });

  it("编造 quote 判 not_found，不删除条目", async () => {
    respond([
      { id: "c1", verdict: "supported", quote: "这句话根本不在注入的原文里面" },
      { id: "c2", verdict: "supported", quote: QUOTE_TOP },
    ]);

    const verdicts = await verifyTutorClaims(PROVIDER, CLAIMS, CONTEXT);

    expect(verdicts).toHaveLength(2);
    expect(verdicts[0].verdict).toBe("not_found");
    expect(verdicts[0].reason).toContain("逐字");
    expect(verdicts[1].verdict).toBe("supported");
  });

  it("网络失败 fail-open：每条都是 unable，不抛异常", async () => {
    chat.responder = () => {
      throw new Error("network down");
    };

    const verdicts = await verifyTutorClaims(PROVIDER, CLAIMS, CONTEXT);

    expect(verdicts).toHaveLength(2);
    expect(verdicts.every((v) => v.verdict === "unable")).toBe(true);
    expect(verdicts[0].reason).toContain("核对未完成");
    expect(verdicts[0].reason).toContain("network down");
  });

  it("没有原文或没有引用时不发请求", async () => {
    expect(await verifyTutorClaims(PROVIDER, CLAIMS, "")).toEqual([]);
    expect(await verifyTutorClaims(PROVIDER, [], CONTEXT)).toEqual([]);
    expect(chat.calls).toHaveLength(0);
  });

  it("用实际注入的完整上下文核对，第二段摘录里的引用也算 supported", async () => {
    /*
     * 曾经传 per-claim excerpt（每 KC 第一条）：模型引用第二、三条注入片段时
     * 会被误判 not_found。这里让 quote 只出现在第二段，锁住「整份 promptContext」。
     */
    const twoExcerpts = `[教材·《A》·第1章 栈·第1页]
栈顶是允许插入和删除的一端。

[讲义·《B》·第2章 队列·第2页]
队列是先进先出的线性表，入队在队尾进行，出队在队头进行。`;
    const claims: readonly Claim[] = [{ id: "c1", kcId: "queue", text: "队列是先进先出的线性表" }];
    respond([
      {
        id: "c1",
        verdict: "supported",
        quote: "队列是先进先出的线性表，入队在队尾进行",
      },
    ]);

    const verdicts = await verifyTutorClaims(PROVIDER, claims, twoExcerpts);

    expect(verdicts[0].verdict).toBe("supported");
    expect(chat.calls[0].user).toContain("栈顶是允许插入和删除的一端");
    expect(chat.calls[0].user).toContain("入队在队尾进行");
  });
});

describe("verifyItemEvidence（出题整批核对）", () => {
  const ITEMS: readonly EvidenceItem[] = [
    { stem: "栈顶在哪一端？", options: ["栈顶", "栈底", "两端", "任意"], answerText: "栈顶" },
    { stem: "栈的存取特性？", options: ["后进先出", "先进先出", "随机", "双向"], answerText: "后进先出" },
  ];

  it("整批逐字通过时返回 passed，error 为 null", async () => {
    respond({
      verdicts: [
        { itemIndex: 1, answerText: "栈顶", quote: QUOTE_TOP, verdict: "supported" },
        {
          itemIndex: 2,
          answerText: "后进先出",
          quote: "栈具有后进先出的特性，最后进入的元素最先被取出",
          verdict: "supported",
        },
      ],
    });

    const outcome = await verifyItemEvidence(PROVIDER, ITEMS, CONTEXT);

    expect(outcome.error).toBeNull();
    expect(outcome.results.map((r) => r.outcome)).toEqual(["passed", "passed"]);
    expect(chat.calls[0]).toMatchObject({
      maxTokens: 1200,
      temperature: 0,
      jsonMode: true,
      timeoutMs: 45000,
    });
    // 核对提示词只给题干与选项，不给生成器的答案
    expect(chat.calls[0].user).not.toContain("answerText：栈顶");
  });

  it("网络失败返回整批 unverified 并带原因，绝不抛异常", async () => {
    chat.responder = () => {
      throw new Error("timeout");
    };

    const outcome = await verifyItemEvidence(PROVIDER, ITEMS, CONTEXT);

    expect(outcome.error).toContain("timeout");
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results.every((r) => r.outcome === "unverified")).toBe(true);
  });

  it("没有原文时整批 skipped，不发请求", async () => {
    const outcome = await verifyItemEvidence(PROVIDER, ITEMS, "");

    expect(outcome.error).toBeNull();
    expect(outcome.results.every((r) => r.outcome === "skipped")).toBe(true);
    expect(chat.calls).toHaveLength(0);
  });
});
