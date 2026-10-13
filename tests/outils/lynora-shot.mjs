/* ============================================================
   OUTIL DE VÉRIFICATION (hors de l'application livrée)
   Ouvre Lynora dans un vrai navigateur sans écran, crée des
   données de démonstration par l'API publique, visite chaque
   écran et enregistre des captures.
   ------------------------------------------------------------
   Utilisation :
     npm install --no-save @sparticuz/chromium puppeteer-core
     npm start &                       # application compilée sur 3001
     node tests/outils/lynora-shot.mjs
   Sur certaines machines, préfixer par : AWS_LAMBDA_JS_RUNTIME=nodejs22.x
   ============================================================ */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const sortie = process.env.SORTIE || '/home/user/Lynora/captures/lynora';
mkdirSync(sortie, { recursive: true });

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
});
const page = await browser.newPage();
const erreurs = [];
const pause = ms => new Promise(r => setTimeout(r, ms));
page.on('pageerror', e => erreurs.push('ERREUR JS : ' + e.message));
// Les 409 sont normaux ici : le script est rejouable, donc le serveur refuse
// (à raison) les comptes, produits et avis déjà créés lors d'une visite précédente.
page.on('response', r => {
  if (r.status() >= 400 && !(r.status() === 409 && /\/api\/(auth|products|posts|collections)/.test(r.url())))
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
  const personnes = { Camille: 'demo@example.fr', Iris: 'iris@example.fr', Léa: 'lea@example.fr' };
  for (const [nom, email] of Object.entries(personnes)) {
    const inscription = await poste('/api/auth/register', { email, username: nom, password: MOT_DE_PASSE });
    if (inscription._statut !== 201) await poste('/api/auth/login', { email, password: MOT_DE_PASSE });
  }
  const connecter = nom => poste('/api/auth/login', { email: personnes[nom], password: MOT_DE_PASSE });
  const produits = {};
  for (const [cle, corps] of [['soins', { name: 'Sérum éclat', brand: 'Maison Test', category: 'Soins', price: 24 }], ['parfum', { name: 'Nuit de figue', brand: 'Atelier Test', category: 'Parfums', price: 89 }]]) {
    const creation = await poste('/api/products', corps);
    if (creation.product) { produits[cle] = creation.product.id; continue; }
    produits[cle] = (await json('/api/products?q=' + encodeURIComponent(corps.name))).products?.[0]?.id;
  }
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

  // Une liste partagée par Camille, avec les deux produits déjà créés.
  await connecter('Camille');
  let liste = (await json('/api/me/collections')).collections?.find(l => l.title === 'Ma routine du matin');
  if (!liste) {
    liste = (await poste('/api/collections', { title: 'Ma routine du matin', description: 'Les produits que j’utilise chaque matin, du sérum au parfum.', visibility: 'public' })).collection;
    for (const produit of [produits.soins, produits.parfum]) await poste('/api/collections/' + liste.id + '/items', { productId: produit });
  }
  return { produits, avis: resultats, liste: liste?.id, listeTitre: liste?.title, look: look?.id, lookPieces: look?.pieces?.length || pieces.filter(Boolean).length };
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

console.log('[app] erreurs :', erreurs.length ? erreurs.slice(0, 8) : 'aucune ✅');
await browser.close();
console.log('[app] captures dans', sortie);
