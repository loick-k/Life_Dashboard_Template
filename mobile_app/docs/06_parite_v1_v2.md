# Matrice de parité — suivi vérifiable

Inventaire initial du 25/09/2026, fondé sur `app_config.py`, les rubriques de
`app_life_dashboard_v4.py`, les fonctions de `dashboard_metrics.py`,
`work_report.py` et `todoist_view.py`. L'inventaire détaillé des contrôles reste à
compléter pendant chaque portage. « À porter » ne signifie jamais implémenté.

| Rubrique V1 / source | Contrat V2 à vérifier | État Android |
|---|---|---|
| Navigation principale / app | Aujourd'hui, Todo, Bilan, Réglages ; date du jour Paris | À porter |
| Parcours / app_config, checkin | 13 étapes + récapitulatif, reprise, passer, retour, accès direct | À porter |
| Sommeil | Durée, horaires, sieste ; valeurs partielles préservées | À porter |
| Alcool | Quantité, zéro distinct d'absence | À porter |
| Corps | Poids, masse graisseuse, tour de ventre indépendants | À porter |
| Travail / work_tracking | Trois créneaux, heures isolées, standards, veille, mode ; solde cumulé unique | À porter |
| Sport | Types V1, plusieurs séances, minutes et distances précises | À porter |
| Portable | Durée précise, historique et seuil configurable | À porter |
| Alimentation | Repas, calcul explicite, kcal nettes, absence n.c., résultat unique | À porter |
| Temps pour moi | Activités distinctes, sorties/détente, total immédiat | À porter |
| Écoute | Scores et libellé configurable des proches | À porter |
| Social | Personnes, catégories, récurrence, périodes, historique et journal quotidien | À porter |
| Objectifs | Ajout, actifs, complétés, critères, journal et historique | À porter |
| Bilan / dashboard_metrics | Courbes par catégorie, vue hebdomadaire, objectifs, évaluation semaine courante | À porter |
| Scores / dashboard_metrics | Sommeil, alcool, tabac, sport, portable, nutrition, corps, social, objectifs, travail, temps positif, écoute | À porter |
| Travail PDF / work_report | Tableau hebdomadaire, types, durée et compteur cumulé, graphique | À porter |
| Todo / todoist_view | Interface/accès Todoist, projets et statistiques disponibles ; intégration facultative | À porter |
| Réglages / app_config | Seuils, objectifs, horaires standards, jours de travail, date arrêt tabac | À porter |
| Performance / app | Adapter suivi du coût API et diagnostic à l'usage mobile, sans données sensibles | À porter |
| Données / app | Consultation entrées et journaux ; export sécurisé remplace téléchargement non chiffré | À porter |

## Exigences propres à Android

| Fonction | Preuve de sortie attendue | État |
|---|---|---|
| Migrations atomiques | Interruption et reprise dans le runtime réel | Référence Python : 9 tests réussis ; Android à faire |
| SQLCipher + Keystore | Fichier illisible sans clé, réouverture et mauvaise clé refusée | Configuration native préparée, non vérifiée |
| Autosauvegarde | Saisie, retour, concurrence, arrêt forcé et redémarrage | À faire |
| Assistant initial | Hors ligne, interruption/reprise, ne réapparaît pas après fin | À faire |
| Protection locale | Verrouillage, biométrie, reprise sûre et récupération | À faire |
| Sauvegarde chiffrée | Nouveau téléphone, mauvais mot de passe, altération, interruption | À faire |
| Import V1 | Fixtures synthétiques, relations, collisions et rejeu | À faire |
| APK autonome signé | Installation et mise à jour sans Metro/Expo Go ni perte | À faire |

## Différences prévues, à valider visuellement

- Navigation tactile native plutôt que barre latérale Streamlit.
- Identité claire/fond blanc, texte sombre, action principale rouge `#ff4b4b`.
- Pas de connexion Google obligatoire pour les données locales.
- Pas de Neon ni de serveur Python ; pas de synchronisation implicite V1/V2.
- Secrets facultatifs saisis sur appareil, jamais distribués avec l'APK.
- Aucune copie de données personnelles dans les fixtures ou captures comparatives.

Les tests JavaScript et Python ne remplacent pas les preuves Android. La période
de double exploitation et la validation téléphone restent des gates utilisateur.
