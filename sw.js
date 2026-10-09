// App shell: network-first so updates show up, falling back to cache offline.
// Scripture: cache-first, so any chapter you've opened works offline.
const SHELL = 'daily-reading-shell-v4';
const TEXT = 'daily-reading-text-v1';
const SHELL_FILES = ['./', 'index.html', 'styles.css', 'app.js', 'sync.js', 'vendor/supabase-2.117.1.js', 'plan.txt', 'manifest.webmanifest', 'icon.svg', 'favicon.svg', 'favicon-32.png', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== TEXT).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'bible-api.com') {
    e.respondWith(
      caches.open(TEXT).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(request, { cache: 'no-cache' }) // revalidate past the HTTP cache so updates show immediately
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }))
    );
  }
});
