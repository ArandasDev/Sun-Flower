CREATE TABLE developers (
  user_id TEXT PRIMARY KEY,
  added_at TEXT NOT NULL
);

CREATE TABLE permission_grants (
  permission TEXT NOT NULL,
  role_id TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (permission, role_id)
);

CREATE TABLE module_config (
  module_id TEXT PRIMARY KEY,
  enabled INTEGER NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
