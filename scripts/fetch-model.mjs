#!/usr/bin/env node
/**
 * 预取浏览器本地嵌入所需的静态资产，并校验 SHA-256。
 *
 *   node scripts/fetch-model.mjs           # 缺什么下什么；已存在且哈希正确就跳过
 *   node scripts/fetch-model.mjs --check   # 只校验，不下载（缺文件/哈希不符 → exit 1）
 *   node scripts/fetch-model.mjs --force   # 全部重新下载
 *
 * 产物（都在 public/ 下，不进 Next bundle，也不进 git）：
 *   public/embed/transformers.web.min.js              transformers.js 浏览器包
 *   public/embed/ort-wasm-simd-threaded.jsep.wasm     onnxruntime-web wasm
 *   public/embed/ort-wasm-simd-threaded.jsep.mjs      wasm 加载器
 *   public/models/bge-small-zh-v1.5/...               q8 模型与 tokenizer
 *
 * URL 全部钉死版本/commit，哈希从官方分发物计算后写死在 MANIFEST 里；
 * 任何一次上游替换都会让校验失败，而不是静默换模型。
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TRANSFORMERS_VERSION = "3.7.5";
const MODEL_REPO = "Xenova/bge-small-zh-v1.5";
const MODEL_COMMIT = "75c43b069aac4d136ba6bc1122f995fedcfd2781";

const TRANSFORMERS_BASE = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/`;
const MODEL_BASE = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_COMMIT}/`;

/** target：相对仓库根目录；bytes 只用于展示与明显的截断检测。 */
const MANIFEST = [
  {
    target: "public/embed/transformers.web.min.js",
    url: `${TRANSFORMERS_BASE}transformers.web.min.js`,
    sha256: "d5cb6a9448b6d961dafcf4e3dd5a621fe4a00eab8429e894f743c864bf042cf7",
    bytes: 455065,
  },
  {
    target: "public/embed/ort-wasm-simd-threaded.jsep.wasm",
    url: `${TRANSFORMERS_BASE}ort-wasm-simd-threaded.jsep.wasm`,
    sha256: "c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39",
    bytes: 21596019,
  },
  {
    target: "public/embed/ort-wasm-simd-threaded.jsep.mjs",
    url: `${TRANSFORMERS_BASE}ort-wasm-simd-threaded.jsep.mjs`,
    sha256: "08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9",
    bytes: 44484,
  },
  {
    target: "public/models/bge-small-zh-v1.5/config.json",
    url: `${MODEL_BASE}config.json`,
    sha256: "d4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f",
    bytes: 716,
  },
  {
    target: "public/models/bge-small-zh-v1.5/tokenizer.json",
    url: `${MODEL_BASE}tokenizer.json`,
    sha256: "48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26",
    bytes: 439125,
  },
  {
    target: "public/models/bge-small-zh-v1.5/tokenizer_config.json",
    url: `${MODEL_BASE}tokenizer_config.json`,
    sha256: "e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a",
    bytes: 367,
  },
  {
    target: "public/models/bge-small-zh-v1.5/special_tokens_map.json",
    url: `${MODEL_BASE}special_tokens_map.json`,
    sha256: "b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3",
    bytes: 125,
  },
  {
    target: "public/models/bge-small-zh-v1.5/vocab.txt",
    url: `${MODEL_BASE}vocab.txt`,
    sha256: "45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c",
    bytes: 109540,
  },
  {
    target: "public/models/bge-small-zh-v1.5/onnx/model_quantized.onnx",
    url: `${MODEL_BASE}onnx/model_quantized.onnx`,
    sha256: "15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc",
    bytes: 24010842,
  },
];

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const force = args.has("--force");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readFileOrNull(path) {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function download(item) {
  const response = await fetch(item.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== item.sha256) {
    throw new Error(`SHA-256 不符：期望 ${item.sha256}，实际 ${digest}`);
  }
  if (bytes.byteLength !== item.bytes) {
    throw new Error(`大小不符：期望 ${item.bytes}，实际 ${bytes.byteLength}`);
  }

  const target = join(ROOT, item.target);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return bytes.byteLength;
}

async function verify(item) {
  const target = join(ROOT, item.target);
  if (!existsSync(target)) return { ok: false, reason: "缺失" };
  const bytes = await readFileOrNull(target);
  if (bytes === null) return { ok: false, reason: "无法读取" };
  const digest = sha256(bytes);
  if (digest !== item.sha256) {
    return { ok: false, reason: `SHA-256 不符（实际 ${digest}）` };
  }
  if (bytes.byteLength !== item.bytes) {
    return { ok: false, reason: `大小不符（实际 ${bytes.byteLength}）` };
  }
  return { ok: true, reason: "ok" };
}

async function main() {
  let failures = 0;
  let downloaded = 0;

  console.log(`[fetch-model] transforms.js ${TRANSFORMERS_VERSION} · ${MODEL_REPO}@${MODEL_COMMIT.slice(0, 12)}`);

  for (const item of MANIFEST) {
    const before = await verify(item);
    if (before.ok && !force) {
      console.log(`[ok]   ${item.target}（${item.bytes} bytes）`);
      continue;
    }
    if (checkOnly) {
      console.error(`[fail] ${item.target}：${before.reason}`);
      failures += 1;
      continue;
    }
    if (before.ok && force) {
      await rm(join(ROOT, item.target), { force: true });
    }
    process.stdout.write(`[get]  ${item.target} … `);
    try {
      const size = await download(item);
      downloaded += 1;
      console.log(`ok（${size} bytes）`);
    } catch (err) {
      failures += 1;
      console.log("fail");
      console.error(`       下载或校验失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures > 0) {
    console.error(`\n[fetch-model] ${failures} 个文件未通过校验。`);
    process.exitCode = 1;
    return;
  }
  if (checkOnly) {
    console.log("\n[fetch-model] 全部文件通过 SHA-256 校验。");
  } else {
    console.log(`\n[fetch-model] 完成：新下载 ${downloaded} 个，其余已存在且校验通过。`);
  }
}

await main();
