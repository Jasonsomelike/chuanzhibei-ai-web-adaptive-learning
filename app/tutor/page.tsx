"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

import { Nav, Card, SectionTitle, Pill } from "@/components/ui";
import { useStaggerIn } from "@/components/motion";
import { useSubject } from "@/lib/subject";
import { TargetPicker, targetCaption } from "@/components/target-picker";
import { progressOf } from "@/lib/learner";
import { useLearner } from "@/lib/useLearner";
import type { MasteryState } from "@/lib/mastery";
import {
  hydrateProviderFromServer,
  isProviderReady,
  loadProvider,
  maskKey,
  saveProvider,
  type ProviderConfig,
} from "@/lib/provider";
import { callChatStream, ChatError } from "@/lib/chat";
import { embedLocalQuery } from "@/lib/embedLocal";
import { buildIndex, search, type Bm25Index } from "@/lib/rag";
import { useMaterialPack } from "@/lib/materialStore";
import type { KnowledgeConcept } from "@/lib/graph";
import {
  buildUploadIndex,
  formatUploadContext,
  parseUploadCitations,
  retrieveUploads,
  uploadCitationLabel,
  type UploadChunk,
  type UploadHit,
} from "@/lib/knowledge";
import { useKnowledgeBase } from "@/lib/kbStore";
import { useAuth } from "@/lib/useAuth";
import {
  DEFAULT_SEARCH_CONFIG,
  loadSearchConfig,
  resolveSearchProvider,
  searchWeb,
  type SearchConfig,
  type SearchRuntime,
} from "@/lib/searchClient";
import {
  DEFAULT_CALL_MODE,
  loadCallMode,
  type CallMode,
} from "@/lib/serverConfig";
import { buildAnswerPlan, screenWebResults } from "@/lib/grounding";
import {
  buildSearchQuery,
  formatWebContext,
  parseWebCitations,
  webHits as toWebHits,
  webProviderLabel,
  type WebHit,
} from "@/lib/websearch";
import { extractClaims, type Claim, type ClaimVerdict } from "@/lib/verify";
import { verifyTutorClaims } from "@/lib/verifyClient";
import { ThinkingPanel } from "@/components/thinking-panel";
import { MiniMarkdown } from "@/components/mini-markdown";
import { AnswerVerification } from "@/components/answer-verification";
import { WebEvidence } from "@/components/web-evidence";
import { ReadAloud } from "@/components/read-aloud";
import type { AttachedImage } from "@/components/image-input";
import { tutorSystemPrompt } from "@/lib/tutorPersona";
import { loadTutorTone, tutoringPolicy, offlineTutoringText, type HelpLevel } from "@/lib/tutorPreferences";
import { MaterialReader } from "@/components/material-reader";
import type { SpeechSession, SpeechSupport } from "@/lib/speech";

/*
 * 图片输入按需加载：压缩/校验（image.ts）与组件只在首屏之后拉取。
 * 静态打进首屏会让 /tutor 的首屏 JS 多出一整块压缩与预览逻辑，观感上得不偿失。
 */
const ImageInput = dynamic(
  () => import("@/components/image-input").then((mod) => mod.ImageInput),
  {
    ssr: false,
    loading: () => (
      <p className="mb-2 text-xs text-[var(--ink-faint)]">图片输入加载中…</p>
    ),
  },
);
import {
  buildTutorUserPrompt,
  buildVerificationContext,
  citationVerificationBadge,
  citedMaterialSources,
  composeDeterministic,
  describeConflict,
  effectiveThinking,
  ensureAnswerDeclaration,
  extractCitedKcIds,
  hasUsableEvidence,
  materialForAnswer,
  shouldVerifyClaims,
  streamFailureDecision,
  thinkingEnabledFor,
  thinkingStrengthLabel,
  uploadUsageNote,
  type CitationRef,
} from "@/components/tutor-logic";

/**
 * 导师对话。
 *
 * 路径按能力分层，界面上必须如实区分：
 *   1. 智能体（仅服务端模式）→ /api/agent 的有界工具循环，SSE 只回
 *      text / tool_call / tool_result / notice / done；失败自动退回普通流式问答并留 notice
 *   2. 模型可用 → callChatStream（server 经 /api/llm/chat；local 直连 baseUrl）
 *   3. 模型不可用 → 知识库检索拼装
 *
 * 就绪判断只看 isProviderReady：server 模式的 apiKey 恒为空，
 * 用 `provider !== null` 或 key 是否为空判就绪会让新设备一直走「未配置」分支。
 *
 * 上传资料检索优先用本地方案（embedLocal 查询向量 + /api/kb/similar）：
 * 查询向量在浏览器里算，服务端只做精确余弦扫描并回 chunkId；任一步不可用
 * 就整段退回 BM25，并把降级原因显示在模式卡上。检索失败不阻塞提问。
 *
 * 图片只在当轮出现：压缩到长边 1568 / JPEG q0.82 / ≤400KB，最多 3 张；
 * 供应商不支持图片时显式失败并给「改为文字提问」，绝不静默去图。
 *
 * 语音只在浏览器支持 Web Speech 时启用：zh-CN、临时结果、只填空不自动发送，错误不重试。
 *
 * 流式回答的正文与思考内容分开存放、分开渲染：推理永远不会拼进 text，
 * 一次失败也不会用检索拼装覆盖已经输出的半截内容。
 */

/** 智能体轨迹里的一条工具调用；preview 只来自服务端，完整结果不回传浏览器。 */
interface AgentToolTrace {
  readonly id: string;
  readonly name: string;
  readonly serverId: string | null;
  argsPreview: string;
  /** null 表示 tool_call 已到、tool_result 还没到。 */
  ok: boolean | null;
  truncated: boolean;
  durationMs: number | null;
  preview: string | null;
}

interface AgentNotice {
  readonly level: "info" | "warn";
  readonly message: string;
}

type AgentStopReason = "stop" | "max_steps" | "loop_detected" | "budget" | "aborted" | "error";

interface AgentDoneSummary {
  readonly stopReason: AgentStopReason;
  readonly steps: number;
  readonly toolCalls: number;
  readonly elapsedMs: number;
  readonly uploads?: readonly UploadHit[];
  readonly materialContext?: string;
  readonly materialSources?: readonly string[];
}

/** 一次上传资料检索的结果与降级原因；界面直接展示。 */
interface VectorRetrievalStatus {
  /** local=本地方案参与融合；bm25=降级；none=本方向没有资料。 */
  readonly mode: "local" | "bm25" | "none";
  readonly reason: string | null;
}

interface Message {
  readonly id: string;
  readonly role: "user" | "assistant";
  text: string;
  reasoning: string;
  citations: CitationRef[];
  /** 本次回答里带 [kcId] 的说法，用于逐条核对。 */
  claims: Claim[];
  generatedByLlm: boolean;
  note?: string;
  /** 教材 / 讲义出处抬头，元素是 citationLabel 的输出，原样展示。 */
  sources: string[];
  /** 本次回答涉及的未决口径分歧，已格式化成可直接展示的一行。 */
  conflicts: string[];
  streaming: boolean;
  /** 本次请求是否开启了思考（端点不支持时为 false）。 */
  thinkingRequested: boolean;
  /** 端点拒绝了思考参数，已自动按普通模式重发。 */
  thinkingDowngraded: boolean;
  /** 本次注入模型的网络结果。检索到不等于采用。 */
  webHits: WebHit[];
  /** 回答里实际出现的 [网络n] 序号。 */
  webUsed: number[];
  webError: string | null;
  webNotice: string | null;
  webFromCache: boolean;
  /** 本次注入模型的上传片段。 */
  uploadHits: UploadHit[];
  /** 回答里实际出现的 [资料n] 序号。 */
  uploadUsed: number[];
  verdicts: ClaimVerdict[] | null;
  verificationError: string | null;
  verificationSkipped: string | null;
  checking: boolean;
  finishReason: string | null;
  /** 本条提问附带的图片数；只用于展示「图片只在本次发送」。 */
  images: number;
  /** 智能体工具轨迹；空数组表示本条不是智能体回答。 */
  agentTools: AgentToolTrace[];
  agentNotices: AgentNotice[];
  agentDone: AgentDoneSummary | null;
}

/**
 * 人格提示词：身份 + 12 条安全规则 + 语气 + 回答结构 + 禁语 + 不确定协议。
 * 语气用默认档（陪伴）；设置页不承载语气选择，页面也不额外造一个入口。
 */

/** 有摘录时展示的口径说明。没有摘录就不显示，避免暗示回答有教材依据。 */
const MATERIAL_BASIS_NOTE =
  "口径：有教材 / 讲义摘录时以摘录为准；摘录与知识点资料不一致处分别标注出处，页码只取自摘录，没标页码就不推断。";

const TUTOR_MAX_TOKENS = 1200;
const TUTOR_TIMEOUT_MS = 120_000;

