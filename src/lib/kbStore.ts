"use client";

/**
 * 每个方向的上传知识库：存储契约、容量预算与 React 订阅。
 *
 * 数据的形状与切块都在 knowledge.ts（纯函数）；这里只负责校验、预算与状态。
 * 落库的是抽取后的正文与片段，不保存原始 PDF / 文件：20MB 的上传不会占库，
 * 也避免版权原文件留在浏览器里。未登录时只在本浏览器可见；登录后经
 * kbRemote.ts 的复合存储同步到账号（本地仍是主副本，远端失败只告警）。
 *
 * 写入必须是一次事务：docs 与 chunks 要么全部进库，要么一条都不进。
 * 事务外先把所有行准备好，事务内不 await——IndexedDB 事务在事件循环让出后会失效。
 * 因此 KbStorage 的实现（尤其是 IndexedDB）必须自己保证 putDocWithChunks 的原子性，
 * 上层 importDocument 只负责校验、容量与错误翻译。
 *
 * IndexedDB 适配器在 kbLocal.ts；账号同步在 kbRemote.ts。这里重新导出它们，
 * 既有 import { getDefaultKbStorage } from "@/lib/kbStore" 的调用点无需改动。
 */

import { useCallback, useEffect, useReducer, useState } from "react";

import {
  MAX_DIRECTION_CHARS,
  MAX_DIRECTION_CHUNKS,
  type ImportResult,
  type UploadChunk,
  type UploadDoc,
} from "@/lib/knowledge";
import {
  IDLE_VECTOR_SYNC,
  getKbStorageForUser,
  isKbConflictError,
  kbSyncWarningOf,
  vectorsById,
  type KbVectorField,
  type KbVectorSyncState,
} from "@/lib/kbRemote";

// ── 存储契约 ──────────────────────────────────────────────────────

export {
  KB_CHUNK_STORE,
  KB_DB_NAME,
  KB_DOC_STORE,
  clearKbDatabase,
  closeKbDb,
  createIndexedDbStorage,
  getDefaultKbStorage,
  openDatabase,
} from "@/lib/kbLocal";

export {
  KbConflictError,
  KB_CONFLICT_MESSAGE,
  __resetKbStorageCacheForTests,
  getKbStorageForUser,
  isKbConflictError,
  kbSyncWarningOf,
} from "@/lib/kbRemote";
export type { KbSyncedStorage, KbVectorField } from "@/lib/kbRemote";

/** 浏览器容量预算：只用到配额的 80%，给 localStorage / 缓存留余量。 */
export const KB_STORAGE_BUDGET_RATIO = 0.8;

export interface KbStorageEstimate {
  readonly usage?: number;
  readonly quota?: number;
}

/**
 * 写入选项。
 *
 * baseUpdatedAt 是远端 CAS 的前置条件：undefined 表示按 doc.updatedAt 推导，
 * null 表示本机新建（服务端应不存在同名文档）。本地存储忽略这个字段。
 */
