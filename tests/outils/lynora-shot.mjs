/* ============================================================
   OUTIL DE VÉRIFICATION (hors de l'application livrée)
   Ouvre Lynora dans un vrai navigateur sans écran, crée des
   données de démonstration par l'API publique, visite chaque
   écran et enregistre des captures.
   ------------------------------------------------------------
   Utilisation :
     npm install --no-save @sparticuz/chromium puppeteer-core
     LYNORA_MODERATORS="moderation@example.fr" npm start &   # l'un des comptes de démonstration est modérateur
     node tests/outils/lynora-shot.mjs
   Sur certaines machines, préfixer par : AWS_LAMBDA_JS_RUNTIME=nodejs22.x
   Le serveur plafonne les connexions (20 par quart d'heure) : pour enchaîner
   plusieurs exécutions, démarrer avec LYNORA_AUTH_LIMIT=300.
   ============================================================ */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const sortie = process.env.SORTIE || '/home/user/Lynora/captures/lynora';
mkdirSync(sortie, { recursive: true });

// Un profil et un cache neufs à chaque exécution : sans cela, le navigateur peut
// resservir un ancien index.html et ne plus trouver les fichiers compilés.
const profil = mkdtempSync(join(tmpdir(), 'lynora-navigateur-'));
const browser = await puppeteer.launch({
  userDataDir: profil,
  args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox', '--disable-http-cache'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
});
const page = await browser.newPage();
await page.setCacheEnabled(false);
const erreurs = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
page.on('pageerror', e => erreurs.push('ERREUR JS : ' + e.message));
// Les 409 sont normaux ici : le script est rejouable, donc le serveur refuse
// (à raison) les comptes, produits et avis déjà créés lors d'une visite précédente.
let sondePublique = false;   // vrai pendant les contrôles volontaires « invisible pour le public »
page.on('response', r => {
  // 409 : le script est rejouable (doublons), 403 : la membre qui teste la console de modération.
  const attendu = (r.status() === 409 && /\/api\/(auth|products|posts|collections|challenges)/.test(r.url())) || (r.status() === 403 && r.url().includes('/api/moderation')) || (sondePublique && r.status() === 404);
  if (r.status() >= 400 && !attendu)
    erreurs.push('HTTP ' + r.status() + ' ' + r.url());
});

// --- 1) Écran de bienvenue, avant toute connexion ---
await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
await pause(700);
await page.screenshot({ path: sortie + '/1-bienvenue.png' });

