"use client";

/**
 * 账号级知识库同步：远端适配器 + 本地/远端复合存储。
 *
 * 并发策略（与 kbServer.ts 对齐）：
 * - 文档级 LWW + 前置 CAS：提交时带 baseUpdatedAt（本机新建为 null），
 *   服务端版本不一致直接 409，客户端把它翻译成 KbConflictError；
 * - 片段没有独立版本号，随文档整体替换，所以「改绑定」也是一次整单写入；
 * - 读时本地 + 远端按 id 求并集（远端优先），远端失败回退本地并留下 syncWarning；
 * - 首次登录按方向把「本地有、远端无」的文档回传一次，避免换设备前的上传丢失。
 *
 * 远端失败不抛异常（除 409 冲突）：远端只是副本，本地写入成功后上传仍算成功，
 * 但必须让界面看到「没同步」。只有本地写入失败才是真正的写入失败。
 */

import { getDefaultKbStorage } from "@/lib/kbLocal";
import { embeddingInput } from "@/lib/embedding";
import {
  LOCAL_EMBED_DIM,
  LOCAL_EMBED_MODEL,
  embedLocal,
  type EmbedLocalResult,
} from "@/lib/embedLocal";
import type { UploadChunk, UploadDoc } from "@/lib/knowledge";
import type { DirectionKb, KbStorage, KbStorageEstimate, KbWriteOptions } from "@/lib/kbStore";
// 只导入类型：vectorContracts 的 zod schema 不应进入客户端 chunk
import type { KbVectorItem } from "@/lib/vectorContracts";

// ── 常量与类型 ────────────────────────────────────────────────────

/** 向量分页大小；与 kbServer.KB_VECTOR_PAGE_MAX 一致。 */
export const KB_VECTOR_PAGE_LIMIT = 100;

/** 向量分页的硬上限，防御服务端游标不前进导致死循环。 */
const KB_VECTOR_MAX_PAGES = 1000;

/** 409 的统一文案。界面直接展示它，不再拼接服务端原文。 */
export const KB_CONFLICT_MESSAGE = "文档已在其他设备更新，请刷新后重试。";

/** 401 的统一文案：会话过期时仍然可以看本机资料。 */
export const KB_UNAUTHORIZED_WARNING = "登录已过期，知识库未同步：仅显示本机资料。";

/** 一条片段的向量。字段名与 /api/kb?vectors=1 的响应一致。 */
export interface KbVectorField {
  readonly id: string;
  readonly embedding: readonly number[];
  readonly embeddingModel: string;
  readonly embeddingDim: number;
}

/**
 * 本地向量同步状态。UI 直接展示，不需要知道 Worker / 批大小 / 路由细节：
 *   idle      还没触发
 *   loading   正在读远端已有的 chunkId
 *   embedding 本地模型正在算缺失向量
 *   uploading 正在分批 POST /api/kb/vectors
 *   ready     本方向已有的 + 新上传的向量都可用
 *   unavailable 任何一步失败；检索只用 BM25，文本功能不受影响
 */
export type KbVectorSyncStatus =
  | "idle"
  | "loading"
  | "embedding"
  | "uploading"
  | "ready"
  | "unavailable";

export interface KbVectorSyncState {
  readonly status: KbVectorSyncStatus;
  /** 已完成的条数（embedding 阶段为已算完，uploading 阶段为已上传）。 */
  readonly done: number;
  /** 本次需要处理的条数；loading 阶段为 0。 */
  readonly total: number;
  /** 降级原因或部分成功的说明；ready 且无异常时为 null。 */
  readonly message: string | null;
}

export const IDLE_VECTOR_SYNC: KbVectorSyncState = Object.freeze({
  status: "idle",
  done: 0,
  total: 0,
  message: null,
});

/** 可注入的本地嵌入函数；默认走 Worker，单测注入假实现。 */
export type KbEmbedFn = (
  texts: readonly string[],
  signal?: AbortSignal,
) => Promise<EmbedLocalResult>;

