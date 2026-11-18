"use client";
import { markdownBlocks,plainBlocks } from "@/lib/documentText";
import type { DocumentReference } from "@/lib/documentContracts";
import { uploadDocument } from "@/lib/documentClient";
import { updateDocKcIds } from "@/lib/kbStore";

/**
 * 上传资料到当前方向的知识库。
 *
 * 解析全部在浏览器里完成：md / txt 走编码探测，PDF 用 pdfjs-dist 抽文本层。
 * 这里只负责「准备行」与展示进度；真正的写入由 kbStore.importDocument 保证
 * docs + chunks 单事务、要么全写要么一条都不写，所以失败时界面只显示错误，
 * 不会留下半份文档。
 *
 * 登录后走服务端解析与扫描 OCR；匿名模式仅在浏览器抽取文字层。
 */

import { useRef, useState } from "react";

import {
  MAX_FILE_BYTES,
  MAX_FILE_CHARS,
  MAX_PDF_PAGES,
  chunkBlocks,
  type TextBlock,
  type TextEncoding,
  type UploadChunk,
  type UploadDoc,
  type UploadKind,
} from "@/lib/knowledge";
import {
  formatBytes,
  getKbStorageForUser,
  importDocument,
  kbSyncWarningOf,
} from "@/lib/kbStore";
import { extractPdfText } from "@/lib/pdf";
import { readFileBytes, readTextFile } from "@/lib/textFile";

// ── 纯函数（可在 Node 里直接测） ──────────────────────────────────

const EXTENSION_KINDS: Record<string, UploadKind> = {
  md: "md",
  markdown: "md",
  txt: "txt",
  pdf: "pdf",
};

/** 按扩展名判定上传类型；不在白名单里返回 null。 */
export function detectUploadKind(fileName: string): UploadKind | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return EXTENSION_KINDS[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * 单份文件的类型与大小检查。
 *
 * 在读取文件之前调用：20MB 的文件没必要先读进内存再拒绝。
 */
export function uploadFileError(kind: UploadKind | null, size: number): string | null {
  if (kind === null) {
    return "只支持 Markdown（.md）、纯文本（.txt）与带文本层的 PDF 文件。";
  }
  if (!Number.isFinite(size) || size <= 0) {
    return "文件是空的，没有可导入的内容。";
  }
  if (size > MAX_FILE_BYTES) {
    return `文件 ${formatBytes(size)}，超过单份 ${formatBytes(MAX_FILE_BYTES)} 上限。请拆分后再上传。`;
  }
  return null;
}

/** 解码后的正文检查。段落/字数上限按整份文件判断，超了就整体拒绝。 */
export function uploadTextError(charCount: number): string | null {
  if (!Number.isFinite(charCount) || charCount <= 0) {
    return "文件里没有可导入的正文。";
  }
  if (charCount > MAX_FILE_CHARS) {
    return `正文共 ${charCount} 字，超过单份 ${MAX_FILE_CHARS} 字上限。请拆分后再上传。`;
  }
  return null;
}

export { markdownBlocks,plainBlocks } from "@/lib/documentText";

export interface UploadRowsInput {
  readonly directionId: string;
  readonly fileName: string;
  readonly kind: UploadKind;
  readonly size: number;
  readonly blocks: readonly TextBlock[];
  /** 原文码点数；相邻片段有重叠，不要求等于片段正文之和。 */
  readonly charCount: number;
  /** 仅 PDF。 */
  readonly pageCount?: number;
  readonly kcIds: readonly string[];
}

export interface UploadRows {
  readonly doc: UploadDoc;
  readonly chunks: readonly UploadChunk[];
}

/**
 * 解析结果 → 待写入的 doc + chunks。
 *
 * id 与 createdAt 由调用方传入，保持纯函数可测；片段 id 用 `<docId>:<序号>`，
 * 同一文档内唯一，删除文档时按 docId 级联即可全部清掉。
 */
export function buildUploadRows(
  input: UploadRowsInput,
  meta: { readonly id: string; readonly createdAt: string },
): UploadRows {
  const chunks: UploadChunk[] = chunkBlocks(input.blocks).map((draft, index) => ({
    id: `${meta.id}:${index}`,
    docId: meta.id,
    directionId: input.directionId,
    title: input.fileName,
    section: draft.section,
    ...(draft.pageFrom === undefined ? {} : { pageFrom: draft.pageFrom, pageTo: draft.pageTo }),
    text: draft.text,
    index,
  }));

  const doc: UploadDoc = {
    id: meta.id,
    directionId: input.directionId,
    title: input.fileName,
    fileName: input.fileName,
    kind: input.kind,
    size: input.size,
    ...(input.pageCount === undefined ? {} : { pageCount: input.pageCount }),
    charCount: input.charCount,
    chunkCount: chunks.length,
    kcIds: [...input.kcIds],
    createdAt: meta.createdAt,
  };

  return { doc, chunks };
}

// ── 解析 ──────────────────────────────────────────────────────────

interface ParsedUpload {
  readonly blocks: readonly TextBlock[];
  readonly charCount: number;
  readonly pageCount?: number;
  readonly encoding?: TextEncoding;
}

type ParseOutcome =
  | { readonly ok: true; readonly parsed: ParsedUpload }
  | { readonly ok: false; readonly error: string };

function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

async function parseUpload(file: File, kind: UploadKind): Promise<ParseOutcome> {
  if (kind === "pdf") {
    const bytes = await readFileBytes(file);
    const result = await extractPdfText(bytes);
    if (!result.ok) return { ok: false, error: result.reason };
    return {
      ok: true,
      parsed: { blocks: result.blocks, charCount: result.charCount, pageCount: result.pageCount },
    };
  }

  const content = await readTextFile(file);
  const blocks =
    kind === "md"
      ? markdownBlocks(content.text, content.fileName)
      : plainBlocks(content.text, content.fileName);

  return {
    ok: true,
    parsed: { blocks, charCount: codePointLength(content.text), encoding: content.encoding },
  };
}

function newDocumentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `doc-${crypto.randomUUID()}`;
  }
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── 组件 ──────────────────────────────────────────────────────────

