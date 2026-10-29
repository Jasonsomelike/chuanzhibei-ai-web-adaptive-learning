"use client";

/**
 * 每个方向的上传知识库：IndexedDB 持久化、容量预算与 React 订阅。
 *
 * 数据的形状与切块都在 knowledge.ts（纯函数）；这里只负责存取。
 * 落库的是抽取后的正文与片段，不保存原始 PDF / 文件：20MB 的上传不会占库，
 * 也避免版权原文件留在浏览器里。上传资料只在本浏览器可见，不随方向同步。
 *
 * 写入必须是一次事务：docs 与 chunks 要么全部进库，要么一条都不进。
 * 事务外先把所有行准备好，事务内不 await——IndexedDB 事务在事件循环让出后会失效。
 * 因此 KbStorage 的实现（尤其是 IndexedDB）必须自己保证 putDocWithChunks 的原子性，
 * 上层 importDocument 只负责校验、容量与错误翻译。
 */

import { useCallback, useEffect, useState } from "react";

import {
  MAX_DIRECTION_CHARS,
  MAX_DIRECTION_CHUNKS,
  type ImportResult,
  type UploadChunk,
  type UploadDoc,
} from "@/lib/knowledge";

// ── 存储契约 ──────────────────────────────────────────────────────

export const KB_DB_NAME = "alp-kb-v1";
export const KB_DOC_STORE = "docs";
export const KB_CHUNK_STORE = "chunks";

/** 浏览器容量预算：只用到配额的 80%，给 localStorage / 缓存留余量。 */
export const KB_STORAGE_BUDGET_RATIO = 0.8;

export interface KbStorageEstimate {
  readonly usage?: number;
  readonly quota?: number;
}

/**
 * 可注入的存储适配器。
 *
 * putDocWithChunks 必须是原子的：IndexedDB 实现用一个 readwrite 事务；
 * 内存实现用快照回滚。上层依赖这个契约，失败时相信「一条都没写」。
 */
export interface KbStorage {
  listDocs(directionId: string): Promise<readonly UploadDoc[]>;
  listChunks(directionId: string): Promise<readonly UploadChunk[]>;
  getDoc(docId: string): Promise<UploadDoc | null>;
  putDocWithChunks(doc: UploadDoc, chunks: readonly UploadChunk[]): Promise<void>;
  /** 删除文档并级联删除它的 chunks。 */
  removeDoc(docId: string): Promise<void>;
  /** 可选：浏览器不支持 StorageManager 时不提供，容量预算按「未知」跳过。 */
  estimate?(): Promise<KbStorageEstimate>;
}

export interface DirectionKb {
  readonly docs: readonly UploadDoc[];
  readonly chunks: readonly UploadChunk[];
}

export interface DirectionCapacity {
  readonly usedChunks: number;
  readonly usedChars: number;
  readonly remainingChunks: number;
  readonly remainingChars: number;
  readonly maxChunks: number;
  readonly maxChars: number;
}

export type DeleteDocResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

export type UpdateDocResult =
  | { readonly ok: true; readonly doc: UploadDoc }
  | { readonly ok: false; readonly error: string };

// ── 容量与预算（纯函数） ──────────────────────────────────────────

export function directionCapacity(docs: readonly UploadDoc[]): DirectionCapacity {
  let usedChunks = 0;
  let usedChars = 0;
  for (const doc of docs) {
    usedChunks += doc.chunkCount;
    usedChars += doc.charCount;
  }
  return {
    usedChunks,
    usedChars,
    remainingChunks: Math.max(0, MAX_DIRECTION_CHUNKS - usedChunks),
    remainingChars: Math.max(0, MAX_DIRECTION_CHARS - usedChars),
    maxChunks: MAX_DIRECTION_CHUNKS,
    maxChars: MAX_DIRECTION_CHARS,
  };
}

