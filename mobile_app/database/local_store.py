"""Outils de référence du stockage local V2, sans dépendance à Streamlit/Neon."""

import sqlite3
import hashlib
from datetime import datetime, timezone
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).with_name("migrations")


def connect_local_database(path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    return connection


def apply_local_migrations(connection: sqlite3.Connection) -> list[str]:
    connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (migration_id TEXT PRIMARY KEY, checksum_sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)")
    applied = {row[0]: row[1] for row in connection.execute("SELECT migration_id, checksum_sha256 FROM schema_migrations")}
    executed = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
        if path.stem in applied and applied[path.stem] != checksum:
            raise RuntimeError(f"La migration locale {path.stem} a changé après son exécution.")
        if path.stem in applied:
            continue
        connection.executescript(sql)
        connection.execute(
            "INSERT INTO schema_migrations (migration_id, checksum_sha256, applied_at) VALUES (?, ?, ?)",
            (path.stem, checksum, datetime.now(timezone.utc).isoformat()),
        )
        connection.commit()
        executed.append(path.stem)
    return executed
