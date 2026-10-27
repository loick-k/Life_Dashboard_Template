# Critères d'acceptation

## Données

- Une valeur enregistrée ne disparaît jamais après navigation ou redémarrage.
- Modifier une étape ne change aucune autre étape.
- Une requête répétée avec la même clé d'idempotence ne crée aucun doublon.
- Une écriture locale fondée sur une ancienne révision est détectée.
- Les sauvegardes ont été restaurées avec les mêmes nombres de lignes.

## Mobile

- L'écran du jour s'affiche depuis SQLite sans attendre Neon.
- Toute saisie est conservée après fermeture forcée de l'application.
- Une saisie hors ligne est enregistrée directement dans SQLite.
- L'état de sauvegarde locale est visible sans gêner la saisie.
- Aujourd'hui utilise systématiquement le fuseau Europe/Paris.

## Sécurité

- Aucun identifiant Neon ou OpenAI n'est présent dans l'APK.
- Le parcours principal ne comporte ni portail de connexion ni compte utilisateur
  distant ; saisie, consultation et bilans principaux fonctionnent hors ligne.
- Les éventuelles intégrations en ligne ont leur authentification propre, demeurent
  facultatives et ne bloquent pas les fonctions locales.
- Les journaux ne contiennent ni repas, ni mesures, ni relations, ni jetons.
- Les choix de biométrie, de chiffrement et de sauvegarde/restauration sont arrêtés
  après évaluation distincte, puis validés sur Android avant usage réel.
- La première utilisation ne présente pas ces mécanismes comme requis ou déjà
  adoptés tant que les choix sont ouverts.
- Les secrets et sauvegardes sont exclus de Git.

## Performance

- Ouverture locale de l'écran du jour : cible inférieure à 500 ms.
- Réaction visuelle après saisie : cible inférieure à 100 ms.
- Écriture SQLite : cible inférieure à 100 ms.
- Appels aux intégrations : non bloquants pour l'interface.

## Parité et coexistence

- 14 jours de double exploitation sans perte de données.
- Zéro conflit non expliqué.
- Export et restauration vérifiés avant la mise en production mobile.
- Streamlit V1 garde toutes ses fonctions et fonctionne indépendamment de la V2.
- V2 démarre, sauvegarde et présente les bilans sans serveur V1 ni Neon.
- Comparaison écran par écran : libellés, étapes, couleurs, navigation et indicateurs.
- Comparaison fonction par fonction sur les mêmes données fictives, PDF compris.
- Tout écart tactile nécessaire est documenté ; aucune fonction V1 omise silencieusement.
