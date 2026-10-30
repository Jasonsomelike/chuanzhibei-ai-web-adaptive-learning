/**
 * 浏览器本地嵌入：bge-small-zh-v1.5（q8，512 维）跑在 Web Worker 里。
 *
 * 边界与降级：
 * - 模型与 transformers.js 都在 public/embed/、public/models/，通过 Worker 内的
 *   动态 import 按需加载；本模块不 import 模型包，因此不会进 Next 的服务端/路由 chunk。
 * - 首次调用才创建 Worker；Worker 不存在（Node、老浏览器、被 CSP 拦截）时返回
 *   { ok:false, vectors:null, reason:"unsupported" }，调用方据此退回 BM25。
 * - 任何失败都不抛异常：超时、模型文件缺失、输出维度不对都变成带 reason 的失败对象。
 * - 查询侧加 BGE 中文指令；文档侧不加。指令在这里拼，Worker 只负责推理。
 *
 * 返回值刻意用 `vectors: null + reason` 而不是裸 null：降级原因要能显示在
 * 知识库状态里，单独的 null 无法区分「没 Worker」「模型没下载」「推理超时」。
 */

/** BGE 中文查询指令（BAAI 模型卡）。文档侧绝不能加。 */
export const BGE_QUERY_INSTRUCTION = "为这个句子生成表示以用于检索相关文章：";

/** 本地模型在 kb_chunk_vectors.model 里的标识。 */
export const LOCAL_EMBED_MODEL = "bge-small-zh-v1.5-q8";
export const LOCAL_EMBED_DIM = 512;

/**
 * 本文件不复用 vectorContracts 的 zod schema：那会把整个 zod 契约层
 * 拖进 /tutor 客户端 chunk。模型名/维度必须与 vectorContracts 保持一致，
 * vectorContracts.test.ts 有一条常量对齐断言兜底。
 */
function localVectorProblem(vector: unknown, dim = LOCAL_EMBED_DIM): string | null {
  if (!Array.isArray(vector)) return "向量必须是数组。";
  if (vector.length !== dim) return `向量维度必须是 ${dim}（收到 ${vector.length}）。`;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `向量第 ${index + 1} 个分量不是有限数。`;
    }
  }
  const norm = Math.hypot(...(vector as number[]));
  if (!Number.isFinite(norm) || norm <= 0) return "向量范数为 0。";
  return null;
}

export type EmbedLocalFailureReason =
  | "unsupported"
  | "worker-error"
  | "timeout"
  | "aborted"
  | "invalid-output"
  | "model-missing";

export interface EmbedLocalSuccess {
  readonly ok: true;
  readonly vectors: readonly (readonly number[])[];
  readonly reason: null;
  readonly message: null;
}

export interface EmbedLocalFailure {
  readonly ok: false;
  /** 失败时向量恒为 null；原因在 reason / message。 */
  readonly vectors: null;
  readonly reason: EmbedLocalFailureReason;
  readonly message: string;
}

export type EmbedLocalResult = EmbedLocalSuccess | EmbedLocalFailure;

/** Worker 的最小接口；单测可以注入假 Worker，不需要真实模型。 */
export interface EmbedWorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface EmbedLocalOptions {
  /** 单次请求超时；首次加载模型可能较慢，默认 120s。 */
  readonly timeoutMs?: number;
  /** 覆盖 Worker 工厂（单测注入）；浏览器里缺省用 new Worker(new URL(...))。 */
  readonly workerFactory?: () => EmbedWorkerLike;
}

const DEFAULT_TIMEOUT_MS = 120_000;

interface PendingRequest {
  readonly resolve: (result: EmbedLocalResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly onAbort: (() => void) | null;
  readonly signal: AbortSignal | undefined;
  /** 本请求期望的向量条数；响应条数不符按 invalid-output 处理。 */
  readonly count: number;
}

let sharedWorker: EmbedWorkerLike | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return String(err);
}

function failure(reason: EmbedLocalFailureReason, message: string): EmbedLocalFailure {
  return { ok: false, vectors: null, reason, message };
}

function success(vectors: readonly (readonly number[])[]): EmbedLocalSuccess {
  return { ok: true, vectors, reason: null, message: null };
}

function createBrowserWorker(): EmbedWorkerLike {
  const worker = new Worker(new URL("../workers/embed.worker.ts", import.meta.url), {
    type: "module",
    name: "alp-embed",
  });
  return worker as unknown as EmbedWorkerLike;
}

function settle(id: number, result: EmbedLocalResult): void {
  const request = pending.get(id);
  if (request === undefined) return;
  pending.delete(id);
  clearTimeout(request.timer);
  if (request.signal !== undefined && request.onAbort !== null) {
    request.signal.removeEventListener("abort", request.onAbort);
  }
  request.resolve(result);
}

function expectedCount(id: number): number {
  return pending.get(id)?.count ?? 1;
}

function failAll(reason: EmbedLocalFailureReason, message: string): void {
  for (const id of [...pending.keys()]) settle(id, failure(reason, message));
}

function dropWorker(worker: EmbedWorkerLike): void {
  if (sharedWorker === worker) sharedWorker = null;
  try {
    worker.terminate();
  } catch {
    // 已经退出或实现不支持 terminate；不影响降级
  }
}

