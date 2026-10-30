/**
 * 每个方向的上传知识库：切块、编码探测、转成资料包与 BM25 文档。
 *
 * 本模块是纯函数：不读时钟、不取随机数、不碰网络 / IndexedDB / File。
 * 浏览器侧只负责把 File 变成 Uint8Array 或 TextBlock；存储与 React hook 在 kbStore.ts。
 *
 * 切块只保证一个不变量：所有常规块不超过 CHUNK_SIZE，只有边界块可能短于
 * MIN_CHUNK_CHARS。碎块合并必须先算合并后的长度，不能为了消灭碎块把块撑过上限。
 */

import type { MaterialChunk, MaterialPack, MaterialSource } from "@/lib/materials";
import { buildIndex, search, type Bm25Index, type KbDocument } from "@/lib/rag";

// ── 上限 ──────────────────────────────────────────────────────────

/**
 * 安全上限，不是产品配额。
 *
 * 这些值只用于防止单次上传把浏览器/服务端内存打爆；账号同步没有
 * 「每个方向只能 800 段」之类的产品限制。需要按部署收紧/放宽时用
 * ALP_MAX_* 覆盖（服务端与构建时读取；浏览器构建读不到时用默认值）。
 */
function envPositiveInt(name: string, fallback: number): number {
  try {
    const raw = typeof process === "undefined" ? undefined : process.env?.[name];
    if (typeof raw !== "string" || raw.trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.max(1, Math.floor(value));
  } catch {
    return fallback;
  }
}

/** 单个上传文件的大小安全上限（默认 64MB）。 */
export const MAX_FILE_BYTES = envPositiveInt("ALP_MAX_KB_FILE_BYTES", 64 * 1024 * 1024);

/** 单份 PDF 的页数安全上限（默认 2000 页）；超过时整体拒绝，不导入半份。 */
export const MAX_PDF_PAGES = envPositiveInt("ALP_MAX_KB_PDF_PAGES", 2_000);

/** 单个文件的正文安全上限（按码点计，默认 100 万字）。 */
export const MAX_FILE_CHARS = envPositiveInt("ALP_MAX_KB_FILE_CHARS", 1_000_000);

/**
 * 单个方向累计片段的安全上限（默认 5 万段）。
 * 仅防 OOM：正常课程资料远低于这个量级，超过时按容量不足明确拒绝。
 */
export const MAX_DIRECTION_CHUNKS = envPositiveInt("ALP_MAX_KB_DIRECTION_CHUNKS", 50_000);

/** 单个方向累计正文字符的安全上限（默认 1000 万字）。 */
export const MAX_DIRECTION_CHARS = envPositiveInt("ALP_MAX_KB_DIRECTION_CHARS", 10_000_000);

/** 常规块的目标长度（按码点计）。 */
export const CHUNK_SIZE = 500;

/** 同一块内相邻切块的重叠长度。 */
export const CHUNK_OVERLAP = 50;

/** 低于这个长度的块视为碎块，先尝试合并。 */
export const MIN_CHUNK_CHARS = 80;

/** 上传资料在教材 / 讲义命名空间里的章节名，会进引用抬头。 */
export const UPLOAD_CHAPTER = "上传资料";

/** 上传资料包的 id 前缀；多方向合并时追加方向 id。 */
export const UPLOAD_PACK_ID = "uploads";

// ── 数据形状 ──────────────────────────────────────────────────────

export type UploadKind = "md" | "txt" | "pdf";

/**
 * 一份导入成功并落库的上传文档。
 *
 * 没有 status / error：失败的导入只在内存里返回 ImportResult.ok=false，
 * 不写 docs / chunks，否则界面会看到一条永远无法检索的半份文档。
 */
export interface UploadDoc {
  readonly id: string;
  readonly directionId: string;
  /** 展示名，默认文件名，可改。 */
  readonly title: string;
  readonly fileName: string;
  readonly kind: UploadKind;
  readonly size: number;
  /** PDF 的真实页数；md / txt 没有。 */
  readonly pageCount?: number;
  readonly charCount: number;
  readonly chunkCount: number;
  /** 可选绑定；空数组表示只在导师问答里检索，不进出题与依据核对。 */
  readonly kcIds: readonly string[];
  readonly createdAt: string;
  /**
   * 同步版本号（Unix 毫秒），由服务端在写入时赋值；本机新建的文档没有这个字段。
   * 用数字而不是 ISO 串：同步的 CAS 要比较相等，不能依赖时间戳的格式化方式。
   */
  readonly updatedAt?: number;
}

/** 一段上传正文。页码只在 PDF 上出现，md / txt 不编页码。 */
export interface UploadChunk {
  readonly id: string;
  readonly docId: string;
  readonly directionId: string;
  /** 文档展示名，用于引用抬头。 */
  readonly title: string;
  readonly section: string;
  readonly pageFrom?: number;
  readonly pageTo?: number;
  readonly text: string;
  readonly index: number;
  /**
   * 片段向量。三个字段要么都没有（检索退化为纯 BM25），
   * 要么同时有：模型名与维度用于判断不同来源的向量能不能放在一起比较。
   */
  readonly embedding?: readonly number[];
  readonly embeddingModel?: string;
  readonly embeddingDim?: number;
}

/** 导入结果。失败时 written 恒为 0：单事务要么全写，要么一条都不写。 */
export type ImportResult =
  | { readonly ok: true; readonly doc: UploadDoc; readonly chunks: readonly UploadChunk[] }
  | { readonly ok: false; readonly error: string; readonly written: 0 };

/** 解析器交给切块器的原始片段：一页 PDF 或一个 md 小节。 */
export interface TextBlock {
  readonly text: string;
  /** PDF 的真实页码（1 起）；md / txt 不传。 */
  readonly page?: number;
  /** md 的最近标题；PDF 缺省时由切块器补「第X页」；txt 用文件名。 */
  readonly section?: string;
}

/** 切块结果，尚未绑定文档与方向。 */
export interface ChunkDraft {
  readonly text: string;
  readonly section: string;
  readonly pageFrom?: number;
  readonly pageTo?: number;
}

export interface ChunkOptions {
  readonly size?: number;
  readonly overlap?: number;
  readonly minChars?: number;
}

export type TextEncoding = "utf-8" | "gb18030" | "utf-16le";

/** 一次上传检索命中的片段。 */
export interface UploadHit {
  readonly chunk: UploadChunk;
  readonly score: number;
}

// ── 切块 ──────────────────────────────────────────────────────────

const SENTENCE_ENDS = new Set(["。", "！", "？", "!", "?", ".", "\n", "\r", "…"]);

interface Range {
  readonly start: number;
  readonly end: number;
}

interface DraftWithBlock {
  readonly text: string;
  readonly section: string;
  readonly pageFrom?: number;
  readonly pageTo?: number;
  readonly blockIndex: number;
  /** 码点长度，避免每轮比较都重新 Array.from。 */
  readonly length: number;
}

/** 在窗口内从后往前找句末标点，最多回溯窗口的一半。 */
function chooseCut(
  chars: readonly string[],
  start: number,
  limit: number,
  size: number,
): number {
  const floor = start + Math.max(1, Math.floor(size / 2));
  for (let i = limit - 1; i >= floor; i -= 1) {
    if (SENTENCE_ENDS.has(chars[i])) return i + 1;
  }
  return limit;
}

/** 在一个块内部按 size / overlap 切出区间；块之间不重叠。 */
function splitBlock(chars: readonly string[], size: number, overlap: number): Range[] {
  const total = chars.length;
  if (total === 0) return [];
  if (total <= size) return [{ start: 0, end: total }];

  const ranges: Range[] = [];
  let start = 0;
  while (start + size < total) {
    const end = chooseCut(chars, start, start + size, size);
    ranges.push({ start, end });
    const next = end - overlap;
    start = next > start ? next : start + 1;
  }
  ranges.push({ start, end: total });
  return ranges;
}

/** 同一块内相邻切块的重叠长度；按码点比较，避免把代理对切坏。 */
function suffixPrefixOverlap(
  before: readonly string[],
  after: readonly string[],
  limit: number,
): number {
  const max = Math.min(limit, before.length, after.length);
  for (let length = max; length > 0; length -= 1) {
    let same = true;
    for (let i = 0; i < length; i += 1) {
      if (before[before.length - length + i] !== after[i]) {
        same = false;
        break;
      }
    }
    if (same) return length;
  }
  return 0;
}

function minPage(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function maxPage(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/**
 * 合并前后两个块。
 *
 * 同一块内的相邻切块本来就重叠，先去掉重叠再算长度；跨块的块不重叠，
 * 直接相加。合并后超长就返回 null，宁可留下边界碎块也不产生超长块。
 */
function mergeDrafts(
  before: DraftWithBlock,
  after: DraftWithBlock,
  size: number,
  overlapLimit: number,
): DraftWithBlock | null {
  const beforeChars = Array.from(before.text);
  const afterChars = Array.from(after.text);
  const shared =
    before.blockIndex === after.blockIndex
      ? suffixPrefixOverlap(beforeChars, afterChars, overlapLimit)
      : 0;
  const length = beforeChars.length + afterChars.length - shared;
  if (length > size) return null;

  return {
    text: before.text + afterChars.slice(shared).join(""),
    section: before.section.trim() !== "" ? before.section : after.section,
    pageFrom: minPage(before.pageFrom, after.pageFrom),
    pageTo: maxPage(before.pageTo, after.pageTo),
    blockIndex: before.blockIndex,
    length,
  };
}

/**
 * 把解析出来的块切成可入库的片段。
 *
 * 块通常是 PDF 的一页或 md 的一个小节；页码只来自 block.page，
 * 没有页码的块永远不补页码。
 */
export function chunkBlocks(
  blocks: readonly TextBlock[],
  opts: ChunkOptions = {},
): ChunkDraft[] {
  const size = Math.max(1, Math.floor(opts.size ?? CHUNK_SIZE));
  const overlap = Math.min(Math.max(0, Math.floor(opts.overlap ?? CHUNK_OVERLAP)), size - 1);
  const minChars = Math.max(1, Math.floor(opts.minChars ?? MIN_CHUNK_CHARS));

  const drafts: DraftWithBlock[] = [];
  blocks.forEach((block, blockIndex) => {
    if (block.text.trim() === "") return;

    const page =
      block.page !== undefined && Number.isInteger(block.page) && block.page >= 1
        ? block.page
        : undefined;
    const rawSection = block.section?.trim() ?? "";
    const section = rawSection !== "" ? rawSection : page !== undefined ? `第${page}页` : "";
    const chars = Array.from(block.text);

    for (const range of splitBlock(chars, size, overlap)) {
      drafts.push({
        text: chars.slice(range.start, range.end).join(""),
        section,
        pageFrom: page,
        pageTo: page,
        blockIndex,
        length: range.end - range.start,
      });
    }
  });

  // 第一遍：碎块优先并入前一块。
  const merged: DraftWithBlock[] = [];
  for (const draft of drafts) {
    const prev = merged[merged.length - 1];
    if (draft.length < minChars && prev !== undefined) {
      const candidate = mergeDrafts(prev, draft, size, overlap);
      if (candidate !== null) {
        merged[merged.length - 1] = candidate;
        continue;
      }
    }
    merged.push(draft);
  }

  // 第二遍：仍碎且前一块装不下的，尝试并入后一块；都不行就保留为边界块。
  const result: DraftWithBlock[] = [];
  for (let i = 0; i < merged.length; i += 1) {
    const draft = merged[i];
    if (draft.length >= minChars) {
      result.push(draft);
      continue;
    }

    const next = merged[i + 1];
    if (next !== undefined) {
      const candidate = mergeDrafts(draft, next, size, overlap);
      if (candidate !== null) {
        merged[i + 1] = candidate;
        continue;
      }
    }
    result.push(draft);
  }

  return result.map((draft) => {
    const base: ChunkDraft = { text: draft.text, section: draft.section };
    return draft.pageFrom === undefined
      ? base
      : { ...base, pageFrom: draft.pageFrom, pageTo: draft.pageTo };
  });
}

// ── 编码探测 ──────────────────────────────────────────────────────

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function decodeWith(encoding: string, bytes: Uint8Array, fatal: boolean): string {
  return new TextDecoder(encoding, { fatal }).decode(bytes);
}

/**
 * 解码 md / txt 的字节。
 *
 * 顺序固定：UTF-8 → GB18030 → UTF-16LE。UTF-8 能严格解出来就按 UTF-8，
 * 否则按 GB18030（GBK 的超集）——中文旧讲义大量是 GBK；
 * UTF-16LE 没有 BOM 时几乎无法与 GBK 区分，所以放在最后兜底。
 * 三种都失败时按 UTF-8 非致命解码，保留替换字符，至少让用户看到「文件坏了」。
 */
export function decodeTextFile(bytes: Uint8Array): { text: string; encoding: TextEncoding } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: stripBom(decodeWith("utf-8", bytes.subarray(3), false)),
      encoding: "utf-8",
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: stripBom(decodeWith("utf-16le", bytes.subarray(2), false)),
      encoding: "utf-16le",
    };
  }

  try {
    return { text: decodeWith("utf-8", bytes, true), encoding: "utf-8" };
  } catch {
    // 不是合法 UTF-8，继续探测。
  }

  try {
    return { text: decodeWith("gb18030", bytes, true), encoding: "gb18030" };
  } catch {
    // 运行环境不支持 gb18030，或字节确实不合法。
  }

  try {
    return { text: stripBom(decodeWith("utf-16le", bytes, true)), encoding: "utf-16le" };
  } catch {
    return { text: decodeWith("utf-8", bytes, false), encoding: "utf-8" };
  }
}

