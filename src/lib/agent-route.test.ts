/**
 * /api/agent 路由：鉴权、同源、请求体限制、SSE 事件序列、local/Anthropic 降级。
 *
 * 只替换两处外部依赖：
 * - getCurrentUser（不加载 next/headers 与 cookie）；
 * - ssrfGuard 的 assertUpstreamAllowed / guardedRequest（假上游，绝不联网）。
 * 其余（DB、内存表、密钥、工具、循环）都用真实实现。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/rateLimit";
import { randomUUID } from "node:crypto";
import { appendConversationTurn, branchConversation, createConversation, getArchivedMessage, readConversationPage } from "./conversationStore";

const authState = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; displayName: string; createdAt: string },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => authState.user,
}));

interface UpstreamRequest {
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

interface UpstreamReply {
  readonly status?: number;
  readonly payload: unknown;
}

const upstream = vi.hoisted(() => ({
  requests: [] as UpstreamRequest[],
  replies: [] as UpstreamReply[],
  mcpHost: "9.9.9.9",
  mcpStatus: 500,
}));

vi.mock("@/lib/ssrfGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ssrfGuard")>();
  return {
    ...actual,
    assertUpstreamAllowed: async (raw: string) => {
      const url = new URL(raw);
      return { url, hostname: url.hostname, pinned: "8.8.8.8", servername: url.hostname };
    },
    guardedRequest: async (target: { url: URL }, options: { headers?: Record<string, string>; body?: string }) => {
      if (target.url.hostname === upstream.mcpHost) {
        return {
          status: upstream.mcpStatus,
          headers: {},
          body: Buffer.from(JSON.stringify({ error: "mcp down" })),
        };
      }
      upstream.requests.push({
        headers: options.headers ?? {},
        body: JSON.parse(String(options.body ?? "{}")) as Record<string, unknown>,
      });
      const next = upstream.replies.shift() ?? { payload: { choices: [{ message: { content: "默认回答" } }] } };
      return {
        status: next.status ?? 200,
        headers: {},
        body: Buffer.from(JSON.stringify(next.payload)),
      };
    },
  };
});

const { POST } = await import("../../app/api/agent/route");
const { POST: answer } = await import("../../app/api/agent/answer/route");
const { GET: session } = await import("../../app/api/agent/session/route");
const { __resetMemoryDbForTests, __setDbBackendForTests, getDb } = await import("@/lib/db");
const { saveUserSecret } = await import("@/lib/userSecrets");
const { saveMcpServer } = await import("@/lib/mcpStore");
const { READ_ONLY_TOOL_NAMES } = await import("@/lib/tools");
const { TOOL_RESULT_GUARD } = await import("@/lib/agent");
const { AGENT_REQUEST_MAX_BYTES } = await import("@/lib/agentContracts");

type AgentEventRecord = { type: string; [key: string]: unknown };

const USER = {
  id: "agent-user",
  email: "agent@test.local",
  displayName: "Agent 用户",
  createdAt: "2026-10-30T00:00:00.000Z",
};

const MASTER_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString("base64");
const API_KEY = "fake-agent-5678";
const BASE_URL = "https://8.8.8.8/v1";

function setEnv(): void {
  delete process.env.DATABASE_URL;
  process.env.ALP_SECRET_KEY = MASTER_KEY;
  process.env.ALP_ALLOW_MEMORY_SECRETS = "1";
  delete process.env.ALP_SECRET_KEY_ID;
  delete process.env.ALP_ALLOW_HTTP_PROVIDER_HOSTS;
  for (const key of [
    "ALP_AGENT_MAX_STEPS",
    "ALP_AGENT_MAX_PARALLEL_TOOLS",
    "ALP_AGENT_TOOL_TIMEOUT_MS",
    "ALP_AGENT_MAX_RESULT_CHARS",
    "ALP_AGENT_BUDGET_MS",
    "ALP_AGENT_MODEL_TIMEOUT_MS",
  ]) {
    delete process.env[key];
  }
}

beforeEach(() => {
  authState.user = USER;
  setEnv();
  __resetMemoryDbForTests();
  __setDbBackendForTests(null);
  upstream.requests = [];
  upstream.replies = [];
  upstream.mcpStatus = 500;
});

async function saveLlm(kind: "openai-compatible" | "anthropic" = "openai-compatible"): Promise<void> {
  const db = await getDb();
  await saveUserSecret(db, USER.id, {
    kind: "llm",
    api: kind,
    baseUrl: BASE_URL,
    model: "fake-model",
    payload: { apiKey: API_KEY },
  });
}

function postAgent(
  body: unknown,
  options: { origin?: string | null; contentType?: string; raw?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "application/json",
    host: "localhost",
  };
  if (options.origin !== null) headers.origin = options.origin ?? "http://localhost";
  return POST(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers,
      body: options.raw ?? JSON.stringify(body),
    }),
  );
}

/** 把 SSE 正文解析成事件数组；心跳注释行（: ping）被跳过。 */
function parseEvents(text: string): AgentEventRecord[] {
  const events: AgentEventRecord[] = [];
  for (const block of text.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed.startsWith("data:")) continue;
    events.push(JSON.parse(trimmed.slice("data:".length).trim()) as AgentEventRecord);
  }
  return events;
}

