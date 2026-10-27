import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 方向题目接口的写入语义。
 *
 * 重点回归：Postgres 驱动的 INSERT 无 RETURNING 时默认只返回空行数组，
 * 若调用方用 rows.length 判断成功，会「写进去了却报 0 条」。
 * 这里注入一个「run 恒返回 0」的 Db，断言接口不会把题算成已插入。
 */

const fakeDb = {
  run: vi.fn(async () => 0),
  all: vi.fn(async () => []),
  one: vi.fn(async () => ({
    id: "d1",
    user_id: "u1",
    is_public: false,
  })),
};

vi.mock("@/lib/db", () => ({
  getDb: async () => fakeDb,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => ({ id: "u1", email: "u@test.local", displayName: "U" }),
}));

const { POST } = await import("../../app/api/directions/items/route");

function req(body: unknown): Request {
  return new Request("http://localhost/api/directions/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const goodItem = {
  difficulty: "advanced",
  difficultyReason: "需要理解并应用栈的后进先出性质",
  stem: "设栈的入栈序列为 1,2,3，则下列哪个不可能是出栈序列？",
  options: ["3,2,1", "1,2,3", "2,1,3", "3,1,2"],
  answerText: "3,1,2",
  explanation:
    "若 3 先出栈，说明 1、2 都已入栈，栈内自底向上为 1,2，栈顶是 2，因此下一个只能出 2 而不能出 1。",
  source: "generated",
  status: "accepted",
};

beforeEach(() => {
  fakeDb.run.mockClear();
  fakeDb.all.mockClear();
  fakeDb.one.mockClear();
});

describe("POST /api/directions/items 写入语义", () => {
  it("run 返回 0 时不把题算成已插入（Postgres 无 RETURNING 的回归）", async () => {
    const res = await POST(
      req({ directionId: "d1", kcId: "k1", items: [goodItem] }) as never,
    );
    const data = (await res.json()) as { inserted: number; skipped: number; items: unknown[] };

    expect(data.inserted).toBe(0);
    expect(data.skipped).toBe(1);
    expect(data.items).toEqual([]);
  });

  it("run 返回 1 时算作已插入", async () => {
    fakeDb.run.mockResolvedValueOnce(1);
    const res = await POST(
      req({ directionId: "d1", kcId: "k1", items: [goodItem] }) as never,
    );
    const data = (await res.json()) as { inserted: number; skipped: number };

    expect(data.inserted).toBe(1);
    expect(data.skipped).toBe(0);
  });

  it("结构不合格的题既不落库也不进 inserted", async () => {
    const res = await POST(
      req({
        directionId: "d1",
        kcId: "k1",
        items: [{ ...goodItem, options: ["只有", "两个"] }],
      }) as never,
    );
    const data = (await res.json()) as {
      inserted: number;
      rejected: { issues: string[] }[];
    };

    expect(data.inserted).toBe(0);
    expect(data.rejected).toHaveLength(1);
    expect(fakeDb.run).not.toHaveBeenCalled();
  });

  it("answerText 对不上任何选项的题被拒，不落库（否则会按选项 A 判分）", async () => {
    const res = await POST(
      req({
        directionId: "d1",
        kcId: "k1",
        items: [{ ...goodItem, answerText: "这个选项根本不存在" }],
      }) as never,
    );
    const data = (await res.json()) as { inserted: number; rejected: unknown[] };

    expect(data.inserted).toBe(0);
    expect(data.rejected).toHaveLength(1);
    expect(fakeDb.run).not.toHaveBeenCalled();
  });

  it("手动题的 status=accepted 被保留，且 source 记为 manual", async () => {
    fakeDb.run.mockResolvedValueOnce(1);
    // 手动录题表单不产生 difficultyReason（那是生成流程的字段）
    const { difficultyReason: _omit, ...manualItem } = goodItem;
    void _omit;
    const res = await POST(
      req({
        directionId: "d1",
        kcId: "k1",
        items: [{ ...manualItem, source: "manual", status: "accepted" }],
      }) as never,
    );
    const data = (await res.json()) as {
      inserted: number;
      items: { source: string; status: string }[];
    };

    expect(data.inserted).toBe(1);
    expect(data.items[0].source).toBe("manual");
    expect(data.items[0].status).toBe("accepted");
  });

  it("声称 manual 但带着 difficultyReason 时按 generated 处理（不能洗掉折扣）", async () => {
    /*
     * source 决定诊断页的折扣：generated 打 0.8 折，manual 不打折。
     * difficultyReason 是生成流程才产出的字段，带着它却声称 manual，
     * 就是在试图绕过折扣。
     */
    fakeDb.run.mockResolvedValueOnce(1);
    const res = await POST(
      req({
        directionId: "d1",
        kcId: "k1",
        items: [
          { ...goodItem, source: "manual", status: "accepted", difficultyReason: "模型给的理由" },
        ],
      }) as never,
    );
    const data = (await res.json()) as { items: { source: string }[] };
    expect(data.items[0].source).toBe("generated");
  });

  it("声称 borrowed 但内置题库里没有这道题时被拒", async () => {
    const res = await POST(
      req({
        directionId: "d1",
        kcId: "k1",
        items: [{ ...goodItem, source: "borrowed", status: "accepted" }],
      }) as never,
    );
    const data = (await res.json()) as { inserted: number; rejected: unknown[] };
    expect(data.inserted).toBe(0);
    expect(data.rejected).toHaveLength(1);
    expect(fakeDb.run).not.toHaveBeenCalled();
  });
});
