import { describe, expect, it } from "vitest";
import {
  buildThinkingBody,
  createSseDecoder,
  extractNonStreamingReasoning,
  extractNonStreamingText,
  parseStreamPayload,
  type SseDecoder,
  type SseEvent,
  type StreamDelta,
} from "@/lib/reasoning";

function collect(decoder: SseDecoder, chunks: readonly string[]): SseEvent[] {
  return chunks.flatMap((chunk) => decoder.push(chunk));
}

function openAiSse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function anthropicSse(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function parseOpenAi(payload: unknown): StreamDelta | null {
  return parseStreamPayload("openai-compatible", {
    event: "message",
    data: JSON.stringify(payload),
  });
}

function parseAnthropic(payload: unknown, event = "content_block_delta"): StreamDelta | null {
  return parseStreamPayload("anthropic", {
    event,
    data: JSON.stringify(payload),
  });
}

describe("createSseDecoder", () => {
  it("累积 event 与 data，空行派发；没有 event 字段时默认 message", () => {
    const decoder = createSseDecoder();
    const events = decoder.push('data: {"a":1}\n\n');
    expect(events).toEqual([{ event: "message", data: '{"a":1}' }]);
  });

  it("同一事件的多行 data 用换行连接", () => {
    const decoder = createSseDecoder();
    const events = decoder.push("event: note\ndata: line1\ndata: line2\n\n");
    expect(events).toEqual([{ event: "note", data: "line1\nline2" }]);
  });

  it("支持 CRLF 行尾", () => {
    const decoder = createSseDecoder();
    const events = decoder.push('event: message_start\r\ndata: {"type":"message_start"}\r\n\r\n');
    expect(events).toEqual([
      { event: "message_start", data: '{"type":"message_start"}' },
    ]);
  });

  it("CRLF 被拆到两个 chunk 时仍只算一个换行", () => {
    const decoder = createSseDecoder();
    const first = decoder.push("data: a\r");
    const second = decoder.push("\ndata: b\r\n\r\n");
    expect(first).toEqual([]);
    expect(second).toEqual([{ event: "message", data: "a\nb" }]);
  });

  it("一个 JSON 被拆成三块后仍还原成一条事件", () => {
    const decoder = createSseDecoder();
    const payload = 'data: {"choices":[{"delta":{"content":"拆包也要能还原"}}]}\n\n';
    const chunks = [payload.slice(0, 9), payload.slice(9, 41), payload.slice(41)];
    const events = collect(decoder, chunks);

    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.data)).toEqual({
      choices: [{ delta: { content: "拆包也要能还原" } }],
    });
  });

  it("逐字符推送也能正确派发", () => {
    const decoder = createSseDecoder();
    const payload = 'data: {"ok":true}\n\n';
    const events: SseEvent[] = [];
    for (const ch of payload) events.push(...decoder.push(ch));
    expect(events).toEqual([{ event: "message", data: '{"ok":true}' }]);
  });

  it("一个 chunk 里有多条事件时按顺序全部派发", () => {
    const decoder = createSseDecoder();
    expect(decoder.push("data: a\n\ndata: b\n\n")).toEqual([
      { event: "message", data: "a" },
      { event: "message", data: "b" },
    ]);
  });

  it("[DONE] 被拆包且结尾没有空行时，flush 仍能派发", () => {
    const decoder = createSseDecoder();
    expect(decoder.push("data: [DO")).toEqual([]);
    expect(decoder.push("NE]")).toEqual([]);
    expect(decoder.flush()).toEqual([{ event: "message", data: "[DONE]" }]);
  });

  it("注释行与 id/retry 不产生事件", () => {
    const decoder = createSseDecoder();
    const events = decoder.push(": keepalive\nid: 7\nretry: 1000\n\n");
    expect(events).toEqual([]);
  });

  it("空 data 不派发事件", () => {
    const decoder = createSseDecoder();
    expect(decoder.push("data:\n\n")).toEqual([]);
  });

  it("[DONE] 作为普通事件返回，由解析层过滤", () => {
    const decoder = createSseDecoder();
    const events = decoder.push("data: [DONE]\n\n");
    expect(events).toEqual([{ event: "message", data: "[DONE]" }]);
    expect(parseStreamPayload("openai-compatible", events[0]!)).toBeNull();
    expect(parseStreamPayload("anthropic", events[0]!)).toBeNull();
  });

  it("流结束时没有空行，flush 仍派发已累积的事件；再次 flush 为空", () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data: {"a":1}')).toEqual([]);
    expect(decoder.flush()).toEqual([{ event: "message", data: '{"a":1}' }]);
    expect(decoder.flush()).toEqual([]);
  });

  it("冒号后只去掉一个空格，多出来的空格属于数据", () => {
    const decoder = createSseDecoder();
    expect(decoder.push("data:  x\n\n")).toEqual([{ event: "message", data: " x" }]);
  });
});