// --- 2) Données de démonstration, créées uniquement par l'API publique ---
const photo = readFileSync('/home/user/Lynora/public/editorial-style.webp').toString('base64');
const demo = await page.evaluate(async (b64) => {
  const json = (chemin, options) => fetch(chemin, options).then(async r => ({ ...(await r.json()), _statut: r.status }));
  const poste = (chemin, corps) => json(chemin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
  const MOT_DE_PASSE = 'mot-de-passe-demo-2026';
  const personnes = { Camille: 'demo@example.fr', Iris: 'iris@example.fr', Léa: 'lea@example.fr', Romy: 'moderation@example.fr' };
  for (const [nom, email] of Object.entries(personnes)) {
    // On crée les comptes si besoin, sans se connecter : les tentatives
    // d'authentification sont plafonnées par le serveur, autant les économiser.
    await poste('/api/auth/register', { email, username: nom, password: MOT_DE_PASSE });
  }
  // On ne se reconnecte que si la bonne personne n'est pas déjà connectée : cela
  // économise les tentatives, limitées à 20 par quart d'heure par le serveur.
  const connecter = async nom => {
    const moi = await json('/api/me');
    if (moi.user?.username === nom) return { user: moi.user, _statut: 200 };
    const connexion = await poste('/api/auth/login', { email: personnes[nom], password: MOT_DE_PASSE });
    if (connexion._statut !== 200) throw new Error('Connexion impossible pour ' + nom + ' (' + connexion._statut + ' ' + (connexion.error || '') + ') — trop de tentatives ? redémarre le serveur.');
    return connexion;
  };
  // Créer un produit exige une session : on se connecte avant les catalogues.
  await connecter('Camille');
  const produits = {};
  for (const [cle, corps] of [['soins', { name: 'Sérum éclat', brand: 'Maison Test', category: 'Soins', price: 24 }], ['parfum', { name: 'Nuit de figue', brand: 'Atelier Test', category: 'Parfums', price: 89 }]]) {
    const creation = await poste('/api/products', corps);
    if (creation.product) { produits[cle] = creation.product.id; continue; }
    produits[cle] = (await json('/api/products?q=' + encodeURIComponent(corps.name))).products?.[0]?.id;
  }
  if (!produits.soins || !produits.parfum) throw new Error('Produits de démonstration introuvables : la création a échoué.');
  const octets = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const envoyerPhoto = async () => {
    const formulaire = new FormData();
    formulaire.append('images', new File([octets], 'photo.webp', { type: 'image/webp' }));
    return (await json('/api/upload', { method: 'POST', body: formulaire })).urls || [];
  };
  const avis = [
    { compte: 'Iris', photo: true, type: 'avis', category: 'Soins', caption: 'Texture légère, absorbée en quelques secondes. Après trois semaines ma peau est plus lumineuse, et le prix reste raisonnable pour la contenance.', productId: produits.soins, rating: 5, criteria: { texture: 5, result: 5, tolerance: 4, value: 4, skin: 'mixte' }, pricePaid: 21, media: [] },
    { compte: 'Léa', type: 'avis', category: 'Soins', caption: 'Très agréable sur ma peau sèche, aucun tiraillement. Je note juste que le flacon finit vite si on l’utilise matin et soir.', productId: produits.soins, rating: 4, criteria: { texture: 4, result: 4, tolerance: 5, value: 5, skin: 'sèche' }, pricePaid: 19, media: [] },
    { compte: 'Camille', type: 'avis', category: 'Parfums', caption: 'Une odeur boisée et figuée qui tient toute la journée sans être écœurante. Parfait pour le bureau comme pour les soirées.', productId: produits.parfum, rating: 5, criteria: { scent: 5, wear: 4, intensity: 3, value: 4, occasion: 'tous les jours' }, pricePaid: 79, media: [] }
  ];
  const resultats = [];
  for (const avisData of avis) {
    await connecter(avisData.compte);
    const { compte, photo: avecPhoto, ...corps } = avisData;
    if (avecPhoto) corps.media = await envoyerPhoto();
    resultats.push(compte + ' : ' + ((await poste('/api/posts', corps)).error || 'créé'));
  }
  // Un défi communautaire avec un budget, et une participation en règle.
  await connecter('Camille');
  let defi = (await json('/api/challenges?status=open')).challenges?.find(x => x.title === 'Un look complet à 50 €');
  if (!defi) defi = (await poste('/api/challenges', { title: 'Un look complet à 50 €', brief: 'Compose un look complet avec 50 € maximum, en réutilisant ce que tu as déjà.', category: 'Mode', budget: 50, votesAllowed: true, endsAt: '2099-12-31' })).challenge;

  // Un look complet : un cabas, des baskets, un rouge à lèvres et un parfum.
  await connecter('Camille');
  const photos = await envoyerPhoto();
  const pieces = [];
  for (const corps of [
    { name: 'Cabas en cuir', brand: 'Atelier Test', category: 'Mode', price: 120, image: photos[0] },
    { name: 'Baskets blanches', brand: 'Maison Test', category: 'Chaussures & sacs', price: 75, image: photos[0] }
  ]) {
    const creation = await poste('/api/products', corps);
    if (creation.product) { pieces.push(creation.product.id); continue; }
    pieces.push((await json('/api/products?q=' + encodeURIComponent(corps.name))).products?.[0]?.id);
  }
  const rouge = (await poste('/api/products', { name: 'Rouge à lèvres mat', brand: 'Atelier Test', category: 'Maquillage', price: 22 })).product;
  if (rouge) pieces.push(rouge.id);
  pieces.push(produits.soins, produits.parfum);
  let look = (await json('/api/posts?author=' + (await json('/api/me')).user?.id)).posts?.find(p => p.type === 'look');
  if (!look) look = (await poste('/api/posts', { type: 'look', category: 'Mode', caption: 'Ma tenue du jour : le cabas en cuir, les baskets blanches, mon rouge à lèvres mat et le sérum qui finit la routine.', productIds: pieces, media: photos })).post;

  if (defi && look) {
    const participation = await poste('/api/challenges/' + defi.id + '/entries', { postId: look.id });
    await connecter('Iris');
    const vote = await poste('/api/challenges/' + defi.id + '/votes', { postId: look.id });
    defi.participation = participation.error || 'ok';
    defi.vote = vote.error || 'ok';
  }

  // Une liste partagée par Camille, avec les deux produits déjà créés.
  await connecter('Camille');
  let liste = (await json('/api/me/collections')).collections?.find(l => l.title === 'Ma routine du matin');
  if (!liste) {
    liste = (await poste('/api/collections', { title: 'Ma routine du matin', description: 'Les produits que j’utilise chaque matin, du sérum au parfum.', visibility: 'public' })).collection;
    for (const produit of [produits.soins, produits.parfum]) await poste('/api/collections/' + liste.id + '/items', { productId: produit });
  }
  const detailDefi = defi ? await json('/api/challenges/' + defi.id) : null;
  return { produits, avis: resultats, liste: liste?.id, listeTitre: liste?.title, look: look?.id, lookPieces: look?.pieces?.length || pieces.filter(Boolean).length, defi: defi?.id, defiTitre: defi?.title, defiParticipations: detailDefi?.challenge?.entries_count, defiVotes: detailDefi?.challenge?.votes_count, defiTotal: detailDefi?.entries?.[0]?.estimated_total };
}, photo);
console.log('[app] produits :', JSON.stringify(demo.produits), '| avis :', JSON.stringify(demo.avis), '| liste :', demo.liste);

// --- 3) Fil d'actualité ---
await page.goto(BASE + '/accueil', { waitUntil: 'networkidle2' });
await pause(900);
await page.screenshot({ path: sortie + '/2-fil.png' });

// --- 4) Fiche produit : critères réels et déclarations (type de peau, occasion) ---
for (const [cle, fichier] of [['soins', '3-fiche-produit-soins'], ['parfum', '4-fiche-produit-parfum']]) {
  if (!demo.produits[cle]) continue;
  await page.goto(BASE + '/produit/' + demo.produits[cle], { waitUntil: 'networkidle2' });
  await pause(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(300);
  await page.screenshot({ path: sortie + '/' + fichier + '.png' });
  await page.evaluate(() => document.querySelector('.criteria-summary')?.scrollIntoView({ block: 'start' }));
  await pause(500);
  await page.screenshot({ path: sortie + '/' + fichier + '-criteres.png' });
}

// --- 5) Liste partageable ---
if (demo.liste) {
  await page.goto(BASE + '/liste/' + demo.liste, { waitUntil: 'networkidle2' });
  await pause(900);
  await page.screenshot({ path: sortie + '/5-liste.png' });
  console.log('[app] liste partagée :', demo.listeTitre, '| titre de l’aperçu :', await page.title());
}

// --- 5b) Le look publié : la liste des pièces renvoie vers chaque fiche produit ---
if (demo.look) {
  await page.goto(BASE + '/publication/' + demo.look, { waitUntil: 'networkidle2' });
  await pause(900);
  await page.evaluate(() => document.querySelector('.pieces-section')?.scrollIntoView({ block: 'start' }));
  await pause(500);
  await page.screenshot({ path: sortie + '/5b-look-pieces.png' });
  const cartes = await page.$$eval('.piece-card strong', els => els.map(e => e.textContent));
  console.log('[app] pièces du look :', JSON.stringify(cartes));
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(400);
  await page.screenshot({ path: sortie + '/5c-look-publication.png' });
}

// --- 5d) Sur une fiche produit : « Vu dans ces looks » ---
if (demo.produits.soins) {
  await page.goto(BASE + '/produit/' + demo.produits.soins, { waitUntil: 'networkidle2' });
  await pause(900);
  const railPresent = await page.evaluate(() => {
    const section = document.querySelector('.looks-section');
    section?.scrollIntoView({ block: 'start' });
    return !!section;
  });
  await pause(500);
  await page.screenshot({ path: sortie + '/5d-produit-dans-les-looks.png' });
  console.log('[app] section « vu dans ces looks » :', railPresent);
}

// --- 5e) Le composeur de look dans l'écran de création ---
await page.goto(BASE + '/creer', { waitUntil: 'networkidle2' });
await pause(800);
const choixLook = await page.evaluate(() => {
  const format = [...document.querySelectorAll('.format-grid button')].find(b => b.textContent.trim() === 'Look complet');
  if (!format) return false;
  format.click();
  return true;
});
await pause(500);
await page.evaluate(() => document.querySelector('.pieces-picker')?.scrollIntoView({ block: 'center' }));
await pause(400);
await page.screenshot({ path: sortie + '/5e-creer-look.png' });
// On cherche une pièce et on l'ajoute pour montrer le fonctionnement réel
const ajoutPiece = await page.evaluate(async () => {
  const champ = document.querySelector('.pieces-picker input');
  if (!champ) return 'champ introuvable';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(champ, 'Cabas');
  champ.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  const bouton = document.querySelector('.pieces-picker .product-matches button');
  if (!bouton) return 'aucun résultat';
  bouton.click();
  return 'pièce ajoutée';
});
await pause(500);
await page.screenshot({ path: sortie + '/5f-look-piece-ajoutee.png' });
console.log('[app] composeur de look :', choixLook, '|', ajoutPiece, '| pièces affichées :', await page.$$eval('.piece-chip strong', els => els.map(e => e.textContent)));

// --- 5g) Les défis : liste, détail avec classement, badge sur la publication ---
await page.goto(BASE + '/defis', { waitUntil: 'networkidle2' });
await pause(900);
await page.screenshot({ path: sortie + '/5g-defis.png' });
const cartesDefis = await page.$$eval('.defi-card', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)));
console.log('[app] défis listés :', JSON.stringify(cartesDefis));

