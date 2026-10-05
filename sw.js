/* Il Mio Budget - Service Worker v8
   - install resiliente (un asset mancante non rompe la cache)
   - network-first per data.json (seed aggiornabile)
   - fallback a index.html solo per navigazioni
*/
const CACHE_NAME = 'budget-app-v8';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data.json',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) =>
      Promise.all(
        ASSETS.map((u) =>
          c.add(u).catch((err) => console.warn('[SW] skip asset', u, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Network-first per data.json (così se aggiorni il seed gli utenti lo vedono)
  if (url.pathname.endsWith('/data.json') || url.pathname === '/data.json') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const clone = r.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first con revalidate + fallback index.html solo per navigation
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((r) => {
          if (r && r.status === 200 && r.type === 'basic') {
            const clone = r.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return r;
        })
        .catch(() => {
          if (e.request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});