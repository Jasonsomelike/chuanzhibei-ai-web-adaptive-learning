/**
 * 思考强度与流式响应的纯函数层。
 *
 * 这一层不碰 fetch、不读 localStorage、不依赖时钟：请求体怎么加字段、
 * SSE 字节怎么切事件、一段流式 JSON 该归到正文还是思考，全部在这里决定。
 * 浏览器直连与 BYOK 的边界因此保持不动——这里只处理已经拿到的文本。
 *
 * 最硬的一条约束：**正文与推理内容永不合并**。两边都是同一个模型生成的，
 * 但用途不同——正文要过 JSON 校验、要给判分引用，推理只用于展示，
 * 一旦混进来，`callChatWithRepair` 的整片 JSON 都会解析失败。
 */

import type { ProviderKind } from "@/lib/provider";

export type ThinkingStrength = "off" | "standard" | "deep";

export interface SseEvent {
  /** 事件名。没有 `event:` 字段时按 SSE 规范取默认值 "message"。 */
  readonly event: string;
  /** 同一事件内多行 `data:` 用 "\n" 连接后的结果。 */
  readonly data: string;
}

export interface ChatUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface StreamDelta {
  readonly text: string;
  readonly reasoning: string;
  readonly finishReason: string | null;
  readonly usage?: ChatUsage;
}

export interface SseDecoder {
  push(chunk: string): SseEvent[];
  flush(): SseEvent[];
}

export interface ThinkingBodyResult {
  readonly body: Record<string, unknown>;
  readonly maxTokens: number;
  /** 是否真的写入了思考相关字段。调用方据此决定 400 时要不要降级重发。 */
  readonly thinkingFields: boolean;
}

// ── SSE 解码 ──────────────────────────────────────────────────────

const DONE_SENTINEL = "[DONE]";

interface LineSlice {
  readonly line: string;
  readonly rest: string;
}

/**
 * 从缓冲区头部取一行。
 *
 * `\r` 出现在缓冲区末尾时返回 null 而不是当作行尾：
 * 下一块可能以 `\n` 开头，提前切会把 CRLF 拆成两个空行。
 */
function takeLine(input: string): LineSlice | null {
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code === 0x0a) {
      return { line: input.slice(0, i), rest: input.slice(i + 1) };
    }
    if (code === 0x0d) {
      if (i + 1 >= input.length) return null;
      const skip = input.charCodeAt(i + 1) === 0x0a ? 2 : 1;
      return { line: input.slice(0, i), rest: input.slice(i + skip) };
    }
  }
  return null;
}

/**
 * 增量 SSE 解码器。
 *
 * 只做协议层：`event:` / `data:` 累积到空行派发，注释行与 id/retry 忽略。
 * `data: [DONE]` 会作为普通事件返回，由 `parseStreamPayload` 过滤——
 * 解码器不知道各家协议的结束语义，提前吞掉会让调用方无法区分「正常结束」与「流断了」。
 */
export function createSseDecoder(): SseDecoder {
  let pending = "";
  let eventName = "";
  let dataLines: string[] = [];
  let hasData = false;

  function dispatch(out: SseEvent[]): void {
    // SSE 规范：空 data 缓冲区不派发事件
    if (hasData) {
      const data = dataLines.join("\n");
      if (data !== "") {
        out.push({ event: eventName === "" ? "message" : eventName, data });
      }
    }
    eventName = "";
    dataLines = [];
    hasData = false;
  }

  function consumeLine(line: string, out: SseEvent[]): void {
    if (line === "") {
      dispatch(out);
      return;
    }
    if (line.startsWith(":")) return;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    // SSE 规范只去掉冒号后的一个空格，多出来的空格属于数据
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      dataLines.push(value);
      hasData = true;
    }
  }

  return {
    push(chunk: string): SseEvent[] {
      pending += chunk;
      const out: SseEvent[] = [];
      for (;;) {
        const parsed = takeLine(pending);
        if (parsed === null) break;
        pending = parsed.rest;
        consumeLine(parsed.line, out);
      }
      return out;
    },

    flush(): SseEvent[] {
      const out: SseEvent[] = [];
      let rest = pending;
      pending = "";
      // 末尾的 CR 是未等到换行的行尾，不是数据
      if (rest.endsWith("\r")) rest = rest.slice(0, -1);
      if (rest !== "") consumeLine(rest, out);
      // 流在最后一个空行之前结束：已累积的数据仍然是一个完整事件
      dispatch(out);
      return out;
    },
  };
}

// ── 通用取值 ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function totalOf(
  prompt: number | undefined,
  completion: number | undefined,
): number | undefined {
  if (prompt === undefined || completion === undefined) return undefined;
  return prompt + completion;
}

