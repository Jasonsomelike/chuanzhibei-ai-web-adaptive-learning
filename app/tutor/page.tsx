"use client";

import { uploadDocument } from "@/lib/documentClient";
import type { DocumentReference } from "@/lib/documentContracts";
import { estimateTokens, budgetUploadHits, contextBudget, readContextBudget } from "@/lib/contextBudget";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Copy, GitBranch, History, Check, RefreshCw, GraduationCap, Paperclip, Globe, Mic } from "lucide-react";
import { appendAttachedImages } from "@/components/image-input";
import { browserImageCodec, prepareImage, remainingImageSlots, IMAGE_MAX_COUNT } from "@/lib/image";
import { detectUploadKind } from "@/components/knowledge-upload";
import { MAX_FILE_BYTES } from "@/lib/knowledge";
import { AppDialog } from "@/components/primitives/dialog";
import { ConversationSidebar } from "@/components/conversation-sidebar";
import { archiveContent, type ArchivedMessage } from "@/lib/conversationContracts";
import { useConversations } from "@/lib/useConversations";
import { buildTutorQuestion as imageQuestion } from "@/lib/tutorQuestion";

import { Nav, Card, Pill } from "@/components/ui";
import { TutorRail } from "@/components/tutor-rail";
import { Icon } from "@/components/icons";
import { useSubject } from "@/lib/subject";
import { TargetPicker, targetCaption } from "@/components/target-picker";
import { progressOf } from "@/lib/learner";
import { useLearner } from "@/lib/useLearner";
import { citationLabel } from "@/lib/materials";
import { targetQuery } from "@/lib/target";
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
import { TeachingTaskCard } from "@/components/teaching-task-card";
import { assessmentResult, workflowSnapshot, INTENT_LABELS, type AssessmentResult, type TeachingIntent, type WorkflowSnapshot } from "@/lib/learningWorkflowContracts";
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
  readonly workflow?: WorkflowSnapshot;
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
  materialContext?: string;
  originals?: { kcId: string; label: string; text: string }[];
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
  workflow: WorkflowSnapshot | null;
  assessment: AssessmentResult | null;
  attachments: AttachedImage[];
  documents:DocumentReference[];
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
    workflow: null,
    assessment: null,
    attachments: [],
    documents: [],
  };
}

