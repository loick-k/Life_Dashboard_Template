# Sauvegarde et restauration Neon

## Principes

- Une sauvegarde contient des données personnelles : elle reste hors Git.
- L'URL Neon reste dans une variable d'environnement ou un gestionnaire de secrets.
- Une sauvegarde n'est validée qu'après un test de restauration.
- La restauration ne doit jamais être testée directement sur la production.

## Export logique applicatif

Depuis la racine du dépôt :

```powershell
python -m venv mobile_app\.venv-tools
mobile_app\.venv-tools\Scripts\python.exe -m pip install -r mobile_app\requirements-tools.txt
$env:DATABASE_URL = "URL Neon obtenue depuis la console"
mobile_app\.venv-tools\Scripts\python.exe mobile_app\scripts\export_snapshot.py
mobile_app\.venv-tools\Scripts\python.exe mobile_app\scripts\verify_snapshot.py
```

Le script produit un répertoire horodaté dans `mobile_app/backups/` avec :

- un fichier JSON par table ;
- un manifeste contenant le nombre de lignes et le schéma des colonnes ;
- aucun secret de connexion.

## Sauvegarde PostgreSQL complète

Pour une restauration complète, utiliser également `pg_dump` depuis Neon ou un
poste équipé des outils PostgreSQL :

```powershell
pg_dump --format=custom --no-owner --no-acl --file=life_dashboard.dump $env:DATABASE_URL
```

Conserver le fichier dans un emplacement privé et chiffré.

## Vérification obligatoire

1. Créer une branche Neon temporaire depuis l'état courant.
2. Restaurer l'export ou le dump uniquement sur cette branche.
3. Comparer le nombre de lignes de chaque table avec le manifeste.
4. Vérifier plusieurs journées, séances, relations et objectifs.
5. Exécuter les migrations et les tests applicatifs sur cette branche.
6. Supprimer la branche de test seulement après validation.

## Retour arrière pendant la migration

- Ne réaliser que des migrations additives jusqu'à la bascule finale.
- Garder Streamlit compatible avec l'ancien et le nouveau schéma.
- En cas d'erreur, désactiver l'API mobile et continuer avec Streamlit.
- Ne restaurer la production qu'en cas de corruption confirmée.
