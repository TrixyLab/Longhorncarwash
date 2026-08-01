// Bumping this name forces the activate handler below to purge every older
// cache (including any that captured a broken/blank index.html during a deploy).
const CACHE_NAME = 'longhorn-timeclock-v6';
const CORE_ASSETS = [
  './',
  './index.html',
  './index.css',
  './renderer.js',
  './supabaseConfig.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  // Activate this worker as soon as it finishes installing instead of waiting
  // for every open tab to close — so fixes reach users on their next load.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache each core asset individually so one missing/renamed file can't
      // fail the whole install (cache.addAll rejects atomically).
      Promise.all(
        CORE_ASSETS.map((url) =>
          fetch(url, { cache: 'no-cache' })
            .then((resp) => {
              if (resp.ok) return cache.put(url, resp);
            })
            .catch(() => {}),
        ),
      ),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))),
      )
      // Take control of already-open pages immediately.
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GETs. Let Supabase API calls, CDN scripts, fonts,
  // POSTs, etc. go straight to the network untouched.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.href.includes('supabase.co')) return;

  // Network-first: always prefer fresh code so a stale or corrupted cache can
  // never white-screen the app again. Only successful responses are cached, and
  // the cache is used only as an offline fallback.
  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(req).then(
          (cached) =>
            // For navigations that miss the cache while offline, fall back to the
            // app shell so the user still gets the login screen.
            cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined),
        ),
      ),
  );
});
