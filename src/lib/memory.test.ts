import { describe, it, expect } from "vitest";
import {
  GRADUATION_STREAK,
  MAX_CORRECTION_CHARS,
  MAX_MEMORIES,
  MAX_PROMPT_CHARS,
  REVIEW_INTERVALS_DAYS,
  addConfusionMemory,
  confusionMemoryId,
  dueAt,
  dueMemories,
  errorMemoryId,
  memoryStats,
  parseMemories,
  resolveMemory,
  reviewMemory,
  upsertErrorMemory,
  type ErrorMemoryInput,
  type MemoryItem,
} from "@/lib/memory";

const DAY = 86_400_000;
const NOW = "2026-10-28T00:00:00.000Z";

function plusDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY).toISOString();
}

function errorInput(
  overrides: Partial<ErrorMemoryInput> = {},
): ErrorMemoryInput {
  return {
    questionId: "q1",
    kcId: "c01",
    prompt: "若 f(x)=x²，则 f'(1) 等于多少？",
    chosen: "B. 1",
    correction: "A. 2。由幂函数求导法则……",
    now: NOW,
    ...overrides,
  };
}

function addError(
  memories: readonly MemoryItem[],
  overrides: Partial<ErrorMemoryInput> = {},
): readonly MemoryItem[] {
  const result = upsertErrorMemory(memories, errorInput(overrides));
  if (result.warning) throw new Error(result.warning);
  return result.memories;
}

function openCards(count: number): readonly MemoryItem[] {
  let memories: readonly MemoryItem[] = [];
  for (let i = 0; i < count; i += 1) {
    memories = addError(memories, { questionId: `q${i}` });
  }
  return memories;
}

function resolvedCard(questionId: string, at: string): MemoryItem {
  const memories = addError([], { questionId, now: at });
  return resolveMemory(memories, errorMemoryId(questionId), at)[0];
}

const VALID_CARD = {
  id: "mem-error-q1",
  kind: "error",
  kcId: "c01",
  questionId: "q1",
  prompt: "题干",
  chosen: "B",
  correction: "解析",
  note: "我的备注",
  createdAt: NOW,
  lastSeenAt: NOW,
  status: "open",
  streak: 1,
  reviewCount: 2,
};

describe("卡片 id", () => {
  it("错题按题目 id、易混按知识点对生成稳定 id", () => {
    expect(errorMemoryId("q1")).toBe("mem-error-q1");
    expect(confusionMemoryId("c01", "c02")).toBe("mem-conf-c01-c02");
  });
});

