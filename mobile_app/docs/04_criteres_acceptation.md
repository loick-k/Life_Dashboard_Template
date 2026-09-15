# Critères d'acceptation

## Données

- Une valeur enregistrée ne disparaît jamais après navigation ou redémarrage.
- Modifier une étape ne change aucune autre étape.
- Une requête répétée avec la même clé d'idempotence ne crée aucun doublon.
- Les conflits entre deux appareils sont détectés et jamais résolus silencieusement.
- Les sauvegardes ont été restaurées avec les mêmes nombres de lignes.

## Mobile

- L'écran du jour s'affiche depuis SQLite sans attendre Neon.
- Toute saisie est conservée après fermeture forcée de l'application.
- Une saisie hors ligne est synchronisée automatiquement au retour du réseau.
- L'état de synchronisation est visible sans gêner la saisie.
- Aujourd'hui utilise systématiquement le fuseau Europe/Paris.

## Sécurité

- Aucun identifiant Neon ou OpenAI n'est présent dans l'APK.
- Chaque endpoint vérifie le compte et la propriété de la donnée.
- Les journaux ne contiennent ni repas, ni mesures, ni relations, ni jetons.
- Les données locales sensibles sont protégées selon les capacités Android.
- Les secrets et sauvegardes sont exclus de Git.

## Performance

- Ouverture locale de l'écran du jour : cible inférieure à 500 ms.
- Réaction visuelle après saisie : cible inférieure à 100 ms.
- Écriture SQLite : cible inférieure à 100 ms.
- Synchronisation réseau : non bloquante pour l'interface.

## Bascule

- 14 jours de double exploitation sans perte de données.
- Zéro conflit non expliqué.
- Export et restauration vérifiés avant la mise en production mobile.
- Streamlit reste disponible comme solution de secours.

