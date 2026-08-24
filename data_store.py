import json
import os
import sqlite3
import time
from datetime import date
from pathlib import Path

import pandas as pd
import streamlit as st

try:
    from sqlalchemy import create_engine, text
except ImportError:
    create_engine = text = None

from app_config import CHECKIN_DATA_STEP_COUNT, CHECKIN_VERSION, DEFAULT_SETTINGS
from app_clock import timestamp_paris
from performance_monitor import measure_performance, record_performance


DB_PATH = Path("life_dashboard.sqlite")


def get_database_url():
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url
    try:
        return str(st.secrets.get("DATABASE_URL", "")).strip()
    except Exception:
        return ""

DATABASE_URL = get_database_url()
USE_POSTGRES = bool(DATABASE_URL)


@st.cache_resource
@measure_performance("Base · création du pool Neon")
def get_postgres_engine(database_url: str):
    if create_engine is None:
        raise RuntimeError("Les dépendances PostgreSQL ne sont pas installées. Lance pip install -r requirements.txt.")
    sqlalchemy_url = database_url
    if sqlalchemy_url.startswith("postgresql://"):
        sqlalchemy_url = sqlalchemy_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return create_engine(
        sqlalchemy_url,
        pool_pre_ping=False,
        pool_recycle=180,
        pool_use_lifo=True,
        pool_size=3,
        max_overflow=2,
    )

def _postgres_query(query: str, params=()):
    sql = query.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
    sql = sql.replace("f.name COLLATE NOCASE", "LOWER(f.name)")
    sql = sql.replace("name COLLATE NOCASE", "LOWER(name)")
    if sql.lstrip().upper().startswith("INSERT OR IGNORE INTO"):
        sql = sql.replace("INSERT OR IGNORE INTO", "INSERT INTO", 1).rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"
    if not params:
        return sql, {}
    pieces = sql.split("?")
    if len(pieces) - 1 != len(params):
        raise ValueError("Le nombre de paramètres SQL ne correspond pas à la requête.")
    bind = {}
    rebuilt = [pieces[0]]
    for index, value in enumerate(params):
        key = f"p{index}"
        bind[key] = value
        rebuilt.extend((f":{key}", pieces[index + 1]))
    return "".join(rebuilt), bind

class PostgresCursor:
    def __init__(self, connection):
        self.connection = connection
        self.result = None

    def execute(self, query, params=()):
        started = time.perf_counter()
        try:
            sql, bind = _postgres_query(query, params)
            self.result = self.connection.raw.execute(text(sql), bind)
            return self
        finally:
            record_performance("Base · écriture/requête SQL", (time.perf_counter() - started) * 1000)

    def fetchone(self):
        return self.result.fetchone() if self.result is not None else None

    def fetchall(self):
        return self.result.fetchall() if self.result is not None else []

class PostgresConnection:
    def __init__(self, raw):
        self.raw = raw

    def cursor(self):
        return PostgresCursor(self)

    def execute(self, query, params=()):
        return self.cursor().execute(query, params)

    def commit(self):
        self.raw.commit()

    def rollback(self):
        self.raw.rollback()

    def close(self):
        self.raw.close()

@measure_performance("Base · connexion")
def get_conn():
    if USE_POSTGRES:
        return PostgresConnection(get_postgres_engine(DATABASE_URL).connect())
    return sqlite3.connect(DB_PATH)

def read_sql_query(query, conn, params=()):
    started = time.perf_counter()
    try:
        if isinstance(conn, PostgresConnection):
            sql, bind = _postgres_query(query, params)
            return pd.read_sql_query(text(sql), conn.raw, params=bind)
        return pd.read_sql_query(query, conn, params=params or None)
    finally:
        record_performance("Base · lecture SQL", (time.perf_counter() - started) * 1000)

def table_columns(conn, table_name):
    if isinstance(conn, PostgresConnection):
        cur = conn.cursor()
        cur.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?",
            (table_name,),
        )
        return {row[0] for row in cur.fetchall()}
    cur = conn.cursor()
    cur.execute(f"PRAGMA table_info({table_name})")
    return {row[1] for row in cur.fetchall()}

