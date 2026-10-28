import { describe, it, expect, beforeEach } from "vitest";
import { getDb, __resetMemoryDbForTests } from "@/lib/db";

/**
 * 内存实现的查询分支测试。
 *
 * 这些用例存在的理由：内存实现是「按 SQL 文本匹配」的，新增一条查询
 * 很容易只在 Postgres 侧写对，本地开发与测试却静默返回空。
 * 上一版就漏了 `from progress` 的全量读取，表现为「写入 200、读回为空」。
 */

beforeEach(() => {
  __resetMemoryDbForTests();
});

async function seedUser(id = "u1") {
  const db = await getDb();
  await db.run(
    "INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ($1, $2, $3, $4, $5)",
    [id, `${id}@test.local`, "hash", "用户", "2026-10-26T00:00:00.000Z"],
  );
  return db;
}

async function seedDirection(db: Awaited<ReturnType<typeof getDb>>, id = "d1", userId = "u1") {
  await db.run(
    `INSERT INTO directions (id, user_id, title, subject_id, description, graph_json, is_public, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, userId, "方向", "custom", "描述", "{}", false, "2026-10-26T00:00:00.000Z", "2026-10-26T00:00:00.000Z"],
  );
}

function itemParams(over: Partial<Record<string, string | number>> = {}) {
  return [
    over.id ?? "i1",
    over.direction_id ?? "d1",
    over.kc_id ?? "k1",
    3,
    over.stem ?? "题干",
    JSON.stringify(["A", "B", "C", "D"]),
    0,
    "解析",
    over.content_hash ?? "h1",
    "generated",
    over.status ?? "accepted",
    JSON.stringify(["题干长度"]),
    over.created_at ?? "2026-10-26T00:00:00.000Z",
  ];
}

describe("direction_items 内存实现", () => {
  it("按 direction_id 与 kc_id 查询", async () => {
    const db = await seedUser();
    await seedDirection(db);
    await db.run(
      `INSERT INTO direction_items (id, direction_id, kc_id, difficulty, stem, options_json, answer_index,
        explanation, content_hash, source, status, checks_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      itemParams(),
    );
    await db.run(
      `INSERT INTO direction_items (id, direction_id, kc_id, difficulty, stem, options_json, answer_index,
        explanation, content_hash, source, status, checks_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      itemParams({ id: "i2", kc_id: "k2", content_hash: "h2" }),
    );

    const all = await db.all("SELECT * FROM direction_items WHERE direction_id = $1", ["d1"]);
    expect(all).toHaveLength(2);

    const one = await db.all(
      "SELECT * FROM direction_items WHERE direction_id = $1 AND kc_id = $2",
      ["d1", "k2"],
    );
    expect(one).toHaveLength(1);
    expect((one[0] as { id: string }).id).toBe("i2");
  });

  it("同一 (direction_id, content_hash) 重复插入被跳过", async () => {
    const db = await seedUser();
    await seedDirection(db);
    const sql = `INSERT INTO direction_items (id, direction_id, kc_id, difficulty, stem, options_json, answer_index,
      explanation, content_hash, source, status, checks_json, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;

    const first = await db.run(sql, itemParams());
    const second = await db.run(sql, itemParams({ id: "i-other" }));

    expect(first).toBe(1);
    expect(second).toBe(0);
    const rows = await db.all("SELECT * FROM direction_items WHERE direction_id = $1", ["d1"]);
    expect(rows).toHaveLength(1);
  });

  it("不同方向的同 content_hash 互不影响", async () => {
    const db = await seedUser();
    await seedDirection(db, "d1");
    await seedDirection(db, "d2");
    const sql = `INSERT INTO direction_items (id, direction_id, kc_id, difficulty, stem, options_json, answer_index,
      explanation, content_hash, source, status, checks_json, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;

    expect(await db.run(sql, itemParams())).toBe(1);
    expect(await db.run(sql, itemParams({ direction_id: "d2", id: "i2" }))).toBe(1);
  });

  it("删除方向时级联删除它的题目", async () => {
    const db = await seedUser();
    await seedDirection(db);
    await db.run(
      `INSERT INTO direction_items (id, direction_id, kc_id, difficulty, stem, options_json, answer_index,
        explanation, content_hash, source, status, checks_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      itemParams(),
    );

    const affected = await db.run("DELETE FROM directions WHERE id = $1 AND user_id = $2", ["d1", "u1"]);
    expect(affected).toBe(1);

    const rows = await db.all("SELECT * FROM direction_items WHERE direction_id = $1", ["d1"]);
    expect(rows).toEqual([]);
  });

  it("单条查询返回 null 而不是抛错", async () => {
    const db = await getDb();
    const row = await db.one("SELECT * FROM directions WHERE id = $1", ["nope"]);
    expect(row).toBeNull();
  });
});

