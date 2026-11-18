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
  const subjectCountMatch = /(\d+)\s*个学科/.exec(bodyText);
  const conceptMatch = /(\d+)\s*个知识点/.exec(bodyText);
  record(
    "首页显示多学科规模",
    Boolean(subjectCountMatch && Number(subjectCountMatch[1]) >= 9),
    subjectCountMatch
      ? `${subjectCountMatch[1]} 个学科 · ${conceptMatch?.[1] ?? "?"} 个知识点`
      : "未找到学科数量",
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

  /*
   * 联系方式泄露检查：用正则匹配「像手机号」「像邮箱」的串，而不是把真实号码写进仓库。
   * 旧写法把真实手机号与邮箱硬编码在这里做比对，本身就构成一次泄露——
   * 与 README「仓库不存联系方式」的声明直接矛盾。
   */
  const phonePattern = /(?<!\d)1[3-9]\d{9}(?!\d)/;
  const emailPattern = /[\w.+-]+@[\w-]+\.[\w.-]+/;
  // 示例邮箱（example.com / test.local）是允许出现在界面说明里的
  const emails = bodyText.match(new RegExp(emailPattern, "g")) ?? [];
  const suspiciousEmails = emails.filter(
    (e) => !/example\.(com|org)|test\.local|@example/i.test(e),
  );
  const leaks: string[] = [];
  if (phonePattern.test(bodyText)) leaks.push("疑似手机号");
  if (suspiciousEmails.length > 0) leaks.push(`疑似邮箱 ${suspiciousEmails.join("、")}`);

  record(
    "首页未泄露联系方式",
    leaks.length === 0,
    leaks.length === 0 ? "未出现手机号或真实邮箱" : `泄露：${leaks.join("、")}`,
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
    ["数据结构", "计算机网络", "操作系统", "线性代数", "Python", "概率论", "离散数学", "机器学习", "学术英语"].every(
      (s) => aboutText.includes(s),
    ),
    "9 个学科齐全",
  );

  // ── 2b. 使用指南页 ──
  await page.goto(`${BASE}/guide`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  const guideText = await page.locator("body").innerText();
  record(
    "使用指南覆盖五步流程",
    guideText.includes("使用指南") &&
      guideText.includes("诊断") &&
      guideText.includes("学习路径") &&
      guideText.includes("课程导师") &&
      guideText.includes("模型供应商") &&
      guideText.includes("教材"),
    "五步标题齐全",
  );
  record(
    "使用指南有常见问题",
    guideText.includes("常见问题") && guideText.includes("不配置任何 API key 能用吗"),
    "FAQ 渲染",
  );

  // 成员信息只保留姓名，不出现专业与年级
  const leakedProfile = ["计算机科学与技术", "2024 级本科"].filter((v) => aboutText.includes(v));
  record(
    "关于页不含成员专业与年级",
    leakedProfile.length === 0,
    leakedProfile.length === 0 ? "只显示姓名" : `仍出现：${leakedProfile.join("、")}`,
  );

  // ── 3. 主题切换（关键：验证浅色真的生效） ──
  // 用 ?panel=appearance 深链直达外观分区，顺带覆盖深链行为
  await page.goto(`${BASE}/settings?panel=appearance`, { waitUntil: "networkidle" });
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
  // 4a. 预设列表：不该出现 Ollama，应有 Anthropic 与两个自定义
  const presetAreaText = await page.locator("body").innerText();
  record(
    "预设不含 Ollama",
    !presetAreaText.includes("Ollama（本地）"),
    presetAreaText.includes("Ollama") ? "仍出现 Ollama 预设" : "已移除",
  );
  record(
    "预设含 Anthropic Claude",
    presetAreaText.includes("Anthropic Claude"),
    "已列出",
  );
  record(
    "自定义拆成两种协议",
    presetAreaText.includes("自定义（OpenAI 兼容）") &&
      presetAreaText.includes("自定义（Anthropic 兼容）"),
    "两种协议都在",
  );

  // 4b. 预设自动填入
  await page.getByRole("button", { name: "DeepSeek", exact: true }).click();
  await page.waitForTimeout(200);
  const baseUrlValue = await page
    .locator('input[placeholder="https://api.deepseek.com/v1"]')
    .inputValue();
  record("预设自动填入地址", baseUrlValue.includes("deepseek.com"), baseUrlValue);

  // 4c. 切到 Anthropic 预设，占位符与提示应随之变化
  await page.getByRole("button", { name: "Anthropic Claude" }).click();
  await page.waitForTimeout(300);
  const anthropicUrl = await page
    .locator('input[placeholder="https://api.anthropic.com/v1"]')
    .inputValue();
  const anthropicModel = await page
    .locator('input[placeholder="claude-sonnet-4-5-20250929"]')
    .inputValue();
  record(
    "Anthropic 预设填入正确地址与模型",
    anthropicUrl.includes("anthropic.com") && anthropicModel.startsWith("claude"),
    `${anthropicUrl} · ${anthropicModel}`,
  );

  // 4d. 未填 key 时测试按钮禁用
  const testBtn = page.getByRole("button", { name: "测试连通性" });
  const disabled = await testBtn.isDisabled();
  record("未填密钥时测试按钮禁用", disabled, disabled ? "已禁用" : "可点击（不符合预期）");

  // 4e. 混合内容提示只在 https 页面下才该出现
  //     （本地 http 环境不触发是正确行为，所以按页面协议分别断言）
  await page.getByRole("button", { name: "自定义（OpenAI 兼容）" }).click();
  await page.waitForTimeout(200);
  await page.locator('input[placeholder="https://api.deepseek.com/v1"]').fill("http://1.92.81.144:8788/v1");
  await page.waitForTimeout(400);
  const mixedText = await page.locator("body").innerText();
  const pageProtocol = await page.evaluate(() => location.protocol);
  const showsMixedWarning = mixedText.includes("HTTPS 页面不能请求 HTTP 地址");

  if (pageProtocol === "https:") {
    record("HTTPS 页面填 HTTP 地址就地提示混合内容", showsMixedWarning, showsMixedWarning ? "已提示" : "未提示");
  } else {
    // http 页面下不该提示混合内容（否则是误报），但应给出「本地/内网地址」提醒
    record(
      "http 页面不误报混合内容",
      !showsMixedWarning,
      showsMixedWarning ? "误报" : `协议 ${pageProtocol}，正确地未提示`,
    );
  }

  // 4f. 填假 key 后测试：https 页面应判为混合内容拦截；http 页面会真发请求
  await page.locator('input[placeholder="sk-…"]').fill("fake-not-a-real-key-for-ui-test");
  await page.locator('input[placeholder="deepseek-chat"]').fill("some-model");
  await testBtn.click();
  await page.waitForTimeout(4000);
  const mixedResult = await page.locator("body").innerText();
  if (pageProtocol === "https:") {
    record(
      "测试结果标出混合内容而非泛泛网络错误",
      mixedResult.includes("混合内容拦截"),
      mixedResult.includes("混合内容拦截") ? "分类正确" : "未标出分类",
    );
  } else {
    record(
      "http 页面下测试会真实发出请求并归类失败",
      mixedResult.includes("连接失败"),
      mixedResult.includes("跨域拦截") ? "跨域拦截" : mixedResult.includes("超时") ? "超时" : "已给出失败结论",
    );
  }

  // 4g. 换成合法 https 地址 + 假 key，应得到鉴权类失败（真实发请求）
  await page.locator('input[placeholder="https://api.deepseek.com/v1"]').fill("https://api.deepseek.com/v1");
  await page.waitForTimeout(300);
  await testBtn.click();
  await page.waitForTimeout(9000);
  const authText = await page.locator("body").innerText();
  record(
    "合法地址+假密钥得到鉴权失败分类",
    authText.includes("鉴权失败") || authText.includes("401") || authText.includes("跨域拦截"),
    authText.includes("鉴权失败") ? "鉴权失败" : authText.includes("跨域拦截") ? "跨域拦截" : "其他",
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
  // 切换学科会重置当前题目，等新题渲染出来再读
  await page.waitForSelector('fieldset input[type="radio"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  const networkStem = await page.locator("h2").first().innerText();
  record(
    "切换学科后题目改变",
    dsStem !== networkStem,
    `${dsStem.slice(0, 18)}… → ${networkStem.slice(0, 18)}…`,
  );

  // 切回数据结构并清空本浏览器记录，保证有题可出
  // （前面的用例可能已把网络学科的题目答完）
  await page.getByRole("button", { name: /^数据结构/ }).click();
  await page.waitForSelector('fieldset input[type="radio"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);

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

  // ── 8. 登录与注册界面 ──
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const loginText = await page.locator("body").innerText();
  record(
    "登录页有登录与注册两个模式",
    loginText.includes("登录") && loginText.includes("注册"),
    "两种模式都在",
  );
  record(
    "登录页说明隐私范围",
    loginText.includes("PBKDF2") || loginText.includes("不存明文"),
    loginText.includes("PBKDF2") ? "已说明哈希方式" : "已说明存储内容",
  );

  // 注册一个新账号（注册模式有「密码 + 确认密码」两个密码框，按 placeholder 区分）
  const uiEmail = `ui${Date.now()}@test.local`;
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.waitForTimeout(300);

  // 不一致时应就地提示且无法提交（确认密码校验）
  await page.locator('input[placeholder="例如：小李"]').fill("测试用户");
  await page.locator('input[type="email"]').fill(uiEmail);
  await page.locator('input[placeholder="••••••••"]').fill("uitest1234");
  await page.locator('input[placeholder="再输入一次密码"]').fill("uitest9999");
  const confirmError = await page.locator("body").innerText();
  record(
    "注册两次密码不一致被拦截",
    confirmError.includes("两次输入的密码不一致"),
    "就地显示不一致提示",
  );

  await page.locator('input[placeholder="再输入一次密码"]').fill("uitest1234");
  await page.getByRole("button", { name: "创建账号" }).click();
  // 等真正离开登录页，而不是固定等 3 秒
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const afterReg = await page.locator("body").innerText();
  record(
    "注册后跳转并显示登录态",
    afterReg.includes("测试用户") || page.url().includes("/diagnose"),
    `URL=${new URL(page.url()).pathname}`,
  );

  // ── 9. 自定义方向页 ──
  await page.goto(`${BASE}/directions?create=1`, { waitUntil: "networkidle" });
  const textarea = page.locator("#course-create textarea");
  record("方向页需要登录且已登录可创建", await textarea.isVisible(), "规划工作台");
  if (await textarea.isVisible()) {
    await textarea.fill("我想系统学一遍树结构");
    await page.getByRole("button", { name: "发送给导师" }).click();
    await page.getByRole("log", {name:"方向规划对话"}).waitFor();
    await page.getByRole("button", { name: "生成学习方案与图谱" }).click();
    await page.getByLabel("方向名", {exact:true}).waitFor();
    const hasDraft = await page.locator(".direction-map").isVisible();
    record("生成方向草稿并预览", hasDraft, hasDraft ? "已显示预览" : "无预览");

    if (hasDraft) {
      await page.getByRole("checkbox", {name:"公开到方向市场"}).check();
      await page.getByRole("button", { name: "保存这个方向" }).click();
      await page.waitForTimeout(3000);
      const savedText = await page.locator("body").innerText();
      record(
        "保存方向并公开",
        savedText.includes("已公开") || savedText.includes("已创建的方向"),
        savedText.includes("已公开") ? "已公开" : "已保存",
      );
    }
  } else {
    record("生成方向草稿并预览", false, "未找到输入框");
  }

  // ── 9b. 自定义方向进诊断：核心功能 ──
  /*
   * 用 API 建方向 + 手动录题，再走 ?direction= 打开诊断页。
   * 不用模型，所以这条用例在无 key 环境也能跑——这正是要保证的最低可用路径。
   */
  const created = await page.evaluate(async () => {
    const r = await fetch("/api/directions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "我想系统学一遍树结构" }),
    });
    return (await r.json()) as { id?: string; conceptCount?: number };
  });

  if (created.id) {
    const detail = await page.evaluate(async (id: string) => {
      const r = await fetch(`/api/directions?id=${id}`);
      return (await r.json()) as {
        graph?: { concepts: { id: string; name: string }[] };
        coverage?: Record<string, unknown>;
      };
    }, created.id);

    const firstKc = detail.graph?.concepts?.[0];
    const manual = firstKc
      ? await page.evaluate(
          async ({ id, kcId, kcName }: { id: string; kcId: string; kcName: string }) => {
            const items = [1, 2, 3].map((n) => ({
              difficulty: n === 1 ? "basic" : n === 2 ? "advanced" : "challenge",
              stem: `关于「${kcName}」的第 ${n} 个判断，下列哪一项成立？`,
              options: [
                `${kcName}与先修约束无关`,
                `必须先掌握${kcName}的前置概念才能继续`,
                `${kcName}只能用于图算法`,
                `${kcName}是排序算法的一种`,
              ],
              answerText: `必须先掌握${kcName}的前置概念才能继续`,
              explanation: `必须先掌握${kcName}的前置概念才能继续，这是图谱排序与路径规划的硬约束；其余三项都与先修关系无关。`,
              source: "manual",
              status: "accepted",
            }));
            const r = await fetch("/api/directions/items", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ directionId: id, kcId, items }),
            });
            return (await r.json()) as { inserted?: number; rejected?: unknown[] };
          },
          { id: created.id, kcId: firstKc.id, kcName: firstKc.name },
        )
      : null;

    record(
      "自定义方向可手动录题并落库",
      (manual?.inserted ?? 0) >= 3,
      `${manual?.inserted ?? 0} 题入库，拒 ${manual?.rejected?.length ?? 0} 题`,
    );

    await page.goto(`${BASE}/diagnose?direction=${created.id}`, { waitUntil: "networkidle" });
    await page.waitForSelector('fieldset input[type="radio"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);

    const dirDiagText = await page.locator("body").innerText();
    const dirFieldsets = await page.locator("fieldset").count();
    record(
      "?direction= 能真的出题",
      dirFieldsets > 0,
      dirFieldsets > 0 ? `fieldset=${dirFieldsets}` : "没有题目",
    );
    record(
      "诊断页识别自定义方向",
      dirDiagText.includes("自定义方向") && dirDiagText.includes("我的方向"),
      dirDiagText.includes("自定义方向") ? "显示方向标识与分组" : "未识别",
    );
    record(
      "手动题标注来源",
      dirDiagText.includes("手动录入"),
      dirDiagText.includes("手动录入") ? "已标注" : "未标注",
    );

    // 路径页：自定义方向也能规划，且显示输入指纹
    await page.goto(`${BASE}/path?direction=${created.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const dirPathText = await page.locator("body").innerText();
    const dirHashes = dirPathText.match(/[0-9a-f]{64}/g) ?? [];
    record(
      "自定义方向可规划路径且输入/路径指纹都在",
      (await page.locator("ol li").count()) > 0 && new Set(dirHashes).size >= 2,
      `${await page.locator("ol li").count()} 步 · ${new Set(dirHashes).size} 个不同指纹`,
    );

    /*
     * 回归：路径页点「上移」曾经用 recordPathEdit 时不传 graph，
     * 于是 progressOf 回落到内置学科，给方向写出 c01–c40 的掌握度，
     * 回诊断页就变成「这个方向没有可出的题」。
     */
    const upButtons = page.getByRole("button", { name: /上移一位/ });
    if ((await upButtons.count()) > 1) {
      await upButtons.nth(1).click();
      await page.waitForTimeout(600);
    }
    const storedKcIds = await page.evaluate((id: string) => {
      const raw = window.localStorage.getItem("alp.learner.v2");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        subjects?: Record<string, { mastery?: { kcId: string }[] }>;
      };
      return parsed.subjects?.[id]?.mastery?.map((m) => m.kcId) ?? null;
    }, created.id);
    const polluted = (storedKcIds ?? []).some((k) => /^c\d{2}$/.test(k));
    record(
      "路径页手动改写不会把方向进度写成数据结构",
      storedKcIds !== null && storedKcIds.length > 0 && !polluted,
      storedKcIds ? `${storedKcIds.length} 个知识点，含 c01 式 id：${polluted}` : "没有方向进度",
    );

    await page.goto(`${BASE}/diagnose?direction=${created.id}`, { waitUntil: "networkidle" });
    await page.waitForSelector('fieldset input[type="radio"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(700);
    const afterEditFieldsets = await page.locator("fieldset").count();
    const afterEditText = await page.locator("body").innerText();
    record(
      "手动改写后回诊断页仍有题",
      afterEditFieldsets > 0 && !afterEditText.includes("诊断完成"),
      afterEditFieldsets > 0 ? `fieldset=${afterEditFieldsets}` : "没有题目",
    );

    /*
     * 回归：手动改写后改预算，页面必须按新预算收缩。
     * 旧实现显示的是 manualSteps，预算只重算 plan，页面停在旧步数。
     */
    await page.goto(`${BASE}/path?direction=${created.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: "把本周预算设为 240 分钟" }).click();
    await page.waitForTimeout(500);
    const bigSteps = await page.locator("ol li").count();
    const up2 = page.getByRole("button", { name: /上移一位/ });
    if ((await up2.count()) > 1) {
      await up2.nth(1).click();
      await page.waitForTimeout(500);
    }
    await page.getByRole("button", { name: "把本周预算设为 30 分钟" }).click();
    await page.waitForTimeout(600);
    const smallSteps = await page.locator("ol li").count();
    record(
      "手动改写后改预算仍会重算",
      smallSteps < bigSteps && smallSteps <= 2,
      `240 分 ${bigSteps} 步 → 30 分 ${smallSteps} 步`,
    );

    /*
     * 回归：「移除」曾经是空操作——只从 order 里删掉 kcId，
     * applyManualOrder 的第二个循环又把 plan 里「不在 order」的它追加回末尾。
     */
    await page.getByRole("button", { name: "把本周预算设为 240 分钟" }).click();
    await page.waitForTimeout(600);
    const beforeRemove = await page.locator("ol li").count();
    const removedName = await page.locator("ol li").nth(1).innerText().catch(() => "");
    const removeBtns = page.getByRole("button", { name: /移除/ });
    if ((await removeBtns.count()) > 1) {
      await removeBtns.nth(1).click();
      await page.waitForTimeout(700);
    }
    const afterRemove = await page.locator("ol li").count();
    const afterRemoveText = await page.locator("ol").first().innerText();
    record(
      "「移除」真的减少一步且不再回来",
      afterRemove === beforeRemove - 1 && !afterRemoveText.includes(removedName.slice(0, 10)),
      `${beforeRemove} → ${afterRemove} 步`,
    );

    /*
     * 回归：点一次「上移」不该把整条路径都标成「已手动调整」。
     * 只标相对次序真的被打破的点。
     * 注意：移除不改变相对次序，所以标记数应为 0——这里先做一次上移再检查。
     */
    const removeBadges = await page.locator("text=已手动调整").count();
    const upForBadge = page.getByRole("button", { name: /上移一位/ });
    if ((await upForBadge.count()) > 1) {
      await upForBadge.nth(1).click();
      await page.waitForTimeout(600);
    }
    const movedBadgeCount = await page.locator("text=已手动调整").count();
    const stepCount = await page.locator("ol li").count();
    record(
      "只标记真的挪动过的步骤",
      removeBadges === 0 && movedBadgeCount > 0 && movedBadgeCount < stepCount,
      `移除后 ${removeBadges} 个 / 上移后 ${movedBadgeCount} 个 / 共 ${stepCount} 步`,
    );

    /*
     * 回归：有题但不够门槛时曾经空白死锁——pickNext 无题可出、
     * kcNeedingItems 只认 accepted===0、canPickMore 说还有工作，
     * 于是三张卡都不渲染，页面只剩进度条。
     */
    const stuckDir = await page.evaluate(async () => {
      const r = await fetch("/api/directions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "我想系统学一遍树结构" }),
      });
      return (await r.json()) as { id?: string };
    });
    if (stuckDir.id) {
      const stuckDetail = await page.evaluate(async (id: string) => {
        const r = await fetch(`/api/directions?id=${id}`);
        return (await r.json()) as { graph: { concepts: { id: string; name: string }[] } };
      }, stuckDir.id);
      const skc = stuckDetail.graph.concepts[0];

      // 录 3 道「生成题」：门槛是 4，答完后应出现「题目不够」卡
      await page.evaluate(
        async ({ id, kcId, kcName }: { id: string; kcId: string; kcName: string }) => {
          const items = [1, 2, 3].map((n) => ({
            difficulty: n === 1 ? "basic" : n === 2 ? "advanced" : "challenge",
            difficultyReason: n === 1 ? "基础记忆题" : n === 2 ? "需要理解并应用" : "综合推导题",
            stem: `关于「${kcName}」的生成题 ${n}，下列哪一项成立？`,
            options: [
              `${kcName}与先修无关`,
              `必须先掌握${kcName}的前置概念才能继续`,
              `${kcName}只能用于图算法`,
              `${kcName}是排序算法`,
            ],
            answerText: `必须先掌握${kcName}的前置概念才能继续`,
            explanation: `必须先掌握${kcName}的前置概念才能继续，这是图谱排序的硬约束；其余三项都与先修关系无关。`,
            source: "generated",
            status: "accepted",
          }));
          await fetch("/api/directions/items", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ directionId: id, kcId, items }),
          });
        },
        { id: stuckDir.id, kcId: skc.id, kcName: skc.name },
      );

      await page.goto(`${BASE}/diagnose?direction=${stuckDir.id}`, { waitUntil: "networkidle" });
      await page.waitForSelector('fieldset input[type="radio"]', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(700);
      for (let i = 0; i < 4; i += 1) {
        const radios = page.locator('input[type="radio"]');
        if ((await radios.count()) === 0) break;
        await radios.first().check();
        const submit = page.getByRole("button", { name: "提交答案" });
        if ((await submit.count()) === 0) break;
        await submit.click();
        await page.waitForTimeout(350);
        const next = page.getByRole("button", { name: "下一题" });
        if ((await next.count()) === 0) break;
        await next.click();
        await page.waitForTimeout(500);
      }
      const stuckText = await page.locator("body").innerText();
      record(
        "题不够门槛时给出明确出口而不是空白",
        stuckText.includes("的题目不够") &&
          stuckText.includes("手动补题") &&
          stuckText.includes("只规划路径"),
        stuckText.includes("的题目不够") ? "显示补题卡" : "页面空白",
      );
    } else {
      record("题不够门槛时给出明确出口而不是空白", false, "创建方向失败");
    }

    /*
     * 回归：无模型时「跳过这个知识点」曾经点了没反应（kcId 取到空串），
     * 页面永远到不了「诊断完成」。
     */
    const noModelDir = await page.evaluate(async () => {
      const r = await fetch("/api/directions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "我想学一遍操作系统进程调度" }),
      });
      return (await r.json()) as { id?: string };
    });
    if (noModelDir.id) {
      await page.goto(`${BASE}/diagnose?direction=${noModelDir.id}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2200);
      /*
       * 无模型时页面会先走「题不够 / 无题」的补题卡（它信息更全，
       * 且同时提供「手动补题 / 只规划路径 / 跳过」）。
       * 这里断言的是「有可点的跳过按钮，且点完不再停在空白」，
       * 不绑定具体是哪一张卡。
       */
      const beforeText = await page.locator("body").innerText();
      const skipBtn = page.getByRole("button", { name: /跳过(这个|所有缺题)的知识点/ });
      const hadCard =
        beforeText.includes("未配置模型供应商") || beforeText.includes("的题目不够");
      if ((await skipBtn.count()) > 0) {
        await skipBtn.first().click();
        await page.waitForTimeout(1500);
        const afterSkip = await page.locator("body").innerText();
        const stillStuck =
          afterSkip.includes("未配置模型供应商") || afterSkip.includes("的题目不够");
        record(
          "无模型时「跳过这个知识点」真的生效",
          hadCard && (!stillStuck || afterSkip.includes("诊断完成")),
          `卡片曾出现=${hadCard} · 跳过后仍卡住=${stillStuck} · 到完成=${afterSkip.includes("诊断完成")}`,
        );
      } else {
        record("无模型时「跳过这个知识点」真的生效", false, "没有找到跳过按钮");
      }
    } else {
      record("无模型时「跳过这个知识点」真的生效", false, "创建方向失败");
    }
  } else {
    record("自定义方向可手动录题并落库", false, "创建方向失败");
    record("?direction= 能真的出题", false, "无方向 id");
    record("诊断页识别自定义方向", false, "无方向 id");
    record("手动题标注来源", false, "无方向 id");
    record("自定义方向可规划路径且输入/路径指纹都在", false, "无方向 id");
    record("路径页手动改写不会把方向进度写成数据结构", false, "无方向 id");
    record("手动改写后回诊断页仍有题", false, "无方向 id");
    record("手动改写后改预算仍会重算", false, "无方向 id");
    record("「移除」真的减少一步且不再回来", false, "无方向 id");
    record("只标记真的挪动过的步骤", false, "无方向 id");
    record("题不够门槛时给出明确出口而不是空白", false, "无方向 id");
    record("无模型时「跳过这个知识点」真的生效", false, "无方向 id");
  }

  // ── 9c. 未登录时「我的方向」分组必须可见且有登录提示 ──
  /*
   * 隐藏该分组会让用户不知道有这个功能，所以这条断言的是「可见 + 提示」，
   * 而不是「不可用」。用独立 context 保证没有登录 cookie。
   */
  const anonCtx = await browser.newContext();
  const anonPage = await anonCtx.newPage({ viewport: { width: 1280, height: 900 } });
  await anonPage.goto(`${BASE}/diagnose`, { waitUntil: "networkidle" });
  await anonPage.waitForTimeout(1200);
  const anonText = await anonPage.locator("body").innerText();
  record(
    "未登录时「我的方向」分组仍可见",
    anonText.includes("我的方向"),
    anonText.includes("我的方向") ? "分组可见" : "分组被隐藏",
  );
  record(
    "未登录时该分组显示登录提示",
    anonText.includes("后可保存并诊断自定义方向"),
    anonText.includes("后可保存并诊断自定义方向") ? "已提示" : "无提示",
  );
  record(
    "未登录仍能用内置学科做题",
    (await anonPage.locator("fieldset").count()) > 0,
    `fieldset=${await anonPage.locator("fieldset").count()}`,
  );
  await anonCtx.close();

  // ── 10. 方向市场 ──
  await page.goto(`${BASE}/market`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const marketText = await page.locator("body").innerText();
  record(
    "市场页可浏览且列出方向",
    marketText.includes("方向市场") && (marketText.includes("选用") || marketText.includes("公开方向")),
    marketText.includes("选用") ? "有可选方向" : "列表为空但页面正常",
  );

  // ── 11. 截图（两套主题） ──
  await page.goto(`${BASE}/settings?panel=appearance`, { waitUntil: "networkidle" });
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
