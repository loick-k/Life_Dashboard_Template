# Contexte de reprise du développement V2

Mis à jour le 27/10/2026. Lire les AGENTS.md avant de travailler.

## Décision produit acceptée — V2 autonome et sans compte distant

Décision du 27/10/2026 : Life Dashboard V2 sera une application Android autonome,
sans portail de connexion ni compte utilisateur distant. Ses données résideront
localement sur le téléphone et ses fonctions principales (saisie, historique,
bilans) devront fonctionner hors ligne. La V1 Streamlit/Neon conserve son
fonctionnement actuel. Les deux versions restent indépendantes ; tout import est
explicite et aucune synchronisation automatique n'est prévue.

L'accès aux fonctions locales ne dépend pas des intégrations externes éventuelles.
Todoist et les analyses nutritionnelles distantes nécessitent leurs propres services,
comptes ou réseau et restent facultatifs. Google Drive, mentionné comme possibilité
dans l'ancien document d'architecture, n'est pas une destination de sauvegarde
retenue. La biométrie, le chiffrement et la stratégie de sauvegarde/restauration
restent à étudier. Les prototypes techniques présents dans le code ne valent pas
validation d'une politique finale. Détail :
[`docs/15_decision_v2_locale_sans_compte.md`](docs/15_decision_v2_locale_sans_compte.md).

## Objectif accepté

Développer une application Android autonome à stockage local, fidèle aux fonctions
et à l'interface Streamlit V1, selon la décision sans compte distant ci-dessus.
Les deux versions doivent rester utilisables indépendamment. La V1 conserve Neon ;
la V2 conserve sa propre SQLite. Aucun remplacement forcé de la V1 et aucune
synchronisation automatique des deux bases.

## État vérifié dans le dépôt

### Clôture d'itération — ajouts durables et pause demandée — 27/10/2026

Réglages commités 488e00d. Les ajouts de personnes/objectifs conservent désormais
leur texte brut, catégorie et UUID dans un journal privé par contexte (répertoire
autonome ou journée). Aucun élément, interaction ni contribution créé en tapant.
Avant création, la commande est figée et journalisée ; une reprise explicite
vérifie le même UUID et son contenu, sans doublon ni réactivation silencieuse.
Panne après SQL ou pendant le nettoyage : texte conservé, reprise sans nouvel
INSERT. Homonymes indépendants et limite de trois objectifs actifs conservés.

Lecture incompatible refusée sans reset ; relecture explicite après conflit,
abandon local confirmé sans suppression du répertoire/journal. Champs bloqués
pendant chargement ou confirmation, barrières attendent les lectures et écritures.
Buffers exclus des sauvegardes portables, préservés lors d'une restauration.

215 tests Node, TypeScript et 16 tests Python réussis. Onze nouveaux tests incluent
SQLite fichier fermé/réouvert, confirmation SQL perdue, capacité/concurrence,
pannes de journal/nettoyage, remontage React, Back simulé, format futur, restauration
et chargement lent. Aucun build/téléchargement/push ni modification V1. Les fichiers
Todoist préexistants restent hors lot. Preuves Android toujours requises.

Dernier relevé : mobile_app 8 467 782 697 octets ; croissance cumulée comptabilisée
723 158 708 / 5 000 000 000 octets, marge réservée 1 Go ; budget encore disponible
3 276 841 292 octets. Aucun déplacement ou suppression de dépendances/outils.

L'utilisateur demande l'arrêt à la fin de cette itération : mettre l'objectif en
pause après le commit local et ne lancer aucun autre lot. À la reprise : terminer
intégrations facultatives Todoist/nutrition et parité/ergonomie, puis lever les gates
Android et disque avant compilation de l'APK autonome. L'objectif global n'est pas
atteint ; les validations locales ne constituent pas une preuve sur téléphone.

### Audit approfondi — réglages durables et comparaison indépendante — 27/10/2026

Journaux commités 902c093. Les treize réglages journalisent désormais leurs buffers
avant écriture, dans une clé privée indépendante par réglage. Nombre/date/horaire/
libellé incomplets retrouvés après remontage, zéro et effacement facultatif séparés.
Valeur valide non confirmée => comparaison explicite avec la révision courante,
second conflit refusé, garder la base vérifie aussi sa révision. Abandonner un
réglage ne touche ni aux autres brouillons ni aux autres valeurs.

Assistant initial et restauration refusent les brouillons ; le menu principal
conserve le formulaire lors d'un détour. Chargement lent inclus dans les barrières,
statuts distincts pour défaut/sauvegarde/conservation/reprise. Nettoyage réessayable
sans réécriture de la valeur ni changement de sa révision. Secrets refusés par le
contrat des préférences ; buffers privés exclus des backups et préservés par restore.

