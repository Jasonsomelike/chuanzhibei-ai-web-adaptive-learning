/**
 * 模型调用的统一客户端。
 *
 * 一条代码路径服务两种运行模式（provider.ts 的 ProviderConfig.mode）：
 * - local：浏览器直连用户填的 baseURL，key 只在 localStorage；
 * - server：请求发往本项目的 /api/llm/chat，由服务端用加密保存的 key 代发，
 *   请求体里不出现 baseUrl / apiKey / model（契约见 apiContracts.llmChat）。
 *
 * 为什么统一：方向页与导师页原先各有一份几乎相同的 callProvider，
 * 两份都在处理「OpenAI 兼容 vs Anthropic」「超时」「空返回」，
 * 任何一处漏改都会让某条路径的行为和另一条不一致。
 *
 * 非流式与流式共用同一套响应解析（extractNonStreamingText /
 * extractNonStreamingReasoning / createSseDecoder / parseStreamPayload），
 * 差别只在响应怎么读：结构化 JSON 调用必须走 callChat，
 * 否则半截 JSON 会打穿 extractJson 与 callChatWithRepair。
 */

import {
  buildChatBody,
  buildProviderHeaders,
  effectiveProviderMode,
  type ChatBodyRequest,
  type ProviderConfig,
  type ThinkingStatus,
} from "@/lib/provider";
import {
  createSseDecoder,
  extractNonStreamingReasoning,
  extractNonStreamingText,
  parseStreamPayload,
  type ChatUsage,
  type SseEvent,
  type ThinkingStrength,
} from "@/lib/reasoning";
import { classifyThinkingRejection } from "@/lib/thinking";

export interface ChatRequest extends ChatBodyRequest {
  /**
   * 显式指定的思考档。callChat 只认这一项，不读 provider.thinking——
   * 出题/批解一旦被配置里的档位带成思考模式，JSON 会被思考 token 吃光。
   */
  readonly thinking?: ThinkingStrength;
  /**
   * 探测专用：允许正文为空（只有 reasoning 也算模型确实响应了）。
   * 普通调用不能打开，否则空返回会被当成成功。
   */
  readonly allowEmptyText?: boolean;
  /** 超时毫秒数，默认 60 秒。 */
  readonly timeoutMs?: number;
  /**
   * 外部取消信号。诊断页「取消并跳过」必须能真正中断已发出的请求，
   * 否则用户以为停了，请求仍在跑、仍在计费。
   */
  readonly signal?: AbortSignal;
}

export interface ChatResult {
  readonly text: string;
  /** 推理内容。与正文分开返回，调用方各自渲染，永不拼进 text。 */
  readonly reasoning: string;
  /** 供应商报告的结束原因。length 表示被截断，调用方应判失败而不是硬解析。 */
  readonly finishReason: string | null;
  readonly usage?: ChatUsage;
}

export interface ChatStreamHandlers {
  /** 正文增量。思考内容不会从这里出现。 */
  readonly onText?: (delta: string) => void;
  /** 思考增量。正文不会从这里出现。 */
  readonly onReasoning?: (delta: string) => void;
  /** 用量更新。Anthropic 的输入/输出 token 分属两条事件，这里已合并。 */
  readonly onUsage?: (usage: ChatUsage) => void;
}

export interface ChatStreamResult {
  readonly text: string;
  readonly reasoning: string;
  readonly finishReason: string | null;
  readonly usage?: ChatUsage;
  /**
   * 端点拒绝了思考参数，本次已自动按普通模式重发。
   * 调用方应把 provider.thinkingStatus 写回 "unsupported"。
   */
  readonly thinkingDowngraded: boolean;
  /**
   * 400 的归因结论。只有 "thinking" 允许把 thinkingStatus 写成 unsupported；
   * "other" 说明 400 与思考字段无关（模型名错、上下文超长），重发也不会好，
   * 因此它只会出现在 ChatError 上，不会以成功结果返回。
   */
  readonly downgradeReason: DowngradeReason;
}

/** 400 的归因：thinking=思考字段被拒；other=其它原因；null=不是 400。 */
export type DowngradeReason = "thinking" | "other" | null;

