import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMemoryDbForTests, __setDbForTests, getDb, type Db } from "@/lib/db";
import {
  KB_LOCAL_VECTOR_DIM,
  KB_LOCAL_VECTOR_MODEL,
  KB_VECTOR_UPLOAD_MAX_BYTES,
} from "@/lib/vectorContracts";

/**
 * /api/kb/vectors 与 /api/kb/similar 的路由级回归。
 *
 * 覆盖：
 * - 未登录 401、跨站 POST 403、非 JSON 415、请求体超限 413；
 * - 一批 >32 条、维度/非有限值 400；
 * - GET 按方向列已有 chunkId（JOIN 过滤）；
 * - similar 的 SQL 参数形状与响应映射（用注入的 Db 返回假行，不依赖 Postgres）；
 * - 内存后端没有 pgvector 时 similar 返回空 hits（降级，不是 500）。
 */

const authState = vi.hoisted(() => ({
  user: null as null | { readonly id: string; readonly email: string; readonly displayName: string },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => authState.user,
}));

const { GET: vectorsGet, POST: vectorsPost } = await import(
  "../../app/api/kb/vectors/route"
);
const { POST: similarPost } = await import("../../app/api/kb/similar/route");

const USER_A = { id: "user-a", email: "a@test.local", displayName: "A" };
const originalDatabaseUrl = process.env.DATABASE_URL;

function vec(fill = 0.1): number[] {
  return Array.from({ length: KB_LOCAL_VECTOR_DIM }, (_, index) => fill + index / 1_000_000);
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string): Request {
  return new Request(url, { headers: { origin: "http://localhost" } });
}

async function seedChunk(userId: string, chunkId: string, directionId: string): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO kb_chunks (user_id, chunk_id, doc_id, direction_id, idx, title, section,
       page_from, page_to, text, embedding, embedding_model, embedding_dim, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      userId,
      chunkId,
      `doc-${directionId}`,
      directionId,
      0,
      "讲义",
      "第一节",
      null,
      null,
      "栈是后进先出的线性表。",
      null,
      null,
      null,
      "2026-10-30T00:00:00.000Z",
    ],
  );
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  __resetMemoryDbForTests();
  authState.user = USER_A;
  await getDb();
});

afterEach(() => {
  __resetMemoryDbForTests();
});

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("GET /api/kb/vectors", () => {
  it("未登录 401", async () => {
    authState.user = null;
    const res = await vectorsGet(getRequest("http://localhost/api/kb/vectors?directionId=d1"));
    expect(res.status).toBe(401);
  });

  it("缺 directionId / 非法 model 400", async () => {
    expect(
      (await vectorsGet(getRequest("http://localhost/api/kb/vectors"))).status,
    ).toBe(400);
    expect(
      (
        await vectorsGet(
          getRequest("http://localhost/api/kb/vectors?directionId=d1&model=other"),
        )
      ).status,
    ).toBe(400);
  });

  it("只返回本用户、本方向、本模型的 chunkId（JOIN kb_chunks）", async () => {
    await seedChunk("user-a", "c1", "d1");
    await seedChunk("user-a", "c2", "d2");
    await seedChunk("user-b", "c3", "d1");

    const upload = await vectorsPost(
      jsonRequest("http://localhost/api/kb/vectors", {
        vectors: [
          { chunkId: "c1", vec: vec(0.1) },
          { chunkId: "c2", vec: vec(0.2) },
          { chunkId: "c3", vec: vec(0.3) },
        ],
      }),
    );
    expect(upload.status).toBe(200);

    const d1 = await vectorsGet(
      getRequest(
        `http://localhost/api/kb/vectors?directionId=d1&model=${KB_LOCAL_VECTOR_MODEL}`,
      ),
    );
    expect(d1.status).toBe(200);
    const body = (await d1.json()) as {
      model: string;
      dim: number;
      chunkIds: string[];
    };
    expect(body.model).toBe(KB_LOCAL_VECTOR_MODEL);
    expect(body.dim).toBe(KB_LOCAL_VECTOR_DIM);
    expect(body.chunkIds).toEqual(["c1"]);

    const d2 = await vectorsGet(
      getRequest("http://localhost/api/kb/vectors?directionId=d2"),
    );
    expect(((await d2.json()) as { chunkIds: string[] }).chunkIds).toEqual(["c2"]);
  });
});

