import { describe, expect, it } from "vitest";

import {
  buildUploadRows,
  detectUploadKind,
  markdownBlocks,
  plainBlocks,
  uploadFileError,
  uploadTextError,
} from "@/components/knowledge-upload";
import { MAX_FILE_BYTES, MAX_FILE_CHARS } from "@/lib/knowledge";

describe("detectUploadKind", () => {
  it("识别 md / txt / pdf，大小写不敏感", () => {
    expect(detectUploadKind("讲义.md")).toBe("md");
    expect(detectUploadKind("README.MD")).toBe("md");
    expect(detectUploadKind("notes.markdown")).toBe("md");
    expect(detectUploadKind("a.TXT")).toBe("txt");
    expect(detectUploadKind("book.Pdf")).toBe("pdf");
  });

  it("拒绝白名单外的扩展名与无扩展名", () => {
    expect(detectUploadKind("slides.pptx")).toBeNull();
    expect(detectUploadKind("photo.png")).toBeNull();
    expect(detectUploadKind("noext")).toBeNull();
    expect(detectUploadKind(".md")).toBeNull();
    expect(detectUploadKind("trailing.")).toBeNull();
  });
});

describe("uploadFileError", () => {
  it("类型未知时直接拒绝", () => {
    expect(uploadFileError(null, 10)).toContain("只支持");
  });

  it("空文件与超限文件被拒绝，正常文件通过", () => {
    expect(uploadFileError("md", 0)).toContain("空");
    expect(uploadFileError("pdf", MAX_FILE_BYTES + 1)).toContain("超过单份");
    expect(uploadFileError("pdf", MAX_FILE_BYTES)).toBeNull();
    expect(uploadFileError("txt", 1024)).toBeNull();
  });
});

describe("uploadTextError", () => {
  it("按码点校验单份正文上限", () => {
    expect(uploadTextError(0)).toContain("没有可导入的正文");
    expect(uploadTextError(MAX_FILE_CHARS + 1)).toContain(String(MAX_FILE_CHARS));
    expect(uploadTextError(MAX_FILE_CHARS)).toBeNull();
  });
});

describe("markdownBlocks", () => {
  it("按标题分段，标题行保留在正文里", () => {
    const blocks = markdownBlocks(
      "# 第一章\n内容一\n\n## 1.1 小节\n内容二\n普通行",
      "讲义.md",
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ section: "第一章" });
    expect(blocks[0].text).toContain("# 第一章");
    expect(blocks[0].text).toContain("内容一");
    expect(blocks[1]).toMatchObject({ section: "1.1 小节" });
    expect(blocks[1].text).toContain("内容二");
    expect(blocks[1].text).toContain("普通行");
  });

  it("没有标题时整篇用文件名兜底", () => {
    const blocks = markdownBlocks("只有正文\n没有标题", "笔记.md");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].section).toBe("笔记.md");
    expect(blocks[0].text).toBe("只有正文\n没有标题");
  });

  it("空白正文不产生块", () => {
    expect(markdownBlocks("   \n\n", "x.md")).toEqual([]);
  });
});

describe("plainBlocks", () => {
  it("纯文本一段，小节名用文件名", () => {
    expect(plainBlocks("正文", "a.txt")).toEqual([{ text: "正文", section: "a.txt" }]);
    expect(plainBlocks("  \n", "a.txt")).toEqual([]);
  });
});

describe("buildUploadRows", () => {
  const meta = { id: "doc-1", createdAt: "2026-10-28T00:00:00.000Z" };

  it("生成自洽的 doc 与 chunks：id、docId、方向、序号与段数一致", () => {
    const kcIds = ["k1", "k2"];
    const { doc, chunks } = buildUploadRows(
      {
        directionId: "d1",
        fileName: "笔记.md",
        kind: "md",
        size: 1200,
        blocks: [{ text: "甲".repeat(600), section: "第一章" }],
        charCount: 600,
        kcIds,
      },
      meta,
    );

    expect(doc.id).toBe("doc-1");
    expect(doc.title).toBe("笔记.md");
    expect(doc.directionId).toBe("d1");
    expect(doc.charCount).toBe(600);
    expect(doc.chunkCount).toBe(chunks.length);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.id)).toEqual(
      chunks.map((_, index) => `doc-1:${index}`),
    );
    expect(chunks.every((chunk) => chunk.docId === "doc-1")).toBe(true);
    expect(chunks.every((chunk) => chunk.directionId === "d1")).toBe(true);
    expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
    expect(doc.pageCount).toBeUndefined();
    expect(chunks[0].pageFrom).toBeUndefined();

    // 调用方之后改原数组不能影响已生成的行
    expect(doc.kcIds).toEqual(kcIds);
    expect(doc.kcIds).not.toBe(kcIds);
  });

  it("PDF 保留真实页码，section 兜底为「第X页」", () => {
    const { doc, chunks } = buildUploadRows(
      {
        directionId: "d1",
        fileName: "教材.pdf",
        kind: "pdf",
        size: 900,
        blocks: [{ text: "第 3 页的正文", page: 3 }],
        charCount: 8,
        pageCount: 3,
        kcIds: [],
      },
      { id: "doc-2", createdAt: "2026-10-28T00:00:00.000Z" },
    );

    expect(doc.pageCount).toBe(3);
    expect(doc.kcIds).toEqual([]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].section).toBe("第3页");
    expect(chunks[0].pageFrom).toBe(3);
    expect(chunks[0].pageTo).toBe(3);
  });

  it("没有正文时 chunks 为空，由调用方拒绝导入", () => {
    const { doc, chunks } = buildUploadRows(
      {
        directionId: "d1",
        fileName: "空.txt",
        kind: "txt",
        size: 0,
        blocks: [],
        charCount: 0,
        kcIds: [],
      },
      meta,
    );

    expect(chunks).toEqual([]);
    expect(doc.chunkCount).toBe(0);
  });
});
