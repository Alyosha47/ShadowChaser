// sw.js — ShadowChaser offline shell + field cache.
//
// VERSION comes from the registration URL (sw.js?v=BUILD), so the BUILD constant
// in index.html is the SINGLE version source — there is no second number to bump.
// The cache name is keyed to it; activate() deletes every other cache. Because the
// name already pins the build, lookups use {ignoreSearch:true} and precache URLs are
// query-free: a request for foo.js?v=BUILD matches the cached foo.js.
const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = 'shadowchaser-' + VERSION;

// CORE — the app shell. Atomic: if any of these fail, install fails (they are
// essential). index.json is the eclipse index that drives the list offline.
const CORE = [
  'index.html',
  'favicon.ico',
  'css/app.css',
  ...['tz_lookup','format','state','tabs','cities','search_parser','eclipse',
      'search','list','local','details','share','map','url','init'].map(n => `js/${n}.js`),
  'vendor/maplibre-gl-5.5.0.js',
  'vendor/maplibre-gl-5.5.0.css',
  'vendor/deck.min.js',
  ...['CormorantGaramond-Italic','CormorantGaramond-Light','CormorantGaramond-LightItalic',
      'CormorantGaramond-Regular','CormorantGaramond-SemiBold','JetBrainsMono-Regular']
      .map(n => `fonts/${n}.woff2`),
  // Offline globe basemap (ocean.geojson.gz is orphaned — not cached).
  'data/basemap/land.geojson.gz',
  'data/basemap/countries.geojson.gz',
  'data/basemap/lakes.geojson.gz',
  'data/basemap/rivers.geojson.gz',
  'data/basemap/cities.geojson.gz',
  'data/index.json',
];

// DATA — best-effort (a flaky / large file must NOT wipe the shell; anything that
// fails here is cached on demand later when viewed online).
//   • Besselian: ALL centuries (~9.5MB total, cheap) — makes the per-century scan
//     and local circumstances work fully offline for any eclipse, any era.
//   • Paths: the 1900–2100 field range only (~6MB/century; the full set is ~274MB).
//     Eclipses outside this range still draw their path if you viewed them online.
const BESSELIAN = [
  '-1099_-1000','-1199_-1100','-1299_-1200','-1399_-1300','-1499_-1400','-1599_-1500',
  '-1699_-1600','-1799_-1700','-1899_-1800','-1999_-1900','-199_-100','-299_-200',
  '-399_-300','-499_-400','-599_-500','-699_-600','-799_-700','-899_-800','-999_-900',
  '-99_0','1001_1100','101_200','1101_1200','1201_1300','1301_1400','1401_1500',
  '1501_1600','1601_1700','1701_1800','1801_1900','1901_2000','1_100','2001_2100',
  '201_300','2101_2200','2201_2300','2301_2400','2401_2500','2501_2600','2601_2700',
  '2701_2800','2801_2900','2901_3000','301_400','401_500','501_600','601_700',
  '701_800','801_900','901_1000',
].map(n => `data/besselian/${n}.json`);

const DATA = [
  ...BESSELIAN,
  'data/paths/paths_1901_2000.json.gz',
  'data/paths/paths_2001_2100.json.gz',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);                       // atomic — essential shell
    let data = 0;
    await Promise.all(DATA.map(async url => {   // best-effort — bulky field data
      try {
        const r = await fetch(url, { cache: 'reload' });
        if (r.ok) { await c.put(url, r); data++; }
      } catch (_) { /* offline / flaky — fill in later on demand */ }
    }));
    console.log(`[SW] ${CACHE}: shell + ${data}/${DATA.length} field-data cached`);
    await self.skipWaiting();
  })());
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
  if (url.origin !== self.location.origin) return;   // tiles, connectivity probe, APIs → untouched

  // Reload while offline: a navigation → serve the cached app shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('index.html', { cacheName: CACHE, ignoreSearch: true })
        .then(r => r || fetch(req))
    );
    return;
  }

  // Cache-first (ignoreSearch so versioned URLs match query-free cached keys);
  // cache-on-demand for the rest same-origin (besselian/paths outside the field
  // range, etc). Offline misses fail quietly instead of throwing.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => new Response('', { status: 504, statusText: 'Offline' }));
    })
  );
});
