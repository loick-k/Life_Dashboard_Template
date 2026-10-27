# Corrections de l'audit fonctionnel et navigation

Objectif utilisateur du 27/10/2026 : corriger **tous** les points de l'audit,
fiabiliser la navigation et retrouver les fonctions/interface V1. Aucun sous-lot
ci-dessous ne constitue une clôture de l'objectif global. V1 indépendante,
données synthétiques, pas de Neon/push, plafond cumulatif disque 5 Go inchangé.

## Suivi et preuves

| Exigence | État / preuve locale | Encore nécessaire |
|---|---|---|
| Comparaison quotidienne sans perte d'une saisie postérieure | Verrou synchrone des champs et callbacks tardifs, barrières attendent la résolution, réouverture avec dernier brouillon et second conflit refusé ; trois tests React/SQLite | Android |
| Brouillons durables après redémarrage | Champs quotidiens, sports, journaux, treize réglages et ajouts de répertoire journalisés avant SQL ; reprise explicite, CAS/token, UUID de création stable et nettoyage réessayable ; dix + sept + cinq + six + onze tests dédiés SQLite/React | Arrêt forcé Android ; intégrations restantes |
| Sortie d'un répertoire illisible sans brouillon | Retour/Back attendent les opérations puis autorisent la sortie malgré lecture échouée, sans abandon d'un ajout ; deux tests React/SQLite | Android |
| Aujourd'hui/Hier après minuit Paris | Date recalculée à l'appui après flush, référence vivante/retour actif et évaluation actualisée sans changer la date historique ; trois tests React/SQLite, DST mars/octobre | Android |
| Note d'objectif conservée en décochant/recochant | UPDATE worked au lieu de DELETE ; test identité/note/date/révision | Interaction Android |
| Correction sportive débloque Continuer | Validation paire heures/minutes, suppression des deux anciens indicateurs d'erreur | Test d'écran et Android |
| Retrait complet d'une séance | Action explicite confirmée, patch atomique des 3 champs à null ; autre séance/poids/bilan préservés | Test d'écran et Android |
| Travail : journée continue + créneau 3 | Calcul 08–16 + 18–19 = 540 min ; incomplet reste null | Android |
| Travail : chevauchements | Exclusion des cumuls et avertissement ; anciennes valeurs sources non réécrites ; tests jour/semaine/nuit | Android |
| Travail : durée historique après changement de mode | Recalcul seulement si un des six horaires change réellement ; durées V1 sans/avec horaires partiels et zéro conservés, tests SQLite/React | Android |
| Travail : Day off sans horaires | Zéro explicite à la lecture seulement, partagé par formulaire/compteur/PDF/séries/évaluation ; retour Bureau sans faux débit ; tests SQLite/React | Android |
| Sommeil dérivé des horaires, sieste et cohérence | Calcul nuit/minuit, modes calculé/manuel/importé, avertissement de désaccord ; tests SQLite | Test d'écran et Android |
| Estimation nutritionnelle obsolète après changement | Migration 005, fraîcheur/version propres, valeurs/provenance conservées, exclusion visible et carte unique | Test d'écran et Android, calcul en ligne encore à porter |
| Chargement journalier récupérable | Réessayer jour/sport/réglages ; menu indépendant ; tests React | Android |
| Conflit de révision récupérable sans perdre le brouillon | Comparaison champ par champ et CAS ; deuxième conflit refusé ; tests React/SQLite | Android |
| Conflit sportif récupérable | Comparaison par séance/champ, choix explicites, second conflit refusé, buffers et autres séances conservés ; tests React/SQLite | Android |
| Conflit de position de navigation | Relecture du seul curseur, sans changer écran/mesures/buffers/progression ; test React | Android |
| Menu principal, date commune et retour Android | Éditeurs conservés, date Bilan et historique réel de retour ; tests React avec Back simulé | Retour physique Android |
| Bilan actualisé après saisie | Relecture compteur et séries au retour, même date ; test +1 h et poids modifié | Android |
| Barrière sur chargement sportif lent/en échec | Attend les trois initialisations et toutes les files ; échec réessayable ; tests React | Android |
| Notes/durées sociales après décochage/recochage | Migration 006, included au lieu de DELETE ; UUID/détails conservés, compteurs filtrés, backup/import/rejeu/React testés | Android ; anciennes pertes nécessitent sauvegarde antérieure |
| Détails sociaux et notes d'objectifs modifiables | Éditeur repliable, notes/contexte/durée h/min, autosauvegarde CAS, comparaison après conflit, barrières et backup/restore ; neuf tests React/SQLite | Android |
| Brouillon sous archive visible lors d'un blocage | Archives et détails invalides révélés après archivage depuis un autre écran ; statut non enregistré explicite ; test React/SQLite | Android |
| Formats heures/minutes et calendrier français | Portable/sieste/activités h/min, horaires normalisés, calendrier français repliable ; tests React | Validation tactile Android, grandes polices |
| Sport moins encombrant | Cartes repliables, champs invalides révélés lors du flush | Vérification téléphone |
| Enregistré distinct d'étape validée ; absence distincte de zéro | Message explicite, total n.c. si absent, zéro saisi distinct ; tests | Android |
| Récapitulatif travail/calories complet | Type/durée/compteurs partagés ; carte kcal unique avec provenance ; tests React | Calcul distant à porter et Android |
| Sauvegarde accessible avant biométrie | Route directe depuis protection, retour à la même étape ; test React | Sauvegarde/biométrie sur Android |
| Dernières mesures corporelles datées / réutilisation volontaire | Lecture strictement avant date, chaque mesure indépendante ; confirmation et patch ciblé ; tests React/SQLite | Android |
| Contraste des actions principales | Palette #c83232, contraste blanc >=4,5:1 testé ; accent V1 maintenu | Vérification visuelle sur téléphone |
| Objectifs/réglages influencent les indicateurs | Les sept réglages sont consommés ; zéros explicités, couverture travail indépendante du compteur fixe ; tests | Android |
| Scores et évaluation hebdomadaire V1 | 23 lignes, 22 pondérées ; semaine Paris actuelle ; fixtures V1 et UI réessayable connectées | Android ; différences V2 explicites ci-dessous |
| Périodes mensuelles, annuelles et depuis le début | Quatre périodes V1, 29 séries, fenêtres graphiques complètes, agrégats sur jours observés, fixtures V1 et tests React | Rendu et performances Android |
| Rapport PDF travail | Export local sous le graphe, modèle partagé, relecture identique, deux pages/3 créneaux ; tests et six pages fictives contrôlées | Sélecteur, écriture et lecture du PDF sur Android |
| Social : récurrence et historique détaillé | Statistiques UUID, jours/intervalles V1, périodes semaine/mois, journaux paginés/filtrés et notes ; six tests React/SQLite et parité Python | Rendu et performances Android |
| Personnes/objectifs gérés hors journal | Répertoires autonomes, ajout sans journal, notes modifiables et historiques, archives/terminés séparés ; retour/date/brouillons préservés | Android |
| Objectif archivé distinct de terminé | Actions Archiver/Terminer/Rouvrir séparées ; dates préservées lors d'archive ; tests CAS/capacité/React | Android ; dates historiques ambiguës non réécrites |
| Todoist optionnel | Client REST/Sync, SecureStore et commande durable UUID/reprise testés sur faux serveur, sans accès réel | Brancher écrans/assistant/Bilan, tests d'interaction et Android |
| Analyse nutritionnelle explicite optionnelle | À porter | Secrets, calcul asynchrone, résultat unique |
| Clavier, encoches, retour en haut, grandes polices/accessibilité | À vérifier/corriger | Écrans et mesures téléphone |
| Couverture d'interactions | Tests navigation/sport/social/ergonomie/évaluation/historique ; composants et SQLite réels, ports natifs simulés | Étendre aux parcours restants et essais Android |

