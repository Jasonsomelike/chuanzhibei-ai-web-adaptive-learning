import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 路由级集成测试用：只替换登录用户，其余走真实的内存 DB 与 /api/kb 路由。
 * 与 kb-route.test.ts 同一套做法，这里额外验证客户端适配器与服务端契约能对上。
 */
const authState = vi.hoisted(() => ({
  user: null as null | { readonly id: string; readonly email: string; readonly displayName: string },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => authState.user,
}));

const kbRoute = await import("../../app/api/kb/route");
const { __resetMemoryDbForTests, getDb } = await import("@/lib/db");

import type { UploadChunk, UploadDoc } from "@/lib/knowledge";
import {
  KB_CONFLICT_MESSAGE,
  KbConflictError,
  __resetKbStorageCacheForTests,
  createRemoteKbStorage,
  createSyncedKbStorage,
  getKbStorageForUser,
  isKbConflictError,
  type KbFetch,
  type KbVectorField,
} from "@/lib/kbRemote";
import type { KbStorage, KbStorageEstimate, KbWriteOptions } from "@/lib/kbStore";
import { deleteDocument, importDocument, updateDocKcIds } from "@/lib/kbStore";

// ── 本地假存储 ────────────────────────────────────────────────────

class MemoryKbStorage implements KbStorage {
  docs = new Map<string, UploadDoc>();
  chunks = new Map<string, UploadChunk>();
  putCalls = 0;

  async listDocs(directionId: string): Promise<readonly UploadDoc[]> {
    return [...this.docs.values()].filter((doc) => doc.directionId === directionId);
  }

  async listChunks(directionId: string): Promise<readonly UploadChunk[]> {
    return [...this.chunks.values()].filter((chunk) => chunk.directionId === directionId);
  }

  async getDoc(docId: string): Promise<UploadDoc | null> {
    return this.docs.get(docId) ?? null;
  }

  async putDocWithChunks(
    doc: UploadDoc,
    chunks: readonly UploadChunk[],
    _opts?: KbWriteOptions,
  ): Promise<void> {
    this.putCalls += 1;
    this.docs.set(doc.id, doc);
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
  }

  async removeDoc(docId: string): Promise<void> {
    this.docs.delete(docId);
    for (const [id, chunk] of this.chunks) {
      if (chunk.docId === docId) this.chunks.delete(id);
    }
  }

  async estimate(): Promise<KbStorageEstimate> {
    return {};
  }
}

// ── 假 /api/kb 服务端 ─────────────────────────────────────────────

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class FakeKbServer {
  readonly docs = new Map<string, { doc: UploadDoc; chunks: UploadChunk[] }>();
  readonly calls: Call[] = [];
  /** 设置后所有请求都按这个状态失败（模拟 401 / 500）。 */
  failStatus: number | null = null;
  /** PUT 一律 409（模拟其它设备已更新）。 */
  conflict = false;
  vectors: KbVectorField[] = [];
  private version = 0;

  seed(doc: UploadDoc, chunks: readonly UploadChunk[] = []): void {
    this.docs.set(doc.id, { doc: { ...doc, updatedAt: 1000 }, chunks: [...chunks] });
  }

  putCalls(): Call[] {
    return this.calls.filter((call) => call.method === "PUT");
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = new URL(input, "http://localhost");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    this.calls.push({ method, url: input, body });

    if (this.failStatus !== null) {
      return jsonResponse(
        { error: { code: "unauthorized", message: "请先登录" } },
        this.failStatus,
      );
    }

    if (method === "PUT") {
      if (this.conflict) {
        return jsonResponse(
          { error: { code: "CONFLICT_STALE", message: "版本冲突" } },
          409,
        );
      }
      const payload = body as {
        doc: UploadDoc;
        chunks: UploadChunk[];
        baseUpdatedAt: number | null;
      };
      const existing = this.docs.get(payload.doc.id);
      if (
        (existing === undefined && payload.baseUpdatedAt !== null) ||
        (existing !== undefined && payload.baseUpdatedAt !== (existing.doc.updatedAt ?? null))
      ) {
        return jsonResponse({ error: { code: "CONFLICT_STALE", message: "版本冲突" } }, 409);
      }
      this.version += 1;
      const updatedAt = Math.max(1000 + this.version, (existing?.doc.updatedAt ?? 0) + 1);
      const saved: UploadDoc = { ...payload.doc, updatedAt };
      this.docs.set(saved.id, { doc: saved, chunks: [...payload.chunks] });
      return jsonResponse({
        doc: saved,
        updatedAt,
        storedChunks: payload.chunks.length,
        deletedChunks: 0,
        embeddedChunks: 0,
      });
    }

    if (method === "DELETE") {
      const docId = url.searchParams.get("docId");
      const entry = docId === null ? undefined : this.docs.get(docId);
      if (docId !== null) this.docs.delete(docId);
      return jsonResponse({
        deletedDocs: entry === undefined ? 0 : 1,
        deletedChunks: entry?.chunks.length ?? 0,
      });
    }

    if (url.searchParams.get("vectors") === "1") {
      const after = url.searchParams.get("after");
      const limitRaw = Number(url.searchParams.get("limit") ?? "100");
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100;
      const remaining = this.vectors
        .filter((vector) => after === null || vector.id > after)
        .sort((a, b) => a.id.localeCompare(b.id));
      const page = remaining.slice(0, limit);
      const hasMore = remaining.length > limit;
      const next = hasMore && page.length > 0 ? page[page.length - 1].id : null;
      return jsonResponse({ vectors: page, next });
    }

    const docId = url.searchParams.get("docId");
    if (docId !== null) {
      const entry = this.docs.get(docId);
      if (entry === undefined) {
        return jsonResponse({ error: { code: "not_found", message: "文档不存在" } }, 404);
      }
      return jsonResponse({ doc: entry.doc });
    }

    const directionId = url.searchParams.get("directionId") ?? "";
    const entries = [...this.docs.values()].filter(
      (entry) => entry.doc.directionId === directionId,
    );
    return jsonResponse({
      docs: entries.map((entry) => entry.doc),
      chunks: entries.flatMap((entry) => entry.chunks),
    });
  };
}

