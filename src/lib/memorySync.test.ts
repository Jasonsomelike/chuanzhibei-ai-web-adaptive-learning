import { describe, expect, it } from "vitest";

import { MAX_MEMORIES, type MemoryItem } from "@/lib/memory";
import {
  memoriesEqual,
  mergeMemories,
  stripMemories,
  withMemories,
} from "@/lib/memorySync";
import type { LearnerState, SubjectProgress } from "@/lib/learner";

const BASE = Date.parse("2026-05-01T00:00:00.000Z");

/** 第 n 分钟的时间戳；固定基准让「较新」可比较且不依赖系统时钟。 */
function at(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString();
}

function memory(id: string, overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    kind: "error",
    kcId: "c01",
    questionId: `q-${id}`,
    prompt: `题干 ${id}`,
    correction: `解析 ${id}`,
    createdAt: at(0),
    lastSeenAt: at(0),
    status: "open",
    streak: 0,
    reviewCount: 0,
    ...overrides,
  };
}

function progress(memories?: readonly MemoryItem[]): SubjectProgress {
  return {
    mastery: [],
    attempts: [],
    pathEdits: [],
    lastStepIndex: 0,
    ...(memories !== undefined ? { memories } : {}),
  };
}

function state(subjects: Record<string, SubjectProgress>): LearnerState {
  return { version: 2, learnerId: "local-learner", subjects };
}

describe("stripMemories", () => {
  it("摘掉每个学科的记忆卡，其余字段原样保留", () => {
    const before = state({
      "data-structures": progress([memory("mem-error-q1")]),
      "computer-networks": progress(),
    });

    const stripped = stripMemories(before);

    expect(stripped.version).toBe(2);
    expect(stripped.learnerId).toBe("local-learner");
    expect("memories" in stripped.subjects["data-structures"]).toBe(false);
    expect("memories" in stripped.subjects["computer-networks"]).toBe(false);
    expect(stripped.subjects["data-structures"].mastery).toEqual([]);
  });

  it("不修改输入状态", () => {
    const before = state({ s: progress([memory("a")]) });

    stripMemories(before);

    expect(before.subjects.s.memories).toHaveLength(1);
  });

  it("本来就没有记忆卡时原样返回同一个状态", () => {
    const clean = state({ s: progress() });

    expect(stripMemories(clean)).toBe(clean);
  });

  it("空数组 memories 也会被摘掉，而不是留一个空键", () => {
    const stripped = stripMemories(state({ s: progress([]) }));

    expect("memories" in stripped.subjects.s).toBe(false);
  });
});

