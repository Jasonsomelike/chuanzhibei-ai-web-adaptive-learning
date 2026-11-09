-- Account/course teaching checkpoints; does not store credentials or images.
CREATE TABLE IF NOT EXISTS learning_sessions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (user_id, target_id)
);
