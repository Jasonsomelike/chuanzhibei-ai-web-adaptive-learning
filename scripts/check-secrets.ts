/**
 * 提交前的密钥扫描。
 *
 * 赛道规则明确要求「API 密钥等敏感信息不得出现在公开仓库中」。
 * 这条不能靠人眼看，必须能在 CI 里跑。
 *
 * 用法：npm run check:secrets
 * 发现疑似密钥时以非 0 退出码结束。
 *
 * 规则本身在 src/lib/secretScan.ts：这里只负责遍历、放行文件与输出，
 * 匹配逻辑有单测（src/lib/secretScan.test.ts），改规则不必靠手工造文件验证。
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";

import { ALLOWLIST, scanText, type SecretHit } from "@/lib/secretScan";

const ROOT = process.cwd();

/**
 * 不扫描的目录。
 *
 * 这里只放构建产物与依赖；`screenshots/` 不再跳过——评审脚本含明文口令
 * 正是因为整目录被跳过（见 docs/review/2026-10-29-full-review.md 的 P0-1）。
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".zcode",
  "dist",
  "out",
]);

/** 只扫描文本类文件。 */
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".txt", ".css", ".html",
  ".yml", ".yaml", ".env", ".example", "",
]);

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

const hits: (SecretHit & { file: string })[] = [];
let scanned = 0;

for await (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");

  // 跳过扫描器自身：遍历/输出代码里的示例文本没有扫描价值。
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

  for (const hit of scanText(content)) {
    hits.push({ ...hit, file: rel });
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
