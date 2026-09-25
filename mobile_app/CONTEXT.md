# Contexte de reprise du développement V2

Mis à jour le 25/09/2026. Lire les AGENTS.md avant de travailler.

## Objectif accepté

Développer une application Android autonome à stockage local, fidèle aux fonctions
et à l'interface Streamlit V1. Les deux versions doivent rester utilisables
indépendamment. La V1 conserve Neon ; la V2 conserve sa propre SQLite. Aucun
remplacement forcé de la V1 et aucune synchronisation automatique des deux bases.

## État vérifié dans le dépôt

- `d7f0aa3` : modèles Python et calculs métier dans `../domain/`.
- `fe942d1` : repositories SQL injectables, ciblant encore le schéma historique V1.
- `85f085a` : séparation de l'adaptateur Streamlit et de l'analyse nutritionnelle.
- `3db45cb` : schéma SQLite V2 et outils Python locaux de référence (étape 3A).
- Socle Expo SDK 57 / React Native 0.86.3 / TypeScript créé dans `mobile_app/`.
  Dépendances verrouillées, configuration SQLCipher/SecureStore et écran de
  développement sans saisie personnelle. Aucun APK compilé ni stockage ouvert.
- Chiffrement Android, sauvegarde chiffrée, restauration V2 et convertisseur
  d'import : architecture documentée, implémentation à réaliser.
- Les services Python n'ont pas tous leur indépendance transitive de Streamlit :
  `services/checkin_service.py` et `services/nutrition_service.py` importent encore
  la persistance V1. Ne pas les considérer comme un backend mobile prêt à livrer.

Historique de validation : 64 tests Python annoncés au lot 3A. Cela ne constitue
pas un test Android. Le scénario `tests/smoke_app.py` a échoué lors de l'étape 2
sur « champ poids introuvable » ; sa cause reste à établir avant toute affirmation
de parité complète. Ne pas masquer cet échec ni modifier V1 sans diagnostic.

## Prochain lot concret

Les migrations Python de référence et leur journal sont maintenant atomiques
(`BEGIN IMMEDIATE`, rollback sur interruption, synchronisation FULL). Les commandes
de transaction dans une migration sont refusées avant exécution. Neuf tests passent
le 25/09/2026 : journal refusé, reprise après réouverture, interruption, checksum,
transaction appelante préservée, refus de COMMIT et corps de trigger, plus les trois
tests de schéma existants. Ce résultat ne valide ni Android ni le chiffrement.

Prochain travail : créer le runtime Expo/TypeScript et porter le contrat de
stockage vers SQLite natif chiffré, avec repositories ciblés et contrôle de révision.
Éviter de développer deux applications complètes Python et TypeScript : Python
reste une référence de schéma et de calculs pour les tests de concordance.

Ensuite : import synthétique V1 vers V2, socle Android, chiffrement, formulaires,
sauvegardes/restauration, bilans/PDF, intégrations optionnelles, validation téléphone.
Le détail et les critères de sortie figurent dans [le plan](docs/02_plan_migration.md).

## Références fonctionnelles V1

- `../app_life_dashboard_v4.py` : navigation, style, bilan et réglages.
- `../checkin/controller.py` et `../checkin/steps/` : parcours quotidien et widgets.
- `../app_config.py` : étapes et constantes.
- `../work_tracking.py`, `../dashboard_metrics.py`, `../work_report.py` : calculs et PDF.
- `../todoist_view.py`, `../nutrition_analysis.py` : intégrations.

Inventorier la parité avant le portage : sommeil/sieste, alcool, poids, masse
graisseuse, tour de ventre, trois créneaux de travail et solde cumulé, sport et
distances, portable, alimentation et kcal, temps pour soi, écoute, relations,
objectifs, historique, bilans, PDF, Todoist et réglages. La V1 observable fait foi
pour compléter cette liste et les cas limites.

## Commandes utiles

Depuis la racine du dépôt, avec un Python contenant les dépendances nécessaires :

```powershell
git status --short
python -m unittest tests.test_mobile_local_database -v
python -m unittest tests.test_domain tests.test_repositories -v
python -m unittest discover -s tests -p "test_*.py"
python tests/smoke_app.py
```

`python` n'était pas disponible dans PATH lors des précédents lots. Utiliser un
interpréteur existant vérifié ou un environnement dédié ; ne pas modifier celui
de la V1. Les tests de PDF exigent notamment `reportlab` et `pypdf`. Le dossier
`mobile_app/.venv-tools` est destiné aux outils d'export ; vérifier ses dépendances
avant de le réutiliser.

Depuis `mobile_app/` : `npm ci`, `npm test`, `npm run typecheck`,
`npm run prebuild:android`, `npm run android`. Désactiver la télémétrie Expo avec
`EXPO_NO_TELEMETRY=1`. Aucun service de build cloud n'a été utilisé.

## Validation du socle Expo (25/09/2026)

- TypeScript : réussi ; deux tests de configuration réussis (pas des tests natifs).
- Prebuild Android : réussi ; propriété SQLCipher true et allowBackup false
  observées dans les fichiers générés. Permissions externes inutiles bloquées
  dans app.json ; régénérer puis vérifier le manifeste fusionné à la compilation.
- `npm audit --omit=dev` : zéro vulnérabilité après override ciblé xcode/uuid
  vers 11.1.1 (GHSA-w5hq-g745-h8pq). Appel generateUuid validé sur un objet
  synthétique et prebuild Android réussi. Ne pas rétrograder Expo via audit fix.