def add_column_if_missing(conn, table_name, col_def, known_columns=None):
    col_name = col_def.split()[0]
    columns = known_columns if known_columns is not None else table_columns(conn, table_name)
    if col_name not in columns:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {col_def}")
        columns.add(col_name)

from data.migrations import init_db

@measure_performance("Chargement · Todo")
def load_todo_items():
    conn = get_conn()
    df = read_sql_query(
        """
        SELECT ti.id, ti.title, ti.due_date, ti.priority, ti.completed, ti.source,
               ti.external_id, ti.category_id, tc.name AS category_name,
               ti.created_at, ti.completed_at, ti.updated_at
        FROM todo_items ti
        LEFT JOIN todo_categories tc ON tc.id = ti.category_id
        ORDER BY ti.completed ASC,
                 CASE WHEN due_date IS NULL OR due_date = '' THEN 1 ELSE 0 END,
                 ti.due_date ASC,
                 ti.id DESC
        """,
        conn,
    )
    conn.close()
    return df


def load_unmigrated_todo_items():
    conn = get_conn()
    df = read_sql_query(
        """
        SELECT ti.id, ti.title, ti.due_date, ti.priority, ti.completed,
               ti.category_id, tc.name AS category_name
        FROM todo_items ti
        LEFT JOIN todo_categories tc ON tc.id = ti.category_id
        WHERE COALESCE(ti.external_id, '') = ''
          AND COALESCE(ti.source, 'local') = 'local'
        ORDER BY ti.id
        """,
        conn,
    )
    conn.close()
    return df


def mark_todo_item_migrated(item_id: int, external_id: str):
    conn = get_conn()
    conn.execute(
        """
        UPDATE todo_items
        SET source = 'todoist', external_id = ?, updated_at = ?
        WHERE id = ?
        """,
        (str(external_id), timestamp_paris(), int(item_id)),
    )
    conn.commit()
    conn.close()


