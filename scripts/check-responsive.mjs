#!/usr/bin/env node
/**
 * 响应式布局回归：10 个页面 × 9 个宽度。
 *
 * 背景：浏览器放大后 CSS 视口变窄，设置页分区标签被裁、导航换行增高。
 * 断言（与 docs/review/zoom-repro.md §6.3 对应）：
 *   1. 页面级不横向溢出：scrollingElement.scrollWidth <= clientWidth + 1；
 *   2. /settings 的每个分区标签 rect.left >= 0 且 rect.right <= clientWidth；
 *      标签条自身也不允许再出现横向滚动；
 *   3. header 里的导航链接 / 按钮 rect.left >= 0 且 rect.right <= clientWidth，
 *      且文字没有被 truncate 截断（只量 rect 会漏掉被省略号吃掉的标签）；
 *   4. 没有任何元素在未被祖先裁切的情况下越出视口右缘（防止 overflow-x: clip
 *      把真实溢出藏起来后断言仍然“通过”）；越界后被 overflow: hidden/clip
 *      祖先裁掉的可读文字同样算失败——那正是“用裁切假装修好”。
 * 另做一次长内容压测：本机配置写入 120 字符无断点模型名后，/settings 在
 * 360 / 853 宽下摘要行仍需完整落在视口内。
 *
 * 用法：
 *   node scripts/check-responsive.mjs         完整矩阵：10 页 × 9 宽 + 长内容压测
 *   node scripts/check-responsive.mjs --fast  快速回归：/ /settings /tutor × 1024/853/640/390，
 *                                             单页等待 ≤ 8s、服务启动 ≤ 120s、整体 90s 硬预算
 * 脚本自己启动 `npm run dev -p 3210`（Windows 走 cmd /c），结束后杀掉进程树。
 * 失败时打印页面、宽度、元素与数值，退出码 1；全部通过退出码 0。
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3210;
/*
 * 用 localhost 而不是 127.0.0.1：Next 16 dev 默认把 localhost 之外的来源
 * 视为跨源，会拦掉 /_next/hmr，客户端不执行 hydration，量到的是未水合布局。
 */
const ORIGIN = `http://localhost:${PORT}`;
const VIEWPORT_HEIGHT = 900;

/** 完整矩阵：10 页 × 9 宽。顺序从宽到窄，首次编译落在宽屏上。 */
const FULL_WIDTHS = [1440, 1280, 1024, 853, 768, 640, 480, 390, 360];
const FULL_ROUTES = [
  "/",
  "/diagnose",
  "/path",
  "/tutor",
  "/directions",
  "/market",
  "/settings",
  "/guide",
  "/about",
  "/login",
];

/**
 * 运行模式。
 * fast 是收尾用的快速回归：3 个关键页 × 4 个关键宽度，单页加载/等待 ≤ 8s，
 * 服务启动 ≤ 120s，整体 90s 硬预算（看门狗到点打印卡点并以退出码 1 结束）。
 */
const MODES = {
  full: {
    name: "完整",
    routes: FULL_ROUTES,
    widths: FULL_WIDTHS,
    pageTimeout: 180_000,
    navWait: 10_000,
    serverTimeout: 180_000,
    totalBudget: null,
    longContentProbe: true,
  },
  fast: {
    name: "快速",
    routes: ["/", "/settings", "/tutor"],
    widths: [1024, 853, 640, 390],
    pageTimeout: 8_000,
    navWait: 3_000,
    serverTimeout: 120_000,
    totalBudget: 90_000,
    longContentProbe: false,
  },
};

/** 页面级允许 1px 取整误差；元素 rect 允许 0.5px。 */
const PAGE_TOLERANCE = 1;
const EDGE_TOLERANCE = 0.5;

const LOG_TAIL = 60;

/** 当前运行模式（main 里由命令行参数决定），供预算钳制与日志使用。 */
let mode = MODES.full;
const STARTED_AT = Date.now();
/** 当前正在做什么，看门狗超时时打印出来，避免只说“超时了”。 */
let currentStep = "解析参数";

/** 距离整体预算到期还剩多少毫秒；无预算（完整矩阵）时为 Infinity。 */
function remainingBudget() {
  if (mode.totalBudget === null) return Number.POSITIVE_INFINITY;
  return mode.totalBudget - (Date.now() - STARTED_AT);
}

