/**
 * MCP Streamable HTTP 客户端对真实 HTTP 服务器的行为。
 *
 * 用 node:http 起一个假 MCP 服务器（只在本机回环上），覆盖：
 * - initialize → notifications/initialized → tools/list → tools/call 的会话链路；
 * - Accept 双类型、Mcp-Session-Id 与 MCP-Protocol-Version 透传；
 * - JSON 与 SSE 两种响应都能读；
 * - 会话 404 只重新 initialize 一次；
 * - 工具名命名空间与非法工具名过滤；
 * - 超时后补发 notifications/cancelled。
 *
 * 不联网：地址是 127.0.0.1，靠 ALP_ALLOW_HTTP_PROVIDER_HOSTS 显式放行。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  McpClient,
  McpClientError,
  mcpToolName,
  parseMcpToolName,
  parseSseJsonMessages,
} from "@/lib/mcpClient";

interface RecordedRequest {
  readonly method: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: Record<string, unknown>;
}

interface FakeState {
  session: string;
  requests: RecordedRequest[];
  sseList: boolean;
  tools: unknown[];
  expireNextToolCall: boolean;
  slowDelayMs: number;
}

const state: FakeState = {
  session: "s1",
  requests: [],
  sseList: true,
  tools: [],
  expireNextToolCall: false,
  slowDelayMs: 80,
};

let server: Server;
let baseUrl = "";

function defaultTools(): unknown[] {
  return [
    { name: "echo", description: "回显参数", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "write", description: "写东西", annotations: { readOnlyHint: false } },
    {
      name: "destroy",
      description: "危险操作",
      annotations: { readOnlyHint: true, destructiveHint: true },
    },
    { name: "bad name!", description: "非法名字" },
  ];
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  if (res.writableEnded) return;
  res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(payload));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: "bad json" });
    return;
  }

  const method = typeof message.method === "string" ? message.method : "";
  state.requests.push({ method, headers: req.headers, body: message });

  // 通知（没有 id）：规范要求 202，且不应有响应体。
  if (message.id === undefined) {
    res.writeHead(202).end();
    return;
  }

  if (method === "initialize") {
    const params = (message.params ?? {}) as Record<string, unknown>;
    sendJson(
      res,
      200,
      {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: params.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-mcp", version: "1.0.0" },
        },
      },
      { "mcp-session-id": state.session },
    );
    return;
  }

  // 会话校验：头里没有当前 session 就当会话失效。
  if (req.headers["mcp-session-id"] !== state.session) {
    sendJson(res, 404, { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "session expired" } });
    return;
  }

  if (method === "tools/list") {
    const result = { jsonrpc: "2.0", id: message.id, result: { tools: state.tools } };
    if (!state.sseList) {
      sendJson(res, 200, result);
      return;
    }
    // SSE 里先塞一条通知（无 id），确认客户端按 id 取结果而不是取第一条。
    const payload =
      `data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info"}}\n\n` +
      `data: ${JSON.stringify(result)}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(payload);
    return;
  }

  if (method === "tools/call") {
    if (state.expireNextToolCall) {
      state.expireNextToolCall = false;
      state.session = "s2";
      sendJson(res, 404, { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "session expired" } });
      return;
    }

    const params = (message.params ?? {}) as Record<string, unknown>;
    const name = typeof params.name === "string" ? params.name : "";

    if (name === "slow") {
      setTimeout(() => {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: "慢但成功" }] },
        });
      }, state.slowDelayMs);
      return;
    }

    if (name === "broken") {
      sendJson(res, 200, {
        jsonrpc: "2.0",
        id: message.id,
        result: { content: [{ type: "text", text: "工具内部错误" }], isError: true },
      });
      return;
    }

    sendJson(res, 200, {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          { type: "text", text: JSON.stringify(params.arguments ?? {}) },
          { type: "image", data: "ignored" },
        ],
      },
    });
    return;
  }

  sendJson(res, 200, {
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.writableEnded) res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("假 MCP 服务器没有端口");
  baseUrl = `http://127.0.0.1:${address.port}/mcp`;
  process.env.ALP_ALLOW_HTTP_PROVIDER_HOSTS = `127.0.0.1:${address.port}`;
});

afterAll(async () => {
  delete process.env.ALP_ALLOW_HTTP_PROVIDER_HOSTS;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
});

beforeEach(() => {
  state.session = "s1";
  state.requests = [];
  state.sseList = true;
  state.tools = defaultTools();
  state.expireNextToolCall = false;
  state.slowDelayMs = 80;
});

function client(options: { timeoutMs?: number; headers?: Record<string, string> } = {}): McpClient {
  return new McpClient(
    { serverId: "srv", url: baseUrl, ...(options.headers === undefined ? {} : { headers: options.headers }) },
    { timeoutMs: options.timeoutMs ?? 1_000 },
  );
}

describe("McpClient：握手、会话与双读", () => {
  it("initialize → 通知 → SSE tools/list → JSON tools/call", async () => {
    const mcp = client({ headers: { authorization: "Bearer fake-token" } });

    const listing = await mcp.listTools();
    expect(listing.tools.map((tool) => tool.name)).toEqual(["echo", "write", "destroy"]);
    expect(listing.tools.find((tool) => tool.name === "echo")?.readOnly).toBe(true);
    expect(listing.tools.find((tool) => tool.name === "write")?.readOnly).toBe(false);
    expect(listing.rejected).toEqual([{ name: "bad name!", reason: "invalid-name" }]);

    const call = await mcp.callTool("echo", { text: "hi" });
    expect(call.ok).toBe(true);
    expect(call.text).toContain("hi");
    // 非文本块被占位，而不是让整段文本消失。
    expect(call.text).toContain("已省略");

    const methods = state.requests.map((entry) => entry.method);
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);

    const initialize = state.requests[0];
    expect(initialize.headers.accept).toContain("application/json");
    expect(initialize.headers.accept).toContain("text/event-stream");
    expect(initialize.headers["mcp-protocol-version"]).toBe("2025-06-18");
    expect(initialize.headers["mcp-session-id"]).toBeUndefined();
    expect(initialize.headers.authorization).toBe("Bearer fake-token");

    for (const entry of state.requests) {
      expect(entry.headers["mcp-protocol-version"], entry.method).toBe("2025-06-18");
    }
    for (const entry of state.requests.slice(1)) {
      expect(entry.headers["mcp-session-id"], entry.method).toBe("s1");
    }
    expect(mcp.session).toBe("s1");
  });

  it("tools/list 返回纯 JSON 时同样可读", async () => {
    state.sseList = false;
    const mcp = client();
    const listing = await mcp.listTools();
    expect(listing.tools).toHaveLength(3);
  });

  it("isError 的结果是 ok=false 但文本保留", async () => {
    const mcp = client();
    const call = await mcp.callTool("broken", {});
    expect(call).toEqual({ ok: false, text: "工具内部错误" });
  });
});

describe("McpClient：404 重新协商", () => {
  it("会话失效后重新 initialize 一次并重试原请求", async () => {
    const mcp = client();
    await mcp.listTools();
    state.expireNextToolCall = true;

    const call = await mcp.callTool("echo", { round: 2 });
    expect(call.ok).toBe(true);

    const initializes = state.requests.filter((entry) => entry.method === "initialize");
    const toolCalls = state.requests.filter((entry) => entry.method === "tools/call");
    expect(initializes).toHaveLength(2);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].headers["mcp-session-id"]).toBe("s1");
    expect(toolCalls[1].headers["mcp-session-id"]).toBe("s2");
    expect(mcp.session).toBe("s2");
  });
});

describe("McpClient：超时与取消通知", () => {
  it("超时抛 timeout，并补发 notifications/cancelled", async () => {
    const mcp = client({ timeoutMs: 30 });
    await expect(mcp.callTool("slow", {})).rejects.toMatchObject({
      name: "McpClientError",
      code: "timeout",
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    const cancelled = state.requests.find((entry) => entry.method === "notifications/cancelled");
    expect(cancelled).toBeDefined();
    expect(JSON.stringify(cancelled?.body.params)).toContain("timeout");
  });
});

describe("McpClient：命名空间", () => {
  it("拼出并校验 mcp__server__tool", () => {
    expect(mcpToolName("srv", "echo")).toBe("mcp__srv__echo");
    expect(() => mcpToolName("bad id", "echo")).toThrow(McpClientError);
    expect(() => mcpToolName("srv", "bad name")).toThrow(McpClientError);
    expect(() => mcpToolName("s".repeat(32), "t".repeat(48))).toThrow(/64/u);
    expect(parseMcpToolName("mcp__srv__echo")).toEqual({ serverId: "srv", tool: "echo" });
    expect(parseMcpToolName("list_subjects")).toBeNull();
    expect(parseMcpToolName("mcp__srv")).toBeNull();
  });

  it("SSE 解析只取 data 行、容忍注释与多行 data", () => {
    const messages = parseSseJsonMessages(
      [
        ": keep-alive",
        "event: message",
        'data: {"id":1,"result":{"ok":true}}',
        "",
        'data: {"id":2,',
        'data: "result":3}',
        "",
      ].join("\n"),
    );
    expect(messages).toEqual([
      { id: 1, result: { ok: true } },
      { id: 2, result: 3 },
    ]);
  });
});
