/** Full archive, turn branching, management and account boundaries through the actual tutor UI. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Page } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3218";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = join(tmpdir(), `alp-conversation-ui-${Date.now()}`);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1487, height: 1058 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const runtimeErrors: string[] = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
let checks = 0;
function check(condition: unknown, name: string) {
  assert(condition, name);
  checks++;
  console.log(`PASS ${name}`);
}
async function loaded(target: Page) {
  await target.locator('[aria-label="辅导消息"][aria-busy="false"]').waitFor();
}
const headers = { Origin: base };
let delayNextModel = false;
let releaseModel: (() => void) | undefined;
let modelStarted: (() => void) | undefined;
const mock = createServer(async (request, response) => {
  for await (const part of request) void part;
  if (delayNextModel) {
    delayNextModel = false;
    modelStarted?.();
    await new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
  }
  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: "继续用一个例子理解栈 [c09]。最后放入的元素最先取出。",
          },
          finish_reason: "stop",
        },
      ],
    }),
  );
});
await new Promise<void>((resolve, reject) => {
  mock.once("error", reject);
  mock.listen(
    Number(process.env.ALP_E2E_MOCK_PORT ?? 3219),
    "127.0.0.1",
    resolve,
  );
});
try {
  const registered = await context.request.post(`${base}/api/auth`, {
    headers,
    data: {
      action: "register",
      email: `conversation-${randomUUID()}@test.local`,
      password: randomBytes(24).toString("base64url"),
      displayName: "会话界面回归",
    },
  });
  assert(registered.ok());
  const configured = await context.request.put(`${base}/api/config`, {
    headers,
    data: {
      provider: "llm",
      kind: "openai-compatible",
      baseUrl: `http://127.0.0.1:${process.env.ALP_E2E_MOCK_PORT ?? 3219}/v1`,
      apiKey: "test-only",
      model: "conversation-ui-smoke",
      verification: false,
    },
  });
  assert(configured.ok());
  const jpeg = await page.screenshot({
    type: "jpeg",
    clip: { x: 0, y: 0, width: 1, height: 1 },
  });
  const attachment = {
    id: "saved-picture",
    name: "题目图片.jpg",
    dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    bytes: jpeg.byteLength,
    width: 1,
    height: 1,
    quality: 0.82,
  };
  const created = await context.request.post(`${base}/api/conversations`, {
    headers,
    data: {
      action: "create",
      targetId: "data-structures",
      title: "完整学习记录",
    },
  });
  let conversation = (await created.json()).conversation;
  const originalId: string = conversation.id;
  const answers: string[] = [];
  for (let index = 0; index < 12; index++) {
    const answer = `第${index + 1}轮讲解，栈遵循后进先出 [c09]。${"完整保留的原始回答。".repeat(60)}`;
    answers.push(answer);
    const appended = await context.request.post(
      `${base}/api/conversations/messages`,
      {
        headers,
        data: {
          conversationId: originalId,
          revision: conversation.revision,
          user: {
            id: randomUUID(),
            content: {
              text: `第${index + 1}轮问题`,
              attachments: [attachment],
            },
          },
          assistantId: randomUUID(),
        },
      },
    );
    assert(appended.ok());
    const pair = await appended.json();
    conversation = pair.conversation;
    assert(
      (
        await context.request.put(`${base}/api/conversations/messages`, {
          headers,
          data: {
            conversationId: originalId,
            id: pair.assistant.id,
            revision: 0,
            state: "complete",
            content: {
              text: answer,
              citations: [{ kcId: "c09", title: "栈" }],
              sources: ["历史教材·栈"],
              materialContext: "作答当时的完整原文，后进先出。",
              originals: [
                {
                  kcId: "c09",
                  label: "历史教材·栈",
                  text: "作答当时的完整原文，后进先出。",
                },
              ],
            },
          },
        })
      ).ok(),
    );
  }
  await page.goto(`${base}/tutor?subject=data-structures&chat=${originalId}`);
  await loaded(page);
  check(
    (await page.locator(".tutor-user-message").count()) === 10,
    "打开历史按页恢复完整消息",
  );
  await page
    .getByRole("button", { name: "加载更早的问答", exact: true })
    .click();
  await loaded(page);
  await page
    .locator(".tutor-user-message")
    .first()
    .getByText("第1轮问题", { exact: true })
    .waitFor();
  check(
    (await page.locator(".tutor-user-message").count()) === 12,
    "早期问答超过模型窗口仍可完整读取",
  );
  const images = page.locator(".tutor-saved-images img");
  check(
    (await images.count()) === 12 &&
      (await images
        .first()
        .evaluate((el) => (el as HTMLImageElement).naturalWidth === 1)),
    "历史问题图片原图完整恢复",
  );
  await page
    .getByRole("button", { name: "查看问题图片：题目图片.jpg", exact: true })
    .first()
    .click();
  check(
    await page
      .getByRole("dialog", { name: "题目图片.jpg", exact: true })
      .getByRole("img")
      .evaluate((el) => (el as HTMLImageElement).naturalWidth === 1),
    "历史图片可展开查看原图",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "栈 [c09]", exact: true })
    .first()
    .click();
  const source = page.getByRole("region", {
    name: "回答引用原文",
    exact: true,
  });
  check(
    (await source.innerText()).includes("作答当时的完整原文"),
    "旧回答按原始引用快照展示",
  );
  await page.keyboard.press("Escape");
  await page
    .locator(".tutor-assistant-message")
    .nth(1)
    .getByRole("button", { name: "从这里分支", exact: true })
    .click();
  await loaded(page);
  await page
    .getByRole("heading", { name: "完整学习记录 · 分支", exact: true })
    .waitFor();
  const forkId = new URL(page.url()).searchParams.get("chat");
  check(
    forkId !== originalId &&
      (await page.locator(".tutor-user-message").count()) === 2,
    "从第二轮回答分支只继承此前完整问答",
  );
  await page.locator("#q").fill("继续给一个新的栈例子");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .locator(".tutor-assistant-message")
    .last()
    .getByText("继续用一个例子理解栈", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  await page.getByText("会话已保存", { exact: true }).waitFor();
  check(
    (await page.locator(".tutor-user-message").count()) === 3,
    "分支继承上下文并可继续教学",
  );
  const original = await (
    await context.request.get(
      `${base}/api/conversations/messages?conversationId=${originalId}`,
    )
  ).json();
  check(
    original.conversation.lastSeq === 24 &&
      original.messages.at(-1).content.text === answers.at(-1),
    "分支继续后原会话内容保持原样",
  );
  await page.screenshot({ path: join(output, "tutor-branch-desktop.png") });
  const secondDevice = await browser.newContext({
    storageState: await context.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const phone = await secondDevice.newPage();
  await phone.goto(`${base}/tutor?subject=data-structures&chat=${forkId}`);
  await loaded(phone);
  check(
    (await phone.locator(".tutor-user-message").count()) === 3 &&
      (await phone.locator(".tutor-saved-images img").count()) === 2,
    "另一设备恢复分支问答、原图与完整新回答",
  );
  check(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "手机会话没有横向溢出",
  );
  check(
    await phone
      .locator("#q")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().bottom <=
          document
            .querySelector(".mobile-learning-nav")!
            .getBoundingClientRect().top,
      ),
    "手机输入框完整位于底栏上方",
  );
  await phone
    .getByRole("button", { name: "打开历史会话", exact: true })
    .click();
  await phone
    .getByRole("button", { name: "管理会话：完整学习记录 · 分支", exact: true })
    .click();
  await phone
    .getByRole("textbox", { name: "会话名称", exact: true })
    .fill("栈的另一种解释");
  await phone.getByRole("button", { name: "保存名称", exact: true }).click();
  await phone
    .getByRole("button", { name: "管理会话：栈的另一种解释", exact: true })
    .waitFor();
  await phone
    .getByRole("button", { name: "管理会话：栈的另一种解释", exact: true })
    .click();
  await phone.getByRole("button", { name: "置顶会话", exact: true }).click();
  await phone
    .getByRole("button", { name: "管理会话：栈的另一种解释", exact: true })
    .waitFor();
  await phone
    .getByRole("button", { name: "管理会话：栈的另一种解释", exact: true })
    .click();
  await phone.getByRole("button", { name: "归档会话", exact: true }).click();
  await phone.getByRole("button", { name: "已归档", exact: true }).click();
  await phone
    .getByRole("button", { name: "管理会话：栈的另一种解释", exact: true })
    .click();
  await phone.getByRole("button", { name: "移入回收站", exact: true }).click();
  await phone.getByRole("button", { name: "回收站", exact: true }).click();
  await phone
    .getByRole("button", { name: "管理会话：栈的另一种解释", exact: true })
    .click();
  await phone.getByRole("button", { name: "恢复会话", exact: true }).click();
  await phone.getByRole("button", { name: "最近会话", exact: true }).click();
  await phone
    .getByRole("textbox", { name: "搜索会话", exact: true })
    .fill("另一种解释");
  await phone
    .getByRole("button", { name: "管理会话：栈的另一种解释", exact: true })
    .waitFor();
  check(
    (await phone.locator(".conversation-row").count()) === 1,
    "手机可管理名称、置顶、归档、回收站、恢复和搜索",
  );
  await phone.keyboard.press("Escape");
  await phone.screenshot({ path: join(output, "tutor-branch-phone.png") });
  await secondDevice.close();
  await page.reload();
  await loaded(page);
  check(
    await page
      .getByRole("heading", { name: "栈的另一种解释", exact: true })
      .isVisible(),
    "另一设备的会话修改刷新后同步",
  );
  const beforeRemoteTurn = await (
    await context.request.get(
      `${base}/api/conversations/messages?conversationId=${forkId}`,
    )
  ).json();
  const remoteTurn = await context.request.post(
    `${base}/api/conversations/messages`,
    {
      headers,
      data: {
        conversationId: forkId,
        revision: beforeRemoteTurn.conversation.revision,
        user: { id: randomUUID(), content: { text: "另一设备发起的栈提问" } },
        assistantId: randomUUID(),
      },
    },
  );
  const remotePair = await remoteTurn.json();
  await page.reload();
  await loaded(page);
  await page.getByRole("button", { name: "刷新记录", exact: true }).waitFor();
  const stillPending = await (
    await context.request.get(
      `${base}/api/conversations/messages?conversationId=${forkId}&messageId=${remotePair.assistant.id}`,
    )
  ).json();
  check(
    stillPending.message.state === "pending",
    "读取待完成回答不会中止另一设备的生成",
  );
  const remoteGeneration = await context.request.post(`${base}/api/agent`, {
    headers,
    data: {
      question: "另一设备发起的栈提问",
      subject: "data-structures",
      conversationId: forkId,
      assistantMessageId: remotePair.assistant.id,
    },
  });
  assert(remoteGeneration.ok());
  await remoteGeneration.text();
  await page.getByRole("button", { name: "刷新记录", exact: true }).click();
  await page
    .locator(".tutor-assistant-message")
    .last()
    .getByText("继续用一个例子理解栈", { exact: false })
    .waitFor();
  check(
    await page
      .locator(".tutor-assistant-message")
      .last()
      .locator("[data-teaching-task]")
      .isVisible(),
    "另一设备完成后可刷新恢复完整回答与教学任务",
  );
  delayNextModel = true;
  const started = new Promise<void>((resolve) => {
    modelStarted = resolve;
  });
  await page.locator("#q").fill("请慢慢解释栈，我会停止这一轮");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await Promise.race([
    started,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("延迟模型未收到请求")), 10_000),
    ),
  ]);
  await page.getByRole("button", { name: "停止", exact: true }).click();
  releaseModel?.();
  await page.getByRole("button", { name: "发送", exact: true }).waitFor();
  await page.getByText("会话已保存", { exact: true }).waitFor();
  const stopped = await (
    await context.request.get(
      `${base}/api/conversations/messages?conversationId=${forkId}`,
    )
  ).json();
  check(
    stopped.messages.at(-1).state === "interrupted",
    "停止生成在服务端终止当前轮次并保留提问",
  );
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page
    .getByRole("heading", { name: "一起把问题想明白", exact: true })
    .waitFor();
  await page.locator("#q").fill("新会话中的队列问题");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("会话已保存", { exact: true }).waitFor();
  check(
    (await page.locator(".tutor-user-message").count()) === 1 &&
      !(await page.locator(".tutor-messages").innerText()).includes("慢慢解释"),
    "停止后的迟到响应不会写入新会话",
  );
  await page
    .getByRole("button", { name: "账号：会话界面回归", exact: true })
    .click();
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await page
    .getByText("会话保存在此浏览器。登录后新建的会话随账号同步。", {
      exact: true,
    })
    .waitFor();
  await loaded(page);
  check(
    (await page.locator(".tutor-user-message").count()) === 0 &&
      !(await page.locator("main").innerText()).includes("新会话中的队列问题"),
    "登出立即移除账号问答与图片",
  );
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page
    .getByRole("heading", { name: "一起把问题想明白", exact: true })
    .waitFor();
  await page.locator("#q").fill("本机匿名会话中的队列");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByText("会话已保存", { exact: true }).waitFor();
  await page.reload();
  await loaded(page);
  check(
    await page
      .locator(".tutor-user-message")
      .getByText("本机匿名会话中的队列", { exact: true })
      .isVisible(),
    "匿名完整问答经 IndexedDB 刷新恢复",
  );
  check(
    runtimeErrors.length === 0,
    `会话操作无运行错误 ${runtimeErrors.join(" / ")}`,
  );
  console.log(`${checks} 项完整会话界面回归通过。截图 ${output}`);
} catch (error) {
  await page
    .screenshot({ path: join(output, "failure.png"), fullPage: true })
    .catch(() => undefined);
  console.error("会话界面回归失败", { url: page.url(), runtimeErrors, output });
  throw error;
} finally {
  releaseModel?.();
  await browser.close();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
}
