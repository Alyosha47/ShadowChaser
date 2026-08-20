/* imagery.js — LIVE SATELLITE PICTURE ("Photo", #F2d)
 *
 * The third cloud mode. Average is a climatology, Now is a MEASUREMENT of cloud
 * derived from infrared, and this is a PHOTOGRAPH: the geostationary view drawn
 * as imagery rather than as an overlay.
 *
 * WHY IT EXISTS, given Now already does something cleverer. Scored against
 * EUMETSAT's operational mask, Now finds about half the cloud that is there and
 * about a third of it over sea (HANDOFF s10A.8) — infrared cannot see cloud near
 * the temperature of the surface beneath it, and shallow scattered cumulus over
 * warm water is exactly that. Photo COMPLEMENTS Now: the picture is what to look
 * at, Now is what to read a value from. Both stay.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE DOES NOT COMPOSITE ANYTHING. MAPLIBRE DOES THE WORK.
 *
 * The previous version fetched one large image per view and composited the
 * satellites into a canvas by hand. Every expensive symptom came from that one
 * decision: a pan refetched the whole view (20-second loads), the canvas ended
 * at the requested box (bare basemap at the limb, no wrap), the halves either
 * side of the antemeridian were composed separately (the seam), and every
 * satellite boundary had to be blended in our own code (black wedges, ragged
 * terminator, speckle).
 *
 * A MapLibre `raster` source with a {bbox-epsg-3857} template turns any WMS into
 * a tiled source. Tiling, caching, wrapping past the antemeridian, progressive
 * zoom and pan then belong to the PLATFORM. Measured 2026-08-20, 256 px tiles:
 * GIBS 0.35 s, EUMETSAT 0.16-0.73 s, both cacheable.
 *
 * Photo never needed the canvas. Now genuinely does — it reads pixels to decode
 * infrared into temperature. Photo only ever DISPLAYS pixels. It inherited the
 * compositor by being written as a copy of satellite.js, and that inheritance
 * was the bug.
 *
 * HANDOFF's standing rule is to name the platform API before writing per-frame
 * code. The API is map.addSource(id, {type:'raster', tiles:[...]}).
 *
 * DELIBERATELY GONE: compose(), readPixels(), hasContent(), the dateline split,
 * the weight blend, the night-alternate machinery, the lit-fraction gate, the
 * JPEG black test, desaturation, the whole-globe wrap. If a defect from that era
 * reappears it is not in this file — it is in the tiles.
 *
 * WHAT IT COSTS. The basemap is hidden where imagery covers, because clear sky
 * in a picture is a COLOUR, not transparency — approach #1 in s10A.9. That is
 * acceptable only because the track, the umbra and the pin are drawn by deck.gl
 * ABOVE every MapLibre layer, so they survive. Nothing samples a picture either:
 * Cloud.sampleAt() returns a number and this cannot.
 */
