/**
 * 可控的 OpenAI 兼容 mock 供应商，只用于生成链路集成检查。
 *
 * 为什么按路径分档而不是按调用次数：directionItems 的两次批解是
 * Promise.all 并发的，谁先到达不确定；按次数区分「正常 / 反转」会把结论
 * 绑在竞态上。这里改成看提示词本身——反转批次的第 3 题选项首项必然等于
 * 生成时第 3 题的最后一个选项（options[3]），据此判断批次是否被反转。
 *
 * 按路径分档（未列出的 badjson / dupstem 供出题链路回归使用）：
 *   /v1          正常：按题目给出的选项顺序与正确文本作答
 *   /shuffle/v1  answers 数组倒序返回，但每条 index 仍然是正确题号
 *   /badsolve/v1 反转批次里把第 3、4 题答错，用于验证降级成 practice
 *   /truncate/v1 返回 finish_reason=length，用于验证 ChatError 的截断分支
 *   /stream/v1   返回 SSE：先 reasoning_content 再正文，用于验证思考面板与流式分流
 *   /think400/v1 请求带 thinking/reasoning_effort 时返回 400，不带时正常返回，
 *                用于验证 callChatStream 的「思考参数被拒 → 降级一次」
 *
 * 直接运行监听 127.0.0.1:3212：
 *   node node_modules/tsx/dist/cli.mjs scripts/mock-provider.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface MockProviderOptions {
  /** 0 表示由系统分配空闲端口。 */
  readonly port?: number;
}

export interface MockProviderHandle {
  readonly url: string;
  close(): Promise<void>;
}

interface MockItem {
  readonly difficulty: "basic" | "advanced" | "challenge";
  readonly difficultyReason: string;
  readonly stem: string;
  readonly options: readonly string[];
  readonly answerText: string;
  readonly explanation: string;
}

/**
 * 固定题库：4 道栈题，四组答案互不相同。
 *
 * 答案互不相同是刻意安排的：shuffle 档把数组倒序返回后，
 * 「按数组顺序取答案」必然每题都错，回归哨兵才有意义。
 * 长答案的解析里原样重复答案文本，否则「解析含答案」这一层会拒题。
 */
const MOCK_ITEMS: readonly MockItem[] = [
  {
    difficulty: "basic",
    difficultyReason: "基础概念题，考查栈顶的定义",
    stem: "栈的插入与删除操作分别在什么位置进行？",
    options: ["都在栈顶", "都在栈底", "插入在栈底、删除在栈顶", "任意位置"],
    answerText: "都在栈顶",
    explanation:
      "栈是只能在表尾插入与删除的线性表，表尾称为栈顶，插入与删除都在栈顶完成。",
  },
  {
    difficulty: "advanced",
    difficultyReason: "需要理解并推导出栈序列",
    stem: "设栈的入栈序列为 1,2,3，则下列哪个不可能是出栈序列？",
    options: ["3,2,1", "1,2,3", "2,1,3", "3,1,2"],
    answerText: "3,1,2",
    explanation:
      "若 3 先出栈，说明 1、2 都已入栈，栈顶是 2，因此下一个只能出 2 而不能出 1。",
  },
  {
    difficulty: "advanced",
    difficultyReason: "需要理解循环队列的判满条件",
    stem: "循环队列用少用一个元素空间区分队空与队满时，队满条件是（容量 MAXSIZE）？",
    options: [
      "front == rear",
      "(rear + 1) % MAXSIZE == front",
      "rear == MAXSIZE - 1",
      "front == 0",
    ],
    answerText: "(rear + 1) % MAXSIZE == front",
    explanation:
      "循环队列少用一个元素空间时，队满的条件是 (rear + 1) % MAXSIZE == front，队空则 front == rear。",
  },
  {
    difficulty: "challenge",
    difficultyReason: "需要综合比较链栈与顺序栈的差别",
    stem: "链栈相对于顺序栈的主要优势是什么？",
    options: ["不会出现栈满溢出", "支持随机访问", "存储密度更高", "入栈更慢"],
    answerText: "不会出现栈满溢出",
    explanation:
      "链栈以链表头部为栈顶，结点按需分配，因此不会出现栈满溢出，这是它与顺序栈的主要区别。",
  },
];

type MockMode =
  | "normal"
  | "shuffle"
  | "badsolve"
  | "truncate"
  | "badjson"
  | "dupstem"
  | "stream"
  | "think400";

interface ChatMessage {
  readonly role?: unknown;
  readonly content?: unknown;
}

