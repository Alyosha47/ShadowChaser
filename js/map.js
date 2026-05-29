/* ── Map ─────────────────────────────────────────────────────────────── */

/* `map` and `mapReady` are AppState properties; see js/state.js. */
var pathCache      = {};
/* `pathMarkers` are bound to the selected eclipse (e.g. greatest-eclipse dot)
   and only change when selectedEntry changes. `mapMarkers` are bound to the
   observer location and may be cleared independently when the user clicks. */
var mapMarkers     = [];
var pathMarkers    = [];
var currentPathKey = null;
var deckOverlay = null; /* deck.gl MapboxOverlay */

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

var ONLINE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
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
    fetchGz(base + 'ocean.geojson.gz?v='     + BUILD),
    fetchGz(base + 'countries.geojson.gz?v=' + BUILD),
    fetchGz(base + 'lakes.geojson.gz?v='     + BUILD),
    fetchGz(base + 'rivers.geojson.gz?v='    + BUILD),
    fetchGz(base + 'cities.geojson.gz?v='    + BUILD),
  ]).then(function (r) {
    basemapData = {
      land:      r[0], ocean:    r[1], countries: r[2],
      lakes:     r[3], rivers:   r[4], cities:    r[5],
    };
    /* Cities became available — any pending city-name token in the search
       input couldn't resolve at first parse. Re-run the search now so
       those tokens light up. */
    if (typeof onSearchChanged === 'function') onSearchChanged(true);
    return basemapData;
  });
  return basemapLoading;
}

/* Build a MapLibre style spec from whatever basemap data we have.
   Colours match the existing dark theme.

   Layer order matters for the borders-into-sea fix:
     background → land fill → country lines → ocean fill (clips sea-borders)
     → coastline stroke → lakes → rivers → cities

   The ocean fill is painted on top of the country boundary lines, which
   naturally clips any border segment that extends into the sea. */
function buildLocalStyle(data) {
  var BG       = '#0a0c0f';   /* deep space — ocean & background */
  var LAND     = '#1a2230';   /* dark slate — land fill          */
  var BORDER   = '#2e3f52';   /* dim blue-grey — country lines   */
  var COAST    = '#3a5068';   /* slightly brighter — coastline   */
  var RIVER    = '#1e3248';   /* dark river lines                */
  var LAKE     = BG;          /* lakes same as ocean             */
  var CITY     = '#c8a96e';   /* gold city dots                  */

  var sources = {};
  var layers  = [{ id: 'background', type: 'background', paint: { 'background-color': BG } }];

  /* 1. Land fill */
  if (data.land) {
    sources.land = { type: 'geojson', data: data.land };
    layers.push({ id: 'land-fill', type: 'fill', source: 'land',
      paint: { 'fill-color': LAND, 'fill-opacity': 1, 'fill-antialias': true } });
  }

  /* 2. Country border lines — drawn before ocean so sea-crossing edges get covered */
  if (data.countries) {
    sources.countries = { type: 'geojson', data: data.countries };
    layers.push({ id: 'countries-line', type: 'line', source: 'countries',
      paint: { 'line-color': BORDER, 'line-width': 0.7, 'line-opacity': 0.9 } });
  }

  /* 3. Ocean fill — paints over any border lines that strayed into the sea */
  if (data.ocean) {
    sources.ocean = { type: 'geojson', data: data.ocean };
    layers.push({ id: 'ocean-fill', type: 'fill', source: 'ocean',
      paint: { 'fill-color': BG, 'fill-opacity': 1, 'fill-antialias': true } });
  }

  /* 4. Coastline stroke — sharp land/sea edge drawn on top of both */
  if (data.land) {
    layers.push({ id: 'coast-line', type: 'line', source: 'land',
      paint: { 'line-color': COAST, 'line-width': 0.6, 'line-opacity': 0.8 } });
  }

  /* 5. Lakes */
  if (data.lakes) {
    sources.lakes = { type: 'geojson', data: data.lakes };
    layers.push({ id: 'lakes-fill', type: 'fill', source: 'lakes',
      paint: { 'fill-color': LAKE, 'fill-opacity': 1 } });
    layers.push({ id: 'lakes-line', type: 'line', source: 'lakes',
      paint: { 'line-color': COAST, 'line-width': 0.4, 'line-opacity': 0.6 } });
  }

  /* 6. Rivers */
  if (data.rivers) {
    sources.rivers = { type: 'geojson', data: data.rivers };
    layers.push({ id: 'rivers-line', type: 'line', source: 'rivers',
      paint: { 'line-color': RIVER, 'line-width': 0.5, 'line-opacity': 0.7 } });
  }

  /* 7. Cities — four layers, one per rank tier, each with its own minzoom.
        This is more reliable than a zoom-expression filter in MapLibre.
        Rank: 1=mega-cities, 2=capitals+>2M, 3=>500k, 4=>100k. */
  if (data.cities) {
    sources.cities = { type: 'geojson', data: data.cities };
    var cityPaint = function(baseRadius) {
      return {
        'circle-color': CITY,
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          1, baseRadius, 5, baseRadius * 1.6, 9, baseRadius * 2.4],
        'circle-opacity': 0.9,
        'circle-stroke-width': 0.5,
        'circle-stroke-color': BG,
      };
    };
    /* Rank 1: mega-cities (>5M), always visible */
    layers.push({ id: 'cities-r1', type: 'circle', source: 'cities',
      filter: ['==', ['get', 'rank'], 1],
      paint: cityPaint(2.5) });
    /* Rank 2: capitals + >2M, from zoom 2 */
    layers.push({ id: 'cities-r2', type: 'circle', source: 'cities',
      minzoom: 2, filter: ['==', ['get', 'rank'], 2],
      paint: cityPaint(1.8) });
    /* Rank 3: >500k, from zoom 3.5 */
    layers.push({ id: 'cities-r3', type: 'circle', source: 'cities',
      minzoom: 3.5, filter: ['==', ['get', 'rank'], 3],
      paint: cityPaint(1.4) });
    /* Rank 4: >100k, from zoom 5 */
    layers.push({ id: 'cities-r4', type: 'circle', source: 'cities',
      minzoom: 5, filter: ['==', ['get', 'rank'], 4],
      paint: cityPaint(1.1) });
  }

  return {
    version: 8,
    projection: { type: 'globe' },
    sources: sources,
    layers: layers,
  };
}

