import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { dbPath } from './storage.js';
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE, bio TEXT NOT NULL DEFAULT '', avatar TEXT, interests TEXT NOT NULL DEFAULT '[]', favorites_public INTEGER NOT NULL DEFAULT 0, recommendations INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL, product_key TEXT, category TEXT NOT NULL, price REAL, image TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(name, brand) ON CONFLICT ABORT);
CREATE UNIQUE INDEX IF NOT EXISTS product_normalized ON products(lower(trim(name)), lower(trim(brand)));
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, category TEXT NOT NULL, caption TEXT NOT NULL, product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, rating INTEGER CHECK(rating BETWEEN 1 AND 5), price_paid REAL, criteria TEXT NOT NULL DEFAULT '{}', draft INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS media_uploads (url TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS post_media (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, url TEXT NOT NULL, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS likes (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, PRIMARY KEY(user_id, post_id));
CREATE TABLE IF NOT EXISTS saved_posts (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, PRIMARY KEY(user_id, post_id));
CREATE TABLE IF NOT EXISTS saved_products (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS follows (follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(follower_id, followed_id), CHECK(follower_id != followed_id));
CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS helpful (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, PRIMARY KEY(user_id,post_id));
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE, read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY, reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(reporter_id,post_id));
CREATE UNIQUE INDEX IF NOT EXISTS one_public_review_per_user_product ON posts(author_id,product_id) WHERE type='avis' AND draft=0;
CREATE INDEX IF NOT EXISTS posts_feed ON posts(draft, id DESC);
CREATE INDEX IF NOT EXISTS posts_product ON posts(product_id,draft);
CREATE INDEX IF NOT EXISTS comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,id DESC);`);
export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);
export function transaction(fn) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } }

// Additive migration for catalogues created before normalized product keys.
if (!all('PRAGMA table_info(products)').some(c => c.name === 'product_key')) db.exec('ALTER TABLE products ADD COLUMN product_key TEXT');
const canonical = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g, ' ').trim();
export const productKey = (brand,name) => canonical(brand) + '|' + canonical(name);
for (const p of all('SELECT id,name,brand FROM products WHERE product_key IS NULL')) run('UPDATE products SET product_key=? WHERE id=?',productKey(p.brand,p.name),p.id);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS products_key_unique ON products(product_key)');

/* Listes / collections partageables (Fonction 4 du cahier des charges).
   - collections : une liste appartient à une personne, avec un titre, une
     description courte et une visibilité publique ou privée.
   - collection_items : les produits rangés dans la liste, dans l'ordre.
     ON DELETE CASCADE : si un compte ou un produit disparaît, les lignes
     associées partent avec lui (aucune donnée orpheline). */
db.exec(`CREATE TABLE IF NOT EXISTS collections (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', visibility TEXT NOT NULL DEFAULT 'public', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS collection_items (collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(collection_id, product_id));
CREATE INDEX IF NOT EXISTS collections_owner ON collections(owner_id, id DESC);
CREATE INDEX IF NOT EXISTS collection_items_liste ON collection_items(collection_id, position, added_at);`);

/* Les pièces d'un look (Fonction 2 du cahier des charges).
   Un look (« look », « tenue », « comparaison ») peut rassembler plusieurs
   produits de catégories différentes : maquillage, vêtements, chaussures,
   accessoires, parfum. Chaque produit garde sa fiche, vers laquelle on
   renvoie. post_id + product_id forment la clé : impossible de ranger deux
   fois la même pièce dans un look. Les suppressions en cascade évitent
   toute ligne orpheline si un compte ou un produit disparaît. */
db.exec(`CREATE TABLE IF NOT EXISTS post_products (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(post_id, product_id));
CREATE INDEX IF NOT EXISTS post_products_look ON post_products(post_id, position);
CREATE INDEX IF NOT EXISTS post_products_piece ON post_products(product_id);`);
