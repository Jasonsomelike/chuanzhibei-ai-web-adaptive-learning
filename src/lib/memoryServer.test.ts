import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { __resetMemoryDbForTests, getDb, type Db } from "@/lib/db";
import type { MemoryItem } from "@/lib/memory";
import {
  deleteMemory,
  deleteSubjectMemories,
  listMemories,
  memoryUpdatedAt,
  putMemories,
  validateMemoriesPayload,
} from "@/lib/memoryServer";

const CREATED = "2026-10-20T00:00:00.000Z";
const SEEN = "2026-10-29T00:00:00.000Z";

function card(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: "mem-error-q1",
    kind: "error",
    kcId: "k1",
    questionId: "q1",
    prompt: "栈的出栈顺序",
    correction: "后进先出",
    createdAt: CREATED,
    lastSeenAt: SEEN,
    status: "open",
    streak: 0,
    reviewCount: 1,
    ...overrides,
  };
}

let db: Db;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  __resetMemoryDbForTests();
  db = await getDb();
});

afterAll(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("validateMemoriesPayload", () => {
  it("合法快照清洗后返回", () => {
    const result = validateMemoriesPayload({ subjectId: "data-structure", memories: [card()] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subjectId).toBe("data-structure");
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].id).toBe("mem-error-q1");
  });

  it("请求体、subjectId、memories 形状逐条拦截", () => {
    expect(validateMemoriesPayload(null).ok).toBe(false);
    expect(validateMemoriesPayload([]).ok).toBe(false);
    expect(validateMemoriesPayload({ memories: [] }).ok).toBe(false);
    expect(validateMemoriesPayload({ subjectId: "Bad Subject", memories: [] }).ok).toBe(false);
    expect(validateMemoriesPayload({ subjectId: "-bad", memories: [] }).ok).toBe(false);
    expect(validateMemoriesPayload({ subjectId: "ds", memories: {} }).ok).toBe(false);
  });

  it("坏卡被丢弃，好卡保留；同 id 只留第一条", () => {
    const result = validateMemoriesPayload({
      subjectId: "ds",
      memories: [
        card(),
        { id: "" },
        { ...card({ id: "mem-error-q2" }), kind: "unknown" },
        card({ prompt: "第二条同 id" }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].prompt).toBe("栈的出栈顺序");
  });

  it("易混卡缺 withKcId、错题卡缺 questionId 都按坏记录丢弃", () => {
    const result = validateMemoriesPayload({
      subjectId: "ds",
      memories: [
        {
          ...card({ id: "mem-conf-k1-k2", kind: "confusion" }),
          questionId: undefined,
          withKcId: undefined,
        },
        { ...card({ id: "mem-error-q0" }), questionId: undefined },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.memories).toEqual([]);
  });
});

describe("memoryUpdatedAt", () => {
  it("取 lastSeenAt 与 createdAt 的较大者", () => {
    expect(memoryUpdatedAt({ createdAt: CREATED, lastSeenAt: SEEN })).toBe(Date.parse(SEEN));
    expect(memoryUpdatedAt({ createdAt: SEEN, lastSeenAt: CREATED })).toBe(Date.parse(SEEN));
  });

  it("损坏时间不产生 NaN，退化为 0", () => {
    expect(memoryUpdatedAt({ createdAt: "bad", lastSeenAt: "also-bad" })).toBe(0);
  });
});

describe("putMemories（内存 DB）", () => {
  it("首次写入后按学科读回", async () => {
    const result = await putMemories(db, "u1", "ds", [card()]);
    expect(result).toEqual({ stored: 1, skippedStale: 0 });

    const memories = await listMemories(db, "u1", "ds");
    expect(memories).toHaveLength(1);
    expect(memories[0].prompt).toBe("栈的出栈顺序");
  });

  it("existing.updated_at 更大时跳过该卡，且不覆盖内容", async () => {
    await putMemories(db, "u1", "ds", [card()]);

    const stale = await putMemories(db, "u1", "ds", [
      card({ prompt: "旧设备上的旧正文", lastSeenAt: "2026-10-25T00:00:00.000Z" }),
    ]);
    expect(stale).toEqual({ stored: 0, skippedStale: 1 });

    const memories = await listMemories(db, "u1", "ds");
    expect(memories[0].prompt).toBe("栈的出栈顺序");
  });

  it("时间相等视为同一份提交，允许覆盖", async () => {
    await putMemories(db, "u1", "ds", [card()]);
    const same = await putMemories(db, "u1", "ds", [card({ prompt: "同一毫秒的新正文" })]);
    expect(same).toEqual({ stored: 1, skippedStale: 0 });
    expect((await listMemories(db, "u1", "ds"))[0].prompt).toBe("同一毫秒的新正文");
  });

  it("PUT 只 upsert，绝不删除不在列表里的 mem_id", async () => {
    await putMemories(db, "u1", "ds", [
      card(),
      card({ id: "mem-error-q2", questionId: "q2", prompt: "队列题" }),
    ]);

    const partial = await putMemories(db, "u1", "ds", [card({ prompt: "只提交第一张" })]);
    expect(partial.stored).toBe(1);

    const memories = await listMemories(db, "u1", "ds");
    expect(memories.map((item) => item.id).sort()).toEqual(["mem-error-q1", "mem-error-q2"]);
  });

  it("不同学科与不同用户互不干扰", async () => {
    await putMemories(db, "u1", "ds", [card()]);
    await putMemories(db, "u1", "os", [card({ id: "mem-error-q9", questionId: "q9" })]);
    await putMemories(db, "u2", "ds", [card({ prompt: "另一个用户的卡" })]);

    expect(await listMemories(db, "u1", "ds")).toHaveLength(1);
    expect(await listMemories(db, "u1", "os")).toHaveLength(1);
    const other = await listMemories(db, "u2", "ds");
    expect(other[0].prompt).toBe("另一个用户的卡");
  });

  it("resolve 后再写入旧时间戳不会把已解决的卡改回 open", async () => {
    const resolved = card({
      status: "resolved",
      resolvedAt: SEEN,
      lastSeenAt: SEEN,
      streak: 4,
    });
    await putMemories(db, "u1", "ds", [resolved]);

    const stale = await putMemories(db, "u1", "ds", [
      card({ status: "open", lastSeenAt: "2026-10-21T00:00:00.000Z" }),
    ]);
    expect(stale.skippedStale).toBe(1);
    expect((await listMemories(db, "u1", "ds"))[0].status).toBe("resolved");
  });
});

describe("显式删除", () => {
  it("deleteMemory 返回真实删除数", async () => {
    await putMemories(db, "u1", "ds", [card(), card({ id: "mem-error-q2", questionId: "q2" })]);
    expect(await deleteMemory(db, "u1", "mem-error-q1")).toBe(1);
    expect(await deleteMemory(db, "u1", "mem-error-q1")).toBe(0);
    expect((await listMemories(db, "u1", "ds")).map((item) => item.id)).toEqual([
      "mem-error-q2",
    ]);
  });

  it("deleteSubjectMemories 只清空该学科", async () => {
    await putMemories(db, "u1", "ds", [card()]);
    await putMemories(db, "u1", "os", [card({ id: "mem-error-q9", questionId: "q9" })]);

    expect(await deleteSubjectMemories(db, "u1", "ds")).toBe(1);
    expect(await listMemories(db, "u1", "ds")).toEqual([]);
    expect(await listMemories(db, "u1", "os")).toHaveLength(1);
  });

  it("删除只影响当前用户", async () => {
    await putMemories(db, "u1", "ds", [card()]);
    await putMemories(db, "u2", "ds", [card()]);
    expect(await deleteMemory(db, "u2", "mem-error-q1")).toBe(1);
    expect(await listMemories(db, "u1", "ds")).toHaveLength(1);
    expect(await listMemories(db, "u2", "ds")).toEqual([]);
  });
});

describe("listMemories 的容错", () => {
  it("payload 损坏只丢这一张卡", async () => {
    await putMemories(db, "u1", "ds", [
      card(),
      card({ id: "mem-error-q2", questionId: "q2" }),
    ]);
    await db.run(
      `INSERT INTO memories
         (user_id, mem_id, subject_id, kind, kc_id, with_kc_id, question_id, status, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id, mem_id) DO UPDATE SET payload = EXCLUDED.payload`,
      ["u1", "mem-error-q3", "ds", "error", "k1", null, "q3", "open", "{bad json", CREATED, SEEN],
    );

    const memories = await listMemories(db, "u1", "ds");
    expect(memories.map((item) => item.id)).toEqual(["mem-error-q1", "mem-error-q2"]);
  });
});
