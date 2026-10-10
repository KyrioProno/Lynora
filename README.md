# Lynora

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
npm test       # parcours API sur une base temporaire : auth, avis, upload, stats, permissions, interactions
npm run build  # compilation de l'interface
npm audit --omit=dev
```

## Limites avant commercialisation

C'est un socle fonctionnel et non une plateforme entièrement commercialisable : pas de vérification d'adresse e-mail, récupération de mot de passe, console de modération, traitement humain des signalements, suppression de compte, outils anti-abus avancés ni sauvegardes automatiques. Les signalements sont conservés en base, sans tableau de modération pour le moment. Les défis, collections partageables avancées, conversations privées et association de plusieurs produits à un look ne sont pas encore implémentés. Les recommandations actuelles utilisent les intérêts déclarés ; elles peuvent être désactivées dans les paramètres. Pour une production publique, configurer HTTPS, sauvegardes, surveillance, politique de confidentialité, traitement RGPD, vérification e-mail et stockage d'objets pérenne. Aucun service externe ni clé API n'est nécessaire en local.

## Déploiement avec URL permanente (Railway)

Le fichier `railway.json` prépare le build, le démarrage et la vérification de santé du service. Dans Railway :

1. Créer un projet **Deploy from GitHub repo** et choisir `KyrioProno/Lynora`, branche `main`. Railway doit utiliser **un seul service / une seule réplique** pour SQLite.
2. Ajouter un **volume persistant** au service, monté sur `/data` (un service avec volume peut nécessiter une formule payante selon l'offre Railway). Ne pas monter le volume sur le répertoire du code. Railway fournit automatiquement le chemin à l'application : **aucune variable d'environnement à saisir**. Si le tout premier déploiement échoue avant l'ajout du volume, c'est attendu : relancer le déploiement après l'avoir attaché.
3. Dans **Settings → Networking**, cliquer sur **Generate Domain**. Ce domaine HTTPS est l'URL de Lynora ; les liens de produits et publications utilisent la même origine.
4. Vérifier `/api/me` (réponse `{"user":null}` avant connexion), créer un compte et publier une image. Redéployer pour vérifier que le compte et l'image sont conservés.

**Ne pas déployer sans volume** : une base SQLite et des photos sur le disque éphémère seraient perdues lors d'un redéploiement. Prévoir des sauvegardes du volume, une politique de confidentialité et une modération avant d'ouvrir l'application au public. Le domaine temporaire de prévisualisation Arena (`*.e2b.app`) n'est pas un hébergement permanent.