204 tests Node et TypeScript réussis. Six nouveaux tests SQLite/React couvrent les
quatre types de champs, réouverture, deux conflits, abandon ciblé, zéro/date vide,
panne après SQL, isolation des backups et barrière lancée avant la fin du chargement.
Restent ajouts de personnes/objectifs à rendre durables, intégrations et ergonomie/
parité/validation Android. Aucun build/téléchargement/donnée réelle/push, V1 intacte.
Travaux Todoist préexistants conservés hors lot. L'objectif global reste actif.

### Audit approfondi — notes et durées de journaux durables — 27/10/2026

Sport commité c4df30a. Le même socle journalise les notes sociales/objectifs, le
contexte et la durée sociale AVANT SQL. Buffers incomplets retrouvés à l'identique
et détails dépliés ; valeur valide non confirmée => comparaison explicite, pas de
rejeu ni d'interaction/contribution ajoutée. Cases included/worked, UUID, dates et
autres journaux inchangés. Conflit supplémentaire refusé, choix par champ conservés.

Barrières de sélection/désélection, archive, navigation et restauration attendent
journalisation, écriture et nettoyage. Relire après un changement de case ne jette
pas le brouillon. Statuts distinguent brouillon retrouvé/incomplet, conservation
non confirmée et SQL enregistré. Réessai du nettoyage ne rejoue pas SQL et retire
son ancien message d'erreur, également corrigé pour le sport.

198 tests Node, TypeScript et 16 tests Python réussis. Cinq nouveaux tests React/
SQLite : contexte vide/durée incomplète après remontage, Unicode, note d'objectif
non travaillé interrompue puis second conflit, panne après SQL et réessai local,
restauration excluant/préservant les buffers privés, barrière pendant lecture lente.
Les brouillons restent hors sauvegarde portable (valeurs confirmées uniquement).
Preuve d'arrêt forcé Android toujours requise. Restent ajouts de répertoire et
réglages à rendre durables, intégrations/ergonomie/parité et validation Android.
V1 et fichiers Todoist préexistants inchangés ; aucun téléchargement/build/push.

### Audit approfondi — brouillons sportifs durables — 27/10/2026

Champs quotidiens commités bed157e. Trois séances : durée/distance incomplètes,
activité, effacements et suppression complète journalisés AVANT SQL métier dans
une clé privée chiffrée par séance. Suppression = une enveloppe atomique des trois
champs, puis patch métier atomique ; aucun rejeu automatique. Réouverture => cartes
incomplètes révélées et valeurs valides non confirmées à comparer. Révisions,
autres séances/mesures et buffers non remplacés restent conservés.

Socle mutualisé FieldBuffers/BufferedEditor, sans React ni dépendance ajoutée :
CAS d'enveloppe, tokens de champ, reprise explicite, nettoyage réessayable sans
réexécuter le writer, anciennes erreurs supplantées sans écraser une saisie plus
récente. Barrières attendent journal, SQL et nettoyage ; aucun succès annoncé pour
un buffer invalide. Données privées exclues des backups portables et préservées par
restauration ; format futur/corrompu refusé sans reset.

193 tests Node et TypeScript réussis ; sept nouveaux tests SQLite fichier/React
couvrent crash simulé, reprise, concurrence, atomicité suppression, confirmation
perdue, nettoyage, Unicode/limites, restauration et autres séances/poids inchangés.
Arrêt forcé Android toujours à prouver. Restent journaux sociaux/objectifs, ajouts
et réglages à journaliser, intégrations/parité et validation matérielle. Travaux
Todoist préexistants hors lot, aucun téléchargement/build/donnée réelle/push.

### Audit approfondi — brouillons quotidiens durables et reprise explicite — 27/10/2026

Navigation/horloge commitée 555dab6. Les champs simples quotidiens (nombres,
horaires, textes, heures/minutes, modes et effacements) sont journalisés AVANT
écriture métier dans des clés privées de la SQLite chiffrée. Aucun schéma ou
format de sauvegarde modifié. FIFO/CAS par champ et token de nettoyage : un ancien
accusé ne supprime jamais la saisie suivante ; autre éditeur/futur format refusés.

Réouverture : buffers incomplets retrouvés exactement, valeur valide non confirmée
comparée explicitement avant reprise, jamais de rejeu automatique. Valeur déjà
commise reconnue, zéro/absence/effacement distincts. Accès aux rubriques incomplètes
depuis l'accueil, même si plusieurs restent à corriger. Barrières attendent tous
les travaux ; restauration commencée pendant lecture lente refuse ensuite le
brouillon retrouvé. Échec de journal => pas de fausse confirmation métier, réessai
sans abandon mémoire. Choix du sommeil calculé attend l'ancien buffer manuel.

