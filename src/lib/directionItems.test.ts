import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * 假模型：按提示词内容分派响应，不发真实请求。
 * 用内容而不是调用序号分派，是因为 L4 的两次批解是 Promise.all 并发的，
 * 谁先到达不确定；按次数排队会把测试绑在竞态上（mock-provider 同理）。
 */
interface MockChatRequest {
  readonly system?: string;
  readonly user: string;
}

interface MockChatResult {
  readonly text: string;
  readonly finishReason: string | null;
}

const chat = vi.hoisted(() => ({
  calls: [] as { system?: string; user: string }[],
  responder: null as null | ((req: MockChatRequest) => MockChatResult),
}));

vi.mock("@/lib/chat", () => ({
  callChat: async (_provider: unknown, req: MockChatRequest) => {
    chat.calls.push(req);
    if (chat.responder === null) throw new Error("测试里不访问模型");
    return chat.responder(req);
  },
}));

import { ensureAllItems, ensureItems, materialForConcept } from "@/lib/directionItems";
import type { KnowledgeConcept, KnowledgeGraph } from "@/lib/graph";
import type { MaterialPack, MaterialSelection } from "@/lib/materials";
import type { ProviderConfig } from "@/lib/provider";

const PROVIDER: ProviderConfig = {
  label: "测试供应商",
  kind: "openai-compatible",
  baseUrl: "https://example.invalid/v1",
  apiKey: "test-key",
  model: "test-model",
};

const CONCEPT: KnowledgeConcept = {
  id: "k1",
  name: "栈",
  summary: "后进先出的线性表",
  chapter: "第3章 栈与队列",
};

const GRAPH: KnowledgeGraph = {
  version: "test",
  concepts: [CONCEPT],
  edges: [],
};

const EXCERPT = "栈是只允许在表尾进行插入和删除的线性表，具有后进先出的特性。";
const UPLOAD_EXCERPT = "上传讲义指出，栈的入栈与出栈都只能在栈顶进行。";

const PACK: MaterialPack = {
  id: "test-pack",
  title: "合成教材",
  sources: [{ id: "src", kind: "textbook", title: "合成教材" }],
  chunks: [
    {
      id: "chunk-1",
      sourceId: "src",
      kcIds: ["k1"],
      chapter: "第3章 栈与队列",
      section: "3.1 栈的定义",
      pageFrom: 45,
      pageTo: 46,
      text: EXCERPT,
    },
  ],
  claims: [],
};

const UPLOAD_PACK: MaterialPack = {
  id: "uploads:d1",
  title: "上传资料",
  sources: [{ id: "doc-1", kind: "lecture", title: "数据结构讲义.md" }],
  chunks: [
    {
      id: "uc1",
      sourceId: "doc-1",
      kcIds: ["k1"],
      chapter: "上传资料",
      section: "第1页",
      pageFrom: 1,
      pageTo: 1,
      text: UPLOAD_EXCERPT,
    },
  ],
  claims: [],
};

const SELECTION: MaterialSelection = { sourceIds: ["src"], resolutions: {} };
const MATERIAL = { pack: PACK, selection: SELECTION };

/** ensureItems 吃的是「已拼好的口径」，不是整包；L6 与出题共用这份 context。 */
const ITEM_MATERIAL = {
  context: EXCERPT,
  checkLabel: "依据：[教材·《合成教材》·第3章 栈与队列·第45–46页]",
};

