/* map.js — build 2026-07-08e (mobile DPR-2 cap: recover sharpness) */
/* ── Map (Cesium renderer) ───────────────────────────────────────────────
   Cesium port of the MapLibre+deck.gl renderer. Public surface is unchanged:
     initMap, forceOfflineMap, isOffline, onMapTabActivated,
     clearMapMarkers, addObserverMarker, redrawIfMapVisible
   `map` (the Cesium Viewer) and `mapReady` remain AppState-backed globals.

   Deleted vs the MapLibre version (the seam machinery — Cesium is a true
   ellipsoid, so none of it is needed):
     buildLocalStyle / seamFreeLines / densifySegment / wrapContinuous /
     gcDistance / corridorToPolygonData / updateMarkerOcclusion (depth-tested
     for free) / the antimeridian + polar-oval winding guards.
   Path polylines use ArcType.GEODESIC, so great-circle arcs are exact with no
   densification, and pole-encircling umbra ovals now fill correctly.        */

var pathCache   = {};
var pathLoading = {};   /* in-flight fetches, keyed by chunk (see loadPathChunk) */
/* Cesium data sources let us clear categories independently. */
var dsBasemap     = null;   /* land/countries/lakes/rivers/cities          */
var dsPaths       = null;   /* eclipse path geometry (per selection)        */
var dsObserver    = null;   /* observer dot + sun arrow (per click)         */
var dsGE          = null;   /* greatest-eclipse dot (per selection)         */
var _ovalEntities = [];     /* umbra ovals, toggled by camera height        */
var _clickHandler = null;
var _cityPoints   = null;   /* batched city PointPrimitiveCollection */
var _offlineLayer = null;   /* offline satellite imagery layer (faded at extreme zoom) */
var _landFill     = null;
var _vectorPrims  = [];     /* borders/rivers/lakes lines — hidden while online */
var _cityLabels   = null;

/* Viewport class. Consulted in several places, so it lives here rather than being
   recomputed as a local in each function. */
function isWide() { return window.matchMedia('(min-width: 900px)').matches; }

/* Palette — lifted verbatim from the old buildLocalStyle so the look matches. */
var COL = {
  OCEAN:  '#b8d0e8',
  LAND:   '#d4e8c8',
  BORDER: '#a0b090',
  COAST:  '#6a8870',
  RIVER:  '#90b8d8',
  CITY:   '#c8a96e',
};
var ONLINE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'; /* (probe only; online imagery is deferred polish) */

/* ── Data layer (unchanged from MapLibre version) ─────────────────────── */

var basemapData = null, basemapLoading = null;

function fetchGz(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) return null;
    var stream = r.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).json();
  }).catch(function () { return null; });
}

function loadBasemapData() {
  if (basemapData)    return Promise.resolve(basemapData);
  if (basemapLoading) return basemapLoading;
  var base = DATA_BASE + '/basemap/';
  /* With the Natural Earth II raster base we only need overlays now:
     country borders + city labels. (land/lakes/rivers come from the raster.) */
  basemapLoading = Promise.all([
    fetchGz(base + 'countries.geojson.gz?v=' + BUILD),
    fetchGz(base + 'cities.geojson.gz?v='    + BUILD),
    fetchGz(base + 'land.geojson.gz?v='      + BUILD),
    fetchGz(base + 'lakes.geojson.gz?v='     + BUILD),
    fetchGz(base + 'rivers.geojson.gz?v='    + BUILD),
  ]).then(function (r) {
    basemapData = { countries:r[0], cities:r[1], land:r[2], lakes:r[3], rivers:r[4] };
    return basemapData;
  });
  return basemapLoading;
}

/* Resolved data in `pathCache`, in-flight promise in `pathLoading`. updateMapState
   calls this twice in the same tick (once to draw, once for the popup), so without
   the in-flight cache every redraw downloaded the chunk twice. */
function loadPathChunk(entry) {
  var chunkName = entry._chunk;
  if (!chunkName) return Promise.resolve(null);
  if (pathCache[chunkName])   return Promise.resolve(pathCache[chunkName]);
  if (pathLoading[chunkName]) return pathLoading[chunkName];
  var url = DATA_BASE + '/paths/paths_' + chunkName + '.json.gz?v=' + BUILD;
  var p = fetch(url).then(function (r) {
    if (!r.ok) return null;
    var stream = r.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).json();
  }).then(function (d) {
    if (d) pathCache[chunkName] = d;
    delete pathLoading[chunkName];
    return d;
  }).catch(function (err) {
    delete pathLoading[chunkName];
    console.error('loadPathChunk failed for', chunkName, err);
    return null;
  });
  pathLoading[chunkName] = p;
  return p;
}

/* ── Connectivity + basemap state ──────────────────────────────────────────
   ONE source of truth: `_online`. We never trust navigator.onLine as a positive
   (it reports "online" in DevTools-offline and after some iOS transitions) and
   never depend on the 'offline' EVENT firing (iOS Safari frequently doesn't fire
   it on airplane mode — that was the mobile "won't switch" bug). Instead an
   active no-cors probe confirms real reachability, and its result drives Esri's
   visibility. NE2 is always the base layer underneath, so going offline is just
   "hide Esri → NE2 shows". State is applied at INIT and on change alike, so a
   fresh offline reload is handled identically to a live switch. */

var _forceOffline = false;
var _online       = (navigator.onLine !== false);   /* optimistic; the probe corrects it */
var _esriLayer    = null;
function isOffline() { return _forceOffline || !_online; }