if (demo.defi) {
  await page.goto(BASE + '/defi/' + demo.defi, { waitUntil: 'networkidle2' });
  await pause(900);
  await page.screenshot({ path: sortie + '/5h-defi-detail.png' });
  const infos = await page.evaluate(() => ({
    titre: document.querySelector('.defi-entete h1')?.textContent,
    chiffres: [...document.querySelectorAll('.defi-chiffres span')].map(e => e.textContent.trim()),
    budget: document.querySelector('.defi-budget')?.textContent.trim(),
    soumis: [...document.querySelectorAll('.defi-entry-auteur strong')].map(e => e.textContent)
  }));
  console.log('[app] défi :', JSON.stringify(infos));
  await page.evaluate(() => document.querySelector('.defi-entries')?.scrollIntoView({ block: 'start' }));
  await pause(500);
  await page.screenshot({ path: sortie + '/5i-defi-classement.png' });
}

if (demo.look) {
  await page.goto(BASE + '/publication/' + demo.look, { waitUntil: 'networkidle2' });
  await pause(800);
  await page.evaluate(() => document.querySelector('.defi-badge')?.scrollIntoView({ block: 'center' }));
  await pause(400);
  await page.screenshot({ path: sortie + '/5j-publication-defi.png' });
  console.log('[app] badge de défi sur la publication :', await page.$eval('.defi-badge', e => e.textContent.trim()).catch(() => 'ABSENT'));
}

