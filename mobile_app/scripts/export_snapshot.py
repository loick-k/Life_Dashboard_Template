"""Exporte un instantané JSON local de Neon sans journaliser le secret de connexion."""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

try:
    from sqlalchemy import create_engine, inspect, text
except ImportError as exc:
    raise SystemExit(
        "Dépendances manquantes. Suis les commandes d'installation indiquées "
        "dans mobile_app\\README.md, puis relance le script."
    ) from exc


TABLES = (
    "daily_entries",
    "sport_sessions",
    "friends",
    "social_logs",
    "goals",
    "goal_logs",
    "settings",
    "checkin_progress",
    "api_usage_logs",
    "schema_migrations",
    "todo_categories",
    "todo_items",
)


def _json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def main() -> None:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL doit être définie dans l'environnement.")
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)

    timestamp = datetime.now().astimezone().strftime("%Y%m%d_%H%M%S")
    output_dir = Path(__file__).resolve().parents[1] / "backups" / timestamp
    output_dir.mkdir(parents=True, exist_ok=False)

    engine = create_engine(database_url, pool_pre_ping=True)
    manifest = {
        "created_at": datetime.now().astimezone().isoformat(),
        "format_version": 1,
        "tables": {},
    }
    try:
        with engine.connect() as connection:
            available = set(inspect(connection).get_table_names())
            for table_name in TABLES:
                if table_name not in available:
                    manifest["tables"][table_name] = {"present": False, "rows": 0}
                    continue
                result = connection.execute(text(f'SELECT * FROM "{table_name}"'))
                columns = list(result.keys())
                rows = [
                    {key: _json_value(value) for key, value in dict(row._mapping).items()}
                    for row in result
                ]
                target = output_dir / f"{table_name}.json"
                target.write_text(
                    json.dumps(rows, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                manifest["tables"][table_name] = {
                    "present": True,
                    "rows": len(rows),
                    "columns": columns,
                    "file": target.name,
                }
    finally:
        engine.dispose()

    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Instantané créé dans {output_dir}")
    print("Ce répertoire contient des données personnelles et ne doit jamais être ajouté à Git.")


if __name__ == "__main__":
    main()
