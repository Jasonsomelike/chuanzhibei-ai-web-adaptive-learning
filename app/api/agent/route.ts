import { estimateLearningTime } from "@/lib/learningTimeServer";
import { routeTeachingTask } from "@/lib/learningWorkflow";
import { retrieveDocuments } from "@/lib/documentRetrieval";
import { budgetUploadHits, contextBudget, estimateTokens } from "@/lib/contextBudget";
/**
 * POST /api/agent —— Learning Supervisor + 专业化教学工作流 + SSE。
 *
 * 请求体由 agentContracts.ts 约束：问题、课程、教学任务与偏好；
 * 模型地址与密钥一律来自当前账号保存的 llm 配置，客户端不能自报模式，
 * 也不能在参数里塞服务器地址（那是 MCP 配置的事）。
 *
 * 安全边界：
 * - 必须登录（requireApiUser）+ 同源（assertMutationOrigin）；请求体用 readLimitedText 限量；
 * - 模型出站必须先 assertUpstreamAllowed 再 guardedRequest，本文件不出现全局 fetch；
 * - 远程 MCP 工具的地址只来自 mcp_servers 表，工具集在 run 开始时冻结；
 * - 当前 Anthropic 适配器不发 tools，教学工作流仍可使用服务端预载数据；
 * - local 模式（没有服务端 llm 配置）给明确 notice，不静默降级成「没有工具的回答」；
 * - 工具结果只回 preview，完整结果不回传浏览器；done 事件在每条路径上都会发。
 */

import {
  AGENT_REQUEST_MAX_BYTES,
  agentEventToSse,
  agentRequest,
  parseAgentLimits,
  type AgentEvent,
} from "@/lib/agentContracts";
import {
  buildAgentSystemPrompt,
  filterRemoteTools,
  remoteAgentToolSpec,
  type AgentMessage,
  type AgentModelReply,
  type AgentModelRequest,
  type AgentToolSpec,
} from "@/lib/agent";
import { apiErrorCodes } from "@/lib/apiContracts";
import { getDb } from "@/lib/db";
import { McpClient, mcpToolName } from "@/lib/mcpClient";
import {
  listMcpServers,
  readMcpAuthHeaders,
  type PublicMcpServer,
} from "@/lib/mcpStore";
import { assertMutationOrigin, jsonError, readLimitedText, requireApiUser } from "@/lib/routeAuth";
import {
  assertUpstreamAllowed,
  guardedRequest,
  isUpstreamRequestError,
  type AllowedTarget,
} from "@/lib/ssrfGuard";
import { isReadOnlyToolName } from "@/lib/tools";
import { callLearningTool, learningAgentTools, loadLearningContext, LearningContextError } from "@/lib/learningContext";
import { tutorSystemPrompt } from "@/lib/tutorPersona";
import { tutoringPolicy } from "@/lib/tutorPreferences";
import { prepareTeachingTask, runTeachingWorkflow } from "@/lib/learningWorkflow";
import { readLearningSession, saveLearningSession } from "@/lib/learningSession";
import { claimConversationAgent, ConversationError } from "@/lib/conversationStore";
import { conversationRecorder } from "@/lib/conversationAgent";
import { buildTutorQuestion } from "@/lib/tutorQuestion";
import {
  buildUpstreamChatBody,
  endpointFor,
  filterExtraHeaders,
  isLlmConfigError,
  loadLlmConfigForUser,
  redactSecrets,
  type LlmConfig,
  type LlmConfigErrorCode,
  type RedactSecret,
  type UpstreamMessage,
  type UpstreamToolCall,
} from "@/lib/upstream";
import type { ChatContent, ChatToolDefinition } from "@/lib/provider";

export const runtime = "nodejs";
export const maxDuration = 300;

/** 工具总数上限：本地 5 个 + 远程若干，24 个已经远超模型能稳定选择的范围。 */
const MAX_AGENT_TOOLS = 24;