// --- 6) Feuille « Ajouter à une liste » depuis une fiche produit ---
if (demo.produits.parfum) {
  await page.goto(BASE + '/produit/' + demo.produits.parfum, { waitUntil: 'networkidle2' });
  await pause(800);
  const ouvert = await page.evaluate(() => {
    const bouton = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Ajouter à une liste'));
    if (!bouton) return false;
    bouton.click();
    return true;
  });
  await pause(900);
  await page.screenshot({ path: sortie + '/6-ajouter-a-une-liste.png' });
  const lignes = await page.$$eval('.sheet-row', els => els.map(e => e.textContent.trim()));
  console.log('[app] feuille ouverte :', ouvert, '| listes proposées :', JSON.stringify(lignes));
}

// --- 7) Profil : onglet « Listes » ---
await page.goto(BASE + '/profil', { waitUntil: 'networkidle2' });
await pause(900);
const clicOnglet = await page.evaluate(() => {
  const onglet = [...document.querySelectorAll('.profile-tabs button')].find(b => b.textContent.trim() === 'Listes');
  if (!onglet) return false;
  onglet.click();
  return true;
});
await pause(700);
await page.screenshot({ path: sortie + '/7-profil-listes.png' });
const cartes = await page.$$eval('.collection-card', els => els.map(e => e.textContent.trim()));
console.log('[app] onglet Listes cliqué :', clicOnglet, '| cartes :', JSON.stringify(cartes));

