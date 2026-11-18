ALTER TABLE moderation_cases ADD COLUMN rules TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(rules));
CREATE INDEX moderation_cases_target_status ON moderation_cases (target_user_id, status, created_at);