/** 把某个超时钳制在整体预算内，至少 1s。 */
function clampToBudget(timeoutMs) {
  return Math.max(1_000, Math.min(timeoutMs, remainingBudget()));
}

function parseArgs(argv) {
  let fast = false;
  for (const arg of argv.slice(2)) {
    if (arg === "--fast") {
      fast = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("用法：node scripts/check-responsive.mjs [--fast]");
      console.log("  无参数：完整矩阵 10 页 × 9 宽 + 长内容压测");
      console.log("  --fast：/ /settings /tutor × 1024/853/640/390，单页 ≤ 8s、整体 ≤ 90s");
      process.exit(0);
    } else {
      console.error(`✗ 未知参数：${arg}（只支持 --fast，或 --help）`);
      process.exit(2);
    }
  }
  return fast ? MODES.fast : MODES.full;
}

let devServer = null;
let serverStopped = false;
/** 浏览器实例提到模块级，看门狗超时时也能关掉。 */
let browser = null;
let watchdog = null;
const serverLog = [];

function recordServerOutput(chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.trim() === "") continue;
    serverLog.push(line);
    if (serverLog.length > LOG_TAIL) serverLog.shift();
  }
}

function startDevServer() {
  const npmArgs = ["run", "dev", "--", "-p", String(PORT)];
  const options = {
    cwd: ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  };
  const child =
    process.platform === "win32"
      ? // Windows 上 npm 是 .cmd，必须经 cmd /c 才能 spawn
        spawn("cmd", ["/c", "npm", ...npmArgs], { ...options, windowsHide: true })
      : // POSIX 开新进程组，结束时整组杀掉（npm → next → 子进程）
        spawn("npm", npmArgs, { ...options, detached: true });
  child.stdout.on("data", recordServerOutput);
  child.stderr.on("data", recordServerOutput);
  return child;
}

/** 杀掉 dev server 及其子进程。可重复调用。 */
function stopDevServer() {
  if (serverStopped || devServer === null) return;
  serverStopped = true;
  const pid = devServer.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        devServer.kill("SIGTERM");
      } catch {
        // 已经退出
      }
    }
  }
}

function printServerLog() {
  if (serverLog.length === 0) return;
  console.error("\n--- dev server 最近输出 ---");
  for (const line of serverLog) console.error(line);
  console.error("--- dev server 输出结束 ---\n");
}

/**
 * 整体预算看门狗（仅 fast 模式）。
 * 到点先打印“卡在哪一步”，再关浏览器、杀 dev server 进程树，退出码 1。
 * 预算是硬性的：与其无限等一个 dev 编译，不如把现场交出来。
 */
function startWatchdog() {
  if (mode.totalBudget === null) return;
  watchdog = setTimeout(() => {
    console.error(
      `\n✗ ${mode.name}模式超过 ${Math.round(mode.totalBudget / 1000)}s 预算，停在：${currentStep}`,
    );
    printServerLog();
    stopDevServer();
    const exit = () => process.exit(1);
    if (browser !== null) browser.close().then(exit, exit);
    else exit();
    // browser.close 也可能卡住，2s 后强制退出
    setTimeout(exit, 2_000);
  }, mode.totalBudget);
}

/** 正常结束或提前失败时都要撤销看门狗，否则定时器会把进程多留 90s。 */
function stopWatchdog() {
  if (watchdog === null) return;
  clearTimeout(watchdog);
  watchdog = null;
}

async function waitForServer(child, timeoutMs = 180_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`dev server 提前退出（exitCode=${child.exitCode}）`);
    }
    try {
      // 任何 HTTP 响应都算“已监听”；页面状态由后面的 goto 断言。
      await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(10_000) });
      if (child.exitCode !== null) {
        throw new Error(`dev server 启动后退出（exitCode=${child.exitCode}）`);
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("dev server")) throw error;
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  throw new Error(`等待 ${ORIGIN} 就绪超时（${timeoutMs}ms）`);
}

/**
 * 端口必须是空的：否则等待就绪时可能连到上一次残留的 dev server，
 * 检查的就不是本脚本刚启动的这份代码。
 */
async function assertPortFree() {
  try {
    await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(1500) });
  } catch {
    return;
  }
  throw new Error(
    `端口 ${PORT} 已被占用：先结束占用它的进程（或上一次残留的 dev server），再运行本脚本`,
  );
}

/**
 * 在页面里执行：量页面级宽度、标签条、导航，并扫描未被裁切的越界元素。
 * 必须是自包含函数，Playwright 会把它序列化后送进浏览器。
 */