## Dernière clôture : ajouts de répertoire — 27/10/2026

215 tests Node, TypeScript et 16 tests Python réussis. Texte/catégorie et identité
de création privés par contexte ; lecture n'applique rien au répertoire. Commande
préparée durable avant INSERT ; perte de confirmation ou panne de nettoyage =>
reprise volontaire du même UUID, sans doublon ni modification d'une ligne existante.
Conflit de contenu refusé, homonymes distincts, objectif existant confirmé même à
capacité maximale. Abandon explicite ne supprime aucune personne/contribution.
Onze tests synthétiques SQLite/React, dont fermeture/réouverture de fichier,
concurrence, formats incompatibles, restauration et barrière de lecture lente.
Pas de nouveau schéma/dépendance/build, V1 intacte. Pause demandée en fin
d'itération après commit local ; intégrations, ergonomie et preuves Android restent
ouvertes. Aucun push.

## Lot intégrité notes/sport/travail

79 tests Node réussis, TypeScript valide. Cinq nouveaux tests : note importée,
révision obsolète, retrait d'un sport sans effacer les autres données, correction de
durée, horaires contigus/nuit/chevauchement, jour continu + créneau supplémentaire,
ancien compteur incohérent conservé en base mais exclu visiblement du bilan.
Aucun changement de schéma dans ce lot. Tests d'interaction et preuve matérielle
Android restent ouverts. Aucun build, dépendance ou téléchargement supplémentaire.