/** 四道能通过 L2/L3 的题；答案都短于 6 字或解析里原样包含答案。 */
const BATCH = [
  {
    difficulty: "basic",
    difficultyReason: "基础概念题，考查栈顶的定义",
    stem: "栈的插入与删除操作都在哪一端完成？",
    options: ["栈顶", "栈底", "中间位置", "任意位置"],
    answerText: "栈顶",
    explanation: "栈只允许在表尾插入和删除，表尾称为栈顶，所以两个操作都在栈顶完成。",
  },
  {
    difficulty: "advanced",
    difficultyReason: "需要理解后进先出的性质",
    stem: "栈的存取顺序遵循哪条规则？",
    options: ["后进先出", "先进先出", "随机存取", "按优先级"],
    answerText: "后进先出",
    explanation: "最后进入栈的元素最先被取出，这就是后进先出，与队列的先进先出相反。",
  },
  {
    difficulty: "advanced",
    difficultyReason: "需要理解循环队列的判满条件",
    stem: "循环队列少用一个元素空间时队满条件是什么？",
    options: ["front == rear", "(rear + 1) % MAXSIZE == front", "rear == MAXSIZE", "front == 0"],
    answerText: "(rear + 1) % MAXSIZE == front",
    explanation: "队满时 rear 再前进一格就会追上 front，因此条件是 (rear + 1) % MAXSIZE == front。",
  },
  {
    difficulty: "challenge",
    difficultyReason: "需要综合比较链栈与顺序栈",
    stem: "链栈相对于顺序栈的主要优势是什么？",
    options: ["不会出现栈满溢出", "支持随机访问", "存储密度更高", "入栈更快"],
    answerText: "不会出现栈满溢出",
    explanation: "链栈按需分配结点，不会出现栈满溢出，但存储密度更低，也不支持随机访问。",
  },
] as const;

/** 逐字出现在 EXCERPT 里的引用，长度足够且含实质字符。 */
const QUOTE = "栈是只允许在表尾进行插入和删除的线性表";

function correctAnswers(
  items: readonly { readonly answerText: string }[] = BATCH,
): { index: number; answerText: string }[] {
  return items.map((item, i) => ({ index: i + 1, answerText: item.answerText }));
}

function evidenceFor(
  items: readonly { readonly answerText: string }[],
  quote = QUOTE,
): unknown {
  return {
    verdicts: items.map((item, i) => ({
      itemIndex: i + 1,
      answerText: item.answerText,
      quote,
      verdict: "supported",
    })),
  };
}

interface Script {
  readonly batch?: readonly unknown[];
  readonly answers?: readonly { index: number; answerText: string }[];
  readonly evidence?: unknown;
  readonly evidenceRaw?: string;
  readonly evidenceError?: Error;
  readonly generateError?: Error;
}

/** 按提示词内容分派：核对 → 批解 → 生成。 */
function useScript(script: Script): void {
  chat.responder = (req) => {
    const user = req.user;
    if (user.includes("待核对题目")) {
      if (script.evidenceError) throw script.evidenceError;
      return {
        text: script.evidenceRaw ?? JSON.stringify(script.evidence ?? { verdicts: [] }),
        finishReason: "stop",
      };
    }
    if (user.includes("answerText")) {
      return { text: JSON.stringify({ answers: script.answers ?? [] }), finishReason: "stop" };
    }
    if (script.generateError) throw script.generateError;
    return { text: JSON.stringify({ items: script.batch ?? BATCH }), finishReason: "stop" };
  };
}

interface PostBody {
  readonly directionId: string;
  readonly kcId: string;
  readonly items: readonly Record<string, unknown>[];
}

let posts: PostBody[] = [];

function installFetchStub(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      if (!url.includes("/api/directions/items") || method !== "POST") {
        return { ok: true, json: async () => ({ items: [] }) } as unknown as Response;
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as PostBody;
      posts.push(body);
      const now = "2026-10-28T00:00:00.000Z";
      const items: Record<string, unknown>[] = body.items.map((raw, i) => {
        const options = Array.isArray(raw.options) ? (raw.options as string[]) : [];
        const answerText = typeof raw.answerText === "string" ? raw.answerText : "";
        return {
          ...raw,
          id: `saved-${i}`,
          directionId: body.directionId,
          kcId: body.kcId,
          answerIndex: Math.max(0, options.indexOf(answerText)),
          contentHash: `hash-${i}`,
          createdAt: now,
        };
      });
      return {
        ok: true,
        json: async () => ({
          ok: true,
          inserted: items.length,
          skipped: 0,
          accepted: items.filter((i) => i.status === "accepted").length,
          practice: items.filter((i) => i.status === "practice").length,
          rejected: [],
          items,
        }),
      } as unknown as Response;
    }),
  );
}

