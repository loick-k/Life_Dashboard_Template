PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
 migration_id TEXT PRIMARY KEY, checksum_sha256 TEXT NOT NULL, applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS local_profile (
 profile_id TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT 'Utilisateur',
 timezone TEXT NOT NULL DEFAULT 'Europe/Paris', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK (timezone = 'Europe/Paris')
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS daily_entries (
 entry_id TEXT PRIMARY KEY, entry_date TEXT NOT NULL UNIQUE,
 alcohol_glasses INTEGER, sleep_hours REAL, sleep_bedtime TEXT, sleep_wake_time TEXT, nap_minutes INTEGER,
 weight_kg REAL, body_fat_pct REAL, belly_cm REAL,
 work_mode TEXT, work_start_time TEXT, work_morning_end_time TEXT,
 work_afternoon_start_time TEXT, work_end_time TEXT, work_third_start_time TEXT,
 work_third_end_time TEXT, work_duration_minutes INTEGER, phone_minutes INTEGER,
 meal_breakfast TEXT, meal_lunch TEXT, meal_dinner TEXT, meal_other TEXT,
 kcal INTEGER, sport_kcal_burned INTEGER, proteins_g REAL, carbs_g REAL, fats_g REAL,
 nutrition_analysis_hash TEXT, nutrition_analysis_model TEXT,
 nutrition_analysis_confidence TEXT, nutrition_analysis_assumptions TEXT, nutrition_analyzed_at TEXT,
 me_time_writing_minutes INTEGER, me_time_meditation_minutes INTEGER,
 me_time_relaxation_minutes INTEGER, me_time_outings_minutes INTEGER,
 self_listening_score INTEGER, close_relations_listening_score INTEGER,
 completed_steps TEXT NOT NULL DEFAULT '[]', skipped_steps TEXT NOT NULL DEFAULT '[]',
 checkin_finished INTEGER NOT NULL DEFAULT 0, checkin_version INTEGER NOT NULL DEFAULT 1,
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK (alcohol_glasses IS NULL OR alcohol_glasses >= 0),
 CHECK (sleep_hours IS NULL OR sleep_hours BETWEEN 0 AND 24),
 CHECK (nap_minutes IS NULL OR nap_minutes BETWEEN 0 AND 720),
 CHECK (weight_kg IS NULL OR weight_kg > 0),
 CHECK (body_fat_pct IS NULL OR body_fat_pct BETWEEN 0 AND 100),
 CHECK (work_duration_minutes IS NULL OR work_duration_minutes >= 0),
 CHECK (phone_minutes IS NULL OR phone_minutes BETWEEN 0 AND 1440),
 CHECK (checkin_finished IN (0, 1)), CHECK (revision >= 1)
);
CREATE INDEX IF NOT EXISTS idx_daily_entries_date ON daily_entries(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_entries_updated ON daily_entries(updated_at DESC);

CREATE TABLE IF NOT EXISTS sport_sessions (
 session_id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, position INTEGER NOT NULL,
 sport_type TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 0, distance_km REAL,
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(entry_id, position), FOREIGN KEY (entry_id) REFERENCES daily_entries(entry_id) ON DELETE CASCADE,
 CHECK (position BETWEEN 1 AND 3), CHECK (duration_minutes BETWEEN 0 AND 600),
 CHECK (distance_km IS NULL OR distance_km BETWEEN 0 AND 200)
);
CREATE INDEX IF NOT EXISTS idx_sport_sessions_entry ON sport_sessions(entry_id);

CREATE TABLE IF NOT EXISTS friends (
 friend_id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Ami',
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK (active IN (0, 1))
);
CREATE TABLE IF NOT EXISTS social_logs (
 social_log_id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, friend_id TEXT NOT NULL,
 context TEXT NOT NULL DEFAULT 'Vu en personne', duration_minutes INTEGER, note TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(entry_id, friend_id),
 FOREIGN KEY (entry_id) REFERENCES daily_entries(entry_id) ON DELETE CASCADE,
 FOREIGN KEY (friend_id) REFERENCES friends(friend_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_social_logs_entry ON social_logs(entry_id);
CREATE INDEX IF NOT EXISTS idx_social_logs_friend ON social_logs(friend_id);

CREATE TABLE IF NOT EXISTS goals (
 goal_id TEXT PRIMARY KEY, title TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL, CHECK (active IN (0, 1))
);
CREATE TABLE IF NOT EXISTS goal_logs (
 goal_log_id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, goal_id TEXT NOT NULL,
 worked INTEGER NOT NULL DEFAULT 0, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(entry_id, goal_id), FOREIGN KEY (entry_id) REFERENCES daily_entries(entry_id) ON DELETE CASCADE,
 FOREIGN KEY (goal_id) REFERENCES goals(goal_id) ON DELETE RESTRICT, CHECK (worked IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_goal_logs_entry ON goal_logs(entry_id);

CREATE TABLE IF NOT EXISTS backup_history (
 backup_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, destination TEXT NOT NULL,
 encrypted INTEGER NOT NULL DEFAULT 1, checksum_sha256 TEXT NOT NULL,
 schema_version TEXT NOT NULL, status TEXT NOT NULL,
 CHECK (encrypted IN (0, 1)), CHECK (status IN ('created', 'verified', 'failed'))
);
