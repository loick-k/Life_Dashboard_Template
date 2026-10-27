# Contexte de reprise du développement V2

Mis à jour le 27/10/2026. Lire les AGENTS.md avant de travailler.

## Objectif accepté

Développer une application Android autonome à stockage local, fidèle aux fonctions
et à l'interface Streamlit V1. Les deux versions doivent rester utilisables
indépendamment. La V1 conserve Neon ; la V2 conserve sa propre SQLite. Aucun
remplacement forcé de la V1 et aucune synchronisation automatique des deux bases.

## État vérifié dans le dépôt

### Préparation autonome et signature — 27/10/2026

Version source 0.2.0/code 2, parcours d'essai accessible aussi en production.
Plugin Expo reproductible : FLAG_SECURE avant React, backup/cleartext interdits,
suppression de la signature debug en release. Hook Gradle exige configuration
privée et script crée/réutilise une clé RSA3072 dans %LOCALAPPDATA%/LifeDashboard/signing,
hors Git, ACL compte Windows + SYSTEM. Aucun mot de passe affiché. La sauvegarde
de ce dossier privé dans un coffre hors PC reste à faire par l'utilisateur.
Vérificateur APK compare le certificat attendu ; ancien debug rejeté en release.

Configuration/graphe Gradle release --offline --dry-run réussis (2m20 puis 30s, 28 tâches
d'outillage à jour), PAS une compilation native applicative. Bundle Hermes production
687 modules, 1 924 263 octets, SHA256
39893BE9FCD970DB2D3CCBC944368A9FB2350521ABF13F9F9C159C7E9A5D883A.
74 tests Node, TypeScript et 10 tests Python locaux réussis. Aucun nouveau
téléchargement, dépendance, Neon, import réel ou push. Aucun appareil adb détecté.

Incident : Expo a jugé l'ancien android/ incomplet et l'a régénéré sans --clean,
retirant ses intermédiaires et son APK. Diagnostic initial exact non établi.
APK debug rétabli depuis artifacts/preserved et empreinte/signature revérifiées,
identique FC1047600624DB216C7FB44B455306821BA60B7F81DCE706DD18AF3AEF00701F.
SDK/JDK/NDK, dépendances et données conservés. Prébuild sûr ajouté : configuration
des mods seulement sur projet existant ; dossier incomplet => refus sans suppression,
avec test synthétique. Ne jamais relancer automatiquement le prébuild Expo standard.

Dernier relevé : mobile_app 8 444 672 051 octets, C: libre 13 166 698 496 octets.
La baisse d'anciens caches (~3,4 Go depuis référence) ne renouvelle pas le budget.
Suivi conservateur : réserve initiale 4 Go + 100 Mo externes, puis registre monotone
.tools/dev-storage-ledger.local.json ; 700 048 062 octets comptabilisés / plafond
5 Go, marge d'arrêt 1 Go. Ne pas effacer ce registre. Scripts release/bundle refusent
un pic inconnu/excessif, surveillent l'arbre lancé et redirigent les temp dans .tools.
Le pic natif release complet reste inconnu : build complet NON lancé ; ne pas fournir
une estimation inventée pour contourner la limite. Aucun nouvel APK livré, ancien
debug conservé ; prochaines gates : pic de build justifié et tests téléphone fictifs.
Voir docs/13_preparation_apk_autonome.md et docs/12_protection_biometrique.md.

### Protection biométrique — 27/10/2026

Clé SQLCipher migrable vers un service SecureStore/Keystore distinct exigeant la
biométrie forte. Copie/relecture avant politique transitoire, suppression de l'ancien
secret, reprise après interruption ; désactivation authentifiée. Politique inconnue,
clé invalidée/absente et annulation refusées sans fallback ni remise à zéro. Aucun
changement de schéma ou accès aux données réelles, aucune dépendance supplémentaire.
Écran branché aux Réglages après flush et à l'assistant. Couverture opaque au retour
d'arrière-plan, éditeurs maintenus pour préserver leurs brouillons/écritures ; résultat
d'authentification périmé refusé. Connexion native chiffrée reste en mémoire pendant
la session : pas de prétention de résistance à un OS compromis. Sauvegarde préalable
et risque d'invalidation des empreintes explicités. Voir docs/12_protection_biometrique.md.
69 tests Node (8 nouveaux) et TypeScript réussis. Validation biométrique réelle,
captures/récents et reprise Android encore à faire ; aucun APK reconstruit par ce lot.

### Import V1 vers V2 — 27/10/2026

Convertisseur TypeScript et route V1ImportScreen ajoutés à l'assistant et aux
Réglages. Un outil Node prépare UN fichier .ldv1.json depuis un dossier d'instantané
explicitement choisi, vérifie manifeste/compteurs/chemins, retire les réglages
inconnus et refuse d'écraser un fichier existant. Aucun dossier de données réelles
n'a été lu ; les tests construisent leurs propres instantanés synthétiques.

Conversion : UUID déterministes par origine/table/clé ; heures => minutes,
waist_cm => belly_cm seulement si belly absent, séances partielles/distance zéro,
horaires isolés/3 créneaux, relations et notes, actifs/archives, estimations
nutritionnelles, préférences et progression historique versions 1→5 vers IDs V2.
Dates métier inchangées ; horodatages techniques avec fuseau normalisés UTC ;
dates techniques ambiguës remplacées par date de l'export avec avertissement et
source intégrale archivée. Durée de travail enregistrée V1 prioritaire sur un
recalcul différent, avec avertissement ; aucune correction silencieuse.

Migration additive 004_v1_import : journal et archive source (8→10 tables portables
de sauvegarde, 12 tables SQLite au total). Les tâches locales anciennes, journaux
API et migrations V1 sont archivés sans exécution SQL ni fausse intégration Todoist.
Archives et reçus inclus dans les sauvegardes V2 ; un rejeu après restauration est
toujours idempotent. Sauvegardes V2 antérieures à 004 restaurables via l'ajout connu
de tables vides ; autres migrations futures/checksums inconnus toujours refusés.

Politique : simulation transactionnelle (rollback), puis confirmation explicite
avec empreinte du fichier. Même export rejoué => aucune réécriture des données
métier, même après correction V2. Nouvelles dates ajoutables ; une date déjà native
V2 ou un groupe de journée V1 modifié depuis le premier import bloque TOUT le lot.
Pas de fusion implicite, de suppression par absence dans un export suivant ou de
réactivation d'un élément effacé en V2. Les archives originales permettent un futur
arbitrage explicite. Valeurs/colonnes source inconnues, relations invalides et
plus de 3 objectifs actifs => refus atomique, jamais troncature.

61 tests Node et TypeScript valides ; 10 tests Python locaux valides. 5 scénarios
d'import + 1 de compatibilité sauvegarde : simulation, fichier consolidé réel via
CLI, Unicode/null/zéro/horaires partiels, unités, progression versions 1..5,
archives, réouverture, corrections V2 puis rejeu, export suivant, interruption SQL,
collision, relation manquante, checksum altéré, secret exclu et chemin traversant.
Une régression du contrôle des noms de colonnes (sha256 contient des chiffres) a
été corrigée puis toute la suite est repassée. Aucune dépendance/téléchargement,
aucun nouveau build APK, accès Neon ou import personnel. Validation Android reste
à faire. Commandes et limites : docs/11_import_v1_v2.md.
Dernier relevé : mobile_app 11 844 853 980 octets, +229 991 octets depuis la
référence du budget disque ; C: libre 10 881 851 392 octets. Hors petits fichiers
Git/npm ; aucun cache lourd ni outil supplémentaire ajouté par ce lot.

### Assistant initial relié au parcours d'essai — 27/10/2026

OnboardingScreen est appelé automatiquement au premier lancement en __DEV__ :
7 étapes françaises, progression persistante, Retour/Continuer, préférences avec
flush avant navigation, restauration V2 réelle via BackupScreen, création de
sauvegarde facultative et récapitulatif relu depuis SQLite. Un état completed
ouvre ensuite directement le point quotidien, sans rejouer l'assistant.
Choix supplémentaire existing pour conserver les données déjà présentes ; vide
refusé si des journées/personnes/objectifs existent, aucune remise à zéro implicite.
Restore-v2 n'est enregistré qu'après succès de la restauration. L'import V1 reste
indisponible ; un ancien choix import-v1 ne permet pas de prétendre avoir importé.

Retour Android délégué aux sous-écrans pour préserver leur flush/verrou d'opération.
Échec d'avancement après restauration distingué d'une restauration échouée : les
données déjà restaurées ne sont pas présentées comme annulées. Les réglages
acceptent maintenant des callbacks de navigation asynchrones et les attendent.
Terminer enregistre completed avant l'ouverture du tableau de bord d'essai.

Le parcours minimal peut être testé hors réseau et sans jeton externe. Protection
à ce stade = SQLCipher + clé SecureStore + verrouillage Android existant. L'écran
explique explicitement que la biométrie supplémentaire de l'application et les
intégrations restent indisponibles. Ce lot ne les valide ni ne les implémente.
Le mode release reste sur l'écran de développement en attente des gates natifs ;
ne pas présenter cet assistant comme validation complète de la première utilisation.
55 tests Node et TypeScript réussis ; 1 nouveau test préserve entrées/préférences
avec le choix existing et relecture. Écrans/Back/SAF non exécutés sur Android.
Budget : précédent relevé après sauvegarde +145 871 octets depuis la référence ;
ce lot ajoute seulement du code/documentation de quelques Ko. Aucun téléchargement,
nouvelle dépendance, compilation native ou accès aux données réelles.

### Sauvegarde V2 chiffrée et restauration — 27/10/2026

Reprise depuis 8aab719, dépôt propre. Nouveau service captureSnapshot : copie
logique des 8 tables de données sous transaction unique, journal de migrations
comparé au code, préférences/curseurs exportés par liste blanche. Secrets,
configuration de verrouillage et état de l'assistant exclus. Aucun accès Neon.
Chiffrement AES-256-GCM avec Expo Crypto déjà installé : nonce aléatoire 12 octets,
tag 16 octets et en-tête de format authentifié. Code de récupération aléatoire
256 bits indépendant de la clé de la base, jamais persisté par ce service.
Restauration via code (pas de mot de passe court/dérivation cryptographique maison).

Avant succès : déchiffrement, restauration dans une SQLite temporaire chiffrée sur
Android, comparaison de toutes les valeurs/relations, écriture du fichier puis
relecture identique. backup_history reçoit verified uniquement après ces étapes.
Restauration réelle : prévalidation temporaire puis remplacement transactionnel
des seules données portables ; erreur/contrainte/interruption => rollback.
Schéma/journal et configuration appareil conservés. Le service exige une route
dédiée après flush/unmount des éditeurs ; entrée depuis Réglages implémentée.

BackupScreen : génération/recopie du code, choix du dossier système, sélection du
fichier, confirmation de remplacement, état vérifié et dernière sauvegarde.
Départ/Retour Android bloqués pendant l'opération ; pas d'export en clair sur disque.
Limites explicites : 8 Mio de copie logique, fichier 24 Mio, format 1/schema exact.
Une future version devra ajouter les migrations de format ; pas de saut silencieux.

54 tests Node réussis et TypeScript valide. Quatre nouveaux tests sur AES-GCM réel
Node/SQLite : aller-retour Unicode/null/zéro/horaires partiels, nouveau fichier et
réouverture, exclusion des secrets, mauvaise clé, altération IV/tag/chiffrement,
interruption SQL après suppression avec rollback, relations/colonnes/réglages
invalides et succès jamais annoncé après annulation/échec de fichier/test restore.
L'adaptateur Expo AES, le sélecteur système et SQLCipher temporaire ne sont PAS
encore exécutés sur Android. Aucune nouvelle dépendance, compilation ou données
réelles. Prochain travail : relier l'assistant et la protection locale, puis tester
le parcours natif et préparer le build autonome. Voir docs/10_sauvegarde_locale_v2.md.

### Bilans hebdomadaires multirubriques — lot repris après interruption

27 séries locales ajoutées dans domain/weeklyMetrics.ts et branchées à Bilan :
corps, sommeil/sieste, alcool, sport/distance/séances partielles, portable,
nutrition/kcal nettes, temps pour soi, écoute, interactions et objectifs travaillés.
Moyennes sur valeurs présentes seulement, dernière valeur corporelle DE LA SEMAINE,
totaux partiels explicitement libellés. Absence reste null/n.c., zéro reste réel.
Kcal nettes calculées uniquement si apports ET calories sportives sont présents.
Les compteurs de journaux mesurent les lignes saisies, pas l'absence d'activité réelle.
Requête unique des valeurs/journaux avec sous-requêtes indépendantes : pas de
multiplication des séances par les relations sociales/objectifs. Archives conservées.
Courbes natives pour le corps, barres signées pour les autres séries, trous non
reliés, choix tactile de catégorie et valeurs quotidiennes accessibles. Aucune
bibliothèque de graphique ou dépendance ajoutée. Validation visuelle Android à faire.

50 tests Node et TypeScript passent après reprise (aucun test précédent encore
actif). Les 3 nouveaux tests couvrent null/zéro, moyenne, total partiel, net négatif,
bornes semaine/futur, valeurs invalides, SQL sans écriture, archives et réouverture.
Le lot ne porte PAS encore les scores/évaluation globale V1, granularités mensuelles,
récurrences sociales, statistiques Todoist ou PDF. Ces exigences restent ouvertes.
L'application demeure un parcours technique __DEV__, pas une version livrable.
Vérifications finales : 10 tests Python locaux passent (9 schéma/migrations,
1 parité travail sur 10 cas). Relevé mobile_app : 11 844 723 237 octets,
+99 248 octets depuis la référence du budget 5 Go ; hors petits fichiers Git/npm.
C: libre 17 361 272 832 octets. Aucun téléchargement, nouveau build ou nettoyage.
Bilan global et ordre proposé des prochains lots : docs/09_etat_developpement.md.

### Compteur partagé et premier bilan travail — 26/09/2026

`domain/workReport.ts` et `storage/workReport.ts` servent le formulaire ET le Bilan :
solde cumulé de toutes les journées calculables jusqu'à la date choisie, sans remise
à zéro hebdomadaire. Référence 462 min/jour, Day off cible zéro, null exclu et zéro
réel compté. Avant la journée toujours disponible, après seulement si calculable.
Lecture des seules colonnes travail, aucune création/écriture pendant un bilan.
Modification d'une ancienne journée prise en compte au prochain chargement.
Objectif hebdomadaire lu depuis Preferences, distinct du solde total ; zéro respecté.

WorkBalanceCard au-dessus du formulaire travail attend les écritures confirmées,
garde le solde avant la journée pendant l'enregistrement et ne présente pas un
nouveau solde comme enregistré avant acquittement. Accueil quotidien/menu technique
donnent accès au Bilan : semaine courante, semaines historiques, compteur, durée,
objectif/écart, graphique natif de sept barres et détail quotidien par cartes.
Journées futures exclues ; semaines historiques affichées jusqu'au dimanche.
Le tableau compact par cartes est une adaptation tactile, à valider visuellement.
PDF, autres graphiques/bilans et navigation de production restent à développer.

47 tests Node et TypeScript passent ; 1 test Python supplémentaire vérifie 10 cas
de solde communs au domaine V1 et à TypeScript (fixtures synthétiques partagées).
Tests bilan sur SQLite réel : réouverture, non-écriture, correction historique,
horaires partiels, zéro, Day off, semaines/années et compteur jamais absent par
simple manque de données hebdomadaires. Pas de validation tactile/runtime Android.
Pas de téléchargement, dépendance, build ou modification V1. APK debug inchangé.

### Consommateurs des réglages — 26/09/2026, après d405cc5

L'accueil quotidien donne accès aux Réglages après flush ; le retour conserve
la date choisie et recharge le curseur enregistré. Le libellé des proches est
relu depuis Preferences et utilisé dans le formulaire et le récapitulatif.
Libellé illisible : message explicite sans bloquer les mesures ni réécrire le réglage.
Les boutons Horaires standards / Horaires d'hier préparent un patch en lecture
seule, affichent les heures avant confirmation, puis appliquent une seule écriture
CAS via DailyDraft. La navigation est verrouillée pendant cette confirmation.
Horaires standards : quatre horaires configurés, troisième créneau préservé.
Veille : seulement les horaires renseignés (y compris créneau 3), aucune création
de journée absente, aucune suppression implicitement copiée. Valeur invalide refusée.
Autres indicateurs et type de journée conservés ; durée recalculée atomiquement.

43 tests Node et TypeScript passent. Trois tests supplémentaires couvrent lecture
sans écriture, valeurs configurées, créneau 3, durée dérivée, conflit de révision,
veille partielle / fin de mois, poids/masse graisseuse préservés et réglage invalide.
Pas de test tactile Android, téléchargement ou compilation native dans ce lot.
Relevé disque après les deux lots : mobile_app 11 844 663 616 octets, soit
+39 627 octets par rapport à la référence (hors petit delta de métadonnées Git
et journaux npm). C: libre 17 360 154 624 octets. Aucun outil/cache lourd ajouté.
Prochain lot : compteur de travail cumulé et bilans, puis assistant et sauvegardes.
Les objectifs/seuils stockés attendent leurs consommateurs de bilan ; l'assistant
et l'APK final restent incomplets. V1 et données réelles toujours intouchées.

### Réglages locaux — 26/09/2026

Les 13 préférences de DEFAULT_SETTINGS V1 sont définies dans domain/preferences.ts
avec valeurs génériques et validation : seuils, objectifs, jours de travail,
quatre horaires standards, libellé écoute et date arrêt tabac facultative.
Clés V1 et heures conservées pour le futur import (calculs à convertir en minutes).
Preferences les conserve sous preference.v1:<clé>, avec version et CAS indépendant
par champ ; une lecture des valeurs par défaut n'écrit rien. Zéro conservé,
null suppression explicite seulement pour les deux préférences facultatives.
Valeur corrompue/future refusée sans réinitialisation ; aucune clé de secret admise.

PreferencesForm est accessible depuis le menu technique __DEV__ : autosauvegarde
FIFO, état après confirmation SQLite, brouillon invalide non écrit, retour écran/
Android après flush, effacement confirmé. Échec : réessai sans rebase ; relecture
avec abandon du seul brouillon concerné après confirmation explicite.
Les réglages ne sont PAS encore utilisés dans les indicateurs/bilans ni branchés
à l'assistant. Ces consommateurs et la navigation finale restent au prochain lot.
Unités fixes métriques comme V1, pas de conversion impériale. Aucune validation
tactile Android de cet écran ; l'APK debug existant n'a pas été reconstruit.

Validation : 40 tests Node (5 nouveaux réglages), TypeScript valide après correction
d'un cast volontaire dans le test de clés interdites. Tests sur SQLite réel/fichier
synthétique : réouverture, CAS création et mise à jour, indépendance des champs,
conservation de l'assistant, zéro/null, saisies rapides et échec sans écrasement.
Lot sans téléchargement ni compilation native ; ajouts de code de quelques Ko.
V1, SDK/JDK, dépendances, données et APK préservés. Commit local uniquement.

### Budget disque et nettoyage validé — 26/09/2026 (prioritaire)

Utilisateur : ne pas mobiliser plus de **5 Go supplémentaires**, soit 5 000 000 000
octets cumulés pour les travaux à venir, y compris outils/caches hors dépôt. Ne pas
réinitialiser cette enveloppe à chaque lot. Règles de marge et surveillance dans AGENTS.md.
Référence au 26/09/2026 18:50 Europe/Paris : mobile_app **11 844 623 989 octets**,
C: libre **17 372 258 304 octets**. Les fluctuations dues à d'autres applications
ne constituent pas une autorisation d'augmenter le budget. Pas de quota OS installé.
Pas de nouvelle opération lourde tant que son pic n'est pas estimé dans cette enveloppe.

Le nettoyage approuvé Caches/Builds/Downloads a été exécuté : 5,780 Gio logiques
retirés ; APK original copié/vérifié dans artifacts/preserved (95 Mo). Taille juste
après : 7 237 733 342 octets. La reconstruction demandée a réussi en 21 min 12 s,
242 tâches, et a recréé des caches (taille actuelle ci-dessus). Tests : 35 Node,
9 Python SQLite, TypeScript et npm ls valides. APK debug vérifié par apksigner,
même SHA-256 que l'original ; pas un APK autonome. Aucun build encore actif au relevé.
SDK/JDK, dépendances, données et reproductibilité conservés ; pas de second nettoyage.
Le statut « aucune suppression » de l'audit initial est historique : exécution et
preuves désormais consignées dans docs/08_audit_stockage.md. Aucun push effectué.

### Audit disque demandé par l'utilisateur (25/09/2026)

Priorité temporaire : audit et préparation, **aucune suppression sans validation**.
Rapport complet et plan à trois niveaux : `docs/08_audit_stockage.md`.
Inventaire mobile_app : 12,43 Gio ; C: libre 4,76 Gio. Cache+builds+archives :
5,78 Gio récupérables sans retirer SDK/JDK, dépendances npm/Maven ou APK actuel.
NDK 27.0 ET 27.1 utilisés ; leur harmonisation requiert un build avant désinstallation.
Pas d'installation système de remplacement trouvée dans PATH/emplacements standards.
`clean-dev-storage.ps1` : simulation par défaut, liste blanche, refus jonctions,
fichiers Git/sensibles, -Apply + confirmation requis. Rétention anciens APK debug
préparée mais non activée. Aucun hook destructif automatique. Installateur corrigé
pour ne pas retélécharger les archives lorsque les outils extraits sont déjà là.
Attendre l'accord de nettoyage, sans interpréter une continuation du développement
mobile comme autorisation de supprimer ou déplacer les outils.

**État courant prioritaire (25/09/2026, après 9a4fe96)** : le premier APK debug
a été compilé avec succès (Gradle 7 min 55 s, 242 tâches). Les paragraphes historiques
ci-dessous décrivant une compilation en cours ou aucun APK sont dépassés. Fichier :
`android/app/build/outputs/apk/debug/app-debug.apk` (95 416 222 octets), version
0.1.0/code 1, Android minimum API 24, ABI arm64-v8a et x86_64. Signature vérifiée
par apksigner. SHA-256 :
`FC1047600624DB216C7FB44B455306821BA60B7F81DCE706DD18AF3AEF00701F`.
Ce fichier ne contient PAS le bundle JavaScript : Metro reste nécessaire. Ce n'est
ni un APK final ni une preuve de fonctionnement natif du chiffrement. Aucun appareil
ni émulateur connecté à adb lors de la vérification. La V1 n'a pas été modifiée.

`scripts/verify-android-apk.ps1` inspecte l'artefact réellement compilé : signature,
identité, backup désactivé, permissions stockage absentes et module SQLite des deux
ABI. En mode Release (défaut), refuse debug, overlay, cleartext et absence de bundle.
L'APK debug est accepté comme Debug et refusé comme Release (test négatif exécuté).
Le manifeste debug réintroduit SYSTEM_ALERT_WINDOW et cleartext pour les outils
de développement malgré blockedPermissions : ne pas distribuer cet APK comme release.
Les règles de sauvegarde/transfert Android et le chiffrement effectif restent à
auditer sur runtime. Suite Node : 28/28 ; TypeScript et 9 tests Python SQLite passent.

Prochain travail prioritaire : installer/configurer un émulateur isolé et vérifier
ouverture SQLCipher + formulaires avec données synthétiques ; puis assistant,
reprise, sauvegardes, bilans et APK release autonome. L'objectif reste incomplet.

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
21 tests Node réussis, TypeScript valide ; tests de réouverture sur fichier réel
synthétique, conflits, null/zéro et trois créneaux. Aucune interface de saisie
encore connectée : sport, progression, social, objectifs, assistant restent à faire.

`DailyDraft` sérialise les modifications valides d'une journée avec la dernière
révision confirmée. Les saisies non confirmées restent visibles dans le brouillon.
`flush()` doit être attendu avant navigation ; il refuse la sortie en cas d'échec.
`retry()` explicite conserve la révision attendue et ne résout jamais un conflit
en écrasant une version récente. Trois tests couvrent ordre, erreur et conflit.
Cette file reste en mémoire : seule une écriture confirmée survit à un arrêt forcé.
Brancher l'UI et son état de sauvegarde avant de considérer l'autosauvegarde livrée.

## Diagnostic du premier build

Premier échec avant compilation : Java `PipeImpl`/`UnixDomainSockets.connect`
(`Unable to establish loopback connection`, Invalid argument). Préférer IPv4 n'a
pas corrigé. Un répertoire temporaire local `.tools/tmp` pour `java.io.tmpdir` et
`jdk.net.unixdomain.tmpdir` permet au daemon Gradle de démarrer ; configuration
ajoutée au script de build. Aucun changement de pare-feu ni paramètre système.
Le résultat complet de la compilation reste à vérifier ; ne pas annoncer d'APK.
La compilation atteint maintenant les modules Expo/SQLCipher ; expo-sqlite demande
en complément NDK 27.0.12077973, installé automatiquement par Gradle.

## Première tranche UI connectée (développement uniquement)

`DailyForm` branche poids, masse graisseuse, tour de ventre et six horaires de
travail sur DailyDraft/SQLite. Entrée via bouton visible seulement en __DEV__,
avec avertissement données fictives. Ce sous-parcours technique de quatre écrans
n'est PAS le parcours final de 13 étapes et ne remplace pas le futur onboarding.
Dates Aujourd'hui/Hier centralisées Europe/Paris ; virgule décimale acceptée.
Texte incomplet reste en mémoire, bloque navigation et n'est pas une suppression.
Effacement explicite confirmé ; bouton Retour Android attend les écritures.
23 tests Node réussis et TypeScript valide. Pas encore de test UI sur émulateur.
Prochain travail : vérifier le build natif, tests installation/ouverture chiffrée,
puis étendre au parcours complet et à la première utilisation. Garder l'APK
intermédiaire identifié comme essai technique, jamais livraison finale.

## Persistance sportive V2

Migration immuable `002_partial_sport.sql` : durée et type peuvent être absents
sans convertir l'absence en zéro. Reconstruction transactionnelle conservant
UUID, révisions et valeurs existantes. `SportSessions` gère trois positions,
écritures ciblées CAS et suppression à révision contrôlée ; aucun remplacement
global de la liste. Distance et minutes précises indépendantes, null explicite.
UI sportive connectée dans le sous-parcours technique : trois séances, heures et
minutes distinctes, distance décimale et effacement séparé confirmé. La file FIFO
`WriteQueue` est partagée par DailyDraft et SportDraft, avec les mêmes contrôles.
La navigation attend les files des trois séances et refuse les champs invalides.
Les trois emplacements vides sont actuellement des lignes nulles : ne pas les
compter comme séances actives dans les bilans/imports.

Validation : suite Node complète 26 tests réussis après mutualisation, TypeScript
valide. Les 9 tests Python
de schéma/migration passent depuis la racine ; première commande lancée par erreur
depuis mobile_app avait échoué à importer les modules (corrigé en changeant cwd).
Le test racine modifié est exclusivement `tests/test_mobile_local_database.py` ;
aucun code de fonctionnement V1 modifié.

Build Android toujours en cours après installation du NDK complémentaire : atteint
les tâches CMake SQLCipher et Expo. Attendre le même processus, ne pas lancer un
second build simplement faute de nouvelles lignes.

Le build a atteint fusion native et signature debug, puis Windows a signalé une
mémoire virtuelle insuffisante (erreur 1455 lors d'une édition de fichier).
Compilation arrêtée par Ctrl+C, processus terminé avec code 1. Après arrêt :
~8 Go de mémoire virtuelle libre. Ce n'est pas un timeout : ne pas attendre cet
ancien handle. Script désormais limité à 2 workers, sans parallélisme Gradle,
heap 1536 Mo, Kotlin dans le processus et CMake limité. Relancer ce script pour
utiliser les caches existants ; aucun APK confirmé à ce stade.

## Extension du parcours d'indicateurs

Configuration déclarative `domain/checkinConfig.ts` dans l'ordre V1 : 13 catégories
et récapitulatif. Les branchements UI utilisent des IDs stables, pas des indices.
Sommeil/sieste, alcool, portable, repas, temps pour moi et écoute sont maintenant
reliés à l'autosauvegarde existante. Total temps pour moi immédiat ; kcal affichées
avec n.c. en absence d'estimation, analyse externe encore indisponible. Récapitulatif
des champs quotidiens avec accès Modifier. Social/objectifs restent explicitement
non portés (aucune fausse saisie). Reprise d'étape et progression restent à faire.
27 tests Node réussis, TypeScript valide. Le test de configuration garantit que
chaque champ quotidien éditable est présent exactement une fois (mode travail
traité séparément). Durées encore affichées en minutes sauf sport : harmonisation
heures/minutes et vérification des règles sommeil V1 à réaliser.

Build limité terminé en échec : Ninja refuse un chemin d'en-tête React Native
de plus de 260 caractères. Alias réversible `L:` créé par subst vers le dépôt,
sans déplacer les fichiers ni changer le registre. Le script vérifie que ce
lecteur pointe sur le bon dépôt (refus s'il appartient à autre chose), puis utilise
L:\mobile_app pour Java/SDK/cache/source. Expo ignore package.json directement
à la racine d'un lecteur : premier alias vers mobile_app corrigé vers le parent.
Le nouveau build dépasse autolinking et compile les modules. Pas d'APK confirmé.

## Social et objectifs connectés

Migration 003 ajoute les révisions des catalogues et journaux. `Catalogs` utilise
des identifiants SQL fixes, valeurs liées, créations sans doublon par journée et
sujet, suppression/archivage contrôlés par révision. Archiver conserve l'historique.
Objectifs limités à trois actifs par une condition SQL atomique. Réactivation
d'un journal importé worked=0 préserve ses notes et incrémente la révision.
`CatalogForm` offre ajout/sélection, catégories de personnes, archivage et affichage
des archives ; navigation attend l'opération et refuse un ajout non terminé.
Historique détaillé, renommage et bilans de récurrence restent à réaliser.
28 tests Node réussis ; TypeScript valide. Pas de validation UI Android encore.

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

## Reprise persistante de l'assistant (25/09/2026)

`OnboardingProgress` conserve étape, choix de source et état terminé dans une clé
dédiée de settings, avec version et contrôle de concurrence sur la valeur stockée.
Navigation adjacente uniquement, pas de fin avant récapitulatif, choix obligatoire
pour sortir de l'étape données. Les autres réglages restent intacts. Un état futur
ou corrompu bloque au lieu d'être remplacé par des valeurs initiales.
Trois nouveaux tests SQLite couvrent réouverture, fin persistante, concurrence et
refus sûr : suite Node 31/31, TypeScript valide. Ce repository n'est pas encore
branché à une interface ; il ne réalise ni import, ni restauration, ni biométrie.
Ces opérations doivent réussir dans leurs services avant que l'UI avance.

Préparation émulateur suspendue techniquement : C: ne dispose que d'environ 425 Mo
libres ; Win32_Processor rapporte VirtualizationFirmwareEnabled=false et
SecondLevelAddressTranslationExtensions=false. Aucun téléchargement d'image lancé,
aucun fichier utilisateur supprimé, aucun réglage système modifié. Les compilations
lourdes attendent davantage d'espace. Continuer les lots de code indépendants :
préférences validées, assistant UI, reprise quotidienne, import et sauvegardes.
Il faudra libérer de l'espace ou disposer d'un environnement Android de test pour
lever la validation native ; ne pas déclarer l'objectif bloqué tant que ces lots
indépendants peuvent progresser.

## Confidentialité du dépôt

## Reprise quotidienne connectée (25/09/2026)

`CheckinPositions` persiste un ID d'étape stable par date Paris, séparément des
révisions de daily_entries. Contrôle de concurrence CAS sur la valeur settings ;
étape inconnue, date invalide et état futur/corrompu refusés sans réinitialisation.
`DailyForm` charge la position avec la journée, attend les files de sauvegarde puis
persiste la destination avant d'afficher l'étape. Retour Android et Modifier utilisent
ce chemin. Un verrou synchrone empêche les doubles navigations, les champs sont
temporairement non éditables pendant le changement. Chaque journée retrouve sa
propre position ; l'application commence toujours sur la date du jour Paris.
Deux tests SQLite sur données synthétiques couvrent réouverture, indépendance des
dates, retour/modification, non-effacement poids/horaires et refus d'une vue ancienne.
Suite complète : 33 tests réussis, TypeScript valide. Pas de validation UI Android.
La progression complété/passé, la page d'accueil et la navigation historique libre
restent à développer ; le curseur seul ne les remplace pas.

## Confidentialité et état Git

## Accueil et progression du point quotidien (25/09/2026)

Accueil relié au formulaire : démarrer/reprendre, récapitulatif après fin, accès
direct aux 13 catégories et compteur des indicateurs traités. Continuer marque
l'étape traitée, Passer la marque passée sans effacer aucune valeur. Ces deux
états sont exclusifs et réversibles. Terminer exige 13 étapes traitées ou passées.
Un indicateur traité ne garantit pas que tous ses champs facultatifs sont remplis.

`setCheckinProgress` utilise les colonnes existantes de daily_entries, jamais une
seconde copie de progression dans settings. Mise à jour ciblée CAS avec incrément
de révision ; le formulaire adopte la ligne confirmée après flush et avant de
changer de curseur. Si le curseur échoue après progression, les mesures et la
progression restent conservées, la navigation ne prétend pas avoir réussi.
Les IDs d'étapes V2 devront être rapprochés des valeurs V1 lors du futur import.

35 tests Node passent et TypeScript valide. Tests progression : exclusivité,
changement passé/traité, refus de fin anticipée, conflit ancien, indépendance des
dates, modification après fin et non-effacement des autres colonnes. Aucun écran
n'a été exécuté sur Android ; l'APK debug précédent ne contient pas ces ajouts.
Prochains travaux : historique libre, récapitulatif sport/social/objectifs complet,
réglages et assistant, puis sauvegardes/import/bilans et validation native.

## Confidentialité et état Git (rappel)

## Récapitulatif lié et historique (25/09/2026)

`readRelatedSummary` lit séances, journaux sociaux et objectifs sans écriture.
Les personnes/objectifs archivés restent visibles dans leur journée ; les séances
entièrement nulles sont exclues, les distances zéro et séances partielles conservées.
`RelatedSummary` affiche valeurs, notes disponibles et liens Modifier ; erreur de
lecture distincte d'une liste vide, possibilité de réessayer. Branché au récapitulatif.
Le test catalogue est étendu : aucune écriture pendant la lecture (total_changes),
relations archivées, notes, distance zéro et isolation d'une autre journée.

Accueil : jour précédent/suivant et date AAAA-MM-JJ explicite pour ouvrir une journée
historique. Validation calendaire stricte, futur refusé ; utilise le même flush que
les boutons Aujourd'hui/Hier. Le champ texte évite une dépendance native nouvelle,
mais un sélecteur calendrier tactile et le format français restent une amélioration
ergonomique à faire. Ouvrir une journée absente crée une ligne vide, comme Aujourd'hui.

Suite complète toujours 35 tests, assertions étendues ; TypeScript valide. Aucun
test tactile ou nouveau build APK. Récapitulatif des données liées maintenant présent,
mais bilans/graphiques/PDF, réglages, assistant, import et sauvegardes restent ouverts.

## Confidentialité et Git

Les exports et bases restent dans des chemins ignorés (`backups/`, `local_data/`).
Ne pas lire ni publier leur contenu pour une tâche d'architecture. L'import réel
sera contrôlé avec l'utilisateur ; les préparatifs utilisent des fixtures fictives.
Vérifier la branche, le remote et les commits non poussés au début de chaque lot ;
ce document ne garantit pas l'état distant. Commit à chaque lot, push sur demande.