@measure_performance("Sauvegarde · nouvelle tâche")
def create_todo_item(title: str, due_date=None, priority: str = "Normale", category_id=None):
    clean_title = str(title or "").strip()
    if not clean_title:
        raise ValueError("Le titre de la tâche est obligatoire.")
    now = timestamp_paris()
    due_value = due_date.isoformat() if hasattr(due_date, "isoformat") else (str(due_date).strip() or None if due_date else None)
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO todo_items
            (title, due_date, priority, completed, source, category_id, created_at, updated_at)
        VALUES (?, ?, ?, 0, 'local', ?, ?, ?)
        """,
        (clean_title, due_value, priority, int(category_id) if category_id else None, now, now),
    )
    conn.commit()
    conn.close()


@measure_performance("Sauvegarde · état d'une tâche")
def set_todo_completed(item_id: int, completed: bool):
    now = timestamp_paris()
    conn = get_conn()
    conn.execute(
        """
        UPDATE todo_items
        SET completed = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
        """,
        (int(bool(completed)), now if completed else None, now, int(item_id)),
    )
    conn.commit()
    conn.close()


@measure_performance("Suppression · tâche")
def delete_todo_item(item_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM todo_items WHERE id = ?", (int(item_id),))
    conn.commit()
    conn.close()


def load_todo_categories():
    conn = get_conn()
    df = read_sql_query("SELECT id, name, created_at FROM todo_categories ORDER BY LOWER(name)", conn)
    conn.close()
    return df


def create_todo_category(name: str):
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ValueError("Le nom de la catégorie est obligatoire.")
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT OR IGNORE INTO todo_categories (name, created_at) VALUES (?, ?)",
        (clean_name, timestamp_paris()),
    )
    cur.execute("SELECT id FROM todo_categories WHERE name = ?", (clean_name,))
    row = cur.fetchone()
    conn.commit()
    conn.close()
    return int(row[0]) if row else None


def set_todo_category(item_id: int, category_id=None):
    conn = get_conn()
    conn.execute(
        "UPDATE todo_items SET category_id = ?, updated_at = ? WHERE id = ?",
        (
            int(category_id) if category_id else None,
            timestamp_paris(),
            int(item_id),
        ),
    )
    conn.commit()
    conn.close()


def delete_todo_category(category_id: int):
    conn = get_conn()
    conn.execute("UPDATE todo_items SET category_id = NULL WHERE category_id = ?", (int(category_id),))
    conn.execute("DELETE FROM todo_categories WHERE id = ?", (int(category_id),))
    conn.commit()
    conn.close()

@st.cache_data(ttl=300)
def load_settings():
    conn = get_conn()
    df = read_sql_query("SELECT key, value FROM settings", conn)
    conn.close()
    settings = DEFAULT_SETTINGS.copy()
    if not df.empty:
        settings.update(dict(zip(df["key"], df["value"])))
    return settings

def save_setting(key: str, value):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, "" if value is None else str(value)),
    )
    conn.commit()
    conn.close()
    load_settings.clear()

def load_entries():
    conn = get_conn()
    df = read_sql_query("SELECT * FROM daily_entries ORDER BY entry_date", conn)
    conn.close()
    if not df.empty:
        df["entry_date"] = pd.to_datetime(df["entry_date"]).dt.date
    return df


@measure_performance("Lecture - solde travail avant journee")
def load_work_entries_before(entry_date: date):
    """Charge les journees de travail anterieures a la date selectionnee."""
    conn = get_conn()
    try:
        return read_sql_query(
            """
            SELECT entry_date, work_travel, work_hours, work_duration_hours
            FROM daily_entries
            WHERE entry_date < ?
            ORDER BY entry_date
            """,
            conn,
            params=(entry_date.isoformat(),),
        )
    finally:
        conn.close()

@measure_performance("Chargement · journée")
def load_entry(entry_date: date, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    df = read_sql_query(
        "SELECT * FROM daily_entries WHERE entry_date = ?",
        conn,
        params=(entry_date.isoformat(),),
    )
    if owns_connection:
        conn.close()
    if df.empty:
        return None
    return df.iloc[0].to_dict()

@measure_performance("Chargement · dernières mesures")
def load_last_body_measurements(entry_date: date, conn=None):
    """Retourne la dernière mesure connue avant la date sélectionnée, champ par champ."""
    owns_connection = conn is None
    conn = conn or get_conn()
    selected = entry_date.isoformat()
    row = conn.execute(
        """
        SELECT
            (SELECT weight_kg FROM daily_entries WHERE entry_date < ? AND weight_kg IS NOT NULL ORDER BY entry_date DESC LIMIT 1),
            (SELECT body_fat_pct FROM daily_entries WHERE entry_date < ? AND body_fat_pct IS NOT NULL ORDER BY entry_date DESC LIMIT 1),
            (SELECT belly_cm FROM daily_entries WHERE entry_date < ? AND belly_cm IS NOT NULL ORDER BY entry_date DESC LIMIT 1)
        """,
        (selected, selected, selected),
    ).fetchone()
    if owns_connection:
        conn.close()
    return dict(zip(("weight_kg", "body_fat_pct", "belly_cm"), row or (None, None, None)))

@measure_performance("Sauvegarde · journée + progression")
def save_entry(data: dict, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    cur = conn.cursor()

    cur.execute("""
        INSERT INTO daily_entries (
            entry_date, alcohol_glasses, sleep_hours, sleep_bedtime, sleep_wake_time, nap_minutes, work_hours,
            work_travel, work_start_time, work_morning_end_time, work_afternoon_start_time,
            work_end_time, work_third_start_time, work_third_end_time, work_duration_hours,
            weight_kg, waist_cm, belly_cm, body_fat_pct, sport_type, sport_hours, phone_hours,
            kcal, sport_kcal_burned, proteins_g, carbs_g, fats_g, meal_breakfast, meal_lunch, meal_dinner, meal_other,
            me_time_writing_minutes, me_time_meditation_minutes, me_time_relaxation_minutes, me_time_outings_minutes,
            self_listening_score, close_relations_listening_score,
            checkin_completed_steps, checkin_skipped_steps, checkin_finished, checkin_version, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entry_date) DO UPDATE SET
            alcohol_glasses = excluded.alcohol_glasses,
            sleep_hours = excluded.sleep_hours,
            sleep_bedtime = excluded.sleep_bedtime,
            sleep_wake_time = excluded.sleep_wake_time,
            nap_minutes = excluded.nap_minutes,
            work_hours = excluded.work_hours,
            work_travel = excluded.work_travel,
            work_start_time = excluded.work_start_time,
            work_morning_end_time = excluded.work_morning_end_time,
            work_afternoon_start_time = excluded.work_afternoon_start_time,
            work_end_time = excluded.work_end_time,
            work_third_start_time = excluded.work_third_start_time,
            work_third_end_time = excluded.work_third_end_time,
            work_duration_hours = excluded.work_duration_hours,
            weight_kg = excluded.weight_kg,
            waist_cm = excluded.waist_cm,
            belly_cm = excluded.belly_cm,
            body_fat_pct = excluded.body_fat_pct,
            sport_type = excluded.sport_type,
            sport_hours = excluded.sport_hours,
            phone_hours = excluded.phone_hours,
            kcal = excluded.kcal,
            sport_kcal_burned = excluded.sport_kcal_burned,
            proteins_g = excluded.proteins_g,
            carbs_g = excluded.carbs_g,
            fats_g = excluded.fats_g,
            meal_breakfast = excluded.meal_breakfast,
            meal_lunch = excluded.meal_lunch,
            meal_dinner = excluded.meal_dinner,
            meal_other = excluded.meal_other,
            me_time_writing_minutes = excluded.me_time_writing_minutes,
            me_time_meditation_minutes = excluded.me_time_meditation_minutes,
            me_time_relaxation_minutes = excluded.me_time_relaxation_minutes,
            me_time_outings_minutes = excluded.me_time_outings_minutes,
            self_listening_score = excluded.self_listening_score,
            close_relations_listening_score = excluded.close_relations_listening_score,
            checkin_completed_steps = excluded.checkin_completed_steps,
            checkin_skipped_steps = excluded.checkin_skipped_steps,
            checkin_finished = excluded.checkin_finished,
            checkin_version = excluded.checkin_version,
            updated_at = excluded.updated_at
    """, (
        data["entry_date"],
        data["alcohol_glasses"],
        data["sleep_hours"],
        data.get("sleep_bedtime"),
        data.get("sleep_wake_time"),
        data.get("nap_minutes"),
        data["work_hours"],
        data["work_travel"],
        data["work_start_time"],
        data["work_morning_end_time"],
        data["work_afternoon_start_time"],
        data["work_end_time"],
        data.get("work_third_start_time"),
        data.get("work_third_end_time"),
        data["work_duration_hours"],
        data["weight_kg"],
        data["waist_cm"],
        data["belly_cm"],
        data["body_fat_pct"],
        data.get("sport_type"),
        data["sport_hours"],
        data["phone_hours"],
        data["kcal"],
        data.get("sport_kcal_burned"),
        data["proteins_g"],
        data["carbs_g"],
        data["fats_g"],
        data.get("meal_breakfast"),
        data.get("meal_lunch"),
        data.get("meal_dinner"),
        data.get("meal_other"),
        data.get("me_time_writing_minutes"),
        data.get("me_time_meditation_minutes"),
        data.get("me_time_relaxation_minutes"),
        data.get("me_time_outings_minutes"),
        data.get("self_listening_score"),
        data.get("close_relations_listening_score"),
        data.get("checkin_completed_steps"),
        data.get("checkin_skipped_steps"),
        data.get("checkin_finished"),
        data.get("checkin_version", CHECKIN_VERSION),
        timestamp_paris(),
    ))

    if owns_connection:
        conn.commit()
        conn.close()

def delete_entry(entry_date: date):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM daily_entries WHERE entry_date = ?", (entry_date.isoformat(),))
    conn.commit()
    conn.close()


@measure_performance("Sauvegarde · analyse nutritionnelle")
def save_nutrition_analysis(entry_date: date, estimate, source_hash: str, model: str, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    conn.execute(
        """
        UPDATE daily_entries
        SET kcal = ?, sport_kcal_burned = ?, proteins_g = ?, carbs_g = ?, fats_g = ?,
            nutrition_analysis_hash = ?, nutrition_analysis_model = ?,
            nutrition_analysis_confidence = ?, nutrition_analysis_assumptions = ?,
            nutrition_analyzed_at = ?, updated_at = ?
        WHERE entry_date = ?
        """,
        (
            int(estimate.kcal),
            int(estimate.sport_kcal_burned),
            float(estimate.proteins_g),
            float(estimate.carbs_g),
            float(estimate.fats_g),
            source_hash,
            model,
            str(estimate.confidence),
            json.dumps(estimate.assumptions, ensure_ascii=False),
            timestamp_paris(),
            timestamp_paris(),
            entry_date.isoformat(),
        ),
    )
    if owns_connection:
        conn.commit()
        conn.close()


def clear_nutrition_analysis(entry_date: date, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    conn.execute(
        """
        UPDATE daily_entries
        SET kcal = NULL, sport_kcal_burned = NULL, proteins_g = NULL, carbs_g = NULL, fats_g = NULL,
            nutrition_analysis_hash = NULL, nutrition_analysis_model = NULL,
            nutrition_analysis_confidence = NULL, nutrition_analysis_assumptions = NULL,
            nutrition_analyzed_at = NULL
        WHERE entry_date = ?
        """,
        (entry_date.isoformat(),),
    )
    if owns_connection:
        conn.commit()
        conn.close()


def save_api_usage(entry_date: date, model: str, usage, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    conn.execute(
        """
        INSERT INTO api_usage_logs (
            entry_date, provider, model, input_tokens, cached_input_tokens,
            output_tokens, estimated_cost_usd, estimated_cost_eur, usd_to_eur, created_at
        ) VALUES (?, 'OpenAI', ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entry_date.isoformat(),
            model,
            int(usage.input_tokens),
            int(usage.cached_input_tokens),
            int(usage.output_tokens),
            float(usage.cost_usd),
            float(usage.cost_eur),
            float(usage.usd_to_eur),
            timestamp_paris(),
        ),
    )
    if owns_connection:
        conn.commit()
        conn.close()