186 tests Node, TypeScript et 16 tests Python réussis. Dix nouveaux tests fichier
SQLite/React : reprise, concurrence, nettoyage tardif, coupure simulée avant SQL,
pas de rejeu, comparaisons, zéro/null/Unicode, absence de journal dans les exports
portables et maintien après restauration, corruption préservée, frappes rapides,
réessai, plusieurs rubriques, barrière pendant chargement et nettoyage échoué après
choix SQL confirmés (reprise locale sans rejouer l'écriture). Pas de preuve d'arrêt
forcé Android : toujours requise. Les champs sport, journaux sociaux/objectifs,
ajouts de répertoire et réglages n'utilisent pas encore ce journal durable : à
étendre dans les prochains lots, sans annoncer la conservation de TOUT brouillon.
Budget mesuré : mobile_app 8 467 677 925 octets ; croissance cumulée 723 053 936
sur 5 Go, 3 276 946 064 utilisables avant marge réservée, C: libre 12 556 763 136.
Todoist UI préexistante laissée hors lot ; intégrations, parité visuelle/ergonomie
native et APK autonome restent ouverts. V1 inchangée, aucun accès réel/build/push.

### Audit approfondi — sortie récupérable et horloge Paris vivante — 27/10/2026

Conflit quotidien commité 5dacd47. Un répertoire autonome en échec de lecture
permet maintenant Retour/Back : attente de l'opération en cours, contrôle des
journaux et refus de perdre un ajout non terminé. La barrière stricte de validation
quotidienne reste inchangée ; aucune réinitialisation de données pour quitter.

Aujourd'hui/Hier recalculent Paris après la barrière de sauvegarde, jamais depuis
une date capturée au rendu précédent. Référence actualisée au retour actif et
chaque minute visible, minuterie arrêtée en arrière-plan/onglet caché. Elle ne
change jamais la date sélectionnée ni ses brouillons ; avertissement historique
explicite, évaluation de semaine courante actualisée indépendamment du Bilan choisi.

176 tests Node et TypeScript réussis. Cinq nouveaux tests : lecture défaillante,
ajout conservé, sortie attendant création/relecture lente, premier appui après
minuit sans rendu, changements d'heure mars/octobre, retour actif avec heure
incomplète, Bilan historique inchangé. Aucun build/téléchargement/accès réel/push.
Travaux Todoist préexistants hors lot. Restent les brouillons durables, intégrations,
finitions/parité et preuves matérielles Android ; objectif global actif.

### Audit approfondi — comparaison quotidienne figée sans perte — 27/10/2026

Reprise de l'audit du dernier tour : perte 73 affiché/72 stocké reproduite avant
correction. La comparaison verrouille désormais tous les éditeurs quotidiens,
leurs événements natifs tardifs, modes, effacements et réessai de l'ancienne file.
Verrou synchrone avant la lecture, suivi de l'opération par les barrières de
navigation/restauration ; choix appliqués au brouillon comparé uniquement. Fermer
la comparaison permet de reprendre la saisie puis de comparer sa dernière valeur.
Second conflit refusé sans réécriture ni perte ; aucune autre mesure remplacée.

171 tests Node et TypeScript réussis, dont trois nouveaux tests React/SQLite sur
nombres, horaires, textes, durées, ancien callback, lecture lente, fermeture puis
nouvelle comparaison et second conflit. Aucun build/téléchargement/accès réel,
changement V1 ou push. Les fichiers Todoist non commités préexistants sont conservés
hors de ce lot. Restent les brouillons durables, sortie des répertoires en erreur,
horloge vivante Paris, intégrations et parité complète/validation native Android.

### Todoist — client et commandes durables, pas encore branchés à l'UI — 27/10/2026

Archive précédente commitée 2f79a2b. Client V1 REST/Sync sans SDK ajouté : HTTPS
fixe, Bearer uniquement en en-tête, erreurs présentables sans réponse brute, timeout,
pagination et réponses bornées. Projets/tâches/terminées parsés par liste de champs.
Mutations Sync avec UUID/temp_id persistés AVANT envoi dans settings sous clé
privée integration.todoist.pending.v1, exclue des sauvegardes portables. Pas de
migration. Coupure/réouverture => réessai EXPLICITE du même UUID ; aucun rejeu
automatique. Refus de commande définitif non réessayé, accusé confirmé finalisable
localement après erreur de nettoyage. Abandon du suivi n'annule pas l'action distante.

Jeton seulement dans SecureStore, service dédié d'intégrations ; vérification du
compte par GET /user, seul ID conservé avec le jeton. Une commande ne traverse pas
les comptes ; rotation de jeton du même compte possible. Déconnexion refuse une
commande non résolue. Aucun champ de santé lu pour ces appels. URL externe fixe
sans secret pour ouvrir l'interface Todoist ou ses réglages développeur.

168 tests Node/TypeScript réussis. Sept tests nouveaux : faux serveur uniquement,
perte d'accusé/reprise fichier SQLite, unicité, concurrence, mauvais compte, refus,
cleanup local, backup/restore préservant/excluant les clés privées et données de
santé intactes. Aucun jeton réel, requête authentifiée réelle, installation ou build.
Documentation officielle vérifiée : https://developer.todoist.com/api/v1/ (UUID
Sync, paramètres, pagination et erreurs). Skill Streamlit non découvrable : V1
comparée depuis ses sources. L'interface/assistant/Bilan restent À BRANCHER ;
aucune intégration utilisable complète annoncée à ce stade, objectif global actif.

