import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callChat,
  callChatStream,
  ChatError,
  probeThinking,
  runStructuredCall,
} from "@/lib/chat";
import type { ProviderConfig } from "@/lib/provider";

/*
 * 这些用例只 mock fetch / ReadableStream，不碰真实网络。
 * 流式测试刻意把整段 SSE 按「字节」切块——如果实现只按字符串切、
 * 或忘了 TextDecoder 的 stream 模式，多字节汉字会在块边界上变成乱码。
 */

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    label: "测试供应商",
    kind: "openai-compatible",
    baseUrl: "https://example.test/v1",
    apiKey: "test-key",
    model: "test-model",
    ...overrides,
  };
}

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

function stubFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 把整段文本按字节切块，故意让某些块从 UTF-8 汉字中间断开。 */
function sseResponse(text: string, cuts?: readonly number[]): Response {
  const bytes = new TextEncoder().encode(text);
  const boundaries = [
    0,
    ...(cuts ?? [Math.floor(bytes.length / 5), Math.floor(bytes.length / 2), Math.floor((bytes.length * 4) / 5)]),
    bytes.length,
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < boundaries.length - 1; i += 1) {
        controller.enqueue(bytes.slice(boundaries[i], boundaries[i + 1]));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── callChatStream ────────────────────────────────────────────────

describe("callChatStream", () => {
  it("SSE 跨字节块拆包仍能拼回，正文与思考分流且 usage 合并", async () => {
    const full =
      sse({ choices: [{ delta: { reasoning_content: "先想" } }] }) +
      sse({ choices: [{ delta: { content: "栈顶" } }] }) +
      sse({
        choices: [{ delta: { content: "插入" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }) +
      "data: [DONE]\n\n";
    stubFetch(() => sseResponse(full));

    const text: string[] = [];
    const reasoning: string[] = [];
    const usages: number[] = [];
    const result = await callChatStream(provider(), { user: "问" }, {
      onText: (d) => text.push(d),
      onReasoning: (d) => reasoning.push(d),
      onUsage: (u) => usages.push(u.totalTokens ?? -1),
    });

    expect(text.join("")).toBe("栈顶插入");
    expect(reasoning.join("")).toBe("先想");
    expect(result.text).toBe("栈顶插入");
    expect(result.reasoning).toBe("先想");
    expect(result.text).not.toContain("先想");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
    expect(usages).toEqual([7]);
    expect(result.thinkingDowngraded).toBe(false);
  });

  it("Anthropic：thinking_delta 进 reasoning，text_delta 进正文，usage 跨事件合并", async () => {
    const full =
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 5 } },
      })}\n\n` +
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "推一下" },
      })}\n\n` +
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "答案是栈顶" },
      })}\n\n` +
      `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 9 },
      })}\n\n`;
    stubFetch(() => sseResponse(full));

    const result = await callChatStream(
      provider({ kind: "anthropic", baseUrl: "https://anthropic.test/v1" }),
      { user: "问" },
    );

    expect(result.reasoning).toBe("推一下");
    expect(result.text).toBe("答案是栈顶");
    expect(result.finishReason).toBe("end_turn");
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 9, totalTokens: 14 });
  });

  it("finish_reason=length 时保留已输出的部分正文，不整段丢弃", async () => {
    stubFetch(() =>
      sseResponse(
        sse({ choices: [{ delta: { content: "前半段" } }] }) +
          sse({ choices: [{ delta: {}, finish_reason: "length" }] }),
      ),
    );

    const result = await callChatStream(provider(), { user: "问" });

    expect(result.text).toBe("前半段");
    expect(result.finishReason).toBe("length");
  });

  it("思考字段被 400 拒绝时只降级一次，降级请求恢复 temperature 且不再带思考字段", async () => {
    const calls = stubFetch((_url, init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (body.reasoning_effort !== undefined) {
        return jsonResponse({ error: "unsupported reasoning_effort" }, 400);
      }
      return sseResponse(
        sse({ choices: [{ delta: { content: "降级后" }, finish_reason: "stop" }] }),
      );
    });

    // provider.thinking 只有 callChatStream 会读
    const result = await callChatStream(provider({ thinking: "deep" }), { user: "问" });

    expect(result.thinkingDowngraded).toBe(true);
    expect(result.downgradeReason).toBe("thinking");
    expect(result.text).toBe("降级后");
    expect(calls).toHaveLength(2);

    const first = bodyOf(calls[0]);
    expect(first.reasoning_effort).toBe("high");
    expect(first.temperature).toBeUndefined();
    expect(first.max_tokens).toBe(20480);

    const second = bodyOf(calls[1]);
    expect(second.reasoning_effort).toBeUndefined();
    expect(second.thinking).toBeUndefined();
    expect(second.temperature).toBe(0.3);
    // 降级重发的是最小请求：回到原 maxTokens 或 2048 的较大者
    expect(second.max_tokens).toBe(2048);
    expect(second.stream).toBe(true);
  });

  it("400 与思考无关（模型名错）时不重发，错误体原样带回", async () => {
    const calls = stubFetch(() =>
      jsonResponse({ error: { message: "Model Not Exist", type: "invalid_request_error" } }, 400),
    );

    const err = await callChatStream(provider({ thinking: "standard" }), { user: "问" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ChatError);
    expect((err as ChatError).kind).toBe("http");
    expect((err as ChatError).status).toBe(400);
    // 归因是 other：去掉思考参数也没用，不能无谓地再花一次 token
    expect((err as ChatError).downgradeReason).toBe("other");
    expect((err as ChatError).responseBody).toContain("Model Not Exist");
    expect(calls).toHaveLength(1);
  });

  it("降级后仍 400 时直接失败并带 status，不会无限重试", async () => {
    const calls = stubFetch((_url, init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      // 第一次因思考字段被拒，第二次仍然 400：不能再次降级
      if (body.reasoning_effort !== undefined) {
        return jsonResponse({ error: "unsupported reasoning_effort" }, 400);
      }
      return jsonResponse({ error: { message: "still bad" } }, 400);
    });

    const err = await callChatStream(provider({ thinking: "standard" }), { user: "问" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ChatError);
    expect((err as ChatError).kind).toBe("http");
    expect((err as ChatError).status).toBe(400);
    expect((err as ChatError).downgradeReason).toBe("thinking");
    expect(calls).toHaveLength(2);
  });

  it("外部取消时保留已收到的半截正文，并以 aborted 结束", async () => {
    const encoder = new TextEncoder();
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(sse({ choices: [{ delta: { content: "半截" } }] })),
        );
        // 之后不再 enqueue / close：模拟还在生成的长回答
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stalled)));

    const writer = new AbortController();
    const received: string[] = [];
    const pending = callChatStream(
      provider(),
      { user: "问", signal: writer.signal },
      {
        onText: (delta) => {
          received.push(delta);
          writer.abort();
        },
      },
    );

    const err = await pending.catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatError);
    expect((err as ChatError).kind).toBe("aborted");
    expect(received.join("")).toBe("半截");
  });

  it("流内 error 事件按失败处理，而不是当成空回答", async () => {
    stubFetch(() =>
      sseResponse(
        `event: error\ndata: ${JSON.stringify({
          type: "error",
          error: { type: "overloaded_error", message: "上游过载" },
        })}\n\n`,
      ),
    );

    const err = await callChatStream(
      provider({ kind: "anthropic" }),
      { user: "问" },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatError);
    expect((err as ChatError).message).toContain("上游过载");
  });
});

// ── callChat 非流式 ───────────────────────────────────────────────

describe("callChat", () => {
  it("OpenAI 兼容：正文与 reasoning_content 分开返回", async () => {
    stubFetch(() =>
      jsonResponse({
        choices: [
          { message: { content: "正文", reasoning_content: "思考" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }),
    );

    const result = await callChat(provider(), { user: "问" });

    expect(result.text).toBe("正文");
    expect(result.reasoning).toBe("思考");
    expect(result.usage).toEqual({ promptTokens: 2, completionTokens: 3, totalTokens: 5 });
  });

  it("Anthropic：thinking 块在前时仍取 type=text 的正文", async () => {
    stubFetch(() =>
      jsonResponse({
        content: [
          { type: "thinking", thinking: "先想" },
          { type: "text", text: "再答" },
        ],
        stop_reason: "end_turn",
      }),
    );

    const result = await callChat(provider({ kind: "anthropic" }), { user: "问" });

    expect(result.text).toBe("再答");
    expect(result.reasoning).toBe("先想");
    expect(result.finishReason).toBe("end_turn");
  });

  it("HTTP 400 抛出带 status 与原始错误体的 ChatError", async () => {
    stubFetch(() => new Response("bad request", { status: 400 }));

    const err = await callChat(provider(), { user: "问" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatError);
    expect((err as ChatError).kind).toBe("http");
    expect((err as ChatError).status).toBe(400);
    expect((err as ChatError).responseBody).toBe("bad request");
    // 没带思考字段被 400，归因是 other（不是思考参数的锅）
    expect((err as ChatError).downgradeReason).toBe("other");
  });

  it("忽略 provider.thinking：只有请求显式指定档位才发送思考字段", async () => {
    const calls = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "好" }, finish_reason: "stop" }] }),
    );

    await callChat(provider({ thinking: "deep" }), { user: "问" });

    const body = bodyOf(calls[0]);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(600);
  });

  it("显式 thinking 时才按协议加字段并删掉 temperature", async () => {
    const calls = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "好" }, finish_reason: "stop" }] }),
    );

    await callChat(provider(), { user: "问", thinking: "standard" });

    const body = bodyOf(calls[0]);
    expect(body.reasoning_effort).toBe("medium");
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(8192);
  });

  it("allowEmptyText + length + reasoning 非空算成功（探测口径）", async () => {
    stubFetch(() =>
      jsonResponse({
        choices: [
          { message: { content: "", reasoning_content: "想了想" }, finish_reason: "length" },
        ],
      }),
    );

    const result = await callChat(provider(), {
      user: "问",
      thinking: "standard",
      allowEmptyText: true,
    });

    expect(result.text).toBe("");
    expect(result.reasoning).toBe("想了想");
    expect(result.finishReason).toBe("length");
  });

  it("普通调用遇到 finish_reason=length 仍然抛 truncated", async () => {
    stubFetch(() =>
      jsonResponse({
        choices: [{ message: { content: "半截" }, finish_reason: "length" }],
      }),
    );

    const err = await callChat(provider(), { user: "问" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatError);
    expect((err as ChatError).kind).toBe("truncated");
  });

  it("Anthropic 协议走 /messages，密钥走 x-api-key", async () => {
    const calls = stubFetch(() => jsonResponse({ content: [{ type: "text", text: "好" }] }));

    await callChat(provider({ kind: "anthropic", baseUrl: "https://anthropic.test/v1" }), {
      user: "问",
    });

    expect(calls[0].url).toBe("https://anthropic.test/v1/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers.Authorization).toBeUndefined();
  });
});

// ── 思考探测 ──────────────────────────────────────────────────────

describe("probeThinking", () => {
  it("reasoning 非空 → verified（length 也不影响）", async () => {
    stubFetch(() =>
      jsonResponse({
        choices: [
          { message: { content: "", reasoning_content: "推理内容" }, finish_reason: "length" },
        ],
      }),
    );

    const result = await probeThinking(provider({ thinking: "standard" }));

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified");
    expect(result.reasoning).toBe("推理内容");
  });

  it("端点接受参数但没有 reasoning → verified-empty", async () => {
    stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "可以" }, finish_reason: "stop" }] }),
    );

    const result = await probeThinking(provider({ thinking: "standard" }));

    expect(result.ok).toBe(true);
    expect(result.status).toBe("verified-empty");
  });

  it("HTTP 400 → unsupported", async () => {
    stubFetch(() => new Response("thinking not supported", { status: 400 }));

    const result = await probeThinking(provider({ thinking: "deep" }));

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unsupported");
  });

  it("网络错误 → unknown，不武断判成 unsupported", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const result = await probeThinking(provider({ thinking: "standard" }));

    expect(result.status).toBe("unknown");
  });

  it("关档不发起探测", async () => {
    const calls = stubFetch(() => jsonResponse({}));

    const result = await probeThinking(provider({ thinking: "off" }));

    expect(result.status).toBe("unknown");
    expect(calls).toHaveLength(0);
  });
});

describe("流式协议的两处真实缺口（回归）", () => {
  /*
   * OpenAI 兼容端点常见裸 {error:{...}}，没有顶层 type。
   * 旧实现只认 Anthropic 的 {type:"error"}，因此上游报错被当成「正常但没内容」，
   * 已经吐出的半截回答会被当成完整回答渲染给用户。
   */
  it("裸 error 块必须中断，而不是静默产出半截正文", async () => {
    stubFetch(
      async () =>
        sseResponse(
          sse({ choices: [{ delta: { content: "半截" } }] }) +
            sse({ error: { message: "upstream exploded" } }),
        ),
    );

    await expect(callChatStream(provider(), { user: "问" })).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("没有 [DONE] 也没有 finish_reason 的干净 EOF，标记为 incomplete", async () => {
    stubFetch(async () => sseResponse(sse({ choices: [{ delta: { content: "只有半截" } }] })));

    const result = await callChatStream(provider(), { user: "问" });
    expect(result.text).toBe("只有半截");
    expect(result.finishReason).toBe("incomplete");
  });

  it("端点忽略 stream:true 返回 application/json 时，回退到非流式结果", async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "非流式正文" }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await callChatStream(provider(), { user: "问" });
    expect(result.text).toBe("非流式正文");
    expect(result.thinkingDowngraded).toBe(false);
  });
});

// ── server 模式（服务端代发） ────────────────────────────────────

describe("server 模式请求形状", () => {
  function serverProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
      label: "服务端配置",
      kind: "openai-compatible",
      baseUrl: "https://should-not-be-used.test/v1",
      apiKey: "",
      model: "server-model",
      mode: "server",
      serverConfigured: true,
      ...overrides,
    };
  }

  it("callChat 打 /api/llm/chat：body 带 kind、不带 baseUrl/apiKey/model，请求头只有 Content-Type", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        choices: [{ message: { content: "服务端回答", reasoning_content: "服务端思考" }, finish_reason: "stop" }],
      }),
    );

    const result = await callChat(serverProvider(), {
      system: "系统提示",
      user: "用户问题",
      maxTokens: 500,
      temperature: 0.2,
      thinking: "deep",
    });

    expect(calls[0].url).toBe("/api/llm/chat");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBeUndefined();
    expect(headers["x-api-key"]).toBeUndefined();

    const body = bodyOf(calls[0]);
    expect(body.kind).toBe("openai-compatible");
    expect(body.messages).toEqual([
      { role: "system", content: "系统提示" },
      { role: "user", content: "用户问题" },
    ]);
    expect(body.maxTokens).toBe(500);
    expect(body.temperature).toBe(0.2);
    expect(body.stream).toBe(false);
    // 服务端代发不接受这三个字段：出现就会被 strictObject 拒绝
    expect(body.baseUrl).toBeUndefined();
    expect(body.apiKey).toBeUndefined();
    expect(body.model).toBeUndefined();
    // 思考档也由服务端配置决定，客户端不发思考字段
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();

    expect(result.text).toBe("服务端回答");
    expect(result.reasoning).toBe("服务端思考");
  });

  it("callChatStream 打 /api/llm/chat 并解析服务端转发的 SSE", async () => {
    const calls = stubFetch(() =>
      sseResponse(
        sse({ choices: [{ delta: { content: "流式" } }] }) +
          sse({ choices: [{ delta: { content: "回答" }, finish_reason: "stop" }] }),
      ),
    );

    const result = await callChatStream(serverProvider(), { user: "问", maxTokens: 800 });

    expect(calls[0].url).toBe("/api/llm/chat");
    const body = bodyOf(calls[0]);
    expect(body.stream).toBe(true);
    expect(body.kind).toBe("openai-compatible");
    expect(body.model).toBeUndefined();
    expect(result.text).toBe("流式回答");
    expect(result.thinkingDowngraded).toBe(false);
    expect(result.downgradeReason).toBeNull();
  });

  it("服务端返回的匿名 JSON 错误体原样挂在 ChatError 上", async () => {
    stubFetch(() =>
      jsonResponse({ error: { code: "CONFIG_MISSING", message: "该账号还没有保存模型配置" } }, 404),
    );

    const err = await callChat(serverProvider(), { user: "问" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatError);
    expect((err as ChatError).status).toBe(404);
    expect((err as ChatError).responseBody).toContain("CONFIG_MISSING");
  });

  it("server 模式把 jsonMode 与 purpose 写进请求体，缺省不写", async () => {
    const calls = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "好" }, finish_reason: "stop" }] }),
    );

    await callChat(serverProvider(), { user: "问", jsonMode: true, purpose: "items" });
    const withFlags = bodyOf(calls[0]);
    expect(withFlags.jsonMode).toBe(true);
    expect(withFlags.purpose).toBe("items");

    await callChat(serverProvider(), { user: "问" });
    const bare = bodyOf(calls[1]);
    expect(bare.jsonMode).toBeUndefined();
    expect(bare.purpose).toBeUndefined();
  });
});

describe("probeThinking 的 400 归因", () => {
  it("400 但不是思考参数 → unknown，并展示截断后的错误体", async () => {
    stubFetch(() =>
      jsonResponse({ error: { message: "This model does not exist" } }, 400),
    );

    const result = await probeThinking(provider({ thinking: "deep" }));

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("does not exist");
  });

  it("200 但正文与 reasoning 双空 → unknown，不冒充 verified-empty", async () => {
    stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
    );

    const result = await probeThinking(provider({ thinking: "standard" }));

    expect(result.ok).toBe(false);
    expect(result.status).toBe("unknown");
  });
});

// ── runStructuredCall：一次 repair 重试 ──────────────────────────

describe("runStructuredCall", () => {
  /** 取最后一次请求的 user 内容，用来断言重试提示词。 */
  function lastUser(call: FetchCall): string {
    const messages = bodyOf(call).messages as { role: string; content: string }[];
    return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  }

  it("首次结构不合格时只重试一次，callChat 调用计数为 2", async () => {
    const calls = stubFetch((_url, init) => {
      const user = lastUser({ url: "", init });
      const content = user.includes("上一次的输出") ? '{"items":[]}' : "不是 JSON";
      return jsonResponse({ choices: [{ message: { content }, finish_reason: "stop" }] });
    });

    const outcome = await runStructuredCall(
      provider(),
      { user: "请输出 JSON" },
      (text) =>
        text.startsWith("{")
          ? { ok: true, value: text }
          : { ok: false, reason: "返回内容不是 JSON" },
    );

    expect(calls).toHaveLength(2);
    expect(outcome.attempts).toBe(2);
    expect(outcome.value).toBe('{"items":[]}');
    expect(outcome.reason).toBeNull();
    expect(outcome.firstText).toBe("不是 JSON");
    // 第二次提示词带上失败原因，模型才知道要改什么
    expect(lastUser(calls[1])).toContain("返回内容不是 JSON");
    expect(lastUser(calls[1])).toContain("请输出 JSON");
  });

  it("第一次就合格时不重试（调用计数为 1）", async () => {
    const calls = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: '{"ok":1}' }, finish_reason: "stop" }] }),
    );

    const outcome = await runStructuredCall(provider(), { user: "请输出 JSON" }, (text) => ({
      ok: true,
      value: text,
    }));

    expect(calls).toHaveLength(1);
    expect(outcome.attempts).toBe(1);
    expect(outcome.value).toBe('{"ok":1}');
  });

  it("两次都不合格时返回最后一次原因，不再发第三次", async () => {
    const calls = stubFetch(() =>
      jsonResponse({ choices: [{ message: { content: "仍然是坏的" }, finish_reason: "stop" }] }),
    );

    const outcome = await runStructuredCall(provider(), { user: "请输出 JSON" }, () => ({
      ok: false,
      reason: "结构不合格",
    }));

    expect(calls).toHaveLength(2);
    expect(outcome.attempts).toBe(2);
    expect(outcome.value).toBeNull();
    expect(outcome.reason).toBe("结构不合格");
    expect(outcome.text).toBe("仍然是坏的");
  });

  it("截断且没给更大预算时不重试，truncated 直接抛给调用方", async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        choices: [{ message: { content: "半截" }, finish_reason: "length" }],
      }),
    );

    const err = await runStructuredCall(provider(), { user: "请输出 JSON", maxTokens: 100 }, () => ({
      ok: false,
      reason: "结构不合格",
    })).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatError);
    expect((err as ChatError).kind).toBe("truncated");
    expect(calls).toHaveLength(1);
  });

  it("截断且给了更大预算时重试一次，第二次成功即采信", async () => {
    const calls = stubFetch((_url, init) => {
      const body = bodyOf({ url: "", init });
      if (body.max_tokens === 400) {
        return jsonResponse({
          choices: [{ message: { content: "半截" }, finish_reason: "length" }],
        });
      }
      return jsonResponse({
        choices: [{ message: { content: '{"ok":1}' }, finish_reason: "stop" }],
      });
    });

    const outcome = await runStructuredCall(
      provider(),
      { user: "请输出 JSON", maxTokens: 400 },
      (text) => ({ ok: true, value: text }),
      { maxTokens: 800 },
    );

    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[1]).max_tokens).toBe(800);
    expect(outcome.value).toBe('{"ok":1}');
    // 第一次被截断：firstText 为空串，trace 不该谎报字数
    expect(outcome.firstText).toBe("");
  });

  it("网络错误不重试", async () => {
    const calls = stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const err = await runStructuredCall(provider(), { user: "请输出 JSON" }, () => ({
      ok: false,
      reason: "结构不合格",
    })).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatError);
    expect((err as ChatError).kind).toBe("network");
    expect(calls).toHaveLength(1);
  });
});
