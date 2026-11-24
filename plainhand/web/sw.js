// Plainhand PWA service worker (plain script, no module syntax).
// Privacy contract: NEVER cache /api/*, /auth/*, /oauth/*, /account/*, /signin, /mcp,
// or authenticated HTML pages (which carry CSRF tokens and session state).
// Only public, non-personal static UI shell assets and /offline.html are cached.
const CACHE = 'plainhand-shell-v1';
const PRECACHE = [
  '/offline.html',
  '/css/tokens.css',
  '/css/app.css',
  '/theme.js',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
];
const BYPASS_PREFIXES = ['/api/', '/auth/', '/oauth/', '/account/', '/signin', '/mcp', '/.well-known/'];
const IMMUTABLE_PREFIXES = ['/fonts/', '/icons/'];
const STATIC_PREFIXES = ['/css/', '/ui/', '/vendor/'];
const STATIC_FILES = new Set([
  '/app.mjs',
  '/theme.js',
  '/landing.js',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/offline.html',
]);

function isBypassed(pathname) {
  return BYPASS_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix));
}

function isImmutableAsset(pathname) {
  return IMMUTABLE_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

function isStaticAsset(pathname) {
  return STATIC_FILES.has(pathname) || STATIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(PRECACHE.map(url => cache.add(url))))
      // Only the first install takes over at once. An update waits so the page can show
      // "A new version of Plainhand is ready"; its Reload button sends SKIP_WAITING.
      .then(() => { if (!self.registration.active) return self.skipWaiting(); }),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('plainhand-shell-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url.pathname)) return;

  // Navigations always hit the network so session state and CSRF tokens stay fresh.
  // Only fall back to the branded offline page if the network itself fails.
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

  // Fonts and icons: cache-first with background refresh.
  if (isImmutableAsset(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(request);
        const network = fetch(request).then(response => {
          if (response.ok && response.type === 'basic') cache.put(request, response.clone());
          return response;
        }).catch(() => null);
        return cached || (await network) || Response.error();
      }),
    );
    return;
  }

  // App shell JS/CSS/manifest: network-first with cache fallback for flaky mobile links.
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
