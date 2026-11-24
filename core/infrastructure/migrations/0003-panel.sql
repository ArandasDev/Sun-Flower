CREATE TABLE panel_sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX panel_sessions_user ON panel_sessions (user_id);

ALTER TABLE module_config ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
