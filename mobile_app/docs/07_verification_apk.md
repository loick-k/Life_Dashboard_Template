# Vérification des artefacts Android

Depuis `mobile_app/`, compilation locale de développement :

```powershell
.\scripts\build-android-debug.ps1
.\scripts\verify-android-apk.ps1 -ApkPath .\android\app\build\outputs\apk\debug\app-debug.apk -Variant Debug
```

Le script utilise les outils isolés `.tools/` (JDK, aapt et apksigner). Il ne
contacte aucun service externe, n'installe pas l'APK et ne lit pas de données métier.
Le SHA-256 affiché identifie exactement le fichier contrôlé. L'APK et les outils
restent ignorés par Git.

Pour un futur APK autonome, employer `-Variant Release` (valeur par défaut).
Le contrôle exige un bundle JavaScript embarqué, une signature valide, le bon
identifiant, l'absence de mode debug, de permission overlay, de trafic HTTP
explicitement permis et de permissions générales de stockage externe. Les deux
ABI actuellement compilées et le module natif SQLite sont contrôlés.

Ce contrôle statique n'atteste pas la confidentialité effective de la base,
l'identité de la clé de livraison, la continuité des mises à jour, le comportement
des sauvegardes Android ni la parité fonctionnelle. Ces vérifications restent des
tests distincts. Une signature debug valide ne constitue pas une signature de livraison.

## Premier artefact du 25/09/2026

- Debug 0.1.0 (code 1), API minimale 24 / Android 7.0.
- 95 416 222 octets, arm64-v8a et x86_64.
- SHA-256 : `FC1047600624DB216C7FB44B455306821BA60B7F81DCE706DD18AF3AEF00701F`.
- Signature vérifiée ; backup désactivé dans le manifeste fusionné.
- Absence de bundle embarqué : connexion Metro obligatoire.
- Overlay et cleartext présents dans le manifeste debug : réservés au développement.
- Test négatif : le vérificateur Release rejette cet APK debuggable.
- Aucun essai d'installation ou d'exécution Android encore effectué.

Ne pas utiliser de données personnelles dans cet artefact intermédiaire.