/* Probe the real tile origin. Two iOS-specific defences, both learned the hard
   way (see #7/#8/#9):
     • TIMEOUT — an offline fetch on iOS Safari HANGS rather than rejecting. With
       no timeout the in-flight guard below would latch forever and the app could
       never flip to offline. A timeout is the only reliable "no network" signal.
     • CACHE-BUST — iOS ignores cache:'no-store' for no-cors requests and answers
       from its HTTP cache, so a cached tile made the probe report "online" while
       in airplane mode. A unique query param forces a real network attempt. */
var PROBE_URL     = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/0/0/0';
var PROBE_TIMEOUT = 3000;
var _probing = false;
function probeConnectivity() {
  if (_probing) return;                                           /* one in flight */
  if (navigator.onLine === false) { setOnline(false); return; }   /* trustworthy negative */
  _probing = true;

  var settled = false;
  function finish(up) {
    if (settled) return;
    settled = true; _probing = false;   /* ALWAYS unlocks — no deadlock path */
    setOnline(up);
  }
  var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  setTimeout(function () {
    if (ctl) { try { ctl.abort(); } catch (e) {} }
    finish(false);                       /* hung fetch ⇒ offline */
  }, PROBE_TIMEOUT);

  fetch(PROBE_URL + '?_=' + Date.now(), {
    mode: 'no-cors', cache: 'no-store', signal: ctl ? ctl.signal : undefined
  }).then(function () { finish(true); }, function () { finish(false); });
}
function setOnline(v) {
  if (v === _online) return;      /* no change → no work, no churn while stable */
  _online = v;
  applyOnlineState();
}

/* Esri visibility. On desktop a plain `show` flag is right — instant to flip and
   the tile textures are worth keeping. On MOBILE those textures must actually be
   freed: iOS has a hard renderer memory ceiling, and holding Esri's tile pyramid
   while NE2 (33 MB decoded) is loading is what crashed Safari. So on mobile we
   remove/destroy the layer and rebuild it on return, trading a moment of re-tiling
   for headroom. */
function setEsriVisible(v) {
  if (!map) return;
  if (v) {
    if (!_esriLayer) _esriLayer = makeEsriLayer();   /* create on demand — never exists while offline */
    _esriLayer.show = true;
  } else if (_esriLayer) {
    if (isWide()) { _esriLayer.show = false; }        /* desktop: keep textures, just hide */
    else { try { map.imageryLayers.remove(_esriLayer, true); } catch (e) {} _esriLayer = null; }  /* mobile: free */
  }
}

/* Borders, rivers, lake shores, city dots/labels and the land fill are OUR overlays
   for the bare NE2 raster. Esri's tiles already carry their own labels and borders,
   so online these are duplicate ink — hide them. (This is #4: they were always on.) */
function setVectorsVisible(v) {
  _vectorPrims.forEach(function (p) { if (p) { try { p.show = v; } catch (e) {} } });
  if (_cityPoints) _cityPoints.show = v;
  if (_cityLabels) _cityLabels.show = v;
  if (_landFill)   _landFill.show   = v;   /* alpha still ramps with zoom */
}

/* Apply current on/offline state to the scene. Idempotent — safe to call at
   init, on a probe change, or from the force toggle. Order matters on mobile:
   free Esri BEFORE pulling NE2 in, so the two never coexist in memory. */
/* NE2's decoded texture is ~33 MB. On mobile it's freed when online (Esri covers
   it anyway) and reloaded from cache when offline — symmetric to setEsriVisible,
   so the two big layers never both sit resident. Desktop keeps NE2 for instant
   switching. */
function setNE2Present(v) {
  if (!map) return;
  if (v) { if (window._scLoadNE2) window._scLoadNE2(); }        /* guarded: no-op if present */
  else if (_offlineLayer && !isWide()) {
    try { map.imageryLayers.remove(_offlineLayer, true); } catch (e) {}
    _offlineLayer = null;
  }
}

function applyOnlineState() {
  var off = isOffline();
  if (off) {
    setEsriVisible(false);   /* free Esri first (iOS headroom) */
    setNE2Present(true);     /* then bring NE2 in             */
    maybeBuildVectors();     /* only if already zoomed in      */
    setVectorsVisible(true);
  } else {
    setVectorsVisible(false);
    setNE2Present(false);    /* free NE2 first (mobile) */
    setEsriVisible(true);    /* then bring Esri in      */
  }
  pulseRender();          /* drive the raster⇄vector crossfade to completion         */
  redrawIfMapVisible();   /* repaint paths in the palette matching the active base    */
}

/* The offline vector overlay (whole-globe land fill + every lake/river/border
   ground-clamped and tessellated) is the single largest allocation the app makes,
   and on iOS building it WHILE loading NE2 is what killed the renderer. But it's
   only visible below ~5e5 m — at globe zoom it's invisible yet fully resident. So
   on mobile we build it lazily, only once the camera is close enough to need it,
   by which point Esri is freed and NE2 already loaded — no simultaneous spike.
   Desktop has the headroom and builds eagerly at init for instant depth. */
var VEC_BUILD_HEIGHT = 8.0e5;   /* above the 5e5 fade-in, so vectors exist before shown */
function maybeBuildVectors() {
  if (isWide()) return;                                   /* desktop: eager at init     */
  if (!isOffline() || !window._scBuildVectors) return;
  if (!map || !map.camera.positionCartographic) return;
  if (map.camera.positionCartographic.height < VEC_BUILD_HEIGHT) window._scBuildVectors();  /* idempotent */
}

/* requestRenderMode saves battery but stalls time-based animation and the first
   draw of async primitives. On a state change, pulse renders for ~1.2 s so the
   crossfade finishes and late-ready primitives paint, then fall quiet again. */
