/**
 * /api/agent 的 HTTP 契约与运行参数。
 *
 * 契约冻结在阶段 1（apiContracts.ts 只允许那一阶段改），所以 Agent 的请求体、
 * 事件与运行上限写在这里；路由与前端都只 import 本文件。
 *
 * 两个原则：
 * - **上限从宽、可覆盖**：默认值不是产品限制，而是「跑飞保护」。MAX_STEPS=8、
 *   每步 5 个并行工具、单工具 20s、单结果 4000 字符、全会话 180s 全部可以由
 *   ALP_AGENT_* 环境变量调整；代码里不出现「4 步」这类写死的产品口径。
 * - **事件只有五类**：text / tool_call / tool_result / notice / done。done 一定发，
 *   且只发一次——前端据此结束 loading，任何一条路径漏掉 done 都会让界面永远转圈。
 */

import { z } from "zod";

import { SUBJECTS } from "@/data/subjects";

// ── 请求契约 ──────────────────────────────────────────────────────

/** 3 张图（每张 ≤800k 字符的 data URI）+ 4000 字问题，4MB 足够且挡住整包上传。 */
export const AGENT_REQUEST_MAX_BYTES = 4 * 1024 * 1024;

export const AGENT_QUESTION_MAX_CHARS = 4000;
export const AGENT_IMAGE_MAX_CHARS = 800_000;
export const AGENT_MAX_IMAGES = 3;

/**
 * 图片只接受 data:image/(jpeg|png|webp|gif);base64。
 *
 * 与 apiContracts 的 DATA_IMAGE_URL 同义（那里是私有常量）：放行 http(s) URL
 * 会让上游替我们抓取任意地址，等于把服务端变成可被提示词触发的 SSRF 跳板。
 */
const DATA_IMAGE_URL = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/u;

const SUBJECT_IDS = SUBJECTS.map((s) => s.id) as [string, ...string[]];

/**
 * 客户端只发这四项。
 *
 * 刻意没有 baseUrl / apiKey / model / mode：模型配置一律来自账号保存的 llm 配置，
 * 「local 模式」由服务端根据配置是否存在判定，客户端不能自报模式绕过。
 */
export const agentRequest = z.strictObject({
  question: z.string().trim().min(1).max(AGENT_QUESTION_MAX_CHARS),
  images: z
    .array(z.string().max(AGENT_IMAGE_MAX_CHARS).regex(DATA_IMAGE_URL, "图片只接受 data:image/*;base64"))
    .max(AGENT_MAX_IMAGES)
    .optional(),
  subject: z.enum(SUBJECT_IDS).optional(),
  /** 用户本次可投入的学习时间，用于 plan_path 的预算；不是服务端的运行时限。 */
  budgetMinutes: z.number().int().min(5).max(480).optional(),
});

export type AgentRequest = z.infer<typeof agentRequest>;

// ── 运行参数 ──────────────────────────────────────────────────────

export const AGENT_LIMIT_ENV = {
  maxSteps: "ALP_AGENT_MAX_STEPS",
  maxParallelTools: "ALP_AGENT_MAX_PARALLEL_TOOLS",
  toolTimeoutMs: "ALP_AGENT_TOOL_TIMEOUT_MS",
  maxResultChars: "ALP_AGENT_MAX_RESULT_CHARS",
  sessionBudgetMs: "ALP_AGENT_BUDGET_MS",
  modelTimeoutMs: "ALP_AGENT_MODEL_TIMEOUT_MS",
} as const;

export interface AgentLimits {
  /** 模型轮数上限（含最后的收口轮之外的工具轮）。 */
  readonly maxSteps: number;
  /** 同一轮里最多并行执行的工具数。 */
  readonly maxParallelTools: number;
  /** 单个工具的超时。 */
  readonly toolTimeoutMs: number;
  /** 单条工具结果回灌给模型的字符上限。 */
  readonly maxResultChars: number;
  /** 整个 run 的时间预算。 */
  readonly sessionBudgetMs: number;
  /** 单次模型调用的超时（仍会再被剩余会话预算压小）。 */
  readonly modelTimeoutMs: number;
}

