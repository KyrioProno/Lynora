import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, get, all, run, transaction, productKey } from './db.js';
import { uploadDir } from './storage.js';
// Critères autorisés par catégorie : la même table que celle de l'interface.
import { clesCriteres } from '../shared/criteres.js';

mkdirSync(uploadDir, {recursive:true});
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
// Arena's live preview embeds the app in an iframe; do not send X-Frame-Options.
app.use(helmet({ contentSecurityPolicy: false, frameguard: false, crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '150kb' }));
const limiter = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: 'draft-7', legacyHeaders: false });
const publishLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 25, standardHeaders: 'draft-7', legacyHeaders: false, message: {error:'Tu publies trop vite. Réessaie dans quelques minutes.'} });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Trop de tentatives. Réessaie dans quelques minutes.' } });
app.use('/api', limiter);
app.use('/api',(req,res,next)=>{ req.body ??= {}; next(); });
// Cookie-authenticated writes must originate from this host. SameSite cookies alone do not
// protect against other origins on the same site.
app.use('/api', (req,res,next) => {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== (req.get('x-forwarded-host') || req.get('host'))) return res.status(403).json({error:'Origine non autorisée.'}); }
    catch { return res.status(403).json({error:'Origine non autorisée.'}); }
  }
  next();
});

const categories = ['Maquillage','Mode','Beauté','Soins','Cheveux','Parfums','Lifestyle','Chaussures & sacs','Hygiène'];
const types = ['avis','look','routine','découverte','comparaison','conseil','tenue'];
const publicUser = u => u ? ({ id: u.id, username: u.username, bio: u.bio, avatar: u.avatar, interests: JSON.parse(u.interests || '[]'), favoritesPublic: !!u.favorites_public, recommendations: !!u.recommendations, createdAt: u.created_at }) : null;
const fail = (res, code, error) => res.status(code).json({ error });
const text = (v, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const numericId = v => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const mediaOk = url => typeof url === 'string' && /^\/uploads\/[a-f0-9-]{36}\.webp$/.test(url);
const cookie = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('lynora_session='))?.split('=')[1];
const tokenHash = t => createHash('sha256').update(t).digest('hex');
app.use(['/api','/uploads'], (req,res,next) => { const token = cookie(req); if (token) { const row = get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > ?', tokenHash(token), Date.now()); req.user = row || null; } next(); });
app.get('/uploads/:file',(req,res)=>{
  const url='/uploads/'+req.params.file;
  if(!mediaOk(url))return fail(res,404,'Image introuvable.');
  const media=get('SELECT owner_id FROM media_uploads WHERE url=?',url);
  if(!media)return fail(res,404,'Image introuvable.');
  const publicImage=!!get(`SELECT 1 FROM products WHERE image=? UNION SELECT 1 FROM users WHERE avatar=? UNION SELECT 1 FROM post_media pm JOIN posts p ON p.id=pm.post_id WHERE pm.url=? AND p.draft=0 LIMIT 1`,url,url,url);
  if(!publicImage&&req.user?.id!==media.owner_id)return fail(res,403,'Image privée.');
  res.set('Cache-Control',publicImage?'public, max-age=604800':'private, no-store');
  res.sendFile(resolve(uploadDir,req.params.file));
});
const ownedMedia = (user,url) => !url || !!get('SELECT 1 FROM media_uploads WHERE url=? AND owner_id=?',url,user.id);
function removeUnusedMedia(url){
  if(!mediaOk(url) || !get('SELECT 1 FROM media_uploads WHERE url=?',url))return;
  const used=get('SELECT 1 FROM post_media WHERE url=? UNION SELECT 1 FROM products WHERE image=? UNION SELECT 1 FROM users WHERE avatar=? LIMIT 1',url,url,url);
  if(used)return;
  run('DELETE FROM media_uploads WHERE url=?',url);
  try{unlinkSync(resolve(uploadDir,url.slice('/uploads/'.length)))}catch{}
}
// Unattached uploads from interrupted forms are kept for a day, then reclaimed.
const cleanup = () => all("SELECT url FROM media_uploads WHERE created_at < datetime('now','-1 day')").forEach(m=>removeUnusedMedia(m.url));
setInterval(cleanup,12*60*60_000).unref();
function required(req,res,next) { if (!req.user) return fail(res,401,'Connecte-toi pour continuer.'); next(); }
function session(req,res,user) { const token = randomBytes(32).toString('hex'); run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',tokenHash(token),user.id,Date.now()+30*86400_000); const secure = req.secure || req.get('x-forwarded-proto') === 'https' || req.get('origin')?.startsWith('https:'); res.cookie('lynora_session',token,{ httpOnly:true,secure:!!secure,sameSite:'lax',path:'/',maxAge:30*86400_000 }); }
function notice(userId, actorId, kind, postId = null) { if (userId !== actorId) run('INSERT INTO notifications(user_id,actor_id,kind,post_id) VALUES(?,?,?,?)',userId,actorId,kind,postId); }
function postSelect(viewer) { const id = viewer?.id || 0; return `SELECT p.*, u.username,u.avatar,u.bio AS author_bio, pr.name AS product_name,pr.brand AS product_brand,pr.image AS product_image, (SELECT count(*) FROM likes l WHERE l.post_id=p.id) AS likes_count,(SELECT count(*) FROM comments c WHERE c.post_id=p.id) AS comments_count,(SELECT count(*) FROM helpful h WHERE h.post_id=p.id) AS helpful_count, EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=${id}) AS liked, EXISTS(SELECT 1 FROM saved_posts s WHERE s.post_id=p.id AND s.user_id=${id}) AS saved, EXISTS(SELECT 1 FROM helpful h WHERE h.post_id=p.id AND h.user_id=${id}) AS helped FROM posts p JOIN users u ON u.id=p.author_id LEFT JOIN products pr ON pr.id=p.product_id`; }
function hydratePosts(rows) { return rows.map(p => ({ ...p, media: all('SELECT url FROM post_media WHERE post_id=? ORDER BY position',p.id).map(x=>x.url),criteria:JSON.parse(p.criteria || '{}'), liked:!!p.liked,saved:!!p.saved,helped:!!p.helped,draft:!!p.draft })); }
function postById(id,viewer,allowDraft=false) { const row = get(postSelect(viewer) + ' WHERE p.id=?' + (allowDraft ? '' : ' AND p.draft=0'),id); return row ? hydratePosts([row])[0] : null; }

app.get('/api/me',(req,res)=>res.json({ user: publicUser(req.user) }));
app.post('/api/auth/register',authLimiter,async(req,res)=>{ const email=text(req.body.email,255).toLowerCase(); const username=text(req.body.username,24); const password=req.body.password; if (!/^\S+@\S+\.\S+$/.test(email)|| !/^[\p{L}\p{N}_.-]{3,24}$/u.test(username) || typeof password!=='string'||password.length<10||password.length>128) return fail(res,400,'Email, pseudo (3–24 caractères) et mot de passe (10 caractères minimum) requis.'); if(get('SELECT id FROM users WHERE email=? OR username=?',email,username)) return fail(res,409,'Cet email ou ce pseudo est déjà utilisé.'); const hash=await bcrypt.hash(password,12); try { const id=run('INSERT INTO users(email,username,password_hash) VALUES(?,?,?)',email,username,hash).lastInsertRowid; const user=get('SELECT * FROM users WHERE id=?',id); session(req,res,user); res.status(201).json({user:publicUser(user)}); } catch(e){ return fail(res,409,'Cet email ou ce pseudo est déjà utilisé.'); } });
app.post('/api/auth/login',authLimiter,async(req,res)=>{ const user=get('SELECT * FROM users WHERE email=?',text(req.body.email,255).toLowerCase()); if(!user || !(await bcrypt.compare(String(req.body.password||''),user.password_hash))) return fail(res,401,'Identifiants incorrects.'); session(req,res,user); res.json({user:publicUser(user)}); });
app.post('/api/auth/logout',required,(req,res)=>{ const t=cookie(req); if(t)run('DELETE FROM sessions WHERE token_hash=?',tokenHash(t)); res.clearCookie('lynora_session',{path:'/',sameSite:'lax'}); res.json({ok:true}); });
app.patch('/api/me',required,(req,res)=>{ const username=text(req.body.username,24); if(!/^[\p{L}\p{N}_.-]{3,24}$/u.test(username))return fail(res,400,'Pseudo invalide.'); const bio=text(req.body.bio,280); const interests=Array.isArray(req.body.interests)?req.body.interests.filter(x=>categories.includes(x)).slice(0,9):[]; const avatar=req.body.avatar; if(avatar && (!mediaOk(avatar)||!ownedMedia(req.user,avatar)))return fail(res,400,'Image invalide.'); try { const previousAvatar=req.user.avatar;run('UPDATE users SET username=?,bio=?,interests=?,avatar=?,favorites_public=?,recommendations=? WHERE id=?',username,bio,JSON.stringify(interests),avatar||null,req.body.favoritesPublic?1:0,req.body.recommendations===false?0:1,req.user.id); if(previousAvatar && previousAvatar!==avatar)removeUnusedMedia(previousAvatar);res.json({user:publicUser(get('SELECT * FROM users WHERE id=?',req.user.id))}); } catch(e){fail(res,409,'Ce pseudo est déjà utilisé.');} });
const upload = multer({ storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:5},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.mimetype)) });
app.post('/api/upload',required,upload.array('images',5),async(req,res,next)=>{ try { if(!req.files?.length)return fail(res,400,'Choisis une image JPG, PNG, WebP ou HEIC (8 Mo max).'); const urls=[]; for(const file of req.files){const name=randomUUID()+'.webp'; await sharp(file.buffer,{failOn:'error',limitInputPixels:40_000_000}).rotate().resize({width:1500,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:79}).toFile(resolve(uploadDir,name)); const url='/uploads/'+name;run('INSERT INTO media_uploads(url,owner_id) VALUES(?,?)',url,req.user.id);urls.push(url);}res.json({urls});}catch(e){next(e);} });
app.get('/api/categories',(req,res)=>res.json({categories}));
app.get('/api/products',(req,res)=>{const q=text(req.query.q,80);const cat=text(req.query.category,40);const brand=text(req.query.brand,80);const max=Number(req.query.maxPrice);const minRating=Number(req.query.minRating);let where=' WHERE 1=1',args=[]; if(q){where+=' AND (pr.name LIKE ? OR pr.brand LIKE ?)';args.push(`%${q}%`,`%${q}%`);}if(categories.includes(cat)){where+=' AND pr.category=?';args.push(cat);}if(brand){where+=' AND pr.brand LIKE ?';args.push(`%${brand}%`);}if(req.query.maxPrice && Number.isFinite(max)){where+=' AND pr.price<=?';args.push(max);}const base=`SELECT pr.*,ROUND(AVG(CASE WHEN p.draft=0 THEN p.rating END),1) AS avg_rating,COUNT(CASE WHEN p.draft=0 AND p.rating IS NOT NULL THEN 1 END) AS review_count FROM products pr LEFT JOIN posts p ON p.product_id=pr.id AND p.type='avis'`; let sql=base+where+' GROUP BY pr.id';if(req.query.minRating && Number.isFinite(minRating)){sql+=' HAVING avg_rating>=?';args.push(minRating);} sql+= req.query.sort==='top'?' ORDER BY review_count DESC, avg_rating DESC, pr.id DESC':' ORDER BY pr.id DESC';sql+=' LIMIT 40';res.json({products:all(sql,...args)}); });
app.post('/api/products',required,(req,res)=>{const name=text(req.body.name,100),brand=text(req.body.brand,80),category=text(req.body.category,40),price=req.body.price===''||req.body.price==null?null:Number(req.body.price),image=req.body.image||null;if(name.length<2||brand.length<2||!categories.includes(category)||price!==null&&(!Number.isFinite(price)||price<0||price>100000)||image&&(!mediaOk(image)||!ownedMedia(req.user,image)))return fail(res,400,'Vérifie le nom, la marque, la catégorie et le prix.');const key=productKey(brand,name);const existing=get('SELECT * FROM products WHERE product_key=?',key);if(existing)return res.status(409).json({error:'Ce produit existe déjà. Utilise sa fiche.',product:existing});try{const id=run('INSERT INTO products(name,brand,product_key,category,price,image,created_by) VALUES(?,?,?,?,?,?,?)',name,brand,key,category,price,image,req.user.id).lastInsertRowid;res.status(201).json({product:get('SELECT * FROM products WHERE id=?',id)});}catch{return fail(res,409,'Ce produit existe déjà. Utilise sa fiche.');}});
app.get('/api/products/:id',(req,res)=>{const id=numericId(req.params.id);const product=get(`SELECT pr.*,ROUND(AVG(CASE WHEN p.draft=0 THEN p.rating END),1) AS avg_rating, COUNT(CASE WHEN p.draft=0 AND p.rating IS NOT NULL THEN 1 END) AS review_count, ROUND(AVG(CASE WHEN p.draft=0 THEN json_extract(p.criteria,'$.value') END),1) AS value_rating, EXISTS(SELECT 1 FROM saved_products sp WHERE sp.product_id=pr.id AND sp.user_id=?) AS saved FROM products pr LEFT JOIN posts p ON p.product_id=pr.id AND p.type='avis' WHERE pr.id=? GROUP BY pr.id`,req.user?.id||0,id);if(!product)return fail(res,404,'Produit introuvable.');const reviews=hydratePosts(all(postSelect(req.user)+" WHERE p.product_id=? AND p.type='avis' AND p.draft=0 ORDER BY p.id DESC LIMIT 40",id));res.json({product:{...product,saved:!!product.saved},reviews});});
app.post('/api/products/:id/save',required,(req,res)=>{const id=numericId(req.params.id);if(!get('SELECT id FROM products WHERE id=?',id))return fail(res,404,'Produit introuvable.');const exists=get('SELECT 1 FROM saved_products WHERE user_id=? AND product_id=?',req.user.id,id);if(exists)run('DELETE FROM saved_products WHERE user_id=? AND product_id=?',req.user.id,id);else run('INSERT INTO saved_products(user_id,product_id) VALUES(?,?)',req.user.id,id);res.json({saved:!exists});});
app.get('/api/me/saved-products',required,(req,res)=>res.json({products:all('SELECT pr.* FROM saved_products s JOIN products pr ON pr.id=s.product_id WHERE s.user_id=? ORDER BY pr.id DESC',req.user.id)}));
app.get('/api/posts',(req,res)=>{const cat=text(req.query.category,40);const author=numericId(req.query.author);const cursor=numericId(req.query.cursor);const saved=req.query.saved==='1';const drafts=req.query.drafts==='1'&&!!req.user;let where=drafts?' WHERE p.author_id=? AND p.draft=1':' WHERE p.draft=0';const args=drafts?[req.user.id]:[];if(categories.includes(cat)){where+=' AND p.category=?';args.push(cat);}const search=text(req.query.q,80);if(search){where+=' AND (p.caption LIKE ? OR pr.name LIKE ? OR pr.brand LIKE ? OR u.username LIKE ?)';args.push(...Array(4).fill(`%${search}%`));}if(author){where+=' AND p.author_id=?';args.push(author);}if(cursor){where+=' AND p.id<?';args.push(cursor);}if(saved){if(!req.user)return fail(res,401,'Connecte-toi pour voir tes favoris.');where+=' AND EXISTS(SELECT 1 FROM saved_posts s WHERE s.post_id=p.id AND s.user_id=?)';args.push(req.user.id);}const rows=all(postSelect(req.user)+where+' ORDER BY p.id DESC LIMIT 11',...args);res.json({posts:hydratePosts(rows.slice(0,10)),nextCursor:rows.length>10?rows[9].id:null});});
app.get('/api/posts/:id',(req,res)=>{const post=postById(numericId(req.params.id),req.user,true);if(!post||post.draft&&req.user?.id!==post.author_id)return fail(res,404,'Publication introuvable.');res.json({post});});
function validatePost(body,res,user){const type=text(body.type,30),category=text(body.category,40),caption=text(body.caption,2000);const productId=numericId(body.productId);const media=Array.isArray(body.media)?body.media:[];const rating=body.rating==null?null:Number(body.rating);const price=body.pricePaid===''||body.pricePaid==null?null:Number(body.pricePaid);const criteria=body.criteria&&typeof body.criteria==='object'&&!Array.isArray(body.criteria)?body.criteria:{};// Liste blanche : on ne garde que les critères prévus pour cette catégorie
// (les clés inventées sont écartées silencieusement, sans casser les anciens clients).
const cleaned={};const autorisees=new Set(clesCriteres(category));for(const [k,v] of Object.entries(criteria).slice(0,12)){if(!autorisees.has(k))continue;if(typeof v==='number'&&Number.isInteger(v)&&v>=1&&v<=5)cleaned[k]=v;else if(typeof v==='string'&&v.trim().length>=1&&v.trim().length<=60)cleaned[k]=v.trim();}if(!types.includes(type)||!categories.includes(category)||(!body.draft&&caption.length<10)||media.length>5||!media.every(url=>mediaOk(url)&&ownedMedia(user,url))||price!==null&&(!Number.isFinite(price)||price<0||price>100000)||rating!==null&&(!Number.isInteger(rating)||rating<1||rating>5)||type==='avis'&&(!productId||!rating)&&!body.draft)return fail(res,400,'Vérifie le format, la description (10 caractères minimum), le produit et la note de ton avis.');if(productId){const product=get('SELECT id,category FROM products WHERE id=?',productId);if(!product)return fail(res,404,'Produit introuvable.');if(type==='avis'&&product.category!==category)return fail(res,400,'La catégorie de l’avis doit correspondre au produit.');}return {type,category,caption,productId,rating:type==='avis'?rating:null,price,criteria:JSON.stringify(cleaned),media,draft:body.draft?1:0};}
app.post('/api/posts',required,publishLimiter,(req,res)=>{const v=validatePost(req.body,res,req.user);if(!v)return;if(v.type==='avis'&&!v.draft&&get("SELECT id FROM posts WHERE author_id=? AND product_id=? AND type='avis' AND draft=0",req.user.id,v.productId))return fail(res,409,'Tu as déjà publié un avis sur ce produit. Modifie-le plutôt.');const id=transaction(()=>{const id=run('INSERT INTO posts(author_id,type,category,caption,product_id,rating,price_paid,criteria,draft) VALUES(?,?,?,?,?,?,?,?,?)',req.user.id,v.type,v.category,v.caption,v.productId,v.rating,v.price,v.criteria,v.draft).lastInsertRowid;v.media.forEach((url,i)=>run('INSERT INTO post_media(post_id,url,position) VALUES(?,?,?)',id,url,i));return id;});res.status(201).json({post:postById(id,req.user,true)});});
app.patch('/api/posts/:id',required,(req,res)=>{const old=get('SELECT * FROM posts WHERE id=?',numericId(req.params.id));if(!old)return fail(res,404,'Publication introuvable.');if(old.author_id!==req.user.id)return fail(res,403,'Tu ne peux modifier que ton contenu.');const v=validatePost(req.body,res,req.user);if(!v)return;if(v.type==='avis'&&!v.draft&&get("SELECT id FROM posts WHERE author_id=? AND product_id=? AND type='avis' AND draft=0 AND id!=?",req.user.id,v.productId,old.id))return fail(res,409,'Tu as déjà publié un avis sur ce produit. Modifie-le plutôt.');const previousMedia=all('SELECT url FROM post_media WHERE post_id=?',old.id).map(m=>m.url);transaction(()=>{run("UPDATE posts SET type=?,category=?,caption=?,product_id=?,rating=?,price_paid=?,criteria=?,draft=?,updated_at=datetime('now') WHERE id=?",v.type,v.category,v.caption,v.productId,v.rating,v.price,v.criteria,v.draft,old.id);run('DELETE FROM post_media WHERE post_id=?',old.id);v.media.forEach((url,i)=>run('INSERT INTO post_media(post_id,url,position) VALUES(?,?,?)',old.id,url,i));});previousMedia.forEach(removeUnusedMedia);res.json({post:postById(old.id,req.user,true)});});
app.delete('/api/posts/:id',required,(req,res)=>{const post=get('SELECT author_id FROM posts WHERE id=?',numericId(req.params.id));if(!post)return fail(res,404,'Publication introuvable.');if(post.author_id!==req.user.id)return fail(res,403,'Action interdite.');const urls=all('SELECT url FROM post_media WHERE post_id=?',numericId(req.params.id)).map(m=>m.url);run('DELETE FROM posts WHERE id=?',numericId(req.params.id));urls.forEach(removeUnusedMedia);res.json({ok:true});});
function toggle(table,column,req,res){const post=get('SELECT id,author_id FROM posts WHERE id=? AND draft=0',numericId(req.params.id));if(!post)return fail(res,404,'Publication introuvable.');const exists=get(`SELECT 1 FROM ${table} WHERE user_id=? AND ${column}=?`,req.user.id,post.id);if(exists)run(`DELETE FROM ${table} WHERE user_id=? AND ${column}=?`,req.user.id,post.id);else {run(`INSERT INTO ${table}(user_id,${column}) VALUES(?,?)`,req.user.id,post.id);if(table==='likes')notice(post.author_id,req.user.id,'like',post.id);if(table==='helpful')notice(post.author_id,req.user.id,'helpful',post.id);}res.json({active:!exists,count:get(`SELECT count(*) AS count FROM ${table} WHERE ${column}=?`,post.id).count});}
app.post('/api/posts/:id/like',required,(req,res)=>toggle('likes','post_id',req,res));
app.post('/api/posts/:id/save',required,(req,res)=>toggle('saved_posts','post_id',req,res));
app.post('/api/posts/:id/helpful',required,(req,res)=>toggle('helpful','post_id',req,res));
app.get('/api/posts/:id/comments',(req,res)=>{if(!postById(numericId(req.params.id),req.user))return fail(res,404,'Publication introuvable.');res.json({comments:all('SELECT c.*,u.username,u.avatar FROM comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=? ORDER BY c.id ASC LIMIT 100',numericId(req.params.id))});});
app.post('/api/posts/:id/comments',required,publishLimiter,(req,res)=>{const post=get('SELECT id,author_id FROM posts WHERE id=? AND draft=0',numericId(req.params.id));if(!post)return fail(res,404,'Publication introuvable.');const body=text(req.body.body,500),parent=numericId(req.body.parentId);if(body.length<2)return fail(res,400,'Écris au moins 2 caractères.');if(parent&&!get('SELECT id FROM comments WHERE id=? AND post_id=?',parent,post.id))return fail(res,400,'Réponse invalide.');const id=run('INSERT INTO comments(post_id,author_id,parent_id,body) VALUES(?,?,?,?)',post.id,req.user.id,parent,body).lastInsertRowid;notice(post.author_id,req.user.id,'comment',post.id);res.status(201).json({comment:get('SELECT c.*,u.username,u.avatar FROM comments c JOIN users u ON u.id=c.author_id WHERE c.id=?',id)});});
app.delete('/api/comments/:id',required,(req,res)=>{const c=get('SELECT author_id FROM comments WHERE id=?',numericId(req.params.id));if(!c)return fail(res,404,'Commentaire introuvable.');if(c.author_id!==req.user.id)return fail(res,403,'Action interdite.');run('DELETE FROM comments WHERE id=?',numericId(req.params.id));res.json({ok:true});});
app.get('/api/users',(req,res)=>{const q=text(req.query.q,50);res.json({users:q?all('SELECT id,username,bio,avatar FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 20',`%${q}%`):[]});});
app.get('/api/users/:id',(req,res)=>{const id=numericId(req.params.id);const user=get('SELECT * FROM users WHERE id=?',id);if(!user)return fail(res,404,'Profil introuvable.');const counts=get('SELECT (SELECT count(*) FROM follows WHERE followed_id=?) AS followers,(SELECT count(*) FROM follows WHERE follower_id=?) AS following,(SELECT count(*) FROM posts WHERE author_id=? AND draft=0) AS posts',id,id,id);const following=!!get('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?',req.user?.id||0,id);res.json({user:publicUser(user),counts,following});});
app.get('/api/users/:id/saved-products',(req,res)=>{const id=numericId(req.params.id);const user=get('SELECT id,favorites_public FROM users WHERE id=?',id);if(!user)return fail(res,404,'Profil introuvable.');if(!user.favorites_public && req.user?.id!==id)return fail(res,403,'Ces favoris sont privés.');res.json({products:all('SELECT pr.* FROM saved_products sp JOIN products pr ON pr.id=sp.product_id WHERE sp.user_id=? ORDER BY pr.id DESC LIMIT 50',id)});});
app.post('/api/users/:id/follow',required,(req,res)=>{const id=numericId(req.params.id);if(!get('SELECT id FROM users WHERE id=?',id))return fail(res,404,'Profil introuvable.');if(id===req.user.id)return fail(res,400,'Tu ne peux pas te suivre.');const exists=get('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?',req.user.id,id);if(exists)run('DELETE FROM follows WHERE follower_id=? AND followed_id=?',req.user.id,id);else{run('INSERT INTO follows(follower_id,followed_id) VALUES(?,?)',req.user.id,id);notice(id,req.user.id,'follow');}res.json({following:!exists,followers:get('SELECT count(*) AS n FROM follows WHERE followed_id=?',id).n});});
app.get('/api/me/following',required,(req,res)=>res.json({users:all('SELECT u.id,u.username,u.avatar,u.bio FROM follows f JOIN users u ON u.id=f.followed_id WHERE f.follower_id=? ORDER BY u.username',req.user.id)}));

/* ============================================================
   LISTES PARTAGEABLES (« Mes listes » — Fonction 4)
   Une personne range des produits dans des listes (« Ma routine
   quotidienne », « À tester »…) et peut partager un lien vers elles.
   Règles appliquées : une liste privée n'est lisible que par son
   propriétaire, seul le propriétaire peut la modifier, et les
   compteurs affichés viennent toujours de la base (aucun chiffre
   inventé). Un produit retiré du catalogue disparaît de la liste
   automatiquement (ON DELETE CASCADE).
   ============================================================ */
const VISIBILITES = new Set(['public','private']);
const LISTES_PAR_PERSONNE = 30;   // garde-fou anti-spam
const PRODUITS_PAR_LISTE = 60;    // idem

// Complète chaque liste avec le nombre de produits et jusqu'à 3 vignettes de couverture.
function avecCouvertures(listes){
  for(const liste of listes){
    liste.items_count=get('SELECT count(*) AS n FROM collection_items WHERE collection_id=?',liste.id).n;
    liste.covers=all('SELECT pr.image FROM collection_items ci JOIN products pr ON pr.id=ci.product_id WHERE ci.collection_id=? AND pr.image IS NOT NULL ORDER BY ci.position,ci.added_at LIMIT 3',liste.id).map(r=>r.image);
  }
  return listes;
}
const listeById=id=>id?get('SELECT c.*,u.username,u.avatar FROM collections c JOIN users u ON u.id=c.owner_id WHERE c.id=?',id):null;
const listeVisible=(liste,user)=>liste.visibility==='public'||user?.id===liste.owner_id;

// Mes listes (avec, si demandé, le drapeau « ce produit y est déjà » pour l'écran d'ajout).
app.get('/api/me/collections',required,(req,res)=>{
  const produit=numericId(req.query.productId);
  const listes=avecCouvertures(all('SELECT * FROM collections WHERE owner_id=? ORDER BY id DESC',req.user.id));
  if(produit)for(const liste of listes)liste.has_product=!!get('SELECT 1 AS present FROM collection_items WHERE collection_id=? AND product_id=?',liste.id,produit);
  res.json({collections:listes});
});

// Les listes d'un profil : les publiques pour tout le monde, toutes si c'est moi.
app.get('/api/users/:id/collections',(req,res)=>{
  const id=numericId(req.params.id);
  if(!get('SELECT id FROM users WHERE id=?',id))return fail(res,404,'Profil introuvable.');
  const mien=req.user?.id===id;
  res.json({collections:avecCouvertures(all("SELECT * FROM collections WHERE owner_id=? AND (visibility='public' OR ?=1) ORDER BY id DESC",id,mien?1:0))});
});

// Détail d'une liste : ses produits et leurs notes réelles.
app.get('/api/collections/:id',(req,res)=>{
  const liste=listeById(numericId(req.params.id));
  if(!liste)return fail(res,404,'Liste introuvable.');
  if(!listeVisible(liste,req.user))return fail(res,403,'Cette liste est privée.');
  const products=all("SELECT pr.*,ROUND(AVG(CASE WHEN p.draft=0 THEN p.rating END),1) AS avg_rating,COUNT(CASE WHEN p.draft=0 AND p.rating IS NOT NULL THEN 1 END) AS review_count FROM collection_items ci JOIN products pr ON pr.id=ci.product_id LEFT JOIN posts p ON p.product_id=pr.id AND p.type='avis' WHERE ci.collection_id=? GROUP BY pr.id ORDER BY ci.position,ci.added_at",liste.id);
  res.json({collection:{...liste,items_count:products.length,mine:req.user?.id===liste.owner_id},products});
});

// Lecture du formulaire (titre, description, visibilité), partagée par la création et la modification.
function validerListe(body,res){
  const title=text(body.title,60),description=text(body.description,300);
  const visibility=VISIBILITES.has(body.visibility)?body.visibility:'public';
  if(title.length<2)return fail(res,400,'Donne un titre de 2 caractères minimum à ta liste.');
  return {title,description,visibility};
}
app.post('/api/collections',required,publishLimiter,(req,res)=>{
  const v=validerListe(req.body,res); if(!v)return;
  if(get('SELECT count(*) AS n FROM collections WHERE owner_id=?',req.user.id).n>=LISTES_PAR_PERSONNE)return fail(res,400,`Tu as atteint la limite de ${LISTES_PAR_PERSONNE} listes.`);
  const id=run('INSERT INTO collections(owner_id,title,description,visibility) VALUES(?,?,?,?)',req.user.id,v.title,v.description,v.visibility).lastInsertRowid;
  res.status(201).json({collection:{...listeById(id),items_count:0,covers:[],mine:true}});
});
app.patch('/api/collections/:id',required,(req,res)=>{
  const liste=listeById(numericId(req.params.id));
  if(!liste)return fail(res,404,'Liste introuvable.');
  if(liste.owner_id!==req.user.id)return fail(res,403,'Tu ne peux modifier que tes listes.');
  const v=validerListe(req.body,res); if(!v)return;
  run("UPDATE collections SET title=?,description=?,visibility=?,updated_at=datetime('now') WHERE id=?",v.title,v.description,v.visibility,liste.id);
  res.json({collection:{...listeById(liste.id),mine:true}});
});
app.delete('/api/collections/:id',required,(req,res)=>{
  const liste=listeById(numericId(req.params.id));
  if(!liste)return fail(res,404,'Liste introuvable.');
  if(liste.owner_id!==req.user.id)return fail(res,403,'Tu ne peux supprimer que tes listes.');
  run('DELETE FROM collections WHERE id=?',liste.id);   // les produits rangés partent avec (CASCADE)
  res.json({ok:true});
});
app.post('/api/collections/:id/items',required,(req,res)=>{
  const liste=listeById(numericId(req.params.id));
  if(!liste)return fail(res,404,'Liste introuvable.');
  if(liste.owner_id!==req.user.id)return fail(res,403,'Tu ne peux modifier que tes listes.');
  const productId=numericId(req.body.productId);
  if(!productId||!get('SELECT id FROM products WHERE id=?',productId))return fail(res,404,'Produit introuvable.');
  if(get('SELECT 1 AS present FROM collection_items WHERE collection_id=? AND product_id=?',liste.id,productId))return fail(res,409,'Ce produit est déjà dans cette liste.');
  if(get('SELECT count(*) AS n FROM collection_items WHERE collection_id=?',liste.id).n>=PRODUITS_PAR_LISTE)return fail(res,400,`Cette liste est complète (${PRODUITS_PAR_LISTE} produits).`);
  run('INSERT INTO collection_items(collection_id,product_id,position) VALUES(?,?,(SELECT COALESCE(MAX(position),0)+1 FROM collection_items WHERE collection_id=?))',liste.id,productId,liste.id);
  res.status(201).json({ok:true,items_count:get('SELECT count(*) AS n FROM collection_items WHERE collection_id=?',liste.id).n});
});
app.delete('/api/collections/:id/items/:productId',required,(req,res)=>{
  const liste=listeById(numericId(req.params.id));
  if(!liste)return fail(res,404,'Liste introuvable.');
  if(liste.owner_id!==req.user.id)return fail(res,403,'Tu ne peux modifier que tes listes.');
  run('DELETE FROM collection_items WHERE collection_id=? AND product_id=?',liste.id,numericId(req.params.productId));
  res.json({ok:true,items_count:get('SELECT count(*) AS n FROM collection_items WHERE collection_id=?',liste.id).n});
});
app.get('/api/notifications',required,(req,res)=>res.json({notifications:all('SELECT n.*,u.username AS actor_name,u.avatar AS actor_avatar FROM notifications n JOIN users u ON u.id=n.actor_id WHERE n.user_id=? ORDER BY n.id DESC LIMIT 50',req.user.id)}));
app.post('/api/notifications/read',required,(req,res)=>{run('UPDATE notifications SET read=1 WHERE user_id=?',req.user.id);res.json({ok:true});});
app.post('/api/posts/:id/report',required,(req,res)=>{const id=numericId(req.params.id),reason=text(req.body.reason,300);if(!get('SELECT id FROM posts WHERE id=? AND draft=0',id))return fail(res,404,'Publication introuvable.');if(reason.length<5)return fail(res,400,'Indique la raison du signalement.');run('INSERT OR IGNORE INTO reports(reporter_id,post_id,reason) VALUES(?,?,?)',req.user.id,id,reason);res.json({ok:true});});
app.use('/api',(req,res)=>fail(res,404,'Adresse introuvable.'));
app.use((err,req,res,next)=>{console.error(err);if(err instanceof multer.MulterError)return fail(res,400,'Image trop volumineuse ou trop de fichiers (5 maximum, 8 Mo par image).');return fail(res,500,'Une erreur est survenue. Réessaie.');});
if(existsSync(resolve('dist/index.html'))){
  app.use(express.static(resolve('dist')));
  const html = readFileSync(resolve('dist/index.html'),'utf8');
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  app.get('*',(req,res)=>{
    let title = 'Lynora — Ton style, ta communauté', description = 'Découvre des avis sincères et partage tes inspirations sur Lynora.', image = '/editorial-beauty.webp';
    const product = req.path.match(/^\/produit\/(\d+)$/);
    const post = req.path.match(/^\/publication\/(\d+)$/);
    const profile = req.path.match(/^\/profil\/(\d+)$/);
    const collection = req.path.match(/^\/liste\/(\d+)$/);
    if(product){const p=get('SELECT name,brand,image FROM products WHERE id=?',Number(product[1]));if(p){title=`${p.name} · ${p.brand} | Lynora`;description=`Découvre les avis de la communauté sur ${p.name} par ${p.brand}.`;image=p.image||image;}}
    if(post){const p=get('SELECT p.caption,p.draft,u.username,(SELECT url FROM post_media WHERE post_id=p.id ORDER BY position LIMIT 1) AS image FROM posts p JOIN users u ON u.id=p.author_id WHERE p.id=? AND p.draft=0',Number(post[1]));if(p){title=`Une publication de ${p.username} | Lynora`;description=p.caption.slice(0,180);image=p.image||image;}}
    if(profile){const u=get('SELECT username,bio,avatar FROM users WHERE id=?',Number(profile[1]));if(u){title=`${u.username} | Lynora`;description=u.bio||`Découvre le profil de ${u.username} sur Lynora.`;image=u.avatar||image;}}
    // Liste partageable : aperçu attrayant (titre, auteur, première photo, nombre de produits).
    // Seules les listes publiques sont exposées : une liste privée garde l'aperçu par défaut.
    if(collection){const c=get("SELECT c.title,c.description,u.username,(SELECT count(*) FROM collection_items ci WHERE ci.collection_id=c.id) AS n,(SELECT pr.image FROM collection_items ci JOIN products pr ON pr.id=ci.product_id WHERE ci.collection_id=c.id AND pr.image IS NOT NULL ORDER BY ci.position,ci.added_at LIMIT 1) AS photo FROM collections c JOIN users u ON u.id=c.owner_id WHERE c.id=? AND c.visibility='public'",Number(collection[1]));if(c){title=`${c.title} · liste de ${c.username} | Lynora`;description=c.description||`${c.n} produit${c.n>1?'s':''} à découvrir, rangé${c.n>1?'s':''} par ${c.username} sur Lynora.`;image=c.photo||image;}}
    const protocol=req.get('x-forwarded-proto')||req.protocol;
    const origin=protocol+'://'+req.get('host');
    const tags=`<meta property="og:type" content="website"/><meta property="og:title" content="${escapeHtml(title)}"/><meta property="og:description" content="${escapeHtml(description)}"/><meta property="og:image" content="${escapeHtml(new URL(image,origin).href)}"/><meta property="og:url" content="${escapeHtml(new URL(req.originalUrl,origin).href)}"/><meta name="twitter:card" content="summary_large_image"/>`;
    res.type('html').send(html.replace(/<title>.*?<\/title>/,`<title>${escapeHtml(title)}</title>`).replace(/<meta name="description"[^>]*\/>/,`<meta name="description" content="${escapeHtml(description)}"/>${tags}`));
  });
}
const port=Number(process.env.PORT)||3001;
app.listen(port,'0.0.0.0',()=>console.log(`Lynora API on ${port}`));
