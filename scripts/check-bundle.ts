/**
 * 路由级首屏 JS 预算门禁（评审 P1-10）。
 *
 * 口径：解析 `next build` 产出的
 *   .next/server/app/<route>/page_client-reference-manifest.js
 * 取该路由 `clientModules` 与 `entryJSFiles` 引用到的所有
 * `/_next/static/chunks/*.js`，去重后逐个 gzip -9 求和。
 * 同一 chunk 被多个路由共用时按路由分别计入——门禁管的是「进入这个路由要下多少 JS」，
 * 不是「磁盘上有多少字节」。这份口径与评审 P1-10 的对照值一致（zod 4.1.12 构建实测）：
 *   / 40、/about 40、/login 42、/market 42、/path 227、/settings 266、
 *   /tutor 242、/diagnose 265、/directions 257 KB。
 * 表格另给一列「含框架」：直接数路由 HTML 里的 <script> 标签，含 turbopack runtime
 * 等所有路由共用的框架 chunk，仅供参考、不参与门禁。
 *
 * 预算：
 *   - `/` `/about` `/login` `/market`：180KB 硬线（research/06-synthesis.md:195）
 *   - `/path` `/settings` `/tutor` `/diagnose` `/directions`：首次实测基线 ×1.05 防回退
 *     （拆包本身见 docs/review/2026-10-29-full-review.md P1-10 deferred）
 *
 * 用法：
 *   npm run build && npm run check:bundle          # 人读表格
 *   npm run check:bundle -- --json                 # 机器读
 *
 * 缺构建产物、缺 chunk 文件或超预算都以非 0 退出码结束。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = process.cwd();
const SERVER_APP_DIR = join(ROOT, ".next", "server", "app");
const CHUNK_DIR = join(ROOT, ".next", "static", "chunks");

const HARD_LIMIT_KB = 180;
const REGRESSION_TOLERANCE = 1.05;

/**
 * 首次实测基线（KB，gzip，2026-10-29）。
 * 只允许在真正拆包之后手动下调；不要为了让门禁变绿而往上调。
 *
 * 口径自证：用 zod 4.1.12 构建时，本脚本复现出的值与评审 P1-10 的对照值一致
 * （/path 227.20、/settings 265.76、/tutor 242.92、/diagnose 265.88、/directions 257.31）。
 * P1-12 把 zod 升到 4.6.7 后，`src/lib/itemgen.ts:19` 的 zod 被
 * `app/diagnose/page.tsx:55` 与 `app/directions/page.tsx:31` 客户端引用，
 * 新格式让客户端 chunk 各涨 12.4KB gzip（/diagnose 265.9→278.3、/directions 257.3→269.7），
 * 所以这两页按升级后首次实测记录；其余三页不受 zod 影响，沿用对照基线。
 * 拆包把 zod 移出客户端后应回落到 ~265/~257，届时同步下调。
 */
const BASELINE_KB: Readonly<Record<string, number>> = {
  "/path": 227,
  "/settings": 266,
  "/tutor": 242,
  "/diagnose": 279,
  "/directions": 270,
};

/** 输出顺序 = 评审给的顺序。 */
const ROUTES = [
  "/",
  "/about",
  "/login",
  "/market",
  "/path",
  "/settings",
  "/tutor",
  "/diagnose",
  "/directions",
] as const;

/**
 * manifest 里的 chunk 有两种写法：`/_next/static/chunks/x.js`（clientModules）
 * 与 `static/chunks/x.js`（entryJSFiles）。只认客户端 chunk，
 * SSR 的 `server/chunks/ssr/...` 不匹配。
 */
const CLIENT_CHUNK_RE = /(?:\.\/)?(?:\/_next\/)?static\/chunks\/([\w.-]+\.js)/g;

/** 路由 HTML 里的 <script src>，用于「含框架」参考列。 */
const SCRIPT_SRC_RE = /<script[^>]+src="\/_next\/static\/chunks\/([\w.-]+\.js)"/g;

const gzipCache = new Map<string, number>();

function gzipBytesOf(chunkName: string): number {
  const cached = gzipCache.get(chunkName);
  if (cached !== undefined) return cached;

  const file = join(CHUNK_DIR, chunkName);
  if (!existsSync(file)) {
    throw new Error(
      `chunk ${chunkName} 在 ${relative(ROOT, CHUNK_DIR)} 里找不到：构建产物不完整或已过期，先重跑 npm run build`,
    );
  }
  const bytes = gzipSync(readFileSync(file), { level: 9 }).length;
  gzipCache.set(chunkName, bytes);
  return bytes;
}

function manifestPath(route: string): string {
  const sub = route === "/" ? "" : route.slice(1);
  return join(SERVER_APP_DIR, sub, "page_client-reference-manifest.js");
}