function doneOf(events: readonly AgentEventRecord[]): AgentEventRecord {
  const dones = events.filter((event) => event.type === "done");
  expect(dones).toHaveLength(1);
  return dones[0];
}

function openAiToolCall(name: string, args: Record<string, unknown>, id = "call_1"): unknown {
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

function openAiText(text: string): unknown {
  return { choices: [{ finish_reason: "stop", message: { content: text } }] };
}

beforeEach(() => {
  resetRateLimits();
});

describe("/api/agent：守卫", () => {
  it("未登录 401", async () => {
    authState.user = null;
    const res = await postAgent({ question: "你好" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("跨站 Origin 403", async () => {
    await saveLlm();
    const res = await postAgent({ question: "你好" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("非 JSON Content-Type 415", async () => {
    await saveLlm();
    const res = await postAgent({ question: "你好" }, { contentType: "text/plain" });
    expect(res.status).toBe(415);
  });

  it("非法请求体 400（缺 question / 未知字段 / 非 data: 图片）", async () => {
    await saveLlm();
    const cases: unknown[] = [
      {},
      { question: "你好", model: "evil" },
      { question: "你好", images: ["https://example.com/x.png"] },
      { question: "你好", subject: "not-a-subject" },
    ];
    for (const body of cases) {
      const res = await postAgent(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("请求体超过上限 413", async () => {
    await saveLlm();
    const oversized = JSON.stringify({ question: "x".repeat(AGENT_REQUEST_MAX_BYTES + 16) });
    const res = await postAgent(null, { raw: oversized });
    expect(res.status).toBe(413);
  });
});

describe("/api/agent：SSE 主路径", () => {
  it("教学状态 → 工具循环 → 规则核验 → 检查点 → done", async () => {
    await saveLlm();
    upstream.replies = [
      { payload: openAiToolCall("list_subjects", {}) },
      { payload: openAiText("共有 9 个学科。") },
    ];

    const res = await postAgent({ question: "有哪些学科？", subject: "os", budgetMinutes: 90 });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = parseEvents(await res.text());
    expect(events.filter(e => e.type !== "workflow").map((event) => event.type)).toEqual(["tool_call", "tool_result", "text", "done"]);
    expect(events.find(e => e.type === "tool_call")).toMatchObject({ type: "tool_call", name: "list_subjects", serverId: null });
    expect(doneOf(events).workflow).toMatchObject({ version: "learning-workflow-v1", intent: "explain", status: "complete", persisted: true });
    expect(doneOf(events)).toMatchObject({ stopReason: "stop", steps: 2, toolCalls: 1 });

    // 第一轮：工具集是 5 个本地只读工具，system 里带学科与预算。
    const first = upstream.requests[0];
    const tools = first.body.tools as { function: { name: string } }[];
    expect(tools.map((tool) => tool.function.name)).toEqual([...READ_ONLY_TOOL_NAMES.filter(n => n !== "plan_path"),"estimate_learning_time"]);
    const messages = first.body.messages as { role: string; content: unknown }[];
    expect(messages[0].role).toBe("system");
    expect(String(messages[0].content)).toContain("os");
    expect(String(messages[0].content)).toContain("90");
    expect(messages.find((message) => message.role === "user")).toMatchObject({ role: "user", content: "有哪些学科？" });
    expect(messages.some((message) => message.role === "tool" && String(message.content).includes("server-validated-attempts"))).toBe(true);

    // 第二轮：工具结果以界符隔离回灌，且带 tool_call_id。
    const second = upstream.requests[1];
    const returned = (second.body.messages as { role: string; content: string; tool_call_id?: string }[])
      .find((message) => message.role === "tool" && message.tool_call_id === "call_1");
    expect(returned?.tool_call_id).toBe("call_1");
    expect(returned?.content).toContain(TOOL_RESULT_GUARD);
  });

  it("图片以 content parts 形式发给上游", async () => {
    await saveLlm();
    upstream.replies = [{ payload: openAiText("图里是一道题。") }];

    const image = "data:image/png;base64,iVBORw0KGgo=";
    const res = await postAgent({ question: "这道题怎么做？", images: [image] });

    expect(res.status).toBe(200);
    await res.text();
    const messages = upstream.requests[0].body.messages as {
      role: string;
      content: string | { type: string; image_url?: { url: string } }[];
    }[];
    const user = messages.find((message) => (message as { role?: string }).role === "user")!;
    expect(Array.isArray(user.content)).toBe(true);
    const parts = user.content as { type: string; image_url?: { url: string } }[];
    expect(parts[0]).toMatchObject({ type: "text", text: "这道题怎么做？" });
    expect(parts[1].image_url?.url).toBe(image);
  });
});

describe("/api/agent：降级路径", () => {
  it("local 模式（没有账号模型配置）回 notice + done，不发上游请求", async () => {
    const res = await postAgent({ question: "你好" });
    expect(res.status).toBe(200);

    const events = parseEvents(await res.text());
    expect(events[0]).toMatchObject({ type: "notice", level: "warn" });
    expect(String(events[0].message)).toContain("本地");
    expect(doneOf(events).stopReason).toBe("error");
    expect(upstream.requests).toHaveLength(0);
  });

  it("Anthropic 不发 tools，只发 notice", async () => {
    await saveLlm("anthropic");
    upstream.replies = [
      { payload: { content: [{ type: "text", text: "Anthropic 回答" }], stop_reason: "end_turn" } },
    ];

    const res = await postAgent({ question: "你好" });
    const events = parseEvents(await res.text());

    const notice = events.find((event) => event.type === "notice");
    expect(notice).toBeDefined();
    expect(String(notice?.message)).toContain("未启用工具");
    expect(events.some((event) => event.type === "text")).toBe(true);
    expect(doneOf(events).stopReason).toBe("stop");

    const body = upstream.requests[0].body;
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body.messages)).toContain("server-validated-attempts");
    expect(upstream.requests).toHaveLength(1);
  });

  it("MCP 服务器不可用时给 notice，本地工具仍可完成", async () => {
    await saveLlm();
    const db = await getDb();
    await saveMcpServer(db, USER.id, {
      serverId: "broken-srv",
      label: "坏服务器",
      url: "https://9.9.9.9/mcp",
      allowedTools: ["echo"],
    });
    upstream.replies = [{ payload: openAiText("只用本地工具也能答。") }];

    const res = await postAgent({ question: "你好" });
    const events = parseEvents(await res.text());

    const notice = events.find(
      (event) => event.type === "notice" && String(event.message).includes("MCP 服务器"),
    );
    expect(notice).toBeDefined();
    expect(events.some((event) => event.type === "text")).toBe(true);
    expect(doneOf(events).stopReason).toBe("stop");

    const tools = upstream.requests[0].body.tools as { function: { name: string } }[];
    expect(tools.map((tool) => tool.function.name)).toEqual([...READ_ONLY_TOOL_NAMES.filter(n => n !== "plan_path"),"estimate_learning_time"]);
  });

  it("上游把密钥回显进错误体时，错误消息已脱敏", async () => {
    await saveLlm();
    upstream.replies = [{ status: 401, payload: { error: `bad key ${API_KEY}` } }];

    const res = await postAgent({ question: "你好" });
    const text = await res.text();
    expect(text).not.toContain(API_KEY);
    const events = parseEvents(text);
    expect(doneOf(events).stopReason).toBe("error");
  });
});

describe("teaching workflow HTTP contracts", () => {
  async function archivedTurn(id?: string, revision = 0, question = "讲解栈") {
    const db = await getDb();
    if (!id) await db.run("INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ($1, $2, $3, $4, $5)", [USER.id, USER.email, "hash", USER.displayName, USER.createdAt]);
    const conversation = id ? { id, revision } : await createConversation(db, USER.id, "data-structures");
    return appendConversationTurn(db, USER.id, { conversationId: conversation.id, revision: conversation.revision, user: { id: randomUUID(), content: { text: question } }, assistantId: randomUUID() });
  }

  it("archives the full answer and original sources; a new conversation never inherits another chat", async () => {
    await saveLlm();
    const first = await archivedTurn();
    const longAnswer = "栈的原始讲解 [c09]。".repeat(200);
    upstream.replies = [{ payload: openAiText(longAnswer) }, { payload: openAiText("承接回答") }, { payload: openAiText("新会话回答") }];
    await (await postAgent({ question: "客户端不同的文本", subject: "data-structures", conversationId: first.conversation.id, assistantMessageId: first.assistant.id })).text();
    const db = await getDb();
    const archived = await getArchivedMessage(db, USER.id, first.conversation.id, first.assistant.id);
    expect(archived.content.text).toBe(longAnswer);
    expect(archived.content.materialContext).toBeTruthy();
    expect(archived.content.citations).toContainEqual({ kcId: "c09", title: "栈" });
    const second = await archivedTurn(first.conversation.id, first.conversation.revision, "继续给我提示");
    await (await postAgent({ question: "继续给我提示", conversationId: first.conversation.id, assistantMessageId: second.assistant.id })).text();
    expect(JSON.stringify(upstream.requests[1].body.messages)).toContain(longAnswer.slice(0,100));
    const fresh = await createConversation(db, USER.id, "data-structures");
    const next = await archivedTurn(fresh.id, 0, "讲解队列");
    await (await postAgent({ question: "讲解队列", conversationId: fresh.id, assistantMessageId: next.assistant.id })).text();
    expect(JSON.stringify(upstream.requests[2].body.messages)).not.toContain(longAnswer.slice(0,100));
    expect((await readConversationPage(db, USER.id, first.conversation.id)).messages).toHaveLength(4);
  });

  it("grades the exercise in its original turn after another chat, and preserves the result in a branch", async () => {
    await saveLlm();
    const first = await archivedTurn(undefined, 0, "出一道题");
    const events = parseEvents(await (await postAgent({ question: "出一道题", intent: "practice", conversationId: first.conversation.id, assistantMessageId: first.assistant.id })).text());
    const workflow = doneOf(events).workflow as { runId: string; targetId: string; exercise: { questionId: string } };
    await (await postAgent({ question: "另外一个课程任务" })).text();
    const request = () => new Request("http://localhost/api/agent/answer", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ targetId: workflow.targetId, runId: workflow.runId, questionId: workflow.exercise.questionId, selectedIndex: 0, conversationId: first.conversation.id, messageId: first.assistant.id }) });
    const response = await answer(request());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ evidenceN: 1, duplicate: false });
    expect(await (await answer(request())).json()).toEqual({ ...result, duplicate: true });
    const db = await getDb();
    const fork = await branchConversation(db, USER.id, first.conversation.id, first.assistant.id);
    expect((await getArchivedMessage(db, USER.id, fork.id, first.assistant.id)).proof?.assessment).toEqual(result);
    expect((await getArchivedMessage(db, USER.id, first.conversation.id, first.assistant.id)).proof?.assessment).toEqual(result);
  });

  it("persists history server-side and resets explicitly without losing account learning evidence", async () => {
    await saveLlm();
    upstream.replies = [{ payload: openAiText("第一轮的引导") }, { payload: openAiText("第二轮") }, { payload: openAiText("新任务") }];
    await (await postAgent({ question: "讲解线性表", helpLevel: "explain" })).text();
    const second = parseEvents(await (await postAgent({ question: "继续给我提示" })).text());
    expect(doneOf(second).workflow).toMatchObject({ resumedTurns: 1, intent: "hint", persisted: true });
    expect(JSON.stringify(upstream.requests[1].body.messages)).toContain("第一轮的引导");
    await (await postAgent({ question: "新任务", resetSession: true })).text();
    expect(JSON.stringify(upstream.requests[2].body.messages)).not.toContain("第一轮的引导");
  });

  it("practice -> answer -> fresh path -> recover completed task, no model needed for grading", async () => {
    await saveLlm();
    const events = parseEvents(await (await postAgent({ question: "出一道题", intent: "practice", budgetMinutes: 30 })).text());
    const workflow = doneOf(events).workflow as { runId: string; targetId: string; exercise: { questionId: string } };
    const estimationRequests=upstream.requests.length;
    expect(estimationRequests).toBeGreaterThan(0);
    const makeAnswer = (extra = {}) => new Request("http://localhost/api/agent/answer", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ targetId: workflow.targetId, runId: workflow.runId, questionId: workflow.exercise.questionId, selectedIndex: 0, ...extra }) });
    expect((await answer(makeAnswer({ correct: true }))).status).toBe(400);
    const response = await answer(makeAnswer());
    expect(response.status).toBe(200);
    expect(upstream.requests).toHaveLength(estimationRequests);
    expect(await response.json()).toMatchObject({ evidenceN: 1, workflow: { status: "complete", plan: { totalMinutes: expect.any(Number) } } });
    const recovered = await session(new Request(`http://localhost/api/agent/session?targetId=${workflow.targetId}`));
    expect(await recovered.json()).toMatchObject({ workflow: { runId: workflow.runId, status: "complete" }, assessment: { evidenceN: 1 } });
    authState.user = null;
    expect((await answer(makeAnswer())).status).toBe(401);
    expect((await session(new Request(`http://localhost/api/agent/session?targetId=${workflow.targetId}`))).status).toBe(401);
  });
});
