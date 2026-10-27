# Matrice de parité — suivi vérifiable

Inventaire initial du 25/09/2026, fondé sur `app_config.py`, les rubriques de
`app_life_dashboard_v4.py`, les fonctions de `dashboard_metrics.py`,
`work_report.py` et `todoist_view.py`. L'inventaire détaillé des contrôles reste à
compléter pendant chaque portage. « À porter » ne signifie jamais implémenté.

| Rubrique V1 / source | Contrat V2 à vérifier | État Android |
|---|---|---|
| Accès à l'application | Application locale sans compte distant ; V1 conservée telle quelle | Décision produit du 27/10/2026 ; aucun portail de connexion V2 prévu |
| Navigation principale / app | Aujourd'hui, Todo, Bilan, Réglages ; date du jour Paris | Menu principal connecté, éditeurs conservés, date et retours testés avec React ; Todoist et preuve Android à faire |
| Parcours / app_config, checkin | 13 étapes + récapitulatif, reprise, passer, retour, accès direct | Accueil, accès directs, curseur par date, progression, fin, retour/Modifier, résumé sport/relations/objectifs et ouverture historique connectés ; UI Android non validée |
| Sommeil | Durée, horaires, sieste ; valeurs partielles préservées | Horaires calculés, mode manuel/importé explicite, sieste h/min et désaccord signalé ; tests locaux ; validation native à faire |
| Alcool | Quantité, zéro distinct d'absence | Saisie connectée ; validation native à faire |
| Corps | Poids, masse graisseuse, tour de ventre indépendants | Saisie et dernières mesures datées connectées, réutilisation confirmée et ciblée testée ; validation native à faire |
| Travail / work_tracking | Trois créneaux, heures isolées, standards, veille, mode ; solde cumulé unique | Trois créneaux/mode/durée, standards/veille confirmés, solde avant/après partagé avec Bilan connectés ; tests SQLite et parité de solde V1 ; validation Android à faire |
| Sport | Types V1, plusieurs séances, minutes et distances précises | Repository et UI connectés, buffers durables, reprise explicite et suppression atomique testées ; validation Android à faire |
| Portable | Durée précise, historique et seuil configurable | Saisie précise, périodes historiques, seuil consommé par le score ; tests locaux ; validation Android à faire |
| Alimentation | Repas, calcul explicite, kcal nettes, absence n.c., résultat unique | Repas et affichage kcal connectés ; analyse à faire |
| Temps pour moi | Activités distinctes, sorties/détente, total immédiat | Saisie h/min et total immédiat connectés, absence distincte de zéro testée ; validation native à faire |
| Écoute | Scores et libellé configurable des proches | Saisie et libellé réglable connectés (formulaire et récapitulatif) ; validation Android à faire |
| Social | Personnes, catégories, récurrence, périodes, historique et journal quotidien | Répertoire indépendant, journal détaillé éditable/récupérable, récurrence UUID et périodes semaine/mois, historique paginé/filtré et archives ; tests locaux et parité V1 ; Android à faire |
| Objectifs | Ajout, actifs, complétés, critères, journal et historique | Répertoire indépendant, ajout sans contribution implicite, notes et historique détaillé paginé, états archive/terminé séparés, limite 3 actifs ; Android à faire |
| Bilan / dashboard_metrics | Courbes par catégorie, vue hebdomadaire, objectifs, évaluation semaine courante | 29 séries, périodes 7j/30j/365j/tout, groupes jour/semaine/mois et évaluation actuelle connectés ; tests SQLite/React et fixtures V1 ; validation native à faire |
| Scores / dashboard_metrics | Sommeil, alcool, tabac, sport, portable, nutrition, corps, social, objectifs, travail, temps positif, écoute | Évaluation semaine courante, 22 dimensions pondérées et couverture travail ; 69 seuils + global vérifiés avec V1 ; différences correctives documentées dans docs/14 ; Android à faire |
| Travail PDF / work_report | Tableau hebdomadaire, types, durée et compteur cumulé, graphique | Générateur local deux pages, export consenti et relu, tests/contrôle visuel synthétiques ; SAF et lecture Android à vérifier |
| Todo / todoist_view | Interface/accès Todoist, projets et statistiques disponibles ; intégration facultative | À porter |
| Réglages / app_config | Seuils, objectifs, horaires standards, jours de travail, date arrêt tabac | 13 préférences persistantes/CAS, autosauvegarde, assistant et consommateurs des scores/bilans connectés ; Android à faire |
| Performance / app | Adapter suivi du coût API et diagnostic à l'usage mobile, sans données sensibles | À porter |
| Données / app | Consultation entrées et journaux ; stratégie d'export à décider | Historique local connecté ; prototype sauvegarde/restauration, stratégie et validation Android encore ouverts |