export interface KbWriteOptions {
  readonly baseUpdatedAt?: number | null;
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
  putDocWithChunks(
    doc: UploadDoc,
    chunks: readonly UploadChunk[],
    opts?: KbWriteOptions,
  ): Promise<void>;
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
    /*
     * 409 不是「没写入」：本地已经落库，只是远端版本更新。
     * 不能报「已导入 0/N 段」，否则用户会以为可以原样重试。
     */
    if (isKbConflictError(err)) return failure(messageOf(err));
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
    // 冲突时本地片段没变，界面只需提示刷新；不把技术细节拼进文案
    if (isKbConflictError(err)) return { ok: false, error: messageOf(err) };
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

// ── 视图状态（纯函数，可在没有渲染器的 Node 单测里断言） ──────────

export interface KnowledgeBaseState {
  readonly docs: readonly UploadDoc[];
  readonly chunks: readonly UploadChunk[];
  readonly loading: boolean;
  readonly error: string | null;
  /** 最近一次远端同步失败的说明；本机模式下恒为 null。 */
  readonly syncWarning: string | null;
  /** chunk.id → 向量；调用过 ensureVectors 且存储支持向量时才非空。 */
  readonly vectors: ReadonlyMap<string, KbVectorField>;
  readonly vectorsLoading: boolean;
  /** 本地向量同步（读已有 → 本地嵌入 → 分批上传）的实时状态。 */
  readonly vectorSync: KbVectorSyncState;
  /** 首次需要向量时调用；重复调用不会重复请求。 */
  readonly ensureVectors: () => void;
  /** 导入 / 删除 / 绑定变更后调用，重新读取当前方向。 */
  readonly reload: () => void;
}

export interface KbViewState {
  readonly docs: readonly UploadDoc[];
  readonly chunks: readonly UploadChunk[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly syncWarning: string | null;
  readonly vectors: ReadonlyMap<string, KbVectorField>;
  readonly vectorsLoading: boolean;
  readonly vectorSync: KbVectorSyncState;
}

export type KbViewAction =
  | { readonly type: "reset" }
  | { readonly type: "loading" }
  | {
      readonly type: "loaded";
      readonly docs: readonly UploadDoc[];
      readonly chunks: readonly UploadChunk[];
      readonly syncWarning: string | null;
    }
  | { readonly type: "failed"; readonly error: string; readonly syncWarning: string | null }
  | { readonly type: "vectorsLoading" }
  | {
      readonly type: "vectorsLoaded";
      readonly vectors: ReadonlyMap<string, KbVectorField>;
      readonly syncWarning: string | null;
    }
  | { readonly type: "vectorsFailed"; readonly syncWarning: string | null }
  | { readonly type: "vectorSync"; readonly state: KbVectorSyncState };

const EMPTY_VECTORS: ReadonlyMap<string, KbVectorField> = new Map();

export function initialKbViewState(): KbViewState {
  return {
    docs: [],
    chunks: [],
    loading: true,
    error: null,
    syncWarning: null,
    vectors: EMPTY_VECTORS,
    vectorsLoading: false,
    vectorSync: IDLE_VECTOR_SYNC,
  };
}

/**
 * 知识库视图状态机。
 *
 * reset 是方向 / 账号切换的唯一入口：它一次性清空上一个方向的 docs、chunks 与向量，
 * 并进入 loading。旧实现只置 loading，读到新方向前界面会短暂显示上一个方向的资料。
 */
export function kbViewReducer(state: KbViewState, action: KbViewAction): KbViewState {
  switch (action.type) {
    case "reset":
      return { ...initialKbViewState(), loading: true };
    case "loading":
      return { ...state, loading: true, error: null };
    case "loaded":
      return {
        ...state,
        loading: false,
        error: null,
        docs: action.docs,
        chunks: action.chunks,
        syncWarning: action.syncWarning,
      };
    case "failed":
      return {
        ...state,
        loading: false,
        docs: [],
        chunks: [],
        error: action.error,
        syncWarning: action.syncWarning,
      };
    case "vectorsLoading":
      return { ...state, vectorsLoading: true };
    case "vectorsLoaded":
      return {
        ...state,
        vectorsLoading: false,
        vectors: action.vectors,
        syncWarning: action.syncWarning,
      };
    case "vectorsFailed":
      return { ...state, vectorsLoading: false, syncWarning: action.syncWarning };
    case "vectorSync":
      return { ...state, vectorSync: action.state };
  }
}

/**
 * 读取某个方向的知识库。
 *
 * 首屏先给空数组再在 effect 里读 IndexedDB / 远端：服务端渲染没有 indexedDB，
 * 直接在 render 里读会造成 hydration 不一致。
 * 存储由 getKbStorageForUser(userId) 统一解析：未登录只有本机，登录后本地 + 账号。
 * 页面把 docs / chunks 交给纯函数 uploadsToPack(docs, chunks)，hook 本身不做切块或检索。
 */
export function useKnowledgeBase(
  directionId: string,
  userId?: string | null,
): KnowledgeBaseState {
  const [view, dispatch] = useReducer(kbViewReducer, undefined, initialKbViewState);
  const [version, setVersion] = useState(0);
  const [vectorsWanted, setVectorsWanted] = useState(0);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const ensureVectors = useCallback(() => {
    setVectorsWanted((value) => (value === 0 ? 1 : value));
  }, []);

  // 方向 / 账号变化：先清空旧视图再进入 loading
  useEffect(() => {
    dispatch({ type: "reset" });
    setVectorsWanted(0);
  }, [directionId, userId]);

  // 订阅本地向量同步状态：loading / embedding / uploading / ready / unavailable
  useEffect(() => {
    const direction = directionId.trim();
    if (direction === "") return;
    const storage = getKbStorageForUser(userId);
    if (storage === null) return;
    const subscribe = (storage as { onVectorSync?: unknown }).onVectorSync;
    if (typeof subscribe !== "function") return;

    const unsubscribe = (
      subscribe as (
        listener: (id: string, state: KbVectorSyncState) => void,
      ) => () => void
    ).call(storage, (id, state) => {
      if (id === direction) dispatch({ type: "vectorSync", state });
    });

    // 订阅前同步已经在跑（例如换回一个已完成的方向）：先补一次当前状态
    const read = (storage as { vectorSyncState?: unknown }).vectorSyncState;
    if (typeof read === "function") {
      dispatch({
        type: "vectorSync",
        state: (read as (id: string) => KbVectorSyncState).call(storage, direction),
      });
    }

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [directionId, userId]);

  useEffect(() => {
    let alive = true;
    const direction = directionId.trim();

    if (direction === "") {
      dispatch({ type: "loaded", docs: [], chunks: [], syncWarning: null });
      return () => {
        alive = false;
      };
    }

    const storage = getKbStorageForUser(userId);
    if (storage === null) {
      dispatch({
        type: "failed",
        error: "当前浏览器不支持 IndexedDB，上传资料无法保存。",
        syncWarning: null,
      });
      return () => {
        alive = false;
      };
    }

    dispatch({ type: "loading" });

    loadDirectionKb(storage, direction).then(
      (result) => {
        if (!alive) return;
        dispatch({
          type: "loaded",
          docs: result.docs,
          chunks: result.chunks,
          syncWarning: kbSyncWarningOf(storage),
        });
      },
      (err: unknown) => {
        if (!alive) return;
        dispatch({
          type: "failed",
          error: `读取知识库失败：${messageOf(err)}`,
          syncWarning: kbSyncWarningOf(storage),
        });
      },
    );

    return () => {
      alive = false;
    };
  }, [directionId, userId, version]);

  useEffect(() => {
    if (vectorsWanted === 0) return;
    let alive = true;
    const direction = directionId.trim();
    if (direction === "") {
      return () => {
        alive = false;
      };
    }

    const storage = getKbStorageForUser(userId);
    if (storage === null) {
      return () => {
        alive = false;
      };
    }

    /*
     * 先触发本地向量同步（读远端已有 chunkId → 本地嵌入缺口 → 分批上传）。
     * 它不阻塞下面对已有 TEXT 向量的读取；失败只改状态，不影响 BM25。
     */
    const syncer = (storage as { syncVectors?: unknown }).syncVectors;
    if (typeof syncer === "function") {
      void (syncer as (id: string) => Promise<KbVectorSyncState>).call(storage, direction);
    }

    const loader = (storage as { loadVectors?: unknown }).loadVectors;
    if (typeof loader !== "function") {
      // 未登录 / 本地存储没有向量：给空表，检索自然退化为 BM25
      dispatch({
        type: "vectorsLoaded",
        vectors: EMPTY_VECTORS,
        syncWarning: kbSyncWarningOf(storage),
      });
      return () => {
        alive = false;
      };
    }

    dispatch({ type: "vectorsLoading" });
    (loader as (id: string) => Promise<readonly KbVectorField[]>).call(storage, direction).then(
      (rows) => {
        if (!alive) return;
        dispatch({
          type: "vectorsLoaded",
          vectors: vectorsById(rows),
          syncWarning: kbSyncWarningOf(storage),
        });
      },
      (err: unknown) => {
        if (!alive) return;
        dispatch({
          type: "vectorsFailed",
          syncWarning:
            kbSyncWarningOf(storage) ?? `读取向量失败：${messageOf(err)}。检索退化为 BM25。`,
        });
      },
    );

    return () => {
      alive = false;
    };
  }, [directionId, userId, version, vectorsWanted]);

  return {
    docs: view.docs,
    chunks: view.chunks,
    loading: view.loading,
    error: view.error,
    syncWarning: view.syncWarning,
    vectors: view.vectors,
    vectorsLoading: view.vectorsLoading,
    vectorSync: view.vectorSync,
    ensureVectors,
    reload,
  };
}
