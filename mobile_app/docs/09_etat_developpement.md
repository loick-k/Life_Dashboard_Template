# État du développement V2 — actualisé le 27/10/2026

## Conclusion

La V2 possède un socle local et plusieurs parcours métier connectés, mais n'est
pas prête pour une utilisation personnelle en production. Les interfaces actuelles
restent dans le mode technique `__DEV__`. Les tests SQLite/TypeScript ne valident
pas à eux seuls le chiffrement, le tactile ou la persistance sur Android.
La V1 n'a pas été modifiée par ces lots mobiles et reste indépendante ; aucun
contrôle de disponibilité de son déploiement distant n'a été effectué dans ce lot.

## Implémenté dans le code

- Expo/React Native/TypeScript, schéma local et migrations atomiques avec checksums.
- Ouverture SQLCipher obligatoire et clé dans SecureStore, sans repli en clair.
  Coordination testée ; preuve native de chiffrement/récupération encore nécessaire.
- Écritures ciblées, révisions, files de sauvegarde, erreurs explicites.
- Parcours quotidien 13 catégories + résumé, progression, reprise et historique.
- Horaires partiels/3 créneaux, sport incomplet, minutes/distances, corps,
  sommeil/sieste, alcool, repas, portable, temps pour soi, écoute.
- Catalogues et journaux sociaux/objectifs : ajout, sélection, archivage.
- 13 préférences persistantes ; standards horaires, veille et libellé d'écoute.
- Compteur travail commun formulaire/Bilan, référence 7 h 42, suivi hebdomadaire.
- 27 autres séries hebdomadaires, courbes/barres natives, données absentes distinctes
  des zéros, statistiques sans multiplication des relations.
- Progression de l'assistant initial persistante côté stockage uniquement.
- Sauvegarde locale AES-GCM et code de récupération, restauration transactionnelle,
  contrôle dans une base temporaire et écran accessible depuis Réglages.
  APIs Expo/SQLCipher/choix de dossier restant à valider sur Android.

## Vérifié à cette clôture

- 54 tests Node réussis, dont SQLite réel sur données synthétiques et réouverture,
  AES-GCM réel via Node, fichier altéré/mauvaise clé et restauration interrompue.
- TypeScript sans erreur ; `git diff --check` sans anomalie.
- 10 tests Python locaux réussis : migrations/schéma et parité travail V1/V2.
- Aucune nouvelle dépendance, aucun téléchargement ni build natif dans le lot.
- mobile_app : 11 844 723 237 octets, +99 248 depuis le relevé de référence.
  Les petits fichiers Git/npm sont hors de ce total ; aucune consommation lourde
  extérieure ajoutée par ces lots. Budget cumulatif supplémentaire : 5 Go maximum.

## Reste à réaliser avant livraison

1. Valider sur Android SQLCipher/Keystore, saisie, retour, arrêt forcé, redémarrage
   et mise à jour. Mesurer ergonomie/performance ; ne pas installer un émulateur
   volumineux sans vérifier le budget disque.
2. Construire la navigation finale et les écrans de première utilisation : reprise,
   choix des données, préférences, protection/biométrie, sauvegardes et intégrations.
3. Valider sur Android la sauvegarde chiffrée et la récupération indépendante du
   téléphone : création/lecture de fichier, base temporaire chiffrée, arrêt forcé
   et restauration entre deux installations. Le code et les tests locaux existent.
4. Import V1 synthétique : conversion unités/relations, conflits, idempotence et
   rapport. Import personnel seulement après accord explicite.
5. Compléter la parité : calculs sommeil, mesures précédentes, granularités des
   courbes, scores/évaluation hebdomadaire, récurrences et détail des journaux,
   critères d'objectifs, rapport PDF, finitions des contrôles tactiles.
6. Intégrations facultatives Todoist et analyse nutritionnelle, saisie/protection/
   suppression des secrets et erreurs réseau non bloquantes.
7. Signature stable hors Git, APK release autonome, installation/mise à jour,
   guides et SHA-256. Validation réelle et période d'observation de 14 jours.

Tous ces points restent dans l'objectif ; le lot de graphiques ne les remplace pas.
Le smoke test V1 historique « champ poids introuvable » demeure à diagnostiquer
avant toute affirmation de parité complète. Aucun test V1 distant n'a été exécuté.

## APK existant

`android/app/build/outputs/apk/debug/app-debug.apk`, 95 416 222 octets,
version 0.1.0 / code 1, Android API 24 minimum. Compilé le 25/09/2026.
SHA-256 : `FC1047600624DB216C7FB44B455306821BA60B7F81DCE706DD18AF3AEF00701F`.
APK **debug**, dépendant de Metro, sans bundle JavaScript autonome : pas le livrable
final, ni une preuve de validation Android des fonctionnalités ci-dessus.
Copie pré-nettoyage conservée dans `artifacts/preserved/`.

## Git

Commits récents : `d405cc5` réglages, `a0e9dac` raccourcis, `f4f2031` compteur/Bilan.
Le présent lot ajoute les 27 séries et leur vérification. Commit local uniquement ;
aucun push, aucune intervention Neon ou données personnelles.
