# Architecture locale de l'application mobile V2

## Décision

La V2 est une application Android autonome, mono-utilisateur, sans portail de
connexion ni compte Life Dashboard distant. SQLite locale est sa source de vérité.
La saisie, l'historique et les bilans principaux doivent fonctionner hors ligne.
Streamlit et Neon restent le fonctionnement de la V1 et ne sont pas modifiés par
cette décision. Aucun remplacement ni synchronisation automatique n'est prévu ;
l'import entre versions reste explicite. Voir la décision produit détaillée dans
[`15_decision_v2_locale_sans_compte.md`](15_decision_v2_locale_sans_compte.md).

## Frontières

- L'APK ne contient aucun secret Neon, OpenAI ou Todoist.
- Le domaine partagé valide les valeurs avant leur écriture.
- Le repository mobile sera la seule couche autorisée à ouvrir SQLite.
- Les intégrations externes nécessitant compte ou réseau (Todoist, analyses distantes)
  sont séparées de l'accès à l'application et doivent rester facultatives.
- Les dates métier utilisent `Europe/Paris`; les horodatages techniques sont en UTC ISO 8601.

## Stockage et confidentialité — à décider

La base doit rester locale à l'application sur le téléphone. Le mécanisme de
protection au repos, la gestion des clés et le rôle éventuel de la biométrie ne
sont pas encore des choix produit arrêtés. SQLCipher, Keystore/SecureStore et la
biométrie présents dans le prototype doivent être évalués et vérifiés sur Android
avant décision. Aucune authentification distante n'est requise pour le profil local.

Les journaux ne doivent jamais afficher les repas, mesures corporelles, horaires,
relations, objectifs, jetons ou contenu des sauvegardes.

## Sauvegarde et restauration — stratégie à décider

Une implémentation de sauvegarde chiffrée et par code de récupération existe dans
le prototype V2 ; elle ne représente pas la stratégie validée. Il faut encore choisir
les supports, la récupération, la protection des clés, les conséquences d'une perte
de code ou d'appareil, et vérifier création/restauration sur Android. Google Drive
nécessiterait un compte tiers et le réseau : aucune destination distante n'est
retenue par cette décision. L'import V1 explicite reste distinct d'une sauvegarde V2.

## Identifiants et écritures

- Chaque objet utilise un UUID texte généré localement.
- `entry_date` reste unique pour une journée.
- Chaque ligne possède `created_at`, `updated_at` et, si nécessaire, `revision`.
- Les écritures restent ciblées par champ ou objet.
- Les clés étrangères et suppressions en cascade protègent la cohérence locale.

## Transition V1 vers V2

L'import 3B sera à sens unique et relançable : lecture d'une sauvegarde Neon, conversion
vers les UUID V2, contrôle des volumes et restauration de test. La V1 ne sera ni supprimée
ni mise en lecture seule à ce stade.