function handleMessage(worker: EmbedWorkerLike, raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;
  const data = raw as {
    id?: unknown;
    ok?: unknown;
    vectors?: unknown;
    reason?: unknown;
    message?: unknown;
  };
  if (typeof data.id !== "number" || !Number.isInteger(data.id)) return;

  if (data.ok === true) {
    const vectors = validateVectors(data.vectors, expectedCount(data.id));
    if (vectors === null) {
      settle(
        data.id,
        failure("invalid-output", `本地模型输出的向量不是 ${LOCAL_EMBED_DIM} 维有限值。`),
      );
    } else {
      settle(data.id, success(vectors));
    }
    return;
  }

  const reason = data.reason;
  const allowed: readonly EmbedLocalFailureReason[] = [
    "unsupported",
    "worker-error",
    "timeout",
    "aborted",
    "invalid-output",
    "model-missing",
  ];
  const selected = allowed.includes(reason as EmbedLocalFailureReason)
    ? (reason as EmbedLocalFailureReason)
    : "worker-error";
  const message =
    typeof data.message === "string" && data.message.trim() !== ""
      ? data.message.trim()
      : "本地嵌入失败。";

  if (selected === "model-missing") {
    // 模型没下载时所有在途请求都会失败：终止 Worker 并一起返回，避免各自等超时
    dropWorker(worker);
    failAll(selected, message);
    return;
  }
  settle(data.id, failure(selected, message));
}

function validateVectors(raw: unknown, count: number): number[][] | null {
  if (!Array.isArray(raw) || raw.length !== count) return null;
  const out: number[][] = [];
  for (const item of raw) {
    const problem = localVectorProblem(item, LOCAL_EMBED_DIM);
    if (problem !== null) return null;
    out.push([...(item as number[])]);
  }
  return out;
}

function attachWorker(worker: EmbedWorkerLike): void {
  worker.onmessage = (event) => handleMessage(worker, event.data);
  worker.onerror = (event) => {
    const message = messageOf(event);
    dropWorker(worker);
    failAll("worker-error", `本地嵌入 Worker 出错：${message}`);
  };
}

function workerFor(options: EmbedLocalOptions): EmbedWorkerLike | null {
  if (sharedWorker !== null) return sharedWorker;
  const factory = options.workerFactory;
  if (factory === undefined && typeof Worker === "undefined") return null;
  try {
    const worker = (factory ?? createBrowserWorker)();
    attachWorker(worker);
    sharedWorker = worker;
    return worker;
  } catch {
    return null;
  }
}

function requestVectors(
  texts: readonly string[],
  kind: "doc" | "query",
  signal: AbortSignal | undefined,
  options: EmbedLocalOptions,
): Promise<EmbedLocalResult> {
  if (texts.length === 0) return Promise.resolve(success([]));
  if (signal?.aborted === true) return Promise.resolve(failure("aborted", "本地嵌入已取消。"));

  const worker = workerFor(options);
  if (worker === null) {
    return Promise.resolve(
      failure(
        "unsupported",
        "当前环境不支持 Web Worker，无法运行本地嵌入；检索退化为 BM25。",
      ),
    );
  }

  const id = nextRequestId;
  nextRequestId += 1;
  const inputs = kind === "query"
    ? texts.map((text) => `${BGE_QUERY_INSTRUCTION}${text}`)
    : [...texts];
  const timeoutMs =
    options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.floor(options.timeoutMs)
      : DEFAULT_TIMEOUT_MS;

  return new Promise<EmbedLocalResult>((resolve) => {
    const onAbort = (): void => {
      settle(id, failure("aborted", "本地嵌入已取消。"));
    };
    const timer = setTimeout(() => {
      dropWorker(worker);
      // Worker 被终止后同一实例上的其它请求也不会再有响应：一起失败，避免各自等超时
      failAll(
        "timeout",
        `本地嵌入超过 ${Math.round(timeoutMs / 1000)} 秒未完成；检索退化为 BM25。`,
      );
    }, timeoutMs);

    pending.set(id, {
      resolve,
      timer,
      onAbort: signal === undefined ? null : onAbort,
      signal,
      count: texts.length,
    });
    if (signal !== undefined) signal.addEventListener("abort", onAbort, { once: true });

    try {
      worker.postMessage({ id, texts: inputs });
    } catch (err) {
      dropWorker(worker);
      settle(id, failure("worker-error", `无法向本地嵌入 Worker 发送请求：${messageOf(err)}`));
    }
  });
}

/** 文档侧嵌入：不加 BGE 查询指令。 */
export function embedLocal(
  texts: readonly string[],
  signal?: AbortSignal,
  options: EmbedLocalOptions = {},
): Promise<EmbedLocalResult> {
  return requestVectors(texts, "doc", signal, options);
}

/** 查询侧嵌入：逐条加 BGE 中文指令。 */
export function embedLocalQuery(
  text: string,
  signal?: AbortSignal,
  options: EmbedLocalOptions = {},
): Promise<EmbedLocalResult> {
  return requestVectors([text], "query", signal, options);
}

/** 单测专用：清掉共享 Worker 与挂起请求，避免用例之间互相影响。 */
export function __resetEmbedLocalForTests(): void {
  if (sharedWorker !== null) {
    try {
      sharedWorker.terminate();
    } catch {
      // 忽略
    }
  }
  sharedWorker = null;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    if (request.signal !== undefined && request.onAbort !== null) {
      request.signal.removeEventListener("abort", request.onAbort);
    }
  }
  pending.clear();
  nextRequestId = 1;
}