function makeUsage(
  prompt: number | undefined,
  completion: number | undefined,
  total: number | undefined,
): ChatUsage | undefined {
  const resolvedTotal = total ?? totalOf(prompt, completion);
  if (prompt === undefined && completion === undefined && resolvedTotal === undefined) {
    return undefined;
  }
  return {
    ...(prompt !== undefined ? { promptTokens: prompt } : {}),
    ...(completion !== undefined ? { completionTokens: completion } : {}),
    ...(resolvedTotal !== undefined ? { totalTokens: resolvedTotal } : {}),
  };
}

/** OpenAI 兼容的 content 可能是字符串，也可能是多模态片段数组。 */
function textFromOpenAiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if ((part.type === "text" || part.type === undefined) && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.join("");
}

/**
 * OpenRouter 等端点的 reasoning_details 是数组，正文在 text，
 * 有些模型只给 summary；加密块（reasoning.encrypted）没有可展示文本，自然跳过。
 */
function reasoningFromDetails(details: unknown): string {
  if (!Array.isArray(details)) return "";
  const parts: string[] = [];
  for (const detail of details) {
    if (!isRecord(detail)) continue;
    if (typeof detail.text === "string" && detail.text !== "") {
      parts.push(detail.text);
    } else if (typeof detail.summary === "string" && detail.summary !== "") {
      parts.push(detail.summary);
    }
  }
  return parts.join("\n");
}

/**
 * 推理字段有多个别名。按优先级取第一个非空值而不是拼接：
 * 同一个供应商常同时返回 reasoning 与 reasoning_details，拼接会展示两份。
 */
function reasoningFromMessage(message: Record<string, unknown>): string {
  const content = asString(message.reasoning_content);
  if (content !== "") return content;
  const legacy = asString(message.reasoning);
  if (legacy !== "") return legacy;
  return reasoningFromDetails(message.reasoning_details);
}

function openAiUsage(raw: unknown): ChatUsage | undefined {
  if (!isRecord(raw)) return undefined;
  return makeUsage(
    asNumber(raw.prompt_tokens),
    asNumber(raw.completion_tokens),
    asNumber(raw.total_tokens),
  );
}

function anthropicUsage(raw: unknown): ChatUsage | undefined {
  if (!isRecord(raw)) return undefined;
  return makeUsage(
    asNumber(raw.input_tokens),
    asNumber(raw.output_tokens),
    undefined,
  );
}

/** Anthropic 正文只认 type=text；thinking / redacted_thinking / tool_use 一律不进正文。 */
function anthropicText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

function anthropicReasoning(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    // redacted_thinking 只有加密 data，没有可展示文本
    if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking !== "") {
      parts.push(block.thinking);
    }
  }
  return parts.join("\n");
}

// ── 流式解析 ──────────────────────────────────────────────────────

function parseOpenAiChunk(json: Record<string, unknown>): StreamDelta | null {
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choice: unknown = choices[0];
  const choiceRecord = isRecord(choice) ? choice : undefined;
  const delta = choiceRecord && isRecord(choiceRecord.delta) ? choiceRecord.delta : undefined;

  const text = delta ? textFromOpenAiContent(delta.content) : "";
  const reasoning = delta ? reasoningFromMessage(delta) : "";
  const finishReason = choiceRecord ? asString(choiceRecord.finish_reason) : "";
  const usage = openAiUsage(json.usage);

  if (text === "" && reasoning === "" && finishReason === "" && usage === undefined) {
    // role 占位块、心跳块等没有可消费内容
    return null;
  }

  return {
    text,
    reasoning,
    finishReason: finishReason === "" ? null : finishReason,
    ...(usage !== undefined ? { usage } : {}),
  };
}

function parseAnthropicEvent(eventName: string, json: Record<string, unknown>): StreamDelta | null {
  const type = asString(json.type) || eventName;

  if (type === "content_block_delta") {
    const delta = isRecord(json.delta) ? json.delta : {};
    const deltaType = asString(delta.type);

    if (deltaType === "text_delta") {
      const text = asString(delta.text);
      return text === "" ? null : { text, reasoning: "", finishReason: null };
    }
    if (deltaType === "thinking_delta") {
      const reasoning = asString(delta.thinking);
      return reasoning === "" ? null : { text: "", reasoning, finishReason: null };
    }
    // signature_delta 用于多轮校验，本项目单轮问答不保存也不展示；
    // input_json_delta 属于 tool_use，同样不进正文
    return null;
  }

  if (type === "message_delta") {
    const delta = isRecord(json.delta) ? json.delta : {};
    const stopReason = asString(delta.stop_reason);
    const usage = anthropicUsage(json.usage);
    if (stopReason === "" && usage === undefined) return null;
    return {
      text: "",
      reasoning: "",
      finishReason: stopReason === "" ? null : stopReason,
      ...(usage !== undefined ? { usage } : {}),
    };
  }

  if (type === "message_start") {
    const message = isRecord(json.message) ? json.message : {};
    const usage = anthropicUsage(message.usage);
    if (usage === undefined) return null;
    return { text: "", reasoning: "", finishReason: null, usage };
  }

  // ping / message_stop / content_block_start / error 不产出增量。
  // 流内 error 由调用方检查原始事件，不在这里伪造正文。
  return null;
}