// --- 8) Explorer ---
await page.goto(BASE + '/explorer', { waitUntil: 'networkidle2' });
await pause(800);
await page.screenshot({ path: sortie + '/8-explorer.png' });

/* --- 9) Modération : signaler, masquer, rétablir ---
   Le compte de modération est « Romy ». Il n'est modérateur que si le
   serveur a été démarré avec LYNORA_MODERATORS="moderation@example.fr"
   (c'est justement ce que l'on veut vérifier : le rôle ne vient jamais
   de l'application). */
const connecterDansLeNavigateur = (email, pseudo) => page.evaluate(async ([email, pseudo, mot]) => {
  const moi = await fetch('/api/me').then(r => r.json());
  if (moi.user?.username === pseudo) return { role: moi.user?.role, statut: 200 };
  const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: mot }) });
  const d = await r.json();
  if (r.status !== 200) throw new Error('Connexion impossible pour ' + pseudo + ' (' + r.status + ') — trop de tentatives ? redémarre le serveur.');
  return { role: d.user?.role, statut: r.status };
}, [email, pseudo, 'mot-de-passe-demo-2026']);

const moderation = await page.evaluate(async (mot) => {
  const json = (chemin, options) => fetch(chemin, options).then(async r => ({ ...(await r.json()), _statut: r.status }));
  const poste = (chemin, corps) => json(chemin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
  const sesIdentifiants = async (email, pseudo) => {
    const moi = await json('/api/me');
    if (moi.user?.username === pseudo) return { user: moi.user, _statut: 200 };
    const connexion = await poste('/api/auth/login', { email, password: mot });
    if (connexion._statut !== 200) throw new Error('Connexion impossible pour ' + pseudo + ' (' + connexion._statut + ') — trop de tentatives ? redémarre le serveur.');
    return connexion;
  };
  // 1. Léa publie un conseil un peu vif, qu'Iris signale.
  await sesIdentifiants('lea@example.fr', 'Léa');
  let cible = (await json('/api/posts?author=' + (await json('/api/me')).user?.id)).posts?.find(p => p.caption.startsWith('Mon conseil qui a fâché'));
  if (!cible) cible = (await poste('/api/posts', { type: 'conseil', category: 'Beauté', caption: 'Mon conseil qui a fâché : arrêtez d’acheter n’importe quoi les yeux fermés, lisez les avis avant de payer. Ce message a été signalé comme trop direct envers les marques.' })).post;
  await sesIdentifiants('iris@example.fr', 'Iris');
  const signalement = await poste('/api/posts/' + cible.id + '/report', { reason: 'Message trop direct envers les marques.' });
  // 2. La console de modération, vue par une personne qui n'a pas le rôle.
  const refus = await json('/api/moderation/reports?status=open');
  // 3. Romy, le compte de la liste du serveur.
  const romy = await sesIdentifiants('moderation@example.fr', 'Romy');
  const file = await json('/api/moderation/reports?status=open');
  return { cible: cible?.id, signalement: signalement.error || signalement.ok ? (signalement.error || 'enregistré') : 'inconnu', refus: refus._statut, role: romy.user?.role, ouverts: file.open_count, premier: file.reports?.[0]?.post_id, waiting: file.waiting };
}, 'mot-de-passe-demo-2026');
console.log('[app] modération — rôle de Romy :', moderation.role, '| accès d’une membre :', moderation.refus, '| signalements ouverts :', moderation.ouverts, '| liste de modérateurs configurée :', moderation.waiting);

// Le contrôle décisif : une publication masquée est invisible pour le public.
const vuePublique = async id => {
  sondePublique = true;            // un 404 ici est le résultat attendu, pas une erreur
  try {
    return await page.evaluate(async (id) => {
      const r = await fetch('/api/posts/' + id, { credentials: 'omit' });   // visiteuse ou visiteur non connecté
      const d = await r.json().catch(() => ({}));
      return { statut: r.status, hidden: d.post?.hidden };
    }, id);
  } finally { sondePublique = false; }
};

// 9a) Les signalements à traiter, avec le contenu et son auteur.
await page.goto(BASE + '/moderation', { waitUntil: 'networkidle2' });
await pause(1100);
await page.screenshot({ path: sortie + '/9a-moderation-signalements.png' });
const aTraiter = await page.$$eval('.modo-carte', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)));
console.log('[app] signalements affichés :', JSON.stringify(aTraiter));