function pulseRender(ms) {
  if (!map) return;
  var end = performance.now() + (ms || 1200);
  (function tick() {
    if (!map) return;
    map.scene.requestRender();
    if (performance.now() < end) requestAnimationFrame(tick);
  })();
}

function forceOfflineMap(on) {
  _forceOffline = on;
  applyOnlineState();
  if (!on) probeConnectivity();   /* releasing the toggle → re-confirm the real state */
}

/* Wire the connectivity signals once. Events are best-effort accelerants; the
   interval is the guarantee that covers iOS airplane mode (which fires no event).
   The Esri tile-error hook (added at layer creation) makes an offline pan flip
   state instantly. All of them just call the probe — never assume. */
if (!window._scConnHook) { window._scConnHook = true;
  addEventListener('online',  probeConnectivity);
  addEventListener('offline', probeConnectivity);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) probeConnectivity();
  });
  setInterval(function () { if (!document.hidden) probeConnectivity(); }, 5000);
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function col(hex, alpha) {
  var c = Cesium.Color.fromCssColorString(hex);
  return (alpha == null) ? c : c.withAlpha(alpha);
}
/* In request-render mode, ask for a frame after any programmatic change. */
function render() { if (map) map.scene.requestRender(); }
function colBytes(rgb, a) {
  return Cesium.Color.fromBytes(rgb[0], rgb[1], rgb[2], a == null ? 255 : a);
}
/* Flatten [[lon,lat],...] → [lon,lat,lon,lat,...] for Cesium.fromDegreesArray. */
function flatten(seg) {
  var out = [];
  for (var i = 0; i < seg.length; i++) { out.push(seg[i][0], seg[i][1]); }
  return out;
}

/* ── Init ─────────────────────────────────────────────────────────────── */

var _initSeq = 0;
function initMap() {
  var savedCam = null;
  if (map) {
    try { savedCam = {
      pos:     map.camera.position.clone(),
      heading: map.camera.heading, pitch: map.camera.pitch, roll: map.camera.roll,
    }; } catch (e) {}
    try { map.destroy(); } catch (e) {}
    map = null; mapReady = false;
  }
  dsBasemap = dsPaths = dsObserver = dsGE = null;
  _ovalEntities = [];
  _offlineLayer = _landFill = null;
  /* These reference the OLD viewer's GPU resources — drop them or the next
     applyOnlineState() will poke at destroyed objects. */
  _esriLayer = _cityPoints = _cityLabels = null;
  _vectorPrims = [];

  var myseq = ++_initSeq;   /* only the latest init may build — prevents duplicate viewers from concurrent calls */
  loadBasemapData().then(function (data) {
    if (myseq !== _initSeq) return;
    createMap(data, savedCam);
  }).catch(function () {
    if (myseq !== _initSeq) return;
    createMap(null, savedCam);
  });
}