/* Probe the network with a short-timeout HEAD against the online style.
   Resolves true if reachable, false otherwise. */
function probeOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.resolve(false);
  }
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; resolve(false); } }, 1500);
    fetch(ONLINE_STYLE_URL, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' })
      .then(function () { if (!done) { done = true; clearTimeout(timer); resolve(true); } })
      .catch(function () { if (!done) { done = true; clearTimeout(timer); resolve(false); } });
  });
}


/* ── Map init (globe-only, local basemap with online upgrade) ────────── */

function initMap() {
  if (map) {
    map.remove();
    map = null;
    mapReady = false;
    mapMarkers = [];
    pathMarkers = [];
  }

  /* Always start the map with whatever basemap is available. We load
     local data first (it's needed as fallback either way), then probe
     the network and upgrade to the online style if reachable. */
  loadBasemapData().then(function (data) {
    var localStyle = buildLocalStyle(data);

    /* Decide initial style: online if reachable, local otherwise. */
    return probeOnline().then(function (online) {
      var startStyle = online ? ONLINE_STYLE_URL : localStyle;
      createMap(startStyle, /*isOnline=*/online, localStyle);
    });
  }).catch(function (err) {
    console.error('Basemap load failed:', err);
    /* Last resort: try the online style anyway, with no local fallback. */
    createMap(ONLINE_STYLE_URL, true, null);
  });
}

function createMap(style, isOnline, localStyleFallback) {
  map = new maplibregl.Map({
    container: 'map',
    style: style,
    /* On narrow viewports start more zoomed-out so users can see where on the
       globe they are. Desktop starts at the usual zoom level. */
    center: [0, 30],
    zoom: window.matchMedia('(min-width: 900px)').matches ? 2 : 0.6,
    minZoom: 0.4, maxZoom: 18,
    maxPitch: 0,
    dragRotate: false,
    touchPitch: false,
    pitchWithRotate: false,
    preserveDrawingBuffer: true,
  });

  /* If we tried online and the style fails to load, swap in the local one. */
  var fellBack = false;
  if (isOnline && localStyleFallback) {
    map.on('error', function (e) {
      if (fellBack) return;
      /* Only react to style/source errors, not random tile glitches. */
      var msg = (e && e.error && e.error.message) || '';
      if (/style|source|tile/i.test(msg)) {
        fellBack = true;
        console.warn('Online basemap failed, falling back to local:', msg);
        try { map.setStyle(localStyleFallback); } catch (err) { console.error(err); }
      }
    });
  }

  map.on('style.load', function () {
    /* Belt-and-braces: re-assert globe in case the style overrode it. */
    try { map.setProjection({ type: 'globe' }); } catch (e) {}
    /* Initialize deck.gl overlay */
    if (!deckOverlay) {
      deckOverlay = new DeckGL.MapboxOverlay({ layers: [], interleaved: false });
      map.addControl(deckOverlay);
      if (setDeckLayers._pending) {
        deckOverlay.setProps({ layers: setDeckLayers._pending });
        setDeckLayers._pending = null;
      }
    }

    /* Tint the OpenFreeMap style to match our palette. The local style
       is already styled, so we skip this branch for it. */
    if (isOnline && !fellBack) {
      map.getStyle().layers.forEach(function (layer) {
        try {
          if (layer.id === 'background') {
            map.setPaintProperty(layer.id, 'background-color', '#e8e0d8');
          } else if (layer.type === 'fill') {
            if (/water/.test(layer.id)) {
              map.setPaintProperty(layer.id, 'fill-color', '#b8d0e8');
            } else if (/land|cover|park|grass|wood|sand|scrub/.test(layer.id)) {
              map.setPaintProperty(layer.id, 'fill-color', '#d4e8c8');
              map.setPaintProperty(layer.id, 'fill-opacity', 0.8);
            }
          } else if (layer.type === 'line' && /water/.test(layer.id)) {
            map.setPaintProperty(layer.id, 'line-color', '#a0c0dc');
          }
        } catch (e) {}
      });
    }

    mapReady = true;
  });

  map.on('click', function (e) { onMapClick(e.lngLat.lat, e.lngLat.lng); });
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
  if (text) { el.textContent = text; el.style.display = ''; }
  else      { el.style.display = 'none'; }
}

