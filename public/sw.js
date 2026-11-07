/**
 * MTB Router service worker (E7.1): installable PWA + offline app shell +
 * runtime caching for visited map data.
 *
 * Strategies:
 *  - app shell: hashed build assets + vendor → cache-first (immutable);
 *    index.html / navigations → network-first with cache fallback (offline)
 *  - map data (own /tiles/, OpenFreeMap basemap, elevation, glyphs/sprites):
 *    cache-first with a generous cap — visited regions stay available offline
 *    (this cache is filled by requests from the page AND the engine worker)
 *  - Overpass POSTs and Range requests: never cached
 *
 * Bump SW_VERSION when changing caching behavior; old caches are deleted on
 * activation.
 */
const SW_VERSION = 'v1';
const SHELL_CACHE = `mtbr-shell-${SW_VERSION}`;
const DATA_CACHE = `mtbr-data-${SW_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(['./', './index.html']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('mtbr-') && key !== SHELL_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // cache successful basic/CORS responses (opaque tile responses are fine too)
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match('./index.html');
    if (shell) return shell;
    throw new Error('offline and not cached');
  }
}

function isMapDataUrl(url) {
  return (
    url.hostname === 'tiles.openfreemap.org' ||
    url.hostname.includes('elevation-tiles-prod') ||
    url.pathname.includes('/tiles/') ||
    url.pathname.includes('/fonts/') ||
    url.pathname.includes('/sprites/')
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // Overpass POSTs: never cached
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!url.protocol.startsWith('http')) return;
  // Range requests (PMTiles byte serving): passthrough, never cache partials
  if (request.headers.has('range')) return;

  // map data from page + engine worker: cache-first for offline field use
  if (isMapDataUrl(url)) {
    event.respondWith(cacheFirst(request, DATA_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    // app navigations: network-first with offline shell fallback
    if (request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
      event.respondWith(networkFirst(request, SHELL_CACHE));
      return;
    }
    // hashed build assets + vendor: immutable → cache-first
    if (
      url.pathname.includes('/assets/') ||
      url.pathname.includes('/vendor/') ||
      url.pathname.includes('/icons/')
    ) {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
    }
    // everything else (e.g. tile auto-discovery probes): passthrough
  }
});
