/**
 * MCP 端点的协议边界：未知学科、版本协商、请求体上限、跨站 Origin、GET 405。
 *
 * 直接 import 路由本身（同 llm-route.test.ts），不起服务、不发真实网络请求：
 * 工具语义与多学科资源由 scripts/mcp-smoke.ts 对运行中的服务验证，
 * 这里只锁定「拒绝路径」与 response 里回显的 subject。
 */

import { describe, expect, it, vi } from "vitest";

/**
 * 路由经由 routeAuth 间接依赖 auth；这里只需要 readLimitedText / jsonError，
 * mock 掉 auth 以免加载 next/headers 与数据库。
 */
vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => null,
}));

const { POST, GET } = await import("../../app/api/mcp/route");

interface RpcBody {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface PostOptions {
  /** 默认 http://localhost；显式传 null 表示不带 Origin 头。 */
  readonly origin?: string | null;
  readonly headers?: Record<string, string>;
  readonly rawBody?: string;
}

function post(body: unknown, options: PostOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: "localhost",
    ...options.headers,
  };
  if (options.origin !== null) headers["origin"] = options.origin ?? "http://localhost";

  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers,
      body: options.rawBody ?? JSON.stringify(body),
    }),
  );
}

function rpc(method: string, params: Record<string, unknown> = {}, id: string | number = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

async function json(response: Response): Promise<RpcBody> {
  return (await response.json()) as RpcBody;
}

/** 取 tools/call 的 content[0].text 并解析成业务负载。 */
function toolPayload<T>(body: RpcBody): T {
  const content = (body.result as { content?: { text?: string }[] } | undefined)?.content;
  return JSON.parse(content?.[0]?.text ?? "{}") as T;
}

describe("MCP：未知学科不再静默回落", () => {
  it("四个带 subject 的工具在未知学科上都返回 -32602", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["get_learner_state", {}],
      ["plan_path", { budgetMinutes: 30 }],
      ["search_knowledge", { query: "进程" }],
      ["get_prerequisites", { kcId: "c01" }],
    ];

    for (const [name, args] of cases) {
      const response = await post(
        rpc("tools/call", {
          name,
          arguments: { ...args, subject: "operating-systems" },
        }),
      );
      const body = await json(response);
      expect(response.status, name).toBe(200);
      expect(body.error?.code, name).toBe(-32602);
      expect(body.error?.message, name).toContain("operating-systems");
      expect(body.result, name).toBeUndefined();
    }
  });

  it("prompts/get 的未知 subject 返回 -32602", async () => {
    const response = await post(
      rpc("prompts/get", {
        name: "review_weak_point",
        arguments: { subject: "operating-systems", kcId: "o01" },
      }),
    );
    const body = await json(response);
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toContain("operating-systems");
    expect(body.result).toBeUndefined();
  });

  it("合法 subject=os 的响应回显 subject.id，首步是 o01", async () => {
    const response = await post(
      rpc("tools/call", {
        name: "plan_path",
        arguments: { subject: "os", budgetMinutes: 120 },
      }),
    );
    const payload = toolPayload<{ subject?: string; steps?: { kcId: string }[] }>(
      await json(response),
    );
    expect(payload.subject).toBe("os");
    expect(payload.steps?.[0]?.kcId).toBe("o01");
  });

  it("prompts/get 用 subject 对应的图谱取知识点名", async () => {
    const response = await post(
      rpc("prompts/get", {
        name: "review_weak_point",
        arguments: { subject: "os", kcId: "o01" },
      }),
    );
    const result = (await json(response)).result as { description?: string };
    expect(result.description).toContain("操作系统的概念与功能");
  });
});

describe("MCP：initialize 版本协商", () => {
  it("支持列表内的版本逐一回显", async () => {
    for (const version of ["2024-11-05", "2025-03-26", "2025-06-18"]) {
      const response = await post(rpc("initialize", { protocolVersion: version }));
      const result = (await json(response)).result as { protocolVersion?: string };
      expect(result.protocolVersion, version).toBe(version);
    }
  });

  it("不支持的版本回落到最新 2025-06-18", async () => {
    const response = await post(rpc("initialize", { protocolVersion: "1999-01-01" }));
    const result = (await json(response)).result as { protocolVersion?: string };
    expect(result.protocolVersion).toBe("2025-06-18");
  });

  it("缺 protocolVersion 时回落到最新", async () => {
    const response = await post(rpc("initialize"));
    const result = (await json(response)).result as { protocolVersion?: string };
    expect(result.protocolVersion).toBe("2025-06-18");
  });
});

describe("MCP：请求体上限", () => {
  it("300KB 的请求体返回 413", async () => {
    const rawBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
      pad: "x".repeat(300 * 1024),
    });
    const response = await post(null, { rawBody });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("payload_too_large");
  });

  it("100KB 的请求体仍被接受", async () => {
    const rawBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
      pad: "x".repeat(100 * 1024),
    });
    const response = await post(null, { rawBody });
    expect(response.status).toBe(200);
    const result = (await json(response)).result as { tools?: unknown[] };
    expect(result.tools?.length).toBe(5);
  });

  it("非法 JSON 仍是 -32700，非对象 JSON 是 -32600", async () => {
    const broken = await json(await post(null, { rawBody: "{not json" }));
    expect(broken.error?.code).toBe(-32700);

    const notObject = await json(await post(null, { rawBody: "null" }));
    expect(notObject.error?.code).toBe(-32600);
  });

  it("params 为 null 时按空参数处理", async () => {
    const response = await post(null, {
      rawBody: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list", params: null }),
    });
    const body = await json(response);
    expect((body.result as { tools?: unknown[] }).tools?.length).toBe(5);
    expect(body.id).toBe(7);
  });
});

describe("MCP：Origin 约束", () => {
  it("明确跨站的 Origin 返回 403", async () => {
    const response = await post(rpc("tools/list"), { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("forbidden");
  });

  it("同源 Origin 放行", async () => {
    const response = await post(rpc("tools/list"), { origin: "http://localhost" });
    expect(response.status).toBe(200);
  });

  it("无 Origin 的外部 MCP 客户端放行", async () => {
    const response = await post(rpc("tools/list"), { origin: null });
    expect(response.status).toBe(200);
    const result = (await json(response)).result as { tools?: unknown[] };
    expect(result.tools?.length).toBe(5);
  });

  it("无 Origin 但 Sec-Fetch-Site: cross-site 也拒绝", async () => {
    const response = await post(rpc("tools/list"), {
      origin: null,
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(response.status).toBe(403);
  });
});

describe("MCP：GET 只回 405", () => {
  it("GET /api/mcp 返回 405 且带 Allow: POST", async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    const body = await json(response);
    expect(body.error?.code).toBe(-32000);
  });
});
