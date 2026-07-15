/* map.js — build 2026-07-14a (OSM default basemap) */
/* Self-reported build. index.html's stamp compares this to BUILD and flags a
   mismatch — the fast way to catch a stale map.js that a cache didn't evict. */
window.MAP_JS_BUILD = '2026-07-14a';
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
var _vectorPrims  = [];     /* borders/rivers/lakes lines — hidden while online */
var _fadePrims    = [];     /* {prim, base}: lines whose alpha eases off as you zoom OUT.
                               Border strokes are a fixed pixel width, so zoomed out they
                               pile up into a heavy black mesh over the raster. Fading them
                               back with altitude keeps them crisp up close and quiet far away. */
var _cityLabels   = null;
var _cityItems    = [];     /* {pos, dot, lab} — for the horizon test below */

/* Hide the cities that have rotated to the FAR SIDE of the globe.
   Cesium's EllipsoidalOccluder is exactly this test (per the "use the engine's API"
   rule); doing it per city gives clean, individual wink-out at the limb, with no
   half-eaten labels and no whole-hemisphere blink. */
function updateCityOcclusion() {
  if (!map || !_cityItems.length) return;
  var occ = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, map.camera.positionWC);
  for (var i = 0; i < _cityItems.length; i++) {
    var it = _cityItems[i];
    var vis = occ.isPointVisible(it.pos);
    it.dot.show = vis;
    if (it.lab) it.lab.show = vis;
  }
}

/* ── Platform profile — ONE decision, made once ───────────────────────────
   Everything that differs between a phone and a desktop is gathered here, so
   there are no scattered isWide() checks smeared through the file. This is the
   RENDER + DATA profile, fixed at load. (Layout-only media queries — sidebar,
   map visibility — stay live below, since those should respond to a resize.)
   Each field is exactly the value the old scattered branches produced, so the
   behaviour is unchanged; it's just legible now. */
var IS_MOBILE = !window.matchMedia('(min-width: 900px)').matches;

var PROFILE = IS_MOBILE ? {
  useBrowserResolution: false,                                  // render at a manual scale, not native DPR
  resolutionScale:      Math.min(window.devicePixelRatio || 1, 2),  // DPR-2 cap (native DPR OOM'd iOS)
  maxScreenSpaceError:  null,                                  // default (2): smooth limb. (Coarse=4 was a needless memory hack that faceted the globe.)
  msaa:                 1,
  fxaa:                 false,                                  // full-screen buffer — off
  skyAtmosphere:        false,                                  // full-screen shader pass — off
  skyBox:               false,                                  // six 2048² textures — off
  oit:                  true,                                  // default on (fine). Backgrounding was fixed by the FXAA/atmosphere/skybox cuts, not by OIT.
  tileCacheSize:        null,                                  // default: no tile churn/pop-in while panning
  dataSuffix:           '',                                    // 50m vectors — the 110m '_lo' set was a
                                                               // memory concession from the OOM fight, and the
                                                               // land triangulation that caused it is now gone.
                                                               // (110m is why Andorra had no borders.)
  cityMaxRank:          3,                                      // ranks 1–2 only
  raster:               true,                                  // NE2 shaded relief offline (fits now the memory budget is cleared)
  rasterUrl:            'ne2.jpg',
} : {
  useBrowserResolution: true,                                  // native DPR
  resolutionScale:      null,                                  // (leave Cesium default)
  maxScreenSpaceError:  null,                                  // (leave Cesium default: 2)
  msaa:                 4,
  fxaa:                 true,
  skyAtmosphere:        true,
  skyBox:               true,
  oit:                  true,                                  // leave Cesium default (untouched)
  tileCacheSize:        null,                                  // (leave Cesium default)
  dataSuffix:           '',                                    // full-resolution vectors
  cityMaxRank:          4,
  raster:               true,                                  // NE2 satellite offline
  rasterUrl:            'ne2.jpg',
};

