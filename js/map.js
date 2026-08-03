/* ── Map ─────────────────────────────────────────────────────────────── */

/* `map` and `mapReady` are AppState properties; see js/state.js. */
var pathCache      = {};
/* `pathMarkers` are bound to the selected eclipse (e.g. greatest-eclipse dot)
   and only change when selectedEntry changes. `mapMarkers` are bound to the
   observer location and may be cleared independently when the user clicks. */
var mapMarkers     = [];
var pathMarkers    = [];
var deckOverlay = null; /* deck.gl MapboxOverlay */
var _deckLayers = null; /* last layers array pushed to the overlay */

/* ── Basemap loading ──────────────────────────────────────────────────
   We support two basemap modes:
   - LOCAL: a small bundle of GeoJSON files in ./data/basemap/, loaded
     into memory and rendered via a hand-built MapLibre style. Used
     offline or when the online style fails. Always available.
   - ONLINE: the OpenFreeMap Liberty vector style, loaded directly from
     their CDN. Higher detail (streets, labels, etc.). Used as an
     upgrade when the network is reachable.

   Optional layer files (drop in ./data/basemap/, all .geojson.gz):
     countries.geojson.gz   — required (country borders + fills)
     land.geojson.gz        — required (coastline outline)
     cities.geojson.gz      — optional (Point features; populated places)
     rivers.geojson.gz      — optional (LineString/MultiLineString)
     lakes.geojson.gz       — optional (Polygon/MultiPolygon)

   Schemas:
     cities  : Feature properties may include `name` (string) and
               `rank` or `pop_max` (number; bigger = more important).
               Used to filter labels at low zoom.
     rivers  : no properties needed
     lakes   : no properties needed
*/

/* Online basemaps. All RASTER — that is what lets the online and local layers
   live in one style, with going offline hiding a layer instead of swapping the
   whole thing. Adding a VECTOR style here would break that, and would need the
   old style-swap machinery back. Only the three in PICKER_KEYS are reachable;
   the rest are kept because they cost nothing and may be offered again.
   ('osm' now names a raster OSM tile source, not the old vector style.)
   Tile URL order is provider-native and matches
   MapLibre's {z}/{x}/{y} (row = {y}) substitution: ArcGIS uses {z}/{y}/{x}. */
var BASEMAPS = {
  esri_street:  { name: 'Esri Street',      attr: 'Esri', max: 19, url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}' },
  esri_imagery: { name: 'Esri Satellite',   attr: 'Esri', max: 19, dark: true, url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
  esri_topo:    { name: 'Esri Topographic', attr: 'Esri', max: 19, url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}' },
  esri_terrain: { name: 'Esri Terrain',     attr: 'Esri', max: 13, dark: false, url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}' },
  esri_gray:    { name: 'Esri Light Gray',  attr: 'Esri', max: 16, url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}' },
  /* Topographic is TWO sources with a handover at TOPO_SPLIT. OpenTopoMap is
     really two maps in one: a saturated shaded-relief globe at low zoom, then an
     abrupt switch to a classic paper topo sheet (white ground, green forest,
     brown contours) higher up. The paper sheet is the beautiful part and the
     reason to use it on the ground; the low-zoom relief clashes with everything
     around it. So we fly over Esri Topographic and land on OpenTopoMap. */
  /* Topographic is TWO sources with a handover at `nearFrom`. OpenTopoMap is
     really two maps in one: a saturated shaded-relief globe at low zoom, then an
     abrupt switch to a classic paper topo sheet (white ground, green forest,
     brown contours) higher up. The paper sheet is the beautiful part and the
     reason to use it on the ground; the low-zoom relief clashes with everything
     around it. So we fly over Esri Topographic and land on OpenTopoMap. Any
     basemap may do this — it is a general `near*` facility, not a topo hack.
     nearFrom is 9.5, not 9: OpenTopoMap switches to its paper sheet at 9.45, so
     handing over any earlier exposes a band of its saturated relief style, which
     is the thing we are avoiding. Layer zoom ranges take fractions, so the
     handover can sit just past their break rather than on a round number. */
  opentopo:     { name: 'Topographic',      attr: 'Esri', max: 19,
                  url:      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
                  nearFrom: 9.5,
                  nearMax:  17,
                  nearAttr: '\u00a9 OpenTopoMap (CC-BY-SA)',
                  nearUrl:  'https://tile.opentopomap.org/{z}/{x}/{y}.png' },
  osm:          { name: 'OpenStreetMap',    attr: '\u00a9 OpenStreetMap contributors',   max: 19, url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }
};

/* The three basemaps offered on the map itself; this array is the picker order.
   BASEMAPS still holds the others — they are simply no longer exposed, now that
   the Settings pulldown is gone. */
var PICKER_KEYS  = ['esri_street', 'opentopo', 'esri_imagery'];

/* Swatches: small hand-drawn map fragments, not photographs and not icons.
   Live provider tiles were tried first — at 44px a zoomed-out topo tile and a
   street tile both reduce to pale mush, so the control taught you nothing. These
   are drawn to read at a glance: a street grid with a park and a bay, a hill in
   contour lines with a stream, and terrain from orbit with a river. Un-branded
   on purpose, so they stay honest if a provider is ever swapped out. */
var PICKER_SWATCH = {
  esri_street:
    '<svg viewBox="0 0 48 48" preserveAspectRatio="none" aria-hidden="true">' +
    '<rect width="48" height="48" fill="#f7f4ed"/>' +
    '<path d="M3 3h15v13H3z" fill="#d6e6c6"/>' +
    '<g fill="none" stroke="#e6e0d5" stroke-width="5.5">' +
    '<path d="M-1 21h50M-1 38h50M18 -1v50M35 -1v50"/></g>' +
    '<g fill="none" stroke="#fff" stroke-width="3.6">' +
    '<path d="M-1 21h50M-1 38h50M18 -1v50M35 -1v50"/></g>' +
    '<path d="M-1 9h50" stroke="#eccf94" stroke-width="4.4"/>' +
    '<path d="M-1 9h50" stroke="#fbeac4" stroke-width="2.6"/>' +
    '<path d="M48 30c-10 1-15 8-19 18h19z" fill="#a9cfe3"/></svg>',
  opentopo:
    '<svg viewBox="0 0 48 48" preserveAspectRatio="none" aria-hidden="true">' +
    '<rect width="48" height="48" fill="#f5edd9"/>' +
    '<g fill="none" stroke="#c9a273" stroke-width="1.1">' +
    '<path d="M2 33c-1-10 7-18 18-18s21 6 22 15-9 16-20 16S3 43 2 33z"/>' +
    '<path d="M9 32c-1-7 5-13 12-13s15 4 16 11-6 11-14 11-13-4-14-9z"/>' +
    '<path d="M16 31c0-4 3-8 8-8s9 3 9 7-4 7-9 7-8-3-8-6z"/></g>' +
    '<path d="M22 30c1-3 4-3 5-1" fill="none" stroke="#c9a273" stroke-width="1.1"/>' +
    '<path d="M0 9c9 3 15-3 24-1s15 6 24 2" fill="none" stroke="#8fbdd8" stroke-width="1.7"/></svg>',
  esri_imagery:
    '<svg viewBox="0 0 48 48" preserveAspectRatio="none" aria-hidden="true">' +
    '<rect width="48" height="48" fill="#3d5733"/>' +
    '<path d="M0 0h48v13c-9 6-16 2-25 6S7 27 0 23z" fill="#516d3c"/>' +
    '<path d="M0 23c7 4 14-1 23-5s16 0 25-6v13c-9 6-16 2-25 5S8 34 0 31z" fill="#77804a"/>' +
    '<path d="M0 31c8 3 15 0 24-3s16 1 24-5v25H0z" fill="#2c4527"/>' +
    '<path d="M13 48c1-9 7-13 9-21s-2-12 1-19" fill="none" stroke="#2a5570" stroke-width="3.2"/>' +
    '<path d="M31 0c-1 8 3 11 7 14s7 2 10 0" fill="none" stroke="#2a5570" stroke-width="2.4"/></svg>'
};

function _basemapKey() {
  var k = null;
  try { k = localStorage.getItem('sc_basemap'); } catch (e) {}
  /* Anything not on the picker — including the old 'osm' default and the four
     Esri styles the pulldown used to reach — resolves to Esri Street, the
     closest equivalent to the vector street map that used to be the default.
     Without this the stored key could name a basemap with no lit segment. */
  return (PICKER_KEYS.indexOf(k) >= 0) ? k : 'esri_street';
}

/* Build the picker once, then keep its lit segment in step with the stored key.
   Offline it greys out and stops responding, exactly as the Shadows button does
   — every option here is a network basemap. */
function renderBasemapPicker() {
  var host = document.getElementById('basemap-picker');
  if (!host) return;
  var cur = _basemapKey(), off = isOffline();
  if (!host.dataset.built) {
    host.innerHTML = PICKER_KEYS.map(function (k) {
      return '<button class="basemap-opt" data-key="' + k + '" title="' +
             (BASEMAPS[k] ? BASEMAPS[k].name : k) + '">' +
             '<span class="basemap-swatch">' + PICKER_SWATCH[k] + '</span></button>';
    }).join('');
    host.dataset.built = '1';
    host.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.basemap-opt') : null;
      if (b && !isOffline()) window._scSetBasemap(b.dataset.key);
    });
  }
  host.classList.toggle('is-offline', off);
  Array.prototype.forEach.call(host.querySelectorAll('.basemap-opt'), function (b) {
    b.classList.toggle('active', b.dataset.key === cur);
    b.disabled = off;
  });
}