/**
 * 默认值 = 跑飞保护，不是产品限制。
 *
 * 8 步 × 5 并行工具足以覆盖「列学科 → 排路径 → 查先修 → 复述」，但任何一步
 * 卡住或模型开始绕圈，都会在 180s 内被收口。
 */
export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxSteps: 8,
  maxParallelTools: 5,
  toolTimeoutMs: 20_000,
  maxResultChars: 4_000,
  sessionBudgetMs: 180_000,
  modelTimeoutMs: 60_000,
};

export type AgentEnv = Record<string, string | undefined>;

function intFromEnv(
  env: AgentEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = (env[key] ?? "").trim();
  if (raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

/**
 * 读取并夹紧 ALP_AGENT_*。
 *
 * 非法值回落到默认而不是抛错：这些变量的用途是「运维调参」，一个拼错的环境
 * 变量不应该让整条 Agent 路由 500。上界存在的意义是防止把 maxSteps 配成 10000
 * 后一次请求烧掉整月额度。
 */
export function parseAgentLimits(env: AgentEnv = process.env): AgentLimits {
  return {
    maxSteps: intFromEnv(env, AGENT_LIMIT_ENV.maxSteps, DEFAULT_AGENT_LIMITS.maxSteps, 1, 32),
    maxParallelTools: intFromEnv(
      env,
      AGENT_LIMIT_ENV.maxParallelTools,
      DEFAULT_AGENT_LIMITS.maxParallelTools,
      1,
      10,
    ),
    toolTimeoutMs: intFromEnv(
      env,
      AGENT_LIMIT_ENV.toolTimeoutMs,
      DEFAULT_AGENT_LIMITS.toolTimeoutMs,
      1_000,
      120_000,
    ),
    maxResultChars: intFromEnv(
      env,
      AGENT_LIMIT_ENV.maxResultChars,
      DEFAULT_AGENT_LIMITS.maxResultChars,
      200,
      20_000,
    ),
    sessionBudgetMs: intFromEnv(
      env,
      AGENT_LIMIT_ENV.sessionBudgetMs,
      DEFAULT_AGENT_LIMITS.sessionBudgetMs,
      5_000,
      900_000,
    ),
    modelTimeoutMs: intFromEnv(
      env,
      AGENT_LIMIT_ENV.modelTimeoutMs,
      DEFAULT_AGENT_LIMITS.modelTimeoutMs,
      5_000,
      300_000,
    ),
  };
}

// ── 事件 ──────────────────────────────────────────────────────────

export type AgentStopReason =
  | "stop"
  | "max_steps"
  | "loop_detected"
  | "budget"
  | "aborted"
  | "error";

/** 轨迹里只回 preview；完整工具结果不回传浏览器（减少泄露面）。 */
export const AGENT_PREVIEW_CHARS = 300;

export interface AgentTextEvent {
  readonly type: "text";
  readonly text: string;
}

export interface AgentToolCallEvent {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  /** 本地工具为 null；远程 MCP 工具为服务器 id。 */
  readonly serverId: string | null;
  readonly argsPreview: string;
}

export interface AgentToolResultEvent {
  readonly type: "tool_result";
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly truncated: boolean;
  readonly durationMs: number;
  readonly preview: string;
}

export interface AgentNoticeEvent {
  readonly type: "notice";
  readonly level: "info" | "warn";
  readonly message: string;
}

export interface AgentDoneEvent {
  readonly type: "done";
  readonly stopReason: AgentStopReason;
  /** 实际发生的模型轮数（收口轮也算）；预算/中止在调用前就停时可为 0。 */
  readonly steps: number;
  readonly toolCalls: number;
  readonly elapsedMs: number;
  readonly textChars: number;
}

export type AgentEvent =
  | AgentTextEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentNoticeEvent
  | AgentDoneEvent;

/** 截断到预览长度；换行压成空格，避免把预览撑成多行日志。 */
export function previewOf(text: string, maxChars: number = AGENT_PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, maxChars)}…`;
}

/** 一条 SSE 消息。data 只有一个 JSON 对象，前端按 event.type 分派。 */
export function agentEventToSse(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
