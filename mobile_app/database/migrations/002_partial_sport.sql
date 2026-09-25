CREATE TABLE sport_sessions_next (
 session_id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, position INTEGER NOT NULL,
 sport_type TEXT, duration_minutes INTEGER, distance_km REAL,
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(entry_id, position), FOREIGN KEY (entry_id) REFERENCES daily_entries(entry_id) ON DELETE CASCADE,
 CHECK (position BETWEEN 1 AND 3),
 CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 600),
 CHECK (distance_km IS NULL OR distance_km BETWEEN 0 AND 200), CHECK (revision >= 1)
);
INSERT INTO sport_sessions_next SELECT * FROM sport_sessions;
DROP TABLE sport_sessions;
ALTER TABLE sport_sessions_next RENAME TO sport_sessions;
CREATE INDEX idx_sport_sessions_entry ON sport_sessions(entry_id);
