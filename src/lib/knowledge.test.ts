import { describe, expect, it } from "vitest";

import { validatePack } from "@/lib/materials";
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  MAX_DIRECTION_CHARS,
  MAX_DIRECTION_CHUNKS,
  MAX_FILE_BYTES,
  MAX_FILE_CHARS,
  MAX_PDF_PAGES,
  MIN_CHUNK_CHARS,
  UPLOAD_CHAPTER,
  buildUploadIndex,
  chunkBlocks,
  decodeTextFile,
  formatUploadContext,
  parseUploadCitations,
  retrieveUploads,
  uploadCitationLabel,
  uploadsToKbDocuments,
  uploadsToPack,
  type ImportResult,
  type UploadChunk,
  type UploadDoc,
  type UploadHit,
} from "@/lib/knowledge";

/** 码点长度。中文与 emoji 都按 1 个字算，和实现保持同一口径。 */
function cp(text: string): number {
  return Array.from(text).length;
}

/** 生成一段互不相同的 CJK 正文，避免「所有字都一样」让重叠断言失去意义。 */
function cjkText(length: number): string {
  return Array.from({ length }, (_, i) => String.fromCodePoint(0x4e00 + i)).join("");
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
    kcIds: ["c09"],
    createdAt: "2026-10-28T00:00:00.000Z",
    ...overrides,
  };
}

function makeChunk(overrides: Partial<UploadChunk> & Pick<UploadChunk, "id">): UploadChunk {
  return {
    docId: "doc-1",
    directionId: "dir-1",
    title: "数据结构讲义",
    section: "第1章 绪论",
    text: "默认正文",
    index: 0,
    ...overrides,
  };
}

function hitOf(chunk: UploadChunk): UploadHit {
  return { chunk, score: 1 };
}

describe("上限常量", () => {
  it("与设计口径一致", () => {
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_PDF_PAGES).toBe(300);
    expect(MAX_FILE_CHARS).toBe(200_000);
    expect(MAX_DIRECTION_CHUNKS).toBe(800);
    expect(MAX_DIRECTION_CHARS).toBe(400_000);
    expect(CHUNK_SIZE).toBe(500);
    expect(CHUNK_OVERLAP).toBe(50);
    expect(MIN_CHUNK_CHARS).toBe(80);
  });
});

describe("chunkBlocks", () => {
  it("中文长文按 500 字切块，任何块都不超过 500 字", () => {
    const chunks = chunkBlocks([{ text: cjkText(2000) }]);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(cp(chunk.text)).toBeLessThanOrEqual(CHUNK_SIZE);
    }
    // 500 + 50 重叠：2000 字应切成 500/500/500/500/200
    expect(chunks.map((chunk) => cp(chunk.text))).toEqual([500, 500, 500, 500, 200]);
  });

  it("同一块内相邻切块重叠 50 字", () => {
    const chunks = chunkBlocks([{ text: cjkText(1600) }]);

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i += 1) {
      const before = Array.from(chunks[i - 1].text);
      const after = Array.from(chunks[i].text);
      expect(after.slice(0, CHUNK_OVERLAP).join("")).toBe(
        before.slice(-CHUNK_OVERLAP).join(""),
      );
    }
  });

  it("优先在句号处切，回溯不超过窗口一半", () => {
    const chunks = chunkBlocks([{ text: "你好。".repeat(200) }]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(cp(chunks[0].text)).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(cp(chunks[0].text)).toBeGreaterThanOrEqual(CHUNK_SIZE / 2);
    expect(chunks[0].text.endsWith("。")).toBe(true);
  });

  it("碎块并入前一块后仍不超过 500 字", () => {
    const chunks = chunkBlocks([
      { text: "甲".repeat(400), page: 1 },
      { text: "乙".repeat(40), page: 2 },
    ]);

    expect(chunks).toHaveLength(1);
    expect(cp(chunks[0].text)).toBe(440);
    expect(chunks[0].text).toBe("甲".repeat(400) + "乙".repeat(40));
    expect(chunks[0].pageFrom).toBe(1);
    expect(chunks[0].pageTo).toBe(2);
  });

  it("前一块装不下时并入后一块，页码跨度取真实页", () => {
    const chunks = chunkBlocks([
      { text: "甲".repeat(500), page: 1 },
      { text: "乙".repeat(40), page: 2 },
      { text: "丙".repeat(300), page: 3 },
    ]);

    expect(chunks).toHaveLength(2);
    expect(cp(chunks[0].text)).toBe(500);
    expect(chunks[0].pageFrom).toBe(1);
    expect(chunks[0].pageTo).toBe(1);

    expect(cp(chunks[1].text)).toBe(340);
    expect(chunks[1].pageFrom).toBe(2);
    expect(chunks[1].pageTo).toBe(3);
  });

  it("前后都装不下时保留为边界尾块", () => {
    const chunks = chunkBlocks([{ text: "丁".repeat(507), page: 7 }]);

    expect(chunks).toHaveLength(2);
    expect(cp(chunks[0].text)).toBe(500);
    expect(cp(chunks[1].text)).toBe(57);
    expect(cp(chunks[1].text)).toBeLessThan(MIN_CHUNK_CHARS);
    expect(chunks[1].text).toBe("丁".repeat(57));
    expect(chunks[1].pageFrom).toBe(7);
    expect(chunks[1].pageTo).toBe(7);
  });

  it("md / txt 没有页码时不编造页码", () => {
    const chunks = chunkBlocks([
      { text: "第三章 栈与队列。".repeat(20), section: "第三章 栈与队列" },
    ]);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.pageFrom).toBeUndefined();
      expect(chunk.pageTo).toBeUndefined();
      expect(chunk.section).toBe("第三章 栈与队列");
    }
  });

  it("PDF 缺小节时用真实页号兜底；非法页号当作没有", () => {
    const withPage = chunkBlocks([{ text: "页内正文。".repeat(20), page: 5 }]);
    expect(withPage[0].section).toBe("第5页");
    expect(withPage[0].pageFrom).toBe(5);

    const invalid = chunkBlocks([{ text: "没有真实页号的正文", page: 0 }]);
    expect(invalid[0].pageFrom).toBeUndefined();
    expect(invalid[0].pageTo).toBeUndefined();
  });

  it("空块与纯空白块不产生片段", () => {
    expect(chunkBlocks([])).toEqual([]);
    expect(chunkBlocks([{ text: "   \n  " }])).toEqual([]);
  });
});

