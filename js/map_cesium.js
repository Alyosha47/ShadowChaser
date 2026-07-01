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

var pathCache = {};
/* Cesium data sources let us clear categories independently. */
var dsBasemap     = null;   /* land/countries/lakes/rivers/cities          */
var dsPaths       = null;   /* eclipse path geometry (per selection)        */
var dsObserver    = null;   /* observer dot + sun arrow (per click)         */
var dsGE          = null;   /* greatest-eclipse dot (per selection)         */
var _ovalEntities = [];     /* umbra ovals, toggled by camera height        */
var _clickHandler = null;
var _cityPoints   = null;   /* batched city PointPrimitiveCollection */

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

function loadPathChunk(entry) {
  var chunkName = entry._chunk;
  if (!chunkName) return Promise.resolve(null);
  if (pathCache[chunkName]) return Promise.resolve(pathCache[chunkName]);
  var url = DATA_BASE + '/paths/paths_' + chunkName + '.json.gz?v=' + BUILD;
  return fetch(url).then(function (r) {
    if (!r.ok) return null;
    var stream = r.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).json();
  }).then(function (d) {
    if (d) pathCache[chunkName] = d;
    return d;
  }).catch(function (err) {
    console.error('loadPathChunk failed for', chunkName, err);
    return null;
  });
}

/* ── Offline state (unchanged) ────────────────────────────────────────── */

var _forceOffline = false;
function forceOfflineMap(on) { _forceOffline = on; initMap(); }
function toggleOfflineMap() { _forceOffline = !_forceOffline; initMap(); return _forceOffline; }
function isOffline() { return _forceOffline || navigator.onLine === false; }

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

  loadBasemapData().then(function (data) {
    createMap(data, savedCam);
  }).catch(function () {
    createMap(null, savedCam);
  });
}

function createMap(data, savedCam) {
  var wide = window.matchMedia('(min-width: 900px)').matches;

  map = new Cesium.Viewer('map', {
    baseLayer: false,            /* no imagery tiles — GeoJSON basemap only  */
    baseLayerPicker: false, geocoder: false, timeline: false, animation: false,
    homeButton: false, sceneModePicker: false, navigationHelpButton: false,
    fullscreenButton: false, infoBox: false, selectionIndicator: false,
    creditContainer: document.createElement('div'),   /* hide the credit bar */
    requestRenderMode: true,           /* render only on change — not every frame */
    maximumRenderTimeChange: Infinity, /* static sun: don't force time-based redraws */
  });
  Cesium.Ion.defaultAccessToken = undefined;

  var scene = map.scene, globe = scene.globe;
  globe.baseColor          = col('#dce4ea');   /* pale ice — shows at the poles, where Mercator relief can't reach */
  globe.showGroundAtmosphere = false;   /* haze washes out imagery — off for contrast */
  globe.enableLighting     = false;          /* day/night shading off for now */
  scene.skyAtmosphere.show = true;           /* keep the planet limb glow (cheap, pretty) */
  scene.skyBox.show        = true;           /* Cesium's real star map (sparser/fainter than a baked PNG) */
  scene.sun.show           = false;          /* no sun billboard */
  scene.moon.show          = false;
  scene.backgroundColor    = col('#05070f'); /* clean dark space */
  scene.screenSpaceCameraController.enableTilt = false;  /* axis-style spin   */
  scene.msaaSamples = 4;                                  /* crisp lines — raster base freed the GPU for this */
  scene.fog.enabled = false;                              /* real cost, little value on a globe */
  try { scene.postProcessStages.fxaa.enabled = true; } catch (e) {}

  /* Data sources */
  dsBasemap  = new Cesium.CustomDataSource('basemap');
  dsPaths    = new Cesium.CustomDataSource('paths');
  dsObserver = new Cesium.CustomDataSource('observer');
  dsGE       = new Cesium.CustomDataSource('ge');
  [dsBasemap, dsPaths, dsGE, dsObserver].forEach(function (d) { map.dataSources.add(d); });

  buildBasemap(data);

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

function buildBasemap(data) {
  var scene = map.scene;

  if (!isOffline()) {
    map.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
      url: ONLINE_TILES, maximumLevel: 19, credit: 'Esri',
    }));
    render();
    return;                          /* Esri tiles already have labels/borders */
  }

  /* Offline: a single full-globe Natural Earth II image (equirectangular, covers
     the whole sphere incl. poles — no tiles, no projection seams, no caps). */
  Cesium.SingleTileImageryProvider.fromUrl(
    DATA_BASE + '/basemap/ne2.jpg'
  ).then(function (prov) {
    map.imageryLayers.addImageryProvider(prov);
    render();
  }).catch(function (e) { console.error('Offline NE2 image failed:', e); });

  if (!data) { render(); return; }

  /* Crisp vector lines over the raster — these stay sharp at any zoom (lines are
     sphere-safe on Cesium; only filled polygons caused the earlier artifacts).
     One batched PolylineCollection for all of them. */
  var lines = scene.primitives.add(new Cesium.PolylineCollection());
  function addLines(fc, hex, alpha, width) {
    if (!fc || !fc.features) return;
    var mat = Cesium.Material.fromType('Color', { color: col(hex, alpha) });
    fc.features.forEach(function (f) {
      eachLine(f.geometry, function (line) {
        if (line.length < 2) return;
        lines.add({ positions: Cesium.Cartesian3.fromDegreesArray(flatten(line)),
                    width: width, material: mat });
      });
    });
  }
  addLines(data.land,      COL.COAST,  0.9, 1.2);   /* coastlines  */
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
    _cityPoints = pts;
  }
  render();
}

/* GeoJSON geometry walkers. eachPolygon yields the full ring array
   [outer, hole1, …] so holes (inland seas) are preserved. */
function eachPolygon(geom, cb) {
  if (!geom) return;
  if (geom.type === 'Polygon')           cb(geom.coordinates);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(function (poly) { cb(poly); });
}
function eachLine(geom, cb) {
  if (!geom) return;
  if (geom.type === 'LineString')        cb(geom.coordinates);
  else if (geom.type === 'MultiLineString') geom.coordinates.forEach(cb);
  else if (geom.type === 'Polygon')      geom.coordinates.forEach(cb);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(function (p) { p.forEach(cb); });
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

/* Great-circle destination from (lat,lon) on bearing az for distance d (km). */
function destPoint(lat, lon, az, d) {
  var R = 6371, br = az*Math.PI/180, la = lat*Math.PI/180, lo = lon*Math.PI/180, dr = d/R;
  var la2 = Math.asin(Math.sin(la)*Math.cos(dr) + Math.cos(la)*Math.sin(dr)*Math.cos(br));
  var lo2 = lo + Math.atan2(Math.sin(br)*Math.sin(dr)*Math.cos(la),
                            Math.cos(dr) - Math.sin(la)*Math.sin(la2));
  return { lat: la2*180/Math.PI, lon: lo2*180/Math.PI };
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

function polyline(segs, color, width, idPrefix) {
  if (!segs) return;
  segs.forEach(function (seg) {
    if (!seg || seg.length < 2) return;
    dsPaths.entities.add({ polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(flatten(seg)),
      width: width, material: color, arcType: Cesium.ArcType.GEODESIC, clampToGround: false,
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