function createMap(data, savedCam) {
  var wide = isWide();

  var container = document.getElementById('map');
  if (container) container.innerHTML = '';   /* drop any orphaned canvas before building */

  map = new Cesium.Viewer('map', {
    baseLayer: false,            /* no imagery tiles — GeoJSON basemap only  */
    baseLayerPicker: false, geocoder: false, timeline: false, animation: false,
    homeButton: false, sceneModePicker: false, navigationHelpButton: false,
    fullscreenButton: false, infoBox: false, selectionIndicator: false,
    creditContainer: document.createElement('div'),   /* hide the credit bar */
    requestRenderMode: true,           /* render only on change — not every frame */
    maximumRenderTimeChange: Infinity, /* static sun: don't force time-based redraws */
    /* Resolution vs. memory. The drawing buffer and every render target scale with
       the square of the pixel ratio, so native DPR (2–3x) on a retina phone was a
       big part of the memory pressure. We keep useBrowserRecommendedResolution off
       on mobile (pixelRatio 1) and instead cap it manually at 2x below — sharp,
       but 4x the framebuffer rather than 9x. Desktop keeps full native DPR. */
    useBrowserRecommendedResolution: wide,
  });
  if (!wide) {
    map.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);   /* DPR-2 cap: sharp, bounded */
    map.scene.globe.maximumScreenSpaceError = 4;   /* coarser tiles on mobile → fewer resident */
  }
  Cesium.Ion.defaultAccessToken = undefined;

  var scene = map.scene, globe = scene.globe;
  globe.baseColor          = col('#a9c9e0');   /* ocean blue — the "water" that shows when the raster fades at extreme zoom */
  globe.showGroundAtmosphere = false;   /* haze washes out imagery — off for contrast */
  globe.enableLighting     = false;          /* day/night shading off for now */
  scene.skyAtmosphere.show = true;           /* keep the planet limb glow (cheap, pretty) */
  /* Cesium's skyBox is six 2048x2048 textures (~100 MB of GPU memory). Desktop
     can afford it; on mobile that budget is the difference between running and
     an iOS renderer kill, and starfield.js already paints stars behind the
     globe. Off on mobile. */
  scene.skyBox.show        = isWide();
  scene.sun.show           = false;          /* no sun billboard */
  scene.moon.show          = false;
  scene.backgroundColor    = col('#05070f'); /* clean dark space */
  scene.screenSpaceCameraController.enableTilt = false;  /* axis-style spin   */
  scene.msaaSamples = isWide() ? 4 : 1;   /* 4x MSAA is a big framebuffer; desktop only */
  scene.fog.enabled = false;                              /* real cost, little value on a globe */
  try { scene.postProcessStages.fxaa.enabled = true; } catch (e) {}

  /* Data sources */
  dsBasemap  = new Cesium.CustomDataSource('basemap');
  dsPaths    = new Cesium.CustomDataSource('paths');
  dsObserver = new Cesium.CustomDataSource('observer');
  dsGE       = new Cesium.CustomDataSource('ge');
  [dsBasemap, dsPaths, dsGE, dsObserver].forEach(function (d) { map.dataSources.add(d); });

  buildBasemap(data);
  try { console.log('[ShadowChaser] map built — #map canvases:', document.getElementById('map').querySelectorAll('canvas').length); } catch (e) {}

  /* At extreme offline zoom the raster is just noise, so crossfade it out and a
     flat green-land fill in — leaving crisp vectors on blue water + green land.
     Runs each render (which only happens when the camera moves). */
  /* Raster⇄vector crossfade. ONE expression, evaluated every frame with no early
     return — an early return while online was what stranded the land fill at
     full opacity over Esri (#2) and left NE2's alpha wherever it happened to be.
     `t` is the raster's opacity; the vector land fill is exactly its complement.
       online          → t=1  : NE2 opaque under Esri, land fill invisible.
       offline, far    → t=1  : NE2 shown.
       offline, close  → t=0  : NE2 gone, globe.baseColor is the ocean, fill=1. */
  scene.preRender.addEventListener(function () {
    if (!map.camera.positionCartographic) return;
    var h = map.camera.positionCartographic.height;
    var t = isOffline() ? band(h, 3.0e5, 5.0e5) : 1;
    if (_offlineLayer) _offlineLayer.alpha = t;
    if (_landFill && _landFill.appearance)
      _landFill.appearance.material.uniforms.color =
        Cesium.Color.fromCssColorString('#bcdca6').withAlpha(1 - t);
  });

  /* Camera: restore prior view across an offline/online toggle, else default. */
  if (savedCam) {
    map.camera.setView({ destination: savedCam.pos, orientation: {
      heading: savedCam.heading, pitch: savedCam.pitch, roll: savedCam.roll } });
  } else {
    map.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 30, wide ? 2.2e7 : 3.6e7),
    });
  }

  /* Click → globe pick (off-globe → clear location). */
  _clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  _clickHandler.setInputAction(function (movement) {
    var ray  = map.camera.getPickRay(movement.position);
    var cart = globe.pick(ray, scene);
    if (!cart) { if (typeof clearLocationFilter === 'function') clearLocationFilter(); return; }
    var c = Cesium.Cartographic.fromCartesian(cart);
    onMapClick(Cesium.Math.toDegrees(c.latitude), Cesium.Math.toDegrees(c.longitude));
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  /* Oval visibility by camera height (replaces the deck zoom toggle). */
  map.camera.changed.addEventListener(updateOvalVisibility);
  map.camera.changed.addEventListener(maybeBuildVectors);   /* mobile: build vectors when zoomed in */
  scene.canvas.style.cursor = 'crosshair';

  var closeBtn = document.getElementById('map-popup-close');
  if (closeBtn) closeBtn.addEventListener('click', function () {
    document.getElementById('map-popup').style.display = 'none';
  });

  mapReady = true;
}

/* Online → Esri World Street Map raster: deep street-level zoom (z19), fast CDN,
   free/no-token, street-map look close to the old MapLibre Liberty. Esri tiles
   carry their own labels/borders, so no overlays online.
   Offline → Cesium's bundled Natural Earth II raster (ships in vendor/, instant,
   no artifacts) + our own borders + English city labels, since NE II is bare. */
var ONLINE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

/* Esri layer as a factory, because on mobile we destroy and rebuild it (see
   setEsriVisible). The tile-error hook must go on every instance. */
function makeEsriLayer() {
  var prov = new Cesium.UrlTemplateImageryProvider({
    url: ONLINE_TILES, maximumLevel: 19, credit: 'Esri',
  });
  /* A tile error means Esri is unreachable → probe to confirm and flip offline
     without waiting for the interval (an offline pan then feels instant).
     Throttled: Cesium retries every failed tile, so this fires in storms. */
  var lastErrProbe = 0;
  prov.errorEvent.addEventListener(function () {
    if (_forceOffline) return;
    var now = Date.now();
    if (now - lastErrProbe < 2000) return;
    lastErrProbe = now;
    probeConnectivity();
  });
  return map.imageryLayers.addImageryProvider(prov);
}

function buildBasemap(data) {
  var scene = map.scene;
  var _wide = isWide();

  /* NE2 is the base (index 0), UNDER Esri. Desktop preloads it so an online→offline
     switch reveals it with zero latency. Mobile loads it only when actually needed —
     the decoded texture is ~33 MB and must not sit alongside Esri's tile pyramid.
     That is safe now that applyOnlineState() runs at INIT: an offline reload pulls it
     in immediately, which is what the eager mobile load was compensating for. */
  window._scLoadNE2 = function () {
    if (_offlineLayer) return;
    Cesium.SingleTileImageryProvider.fromUrl(DATA_BASE + '/basemap/ne2.jpg')
      .then(function (prov) { _offlineLayer = map.imageryLayers.addImageryProvider(prov, 0); pulseRender(); })
      .catch(function (e) { console.error('Offline NE2 image failed:', e); });
  };
  if (_wide) window._scLoadNE2();

  /* Esri is NOT created here. applyOnlineState() (below) creates it via
     setEsriVisible only when online — so an offline load never briefly allocates
     Esri's cached tiles alongside NE2 (that overlap was crashing iOS). */

  var _vecBuilt = false;
  window._scBuildVectors = function () {
  if (_vecBuilt) return;                 /* build once per viewer — no duplicate primitives */
  if (!data) { render(); return; }
  _vecBuilt = true;

  /* Green land fill (draped on the globe → no z-fighting). Starts fully
     transparent; the preRender crossfade brings it in as the raster fades. */
  _landFill = buildFill(data.land,  '#bcdca6', 0);   /* green land   */
  if (_landFill) scene.primitives.add(_landFill);

  /* Crisp vector lines over the raster — these stay sharp at any zoom (lines are
     sphere-safe on Cesium; only filled polygons caused the earlier artifacts).
     One batched PolylineCollection for all of them. */
  /* Crisp vector lines, clamped to the globe so they drape identically to the
     land fill (no parallax between line and fill edge). */
  /* Plain ellipsoid polylines, NOT GroundPolylinePrimitive. There is no terrain
     here (default ellipsoid), so ground-draping buys nothing — but it costs
     everything: GroundPolylinePrimitive builds a shadow-volume mesh per line to
     drape over terrain tiles, multiplying vertex count many-fold and tessellating
     in workers. On iOS, building that for every coastline/river/border on Earth
     is what killed the renderer. PolylineGeometry on the ellipsoid renders the
     identical result at a fraction of the memory. */
  function addLines(fc, hex, alpha, width) {
    if (!fc || !fc.features) return;
    var instances = [];
    fc.features.forEach(function (f) {
      eachLine(f.geometry, function (line) {
        if (line.length < 2) return;
        instances.push(new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: Cesium.Cartesian3.fromDegreesArray(flatten(line)),
            width: width, arcType: Cesium.ArcType.GEODESIC,
            vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
          }),
        }));
      });
    });
    if (!instances.length) return;
    _vectorPrims.push(scene.primitives.add(new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PolylineMaterialAppearance({
        material: Cesium.Material.fromType('Color', { color: col(hex, alpha) }) }),
      asynchronous: true,
    })));
  }
  /* Coast is shown by the land-fill edge itself, so no separate coastline line
     (that duplicated the country-border coast → two offset lines). */
  addLines(data.lakes,     COL.RIVER,  0.8, 1);     /* lake shores */
  addLines(data.rivers,    COL.RIVER,  0.7, 1);     /* rivers      */
  addLines(data.countries, COL.BORDER, 0.6, 1);     /* borders     */

  /* Cities: dots + English labels, thinned by rank, depth-tested (no see-through). */
  if (data.cities && data.cities.features) {
    var pts    = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    var labels = scene.primitives.add(new Cesium.BillboardCollection());
    var cityCol = col(COL.CITY), white = Cesium.Color.WHITE;
    var DOT_FAR   = { 1: 8.0e7, 2: 1.5e7, 3: 7.0e6 };
    var LABEL_FAR = { 1: 1.0e7, 2: 4.0e6, 3: 1.2e6 };   /* rank 3 names only when zoomed in close */
    data.cities.features.forEach(function (f) {
      if (!f.geometry || f.geometry.type !== 'Point') return;
      var rank = (f.properties && f.properties.rank) || 4;
      if (rank >= 4) return;
      var pos = Cesium.Cartesian3.fromDegrees(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      pts.add({
        position: pos, pixelSize: ({1:5, 2:4, 3:3})[rank] || 3,
        color: cityCol, outlineColor: white, outlineWidth: 0.5,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, DOT_FAR[rank]),
      });
      var name = f.properties && f.properties.name;
      if (name && LABEL_FAR[rank]) {
        labels.add({
          position: pos, image: labelImage(name),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(8, 0),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, LABEL_FAR[rank]),
        });   /* depth-tested by default → globe occludes far-side labels */
      }
    });
    _cityPoints = pts; _cityLabels = labels;
  }
  render();
  };   /* end _scBuildVectors */
  if (_wide) window._scBuildVectors();   /* desktop: eager. mobile: built on demand when offline */

  /* Apply the correct state NOW, at init — so an offline reload hides Esri and
     (on mobile) builds vectors immediately, not only when a later event fires.
     Then probe to correct the optimistic default. This one call is what makes a
     fresh offline load behave identically to a live online→offline switch. */
  applyOnlineState();
  probeConnectivity();
}