// ── 资料包 ────────────────────────────────────────────────────────

function normalizeKcIds(kcIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of kcIds) {
    const kcId = raw.trim();
    if (kcId === "" || out.includes(kcId)) continue;
    out.push(kcId);
  }
  return out;
}

function validPage(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function pairedPages(pageFrom: number | undefined, pageTo: number | undefined): {
  readonly pageFrom?: number;
  readonly pageTo?: number;
} {
  const from = validPage(pageFrom);
  const to = validPage(pageTo);
  if (from === undefined && to === undefined) return {};
  if (from === undefined) return { pageFrom: to, pageTo: to };
  if (to === undefined) return { pageFrom: from, pageTo: from };
  return { pageFrom: Math.min(from, to), pageTo: Math.max(from, to) };
}

function displayTitle(doc: UploadDoc): string {
  const title = doc.title.trim();
  if (title !== "") return title;
  const fileName = doc.fileName.trim();
  return fileName !== "" ? fileName : doc.id;
}

/**
 * 上传文档 + 切块 → 现有教材链路的 MaterialPack。
 *
 * 只收 kcIds 非空的文档：没绑定知识点的上传资料只服务导师检索，
 * 不应该混进出题与依据核对的上下文。章节固定为「上传资料」，
 * 这样引用抬头与教材 / 讲义区分开，又不需要新增 MaterialKind。
 */
export function uploadsToPack(
  docs: readonly UploadDoc[],
  chunks: readonly UploadChunk[],
): MaterialPack {
  const used: UploadDoc[] = [];
  const seenDocs = new Set<string>();
  for (const doc of docs) {
    if (doc.id.trim() === "" || seenDocs.has(doc.id)) continue;
    if (normalizeKcIds(doc.kcIds).length === 0) continue;
    seenDocs.add(doc.id);
    used.push(doc);
  }

  const byId = new Map(used.map((doc) => [doc.id, doc] as const));
  const sources: MaterialSource[] = used.map((doc) => ({
    id: doc.id,
    kind: "lecture",
    title: displayTitle(doc),
    note: "上传资料（仅本浏览器，不随方向同步）",
  }));

  const outChunks: MaterialChunk[] = [];
  const seenChunks = new Set<string>();
  for (const chunk of chunks) {
    const doc = byId.get(chunk.docId);
    if (doc === undefined) continue;
    if (chunk.id.trim() === "" || seenChunks.has(chunk.id)) continue;

    const text = chunk.text.trim();
    if (text === "") continue;
    seenChunks.add(chunk.id);

    const pages = pairedPages(chunk.pageFrom, chunk.pageTo);
    const title = displayTitle(doc);
    const rawSection = chunk.section.trim();
    const section =
      rawSection !== ""
        ? rawSection
        : pages.pageFrom !== undefined
          ? `第${pages.pageFrom}页`
          : title;

    outChunks.push({
      id: chunk.id,
      sourceId: doc.id,
      kcIds: normalizeKcIds(doc.kcIds),
      chapter: UPLOAD_CHAPTER,
      section,
      ...pages,
      text,
    });
  }

  const directionIds = [...new Set(used.map((doc) => doc.directionId.trim()).filter((id) => id !== ""))];
  const id =
    directionIds.length === 0
      ? UPLOAD_PACK_ID
      : `${UPLOAD_PACK_ID}:${directionIds.join(",")}`;

  return { id, title: "上传资料", sources, chunks: outChunks, claims: [] };
}

// ── 检索 ──────────────────────────────────────────────────────────

function kbTitle(chunk: UploadChunk): string {
  const title = chunk.title.trim();
  if (title !== "") return title;
  const section = chunk.section.trim();
  return section !== "" ? section : chunk.id;
}

/**
 * 上传片段 → KbDocument。
 *
 * KbDocument.kcId 是 rag.ts 的必填检索键，这里用 chunk.id 填充；
 * 不要把 doc.kcIds 当检索键，一个 chunk 会绑定多个知识点。
 */
export function uploadsToKbDocuments(chunks: readonly UploadChunk[]): KbDocument[] {
  return chunks.map((chunk) => ({
    kcId: chunk.id,
    title: kbTitle(chunk),
    text: chunk.text,
  }));
}

export function buildUploadIndex(chunks: readonly UploadChunk[]): Bm25Index {
  return buildIndex(uploadsToKbDocuments(chunks));
}

/** 检索上传资料，再把 kcId（chunk.id）映射回原始片段。 */
export function retrieveUploads(
  index: Bm25Index,
  chunks: readonly UploadChunk[],
  query: string,
  k = 3,
): UploadHit[] {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk] as const));
  const hits: UploadHit[] = [];
  for (const doc of search(index, query, k)) {
    const chunk = byId.get(doc.kcId);
    if (chunk === undefined) continue;
    hits.push({ chunk, score: doc.score });
  }
  return hits;
}

