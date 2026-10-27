# Préparation de l'APK autonome — 27/10/2026

Ce lot prépare une **version d'essai 0.2.0 / code 2**, pas une livraison finale.
La V1, Neon et les données personnelles ne sont pas concernés. Aucun push.

## Ce qui est prêt

- Parcours initial et quotidien accessibles aussi en production, plus seulement
  sous `__DEV__`. L'avertissement de version d'essai et les limites restent affichés.
- Plugin Expo versionné : captures/récents bloqués par FLAG_SECURE avant le rendu
  React, backup Android et HTTP en clair interdits, signature release debug retirée.
- Hook Gradle versionné : signature locale obligatoire pour les tâches release,
  aucun fallback à la clé debug. Configuration privée absente/invalide => arrêt.
- Certificat RSA 3072 bits de livraison créé localement ; clé et mots de passe
  hors dépôt, dossier accessible uniquement au compte Windows courant et SYSTEM.
  L'empreinte publique attendue est contrôlée par le vérificateur APK.
- `verify-android-apk.ps1 -Variant Release` exige le certificat attendu, une signature
  valide, un bundle embarqué et l'absence de debug, overlay, backup et HTTP en clair.
- Configuration release et graphe Gradle **hors ligne** réussis avec `--dry-run` :
  2 min 20, puis 30 s avec le script final ; 28 tâches d'outillage déjà à jour. Les tâches applicatives sont SKIPPED :
  ce n'est PAS une compilation native release réussie.
- Bundle **Hermes de production** généré hors ligne (687 modules, environ 1,9 Mo),
  sans Metro à l'exécution. Ce fichier seul n'est pas un APK et ne valide pas Android.

## Signature : conservation indispensable

Depuis `mobile_app/`, PowerShell 7 :

```powershell
.\scripts\prepare-android-signing.ps1
```

Par défaut : `%LOCALAPPDATA%\LifeDashboard\signing\` avec un PKCS12, le certificat
public et `signing.local.json`. Les mots de passe aléatoires sont en clair dans ce
JSON privé, protégés par les ACL Windows : ne pas le partager, le capturer ou le
copier dans Git. Sauvegarder **tout le dossier** dans un coffre chiffré hors de ce PC.
Le script refuse de remplacer un dossier existant incomplet. Il réutilise la clé
existante au lieu d'en produire une nouvelle à chaque build.

Perdre cette clé empêche les mises à jour compatibles. Une APK signée release ne
mettra pas à jour l'ancienne APK signée debug : utiliser un appareil de test vide ou
vérifier une sauvegarde récupérable avant toute désinstallation. Ne jamais demander
de désinstaller une application contenant les seules données personnelles.

## Commandes reproductibles sans téléchargement

```powershell
npm test
npm run typecheck
npm run prebuild:android
.\scripts\verify-standalone-bundle.ps1
.\scripts\build-android-release.ps1          # plan uniquement
.\scripts\build-android-release.ps1 -DryRun  # configuration/graphe, pas l'APK
```

SDK/JDK/NDK, Gradle et npm déjà installés sont réutilisés. Pas de nouvel émulateur,
d'installation npm/SDK/JDK, de service cloud ou de déplacement de plusieurs Go.
Prébuild sûr : sur un dossier Android existant, appliquer uniquement les mods Expo.
Refuser un projet incomplet ; ne pas relancer automatiquement `expo prebuild --clean`.
L'appel de configuration interne est spécifique à Expo 57 verrouillé dans le lockfile :
le retester avant toute mise à niveau de l'outillage.

La compilation réelle utilise `-Execute -PeakAdditionalBytes <pic justifié>` et les
deux ABI existantes arm64-v8a/x86_64. **Ne pas inventer une estimation pour passer le
garde-fou.** Le premier pic release n'est pas encore établi : compilation complète
non lancée à ce stade. Le script n'autorise ni téléchargement implicite ni signature
debug pour contourner un échec.

Le contrôle final prend `-ExpectedSignerSHA256` depuis la configuration privée,
sans exposer les mots de passe :

```powershell
$signing = Get-Content "$env:LOCALAPPDATA\LifeDashboard\signing\signing.local.json" -Raw | ConvertFrom-Json
.\scripts\verify-android-apk.ps1 -ApkPath .\android\app\build\outputs\apk\release\app-release.apk -Variant Release -ExpectedSignerSHA256 $signing.certificateSha256
```

## Budget disque et incident de prébuild

Plafond utilisateur inchangé : 5 000 000 000 octets supplémentaires cumulés depuis
le relevé du 26/09, avec 1 Go de marge. Les opérations légères de ce lot utilisent
une enveloppe prudente de 500 Mo, une seule à la fois. Temp et caches de bundling
redirigés dans `.tools/tmp`. Contrôle avant, pendant et après ; arrêt du seul arbre
de processus lancé en cas de seuil ou d'erreur de surveillance. Aucun quota Windows
dur n'est installé : ce contrôle échantillonné ne garantit pas un pic arbitraire.

Lors du premier essai, Expo a considéré l'ancien `android/` incomplet et l'a
automatiquement régénéré, **sans option --clean**. Origine exacte de son diagnostic
non établie. L'APK debug original a été rétabli depuis la copie préservée, empreinte
identique `FC1047600624DB216C7FB44B455306821BA60B7F81DCE706DD18AF3AEF00701F`.
Les sources natives sont régénérées ; leurs anciens intermédiaires ne sont plus
tous disponibles. SDK/JDK/NDK, dépendances, sauvegardes et données conservés.
Le script `prebuild-android-safe.cjs` empêche désormais ce chemin de suppression,
avec un test sur répertoire natif synthétique volontairement incomplet.

L'arbre mesuré a ensuite baissé d'environ 3,4 Go, caches compris. Ce gain ne renouvelle
PAS le budget : réserve conservatrice de 4 Go pour initialiser le suivi, plus 100 Mo
pour Git, petits fichiers externes et dérive de mesure. Le registre ignoré
`.tools/dev-storage-ledger.local.json` compte ensuite chaque augmentation mesurée,
sans décrément après réduction de cache. Ne pas supprimer/réinitialiser ce registre.
Si d'autres opérations créent de gros fichiers externes, les ajouter au suivi avant
de continuer ; les scripts ne prétendent pas surveiller toutes les applications du PC.

## Avant de livrer

Établir le pic de compilation release dans le budget restant, puis générer et vérifier
l'APK signé, son SHA-256 et son certificat. Tester sur téléphone : premier lancement
hors réseau/Metro, SQLCipher, biométrie et annulation, arrière-plan, brouillons,
fermeture forcée, sauvegarde/restauration, import synthétique et mise à jour conservant
les données. Aucun appareil adb détecté lors de ce lot. Les écarts fonctionnels V1/V2
et la période d'observation restent ouverts (docs/09_etat_developpement.md).
