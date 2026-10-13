# Lynora

## Application hors ligne « L'Œil Mode » (avancement par étapes)

`oeil-mode.html` est une application **séparée** de Lynora, construite dans **un seul fichier** : aucune bibliothèque, aucune police ni image externe, **aucune requête réseau**. Il suffit d'ouvrir le fichier (double-clic ou aperçu) pour l'utiliser, sans serveur ni Internet. Elle est conçue d'abord pour l'iPhone, en français.

- **Étape 1 (livrée)** : écran d'accueil — identité « L'Œil Mode », illustration dessinée en SVG, gros bouton « Donner mon avis », six catégories tactiles, choix mémorisé, message volant explicatif.
- **Données** : tout reste dans le navigateur sous le préfixe `oeilmode.` (`localStorage`). Aucun nom, aucun e-mail, aucun poste ou numéro transmis — conforme aux exigences RGPD de l'appli.
- **Confort au doigt** : zone tactile minimale vérifiée automatiquement, très au-dessus de la règle des 44 px (bouton principal 56 px, tuiles 104 px).
- **Vérification** : les captures de `captures/` proviennent d'un vrai Chromium piloté sans écran, qui contrôle aussi les tailles de boutons et l'absence de requête externe. Outils de test non versionnés : `npm install @sparticuz/chromium puppeteer-core` puis `node .cache/tools/shot.mjs file://<chemin>/oeil-mode.html captures` et, pour un aperçu local, `node .cache/tools/preview.mjs`.
- **Prochaines étapes** (une seule à la fois, après validation) : écrire un avis, photo, notes par critères, liste de ses avis.

Lynora est une application sociale mobile-first (PWA) autour des avis sincères, des produits, des looks et des inspirations beauté/style. Le catalogue et le fil démarrent volontairement vides : aucun profil, avis ou compteur fictif n'est injecté. Les deux images éditoriales servent uniquement d'illustrations d'ambiance.

## Démarrer

Prérequis : **Node.js 22.13+** (utilisation de `node:sqlite`), npm.

```bash
npm install
npm run server       # API + SQLite sur 0.0.0.0:3001
npm run dev          # Interface sur 0.0.0.0:5173, proxy /api et /uploads
```

Ouvrir `http://localhost:5173`. Pour servir une version compilée sur un seul port : `npm run build && npm start` (port `3001`, configurable avec `PORT`). Le serveur gère aussi les URL partageables (`/produit/:id`, `/publication/:id`, `/profil/:id`) avec métadonnées Open Graph dans la version compilée.

En local, la base est créée dans `data/lynora.sqlite` et les photos optimisées dans `public/uploads/`. Ces deux emplacements sont ignorés par Git. Sur Railway, l'application détecte automatiquement le volume attaché via `RAILWAY_VOLUME_MOUNT_PATH` et y place la base et les photos. Sans volume, elle refuse de démarrer pour éviter la perte de données. `DB_PATH` et `UPLOAD_DIR` restent disponibles pour d'autres déploiements. Ne pas lancer plusieurs instances sur un seul fichier SQLite.

## État du projet au regard du cahier des charges (vérifié le 13/10/2026)

Tests exécutés : `npm test` (parcours API complet : inscription, avis, photos privées, permissions, statistiques, brouillons, signalements, notifications ; plus les critères par catégorie) — **3/3 réussis**. Vérification dans un vrai navigateur : **aucune erreur** sur les écrans bienvenue, fil, fiche produit, explorer, créer et profil (captures dans `captures/lynora-existante/`).

**Déjà fonctionnel** : écran de bienvenue (logo, « Ton style, ta communauté », Commencer, Se connecter, exploration sans compte) · inscription/connexion/déconnexion avec bcrypt, cookie HttpOnly + SameSite, sessions persistantes, limitation de débit (4 règles) · fil paginé par curseur, recherche produits/marques/personnes/publications, filtres (catégorie, marque, prix, note, tri) · création de produits avec détection de doublons (409) · photos WebP via sharp, accès privé aux médias non publiés · avis avec note globale, critères par catégorie, prix payé, photos · fil, likes, commentaires et réponses, « avis utile », abonnements, favoris, notifications, signalements, brouillons, édition et suppression · fiche produit avec note moyenne réelle, nombre d'avis, **indicateur « Est-ce que ça vaut son prix ? »** (fonction 1) · profils, bio, intérêts, visibilité des favoris · partage natif avec métadonnées Open Graph et liens profonds (`/produit/:id`, `/publication/:id`, `/profil/:id`) · PWA installable, en-têtes helmet, thème sombre prune/rose fidèle aux références.

### Listes partageables (Fonction 4, livrée le 13/10/2026)