/** 与 vectorContracts.KB_VECTOR_BATCH_MAX 对齐；客户端不引 zod 契约层。 */
const VECTOR_UPLOAD_BATCH_MAX = 32;

/** 本地推理单批条数；比上传批更小，避免一次性占用过多内存。 */
const VECTOR_EMBED_BATCH_MAX = 16;

function vectorBatches(items: readonly KbVectorItem[]): KbVectorItem[][] {
  const out: KbVectorItem[][] = [];
  for (let start = 0; start < items.length; start += VECTOR_UPLOAD_BATCH_MAX) {
    out.push(items.slice(start, start + VECTOR_UPLOAD_BATCH_MAX));
  }
  return out;
}

export type KbFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RemoteKbStorageOptions {
  /** 覆盖 fetch；单测注入假实现，浏览器里缺省用全局 fetch。 */
  readonly fetchImpl?: KbFetch;
}

/** 远端适配器多出来的能力：整方向快照、向量读取/写入、可返回服务端版本的写入。 */
export interface KbRemoteStorage extends KbStorage {
  loadDirection(directionId: string): Promise<DirectionKb>;
  loadVectors(directionId: string): Promise<readonly KbVectorField[]>;
  /** 已写入 kb_chunk_vectors 的 chunkId；用于跳过重复本地嵌入。 */
  loadVectorChunkIds(directionId: string): Promise<readonly string[]>;
  /** 分批上传本地向量；一批 ≤32 条由调用方保证。 */
  putVectors(vectors: readonly KbVectorItem[]): Promise<void>;
  /** 与 putDocWithChunks 相同，但返回服务端回写的文档（updatedAt 是下一次 CAS 的基准）。 */
  putDoc(
    doc: UploadDoc,
    chunks: readonly UploadChunk[],
    baseUpdatedAt: number | null,
  ): Promise<UploadDoc>;
}

/** 复合存储多出来的能力：向量读取、本地嵌入同步与同步告警。 */
export interface KbSyncedStorage extends KbStorage {
  loadVectors(directionId: string): Promise<readonly KbVectorField[]>;
  /**
   * 读取远端已有 chunkId → 本地嵌入缺口 → 分批上传。
   * 永不抛异常：任何失败都变成 status="unavailable" 的状态对象。
   */
  syncVectors(directionId: string): Promise<KbVectorSyncState>;
  /** 当前方向最近一次的同步状态；没有触发过时是 idle。 */
  vectorSyncState(directionId: string): KbVectorSyncState;
  /** 订阅状态变化；返回取消函数。UI 用它显示 loading/embedding/uploading。 */
  onVectorSync(
    listener: (directionId: string, state: KbVectorSyncState) => void,
  ): () => void;
  /** 最近一次远端操作的失败说明；null 表示没有失败。 */
  syncWarning(): string | null;
}

// ── 错误 ──────────────────────────────────────────────────────────

/** 非 2xx 的远端响应。status 0 表示请求根本没发出去（离线 / DNS）。 */
export class KbRemoteError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "KbRemoteError";
    this.status = status;
  }
}

/** 409：服务端版本与 baseUpdatedAt 不一致，本地内容没有覆盖服务端。 */
export class KbConflictError extends Error {
  readonly code = "conflict";

  constructor(message: string = KB_CONFLICT_MESSAGE) {
    super(message);
    this.name = "KbConflictError";
  }
}

/**
 * 跨 bundle / 跨模块实例也能识别的冲突判定。
 * 只靠 instanceof 在重复打包时会漏判，name 是第二道保险。
 */