/** 调用失败。区分「被截断」与其它错误，因为前者重试更可能成功。 */
export class ChatError extends Error {
  readonly kind: "truncated" | "empty" | "http" | "timeout" | "network" | "aborted";
  /** HTTP 状态码；只有 kind === "http" 时才有值。 */
  readonly status?: number;
  /**
   * 上游/服务端返回的原始错误体（未截断）。
   * 400 归因要靠它判断「是不是思考参数被拒」，界面只展示截断后的片段。
   */
  readonly responseBody?: string;
  /** HTTP 错误的归因；非 400 与本地错误为 null。 */
  readonly downgradeReason?: DowngradeReason;
  constructor(
    kind: ChatError["kind"],
    message: string,
    status?: number,
    responseBody?: string,
    downgradeReason?: DowngradeReason,
  ) {
    super(message);
    this.name = "ChatError";
    this.kind = kind;
    this.status = status;
    this.responseBody = responseBody;
    this.downgradeReason = downgradeReason;
  }
}

// ── 公共小工具 ────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 浏览器与 Node 的 abort 错误都带 name="AbortError"，但 DOMException 是否
 * instanceof Error 在各环境不一致；按 name 判断最稳。
 */
function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { name?: unknown }).name === "AbortError";
}

interface RequestSignal {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
}

/** 外部取消与超时任一触发都要中断请求。 */
function createRequestSignal(timeoutMs: number, external?: AbortSignal): RequestSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal;
  return { signal, cleanup: () => clearTimeout(timer) };
}