describe("upsertErrorMemory", () => {
  it("首次答错创建一张 open 卡，1 天后到期", () => {
    const result = upsertErrorMemory([], errorInput());
    expect(result.warning).toBeUndefined();
    expect(result.memories).toHaveLength(1);

    const card = result.memories[0];
    expect(card.id).toBe(errorMemoryId("q1"));
    expect(card.kind).toBe("error");
    expect(card.kcId).toBe("c01");
    expect(card.questionId).toBe("q1");
    expect(card.chosen).toBe("B. 1");
    expect(card.status).toBe("open");
    expect(card.streak).toBe(0);
    expect(card.reviewCount).toBe(0);
    expect(card.createdAt).toBe(NOW);
    expect(card.lastSeenAt).toBe(NOW);
    expect(card.resolvedAt).toBeUndefined();
    expect(dueAt(card)).toBe(plusDays(NOW, REVIEW_INTERVALS_DAYS[0]));
  });

  it("同一道题再次答错只更新原卡，不新增（同题幂等）", () => {
    const first = upsertErrorMemory([], errorInput()).memories;
    const second = upsertErrorMemory(
      first,
      errorInput({
        chosen: "D. 0",
        correction: "A. 2。换了解析。",
        now: plusDays(NOW, 2),
      }),
    );

    expect(second.warning).toBeUndefined();
    expect(second.memories).toHaveLength(1);
    const card = second.memories[0];
    expect(card.chosen).toBe("D. 0");
    expect(card.correction).toContain("换了解析");
    expect(card.lastSeenAt).toBe(plusDays(NOW, 2));
    expect(card.createdAt).toBe(NOW);
    expect(card.reviewCount).toBe(1);
  });

  it("再次答错是一次 lapse：streak 归零、状态回到 open", () => {
    const id = errorMemoryId("q1");
    let memories = addError([]);
    memories = reviewMemory(memories, id, true, plusDays(NOW, 1));
    memories = reviewMemory(memories, id, true, plusDays(NOW, 4));
    expect(memories[0].streak).toBe(2);

    memories = addError(memories, {
      chosen: "C. 0.5",
      now: plusDays(NOW, 5),
    });

    expect(memories[0].streak).toBe(0);
    expect(memories[0].status).toBe("open");
    expect(memories[0].lastSeenAt).toBe(plusDays(NOW, 5));
    expect(dueAt(memories[0])).toBe(plusDays(NOW, 6));
  });

  it("容量已满时更新已有错题卡仍然成功，不被拒绝", () => {
    const memories = openCards(MAX_MEMORIES);
    const updatedAt = plusDays(NOW, 3);
    const result = upsertErrorMemory(
      memories,
      errorInput({ questionId: "q0", chosen: "E", now: updatedAt }),
    );

    expect(result.warning).toBeUndefined();
    expect(result.memories).toHaveLength(MAX_MEMORIES);
    const card = result.memories.find((m) => m.id === errorMemoryId("q0"));
    expect(card?.chosen).toBe("E");
    expect(card?.lastSeenAt).toBe(updatedAt);
  });
});

describe("复习阶梯", () => {
  it("dueAt 按 1/3/7/21 天推进", () => {
    const id = errorMemoryId("q1");
    let memories = addError([]);
    expect(dueAt(memories[0])).toBe(plusDays(NOW, 1));

    memories = reviewMemory(memories, id, true, plusDays(NOW, 1));
    expect(dueAt(memories[0])).toBe(plusDays(NOW, 4));

    memories = reviewMemory(memories, id, true, plusDays(NOW, 4));
    expect(dueAt(memories[0])).toBe(plusDays(NOW, 11));

    memories = reviewMemory(memories, id, true, plusDays(NOW, 11));
    expect(dueAt(memories[0])).toBe(plusDays(NOW, 32));
  });

  it("reviewMemory 更新 lastSeenAt 与 reviewCount", () => {
    const id = errorMemoryId("q1");
    let memories = addError([]);

    memories = reviewMemory(memories, id, true, plusDays(NOW, 3));
    expect(memories[0].lastSeenAt).toBe(plusDays(NOW, 3));
    expect(memories[0].reviewCount).toBe(1);

    memories = reviewMemory(memories, id, true, plusDays(NOW, 4));
    expect(memories[0].lastSeenAt).toBe(plusDays(NOW, 4));
    expect(memories[0].reviewCount).toBe(2);
  });

  it("连续 4 次「记住了」毕业为 resolved", () => {
    const id = errorMemoryId("q1");
    let memories = addError([]);
    let at = NOW;
    for (let i = 0; i < GRADUATION_STREAK; i += 1) {
      at = plusDays(at, 1);
      memories = reviewMemory(memories, id, true, at);
    }

    expect(memories[0].streak).toBe(GRADUATION_STREAK);
    expect(memories[0].status).toBe("resolved");
    expect(memories[0].resolvedAt).toBe(at);
    expect(dueAt(memories[0])).toBeNull();

    memories = reviewMemory(memories, id, true, plusDays(at, 30));
    expect(memories[0].streak).toBe(GRADUATION_STREAK);
    expect(memories[0].status).toBe("resolved");
  });

  it("「没记住」重置 streak，并在 1 天后再到期", () => {
    const id = errorMemoryId("q1");
    let memories = addError([]);
    memories = reviewMemory(memories, id, true, plusDays(NOW, 1));
    memories = reviewMemory(memories, id, true, plusDays(NOW, 4));

    memories = reviewMemory(memories, id, false, plusDays(NOW, 10));
    expect(memories[0].streak).toBe(0);
    expect(memories[0].status).toBe("open");
    expect(memories[0].lastSeenAt).toBe(plusDays(NOW, 10));
    expect(dueAt(memories[0])).toBe(plusDays(NOW, 11));
  });

  it("resolved 不再到期，dueMemories 不返回", () => {
    const id = errorMemoryId("q1");
    let memories = addError([]);
    memories = resolveMemory(memories, id, plusDays(NOW, 2));

    expect(dueMemories(memories, plusDays(NOW, 10_000))).toHaveLength(0);
  });

  it("dueMemories 只返回到期卡片，并按到期时间排序", () => {
    let memories = addError([], { questionId: "qa" });
    memories = addError(memories, { questionId: "qb" });
    // qb 在 +2d 复习过，下一次到期是 +5d；qa 仍是 +1d。
    memories = reviewMemory(
      memories,
      errorMemoryId("qb"),
      true,
      plusDays(NOW, 2),
    );

    const atTwo = dueMemories(memories, plusDays(NOW, 2));
    expect(atTwo.map((m) => m.id)).toEqual([errorMemoryId("qa")]);

    const atSix = dueMemories(memories, plusDays(NOW, 6));
    expect(atSix.map((m) => m.id)).toEqual([
      errorMemoryId("qa"),
      errorMemoryId("qb"),
    ]);
  });
});

