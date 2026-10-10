const CACHE = 'lynora-static-v1';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/','/icon.svg','/editorial-beauty.webp','/editorial-style.webp']))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  event.respondWith(fetch(event.request).then(response => { if(response.ok && (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.webp') || url.pathname === '/' || url.pathname.endsWith('.svg'))) { const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy)); } return response; }).catch(()=>caches.match(event.request)));
});
