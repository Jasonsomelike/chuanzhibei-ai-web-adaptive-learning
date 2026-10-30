import { describe, expect, it } from "vitest";

import { KB_VECTOR_SQL } from "@/lib/db";
import { LOCAL_EMBED_DIM, LOCAL_EMBED_MODEL } from "@/lib/embedLocal";
import {
  KB_LOCAL_VECTOR_DIM,
  KB_LOCAL_VECTOR_MODEL,
  KB_VECTOR_BATCH_MAX,
  batchVectors,
  kbSimilarRequest,
  kbVectorUpload,
  mapSimilarRows,
  mapStoredChunkIds,
  similarParams,
  vectorProblem,
  vectorToSqlText,
} from "@/lib/vectorContracts";

function vec(fill = 0.1): number[] {
  return Array.from({ length: KB_LOCAL_VECTOR_DIM }, () => fill);
}

function item(chunkId: string, values = vec()): { chunkId: string; vec: number[] } {
  return { chunkId, vec: values };
}

describe("batchVectors", () => {
  it("按 32 条切分：0 / 1 / 32 / 33 / 65", () => {
    const items = Array.from({ length: 65 }, (_, index) => index);
    expect(batchVectors([])).toEqual([]);
    expect(batchVectors(items.slice(0, 1)).map((batch) => batch.length)).toEqual([1]);
    expect(batchVectors(items.slice(0, 32)).map((batch) => batch.length)).toEqual([32]);
    expect(batchVectors(items.slice(0, 33)).map((batch) => batch.length)).toEqual([32, 1]);
    expect(batchVectors(items).map((batch) => batch.length)).toEqual([32, 32, 1]);
  });

  it("调用方传更大的 size 也被夹到 32；非法 size 回到默认值", () => {
    const items = Array.from({ length: 40 }, (_, index) => index);
    expect(batchVectors(items, 100).map((batch) => batch.length)).toEqual([32, 8]);
    expect(batchVectors(items, 0).map((batch) => batch.length)).toEqual([32, 8]);
    expect(batchVectors(items, Number.NaN).map((batch) => batch.length)).toEqual([32, 8]);
    expect(batchVectors(items, 10).map((batch) => batch.length)).toEqual([10, 10, 10, 10]);
  });

  it("常量与契约绑定：一批最多 32 条", () => {
    expect(KB_VECTOR_BATCH_MAX).toBe(32);
    // 客户端 embedLocal 为避免打包 zod 复制了这两个常量，必须与服务端一致
    expect(LOCAL_EMBED_MODEL).toBe(KB_LOCAL_VECTOR_MODEL);
    expect(LOCAL_EMBED_DIM).toBe(KB_LOCAL_VECTOR_DIM);
  });
});