describe("resolveMemory", () => {
  it("答对同一道题直接毕业", () => {
    const id = errorMemoryId("q1");
    const memories = addError([]);
    const next = resolveMemory(memories, id, plusDays(NOW, 2));

    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("resolved");
    expect(next[0].resolvedAt).toBe(plusDays(NOW, 2));
    expect(next[0].lastSeenAt).toBe(plusDays(NOW, 2));
    expect(next[0].streak).toBe(GRADUATION_STREAK);
    expect(next[0].reviewCount).toBe(1);
    expect(dueAt(next[0])).toBeNull();

    const again = resolveMemory(next, id, plusDays(NOW, 9));
    expect(again[0].resolvedAt).toBe(plusDays(NOW, 2));
  });

  it("未知 id 原样返回", () => {
    const memories = addError([]);
    expect(resolveMemory(memories, "mem-error-nope", NOW)).toBe(memories);
  });
});

describe("容量策略", () => {
  it("新增前先清理 90 天前已解决的卡片", () => {
    const cards = openCards(MAX_MEMORIES - 1);
    const stale = resolvedCard("old", plusDays(NOW, -91));
    const memories = [...cards, stale];
    expect(memories).toHaveLength(MAX_MEMORIES);

    const result = upsertErrorMemory(
      memories,
      errorInput({ questionId: "fresh", now: NOW }),
    );

    expect(result.warning).toBeUndefined();
    expect(result.memories).toHaveLength(MAX_MEMORIES);
    expect(result.memories.some((m) => m.id === errorMemoryId("old"))).toBe(
      false,
    );
    expect(result.memories.some((m) => m.id === errorMemoryId("fresh"))).toBe(
      true,
    );
  });

  it("仍满时删最早的 resolved 卡片", () => {
    const cards = openCards(MAX_MEMORIES - 1);
    const recent = resolvedCard("recent", NOW);
    const memories = [...cards, recent];
    expect(memories).toHaveLength(MAX_MEMORIES);

    const result = upsertErrorMemory(
      memories,
      errorInput({ questionId: "fresh", now: plusDays(NOW, 1) }),
    );

    expect(result.warning).toBeUndefined();
    expect(result.memories).toHaveLength(MAX_MEMORIES);
    expect(result.memories.some((m) => m.id === errorMemoryId("recent"))).toBe(
      false,
    );
    expect(result.memories.some((m) => m.id === errorMemoryId("fresh"))).toBe(
      true,
    );
  });

  it("全部 open 且无可删项时拒绝新增并返回 warning", () => {
    const memories = openCards(MAX_MEMORIES);
    const result = upsertErrorMemory(
      memories,
      errorInput({ questionId: "overflow", now: NOW }),
    );

    expect(result.memories).toHaveLength(MAX_MEMORIES);
    expect(result.memories).toBe(memories);
    expect(result.warning).toContain(String(MAX_MEMORIES));
    expect(
      result.memories.some((m) => m.id === errorMemoryId("overflow")),
    ).toBe(false);
  });
});

