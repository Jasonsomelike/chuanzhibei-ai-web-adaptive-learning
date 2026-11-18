import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = "https://chuanzhi.jasonsome.cn";
const out = fileURLToPath(new URL("../out/final-20261118/raw/", import.meta.url));
const part = process.argv[2];
const email = process.env.DEMO_EMAIL;
const password = process.env.DEMO_PASSWORD;
if (!email || !password) throw new Error("Set DEMO_EMAIL and DEMO_PASSWORD in this process.");
const browser = await chromium.launch({ headless: true, args: ["--hide-scrollbars"] });
const size = { width: 1920, height: 1080 };
const context = await browser.newContext({ viewport: size, reducedMotion: "reduce", locale: "zh-CN" });
const page = await context.newPage();
page.setDefaultTimeout(9000);
const ui = (name, view = page) => view.getByRole("button", { name, exact: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const bound = async (page, url) => {
  await page.goto(base + url, { waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor();
  await page.evaluate(() => document.fonts.ready);
};
const screenshot = async (name, view = page) => view.screenshot({ path: path.join(out, name + ".png"), type: "png" });

async function roll(name, action, view = page, { pointer = true, lead = 850, tail = 1750 } = {}) {
  const output = path.join(out, name + ".webm");
  await view.screencast.start({ path: output, size: view.viewportSize(), quality: 95, fps: 30 });
  if (pointer) await view.screencast.showActions({ cursor: "pointer", duration: 460, position: "none" }).catch(() => {});
  try {
    await pause(lead);
    await action();
    await pause(tail);
  } finally {
    await view.screencast.hideActions().catch(() => {});
    await view.screencast.stop();
  }
  await screenshot(name, view);
  console.log("录成", name);
}

async function auth(ctx = context) {
  const result = await ctx.request.post(base + "/api/auth", { headers: { Origin: base }, data: { action: "login", email, password } });
  if (!result.ok()) throw new Error("演示账号登录失败 HTTP " + result.status());
}

async function login() {
  await bound(page, "/login");
  const submit = page.locator(".login-submit");
  await submit.waitFor();
  await pause(1400);
  await screenshot("open");
  await roll("login", async () => {
    await page.getByLabel("邮箱", { exact: true }).fill(email);
    const field = page.getByLabel("密码", { exact: true });
    if (await field.getAttribute("type") !== "password") throw new Error("密码输入框不是掩码类型");
    await field.fill(password);
    await pause(1200);
    await submit.click();
    await page.waitForURL(base + "/", { timeout: 24000 });
    await page.getByRole("heading", { name: "学习概览", exact: true }).waitFor();
    const goal = page.getByLabel("当前学习目标").first();
    if (await goal.isVisible()) await goal.selectOption("data-structures");
  }, page, { pointer: false });
}

async function diagnose() {
  await bound(page, "/diagnose?subject=data-structures&kc=c09");
  const option = page.locator(".question-option").first();
  await option.waitFor();
  await roll("diagnose", async () => {
    await option.scrollIntoViewIfNeeded();
    await pause(2800);
    await option.click();
    await pause(1000);
    await ui("提交答案").click();
    await page.locator("[data-answer-feedback]").waitFor();
  });
  const feedback = page.locator("[data-answer-feedback]");
  await roll("feedback", async () => {
    await feedback.scrollIntoViewIfNeeded();
    await pause(2100);
  });
}

async function setChapter() {
  await page.getByRole("button", { name: /^教材章节 ·/ }).click();
  const dialog = page.getByRole("dialog", { name: "教材章节" });
  await dialog.waitFor();
  const chapter = dialog.getByRole("checkbox", { name: /栈与队列/ });
  if (await chapter.count()) {
    if (await chapter.isChecked()) await chapter.uncheck();
    await chapter.check();
  } else {
    await dialog.getByText(/第\s*3\s*章\s*栈与队列/).first().click();
  }
  await pause(850);
  await page.keyboard.press("Escape");
}

async function graph() {
  await bound(page, "/path?subject=data-structures&budget=30");
  const map = page.locator(".knowledge-canvas");
  if (!await map.isVisible()) {
    const expand = ui("展开先修图谱");
    if (await expand.isVisible()) await expand.click();
  }
  await map.waitFor();
  const node = id => map.locator('.react-flow__node[data-id="' + id + '"]');
  if (!await node("c05").count() || !await node("c09").count() || !await node("c10").count()) {
    await ui("全科关系").click();
  }
  await node("c05").waitFor();
  await roll("nodes", async () => {
    for (const id of ["c05", "c09", "c10"]) {
      await node(id).click({ force: true });
      await pause(2600);
      await screenshot("node-" + id);
    }
  });
  // The same browser and course preserve the diagnosis while only the time budget changes.
  const budget = page.getByLabel("本次学习预算", { exact: true });
  await roll("budget30", async () => {
    await page.evaluate(() => scrollTo(0, 0));
    await setChapter();
    await budget.selectOption("30");
    await pause(1200);
  });
  console.log("30 分钟", (await page.locator("[data-path-summary]").innerText()).trim());
  await roll("budget60", async () => {
    await pause(1400);
    await budget.selectOption("60");
    await pause(3500);
  });
  console.log("60 分钟", (await page.locator("[data-path-summary]").innerText()).trim());
  await roll("estimate", async () => {
    const how = page.getByText("用时如何估算", { exact: true });
    await how.click();
    await how.scrollIntoViewIfNeeded();
    const wrap = how.locator("..");
    const stack = wrap.getByText("栈", { exact: true }).first();
    if (await stack.count()) await stack.scrollIntoViewIfNeeded();
    await pause(1900);
  });
}

async function tutor() {
  await bound(page, "/tutor?subject=data-structures&kc=c09");
  const q = page.locator("#q");
  await q.waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="辅导消息"]')?.getAttribute("aria-busy") === "false");
  const full = ui("3 · 完整讲解");
  if (await full.isVisible()) await full.click();
  const question = "为什么两个栈能实现队列？请以教材中的栈和队列定义为依据，给出入队、出队的具体例子，并标注知识点引用。";
  await roll("tutor_question", async () => {
    await q.fill(question);
    await pause(1100);
    await ui("发送").click();
  });
  const citation = page.getByRole("button", { name: /查看知识点 c(?:09|10) 的引用原文/ }).last();
  try {
    await citation.waitFor({ timeout: 110000 });
    await roll("tutor_source", async () => {
      await citation.click();
      await page.getByRole("region", { name: "回答引用原文" }).waitFor();
    });
  } catch {
    await roll("tutor_source", async () => {
      await ui("教材与引用").click();
      await page.getByRole("dialog", { name: "课程学习材料" }).waitFor();
      await page.getByRole("tab", { name: "教材阅读" }).click();
    });
    console.log("导师教材抽屉已录，回答引用未出现");
  }
  const mobile = await browser.newContext({ viewport: { width: 430, height: 930 }, locale: "zh-CN", isMobile: true, hasTouch: true });
  await auth(mobile);
  const phone = await mobile.newPage();
  await bound(phone, "/tutor?subject=data-structures&kc=c09");
  await roll("phone", async () => {
    await ui("教材与引用", phone).click();
    await phone.getByRole("dialog", { name: "课程学习材料" }).waitFor();
  }, phone);
  await mobile.close();
}

async function studioFlow() {
  await bound(page, "/directions?create=1");
  const studio = page.locator("#course-create");
  await studio.getByRole("heading", { name: "与规划导师讨论" }).waitFor();
  const write = text => studio.locator("textarea").fill(text);
  const ctl = name => studio.getByRole("button", { name, exact: true });
  const turns = () => studio.getByRole("log").locator("article");
  const waitTurns = n => page.waitForFunction(n => document.querySelectorAll(".direction-transcript article").length >= n || document.querySelector(".direction-error"), n, { timeout: 180000 });
  const failIfError = async () => {
    const error = studio.locator(".direction-error");
    if (await error.count()) throw new Error("规划出现错误：" + (await error.innerText()).slice(0, 120));
  };
  await roll("import", async () => {
    const chooser = page.waitForEvent("filechooser");
    await ctl("导入").click();
    await (await chooser).setFiles({
      name: "双栈队列练习讲义.markdown",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 双栈队列练习讲义\n\n栈遵循后进先出，队列遵循先进先出。用入栈记录新的元素，只有出栈为空才倒入所有元素。逐个模拟入队甲、入队乙、出队、入队丙、出队，验证顺序。说明每个元素最多被倒栈一次，因此长期平均的单次操作代价为常数。\n"),
    });
    await studio.getByRole("checkbox", { name: "双栈队列练习讲义.markdown" }).waitFor({ timeout: 45000 });
  });
  await roll("turn1", async () => {
    await write("我想学会用两个栈实现队列，请结合我导入的讲义安排练习。");
    await pause(1100);
    await ctl("发送给导师").click();
  });
  await waitTurns(2);
  await failIfError();
  const digest = name => roll(name, async () => {
    await turns().last().scrollIntoViewIfNeeded();
    await pause(2200);
  });
  await digest("turn1_result");
  await roll("turn2", async () => {
    await write("我会用数组，希望六周内练会均摊分析。每周安排两次练习。");
    await pause(1100);
    await ctl("发送给导师").click();
  });
  await waitTurns(4);
  await failIfError();
  await digest("turn2_result");
  await roll("build", async () => {
    await studio.getByRole("checkbox", { name: "辅助联网搜索" }).check();
    await pause(950);
    await ctl("生成学习方案与图谱").click();
  });
  await page.waitForFunction(() => document.querySelector(".direction-map,.direction-error"), null, { timeout: 280000 });
  await failIfError();
  await roll("build_result", async () => {
    const map = studio.locator(".direction-map");
    await map.scrollIntoViewIfNeeded();
    const nodes = map.locator(".react-flow__node");
    await nodes.first().waitFor();
    console.log("图谱节点", await nodes.count(), "先修边", await map.locator(".react-flow__edge").count());
    await pause(2100);
    const candidate = nodes.nth(2);
    if (await candidate.isVisible()) await candidate.click({ force: true });
    await pause(1200);
  });
  await roll("save", async () => {
    const reference = studio.getByText(/本轮参考 · \d+ 处/).last();
    if (await reference.count()) {
      await reference.click();
      await pause(3300);
    }
    await studio.getByLabel("方向名", { exact: true }).fill("六周双栈队列学习方案");
    const save = page.waitForResponse(response => response.url() === base + "/api/directions" && response.request().method() === "POST", { timeout: 30000 });
    await ctl("保存这个方向").click();
    if (!(await save).ok()) throw new Error("保存方向请求失败");
    const saved = page.locator('[data-motion="direction"]').filter({ has: page.getByRole("heading", { name: "六周双栈队列学习方案", exact: true }) }).first();
    await saved.getByText("双栈队列练习讲义.markdown", { exact: true }).waitFor();
    await saved.scrollIntoViewIfNeeded();
    await screenshot("end_base");
  });
  console.log("已保存私有演示方向，讲义可见。");
}

await fs.mkdir(out, { recursive: true });
try {
  if (part === "login") await login();
  else {
    await auth();
    if (part === "studio") await studioFlow();
    else if (part === "tutor") await tutor();
    else if (part === "tour") { await diagnose(); await graph(); }
    else if (part === "graph") await graph();
    else throw new Error("usage: record.mjs login|tour|graph|tutor|studio");
  }
} catch (error) {
  await screenshot("error-" + part).catch(() => {});
  console.error(error.message.split("\n").slice(0, 8).join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
