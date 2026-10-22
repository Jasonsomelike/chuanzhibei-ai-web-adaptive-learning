/**
 * LLM 接入层：可选、可降级、可解释。
 *
 * 核心设计（见 research/06-synthesis.md §3.3）：
 * - LLM 只做「解释与内容生成」，**不参与路径排序**。排序由 plan.ts 的纯函数完成。
 * - 没有配置 API key 时，系统仍然完整可用：导师回答退化为
 *   「检索到的知识点 + 题库解析 + 掌握度数值」的结构化拼装，
 *   仍然是可用的教学反馈，只是少了自然语言的润色。
 * - 这条降级路径不是兜底话术，而是本项目「LLM 不是必需品」这一主张的实现。
 */

import { search, type RetrievedDoc } from "@/lib/rag";
import { kbIndex } from "@/data/kb";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { masteryMean, masterySd, type MasteryState } from "@/lib/mastery";

export type LlmProvider = "deepseek" | "openai" | "none";

export interface LlmConfig {
  readonly provider: LlmProvider;
  readonly apiKey: string | null;
  readonly baseUrl: string;
  readonly model: string;
}

/**
 * 从环境变量读配置。没有 key 就返回 provider="none"，
 * 调用方据此走降级路径，而不是抛错。
 */
export function readLlmConfig(): LlmConfig {
  const deepseek = process.env.DEEPSEEK_API_KEY?.trim();
  const openai = process.env.OPENAI_API_KEY?.trim();

  if (deepseek) {
    return {
      provider: "deepseek",
      apiKey: deepseek,
      baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
      model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
    };
  }
  if (openai) {
    return {
      provider: "openai",
      apiKey: openai,
      baseUrl: process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    };
  }
  return { provider: "none", apiKey: null, baseUrl: "", model: "" };
}

/** 一次导师回答的完整结构。无论是否用 LLM，字段都齐全。 */
export interface TutorAnswer {
  /** 回答正文。 */
  readonly answer: string;
  /** 引用了哪些知识点。这是「可追溯」的落点。 */
  readonly citations: readonly { kcId: string; title: string }[];
  /** 是否由 LLM 生成。false 表示走的是结构化拼装。 */
  readonly generatedByLlm: boolean;
  /** 生成失败时的原因，用于界面如实展示。 */
  readonly fallbackReason?: string;
}

/** 导师上下文：学生当前状态。 */
export interface TutorContext {
  readonly question: string;
  readonly mastery: readonly MasteryState[];
  /** 当前路径上的知识点，用于回答「为什么排这一步」。 */
  readonly focusKcId?: string;
}

const SYSTEM_PROMPT = `你是一门《数据结构》课程的助教。你的回答必须遵守：

1. 只依据提供的「知识点资料」作答。资料里没有的内容，直接说「资料里没有这一条」，不要凭记忆补充。
2. 每个结论后面用 [知识点ID] 标注依据，例如「栈是后进先出 [c09]」。
3. 如果学生问「为什么给我排这一步」，用他当前的掌握度数值来解释，不要编造他没做过的题。
4. 不要许诺系统没有的功能。
5. 中文回答，控制在 200 字以内，不要用「首先/其次/最后」这种套话。`;

/** 拼装给 LLM 的资料块。检索不到就不硬塞。 */
function buildContextBlock(docs: readonly RetrievedDoc[], mastery: readonly MasteryState[]): string {
  const byId = new Map(knowledgeGraph.concepts.map((c) => [c.id, c]));
  const masteryById = new Map(mastery.map((m) => [m.kcId, m]));

  const docBlock = docs
    .map((d) => {
      const m = masteryById.get(d.kcId);
      const state = m
        ? `学生当前：已测 ${m.evidenceN} 题，掌握度 ${Math.round(masteryMean(m) * 100)}%（±${Math.round(masterySd(m) * 100)}）`
        : "学生当前：未测评";
      return `[${d.kcId}] ${d.title}\n资料：${d.snippet}\n${state}`;
    })
    .join("\n\n");

  const focus = docs.length > 0 ? "" : "";
  void byId;
  void focus;
  return docBlock;
}