describe("parseStreamPayload / OpenAI 兼容", () => {
  it("delta.content 只进正文", () => {
    expect(
      parseOpenAi({ choices: [{ delta: { content: "答" }, finish_reason: null }] }),
    ).toEqual({ text: "答", reasoning: "", finishReason: null });
  });

  it("delta.reasoning_content 只进思考", () => {
    expect(
      parseOpenAi({
        choices: [{ delta: { reasoning_content: "先想" }, finish_reason: null }],
      }),
    ).toEqual({ text: "", reasoning: "先想", finishReason: null });
  });

  it("delta.reasoning 只进思考", () => {
    expect(
      parseOpenAi({ choices: [{ delta: { reasoning: "想想" }, finish_reason: null }] }),
    ).toEqual({ text: "", reasoning: "想想", finishReason: null });
  });

  it("delta.reasoning_details 取 text/summary，跳过加密块", () => {
    expect(
      parseOpenAi({
        choices: [
          {
            delta: {
              reasoning_details: [
                { type: "reasoning.text", text: "甲" },
                { type: "reasoning.summary", summary: "乙" },
                { type: "reasoning.encrypted", data: "cipher" },
              ],
            },
          },
        ],
      }),
    ).toEqual({ text: "", reasoning: "甲\n乙", finishReason: null });
  });

  it("同一块里正文与思考各归各的字段", () => {
    expect(
      parseOpenAi({
        choices: [{ delta: { content: "正文", reasoning_content: "思考" }, finish_reason: "stop" }],
      }),
    ).toEqual({ text: "正文", reasoning: "思考", finishReason: "stop" });
  });

  it("content 是多模态片段数组时拼接 text 片段", () => {
    expect(
      parseOpenAi({
        choices: [{ delta: { content: [{ type: "text", text: "你" }, { type: "text", text: "好" }] } }],
      }),
    ).toEqual({ text: "你好", reasoning: "", finishReason: null });
  });

  it("finish_reason 与 usage 一起返回，缺 total 时用 prompt+completion 补", () => {
    expect(
      parseOpenAi({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }),
    ).toEqual({
      text: "",
      reasoning: "",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    });
  });

  it("只有 role 的占位块返回 null", () => {
    expect(
      parseOpenAi({ choices: [{ delta: { role: "assistant" }, finish_reason: null }] }),
    ).toBeNull();
  });

  it("坏 JSON 与非对象 JSON 返回 null，不抛异常", () => {
    expect(
      parseStreamPayload("openai-compatible", { event: "message", data: "{not json" }),
    ).toBeNull();
    expect(
      parseStreamPayload("openai-compatible", { event: "message", data: "[1,2,3]" }),
    ).toBeNull();
  });
});