describe("addConfusionMemory", () => {
  it("同一对知识点（含反向）只保留一张卡", () => {
    const first = addConfusionMemory([], {
      kcId: "c01",
      withKcId: "c02",
      prompt: "把导数与微分搞混",
      correction: "导数是变化率，微分是线性近似。",
      now: NOW,
    });
    expect(first.memories).toHaveLength(1);
    const card = first.memories[0];
    expect(card.id).toBe(confusionMemoryId("c01", "c02"));
    expect(card.kind).toBe("confusion");
    expect(card.withKcId).toBe("c02");
    expect(dueAt(card)).toBe(plusDays(NOW, 1));

    const second = addConfusionMemory(first.memories, {
      kcId: "c01",
      withKcId: "c02",
      prompt: "把导数与微分搞混（又忘了）",
      now: plusDays(NOW, 1),
    });
    expect(second.memories).toHaveLength(1);
    expect(second.memories[0].lastSeenAt).toBe(plusDays(NOW, 1));
    expect(second.memories[0].reviewCount).toBe(1);

    const reversed = addConfusionMemory(second.memories, {
      kcId: "c02",
      withKcId: "c01",
      prompt: "反向标记",
      now: plusDays(NOW, 2),
    });
    expect(reversed.memories).toHaveLength(1);
    expect(reversed.memories[0].id).toBe(confusionMemoryId("c01", "c02"));
    expect(reversed.memories[0].lastSeenAt).toBe(plusDays(NOW, 2));
  });

  it("把知识点和自己标成易混时返回 warning，不新增", () => {
    const result = addConfusionMemory([], {
      kcId: "c01",
      withKcId: "c01",
      prompt: "自相矛盾",
      now: NOW,
    });
    expect(result.memories).toHaveLength(0);
    expect(result.warning).toBeTruthy();
  });
});

describe("memoryStats", () => {
  it("统计 open/due/resolved 与两类卡片数", () => {
    let memories = addError([], { questionId: "q1" });
    memories = addError(memories, { questionId: "q2" });
    memories = reviewMemory(
      memories,
      errorMemoryId("q2"),
      true,
      plusDays(NOW, 1),
    );
    memories = addConfusionMemory(memories, {
      kcId: "c01",
      withKcId: "c02",
      prompt: "易混",
      now: NOW,
    }).memories;
    memories = resolveMemory(
      memories,
      confusionMemoryId("c01", "c02"),
      NOW,
    );

    expect(memoryStats(memories, plusDays(NOW, 2))).toEqual({
      open: 2,
      due: 1,
      resolved: 1,
      error: 2,
      confusion: 1,
    });
  });
});