/* GeoJSON geometry walker: yields each line/ring as a coordinate array.
   Handles LineString, MultiLineString, and polygon rings (used for coastlines,
   lake shores, rivers, borders — all drawn as lines). */
function eachLine(geom, cb) {
  if (!geom) return;
  if (geom.type === 'LineString')        cb(geom.coordinates);
  else if (geom.type === 'MultiLineString') geom.coordinates.forEach(cb);
  else if (geom.type === 'Polygon')      geom.coordinates.forEach(cb);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(function (p) { p.forEach(cb); });
}

/* Walk polygon fills: yields a PolygonHierarchy (outer ring + holes) per polygon. */
function eachFillRing(geom, cb) {
  if (!geom) return;
  function poly(rings) {
    if (!rings || !rings.length || rings[0].length < 4) return;
    var outer = Cesium.Cartesian3.fromDegreesArray(flatten(rings[0]));
    var holes = [];
    for (var i = 1; i < rings.length; i++) {
      if (rings[i].length >= 4)
        holes.push(new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flatten(rings[i]))));
    }
    cb(new Cesium.PolygonHierarchy(outer, holes));
  }
  if (geom.type === 'Polygon')           poly(geom.coordinates);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly);
}

/* Linear ramp: 0 at h<=lo, 1 at h>=hi. */
function band(h, lo, hi) {
  if (h >= hi) return 1;
  if (h <= lo) return 0;
  return (h - lo) / (hi - lo);
}