## Lot sommeil et fraîcheur des estimations

Migration additive 005 : mode de durée du sommeil, état obsolète, origine et version
des entrées d'analyse. Horaires édités => durée calculée ; choix manuel préservé et
différence annoncée ; valeurs historiques/importées non recalculées silencieusement.
Sieste distincte, passage à minuit et égalité coucher/réveil (24 h, règle V1) testés.

Changement repas/corps/sport => estimation obsolète, jamais destruction du résultat
original ni de sa provenance. Révision dérivée indépendante de la révision d'édition
du jour pour éviter les conflits artificiels lors d'une modification sportive.
Carte unique en Alimentation et Récapitulatif ; valeurs obsolètes exclues des agrégats
avec avertissement, anciennes valeurs consultables explicitement. Calcul distant à
porter dans un lot suivant : aucune analyse n'est déclenchée par une sauvegarde.

Sauvegardes 003/004 compatibles par ajout explicite des seules métadonnées connues.
Restauration rétablit exactement la fraîcheur capturée après insertion des séances ;
nouvel import V1 finalise la fraîcheur uniquement des nouvelles journées, jamais d'un
import déjà modifié en V2. Rollback migration/journal et injection de métadonnées
futures refusée testés. 84 tests Node, TypeScript et 10 tests Python locaux réussis.
Tests d'écran et validation Android encore ouverts. Pas de nouveau build/outillage.

## Lot navigation et récupération

93 tests Node et TypeScript réussis. Tests React réels (ports Android simulés) :
sport invalide corrigé puis suppression confirmée d'un seul créneau, chargement
lent avec une écriture en échec, retour direct vers l'accueil, chargement quotidien
réessayé, comparaison/résolution de révision, réglages illisibles réessayés,
menu utilisable malgré erreur, conservation d'horaires complets/incomplets entre
écrans, restauration bloquée par ce brouillon. Compteur et poids du Bilan sont
relus au retour. Les sauvegardes n'annoncent pas inclure des brouillons non confirmés.
Pas de preuve native : biométrie, rendu/clavier/insets et arrêt forcé restent ouverts.
La matrice de parité et tous les lots non réalisés ci-dessus restent requis.

## Lot social sans destruction et réalisation explicite

Migration 006 additive et atomique avec journal. Les rencontres décochées restent
dans la sauvegarde mais hors récapitulatif et agrégats. Test de perte d'une note et
durée importées remplacé par un aller-retour case à cocher qui conserve tout.
Anciennes sauvegardes 003–005 converties explicitement ; test d'injection future
refusée sans changer la destination. Rejeu V1 après réouverture et restauration
préserve la désélection et la note V2. Objectif archivé ≠ terminé, date de fin
inchangée sauf action explicite ; réouverture soumise à la limite de trois actifs.
99 tests Node, TypeScript et 10 tests Python réussis. Validation native encore requise.

## Lot ergonomie et parcours initial