/** 单次 discover 的服务器上限：每次请求都要先握手 + tools/list，扇出要有界。 */
const MAX_ENABLED_SERVERS = 5;

/** 单轮模型回复上限。Agent 的每轮输出是短决策 + 短结论，2000 足够。 */
const MAX_AGENT_TOKENS = 2_000;

/** 上游非流式响应上限（含 tool_calls 的参数 JSON）。 */
const MAX_MODEL_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * 工具发现在返回 SSE 响应之前完成，因此也要有总时长上限：否则 5 个不可达的
 * MCP 服务器各耗 20s，首字节会被拖到 100s，而且会话预算还没开始计时。
 */
const MAX_DISCOVERY_MS = 30_000;

/** inputSchema 下传上限：schema 是第三方数据，不能让它挤爆每轮请求体。 */
const MAX_TOOL_SCHEMA_CHARS = 4_000;

/** 心跳间隔：与 /api/llm/chat 的代理一致，避免中间层把空闲连接掐掉。 */
const HEARTBEAT_MS = 15_000;

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
} as const;

interface RemoteCall {
  readonly client: McpClient;
  readonly rawName: string;
}

// ── 请求解析 ──────────────────────────────────────────────────────

function parseJsonObject(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function parseToolArguments(
  raw: string,
): { readonly ok: true; readonly value: Record<string, unknown> } | { readonly ok: false; readonly message: string } {
  const text = raw.trim();
  if (text === "") return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "工具参数不是合法 JSON。" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: "工具参数必须是 JSON 对象。" };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

/** 把 Agent 的消息形状转成 upstream.buildUpstreamChatBody 认识的形状。 */
function toUpstreamMessages(messages: readonly AgentMessage[]): UpstreamMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: toUpstreamContent(message.content),
    ...(message.toolCalls === undefined
      ? {}
      : {
          tool_calls: message.toolCalls.map(
            (call): UpstreamToolCall => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            }),
          ),
        }),
    ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
  }));
}

function toUpstreamContent(content: AgentMessage["content"]): ChatContent {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : { type: "image_url" as const, image_url: { url: part.image_url.url } },
  );
}

function toChatTools(tools: readonly AgentToolSpec[]): ChatToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

// ── 上游配置 ──────────────────────────────────────────────────────

function buildHeaders(config: LlmConfig): Record<string, string> {
  // 用户额外头先合并，协议必需头最后写：extraHeaders 不能覆盖 Authorization / x-api-key。
  const headers: Record<string, string> = { ...filterExtraHeaders(config.options.extraHeaders) };
  headers["content-type"] = "application/json";
  headers["accept"] = "application/json";
  if (config.api === "anthropic") {
    headers["x-api-key"] = config.payload.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["authorization"] = `Bearer ${config.payload.apiKey}`;
  }
  return headers;
}

function localModeMessage(code: LlmConfigErrorCode): string {
  switch (code) {
    case "CONFIG_MISSING":
      return "当前是本地（BYOK / 浏览器直连）模式，或该账号还没有保存服务端模型配置：Agent 的工具循环需要服务端模式。请到「设置」保存模型配置后重试。";
    case "KEY_ENC_UNAVAILABLE":
      return "服务端未配置密钥主密钥（ALP_SECRET_KEY），无法代为调用模型。请管理员配置后再用服务端模式。";
    case "SECRET_UNREADABLE":
      return "保存的模型密钥无法解密，请到「设置」重新保存模型配置。";
    case "KEY_KID_UNKNOWN":
      return "保存的密钥使用了未知的密钥版本，请重新保存模型配置。";
    case "CONFIG_INVALID":
      return "保存的模型配置不完整，请到「设置」重新保存。";
  }
}

function safeDetail(text: string, secret: RedactSecret): string {
  const trimmed = text.trim();
  if (trimmed === "") return "上游拒绝了这次请求";
  return redactSecrets(trimmed.slice(0, 500), secret);
}

interface ReplyExtraction {
  readonly text: string;
  readonly toolCalls: readonly { readonly id: string; readonly name: string; readonly arguments: string }[];
}

