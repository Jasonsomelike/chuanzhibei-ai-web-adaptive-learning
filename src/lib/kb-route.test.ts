import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetMemoryDbForTests, getDb } from "@/lib/db";
import { MAX_KB_PUT_BYTES } from "@/lib/kbServer";

/**
 * 路由级回归：用真实的内存 DB，只替换登录用户。
 *
 * 覆盖重点：
 * - PUT→GET 往返与向量分页（next 能一路走到 null）；
 * - 两用户隔离；
 * - baseUpdatedAt 过期的 409 不覆盖任何行；
 * - PUT /api/memories 不删除未提交的 mem_id，删除只走显式 DELETE；
 * - 没有 Content-Length 的 chunked 请求也必须被请求体上限拦住。
 */

const authState = vi.hoisted(() => ({
  user: null as null | { readonly id: string; readonly email: string; readonly displayName: string },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => authState.user,
}));

const { GET: kbGet, PUT: kbPut, DELETE: kbDelete } = await import("../../app/api/kb/route");
const {
  GET: memoriesGet,
  PUT: memoriesPut,
  DELETE: memoriesDelete,
} = await import("../../app/api/memories/route");

const USER_A = { id: "user-a", email: "a@test.local", displayName: "A" };
const USER_B = { id: "user-b", email: "b@test.local", displayName: "B" };
const BASE = "2026-10-29T00:00:00.000Z";

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string): Request {
  return new Request(url, { headers: { origin: "http://localhost" } });
}

function chunk(index: number) {
  return {
    id: `doc-1:${index}`,
    docId: "doc-1",
    directionId: "d1",
    title: "数据结构讲义",
    section: "栈",
    text: `第 ${index} 段：栈是后进先出的线性表。`,
    index,
    embedding: [0.1 + index, 0.2, 0.3],
    embeddingModel: "test-embed",
    embeddingDim: 3,
  };
}

function kbPayload(count = 2, overrides: Record<string, unknown> = {}) {
  const chunks = Array.from({ length: count }, (_, index) => chunk(index));
  return {
    doc: {
      id: "doc-1",
      directionId: "d1",
      title: "数据结构讲义",
      fileName: "ds.md",
      kind: "md",
      size: 2048,
      charCount: 200,
      chunkCount: count,
      kcIds: ["k1"],
      createdAt: BASE,
    },
    chunks,
    baseUpdatedAt: null,
    ...overrides,
  };
}

function memoryCard(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "error",
    kcId: "k1",
    questionId: `q-${id}`,
    prompt: "栈的出栈顺序",
    correction: "后进先出",
    createdAt: BASE,
    lastSeenAt: BASE,
    status: "open",
    streak: 0,
    reviewCount: 0,
    ...overrides,
  };
}

const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  __resetMemoryDbForTests();
  authState.user = USER_A;
  await getDb();
});

