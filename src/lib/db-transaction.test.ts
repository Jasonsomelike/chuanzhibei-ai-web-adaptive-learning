import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { guardedStatement } from "./db";

it("Postgres 的 CAS 行数断言在事务内部回滚，不允许失败后继续覆盖片段", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE docs (id INT PRIMARY KEY, version INT); CREATE TABLE chunks (text TEXT); INSERT INTO docs VALUES (1, 2); INSERT INTO chunks VALUES ('winner');");
    await expect(pg.transaction(async tx => {
      await tx.query(guardedStatement({ sql: "UPDATE docs SET version = $1 WHERE id = 1 AND version = $2", params: [3, 1], expectedRows: 1 }), [3, 1]);
      await tx.exec("UPDATE chunks SET text = 'loser'");
    })).rejects.toMatchObject({ code: "22012" });
    expect((await pg.query("SELECT text FROM chunks")).rows).toEqual([{ text: "winner" }]);
    const accepted = await pg.query<{affected: number}>(guardedStatement({ sql: "UPDATE docs SET version = $1 WHERE id = 1 AND version = $2", expectedRows: 1 }), [3, 2]);
    expect(accepted.rows[0].affected).toBe(1);
  } finally { await pg.close(); }
}, 30000);
