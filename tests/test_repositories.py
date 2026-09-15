import sqlite3
import tempfile
import unittest
from datetime import date
from pathlib import Path

from domain.models import SportSession
from repositories.sql import SqlDailyEntryRepository, SqlSocialRepository, SqlSportRepository


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        handle.close()
        self.path = Path(handle.name)
        conn = sqlite3.connect(self.path)
        conn.executescript("""
            CREATE TABLE daily_entries (entry_date TEXT PRIMARY KEY, weight_kg REAL, phone_hours REAL);
            CREATE TABLE sport_sessions (entry_date TEXT, session_index INTEGER, session_id TEXT UNIQUE, sport_type TEXT, duration_minutes INTEGER, distance_km REAL, PRIMARY KEY(entry_date, session_index));
            CREATE TABLE social_logs (entry_date TEXT, friend_id INTEGER, UNIQUE(entry_date, friend_id));
        """)
        conn.close()
        self.factory = lambda: sqlite3.connect(self.path)
        self.day = date(2026, 9, 15)

    def tearDown(self):
        self.path.unlink(missing_ok=True)

    def test_daily_updates_are_targeted(self):
        repository = SqlDailyEntryRepository(self.factory)
        repository.update_fields(self.day, {"weight_kg": 78.2})
        repository.update_fields(self.day, {"phone_hours": 2.5})
        self.assertEqual(repository.get(self.day)["weight_kg"], 78.2)

    def test_sport_and_social_operations_are_atomic(self):
        sport = SqlSportRepository(self.factory)
        first = SportSession(sport_type="Course", duration_minutes=30, distance_km=5)
        second = SportSession(sport_type="Marche", duration_minutes=20)
        sport.upsert(self.day, first, 1)
        sport.upsert(self.day, second, 2)
        sport.delete(self.day, str(first.session_id))
        self.assertEqual([item.session_id for item in sport.list_for_date(self.day)], [second.session_id])

        social = SqlSocialRepository(self.factory)
        social.add(self.day, 10)
        social.add(self.day, 11)
        social.remove(self.day, 10)
        self.assertEqual(social.list_friend_ids(self.day), {11})


if __name__ == "__main__":
    unittest.main()