describe("parseStreamPayload / Anthropic", () => {
  it("text_delta 只进正文", () => {
    expect(
      parseAnthropic({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "答" },
      }),
    ).toEqual({ text: "答", reasoning: "", finishReason: null });
  });

  it("thinking_delta 只进思考", () => {
    expect(
      parseAnthropic({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "想" },
      }),
    ).toEqual({ text: "", reasoning: "想", finishReason: null });
  });

  it("delta.type 为空且 delta.text 是字符串时按 text_delta 处理", () => {
    expect(
      parseAnthropic({
        type: "content_block_delta",
        index: 0,
        delta: { text: "无 type 正文" },
      }),
    ).toEqual({ text: "无 type 正文", reasoning: "", finishReason: null });
  });

  it("delta.type 为空且没有 text 字符串时不产出内容，thinking 字段也不进思考", () => {
    expect(
      parseAnthropic({
        type: "content_block_delta",
        index: 0,
        delta: { thinking: "只有 thinking 字段" },
      }),
    ).toBeNull();
    expect(
      parseAnthropic({
        type: "content_block_delta",
        index: 1,
        delta: { text: 42 },
      }),
    ).toBeNull();
  });

  it("signature_delta 与 input_json_delta 不产出任何内容", () => {
    expect(
      parseAnthropic({
        type: "content_block_delta",
        index: 1,
        delta: { type: "signature_delta", signature: "sig" },
      }),
    ).toBeNull();
    expect(
      parseAnthropic({
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: "{}" },
      }),
    ).toBeNull();
  });

  it("message_delta 取 stop_reason 与 output usage", () => {
    expect(
      parseAnthropic(
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 20 },
        },
        "message_delta",
      ),
    ).toEqual({
      text: "",
      reasoning: "",
      finishReason: "end_turn",
      usage: { completionTokens: 20 },
    });
  });

  it("message_start 取 input usage", () => {
    expect(
      parseAnthropic(
        {
          type: "message_start",
          message: { usage: { input_tokens: 12, output_tokens: 1 } },
        },
        "message_start",
      ),
    ).toEqual({
      text: "",
      reasoning: "",
      finishReason: null,
      usage: { promptTokens: 12, completionTokens: 1, totalTokens: 13 },
    });
  });

  it("ping / message_stop 返回 null", () => {
    expect(parseAnthropic({ type: "ping" }, "ping")).toBeNull();
    expect(parseAnthropic({ type: "message_stop" }, "message_stop")).toBeNull();
  });

  it("payload 缺 type 时回退到 SSE 事件名", () => {
    expect(
      parseStreamPayload("anthropic", {
        event: "content_block_delta",
        data: JSON.stringify({ delta: { type: "text_delta", text: "回退" } }),
      }),
    ).toEqual({ text: "回退", reasoning: "", finishReason: null });
  });
});

describe("流式累加后正文与思考不串味", () => {
  it("OpenAI：reasoning_content 与 content 分开累加", () => {
    const decoder = createSseDecoder();
    const events = decoder.push(
      [
        openAiSse({ choices: [{ delta: { reasoning_content: "先想" } }] }),
        openAiSse({ choices: [{ delta: { content: "再答" } }] }),
        "data: [DONE]\n\n",
      ].join(""),
    );

    let text = "";
    let reasoning = "";
    for (const event of events) {
      const delta = parseStreamPayload("openai-compatible", event);
      if (!delta) continue;
      text += delta.text;
      reasoning += delta.reasoning;
    }

    expect(text).toBe("再答");
    expect(reasoning).toBe("先想");
    expect(text).not.toContain("先想");
    expect(reasoning).not.toContain("再答");
  });

  it("Anthropic：thinking_delta / signature_delta / text_delta 分流", () => {
    const decoder = createSseDecoder();
    const events = decoder.push(
      [
        anthropicSse("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "先想" },
        }),
        anthropicSse("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig" },
        }),
        anthropicSse("content_block_delta", {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "再答" },
        }),
        anthropicSse("message_delta", {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 20 },
        }),
      ].join(""),
    );

    let text = "";
    let reasoning = "";
    let finishReason: string | null = null;
    for (const event of events) {
      const delta = parseStreamPayload("anthropic", event);
      if (!delta) continue;
      text += delta.text;
      reasoning += delta.reasoning;
      finishReason = delta.finishReason ?? finishReason;
    }

    expect(text).toBe("再答");
    expect(reasoning).toBe("先想");
    expect(finishReason).toBe("end_turn");
    expect(text).not.toContain("先想");
    expect(reasoning).not.toContain("再答");
  });

  it("Anthropic：delta.type 缺失的流式事件仍能出字，thinking_delta 不混入正文", () => {
    const decoder = createSseDecoder();
    const events = decoder.push(
      [
        anthropicSse("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { text: "无 type 也" },
        }),
        anthropicSse("content_block_delta", {
          type: "content_block_delta",
          index: 1,
          delta: { type: "thinking_delta", thinking: "思考" },
        }),
        anthropicSse("content_block_delta", {
          type: "content_block_delta",
          index: 2,
          delta: { text: "要出字" },
        }),
      ].join(""),
    );

    let text = "";
    let reasoning = "";
    for (const event of events) {
      const delta = parseStreamPayload("anthropic", event);
      if (!delta) continue;
      text += delta.text;
      reasoning += delta.reasoning;
    }

    expect(text).toBe("无 type 也要出字");
    expect(reasoning).toBe("思考");
    expect(text).not.toContain("思考");
    expect(reasoning).not.toContain("要出字");
  });
});

