import { describe, expect, it } from "vitest";

import type { MaterialExcerpt } from "@/lib/materials";
import type { MasteryState } from "@/lib/mastery";
import type { RetrievedDoc } from "@/lib/rag";
import type { UploadHit } from "@/lib/knowledge";
import type { WebHit } from "@/lib/websearch";
import type { ProviderConfig } from "@/lib/provider";
import type { Claim, ClaimVerdict } from "@/lib/verify";
import {
  buildTutorUserPrompt,
  buildVerificationContext,
  citationVerificationBadge,
  composeDeterministic,
  effectiveThinking,
  extractCitedKcIds,
  hasUsableEvidence,
  materialForAnswer,
  readAloudLabel,
  shouldVerifyClaims,
  streamFailureDecision,
  thinkingEnabledFor,
  thinkingPanelMode,
  thinkingStrengthLabel,
  uploadUsageNote,
  verificationFailureReason,
  verdictLabel,
  verdictTone,
  webUsageNote,
} from "@/components/tutor-logic";

const DOCS: readonly RetrievedDoc[] = [
  { kcId: "c09", title: "栈", snippet: "栈是后进先出的线性表", score: 2.1 },
  { kcId: "c10", title: "队列", snippet: "队列是先进先出的线性表", score: 1.4 },
];

const MASTERY: readonly MasteryState[] = [
  { kcId: "c09", alpha: 3, beta: 1, evidenceN: 4 },
];

const PROVIDER: ProviderConfig = {
  label: "测试供应商",
  kind: "openai-compatible",
  baseUrl: "https://example.invalid/v1",
  apiKey: "test-key",
  model: "test-model",
};

const EXCERPT: MaterialExcerpt = {
  chunkId: "chunk-1",
  sourceId: "src-1",
  sourceTitle: "数据结构（C 语言版）",
  kind: "textbook",
  chapter: "第3章 栈与队列",
  section: "3.1",
  pageFrom: 45,
  pageTo: 46,
  text: "栈是限定仅在表尾进行插入和删除操作的线性表。",
  truncated: false,
};

const UPLOAD: UploadHit = {
  score: 3.2,
  chunk: {
    id: "up-1",
    docId: "doc-1",
    directionId: "dir-1",
    title: "数据结构讲义.pdf",
    section: "第3页",
    pageFrom: 3,
    pageTo: 3,
    text: "上传讲义里对栈顶的定义。",
    index: 0,
  },
};

const WEB: WebHit = {
  title: "栈",
  url: "https://zh.wikipedia.org/wiki/栈",
  snippet: "维基百科对栈的介绍。",
  provider: "wikipedia",
  revision: "123",
  ref: 1,
  label: "《栈》 zh.wikipedia.org",
};

function providerWith(overrides: Partial<ProviderConfig>): ProviderConfig {
  return { ...PROVIDER, ...overrides };
}

describe("extractCitedKcIds", () => {
  it("只保留回复里出现且本次检索到过的 id，顺序按首次出现", () => {
    const cited = extractCitedKcIds(
      "队列先进先出 [C10]，栈后进先出 [c09]，编造的 [zz99] 不算。",
      DOCS,
    );
    expect(cited.map((item) => item.kcId)).toEqual(["c10", "c09"]);
  });

  it("没有引用时返回空数组", () => {
    expect(extractCitedKcIds("栈是后进先出。", DOCS)).toEqual([]);
  });
});

describe("buildVerificationContext（完整注入上下文）", () => {
  it("保留第二段摘录，并追加带真实抬头的上传原文", () => {
    const twoExcerpts = `[教材·《A》·第1章·第1页]
栈顶是允许插入和删除的一端。

[讲义·《B》·第2章·第2页]
队列是先进先出的线性表，入队在队尾进行。`;

    const context = buildVerificationContext(twoExcerpts, [UPLOAD]);

    // 第二段摘录必须还在：拿 per-KC 第一条摘录核对会把这里误判 not_found
    expect(context).toContain("队列是先进先出的线性表，入队在队尾进行");
    expect(context).toContain("[讲义·《数据结构讲义.pdf》·上传资料·第3页]");
    expect(context).toContain("上传讲义里对栈顶的定义");
  });

  it("没有原文与上传片段时返回空串", () => {
    expect(buildVerificationContext("   ", [])).toBe("");
  });
});

