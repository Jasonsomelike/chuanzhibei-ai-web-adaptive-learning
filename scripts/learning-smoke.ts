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
  if (path.startsWith("/tutor")) await page.waitForFunction(() => document.querySelector('[aria-label="辅导消息"]')?.getAttribute("aria-busy") === "false");
  if (path.startsWith("/diagnose")) await page.locator('.diagnostic-page[aria-busy="false"]').waitFor();
}

try {
  await visit("/");
  await page.getByRole("heading", { name: "学习概览", exact: true }).waitFor();
  check((await page.title()).includes("自适应学习路径"), "标题正确且首页非空");
  check(!(await page.locator(".daily-task").innerText()).includes("%"), "未测评的首页任务不把先验显示成掌握度");
  check(await page.locator(".knowledge-contour").count() === 0, "首页以学习任务为中心，不加载装饰 Canvas");
  await page.getByLabel("当前学习目标").selectOption("network");
  await page.getByRole("button", { name: "60 分钟", exact: true }).click();
  const planLink = page.getByRole("link", { name: "查看知识图谱", exact: true });
  check((await planLink.getAttribute("href"))?.includes("subject=network&budget=60"), "学科与预算进入实际计划链接");
  await planLink.click();
  await page.getByRole("heading", { name: "学习地图", exact: true }).waitFor();
  await page.locator(".knowledge-sequence").waitFor();
  check(await page.locator(".knowledge-canvas").isVisible(), "路径首屏以知识图谱导航学习");
  check(await page.getByLabel("本次学习预算", { exact: true }).inputValue() === "60", "首页预算在路径页实际生效");
  await page.locator(".knowledge-sequence").getByRole("link", { name: "开始学习", exact: true }).click();
  await page.locator("#q").waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="辅导消息"]')?.getAttribute("aria-busy") === "false");
  check((await page.locator("#q").inputValue()).includes("请引导我理解"), "学习任务传入导师输入框且不自动发送");

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
  await page.getByRole("button", { name: "查看知识点 c09 的引用原文", exact: true }).last().click();
  const original = page.getByRole("region", { name: "回答引用原文", exact: true });
  await original.waitFor({ state: "visible" });
  check(await original.isVisible() && (await original.innerText()).includes("后进先出"), "点击引用在侧栏展示该回答的原文快照");
  check(new URL(page.url()).pathname === "/tutor", "查看引用保留导师对话位置");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "栈 [c09]", exact: true }).last().click();
  await page.getByRole("dialog", { name: "课程学习材料", exact: true }).waitFor();
  check(await original.isVisible(), "移动端引用在材料抽屉内展示");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 900 });

  await visit("/diagnose?subject=data-structures");
  check(await page.locator("[data-answer-feedback]").count() === 0 && !await page.getByText("内置题库（无页级出处）", { exact: false }).isVisible(), "提交前不展示答案与材料出处");
  // Submission may scroll the button into view on shorter screens. Compare document positions.
  const answerRows = await page.locator(".question-option").evaluateAll(rows => rows.map(row => ({ y: row.getBoundingClientRect().y + window.scrollY, height: row.getBoundingClientRect().height })));
  await page.locator('input[type="radio"][name="answer"]').first().check();
  await page.getByRole("button", { name: "提交答案", exact: true }).click();
  await page.getByRole("button", { name: "下一题", exact: true }).waitFor();
  check(await page.getByText("内置题库（无页级出处）", { exact: false }).isVisible(), "提交后显示真实题目出处");
  const feedbackRows = await page.locator(".question-option").evaluateAll(rows => rows.map(row => ({ y: row.getBoundingClientRect().y + window.scrollY, height: row.getBoundingClientRect().height })));
  check(answerRows.every((row, index) => Math.abs(row.y - feedbackRows[index].y) < 1 && Math.abs(row.height - feedbackRows[index].height) < 1), "答题反馈不改变选项行位置与高度");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("alp.learner.v2") ?? "{}"));
  const progress = saved.subjects["data-structures"];
  check(progress.attempts.length === 1 && progress.attempts[0].selectedIndex === 0, "真实答题保存选项与历史");
  check(progress.mastery.some((m: { evidenceN: number }) => m.evidenceN === 1), "真实答题更新掌握度证据");
  await visit("/path?subject=data-structures&budget=30");
  await page.getByText("学习证据与路径变化", { exact: false }).click();
  check((await page.locator("main").innerText()).includes("作答前路径"), "学习证据抽屉展示前后版本");

  // UI upgrade: real course/evidence data, accessible overlays and stable list identity.
  await visit("/");
  const savedBeforePreview = await page.evaluate(() => localStorage.getItem("alp.learner.v2"));
  check(await page.getByRole("link", { name: "继续学习", exact: true }).isVisible(), "已有作答的首页优先继续学习");
  check((await page.locator("main").innerText()).includes("最近作答："), "首页展示真实最近作答");
  check(await page.getByRole("tab", { name: /先了解自己/ }).count() === 0, "首页没有重复演示区");
  await visit("/guide");
  await page.getByRole("tab", { name: /先了解自己/ }).click();
  await page.getByText("题目预览，不写入学习记录", { exact: false }).waitFor();
  check(await page.getByText("题目预览，不写入学习记录", { exact: false }).isVisible(), "指南保留真实课程诊断预览，明确不记分");
  await page.getByRole("tab", { name: /学懂，再验证/ }).click();
  check((await page.getByRole("link", { name: "带着这一步问导师" }).getAttribute("href"))?.includes("&q="), "指南学习预览带真实主题进入导师");
  await page.getByRole("tab", { name: /安排下一步/ }).click();
  check(savedBeforePreview === await page.evaluate(() => localStorage.getItem("alp.learner.v2")), "流程预览不改写学习证据");
  await page.keyboard.press("Control+k");
  await page.getByRole("textbox", { name: "搜索课程与功能", exact: true }).fill("线性代数");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await page.waitForURL("**/diagnose?subject=linear-algebra");
  check((await page.locator("main").innerText()).includes("线性代数"), "键盘搜索进入实际课程");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  check(await page.locator("main").getAttribute("data-focus") === "true" && !await page.locator(".diagnostic-sidebar").isVisible(), "专注模式隐藏辅助栏");
  await page.getByRole("button", { name: "退出专注", exact: true }).click();
  check(await page.locator(".diagnostic-sidebar").isVisible(), "可退出专注并恢复辅助材料");
  await visit("/tutor?subject=data-structures");
  check(await page.locator("#q").evaluate(el => el.tagName === "TEXTAREA"), "导师支持多行问题输入");
  await page.getByRole("button", { name: "教材与引用", exact: true }).click();
  await page.getByRole("button", { name: "围绕这段提问", exact: true }).first().click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && document.activeElement?.id === "q");
  check((await page.locator("#q").inputValue()).includes("教材") && await page.locator("#q").evaluate(el => el === document.activeElement), "教材摘录进入输入框并保持出处");
  check(await page.getByRole("link", { name: "[top]", exact: true }).count() === 0, "教材数组下标不会误变成知识点链接");
  await page.getByRole("button", { name: "教材与引用", exact: true }).click();
  await page.getByRole("tab", { name: "教材阅读", exact: true }).focus();
  await page.keyboard.press("End");
  check(await page.getByRole("tab", { name: "学习设置", exact: true }).getAttribute("aria-selected") === "true", "导师侧栏支持标准标签页键盘操作");
  await page.setViewportSize({ width: 390, height: 844 });
  await visit("/tutor?subject=data-structures");
  await page.getByRole("button", { name: "教材与引用", exact: true }).click();
  check(await page.getByRole("dialog", { name: "课程学习材料", exact: true }).isVisible(), "移动端材料抽屉可打开");
  await page.getByRole("button", { name: "围绕这段提问", exact: true }).first().click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && document.activeElement?.id === "q");
  check(await page.getByRole("dialog").count() === 0 && await page.locator("#q").evaluate(el => el === document.activeElement), "移动端引用原文后关闭抽屉，焦点回到问题");
  await page.locator("#q").scrollIntoViewIfNeeded();
  check(await page.locator("#q").evaluate(el => el.getBoundingClientRect().bottom <= document.querySelector(".mobile-learning-nav")!.getBoundingClientRect().top), "手机输入框不被底部导航遮挡");
  await page.getByRole("button", { name: "教材与引用", exact: true }).click(); await page.keyboard.press("Escape");
  check(await page.getByRole("button", { name: "教材与引用", exact: true }).evaluate(el => el === document.activeElement), "Escape 关闭抽屉并恢复触发按钮焦点");
  await visit("/path?subject=data-structures");
  await page.getByRole("button", { name: "教材章节 · 整科", exact: true }).click();
  await page.getByRole("dialog", { name: "教材章节", exact: true }).waitFor();
  check(await page.getByRole("dialog").getByRole("button", { name: "全选", exact: true }).isVisible(), "手机章节选择在可滚动抽屉中完整可用");
  await page.keyboard.press("Escape");
  check(await page.getByRole("button", { name: "教材章节 · 整科", exact: true }).evaluate(el => el === document.activeElement), "章节抽屉 Escape 关闭后恢复入口焦点");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await visit("/path?subject=data-structures&budget=60");
  await page.locator(".react-flow__node").first().waitFor();
  await page.locator(".react-flow__edge-path").first().waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const canvas = document.querySelector(".knowledge-canvas")!.getBoundingClientRect();
    return [...document.querySelectorAll(".react-flow__node")].every(el => { const box = el.getBoundingClientRect(); return box.left >= canvas.left - 1 && box.right <= canvas.right + 1 && box.top >= canvas.top - 1 && box.bottom <= canvas.bottom + 1; });
  });
  check(await page.locator(".react-flow__node").count() > 0 && await page.locator(".react-flow__edge-path").count() > 0, "图谱先修连线已绘制，初始视野无基础节点裁切");
  check(!await page.locator("[data-technical-details]").getAttribute("open"), "技术指纹默认收起");
  check(await page.locator(".knowledge-sequence li button").count() === await page.locator("[data-flip-id]").count(), "图谱同屏清单展示实际步骤数");
  await page.locator("#path-step-editor > summary").click();
  const firstStep = page.locator("[data-flip-id]").first();
  const firstKc = await firstStep.getAttribute("data-motion-step");
  await firstStep.getByRole("button", { name: /^在图谱中定位/ }).click();
  check(await page.locator(`.react-flow__node[data-id="${firstKc}"]`).getAttribute("class").then(value => value?.includes("selected")), "清单选择同步图谱选中状态");
  await page.locator(".concept-evidence > summary").click();
  await page.locator(".knowledge-desktop-inspector").getByRole("button", { name: "在清单中定位", exact: true }).click();
  check(await firstStep.getByText("已定位", { exact: true }).isVisible(), "图谱可返回并高亮清单中的对应步骤");
  await page.locator('.react-flow__node[data-id="c02"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('#path-step-c02 button[aria-pressed="true"]'));
  check(await page.locator(".concept-detail-heading h2").innerText() === "时间复杂度分析", "键盘选择图谱节点同步清单与详情");
  await page.getByRole("combobox", { name: "搜索知识点", exact: true }).fill("顺序表");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".concept-detail-heading h2")?.textContent === "顺序表");
  check((await page.locator(".concept-detail-heading h2").innerText()) === "顺序表", "选择节点显示实际知识点详情");
  await page.locator(".knowledge-desktop-inspector").getByRole("link", { name: "用一道题检查理解", exact: true }).click();
  await page.locator('input[name="answer"]').first().waitFor();
  check((await page.locator(".question-paper").innerText()).includes("顺序表"), "图谱进入选中知识点的实际练习");
  await visit("/path?subject=data-structures&budget=60");
  await page.getByLabel("本次学习预算", { exact: true }).selectOption("90");
  check((await page.locator("[data-path-summary]").textContent())?.includes("相比 60 分钟预算"), "预算变化报告实际新增与移出数量");
  await page.waitForFunction(() => document.querySelectorAll(".knowledge-node[data-new-step=true]").length > 0);
  check((await page.locator(".knowledge-sequence").innerText()).includes("新增安排"), "增加预算同时标注新增节点与清单步骤");
  await page.locator("#path-step-editor > summary").click();
  const identity = await page.locator("[data-flip-id]").first().elementHandle();
  const originalId = await identity!.getAttribute("data-flip-id");
  await page.getByRole("button", { name: /^把「.*」下移一位$/ }).first().click();
  check(await identity!.evaluate(el => el.isConnected), "GSAP Flip 重排保留原知识点 DOM 身份");
  check(await page.locator("[data-flip-id]").first().getAttribute("data-flip-id") !== originalId, "路径步骤实际重排");
  check((await page.locator("main").innerText()).includes("当前顺序违反"), "手动越过先修仍保留约束警告");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-flip-id]")].every(el => { const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform); return Math.abs(matrix.m42) < 0.1 && Math.abs(matrix.m41) < 0.1; }));
  await page.getByRole("button", { name: "恢复算法排序", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await identity!.dispose();
  for (const route of ["/", "/diagnose", "/path", "/tutor"]) {
    await visit(`${route}?subject=data-structures`);
    if (route === "/path") {
      await page.locator(".react-flow__node").first().waitFor();
      await page.locator(".react-flow__edge-path").first().waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const canvas = document.querySelector(".knowledge-canvas")!.getBoundingClientRect();
        return [...document.querySelectorAll(".react-flow__node")].every(el => { const box = el.getBoundingClientRect(); return box.left >= canvas.left - 1 && box.right <= canvas.right + 1 && box.top >= canvas.top - 1 && box.bottom <= canvas.bottom + 1; });
      });
    }
    await page.screenshot({ path: join(output, `${route === "/" ? "home" : route.slice(1)}-1440.png`), fullPage: false });
  }

  for (const width of [1280, 853, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/diagnose", "/path", "/tutor", "/directions", "/market", "/settings", "/guide", "/about", "/login"]) {
      await visit(route);
      const bounds = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
      check(bounds.scroll <= bounds.width + 1, `${route} ${width}px 无横向溢出`);
      check(!(await page.locator("body").innerText()).includes("智慧学伴"), `${route} 品牌一致`);
      check(!await page.locator("nextjs-portal [data-nextjs-dialog]").count(), `${route} 无框架错误遮罩`);
      if (route === "/path" && width >= 768) await page.locator(".react-flow__edge-path").first().waitFor({ state: "visible" });
      if (route === "/path" && width < 768) {
        await page.locator(".react-flow__node").first().waitFor();
        check(await page.locator(".knowledge-canvas").isVisible(), "手机默认图谱导航，知识点可拖动和缩放");
        await page.getByRole("button", { name: "只看清单", exact: true }).click();
        check(await page.locator(".react-flow__node").count() === 0 && await page.getByRole("heading", { name: "学习步骤安排", exact: true }).isVisible(), "手机可切换清单并完整编辑学习步骤");
        await page.screenshot({ path: join(output, `path-list-${width}.png`), fullPage: false });
        await page.getByRole("button", { name: "展开先修图谱", exact: true }).click();
        await page.locator(".react-flow__edge-path").first().waitFor({ state: "visible" });
      }
      if (["/", "/diagnose", "/path", "/tutor", "/settings"].includes(route)) await page.screenshot({ path: join(output, `${route === "/" ? "home" : route.slice(1)}-${width}.png`), fullPage: false });
    }
    if (width === 390) {
      check(await page.getByRole("link", { name: "设置中心", exact: true }).isVisible(), "手机可直接访问设置");
      check(await page.locator(".mobile-learning-nav a").count() === 5, "手机五个主要学习入口完整可达");
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const themeNames = { olive: "橄榄", sand: "暖砂", forest: "森林", indigo: "深蓝", violet: "紫罗兰", contrast: "高对比" };
  for (const [theme, label] of Object.entries(themeNames)) for (const mode of ["light", "dark"] as const) {
    await visit("/settings?panel=appearance");
    await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
    await page.getByRole("button", { name: mode === "light" ? "浅色" : "深色", exact: true }).click();
    await visit("/path?subject=data-structures&budget=60");
    await page.locator(".knowledge-node").first().waitFor();
    const appearance = await page.evaluate(() => {
      return { theme: document.documentElement.dataset.theme, mode: document.documentElement.dataset.mode,
        contrast: [...document.querySelectorAll(".concept-label")].map(el => { const style = getComputedStyle(el); const [foreground, background] = [style.color, style.backgroundColor].map(value => { const values = value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(x => { const v = x / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722; }); return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05); }) };
    });
    check(appearance.theme === theme && appearance.mode === mode, `${label} ${mode} 经设置页切换并在图谱恢复`);
    check(appearance.contrast.every(ratio => ratio >= 4.5), `${label} ${mode} 图谱状态文字对比度至少 4.5:1`);
    if (theme === "forest" && mode === "dark") await page.screenshot({ path: join(output, "path-forest-dark-1280.png"), fullPage: false });
  }
  await visit("/settings?panel=appearance");
  await page.getByRole("button", { name: "橄榄", exact: true }).click();
  await page.getByRole("button", { name: "浅色", exact: true }).click();
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
    await page.getByRole("button", { name: "教材与引用", exact: true }).click();
    await page.getByRole("tab", { name: "学习设置", exact: true }).click();
    await page.getByLabel("智能体（教学工作流）", { exact: true }).check();
    await page.keyboard.press("Escape");
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
    await page.locator("[data-teaching-task]").waitFor();
    check(await page.locator("[data-teaching-task]").last().getByText("任务完成", { exact: true }).isVisible(), "知识辅导工作流完成并显示教学卡");
    await page.getByText("教学任务与学习时间", { exact: true }).click();
    await page.getByLabel("教学任务类型", { exact: true }).selectOption("review_path");
    await page.getByLabel("教学学习时间", { exact: true }).selectOption("30");
    await page.locator("#q").fill("今天只有30分钟，安排一下学习路径");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.locator("[data-workflow-plan]").last().waitFor();
    await page.getByRole("button", { name: "发送", exact: true }).waitFor({ state: "visible" });
    check(await page.locator("[data-workflow-plan]").last().innerText().then(t => t.includes("30 分钟预算")), "路径工作流输出实际30分钟方案");
    await page.getByLabel("教学任务类型", { exact: true }).selectOption("practice");
    await page.locator("#q").fill("请出一道独立练习");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const task = page.locator("[data-teaching-task]").last();
    await task.getByRole("button", { name: "提交练习并更新计划", exact: true }).waitFor();
    await task.getByRole("radio").first().check();
    await task.getByRole("button", { name: "提交练习并更新计划", exact: true }).click();
    await task.locator("[data-assessment]").waitFor();
    check(await task.innerText().then(t => t.includes("作答后的学习计划")), "独立练习经服务端判分并重新计算路径");
    await page.reload();
    await page.locator("[data-assessment]").waitFor();
    check(await page.locator(".tutor-user-message").count() === 3 && await page.locator("[data-teaching-task]").count() === 3, "刷新恢复完整三轮教学问答和已核对作答");
    await page.locator("[data-assessment]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, "workflow-assessment-1280.png"), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "移动端教学卡无横向溢出");
    check(await page.evaluate(() => {
      const task = document.querySelector("[data-teaching-task]");
      const log = document.querySelector(".tutor-messages");
      return !!task && !!log && log.contains(task) && log.scrollHeight > log.clientHeight;
    }), "恢复后的长练习卡保留在消息滚动区域");
    await page.locator("[data-assessment]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, "workflow-mobile-390.png"), fullPage: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: join(output, "agent-learning-1280.png"), fullPage: false });
    check(runtimeErrors.length === 0, `Agent 交互后无浏览器运行错误：${runtimeErrors.join("; ")}`);
  } finally { await new Promise<void>((resolve) => mock.close(() => resolve())); }
  console.log(`\n${checks} 项全部通过。截图：${output}`);
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => undefined);
  console.error("UI 回归失败", { url: page.url(), runtimeErrors, evidence: output });
  throw error;
} finally { await browser.close(); }