/**
 * 无 LLM 时的回答：把检索结果与掌握度拼成结构化反馈。
 *
 * 这不是「抱歉我做不到」的兜底，而是一份可用的教学反馈：
 * 命中哪些知识点、学生现在什么水平、下一步该做什么。
 */
export function composeDeterministicAnswer(
  question: string,
  docs: readonly RetrievedDoc[],
  mastery: readonly MasteryState[],
): TutorAnswer {
  const masteryById = new Map(mastery.map((m) => [m.kcId, m]));

  if (docs.length === 0) {
    return {
      answer:
        `课程资料里没有检索到与「${question}」直接相关的内容。` +
        `本课程当前覆盖 40 个知识点（数据结构：复杂度、线性表、栈队列、串、树、图、查找、排序）。` +
        `可以换个说法，或者告诉我你正在看哪一章。`,
      citations: [],
      generatedByLlm: false,
    };
  }

  const lines: string[] = [];
  const citations: { kcId: string; title: string }[] = [];

  for (const d of docs) {
    const m = masteryById.get(d.kcId);
    citations.push({ kcId: d.kcId, title: d.title });

    if (m) {
      const pct = Math.round(masteryMean(m) * 100);
      const margin = Math.round(masterySd(m) * 100);
      lines.push(
        `**${d.title}** [${d.kcId}]\n` +
          `${d.snippet}\n` +
          `你目前在这个知识点上已测 ${m.evidenceN} 题，掌握度 ${pct}%（±${margin}）。`,
      );
    } else {
      lines.push(`**${d.title}** [${d.kcId}]\n${d.snippet}\n你还没有测过这个知识点。`);
    }
  }

  return {
    answer:
      lines.join("\n\n") +
      `\n\n（当前未配置大模型 API，以上内容由课程知识库直接检索拼装，不含生成式改写。` +
      `配置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 后会得到自然语言讲解，检索依据不变。）`,
    citations,
    generatedByLlm: false,
    fallbackReason: "未配置大模型 API key",
  };
}

/**
 * 调 LLM。失败时抛错，由上层决定是否降级——
 * 让降级决策集中在一处，而不是散落在每个调用点。
 */
async function callLlm(
  config: LlmConfig,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!config.apiKey) throw new Error("no api key");

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: 600,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("LLM 返回空内容");
  return text;
}

/**
 * 回答学生提问。先检索，再决定用 LLM 还是结构化拼装。
 *
 * 检索始终执行——即使 LLM 可用，引用也来自检索结果，
 * 这样「回答引用了哪些知识点」不依赖模型自述。
 */
export async function answerQuestion(
  ctx: TutorContext,
  config: LlmConfig = readLlmConfig(),
  signal?: AbortSignal,
): Promise<TutorAnswer> {
  const docs = search(kbIndex, ctx.question, 3);

  if (config.provider === "none" || !config.apiKey) {
    return composeDeterministicAnswer(ctx.question, docs, ctx.mastery);
  }

  const contextBlock = buildContextBlock(docs, ctx.mastery);
  const userPrompt =
    `学生的问题：${ctx.question}\n\n` +
    (contextBlock ? `可用资料：\n${contextBlock}` : "（没有检索到相关资料，请直接说明资料里没有）");

  try {
    const text = await callLlm(config, SYSTEM_PROMPT, userPrompt, signal);
    return {
      answer: text,
      citations: docs.map((d) => ({ kcId: d.kcId, title: d.title })),
      generatedByLlm: true,
    };
  } catch (err) {
    // LLM 挂了不影响可用性——这是「拔掉 key 路径仍出」的具体实现
    const fallback = composeDeterministicAnswer(ctx.question, docs, ctx.mastery);
    return {
      ...fallback,
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}
