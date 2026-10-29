/**
 * serverEmbedding 的四级解析与响应校验。
 *
 * 上游是本机 http 服务器（127.0.0.1 临时端口），通过 ALP_ALLOW_HTTP_PROVIDER_HOSTS
 * 显式放行；配置行用 userSecrets/secretCrypto 的真实行形状与加密方式，不碰真实供应商。
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { embedTextsForUser } from "@/lib/serverEmbedding";
import { sealSecret, type SecretEnv } from "@/lib/secretCrypto";
import { ALLOW_HTTP_PROVIDER_HOSTS_ENV } from "@/lib/ssrfGuard";

const rowRef: { current: Record<string, unknown> | null } = { current: null };
const fakeDb = {
  run: async (): Promise<number> => 0,
  all: async (): Promise<unknown[]> => [],
  one: async (): Promise<Record<string, unknown> | null> => rowRef.current,
};

vi.mock("@/lib/db", () => ({
  getDb: async () => fakeDb,
}));

type ServerMode = "ok" | "short" | "bad-number" | "ragged" | "unauthorized";

interface Requests {
  path: string;
  model: string;
  input: string[];
  authorization: string;
}

let mode: ServerMode = "ok";
let requests: Requests[] = [];

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const parsed = JSON.parse(raw) as { model: string; input: string[] };
    requests.push({
      path: req.url ?? "",
      model: parsed.model,
      input: parsed.input,
      authorization: (req.headers.authorization as string | undefined) ?? "",
    });

    if (mode === "unauthorized") {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { message: "bad key" } }));
      return;
    }

    const data = parsed.input.map((_, index) => {
      if (mode === "bad-number") return { embedding: [1, null, 3] };
      if (mode === "ragged") return { embedding: index === 0 ? [1, 2, 3] : [1, 2] };
      return { embedding: [index + 1, 2, 3] };
    });
    const payload = {
      model: parsed.model,
      data: mode === "short" ? data.slice(0, 1) : data,
    };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(payload));
  });
});

let port = 0;
const saved = new Map<string, string | undefined>();
const MASTER = Buffer.alloc(32, 5).toString("base64");
const sealedEnv: SecretEnv = { ALP_SECRET_KEY: MASTER };
const ENV_KEYS = [
  "ALP_EMBED_BASE_URL",
  "ALP_EMBED_API_KEY",
  "ALP_EMBED_MODEL",
  "ALP_SECRET_KEY",
  "ALP_SECRET_KEY_ID",
  ALLOW_HTTP_PROVIDER_HOSTS_ENV,
] as const;

beforeEach(async () => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  for (const key of [
    "ALP_EMBED_BASE_URL",
    "ALP_EMBED_API_KEY",
    "ALP_EMBED_MODEL",
    "ALP_SECRET_KEY_ID",
  ]) {
    delete process.env[key];
  }
  process.env["ALP_SECRET_KEY"] = MASTER;
  rowRef.current = null;
  mode = "ok";
  requests = [];

  if (port === 0) {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  }
  process.env[ALLOW_HTTP_PROVIDER_HOSTS_ENV] = `127.0.0.1:${port}`;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

afterAll(async () => {
  if (port !== 0) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    port = 0;
  }
});

function localBase(path = "/v1"): string {
  return `http://127.0.0.1:${port}${path}`;
}

interface RowInput {
  readonly baseUrl?: string;
  readonly model?: string;
  readonly options?: Record<string, unknown>;
  readonly payload?: Record<string, string>;
}

function llmRow(input: RowInput = {}): Record<string, unknown> {
  const sealed =
    input.payload === undefined
      ? null
      : sealSecret(
          JSON.stringify(input.payload),
          { userId: "u1", kind: "llm" },
          sealedEnv,
        );

  return {
    user_id: "u1",
    kind: "llm",
    label: "文本模型",
    api: "openai-compatible",
    base_url: input.baseUrl ?? localBase(),
    model: input.model ?? "chat-model",
    options_json: JSON.stringify(input.options ?? {}),
    secret_ct: sealed?.ct ?? "",
    secret_iv: sealed?.iv ?? "",
    secret_tag: sealed?.tag ?? "",
    secret_kid: sealed?.kid ?? "v1",
    secret_hint: "••••",
    created_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z",
  };
}

describe("embedTextsForUser：解析顺序", () => {
  it("1) ALP_EMBED_* 三项齐全时优先使用环境变量", async () => {
    process.env["ALP_EMBED_BASE_URL"] = localBase();
    process.env["ALP_EMBED_API_KEY"] = "env-key-123";
    process.env["ALP_EMBED_MODEL"] = "env-embedding";

    const result = await embedTextsForUser("u1", ["甲", "乙"]);

    expect(result).not.toBeNull();
    expect(result?.model).toBe("env-embedding");
    expect(result?.dim).toBe(3);
    expect(result?.vectors).toEqual([
      [1, 2, 3],
      [2, 2, 3],
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe("/v1/embeddings");
    expect(requests[0]?.authorization).toBe("Bearer env-key-123");
    expect(requests[0]?.input).toEqual(["甲", "乙"]);
  });

  it("1) 环境变量缺一项就跳过，且没有其它配置时返回 null", async () => {
    process.env["ALP_EMBED_BASE_URL"] = localBase();
    process.env["ALP_EMBED_API_KEY"] = "env-key-123";

    const result = await embedTextsForUser("u1", ["甲"]);
    expect(result).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("2) 跨供应商：embeddingBaseUrl + embeddingApiKey + embeddingModel", async () => {
    rowRef.current = llmRow({
      baseUrl: "https://api.deepseek.com/v1",
      options: { embeddingBaseUrl: localBase(), embeddingModel: "text-embedding-v3" },
      payload: { apiKey: "chat-key-1", embeddingApiKey: "dashscope-key-1" },
    });

    const result = await embedTextsForUser("u1", ["甲"]);

    expect(result?.model).toBe("text-embedding-v3");
    expect(requests[0]?.model).toBe("text-embedding-v3");
    expect(requests[0]?.authorization).toBe("Bearer dashscope-key-1");
  });

  it("3) 同源：baseUrl + apiKey + embeddingModel", async () => {
    rowRef.current = llmRow({
      options: { embeddingModel: "same-origin-embed" },
      payload: { apiKey: "chat-key-1" },
    });

    const result = await embedTextsForUser("u1", ["甲"]);
    expect(result?.model).toBe("same-origin-embed");
    expect(requests[0]?.authorization).toBe("Bearer chat-key-1");
    expect(requests[0]?.path).toBe("/v1/embeddings");
  });

  it("4) 没有 embeddingModel 时返回 null，不发请求", async () => {
    rowRef.current = llmRow({ payload: { apiKey: "chat-key-1" } });

    expect(await embedTextsForUser("u1", ["甲"])).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("没有配置行时返回 null", async () => {
    expect(await embedTextsForUser("u1", ["甲"])).toBeNull();
    expect(requests).toHaveLength(0);
  });
});

describe("embedTextsForUser：响应校验", () => {
  function configureEnv(): void {
    process.env["ALP_EMBED_BASE_URL"] = localBase();
    process.env["ALP_EMBED_API_KEY"] = "env-key-123";
    process.env["ALP_EMBED_MODEL"] = "env-embedding";
  }

  it("data 条数少于输入 → null", async () => {
    configureEnv();
    mode = "short";
    expect(await embedTextsForUser("u1", ["甲", "乙"])).toBeNull();
  });

  it("向量里有非数字 → null", async () => {
    configureEnv();
    mode = "bad-number";
    expect(await embedTextsForUser("u1", ["甲"])).toBeNull();
  });

  it("同一批向量维度不一致 → null", async () => {
    configureEnv();
    mode = "ragged";
    expect(await embedTextsForUser("u1", ["甲", "乙"])).toBeNull();
  });

  it("上游 4xx → null", async () => {
    configureEnv();
    mode = "unauthorized";
    expect(await embedTextsForUser("u1", ["甲"])).toBeNull();
  });
});

describe("embedTextsForUser：SSRF 与异常都返回 null", () => {
  it("目标是云元数据地址时直接失败，不发请求", async () => {
    rowRef.current = llmRow({
      baseUrl: localBase(),
      options: {
        embeddingBaseUrl: "https://169.254.169.254/v1",
        embeddingModel: "bad-embed",
      },
      payload: { apiKey: "chat-key-1", embeddingApiKey: "embed-key-1" },
    });

    expect(await embedTextsForUser("u1", ["甲"])).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("空 texts 直接返回 null", async () => {
    process.env["ALP_EMBED_BASE_URL"] = localBase();
    process.env["ALP_EMBED_API_KEY"] = "env-key-123";
    process.env["ALP_EMBED_MODEL"] = "env-embedding";

    expect(await embedTextsForUser("u1", [])).toBeNull();
    expect(requests).toHaveLength(0);
  });
});
