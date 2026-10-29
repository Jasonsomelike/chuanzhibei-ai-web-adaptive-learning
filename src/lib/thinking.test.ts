import { describe, it, expect } from "vitest";
import { classifyThinkingRejection } from "@/lib/thinking";

describe("classifyThinkingRejection：思考参数被拒", () => {
  const CASES: ReadonlyArray<readonly [string, string]> = [
    [
      "OpenAI 兼容网关",
      JSON.stringify({
        error: {
          message: "Unrecognized request argument supplied: reasoning_effort",
          type: "invalid_request_error",
        },
      }),
    ],
    [
      "Anthropic thinking 字段",
      JSON.stringify({
        error: { type: "invalid_request_error", message: "thinking is not supported for this model" },
      }),
    ],
    [
      "budget_tokens 过大",
      JSON.stringify({
        error: {
          code: "invalid_request_error",
          message: "budget_tokens must be less than max_tokens",
        },
      }),
    ],
    [
      "mimo enable_thinking",
      JSON.stringify({
        error: {
          code: "InvalidParameter",
          message:
            "<400> InternalError.Algo.InvalidParameter: The model does not support enable_thinking",
        },
      }),
    ],
    [
      "大写关键词",
      JSON.stringify({ error: { message: "REASONING_EFFORT is not allowed" } }),
    ],
    [
      "param 字段点名",
      JSON.stringify({ error: { param: "reasoning_effort", message: "Unsupported parameter" } }),
    ],
    [
      "顶层 message",
      JSON.stringify({ message: "enable_thinking is not supported" }),
    ],
    ["error 是字符串", JSON.stringify({ error: "unsupported reasoning_effort" })],
    ["JSON 字符串字面量", JSON.stringify("thinking budget exceeded")],
    ["无结构化字段时退回全文", JSON.stringify({ weird: "enable_thinking is not allowed" })],
    ["纯文本 thinking", "thinking not supported"],
    ["纯文本 reasoning", "reasoning is not supported"],
    [
      "模型名里带 thinking 但确实是思考被拒",
      JSON.stringify({
        error: { message: "The model claude-3-haiku does not support thinking" },
      }),
    ],
  ];

  for (const [label, body] of CASES) {
    it(label, () => {
      expect(classifyThinkingRejection(400, body)).toBe("thinking");
    });
  }
});

describe("classifyThinkingRejection：其余 400 归 other", () => {
  const CASES: ReadonlyArray<readonly [string, string]> = [
    [
      "模型不存在",
      JSON.stringify({
        error: { code: "model_not_found", message: "The model `mimo-chat` does not exist" },
      }),
    ],
    ["Model Not Exist", JSON.stringify({ error: { message: "Model Not Exist" } })],
    [
      "模型名本身带 thinking",
      JSON.stringify({ error: { message: "Invalid model: qwen3-thinking" } }),
    ],
    [
      "模型不受支持",
      JSON.stringify({ error: { message: "Unsupported model: gpt-4o" } }),
    ],
    [
      "上下文超长",
      JSON.stringify({ error: { message: "maximum context length is 8192 tokens" } }),
    ],
    ["参数错误但不涉及思考", JSON.stringify({ error: { message: "temperature must be <= 2" } })],
    ["空对象", "{}"],
    ["JSON null", "null"],
    ["非 JSON 纯文本", "Bad Request"],
  ];

  for (const [label, body] of CASES) {
    it(label, () => {
      expect(classifyThinkingRejection(400, body)).toBe("other");
    });
  }

  it("错误响应回显请求里的 reasoning_effort 时不误判", () => {
    const body = JSON.stringify({
      error: { message: "Model Not Exist" },
      request: { reasoning_effort: "high", thinking: { type: "enabled" } },
    });
    expect(classifyThinkingRejection(400, body)).toBe("other");
  });

  it("空体 / 缺失体归 other", () => {
    expect(classifyThinkingRejection(400, "")).toBe("other");
    expect(classifyThinkingRejection(400, "   ")).toBe("other");
    expect(classifyThinkingRejection(400, null)).toBe("other");
    expect(classifyThinkingRejection(400, undefined)).toBe("other");
  });

  it("残缺 JSON 按纯文本处理", () => {
    expect(classifyThinkingRejection(400, '{"error":')).toBe("other");
    expect(classifyThinkingRejection(400, '{"error": "thinking')).toBe("thinking");
  });
});

describe("classifyThinkingRejection：只有 400 才可能是思考问题", () => {
  const thinkingBody = JSON.stringify({
    error: { message: "reasoning_effort is not supported" },
  });

  for (const status of [401, 403, 404, 409, 422, 429, 500, 502, 503]) {
    it(`HTTP ${status} 归 other`, () => {
      expect(classifyThinkingRejection(status, thinkingBody)).toBe("other");
    });
  }
});
