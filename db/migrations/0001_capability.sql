-- 0001_capability.sql
--
-- 数据库迁移 0001：全部表结构（与 src/lib/db.ts 的 SCHEMA 逐条一致，db.test.ts 有断言）。
-- 每条语句都幂等（CREATE ... IF NOT EXISTS），重复执行不会改数据。
--
-- 第一条 CREATE EXTENSION 单独成句：应用运行时由 ensureVectorExtension 单独
-- try/catch，扩展不可用时只跳过 kb_chunk_vectors、其余表照建；而本迁移是显式
-- 操作，扩展装不上就让整个文件失败并回滚，不留下半套表。
--
-- 不写并发建索引：scripts/db-migrate.ts 把每个文件放进一个事务执行，
-- PostgreSQL 不允许在事务块里并发建索引。

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, subject_id)
  );

CREATE TABLE IF NOT EXISTS directions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    description TEXT NOT NULL,
    graph_json TEXT NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_directions_public ON directions(is_public, updated_at);

CREATE INDEX IF NOT EXISTS idx_directions_user ON directions(user_id);

CREATE TABLE IF NOT EXISTS direction_picks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction_id TEXT NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, direction_id)
  );

CREATE TABLE IF NOT EXISTS direction_items (
    id TEXT PRIMARY KEY,
    direction_id TEXT NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
    kc_id TEXT NOT NULL,
    difficulty INTEGER NOT NULL,
    stem TEXT NOT NULL,
    options_json TEXT NOT NULL,
    answer_index INTEGER NOT NULL,
    explanation TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    checks_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (direction_id, content_hash)
  );

CREATE INDEX IF NOT EXISTS idx_direction_items_kc ON direction_items(direction_id, kc_id);

CREATE TABLE IF NOT EXISTS user_secrets (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    api TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '{}',
    secret_ct TEXT NOT NULL DEFAULT '',
    secret_iv TEXT NOT NULL DEFAULT '',
    secret_tag TEXT NOT NULL DEFAULT '',
    secret_kid TEXT NOT NULL,
    secret_hint TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, kind)
  );

CREATE TABLE IF NOT EXISTS kb_docs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_id TEXT NOT NULL,
    direction_id TEXT NOT NULL,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    size BIGINT NOT NULL,
    page_count INTEGER NOT NULL,
    char_count INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    kc_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, doc_id)
  );

CREATE INDEX IF NOT EXISTS idx_kb_docs_direction ON kb_docs(user_id, direction_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
    user_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    direction_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    section TEXT NOT NULL,
    page_from INTEGER,
    page_to INTEGER,
    text TEXT NOT NULL,
    embedding TEXT,
    embedding_model TEXT,
    embedding_dim INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, chunk_id),
    FOREIGN KEY (user_id, doc_id) REFERENCES kb_docs(user_id, doc_id) ON DELETE CASCADE
  );

CREATE INDEX IF NOT EXISTS idx_kb_chunks_direction ON kb_chunks(user_id, direction_id);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_direction_chunk ON kb_chunks(user_id, direction_id, chunk_id);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(user_id, doc_id);

CREATE TABLE IF NOT EXISTS kb_chunk_vectors (
    user_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vec vector(512) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, chunk_id, model),
    FOREIGN KEY (user_id, chunk_id) REFERENCES kb_chunks(user_id, chunk_id) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS mcp_servers (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    allowed_tools_json TEXT NOT NULL DEFAULT '[]',
    auth_ct TEXT NOT NULL DEFAULT '',
    auth_iv TEXT NOT NULL DEFAULT '',
    auth_tag TEXT NOT NULL DEFAULT '',
    auth_kid TEXT NOT NULL DEFAULT '',
    auth_hint TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, server_id)
  );

CREATE TABLE IF NOT EXISTS memories (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mem_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    kc_id TEXT NOT NULL,
    with_kc_id TEXT,
    question_id TEXT,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, mem_id)
  );

CREATE INDEX IF NOT EXISTS idx_memories_subject ON memories(user_id, subject_id);