describe("向量校验", () => {
  it("合法 512 维有限向量通过", () => {
    expect(vectorProblem(vec())).toBeNull();
  });

  it("维度不符直接拒绝，并报出收到的维度", () => {
    expect(vectorProblem([0.1, 0.2], 512)).toContain("512");
    expect(vectorProblem(vec().slice(0, 511))).toContain("511");
  });

  it("NaN / Infinity / -Infinity / 非数字都拒绝", () => {
    const NaNVec = vec();
    NaNVec[0] = Number.NaN;
    expect(vectorProblem(NaNVec)).toContain("不是有限数");

    const infVec = vec();
    infVec[10] = Number.POSITIVE_INFINITY;
    expect(vectorProblem(infVec)).toContain("不是有限数");

    const negInfVec = vec();
    negInfVec[10] = Number.NEGATIVE_INFINITY;
    expect(vectorProblem(negInfVec)).toContain("不是有限数");

    const stringVec = vec() as unknown[];
    stringVec[3] = "0.5";
    expect(vectorProblem(stringVec)).toContain("不是有限数");
  });

  it("零范数拒绝：余弦会变成 NaN", () => {
    expect(vectorProblem(vec(0))).toContain("范数为 0");
  });

  it("kbVectorUpload：33 条、维度错误、NaN、额外字段都拒绝", () => {
    const valid = { vectors: [item("chunk-1")] };
    expect(kbVectorUpload.safeParse(valid).success).toBe(true);

    const tooMany = {
      vectors: Array.from({ length: 33 }, (_, index) => item(`chunk-${index}`)),
    };
    expect(kbVectorUpload.safeParse(tooMany).success).toBe(false);

    expect(kbVectorUpload.safeParse({ vectors: [item("c1", vec().slice(0, 2))] }).success).toBe(
      false,
    );

    const nan = vec();
    nan[0] = Number.NaN;
    expect(kbVectorUpload.safeParse({ vectors: [item("c1", nan)] }).success).toBe(false);

    expect(
      kbVectorUpload.safeParse({ vectors: [{ ...item("c1"), directionId: "d1" }] }).success,
    ).toBe(false);
    expect(kbVectorUpload.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(
      kbVectorUpload.safeParse({ vectors: [item("c1")], model: "other-model" }).success,
    ).toBe(false);
    expect(
      kbVectorUpload.safeParse({ vectors: [item("c1")], model: KB_LOCAL_VECTOR_MODEL }).success,
    ).toBe(true);
  });

  it("kbSimilarRequest：只接受 512 维有限向量与合法 directionId", () => {
    expect(kbSimilarRequest.safeParse({ directionId: "d1", vector: vec() }).success).toBe(true);
    expect(
      kbSimilarRequest.safeParse({ directionId: "d1", vector: vec(), limit: 51 }).success,
    ).toBe(false);
    expect(
      kbSimilarRequest.safeParse({ directionId: "bad id", vector: vec() }).success,
    ).toBe(false);
    expect(
      kbSimilarRequest.safeParse({ directionId: "d1", vector: vec().slice(0, 3) }).success,
    ).toBe(false);
  });
});

describe("SQL 参数形状", () => {
  it("向量序列化成 pgvector 文本，不传 JS 数组", () => {
    expect(vectorToSqlText([0.1, -0.2, 3])).toBe("[0.1,-0.2,3]");
  });

  it("similar 参数顺序固定：user_id, direction_id, model, vector, limit", () => {
    const params = similarParams("u1", "d1", KB_LOCAL_VECTOR_MODEL, [0.1, 0.2], 8);
    expect(params).toEqual(["u1", "d1", KB_LOCAL_VECTOR_MODEL, "[0.1,0.2]", 8]);
  });

  it("按方向读向量必须 JOIN kb_chunks；相似查询默认精确扫描", () => {
    for (const sql of [KB_VECTOR_SQL.byDirection, KB_VECTOR_SQL.similar]) {
      expect(sql.toLowerCase()).toContain("join kb_chunks");
      expect(sql.toLowerCase()).toContain("c.direction_id = $2");
      // 向量表没有 direction_id：不能出现 v.direction_id
      expect(sql.toLowerCase()).not.toContain("v.direction_id");
    }
    const similar = KB_VECTOR_SQL.similar.toLowerCase();
    expect(similar).toContain("$4::vector(512)");
    expect(similar).toContain("$5");
    expect(similar).not.toContain("concurrently");
    expect(similar).not.toContain("set local");
    expect(similar).not.toContain("using hnsw");
  });
});

describe("响应映射", () => {
  it("similar 行：数字/字符串分数都接受，NaN/Infinity 丢弃，同分按 id 升序", () => {
    const hits = mapSimilarRows([
      { chunk_id: "b", score: "0.5" },
      { chunk_id: "a", score: 0.5 },
      { chunk_id: "bad", score: Number.NaN },
      { chunk_id: "inf", score: Number.POSITIVE_INFINITY },
      { chunk_id: "c", score: 2 },
      { chunk_id: "neg", score: -2 },
      { chunkId: "d", score: 0.25 },
      { chunk_id: "", score: 1 },
      { chunk_id: "b", score: 0.9 },
      null,
    ]);

    expect(hits.map((hit) => hit.chunkId)).toEqual(["c", "a", "b", "d", "neg"]);
    expect(hits[0].score).toBe(1);
    expect(hits[1].score).toBe(0.5);
    expect(hits[4].score).toBe(-1);
    // 重复 chunkId 只保留第一次出现
    expect(hits.filter((hit) => hit.chunkId === "b")).toHaveLength(1);
  });

  it("已存 chunkId 去重、排序、丢弃空串", () => {
    expect(
      mapStoredChunkIds([
        { chunk_id: "b" },
        { chunk_id: "a" },
        { chunkId: "a" },
        { chunk_id: " " },
        { chunk_id: 3 },
        null,
      ]),
    ).toEqual(["a", "b"]);
  });
});