/**
 * 导入前整体检查方向容量。
 *
 * 装不下就整体拒绝，绝不导入半份：界面不会出现「看起来成功了、其实只进了一半」。
 * 文案给出剩余量与本次需要量，用户知道该删哪份或怎么拆。
 */
export function checkDirectionCapacity(
  docs: readonly UploadDoc[],
  doc: UploadDoc,
  chunkCount: number,
): string | null {
  const capacity = directionCapacity(docs);
  const problems: string[] = [];

  if (chunkCount > capacity.remainingChunks) {
    problems.push(
      `本方向剩余 ${capacity.remainingChunks} 段，这份文件需要 ${chunkCount} 段（上限 ${capacity.maxChunks} 段）`,
    );
  }
  if (doc.charCount > capacity.remainingChars) {
    problems.push(
      `本方向剩余 ${capacity.remainingChars} 字，这份文件需要 ${doc.charCount} 字（上限 ${capacity.maxChars} 字）`,
    );
  }

  if (problems.length === 0) return null;
  return `本方向容量不足：${problems.join("；")}。未写入任何内容，请删除部分上传资料或拆分文件后重试。`;
}

/**
 * 估算一份导入会占多少字节。
 *
 * IndexedDB 的字符串按 UTF-16 存储，JSON 里的中文与转义序列都按 2 字节/码元估，
 * 宁可高估一点，也不要等事务写到一半才撞配额。
 */