109 tests Node et TypeScript réussis. Tests domaines et interactions réelles :
normalisation d'horaires tout en conservant une validation stricte du stockage,
dates bissextiles/calendrier lundi, sélection sans ouverture implicite, futur bloqué,
durées h/min et retour sans perte, absence distincte de zéro, dernières mesures
datées et réutilisation uniquement après confirmation. Résumé travail complet et
carte énergétique unique ; sauvegarde avant activation accessible dans l'assistant.
Récupération ouvrable malgré réglage corrompu, sans écraser ce réglage. Palette
rouge adaptée au petit texte blanc. Aucun test ne prétend valider le rendu natif :
clavier, insets, grandes polices, biométrie et arrêt forcé restent à réaliser.

## Lot évaluation de la semaine en cours

115 tests Node, TypeScript et 12 tests Python réussis. 69 cas de seuils plus une
observation globale vérifiés contre les fonctions réelles V1 et le port TypeScript.
Semaine Paris en cours indépendante des courbes historiques ; n.c. exclu du global,
couverture visible, scores détaillés repliables, lecture réessayable et rafraîchissement
après modification d'un réglage. Aucun des sept réglages signalés ne reste sans effet.
Jours de référence agit sur Travail · suivi (hors pondération), pas sur le cumul 7h42.

Corrections délibérées par rapport à V1, testées séparément : absence sociale ne vaut
pas zéro, objectif nul pas remplacé silencieusement par défaut, maximum portable nul
strict, sommeil minimum configurable, repas sans estimation comptés, estimations
obsolètes et horaires chevauchants exclus. Date tabac future n.c. Limite 4h12 avec
maximum portable de 3h évaluée correctement malgré les flottants binaires.
Seuils alimentaires V1 2/4/6 jours et objectifs hebdomadaires non proratisés conservés.
Il s'agit d'un outil personnel de suivi, pas d'un bilan médical.

## Lot historique et périodes V1

122 tests Node, TypeScript et 14 tests Python réussis. 29 séries, toutes les
périodes V1, données nulles gardées nulles, totaux/moyennes calculés sur toute la
période et dernière valeur corporelle distinguée des moyennes du graphique.
24 points maximum montés par graphique, pages vers l'intégralité de l'historique ;
pas de réduction silencieuse des données. Vérification dix années fictives et
réponses asynchrones périmées, réessai, sélection de catégorie conservée.
Le compteur travail n'est jamais remis à zéro par un changement de période.
Textes libres de repas non lus dans les longues séries. Comptages des catégories
non renseignées ne deviennent pas artificiellement zéro à l'ouverture d'une journée.
Fenêtres et agrégats mensuels vérifiés avec Python et la fonction V1 réelle isolée.
Semaines explicitement lundi–dimanche plutôt que la fréquence V1 finissant lundi.
Rendu, mémoire et fluidité restent à mesurer sur téléphone, pas seulement sur PC.

## Reprise audit — conservation du travail

133 tests Node dans l'arbre courant (huit PDF encore non commités), TypeScript valide.
Trois tests nouveaux couvrent la perte reproduite de 7h42 après changement de mode,
une durée historique de 7h27 avec début isolé, zéro, patch inchangé et tous les modes.
Modifier réellement un horaire conserve le recalcul atomique et les autres indicateurs.
Test du formulaire réel avec Continuer/Retour et relecture du compteur partagé.
Pas de modification de schéma ni migration corrective des données historiques : une
durée déjà perdue ne peut pas être reconstruite sans source/sauvegarde antérieure.

## Reprise audit — récupération des conflits

138 tests Node dans l'arbre courant et TypeScript valides. Réessayer une séance ne
résout plus seul un conflit : comparaison explicite proposée, valeurs courantes
relues, seul le patch choisi appliqué sous CAS. Un deuxième conflit conserve le
brouillon et impose une nouvelle relecture. Les buffers invalides non remplacés
restent présents et empêchent toujours une fausse validation de l'étape. Relecture
de position indépendante des mesures et des saisies incomplètes ; pas de reset du
formulaire. Les contrôles d'interaction ne remplacent pas le retour physique Android.
