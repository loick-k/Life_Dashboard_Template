# Prototype de protection biométrique locale

Un prototype de protection biométrique est présent dans le code. La décision de
produit reste ouverte : biométrie, chiffrement et politique de récupération doivent
être évalués ensemble avant de retenir un comportement pour les utilisateurs. Ce
document décrit l'implémentation actuelle à auditer ; il n'engage pas la politique
finale. Voir [`15_decision_v2_locale_sans_compte.md`](15_decision_v2_locale_sans_compte.md).

Les points ci-dessous consignent le comportement du prototype et ses hypothèses,
pas une consigne de sécurité adoptée. Ne pas présenter cette option comme requise
ou validée avant la revue de sécurité et les essais Android.

- Activation facultative depuis l'assistant ou Réglages > Protection biométrique.
- Utilise expo-secure-store déjà installé, sans nouvelle dépendance. La biométrie
  forte doit être disponible et enregistrée sur Android ; aucun code PIN maison.
- La clé SQLCipher reste identique : copie sous un nouveau service Keystore avec
  `requireAuthentication`, relecture authentifiée, politique transitoire persistée,
  suppression de l'ancienne copie, puis confirmation. Deux demandes système peuvent
  apparaître à l'activation. Aucune donnée métier ni migration SQLite n'est modifiée.
- Si une interruption survient après changement de politique, une authentification
  reste obligatoire. La prochaine ouverture termine la suppression de l'ancienne
  copie. Pas de retour automatique à cette copie si la biométrie échoue.
- Désactiver exige une authentification, puis une copie vérifiée dans le stockage
  sécurisé standard avant le changement de politique. Une interruption peut laisser
  temporairement deux copies : la politique conserve l'autorité et la prochaine
  ouverture protégée supprime la copie standard si la transition n'était pas terminée.
- Politique inconnue, clé absente/invalidée, annulation ou erreur : refus d'ouverture,
  jamais nouvelle clé pour une base existante. Pas de mot de passe de secours embarqué.

Au retour d'arrière-plan, une couverture opaque bloque les interactions et masque
les enfants à l'accessibilité. Une authentification devenue périmée pendant un
passage en arrière-plan ne révèle pas l'écran. Les éditeurs restent montés pour
conserver leurs brouillons et laisser les écritures déjà engagées se terminer.
La connexion SQLCipher reste donc ouverte en mémoire tant que le processus vit :
ceci n'est pas une protection contre un OS rooté, un débogueur ou une mémoire compromise.
La clé n'est pas conservée dans un cache JavaScript de session après ouverture.

La politique et les clés sont dans SecureStore, jamais dans les exports portables.
Changer les empreintes/le verrouillage Android peut invalider la clé protégée.
Avant activation : créer une sauvegarde chiffrée vérifiée et garder le code hors
du téléphone. En cas d'invalidation définitive, conserver l'installation existante
et tester la restauration de cette sauvegarde sur un autre appareil. Ne pas effacer
les données ni désinstaller avant d'avoir une récupération vérifiée. Il n'existe
volontairement aucun contournement permettant d'exporter la base verrouillée.

## Vérifications

8 nouveaux tests injectent les ports Keystore : annulation, mauvais résultat,
matériel indisponible, politique inconnue, clé invalidée, activation/désactivation
interrompue, absence de fallback, accès concurrents, résultat d'authentification périmé.
69 tests Node et TypeScript passent. Ces tests ne simulent pas les garanties matérielles.

Sur téléphone avec données fictives : activation, annulation, verrouillage par écran
éteint/Accueil/récents, déverrouillage, brouillon incomplet conservé, relance forcée,
refus après modification des empreintes, restauration sur installation distincte,
désactivation authentifiée et mise à jour APK sans perte. Ne pas changer les empreintes
sur un appareil contenant les seules données réelles pour effectuer ce test.
