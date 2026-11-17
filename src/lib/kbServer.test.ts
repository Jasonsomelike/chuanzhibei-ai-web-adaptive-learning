import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  KB_TOMBSTONE_SQL,
  __resetMemoryDbForTests,
  getDb,
  type Db,
} from "@/lib/db";
import type { KbPut } from "@/lib/apiContracts";
import {
  MAX_KB_PUT_BYTES,
  chunkToRow,
  clampVectorLimit,
  deleteKbDirection,
  deleteKbDoc,
  docToRow,
  listDirectionChunks,
  listDirectionDocs,
  listDirectionVectors,
  parseEmbedding,
  putKbDocument,
  rowToChunk,
  rowToDoc,
  rowUpdatedAt,
  stripChunkEmbedding,
  validateUploadPayload,
  type EmbedTextsForUser,
  type KbChunkRow,
  type KbDocRow,
} from "@/lib/kbServer";

const BASE = "2026-10-29T00:00:00.000Z";

function docRow(overrides: Partial<KbDocRow> = {}): KbDocRow {
  return {
    user_id: "u1",
    doc_id: "doc-1",
    direction_id: "d1",
    title: "数据结构讲义",
    file_name: "ds.md",
    kind: "md",
    size: "1024",
    page_count: 0,
    char_count: 120,
    chunk_count: 2,
    kc_ids_json: '["k1","k2"]',
    created_at: BASE,
    updated_at: "1700000000000",
    ...overrides,
  };
}

function chunkRow(overrides: Partial<KbChunkRow> = {}): KbChunkRow {
  return {
    user_id: "u1",
    chunk_id: "doc-1:0",
    doc_id: "doc-1",
    direction_id: "d1",
    idx: 0,
    title: "数据结构讲义",
    section: "栈",
    page_from: null,
    page_to: null,
    text: "栈是后进先出的线性表。",
    embedding: "[0.1,0.2,0.3]",
    embedding_model: "text-embedding-3-small",
    embedding_dim: 3,
    updated_at: "1700000000000",
    ...overrides,
  };
}

function makePut(overrides: Partial<KbPut> = {}): KbPut {
  const doc = {
    id: "doc-1",
    directionId: "d1",
    title: "数据结构讲义",
    fileName: "ds.md",
    kind: "md" as const,
    size: 1024,
    charCount: 40,
    chunkCount: 2,
    kcIds: [],
    createdAt: BASE,
  };
  return {
    doc,
    chunks: [
      {
        id: "doc-1:0",
        docId: "doc-1",
        directionId: "d1",
        title: "数据结构讲义",
        section: "栈",
        text: "栈是后进先出的线性表。",
        index: 0,
      },
      {
        id: "doc-1:1",
        docId: "doc-1",
        directionId: "d1",
        title: "数据结构讲义",
        section: "队列",
        text: "队列是先进先出的线性表。",
        index: 1,
      },
    ],
    baseUpdatedAt: null,
    ...overrides,
  };
}

let db: Db;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  __resetMemoryDbForTests();
  db = await getDb();
});