export function isKbConflictError(err: unknown): err is KbConflictError {
  return err instanceof KbConflictError || (err instanceof Error && err.name === "KbConflictError");
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function remoteWarning(err: unknown): string {
  if (err instanceof KbRemoteError && err.status === 401) return KB_UNAUTHORIZED_WARNING;
  if (err instanceof KbRemoteError && err.status === 0) {
    return "无法连接服务器，知识库未同步：仅显示本机资料。";
  }
  return `知识库同步失败：${messageOf(err)}。仅显示本机资料。`;
}

/** 从任意存储上读同步告警；本地存储没有这个方法，返回 null。 */
export function kbSyncWarningOf(storage: KbStorage | null): string | null {
  if (storage === null) return null;
  const read = (storage as { syncWarning?: unknown }).syncWarning;
  return typeof read === "function" ? (read as () => string | null).call(storage) : null;
}

/** 向量数组 → 按 chunk id 索引，检索侧按 chunk.id 直接取。 */
export function vectorsById(
  rows: readonly KbVectorField[],
): ReadonlyMap<string, KbVectorField> {
  return new Map(rows.map((row) => [row.id, row] as const));
}

// ── 响应解析 ──────────────────────────────────────────────────────

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function serverMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const error = (body as { error?: { message?: unknown } }).error;
  const message = error?.message;
  return typeof message === "string" && message.trim() !== "" ? message.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDocs(body: unknown): UploadDoc[] {
  if (!isRecord(body) || !Array.isArray(body.docs)) return [];
  return body.docs.filter(
    (doc): doc is UploadDoc => isRecord(doc) && typeof doc.id === "string",
  );
}

function parseChunks(body: unknown): UploadChunk[] {
  if (!isRecord(body) || !Array.isArray(body.chunks)) return [];
  return body.chunks.filter(
    (chunk): chunk is UploadChunk => isRecord(chunk) && typeof chunk.id === "string",
  );
}

function parseVectors(raw: unknown): KbVectorField[] {
  if (!Array.isArray(raw)) return [];
  const out: KbVectorField[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = item.id;
    const model = item.embeddingModel;
    const embedding = item.embedding;
    const dim = item.embeddingDim;
    if (typeof id !== "string" || id.trim() === "") continue;
    if (typeof model !== "string" || model.trim() === "") continue;
    if (!Array.isArray(embedding) || embedding.length === 0) continue;
    if (typeof dim !== "number" || !Number.isInteger(dim) || dim !== embedding.length) continue;
    if (!embedding.every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    out.push({ id, embedding, embeddingModel: model, embeddingDim: dim });
  }
  return out;
}

/** GET /api/kb/vectors 的 chunkIds；非字符串与空串直接丢弃。 */
function parseVectorChunkIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id !== "") ids.push(id);
  }
  return [...new Set(ids)];
}

// ── 远端适配器 ────────────────────────────────────────────────────

