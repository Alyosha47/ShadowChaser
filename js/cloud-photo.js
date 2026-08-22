/* cloud-photo.js — LIVE SATELLITE PICTURE ("Photo", #F2d)
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
 * compositor by being written as a copy of cloud-now.js, and that inheritance
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
    /* Listed WEST TO EAST. Order no longer decides overlaps — the extents are
       clipped at the midpoint between neighbouring nadirs and do not overlap at
       all (see boxesOf) — so this is just the order it is easiest to read.

       HIMAWARI IS BACK IN, and the reason it was out has been overtaken. It was
       dropped as a COLOUR decision: geocolour is true colour and Himawari's only
       GIBS product for this slot is a greyscale visible band (verified against
       WMTSCapabilities on 2026-08-20 — GIBS publishes Air Mass, Band13 infrared
       and Band3 red visible for AHI, and no true-colour product at all), so
       stacked with hard limbs between them the discs read as a mishmash rather
       than one planet.
       But without it there is NO IMAGERY AT ALL from 70E to 153E — a blank slice
       from pole to pole containing China, Japan, Australia and half the Indian
       Ocean. A greyscale panel that shows the weather beats a hole that shows
       none, and the midpoint clipping means it butts its neighbour cleanly
       instead of stacking on it. Its `alt` infrared covers the hours when the
       visible band publishes nothing, desaturated by addOne so the temperature
       palette does not read as confetti.

       IODC stays out: Meteosat already covers its longitudes well and it would
       add a THIRD rendering (rgb_natural paints vegetation cyan and desert pink)
       for a strip Himawari now reaches. One line away if that is ever wanted:
         { id: 'iodc', name: 'Meteosat IODC', lon: 45.5, svc: 'eum', step: 15,
           layer: 'msg_iodc:rgb_natural', span: 55 },
    */
    { id: 'goes-west', name: 'GOES-West', lon: -137.0, svc: 'gibs', step: 10,
      layer: 'GOES-West_ABI_GeoColor',  zmax: 7, span: 70 },
    { id: 'goes-east', name: 'GOES-East', lon: -75.2,  svc: 'gibs', step: 10,
      layer: 'GOES-East_ABI_GeoColor',  zmax: 7, span: 70 },
    { id: 'mtg',       name: 'Meteosat',  lon: 0.0,    svc: 'eum',  step: 10,
      layer: 'mtg_fd:rgb_geocolour',    span: 70 },
    /* INFRARED, NOT THE VISIBLE BAND, and this is the whole reason the slot is
       usable. Band3 is reflected sunlight: rendered at 19:40Z it filled the
       Pacific with a BLACK RECTANGLE over the basemap, because its nadir was at
       dawn and passed the frame probe while most of the disc was still night.
       Band13 publishes round the clock and shows the same cloud at 03:00 as at
       15:00, so the panel is never a black hole and never changes character
       halfway through the day. `grey` desaturates it: the infrared palette adds
       COLOUR below about -12C, which beside true-colour geocolour reads as
       confetti. */
    { id: 'himawari',  name: 'Himawari', lon: 140.7,  svc: 'gibs', step: 10,
      layer: 'Himawari_AHI_Band13_Clean_Infrared', zmax: 6, grey: true,
      span: 70 }
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

  /* A disc that crosses the antemeridian needs two sources (see boxesOf), so an
     id carries a part index. Part 0 keeps the original name, so nothing that
     already knows a layer id has to change. */
  var PARTS = 2;
  function ids(sat, k) {
    var sfx = k ? '-' + k : '';
    return { src: 'photo-src-' + sat.id + sfx, lyr: 'photo-lyr-' + sat.id + sfx };
  }

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
  /* THIS MUST BE FULLY TRANSPARENT, AND FOR MONTHS IT WAS NOT. The previous
     blob decoded to rgb(0,0,255) at alpha 127 — a HALF-OPAQUE BLUE pixel — while
     the comment above it said "transparent". MapLibre stretches a 1x1 tile
     across the whole tile, and at globe zoom one tile is a quarter of the
     planet, so every tile that ran out of retries painted a translucent blue
     slab over the map: the "whole-continent smears", the repeated rectangles at
     different scales, the washed-out wedges. It looked like a projection or
     compositing fault and was neither.
     Verified on write: decodes to 1x1 RGBA (0,0,0,0). If this line is ever
     edited, decode it and check the alpha — test_imagery does exactly that. */
  var CLEAR_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNg' +
                  'YGBgAAAABQABeqhXUAAAAABJRU5ErkJggg==';
  /* FOUR, NOT TWO. The transparent-PNG fallback is PERMANENT — MapLibre keeps
     the tile it was given — so every attempt that runs out becomes a blank
     square on the map until the next five-minute rebuild. At the measured drop
     rate of roughly one in five, three attempts still leaves about 1 tile in
     125 blank, which is a visible hole on a screen full of tiles; five leaves
     about 1 in 3000. The cost is only paid on tiles that are already failing. */
  var RETRIES = 4, RETRY_MS = 400;
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
    for (var k = 0; k < PARTS; k++) {
      var id = ids(sat, k);
      if (_map.getLayer(id.lyr)) _map.removeLayer(id.lyr);
      if (_map.getSource(id.src)) _map.removeSource(id.src);
    }
  }

  /* ------------------------------------------------------------------ extent
     A raster layer cannot vary per pixel, so where two discs overlap the only
     control is which one is allowed to draw there. `span` alone is not enough:
     every disc is smeared and dark at its limb, and the disc whose limb it is
     was painting OVER a neighbour's crisp near-nadir pixels — Meteosat at 70
     degrees off nadir sat on top of GOES-East all the way across the Atlantic,
     which is the band of mismatched patches this replaced.

     So each disc is CLIPPED AT THE MIDPOINT BETWEEN ITS NADIR AND THE NEXT
     SATELLITE'S. Every longitude is then drawn by whichever satellite sees it
     most squarely, the extents do not overlap at all, and paint order stops
     mattering. Where there is no neighbour the disc keeps its own `span`, so
     the honest gap stays a gap.

     A range that crosses the antemeridian is SPLIT INTO TWO BOXES rather than
     widened to the whole world. Widening is what made GOES-West paint Asia and
     the Indian Ocean with limb smear it cannot see — the opposite of the gap
     that was chosen deliberately. Two sources with real bounds ask for exactly
     the tiles that exist; there is no seam, because both halves are the same
     template at the same resolution and MapLibre butts them at 180. */
  function wrap180(d) { return ((d + 540) % 360) - 180; }

  /* A geostationary view reaches about 81 degrees of arc before the surface
     goes over the horizon. `span` is a QUALITY cutoff well inside that, so
     between two satellites the midpoint always wins even where it is a little
     wider than either span: Meteosat's 70 and Himawari's 70 fall 0.7 degrees
     short of meeting, which left a blank hairline down 70.7E from pole to pole.
     `span` is what a disc uses on a side where it has NO neighbour, which is
     where the honest gap belongs. */
  var HORIZON = 81;

  /* QUALITY DECIDES BOTH THE STACK AND THE EXTENT.
     Two true-colour discs are equally good, so where they overlap the midpoint
     between their nadirs wins: every longitude is drawn by whichever satellite
     sees it most squarely, and neither puts its smeared limb over the other's
     near-nadir pixels.
     A GREYSCALE disc is not equal. GIBS publishes no true-colour product for
     Himawari at all (verified against WMTSCapabilities), so the Pacific slot can
     only be infrared — but there is no reason for it to show anywhere a colour
     disc can reach. It is therefore given its FULL HORIZON and painted
     UNDERNEATH, so the colour discs cover it back to the limit of what they can
     see and the grey survives only in the band nothing else reaches (70E-153E).
     That is the smallest greyscale area the available products allow. */
  function tier(sat) { return sat.grey ? 1 : 0; }

  /* Worst first: MapLibre draws in the order layers are added, so the better
     picture is added last and sits on top. */
  function paintOrder() {
    return SATS.slice().sort(function (a, b) { return tier(b) - tier(a); });
  }

  function extentOf(sat) {
    /* A disc is only clipped against others of its OWN quality. Clipping the
       grey disc at the midpoint too would leave it showing beside a colour disc
       that could have covered it. */
    var reach = (tier(sat) > 0) ? HORIZON : (sat.span || HORIZON);
    var w = -reach, e = reach, i, d, m;
    var haveW = false, haveE = false;
    for (i = 0; i < SATS.length; i++) {
      if (SATS[i] === sat || tier(SATS[i]) !== tier(sat)) continue;
      d = wrap180(SATS[i].lon - sat.lon);
      if (d > 0) {
        m = Math.min(d / 2, HORIZON);
        if (!haveE || m < e) { e = m; haveE = true; }
      } else if (d < 0) {
        m = Math.max(d / 2, -HORIZON);
        if (!haveW || m > w) { w = m; haveW = true; }
      }
    }
    return [sat.lon + w, sat.lon + e];
  }

  /* One or two [w,s,e,n] boxes, west to east. */
  function boxesOf(sat) {
    var x = extentOf(sat), w = x[0], e = x[1];
    if (e - w >= 360) return [[-180, -85, 180, 85]];
    if (w < -180) return [[-180, -85, e, 85], [w + 360, -85, 180, 85]];
    if (e > 180) return [[-180, -85, e - 360, 85], [w, -85, 180, 85]];
    return [[w, -85, e, 85]];
  }

  function addOne(sat, iso, layer) {
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
    var boxes = boxesOf(sat), k;
    /* The infrared alternate arrives in the palette Now decodes to temperature:
       a grey ramp for warm scenes with COLOUR for tops colder than about -12C.
       Beside four true-colour discs that reads as rainbow confetti. MapLibre
       desaturates a raster source itself — no pixel access, no canvas, no second
       decoder. It is not free: the coldest tops are dark blues, so greying them
       makes storm cores darker than the cloud around them rather than brighter.
       That is a presentation compromise on 8% of pixels (measured on a live
       frame), taken because the alternative is confetti. */
    var paint = { 'raster-opacity': 1, 'raster-fade-duration': 0 };
    if (sat.grey || (layer && layer !== sat.layer)) paint['raster-saturation'] = -1;

    for (k = 0; k < boxes.length; k++) {
      var id = ids(sat, k);
      _map.addSource(id.src, {
        type: 'raster',
        tiles: [(_protoReady ? SCHEME + '://' : '') + tpl],
        tileSize: px,
        /* Stop MapLibre asking past the source's real resolution — beyond this
           it stretches the last tile, which is correct and free. Without it
           every zoom-in fires a fresh round of requests that can only 404. */
        maxzoom: zmaxOf(sat, layer),
        bounds: boxes[k],
        attribution: CREDIT
      });
      _map.addLayer({ id: id.lyr, type: 'raster', source: id.src, paint: paint,
                      layout: { visibility: _hidden ? 'none' : 'visible' } });
    }
  }

  function removeAll() {
    if (!_map) return;
    dropOne(BASE);   /* unconditional: it may be left over from a previous build */
    for (var i = 0; i < SATS.length; i++) dropOne(SATS[i]);
  }

  function build() {
    _busy = true; announce();
    var all = USE_BASE ? [BASE].concat(paintOrder()) : paintOrder();
    return Promise.all(all.map(function (sat) {
      return newestFrame(sat).then(function (f) { return { sat: sat, f: f }; });
    })).then(function (res) {
      removeAll();
      _times = {}; _layers = {}; _missing = []; _err = '';
      var any = false, i;
      /* Added worst-picture-first (see paintOrder), so the overlap winner is
         decided here and stays decided rather than changing as the view moves. */
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
      if (_map.getLayer(ids(SATS[i], 0).lyr)) return true;
    }
    return !!(_map.getLayer(ids(BASE, 0).lyr));
  }

  function on(m) {
    _map = m || _map;
    if (!_map) return Promise.resolve(false);
    _on = true;
    if (built()) { show(); announce(); return Promise.resolve(true); }
    return build();
  }

  function eachLayer(fn) {
    var all = [BASE].concat(SATS), i, k, id;
    for (i = 0; i < all.length; i++) {
      for (k = 0; k < PARTS; k++) {
        id = ids(all[i], k).lyr;
        if (_map.getLayer(id)) { try { fn(id); } catch (e) {} }
      }
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
                   onMap: !!(_map && _map.getLayer(ids(all[i], 0).lyr)) });
      }
      return { on: _on, busy: _busy, missing: _missing.slice(),
               shown: shownTime(), error: _err, slots: out };
    },
    _sats: function () { return USE_BASE ? [BASE].concat(SATS) : SATS.slice(); },
    _wms: wms,
    _template: template
  };
}());
