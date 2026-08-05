// sw_cesium.js — ShadowChaser (Cesium build) offline shell + field cache.
// Parallel to sw.js; the MapLibre sw.js is left untouched. Registered by
// index.html. Cache name is namespaced so the two don't collide.
//
// Strategy:
//   • CORE  — app shell + Cesium engine entry, precached atomically.
//   • DATA  — besselian (all) + field-range paths, best-effort.
//   • CESIUM — the geometry Web Workers are PRECACHED (see the CESIUM array), so
//     an offline reload never hangs on iOS waiting for an uncached worker.
//   • The Natural Earth II texture + vector overlays are precached in CORE.
//     Online Esri street tiles are cached ON DEMAND as you pan — "plan at home
//     online, navigate offline in the field".
const VERSION = new URL(self.location).searchParams.get('v') || 'dev';
const CACHE = 'shadowchaser-cesium-' + VERSION;

const CORE = [
  'index.html',
  'favicon.ico',
  'css/app.css',
  ...['tz_lookup','format','state','tabs','cities','search_parser','eclipse',
      'search','list','local','details','userlog','share','map','url','init'].map(n => `js/${n}.js`),
  // Cesium engine entry (the geometry Workers are precached via the CESIUM array, below).
  'vendor/cesium-1.121/Build/Cesium/Cesium.js',
  'vendor/cesium-1.121/Build/Cesium/Widgets/widgets.css',
  ...['CormorantGaramond-Light','JetBrainsMono-Regular','JetBrainsMono-Bold','JetBrainsMono-ExtraBold'].map(n => `fonts/${n}.woff2`),
  // Basemap: single offline NE II image + vector line overlays (coast/rivers/borders/cities).
  'data/basemap/ne2_mercator.jpg',
  'data/basemap/countries.geojson.gz',
  'data/basemap/cities.geojson.gz',
  'data/basemap/lakes.geojson.gz',
  'data/basemap/rivers.geojson.gz',
  'data/basemap/states.geojson.gz',
  'data/index.json',
];

