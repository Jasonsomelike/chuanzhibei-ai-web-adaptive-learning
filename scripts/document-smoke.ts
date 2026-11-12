/** Full HTTP and browser document flows, restricted to the isolated local test server. */
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { chromium, request, type APIRequestContext } from "playwright";
import { startMockProvider } from "./mock-provider";
import { scanPdf } from "./fixtures/pdf";
import { DOCUMENT_PART_BYTES } from "../src/lib/documentContracts";
const base = process.env.BASE_URL ?? "http://localhost:3218";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
let checks = 0;
const contexts: APIRequestContext[] = [];
const check = (condition: unknown, label: string) => {
  assert(condition, label);
  checks++;
  console.log(`PASS ${label}`);
};
async function client(name: string) {
  const ctx = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(ctx);
  const r = await ctx.post("/api/auth", {
    data: {
      action: "register",
      email: `${name}-${randomUUID()}@test.local`,
      password: `T3-${randomBytes(24).toString("base64url")}`,
      displayName: "附件验收",
    },
  });
  assert(r.ok());
  return ctx;
}
async function post(ctx: APIRequestContext, url: string, data: unknown) {
  const r = await ctx.post(url, { data });
  assert(r.ok(), `${url}: ${r.status()} ${await r.text()}`);
  return r.json();
}
const mock = await startMockProvider({
  port: Number(process.env.ALP_E2E_MOCK_PORT ?? 3219),
});
const trace = JSON.parse(
  await readFile(".next/server/app/api/documents/route.js.nft.json", "utf8"),
) as { files: string[] };
for (const asset of [
  "tesseract.js/src/worker-script/node/index.js",
  "wasm-feature-detect",
  "bmp-js",
  "eng.traineddata.gz",
  "chi_sim.traineddata.gz",
  "pdf.worker.mjs",
]) {
  check(
    trace.files.some((file) => file.replaceAll("\\", "/").includes(asset)),
    `部署文件清单包含 ${asset}`,
  );
}
const browser = await chromium.launch();
const output = await mkdtemp(join(tmpdir(), "alp-documents-qa-"));
try {
  const alice = await client("document-a"),
    bob = await client("document-b");
  const anonymous = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
  });
  contexts.push(anonymous);
  const bytes = Buffer.from(
    "栈采用后进先出。".repeat(24000) +
      "\n队列采用先进先出，队尾插入，队头删除。",
  );
  const descriptor = {
    action: "create",
    targetId: "data-structures",
    name: "数据结构讲义.txt",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  check(
    (await anonymous.post("/api/documents", { data: descriptor })).status() ===
      401,
    "未登录无法写入服务端附件",
  );
  let job = await post(alice, "/api/documents", descriptor);
  check(
    (
      await bob.post("/api/documents", {
        data: { action: "process", id: job.id },
      })
    ).status() === 404,
    "附件处理按账号隔离",
  );
  for (
    let index = 0;
    index < Math.ceil(bytes.length / DOCUMENT_PART_BYTES);
    index++
  )
    job = await post(alice, "/api/documents", {
      action: "part",
      id: job.id,
      index,
      data: bytes
        .subarray(
          index * DOCUMENT_PART_BYTES,
          (index + 1) * DOCUMENT_PART_BYTES,
        )
        .toString("base64"),
    });
  job = await post(alice, "/api/documents", { action: "process", id: job.id });
  check(
    job.status === "ready" && job.document.chunkCount > 100,
    "大于旧版两万字上限的文档完整解析入库",
  );
  const scanned = Buffer.from(scanPdf());
  let scan = await post(alice, "/api/documents", {
    action: "create",
    targetId: "data-structures",
    name: "扫描讲义.pdf",
    size: scanned.length,
    sha256: createHash("sha256").update(scanned).digest("hex"),
  });
  scan = await post(alice, "/api/documents", {
    action: "part",
    id: scan.id,
    index: 0,
    data: scanned.toString("base64"),
  });
  scan = await post(alice, "/api/documents", {
    action: "process",
    id: scan.id,
  });
  check(
    scan.status === "ready" && scan.document.ocrPages === 1,
    "生产构建的服务端路由完成真实扫描 PDF 的 OCR",
  );
  const duplicate = await post(alice, "/api/documents", descriptor);
  check(
    duplicate.reused && duplicate.id === job.id && duplicate.status === "ready",
    "重复上传复用哈希索引，无需再次发送文件",
  );
  const kb = await (
    await alice.get("/api/kb?directionId=data-structures")
  ).json();
  check(
    kb.docs.filter((d: { id: string }) => d.id === job.id).length === 1,
    "知识库仅保存一份同哈希文档",
  );
  const found = await post(alice, "/api/documents/retrieve", {
    targetId: "data-structures",
    query: "队列先进先出",
    documentIds: [job.id],
    retrievalMaxTokens: 1500,
  });
  check(
    found.hits.length > 0 &&
      found.hits.length < job.document.chunkCount &&
      found.budget.used <= 1500,
    "服务端只返回预算内的相关片段",
  );
  const created = await post(alice, "/api/conversations", {
    action: "create",
    targetId: "data-structures",
  });
  let conversation = created.conversation;
  const turn = await post(alice, "/api/conversations/messages", {
    conversationId: conversation.id,
    revision: conversation.revision,
    user: {
      id: randomUUID(),
      content: { text: "请解释队列。", documents: [job.document] },
    },
    assistantId: randomUUID(),
  });
  conversation = turn.conversation;
  const saved = await alice.put("/api/conversations/messages", {
    data: {
      conversationId: conversation.id,
      id: turn.assistant.id,
      revision: 0,
      content: {
        text: "队列采用先进先出。[资料1]",
        uploadHits: found.hits,
        uploadUsed: [1],
      },
      state: "complete",
    },
  });
  assert(saved.ok());
  const device = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { Origin: base },
    storageState: await alice.storageState(),
  });
  contexts.push(device);
  const restored = await (
    await device.get(
      `/api/conversations/messages?conversationId=${conversation.id}`,
    )
  ).json();
  check(
    restored.messages[0].content.text === "请解释队列。" &&
      !restored.messages[0].content.text.includes("栈"),
    "问题正文不携带附件全文",
  );
  check(
    restored.messages[0].content.documents[0].sha256 === descriptor.sha256 &&
      restored.messages[1].content.uploadHits[0].chunk.text ===
        found.hits[0].chunk.text,
    "跨设备恢复附件元数据与引用原文快照",
  );
  const branched = await post(device, "/api/conversations", {
    action: "branch",
    id: conversation.id,
    messageId: turn.assistant.id,
  });
  const branch = await (
    await device.get(
      `/api/conversations/messages?conversationId=${branched.conversation.id}`,
    )
  ).json();
  check(
    branch.messages[0].content.documents[0].id === job.id,
    "会话分支继承文档标识，无需复制文档正文",
  );
  const config = await alice.put("/api/config", {
    data: {
      provider: "llm",
      kind: "openai-compatible",
      baseUrl: `${mock.url}/v1`,
      model: "time-estimator-fixture",
      apiKey: `test-only-${randomBytes(16).toString("hex")}`,
      contextWindowTokens: 16000,
      responseReserveTokens: 2048,
      retrievalMaxTokens: 3000,
    },
  });
  assert(config.ok());
  const timing = await post(alice, "/api/learning/time-estimates", {
    targetId: "data-structures",
  });
  check(
    timing.source === "llm" &&
      timing.estimates.length === 40 &&
      timing.estimates.every(
        (e: { learnMinutes: number }) => e.learnMinutes === 22,
      ),
    "服务端时长 Agent 输出覆盖全部知识点并通过校验",
  );
  const agent = await alice.post("/api/agent", {
    data: {
      subject: "data-structures",
      question: "安排30分钟的学习路径",
      budgetMinutes: 30,
      intent: "review_path",
    },
  });
  assert(agent.ok());
  const events = (await agent.text())
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
  const done = events.findLast((e) => e.type === "done");
  check(
    done?.workflow?.timeEstimation?.source === "llm" &&
      done.workflow.plan.steps.every(
        (s: { estMinutes: number }) => s.estMinutes === 22,
      ) &&
      done.workflow.plan.totalMinutes <= 30,
    "估算结果实际参与 Agent 排程并满足预算",
  );
  check(
    done.workflow.stages.some(
      (s: { node: string }) => s.node === "estimator",
    ) &&
      done.workflow.stages.some(
        (s: { node: string }) => s.node === "time_validator",
      ),
    "教学轨迹记录估算、校验、规划节点",
  );
  const ui = await browser.newContext({
    storageState: await alice.storageState(),
  });
  const page = await ui.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/tutor?subject=data-structures`);
  await page.getByRole("list", { name: "本轮文档附件" }).first().waitFor();
  check(
    await page
      .getByRole("list", { name: "本轮文档附件" })
      .first()
      .getByText("数据结构讲义.txt", { exact: false })
      .isVisible(),
    "浏览器历史会话显示附件来源",
  );
  await page
    .locator('input[type="file"][accept="image/*,.txt,.md,.markdown,.pdf"]')
    .setInputFiles({
      name: "补充说明.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("环形队列通过取模使队尾回到数组开头。".repeat(20)),
    });
  await page
    .getByRole("list", { name: "待发送文档" })
    .getByText("补充说明.txt", { exact: false })
    .waitFor({ timeout: 30000 });
  const input = page.getByRole("textbox", { name: /输入.*问题/ });
  check(
    (await input.inputValue()) === "",
    "浏览器上传完成后输入框保持问题正文独立",
  );
  await page.screenshot({ path: join(output, "documents-tutor.png") });
  await page.goto(`${base}/path?subject=data-structures&budget=30`);
  await page
    .getByText(/用时由 time-estimator-fixture/)
    .waitFor({ timeout: 30000 });
  check(
    (await page.locator("[data-path-summary]").innerText()).includes("22"),
    "学习路径页面使用模型估算分钟数",
  );
  check(errors.length === 0, "附件与时长页面没有浏览器运行时异常");
  await page.screenshot({ path: join(output, "time-estimation-path.png") });
  console.log(`文档与时长截图：${output}`);
  await ui.close();
  const local = await browser.newContext();
  await local.addInitScript(
    ({ url }) =>
      localStorage.setItem(
        "alp.provider.v1",
        JSON.stringify({
          label: "本机估算测试",
          kind: "openai-compatible",
          baseUrl: `${url}/v1`,
          model: "local-time-fixture",
          apiKey: "test-only-key",
          mode: "local",
          contextWindowTokens: 16000,
          responseReserveTokens: 2048,
          retrievalMaxTokens: 3000,
        }),
      ),
    { url: mock.url },
  );
  const localPage = await local.newPage();
  await localPage.goto(`${base}/path?subject=data-structures&budget=30`);
  await localPage
    .getByText(/用时由 local-time-fixture/)
    .waitFor({ timeout: 30000 });
  check(
    (await localPage.locator("[data-path-summary]").innerText()).includes("22"),
    "匿名本机 BYOK 模式同样使用模型时长排程",
  );
  await local.close();

  console.log(`文档与时长端到端验收通过：${checks} 项。`);
} finally {
  await browser.close();
  await Promise.all(contexts.map((c) => c.dispose()));
  await mock.close();
}
