/**
 * MCP 2025-06-18 Streamable HTTP 客户端（只做出站调用）。
 *
 * 只支持一种传输：单端点 POST + `Accept: application/json, text/event-stream`。
 * 不支持 stdio，也不支持旧的 HTTP+SSE 双端点（那是 2024-11-05 之前的形状）。
 *
 * 安全边界（ADR 决策八的五条硬规则在这一层的落点）：
 * - 服务器地址只能来自用户配置（mcpStore.ts 落库的 url），**绝不接受模型参数里的地址**；
 * - 每一次出站都先 assertUpstreamAllowed 再 guardedRequest：形状 → DNS → 钉 IP，
 *   本地 http 必须显式进 ALP_ALLOW_HTTP_PROVIDER_HOSTS，否则连解析都不会发生；
 * - 工具名走 `mcp__<serverId>__<tool>` 命名空间并校验字符集，非法名字直接拒绝，
 *   避免第三方服务器的名字撞上本地工具或写出上游不认的函数名；
 * - 远程工具的“只读”只信 annotations 的 readOnlyHint 且 destructiveHint 不为 true，
 *   并且仍要求用户逐项勾选（白名单第二层在 /api/agent 里做）；
 * - 工具输出只是数据：这里原样返回文本，隔离由 agent.ts 的界符负责。
 *
 * 会话：initialize 的响应头 `Mcp-Session-Id` 透传到后续每个请求，每个请求都带
 * `MCP-Protocol-Version`。收到 404 视为会话失效，重新 initialize 一次并重试原请求；
 * 只重试一次，避免「服务器永远 404 → 无限握手」。
 */

import { TOOL_NAME_PATTERN } from "@/lib/tools";
import {
  assertUpstreamAllowed,
  guardedRequest,
  isSsrfGuardError,
  isUpstreamRequestError,
} from "@/lib/ssrfGuard";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const MCP_CLIENT_INFO = { name: "adaptive-learning-path", version: "0.2.0" } as const;

export const MCP_SESSION_ID_HEADER = "mcp-session-id";
export const MCP_PROTOCOL_VERSION_HEADER = "mcp-protocol-version";

/** Accept 必须同时声明两种，服务器才有权选 JSON 或 SSE。 */
const MCP_ACCEPT = "application/json, text/event-stream";

/** serverId 是命名空间的一段，限制成小写可读形式；总长度还要过 64 字符工具名上限。 */
const SERVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;

/** 单次响应上限：tools/list 的描述与 inputSchema 也可能很大，但不需要更多。 */
const MAX_MCP_RESPONSE_BYTES = 2 * 1024 * 1024;

/** 工具描述回灌给模型的长度上限；超长描述本身就可疑（提示词注入的常见载体）。 */
const MAX_TOOL_DESCRIPTION_CHARS = 800;

export type McpErrorCode = "transport" | "timeout" | "protocol" | "rpc" | "invalid-config";

export class McpClientError extends Error {
  readonly code: McpErrorCode;

  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpClientError";
    this.code = code;
  }
}

export function isValidMcpServerId(value: string): boolean {
  return SERVER_ID_PATTERN.test(value);
}

/**
 * 拼出命名空间后的工具名并校验。
 *
 * 三段都只允许 [A-Za-z0-9_-]，且整体必须满足上游函数名的 1..64 限制；
 * 任何一段不合法都抛错，而不是截断——截断会让两个不同工具撞成同名。
 */
export function mcpToolName(serverId: string, tool: string): string {
  if (!isValidMcpServerId(serverId)) {
    throw new McpClientError("invalid-config", `MCP serverId 不合法：${serverId}`);
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(tool)) {
    throw new McpClientError("invalid-config", `MCP 工具名不合法：${tool}`);
  }
  const full = `mcp__${serverId}__${tool}`;
  if (!TOOL_NAME_PATTERN.test(full)) {
    throw new McpClientError(
      "invalid-config",
      `MCP 工具名超过 64 字符或字符集不合法：${serverId}/${tool}`,
    );
  }
  return full;
}

/** mcp__<server>__<tool> 的逆解析；不是本命名空间时返回 null。 */
export function parseMcpToolName(
  full: string,
): { readonly serverId: string; readonly tool: string } | null {
  const match = /^mcp__([A-Za-z0-9_-]+)__([A-Za-z0-9_-]+)$/u.exec(full);
  if (!match) return null;
  return { serverId: match[1], tool: match[2] };
}

// ── 传输层 ────────────────────────────────────────────────────────

