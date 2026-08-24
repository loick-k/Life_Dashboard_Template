# Architecture du Life Dashboard

## Modules

- `app_life_dashboard_v4.py` : composition de l’application et rendu des pages.
- `daily_checkin.py` : parcours quotidien mobile et état temporaire du formulaire.
- `data_store.py` : connexion Neon/SQLite, schéma et opérations de persistance.
- `dashboard_metrics.py` : agrégations, scores et évaluation globale.
- `dashboard_charts.py` : graphiques Plotly et tableaux analytiques.
- `app_config.py` : constantes fonctionnelles, étapes du parcours, sports proposés et réglages par défaut.
- `french_calendar.py` : jours fériés français et mode de travail proposé par défaut.
- `performance_monitor.py` : chronométrage léger et synthèse des performances de la session.

## Règles de dépendance

1. Les modules techniques ne doivent pas importer le fichier principal.
2. La configuration ne doit contenir aucun accès à Streamlit ou à Neon.
3. Le parcours quotidien reçoit ses fonctions de lecture et de sauvegarde par paramètres ; il ne connaît pas la base utilisée.
4. Les calculs métier ne doivent pas écrire dans la base.
5. Toute nouvelle donnée persistée doit conserver la compatibilité avec les journées existantes.

## Évolutions futures

Les prochains domaines fonctionnels importants pourront disposer de leur propre module, par exemple l’interprétation des repas. Une nouvelle extraction doit rester indépendante et être suivie d’un test de non-régression.
