/**
 * 浏览器侧 PDF 抽文本。
 *
 * 只在用户上传时按需动态加载 pdfjs-dist，首屏与导师页不会为它付包体成本。
 * 不渲染画布、不做 OCR：扫描件没有文本层时如实拒绝，引导用户改用可复制文字的 PDF。
 *
 * workerSrc 用「裸包名 + new URL(..., import.meta.url)」交给 Turbopack 静态解析；
 * 若某个版本解析失败，按设计约定退化为 public/ 拷贝或 ?url 导入，并以 npm run build 验证。
 */

import { MAX_PDF_PAGES, type TextBlock } from "@/lib/knowledge";

export const NO_TEXT_LAYER_REASON =
  "这份 PDF 没有文本层（可能是扫描件）。本版本不做 OCR，请上传可复制文字的 PDF 或 Markdown/TXT。";

export type PdfExtractResult =
  | {
      readonly ok: true;
      /** 按页返回；空白页不产生块，页码仍是真实页号。 */
      readonly blocks: readonly TextBlock[];
      readonly pageCount: number;
      /** 去空白后的正文码点数。 */
      readonly charCount: number;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      /** 能读到页数时一并返回，方便界面说明「这份 301 页」。 */
      readonly pageCount?: number;
    };

type PdfJsModule = typeof import("pdfjs-dist");
type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;

/** 页数上限的纯函数校验，便于不依赖真实 PDF 的测试与提示拼装。 */
export function pdfPageLimitError(pageCount: number): string | null {
  if (!Number.isInteger(pageCount) || pageCount <= 0) return "PDF 页数无效。";
  if (pageCount > MAX_PDF_PAGES) {
    return `这份 PDF 有 ${pageCount} 页，超过单份 ${MAX_PDF_PAGES} 页上限。请拆分后再上传。`;
  }
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 只在浏览器里设置 worker。
 *
 * Node（单测 / 命令行）没有 Worker，pdfjs 会退回 fake worker；
 * 此时留空 workerSrc，避免把一段在 Node 里不存在的包路径当成真地址。
 */
function configureWorker(pdfjs: PdfJsModule): void {
  if (typeof window === "undefined") return;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

/**
 * 逐页抽文本。
 *
 * hasEOL 表示「这一项后面有换行」，不补换行会把标题与正文粘成一行，
 * 影响切块时的句读判断。页码从 1 起，与 PDF 阅读器一致。
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractResult> {
  if (bytes.length === 0) return { ok: false, reason: "PDF 文件为空。" };

  let pdfjs: PdfJsModule;
  try {
    pdfjs = await import("pdfjs-dist");
  } catch (err) {
    return { ok: false, reason: `PDF 解析库加载失败：${errorMessage(err)}` };
  }

  configureWorker(pdfjs);

  // pdf.js 可能把 buffer transfer 给 worker；复制一份，调用方仍可复用原始字节。
  let task: ReturnType<PdfJsModule["getDocument"]>;
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  } catch (err) {
    return { ok: false, reason: `PDF 解析失败：${errorMessage(err)}` };
  }

  let doc: PdfDocument | undefined;

  try {
    doc = await task.promise;
    const pageCount = doc.numPages;
    const limitError = pdfPageLimitError(pageCount);
    if (limitError !== null) return { ok: false, reason: limitError, pageCount };

    const blocks: TextBlock[] = [];
    let charCount = 0;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();

      let text = "";
      for (const item of content.items) {
        // marked-content 项没有 str，跳过；TextItem 才有 hasEOL。
        if (!("str" in item)) continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      page.cleanup();

      const pageText = text.trim();
      if (pageText === "") continue;
      blocks.push({ text: pageText, page: pageNumber });
      charCount += Array.from(pageText).length;
    }

    if (charCount === 0) return { ok: false, reason: NO_TEXT_LAYER_REASON, pageCount };
    return { ok: true, blocks, pageCount, charCount };
  } catch (err) {
    return { ok: false, reason: `PDF 解析失败：${errorMessage(err)}` };
  } finally {
    // pdfjs-dist 6 的 PDFDocumentProxy 不再暴露 destroy，统一由 loadingTask 释放 worker。
    try {
      await task.destroy();
    } catch {
      // 已经卸载或 worker 已退出，不影响解析结果
    }
  }
}