afterAll(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("GET /api/kb", () => {
  it("PUT→GET 往返；默认响应不含 embedding", async () => {
    const put = await kbPut(jsonRequest("http://localhost/api/kb", "PUT", kbPayload()));
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { updatedAt: number; doc: { title: string } };
    expect(putBody.updatedAt).toBeGreaterThan(0);
    expect(putBody.doc.title).toBe("数据结构讲义");

    const res = await kbGet(getRequest("http://localhost/api/kb?directionId=d1"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      docs: { id: string; chunkCount: number }[];
      chunks: Record<string, unknown>[];
    };
    expect(data.docs).toHaveLength(1);
    expect(data.docs[0].chunkCount).toBe(2);
    expect(data.chunks).toHaveLength(2);
    for (const item of data.chunks) {
      expect(item).not.toHaveProperty("embedding");
      expect(item).not.toHaveProperty("embeddingModel");
      expect(item).not.toHaveProperty("embeddingDim");
    }
  });

  it("?docId= 返回单文档，不存在时 404", async () => {
    await kbPut(jsonRequest("http://localhost/api/kb", "PUT", kbPayload()));

    const found = await kbGet(getRequest("http://localhost/api/kb?docId=doc-1"));
    expect(found.status).toBe(200);
    const data = (await found.json()) as { doc: { id: string } };
    expect(data.doc.id).toBe("doc-1");

    const missing = await kbGet(getRequest("http://localhost/api/kb?docId=doc-404"));
    expect(missing.status).toBe(404);
  });

  it("vectors=1 按 chunk_id 升序分页，next 可以循环到 null", async () => {
    await kbPut(jsonRequest("http://localhost/api/kb", "PUT", kbPayload(5)));

    const seen: string[] = [];
    let after: string | null = null;
    for (let round = 0; round < 10; round += 1) {
      const query = new URLSearchParams({ directionId: "d1", vectors: "1", limit: "2" });
      if (after !== null) query.set("after", after);
      const res = await kbGet(getRequest(`http://localhost/api/kb?${query.toString()}`));
      expect(res.status).toBe(200);
      const page = (await res.json()) as {
        vectors: { id: string; embedding: number[]; embeddingDim: number }[];
        next: string | null;
      };
      seen.push(...page.vectors.map((vector) => vector.id));
      for (const vector of page.vectors) {
        expect(vector.embedding).toHaveLength(3);
        expect(vector.embeddingDim).toBe(3);
      }
      if (page.next === null) break;
      after = page.next;
    }

    expect(seen).toEqual(["doc-1:0", "doc-1:1", "doc-1:2", "doc-1:3", "doc-1:4"]);
  });

  it("limit 超出范围被夹到 1..100", async () => {
    await kbPut(jsonRequest("http://localhost/api/kb", "PUT", kbPayload(3)));

    const capped = await kbGet(
      getRequest("http://localhost/api/kb?directionId=d1&vectors=1&limit=999"),
    );
    const cappedPage = (await capped.json()) as { vectors: unknown[]; next: string | null };
    expect(cappedPage.vectors).toHaveLength(3);
    expect(cappedPage.next).toBeNull();

    const floor = await kbGet(
      getRequest("http://localhost/api/kb?directionId=d1&vectors=1&limit=0"),
    );
    const floorPage = (await floor.json()) as { vectors: unknown[]; next: string | null };
    expect(floorPage.vectors).toHaveLength(1);
    expect(floorPage.next).toBe("doc-1:0");
  });

  it("缺参数或两个都传返回 400", async () => {
    expect((await kbGet(getRequest("http://localhost/api/kb"))).status).toBe(400);
    expect(
      (await kbGet(getRequest("http://localhost/api/kb?docId=doc-1&directionId=d1"))).status,
    ).toBe(400);
  });
});

describe("用户隔离", () => {
  it("用户 B 读不到用户 A 的知识库；同 doc_id 写入互不覆盖", async () => {
    await kbPut(jsonRequest("http://localhost/api/kb", "PUT", kbPayload()));

    authState.user = USER_B;
    const before = await kbGet(getRequest("http://localhost/api/kb?directionId=d1"));
    const empty = (await before.json()) as { docs: unknown[]; chunks: unknown[] };
    expect(empty.docs).toEqual([]);
    expect(empty.chunks).toEqual([]);

    const payloadB = kbPayload(1);
    const putB = await kbPut(
      jsonRequest("http://localhost/api/kb", "PUT", {
        ...payloadB,
        doc: { ...payloadB.doc, title: "B 的讲义" },
      }),
    );
    expect(putB.status).toBe(200);

    authState.user = USER_A;
    const back = await kbGet(getRequest("http://localhost/api/kb?directionId=d1"));
    const aData = (await back.json()) as { docs: { title: string }[] };
    expect(aData.docs).toHaveLength(1);
    expect(aData.docs[0].title).toBe("数据结构讲义");
  });

  it("记忆卡同样按用户隔离", async () => {
    await memoriesPut(
      jsonRequest("http://localhost/api/memories", "PUT", {
        subjectId: "ds",
        memories: [memoryCard("mem-error-q1")],
      }),
    );

    authState.user = USER_B;
    const res = await memoriesGet(getRequest("http://localhost/api/memories?subjectId=ds"));
    const data = (await res.json()) as { memories: unknown[] };
    expect(data.memories).toEqual([]);
  });
});

describe("鉴权与写保护", () => {
  it("未登录时 GET/PUT/DELETE 都是 401，且不写任何行", async () => {
    authState.user = null;

    expect((await kbGet(getRequest("http://localhost/api/kb?directionId=d1"))).status).toBe(401);
    expect(
      (await kbPut(jsonRequest("http://localhost/api/kb", "PUT", kbPayload()))).status,
    ).toBe(401);
    expect((await kbDelete(getRequest("http://localhost/api/kb?docId=doc-1"))).status).toBe(401);

    expect((await memoriesGet(getRequest("http://localhost/api/memories?subjectId=ds"))).status).toBe(
      401,
    );
    expect(
      (
        await memoriesPut(
          jsonRequest("http://localhost/api/memories", "PUT", {
            subjectId: "ds",
            memories: [memoryCard("mem-error-q1")],
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (await memoriesDelete(getRequest("http://localhost/api/memories?memId=mem-error-q1"))).status,
    ).toBe(401);
  });

  it("跨站写请求 403", async () => {
    const request = new Request("http://localhost/api/kb", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify(kbPayload()),
    });
    expect((await kbPut(request)).status).toBe(403);
  });

  it("非 application/json 的 PUT 415", async () => {
    const request = new Request("http://localhost/api/kb", {
      method: "PUT",
      headers: { "content-type": "text/plain", origin: "http://localhost" },
      body: "{}",
    });
    expect((await kbPut(request)).status).toBe(415);
  });

  it("超过请求体上限且没有 Content-Length 的流式请求 413", async () => {
    const total = MAX_KB_PUT_BYTES + 1;
    const chunkBytes = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let sent = 0;
        while (sent < total) {
          const size = Math.min(chunkBytes.byteLength, total - sent);
          controller.enqueue(chunkBytes.slice(0, size));
          sent += size;
        }
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/kb", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: stream,
      duplex: "half",
    } as RequestInit);

    const res = await kbPut(request);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("payload_too_large");
  });
});

describe("文档级 LWW", () => {
  it("baseUpdatedAt 是旧版本时 409，且服务端内容不被覆盖", async () => {
    const first = await kbPut(jsonRequest("http://localhost/api/kb", "PUT", kbPayload()));
    const firstBody = (await first.json()) as { updatedAt: number };

    const stalePayload = kbPayload(2, {
      baseUpdatedAt: firstBody.updatedAt - 1,
      doc: { ...kbPayload().doc, title: "旧设备试图覆盖" },
    });
    const stale = await kbPut(jsonRequest("http://localhost/api/kb", "PUT", stalePayload));
    expect(stale.status).toBe(409);
    const staleBody = (await stale.json()) as { error: { code: string; message: string } };
    expect(staleBody.error.code).toBe("CONFLICT_STALE");
    expect(staleBody.error.message).toContain("版本冲突");

    const res = await kbGet(getRequest("http://localhost/api/kb?docId=doc-1"));
    const data = (await res.json()) as { doc: { title: string; updatedAt: number } };
    expect(data.doc.title).toBe("数据结构讲义");
    expect(data.doc.updatedAt).toBe(firstBody.updatedAt);
  });

  it("新文档带 baseUpdatedAt 也是 409", async () => {
    const res = await kbPut(
      jsonRequest("http://localhost/api/kb", "PUT", kbPayload(2, { baseUpdatedAt: 1 })),
    );
    expect(res.status).toBe(409);
  });

  it("PUT 用本次列表替换片段：列表外的旧片段被删掉", async () => {
    const first = await kbPut(jsonRequest("http://localhost/api/kb", "PUT", kbPayload(3)));
    const firstBody = (await first.json()) as { updatedAt: number };

    const second = await kbPut(
      jsonRequest(
        "http://localhost/api/kb",
        "PUT",
        kbPayload(1, {
          baseUpdatedAt: firstBody.updatedAt,
        }),
      ),
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { deletedChunks: number };
    expect(body.deletedChunks).toBe(2);
  });
});

describe("DELETE /api/kb", () => {
  it("?docId= 与 ?directionId= 返回真实删除数", async () => {
    await kbPut(jsonRequest("http://localhost/api/kb", "PUT", kbPayload(2)));

    const byDirection = await kbDelete(
      getRequest("http://localhost/api/kb?directionId=d1"),
    );
    expect(byDirection.status).toBe(200);
    expect(await byDirection.json()).toEqual({ deletedDocs: 1, deletedChunks: 2 });

    const again = await kbDelete(getRequest("http://localhost/api/kb?docId=doc-1"));
    expect(await again.json()).toEqual({ deletedDocs: 0, deletedChunks: 0 });
  });

  it("缺参数返回 400", async () => {
    expect((await kbDelete(getRequest("http://localhost/api/kb"))).status).toBe(400);
  });
});

describe("/api/memories", () => {
  it("PUT 只 upsert，不删除未提交的 mem_id", async () => {
    const first = await memoriesPut(
      jsonRequest("http://localhost/api/memories", "PUT", {
        subjectId: "ds",
        memories: [memoryCard("mem-error-q1"), memoryCard("mem-error-q2")],
      }),
    );
    expect(first.status).toBe(200);

    const partial = await memoriesPut(
      jsonRequest("http://localhost/api/memories", "PUT", {
        subjectId: "ds",
        memories: [memoryCard("mem-error-q1", { prompt: "只提交第一张" })],
      }),
    );
    const partialBody = (await partial.json()) as { stored: number; skippedStale: number };
    expect(partialBody.stored).toBe(1);
    expect(partialBody.skippedStale).toBe(0);

    const res = await memoriesGet(getRequest("http://localhost/api/memories?subjectId=ds"));
    const data = (await res.json()) as { memories: { id: string; prompt: string }[] };
    expect(data.memories.map((item) => item.id).sort()).toEqual([
      "mem-error-q1",
      "mem-error-q2",
    ]);
    expect(data.memories.find((item) => item.id === "mem-error-q1")?.prompt).toBe(
      "只提交第一张",
    );
  });

  it("旧时间戳的卡被跳过，内容不变", async () => {
    await memoriesPut(
      jsonRequest("http://localhost/api/memories", "PUT", {
        subjectId: "ds",
        memories: [memoryCard("mem-error-q1", { lastSeenAt: "2026-10-29T00:00:00.000Z" })],
      }),
    );

    const stale = await memoriesPut(
      jsonRequest("http://localhost/api/memories", "PUT", {
        subjectId: "ds",
        memories: [
          memoryCard("mem-error-q1", {
            prompt: "旧设备的正文",
            // createdAt 也必须更旧，否则 max(lastSeenAt, createdAt) 仍是新版本
            createdAt: "2026-10-20T00:00:00.000Z",
            lastSeenAt: "2026-10-25T00:00:00.000Z",
          }),
        ],
      }),
    );
    const body = (await stale.json()) as { stored: number; skippedStale: number };
    expect(body).toMatchObject({ stored: 0, skippedStale: 1 });

    const res = await memoriesGet(getRequest("http://localhost/api/memories?subjectId=ds"));
    const data = (await res.json()) as { memories: { prompt: string }[] };
    expect(data.memories[0].prompt).toBe("栈的出栈顺序");
  });

  it("显式 DELETE ?memId= 生效，未删的卡保留", async () => {
    await memoriesPut(
      jsonRequest("http://localhost/api/memories", "PUT", {
        subjectId: "ds",
        memories: [memoryCard("mem-error-q1"), memoryCard("mem-error-q2")],
      }),
    );

    const res = await memoriesDelete(
      getRequest("http://localhost/api/memories?memId=mem-error-q1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });

    const list = await memoriesGet(getRequest("http://localhost/api/memories?subjectId=ds"));
    const data = (await list.json()) as { memories: { id: string }[] };
    expect(data.memories.map((item) => item.id)).toEqual(["mem-error-q2"]);
  });

  it("显式 DELETE ?subjectId= 清空整个学科", async () => {
    await memoriesPut(
      jsonRequest("http://localhost/api/memories", "PUT", {
        subjectId: "ds",
        memories: [memoryCard("mem-error-q1"), memoryCard("mem-error-q2")],
      }),
    );

    const res = await memoriesDelete(
      getRequest("http://localhost/api/memories?subjectId=ds"),
    );
    expect(await res.json()).toEqual({ deleted: 2 });

    const list = await memoriesGet(getRequest("http://localhost/api/memories?subjectId=ds"));
    const data = (await list.json()) as { memories: unknown[] };
    expect(data.memories).toEqual([]);
  });

  it("不符合 memoriesPut 契约的请求 400（未知字段、重复 id）", async () => {
    const unknownField = await memoriesPut(
      jsonRequest("http://localhost/api/memories", "PUT", {
        subjectId: "ds",
        memories: [{ ...memoryCard("mem-error-q1"), extra: "不该被接受" }],
      }),
    );
    expect(unknownField.status).toBe(400);

    const duplicate = await memoriesPut(
      jsonRequest("http://localhost/api/memories", "PUT", {
        subjectId: "ds",
        memories: [memoryCard("mem-error-q1"), memoryCard("mem-error-q1")],
      }),
    );
    expect(duplicate.status).toBe(400);
  });

  it("缺 subjectId 的 GET 返回 400；缺主键的 DELETE 返回 400", async () => {
    expect((await memoriesGet(getRequest("http://localhost/api/memories"))).status).toBe(400);
    expect((await memoriesDelete(getRequest("http://localhost/api/memories"))).status).toBe(400);
  });

  it("超过 1MB 的 PUT 413", async () => {
    const total = 1024 * 1024 + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(total));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/memories", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: stream,
      duplex: "half",
    } as RequestInit);

    const res = await memoriesPut(request);
    expect(res.status).toBe(413);
  });
});
