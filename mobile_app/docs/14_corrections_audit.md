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
| Sommeil dérivé des horaires, sieste et cohérence | À corriger | Domaine, UI, tests |
| Estimation nutritionnelle obsolète après changement | À corriger | Persistance, provenance et affichage |
| Chargement journalier récupérable | À corriger | Réessayer, navigation indépendante |
| Conflit de révision récupérable sans perdre le brouillon | À corriger | Résolution explicite, tests |
| Menu principal, date commune et retour Android | À corriger | Routes explicites, contexte, tests d'interaction |
| Formats heures/minutes et calendrier français | À corriger | Contrôles tactiles et tests |
| Sport moins encombrant | Cartes repliables, champs invalides révélés lors du flush | Vérification téléphone |
| Enregistré distinct d'étape validée ; absence distincte de zéro | À corriger | Progression, temps pour moi, messages |
| Récapitulatif travail/calories complet | À corriger | Type/durée/cumul, provenance kcal |
| Sauvegarde accessible avant biométrie | À corriger | Assistant reprenable et route directe |
| Dernières mesures corporelles datées / réutilisation volontaire | À porter | Lecture bornée avant date, confirmation |
| Objectifs/réglages influencent les indicateurs | À porter | Sept réglages encore sans effet métier |
| Scores et évaluation hebdomadaire V1 | À porter | Calculs/fixtures communes, UI |
| Périodes mensuelles, annuelles et depuis le début | À porter | Agrégation et navigation |
| Rapport PDF travail | À porter | Génération locale, contenu et rendu vérifiés |
| Social : récurrence et historique détaillé | À porter | Domaine, stockage, écran |
| Personnes/objectifs gérés hors journal | À porter | Ajouter sans créer un faux journal |
| Objectif archivé distinct de terminé | À corriger | Actions séparées, date de fin préservée |
| Todoist optionnel | À porter | Secrets appareil, interface et erreurs réseau |
| Analyse nutritionnelle explicite optionnelle | À porter | Secrets, calcul asynchrone, résultat unique |
| Clavier, encoches, retour en haut, grandes polices/accessibilité | À vérifier/corriger | Écrans et mesures téléphone |
| Couverture d'interactions | À ajouter | Les tests Node actuels ne montent pas encore les écrans |

## Lot intégrité notes/sport/travail

79 tests Node réussis, TypeScript valide. Cinq nouveaux tests : note importée,
révision obsolète, retrait d'un sport sans effacer les autres données, correction de
durée, horaires contigus/nuit/chevauchement, jour continu + créneau supplémentaire,
ancien compteur incohérent conservé en base mais exclu visiblement du bilan.
Aucun changement de schéma dans ce lot. Tests d'interaction et preuve matérielle
Android restent ouverts. Aucun build, dépendance ou téléchargement supplémentaire.