/* Palette — lifted verbatim from the old buildLocalStyle so the look matches. */
var COL = {
  OCEAN:  '#b8d0e8',
  LAND:   '#d4e8c8',
  BORDER: '#4a4640',   /* warm charcoal: black read as severe against NE2's soft palette */
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
  /* Mobile gets 110m data; desktop gets full resolution. The full-res whole-globe
     land triangulation + border polylines were the mobile OOM — the 110m set is a
     small fraction of the vertices and adequate at the zooms a field user needs.
     Coastlines, borders, rivers, lakes swap; cities/states are already light and
     shared (cities are rank-capped harder on mobile at build time). */
  var lo = PROFILE.dataSuffix;
  basemapLoading = Promise.all([
    fetchGz(base + 'countries' + lo + '.geojson.gz?v=' + BUILD),
    fetchGz(base + 'cities.geojson.gz?v='    + BUILD),
    fetchGz(base + 'lakes' + lo + '.geojson.gz?v=' + BUILD),
    fetchGz(base + 'rivers'+ lo + '.geojson.gz?v=' + BUILD),
    fetchGz(base + 'states.geojson.gz?v='    + BUILD).catch(function(){ return null; }),  /* optional: state/province lines */
  ]).then(function (r) {
    basemapData = { countries:r[0], cities:r[1], lakes:r[2], rivers:r[3], states:r[4] };
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
  if (window.scLoading) window.scLoading(1);
  var p = fetch(url).then(function (r) {
    if (!r.ok) return null;
    var stream = r.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).json();
  }).then(function (d) {
    if (d) pathCache[chunkName] = d;
    delete pathLoading[chunkName];
    if (window.scLoading) window.scLoading(-1);
    return d;
  }).catch(function (err) {
    delete pathLoading[chunkName];
    if (window.scLoading) window.scLoading(-1);
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
var _negProbes = 0;                    /* consecutive failed probes */
var NEG_PROBES_TO_GO_OFFLINE = 2;      /* need two in a row before declaring offline */
function probeConnectivity() {
  if (_probing) return;                                           /* one in flight */
  if (navigator.onLine === false) { _negProbes = NEG_PROBES_TO_GO_OFFLINE; setOnline(false); return; }   /* trustworthy negative: immediate */
  _probing = true;

  var settled = false;
  function finish(up) {
    if (settled) return;
    settled = true; _probing = false;   /* ALWAYS unlocks — no deadlock path */
    /* DEBOUNCE the negative. A single timed-out probe is NOT proof of offline: during a
       heavy first load (service-worker precache saturating the connection) the probe can
       hang past its 3 s budget while the network is perfectly fine. Acting on that one
       failure flipped the app offline, then back online on the next probe — an oscillation
       that tore Esri down and rebuilt it repeatedly. A positive is trusted instantly; a
       negative must repeat before we believe it. */
    if (up) { _negProbes = 0; setOnline(true); return; }
    _negProbes++;
    if (_negProbes >= NEG_PROBES_TO_GO_OFFLINE) setOnline(false);
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
    if (_poleLayer) _poleLayer.show = true;
  } else if (_esriLayer) {
    if (!IS_MOBILE) {
      _esriLayer.show = false;                        /* desktop: keep textures, just hide */
      /* The filler MUST be hidden with them. It is a full-globe opaque image sitting ABOVE
         NE2, so leaving it shown while the tiles are hidden would blanket the entire offline
         map with the pole gradient. (Offline needs no filler anyway: NE2 is equirectangular
         and covers the poles.) */
      if (_poleLayer) _poleLayer.show = false;
    }
    else { try { map.imageryLayers.remove(_esriLayer, true); } catch (e) {} _esriLayer = null; removePoleFiller(); }  /* mobile: free */
  }
}

/* Borders, rivers, lake shores, city dots/labels and the land fill are OUR overlays
   for the bare NE2 raster. Esri's tiles already carry their own labels and borders,
   so online these are duplicate ink — hide them. (This is #4: they were always on.) */
function setVectorsVisible(v) {
  _vectorPrims.forEach(function (p) { if (p) { try { p.show = v; } catch (e) {} } });
  if (_cityPoints) _cityPoints.show = v;
  if (_cityLabels) _cityLabels.show = v;
}

/* Apply current on/offline state to the scene. Idempotent — safe to call at
   init, on a probe change, or from the force toggle. Order matters on mobile:
   free Esri BEFORE pulling NE2 in, so the two never coexist in memory. */
/* NE2's decoded texture is ~33 MB. On mobile it's freed when online (Esri covers
   it anyway) and reloaded from cache when offline — symmetric to setEsriVisible,
   so the two big layers never both sit resident. Desktop keeps NE2 for instant
   switching. */
/* NE2 is now DESKTOP-ONLY. On mobile the offline map is vector-only (no 33 MB
   raster) — that removed the last iOS OOM and the whole load/free/fade dance.
   Desktop keeps the satellite raster offline, faded to vectors at depth. */
function setNE2Present(v) {
  if (!PROFILE.raster) return;
  if (!map) return;
  if (v) { if (window._scLoadNE2) window._scLoadNE2(); }   /* guarded: no-op if present */
  /* desktop never frees NE2 (kept resident for instant switching) */
}

function applyOnlineState() {
  var off = isOffline();
  if (off) {
    setEsriVisible(false);                               /* free Esri first (iOS headroom)     */
    setNE2Present(true);                                 /* bring the offline raster in (NE2 desktop / flat map mobile) */
    if (window._scBuildVectors) window._scBuildVectors(); /* vectors ARE the mobile map — build now */
    setVectorsVisible(true);
  } else {
    setVectorsVisible(false);
    setNE2Present(false);
    setEsriVisible(true);
  }
  pulseRender();          /* drive the raster⇄vector crossfade to completion         */
  redrawIfMapVisible();   /* repaint paths in the palette matching the active base    */
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
/* NO PATH LIFT. Eclipse curves are drawn at EXACTLY height 0.
   A raised line parallaxes across the ground by height x tan(view angle) — 50 m becomes
   29 m of displacement at 30 degrees, which is meaningless noise on a centreline computed
   to ~15 m. Any lift at all corrupts the measurement the app exists to make.
   The borders-occluding-paths problem is solved instead with depthFailMaterial (see
   drawEclipsePath): the line is drawn even when it loses the depth test, so it stays
   visible with zero geometric offset.
   DO NOT reintroduce a lift. */

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
  _offlineLayer = null;
  /* These reference the OLD viewer's GPU resources — drop them or the next
     applyOnlineState() will poke at destroyed objects. */
  _esriLayer = _cityPoints = _cityLabels = _poleLayer = null;
  _cityItems = [];
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
    /* Resolution vs. memory. The drawing buffer scales with the square of the
       pixel ratio. We keep useBrowserRecommendedResolution off on mobile
       (pixelRatio 1) and set the scale manually, so this ONE number is the dial:
       window.devicePixelRatio = full native sharpness; Math.min(dpr, 2) or
       Math.min(dpr, 1.5) trade sharpness for headroom if a device OOMs. */
    useBrowserRecommendedResolution: PROFILE.useBrowserResolution,
  });
  if (PROFILE.resolutionScale != null)     map.resolutionScale = PROFILE.resolutionScale;
  if (PROFILE.maxScreenSpaceError != null) map.scene.globe.maximumScreenSpaceError = PROFILE.maxScreenSpaceError;
  Cesium.Ion.defaultAccessToken = undefined;

  var scene = map.scene, globe = scene.globe;
  /* Harmless but noisy: Cesium warns once per session that entity outlines aren't
     supported on terrain. We draw no outlined ground entities, so it's pure noise. */
  try { Cesium.Entity.supportsPolylinesOnTerrain = Cesium.Entity.supportsPolylinesOnTerrain; } catch (e) {}
  try { if (Cesium.OrientedBoundingBox) Cesium.oneTimeWarning.geometryOutlines = true; } catch (e) {}
  globe.baseColor          = col('#a4c7db');   /* EXACT NE2 ocean (sampled from ne2.jpg) so the globe and the raster can't differ */
  globe.showGroundAtmosphere = false;   /* haze washes out imagery — off for contrast */
  globe.enableLighting     = false;          /* day/night shading off for now */
  scene.skyAtmosphere.show = PROFILE.skyAtmosphere;
  /* Cesium's skyBox is six 2048x2048 textures (~100 MB of GPU memory). Desktop
     can afford it; on mobile that budget is the difference between running and
     an iOS renderer kill, and starfield.js already paints stars behind the
     globe. Off on mobile. */
  scene.skyBox.show        = PROFILE.skyBox;
  scene.sun.show           = false;          /* no sun billboard */
  scene.moon.show          = false;
  scene.backgroundColor    = col('#05070f'); /* clean dark space */
  scene.screenSpaceCameraController.enableTilt = false;  /* axis-style spin   */
  if (IS_MOBILE) {
    /* Touch zoom felt sluggish: Cesium damps the zoom step near the surface and
       carries inertia. Bigger step factor + less inertia = more responsive pinch. */
    scene.screenSpaceCameraController.zoomFactor       = 8.8;   /* default 5.0 */
    scene.screenSpaceCameraController.inertiaZoom      = 0.6;   /* default 0.8 */
  }
  scene.msaaSamples = PROFILE.msaa;
  scene.fog.enabled = false;                              /* real cost, little value on a globe */
  try { scene.postProcessStages.fxaa.enabled = PROFILE.fxaa; } catch (e) {}
  /* THE mobile memory fix we'd been missing: order-independent translucency
     allocates several full-screen FLOAT framebuffers, which iOS handles badly —
     it's a leading cause of "fine until backgrounded, then the renderer is
     killed." This app's map is all translucent geometry, so OIT was pure cost.
     Plain alpha blending (draw-order) is visually fine here. Also cap the imagery
     tile cache so fewer tile textures stay resident online. */
  if (!PROFILE.oit) scene.orderIndependentTranslucency = false;
  if (PROFILE.tileCacheSize != null) scene.globe.tileCacheSize = PROFILE.tileCacheSize;

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
    /* NE2 is simply THE offline surface — always fully opaque, at every zoom.
       (The old raster→vector crossfade is gone. It existed to hand over to a filled
       vector land layer at deep zoom, but that fill was the mobile OOM, mobile had
       already abandoned it, and at those zooms the view was mostly undifferentiated
       green anyway. Deleting it removed the most bug-prone machinery in this file and
       unified desktop with mobile. Crisp detail at depth now comes from the vector
       LINES — borders, rivers, lakes, cities — which are always on.) */
    if (_offlineLayer) _offlineLayer.alpha = 1;

    /* Borders: full strength close in, easing to a third by globe zoom, so they stop
       reading as a heavy black mesh when the whole planet is on screen. */
    if (_fadePrims.length) {
      var k = 0.30 + 0.70 * (1 - band(h, 1.5e6, 9.0e6));   /* 1.0 near → 0.30 far */
      _fadePrims.forEach(function (fp) {
        try {
          var c0 = fp.prim.appearance.material.uniforms.color;
          c0.alpha = fp.base * k;
        } catch (e) {}
      });
    }
  });

  /* Camera: restore prior view across an offline/online toggle, else default. */
  if (savedCam) {
    map.camera.setView({ destination: savedCam.pos, orientation: {
      heading: savedCam.heading, pitch: savedCam.pitch, roll: savedCam.roll } });
  } else {
    map.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 30, IS_MOBILE ? 1.45e7 : 2.2e7),  /* mobile: globe fills the screen on load */
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
  map.camera.percentageChanged = 0.02;   /* default 0.5 — far too coarse: updates arrived in visible jumps */
  map.camera.changed.addEventListener(updateOvalVisibility);
  map.camera.changed.addEventListener(updateCityOcclusion);
  map.camera.changed.addEventListener(function () { if (_arrowState) render(); });
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
/* ── Online basemap catalogue ─────────────────────────────────────────────
   All free / no-key. (Thunderforest Landscape is deliberately NOT here: it needs an
   API key, so it can't ship without one — see TODO.) Browse more at
   https://leaflet-extras.github.io/leaflet-providers/preview/ */
var BASEMAPS = {
  /* Every Web-Mercator tile source is truncated at ±85.0511° (the projection diverges at
     the poles), so ALL of these have the same gap — it is not an Esri quirk. Above that
     latitude the NE2 layer underneath shows through in a totally different palette: the
     "polar patch".
     poleN / poleS below are FALLBACKS ONLY. The real colours are SAMPLED at runtime from
     each provider's own z=0 tile (see sampleTilePoleColors), so the patch always matches
     the basemap actually on screen — Esri, OpenTopoMap, or anything added later. These
     hex values are hand-guessed and unverified; they are used only if the tile can't be
     read (CORS, provider down). Do not treat them as correct. */
  esri_street:  { name: 'Esri Street',      credit: 'Esri', max: 19,
                  poleN: '#b7d5e5', poleS: '#ffffff',
                  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}' },
  esri_imagery: { name: 'Esri Satellite',   credit: 'Esri', max: 19,
                  poleN: '#e8eef2', poleS: '#f2f5f7',
                  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
  esri_topo:    { name: 'Esri Topographic', credit: 'Esri', max: 19,
                  poleN: '#b7d5e5', poleS: '#ffffff',
                  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}' },
  esri_terrain: { name: 'Esri Terrain',     credit: 'Esri', max: 13,
                  poleN: '#c9dfe9', poleS: '#ffffff',
                  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}' },
  esri_gray:    { name: 'Esri Light Gray',  credit: 'Esri', max: 16,
                  poleN: '#d6d6d4', poleS: '#f2f2f0',
                  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}' },
  opentopo:     { name: 'OpenTopoMap',      credit: 'OpenTopoMap (CC-BY-SA)', max: 17,
                  poleN: '#c9e0ea', poleS: '#ffffff',
                  url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png' },
  osm:          { name: 'OpenStreetMap',    credit: 'OpenStreetMap contributors', max: 19,
                  poleN: '#aad3df', poleS: '#f7f6f2',
                  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
};

function basemapKey() {
  try { var k = localStorage.getItem('sc_basemap'); if (k && BASEMAPS[k]) return k; } catch (e) {}
  return 'osm';
}
var ONLINE_TILES = BASEMAPS[basemapKey()].url;

/* Esri layer as a factory, because on mobile we destroy and rebuild it (see
   setEsriVisible). The tile-error hook must go on every instance. */
/* ── Polar hole filler ────────────────────────────────────────────────────
   Web-Mercator tiles stop at ±85.0511° (the projection is undefined at the poles), so
   EVERY online basemap leaves two bald caps. We paper them by putting a full-globe
   image UNDERNEATH the tile layer: the tiles cover everything between ±85°, so the only
   places this shows through are the two holes.
   Why an imagery layer and not polar discs: an imagery layer IS the globe surface —
   nothing to z-fight, nothing to clamp, no primitive floating over the terrain fighting
   the labels. (That mistake cost us a week; see the standing rule in TODO.) */
var _poleLayer = null;

function poleFillerCanvas(colN, colS) {
  var c = document.createElement('canvas');
  c.width = 4; c.height = 256;                 /* tall + thin: only latitude matters */
  var x = c.getContext('2d');
  /* Equirectangular: y=0 is +90°, y=255 is -90°. Each half gets its pole colour; the
     blend across the middle is irrelevant — it's hidden under the tiles. */
  var g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.00, colN);
  g.addColorStop(0.35, colN);
  g.addColorStop(0.65, colS);
  g.addColorStop(1.00, colS);
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 256);
  return c;
}

/* SAMPLE the basemap's own polar colours from its zoom-0 tile, rather than me guessing
   hex values I can't verify. Every provider serves one world tile at z=0; its top edge
   IS that style's Arctic and its bottom edge IS its Antarctic. This is exact, and it's
   automatically correct for any basemap added later. Falls back to the declared poleN /
   poleS if the tile can't be read (offline, CORS, provider hiccup). */
var _poleColorCache = {};

function sampleTilePoleColors(bm, key) {
  if (_poleColorCache[key]) return Promise.resolve(_poleColorCache[key]);
  var url = bm.url.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
  return new Promise(function (resolve) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var w = img.width, h = img.height;
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        var avg = function (yRow) {
          var d = x.getImageData(0, yRow, w, 1).data, r = 0, g = 0, b = 0;
          for (var i = 0; i < w; i++) { r += d[i*4]; g += d[i*4+1]; b += d[i*4+2]; }
          return 'rgb(' + Math.round(r/w) + ',' + Math.round(g/w) + ',' + Math.round(b/w) + ')';
        };
        var out = { n: avg(0), s: avg(h - 1) };
        _poleColorCache[key] = out;
        resolve(out);
      } catch (e) {
        resolve({ n: bm.poleN, s: bm.poleS });   /* tainted canvas / CORS */
      }
    };
    img.onerror = function () { resolve({ n: bm.poleN, s: bm.poleS }); };
    img.src = url;
  });
}