/* Change the online basemap. The choice is persisted even while offline — it
   just doesn't take effect until we're back, since every option here is a
   network basemap. */
window._scSetBasemap = function (key) {
  var bm = BASEMAPS[key];
  if (!bm) return;
  try { localStorage.setItem('sc_basemap', key); } catch (e) {}
  renderBasemapPicker();
  /* Retarget the existing raster source rather than rebuilding the style — same
     reason as applyOnlineState. The choice is persisted even while offline; it
     simply isn't visible until the layer is shown again. */
  if (!map || !map.getSource) return;
  var far  = map.getSource('basemap-far');
  var near = map.getSource('basemap-near');
  try {
    if (far  && far.setTiles)  far.setTiles([bm.url]);
    if (near && near.setTiles) near.setTiles([bm.nearUrl || bm.url]);
  } catch (e) {}
  syncBasemapLayers();
  redrawIfMapVisible();   /* path colours follow the base — see pathPalette() */
};

/* Force a recentre on the current selection (framing is otherwise done once per
   eclipse). Clears only the CAMERA's bookkeeping — _lastEntry drives the shadow
   hook and must not be re-fired. If the map is hidden right now, updateMapState
   leaves the framing owed and performs it when the Map tab next opens.
   Renderer-agnostic. */
window._scRecenter = function () {
  if (typeof updateMapState !== 'function') return;
  updateMapState._framedEntry = null;
  updateMapState();
};

var _mapEventsWired = false;   /* guard: map-level listeners survive setStyle, so
                                  attach them once, not on every style.load */
var basemapData = null;     /* parsed GeoJSON cache: {countries, land, cities?, rivers?, lakes?} */
var basemapLoading = null;  /* in-flight Promise so we only fetch once */

/* Fetch + decompress a single .geojson.gz file. Returns parsed object,
   or null if missing/failed. */
function fetchGz(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) return null;
    var stream = r.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).json();
  }).catch(function () { return null; });
}

/* Load all basemap layers (required + optional). Caches the result. */
function loadBasemapData() {
  if (basemapData) return Promise.resolve(basemapData);
  if (basemapLoading) return basemapLoading;
  var base = DATA_BASE + '/basemap/';
  basemapLoading = Promise.all([
    fetchGz(base + 'land.geojson.gz?v='      + BUILD),
    fetchGz(base + 'countries.geojson.gz?v=' + BUILD),
    fetchGz(base + 'lakes.geojson.gz?v='     + BUILD),
    fetchGz(base + 'rivers.geojson.gz?v='    + BUILD),
    fetchGz(base + 'cities.geojson.gz?v='    + BUILD),
  ]).then(function (r) {
    basemapData = {
      land:      r[0], countries: r[1],
      lakes:     r[2], rivers:    r[3], cities: r[4],
    };
    /* Cities became available — any pending city-name token in the search
       input couldn't resolve at first parse. Re-run the search now so
       those tokens light up. */
    if (typeof onSearchChanged === 'function') onSearchChanged(true);
    return basemapData;
  });
  return basemapLoading;
}

/* Build seam-free line geometry from polygon fill data.

   The antimeridian split that fixes globe FILL artifacts inserts edges along
   the ±180° meridian and a ring of vertices around the poles. Those edges are
   correct for filling, but when stroked as coastline/borders they appear as
   meridian lines crossing land and a small circle at the pole. We rebuild the
   outlines as lines, breaking the path wherever an edge lies on the seam or
   the polar cap so those artifact edges are never drawn. Fill is unaffected. */
/* Polygon rings → LineStrings, minus the edges that aren't real.

   Two kinds of fake edge get suppressed:

   1. SEAM/POLE cuts, from splitting geometry at the antimeridian and poles.

   2. CELL cuts. land.geojson ships pre-clipped into a 5° grid — 3,350 polygons,
      10% of whose vertices sit exactly on a 5° line. The fill layer hides those
      internal boundaries (adjacent cells abut), but extracting ring edges as
      coastline exposed every one of them: a graticule drawn across every
      continent. An artificial cut is shared by the two cells either side, so it
      appears TWICE in the data, while genuine coastline appears once. Dropping
      duplicated segments removes exactly the 2,756 cut edges and nothing else —
      verified: every duplicated segment lies on a 5° line, and the only
      grid-aligned singletons are at ±180, already caught by isCut().

   dropShared MUST stay off for countries: adjacent nations legitimately share
   19,099 border segments (none grid-aligned), and dropping those would erase
   every internal border, leaving only coastal outlines. */
function seamFreeLines(fc, dropShared) {
  if (!fc || !fc.features) return fc;
  var SEAM = 179.9, POLE = 89.9, feats = [];

  /* Pass 1: count segments, so pass 2 can tell a shared cut from real line. */
  var seen = null;
  if (dropShared) {
    seen = Object.create(null);
    eachRing(function (ring) {
      for (var i = 1; i < ring.length; i++) {
        var k = segKey(ring[i - 1], ring[i]);
        seen[k] = (seen[k] || 0) + 1;
      }
    });
  }
  function segKey(a, b) {
    var p = a[0] + ',' + a[1], q = b[0] + ',' + b[1];
    return p <= q ? p + '|' + q : q + '|' + p;   /* undirected */
  }
  function isCut(a, b) {
    var seam = Math.abs(a[0]) >= SEAM && Math.abs(b[0]) >= SEAM && (a[0] > 0) === (b[0] > 0);
    var pole = Math.abs(a[1]) >= POLE && Math.abs(b[1]) >= POLE;
    if (seam || pole) return true;
    return !!(seen && seen[segKey(a, b)] > 1);
  }
  function emit(run) {
    if (run.length > 1) feats.push({ type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: run } });
  }
  function addRing(ring) {
    var run = ring.length ? [ring[0]] : [];
    for (var i = 1; i < ring.length; i++) {
      if (isCut(ring[i - 1], ring[i])) { emit(run); run = [ring[i]]; }
      else run.push(ring[i]);
    }
    emit(run);
  }
  function eachRing(fn) {
    fc.features.forEach(function (f) {
      var g = f.geometry; if (!g) return;
      var polys = g.type === 'Polygon' ? [g.coordinates]
                : g.type === 'MultiPolygon' ? g.coordinates : [];
      polys.forEach(function (poly) { poly.forEach(fn); });
    });
  }
  eachRing(addRing);
  return { type: 'FeatureCollection', features: feats };
}

/* Build a MapLibre style spec from whatever basemap data we have.
   Colours match the existing dark theme.

   Layer order:
     background (ocean colour) → land fill → lakes → NE2 relief raster
     → coastline → country lines → rivers → cities

   Fills sit BELOW the relief purely as a fallback: if ne2_mercator.jpg is
   missing the globe degrades to flat vector fill rather than going blank.
   Lines sit ABOVE it so they stay legible against the imagery.

   The background colour is the ocean; there is no separate ocean layer. */