describe("uploadsToPack", () => {
  const mdDoc = makeDoc({
    id: "doc-md",
    title: "数据结构讲义",
    fileName: "ds.md",
    kind: "md",
    kcIds: ["c09"],
  });
  const pdfDoc = makeDoc({
    id: "doc-pdf",
    title: "网络原理.pdf",
    fileName: "network.pdf",
    kind: "pdf",
    pageCount: 10,
    kcIds: ["c20"],
  });
  const freeDoc = makeDoc({
    id: "doc-free",
    title: "随手笔记",
    fileName: "notes.txt",
    kind: "txt",
    kcIds: [],
  });
  const chunks: UploadChunk[] = [
    makeChunk({
      id: "chunk-md-1",
      docId: "doc-md",
      title: "数据结构讲义",
      section: "第1章 绪论",
      text: "栈是后进先出的线性表。",
    }),
    makeChunk({
      id: "chunk-md-2",
      docId: "doc-md",
      title: "数据结构讲义",
      section: "",
      text: "队列是先进先出。",
      index: 1,
    }),
    makeChunk({
      id: "chunk-pdf-1",
      docId: "doc-pdf",
      title: "网络原理.pdf",
      section: "",
      text: "TCP 三次握手。",
      pageFrom: 3,
      pageTo: 4,
    }),
    makeChunk({
      id: "chunk-free-1",
      docId: "doc-free",
      title: "随手笔记",
      section: "笔记",
      text: "不属于任何知识点。",
    }),
  ];

  it("产出的包能被 validatePack 通过", () => {
    const pack = uploadsToPack([mdDoc, pdfDoc, freeDoc], chunks);

    expect(validatePack(pack)).toEqual([]);
    expect(pack.id.trim()).not.toBe("");
    expect(pack.title.trim()).not.toBe("");
    expect(pack.claims).toEqual([]);
    expect(pack.sources.every((source) => source.kind === "lecture")).toBe(true);
  });

  it("只收绑定了知识点的文档，chunk 继承文档的 kcIds", () => {
    const pack = uploadsToPack([mdDoc, pdfDoc, freeDoc], chunks);

    expect(pack.sources.map((source) => source.id)).toEqual(["doc-md", "doc-pdf"]);
    expect(pack.chunks.map((chunk) => chunk.id)).toEqual([
      "chunk-md-1",
      "chunk-md-2",
      "chunk-pdf-1",
    ]);

    for (const chunk of pack.chunks) {
      expect(chunk.chapter).toBe(UPLOAD_CHAPTER);
      expect(chunk.kcIds.length).toBeGreaterThan(0);
      expect(chunk.section.trim()).not.toBe("");
      expect(chunk.text.trim()).not.toBe("");
    }

    expect(pack.chunks.find((chunk) => chunk.id === "chunk-md-1")?.kcIds).toEqual(["c09"]);
    expect(pack.chunks.find((chunk) => chunk.id === "chunk-pdf-1")?.kcIds).toEqual(["c20"]);
  });

  it("md / txt 不带页码，PDF 保留真实页跨度", () => {
    const pack = uploadsToPack([mdDoc, pdfDoc], chunks);

    const md = pack.chunks.find((chunk) => chunk.id === "chunk-md-1");
    expect(md?.pageFrom).toBeUndefined();
    expect(md?.pageTo).toBeUndefined();

    const pdf = pack.chunks.find((chunk) => chunk.id === "chunk-pdf-1");
    expect(pdf?.pageFrom).toBe(3);
    expect(pdf?.pageTo).toBe(4);
    expect(pdf?.section).toBe("第3页");
  });

  it("txt 与 md 一样不产生页码", () => {
    const txt = makeDoc({
      id: "doc-txt",
      title: "课堂笔记",
      fileName: "class.txt",
      kind: "txt",
      kcIds: ["c30"],
    });
    const pack = uploadsToPack(
      [txt],
      [
        makeChunk({
          id: "chunk-txt",
          docId: "doc-txt",
          title: "课堂笔记",
          section: "课堂笔记",
          text: "队列是先进先出。",
        }),
      ],
    );

    expect(pack.chunks[0].pageFrom).toBeUndefined();
    expect(pack.chunks[0].pageTo).toBeUndefined();
    expect(validatePack(pack)).toEqual([]);
  });

  it("空 section / 空标题都有非空兜底，validatePack 仍通过", () => {
    const untitled = makeDoc({
      id: "doc-untitled",
      title: "   ",
      fileName: "fallback.txt",
      kind: "txt",
      kcIds: ["c01"],
    });
    const pack = uploadsToPack(
      [untitled],
      [
        makeChunk({
          id: "chunk-untitled",
          docId: "doc-untitled",
          title: "",
          section: "",
          text: "只有正文也能定位到文件。",
        }),
      ],
    );

    expect(pack.sources[0].title).toBe("fallback.txt");
    expect(pack.chunks[0].section).toBe("fallback.txt");
    expect(validatePack(pack)).toEqual([]);
  });

  it("孤儿 chunk 与重复 id 不会进包", () => {
    const pack = uploadsToPack(
      [mdDoc],
      [
        makeChunk({ id: "chunk-a", docId: "doc-md", text: "正文 A" }),
        makeChunk({ id: "chunk-a", docId: "doc-md", text: "重复 id 的正文" }),
        makeChunk({ id: "chunk-orphan", docId: "missing-doc", text: "孤儿正文" }),
      ],
    );

    expect(pack.chunks.map((chunk) => chunk.id)).toEqual(["chunk-a"]);
    expect(pack.chunks[0].text).toBe("正文 A");
    expect(validatePack(pack)).toEqual([]);
  });
});

