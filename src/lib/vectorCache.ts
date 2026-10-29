/**
 * 上传片段的向量缓存。
 *
 * 边界：
 * - 只负责「哪些片段已经有向量、缺的怎么补、补完写哪儿」；
 *   向量怎么算由调用方注入（embed），存储由 VectorStore 适配。
 * - 缓存的键是 `${model}:${fnv1a(text)}`：同一段正文在不同模型下的向量
 *   不可互换，模型必须进键；正文用散列而不是原文，避免把整份资料再存一遍。
 * - 维度以每个模型的 meta 记录为准。模型名相同但实际维度变了（换供应商）
 *   时，旧向量会被忽略并重新嵌入，不会把两种维度混进同一个索引。
 * - 缓存读写失败只影响缓存命中率：读写异常一律吞掉，检索照常退回「重新嵌入」。
 */

import { fnv1a } from "@/lib/embedding";
import type { EmbeddingResult } from "@/lib/embeddingClient";
import { isValidVector } from "@/lib/vector";

export const VECTOR_DB_NAME = "alp-vectors-v1";
export const VECTOR_STORE_NAME = "vectors";

/** 一次请求的片段数。与 /api/llm/embeddings 的 64 上限相比留了余量。 */
export const VECTOR_BATCH_SIZE = 32;

export interface VectorDoc {
  /** 片段 id（UploadChunk.id）。 */
  readonly id: string;
  /** 被嵌入的正文；必须与检索时使用的一致。 */
  readonly text: string;
}

/** 批量嵌入一小组文本；返回 null 表示这次没有向量（未配置 / 上游失败）。 */
export type EmbedBatch = (texts: readonly string[]) => Promise<EmbeddingResult | null>;

/** 向量存取的唯一契约。IndexedDB 与内存实现都必须满足。 */
export interface VectorStore {
  get(key: string): Promise<Float32Array | null>;
  set(key: string, vector: Float32Array): Promise<void>;
  delete(key: string): Promise<void>;
  /** 删除某个前缀下的全部键；clearVectorCache 只按模型前缀调用。 */
  deletePrefix(prefix: string): Promise<void>;
}

export function vectorCacheKey(model: string, text: string): string {
  return `${model}:${fnv1a(text)}`;
}

/** 每个模型的维度记录。写成一个单元素 Float32Array，复用同一套存取接口。 */
function dimensionKey(model: string): string {
  return `${model}:dim`;
}

function toVector(numbers: readonly number[] | undefined, dim: number): Float32Array | null {
  if (numbers === undefined || numbers.length !== dim) return null;
  for (const value of numbers) {
    if (!Number.isFinite(value)) return null;
  }
  const vector = Float32Array.from(numbers);
  return isValidVector(vector, dim) ? vector : null;
}

async function readStore(store: VectorStore, key: string): Promise<Float32Array | null> {
  try {
    return await store.get(key);
  } catch {
    return null;
  }
}

async function writeStore(store: VectorStore, key: string, vector: Float32Array): Promise<void> {
  try {
    await store.set(key, vector);
  } catch {
    // 写不进去只影响下次是否重算
  }
}

async function deleteStore(store: VectorStore, key: string): Promise<void> {
  try {
    await store.delete(key);
  } catch {
    // ignore
  }
}

/** 读模型维度记录；没有或形状不对返回 null。 */
async function readDimension(store: VectorStore, model: string): Promise<number | null> {
  const raw = await readStore(store, dimensionKey(model));
  if (raw === null || raw.length !== 1) return null;
  const dim = Math.trunc(raw[0]);
  return Number.isFinite(dim) && dim > 0 ? dim : null;
}

function dedupeDocs(docs: readonly VectorDoc[]): VectorDoc[] {
  const out: VectorDoc[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    const id = doc.id.trim();
    if (id === "" || seen.has(id) || doc.text.trim() === "") continue;
    seen.add(id);
    out.push({ id: doc.id, text: doc.text });
  }
  return out;
}

/**
 * 保证每个片段都有向量：先读缓存，缺失按 32 条一批嵌入并写回。
 *
 * 返回 id → 向量的映射（可能只覆盖一部分：某些批次失败时，那批片段没有向量，
 * 检索会自然退化为 BM25）。model 为空或没有任何片段时返回空表。
 */