export function createRemoteKbStorage(options: RemoteKbStorageOptions = {}): KbRemoteStorage {
  // 每次调用都重新取全局 fetch：单测 stubGlobal 之后依然生效
  const doFetch: KbFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));

  async function request(
    url: string,
    init?: RequestInit,
    opts: { readonly notFoundIsNull?: boolean } = {},
  ): Promise<Response | null> {
    let res: Response;
    try {
      // 远端悬挂会让本机知识库一直 loading：所有请求都要有自己的超时
      const signal = init?.signal ?? AbortSignal.timeout(15_000);
      res = await doFetch(url, { ...init, signal });
    } catch (err) {
      throw new KbRemoteError(0, `无法连接服务器：${messageOf(err)}`);
    }
    if (opts.notFoundIsNull === true && res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    if (res.status === 409) {
      await res.body?.cancel().catch(() => undefined);
      throw new KbConflictError();
    }
    if (!res.ok) {
      const body = await readJson(res);
      throw new KbRemoteError(res.status, serverMessage(body, `知识库接口返回 ${res.status}`));
    }
    return res;
  }

  const inflight = new Map<string, Promise<DirectionKb>>();

  async function fetchDirection(directionId: string): Promise<DirectionKb> {
    const url = `/api/kb?directionId=${encodeURIComponent(directionId)}`;
    const res = await request(url, { cache: "no-store" });
    const body = await readJson(res as Response);
    return { docs: parseDocs(body), chunks: parseChunks(body) };
  }

  /**
   * 同一个方向的两个并发读（listDocs + listChunks）共享一次 GET；
   * 请求结束后立刻移除，后续 reload 一定拿到新数据。
   */
  function loadDirection(directionId: string): Promise<DirectionKb> {
    const existing = inflight.get(directionId);
    if (existing !== undefined) return existing;
    const promise = fetchDirection(directionId);
    inflight.set(directionId, promise);
    void promise
      .finally(() => {
        if (inflight.get(directionId) === promise) inflight.delete(directionId);
      })
      .catch(() => undefined);
    return promise;
  }

  async function putDoc(
    doc: UploadDoc,
    chunks: readonly UploadChunk[],
    baseUpdatedAt: number | null,
  ): Promise<UploadDoc> {
    const res = await request("/api/kb", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc, chunks, baseUpdatedAt }),
    });
    const body = await readJson(res as Response);
    if (isRecord(body) && isRecord(body.doc) && typeof body.doc.id === "string") {
      return body.doc as unknown as UploadDoc;
    }
    // 服务端契约保证返回 doc；兜底至少把版本号带回来，否则下一次 CAS 永远失败
    const updatedAt =
      isRecord(body) && typeof body.updatedAt === "number" ? body.updatedAt : doc.updatedAt;
    return updatedAt === undefined ? doc : { ...doc, updatedAt };
  }

  return {
    loadDirection,
    listDocs: async (directionId) => (await loadDirection(directionId)).docs,
    listChunks: async (directionId) => (await loadDirection(directionId)).chunks,

    async getDoc(docId) {
      const url = `/api/kb?docId=${encodeURIComponent(docId)}`;
      const res = await request(url, { cache: "no-store" }, { notFoundIsNull: true });
      if (res === null) return null;
      const body = await readJson(res);
      if (!isRecord(body) || !isRecord(body.doc) || typeof body.doc.id !== "string") return null;
      return body.doc as unknown as UploadDoc;
    },

    putDoc,

    async putDocWithChunks(doc, chunks, opts?: KbWriteOptions) {
      const base =
        opts?.baseUpdatedAt !== undefined ? opts.baseUpdatedAt : (doc.updatedAt ?? null);
      await putDoc(doc, chunks, base);
    },

    async removeDoc(docId) {
      const url = `/api/kb?docId=${encodeURIComponent(docId)}`;
      await request(url, { method: "DELETE" });
    },

    /** 游标分页：after 是上一页最后一条 chunk_id，next 为 null 时结束。 */
    async loadVectors(directionId) {
      const out: KbVectorField[] = [];
      let after: string | null = null;
      for (let page = 0; page < KB_VECTOR_MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          directionId,
          vectors: "1",
          limit: String(KB_VECTOR_PAGE_LIMIT),
        });
        if (after !== null) params.set("after", after);
        const res = await request(`/api/kb?${params.toString()}`, { cache: "no-store" });
        const body = await readJson(res as Response);
        const rows = parseVectors(isRecord(body) ? body.vectors : null);
        out.push(...rows);

        const next =
          isRecord(body) && typeof body.next === "string" && body.next !== "" ? body.next : null;
        if (next === null || next === after) break;
        after = next;
      }
      return out;
    },

    /** 已写入 pgvector 的 chunkId；方向过滤由服务端 JOIN kb_chunks 完成。 */
    async loadVectorChunkIds(directionId) {
      const params = new URLSearchParams({ directionId, model: LOCAL_EMBED_MODEL });
      const res = await request(`/api/kb/vectors?${params.toString()}`, { cache: "no-store" });
      const body = await readJson(res as Response);
      return parseVectorChunkIds(isRecord(body) ? body.chunkIds : null);
    },

    /** 一批 ≤32 条；这里不自行切分，调用方负责 vectorBatches。 */
    async putVectors(vectors) {
      await request("/api/kb/vectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: LOCAL_EMBED_MODEL, vectors }),
      });
    },
  };
}

// ── 本地 + 远端 ───────────────────────────────────────────────────

