-- 0005_kb_tombstones.sql
--
-- 跨设备删除标记（与 src/lib/db.ts 的 SCHEMA 逐条一致，db.test.ts 有断言）。
--
-- 删除文档/方向时写下 tombstone；PUT /api/kb 的事务末尾用
-- KB_TOMBSTONE_SQL.undoIfTombstoned 自查：存在 deleted_at >= base 的标记时
-- 撤掉刚写入的文档（删除赢），防止在途上传把已删除的文档复活。
-- 幂等，重复执行不改数据。

CREATE TABLE IF NOT EXISTS kb_tombstones (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL,
  direction_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, doc_id)
);