/**
 * 从严解析上游回复。
 *
 * 只接受本实现真正会用的字段：OpenAI 兼容取 choices[0].message，Anthropic 取
 * content 里的 text block。工具调用名必须满足函数名字符集（上游不会给非法名字，
 * 但代理层可能；一个非法名字会让下一轮请求被 400）。
 */
function extractReply(kind: LlmConfig["api"], json: unknown): ReplyExtraction {
  if (typeof json !== "object" || json === null) return { text: "", toolCalls: [] };
  const record = json as Record<string, unknown>;

  if (kind === "anthropic") {
    const blocks = Array.isArray(record.content) ? record.content : [];
    const text = blocks
      .map((block) =>
        typeof block === "object" && block !== null
          ? (block as Record<string, unknown>).type === "text"
            ? String((block as Record<string, unknown>).text ?? "")
            : ""
          : "",
      )
      .join("");
    return { text: text.trim(), toolCalls: [] };
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = typeof choices[0] === "object" && choices[0] !== null
    ? (choices[0] as Record<string, unknown>)
    : null;
  const message = typeof first?.message === "object" && first.message !== null
    ? (first.message as Record<string, unknown>)
    : null;

  let text = "";
  if (typeof message?.content === "string") {
    text = message.content;
  } else if (Array.isArray(message?.content)) {
    text = message.content
      .map((part) =>
        typeof part === "object" && part !== null &&
        (part as Record<string, unknown>).type === "text"
          ? String((part as Record<string, unknown>).text ?? "")
          : "",
      )
      .join("");
  }

  const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls: { id: string; name: string; arguments: string }[] = [];
  for (const entry of rawCalls) {
    if (typeof entry !== "object" || entry === null) continue;
    const call = entry as Record<string, unknown>;
    const fn = typeof call.function === "object" && call.function !== null
      ? (call.function as Record<string, unknown>)
      : null;
    const name = typeof fn?.name === "string" ? fn.name : "";
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(name)) continue;
    const args =
      typeof fn?.arguments === "string"
        ? fn.arguments
        : fn?.arguments === undefined
          ? ""
          : JSON.stringify(fn.arguments);
    toolCalls.push({
      id: typeof call.id === "string" ? call.id : "",
      name,
      arguments: args,
    });
  }

  return { text: text.trim(), toolCalls };
}

// ── SSE ───────────────────────────────────────────────────────────

/**
 * 把一段异步工作包成 SSE 响应。
 *
 * done 的兜底放在这里：即使 runAgent 之外抛错（配置读取、DNS 失败），也必须
 * 给前端一个 done，否则界面永远停在「思考中」。
 */
