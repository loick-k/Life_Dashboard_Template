"""Outils de référence du stockage local V2, sans dépendance à Streamlit/Neon."""

import sqlite3
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).with_name("migrations")


def _check_transaction_control(statement: str) -> None:
    # Inspect the first SQL token, ignoring leading comments, before execution.
    prefix = re.sub(r"\A(?:\s+|--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*", "", statement)
    token = re.match(r"[A-Za-z]+", prefix)
    if token and token.group().upper() in {"BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"}:
        raise ValueError("Les transactions appartiennent au moteur de migrations.")


def connect_local_database(path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = FULL")
    return connection


def _statements(sql: str):
    """Split only complete SQLite statements (including trigger bodies)."""
    pending = ""
    for character in sql:
        pending += character
        if character == ";" and sqlite3.complete_statement(pending):
            yield pending
            pending = ""
    if pending.strip():
        if sqlite3.complete_statement(pending + ";"):
            yield pending
        else:
            raise ValueError("Migration SQL incomplète.")


def apply_local_migrations(connection: sqlite3.Connection, migrations_dir=None) -> list[str]:
    """Commit schema and journal together; never commit caller-owned work."""
    if connection.in_transaction:
        raise RuntimeError("Terminer la transaction courante avant les migrations.")
    connection.execute("PRAGMA foreign_keys = ON")
    executed = []
    for path in sorted(Path(migrations_dir or MIGRATIONS_DIR).glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (migration_id TEXT PRIMARY KEY, checksum_sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)")
            stored = connection.execute(
                "SELECT checksum_sha256 FROM schema_migrations WHERE migration_id = ?",
                (path.stem,),
            ).fetchone()
            if stored and stored[0] != checksum:
                raise RuntimeError(f"La migration locale {path.stem} a changé après son exécution.")
            if not stored:
                for statement in _statements(sql):
                    _check_transaction_control(statement)
                    connection.execute(statement)
                    if not connection.in_transaction:
                        raise RuntimeError("Une migration ne doit pas terminer sa transaction.")
                if connection.execute("PRAGMA foreign_key_check").fetchone():
                    raise RuntimeError("Migration : relations invalides.")
                connection.execute(
                    "INSERT INTO schema_migrations (migration_id, checksum_sha256, applied_at) VALUES (?, ?, ?)",
                    (path.stem, checksum, datetime.now(timezone.utc).isoformat()),
                )
                executed.append(path.stem)
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
    return executed
