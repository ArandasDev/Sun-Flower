CREATE TABLE module_migrations (
  module_id TEXT NOT NULL,
  version TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (module_id, version)
);