/* Green land fill as a plain ellipsoid Primitive (no terrain, so no GroundPrimitive
   needed). Single translucent material so the crossfade is one uniform update, not
   thousands. Starts transparent; the preRender crossfade ramps its alpha with zoom. */
function buildFill(fc, hex, h) {
  if (!fc || !fc.features) return null;
  var instances = [];
  fc.features.forEach(function (f) {
    eachFillRing(f.geometry, function (hierarchy) {
      instances.push(new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({ polygonHierarchy: hierarchy, arcType: Cesium.ArcType.GEODESIC,
          height: h || 0, vertexFormat: Cesium.MaterialAppearance.MaterialSupport.BASIC.vertexFormat }),
      }));
    });
  });
  if (!instances.length) return null;
  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.MaterialAppearance({ flat: true, translucent: true,
      material: Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(hex).withAlpha(0) }) }),
    asynchronous: true,
  });
}

/* ── Tab / status (unchanged DOM) ─────────────────────────────────────── */

function onMapTabActivated() {
  if (!map || !mapReady) { initMap(); return; }
  try { map.resize(); } catch (e) {}
}

var _mapStatusTransient = null;
function setMapStatus(msg) { _mapStatusTransient = msg || null; _renderMapStatus(); }
function _renderMapStatus() {
  var el = document.getElementById('map-status');
  if (!el) return;
  var text = _mapStatusTransient || (selectedEntry
    ? fmtDate(selectedEntry) + '\u2002\u2014\u2002' + typeName((selectedEntry.eclipse_type||'P')[0])
    : null);
  if (text) { el.textContent = text; el.style.display = 'block'; }
  else      { el.style.display = 'none'; }
}

/* ── State → render (logic preserved; rendering swapped) ──────────────── */

function updateMapState() {
  if (!mapReady)      return;
  if (!selectedEntry) return;
  var isNewEclipse = (selectedEntry !== updateMapState._lastEntry);
  updateMapState._lastEntry = selectedEntry;
  clearMapLayers();
  clearMapMarkers();
  clearPathMarkers();
  var coords = parseCoords();

  setMapStatus('Loading path\u2026');
  loadPathChunk(selectedEntry).then(function (pathData) {
    var catKey = String(Math.round(selectedEntry.cat_no));
    var ep     = pathData && pathData[catKey];
    if (!ep) { setMapStatus('Path data unavailable'); return; }

    drawEclipsePath(ep);
    setMapStatus(null);

    if (isNewEclipse && !coords) {
      var ctr = null;
      if (ep.ge && ep.ge[0] != null) {
        ctr = [ep.ge[0], ep.ge[1]];
      } else {
        var pts = [];
        ['centreline','penumbra_n','penumbra_s'].forEach(function (k) {
          (ep[k] || []).forEach(function (seg) { pts = pts.concat(seg); });
        });
        if (pts.length) {
          var a = pts[0][0], lon = 0, lat = 0;
          pts.forEach(function (p) { lon += a + (((p[0]-a)%360+540)%360-180); lat += p[1]; });
          ctr = [lon / pts.length, lat / pts.length];
        }
      }
      if (ctr) flyToLonLat(ctr[0], ctr[1]);
    }
  }).catch(function () { setMapStatus('Could not load path'); });

  if (coords) {
    addObserverMarker(coords.lat, coords.lon,
      localResult && localResult.visible ? localResult.sun.az : null);
    if (localResult) {
      loadPathChunk(selectedEntry).then(function (pathData) {
        var catKey = String(Math.round(selectedEntry.cat_no));
        var ep = pathData && pathData[catKey];
        if (ep) showMapPopup(coords.lat, coords.lon, localResult, ep);
      }).catch(function(){});
    }
  } else {
    document.getElementById('map-popup').style.display = 'none';
  }
}

/* Camera helper: keep current height, recentre on lon/lat. */
function flyToLonLat(lon, lat) {
  var h = map.camera.positionCartographic.height;
  map.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, h),
    duration: 0.8,
  });
}

/* ── Markers ──────────────────────────────────────────────────────────── */

function clearMapMarkers()  { if (dsObserver) dsObserver.entities.removeAll(); render(); }
function clearPathMarkers() { if (dsGE)       dsGE.entities.removeAll(); render(); }

/* Clean text labels rendered to canvas (avoids Cesium's grainy SDF outline/box). */
var _labelCache = {};
function labelImage(text) {
  if (_labelCache[text]) return _labelCache[text];
  var font = '600 13px -apple-system, system-ui, sans-serif', pad = 4, h = 20;
  var meas = document.createElement('canvas').getContext('2d'); meas.font = font;
  var w = Math.ceil(meas.measureText(text).width) + pad * 2;
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  var x = c.getContext('2d');
  x.font = font; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,0.95)'; x.shadowBlur = 3;
  x.fillStyle = '#fff';
  x.fillText(text, pad, h / 2 + 1);
  x.fillText(text, pad, h / 2 + 1);   /* twice → denser halo for legibility */
  _labelCache[text] = c; return c;
}

/* Sun-direction marker — emulates the original DOM arrow: a fixed-size red dot
   with a thin line + arrowhead, rotated to the sun azimuth (screen-space, so it
   stays the same pixel size at any zoom). */