## Exigences propres à Android

| Fonction | Preuve de sortie attendue | État |
|---|---|---|
| Migrations atomiques | Interruption et reprise dans le runtime réel | Python : 9 tests ; TypeScript/SQLite : 4 tests ; Android à faire |
| Chiffrement local | Protection des mesures, horaires et autres données personnelles | Implémentation SQLCipher/Keystore présente dans le prototype ; choix produit et validation Android ouverts |
| Autosauvegarde | Saisie, retour, concurrence, arrêt forcé et redémarrage | CAS et journal durable quotidien, sport, journaux, réglages et ajouts de répertoire ; UUID stable sans doublon, reprise explicite/React/SQLite fichier ; arrêt forcé Android à valider |
| Assistant initial | Hors ligne, interruption/reprise, ne réapparaît pas après fin | Progression et préférences locales connectées ; étapes prototype protection/sauvegarde à réviser après arbitrage ; validation Android à faire |
| Protection locale | Verrouillage, biométrie, reprise sûre et récupération | Prototype biométrique et tests de coordination présents ; nécessité, comportement et validation matérielle à décider |
| Sauvegarde/restauration | Transfert d'appareil, récupération et intégrité | Prototype AES-GCM/code de récupération présent ; stratégie, récupération, destination et validation Android ouvertes |
| Import V1 | Fixtures synthétiques, relations, collisions et rejeu | Convertisseur, CLI, simulation transactionnelle et écran d'import connectés ; 5 tests d'import SQLite réussis ; Android et données réelles à faire |
| APK autonome signé | Installation et mise à jour sans Metro/Expo Go ni perte | Signature stable hors Git et plugins prêts, graphe Gradle release hors ligne et bundle Hermes vérifiés ; pic disque du build à établir, compilation release et validation téléphone à faire |

## Différences prévues, à valider visuellement

- Navigation tactile native plutôt que barre latérale Streamlit.
- Identité claire/fond blanc, texte sombre, action principale rouge `#ff4b4b`.
- Correction accessibilité 27/10 : accent/graphes V1 `#ff4b4b` conservés ; fond des
  actions principales `#c83232` pour texte blanc lisible (contraste >=4,5:1 testé).
- Calendrier français natif à affichage volontaire, semaine commençant le lundi,
  ouverture de date explicite après sélection. La grille n'alourdit pas l'accueil
  par défaut. Saisie manuelle toujours disponible pour parcourir un historique long.
- Portable, sieste et temps pour moi saisis en heures/minutes ; stockage minutes
  inchangé, absence jamais convertie silencieusement en zéro. Horaires français
  normalisés en HH:MM. Dernières mesures corporelles datées réutilisées seulement
  sur confirmation, pas de report automatique d'un jour à l'autre.
- Pas de connexion Google obligatoire pour les données locales.
- Pas de portail de connexion ni de compte Life Dashboard distant pour la V2.
- Todoist et toute analyse nutritionnelle distante restent des intégrations distinctes,
  facultatives, et ne conditionnent pas l'utilisation hors ligne du cœur de l'app.
- Pas de Neon ni de serveur Python ; pas de synchronisation implicite V1/V2.
- Secrets facultatifs saisis sur appareil, jamais distribués avec l'APK.
- Aucune copie de données personnelles dans les fixtures ou captures comparatives.
- Raccourcis horaires : confirmation avec aperçu ; seuls les horaires renseignés
  sont copiés, les champs absents ne suppriment pas ceux de la journée cible.
- Graphiques hebdomadaires : catégories sélectionnables pour limiter le défilement.
  Courbes corporelles à échelle locale (aucune plage personnelle fixe), barres signées
  pour les autres indicateurs ; jours manquants n.c., sans interpolation.
- Périodes longues : navigation par fenêtres de 24 points, sans tronquer les KPIs,
  pour limiter le nombre de vues natives. Textes de repas non chargés dans les séries.
  Semaines lundi–dimanche explicites (la fréquence W-MON V1 terminait le lundi).

Les tests JavaScript et Python ne remplacent pas les preuves Android. La période
de double exploitation et la validation téléphone restent des gates utilisateur.
