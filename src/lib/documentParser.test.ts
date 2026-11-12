import { describe, it, expect } from "vitest";
import { pdf, scanPdf } from "../../scripts/fixtures/pdf";
import { parseDocumentPages } from "./documentParser";
describe("real server document parsers", () => {
  it("decodes complete UTF-8/GB18030 text without the old 20k cutoff", async () => {
    const text = "栈的后进先出。".repeat(6000);
    expect(
      (await parseDocumentPages(Buffer.from(text), "讲义.md")).blocks[0].text,
    ).toBe(text);
    expect(
      (
        await parseDocumentPages(
          new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]),
          "讲义.txt",
        )
      ).blocks[0].text,
    ).toBe("中文");
  });
  it("reads PDF text with real page numbers", async () => {
    const content =
      "BT /F1 14 Tf 20 160 Td (A stack follows last in first out. A queue follows first in first out.) Tj ET";
    const bytes = pdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ]);
    const result = await parseDocumentPages(bytes, "text.pdf");
    expect(result.blocks[0]).toMatchObject({
      page: 1,
      text: expect.stringContaining("last in first out"),
    });
    expect(result.ocrPages).toBe(0);
  }, 30000);
  it("OCRs an image-only PDF using bundled English and Chinese models", async () => {
    const bytes = Buffer.from(scanPdf());
    const result = await parseDocumentPages(bytes, "scan.pdf");
    expect(result.ocrPages).toBe(1);
    expect(result.blocks[0].page).toBe(1);
    expect(result.blocks[0].text.toUpperCase()).toContain("LAST IN FIRST OUT");
  }, 120000);
});
