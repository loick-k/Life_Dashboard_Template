# Corrections de l'audit fonctionnel et navigation

Objectif utilisateur du 27/10/2026 : corriger **tous** les points de l'audit,
fiabiliser la navigation et retrouver les fonctions/interface V1. Aucun sous-lot
ci-dessous ne constitue une clôture de l'objectif global. V1 indépendante,
données synthétiques, pas de Neon/push, plafond cumulatif disque 5 Go inchangé.

## Suivi et preuves

| Exigence | État / preuve locale | Encore nécessaire |
|---|---|---|
| Note d'objectif conservée en décochant/recochant | UPDATE worked au lieu de DELETE ; test identité/note/date/révision | Interaction Android |
| Correction sportive débloque Continuer | Validation paire heures/minutes, suppression des deux anciens indicateurs d'erreur | Test d'écran et Android |
| Retrait complet d'une séance | Action explicite confirmée, patch atomique des 3 champs à null ; autre séance/poids/bilan préservés | Test d'écran et Android |
| Travail : journée continue + créneau 3 | Calcul 08–16 + 18–19 = 540 min ; incomplet reste null | Android |
| Travail : chevauchements | Exclusion des cumuls et avertissement ; anciennes valeurs sources non réécrites ; tests jour/semaine/nuit | Android |
| Sommeil dérivé des horaires, sieste et cohérence | Calcul nuit/minuit, modes calculé/manuel/importé, avertissement de désaccord ; tests SQLite | Test d'écran et Android |
| Estimation nutritionnelle obsolète après changement | Migration 005, fraîcheur/version propres, valeurs/provenance conservées, exclusion visible et carte unique | Test d'écran et Android, calcul en ligne encore à porter |
| Chargement journalier récupérable | Réessayer jour/sport/réglages ; menu indépendant ; tests React | Android |
| Conflit de révision récupérable sans perdre le brouillon | Comparaison champ par champ et CAS ; deuxième conflit refusé ; tests React/SQLite | Android |
| Menu principal, date commune et retour Android | Éditeurs conservés, date Bilan et historique réel de retour ; tests React avec Back simulé | Retour physique Android |
| Bilan actualisé après saisie | Relecture compteur et séries au retour, même date ; test +1 h et poids modifié | Android |
| Barrière sur chargement sportif lent/en échec | Attend les trois initialisations et toutes les files ; échec réessayable ; tests React | Android |
| Notes/durées sociales après décochage/recochage | Migration 006, included au lieu de DELETE ; UUID/détails conservés, compteurs filtrés, backup/import/rejeu/React testés | Android ; anciennes pertes nécessitent sauvegarde antérieure |
| Formats heures/minutes et calendrier français | Portable/sieste/activités h/min, horaires normalisés, calendrier français repliable ; tests React | Validation tactile Android, grandes polices |
| Sport moins encombrant | Cartes repliables, champs invalides révélés lors du flush | Vérification téléphone |
| Enregistré distinct d'étape validée ; absence distincte de zéro | Message explicite, total n.c. si absent, zéro saisi distinct ; tests | Android |
| Récapitulatif travail/calories complet | Type/durée/compteurs partagés ; carte kcal unique avec provenance ; tests React | Calcul distant à porter et Android |
| Sauvegarde accessible avant biométrie | Route directe depuis protection, retour à la même étape ; test React | Sauvegarde/biométrie sur Android |
| Dernières mesures corporelles datées / réutilisation volontaire | Lecture strictement avant date, chaque mesure indépendante ; confirmation et patch ciblé ; tests React/SQLite | Android |
| Contraste des actions principales | Palette #c83232, contraste blanc >=4,5:1 testé ; accent V1 maintenu | Vérification visuelle sur téléphone |
| Objectifs/réglages influencent les indicateurs | À porter | Sept réglages encore sans effet métier |
| Scores et évaluation hebdomadaire V1 | À porter | Calculs/fixtures communes, UI |
| Périodes mensuelles, annuelles et depuis le début | À porter | Agrégation et navigation |
| Rapport PDF travail | À porter | Génération locale, contenu et rendu vérifiés |
| Social : récurrence et historique détaillé | À porter | Domaine, stockage, écran |
| Personnes/objectifs gérés hors journal | À porter | Ajouter sans créer un faux journal |
| Objectif archivé distinct de terminé | Actions Archiver/Terminer/Rouvrir séparées ; dates préservées lors d'archive ; tests CAS/capacité/React | Android ; dates historiques ambiguës non réécrites |
| Todoist optionnel | À porter | Secrets appareil, interface et erreurs réseau |
| Analyse nutritionnelle explicite optionnelle | À porter | Secrets, calcul asynchrone, résultat unique |
| Clavier, encoches, retour en haut, grandes polices/accessibilité | À vérifier/corriger | Écrans et mesures téléphone |
| Couverture d'interactions | Neuf tests navigation/React ; composants et SQLite réels, ports natifs simulés | Étendre aux autres parcours et essais Android |

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
