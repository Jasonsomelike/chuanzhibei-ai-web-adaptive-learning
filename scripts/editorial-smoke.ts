/** Isolated browser QA for the editorial workspace; never visits a deployed service. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SUBJECTS } from "../src/data/subjects/index";

const base = process.env.BASE_URL ?? "http://localhost:3220";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = process.env.QA_OUTPUT_DIR ?? join(tmpdir(), `alp-editorial-${Date.now()}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1487, height: 1058 }, reducedMotion: "reduce" });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
let checks = 0;
function check(value: unknown, name: string) { assert(value, name); checks++; console.log(`PASS ${name}`); }
async function go(path: string) { const response = await page.goto(`${base}${path}`); assert(response?.ok()); }
async function rootIs(key: string, value: string) { await page.waitForFunction(([key, value]) => document.documentElement.dataset[key] === value, [key, value]); }
async function chooseLayout(name: string, id: string) { await page.getByRole("button", { name: new RegExp(`${name}布局示意`) }).click(); await rootIs("layout", id); }
async function graphReady() { await page.waitForFunction(() => { const paths = [...document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")]; return paths.length > 0 && paths.every(path => path.getTotalLength() > 0 && getComputedStyle(path).stroke !== "none") && document.querySelectorAll(".react-flow__node").length > 0; }); }
async function graphIsReal() {
  const state = await page.evaluate(() => ({ ids: [...document.querySelectorAll(".react-flow__node")].map(el => el.getAttribute("data-id")!), edges: [...document.querySelectorAll(".react-flow__edge")].map(el => el.getAttribute("data-id")), selected: document.querySelector(".react-flow__node.selected")?.getAttribute("data-id"), width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  const expected = SUBJECTS[0].graph.edges.filter(edge => state.ids.includes(edge.before) && state.ids.includes(edge.after)).map(edge => `${edge.before}-${edge.after}`).sort();
  assert.deepEqual(state.edges.sort(), expected);
  check(state.edges.length > 0 && state.width <= state.client, "可见连线与真实先修边一致且页面不溢出");
  return state;
}

try {
  await go("/");
  await page.locator(".overview-primary").waitFor();
  check(await page.locator("html").getAttribute("data-layout") === "atlas" && await page.locator("html").getAttribute("data-theme") === "olive", "新浏览器默认地图布局与橄榄主题");
  check(await page.locator("canvas.knowledge-contour").count() === 0, "概览移除装饰图谱 Canvas");
  await page.screenshot({ path: join(output, "home-1487.png") });
  await go("/path?subject=data-structures&targets=c09&budget=60&kc=c09");
  await graphReady();
  const initial = await graphIsReal();
  check(initial.selected === "c09", "初始定位、图谱节点与选中详情一致");
  await page.screenshot({ path: join(output, "path-atlas-1487.png") });
  const unchangedEvidence = await page.evaluate(() => localStorage.getItem("alp.learner.v2"));
  await page.getByLabel("本次学习预算", { exact: true }).selectOption("90");
  await page.waitForFunction(() => document.querySelector("[data-path-summary]")?.textContent?.includes("相比 60"));
  await page.getByRole("region", { name: "本次学习顺序", exact: true }).getByRole("button", { name: /3 顺序表/ }).click();
  await page.waitForFunction(() => document.querySelector('.react-flow__node[data-id="c05"]')?.classList.contains("selected"));
  await go("/settings?panel=appearance");
  await chooseLayout("导览", "paper");
  await page.getByRole("button", { name: "深蓝", exact: true }).click(); await rootIs("theme", "indigo");
  check(await page.locator("html").getAttribute("data-layout") === "paper", "换配色不会改变导览布局");
  await page.reload(); await rootIs("layout", "paper"); await rootIs("theme", "indigo");
  check(true, "布局与主题刷新后独立恢复");
  await page.getByRole("button", { name: "橄榄", exact: true }).click(); await rootIs("theme", "olive");
  await go("/path"); await graphReady();
  check(await page.getByLabel("本次学习预算", { exact: true }).inputValue() === "90" && (await graphIsReal()).selected === "c05", "从设置返回保留预算与选中知识点");
  check((await page.locator(".path-goal-caption").innerText()).includes("栈"), "从设置返回保留原学习目标范围");
  for (const [id, name] of [["paper", "导览"], ["atlas", "地图"], ["chapters", "章节"]]) {
    await go("/settings?panel=appearance"); await chooseLayout(name, id);
    await page.screenshot({ path: join(output, `settings-${id}-1487.png`) });
    await go("/path?subject=data-structures&targets=c09&budget=60&kc=c09"); await graphReady();
    const state = await graphIsReal(); check(state.selected === "c09", `${name}布局保持相同选中知识点`);
    await page.screenshot({ path: join(output, `path-${id}-1487.png`) });
    await page.getByRole("combobox", { name: "搜索知识点", exact: true }).fill("队列");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('.react-flow__node[data-id="c10"]')?.classList.contains("selected"));
    check((await page.locator(".concept-detail-heading h2").innerText()) === "队列", `${name}搜索与键盘选择更新真实详情`);
  }
  for (const [theme, label] of [["olive", "橄榄"], ["sand", "暖砂"], ["forest", "森林"], ["indigo", "深蓝"], ["violet", "紫罗兰"], ["contrast", "高对比"]]) for (const [mode, name] of [["light", "浅色"], ["dark", "深色"]]) {
    await go("/settings?panel=appearance");
    await page.getByRole("button", { name: label, exact: true }).click(); await rootIs("theme", theme);
    await page.getByRole("button", { name, exact: true }).click(); await rootIs("mode", mode);
    const contrast = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return ["--ink", "--ink-soft", "--ink-faint"].map(token => {
        const [foreground, background] = [token, "--canvas"].map(value => {
          const raw = root.getPropertyValue(value).trim().replace("#", "");
          const color = raw.length === 3 ? raw.split("").map(char => char + char).join("") : raw;
          const [r,g,b] = [0,2,4].map(i => parseInt(color.slice(i,i+2),16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
          return .2126*r + .7152*g + .0722*b;
        });
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      });
    });
    check(contrast.every(ratio => ratio >= 4.5), `${label}${name}正文与辅助文字对比度达标`);
  }
  await go("/settings?panel=appearance"); await chooseLayout("地图", "atlas");
  await page.getByRole("button", { name: "橄榄", exact: true }).click(); await rootIs("theme", "olive");
  await page.getByRole("button", { name: "浅色", exact: true }).click(); await rootIs("mode", "light");
  await page.getByLabel("减少动态效果", { exact: true }).check(); await rootIs("reducedMotion", "true");
  await page.reload(); await rootIs("reducedMotion", "true"); check(true, "减少动效偏好刷新后恢复");
  for (const width of [853, 390, 360]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1058 });
    for (const route of ["/", "/settings?panel=appearance", "/path?subject=data-structures&targets=c09&budget=60&kc=c09"]) {
      await go(route);
      if (route.startsWith("/path")) await graphReady();
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      check(fits, `${route}在${width}px无页面横向溢出`);
      if (width === 390) {
        check(await page.getByRole("link", { name: "设置中心", exact: true }).isVisible(), "手机可直接进入设置");
        check(await page.locator(".mobile-learning-nav a").count() === 5, "手机具有五个完整导航入口");
        await page.screenshot({ path: join(output, `${route.startsWith("/path") ? "path" : route.startsWith("/settings") ? "settings" : "home"}-390.png`) });
      }
    }
  }
  check(unchangedEvidence === await page.evaluate(() => localStorage.getItem("alp.learner.v2")), "布局、配色与图谱导航不改写作答证据");
  check(errors.length === 0, `无浏览器运行错误：${errors.join("; ")}`);
  await writeFile(join(output, "results.json"), JSON.stringify({ checks, errors, output }, null, 2));
  console.log(`${checks} 项通过。截图：${output}`);
} catch (error) { await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => undefined); throw error; }
finally { await browser.close(); }
