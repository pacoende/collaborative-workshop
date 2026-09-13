# Collaborative Workshop

Version autonome du prototype de la conversation. Aucun compte, serveur ou module à installer pour le site. Tout le code est dans index.html, style.css et app.js.

## Ouvrir sur l'ordinateur

Décompresser tout le dossier, puis ouvrir index.html dans un navigateur. Garder les trois fichiers ensemble. Pour un stockage local plus fiable, si Python est installé : ouvrir un terminal dans ce dossier, exécuter `python -m http.server 8000 --bind 127.0.0.1`, puis visiter http://localhost:8000. Garder cette même adresse pour retrouver les données. Arrêter le serveur avec Ctrl+C.

## Fonctions

- Cases avec titre et contenu libre (notes, hypothèses, formules écrites, décisions).
- Ajout, suppression et déplacement dans toutes les directions avec la poignée ☰.
- Liens multiples : cliquer Relier sur la source puis la destination. Cliquer un trait pour le supprimer.
- Navigation par glissement du fond, zoom par molette, boutons ou pincement sur le fond.
- Messages locaux, documents par sélection ou glisser-déposer, téléchargement et suppression des documents.
- Sauvegarde du tableau et des messages dans localStorage, documents dans IndexedDB.
- Export/import JSON du tableau et des messages. Les formules sont du texte, pas un moteur de calcul.

## Migration vers GitHub Pages

1. Ouvrir https://github.com/pacoende/collaborative-workshop.
2. Ajouter les fichiers du dossier à la racine du dépôt via l'envoi de fichiers GitHub. Ne pas envoyer uniquement le ZIP et ne pas imbriquer le dossier : index.html doit être à la racine.
3. Valider le commit.
4. Dans les paramètres du dépôt, rubrique Pages, choisir une publication depuis la branche main et le dossier racine, puis enregistrer.
5. Attendre la publication et utiliser le lien indiqué par GitHub. Adresse attendue : https://pacoende.github.io/collaborative-workshop/ (non activée ni vérifiée à la livraison de ce dossier).

## Migration des données

Ce dossier contient le code du prototype, pas les saisies ou documents conservés dans d'autres aperçus ChatGPT. Ces données ne sont pas accessibles depuis cette session. Dans cette version, exporter le tableau avant de changer d'ordinateur, de navigateur ou d'adresse, puis importer le JSON sur la destination. Télécharger séparément chaque document et le déposer à nouveau sur la destination. Le stockage est lié au navigateur et à l'adresse : les données de localhost ne suivent pas automatiquement le site sur GitHub Pages. Effacer les données du navigateur supprime aussi les sauvegardes locales.

## Pour travailler réellement à trois

Cette version n'a pas de synchronisation, d'authentification ou de stockage partagé. Chaque participant a ses propres données. GitHub héberge le code et Pages peut servir le site public ; les saisies locales ne sont pas envoyées dans le dépôt. Ajouter un service de données partagé, des comptes et des droits d'accès avant d'utiliser cet outil comme espace collaboratif commun.

## Reprendre dans Codex

Ouvrir ce dossier comme projet et demander : « Voici le prototype à migrer vers pacoende/collaborative-workshop. Inspecte le dépôt avant tout transfert, conserve les changements existants, teste le prototype, transfère ces fichiers puis configure GitHub Pages si les accès le permettent. Ne présente pas la sauvegarde locale comme une synchronisation multiutilisateur. »

## Vérification

Le code JavaScript a été vérifié syntaxiquement lors de la préparation du dossier. Une validation interactive complète dans les navigateurs cibles reste à faire. Aucun transfert GitHub ni hébergement n'a été effectué par la préparation de cette archive.