function updateMapState() {
  if (!mapReady)      return;
  if (!selectedEntry) return;   /* not ready yet (init-time only) */
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

    /* Camera: observer location if set, otherwise fit path/GE */
    if (coords) {
      map.flyTo({ center:[coords.lon, coords.lat], zoom:Math.max(map.getZoom(),4), duration:800 });
    } else {
      var allPts = [];
      ['centreline','penumbra_n','penumbra_s'].forEach(function(k){
        (ep[k]||[]).forEach(function(seg){ allPts = allPts.concat(seg); });
      });
      var lons = allPts.map(function(p){return p[0];});
      var lats = allPts.map(function(p){return p[1];});
      var lonSpan = lons.length
        ? Math.max.apply(null,lons) - Math.min.apply(null,lons) : 0;
      if (allPts.length && lonSpan <= 180) {
        /* Normal case: path doesn't wrap the antimeridian. */
        map.fitBounds([
          [Math.min.apply(null,lons), Math.min.apply(null,lats)],
          [Math.max.apply(null,lons), Math.max.apply(null,lats)]
        ], { padding:40, duration:800, maxZoom:6 });
      } else if (ep.ge && ep.ge[0] != null) {
        /* Antimeridian-crossing path (raw lon min/max would span the globe
           the wrong way and swing the camera to the far side) — center on
           the greatest-eclipse point instead. */
        map.flyTo({ center:ep.ge, zoom:3, duration:800 });
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

function clearMapMarkers()  { mapMarkers.forEach(function(m){m.remove();}); mapMarkers=[]; }
function clearPathMarkers() { pathMarkers.forEach(function(m){m.remove();}); pathMarkers=[]; }

function addObserverMarker(lat, lon, sunAz) {
  var wrap=document.createElement('div');
  wrap.className='sun-arrow-wrap';
  var dot=document.createElement('div');
  dot.className='observer-dot';
  wrap.appendChild(dot);
  if (sunAz!==null&&sunAz!==undefined) {
    var arrow=document.createElement('div');
    arrow.className='sun-arrow';
    arrow.style.transform='rotate('+(sunAz-90)+'deg)';
    wrap.appendChild(arrow);
  }
  var m=new maplibregl.Marker({element:wrap,anchor:'center'})
    .setLngLat([lon,lat]).addTo(map);
  mapMarkers.push(m);
}

function addGEMarker(lat, lon) {
  var dot = document.createElement('div');
  dot.className = 'ge-dot';
  var m = new maplibregl.Marker({ element: dot, anchor: 'center' })
    .setLngLat([lon, lat]).addTo(map);
  pathMarkers.push(m);
}

function onMapClick(lat, lon) {
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
       On mobile, stay on the map so the user can see the pin they placed. */
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
  if (deckOverlay) {
    deckOverlay.setProps({ layers: layers });
  } else {
    /* Overlay not yet initialized — store and apply when ready */
    setDeckLayers._pending = layers;
  }
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

/* Build corridor polygon data from two edge arrays for SolidPolygonLayer.
   Uses arc-length parameterization to pair vertices correctly. */
function corridorToPolygonData(nSegs, sSegs, id) {
  if (!nSegs||!sSegs||!nSegs.length||!sSegs.length) return [];
  var north = densifySegment(nSegs[0]);
  var south = densifySegment(sSegs[0]);
  if (!north||!north.length||!south||!south.length) return [];

  function arcLengthParams(edge) {
    var dists=[0];
    for(var i=1;i<edge.length;i++){
      var p0=edge[i-1],p1=edge[i];
      dists.push(dists[i-1]+gcDistance(p0[0],p0[1],p1[0],p1[1]));
    }
    var total=dists[dists.length-1];
    return dists.map(function(d){return total>0?d/total:0;});
  }

  var np=arcLengthParams(north), sp=arcLengthParams(south);
  function resampleByParam(edge,srcP,tgtP){
    var out=[],si=0;
    for(var i=0;i<tgtP.length;i++){
      var t=tgtP[i];
      while(si<srcP.length-2&&srcP[si+1]<t)si++;
      var t0=srcP[si],t1=srcP[si+1]||t0,f=t1>t0?(t-t0)/(t1-t0):0;
      var a=edge[si],b=edge[Math.min(si+1,edge.length-1)];
      out.push([a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f]);
    }
    return out;
  }

  var southR = resampleByParam(south, sp, np);
  /* Closed ring: north forward + south reversed, longitude-continuous. */
  var ring = wrapContinuous(north.concat(southR.slice().reverse()));
  return [{ id: id, polygon: ring }];
}




function drawEclipsePath(ep) {
  clearMapLayers();
  var isCentral = /[TAH]/.test(ep.type||'');
  var isTotal   = /[TH]/.test(ep.type||'');
  var uc        = isTotal ? [139,74,0] : [26,74,122];
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
      getColor: [42,90,140,200],
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
    var ovalFill = /[TH]/.test(ep.type||'') ? [139,74,0,60]   : [26,74,122,60];
    var ovalLine = /[TH]/.test(ep.type||'') ? [180,120,20,200] : [42,90,180,200];
    var ovalData = ep.umbra_ovals
      .filter(function(r) { return r && r.length >= 3; })
      .map(function(r, i) {
        var ring = (r[0][0]===r[r.length-1][0] && r[0][1]===r[r.length-1][1])
          ? r.slice(0,-1) : r;
        return { id: 'oval-'+i, polygon: wrapContinuous(ring) };
      });
    if (ovalData.length) {
      layers.push(new DeckGL.SolidPolygonLayer({
        id:                 'umbra-ovals',
        data:               ovalData,
        getPolygon:         function(d) { return d.polygon; },
        getFillColor:       ovalFill,
        getLineColor:       ovalLine,
        stroked:            true,
        filled:             true,
        lineWidthMinPixels: 1,
      }));
    }
  }

  /* ── Centreline ─────────────────────────────────────────────────── */
  if (isCentral && ep.centreline) {
    layers.push(new DeckGL.PathLayer({
      id: 'centreline',
      data: segsToPathData(ep.centreline, 'cl'),
      getPath: function(d) { return d.path; },
      getColor: [204,34,0,255],
      getWidth: 2.5,
      widthUnits: 'pixels',
      widthMinPixels: 1,
    }));
  }

  /* ── Umbra cap lines (connect n/s horn tips) ──────────────────────────
     PathLayer draws a straight line in lon/lat between the two endpoints.
     If the two horn tips lie on opposite sides of the antimeridian, the
     straight line wraps the long way around the globe. Shift the second
     endpoint by ±360° if that yields a shorter line in longitude. */
  if (isCentral && ep.umbra_n && ep.umbra_s && ep.umbra_n.length && ep.umbra_s.length) {
    function shortPath(a, b) {
      if (!a || !b) return null;
      var lonA = a[0], lonB = b[0];
      while (lonB - lonA >  180) lonB -= 360;
      while (lonB - lonA < -180) lonB += 360;
      return [[lonA, a[1]], [lonB, b[1]]];
    }
    var capPaths = [];
    var unFirst = ep.umbra_n[0][0], usFirst = ep.umbra_s[0][0];
    var cap0 = shortPath(unFirst, usFirst);
    if (cap0) capPaths.push({ id: 'cap0', path: cap0 });
    var unLS = ep.umbra_n[ep.umbra_n.length-1], usLS = ep.umbra_s[ep.umbra_s.length-1];
    var unLast = unLS[unLS.length-1], usLast = usLS[usLS.length-1];
    var cap1 = shortPath(unLast, usLast);
    if (cap1) capPaths.push({ id: 'cap1', path: cap1 });
    if (capPaths.length) {
      layers.push(new DeckGL.PathLayer({
        id: 'umbra-caps',
        data: capPaths,
        getPath: function(d) { return d.path; },
        getColor: [204,34,0,255],
        getWidth: 2,
        widthUnits: 'pixels',
        widthMinPixels: 1,
      }));
    }
  }

  /* ── Greatest eclipse point — pixel-space marker (zoom-invariant) ─── */
  if (ep.ge && ep.ge[0] != null) {
    addGEMarker(ep.ge[1], ep.ge[0]);
  }

  setDeckLayers(layers);
}

