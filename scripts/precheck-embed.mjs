#!/usr/bin/env node
/**
 * Node 侧本地嵌入自检：证明 public/models 里的模型文件与 transformers.js 推理可用。
 *
 *   node scripts/precheck-embed.mjs
 *
 * 依赖：@huggingface/transformers（允许临时安装，不必进 package.json）
 *   npm install --no-save @huggingface/transformers@3.7.5
 *
 * 不依赖真实网络：env.allowRemoteModels=false，只读 public/models。
 * 3 段中文 → 打印维度与范数；任何一段不是 512 维有限值就 exit 1。
 * 这不是业务代码：浏览器侧仍然通过 Worker 调同一份模型文件。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODEL_ID = "bge-small-zh-v1.5";
const MODEL_DIR = join(ROOT, "public", "models");
const ONNX = join(MODEL_DIR, MODEL_ID, "onnx", "model_quantized.onnx");
const TOKENIZER = join(MODEL_DIR, MODEL_ID, "tokenizer.json");

const TEXTS = [
  "栈是后进先出（LIFO）的线性表，只能在栈顶插入和删除。",
  "队列是先进先出（FIFO）的线性表，入队发生在队尾，出队发生在队头。",
  "二叉树的先序遍历顺序是：根节点、左子树、右子树。",
];

function fail(message) {
  console.error(`[precheck-embed] ${message}`);
  process.exit(1);
}

if (!existsSync(ONNX) || !existsSync(TOKENIZER)) {
  console.error(
    `[precheck-embed] 模型文件不存在：${ONNX}\n` +
      "  先运行 node scripts/fetch-model.mjs（会校验 SHA-256），再重跑本脚本。",
  );
  process.exit(2);
}

let transformers;
try {
  transformers = await import("@huggingface/transformers");
} catch (err) {
  console.error(
    "[precheck-embed] 缺少 @huggingface/transformers。可临时安装（不写入 package.json）：\n" +
      "  npm install --no-save @huggingface/transformers@3.7.5\n" +
      `原始错误：${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(2);
}

const { env, pipeline } = transformers;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${MODEL_DIR.replaceAll("\\", "/")}/`;

let extractor;
try {
  extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
} catch (err) {
  fail(`模型加载失败：${err instanceof Error ? err.message : String(err)}`);
}

let output;
try {
  output = await extractor(TEXTS, { pooling: "mean", normalize: true });
} catch (err) {
  fail(`推理失败：${err instanceof Error ? err.message : String(err)}`);
}

const vectors = output.tolist();
if (!Array.isArray(vectors) || vectors.length !== TEXTS.length) {
  fail(`期望 ${TEXTS.length} 条向量，实际得到 ${Array.isArray(vectors) ? vectors.length : "非数组"}`);
}

let ok = true;
vectors.forEach((vector, index) => {
  const dim = Array.isArray(vector) ? vector.length : 0;
  const finite = Array.isArray(vector) && vector.every((value) => Number.isFinite(value));
  const norm = finite ? Math.hypot(...vector) : Number.NaN;
  console.log(
    `[precheck-embed] text#${index + 1} dim=${dim} finite=${finite} norm=${Number.isFinite(norm) ? norm.toFixed(6) : "NaN"}`,
  );
  if (dim !== 512 || !finite) ok = false;
});

if (!ok) fail("存在维度不是 512 或包含非有限值的向量。");

console.log("[precheck-embed] 通过：3 段中文均得到 512 维有限向量，模型与推理可用。");
