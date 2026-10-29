/**
 * /api/config 与 /api/health 的路由行为。
 *
 * 断言的核心不是「能存能取」，而是：
 * - 任何响应里都搜不到明文密钥与三个密文字段名；
 * - 掩码只回 hint，PUT 不带 key 时不会把旧密钥弄丢；
 * - 内存后端与缺主密钥时是 503，且没有写库；
 * - DELETE 后 configured 回到 false。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    displayName: string;
    createdAt: string;
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => authState.user,
}));

const { GET, PUT, DELETE } = await import("../../app/api/config/route");
const { GET: healthGET } = await import("../../app/api/health/route");
const { __resetMemoryDbForTests, getDb, __setDbBackendForTests } = await import("@/lib/db");
const { getUserSecretRow, readSecretPayload } = await import("@/lib/userSecrets");

const USER = {
  id: "u1",
  email: "u@test.local",
  displayName: "测试用户",
  createdAt: "2026-10-29T00:00:00.000Z",
};

/** 32 字节随机数 → 标准 base64（44 字符，含 =），secretCrypto 只接受这一种。 */
const MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

/**
 * 测试用假密钥：刻意不模仿真实 key 的形状（无 sk- 前缀、长度 < 16）。
 * 这些值会进入请求体与断言，但绝不可能是真实凭据；
 * 同时避免触发 scripts/check-secrets.ts 的「赋了值的密钥变量」规则。
 * hint 只露末 4 位，所以 API_KEY 的末 4 位固定为 5678。
 */
const API_KEY = "fake-key-5678";
const EMBED_KEY = "fake-embed-4321";
const HEALTH_TOKEN = "fake-health-1";

/** 字面量公网 IP，避免测试依赖 DNS。 */
const PUBLIC_BASE = "https://8.8.8.8/v1";
const PUBLIC_EMBED = "https://9.9.9.9/v1";

interface ConfigEntry {
  configured: boolean;
  hint: string;
  label: string;
  api: string;
  baseUrl: string;
  model: string;
  options: Record<string, unknown>;
  updatedAt: string;
}

interface ConfigResponse {
  config: Record<string, ConfigEntry>;
}

interface ErrorResponse {
  error: { code: string; message: string };
}

function saveEnv(): void {
  delete process.env.DATABASE_URL;
  process.env.ALP_SECRET_KEY = MASTER_KEY;
  process.env.ALP_ALLOW_MEMORY_SECRETS = "1";
  delete process.env.ALP_SECRET_KEY_ID;
  delete process.env.ALP_ALLOW_HTTP_PROVIDER_HOSTS;
  delete process.env.HEALTH_TOKEN;
}

beforeEach(() => {
  authState.user = USER;
  saveEnv();
  __resetMemoryDbForTests();
  __setDbBackendForTests(null);
});

function putRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/config", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function deleteRequest(kind: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/config?kind=${encodeURIComponent(kind)}`, {
    method: "DELETE",
    headers: { origin: "http://localhost", ...headers },
  });
}

const LLM_BODY = {
  provider: "llm",
  kind: "openai-compatible",
  baseUrl: PUBLIC_BASE,
  apiKey: API_KEY,
  model: "deepseek-chat",
};

async function getConfig(): Promise<{ res: Response; text: string; body: ConfigResponse }> {
  const res = await GET();
  const text = await res.text();
  return { res, text, body: JSON.parse(text) as ConfigResponse };
}

describe("GET /api/config", () => {
  it("未登录返回 401", async () => {
    authState.user = null;
    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("unauthorized");
  });

  it("四个 kind 永远都有槽位，未配置时 configured=false", async () => {
    const { res, body } = await getConfig();
    expect(res.status).toBe(200);
    for (const kind of ["llm", "search-deepseek", "search-tavily", "tts"]) {
      expect(body.config[kind]).toBeDefined();
      expect(body.config[kind].configured).toBe(false);
      expect(body.config[kind].hint).toBe("");
    }
  });
});