### Ergonomie — brouillon conservé sous une archive — 27/10/2026

Historique commité a2a3dd7. Si une personne/objectif est archivé depuis un autre
écran alors qu'un détail quotidien invalide est conservé, Continuer révèle
automatiquement les archives et le détail à corriger. Le journal reste monté et
aucune réactivation n'est imposée. Le statut d'un détail invalide annonce désormais
Brouillon incomplet, non enregistré, plutôt qu'un message enregistré ambigu.
Un test React/SQLite reproduit l'archivage entre deux activations du formulaire.

161 tests Node, TypeScript et 16 tests Python de référence réussis. Budget disque
comptabilisé 722 957 074 octets / plafond 5 Go, 3 277 042 926 octets utilisables
avant marge réservée ; mobile_app 8 467 581 063 octets, C: libre 12 599 668 736.
Aucun téléchargement, build, donnée réelle, changement V1 ou push. Les prochaines
exigences restent Todoist, analyse nutritionnelle explicite et ergonomie/preuves
natives Android, puis validation de l'APK autonome sous budget ; objectif actif.

### Parité — récurrence et historiques détaillés — 27/10/2026

Journaux commités dcba459. Depuis les répertoires et les catégories Social/Objectifs
du Bilan : historique en lecture seule, périodes V1 7j/30j/365j/tout, statistiques
par personne/objectif, première/dernière date, nombre de jours, jours depuis la
date consultée, intervalle moyen. Archives/terminés inclus et statut actuel annoncé
explicitement ; dates d'activités bornées à la date consultée, futurs exclus.
Homonymes groupés par UUID (correction volontaire du groupement V1 par nom).

Journal individuel filtrable ; entrées non comptées consultables explicitement,
notes et contexte complets repliables, zéro/absence conservés. Statistiques et
journaux paginés par 20, requêtes bornées à 21 lignes avec texte libre ; courbes
de jours sociaux/personnes vues par semaine lundi–dimanche ou mois, fenêtres 24
points accessibles vers tout l'historique. Périodes sans journal non inventées.
Filtres conservés après erreur, réponses périmées ignorées, réessai et actualisation.
Répertoire monté pendant consultation historique pour conserver un ajout inachevé ;
retour Bilan conserve sa date/catégorie/période. Routes bloquées pendant export PDF.

160 tests Node, TypeScript et 16 tests Python réussis. Six tests nouveaux de
calcul/SQLite/React, plus deux tests Python qui exécutent la vraie fonction pure
social_recurrence_table via AST, sans Streamlit/Plotly. Intervalles et arrondis
Python flottants/ties-to-even conservés (dont 3.55 => 3.5), année bissextile et
changement d'heure Paris testés. Aucune écriture pendant les lectures historiques.
Pas d'installation, compilation, donnée réelle, modification V1 ou push. Rendu
et performances Android restent à prouver ; intégrations et ergonomie native ouvertes.

### Parité — détails des journaux sociaux et objectifs — 27/10/2026

Répertoires précédents commités 90cdbbe. Éditeur repliable par journal existant :
note sociale/objectif, contexte libre social, durée sociale h/min précise.
Autosauvegarde ciblée FIFO/CAS, jamais écriture des liens, de la sélection ou du
statut travaillé. Effacement volontaire de durée confirmé, zéro/absence distincts.
Comparer/résoudre champ par champ après conflit, second conflit refusé, erreurs
de lecture réessayables sans valeur par défaut écrasante. Le contexte V1 reste
Vu en personne par défaut ; les valeurs importées ne sont pas remplacées.

Décocher conserve les détails visibles et leur identité ; édition encore possible
sans recomptage implicite. Archive/retour/navigation attendent tous les journaux,
même si un échoue ; saisie invalide révélée et conservée. Un journal sous archive
masquée reste monté pour ne pas perdre son brouillon. Révision de journal relue
après changement explicite de sélection ; pas de conflit artificiel à la frappe
suivante. Aucun changement de schéma ni du format des sauvegardes.

