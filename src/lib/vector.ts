/**
 * 向量检索的最小算子集合。
 *
 * 边界：
 * - 纯函数：不取嵌入、不读写存储、不碰网络；向量从哪来由调用方决定。
 * - 无效向量一律「拒绝」而不是当成 0 分。NaN / Infinity / 零范数 / 维度不符
 *   若参与排序，会静默挤进前 k 条结果，界面上看不出来，只能靠这里挡。
 * - 输出顺序必须确定：同分按 id 升序，换一次 Map 遍历顺序结果也不变。
 */

export interface VectorHit {
  readonly id: string;
  readonly score: number;
}

/** 求范数。调用前必须保证分量有限；这里不做校验，避免热路径重复扫描。 */
function vectorLength(vector: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const value = vector[i];
    sum += value * value;
  }
  return Math.sqrt(sum);
}

function allFinite(vector: Float32Array): boolean {
  for (let i = 0; i < vector.length; i += 1) {
    if (!Number.isFinite(vector[i])) return false;
  }
  return true;
}

/**
 * 向量是否可用：非空、分量全为有限值、范数有限且大于 0。
 * 传 dim 时还要求长度完全相等——宁可这一条不参与检索，
 * 也不把 1024 维与 1536 维混进同一个索引。
 */
export function isValidVector(value: unknown, dim?: number): value is Float32Array {
  if (!(value instanceof Float32Array)) return false;
  if (value.length === 0) return false;
  if (dim !== undefined && value.length !== dim) return false;
  if (!allFinite(value)) return false;
  const norm = vectorLength(value);
  return Number.isFinite(norm) && norm > 0;
}

/**
 * 单位化。返回新数组，不修改入参；无效输入返回 null。
 *
 * 零范数无法单位化（结果会是一串 NaN），必须显式拒绝。
 */
export function normalizeVector(vector: Float32Array, dim?: number): Float32Array | null {
  if (!isValidVector(vector, dim)) return null;
  const norm = vectorLength(vector);
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    out[i] = vector[i] / norm;
  }
  return out;
}

/**
 * 点积。维度不同、含非有限分量或结果溢出时返回 null。
 *
 * 结果用 null 而不是 NaN 表示失败：调用方必须显式处理，
 * 不能把「算不出来」当成 0 分混进排序。
 */
export function dot(a: Float32Array, b: Float32Array): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    sum += x * y;
  }
  return Number.isFinite(sum) ? sum : null;
}

/**
 * 余弦相似度，范围 [-1, 1]。无效向量、维度不符返回 null。
 *
 * 入参不需要预先单位化；预单位化只是省一次范数，不影响结果。
 * 浮点误差可能让结果略超 ±1，夹紧后相同方向的两条向量稳定得到 1。
 */
export function cosine(a: Float32Array, b: Float32Array): number | null {
  if (!isValidVector(a) || !isValidVector(b)) return null;
  if (a.length !== b.length) return null;

  const product = dot(a, b);
  if (product === null) return null;

  const denominator = vectorLength(a) * vectorLength(b);
  if (!Number.isFinite(denominator) || denominator <= 0) return null;

  const score = product / denominator;
  if (!Number.isFinite(score)) return null;
  return Math.min(1, Math.max(-1, score));
}

/**
 * 从 id → 向量 的索引里取余弦分数最高的 k 条。
 *
 * - 低于 minScore 的条目直接丢弃，不做「凑满 k 条」的兜底；
 * - 无效向量、维度与 query 不符的条目跳过，不当作 0 分；
 * - 同分按 id 升序，避免同分时顺序随 Map 插入顺序漂移。
 */
export function topKNormalized(
  query: Float32Array,
  vectors: ReadonlyMap<string, Float32Array>,
  k: number,
  minScore: number,
): VectorHit[] {
  if (!Number.isFinite(k)) return [];
  const limit = Math.max(0, Math.floor(k));
  if (limit === 0 || !isValidVector(query)) return [];

  const hits: VectorHit[] = [];
  for (const [id, vector] of vectors) {
    if (id === "" || vector.length !== query.length) continue;
    const score = cosine(query, vector);
    if (score === null || !(score >= minScore)) continue;
    hits.push({ id, score });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return hits.slice(0, limit);
}
