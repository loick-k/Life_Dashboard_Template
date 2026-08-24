# Life Dashboard

Application Streamlit mobile-first pour suivre des indicateurs quotidiens : sommeil,
mesures corporelles, travail, sport, temps d'écran, alimentation, bien-être, relations
sociales et objectifs.

## Démarrage local

```bash
pip install -r requirements.txt
streamlit run app_life_dashboard_v4.py
```

Sans configuration supplémentaire, les données sont enregistrées dans
`life_dashboard.sqlite`. Ce fichier est exclu de Git.

## Déploiement avec une base externe

Copiez `.streamlit/secrets.toml.example` vers `.streamlit/secrets.toml` pour le
développement local, ou ajoutez les valeurs dans les Secrets de Streamlit Community
Cloud :

```toml
DATABASE_URL = "postgresql://utilisateur:mot-de-passe@hote/base?sslmode=require"
APP_ACCESS_PASSWORD = "un-mot-de-passe-long-et-unique"
```

Lorsque `DATABASE_URL` est défini, l'écran de connexion devient obligatoire et
l'application refuse de charger les données si `APP_ACCESS_PASSWORD` est absent.
Les secrets réels ne doivent jamais être ajoutés au dépôt.

Les intégrations facultatives utilisent également les Secrets Streamlit :

```toml
TODOIST_API_TOKEN = "colle-ton-jeton-todoist-ici"
OPENAI_API_KEY = "colle-ta-cle-openai-ici"
```

## Personnalisation

Les objectifs, horaires standards, libellés personnels et repères facultatifs se
configurent depuis **Réglages → Objectifs & critères**. Le dépôt ne contient aucune
valeur personnelle par défaut.

## Tests

```bash
python -m unittest discover -s tests -p "test_*.py"
```

## Licence

Ce projet est distribué sous licence MIT. Chaque utilisateur reste responsable de
la protection de ses données et de ses secrets de déploiement.
