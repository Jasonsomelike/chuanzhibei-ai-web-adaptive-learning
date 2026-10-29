import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { getDb, __resetMemoryDbForTests, __setDbBackendForTests } from "@/lib/db";
import type { SecretEnv } from "@/lib/secretCrypto";
import {
  deleteUserSecret,
  getUserSecretRow,
  listUserSecrets,
  loadUserSecret,
  maskSecret,
  parseSecretOptions,
  readSecretPayload,
  saveUserSecret,
  toPublicConfig,
  type SaveUserSecretInput,
  type SecretKind,
} from "@/lib/userSecrets";

/**
 * user_secrets 访问层的行为测试。
 *
 * 两条底线：
 * 1. 公开对象（会进 /api/config 响应）里绝不能出现明文、密文或任何密钥字段；
 * 2. 数据库里只能看到密文，options 里不能夹带密钥。
 */

const KEY = Buffer.alloc(32, 3).toString("base64");
const ENV: SecretEnv = {
  ALP_SECRET_KEY: KEY,
  ALP_SECRET_KEY_ID: "v1",
  ALP_ALLOW_MEMORY_SECRETS: "1",
};
const T1 = "2026-10-29T00:00:00.000Z";
const T2 = "2026-10-29T01:00:00.000Z";

const FAKE_KEY = "demo-key-abcdef123456";
const EMBED_KEY = "sk-embed-0987654321";
const EXTRA_HEADERS = '{"X-Org":"alp"}';

type TestDb = Awaited<ReturnType<typeof getDb>>;

beforeEach(() => {
  __resetMemoryDbForTests();
});

afterEach(() => {
  __setDbBackendForTests(null);
});

async function seedUser(id = "u1"): Promise<TestDb> {
  const db = await getDb();
  await db.run(
    "INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ($1, $2, $3, $4, $5)",
    [id, `${id}@test.local`, "hash", "用户", T1],
  );
  return db;
}

function llmInput(over: Partial<SaveUserSecretInput> = {}): SaveUserSecretInput {
  return {
    kind: "llm",
    label: "DeepSeek",
    api: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    options: {
      thinking: "standard",
      verification: true,
      embeddingBaseUrl: "https://api.openai.com/v1",
      embeddingModel: "text-embedding-3-small",
      embeddingStatus: "verified",
    },
    payload: {
      apiKey: FAKE_KEY,
      extraHeaders: EXTRA_HEADERS,
      embeddingApiKey: EMBED_KEY,
    },
    now: T1,
    ...over,
  };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "NO_THROW";
  } catch (err) {
    return (err as { code?: string }).code ?? "NO_CODE";
  }
}

async function rejectionOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_THROW";
  } catch (err) {
    return (err as { code?: string }).code ?? "NO_CODE";
  }
}

