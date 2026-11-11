/**
 * agentContracts：请求契约与 ALP_AGENT_* 覆盖 / 夹紧。
 *
 * 默认值是「跑飞保护」而不是产品限制，所以这里既断言默认值，也断言全部可覆盖。
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_PREVIEW_CHARS,
  DEFAULT_AGENT_LIMITS,
  agentEventToSse,
  agentRequest,
  parseAgentLimits,
  previewOf,
  type AgentDoneEvent,
} from "@/lib/agentContracts";
import { buildTutorQuestion } from "./tutorQuestion";

it("带图长问题保持转写要求并适配请求长度，原始输入保持完整", () => {
  const question = "完整问题".repeat(1000);
  const prompt = buildTutorQuestion(question,3);
  expect(prompt).toContain("逐字转写");
  expect(prompt).toContain("【解答】");
  expect(agentRequest.safeParse({ question:prompt }).success).toBe(true);
  expect(question).toHaveLength(4000);
  expect(buildTutorQuestion("",1)).toContain("请按图片回答");
});

describe("parseAgentLimits", () => {
  it("无环境变量时用默认值（8 / 5 / 20s / 4000 / 180s）", () => {
    const limits = parseAgentLimits({});
    expect(limits).toEqual(DEFAULT_AGENT_LIMITS);
    expect(limits).toMatchObject({
      maxSteps: 8,
      maxParallelTools: 5,
      toolTimeoutMs: 20_000,
      maxResultChars: 4_000,
      sessionBudgetMs: 180_000,
    });
  });

  it("全部字段都能被 ALP_AGENT_* 覆盖", () => {
    const limits = parseAgentLimits({
      ALP_AGENT_MAX_STEPS: "12",
      ALP_AGENT_MAX_PARALLEL_TOOLS: "3",
      ALP_AGENT_TOOL_TIMEOUT_MS: "15000",
      ALP_AGENT_MAX_RESULT_CHARS: "2000",
      ALP_AGENT_BUDGET_MS: "120000",
      ALP_AGENT_MODEL_TIMEOUT_MS: "30000",
    });
    expect(limits).toEqual({
      maxSteps: 12,
      maxParallelTools: 3,
      toolTimeoutMs: 15_000,
      maxResultChars: 2_000,
      sessionBudgetMs: 120_000,
      modelTimeoutMs: 30_000,
    });
  });

  it("越界值被夹紧，非法值回落默认", () => {
    const clamped = parseAgentLimits({
      ALP_AGENT_MAX_STEPS: "0",
      ALP_AGENT_MAX_PARALLEL_TOOLS: "99",
      ALP_AGENT_TOOL_TIMEOUT_MS: "-5",
      ALP_AGENT_MAX_RESULT_CHARS: "999999",
    });
    expect(clamped.maxSteps).toBe(1);
    expect(clamped.maxParallelTools).toBe(10);
    expect(clamped.toolTimeoutMs).toBe(1_000);
    expect(clamped.maxResultChars).toBe(20_000);

    const invalid = parseAgentLimits({ ALP_AGENT_MAX_STEPS: "eight" });
    expect(invalid.maxSteps).toBe(DEFAULT_AGENT_LIMITS.maxSteps);
  });
});

describe("agentRequest", () => {
  it("只接受 question/images/subject/budgetMinutes", () => {
    const ok = agentRequest.safeParse({
      question: "  给我排一条路径  ",
      subject: "os",
      budgetMinutes: 90,
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.question).toBe("给我排一条路径");

    expect(agentRequest.safeParse({ question: "hi", baseUrl: "https://evil" }).success).toBe(false);
    expect(agentRequest.safeParse({ question: "" }).success).toBe(false);
    expect(agentRequest.safeParse({ question: "hi", subject: "nope" }).success).toBe(false);
    expect(agentRequest.safeParse({ question: "hi", budgetMinutes: 1 }).success).toBe(false);
  });

  it("图片只接受 data:image/*;base64，最多 3 张", () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    expect(agentRequest.safeParse({ question: "q", images: [image] }).success).toBe(true);
    expect(agentRequest.safeParse({ question: "q", images: ["https://x/y.png"] }).success).toBe(false);
    expect(
      agentRequest.safeParse({ question: "q", images: [image, image, image, image] }).success,
    ).toBe(false);
  });
});

describe("事件序列化", () => {
  it("done 事件带停止原因与计数", () => {
    const event: AgentDoneEvent = {
      type: "done",
      stopReason: "max_steps",
      steps: 3,
      toolCalls: 2,
      elapsedMs: 1200,
      textChars: 42,
    };
    const sse = agentEventToSse(event);
    expect(sse.startsWith("data: ")).toBe(true);
    expect(sse.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(sse.slice("data: ".length).trim())).toEqual(event);
  });

  it("previewOf 压平换行并截断", () => {
    expect(previewOf("a\nb")).toBe("a b");
    const long = previewOf("x".repeat(AGENT_PREVIEW_CHARS + 20));
    expect(long).toHaveLength(AGENT_PREVIEW_CHARS + 1);
    expect(long.endsWith("…")).toBe(true);
  });
});