/** 待上传修改优先；其余按服务端版本比较，相同版本采用远端。 */
function mergeDocs(
  localDocs: readonly UploadDoc[],
  remoteDocs: readonly UploadDoc[],
): UploadDoc[] {
  const byId = new Map<string, UploadDoc>();
  for (const doc of localDocs) byId.set(doc.id, doc);
  for (const doc of remoteDocs) {
    const local = byId.get(doc.id);
    if (local?.pendingSync || (local?.updatedAt ?? 0) > (doc.updatedAt ?? 0)) continue;
    byId.set(doc.id, doc);
  }
  return [...byId.values()];
}

function mergeChunks(
  localChunks: readonly UploadChunk[],
  remoteChunks: readonly UploadChunk[],
  docs: readonly UploadDoc[],
  localDocs: readonly UploadDoc[],
): UploadChunk[] {
  // 按文档选择完整的一份片段，避免把新标题与旧正文、或新旧切块拼在一起。
  const localById = new Map(localDocs.map((doc) => [doc.id, doc]));
  const localIds = new Set(docs.filter((doc) => localById.get(doc.id) === doc).map((doc) => doc.id));
  const docIds = new Set(docs.map((doc) => doc.id));
  return [
    ...localChunks.filter((chunk) => localIds.has(chunk.docId)),
    ...remoteChunks.filter((chunk) => docIds.has(chunk.docId) && !localIds.has(chunk.docId)),
  ];
}

export interface SyncedKbStorageOptions {
  /** 覆盖本地嵌入实现；单测注入假函数，浏览器里缺省走 embedLocal。 */
  readonly embed?: KbEmbedFn;
}