function readLayout() {
  const se = document.scrollingElement ?? document.documentElement;
  const clientWidth = se.clientWidth;
  const round = (value) => Math.round(value * 10) / 10;

  const labelOf = (el) => {
    const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
    const tag = el.tagName.toLowerCase();
    const cls =
      typeof el.className === "string" && el.className.trim() !== ""
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : "";
    return `<${tag}${cls}>${text === "" ? "" : `「${text}」`}`;
  };

  /*
   * html 上的 overflow-x: clip 让 scrollingElement.scrollWidth 恒等于
   * clientWidth，页面级断言会失灵；body.scrollWidth 仍然如实包含溢出内容。
   * 两个都量：前者是需求里的页面级断言，后者是防止兜底 clip 掩盖真实溢出。
   */
  const bodyWidths = {
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.body.clientWidth,
  };

  /*
   * 找到决定横向可见性的祖先。computed overflow-x 在另一轴非 visible 时
   * 会被算成 auto，所以只看 overflow-x 就够。
   * 返回 null 表示没被裁切；否则区分“能滚到的滚动区”和“裁掉够不到的 hidden/clip”。
   * 跳过 body/html 是因为全局兜底 overflow-x: clip 会把所有元素都算成被裁切，
   * 那样扫描就失去意义——body 之外的越界必须照实上报。
   */
  const clippingAncestor = (el) => {
    let parent = el.parentElement;
    while (parent !== null && parent !== document.body && parent !== document.documentElement) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX !== "visible") {
        return {
          overflowX,
          scrollable: overflowX === "auto" || overflowX === "scroll",
          element: labelOf(parent),
        };
      }
      parent = parent.parentElement;
    }
    return null;
  };

  const overflow = [];
  const clipped = [];
  for (const el of document.body.querySelectorAll("*")) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.right <= clientWidth + 1 && rect.left >= -1) continue;
    const clip = clippingAncestor(el);
    if (clip === null) {
      overflow.push({
        element: labelOf(el),
        left: round(rect.left),
        right: round(rect.right),
      });
    } else if (!clip.scrollable && (el.textContent ?? "").trim() !== "") {
      /*
       * 越界内容被 overflow: hidden/clip 的祖先裁掉、用户也滚不到，
       * 就是“显示不全”。纯装饰元素没有文字，不在此列。
       */
      clipped.push({
        element: labelOf(el),
        left: round(rect.left),
        right: round(rect.right),
        clip: clip.element,
        overflowX: clip.overflowX,
      });
    }
    if (overflow.length >= 6 && clipped.length >= 6) break;
  }

  /*
   * 文字溢出不改变块级盒子的 rect：一个 white-space: nowrap 的 <p> 宽度仍是
   * 容器宽，文字却画到盒子外，再被祖先的 overflow: hidden/clip 切掉。
   * 所以还要看“盒子没变宽、内容却更宽”的裁切容器：
   *   overflow-x 为 hidden/clip（滚不到）+ scrollWidth > clientWidth + 1 + 有文字。
   * text-overflow: ellipsis 是有意的省略号（用户看得见），不算静默裁切；
   * 导航链接的省略号由 checkLayout 的专项断言单独把关。
   */
  const clippedText = [];
  for (const el of document.body.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (style.overflowX !== "hidden" && style.overflowX !== "clip") continue;
    if (style.textOverflow === "ellipsis") continue;
    /*
     * sr-only（跳转链接、输入框 label）用 1×1 + overflow: hidden 把文字留给
     * 读屏软件，是刻意的无障碍写法，不是“显示不全”，跳过。
     */
    if (el.clientWidth <= 1 || el.clientHeight <= 1) continue;
    if ((el.textContent ?? "").trim() === "") continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    clippedText.push({
      element: labelOf(el),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: style.overflowX,
    });
    if (clippedText.length >= 6) break;
  }

  const tablist = document.querySelector('[role="tablist"]');
  let tabs = null;
  if (tablist !== null) {
    const style = getComputedStyle(tablist);
    tabs = {
      scrollWidth: tablist.scrollWidth,
      clientWidth: tablist.clientWidth,
      flexDirection: style.flexDirection,
      flexWrap: style.flexWrap,
      overflowX: style.overflowX,
      items: [...tablist.querySelectorAll('[role="tab"]')].map((tab) => {
        const rect = tab.getBoundingClientRect();
        return {
          label: (tab.textContent ?? "").trim(),
          left: round(rect.left),
          right: round(rect.right),
        };
      }),
    };
  }

  const navBar = document.querySelector("header nav");
  const navStyle = navBar === null ? null : getComputedStyle(navBar);

  const nav = [...document.querySelectorAll("header a, header button")].map((el) => {
    const rect = el.getBoundingClientRect();
    // 文字是否被 truncate/省略号截断：链接自身或内部的 .truncate 文本
    const textEl = el.querySelector(".truncate");
    const clipped =
      el.scrollWidth > el.clientWidth + 1 ||
      (textEl !== null && textEl.scrollWidth > textEl.clientWidth + 1);
    return {
      label: (el.textContent ?? "").trim().slice(0, 24),
      left: round(rect.left),
      right: round(rect.right),
      clipped,
    };
  });

  const status = document.querySelector('[data-motion="status"]');
  const statusSpans =
    status === null
      ? []
      : [...status.querySelectorAll("span")].map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            text: (el.textContent ?? "").trim().slice(0, 24),
            left: round(rect.left),
            right: round(rect.right),
          };
        });

  return {
    clientWidth,
    scrollWidth: se.scrollWidth,
    bodyWidths,
    tabs,
    nav,
    navFlexWrap: navStyle === null ? null : navStyle.flexWrap,
    overflow,
    clipped,
    clippedText,
    statusText: status === null ? null : (status.textContent ?? "").trim().slice(0, 80),
    statusSpans,
  };
}