// ── 测试数据 ──────────────────────────────────────────────────────

function makeDoc(overrides: Partial<UploadDoc> & Pick<UploadDoc, "id">): UploadDoc {
  return {
    directionId: "dir-1",
    title: "数据结构讲义",
    fileName: "ds.md",
    kind: "md",
    size: 1024,
    charCount: 100,
    chunkCount: 1,
    kcIds: [],
    createdAt: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

function makeChunks(doc: UploadDoc, count = 1): UploadChunk[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${doc.id}:${index}`,
    docId: doc.id,
    directionId: doc.directionId,
    title: doc.title,
    section: `第${index + 1}节`,
    text: `第 ${index + 1} 段正文。`,
    index,
  }));
}

function seedLocal(local: MemoryKbStorage, doc: UploadDoc, chunks = 1): void {
  local.docs.set(doc.id, doc);
  for (const chunk of makeChunks(doc, chunks)) local.chunks.set(chunk.id, chunk);
}

function makeVectors(count: number): KbVectorField[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `chunk-${String(index).padStart(3, "0")}`,
    embedding: [index / 100, 1],
    embeddingModel: "test-embed",
    embeddingDim: 2,
  }));
}

let server: FakeKbServer;
let local: MemoryKbStorage;

beforeEach(() => {
  server = new FakeKbServer();
  local = new MemoryKbStorage();
  __resetKbStorageCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function syncedStorage() {
  return createSyncedKbStorage(local, createRemoteKbStorage({ fetchImpl: server.fetch }));
}

/** 把 fetch 转发给真实的 /api/kb 路由；写请求带上同源 Origin。 */
const routeFetch: KbFetch = async (input, init) => {
  const url = new URL(input, "http://localhost");
  const headers = new Headers(init?.headers);
  headers.set("origin", "http://localhost");
  const request = new Request(url.toString(), {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body === undefined ? {} : { body: init.body }),
  });
  const method = request.method.toUpperCase();
  if (method === "PUT") return kbRoute.PUT(request);
  if (method === "DELETE") return kbRoute.DELETE(request);
  return kbRoute.GET(request);
};

// ── 读：并集与回退 ────────────────────────────────────────────────

describe("复合存储读取", () => {
  it("本地 + 远端按 id 求并集，同名文档以远端为准", async () => {
    seedLocal(local, makeDoc({ id: "doc-a", title: "本机版" }));
    seedLocal(local, makeDoc({ id: "doc-shared", title: "本机共享版" }));
    server.seed(makeDoc({ id: "doc-a", title: "远端同名版" }));
    server.seed(makeDoc({ id: "doc-shared", title: "远端共享版" }));
    server.seed(makeDoc({ id: "doc-b" }));

    const storage = syncedStorage();
    const docs = await storage.listDocs("dir-1");

    expect(docs.map((doc) => doc.id).sort()).toEqual(["doc-a", "doc-b", "doc-shared"]);
    expect(docs.find((doc) => doc.id === "doc-a")?.title).toBe("远端同名版");
    expect(docs.find((doc) => doc.id === "doc-shared")?.title).toBe("远端共享版");
    // 远端已包含全部本地文档，不该触发首次回传
    expect(server.putCalls()).toHaveLength(0);
  });

  it("远端 401 时回退本地并给出同步告警", async () => {
    seedLocal(local, makeDoc({ id: "doc-a" }));
    server.failStatus = 401;

    const storage = syncedStorage();
    const docs = await storage.listDocs("dir-1");
    const chunks = await storage.listChunks("dir-1");

    expect(docs.map((doc) => doc.id)).toEqual(["doc-a"]);
    expect(chunks.map((chunk) => chunk.id)).toEqual(["doc-a:0"]);
    expect(storage.syncWarning()).toContain("登录已过期");
  });

  it("getDoc 远端优先；远端 404 时回退本地", async () => {
    seedLocal(local, makeDoc({ id: "doc-a", title: "本机版" }));
    server.seed(makeDoc({ id: "doc-a", title: "远端版" }));

    const storage = syncedStorage();
    expect((await storage.getDoc("doc-a"))?.title).toBe("远端版");
    expect(await storage.getDoc("doc-missing")).toBeNull();
  });

  it("listDocs 与 listChunks 并发只发一次远端 GET", async () => {
    server.seed(makeDoc({ id: "doc-a" }), makeChunks(makeDoc({ id: "doc-a" }), 2));

    const storage = syncedStorage();
    const [docs, chunks] = await Promise.all([
      storage.listDocs("dir-1"),
      storage.listChunks("dir-1"),
    ]);

    expect(docs).toHaveLength(1);
    expect(chunks).toHaveLength(2);
    const gets = server.calls.filter((call) => call.method === "GET");
    expect(gets).toHaveLength(1);
  });
});

// ── 首次登录回传 ──────────────────────────────────────────────────

describe("首次登录回传", () => {
  it("把本地有、远端无的文档连同片段推一次；第二次读取不再推", async () => {
    seedLocal(local, makeDoc({ id: "doc-local" }), 2);

    const storage = syncedStorage();
    const docs = await storage.listDocs("dir-1");

    expect(docs.map((doc) => doc.id)).toEqual(["doc-local"]);
    const pushes = server.putCalls();
    expect(pushes).toHaveLength(1);
    const body = pushes[0].body as {
      doc: UploadDoc;
      chunks: UploadChunk[];
      baseUpdatedAt: number | null;
    };
    expect(body.doc.id).toBe("doc-local");
    expect(body.chunks).toHaveLength(2);
    expect(body.baseUpdatedAt).toBeNull();
    // 本地补上了服务端版本号，后续改绑定才有 CAS 基准
    expect(typeof local.docs.get("doc-local")?.updatedAt).toBe("number");

    await storage.listDocs("dir-1");
    expect(server.putCalls()).toHaveLength(1);
  });

  it("回传遇到 409 只跳过，不影响读取与后续重试", async () => {
    seedLocal(local, makeDoc({ id: "doc-local" }));
    // GET 时远端还没有这篇（另一台设备在 GET 与 PUT 之间推送），PUT 返回 409
    server.conflict = true;

    const storage = syncedStorage();
    const docs = await storage.listDocs("dir-1");

    expect(docs.map((doc) => doc.id)).toEqual(["doc-local"]);
    expect(storage.syncWarning()).toBeNull();
    expect(server.putCalls()).toHaveLength(1);
  });
});

// ── 写：本地 + 远端 ───────────────────────────────────────────────

describe("复合存储写入", () => {
  it("本地与远端都写；远端回写的版本号补到本地", async () => {
    const doc = makeDoc({ id: "doc-new" });
    const chunks = makeChunks(doc, 2);

    const storage = syncedStorage();
    await storage.putDocWithChunks(doc, chunks);

    expect(local.docs.get("doc-new")?.title).toBe(doc.title);
    expect(local.chunks.size).toBe(2);
    expect(server.docs.get("doc-new")?.doc.updatedAt).toBeGreaterThan(0);
    expect(typeof local.docs.get("doc-new")?.updatedAt).toBe("number");
    expect(storage.syncWarning()).toBeNull();
  });

  it("409 转成 KbConflictError：本地保留，文案提示刷新", async () => {
    server.conflict = true;
    const doc = makeDoc({ id: "doc-conflict" });

    const storage = syncedStorage();
    let caught: unknown = null;
    try {
      await storage.putDocWithChunks(doc, makeChunks(doc, 1));
    } catch (err) {
      caught = err;
    }

    expect(isKbConflictError(caught)).toBe(true);
    expect(caught).toBeInstanceOf(KbConflictError);
    expect((caught as Error).message).toBe(KB_CONFLICT_MESSAGE);
    expect((caught as Error).message).toContain("刷新");
    expect(local.docs.has("doc-conflict")).toBe(true);
    expect(storage.syncWarning()).toContain("刷新");
  });

  it("远端 500 不抛错：本地写入保留并置告警", async () => {
    server.failStatus = 500;
    const doc = makeDoc({ id: "doc-offline" });

    const storage = syncedStorage();
    await expect(storage.putDocWithChunks(doc, makeChunks(doc, 1))).resolves.toBeUndefined();

    expect(local.docs.has("doc-offline")).toBe(true);
    expect(storage.syncWarning()).not.toBeNull();
  });

  it("删除同时删本地与远端", async () => {
    seedLocal(local, makeDoc({ id: "doc-a" }));
    server.seed(makeDoc({ id: "doc-a" }));

    const storage = syncedStorage();
    await storage.removeDoc("doc-a");

    expect(local.docs.has("doc-a")).toBe(false);
    expect(server.docs.has("doc-a")).toBe(false);
  });

  it("远端删除失败时本机已删，但告警保留", async () => {
    seedLocal(local, makeDoc({ id: "doc-a" }));
    server.failStatus = 401;

    const storage = syncedStorage();
    await storage.removeDoc("doc-a");

    expect(local.docs.has("doc-a")).toBe(false);
    expect(storage.syncWarning()).toContain("登录已过期");
  });
});

// ── 上传 / 删除 / 改绑定：与 knowledge-upload / 面板走同一条链路 ──

describe("上传链路与 /api/kb", () => {
  it("登录用户上传后远端能读到同一 doc；改绑定与删除也发到 /api/kb", async () => {
    const storage = syncedStorage();
    const doc = makeDoc({ id: "doc-upload", chunkCount: 2 });
    const chunks = makeChunks(doc, 2);

    // knowledge-upload 的写入路径：importDocument(storage, doc, chunks)
    const imported = await importDocument(storage, doc, chunks);
    expect(imported.ok).toBe(true);

    // 模拟换设备：新建一个远端适配器，GET /api/kb 能读到同一份文档
    const otherDevice = createRemoteKbStorage({ fetchImpl: server.fetch });
    const fetched = await otherDevice.getDoc("doc-upload");
    expect(fetched?.id).toBe("doc-upload");
    expect(fetched?.directionId).toBe("dir-1");
    expect(server.docs.get("doc-upload")?.chunks).toHaveLength(2);

    // 改绑定：面板的 updateDocKcIds 必须 PUT /api/kb，服务端 kcIds 更新
    const bound = await updateDocKcIds(storage, "doc-upload", ["kc-1", "kc-2"]);
    expect(bound.ok).toBe(true);
    expect(server.docs.get("doc-upload")?.doc.kcIds).toEqual(["kc-1", "kc-2"]);
    expect(server.docs.get("doc-upload")?.chunks).toHaveLength(2);

    // 删除：面板的 deleteDocument 必须 DELETE /api/kb，远端不再有这份文档
    const removed = await deleteDocument(storage, "doc-upload");
    expect(removed.ok).toBe(true);
    expect(server.docs.has("doc-upload")).toBe(false);
    expect(server.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });

  it("冲突时上传不误报成功：错误文案指向刷新", async () => {
    const storage = syncedStorage();
    const doc = makeDoc({ id: "doc-stale", chunkCount: 1 });
    server.conflict = true;

    const result = await importDocument(storage, doc, makeChunks(doc, 1));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("文档已在其他设备更新，请刷新后重试");
  });
});

// ── 真实 /api/kb 路由（内存 DB） ──────────────────────────────────

describe("真实 /api/kb 路由", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    delete process.env.DATABASE_URL;
    __resetMemoryDbForTests();
    authState.user = { id: "user-kb", email: "kb@test.local", displayName: "KB" };
    await getDb();
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("登录用户上传后 GET /api/kb 能读到同一 doc；改绑定与删除同样生效", async () => {
    const storage = createSyncedKbStorage(local, createRemoteKbStorage({ fetchImpl: routeFetch }));
    const doc = makeDoc({ id: "doc-route", chunkCount: 2 });
    const chunks = makeChunks(doc, 2);

    // knowledge-upload 的写入路径
    expect((await importDocument(storage, doc, chunks)).ok).toBe(true);

    // 换一台设备：新的远端适配器直接打真实路由
    const otherDevice = createRemoteKbStorage({ fetchImpl: routeFetch });
    const fetched = await otherDevice.getDoc("doc-route");
    expect(fetched?.id).toBe("doc-route");
    expect(fetched?.directionId).toBe("dir-1");
    expect(fetched?.chunkCount).toBe(2);

    const listed = await otherDevice.listDocs("dir-1");
    expect(listed.map((item) => item.id)).toEqual(["doc-route"]);
    const listedChunks = await otherDevice.listChunks("dir-1");
    expect(listedChunks.map((chunk) => chunk.id).sort()).toEqual(["doc-route:0", "doc-route:1"]);

    // 面板的改绑定：PUT /api/kb，服务端 kcIds 更新
    const bound = await updateDocKcIds(storage, "doc-route", ["kc-9"]);
    expect(bound.ok).toBe(true);
    expect((await otherDevice.getDoc("doc-route"))?.kcIds).toEqual(["kc-9"]);

    // 面板的删除：DELETE /api/kb，远端不再返回
    expect((await deleteDocument(storage, "doc-route")).ok).toBe(true);
    expect(await otherDevice.getDoc("doc-route")).toBeNull();
  });
});

// ── 向量分页 ──────────────────────────────────────────────────────

describe("向量分页", () => {
  it("按 next 循环取完 150 条，第二页带 after 且 limit=100", async () => {
    server.vectors = makeVectors(150);
    const remote = createRemoteKbStorage({ fetchImpl: server.fetch });

    const rows = await remote.loadVectors("dir-1");

    expect(rows).toHaveLength(150);
    expect(rows[0].id).toBe("chunk-000");
    expect(rows[149].id).toBe("chunk-149");

    const vectorCalls = server.calls.filter(
      (call) => call.method === "GET" && call.url.includes("vectors=1"),
    );
    expect(vectorCalls).toHaveLength(2);
    expect(vectorCalls[0].url).toContain("limit=100");
    expect(vectorCalls[0].url).not.toContain("after=");
    expect(vectorCalls[1].url).toContain("after=chunk-099");
  });

  it("401 时复合存储返回空向量并告警，不抛错", async () => {
    server.failStatus = 401;
    const storage = syncedStorage();

    await expect(storage.loadVectors("dir-1")).resolves.toEqual([]);
    expect(storage.syncWarning()).toContain("登录已过期");
  });
});

// ── 存储解析器 ────────────────────────────────────────────────────

describe("getKbStorageForUser", () => {
  it("未登录返回本机存储（Node 没有 indexedDB 时为 null）", () => {
    expect(getKbStorageForUser("")).toBeNull();
    expect(getKbStorageForUser(null)).toBeNull();
    expect(getKbStorageForUser(undefined)).toBeNull();
  });

  it("同一账号复用同一实例，重置后换新实例", () => {
    const first = getKbStorageForUser("user-a");
    expect(first).not.toBeNull();
    expect(getKbStorageForUser("user-a")).toBe(first);
    expect(getKbStorageForUser("user-b")).not.toBe(first);

    __resetKbStorageCacheForTests();
    expect(getKbStorageForUser("user-a")).not.toBe(first);
  });
});

// ── 全局 fetch 兜底 ───────────────────────────────────────────────

describe("全局 fetch", () => {
  it("不注入 fetchImpl 时走 globalThis.fetch", async () => {
    const stub = vi.fn(
      async (_input: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({ docs: [], chunks: [] }),
    );
    vi.stubGlobal("fetch", stub);

    const remote = createRemoteKbStorage();
    await remote.listDocs("dir-1");

    expect(stub).toHaveBeenCalledTimes(1);
    expect(String(stub.mock.calls[0][0])).toContain("/api/kb?directionId=dir-1");
  });
});