function toChatError(err: unknown, external: AbortSignal | undefined, timeoutMs: number): ChatError {
  if (err instanceof ChatError) return err;
  if (isAbortError(err)) {
    // 外部取消与超时都是 AbortError，按 signal 状态区分，避免把「用户取消」报成超时
    if (external?.aborted) return new ChatError("aborted", "请求已取消");
    return new ChatError("timeout", `请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
  }
  return new ChatError("network", err instanceof Error ? err.message : String(err));
}

/** 服务端代发端点。密钥、baseUrl、model 全部来自服务端保存的配置。 */
const SERVER_CHAT_ENDPOINT = "/api/llm/chat";

/**
 * 服务端代发的请求头只有 Content-Type。
 * 不能带 Authorization / x-api-key：服务端只认自己的密文，带上反而会泄露或干扰。
 */
const SERVER_CHAT_HEADERS: Record<string, string> = { "Content-Type": "application/json" };

function isServerProvider(provider: ProviderConfig): boolean {
  return effectiveProviderMode(provider) === "server";
}

function endpointOf(provider: ProviderConfig): string {
  if (isServerProvider(provider)) return SERVER_CHAT_ENDPOINT;
  return provider.kind === "anthropic"
    ? `${provider.baseUrl}/messages`
    : `${provider.baseUrl}/chat/completions`;
}

function headersOf(provider: ProviderConfig): Record<string, string> {
  return isServerProvider(provider) ? SERVER_CHAT_HEADERS : buildProviderHeaders(provider);
}

/**
 * /api/llm/chat 的请求体。
 *
 * 刻意不出现 baseUrl / apiKey / model：apiContracts.llmChat 是 strictObject，
 * 多一个字段就 400。jsonMode 同样没有位置——服务端按自己的配置决定结构，
 * 需要 JSON 的调用方靠提示词约束，再用 extractJson 兜底。
 * 思考档也不在请求体里：服务端读它保存的 options.thinking，客户端无法降级。
 */
function buildServerChatBody(
  provider: ProviderConfig,
  req: ChatRequest,
  stream: boolean,
): Record<string, unknown> {
  const system = req.system?.trim() ?? "";
  return {
    kind: provider.kind,
    messages: [
      ...(system !== "" ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: req.user },
    ],
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
    stream,
  };
}

interface PreparedChatBody {
  readonly body: Record<string, unknown>;
  /** 是否写入了思考字段；server 模式恒为 false（思考由服务端配置决定）。 */
  readonly thinkingFields: boolean;
}

function prepareChatBody(
  provider: ProviderConfig,
  req: ChatRequest,
  strength: ThinkingStrength,
  stream: boolean,
): PreparedChatBody {
  if (isServerProvider(provider)) {
    return { body: buildServerChatBody(provider, req, stream), thinkingFields: false };
  }
  const built = buildChatBody(provider.kind, provider, req, strength);
  return { body: { ...built.body, stream }, thinkingFields: built.thinkingFields };
}

function finishReasonOf(json: Record<string, unknown>): string | null {
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const first = asRecord(choices[0]);
  if (typeof first.finish_reason === "string" && first.finish_reason !== "") {
    return first.finish_reason;
  }
  return typeof json.stop_reason === "string" && json.stop_reason !== "" ? json.stop_reason : null;
}

/**
 * 非流式 usage。OpenAI 用 prompt/completion_tokens，Anthropic 用 input/output_tokens；
 * 两者都归一成同一个形状，界面不必按协议分支。
 */
function usageOf(json: Record<string, unknown>): ChatUsage | undefined {
  const raw = asRecord(json.usage);
  const promptTokens =
    typeof raw.prompt_tokens === "number"
      ? raw.prompt_tokens
      : typeof raw.input_tokens === "number"
        ? raw.input_tokens
        : undefined;
  const completionTokens =
    typeof raw.completion_tokens === "number"
      ? raw.completion_tokens
      : typeof raw.output_tokens === "number"
        ? raw.output_tokens
        : undefined;
  const totalTokens =
    typeof raw.total_tokens === "number"
      ? raw.total_tokens
      : promptTokens !== undefined && completionTokens !== undefined
        ? promptTokens + completionTokens
        : undefined;

  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

/** 流式 usage 增量合并：Anthropic 的输入在 message_start、输出在 message_delta。 */
function mergeUsage(previous: ChatUsage | undefined, next: ChatUsage): ChatUsage {
  const promptTokens = next.promptTokens ?? previous?.promptTokens;
  const completionTokens = next.completionTokens ?? previous?.completionTokens;
  const totalTokens =
    next.totalTokens ??
    previous?.totalTokens ??
    (promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined);

  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

// ── 非流式 ────────────────────────────────────────────────────────

export async function callChat(
  provider: ProviderConfig,
  req: ChatRequest,
): Promise<ChatResult> {
  // 只认请求里的档位：配置里的 thinking 留给 callChatStream（导师问答）。
  const prepared = prepareChatBody(provider, req, req.thinking ?? "off", false);
  const timeoutMs = req.timeoutMs ?? 60000;
  const { signal, cleanup } = createRequestSignal(timeoutMs, req.signal);

  try {
    const res = await fetch(endpointOf(provider), {
      method: "POST",
      headers: headersOf(provider),
      body: JSON.stringify(prepared.body),
      signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ChatError(
        "http",
        `HTTP ${res.status}${body ? ` · ${body.slice(0, 120)}` : ""}`,
        res.status,
        body,
        res.status === 400 ? classifyThinkingRejection(res.status, body) : null,
      );
    }

    const json = asRecord((await res.json()) as unknown);
    const text = extractNonStreamingText(provider.kind, json);
    const reasoning = extractNonStreamingReasoning(provider.kind, json);
    const finishReason = finishReasonOf(json);
    const usage = usageOf(json);

    /*
     * 截断的 JSON 不能硬解析：parse 失败后的重试比「解析出半截对象」安全得多。
     * 探测请求例外——思考 token 吃满预算但 reasoning 非空，恰好证明端点支持思考字段。
     */
    if (finishReason === "length" || finishReason === "max_tokens") {
      if (!req.allowEmptyText || reasoning.trim() === "") {
        throw new ChatError("truncated", "模型输出被截断（达到 max_tokens），请重试或换更短的批次");
      }
    }
    if (!text.trim() && !req.allowEmptyText) throw new ChatError("empty", "模型返回空内容");

    return {
      text: text.trim(),
      reasoning: reasoning.trim(),
      finishReason,
      ...(usage !== undefined ? { usage } : {}),
    };
  } catch (err) {
    throw toChatError(err, req.signal, timeoutMs);
  } finally {
    cleanup();
  }
}

// ── 流式 ──────────────────────────────────────────────────────────

/** 流内 error 事件不产出增量，必须显式识别，否则会被当成「正常但没内容」。 */
function streamErrorMessage(event: SseEvent): string | null {
  const data = event.data.trim();
  if (data === "" || data === "[DONE]") return null;
  try {
    const record = asRecord(JSON.parse(data) as unknown);
    /*
     * 两种形状都要认：Anthropic 是 {type:"error", error:{...}}，
     * OpenAI 兼容端点常见的是裸 {error:{...}}（没有顶层 type）。
     * 只认前者会把上游报错当成「正常但没内容」，半截回答被当成完整回答渲染。
     */
    const bareError = record.type === undefined && record.error !== undefined;
    if (record.type !== "error" && !bareError) return null;
    const message =
      typeof record.error === "string" ? record.error : asRecord(record.error).message;
    return typeof message === "string" && message !== ""
      ? message
      : "供应商在流式响应中返回了 error 事件";
  } catch {
    return null;
  }
}

interface StreamBodyResult {
  readonly text: string;
  readonly reasoning: string;
  readonly finishReason: string | null;
  readonly usage?: ChatUsage;
}

async function readStream(
  kind: ProviderConfig["kind"],
  res: Response,
  handlers: ChatStreamHandlers,
  signal: AbortSignal,
): Promise<StreamBodyResult> {
  const body = res.body;
  if (body === null) throw new ChatError("empty", "供应商没有返回流式响应体");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = createSseDecoder();

  let text = "";
  let reasoning = "";
  let finishReason: string | null = null;
  /*
   * 是否见过结束标记（[DONE] 或 finish_reason）。上游/代理干净地提前关闭连接时，
   * read() 只会返回 done，拿不到任何错误——不记这个标记就会把半截回答当完整回答。
   */
  let sawTerminator = false;
  let usage: ChatUsage | undefined;
  let finished = false;

  /*
   * 只靠 fetch 的 signal 不够：测试与部分兼容实现返回的 ReadableStream
   * 不会随 signal 自行报错，read() 会一直挂着。这里把 read 与 abort 竞速，
   * 保证「停止」按钮在任何实现下都能立刻返回。
   */
  let removeAbortListener = (): void => {};
  const abortPromise = new Promise<never>((_, reject) => {
    const fail = (): void => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", fail);
  });

  const handleEvent = (event: SseEvent): void => {
    const failure = streamErrorMessage(event);
    if (failure !== null) throw new ChatError("network", `流式响应中断：${failure}`);

    // [DONE] 是协议的结束标记，本身没有增量内容
    if (event.data.trim() === "[DONE]") sawTerminator = true;

    const delta = parseStreamPayload(kind, event);
    if (delta === null) return;

    if (delta.text !== "") {
      text += delta.text;
      handlers.onText?.(delta.text);
    }
    if (delta.reasoning !== "") {
      reasoning += delta.reasoning;
      handlers.onReasoning?.(delta.reasoning);
    }
    if (delta.finishReason !== null) {
      finishReason = delta.finishReason;
      sawTerminator = true;
    }
    if (delta.usage !== undefined) {
      usage = mergeUsage(usage, delta.usage);
      handlers.onUsage?.(usage);
    }
  };

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (done) {
        finished = true;
        break;
      }
      if (value !== undefined) {
        for (const event of sse.push(decoder.decode(value, { stream: true }))) {
          handleEvent(event);
        }
      }
    }

    const tail = decoder.decode();
    if (tail !== "") {
      for (const event of sse.push(tail)) handleEvent(event);
    }
    for (const event of sse.flush()) handleEvent(event);
  } finally {
    removeAbortListener();
    if (!finished) await reader.cancel().catch(() => {});
  }

  // 只有思考、没有正文不算空：供应商可能把预算全用在推理上，正文由调用方决定怎么提示
  if (text.trim() === "" && reasoning.trim() === "") {
    throw new ChatError("empty", "模型返回空内容");
  }

  /*
   * 有正文却没有结束标记：连接被干净地提前关闭。不抛错（已产出的正文仍有价值），
   * 但把 finishReason 标成 incomplete，让界面能提示「回答可能不完整」。
   */
  if (!sawTerminator && finishReason === null) finishReason = "incomplete";

  return {
    text: text.trim(),
    reasoning: reasoning.trim(),
    finishReason,
    ...(usage !== undefined ? { usage } : {}),
  };
}

/**
 * 流式问答（导师页专用）。
 *
 * 与 callChat 的差异只有两点：请求带 `stream: true`，思考档读 `req.thinking ??
 * provider.thinking ?? "off"`。SSE 解析、正文/思考分流、超时与取消复用同一套实现。
 *
 * finish_reason=length 不抛错：流式场景下「保留已输出的部分正文并提示」比整段丢弃有用。
 * 是否采信这段正文由调用方判断（例如不要拿它去硬 parse JSON）。
 */
export async function callChatStream(
  provider: ProviderConfig,
  req: ChatRequest,
  handlers: ChatStreamHandlers = {},
): Promise<ChatStreamResult> {
  const strength: ThinkingStrength = req.thinking ?? provider.thinking ?? "off";
  const timeoutMs = req.timeoutMs ?? 60000;
  const { signal, cleanup } = createRequestSignal(timeoutMs, req.signal);
  const endpoint = endpointOf(provider);
  const headers = headersOf(provider);

  try {
    let prepared = prepareChatBody(provider, req, strength, true);
    let res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(prepared.body),
      signal,
    });
    let downgraded = false;
    let downgradeReason: DowngradeReason = null;

    if (!res.ok && res.status === 400 && prepared.thinkingFields) {
      const errorBody = await res.text().catch(() => "");
      const reason = classifyThinkingRejection(res.status, errorBody);
      if (reason !== "thinking") {
        /*
         * 400 但不是思考字段的问题（模型名错、上下文超长等）：
         * 去掉思考参数重发一次也不会好，直接失败，并保留原始错误体给界面。
         */
        throw new ChatError(
          "http",
          `HTTP ${res.status}${errorBody ? ` · ${errorBody.slice(0, 120)}` : ""}`,
          res.status,
          errorBody,
          "other",
        );
      }

      /*
       * 只降级一次：去掉思考字段、恢复 temperature。预算回到调用方原值或 2048
       * 的较大者，不保留思考档抬高的预算——重发的是「最小可用请求」。
       */
      downgraded = true;
      downgradeReason = "thinking";
      prepared = prepareChatBody(
        provider,
        { ...req, maxTokens: Math.max(req.maxTokens ?? 600, 2048) },
        "off",
        true,
      );
      res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(prepared.body),
        signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ChatError(
          "http",
          `HTTP ${res.status}（思考参数被拒绝，降级后仍失败）${body ? ` · ${body.slice(0, 120)}` : ""}`,
          res.status,
          body,
          "thinking",
        );
      }
    } else if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new ChatError(
        "http",
        `HTTP ${res.status}${errorBody ? ` · ${errorBody.slice(0, 120)}` : ""}`,
        res.status,
        errorBody,
        res.status === 400 ? classifyThinkingRejection(res.status, errorBody) : null,
      );
    }

    /*
     * 有的兼容端点忽略 stream:true，直接返回 200 + application/json。
     * 把 JSON 当 SSE 解析会得到 0 条事件、抛「空内容」——先看 Content-Type，
     * 是 JSON 就按非流式结果返回，不浪费这一次已经成功的请求。
     */
    /*
     * 只有明确声明 application/json 才走回退：有些 SSE 响应不带 content-type，
     * 用「不是 event-stream」判断会把它们误当成 JSON，去 json() 一个不会结束的流。
     */
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = (await res.json().catch(() => null)) as unknown;
      const fallbackText = extractNonStreamingText(provider.kind, json).trim();
      const fallbackReasoning = extractNonStreamingReasoning(provider.kind, json).trim();
      if (fallbackText === "" && fallbackReasoning === "") {
        throw new ChatError("empty", "模型返回空内容");
      }
      return {
        text: fallbackText,
        reasoning: fallbackReasoning,
        finishReason: null,
        thinkingDowngraded: downgraded,
        downgradeReason,
      };
    }

    const streamed = await readStream(provider.kind, res, handlers, signal);
    return { ...streamed, thinkingDowngraded: downgraded, downgradeReason };
  } catch (err) {
    throw toChatError(err, req.signal, timeoutMs);
  } finally {
    cleanup();
  }
}

// ── 思考参数探测 ──────────────────────────────────────────────────

export interface ThinkingProbeResult {
  readonly ok: boolean;
  readonly status: ThinkingStatus;
  readonly strength: ThinkingStrength;
  readonly reasoning: string;
  /** 给设置页直接展示的一句话。 */
  readonly detail: string;
}

/**
 * 探测端点是否接受当前思考档。
 *
 * 只返回结论，不写 localStorage——写回由设置页决定，避免探测函数产生副作用。
 * 400 要用 classifyThinkingRejection 判因：只有确实拒绝思考字段才判 unsupported；
 * 模型名错、上下文超长这类 400 判 unknown 并把截断后的错误体展示出来。
 * 超时/网络错误同样判 unknown，不能把「网抖了一下」写死成「不支持思考」。
 */
export async function probeThinking(
  provider: ProviderConfig,
  signal?: AbortSignal,
): Promise<ThinkingProbeResult> {
  const configured = provider.thinking ?? "off";
  if (configured === "off") {
    return {
      ok: false,
      status: "unknown",
      strength: "off",
      reasoning: "",
      detail: "当前思考档为「关」，未发起探测",
    };
  }

  try {
    const result = await callChat(provider, {
      user: "请用一句话说明：为什么栈是后进先出？",
      thinking: configured,
      // 思考 token 可能吃满预算，正文为空但 reasoning 非空也算端点支持
      allowEmptyText: true,
      maxTokens: 2048,
      temperature: 0.2,
      timeoutMs: 45000,
      signal,
    });

    if (result.reasoning.trim() !== "") {
      return {
        ok: true,
        status: "verified",
        strength: configured,
        reasoning: result.reasoning,
        detail: "端点接受了思考参数，并返回了思考内容",
      };
    }
    if (result.text.trim() === "") {
      /*
       * 200 但正文与思考都为空：说明请求通了，却拿不到任何能证明
       * 「思考参数被接受」的输出。判 unknown 而不是 verified-empty，
       * 否则设置页会把一个坏端点标成「已支持」。
       */
      return {
        ok: false,
        status: "unknown",
        strength: configured,
        reasoning: "",
        detail: "端点返回 200，但正文与思考内容都为空，无法判断思考参数是否被接受",
      };
    }
    return {
      ok: true,
      status: "verified-empty",
      strength: configured,
      reasoning: "",
      detail: "端点接受了思考参数，但没有返回可展示的思考内容（部分供应商只给摘要或不给）",
    };
  } catch (err) {
    if (err instanceof ChatError) {
      if (err.kind === "http" && err.status === 400) {
        const reason = classifyThinkingRejection(err.status, err.responseBody);
        if (reason === "thinking") {
          return {
            ok: false,
            status: "unsupported",
            strength: configured,
            reasoning: "",
            detail: "端点拒绝思考参数（HTTP 400）",
          };
        }
        const snippet = (err.responseBody ?? "").trim();
        return {
          ok: false,
          status: "unknown",
          strength: configured,
          reasoning: "",
          detail:
            "端点拒绝了请求，但不是思考参数的问题（HTTP 400）" +
            (snippet !== "" ? `：${snippet.slice(0, 120)}` : ""),
        };
      }
      if (err.kind === "timeout" || err.kind === "network") {
        return {
          ok: false,
          status: "unknown",
          strength: configured,
          reasoning: "",
          detail: `探测未完成：${err.message}`,
        };
      }
      return {
        ok: false,
        status: "unknown",
        strength: configured,
        reasoning: "",
        detail: err.message,
      };
    }
    return {
      ok: false,
      status: "unknown",
      strength: configured,
      reasoning: "",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── 一次 repair 重试 ──────────────────────────────────────────────

/**
 * 一次 repair 重试：第一次失败（结构不合格/截断）后，把失败原因拼进提示词再问一次。
 *
 * 只重试一次。第二次还不行就交给调用方降级——
 * 无限重试会把「模型不稳定」变成「页面卡住」。
 */
export async function callChatWithRepair(
  provider: ProviderConfig,
  req: ChatRequest,
  validate: (text: string) => { ok: true } | { ok: false; reason: string },
): Promise<ChatResult> {
  const first = await callChat(provider, req);
  const check = validate(first.text);
  if (check.ok) return first;

  const repairUser = `${req.user}

上一次的输出有以下问题：${check.reason}
请严格按要求的 JSON 格式重新输出，不要任何解释文字。`;

  return callChat(provider, { ...req, user: repairUser });
}
