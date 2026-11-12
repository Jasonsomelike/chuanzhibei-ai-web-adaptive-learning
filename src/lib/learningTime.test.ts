import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ruleTimeEstimates,
  validateTimeEstimates,
  timeFingerprint,
  timeBatches,
} from "./learningTime";
import { planPath, computeInputHash, checkPrereqOrder } from "./plan";
import {
  contextBudget,
  budgetUploadHits,
  estimateTokens,
} from "./contextBudget";
import { estimateLearningTime } from "./learningTimeServer";
import { __resetMemoryDbForTests, __setDbBackendForTests, getDb } from "./db";
import { loadLearningContext } from "./learningContext";
import { initialMastery } from "./mastery";
const graph = {
  version: "test",
  concepts: [
    { id: "a", name: "基础", summary: "简单概念", chapter: "1" },
    {
      id: "b",
      name: "复杂应用",
      summary: "需要结合多个公式和案例进行理解。".repeat(30),
      chapter: "2",
    },
  ],
  edges: [{ before: "a", after: "b" }],
};
describe("validated learning time and scheduling", () => {
  it("varies rule estimates by content, prerequisite depth and observed evidence", () => {
    const estimates = ruleTimeEstimates(graph, []);
    expect(estimates[1].learnMinutes).toBeGreaterThan(
      estimates[0].learnMinutes,
    );
    expect(validateTimeEstimates({ estimates }, graph)).toEqual(estimates);
    expect(
      ruleTimeEstimates(graph, [
        { ...initialMastery("a", 0), alpha: 9, beta: 1, evidenceN: 8 },
      ])[0].reviewMinutes,
    ).toBeLessThan(estimates[0].reviewMinutes);
  });
  it("rejects unknown/missing/duplicate IDs, invalid minutes and inverted ranges", () => {
    const estimates = ruleTimeEstimates(graph, []);
    for (const bad of [
      [estimates[0]],
      [...estimates, estimates[0]],
      [{ ...estimates[0], kcId: "x" }, estimates[1]],
      [{ ...estimates[0], learnMinutes: -1 }, estimates[1]],
      [{ ...estimates[0], lowMinutes: 99 }, estimates[1]],
    ])
      expect(() => validateTimeEstimates({ estimates: bad }, graph)).toThrow();
  });
  it("validated model estimates change packing and input hashes while preserving prerequisites", () => {
    const input = { graph, mastery: [], budgetMinutes: 25 };
    const estimates = ruleTimeEstimates(graph, []).map((e) => ({
      ...e,
      learnMinutes: 20,
      reviewMinutes: 10,
      lowMinutes: 5,
      highMinutes: 30,
    }));
    const result = planPath({ ...input, timeEstimates: estimates });
    expect(result.steps.map((s) => s.kcId)).toEqual(["a"]);
    expect(result.steps[0].estMinutes).toBe(20);
    expect(
      checkPrereqOrder(graph, result.steps, { mastered: new Set() }),
    ).toEqual([]);
    expect(computeInputHash(input)).not.toBe(
      computeInputHash({ ...input, timeEstimates: estimates }),
    );
    expect(planPath({ ...input, timeEstimates: estimates })).toEqual(result);
  });
  it("honors provider budgets and occupied history without cutting chunks mid-sentence", () => {
    expect(
      contextBudget({ contextWindowTokens: 32000, retrievalMaxTokens: 8000 })
        .retrieval,
    ).toBe(8000);
    const hit = {
      score: 1,
      chunk: {
        id: "a",
        docId: "d",
        directionId: "c",
        title: "讲义",
        section: "1",
        text: "栈的后进先出。".repeat(20),
        index: 0,
      },
    };
    expect(budgetUploadHits([hit], {}, 8000).hits).toEqual([]);
    expect(
      budgetUploadHits(
        [hit],
        { contextWindowTokens: 32000, retrievalMaxTokens: 8000 },
        8000,
      ).hits,
    ).toEqual([hit]);
    expect(estimateTokens("学习")).toBeGreaterThan(estimateTokens("ab"));
  });
});
describe("prompt-aware estimation batches", () => {
  it("shrinks whole concept groups to fit the configured window without dropping concepts", () => {
    const large = {
      version: "large",
      concepts: Array.from({ length: 20 }, (_, i) => ({
        id: `kc${i}`,
        name: `主题${i}`,
        summary: "结合公式与例题理解这个概念。".repeat(30),
        chapter: "1",
      })),
      edges: [],
    };
    const batches = timeBatches(
      large,
      [],
      { questions: [] },
      { contextWindowTokens: 8192, responseReserveTokens: 2048 },
    );
    expect(batches.flatMap((b) => b.graph.concepts.map((c) => c.id))).toEqual(
      large.concepts.map((c) => c.id),
    );
    expect(
      batches.every((b) => estimateTokens(b.prompt) + 2048 + 512 <= 8192),
    ).toBe(true);
    expect(batches.some((b) => b.graph.concepts.length < 8)).toBe(true);
  });
});

describe("thinking output budget", () => {
  it("reserves thinking tokens or disables thinking when the window cannot fit", () => {
    expect(
      contextBudget({ contextWindowTokens: 64000, thinking: "deep" }),
    ).toMatchObject({ thinking: "deep", response: 20480 });
    expect(
      contextBudget({ contextWindowTokens: 8192, thinking: "standard" }),
    ).toMatchObject({ thinking: "off", response: 2048 });
  });
});

describe("time estimation agent", () => {
  beforeEach(() => {
    __setDbBackendForTests("memory");
    __resetMemoryDbForTests();
  });
  it("repairs invalid JSON once, caches successful estimates and invalidates after evidence changes", async () => {
    const db = await getDb();
    const base = await loadLearningContext(db, "alice", "data-structures");
    const context = {
      ...base,
      course: { ...base.course, graph, questions: [] },
    };
    const config = {
      api: "openai-compatible" as const,
      options: { baseUrl: "https://example.com/v1", model: "mock" },
      payload: { apiKey: "test-only-key" },
    };
    const run = vi
      .fn()
      .mockResolvedValueOnce("bad json")
      .mockResolvedValue(
        JSON.stringify({ estimates: ruleTimeEstimates(graph, []) }),
      );
    const result = await estimateLearningTime(
      db,
      "alice",
      context,
      config,
      undefined,
      run,
    );
    expect(result.source).toBe("llm");
    expect(run).toHaveBeenCalledTimes(2);
    expect(
      (await estimateLearningTime(db, "alice", context, config, undefined, run))
        .source,
    ).toBe("llm");
    expect(run).toHaveBeenCalledTimes(2);
    expect(timeFingerprint(graph, [initialMastery("a", 0)])).not.toBe(
      timeFingerprint(graph, []),
    );
  });
  it("falls back honestly after bounded failures and needs no model without config", async () => {
    const db = await getDb();
    const base = await loadLearningContext(db, "alice", "data-structures");
    const context = {
      ...base,
      course: { ...base.course, graph, questions: [] },
    };
    const run = vi.fn().mockRejectedValue(new Error("unavailable"));
    const config = {
      api: "openai-compatible" as const,
      options: { baseUrl: "https://example.com/v1", model: "mock" },
      payload: { apiKey: "test-only-key" },
    };
    expect(
      await estimateLearningTime(db, "alice", context, config, undefined, run),
    ).toMatchObject({
      source: "rules",
      notice: expect.stringContaining("规则初估"),
    });
    expect(run).toHaveBeenCalledTimes(2);
    await estimateLearningTime(db, "alice", context, null, undefined, run);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
