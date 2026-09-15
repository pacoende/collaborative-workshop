# Collaborative Workshop — discussions et documents par case

Cette mise à jour part du dépôt pacoende/collaborative-workshop, révision 357bd0aaec7232c55cc3ecd55501cb0f0d1d1140.
Elle conserve le projet Supabase et son WORKSPACE_ID dans supabase-client.js.

## Ce qui change

- Chaque case contient ses notes, sa discussion et ses documents, dans des sections dépliables.
- Les messages affichent un nom d'auteur (nom de profil ou partie de l'email avant @) et leur date.
- Les fichiers sont partagés dans le bucket privé workshop-files. Limite applicative : 20 Mo par fichier.
- Une bordure orange et un fond teinté signalent les changements d'un autre membre non consultés.
- Ouvrir une case ou cliquer « Nouveauté · marquer consultée » enregistre sa lecture pour ce participant.
- Une modification reçue pendant qu'une case est ouverte la colore à nouveau : elle n'est pas automatiquement considérée comme lue.
- Les lectures sont conservées dans Supabase, par utilisateur et par case, donc entre appareils et connexions.
- Les modifications propres à l'utilisateur ne créent pas d'alerte pour lui et n'effacent pas celles des autres.
- La synchronisation utilise Realtime avec un rafraîchissement de secours toutes les 10 secondes quand la page est visible.
- Les anciens messages sont regroupés dans une case « Discussion générale » sans changer leurs IDs, auteurs ou dates.
- Les anciens fichiers IndexedDB sont proposés dans Documents > Anciens fichiers sur cet appareil. « Rattacher ici » envoie une copie dans la case choisie ; la copie locale reste conservée.

## Installation

Suivre **INSTALLATION.md** : d'abord la migration SQL dans le projet existant, ensuite les fichiers du site.
Ne pas déployer index.html seul : il charge cases.js, session.js et case-style.css.
Les fichiers app.js, auth.js et style.css sont conservés comme ancienne version, mais ne sont plus chargés par index.html.

## Export et import

L'export JSON inclut cases, messages, rattachements et métadonnées des documents. Les fichiers binaires doivent être téléchargés séparément.
Les brouillons non envoyés sont également exportés (unsaved_drafts / message_drafts) pour récupération manuelle.
L'import ajoute cases et discussions en une transaction ; il ne remplace ni ne supprime les cases existantes.
Les messages importés sont attribués à la personne qui importe, à la date de l'import. Le JSON conserve les métadonnées d'origine.
Les anciens exports (messages sous forme de texte) restent pris en charge et leurs messages vont dans Discussion générale.
Les documents ne sont jamais copiés ou rattachés automatiquement depuis leurs métadonnées JSON.

## Suppression et droits

Supprimer une case supprime sa discussion et ses liens pour tous les participants. Une confirmation est demandée.
Une case ayant des documents ne peut pas être supprimée : retirer d'abord les fichiers depuis cette case.
Les membres de l'espace peuvent télécharger et supprimer les fichiers ; les non-membres ne le peuvent pas.
L'inscription, la liste des membres et leurs rôles sont gérés comme dans le projet existant.
Une modification concurrente du même champ reste réglée par la dernière écriture sauvegardée. Les champs non modifiés ne sont pas renvoyés ; un déplacement n'écrase pas les notes d'un autre membre.

## Développement et tests

Pas de compilation requise pour le site. Pour le servir localement : `python -m http.server 8000 --bind 127.0.0.1`, puis ouvrir http://localhost:8000.
La connexion Supabase et la migration sont nécessaires, même en local. Les anciennes données IndexedDB ne suivent pas automatiquement une nouvelle adresse.

Pour les tests :
1. `npm install`
2. `npx playwright install chromium`
3. `npm test`

Les dépendances de test ne sont pas nécessaires pour héberger le site. Ne pas téléverser node_modules.

Tests effectués le 13 septembre 2026 :
- Migration exécutée deux fois dans un PostgreSQL de test via PGlite, avec un schéma représentatif des tables utilisées par le dépôt.
- Conservation des messages historiques, auteurs imposés côté serveur et rattachement au bon espace.
- Notifications propres à chaque utilisateur, propres modifications, lectures anciennes n'effaçant pas une modification plus récente.
- Accès inter-espaces refusé, fichiers privés, ordre de suppression, import atomique et additif.
- Navigateur Chromium : discussions et fichiers par case, affichage littéral de texte HTML, brouillons conservés en erreur, indicateurs non lus, échec de métadonnées après envoi et nettoyage, affichages ordinateur et mobile.

Ces tests utilisent une base et une API simulées/locales. La migration n'a PAS été exécutée sur votre Supabase, et le site n'a PAS été publié depuis cette session : le connecteur GitHub a refusé l'écriture (403).
Le dépôt ne contient pas le schéma SQL d'origine ni ses politiques détaillées : après la migration, vérifier avec deux comptes réels selon INSTALLATION.md.

## Architecture

- index.html : écran de connexion et tableau sans colonne latérale.
- cases.js : cases, discussions, documents, notifications, navigation et synchronisation.
- session.js : connexion et démarrage après vérification d'appartenance.
- case-style.css : présentation du tableau et des cases.
- supabase-client.js : configuration actuelle conservée.
- supabase/001_case_collaboration.sql : migration transactionnelle, contrôles d'accès, bucket privé et fonctions RPC.
- tests/ : essais reproductibles de base de données et de navigateur.

L'activité est comptée par révision sous verrou de la case, et la dernière révision de chaque auteur est conservée. Une lecture acquitte uniquement la révision du cliché réellement affiché, pas une modification arrivée ensuite.
Le cliché complet provient d'une seule requête SQL, après vérification d'appartenance à l'espace.

Références d'implémentation :
- [Contrôle d'accès Storage](https://supabase.com/docs/guides/storage/security/access-control)
- [Fonctions de base de données](https://supabase.com/docs/guides/database/functions)
- [Postgres Changes et limites de filtrage DELETE](https://supabase.com/docs/guides/realtime/postgres-changes)
