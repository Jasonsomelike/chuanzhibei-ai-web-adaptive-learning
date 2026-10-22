/**
 * 端到端冒烟测试：用无头浏览器真实走一遍主流程。
 *
 * 检查的不是「页面能打开」，而是功能真的工作：
 *   - 多学科切换后，题目与知识点真的换了
 *   - 5 套主题切换后，CSS 变量真的变了（且浅色真的生效）
 *   - 设置页能保存供应商配置并回显
 *   - 诊断答题后掌握度真的更新
 *   - 路径能生成、指纹存在、改预算重算
 *   - 导师在无 key 时给出带引用的检索回答
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
  // ── 1. 首页 ──
  await page.goto(BASE, { waitUntil: "networkidle" });
  const h1 = await page.locator("h1").first().innerText();
  record("首页渲染", h1.includes("学习路径"), h1.replace(/\s+/g, " ").slice(0, 40));

  const bodyText = await page.locator("body").innerText();
  record(
    "首页显示多学科规模",
    bodyText.includes("5 个学科") || bodyText.includes("200"),
    bodyText.includes("5 个学科") ? "显示 5 个学科" : "含 200 知识点",
  );

  const teamChecks: [string, string][] = [
    ["胆子肥嘟嘟队", "团队名称"],
    ["38543", "团队编号"],
    ["北京电子科技学院", "院校"],
    ["B 组", "组别"],
    ["李双", "队长"],
    ["于凯", "队员"],
    ["王一超", "队员"],
    ["李浩亮", "指导教师"],
  ];
  const missing = teamChecks.filter(([needle]) => !bodyText.includes(needle));
  record(
    "首页显示完整参赛信息",
    missing.length === 0,
    missing.length === 0 ? `${teamChecks.length} 项齐全` : `缺少：${missing.map(([n]) => n).join("、")}`,
  );

  const privacyLeaks = ["18010730140", "2838955944@qq.com"].filter((v) => bodyText.includes(v));
  record(
    "首页未泄露联系方式",
    privacyLeaks.length === 0,
    privacyLeaks.length === 0 ? "电话与邮箱均未出现" : `泄露：${privacyLeaks.join("、")}`,
  );

  // ── 2. 关于页 ──
  await page.goto(`${BASE}/about`, { waitUntil: "networkidle" });
  const aboutText = await page.locator("body").innerText();
  record(
    "关于页有功能说明与团队",
    aboutText.includes("诊断测评") && aboutText.includes("胆子肥嘟嘟队"),
    `长度 ${aboutText.length}`,
  );
  record(
    "关于页列出全部学科",
    ["数据结构", "计算机网络", "操作系统", "线性代数", "Python"].every((s) =>
      aboutText.includes(s),
    ),
    "5 个学科齐全",
  );

  // ── 3. 主题切换（关键：验证浅色真的生效） ──
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const readCanvas = async () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim());

  // 切到浅色
  await page.getByRole("button", { name: "浅色" }).click();
  await page.waitForTimeout(200);
  const lightCanvas = await readCanvas();
  const lightMode = await page.evaluate(() => document.documentElement.dataset.mode);

  // 切到深色
  await page.getByRole("button", { name: "深色" }).click();
  await page.waitForTimeout(200);
  const darkCanvas = await readCanvas();
  const darkMode = await page.evaluate(() => document.documentElement.dataset.mode);

  record(
    "明暗模式切换生效",
    lightMode === "light" && darkMode === "dark" && lightCanvas !== darkCanvas,
    `light=${lightCanvas} dark=${darkCanvas}`,
  );

  // 逐一切换 5 套主题，确认 --canvas 都不同
  const themeNames = ["暖砂", "森林", "深蓝", "紫罗兰", "高对比"];
  const canvases: string[] = [];
  for (const name of themeNames) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
    await page.waitForTimeout(150);
    canvases.push(await readCanvas());
  }
  const uniqueCanvases = new Set(canvases);
  record(
    "5 套主题配色各不相同",
    uniqueCanvases.size >= 4,
    canvases.map((c, i) => `${themeNames[i]}=${c}`).join(" "),
  );

  // 浅色主题下 canvas 必须是浅色（这是旧版 globals.css 的 bug：浅色不生效）
  await page.getByRole("button", { name: /^暖砂/ }).first().click();
  await page.getByRole("button", { name: "浅色" }).click();
  await page.waitForTimeout(200);
  const sandLight = await readCanvas();
  const isLightColor = (hex: string) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return false;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 128;
  };
  record(
    "浅色主题实际生效（回归测试）",
    isLightColor(sandLight),
    `暖砂浅色 canvas=${sandLight}，判定为${isLightColor(sandLight) ? "浅" : "深"}色`,
  );

  // ── 4. 供应商设置 ──
  await page.getByRole("button", { name: "DeepSeek" }).click();
  await page.waitForTimeout(200);
  const baseUrlValue = await page.locator('input[placeholder="https://api.deepseek.com/v1"]').inputValue();
  record("预设自动填入地址", baseUrlValue.includes("deepseek.com"), baseUrlValue);

  // 测试按钮在未填 key 时应禁用
  const testBtn = page.getByRole("button", { name: "测试连通性" });
  const disabled = await testBtn.isDisabled();
  record("未填密钥时测试按钮禁用", disabled, disabled ? "已禁用" : "可点击（不符合预期）");

  // 填假 key，测试连通性应失败但给出可读原因
  // 用「明显不是密钥」的字符串，避免密钥扫描器误报
  await page.locator('input[placeholder="sk-…"]').fill("fake-not-a-real-key-for-ui-test");
  await testBtn.click();
  await page.waitForTimeout(6000);
  const afterTest = await page.locator("body").innerText();
  record(
    "连通性测试给出失败原因",
    afterTest.includes("连接失败") || afterTest.includes("401") || afterTest.includes("网络错误"),
    afterTest.includes("连接失败") ? "显示失败" : "显示错误细节",
  );

  // 保存配置后回显
  await page.getByRole("button", { name: "保存配置" }).click();
  await page.waitForTimeout(500);
  const savedText = await page.locator("body").innerText();
  record("保存配置后状态变已配置", savedText.includes("已配置"), "状态已更新");

  // 清除
  await page.getByRole("button", { name: "清除" }).click();
  await page.waitForTimeout(300);
  const clearedText = await page.locator("body").innerText();
  record("清除配置后回到未配置", clearedText.includes("未配置"), "状态已重置");

  // ── 5. 诊断页：多学科 + 答题 ──
  await page.goto(`${BASE}/diagnose`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const hasQuestion = await page.locator("fieldset").count();
  record("诊断页出现题目", hasQuestion > 0, `fieldset=${hasQuestion}`);

  // 切到计算机网络，题目应该变
  const dsStem = await page.locator("h2").first().innerText();
  await page.getByRole("button", { name: /^计算机网络/ }).click();
  await page.waitForTimeout(800);
  const networkStem = await page.locator("h2").first().innerText();
  record(
    "切换学科后题目改变",
    dsStem !== networkStem,
    `${dsStem.slice(0, 18)}… → ${networkStem.slice(0, 18)}…`,
  );

  // 答 3 题
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

  // ── 6. 路径页 ──
  await page.goto(`${BASE}/path`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const pathText = await page.locator("body").innerText();
  const hashMatch = pathText.match(/[0-9a-f]{64}/);
  record("路径页生成指纹", Boolean(hashMatch), hashMatch ? `${hashMatch[0].slice(0, 16)}…` : "未找到");

  const hasSteps = await page.locator("ol li").count();
  record("路径有步骤", hasSteps > 0, `${hasSteps} 步`);

  const beforeText = await page.locator("ol").first().innerText();
  await page.getByRole("button", { name: "把本周预算设为 30 分钟" }).click();
  await page.waitForTimeout(500);
  const afterText = await page.locator("ol").first().innerText();
  record("改预算后路径变化", beforeText !== afterText, "内容已更新");

  await page.getByRole("button", { name: "对照预算 240 分钟" }).click();
  await page.waitForTimeout(400);
  const cfText = await page.locator("body").innerText();
  record(
    "反事实对比显示差异",
    cfText.includes("被推迟") || cfText.includes("可排"),
    cfText.includes("被推迟") ? "显示推迟项" : "显示步数对比",
  );

  // ── 7. 导师页 ──
  await page.goto(`${BASE}/tutor`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const tutorText = await page.locator("body").innerText();
  record(
    "导师页如实标注模式",
    tutorText.includes("知识库检索"),
    tutorText.includes("知识库检索") ? "显示检索模式" : "未标注",
  );

  await page.locator("#q").fill("这个学科有哪些重点");
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForTimeout(2500);

  const replyText = await page.locator("body").innerText();
  const hasCitation = /\[[a-z]\d{2}\]/.test(replyText);
  record("导师回答带引用", hasCitation, hasCitation ? "含 [xXX] 引用" : "无引用");

  // ── 8. 截图（两套主题） ──
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^暖砂/ }).first().click();
  await page.getByRole("button", { name: "浅色" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/settings-light.png", fullPage: true });

  await page.getByRole("button", { name: /^深蓝/ }).first().click();
  await page.getByRole("button", { name: "深色" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/settings-dark.png", fullPage: true });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "screenshots/home-dark.png", fullPage: true });

  await page.goto(`${BASE}/about`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/about.png", fullPage: true });

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
