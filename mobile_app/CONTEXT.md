# Contexte de reprise du développement V2

Mis à jour le 25/09/2026. Lire les AGENTS.md avant de travailler.

## Objectif accepté

Développer une application Android autonome à stockage local, fidèle aux fonctions
et à l'interface Streamlit V1. Les deux versions doivent rester utilisables
indépendamment. La V1 conserve Neon ; la V2 conserve sa propre SQLite. Aucun
remplacement forcé de la V1 et aucune synchronisation automatique des deux bases.

## État vérifié dans le dépôt

- `d7f0aa3` : modèles Python et calculs métier dans `../domain/`.
- `fe942d1` : repositories SQL injectables, ciblant encore le schéma historique V1.
- `85f085a` : séparation de l'adaptateur Streamlit et de l'analyse nutritionnelle.
- `3db45cb` : schéma SQLite V2 et outils Python locaux de référence (étape 3A).
- Aucun projet Android/Expo installable actuellement dans `mobile_app/`.
- Chiffrement Android, sauvegarde chiffrée, restauration V2 et convertisseur
  d'import : architecture documentée, implémentation à réaliser.
- Les services Python n'ont pas tous leur indépendance transitive de Streamlit :
  `services/checkin_service.py` et `services/nutrition_service.py` importent encore
  la persistance V1. Ne pas les considérer comme un backend mobile prêt à livrer.

Historique de validation : 64 tests Python annoncés au lot 3A. Cela ne constitue
pas un test Android. Le scénario `tests/smoke_app.py` a échoué lors de l'étape 2
sur « champ poids introuvable » ; sa cause reste à établir avant toute affirmation
de parité complète. Ne pas masquer cet échec ni modifier V1 sans diagnostic.

## Prochain lot concret

Consolider le stockage local : rendre atomiques les migrations et leur journal,
tester une interruption et une reprise, puis adapter les repositories au schéma
V2. Actuellement `database/local_store.py` utilise `executescript` puis inscrit
le journal séparément : l'atomicité globale n'est pas encore garantie.

Ensuite : import synthétique V1 vers V2, socle Android, chiffrement, formulaires,
sauvegardes/restauration, bilans/PDF, intégrations optionnelles, validation téléphone.
Le détail et les critères de sortie figurent dans [le plan](docs/02_plan_migration.md).

## Références fonctionnelles V1

- `../app_life_dashboard_v4.py` : navigation, style, bilan et réglages.
- `../checkin/controller.py` et `../checkin/steps/` : parcours quotidien et widgets.
- `../app_config.py` : étapes et constantes.
- `../work_tracking.py`, `../dashboard_metrics.py`, `../work_report.py` : calculs et PDF.
- `../todoist_view.py`, `../nutrition_analysis.py` : intégrations.

Inventorier la parité avant le portage : sommeil/sieste, alcool, poids, masse
graisseuse, tour de ventre, trois créneaux de travail et solde cumulé, sport et
distances, portable, alimentation et kcal, temps pour soi, écoute, relations,
objectifs, historique, bilans, PDF, Todoist et réglages. La V1 observable fait foi
pour compléter cette liste et les cas limites.

## Commandes utiles

Depuis la racine du dépôt, avec un Python contenant les dépendances nécessaires :

```powershell
git status --short
python -m unittest tests.test_mobile_local_database -v
python -m unittest tests.test_domain tests.test_repositories -v
python -m unittest discover -s tests -p "test_*.py"
python tests/smoke_app.py
```

`python` n'était pas disponible dans PATH lors des précédents lots. Utiliser un
interpréteur existant vérifié ou un environnement dédié ; ne pas modifier celui
de la V1. Les tests de PDF exigent notamment `reportlab` et `pypdf`. Le dossier
`mobile_app/.venv-tools` est destiné aux outils d'export ; vérifier ses dépendances
avant de le réutiliser. Aucune commande Android n'existe encore.

## Données réelles et Git

Les exports et bases restent dans des chemins ignorés (`backups/`, `local_data/`).
Ne pas lire ni publier leur contenu pour une tâche d'architecture. L'import réel
sera contrôlé avec l'utilisateur ; les préparatifs utilisent des fixtures fictives.
Vérifier la branche, le remote et les commits non poussés au début de chaque lot ;
ce document ne garantit pas l'état distant. Commit à chaque lot, push sur demande.