describe("PUT /api/config", () => {
  it("未登录 401、跨站 403、非 JSON 415、缺字段 400", async () => {
    authState.user = null;
    expect((await PUT(putRequest(LLM_BODY))).status).toBe(401);

    authState.user = USER;
    const noOrigin = new Request("http://localhost/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(LLM_BODY),
    });
    expect((await PUT(noOrigin)).status).toBe(403);

    const wrongType = new Request("http://localhost/api/config", {
      method: "PUT",
      headers: { "content-type": "text/plain", origin: "http://localhost" },
      body: JSON.stringify(LLM_BODY),
    });
    expect((await PUT(wrongType)).status).toBe(415);

    const res = await PUT(putRequest({ provider: "llm", kind: "openai-compatible" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("bad_request");
  });

  it("内网 baseUrl 被 SSRF 判定拒绝，且不写库", async () => {
    const res = await PUT(putRequest({ ...LLM_BODY, baseUrl: "https://127.0.0.1/v1" }));
    expect(res.status).toBe(400);
    const { body } = await getConfig();
    expect(body.config.llm.configured).toBe(false);
  });

  it("PUT 成功后 GET 只回 hint，响应里搜不到明文与密文字段", async () => {
    const saved = await PUT(putRequest(LLM_BODY));
    expect(saved.status).toBe(200);

    const { res, text, body } = await getConfig();
    expect(res.status).toBe(200);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain("apiKey");
    expect(text).not.toContain("secret_ct");
    expect(text).not.toContain("secret_iv");
    expect(text).not.toContain("secret_tag");

    const llm = body.config.llm;
    expect(llm.configured).toBe(true);
    expect(llm.hint).toBe("••••5678");
    expect(llm.api).toBe("openai-compatible");
    expect(llm.baseUrl).toBe(PUBLIC_BASE);
    expect(llm.model).toBe("deepseek-chat");
  });

  it("库里存的是密文，且能用主密钥解回原文", async () => {
    await PUT(putRequest(LLM_BODY));
    const db = await getDb();
    const row = await getUserSecretRow(db, USER.id, "llm");
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(row.secret_ct).not.toBe("");
    expect(row.secret_ct).not.toContain(API_KEY);
    const payload = readSecretPayload(row, USER.id);
    expect(payload.apiKey).toBe(API_KEY);
  });

  it("apiKey 为空/缺省时沿用已存密钥，只更新其它字段", async () => {
    await PUT(putRequest(LLM_BODY));

    // 缺省 apiKey（派生 schema 允许；契约本身的 apiKey 仍是 min 1）
    const noKey = await PUT(
      putRequest({
        provider: "llm",
        kind: "openai-compatible",
        baseUrl: PUBLIC_BASE,
        model: "deepseek-reasoner",
      }),
    );
    expect(noKey.status).toBe(200);

    // 空串同样表示沿用
    const emptyKey = await PUT(
      putRequest({ ...LLM_BODY, apiKey: "", model: "deepseek-chat" }),
    );
    expect(emptyKey.status).toBe(200);

    const { body } = await getConfig();
    expect(body.config.llm.model).toBe("deepseek-chat");
    expect(body.config.llm.hint).toBe("••••5678");

    const db = await getDb();
    const row = await getUserSecretRow(db, USER.id, "llm");
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(readSecretPayload(row, USER.id).apiKey).toBe(API_KEY);
  });

  it("首次保存缺 apiKey 返回 400", async () => {
    const res = await PUT(putRequest({ provider: "search-tavily", apiKey: "" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("bad_request");
  });

  it("主密钥轮换后：带新 apiKey 可覆盖，不带则 409 而不是悄悄清空", async () => {
    await PUT(putRequest(LLM_BODY));

    // 模拟运维换主密钥：旧密文从此解不开
    process.env.ALP_SECRET_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString("base64");

    const keep = await PUT(
      putRequest({
        provider: "llm",
        kind: "openai-compatible",
        baseUrl: PUBLIC_BASE,
        model: "deepseek-reasoner",
      }),
    );
    expect(keep.status).toBe(409);
    expect(((await keep.json()) as ErrorResponse).error.code).toBe("SECRET_UNREADABLE");

    const overwrite = await PUT(putRequest({ ...LLM_BODY, apiKey: "fake-rotated-9012" }));
    expect(overwrite.status).toBe(200);

    const db = await getDb();
    const row = await getUserSecretRow(db, USER.id, "llm");
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(readSecretPayload(row, USER.id).apiKey).toBe("fake-rotated-9012");
  });

  it("embedding 覆盖字段回显，但 embedding key 不回显", async () => {
    const res = await PUT(
      putRequest({
        ...LLM_BODY,
        embeddingBaseUrl: PUBLIC_EMBED,
        embeddingModel: "text-embedding-3-small",
        embeddingApiKey: EMBED_KEY,
      }),
    );
    expect(res.status).toBe(200);

    const { text, body } = await getConfig();
    expect(text).not.toContain(EMBED_KEY);
    expect(text).not.toContain("embeddingApiKey");
    expect(body.config.llm.options.embeddingBaseUrl).toBe(PUBLIC_EMBED);
    expect(body.config.llm.options.embeddingModel).toBe("text-embedding-3-small");

    const db = await getDb();
    const row = await getUserSecretRow(db, USER.id, "llm");
    expect(row).not.toBeNull();
    if (row === null) return;
    const payload = readSecretPayload(row, USER.id);
    expect(payload.apiKey).toBe(API_KEY);
    expect(payload.embeddingApiKey).toBe(EMBED_KEY);
  });

  it("缺 ALP_SECRET_KEY 返回 503 且不写库", async () => {
    delete process.env.ALP_SECRET_KEY;
    const res = await PUT(putRequest(LLM_BODY));
    expect(res.status).toBe(503);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("KEY_ENC_UNAVAILABLE");

    const { body: config } = await getConfig();
    expect(config.config.llm.configured).toBe(false);
  });

  it("内存后端默认拒绝写密钥（503），放行后测试才能往返", async () => {
    delete process.env.ALP_ALLOW_MEMORY_SECRETS;
    const res = await PUT(putRequest(LLM_BODY));
    expect(res.status).toBe(503);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("PERSISTENCE_UNAVAILABLE");

    // 同一后端下 DELETE 也拒绝：没有持久化的行，「删掉了」是假话
    expect((await DELETE(deleteRequest("llm"))).status).toBe(503);

    const { body: config } = await getConfig();
    expect(config.config.llm.configured).toBe(false);
  });

  it("TTS 浏览器语音可以不填密钥", async () => {
    const res = await PUT(
      putRequest({ provider: "tts", engine: "browser", rate: 1 }),
    );
    expect(res.status).toBe(200);
    const { body } = await getConfig();
    expect(body.config.tts.configured).toBe(true);
    expect(body.config.tts.api).toBe("browser");
    expect(body.config.tts.options.rate).toBe(1);
  });
});

describe("DELETE /api/config", () => {
  it("未登录 401，未知 kind 400", async () => {
    authState.user = null;
    expect((await DELETE(deleteRequest("llm"))).status).toBe(401);

    authState.user = USER;
    const res = await DELETE(deleteRequest("nope"));
    expect(res.status).toBe(400);
  });

  it("删除后 configured=false，再次删除仍幂等", async () => {
    await PUT(putRequest(LLM_BODY));
    expect((await getConfig()).body.config.llm.configured).toBe(true);

    const first = await DELETE(deleteRequest("llm"));
    expect(first.status).toBe(200);
    expect((await first.json()) as { ok: boolean; deleted: boolean }).toEqual({
      ok: true,
      deleted: true,
    });

    const { text, body } = await getConfig();
    expect(body.config.llm.configured).toBe(false);
    expect(text).not.toContain(API_KEY);

    const second = await DELETE(deleteRequest("llm"));
    expect(second.status).toBe(200);
    expect((await second.json()) as { ok: boolean; deleted: boolean }).toEqual({
      ok: true,
      deleted: false,
    });
  });
});

describe("GET /api/health", () => {
  it("未配置 HEALTH_TOKEN 时永远只回 {ok:true}", async () => {
    const res = await healthGET(
      new Request("http://localhost/api/health", {
        headers: { authorization: "Bearer anything" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true });
  });

  it("token 不匹配时也只回 {ok:true}", async () => {
    process.env.HEALTH_TOKEN = HEALTH_TOKEN;
    const res = await healthGET(
      new Request("http://localhost/api/health", {
        headers: { authorization: "Bearer wrong-token" },
      }),
    );
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(text).not.toContain(HEALTH_TOKEN);
  });

  it("Bearer 匹配时返回 keyEncryption 与 db，不含任何密钥片段", async () => {
    process.env.HEALTH_TOKEN = HEALTH_TOKEN;
    const res = await healthGET(
      new Request("http://localhost/api/health", {
        headers: { authorization: `Bearer ${HEALTH_TOKEN}` },
      }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(MASTER_KEY);
    expect(text).not.toContain(HEALTH_TOKEN);
    const body = JSON.parse(text) as { ok: boolean; keyEncryption: string; db: string };
    expect(body.ok).toBe(true);
    expect(body.keyEncryption).toBe("ok");
    expect(body.db).toBe("memory");
  });

  it("缺主密钥时 keyEncryption=missing", async () => {
    process.env.HEALTH_TOKEN = HEALTH_TOKEN;
    delete process.env.ALP_SECRET_KEY;
    const res = await healthGET(
      new Request("http://localhost/api/health", {
        headers: { authorization: `Bearer ${HEALTH_TOKEN}` },
      }),
    );
    const body = (await res.json()) as { keyEncryption: string };
    expect(body.keyEncryption).toBe("missing");
  });
});