describe("saveUserSecret / readSecretPayload", () => {
  it("加密落库并能按用户解密读回", async () => {
    const db = await seedUser();
    const saved = await saveUserSecret(db, "u1", llmInput(), ENV);

    expect(saved).toMatchObject({
      kind: "llm",
      label: "DeepSeek",
      api: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      hint: "••••3456",
      createdAt: T1,
      updatedAt: T1,
    });
    expect(saved.options.thinking).toBe("standard");
    expect(saved.options.verification).toBe(true);

    const row = await getUserSecretRow(db, "u1", "llm");
    expect(row).not.toBeNull();
    expect(row!.secret_ct).not.toBe("");
    expect(row!.secret_ct).not.toContain(FAKE_KEY);
    expect(row!.secret_kid).toBe("v1");
    expect(row!.secret_hint).toBe("••••3456");
    expect(row!.options_json).not.toContain(FAKE_KEY);
    expect(row!.options_json).not.toContain("extraHeaders");

    expect(readSecretPayload(row!, "u1", ENV)).toEqual({
      apiKey: FAKE_KEY,
      extraHeaders: EXTRA_HEADERS,
      embeddingApiKey: EMBED_KEY,
    });
  });

  it("公开对象里没有任何密钥材料", async () => {
    const db = await seedUser();
    const saved = await saveUserSecret(db, "u1", llmInput(), ENV);
    const row = await getUserSecretRow(db, "u1", "llm");
    const json = JSON.stringify(saved);

    for (const needle of [
      FAKE_KEY,
      EMBED_KEY,
      EXTRA_HEADERS,
      "apiKey",
      "extraHeaders",
      "secret_ct",
      "secret_iv",
      "secret_tag",
      row!.secret_ct,
      row!.secret_iv,
      row!.secret_tag,
    ]) {
      expect(json).not.toContain(needle);
    }
  });

  it("重复保存是更新：created_at 保留、updated_at 刷新、密文替换", async () => {
    const db = await seedUser();
    await saveUserSecret(db, "u1", llmInput(), ENV);
    const updated = await saveUserSecret(
      db,
      "u1",
      llmInput({
        label: "新标签",
        payload: { apiKey: "sk-new-key-987654321" },
        now: T2,
      }),
      ENV,
    );

    expect(updated.createdAt).toBe(T1);
    expect(updated.updatedAt).toBe(T2);
    expect(updated.label).toBe("新标签");

    const rows = await db.all("SELECT * FROM user_secrets WHERE user_id = $1", ["u1"]);
    expect(rows).toHaveLength(1);

    const row = await getUserSecretRow(db, "u1", "llm");
    expect(readSecretPayload(row!, "u1", ENV)).toEqual({ apiKey: "sk-new-key-987654321" });
  });

  it("TTS 浏览器模式没有密钥：密文字段为空，读取返回空对象", async () => {
    const db = await seedUser();
    const saved = await saveUserSecret(
      db,
      "u1",
      {
        kind: "tts",
        api: "browser",
        model: "browser",
        options: { browserVoice: "Ting-Ting", rate: 1 },
        payload: {},
        now: T1,
      },
      ENV,
    );

    expect(saved.hint).toBe("••••");
    const row = await getUserSecretRow(db, "u1", "tts");
    expect(row!.secret_ct).toBe("");
    expect(row!.secret_iv).toBe("");
    expect(row!.secret_tag).toBe("");
    expect(readSecretPayload(row!, "u1", ENV)).toEqual({});
  });

  it("用别的 userId 解密会失败（AAD 绑定）", async () => {
    const db = await seedUser();
    await saveUserSecret(db, "u1", llmInput(), ENV);
    const row = await getUserSecretRow(db, "u1", "llm");

    expect(codeOf(() => readSecretPayload(row!, "u2", ENV))).toBe("SECRET_UNREADABLE");
  });

  it("loadUserSecret 一次取回行、公开配置与解密负载", async () => {
    const db = await seedUser();
    await saveUserSecret(db, "u1", llmInput(), ENV);

    const loaded = await loadUserSecret(db, "u1", "llm", ENV);
    expect(loaded?.payload.apiKey).toBe(FAKE_KEY);
    expect(loaded?.config.kind).toBe("llm");
    expect(loaded?.row.user_id).toBe("u1");

    expect(await loadUserSecret(db, "u1", "tts", ENV)).toBeNull();
  });
});

