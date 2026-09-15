# Architecture du Life Dashboard

## Modules

- `domain/` : modèles, validation et calculs métier purs partagés avec la V2 ; aucun import Streamlit ou base de données.
- `repositories/` : contrats et implémentations SQL injectables destinés à la future API mobile V2.
- `services/checkin_service.py` : orchestration des écritures, indépendante de l'interface.
- `services/nutrition_service.py` : analyse nutritionnelle explicite, séparée de la sauvegarde quotidienne.
- `services/streamlit_checkin_adapter.py` : compatibilité d'interface réservée à Streamlit V1.
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
6. La V1 Streamlit reste exécutable pendant toute la construction de la V2 mobile.
7. Seuls les adaptateurs d'interface peuvent importer Streamlit ; le domaine et les services métier l'ignorent.

## Versions maintenues pendant la migration

- **V1** : application Streamlit actuelle, conservée comme interface fonctionnelle et solution de secours.
- **V2** : application mobile et future API, construites progressivement sur `domain/` et `repositories/`.

Les deux versions partagent les règles métier, mais pas leur état d'interface. Une étape de migration
ne doit jamais retirer une fonctionnalité V1 avant la période de double exploitation prévue.

## Évolutions futures

Les prochains domaines fonctionnels importants pourront disposer de leur propre module, par exemple l’interprétation des repas. Une nouvelle extraction doit rester indépendante et être suivie d’un test de non-régression.
