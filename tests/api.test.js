import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criteresNotes, criteresTextes, groupesTextes, clesCriteres, declarations } from '../shared/criteres.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'lynora-test-'));
const port=39000+Math.floor(Math.random()*1000);
const base=`http://127.0.0.1:${port}/api`;
const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,DB_PATH:'',UPLOAD_DIR:'',RAILWAY_ENVIRONMENT:'test',RAILWAY_VOLUME_MOUNT_PATH:dir,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let log='';server.stderr.on('data',d=>log+=d);server.stdout.on('data',d=>log+=d);
async function ready(){for(let i=0;i<60;i++){try{const r=await fetch(base+'/me');if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error('Server did not start: '+log)}
async function request(path,{method='GET',body,cookie}={}){const r=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
test('parcours social réel avec persistance, permissions et statistiques',async()=>{try{await ready();assert.ok(existsSync(join(dir,'lynora.sqlite')));const guest=await request('/me');assert.equal(guest.data.user,null);const a=await request('/auth/register',{method:'POST',body:{email:'a@example.fr',username:'Alice',password:'un-mot-de-passe-solide'}});assert.equal(a.status,201);assert.ok(a.cookie);const b=await request('/auth/register',{method:'POST',body:{email:'b@example.fr',username:'Bob',password:'un-autre-mot-de-passe'}});assert.equal(b.status,201);const duplicate=await request('/auth/register',{method:'POST',body:{email:'a@example.fr',username:'Other',password:'un-mot-de-passe-solide'}});assert.equal(duplicate.status,409);const unauth=await request('/products',{method:'POST',body:{name:'Sérum éclat',brand:'Marque locale',category:'Soins'}});assert.equal(unauth.status,401);
const product=await request('/products',{method:'POST',cookie:a.cookie,body:{name:'Sérum éclat',brand:'Marque locale',category:'Soins',price:24}});assert.equal(product.status,201);const pid=product.data.product.id;const dupProduct=await request('/products',{method:'POST',cookie:b.cookie,body:{name:' Serum Eclat ',brand:'MARQUE LOCALE',category:'Soins'}});assert.equal(dupProduct.status,409);
const form=new FormData();form.append('images',new Blob([readFileSync('public/editorial-beauty.webp')],{type:'image/webp'}),'photo.webp');const upload=await fetch(base+'/upload',{method:'POST',headers:{Cookie:a.cookie},body:form});assert.equal(upload.status,200);const photo=(await upload.json()).urls[0];assert.ok(existsSync(join(dir,'uploads',photo.split('/').at(-1))));assert.match(photo,/^\/uploads\/[a-f0-9-]+\.webp$/);const imageResponse=await fetch(`http://127.0.0.1:${port}${photo}`);assert.equal(imageResponse.status,403);const privateImage=await fetch(`http://127.0.0.1:${port}${photo}`,{headers:{Cookie:a.cookie}});assert.equal(privateImage.status,200);assert.equal(privateImage.headers.get('content-type'),'image/webp');const post=await request('/posts',{method:'POST',cookie:a.cookie,body:{type:'avis',category:'Soins',caption:'Texture légère, agréable à appliquer.',productId:pid,rating:4,criteria:{texture:5,value:3},pricePaid:21,media:[photo]}});assert.equal(post.status,201,JSON.stringify(post.data));const postId=post.data.post.id;assert.equal((await fetch(`http://127.0.0.1:${port}${photo}`)).status,200);const prod=await request('/products/'+pid);assert.equal(prod.data.product.avg_rating,4);assert.equal(prod.data.product.review_count,1);assert.equal(prod.data.product.value_rating,3);const foreignPhoto=await request('/posts',{method:'POST',cookie:b.cookie,body:{type:'avis',category:'Soins',caption:'Un test de photo appartenant à autrui.',productId:pid,rating:4,media:[photo]}});assert.equal(foreignPhoto.status,400);const duplicateReview=await request('/posts',{method:'POST',cookie:a.cookie,body:{type:'avis',category:'Soins',caption:'Je tente de donner un deuxième avis.',productId:pid,rating:3,media:[]}});assert.equal(duplicateReview.status,409);const wrongCategory=await request('/posts',{method:'POST',cookie:b.cookie,body:{type:'avis',category:'Mode',caption:'Un avis qui n’a pas la bonne catégorie.',productId:pid,rating:4,media:[]}});assert.equal(wrongCategory.status,400);const csrf=await fetch(base+'/posts/'+postId+'/like',{method:'POST',headers:{Cookie:b.cookie,Origin:'https://evil.example'}});assert.equal(csrf.status,403);const denied=await request('/posts/'+postId,{method:'DELETE',cookie:b.cookie});assert.equal(denied.status,403);
const like=await request('/posts/'+postId+'/like',{method:'POST',cookie:b.cookie});assert.equal(like.data.count,1);const comment=await request('/posts/'+postId+'/comments',{method:'POST',cookie:b.cookie,body:{body:'Merci pour ton retour !'}});assert.equal(comment.status,201);const reply=await request('/posts/'+postId+'/comments',{method:'POST',cookie:a.cookie,body:{body:'Avec plaisir !',parentId:comment.data.comment.id}});assert.equal(reply.status,201);const report=await request('/posts/'+postId+'/report',{method:'POST',cookie:b.cookie,body:{reason:'Contenu inapproprié selon moi'}});assert.equal(report.status,200);const follow=await request('/users/'+a.data.user.id+'/follow',{method:'POST',cookie:b.cookie});assert.equal(follow.data.followers,1);const saved=await request('/products/'+pid+'/save',{method:'POST',cookie:b.cookie});assert.equal(saved.data.saved,true);assert.equal((await request('/users/'+b.data.user.id+'/saved-products',{cookie:a.cookie})).status,403);await request('/me',{method:'PATCH',cookie:b.cookie,body:{username:'Bob',bio:'',interests:[],favoritesPublic:true}});assert.equal((await request('/users/'+b.data.user.id+'/saved-products',{cookie:a.cookie})).data.products.length,1);const note=await request('/notifications',{cookie:a.cookie});assert.ok(note.data.notifications.some(n=>n.kind==='follow'));
const feed=await request('/posts');assert.equal(feed.data.posts[0].likes_count,1);assert.equal(feed.data.posts[0].comments_count,2);const detail=await request('/posts/'+postId);assert.equal(detail.data.post.caption,'Texture légère, agréable à appliquer.');const edit=await request('/posts/'+postId,{method:'PATCH',cookie:a.cookie,body:{type:'avis',category:'Soins',caption:'Après un mois, la texture reste agréable.',productId:pid,rating:5,criteria:{value:4},media:[]}});assert.equal(edit.status,200);assert.equal((await request('/products/'+pid)).data.product.avg_rating,5);
const draft=await request('/posts',{method:'POST',cookie:a.cookie,body:{type:'look',category:'Mode',caption:'',media:[],draft:true}});assert.equal(draft.status,201);assert.equal((await request('/posts?drafts=1',{cookie:a.cookie})).data.posts.length,1);assert.equal((await request('/posts')).data.posts.length,1);assert.equal((await request('/posts/'+draft.data.post.id)).status,404);
const login=await request('/auth/login',{method:'POST',body:{email:'a@example.fr',password:'un-mot-de-passe-solide'}});assert.equal(login.status,200);assert.equal(login.data.user.username,'Alice');await request('/auth/logout',{method:'POST',cookie:login.cookie});assert.equal((await request('/me',{cookie:login.cookie})).data.user,null);
}finally{server.kill();rmSync(dir,{recursive:true,force:true})}});

/* ============================================================
   ÉTAPE « CRITÈRES PAR CATÉGORIE »
   1) la table partagée shared/criteres.js contient bien ce que
      demande le cahier des charges ;
   2) le serveur n'accepte que les critères prévus pour la
      catégorie du produit (liste blanche), et les déclarations
      texte (type de peau, pointure, occasion) sont conservées.
   ============================================================ */
test('critères adaptés à chaque catégorie', () => {
  // Maquillage : les 5 critères du cahier des charges, dans l'ordre
  assert.deepEqual(criteresNotes('Maquillage').map(([cle]) => cle), ['quality', 'wear', 'application', 'result', 'value']);
  // Soins / Cheveux / Hygiène : texture, résultats, tolérance, prix
  for (const cat of ['Soins', 'Beauté', 'Cheveux', 'Hygiène'])
    assert.deepEqual(criteresNotes(cat).map(([cle]) => cle), ['texture', 'result', 'tolerance', 'value'], cat);
  // Vêtements et chaussures : coupe, matières, fidélité du rendu, prix
  for (const cat of ['Mode', 'Chaussures & sacs'])
    assert.deepEqual(criteresNotes(cat).map(([cle]) => cle), ['fit', 'quality', 'accuracy', 'value'], cat);
  // Parfums : odeur, tenue, intensité, prix
  assert.deepEqual(criteresNotes('Parfums').map(([cle]) => cle), ['scent', 'wear', 'intensity', 'value']);
  // Le rapport qualité-prix est présent partout : c'est la base de « Est-ce que ça vaut son prix ? »
  for (const cat of ['Maquillage', 'Soins', 'Mode', 'Chaussures & sacs', 'Parfums', 'Lifestyle'])
    assert.ok(criteresNotes(cat).some(([cle]) => cle === 'value'), cat);

  // Champs texte : type de peau pour les soins, pointures pour les vêtements, occasion pour les parfums
  assert.deepEqual(criteresTextes('Soins').map(c => c.key), ['skin']);
  assert.deepEqual(criteresTextes('Cheveux').map(c => c.key), ['hair']);
  assert.deepEqual(criteresTextes('Mode').map(c => c.key), ['sizeUsual', 'sizeOrdered']);
  assert.deepEqual(criteresTextes('Parfums').map(c => c.key), ['occasion']);
  assert.deepEqual(criteresTextes('Lifestyle'), []);
  // Les deux pointures s'affichent côte à côte, le type de peau tout seul
  assert.deepEqual(groupesTextes('Mode').map(g => g.map(c => c.key)), [['sizeUsual', 'sizeOrdered']]);
  assert.deepEqual(groupesTextes('Soins').map(g => g.length), [1]);
  // Aucun champ texte oublié dans la liste blanche
  assert.deepEqual(clesCriteres('Parfums').sort(), ['intensity', 'occasion', 'scent', 'value', 'wear']);

  // Agrégation des déclarations : « mixte » et « Mixte » comptent ensemble
  const avis = [
    { criteria: { skin: 'mixte', value: 4 } },
    { criteria: { skin: 'Mixte' } },
    { criteria: { skin: 'sèche' } },
    { criteria: { value: 5 } }
  ];
  assert.deepEqual(declarations(avis, 'Soins'), [{ key: 'skin', label: 'Type de peau', valeurs: [{ valeur: 'mixte', n: 2 }, { valeur: 'sèche', n: 1 }] }]);
  assert.deepEqual(declarations(avis, 'Lifestyle'), []);
});

test('le serveur n’accepte que les critères prévus pour la catégorie', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lynora-criteres-'));
  const port = 41000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}/api`;
  const serveur = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DB_PATH: '', UPLOAD_DIR: '', RAILWAY_ENVIRONMENT: 'test', RAILWAY_VOLUME_MOUNT_PATH: dossier, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let journal = '';
  serveur.stderr.on('data', d => journal += d);
  serveur.stdout.on('data', d => journal += d);
  const requete = async (chemin, { method = 'GET', body, cookie } = {}) => {
    const r = await fetch(base + chemin, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/me')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const compte = await requete('/auth/register', { method: 'POST', body: { email: 'parfum@example.fr', username: 'Iris', password: 'un-mot-de-passe-solide' } });
    assert.equal(compte.status, 201);
    const produit = await requete('/products', { method: 'POST', cookie: compte.cookie, body: { name: 'Eau de test', brand: 'Maison Test', category: 'Parfums', price: 89 } });
    assert.equal(produit.status, 201);
    const pid = produit.data.product.id;

    // Critères envoyés : 3 valides pour un parfum, 1 clé d'une autre catégorie, 1 clé inventée
    const avis = await requete('/posts', {
      method: 'POST', cookie: compte.cookie,
      body: {
        type: 'avis', category: 'Parfums', caption: 'Une odeur boisée qui tient toute la journée, parfaite pour le travail.', productId: pid, rating: 5,
        criteria: { scent: 5, wear: 4, intensity: 3, value: 4, occasion: '  tous les jours  ', texture: 5, critereInvente: 5 }
      }
    });
    assert.equal(avis.status, 201, JSON.stringify(avis.data));
    // Seuls scent, wear, intensity, value et occasion sont conservés ; le texte est nettoyé
    assert.deepEqual(avis.data.post.criteria, { scent: 5, wear: 4, intensity: 3, value: 4, occasion: 'tous les jours' });

    // La fiche produit agrège les notes réelles
    const fiche = await requete('/products/' + pid);
    assert.equal(fiche.data.product.avg_rating, 5);
    assert.equal(fiche.data.product.value_rating, 4);
    assert.deepEqual(fiche.data.reviews[0].criteria, { scent: 5, wear: 4, intensity: 3, value: 4, occasion: 'tous les jours' });
    // Et les déclarations se retrouvent telles quelles pour la fiche
    assert.deepEqual(declarations(fiche.data.reviews, 'Parfums'), [{ key: 'occasion', label: 'Occasion', valeurs: [{ valeur: 'tous les jours', n: 1 }] }]);
  } finally { serveur.kill(); rmSync(dossier, { recursive: true, force: true }); }
});

/* ============================================================
   LISTES PARTAGEABLES (Fonction 4)
   Ce test vérifie ce qui pourrait faire mal : une liste privée
   doit rester privée, et personne d'autre que son propriétaire
   ne peut la modifier.
   ============================================================ */
test('listes partageables : visibilité, permissions et rangement', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lynora-listes-'));
  const port = 42000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}/api`;
  const serveur = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DB_PATH: '', UPLOAD_DIR: '', RAILWAY_ENVIRONMENT: 'test', RAILWAY_VOLUME_MOUNT_PATH: dossier, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let journal = '';
  serveur.stderr.on('data', d => journal += d);
  serveur.stdout.on('data', d => journal += d);
  const requete = async (chemin, { method = 'GET', body, cookie } = {}) => {
    const r = await fetch(base + chemin, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/me')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const a = await requete('/auth/register', { method: 'POST', body: { email: 'liste-a@example.fr', username: 'Alice', password: 'un-mot-de-passe-solide' } });
    const b = await requete('/auth/register', { method: 'POST', body: { email: 'liste-b@example.fr', username: 'Brune', password: 'un-autre-mot-de-passe' } });
    const produit = await requete('/products', { method: 'POST', cookie: a.cookie, body: { name: 'Crème test', brand: 'Maison Test', category: 'Soins', price: 18 } });
    const pid = produit.data.product.id;
    const autresProduits = [];
    for (const nom of ['Baume test', 'Huile test']) autresProduits.push((await requete('/products', { method: 'POST', cookie: a.cookie, body: { name: nom, brand: 'Maison Test', category: 'Soins' } })).data.product.id);

    // 1. Création d'une liste privée par Brune
    const creation = await requete('/collections', { method: 'POST', cookie: b.cookie, body: { title: 'Ma routine du soir', description: 'Mes essentiels avant de dormir.', visibility: 'private' } });
    assert.equal(creation.status, 201);
    const liste = creation.data.collection.id;
    assert.equal(creation.data.collection.items_count, 0);
    assert.deepEqual(creation.data.collection.covers, []);
    // Titre trop court : refusé
    assert.equal((await requete('/collections', { method: 'POST', cookie: b.cookie, body: { title: 'x' } })).status, 400);
    // Sans compte : refusé
    assert.equal((await requete('/collections', { method: 'POST', body: { title: 'Sans compte' } })).status, 401);

    // 2. La liste privée reste privée : ni l'invité, ni Alice ne la voient
    assert.equal((await requete('/collections/' + liste)).status, 403);
    assert.equal((await requete('/collections/' + liste, { cookie: a.cookie })).status, 403);
    assert.equal((await requete('/users/' + b.data.user.id + '/collections', { cookie: a.cookie })).data.collections.length, 0);
    assert.equal((await requete('/users/' + b.data.user.id + '/collections', { cookie: b.cookie })).data.collections.length, 1);

    // 3. Rangement du produit, et refus du doublon
    assert.equal((await requete('/collections/' + liste + '/items', { method: 'POST', cookie: b.cookie, body: { productId: pid } })).status, 201);
    assert.equal((await requete('/collections/' + liste + '/items', { method: 'POST', cookie: b.cookie, body: { productId: pid } })).status, 409);
    assert.equal((await requete('/collections/' + liste + '/items', { method: 'POST', cookie: b.cookie, body: { productId: 9999 } })).status, 404);

    // 4. Alice ne peut rien modifier chez Brune
    assert.equal((await requete('/collections/' + liste, { method: 'PATCH', cookie: a.cookie, body: { title: 'Détournement' } })).status, 403);
    assert.equal((await requete('/collections/' + liste + '/items', { method: 'POST', cookie: a.cookie, body: { productId: autresProduits[0] } })).status, 403);
    assert.equal((await requete('/collections/' + liste, { method: 'DELETE', cookie: a.cookie })).status, 403);

    // 5. Brune publie la liste : tout le monde peut la lire, avec la note réelle des produits
    await requete('/posts', { method: 'POST', cookie: a.cookie, body: { type: 'avis', category: 'Soins', caption: 'Une crème très agréable, la peau est souple au réveil.', productId: pid, rating: 5, criteria: { texture: 5, value: 4 } } });
    await requete('/collections/' + liste, { method: 'PATCH', cookie: b.cookie, body: { title: 'Ma routine du soir', description: 'Mes essentiels avant de dormir.', visibility: 'public' } });
    const vueInvite = await requete('/collections/' + liste);
    assert.equal(vueInvite.status, 200);
    assert.equal(vueInvite.data.collection.items_count, 1);
    assert.equal(vueInvite.data.collection.owner_id, b.data.user.id);
    assert.equal(vueInvite.data.collection.mine, false);
    assert.equal(vueInvite.data.products[0].id, pid);
    assert.equal(vueInvite.data.products[0].avg_rating, 5);
    assert.equal(vueInvite.data.products[0].review_count, 1);
    const vueProprietaire = await requete('/collections/' + liste, { cookie: b.cookie });
    assert.equal(vueProprietaire.data.collection.mine, true);
    assert.equal((await requete('/users/' + b.data.user.id + '/collections', { cookie: a.cookie })).data.collections[0].items_count, 1);
    // La vignette de couverture vient de la première photo réelle du produit (ici aucune) : la liste reste valide
    assert.deepEqual((await requete('/users/' + b.data.user.id + '/collections', { cookie: a.cookie })).data.collections[0].covers, []);

    // 6. L'écran d'ajout sait si le produit est déjà rangé
    const mesListes = await requete('/me/collections?productId=' + pid, { cookie: b.cookie });
    assert.equal(mesListes.data.collections[0].has_product, true);
    assert.equal((await requete('/me/collections?productId=' + autresProduits[0], { cookie: b.cookie })).data.collections[0].has_product, false);

    // 7. Retrait du produit, puis suppression de la liste
    const retrait = await requete('/collections/' + liste + '/items/' + pid, { method: 'DELETE', cookie: b.cookie });
    assert.equal(retrait.data.items_count, 0);
    assert.equal((await requete('/collections/' + liste)).data.products.length, 0);
    assert.equal((await requete('/collections/' + liste, { method: 'DELETE', cookie: b.cookie })).status, 200);
    assert.equal((await requete('/collections/' + liste)).status, 404);
    assert.equal((await requete('/users/' + b.data.user.id + '/collections', { cookie: b.cookie })).data.collections.length, 0);
  } finally { serveur.kill(); rmSync(dossier, { recursive: true, force: true }); }
});

/* ============================================================
   LES PIÈCES D'UN LOOK (Fonction 2)
   Un look rassemble plusieurs produits, de catégories différentes.
   Ce test vérifie ce qui doit rester vrai : les pièces sont bien
   enregistrées dans l'ordre, une comparaison exige deux produits,
   une pièce inventée est refusée, et la fiche produit retrouve les
   looks qui l'utilisent.
   ============================================================ */
test('les pièces d’un look : composition, ordre et limites', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lynora-looks-'));
  const port = 43000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}/api`;
  const serveur = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DB_PATH: '', UPLOAD_DIR: '', RAILWAY_ENVIRONMENT: 'test', RAILWAY_VOLUME_MOUNT_PATH: dossier, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let journal = '';
  serveur.stderr.on('data', d => journal += d);
  serveur.stdout.on('data', d => journal += d);
  const requete = async (chemin, { method = 'GET', body, cookie } = {}) => {
    const r = await fetch(base + chemin, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/me')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const a = await requete('/auth/register', { method: 'POST', body: { email: 'look-a@example.fr', username: 'Lina', password: 'un-mot-de-passe-solide' } });
    const b = await requete('/auth/register', { method: 'POST', body: { email: 'look-b@example.fr', username: 'Noa', password: 'un-autre-mot-de-passe' } });
    // Une pièce de chaque univers : sac, chaussures, maquillage et parfum.
    const sac = (await requete('/products', { method: 'POST', cookie: a.cookie, body: { name: 'Cabas en cuir', brand: 'Maison Test', category: 'Mode', price: 120 } })).data.product.id;
    const baskets = (await requete('/products', { method: 'POST', cookie: a.cookie, body: { name: 'Baskets blanches', brand: 'Maison Test', category: 'Chaussures & sacs', price: 75 } })).data.product.id;
    const rouge = (await requete('/products', { method: 'POST', cookie: a.cookie, body: { name: 'Rouge à lèvres mat', brand: 'Atelier Test', category: 'Maquillage', price: 22 } })).data.product.id;

    // 1. Un look avec quatre pièces, dans un ordre précis
    const look = await requete('/posts', { method: 'POST', cookie: a.cookie, body: { type: 'look', category: 'Mode', caption: 'Ma tenue du jour : un cabas, des baskets, un rouge à lèvres et mon parfum préféré.', productIds: [sac, baskets, rouge, sac] } });
    assert.equal(look.status, 201, JSON.stringify(look.data));
    assert.deepEqual(look.data.post.pieces.map(x => x.id), [sac, baskets, rouge]);   // doublon ignoré, ordre conservé
    assert.deepEqual(look.data.post.pieces.map(x => x.category), ['Mode', 'Chaussures & sacs', 'Maquillage']);
    assert.equal(look.data.post.pieces[0].name, 'Cabas en cuir');

    // 2. Un avis ne prend pas de pièces : il garde son produit noté
    const avis = await requete('/posts', { method: 'POST', cookie: a.cookie, body: { type: 'avis', category: 'Maquillage', caption: 'Une couleur intense qui tient bien la journée.', productId: rouge, rating: 5, productIds: [sac, baskets] } });
    assert.equal(avis.status, 201);
    assert.deepEqual(avis.data.post.pieces, []);
    assert.equal(avis.data.post.product_id, rouge);

    // 3. Une comparaison demande au moins deux produits
    assert.equal((await requete('/posts', { method: 'POST', cookie: a.cookie, body: { type: 'comparaison', category: 'Mode', caption: 'Les deux sacs comparés un par un.', productIds: [sac] } })).status, 400);
    assert.equal((await requete('/posts', { method: 'POST', cookie: a.cookie, body: { type: 'comparaison', category: 'Mode', caption: 'Les deux sacs comparés un par un.', productIds: [sac, baskets] } })).status, 201);

    // 4. Un look sans pièce est refusé, et une pièce inventée aussi
    assert.equal((await requete('/posts', { method: 'POST', cookie: a.cookie, body: { type: 'look', category: 'Mode', caption: 'Un look sans aucune pièce à montrer.' } })).status, 400);
    assert.equal((await requete('/posts', { method: 'POST', cookie: a.cookie, body: { type: 'look', category: 'Mode', caption: 'Un look avec une pièce qui n’existe pas.', productIds: [9999] } })).status, 404);
    // Un brouillon reste enregistrable incomplet : on peut ranger son idée et la finir plus tard
    const brouillon = await requete('/posts', { method: 'POST', cookie: a.cookie, body: { type: 'look', category: 'Mode', caption: '', draft: true, productIds: [sac] } });
    assert.equal(brouillon.status, 201);
    assert.equal(brouillon.data.post.draft, true);

    // 5. La fiche produit retrouve les looks qui l'utilisent
    // Le sac apparaît dans le look ET dans la comparaison : deux publications.
    const fiche = await requete('/products/' + sac);
    assert.equal(fiche.data.looks.length, 2);
    assert.ok(fiche.data.looks.some(l => l.id === look.data.post.id));
    const publication = fiche.data.looks.find(l => l.id === look.data.post.id);
    assert.equal(publication.username, 'Lina');
    assert.equal(publication.pieces.length, 3);
    assert.equal((await requete('/products/' + rouge)).data.looks.length, 1);      // seulement le look (l'avis ne compte pas)
    assert.equal((await requete('/products/' + baskets)).data.looks.length, 2);   // le look et la comparaison

    // 6. Modifier le look remplace vraiment ses pièces
    const modif = await requete('/posts/' + look.data.post.id, { method: 'PATCH', cookie: a.cookie, body: { type: 'look', category: 'Mode', caption: 'Ma tenue du jour, version soirée avec seulement deux pièces.', productIds: [rouge, sac] } });
    assert.equal(modif.status, 200);
    assert.deepEqual(modif.data.post.pieces.map(x => x.id), [rouge, sac]);
    assert.equal((await requete('/products/' + baskets)).data.looks.length, 1);   // la comparaison, plus le look

    // 7. Personne d'autre ne peut modifier ce look
    assert.equal((await requete('/posts/' + look.data.post.id, { method: 'PATCH', cookie: b.cookie, body: { type: 'look', category: 'Mode', caption: 'Je modifie le look de quelqu’un d’autre.', productIds: [baskets] } })).status, 403);
    // Et un look d'autrui reste visible : c'est le principe du partage
    assert.equal((await requete('/posts/' + look.data.post.id, { cookie: b.cookie })).status, 200);
  } finally { serveur.kill(); rmSync(dossier, { recursive: true, force: true }); }
});