const conversationCodec = {
  content(message: Message) {
    const data = { ...message };
    for (const key of ["id","role","workflow","assessment"]) Reflect.deleteProperty(data,key);
    if (data.agentDone) {
      data.agentDone = { ...data.agentDone };
      Reflect.deleteProperty(data.agentDone,"workflow");
    }
    return archiveContent.parse(data);
  },
  hydrate(record: ArchivedMessage): Message {
    return { ...emptyMessage(record.id,record.role),...record.content, streaming:false, checking:false,
      workflow:record.proof?.workflow ?? null, assessment:record.proof?.assessment ?? null,
      ...(record.state === "pending" ? { note:"这轮回答尚未完成。可刷新记录，或停止这轮后继续。" } : record.state === "interrupted" && !record.content.note ? { note:"本轮生成已中断，已保留收到的内容。" } : {}) };
  },
};

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
function AnswerBody({ text, streaming, onCitation }: { readonly text: string; readonly streaming: boolean; readonly onCitation: (kcId: string) => void }) {
  const blocks = splitAnswerBlocks(text);
  return (
    <div className="tutor-answer-body text-sm leading-[1.75]">
      {blocks.map((block, index) => {
        const last = index === blocks.length - 1;
        const trailing = last && streaming ? <span aria-hidden="true">▍</span> : null;
        if (block.kind === "list") {
          return (
            <ol key={index} className="my-2 list-decimal space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <MiniMarkdown
                    text={item}
                    onCitation={onCitation}
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
            <MiniMarkdown text={block.text} trailing={last ? trailing : null} onCitation={onCitation} />
          </p>
        );
      })}
    </div>
  );
}

type AgentStreamEvent =
  | { readonly type: "workflow"; readonly workflow: WorkflowSnapshot }
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
      readonly workflow?: WorkflowSnapshot;
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

  if (type === "workflow") {
    const parsed = workflowSnapshot.safeParse(record.workflow);
    return parsed.success ? { type, workflow: parsed.data } : null;
  }

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
      workflow: workflowSnapshot.safeParse(record.workflow).success ? workflowSnapshot.parse(record.workflow) : undefined,
      materialContext: typeof record.materialContext === "string" ? record.materialContext : "",
      materialSources: Array.isArray(record.materialSources) ? record.materialSources.filter((source): source is string => typeof source === "string").slice(0, 100) : [],
      uploads: Array.isArray(record.uploads) ? record.uploads.slice(0, 100).filter((hit): hit is UploadHit => {
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
  const { user, loading: authLoading } = useAuth();
  const { learner, ready: learnerReady, refreshProgress } = useLearner(targetId, target?.graph);
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const history = useConversations({ owner:user?.id ?? null,ready:ready && !authLoading,targetId,targetName:target?.name ?? targetId,codec:conversationCodec });
  const { messages,setMessages } = history;
  const [input, setInput] = useState("");
  const [helpLevel, setHelpLevel] = useState<HelpLevel>("hint");
  useEffect(() => {
    const question = new URLSearchParams(window.location.search).get("q");
    if (question) setInput(question.slice(0, 500));
  }, []);
  const [busy, setBusyState] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const setBusy = (value: boolean) => { if (history.isCurrent()) setBusyState(value); };
  const setError = (value: string | null) => { if (history.isCurrent()) setErrorState(value); };
  const [searchConfig, setSearchConfig] = useState<SearchConfig>(DEFAULT_SEARCH_CONFIG);
  const [webOn, setWebOn] = useState(false);
  /** 附件（📎）的处理进度和结果。 */
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [documentDraft,setDocumentDraft]=useState<{scope:string;items:DocumentReference[]}|null>(null);
  const [documentBusy,setDocumentBusy]=useState(false);
  const documentScope=`${user?.id??"anonymous"}:${targetId}:${history.active?.id??"new"}`;
  const currentDocumentScope=useRef(documentScope);currentDocumentScope.current=documentScope;
  const pendingDocuments=documentDraft?.scope===documentScope?documentDraft.items:[];
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachIdRef = useRef(0);

  /** Images accompany the question; documents are parsed and indexed once on the server. */
  const onAttachFiles = (files: FileList | null): void => {
    if (!files || files.length === 0 || documentBusy || busy) return;
    setAttachNotice(null);
    void (async () => {
      const notes: string[] = [];
      let current = images;
      for (const file of Array.from(files)) {
        if (file.type.startsWith("image/")) {
          if (remainingImageSlots(current.length) <= 0) {
            notes.push(`图片最多 ${IMAGE_MAX_COUNT} 张，已忽略「${file.name || "粘贴的图片"}」。`);
            continue;
          }
          try {
            const result = await prepareImage(file, browserImageCodec());
            if (result.ok) {
              attachIdRef.current += 1;
              const merged = appendAttachedImages(
                current,
                [{ ...result.image, id: `img-${attachIdRef.current}`, name: file.name.trim() === "" ? "粘贴的图片" : file.name }],
              );
              if (merged.images.length > current.length) {
                current = merged.images;
                setImages(merged.images);
              }
            } else {
              notes.push(`${file.name || "图片"}：${result.message}`);
            }
          } catch (err) {
            notes.push(`${file.name || "图片"}：压缩失败（${err instanceof Error ? err.message : String(err)}）`);
          }
          continue;
        }
        const kind = detectUploadKind(file.name);
        if (kind === null) {
          notes.push(`不支持的文件类型：${file.name}（支持图片与 txt / md / pdf）`);
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          notes.push(`${file.name}：超过 64MB 上限`);
          continue;
        }
        try {
          if(!user) {notes.push("请先登录，再上传可跨设备复用的文档附件。");continue;}
          if(pendingDocuments.length>=20) {notes.push("每个会话最多关联 20 份附件。");continue;}
          const scope=documentScope;
          setDocumentBusy(true);
          const doc=await uploadDocument(file,targetId,message=>{if(currentDocumentScope.current===scope)setAttachNotice(message);});
          if(currentDocumentScope.current===scope)setDocumentDraft(old=>({scope,items:[...(old?.scope===scope?old.items:[]).filter(d=>d.id!==doc.id),doc].slice(-20)}));
          notes.push(`「${doc.name}」已就绪${doc.ocrPages?`，含 ${doc.ocrPages} 页 OCR`:""}，回答时会按需引用`);
        } catch (err) {
          notes.push(`${file.name}：读取失败（${err instanceof Error ? err.message : String(err)}）`);
        }
      }
      setDocumentBusy(false);
      setAttachNotice(notes.length > 0 ? notes.join("；") : null);
    })();
  };
  const [callMode, setCallMode] = useState<CallMode>(DEFAULT_CALL_MODE);
  /** 智能体开关：只在服务端模式可用；local / 未登录时禁用并给出原因。 */
  const [agentOn, setAgentOn] = useState(true);
  const [teachingMode, setTeachingMode] = useState<TeachingIntent | "auto">("auto");
  const [teachingBudget, setTeachingBudget] = useState<number | null>(null);
  const [resetTeachingSession, setResetTeachingSession] = useState(false);
  const [restoredTask, setRestoredTask] = useState<{ owner: string; targetId: string; workflow: WorkflowSnapshot; assessment: AssessmentResult | null; turns: { question:string; answer:string }[] } | null>(null);
  const ownerId = user?.id ?? null;
  const [legacyOpen,setLegacyOpen] = useState(false);
  const [copied,setCopied] = useState<string | null>(null);
  const [previewImage,setPreviewImage] = useState<(AttachedImage & { owner:string | null }) | null>(null);
  useEffect(() => {
    if (!ownerId || !legacyOpen) return;
    const controller = new AbortController();
    void fetch(`/api/agent/session?targetId=${encodeURIComponent(targetId)}&legacy=1`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const raw = await response.json() as { workflow?: unknown; assessment?: unknown; turns?: {question:string;answer:string}[] };
        const parsed = workflowSnapshot.safeParse(raw.workflow);
        if (!parsed.success || controller.signal.aborted) return;
        const grade = assessmentResult.safeParse(raw.assessment);
        setRestoredTask({ owner: ownerId, targetId, workflow: parsed.data, assessment: grade.success ? grade.data : null,turns:raw.turns ?? [] });
      }).catch(() => undefined);
    return () => controller.abort();
  }, [ownerId, targetId, legacyOpen]);
  const prepareFollowup = (intent: TeachingIntent, question: string) => {
    setTeachingMode(intent); setInput(question);
    document.getElementById("q")?.focus();
  };
  const [images, setImages] = useState<AttachedImage[]>([]);
  /** 图片发送失败后的显式恢复入口；question 是用户原本输入的文字（可能为空）。 */
  const [imageRetry, setImageRetry] = useState<{ question: string; message: string } | null>(null);
  /** 最近一次上传资料检索用没用向量、为什么降级。 */
  const [vectorStatus, setVectorStatus] = useState<VectorRetrievalStatus | null>(null);
  const [speechSupport, setSpeechSupport] = useState<SpeechSupport | null>(null);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [speechInterim, setSpeechInterim] = useState("");
  const [sourceFocus, setSourceFocus] = useState<{ request: number; kcId: string; title: string; context?: string; originals: { label: string; text: string }[] } | null>(null);
  const openCitation = (message: Message, kcId: string) => {
    setSourceFocus(previous => ({ request: (previous?.request ?? 0) + 1, kcId, title: message.citations.find(citation => citation.kcId === kcId)?.title ?? kcId, context: message.citations.some(citation => citation.kcId === kcId) && message.sources.length ? message.materialContext : undefined, originals: (message.originals ?? []).filter(item => item.kcId === kcId && message.sources.includes(item.label)) }));
  };
  const endRef = useRef<HTMLDivElement | null>(null);
  const messageViewport = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const speechRef = useRef<SpeechSession | null>(null);

  /*
   * 动效只包展示层：页面标题与两张控制卡一次性入场；每条消息在**追加**时
   * 播一次 0.3s 淡入 + 10px 上移。useStaggerIn 给节点打 data-motion-done，
   * 流式 patch 只改同一个节点的文本，因此不会重播；reduced-motion 下不建 tween。
   */
  const mainRef = useRef<HTMLElement>(null);

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

  const nextId = (): string => crypto.randomUUID();

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
    setProvider(loadProvider());
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
    // 用原始 setter 而不是 setBusy/setError 包装：这里是「切目标就重置」，
    // 不需要 isCurrent 守卫；包装函数每次渲染都变，会让本 effect 的依赖永远凑不齐。
    setBusyState(false);
    setIndex(buildIndex(docs));
    setSourceFocus(null);
    setErrorState(null);
    setImages([]);
    setImageRetry(null);
    setVectorStatus(null);
    setListening(false);
    setSpeechInterim("");
    setSpeechError(null);
  }, [target, user?.id]);

  useEffect(() => {
    abortRef.current?.abort(); speechRef.current?.abort(); setBusyState(false); setErrorState(null); setSourceFocus(null); setPreviewImage(null); setImages([]); setInput(new URLSearchParams(window.location.search).get("q")?.slice(0,4000) ?? ""); nearBottom.current = true;
  },[history.epoch]);
  useEffect(() => {
    if (history.active && history.active.targetId !== targetId) setTargetId(history.active.targetId);
  },[history.active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    /*
     * reduced-motion 下不能用 smooth：规范里 behavior:"smooth" 会绕过
     * CSS 的 scroll-behavior:auto，系统开了「减少动态效果」时仍会平滑滚动。
     */
    if (!nearBottom.current || !messageViewport.current) return;
    messageViewport.current.scrollTop = messageViewport.current.scrollHeight;
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
      patchMessage(id, () => ({
        // 通用知识模式即使中途停止，也要保留「不是来自教材」的声明
        ...(finalText !== undefined && partial.text.trim() !== "" ? { text: finalText } : {}),
        streaming: false,
        // 没有思考内容就不留空面板；有半截思考则保留，方便用户知道模型想到哪
        thinkingRequested: partial.reasoning.trim() !== "",
        note: partial.text.trim() || partial.reasoning.trim() ? "已停止生成，仅保留已输出的部分内容。" : "本轮已停止，可以继续提问或从这里新建分支。",
        verificationSkipped: "生成已停止，未发起引用核对。",
        checking: false,
      }));
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
   * 六类事件，包含教学状态 workflow；未收到 done 按失败处理。
   * 没收到 done 或 done=error 都算失败，由调用方退回普通流式问答；
   * done=budget / max_steps / loop_detected 时正文照常保留（服务端已收口）。
   */
  const streamAgentTurn = async (input: {
    readonly assistantId: string;
    readonly question: string;
    readonly images: readonly string[];
    readonly signal: AbortSignal;
    readonly conversationId?: string;
    readonly documentIds?:readonly string[];
  }): Promise<AgentStreamOutcome> => {
    const { assistantId, question, images: imageUrls, signal } = input;
    let response: Response;
    try {
      response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          ...(input.conversationId ? { conversationId:input.conversationId,assistantMessageId:assistantId } : {}),
          ...(imageUrls.length > 0 ? { images: imageUrls } : {}),
          ...(target !== null && target.kind === "subject" ? { subject: targetId } : {}),
          ...(target?.kind === "direction" ? { directionId: targetId } : {}),
          tone: loadTutorTone(),
          helpLevel,
          ...(teachingMode === "auto" ? {} : { intent: teachingMode }),
          // In auto mode, allow an explicit time in the question to drive the Supervisor.
          ...(teachingBudget === null ? {} : { budgetMinutes: teachingBudget }),
          resetSession: resetTeachingSession,
          materialSourceIds: materialSelection.sourceIds.slice(0, 20),
          documentIds:input.documentIds,
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
      if (signal.aborted || !history.isCurrent()) return;
      switch (event.type) {
        case "workflow": {
          patchMessage(assistantId, () => ({ workflow: event.workflow }));
          return;
        }
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
            workflow: event.workflow,
          };
          const summary = doneSummary;
          patchMessage(assistantId, (message) => ({
            agentDone: summary,
            workflow: event.workflow ?? message.workflow,
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
    const sendingDocuments=[...new Map([...messages.flatMap(m=>m.documents),...pendingDocuments].map(d=>[d.id,d])).values()].slice(-20);
    /*
     * 只贴图不写字也必须能发送；两者都空才早退。
     * 给模型的 question 用带图指令，保证 /api/agent 的 question 非空（契约 min 1）。
     */
    if ((typed.length === 0 && sendingImages.length === 0) || documentBusy || busy || !index || !target || history.loading || !history.writable) return;

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
    const userId = nextId();
    const assistantId = nextId();
    let conversationId: string;
    try {
      conversationId = await history.begin(archiveContent.parse({ text:typed,attachments:sendingImages,documents:sendingDocuments,images:sendingImages.length }),userId,assistantId);
    } catch (failure) {
      setError(`问题尚未发送：${messageOf(failure)}`); setBusy(false); return;
    }
    if (controller.signal.aborted || !history.isCurrent()) { await history.stop(assistantId); setBusy(false); return; }
    nearBottom.current = true;
    patchMessage(assistantId, () => ({ streaming:true,
      thinkingRequested:!wantsAgent && activeProvider !== null && thinkingEnabledFor(activeProvider),
      originals:wantsAgent ? [] : [...material.excerpts].map(([kcId,excerpt]) => ({ kcId,label:citationLabel(excerpt),text:excerpt.text })),
      images:imageUrls.length,
    }));
    setInput("");
    setImages([]);
    setDocumentDraft(null);
    setListening(false);
    setSpeechError(null);
    setSpeechInterim("");
    speechRef.current?.abort();

    try {

    /*
     * 先算本次查询向量，再触发本地向量同步：两者共用一个 Worker，
     * 反过来先同步会让整批片段的嵌入排在查询前面，首问更容易等超时。
     * 同步不等待，第一次提问时服务端可能还没有向量，下一次才会命中。
     */
    let uploads: UploadHit[] = [];
    let uploadNotice: string | null = null;
    let documentNotice:string|null=null;
    let vector: VectorRetrievalStatus = { mode: "none", reason: null };
    try {
      const retrieval = await retrieveUploadsForQuestion(searchQuery, kbChunks, controller.signal);
      uploads = [...retrieval.hits];
      const occupiedTokens=estimateTokens(typed)+messages.slice(-8).reduce((n,m)=>n+estimateTokens(m.text.slice(0,1500)),0);
      if(user && sendingDocuments.length){
        const response=await fetch("/api/documents/retrieve",{method:"POST",headers:{"content-type":"application/json"},signal:controller.signal,body:JSON.stringify({targetId,query:searchQuery,documentIds:sendingDocuments.map(d=>d.id),providerMode:activeProvider?.mode??"local",occupiedTokens,...readContextBudget(activeProvider??{})})});
        const result=await response.json();if(!response.ok)throw new Error(result.error?.message??"附件检索失败");
        uploads=result.hits;documentNotice=result.notice??null;
      }else uploads=budgetUploadHits(uploads,activeProvider??{},occupiedTokens).hits;
      vector = retrieval.status;
      uploadNotice = documentNotice??retrieval.status.reason;
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

    patchMessage(assistantId,() => ({ uploadHits:[...uploads] }));

    /*
     * 智能体优先：工具循环在服务端，/api/agent 的请求契约里没有注入网络结果的字段，
     * 所以成功后不再跑网络检索，只在 note 里说明。
     */
    const agentPlan = buildAnswerPlan({ materialHits, webHits: 0, generalAllowed: true });
    if (wantsAgent && activeProvider !== null) {
      history.serverStarted(assistantId);
      const outcome = await streamAgentTurn({
        assistantId,
        question,
        images: imageUrls,
        signal: controller.signal,
        conversationId:user ? conversationId : undefined,
        documentIds:sendingDocuments.map(d=>d.id),
      });
      if (!outcome.ok) await history.stop(assistantId).catch(() => undefined);
      else await history.serverFinished(assistantId).catch(failure => setError(messageOf(failure)));
      if (!history.isCurrent()) return;

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
        setResetTeachingSession(false);
        const uploads = [...(outcome.done?.uploads ?? [])];
        const serverMaterial = outcome.done?.materialContext ?? "";
        const agentPlan = buildAnswerPlan({ materialHits: uploads.length + (serverMaterial.trim() ? 1 : 0), webHits: 0, generalAllowed: true });
        const workflowIntent = outcome.done?.workflow?.intent;
        const reply = workflowIntent === "practice" || workflowIntent === "review_path"
          ? outcome.text : applyVisionDeclaration(outcome.text, agentPlan);
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
          hadImages ? "本轮附图随会话保存，模型仅接收当前提问的图片。" : null,
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
          materialContext: serverMaterial,
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
        workflow: null,
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
          history: resetTeachingSession ? [] : messages.filter(message => message.text.trim() && !message.streaming).slice(-8).map(message => ({ role:message.role,content:message.text })),
          maxTokens: Math.min(TUTOR_MAX_TOKENS,contextBudget(activeProvider).response),
          temperature: 0.3,
          timeoutMs: TUTOR_TIMEOUT_MS,
          thinking: contextBudget({...activeProvider,thinking:effectiveThinking(activeProvider)}).thinking,
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
    } finally {
      if (history.isCurrent()) await history.flush().catch(() => undefined);
    }
  };

  if (!ready || !learnerReady || !target) {
    return (
      <>
        <Nav />
        <main id="main" className="tutor-page tutor-editorial" aria-busy="true">
          <h1 className="sr-only">课程导师</h1>
          <div className="tutor-workspace tutor-loading" role="status" aria-label={loadingTarget ? "正在读取自定义方向" : "正在读取课程与学习记录"}>
            <aside className="conversation-sidebar" aria-hidden="true"><i /><i /><i /><i /></aside>
            <div className="tutor-stage" aria-hidden="true"><div className="tutor-conversation-heading"><i /></div><div className="tutor-loading-content"><i /><i /><i /></div><div className="tutor-loading-composer" /></div>
          </div>
        </main>
      </>
    );
  }

  const searchProvider = resolveSearchProvider(searchConfig, searchRuntime);
  /** 智能体开关为什么不能开；与 send 里的判断同源，避免两处漂移。 */
  const agentBlocked = agentDisabledReason(user !== null, activeProvider);
  const resumableTask = restoredTask?.owner === ownerId && restoredTask.targetId === targetId ? restoredTask : null;

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
      <main id="main" ref={mainRef} className="tutor-page tutor-editorial">
        <h1 className="sr-only">课程导师</h1>
        <div className="tutor-workspace">
        <ConversationSidebar items={history.conversations} activeId={history.active?.id} mode={history.mode} query={history.query} loading={history.listLoading || history.loading && !history.active} more={!!history.cursor} storage={history.storage} disabled={busy}
          onMode={history.setMode} onQuery={history.setQuery} onOpen={item => void history.open(item).catch(failure => setError(messageOf(failure)))} onNew={() => void history.newDraft().catch(failure => setError(messageOf(failure)))} onUpdate={history.update} onMore={() => void history.refresh(true)} onLegacy={user ? () => setLegacyOpen(true) : undefined} />
        <div className="tutor-stage">
        <header className="tutor-conversation-heading"><div><h2>{history.active?.title ?? "一起把问题想明白"}</h2><p>课程：{history.active?.targetName ?? target.name}</p></div></header>
        {history.active?.parentId ? <div className="conversation-origin"><GitBranch size={17} /><span>从一轮问答新建的分支</span><button type="button" disabled={busy} onClick={() => void history.open({ id:history.active!.parentId! }).catch(failure => setError(messageOf(failure)))}>查看来源</button></div> : null}
        {!history.writable && history.active ? <div className="conversation-readonly" role="status">{history.active.deletedAt ? "此会话已移入回收站。" : history.active.archived ? "此会话已归档。" : "此会话对应的课程暂不可用，历史内容仍保留。"} <button type="button" disabled={busy} onClick={() => void history.update(history.active!,{ trash:false,archived:false }).catch(() => undefined)}>恢复会话</button></div> : null}
        <TutorRail key={ownerId ?? "anonymous"} course={target.name} sourceRequest={sourceFocus?.request} sourcePanel={sourceFocus ? <section data-citation-source tabIndex={-1} aria-label="回答引用原文" className="mb-6 border-b border-[var(--accent)] pb-5">
          <h2 className="font-semibold">回答引用原文 · {sourceFocus.title}</h2>
          {sourceFocus.originals.length ? sourceFocus.originals.map((original, index) => <div key={index} className="mt-3"><p className="text-xs text-[var(--ink-faint)]">{original.label}</p><p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">{original.text}</p></div>) : sourceFocus.context ? <div className="mt-3"><p className="text-xs text-[var(--ink-faint)]">本次回答收到的课程摘录，包含本次命中的其他知识点；检索命中不等于逐条引用。</p><p className="mt-3 whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">{sourceFocus.context}</p></div> : <p className="mt-3 text-sm text-[var(--ink-soft)]">本条引用没有可展示的教材原文快照，请结合回答下方的资料与核对结果确认；知识点引用不等于原文引证。</p>}
          <Link href={`/path${targetQuery(target)}&kc=${encodeURIComponent(sourceFocus.kcId)}`} className="mt-4 inline-block text-xs text-[var(--accent)] underline">在学习路径中查看知识点</Link>
        </section> : null}>
          <MaterialReader variant="workbench" pack={materialPack} concepts={target.graph.concepts} selection={materialSelection} onAsk={(text, source) => { setInput(`请引导我理解这段原文（${source}）：${text.slice(0, 220)}`.slice(0, 500)); document.getElementById("q")?.focus(); }} />
          <div>
          <p className="text-sm font-medium">我的资料 · {kbDocs.length} 份</p>
          {kbChunks.length > 0 ? <div className="mt-4 space-y-5">
              {kbChunks.slice(0, 12).map((chunk) => <div key={chunk.id}>
                <h3 className="text-sm font-medium">{chunk.title}{chunk.pageFrom ? ` · 第 ${chunk.pageFrom} 页` : ""}</h3>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[var(--ink-soft)]">{chunk.text}</p>
                <button type="button" data-material-ask onClick={() => setInput(`请引导我理解《${chunk.title}》这一段：${chunk.text.slice(0, 160)}`.slice(0, 500))} className="mt-1 text-xs text-[var(--accent)] underline">围绕这段提问</button>
              </div>)}
            </div> : <p className="mt-4 text-sm leading-relaxed text-[var(--ink-faint)]">还没有上传资料。可以在「我的方向」中添加课程教材与讲义，提问时会检索其中的原文。</p>}
          <Link href="/directions?kb=open" className="mt-5 inline-flex items-center gap-2 text-sm text-[var(--accent)] underline">管理与上传资料<Icon name="arrow" size={16} /></Link>
          </div>
        <div>
        {/* 目标切换 */}
        <Card className="mb-4" motion="target">
          <p className="mb-2 text-sm font-medium">当前学习目标</p>
          <TargetPicker current={targetId} onChange={id => { void history.newDraft().then(() => setTargetId(id)).catch(failure => setError(messageOf(failure))); }} />
          {target ? (
            <p className="mt-2 text-xs text-[var(--ink-faint)]">{targetCaption(target)}</p>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-[var(--ink-faint)]">
            {kb.loading
              ? "正在读取本地上传资料…"
              : kb.error !== null
                ? `上传资料读取失败：${kb.error}`
                : kbDocs.length > 0
                  ? `本方向已上传 ${kbDocs.length} 份资料（${kbChunks.length} 段），回答会检索这些片段。${user ? "资料按账号同步，同步状态在资料管理中查看。" : "匿名资料保存在本浏览器。"}`
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
              智能体（教学工作流）
            </label>
            <span
              className={
                agentBlocked === null ? "text-[var(--ink-faint)]" : "text-[var(--warn)]"
              }
            >
              {agentBlocked === null
                ? "按学习意图组织路径、辅导与练习，保存教学检查点；失败时给出提示。"
                : agentBlocked}
            </span>
          </div>
        </Card>

        </div>
        </TutorRail>
        <section className="tutor-chat" aria-label="学习辅导对话">
        <h2 className="sr-only">向课程导师提问</h2>
        {agentOn && agentBlocked === null ? <details className="tutor-task-controls"><summary>教学任务与学习时间</summary><div className="flex flex-wrap items-center gap-3 py-3 text-xs">
          <label>教学任务 <select aria-label="教学任务类型" value={teachingMode} onChange={event => setTeachingMode(event.target.value as TeachingIntent | "auto")} disabled={busy} className="ml-1 rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5"><option value="auto">自动识别</option>{Object.entries(INTENT_LABELS).map(([intent, label]) => <option key={intent} value={intent}>{label}</option>)}</select></label>
          <label>学习时间 <select aria-label="教学学习时间" value={teachingBudget ?? ""} onChange={event => setTeachingBudget(event.target.value === "" ? null : Number(event.target.value))} disabled={busy} className="ml-1 rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5"><option value="">按问题或上次预算</option>{[15, 30, 60, 90, 120].map(n => <option key={n} value={n}>{n} 分钟</option>)}</select></label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={resetTeachingSession} onChange={event => setResetTeachingSession(event.target.checked)} disabled={busy} />新任务，不衔接前文</label>
        </div></details> : null}
        {/* 对话区 */}
        <div ref={messageViewport} onScroll={event => { const el = event.currentTarget; nearBottom.current = el.scrollHeight-el.scrollTop-el.clientHeight < 160; }} className={`tutor-messages space-y-4 ${messages.length === 0 ? "is-empty" : ""}`} role="log" aria-label="辅导消息" aria-live="polite" aria-relevant="additions" aria-busy={history.loading}>
          {history.before ? <button type="button" className="conversation-earlier" disabled={history.loading} onClick={() => {
            const viewport = messageViewport.current, oldHeight = viewport?.scrollHeight ?? 0, oldTop = viewport?.scrollTop ?? 0; nearBottom.current = false;
            void history.loadEarlier().then(() => requestAnimationFrame(() => { if (viewport) viewport.scrollTop = oldTop + viewport.scrollHeight-oldHeight; }));
          }}><History size={16} />{history.loading ? "正在读取…" : "加载更早的问答"}</button> : null}
          {history.loading && !messages.length ? <div className="tutor-history-skeleton" aria-label="正在读取完整会话"><i /><i /><i /></div> : null}
          {messages.length === 0 && !history.loading ? (
            <div data-motion="suggestions" className="tutor-empty">
              <GraduationCap size={38} className="text-[var(--accent)]" />
              <h3 className="mt-5 text-lg font-medium">从你卡住的地方开始</h3>
              <p className="mt-2 text-sm text-[var(--ink-faint)]">一个概念、一段原文，或一道还没想明白的题。</p>
              <div className="tutor-suggestions">
                {[
                  "为什么给我排这一步？",
                  `${target?.graph.concepts[0]?.name ?? ""}是什么`,
                  `${target?.graph.concepts[1]?.name ?? ""}的重点是什么`,
                  "结合我的作答记录，建议接下来学什么？",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => { setInput(suggestion); document.getElementById("q")?.focus(); }}
                    className="tutor-suggestion"
                  >
                    {suggestion}<Icon name="chevron" size={15} className="shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) =>
            message.role === "user" ? (
              <Card
                key={message.id}
                motion="message"
                className="tutor-user-message"
              >
                <div className="text-sm leading-[1.75]">
                  {message.text !== "" ? <MiniMarkdown text={message.text} /> : "（图片提问）"}
                </div>
                {message.documents.length ? <ul className="mt-2 flex flex-wrap gap-2" aria-label="本轮文档附件">{message.documents.map(doc=><li key={doc.id} className="max-w-full break-all rounded border border-[var(--line)] px-3 py-2 text-xs">📄 {doc.name} · {doc.pageCount?`${doc.pageCount} 页`:"文本资料"}{doc.ocrPages?` · OCR ${doc.ocrPages} 页`:""}<span className="block text-[var(--ink-soft)]">已保存至课程资料 · 回答可核对引用</span></li>)}</ul>:null}
                {message.images > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 用户上传的 data: URL，next/image 无法优化
                  <div className="tutor-saved-images">{message.attachments.map(attachment => <button type="button" key={attachment.id} onClick={() => setPreviewImage({ ...attachment,owner:ownerId })} aria-label={`查看问题图片：${attachment.name}`}><img src={attachment.dataUrl} alt={attachment.name} width={attachment.width} height={attachment.height} /></button>)}<p>{message.attachments.length ? `附 ${message.attachments.length} 张问题图片 · 已随会话保存` : `附 ${message.images} 张图片，旧记录未保存原图`}</p></div>
                ) : null}
              </Card>
            ) : (
              <article
                key={message.id}
                data-motion="message"
                className="tutor-assistant-message"
              >
                <div className="tutor-speaker"><GraduationCap size={20} /><span>课程导师</span></div>
                <ThinkingPanel
                  reasoning={message.reasoning}
                  textStarted={message.text.trim() !== ""}
                  streaming={message.streaming}
                  enabled={message.thinkingRequested}
                />
                {!message.streaming && history.record(message.id)?.state === "pending" ? <div className="conversation-pending"><p>此轮尚未完成，可能仍在另一窗口生成。</p><button type="button" disabled={busy} onClick={() => void history.serverFinished(message.id).catch(failure => setError(messageOf(failure)))}><RefreshCw size={15} />刷新记录</button><button type="button" disabled={busy} onClick={() => void history.stop(message.id).catch(failure => setError(messageOf(failure)))}>停止这轮</button></div> : null}

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
                <AnswerBody text={message.text} streaming={message.streaming} onCitation={kcId => openCitation(message, kcId)} />
              ) : message.streaming ? (
                <div className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
                  <Icon name="book" size={17} />
                  {message.reasoning !== ""
                    ? "模型仍在思考，正文尚未开始…"
                    : `正在检索课程知识库${webOn ? "与网络" : ""}并生成回答…`}
                </div>
              ) : null}

              {message.workflow && target ? <TeachingTaskCard key={`${history.active?.id}-${message.workflow.runId}`} workflow={message.workflow} query={targetQuery(target)} initialAssessment={message.assessment} conversationId={user ? history.active?.id : undefined} messageId={message.id} inherited={!!history.record(message.id)?.inheritedFrom} disabled={busy || !history.writable || message.workflow.targetId !== targetId} onFollowup={prepareFollowup} onAssessed={result => {
                patchMessage(message.id,() => ({ assessment:result,workflow:result.workflow })); void history.serverFinished(message.id).catch(failure => setError(messageOf(failure))); void refreshProgress().catch(() => undefined);
              }} /> : null}
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
                    工具预览已随本轮会话保存。
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
                            <button type="button" onClick={() => openCitation(message, citation.kcId)} title={`查看「${citation.title}」引用原文`} className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent)] underline-offset-2 hover:underline">
                              {citation.title} [{citation.kcId}]
                            </button>
                            {badge !== null ? (
                              <Pill tone={badge.tone}>{badge.label}</Pill>
                            ) : null}
                          </span>
                        );
                      })}
                    </div>
                  ) : null}

                  {message.sources.length > 0 ? (
                    <details className="tutor-evidence-details">
                      <summary>教材与讲义出处</summary>
                      <p className="text-xs leading-relaxed text-[var(--ink-soft)]">
                        出处：{message.sources.join("；")}
                      </p>
                      <p className="text-xs leading-relaxed text-[var(--ink-faint)]">
                        {MATERIAL_BASIS_NOTE}
                      </p>
                    </details>
                  ) : null}

                  {message.uploadHits.length > 0 ? (
                    <details className="tutor-evidence-details"><summary>上传资料 · 引用 {message.uploadUsed.length} 处</summary><div className="pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-medium text-[var(--ink-soft)]">
                          本轮上传资料快照
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
                    </div></details>
                  ) : null}

                  <WebEvidence
                    hits={message.webHits}
                    used={message.webUsed}
                    error={message.webError}
                    notice={message.webNotice}
                    fromCache={message.webFromCache}
                  />

                  {message.claims.length > 0 ? <details className="tutor-evidence-details"><summary>{message.checking ? "引用核对中…" : message.verdicts ? "查看引用核对结果" : "引用核对详情"}</summary><div className="pt-3"><AnswerVerification
                    claims={message.claims}
                    verdicts={message.verdicts}
                    checking={message.checking}
                    error={message.verificationError}
                    skippedReason={message.verificationSkipped}
                  /></div></details> : null}

                  {message.note !== undefined && message.note !== "" ? (
                    <details className="text-xs text-[var(--ink-faint)]"><summary className="cursor-pointer">回答方式与运行详情</summary><p className="mt-2 leading-relaxed">{message.note}</p></details>
                  ) : null}

                  {message.text.trim() !== "" ? (
                    <ReadAloud id={message.id} text={message.text} disabled={message.streaming} />
                  ) : null}
                </div>
              ) : null}
              {!message.streaming ? <div className="tutor-message-actions">
                {message.text ? <button type="button" onClick={() => { void navigator.clipboard.writeText(message.text).then(() => setCopied(message.id)).catch(() => setError("复制失败，请手动选择文本复制。")); }}>{copied === message.id ? <Check size={16} /> : <Copy size={16} />}{copied === message.id ? "已复制" : "复制"}</button> : null}
                <button type="button" disabled={busy || history.record(message.id)?.state === "pending" || !history.active || !!history.active.deletedAt} onClick={() => void history.branch(message.id).catch(failure => setError(messageOf(failure)))}><GitBranch size={16} />从这里分支</button>
                {history.record(message.id)?.inheritedFrom ? <span>继承自原会话</span> : null}
              </div> : null}
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

        <div className="tutor-composer" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <fieldset className="mb-3"><legend className="sr-only">希望学伴怎样帮你？</legend><div className="segmented max-w-sm">
          {([ ["hint", "1 · 给我提示"], ["steps", "2 · 引导步骤"], ["explain", "3 · 完整讲解"] ] as const).map(([level, label]) => <button type="button" key={level} disabled={busy} aria-pressed={helpLevel === level} onClick={() => setHelpLevel(level)}>{label}</button>)}
        </div></fieldset>
        {/* 状态行：附件 / 听写 / 联网 / 语音错误，只在有内容时出现 */}
        {pendingDocuments.length?<ul className="mb-2 flex flex-wrap gap-2" aria-label="待发送文档">{pendingDocuments.map(doc=><li key={doc.id} className="max-w-full break-all rounded border border-[var(--line)] px-2 py-1 text-xs">📄 {doc.name}<button type="button" aria-label={`移除附件 ${doc.name}`} className="ml-2" onClick={()=>setDocumentDraft({scope:documentScope,items:pendingDocuments.filter(d=>d.id!==doc.id)})}>×</button></li>)}</ul>:null}
        {documentBusy?<p role="status" className="mb-2 text-xs">文档处理中，完成后即可提问。重复文件会复用索引。</p>:null}
        {attachNotice !== null ? (
          <p className="mb-1.5 text-xs text-[var(--ink-soft)]">{attachNotice}</p>
        ) : null}
        {webOn && searchProvider.notice !== null ? (
          <p className="mb-1.5 text-xs text-[var(--warn)]">{searchProvider.notice}</p>
        ) : null}
        {speechError !== null ? (
          <p className="mb-1.5 text-xs text-[var(--warn)]">{speechError}</p>
        ) : null}
        {listening ? (
          <p className="mb-1.5 text-xs text-[var(--accent)]">
            正在听…{speechInterim !== "" ? `「${speechInterim}」` : ""}
          </p>
        ) : null}

        {/* 图片附件托盘：保持挂载，window 粘贴监听常驻，隐藏时也能直接贴图 */}
        <div className={images.length > 0 ? "mb-2" : "hidden"}>
          <ImageInput images={images} onChange={setImages} disabled={busy} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="q" className="sr-only">
            输入你的问题
          </label>
          <textarea
            id="q"
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={4000}
            placeholder="写下你卡住的地方…"
            onKeyDown={event => {
              // 中文输入法组合期间的 Enter 是「确认候选词」，必须放行不发送
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (busy || history.loading || !history.writable) return;
                if (input.trim().length === 0 && images.length === 0) return;
                void send(input);
                return;
              }
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                if (busy || history.loading || !history.writable) return;
                if (input.trim().length === 0 && images.length === 0) return;
                void send(input);
              }
            }}
            className="min-w-0 resize-y rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          {/* 左下角：📎 附件 / 🎤 语音 / 🌐 联网；右下角：快捷键提示 + 发送 */}
          <div className="flex items-center gap-2">
          <input
            ref={attachInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.markdown,.pdf"
            className="hidden"
            onChange={(event) => { onAttachFiles(event.target.files); event.target.value = ""; }}
          />
          <button
            type="button"
            onClick={() => attachInputRef.current?.click()}
            disabled={busy || documentBusy || authLoading || history.loading}
            aria-label="上传图片或文档"
            title="图片随消息发送；PDF、TXT 和 Markdown 在服务端解析后检索引用"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)] disabled:opacity-40"
          >
            <Paperclip size={17} />
          </button>
          <button
            type="button"
            onClick={() => void toggleSpeech()}
            disabled={busy || !speechSupport?.ok}
            aria-pressed={listening}
            title={speechSupport !== null && speechSupport.ok ? "语音只填空，不自动发送" : speechSupport?.message ?? "语音输入"}
            className={
              listening
                ? "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--accent)] text-[var(--accent)]"
                : "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)] disabled:opacity-40"
            }
          >
            <Mic size={17} />
          </button>
          <span className="inline-flex items-center gap-2 text-[11px] text-[var(--ink-soft)]">
            <Globe size={15} />
            <span>联网模式</span>
            <button
              type="button"
              role="switch"
              aria-checked={webOn}
              aria-label="联网模式（外部网页，未核对）"
              disabled={busy}
              onClick={() => setWebOn(value => !value)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${webOn ? "bg-[var(--accent)]" : "bg-[var(--line-strong)]"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${webOn ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
            <span className="text-[var(--ink-faint)]">当前：{webProviderLabel(searchProvider.provider)} · 搜索失败不阻塞回答</span>
            <Link href="/settings?panel=search" className="underline" title="联网搜索设置：供应商、默认开与关、测试">搜索设置</Link>
          </span>
          <span className="ml-auto text-[11px] text-[var(--ink-faint)]">Enter 发送 · Shift+Enter 换行</span>
            {busy ? (
              <button
                type="button"
                onClick={() => { abortRef.current?.abort(); void history.stop().catch(failure => setError(messageOf(failure))); }}
                className="rounded-lg border border-[var(--bad)] px-4 py-2 text-sm font-medium text-[var(--bad)] hover:bg-[var(--bad-soft)]"
              >
                停止
              </button>
            ) : (
              <button
                type="submit"
                disabled={documentBusy || history.loading || !history.writable || input.trim().length === 0 && images.length === 0}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:opacity-40"
              >
                发送
              </button>
            )}
          </div>
        </form>
        <div className="tutor-save-status" role="status">{history.saveState === "error" ? <><span>有内容尚未保存</span><button type="button" onClick={() => void history.flush().catch(() => undefined)}>重试保存</button></> : history.saveState === "saving" ? "正在保存会话…" : <><Check size={15} />{history.active ? "会话已保存" : "新会话"}</>}</div>
        {history.error ? <div className="conversation-save-error" role="alert"><p>{history.error}</p><button type="button" onClick={() => void history.flush().catch(() => undefined)}>重试保存</button></div> : null}
        </div>
        </section>
        </div>
        </div>
      </main>
      <AppDialog open={!!previewImage && previewImage.owner === ownerId} onOpenChange={open => { if (!open) setPreviewImage(null); }} title={previewImage?.name ?? "问题图片"} description="本轮提问保存的图片。">
        {previewImage && previewImage.owner === ownerId ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL 原图预览，next/image 无法优化
          <img src={previewImage.dataUrl} alt={previewImage.name} width={previewImage.width} height={previewImage.height} className="mx-auto max-h-[65dvh] w-auto max-w-full object-contain" />
        ) : null}
      </AppDialog>
      <AppDialog open={legacyOpen} onOpenChange={setLegacyOpen} title="旧版教学记录" description="旧版只保存最近四轮短文本和最后一个任务；更早的问答、引用原文及图片未被保存。新会话会完整存档。">
        {resumableTask ? <div><div className="space-y-5">{resumableTask.turns.map((turn,index) => <div key={index}><p className="text-sm font-medium whitespace-pre-wrap">{turn.question}</p><p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-[var(--ink-soft)]">{turn.answer}</p></div>)}</div><TeachingTaskCard key={`legacy-${ownerId}-${resumableTask.workflow.runId}`} workflow={resumableTask.workflow} query={targetQuery(target)} initialAssessment={resumableTask.assessment} disabled={busy} onFollowup={(intent,question) => { prepareFollowup(intent,question); setLegacyOpen(false); }} onAssessed={() => { void refreshProgress().catch(() => undefined); }} /></div> : <p className="text-sm text-[var(--ink-soft)]">当前课程没有可恢复的旧版教学任务。</p>}
      </AppDialog>
    </>
  );
}
