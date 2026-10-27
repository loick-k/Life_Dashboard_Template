ALTER TABLE daily_entries ADD COLUMN sleep_duration_mode TEXT NOT NULL DEFAULT 'calculated' CHECK (sleep_duration_mode IN ('calculated', 'manual', 'imported'));
ALTER TABLE daily_entries ADD COLUMN nutrition_estimate_stale INTEGER NOT NULL DEFAULT 0 CHECK (nutrition_estimate_stale IN (0, 1));
ALTER TABLE daily_entries ADD COLUMN nutrition_inputs_revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(nutrition_inputs_revision) = 'integer' AND nutrition_inputs_revision >= 1);
ALTER TABLE daily_entries ADD COLUMN nutrition_estimate_origin TEXT NOT NULL DEFAULT 'none' CHECK (nutrition_estimate_origin IN ('none', 'legacy', 'v1', 'v2'));
UPDATE daily_entries SET sleep_duration_mode = 'imported' WHERE sleep_hours IS NOT NULL OR sleep_bedtime IS NOT NULL OR sleep_wake_time IS NOT NULL;
UPDATE daily_entries SET nutrition_estimate_origin = 'legacy' WHERE kcal IS NOT NULL OR sport_kcal_burned IS NOT NULL OR proteins_g IS NOT NULL OR carbs_g IS NOT NULL OR fats_g IS NOT NULL;

-- Derived freshness has its own revision: editing a child sport must not invalidate
-- the parent's user-field CAS revision or erase its in-flight draft.
CREATE TRIGGER sport_nutrition_insert AFTER INSERT ON sport_sessions
WHEN NEW.sport_type IS NOT NULL OR NEW.duration_minutes IS NOT NULL OR NEW.distance_km IS NOT NULL
BEGIN
 UPDATE daily_entries SET nutrition_estimate_stale = 1, nutrition_inputs_revision = nutrition_inputs_revision + 1 WHERE entry_id = NEW.entry_id;
END;
CREATE TRIGGER sport_nutrition_update AFTER UPDATE OF sport_type, duration_minutes, distance_km ON sport_sessions
WHEN OLD.sport_type IS NOT NEW.sport_type OR OLD.duration_minutes IS NOT NEW.duration_minutes OR OLD.distance_km IS NOT NEW.distance_km
BEGIN
 UPDATE daily_entries SET nutrition_estimate_stale = 1, nutrition_inputs_revision = nutrition_inputs_revision + 1 WHERE entry_id = NEW.entry_id;
END;
CREATE TRIGGER sport_nutrition_delete AFTER DELETE ON sport_sessions
WHEN OLD.sport_type IS NOT NULL OR OLD.duration_minutes IS NOT NULL OR OLD.distance_km IS NOT NULL
BEGIN
 UPDATE daily_entries SET nutrition_estimate_stale = 1, nutrition_inputs_revision = nutrition_inputs_revision + 1 WHERE entry_id = OLD.entry_id;
END;