- Java/adb absents du PATH ; SDK Android non installé à l'emplacement standard.
- expo-system-ui installé ; nouveau prebuild réussi sans cet avertissement.
- Matrice initiale : docs/06_parite_v1_v2.md ; aucun écran métier porté encore.
- Prochain lot : environnement Android local, ouverture SQLCipher/Keystore et
  migrations TypeScript, puis formulaires et assistant. Pas de données réelles.

## Ouverture sécurisée — code ajouté, validation native restante

`src/storage/secureOpening.ts` coordonne une ouverture unique, persiste la clé
avant création de fichier, refuse une base existante sans clé et conserve fichiers
et clé en cas d'erreur. L'adaptateur natif utilise 32 octets aléatoires, SecureStore,
SQLCipher obligatoire, lecture du schéma et integrity_check avant les écritures.
Il est maintenant appelé depuis l'écran de développement (aucune donnée personnelle
collectée) et applique les migrations avant d'afficher prêt.
Onze tests Node réussis au total et TypeScript valide. Les tests de clé utilisent des
ports simulés : ils prouvent l'ordre et le refus sûr, PAS le chiffrement Android.
Les clés ne sont jamais renouvelées automatiquement après une erreur de lecture.

Attention pour les migrations natives : les transactions exclusives Expo ouvrent
une autre connexion ; vérifier l'application de la clé SQLCipher sur cette connexion
ou utiliser une transaction sérialisée sur la connexion déjà déverrouillée.

## Migrations TypeScript et préparation de compilation

`scripts/bundle-migrations.mjs` transforme les SQL de référence en JSON embarqué
avec SHA-256 normalisé LF (même convention Python). `migrate()` crée schéma et
journal sur la connexion déverrouillée, dans BEGIN IMMEDIATE, avant de donner
accès aux repositories. Les tests Node SQLite réels couvrent rejeu, journal en
échec, checksum modifié et refus d'un schéma futur. Validation Android restante.

JDK Temurin 17.0.20.1+1 et Android CLI 23 téléchargés et contrôlés via checksums
officiels, isolés sous `.tools/` (ignoré). Scripts reproductibles dans `scripts/`.
Commande composants : `.tools/android-cli23/cmdline-tools/bin/android.exe`
avec `--sdk=<chemin absolu .tools/android-sdk> sdk install platforms/android-36
build-tools/36.0.0 ndk/27.1.12297006 cmake/3.22.1`. La commande sdkmanager.bat de
cette distribution découpe mal les anciens identifiants avec point-virgule ;
utiliser android.exe et les chemins avec slash.

`scripts/build-android-debug.ps1` prépare uniquement un APK de développement, pas
une livraison autonome. Aucun APK encore compilé. Tester la fin d'installation
SDK puis exécuter ce script ; le build release et sa signature restent à réaliser.
Composants API 36, build-tools 36.0.0, NDK 27.1.12297006 et CMake 3.22.1 présents
et contrôlés par existence de leurs exécutables/metadata. Android CLI a retourné
1 malgré des extractions terminées : vérifier les erreurs du build avant de
conclure à une installation pleinement validée. Première compilation lancée.

## Écritures quotidiennes TypeScript

`DailyEntries` crée une journée à UUID stable et applique uniquement les champs
explicitement fournis. UPDATE RETURNING avec contrôle de révision refuse les
vues anciennes sans écrasement. Champs inconnus/valeurs invalides refusés, undefined
omis, null suppression, zéro valeur réelle. Les six horaires sont conservés même
incomplets ; la durée dérivée est recalculée dans la même mise à jour atomique.
Le domaine travail porte les minutes précises, nuit et cible 462 minutes.
18 tests Node réussis, TypeScript valide ; tests de réouverture sur fichier réel
synthétique, conflits, null/zéro et trois créneaux. Aucune interface de saisie
encore connectée : sport, progression, social, objectifs, assistant restent à faire.

Vérification du 25/09/2026 : `.venv-tools` ne démarre plus car son Python de base
est indisponible. Les neuf tests SQLite ont été exécutés avec le Python du runtime
Codex (`.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`),
sans dépendance tierce et sans modifier l'environnement V1.

## Exigences de livraison complémentaires

- React Native, Expo et TypeScript ; pas de Streamlit/WebView ni serveur Python.
- APK release signé stable, autonome, SHA-256 et guide de reconstruction.
- Assistant français reprenable : données vides/import/restauration, préférences,
  travail, protection locale/biométrie, récupération et intégrations facultatives.
- Parcours minimal entièrement hors ligne et sans compte ni secret externe.
- Sauvegarde chiffrée authentifiée restaurable sur un autre téléphone : récupération
  indépendante du Keystore d'origine ; clés et jetons exclus de Git et des exports.
- Import réel, push, build cloud et déploiement nécessitent un accord explicite.
- Vérification d'installation, fermeture forcée, mise à jour et restauration sur
  Android obligatoire ; APK et matrice de parité restent à réaliser.

## Données réelles et Git

Les exports et bases restent dans des chemins ignorés (`backups/`, `local_data/`).
Ne pas lire ni publier leur contenu pour une tâche d'architecture. L'import réel
sera contrôlé avec l'utilisateur ; les préparatifs utilisent des fixtures fictives.
Vérifier la branche, le remote et les commits non poussés au début de chaque lot ;
ce document ne garantit pas l'état distant. Commit à chaque lot, push sur demande.
