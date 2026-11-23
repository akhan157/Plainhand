// Plainhand Remote Dashboard service worker (plain script, no module syntax).
// Privacy contract: NEVER cache /dashboard-data.json, /api/*, /auth/*, /login*,
// /reports/*, or /output/*. Only public UI shell assets and /offline.html are cached.
const CACHE = 'plainhand-dashboard-shell-v1';
const PRECACHE = [
  '/offline.html',
  '/assets/terminal.css',
  '/assets/login.css',
  '/assets/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
];
const BYPASS_PREFIXES = ['/dashboard-data.json', '/api/', '/auth/', '/login', '/reports/', '/output/'];
const STATIC_PREFIXES = ['/assets/', '/icons/'];
const STATIC_FILES = new Set(['/manifest.webmanifest', '/apple-touch-icon.png', '/offline.html']);

function isBypassed(pathname) {
  return BYPASS_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix));
}

function isStaticAsset(pathname) {
  return STATIC_FILES.has(pathname) || STATIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(PRECACHE.map(url => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('plainhand-dashboard-shell-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallback = await caches.match('/offline.html');
        return fallback || new Response('Offline. Reconnect and try again.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }),
    );
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        try {
          const response = await fetch(request);
          if (response.ok && response.type === 'basic') cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await cache.match(request);
          return cached || Response.error();
        }
      }),
    );
  }
});
