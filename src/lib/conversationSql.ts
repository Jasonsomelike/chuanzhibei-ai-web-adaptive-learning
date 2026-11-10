/** Each multi-row mutation is one Postgres statement, including its revision check. */
export const CONVERSATION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tutor_conversations (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL, title TEXT NOT NULL,
    pinned BOOLEAN NOT NULL DEFAULT FALSE, archived BOOLEAN NOT NULL DEFAULT FALSE, deleted_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
    last_seq INTEGER NOT NULL DEFAULT 0, parent_id TEXT, parent_message_id TEXT,
    PRIMARY KEY (user_id, id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tutor_conversations_list
    ON tutor_conversations(user_id, archived, pinned DESC, updated_at DESC, id DESC)
    WHERE deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS tutor_messages (
    user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')), data TEXT NOT NULL,
    proof TEXT, state TEXT NOT NULL CHECK (state IN ('pending', 'complete', 'interrupted')),
    revision INTEGER NOT NULL DEFAULT 0, run_token TEXT, inherited_from TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, conversation_id, id), UNIQUE (user_id, conversation_id, seq),
    FOREIGN KEY (user_id, conversation_id) REFERENCES tutor_conversations(user_id, id) ON DELETE CASCADE
  )`,
] as const;

export const CONVERSATION_SQL = {
  create: `INSERT INTO tutor_conversations
    (user_id, id, target_id, target_name, title, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $6)`,
  byId: `SELECT * FROM tutor_conversations WHERE user_id = $1 AND id = $2`,
  list: `SELECT * FROM tutor_conversations WHERE user_id = $1
    AND (($2 = 'trash' AND deleted_at IS NOT NULL) OR ($2 <> 'trash' AND deleted_at IS NULL AND archived = ($2 = 'archived')))
    AND ($3 = '' OR POSITION(LOWER($3) IN LOWER(title)) > 0)
    AND ($4::boolean IS NULL OR (pinned, updated_at, id) < ($4::boolean, $5, $6))
    ORDER BY pinned DESC, updated_at DESC, id DESC LIMIT $7`,
  update: `UPDATE tutor_conversations SET title = $4, pinned = $5, archived = $6, deleted_at = $7,
    updated_at = $8, revision = revision + 1 WHERE user_id = $1 AND id = $2 AND revision = $3`,
  messages: `WITH sampled AS (
    SELECT * FROM tutor_messages WHERE user_id = $1 AND conversation_id = $2
      AND seq < $3::bigint ORDER BY seq DESC LIMIT $4
  ), sized AS (
    SELECT *, SUM(octet_length(data) + COALESCE(octet_length(proof), 0) + 512) OVER (ORDER BY seq DESC) AS running_bytes,
      ROW_NUMBER() OVER (ORDER BY seq DESC) AS row_number FROM sampled
  ) SELECT * FROM sized WHERE running_bytes <= $5 OR row_number = 1 ORDER BY seq DESC`,
  message: `SELECT * FROM tutor_messages WHERE user_id = $1 AND conversation_id = $2 AND id = $3`,
  pair: `SELECT * FROM tutor_messages WHERE user_id = $1 AND conversation_id = $2 AND id IN ($3, $4)`,
  append: `WITH permitted AS (
    UPDATE tutor_conversations SET last_seq = last_seq + 2, revision = revision + 1, updated_at = $4,
      title = CASE WHEN last_seq = 0 AND title = '新会话' THEN $6 ELSE title END
    WHERE user_id = $1 AND id = $2 AND revision = $3 AND deleted_at IS NULL AND archived = FALSE
    RETURNING last_seq - 2 AS base_seq
  ) INSERT INTO tutor_messages (user_id, conversation_id, id, seq, role, data, state, created_at)
    SELECT $1, $2, item.value->>'id', permitted.base_seq + item.ordinality::integer,
      item.value->>'role', (item.value->'content')::text, item.value->>'state', $4
    FROM permitted CROSS JOIN jsonb_array_elements($5::jsonb) WITH ORDINALITY AS item(value, ordinality)`,
  updateMessage: `WITH changed AS (
    UPDATE tutor_messages SET data = $5, state = $6, revision = revision + 1
    WHERE user_id = $1 AND conversation_id = $2 AND id = $3 AND revision = $4
      AND role = 'assistant' AND inherited_from IS NULL AND (run_token IS NULL OR state <> 'pending')
      AND EXISTS (SELECT 1 FROM tutor_conversations WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL AND archived = FALSE)
    RETURNING conversation_id
  ) UPDATE tutor_conversations SET updated_at = $7 WHERE user_id = $1 AND id = $2 AND EXISTS (SELECT 1 FROM changed)`,
  branch: `WITH source AS (
    SELECT c.*, m.seq AS fork_seq FROM tutor_conversations c
    JOIN tutor_messages m ON m.user_id = c.user_id AND m.conversation_id = c.id
    WHERE c.user_id = $1 AND c.id = $2 AND m.id = $3 AND c.deleted_at IS NULL
      AND m.role = 'assistant' AND m.state <> 'pending'
  ), created AS (
    INSERT INTO tutor_conversations (user_id, id, target_id, target_name, title, created_at, updated_at, last_seq, parent_id, parent_message_id)
    SELECT $1, $4, target_id, target_name, $5, $6, $6, fork_seq, $2, $3 FROM source RETURNING id
  ) INSERT INTO tutor_messages (user_id, conversation_id, id, seq, role, data, proof, state, inherited_from, created_at)
    SELECT $1, created.id, m.id, m.seq, m.role, m.data, m.proof, m.state, $2, m.created_at
    FROM created CROSS JOIN source s JOIN tutor_messages m ON m.user_id = $1 AND m.conversation_id = $2 AND m.seq <= s.fork_seq`,
  claimAgent: `UPDATE tutor_messages SET run_token = $4, revision = revision + 1
    WHERE user_id = $1 AND conversation_id = $2 AND id = $3 AND role = 'assistant'
      AND state = 'pending' AND run_token IS NULL AND inherited_from IS NULL
      AND (data::jsonb->>'text') = ''
      AND EXISTS (SELECT 1 FROM tutor_conversations WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL AND archived = FALSE)`,
  saveAgent: `WITH changed AS (
    UPDATE tutor_messages SET data = $5,
      proof = CASE WHEN (proof::jsonb->>'assessment') IS NOT NULL THEN proof ELSE $6 END,
      state = CASE WHEN (proof::jsonb->>'assessment') IS NOT NULL THEN 'complete' ELSE $7 END, revision = revision + 1
    WHERE user_id = $1 AND conversation_id = $2 AND id = $3 AND run_token = $4 AND inherited_from IS NULL
      AND (state = 'pending' OR $7 <> 'pending')
      AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM tutor_conversations WHERE user_id = $1 AND id = $2 AND target_id = ($6::jsonb->'workflow'->>'targetId')))
    RETURNING conversation_id
  ) UPDATE tutor_conversations SET updated_at = $8 WHERE user_id = $1 AND id = $2 AND EXISTS (SELECT 1 FROM changed)`,
  saveAssessment: `UPDATE tutor_messages SET proof = $5, revision = revision + 1
    WHERE user_id = $1 AND conversation_id = $2 AND id = $3 AND inherited_from IS NULL
      AND (proof::jsonb->'workflow'->>'runId') = $4 AND (proof::jsonb->>'assessment') IS NULL`,
} as const;

export interface ConversationRow {
  user_id: string; id: string; target_id: string; target_name: string; title: string;
  pinned: boolean; archived: boolean; deleted_at: string | null; created_at: string; updated_at: string;
  revision: number; last_seq: number; parent_id: string | null; parent_message_id: string | null;
}
export interface ConversationMessageRow {
  user_id: string; conversation_id: string; id: string; seq: number; role: "user" | "assistant";
  data: string; proof: string | null; state: "pending" | "complete" | "interrupted";
  revision: number; run_token: string | null; inherited_from: string | null; created_at: string;
}