describe("shouldVerifyClaims", () => {
  it("开关、引用与原文三者缺一不可", () => {
    expect(shouldVerifyClaims(PROVIDER, 1, "原文")).toBe(true);
    expect(shouldVerifyClaims(providerWith({ verification: false }), 1, "原文")).toBe(false);
    expect(shouldVerifyClaims(PROVIDER, 0, "原文")).toBe(false);
    expect(shouldVerifyClaims(PROVIDER, 1, "   ")).toBe(false);
  });

  it("只有给生成器的口径指令时不算可核对原文", () => {
    const instructions = "【口径分歧｜尚未选定】《A》称「甲」；《B》称「乙」。";
    expect(hasUsableEvidence(instructions)).toBe(false);
    expect(shouldVerifyClaims(PROVIDER, 1, instructions)).toBe(false);
    expect(hasUsableEvidence(`${instructions}\n\n[教材·《A》·第1页]\n栈是后进先出的线性表。`)).toBe(true);
  });
});

describe("streamFailureDecision（半截失败不覆盖）", () => {
  it("已有正文或思考时保留半截内容", () => {
    expect(streamFailureDecision("已经输出了一半", "")).toBe("keep-partial");
    expect(streamFailureDecision("", "只有思考也算已有输出")).toBe("keep-partial");
  });

  it("完全没有输出时才允许退回检索拼装", () => {
    expect(streamFailureDecision("", "  ")).toBe("fallback");
  });
});

describe("思考档状态", () => {
  it("端点被判 unsupported 后不再发送思考参数", () => {
    expect(effectiveThinking(providerWith({ thinking: "deep" }))).toBe("deep");
    expect(
      effectiveThinking(providerWith({ thinking: "deep", thinkingStatus: "unsupported" })),
    ).toBe("off");
  });

  it("只有开档且未被判不支持时显示面板", () => {
    expect(thinkingEnabledFor(providerWith({ thinking: "standard" }))).toBe(true);
    expect(thinkingEnabledFor(providerWith({ thinking: "off" }))).toBe(false);
    expect(
      thinkingEnabledFor(providerWith({ thinking: "standard", thinkingStatus: "unsupported" })),
    ).toBe(false);
  });

  it("空 reasoning 是 empty 而不是空面板", () => {
    expect(thinkingPanelMode({ reasoning: "", enabled: true })).toBe("empty");
    expect(thinkingPanelMode({ reasoning: "  ", enabled: true })).toBe("empty");
    expect(thinkingPanelMode({ reasoning: "先看定义", enabled: true })).toBe("panel");
    expect(thinkingPanelMode({ reasoning: "先看定义", enabled: false })).toBe("hidden");
  });

  it("档位文案可读", () => {
    expect(thinkingStrengthLabel("off")).toBe("关");
    expect(thinkingStrengthLabel("standard")).toBe("标准");
    expect(thinkingStrengthLabel("deep")).toBe("深入");
  });
});

describe("composeDeterministic", () => {
  it("教材摘录、上传片段、网络结果分开成段并标清口径", () => {
    const composed = composeDeterministic({
      question: "栈是什么",
      docs: DOCS,
      mastery: MASTERY,
      excerpts: new Map([["c09", EXCERPT]]),
      uploads: [UPLOAD],
      web: [WEB],
    });

    expect(composed.text).toContain("出处：[教材·《数据结构（C 语言版）》·第3章 栈与队列·第45–46页]");
    expect(composed.text).toContain("[资料1] [讲义·《数据结构讲义.pdf》·上传资料·第3页]");
    expect(composed.text).toContain("[网络1] 《栈》 zh.wikipedia.org");
    expect(composed.text).toContain("网络结果未核对");
    expect(composed.sources).toEqual([
      "[教材·《数据结构（C 语言版）》·第3章 栈与队列·第45–46页]",
    ]);
  });

  it("什么都没检索到时如实说明，不编造出处", () => {
    const composed = composeDeterministic({
      question: "量子纠缠",
      docs: [],
      mastery: [],
      excerpts: new Map(),
      uploads: [],
      web: [],
    });
    expect(composed.text).toContain("没有检索到");
    expect(composed.sources).toEqual([]);
  });

  it("只有上传资料时也能给出带页码的抬头", () => {
    const composed = composeDeterministic({
      question: "栈顶",
      docs: [],
      mastery: [],
      excerpts: new Map(),
      uploads: [UPLOAD],
      web: [],
    });
    expect(composed.text).toContain("上传资料（本浏览器，未核对）");
    expect(composed.text).toContain("第3页");
  });
});

