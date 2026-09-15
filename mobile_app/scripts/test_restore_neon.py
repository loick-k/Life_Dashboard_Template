"""Teste la restauration dans un schéma Neon temporaire, puis le supprime."""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from pathlib import Path

try:
    from sqlalchemy import Date, DateTime, MetaData, Table, create_engine, func, select, text
except ImportError as exc:
    raise SystemExit(
        "Dépendances manquantes. Suis les commandes d'installation indiquées "
        "dans mobile_app\\README.md."
    ) from exc


RESTORE_ORDER = (
    "schema_migrations",
    "settings",
    "goals",
    "friends",
    "daily_entries",
    "todo_categories",
    "api_usage_logs",
    "sport_sessions",
    "social_logs",
    "goal_logs",
    "checkin_progress",
    "todo_items",
)
SAFE_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")


def _latest_snapshot(backups_dir: Path) -> Path:
    candidates = sorted(path for path in backups_dir.iterdir() if path.is_dir())
    if not candidates:
        raise SystemExit("Aucun instantané trouvé dans mobile_app/backups.")
    return candidates[-1]


def _database_url() -> str:
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise SystemExit("DATABASE_URL doit être définie dans le terminal.")
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+psycopg://", 1)
    return value


def _typed_row(table: Table, row: dict) -> dict:
    converted = {}
    for column in table.columns:
        value = row.get(column.name)
        if value is not None and isinstance(column.type, DateTime) and isinstance(value, str):
            value = datetime.fromisoformat(value)
        elif value is not None and isinstance(column.type, Date) and isinstance(value, str):
            value = date.fromisoformat(value)
        converted[column.name] = value
    return converted


def main() -> None:
    mobile_dir = Path(__file__).resolve().parents[1]
    snapshot_dir = _latest_snapshot(mobile_dir / "backups")
    manifest = json.loads((snapshot_dir / "manifest.json").read_text(encoding="utf-8"))
    present_tables = {
        name: metadata
        for name, metadata in manifest.get("tables", {}).items()
        if metadata.get("present")
    }
    unknown_tables = set(present_tables) - set(RESTORE_ORDER)
    if unknown_tables or any(not SAFE_IDENTIFIER.fullmatch(name) for name in present_tables):
        raise SystemExit("Le manifeste contient une table non autorisée pour ce test.")

    schema_name = f"mobile_restore_test_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    engine = create_engine(_database_url(), pool_pre_ping=True)
    restored_rows = 0
    try:
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema_name}"'))
            for table_name in RESTORE_ORDER:
                if table_name not in present_tables:
                    continue
                connection.execute(text(
                    f'CREATE TABLE "{schema_name}"."{table_name}" '
                    f'(LIKE public."{table_name}" INCLUDING ALL)'
                ))

            for table_name in RESTORE_ORDER:
                metadata_entry = present_tables.get(table_name)
                if metadata_entry is None:
                    continue
                rows = json.loads(
                    (snapshot_dir / metadata_entry["file"]).read_text(encoding="utf-8")
                )
                if not rows:
                    continue
                table = Table(
                    table_name,
                    MetaData(),
                    autoload_with=connection,
                    schema=schema_name,
                )
                connection.execute(table.insert(), [_typed_row(table, row) for row in rows])
                restored_rows += len(rows)

        with engine.connect() as connection:
            for table_name, metadata_entry in present_tables.items():
                table = Table(
                    table_name,
                    MetaData(),
                    autoload_with=connection,
                    schema=schema_name,
                )
                actual = int(connection.scalar(select(func.count()).select_from(table)) or 0)
                expected = int(metadata_entry["rows"])
                if actual != expected:
                    raise RuntimeError(
                        f"Nombre de lignes incohérent pour {table_name}: "
                        f"attendu={expected}, restauré={actual}."
                    )

        print(f"Test de restauration Neon réussi pour {len(present_tables)} tables.")
        print(f"Lignes restaurées et vérifiées : {restored_rows}")
        print("Aucune donnée personnelle n'a été affichée.")
    finally:
        try:
            with engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
        finally:
            engine.dispose()
        print("Schéma de test temporaire supprimé.")


if __name__ == "__main__":
    main()