« Ma routine quotidienne », « Mes produits préférés », « À tester », « Mes indispensables petit prix » : chaque personne peut ranger des produits dans des listes et partager un lien vers elles.

- **Base de données** : `collections` (propriétaire, titre, description, visibilité) et `collection_items` (produits rangés, avec leur ordre). Suppressions en cascade : retirer un produit du catalogue ou fermer un compte ne laisse jamais de ligne orpheline.
- **API** : `GET/POST /api/collections`, `GET /api/me/collections`, `GET /api/users/:id/collections`, `GET/PATCH/DELETE /api/collections/:id`, `POST/DELETE /api/collections/:id/items`. Limites : 30 listes par personne, 60 produits par liste.
- **Confidentialité** : une liste privée n'est lisible que par son propriétaire (403 pour tout le monde, y compris les membres connectés), et seul le propriétaire peut la modifier ou la supprimer.
- **Écrans** : onglet « Listes » du profil (avec création et suggestions), page `/liste/:id` (modifier, rendre publique ou privée, retirer un produit, supprimer), et feuille « Ajouter à une liste » depuis chaque fiche produit, qui indique par une coche les listes où le produit est déjà rangé.
- **Partage** : le lien `/liste/:id` produit un aperçu (titre, auteur, nombre de produits, première photo) pour les réseaux sociaux. Les listes privées gardent l'aperçu générique : rien ne fuite.
- **Compteurs réels** : le nombre de produits et les notes affichés sont calculés à partir de la base.
- **Test** : un test couvre la visibilité, les permissions (403 pour autrui), le refus des doublons, la note agrégée et la suppression en cascade.

### Collections de looks (Fonction 2, livrée le 13/10/2026)

Un look rassemble plusieurs produits **de catégories différentes** — un cabas, des baskets, un rouge à lèvres, un sérum et un parfum — et chaque pièce renvoie vers sa propre fiche produit.

- **Base de données** : table `post_products` (publication, produit, position). La clé (publication, produit) empêche de ranger deux fois la même pièce. Suppression en cascade : retirer un produit du catalogue nettoie aussi les looks qui l'utilisaient.
- **Formats concernés** : `look`, `tenue` et `comparaison`. Un avis garde un seul produit noté : les pièces ne s'appliquent pas à lui, et les pièces envoyées avec un avis sont ignorées.
- **Règles serveur** : 12 pièces maximum, doublons ignorés silencieusement, pièce inexistante refusée (404), au moins une pièce pour un look publié et **au moins deux pour une comparaison**. Les brouillons restent enregistrables incomplets.
- **Écrans** : dans « Créer », l'étape 03 devient « Compose ton look » avec recherche de pièces et liste où l'on retire une pièce ; sur la page d'une publication, une section « Les pièces du look » liste chaque produit avec sa catégorie, sa marque et son prix, cliquable vers la fiche ; sur une fiche produit, une section « Vu dans ces looks » montre les publications qui l'utilisent.
- **Partage** : l'aperçu d'un look annonce ses pièces (« Un look en 5 pièces : Cabas en cuir, Baskets blanches… »).
- **Test** : ordre et doublons des pièces, avis sans pièces, comparaison à un seul produit refusée, brouillon incomplet accepté, fiche produit qui retrouve ses looks, modification par autrui refusée (403).

**Reste à faire** (aucune de ces fonctions n'existe aujourd'hui) : défis communautaires (fonction 3) · défis communautaires (fonction 3) · listes et collections partageables (fonction 4) · console de modération et traitement des signalements · suppression de compte et export des données · vérification d'adresse e-mail et récupération de mot de passe (nécessitent un service d'envoi : aucune clé API n'est configurée, donc à brancher explicitement, pas à simuler).

### Critères par catégorie (étape livrée le 13/10/2026)

`shared/criteres.js` est désormais **la table unique** utilisée à la fois par l'interface et par le serveur : impossible que les deux divergent.

| Catégorie | Critères notés (1 à 5) | Champs texte facultatifs |
| --- | --- | --- |
| Maquillage | qualité, tenue dans le temps, facilité d'application, résultat obtenu, rapport qualité-prix | — |
| Soins · Beauté · Hygiène | texture et facilité d'utilisation, résultats ressentis, tolérance personnelle, rapport qualité-prix | type de peau |
| Cheveux | mêmes critères que les soins | type de cheveux |
| Mode · Chaussures & sacs | coupe et confort, qualité des matériaux, fidélité des couleurs et du rendu, rapport qualité-prix | taille habituelle et taille commandée |
| Parfums | odeur perçue, tenue estimée, intensité, rapport qualité-prix | occasion d'utilisation |

