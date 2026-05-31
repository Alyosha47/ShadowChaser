// sw.js — ShadowChaser offline shell.
// VERSION comes from the registration URL (?v=BUILD), so the BUILD constant in
// index.html is the SINGLE version source. There is no second number to bump.
const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = 'shadowchaser-' + VERSION;

// The page requests its OWN files with ?v=BUILD — precache the SAME URLs so the
// cache keys match the real requests. Vendor / fonts / data carry no ?v=.
const OWN_JS = [
  'tz_lookup', 'format', 'state', 'tabs', 'cities', 'search_parser', 'eclipse',
  'search', 'list', 'local', 'details', 'share', 'map', 'url', 'init'
].map(n => `js/${n}.js?v=${VERSION}`);

const PRECACHE = [
  'index.html',
  `css/app.css?v=${VERSION}`,
  ...OWN_JS,
  'vendor/maplibre-gl-5.5.0.js',
  'vendor/maplibre-gl-5.5.0.css',
  'vendor/deck.min.js',
  // Offline globe basemap (ocean.geojson.gz is orphaned — not cached).
  'data/basemap/land.geojson.gz',
  'data/basemap/countries.geojson.gz',
  'data/basemap/lakes.geojson.gz',
  'data/basemap/rivers.geojson.gz',
  'data/basemap/cities.geojson.gz',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                  // mutations → network, untouched
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // raster tiles + generate_204 probe → untouched

  // Reload while offline: a navigation → serve the cached app shell.
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html', { cacheName: CACHE }).then(r => r || fetch(req)));
    return;
  }

  // Cache-first for the precached shell; cache-on-demand for everything else
  // same-origin (besselian century JSONs, index.json, fonts — big, rarely all needed).
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