function buildLocalStyle(data) {
  var BG       = '#b8d0e8';   /* ocean — matches online water tint  */
  var LAND     = '#d4e8c8';   /* land fill — matches online land    */
  var BORDER   = '#a0b090';   /* country lines                      */
  var COAST    = '#6a8870';   /* coastline                          */
  var RIVER    = '#90b8d8';   /* rivers                             */
  var LAKE     = BG;          /* lakes same as ocean                */
  var CITY     = '#c8a96e';   /* gold city dots                     */

  var sources = {};
  var layers  = [{ id: 'background', type: 'background', paint: { 'background-color': BG } }];

  /* Land fill. Polar/antimeridian fill artifacts are fixed at the data level
     (antimeridian-split, correctly-wound polygons), so no lat filter is
     needed here. */
  if (data.land) {
    sources.land = { type: 'geojson', data: data.land, tolerance: 0.5 };
    sources.coast = { type: 'geojson', data: seamFreeLines(data.land, true), tolerance: 0.5 };
    layers.push({ id: 'land-fill', type: 'fill', source: 'land',
      maxzoom: 22,
      paint: { 'fill-color': LAND, 'fill-opacity': 1, 'fill-antialias': true } });
  }

  /* Lake fill belongs with the land fill, BELOW the relief — NE2 already draws
     lakes, and painting flat ocean-blue over it would erase that detail. It
     stays in the style so the no-relief fallback still shows lakes. */
  if (data.lakes) {
    sources.lakes = { type: 'geojson', data: data.lakes, tolerance: 0.5 };
    layers.push({ id: 'lakes-fill', type: 'fill', source: 'lakes',
      paint: { 'fill-color': LAKE, 'fill-opacity': 1 } });
  }

  /* NE2 shaded relief. This is the offline basemap proper; the vector land/lake
     fills below stay in the style deliberately, so that if the image is missing
     or fails to decode we degrade to the flat-fill globe instead of a blank one.
     The cost is a little overdraw, which is cheap and bounded.

     The file MUST be the Web-Mercator reprojection (ne2_mercator.jpg), not the
     4096x2048 equirectangular original: an `image` source maps its four corners
     linearly in MERCATOR space, so feeding it a plate-carrée image would slide
     every latitude off — subtly near the equator, grossly toward the poles.
     ±85.0511° is the Mercator limit, which is why the source is square. */
  if (data.relief !== false) {
    sources.relief = {
      type: 'image',
      url: DATA_BASE + '/basemap/ne2_mercator.jpg?v=' + BUILD,
      coordinates: [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]]
    };
    layers.push({ id: 'relief', type: 'raster', source: 'relief',
      paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } });

    /* POLAR CAPS. Web Mercator is undefined at the poles, so the relief image
       stops at ±85.0511° and beyond it you saw straight through to whatever
       was underneath — green land-fill over Antarctica, blue background over
       the Arctic — as two hard-edged discs. NE2 renders both as ice, so we
       cap them in the same near-white. Drawn just above the relief and below
       the coastlines, so outlines still read on top. */
    var ICE = '#eef2f4';
    /* Each cap is TWO half-rings, split at longitude 0, never one ring spanning
       -180..180. A single ring around a pole encloses the antimeridian, and
       MapLibre — which splits geometry at ±180 — then can't tell which side the
       interior is on, so it filled only half the cap, and which half changed
       with the globe's rotation.
       Latitudes stop at ±89.999, NOT ±90: 90 is infinity in Mercator, and a ring
       touching it projects to invalid geometry that silently fails to draw.
       (land.geojson uses 89.999 for Antarctica, for the same reason.) The inner
       edge overlaps the relief slightly so no hairline seam shows at the join. */
    function capRing(lonA, lonB, latFrom, latTo) {
      var ring = [], lon;
      for (lon = lonA; lon <= lonB; lon += 5)  ring.push([lon, latFrom]);
      ring.push([lonB, latTo]);
      for (lon = lonB; lon >= lonA; lon -= 5)  ring.push([lon, latTo]);
      ring.push([lonA, latFrom]);
      return [ring];
    }
    function cap(id, latFrom, latTo) {
      sources[id] = { type: 'geojson', data: {
        type: 'Feature', properties: {},
        geometry: { type: 'MultiPolygon', coordinates: [
          capRing(-180, 0, latFrom, latTo),
          capRing(0, 180, latFrom, latTo)
        ] } } };
      layers.push({ id: id, type: 'fill', source: id,
        paint: { 'fill-color': ICE, 'fill-opacity': 1, 'fill-antialias': false } });
    }
    cap('cap-n',  85.00,  89.999);
    cap('cap-s', -85.00, -89.999);
  }


  /* Lines go ABOVE the relief so they stay legible against the imagery. */
  if (data.land) {
    layers.push({ id: 'coast-line', type: 'line', source: 'coast',
      paint: { 'line-color': COAST, 'line-width': 0.8, 'line-opacity': 0.9 } });
  }

  if (data.countries) {
    sources.countries = { type: 'geojson', data: seamFreeLines(data.countries), tolerance: 0.5 };
    layers.push({ id: 'countries-line', type: 'line', source: 'countries',
      paint: { 'line-color': BORDER, 'line-width': 0.6, 'line-opacity': 0.8 } });
  }

  if (data.rivers) {
    sources.rivers = { type: 'geojson', data: data.rivers, tolerance: 0.5 };
    layers.push({ id: 'rivers-line', type: 'line', source: 'rivers',
      paint: { 'line-color': RIVER, 'line-width': 0.6, 'line-opacity': 0.8 } });
  }

  if (data.cities) {
    sources.cities = { type: 'geojson', data: data.cities };
    var cityPaint = function(baseRadius) {
      return {
        'circle-color': CITY,
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          1, baseRadius, 5, baseRadius * 1.6, 9, baseRadius * 2.4],
        'circle-opacity': 0.9,
        'circle-stroke-width': 0.5,
        'circle-stroke-color': '#ffffff',
      };
    };
    layers.push({ id: 'cities-r1', type: 'circle', source: 'cities',
      filter: ['==', ['get', 'rank'], 1], paint: cityPaint(2.5) });
    layers.push({ id: 'cities-r2', type: 'circle', source: 'cities',
      minzoom: 2, filter: ['==', ['get', 'rank'], 2], paint: cityPaint(1.8) });
    layers.push({ id: 'cities-r3', type: 'circle', source: 'cities',
      minzoom: 3.5, filter: ['==', ['get', 'rank'], 3], paint: cityPaint(1.4) });
    layers.push({ id: 'cities-r4', type: 'circle', source: 'cities',
      minzoom: 5, filter: ['==', ['get', 'rank'], 4], paint: cityPaint(1.1) });

  }

  /* ONLINE BASEMAP, in the SAME style, on top of everything local. Going online
     or offline only toggles this layer's visibility — the style itself is never
     swapped. That is what the cesium branch did (it hid an imagery layer), and
     it is the reason this is now possible here: with the Settings pulldown gone,
     all three offered basemaps are RASTER, so there is no vector style that
     would have to be swapped in wholesale.
     setStyle is the thing to avoid: a full rebuild costs the deck.gl overlay its
     globe state, and the eclipse paths then draw straight through the planet;
     a diffed rebuild of this many sources at once left the map blank instead.
     Toggling one layer has neither failure mode. */
  var bm = BASEMAPS[_basemapKey()];
  if (bm) {
    /* TWO layers, always present: a far one and a near one. A single-source
       basemap simply leaves the near layer hidden. Their tiles, zoom ranges and
       visibility are all set afterwards by syncBasemapLayers(), which is the one
       place that knows the current basemap — so the style itself never needs
       rebuilding when the choice changes. */
    sources['basemap-far'] = { type: 'raster', tiles: [bm.url], tileSize: 256,
                               maxzoom: bm.max, attribution: bm.attr };
    layers.push({ id: 'basemap-far', type: 'raster', source: 'basemap-far',
      paint: { 'raster-fade-duration': 0 } });

    sources['basemap-near'] = { type: 'raster',
                                tiles: [bm.nearUrl || bm.url], tileSize: 256,
                                maxzoom: bm.nearMax || bm.max,
                                attribution: bm.nearAttr || bm.attr };
    layers.push({ id: 'basemap-near', type: 'raster', source: 'basemap-near',
      paint: { 'raster-fade-duration': 0 } });
  }

  return {
    version: 8,
    projection: { type: 'globe' },
    sources: sources,
    layers: layers,
  };
}

/* ── Connectivity ─────────────────────────────────────────────────────────
   ONE source of truth: `_online`. Ported from the cesium branch, where this was
   worked out the hard way. We never trust navigator.onLine as a POSITIVE (it
   reports "online" in DevTools-offline and after some iOS transitions) and never
   depend on the 'offline' EVENT firing (iOS Safari frequently doesn't fire it on
   airplane mode — that was the mobile "won't switch" bug). Instead an active
   probe confirms real reachability. A negative from navigator.onLine IS
   trustworthy, so that one is acted on immediately. */

var _forceOffline = false;
var _online       = (navigator.onLine !== false);   /* optimistic; the probe corrects it */

/* Single source of truth for "are we offline?" — consulted by the basemap swap
   and by any feature that would otherwise fire a doomed network request (e.g.
   elevation lookup). */
function isOffline() { return _forceOffline || !_online; }

/* Probe the real tile origin. Two iOS-specific defences, both load-bearing:
     • TIMEOUT — an offline fetch on iOS Safari HANGS rather than rejecting. With
       no timeout the in-flight guard below would latch forever and the app could
       never flip to offline. A timeout is the only reliable "no network" signal.
     • CACHE-BUST — iOS ignores cache:'no-store' for no-cors requests and answers
       from its HTTP cache, so a cached tile made the probe report "online" while
       in airplane mode. A unique query param forces a real network attempt. */