export function estimateImportBytes(
  doc: UploadDoc,
  chunks: readonly UploadChunk[],
): number {
  return JSON.stringify({ doc, chunks }).length * 2;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unit]}`;
}

/** 容量预算的纯函数判定；quota 未知时跳过，交给 IndexedDB 的 QuotaExceededError 兜底。 */
export function checkStorageBudget(
  estimate: KbStorageEstimate | null | undefined,
  addBytes: number,
): string | null {
  const quota = estimate?.quota;
  if (quota === undefined || !Number.isFinite(quota) || quota <= 0) return null;

  const usage = estimate?.usage ?? 0;
  const limit = Math.floor(quota * KB_STORAGE_BUDGET_RATIO);
  if (usage + addBytes <= limit) return null;

  return `浏览器可用存储不足：本次约需 ${formatBytes(addBytes)}，已用 ${formatBytes(usage)}，预算上限约 ${formatBytes(limit)}（配额的 80%）。未写入任何内容，请删除部分上传资料后重试。`;
}

// ── 导入 / 删除 / 读取 ───────────────────────────────────────────

function failure(error: string): ImportResult {
  return { ok: false, error, written: 0 };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isQuotaError(err: unknown): boolean {
  return (
    typeof DOMException !== "undefined" &&
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

/**
 * 校验行本身是否自洽。
 *
 * 字数不要求等于 chunk 正文之和：相邻块有 50 字重叠，求和必然大于 charCount。
 * chunkCount 则必须严格相等，否则界面会显示一个对不上的段数。
 */
function validateImportRows(doc: UploadDoc, chunks: readonly UploadChunk[]): string | null {
  if (doc.id.trim() === "") return "文档 id 为空，未写入任何内容。";
  if (doc.directionId.trim() === "") return "文档没有所属方向，未写入任何内容。";
  if (chunks.length === 0) return "这份文件没有可导入的正文，未写入任何内容。";
  if (doc.charCount <= 0) return "这份文件没有可导入的正文，未写入任何内容。";
  if (doc.chunkCount !== chunks.length) {
    return `文档记录的段数（${doc.chunkCount}）与实际片段数（${chunks.length}）不一致，未写入任何内容。`;
  }

  const ids = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.id.trim() === "") return "片段 id 为空，未写入任何内容。";
    if (ids.has(chunk.id)) return `片段 id 重复（${chunk.id}），未写入任何内容。`;
    if (chunk.docId !== doc.id) return "片段的 docId 与文档不一致，未写入任何内容。";
    if (chunk.directionId !== doc.directionId) return "片段的方向与文档不一致，未写入任何内容。";
    if (chunk.text.trim() === "") return "存在空片段，未写入任何内容。";
    if (!Number.isInteger(chunk.index) || chunk.index < 0) {
      return "片段序号无效，未写入任何内容。";
    }
    ids.add(chunk.id);
  }
  return null;
}

/**
 * 导入一份文档及其全部片段。
 *
 * 顺序：行校验 → 查重 → 方向容量 → 浏览器配额 → 单事务写入。
 * 任何一步失败都返回 written: 0，并且不会留下 docs / chunks 的任何一行。
 */
export async function importDocument(
  storage: KbStorage,
  doc: UploadDoc,
  chunks: readonly UploadChunk[],
): Promise<ImportResult> {
  const rowError = validateImportRows(doc, chunks);
  if (rowError !== null) return failure(rowError);

  let existing: UploadDoc | null;
  try {
    existing = await storage.getDoc(doc.id);
  } catch (err) {
    return failure(`读取知识库失败：${messageOf(err)}。未写入任何内容。`);
  }
  if (existing !== null) {
    return failure(
      existing.directionId === doc.directionId
        ? `文档「${doc.title.trim() !== "" ? doc.title : doc.fileName}」已经导入过，未重复写入。`
        : "文档 id 已被其它方向占用，请重新生成 id 后再试；未写入任何内容。",
    );
  }

  let existingDocs: readonly UploadDoc[];
  try {
    existingDocs = await storage.listDocs(doc.directionId);
  } catch (err) {
    return failure(`读取知识库失败：${messageOf(err)}。未写入任何内容。`);
  }

  const capacityError = checkDirectionCapacity(existingDocs, doc, chunks.length);
  if (capacityError !== null) return failure(capacityError);

  const addBytes = estimateImportBytes(doc, chunks);
  if (storage.estimate !== undefined) {
    let estimate: KbStorageEstimate | null = null;
    try {
      estimate = await storage.estimate();
    } catch {
      // 预算查询失败不阻塞导入；真正的配额错误由写入事务兜底
      estimate = null;
    }
    const budgetError = checkStorageBudget(estimate, addBytes);
    if (budgetError !== null) return failure(budgetError);
  }

  try {
    await storage.putDocWithChunks(doc, chunks);
  } catch (err) {
    if (isQuotaError(err)) {
      return failure(
        `浏览器存储空间不足：已导入 0/${chunks.length} 段，未写入任何内容。请删除部分上传资料后重试。`,
      );
    }
    return failure(
      `写入知识库失败：${messageOf(err)}。已导入 0/${chunks.length} 段，未写入任何内容。`,
    );
  }

  return { ok: true, doc, chunks: [...chunks] };
}

/** 删除一份文档；chunks 由适配器在同一事务里级联删除。 */
export async function deleteDocument(storage: KbStorage, docId: string): Promise<DeleteDocResult> {
  if (docId.trim() === "") return { ok: false, error: "文档 id 为空，未删除任何内容。" };
  try {
    await storage.removeDoc(docId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `删除文档失败：${messageOf(err)}` };
  }
}

function normalizeKcIds(kcIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of kcIds) {
    const id = raw.trim();
    if (id === "" || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/**
 * 只更新文档的知识点绑定，保留原有片段。
 *
 * 绑定变更必须走一次事务，否则删掉再重建的中间态会让导师检索短暂丢资料。
 * 这里用 putDocWithChunks 重写同一份 chunks，IndexedDB 实现天然是原子的。
 */
export async function updateDocKcIds(
  storage: KbStorage,
  docId: string,
  kcIds: readonly string[],
): Promise<UpdateDocResult> {
  let doc: UploadDoc | null;
  try {
    doc = await storage.getDoc(docId);
  } catch (err) {
    return { ok: false, error: `读取文档失败：${messageOf(err)}` };
  }
  if (doc === null) return { ok: false, error: "文档不存在或已被删除。" };

  const next = normalizeKcIds(kcIds);
  if (next.length === doc.kcIds.length && next.every((id, i) => id === doc.kcIds[i])) {
    return { ok: true, doc };
  }

  let chunks: readonly UploadChunk[];
  try {
    chunks = (await storage.listChunks(doc.directionId)).filter((chunk) => chunk.docId === docId);
  } catch (err) {
    return { ok: false, error: `读取片段失败：${messageOf(err)}` };
  }

  const updated: UploadDoc = { ...doc, kcIds: next };
  try {
    await storage.putDocWithChunks(updated, chunks);
  } catch (err) {
    return { ok: false, error: `保存绑定失败：${messageOf(err)}` };
  }
  return { ok: true, doc: updated };
}

/**
 * 读取一个方向的全部文档与片段。
 *
 * chunks 按文档顺序、片段序号排序；孤儿片段（doc 已不存在）直接丢弃，
 * 避免界面显示一条指向不存在来源的引用。
 */
export async function loadDirectionKb(storage: KbStorage, directionId: string): Promise<DirectionKb> {
  const [rawDocs, rawChunks] = await Promise.all([
    storage.listDocs(directionId),
    storage.listChunks(directionId),
  ]);

  const docs = [...rawDocs]
    .filter((doc) => doc.directionId === directionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const order = new Map(docs.map((doc, index) => [doc.id, index] as const));
  const chunks = [...rawChunks]
    .filter((chunk) => chunk.directionId === directionId && order.has(chunk.docId))
    .sort((a, b) => {
      const docOrder = (order.get(a.docId) ?? 0) - (order.get(b.docId) ?? 0);
      return docOrder !== 0 ? docOrder : a.index - b.index || a.id.localeCompare(b.id);
    });

  return { docs, chunks };
}

// ── IndexedDB 适配器 ─────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前环境不支持 IndexedDB"));
  }
  if (dbPromise !== null) return dbPromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(KB_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KB_DOC_STORE)) {
        const docs = db.createObjectStore(KB_DOC_STORE, { keyPath: "id" });
        docs.createIndex("directionId", "directionId", { unique: false });
      }
      if (!db.objectStoreNames.contains(KB_CHUNK_STORE)) {
        const chunks = db.createObjectStore(KB_CHUNK_STORE, { keyPath: "id" });
        chunks.createIndex("directionId", "directionId", { unique: false });
        chunks.createIndex("docId", "docId", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // 另一个标签页升级数据库时主动让路，否则会一直 blocked
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("无法打开 IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB 被其它标签页占用，请关闭其它页面后重试"));
  });

  dbPromise = opening;
  // 失败后不要缓存 rejected promise，下一次操作还能重试
  opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  return opening;
}

function readAll<T>(storeName: string, indexName: string, key: string): Promise<T[]> {
  return openDatabase().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).index(indexName).getAll(key);
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error ?? new Error("读取 IndexedDB 失败"));
        transaction.onabort = () => reject(transaction.error ?? new Error("读取 IndexedDB 被中止"));
      }),
  );
}

function getDocRow(docId: string): Promise<UploadDoc | null> {
  return openDatabase().then(
    (db) =>
      new Promise<UploadDoc | null>((resolve, reject) => {
        const transaction = db.transaction(KB_DOC_STORE, "readonly");
        const request = transaction.objectStore(KB_DOC_STORE).get(docId);
        request.onsuccess = () => resolve((request.result as UploadDoc | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error("读取 IndexedDB 失败"));
        transaction.onabort = () => reject(transaction.error ?? new Error("读取 IndexedDB 被中止"));
      }),
  );
}

async function putRows(doc: UploadDoc, chunks: readonly UploadChunk[]): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([KB_DOC_STORE, KB_CHUNK_STORE], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("写入 IndexedDB 失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("写入 IndexedDB 被回滚"));

    try {
      transaction.objectStore(KB_DOC_STORE).put(doc);
      const chunkStore = transaction.objectStore(KB_CHUNK_STORE);
      // 事务内不 await：所有 put 同步排进同一个事务，失败由事务整体回滚
      for (const chunk of chunks) chunkStore.put(chunk);
    } catch (err) {
      transaction.abort();
      reject(err);
    }
  });
}

async function removeRows(docId: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([KB_DOC_STORE, KB_CHUNK_STORE], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("删除 IndexedDB 失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("删除 IndexedDB 被回滚"));

    const chunkStore = transaction.objectStore(KB_CHUNK_STORE);
    const keys = chunkStore.index("docId").getAllKeys(docId);
    keys.onsuccess = () => {
      for (const key of keys.result) chunkStore.delete(key);
      transaction.objectStore(KB_DOC_STORE).delete(docId);
    };
    keys.onerror = () => {
      transaction.abort();
      reject(keys.error ?? new Error("读取待删除片段失败"));
    };
  });
}

export function createIndexedDbStorage(): KbStorage {
  return {
    listDocs: (directionId) => readAll<UploadDoc>(KB_DOC_STORE, "directionId", directionId),
    listChunks: (directionId) => readAll<UploadChunk>(KB_CHUNK_STORE, "directionId", directionId),
    getDoc: getDocRow,
    putDocWithChunks: putRows,
    removeDoc: removeRows,
    async estimate(): Promise<KbStorageEstimate> {
      if (typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function") {
        return {};
      }
      try {
        const { usage, quota } = await navigator.storage.estimate();
        return { usage, quota };
      } catch {
        return {};
      }
    },
  };
}

/** 当前浏览器可用的存储；Node / SSR 返回 null，调用方据此显示「不支持」。 */
export function getDefaultKbStorage(): KbStorage | null {
  if (typeof indexedDB === "undefined") return null;
  return createIndexedDbStorage();
}

// ── React hook ───────────────────────────────────────────────────

export interface KnowledgeBaseState {
  readonly docs: readonly UploadDoc[];
  readonly chunks: readonly UploadChunk[];
  readonly loading: boolean;
  readonly error: string | null;
  /** 导入 / 删除 / 绑定变更后调用，重新读取当前方向。 */
  readonly reload: () => void;
}

/**
 * 读取某个方向的知识库。
 *
 * 首屏先给空数组再在 effect 里读 IndexedDB：服务端渲染没有 indexedDB，
 * 直接在 render 里读会造成 hydration 不一致。
 * 页面把 docs / chunks 交给纯函数 uploadsToPack(docs, chunks)，hook 本身不做切块或检索。
 */
export function useKnowledgeBase(directionId: string): KnowledgeBaseState {
  const [docs, setDocs] = useState<readonly UploadDoc[]>([]);
  const [chunks, setChunks] = useState<readonly UploadChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let alive = true;

    if (directionId.trim() === "") {
      setDocs([]);
      setChunks([]);
      setError(null);
      setLoading(false);
      return () => {
        alive = false;
      };
    }

    const storage = getDefaultKbStorage();
    if (storage === null) {
      setDocs([]);
      setChunks([]);
      setError("当前浏览器不支持 IndexedDB，上传资料无法保存。");
      setLoading(false);
      return () => {
        alive = false;
      };
    }

    setLoading(true);
    setError(null);

    loadDirectionKb(storage, directionId).then(
      (result) => {
        if (!alive) return;
        setDocs(result.docs);
        setChunks(result.chunks);
        setLoading(false);
      },
      (err: unknown) => {
        if (!alive) return;
        setDocs([]);
        setChunks([]);
        setError(`读取本地知识库失败：${messageOf(err)}`);
        setLoading(false);
      },
    );

    return () => {
      alive = false;
    };
  }, [directionId, version]);

  return { docs, chunks, loading, error, reload };
}