describe("输入校验", () => {
  it("options 只接受白名单字段，密钥类字段必须走 payload", async () => {
    const db = await seedUser();

    expect(
      await rejectionOf(() =>
        saveUserSecret(db, "u1", llmInput({ options: { extraHeaders: "{}" } }), ENV),
      ),
    ).toBe("INVALID_OPTIONS");
    expect(
      await rejectionOf(() =>
        saveUserSecret(db, "u1", llmInput({ options: { apiKey: "sk-1234567890" } }), ENV),
      ),
    ).toBe("INVALID_OPTIONS");

    const rows = await db.all("SELECT * FROM user_secrets WHERE user_id = $1", ["u1"]);
    expect(rows).toEqual([]);
  });

  it("过短的 apiKey 拒绝保存（SECRET_TOO_SHORT）", async () => {
    const db = await seedUser();

    expect(
      await rejectionOf(() =>
        saveUserSecret(db, "u1", llmInput({ payload: { apiKey: "short" } }), ENV),
      ),
    ).toBe("SECRET_TOO_SHORT");

    expect(await db.all("SELECT * FROM user_secrets WHERE user_id = $1", ["u1"])).toEqual([]);
  });

  it("llm / 搜索类配置必须提供 apiKey", async () => {
    const db = await seedUser();

    expect(
      await rejectionOf(() =>
        saveUserSecret(db, "u1", llmInput({ payload: { embeddingApiKey: EMBED_KEY } }), ENV),
      ),
    ).toBe("INVALID_INPUT");
    expect(
      await rejectionOf(() =>
        saveUserSecret(
          db,
          "u1",
          { kind: "search-tavily", api: "tavily", payload: {}, now: T1 },
          ENV,
        ),
      ),
    ).toBe("INVALID_INPUT");
  });

  it("未知 kind 拒绝", async () => {
    const db = await seedUser();
    expect(
      await rejectionOf(() =>
        saveUserSecret(db, "u1", llmInput({ kind: "nope" as unknown as SecretKind }), ENV),
      ),
    ).toBe("INVALID_INPUT");
  });

  it("内存后端默认拒绝写密钥，ALP_ALLOW_MEMORY_SECRETS=1 才放行", async () => {
    const db = await seedUser();

    expect(
      await rejectionOf(() =>
        saveUserSecret(db, "u1", llmInput(), { ALP_SECRET_KEY: KEY }),
      ),
    ).toBe("SECRET_STORAGE_UNAVAILABLE");
    expect(await db.all("SELECT * FROM user_secrets WHERE user_id = $1", ["u1"])).toEqual([]);

    const saved = await saveUserSecret(db, "u1", llmInput(), {
      ...ENV,
      ALP_ALLOW_MEMORY_SECRETS: "true",
    });
    expect(saved.kind).toBe("llm");
  });

  it("后端被测试标记为 postgres 时无需放行开关", async () => {
    const db = await seedUser();
    __setDbBackendForTests("postgres");

    const saved = await saveUserSecret(db, "u1", llmInput(), { ALP_SECRET_KEY: KEY });
    expect(saved.kind).toBe("llm");
  });

  it("缺少 ALP_SECRET_KEY 时拒绝而不是明文落库", async () => {
    const db = await seedUser();

    expect(
      await rejectionOf(() =>
        saveUserSecret(db, "u1", llmInput(), { ALP_ALLOW_MEMORY_SECRETS: "1" }),
      ),
    ).toBe("KEY_ENC_UNAVAILABLE");
    expect(await db.all("SELECT * FROM user_secrets WHERE user_id = $1", ["u1"])).toEqual([]);
  });
});

describe("list / delete / 公开形状", () => {
  it("列出公开配置并返回真实删除结果", async () => {
    const db = await seedUser();
    await saveUserSecret(db, "u1", llmInput(), ENV);
    await saveUserSecret(
      db,
      "u1",
      {
        kind: "search-tavily",
        api: "tavily",
        payload: { apiKey: "tvly-1234567890" },
        now: T1,
      },
      ENV,
    );

    const list = await listUserSecrets(db, "u1");
    expect(list.map((item) => item.kind)).toEqual(["llm", "search-tavily"]);

    expect(await deleteUserSecret(db, "u1", "llm")).toBe(true);
    expect(await deleteUserSecret(db, "u1", "llm")).toBe(false);

    const rest = await listUserSecrets(db, "u1");
    expect(rest.map((item) => item.kind)).toEqual(["search-tavily"]);
  });

  it("坏 options_json 不会让公开配置抛错，未知字段被丢弃", async () => {
    const db = await seedUser();
    await saveUserSecret(db, "u1", llmInput(), ENV);
    const row = await getUserSecretRow(db, "u1", "llm");

    expect(toPublicConfig({ ...row!, options_json: "not json" }).options).toEqual({});
    expect(
      toPublicConfig({ ...row!, options_json: '{"voice":"alloy","apiKey":"leak"}' }).options,
    ).toEqual({ voice: "alloy" });
    expect(parseSecretOptions('{"rate":1.1,"unknown":true}')).toEqual({ rate: 1.1 });
  });

  it("maskSecret 从本模块重新导出，短密钥只回圆点", () => {
    expect(maskSecret("short")).toBe("••••");
    expect(maskSecret(FAKE_KEY)).toBe("demo••••3456");
  });
});
