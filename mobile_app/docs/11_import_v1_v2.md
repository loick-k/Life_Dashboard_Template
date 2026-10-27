# Import contrôlé V1 vers V2

## État

Le convertisseur, la simulation transactionnelle, le journal d'import et les
écrans sont écrits. 5 scénarios Node/SQLite et 1 compatibilité de sauvegarde passent.
Les tests génèrent uniquement des données fictives. Aucun export personnel ni
accès Neon n'a été exécuté dans ce lot ; l'import réel attend l'accord utilisateur
et la validation du runtime Android.

## Préparer le fichier

Utiliser un dossier d'instantané issu de scripts/export_snapshot.py : manifest.json
et un fichier JSON par table. La préparation ci-dessous lit seulement ce dossier,
sans connexion réseau. Ne pas lancer l'ancien export Neon sans l'accord prévu.

Depuis mobile_app, avec Node déjà installé :

```powershell
New-Item -ItemType Directory -Path exports -Force
npm run v1:bundle -- --snapshot "CHEMIN_EXPLICITE_INSTANTANE" --output "exports\migration.ldv1.json" --source-id life-dashboard-v1
```

L'origine source-id doit rester identique pour les exports suivants de la même
V1. Utiliser une autre origine ne contourne pas les collisions de dates.
Un fichier de sortie existant n'est jamais remplacé. Les checksums de tables sont
recalculés après filtrage des réglages inconnus ; aucune valeur personnelle n'est
affichée. Un manifeste incomplet, un compteur incohérent ou un chemin sortant du
dossier est refusé.

Le fichier .ldv1.json contient des données personnelles **en clair** comme l'ancien
instantané V1 : le conserver dans exports/ (ignoré par Git), dans un emplacement
privé et le transférer directement au téléphone. La V2 écrit ensuite dans sa base
chiffrée ; créer une sauvegarde V2 chiffrée après import. Ne pas téléverser ce
fichier dans un dépôt, un chat, un outil d'analyse ou un serveur public.

## Importer sur le téléphone

Dans Première utilisation → Tes données, ou Réglages → Importer un export V1 :

1. Choisir le fichier consolidé. La simulation exécute les mêmes validations et
   écritures que l'import puis annule la transaction.
2. Lire les compteurs par table et les avertissements (arrondi, archives, anciennes
   progressions, éventuels écarts entre totaux et détails).
3. Confirmer l'import. Une nouvelle validation et une comparaison d'empreinte
   précèdent les écritures ; les valeurs insérées sont relues dans SQLite.
4. Contrôler le rapport puis les journées et créer une sauvegarde V2.

Ne pas entrer dans cette route avec des brouillons non sauvegardés. Les boutons
existants attendent les écritures et ferment les formulaires avant l'import.
Retour Android attend la fin de l'opération ; une panne SQL annule tout le lot.

## Correspondances

| Source V1 | Cible V2 |
|---|---|
| Date quotidienne | Date identique, UUID déterministe |
| Identifiants numériques, date/personne, date/objectif | UUID déterministes par origine/table/clé |
| Valeurs corporelles, notes, repas, calories/macros, écoute, temps pour soi | Valeurs conservées ; null et zéro distincts |
| waist_cm si belly_cm absent | belly_cm ; source originale conservée |
| Heures travail/portable/social | Minutes arrondies, source exacte archivée et arrondi signalé |
| Trois créneaux/horaires partiels | Champs indépendants conservés |
| Durée travail calculable et durée enregistrée différentes | Durée enregistrée V1 conservée, avertissement et archive |
| Séances détaillées | Positions 1..3, durée/type/distance indépendants |
| Ancien total sport sans séances | Une séance issue du total, avec avertissement |
| Progression versions 1..5 | Migrations V1 puis IDs V2 ; fin recalculée, curseur premier indicateur restant |
| Pas de progression persistée | Inférence V1 depuis les champs/journaux, signalée |
| Réglages connus | Préférences V2 versionnées ; autres réglages exclus |
| Todo locale historique, consommation API, journal de migration V1 | Archive locale incluse dans les sauvegardes, sans exécution ni faux branchement aux écrans V2 |

Horodatages avec fuseau : UTC. Si un horodatage technique n'a pas de fuseau, la
date de l'export sert de valeur technique ; l'original est archivé et signalé.
Les dates métier ne changent pas. Les colonnes inconnues et valeurs non représentables
sont refusées. Il n'y a ni troncature des séances ni suppression d'objectif pour
respecter une limite ; plus de trois actifs exige un arbitrage préalable.

## Rejeu et collisions

Même origine et mêmes lignes => aucune réécriture métier, même si l'utilisateur
a ensuite modifié ou retiré un élément en V2. Un export suivant peut ajouter de
nouvelles dates. Les lignes absentes d'un export ultérieur ne suppriment rien.

Une date déjà créée nativement en V2, un réglage différent ou une ligne source
modifiée depuis le précédent import bloque tout le lot. Une journée et ses
séances/journaux sont comparées comme un groupe : aucun mélange de deux versions.
Les décisions de rapprochement de ces collisions demandent un traitement explicite
ultérieur ; changer l'origine ou effacer la V2 pour contourner l'erreur n'est pas
une procédure prévue. Une sauvegarde reste indispensable avant toute intervention.

Les archives conservent les valeurs originales et leurs clés, y compris les
historiques sans écran mobile équivalent. Elles sont exportées/restaurées avec
le journal d'import pour que le rejeu reste sûr après changement de téléphone.
Les colonnes/identifiants SQL proviennent du code et du schéma local, jamais du fichier.

## Limites

Fichier consolidé : 8 Mio, 100 000 lignes maximum. Le format accepte seulement les
12 tables V1 connues. Les anciennes tâches ne sont pas envoyées automatiquement
à Todoist ; les journaux API n'alimentent pas encore un écran de consommation V2.
Le sélecteur de fichiers, SQLCipher, l'arrêt forcé Android et la comparaison avec
l'historique réel restent à valider. V1 et V2 continuent à fonctionner indépendamment.