interface ChatBody {
  readonly messages?: unknown;
  readonly stream?: unknown;
  readonly thinking?: unknown;
  readonly reasoning_effort?: unknown;
  readonly output_config?: unknown;
}

interface PromptQuestion {
  /** 提示词里的 1-based 题号。 */
  readonly index: number;
  readonly stem: string;
  readonly options: readonly string[];
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access",
};

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  if (res.writableEnded) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS });
  res.end(JSON.stringify(body));
}

/** 一次性写完的 SSE：默认思考增量在前、正文增量在后，最后给 usage 与 [DONE]。 */
function sendStream(res: ServerResponse, options: { readonly reasoning?: boolean } = {}): void {
  if (res.writableEnded) return;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...CORS_HEADERS,
  });

  const chunks: unknown[] = [{ choices: [{ delta: { role: "assistant" } }] }];
  if (options.reasoning !== false) {
    chunks.push({ choices: [{ delta: { reasoning_content: "先确认栈顶定义，" } }] });
    chunks.push({ choices: [{ delta: { reasoning_content: "再看插入与删除的位置。" } }] });
  }
  chunks.push({ choices: [{ delta: { content: "栈的插入" } }] });
  chunks.push({ choices: [{ delta: { content: "与删除都在栈顶完成。" } }] });
  chunks.push({
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 18, completion_tokens: 24, total_tokens: 42 },
  });

  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function modeOf(pathname: string): MockMode {
  if (pathname.startsWith("/stream/")) return "stream";
  if (pathname.startsWith("/think400/")) return "think400";
  if (pathname.startsWith("/shuffle/")) return "shuffle";
  if (pathname.startsWith("/badsolve/")) return "badsolve";
  if (pathname.startsWith("/truncate/")) return "truncate";
  if (pathname.startsWith("/badjson/")) return "badjson";
  if (pathname.startsWith("/dupstem/")) return "dupstem";
  return "normal";
}

/**
 * 出题档位对应的题库。
 *
 * dupstem 把第二题的题干换成第一题的：L2 的题干去重只有在「同批里出现重复」
 * 或「与已有题目重复」时才会触发，正常题库永远测不到那条分支。
 */
function itemsForMode(mode: MockMode): readonly MockItem[] {
  if (mode !== "dupstem") return MOCK_ITEMS;
  const first = MOCK_ITEMS[0];
  return [first, { ...MOCK_ITEMS[1], stem: first.stem }, MOCK_ITEMS[2], MOCK_ITEMS[3]];
}

/** 从 solveBatch 的提示词里恢复每道题的题号与当前呈现的选项。 */
function parseQuestions(prompt: string): PromptQuestion[] {
  const out: PromptQuestion[] = [];
  for (const block of prompt.split(/\n\s*\n/)) {
    const head = /^第\s*(\d+)\s*题：([^\n]*)\n([\s\S]*)$/.exec(block.trim());
    if (!head) continue;
    const options = head[3]
      .split("\n")
      .map((line) => /^[A-Z]\.\s*(.+)$/.exec(line.trim())?.[1]?.trim() ?? "")
      .filter((option) => option !== "");
    out.push({ index: Number(head[1]), stem: head[2].trim(), options });
  }
  return out;
}

/** 反转批次的判据：第 3 题的首个选项等于生成时第 3 题的最后一个选项。 */
function isReversedBatch(
  questions: readonly PromptQuestion[],
  generated: readonly MockItem[],
): boolean {
  const third = questions.find((q) => q.index === 3);
  const original = generated[2];
  if (!third || !original || third.options.length === 0 || original.options.length < 4) {
    return false;
  }
  return third.options[0].trim() === original.options[3].trim();
}

function answerFor(question: PromptQuestion, generated: readonly MockItem[]): string {
  const original = generated[question.index - 1];
  if (!original) return question.options[0] ?? "";
  const hit = question.options.find((o) => o.trim() === original.answerText.trim());
  return hit ?? question.options[0] ?? "";
}

function wrongAnswerFor(question: PromptQuestion, correct: string): string {
  return question.options.find((o) => o.trim() !== correct.trim()) ?? correct;
}

function messageContent(body: ChatBody): { system: string; user: string } {
  const raw = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];
  const pick = (role: string): string =>
    raw
      .filter((m) => m && m.role === role && typeof m.content === "string")
      .map((m) => m.content as string)
      .join("\n");
  return { system: pick("system"), user: pick("user") };
}

/**
 * 启动 mock。每个实例各自持有「最近一次生成的题目」状态，
 * 因此脚本里两轮跑完互不污染；同一实例内生成一定发生在批解之前。
 */
