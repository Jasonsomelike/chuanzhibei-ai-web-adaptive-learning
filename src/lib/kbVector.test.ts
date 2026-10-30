import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { __resetMemoryDbForTests, getDb, type Db } from "@/lib/db";
import { listStoredVectorChunkIds, querySimilarChunks, storeKbVectors } from "@/lib/kbVector";
import {
  KB_LOCAL_VECTOR_DIM,
  KB_LOCAL_VECTOR_MODEL,
  kbVectorUpload,
  type KbVectorUpload,
} from "@/lib/vectorContracts";

const originalDatabaseUrl = process.env.DATABASE_URL;
let db: Db;

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  __resetMemoryDbForTests();
  db = await getDb();
});

afterAll(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

function vec(fill: number): number[] {
  return Array.from({ length: KB_LOCAL_VECTOR_DIM }, (_, index) => fill + index / 10_000);
}

async function seedChunk(userId: string, chunkId: string, directionId: string): Promise<void> {
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

function upload(items: readonly { chunkId: string; vec: number[] }[]): KbVectorUpload {
  const parsed = kbVectorUpload.safeParse({ vectors: items });
  if (!parsed.success) throw new Error("测试夹具不合法");
  return parsed.data;
}

describe("storeKbVectors / listStoredVectorChunkIds", () => {
  it("写入后按方向读回；JOIN kb_chunks 过滤掉其它方向与其它用户", async () => {
    await seedChunk("u1", "c1", "d1");
    await seedChunk("u1", "c2", "d2");
    await seedChunk("u2", "c3", "d1");

    expect(
      await storeKbVectors(
        db,
        "u1",
        upload([
          { chunkId: "c1", vec: vec(0.1) },
          { chunkId: "c2", vec: vec(0.2) },
          { chunkId: "c3", vec: vec(0.3) },
        ]),
      ),
    ).toBe(3);

    expect(await listStoredVectorChunkIds(db, "u1", "d1")).toEqual(["c1"]);
    expect(await listStoredVectorChunkIds(db, "u1", "d2")).toEqual(["c2"]);
    expect(await listStoredVectorChunkIds(db, "u2", "d1")).toEqual([]);
    expect(await listStoredVectorChunkIds(db, "u1", "d1", "other-model")).toEqual([]);
  });

  it("同一 chunk 重复写入是更新，不产生重复 id", async () => {
    await seedChunk("u1", "c1", "d1");
    await storeKbVectors(db, "u1", upload([{ chunkId: "c1", vec: vec(0.1) }]));
    await storeKbVectors(db, "u1", upload([{ chunkId: "c1", vec: vec(0.9) }]));

    expect(await listStoredVectorChunkIds(db, "u1", "d1")).toEqual(["c1"]);
  });

  it("默认模型名固定为本地模型", async () => {
    await seedChunk("u1", "c1", "d1");
    await storeKbVectors(db, "u1", upload([{ chunkId: "c1", vec: vec(0.1) }]));

    expect(await listStoredVectorChunkIds(db, "u1", "d1", KB_LOCAL_VECTOR_MODEL)).toEqual([
      "c1",
    ]);
  });
});

describe("querySimilarChunks", () => {
  it("内存后端没有 pgvector：返回空数组（调用方退化为 BM25），不抛错", async () => {
    await seedChunk("u1", "c1", "d1");
    await storeKbVectors(db, "u1", upload([{ chunkId: "c1", vec: vec(0.1) }]));

    await expect(querySimilarChunks(db, "u1", "d1", vec(0.1), 8)).resolves.toEqual([]);
  });
});
