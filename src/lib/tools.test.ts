/**
 * 只读工具纯函数：MCP 端点与 Agent 循环共用同一份实现。
 *
 * 锁的是「同输入同输出」与「未知参数明确报错」——静默回落会让模型拿到
 * 标错学科的路径而不自知。
 */

import { describe, expect, it } from "vitest";

import { SUBJECTS, getSubject } from "@/data/subjects";
import {
  MASTERY_SCHEMA,
  READ_ONLY_TOOL_NAMES,
  SUBJECT_SCHEMA,
  TOOLS,
  ToolArgsError,
  callReadOnlyTool,
  callReadOnlyToolText,
  isReadOnlyToolName,
  normalizeMastery,
} from "@/lib/tools";

function parseTool<T>(name: string, args: Record<string, unknown>): T {
  return JSON.parse(callReadOnlyToolText(name, args)) as T;
}

describe("tools：定义与白名单", () => {
  it("恰好 5 个只读工具，名字与 READ_ONLY_TOOL_NAMES 一致", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([...READ_ONLY_TOOL_NAMES]);
    for (const name of READ_ONLY_TOOL_NAMES) {
      expect(isReadOnlyToolName(name)).toBe(true);
    }
    expect(isReadOnlyToolName("delete_everything")).toBe(false);
  });

  it("SUBJECT_SCHEMA 的 enum 与 SUBJECTS 对齐", () => {
    expect(SUBJECT_SCHEMA.enum).toEqual(SUBJECTS.map((s) => s.id));
  });

  it("每个工具都有 JSON Schema 形状的 inputSchema", () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});

describe("tools：list_subjects", () => {
  it("返回全部学科与规模", () => {
    const payload = parseTool<{ id: string; concepts: number; questions: number }[]>(
      "list_subjects",
      {},
    );
    expect(payload.map((s) => s.id)).toEqual(SUBJECTS.map((s) => s.id));
    for (const entry of payload) {
      expect(entry.concepts).toBeGreaterThan(0);
      expect(entry.questions).toBeGreaterThan(0);
    }
  });
});

describe("tools：get_learner_state", () => {
  it("缺掌握度时用先验补齐，并回显学科", () => {
    const payload = parseTool<{ subject: string; concepts: { mean: number; sd: number }[] }>(
      "get_learner_state",
      { subject: "os" },
    );
    expect(payload.subject).toBe("os");
    expect(payload.concepts.length).toBe(getSubject("os").graph.concepts.length);
    expect(payload.concepts[0]?.mean).toBeCloseTo(0.35, 4);
  });

  it("非法掌握度条目被丢弃，而不是让整次调用失败", () => {
    const payload = parseTool<{ concepts: { kcId: string }[] }>("get_learner_state", {
      subject: "os",
      mastery: [
        { kcId: "o01", alpha: 3, beta: 1 },
        { kcId: "o01", alpha: -1, beta: 1 },
        { kcId: "not-a-kc", alpha: 1, beta: 1 },
      ],
    });
    expect(payload.concepts.map((c) => c.kcId)).toContain("o01");
    expect(payload.concepts.length).toBe(getSubject("os").graph.concepts.length);
  });
});

describe("tools：plan_path", () => {
  it("返回路径指纹与步骤，同输入同输出", () => {
    const first = parseTool<{ pathHash: string; steps: { kcId: string }[] }>("plan_path", {
      subject: "os",
      budgetMinutes: 60,
    });
    const second = parseTool<{ pathHash: string; steps: { kcId: string }[] }>("plan_path", {
      subject: "os",
      budgetMinutes: 60,
    });
    expect(first.pathHash).toBe(second.pathHash);
    expect(first.steps.length).toBeGreaterThan(0);
    expect(first.steps[0]?.kcId).toBe("o01");
  });

  it("缺 budgetMinutes 时用 90 分钟默认值", () => {
    const payload = parseTool<{ totalMinutes: number }>("plan_path", { subject: "os" });
    expect(payload.totalMinutes).toBeLessThanOrEqual(90);
  });
});

describe("tools：search_knowledge 与 get_prerequisites", () => {
  it("检索返回 kcId 与标题", () => {
    const payload = parseTool<{ kcId: string; title: string }[]>("search_knowledge", {
      subject: "os",
      query: "进程",
      topK: 2,
    });
    expect(payload.length).toBeLessThanOrEqual(2);
    expect(payload[0]?.kcId).toBeTruthy();
  });

  it("未知 kcId 的先修闭包为空而不是抛错", () => {
    const payload = parseTool<{ prerequisites: unknown[] }>("get_prerequisites", {
      subject: "os",
      kcId: "nope",
    });
    expect(payload.prerequisites).toEqual([]);
  });
});

describe("tools：错误路径", () => {
  it("未知学科抛 ToolArgsError 并回显学科 id", () => {
    expect(() => callReadOnlyTool("get_learner_state", { subject: "quantum" })).toThrow(
      ToolArgsError,
    );
    try {
      callReadOnlyTool("get_learner_state", { subject: "quantum" });
    } catch (err) {
      expect((err as Error).message).toContain("quantum");
    }
  });

  it("未知工具抛出普通 Error（MCP 端点折成 -32602）", () => {
    expect(() => callReadOnlyTool("delete_everything", {})).toThrow(/未知工具/u);
  });

  it("normalizeMastery 对非数组输入返回全量先验", () => {
    const subject = getSubject("os");
    expect(normalizeMastery("not-an-array", subject)).toHaveLength(
      subject.graph.concepts.length,
    );
    expect(MASTERY_SCHEMA.items.required).toEqual(["kcId", "alpha", "beta"]);
  });
});
