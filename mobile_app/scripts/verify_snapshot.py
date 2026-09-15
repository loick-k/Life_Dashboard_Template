"""Vérifie un instantané sans afficher les données personnelles qu'il contient."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _latest_snapshot(backups_dir: Path) -> Path:
    candidates = sorted(path for path in backups_dir.iterdir() if path.is_dir())
    if not candidates:
        raise SystemExit("Aucun instantané trouvé dans mobile_app/backups.")
    return candidates[-1]


def main() -> None:
    mobile_dir = Path(__file__).resolve().parents[1]
    backups_dir = mobile_dir / "backups"
    snapshot_dir = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else _latest_snapshot(backups_dir)
    if backups_dir.resolve() not in snapshot_dir.parents:
        raise SystemExit("Le répertoire à vérifier doit se trouver dans mobile_app/backups.")

    manifest_path = snapshot_dir / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit("Le manifeste est absent.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format_version") != 1:
        raise SystemExit("Version de format d'instantané inconnue.")

    verified_tables = 0
    verified_rows = 0
    for table_name, metadata in manifest.get("tables", {}).items():
        if not metadata.get("present"):
            continue
        file_name = metadata.get("file")
        if not file_name or Path(file_name).name != file_name:
            raise SystemExit(f"Nom de fichier invalide pour la table {table_name}.")
        table_path = snapshot_dir / file_name
        if not table_path.is_file():
            raise SystemExit(f"Fichier absent pour la table {table_name}.")
        raw = table_path.read_text(encoding="utf-8")
        lowered = raw.lower()
        if "postgresql://" in lowered or "postgresql+psycopg://" in lowered:
            raise SystemExit(f"Une URL de base semble présente dans {file_name}.")
        rows = json.loads(raw)
        if not isinstance(rows, list):
            raise SystemExit(f"Le fichier {file_name} ne contient pas une liste JSON.")
        expected_rows = int(metadata.get("rows", -1))
        if len(rows) != expected_rows:
            raise SystemExit(
                f"Nombre de lignes incohérent pour {table_name}: "
                f"manifeste={expected_rows}, fichier={len(rows)}."
            )
        verified_tables += 1
        verified_rows += len(rows)

    print(f"Instantané valide : {snapshot_dir.name}")
    print(f"Tables vérifiées : {verified_tables}")
    print(f"Lignes vérifiées : {verified_rows}")
    print("Aucune donnée personnelle n'a été affichée.")


if __name__ == "__main__":
    main()