function clientChunks(route: string): { chunks: string[]; bytes: number } {
  const file = manifestPath(route);
  if (!existsSync(file)) {
    throw new Error(
      `找不到 ${relative(ROOT, file)}：先跑 npm run build（且需 Next 产出 page_client-reference-manifest.js）`,
    );
  }
  const text = readFileSync(file, "utf8");
  const names = new Set<string>();
  for (const match of text.matchAll(CLIENT_CHUNK_RE)) {
    const name = match[1];
    if (name) names.add(name);
  }
  if (names.size === 0) {
    throw new Error(`${relative(ROOT, file)} 里没有解析到任何客户端 chunk，manifest 结构可能变了，检查本脚本`);
  }
  const chunks = [...names].sort();
  const bytes = chunks.reduce((sum, name) => sum + gzipBytesOf(name), 0);
  return { chunks, bytes };
}

/** 参考列：路由 HTML 直接引用的脚本（含框架），静态预渲染的路由才有。 */
function scriptTagBytes(route: string): number | null {
  const file = join(SERVER_APP_DIR, route === "/" ? "index.html" : `${route.slice(1)}.html`);
  if (!existsSync(file)) return null;
  const html = readFileSync(file, "utf8");
  const names = new Set<string>();
  for (const match of html.matchAll(SCRIPT_SRC_RE)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names].reduce((sum, name) => sum + gzipBytesOf(name), 0);
}

type Row = {
  route: string;
  gzipKB: number;
  limitKB: number;
  budget: string;
  headroomKB: number;
  ok: boolean;
  referenceKB: number | null;
  chunks: string[];
};

function limitFor(route: string): { limitKB: number; budget: string } {
  const baseline = BASELINE_KB[route];
  if (baseline === undefined) {
    return { limitKB: HARD_LIMIT_KB, budget: `硬线 ${HARD_LIMIT_KB}KB` };
  }
  return {
    limitKB: baseline * REGRESSION_TOLERANCE,
    budget: `基线 ${baseline}KB ×${REGRESSION_TOLERANCE}`,
  };
}

function kb(bytes: number): number {
  return bytes / 1024;
}

function fmt(n: number): string {
  return n.toFixed(1).padStart(8);
}

function main(): void {
  if (!existsSync(SERVER_APP_DIR)) {
    throw new Error("找不到 .next/server/app：先跑 npm run build");
  }

  const rows: Row[] = ROUTES.map((route) => {
    const { chunks, bytes } = clientChunks(route);
    const { limitKB, budget } = limitFor(route);
    const gzipKB = kb(bytes);
    const referenceBytes = scriptTagBytes(route);
    return {
      route,
      gzipKB,
      limitKB,
      budget,
      headroomKB: limitKB - gzipKB,
      // 用字节精度判，避免 242.9 四舍五入成 243 后与显示值打架
      ok: gzipKB <= limitKB,
      referenceKB: referenceBytes === null ? null : kb(referenceBytes),
      chunks,
    };
  });

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          unit: "KB (gzip -9)",
          method: "page_client-reference-manifest clientModules + entryJSFiles",
          tolerance: REGRESSION_TOLERANCE,
          rows: rows.map((r) => ({
            route: r.route,
            gzipKB: Number(r.gzipKB.toFixed(2)),
            limitKB: Number(r.limitKB.toFixed(2)),
            budget: r.budget,
            ok: r.ok,
            referenceKB: r.referenceKB === null ? null : Number(r.referenceKB.toFixed(2)),
            chunks: r.chunks,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log("路由首屏 JS（gzip -9，口径：page_client-reference-manifest）");
    console.log("");
    console.log("路由          体积       预算上限  预算口径              余量     含框架(参考)  结论");
    for (const row of rows) {
      const ref = row.referenceKB === null ? "     -" : fmt(row.referenceKB);
      console.log(
        `${row.route.padEnd(12)}${fmt(row.gzipKB)}KB${fmt(row.limitKB)}KB  ${row.budget.padEnd(20)}${fmt(
          row.headroomKB,
        )}KB${ref}    ${row.ok ? "OK" : "超预算"}`,
      );
    }
    console.log("");
    const worst = rows.reduce((a, b) => (a.headroomKB < b.headroomKB ? a : b));
    console.log(
      `汇总：${rows.filter((r) => r.ok).length}/${rows.length} 个路由在预算内；最紧的是 ${worst.route}（余量 ${worst.headroomKB.toFixed(1)}KB）`,
    );
  }

  const violations = rows.filter((r) => !r.ok);
  if (violations.length > 0) {
    console.error("");
    for (const row of violations) {
      console.error(
        `✗ ${row.route} 首屏 JS ${row.gzipKB.toFixed(1)}KB 超过 ${row.limitKB.toFixed(1)}KB（${row.budget}）${row.headroomKB < 0 ? `，超出 ${(-row.headroomKB).toFixed(1)}KB` : ""}`,
      );
      console.error(`  chunks: ${row.chunks.join(", ")}`);
    }
    console.error("");
    console.error("修法：把这页的重依赖改成动态 import 或下沉到服务端，不要调高预算。");
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(`check:bundle 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
