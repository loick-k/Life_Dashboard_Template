import sqlite3
import tempfile
import unittest
from pathlib import Path

from data.migrations import (
    MIGRATIONS,
    _create_migration_journal,
    _migrate_close_relations_score,
    _run_migration,
)


class MigrationJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "migration-test.sqlite"
        self.conn = sqlite3.connect(self.db_path)

    def tearDown(self):
        self.conn.close()
        self.temp_dir.cleanup()

    def _migrate(self):
        _create_migration_journal(self.conn)
        for migration in MIGRATIONS:
            _run_migration(self.conn, migration, use_postgres=False)

    def test_records_each_migration_and_removes_legacy_marker(self):
        self._migrate()
        rows = self.conn.execute(
            "SELECT migration_id FROM schema_migrations ORDER BY migration_id"
        ).fetchall()
        self.assertEqual([row[0] for row in rows], [item.migration_id for item in MIGRATIONS])
        marker = self.conn.execute(
            "SELECT value FROM settings WHERE key = '__schema_version'"
        ).fetchone()
        self.assertIsNone(marker)

    def test_repairs_missing_column_even_when_migration_is_recorded(self):
        self._migrate()
        self.conn.execute("ALTER TABLE daily_entries DROP COLUMN body_fat_pct")
        self.conn.commit()

        _run_migration(self.conn, MIGRATIONS[0], use_postgres=False)

        columns = {
            row[1]
            for row in self.conn.execute("PRAGMA table_info(daily_entries)").fetchall()
        }
        self.assertIn("body_fat_pct", columns)

    def test_generic_relations_migration_copies_single_legacy_score(self):
        self._migrate()
        self.conn.execute(
            "ALTER TABLE daily_entries ADD COLUMN former_relations_listening_score INTEGER"
        )
        self.conn.execute(
            "INSERT INTO daily_entries (entry_date, former_relations_listening_score) VALUES (?, ?)",
            ("2026-08-24", 8),
        )
        _migrate_close_relations_score(self.conn)
        value = self.conn.execute(
            "SELECT close_relations_listening_score FROM daily_entries WHERE entry_date = ?",
            ("2026-08-24",),
        ).fetchone()[0]
        self.assertEqual(value, 8)


if __name__ == "__main__":
    unittest.main()