export async function ensureVectors(
  docs: readonly VectorDoc[],
  model: string,
  embed: EmbedBatch,
  store: VectorStore,
): Promise<ReadonlyMap<string, Float32Array>> {
  const modelId = model.trim();
  const result = new Map<string, Float32Array>();
  if (modelId === "") return result;

  const unique = dedupeDocs(docs);
  if (unique.length === 0) return result;

  const byId = new Map(unique.map((doc) => [doc.id, doc] as const));
  let dim = await readDimension(store, modelId);

  // 1. 读缓存。维度已知时，长度不符的条目直接当未命中并删除，避免长期占着键。
  const cached = new Map<string, Float32Array>();
  const pending: VectorDoc[] = [];
  for (const doc of unique) {
    const key = vectorCacheKey(modelId, doc.text);
    const hit = await readStore(store, key);
    if (hit !== null && isValidVector(hit) && (dim === null || hit.length === dim)) {
      cached.set(doc.id, hit);
      continue;
    }
    if (hit !== null) await deleteStore(store, key);
    pending.push(doc);
  }

  const embedInto = async (targets: readonly VectorDoc[]): Promise<void> => {
    for (let start = 0; start < targets.length; start += VECTOR_BATCH_SIZE) {
      const batch = targets.slice(start, start + VECTOR_BATCH_SIZE);
      if (batch.length === 0) continue;

      const embedded = await embed(batch.map((doc) => doc.text));
      if (embedded === null) continue;

      const embeddedModel = embedded.model.trim();
      // 模型名对不上时整批丢弃：不同模型的向量没有可比性
      if (embeddedModel !== "" && embeddedModel !== modelId) continue;
      if (!Number.isFinite(embedded.dim) || embedded.dim <= 0) continue;

      if (dim === null) {
        dim = embedded.dim;
        await writeStore(store, dimensionKey(modelId), Float32Array.of(dim));
      }
      if (embedded.dim !== dim) continue;

      for (let i = 0; i < batch.length; i += 1) {
        const doc = batch[i];
        const vector = toVector(embedded.vectors[i], dim);
        if (vector === null) continue;
        result.set(doc.id, vector);
        await writeStore(store, vectorCacheKey(modelId, doc.text), vector);
      }
    }
  };

  await embedInto(pending);

  // 2. 本次嵌入揭示了维度：缓存里与它不符的忽略并补一轮。
  const mismatched: VectorDoc[] = [];
  for (const [id, vector] of cached) {
    if (dim !== null && vector.length !== dim) {
      const doc = byId.get(id);
      if (doc !== undefined) mismatched.push(doc);
      continue;
    }
    result.set(id, vector);
  }
  if (mismatched.length > 0) await embedInto(mismatched);

  return result;
}

/**
 * 清掉某个模型的全部缓存（含维度记录）。
 * 只按 `${model}:` 前缀删除，不会碰其它模型——否则换模型一次就把全部资料重算一遍。
 */
export async function clearVectorCache(model: string, store: VectorStore): Promise<void> {
  const modelId = model.trim();
  if (modelId === "") return; // 空模型不能当成「全部」
  try {
    await store.deletePrefix(`${modelId}:`);
  } catch {
    // 清缓存失败不阻塞调用方
  }
}

// ── 内存实现（测试与 SSR 兜底） ──────────────────────────────────

export function createMemoryVectorStore(
  initial?: Iterable<readonly [string, Float32Array]>,
): VectorStore {
  const map = new Map<string, Float32Array>();
  if (initial !== undefined) {
    for (const [key, vector] of initial) map.set(key, Float32Array.from(vector));
  }
  return {
    async get(key) {
      const hit = map.get(key);
      return hit === undefined ? null : Float32Array.from(hit);
    },
    async set(key, vector) {
      map.set(key, Float32Array.from(vector));
    },
    async delete(key) {
      map.delete(key);
    },
    async deletePrefix(prefix) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(prefix)) map.delete(key);
      }
    },
  };
}

// ── IndexedDB 实现 ──────────────────────────────────────────────

const databases = new Map<string, Promise<IDBDatabase>>();

function openVectorDatabase(name: string): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前环境不支持 IndexedDB"));
  }
  const existing = databases.get(name);
  if (existing !== undefined) return existing;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VECTOR_STORE_NAME)) {
        // 行形状 { key, vector }；key 是 `${model}:${hash}` 或 `${model}:dim`
        db.createObjectStore(VECTOR_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databases.delete(name);
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("无法打开向量缓存"));
    request.onblocked = () => reject(new Error("向量缓存被其它标签页占用，请关闭其它页面后重试"));
  });

  databases.set(name, opening);
  // 失败不缓存 rejected promise，下次还能重试
  opening.catch(() => {
    if (databases.get(name) === opening) databases.delete(name);
  });
  return opening;
}

function withStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(VECTOR_STORE_NAME, mode);
    const request = run(transaction.objectStore(VECTOR_STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("向量缓存操作失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("向量缓存事务被中止"));
  });
}

export function createIndexedDbVectorStore(dbName = VECTOR_DB_NAME): VectorStore {
  return {
    async get(key) {
      const db = await openVectorDatabase(dbName);
      const row = await withStore<{ key?: unknown; vector?: unknown } | undefined>(
        db,
        "readonly",
        (store) => store.get(key),
      );
      return row !== undefined && row.vector instanceof Float32Array ? row.vector : null;
    },
    async set(key, vector) {
      const db = await openVectorDatabase(dbName);
      await withStore(db, "readwrite", (store) =>
        store.put({ key, vector: Float32Array.from(vector) }),
      );
    },
    async delete(key) {
      const db = await openVectorDatabase(dbName);
      await withStore(db, "readwrite", (store) => store.delete(key));
    },
    async deletePrefix(prefix) {
      const db = await openVectorDatabase(dbName);
      // 字符串键的前缀范围：prefix ≤ key < prefix + \uffff。主键就是 key 字段。
      const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, true);
      const keys = await withStore<IDBValidKey[]>(db, "readonly", (store) =>
        store.getAllKeys(range),
      );
      if (keys.length === 0) return;
      const transaction = db.transaction(VECTOR_STORE_NAME, "readwrite");
      const store = transaction.objectStore(VECTOR_STORE_NAME);
      for (const key of keys) store.delete(key);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("删除向量缓存失败"));
        transaction.onabort = () => reject(transaction.error ?? new Error("删除向量缓存被回滚"));
      });
    },
  };
}

/** 浏览器里用 IndexedDB，Node / SSR 返回 null，调用方自行选内存实现。 */
export function getDefaultVectorStore(): VectorStore | null {
  if (typeof indexedDB === "undefined") return null;
  return createIndexedDbVectorStore();
}
