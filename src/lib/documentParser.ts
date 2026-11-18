import { markdownBlocks } from "./documentText";
/** Node-only PDF/text parser. Scanned pages are rasterized and OCRed, one per checkpoint. */
import { createRequire } from "node:module";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeTextFile, MAX_PDF_PAGES, type TextBlock } from "./knowledge";
const require = createRequire(import.meta.url);
let languagePath: Promise<string> | undefined;
function ocrLanguagePath() {
  return (languagePath ??= (async () => {
    const path = await mkdtemp(join(tmpdir(), "alp-ocr-"));
    const locations = [
      require("@tesseract.js-data/eng"),
      require("@tesseract.js-data/chi_sim"),
    ] as { code: string; langPath: string }[];
    for (const location of locations) {
      const code = location.code;
      await copyFile(
        join(location.langPath, `${code}.traineddata.gz`),
        join(path, `${code}.traineddata.gz`),
      );
    }
    return path;
  })().catch((error) => {
    languagePath = undefined;
    throw error;
  }));
}
export interface ParsedPages {
  blocks: TextBlock[];
  next: number;
  pageCount: number;
  ocrPages: number;
}
export async function parseDocumentPages(
  bytes: Uint8Array,
  name: string,
  from = 0,
): Promise<ParsedPages> {
  if (!/\.pdf$/iu.test(name)) {
    const { text } = decodeTextFile(bytes);
    return {
      blocks: /\.(md|markdown)$/iu.test(name)
        ? markdownBlocks(text, name)
        : [{ text, section: name }],
      next: 1,
      pageCount: 1,
      ocrPages: 0,
    };
  }
  const canvas = await import("@napi-rs/canvas");
  Object.assign(globalThis, {
    DOMMatrix: canvas.DOMMatrix,
    ImageData: canvas.ImageData,
    Path2D: canvas.Path2D,
  });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Buffer.slice() returns another Buffer, which PDF.js deliberately rejects.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  let worker: import("tesseract.js").Worker | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES)
      throw new Error(`PDF 超过 ${MAX_PDF_PAGES} 页，未导入。`);
    const blocks: TextBlock[] = [];
    let next = from,
      ocrPages = 0;
    for (; next < Math.min(pdf.numPages, from + 8); ) {
      const page = await pdf.getPage(next + 1);
      try {
        const content = await page.getTextContent();
        let text = content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("")
          .trim();
        // A page with a header/footer only can still be a scan. OCR the whole page in this case.
        if (text.replace(/\s/gu, "").length < 40) {
          const viewport0 = page.getViewport({ scale: 1 });
          const scale = Math.min(
            2,
            Math.sqrt(4_000_000 / (viewport0.width * viewport0.height)),
          );
          const viewport = page.getViewport({ scale });
          const surface = canvas.createCanvas(
            Math.ceil(viewport.width),
            Math.ceil(viewport.height),
          );
          await page.render({
            canvas: surface as unknown as HTMLCanvasElement,
            viewport,
          }).promise;
          const { createWorker, OEM } = await import("tesseract.js");
          worker = await createWorker("eng+chi_sim", OEM.LSTM_ONLY, {
            langPath: await ocrLanguagePath(),
            cacheMethod: "none",
            gzip: true,
            errorHandler: () => {},
          });
          const ocr = worker;
          const result = await Promise.race([
            ocr.recognize(surface.toBuffer("image/png")),
            new Promise<never>((_, reject) => {
              deadline = setTimeout(() => {
                void ocr.terminate();
                reject(new Error("本页 OCR 超时，请重试或提供清晰扫描件。"));
              }, 90_000);
            }),
          ]);
          clearTimeout(deadline);
          deadline = undefined;
          if (result.data.text.trim().length > text.length)
            text = result.data.text.trim();
          ocrPages++;
          await worker.terminate();
          worker = undefined;
        }
        blocks.push({
          text,
          page: next + 1,
          section: `第 ${next + 1} 页${ocrPages ? "（含 OCR）" : ""}`,
        });
        next++;
        if (ocrPages) break;
      } finally {
        page.cleanup();
      }
    }
    return { blocks, next, pageCount: pdf.numPages, ocrPages };
  } finally {
    clearTimeout(deadline);
    await worker?.terminate();
    await task.destroy();
  }
}