// Cesium engine offline set: the geometry Web Workers (so offline vector/path
// rendering never fetches an uncached worker and hangs on iOS), plus terrain
// heights (ground primitives) and the skybox. The online tiling, maki icons,
// IAU tables and wasm transcoders are intentionally omitted — unused offline.
const CESIUM = [
  'vendor/cesium-1.121/Build/Cesium/Workers/createGroundPolylineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-KWWV4RVU.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-PBGNRG6Q.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createEllipsoidGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-RJMRUTEU.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-HRFWC7QK.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-4EV7GJ63.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createPlaneGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-ICBCASTW.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-SOUC2NWT.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createCorridorGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-Q222XMQJ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-N2XWR2XU.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createTaskProcessorWorker.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-LZBOKYFJ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-445NY5UW.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createCircleOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-X46KHFRR.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-CWHIZYBJ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-TSMZMQQD.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-OJRT3POJ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-DNAJ7FJQ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/transcodeKTX2.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createSphereOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createPolylineVolumeGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-R6J5XT6F.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createEllipseOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-T7A2KFAG.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-JVYZBXN3.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-ZLLRWIEZ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createFrustumGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/combineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-22JY5A6S.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-EHR3V4Y7.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-7YNLWTJX.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-BYDXLF6R.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createVectorTilePolylines.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-ENJVJZOJ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createCorridorOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-D72SCI2M.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/upsampleQuantizedTerrainMesh.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createCoplanarPolygonGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createFrustumOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createEllipsoidOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createWallOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createBoxOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/decodeI3S.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createPlaneOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/decodeGoogleEarthEnterprisePacket.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-FIUKR7C7.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-QGHQYVPG.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createWallGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-YUEN3IE4.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-3SZ2KFIJ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-NT7I6ZTZ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-DEURJWQY.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-XTTU3BHR.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-3DTG5I3B.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createPolygonGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createCylinderOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-HBEBINZX.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-IK336IZH.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createSphereGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-UJJHFDLS.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-DJF5LDRH.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-24IRBMKK.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-5TLW6ESB.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-WCULQRSM.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-IYNU5I4P.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createVectorTileGeometries.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createEllipseGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createPolylineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createBoxGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createVectorTilePoints.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createCylinderGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createSimplePolylineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createVerticesFromGoogleEarthEnterpriseBuffer.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-VYD26DQ7.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-VCSINEK5.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/decodeDraco.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createVectorTilePolygons.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-EYOGNPU4.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-L6FQFWMZ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-BKBGSTMR.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-6RFFQXES.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createCoplanarPolygonOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createPolylineVolumeOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createRectangleGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createPolygonOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createVerticesFromHeightmap.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-IM5PR43O.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createCircleGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createVerticesFromQuantizedTerrainMesh.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-5VZC5GBZ.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-4CQNOSGA.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/chunk-HTVZCUEP.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createRectangleOutlineGeometry.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/transferTypedArrayTest.js',
  'vendor/cesium-1.121/Build/Cesium/Workers/createVectorTileClampedPolylines.js',
  'vendor/cesium-1.121/Build/Cesium/ThirdParty/Workers/z-worker-pako.js',
  'vendor/cesium-1.121/Build/Cesium/ThirdParty/Workers/pako_deflate.min.js',
  'vendor/cesium-1.121/Build/Cesium/ThirdParty/Workers/pako_inflate.min.js',
  'vendor/cesium-1.121/Build/Cesium/Assets/approximateTerrainHeights.json',
  'vendor/cesium-1.121/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mz.jpg',
  'vendor/cesium-1.121/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_my.jpg',
  'vendor/cesium-1.121/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mx.jpg',
  'vendor/cesium-1.121/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_pz.jpg',
  'vendor/cesium-1.121/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_py.jpg',
  'vendor/cesium-1.121/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_px.jpg',
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

const DATA = [
  ...BESSELIAN,
  'data/paths/paths_1901_2000.json.gz',
  'data/paths/paths_2001_2100.json.gz',
];

// Precache with BOUNDED CONCURRENCY. A flat Promise.all over ~160 URLs opened as
// many sockets as the browser allowed and starved the page's own requests — that
// was the 45 s first load. Six at a time saturates the link without crowding out
// the app. `cacheMode` matters too: the shell must be fetched fresh, but the
// vendored Cesium files and the data blobs are immutable (their paths carry the
// version), so the HTTP cache is allowed to answer for them.
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
    // 2) Engine + field data. Immutable, throttled, and second in line so the
    //    first paint never waits on 20 MB of eclipse paths.
    const rest = CESIUM.concat(DATA);
    const ok = await precache(c, rest, 'default', 4);
    console.log(`[SW] ${CACHE}: shell + ${ok}/${rest.length} engine+field files cached`);
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
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // online Esri tiles etc. → untouched

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

  // Cache-first; cache-on-demand for everything same-origin (relief tiles, Cesium
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
    '<title>ShadowChaser — offline</title><style>' +
    'html,body{margin:0;height:100%}' +
    'body{background:#0b0e14;color:#e8e6e0;display:flex;align-items:center;' +
    'justify-content:center;text-align:center;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:1.5rem}' +
    '.wrap{max-width:22rem}.sun{font-size:3rem;color:#c8a96e;text-shadow:0 0 40px rgba(200,169,110,.5)}' +
    'h1{font-size:1.15rem;font-weight:600;margin:1rem 0 .5rem;letter-spacing:.02em}' +
    'p{font-size:.95rem;line-height:1.5;color:#a8a6a0;margin:0}' +
    '</style></head><body><div class="wrap">' +
    '<div class="sun">\u2609</div><h1>ShadowChaser is offline</h1>' +
    '<p>Connect to the internet once to download maps for offline use.</p>' +
    '</div></body></html>';
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
