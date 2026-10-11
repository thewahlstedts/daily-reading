// App shell: network-first so updates show up, falling back to cache offline
// (or when the network is too slow to answer).
// Scripture and bundled Bibles: cache-first, so they work offline.
const SHELL = 'daily-reading-shell-v36';
const TEXT = 'daily-reading-text-v2';
// Bundled Bibles live outside the shell cache so app updates don't wipe them.
// Bump this when the files in bibles/ are regenerated.
const BIBLES = 'daily-reading-bibles-v2';
const SHELL_FILES = ['./', 'index.html', 'theme-init.js', 'copyright.html', 'styles.css', 'app.js', 'sync.js', 'onboarding.js', 'vendor/supabase-2.117.1.js', 'plan.txt', 'manifest.webmanifest', 'icon.svg', 'favicon.svg', 'favicon-32.png', 'icon-180.png', 'icon-512.png',
  'vendor/fonts/literata-latin-400-normal.woff2', 'vendor/fonts/literata-latin-400-italic.woff2', 'vendor/fonts/literata-latin-600-normal.woff2',
  'vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'vendor/fonts/atkinson-hyperlegible-latin-400-italic.woff2', 'vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2'];
const NETWORK_WAIT = 4000; // ms before a cached shell file is used instead of a slow network
const SLOW_SPELL = 15000;  // after that happens, use the cache right away for a while
let slowAt = 0;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, TEXT, BIBLES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve from cache when present, otherwise fetch and keep a copy.
function cacheFirst(cacheName, request) {
  return caches.open(cacheName).then(async (cache) => {
    const hit = await cache.match(request);
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
}

function networkFirst(e) {
  const { request } = e;
  const network = fetch(request, { cache: 'no-cache' }) // revalidate past the HTTP cache so updates show immediately
    .then((res) => {
      // Clone now: the page will consume the original body before an async clone would run.
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(SHELL).then((c) => c.put(request, copy)));
      }
      return res;
    });
  e.waitUntil(network.catch(() => {}));
  const cached = () => caches.match(request, { ignoreSearch: true });
  // On a weak connection, answer from the cache after a few seconds; the
  // network response still refreshes the cache for next time. Once that has
  // happened, the rest of the page load comes from the cache straight away
  // (rather than waiting on each file in turn) and stays one consistent version.
  const wait = Date.now() - slowAt < SLOW_SPELL ? 0 : NETWORK_WAIT;
  const slow = new Promise((resolve) => setTimeout(resolve, wait))
    .then(cached)
    .then((hit) => {
      if (!hit) return network;
      slowAt = Date.now();
      return hit;
    });
  return Promise.race([network, slow]).catch(() => cached().then((hit) => hit || Response.error()));
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'bible.helloao.org') {
    e.respondWith(cacheFirst(TEXT, request));
    return;
  }

  if (url.origin === self.location.origin) {
    const scope = new URL(self.registration.scope).pathname;
    e.respondWith(url.pathname.startsWith(`${scope}bibles/`) ? cacheFirst(BIBLES, request) : networkFirst(e));
  }
});
