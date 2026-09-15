# Audit du système source

Date de référence : 15/09/2026  
Commit de référence : `d9a24be613092955f8409002820df8585c658a05`

## État vérifié

- Dépôt Git propre sur `main`.
- 46 tests Python réussis.
- Journal de migrations `schema_migrations` déjà présent.
- Base PostgreSQL Neon et secours SQLite pris en charge.
- Authentification Google limitée par liste d'adresses autorisées.
- Secrets absents du dépôt public.

## Risques à corriger avant l'application mobile

### 1. Mise à jour complète d'une journée

`save_entry` réécrit toutes les colonnes de `daily_entries`. Une ancienne copie
locale peut donc remplacer une valeur plus récente. L'API mobile devra proposer
des mises à jour ciblées par étape et une vérification de version.

### 2. Collections remplacées intégralement

Les séances sportives et les relations sont supprimées puis recréées lors de
certaines sauvegardes. Il faudra donner un UUID à chaque élément et utiliser des
opérations unitaires idempotentes.

### 3. Modèle mono-utilisateur implicite

La date est actuellement la clé principale des journées et les tables ne portent
pas de `user_id`. Une table utilisateur et une propriété utilisateur devront être
ajoutées avant d'exposer une API.

### 4. Couplage avec Streamlit

Le service quotidien mélange état d'interface, persistance, progression et appel
OpenAI. Le domaine et les repositories devront être extraits avant réutilisation.

### 5. Concentration du code

- `checkin/controller.py` : environ 1 100 lignes.
- `app_life_dashboard_v4.py` : environ 940 lignes.
- `data_store.py` : environ 900 lignes.

Le découpage continuera par domaine, avec un test de non-régression après chaque
extraction.

### 6. Absence de synchronisation hors ligne

Le système ne possède pas encore de version serveur, clé d'idempotence, file
d'attente locale ou stratégie de conflit. Ces mécanismes sont obligatoires pour
la version Android.

## Décision d'architecture

- Application : React Native avec Expo et TypeScript.
- Stockage mobile : SQLite local, écrit avant tout appel réseau.
- Secrets et jetons : stockage sécurisé du téléphone.
- Serveur : API Python séparée devant Neon.
- Authentification : compte Google validé côté API.
- Streamlit : conservé comme bilan et solution de secours pendant la migration.