var PROBE_URL     = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/0/0/0';
var PROBE_TIMEOUT = 3000;
var _probing   = false;
var _negProbes = 0;                    /* consecutive failed probes */
var NEG_PROBES_TO_GO_OFFLINE = 2;      /* need two in a row before declaring offline */

function probeConnectivity() {
  if (_probing) return;                                          /* one in flight */
  if (navigator.onLine === false) {                              /* trustworthy negative: immediate */
    _negProbes = NEG_PROBES_TO_GO_OFFLINE; setOnline(false); return;
  }
  _probing = true;

  var settled = false;
  function finish(up) {
    if (settled) return;
    settled = true; _probing = false;   /* ALWAYS unlocks — no deadlock path */
    /* DEBOUNCE the negative. A single timed-out probe is NOT proof of offline:
       during a heavy first load (service-worker precache saturating the
       connection) the probe can hang past its budget while the network is
       perfectly fine. Acting on that one failure flipped the app offline and
       back on the next probe — an oscillation that tore the basemap down and
       rebuilt it repeatedly. A positive is trusted instantly; a negative must
       repeat before we believe it. */
    if (up) { _negProbes = 0; setOnline(true); return; }
    _negProbes++;
    if (_negProbes >= NEG_PROBES_TO_GO_OFFLINE) { setOnline(false); return; }
    /* First failure while still believed online: re-probe SOON rather than
       waiting a whole interval. Two strikes at 15s apart meant a real
       disconnection took up to 30s to show. This confirms in ~3s while keeping
       the two-strike rule that stops precache-induced flapping. */
    if (_online) setTimeout(probeConnectivity, 3000);
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

/* Which style is actually mounted: 'online' | 'local' | null (not yet built).
   Kept in step with every setStyle so applyOnlineState can no-op when the map is
   already showing the right thing. */
var _styleMode  = null;

/* THE one place that knows what the online basemap should currently be: which
   tiles each layer draws, over which zoom range, and whether either is visible
   at all. Everything else — going offline, picking a basemap — just changes the
   inputs and calls this. No style rebuild, so the deck.gl overlay and every
   local layer stay exactly as they are.

   A basemap with `nearUrl` hands over at `nearFrom`.

   The handover is done with OPACITY, not with layer zoom ranges. MapLibre tests
   a layer's zoom range against each TILE's own zoom, and on a globe the tiles on
   screen are not all at the same zoom — those near the centre of the disc are
   finer than those toward the limb. With ranges, tiles either side of the
   boundary passed different tests and both maps drew at once, in patches. An
   opacity expression on ['zoom'] reads the map's single scalar zoom, so the
   whole sphere switches together. `step` rather than `interpolate`: these are
   two different maps, and cross-fading them just looks like a mistake.

   Zoom ranges are still set, one level wider than the handover on each side, so
   neither provider is asked for tiles far outside where it's used — that keeps
   us off OpenTopoMap's servers at global zoom, which their usage policy asks.

   Without `nearUrl` the far layer covers everything and the near layer is
   simply hidden. */
function syncBasemapLayers() {
  if (!map || !map.getLayer || !map.getLayer('basemap-far')) return;
  var bm    = BASEMAPS[_basemapKey()];
  var off   = isOffline();
  var split = (bm && bm.nearUrl) ? bm.nearFrom : null;
  try {
    map.setLayoutProperty('basemap-far', 'visibility', off ? 'none' : 'visible');
    map.setLayoutProperty('basemap-near', 'visibility',
                          (off || split == null) ? 'none' : 'visible');
    if (split == null) {
      map.setLayerZoomRange('basemap-far', 0, 24);
      map.setPaintProperty('basemap-far', 'raster-opacity', 1);
    } else {
      map.setLayerZoomRange('basemap-far',  0, Math.ceil(split) + 1);
      map.setLayerZoomRange('basemap-near', Math.floor(split) - 1, 24);
      map.setPaintProperty('basemap-far',  'raster-opacity',
        ['step', ['zoom'], 1, split, 0]);
      map.setPaintProperty('basemap-near', 'raster-opacity',
        ['step', ['zoom'], 0, split, 1]);
    }
  } catch (e) {}
}

/* Reflect the current on/offline state. Idempotent — safe at init, on a probe
   change, or from the force toggle. */
function applyOnlineState() {
  if (!map || !map.getLayer || !map.getLayer('basemap-far')) return;
  var off = isOffline();
  if (off === (_styleMode === 'local')) return;      /* already correct */
  _styleMode = off ? 'local' : 'online';
  syncBasemapLayers();
  redrawIfMapVisible();   /* repaint paths in the palette matching the active base */
  /* shadow-ui greys its toggle offline, but it listens to the raw online/offline
     events — the signal iOS doesn't reliably fire. Drive it from the truth. */
  if (typeof refreshShadowAvailability === 'function') refreshShadowAvailability();
  renderBasemapPicker();
}

/* Force offline. No longer has a UI control — connectivity is detected
   automatically — but kept as a console hook for testing the offline path:
   `forceOfflineMap(true)`. Removing it would also strip _forceOffline from
   isOffline(), so it stays.
   Formerly Settings → "force offline". Routed through applyOnlineState rather than a full
   initMap() teardown, so the camera, markers and layers survive the flip and a
   forced switch takes exactly the same path as a real one. */
function forceOfflineMap(on) {
  _forceOffline = on;
  applyOnlineState();
  if (!on) probeConnectivity();   /* releasing the toggle → re-confirm the real state */
}

/* Wire the connectivity signals once. The events are the fast path; the interval
   is the guarantee that covers iOS airplane mode, which fires no event at all.
   All of them just call the probe — none of them assumes a state. */
if (!window._scConnHook) { window._scConnHook = true;
  addEventListener('online',  probeConnectivity);
  addEventListener('offline', probeConnectivity);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) probeConnectivity();
  });
  setInterval(function () { if (!document.hidden) probeConnectivity(); }, 15000);
}

/* ── Map init (globe-only, local basemap with online upgrade) ────────── */

function initMap() {
  if (map) {
    map.remove();
    map = null;
    mapReady = false;
    mapMarkers = [];
    pathMarkers = [];
    deckOverlay = null;
  }

  /* ONE style, containing both the local layers and the online basemap on top.
     Its initial visibility follows the device's own online state — a starting
     guess that probeConnectivity() corrects within a few seconds, and which
     applyOnlineState() no-ops on if it was already right. */
  loadBasemapData().then(function (data) {
    _styleMode = isOffline() ? 'local' : 'online';
    createMap(buildLocalStyle(data));
    renderBasemapPicker();
    probeConnectivity();
  }).catch(function () {
    /* No local data — the online raster alone still gives a usable map. */
    _styleMode = 'online';
    createMap(buildLocalStyle({}));
  });
}

/* Resting zoom for the globe. On narrow viewports start more zoomed-out so users
   can see where on the globe they are; desktop starts at the usual level. Used
   both at map creation and whenever a new eclipse re-frames the camera, so the
   two can never disagree. */
function defaultZoom() {
  return window.matchMedia('(min-width: 900px)').matches ? 2 : 0.6;
}

