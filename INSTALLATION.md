# Installer la mise à jour

Le site actuel et sa base sont conservés. Ne créez pas un nouveau projet Supabase.

## 1. Préparer

Décompressez cette archive. Dans le site actuel, exportez le tableau par précaution puis fermez les autres onglets du tableau pendant l'installation. Ne supprimez pas les données du navigateur : elles peuvent contenir vos anciens documents.

## 2. Mettre à jour Supabase (avant les fichiers du site)

1. Ouvrez votre projet : https://supabase.com/dashboard/project/scgagmwcyozgevfeczam/sql/new
2. Ouvrez le fichier **supabase/001_case_collaboration.sql** dans un éditeur de texte.
3. Copiez tout son contenu dans une nouvelle requête du SQL Editor, puis cliquez sur **Run**.
4. Attendez le succès complet. En cas d'erreur, arrêtez ici et transmettez le message exact ; ne lancez pas les morceaux séparément et ne déployez pas encore le site.

Ce script est une transaction : il ajoute les tables et fonctions, rattache les anciens messages à Discussion générale, crée le bucket privé workshop-files et limite les fichiers à 20 Mo. Il est conçu pour être relancé sans doubler les anciennes discussions. Il ne supprime aucun message existant. Les règles existantes sont conservées, avec des contrôles supplémentaires d'appartenance à l'espace.

## 3. Déposer les fichiers sur GitHub

Ouvrez https://github.com/pacoende/collaborative-workshop

Ajoutez ou remplacez dans un même commit, à la racine du dépôt :

- **index.html** (remplacer)
- **cases.js** (ajouter)
- **session.js** (ajouter)
- **case-style.css** (ajouter)
- **README.md** (mettre à jour)
- **INSTALLATION.md**, **package.json**, **.gitignore** et les dossiers **supabase/** et **tests/** (pour conserver la migration et les vérifications)

Conservez **supabase-client.js** tel qu'il est actuellement dans GitHub. La copie de l'archive correspond à la configuration actuelle, sans changement de projet ni de clé. Les anciens app.js, auth.js et style.css peuvent rester : la nouvelle page ne les charge plus.

N'envoyez pas le ZIP lui-même à la place des fichiers. N'imbriquez pas un dossier supplémentaire autour de index.html. Avec GitHub Pages déjà activé, attendez la fin du déploiement puis rechargez le site (Ctrl+F5 sur ordinateur).

## 4. Vérifier avec deux comptes

1. Connectez les comptes A et B dans deux navigateurs ou profils distincts.
2. A ajoute une case et y dépose un petit fichier, puis écrit un message dans Discussion. B doit voir le fichier et le message dans cette case seulement.
3. B ouvre cette case : la couleur orange disparaît pour B.
4. A modifie la note : la case redevient orange chez B, sans alerte chez A.
5. B ferme la page et revient : l'orange reste tant que la case n'est pas consultée.
6. Vérifiez aussi qu'un fichier est téléchargeable depuis le compte B.

Si aucune case ne charge après migration, utilisez « Réessayer la synchronisation » et transmettez le message. Les tests locaux ne remplacent pas cette vérification du schéma et des politiques de votre projet réel.

## Anciens documents

Sur l'appareil et dans le navigateur qui possédaient les fichiers, ouvrez une case > Documents. La section « Anciens fichiers sur cet appareil » permet de les rattacher à cette case. Le fichier local n'est pas supprimé ; vous choisissez à quel sujet il appartient. Sur un nouvel ordinateur, ces fichiers ne sont pas accessibles tant qu'ils n'ont pas été envoyés depuis l'appareil d'origine.

## En cas d'envoi interrompu

Le fichier n'apparaît dans une case qu'après envoi et enregistrement réussis. Un échec d'enregistrement tente de nettoyer la copie envoyée, après vérification qu'elle n'a pas déjà été enregistrée. Si un onglet est fermé pendant l'envoi ou si la connexion tombe à cet instant, un objet sans référence peut rester dans Storage ; un administrateur peut le retrouver dans workshop-files (chemin espace/case/identifiant). Ne le supprimez qu'après vérification de son absence dans workshop_documents. Aucun nettoyage automatique des fichiers existants n'est effectué.

## État de cette livraison

Code et tests préparés ; écriture GitHub refusée avec 403. Aucun changement n'a été publié et aucune commande n'a été exécutée dans votre base réelle.