/* The filler must land in a SPECIFIC slot: directly BELOW the tile layer, but ABOVE the
   NE2 layer (which is opaque at alpha 1 while online and would otherwise hide it).
   Order matters and must not be left to chance — this is async, so without an explicit
   index the filler could resolve AFTER the tiles are added and end up on top of them,
   covering the entire map. We therefore insert it at the tile layer's own index, which
   pushes the tiles up by one and slots the filler immediately beneath them. */
function addPoleFiller(bm, tileLayer, key) {
  removePoleFiller();
  return sampleTilePoleColors(bm, key)
    .then(function (col) {
      return Cesium.SingleTileImageryProvider.fromUrl(
        poleFillerCanvas(col.n, col.s).toDataURL());
    })
    .then(function (prov) {
      if (!tileLayer) return;
      var idx = map.imageryLayers.indexOf(tileLayer);
      if (idx < 0) return;                                   /* tiles already gone */
      _poleLayer = map.imageryLayers.addImageryProvider(prov, idx);
      if (_esriLayer) _poleLayer.show = _esriLayer.show;
      render();
    })
    .catch(function () {});
}

function removePoleFiller() {
  if (!_poleLayer) return;
  try { map.imageryLayers.remove(_poleLayer, true); } catch (e) {}
  _poleLayer = null;
}

