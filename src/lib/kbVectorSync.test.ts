import { describe, expect, it } from "vitest";

import type { EmbedLocalResult } from "@/lib/embedLocal";
import type { UploadChunk, UploadDoc } from "@/lib/knowledge";
import {
  createSyncedKbStorage,
  type KbEmbedFn,
  type KbRemoteStorage,
  type KbVectorSyncState,
} from "@/lib/kbRemote";
import type { KbStorage, KbStorageEstimate, KbWriteOptions } from "@/lib/kbStore";
import {
  KB_LOCAL_VECTOR_DIM,
  type KbVectorItem,
} from "@/lib/vectorContracts";

const DOC: UploadDoc = {
  id: "doc-1",
  directionId: "d1",
  title: "数据结构讲义",
  fileName: "ds.md",
  kind: "md",
  size: 1024,
  charCount: 6500,
  chunkCount: 65,
  kcIds: [],
  createdAt: "2026-10-30T00:00:00.000Z",
};

function makeChunks(count: number): UploadChunk[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `doc-1:${index}`,
    docId: DOC.id,
    directionId: DOC.directionId,
    title: DOC.title,
    section: `第${index + 1}节`,
    text: `第 ${index + 1} 段正文。`,
    index,
  }));
}

function vec(fill: number): number[] {
  return Array.from({ length: KB_LOCAL_VECTOR_DIM }, (_, index) => fill + index / 1_000_000);
}

class LocalStorage implements KbStorage {
  docs = new Map<string, UploadDoc>();
  chunks = new Map<string, UploadChunk>();

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

interface FakeRemote extends KbRemoteStorage {
  readonly putBatches: string[][];
  readonly embedCalls: { count: number };
}

function makeRemote(
  chunks: readonly UploadChunk[],
  existingIds: readonly string[],
  failGet = false,
): FakeRemote {
  const putBatches: string[][] = [];
  return {
    putBatches,
    embedCalls: { count: 0 },
    async loadDirection() {
      return { docs: [DOC], chunks };
    },
    async listDocs() {
      return [DOC];
    },
    async listChunks() {
      return chunks;
    },
    async getDoc() {
      return DOC;
    },
    async putDocWithChunks() {
      // 复合存储先写本地；这里不需要额外行为
    },
    async removeDoc() {
      // 空实现
    },
    async loadVectors() {
      return [];
    },
    async loadVectorChunkIds() {
      if (failGet) throw new Error("向量列表接口 503");
      return existingIds;
    },
    async putVectors(vectors: readonly KbVectorItem[]) {
      putBatches.push(vectors.map((item) => item.chunkId));
    },
    async putDoc(doc: UploadDoc) {
      return doc;
    },
  };
}

function synced(
  chunks: readonly UploadChunk[],
  remote: FakeRemote,
  embed: KbEmbedFn,
): ReturnType<typeof createSyncedKbStorage> {
  const local = new LocalStorage();
  local.docs.set(DOC.id, DOC);
  for (const chunk of chunks) local.chunks.set(chunk.id, chunk);
  return createSyncedKbStorage(local, remote, { embed });
}

function vectorResult(texts: readonly string[]): EmbedLocalResult {
  return {
    ok: true,
    vectors: texts.map((_, index) => vec(index / 10)),
    reason: null,
    message: null,
  };
}

describe("createSyncedKbStorage 本地向量同步", () => {
  it("读已有 chunkId → 只嵌缺口 → 每批 ≤32 条上传 → ready", async () => {
    const chunks = makeChunks(65);
    const remote = makeRemote(chunks, ["doc-1:0"]);
    const batches: number[] = [];
    const embed: KbEmbedFn = async (texts) => {
      batches.push(texts.length);
      remote.embedCalls.count += 1;
      return vectorResult(texts);
    };
    const storage = synced(chunks, remote, embed);
    const states: KbVectorSyncState[] = [];
    storage.onVectorSync((id, state) => {
      if (id === "d1") states.push(state);
    });

    const result = await storage.syncVectors("d1");

    expect(result.status).toBe("ready");
    expect(result.total).toBe(64);
    expect(result.done).toBe(64);
    // 本地推理按 16 条一批，上传按 32 条一批
    expect(batches).toEqual([16, 16, 16, 16]);
    expect(remote.putBatches.map((batch) => batch.length)).toEqual([32, 32]);
    expect(remote.putBatches.flat()).toHaveLength(64);
    expect(remote.putBatches[0][0]).toBe("doc-1:1");
    expect(states.map((state) => state.status)).toEqual([
      "loading",
      "embedding",
      "embedding",
      "embedding",
      "embedding",
      "embedding",
      "uploading",
      "uploading",
      "uploading",
      "ready",
    ]);
  });

  it("全部 chunk 已有向量时不加载模型", async () => {
    const chunks = makeChunks(3);
    const remote = makeRemote(chunks, chunks.map((chunk) => chunk.id));
    const storage = synced(chunks, remote, async () => {
      remote.embedCalls.count += 1;
      return vectorResult([]);
    });

    const result = await storage.syncVectors("d1");
    expect(result.status).toBe("ready");
    expect(remote.embedCalls.count).toBe(0);
    expect(remote.putBatches).toEqual([]);
  });

  it("本地模型不可用时只降级为 unavailable，chunks 文本照常可读", async () => {
    const chunks = makeChunks(3);
    const remote = makeRemote(chunks, []);
    const storage = synced(chunks, remote, async () => ({
      ok: false,
      vectors: null,
      reason: "model-missing",
      message: "模型文件不存在",
    }));

    const result = await storage.syncVectors("d1");
    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("model-missing");
    expect(result.message).toContain("BM25");
    expect(remote.putBatches).toEqual([]);

    const listed = await storage.listChunks("d1");
    expect(listed).toHaveLength(3);
    // listChunks 会再次触发同步；等它落定，避免测试结束后还有挂起任务
    await storage.syncVectors("d1");
  });

  it("读已有向量失败也不抛异常，状态里带原因", async () => {
    const chunks = makeChunks(2);
    const remote = makeRemote(chunks, [], true);
    const storage = synced(chunks, remote, async () => vectorResult([]));

    const result = await storage.syncVectors("d1");
    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("读取已有向量失败");
    expect(remote.putBatches).toEqual([]);
  });

  it("批量接口拒绝时降级，不抛到 UI", async () => {
    const chunks = makeChunks(2);
    const remote = makeRemote(chunks, []);
    remote.putVectors = async () => {
      throw new Error("HTTP 500");
    };
    const storage = synced(chunks, remote, async (texts) => vectorResult(texts));

    const result = await storage.syncVectors("d1");
    expect(result.status).toBe("unavailable");
    expect(result.message).toContain("上传向量失败");
  });

  it("状态按方向隔离；未知方向是 idle", async () => {
    const chunks = makeChunks(1);
    const remote = makeRemote(chunks, []);
    const storage = synced(chunks, remote, async (texts) => vectorResult(texts));

    expect(storage.vectorSyncState("other")).toEqual({
      status: "idle",
      done: 0,
      total: 0,
      message: null,
    });
    await storage.syncVectors("d1");
    expect(storage.vectorSyncState("d1").status).toBe("ready");
    expect(storage.vectorSyncState("other").status).toBe("idle");
  });
});
