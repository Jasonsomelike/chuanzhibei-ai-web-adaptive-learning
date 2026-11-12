-- Durable document imports and learning-time checkpoints.
CREATE TABLE IF NOT EXISTS learning_artifacts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  revision INTEGER NOT NULL, touched BIGINT NOT NULL,
  PRIMARY KEY (user_id, namespace, id)
);
