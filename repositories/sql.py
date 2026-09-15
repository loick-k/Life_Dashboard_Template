from __future__ import annotations

from datetime import date
from typing import Callable

from domain.models import SportSession


ENTRY_FIELDS = {
    "sleep_hours", "sleep_bedtime", "sleep_wake_time", "nap_minutes",
    "alcohol_glasses", "weight_kg", "body_fat_pct", "belly_cm", "waist_cm",
    "work_travel", "work_start_time", "work_morning_end_time",
    "work_afternoon_start_time", "work_end_time", "work_third_start_time",
    "work_third_end_time", "work_duration_hours", "work_hours", "sport_type",
    "sport_hours", "phone_hours", "meal_breakfast", "meal_lunch", "meal_dinner",
    "meal_other", "me_time_writing_minutes", "me_time_meditation_minutes",
    "me_time_relaxation_minutes", "me_time_outings_minutes",
    "self_listening_score", "close_relations_listening_score",
}


class SqlRepository:
    def __init__(self, connection_factory: Callable):
        self._connection_factory = connection_factory

    def _write(self, operation):
        conn = self._connection_factory()
        try:
            result = operation(conn)
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


class SqlDailyEntryRepository(SqlRepository):
    def get(self, entry_date: date) -> dict | None:
        conn = self._connection_factory()
        try:
            cursor = conn.execute("SELECT * FROM daily_entries WHERE entry_date = ?", (entry_date.isoformat(),))
            row = cursor.fetchone()
            return None if row is None else dict(zip((column[0] for column in cursor.description), row))
        finally:
            conn.close()

    def update_fields(self, entry_date: date, fields: dict) -> None:
        unknown = set(fields) - ENTRY_FIELDS
        if unknown:
            raise ValueError("Champs non autorisés : " + ", ".join(sorted(unknown)))
        if not fields:
            return

        def operation(conn):
            conn.execute(
                "INSERT INTO daily_entries (entry_date) VALUES (?) ON CONFLICT(entry_date) DO NOTHING",
                (entry_date.isoformat(),),
            )
            assignments = ", ".join(f'"{field}" = ?' for field in fields)
            conn.execute(
                f"UPDATE daily_entries SET {assignments} WHERE entry_date = ?",
                (*fields.values(), entry_date.isoformat()),
            )
        self._write(operation)


class SqlSportRepository(SqlRepository):
    def list_for_date(self, entry_date: date) -> list[SportSession]:
        conn = self._connection_factory()
        try:
            rows = conn.execute(
                "SELECT session_id, sport_type, duration_minutes, distance_km FROM sport_sessions WHERE entry_date = ? ORDER BY session_index",
                (entry_date.isoformat(),),
            ).fetchall()
            return [SportSession(session_id=row[0], sport_type=row[1], duration_minutes=row[2] or 0, distance_km=row[3]) for row in rows]
        finally:
            conn.close()

    def upsert(self, entry_date: date, session: SportSession, position: int) -> None:
        def operation(conn):
            updated = conn.execute(
                "UPDATE sport_sessions SET sport_type = ?, duration_minutes = ?, distance_km = ? WHERE entry_date = ? AND session_id = ?",
                (session.sport_type, session.duration_minutes, session.distance_km, entry_date.isoformat(), str(session.session_id)),
            ).rowcount
            if not updated:
                conn.execute(
                    "INSERT INTO sport_sessions (entry_date, session_index, session_id, sport_type, duration_minutes, distance_km) VALUES (?, ?, ?, ?, ?, ?)",
                    (entry_date.isoformat(), position, str(session.session_id), session.sport_type, session.duration_minutes, session.distance_km),
                )
        self._write(operation)

    def delete(self, entry_date: date, session_id: str) -> None:
        self._write(lambda conn: conn.execute(
            "DELETE FROM sport_sessions WHERE entry_date = ? AND session_id = ?",
            (entry_date.isoformat(), str(session_id)),
        ))


class SqlSocialRepository(SqlRepository):
    def list_friend_ids(self, entry_date: date) -> set[int]:
        conn = self._connection_factory()
        try:
            return {int(row[0]) for row in conn.execute(
                "SELECT friend_id FROM social_logs WHERE entry_date = ?", (entry_date.isoformat(),)
            ).fetchall()}
        finally:
            conn.close()

    def add(self, entry_date: date, friend_id: int) -> None:
        self._write(lambda conn: conn.execute(
            "INSERT INTO social_logs (entry_date, friend_id) VALUES (?, ?) ON CONFLICT(entry_date, friend_id) DO NOTHING",
            (entry_date.isoformat(), int(friend_id)),
        ))

    def remove(self, entry_date: date, friend_id: int) -> None:
        self._write(lambda conn: conn.execute(
            "DELETE FROM social_logs WHERE entry_date = ? AND friend_id = ?",
            (entry_date.isoformat(), int(friend_id)),
        ))
