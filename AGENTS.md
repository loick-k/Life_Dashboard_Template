# Consignes de développement Life Dashboard

## Décision produit prioritaire

Conserver deux applications autonomes : V1 Streamlit avec sa base Neon, V2 Android
avec sa base locale. La V2 doit retrouver les fonctions, le parcours et l'interface
de la V1. Ne pas programmer la suppression, la désactivation ou la mise en lecture
seule de la V1 comme conséquence du développement mobile.

## Périmètre et protection V1

- Travailler dans ce dépôt public, pas dans le dépôt privé `Life_Dashboard`.
- Développer la V2 dans `mobile_app/`, avec ses dépendances et son démarrage propres.
- Les fichiers à la racine, `checkin/`, `data/` et `services/` servent actuellement
  la V1 : ne pas les modifier pour satisfaire un besoin exclusivement mobile.
- `domain/` est déjà utilisé par la V1. Tout changement partagé doit conserver
  ses contrats et passer les tests V1 pertinents. Préférer une implémentation V2
  isolée si le changement imposerait une dépendance ou un comportement nouveau à la V1.
- Aucun accès ni changement Neon n'est nécessaire aux lots locaux. Les imports
  réels et interventions de production sont des opérations distinctes à autoriser.

## Avant chaque lot

Lire `mobile_app/AGENTS.md`, `mobile_app/CONTEXT.md` et le plan lié depuis ce contexte.
Vérifier l'état Git et les instructions locales avant d'éditer. Préserver les
modifications existantes. Les décisions utilisateur les plus récentes prévalent.

## Livraison

Tester en proportion des changements ; ne pas annoncer une validation Android
sur la seule base de tests Python. Signaler les tests échoués ou non exécutés.
Actualiser le contexte et les critères du lot. Créer un commit explicite par lot
terminé, comme demandé par l'utilisateur ; pousser sur GitHub lorsqu'il le demande.
Ne jamais inclure secrets, exports personnels, bases locales ou captures réelles.