function sseResponse(
  work: (emit: (event: AgentEvent) => void, signal: AbortSignal) => Promise<void>,
  requestSignal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onAbort = (): void => abort.abort();
  requestSignal.addEventListener("abort", onAbort, { once: true });
  // 请求在创建流之前就已经断开时，不会再触发 abort 事件，必须显式同步一次。
  if (requestSignal.aborted) abort.abort();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const emit = (event: AgentEvent): void => write(agentEventToSse(event));
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);

      try {
        await work(emit, abort.signal);
      } catch (err) {
        emit({
          type: "notice",
          level: "warn",
          message: `Agent 运行失败：${err instanceof Error ? err.message : String(err)}`,
        });
        emit({
          type: "done",
          stopReason: "error",
          steps: 0,
          toolCalls: 0,
          elapsedMs: 0,
          textChars: 0,
        });
      } finally {
        clearInterval(heartbeat);
        requestSignal.removeEventListener("abort", onAbort);
        closed = true;
        try {
          controller.close();
        } catch {
          // 已经关闭（客户端断开）时 close 会抛；忽略。
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

// ── 路由 ──────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const crossSite = assertMutationOrigin(request);
  if (crossSite) return crossSite;

  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return jsonError(415, apiErrorCodes.badRequest, "请求体必须是 application/json");
  }

  const limited = await readLimitedText(request, AGENT_REQUEST_MAX_BYTES);
  if (!limited.ok) return limited.response;

  const raw = parseJsonObject(limited.text);
  if (raw === null) {
    return jsonError(400, apiErrorCodes.badRequest, "请求体不是合法 JSON 对象");
  }

  const parsed = agentRequest.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}：` : "";
    return jsonError(400, apiErrorCodes.badRequest, `${where}${issue?.message ?? "请求体不符合契约"}`);
  }
  const body = parsed.data;

  let config: LlmConfig;
  try {
    config = await loadLlmConfigForUser(auth.user.id);
  } catch (err) {
    if (isLlmConfigError(err)) {
      // local 模式：仍然用 SSE 回一条明确的 notice + done，客户端据此显示「切服务端模式」。
      const message = localModeMessage(err.code);
      return sseResponse(async (emit) => {
        emit({ type: "notice", level: "warn", message });
        emit({
          type: "done",
          stopReason: "error",
          steps: 0,
          toolCalls: 0,
          elapsedMs: 0,
          textChars: 0,
        });
      }, request.signal);
    }
    return jsonError(500, apiErrorCodes.internal, "读取模型配置失败");
  }

  const limits = parseAgentLimits();
  const notices: AgentEvent[] = [];
  let learningContext;
  try {
    learningContext = await loadLearningContext(await getDb(), auth.user.id, body.directionId ?? body.subject, body.question, body.materialSourceIds);
  } catch (error) {
    return jsonError(error instanceof LearningContextError ? error.status : 500, apiErrorCodes.badRequest,
      error instanceof LearningContextError ? error.message : "读取学习上下文失败");
  }

  // 当前适配器未实现 Anthropic 工具消息；确定性工作流仍然可用。
  const toolsSupported = config.api !== "anthropic";
  const localTools = learningAgentTools();
  if (learningContext.uploadScanLimited) notices.push({ type: "notice", level: "warn", message: "本方向资料较多，本轮 Agent 只检索前 2000 段。可改用普通导师检索其他资料。" });
  const remoteSpecs: AgentToolSpec[] = [];
  const remoteCalls = new Map<string, RemoteCall>();
  const remoteServers: { serverId: string; label: string }[] = [];

  if (!toolsSupported) {
    notices.push({
      type: "notice",
      level: "warn",
      message: "当前供应商（Anthropic 适配器）未启用工具调用，教学工作流使用服务端预载结果。",
    });
  } else {
    let servers: PublicMcpServer[];
    try {
      const db = await getDb();
      servers = await listMcpServers(db, auth.user.id);
    } catch {
      servers = [];
      notices.push({
        type: "notice",
        level: "warn",
        message: "读取 MCP 服务器配置失败，本次只用本地只读工具。",
      });
    }

    const enabled = servers.filter((server) => server.enabled).slice(0, MAX_ENABLED_SERVERS);
    const discoveryStarted = Date.now();
    for (const server of enabled) {
      if (Date.now() - discoveryStarted > MAX_DISCOVERY_MS) {
        notices.push({
          type: "notice",
          level: "info",
          message: "MCP 工具发现超时，其余服务器本次未加载。",
        });
        break;
      }
      if (localTools.length + remoteSpecs.length >= MAX_AGENT_TOOLS) {
        notices.push({
          type: "notice",
          level: "info",
          message: `工具数量已达上限（${MAX_AGENT_TOOLS}），其余 MCP 服务器本次未加载。`,
        });
        break;
      }

      try {
        const db = await getDb();
        const headers = await readMcpAuthHeaders(db, auth.user.id, server.serverId);
        const client = new McpClient(
          { serverId: server.serverId, url: server.url, headers },
          { timeoutMs: limits.toolTimeoutMs, signal: request.signal },
        );

        const listing = await client.listTools();
        // 三层白名单：代码只读集合（readOnly）∩ 用户勾选 ∩ tools/list。
        const allowed = filterRemoteTools({
          listed: listing.tools,
          allowed: server.allowedTools,
        });

        let loaded = 0;
        for (const tool of allowed) {
          if (localTools.length + remoteSpecs.length >= MAX_AGENT_TOOLS) break;
          let fullName: string;
          try {
            fullName = mcpToolName(server.serverId, tool.name);
          } catch {
            // 命名空间超长或字符集不合法：跳过而不是截断（截断会让两个工具撞名）。
            continue;
          }
          const parameters =
            tool.inputSchema !== undefined &&
            JSON.stringify(tool.inputSchema).length <= MAX_TOOL_SCHEMA_CHARS
              ? tool.inputSchema
              : undefined;
          remoteSpecs.push(
            remoteAgentToolSpec({
              serverId: server.serverId,
              name: fullName,
              ...(tool.description === undefined ? {} : { description: tool.description }),
              ...(parameters === undefined ? {} : { parameters }),
            }),
          );
          remoteCalls.set(fullName, { client, rawName: tool.name });
          loaded += 1;
        }

        if (loaded > 0) remoteServers.push({ serverId: server.serverId, label: server.label });
      } catch (err) {
        notices.push({
          type: "notice",
          level: "warn",
          message: `MCP 服务器「${server.label}」不可用：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  const toolset: AgentToolSpec[] = toolsSupported ? [...localTools, ...remoteSpecs] : [];
  const materialTexts = new Set<string>();
  const materialSources = new Set<string>();
  const db = await getDb();
  let archive: Awaited<ReturnType<typeof claimConversationAgent>> | null = null;
  if (body.conversationId && body.assistantMessageId) {
    try {
      archive = await claimConversationAgent(db, auth.user.id, body.conversationId, body.assistantMessageId, learningContext.course.id);
      body.question = buildTutorQuestion(archive.question.content.text,archive.question.content.attachments.length);
      body.images = archive.question.content.attachments.map(image => image.dataUrl);
      learningContext = await loadLearningContext(db, auth.user.id, learningContext.course.id, body.question, body.materialSourceIds);
    } catch (error) {
      return jsonError(error instanceof ConversationError ? error.status : 500, apiErrorCodes.badRequest,
        error instanceof ConversationError ? error.message : "读取完整会话失败，本轮未开始。");
    }
  }
  const previous = archive ? { revision: null, session: archive.previous ? { version: 1 as const, snapshot: archive.previous, turns: archive.turns } : null }
    : await readLearningSession(db, auth.user.id, learningContext.course.id).catch(() => {
    notices.push({ type: "notice", level: "warn", message: "读取教学会话失败，本轮不携带历史；存档冲突时不会覆盖旧会话。" });
    return { revision: null, session: null };
  });
  if (!body.resetSession && /^(继续|再|那|它|这个|这道|上面|刚才|没懂|还是|换一)/u.test(body.question) && previous.session?.snapshot.focusName &&
      learningContext.course.graph.concepts.some(c => c.id === previous.session!.snapshot.focusKcId)) {
    learningContext = await loadLearningContext(db, auth.user.id, learningContext.course.id,
      `${previous.session.snapshot.focusName} ${body.question}`, body.materialSourceIds);
  }
  const documentIds=archive ? archive.question.content.documents.map(d=>d.id) : body.documentIds??[];
  try {
    const occupied=estimateTokens(body.question)+(previous.session?.turns.reduce((n,t)=>n+estimateTokens(t.question)+estimateTokens(t.answer),0)??0);
    const retrieval=documentIds.length ? await retrieveDocuments(db,auth.user.id,learningContext.course.id,`${previous.session?.snapshot.focusName??""} ${body.question}`,documentIds,config.options,occupied) : budgetUploadHits(learningContext.uploadHits,config.options,occupied);
    const uploadNotice="notice" in retrieval?String(retrieval.notice):undefined;
    if(uploadNotice)notices.push({type:"notice",level:"info",message:uploadNotice});
    learningContext={...learningContext,uploadNotice,uploadHits:retrieval.hits,uploads:retrieval.hits.map(({chunk},i)=>({kcId:`资料${i+1}`,docId:chunk.docId,title:chunk.title,text:chunk.text,...(chunk.pageFrom?{pageFrom:chunk.pageFrom}:{})}))};
    const intent=routeTeachingTask(body,previous.session?.snapshot).intent;
    if(intent==="review_path"||intent==="practice")learningContext={...learningContext,timeEstimation:await estimateLearningTime(db,auth.user.id,learningContext,config,request.signal)};
  } catch {
    notices.push({type:"notice",level:"warn",message:"附件检索或模型时长估算暂时不可用，本轮仅使用已确认资料与规则时长。"});
    if(documentIds.length)learningContext={...learningContext,uploadHits:[],uploads:[]};
  }
  const task = prepareTeachingTask(learningContext, body, previous.session);
  if (archive && !body.resetSession) {
    task.history = archive.turns;
    task.snapshot.resumedTurns = archive.turns.length;
  }
  for (const result of task.initialToolResults) {
    if (result.name !== "search_knowledge") continue;
    const data = JSON.parse(result.text) as { material?: string; materialSources?: string[] };
    if (data.material) materialTexts.add(data.material);
    for (const source of data.materialSources ?? []) materialSources.add(source);
  }
  const executeLearningTool = (name: string, args: Record<string, unknown>): string => {
    const text = callLearningTool(learningContext, name, args, task.snapshot.budgetMinutes);
    if (name === "search_knowledge") {
      const result = JSON.parse(text) as { material?: string; materialSources?: string[] };
      if (result.material) materialTexts.add(result.material);
      for (const source of result.materialSources ?? []) materialSources.add(source);
    }
    return text;
  };
  const systemPrompt = tutorSystemPrompt({ tone: body.tone }) + "\n" + buildAgentSystemPrompt({
    ...(body.subject === undefined ? {} : { subject: body.subject }),
    ...(body.budgetMinutes === undefined ? {} : { budgetMinutes: body.budgetMinutes }),
    tools: toolset,
    remoteServers,
  }) + `\n当前学习目标：${learningContext.course.name}（${learningContext.course.id}）。所有本地工具已绑定该目标与当前账号。` +
    "\n无作答记录表示尚未观测，不得称为薄弱；少量记录只能称证据不足。先调用 get_learner_state，涉及课程问题再调用 search_knowledge；不要编造学生表现。" +
    "\n" + tutoringPolicy(body.helpLevel ?? "explain");

  const secret: RedactSecret = {
    apiKey: config.payload.apiKey,
    extraHeaders: config.options.extraHeaders,
    ...(config.payload.embeddingApiKey === undefined
      ? {}
      : { embeddingApiKey: config.payload.embeddingApiKey }),
  };
  const headers = buildHeaders(config);
  const endpoint = endpointFor(config.api, config.options.baseUrl);

  return sseResponse(async (send, signal) => {
    const recorder = archive && body.conversationId && body.assistantMessageId
      ? conversationRecorder(db, auth.user.id, body.conversationId, body.assistantMessageId, archive.token, learningContext.course.graph.concepts) : null;
    const emit = (event: AgentEvent) => { recorder?.record(event); send(event); };
    let completed = false;
    try {
    for (const notice of notices) emit(notice);

    let target: AllowedTarget;
    try {
      target = await assertUpstreamAllowed(endpoint);
    } catch {
      emit({ type: "notice", level: "warn", message: "上游模型地址不被允许或无法解析。" });
      emit({
        type: "done",
        stopReason: "error",
        steps: 0,
        toolCalls: 0,
        elapsedMs: 0,
        textChars: 0,
      });
      return;
    }

    const callModel = async (
      req: AgentModelRequest,
      modelSignal: AbortSignal,
    ): Promise<AgentModelReply> => {
      const requestBody = buildUpstreamChatBody(
        config.api,
        config.options.model,
        {
          messages: toUpstreamMessages(req.messages),
          stream: false,
          maxTokens: Math.min(MAX_AGENT_TOKENS,contextBudget(config.options).response),
          jsonMode: false,
          ...(req.tools.length > 0
            ? { tools: toChatTools(req.tools), toolChoice: "auto" as const }
            : {}),
        },
        contextBudget(config.options).thinking,
      );

      let response;
      try {
        response = await guardedRequest(target, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          timeoutMs: req.timeoutMs,
          maxBytes: MAX_MODEL_RESPONSE_BYTES,
          signal: modelSignal,
        });
      } catch (err) {
        if (isUpstreamRequestError(err)) {
          throw new Error(
            err.reason === "timeout" ? "上游模型响应超时" : `上游请求失败：${err.reason}`,
          );
        }
        throw err;
      }

      const text = response.body.toString("utf8");
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `上游返回 HTTP ${response.status}：${safeDetail(text, secret)}`,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("上游返回的不是 JSON");
      }

      const finishReason =
        typeof json === "object" && json !== null
          ? (json as Record<string, unknown>).stop_reason ??
            ((json as Record<string, unknown>).choices as { finish_reason?: unknown }[] | undefined)?.[0]
              ?.finish_reason
          : undefined;
      if (finishReason === "length" || finishReason === "max_tokens") {
        throw new Error("模型输出被截断（达到 max_tokens）");
      }

      const reply = extractReply(config.api, json);
      if (reply.text === "" && reply.toolCalls.length === 0) {
        throw new Error("模型返回空内容");
      }
      return { text: reply.text, toolCalls: reply.toolCalls };
    };

    const callTool = async (
      call: { readonly id: string; readonly name: string; readonly arguments: string },
      spec: AgentToolSpec,
      toolSignal: AbortSignal,
    ): Promise<{ readonly ok: boolean; readonly text: string }> => {
      const args = parseToolArguments(call.arguments);
      if (!args.ok) return { ok: false, text: args.message };

      if (spec.serverId === null) {
        if (!isReadOnlyToolName(call.name)) {
          return { ok: false, text: `未知工具：${call.name}` };
        }
        try {
          return { ok: true, text: executeLearningTool(call.name, args.value) };
        } catch (err) {
          return { ok: false, text: err instanceof Error ? err.message : String(err) };
        }
      }

      const remote = remoteCalls.get(spec.name);
      if (remote === undefined) return { ok: false, text: `未知的远程工具：${call.name}` };
      const result = await remote.client.callTool(remote.rawName, args.value, {
        signal: toolSignal,
      });
      return { ok: result.ok, text: result.text };
    };

    await runTeachingWorkflow({
      task,
      context: learningContext,
      checkpoint: (snapshot, text) => recorder ? recorder.save("complete", { workflow: snapshot, text }) : saveLearningSession(db, auth.user.id, learningContext.course.id, previous.revision, {
        version: 1, snapshot,
        turns: [...task.history, { question: body.question.slice(0, 1000), answer: text.slice(0, 1500) }].slice(-4),
      }),
      runner: {
        question: body.question,
        ...(body.images === undefined ? {} : { images: body.images }),
        systemPrompt,
        tools: toolset,
        limits,
        callModel,
        callTool,
        signal,
      },
      emit: (event) => emit(event.type === "done" ? { ...event, uploads: learningContext.uploadHits,
        materialContext: [...materialTexts].join("\n\n"), materialSources: [...materialSources] } : event),
    });
    completed = task.snapshot.status === "complete" || task.snapshot.status === "awaiting_answer";
    } finally {
      if (recorder) {
        const saved = await recorder.save(completed ? "complete" : "interrupted").catch(() => false);
        if (!saved && !signal.aborted) send({ type: "notice", level: "warn", message: "完整会话保存失败或生成已被停止，请重新载入确认记录。" });
      }
    }
  }, request.signal);
}