export interface McpHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface McpHttpResponse {
  readonly status: number;
  /** 头名大小写不敏感。 */
  readonly header: (name: string) => string | null;
  readonly body: string;
}

/** 可注入的传输，测试用假实现；生产只有 guardedMcpTransport 一种。 */
export type McpTransport = (request: McpHttpRequest) => Promise<McpHttpResponse>;

/**
 * 真实传输：唯一出站口。
 *
 * 每次请求都重新 assertUpstreamAllowed（而不是复用握手时的结论）：DNS 会变，
 * 复用旧 pin 等于把「解析到内网」的窗口一直开着。
 */
export function guardedMcpTransport(): McpTransport {
  return async ({ url, headers, body, timeoutMs, signal }) => {
    let target;
    try {
      target = await assertUpstreamAllowed(url);
    } catch (err) {
      throw new McpClientError(
        "transport",
        isSsrfGuardError(err) ? `MCP 服务器地址不被允许：${err.message}` : "MCP 服务器地址无法解析",
      );
    }

    let response;
    try {
      response = await guardedRequest(target, {
        method: "POST",
        headers,
        body,
        timeoutMs,
        maxBytes: MAX_MCP_RESPONSE_BYTES,
        signal,
      });
    } catch (err) {
      if (isUpstreamRequestError(err)) {
        throw new McpClientError(
          err.reason === "timeout" ? "timeout" : "transport",
          err.reason === "timeout" ? "MCP 服务器响应超时" : `MCP 请求失败：${err.message}`,
        );
      }
      throw new McpClientError("transport", "MCP 请求失败");
    }

    return {
      status: response.status,
      header: (name) => headerOf(response.headers, name),
      body: response.body.toString("utf8"),
    };
  };
}

function headerOf(headers: Record<string, unknown>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return null;
  }
  return null;
}

// ── JSON / SSE 双读 ───────────────────────────────────────────────

/**
 * 从 SSE 文本里取出所有 data: 载荷并解析成 JSON。
 *
 * 只取 `data:` 行（兼容 `data: {...}` 与 `data:{...}`），忽略注释与其它字段。
 * 解析失败的消息直接跳过：一条坏消息不该让整次调用报废，但「一条都对不上」
 * 会在上层变成 protocol 错误。
 */
export function parseSseJsonMessages(text: string): unknown[] {
  const out: unknown[] = [];
  let dataLines: string[] = [];

  const flush = (): void => {
    if (dataLines.length === 0) return;
    const raw = dataLines.join("\n");
    dataLines = [];
    try {
      out.push(JSON.parse(raw) as unknown);
    } catch {
      // 坏消息跳过
    }
  };

  for (const line of text.split(/\r?\n/u)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue;
    if (!line.startsWith("data:")) continue;
    dataLines.push(line.slice("data:".length).replace(/^ /u, ""));
  }
  flush();
  return out;
}

function isSseResponse(contentType: string, body: string): boolean {
  if (contentType.toLowerCase().includes("text/event-stream")) return true;
  // 有的实现漏了 Content-Type；按正文形状兜底，避免把 SSE 当 JSON 解析。
  return /^(?::|event:|data:)/u.test(body.trimStart());
}

interface JsonRpcMessage {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

function asMessage(value: unknown): JsonRpcMessage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as JsonRpcMessage;
}

function rpcErrorText(error: unknown): string {
  if (typeof error !== "object" || error === null) return "MCP 返回了未知错误";
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "number" ? record.code : null;
  const message = typeof record.message === "string" ? record.message : "MCP 返回了未知错误";
  return code === null ? message : `${message}（code ${code}）`;
}

// ── 客户端 ────────────────────────────────────────────────────────