function evidenceCalls(): { system?: string; user: string }[] {
  return chat.calls.filter((call) => call.user.includes("待核对题目"));
}

beforeEach(() => {
  chat.calls.length = 0;
  chat.responder = null;
  posts = [];
  installFetchStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureAllItems 的资料口径", () => {
  it("传了 pack + selection 时，出题提示词带上原文与依据", async () => {
    await ensureAllItems({
      directionId: "d1",
      graph: GRAPH,
      provider: PROVIDER,
      material: MATERIAL,
    });

    expect(chat.calls).toHaveLength(1);
    const prompt = chat.calls[0].user;
    expect(prompt).toContain("教材原文");
    expect(prompt).toContain(EXCERPT);
    // 引用抬头由 citationLabel 生成，模型只能用这里出现的出处
    expect(prompt).toContain("[教材·《合成教材》·第3章 栈与队列·第45–46页]");

    // 依据标注随题落进 checks，带「依据：」前缀
    const material = materialForConcept(MATERIAL, CONCEPT);
    expect(material?.checkLabel).toBe("依据：[教材·《合成教材》·第3章 栈与队列·第45–46页]");
  });

  it("不传资料时提示词里没有教材小节，materialForConcept 返回 undefined", async () => {
    await ensureAllItems({ directionId: "d1", graph: GRAPH, provider: PROVIDER });

    expect(chat.calls).toHaveLength(1);
    expect(chat.calls[0].user).not.toContain("教材原文");
    expect(materialForConcept(undefined, CONCEPT)).toBeUndefined();
  });

  it("没有命中片段时不注入：空选择、未覆盖的 KC、只有分歧没有原文都算", () => {
    const noneSelected: MaterialSelection = { sourceIds: [], resolutions: {} };
    expect(materialForConcept({ pack: PACK, selection: noneSelected }, CONCEPT)).toBeUndefined();

    const otherConcept: KnowledgeConcept = { ...CONCEPT, id: "k2" };
    expect(materialForConcept(MATERIAL, otherConcept)).toBeUndefined();

    /*
     * 只有口径分歧、没有可引用片段时，buildMaterialContext 会产出提示文本，
     * 但 citations 为空。判据只看 citations，避免题卡出现没有定位点的「依据」。
     */
    const conflictOnly: MaterialPack = {
      ...PACK,
      chunks: [],
      claims: [
        {
          id: "c1",
          kcId: "k1",
          topic: "栈顶",
          statement: "栈顶是最后入栈的元素",
          basis: "textbook",
          sourceId: "src",
        },
        {
          id: "c2",
          kcId: "k1",
          topic: "栈顶",
          statement: "栈顶是最先入栈的元素",
          basis: "textbook",
          sourceId: "src",
        },
      ],
    };
    expect(materialForConcept({ pack: conflictOnly, selection: SELECTION }, CONCEPT)).toBeUndefined();
  });

  it("uploadedPack 与内置包合并，上传来源自动追加进选择", () => {
    /*
     * uploadsToPack 的 source id 是文档 id，不在用户的教材选择里；
     * 不自动追加，上传片段永远命中不了，materialForConcept 会静默返回 undefined。
     */
    const merged = materialForConcept(
      { pack: PACK, selection: SELECTION, uploadedPack: UPLOAD_PACK },
      CONCEPT,
    );

    expect(merged?.context).toContain(EXCERPT);
    expect(merged?.context).toContain(UPLOAD_EXCERPT);
    expect(merged?.checkLabel).toContain("[教材·《合成教材》·第3章 栈与队列·第45–46页]");
    expect(merged?.checkLabel).toContain("[讲义·《数据结构讲义.md》·上传资料·第1页]");
  });

  it("ensureAllItems 把上传原文拼进出题提示词", async () => {
    await ensureAllItems({
      directionId: "d1",
      graph: GRAPH,
      provider: PROVIDER,
      material: { pack: PACK, selection: SELECTION, uploadedPack: UPLOAD_PACK },
    });

    expect(chat.calls[0].user).toContain(UPLOAD_EXCERPT);
    expect(chat.calls[0].user).toContain("[讲义·《数据结构讲义.md》·上传资料·第1页]");
  });
});