/**
 * 把一条 SSE 事件解析成正文/思考增量。
 *
 * 返回 null 表示「这条事件没有可消费内容」：`[DONE]`、心跳、签名、
 * 非法 JSON、以及协议里与正文无关的控制事件。调用方只累加返回值的字段。
 */
export function parseStreamPayload(kind: ProviderKind, event: SseEvent): StreamDelta | null {
  const data = event.data.trim();
  if (data === "" || data === DONE_SENTINEL) return null;

  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    // 单条坏事件不应该打断整段回答；真正的断流由调用方按超时/EOF 判断
    return null;
  }
  if (!isRecord(json)) return null;

  return kind === "anthropic"
    ? parseAnthropicEvent(event.event, json)
    : parseOpenAiChunk(json);
}

// ── 非流式解析 ────────────────────────────────────────────────────

/**
 * 取正文。Anthropic 的 content 数组按 type 分流：
 * 只有 `type="text"` 的块算正文，thinking 块在前也不会让正文变空。
 */
export function extractNonStreamingText(kind: ProviderKind, json: unknown): string {
  if (!isRecord(json)) return "";

  if (kind === "anthropic") {
    return anthropicText(json.content);
  }

  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choice: unknown = choices[0];
  if (!isRecord(choice)) {
    // 少数兼容端点仍返回旧 completions 形状
    if (Array.isArray(json.content)) return textFromOpenAiContent(json.content);
    return asString(json.text);
  }
  if (isRecord(choice.message)) {
    return textFromOpenAiContent(choice.message.content);
  }
  return asString(choice.text);
}

/** 取推理内容。与正文使用两套独立的取值路径，绝不互相回退。 */
export function extractNonStreamingReasoning(kind: ProviderKind, json: unknown): string {
  if (!isRecord(json)) return "";

  if (kind === "anthropic") {
    return anthropicReasoning(json.content);
  }

  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choice: unknown = choices[0];
  if (!isRecord(choice)) return "";
  if (isRecord(choice.message)) return reasoningFromMessage(choice.message);
  // 个别兼容端点把 reasoning 放在 choice 顶层
  return reasoningFromMessage(choice);
}

// ── 请求体 ────────────────────────────────────────────────────────

interface ThinkingProfile {
  readonly effort: string;
  readonly budgetTokens: number;
  readonly minMaxTokens: number;
}

/** 三档矩阵写死在代码里：不按模型名猜能力，猜错就是 400。 */
const THINKING_PROFILES: Record<Exclude<ThinkingStrength, "off">, ThinkingProfile> = {
  standard: { effort: "medium", budgetTokens: 4096, minMaxTokens: 8192 },
  deep: { effort: "high", budgetTokens: 16384, minMaxTokens: 20480 },
};

/**
 * 按档位改造请求体。
 *
 * 关档不是「发一个 none/disabled」而是**字段完全不出现**：
 * GPT-6 Astra 对 `reasoning_effort:"none"`、GLM-5.3 / Kimi / Claude Sonnet 5.5
 * 对 `thinking:{type:"disabled"}` 都会直接 400。为了满足这个口径，
 * 输入体里残留的同名字段也会被删掉，避免复用请求体时把旧档位带回来。
 *
 * 开思考时同时删除 temperature/top_p/top_k：Anthropic 新模型不接受这些采样参数，
 * OpenAI 推理模型也只接受默认温度。函数不修改入参，返回的是浅拷贝。
 */
export function buildThinkingBody(
  kind: ProviderKind,
  strength: ThinkingStrength,
  body: Record<string, unknown>,
  baseMaxTokens: number,
): ThinkingBodyResult {
  const next: Record<string, unknown> = { ...body };
  const base = Number.isFinite(baseMaxTokens) ? Math.max(0, Math.trunc(baseMaxTokens)) : 0;

  if (strength === "off") {
    delete next.reasoning_effort;
    delete next.thinking;
    return { body: next, maxTokens: base, thinkingFields: false };
  }

  const profile = THINKING_PROFILES[strength];
  const maxTokens = Math.max(base, profile.minMaxTokens);

  delete next.temperature;
  delete next.top_p;
  delete next.top_k;
  next.max_tokens = maxTokens;

  if (kind === "anthropic") {
    delete next.reasoning_effort;
    next.thinking = { type: "enabled", budget_tokens: profile.budgetTokens };
  } else {
    delete next.thinking;
    next.reasoning_effort = profile.effort;
  }

  return { body: next, maxTokens, thinkingFields: true };
}