154 tests Node et TypeScript réussis. Huit tests nouveaux SQLite/React couvrent
backup/restore exact, Unicode, validation/CAS, note d'objectif, décocher/recocher,
durée invalide empêchant archive/désélection, attente d'une autre écriture lente,
lecture échouée puis reprise et date historique avec brouillon après changement
de menu. Skill Streamlit : environnement non découvrable, référence V1 lue depuis
ses sources sans installation. Aucun build/téléchargement/accès réel/push.
Historique/récurrence détaillés et interfaces Android restent à vérifier/compléter.

### Parité — catalogues indépendants des journées — 27/10/2026

Day off commité c847b11. Écrans Personnes suivies/Mes objectifs accessibles depuis
Réglages et depuis les étapes correspondantes. Même gestion d'archives et de fin
d'objectif, sans UUID de journée requis et sans créer de journal quotidien.
Ajouter depuis une étape ne sélectionne plus implicitement l'élément : il faut
cocher séparément une interaction/contribution réelle. Message explicite et
annulation confirmée d'un ajout inachevé ; Back attend les écritures et ne jette
pas un nom/titre non enregistré. Répertoire relu au retour d'un écran de gestion,
sans réinitialiser la date historique ni les autres brouillons.

146 tests Node et TypeScript réussis. Cinq tests React/SQLite nouveaux : ajout
hors journée sans daily_entries/logs, sélection séparée, échec/reprise, annulation,
route depuis une date historique et réglages avec horaire quotidien incomplet.
Aucun changement de schéma, accès réel, installation, build ou push. Notes/durée/
contexte sociaux et historiques détaillés restent à porter, ainsi que les services
facultatifs et la validation Android. L'objectif global reste actif.

### Reprise audit — Day off explicite et calcul partagé — 27/10/2026

PDF commité cc44e76. effectiveWorkMinutes centralise la lecture du travail pour
formulaire, compteur/PDF, séries et évaluation. Day off sans horaires ni durée
connue signifie zéro travaillé ; un horaire partiel reste incomplet, une durée
importée (zéro compris) reste prioritaire, les chevauchements restent exclus.
Ce zéro de repos n'est pas écrit en SQLite : revenir sur Bureau ne crée donc pas
une journée faussement travaillée à zéro avec un débit de 7h42. Aucun changement
du calcul workBalance(null), des sources historiques ou de la pondération V1.

141 tests Node et TypeScript réussis ; trois nouveaux tests domaines/SQLite/React
couvrent tous les consommateurs, le caractère lecture seule, Continuer/Retour et
le changement de mode. Trois PDF fictifs existants toujours vérifiés. Un attendu
de test du score travail a été aligné sur la vraie formule V1 (zéro heure ne signifie
pas automatiquement zéro point), sans modifier cette formule. Pas de nouveau
build, téléchargement, donnée réelle, modification V1 ou push. Preuve Android ouverte.

### Parité — rapport PDF local du travail — 27/10/2026

Récupérations commitée 0d15c03. Lot PDF précédemment en cours maintenant vérifié :
export sous le graphique travail, deux pages A4 paysage, compteur cumulé complet,
types de journée, tableau des sept jours/3 créneaux, durée et écart hebdomadaires,
graphe des 14 dernières journées calculables. Modèle partagé avec formulaire/Bilan,
futurs/chevauchements exclus, valeurs absentes distinctes de zéro. Aucun repas,
poids ou autre rubrique n'est lu pour ce rapport. Générateur vectoriel TypeScript
sans dépendance supplémentaire, aucun réseau ni fichier temporaire personnel.

Consentement au PDF non chiffré, dossier choisi dans le sélecteur Android, nom
unique UUID, relecture identique octet par octet avant succès. Navigation/date et
double appui bloqués pendant l'opération ; erreur réessayable, fichier incomplet
éventuel signalé sans suppression automatique. Le PDF ne remplace pas un backup.

138 tests Node, TypeScript, vérification pypdf/pdfplumber et contrôle visuel des
six pages fictives réussis. Cas normal/vide/partiel, soldes négatifs, chevauchement,
troisième créneau et accents ; aucune donnée réelle. Scripts de reproduction :
node --experimental-strip-types scripts/preview-work-pdf.mjs puis Python -B
scripts/verify-work-pdf.py, depuis mobile_app. Sorties ignorées dans artifacts/.
Les fichiers déjà générés ont été contrôlés, sans nouvel outillage/téléchargement.
Sélecteur/écriture SAF et ouverture du PDF sur téléphone restent à valider.
Cette preuve locale ne valide pas l'APK autonome ni l'ensemble de la parité.