describe("非流式解析", () => {
  it("OpenAI：message.content 是正文，reasoning_content 是思考", () => {
    const json = {
      choices: [
        {
          message: { content: "正文", reasoning_content: "思考" },
          finish_reason: "stop",
        },
      ],
    };
    expect(extractNonStreamingText("openai-compatible", json)).toBe("正文");
    expect(extractNonStreamingReasoning("openai-compatible", json)).toBe("思考");
  });

  it("OpenAI：reasoning 与 reasoning_details 都能取到", () => {
    const viaReasoning = { choices: [{ message: { content: "", reasoning: "别名" } }] };
    expect(extractNonStreamingReasoning("openai-compatible", viaReasoning)).toBe("别名");

    const viaDetails = {
      choices: [
        {
          message: {
            content: "正文",
            reasoning_details: [
              { type: "reasoning.text", text: "细节一" },
              { type: "reasoning.summary", summary: "摘要二" },
            ],
          },
        },
      ],
    };
    expect(extractNonStreamingReasoning("openai-compatible", viaDetails)).toBe("细节一\n摘要二");
  });

  it("OpenAI：只有思考时正文必须是空串，不能拿思考兜底", () => {
    const json = { choices: [{ message: { content: null, reasoning_content: "只有思考" } }] };
    expect(extractNonStreamingText("openai-compatible", json)).toBe("");
    expect(extractNonStreamingReasoning("openai-compatible", json)).toBe("只有思考");
  });

  it("OpenAI：content 为片段数组时只拼 text 片段", () => {
    const json = {
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "第一" },
              { type: "image_url", image_url: { url: "x" } },
              { type: "text", text: "第二" },
            ],
          },
        },
      ],
    };
    expect(extractNonStreamingText("openai-compatible", json)).toBe("第一第二");
  });

  it("Anthropic：thinking 块在正文前面时，正文仍只取 type=text", () => {
    const json = {
      content: [
        { type: "thinking", thinking: "先思考", signature: "sig" },
        { type: "text", text: "后回答" },
      ],
    };
    expect(extractNonStreamingText("anthropic", json)).toBe("后回答");
    expect(extractNonStreamingReasoning("anthropic", json)).toBe("先思考");
  });

  it("Anthropic：多个 text 块按顺序拼接，thinking/redacted_thinking 不混入正文", () => {
    const json = {
      content: [
        { type: "text", text: "第一段" },
        { type: "redacted_thinking", data: "cipher" },
        { type: "thinking", thinking: "思考内容" },
        { type: "text", text: "第二段" },
      ],
    };
    const text = extractNonStreamingText("anthropic", json);
    expect(text).toBe("第一段第二段");
    expect(text).not.toContain("思考内容");
    expect(extractNonStreamingReasoning("anthropic", json)).toBe("思考内容");
  });

  it("Anthropic：只有 thinking 时正文为空", () => {
    const json = { content: [{ type: "thinking", thinking: "思考" }] };
    expect(extractNonStreamingText("anthropic", json)).toBe("");
    expect(extractNonStreamingReasoning("anthropic", json)).toBe("思考");
  });

  it("Anthropic：没有 type 的块只要 text 是字符串就算正文", () => {
    const json = {
      content: [
        { text: "无 type 第一段" },
        { type: "thinking", thinking: "思考不应进正文" },
        { text: "无 type 第二段" },
      ],
    };
    const text = extractNonStreamingText("anthropic", json);
    expect(text).toBe("无 type 第一段无 type 第二段");
    expect(text).not.toContain("思考不应进正文");
    // 推理仍只认 type=thinking，无 type 的块不进推理
    expect(extractNonStreamingReasoning("anthropic", json)).toBe("思考不应进正文");
  });

  it("Anthropic：没有 type 且 text 不是字符串的块被跳过", () => {
    const json = {
      content: [{ text: 123 }, { text: null }, { type: "text", text: "正常" }],
    };
    expect(extractNonStreamingText("anthropic", json)).toBe("正常");
  });

  it("非对象输入一律返回空串", () => {
    expect(extractNonStreamingText("openai-compatible", null)).toBe("");
    expect(extractNonStreamingReasoning("openai-compatible", "x")).toBe("");
    expect(extractNonStreamingText("anthropic", [])).toBe("");
    expect(extractNonStreamingReasoning("anthropic", 42)).toBe("");
  });
});

