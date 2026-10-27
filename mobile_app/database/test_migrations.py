"""Synthetic-only migration failure tests; no V1 imports or network."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mobile_app.database.local_store import apply_local_migrations, connect_local_database


class AtomicMigrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "test.sqlite"
        self.conn = connect_local_database(self.path)

    def tearDown(self):
        self.conn.close()
        self.directory.cleanup()

    def test_failed_journal_write_rolls_back_schema_and_can_retry(self):
        # Trigger a real SQLite interruption precisely at the journal insert.
        def authorize(action, table, *args):
            if action == sqlite3.SQLITE_INSERT and table == "schema_migrations":
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK
        self.conn.set_authorizer(authorize)
        with self.assertRaises(sqlite3.DatabaseError):
            apply_local_migrations(self.conn)
        self.conn.set_authorizer(None)
        self.assertFalse(self.conn.in_transaction)
        self.assertEqual(self.conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [])
        self.assertEqual(apply_local_migrations(self.conn), ["001_local_v2", "002_partial_sport", "003_catalog_revisions", "004_v1_import", "005_daily_derivations", "006_social_selection"])
        self.conn.close()
        self.conn = connect_local_database(self.path)
        self.assertEqual(apply_local_migrations(self.conn), [])
        self.assertEqual(self.conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")

    def test_keyboard_interrupt_rolls_back(self):
        def interrupted(sql):
            yield "CREATE TABLE unfinished (id INTEGER);"
            raise KeyboardInterrupt()
        with patch("mobile_app.database.local_store._statements", interrupted):
            with self.assertRaises(KeyboardInterrupt):
                apply_local_migrations(self.conn)
        self.assertIsNone(self.conn.execute("SELECT name FROM sqlite_master WHERE name='unfinished'").fetchone())

    def test_changed_checksum_is_rejected(self):
        apply_local_migrations(self.conn)
        self.conn.execute("UPDATE schema_migrations SET checksum_sha256='changed'")
        self.conn.commit()
        with self.assertRaises(RuntimeError):
            apply_local_migrations(self.conn)

    def test_caller_transaction_is_not_committed(self):
        self.conn.execute("CREATE TABLE draft (id INTEGER)")
        self.conn.execute("INSERT INTO draft VALUES (1)")
        with self.assertRaises(RuntimeError):
            apply_local_migrations(self.conn)
        self.assertTrue(self.conn.in_transaction)
        self.conn.rollback()
        self.assertEqual(self.conn.execute("SELECT * FROM draft").fetchall(), [])

    def test_transaction_control_is_rejected_before_commit(self):
        migrations = Path(self.directory.name) / "migrations"
        migrations.mkdir()
        for command in ["COMMIT", "END TRANSACTION", "ROLLBACK", "SAVEPOINT escape"]:
            with self.subTest(command=command):
                (migrations / "001_bad.sql").write_text(
                    "CREATE TABLE partial (id INTEGER);\n-- comment\n/* comment */ " + command + ";",
                    encoding="utf-8",
                )
                with self.assertRaises(ValueError):
                    apply_local_migrations(self.conn, migrations)
                self.assertFalse(self.conn.in_transaction)
                self.assertIsNone(self.conn.execute("SELECT name FROM sqlite_master WHERE name='partial'").fetchone())

    def test_trigger_body_is_not_split_at_inner_semicolons(self):
        migrations = Path(self.directory.name) / "triggers"
        migrations.mkdir()
        (migrations / "001_trigger.sql").write_text(
            "CREATE TABLE source (id INTEGER); CREATE TABLE audit (id INTEGER);"
            "CREATE TRIGGER copy AFTER INSERT ON source BEGIN "
            "INSERT INTO audit VALUES (new.id); INSERT INTO audit VALUES (new.id + 1); END;",
            encoding="utf-8",
        )
        apply_local_migrations(self.conn, migrations)
        self.conn.execute("INSERT INTO source VALUES (5)")
        self.assertEqual(self.conn.execute("SELECT id FROM audit ORDER BY id").fetchall(), [(5,), (6,)])


if __name__ == "__main__":
    unittest.main()
