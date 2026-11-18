import { chromium } from "playwright";
import { take, installPointer, pause } from "./live-camera.mjs";
const base = "https://chuanzhi.jasonsome.cn";
const browser = await chromium.launch({
  args: ["--hide-scrollbars", "--disable-background-timer-throttling"],
});
const native = process.env.NATIVE_DETAIL === "1";
const ctx = await browser.newContext({
  viewport: native
    ? { width: 2304, height: 1296 }
    : { width: 1440, height: 810 },
  deviceScaleFactor: 1,
  locale: "zh-CN",
});
await installPointer(ctx);
const p = await ctx.newPage();
p.setDefaultTimeout(15000);
const email = process.env.DEMO_EMAIL,
  password = process.env.DEMO_PASSWORD;
if (!email || !password) throw Error("Set demo credentials.");
const btn = (name, view = p) => view.getByRole("button", { name, exact: true });
const go = async (route) => {
  await p.goto(base + route);
  await p.locator("main").waitFor();
  await p.evaluate(() => document.fonts.ready);
};
const record = (name, len, body) => take(p, name, len, body);
async function login() {
  await go("/login");
  const submit = p.locator(".login-submit");
  await submit.waitFor();
  await record("open", 19, async ({ at, focus }) => {
    await at(6);
    await focus(p.getByRole("heading", { name: "登录账号" }), 1.15);
  });
  await record("login", 13, async ({ at, click, focus, wide }) => {
    const address = p.getByLabel("邮箱", { exact: true }),
      pass = p.getByLabel("密码", { exact: true });
    await click(address, 1.34);
    await address.pressSequentially(email, { delay: 44 });
    if ((await pass.getAttribute("type")) !== "password")
      throw Error("Password must be masked.");
    await click(pass, 1.34);
    await pass.fill(password);
    await at(3.7);
    await click(submit, 1.34);
    await p.waitForURL(base + "/");
    wide();
    await p.getByRole("heading", { name: "学习概览" }).waitFor();
    const course = p.getByLabel("当前学习目标").first();
    if (await course.isVisible()) {
      await at(8);
      await focus(course, 1.25);
      await course.selectOption("data-structures");
    }
  });
}
async function tour() {
  await go("/diagnose?subject=data-structures&kc=c09");
  const option = p.locator(".question-option").first();
  await option.waitFor();
  console.log(
    "题面",
    await p
      .locator("main")
      .innerText()
      .then((t) => t.slice(0, 320)),
  );
  const feedback = p.locator("[data-answer-feedback]");
  await record("diagnose", 18, async ({ at, click, focus }) => {
    await focus(option, 1.35);
    await at(7);
    await click(option, 1.4);
    await at(13);
    await click(btn("提交答案"), 1.4);
    await feedback.waitFor();
  });
  await record("feedback", 16, async ({ at, focus }) => {
    await focus(feedback, 1.48);
    await at(6);
    await focus(option, 1.35);
    await at(11);
    await focus(feedback, 1.45);
  });
  await graph();
}
async function graph() {
  await go("/path?subject=data-structures&budget=30");
  const canvas = p.locator(".knowledge-canvas");
  const node = (id) =>
    canvas.locator('.react-flow__node[data-id="' + id + '"]');
  await canvas.waitFor();
  if (!(await node("c10").count())) await btn("全科关系").click();
  await node("c10").waitFor();
  await pause(850);
  const center = async (loc) => {
    await loc.evaluate((el) =>
      el.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    await pause(650);
  };
  const detail = p.locator(".knowledge-inspector-main");
  await center(canvas);
  await record("nodes", 21, async ({ at, click, focus }) => {
    await at(0.8);
    await click(node("c05"), 1.32);
    await pause(800);
    await focus(node("c05"), 1.65);
    await at(6);
    await click(node("c09"), 1.57);
    await pause(750);
    await at(9);
    await center(detail);
    await focus(detail.locator("h2"), 1.52);
    await at(12.4);
    await center(canvas);
    await click(btn("查看完整图谱"), 1.07);
    await pause(550);
    await click(node("c10"), 1.45);
    await pause(650);
    await focus(node("c10"), 1.65);
    await at(17.4);
    await center(detail);
    await focus(detail.locator(".concept-prerequisites"), 1.55);
  });
  if (process.argv[2] === "nodes") return;
  await budgets();
}
async function budgets() {
  if (process.argv[2] === "budgets") {
    await go("/path?subject=data-structures&budget=30");
    await btn("全科关系").click();
  }
  const canvas = p.locator(".knowledge-canvas");
  const toggle = btn("当前路径");
  const budget = p.getByLabel("本次学习预算", { exact: true });
  const chapter = p.locator(".path-chapter-trigger");
  const nodes = canvas.locator(".react-flow__node");
  const sequence = p.locator(".knowledge-sequence li");
  const graphView = async () => {
    await canvas.evaluate((el) =>
      el.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await btn("查看完整图谱").click();
    await pause(550);
  };
  async function snapshot() {
    if ((await toggle.getAttribute("aria-pressed")) !== "true")
      throw Error("当前路径未选中");
    return {
      graph: await nodes.evaluateAll((els) =>
        els.map((el) => [el.dataset.id, el.getAttribute("aria-label")]),
      ),
      plan: await sequence.allInnerTexts(),
      ids: await sequence.evaluateAll((els) => els.map((el) => el.dataset.kc)),
      total: await p.locator(".knowledge-sequence-heading span").innerText(),
    };
  }
  await record("path30", 17, async ({ at, click, focus, wide }) => {
    await click(chapter, 1.15);
    const choice = p
      .getByRole("dialog")
      .getByText(/第\s*3\s*章\s*栈与队列/)
      .first();
    await click(choice, 1.42);
    await p.keyboard.press("Escape");
    await at(4);
    await click(toggle, 1.35);
    await at(7);
    await focus(budget, 1.35);
    await budget.hover();
    await budget.selectOption("30");
    await at(9.5);
    wide();
    await graphView();
    await focus(canvas, 1.12);
  });
  const before = await snapshot();
  await record("path60", 21, async ({ at, click, focus, wide }) => {
    await focus(canvas, 1.12);
    await at(4.5);
    await click(budget, 1.3);
    await p.keyboard.press("Escape");
    await budget.selectOption("60");
    await pause(350);
    wide();
    await graphView();
    await focus(canvas, 1.12);
    const state = await snapshot();
    const newId = state.ids.find((id) => !before.ids.includes(id));
    if (!newId) throw Error("预算没有增加学习步骤");
    const added = canvas.locator(`.react-flow__node[data-id="${newId}"]`);
    await at(12.5);
    await focus(added, 1.44);
    await added.hover();
    await at(17);
    await focus(p.locator(".knowledge-sequence li").last(), 1.38);
  });
  const after = await snapshot();
  console.log("30/60 路径实测", JSON.stringify({ before, after }));
  if (
    JSON.stringify(before.graph) === JSON.stringify(after.graph) ||
    before.plan.length === after.plan.length
  )
    throw Error("画布和清单必须真实反映预算变化");
  await record("timeBasis", 18, async ({ at, click, focus }) => {
    const how = p.getByText("用时如何估算", { exact: true });
    await click(how, 1.45);
    const row = how
      .locator("..")
      .getByText("顺序表", { exact: true })
      .first()
      .locator("..");
    await at(4);
    await focus(row.locator("strong"), 1.8);
    console.log(
      "估算来源",
      await how.locator("../..").getByRole("status").innerText(),
      "顺序表",
      await row.innerText(),
    );
  });
}

async function mistakes() {
  await go("/mistakes?subject=data-structures");
  const filter = p.getByLabel("按知识点筛选错题");
  await filter.waitFor();
  await record("mistakes", 13, async ({ at, click, focus }) => {
    await focus(p.getByRole("heading", { name: "错题本", exact: true }), 1.25);
    await at(1.6);
    await click(filter, 1.2);
    await p.keyboard.press("Escape");
    await filter.selectOption("c09");
    const item = p
      .locator("li")
      .filter({ has: p.getByRole("checkbox", { name: /入栈序列.*不可能/ }) })
      .first();
    await focus(item.getByRole("checkbox").locator(".."), 1.32);
    await at(5.3);
    await click(item.getByRole("button", { name: "显示答案与解析" }), 1.38);
    await at(8);
    await focus(item.getByText(/若 3 先出栈|若3先出栈/).first(), 1.38);
    await at(10.8);
    await click(item.getByRole("link", { name: "重做这道题" }), 1.25);
    await p.waitForURL("**/diagnose?**");
  });
}

async function appearanceGraphs() {
  for (const [layout, theme, takeName] of [
    ["章节", "暖砂", "chapterGraph"],
    ["导览", "深蓝", "overviewGraph"],
    ["地图", "橄榄", "oliveGraph"],
  ]) {
    await go("/settings?panel=appearance");
    const layoutButton = p
      .getByRole("group", { name: "工作台布局" })
      .getByRole("button", { name: new RegExp(layout) });
    const themeButton = p
      .getByRole("group", { name: "配色主题" })
      .getByRole("button", { name: theme, exact: true });
    await layoutButton.click();
    await themeButton.click();
    if (
      (await layoutButton.getAttribute("aria-pressed")) !== "true" ||
      (await themeButton.getAttribute("aria-pressed")) !== "true"
    )
      throw Error("组合选择失败");
    await go("/path?subject=data-structures&budget=60");
    const canvas = p.locator(".knowledge-canvas");
    await canvas.locator(".react-flow__node").first().waitFor();
    await canvas.evaluate((el) =>
      el.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await p.getByRole("button", { name: "查看完整图谱" }).click();
    await pause(500);
    await record(takeName, 3, async () => {
      await p.mouse.move(32, 95, { steps: 18 });
    });
  }
}
async function settings() {
  await go("/settings?panel=appearance");
  const layouts = p.getByRole("group", { name: "工作台布局" });
  const colors = p.getByRole("group", { name: "配色主题" });
  await layouts.waitFor();
  const layout = (name) =>
    layouts.getByRole("button", { name: new RegExp(name) });
  const color = (name) => colors.getByRole("button", { name, exact: true });
  async function verifyPair(l, t) {
    if (
      (await layout(l).getAttribute("aria-pressed")) !== "true" ||
      (await color(t).getAttribute("aria-pressed")) !== "true"
    )
      throw Error("外观组合未生效：" + l + " / " + t);
    console.log("实录外观", l, t);
  }
  await verifyPair("地图", "橄榄");
  await record("appearance", 15, async ({ at, click, wide }) => {
    await at(0.6);
    await click(layout("章节"), 1.07);
    await click(color("暖砂"), 1.1);
    await verifyPair("章节", "暖砂");
    wide();
    await at(5.1);
    await click(layout("导览"), 1.07);
    await click(color("深蓝"), 1.1);
    await verifyPair("导览", "深蓝");
    wide();
    await at(10.5);
    await click(layout("地图"), 1.07);
    await click(color("橄榄"), 1.1);
    await verifyPair("地图", "橄榄");
    wide();
  });
  await record("modelTools", 10, async ({ at, click, focus }) => {
    await click(btn("模型与工具"), 1.12);
    await at(2);
    await click(p.getByRole("tab", { name: "模型供应商" }), 1.18);
    await at(5.8);
    await click(p.getByRole("tab", { name: "联网搜索" }), 1.18);
    await focus(
      p
        .getByRole("tabpanel", { name: "联网搜索" })
        .getByRole("heading")
        .first(),
      1.3,
    );
  });
  await record("basis", 13, async ({ at, click, focus }) => {
    await click(btn("资料与口径"), 1.13);
    const basis = p.getByText("口径基源", { exact: true });
    await focus(basis, 1.42);
    await at(4);
    await click(
      p
        .locator('input[name="material-basis"][value="materials"]')
        .locator(".."),
      1.25,
    );
    await at(8);
    await focus(p.getByText("内置资料包来源", { exact: true }), 1.38);
  });
}

async function tutor() {
  await go("/tutor?subject=data-structures&kc=c09");
  const field = p.locator("#q");
  await field.waitFor();
  await p.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="辅导消息"]')
        ?.getAttribute("aria-busy") === "false",
  );
  const full = btn("3 · 完整讲解");
  if (await full.isVisible()) await full.click();
  await record("tutor_question", 15, async ({ at, click, focus }) => {
    await click(field, 1.28);
    await field.pressSequentially(
      "为什么两个栈能实现队列？请结合教材中的栈与队列，举例说明并标出引用。",
      { delay: 70 },
    );
    await at(7.8);
    await click(btn("发送"), 1.33);
    await at(11);
    await focus(p.getByRole("heading", { level: 1 }).first(), 1.17);
  });
  const citation = p
    .locator('button[title*="引用原文"],button[aria-label*="的引用原文"]')
    .last();
  await citation.waitFor({ timeout: 155000 });
  await record("tutor_source", 19, async ({ at, click, focus }) => {
    const answer = p.locator('[aria-label="辅导消息"] article').last();
    if (await answer.count()) await focus(answer, 1.25);
    await at(7);
    await click(citation, 1.6);
    const source = p.locator("[data-citation-source]");
    await source.waitFor();
    await at(10);
    await focus(source.getByRole("heading").first(), 1.73);
  });
  await p.setViewportSize({ width: 430, height: 930 });
  await go("/tutor?subject=data-structures&kc=c09");
  const materials = btn("教材与引用");
  await materials.waitFor();
  await record("phone", 8, async ({ at, click }) => {
    await at(1);
    await click(materials, 1);
    await p.getByRole("dialog", { name: "课程学习材料" }).waitFor();
    await at(4.5);
    await p
      .getByRole("dialog")
      .locator("article")
      .first()
      .evaluate((el) =>
        el.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      )
      .catch(() => {});
  });
}
async function studio() {
  await go("/directions?create=1");
  const s = p.locator("#course-create"),
    button = (name) => btn(name, s);
  const field = s.locator("textarea"),
    turns = s.locator('[role="log"] article');
  await field.waitFor();
  await record("import", 16, async ({ at, click, focus }) => {
    await at(3);
    const choosing = p.waitForEvent("filechooser");
    await click(button("导入"), 1.43);
    await (
      await choosing
    ).setFiles({
      name: "双栈队列练习讲义.markdown",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# 双栈队列练习讲义\n\n栈遵循后进先出，队列遵循先进先出。用入栈记录新的元素，只有出栈为空才倒入所有元素。逐个模拟入队甲、入队乙、出队、入队丙、出队，验证顺序。说明每个元素最多被倒栈一次，因此长期平均的单次操作代价为常数。",
      ),
    });
    const doc = s.getByRole("checkbox", { name: "双栈队列练习讲义.markdown" });
    await doc.waitFor({ timeout: 60000 });
    await at(9);
    await focus(doc.locator(".."), 1.55);
  });
  for (const [i, question] of [
    "我想学会用两个栈实现队列，请结合我导入的讲义安排练习。",
    "我会用数组，希望六周内练会均摊分析。每周能安排两次练习。",
  ].entries()) {
    const name = "turn" + (i + 1);
    await record(name, 7, async ({ at, click }) => {
      await click(field, 1.3);
      await field.pressSequentially(question, { delay: 63 });
      await at(4.4);
      await click(button("发送给导师"), 1.37);
    });
    await turns.nth(i * 2 + 1).waitFor({ timeout: 180000 });
    console.log(name, "导师", (await turns.last().innerText()).slice(0, 250));
    await record(name + "_result", 10, async ({ at, focus }) => {
      await focus(turns.last().locator("p").first(), 1.46);
      await at(6);
      await turns.last().scrollIntoViewIfNeeded();
    });
  }
  await record("build", 6, async ({ at, click }) => {
    const web = s.getByRole("checkbox", { name: "辅助联网搜索" });
    if (!(await web.isChecked())) await click(web, 1.5);
    await at(3);
    await click(button("生成学习方案与图谱"), 1.44);
  });
  const map = s.locator(".direction-map");
  await map.waitFor({ timeout: 280000 });
  await map.scrollIntoViewIfNeeded();
  const nodes = map.locator(".react-flow__node");
  await nodes.first().waitFor();
  console.log(
    "实录图谱",
    await nodes.count(),
    await map.locator(".react-flow__edge").count(),
  );
  await record("build_result", 13, async ({ at, focus, click }) => {
    await focus(map, 1.24);
    await at(6.5);
    await click(nodes.nth(2), 1.55);
    await pause(700);
    await focus(map, 1.38);
  });
  await record("save", 17, async ({ at, click, focus }) => {
    const reference = s.getByText(/本轮参考 · \d+ 处/).last();
    await click(reference, 1.45);
    await at(4);
    await s
      .getByLabel("方向名", { exact: true })
      .fill("双栈队列与均摊分析 · 六周练习");
    await at(6);
    await click(button("保存这个方向"), 1.4);
    const saved = p
      .locator('[data-motion="direction"]')
      .filter({
        has: p.getByRole("heading", {
          name: "双栈队列与均摊分析 · 六周练习",
          exact: true,
        }),
      })
      .first();
    const doc = saved.getByText("双栈队列练习讲义.markdown", { exact: true });
    await doc.waitFor({ timeout: 35000 });
    await at(10);
    await focus(doc, 1.65);
  });
  await record("end", 16, async ({ at, focus, wide }) => {
    const title = p
      .getByRole("heading", {
        name: "双栈队列与均摊分析 · 六周练习",
        exact: true,
      })
      .first();
    await focus(title, 1.45);
    await at(6);
    wide();
  });
}
// Frame the actual answer paragraphs inside the independently scrolling message log.
async function placeAnswer(paragraph) {
  await paragraph.evaluate((el) => {
    const log = el.closest('[role="log"]');
    log.scrollTop +=
      el.getBoundingClientRect().top - log.getBoundingClientRect().top - 30;
  });
  await pause(140);
  const visible = await paragraph.evaluate((el) => {
    const log = el.closest('[role="log"]').getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return box.top >= log.top - 1 && box.bottom <= log.bottom + 1;
  });
  if (!visible) throw Error("回答段落没有完整进入消息视口");
}
async function tutorReadback() {
  await p.setViewportSize({ width: 1920, height: 1080 });
  await go("/tutor?subject=data-structures&kc=c09");
  await p
    .locator('.conversation-row button[title*="为什么两个栈"]')
    .first()
    .click();
  const answer = p.locator(".tutor-answer-body").last();
  const paragraph = (label) =>
    answer.locator(":scope > p").filter({ hasText: label }).first();
  const conclusion = paragraph(/^结论/);
  const explanation = paragraph(/^解释/);
  const example = paragraph(/^例子/);
  await conclusion.waitFor();
  await placeAnswer(conclusion);
  await record("tutor_conclusion", 8, async ({ focus }) => {
    await focus(conclusion, 2.15);
  });
  await placeAnswer(explanation);
  await record("tutor_source", 19, async ({ at, focus, click }) => {
    await focus(explanation, 2.1);
    await at(4);
    await placeAnswer(example);
    await focus(example, 2.1);
    await at(8);
    await placeAnswer(explanation);
    const cite = explanation.getByRole("button").first();
    await focus(explanation, 2.1);
    await cite.hover();
    await at(10.6);
    await click(cite, 1.75);
    const source = p.locator("[data-citation-source]");
    await source.waitFor();
    await focus(source.getByRole("heading").first(), 2.25);
  });
  // Use the actual responsive viewport. CSS zoom on a wider page moves fixed drawers offscreen.
  await p.setViewportSize({ width: 430, height: 860 });
  await go("/tutor?subject=data-structures&kc=c09");
  const materials = btn("教材与引用");
  await materials.waitFor();
  await conclusion.waitFor();
  await placeAnswer(conclusion);
  await record("phone", 8, async ({ at, click }) => {
    await at(0.8);
    await click(materials, 1);
    const drawer = p.getByRole("dialog", { name: "课程学习材料" });
    await drawer.waitFor();
    await pause(400);
    const box = await drawer.boundingBox();
    if (!box || box.x < -1 || box.x + box.width > 431)
      throw Error("手机教材超出录制宽度");
    const ask = drawer.locator("[data-material-ask]").first();
    await at(4.8);
    await click(ask, 1);
    await drawer.waitFor({ state: "hidden" });
    await p.waitForFunction(() => document.querySelector("#q")?.value.trim());
  });
}
async function readback() {
  await tutorReadback();
  await bank();
}
async function bank() {
  await p.setViewportSize({ width: 2304, height: 1296 });
  await go("/directions?kb=open#custom-courses");
  const title = "双栈队列与均摊分析 · 六周练习";
  const saved = p
    .locator('[data-motion="direction"]')
    .filter({ has: p.getByRole("heading", { name: title, exact: true }) })
    .first();
  const file = saved.getByText("双栈队列练习讲义.markdown", { exact: true });
  await saved.waitFor();
  const bankButton = saved.getByRole("button", { name: /知识库/ }).first();
  if ((await bankButton.getAttribute("aria-expanded")) !== "true")
    await bankButton.click();
  await file.waitFor();
  await record("bank", 6, async ({ at, focus }) => {
    await focus(file, 1.85);
    await at(4);
  });
  await record("end", 16, async ({ at, focus }) => {
    await focus(saved.getByRole("heading", { name: title, exact: true }), 1.5);
    await at(7);
  });
}
try {
  const part = process.argv[2];
  if (part === "login") await login();
  else {
    const response = await ctx.request.post(base + "/api/auth", {
      headers: { Origin: base },
      data: { action: "login", email, password },
    });
    if (!response.ok()) throw Error("演示登录失败 " + response.status());
    await {
      tour,
      graph,
      nodes: graph,
      budgets,
      mistakes,
      settings,
      appearanceGraphs,
      tutor,
      studio,
      readback,
      tutorReadback,
      bank,
    }[part]();
  }
} catch (e) {
  console.error(e.message.slice(0, 2000));
  process.exitCode = 1;
} finally {
  await browser.close();
}
