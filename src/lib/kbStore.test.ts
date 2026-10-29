import { describe, expect, it } from "vitest";

import {
  KB_STORAGE_BUDGET_RATIO,
  checkDirectionCapacity,
  checkStorageBudget,
  deleteDocument,
  directionCapacity,
  estimateImportBytes,
  formatBytes,
  importDocument,
  loadDirectionKb,
  updateDocKcIds,
  type KbStorage,
  type KbStorageEstimate,
} from "@/lib/kbStore";
import {
  MAX_DIRECTION_CHARS,
  MAX_DIRECTION_CHUNKS,
  MAX_PDF_PAGES,
  type UploadChunk,
  type UploadDoc,
} from "@/lib/knowledge";
import { readFileBytes } from "@/lib/textFile";
import { pdfPageLimitError } from "@/lib/pdf";

// ── 测试替身：带快照回滚的内存适配器 ──────────────────────────────

class MemoryKbStorage implements KbStorage {
  docs = new Map<string, UploadDoc>();
  chunks = new Map<string, UploadChunk>();
  /** 模拟「docs 已写、chunks 还没写完就中断」，由实现自己回滚。 */
  failAfterDocs = false;
  estimateValue: KbStorageEstimate = {};
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

  async putDocWithChunks(doc: UploadDoc, chunks: readonly UploadChunk[]): Promise<void> {
    const docsSnapshot = new Map(this.docs);
    const chunksSnapshot = new Map(this.chunks);
    try {
      this.docs.set(doc.id, doc);
      if (this.failAfterDocs) throw new Error("模拟写入中断");
      for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
      this.putCalls += 1;
    } catch (err) {
      this.docs = docsSnapshot;
      this.chunks = chunksSnapshot;
      throw err;
    }
  }

  async removeDoc(docId: string): Promise<void> {
    this.docs.delete(docId);
    for (const [id, chunk] of this.chunks) {
      if (chunk.docId === docId) this.chunks.delete(id);
    }
  }

  async estimate(): Promise<KbStorageEstimate> {
    return this.estimateValue;
  }
}

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
    createdAt: "2026-10-28T00:00:00.000Z",
    ...overrides,
  };
}

