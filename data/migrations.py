from dataclasses import dataclass
from typing import Callable

import streamlit as st

from app_clock import timestamp_paris
from app_config import CHECKIN_DATA_STEP_COUNT, CHECKIN_VERSION, DEFAULT_SETTINGS
from performance_monitor import measure_performance


def _apply_current_schema(conn):
    from data_store import (
        add_column_if_missing, table_columns,
    )
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS daily_entries (
            entry_date TEXT PRIMARY KEY,
            alcohol_glasses INTEGER,
            sleep_hours REAL,
            sleep_bedtime TEXT,
            sleep_wake_time TEXT,
            work_hours REAL,
            work_travel TEXT,
            work_start_time TEXT,
            work_morning_end_time TEXT,
            work_afternoon_start_time TEXT,
            work_end_time TEXT,
            work_third_start_time TEXT,
            work_third_end_time TEXT,
            work_duration_hours REAL,
            weight_kg REAL,
            waist_cm REAL,
            belly_cm REAL,
            body_fat_pct REAL,
            sport_type TEXT,
            sport_hours REAL,
            phone_hours REAL,
            kcal INTEGER,
            sport_kcal_burned INTEGER,
            proteins_g REAL,
            carbs_g REAL,
            fats_g REAL,
            meal_breakfast TEXT,
            meal_lunch TEXT,
            meal_dinner TEXT,
            meal_other TEXT,
            me_time_writing_minutes INTEGER,
            me_time_meditation_minutes INTEGER,
            me_time_relaxation_minutes INTEGER,
            me_time_outings_minutes INTEGER,
            self_listening_score INTEGER,
            close_relations_listening_score INTEGER,
            nutrition_analysis_hash TEXT,
            nutrition_analysis_model TEXT,
            nutrition_analysis_confidence TEXT,
            nutrition_analysis_assumptions TEXT,
            nutrition_analyzed_at TEXT,
            checkin_completed_steps TEXT,
            checkin_skipped_steps TEXT,
            checkin_finished INTEGER,
            checkin_version INTEGER,
            updated_at TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS api_usage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_date TEXT,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            input_tokens INTEGER NOT NULL,
            cached_input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            estimated_cost_usd REAL NOT NULL,
            estimated_cost_eur REAL NOT NULL,
            usd_to_eur REAL NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    # Migration douce depuis la V1.
    daily_entry_columns = table_columns(conn, "daily_entries")
    for col_def in [
        "belly_cm REAL",
        "waist_cm REAL",
        "body_fat_pct REAL",
        "sport_type TEXT",
        "sleep_bedtime TEXT",
        "sleep_wake_time TEXT",
        "work_travel TEXT",
        "work_start_time TEXT",
        "work_morning_end_time TEXT",
        "work_afternoon_start_time TEXT",
        "work_end_time TEXT",
        "work_third_start_time TEXT",
        "work_third_end_time TEXT",
        "work_duration_hours REAL",
        "phone_hours REAL",
        "sport_kcal_burned INTEGER",
        "proteins_g REAL",
        "carbs_g REAL",
        "fats_g REAL",
        "meal_breakfast TEXT",
        "meal_lunch TEXT",
        "meal_dinner TEXT",
        "meal_other TEXT",
        "me_time_writing_minutes INTEGER",
        "me_time_meditation_minutes INTEGER",
        "me_time_relaxation_minutes INTEGER",
        "me_time_outings_minutes INTEGER",
        "self_listening_score INTEGER",
        "close_relations_listening_score INTEGER",
        "nutrition_analysis_hash TEXT",
        "nutrition_analysis_model TEXT",
        "nutrition_analysis_confidence TEXT",
        "nutrition_analysis_assumptions TEXT",
        "nutrition_analyzed_at TEXT",
        "checkin_completed_steps TEXT",
        "checkin_skipped_steps TEXT",
        "checkin_finished INTEGER",
        "checkin_version INTEGER",
    ]:
        add_column_if_missing(conn, "daily_entries", col_def, daily_entry_columns)

    # Si une ancienne donnée existe en waist_cm et pas en belly_cm, on la recopie.
    cur.execute("""
        UPDATE daily_entries
        SET belly_cm = waist_cm
        WHERE belly_cm IS NULL AND waist_cm IS NOT NULL
    """)

    # Migration douce : l'ancienne colonne work_hours reste la référence graphique.
    # La nouvelle colonne work_duration_hours reprend les anciennes durées si elle est vide.
    cur.execute("""
        UPDATE daily_entries
        SET work_duration_hours = work_hours
        WHERE work_duration_hours IS NULL AND work_hours IS NOT NULL
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            completed_at TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS goal_logs (
            entry_date TEXT NOT NULL,
            goal_id INTEGER NOT NULL,
            worked INTEGER DEFAULT 0,
            note TEXT,
            updated_at TEXT,
            PRIMARY KEY (entry_date, goal_id),
            FOREIGN KEY (goal_id) REFERENCES goals(id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS friends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            category TEXT DEFAULT 'Ami',
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS social_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_date TEXT NOT NULL,
            friend_id INTEGER NOT NULL,
            context TEXT,
            duration_hours REAL,
            note TEXT,
            updated_at TEXT,
            UNIQUE(entry_date, friend_id),
            FOREIGN KEY (friend_id) REFERENCES friends(id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS sport_sessions (
            entry_date TEXT NOT NULL,
            session_index INTEGER NOT NULL,
            sport_type TEXT NOT NULL,
            duration_minutes INTEGER,
            distance_km REAL,
            PRIMARY KEY (entry_date, session_index)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS checkin_progress (
            entry_date TEXT PRIMARY KEY,
            completed_steps TEXT NOT NULL DEFAULT '[]',
            skipped_steps TEXT NOT NULL DEFAULT '[]',
            finished INTEGER NOT NULL DEFAULT 0,
            version INTEGER NOT NULL DEFAULT 4,
            updated_at TEXT
        )
    """)
    add_column_if_missing(conn, "checkin_progress", "version INTEGER DEFAULT 1")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS todo_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS todo_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            due_date TEXT,
            priority TEXT NOT NULL DEFAULT 'Normale',
            completed INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'local',
            external_id TEXT,
            category_id INTEGER,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (category_id) REFERENCES todo_categories(id)
        )
    """)
    add_column_if_missing(conn, "todo_items", "category_id INTEGER")

    # Retire les lignes techniques qui ne contiennent plus aucune donnée métier.
    # Une valeur numérique à zéro reste une vraie donnée et n'est donc jamais supprimée.
    cur.execute("""
        DELETE FROM daily_entries
        WHERE alcohol_glasses IS NULL
          AND sleep_hours IS NULL
          AND NULLIF(TRIM(COALESCE(sleep_bedtime, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(sleep_wake_time, '')), '') IS NULL
          AND work_hours IS NULL
          AND work_duration_hours IS NULL
          AND NULLIF(TRIM(COALESCE(work_travel, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(work_start_time, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(work_morning_end_time, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(work_afternoon_start_time, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(work_end_time, '')), '') IS NULL
          AND weight_kg IS NULL
          AND waist_cm IS NULL
          AND belly_cm IS NULL
          AND body_fat_pct IS NULL
          AND NULLIF(TRIM(COALESCE(sport_type, '')), '') IS NULL
          AND sport_hours IS NULL
          AND phone_hours IS NULL
          AND kcal IS NULL
          AND sport_kcal_burned IS NULL
          AND proteins_g IS NULL
          AND carbs_g IS NULL
          AND fats_g IS NULL
          AND NULLIF(TRIM(COALESCE(meal_breakfast, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(meal_lunch, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(meal_dinner, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(meal_other, '')), '') IS NULL
          AND me_time_writing_minutes IS NULL
          AND me_time_meditation_minutes IS NULL
          AND me_time_relaxation_minutes IS NULL
          AND me_time_outings_minutes IS NULL
          AND self_listening_score IS NULL
          AND close_relations_listening_score IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM social_logs WHERE social_logs.entry_date = daily_entries.entry_date
          )
          AND NOT EXISTS (
              SELECT 1 FROM sport_sessions WHERE sport_sessions.entry_date = daily_entries.entry_date
          )
          AND NOT EXISTS (
              SELECT 1 FROM goal_logs WHERE goal_logs.entry_date = daily_entries.entry_date
          )
    """)

    for key, value in DEFAULT_SETTINGS.items():
        cur.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )


REQUIRED_SCHEMA = {
    "daily_entries": {
        "entry_date", "alcohol_glasses", "sleep_hours", "sleep_bedtime",
        "sleep_wake_time", "work_hours", "work_travel", "work_start_time",
        "work_morning_end_time", "work_afternoon_start_time", "work_end_time",
        "work_third_start_time", "work_third_end_time",
        "work_duration_hours", "weight_kg", "waist_cm", "belly_cm",
        "body_fat_pct", "sport_type", "sport_hours", "phone_hours", "kcal",
        "sport_kcal_burned", "proteins_g", "carbs_g", "fats_g",
        "meal_breakfast", "meal_lunch", "meal_dinner", "meal_other",
        "me_time_writing_minutes", "me_time_meditation_minutes",
        "me_time_relaxation_minutes", "me_time_outings_minutes",
        "self_listening_score", "close_relations_listening_score",
        "nutrition_analysis_hash", "nutrition_analysis_model",
        "nutrition_analysis_confidence", "nutrition_analysis_assumptions",
        "nutrition_analyzed_at", "checkin_completed_steps",
        "checkin_skipped_steps", "checkin_finished", "checkin_version", "updated_at",
    },
    "api_usage_logs": {
        "id", "entry_date", "provider", "model", "input_tokens",
        "cached_input_tokens", "output_tokens", "estimated_cost_usd",
        "estimated_cost_eur", "usd_to_eur", "created_at",
    },
    "goals": {"id", "title", "active", "created_at", "completed_at"},
    "goal_logs": {"entry_date", "goal_id", "worked", "note", "updated_at"},
    "friends": {"id", "name", "category", "active", "created_at"},
    "social_logs": {"id", "entry_date", "friend_id", "context", "duration_hours", "note", "updated_at"},
    "settings": {"key", "value"},
    "sport_sessions": {"entry_date", "session_index", "sport_type", "duration_minutes", "distance_km"},
    "checkin_progress": {"entry_date", "completed_steps", "skipped_steps", "finished", "version", "updated_at"},
    "todo_categories": {"id", "name", "created_at"},
    "todo_items": {"id", "title", "due_date", "priority", "completed", "source", "external_id", "category_id", "created_at", "completed_at", "updated_at"},
}


def _current_schema_is_complete(conn):
    from data_store import table_columns

    return all(
        required_columns.issubset(table_columns(conn, table_name))
        for table_name, required_columns in REQUIRED_SCHEMA.items()
    )


def _remove_legacy_schema_marker(conn):
    conn.execute("DELETE FROM settings WHERE key = '__schema_version'")


def _legacy_marker_removed(conn):
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM settings WHERE key = '__schema_version'")
    return cur.fetchone() is None


def _add_nap_minutes(conn):
    from data_store import add_column_if_missing

    add_column_if_missing(conn, "daily_entries", "nap_minutes INTEGER")


def _nap_minutes_exists(conn):
    from data_store import table_columns

    return "nap_minutes" in table_columns(conn, "daily_entries")


def _add_third_work_slot(conn):
    from data_store import add_column_if_missing

    add_column_if_missing(conn, "daily_entries", "work_third_start_time TEXT")
    add_column_if_missing(conn, "daily_entries", "work_third_end_time TEXT")


def _third_work_slot_exists(conn):
    from data_store import table_columns

    columns = table_columns(conn, "daily_entries")
    return {"work_third_start_time", "work_third_end_time"}.issubset(columns)


def _migrate_close_relations_score(conn):
    """Ajoute le champ générique et reprend un éventuel ancien champ équivalent."""
    from data_store import add_column_if_missing, table_columns

    add_column_if_missing(conn, "daily_entries", "close_relations_listening_score INTEGER")
    columns = table_columns(conn, "daily_entries")
    legacy_candidates = sorted(
        column for column in columns
        if column.endswith("_listening_score")
        and column not in {"self_listening_score", "close_relations_listening_score"}
    )
    if len(legacy_candidates) == 1:
        legacy_column = legacy_candidates[0].replace('"', '""')
        conn.execute(
            f'UPDATE daily_entries '
            f'SET close_relations_listening_score = "{legacy_column}" '
            f'WHERE close_relations_listening_score IS NULL'
        )


def _close_relations_score_exists(conn):
    from data_store import table_columns

    return "close_relations_listening_score" in table_columns(conn, "daily_entries")


@dataclass(frozen=True)
class Migration:
    migration_id: str
    checksum: str
    apply: Callable
    verify: Callable


MIGRATIONS = (
    Migration("20260809_001_current_schema", "current-schema-2026-08-09-v1", _apply_current_schema, _current_schema_is_complete),
    Migration("20260809_002_remove_legacy_marker", "remove-legacy-schema-marker-v1", _remove_legacy_schema_marker, _legacy_marker_removed),
    Migration("20260809_003_add_nap_minutes", "add-nap-minutes-v1", _add_nap_minutes, _nap_minutes_exists),
    Migration("20260812_004_add_third_work_slot", "add-third-work-slot-v1", _add_third_work_slot, _third_work_slot_exists),
    Migration("20260824_005_generic_relations_score", "generic-relations-score-v1", _migrate_close_relations_score, _close_relations_score_exists),
)


def _create_migration_journal(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            migration_id TEXT PRIMARY KEY,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
    """)
    conn.commit()
    from data_store import table_columns

    expected = {"migration_id", "checksum", "applied_at"}
    missing = expected - table_columns(conn, "schema_migrations")
    if missing:
        raise RuntimeError(
            "La table schema_migrations est incomplète : " + ", ".join(sorted(missing))
        )


def _stored_migration(conn, migration_id):
    cur = conn.cursor()
    cur.execute("SELECT checksum FROM schema_migrations WHERE migration_id = ?", (migration_id,))
    return cur.fetchone()


def _run_migration(conn, migration, use_postgres):
    stored = _stored_migration(conn, migration.migration_id)
    if stored and stored[0] != migration.checksum:
        raise RuntimeError(f"La migration {migration.migration_id} a changé après son exécution.")
    if stored and migration.verify(conn):
        return

    conn.commit()
    if use_postgres:
        conn.execute("SELECT pg_advisory_xact_lock(2026080906)")
    else:
        conn.execute("BEGIN IMMEDIATE")
    try:
        # Le verrou évite que deux instances Streamlit migrent Neon simultanément.
        stored = _stored_migration(conn, migration.migration_id)
        if stored and stored[0] != migration.checksum:
            raise RuntimeError(f"La migration {migration.migration_id} a changé après son exécution.")
        if not (stored and migration.verify(conn)):
            migration.apply(conn)
            if not migration.verify(conn):
                raise RuntimeError(f"La migration {migration.migration_id} n'a pas produit le schéma attendu.")
            conn.execute(
                """
                INSERT INTO schema_migrations (migration_id, checksum, applied_at)
                VALUES (?, ?, ?)
                ON CONFLICT(migration_id) DO UPDATE SET
                    checksum = excluded.checksum,
                    applied_at = excluded.applied_at
                """,
                (migration.migration_id, migration.checksum, timestamp_paris()),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


@st.cache_resource
@measure_performance("Base · initialisation du schéma")
def init_db():
    from data_store import USE_POSTGRES, get_conn

    conn = get_conn()
    try:
        _create_migration_journal(conn)
        for migration in MIGRATIONS:
            _run_migration(conn, migration, USE_POSTGRES)
    finally:
        conn.close()