function createMap(style) {
  map = new maplibregl.Map({
    container: 'map',
    style: style,
    center: [0, 30],
    /* Compact attribution: credit collapses behind an (i) that expands on tap.
       MapLibre otherwise decides this from container width and leaves the full
       text inline on a phone, where it eats a strip of the map. Nothing is
       removed — it's one tap away, and CSS keeps desktop showing it inline. */
    attributionControl: { compact: true },
    zoom: defaultZoom(),
    minZoom: 0.4, maxZoom: 18,
    maxPitch: 0,
    dragRotate: false,
    touchPitch: false,
    pitchWithRotate: false,
    preserveDrawingBuffer: true,
  });

  /* Globe spins on its AXIS only — the two-finger twist would otherwise roll it
     off-axis and the deck.gl path overlay can't follow, drifting out of register.
     Keeps pinch-zoom. */
  map.touchZoomRotate.disableRotation();

  map.on('style.load', function () {
    try { map.setProjection({ type: 'globe' }); } catch (e) {}
    try { map.setFog({
      'color': '#b8d0e8', 'high-color': '#7aadce',
      'horizon-blend': 0.04, 'space-color': '#0a0c1a', 'star-intensity': 0.3
    }); } catch (e) {}

    /* These are map-level listeners — they persist across setStyle, so wire them
       once. (Re-adding on every style.load stacked duplicates on each basemap
       swap.) */
    if (!_mapEventsWired) {
      map.on('render', updateMarkerOcclusion);
      map.on('zoom', updateOvalVisibility);
      map.on('zoom', updateArrowScale);
      _mapEventsWired = true;
    }

    if (!deckOverlay) {
      deckOverlay = new DeckGL.MapboxOverlay({ layers: [], interleaved: false });
      map.addControl(deckOverlay);
      var dc = document.getElementById('deckgl-overlay');
      if (dc) dc.style.pointerEvents = 'none';
      if (setDeckLayers._pending) {
        deckOverlay.setProps({ layers: setDeckLayers._pending });
        setDeckLayers._pending = null;
      }
    }

    /* (The OpenFreeMap tint that used to live here is gone with the vector
       style it existed for. Every basemap is now raster, drawn over our own
       correctly-coloured local layers, so there is nothing to recolour.) */

    /* The style declares both basemap layers plainly; this is what gives them
       their zoom ranges and initial visibility. Must run before mapReady, so
       nothing ever sees both layers drawing at once. */
    syncBasemapLayers();

    mapReady = true;
  });

  /* Any map error while the online basemap is SHOWING is a reason to re-check the
     network — a tile failing mid-pan is how a connection drop announces itself
     fastest, and the probe is self-guarding, so calling it liberally is cheap.
     A source failure additionally hides the online layer straight away rather
     than waiting for the probe. Map-level listener: it survives everything,
     since the style is now built once and never replaced. */
  map.on('error', function (e) {
    if (_styleMode !== 'online') return;
    probeConnectivity();
    var msg = (e && e.error && e.error.message) || '';
    if (/style|source/i.test(msg)) {
      console.warn('Online basemap failed, falling back to local:', msg);
      _styleMode = 'online';        /* force applyOnlineState to act */
      _online = false;
      applyOnlineState();
    }
  });

  /* A click that merely brings the window to the front should NOT drop a pin.
     The browser gives no flag for this, but the timing is unambiguous: when a
     click focuses a background window, the `focus` event fires in the same
     gesture as the mousedown that caused it. So a click arriving within a few
     frames of regaining focus is a focus-restoring click and nothing more.
     Alt-tabbing back and then deliberately clicking is well outside the window,
     so intentional clicks are never swallowed. */
  var _focusAt = 0;
  var REFOCUS_GRACE_MS = 300;
  window.addEventListener('focus', function () { _focusAt = Date.now(); });

  map.on('click', function (e) {
    if (Date.now() - _focusAt < REFOCUS_GRACE_MS) {
      _focusAt = 0;      /* consume it — the next click is a real one */
      return;
    }
    /* In globe mode a click in empty space still returns a lngLat clamped to the
       globe's edge (the "nearest spot on land" snap). Detect that by re-projecting
       the returned lngLat back to screen: an ON-globe click round-trips to the
       cursor; an OFF-globe click lands on the limb, far from where you clicked.
       Off-globe → clear any set location instead of selecting a point. */
    var back = map.project(e.lngLat);
    var offGlobe = Math.hypot(back.x - e.point.x, back.y - e.point.y) > 8;
    if (offGlobe) { clearLocationFilter(); return; }
    onMapClick(e.lngLat.lat, e.lngLat.lng);
  });
  map.on('mousemove', function () { map.getCanvas().style.cursor = 'crosshair'; });
  document.getElementById('map-popup-close').addEventListener('click', function () {
    document.getElementById('map-popup').style.display = 'none';
  });
}

function onMapTabActivated() {
  if (!map || !mapReady) { initMap(); return; }
  map.resize();
  /* updateMapState will fire via the activeTab event subscription below. */
}

/* map-status overlay: two layers — a persistent eclipse label (low priority)
   and a transient message (loading/error). Transient wins when set. */
var _mapStatusTransient = null;

function setMapStatus(msg) {
  _mapStatusTransient = msg || null;
  _renderMapStatus();
}

function _renderMapStatus() {
  var el = document.getElementById('map-status');
  if (!el) return;
  var text = _mapStatusTransient || (selectedEntry
    ? fmtDate(selectedEntry) + '\u2002\u2014\u2002' + typeName((selectedEntry.eclipse_type||'P')[0])
    : null);
  if (text) { el.textContent = text; el.style.display = 'block'; }
  else      { el.style.display = 'none'; }
}