type UploadStage = "idle" | "reading" | "parsing" | "chunking" | "writing" | "done";

const STAGE_LABEL: Record<Exclude<UploadStage, "idle">, string> = {
  reading: "读取文件…",
  parsing: `解析 PDF 文本层（最多 ${MAX_PDF_PAGES} 页）…`,
  chunking: "切分为片段…",
  writing: "写入本地知识库（单事务）…",
  done: "导入完成",
};

const STAGE_PERCENT: Record<Exclude<UploadStage, "idle">, number> = {
  reading: 15,
  parsing: 40,
  chunking: 70,
  writing: 90,
  done: 100,
};

export function KnowledgeUpload({
  directionId,
  concepts,
  userId,
  onImported, draftKey, onBusyChange, disabled = false,
}: {
  directionId: string;
  concepts: readonly { id: string; name: string }[];
  /** 有账号时写入「本地 + 账号」复合存储；为空表示只存本浏览器。 */
  userId?: string | null;
  /** 导入成功后调用；面板据此重新读取 docs / chunks。 */
  onImported: (document?: DocumentReference) => void;
  draftKey?: string;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selectedKcs, setSelectedKcs] = useState<readonly string[]>([]);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [encodingNote, setEncodingNote] = useState<string | null>(null);

  const busy = stage !== "idle" && stage !== "done";
  const toggleKc = (id: string): void => {
    setSelectedKcs((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const start = async (file: File): Promise<void> => {
    if (busy || disabled) return;
    setFile(file);
    setMessage(null);
    setStage("idle");

    const detected = detectUploadKind(file.name);
    const fileError = uploadFileError(detected, file.size);
    if (detected === null || fileError !== null) {
      setError(fileError ?? "无法识别文件类型。");
      return;
    }

    setError(null);
    setMessage(null);
    setEncodingNote(null);
    setStage("reading");
    onBusyChange?.(true);

    try {
      if(userId){

        setStage("parsing");
        const doc=await uploadDocument(file,directionId,setMessage,undefined,draftKey);
        if (selectedKcs.length) {
          const storage = getKbStorageForUser(userId);
          const binding = storage && await updateDocKcIds(storage, doc.id, selectedKcs);
          if (!binding?.ok) setError("文件已入库，知识点绑定失败。可在资料列表重新绑定。");
        }
        setMessage(`已保存「${doc.name}」· ${doc.chunkCount} 个片段${doc.ocrPages?` · ${doc.ocrPages} 页 OCR`:""}，重复文件复用索引。`);
        setStage("done"); setFile(null); setSelectedKcs([]); onImported(doc); return;
      }
      if (detected === "pdf") setStage("parsing");
      const outcome = await parseUpload(file, detected);
      if (!outcome.ok) {
        setError(outcome.error);
        setStage("idle");
        return;
      }

      const parsed = outcome.parsed;
      if (parsed.encoding !== undefined && parsed.encoding !== "utf-8") {
        setEncodingNote(`按 ${parsed.encoding.toUpperCase()} 读取`);
      }

      const textError = uploadTextError(parsed.charCount);
      if (textError !== null) {
        setError(textError);
        setStage("idle");
        return;
      }

      setStage("chunking");
      const rows = buildUploadRows(
        {
          directionId,
          fileName: file.name,
          kind: detected,
          size: file.size,
          blocks: parsed.blocks,
          charCount: parsed.charCount,
          ...(parsed.pageCount === undefined ? {} : { pageCount: parsed.pageCount }),
          kcIds: selectedKcs,
        },
        { id: newDocumentId(), createdAt: new Date().toISOString() },
      );

      if (rows.chunks.length === 0) {
        setError("文件里没有可导入的正文。");
        setStage("idle");
        return;
      }

      const storage = getKbStorageForUser(userId);
      if (storage === null) {
        setError("当前浏览器不支持 IndexedDB，上传资料无法保存。");
        setStage("idle");
        return;
      }

      setStage("writing");
      const result = await importDocument(storage, rows.doc, rows.chunks);
      if (!result.ok) {
        // 失败只在内存里报错：docs / chunks 一条都没写（409 冲突除外，提示原文已说明）
        setError(result.error);
        setStage("idle");
        return;
      }

      /*
       * 成功文案必须区分「真同步了」与「只写在本机」：
       * 远端失败时 importDocument 仍然成功（本地已落库），但 syncWarning 会给出原因。
       */
      const syncWarning = kbSyncWarningOf(storage);
      const synced = userId !== undefined && userId !== null && userId.trim() !== "" && syncWarning === null;

      const parts = [
        `${rows.doc.chunkCount} 段`,
        `${rows.doc.charCount.toLocaleString("zh-CN")} 字`,
      ];
      if (parsed.pageCount !== undefined) parts.push(`${parsed.pageCount} 页`);
      if (parsed.encoding !== undefined) parts.push(`按 ${parsed.encoding.toUpperCase()} 读取`);
      const where =
        synced
          ? "已同步到账号。"
          : syncWarning !== null
            ? `已保存到本机；账号同步失败：${syncWarning}`
            : "仅存本浏览器。";
      setMessage(`已导入《${file.name}》：${parts.join(" · ")}。${where}`);
      setStage("done");
      setFile(null);
      setSelectedKcs([]);
      if (inputRef.current !== null) inputRef.current.value = "";
      onImported();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setError(`导入失败：${reason}`);
      setStage("idle");
    } finally {
      onBusyChange?.(false);
    }
  };

  const hasAccount = userId !== undefined && userId !== null && userId.trim() !== "";
  const percent = stage === "idle" ? 0 : STAGE_PERCENT[stage];
  const stageLabel =
    stage === "parsing" && hasAccount ? "正在索引资料…" : stage === "idle"
      ? ""
      : stage === "writing" && hasAccount
        ? "写入知识库（本机 + 账号）…"
        : STAGE_LABEL[stage];

  return (
    <div className="knowledge-import">
      <div className="knowledge-import-row">
        <div><strong>导入学习资料</strong><p>PDF、Markdown 或 TXT · 每份最多 {formatBytes(MAX_FILE_BYTES)}</p></div>
        <input ref={inputRef} type="file" hidden aria-label="选择学习资料"
          accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
          onChange={event => {
            const picked = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (picked) void start(picked);
          }} />
        <button type="button" className="direction-primary" disabled={busy || disabled} onClick={() => inputRef.current?.click()}>
          {busy ? "导入中…" : "导入"}
        </button>
      </div>
      {file && error && !busy && !uploadFileError(detectUploadKind(file.name), file.size) &&
        <button type="button" className="underline" disabled={disabled} onClick={() => void start(file)}>重试导入 {file.name}</button>}
      <details className="knowledge-import-limits"><summary>文件要求</summary>
        正文最多 {MAX_FILE_CHARS.toLocaleString("zh-CN")} 字，PDF 最多 {MAX_PDF_PAGES} 页。
        {hasAccount ? "扫描页自动尝试中英文 OCR，成功后保存到账号知识库。" : "本机可提取 PDF 文字层；导入扫描件请先登录。"}
      </details>
      {busy ? (
        <div className="mt-2">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="导入进度"
          >
            <div
              className="h-full bg-[var(--accent)] transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">{stageLabel}</p>
        </div>
      ) : null}

      {encodingNote !== null ? (
        <p className="mt-2 text-xs text-[var(--ink-faint)]">
          {encodingNote}；如果中文是乱码，请把文件另存为 UTF-8 后重试。
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="mt-2 rounded-lg border border-[var(--bad)] bg-[var(--bad-soft)] p-2 text-xs text-[var(--bad)]">
          {error}
        </p>
      ) : null}

      {message !== null ? (
        <p role="status" className="mt-2 rounded-lg border border-[var(--good)] bg-[var(--good-soft)] p-2 text-xs text-[var(--good)]">
          {message}
        </p>
      ) : null}

      {concepts.length > 0 ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-[var(--ink-soft)]">
            绑定知识点（可选，已选 {selectedKcs.length} 个）
          </summary>
          <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
            {concepts.map((concept) => (
              <label key={concept.id} className="flex items-start gap-1.5">
                <input
                  type="checkbox"
                  checked={selectedKcs.includes(concept.id)}
                  onChange={() => toggleKc(concept.id)}
                  disabled={busy}
                  className="mt-0.5"
                />
                <span className="min-w-0">{concept.name}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-[var(--ink-faint)]">
            不绑定也能在导师问答里检索；绑定后出题与依据核对会引用这些段落。
          </p>
        </details>
      ) : null}
    </div>
  );
}