describe("mergeMemories", () => {
  it("坏数据一律得到空数组", () => {
    expect(mergeMemories(null, null)).toEqual([]);
    expect(mergeMemories("坏", 42)).toEqual([]);
    expect(mergeMemories({}, [])).toEqual([]);
  });

  it("按 id 求并集，本机在前、远端新增在后", () => {
    const merged = mergeMemories(
      [memory("local-a")],
      [memory("remote-b", { lastSeenAt: at(5) })],
    );

    expect(merged.map((item) => item.id)).toEqual(["local-a", "remote-b"]);
  });

  it("同一 id 冲突时 lastSeenAt 较新者整张胜出", () => {
    const olderLocal = memory("same", { prompt: "本机旧卡", lastSeenAt: at(1) });
    const newerRemote = memory("same", { prompt: "远端新卡", lastSeenAt: at(9), streak: 2 });

    const newerRemoteWins = mergeMemories([olderLocal], [newerRemote]);
    expect(newerRemoteWins).toHaveLength(1);
    expect(newerRemoteWins[0].prompt).toBe("远端新卡");
    expect(newerRemoteWins[0].streak).toBe(2);

    const newerLocalWins = mergeMemories([newerRemote], [olderLocal]);
    expect(newerLocalWins[0].prompt).toBe("远端新卡");
  });

  it("时间戳相同时保留本机（local 参数在前）", () => {
    const merged = mergeMemories(
      [memory("same", { prompt: "本机", lastSeenAt: at(3) })],
      [memory("same", { prompt: "远端", lastSeenAt: at(3) })],
    );

    expect(merged[0].prompt).toBe("本机");
  });

  it("清洗远端坏记录：坏 kind、缺 questionId、坏时间戳都丢弃", () => {
    const merged = mergeMemories(
      [],
      [
        { id: "bad-kind", kind: "other", kcId: "c01", prompt: "", correction: "", createdAt: at(0), lastSeenAt: at(0), status: "open" },
        { id: "no-question", kind: "error", kcId: "c01", prompt: "", correction: "", createdAt: at(0), lastSeenAt: at(0), status: "open" },
        { ...memory("bad-time"), lastSeenAt: "不是时间" },
        memory("ok"),
      ],
    );

    expect(merged.map((item) => item.id)).toEqual(["ok"]);
  });

  it(`并集超过 ${MAX_MEMORIES} 张时保留 lastSeenAt 较新的`, () => {
    const locals = Array.from({ length: 150 }, (_, i) =>
      memory(`local-${i}`, { lastSeenAt: at(i) }),
    );
    const remotes = Array.from({ length: 150 }, (_, i) =>
      memory(`remote-${i}`, { lastSeenAt: at(1_000 + i) }),
    );

    const merged = mergeMemories(locals, remotes);

    expect(merged).toHaveLength(MAX_MEMORIES);
    // 远端 150 张都比本机新，再保留本机最新的 50 张；最旧的 100 张本机卡被挤掉
    expect(merged.some((item) => item.id === "local-0")).toBe(false);
    expect(merged.some((item) => item.id === "local-99")).toBe(false);
    expect(merged.some((item) => item.id === "local-100")).toBe(true);
    expect(merged.some((item) => item.id === "local-149")).toBe(true);
    expect(merged.some((item) => item.id === "remote-149")).toBe(true);
  });

  it("结果保留本机原有顺序", () => {
    const merged = mergeMemories(
      [memory("b", { lastSeenAt: at(1) }), memory("a", { lastSeenAt: at(2) }), memory("c", { lastSeenAt: at(3) })],
      [],
    );

    expect(merged.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});

describe("memoriesEqual", () => {
  it("同一引用或内容相同（顺序不同）都算相等", () => {
    const left = [memory("a"), memory("b")];
    const right = [memory("b"), memory("a")];

    expect(memoriesEqual(left, left)).toBe(true);
    expect(memoriesEqual(left, right)).toBe(true);
    expect(memoriesEqual([], [])).toBe(true);
  });

  it("任一字段变化都算不等", () => {
    const base = memory("a");

    expect(memoriesEqual([base], [memory("a", { lastSeenAt: at(1) })])).toBe(false);
    expect(memoriesEqual([base], [memory("a", { status: "resolved", resolvedAt: at(2) })])).toBe(false);
    expect(memoriesEqual([base], [memory("a", { streak: 1 })])).toBe(false);
    expect(memoriesEqual([base], [memory("a", { prompt: "换了题干" })])).toBe(false);
    expect(memoriesEqual([base], [{ ...base, note: "新备注" }])).toBe(false);
  });

  it("条数不同直接不等", () => {
    expect(memoriesEqual([memory("a")], [])).toBe(false);
    expect(memoriesEqual([], [memory("a")])).toBe(false);
  });

  it("值为 undefined 的可选字段与缺省字段等价", () => {
    const withUndefined = { ...memory("a"), note: undefined };

    expect(memoriesEqual([memory("a")], [withUndefined])).toBe(true);
  });
});

describe("withMemories", () => {
  it("替换指定学科的记忆卡，其它字段与学科不动", () => {
    const before = state({
      s: progress([memory("old")]),
      other: progress([memory("keep")]),
    });

    const next = withMemories(before, "s", [memory("new", { lastSeenAt: at(4) })]);

    expect(next.subjects.s.memories?.map((item) => item.id)).toEqual(["new"]);
    expect(next.subjects.other.memories?.map((item) => item.id)).toEqual(["keep"]);
    expect(before.subjects.s.memories?.map((item) => item.id)).toEqual(["old"]);
  });

  it("写入前清洗坏记录并限容", () => {
    const tooMany = Array.from({ length: MAX_MEMORIES + 5 }, (_, i) =>
      memory(`m-${i}`, { lastSeenAt: at(i) }),
    );
    const dirty: unknown = [
      { id: "missing-fields" },
      memory("good"),
      ...tooMany,
    ];

    const next = withMemories(state({ s: progress() }), "s", dirty);
    const memories = next.subjects.s.memories ?? [];

    expect(memories).toHaveLength(MAX_MEMORIES);
    expect(memories.some((item) => item.id === "missing-fields")).toBe(false);
    expect(memories.some((item) => item.id === "good")).toBe(true);
  });

  it("学科不存在时补一份只有记忆卡的空进度", () => {
    const next = withMemories(state({}), "brand-new", [memory("only")]);

    expect(next.subjects["brand-new"]).toMatchObject({
      mastery: [],
      attempts: [],
      pathEdits: [],
      lastStepIndex: 0,
    });
    expect(next.subjects["brand-new"].memories?.map((item) => item.id)).toEqual(["only"]);
  });

  it("空数组写成 memories: []，空学科 id 原样返回", () => {
    const before = state({ s: progress([memory("old")]) });

    expect(withMemories(before, "s", []).subjects.s.memories).toEqual([]);
    expect(withMemories(before, "   ", [memory("x")])).toBe(before);
  });
});
