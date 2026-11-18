/** Real geometry and input tests against an isolated local production server. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
const base = process.env.BASE_URL ?? "http://localhost:3218";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = await mkdtemp(join(tmpdir(), "alp-workspace-"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 1000 }, reducedMotion: "reduce" });
page.setDefaultTimeout(15000);
const errors: string[] = [];
page.on("pageerror", e => errors.push(e.message));
let checks = 0;
const check = (value: unknown, label: string) => { assert(value, label); checks++; console.log(`PASS ${label}`); };
try {
  for (const width of [1480, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${base}/path?subject=network&budget=90`);
    const graph = page.locator(".knowledge-canvas");
    await graph.locator(".react-flow__edge-path").first().waitFor();
    if (width === 390) await page.locator('.knowledge-workspace[data-compact="true"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".react-flow__edge-path[d*='C']"));
    const gaps = await graph.evaluate((canvas, vertical) => {
      const boxes = [...canvas.querySelectorAll(".knowledge-node")].map(el => el.getBoundingClientRect());
      return [...canvas.querySelectorAll<SVGPathElement>(".react-flow__edge-path")].filter(edge => {
        const matrix = edge.getScreenCTM()!;
        return [0, edge.getTotalLength()].some((distance, end) => {
          const point = edge.getPointAtLength(distance).matrixTransform(matrix);
          return !boxes.some(box => {
            const x = vertical ? box.left + box.width / 2 : end ? box.left : box.right;
            const y = vertical ? (end ? box.top : box.bottom) : box.top + box.height / 2;
            return Math.hypot(x - point.x, y - point.y) < 1;
          });
        });
      }).map(edge => edge.id);
    }, width === 390);
    check(!gaps.length, `${width}px 计算机网络图谱每条线的两端贴合节点边界：${gaps.join(",")}`);
    await graph.screenshot({ path: join(output, `network-${width}.png`) });
  }
  await page.setViewportSize({ width: 1480, height: 1000 });
  await page.goto(`${base}/path?subject=data-structures&budget=60`);
  await page.locator(".react-flow__edge path.react-flow__edge-path").first().waitFor();
  for (const all of [false, true]) {
    if (all) await page.getByRole("button", { name: "全科关系", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0);
    const collisions = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll(".knowledge-node")].map(el => ({ id: el.closest(".react-flow__node")?.getAttribute("data-id"), box: el.getBoundingClientRect() }));
      const failures: string[] = [];
      for (const [i,a] of nodes.entries()) for (const b of nodes.slice(i+1)) if (a.box.left < b.box.right - .5 && a.box.right > b.box.left + .5 && a.box.top < b.box.bottom - .5 && a.box.bottom > b.box.top + .5) failures.push(`${a.id}/${b.id}`);
      // SVG points transformed to browser pixels, including React Flow's zoom/pan.
      for (const edge of document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")) {
        const matrix = edge.getScreenCTM(); if (!matrix) continue;
        const length = edge.getTotalLength();
        for (let d = 2; d < length - 2; d += 4) {
          const raw = edge.getPointAtLength(d), p = new DOMPoint(raw.x, raw.y).matrixTransform(matrix);
          if (nodes.some(n => p.x > n.box.left + 1 && p.x < n.box.right - 1 && p.y > n.box.top + 1 && p.y < n.box.bottom - 1)) { failures.push(edge.id); break; }
        }
      }
      return failures;
    });
    check(collisions.length === 0, `${all ? "全科" : "路径"}图谱 DOM 节点无重叠、连线不穿越文字框：${collisions.join(",")}`);
  }
  await page.getByRole("button", { name: "当前路径", exact: true }).click();
  const row = page.locator(".knowledge-sequence li button").nth(1);
  const kc = await row.locator("..").getAttribute("data-kc");
  await row.click();
  await page.waitForFunction(id => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.classList.contains("selected"), kc);
  check(await row.getAttribute("aria-pressed") === "true", "清单选择同步图谱、详情和学习入口");
  await page.screenshot({ path: join(output, "graph-desktop.png") });
  await page.goto(`${base}/tutor?subject=data-structures`);
  await page.locator('.tutor-resizable[data-split="wide"]').waitFor();
  await page.locator('[aria-label="辅导消息"][aria-busy="false"]').waitFor();
  const history = page.locator("#tutor-history"), stage = page.locator("#tutor-conversation");
  const width = async () => (await history.boundingBox())!.width;
  check(Math.abs(await width() - 292) < 2, "历史栏默认 292px");
  const handle = page.getByRole("separator", { name: "调整历史会话栏宽度" });
  await page.locator("#q").fill("保留这段未发送的问题");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width/2, box.y + 150);
  await page.mouse.down(); await page.mouse.move(box.x + 110, box.y + 150, { steps: 12 }); await page.mouse.up();
  check(await width() > 350 && await width() <= 480 && (await stage.boundingBox())!.width >= 599, "鼠标调整分栏并保留聊天最小宽度");
  const dragged = await width();
  check(await page.locator("#q").inputValue() === "保留这段未发送的问题", "拖动分栏不会重建对话或清空输入");
  await handle.focus(); await page.keyboard.press("ArrowLeft");
  check(await width() < dragged, "分隔条支持键盘方向键");
  const remembered = await width();
  await page.waitForFunction(expected => Math.abs(Number(localStorage.getItem("alp.tutor.history-width")) - expected) < 2, remembered);
  await page.reload(); await page.locator('.tutor-resizable[data-split="wide"]').waitFor();
  await page.waitForFunction(expected => Math.abs(document.querySelector("#tutor-history")!.getBoundingClientRect().width - expected) < 2, remembered);
  check(true, "刷新后恢复历史栏宽度");
  await handle.dblclick();
  check(Math.abs(await width() - 292) < 2, "双击恢复默认宽度");
  const before = (await page.locator("#q").boundingBox())!.height;
  await page.locator("#q").fill("多行问题\n".repeat(12));
  check((await page.locator("#q").boundingBox())!.height > before && (await page.locator("#q").boundingBox())!.height <= 181, "输入框随内容增长并限制最大高度");
  await page.screenshot({ path: join(output, "tutor-desktop.png") });
  for (const w of [1024, 853, 390]) {
    await page.setViewportSize({ width: w, height: 844 });
    if (w < 1024) {
      await page.locator('.tutor-resizable[data-split="drawer"]').waitFor();
      await page.getByRole("button", { name: "打开历史会话", exact: true }).click();
      await page.getByRole("dialog", { name: "历史会话", exact: true }).waitFor();
      await page.keyboard.press("Escape");
    }
    check(await page.locator("#q").inputValue() === "多行问题\n".repeat(12), `${w}px 切换布局保持未发送输入`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px 导师无横向溢出`);
    if (w === 390) {
      const geometry = await page.evaluate(() => {
        const send = [...document.querySelectorAll("button")].find(el => el.textContent?.trim() === "发送")!.getBoundingClientRect();
        const nav = document.querySelector(".mobile-learning-nav")!.getBoundingClientRect();
        return { sendBottom: send.bottom, navTop: nav.top, navHeight: nav.height };
      });
      check(geometry.sendBottom <= geometry.navTop && geometry.navHeight < 80, `手机发送按钮在导航上方，六个入口单行排列：${JSON.stringify(geometry)}`);
    }
  }
  await page.screenshot({ path: join(output, "tutor-mobile.png") });
  await page.setViewportSize({ width: 1480, height: 1000 });
  await page.locator('.tutor-resizable[data-split="wide"]').waitFor();
  check(Math.abs(await width() - 292) < 2, "回到桌面恢复偏好，窄屏不覆盖保存值");
  check(errors.length === 0, `无浏览器运行异常：${errors.join("; ")}`);
  console.log(`${checks} 项通过；截图：${output}`);
} finally { await browser.close(); }
