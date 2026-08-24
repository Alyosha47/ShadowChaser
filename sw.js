// sw.js — followtheshadow: offline shell + field cache.
//
// The app must work with no signal in a field, so the strategy is:
//   • CORE — app shell, map engine, fonts, basemap vectors. Precached on
//     install, fetched fresh, and nothing runs without it.
//   • DATA — Besselian elements for every century plus the two nearest path
//     centuries. Precached best-effort, second in line so the first paint
//     never waits on 20 MB of eclipse paths.
//   • Everything else same-origin is cached ON DEMAND as it is used — relief
//     tiles, other path centuries. "Plan at home online, navigate offline in
//     the field."
//
// Cache name carries BUILD, so a bump replaces the whole set atomically and
// the activate handler deletes every older cache.
//
// NOTE: this app used Cesium once. All of it — the engine entry in CORE and a
// ~130-file worker list — was still being precached long after the move to
// MapLibre, and vendor/cesium-1.121/ no longer exists, so every install fired
// ~130 doomed requests while the engine actually in use was not precached at
// all. If you see a vendor path here, check it exists.

const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = 'followtheshadow-' + VERSION;

const CORE = [
  'index.html',
  'favicon.ico',
  /* These were 'icons/icon-192.png' and 'icons/icon-512.png' until 2026-08-20 —
     NEITHER FILE HAS EVER EXISTED. The real names carry a -v1/-v2 suffix, so
     every install was precaching two 404s. `addAll` rejects atomically, so this
     could have failed the whole CORE install; it did not only because these
     sit behind the server's directory handling. Corrected, plus the banner
     mark, which the header needs offline or the ☉ replacement is a blank gap. */
  'icons/icon-192-v2.png',
  'icons/icon-512-v2.png',
  'icons/mark.png',
  'icons/mark-dark-512.png',
  'css/app.css',
  /* Every script index.html loads. cloud-average.js and the two shadow files were
     MISSING — the same failure as the Cesium entry below, in the other
     direction: shipped code the precache had never heard of. Offline, the
     cloud button did nothing and shadow-ui threw at parse. If you add a
     <script> to index.html, add it here in the same commit. */
  ...['tz_lookup','format','state','tabs','cities','search-parser','eclipse',
      'search-ui','search-list','local','details','tshirt','userlog','share','map',
      'shadow-layer','shadow-ui','url','init',
      /* The four cloud modules. NOTE these are listed as BARE NAMES and mapped to
         paths below — a rename that only rewrites 'cloud.js' in the tree does not
         touch them, and the failure is silent until someone goes offline. Renamed
         2026-08-21: cloud->cloud-average, satellite->cloud-now, imagery->cloud-photo,
         cloudbar->cloud-ui. test_hygiene now checks this list against index.html. */
      'cloud-average','cloud-now','cloud-photo','cloud-ui'].map(n => `js/${n}.js`),
  /* The map engine. These were MISSING: the app moved from Cesium to MapLibre
     but the precache list didn't, so ~1.9 MB of engine was only ever cached
     opportunistically after first use — a fresh install that went offline
     before then had no map at all. */
  'vendor/maplibre-gl-csp-5.5.0.js',
  'vendor/maplibre-gl-csp-worker-5.5.0.js',
  'vendor/maplibre-gl-5.5.0.css',
  'vendor/deck.min.js',
  ...['CormorantGaramond-Light','JetBrainsMono-Regular','JetBrainsMono-Bold','JetBrainsMono-ExtraBold'].map(n => `fonts/${n}.woff2`),
  // Basemap: single offline NE II image + vector line overlays (coast/rivers/borders/cities).
  'data/basemap/ne2_mercator.jpg',
  'data/basemap/land.geojson.gz',        /* required — the offline coastline */
  'data/basemap/countries.geojson.gz',
  'data/basemap/cities.geojson.gz',
  'data/basemap/lakes.geojson.gz',
  'data/basemap/rivers.geojson.gz',
  'data/basemap/states.geojson.gz',
  'data/index.json',
];

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

/* Cloud climatology: 12 months x 8 local-solar-time slices = 96 WebP, ~3.3 MB
   total. The layer fetches at most 16 of them for a given date, but which 16
   depends on the eclipse the user picks in the field, so precaching a subset
   would mean the layer works for some eclipses offline and not others — worse
   than either extreme. 3.3 MB is a sixth of what the two path centuries cost.
   DATA, never CORE: a missing month degrades to its neighbour (see cloud-average.js),
   so a failure here must not fail the install. */
const CLOUD = [];
for (let m = 1; m <= 12; m++)
  for (let hh = 0; hh < 24; hh += 3)
    CLOUD.push(`data/cloud/cloud_${String(m).padStart(2,'0')}_${String(hh).padStart(2,'0')}.webp`);

const DATA = [
  ...BESSELIAN,
  'data/paths/paths_1901_2000.json.gz',
  'data/paths/paths_2001_2100.json.gz',
  ...CLOUD,
];

