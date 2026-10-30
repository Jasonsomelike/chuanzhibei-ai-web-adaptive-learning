/**
 * 本地嵌入 Worker：按需加载 public/embed/transformers.web.min.js 与
 * public/models/bge-small-zh-v1.5/，用 bge-small-zh-v1.5（q8，512 维）做
 * mean pooling + L2 normalize。
 *
 * 为什么在 Worker 里动态 import public 下的文件：
 * - transformers.js 与 onnxruntime wasm 约 22MB、模型约 24MB，打进 Next 的
 *   路由 chunk 会直接撑爆 /tutor 的 11KB 余量；放在 public 且只在首次嵌入时
 *   加载，首屏与不需要语义检索的会话完全不付这份成本。
 * - `webpackIgnore` / `turbopackIgnore` 阻止打包器把绝对 URL 解析成模块。
 *
 * 失败分类：
 * - 加载 transformation 运行时失败 → worker-error；
 * - 加载模型（config/tokenizer/onnx）失败 → model-missing；
 * - 推理或输出校验失败 → worker-error / invalid-output。
 * 所有分支都回消息，绝不抛出未捕获异常（否则 Worker 直接死掉，主线程只能等超时）。
 */

const MODEL_ID = "bge-small-zh-v1.5";
const DIM = 512;

interface EmbedRequest {
  readonly id: number;
  readonly texts: readonly string[];
}

interface ExtractorOutput {
  tolist(): number[][];
}

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<ExtractorOutput>;

interface TransformersModule {
  env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    localModelPath: string;
    backends?: { onnx?: { wasm?: { wasmPaths?: string } } };
  };
  pipeline(
    task: "feature-extraction",
    model: string,
    options: { dtype: "q8"; device: "wasm" },
  ): Promise<Extractor>;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<EmbedRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;

let extractorPromise: Promise<Extractor> | null = null;

/** 返回字符串而不是字面量，避免打包器把 public 资源当成可解析模块。 */
function transformersUrl(): string {
  return "/embed/transformers.web.min.js";
}

async function loadExtractor(): Promise<Extractor> {
  if (extractorPromise !== null) return extractorPromise;

  extractorPromise = (async () => {
    const mod = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ transformersUrl()
    )) as TransformersModule;

    mod.env.allowRemoteModels = false;
    mod.env.allowLocalModels = true;
    mod.env.localModelPath = "/models/";
    const wasm = mod.env.backends?.onnx?.wasm;
    if (wasm !== undefined) wasm.wasmPaths = "/embed/";

    return mod.pipeline("feature-extraction", MODEL_ID, { dtype: "q8", device: "wasm" });
  })();

  try {
    return await extractorPromise;
  } catch (err) {
    // 下次请求允许重试（例如用户刚跑完 fetch-model）
    extractorPromise = null;
    throw err;
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function badVectors(vectors: unknown, count: number): string | null {
  if (!Array.isArray(vectors) || vectors.length !== count) {
    return `期望 ${count} 条向量，实际 ${Array.isArray(vectors) ? vectors.length : "非数组"}`;
  }
  for (let i = 0; i < vectors.length; i += 1) {
    const vector = vectors[i];
    if (!Array.isArray(vector) || vector.length !== DIM) {
      return `第 ${i + 1} 条向量不是 ${DIM} 维`;
    }
    for (const value of vector) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `第 ${i + 1} 条向量包含非有限值`;
      }
    }
  }
  return null;
}

async function handle(request: EmbedRequest): Promise<void> {
  const texts = Array.isArray(request.texts)
    ? request.texts.filter((text): text is string => typeof text === "string")
    : [];
  if (texts.length === 0 || texts.length !== request.texts.length) {
    scope.postMessage({
      id: request.id,
      ok: false,
      reason: "invalid-output",
      message: "本地嵌入输入为空或包含非字符串。",
    });
    return;
  }

  let extractor: Extractor;
  try {
    extractor = await loadExtractor();
  } catch (err) {
    scope.postMessage({
      id: request.id,
      ok: false,
      reason: "model-missing",
      message: `本地模型或推理库加载失败：${messageOf(err)}`,
    });
    return;
  }

  try {
    const output = await extractor([...texts], { pooling: "mean", normalize: true });
    const vectors = output.tolist();
    const problem = badVectors(vectors, texts.length);
    if (problem !== null) {
      scope.postMessage({
        id: request.id,
        ok: false,
        reason: "invalid-output",
        message: `本地模型输出不可用：${problem}`,
      });
      return;
    }
    scope.postMessage({ id: request.id, ok: true, vectors });
  } catch (err) {
    scope.postMessage({
      id: request.id,
      ok: false,
      reason: "worker-error",
      message: `本地推理解析失败：${messageOf(err)}`,
    });
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (typeof request !== "object" || request === null || !Number.isInteger(request.id)) return;
  void handle(request);
};