export function createSyncedKbStorage(
  local: KbStorage,
  remote: KbRemoteStorage,
  options: SyncedKbStorageOptions = {},
): KbSyncedStorage {
  let warning: string | null = null;
  /** 已经完成首次回传的方向；同一会话不再重复推。 */
  const firstSynced = new Set<string>();
  const inflight = new Map<string, Promise<DirectionKb>>();
  /** 方向 → 最近一次本地向量同步状态。 */
  const vectorStates = new Map<string, KbVectorSyncState>();
  const vectorInflight = new Map<string, Promise<KbVectorSyncState>>();
  const vectorListeners = new Set<(directionId: string, state: KbVectorSyncState) => void>();
  const embed: KbEmbedFn = options.embed ?? ((texts, signal) => embedLocal(texts, signal));

  function markWarning(err: unknown): void {
    warning = remoteWarning(err);
  }

  function clearWarning(): void {
    warning = null;
  }

  function setVectorState(directionId: string, state: KbVectorSyncState): KbVectorSyncState {
    vectorStates.set(directionId, state);
    for (const listener of vectorListeners) {
      try {
        listener(directionId, state);
      } catch {
        // UI 订阅抛错不能影响同步本身
      }
    }
    return state;
  }

  function unavailable(directionId: string, message: string): KbVectorSyncState {
    return setVectorState(directionId, {
      status: "unavailable",
      done: 0,
      total: 0,
      message,
    });
  }

  async function syncVectorsInner(directionId: string): Promise<KbVectorSyncState> {
    setVectorState(directionId, { status: "loading", done: 0, total: 0, message: null });

    let chunks: readonly UploadChunk[];
    try {
      const snapshot = await loadDirection(directionId);
      chunks = snapshot.chunks.filter((chunk) => chunk.directionId === directionId);
    } catch (err) {
      return unavailable(directionId, `读取片段失败：${messageOf(err)}。检索退化为 BM25。`);
    }

    if (chunks.length === 0) {
      return setVectorState(directionId, { status: "ready", done: 0, total: 0, message: null });
    }

    let existingIds: readonly string[];
    try {
      existingIds = await remote.loadVectorChunkIds(directionId);
    } catch (err) {
      return unavailable(
        directionId,
        `读取已有向量失败：${messageOf(err)}。检索退化为 BM25。`,
      );
    }

    const existing = new Set(existingIds);
    const missing = chunks.filter((chunk) => !existing.has(chunk.id));
    if (missing.length === 0) {
      return setVectorState(directionId, {
        status: "ready",
        done: chunks.length,
        total: chunks.length,
        message: null,
      });
    }

    setVectorState(directionId, {
      status: "embedding",
      done: 0,
      total: missing.length,
      message: null,
    });

    const items: KbVectorItem[] = [];
    /*
     * 本地推理也要分批：一次把几千段塞给 pipeline 会吃满内存与超时。
     * 16 条一批是经验值；任何一批失败都整体降级为 unavailable，
     * 不把「一半向量已上传」伪装成 ready。
     */
    for (let start = 0; start < missing.length; start += VECTOR_EMBED_BATCH_MAX) {
      const batch = missing.slice(start, start + VECTOR_EMBED_BATCH_MAX);
      let result: EmbedLocalResult;
      try {
        result = await embed(
          batch.map((chunk) => embeddingInput({ title: chunk.title, text: chunk.text })),
        );
      } catch (err) {
        return unavailable(directionId, `本地嵌入失败：${messageOf(err)}。检索退化为 BM25。`);
      }

      if (!result.ok) {
        return unavailable(
          directionId,
          `${result.message}（${result.reason}）。检索退化为 BM25。`,
        );
      }

      for (let index = 0; index < batch.length; index += 1) {
        const vector = result.vectors[index];
        if (!Array.isArray(vector) || vector.length !== LOCAL_EMBED_DIM) continue;
        if (!vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
          continue;
        }
        items.push({ chunkId: batch[index].id, vec: [...vector] });
      }

      setVectorState(directionId, {
        status: "embedding",
        done: Math.min(missing.length, start + batch.length),
        total: missing.length,
        message: null,
      });
    }

    if (items.length === 0) {
      return unavailable(
        directionId,
        "本地模型没有返回可用的 512 维向量。检索退化为 BM25。",
      );
    }

    let uploaded = 0;
    setVectorState(directionId, {
      status: "uploading",
      done: 0,
      total: items.length,
      message: null,
    });

    try {
      for (const batch of vectorBatches(items)) {
        await remote.putVectors(batch);
        uploaded += batch.length;
        setVectorState(directionId, {
          status: "uploading",
          done: uploaded,
          total: items.length,
          message: null,
        });
      }
    } catch (err) {
      return unavailable(directionId, `上传向量失败：${messageOf(err)}。检索退化为 BM25。`);
    }

    const skipped = missing.length - items.length;
    return setVectorState(directionId, {
      status: "ready",
      done: uploaded,
      total: items.length,
      message: skipped > 0 ? `${skipped} 条向量维度异常，已跳过。` : null,
    });
  }

  /**
   * 触发一次本地向量同步。同一方向并发调用共享同一个 Promise；
   * 成功/失败都落在状态对象里，不向调用方抛异常。
   */
  function syncVectors(directionId: string): Promise<KbVectorSyncState> {
    const key = directionId.trim();
    if (key === "") return Promise.resolve(IDLE_VECTOR_SYNC);
    const running = vectorInflight.get(key);
    if (running !== undefined) return running;

    let promise: Promise<KbVectorSyncState>;
    promise = syncVectorsInner(key)
      .catch((err: unknown) =>
        unavailable(key, `向量同步异常：${messageOf(err)}。检索退化为 BM25。`),
      )
      .finally(() => {
        if (vectorInflight.get(key) === promise) vectorInflight.delete(key);
      });
    vectorInflight.set(key, promise);
    return promise;
  }

  function vectorSyncState(directionId: string): KbVectorSyncState {
    return vectorStates.get(directionId.trim()) ?? IDLE_VECTOR_SYNC;
  }

  function onVectorSync(
    listener: (directionId: string, state: KbVectorSyncState) => void,
  ): () => void {
    vectorListeners.add(listener);
    return () => {
      vectorListeners.delete(listener);
    };
  }

  /** 文档内容变化后，旧的 ready 状态不再作数；下一次读片段会重新算缺口。 */
  function invalidateVectorState(directionId: string): void {
    vectorStates.delete(directionId);
  }

  /**
   * 把「本地有、远端无」的文档推上去。
   *
   * 只在首次读到该方向时执行；409 说明别的标签页 / 设备已经推过，直接跳过。
   * 其它失败不标记完成，下次读取再试（网络恢复后不需要重新登录）。
   */
  async function pushLocalOnly(
    directionId: string,
    localDocs: readonly UploadDoc[],
    localChunks: readonly UploadChunk[],
    remoteDocs: readonly UploadDoc[],
  ): Promise<void> {
    const remoteById = new Map(remoteDocs.map((doc) => [doc.id, doc]));
    const missing = localDocs.filter((doc) => doc.pendingSync ||
      (!firstSynced.has(directionId) && !remoteById.has(doc.id)));
    let complete = true;

    for (const doc of missing) {
      const chunks = localChunks.filter((chunk) => chunk.docId === doc.id);
      if (chunks.length === 0) continue;
      const remoteDoc = remoteById.get(doc.id);
      if (remoteDoc && (remoteDoc.updatedAt ?? null) !== (doc.updatedAt ?? null)) {
        complete = false;
        markWarning(new KbConflictError());
        continue;
      }
      try {
        const saved = await remote.putDoc(doc, chunks, doc.updatedAt ?? null);
        // 本地补服务端版本号：之后改绑定才有正确的 CAS 基准
        try {
          await local.putDocWithChunks({ ...saved, pendingSync: false }, chunks);
        } catch {
          // 本地已有一份内容；版本号补写失败只影响下一次 CAS，读取时仍以远端为准
        }
      } catch (err) {
        if (isKbConflictError(err)) {
          if (doc.pendingSync) markWarning(err);
          continue;
        }
        complete = false;
        markWarning(err);
        break;
      }
    }

    if (complete) firstSynced.add(directionId);
  }

  async function loadDirectionInner(directionId: string): Promise<DirectionKb> {
    let [localDocs, localChunks] = await Promise.all([
      local.listDocs(directionId),
      local.listChunks(directionId),
    ]);

    let remoteDocs: readonly UploadDoc[] = [];
    let remoteChunks: readonly UploadChunk[] = [];
    let remoteReady = false;
    try {
      const snapshot = await remote.loadDirection(directionId);
      remoteDocs = snapshot.docs;
      remoteChunks = snapshot.chunks;
      remoteReady = true;
      clearWarning();
    } catch (err) {
      markWarning(err);
    }

    if (remoteReady) {
      // 网络请求期间可能发生本地编辑，重读后再合并。
      [localDocs, localChunks] = await Promise.all([
        local.listDocs(directionId), local.listChunks(directionId),
      ]);
      await pushLocalOnly(directionId, localDocs, localChunks, remoteDocs);
      [localDocs, localChunks] = await Promise.all([
        local.listDocs(directionId), local.listChunks(directionId),
      ]);
    }
    const docs = mergeDocs(localDocs, remoteDocs);
    return {
      docs,
      chunks: mergeChunks(localChunks, remoteChunks, docs, localDocs),
    };
  }

  /** listDocs / listChunks 并发时共享同一次加载，首同步也只跑一遍。 */
  function loadDirection(directionId: string): Promise<DirectionKb> {
    const existing = inflight.get(directionId);
    if (existing !== undefined) return existing;
    const promise = loadDirectionInner(directionId);
    inflight.set(directionId, promise);
    void promise
      .finally(() => {
        if (inflight.get(directionId) === promise) inflight.delete(directionId);
      })
      .catch(() => undefined);
    return promise;
  }

  const storage: KbSyncedStorage = {
    listDocs: async (directionId) => (await loadDirection(directionId)).docs,
    listChunks: async (directionId) => (await loadDirection(directionId)).chunks,

    async getDoc(docId) {
      const localDoc = await local.getDoc(docId);
      try {
        const doc = await remote.getDoc(docId);
        clearWarning();
        if (localDoc?.pendingSync) {
          warning = "这份资料有尚未同步的本地修改，已保留本地内容。";
          return localDoc;
        }
        if (doc !== null) return mergeDocs(localDoc ? [localDoc] : [], [doc])[0];
      } catch (err) {
        markWarning(err);
      }
      return localDoc;
    },

    async putDocWithChunks(doc, chunks, opts?: KbWriteOptions) {
      // 本地先写：本地失败必须让调用方看到（远端成功但本地失败等于没保存）
      await local.putDocWithChunks({ ...doc, pendingSync: true }, chunks);

      const base =
        opts?.baseUpdatedAt !== undefined ? opts.baseUpdatedAt : (doc.updatedAt ?? null);
      try {
        const saved = await remote.putDoc(doc, chunks, base);
        clearWarning();
        invalidateVectorState(doc.directionId);
        void syncVectors(doc.directionId);
        try {
          await local.putDocWithChunks({ ...saved, pendingSync: false }, chunks);
        } catch {
          // 本地已有内容；版本号回写失败不改变「已保存」的语义
        }
      } catch (err) {
        markWarning(err);
        if (isKbConflictError(err)) throw err;
      }
    },

    async removeDoc(docId) {
      await local.removeDoc(docId);
      try {
        await remote.removeDoc(docId);
        clearWarning();
      } catch (err) {
        // 远端删除失败：本机已删，但换设备仍会看到这份文档，必须显示告警
        markWarning(err);
      }
    },

    async loadVectors(directionId) {
      try {
        const rows = await remote.loadVectors(directionId);
        clearWarning();
        return rows;
      } catch (err) {
        markWarning(err);
        return [];
      }
    },

    syncVectors,
    vectorSyncState,
    onVectorSync,

    syncWarning: () => warning,
  };

  if (local.estimate !== undefined) {
    storage.estimate = (): Promise<KbStorageEstimate> => local.estimate!();
  }

  return storage;
}