describe("ensureItems 的 L6 依据核对", () => {
  it("整批通过：一次核对调用，全部 accepted，trace 顺序为 L1→L6→落库", async () => {
    useScript({ answers: correctAnswers(), evidence: evidenceFor(BATCH) });

    const result = await ensureItems({
      directionId: "d1",
      concept: CONCEPT,
      provider: PROVIDER,
      cached: [],
      material: ITEM_MATERIAL,
    });

    expect(result.items).toHaveLength(4);
    expect(result.items.every((item) => item.status === "accepted")).toBe(true);
    expect(result.items.every((item) => item.checks.includes("依据核对"))).toBe(true);
    expect(result.trace.map((step) => step.key)).toEqual([
      "generate",
      "L1",
      "L2",
      "L3",
      "L4",
      "L6",
      "save",
    ]);
    expect(result.trace.find((step) => step.key === "L6")?.status).toBe("ok");
    expect(result.verification).toMatchObject({
      attempted: true,
      passed: 4,
      failed: 0,
      unverified: 0,
    });

    // 整批只核对一次（每 KC 一次），不是每题一次
    expect(evidenceCalls()).toHaveLength(1);
    // 核对提示词不包含生成器的解析（给了就是让核对器复述）
    expect(evidenceCalls()[0].user).not.toContain(BATCH[0].explanation);

    // 落库 payload 也是 accepted，且 trace 只留在内存
    expect(posts).toHaveLength(1);
    expect(posts[0].items.every((item) => item.status === "accepted")).toBe(true);
    expect(posts[0].items[0]).not.toHaveProperty("trace");
  });

  it("核对未通过：该题降为 practice，其余保留 accepted，检查项带原因", async () => {
    const failedVerdicts = {
      verdicts: [
        {
          itemIndex: 1,
          answerText: BATCH[0].answerText,
          quote: "教材里根本没有出现过的句子内容",
          verdict: "supported",
        },
        ...[1, 2, 3].map((i) => ({
          itemIndex: i + 1,
          answerText: BATCH[i].answerText,
          quote: QUOTE,
          verdict: "supported",
        })),
      ],
    };
    useScript({ answers: correctAnswers(), evidence: failedVerdicts });

    const result = await ensureItems({
      directionId: "d1",
      concept: CONCEPT,
      provider: PROVIDER,
      cached: [],
      material: ITEM_MATERIAL,
    });

    expect(result.items[0].status).toBe("practice");
    expect(result.items.slice(1).every((item) => item.status === "accepted")).toBe(true);
    const reason = result.items[0].checks.find((c) => c.startsWith("依据核对：未通过"));
    expect(reason).toBeDefined();
    expect(reason).toContain("逐字");
    expect(result.trace.find((step) => step.key === "L6")?.status).toBe("warn");
    expect(result.verification.failed).toBe(1);
    expect(posts[0].items[0].status).toBe("practice");
  });

  it("网络失败：保留 accepted，追加「依据核对：未完成」", async () => {
    useScript({
      answers: correctAnswers(),
      evidenceError: new Error("network down"),
    });

    const result = await ensureItems({
      directionId: "d1",
      concept: CONCEPT,
      provider: PROVIDER,
      cached: [],
      material: ITEM_MATERIAL,
    });

    expect(result.items.every((item) => item.status === "accepted")).toBe(true);
    expect(result.items.every((item) => item.checks.includes("依据核对：未完成"))).toBe(true);
    expect(result.verification).toMatchObject({ attempted: true, unverified: 4, failed: 0 });
    expect(result.verification.note).toContain("核对未完成");
    expect(result.trace.find((step) => step.key === "L6")?.status).toBe("warn");
  });

  it("解析失败不降级：仍 accepted，只记「依据核对：未完成」", async () => {
    useScript({ answers: correctAnswers(), evidenceRaw: "这不是 JSON" });

    const result = await ensureItems({
      directionId: "d1",
      concept: CONCEPT,
      provider: PROVIDER,
      cached: [],
      material: ITEM_MATERIAL,
    });

    expect(result.items.every((item) => item.status === "accepted")).toBe(true);
    expect(result.items.every((item) => item.checks.includes("依据核对：未完成"))).toBe(true);
    expect(result.verification.unverified).toBe(4);
    expect(posts[0].items.every((item) => item.status === "accepted")).toBe(true);
  });

  it("无原文时整批 skip：不发核对请求，也不追加检查项", async () => {
    useScript({ answers: correctAnswers(), evidence: evidenceFor(BATCH) });

    const result = await ensureItems({
      directionId: "d1",
      concept: CONCEPT,
      provider: PROVIDER,
      cached: [],
    });

    expect(evidenceCalls()).toHaveLength(0);
    expect(result.items.every((item) => item.status === "accepted")).toBe(true);
    expect(result.items.every((item) => !item.checks.some((c) => c.startsWith("依据核对")))).toBe(
      true,
    );
    expect(result.verification).toMatchObject({ attempted: false, note: "无原文可核对" });
    expect(result.trace.find((step) => step.key === "L6")?.status).toBe("skip");
  });

  it("verification:false 时不发核对请求", async () => {
    useScript({ answers: correctAnswers(), evidence: evidenceFor(BATCH) });

    const result = await ensureItems({
      directionId: "d1",
      concept: CONCEPT,
      provider: PROVIDER,
      cached: [],
      material: ITEM_MATERIAL,
      verification: false,
    });

    expect(evidenceCalls()).toHaveLength(0);
    expect(result.items.every((item) => !item.checks.some((c) => c.startsWith("依据核对")))).toBe(
      true,
    );
    expect(result.verification.note).toBe("本次未开启依据核对");
    expect(result.trace.find((step) => step.key === "L6")?.status).toBe("skip");
  });

  it("不传 verification 时读 provider.verification === false", async () => {
    useScript({ answers: correctAnswers(), evidence: evidenceFor(BATCH) });
    const providerOff = { ...PROVIDER, verification: false } as ProviderConfig;

    const result = await ensureItems({
      directionId: "d1",
      concept: CONCEPT,
      provider: providerOff,
      cached: [],
      material: ITEM_MATERIAL,
    });

    expect(evidenceCalls()).toHaveLength(0);
    expect(result.verification.attempted).toBe(false);
  });

  it("L2/L3 拒掉的题不送核对，题号按剩余题重新落位", async () => {
    const withRejected = [
      BATCH[0],
      { ...BATCH[1], answerText: "这个答案不在选项里" },
      BATCH[2],
      BATCH[3],
    ];
    const survivors = [BATCH[0], BATCH[2], BATCH[3]];
    useScript({
      batch: withRejected,
      answers: correctAnswers(survivors),
      evidence: evidenceFor(survivors),
    });

    const result = await ensureItems({
      directionId: "d1",
      concept: CONCEPT,
      provider: PROVIDER,
      cached: [],
      material: ITEM_MATERIAL,
    });

    const prompt = evidenceCalls()[0].user;
    expect(prompt).not.toContain(withRejected[1].stem);
    expect(prompt).toContain(BATCH[2].stem);
    expect(result.verification.passed).toBe(3);
    expect(result.items.filter((item) => item.status === "rejected")).toHaveLength(1);
  });
});

