-- Full conversation archives. Model context and trusted learning checkpoints stay separate.
CREATE TABLE IF NOT EXISTS tutor_conversations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL, title TEXT NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE, archived BOOLEAN NOT NULL DEFAULT FALSE, deleted_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
  last_seq INTEGER NOT NULL DEFAULT 0, parent_id TEXT, parent_message_id TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_tutor_conversations_list
  ON tutor_conversations(user_id, archived, pinned DESC, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS tutor_messages (
  user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')), data TEXT NOT NULL,
  proof TEXT, state TEXT NOT NULL CHECK (state IN ('pending', 'complete', 'interrupted')),
  revision INTEGER NOT NULL DEFAULT 0, run_token TEXT, inherited_from TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, conversation_id, id), UNIQUE (user_id, conversation_id, seq),
  FOREIGN KEY (user_id, conversation_id) REFERENCES tutor_conversations(user_id, id) ON DELETE CASCADE
);
