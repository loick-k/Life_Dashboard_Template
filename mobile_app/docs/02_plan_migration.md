# Plan de migration contrôlée

Chaque lot se termine par un commit indépendant et des tests. Continuer les lots
locaux autorisés sans confirmation de routine. Import réel, push et services
externes nécessitent une autorisation explicite.

## Décision produit V2 — 27/10/2026

La V2 sera une application Android autonome sans portail de connexion ni compte
utilisateur distant. Les données seront locales et les fonctions principales
devront marcher hors ligne. La V1 Streamlit/Neon reste inchangée. Import V1/V2
explicite, sans synchronisation automatique. Voir
[`15_decision_v2_locale_sans_compte.md`](15_decision_v2_locale_sans_compte.md)
pour la justification, les intégrations et les choix de sécurité encore ouverts.

## Étape 0 - Référence et sauvegarde

- [x] Capturer le commit et les résultats des tests.
- [x] Inventorier les données et dépendances.
- [x] Définir les critères de réussite.
- [x] Préparer un export local exclu de Git.
- [x] Créer des données de test synthétiques.
- [x] Exécuter un export réel de Neon.
- [x] Vérifier l'export sans afficher son contenu sensible.
- [x] Tester une restauration dans un schéma Neon temporaire isolé.

Condition de sortie : une sauvegarde restaurable a été vérifiée sur une branche
ou un schéma temporaire de test Neon. Condition remplie le 15/09/2026 : 12 tables
et 348 lignes restaurées et vérifiées, puis schéma temporaire supprimé.

## Étape 1 - Fiabilisation des écritures existantes

- [x] Ajouter des tests de concurrence et de non-effacement entre étapes.
- [x] Remplacer les autosauvegardes de ligne complète par des mises à jour ciblées.
- [x] Donner des identifiants stables aux séances et relations.
- [x] Conserver Streamlit fonctionnel sans changement visuel.

Condition de sortie : aucune étape ne peut effacer une autre étape, même avec une
copie locale ancienne. Condition remplie le 15/09/2026 : écritures quotidiennes
ciblées par étape, UUID stable pour chaque séance sportive, clé stable date/personne
pour les relations, suppressions explicites et 52 tests de non-régression validés.

## Étape 2 - Extraction du domaine

- [x] Modèles indépendants de Streamlit.
- [x] Validation des valeurs et calculs métier centralisés.
- [x] Repositories PostgreSQL testables par injection de connexion.
- [x] Analyse nutritionnelle séparée de la sauvegarde.
- [x] Adaptateur Streamlit isolé pour maintenir la V1 fonctionnelle.

Condition de sortie : les services métier fonctionnent sans importer Streamlit.
Condition remplie le 15/09/2026 : domaine Pydantic pur, calcul du travail partagé,
repositories SQL testés sur SQLite, analyse nutritionnelle explicite et frontière V1/V2 documentée.

## Étape 3A - Architecture locale de la V2

- [x] Définir SQLite comme stockage principal mono-utilisateur de la V2.
- [x] Définir un schéma local à UUID, révisions, contraintes et index.
- [ ] Décider et valider les protections locales (chiffrement/biométrie) sur Android.
- [ ] Décider et valider la stratégie de sauvegarde et de restauration.
- [x] Tester les migrations locales et leur idempotence.
- [x] Conserver Streamlit/Neon comme V1 fonctionnelle sans les modifier.

Condition de sortie : le schéma local peut être créé et vérifié sans Neon. Condition
remplie le 15/09/2026. Les prototypes ultérieurs de chiffrement, biométrie et sauvegarde
ne ferment pas les décisions de sécurité, qui restent à étudier avant usage réel.

## Étape 3B - Import contrôlé depuis Neon

- Convertisseur local V1→V2 implémenté et testé sur sources synthétiques ; UUID
  déterministes, valeurs originales archivées et politique de collisions explicite.
- Rapport de simulation par compteurs/avertissements, sans valeurs personnelles.
- Simulation transactionnelle, refus atomique et reprise testés sur SQLite Node.
- Rejeu sans doublon vérifié après réouverture, édition V2 et sauvegarde/restauration.
- Exécuter ensuite ensemble un export Neon frais et l'import final.

Condition de sortie : chaque ligne source est retrouvée une seule fois dans SQLite
V2 (données actives ou archive explicitée). Tests locaux réussis ; vérification
Android et import des données réelles encore à autoriser/exécuter.

## Lot préalable - Consolidation du stockage local

