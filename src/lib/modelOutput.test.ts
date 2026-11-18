import { afterEach, describe, expect, it, vi } from "vitest";
import { callChat } from "./chat";
import { buildUpstreamChatBody } from "./upstream";
import { anthropicOutputCapacity } from "./modelOutput";

afterEach(() => vi.unstubAllGlobals());

describe("planning uses the provider output capacity", () => {
  it("omits output limits for OpenAI-compatible requests on the proxy path", () => {
    const request = { stream: false, messages: [{ role: "user" as const, content: "规划一个方向" }] };
    const body = buildUpstreamChatBody("openai-compatible", "test", { ...request, modelDefaultOutput: true });
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("max_completion_tokens");
    expect(buildUpstreamChatBody("openai-compatible", "test", { ...request, maxTokens: 750 }).max_tokens).toBe(750);
  });

  it("sends the model's advertised maximum when the protocol requires it", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/models/example")) return Response.json({ max_tokens: 128000 });
      expect(JSON.parse(String(init.body)).max_tokens).toBe(128000);
      return Response.json({ content: [{ type: "text", text: "请补充学习目标。" }], stop_reason: "end_turn" });
    });
    vi.stubGlobal("fetch", fetcher);
    await callChat({ kind: "anthropic", model: "example", label: "测试", baseUrl: "https://example.test/v1", apiKey: "test-only" },
      { user: "规划", purpose: "direction" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(() => anthropicOutputCapacity({})).toThrow("模型输出容量");
    expect(anthropicOutputCapacity(null, 64000)).toBe(64000);
  });
});