export interface McpServerEndpoint {
  readonly serverId: string;
  readonly url: string;
  /** 用户配置的鉴权头（已解密）；同名协议头不允许覆盖。 */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface McpClientOptions {
  readonly transport?: McpTransport;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface McpToolDescriptor {
  /** 服务器原文工具名（未加命名空间）。 */
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  /** 仅当 annotations.readOnlyHint === true 且 destructiveHint 不为 true。 */
  readonly readOnly: boolean;
}

export interface RejectedMcpTool {
  readonly name: string;
  readonly reason: "invalid-name" | "invalid-shape";
}

export interface McpToolListing {
  readonly tools: readonly McpToolDescriptor[];
  readonly rejected: readonly RejectedMcpTool[];
}

export interface McpToolCallResult {
  readonly ok: boolean;
  readonly text: string;
}

interface CallOutcome {
  readonly id: number;
  readonly result: unknown;
}

export class McpClient {
  private readonly endpoint: McpServerEndpoint;
  private readonly transport: McpTransport;
  private readonly timeoutMs: number;
  private readonly signal: AbortSignal | undefined;

  private nextId = 1;
  private sessionId: string | null = null;
  private initialized = false;
  private handshake: Promise<void> | null = null;

  constructor(endpoint: McpServerEndpoint, options: McpClientOptions = {}) {
    this.endpoint = endpoint;
    this.transport = options.transport ?? guardedMcpTransport();
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.signal = options.signal;
  }

  /** 已握手的会话 id；测试与诊断用。 */
  get session(): string | null {
    return this.sessionId;
  }

  /** 幂等的握手；并发调用共享同一个 promise。 */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.handshake !== null) return this.handshake;

    this.handshake = (async () => {
      const outcome = await this.call("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      });
      const result = outcome.result;
      if (typeof result !== "object" || result === null) {
        throw new McpClientError("protocol", "MCP initialize 返回值不是对象");
      }
      // notifications/initialized 是规范要求的第一条通知；失败不阻断（有些实现直接 404）。
      await this.notify("notifications/initialized").catch(() => undefined);
      this.initialized = true;
    })();

    try {
      await this.handshake;
    } finally {
      // 失败后允许重试：清掉缓存的 promise，下次 initialize 重新握手。
      if (!this.initialized) this.handshake = null;
    }
  }

  async listTools(): Promise<McpToolListing> {
    await this.initialize();
    const { result } = await this.request("tools/list", {});
    if (typeof result !== "object" || result === null) {
      throw new McpClientError("protocol", "MCP tools/list 返回值不是对象");
    }
    const raw = (result as Record<string, unknown>).tools;
    if (!Array.isArray(raw)) return { tools: [], rejected: [] };

    const tools: McpToolDescriptor[] = [];
    const rejected: RejectedMcpTool[] = [];

    for (const entry of raw) {
      if (typeof entry !== "object" || entry === null) {
        rejected.push({ name: "(non-object)", reason: "invalid-shape" });
        continue;
      }
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      if (!/^[A-Za-z0-9_-]{1,64}$/u.test(name)) {
        rejected.push({ name: name === "" ? "(empty)" : name, reason: "invalid-name" });
        continue;
      }

      const annotations =
        typeof record.annotations === "object" && record.annotations !== null
          ? (record.annotations as Record<string, unknown>)
          : {};

      tools.push({
        name,
        description: sanitizeDescription(record.description),
        inputSchema:
          typeof record.inputSchema === "object" && record.inputSchema !== null
            ? (record.inputSchema as Record<string, unknown>)
            : undefined,
        // annotations 只是 hint：destructiveHint===true 时即便 readOnlyHint 也当非只读。
        readOnly: annotations.readOnlyHint === true && annotations.destructiveHint !== true,
      });
    }

    return { tools, rejected };
  }

  /**
   * 调一次工具。
   *
   * 超时会补发 notifications/cancelled（规范建议），但通知本身 best-effort：
   * 服务器可能已经把活干完，取消通知只是让它别再占着。
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<McpToolCallResult> {
    await this.initialize();

    const requestId = this.nextId;
    let outcome: CallOutcome;
    try {
      outcome = await this.request("tools/call", { name, arguments: args }, options.signal);
    } catch (err) {
      if (err instanceof McpClientError && err.code === "timeout") {
        await this.notify("notifications/cancelled", {
          requestId,
          reason: `timeout after ${this.timeoutMs}ms`,
        }).catch(() => undefined);
      }
      throw err;
    }

    const result = outcome.result;
    if (typeof result !== "object" || result === null) {
      throw new McpClientError("protocol", "MCP tools/call 返回值不是对象");
    }
    const record = result as Record<string, unknown>;

    // 服务器声明的 isError：调用本身成功，但工具执行失败，结果仍要回灌给模型。
    return {
      ok: record.isError !== true,
      text: contentToText(record.content),
    };
  }

  // ── 内部 ──────────────────────────────────────────────────────

  private headersFor(sessionId: string | null): Record<string, string> {
    // 用户鉴权头先写，协议头后写：配置里的头不能覆盖 Accept / Content-Type / 协议版本 / 会话。
    const headers: Record<string, string> = {};
    if (this.endpoint.headers !== undefined) {
      for (const [name, value] of Object.entries(this.endpoint.headers)) {
        const key = name.trim().toLowerCase();
        if (key === "" || /[\r\n]/u.test(value)) continue;
        headers[key] = value;
      }
    }
    headers["content-type"] = "application/json";
    headers.accept = MCP_ACCEPT;
    headers[MCP_PROTOCOL_VERSION_HEADER] = MCP_PROTOCOL_VERSION;
    if (sessionId !== null) headers[MCP_SESSION_ID_HEADER] = sessionId;
    return headers;
  }

  private async send(payload: string, signal: AbortSignal | undefined = this.signal): Promise<McpHttpResponse> {
    if (signal?.aborted) {
      throw new McpClientError("transport", "MCP 请求已被取消");
    }
    return this.transport({
      url: this.endpoint.url,
      headers: this.headersFor(this.sessionId),
      body: payload,
      timeoutMs: this.timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    });
  }

  private async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    });
    const response = await this.send(body);
    if (response.status < 200 || response.status >= 300) {
      throw new McpClientError(
        "protocol",
        `MCP 通知 ${method} 返回 HTTP ${response.status}`,
      );
    }
  }

  /** 发一条带 id 的请求并把 JSON 与 SSE 两种响应都归一成 result。 */
  private async call(
    method: string,
    params: Record<string, unknown>,
    options: { readonly allowReinitialize?: boolean; readonly signal?: AbortSignal } = {},
  ): Promise<CallOutcome> {
    const id = this.nextId;
    this.nextId += 1;

    const response = await this.send(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      options.signal,
    );

    const session = response.header(MCP_SESSION_ID_HEADER);
    if (session !== null && session !== "") this.sessionId = session;

    /*
     * 404 = 会话已失效（Streamable HTTP 规范用它表示「重新 initialize」）。
     * 只对非 initialize 请求、且只重试一次，避免握手死循环。
     */
    if (
      response.status === 404 &&
      method !== "initialize" &&
      options.allowReinitialize !== false
    ) {
      this.initialized = false;
      this.sessionId = null;
      // 握手 promise 也要清掉：否则 initialize() 会直接复用上一次已完成的握手。
      this.handshake = null;
      await this.initialize();
      return this.call(method, params, {
        allowReinitialize: false,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    }

    if (response.status < 200 || response.status >= 300) {
      throw new McpClientError("protocol", `MCP ${method} 返回 HTTP ${response.status}`);
    }

    const message = this.pickResponse(response, id, method);
    if (message.error !== undefined) {
      throw new McpClientError("rpc", rpcErrorText(message.error));
    }
    return { id, result: message.result };
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallOutcome> {
    if (!this.initialized && method !== "initialize") {
      throw new McpClientError("protocol", `MCP 客户端尚未 initialize，不能调用 ${method}`);
    }
    return this.call(method, params, signal === undefined ? {} : { signal });
  }

  private pickResponse(response: McpHttpResponse, id: number, method: string): JsonRpcMessage {
    const contentType = response.header("content-type") ?? "";
    const body = response.body;

    if (body.trim() === "") {
      throw new McpClientError("protocol", `MCP ${method} 返回空响应体`);
    }

    const messages = isSseResponse(contentType, body)
      ? parseSseJsonMessages(body)
      : (() => {
          try {
            return [JSON.parse(body) as unknown];
          } catch {
            throw new McpClientError("protocol", `MCP ${method} 返回的不是合法 JSON`);
          }
        })();

    for (const candidate of messages) {
      const message = asMessage(candidate);
      if (message === null) continue;
      if (message.id !== id) continue;
      if (message.result !== undefined || message.error !== undefined) return message;
    }

    throw new McpClientError("protocol", `MCP ${method} 的响应里没有 id=${id} 的结果`);
  }

  /** 诊断用：本次会话已发出多少个请求 id。 */
  get requestCount(): number {
    return this.nextId - 1;
  }
}

/** 描述按不可信数据处理：压缩空白、截断、去掉围栏标记（防止伪造工具结果界符）。 */
function sanitizeDescription(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const collapsed = raw.replace(/\s+/gu, " ").trim();
  if (collapsed === "") return undefined;
  return collapsed.slice(0, MAX_TOOL_DESCRIPTION_CHARS);
}

/** content 数组 → 单段文本；图片等非文本块用占位符标明「这里被省略了」。 */
function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const entry of content) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
    } else if (record.type === "resource" && typeof record.resource === "object") {
      const resource = record.resource as Record<string, unknown>;
      if (typeof resource.text === "string") parts.push(resource.text);
    } else {
      parts.push(`[${typeof record.type === "string" ? record.type : "非文本"} 内容已省略]`);
    }
  }
  return parts.join("\n");
}
