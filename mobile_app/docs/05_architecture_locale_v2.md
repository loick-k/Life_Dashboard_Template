# Architecture locale de l'application mobile V2

## Décision

La V2 mobile est une application locale d'abord, mono-utilisateur et sans dépendance
à Neon. SQLite devient sa base principale. Streamlit et Neon restent la V1 fonctionnelle
pendant l'import initial et la période de comparaison ; cette étape 3A ne modifie pas Neon.

## Frontières

- L'APK ne contient aucun secret Neon, OpenAI ou Todoist.
- Le domaine partagé valide les valeurs avant leur écriture.
- Le repository mobile sera la seule couche autorisée à ouvrir SQLite.
- Les analyses externes restent optionnelles et ne bloquent jamais la sauvegarde locale.
- Les dates métier utilisent `Europe/Paris`; les horodatages techniques sont en UTC ISO 8601.

## Stockage et confidentialité

Le fichier SQLite doit être créé dans l'espace privé de l'application Android. En
production, son chiffrement au repos est obligatoire. La clé sera créée aléatoirement et
protégée par Android Keystore ; elle ne sera jamais stockée dans SQLite, les préférences
ou Git. La bibliothèque Android/Expo sera validée avant le socle mobile.

Les journaux ne doivent jamais afficher les repas, mesures corporelles, horaires,
relations, objectifs, jetons ou contenu des sauvegardes.

## Sauvegarde locale

Une sauvegarde est un conteneur chiffré comprenant une copie SQLite cohérente, un
manifeste sans donnée personnelle et une authentification cryptographique. Le manifeste
contient seulement la version du format et du schéma, la date UTC, le nombre de tables et
les sommes de contrôle. Une sauvegarde n'est valide qu'après restauration et vérification
dans une base temporaire. Sa clé de récupération n'est jamais enregistrée avec elle.

La destination pourra être un fichier choisi par l'utilisateur ou Google Drive.

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
