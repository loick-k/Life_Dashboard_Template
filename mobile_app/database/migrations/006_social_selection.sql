-- A checkbox is not permission to destroy an imported encounter's note or duration.
ALTER TABLE social_logs ADD COLUMN included INTEGER NOT NULL DEFAULT 1
 CHECK (typeof(included) = 'integer' AND included IN (0, 1));
CREATE INDEX idx_social_logs_included ON social_logs(entry_id, included);