// 9b) Masquer le contenu depuis la console.
const masque = await page.evaluate(() => {
  const bouton = [...document.querySelectorAll('.modo-actions button')].find(b => b.textContent.includes('Masquer'));
  if (!bouton) return false;
  bouton.click();
  return true;
});
await pause(1400);
await page.screenshot({ path: sortie + '/9b-moderation-masque.png' });
console.log('[app] masquage cliqué :', masque, '| invisible pour le public :', JSON.stringify(await vuePublique(moderation.cible)));

// 9c) L'onglet « Masqués » : c'est là qu'on peut revenir en arrière.
const ongletMasques = await page.evaluate(() => {
  const bouton = [...document.querySelectorAll('.defis-onglets button')].find(b => b.textContent.trim() === 'Masqués');
  if (!bouton) return false;
  bouton.click();
  return true;
});
await pause(1200);
await page.screenshot({ path: sortie + '/9c-moderation-masques.png' });
console.log('[app] onglet Masqués :', ongletMasques, '| cartes masquées :', await page.$$eval('.modo-carte', els => els.length));

// 9d) Ce que voit la personne dont le contenu a été masqué : un bandeau explicatif.
await connecterDansLeNavigateur('lea@example.fr', 'Léa');
await page.goto(BASE + '/publication/' + moderation.cible, { waitUntil: 'networkidle2' });
await pause(1000);
await page.screenshot({ path: sortie + '/9d-auteur-prevenue.png' });
console.log('[app] bandeau « masquée » chez l’auteur :', await page.$$eval('.modo-bandeau', els => els.length ? els[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : 'ABSENT (anormal)'));

// 9f) Chez une membre, aucun accès à la console dans les paramètres.
await page.goto(BASE + '/parametres', { waitUntil: 'networkidle2' });
await pause(900);
await page.screenshot({ path: sortie + '/9f-acces-absent.png' });
console.log('[app] entrée « Modération » chez une membre :', (await page.$$eval('.moderation-acces', els => els.length)) ? 'PRÉSENTE (anormal)' : 'absente, comme prévu');

// 9e) Rétablir depuis la console : le contenu redevient visible pour tout le monde.
await connecterDansLeNavigateur('moderation@example.fr', 'Romy');
await page.goto(BASE + '/moderation', { waitUntil: 'networkidle2' });
await pause(900);
await page.evaluate(() => { const b = [...document.querySelectorAll('.defis-onglets button')].find(x => x.textContent.trim() === 'Masqués'); if (b) b.click(); });
await pause(1100);
const retabli = await page.evaluate(() => { const b = [...document.querySelectorAll('.modo-actions button')].find(x => x.textContent.includes('Rétablir')); if (!b) return false; b.click(); return true; });
await pause(1300);
await page.screenshot({ path: sortie + '/9e-moderation-retabli.png' });
console.log('[app] rétabli :', retabli, '| de nouveau visible pour le public :', JSON.stringify(await vuePublique(moderation.cible)));

// 9g) Chez le compte de modération, le point d'entrée apparaît.
await page.goto(BASE + '/parametres', { waitUntil: 'networkidle2' });
await pause(900);
await page.screenshot({ path: sortie + '/9g-acces-moderation.png' });
console.log('[app] entrée « Modération » chez le compte de modération :', (await page.$$eval('.moderation-acces', els => els.length)) ? 'présente' : 'ABSENTE (anormal)');

console.log('[app] erreurs :', erreurs.length ? erreurs.slice(0, 8) : 'aucune ✅');
await browser.close();
rmSync(profil, { recursive: true, force: true });
console.log('[app] captures dans', sortie);
