/**
 * mcp_servers 存储层：加密、AAD 绑定、只回 hint、三种 auth 语义与输入校验。
 *
 * 用内存 DB + 显式 ALP_ALLOW_MEMORY_SECRETS=1；URL 用字面量公网 IP，
 * 不触发 DNS，也不发任何真实请求。
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetMemoryDbForTests,
  __setDbBackendForTests,
  getDb,
} from "@/lib/db";
import {
  MAX_MCP_SERVERS_PER_USER,
  McpStoreError,
  deleteMcpServer,
  getMcpServerRow,
  listMcpServers,
  mcpSecretKind,
  normalizeAllowedTools,
  parseAllowedTools,
  readMcpAuthHeaders,
  saveMcpServer,
} from "@/lib/mcpStore";
import { openSecret } from "@/lib/secretCrypto";
import { UserSecretError } from "@/lib/userSecrets";

const USER = "user-mcp-1";
const OTHER = "user-mcp-2";
const MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const TOKEN = "fake-mcp-token-1234";
const URL_A = "https://8.8.8.8/mcp";
const URL_B = "https://9.9.9.9/mcp";

function setEnv(): void {
  delete process.env.DATABASE_URL;
  process.env.ALP_SECRET_KEY = MASTER_KEY;
  process.env.ALP_ALLOW_MEMORY_SECRETS = "1";
  delete process.env.ALP_SECRET_KEY_ID;
  delete process.env.ALP_ALLOW_HTTP_PROVIDER_HOSTS;
}

beforeEach(() => {
  setEnv();
  __resetMemoryDbForTests();
  __setDbBackendForTests(null);
});

describe("saveMcpServer：公开形状与加密", () => {
  it("保存后只回 hint，响应里没有明文与密文字段", async () => {
    const db = await getDb();
    const saved = await saveMcpServer(db, USER, {
      serverId: "srv-1",
      label: "我的工具",
      url: URL_A,
      allowedTools: ["echo", "echo", "search"],
      auth: { name: "Authorization", value: `Bearer ${TOKEN}` },
    });

    const serialized = JSON.stringify(saved);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain("auth_ct");
    expect(serialized).not.toContain("auth_iv");
    expect(serialized).not.toContain("auth_tag");
    expect(serialized).not.toContain("auth_kid");
    expect(saved).toMatchObject({
      serverId: "srv-1",
      label: "我的工具",
      url: URL_A,
      enabled: true,
      allowedTools: ["echo", "search"],
      authConfigured: true,
      authHint: "••••1234",
    });
  });

  it("密文按 AAD kind=mcp:<serverId> 绑定：换 kind 解不开", async () => {
    const db = await getDb();
    await saveMcpServer(db, USER, {
      serverId: "srv-1",
      url: URL_A,
      auth: { name: "authorization", value: `Bearer ${TOKEN}` },
    });

    const row = await getMcpServerRow(db, USER, "srv-1");
    expect(row).not.toBeNull();
    expect(row?.auth_ct).toBeTruthy();
    expect(mcpSecretKind("srv-1")).toBe("mcp:srv-1");

    expect(() =>
      openSecret(
        {
          ct: row?.auth_ct ?? "",
          iv: row?.auth_iv ?? "",
          tag: row?.auth_tag ?? "",
          kid: row?.auth_kid ?? "",
        },
        { userId: USER, kind: "llm" },
      ),
    ).toThrow();

    const headers = await readMcpAuthHeaders(db, USER, "srv-1");
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("同一用户的另一个服务器解不开相邻服务器的密文", async () => {
    const db = await getDb();
    await saveMcpServer(db, USER, {
      serverId: "srv-1",
      url: URL_A,
      auth: { name: "authorization", value: `Bearer ${TOKEN}` },
    });
    const row = await getMcpServerRow(db, USER, "srv-1");

    expect(() =>
      openSecret(
        {
          ct: row?.auth_ct ?? "",
          iv: row?.auth_iv ?? "",
          tag: row?.auth_tag ?? "",
          kid: row?.auth_kid ?? "",
        },
        { userId: USER, kind: mcpSecretKind("srv-2") },
      ),
    ).toThrow();
  });
});

describe("saveMcpServer：auth 的三种语义", () => {
  it("不带 auth 的更新保留已存密钥", async () => {
    const db = await getDb();
    await saveMcpServer(db, USER, {
      serverId: "srv-1",
      url: URL_A,
      auth: { name: "authorization", value: `Bearer ${TOKEN}` },
    });

    const updated = await saveMcpServer(db, USER, { serverId: "srv-1", url: URL_B });
    expect(updated.url).toBe(URL_B);
    expect(updated.authConfigured).toBe(true);
    expect(updated.authHint).toBe("••••1234");
    expect((await readMcpAuthHeaders(db, USER, "srv-1")).authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("auth:null 清空密钥与 hint", async () => {
    const db = await getDb();
    await saveMcpServer(db, USER, {
      serverId: "srv-1",
      url: URL_A,
      auth: { name: "authorization", value: `Bearer ${TOKEN}` },
    });

    const cleared = await saveMcpServer(db, USER, { serverId: "srv-1", url: URL_A, auth: null });
    expect(cleared.authConfigured).toBe(false);
    expect(cleared.authHint).toBe("");
    expect(await readMcpAuthHeaders(db, USER, "srv-1")).toEqual({});
  });

  it("没有鉴权头的服务器不写密文，hint 为空", async () => {
    const db = await getDb();
    const saved = await saveMcpServer(db, USER, { serverId: "public", url: URL_A });
    expect(saved.authConfigured).toBe(false);
    expect(saved.authHint).toBe("");
    const row = await getMcpServerRow(db, USER, "public");
    expect(row?.auth_ct).toBe("");
    expect(row?.auth_kid).toBe("");
  });
});

describe("saveMcpServer：校验与隔离", () => {
  it("非法 serverId / URL / 工具名都被拒绝", async () => {
    const db = await getDb();
    await expect(
      saveMcpServer(db, USER, { serverId: "bad id", url: URL_A }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await expect(
      saveMcpServer(db, USER, { serverId: "srv", url: "http://127.0.0.1:9/mcp" }),
    ).rejects.toMatchObject({ code: "INVALID_URL" });

    await expect(
      saveMcpServer(db, USER, { serverId: "srv", url: URL_A, allowedTools: ["bad tool"] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("两个用户互不可见", async () => {
    const db = await getDb();
    await saveMcpServer(db, USER, { serverId: "srv-1", url: URL_A });
    expect(await listMcpServers(db, OTHER)).toEqual([]);
    expect(await getMcpServerRow(db, OTHER, "srv-1")).toBeNull();
    expect(await deleteMcpServer(db, OTHER, "srv-1")).toBe(false);
  });

  it("删除后列表为空，重复删除返回 false", async () => {
    const db = await getDb();
    await saveMcpServer(db, USER, { serverId: "srv-1", url: URL_A });
    expect(await deleteMcpServer(db, USER, "srv-1")).toBe(true);
    expect(await listMcpServers(db, USER)).toEqual([]);
    expect(await deleteMcpServer(db, USER, "srv-1")).toBe(false);
  });

  it("超过服务器上限报 TOO_MANY_SERVERS", async () => {
    const db = await getDb();
    for (let index = 0; index < MAX_MCP_SERVERS_PER_USER; index += 1) {
      await saveMcpServer(db, USER, { serverId: `srv-${index}`, url: URL_A });
    }
    await expect(
      saveMcpServer(db, USER, { serverId: "one-too-many", url: URL_A }),
    ).rejects.toMatchObject({ code: "TOO_MANY_SERVERS" });
  });

  it("内存后端默认拒绝保存鉴权头，放行后可存", async () => {
    const db = await getDb();
    delete process.env.ALP_ALLOW_MEMORY_SECRETS;
    await expect(
      saveMcpServer(db, USER, {
        serverId: "srv-1",
        url: URL_A,
        auth: { name: "authorization", value: `Bearer ${TOKEN}` },
      }),
    ).rejects.toBeInstanceOf(UserSecretError);

    // 不带鉴权头的配置不需要写密钥，内存后端允许（便于本地演示）。
    const publicOnly = await saveMcpServer(db, USER, { serverId: "srv-2", url: URL_A });
    expect(publicOnly.authConfigured).toBe(false);
  });
});

describe("工具白名单清洗", () => {
  it("normalizeAllowedTools 去重保序并拒绝非法名", () => {
    expect(normalizeAllowedTools(["echo", "echo", "search"])).toEqual(["echo", "search"]);
    expect(normalizeAllowedTools(undefined)).toEqual([]);
    expect(() => normalizeAllowedTools(["a b"])).toThrow(McpStoreError);
  });

  it("parseAllowedTools 对坏 JSON 宽容", () => {
    expect(parseAllowedTools("{not json")).toEqual([]);
    expect(parseAllowedTools('["echo",1,"bad name","echo"]')).toEqual(["echo"]);
  });
});