function emptyMessage(id: string, role: Message["role"]): Message {
  return {
    id,
    role,
    text: "",
    reasoning: "",
    citations: [],
    claims: [],
    generatedByLlm: false,
    sources: [],
    conflicts: [],
    streaming: false,
    thinkingRequested: false,
    thinkingDowngraded: false,
    webHits: [],
    webUsed: [],
    webError: null,
    webNotice: null,
    webFromCache: false,
    uploadHits: [],
    uploadUsed: [],
    verdicts: null,
    verificationError: null,
    verificationSkipped: null,
    checking: false,
    finishReason: null,
    images: 0,
    agentTools: [],
    agentNotices: [],
    agentDone: null,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 供应商层面无法发图的原因；null 表示可以发。 */
function imageProviderProblem(provider: ProviderConfig | null): string | null {
  if (provider === null) {
    return "未配置模型供应商，无法识别图片；图片没有发送。";
  }
  if (provider.kind === "anthropic") {
    return "当前供应商走 Anthropic 协议，本项目只在 OpenAI 兼容协议上发送图片；图片没有发送。";
  }
  return null;
}

/**
 * 服务端 / 模型明确拒绝图片时，从错误里取出可展示的原因。
 *
 * 只认「确实与图片有关」的失败：其它 400（模型名错、上下文超长）走普通
 * 失败路径，不能都写成「不支持图片」。
 */
function imageFailureFromError(err: unknown, hadImages: boolean): string | null {
  if (!hadImages || !(err instanceof ChatError)) return null;
  const haystack = `${err.message}\n${err.responseBody ?? ""}`;
  if (err.kind === "unsupported" && /image|图片|vision|image_url/iu.test(haystack)) {
    return err.message;
  }
  if (
    err.kind === "http" &&
    err.status === 400 &&
    /image|图片|vision|multimodal|多模态/iu.test(haystack)
  ) {
    return `该模型不接受图片输入（${err.message}）`;
  }
  return null;
}

/** 带图时的提问：先转写【图中文字】，再在【解答】里回答，引用只来自解答段。 */
function imageQuestion(question: string, count: number): string {
  if (count <= 0) return question;
  const ask = question.trim() === "" ? "请按图片回答。" : question;
  return [
    `【图片】本次附带 ${count} 张图片。`,
    "先看图片：用「【图中文字】」逐字转写与题目有关的文字；图片里没有可读文字就写「图片里没有可读文字」。",
    "再用「【解答】」回答。引用只来自解答段，转写段里的 [知识点ID] 不算引用；看不清就直说，不要猜。",
    `学生的问题：${ask}`,
  ].join("\n");
}

interface VisionReply {
  readonly transcription: string | null;
  readonly answer: string;
}

/** 把【图中文字】/【解答】拆开；没有【解答】标记时整段都是解答。 */
function splitVisionReply(text: string): VisionReply {
  const marker = "【解答】";
  const index = text.indexOf(marker);
  if (index < 0) return { transcription: null, answer: text };
  const head = text.slice(0, index).trim();
  const body = text.slice(index + marker.length).trim();
  return {
    transcription: head === "" ? null : head,
    answer: body === "" ? head : body,
  };
}

/**
 * 声明句只作用于解答段：带图回答的第一段是转写，
 * 把声明插到最前面会让「不是来自你的教材」看起来像是在说图片。
 */
function applyVisionDeclaration(reply: string, plan: ReturnType<typeof buildAnswerPlan>): string {
  const split = splitVisionReply(reply);
  if (split.transcription === null) return ensureAnswerDeclaration(reply, plan);
  return `${split.transcription}\n\n${ensureAnswerDeclaration(split.answer, plan)}`;
}

type AnswerBlock =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly string[] };

const ORDERED_ITEM = /^\s*\d{1,2}[.、)]\s+\S/u;

/**
 * 回答列的块级切分：段落与有序列表。
 *
 * 模型输出「1. 先看 push」这类行时不能原样显示成字面量；空行分段，
 * 连续的有序列表行合并成一个列表。其它行（含无序列表）留在段落里，
 * 由 MiniMarkdown 处理行内标记。
 */
function splitAnswerBlocks(text: string): AnswerBlock[] {
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const value = paragraph.join("\n").trim();
    if (value !== "") blocks.push({ kind: "paragraph", text: value });
    paragraph = [];
  };
  const flushList = (): void => {
    if (items.length === 0) return;
    blocks.push({ kind: "list", items: [...items] });
    items = [];
  };

  for (const line of lines) {
    if (ORDERED_ITEM.test(line)) {
      flushParagraph();
      const body = line.replace(/^\s*\d{1,2}[.、)]\s+/u, "").trim();
      if (body !== "") items.push(body);
      continue;
    }
    flushList();
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  if (blocks.length === 0) blocks.push({ kind: "paragraph", text: "" });
  return blocks;
}

/**
 * 回答正文的块级渲染：段落用 <p>、有序列表用 <ol>，行内交给 MiniMarkdown。
 * 流式光标只挂在最后一个块的最后一项，不会每段都闪一个。
 */
function AnswerBody({ text, streaming }: { readonly text: string; readonly streaming: boolean }) {
  const blocks = splitAnswerBlocks(text);
  return (
    <div className="text-sm leading-[1.75]">
      {blocks.map((block, index) => {
        const last = index === blocks.length - 1;
        const trailing = last && streaming ? <span className="animate-pulse">▍</span> : null;
        if (block.kind === "list") {
          return (
            <ol key={index} className="my-2 list-decimal space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <MiniMarkdown
                    text={item}
                    trailing={
                      last && itemIndex === block.items.length - 1 ? trailing : null
                    }
                  />
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p
            key={index}
            className={
              index === 0
                ? "whitespace-pre-wrap wrap-anywhere"
                : "mt-2 whitespace-pre-wrap wrap-anywhere"
            }
          >
            <MiniMarkdown text={block.text} trailing={last ? trailing : null} />
          </p>
        );
      })}
    </div>
  );
}

type AgentStreamEvent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_call";
      readonly id: string;
      readonly name: string;
      readonly serverId: string | null;
      readonly argsPreview: string;
    }
  | {
      readonly type: "tool_result";
      readonly id: string;
      readonly name: string;
      readonly ok: boolean;
      readonly truncated: boolean;
      readonly durationMs: number;
      readonly preview: string;
    }
  | { readonly type: "notice"; readonly level: "info" | "warn"; readonly message: string }
  | {
      readonly type: "done";
      readonly stopReason: AgentStopReason;
      readonly steps: number;
      readonly toolCalls: number;
      readonly elapsedMs: number;
      readonly uploads?: readonly UploadHit[];
      readonly materialContext?: string;
      readonly materialSources?: readonly string[];
    };

interface AgentStreamOutcome {
  readonly ok: boolean;
  readonly aborted: boolean;
  readonly text: string;
  /** ok 或 aborted 时为 null；失败时是给 notice 用的人话原因。 */
  readonly error: string | null;
  readonly done: AgentDoneSummary | null;
}

const AGENT_STOP_REASONS: readonly AgentStopReason[] = [
  "stop",
  "max_steps",
  "loop_detected",
  "budget",
  "aborted",
  "error",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 逐字段校验一条 Agent 事件；未知形状返回 null，不让脏数据进状态。 */
function parseAgentEvent(raw: unknown): AgentStreamEvent | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const type = record.type;

  if (type === "text") {
    return typeof record.text === "string" ? { type, text: record.text } : null;
  }
  if (type === "tool_call") {
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name : "";
    if (id === "" || name === "") return null;
    return {
      type,
      id,
      name,
      serverId: typeof record.serverId === "string" ? record.serverId : null,
      argsPreview: typeof record.argsPreview === "string" ? record.argsPreview : "",
    };
  }
  if (type === "tool_result") {
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name : "";
    if (id === "" || name === "") return null;
    return {
      type,
      id,
      name,
      ok: record.ok === true,
      truncated: record.truncated === true,
      durationMs: numberOr(record.durationMs, 0),
      preview: typeof record.preview === "string" ? record.preview : "",
    };
  }
  if (type === "notice") {
    const message = typeof record.message === "string" ? record.message : "";
    if (message === "") return null;
    return { type, level: record.level === "warn" ? "warn" : "info", message };
  }
  if (type === "done") {
    const stopReason = AGENT_STOP_REASONS.includes(record.stopReason as AgentStopReason)
      ? (record.stopReason as AgentStopReason)
      : "error";
    return {
      type,
      stopReason,
      steps: numberOr(record.steps, 0),
      toolCalls: numberOr(record.toolCalls, 0),
      elapsedMs: numberOr(record.elapsedMs, 0),
      materialContext: typeof record.materialContext === "string" ? record.materialContext : "",
      materialSources: Array.isArray(record.materialSources) ? record.materialSources.filter((source): source is string => typeof source === "string").slice(0, 100) : [],
      uploads: Array.isArray(record.uploads) ? record.uploads.slice(0, 3).filter((hit): hit is UploadHit => {
        const row = asRecord(hit); const chunk = asRecord(row?.chunk);
        return typeof row?.score === "number" && Number.isFinite(row.score) && chunk !== null &&
          ["id", "docId", "directionId", "title", "section", "text"].every((key) => typeof chunk[key] === "string") && typeof chunk.index === "number";
      }) : [],
    };
  }
  return null;
}

/** 一条 SSE block：只读 data: 行（": ping" 心跳与其它字段跳过）。 */
function parseAgentSseBlock(block: string): AgentStreamEvent | null {
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (!line.startsWith("data:")) continue;
    dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  try {
    return parseAgentEvent(JSON.parse(dataLines.join("\n")));
  } catch {
    return null;
  }
}

/** 非 stop 的停止原因要写进 note，用户才知道回答为什么短。 */
function agentStopNote(done: AgentDoneSummary | null): string | null {
  if (done === null) return null;
  switch (done.stopReason) {
    case "stop":
      return null;
    case "max_steps":
      return "已达到工具步数上限，改用已有结果收口";
    case "loop_detected":
      return "检测到重复的工具调用，已停止";
    case "budget":
      return "本次会话时间预算用完，已停止";
    case "aborted":
      return "智能体已停止";
    case "error":
      return "智能体运行出错";
  }
}

function agentToolStatus(trace: AgentToolTrace): string {
  if (trace.ok === null) return "执行中";
  if (!trace.ok) return "失败";
  return trace.truncated ? "成功（结果已截断）" : "成功";
}

/** 智能体开关为什么不能开；null 表示可用。 */
function agentDisabledReason(loggedIn: boolean, provider: ProviderConfig | null): string | null {
  if (!loggedIn) return "智能体需要登录：工具调用在服务端执行（/api/agent）。";
  if (provider === null) return "未配置模型供应商，智能体无法运行。";
  if (provider.mode !== "server") {
    return "当前是本地直连（BYOK）模式：工具循环在服务端执行，本地模式用不了智能体。请到设置页改用服务端模式。";
  }
  return null;
}

function vectorSyncSummary(state: {
  readonly status: string;
  readonly done: number;
  readonly total: number;
  readonly message: string | null;
}): string {
  switch (state.status) {
    case "idle":
      return "未触发";
    case "loading":
      return "读取已有向量…";
    case "embedding":
      return `本地模型计算向量 ${state.done}/${state.total}`;
    case "uploading":
      return `上传向量 ${state.done}/${state.total}`;
    case "ready":
      return state.message === null ? "已同步" : `已同步（${state.message}）`;
    default:
      return state.message === null ? "不可用（仅 BM25）" : `不可用（${state.message}）`;
  }
}

interface SimilarHit {
  readonly chunkId: string;
  readonly score: number;
}

/** 严格解析 /api/kb/similar 的响应：非数字分数与非字符串 id 一律丢弃。 */
function similarHitsOf(payload: unknown): SimilarHit[] {
  const record = asRecord(payload);
  if (record === null || !Array.isArray(record.hits)) return [];
  const hits: SimilarHit[] = [];
  for (const entry of record.hits) {
    const item = asRecord(entry);
    if (item === null) continue;
    const chunkId = typeof item.chunkId === "string" ? item.chunkId.trim() : "";
    if (chunkId === "") continue;
    if (typeof item.score !== "number" || !Number.isFinite(item.score)) continue;
    hits.push({ chunkId, score: item.score });
  }
  return hits;
}