var _sunArrowImg = null;
function sunArrowImage() {
  if (_sunArrowImg) return _sunArrowImg;
  var c = document.createElement('canvas'); c.width = c.height = 72;
  var x = c.getContext('2d'), cx = 36, cy = 36, RED = '#cc2200';
  x.strokeStyle = RED; x.fillStyle = RED; x.lineWidth = 2; x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx, cy - 28); x.stroke();          /* shaft (points up = north) */
  x.beginPath(); x.moveTo(cx, cy - 34); x.lineTo(cx - 5, cy - 24); x.lineTo(cx + 5, cy - 24); x.closePath(); x.fill();  /* head */
  x.fillStyle = RED; x.strokeStyle = '#fff'; x.lineWidth = 2;
  x.beginPath(); x.arc(cx, cy, 5, 0, 7); x.fill(); x.stroke();                 /* observer dot */
  _sunArrowImg = c; return c;
}

function addObserverMarker(lat, lon, sunAz) {
  if (!dsObserver) return;
  var pos = Cesium.Cartesian3.fromDegrees(lon, lat);
  if (sunAz != null) {
    dsObserver.entities.add({ position: pos, billboard: {
      image: sunArrowImage(),
      rotation: Cesium.Math.toRadians(-sunAz),   /* canvas arrow points N; rotate to azimuth (CW) */
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      /* Full size up close; shrink as the camera pulls back so it doesn't dwarf
         the globe or shoot off-planet when zoomed out. */
      scaleByDistance: new Cesium.NearFarScalar(2.0e6, 1.0, 2.4e7, 0.35),
    }});
  } else {
    dsObserver.entities.add({ position: pos, point: {
      pixelSize: 10, color: col('#cc2200'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    }});
  }
  render();
}

function addGEMarker(lat, lon) {
  if (!dsGE) return;
  dsGE.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    point: { pixelSize: 8, color: col('#cc2200'),
             outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
             disableDepthTestDistance: Number.POSITIVE_INFINITY },
  });
  render();
}

/* ── Click / popup (logic preserved) ──────────────────────────────────── */

function onMapClick(lat, lon) {
  flyToLonLat(lon, lat);
  var search = document.getElementById('search');
  var f      = parseSearch(search.value);
  search.value = filterToString(Object.assign({}, f, {
    coords: { lat: lat, lon: lon }, city: null
  }));
  onSearchChanged(true);
  lookupElevationAndTz(lat, lon);
  if (eclipseIndex.length) scanLocation();

  showMapPopupLoading(lat, lon);
  computeLocal().then(function (out) {
    if (!out) return;
    showMapPopup(lat, lon, out.result, out.rec);
    clearMapMarkers();
    addObserverMarker(lat, lon, out.result.visible ? out.result.sun.az : null);
    if (window.matchMedia('(min-width: 900px)').matches) {
      if (sidebarTab === 'search') sidebarTab = 'eclipse';
    }
  });
}

function showMapPopupLoading(lat,lon) {
  var latS=lat>=0?lat.toFixed(4)+'\u00b0N':Math.abs(lat).toFixed(4)+'\u00b0S';
  var lonS=lon>=0?lon.toFixed(4)+'\u00b0E':Math.abs(lon).toFixed(4)+'\u00b0W';
  document.getElementById('map-popup-title').textContent=latS+'\u2002'+lonS;
  document.getElementById('map-popup-grid').innerHTML=
    '<span style="color:var(--text-dim)">Computing\u2026</span>';
  document.getElementById('map-popup').style.display='block';
}

function showMapPopup(lat,lon,result,rec) {
  var tz=getTzOffset();
  var tzStr=tz>=0?'UTC+'+tz:'UTC'+tz;
  var latS=lat>=0?lat.toFixed(4)+'\u00b0N':Math.abs(lat).toFixed(4)+'\u00b0S';
  var lonS=lon>=0?lon.toFixed(4)+'\u00b0E':Math.abs(lon).toFixed(4)+'\u00b0W';
  document.getElementById('map-popup-title').textContent=latS+'\u2002'+lonS;
  var grid=document.getElementById('map-popup-grid');
  if (!result.visible) {
    grid.innerHTML='<span style="color:var(--text-dim);grid-column:1/3">\uD83C\uDF11 Not visible from here</span>';
  } else {
    var lbl=typeName(result.type[0].toUpperCase());
    var rows=[
      ['Type','<span style="color:var(--gold2)">'+lbl+'</span>'],
      ['Magnitude',result.mag.toFixed(4)],
      ['Obscuration',result.osc.toFixed(1)+'%'],
      ['Maximum',fmtUT(result.tMax)+' ('+tzStr+')'],
      ['Sun alt/az',fmtAng(result.sun.alt)+' / '+fmtAng(result.sun.az)],
    ];
    if (result.durCentral) rows.push(['Duration',fmtDur(result.durCentral)]);
    if (result.C1&&result.C1.ut!=null) rows.push(['C1',fmtUT(result.C1.ut)]);
    if (result.C2&&result.C2.ut!=null) rows.push(['C2 ('+lbl+')',fmtUT(result.C2.ut)]);
    if (result.C3&&result.C3.ut!=null) rows.push(['C3 ('+lbl+')',fmtUT(result.C3.ut)]);
    if (result.C4&&result.C4.ut!=null) rows.push(['C4',fmtUT(result.C4.ut)]);
    grid.innerHTML=rows.map(function(r){
      return '<span class="map-popup-label">'+r[0]+'</span><span>'+r[1]+'</span>';
    }).join('');
  }
  document.getElementById('map-popup').style.display='block';
}

/* ── Eclipse path drawing (Cesium entities) ───────────────────────────── */

var PATH_WIDTH = 1.4;            /* solid, bright, clearly visible — no casing */