describe("progress 内存实现", () => {
  it("写入后能整表读回（回归：曾经只写不读）", async () => {
    const db = await seedUser();
    await db.run(
      `INSERT INTO progress (user_id, subject_id, data, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, subject_id) DO UPDATE SET data = $3, updated_at = $4`,
      ["u1", "data-structures", JSON.stringify({ mastery: [{ kcId: "c01" }] }), "2026-10-26T00:00:00.000Z"],
    );

    const rows = await db.all<{ subject_id: string; data: string }>(
      "SELECT * FROM progress WHERE user_id = $1",
      ["u1"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].subject_id).toBe("data-structures");
    expect(JSON.parse(rows[0].data).mastery[0].kcId).toBe("c01");
  });

  it("按 user_id 隔离", async () => {
    const db = await seedUser("u1");
    await seedUser("u2");
    const sql = `INSERT INTO progress (user_id, subject_id, data, updated_at) VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, subject_id) DO UPDATE SET data = $3, updated_at = $4`;
    await db.run(sql, ["u1", "s", "{}", "t"]);
    await db.run(sql, ["u2", "s", "{}", "t"]);

    const rows = await db.all<{ user_id: string }>("SELECT * FROM progress WHERE user_id = $1", ["u1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe("u1");
  });

  /*
   * 以下三条对应「清空进度」与「按目标重置」两种删除形状。
   * 旧实现不看 WHERE 条件，一律按 (params[0], params[1]) 删一格并返回 1，
   * 于是按 user_id 清空时行还在、返回值却是 1——线上表现为「点了清空，刷新又回来」。
   */
  it("按 user_id 删除返回真实行数且读回为空", async () => {
    const db = await seedUser();
    const sql = `INSERT INTO progress (user_id, subject_id, data, updated_at) VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, subject_id) DO UPDATE SET data = $3, updated_at = $4`;
    await db.run(sql, ["u1", "data-structures", "{}", "t"]);
    await db.run(sql, ["u1", "algorithms", "{}", "t"]);

    const affected = await db.run("DELETE FROM progress WHERE user_id = $1", ["u1"]);
    expect(affected).toBe(2);

    const rows = await db.all("SELECT * FROM progress WHERE user_id = $1", ["u1"]);
    expect(rows).toEqual([]);
  });

  it("按 user_id + subject_id 只删一行", async () => {
    const db = await seedUser();
    const sql = `INSERT INTO progress (user_id, subject_id, data, updated_at) VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, subject_id) DO UPDATE SET data = $3, updated_at = $4`;
    await db.run(sql, ["u1", "data-structures", "{}", "t"]);
    await db.run(sql, ["u1", "algorithms", "{}", "t"]);

    const affected = await db.run("DELETE FROM progress WHERE user_id = $1 AND subject_id = $2", [
      "u1",
      "data-structures",
    ]);
    expect(affected).toBe(1);

    const rows = await db.all<{ subject_id: string }>("SELECT * FROM progress WHERE user_id = $1", ["u1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].subject_id).toBe("algorithms");
  });

  it("删除不存在的键返回 0", async () => {
    const db = await seedUser();

    expect(
      await db.run("DELETE FROM progress WHERE user_id = $1 AND subject_id = $2", ["u1", "nope"]),
    ).toBe(0);
    expect(await db.run("DELETE FROM progress WHERE user_id = $1", ["u1"])).toBe(0);
  });
});
