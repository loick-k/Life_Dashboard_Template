import sqlite3
import tempfile
import unittest
from pathlib import Path

from mobile_app.database.local_store import apply_local_migrations, connect_local_database


class MobileLocalDatabaseTests(unittest.TestCase):
    def setUp(self):
        handle = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        handle.close()
        self.path = Path(handle.name)
        self.connection = connect_local_database(self.path)

    def tearDown(self):
        self.connection.close()
        self.path.unlink(missing_ok=True)

    def test_migration_is_complete_and_idempotent(self):
        self.assertEqual(apply_local_migrations(self.connection), ["001_local_v2", "002_partial_sport", "003_catalog_revisions", "004_v1_import"])
        self.assertEqual(apply_local_migrations(self.connection), [])
        migration = self.connection.execute(
            "SELECT checksum_sha256 FROM schema_migrations WHERE migration_id = '001_local_v2'"
        ).fetchone()
        self.assertEqual(len(migration[0]), 64)
        tables = {row[0] for row in self.connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        expected = {"daily_entries", "sport_sessions", "friends", "social_logs", "goals", "goal_logs", "backup_history"}
        self.assertTrue(expected.issubset(tables))

    def test_foreign_keys_and_validation_are_enforced(self):
        apply_local_migrations(self.connection)
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute("INSERT INTO sport_sessions (session_id, entry_id, position, sport_type, duration_minutes, revision, created_at, updated_at) VALUES ('s1', 'missing', 1, 'Course', 20, 1, 'now', 'now')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute("INSERT INTO daily_entries (entry_id, entry_date, body_fat_pct, created_at, updated_at) VALUES ('e1', '2026-09-15', 120, 'now', 'now')")

    def test_no_cloud_credentials_are_part_of_schema(self):
        apply_local_migrations(self.connection)
        schema = " ".join(row[0] or "" for row in self.connection.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL")).lower()
        for forbidden in ("database_url", "neon", "openai_api_key", "todoist_api_token"):
            self.assertNotIn(forbidden, schema)


if __name__ == "__main__":
    unittest.main()
