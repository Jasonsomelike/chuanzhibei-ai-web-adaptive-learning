import { describe, it, expect } from "vitest";
import {
  formatDueDate,
  memoryAnswerText,
  memoryKindLabel,
  memoryReviewSummary,
  nextDueAt,
} from "@/components/memory-review";
import {
  errorMemoryId,
  reviewMemory,
  upsertErrorMemory,
  type MemoryItem,
} from "@/lib/memory";
import {
  createLearner,
  progressOf,
  updateMemories,
  type LearnerState,
} from "@/lib/learner";
import type { KnowledgeGraph } from "@/lib/graph";

const DAY = 86_400_000;
const NOW = "2026-10-28T00:00:00.000Z";
const LATER = "2026-10-29T00:00:00.000Z";
const SUBJECT = "dir-memory-test";

const GRAPH: KnowledgeGraph = {
  version: "test",
  concepts: [{ id: "k1", name: "概念一", summary: "", chapter: "第一章" }],
  edges: [],
};

function plusDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY).toISOString();
}

function withErrorCard(state: LearnerState): LearnerState {
  return updateMemories(
    state,
    SUBJECT,
    (memories) =>
      upsertErrorMemory(memories, {
        questionId: "q1",
        kcId: "k1",
        prompt: "若 f(x)=x²，则 f'(1) 等于多少？",
        chosen: "B. 1",
        correction: "A. 2。由幂函数求导法则……",
        now: NOW,
      }).memories,
    GRAPH,
  );
}

describe("memoryReviewSummary", () => {
  it("没有记忆卡时返回空串，页面据此不渲染复习区", () => {
    expect(memoryReviewSummary([], NOW)).toBe("");
  });

  it("区分未解决、到期与已解决", () => {
    const state = withErrorCard(createLearner());
    const memories = progressOf(state, SUBJECT, GRAPH).memories ?? [];

    expect(memoryReviewSummary(memories, NOW)).toBe(
      "记忆卡 1 张未解决 · 目前没有到期卡片",
    );
    expect(memoryReviewSummary(memories, LATER)).toBe(
      "记忆卡 1 张未解决 · 其中 1 张已到期",
    );

    const reviewed = updateMemories(
      state,
      SUBJECT,
      (items) => reviewMemory(items, errorMemoryId("q1"), true, plusDays(NOW, 4)),
      GRAPH,
    );
    const resolved = updateMemories(
      reviewed,
      SUBJECT,
      (items) => reviewMemory(items, errorMemoryId("q1"), true, plusDays(NOW, 11)),
      GRAPH,
    );
    const resolvedTwice = updateMemories(
      resolved,
      SUBJECT,
      (items) => reviewMemory(items, errorMemoryId("q1"), true, plusDays(NOW, 32)),
      GRAPH,
    );
    const done = updateMemories(
      resolvedTwice,
      SUBJECT,
      (items) => reviewMemory(items, errorMemoryId("q1"), true, plusDays(NOW, 53)),
      GRAPH,
    );

    expect(memoryReviewSummary(progressOf(done, SUBJECT, GRAPH).memories ?? [], NOW)).toBe(
      "记忆卡 0 张未解决 · 目前没有到期卡片 · 已解决 1 张",
    );
  });
});

describe("nextDueAt 与展示辅助", () => {
  it("取所有 open 卡片里最早的到期时间", () => {
    const state = updateMemories(
      createLearner(),
      SUBJECT,
      (memories) => {
        let next = upsertErrorMemory(memories, {
          questionId: "qa",
          kcId: "k1",
          prompt: "题 A",
          correction: "解析 A",
          now: NOW,
        }).memories;
        next = upsertErrorMemory(next, {
          questionId: "qb",
          kcId: "k1",
          prompt: "题 B",
          correction: "解析 B",
          now: plusDays(NOW, 1),
        }).memories;
        return next;
      },
      GRAPH,
    );
    const memories = progressOf(state, SUBJECT, GRAPH).memories ?? [];

    expect(nextDueAt(memories)).toBe(plusDays(NOW, 1));
    expect(formatDueDate(plusDays(NOW, 1))).toBe("2026-10-29");
  });

  it("易混卡没有填写区别时给出可执行的提示", () => {
    const card: MemoryItem = {
      id: "mem-conf-k1-k2",
      kind: "confusion",
      kcId: "k1",
      withKcId: "k2",
      prompt: "把概念一与概念二搞混",
      correction: "",
      createdAt: NOW,
      lastSeenAt: NOW,
      status: "open",
      streak: 0,
      reviewCount: 0,
    };

    expect(memoryKindLabel(card)).toBe("易混");
    expect(memoryAnswerText(card)).toContain("还没有填写两者的区别");
  });

  it("错题卡优先显示解析原文", () => {
    const card: MemoryItem = {
      id: "mem-error-q1",
      kind: "error",
      kcId: "k1",
      questionId: "q1",
      prompt: "题干",
      correction: "解析正文",
      createdAt: NOW,
      lastSeenAt: NOW,
      status: "open",
      streak: 0,
      reviewCount: 0,
    };

    expect(memoryKindLabel(card)).toBe("错题");
    expect(memoryAnswerText(card)).toBe("解析正文");
  });
});

describe("复习自评不改掌握度", () => {
  it("updateMemories(reviewMemory) 刷新 lastSeenAt，alpha/beta 与作答记录完全不变", () => {
    const before = withErrorCard(createLearner());
    const masteryBefore = progressOf(before, SUBJECT, GRAPH).mastery.map((m) => ({
      kcId: m.kcId,
      alpha: m.alpha,
      beta: m.beta,
      evidenceN: m.evidenceN,
    }));
    const attemptsBefore = progressOf(before, SUBJECT, GRAPH).attempts;

    const after = updateMemories(
      before,
      SUBJECT,
      (memories) => reviewMemory(memories, errorMemoryId("q1"), true, LATER),
      GRAPH,
    );
    const progress = progressOf(after, SUBJECT, GRAPH);

    expect(progress.mastery.map((m) => ({ kcId: m.kcId, alpha: m.alpha, beta: m.beta, evidenceN: m.evidenceN }))).toEqual(
      masteryBefore,
    );
    expect(progress.attempts).toEqual(attemptsBefore);
    expect(progress.memories?.[0].lastSeenAt).toBe(LATER);
  });

  it("「没记住」同样只改复习计划", () => {
    const before = withErrorCard(createLearner());
    const masteryBefore = progressOf(before, SUBJECT, GRAPH).mastery;

    const after = updateMemories(
      before,
      SUBJECT,
      (memories) => reviewMemory(memories, errorMemoryId("q1"), false, LATER),
      GRAPH,
    );

    expect(progressOf(after, SUBJECT, GRAPH).mastery).toEqual(masteryBefore);
    expect(progressOf(after, SUBJECT, GRAPH).memories?.[0].streak).toBe(0);
    expect(progressOf(after, SUBJECT, GRAPH).memories?.[0].lastSeenAt).toBe(LATER);
  });
});