describe("parseMemories", () => {
  it("非数组输入返回空数组", () => {
    expect(parseMemories(null)).toEqual([]);
    expect(parseMemories({})).toEqual([]);
    expect(parseMemories("[]")).toEqual([]);
    expect(parseMemories(undefined)).toEqual([]);
  });

  it("逐条过滤坏形状，只保留合法卡片", () => {
    const parsed = parseMemories([
      VALID_CARD,
      null,
      "nope",
      [],
      { ...VALID_CARD, id: "bad-kind", kind: "other" },
      { ...VALID_CARD, id: "bad-status", status: "done" },
      { ...VALID_CARD, id: "bad-created", createdAt: "昨天" },
      { ...VALID_CARD, id: "bad-last", lastSeenAt: "" },
      { ...VALID_CARD, id: "bad-question", questionId: undefined },
      { ...VALID_CARD, id: "bad-kc", kcId: "  " },
      { ...VALID_CARD, id: "bad-prompt", prompt: 123 },
      {
        ...VALID_CARD,
        id: "bad-confusion",
        kind: "confusion",
        questionId: undefined,
        withKcId: undefined,
      },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("mem-error-q1");
    expect(parsed[0].questionId).toBe("q1");
  });

  it("按 id 去重，并最多保留 MAX_MEMORIES 张", () => {
    const deduped = parseMemories([
      VALID_CARD,
      { ...VALID_CARD, prompt: "第二次" },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].prompt).toBe("题干");

    const many = Array.from({ length: MAX_MEMORIES + 5 }, (_, i) => ({
      ...VALID_CARD,
      id: `mem-error-x${i}`,
      questionId: `x${i}`,
    }));
    const capped = parseMemories(many);
    expect(capped).toHaveLength(MAX_MEMORIES);
    expect(capped[0].id).toBe("mem-error-x0");
    expect(capped[MAX_MEMORIES - 1].id).toBe(
      `mem-error-x${MAX_MEMORIES - 1}`,
    );
  });

  it("补 resolvedAt、夹紧 streak、忽略非法计数与多余字段", () => {
    const parsed = parseMemories([
      {
        ...VALID_CARD,
        id: "a",
        status: "resolved",
        resolvedAt: undefined,
        streak: 99,
      },
      {
        ...VALID_CARD,
        id: "b",
        status: "open",
        resolvedAt: NOW,
        streak: -3,
        reviewCount: "9",
        withKcId: "c99",
      },
      {
        ...VALID_CARD,
        id: "c",
        streak: 2.7,
        reviewCount: 3.9,
        unexpected: true,
      },
    ]);

    expect(parsed[0].resolvedAt).toBe(NOW);
    expect(parsed[0].streak).toBe(GRADUATION_STREAK);

    expect(parsed[1].resolvedAt).toBeUndefined();
    expect(parsed[1].streak).toBe(0);
    expect(parsed[1].reviewCount).toBe(0);
    expect(parsed[1].withKcId).toBeUndefined();

    expect(parsed[2].streak).toBe(2);
    expect(parsed[2].reviewCount).toBe(3);
    expect("unexpected" in parsed[2]).toBe(false);
  });

  it("合法的易混卡保留 withKcId，丢弃错题上的 withKcId", () => {
    const parsed = parseMemories([
      {
        ...VALID_CARD,
        id: "mem-conf-c01-c02",
        kind: "confusion",
        questionId: undefined,
        withKcId: "c02",
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].withKcId).toBe("c02");
    expect(parsed[0].questionId).toBeUndefined();
  });

  it("题干与解析按 200/600 码点截断", () => {
    const parsed = parseMemories([
      {
        ...VALID_CARD,
        prompt: "题".repeat(MAX_PROMPT_CHARS + 50),
        correction: "解".repeat(MAX_CORRECTION_CHARS + 50),
      },
    ]);
    expect(parsed[0].prompt).toHaveLength(MAX_PROMPT_CHARS);
    expect(parsed[0].correction).toHaveLength(MAX_CORRECTION_CHARS);
  });
});

describe("纯函数", () => {
  it("所有写操作都不修改入参数组与卡片", () => {
    const memories = addError([]);
    const snapshot = JSON.stringify(memories);

    upsertErrorMemory(
      memories,
      errorInput({ chosen: "A", now: plusDays(NOW, 1) }),
    );
    reviewMemory(memories, errorMemoryId("q1"), true, plusDays(NOW, 1));
    resolveMemory(memories, errorMemoryId("q1"), plusDays(NOW, 1));
    dueMemories(memories, plusDays(NOW, 1));
    memoryStats(memories, plusDays(NOW, 1));

    expect(JSON.stringify(memories)).toBe(snapshot);
  });
});
