import { readFileSync } from "node:fs";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  getDb,
  __resetMemoryDbForTests,
  dbBackend,
  __setDbBackendForTests,
  __ensureSchemaForTests,
  KB_VECTOR_SQL,
  MCP_SERVER_SQL,
  PGVECTOR_EXTENSION,
  SCHEMA,
  listKbChunkVectorsByDirection,
  type Db,
} from "@/lib/db";
import {
  MIGRATIONS_DIR,
  assertNoConcurrently,
  loadPendingMigrations,
  pendingMigrations,
  splitSqlStatements,
} from "../../scripts/db-migrate";

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

afterEach(() => {
  __setDbBackendForTests(null);
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

// ── 四张新表 ─────────────────────────────────────────────────────

type TestDb = Awaited<ReturnType<typeof getDb>>;

/*
 * 下面四条 SQL 是生产代码实际使用的 canonical 形状。
 * 内存实现按列名解析 ON CONFLICT，因此这里的列顺序必须与调用方一致；
 * 一旦两处分叉，upsert 会抛错而不是静默写错字段。
 */
const UPSERT_SECRET_SQL = `INSERT INTO user_secrets (
  user_id, kind, label, api, base_url, model, options_json,
  secret_ct, secret_iv, secret_tag, secret_kid, secret_hint, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
ON CONFLICT (user_id, kind) DO UPDATE SET
  label = EXCLUDED.label,
  api = EXCLUDED.api,
  base_url = EXCLUDED.base_url,
  model = EXCLUDED.model,
  options_json = EXCLUDED.options_json,
  secret_ct = EXCLUDED.secret_ct,
  secret_iv = EXCLUDED.secret_iv,
  secret_tag = EXCLUDED.secret_tag,
  secret_kid = EXCLUDED.secret_kid,
  secret_hint = EXCLUDED.secret_hint,
  updated_at = EXCLUDED.updated_at`;

function secretParams(over: Partial<Record<string, string>> = {}): string[] {
  return [
    over.user_id ?? "u1",
    over.kind ?? "llm",
    over.label ?? "文本模型",
    over.api ?? "openai-compatible",
    over.base_url ?? "https://api.deepseek.com/v1",
    over.model ?? "deepseek-chat",
    over.options_json ?? "{}",
    over.secret_ct ?? "ct",
    over.secret_iv ?? "iv",
    over.secret_tag ?? "tag",
    over.secret_kid ?? "v1",
    over.secret_hint ?? "••••1234",
    over.created_at ?? "2026-10-29T00:00:00.000Z",
    over.updated_at ?? "2026-10-29T00:00:00.000Z",
  ];
}

const UPSERT_DOC_SQL = `INSERT INTO kb_docs (
  user_id, doc_id, direction_id, title, file_name, kind, size,
  page_count, char_count, chunk_count, kc_ids_json, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (user_id, doc_id) DO UPDATE SET
  direction_id = EXCLUDED.direction_id,
  title = EXCLUDED.title,
  file_name = EXCLUDED.file_name,
  kind = EXCLUDED.kind,
  size = EXCLUDED.size,
  page_count = EXCLUDED.page_count,
  char_count = EXCLUDED.char_count,
  chunk_count = EXCLUDED.chunk_count,
  kc_ids_json = EXCLUDED.kc_ids_json,
  updated_at = EXCLUDED.updated_at`;

async function seedDoc(
  db: TestDb,
  over: Partial<Record<string, string | number>> = {},
): Promise<void> {
  await db.run(UPSERT_DOC_SQL, [
    over.user_id ?? "u1",
    over.doc_id ?? "doc1",
    over.direction_id ?? "d1",
    over.title ?? "文档",
    over.file_name ?? "doc.pdf",
    over.kind ?? "pdf",
    over.size ?? 1024,
    1,
    over.char_count ?? 100,
    over.chunk_count ?? 1,
    over.kc_ids_json ?? "[]",
    over.created_at ?? "2026-10-29T00:00:00.000Z",
    over.updated_at ?? "2026-10-29T00:00:00.000Z",
  ]);
}

const UPSERT_CHUNK_SQL = `INSERT INTO kb_chunks (
  user_id, chunk_id, doc_id, direction_id, idx, title, section,
  page_from, page_to, text, embedding, embedding_model, embedding_dim, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
ON CONFLICT (user_id, chunk_id) DO UPDATE SET
  doc_id = EXCLUDED.doc_id,
  direction_id = EXCLUDED.direction_id,
  idx = EXCLUDED.idx,
  title = EXCLUDED.title,
  section = EXCLUDED.section,
  page_from = EXCLUDED.page_from,
  page_to = EXCLUDED.page_to,
  text = EXCLUDED.text,
  embedding = EXCLUDED.embedding,
  embedding_model = EXCLUDED.embedding_model,
  embedding_dim = EXCLUDED.embedding_dim,
  updated_at = EXCLUDED.updated_at`;

async function seedChunk(
  db: TestDb,
  over: Partial<Record<string, string | number | null>> = {},
): Promise<void> {
  await db.run(UPSERT_CHUNK_SQL, [
    over.user_id ?? "u1",
    over.chunk_id ?? "c1",
    over.doc_id ?? "doc1",
    over.direction_id ?? "d1",
    over.idx ?? 0,
    over.title ?? "标题",
    over.section ?? "小节",
    1,
    1,
    over.text ?? "正文",
    over.embedding ?? null,
    over.embedding_model ?? null,
    over.embedding_dim ?? null,
    over.updated_at ?? "2026-10-29T00:00:00.000Z",
  ]);
}

const UPSERT_MEMORY_SQL = `INSERT INTO memories (
  user_id, mem_id, subject_id, kind, kc_id, with_kc_id, question_id, status, payload, created_at, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (user_id, mem_id) DO UPDATE SET
  subject_id = EXCLUDED.subject_id,
  kind = EXCLUDED.kind,
  kc_id = EXCLUDED.kc_id,
  with_kc_id = EXCLUDED.with_kc_id,
  question_id = EXCLUDED.question_id,
  status = EXCLUDED.status,
  payload = EXCLUDED.payload,
  updated_at = EXCLUDED.updated_at`;

async function seedMemory(
  db: TestDb,
  over: Partial<Record<string, string | null>> = {},
): Promise<void> {
  await db.run(UPSERT_MEMORY_SQL, [
    over.user_id ?? "u1",
    over.mem_id ?? "m1",
    over.subject_id ?? "data-structures",
    over.kind ?? "error",
    over.kc_id ?? "c01",
    over.with_kc_id ?? null,
    over.question_id ?? "q1",
    over.status ?? "open",
    over.payload ?? "{}",
    over.created_at ?? "2026-10-29T00:00:00.000Z",
    over.updated_at ?? "2026-10-29T00:00:00.000Z",
  ]);
}

describe("user_secrets 内存实现", () => {
  it("同一 (user_id, kind) 重复写入是更新：行数不变、created_at 保留", async () => {
    const db = await seedUser();

    expect(await db.run(UPSERT_SECRET_SQL, secretParams())).toBe(1);
    expect(
      await db.run(
        UPSERT_SECRET_SQL,
        secretParams({
          label: "新标签",
          secret_ct: "ct2",
          updated_at: "2026-10-29T01:00:00.000Z",
        }),
      ),
    ).toBe(1);

    const rows = await db.all<{
      label: string;
      secret_ct: string;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM user_secrets WHERE user_id = $1", ["u1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("新标签");
    expect(rows[0].secret_ct).toBe("ct2");
    expect(rows[0].created_at).toBe("2026-10-29T00:00:00.000Z");
    expect(rows[0].updated_at).toBe("2026-10-29T01:00:00.000Z");
  });

  it("按 user_id 与 kind 隔离", async () => {
    const db = await seedUser("u1");
    await seedUser("u2");
    await db.run(UPSERT_SECRET_SQL, secretParams({ kind: "llm" }));
    await db.run(UPSERT_SECRET_SQL, secretParams({ kind: "tts", api: "browser" }));
    await db.run(UPSERT_SECRET_SQL, secretParams({ user_id: "u2", label: "别人的" }));

    const mine = await db.all<{ kind: string }>(
      "SELECT * FROM user_secrets WHERE user_id = $1",
      ["u1"],
    );
    expect(mine.map((r) => r.kind)).toEqual(["llm", "tts"]);

    const other = await db.one<{ label: string }>(
      "SELECT * FROM user_secrets WHERE user_id = $1 AND kind = $2",
      ["u2", "llm"],
    );
    expect(other?.label).toBe("别人的");

    const missing = await db.one("SELECT * FROM user_secrets WHERE user_id = $1 AND kind = $2", [
      "u1",
      "search-tavily",
    ]);
    expect(missing).toBeNull();
  });

  it("删除形状 user_secrets(user_id,kind)：只删该行并返回真实数量", async () => {
    const db = await seedUser();
    await db.run(UPSERT_SECRET_SQL, secretParams({ kind: "llm" }));
    await db.run(UPSERT_SECRET_SQL, secretParams({ kind: "tts", api: "browser" }));

    expect(
      await db.run("DELETE FROM user_secrets WHERE user_id = $1 AND kind = $2", ["u1", "llm"]),
    ).toBe(1);
    expect(
      await db.run("DELETE FROM user_secrets WHERE user_id = $1 AND kind = $2", ["u1", "llm"]),
    ).toBe(0);

    const rows = await db.all<{ kind: string }>(
      "SELECT * FROM user_secrets WHERE user_id = $1",
      ["u1"],
    );
    expect(rows.map((r) => r.kind)).toEqual(["tts"]);
  });
});

describe("kb_docs / kb_chunks 内存实现", () => {
  it("文档 upsert 更新同键不新增行，单条查询按 (user_id, doc_id)", async () => {
    const db = await seedUser();
    await seedDoc(db, { doc_id: "doc1", title: "旧标题", chunk_count: 1 });
    await seedDoc(db, { doc_id: "doc1", title: "新标题", chunk_count: 3 });

    const rows = await db.all("SELECT * FROM kb_docs WHERE user_id = $1", ["u1"]);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { title: string }).title).toBe("新标题");
    expect((rows[0] as { chunk_count: number }).chunk_count).toBe(3);

    const byDoc = await db.all("SELECT * FROM kb_docs WHERE user_id = $1 AND doc_id = $2", [
      "u1",
      "doc1",
    ]);
    expect(byDoc).toHaveLength(1);

    const one = await db.one<{ title: string }>(
      "SELECT * FROM kb_docs WHERE user_id = $1 AND doc_id = $2",
      ["u1", "doc1"],
    );
    expect(one?.title).toBe("新标题");
  });

  it("片段 upsert 后按方向读取并按 doc_id、idx 排序", async () => {
    const db = await seedUser();
    await seedDoc(db, { doc_id: "doc1" });
    await seedDoc(db, { doc_id: "doc2" });
    await seedChunk(db, { chunk_id: "c2", doc_id: "doc1", idx: 1, text: "第二段" });
    await seedChunk(db, { chunk_id: "c1", doc_id: "doc1", idx: 0, text: "第一段" });
    await seedChunk(db, { chunk_id: "c3", doc_id: "doc2", idx: 0, text: "另一篇" });

    const rows = await db.all<{ chunk_id: string }>(
      "SELECT * FROM kb_chunks WHERE user_id = $1 AND direction_id = $2",
      ["u1", "d1"],
    );
    expect(rows.map((r) => r.chunk_id)).toEqual(["c1", "c2", "c3"]);
  });

  it("按 doc_id 列片段时不会带上其它文档（putKbDocument 的旧片段清理依赖它）", async () => {
    const db = await seedUser();
    await seedDoc(db, { doc_id: "doc1" });
    await seedDoc(db, { doc_id: "doc2" });
    await seedChunk(db, { chunk_id: "c1", doc_id: "doc1", idx: 0 });
    await seedChunk(db, { chunk_id: "c2", doc_id: "doc2", idx: 0 });
    await seedChunk(db, { chunk_id: "c3", doc_id: "doc1", idx: 1 });

    const rows = await db.all<{ chunk_id: string }>(
      "SELECT chunk_id, doc_id FROM kb_chunks WHERE user_id = $1 AND doc_id = $2 ORDER BY chunk_id",
      ["u1", "doc1"],
    );
    expect(rows.map((r) => r.chunk_id)).toEqual(["c1", "c3"]);
  });

  /*
   * 回归：分页 SQL 同时含 `direction_id = $2` 与 `chunk_id > $3`。
   * 先判 direction_id 会一次返回整方向（c2,c3,c4），after 游标永远推不动。
   */
  it("kb_chunks 游标分页：after=c1&limit=2 只返回 c2,c3", async () => {
    const db = await seedUser();
    await seedDoc(db, { doc_id: "doc1" });
    for (const id of ["c1", "c2", "c3", "c4"]) {
      await seedChunk(db, { chunk_id: id, doc_id: "doc1", idx: Number(id.slice(1)) });
    }

    const rows = await db.all<{ chunk_id: string }>(
      "SELECT * FROM kb_chunks WHERE user_id = $1 AND direction_id = $2 AND chunk_id > $3 ORDER BY chunk_id LIMIT $4",
      ["u1", "d1", "c1", 2],
    );
    expect(rows.map((r) => r.chunk_id)).toEqual(["c2", "c3"]);
  });

  it("删除形状 kb_docs(user_id,doc_id)：删一篇并级联删它的片段", async () => {
    const db = await seedUser();
    await seedDoc(db, { doc_id: "doc1" });
    await seedDoc(db, { doc_id: "doc2" });
    await seedChunk(db, { chunk_id: "c1", doc_id: "doc1", idx: 0 });
    await seedChunk(db, { chunk_id: "c2", doc_id: "doc1", idx: 1 });
    await seedChunk(db, { chunk_id: "c3", doc_id: "doc2", idx: 0 });

    expect(
      await db.run("DELETE FROM kb_docs WHERE user_id = $1 AND doc_id = $2", ["u1", "doc1"]),
    ).toBe(1);
    expect(
      await db.run("DELETE FROM kb_docs WHERE user_id = $1 AND doc_id = $2", ["u1", "doc1"]),
    ).toBe(0);

    const docs = await db.all<{ doc_id: string }>("SELECT * FROM kb_docs WHERE user_id = $1", ["u1"]);
    expect(docs.map((r) => r.doc_id)).toEqual(["doc2"]);
    const chunks = await db.all<{ chunk_id: string }>(
      "SELECT * FROM kb_chunks WHERE user_id = $1",
      ["u1"],
    );
    expect(chunks.map((r) => r.chunk_id)).toEqual(["c3"]);
  });

  it("删除形状 kb_docs(user_id,direction_id)：删整个方向的文档与片段", async () => {
    const db = await seedUser();
    await seedDoc(db, { doc_id: "doc1", direction_id: "d1" });
    await seedDoc(db, { doc_id: "doc2", direction_id: "d1" });
    await seedDoc(db, { doc_id: "doc3", direction_id: "d2" });
    await seedChunk(db, { chunk_id: "c1", doc_id: "doc1", direction_id: "d1" });
    await seedChunk(db, { chunk_id: "c2", doc_id: "doc2", direction_id: "d1" });
    await seedChunk(db, { chunk_id: "c3", doc_id: "doc3", direction_id: "d2" });

    expect(
      await db.run("DELETE FROM kb_docs WHERE user_id = $1 AND direction_id = $2", ["u1", "d1"]),
    ).toBe(2);

    const docs = await db.all<{ doc_id: string }>("SELECT * FROM kb_docs WHERE user_id = $1", ["u1"]);
    expect(docs.map((r) => r.doc_id)).toEqual(["doc3"]);
    const chunks = await db.all<{ chunk_id: string }>(
      "SELECT * FROM kb_chunks WHERE user_id = $1",
      ["u1"],
    );
    expect(chunks.map((r) => r.chunk_id)).toEqual(["c3"]);
  });

  it("删除形状 kb_chunks(user_id,doc_id)：删该文档的全部片段", async () => {
    const db = await seedUser();
    await seedDoc(db, { doc_id: "doc1" });
    await seedDoc(db, { doc_id: "doc2" });
    await seedChunk(db, { chunk_id: "c1", doc_id: "doc1", idx: 0 });
    await seedChunk(db, { chunk_id: "c2", doc_id: "doc1", idx: 1 });
    await seedChunk(db, { chunk_id: "c3", doc_id: "doc2", idx: 0 });

    expect(
      await db.run("DELETE FROM kb_chunks WHERE user_id = $1 AND doc_id = $2", ["u1", "doc1"]),
    ).toBe(2);
    const chunks = await db.all<{ chunk_id: string }>(
      "SELECT * FROM kb_chunks WHERE user_id = $1",
      ["u1"],
    );
    expect(chunks.map((r) => r.chunk_id)).toEqual(["c3"]);
  });

  it("删除形状 kb_chunks(user_id,chunk_id)：只删一段并返回真实数量", async () => {
    const db = await seedUser();
    await seedDoc(db, { doc_id: "doc1" });
    await seedChunk(db, { chunk_id: "c1", doc_id: "doc1", idx: 0 });
    await seedChunk(db, { chunk_id: "c2", doc_id: "doc1", idx: 1 });

    expect(
      await db.run("DELETE FROM kb_chunks WHERE user_id = $1 AND chunk_id = $2", ["u1", "c2"]),
    ).toBe(1);
    expect(
      await db.run("DELETE FROM kb_chunks WHERE user_id = $1 AND chunk_id = $2", ["u1", "c2"]),
    ).toBe(0);

    const chunks = await db.all<{ chunk_id: string }>(
      "SELECT * FROM kb_chunks WHERE user_id = $1",
      ["u1"],
    );
    expect(chunks.map((r) => r.chunk_id)).toEqual(["c1"]);
  });

  it("删除形状 kb_chunks(user_id,direction_id)：删整个方向的片段", async () => {
    const db = await seedUser();
    await seedDoc(db, { doc_id: "doc1", direction_id: "d1" });
    await seedDoc(db, { doc_id: "doc2", direction_id: "d2" });
    await seedChunk(db, { chunk_id: "c1", doc_id: "doc1", direction_id: "d1" });
    await seedChunk(db, { chunk_id: "c2", doc_id: "doc1", direction_id: "d1" });
    await seedChunk(db, { chunk_id: "c3", doc_id: "doc2", direction_id: "d2" });

    expect(
      await db.run("DELETE FROM kb_chunks WHERE user_id = $1 AND direction_id = $2", ["u1", "d1"]),
    ).toBe(2);
    const chunks = await db.all<{ chunk_id: string }>(
      "SELECT * FROM kb_chunks WHERE user_id = $1",
      ["u1"],
    );
    expect(chunks.map((r) => r.chunk_id)).toEqual(["c3"]);
  });
});

describe("memories 内存实现", () => {
  it("upsert 更新同键不新增行，按 subject_id 与 status 过滤", async () => {
    const db = await seedUser();
    await seedMemory(db, { mem_id: "m1", payload: "{\"v\":1}" });
    await seedMemory(db, { mem_id: "m1", payload: "{\"v\":2}" });
    await seedMemory(db, { mem_id: "m2", subject_id: "algorithms", question_id: "q2" });
    await seedMemory(db, { mem_id: "m3", status: "resolved", question_id: "q3" });

    const rows = await db.all<{ mem_id: string; payload: string }>(
      "SELECT * FROM memories WHERE user_id = $1 AND subject_id = $2",
      ["u1", "data-structures"],
    );
    expect(rows.map((r) => r.mem_id)).toEqual(["m1", "m3"]);
    expect(rows[0].payload).toBe("{\"v\":2}");

    const open = await db.all<{ mem_id: string }>(
      "SELECT * FROM memories WHERE user_id = $1 AND subject_id = $2 AND status = $3",
      ["u1", "data-structures", "resolved"],
    );
    expect(open.map((r) => r.mem_id)).toEqual(["m3"]);
  });

  it("删除形状 memories(user_id,subject_id)：清空学科快照", async () => {
    const db = await seedUser();
    await seedMemory(db, { mem_id: "m1", subject_id: "data-structures" });
    await seedMemory(db, { mem_id: "m2", subject_id: "data-structures" });
    await seedMemory(db, { mem_id: "m3", subject_id: "algorithms", question_id: "q3" });

    expect(
      await db.run("DELETE FROM memories WHERE user_id = $1 AND subject_id = $2", [
        "u1",
        "data-structures",
      ]),
    ).toBe(2);

    const rows = await db.all<{ mem_id: string }>("SELECT * FROM memories WHERE user_id = $1", [
      "u1",
    ]);
    expect(rows.map((r) => r.mem_id)).toEqual(["m3"]);
  });

  it("删除形状 memories(user_id,mem_id)：删单张并返回真实数量", async () => {
    const db = await seedUser();
    await seedMemory(db, { mem_id: "m1" });
    await seedMemory(db, { mem_id: "m2", question_id: "q2" });

    expect(await db.run("DELETE FROM memories WHERE user_id = $1 AND mem_id = $2", ["u1", "m2"])).toBe(
      1,
    );
    expect(await db.run("DELETE FROM memories WHERE user_id = $1 AND mem_id = $2", ["u1", "m2"])).toBe(
      0,
    );

    const rows = await db.all<{ mem_id: string }>("SELECT * FROM memories WHERE user_id = $1", [
      "u1",
    ]);
    expect(rows.map((r) => r.mem_id)).toEqual(["m1"]);
  });
});

describe("dbBackend", () => {
  it("按 DATABASE_URL 判定，可被 __setDbBackendForTests 覆盖", () => {
    const original = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      expect(dbBackend()).toBe("memory");

      process.env.DATABASE_URL = "postgres://user:pass@localhost/db";
      expect(dbBackend()).toBe("postgres");

      __setDbBackendForTests("memory");
      expect(dbBackend()).toBe("memory");

      __setDbBackendForTests("postgres");
      expect(dbBackend()).toBe("postgres");
    } finally {
      __setDbBackendForTests(null);
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
  });
});

// ── kb_chunk_vectors / mcp_servers ────────────────────────────────

const VECTOR_MODEL = "bge-small-zh-v1.5-q8";

/**
 * 这里的参数顺序必须与 KB_VECTOR_SQL / MCP_SERVER_SQL 一致：
 * 内存实现按列名 upsert、按参数位置过滤，两处分叉会抛错或读错行。
 */
function vectorParams(over: Partial<Record<string, string | number>> = {}): unknown[] {
  return [
    over.user_id ?? "u1",
    over.chunk_id ?? "c1",
    over.model ?? VECTOR_MODEL,
    over.dim ?? 512,
    over.vec ?? "[0.1,0.2]",
    over.updated_at ?? "2026-10-30T00:00:00.000Z",
  ];
}

function mcpParams(over: Partial<Record<string, string | number | boolean>> = {}): unknown[] {
  return [
    over.user_id ?? "u1",
    over.server_id ?? "s1",
    over.label ?? "只读工具",
    over.url ?? "https://mcp.example.com/mcp",
    over.enabled ?? true,
    over.allowed_tools_json ?? JSON.stringify(["list_docs"]),
    over.auth_ct ?? "ct",
    over.auth_iv ?? "iv",
    over.auth_tag ?? "tag",
    over.auth_kid ?? "v1",
    over.auth_hint ?? "••••1234",
    over.created_at ?? "2026-10-30T00:00:00.000Z",
    over.updated_at ?? "2026-10-30T00:00:00.000Z",
  ];
}

async function seedVectorFixture(db: TestDb) {
  await seedUser("u1");
  await seedUser("u2");
  await seedDoc(db, { user_id: "u1", doc_id: "doc1", direction_id: "d1" });
  await seedDoc(db, { user_id: "u2", doc_id: "doc2", direction_id: "d2" });
  await seedChunk(db, { user_id: "u1", chunk_id: "c1", doc_id: "doc1", direction_id: "d1" });
  await seedChunk(db, { user_id: "u1", chunk_id: "c2", doc_id: "doc1", direction_id: "d1" });
  await seedChunk(db, { user_id: "u2", chunk_id: "c1", doc_id: "doc2", direction_id: "d2" });
}

describe("kb_chunk_vectors 内存实现", () => {
  it("upsert 后按方向 JOIN 读回：不跨方向、不跨用户、不跨模型", async () => {
    const db = await getDb();
    await seedVectorFixture(db);

    expect(await db.run(KB_VECTOR_SQL.upsert, vectorParams({ chunk_id: "c1" }))).toBe(1);
    expect(await db.run(KB_VECTOR_SQL.upsert, vectorParams({ chunk_id: "c2" }))).toBe(1);
    expect(
      await db.run(KB_VECTOR_SQL.upsert, vectorParams({ user_id: "u2", chunk_id: "c1" })),
    ).toBe(1);
    // 同一个片段在另一个模型下再写一行：读取时必须被 model 过滤掉
    expect(
      await db.run(KB_VECTOR_SQL.upsert, vectorParams({ chunk_id: "c1", model: "m2" })),
    ).toBe(1);

    const mine = await listKbChunkVectorsByDirection(db, "u1", "d1", VECTOR_MODEL);
    expect(mine.map((r) => r.chunk_id)).toEqual(["c1", "c2"]);
    expect(mine[0].model).toBe(VECTOR_MODEL);
    expect(mine[0].dim).toBe(512);

    // direction_id 不在 kb_chunk_vectors 里：d2 的过滤来自 JOIN kb_chunks
    expect(await listKbChunkVectorsByDirection(db, "u1", "d2", VECTOR_MODEL)).toEqual([]);

    const otherUser = await listKbChunkVectorsByDirection(db, "u2", "d2", VECTOR_MODEL);
    expect(otherUser.map((r) => r.chunk_id)).toEqual(["c1"]);

    const otherModel = await listKbChunkVectorsByDirection(db, "u1", "d1", "m2");
    expect(otherModel.map((r) => r.chunk_id)).toEqual(["c1"]);
  });

  it("同一 (user_id, chunk_id, model) 重复写入是更新：行数不变、updated_at 取新值", async () => {
    const db = await getDb();
    await seedVectorFixture(db);

    expect(
      await db.run(
        KB_VECTOR_SQL.upsert,
        vectorParams({ chunk_id: "c1", updated_at: "2026-10-30T00:00:00.000Z" }),
      ),
    ).toBe(1);
    expect(
      await db.run(
        KB_VECTOR_SQL.upsert,
        vectorParams({ chunk_id: "c1", vec: "[0.3,0.4]", updated_at: "2026-10-30T02:00:00.000Z" }),
      ),
    ).toBe(1);

    const rows = await listKbChunkVectorsByDirection(db, "u1", "d1", VECTOR_MODEL);
    expect(rows).toHaveLength(1);
    expect(rows[0].updated_at).toBe("2026-10-30T02:00:00.000Z");
  });

  it("删除形状 kb_chunk_vectors(user_id,chunk_id)：删该片段的全部模型行", async () => {
    const db = await getDb();
    await seedVectorFixture(db);
    await db.run(KB_VECTOR_SQL.upsert, vectorParams({ chunk_id: "c1" }));
    await db.run(KB_VECTOR_SQL.upsert, vectorParams({ chunk_id: "c1", model: "m2" }));
    await db.run(KB_VECTOR_SQL.upsert, vectorParams({ chunk_id: "c2" }));

    expect(await db.run(KB_VECTOR_SQL.deleteByChunk, ["u1", "c1"])).toBe(2);
    expect(await db.run(KB_VECTOR_SQL.deleteByChunk, ["u1", "c1"])).toBe(0);

    const model1 = await listKbChunkVectorsByDirection(db, "u1", "d1", VECTOR_MODEL);
    expect(model1.map((r) => r.chunk_id)).toEqual(["c2"]);
    expect(await listKbChunkVectorsByDirection(db, "u1", "d1", "m2")).toEqual([]);
  });

  it("删片段/删文档级联删向量（对齐外键 ON DELETE CASCADE）", async () => {
    const db = await getDb();
    await seedVectorFixture(db);
    await db.run(KB_VECTOR_SQL.upsert, vectorParams({ chunk_id: "c1" }));
    await db.run(KB_VECTOR_SQL.upsert, vectorParams({ chunk_id: "c2" }));

    expect(
      await db.run("DELETE FROM kb_chunks WHERE user_id = $1 AND chunk_id = $2", ["u1", "c1"]),
    ).toBe(1);
    // 用同一个 chunk_id 重新写入片段：旧向量若还在，JOIN 会把它带出来
    await seedChunk(db, { user_id: "u1", chunk_id: "c1", doc_id: "doc1", direction_id: "d1" });
    expect(
      (await listKbChunkVectorsByDirection(db, "u1", "d1", VECTOR_MODEL)).map((r) => r.chunk_id),
    ).toEqual(["c2"]);

    // 删文档 -> 删片段 -> 级联删向量；重新写入片段后旧向量不应复活
    expect(await db.run("DELETE FROM kb_docs WHERE user_id = $1 AND doc_id = $2", ["u1", "doc1"])).toBe(
      1,
    );
    await seedDoc(db, { user_id: "u1", doc_id: "doc1", direction_id: "d1" });
    await seedChunk(db, { user_id: "u1", chunk_id: "c2", doc_id: "doc1", direction_id: "d1" });
    expect(await listKbChunkVectorsByDirection(db, "u1", "d1", VECTOR_MODEL)).toEqual([]);
  });

  it("相似度查询在内存实现里返回空数组（没有 pgvector），未知形状直接抛错", async () => {
    const db = await getDb();
    await seedVectorFixture(db);
    await db.run(KB_VECTOR_SQL.upsert, vectorParams({ chunk_id: "c1" }));

    // 内存实现没有 pgvector：不使用应用层余弦冒充 <=> 的结果
    expect(
      await db.all(KB_VECTOR_SQL.similar, ["u1", "d1", VECTOR_MODEL, "[0.1,0.2]", 3]),
    ).toEqual([]);

    // 写错的形状不能被静默当成空结果——ADR 里的 direction_id 缺陷正是这样来的
    await expect(
      db.all("SELECT * FROM kb_chunk_vectors WHERE user_id = $1", ["u1"]),
    ).rejects.toThrow(/不支持/);
    await expect(
      db.run("DELETE FROM kb_chunk_vectors WHERE user_id = $1 AND model = $2", ["u1", VECTOR_MODEL]),
    ).rejects.toThrow(/不支持/);
  });
});

describe("mcp_servers 内存实现", () => {
  it("upsert 同键不新增行：label/enabled 更新、created_at 保留", async () => {
    const db = await seedUser();

    expect(await db.run(MCP_SERVER_SQL.upsert, mcpParams())).toBe(1);
    expect(
      await db.run(
        MCP_SERVER_SQL.upsert,
        mcpParams({
          label: "新标签",
          enabled: false,
          allowed_tools_json: JSON.stringify(["list_docs", "search_docs"]),
          updated_at: "2026-10-30T01:00:00.000Z",
        }),
      ),
    ).toBe(1);

    const rows = await db.all<{
      label: string;
      enabled: boolean;
      allowed_tools_json: string;
      created_at: string;
      updated_at: string;
    }>(MCP_SERVER_SQL.list, ["u1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("新标签");
    expect(rows[0].enabled).toBe(false);
    expect(JSON.parse(rows[0].allowed_tools_json)).toEqual(["list_docs", "search_docs"]);
    expect(rows[0].created_at).toBe("2026-10-30T00:00:00.000Z");
    expect(rows[0].updated_at).toBe("2026-10-30T01:00:00.000Z");
  });

  it("按 user_id 隔离，one 按 (user_id, server_id) 取单条", async () => {
    const db = await seedUser("u1");
    await seedUser("u2");
    await db.run(MCP_SERVER_SQL.upsert, mcpParams({ server_id: "s2", label: "二号" }));
    await db.run(MCP_SERVER_SQL.upsert, mcpParams({ server_id: "s1" }));
    await db.run(MCP_SERVER_SQL.upsert, mcpParams({ user_id: "u2", server_id: "s1", label: "别人的" }));

    const list = await db.all<{ server_id: string }>(MCP_SERVER_SQL.list, ["u1"]);
    expect(list.map((r) => r.server_id)).toEqual(["s1", "s2"]);

    const one = await db.one<{ label: string }>(MCP_SERVER_SQL.byId, ["u1", "s2"]);
    expect(one?.label).toBe("二号");
    expect(await db.one(MCP_SERVER_SQL.byId, ["u1", "s9"])).toBeNull();
  });

  it("删除形状 mcp_servers(user_id,server_id)：只删该行并返回真实数量", async () => {
    const db = await seedUser();
    await db.run(MCP_SERVER_SQL.upsert, mcpParams({ server_id: "s1" }));
    await db.run(MCP_SERVER_SQL.upsert, mcpParams({ server_id: "s2", label: "二号" }));

    expect(await db.run(MCP_SERVER_SQL.deleteById, ["u1", "s1"])).toBe(1);
    expect(await db.run(MCP_SERVER_SQL.deleteById, ["u1", "s1"])).toBe(0);

    const rows = await db.all<{ server_id: string }>(MCP_SERVER_SQL.list, ["u1"]);
    expect(rows.map((r) => r.server_id)).toEqual(["s2"]);
  });
});

// ── ensureSchema 的 pgvector 降级 ────────────────────────────────

function fakeDb(run: (sql: string) => Promise<number>): Db {
  return {
    run,
    async all<T>() {
      return [] as T[];
    },
    async one<T>() {
      return null as T | null;
    },
  };
}

describe("ensureSchema 与 pgvector", () => {
  it("扩展不可用：跳过 kb_chunk_vectors、其余表照建，只告警一次", async () => {
    const executed: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const db = fakeDb(async (sql) => {
        if (/create extension/i.test(sql)) {
          throw new Error('permission denied to create extension "vector"');
        }
        executed.push(sql);
        return 0;
      });

      await expect(__ensureSchemaForTests(db)).resolves.toBeUndefined();
      // 再跑一次（模拟重启/重连）仍然不抛错，且不重复告警
      await expect(__ensureSchemaForTests(db)).resolves.toBeUndefined();

      expect(executed.some((sql) => /kb_chunk_vectors/i.test(sql))).toBe(false);
      expect(executed.some((sql) => /create table if not exists mcp_servers/i.test(sql))).toBe(true);
      expect(executed.some((sql) => /create table if not exists users/i.test(sql))).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("扩展可用但向量表建表失败：只告警，不让应用起不来", async () => {
    const executed: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const db = fakeDb(async (sql) => {
        if (/create table if not exists kb_chunk_vectors/i.test(sql)) {
          throw new Error('type "vector" does not exist');
        }
        executed.push(sql);
        return 0;
      });

      await expect(__ensureSchemaForTests(db)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(executed.some((sql) => /create table if not exists mcp_servers/i.test(sql))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("先建扩展再建向量表（顺序不能反，否则 vector 类型不存在）", async () => {
    const executed: string[] = [];
    const db = fakeDb(async (sql) => {
      executed.push(sql);
      return 0;
    });

    await __ensureSchemaForTests(db);
    const extensionAt = executed.findIndex((sql) => /create extension/i.test(sql));
    const tableAt = executed.findIndex((sql) => /create table if not exists kb_chunk_vectors/i.test(sql));
    expect(extensionAt).toBeGreaterThanOrEqual(0);
    expect(tableAt).toBeGreaterThan(extensionAt);
  });
});

// ── 迁移文件与迁移执行器 ─────────────────────────────────────────

const MIGRATION_FILE = "0001_capability.sql";
const migrationSql = readFileSync(
  new URL(`../../db/migrations/${MIGRATION_FILE}`, import.meta.url),
  "utf8",
);
const learningSessionMigration = readFileSync(new URL("../../db/migrations/0002_learning_sessions.sql", import.meta.url), "utf8");
const conversationMigration = readFileSync(new URL("../../db/migrations/0003_tutor_conversations.sql", import.meta.url), "utf8");

const normalizeSql = (sql: string): string => sql.replace(/\s+/g, " ").trim().toLowerCase();

describe(`${MIGRATION_FILE}`, () => {
  const statements = splitSqlStatements(`${migrationSql}\n${learningSessionMigration}\n${conversationMigration}`);

  it("逐条覆盖 SCHEMA，且 CREATE EXTENSION 是单独的第一条", () => {
    const normalized = statements.map(normalizeSql);
    expect(normalized[0]).toBe(normalizeSql(PGVECTOR_EXTENSION));
    expect(statements.filter((stmt) => /create extension/i.test(stmt))).toHaveLength(1);
    for (const stmt of SCHEMA) {
      expect(normalized).toContain(normalizeSql(stmt));
    }
  });

  it("不含 CONCURRENTLY（迁移在事务里执行）", () => {
    expect(() => assertNoConcurrently(MIGRATION_FILE, statements)).not.toThrow();
  });
});

describe("scripts/db-migrate 纯函数", () => {
  it("splitSqlStatements 忽略注释、保留字符串与美元引用里的分号", () => {
    const source = [
      "-- 注释里的分号 ; 不算语句",
      "CREATE TABLE a (x TEXT DEFAULT 'a;b');",
      "/* 块注释 ; */",
      "INSERT INTO a VALUES ($tag$ ; $tag$);",
    ].join("\n");

    const statements = splitSqlStatements(source);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'a;b'");
    expect(statements[1]).toContain("$tag$ ; $tag$");
  });

  it("pendingMigrations 按文件名排序并跳过已应用", () => {
    const all = ["0003_c.sql", "0001_a.sql", "0002_b.sql"];
    expect(pendingMigrations(all, [])).toEqual(["0001_a.sql", "0002_b.sql", "0003_c.sql"]);
    expect(pendingMigrations(all, ["0001_a.sql", "0002_b.sql"])).toEqual(["0003_c.sql"]);
  });

  it("assertNoConcurrently 拒绝事务里的并发建索引", () => {
    expect(() => assertNoConcurrently("x.sql", ["CREATE INDEX CONCURRENTLY i ON t(c)"])).toThrow(
      /CONCURRENTLY/,
    );
    expect(() =>
      assertNoConcurrently("x.sql", ["CREATE INDEX IF NOT EXISTS i ON t(c)"]),
    ).not.toThrow();
  });

  it("loadPendingMigrations 读取真实迁移目录，已应用的不再返回", () => {
    const plans = loadPendingMigrations(MIGRATIONS_DIR, []);
    const files = plans.map((plan) => plan.file);
    expect(files).toContain(MIGRATION_FILE);
    expect(files).toEqual([...files].sort());

    expect(loadPendingMigrations(MIGRATIONS_DIR, files)).toEqual([]);
  });
});