/**
 * 上传资料的引用抬头，例如：
 *   [讲义·《数据结构讲义.pdf》·上传资料·第3页]
 *
 * 页码缺失时整段省略，md / txt 不会出现「第 0 页」或「第 undefined 页」。
 */
export function uploadCitationLabel(hit: UploadHit): string {
  const { chunk } = hit;
  const parts = [`讲义·《${kbTitle(chunk)}》`, UPLOAD_CHAPTER];
  const from = validPage(chunk.pageFrom);
  const to = validPage(chunk.pageTo);
  if (from !== undefined) {
    const end = to !== undefined ? Math.max(from, to) : from;
    parts.push(end === from ? `第${from}页` : `第${from}–${end}页`);
  }
  return `[${parts.join("·")}]`;
}

/** 注入导师提示词的上传资料块；没有命中时返回空串，调用方据此整块省略。 */
export function formatUploadContext(hits: readonly UploadHit[]): string {
  if (hits.length === 0) return "";

  const blocks = hits.map((hit, index) => {
    const label = uploadCitationLabel(hit);
    return `[资料${index + 1}] ${label}\n${hit.chunk.text.trim()}`;
  });

  return `【上传资料（仅本浏览器）｜引用时标注 [资料n]】\n${blocks.join("\n\n")}`;
}

/**
 * 从模型回复里解析实际用到的上传资料编号。
 *
 * 只接受 1..count：模型写出 [资料9] 但本次只注入了 3 条时，不能把它当成
 * 第 9 条来源展示，否则界面会出现一条不存在的引用。
 */
export function parseUploadCitations(text: string, count: number): Set<number> {
  const used = new Set<number>();
  if (count <= 0) return used;

  const limit = Math.floor(count);
  const pattern = /[[【]\s*资料\s*(\d+)\s*[\]】]/g;
  for (const match of text.matchAll(pattern)) {
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index) && index >= 1 && index <= limit) used.add(index);
  }
  return used;
}