describe("POST /api/kb/vectors", () => {
  it("未登录 401、跨站 403、非 JSON 415", async () => {
    const body = { vectors: [{ chunkId: "c1", vec: vec() }] };

    authState.user = null;
    expect((await vectorsPost(jsonRequest("http://localhost/api/kb/vectors", body))).status).toBe(
      401,
    );

    authState.user = USER_A;
    const crossSite = new Request("http://localhost/api/kb/vectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect((await vectorsPost(crossSite)).status).toBe(403);

    const wrongType = new Request("http://localhost/api/kb/vectors", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "http://localhost" },
      body: "{}",
    });
    expect((await vectorsPost(wrongType)).status).toBe(415);
  });

  it("一批 33 条 400；511 维 / null 分量 400", async () => {
    await seedChunk("user-a", "c1", "d1");

    const tooMany = {
      vectors: Array.from({ length: 33 }, (_, index) => ({
        chunkId: `c1`,
        vec: vec(index / 100),
      })),
    };
    expect((await vectorsPost(jsonRequest("http://localhost/api/kb/vectors", tooMany))).status).toBe(
      400,
    );

    const wrongDim = { vectors: [{ chunkId: "c1", vec: vec().slice(0, 511) }] };
    expect(
      (await vectorsPost(jsonRequest("http://localhost/api/kb/vectors", wrongDim))).status,
    ).toBe(400);

    // JSON.stringify 会把 NaN 变成 null；用原始字符串确保 null 真的进入解析
    const withNull = new Request("http://localhost/api/kb/vectors", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ vectors: [{ chunkId: "c1", vec: vec() }] }).replace(
        /"vec":\[0\.1/,
        '"vec":[null',
      ),
    });
    expect((await vectorsPost(withNull)).status).toBe(400);
  });

  it("请求体超过 512KB 且没有 Content-Length 时 413", async () => {
    const total = KB_VECTOR_UPLOAD_MAX_BYTES + 1;
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let sent = 0;
        while (sent < total) {
          const size = Math.min(chunk.byteLength, total - sent);
          controller.enqueue(chunk.slice(0, size));
          sent += size;
        }
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/kb/vectors", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: stream,
      duplex: "half",
    } as RequestInit);

    const res = await vectorsPost(request);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "payload_too_large",
    );
  });

  it("成功写入返回 stored/model/dim", async () => {
    await seedChunk("user-a", "c1", "d1");
    await seedChunk("user-a", "c2", "d1");

    const res = await vectorsPost(
      jsonRequest("http://localhost/api/kb/vectors", {
        vectors: [
          { chunkId: "c1", vec: vec(0.1) },
          { chunkId: "c2", vec: vec(0.2) },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({
      stored: 2,
      model: KB_LOCAL_VECTOR_MODEL,
      dim: KB_LOCAL_VECTOR_DIM,
    });
  });
});

describe("POST /api/kb/similar", () => {
  it("未登录 401；请求体超限 413", async () => {
    authState.user = null;
    expect(
      (
        await similarPost(
          jsonRequest("http://localhost/api/kb/similar", {
            directionId: "d1",
            vector: vec(),
          }),
        )
      ).status,
    ).toBe(401);

    authState.user = USER_A;
    const total = 65 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(total).fill(0x20));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/kb/similar", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await similarPost(request)).status).toBe(413);
  });

  it("内存后端没有 pgvector：返回空 hits（降级），不是 500", async () => {
    await seedChunk("user-a", "c1", "d1");

    const res = await similarPost(
      jsonRequest("http://localhost/api/kb/similar", {
        directionId: "d1",
        vector: vec(0.3),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({
      model: KB_LOCAL_VECTOR_MODEL,
      dim: KB_LOCAL_VECTOR_DIM,
      hits: [],
    });
  });

  it("SQL 参数形状固定，响应映射丢弃 NaN 并夹紧分数", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const fake: Db = {
      async run() {
        return 0;
      },
      async one() {
        return null;
      },
      async all<T>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return [
          { chunk_id: "c1", score: "0.75" },
          { chunk_id: "c2", score: 2 },
          { chunk_id: "bad", score: "NaN" },
          { chunk_id: "c3", score: "0.25" },
        ] as T[];
      },
    };
    __setDbForTests(fake);

    const res = await similarPost(
      jsonRequest("http://localhost/api/kb/similar", {
        directionId: "d1",
        vector: vec(0.5),
        limit: 3,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hits: { chunkId: string; score: number }[];
    };
    expect(body.hits).toEqual([
      { chunkId: "c2", score: 1 },
      { chunkId: "c1", score: 0.75 },
      { chunkId: "c3", score: 0.25 },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql.toLowerCase()).toContain("join kb_chunks");
    expect(calls[0].params).toEqual([
      USER_A.id,
      "d1",
      KB_LOCAL_VECTOR_MODEL,
      expect.stringMatching(/^\[0\.5,/),
      3,
    ]);
  });
});
