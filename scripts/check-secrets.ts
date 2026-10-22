/**
 * 提交前的密钥扫描。
 *
 * 赛道规则明确要求「API 密钥等敏感信息不得出现在公开仓库中」。
 * 这条不能靠人眼看，必须能在 CI 里跑。
 *
 * 用法：npm run check:secrets
 * 发现疑似密钥时以非 0 退出码结束。
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();

/** 不扫描的目录。 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".zcode",
  "screenshots",
  "dist",
  "out",
]);

/** 只扫描文本类文件。 */
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".txt", ".css", ".html",
  ".yml", ".yaml", ".env", ".example", "",
]);

/**
 * 疑似密钥的模式。
 * 刻意写得宽一些：宁可误报，也不要漏报。
 * 每条都排除本文件自身与 .env.example 里的空键名。
 */
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "OpenAI 风格 key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "AWS Access Key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: "私钥块", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Bearer 长串", re: /Bearer\s+[A-Za-z0-9._-]{40,}/ },
  {
    name: "赋了值的密钥变量",
    re: /(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/,
  },
];

/** 允许出现的例外：示例文件里的空值、文档里的占位符。 */
const ALLOWLIST = [
  /\.env\.example$/,
  /\.env\.local$/,
  /PLACEHOLDER/,
  /<REDACTED>/,
  /your[_-]?api[_-]?key/i,
  /xxx+/i,
];

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".env.example") {
      if (SKIP_DIRS.has(e.name) || e.isDirectory()) continue;
    }
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

interface Hit {
  file: string;
  line: number;
  pattern: string;
  preview: string;
}

const hits: Hit[] = [];
let scanned = 0;

for await (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");

  // 跳过扫描器自身（它的正则里就含这些模式）
  if (rel === "scripts/check-secrets.ts") continue;
  if (ALLOWLIST.some((re) => re.test(rel))) continue;

  const ext = extname(file);
  if (!TEXT_EXT.has(ext)) continue;

  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch {
    continue;
  }
  scanned += 1;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > 500) continue;
    if (ALLOWLIST.some((re) => re.test(line))) continue;

    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        hits.push({
          file: rel,
          line: i + 1,
          pattern: p.name,
          // 只留前 40 字符，避免把疑似密钥本身打印出来
          preview: line.trim().slice(0, 40),
        });
        break;
      }
    }
  }
}

console.log(`密钥扫描：检查 ${scanned} 个文件`);
console.log("─".repeat(52));

if (hits.length === 0) {
  console.log("未发现疑似密钥。");
  process.exit(0);
}

console.error(`发现 ${hits.length} 处疑似密钥：`);
for (const h of hits) {
  console.error(`  ✗ ${h.file}:${h.line}  [${h.pattern}]  ${h.preview}`);
}
console.error("\n请把真实值移到 .env.local，或替换为 <REDACTED>。");
process.exit(1);
