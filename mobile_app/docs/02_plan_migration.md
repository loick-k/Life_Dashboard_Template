# Plan de migration contrôlée

Chaque étape se termine par un commit indépendant, des tests et une validation
explicite avant de commencer la suivante.

## Étape 0 - Référence et sauvegarde

- [x] Capturer le commit et les résultats des tests.
- [x] Inventorier les données et dépendances.
- [x] Définir les critères de réussite.
- [x] Préparer un export local exclu de Git.
- [x] Créer des données de test synthétiques.
- [x] Exécuter un export réel de Neon.
- [x] Vérifier l'export sans afficher son contenu sensible.
- [ ] Tester une restauration sur une branche Neon isolée.

Condition de sortie : une sauvegarde restaurable a été vérifiée sur une branche
de test Neon.

## Étape 1 - Fiabilisation des écritures existantes

- Ajouter des tests de concurrence et de non-effacement entre étapes.
- Remplacer les écritures de ligne complète par des mises à jour ciblées.
- Donner des identifiants stables aux séances et relations.
- Conserver Streamlit fonctionnel sans changement visuel.

Condition de sortie : aucune étape ne peut effacer une autre étape, même avec une
copie locale ancienne.

## Étape 2 - Extraction du domaine

- Modèles indépendants de Streamlit.
- Validation des valeurs et calculs métier centralisés.
- Repositories PostgreSQL testables.
- Analyse nutritionnelle séparée de la sauvegarde.

Condition de sortie : les services métier fonctionnent sans importer Streamlit.

## Étape 3 - Évolution additive de Neon

- Ajouter `users` et rattacher les données existantes au compte propriétaire.
- Ajouter UUID, version serveur et index nécessaires.
- Ne supprimer aucune ancienne colonne.
- Tester les migrations sur une branche Neon avant la production.

Condition de sortie : l'application Streamlit et le nouveau modèle fonctionnent
simultanément.

## Étape 4 - API sécurisée

- Authentification Google et autorisation par utilisateur.
- Endpoints de lecture et mise à jour par étape.
- Clés d'idempotence et contrôle de version.
- Journalisation sans données sensibles.
- Tests de contrat et limites de débit.

## Étape 5 - Socle Android

- Expo, TypeScript et navigation.
- Connexion Google.
- SQLite et file de synchronisation.
- Aujourd'hui, Hier et reprise automatique.
- Indicateur `Local`, `Synchronisation`, `Synchronisé`, `Erreur`.

## Étape 6 - Migration verticale des indicateurs

Ordre : sommeil, alcool, corps, travail, sport, portable, alimentation, temps pour
moi, écoute, social, objectifs.

Chaque indicateur doit réussir : saisie en ligne, saisie hors ligne, fermeture de
l'application, resynchronisation et modification depuis un second appareil.

## Étape 7 - Bilan et intégrations

- KPI, graphiques et rapport PDF.
- Todoist.
- Analyse OpenAI asynchrone.

## Étape 8 - Double exploitation

Android est utilisé pour la saisie et Streamlit reste disponible pour le contrôle.
La période d'observation minimale est de deux semaines sans perte de données.

## Étape 9 - Bascule

Streamlit devient une interface de bilan et d'administration. L'ancien mécanisme
d'écriture n'est retiré qu'après sauvegarde et validation finale.