def load_api_usage_logs():
    conn = get_conn()
    df = read_sql_query(
        "SELECT * FROM api_usage_logs ORDER BY created_at DESC",
        conn,
    )
    conn.close()
    return df

@st.cache_data(ttl=120)
def load_goals(active_only=False):
    conn = get_conn()
    query = "SELECT * FROM goals"
    if active_only:
        query += " WHERE active = 1"
    query += " ORDER BY active DESC, created_at DESC"
    df = read_sql_query(query, conn)
    conn.close()
    return df

def create_goal(title: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO goals (title, active, created_at) VALUES (?, 1, ?)",
        (title.strip(), timestamp_paris()),
    )
    conn.commit()
    conn.close()
    load_goals.clear()

def complete_goal(goal_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "UPDATE goals SET active = 0, completed_at = ? WHERE id = ?",
        (timestamp_paris(), goal_id),
    )
    conn.commit()
    conn.close()
    load_goals.clear()

def reactivate_goal(goal_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "UPDATE goals SET active = 1, completed_at = NULL WHERE id = ?",
        (goal_id,),
    )
    conn.commit()
    conn.close()
    load_goals.clear()

@measure_performance("Chargement · objectifs")
def load_goal_logs(entry_date: date, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    df = read_sql_query(
        "SELECT * FROM goal_logs WHERE entry_date = ?",
        conn,
        params=(entry_date.isoformat(),),
    )
    if owns_connection:
        conn.close()
    return df

def save_goal_log(entry_date: date, goal_id: int, worked: bool, note: str = "", conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO goal_logs (entry_date, goal_id, worked, note, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(entry_date, goal_id) DO UPDATE SET
            worked = excluded.worked,
            note = excluded.note,
            updated_at = excluded.updated_at
    """, (
        entry_date.isoformat(),
        int(goal_id),
        1 if worked else 0,
        note,
        timestamp_paris(),
    ))
    if owns_connection:
        conn.commit()
        conn.close()

def delete_goal_log(entry_date: date, goal_id: int, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM goal_logs WHERE entry_date = ? AND goal_id = ?",
        (entry_date.isoformat(), int(goal_id)),
    )
    if owns_connection:
        conn.commit()
        conn.close()


def delete_goal_logs_for_date(entry_date: date, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    conn.execute(
        "DELETE FROM goal_logs WHERE entry_date = ?",
        (entry_date.isoformat(),),
    )
    if owns_connection:
        conn.commit()
        conn.close()

def load_goal_logs_all():
    conn = get_conn()
    df = read_sql_query("""
        SELECT gl.entry_date, gl.goal_id, gl.worked, gl.note, g.title, g.active
        FROM goal_logs gl
        JOIN goals g ON g.id = gl.goal_id
        ORDER BY gl.entry_date DESC
    """, conn)
    conn.close()
    if not df.empty:
        df["entry_date"] = pd.to_datetime(df["entry_date"]).dt.date
    return df

@st.cache_data(ttl=120)
def load_friends(active_only=False):
    conn = get_conn()
    query = "SELECT * FROM friends"
    if active_only:
        query += " WHERE active = 1"
    query += " ORDER BY name COLLATE NOCASE"
    df = read_sql_query(query, conn)
    conn.close()
    return df

def create_friend(name: str, category: str = "Ami"):
    clean_name = name.strip()
    if not clean_name:
        return None
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT OR IGNORE INTO friends (name, category, active, created_at)
        VALUES (?, ?, 1, ?)
    """, (clean_name, category.strip() or "Ami", timestamp_paris()))
    cur.execute("SELECT id FROM friends WHERE name = ?", (clean_name,))
    friend_id = cur.fetchone()[0]
    conn.commit()
    conn.close()
    load_friends.clear()
    return int(friend_id)

def update_friend_active(friend_id: int, active: bool):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("UPDATE friends SET active = ? WHERE id = ?", (1 if active else 0, int(friend_id)))
    conn.commit()
    conn.close()
    load_friends.clear()

def load_social_logs(entry_date: date | None = None, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    if entry_date is None:
        df = read_sql_query("""
            SELECT sl.id, sl.entry_date, sl.friend_id, f.name, f.category,
                   sl.context, sl.duration_hours, sl.note, sl.updated_at
            FROM social_logs sl
            JOIN friends f ON f.id = sl.friend_id
            ORDER BY sl.entry_date DESC, f.name COLLATE NOCASE
        """, conn)
    else:
        df = read_sql_query("""
            SELECT sl.id, sl.entry_date, sl.friend_id, f.name, f.category,
                   sl.context, sl.duration_hours, sl.note, sl.updated_at
            FROM social_logs sl
            JOIN friends f ON f.id = sl.friend_id
            WHERE sl.entry_date = ?
            ORDER BY f.name COLLATE NOCASE
        """, conn, params=(entry_date.isoformat(),))
    if owns_connection:
        conn.close()
    if not df.empty:
        df["entry_date"] = pd.to_datetime(df["entry_date"]).dt.date
    return df

@measure_performance("Sauvegarde · social")
def save_social_logs_for_date(entry_date: date, friend_ids: list[int], context: str, duration_hours, note: str, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM social_logs WHERE entry_date = ?", (entry_date.isoformat(),))
    for friend_id in friend_ids:
        cur.execute("""
            INSERT INTO social_logs (entry_date, friend_id, context, duration_hours, note, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            entry_date.isoformat(),
            int(friend_id),
            context,
            duration_hours,
            note,
            timestamp_paris(),
        ))
    if owns_connection:
        conn.commit()
        conn.close()

@measure_performance("Chargement · sport")
def load_sport_sessions(entry_date: date, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    df = read_sql_query(
        "SELECT * FROM sport_sessions WHERE entry_date = ? ORDER BY session_index",
        conn,
        params=(entry_date.isoformat(),),
    )
    if owns_connection:
        conn.close()
    return df

@measure_performance("Sauvegarde · sport")
def save_sport_sessions(entry_date: date, sessions: list[dict], conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM sport_sessions WHERE entry_date = ?", (entry_date.isoformat(),))
    for index, session in enumerate(sessions[:3], start=1):
        cur.execute(
            """
            INSERT INTO sport_sessions (entry_date, session_index, sport_type, duration_minutes, distance_km)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                entry_date.isoformat(),
                index,
                session["sport_type"],
                session.get("duration_minutes"),
                session.get("distance_km"),
            ),
        )
    if owns_connection:
        conn.commit()
        conn.close()

@measure_performance("Chargement · progression")
def load_checkin_progress(entry_date: date, conn=None):
    owns_connection = conn is None
    conn = conn or get_conn()
    row = conn.execute(
        "SELECT completed_steps, skipped_steps, finished, version FROM checkin_progress WHERE entry_date = ?",
        (entry_date.isoformat(),),
    ).fetchone()
    if owns_connection:
        conn.close()
    if row is None:
        return None
    return {
        "completed": set(json.loads(row[0] or "[]")),
        "skipped": set(json.loads(row[1] or "[]")),
        "finished": bool(row[2]),
        "version": int(row[3] or 1),
    }

def progress_from_daily_entry(existing):
    if not existing or existing.get("checkin_completed_steps") is None:
        return None
    return {
        "completed": set(json.loads(existing.get("checkin_completed_steps") or "[]")),
        "skipped": set(json.loads(existing.get("checkin_skipped_steps") or "[]")),
        "finished": bool(existing.get("checkin_finished")),
        "version": int(existing.get("checkin_version") or CHECKIN_VERSION),
    }

@measure_performance("Chargement · contexte quotidien complet")
def load_checkin_context(entry_date: date):
    """Charge toutes les données d'une date avec une seule connexion au pool Neon."""
    conn = get_conn()
    try:
        existing = load_entry(entry_date, conn=conn)
        progress = progress_from_daily_entry(existing)
        if progress is None:
            progress = load_checkin_progress(entry_date, conn=conn)
        if progress is None and existing is None:
            progress = {"completed": set(), "skipped": set(), "finished": False, "version": CHECKIN_VERSION}
        needs_legacy_inference = progress is None
        return {
            "existing": existing,
            "last_body_measurements": None,
            "social": load_social_logs(entry_date, conn=conn) if needs_legacy_inference else None,
            "sport_sessions": load_sport_sessions(entry_date, conn=conn) if needs_legacy_inference else None,
            "goal_logs": load_goal_logs(entry_date, conn=conn) if needs_legacy_inference else None,
            "progress": progress,
        }
    finally:
        conn.close()

@measure_performance("Sauvegarde · progression")
def save_checkin_progress(entry_date: date, completed, skipped, conn=None):
    completed_set = {int(step) for step in completed}
    skipped_set = {int(step) for step in skipped}
    finished = set(range(CHECKIN_DATA_STEP_COUNT)).issubset(completed_set | skipped_set)
    owns_connection = conn is None
    conn = conn or get_conn()
    conn.execute(
        """
        INSERT INTO checkin_progress (entry_date, completed_steps, skipped_steps, finished, version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(entry_date) DO UPDATE SET
            completed_steps = excluded.completed_steps,
            skipped_steps = excluded.skipped_steps,
            finished = excluded.finished,
            version = excluded.version,
            updated_at = excluded.updated_at
        """,
        (
            entry_date.isoformat(),
            json.dumps(sorted(completed_set)),
            json.dumps(sorted(skipped_set)),
            1 if finished else 0,
            CHECKIN_VERSION,
            timestamp_paris(),
        ),
    )
    if owns_connection:
        conn.commit()
        conn.close()
    return finished