/* The two basemaps have opposite contrast needs, so the path palette is chosen
   to match whichever is active: bright over the dark satellite (offline),
   deep/saturated over the pale Esri street map (online). */
var PAL_SAT = {   /* offline satellite — bright, pops on dark ocean & varied land */
  penumbra:[120,180,255], umbraT:[245,140,30], umbraA:[80,160,255],
  ovalTline:[255,185,95], ovalAline:[140,190,255], centre:[255,60,40], green:[70,215,85],
};
var PAL_STREET = { /* online street map — deep, shows on pale/white backgrounds */
  penumbra:[28,92,205], umbraT:[200,92,0], umbraA:[18,70,175],
  ovalTline:[205,110,25], ovalAline:[40,92,200], centre:[200,26,14], green:[0,140,22],
};
var OVAL_HIDE_HEIGHT = 6.0e6;   /* hide ovals when zoomed closer than this (m) */

function clearMapLayers() {
  if (dsPaths) dsPaths.entities.removeAll();
  _ovalEntities = [];
  render();
}

/* Line width is in pixels, so a fixed width looks proportionally fat when zoomed
   out (the path shrinks, the line doesn't). Scale width down as the camera pulls
   back: full up close, ~half at globe view. */
function pathZoomScale() {
  if (!map || !map.camera || !map.camera.positionCartographic) return 1;
  var h = map.camera.positionCartographic.height;
  var t = (h - 2.0e6) / (2.4e7 - 2.0e6);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - 0.5 * t;
}
function polyline(segs, color, width, idPrefix) {
  if (!segs) return;
  var wProp = new Cesium.CallbackProperty(function () { return width * pathZoomScale(); }, false);
  segs.forEach(function (seg) {
    if (!seg || seg.length < 2) return;
    dsPaths.entities.add({ polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(flatten(seg)),
      width: wProp, material: color, arcType: Cesium.ArcType.GEODESIC, clampToGround: false,
    }});
  });
}

function drawEclipsePath(ep) {
  clearMapLayers();
  var isCentral = /[TAH]/.test(ep.type||'');
  var isTotal   = /[TH]/.test(ep.type||'');
  var P         = isOffline() ? PAL_SAT : PAL_STREET;
  var uc        = isTotal ? P.umbraT : P.umbraA;

  /* Penumbra + terminator lines. */
  ['penumbra_n','penumbra_s','terminator_first','terminator_last'].forEach(function (k) {
    if (ep[k] && ep[k].length) polyline(ep[k], colBytes(P.penumbra), PATH_WIDTH);
  });

  /* Umbra limit lines. */
  if (isCentral && ep.umbra_n && ep.umbra_s) {
    polyline(ep.umbra_n, colBytes(uc), PATH_WIDTH);
    polyline(ep.umbra_s, colBytes(uc), PATH_WIDTH);
  }

  /* Umbra ovals — now filled, INCLUDING pole-encircling rings (Cesium handles
     the polar cap; the old winding-drop guard is gone). */
  if (/[TAH]/.test(ep.type||'') && ep.umbra_ovals && ep.umbra_ovals.length) {
    var fill = isTotal ? colBytes(P.umbraT, 70)     : colBytes(P.umbraA, 70);
    var line = isTotal ? colBytes(P.ovalTline,230)  : colBytes(P.ovalAline,230);
    ep.umbra_ovals.forEach(function (r) {
      if (!r || r.length < 3) return;
      var ring = (r[0][0]===r[r.length-1][0] && r[0][1]===r[r.length-1][1]) ? r.slice(0,-1) : r;
      var e = dsPaths.entities.add({ polygon: {
        hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flatten(ring))),
        material: fill, outline: true, outlineColor: line,
        arcType: Cesium.ArcType.GEODESIC,
      }});
      _ovalEntities.push(e);
    });
    updateOvalVisibility();
  }

  /* Centreline. */
  if (isCentral && ep.centreline) polyline(ep.centreline, colBytes(P.centre), PATH_WIDTH);

  /* Green line (Maximum-on-Horizon). Split on null delimiters; the antimeridian
     guard is gone — geodesic polylines wrap correctly. */
  if (isCentral && ep.green_curve && ep.green_curve.length) {
    var gsegs = [], gcur = [];
    function flushG() { if (gcur.length > 1) gsegs.push(gcur); gcur = []; }
    ep.green_curve.forEach(function (gp) {
      if (gp === null) { flushG(); return; }
      gcur.push(gp);
    });
    flushG();
    polyline(gsegs, colBytes(P.green), PATH_WIDTH);
  }

  /* Greatest-eclipse dot. */
  if (ep.ge && ep.ge[0] != null) addGEMarker(ep.ge[1], ep.ge[0]);
  render();
}

/* Toggle oval fills off when zoomed in close (they darken the inspected spot). */
function updateOvalVisibility() {
  if (!map || !_ovalEntities.length) return;
  var show = map.camera.positionCartographic.height > OVAL_HIDE_HEIGHT;
  _ovalEntities.forEach(function (e) { e.show = show; });
  render();
}

/* ── Visibility / redraw wiring (unchanged) ───────────────────────────── */

function isMapVisible() {
  return mapReady && (activeTab === 'map' ||
                      window.matchMedia('(min-width: 900px)').matches);
}
function redrawIfMapVisible() { if (isMapVisible()) updateMapState(); }
AppState.on('selectedEntry', redrawIfMapVisible);
AppState.on('localResult',   redrawIfMapVisible);
AppState.on('mapReady',      redrawIfMapVisible);
AppState.on('activeTab',     redrawIfMapVisible);