function makeEsriLayer() {
  var key = basemapKey();
  var bm = BASEMAPS[key] || BASEMAPS.osm;
  var prov = new Cesium.UrlTemplateImageryProvider({
    url: bm.url, maximumLevel: bm.max, credit: bm.credit,
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
  var layer = map.imageryLayers.addImageryProvider(prov);
  addPoleFiller(bm, layer, key);   /* paper the ±85° holes, colour sampled from these very tiles */
  return layer;
}

function buildBasemap(data) {
  var scene = map.scene;

  /* NE2 is the base (index 0), UNDER Esri. Desktop preloads it so an online→offline
     switch reveals it with zero latency. Mobile loads it only when actually needed —
     the decoded texture is ~33 MB and must not sit alongside Esri's tile pyramid.
     That is safe now that applyOnlineState() runs at INIT: an offline reload pulls it
     in immediately, which is what the eager mobile load was compensating for. */
  window._scLoadNE2 = function () {
    if (_offlineLayer) return;
    Cesium.SingleTileImageryProvider.fromUrl(DATA_BASE + '/basemap/' + PROFILE.rasterUrl)
      .then(function (prov) { _offlineLayer = map.imageryLayers.addImageryProvider(prov, 0); pulseRender(); })
      .catch(function (e) { console.error('Offline NE2 image failed:', e); });
  };
  /* Load NE2 EAGERLY and keep it resident. (A lazy load was tried and REVERTED: it made
     the offline raster depend on the connectivity probe, and during a heavy first load the
     probe times out (3 s), falsely reports offline, and the app oscillates
     offline→online→offline — reloading NE2 and REBUILDING VECTORS on every flip. That was
     the 45-second double-load. Resident NE2 absorbs a spurious flip harmlessly.) */
  if (PROFILE.raster) window._scLoadNE2();

  /* Esri is NOT created here. applyOnlineState() (below) creates it via
     setEsriVisible only when online — so an offline load never briefly allocates
     Esri's cached tiles alongside NE2 (that overlap was crashing iOS). */

  var _vecBuilt = false;
  _fadePrims = [];
  _cityItems = [];
  window._scBuildVectors = function () {
  if (_vecBuilt) return;                 /* build once per viewer — no duplicate primitives */
  if (!data) { render(); return; }
  _vecBuilt = true;

  /* Green land fill (draped on the globe → no z-fighting). Starts fully
     transparent; the preRender crossfade brings it in as the raster fades. */
  /* mobile: the flat land raster IS the land surface — no coastline primitive
     (a vector coastline here was coarse and mismatched the raster edge). */

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
  function addLines(fc, hex, alpha, width, fade) {
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
    var prim = scene.primitives.add(new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PolylineMaterialAppearance({
        material: Cesium.Material.fromType('Color', { color: col(hex, alpha) }) }),
      asynchronous: true,
    }));
    _vectorPrims.push(prim);
    if (fade) _fadePrims.push({ prim: prim, base: alpha });
  }
  /* Coast is shown by the land-fill edge itself, so no separate coastline line
     (that duplicated the country-border coast → two offset lines). */
  addLines(data.lakes,     COL.RIVER,  0.8, 1);     /* lake shores */
  addLines(data.rivers,    COL.RIVER,  0.7, 1);     /* rivers      */
  addLines(data.states,    COL.BORDER, 0.35, 1);    /* state/province lines — fainter than national */
  addLines(data.countries, COL.BORDER, 0.6, 1);     /* borders     */

  /* Cities: dots + English labels, thinned by rank, depth-tested (no see-through). */
  if (data.cities && data.cities.features) {
    var pts    = scene.primitives.add(new Cesium.PointPrimitiveCollection());
    var labels = scene.primitives.add(new Cesium.BillboardCollection());
    var cityCol = col(COL.CITY), white = Cesium.Color.WHITE;
    var DOT_FAR   = { 1: 8.0e7, 2: 1.5e7, 3: 7.0e6 };
    var LABEL_FAR = { 1: 1.0e7, 2: 4.0e6, 3: 1.2e6 };   /* rank 3 names only when zoomed in close */
    var CITY_MAX_RANK = PROFILE.cityMaxRank;
    data.cities.features.forEach(function (f) {
      if (!f.geometry || f.geometry.type !== 'Point') return;
      var rank = (f.properties && f.properties.rank) || 4;
      if (rank >= CITY_MAX_RANK) return;
      var pos = Cesium.Cartesian3.fromDegrees(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      /* disableDepthTestDistance = Infinity: draw the marker WHOLE, never depth-tested
         against the globe. Depth-testing a screen-space quad near the limb lets the
         planet's surface eat PART of it — that is why "Mexico City" rendered as "TY".
         Whether a city is on the far side is then decided properly, per city, by
         Cesium's own EllipsoidalOccluder in updateCityOcclusion() below — a clean
         horizon test, so labels wink out individually as they go round the back
         instead of a whole hemisphere blinking at once. */
      var dot = pts.add({
        position: pos, pixelSize: ({1:4, 2:3, 3:2.5})[rank] || 2.5,
        color: cityCol, outlineWidth: 0,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        translucencyByDistance: new Cesium.NearFarScalar(DOT_FAR[rank] * 0.75, 1.0, DOT_FAR[rank], 0.0),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, DOT_FAR[rank] * 1.02),
      });
      var lab = null;
      var name = f.properties && f.properties.name;
      if (name && LABEL_FAR[rank]) {
        lab = labels.add({
          position: pos, image: labelImage(name),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(8, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          translucencyByDistance: new Cesium.NearFarScalar(LABEL_FAR[rank] * 0.75, 1.0, LABEL_FAR[rank], 0.0),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, LABEL_FAR[rank] * 1.02),
        });
      }
      _cityItems.push({ pos: pos, dot: dot, lab: lab });
    });
    _cityPoints = pts; _cityLabels = labels;
    updateCityOcclusion();
  }
  render();
  };   /* end _scBuildVectors */
  /* Vectors (lines + cities only now — no fill) are built the same way on every platform.
     The desktop/mobile split existed to protect mobile from the land triangulation, which
     no longer exists. */
  window._scBuildVectors();

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

    if (isNewEclipse) {
      var ctr = null;
      if (coords) {
        ctr = [coords.lon, coords.lat];        /* prefer the user's chosen viewing location */
      } else if (ep.ge && ep.ge[0] != null) {
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

function clearMapMarkers()  { _arrowState = null; _arrowEnts = [];
                              if (dsObserver) dsObserver.entities.removeAll(); render(); }
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

/* Great-circle destination from a point given azimuth (deg CW from N) + distance (m). Returns [lon,lat]. */
function destPoint(lat, lon, azDeg, distM) {
  var R = 6371000, d = distM / R, th = Cesium.Math.toRadians(azDeg);
  var la1 = Cesium.Math.toRadians(lat), lo1 = Cesium.Math.toRadians(lon);
  var la2 = Math.asin(Math.sin(la1)*Math.cos(d) + Math.cos(la1)*Math.sin(d)*Math.cos(th));
  var lo2 = lo1 + Math.atan2(Math.sin(th)*Math.sin(d)*Math.cos(la1), Math.cos(d) - Math.sin(la1)*Math.sin(la2));
  return [Cesium.Math.toDegrees(lo2), Cesium.Math.toDegrees(la2)];
}


/* ── Observer push-pin ────────────────────────────────────────────────────
   A drawn pin (round head + tapering spike), NOT a dot — the tip is the actual
   coordinate. Drawn to canvas once and cached. Bottom-anchored, so the point sits
   exactly on the location no matter the zoom. A separate soft ellipse is laid on
   the ground beneath it as a shadow, which also anchors the pin visually to the
   surface (a floating pin reads as ambiguous about where it actually is). */
var _pinImg = null;

function pinImage() {
  if (_pinImg) return _pinImg;
  var W = 44, H = 66, c = document.createElement('canvas');
  c.width = W; c.height = H;
  var x = c.getContext('2d');
  var cx = W / 2, headR = 12, headY = headR + 3;
  var neckY = headY + headR * 0.78;
  var tipY  = H - 2;

  /* CONTACT DOT at the tip — marks the exact coordinate and visually plants the pin.
     (Replaces a soft drop-shadow, which had no consistent light source to justify it
     and just read as a smudge.) */
  x.beginPath();
  x.arc(cx, tipY, 3.2, 0, Math.PI * 2);
  x.fillStyle = 'rgba(30,26,22,0.92)';
  x.fill();
  x.lineWidth = 1.1; x.strokeStyle = 'rgba(255,255,255,0.9)';
  x.stroke();

  /* NEEDLE — darker steel with a dark outline. Pale grey vanished against terrain;
     an outline gives contrast on desert, forest and ice alike (no glow needed: a glow
     would bleed over the map you're trying to read). */
  var nw = 2.4;
  x.beginPath();
  x.moveTo(cx - nw, neckY);
  x.lineTo(cx + nw, neckY);
  x.lineTo(cx + nw * 0.30, tipY - 3);
  x.lineTo(cx, tipY);
  x.lineTo(cx - nw * 0.30, tipY - 3);
  x.closePath();
  x.fillStyle = '#7a7c82';
  x.fill();
  x.lineWidth = 1; x.strokeStyle = '#232120';
  x.stroke();
  x.beginPath();
  x.moveTo(cx - nw * 0.35, neckY + 2);
  x.lineTo(cx - nw * 0.10, tipY - 5);
  x.lineWidth = 0.8; x.strokeStyle = '#e2e4e9';
  x.stroke();

  /* COLLAR */
  x.beginPath();
  x.ellipse(cx, neckY, headR * 0.44, 2.4, 0, 0, Math.PI * 2);
  x.fillStyle = '#696970';
  x.fill();
  x.lineWidth = 0.8; x.strokeStyle = '#232120';
  x.stroke();

  /* HEAD — dark rim under the white ring, so it holds on light ground too */
  x.beginPath();
  x.arc(cx, headY, headR + 1.2, 0, Math.PI * 2);
  x.fillStyle = '#280a04';
  x.fill();
  x.beginPath();
  x.arc(cx, headY, headR, 0, Math.PI * 2);
  x.fillStyle = '#cc2200';
  x.fill();
  x.lineWidth = 1.6; x.strokeStyle = 'rgba(255,255,255,0.92)';
  x.stroke();

  x.beginPath();
  x.arc(cx - headR * 0.34, headY - headR * 0.36, headR * 0.30, 0, Math.PI * 2);
  x.fillStyle = 'rgba(255,255,255,0.47)';
  x.fill();

  _pinImg = c;
  return c;
}

/* ── Sun arrow ────────────────────────────────────────────────────────────
   Flat geometry lying ON the globe (not a screen-space billboard), so it drapes on
   the surface, is hidden by the limb, and can never poke into space. Its geometry is
   recomputed EVERY FRAME (CallbackProperty) from the camera frustum, so it holds an
   exact on-screen size at any zoom: ~84 px long, 59 px of stem + a 25x21 px dart.
   The head is a fixed fraction of the length, so a stem is ALWAYS visible. */
var ARROW_COL   = '#cc2200';   /* red, matching the markers */
/* Target on-screen LENGTH of the whole arrow, in PIXELS. We derive the world length
   from the camera frustum so this is exact at every zoom — the old approach (length =
   a fraction of camera height) only approximated it, and worked out to ~10 px, which
   is why the head collapsed into a blob. */
var ARROW_PX    = 44;          /* on-screen length in px — CONSTANT at every zoom. Deliberately
                                  modest: big enough to read, small enough that it never looks like
                                  a geographic feature. */
var ARROW_MAX_M = 3.0e5;       /* WORLD CAP: 300 km — the arrow never sprawls across a continent.
                                  Capping is safe now ONLY because the stem width scales with the
                                  arrow's screen length (see stemWidthPx). Previously the stem was a
                                  FIXED 2 px while the head shrank in world metres, so a capped arrow
                                  degenerated into a stemless blob. Now a capped arrow is just a
                                  smaller arrow, with identical proportions. */
var HEAD_FRAC   = 0.30;        /* head = 30% of length → stem is 70% */
var HEAD_WIDTH  = 0.42;        /* head half-width ÷ head length → clearly a dart, never a hairline */
var LIFT_FRAC   = 0.06;        /* lift ÷ length: constant on screen, no parallax, clears z-fighting */
var _arrowState = null;        /* {lat, lon, az} — null when no arrow is placed */
var _arrowEnts  = [];

/* Metres per CSS pixel AT THE ARROW'S OWN POSITION.
   Uses Cesium's native camera.getPixelSize() rather than hand-rolled frustum trig — my
   own version was wrong (it produced an arrow many times the requested size) and, per the
   standing rule, the engine already exposes this. getPixelSize returns metres per DEVICE
   pixel for a bounding sphere at that distance; scale by the device-pixel ratio of the
   canvas to get CSS pixels, which is what ARROW_PX is expressed in. */
function metresPerPixelAt(cart) {
  var scene = map.scene;
  var bs  = new Cesium.BoundingSphere(cart, 1.0);
  /* Pass CSS dimensions, so the result is metres per CSS pixel directly — no
     device-pixel-ratio arithmetic (my earlier version multiplied by the DPR and
     inflated the arrow). */
  /* Pass DRAWING-BUFFER dimensions: Cesium applies scene.pixelRatio internally, so the
     result is already metres per CSS pixel. Passing CSS dims (or multiplying by the DPR
     afterwards) double-counts the ratio and inflates the arrow. */
  var mpp = map.camera.getPixelSize(bs, scene.drawingBufferWidth, scene.drawingBufferHeight);
  return (isFinite(mpp) && mpp > 0) ? mpp : 1000;
}

function arrowGeom() {
  /* Recomputed per frame. L is proportional to camera height, so the arrow holds a
     CONSTANT on-screen size at every zoom (no clamps — clamping is what made it
     balloon when zoomed in and vanish when zoomed out). */
  var st  = _arrowState;
  var base = Cesium.Cartesian3.fromDegrees(st.lon, st.lat);
  var mpp = metresPerPixelAt(base);
  /* Target size on screen, then CAP on the ground. The cap is the LAST word: an earlier
     version applied a screen-size FLOOR after the cap, and at globe zoom that floor
     (16 px worth of ground = hundreds of km) was LARGER than the cap, so it overrode it
     and the arrow grew to thousands of km — the arrow spanning Africa. Never re-add a
     floor here: the cap must win. */
  var L = Math.min(ARROW_PX * mpp, ARROW_MAX_M);
  /* NO minimum length. A 2 km "safety rail" used to sit here, and at street zoom — where
     the whole view is barely 2 km across — it was not a rail at all, it was the dominant
     term, and the arrow swallowed the screen. The arrow is a SCREEN-SIZE object: the only
     legitimate limit is the ground CAP (so it can't span a continent when zoomed out). */
  var headL = L * HEAD_FRAC;
  var lift  = L * LIFT_FRAC;          /* proportional → constant on screen, no parallax drift */
  var tip   = destPoint(st.lat, st.lon, st.az, L);
  var neck  = destPoint(st.lat, st.lon, st.az, L - headL);
  var halfW = headL * HEAD_WIDTH;     /* head is always clearly wider than the 3px stem */
  var wingL = destPoint(neck[1], neck[0], st.az - 90, halfW);
  var wingR = destPoint(neck[1], neck[0], st.az + 90, halfW);
  return { st: st, tip: tip, neck: neck, wingL: wingL, wingR: wingR, lift: lift, lpx: L / mpp };
}

function drawSunArrow() {
  if (!dsObserver || !_arrowState) return;
  var aCol = col(ARROW_COL);

  /* Shaft: base → neck. CallbackProperty(…, false) = re-evaluated every frame.
     Its WIDTH tracks the arrow's on-screen length, so when the world cap shrinks the
     arrow the stem thins with it and the head stays proportionally broad. A fixed stem
     width is exactly what turned a capped arrow into a stemless blob before. */
  _arrowEnts.push(dsObserver.entities.add({ polyline: {
    positions: new Cesium.CallbackProperty(function () {
      var g = arrowGeom();
      /* base at height 0 = exactly the pin's tip (no parallax); far end lifted to clear
         z-fighting with the imagery. */
      return Cesium.Cartesian3.fromDegreesArrayHeights(
        [g.st.lon, g.st.lat, 0, g.neck[0], g.neck[1], g.lift]);
    }, false),
    width: new Cesium.CallbackProperty(function () {
      return Math.max(1.2, arrowGeom().lpx * 0.045);
    }, false),
    material: aCol, arcType: Cesium.ArcType.GEODESIC, clampToGround: false } }));

  /* Head: filled triangle, same per-frame treatment. */
  _arrowEnts.push(dsObserver.entities.add({ polygon: {
    hierarchy: new Cesium.CallbackProperty(function () {
      var g = arrowGeom();
      return new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights(
        [g.tip[0], g.tip[1], g.lift,
         g.wingL[0], g.wingL[1], g.lift,
         g.wingR[0], g.wingR[1], g.lift]));
    }, false),
    material: aCol, perPositionHeight: true } }));
}

window._scArrowSync = function () { if (_arrowState) render(); };

/* Force the globe to recentre on the current selection. The normal fly-to is guarded by
   `isNewEclipse`, so if the selection was already applied (e.g. by a deep link's hashchange
   before the map was looking) the guard has been consumed and the camera never moves.
   Clearing the guard and re-running makes the recentre unconditional. */
window._scRecenter = function () {
  if (typeof updateMapState !== 'function') return;
  updateMapState._lastEntry = null;
  updateMapState();
};

/* Swap the online basemap live from Settings — drop the current layer and rebuild
   from the new choice. No reload needed. */
window._scSetBasemap = function (key) {
  if (!BASEMAPS[key]) return;
  try { localStorage.setItem('sc_basemap', key); } catch (e) {}
  if (_esriLayer) { try { map.imageryLayers.remove(_esriLayer, true); } catch (e) {} _esriLayer = null; }
  if (!isOffline()) { _esriLayer = makeEsriLayer(); setEsriVisible(true); }
  render();
};

function addObserverMarker(lat, lon, sunAz) {
  if (!dsObserver) return;
  /* Fresh local circumstances now exist in the Details panel — nudge the tab. */
  if (window.scFlagFreshDetails) window.scFlagFreshDetails();
  /* Markers are depth-tested at the surface (disableDepthTestDistance:0), so the
     globe occludes them at the far limb without z-fighting — same behaviour as the
     city dots. Clamp-to-ground was tried instead but crashed iOS on the offline
     transition (f.globe), so it's out. */
  var pos = Cesium.Cartesian3.fromDegrees(lon, lat);
  if (sunAz != null) {
    /* Sun arrow: flat geometry lying ON the globe (shaft + filled head), NOT a
       screen-space billboard — so it drapes on the surface, is hidden by the limb,
       and can never poke into space. Redrawn on camera change (see _scArrowSync)
       so it holds a roughly constant ON-SCREEN size, with a hard min/max and a
       stem that is always visible (never a lone arrowhead when zoomed out). */
    _arrowState = { lat: lat, lon: lon, az: sunAz };
    drawSunArrow();
    addPin(pos);
  } else {
    addPin(pos);
  }
  render();
}

/* Flat red diamond for greatest eclipse (canvas billboard, drawn once + cached).
   Flat fill, no outline ring — sits ON the surface rather than bulging off it. */
var _diamondImg = null;
function diamondImage() {
  if (_diamondImg) return _diamondImg;
  var s = 18, c = document.createElement('canvas');
  c.width = c.height = s;
  var x = c.getContext('2d');
  x.beginPath();
  x.moveTo(s/2, 1); x.lineTo(s-1, s/2); x.lineTo(s/2, s-1); x.lineTo(1, s/2);
  x.closePath();
  x.fillStyle = '#f08a1e';   /* orange — distinct from the red observer/arrow */
  x.fill();
  _diamondImg = c;
  return c;
}

function addPin(pos) {
  dsObserver.entities.add({ position: pos, billboard: {
    image: pinImage(),
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,   /* the TIP is the coordinate */
    disableDepthTestDistance: 0,
    scaleByDistance: new Cesium.NearFarScalar(5.0e5, 1.0, 2.0e7, 0.45),
  }});
}

function addGEMarker(lat, lon) {
  if (!dsGE) return;
  dsGE.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    billboard: { image: diamondImage(), disableDepthTestDistance: 0,
      /* Full size up close, shrinking as the camera pulls back — it was dominating
         the globe when zoomed out. */
      scaleByDistance: new Cesium.NearFarScalar(1.0e6, 1.0, 3.0e7, 0.35) },
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
var OVAL_HIDE_HEIGHT = 6.0e6;   /* fully visible at/above this height (m) */
var OVAL_FADE_LO     = 3.5e6;   /* fully gone below this — the band between the two is the fade */

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
      /* EXACT height 0 — these curves are the science (centreline ~15 m). Any lift would
         parallax them across the ground by height x tan(view angle), so there is none.
         depthFailMaterial draws the line even when it LOSES the depth test, which is how
         it stays visible where a border line shares the same surface, with no lift and no
         displacement whatsoever. */
      depthFailMaterial: color,
    }});   /* plain ellipsoid polyline — clamp-to-ground gapped and crashed iOS */
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
      /* keep the base colours + their alphas so updateOvalVisibility can fade them */
      _ovalEntities.push({ e: e, fill: fill, line: line, fillA: fill.alpha, lineA: line.alpha });
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
  /* Fade across a band rather than blinking off at a hard threshold. band() is 0 below
     the low edge, 1 above the high edge — so the ovals ease in as you pull back. */
  var h = map.camera.positionCartographic.height;
  var k = band(h, OVAL_FADE_LO, OVAL_HIDE_HEIGHT);
  _ovalEntities.forEach(function (o) {
    o.e.show = k > 0.01;
    if (k > 0.01) {
      o.e.polygon.material    = o.fill.withAlpha(o.fillA * k);
      o.e.polygon.outlineColor = o.line.withAlpha(o.lineA * k);
    }
  });
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