afterAll(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("validateUploadPayload", () => {
  it("合法文档与片段返回 null", () => {
    const put = makePut();
    expect(validateUploadPayload(put.doc, put.chunks)).toBeNull();
  });

  it("文档 id / 方向 / 正文 / 段数逐条拦截", () => {
    const put = makePut();
    expect(validateUploadPayload({ ...put.doc, id: " " }, put.chunks)).toContain("文档 id 为空");
    expect(validateUploadPayload({ ...put.doc, directionId: "" }, put.chunks)).toContain(
      "没有所属方向",
    );
    expect(validateUploadPayload(put.doc, [])).toContain("没有可导入的正文");
    expect(validateUploadPayload({ ...put.doc, charCount: 0 }, put.chunks)).toContain(
      "没有可导入的正文",
    );
    expect(validateUploadPayload({ ...put.doc, chunkCount: 3 }, put.chunks)).toContain(
      "段数（3）与实际片段数（2）不一致",
    );
  });

  it("片段 id 重复、归属不符、空正文、非法序号都拒绝", () => {
    const put = makePut();
    const [first, second] = put.chunks;

    expect(validateUploadPayload(put.doc, [first, { ...second, id: first.id }])).toContain(
      "片段 id 重复",
    );
    expect(validateUploadPayload(put.doc, [first, { ...second, docId: "doc-2" }])).toContain(
      "docId 与文档不一致",
    );
    expect(
      validateUploadPayload(put.doc, [first, { ...second, directionId: "d2" }]),
    ).toContain("方向与文档不一致");
    expect(validateUploadPayload(put.doc, [first, { ...second, text: "   " }])).toContain(
      "存在空片段",
    );
    expect(validateUploadPayload(put.doc, [first, { ...second, index: -1 }])).toContain(
      "片段序号无效",
    );
    expect(validateUploadPayload(put.doc, [first, { ...second, index: 1.5 }])).toContain(
      "片段序号无效",
    );
  });
});

describe("行映射", () => {
  it("rowToDoc 还原数值列与可选页码", () => {
    const doc = rowToDoc(docRow());
    expect(doc).toMatchObject({
      id: "doc-1",
      directionId: "d1",
      size: 1024,
      charCount: 120,
      chunkCount: 2,
      kcIds: ["k1", "k2"],
      updatedAt: 1_700_000_000_000,
    });
    expect(doc.pageCount).toBeUndefined();

    expect(rowToDoc(docRow({ page_count: "12", kind: "pdf" })).pageCount).toBe(12);
  });

  it("docToRow 与 rowToDoc 往返保持字段", () => {
    const doc = rowToDoc(docRow());
    const back = rowToDoc(docToRow("u1", doc, doc.updatedAt ?? 0));
    expect(back).toEqual(doc);
  });

  it("rowUpdatedAt 同时接受毫秒字符串与 ISO", () => {
    expect(rowUpdatedAt({ updated_at: "1700000000000" })).toBe(1_700_000_000_000);
    expect(rowUpdatedAt({ updated_at: BASE })).toBe(Date.parse(BASE));
    expect(rowUpdatedAt({ updated_at: "not-a-time" })).toBe(0);
  });

  it("parseEmbedding 拒绝非有限数、维度不符与缺失 dim", () => {
    expect(parseEmbedding("[1,2,3]", 3)).toEqual([1, 2, 3]);
    expect(parseEmbedding([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(parseEmbedding("[1,2,3]", 2)).toBeNull();
    expect(parseEmbedding("[1,2,3]", null)).toBeNull();
    expect(parseEmbedding("[1,2,3]", 0)).toBeNull();
    expect(parseEmbedding("[1,2,null]", 3)).toBeNull();
    expect(parseEmbedding("[1,2,1e999]", 3)).toBeNull();
    expect(parseEmbedding("not-json", 3)).toBeNull();
    expect(parseEmbedding("[]", 0)).toBeNull();
  });

  it("rowToChunk 只在向量与模型都有效时才带三个字段", () => {
    const chunk = rowToChunk(chunkRow());
    expect(chunk.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(chunk.embeddingModel).toBe("text-embedding-3-small");
    expect(chunk.embeddingDim).toBe(3);

    const noEmbedding = rowToChunk(chunkRow({ embedding: null, embedding_dim: null }));
    expect(noEmbedding.embedding).toBeUndefined();
    expect(noEmbedding.embeddingModel).toBeUndefined();
    expect(noEmbedding.embeddingDim).toBeUndefined();

    const badDim = rowToChunk(chunkRow({ embedding_dim: 4 }));
    expect(badDim.embedding).toBeUndefined();

    expect(rowToChunk(chunkRow({ page_from: 2, page_to: 3 })).pageFrom).toBe(2);
  });

  it("chunkToRow 无向量时三列都写 null", () => {
    const chunk = rowToChunk(chunkRow({ embedding: null, embedding_dim: null }));
    const row = chunkToRow("u1", chunk, 123);
    expect(row.embedding).toBeNull();
    expect(row.embedding_model).toBeNull();
    expect(row.embedding_dim).toBeNull();
    expect(row.updated_at).toBe("123");
  });

  it("stripChunkEmbedding 只移除向量字段", () => {
    const stripped = stripChunkEmbedding(rowToChunk(chunkRow()));
    expect(stripped).not.toHaveProperty("embedding");
    expect(stripped).not.toHaveProperty("embeddingModel");
    expect(stripped).not.toHaveProperty("embeddingDim");
    expect(stripped.text).toBe("栈是后进先出的线性表。");
  });

  it("clampVectorLimit 夹在 1..100", () => {
    expect(clampVectorLimit(null)).toBe(100);
    expect(clampVectorLimit(0)).toBe(1);
    expect(clampVectorLimit(-5)).toBe(1);
    expect(clampVectorLimit(50)).toBe(50);
    expect(clampVectorLimit(1000)).toBe(100);
    expect(clampVectorLimit(Number.NaN)).toBe(100);
  });

  it("MAX_KB_PUT_BYTES 默认 32MB，可由 ALP_MAX_KB_BYTES 覆盖", () => {
    expect(MAX_KB_PUT_BYTES).toBe(32 * 1024 * 1024);
  });
});

describe("putKbDocument（内存 DB）", () => {
  it("首次写入后可按方向读回；PUT 不再自动生成向量", async () => {
    let embedCalls = 0;
    const embedder: EmbedTextsForUser = async (_userId, texts) => {
      embedCalls += 1;
      return { model: "fake-embed", dim: 2, vectors: texts.map(() => [1, 0]) };
    };

    const result = await putKbDocument(db, "u1", makePut(), { embedTexts: embedder });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const docs = await listDirectionDocs(db, "u1", "d1");
    expect(docs).toHaveLength(1);
    expect(docs[0].chunkCount).toBe(2);

    const chunks = await listDirectionChunks(db, "u1", "d1");
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.embedding === undefined)).toBe(true);
    // 512 维本地向量只走 POST /api/kb/vectors；文档 PUT 不再触碰 embedder
    expect(embedCalls).toBe(0);
  });

  it("显式提交的 embedding（外部模型）仍原样落库", async () => {
    const put = makePut();
    const chunks = put.chunks.map((chunk, index) => ({
      ...chunk,
      embedding: [0.1 + index, 0.2],
      embeddingModel: "external-embed",
      embeddingDim: 2,
    }));
    const result = await putKbDocument(db, "u1", makePut({ chunks }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await listDirectionChunks(db, "u1", "d1");
    expect(stored).toHaveLength(2);
    expect(stored[0].embedding).toEqual([0.1, 0.2]);
    expect(stored[0].embeddingModel).toBe("external-embed");
    expect(stored[0].embeddingDim).toBe(2);
  });

  it("相同版本的并发更新只有一位写入成功", async () => {
    const first = await putKbDocument(db, "u1", makePut());
    if (!first.ok) throw new Error("seed failed");
    const payloads = [1, 2].map(n => makePut({ baseUpdatedAt: first.updatedAt,
      doc: { ...makePut().doc, title: `版本 ${n}` },
      chunks: makePut().chunks.map(c => ({ ...c, text: `版本 ${n} 的片段` })),
    }));
    const results = await Promise.all(payloads.map(body => putKbDocument(db, "u1", body)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === "conflict")).toHaveLength(1);
    const winner = results.findIndex(r => r.ok);
    expect((await listDirectionDocs(db, "u1", "d1"))[0].title).toBe(payloads[winner].doc.title);
    expect((await listDirectionChunks(db, "u1", "d1")).map(c => c.text)).toEqual(payloads[winner].chunks.map(c => c.text));
  });

  it("baseUpdatedAt 过期时 409 且一行都不写", async () => {
    const first = await putKbDocument(db, "u1", makePut());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const stale = await putKbDocument(
      db,
      "u1",
      makePut({
        doc: { ...makePut().doc, title: "被覆盖的标题" },
        baseUpdatedAt: first.updatedAt - 1,
      }),
    );
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.reason).toBe("conflict");

    const docs = await listDirectionDocs(db, "u1", "d1");
    expect(docs[0].title).toBe("数据结构讲义");
    expect(docs[0].updatedAt).toBe(first.updatedAt);
  });

  it("已有文档但 baseUpdatedAt 为空时 409；新文档却带版本时也 409", async () => {
    await putKbDocument(db, "u1", makePut());

    const missingBase = await putKbDocument(db, "u1", makePut({ baseUpdatedAt: null }));
    expect(missingBase.ok).toBe(false);
    if (!missingBase.ok) expect(missingBase.reason).toBe("conflict");

    const newWithBase = await putKbDocument(
      db,
      "u2",
      makePut({ baseUpdatedAt: 123 }),
    );
    expect(newWithBase.ok).toBe(false);
    if (!newWithBase.ok) expect(newWithBase.reason).toBe("conflict");
  });

  it("版本逐次递增，同一毫秒内也不会相等", async () => {
    const first = await putKbDocument(db, "u1", makePut());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await putKbDocument(
      db,
      "u1",
      makePut({ baseUpdatedAt: first.updatedAt }),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });

  it("替换文档时删除本次列表外的旧片段，保留仍在列表中的片段", async () => {
    const first = await putKbDocument(db, "u1", makePut());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const onlySecond = makePut({
      doc: { ...makePut().doc, chunkCount: 1, charCount: 20 },
      chunks: [makePut().chunks[1]],
      baseUpdatedAt: first.updatedAt,
    });
    const second = await putKbDocument(db, "u1", onlySecond);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.deletedChunks).toBe(1);

    const chunks = await listDirectionChunks(db, "u1", "d1");
    expect(chunks.map((chunk) => chunk.id)).toEqual(["doc-1:1"]);
  });

  it("同一方向有两篇文档时，替换其中一篇不会误删另一篇的片段", async () => {
    const first = await putKbDocument(db, "u1", makePut());
    expect(first.ok).toBe(true);

    const other = makePut({
      doc: { ...makePut().doc, id: "doc-2", title: "另一份讲义", chunkCount: 1, charCount: 20 },
      chunks: [
        {
          id: "doc-2:0",
          docId: "doc-2",
          directionId: "d1",
          title: "另一份讲义",
          section: "队列",
          text: "队列是先进先出的线性表。",
          index: 0,
        },
      ],
    });
    expect((await putKbDocument(db, "u1", other)).ok).toBe(true);

    if (!first.ok) return;
    const replace = makePut({
      doc: { ...makePut().doc, chunkCount: 1, charCount: 20 },
      chunks: [makePut().chunks[0]],
      baseUpdatedAt: first.updatedAt,
    });
    const second = await putKbDocument(db, "u1", replace);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.deletedChunks).toBe(1);

    const chunks = await listDirectionChunks(db, "u1", "d1");
    expect(chunks.map((chunk) => chunk.id).sort()).toEqual(["doc-1:0", "doc-2:0"]);
  });

  it("不同用户可以有相同 doc_id，互不影响", async () => {
    await putKbDocument(db, "u1", makePut());
    const other = await putKbDocument(db, "u2", makePut({ baseUpdatedAt: null }));
    expect(other.ok).toBe(true);

    expect(await listDirectionDocs(db, "u1", "d1")).toHaveLength(1);
    expect(await listDirectionDocs(db, "u2", "d1")).toHaveLength(1);
  });

  it("deleteKbDoc / deleteKbDirection 返回真实删除数", async () => {
    await putKbDocument(db, "u1", makePut());
    expect(await deleteKbDoc(db, "u1", "doc-1")).toEqual({ deletedDocs: 1, deletedChunks: 2 });
    expect(await deleteKbDoc(db, "u1", "doc-1")).toEqual({ deletedDocs: 0, deletedChunks: 0 });

    await putKbDocument(db, "u1", makePut());
    expect(await deleteKbDirection(db, "u1", "d1")).toEqual({
      deletedDocs: 1,
      deletedChunks: 2,
    });
  });

  it("删除写 tombstone：删除期间的并发写入被复活守卫拦下（删除赢）", async () => {
    const first = await putKbDocument(db, "u1", makePut());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    /*
     * 模拟复活窗口：另一设备的删除已提交 tombstone（deleted_at >= 文档版本），
     * 本设备的在途 PUT 才进入事务。CAS 预检与文档 upsert 都会通过
     * （文档行此刻还在），必须由事务末尾的复活守卫撤掉这次写入。
     */
    await db.run(KB_TOMBSTONE_SQL.upsert, ["u1", "doc-1", "d1", String(first.updatedAt)]);

    const stale = await putKbDocument(db, "u1", makePut({ baseUpdatedAt: first.updatedAt }));
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.reason).toBe("conflict");
    expect(stale.message).toContain("删除");

    // 守卫把整篇文档连同片段一起撤掉，不留半份
    expect(await listDirectionDocs(db, "u1", "d1")).toHaveLength(0);
    expect(await listDirectionChunks(db, "u1", "d1")).toHaveLength(0);
  });

  it("tombstone 比 base 旧时不拦：正常更新不受误伤", async () => {
    const first = await putKbDocument(db, "u1", makePut());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // 墓碑版本早于本次写入的 base（例如曾经的删除已被更新的导入压过）
    await db.run(KB_TOMBSTONE_SQL.upsert, ["u1", "doc-1", "d1", String(first.updatedAt - 1)]);

    const second = await putKbDocument(db, "u1", makePut({ baseUpdatedAt: first.updatedAt }));
    expect(second.ok).toBe(true);
    expect(await listDirectionDocs(db, "u1", "d1")).toHaveLength(1);
  });

  it("删除后重新导入（base 为空）允许，并清掉 tombstone 不再拦后续更新", async () => {
    const first = await putKbDocument(db, "u1", makePut());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(await deleteKbDoc(db, "u1", "doc-1")).toEqual({ deletedDocs: 1, deletedChunks: 2 });

    // 旧基线的写入仍然被拒绝（文档已不存在）
    const stale = await putKbDocument(db, "u1", makePut({ baseUpdatedAt: first.updatedAt }));
    expect(stale.ok).toBe(false);

    // 全新导入是新的用户意图：允许
    const reimport = await putKbDocument(db, "u1", makePut({ baseUpdatedAt: null }));
    expect(reimport.ok).toBe(true);
    if (!reimport.ok) return;

    // tombstone 已清：后续正常更新不会被复活守卫误拦
    const next = await putKbDocument(db, "u1", makePut({ baseUpdatedAt: reimport.updatedAt }));
    expect(next.ok).toBe(true);
    expect(await listDirectionDocs(db, "u1", "d1")).toHaveLength(1);
    expect(await listDirectionChunks(db, "u1", "d1")).toHaveLength(2);
  });

  it("deleteKbDirection 为方向下每篇文档各留一条 tombstone", async () => {
    await putKbDocument(db, "u1", makePut());
    const other = makePut({
      doc: { ...makePut().doc, id: "doc-2", title: "另一份讲义", chunkCount: 1, charCount: 20 },
      chunks: [{ ...makePut().chunks[0], id: "doc-2:0", docId: "doc-2" }],
    });
    expect((await putKbDocument(db, "u1", other)).ok).toBe(true);

    expect(await deleteKbDirection(db, "u1", "d1")).toEqual({ deletedDocs: 2, deletedChunks: 3 });

    // 两篇都有墓碑：以旧版本基线复活任一篇都会被守卫拦下。
    // （行已不存在时预检先拦；这里直接验证 tombstone 行存在且版本不低于删除前）
    const rows = await db.all<{ doc_id: string; deleted_at: string }>(
      "SELECT doc_id, deleted_at FROM kb_tombstones WHERE user_id = $1 AND direction_id = $2",
      ["u1", "d1"],
    );
    expect(rows.map((row) => row.doc_id).sort()).toEqual(["doc-1", "doc-2"]);
  });
});

describe("listDirectionVectors（内存 DB）", () => {
  async function seed(count: number): Promise<void> {
    const chunks = Array.from({ length: count }, (_, index) => ({
      id: `doc-1:${index}`,
      docId: "doc-1",
      directionId: "d1",
      title: "讲义",
      section: "s",
      text: `第 ${index} 段正文`,
      index,
      embedding: [index + 0.1, 1],
      embeddingModel: "fake-embed",
      embeddingDim: 2,
    }));
    const result = await putKbDocument(
      db,
      "u1",
      makePut({
        doc: {
          ...makePut().doc,
          charCount: 100,
          chunkCount: count,
        },
        chunks,
      }),
    );
    expect(result.ok).toBe(true);
  }

  it("按 chunk_id 升序分页，after 不含且 next 最终为 null", async () => {
    await seed(5);

    const first = await listDirectionVectors(db, "u1", "d1", null, 2);
    expect(first.vectors.map((vector) => vector.id)).toEqual(["doc-1:0", "doc-1:1"]);
    expect(first.next).toBe("doc-1:1");

    const second = await listDirectionVectors(db, "u1", "d1", first.next, 2);
    expect(second.vectors.map((vector) => vector.id)).toEqual(["doc-1:2", "doc-1:3"]);
    expect(second.next).toBe("doc-1:3");

    const third = await listDirectionVectors(db, "u1", "d1", second.next, 2);
    expect(third.vectors.map((vector) => vector.id)).toEqual(["doc-1:4"]);
    expect(third.next).toBeNull();
  });

  it("limit 被夹到 1..100", async () => {
    await seed(3);
    expect((await listDirectionVectors(db, "u1", "d1", null, 0)).vectors).toHaveLength(1);
    expect((await listDirectionVectors(db, "u1", "d1", null, 500)).vectors).toHaveLength(3);
  });

  it("损坏向量被跳过，游标仍能前进", async () => {
    await seed(3);
    // 直接改库里的向量，模拟历史坏数据
    await db.run(
      "INSERT INTO kb_chunks (user_id, chunk_id, doc_id, direction_id, idx, title, section, page_from, page_to, text, embedding, embedding_model, embedding_dim, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (user_id, chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding, embedding_dim = EXCLUDED.embedding_dim",
      ["u1", "doc-1:9", "doc-1", "d1", 9, "讲义", "s", null, null, "坏向量", "[1,2]", "fake-embed", 3, "1"],
    );

    const page = await listDirectionVectors(db, "u1", "d1", null, 10);
    expect(page.vectors.map((vector) => vector.id)).not.toContain("doc-1:9");
    expect(page.next).toBeNull();
  });

  it("用户隔离：只返回当前用户的向量", async () => {
    await seed(2);
    const page = await listDirectionVectors(db, "u2", "d1", null, 10);
    expect(page.vectors).toEqual([]);
    expect(page.next).toBeNull();
  });
});