### Reprise audit — conflits sportifs et position de navigation — 27/10/2026

Correction du travail commitée 17b09d6. Sport : comparaison champ par champ des
valeurs enregistrées et du patch en échec, choix explicites, CAS au moment de
l'application, second conflit refusé. Saisies incomplètes et autres séances
conservées ; choisir la valeur enregistrée ne retire que les buffers de ce champ.
Barrières attendent la résolution, éditions de la séance comparée verrouillées,
comparaison relisible et refermable sans abandon du brouillon. Les résolutions
quotidiennes vérifient aussi la révision si tous les choix gardent la base.

Position quotidienne : erreur de conflit dédiée et action Relire la position
sans perdre mes saisies. Ne recharge ni la ligne quotidienne ni les buffers,
ne déplace pas l'écran automatiquement et conserve la progression déjà confirmée.
Un curseur corrompu n'est jamais remis à zéro silencieusement.

138 tests Node dans l'arbre courant et TypeScript réussis (huit tests PDF encore
non commités). Cinq tests nouveaux de résolution/domaines/React réels, dont un
second conflit et un brouillon horaire incomplet pendant la relecture de position.
Aucune installation, compilation, donnée personnelle, intervention V1 ou push.
Parité, Day off explicite et validation sur Android restent ouverts.

### Reprise audit — durée de travail importée — 27/10/2026

Le nouvel audit a reproduit une perte : changer seulement work_mode recalculait
la durée depuis des horaires absents/partiels et remplaçait une durée V1 valide
par null. DailyEntries recalcule maintenant uniquement après changement réel d'un
des six horaires. Un patch d'horaires identiques ne détruit pas la durée historique.
Valeurs zéro et durées importées conservées ; une suppression volontaire d'un
horaire réellement présent rend toujours le calcul incomplet, sans effacer le reste.

Trois tests supplémentaires SQLite/React : modes successifs, durées 462/447/0,
horaires partiels, patch inchangé, changement/effacement réel et Continuer/Retour.
133 tests Node dans l'arbre courant et TypeScript réussis (dont les huit tests PDF
du lot encore non commité). Ce lot ne stage que sa correction/tests/documentation.
PDF préexistant conservé. Aucun build, téléchargement, donnée réelle ou changement V1.
Day off sans horaires, récupérations de conflit, parité et preuve Android restent ouverts.

### Corrections audit — périodes et historique complet — 27/10/2026

Évaluation précédente commitée 7a4b93c. Bilan : périodes V1 7 jours, 1 mois
(30 jours), 1 an (365 jours), Depuis le début ; fin de période explicite selon
date consultée, périodes précédente/suivante et catégories conservées. L'évaluation
reste sur la semaine Paris actuelle et le compteur travail sur tout l'historique.
29 séries, dont durée et écart des journées travaillées. Regroupements journaliers,
hebdomadaires lundi–dimanche et mensuels. KPIs sur tous les jours observés, pas une
moyenne de moyennes ; cartes corps = dernière mesure, courbes longues = moyennes.
Calories nettes appariées par jour avant regroupement ; zéros distincts des absences,
estimations obsolètes et travail chevauchant exclus. Catégories relationnelles
intouchées ne deviennent pas des zéros simplement parce qu'une journée a été ouverte.

Graphiques : fenêtre de 24 points maximum par catégorie, navigation vers tous les
points plus anciens/récents et défilement horizontal ; KPI jamais tronqué à cette
fenêtre. Mois/semaine vides gardés comme trous sans interpolation. Longues lectures
n'emportent pas les textes libres des repas (réservés aux sept jours de l'évaluation).
Réponses de lecture périmées ignorées, erreur réessayable sans reset des sélections.