describe("ensureItems 的 trace 失败路径", () => {
  it("生成调用失败时 trace 只有 generate=fail", async () => {
    useScript({ generateError: new Error("upstream 500") });

    const result = await ensureItems({
      directionId: "d1",
      concept: CONCEPT,
      provider: PROVIDER,
      cached: [],
      material: ITEM_MATERIAL,
    });

    expect(result.generated).toBe(0);
    expect(result.trace.map((step) => step.key)).toEqual(["generate"]);
    expect(result.trace[0].status).toBe("fail");
    expect(result.trace[0].detail).toContain("upstream 500");
  });

  it("L1 结构两次都失败时 trace 停在 L1=fail，不进入 L4/L6", async () => {
    useScript({ batch: [{ ...BATCH[0], options: ["只有", "两个"] }] });

    const result = await ensureItems({
      directionId: "d1",
      concept: CONCEPT,
      provider: PROVIDER,
      cached: [],
      material: ITEM_MATERIAL,
    });

    expect(result.error).toContain("模型输出无法解析");
    expect(result.trace.map((step) => step.key)).toEqual(["generate", "L1"]);
    expect(result.trace[1].status).toBe("fail");
    expect(evidenceCalls()).toHaveLength(0);
  });
});

describe("ensureAllItems 的 trace 与核对上限", () => {
  it("onTrace 逐 KC 回调，trace 与结果里的核对汇总一致", async () => {
    useScript({ answers: correctAnswers(), evidence: evidenceFor(BATCH) });
    const seen: { kcId: string; keys: string[] }[] = [];

    const result = await ensureAllItems({
      directionId: "d1",
      graph: GRAPH,
      provider: PROVIDER,
      material: MATERIAL,
      onTrace: (kcId, _name, trace) => {
        seen.push({ kcId, keys: trace.map((step) => step.key) });
      },
    });

    expect(seen).toEqual([
      { kcId: "k1", keys: ["generate", "L1", "L2", "L3", "L4", "L6", "save"] },
    ]);
    expect(result.verification).toEqual({ checked: 1, capped: [] });
  });

  it("超过 20 个 KC 时只核对前 20 个，其余照常生成并报未核对", async () => {
    const concepts: KnowledgeConcept[] = Array.from({ length: 21 }, (_, i) => ({
      id: `k${i + 1}`,
      name: `知识点${i + 1}`,
      summary: "用于上限测试",
      chapter: "第1章",
    }));
    const pack: MaterialPack = {
      id: "multi",
      title: "合成教材",
      sources: [{ id: "src", kind: "textbook", title: "合成教材" }],
      chunks: concepts.map((concept, i) => ({
        id: `chunk-${i + 1}`,
        sourceId: "src",
        kcIds: [concept.id],
        chapter: "第1章",
        section: "1.1",
        pageFrom: 1,
        pageTo: 1,
        text: EXCERPT,
      })),
      claims: [],
    };

    useScript({ answers: correctAnswers(), evidence: evidenceFor(BATCH) });
    const traced: string[] = [];
    const result = await ensureAllItems({
      directionId: "d1",
      graph: { version: "t", concepts, edges: [] },
      provider: PROVIDER,
      material: { pack, selection: { sourceIds: ["src"], resolutions: {} } },
      onTrace: (kcId) => traced.push(kcId),
    });

    expect(traced).toHaveLength(21);
    expect(evidenceCalls()).toHaveLength(20);
    expect(result.verification.checked).toBe(20);
    expect(result.verification.capped).toEqual([{ kcId: "k21", name: "知识点21" }]);
    // 第 21 个 KC 的题仍照常生成（4 题 × 21）
    expect(result.generated).toBe(84);
  });
});