const failures = [];
let checks = 0;

function fail(page, width, detail) {
  failures.push({ page, width, detail });
  console.error(`  ✗ ${page} @ ${width}px — ${detail}`);
}

function checkLayout(page, width, layout) {
  checks += 1;
  if (layout.scrollWidth > layout.clientWidth + PAGE_TOLERANCE) {
    fail(
      page,
      width,
      `页面横向溢出：scrollWidth=${layout.scrollWidth} > clientWidth=${layout.clientWidth}（+${layout.scrollWidth - layout.clientWidth}px）`,
    );
  }

  /*
   * 兜底 overflow-x: clip 让 scrollingElement 的 scrollWidth 不再体现溢出，
   * 这里用 body 的内容宽度复核，避免“全局裁掉就算过”。
   */
  if (layout.bodyWidths.scrollWidth > layout.bodyWidths.clientWidth + PAGE_TOLERANCE) {
    fail(
      page,
      width,
      `页面内容横向溢出（body 实测）：scrollWidth=${layout.bodyWidths.scrollWidth} > clientWidth=${layout.bodyWidths.clientWidth}（+${layout.bodyWidths.scrollWidth - layout.bodyWidths.clientWidth}px）`,
    );
  }

  for (const item of layout.overflow) {
    fail(
      page,
      width,
      `元素未被裁切却越出视口：${item.element} left=${item.left} right=${item.right}（视口 0..${layout.clientWidth}）`,
    );
  }

  for (const item of layout.clipped) {
    fail(
      page,
      width,
      `可读内容越出视口后被祖先裁掉（滚不到）：${item.element} left=${item.left} right=${item.right}，裁切祖先 ${item.clip}（overflow-x=${item.overflowX}）`,
    );
  }

  for (const item of layout.clippedText) {
    fail(
      page,
      width,
      `文字被裁切容器切掉（滚不到）：${item.element} scrollWidth=${item.scrollWidth} > clientWidth=${item.clientWidth}（overflow-x=${item.overflowX}）`,
    );
  }

  if (page === "/settings") {
    if (layout.tabs === null) {
      fail(page, width, '找不到设置页分区标签容器 [role="tablist"]');
    } else {
      for (const tab of layout.tabs.items) {
        if (tab.left < -EDGE_TOLERANCE || tab.right > layout.clientWidth + EDGE_TOLERANCE) {
          fail(
            page,
            width,
            `分区标签「${tab.label}」越界：left=${tab.left} right=${tab.right}（视口 0..${layout.clientWidth}）`,
          );
        }
      }
      if (layout.tabs.scrollWidth > layout.tabs.clientWidth + PAGE_TOLERANCE) {
        fail(
          page,
          width,
          `分区标签条仍有横向滚动：scrollWidth=${layout.tabs.scrollWidth} > clientWidth=${layout.tabs.clientWidth}（+${layout.tabs.scrollWidth - layout.tabs.clientWidth}px）`,
        );
      }
      if (layout.tabs.overflowX !== "visible") {
        fail(page, width, `分区标签条仍是横向滚动容器：overflow-x=${layout.tabs.overflowX}`);
      }
      // 需求：lg（1024）以上保持左侧竖排，以下允许换行
      if (width >= 1024) {
        if (layout.tabs.flexDirection !== "column" || layout.tabs.flexWrap !== "nowrap") {
          fail(
            page,
            width,
            `lg 下分区标签应为左侧竖排：flex-direction=${layout.tabs.flexDirection} flex-wrap=${layout.tabs.flexWrap}`,
          );
        }
      } else if (layout.tabs.flexDirection !== "row" || layout.tabs.flexWrap !== "wrap") {
        fail(
          page,
          width,
          `小于 lg 时分区标签应横排换行：flex-direction=${layout.tabs.flexDirection} flex-wrap=${layout.tabs.flexWrap}`,
        );
      }
    }
  }

  // 需求：窄宽度下顶部导航自然换行
  if (layout.navFlexWrap !== "wrap") {
    fail(page, width, `顶部导航没有换行能力：header nav flex-wrap=${layout.navFlexWrap}`);
  }

  for (const link of layout.nav) {
    if (link.right > layout.clientWidth + EDGE_TOLERANCE || link.left < -EDGE_TOLERANCE) {
      fail(
        page,
        width,
        `导航元素「${link.label}」越界：left=${link.left} right=${link.right}（视口 0..${layout.clientWidth}）`,
      );
    }
    if (link.clipped) {
      fail(page, width, `导航元素「${link.label}」文字被截断，未完整显示`);
    }
  }
}

