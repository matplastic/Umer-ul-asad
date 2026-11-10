/* MAT-ERP service worker
 *
 * Goal: make the app installable and fast to open on a phone WITHOUT ever
 * showing stale business data.
 *
 *  - The app's own files (HTML, JS, CSS, icons) are cached so it opens quickly.
 *  - Live data is NEVER cached or touched: Firestore / Firebase / Google
 *    (they're other origins) and /.netlify/functions + /api (same origin) all
 *    go straight to the network.
 *  - The page itself is "network first": you always get the newest version when
 *    online; the cached copy is only a fallback for a bad / missing connection.
 *
 * __BUILD_ID__ is replaced at build time (see vite.config.ts), so every deploy
 * produces a different sw.js. The browser sees that, installs the new worker
 * and old caches are deleted.
 */
const BUILD = '__BUILD_ID__';
const CACHE = 'mat-erp-' + BUILD;
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

const OFFLINE_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title></head>' +
  '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
  'background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
  '<div><h2 style="margin:0 0 8px">You are offline</h2>' +
  '<p style="margin:0 0 18px;color:#94a3b8">MAT-ERP needs a connection the first time it opens. ' +
  'Check your Wi-Fi or mobile data and try again.</p>' +
  '<button onclick="location.reload()" style="background:#ea580c;color:#fff;border:0;border-radius:8px;' +
  'padding:10px 18px;font-weight:700">Try again</button></div></body></html>';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One failing file must not block the install.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('mat-erp-') && n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function fetchWithTimeout(req, ms) {
  if (!ms) return fetch(req);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((res) => { clearTimeout(timer); resolve(res); }, (err) => { clearTimeout(timer); reject(err); });
  });
}

async function networkFirstPage(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match('/');
  try {
    // With a cached copy available, don't make people wait on a dead connection.
    const fresh = await fetchWithTimeout(req, cached ? 4000 : 0);
    if (fresh && fresh.ok) cache.put('/', fresh.clone()).catch(() => {});
    return fresh;
  } catch (err) {
    return cached || new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// Hashed build files (/assets/xyz-1a2b3c.js) never change, so cache-first is safe.
async function cacheFirstAsset(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  const type = res.headers.get('content-type') || '';
  // A missing old asset can come back as the app's HTML page (SPA fallback): never cache that as a script.
  if (res.ok && res.type === 'basic' && !type.includes('text/html')) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const update = fetch(req).then((res) => {
    const type = res.headers.get('content-type') || '';
    if (res.ok && res.type === 'basic' && !type.includes('text/html')) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (hit) { update.catch(() => {}); return hit; }
  return update;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                                   // saves/writes are never intercepted
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                    // Firebase, Google APIs, CDNs, fonts…
  if (url.pathname.startsWith('/.netlify/') || url.pathname.startsWith('/api/')) return; // live functions
  if (url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') { event.respondWith(networkFirstPage(req)); return; }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirstAsset(req)); return; }
  event.respondWith(staleWhileRevalidate(req));
});