function updateMapState() {
  if (!mapReady)      return;
  if (!selectedEntry) return;   /* not ready yet (init-time only) */
  var isNewEclipse = (selectedEntry !== updateMapState._lastEntry);
  updateMapState._lastEntry = selectedEntry;
  /* Keep terrain shadows (if on) anchored to the selected eclipse's max. */
  if (typeof shadowOnEclipseChange === 'function') shadowOnEclipseChange(isNewEclipse);
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

    /* CAMERA. A new eclipse re-frames the view: back out to the resting zoom so
       the whole path is visible, centred on the pinned location if there is one,
       otherwise on the eclipse itself (greatest-eclipse point, or the path's mean
       position for partials, longitudes unwrapped around the first point so an
       antimeridian-crossing path averages to the correct side).

       _framedEntry — NOT _lastEntry — decides this, and it is only advanced once
       the camera has actually moved on a VISIBLE map. On mobile a deep link can
       select an eclipse while the Search tab is showing; framing then stays owed
       until the user opens the Map tab, where the activeTab subscription re-runs
       us. (Consuming the flag against a hidden container was the "map stays where
       it was" bug.) Map clicks don't come through here — onMapClick owns those —
       so clicking a location never yanks the camera back out. */
    var needsFrame = (selectedEntry !== updateMapState._framedEntry);
    if (needsFrame && isMapVisible()) {
      var ctr = null;
      if (coords) {
        ctr = [coords.lon, coords.lat];
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
      if (ctr) {
        updateMapState._framedEntry = selectedEntry;
        map.easeTo({ center: ctr, zoom: defaultZoom(), duration: 800 });
      }
    }
  }).catch(function () { setMapStatus('Could not load path'); });

  if (coords) {
    addObserverMarker(coords.lat, coords.lon,
      localResult && localResult.visible ? localResult.sun.az : null);
    /* Auto-populate map popup if local result already available */
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

/* Path chunks are gzipped JSON keyed by cat_no.
   We decompress with the native DecompressionStream (Chrome 80+, Firefox 113+,
   Safari 16.4+). No third-party library required, which keeps the app fully
   offline-capable. If we ever need to support older browsers, vendor pako
   locally and add a fallback here. */
function loadPathChunk(entry) {
  var chunkName = entry._chunk;
  if (!chunkName) return Promise.resolve(null);
  if (pathCache[chunkName]) return Promise.resolve(pathCache[chunkName]);
  var url = DATA_BASE+'/paths/paths_'+chunkName+'.json.gz?v='+BUILD;
  return fetch(url).then(function (r) {
    if (!r.ok) return null;
    /* Pipe the gzipped body through DecompressionStream, then parse as JSON. */
    var ds = new DecompressionStream('gzip');
    var stream = r.body.pipeThrough(ds);
    return new Response(stream).json();
  }).then(function (d) {
    if (d) pathCache[chunkName] = d;
    return d;
  }).catch(function (err) {
    console.error('loadPathChunk failed for', chunkName, err);
    return null;
  });
}

/* HTML markers (observer dot, greatest-eclipse dot) are DOM overlays. MapLibre
   v5 fades an occluded marker to opacityWhenCovered (default 0.2) but leaves it
   faintly visible AND still clickable — so a marker on the far side of the globe
   can be seen through the planet and can capture a click meant for the surface
   (placing a pin). Use MapLibre's own globe-aware occlusion test as the SINGLE
   predicate for both hiding and disabling interaction, so the two can never
   disagree (the prior bug: a hand-rolled 90° test diverged from the true
   horizon, leaving a band that was clickable but visually behind the globe).
   Runs on every 'render'. */
function updateMarkerOcclusion() {
  if (!map || !map.transform || !map.transform.isLocationOccluded) return;
  function update(m) {
    var occluded = map.transform.isLocationOccluded(m.getLngLat());
    var el  = m.getElement();
    var vis = occluded ? 'hidden' : 'visible';
    var pe  = occluded ? 'none'   : 'auto';
    if (el.style.visibility    !== vis) el.style.visibility    = vis;
    if (el.style.pointerEvents !== pe)  el.style.pointerEvents = pe;
  }
  mapMarkers.forEach(update);
  pathMarkers.forEach(update);
}

function clearMapMarkers()  { _arrowEls = []; _pinEls = []; mapMarkers.forEach(function(m){m.remove();}); mapMarkers=[]; }
function clearPathMarkers() { pathMarkers.forEach(function(m){m.remove();}); pathMarkers=[]; }

/* ── Observer push-pin (ported from the Cesium build) ─────────────────────
   A drawn pin (round head + tapering spike), NOT a dot — the TIP is the actual
   coordinate. Canvas is drawn once and cached, then reused as the marker element. */
var _pinImg = null;

/* Pin geometry — ONE source of truth. The art is drawn from these, and the
   marker is anchored from these, so the tip can never drift from the point.
   PIN_TIP_Y is where the needle's point lands inside the canvas; the leftover
   PIN_H - PIN_TIP_Y is the margin that keeps the contact dot from clipping. */
var PIN_W = 44, PIN_H = 66, PIN_TIP_Y = 64;

function pinImage() {
  if (_pinImg) return _pinImg;
  var W = PIN_W, H = PIN_H, c = document.createElement('canvas');
  c.width = W; c.height = H;
  var x = c.getContext('2d');
  var cx = W / 2, headR = 12, headY = headR + 3;
  var neckY = headY + headR * 0.78;
  var tipY  = PIN_TIP_Y;

  /* CONTACT DOT at the tip — marks the exact coordinate and plants the pin. */
  x.beginPath();
  x.arc(cx, tipY, 3.2, 0, Math.PI * 2);
  x.fillStyle = 'rgba(30,26,22,0.92)';
  x.fill();
  x.lineWidth = 1.1; x.strokeStyle = 'rgba(255,255,255,0.9)';
  x.stroke();

  /* NEEDLE — darker steel with a dark outline, so it holds on desert, forest and ice. */
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

/* ── Sun arrow sizing (ported behaviour from the Cesium build) ────────────
   The arrow is a fixed 44px on screen — EXCEPT that it must never sprawl across
   a continent when zoomed out. Cesium capped its world length at 300 km; here we
   do the same by shrinking the element once 44px would exceed that ground span. */
var ARROW_PX    = 44;
var ARROW_MAX_M = 3.0e5;      /* 300 km world cap */
var ARROW_MIN_S = 0.55;       /* never shrink below this, or it disappears when zoomed out */
var _arrowEls   = [];         /* live arrow elements, each with ._az */
var _pinEls     = [];         /* live pin elements, scaled by zoom */

/* Cesium used scaleByDistance NearFarScalar(5.0e5 -> 1.0, 2.0e7 -> 0.45):
   full size up close, 45% when zoomed right out. Those camera distances map to
   roughly zoom 9 and zoom 2 in MapLibre, so reproduce the same ramp here. */
var PIN_Z_NEAR = 9,  PIN_S_NEAR = 1.0;
var PIN_Z_FAR  = 2,  PIN_S_FAR  = 0.45;

function pinScale() {
  if (!map) return PIN_S_NEAR;
  var z = map.getZoom();
  if (z >= PIN_Z_NEAR) return PIN_S_NEAR;
  if (z <= PIN_Z_FAR)  return PIN_S_FAR;
  var t = (z - PIN_Z_FAR) / (PIN_Z_NEAR - PIN_Z_FAR);
  return PIN_S_FAR + t * (PIN_S_NEAR - PIN_S_FAR);
}

function arrowScale() {
  if (!map) return 1;
  var lat = map.getCenter().lat;
  /* Web-Mercator ground resolution at this zoom/latitude */
  var mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, map.getZoom());
  var groundLen = ARROW_PX * mpp;
  var s = groundLen > ARROW_MAX_M ? (ARROW_MAX_M / groundLen) : 1;
  return Math.max(ARROW_MIN_S, s);
}

function updateArrowScale() {
  var s = arrowScale();
  for (var i = 0; i < _arrowEls.length; i++) {
    var el = _arrowEls[i];
    el.style.transform = 'rotate(' + el._az + 'deg) scale(' + s + ')';
  }
  var ps = pinScale();
  for (var j = 0; j < _pinEls.length; j++) {
    _pinEls[j].style.transform = 'scale(' + ps + ')';
  }
}

/* Two co-located markers: the sun arrow rotates about the coordinate (anchor
   'center'), while the pin hangs above it with its TIP on the coordinate
   (anchor 'bottom'). Keeping them separate means the arrow geometry is
   unaffected by the pin's height. */
function addObserverMarker(lat, lon, sunAz) {
  if (sunAz !== null && sunAz !== undefined) {
    var wrap = document.createElement('div');
    wrap.className = 'sun-arrow-wrap';
    var arrow = document.createElement('div');
    arrow.className = 'sun-arrow';
    arrow._az = sunAz - 90;
    arrow.style.transformOrigin = '0 50%';
    arrow.style.transform = 'rotate(' + arrow._az + 'deg) scale(' + arrowScale() + ')';
    wrap.appendChild(arrow);
    _arrowEls.push(arrow);
    var ma = new maplibregl.Marker({ element: wrap, anchor: 'center' })
      .setLngLat([lon, lat]).addTo(map);
    mapMarkers.push(ma);
  }

  /* The pin hangs inside a WRAPPER, exactly as the arrow does. MapLibre writes
     its own `transform` onto whichever element it is handed, so the marker
     element must stay untouched — the zoom scale goes on the inner <img>.
     (Scaling the marker element itself erased MapLibre's translate and threw
     the pin to the container's top-left corner until the next internal update.)
     Anchoring: 'bottom' puts the element's bottom EDGE on the coordinate, but
     the needle's point is PIN_TIP_Y, so the offset makes up the difference —
     and with transform-origin on that same tip, it holds at every scale. */
  var pinWrap = document.createElement('div');
  pinWrap.className = 'observer-pin-wrap';
  pinWrap.style.width  = PIN_W + 'px';
  pinWrap.style.height = PIN_H + 'px';

  var pin = document.createElement('img');
  pin.src = pinImageURL();
  pin.className = 'observer-pin';
  pin.width = PIN_W; pin.height = PIN_H;
  pin.style.width = PIN_W + 'px'; pin.style.height = PIN_H + 'px';
  pin.style.transformOrigin = '50% ' + PIN_TIP_Y + 'px';   /* scale about the TIP */
  pin.style.transform = 'scale(' + pinScale() + ')';
  pinWrap.appendChild(pin);
  _pinEls.push(pin);

  var m = new maplibregl.Marker({
      element: pinWrap,
      anchor:  'bottom',
      offset:  [0, PIN_H - PIN_TIP_Y]
    }).setLngLat([lon, lat]).addTo(map);
  mapMarkers.push(m);
}

/* Rasterise the drawn pin once; every marker reuses the same data URL. */
var _pinURL = null;
function pinImageURL() {
  if (!_pinURL) _pinURL = pinImage().toDataURL('image/png');
  return _pinURL;
}

/* Greatest-eclipse marker: orange diamond (#f08a1e) — deliberately distinct from
   the red observer pin/arrow. Ported from the Cesium build. */
function addGEMarker(lat, lon) {
  var d = document.createElement('div');
  d.className = 'ge-diamond';
  var m = new maplibregl.Marker({ element: d, anchor: 'center' })
    .setLngLat([lon, lat]).addTo(map);
  pathMarkers.push(m);
}

function onMapClick(lat, lon) {
  map.easeTo({ center: [lon, lat], duration: 800 });
  var search = document.getElementById('search');
  var f      = parseSearch(search.value);
  /* An explicit map click is an explicit location — drop any city name so it
     can't re-resolve and override the clicked point on the next parse. */
  search.value = filterToString(Object.assign({}, f, {
    coords: { lat: lat, lon: lon },
    city:   null
  }));
  onSearchChanged(true);
  lookupElevationAndTz(lat, lon);

  /* Auto-trigger location scan so the eclipse list populates */
  if (eclipseIndex.length) scanLocation();

  /* Single computation via computeLocal — it sets localResult, renders the
     data panel, and we then feed the same result into the map popup. */
  showMapPopupLoading(lat, lon);
  computeLocal().then(function (out) {
    if (!out) return;
    showMapPopup(lat, lon, out.result, out.rec);
    clearMapMarkers();
    addObserverMarker(lat, lon, out.result.visible ? out.result.sun.az : null);
    /* On desktop (sidebar layout), if the user is on the Search sub-tab,
       swap to Details so the local circumstances appear. Otherwise leave
       the sidebar tab alone (they're already on Details or exploring overlays).
       On mobile, stay on the map so the user can see the pin they placed —
       and throb the Details tab instead, so it's clear fresh circumstances
       are waiting there. (scFlagFreshDetails is defined in index.html; the
       animation itself is gated to narrow viewports in app.css.) */
    if (window.matchMedia('(min-width: 900px)').matches) {
      if (sidebarTab === 'search') sidebarTab = 'eclipse';
    } else if (typeof window.scFlagFreshDetails === 'function') {
      window.scFlagFreshDetails();
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

function clearMapLayers() {
  if (deckOverlay) deckOverlay.setProps({ layers: [] });
}

/* Auto-redraw the map whenever the data behind it changes — but only when
   the map is actually visible. On desktop the map is always visible (sidebar
   layout); on mobile, only when the Map tab is active. */
function isMapVisible() {
  return mapReady && (activeTab === 'map' ||
                      window.matchMedia('(min-width: 900px)').matches);
}
function redrawIfMapVisible() {
  if (isMapVisible()) updateMapState();
}
AppState.on('selectedEntry', redrawIfMapVisible);
AppState.on('localResult',   redrawIfMapVisible);
AppState.on('mapReady',      redrawIfMapVisible);
AppState.on('activeTab',     redrawIfMapVisible);

/* ── Geodesic densification ───────────────────────────────────────────
   MapLibre draws GeoJSON LineStrings as straight lines in lon/lat space.
   Near the poles, adjacent vertices can have large longitude jumps while
   staying at nearly the same latitude — the renderer then draws a long
   chord at high latitude instead of the correct short arc over the pole.

   Fix: insert intermediate great-circle points between any two consecutive
   vertices whose great-circle distance exceeds MAX_SEG_KM.

   Maths: convert [lon,lat] → unit 3-vector, slerp along the great circle,
   convert back. We preserve the original unwrapped longitude convention
   (lons may exceed ±180) by tracking cumulative longitude offset. */

var MAX_SEG_KM = 50;   /* base threshold; tightened at high latitudes */
var R_EARTH    = 6371; /* km */

function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }

function gcDistance(lon1, lat1, lon2, lat2) {
  /* Great-circle distance in km via haversine. Uses normalised lons. */
  var φ1 = toRad(lat1), φ2 = toRad(lat2);
  var Δφ = toRad(lat2 - lat1);
  var Δλ = toRad(((lon2 - lon1 + 540) % 360) - 180);
  var a = Math.sin(Δφ/2)*Math.sin(Δφ/2) +
          Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)*Math.sin(Δλ/2);
  return 2 * R_EARTH * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* Clip a polyline to the mercator-safe latitude range.
   MapLibre's GeoJSON pipeline uses geojson-vt internally which is mercator-based
   and breaks above ~85°. We clip segments that cross the boundary by linear
   interpolation to the exact crossing point, preserving the path up to that limit. */

function densifySegment(seg) {
  /* Takes a polyline [[lon,lat], ...] and returns a densified version.
     The threshold tightens near the poles: at high latitudes MapLibre's
     straight 3D chords accumulate drift even for short segments, because
     the curvature of parallels is extreme. Scaling by cos(midLat) keeps
     the angular chord error constant regardless of latitude.
     Unwrapped longitudes (|lon| > 180) are handled by normalising for
     the great-circle maths, then restoring the offset afterwards. */
  if (!seg || seg.length < 2) return seg;
  var out = [seg[0]];
  for (var i = 0; i < seg.length - 1; i++) {
    var p0 = seg[i], p1 = seg[i+1];
    var lon0 = p0[0], lat0 = p0[1];
    var lon1 = p1[0], lat1 = p1[1];
    var dist = gcDistance(lon0, lat0, lon1, lat1);
    /* Latitude-adaptive threshold: tighten near the poles so that the
       angular extent of each chord stays below ~0.5° regardless of lat. */
    var midLat = (lat0 + lat1) / 2;
    var cosLat = Math.cos(toRad(Math.abs(midLat)));
    var threshold = Math.max(2, MAX_SEG_KM * Math.max(cosLat, 0.04));
    if (dist <= threshold) { out.push(p1); continue; }

    /* Number of sub-segments needed */
    var n = Math.ceil(dist / threshold);

    /* Slerp in 3D unit-vector space.
       Use the normalised lon for the slerp; we'll restore the offset. */
    var normLon0 = ((lon0 + 180) % 360) - 180;
    var normLon1 = ((lon1 + 180) % 360) - 180;
    /* Prefer the short-way-around delta */
    var dLon = normLon1 - normLon0;
    if (dLon >  180) dLon -= 360;
    if (dLon < -180) dLon += 360;

    var φ0 = toRad(lat0), λ0 = toRad(normLon0);
    var φ1 = toRad(lat1), λ1 = toRad(normLon0 + dLon);

    var x0 = Math.cos(φ0)*Math.cos(λ0), y0 = Math.cos(φ0)*Math.sin(λ0), z0 = Math.sin(φ0);
    var x1 = Math.cos(φ1)*Math.cos(λ1), y1 = Math.cos(φ1)*Math.sin(λ1), z1 = Math.sin(φ1);

    /* Angular distance between unit vectors */
    var dot = Math.max(-1, Math.min(1, x0*x1 + y0*y1 + z0*z1));
    var omega = Math.acos(dot);

    /* Longitude offset to restore unwrapped convention */
    var lonOffset = lon0 - normLon0;

    for (var j = 1; j < n; j++) {
      var t = j / n;
      var sinOmega = Math.sin(omega);
      var s0 = (sinOmega > 1e-10) ? Math.sin((1-t)*omega) / sinOmega : (1-t);
      var s1 = (sinOmega > 1e-10) ? Math.sin(t*omega)    / sinOmega : t;
      var xi = s0*x0 + s1*x1, yi = s0*y0 + s1*y1, zi = s0*z0 + s1*z1;
      var latI = toDeg(Math.asin(Math.max(-1, Math.min(1, zi))));
      var lonI = toDeg(Math.atan2(yi, xi)) + lonOffset;
      out.push([Math.round(lonI * 1e5) / 1e5, Math.round(latI * 1e5) / 1e5]);
    }
    out.push(p1);
  }
  return out;
}

/* ── Custom WebGL rendering ──────────────────────────────────────────
   All eclipse path geometry bypasses MapLibre's geojson-vt pipeline,
   which uses mercator internally and corrupts geometry above ~85°N/S.
   Instead we convert lon/lat → MercatorCoordinate (0..1 range) in JS,
   upload a Float32 buffer once, and draw with MapLibre's projectTile()
   shader — which handles globe projection correctly at any latitude.

   All eclipse geometry uses deck.gl PathLayer and SolidPolygonLayer.  */

/* ── deck.gl rendering helpers ───────────────────────────────────────
   All eclipse geometry is rendered via deck.gl PathLayer and
   SolidPolygonLayer, which handle polar regions, antimeridian crossings,
   line width, and spherical polygon fills correctly and natively.

   setDeckLayers() is the single point of truth — call it with an array
   of deck.gl layer objects whenever the eclipse changes.               */

function setDeckLayers(layers) {
  _deckLayers = layers;
  if (deckOverlay) {
    deckOverlay.setProps({ layers: layers });
  } else {
    /* Overlay not yet initialized — store and apply when ready */
    setDeckLayers._pending = layers;
  }
}

/* Toggle the umbra-oval layers' visibility when zoom crosses OVAL_HIDE_ZOOM.
   deck.gl diffs layers by reference, so we clone the affected layers with the
   new `visible` value into a fresh array and re-push. Matched by id PREFIX,
   because the ovals are drawn as two layers — a fill and an outline — which
   must appear and disappear together. Markers are MapLibre objects, not deck
   layers, so they are untouched. */
function updateOvalVisibility() {
  if (!deckOverlay || !_deckLayers) return;
  var vis = map.getZoom() < OVAL_HIDE_ZOOM;
  var changed = false;
  var next = _deckLayers.map(function (L) {
    if (L && L.id.indexOf('umbra-ovals') === 0 && L.props.visible !== vis) {
      changed = true;
      return L.clone({ visible: vis });
    }
    return L;
  });
  if (changed) setDeckLayers(next);
}

/* Path colours follow whatever is underneath. Satellite imagery is dark, so the
   deep blues and greens that read well on street, topo and NE2 sink into it; on
   a dark base the same paths need high-luminance versions instead. Each basemap
   declares its own tone (`dark` in BASEMAPS) rather than this function testing
   for particular keys, so adding a basemap means adding one flag, not editing
   this. Offline is always the light case — NE2 is pale.

   ONE definition, read by every layer. The colours used to be RGB literals at
   four separate call sites, which is how they drifted out of step in the first
   place. */
function pathPalette() {
  var bm = (_styleMode === 'online') ? BASEMAPS[_basemapKey()] : null;
  if (bm && bm.dark) return {
    penumbra:    [130, 205, 255, 225],
    umbraTotal:  [255, 176,  64],
    umbraAnnfmt: [140, 200, 255],
    centreline:  [255,  96,  72, 255],
    green:       [170, 255,  90, 255],
    /* Outline the umbra ovals rather than filling them. A translucent amber
       wash over dark green imagery reads as a stain, not as shading; the
       outline alone carries the same information cleanly. */
    ovalFillAlpha: 0
  };
  return {
    penumbra:    [ 42,  90, 140, 200],
    umbraTotal:  [139,  74,   0],
    umbraAnnfmt: [ 26,  74, 122],
    centreline:  [204,  34,   0, 255],
    green:       [  0, 160,   0, 255],
    ovalFillAlpha: 60      /* a light base takes the soft fill well */
  };
}

/* Flatten segments into a single array of paths for PathLayer */
function wrapContinuous(pts) {
  if (!pts || !pts.length) return pts;
  var out = [[((pts[0][0]+180)%360+360)%360-180, pts[0][1]]];
  for (var i = 1; i < pts.length; i++) {
    var prev = out[i-1][0];
    var lon = ((pts[i][0]+180)%360+360)%360-180;
    while (lon - prev >  180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, pts[i][1]]);
  }
  return out;
}

function segsToPathData(segs, id) {
  if (!segs) return [];
  return (segs).map(function(seg, i) {
    if (!seg || seg.length < 2) return null;
    return { id: id + '_' + i, path: wrapContinuous(densifySegment(seg)) };
  }).filter(Boolean);
}




/* Umbra ovals are informative at regional/global zoom but counterproductive up
   close (they darken the very point being inspected). Hide them past a zoom
   threshold. The ovals layer is built with visible: zoom < OVAL_HIDE_ZOOM, and
   a 'zoom' listener toggles that one layer's visibility via setProps when the
   threshold is crossed — touching only the deck layers, not markers. */
var OVAL_HIDE_ZOOM = 7;

function drawEclipsePath(ep) {
  clearMapLayers();
  var isCentral = /[TAH]/.test(ep.type||'');
  var isTotal   = /[TH]/.test(ep.type||'');
  var PAL       = pathPalette();
  var uc        = isTotal ? PAL.umbraTotal : PAL.umbraAnnfmt;
  var layers    = [];

  /* Polygon offset pushes all deck.gl geometry just above the globe surface
     to prevent z-fighting when using interleaved: true. */

  /* ── Penumbra boundary lines ───────────────────────────────────────
     Penumbra limits, terminator lemniscates, and bisector — all drawn
     as the same style of thin blue line. No fill: the closed-ring
     assembly across penumbra ± terminator joins is not always
     well-defined (polar shadows have no closed ring at all), so we
     omit it entirely and let the outlines speak for themselves. */
  var penPaths = ['penumbra_n','penumbra_s','terminator_first','terminator_last']
    .reduce(function(acc, key) {
      var segs = ep[key];
      return segs && segs.length ? acc.concat(segsToPathData(segs, key)) : acc;
    }, []);
  if (penPaths.length) {
    layers.push(new DeckGL.PathLayer({
      id: 'penumbra-lines',
      data: penPaths,
      getPath: function(d) { return d.path; },
      getColor: PAL.penumbra,
      getWidth: 1.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
    }));
  }

  /* ── Umbra fill (disabled) ────────────────────────────────────────────
     SolidPolygonLayer triangulates the corridor as a flat lon/lat polygon.
     Paths that pass near a pole or cross the antimeridian produce wrong
     fills (concentric polar rings, hemisphere-spanning sweeps). Until
     this is properly solved, the corridor is communicated by its outline
     paths alone (drawn below). See BACKLOG.md for the full diagnosis. */

  /* ── Umbra boundary lines ────────────────────────────────────────── */
  if (isCentral && ep.umbra_n && ep.umbra_s) {
    var umbraPaths = segsToPathData(ep.umbra_n, 'un')
                       .concat(segsToPathData(ep.umbra_s, 'us'));
    layers.push(new DeckGL.PathLayer({
      id: 'umbra-lines',
      data: umbraPaths,
      getPath: function(d) { return d.path; },
      getColor: uc.concat([255]),
      getWidth: 1.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
    }));
  }

  /* ── Umbra ovals ───────────────────────────────────────────────────── */
  if (/[TAH]/.test(ep.type||'') && ep.umbra_ovals && ep.umbra_ovals.length) {
    /* Derived from the same palette as everything else, so the ovals can't drift
       out of step with the umbra path they belong to. */
    var ovalBase = /[TH]/.test(ep.type||'') ? PAL.umbraTotal : PAL.umbraAnnfmt;
    var ovalFill = ovalBase.concat([PAL.ovalFillAlpha]);
    /* On a dark base the outline is the only thing drawn, so it is brightened
       and fully opaque; over a light fill it stays a quiet edge. */
    var ovalLine = PAL.ovalFillAlpha > 0
      ? ovalBase.map(function (c) { return Math.min(255, c + 45); }).concat([200])
      : ovalBase.concat([255]);
    var ovalData = ep.umbra_ovals
      .filter(function(r) { return r && r.length >= 3; })
      .map(function(r, i) {
        var ring = (r[0][0]===r[r.length-1][0] && r[0][1]===r[r.length-1][1])
          ? r.slice(0,-1) : r;
        return { id: 'oval-'+i, polygon: wrapContinuous(ring) };
      })
      .filter(function(d) {
        /* Drop rings that encircle a pole (continuous longitude winds a full
           turn). Their flat lon/lat triangulation is the inside-out sliver, and
           this renderer cannot fill a polar cap. Omitting is honest; the fix is
           the Cesium v2 pass. Normal ovals (winding ~0) are unaffected. */
        var p = d.polygon;
        return Math.abs(p[p.length-1][0] - p[0][0]) <= 270;
      });
    if (ovalData.length) {
      /* SolidPolygonLayer FILLS ONLY — it has no stroke. (`stroked` and
         `getLineColor` live on PolygonLayer and were silently ignored here, so
         the ovals never actually had an outline.) The outline is therefore its
         own PathLayer, matching how every other path in this file is drawn.
         Both carry the same id prefix so updateOvalVisibility toggles them as
         one. On a dark base the fill is dropped and only the outline remains. */
      if (PAL.ovalFillAlpha > 0) {
        layers.push(new DeckGL.SolidPolygonLayer({
          id:           'umbra-ovals',
          data:         ovalData,
          visible:      map.getZoom() < OVAL_HIDE_ZOOM,
          getPolygon:   function(d) { return d.polygon; },
          getFillColor: ovalFill,
          filled:       true,
        }));
      }
      layers.push(new DeckGL.PathLayer({
        id:              'umbra-ovals-outline',
        data:            ovalData,
        visible:         map.getZoom() < OVAL_HIDE_ZOOM,
        /* Close the ring: ovalData strips the duplicated last point for the
           fill's triangulation, but an open path would leave a visible gap. */
        getPath:         function(d) { return d.polygon.concat([d.polygon[0]]); },
        getColor:        ovalLine,
        getWidth:        1.2,
        widthUnits:      'pixels',
        widthMinPixels:  1,
      }));
    }
  }

  /* ── Centreline ─────────────────────────────────────────────────── */
  if (isCentral && ep.centreline) {
    layers.push(new DeckGL.PathLayer({
      id: 'centreline',
      data: segsToPathData(ep.centreline, 'cl'),
      getPath: function(d) { return d.path; },
      getColor: PAL.centreline,
      getWidth: 1.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
    }));
  }

  /* ── Green line (Maximum-on-Horizon curve) ────────────────────────────
     Locus of points whose greatest eclipse occurs with the sun on the horizon;
     the true termination boundary for the limits/centreline. The data is a flat
     [lon,lat] list with `null` delimiters between separate components (a
     two-blob eclipse has two, a figure-8 has one self-connected loop). Split on
     the null delimiters, and additionally guard against antimeridian wrap
     within a component (a ~360° longitude jump streaks across the map even when
     the two points are physically close at high latitude). */
  if (isCentral && ep.green_curve && ep.green_curve.length) {
    var gsegs = [], gcur = [];
    function flushG() { if (gcur.length > 1) gsegs.push(gcur); gcur = []; }
    for (var gi = 0; gi < ep.green_curve.length; gi++) {
      var gp = ep.green_curve[gi];
      if (gp === null) { flushG(); continue; }       // component delimiter
      if (gcur.length) {
        var prevG = gcur[gcur.length - 1];
        if (Math.abs(gp[0] - prevG[0]) > 180) flushG(); // antimeridian wrap
      }
      gcur.push(gp);
    }
    flushG();
    layers.push(new DeckGL.PathLayer({
      id: 'green_curve',
      data: gsegs.map(function(s){ return { path: s }; }),
      getPath: function(d) { return d.path; },
      getColor: PAL.green,
      getWidth: 1.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
    }));
  }

  /* ── Greatest eclipse point — pixel-space marker (zoom-invariant) ─── */
  if (ep.ge && ep.ge[0] != null) {
    addGEMarker(ep.ge[1], ep.ge[0]);
  }

  setDeckLayers(layers);
}