- [x] Rendre atomiques les migrations Python de référence et leur journal.
- [x] Tester interruption, reprise et contrôle des checksums (9 tests SQLite).
- Adapter les repositories au schéma SQLite V2, distinct du schéma V1.
- Vérifier les écritures ciblées et les conflits de révision locaux.

Ce lot précède l'import 3B. La préparation locale n'exige aucune connexion Neon.

## Étape 5 - Socle Android

- Expo, TypeScript et navigation.
- Valider les bibliothèques natives et isoler les dépendances V2.
- SQLite local chiffré et protection des clés Android.
- Aujourd'hui, Hier et reprise automatique.
  Curseur d'étape par date relié au formulaire ; tests de réouverture SQLite réussis,
  accueil/progression maintenant connectés et testés côté stockage ; validation
  native restant à réaliser. Récapitulatif sport/social/objectifs et navigation
  historique par date maintenant connectés ; sélecteur calendrier tactile à améliorer.
- Indiquer l'état réel de sauvegarde locale et les erreurs.
- Démarrer sans Internet ni connexion Google obligatoire.
- Assistant français reprenable, réglages, protection locale et récupération.
  Progression persistante et conflits testés ; 7 écrans reliés en mode d'essai,
  préférences et sauvegarde/restauration branchées, reprise et completed relus au
  démarrage. Protection biométrique supplémentaire et import V1 connectés dans le
  parcours d'essai, aussi en bundle production ; validation native complète restant
  à réaliser avant utilisation personnelle. Signature et bundle préparés, pas d'APK
  release livré ; le pic disque de compilation doit être établi au préalable.
  Préférences : repository CAS par clé et écran autosauvegardé de développement
  disponibles, 5 tests SQLite ; libellé écoute et raccourcis horaires connectés
  (3 tests supplémentaires). Branchement à l'assistant et aux bilans restant.
- Porter et tester les migrations et repositories dans le runtime TypeScript.

## Étape 6 - Migration verticale des indicateurs

Ordre : sommeil, alcool, corps, travail, sport, portable, alimentation, temps pour
moi, écoute, social, objectifs.

Chaque indicateur doit réussir : saisie hors ligne, fermeture forcée, redémarrage,
reprise, absence d'effacement et comparaison fonctionnelle/visuelle avec la V1.

## Lot sauvegarde et restauration

- Prototype d'export chiffré/code de récupération et écran Réglages présents ;
  stratégie à décider avant de retenir ou de valider ce mécanisme.
- Restauration dans une base vierge et comparaison des valeurs/relations testées
  sur SQLite Node ; adaptateur temporaire SQLCipher écrit, exécution native à faire.
- Tests de code incorrect, fichier altéré et interruption SQL avec rollback réussis.
- Évaluer les destinations après décision sur la stratégie de sauvegarde.

## Étape 7 - Bilan et intégrations

- KPI, graphiques et rapport PDF.
  Compteur travail partagé formulaire/Bilan/PDF, semaines, objectif réglable,
  barres quotidiennes et détail connectés. 29 séries/périodes 7j/30j/365j/tout,
  agrégats jour/semaine/mois et évaluation semaine en cours connectés, null distinct
  de zéro. Tests SQLite/React et fixtures métier communes V1/V2. PDF deux pages
  contrôlé sur six pages fictives ; consentement non chiffré et relecture du fichier.
  Récurrence sociale et historiques détaillés personnes/objectifs maintenant connectés,
  paginés et testés (parité avec la vraie fonction V1). Validation native toujours
  nécessaire, y compris performances, sélecteur Android et lecture du PDF sur téléphone.
- Todoist.
- Analyse OpenAI asynchrone.
- API éventuelle uniquement pour les intégrations nécessitant des secrets serveur.
- Réseau facultatif : les indisponibilités externes ne bloquent pas SQLite.

## Étape 8 - Double exploitation

Android et Streamlit restent autonomes avec leurs bases respectives. Comparer des
jeux de données identiques et préciser la date de chaque import pour éviter de
confondre deux historiques indépendants.
La période d'observation minimale est de deux semaines sans perte de données.

## Étape 9 - Livraison et coexistence

Valider l'application Android sur téléphone, réaliser un dernier import explicite
si souhaité et documenter installation, mise à jour et récupération. Conserver
Streamlit V1 avec toutes ses fonctions et ses écritures ; aucune suppression ou
conversion en lecture seule n'est prévue.

Livrable : APK release signé localement, autonome sans Expo Go, versionné et
accompagné du SHA-256, des commandes de reconstruction et des guides d'installation,
mise à jour et récupération. Signature hors Git et stable entre mises à jour.
Ne pas confondre compilation réussie et validation sur téléphone.