(function () {
  'use strict';

  var GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
  var GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
  var EUM  = 'https://view.eumetsat.int/geoserver/wms';
  var CREDIT = 'NASA GIBS \u00b7 EUMETSAT';

  /* One entry per disc. Layer identifiers are VERIFIED against each service's
     GetCapabilities, not remembered: GIBS carries GeoColor for the two GOES only
     — there is no Himawari GeoColor and no Meteosat in GIBS at all, which is why
     the Pacific is greyscale and Europe comes from EUMETSAT (START-HERE s3).

     `step` is the publication cadence in minutes and `lag` the largest delay
     worth waiting through. GIBS runs 20-60 min behind (s3); EUMETSAT measured
     9-24 min on 2026-08-19. */
  /* GLOBAL BASE — DISABLED. Set USE_BASE true to restore it.
     A daily polar-orbiter mosaic, painted UNDER the geostationary discs. It
     loads first and complete, so the picture snapped to a full clean planet and
     was then overpainted disc by disc as each live layer streamed in — the same
     map redrawn three more times, each pass a different tone where day met
     night. Whole-planet coverage is not worth that if the covering is hours old:
     a stale picture that LOOKS current is worse than an honest gap.
     Kept because it is the right answer if a provider disappears again, as
     EUMETSAT did on 2026-08-20.

     A daily polar-orbiter mosaic, painted UNDER the geostationary discs. It is hours old rather than minutes, so it never wins where a live
     disc exists — but it means a gap in the live coverage shows yesterday's
     cloud instead of bare basemap, and it covers the poles and the whole of the
     Meteosat sector, which no GIBS geostationary layer reaches.

     It earned its place on 2026-08-20, when EUMETSAT stopped sending
     access-control-allow-origin on GetMap (measured: present on
     GetCapabilities, absent on 10 of 10 GetMap calls across four endpoints).
     Their imagery became unusable from a browser with no warning and nothing we
     could do about it. A base layer on a DIFFERENT service is the only thing
     that keeps the picture whole when one provider disappears. */
  var USE_BASE = false;
  var BASE = { id: 'viirs', name: 'VIIRS', svc: 'gibs', zmax: 9, daily: true,
               layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
               alt: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
               ext: 'jpg', span: 180, lon: 0 };

  /* EUMETSAT IS BACK, VIA OUR OWN DOMAIN. They stopped sending
     access-control-allow-origin on GetMap on 2026-08-20, which took Meteosat out
     of both modes. sat.php is same-origin, so CORS no longer applies; it takes
     discrete WMS parameters because Bluehost's mod_security refuses a scheme in
     a query value and refuses a long base64 blob.
     VIIRS stays underneath regardless — it is what covers a gap when any single
     provider disappears, and one of them just did. */
  var SATS = [
    /* ORDER IS PAINT ORDER. A pixel inside two discs shows the last layer added
       and a raster layer cannot vary per pixel, so the only control we have is
       which disc sits on top. BASE is always added before all of these. */
    /* IODC AND HIMAWARI ARE OUT OF PHOTO, and it is a colour decision, not a
       technical one. Photo is a PICTURE, and a picture made of four different
       renderings does not read as one planet: geocolour is true colour,
       msg_iodc:rgb_natural paints vegetation cyan and desert pink, Himawari's
       visible band is greyscale, and its infrared is a rainbow temperature
       palette. Stacked with a hard limb between each, the result was the
       mishmash of mismatched patches with black edges between them.
       VIIRS below is true colour and covers both sectors, so dropping them costs
       currency in the Indian Ocean and the Pacific — hours instead of minutes —
       and buys a picture that looks like one planet.
       They remain correct and are one line away if that trade is wrong:
         { id: 'iodc', name: 'Meteosat IODC', lon: 45.5, svc: 'eum', step: 15,
           layer: 'msg_iodc:rgb_natural', span: 55 },
         { id: 'himawari', name: 'Himawari', lon: 140.7, svc: 'gibs', step: 10,
           layer: 'Himawari_AHI_Band3_Red_Visible_1km', zmax: 7,
           alt: 'Himawari_AHI_Band13_Clean_Infrared', altZmax: 6, span: 70 },
    */
    { id: 'goes-west', name: 'GOES-West', lon: -137.0, svc: 'gibs', step: 10,
      layer: 'GOES-West_ABI_GeoColor',  zmax: 7, span: 70 },
    { id: 'goes-east', name: 'GOES-East', lon: -75.2,  svc: 'gibs', step: 10,
      layer: 'GOES-East_ABI_GeoColor',  zmax: 7, span: 70 },
    { id: 'mtg',       name: 'Meteosat',  lon: 0.0,    svc: 'eum',  step: 10,
      layer: 'mtg_fd:rgb_geocolour',    span: 70 }
  ];

  /* `span` is how many degrees either side of nadir a disc is allowed to draw,
     applied as the source's `bounds`. Without it every disc paints as a full
     rectangle and the overlaps are enormous — the whole of Africa was IODC
     sitting on top of Meteosat. It also stops MapLibre requesting tiles the
     satellite cannot see. IODC is held tighter than the rest because it is the
     odd one out on colour and is only there to fill the gap Meteosat leaves. */

  var MAX_STEPS = 8;      /* frames to walk back before giving a disc up */
  var EMPTY_MAX = 1500;   /* bytes: an empty PNG measures 116-334, real ones
                             tens of thousands. Probing by SIZE avoids decoding,
                             which would need a canvas — the thing this module
                             exists to stop using. */

  var _map = null, _on = false, _busy = false, _err = '', _hidden = false;
  var _times = {};        /* sat.id -> ISO of the frame in use   */
  var _layers = {};       /* sat.id -> layer actually drawn, primary or alt */
  var _missing = [];
  var _listeners = [];

  function ids(sat) { return { src: 'photo-src-' + sat.id, lyr: 'photo-lyr-' + sat.id }; }

  function announce() {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](); } catch (e) { /* one bad listener must not stop the rest */ }
    }
  }

  /* ------------------------------------------------------------ frame times */

  /* EUMETSAT keeps the milliseconds and GIBS must not gain them — a stamp in the
     wrong shape returns a blank image with no error, which is the worst possible
     failure because it looks like clear sky. */
  function stamp(sat, ms) {
    var t = new Date(ms);
    /* The polar mosaic is published once a DAY and its TIME is a bare date; ask
       it for an hour-precision stamp and it returns nothing. */
    if (sat.daily) {
      return t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate());
    }
    var s = t.getUTCFullYear() + '-' + pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate()) +
            'T' + pad2(t.getUTCHours()) + ':' + pad2(t.getUTCMinutes()) + ':00';
    return s + (sat.svc === 'eum' ? '.000Z' : 'Z');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function base(sat) { return sat.svc === 'gibs' ? GIBS : EUM; }

  /* GIBS IS A TILE CACHE OVER WMTS AND A RENDERER OVER WMS, and using the wrong
     one is what made Photo slow and blanked half the map.
     A WMS GetMap is rendered on demand: MapLibre asks for hundreds of tiles at a
     low zoom, they fill the browser's six-connections-per-host budget, GIBS
     starts returning blanks under the load, and every OTHER request to the same
     host queues behind them — including Now's, which is why a mode this file
     does not touch got slow. Measured 24 tiles at six-way concurrency: WMTS 1.6s
     with zero blanks, WMS 3.3s.
     EUMETSAT stays on WMS because its GeoWebCache endpoint returns an error. */
  function zmaxOf(sat, layer) {
    if (sat.svc !== 'gibs') return 7;
    if (layer && layer === sat.alt && sat.altZmax) return sat.altZmax;
    return sat.zmax;
  }

  function wmtsTile(sat, iso, layer, z, x, y) {
    return GIBS + '/' + (layer || sat.layer) + '/default/' + iso +
      '/GoogleMapsCompatible_Level' + zmaxOf(sat, layer) +
      '/' + z + '/' + y + '/' + x + '.' + (sat.ext || 'png');
  }

  var PROXY = '/sat.php';

  /* ------------------------------------------------------ tile retry protocol
     MAPLIBRE NEVER RETRIES A FAILED TILE. One transient failure leaves a hole
     for as long as the source lives, and GIBS drops roughly one request in five
     (START-HERE §3) — measured from a live console log, tiles that 404'd in the
     browser returned 200 from a clean fetch seconds later, including z0/0/0
     which covers the whole world and cannot be a genuine gap. That is the
     blank-patchwork the map fills with.

     addProtocol is MapLibre's own extension point for exactly this: it hands us
     the fetch, so a retry is ours to add without touching how tiles are
     requested, cached, wrapped or drawn. Registered once, globally.

     A tile that is still missing after the retries is answered with a
     TRANSPARENT PNG rather than an error, because most of those are real: a
     geostationary disc covers a circle and the tile grid is square, so the
     corners genuinely have no data. Returning an image keeps them out of the
     console and stops MapLibre marking the tile as errored. */
  var SCHEME = 'sctile';
  var CLEAR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
                  'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  var RETRIES = 2, RETRY_MS = 400;
  var _protoReady = false;

  function clearTile() {
    var bin = atob(CLEAR_PNG), n = bin.length, a = new Uint8Array(n), i;
    for (i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    return a.buffer;
  }

  function registerProtocol() {
    if (_protoReady) return;
    var gl = window.maplibregl;
    if (!gl || !gl.addProtocol) return;      /* older build: tiles still load, just no retry */
    _protoReady = true;
    gl.addProtocol(SCHEME, function (params, abortController) {
      var url = params.url.replace(SCHEME + '://', '');
      var tries = 0;
      function go() {
        return fetch(url, { signal: abortController && abortController.signal })
          .then(function (r) {
            if (r.ok) return r.arrayBuffer().then(function (b) { return { data: b }; });
            if (tries++ < RETRIES) {
              return new Promise(function (res) { setTimeout(res, RETRY_MS * tries); }).then(go);
            }
            return { data: clearTile() };
          }, function (e) {
            if (e && e.name === 'AbortError') throw e;
            if (tries++ < RETRIES) {
              return new Promise(function (res) { setTimeout(res, RETRY_MS * tries); }).then(go);
            }
            return { data: clearTile() };
          });
      }
      return go();
    });
  }

  function wms(sat, iso, bbox, w, h, layer) {
    /* Same-origin for EUMETSAT; see the note on SATS above. */
    if (sat.svc === 'eum') {
      return PROXY + '?s=eum&l=' + encodeURIComponent(layer || sat.layer) +
        '&b=' + bbox + '&w=' + w + '&h=' + h + '&t=' + encodeURIComponent(iso);
    }
    return (sat.svc === 'gibs' ? GIBS_WMS : EUM) +
      '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
      '&LAYERS=' + encodeURIComponent(layer || sat.layer) +
      '&STYLES=&CRS=EPSG%3A3857&FORMAT=image%2Fpng&TRANSPARENT=TRUE' +
      '&WIDTH=' + w + '&HEIGHT=' + h +
      '&BBOX=' + bbox +
      '&TIME=' + encodeURIComponent(iso);
  }

  /* The tile template handed to MapLibre. */
  function template(sat, iso, layer, px) {
    px = px || 256;
    return (sat.svc === 'gibs')
      ? wmtsTile(sat, iso, layer, '{z}', '{x}', '{y}')
      : wms(sat, iso, '{bbox-epsg-3857}', px, px, layer);
  }

  /* One tile at the satellite's nadir: inside the disc, so an empty answer means
     the FRAME is missing rather than that we asked about part of the world this
     satellite cannot see. */
  function probeUrl(sat, iso, layer) {
    if (sat.svc !== 'gibs') return wms(sat, iso, nadirBox(sat), 64, 32, layer);
    var n = 4, x = Math.floor((sat.lon + 180) / 360 * n);
    if (x < 0) x = 0;
    if (x >= n) x = n - 1;
    return wmtsTile(sat, iso, layer, 2, x, n / 2);
  }

  /* A small box at the satellite's nadir: somewhere guaranteed to be inside the
     disc, so an empty answer means the FRAME is missing rather than that we
     asked about part of the world this satellite cannot see. */
  function nadirBox(sat) {
    var R = 6378137.0, d = 6e5;
    var x = R * sat.lon * Math.PI / 180;
    return [(x - d), -d, (x + d), d].map(function (v) { return v.toFixed(1); }).join(',');
  }

  /* Resolve the newest published frame by ASKING, one small image at a time.
     Sequential on purpose: the first answer is usually the first request, and
     firing eight in parallel to discard seven is waste that shows up on a phone
     in a field. */
  function newestFrame(sat) {
    var step = sat.daily ? 86400000 : sat.step * 60000;
    /* TODAY'S POLAR MOSAIC IS INCOMPLETE. It is assembled swath by swath as the
       orbits come in, so the longitudes the satellite has not crossed yet are
       simply absent — rendered at z3 it left Europe, Africa and Asia black while
       the Americas were full. A probe at one point cannot detect this because
       the gap is REGIONAL, not global. Start a day back, where every longitude
       has been covered. */
    var start = Math.floor(Date.now() / step) * step - (sat.daily ? step : 0);
    /* Himawari's only GIBS colour product is REFLECTED SUNLIGHT, so after dark
       it publishes nothing at all and the Pacific goes bare — measured, the
       whole right-hand third of a z3 world mosaic. Its clean-infrared layer is
       published around the clock. Try the daylight layer across the whole window
       first, so a lit disc is never given up in favour of infrared. */
    var layers = sat.alt ? [sat.layer, sat.alt] : [sat.layer];
    var li = 0, k = 0;

    function tryOne() {
      if (k >= MAX_STEPS) {
        if (li + 1 < layers.length) { li++; k = 0; return tryOne(); }
        return null;
      }
      var lay = layers[li];
      var iso = stamp(sat, start - (k++) * step);
      return fetch(probeUrl(sat, iso, lay))
        .then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (b) {
          return (b && b.size > EMPTY_MAX) ? { iso: iso, layer: lay } : tryOne();
        }, function () { return tryOne(); });
    }
    return Promise.resolve().then(tryOne);
  }

  /* ------------------------------------------------------------ map plumbing */

  function dropOne(sat) {
    var id = ids(sat);
    if (_map.getLayer(id.lyr)) _map.removeLayer(id.lyr);
    if (_map.getSource(id.src)) _map.removeSource(id.src);
  }

  /* MapLibre wants one plain west/east pair. A disc that straddles the
     antemeridian cannot be expressed that way, so it is widened to the whole
     world and the platform's own wrapping handles it — simpler than splitting,
     which is precisely the split that used to leave a seam. */
  function boundsOf(sat) {
    var w = sat.lon - sat.span, e = sat.lon + sat.span;
    if (w < -180 || e > 180) return [-180, -85, 180, 85];
    return [w, -85, e, 85];
  }

  function addOne(sat, iso, layer) {
    var id = ids(sat);
    dropOne(sat);
    /* EUMETSAT TILES ARE 512, NOT 256. Every one of them is a separate PHP
       process on shared hosting fetching a fresh render, and a cold tile is
       seconds — a first paint of the Meteosat disc at 256 was ~75s of queued
       requests. Quartering the count is the single biggest lever available
       without giving up the disc. GIBS stays at 256: those are pre-cut cached
       tiles straight from their CDN and cost nothing to ask for. */
    var px = (sat.svc === 'eum') ? 512 : 256;
    registerProtocol();
    /* Absolute URL first: the protocol handler strips the scheme and fetches
       what remains, and a relative '/sat.php' would not survive that. */
    var tpl = template(sat, iso, layer, px);
    var origin = (window.location && window.location.origin) || '';
    if (tpl.charAt(0) === '/' && origin) tpl = origin + tpl;
    _map.addSource(id.src, {
      type: 'raster',
      tiles: [(_protoReady ? SCHEME + '://' : '') + tpl],
      tileSize: px,
      /* Stop MapLibre asking past the source's real resolution — beyond this it
         stretches the last tile, which is correct and free. Without it every
         zoom-in fires a fresh round of requests that can only 404. */
      maxzoom: zmaxOf(sat, layer),
      bounds: boundsOf(sat),
      attribution: CREDIT
    });
    /* The infrared alternate arrives in the palette Now decodes to temperature:
       a grey ramp for warm scenes with COLOUR for tops colder than about -12C.
       Beside four true-colour discs that reads as rainbow confetti. MapLibre
       desaturates a raster source itself — no pixel access, no canvas, no second
       decoder. It is not free: the coldest tops are dark blues, so greying them
       makes storm cores darker than the cloud around them rather than brighter.
       That is a presentation compromise on 8% of pixels (measured on a live
       frame), taken because the alternative is confetti. */
    var paint = { 'raster-opacity': 1, 'raster-fade-duration': 0 };
    if (layer && layer !== sat.layer) paint['raster-saturation'] = -1;
    _map.addLayer({ id: id.lyr, type: 'raster', source: id.src, paint: paint,
                    layout: { visibility: _hidden ? 'none' : 'visible' } });
  }

  function removeAll() {
    if (!_map) return;
    dropOne(BASE);   /* unconditional: it may be left over from a previous build */
    for (var i = 0; i < SATS.length; i++) dropOne(SATS[i]);
  }

  function build() {
    _busy = true; announce();
    var all = USE_BASE ? [BASE].concat(SATS) : SATS.slice();
    return Promise.all(all.map(function (sat) {
      return newestFrame(sat).then(function (f) { return { sat: sat, f: f }; });
    })).then(function (res) {
      removeAll();
      _times = {}; _layers = {}; _missing = []; _err = '';
      var any = false, i;
      /* Added in SATS order, so the overlap winner is decided here and stays
         decided rather than changing as the view moves. */
      for (i = 0; i < res.length; i++) {
        if (res[i].f) {
          _times[res[i].sat.id] = res[i].f.iso;
          _layers[res[i].sat.id] = res[i].f.layer;
          addOne(res[i].sat, res[i].f.iso, res[i].f.layer);
          any = true;
        } else if (res[i].sat !== BASE) {
          /* The base going quiet is not worth naming in the caption — the live
             discs are what the user is looking at. */
          _missing.push(res[i].sat.name);
        }
      }
      if (!any) _err = 'No satellite imagery available';
      _busy = false; announce();
      return any;
    }, function (e) {
      _busy = false; _err = String((e && e.message) || e); announce(); return false;
    });
  }

  /* ------------------------------------------------------------- public API */

  /* SWITCHING MODES MUST NOT THROW THE TILES AWAY. Rebuilding means resolving
     every frame again and re-requesting every tile, so coming back to a picture
     that was on screen a moment ago costs seconds. If the sources are still
     there, just unhide them; the five-minute refresh keeps them current. */
  function built() {
    var i;
    for (i = 0; i < SATS.length; i++) {
      if (_map.getLayer(ids(SATS[i]).lyr)) return true;
    }
    return !!(_map.getLayer(ids(BASE).lyr));
  }

  function on(m) {
    _map = m || _map;
    if (!_map) return Promise.resolve(false);
    _on = true;
    if (built()) { show(); announce(); return Promise.resolve(true); }
    return build();
  }

  function eachLayer(fn) {
    var all = [BASE].concat(SATS), i, id;
    for (i = 0; i < all.length; i++) {
      id = ids(all[i]).lyr;
      if (_map.getLayer(id)) { try { fn(id); } catch (e) {} }
    }
  }

  function hide() {
    if (!_map) return;
    eachLayer(function (id) { _map.setLayoutProperty(id, 'visibility', 'none'); });
    _hidden = true;
  }

  function show() {
    if (!_map) return;
    eachLayer(function (id) { _map.setLayoutProperty(id, 'visibility', 'visible'); });
    _hidden = false;
  }

  function off() {
    _on = false;
    removeAll();
    _times = {}; _layers = {}; _missing = [];
    announce();
  }

  /* A newer frame is a NEW URL, so the source is rebuilt: MapLibre caches tiles
     by URL and would otherwise serve the old picture forever. Rebuilt layers
     must inherit the CURRENT visibility, or a refresh while Photo is hidden
     makes it reappear over Now. */
  function invalidate() {
    if (!_on || !_map) return Promise.resolve(false);
    return build();
  }

  /* The caption's age must come from the LIVE discs. Including the daily base
     would report the picture as a day old whenever it happened to sort last. */
  function shownTime() {
    var best = null, i, v;
    for (i = 0; i < SATS.length; i++) {
      v = _times[SATS[i].id];
      if (v && (!best || v > best)) best = v;
    }
    return best;
  }

  window.Imagery = {
    version: '2026-08-20a',
    CREDIT: CREDIT,
    on: on,
    off: off,
    isOn: function () { return _on; },
    hide: hide,
    show: show,
    isHidden: function () { return _hidden; },
    invalidate: invalidate,
    onFrame: function (fn) { if (typeof fn === 'function') _listeners.push(fn); },
    shownTime: shownTime,
    frames: function () {
      var a = [], k;
      for (k in _times) { if (Object.prototype.hasOwnProperty.call(_times, k)) a.push(_times[k]); }
      return a;
    },
    missing: function () { return _missing.slice(); },
    error: function () { return _err; },
    loading: function () { return _busy; },
    diagnose: function () {
      var out = [], i, all = USE_BASE ? [BASE].concat(SATS) : SATS.slice();
      for (i = 0; i < all.length; i++) {
        out.push({ sat: all[i].id,
                   layer: _layers[all[i].id] || null,
                   alt: !!(_layers[all[i].id] && _layers[all[i].id] !== all[i].layer),
                   iso: _times[all[i].id] || null,
                   onMap: !!(_map && _map.getLayer(ids(all[i]).lyr)) });
      }
      return { on: _on, busy: _busy, missing: _missing.slice(),
               shown: shownTime(), error: _err, slots: out };
    },
    _sats: function () { return USE_BASE ? [BASE].concat(SATS) : SATS.slice(); },
    _wms: wms,
    _template: template
  };
}());