describe("上传资料检索", () => {
  const chunks: UploadChunk[] = [
    makeChunk({
      id: "u1",
      title: "数据结构讲义",
      section: "第7章 查找",
      text: "二分查找的时间复杂度是 O(log n)，每次比较后区间减半。",
    }),
    makeChunk({
      id: "u2",
      title: "数据结构讲义",
      section: "第8章 排序",
      text: "冒泡排序的时间复杂度是 O(n^2)，相邻元素两两交换。",
    }),
    makeChunk({
      id: "u3",
      title: "网络原理",
      section: "第2章",
      text: "TCP 三次握手建立连接，四次挥手释放连接。",
    }),
  ];

  it("uploadsToKbDocuments 用 chunk.id 充当 KbDocument.kcId", () => {
    const docs = uploadsToKbDocuments(chunks);
    expect(docs.map((doc) => doc.kcId)).toEqual(["u1", "u2", "u3"]);
    expect(docs.every((doc) => doc.title.trim() !== "")).toBe(true);
  });

  it("BM25 能命中相关片段，再把 chunk.id 映射回片段", () => {
    const index = buildUploadIndex(chunks);
    const hits = retrieveUploads(index, chunks, "二分查找 时间复杂度", 2);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunk.id).toBe("u1");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it("无相关词返回空，top-k 受限", () => {
    const index = buildUploadIndex(chunks);

    expect(retrieveUploads(index, chunks, "量子纠缠", 3)).toEqual([]);
    expect(retrieveUploads(index, chunks, "时间复杂度", 1).length).toBeLessThanOrEqual(1);
  });
});

describe("引用抬头与上下文", () => {
  it("页码存在时抬头为 [讲义·《文件名》·上传资料·第X页]", () => {
    const single = hitOf(makeChunk({ id: "h1", title: "数据结构讲义.pdf", pageFrom: 3, pageTo: 3 }));
    expect(uploadCitationLabel(single)).toBe(
      "[讲义·《数据结构讲义.pdf》·上传资料·第3页]",
    );

    const range = hitOf(makeChunk({ id: "h2", title: "数据结构讲义.pdf", pageFrom: 3, pageTo: 4 }));
    expect(uploadCitationLabel(range)).toBe(
      "[讲义·《数据结构讲义.pdf》·上传资料·第3–4页]",
    );
  });

  it("md / txt 没有页码时整段省略，不写第 0 页或 undefined", () => {
    const hit = hitOf(makeChunk({ id: "h3", title: "笔记.md" }));
    const label = uploadCitationLabel(hit);

    expect(label).toBe("[讲义·《笔记.md》·上传资料]");
    expect(label).not.toContain("第");
    expect(label).not.toContain("undefined");
  });

  it("formatUploadContext 编号并拼接实际片段，空命中返回空串", () => {
    const first = hitOf(makeChunk({ id: "h1", title: "数据结构讲义.pdf", pageFrom: 3, pageTo: 3, text: "栈是后进先出的线性表。" }));
    const second = hitOf(makeChunk({ id: "h2", title: "笔记.md", text: "队列是先进先出。" }));
    const context = formatUploadContext([first, second]);

    expect(context).toContain("[资料1] [讲义·《数据结构讲义.pdf》·上传资料·第3页]");
    expect(context).toContain("[资料2] [讲义·《笔记.md》·上传资料]");
    expect(context).toContain("栈是后进先出的线性表。");
    expect(context).toContain("队列是先进先出。");
    expect(formatUploadContext([])).toBe("");
  });

  it("parseUploadCitations 只保留本次注入范围内的编号", () => {
    const used = parseUploadCitations(
      "见 [资料1] 与【资料2】，还有 [资料 3]；[资料9] 是模型编的。",
      3,
    );

    expect([...used]).toEqual([1, 2, 3]);
    expect(parseUploadCitations("[资料1]", 0).size).toBe(0);
    expect(parseUploadCitations("[资料0] 与 [资料-1]", 5).size).toBe(0);
    expect([...parseUploadCitations("[资料2] [资料2]", 3)]).toEqual([2]);
  });
});

describe("decodeTextFile", () => {
  const encoder = new TextEncoder();

  it("合法 UTF-8 直接读出", () => {
    const decoded = decodeTextFile(encoder.encode("栈与队列"));
    expect(decoded.encoding).toBe("utf-8");
    expect(decoded.text).toBe("栈与队列");
  });

  it("UTF-8 BOM 会被剥离", () => {
    const body = encoder.encode("栈与队列");
    const bytes = new Uint8Array(body.length + 3);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(body, 3);

    const decoded = decodeTextFile(bytes);
    expect(decoded.encoding).toBe("utf-8");
    expect(decoded.text).toBe("栈与队列");
    expect(decoded.text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("GBK / GB18030 中文能正确读出", () => {
    // 「中文」的 GBK 字节：D6 D0 CE C4
    const decoded = decodeTextFile(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]));
    expect(decoded.encoding).toBe("gb18030");
    expect(decoded.text).toBe("中文");
  });

  it("带 BOM 的 UTF-16LE 能正确读出", () => {
    // BOM + 「中文」的 UTF-16LE 字节
    const decoded = decodeTextFile(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]));
    expect(decoded.encoding).toBe("utf-16le");
    expect(decoded.text).toBe("中文");
  });

  it("空文件按 UTF-8 返回空串", () => {
    expect(decodeTextFile(new Uint8Array([]))).toEqual({ text: "", encoding: "utf-8" });
  });
});

describe("ImportResult", () => {
  it("失败态只带 error 与 written: 0，不落半份文档", () => {
    const failed: ImportResult = { ok: false, error: "无文本层", written: 0 };
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.written).toBe(0);
      expect(failed.error).not.toBe("");
      expect("doc" in failed).toBe(false);
    }
  });
});
