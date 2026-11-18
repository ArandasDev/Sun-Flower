CREATE TABLE moderation_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('automatic', 'manual')),
  level TEXT NULL CHECK (level IS NULL OR level IN ('confirmed', 'suspicious')),
  action TEXT NOT NULL CHECK (action IN ('none', 'delete_timeout', 'warn', 'timeout', 'kick', 'ban')),
  target_user_id TEXT NOT NULL,
  actor_user_id TEXT NULL,
  channel_id TEXT NULL,
  message_id TEXT NULL,
  domains TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(domains)),
  signals TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(signals)),
  score INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(outcome)),
  status TEXT NOT NULL CHECK (status IN ('open', 'actioned', 'reverted', 'dismissed')),
  timeout_until TEXT NULL,
  created_at TEXT NOT NULL,
  reverted_by TEXT NULL,
  reverted_at TEXT NULL
);
CREATE INDEX moderation_cases_target ON moderation_cases (target_user_id, created_at);
CREATE INDEX moderation_cases_message ON moderation_cases (message_id);

CREATE TABLE moderation_domains (
  domain TEXT PRIMARY KEY,
  list TEXT NOT NULL CHECK (list IN ('block', 'allow')),
  added_by TEXT NULL,
  added_at TEXT NOT NULL
);
