# Prototype de sauvegarde locale V2 — format 1

> Statut : ce mécanisme est présent dans le prototype, mais la stratégie de
> sauvegarde/restauration n'est pas encore une décision produit validée. Voir
> [`15_decision_v2_locale_sans_compte.md`](15_decision_v2_locale_sans_compte.md).
> Les instructions ci-dessous décrivent le prototype technique, pas une politique
> de sauvegarde recommandée ou garantie pour les données personnelles réelles.

## Parcours du prototype — non validé pour les données réelles

Depuis Réglages, ouvrir Sauvegarde et récupération. Générer un code aléatoire,
le conserver dans un gestionnaire de mots de passe séparément du fichier, puis le
recopier dans la confirmation. Choisir le dossier dans le sélecteur Android.
Conserver aussi une copie du fichier hors du téléphone. Le code n'est pas récupérable
par l'application ; perdre fichier ou code empêche la récupération.

Sur le nouveau téléphone, entrer le code puis sélectionner le fichier .ldbackup.
Confirmer le remplacement des journées, séances, relations, objectifs et préférences.
Une erreur de validation ou d'écriture SQL conserve les données précédentes.
Les éditeurs sont fermés après confirmation de leurs écritures avant d'entrer dans
cette route ; ils relisent les valeurs au retour. Ne pas lancer le service depuis
un formulaire actif contenant des brouillons non enregistrés.

## Format et confidentialité

- Conteneur JSON : format, version=1, algorithm=AES-256-GCM et sealed en base64.
- sealed = IV 12 octets + ciphertext + tag 16 octets.
- Données authentifiées supplémentaires constantes : LifeDashboard|backup|1|AES-256-GCM.
- Code = clé aléatoire AES 256 bits, représentée par 64 caractères hexadécimaux.
  Ce code est distinct de la clé SQLCipher stockée par SecureStore.
- Copie logique JSON chiffrée, cohérente grâce à une transaction SQLite. Aucun SQL
  importé ni base temporaire en clair sur Android. Manifeste et journal sont dans
  la charge chiffrée : version, date UTC et checksums de migrations.
- Liste de tables fixe : profil, personnes, objectifs, journées, séances, journaux
  sociaux/objectifs et préférences autorisées/curseurs par date.
- Secrets, jetons, verrouillage local, état de l'assistant, journal des sauvegardes
  et tout réglage inconnu exclus. Les secrets sont à reconfigurer sur l'autre appareil.

Les APIs natives proviennent des dépendances Expo Crypto 57.0.3 et FileSystem 57.0.7
déjà verrouillées. Références : [Expo Crypto](https://docs.expo.dev/versions/latest/sdk/crypto/),
[Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/). Le code
utilise les signatures des versions installées ; aucun téléchargement de mise à jour.

## Vérification et restauration

Création : capture cohérente, chiffrement, déchiffrement, restauration dans une
base temporaire avec une nouvelle clé SQLCipher, comparaison de toutes les valeurs,
écriture, relecture exacte, SHA-256 et inscription verified au journal local.
La base temporaire appartient uniquement à cette opération et est supprimée après
fermeture. Les fichiers externes ne sont pas supprimés automatiquement si l'écriture
échoue ; un fichier partiel ne sera pas déclaré vérifié.

Restauration : authentification/déchiffrement avant accès aux données, refus de
schéma/colonnes/clé de réglage inconnus, essai temporaire, puis transaction de
remplacement. Contraintes SQL et contrôle des relations/intégrité ; rollback avant
tout retour d'erreur. Comparaison finale de chaque valeur, pas seulement des nombres
de lignes. Aucune modification Neon et aucune fusion implicite avec la V1.

## Limites et validation restante

Format 1 accepte le schéma courant et le schéma précédent (jusqu'à 003) via l'ajout
connu des tables d'archives V1 vides. Les archives/reçus d'import sont désormais
inclus. Toute évolution future requiert encore une migration explicite. Limites mémoire : copie logique
8 Mio, fichier 24 Mio, 100 000 lignes. Aucun dépassement traité par troncature.
Le format utilise un code fort, pas un mot de passe choisi par l'utilisateur.

4 tests Node avec AES-GCM réel et SQLite couvrent nouveau fichier/réouverture,
Unicode, null/zéro, données partielles, exclusion des secrets, mauvaise clé,
altération, interruption SQL, données incompatibles et fausse annonce de succès.
Ils ne prouvent pas le comportement Expo/SQLCipher/SAF sur Android : il reste à
tester le sélecteur système, le chiffrement des fichiers temporaires et l'arrêt
forcé sur téléphone. La version de développement reste réservée aux données fictives.
