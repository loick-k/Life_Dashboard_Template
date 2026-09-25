# Audit disque et nettoyage proposé — 25 septembre 2026

**Aucune suppression, aucun déplacement, aucune désinstallation effectués.**
Tailles logiques des fichiers (pas l'allocation NTFS) ; 1 Gio = 1 073 741 824 octets.
Base des chemins relatifs ci-dessous : `C:\Dev\Life_Dashboard_Public\mobile_app`.
Les sous-lignes incluses dans un total ne doivent pas être additionnées deux fois.

## Résultat principal

- mobile_app : **13 348 264 169 octets = 12,43 Gio / 13,35 Go décimaux**.
- Dépôt hors mobile_app : environ 1,1 Mo, dont `.git` 696 Ko. Aucun gros historique Git.
- C: : **5 107 556 352 octets libres = 4,76 Gio** au relevé. L: est un alias du même disque,
  pas un autre volume de stockage. Cette mesure remplace l'ancien constat de 425 Mo.
- SDK : 4,82 Gio, dont **deux NDK de 2,20 Gio chacun, tous deux actuellement utilisés**.
- node_modules : 2,06 Gio, dont **1,71 Gio de compilations natives** des modules Expo.
  Le problème principal n'est donc pas une liste npm manifestement superflue.

## Inventaire et décisions

« Faible » signifie sans risque pour le code et les données sous réserve d'arrêter
les outils utilisateurs du dossier. Cela ne garantit pas un prochain build sans réseau,
sans espace temporaire, ni aussi rapide. Ne nettoyer aucun dossier en cours d'utilisation.

| Chemin | Taille | Rôle / catégorie | Recréable | Risque | Gain potentiel | Suppression propre après accord | Restauration |
|---|---:|---|---|---|---:|---|---|
| `.tools/gradle-cache` | 3,027 Gio | Total caches et distribution | Oui | Rebuild/réseau | Jusqu'à 3,027 Gio | Préférer les sous-ensembles ci-dessous, pas tout le dossier | Wrapper Gradle puis build |
| `…/caches/9.3.1` | 2,130 Gio | Cache généré de la seule version Gradle présente | Oui | Faible hors build ; reconstruction lente | 2,130 Gio | Scope Caches | Build Gradle |
| `…/caches/9.3.1/transforms` | 1,933 Gio, inclus | Transformations Android, pas des sources | Oui | Invalidation des références CMake | Inclus ci-dessus | Nettoyer aussi Builds pour repartir de CMake cohérent | Build Gradle |
| `…/caches/9.3.1/generated-gradle-jars` | 182 Mio, inclus | API Gradle générée | Oui | Recalcul | Inclus ci-dessus | Scope Caches | Gradle |
| `…/caches/modules-2` | 769 Mio | Dépendances Maven téléchargées | Oui avec dépôts disponibles | Build hors ligne compromis | 769 Mio | Scope Dependencies | Build avec accès réseau |
| `…/wrapper` | 145 Mio | Gradle 9.3.1 téléchargé | Oui | Retéléchargement | 145 Mio non retenus | Conservation recommandée ; manuel après accord séparé | gradlew télécharge distributionUrl |
| `…/daemon`, `native`, `kotlin-profile` | ~4,2 Mio | Journaux et support Gradle | Oui | Peu intéressant | ~4,2 Mio non retenus | Conserver pour diagnostic | Gradle |
| `.tools/tmp`, cache `.tmp`, `jars-9`, `journal-1`, `android/.gradle` | ~9,6 Mio | Temporaires/caches supprimables | Oui | Faible, outils arrêtés | ~9,6 Mio | Scope Caches | Build |
| `.tools/android-sdk` | 4,818 Gio | Outils nécessaires au build natif | Oui avec réseau | **Élevé si retiré maintenant** | Aucun gain immédiat retenu | Ne pas supprimer globalement | Installation des versions ci-dessous |
| `…/ndk/27.1.12297006` | 2,199 Gio | NDK React Native et expo-modules-core, indispensable actuellement | Oui | Élevé | 0 retenu | Conserver | Android CLI / SDK Manager version exacte |
| `…/ndk/27.0.12077973` | 2,199 Gio | NDK **effectivement utilisé par expo-sqlite** | Oui | Élevé avant harmonisation | 2,199 Gio **conditionnels** | SDK Manager après unification et build validé | Réinstaller ndk/27.0.12077973 |
| `…/build-tools/36.0.0` | 136,6 Mio | Version RN et vérificateur APK | Oui | Élevé si retirée | 0 retenu | Conserver | build-tools/36.0.0 |
| `…/build-tools/35.0.0` | 138,2 Mio | Installée pendant build des modules ; pas prouvée obsolète | Oui | Retéléchargement possible par AGP | 138,2 Mio conditionnels, exclus des totaux | Vérifier modèles Gradle de tous les modules avant SDK Manager | build-tools/35.0.0 |
| `…/platforms/android-36` | 101,3 Mio | Unique plateforme, compilation API 36 | Oui | Build impossible si absente | 0 retenu | Conserver | platforms/android-36 |
| `…/cmake/3.22.1` | 37,5 Mio | Compilation C/C++ SQLite/React Native | Oui | Build impossible si absent | 0 retenu | Conserver | cmake/3.22.1 |
| `…/platform-tools` | 16,7 Mio | adb ; processus actif au relevé | Oui | Interruption des outils Android | 0 retenu | Conserver | platform-tools |
| `…/licenses`, `.sdk`, métadonnées | <1 Mio | État du gestionnaire SDK et licences | Partiellement | Inutile/dangereux à nettoyer à la main | 0 | Conserver | SDK Manager |
| system-images / emulator | Absents | Aucun émulateur installé dans ce SDK | — | — | 0 | Rien à retirer | Installation future seulement si nécessaire |
| `.tools/jdk-17.0.20.1+1` | 302,8 Mio | Unique JDK trouvé, indispensable | Oui | Build impossible si absent | 0 retenu | Conserver ; mutualisation proposée | Installateur vérifié |
| `.tools/android-cli23` | 170,8 Mio | Gestionnaire SDK | Oui | Recréation SDK indisponible | 0 retenu | Conserver | Installateur vérifié |
| `.tools/jdk17.zip`, `android-cli23.zip` | 329,8 Mio | Archives redondantes après extraction | Oui avec réseau | Faible ; perte du support d'installation hors ligne | 0,322 Gio | Scope Downloads, seulement si exécutable extrait existe | Installateur avec hashes vérifiés |
| `node_modules` | 2,061 Gio | Dépendances réinstallables + sorties natives | Oui via lockfile | Test/build indisponibles jusqu'à restauration | 2,061 Gio total, **pas en plus** des sous-lignes | Scope Dependencies | npm ci |
| `node_modules/expo-modules-core/android/build` | 1,083 Gio | Généré/recréable | Oui | Recompilation native | 1,083 Gio | Scope Builds | Build Android |
| `node_modules/expo-modules-core/android/.cxx` | 513,1 Mio | Cache CMake, chemins C: et L: anciens/actuels | Oui | Recompilation native | 0,501 Gio | Scope Builds | Build Android via alias stable L: |
| `node_modules/expo-sqlite/android/build`, `.cxx` | 133,1 Mio | Générés/recréables SQLCipher | Oui | Recompilation native | 0,130 Gio | Scope Builds | Build Android |
| node_modules hors ces quatre sorties | ~355,7 Mio | Dépendances et autres petits générés | Oui | npm requis | Gain additionnel ~0,347 Gio après Builds | Scope Dependencies | npm ci |
| `android` | 1,701 Gio | Projet natif généré, sources/config/signature debug et outputs | En partie | **Ne pas supprimer globalement** : modifications natives/clefs possibles | Voir sous-lignes | Liste blanche uniquement | Prebuild pour structure ; Gradle pour sorties |
| `android/app/build/intermediates` | 1,587 Gio | Objets et bibliothèques intermédiaires | Oui | Recompilation | 1,587 Gio | Scope Builds | Build Android |
| `android/app/.cxx`, `android/build`, `app/build/generated`, `tmp`, `kotlin` | ~18,2 Mio | Générés et configurations CMake | Oui | Faible hors build | ~18,2 Mio | Scope Builds | Build Android |
| `android/app/build/outputs/apk/debug/app-debug.apk` | 91,0 Mio | **Unique APK d'essai**, pas un ancien doublon | Oui, mais dernier artefact vérifié | Perte du livrable intermédiaire | 0 retenu | Conservé ; OldArtifacts ne retire jamais le plus récent | Build debug, résultat non byte-identique garanti |
| `.venv-tools` | 39,1 Mio | Dépendances Python réinstallables ; environnement signalé cassé | Oui | Export impossible jusqu'à restauration | 39,1 Mio optionnels, exclus | Manuel après vérification Python, pas dans le script | python -m venv puis requirements-tools.txt |
| `backups` | 338 Ko | Sauvegardes personnelles indispensables | **Non sans autre copie vérifiée** | **Critique** | 0 | **Jamais nettoyer** | Restauration depuis une copie validée |
| sources, migrations SQL, fixtures, tests, docs, package-lock, config | <1 Mio hors outils | Indispensables | Git pour fichiers déjà committés seulement | Élevé | 0 | Conserver | Git ne remplace pas les changements non committés |
| secrets, local_data, exports, clefs de signature | Taille non publiée | Potentiellement irremplaçables | Pas automatiquement | **Critique** | 0 | Toujours exclus du nettoyeur | Sauvegarde sécurisée séparée |

Les dossiers dist, web-build, .expo et autres gros temporaires n'apparaissent pas
dans l'inventaire présent. Pas d'AAB et un seul APK observés. Les répertoires V1
ne présentent aucun gain matériel et ne sont pas touchés.

## Références vérifiées et mutualisation

- package.json et lockfile v3 : 482 entrées de packages ; npm ls --depth=0 sans
  dépendance directe extraneous. Toutes les dépendances directes servent au runtime,
  aux types, au chiffrement, à la configuration Expo ou à la compilation. expo-system-ui
  est requis par la configuration Expo même sans import dans un écran. Aucun retrait
  npm justifié. Ne pas supprimer à la main les binaires multi-plateformes Hermes.
- settings.gradle inclut les plugins depuis node_modules. app/build.gradle utilise
  rootProject.ext.ndkVersion/buildToolsVersion ; RN libs.versions.toml fixe NDK 27.1
  et build-tools 36. Les CMakeCache.txt prouvent l'usage de 27.0 par expo-sqlite.
- gradle.properties permet quatre ABI par défaut ; le script limite le build à
  arm64-v8a,x86_64. Conserver une seule ABI pour un essai spécifique est une optimisation
  future, pas un changement silencieux de couverture de l'APK.
- wrapper Gradle : seule distribution 9.3.1. Pas d'anciennes versions Gradle à retirer.
- Pas de local.properties dans ce projet ni de configuration VS Code versionnée trouvée.
- Scripts build/verify imposent actuellement les chemins `.tools`. L'installateur
  conserve les hashes et versions fixes ; corrigé pour ne pas retélécharger une archive
  supprimée lorsque l'outil extrait existe déjà. Aucun téléchargement exécuté pour cet audit.
- JAVA_HOME, JDK_HOME, ANDROID_HOME, ANDROID_SDK_ROOT, GRADLE_USER_HOME et ANDROID_USER_HOME
  sont absents aux niveaux processus/utilisateur/machine. Aucun java/javac/adb/gradle/
  sdkmanager global trouvé dans PATH. Pas de SDK/JDK/Android Studio aux emplacements
  standards Program Files, C:\Android et LocalAppData\Android\Sdk vérifiés.
  Ce n'est pas une recherche exhaustive de tous les disques ou applications.
- `%USERPROFILE%\.android\cli\bundles` contient ~146 Mio de bundle Android CLI ;
  c'est un cache externe, pas un deuxième SDK/JDK complet démontré. Ne pas toucher aux
  adbkey/debug.keystore présents dans `.android`. Le nettoyeur ne sort jamais du dépôt.

**Mutualisation proposée, non exécutée :** une seule installation SDK et JDK dans
un chemin court partagé choisi, par exemple C:\DevTools\Android\Sdk et C:\DevTools\JDK17.
Réutiliser/déplacer l'installation existante, pas télécharger une copie. Adapter ensemble
build, verify et install pour accepter des chemins explicites et refuser une configuration
absente plutôt que télécharger silencieusement. Vérifier les projets consommateurs avant
de retirer un composant. Les caches CMake avec chemins absolus doivent être régénérés.
Un déplacement sur le même disque apporte **0 octet d'économie physique** : ne pas le
présenter comme le gain de nettoyage. Aucun déplacement ni changement d'environnement ici.

## Plan en trois niveaux — gains non cumulés deux fois

### Niveau 1 — caches uniquement, sans risque pour le contenu métier

Scope Caches : **2,139 Gio** récupérables, reste **10,292 Gio**.
Arrêter les builds/Gradle d'abord. Pour les caches transforms, reconstruire CMake en
associant ensuite Builds est recommandé. Les sorties et archives ne sont pas appelées
« caches » abusivement : elles sont des options distinctes.

Option faible risque supplémentaire Builds + Downloads : gain cumulé total
**5,780 Gio**, reste **6,652 Gio**. Préserve SDK/JDK, dépendances npm, modules Maven,
sources natives, clés et APK actuel. C'est le meilleur premier nettoyage proposé.

### Niveau 2 — dépendances réinstallables

Caches + Builds + Downloads + Dependencies : **6,877 Gio** récupérables au total,
reste **5,555 Gio** (5,96 Go décimaux). npm ci et les dépendances Maven seront nécessaires.
Le gain additionnel après la proposition précédente est seulement **1,097 Gio**,
car 1,71 Gio de node_modules sont déjà comptés dans Builds. Aucun intérêt à réinstaller
node_modules à chaque nettoyage : garder ses ~356 Mio utiles pour coder/tester hors ligne.

### Niveau 3 — harmonisation NDK et installation partagée

Préparer un pin NDK cohérent pour tous les modules via une configuration pérenne Expo/
Gradle, pas une édition jetable dans node_modules. Vérifier sur une compilation complète
et les contrôles SQLCipher avant de désinstaller 27.0 via le gestionnaire SDK.
Économie conditionnelle : **2,199 Gio**, pas disponible avant ce test.

- Niveau 1 étendu + NDK unifié : reste **4,453 Gio ≈ 4,78 Go**, sous la cible 5 Go,
  tout en gardant les dépendances npm utiles et Maven.
- Niveau 2 + NDK unifié : reste **3,356 Gio ≈ 3,60 Go**, pas sous 3 Go au total.
- Hors caches et dépendances/outils réinstallables, le code propre est déjà très loin
  sous 3 Go. Un SDK/JDK externalisé allège le dossier, pas le disque.
- Build-tools 35 et venv Python pourraient ajouter ~177 Mio conditionnels, mais ne sont
  pas nécessaires pour atteindre 5 Go après harmonisation et ne sont pas comptés.

Une reconstruction native recréera plusieurs Gio. On ne peut pas garantir <5 Go en
permanence pendant un build complet avec deux ABI. Prévoir une marge et mesurer après
chaque build plutôt que promettre un plafond irréaliste.

## Commandes et garde-fous livrés

Depuis mobile_app, **simulation seule par défaut** :

Le raccourci npm requiert PowerShell 7 (`pwsh`) dans PATH. Il est disponible dans
l'environnement de cet audit. Windows PowerShell 5 a refusé le script selon sa
politique locale ; aucune politique système n'a été modifiée ni contournée. Si pwsh
n'est pas dans le PATH de GitHub Desktop/du terminal personnel, ouvrir PowerShell 7
ou appeler son exécutable installé par son chemin absolu.

```powershell
npm run clean-dev-storage
.\scripts\clean-dev-storage.ps1 -Scope Caches,Builds,Downloads
.\scripts\clean-dev-storage.ps1 -Scope Caches,Builds,Downloads,Dependencies -Json
```

Après approbation explicite du plan affiché, ajouter `-Apply` ; confirmation PowerShell
globale demandée avant suppression. `-WhatIf` est également pris en charge. Aucune
commande avec `-Apply` n'a été exécutée lors de cet audit.

Liste blanche fixe ; pas de chemin libre fourni à supprimer ; contrôle des chemins
absolus, jonctions/symlinks, fichiers suivis Git et extensions sensibles ; arrêt si
processus de build ou processus Node du projet détecté. Aucun kill automatique.
Suppression définitive uniquement de générés, récupération par reconstruction, pas
par Corbeille. Ne pas démarrer de build pendant le nettoyage (limite TOCTOU habituelle).
SDK/JDK, clefs, données et APK le plus récent ne sont jamais sélectionnés.

Politique proposée : conserver les dépendances téléchargées, nettoyer Builds après
un jalon validé si nécessaire, pas avant chaque build ; conserver un chemin L: stable
pour éviter les variantes CMake C:/L:. Ne pas activer plusieurs caches Gradle globaux.
L'installateur ne télécharge plus une archive dont l'outil est déjà installé.
Le .gitignore couvre outils, builds, dépendances, logs et diagnostics locaux, mais
**gitignore ne limite pas l'occupation physique**.

Rétention prête, non activée : scope OldArtifacts sélectionne les APK debug de plus de
14 jours en conservant toujours le plus récent ; ne touche jamais aux releases.
Un appel non interactif avec -Apply -Confirm:$false pourra être ajouté à un workflow
**uniquement après approbation**. Aucun hook ni tâche automatique destructive installé.

Recréation après nettoyage :

```powershell
# Seulement si Dependencies a retiré node_modules :
npm ci
npm test
npm run typecheck
# Outils extraits absents seulement : installateur aux archives contrôlées.
.\scripts\install-android-tools.ps1
# SDK à reconstruire seulement après suppression explicitement approuvée :
.\.tools\android-cli23\cmdline-tools\bin\android.exe --sdk=C:\Dev\Life_Dashboard_Public\mobile_app\.tools\android-sdk sdk install platforms/android-36 build-tools/36.0.0 build-tools/35.0.0 ndk/27.1.12297006 ndk/27.0.12077973 cmake/3.22.1 platform-tools
.\scripts\build-android-debug.ps1
.\scripts\verify-android-apk.ps1 -ApkPath .\android\app\build\outputs\apk\debug\app-debug.apk -Variant Debug
```

Les licences Android doivent être acceptées si le gestionnaire le demande. L'ancienne
CLI sdkmanager.bat découpe mal certains identifiants sous cet environnement : utiliser
android.exe et la syntaxe slash déjà éprouvée. Les outils de signature restent hors Git.

## Sources et portée de validation

- [Gradle : structure et nettoyage des caches](https://docs.gradle.org/current/userguide/directory_layout.html).
- [Android : configuration du NDK](https://developer.android.com/studio/projects/configure-agp-ndk).
- [npm ci et lockfile](https://docs.npmjs.com/cli/v8/commands/npm-ci/).

Vérifications : mesures sur fichiers existants, configurations et CMakeCache lus,
npm ls, analyse syntaxique PowerShell, simulations Caches/Builds/Downloads et
Dependencies sans doublons ; OldArtifacts sélectionne zéro fichier (unique APK conservé).
Raccourci npm validé avec pwsh ; 35 tests applicatifs réussis. SHA-256 de l'APK inchangé.
La branche destructive du script n'a volontairement pas été exécutée.
Le code applicatif et
les versions du toolchain ne changent pas. Une reconstruction après suppression
n'est pas testée puisque **rien n'a été supprimé** ; elle reste une condition de
validation du nettoyage et de toute harmonisation ultérieure.
