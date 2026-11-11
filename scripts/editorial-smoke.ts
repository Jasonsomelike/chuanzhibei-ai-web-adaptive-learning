/** Isolated browser QA for the editorial workspace; never visits a deployed service. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
  await page.setViewportSize({ width:1487,height:1058 });
  await go("/directions");
  await page.locator(".course-row").first().waitFor();
  check(await page.locator(".course-row").count() === 4, "匿名可浏览真实课程目录");
  await page.getByRole("button", {name:`查看全部 ${SUBJECTS.length} 门课程`,exact:true}).click();
  check(await page.locator(".course-row").count() === SUBJECTS.length, "全部内置课程可展开");
  await page.getByRole("searchbox", {name:"搜索课程",exact:true}).fill("机器学习");
  check(await page.locator(".course-row").count() === 1 && (await page.locator(".course-row-actions a").first().getAttribute("href"))?.includes("machine-learning"), "课程搜索进入对应真实图谱");
  await page.getByRole("searchbox", {name:"搜索课程",exact:true}).fill("");
  await page.getByRole("button", {name:"收起课程",exact:true}).click();
  await page.evaluate(() => window.scrollTo(0,0));
  await page.screenshot({path:join(output,"courses-desktop.png")});
  await page.getByRole("link", {name:"阅读教材",exact:true}).click();
  await page.getByRole("dialog", {name:"课程学习材料",exact:true}).waitFor();
  check(await page.getByRole("tab", {name:"教材阅读",exact:true}).getAttribute("aria-selected") === "true", "课程目录可直达按需教材阅读");
  await page.keyboard.press("Escape");
  await go("/diagnose?subject=data-structures&kc=c09");
  await page.locator(".question-option").first().waitFor();
  check(await page.getByLabel("当前学习目标", {exact:true}).inputValue() === "data-structures", "诊断首屏可直接切换课程");
  await page.locator('input[name="answer"]').first().check();
  await page.locator('[data-answer-state="selected"]').waitFor();
  const selectionStyle = await page.locator('[data-answer-state="selected"]').evaluate(el => {
    const color = getComputedStyle(document.documentElement).getPropertyValue("--warn-soft").trim().slice(1);
    const expected = `rgb(${[0,2,4].map(index => parseInt(color.slice(index,index+2),16)).join(", ")})`;
    return { background:getComputedStyle(el).backgroundColor,expected,checked:el.querySelector("input")?.checked };
  });
  check(selectionStyle.background === selectionStyle.expected && selectionStyle.checked, `选中答案使用独立的琥珀色，提交前不暗示对错 ${JSON.stringify(selectionStyle)}`);
  await page.screenshot({path:join(output,"diagnose-desktop.png")});
  await page.getByRole("button", {name:"提交答案",exact:true}).click();
  await page.locator("[data-answer-feedback]").waitFor();
  check(await page.locator('[data-answer-state="correct"]').evaluate(el => getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)"), "诊断核对后的正确选项保留状态底色");
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:join(output,"diagnose-phone.png")});
  await go("/directions"); await page.locator(".course-row").first().waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "手机课程目录完整适配");
  await page.screenshot({path:join(output,"courses-phone.png")});
  await page.setViewportSize({width:1487,height:1058});
  await go("/guide");
  await page.locator('.guide-journey[aria-busy="false"]').waitFor();
  const previewEvidence = await page.evaluate(() => localStorage.getItem("alp.learner.v2"));
  await page.screenshot({path:join(output,"guide-desktop.png")});
  await page.locator('.guide-preview input[type="radio"]').first().check();
  await page.getByRole("button", {name:"试做这道题",exact:true}).click();
  await page.locator(".guide-preview-feedback").waitFor();
  check(previewEvidence === await page.evaluate(() => localStorage.getItem("alp.learner.v2")), "指南实际试做与解析不会写入学习记录");
  await page.getByRole("tab", {name:/先了解自己/}).press("End");
  check(await page.getByRole("tab", {name:/学懂，再验证/}).getAttribute("aria-selected") === "true", "指南阶段支持键盘切换");
  await page.getByRole("navigation", {name:"使用指南目录",exact:true}).getByRole("link", {name:"管理会话与分支",exact:true}).click();
  await page.waitForFunction(() => document.querySelector('.document-nav a[aria-current="location"]')?.getAttribute("href") === "#sessions");
  check(new URL(page.url()).hash === "#sessions", "指南目录定位会话管理说明并标记当前章节");
  await go("/about");
  await page.screenshot({path:join(output,"about-desktop.png")});
  await page.getByRole("navigation", {name:"关于项目目录",exact:true}).getByRole("link", {name:"Agent 编排",exact:true}).click();
  check(await page.locator(".about-agent-branches article").count() === 3 && await page.locator(".about-supervisor").isVisible(), "关于页呈现现有 Supervisor 与三个教学子流程");

  // Only this browser receives fixtures. Nothing is inserted into the real market.
  let marketState: "empty" | "error" | "list" = "empty";
  await page.route("**/api/directions?scope=market**", route => {
    const directions = marketState === "list" ? [
      {id:"qa-structures",title:"线性结构复习",description:"线性表、栈与队列",subjectId:"data-structures",conceptCount:3,edgeCount:2,updatedAt:"2026-11-11"},
      {id:"qa-networks",title:"计算机网络复习",description:"协议与网络分层",subjectId:"network",conceptCount:4,edgeCount:3,updatedAt:"2026-11-11"},
    ] : [];
    return route.fulfill({status:marketState === "error" ? 503 : 200,contentType:"application/json",body:JSON.stringify({directions})});
  });
  await go("/market");
  await page.getByRole("heading", {name:"还没有公开的学习方向",exact:true}).waitFor();
  await page.screenshot({path:join(output,"market-desktop.png")});
  check(await page.getByRole("link", {name:"创建学习方向",exact:true}).isVisible(), "课程探索空态提供创建与现有课程入口");
  marketState = "error";
  await page.getByRole("button", {name:"搜索",exact:true}).click();
  await page.getByRole("heading", {name:"公开课程暂时无法读取",exact:true}).waitFor();
  check(await page.getByRole("button", {name:"重试",exact:true}).isVisible(), "课程探索读取失败提供明确重试");
  marketState = "list";
  await page.getByRole("button", {name:"重试",exact:true}).click();
  await page.locator(".market-results article").first().waitFor();
  check(await page.locator(".market-results article").count() === 2, "课程探索重试恢复结果列表");
  await page.getByRole("combobox", {name:"筛选课程",exact:true}).selectOption("data-structures");
  check(await page.locator(".market-results article").count() === 1 && (await page.locator(".market-results").innerText()).includes("线性结构复习"), "课程筛选只显示匹配方向");
  await page.getByRole("button", {name:"加入我的课程",exact:true}).click();
  check(await page.locator(".market-notice").getByRole("link", {name:"登录",exact:true}).isVisible(), "匿名加入公开方向时保留明确登录入口");
  for (const width of [853,390,360]) {
    await page.setViewportSize({width,height:width < 768 ? 844 : 1058});
    for (const route of ["/market","/login","/guide","/about"]) {
      await go(route);
      if (route === "/guide") await page.locator('.guide-journey[aria-busy="false"]').waitFor();
      if (route === "/market") await page.locator('.market-results article').first().waitFor();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route}在${width}px完整适配`);
      if (width === 390) await page.screenshot({path:join(output,`${route.slice(1)}-phone.png`)});
    }
  }
  await page.unroute("**/api/directions?scope=market**");
  const screens = [
    ["home","/"], ["path","/path?subject=data-structures&targets=c09&budget=60&kc=c09"],
    ["diagnose","/diagnose?subject=data-structures&kc=c09"], ["tutor","/tutor?subject=data-structures"],
    ["courses","/directions"], ["market","/market"], ["settings","/settings?panel=appearance"],
    ["guide","/guide"], ["about","/about"], ["login","/login"],
  ];
  for (const [layout, label] of [["paper","导览"],["atlas","地图"],["chapters","章节"]]) {
    await page.setViewportSize({width:1487,height:1058});
    await go("/settings?panel=appearance"); await chooseLayout(label,layout);
    for (const width of [1487,853,768,390,360]) {
      await page.setViewportSize({width,height:width < 769 ? 844 : 1058});
      for (const [name,route] of screens) {
        await go(route);
        if (name === "home") await page.locator(".overview-primary").waitFor();
        if (name === "path") await graphReady();
        if (name === "diagnose") await page.locator('.diagnostic-page[aria-busy="false"]').waitFor();
        if (name === "tutor") await page.locator("#q").waitFor();
        if (name === "guide") await page.locator('.guide-journey[aria-busy="false"]').waitFor();
        if (name === "market") await page.locator('section[aria-label="公开学习方向"][aria-busy="false"]').waitFor();
        if (name === "path" && width === 390) {
          await page.waitForFunction(() => {
            const canvas = document.querySelector(".knowledge-canvas")!.getBoundingClientRect();
            return [...document.querySelectorAll(".knowledge-node .concept-label")].every(label => {
              const rect = label.getBoundingClientRect();
              return rect.left >= canvas.left && rect.right <= canvas.right && rect.top >= canvas.top && rect.bottom <= canvas.bottom;
            });
          });
          check(true, `${layout}手机图谱显示完整邻接节点名称`);
        }
        const clipped = await page.locator('main input:not([type="radio"]):not([type="checkbox"]):not([type="file"]), main select, main textarea, .shell-nav-link, .shell-mobile-settings').evaluateAll(controls => controls.filter(control => {
          const rect = control.getBoundingClientRect();
          if (rect.width < 5 || rect.height < 5 || getComputedStyle(control).visibility === "hidden") return false;
          // Horizontal scrollers intentionally expose their contents by scrolling.
          let parent = control.parentElement;
          while (parent && parent !== document.body) {
            if (["auto","scroll"].includes(getComputedStyle(parent).overflowX)) return false;
            parent = parent.parentElement;
          }
          return rect.left < -1 || rect.right > innerWidth + 1;
        }).map(control => control.getAttribute("aria-label") ?? control.textContent?.slice(0,25) ?? control.tagName));
        check(clipped.length === 0, `${layout} ${name} ${width}px主要输入与导航完整可达 ${clipped.join(",")}`);
        if (width < 769) check(await page.locator(".shell-wordmark").isVisible() && await page.locator(".mobile-learning-nav a").count() === 5, `${layout} ${name} ${width}px保留品牌与五个手机入口`);
        if ((layout === "atlas" && [1487,390].includes(width)) || (name === "path" && [1487,390].includes(width))) await page.screenshot({path:join(output,`final-${name}-${layout}-${width}.png`)});
        if (name === "path" && width === 390) {
          await page.getByRole("group", {name:"图谱与学习清单",exact:true}).getByRole("button", {name:"学习清单",exact:true}).click();
          check(!await page.locator(".knowledge-canvas").isVisible(), `${layout}手机可切换到学习清单`);
          await page.getByRole("region", {name:"本次学习顺序",exact:true}).getByRole("button").first().click();
          await page.waitForFunction(() => document.querySelector('.react-flow__node.selected')?.getAttribute("data-id") === "c01" && document.querySelector(".knowledge-canvas")!.getBoundingClientRect().height > 0);
          check(true, `${layout}手机清单选择返回图谱并定位同一知识点`);
        }
      }
    }
  }
  await page.setViewportSize({width:1487,height:1058});
  await go("/settings?panel=appearance"); await chooseLayout("地图","atlas");
  await go("/path?subject=data-structures&kc=c09"); await graphReady();
  await page.locator(".knowledge-actions").getByRole("link", {name:"阅读教材",exact:true}).click();
  await page.getByRole("dialog", {name:"课程学习材料",exact:true}).waitFor();
  check(true, "图谱知识点的阅读教材入口直接打开材料抽屉");
  await page.keyboard.press("Escape");
  await go("/login?next=%2Fdirections%3Fcreate%3D1");
  await page.screenshot({path:join(output,"login-desktop.png")});
  await page.getByRole("button", {name:"注册",exact:true}).click();
  const email = `course-${Date.now()}@test.local`;
  const password = `T3-${randomBytes(24).toString("base64url")}`;
  await page.getByLabel("昵称", {exact:true}).fill("课程回归");
  await page.getByLabel("邮箱", {exact:true}).fill(email);
  await page.getByLabel("密码", {exact:true}).fill(password);
  await page.getByLabel("确认密码", {exact:true}).fill(password + "x");
  check(!await page.locator(".login-submit").isEnabled() && await page.getByText("两次输入的密码不一致。", {exact:true}).isVisible(), "注册确认密码不一致时阻止提交并说明原因");
  await page.getByLabel("确认密码", {exact:true}).fill(password);
  await page.locator(".login-submit").click();
  await page.waitForURL("**/directions?create=1");
  await page.locator("#course-create[open]").waitFor();
  check(true, "实际注册成功后返回原创建入口并展开表单");
  await context.request.post(`${base}/api/auth`, {headers:{Origin:base},data:{action:"logout"}});
  await go("/login?next=%2F%2Fexample.invalid");
  await page.getByLabel("邮箱", {exact:true}).fill(email);
  await page.getByLabel("密码", {exact:true}).fill(password);
  await page.locator(".login-submit").click();
  await page.waitForURL(`${base}/`);
  check(true, "实际登录拒绝外部返回地址，回到学习概览");
  await page.setViewportSize({width:1487,height:1058}); await go("/directions");
  await page.getByRole("button", {name:"创建学习方向",exact:true}).click();
  await page.locator("#course-create textarea").fill("我想学习数据结构中的栈和队列，从线性表基础到常用操作");
  await page.getByRole("button", {name:"生成方向",exact:true}).click();
  await page.getByLabel("方向名", {exact:true}).waitFor();
  await page.getByRole("button", {name:"保存这个方向",exact:true}).click();
  await page.locator('[data-motion="direction"]').first().waitFor();
  check(await page.locator('[data-motion="direction"]').getByRole("link", {name:"查看路径",exact:true}).isVisible(), "自定义方向通过实际创建入口生成、保存并进入图谱");
  await page.locator("#course-create > summary").click();
  await page.screenshot({path:join(output,"courses-account-desktop.png")});
  check(errors.length === 0, `无浏览器运行错误：${errors.join("; ")}`);
  await writeFile(join(output, "results.json"), JSON.stringify({ checks, errors, output }, null, 2));
  console.log(`${checks} 项通过。截图：${output}`);
} catch (error) { await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => undefined); throw error; }
finally { await browser.close(); }
