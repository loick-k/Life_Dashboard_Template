# Consignes spécifiques V2 mobile

## Lecture de reprise

Lire `CONTEXT.md`, puis les documents utiles dans `docs/`. Ce fichier complète
`../AGENTS.md`. Maintenir ces consignes quand une décision produit change.

## Autonomie et parité

- V2 mono-utilisateur Android : SQLite local est la source de vérité.
- Saisie, consultation, historique et bilans doivent fonctionner sans réseau,
  sans serveur V1 et sans connexion Google obligatoire.
- Copier les données V1 par import explicite ; ne pas écrire dans Neon, ni
  ajouter une synchronisation V1/V2 implicite.
- Reproduire libellés, ordre des étapes, navigation, couleurs, indicateurs et
  comportements V1. Utiliser des données fictives pour les comparaisons d'écran.
- Documenter chaque différence nécessaire aux contrôles tactiles natifs.
- Todoist et analyse nutritionnelle restent des fonctions en ligne optionnelles.
  Leur échec ne doit pas empêcher une sauvegarde locale.

## Architecture et données

- Isoler les dépendances mobiles de celles de Streamlit. Le Python existant sert
  de référence métier ; il ne s'exécute pas automatiquement dans une app TypeScript.
- Ne pas réutiliser aveuglément `../repositories/sql.py` : il cible le schéma V1.
- Utiliser UUID stables, écritures ciblées, transactions et contrôle de révision.
- Distinguer champ omis, zéro et suppression explicite. Sauvegarder les horaires
  partiels et les séances incomplètes sans perdre les valeurs déjà saisies.
- Une migration et son inscription au journal doivent être atomiques ; tester
  interruption, reprise et changement de checksum.
- Dates métier Europe/Paris ; horodatages techniques UTC. Calculer les durées
  en minutes et conserver les valeurs sources pour les rapprochements V1/V2.
- Chiffrement de la base et sauvegardes authentifiées à implémenter avant usage
  réel. Protéger les clés avec les mécanismes Android ; ne pas inventer de cryptographie.
- Aucun secret intégré au code ou à l'APK. Ne jamais journaliser de données personnelles.

## Vérification et fin de lot

Tester sur données synthétiques : navigation, relance, fermeture forcée, écriture
interrompue, restauration, import rejoué et absence d'effacement entre indicateurs.
Pour les écrans, comparer V1 et V2 ; pour les calculs, comparer entrées et sorties.
Une sauvegarde exige un test de restauration, pas seulement un fichier créé.
Actualiser `CONTEXT.md` avec résultats, limites, commit et prochain travail.
Ne pas cocher un critère « implémenté » lorsque seul son principe est documenté.