122 tests Node, TypeScript et 14 tests Python réussis. Sept tests historiques ajoutés,
dont dix années synthétiques (3650 lignes) et interactions/pagination/erreur tardive.
Fixtures mensuelles et fenêtres contrôlées avec la vraie fonction pure de groupement
V1 isolée par AST (sans importer l'UI Streamlit/Plotly). Différence volontaire :
semaines lundi–dimanche, pas la fréquence V1 W-MON qui termine le lundi.
Mesure de performance du test sur PC uniquement, aucune prétention Android.
Budget suivi : 722 125 445 octets supplémentaires comptabilisés / plafond 5 Go,
3 277 874 555 octets utilisables avant marge réservée ; aucune nouvelle installation,
compilation ou donnée réelle. PDF, catalogues/historiques détaillés, intégrations
et validation Android restent nécessaires. Objectif global actif.


### Corrections audit — évaluation hebdomadaire — 27/10/2026

Lot ergonomie précédent commité 08689ee. Évaluation de la semaine Paris en cours
connectée au Bilan, indépendante de la période historique consultée. 23 lignes,
dont 22 dimensions pondérées V1 et couverture Travail · suivi hors pondération.
Score partiel avec nombre de dimensions observées, n.c. exclu (jamais zéro implicite),
semaine lundi/date courante, détails repliables, erreurs réessayables et relecture
au retour des réglages. Pas de double lecture au premier montage du Bilan.

Les sept réglages auparavant sans effet sont consommés : minimum sommeil, objectif
ventre, maximum portable, sport/social hebdomadaires, jours de référence travail,
date arrêt tabac. Jours travail affecte la couverture, pas le compteur fixe 7h42.
Objectifs sommeil/sport/social/travail à zéro désactivent leur score ; maximum
portable à zéro reste strict, ventre à zéro conserve seulement la tendance.
Seuils alimentaires V1 2/4/6 jours conservés et expliqués, sans proratisation.

69 cas de seuils et une observation globale partagés Python/TypeScript, vérifiés
contre les vraies fonctions dashboard_metrics.py (lecture seule, pandas existant,
sans lancer Streamlit). Différences V2 explicites : semaine vide sans score social
inventé, repas comptés sans analyse, calories/macros obsolètes exclues, chevauchements
travail exclus, sommeil configurable, date tabac future non évaluée et limite
portable 4h12/3h corrigée malgré l'arrondi binaire. Pondération V1 conservée.

115 tests Node, TypeScript et 12 tests Python réussis. Test écran lecture échouée,
réessai et mise à jour du score portable après réglage. Aucune migration, installation,
compilation ou donnée réelle. Documentation Streamlit du skill non découvrable
dans cet environnement ; comparaison fondée sur code métier Python exécuté directement.
Périodes longues, PDF, catalogues/historiques, intégrations et essais Android restent ouverts.


### Corrections audit — ergonomie de saisie et première utilisation — 27/10/2026

Conservation sociale précédente commitée 4ad6aeb. Calendrier français replié par
défaut (pas de grille coûteuse au premier affichage), semaine lundi/dimanche,
jours futurs bloqués ; sélectionner une date n'ouvre rien sans confirmation.
Saisie manuelle de date conservée. Horaires 8:48 / 0848 / 8h48 normalisés en HH:MM,
formats incomplets conservés en brouillon ; valeurs persistées restent strictes.
Portable, sieste et quatre activités en heures/minutes précises. Total temps pour
moi n.c. si tout manque, zéro seulement si renseigné ; calcul immédiat depuis le
brouillon valide. Message distingue valeurs enregistrées et validation de l'étape.

Dernières mesures corporelles indépendantes, strictement antérieures et datées ;
réutilisation volontaire confirmée, patch du seul indicateur. Récapitulatif travail
ajoute type/durée/solde avant/jour/après via le même WorkBalanceCard. Une seule
carte énergétique. Assistant : accès direct sauvegarde avant activation biométrique,
retour à la même étape. Depuis les Réglages principaux, une lecture de préférences
corrompues n'interdit plus d'ouvrir la récupération, sans réinitialisation silencieuse.
Rouge d'action assombri #c83232 pour contraste blanc >=4,5:1 ; accent V1 conservé.

109 tests Node, TypeScript et 10 tests Python locaux réussis. Dix nouveaux tests
domaines/React/SQLite, avec minuit/dates, année bissextile, zéro/absence, durée
incomplète, mesure datée/confirmation, résumé travail et assistant. Aucun nouveau
paquet, téléchargement, build ou donnée réelle. Rendu/clavier/insets et grandes
polices restent à vérifier sur téléphone. Scores, périodes longues, PDF, gestion
catalogues/historiques et intégrations restent requis : objectif global non terminé.


### Corrections audit — conservation sociale et objectifs — 27/10/2026

Lot navigation précédent commité b043eda. Migration additive 006_social_selection :
décocher une rencontre change included à 0, sans DELETE. Recocher réutilise UUID,
note, contexte, durée (zéro compris) et date de création ; CAS maintenu. Récapitulatif
et bilans filtrent included=1, sauvegarde conserve aussi les rencontres décochées.
Anciennes sauvegardes 003–005 acceptées avec included=1 connu ; métadonnées futures
injectées refusées. Import V1 renseigne included ; rejeu après réouverture et
restauration ne réactive pas une rencontre décochée en V2.

Archiver un objectif ne modifie plus completed_at. Terminer/Rouvrir sont deux
actions explicites distinctes ; contraintes de trois actifs et révisions maintenues.
Dates historiques existantes conservées : on ne peut pas distinguer sûrement une
ancienne erreur d'archivage d'une réalisation réelle. Les notes déjà détruites par
l'ancien comportement ne sont pas reconstituables sans une sauvegarde antérieure.

99 tests Node, TypeScript et 10 tests Python locaux réussis. Six nouveaux tests
incluent cases à cocher réelles, backup/restore exact, migration interrompue/reprise,
compatibilité 005 et séparation archive/réalisation. Aucun accès aux données réelles,
Neon, nouvelle dépendance ou build ; preuve Android et parité globale encore ouvertes.


### Corrections audit — navigation et interactions — 27/10/2026

Menu Saisie/Bilan/Todo/Réglages indépendant du chargement quotidien ; éditeurs
maintenus montés et inaccessibles lorsqu'ils sont masqués, pour conserver les
brouillons incomplets et les erreurs. Bilan reprend la date de la saisie sans
modifier la date d'un brouillon masqué et relit compteur/séries à chaque retour.
Retour quotidien suit les écrans réellement visités (accès direct => accueil).
Chargements jour/sport/réglages réessayables. Conflit quotidien : relecture et
choix explicites champ par champ, deuxième conflit refusé sans écrasement forcé.
Barrières attendent toutes les opérations, même en cas d'échec d'une d'entre elles,
y compris l'initialisation des trois séances ; restauration/import refusés si un
brouillon reste incomplet/non confirmé. Écrans remontés après remplacement réussi.
Libellé d'écoute relu au retour des réglages sans réinitialiser les mesures.

93 tests Node et TypeScript réussis, dont neuf nouveaux tests navigation/React,
composants réels et SQLite synthétique ; seuls les ports natifs sont simulés.
react-test-renderer 19.2.3 ajouté en développement, version alignée sur React ;
outil déprécié mais borné aux interactions, pas une preuve de rendu Android.
Installation précédente : enveloppe locale de 20 Mo dépassée (~21,9 Mo ajoutés,
cache npm inclus), arrêt du garde-fou après installation ; budget global intact.
Aucune nouvelle installation ni build dans ce lot de reprise. Validation Android
reste ouverte, ainsi que parité, PDF, intégrations, ergonomie et audit social.


### Corrections audit — sommeil et fraîcheur — 27/10/2026

Lot précédent commité fe6cf46. Migration additive 005_daily_derivations : mode de
sommeil (calculé/manuel/importé), fraîcheur/origine/version des entrées d'analyse.
Horaires => durée calculée automatiquement, passage minuit ; mode manuel explicite
et avertissement de divergence. Valeurs historiques conservées sans recalcul imposé.
Modification repas/corps ou séance rend l'estimation obsolète sans effacer chiffres,
date, modèle ni hash. Triggers sport atomiques avec révision dérivée distincte de la
révision d'édition quotidienne : pas de conflit artificiel au retour d'étape.
EnergyCard unique, réutilisée en Alimentation/Récapitulatif, provenance et anciennes
valeurs consultables ; agrégats excluent les estimations obsolètes et l'annoncent.
Sauvegardes 003/004 restaurables avec ajout connu de métadonnées ; comparaison des
valeurs restaurées maintenue malgré les triggers. Nouvel import V1 finalise les
métadonnées des seules journées nouvelles, rejeu conserve les modifications V2.
84 tests Node, TypeScript et 10 tests Python locaux réussis. Aucune donnée réelle,
installation ou compilation. Pas encore de tests d'écran/Android ; objectif global
reste actif, navigation et parité à poursuivre (docs/14_corrections_audit.md).

### Corrections audit — lot notes/sport/travail — 27/10/2026

Nouvel objectif actif : corriger tous les constats du dernier audit, navigation,
ergonomie et parité V1 comprises. Suivi exhaustif dans docs/14_corrections_audit.md ;
ne pas réduire la clôture à quelques tests de domaine.
Décocher un objectif passe worked à 0 sans supprimer note/UUID/date de création.
Sport : validation du couple heures/minutes (anciens drapeaux effacés ensemble),
buffers synchrones, suppression complète confirmée en un patch, cartes repliables
et réouverture des cartes invalides à la navigation.
Travail : journée continue compatible créneau 3 ; détection de chevauchements,
y compris après minuit. Horaires toujours sauvegardés ; durée incohérente non
comptée. Les anciennes durées avec chevauchement ne sont pas écrasées en base :
le rapport partagé les exclut et cite les dates à corriger.
79 tests Node et TypeScript réussis. Aucune migration, donnée réelle, modification
V1, installation ou compilation native. Tests d'écran/Android encore à faire.
Prochain lot : sommeil cohérent et fraîcheur des estimations, avec sauvegardes
compatibles, puis navigation indépendante/récupération des erreurs.

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