export default function TutorPage() {
  const { target, targetId, setTargetId, ready, loadingTarget } = useSubject();
  const { user } = useAuth();
  const { learner, ready: learnerReady } = useLearner(targetId, target?.graph);
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [helpLevel, setHelpLevel] = useState<HelpLevel>("hint");
  useEffect(() => {
    const question = new URLSearchParams(window.location.search).get("q");
    if (question) setInput(question.slice(0, 500));
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchConfig, setSearchConfig] = useState<SearchConfig>(DEFAULT_SEARCH_CONFIG);
  const [webOn, setWebOn] = useState(false);
  const [callMode, setCallMode] = useState<CallMode>(DEFAULT_CALL_MODE);
  /** 智能体开关：只在服务端模式可用；local / 未登录时禁用并给出原因。 */
  const [agentOn, setAgentOn] = useState(false);
  const [images, setImages] = useState<AttachedImage[]>([]);
  /** 图片发送失败后的显式恢复入口；question 是用户原本输入的文字（可能为空）。 */
  const [imageRetry, setImageRetry] = useState<{ question: string; message: string } | null>(null);
  /** 最近一次上传资料检索用没用向量、为什么降级。 */
  const [vectorStatus, setVectorStatus] = useState<VectorRetrievalStatus | null>(null);
  const [speechSupport, setSpeechSupport] = useState<SpeechSupport | null>(null);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [speechInterim, setSpeechInterim] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speechRef = useRef<SpeechSession | null>(null);
  const sequence = useRef(0);

  /*
   * 动效只包展示层：页面标题与两张控制卡一次性入场；每条消息在**追加**时
   * 播一次 0.3s 淡入 + 10px 上移。useStaggerIn 给节点打 data-motion-done，
   * 流式 patch 只改同一个节点的文本，因此不会重播；reduced-motion 下不建 tween。
   */
  const mainRef = useRef<HTMLElement>(null);
  useStaggerIn(mainRef);

  // 按学科建检索索引（学科切换时重建）
  const [index, setIndex] = useState<Bm25Index | null>(null);

  /*
   * 教材 / 讲义口径。graph 传进去是为了让笔记按绑定知识点继承章节，
   * 自定义方向没有内置资料包，返回的是空包，界面不会凭空出现出处。
   */
  const { pack: materialPack, selection: materialSelection } = useMaterialPack(
    targetId,
    target?.graph,
  );

  /* 上传资料只在本浏览器；没有绑定知识点的文档同样参与导师检索。 */
  const kb = useKnowledgeBase(targetId, user?.id);
  /*
   * 切方向时 hook 会先保留上一方向的数组直到 IndexedDB 读完。
   * 按 directionId 再过滤一次，避免这一小段时间里用错方向的资料答题。
   */
  const kbDocs = useMemo(
    () => kb.docs.filter((doc) => doc.directionId === targetId),
    [kb.docs, targetId],
  );
  const kbChunks = useMemo(
    () => kb.chunks.filter((chunk) => chunk.directionId === targetId),
    [kb.chunks, targetId],
  );

  /*
   * 网络结果筛选的方向上下文：方向名 / 说明 / 章节名 + 全部知识点名。
   * 只有与这些词真正有交集的网页才允许进入提示词；只共享「树」这种
   * 单个泛词的 Btrfs、佛经页面会在 grounding.screenWebResults 里被丢掉。
   */
  const directionTerms = useMemo(() => {
    if (!target) return [];
    const values: string[] = [target.name];
    if (target.kind === "direction") {
      if (target.description !== undefined) values.push(target.description);
    } else {
      if (target.tagline !== undefined) values.push(target.tagline);
      if (target.syllabus !== undefined) values.push(target.syllabus);
    }
    for (const concept of target.graph.concepts) values.push(concept.chapter);
    return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))];
  }, [target]);

  const kcNames = useMemo(
    () =>
      target
        ? [...new Set(target.graph.concepts.map((concept) => concept.name))]
        : [],
    [target],
  );

  /*
   * server 模式下 apiKey 为空，serverConfigured=false 时配置对象存在但不可用。
   * 渲染与 send 都只认这一个变量，避免两处对「就绪」的判断漂移。
   */
  const activeProvider: ProviderConfig | null =
    provider !== null && isProviderReady(provider) ? provider : null;

  /*
   * 搜索链路按共享登录态与设置页的调用模式走。
   * 未登录时服务端代理一定 401，强制本机直连（维基百科免密钥）。
   */
  const searchRuntime: SearchRuntime = {
    mode: user === null ? "local" : callMode,
    loggedIn: user !== null,
  };

  const nextId = (): string => {
    sequence.current += 1;
    return `msg-${sequence.current}`;
  };

  useEffect(() => {
    setProvider(loadProvider());
    const stored = loadSearchConfig();
    setSearchConfig(stored);
    setWebOn(stored.defaultOn);
    setCallMode(loadCallMode());
  }, []);

  /*
   * 语音按需加载：Web Speech 只在用户点「语音输入」时才需要，
   * 把 speech.ts 留在入口 chunk 会挤占 /tutor 的首屏预算。
   * 服务端渲染没有 window，挂载后再检测，避免 hydration 前后文案不一致。
   */
  useEffect(() => {
    let alive = true;
    void import("@/lib/speech")
      .then((mod) => {
        if (alive) setSpeechSupport(mod.detectSpeechSupport());
      })
      .catch(() => {
        if (!alive) return;
        setSpeechSupport({
          ok: false,
          reason: "unsupported",
          message: "语音模块加载失败；请改用键盘输入。",
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * 挂载与登录态变化时，用服务端保存的 llm 配置水合本地状态。
   * 401 / 网络错误返回 null：保持本地（可能是 BYOK）配置不动。
   * 新设备登录后这一步是「能直接提问」的关键——本地没有 apiKey 也不影响。
   */
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const hydrated = await hydrateProviderFromServer(controller.signal);
      if (controller.signal.aborted || hydrated === null) return;
      setProvider(hydrated);
    })();
    return () => controller.abort();
  }, [user?.id]);

  useEffect(() => {
    if (!target) return;
    /*
     * 每个知识点一篇文档：名称 + 章节 + 要掌握什么 + 题目解析。
     * 自定义方向没有内置题库（题目要按需生成），所以只用名称与摘要建索引，
     * 界面会如实标注「该方向暂无题库解析」。
     */
    const questions = target.kind === "subject" ? target.questions : [];
    const docs = target.graph.concepts.map((concept) => {
      const qs = questions.filter((q) => q.kcId === concept.id);
      const qa = qs
        .map((q, i) => `第${i + 1}题（难度${q.difficulty}）：${q.stem} 解析：${q.explanation}`)
        .join(" ");
      return {
        kcId: concept.id,
        title: concept.name,
        text: `${concept.chapter}。${concept.summary}。${qa ? `常见考点与解析：${qa}` : ""}`,
      };
    });
    abortRef.current?.abort();
    speechRef.current?.abort();
    setBusy(false);
    setIndex(buildIndex(docs));
    setMessages([]);
    setError(null);
    setImages([]);
    setImageRetry(null);
    setVectorStatus(null);
    setListening(false);
    setSpeechInterim("");
    setSpeechError(null);
  }, [target, user?.id]);

  useEffect(() => {
    /*
     * reduced-motion 下不能用 smooth：规范里 behavior:"smooth" 会绕过
     * CSS 的 scroll-behavior:auto，系统开了「减少动态效果」时仍会平滑滚动。
     */
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      speechRef.current?.abort();
    };
  }, []);

  const masteryOf = (): readonly MasteryState[] => {
    if (!learner) return [];
    return progressOf(learner, targetId, target?.graph).mastery;
  };

  const patchMessage = (id: string, patch: (message: Message) => Partial<Message>): void => {
    setMessages((prev) =>
      prev.map((message) => (message.id === id ? { ...message, ...patch(message) } : message)),
    );
  };

  const finalizeAborted = (
    id: string,
    partial: { readonly text: string; readonly reasoning: string },
    finalText?: string,
  ): void => {
    if (partial.text.trim() === "" && partial.reasoning.trim() === "") {
      // 用户一按停止就立刻停下：没有内容可保留，也不生成替代回答
      setMessages((prev) => prev.filter((message) => message.id !== id));
    } else {
      patchMessage(id, () => ({
        // 通用知识模式即使中途停止，也要保留「不是来自教材」的声明
        ...(finalText !== undefined && partial.text.trim() !== "" ? { text: finalText } : {}),
        streaming: false,
        // 没有思考内容就不留空面板；有半截思考则保留，方便用户知道模型想到哪
        thinkingRequested: partial.reasoning.trim() !== "",
        note: "已停止生成，仅保留已输出的部分内容。",
        verificationSkipped: "生成已停止，未发起引用核对。",
        checking: false,
      }));
    }
    setBusy(false);
  };

  /**
   * 上传资料检索：本地方案优先，失败整段退回 BM25。
   *
   * 本地方案 = embedLocalQuery（bge-small-zh-v1.5，512 维）+ POST /api/kb/similar
   * （服务端精确余弦）。服务端只回 chunkId + 分数，向量本身不落浏览器；
   * 两路结果用与 hybridSearchClient 相同的 RRF（K=60）融合，再过相邻切块去重。
   *
   * 不阻塞提问：查询嵌入最多等 15 秒（首次要下载 22MB 模型），相似接口 8 秒；
   * 任何一步失败都只降级，不抛给调用方（用户中断除外）。
   */
  const retrieveUploadsForQuestion = async (
    question: string,
    chunks: readonly UploadChunk[],
    signal: AbortSignal,
  ): Promise<{ hits: UploadHit[]; status: VectorRetrievalStatus }> => {
    if (chunks.length === 0) {
      return { hits: [], status: { mode: "none", reason: null } };
    }

    /*
     * 融合层按需加载：RRF 只在提交提问时用一次，静态打进首屏不划算。
     */
    const {
      HYBRID_TOP_K,
      RRF_CANDIDATES,
      RRF_K,
      VECTOR_MIN_SCORE,
      dedupeAdjacentChunks,
      reciprocalRankFusion,
    } = await import("@/lib/hybrid");

    const bm25Hits = (): UploadHit[] =>
      retrieveUploads(buildUploadIndex(chunks), chunks, question, HYBRID_TOP_K);

    if (user === null) {
      return {
        hits: bm25Hits(),
        status: {
          mode: "bm25",
          reason: "未登录：/api/kb/similar 需要会话，本次只用 BM25 关键词检索。",
        },
      };
    }

    const embedded = await embedLocalQuery(question, signal, { timeoutMs: 15_000 });
    if (!embedded.ok) {
      return {
        hits: bm25Hits(),
        status: { mode: "bm25", reason: `本地向量不可用（${embedded.message}）` },
      };
    }
    const vector = embedded.vectors[0];
    if (vector === undefined) {
      return {
        hits: bm25Hits(),
        status: { mode: "bm25", reason: "本地模型没有返回查询向量，本次只用 BM25。" },
      };
    }

    let similar: SimilarHit[];
    try {
      const timeoutAt = 8_000;
      const fetchSignal =
        typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutAt)])
          : signal;
      const response = await fetch("/api/kb/similar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          directionId: targetId,
          vector: Array.from(vector),
          limit: RRF_CANDIDATES,
        }),
        signal: fetchSignal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).trim().slice(0, 120);
        return {
          hits: bm25Hits(),
          status: {
            mode: "bm25",
            reason:
              `相似检索失败（HTTP ${response.status}${detail === "" ? "" : ` · ${detail}`}）` +
              "，本次只用 BM25。",
          },
        };
      }
      similar = similarHitsOf(await response.json().catch(() => null));
    } catch (err) {
      if (signal.aborted) throw err;
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      return {
        hits: bm25Hits(),
        status: {
          mode: "bm25",
          reason: timedOut
            ? "相似检索超时（8 秒），本次只用 BM25。"
            : `相似检索失败（${messageOf(err)}），本次只用 BM25。`,
        },
      };
    }

    const vectorRanked = similar
      .filter((hit) => hit.score >= VECTOR_MIN_SCORE)
      .map((hit) => ({ id: hit.chunkId }));
    const bm25Ranked = search(buildUploadIndex(chunks), question, RRF_CANDIDATES).map((doc) => ({
      id: doc.kcId,
    }));
    const fused = reciprocalRankFusion([bm25Ranked, vectorRanked], {
      k: RRF_K,
      weights: [1, 1],
      candidates: RRF_CANDIDATES,
    });
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk] as const));
    const scoreById = new Map(fused.map((hit) => [hit.id, hit.score] as const));
    const ranked = fused
      .map((hit) => byId.get(hit.id))
      .filter((chunk): chunk is UploadChunk => chunk !== undefined);
    const deduped = dedupeAdjacentChunks(ranked);
    const hits = deduped
      .slice(0, HYBRID_TOP_K)
      .map((chunk) => ({ chunk, score: scoreById.get(chunk.id) ?? 0 }));

    const reason =
      vectorRanked.length === 0
        ? "本地方案可用，但服务端暂无本方向向量（可能仍在同步）；本次以 BM25 为主。"
        : hits.length === 0
          ? "相似检索没有命中本机资料（可能已删除或未同步）；本次以 BM25 为主。"
          : null;
    return { hits, status: { mode: "local", reason } };
  };

  /**
   * 跑一次 /api/agent 并实时把事件写进消息。
   *
   * 事件只有五类；这里只认 text / tool_call / tool_result / notice / done。
   * 没收到 done 或 done=error 都算失败，由调用方退回普通流式问答；
   * done=budget / max_steps / loop_detected 时正文照常保留（服务端已收口）。
   */
  const streamAgentTurn = async (input: {
    readonly assistantId: string;
    readonly question: string;
    readonly images: readonly string[];
    readonly signal: AbortSignal;
  }): Promise<AgentStreamOutcome> => {
    const { assistantId, question, images: imageUrls, signal } = input;
    let response: Response;
    try {
      response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          ...(imageUrls.length > 0 ? { images: imageUrls } : {}),
          ...(target !== null && target.kind === "subject" ? { subject: targetId } : {}),
          ...(target?.kind === "direction" ? { directionId: targetId } : {}),
          tone: loadTutorTone(),
          helpLevel,
          materialSourceIds: materialSelection.sourceIds.slice(0, 20),
        }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) return { ok: false, aborted: true, text: "", error: null, done: null };
      return {
        ok: false,
        aborted: false,
        text: "",
        error: `请求失败（${messageOf(err)}）`,
        done: null,
      };
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 160);
      const status =
        response.status === 401
          ? "未登录或登录已过期"
          : response.status === 415
            ? "请求格式被拒绝"
            : `HTTP ${response.status}`;
      return {
        ok: false,
        aborted: false,
        text: "",
        error: detail === "" ? status : `${status} · ${detail}`,
        done: null,
      };
    }
    if (response.body === null) {
      return { ok: false, aborted: false, text: "", error: "响应没有可读取的事件流", done: null };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let doneSummary: AgentDoneSummary | null = null;

    const handle = (event: AgentStreamEvent): void => {
      switch (event.type) {
        case "text": {
          if (event.text === "") return;
          text += event.text;
          patchMessage(assistantId, (message) => ({ text: message.text + event.text }));
          return;
        }
        case "tool_call": {
          const trace: AgentToolTrace = {
            id: event.id,
            name: event.name,
            serverId: event.serverId,
            argsPreview: event.argsPreview,
            ok: null,
            truncated: false,
            durationMs: null,
            preview: null,
          };
          patchMessage(assistantId, (message) => ({
            agentTools: [...message.agentTools, trace],
          }));
          return;
        }
        case "tool_result": {
          patchMessage(assistantId, (message) => {
            const exists = message.agentTools.some((trace) => trace.id === event.id);
            if (!exists) {
              // tool_call 事件缺失（流被截断）时补一条，保证结果不丢
              return {
                agentTools: [
                  ...message.agentTools,
                  {
                    id: event.id,
                    name: event.name,
                    serverId: null,
                    argsPreview: "",
                    ok: event.ok,
                    truncated: event.truncated,
                    durationMs: event.durationMs,
                    preview: event.preview,
                  },
                ],
              };
            }
            return {
              agentTools: message.agentTools.map((trace) =>
                trace.id === event.id
                  ? {
                      ...trace,
                      ok: event.ok,
                      truncated: event.truncated,
                      durationMs: event.durationMs,
                      preview: event.preview,
                    }
                  : trace,
              ),
            };
          });
          return;
        }
        case "notice": {
          const notice: AgentNotice = { level: event.level, message: event.message };
          patchMessage(assistantId, (message) => ({
            agentNotices: [...message.agentNotices, notice],
          }));
          return;
        }
        case "done": {
          doneSummary = {
            stopReason: event.stopReason,
            steps: event.steps,
            toolCalls: event.toolCalls,
            elapsedMs: event.elapsedMs,
            uploads: event.uploads,
            materialContext: event.materialContext,
            materialSources: event.materialSources,
          };
          const summary = doneSummary;
          patchMessage(assistantId, (message) => ({
            agentDone: summary,
            // 已收口仍未返回结果的工具不会有后续 tool_result：标成失败，不让它一直停在「执行中」
            agentTools: message.agentTools.map((trace) =>
              trace.ok === null
                ? { ...trace, ok: false, preview: trace.preview ?? "服务端未返回该工具的结果" }
                : trace,
            ),
          }));
          return;
        }
      }
    };

    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let cut = buffer.indexOf("\n\n");
        while (cut >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = parseAgentSseBlock(block);
          if (event !== null) handle(event);
          cut = buffer.indexOf("\n\n");
        }
      }
      // 末尾没有空行（连接提前关闭）时也尝试解析一次
      const tail = parseAgentSseBlock(buffer);
      if (tail !== null) handle(tail);
    } catch (err) {
      if (signal.aborted) return { ok: false, aborted: true, text, error: null, done: doneSummary };
      return {
        ok: false,
        aborted: false,
        text,
        error: `事件流读取失败（${messageOf(err)}）`,
        done: doneSummary,
      };
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // 流已经关闭时 releaseLock 可能抛；忽略
      }
    }

    if (signal.aborted) return { ok: false, aborted: true, text, error: null, done: doneSummary };

    // done 事件在事件回调里赋值，控制流分析看不到；显式断言回联合类型
    const finalDone = doneSummary as AgentDoneSummary | null;
    if (finalDone === null) {
      return {
        ok: false,
        aborted: false,
        text,
        error: "事件流没有收到 done（连接提前结束）",
        done: null,
      };
    }
    if (finalDone.stopReason === "error") {
      return {
        ok: false,
        aborted: false,
        text,
        error: "服务端报告运行错误（详见上方提示）",
        done: finalDone,
      };
    }
    if (text.trim() === "") {
      return { ok: false, aborted: false, text, error: "智能体没有返回正文", done: finalDone };
    }
    return { ok: true, aborted: false, text, error: null, done: finalDone };
  };

  /** 引用核对异步跑：不改写回答，也不该让学生多等。 */
  const startVerification = (
    assistantId: string,
    claims: readonly Claim[],
    context: string,
    providerConfig: ProviderConfig,
    signal: AbortSignal,
  ): void => {
    void (async () => {
      try {
        const verdicts = await verifyTutorClaims(providerConfig, claims, context, signal);
        if (signal.aborted) {
          patchMessage(assistantId, () => ({
            verdicts: null,
            checking: false,
            verificationError: null,
            verificationSkipped: "核对已被后续操作取消，回答内容未改动。",
          }));
          return;
        }
        patchMessage(assistantId, () => ({
          verdicts,
          checking: false,
          verificationError: null,
        }));
      } catch (err) {
        patchMessage(assistantId, () => ({
          verdicts: null,
          checking: false,
          verificationError: messageOf(err),
        }));
      }
    })();
  };

  const send = async (
    text: string,
    options?: { readonly images?: readonly AttachedImage[]; readonly agent?: boolean },
  ): Promise<void> => {
    const typed = text.trim();
    const sendingImages = options?.images ?? images;
    /*
     * 只贴图不写字也必须能发送；两者都空才早退。
     * 给模型的 question 用带图指令，保证 /api/agent 的 question 非空（契约 min 1）。
     */
    if ((typed.length === 0 && sendingImages.length === 0) || busy || !index || !target) return;

    const imageUrls = sendingImages.map((image) => image.dataUrl);
    const hadImages = imageUrls.length > 0;
    const searchQuery = typed.length > 0 ? typed : "图片中的题目";
    const question = imageQuestion(typed, imageUrls.length);

    /*
     * 供应商层面就发不了图：显式失败，给「改为文字提问」入口。
     * 这里直接 return，不进入任何「去掉图片再发」的分支。
     */
    const imageProblem = imageProviderProblem(activeProvider);
    if (hadImages && imageProblem !== null) {
      setImageRetry({ question: typed, message: imageProblem });
      setError(null);
      return;
    }

    const useAgent = options?.agent ?? agentOn;
    const agentProblem = agentDisabledReason(user !== null, activeProvider);
    const wantsAgent = useAgent && agentProblem === null;

    const docs = search(index, searchQuery, 3);
    const mastery = masteryOf();

    /*
     * 检索命中的 kcId 才是要查教材的知识点。
     * 检索分数高但图谱里没有的 id 不查——那说明索引与图谱不同步，
     * 凭空多出一段摘录会让学生以为教材里真写了。
     */
    const conceptById = new Map(target.graph.concepts.map((concept) => [concept.id, concept] as const));
    const concepts = docs
      .map((doc) => conceptById.get(doc.kcId))
      .filter((concept): concept is KnowledgeConcept => concept !== undefined);
    const material = materialForAnswer(materialPack, materialSelection, concepts);
    const conflicts = material.conflicts.map((conflict) => describeConflict(materialPack, conflict));

    const controller = new AbortController();
    // 上一条回答的核对如果还在跑，随下一次提问一起取消
    abortRef.current?.abort();
    abortRef.current = controller;

    // 检索与向量化都要发请求，先把按钮置忙，避免同一句话被连点两次
    setError(null);
    setImageRetry(null);
    setBusy(true);
    setInput("");
    setImages([]);
    setListening(false);
    setSpeechError(null);
    setSpeechInterim("");
    speechRef.current?.abort();

    /*
     * 先算本次查询向量，再触发本地向量同步：两者共用一个 Worker，
     * 反过来先同步会让整批片段的嵌入排在查询前面，首问更容易等超时。
     * 同步不等待，第一次提问时服务端可能还没有向量，下一次才会命中。
     */
    let uploads: UploadHit[] = [];
    let uploadNotice: string | null = null;
    let vector: VectorRetrievalStatus = { mode: "none", reason: null };
    try {
      const retrieval = await retrieveUploadsForQuestion(searchQuery, kbChunks, controller.signal);
      uploads = [...retrieval.hits];
      vector = retrieval.status;
      uploadNotice = retrieval.status.reason;
    } catch (err) {
      if (controller.signal.aborted) {
        setBusy(false);
        return;
      }
      // 检索失败不阻塞回答：没有上传依据也比整次提问失败好
      uploads = [];
      vector = { mode: "bm25", reason: `上传资料检索失败（${messageOf(err)}）` };
      uploadNotice = `上传资料检索失败（${messageOf(err)}），本次未注入上传资料`;
    }
    kb.ensureVectors();
    setVectorStatus(vector);

    /*
     * 两路皆空时 uploads 为空，uploadContext 也是空串：不注入任何依据。
     * notice 只写进 message.note，不额外占一块界面。
     */
    const uploadContext = formatUploadContext(uploads);
    const materialHits = material.excerpts.size + uploads.length;

    if (controller.signal.aborted) {
      setBusy(false);
      return;
    }

    const userId = nextId();
    const assistantId = nextId();

    const assistant = emptyMessage(assistantId, "assistant");
    assistant.streaming = true;
    assistant.thinkingRequested =
      !wantsAgent && activeProvider !== null && thinkingEnabledFor(activeProvider);
    assistant.uploadHits = [...uploads];
    assistant.images = imageUrls.length;
    setMessages((prev) => [
      ...prev,
      { ...emptyMessage(userId, "user"), text: typed, images: imageUrls.length },
      assistant,
    ]);

    /*
     * 智能体优先：工具循环在服务端，/api/agent 的请求契约里没有注入网络结果的字段，
     * 所以成功后不再跑网络检索，只在 note 里说明。
     */
    const agentPlan = buildAnswerPlan({ materialHits, webHits: 0, generalAllowed: true });
    if (wantsAgent && activeProvider !== null) {
      const outcome = await streamAgentTurn({
        assistantId,
        question,
        images: imageUrls,
        signal: controller.signal,
      });

      if (outcome.aborted) {
        finalizeAborted(
          assistantId,
          { text: outcome.text, reasoning: "" },
          outcome.text.trim() === ""
            ? undefined
            : applyVisionDeclaration(outcome.text, agentPlan),
        );
        return;
      }

      if (outcome.ok) {
        const uploads = [...(outcome.done?.uploads ?? [])];
        const serverMaterial = outcome.done?.materialContext ?? "";
        const agentPlan = buildAnswerPlan({ materialHits: uploads.length + (serverMaterial.trim() ? 1 : 0), webHits: 0, generalAllowed: true });
        const reply = applyVisionDeclaration(outcome.text, agentPlan);
        const answerPart = splitVisionReply(reply).answer;
        const citationDocs = target.graph.concepts.map((concept) => ({ kcId: concept.id, title: concept.name, snippet: concept.summary, score: 0 }));
        const citations = extractCitedKcIds(answerPart, citationDocs);
        const claims = extractClaims(answerPart, citationDocs.map((doc) => doc.kcId));
        const verificationContext = buildVerificationContext(serverMaterial, uploads);
        const canVerify = shouldVerifyClaims(activeProvider, claims.length, verificationContext);

        let verificationSkipped: string | null = null;
        if (claims.length > 0 && activeProvider.verification === false) {
          verificationSkipped = "设置中已关闭引用核对，本条回答未核对。";
        } else if (claims.length > 0 && !hasUsableEvidence(verificationContext)) {
          verificationSkipped = "本次没有注入可核对的教材 / 上传原文，引用无从核对。";
        }

        const notes = [
          `智能体：${outcome.done?.steps ?? 0} 步 · ${outcome.done?.toolCalls ?? 0} 次工具调用`,
          agentStopNote(outcome.done),
          `向量检索：${
            vector.mode === "local"
              ? "本地模型 + /api/kb/similar"
              : vector.mode === "bm25"
                ? "已降级 BM25"
                : "本方向没有上传资料"
          }`,
          uploadNotice,
          hadImages ? "图片只在本次请求里发送，服务端不落库。" : null,
          webOn ? "智能体模式不注入网络检索结果（联网补充只在普通问答生效）。" : null,
        ].filter((part): part is string => part !== null && part !== "");

        patchMessage(assistantId, () => ({
          text: reply,
          reasoning: "",
          citations,
          claims,
          generatedByLlm: true,
          note: notes.join(" · "),
          sources: citations.length > 0 ? [...(outcome.done?.materialSources ?? [])] : [],
          conflicts,
          streaming: false,
          thinkingRequested: false,
          thinkingDowngraded: false,
          webHits: [],
          webUsed: [],
          webError: null,
          webNotice: null,
          webFromCache: false,
          uploadHits: uploads,
          uploadUsed: [...parseUploadCitations(answerPart, uploads.length)],
          verdicts: null,
          verificationError: null,
          verificationSkipped,
          checking: canVerify,
          finishReason: outcome.done?.stopReason ?? null,
        }));
        setBusy(false);
        if (canVerify) {
          startVerification(
            assistantId,
            claims,
            verificationContext,
            activeProvider,
            controller.signal,
          );
        }
        return;
      }

      /*
       * 失败自动退回普通流式问答：先清空智能体已经流出的半截正文，
       * 否则两段回答会拼在一起；轨迹与 notice 保留，用户能看见发生过什么。
       */
      const reason = outcome.error ?? "智能体没有返回可用结果";
      patchMessage(assistantId, (message) => ({
        text: "",
        streaming: true,
        // 退回普通流式问答后，思考面板按普通路径的能力重新显示
        thinkingRequested: thinkingEnabledFor(activeProvider),
        agentNotices: [
          ...message.agentNotices,
          { level: "warn", message: `智能体调用失败（${reason}），已退回普通流式问答。` },
        ],
        agentDone: null,
      }));
    } else if (useAgent && agentProblem !== null) {
      patchMessage(assistantId, (message) => ({
        agentNotices: [
          ...message.agentNotices,
          { level: "warn", message: `未启用智能体：${agentProblem}` },
        ],
      }));
    }

    // 联网检索先于模型调用：结果要注入提示词；失败只记录，不阻塞回答
    let webResults: WebHit[] = [];
    let webError: string | null = null;
    let webNotice: string | null = null;
    let webFromCache = false;

    if (webOn) {
      /*
       * 登录态与调用模式来自共享 auth store / 设置页：未登录时 DeepSeek
       * 与 Tavily 服务端代理都不可用，必须如实回退并提示，而不是静默失败。
       */
      const outcome = await searchWeb(
        buildSearchQuery(question, docs.map((doc) => doc.title)),
        searchConfig,
        controller.signal,
        searchRuntime,
      );
      const hits = toWebHits(outcome.results);
      /*
       * 先筛后注入：只共享「树」这种泛词、主题却是文件系统 / 宗教的网页
       * 直接丢掉，既不进提示词，也不进引用区。删除后重新编号，
       * 保证 [网络n] 与界面列表严格对应。
       */
      const screened = screenWebResults(hits, { directionTerms, kcNames, question });
      webResults = toWebHits(screened.kept.map((entry) => entry.result));
      webError = outcome.error;
      webNotice = outcome.notice;
      webFromCache = outcome.fromCache;
      if (screened.dropped.length > 0) {
        const filterNote = `已过滤 ${screened.dropped.length} 条与当前方向无关的网络结果`;
        webNotice = webNotice === null ? filterNote : `${webNotice}；${filterNote}`;
      }
    }

    if (controller.signal.aborted) {
      setMessages((prev) => prev.filter((message) => message.id !== assistantId));
      setBusy(false);
      return;
    }

    /*
     * 回答口径在注入前定好：教材 / 上传资料有摘录才算命中；
     * 都没命中时允许模型用通用知识，但必须带声明。
     */
    const plan = buildAnswerPlan({
      materialHits,
      webHits: webResults.length,
      generalAllowed: activeProvider !== null,
    });

    const webContext = formatWebContext(webResults);
    const userPrompt = buildTutorUserPrompt({
      question,
      docs,
      mastery,
      materialContext: material.promptContext,
      uploadContext,
      webContext,
      plan,
    });
    /*
     * 图片作为 content parts：文本在前、图片在后。
     * 只发 data URI（≤400KB × 3），不发 http(s) 地址——那会让上游替我们抓取。
     */
    const userContent = hadImages
      ? [
          { type: "text" as const, text: userPrompt },
          ...imageUrls.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ]
      : userPrompt;
    // 核对用实际注入的完整原文（多片段），不是每 KC 第一条摘录
    const verificationContext = buildVerificationContext(material.promptContext, uploads);

    // 未配置 / 服务端没有 llm 行：直接走结构化拼装
    if (activeProvider === null) {
      const composed = composeDeterministic({
        question,
        docs,
        mastery,
        excerpts: material.excerpts,
        uploads,
        web: webResults,
      });
      patchMessage(assistantId, () => ({
        text: offlineTutoringText(helpLevel, composed.text, docs[0]?.title),
        citations: docs.map((doc) => ({ kcId: doc.kcId, title: doc.title })),
        generatedByLlm: false,
        note: [
          "未配置模型供应商，本次由知识库检索拼装",
          webError !== null ? `联网检索失败（${webError}），未使用网络结果` : null,
          uploadNotice,
        ]
          .filter((part): part is string => part !== null)
          .join("；"),
        sources: composed.sources,
        conflicts,
        streaming: false,
        thinkingRequested: false,
        webHits: webResults,
        webUsed: [...parseWebCitations(composed.text, webResults.length)],
        webError,
        webNotice,
        webFromCache,
        uploadHits: uploads,
        uploadUsed: [...parseUploadCitations(composed.text, uploads.length)],
        verdicts: null,
        verificationError: null,
        verificationSkipped: null,
        checking: false,
        finishReason: null,
      }));
      setBusy(false);
      return;
    }

    const thinkingRequested = thinkingEnabledFor(activeProvider);
    const partial = { text: "", reasoning: "" };

    try {
      const result = await callChatStream(
        activeProvider,
        {
          system: tutorSystemPrompt({ tone: loadTutorTone() }) + "\n" + tutoringPolicy(helpLevel),
          user: userContent,
          maxTokens: TUTOR_MAX_TOKENS,
          temperature: 0.3,
          timeoutMs: TUTOR_TIMEOUT_MS,
          thinking: effectiveThinking(activeProvider),
          signal: controller.signal,
        },
        {
          onText: (delta) => {
            partial.text += delta;
            patchMessage(assistantId, (message) => ({ text: message.text + delta }));
          },
          onReasoning: (delta) => {
            partial.reasoning += delta;
            patchMessage(assistantId, (message) => ({ reasoning: message.reasoning + delta }));
          },
        },
      );

      if (controller.signal.aborted) {
        finalizeAborted(
          assistantId,
          partial,
          partial.text.trim() === "" ? undefined : applyVisionDeclaration(partial.text, plan),
        );
        return;
      }

      /*
       * 声明句由代码兜底，而不是只写在提示词里：
       * 通用知识回答必须以「不是来自你的教材」开头；
       * refuse-hint 时只保留声明，不展示模型编的答案。
       * 带图回答只对【解答】段做声明与引用解析，转写段里的 [c09] 不算引用。
       */
      const reply = applyVisionDeclaration(result.text, plan);
      const answerPart = splitVisionReply(reply).answer;
      /*
       * 引用不是「检索到了什么」，而是「回复里真的引用了什么」。
       * 模型不引用或引错时，界面不能仍显示 3 个知识点。
       */
      const citations = extractCitedKcIds(answerPart, docs);
      const claims = extractClaims(answerPart, docs.map((doc) => doc.kcId));
      const canVerify = shouldVerifyClaims(activeProvider, claims.length, verificationContext);

      /*
       * 只有确认是思考字段被拒才写 unsupported。
       * 模型名错、上下文超长这类 400 去掉思考参数也不会好，
       * 把端点标成「不支持思考」会让设置页给出错误的修复建议。
       */
      if (result.downgradeReason === "thinking") {
        // 写回 unsupported：下一条回答直接按普通模式发，不再先吃一次 400
        const next: ProviderConfig = { ...activeProvider, thinkingStatus: "unsupported" };
        saveProvider(next);
        setProvider(next);
      }

      const notes = [`${activeProvider.label} · ${activeProvider.model}`];
      if (citations.length === 0) notes.push("本次回复未包含可核对的 [知识点ID] 引用");
      if (result.downgradeReason === "thinking") {
        notes.push("该端点不支持思考参数，已按普通模式工作，本次没有思考内容");
      }
      if (result.finishReason === "length" || result.finishReason === "max_tokens") {
        notes.push("回答达到长度上限，可能不完整");
      }
      if (result.finishReason === "incomplete") {
        notes.push("流没有正常结束（缺少结束标记），回答可能不完整");
      }
      if (result.text.trim() === "" && result.reasoning.trim() !== "") {
        notes.push("模型只返回了思考内容，没有正文；思考过程不代表结论");
      }
      if (plan.mode === "general-only") {
        notes.push("本次未命中教材 / 上传资料，回答基于通用知识并已声明");
      }
      if (plan.mode === "refuse-hint") {
        notes.push("教材 / 上传资料未命中，已按要求不作答");
      }
      if (uploadNotice !== null) notes.push(uploadNotice);

      let verificationSkipped: string | null = null;
      if (claims.length > 0 && activeProvider.verification === false) {
        verificationSkipped = "设置中已关闭引用核对，本条回答未核对。";
      } else if (claims.length > 0 && !hasUsableEvidence(verificationContext)) {
        verificationSkipped = "本次没有注入可核对的教材 / 上传原文，引用无从核对。";
      }

      patchMessage(assistantId, () => ({
        text: reply,
        reasoning: result.reasoning,
        citations,
        claims,
        generatedByLlm: true,
        note: notes.join(" · "),
        /*
         * 出处只列「模型真的引用了的 [知识点ID] 对应的摘录」。
         * 注入过但没被引用的书目不出现在这里——检索到不等于采用。
         */
        sources: citedMaterialSources(
          material.excerpts,
          citations.map((citation) => citation.kcId),
        ),
        conflicts,
        streaming: false,
        thinkingRequested: thinkingRequested && !result.thinkingDowngraded,
        thinkingDowngraded: result.thinkingDowngraded,
        webHits: webResults,
        webUsed: [...parseWebCitations(answerPart, webResults.length)],
        webError,
        webNotice,
        webFromCache,
        uploadHits: uploads,
        uploadUsed: [...parseUploadCitations(answerPart, uploads.length)],
        verdicts: null,
        verificationError: null,
        verificationSkipped,
        checking: canVerify,
        finishReason: result.finishReason,
      }));
      setBusy(false);

      /*
       * 核对在正文结束后异步跑：它不改写回答，也不该让学生多等。
       * 失败时 verifyTutorClaims 返回 unable，界面按 fail-open 展示。
       */
      if (canVerify) {
        startVerification(assistantId, claims, verificationContext, activeProvider, controller.signal);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        finalizeAborted(
          assistantId,
          partial,
          partial.text.trim() === "" ? undefined : applyVisionDeclaration(partial.text, plan),
        );
        return;
      }

      /*
       * 图片相关的失败必须显式停下：不再退回检索拼装，也不去掉图片重发。
       * 否则用户会拿到一段「看起来正常、其实没看图」的回答。
       */
      const imageProblem = imageFailureFromError(err, hadImages);
      if (imageProblem !== null) {
        patchMessage(assistantId, () => ({
          text: "",
          streaming: false,
          thinkingRequested: false,
          note: `图片没有发送成功：${imageProblem}`,
          webHits: [],
          webUsed: [],
          webError: null,
          webNotice: null,
          webFromCache: false,
          uploadHits: uploads,
          uploadUsed: [],
          verdicts: null,
          verificationError: null,
          verificationSkipped: "图片未发送，未发起引用核对。",
          checking: false,
        }));
        setImageRetry({ question: typed, message: imageProblem });
        setBusy(false);
        return;
      }

      const reason = err instanceof Error ? err.message : String(err);
      /*
       * 带图提问的其它失败（网络、超时）也不退回检索拼装：
       * 用户问的是图片，给一段没看图的文字答案属于答非所问。
       */
      if (hadImages) {
        patchMessage(assistantId, () => ({
          text: "",
          streaming: false,
          thinkingRequested: false,
          note: `带图提问失败（${reason}），没有生成替代回答，避免答非所问。`,
          uploadHits: uploads,
          uploadUsed: [],
          verdicts: null,
          verificationError: null,
          verificationSkipped: "图片提问失败，未发起引用核对。",
          checking: false,
        }));
        setImageRetry({ question: typed, message: `带图提问失败（${reason}）` });
        setError(null);
        setBusy(false);
        return;
      }

      const decision = streamFailureDecision(partial.text, partial.reasoning);

      if (decision === "keep-partial") {
        /*
         * 半截失败不覆盖：已经输出的内容就是模型真实说过的话，
         * 用检索拼装替换会让用户误以为那是完整的模型回答。
         * 但通用知识模式仍要补上「不是来自教材」的声明。
         */
        const partialText =
          partial.text.trim() === "" ? partial.text : applyVisionDeclaration(partial.text, plan);
        const partialAnswer = splitVisionReply(partialText).answer;
        patchMessage(assistantId, () => ({
          text: partialText,
          streaming: false,
          thinkingRequested: partial.reasoning.trim() !== "",
          note:
            `生成中断（${reason}）；以下是已生成的部分内容，未完成。` +
            (uploadNotice !== null ? `；${uploadNotice}` : ""),
          webHits: webResults,
          webUsed: [...parseWebCitations(partialAnswer, webResults.length)],
          webError,
          webNotice,
          webFromCache,
          uploadHits: uploads,
          uploadUsed: [...parseUploadCitations(partialAnswer, uploads.length)],
          verificationSkipped: "生成中断，未发起引用核对。",
          checking: false,
        }));
        setError(`模型生成中断：${reason}。已保留已输出的部分内容。`);
      } else {
        const composed = composeDeterministic({
          question,
          docs,
          mastery,
          excerpts: material.excerpts,
          uploads,
          web: webResults,
        });
        patchMessage(assistantId, () => ({
          text: offlineTutoringText(helpLevel, composed.text, docs[0]?.title),
          citations: docs.map((doc) => ({ kcId: doc.kcId, title: doc.title })),
          generatedByLlm: false,
          note:
            `模型调用失败（${reason}），已退回检索拼装` +
            (uploadNotice !== null ? `；${uploadNotice}` : ""),
          sources: composed.sources,
          conflicts,
          streaming: false,
          thinkingRequested: false,
          webHits: webResults,
          webUsed: [...parseWebCitations(composed.text, webResults.length)],
          webError,
          webNotice,
          webFromCache,
          uploadHits: uploads,
          uploadUsed: [...parseUploadCitations(composed.text, uploads.length)],
          verdicts: null,
          verificationError: null,
          verificationSkipped: null,
          checking: false,
          finishReason: null,
        }));
        setError(`模型调用失败：${reason}。可以到设置页测试连通性。`);
      }
      setBusy(false);
    }
  };

  if (!ready || !learnerReady || !target) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-3xl px-5 py-10">
          <p className="text-[var(--ink-soft)]">
            {loadingTarget ? "正在加载自定义方向…" : "正在加载…"}
          </p>
        </main>
      </>
    );
  }

  const searchProvider = resolveSearchProvider(searchConfig, searchRuntime);
  /** 智能体开关为什么不能开；与 send 里的判断同源，避免两处漂移。 */
  const agentBlocked = agentDisabledReason(user !== null, activeProvider);

  /** 语音按钮：开 / 停都只操作识别器，不自动发送。 */
  const toggleSpeech = async (): Promise<void> => {
    if (listening) {
      speechRef.current?.stop();
      setListening(false);
      setSpeechInterim("");
      return;
    }
    if (speechSupport === null) return;
    if (!speechSupport.ok) {
      setSpeechError(speechSupport.message);
      return;
    }

    // 模块在挂载时已经预加载，这里只是拿函数；失败时按「不可用」处理，不重试
    let speech: typeof import("@/lib/speech");
    try {
      speech = await import("@/lib/speech");
    } catch {
      setSpeechError("语音模块加载失败；请改用键盘输入。");
      return;
    }

    const session = speech.createSpeechSession(speechSupport.create(), {
      onFinal: (text) => {
        // 只填空：转写结果进输入框，是否发送由用户自己按
        setInput((previous) => speech.appendTranscript(previous, text));
      },
      onInterim: (text) => setSpeechInterim(text),
      onError: (message) => {
        setSpeechError(message);
        setListening(false);
      },
      onEnd: () => {
        setListening(false);
        setSpeechInterim("");
      },
    });
    speechRef.current = session;
    const problem = session.start();
    if (problem !== null) {
      setSpeechError(problem);
      setListening(false);
      return;
    }
    setSpeechError(null);
    setListening(true);
  };

  /** 「改为文字提问」：移除图片；有文字就按文字重发，没有就停在输入框等用户写。 */
  const retryAsText = (): void => {
    const retry = imageRetry;
    setImageRetry(null);
    setImages([]);
    if (retry === null) return;
    if (retry.question.trim() !== "") {
      void send(retry.question, { images: [], agent: false });
      return;
    }
    setInput("");
    setError("已移除图片。请用文字描述你的问题，再点发送。");
  };

  return (
    <>
      <Nav />
      <main id="main" ref={mainRef} className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-5" data-motion="hero">
          <h1 className="text-2xl font-semibold tracking-tight">课程导师</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            回答优先依据你的教材 / 上传资料；未命中时可用通用知识，但会明确声明。没配供应商时用检索结果拼装。
          </p>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <aside className="order-2 min-w-0 space-y-4 lg:order-1" aria-label="课程学习材料">
          <Card>
            <p className="text-xs text-[var(--accent)]">当前课程</p>
            <h2 className="mt-1 text-lg font-semibold">{target.name}</h2>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">读一段原文，再带着具体卡点提问。</p>
            <Link href={`/path?${target.kind === "direction" ? "direction" : "subject"}=${encodeURIComponent(targetId)}`} className="mt-3 inline-block text-sm text-[var(--accent)] underline">返回当前学习计划 →</Link>
          </Card>
          <MaterialReader pack={materialPack} concepts={target.graph.concepts} selection={materialSelection} />
          {kbChunks.length > 0 ? <details className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <summary className="cursor-pointer text-sm font-medium">我的资料 · {kbDocs.length} 份</summary>
            <div className="mt-3 max-h-80 space-y-3 overflow-y-auto">
              {kbChunks.slice(0, 12).map((chunk) => <div key={chunk.id}>
                <h3 className="text-sm font-medium">{chunk.title}{chunk.pageFrom ? ` · 第 ${chunk.pageFrom} 页` : ""}</h3>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[var(--ink-soft)]">{chunk.text}</p>
                <button type="button" onClick={() => setInput(`请引导我理解《${chunk.title}》这一段：${chunk.text.slice(0, 160)}`)} className="mt-1 text-xs text-[var(--accent)] underline">围绕这段提问</button>
              </div>)}
            </div>
          </details> : null}
        <details className="rounded-xl border border-[var(--line)] p-4">
        <summary className="cursor-pointer text-sm font-medium">切换课程与回答设置</summary>
        <div className="mt-4">
        {/* 目标切换 */}
        <Card className="mb-4" motion="target">
          <p className="mb-2 text-sm font-medium">当前学习目标</p>
          <TargetPicker current={targetId} onChange={setTargetId} />
          {target ? (
            <p className="mt-2 text-xs text-[var(--ink-faint)]">{targetCaption(target)}</p>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-[var(--ink-faint)]">
            {kb.loading
              ? "正在读取本地上传资料…"
              : kb.error !== null
                ? `上传资料读取失败：${kb.error}`
                : kbDocs.length > 0
                  ? `本方向已上传 ${kbDocs.length} 份资料（${kbChunks.length} 段），回答会检索这些片段；只在本浏览器可见。`
                  : "本方向还没有上传资料。上传教材、讲义或 PPT 文字稿（md / txt / pdf）后，回答会优先引用你自己的资料并标注出处。"}
            {" · "}
            <Link
              href={kbDocs.length === 0 ? "/directions?kb=open" : "/directions"}
              className="underline"
            >
              {kbDocs.length === 0 ? "去上传教材讲义" : "管理上传资料"}
            </Link>
          </p>
        </Card>

        {/* 当前模式 */}
        <Card className="mb-5" motion="mode">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--ink-soft)]">当前模式</span>
            {activeProvider ? (
              <>
                <Pill tone="good">大模型 + 检索</Pill>
                <span className="min-w-0 max-w-full wrap-anywhere text-xs text-[var(--ink-faint)]">
                  {activeProvider.label} · {activeProvider.model} ·{" "}
                  {activeProvider.mode === "server"
                    ? "服务端代发"
                    : `key ${maskKey(activeProvider.apiKey)}`}
                </span>
              </>
            ) : (
              <>
                <Pill tone="warn">知识库检索</Pill>
                <span className="text-xs text-[var(--ink-faint)]">
                  未配置供应商，回答由知识点文档检索拼装 ·{" "}
                  <Link href="/settings" className="underline">
                    去配置
                  </Link>
                </span>
              </>
            )}
          </div>
          {activeProvider ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-faint)]">
              <span>思考档：{thinkingStrengthLabel(activeProvider.thinking ?? "off")}</span>
              {activeProvider.thinkingStatus === "unsupported" ? (
                <Pill tone="warn">端点不支持思考参数，已按普通模式</Pill>
              ) : null}
              <span>引用核对：{activeProvider.verification === false ? "关" : "开"}</span>
              <Link href="/settings" className="underline">
                调整设置
              </Link>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[var(--ink-faint)]">
              未配置模型时不发起引用核对；检索拼装不需要网络与密钥。
            </p>
          )}

          {/* 向量检索：本地方案优先，降级原因必须可见 */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-faint)]">
            <span>
              向量检索：
              {vectorStatus === null
                ? "等待首次提问"
                : vectorStatus.mode === "local"
                  ? "本地模型 + /api/kb/similar"
                  : vectorStatus.mode === "bm25"
                    ? "已降级 BM25"
                    : "本方向没有上传资料"}
            </span>
            <span>本地向量同步：{vectorSyncSummary(kb.vectorSync)}</span>
            {kb.syncWarning !== null ? (
              <span className="text-[var(--warn)]">{kb.syncWarning}</span>
            ) : null}
          </div>
          {vectorStatus !== null && vectorStatus.reason !== null ? (
            <p className="mt-1 text-xs leading-relaxed text-[var(--warn)]">
              向量降级原因：{vectorStatus.reason}
            </p>
          ) : null}

          {/* 智能体开关：只在服务端模式可用；不可用时说明原因，而不是静默隐藏 */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3 text-xs">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={agentOn && agentBlocked === null}
                onChange={(event) => setAgentOn(event.target.checked)}
                disabled={agentBlocked !== null || busy}
                className="h-4 w-4"
              />
              智能体（服务端工具循环）
            </label>
            <span
              className={
                agentBlocked === null ? "text-[var(--ink-faint)]" : "text-[var(--warn)]"
              }
            >
              {agentBlocked === null
                ? "回答前可调用只读工具；失败会自动退回普通流式问答并留下提示。"
                : agentBlocked}
            </span>
          </div>
        </Card>

        </div>
        </details>
        </aside>
        <section className="order-1 min-w-0 lg:order-2" aria-label="学习辅导对话">
        <fieldset className="mb-4 flex flex-wrap gap-2">
          <legend className="mb-2 text-sm font-medium">希望学伴怎样帮你？</legend>
          {([ ["hint", "1 · 给我提示"], ["steps", "2 · 引导步骤"], ["explain", "3 · 完整讲解"] ] as const).map(([level, label]) => <button
            type="button" key={level} disabled={busy} aria-pressed={helpLevel === level} onClick={() => setHelpLevel(level)}
            className={`rounded-lg border px-3 py-2 text-sm ${helpLevel === level ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line-strong)] text-[var(--ink-soft)]"}`}>{label}</button>)}
        </fieldset>
        {/* 对话区 */}
        <div className="mb-4 space-y-3">
          {messages.length === 0 ? (
            <Card motion="suggestions">
              <SectionTitle hint="点一个试试，或者直接输入你的问题。">
                可以这样问
              </SectionTitle>
              <div className="flex flex-wrap gap-2">
                {[
                  "为什么给我排这一步？",
                  `${target?.graph.concepts[0]?.name ?? ""}是什么`,
                  `${target?.graph.concepts[1]?.name ?? ""}的重点是什么`,
                  "我现在的薄弱点在哪",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm text-[var(--ink-soft)] hover:bg-[var(--line)]"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </Card>
          ) : null}

          {messages.map((message) =>
            message.role === "user" ? (
              <Card
                key={message.id}
                motion="message"
                className="ml-8 border-[var(--accent)] bg-[var(--accent-soft)]"
              >
                <p className="text-sm leading-[1.75]">
                  {message.text !== "" ? <MiniMarkdown text={message.text} /> : "（图片提问）"}
                </p>
                {message.images > 0 ? (
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    附 {message.images} 张图片，只在当轮发送
                  </p>
                ) : null}
              </Card>
            ) : (
              <article
                key={message.id}
                data-motion="message"
                className="max-w-[36em] border-t border-[var(--line)] pt-5"
              >
                <ThinkingPanel
                  reasoning={message.reasoning}
                  textStarted={message.text.trim() !== ""}
                  streaming={message.streaming}
                  enabled={message.thinkingRequested}
                />

                {message.conflicts.length > 0 ? (
                <div className="mb-3 rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2">
                  <p className="text-xs font-medium text-[var(--warn)]">口径未定，先看两说</p>
                  {message.conflicts.map((conflict) => (
                    <p
                      key={conflict}
                      className="mt-1 text-xs leading-relaxed text-[var(--warn)]"
                    >
                      {conflict}
                    </p>
                  ))}
                </div>
              ) : null}

              {message.text !== "" ? (
                /*
                 * 阅读列：段落与有序列表按块渲染，行内仍是 MiniMarkdown
                 * （**粗体**、`行内代码`、[kcId] pill、换行），不引 Markdown 依赖。
                 */
                <AnswerBody text={message.text} streaming={message.streaming} />
              ) : message.streaming ? (
                <div className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                  {message.reasoning !== ""
                    ? "模型仍在思考，正文尚未开始…"
                    : `正在检索课程知识库${webOn ? "与网络" : ""}并生成回答…`}
                </div>
              ) : null}

              {/* 智能体轨迹：可折叠；只显示服务端给的 preview，完整结果不回传 */}
              {message.agentNotices
                .filter((notice) => notice.level === "warn")
                .map((notice, index) => (
                  <p
                    key={`agent-warn-${index}`}
                    className="mt-2 text-xs leading-relaxed text-[var(--warn)]"
                  >
                    {notice.message}
                  </p>
                ))}
              {message.agentTools.length > 0 ||
              message.agentNotices.some((notice) => notice.level === "info") ? (
                <details className="mt-3 rounded-lg border border-[var(--line)] px-3 py-2">
                  <summary className="cursor-pointer text-xs text-[var(--ink-soft)]">
                    工具轨迹（{message.agentTools.length}）
                    {message.agentDone !== null
                      ? ` · ${message.agentDone.steps} 步 · ${message.agentDone.toolCalls} 次调用 · ${Math.round(message.agentDone.elapsedMs / 100) / 10}s`
                      : ""}
                  </summary>
                  {message.agentTools.length > 0 ? (
                    <ul className="mt-2 space-y-1.5">
                      {message.agentTools.map((trace, traceIndex) => (
                        <li key={`${trace.id}-${traceIndex}`} className="text-xs">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <code className="rounded bg-[var(--line)] px-1 py-0.5 font-mono">
                              {trace.name}
                            </code>
                            {trace.serverId !== null ? (
                              <Pill tone="neutral">MCP {trace.serverId}</Pill>
                            ) : null}
                            <span
                              className={
                                trace.ok === false
                                  ? "text-[var(--bad)]"
                                  : "text-[var(--ink-faint)]"
                              }
                            >
                              {agentToolStatus(trace)}
                            </span>
                            {trace.durationMs !== null ? (
                              <span className="text-[var(--ink-faint)]">
                                {Math.round(trace.durationMs)}ms
                              </span>
                            ) : null}
                            {trace.truncated ? <Pill tone="warn">结果已截断</Pill> : null}
                          </div>
                          {trace.argsPreview !== "" ? (
                            <p className="mt-0.5 break-words font-mono text-[0.7rem] leading-relaxed text-[var(--ink-faint)]">
                              参数：{trace.argsPreview}
                            </p>
                          ) : null}
                          {trace.preview !== null && trace.preview !== "" ? (
                            <p className="mt-0.5 break-words text-[0.7rem] leading-relaxed text-[var(--ink-faint)]">
                              结果预览：{trace.preview}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {message.agentNotices.some((notice) => notice.level === "info") ? (
                    <ul className="mt-2 space-y-1 border-t border-[var(--line)] pt-2">
                      {message.agentNotices
                        .filter((notice) => notice.level === "info")
                        .map((notice, index) => (
                          <li
                            key={`info-${index}`}
                            className="text-xs leading-relaxed text-[var(--ink-faint)]"
                          >
                            {notice.message}
                          </li>
                        ))}
                    </ul>
                  ) : null}
                  <p className="mt-2 text-[0.7rem] leading-relaxed text-[var(--ink-faint)]">
                    轨迹只保留服务端返回的预览，完整工具结果不回传浏览器；刷新即失。
                  </p>
                </details>
              ) : null}

              {message.role === "assistant" ? (
                <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
                  {message.citations.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-[var(--ink-faint)]">引用</span>
                      {message.citations.map((citation) => {
                        const badge = citationVerificationBadge(
                          citation.kcId,
                          message.claims,
                          message.verdicts,
                        );
                        return (
                          <span key={citation.kcId} className="inline-flex items-center gap-1">
                            {/*
                              引用 Pill 可点：跳到路径页并高亮这个知识点。
                              路径页只在 ?kc= 命中当前路径时滚动 + 描边，
                              不在路径里就静默降级为一次普通跳转。
                            */}
                            <Link
                              href={`/path?kc=${encodeURIComponent(citation.kcId)}`}
                              title={`在路径中定位「${citation.title}」`}
                              className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                            >
                              {citation.title} [{citation.kcId}]
                            </Link>
                            {badge !== null ? (
                              <Pill tone={badge.tone}>{badge.label}</Pill>
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}

                  {message.sources.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-xs leading-relaxed text-[var(--ink-soft)]">
                        出处：{message.sources.join("；")}
                      </p>
                      <p className="text-xs leading-relaxed text-[var(--ink-faint)]">
                        {MATERIAL_BASIS_NOTE}
                      </p>
                    </div>
                  ) : null}

                  {message.uploadHits.length > 0 ? (
                    <div className="rounded-lg border border-[var(--line)] bg-[var(--line)]/30 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-medium text-[var(--ink-soft)]">
                          上传资料（本浏览器，未核对）
                        </p>
                        <Pill tone={message.uploadUsed.length > 0 ? "accent" : "neutral"}>
                          {message.uploadUsed.length > 0
                            ? `已引用 ${message.uploadUsed.length}/${message.uploadHits.length}`
                            : "未标注引用"}
                        </Pill>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">
                        {uploadUsageNote(message.uploadUsed.length, message.uploadHits.length)}
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {message.uploadHits.map((hit, index) => {
                          const ref = index + 1;
                          const used = message.uploadUsed.includes(ref);
                          return (
                            <li key={hit.chunk.id} className={used ? "" : "opacity-70"}>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-[var(--ink-faint)]">
                                  [资料{ref}]
                                </span>
                                <span className="text-xs text-[var(--ink-soft)]">
                                  {uploadCitationLabel(hit)}
                                </span>
                                {used ? <Pill tone="accent">已引用</Pill> : null}
                              </div>
                              <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-faint)]">
                                {hit.chunk.text.trim().slice(0, 160)}
                                {hit.chunk.text.trim().length > 160 ? "…" : ""}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  <WebEvidence
                    hits={message.webHits}
                    used={message.webUsed}
                    error={message.webError}
                    notice={message.webNotice}
                    fromCache={message.webFromCache}
                  />

                  <AnswerVerification
                    claims={message.claims}
                    verdicts={message.verdicts}
                    checking={message.checking}
                    error={message.verificationError}
                    skippedReason={message.verificationSkipped}
                  />

                  {message.note !== undefined && message.note !== "" ? (
                    <p className="text-xs text-[var(--ink-faint)]">{message.note}</p>
                  ) : null}

                  {message.text.trim() !== "" ? (
                    <ReadAloud id={message.id} text={message.text} disabled={message.streaming} />
                  ) : null}
                </div>
              ) : null}
              </article>
            ),
          )}

          {error !== null ? (
            <Card className="border-[var(--bad)] bg-[var(--bad-soft)]">
              <p className="text-sm text-[var(--bad)]">{error}</p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                路径功能不受影响——它不依赖网络与大模型。
              </p>
            </Card>
          ) : null}

          {/* 图片失败：显式停下，给「改为文字提问」，绝不静默去图 */}
          {imageRetry !== null ? (
            <Card className="border-[var(--warn)] bg-[var(--warn-soft)]">
              <p className="text-sm text-[var(--warn)]">{imageRetry.message}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
                图片没有发送，也没有被静默去掉。可以换成文字描述，或到设置页换一个支持图片的模型。
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={retryAsText}
                  className="rounded-lg border border-[var(--warn)] px-3 py-1 text-xs font-medium text-[var(--warn)] hover:bg-[var(--surface)]"
                >
                  改为文字提问
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImageRetry(null);
                    setImages([]);
                  }}
                  className="rounded-lg border border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--ink-soft)] hover:bg-[var(--line)]"
                >
                  移除图片
                </button>
              </div>
            </Card>
          ) : null}

          <div ref={endRef} />
        </div>

        <div className="sticky bottom-0 z-10 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-sm" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <details className="mb-2">
        <summary className="cursor-pointer text-xs text-[var(--ink-soft)]">添加图片、语音或联网补充</summary>
        <div className="mt-3">
        {/* 图片输入：粘贴 / 选择 / 拍照；最多 3 张 */}
        <ImageInput images={images} onChange={setImages} disabled={busy} />

        {/* 输入 */}
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={webOn}
              onChange={(event) => setWebOn(event.target.checked)}
              disabled={busy}
              className="h-4 w-4"
            />
            联网补充（外部网页，未核对）
          </label>
          <span className="text-[var(--ink-faint)]">
            当前：{webProviderLabel(searchProvider.provider)} · 搜索失败不阻塞回答
          </span>
          {webOn && searchProvider.notice !== null ? (
            <span className="text-[var(--warn)]">{searchProvider.notice}</span>
          ) : null}
          <Link href="/settings" className="text-[var(--ink-faint)] underline">
            搜索设置
          </Link>
        </div>

        {/* 语音输入：运行时检测；只填空，不自动发送；错误不重试 */}
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          {speechSupport === null ? (
            <span className="text-[var(--ink-faint)]">语音输入：检测中…</span>
          ) : speechSupport.ok ? (
            <button
              type="button"
              onClick={() => void toggleSpeech()}
              disabled={busy}
              aria-pressed={listening}
              className={
                listening
                  ? "rounded-lg border border-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]"
                  : "rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs text-[var(--ink-soft)] hover:bg-[var(--line)] disabled:opacity-40"
              }
            >
              {listening ? "停止听写" : "语音输入"}
            </button>
          ) : (
            <button
              type="button"
              disabled
              title={speechSupport.message}
              className="rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs text-[var(--ink-soft)] opacity-40"
            >
              语音输入
            </button>
          )}
          {speechSupport !== null && !speechSupport.ok ? (
            <span className="text-[var(--ink-faint)]">{speechSupport.message}</span>
          ) : null}
          {listening ? (
            <span className="text-[var(--accent)]">
              正在听…{speechInterim !== "" ? `「${speechInterim}」` : ""}
            </span>
          ) : null}
          {speechError !== null ? (
            <span className="text-[var(--warn)]">{speechError}</span>
          ) : null}
          {speechSupport?.ok === true && !listening ? (
            <span className="text-[var(--ink-faint)]">zh-CN · 只填空，不自动发送</span>
          ) : null}
        </div>

        </div>
        </details>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
          className="flex gap-2"
        >
          <label htmlFor="q" className="sr-only">
            输入你的问题
          </label>
          <input
            id="q"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={500}
            placeholder="问点什么，比如「为什么给我排这一步」"
            className="min-w-0 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="rounded-lg border border-[var(--bad)] px-4 py-2 text-sm font-medium text-[var(--bad)] hover:bg-[var(--bad-soft)]"
            >
              停止
            </button>
          ) : (
            <button
              type="submit"
              disabled={input.trim().length === 0 && images.length === 0}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:opacity-40"
            >
              发送
            </button>
          )}
        </form>
        </div>
        </section>
        </div>
      </main>
    </>
  );
}