// ── 存储解析器 ────────────────────────────────────────────────────

/** 每个账号一个复合存储：同步告警与首次回传状态都挂在实例上。 */
const syncedStorages = new Map<string, KbStorage>();
let storageGeneration = 0;

/** 换号后，旧实例的在途读写都失效，不能用新账号 cookie 回传旧内容。 */
function scopedStorage<T extends KbStorage>(storage: T, generation: number): T {
  const asyncMethods = new Set(["listDocs", "listChunks", "getDoc", "putDoc", "putDocWithChunks", "removeDoc", "estimate", "loadDirection", "loadVectors", "loadVectorChunkIds", "putVectors", "syncVectors"]);
  return new Proxy(storage, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof key !== "string" || !asyncMethods.has(key) || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        if (generation !== storageGeneration) throw new Error("账号已切换，已取消旧资料请求");
        const result: unknown = await Reflect.apply(value, target, args);
        if (generation !== storageGeneration) throw new Error("账号已切换，已丢弃旧资料结果");
        return result;
      };
    },
  });
}

/**
 * 全部知识库写入点的唯一入口。
 *
 * 未登录返回本机存储；已登录返回「本地 + 远端」复合存储（同一账号复用同一实例）。
 * 浏览器没有 IndexedDB 时退化为纯远端，而不是直接报错。
 */
export function getKbStorageForUser(userId?: string | null): KbStorage | null {
  const key = (userId ?? "").trim();
  if (key === "") return getDefaultKbStorage();

  const existing = syncedStorages.get(key);
  if (existing !== undefined) return existing;

  const localStorage = getDefaultKbStorage();
  const local = localStorage ? scopedStorage(localStorage, storageGeneration) : null;
  const remote = scopedStorage(createRemoteKbStorage(), storageGeneration);
  const storage: KbStorage = scopedStorage(local === null ? remote : createSyncedKbStorage(local, remote), storageGeneration);
  syncedStorages.set(key, storage);
  return storage;
}

/** 单测专用：清空账号实例缓存。 */
export function __resetKbStorageCacheForTests(): void {
  storageGeneration += 1;
  syncedStorages.clear();
}

/**
 * 账号切换时丢弃实例缓存。
 *
 * 实例里带着 firstSynced：同一个账号重新登录若复用旧实例，登出期间新增的本地文档
 * 不会被补推到服务器，也不会有任何 syncWarning。
 */
export function resetKbStorageCache(): void {
  storageGeneration += 1;
  syncedStorages.clear();
}
