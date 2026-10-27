# État du développement V2 — actualisé le 27/10/2026

## Décision produit — 27/10/2026

La V2 sera une application Android autonome sans portail de connexion ni compte
utilisateur distant. Ses données seront stockées localement et ses fonctions
principales fonctionneront hors ligne. La V1 Streamlit/Neon reste inchangée.
Voir [`15_decision_v2_locale_sans_compte.md`](15_decision_v2_locale_sans_compte.md).
Biométrie, chiffrement et sauvegarde/restauration restent à étudier ; le code
présent sur ces sujets est un prototype et non une politique adoptée.

## Conclusion

La V2 possède un socle local et plusieurs parcours métier connectés, mais n'est
pas prête pour une utilisation personnelle en production. Le parcours d'essai est
désormais accessible aussi dans le bundle de production. Les tests SQLite/TypeScript ne valident
pas à eux seuls le chiffrement, le tactile ou la persistance sur Android.
La V1 n'a pas été modifiée par ces lots mobiles et reste indépendante ; aucun
contrôle de disponibilité de son déploiement distant n'a été effectué dans ce lot.
Pause demandée à la fin de l'itération du 27/10 : lot d'ajouts durables terminé,
commit local uniquement, pas de lot suivant ni de push sans nouvelle demande.

## Implémenté dans le code

- Expo/React Native/TypeScript, schéma local et migrations atomiques avec checksums.
- Prototype d'ouverture SQLCipher et de gestion de clé SecureStore ; technologie,
  politique et garanties natives à décider et vérifier avant usage réel.
- Écritures ciblées, révisions, files de sauvegarde, erreurs explicites.
- Parcours quotidien 13 catégories + résumé, progression, reprise et historique.
- Horaires partiels/3 créneaux, sport incomplet, minutes/distances, corps,
  sommeil/sieste, alcool, repas, portable, temps pour soi, écoute.
- Catalogues et journaux sociaux/objectifs : ajout, sélection, archivage.
- Brouillons quotidiens/sport/journaux/réglages et ajouts de répertoire durables ;
  reprise explicite et identité stable évitant les doublons après confirmation perdue.
- 13 préférences persistantes ; standards horaires, veille et libellé d'écoute.
- Compteur travail commun formulaire/Bilan, référence 7 h 42, suivi hebdomadaire.
- 27 autres séries hebdomadaires, courbes/barres natives, données absentes distinctes
  des zéros, statistiques sans multiplication des relations.
- Assistant initial en mode d'essai : progression persistante, 7 écrans et réglages.
  Import V1 connecté ; biométrie et sauvegarde expérimentales, à arbitrer et valider.
- Prototype d'export AES-GCM/code de récupération et de restauration transactionnelle.
  Choix de stratégie, destination et comportement Android encore ouverts.
- Convertisseur V1 avec simulation, reçus/archives, collisions refusées et rejeu
  préservant les modifications V2. Outil de préparation d'instantané et route d'import.
- Prototype de biométrie pour la clé SQLCipher et FLAG_SECURE ; aucune décision de
  politique n'est adoptée avant étude et validation sur appareil.
- Signature stable privée hors Git, plugin Expo/Gradle reproductible sans clé debug
  en release, contrôle du certificat attendu et scripts avec garde-fous disque.

## Vérifié à cette clôture

- 215 tests Node réussis, dont SQLite réel sur données synthétiques et réouverture,
  AES-GCM réel via Node, fichier altéré/mauvaise clé et restauration interrompue.
- TypeScript sans erreur ; `git diff --check` sans anomalie.
- 16 tests Python locaux réussis : migrations/schéma et parité travail, scores,
  historiques et récurrences V1/V2.
- Aucun nouveau téléchargement/dépendance. Configuration Gradle release hors ligne
  et bundle Hermes de production vérifiés, pas de compilation applicative release.
- Dernier relevé : mobile_app 8 467 782 697 octets. Budget conservateur comptabilisé
  723 158 708 octets sur 5 Go (réserve pour baisse d'anciens caches incluse), marge
  d'arrêt 1 Go. Aucun gain de cache ne renouvelle ce budget ; registre local monotone.
  Incident Expo, restauration de l'APK et garde-fou de prébuild détaillés en doc 13.

## Reste à réaliser avant livraison

1. Valider sur Android le stockage local, la saisie, le retour, l'arrêt forcé,
   le redémarrage et la mise à jour. Mesurer ergonomie/performance ; ne pas installer
   un émulateur volumineux sans vérifier le budget disque. Tester le chiffrement
   seulement après décision.
2. Finaliser et valider la navigation de production et la première utilisation :
   le parcours d'essai et l'import sont branchés. Réviser les étapes qui exposent
   les prototypes de protection/sauvegarde après les décisions.
3. Décider la stratégie de sauvegarde/restauration puis la valider sur Android :
   création/lecture, récupération, arrêt forcé et restauration entre installations.
4. Valider l'import V1 sur Android puis préparer avec l'utilisateur l'import réel.
   Conversion unités/relations, conflits, idempotence, rapport et archives testés
   localement sur sources synthétiques. Import personnel après accord explicite.
5. Compléter la parité et l'ergonomie : calendrier visuel du travail, diagnostic
   des services externes et finitions tactiles. Sommeil, mesures précédentes,
   périodes, scores/évaluation, récurrences, journaux et rapport PDF sont désormais
   connectés et testés localement (docs/06 et 14), mais pas validés sur Android.
   Journal durable quotidien, sport, journaux, réglages et ajouts connecté ; valider
   ces parcours sur appareil avant de promettre tout brouillon
   retrouvé après arrêt forcé. Les trois défauts audit (comparaison, sortie en
   erreur, date Paris) ont des corrections/tests dédiés, preuve native restant due.
6. Intégrations facultatives Todoist et analyse nutritionnelle, secrets et erreurs
   réseau non bloquantes ; aucun service distant ne doit être requis par le cœur local.
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
