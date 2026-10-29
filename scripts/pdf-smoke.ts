/**
 * PDF 解析冒烟测试：在本机 Next 服务上用真实 Chromium 跑 pdf.ts。
 *
 * 覆盖：
 *   1. Chromium 生成的 2 页中文 PDF 能抽出两页文本（真实文本层，不是图片）；
 *   2. 只有图片的 PDF 返回「没有文本层」，不做 OCR；
 *   3. 浏览器 Network 里确实加载了 pdf.worker（不是主线程 fake worker）。
 *
 * 用法（先 `npx playwright install chromium`）：
 *   node node_modules/tsx/dist/cli.mjs scripts/pdf-smoke.ts
 *
 * 默认自建临时路由 app/kb-pdf-smoke 并启动 `next dev`，结束后删除路由、关闭服务。
 * 已有服务时可用 BASE_URL 复用（该服务必须已包含 /kb-pdf-smoke 路由）。
 * 只用于验证，路由文件不会留在仓库里。
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

import type { PdfExtractResult } from "@/lib/pdf";

const ROOT = process.cwd();
const ROUTE_DIR = join(ROOT, "app", "kb-pdf-smoke");
const ROUTE_FILE = join(ROUTE_DIR, "page.tsx");
const NEXT_BIN = join(ROOT, "node_modules", "next", "dist", "bin", "next");

const ROUTE_SOURCE = `"use client";

import { useEffect } from "react";

import { extractPdfText } from "@/lib/pdf";

type SmokeApi = { extract: (bytes: number[]) => Promise<unknown> };

export default function KbPdfSmokePage() {
  useEffect(() => {
    (window as unknown as { __kbPdfSmoke?: SmokeApi }).__kbPdfSmoke = {
      extract: (bytes: number[]) => extractPdfText(new Uint8Array(bytes)),
    };
  }, []);
  return <main data-kb-pdf-smoke="ready">kb pdf smoke</main>;
}
`;

const IMAGE_PDF_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const results: Check[] = [];

function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickPort(): Promise<number> {
  const start = Number(process.env.PDF_SMOKE_PORT ?? 3212);
  for (let port = start; port < start + 20; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new Error(`端口 ${start}–${start + 19} 都被占用，无法启动 Next 服务`);
}

interface DevServer {
  readonly child: ChildProcess;
  readonly log: () => string;
}

function startDevServer(port: number): DevServer {
  let log = "";
  const child = spawn(process.execPath, [NEXT_BIN, "dev", "-p", String(port)], {
    cwd: ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (data: Buffer): void => {
    log = (log + data.toString()).slice(-6000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  return { child, log: () => log };
}

async function waitForServer(url: string, timeoutMs: number, log: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 服务还没起来，继续等
    }
    await sleep(500);
  }
  throw new Error(`本地 Next 服务未就绪：${url}\n${log()}`);
}

async function stopDevServer(server: DevServer | null): Promise<void> {
  if (server === null || server.child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.child.kill("SIGTERM");
  }
  await sleep(800);
}

// ── 生成测试 PDF ──────────────────────────────────────────────────

/** 用 Chromium 自己排版并打印，得到带真实字体与文本层的 2 页中文 PDF。 */
async function makeChinesePdf(browser: Browser): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<!doctype html>
<html><head><style>
  @page { margin: 20mm; }
  body { font-family: "Microsoft YaHei", "Noto Sans CJK SC", serif; }
  .page { font-size: 24px; line-height: 1.8; }
  .second { page-break-before: always; }
</style></head>
<body>
  <div class="page">第一页：栈是后进先出的线性表。队列是先进先出。</div>
  <div class="page second">第二页：二分查找的时间复杂度是 O(log n)，每次比较后区间减半。</div>
</body></html>`,
      { waitUntil: "load" },
    );
    return await page.pdf({ format: "A4", printBackground: true });
  } finally {
    await page.close();
  }
}

/** 只有一张图片的 PDF：没有任何文字，用来验证「无文本层」分支。 */
async function makeImageOnlyPdf(browser: Browser): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<!doctype html><html><body style="margin:0">
  <img src="data:image/png;base64,${IMAGE_PDF_PNG}" style="display:block;width:600px;height:400px">
</body></html>`,
      { waitUntil: "load" },
    );
    return await page.pdf({ format: "A4" });
  } finally {
    await page.close();
  }
}

// ── 浏览器内调用 pdf.ts ───────────────────────────────────────────

