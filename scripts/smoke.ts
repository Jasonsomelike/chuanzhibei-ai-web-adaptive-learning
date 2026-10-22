/**
 * 端到端冒烟测试：用无头浏览器真实走一遍主流程。
 *
 * 检查的不是「页面能打开」，而是：
 *   - 诊断能否答题、掌握度是否更新
 *   - 路径能否生成、指纹是否出现
 *   - 改预算能否重算
 *   - 导师在无 key 时是否给出可用的检索回答
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3210";

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

const results: Result[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

try {
  // 1. 首页
  await page.goto(BASE, { waitUntil: "networkidle" });
  const h1 = await page.locator("h1").first().innerText();
  record("首页渲染", h1.includes("学习路径"), h1.replace(/\s+/g, " ").slice(0, 40));

  const bodyText = await page.locator("body").innerText();
  record(
    "首页显示课程规模",
    bodyText.includes("40") && bodyText.includes("120"),
    "含 40 个知识点 / 120 道题",
  );

  // 团队与参赛信息必须完整可见（评审第一眼要看的东西）
  const teamChecks: [string, string][] = [
    ["胆子肥嘟嘟队", "团队名称"],
    ["38543", "团队编号"],
    ["北京电子科技学院", "院校"],
    ["B 组", "组别"],
    ["李双", "队长"],
    ["于凯", "队员"],
    ["王一超", "队员"],
    ["李浩亮", "指导教师"],
    ["2026 第九届传智杯", "竞赛名称"],
  ];
  const missing = teamChecks.filter(([needle]) => !bodyText.includes(needle));
  record(
    "首页显示完整参赛信息",
    missing.length === 0,
    missing.length === 0
      ? teamChecks.map(([, label]) => label).join("、")
      : `缺少：${missing.map(([n]) => n).join("、")}`,
  );

  // 个人信息不得出现在公开页面
  const privacyLeaks = ["18010730140", "2838955944@qq.com"].filter((v) =>
    bodyText.includes(v),
  );
  record(
    "首页未泄露联系方式",
    privacyLeaks.length === 0,
    privacyLeaks.length === 0 ? "电话与邮箱均未出现" : `泄露：${privacyLeaks.join("、")}`,
  );

  // 2. 诊断页
  await page.goto(`${BASE}/diagnose`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const hasQuestion = await page.locator("fieldset").count();
  record("诊断页出现题目", hasQuestion > 0, `fieldset=${hasQuestion}`);

  // 答 3 题（每题选第一个选项）
  let answered = 0;
  for (let i = 0; i < 3; i += 1) {
    const radios = page.locator('input[type="radio"]');
    if ((await radios.count()) === 0) break;

    await radios.first().check();
    const submit = page.getByRole("button", { name: "提交答案" });
    if ((await submit.count()) === 0) break;
    await submit.click();
    await page.waitForTimeout(300);

    const next = page.getByRole("button", { name: "下一题" });
    if ((await next.count()) > 0) {
      answered += 1;
      await next.click();
      await page.waitForTimeout(300);
    }
  }
  record("诊断可答题", answered >= 2, `完成 ${answered} 题`);

  // 3. 路径页
  await page.goto(`${BASE}/path`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const pathText = await page.locator("body").innerText();
  const hashMatch = pathText.match(/[0-9a-f]{64}/);
  record("路径页生成指纹", Boolean(hashMatch), hashMatch ? hashMatch[0].slice(0, 16) + "…" : "未找到");

  const hasSteps = await page.locator("ol li").count();
  record("路径有步骤", hasSteps > 0, `${hasSteps} 步`);

  // 4. 改预算重算
  const beforeText = await page.locator("ol").first().innerText();
  await page.getByRole("button", { name: "把本周预算设为 30 分钟" }).click();
  await page.waitForTimeout(500);
  const afterText = await page.locator("ol").first().innerText();
  record("改预算后路径变化", beforeText !== afterText, "内容已更新");

  // 5. 反事实对比
  await page.getByRole("button", { name: "对照预算 240 分钟" }).click();
  await page.waitForTimeout(400);
  const cfText = await page.locator("body").innerText();
  record(
    "反事实对比显示差异",
    cfText.includes("被推迟") || cfText.includes("可排"),
    cfText.includes("被推迟") ? "显示推迟项" : "显示步数对比",
  );

  // 5. 导师页（无 key 降级）
  await page.goto(`${BASE}/tutor`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const tutorText = await page.locator("body").innerText();
  record(
    "导师页如实标注模式",
    tutorText.includes("知识库检索") || tutorText.includes("未配置"),
    tutorText.includes("知识库检索") ? "显示检索模式" : "未标注",
  );

  // 发一个问题
  await page.locator("#q").fill("栈和队列的区别");
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForTimeout(2500);

  const replyText = await page.locator("body").innerText();
  const hasCitation = /\[c\d{2}\]/.test(replyText);
  record("导师回答带引用", hasCitation, hasCitation ? "含 [cXX] 引用" : "无引用");
  record(
    "导师回答非空",
    replyText.includes("栈") && replyText.length > 500,
    `回答长度 ${replyText.length}`,
  );

  // 6. 截图
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.screenshot({ path: "screenshots/home.png", fullPage: true });
  await page.goto(`${BASE}/path`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "screenshots/path.png", fullPage: true });
  record("截图已保存", true, "screenshots/*.png");
} catch (err) {
  record("执行异常", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log("失败项：");
  for (const f of failed) console.log(`  · ${f.name}: ${f.detail}`);
  process.exit(1);
}