describe("buildThinkingBody", () => {
  const baseBody = {
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.3,
    top_p: 0.9,
    max_tokens: 600,
  };

  it("关档：OpenAI 兼容请求体不出现 reasoning_effort/thinking，temperature 保留", () => {
    const result = buildThinkingBody("openai-compatible", "off", baseBody, 600);

    expect(result.thinkingFields).toBe(false);
    expect(result.maxTokens).toBe(600);
    expect("reasoning_effort" in result.body).toBe(false);
    expect("thinking" in result.body).toBe(false);
    expect(result.body.temperature).toBe(0.3);
    expect(result.body.max_tokens).toBe(600);
  });

  it("关档：Anthropic 请求体不出现 thinking，并清掉输入里残留的思考字段", () => {
    const dirty = {
      ...baseBody,
      reasoning_effort: "high",
      thinking: { type: "enabled", budget_tokens: 4096 },
    };
    const result = buildThinkingBody("anthropic", "off", dirty, 1024);

    expect(result.thinkingFields).toBe(false);
    expect("reasoning_effort" in result.body).toBe(false);
    expect("thinking" in result.body).toBe(false);
    expect(result.maxTokens).toBe(1024);
    // 入参不被修改
    expect(dirty.reasoning_effort).toBe("high");
    expect(dirty.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
  });

  it("标准档：OpenAI 兼容发 reasoning_effort=medium，max_tokens 提到 8192，删采样参数", () => {
    const result = buildThinkingBody("openai-compatible", "standard", baseBody, 600);

    expect(result.thinkingFields).toBe(true);
    expect(result.maxTokens).toBe(8192);
    expect(result.body.reasoning_effort).toBe("medium");
    expect("thinking" in result.body).toBe(false);
    expect(result.body.max_tokens).toBe(8192);
    expect("temperature" in result.body).toBe(false);
    expect("top_p" in result.body).toBe(false);
  });

  it("深入档：OpenAI 兼容发 reasoning_effort=high，max_tokens 提到 20480", () => {
    const result = buildThinkingBody("openai-compatible", "deep", baseBody, 600);

    expect(result.thinkingFields).toBe(true);
    expect(result.maxTokens).toBe(20480);
    expect(result.body.reasoning_effort).toBe("high");
    expect(result.body.max_tokens).toBe(20480);
  });

  it("标准档：Anthropic 发 thinking budget=4096，max_tokens≥8192，删采样参数", () => {
    const result = buildThinkingBody("anthropic", "standard", baseBody, 600);

    expect(result.thinkingFields).toBe(true);
    expect(result.maxTokens).toBe(8192);
    expect(result.body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    expect("reasoning_effort" in result.body).toBe(false);
    expect(result.body.max_tokens).toBe(8192);
    expect("temperature" in result.body).toBe(false);
    expect("top_p" in result.body).toBe(false);
  });

  it("深入档：Anthropic 发 thinking budget=16384，max_tokens≥20480 且大于 budget", () => {
    const result = buildThinkingBody("anthropic", "deep", baseBody, 600);

    expect(result.maxTokens).toBe(20480);
    expect(result.body.thinking).toEqual({ type: "enabled", budget_tokens: 16384 });
    expect(result.maxTokens).toBeGreaterThan(16384);
  });

  it("基础 max_tokens 已经很大时不被压低", () => {
    const openAi = buildThinkingBody("openai-compatible", "standard", baseBody, 30000);
    expect(openAi.maxTokens).toBe(30000);
    expect(openAi.body.max_tokens).toBe(30000);

    const anthropic = buildThinkingBody("anthropic", "deep", baseBody, 30000);
    expect(anthropic.maxTokens).toBe(30000);
    expect(anthropic.body.max_tokens).toBe(30000);
  });

  it("不修改入参，返回新的请求体对象", () => {
    const result = buildThinkingBody("openai-compatible", "deep", baseBody, 600);

    expect(result.body).not.toBe(baseBody);
    expect(baseBody.temperature).toBe(0.3);
    expect(baseBody.max_tokens).toBe(600);
    expect("reasoning_effort" in baseBody).toBe(false);
  });
});
