/**
 * /api/mcp/servers 路由：登录、同源、CRUD 往返与「只回 hint」。
 *
 * 真实内存 DB；只替换 getCurrentUser。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; displayName: string; createdAt: string },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => authState.user,
}));

const { GET, PUT, DELETE } = await import("../../app/api/mcp/servers/route");
const { __resetMemoryDbForTests, __setDbBackendForTests } = await import("@/lib/db");

const USER = {
  id: "mcp-route-user",
  email: "mcp@test.local",
  displayName: "MCP 用户",
  createdAt: "2026-10-30T00:00:00.000Z",
};

const MASTER_KEY = Buffer.from(new Uint8Array(32).fill(5)).toString("base64");
const TOKEN = "fake-route-token-4321";
const URL_A = "https://8.8.8.8/mcp";

interface ServerBody {
  server: {
    serverId: string;
    url: string;
    authConfigured: boolean;
    authHint: string;
    allowedTools: string[];
  };
}

interface ErrorBody {
  error: { code: string; message: string };
}

function setEnv(): void {
  delete process.env.DATABASE_URL;
  process.env.ALP_SECRET_KEY = MASTER_KEY;
  process.env.ALP_ALLOW_MEMORY_SECRETS = "1";
  delete process.env.ALP_SECRET_KEY_ID;
  delete process.env.ALP_ALLOW_HTTP_PROVIDER_HOSTS;
}

beforeEach(() => {
  authState.user = USER;
  setEnv();
  __resetMemoryDbForTests();
  __setDbBackendForTests(null);
});

function putRequest(body: unknown, origin = "http://localhost"): Request {
  return new Request("http://localhost/api/mcp/servers", {
    method: "PUT",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function deleteRequest(serverId: string, origin = "http://localhost"): Request {
  return new Request(
    `http://localhost/api/mcp/servers?serverId=${encodeURIComponent(serverId)}`,
    { method: "DELETE", headers: { origin } },
  );
}

describe("/api/mcp/servers：守卫", () => {
  it("未登录三个方法都 401", async () => {
    authState.user = null;
    expect((await GET()).status).toBe(401);
    expect((await PUT(putRequest({ serverId: "s", url: URL_A }))).status).toBe(401);
    expect((await DELETE(deleteRequest("s"))).status).toBe(401);
  });

  it("跨站 Origin 403", async () => {
    const res = await PUT(putRequest({ serverId: "s", url: URL_A }, "https://evil.example"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("forbidden");
  });
});

describe("/api/mcp/servers：CRUD 往返", () => {
  it("PUT → GET → DELETE，响应里没有明文 token", async () => {
    const put = await PUT(
      putRequest({
        serverId: "srv-1",
        label: "我的 MCP",
        url: URL_A,
        allowedTools: ["echo"],
        auth: { name: "Authorization", value: `Bearer ${TOKEN}` },
      }),
    );
    expect(put.status).toBe(200);
    const putText = await put.text();
    expect(putText).not.toContain(TOKEN);
    expect(putText).not.toContain("auth_ct");
    const saved = JSON.parse(putText) as ServerBody;
    expect(saved.server).toMatchObject({
      serverId: "srv-1",
      url: URL_A,
      authConfigured: true,
      authHint: "••••4321",
      allowedTools: ["echo"],
    });

    const list = await GET();
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { servers: ServerBody["server"][] };
    expect(listed.servers.map((server) => server.serverId)).toEqual(["srv-1"]);

    const removed = await DELETE(deleteRequest("srv-1"));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true, removed: true });

    const after = (await (await GET()).json()) as { servers: unknown[] };
    expect(after.servers).toEqual([]);
  });

  it("PUT 未知字段 400，缺 serverId 的 DELETE 400", async () => {
    const unknownField = await PUT(putRequest({ serverId: "s", url: URL_A, extra: 1 }));
    expect(unknownField.status).toBe(400);

    const missing = await DELETE(new Request("http://localhost/api/mcp/servers", {
      method: "DELETE",
      headers: { origin: "http://localhost" },
    }));
    expect(missing.status).toBe(400);
  });

  it("非法 URL 400 且不落库", async () => {
    const res = await PUT(putRequest({ serverId: "s", url: "http://127.0.0.1:9/mcp" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toContain("不被允许");

    const list = (await (await GET()).json()) as { servers: unknown[] };
    expect(list.servers).toEqual([]);
  });

  it("内存后端拒绝保存鉴权头时 503 PERSISTENCE_UNAVAILABLE", async () => {
    delete process.env.ALP_ALLOW_MEMORY_SECRETS;
    const res = await PUT(
      putRequest({
        serverId: "srv-1",
        url: URL_A,
        auth: { name: "authorization", value: `Bearer ${TOKEN}` },
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("PERSISTENCE_UNAVAILABLE");
  });
});