async function extractInPage(page: Page, pdf: Buffer): Promise<PdfExtractResult> {
  return (await page.evaluate(async (bytes: number[]) => {
    const api = (
      window as unknown as {
        __kbPdfSmoke?: { extract: (input: number[]) => Promise<unknown> };
      }
    ).__kbPdfSmoke;
    if (api === undefined) throw new Error("pdf smoke API 未就绪");
    return api.extract(bytes);
  }, Array.from(pdf))) as PdfExtractResult;
}

async function runBrowserChecks(base: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const chinesePdf = await makeChinesePdf(browser);
    const imagePdf = await makeImageOnlyPdf(browser);
    const page = await browser.newPage();

    const workerResponses: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      if (response.url().includes("pdf.worker")) {
        workerResponses.push({ url: response.url(), status: response.status() });
      }
    });
    page.on("requestfailed", (request) => {
      if (request.url().includes("pdf.worker")) {
        workerResponses.push({ url: request.url(), status: 0 });
      }
    });

    await page.goto(`${base}/kb-pdf-smoke`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () =>
        (
          window as unknown as {
            __kbPdfSmoke?: unknown;
          }
        ).__kbPdfSmoke !== undefined,
      undefined,
      { timeout: 60_000 },
    );

    const chinese = await extractInPage(page, chinesePdf);
    check(
      "2 页中文 PDF 有文本层",
      chinese.ok,
      chinese.ok
        ? `${chinese.pageCount} 页 / ${chinese.charCount} 字`
        : `被拒绝：${chinese.reason}`,
    );
    if (chinese.ok) {
      const pages = chinese.blocks.map((block) => block.page);
      check(
        "页码与两页正文正确",
        chinese.pageCount === 2 &&
          chinese.blocks.length === 2 &&
          pages[0] === 1 &&
          pages[1] === 2 &&
          chinese.blocks.some((block) => block.text.includes("第一页")) &&
          chinese.blocks.some((block) => block.text.includes("第二页")),
        chinese.blocks.map((block) => `第${block.page}页:${block.text.slice(0, 12)}`).join(" | "),
      );
    }

    const image = await extractInPage(page, imagePdf);
    check(
      "image-only PDF 报无文本层",
      !image.ok && image.reason.includes("没有文本层") && image.reason.includes("OCR"),
      image.ok ? `意外抽出 ${image.charCount} 字` : image.reason.slice(0, 40),
    );

    // worker 可能在解析结束后才完成下载，留一点时间收网络事件
    await page.waitForTimeout(500);
    const worker = workerResponses.find((item) => item.status === 200);
    check(
      "pdf.worker 由浏览器加载",
      worker !== undefined,
      worker !== undefined
        ? `${worker.status} ${worker.url.split("/").pop() ?? worker.url}`
        : workerResponses.length === 0
          ? "未观察到 pdf.worker 请求（可能退回主线程 fake worker）"
          : workerResponses.map((item) => `${item.status} ${item.url}`).join("；"),
    );
  } finally {
    await browser.close();
  }
}

// ── 入口 ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!existsSync(chromium.executablePath())) {
    console.error("未找到 Playwright Chromium。请先运行：npx playwright install chromium");
    process.exitCode = 1;
    return;
  }

  const external = process.env.BASE_URL?.trim();
  let server: DevServer | null = null;
  let createdRoute = false;

  try {
    let base: string;

    if (external !== undefined && external !== "") {
      base = external.replace(/\/+$/, "");
      const response = await fetch(`${base}/kb-pdf-smoke`);
      if (!response.ok) {
        throw new Error(
          `BASE_URL=${base} 上没有 /kb-pdf-smoke 页面（${response.status}）。` +
            "复用服务时需先让该服务包含临时 smoke 路由；不设 BASE_URL 则由脚本自建。",
        );
      }
    } else {
      const port = await pickPort();
      createdRoute = !existsSync(ROUTE_DIR);
      await mkdir(ROUTE_DIR, { recursive: true });
      await writeFile(ROUTE_FILE, ROUTE_SOURCE, "utf8");

      server = startDevServer(port);
      base = `http://localhost:${port}`;
      await waitForServer(`${base}/kb-pdf-smoke`, 120_000, server.log);
    }

    await runBrowserChecks(base);
  } finally {
    await stopDevServer(server);
    if (createdRoute) {
      await rm(ROUTE_DIR, { recursive: true, force: true });
      // next dev 的 validator 会记住刚删掉的临时路由；不清掉，下一次 tsc 会报模块不存在。
      await rm(join(ROOT, ".next", "dev", "types"), { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (err) {
  check("执行异常", false, err instanceof Error ? err.message : String(err));
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log("失败项：");
  for (const item of failed) console.log(`  · ${item.name}: ${item.detail}`);
  process.exitCode = 1;
}
