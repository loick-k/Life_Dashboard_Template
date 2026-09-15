# Migration mobile du Life Dashboard

La migration crée une **V2 mobile** distincte. L'application Streamlit existante demeure la
**V1 fonctionnelle** et la solution de secours jusqu'à la bascule validée. Le code partagé se
trouve dans `domain/`; la V2 accédera aux données via une API et les repositories injectables,
jamais directement depuis l'APK.

Ce dossier accueille la migration progressive de l'interface Streamlit vers une
application Android. La base Neon existante reste la source de vérité pendant la
transition.

## État actuel

- Étape 0 : terminée et validée le 15/09/2026.
- Application source : commit `d9a24be613092955f8409002820df8585c658a05`.
- Tests source : 46 tests réussis.
- Aucune modification de schéma Neon réalisée.
- Aucune donnée personnelle enregistrée dans ce dossier.
- Sauvegarde réelle validée : 12 tables et 348 lignes.
- Restauration testée dans un schéma Neon temporaire, ensuite supprimé.

## Documents

- `docs/01_audit_source.md` : audit technique de l'application actuelle.
- `docs/02_plan_migration.md` : jalons et conditions de passage.
- `docs/03_sauvegarde_restauration.md` : procédure de sauvegarde Neon.
- `docs/04_criteres_acceptation.md` : critères bloquants avant bascule.
- `data/schema_inventory.json` : inventaire fonctionnel des tables.
- `fixtures/sample_daily_entry.json` : données fictives pour les tests.

## Sauvegarde contrôlée

Le script `scripts/export_snapshot.py` crée un export JSON local. Le répertoire
`backups/` est ignoré par Git.

```powershell
python -m venv mobile_app\.venv-tools
mobile_app\.venv-tools\Scripts\python.exe -m pip install -r mobile_app\requirements-tools.txt
$env:DATABASE_URL = "postgresql://..."
mobile_app\.venv-tools\Scripts\python.exe mobile_app\scripts\export_snapshot.py
mobile_app\.venv-tools\Scripts\python.exe mobile_app\scripts\verify_snapshot.py
mobile_app\.venv-tools\Scripts\python.exe mobile_app\scripts\test_restore_neon.py
```

Ne jamais copier une URL Neon dans un fichier du dépôt.