/** 等字体、hydration 与两帧布局稳定。 */
async function settle(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

/** 登录态是异步读取的，导航里的占位「…」换成真实入口会让宽度变化。 */
async function waitForNavAuth(page, timeout = 10_000) {
  await page
    .waitForFunction(() => {
      const nav = document.querySelector("header nav");
      return nav !== null && !(nav.textContent ?? "").includes("…");
    }, { timeout })
    .catch(() => {
      // 超时也让后面的测量继续，布局断言本身会给出结论
    });
}

/**
 * 打开一个页面。单页预算 pageTimeout 同时管住 goto 与登录态等待：
 * fast 模式下 8s 内必须回来，超时记为失败并继续下一页，而不是卡住整个检查。
 */
async function gotoRoute(page, route, cfg) {
  const width = page.viewportSize()?.width ?? 0;
  const startedAt = Date.now();
  const pageLeft = () => cfg.pageTimeout - (Date.now() - startedAt);
  try {
    const response = await page.goto(`${ORIGIN}${route}`, {
      waitUntil: "load",
      timeout: Math.max(1_000, Math.min(pageLeft(), remainingBudget())),
    });
    if (response === null || !response.ok()) {
      fail(
        route,
        width,
        `页面未返回 2xx：status=${response === null ? "null" : response.status()} url=${page.url()}`,
      );
      return false;
    }
    await waitForNavAuth(
      page,
      Math.max(500, Math.min(cfg.navWait, pageLeft(), remainingBudget())),
    );
    await settle(page);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    fail(route, width, `页面加载超时或失败（单页预算 ${cfg.pageTimeout}ms）：${reason}`);
    return false;
  }
}

async function runWidthMatrix(context, cfg) {
  const page = await context.newPage();

  for (const route of cfg.routes) {
    currentStep = `${route}（加载）`;
    const before = failures.length;
    // 先在最大宽度加载，避免 dev 首次编译落在窄屏上
    await page.setViewportSize({ width: cfg.widths[0], height: VIEWPORT_HEIGHT });
    const loaded = await gotoRoute(page, route, cfg);
    if (!loaded) continue;

    for (const width of cfg.widths) {
      currentStep = `${route} @ ${width}px`;
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await settle(page);
      const layout = await page.evaluate(readLayout);
      checkLayout(route, width, layout);
    }

    if (failures.length === before) {
      console.log(`  ✓ ${route}（${cfg.widths.length} 个宽度）`);
    }
  }

  await page.close();
}

/** 长内容压测：120 字符无断点模型名（zoom-repro.md §4.3 / F5）。 */
async function runLongContentProbe(context, cfg) {
  const longModel = "m".repeat(120);
  const page = await context.newPage();
  await page.addInitScript(
    ({ model }) => {
      localStorage.setItem("alp.callmode.v1", "local");
      localStorage.setItem(
        "alp.provider.v1",
        JSON.stringify({
          mode: "local",
          label: "自定义",
          kind: "openai-compatible",
          baseUrl: "https://example.com/v1",
          apiKey: "sk-responsive-check",
          model,
          thinking: "off",
          thinkingStatus: "unknown",
          verification: true,
        }),
      );
    },
    { model: longModel },
  );

  for (const width of [853, 360]) {
    currentStep = `/settings(长内容) @ ${width}px`;
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    const response = await page.goto(`${ORIGIN}/settings`, {
      waitUntil: "load",
      timeout: clampToBudget(cfg.pageTimeout),
    });
    if (response === null || !response.ok()) {
      fail(
        "/settings(长内容)",
        width,
        `页面未返回 2xx：status=${response === null ? "null" : response.status()}`,
      );
      continue;
    }
    // 摘要行在挂载后才回显本机配置，等到长模型名真的出现在 DOM 里再量
    const rendered = await page
      .waitForFunction(
        (needle) =>
          (document.querySelector('[data-motion="status"]')?.textContent ?? "").includes(needle),
        longModel.slice(0, 40),
        { timeout: 15_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!rendered) {
      fail("/settings(长内容)", width, "本机配置摘要没有渲染出长模型名，压测场景无效");
      continue;
    }
    await settle(page);
    const layout = await page.evaluate(readLayout);
    const before = failures.length;
    checkLayout("/settings(长内容)", width, layout);
    for (const span of layout.statusSpans) {
      checks += 1;
      if (span.right > layout.clientWidth + EDGE_TOLERANCE || span.left < -EDGE_TOLERANCE) {
        fail(
          "/settings(长内容)",
          width,
          `状态摘要越界：「${span.text}」 left=${span.left} right=${span.right}（视口 0..${layout.clientWidth}）`,
        );
      }
    }
    if (failures.length === before) {
      console.log(`  ✓ /settings 长模型名（${width}px）`);
    }
  }

  await page.close();
}

async function main(cfg) {
  mode = cfg;
  currentStep = "检查端口";
  try {
    await assertPortFree();
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  // 整体预算从启动服务之前开始计，90s 包含启动与编译
  startWatchdog();

  console.log(
    `模式：${mode.name}（${mode.routes.length} 页 × ${mode.widths.length} 宽：${mode.widths.join(", ")}；` +
      `单页上限 ${mode.pageTimeout / 1000}s；整体预算 ${mode.totalBudget === null ? "不限" : `${mode.totalBudget / 1000}s`}）`,
  );
  console.log(`启动 dev server：npm run dev -- -p ${PORT}`);
  devServer = startDevServer();
  process.on("exit", stopDevServer);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      stopDevServer();
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }

  currentStep = "等待 dev server 就绪";
  try {
    await waitForServer(devServer, clampToBudget(mode.serverTimeout));
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    printServerLog();
    stopDevServer();
    stopWatchdog();
    process.exitCode = 1;
    return;
  }

  currentStep = "启动浏览器";
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.error(`✗ 浏览器启动失败：${error instanceof Error ? error.message : String(error)}`);
    printServerLog();
    stopDevServer();
    stopWatchdog();
    process.exitCode = 1;
    return;
  }

  try {
    const context = await browser.newContext({
      viewport: { width: mode.widths[0], height: VIEWPORT_HEIGHT },
      reducedMotion: "reduce",
      locale: "zh-CN",
      deviceScaleFactor: 1,
    });

    console.log(
      `\n宽度矩阵：${mode.routes.length} 页 × ${mode.widths.length} 宽（${mode.widths.join(", ")}）`,
    );
    await runWidthMatrix(context, mode);

    if (mode.longContentProbe) {
      console.log("\n长内容压测：/settings 写入 120 字符无断点模型名");
      await runLongContentProbe(context, mode);
    }

    await context.close();
  } finally {
    await browser.close();
    browser = null;
    stopDevServer();
    stopWatchdog();
  }

  currentStep = "汇总";
  console.log(`\n共 ${checks} 项断言`);
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} 项失败`);
    if (serverLog.length > 0) printServerLog();
    process.exitCode = 1;
  } else {
    console.log("✓ 全部通过");
    process.exitCode = 0;
  }
}

await main(parseArgs(process.argv));