- Le serveur applique une **liste blanche** : un critère qui n'appartient pas à la catégorie du produit est écarté, et un critère inventé n'est jamais enregistré.
- Les **clés internes** (`quality`, `value`, `skin`…) ne changent jamais : les avis déjà enregistrés conservent leurs critères, seuls les libellés affichés ont évolué.
- La fiche produit **agrège les déclarations** de la communauté : par exemple « Type de peau : sèche ×1 · mixte ×1 », « Occasion : tous les jours ×2 ».
- Trois tests couvrent la table, le nettoyage des valeurs et la liste blanche côté serveur.

## Parcours disponibles

- Inscription/connexion, mot de passe haché avec bcrypt, session persistante en cookie HttpOnly/SameSite, déconnexion ; édition du profil, avatar, biographie, intérêts et visibilité des favoris.
- Exploration publique avec recherche de produits, marques, personnes et publications, catégories et filtres produits (marque, prix, note, popularité).
- Proposition de nouveaux produits avec rapprochement des doublons (nom + marque normalisés) ; fiches produit, prix indicatif, notes et indicateur qualité-prix calculés **seulement à partir des avis publiés**.
- Avis avec critères adaptés à la catégorie, prix payé facultatif et photos ; publications de type look, routine, conseil, découverte, comparaison et tenue ; édition, suppression et brouillons.
- Fil paginé, likes, commentaires et réponses, avis utiles, abonnements, favoris produit/publication, notifications et signalements ; liens partageables vers contenus publics.
- Jusqu'à 5 images par publication, conversion en WebP, réduction de taille, contrôle de propriétaire et accès privé aux photos non publiées. Le serveur nettoie les fichiers détachés.
- PWA installable avec écran adapté aux zones de sécurité et cache **des ressources statiques seulement** (jamais des données privées).

## Vérifier

```bash
npm test       # 4 tests sur des bases temporaires : parcours social complet, critères par catégorie, listes partageables
npm run build  # compilation de l'interface
npm audit --omit=dev
```

Vérification visuelle (facultative, hors application livrée) : `npm install --no-save @sparticuz/chromium puppeteer-core`, démarrer `npm start`, puis `node tests/outils/lynora-shot.mjs`. Le script crée des données de démonstration par l'API publique, visite chaque écran dans un vrai Chromium et écrit les captures dans `captures/lynora/`. Il est rejouable : les éléments déjà créés sont réutilisés.

## Limites avant commercialisation

C'est un socle fonctionnel et non une plateforme entièrement commercialisable : pas de vérification d'adresse e-mail, récupération de mot de passe, console de modération, traitement humain des signalements, suppression de compte, outils anti-abus avancés ni sauvegardes automatiques. Les signalements sont conservés en base, sans tableau de modération pour le moment. Les défis, collections partageables avancées, conversations privées et association de plusieurs produits à un look ne sont pas encore implémentés. Les recommandations actuelles utilisent les intérêts déclarés ; elles peuvent être désactivées dans les paramètres. Pour une production publique, configurer HTTPS, sauvegardes, surveillance, politique de confidentialité, traitement RGPD, vérification e-mail et stockage d'objets pérenne. Aucun service externe ni clé API n'est nécessaire en local.

## Déploiement avec URL permanente (Railway)

Le fichier `railway.json` prépare le build, le démarrage et la vérification de santé du service. Dans Railway :

1. Créer un projet **Deploy from GitHub repo** et choisir `KyrioProno/Lynora`, branche `main`. Railway doit utiliser **un seul service / une seule réplique** pour SQLite.
2. Ajouter un **volume persistant** au service, monté sur `/data` (un service avec volume peut nécessiter une formule payante selon l'offre Railway). Ne pas monter le volume sur le répertoire du code. Railway fournit automatiquement le chemin à l'application : **aucune variable d'environnement à saisir**. Si le tout premier déploiement échoue avant l'ajout du volume, c'est attendu : relancer le déploiement après l'avoir attaché.
3. Dans **Settings → Networking**, cliquer sur **Generate Domain**. Ce domaine HTTPS est l'URL de Lynora ; les liens de produits et publications utilisent la même origine.
4. Vérifier `/api/me` (réponse `{"user":null}` avant connexion), créer un compte et publier une image. Redéployer pour vérifier que le compte et l'image sont conservés.

**Ne pas déployer sans volume** : une base SQLite et des photos sur le disque éphémère seraient perdues lors d'un redéploiement. Prévoir des sauvegardes du volume, une politique de confidentialité et une modération avant d'ouvrir l'application au public. Le domaine temporaire de prévisualisation Arena (`*.e2b.app`) n'est pas un hébergement permanent.
