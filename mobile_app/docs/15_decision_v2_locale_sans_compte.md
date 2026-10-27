# Décision produit — V2 Android locale sans compte

Décision validée le 27 octobre 2026.

## Décision

Life Dashboard V2 sera une application Android autonome, destinée à un usage
local sur un téléphone. Elle ne proposera pas de portail de connexion ni de
compte utilisateur distant pour démarrer ou consulter les données. La base de
données de l'application sera stockée sur l'appareil et les fonctions principales
(saisie, historique et bilans) devront fonctionner sans réseau.

Cette décision ne modifie pas la V1 Streamlit ni son fonctionnement avec Neon.
La V1 et la V2 restent deux applications indépendantes. Le passage des données
de la V1 vers la V2 reste une opération d'import explicite ; aucune synchronisation
automatique entre les deux versions n'est décidée.

## Conséquences

- Pas de compte Life Dashboard, fournisseur d'identité, portail de connexion ou
  service d'authentification distant dans le parcours principal V2.
- Le profil éventuel de la base locale désigne les paramètres locaux de l'appareil,
  pas un compte serveur.
- L'assistant de première utilisation et ses réglages se déroulent sur l'appareil
  sans imposer une connexion en ligne. Les choix de sécurité encore ouverts ne
  doivent pas être présentés comme des décisions déjà prises.
- Les intégrations qui nécessitent leur propre compte ou le réseau (par exemple
  Todoist ou une analyse nutritionnelle distante) sont distinctes de l'accès à
  l'application. Elles ne doivent pas conditionner les fonctions locales et doivent
  rester facultatives.
- Un fournisseur de fichiers distant tel que Google Drive impliquerait un compte
  tiers et un accès réseau ; il ne constitue pas le mécanisme de sauvegarde retenu.
  Les options de sauvegarde restent à évaluer.
- Ne pas introduire une connexion Google pour l'application. L'authentification
  Google décrite dans l'audit de la V1 relève uniquement de la V1 et n'est pas
  concernée par cette décision.

## Questions de sécurité encore ouvertes

Cette décision porte sur la forme du produit et le stockage local ; elle ne choisit
pas les mesures de sécurité finales. Il reste à évaluer la protection des données
au repos et des clés, l'intérêt et le fonctionnement de la biométrie, ainsi que la
création, l'emplacement, le chiffrement, la récupération et la restauration des
sauvegardes.

Le dépôt contient des implémentations et prototypes techniques SQLCipher/Keystore,
biométrie et export chiffré par clé de récupération. Leur présence dans le code ou
les tests ne vaut pas validation de la présente politique de sécurité. Il faudra
les auditer, vérifier leur comportement Android, puis décider s'ils sont conservés,
modifiés ou retirés avant une utilisation réelle. Ne pas demander de compte distant
ne signifie pas que les données locales sont publiques ou sans protection.

## Revue des composants et validations nécessaires

| Élément | Rapport avec la décision | Suite nécessaire |
|---|---|---|
| SQLite locale et saisie hors ligne | Conforme au stockage local prévu | Vérifier les scénarios sur téléphone et après arrêt forcé |
| V1 Streamlit / Neon | Hors périmètre de cette décision | Conserver le fonctionnement V1 existant |
| Todoist | API distante, jeton du compte Todoist et réseau | Garder distinct et facultatif ; confirmer qu'aucune fonction principale ne le requiert |
| Analyse nutritionnelle distante | Service et réseau externes possibles | Garder facultative ; préciser la gestion des secrets et des pannes avant de la brancher |
| Destination Google Drive proposée dans l'architecture | Nécessiterait compte tiers et réseau | Ne pas la retenir par défaut ; évaluer d'autres options de sauvegarde |
| SQLCipher, SecureStore/Keystore et biométrie | Mesures locales de sécurité, sans compte distant | Décision et validation Android encore ouvertes |
| Sauvegarde AES-GCM et code de récupération | Prototype local de transfert/restauration | Revoir format, récupération, perte du code, stockage hors appareil et restauration |
| Assistant de première utilisation | Compatible s'il se configure localement | L'assistant actuel expose des étapes Protection et Sauvegarde et recommande la création d'une sauvegarde ; les rendre cohérentes avec les décisions encore ouvertes |

Avant livraison, les essais Android devront confirmer le mode hors ligne, la
persistance locale et la reprise après arrêt forcé. Des essais distincts seront
nécessaires pour les choix de chiffrement, de biométrie et de sauvegarde après leur
validation. Aucun changement de code n'est inclus dans cette décision.
