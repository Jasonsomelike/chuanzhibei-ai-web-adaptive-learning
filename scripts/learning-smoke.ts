/** 学习闭环浏览器回归。只允许本机地址，测试账号写入隔离的内存服务。 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { SUBJECTS } from "../src/data/subjects/index";
import { createSubjectProgress } from "../src/lib/learner";

const base = process.env.BASE_URL ?? "http://localhost:3218";
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname), "E2E 仅允许本机测试服务");
const output = process.env.QA_OUTPUT_DIR ?? join(tmpdir(), `alp-learning-qa-${Date.now()}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();
const runtimeErrors: string[] = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
let checks = 0;
function check(condition: unknown, name: string) { assert(condition, name); checks += 1; console.log(`PASS ${name}`); }
async function visit(path: string) {
  const response = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  check(response?.ok(), `页面 ${path} 返回成功`);
  await page.locator("main h1").waitFor();
}

try {
  await visit("/");
  await page.getByRole("heading", { name: "从一小步开始" }).waitFor();
  check((await page.title()).includes("智慧学伴"), "标题正确且首页非空");
  await page.getByLabel("当前学习目标").selectOption("network");
  await page.getByRole("button", { name: "60 分钟", exact: true }).click();
  const planLink = page.getByRole("link", { name: "查看完整计划 →" });
  check((await planLink.getAttribute("href"))?.includes("subject=network&budget=60"), "学科与预算进入实际计划链接");
  await planLink.click();
  await page.getByRole("heading", { name: "学习路径", exact: true }).waitFor();
  check((await page.locator("main").innerText()).includes("下一步建议"), "路径首屏突出下一步");
  await page.getByText("调整学习计划 ·", { exact: false }).click();
  check(await page.getByRole("button", { name: "把本周预算设为 60 分钟" }).getAttribute("aria-pressed") === "true", "首页预算在路径页实际生效");
  await page.getByRole("link", { name: "学习这一步 →" }).click();
  await page.locator("#q").waitFor();
  check((await page.locator("#q").inputValue()).includes("请引导我学习"), "学习任务传入导师输入框且不自动发送");

  await visit("/tutor?subject=data-structures");
  await page.locator("#q").fill("栈为什么是后进先出？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("思考方向：", { exact: false }).waitFor();
  check((await page.locator("main").innerText()).includes("通用学习引导"), "无模型提示模式如实说明能力");
  await page.getByRole("button", { name: "3 · 完整讲解" }).click();
  await page.locator("#q").fill("栈的定义和后进先出是什么？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("结论：", { exact: false }).waitFor();
  check((await page.locator("main").innerText()).includes("[c09]"), "完整讲解可检索并引用课程依据");

  await visit("/diagnose?subject=data-structures");
  await page.locator('input[type="radio"][name="answer"]').first().check();
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await page.getByRole("button", { name: "下一题", exact: true }).waitFor();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("alp.learner.v2") ?? "{}"));
  const progress = saved.subjects["data-structures"];
  check(progress.attempts.length === 1 && progress.attempts[0].selectedIndex === 0, "真实答题保存选项与历史");
  check(progress.mastery.some((m: { evidenceN: number }) => m.evidenceN === 1), "真实答题更新掌握度证据");
  await visit("/path?subject=data-structures&budget=30");
  await page.getByText("学习证据与路径变化", { exact: false }).click();
  check((await page.locator("main").innerText()).includes("作答前路径"), "学习证据抽屉展示前后版本");

  for (const width of [1280, 853, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/diagnose", "/path", "/tutor", "/directions", "/market", "/settings", "/guide", "/about", "/login"]) {
      await visit(route);
      const bounds = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
      check(bounds.scroll <= bounds.width + 1, `${route} ${width}px 无横向溢出`);
      check(!await page.locator("nextjs-portal [data-nextjs-dialog]").count(), `${route} 无框架错误遮罩`);
      if (["/", "/path", "/tutor", "/settings"].includes(route)) await page.screenshot({ path: join(output, `${route === "/" ? "home" : route.slice(1)}-${width}.png`), fullPage: false });
    }
    if (width === 390) {
      check(!await page.getByRole("link", { name: "设置中心", exact: true }).first().isVisible(), "移动端次要导航收进更多菜单");
      await page.getByText("更多 ▾", { exact: true }).click();
      check(await page.getByRole("link", { name: "设置中心", exact: true }).last().isVisible(), "更多菜单可访问设置");
    }
  }
  check(runtimeErrors.length === 0, `无浏览器运行错误：${runtimeErrors.join("; ")}`);

  // API 经过真实 cookie 会话，验证判分、版本冲突与账号隔离。
  const stamp = Date.now();
  const headers = { Origin: base };
  const register = await context.request.post(`${base}/api/auth`, { headers, data: { action: "register", email: `learning-${stamp}@test.local`, password: "learning-test-password123", displayName: "学习回归账号" } });
  check(register.ok(), "本机隔离服务注册测试账号");
  const subject = SUBJECTS[0]; const question = subject.questions[0];
  const evidence = { ...createSubjectProgress(subject.id), attempts: [{ attemptId: "smoke-1", questionId: question.id, kcId: question.kcId,
    selectedIndex: question.answerIndex, correct: false, difficulty: 5, at: new Date().toISOString() }] };
  const first = await context.request.post(`${base}/api/progress`, { headers, data: { subjectId: subject.id, progress: evidence, baseRevision: null } });
  check(first.ok(), "真实服务端保存作答");
  const accepted = await first.json();
  check(accepted.progress.attempts[0].correct === true && accepted.progress.attempts[0].difficulty === question.difficulty, "服务端纠正伪造对错与难度");
  const parallel = await Promise.all([1, 2].map(() => context.request.post(`${base}/api/progress`, { headers, data: { subjectId: subject.id, progress: evidence, baseRevision: accepted.updatedAt } })));
  check(parallel.map((res) => res.status()).sort().join(",") === "200,409", "并发同版本更新一胜一冲突");
  const secondContext = await browser.newContext();
  const anon = await secondContext.request.get(`${base}/api/progress`);
  check(anon.status() === 401, "匿名不能读取账号学情");
  await secondContext.close();

  const modelRequests: Record<string, unknown>[] = [];
  const mock = createServer(async (request, response) => {
    let body = ""; for await (const part of request) body += String(part);
    modelRequests.push(JSON.parse(body) as Record<string, unknown>);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content: "结论：回归模型已读取学习证据，栈遵循后进先出 [c09] [资料1]。" }, finish_reason: "stop" }] }));
  });
  await new Promise<void>((resolve, reject) => { mock.once("error", reject); mock.listen(Number(process.env.ALP_E2E_MOCK_PORT ?? 3219), "127.0.0.1", resolve); });
  try {
    const address = mock.address(); assert(address && typeof address !== "string");
    const configured = await context.request.put(`${base}/api/config`, { headers, data: {
      provider: "llm", kind: "openai-compatible", baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "test-only",
      model: "learning-smoke", verification: false,
    } });
    check(configured.ok(), `测试模型配置加密保存到隔离账号（HTTP ${configured.status()}）`);
    const docId = `learning-${stamp}`; const text = "回归讲义原文：栈遵循后进先出，最后进入的元素最先移除。";
    const uploaded = await context.request.put(`${base}/api/kb`, { headers, data: {
      doc: { id: docId, directionId: subject.id, title: "回归讲义", fileName: "learning.txt", kind: "txt", size: Buffer.byteLength(text),
        charCount: text.length, chunkCount: 1, kcIds: ["c09"], createdAt: new Date().toISOString() },
      chunks: [{ id: `${docId}:0`, docId, directionId: subject.id, title: "回归讲义", section: "栈", text, index: 0 }], baseUpdatedAt: null,
    } });
    check(uploaded.ok(), "上传资料进入当前账号知识库");
    await page.setViewportSize({ width: 1280, height: 900 });
    await visit("/settings?panel=tone");
    await page.getByRole("button", { name: /^严格/ }).click();
    await visit("/tutor?subject=data-structures");
    await page.getByText("切换课程与回答设置", { exact: true }).click();
    await page.getByLabel("智能体（服务端工具循环）", { exact: true }).check();
    await page.getByRole("button", { name: "3 · 完整讲解" }).click();
    await page.locator("#q").fill("栈为什么遵循后进先出？");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByText("回归模型已读取学习证据", { exact: false }).waitFor();
    check(modelRequests.length > 0, "导师界面经真实 Agent 路由调用本机模型");
    const messages = modelRequests[0].messages as { role: string; content: string }[];
    check(messages[0].content.includes("【语气：严格】"), "设置页语气进入真实模型请求");
    const toolContext = messages.filter((message) => message.role === "tool").map((message) => message.content).join("\n");
    check(toolContext.includes("server-validated-attempts") && /"observedCount":[1-9]/.test(toolContext), "Agent 首次调用已携带验证后的真实学习证据");
    check(toolContext.includes("回归讲义原文") && toolContext.includes("资料1") && toolContext.includes("栈顶"), "Agent 检索包含账号上传原文、教材与一致的引用编号");
    check(!((modelRequests[0].tools as { function: { parameters: { properties: unknown } } }[]).some((tool) => JSON.stringify(tool.function.parameters.properties).includes('"mastery"'))), "Agent 工具不允许模型自报掌握度");
    await page.screenshot({ path: join(output, "agent-learning-1280.png"), fullPage: false });
    check(runtimeErrors.length === 0, `Agent 交互后无浏览器运行错误：${runtimeErrors.join("; ")}`);
  } finally { await new Promise<void>((resolve) => mock.close(() => resolve())); }
  console.log(`\n${checks} 项全部通过。截图：${output}`);
} finally { await browser.close(); }