function makeChunks(
  doc: UploadDoc,
  count: number,
  overrides: (index: number) => Partial<UploadChunk> = () => ({}),
): UploadChunk[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${doc.id}-c${index}`,
    docId: doc.id,
    directionId: doc.directionId,
    title: doc.title,
    section: `第${index + 1}节`,
    text: `第 ${index + 1} 段正文。`,
    index,
    ...overrides(index),
  }));
}

function seedDoc(storage: MemoryKbStorage, doc: UploadDoc): void {
  storage.docs.set(doc.id, doc);
}

// ── 导入 ──────────────────────────────────────────────────────────

describe("importDocument", () => {
  it("一份文档与全部片段一次写入，读取时按文档与序号排序", async () => {
    const storage = new MemoryKbStorage();
    const newer = makeDoc({
      id: "doc-b",
      charCount: 200,
      chunkCount: 2,
      createdAt: "2026-10-28T10:00:00.000Z",
    });
    const older = makeDoc({
      id: "doc-a",
      charCount: 100,
      chunkCount: 1,
      createdAt: "2026-10-28T09:00:00.000Z",
    });

    const first = await importDocument(storage, newer, makeChunks(newer, 2).reverse());
    const second = await importDocument(storage, older, makeChunks(older, 1));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.chunks).toHaveLength(2);

    const loaded = await loadDirectionKb(storage, "dir-1");
    expect(loaded.docs.map((doc) => doc.id)).toEqual(["doc-a", "doc-b"]);
    expect(loaded.chunks.map((chunk) => chunk.id)).toEqual(["doc-a-c0", "doc-b-c0", "doc-b-c1"]);
  });

  it("不同方向互相隔离", async () => {
    const storage = new MemoryKbStorage();
    const a = makeDoc({ id: "doc-a", directionId: "dir-a" });
    const b = makeDoc({ id: "doc-b", directionId: "dir-b" });

    await importDocument(storage, a, makeChunks(a, 1));
    await importDocument(storage, b, makeChunks(b, 1));

    const loaded = await loadDirectionKb(storage, "dir-a");
    expect(loaded.docs.map((doc) => doc.id)).toEqual(["doc-a"]);
    expect(loaded.chunks.every((chunk) => chunk.directionId === "dir-a")).toBe(true);
  });

  it("同一文档 id 不重复写入", async () => {
    const storage = new MemoryKbStorage();
    const doc = makeDoc({ id: "doc-a" });

    expect((await importDocument(storage, doc, makeChunks(doc, 1))).ok).toBe(true);
    const again = await importDocument(storage, doc, makeChunks(doc, 1));

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.written).toBe(0);
    expect(again.error).toContain("已经导入过");
    expect(storage.docs.size).toBe(1);
    expect(storage.chunks.size).toBe(1);
  });

  it("片段与文档不自洽时整体拒绝", async () => {
    const storage = new MemoryKbStorage();
    const doc = makeDoc({ id: "doc-a", chunkCount: 1 });
    const chunks = makeChunks(doc, 1, () => ({ docId: "other-doc" }));

    const result = await importDocument(storage, doc, chunks);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.written).toBe(0);
    expect(result.error).toContain("docId 与文档不一致");
    expect(storage.putCalls).toBe(0);
    expect(storage.docs.size).toBe(0);
  });

  it("段数容量不足时整体拒绝，并报剩余量与需要量", async () => {
    const storage = new MemoryKbStorage();
    seedDoc(
      storage,
      makeDoc({
        id: "seed",
        charCount: 100,
        chunkCount: MAX_DIRECTION_CHUNKS - 1,
        createdAt: "2026-10-28T00:00:00.000Z",
      }),
    );
    const doc = makeDoc({ id: "doc-new", charCount: 20, chunkCount: 2 });

    const result = await importDocument(storage, doc, makeChunks(doc, 2));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.written).toBe(0);
    expect(result.error).toContain("剩余 1 段");
    expect(result.error).toContain("需要 2 段");
    expect(result.error).toContain("未写入任何内容");
    expect(storage.putCalls).toBe(0);
    expect(storage.docs.size).toBe(1);
    expect(storage.chunks.size).toBe(0);
  });

  it("字数容量不足时同样整体拒绝", async () => {
    const storage = new MemoryKbStorage();
    seedDoc(
      storage,
      makeDoc({
        id: "seed",
        charCount: MAX_DIRECTION_CHARS - 1,
        chunkCount: 1,
      }),
    );
    const doc = makeDoc({ id: "doc-new", charCount: 2, chunkCount: 1 });

    const result = await importDocument(storage, doc, makeChunks(doc, 1));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain(`剩余 1 字`);
    expect(result.error).toContain("需要 2 字");
    expect(storage.putCalls).toBe(0);
  });

  it("写入中途失败会回滚，docs 与 chunks 都为 0", async () => {
    const storage = new MemoryKbStorage();
    storage.failAfterDocs = true;
    const doc = makeDoc({ id: "doc-a", chunkCount: 2 });

    const result = await importDocument(storage, doc, makeChunks(doc, 2));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.written).toBe(0);
    expect(result.error).toContain("已导入 0/2 段");
    expect(result.error).toContain("未写入任何内容");
    expect(storage.docs.size).toBe(0);
    expect(storage.chunks.size).toBe(0);
  });

  it("浏览器配额预算不足时不写任何行", async () => {
    const storage = new MemoryKbStorage();
    storage.estimateValue = { usage: 900, quota: 1000 };
    const doc = makeDoc({ id: "doc-a" });

    const result = await importDocument(storage, doc, makeChunks(doc, 1));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("浏览器可用存储不足");
    expect(result.error).toContain("未写入任何内容");
    expect(storage.docs.size).toBe(0);
    expect(storage.chunks.size).toBe(0);
  });
});

// ── 删除 / 绑定 / 读取 ────────────────────────────────────────────

describe("deleteDocument 与 updateDocKcIds", () => {
  it("删除文档会级联删除 chunks", async () => {
    const storage = new MemoryKbStorage();
    const doc = makeDoc({ id: "doc-a", chunkCount: 2 });
    await importDocument(storage, doc, makeChunks(doc, 2));

    const result = await deleteDocument(storage, "doc-a");

    expect(result.ok).toBe(true);
    expect(storage.docs.size).toBe(0);
    expect(storage.chunks.size).toBe(0);
    expect((await loadDirectionKb(storage, "dir-1")).chunks).toEqual([]);
  });

  it("删除不存在的文档是幂等的", async () => {
    const storage = new MemoryKbStorage();
    expect((await deleteDocument(storage, "missing")).ok).toBe(true);
    expect((await deleteDocument(storage, " ")).ok).toBe(false);
  });

  it("只改绑定，保留片段且去重", async () => {
    const storage = new MemoryKbStorage();
    const doc = makeDoc({ id: "doc-a", chunkCount: 2, kcIds: ["c01"] });
    await importDocument(storage, doc, makeChunks(doc, 2));

    const result = await updateDocKcIds(storage, "doc-a", [" c20 ", "c20", "", "c09"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.kcIds).toEqual(["c20", "c09"]);
    expect(storage.docs.get("doc-a")?.kcIds).toEqual(["c20", "c09"]);
    expect(storage.chunks.size).toBe(2);
    expect(storage.putCalls).toBe(2);
  });

  it("绑定相同的知识点不重写事务", async () => {
    const storage = new MemoryKbStorage();
    const doc = makeDoc({ id: "doc-a", kcIds: ["c01"] });
    await importDocument(storage, doc, makeChunks(doc, 1));
    const calls = storage.putCalls;

    const result = await updateDocKcIds(storage, "doc-a", ["c01"]);

    expect(result.ok).toBe(true);
    expect(storage.putCalls).toBe(calls);
  });

  it("绑定已删除的文档返回明确错误", async () => {
    const storage = new MemoryKbStorage();
    const result = await updateDocKcIds(storage, "missing", ["c01"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("不存在");
  });

  it("读取时丢弃没有文档的孤儿片段", async () => {
    const storage = new MemoryKbStorage();
    const doc = makeDoc({ id: "doc-a" });
    await importDocument(storage, doc, makeChunks(doc, 1));
    storage.chunks.set("orphan", {
      id: "orphan",
      docId: "missing",
      directionId: "dir-1",
      title: "孤儿",
      section: "第1页",
      text: "不该出现。",
      index: 0,
    });

    const loaded = await loadDirectionKb(storage, "dir-1");
    expect(loaded.chunks.map((chunk) => chunk.id)).toEqual(["doc-a-c0"]);
  });
});

// ── 纯函数 ────────────────────────────────────────────────────────

describe("容量与预算纯函数", () => {
  it("directionCapacity 汇总已用与剩余量", () => {
    const docs = [
      makeDoc({ id: "a", chunkCount: 100, charCount: 1000 }),
      makeDoc({ id: "b", chunkCount: 50, charCount: 500 }),
    ];
    const capacity = directionCapacity(docs);

    expect(capacity.usedChunks).toBe(150);
    expect(capacity.usedChars).toBe(1500);
    expect(capacity.remainingChunks).toBe(MAX_DIRECTION_CHUNKS - 150);
    expect(capacity.remainingChars).toBe(MAX_DIRECTION_CHARS - 1500);
  });

  it("checkDirectionCapacity 放得下时返回 null", () => {
    const doc = makeDoc({ id: "a", chunkCount: 2, charCount: 20 });
    expect(checkDirectionCapacity([], doc, 2)).toBeNull();
  });

  it("estimateImportBytes 与 checkStorageBudget 使用 80% 预算", () => {
    const doc = makeDoc({ id: "a" });
    const chunks = makeChunks(doc, 1);
    const bytes = estimateImportBytes(doc, chunks);

    expect(bytes).toBeGreaterThan(0);
    expect(checkStorageBudget({ usage: 0, quota: bytes * 10 }, bytes)).toBeNull();
    // 配额等于本次估算时，80% 预算装不下
    expect(checkStorageBudget({ usage: 0, quota: bytes }, bytes)).not.toBeNull();
    expect(checkStorageBudget({ quota: 0 }, bytes)).toBeNull();
    expect(checkStorageBudget(null, bytes)).toBeNull();
    expect(KB_STORAGE_BUDGET_RATIO).toBe(0.8);
  });

  it("formatBytes 给出可读单位", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });
});

// ── textFile：只测 File → bytes ───────────────────────────────────

describe("readFileBytes", () => {
  it("原样读出 File 的字节", async () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63, 0x00, 0xff]);
    const file = new File([bytes], "note.bin");

    const read = await readFileBytes(file);

    expect(read).toBeInstanceOf(Uint8Array);
    expect([...read]).toEqual([...bytes]);
  });

  it("中文 UTF-8 文件字节不被改写", async () => {
    const encoded = new TextEncoder().encode("栈与队列");
    const file = new File([encoded], "stack.txt");

    expect([...(await readFileBytes(file))]).toEqual([...encoded]);
  });
});

// ── PDF 页数上限（纯函数） ────────────────────────────────────────

describe("pdfPageLimitError", () => {
  it("上限内通过，超过上限报实际页数", () => {
    expect(pdfPageLimitError(1)).toBeNull();
    expect(pdfPageLimitError(MAX_PDF_PAGES)).toBeNull();

    const error = pdfPageLimitError(MAX_PDF_PAGES + 1);
    expect(error).toContain(`${MAX_PDF_PAGES + 1} 页`);
    expect(error).toContain(`${MAX_PDF_PAGES} 页上限`);
  });

  it("非法页数当作无效", () => {
    expect(pdfPageLimitError(0)).not.toBeNull();
    expect(pdfPageLimitError(1.5)).not.toBeNull();
  });
});