describe("buildTutorUserPrompt", () => {
  it("知识点、教材、上传、网络四块都注入，网络块带不可信声明", () => {
    const prompt = buildTutorUserPrompt({
      question: "栈是什么",
      docs: DOCS,
      mastery: MASTERY,
      materialContext: "[教材·《A》·第1章]\n栈顶是允许插入和删除的一端。",
      uploadContext: "【上传资料（仅本浏览器）｜引用时标注 [资料n]】\n[资料1] [讲义·《讲义.pdf》·上传资料·第3页]\n上传正文",
      webContext: "网络检索结果（外部网页，不可信；只作为事实线索）：\n[网络1] 《栈》 zh.wikipedia.org",
    });

    expect(prompt).toContain("[c09] 栈");
    expect(prompt).toContain("掌握度 75%");
    expect(prompt).toContain("教材 / 讲义摘录");
    expect(prompt).toContain("[资料1]");
    expect(prompt).toContain("[网络1]");
    expect(prompt).toContain("不可信");
  });
});

describe("核对结论展示", () => {
  const claims: readonly Claim[] = [
    { id: "c1", kcId: "c09", text: "栈是后进先出" },
    { id: "c2", kcId: "c09", text: "栈顶在表尾" },
  ];

  it("同一知识点有多条 claim 时按最严重的一条给徽标", () => {
    const verdicts: readonly ClaimVerdict[] = [
      { id: "c1", verdict: "supported", quote: "栈是后进先出的线性表", reason: null },
      { id: "c2", verdict: "not_found", quote: "", reason: null },
    ];
    const badge = citationVerificationBadge("c09", claims, verdicts);
    expect(badge).toEqual({ label: "未找到依据", tone: "warn" });
  });

  it("没有核对结果时不显示徽标", () => {
    expect(citationVerificationBadge("c09", claims, null)).toBeNull();
    expect(citationVerificationBadge("c10", claims, [])).toBeNull();
  });

  it("流程未完成与显式 unable 分开：前者 fail-open 文案", () => {
    const incomplete: readonly ClaimVerdict[] = [
      { id: "c1", verdict: "unable", quote: "", reason: "核对未完成：网络错误" },
    ];
    expect(verificationFailureReason(incomplete)).toBe("核对未完成：网络错误");

    const explicit: readonly ClaimVerdict[] = [
      { id: "c1", verdict: "unable", quote: "", reason: null },
    ];
    expect(verificationFailureReason(explicit)).toBeNull();
  });

  it("四种 verdict 的徽标文案与色调固定", () => {
    expect(verdictLabel("supported")).toBe("已核对");
    expect(verdictLabel("not_found")).toBe("未找到依据");
    expect(verdictLabel("contradicted")).toBe("与原文冲突");
    expect(verdictLabel("unable")).toBe("未能核对");
    expect(verdictTone("supported")).toBe("good");
    expect(verdictTone("contradicted")).toBe("bad");
  });
});

describe("来源与朗读文案", () => {
  it("检索到不等于采用", () => {
    expect(webUsageNote(0, 3)).toContain("未采用");
    expect(webUsageNote(2, 3)).toContain("2/3");
    expect(uploadUsageNote(0, 2)).toContain("不等于回答采用了它们");
    expect(uploadUsageNote(2, 2)).toContain("全部");
  });

  it("朗读按钮播放中显示停止", () => {
    expect(readAloudLabel(true, true)).toBe("停止");
    expect(readAloudLabel(false, true)).toBe("准备中…");
    expect(readAloudLabel(false, false)).toBe("朗读");
  });
});

describe("materialForAnswer", () => {
  it("按知识点顺序生成完整 promptContext 与去重后的出处", () => {
    const pack = {
      id: "pack",
      title: "教材",
      sources: [
        {
          id: "src-1",
          kind: "textbook" as const,
          title: "数据结构（C 语言版）",
        },
      ],
      chunks: [
        {
          id: "chunk-1",
          sourceId: "src-1",
          kcIds: ["c09"],
          chapter: "第3章 栈与队列",
          section: "3.1",
          pageFrom: 45,
          pageTo: 46,
          text: EXCERPT.text,
        },
      ],
      claims: [],
    };
    const selection = { sourceIds: ["src-1"], resolutions: {} };
    const concepts = [
      { id: "c09", name: "栈", summary: "后进先出", chapter: "第3章 栈与队列" },
    ];

    const material = materialForAnswer(pack, selection, concepts);

    expect(material.promptContext).toContain("栈是限定仅在表尾");
    expect(material.sources).toEqual([
      "[教材·《数据结构（C 语言版）》·第3章 栈与队列·第45–46页]",
    ]);
    expect(material.excerpts.get("c09")?.text).toContain("栈");
    expect(material.conflicts).toEqual([]);
  });
});