// Precache with BOUNDED CONCURRENCY. A flat Promise.all over ~160 URLs opened as
// many sockets as the browser allowed and starved the page's own requests — that
// was the 45 s first load. Six at a time saturates the link without crowding out
// the app. `cacheMode` matters too: the shell must be fetched fresh, but the data
// blobs are immutable (their paths carry the version), so the HTTP cache is
// allowed to answer for them.
async function precache(cache, urls, cacheMode, concurrency) {
  let next = 0, ok = 0;
  async function worker() {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const r = await fetch(url, { cache: cacheMode });
        if (r.ok) { await cache.put(url, r); ok++; }
      } catch (_) {}
    }
  }
  const n = Math.min(concurrency, urls.length);
  await Promise.all(Array.from({ length: n }, worker));
  return ok;
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 1) The shell, forced fresh. Small, and nothing runs without it.
    await precache(c, CORE, 'reload', 6);

    /* 2) TAKE OVER NOW — as soon as the shell is complete and BEFORE the 20 MB
       of field data below. skipWaiting used to be the last line of this block,
       which meant the old worker stayed in control for the minutes the DATA
       precache takes on a phone. During that window a page load could be served
       PART from the old cache and PART from the new one, and a half-old set of
       scripts is not a working app: init.js from the previous build called
       buildTzSelect(), which the current tabs.js no longer defines, and the
       whole app died at parse time before first paint.
       The DATA precache continues under waitUntil after we claim; it just no
       longer holds the swap hostage. */
    await self.skipWaiting();

    // 3) Field data. Immutable, throttled, and last so the first paint never
    //    waits on 20 MB of eclipse paths.
    const ok = await precache(c, DATA, 'default', 4);
    console.log(`[SW] ${CACHE}: shell + ${ok}/${DATA.length} data files cached`);
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
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // online Esri tiles etc. → untouched

  /* sat.php IS SAME-ORIGIN, AND ITS QUERY IS ITS IDENTITY. It must never reach the
     cache-first branch below, which matches with ignoreSearch:true. Every EUMETSAT
     tile is /sat.php?s=eum&…&b=<bbox>&…; with the search ignored they all collapse
     onto ONE cache entry, so the first tile that landed was handed back for every
     other tile in the view — MapLibre then stretched that one picture into each
     cell. THAT IS PHOTO'S GRID OF IDENTICAL MAGNIFIED TILES. It survives reloads
     and the five-minute rebuild, because the entry only dies when BUILD changes,
     and it cannot reproduce in the browser rig, which registers no worker.
     The frame probe (?f=newest) shares the same key and returns TEXT, not an image,
     so whichever arrived first also poisoned the other: a probe answered with a PNG,
     or every tile answered with a timestamp and the disc rendering nothing.
     ignoreSearch STAYS for everything else — it is what makes foo.js?v=BUILD match
     cached foo.js (§12.1) — and this is a live proxy that must not be cached anyway. */
  if (/\/sat\.php$/.test(url.pathname)) return;      // live proxy → untouched, never cached

  /* Shell fallback is for HTML route navigations only. A direct navigation to a
     file with an extension (js, gz, json, png…) must return THAT file (cache-first
     below), not the shell — otherwise browsing to js/map.js offline shows index.html
     and diagnostics lie. */
  if (req.mode === 'navigate' && !/\.[a-z0-9]{2,5}$/i.test(url.pathname)) {
    e.respondWith((async function () {
      var shell = function () {
        return caches.match('index.html', { cacheName: CACHE, ignoreSearch: true });
      };
      if (navigator.onLine === false) return (await shell()) || offlinePage();
      try {
        return await Promise.race([
          fetch(req),
          new Promise(function (_, reject) {
            setTimeout(function () { reject(new Error('nav-timeout')); }, 2500);
          })
        ]);
      } catch (e) {
        return (await shell()) || offlinePage();
      }
    })());
    return;
  }

  // Cache-first; cache-on-demand for everything same-origin (relief tiles,
  // Workers/Assets, besselian/paths outside the field range). Offline misses fail quietly.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      // Offline & uncached: race the fetch against a short timer so a stray
      // asset can never hang the load; return a quiet 504 instead.
      if (navigator.onLine === false) {
        return Promise.race([
          fetch(req).catch(() => null),
          new Promise(r => setTimeout(() => r(null), 2000))
        ]).then(r => r || new Response("", { status: 504, statusText: "Offline" }));
      }
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

function offlinePage() {
  var html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>followtheshadow — offline</title><style>' +
    'html,body{margin:0;height:100%}' +
    'body{background:#0b0e14;color:#e8e6e0;display:flex;align-items:center;' +
    'justify-content:center;text-align:center;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:1.5rem}' +
    '.wrap{max-width:22rem}.sun{font-size:3rem;color:#c8a96e;text-shadow:0 0 40px rgba(200,169,110,.5)}' +
    'h1{font-size:1.15rem;font-weight:600;margin:1rem 0 .5rem;letter-spacing:.02em}' +
    'p{font-size:.95rem;line-height:1.5;color:#a8a6a0;margin:0}' +
    '</style></head><body><div class="wrap">' +
    '<div class="sun">\u2609</div><h1>followtheshadow is offline</h1>' +
    '<p>Connect to the internet once to download maps for offline use.</p>' +
    '</div></body></html>';
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