export async function startMockProvider(
  opts: MockProviderOptions = {},
): Promise<MockProviderHandle> {
  let generated: readonly MockItem[] = MOCK_ITEMS;

  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, { error: "mock 供应商只接受 OPTIONS 与 POST" }, 405);
      return;
    }

    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const mode = modeOf(pathname);

    // 流式档不关心提示词：固定返回「思考 → 正文 → usage → [DONE]」
    if (mode === "stream") {
      sendStream(res);
      return;
    }

    if (mode === "truncate") {
      sendJson(res, {
        choices: [{ message: { content: "" }, finish_reason: "length" }],
      });
      return;
    }

    /*
     * 坏 JSON：直接返回不可解析的文本。
     * ensureItems 会重试一次，第二次仍然坏，最终必须报「模型输出无法解析」，
     * 而不是把异常吞掉后当作「生成了 0 题」。
     */
    if (mode === "badjson") {
      sendJson(res, {
        choices: [{ message: { content: '{"items": [ 这不是 JSON' }, finish_reason: "stop" }],
      });
      return;
    }

    let body: ChatBody;
    try {
      body = JSON.parse(await readBody(req)) as ChatBody;
    } catch {
      sendJson(res, { error: "请求体不是合法 JSON" }, 400);
      return;
    }

    /*
     * 模拟不支持思考参数的端点：带 thinking / reasoning_effort 就 400，
     * 去掉这些字段后正常返回。callChatStream 应只降级一次并继续拿到正文。
     */
    if (mode === "think400") {
      if (
        body.thinking !== undefined ||
        body.reasoning_effort !== undefined ||
        body.output_config !== undefined
      ) {
        sendJson(
          res,
          { error: { type: "invalid_request_error", message: "thinking 参数不受支持" } },
          400,
        );
        return;
      }
      // 降级后的请求是普通模式：只给正文，避免界面误以为本次仍有思考内容
      if (body.stream === true) {
        sendStream(res, { reasoning: false });
        return;
      }
      sendJson(res, {
        choices: [{ message: { content: "可用" }, finish_reason: "stop" }],
      });
      return;
    }

    const { user } = messageContent(body);
    if(user.includes("你是学习时长估算 Agent")&&user.includes("数据：")) {
      const sample=JSON.parse(user.slice(user.indexOf("\n数据：")+4).slice(0,user.slice(user.indexOf("\n数据：")+4).lastIndexOf("}")+1)) as {graph:{concepts:{id:string}[]}};
      const estimates=sample.graph.concepts.map(c=>({kcId:c.id,learnMinutes:22,reviewMinutes:10,lowMinutes:8,highMinutes:30,confidence:"medium",reason:"根据内容与现有作答证据估算；独立检查后再调整。"}));
      sendJson(res,{choices:[{message:{content:JSON.stringify({estimates})},finish_reason:"stop"}]});return;
    }
    const questions = parseQuestions(user);

    if (questions.length > 0) {
      const reversed = isReversedBatch(questions, generated);
      const answers = questions.map((question) => {
        const correct = answerFor(question, generated);
        const needsWrong =
          mode === "badsolve" && reversed && (question.index === 3 || question.index === 4);
        return {
          index: question.index,
          answerText: needsWrong ? wrongAnswerFor(question, correct) : correct,
        };
      });
      // shuffle 只打乱数组顺序，index 保持正确——正是缺陷 3 的场景
      const ordered = mode === "shuffle" ? [...answers].reverse() : answers;
      sendJson(res, {
        choices: [
          { message: { content: JSON.stringify({ answers: ordered }) }, finish_reason: "stop" },
        ],
      });
      return;
    }

    // 其余请求按出题处理：固定 4 题，覆盖三个难度档
    const items = itemsForMode(mode);
    generated = items;
    sendJson(res, {
      choices: [
        { message: { content: JSON.stringify({ items }) }, finish_reason: "stop" },
      ],
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock 供应商未能取得监听端口");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // 先把 keep-alive 的空闲连接关掉，否则 close 会一直等它们超时
        server.closeIdleConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const isDirectRun =
  process.argv[1] !== undefined &&
  process.argv[1].replace(/\\/g, "/").endsWith("/scripts/mock-provider.ts");

if (isDirectRun) {
  const handle = await startMockProvider({ port: 3212 });
  console.log(`mock 供应商已启动：${handle.url}`);
  console.log(
    "分档：/v1 正常 · /shuffle/v1 数组倒序 · /badsolve/v1 反转批第 3、4 题答错 · /truncate/v1 截断 · /stream/v1 思考+正文流 · /think400/v1 思考字段 400",
  );
}
