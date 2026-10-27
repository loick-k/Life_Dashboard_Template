# État du développement V2 — actualisé le 27/10/2026

## Conclusion

La V2 possède un socle local et plusieurs parcours métier connectés, mais n'est
pas prête pour une utilisation personnelle en production. Le parcours d'essai est
désormais accessible aussi dans le bundle de production. Les tests SQLite/TypeScript ne valident
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
- Assistant initial en mode d'essai : progression persistante, 7 écrans, préférences,
  conservation des données présentes et sauvegarde/restauration V2 reliées.
  Import V1 et protection biométrique supplémentaire connectés, validation native à faire.
- Sauvegarde locale AES-GCM et code de récupération, restauration transactionnelle,
  contrôle dans une base temporaire et écran accessible depuis Réglages.
  APIs Expo/SQLCipher/choix de dossier restant à valider sur Android.
- Convertisseur V1 avec simulation, reçus/archives, collisions refusées et rejeu
  préservant les modifications V2. Outil de préparation d'instantané et route d'import.
- Protection de la clé SQLCipher par biométrie forte, activation/désactivation
  authentifiées, politique reprenable, absence de fallback et couverture des éditeurs
  au retour d'arrière-plan. FLAG_SECURE généré avant le rendu React.
- Signature stable privée hors Git, plugin Expo/Gradle reproductible sans clé debug
  en release, contrôle du certificat attendu et scripts avec garde-fous disque.

## Vérifié à cette clôture

- 74 tests Node réussis, dont SQLite réel sur données synthétiques et réouverture,
  AES-GCM réel via Node, fichier altéré/mauvaise clé et restauration interrompue.
- TypeScript sans erreur ; `git diff --check` sans anomalie.
- 10 tests Python locaux réussis : migrations/schéma et parité travail V1/V2.
- Aucun nouveau téléchargement/dépendance. Configuration Gradle release hors ligne
  et bundle Hermes de production vérifiés, pas de compilation applicative release.
- Dernier relevé : mobile_app 8 444 672 051 octets. Budget conservateur comptabilisé
  700 048 062 octets sur 5 Go (réserve pour baisse d'anciens caches incluse), marge
  d'arrêt 1 Go. Aucun gain de cache ne renouvelle ce budget ; registre local monotone.
  Incident Expo, restauration de l'APK et garde-fou de prébuild détaillés en doc 13.

## Reste à réaliser avant livraison

1. Valider sur Android SQLCipher/Keystore, saisie, retour, arrêt forcé, redémarrage
   et mise à jour. Mesurer ergonomie/performance ; ne pas installer un émulateur
   volumineux sans vérifier le budget disque.
2. Finaliser et valider la navigation de production et la première utilisation :
   le parcours d'essai, l'import et la protection biométrique sont branchés ;
   intégrations à réaliser, puis les gates Android à lever.
3. Valider sur Android la sauvegarde chiffrée et la récupération indépendante du
   téléphone : création/lecture de fichier, base temporaire chiffrée, arrêt forcé
   et restauration entre deux installations. Le code et les tests locaux existent.
4. Valider l'import V1 sur Android puis préparer avec l'utilisateur l'import réel.
   Conversion unités/relations, conflits, idempotence, rapport et archives testés
   localement sur sources synthétiques. Import personnel après accord explicite.
5. Compléter la parité : calculs sommeil, mesures précédentes, granularités des
   courbes, scores/évaluation hebdomadaire, récurrences et détail des journaux,
   critères d'objectifs, rapport PDF, finitions des contrôles tactiles.
6. Intégrations facultatives Todoist et analyse nutritionnelle, saisie/protection/
   suppression des secrets et erreurs réseau non bloquantes.
7. Établir le pic disque puis compiler l'APK release autonome avec la signature
   préparée hors Git, vérifier installation/mise à jour et fournir son SHA-256.
   Validation réelle et période d'observation de 14 jours.

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
La régénération inattendue d'Expo le 27/10 a retiré l'original ; il a été rétabli
depuis cette copie, puis son empreinte/signature vérifiées. Aucun nouvel APK livré.
Le bundle Hermes 0.2.0 / code prévu 2 existe séparément (1 924 263 octets), SHA-256
`39893BE9FCD970DB2D3CCBC944368A9FB2350521ABF13F9F9C159C7E9A5D883A`.

## Git

Commits récents : `0b1e7d4` import contrôlé, `291ac99` protection biométrique.
Le présent lot prépare la release, son bundle et sa signature. Commits locaux
uniquement ; aucun push, aucune intervention Neon ou données personnelles.
