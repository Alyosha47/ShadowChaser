/* js/satellite.js — live satellite imagery, the "Now" cloud mode (#F2c).
 *
 * DATA + LAYER, no UI. Exposes enough for a control to drive it; owns no button,
 * no strip, no legend. js/cloud.js is the sibling that owns the climatology
 * field, and the two are mutually exclusive at the control level, not here.
 *
 * WHAT THIS IS FOR, and why it is not a forecast. On the morning of an eclipse
 * the question stops being "where is the climate good" and becomes "which way do
 * I drive". Only observation answers that. Note the honest limit: this shows
 * where cloud IS, not where it will be at totality, and cloud moves. Inside a few
 * hours of the event, the eye plus a satellite loop beats any model we could
 * afford; beyond that, it is the wrong tool and the Average mode is better.
 *
 * SOURCE — NASA GIBS. No API key, no quota registration, public standards-based
 * WMTS. Credit line is required: see CREDIT.
 *
 * EVERY CONSTANT BELOW WAS VERIFIED, NOT RECALLED. tools/checks/verify_gibs.html
 * probes candidate layer identifiers, tile matrix sets, formats and timestamps
 * against the live service and reports which combinations return a real tile.
 * Confirmed 2026-08-15. If a layer ever goes dark, re-run the probe rather than
 * guessing a replacement name — a wrong identifier fails as a silently blank
 * layer, which looks exactly like "clear sky everywhere".
 *
 * THE TIMESTAMP TRAP. Geostationary layers are subdaily: GIBS wants
 * YYYY-MM-DDTHH:MM:SSZ and does NOT accept "current". Imagery also lands over an
 * hour behind real time, so "now, rounded down to ten minutes" is reliably a 404.
 * DescribeDomains is the only correct way to learn the newest frame, and this
 * module refuses to fall back to `time=default` — for a subdaily layer that is
 * whatever GIBS nominates, not necessarily anything recent, and a silently stale
 * sky is worse than no sky at all on the morning of an eclipse.
 *
 * WHY GEOCOLOR. True colour by day, blended infrared by night. An eclipse is a
 * daytime event, but the decision that matters is often made at 3 a.m. the night
 * before, and a visible-only product is black at exactly that moment.
 */
(function () {
  'use strict';

  var ROOT   = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/';
  var WMS    = 'https://view.eumetsat.int/geoserver/wms';
  var CREDIT = 'Imagery NASA EOSDIS GIBS \u00b7 EUMETSAT';

  /* TWO SERVICES, TWO PROTOCOLS. NASA GIBS serves WMTS (fixed tile pyramid,
     {z}/{y}/{x}); EUMETSAT serves WMS (arbitrary bbox, rendered on demand).
     MapLibre handles both as raster sources — WMTS via a path template, WMS via
     {bbox-epsg-3857} — so the difference is confined to tileTemplate() and to
     how each service reports its newest frame. Everything downstream is common.

     WHY BOTH ARE NEEDED. GIBS has no Meteosat, because NASA does not
     redistribute EUMETSAT data, which left Europe, Africa, the Middle East and
     India uncovered — a large share of the world's eclipse tracks. */

  /* Geostationary satellites see a disk, not a rectangle, and image quality
     collapses toward the limb. `lon` is the sub-satellite point; `half` is how
     far either side we are willing to trust it. Deliberately narrower than the
     geometric disk (~81 deg) — at the limb you are looking through so much
     atmosphere at such an angle that cloud position is materially displaced.
     VERIFIED green by tools/checks/verify_gibs.html on 2026-08-15. */
  var SATS = [
    { id: 'goes-east', name: 'GOES-East', lon:  -75, half: 65, night: true, kind: 'wmts',
      layer: 'GOES-East_ABI_GeoColor', set: 'GoogleMapsCompatible_Level7', ext: 'jpg' },
    { id: 'goes-west', name: 'GOES-West', lon: -137, half: 65, night: true, kind: 'wmts',
      layer: 'GOES-West_ABI_GeoColor', set: 'GoogleMapsCompatible_Level7', ext: 'jpg' },
    /* MTG GeoColour — deliberately the same product family as the GOES pair, so
       a track crossing the Atlantic does not visibly change rendering halfway. */
    { id: 'mtg', name: 'Meteosat', lon: 0, half: 65, night: true, kind: 'wms',
      layer: 'mtg_fd:rgb_geocolour' },
    /* No GeoColour exists for the Indian Ocean service, so natural colour it is —
       hence night:false. Harmless for eclipse day, but the caption must not
       claim night coverage it does not have. */
    { id: 'iodc', name: 'Meteosat IODC', lon: 45.5, half: 55, night: false, kind: 'wms',
      layer: 'msg_iodc:rgb_natural' },
    /* Himawari has NO GeoColor — DescribeDomains returns nothing for it, because
       GeoColor is a CIRA/NOAA product NASA only built for the GOES pair. The
       verified alternative is a visible band, so `night: false`: this imagery is
       BLACK on the night side and a caption must say so rather than let a black
       screen read as "no cloud". Fixing that means compositing Band13 infrared
       after dark, which is a second layer and a separate job. */
    { id: 'himawari', name: 'Himawari', lon:  140, half: 65, night: false, kind: 'wmts',
      layer: 'Himawari_AHI_Band3_Red_Visible_1km', set: 'GoogleMapsCompatible_Level7', ext: 'jpg' }
  ];

  /* COVERAGE IS NOW GLOBAL: -137, -75, 0, +45.5, +140. Every sub-point is within
     one half-width of its neighbours, so pick() always finds a satellite.
     All five verified green by the two probe pages on 2026-08-15. */

  var SRC = 'sat-now', LAYER = 'sat-now';
  var OPACITY = 0.85;         /* imagery includes land; let the basemap breathe */
  var TIME_TTL = 5 * 60 * 1000;

  /* HOW FAR BACK TO STEP, and why this is not paranoia.
     DescribeDomains reports the newest period END, but the tiles for that exact
     instant are not always published yet — ingest is still running. The probe
     caught this directly: GOES-East's infrared resolved to a real 23:00Z while
     GOES-West's and Himawari's, asked seconds later, had no tiles at their
     newest stamp and fell through to `time=default`. Trusting the newest frame
     therefore fails intermittently and looks like a dead layer. Step back a
     frame at a time until one loads. */
  var STEP_MIN = 10;          /* ABI/AHI full-disk cadence */
  var MAX_STEPS = 6;          /* an hour of slack; beyond that something is wrong */

  var _on = false, _map = null, _cur = null;
  var _times = {};                        /* layer name -> { t: iso, at: ms }   */
  var _wmsCaps = null, _wmsCapsAt = 0;    /* one parse serves every WMS layer   */

  /* ------------------------------------------------------------- selection */

  /* Which satellite owns this longitude — the nearest whose sub-point is within
     its half-width. Coverage is currently global, so in practice this always
     finds one; it still returns null rather than a fallback, because the day a
     source is retired the control must say "no imagery here" instead of
     rendering blank, which on this map reads as clear sky. */
  function pick(lon) {
    var best = null, bestD = Infinity;
    var lo = (((lon + 180) % 360 + 360) % 360) - 180;
    for (var i = 0; i < SATS.length; i++) {
      var d = Math.abs(((lo - SATS[i].lon + 540) % 360) - 180);
      if (d <= SATS[i].half && d < bestD) { best = SATS[i]; bestD = d; }
    }
    return best;
  }

  function coverage(lon) {
    var s = pick(lon);
    return s ? { ok: true, sat: s.name }
             : { ok: false, reason: 'no-satellite' };
  }

  /* ------------------------------------------------------------ timestamps */

  /* Newest frame EUMETSAT advertises, from the time dimension in its
     GetCapabilities. That document covers all 116 layers, so it is fetched once
     and every layer's stamp cached from the single parse rather than
     re-requested per satellite. CORS is open — verified by verify_eumetsat.html. */
  function wmsNewest(sat) {
    var c = _times[sat.layer];
    if (c && (Date.now() - c.at) < TIME_TTL) return Promise.resolve(c.t);

    var fresh = _wmsCaps && (Date.now() - _wmsCapsAt) < TIME_TTL;
    var caps = fresh ? Promise.resolve(_wmsCaps)
      : fetch(WMS + '?service=WMS&version=1.3.0&request=GetCapabilities')
          .then(function (r) {
            if (!r.ok) throw new Error('GetCapabilities ' + r.status);
            return r.text();
          })
          .then(function (xml) {
            var doc = new DOMParser().parseFromString(xml, 'text/xml');
            var map = {}, nodes = doc.getElementsByTagName('Layer');
            for (var i = 0; i < nodes.length; i++) {
              var n = nodes[i], nm = null, dim = null;
              for (var j = 0; j < n.childNodes.length; j++) {
                var ch = n.childNodes[j];
                if (ch.nodeName === 'Name' && !nm) nm = ch.textContent.trim();
                if (ch.nodeName === 'Dimension' &&
                    ch.getAttribute('name') === 'time') dim = ch;
              }
              if (!nm || !dim || !dim.textContent) continue;
              var parts = dim.textContent.trim().split(',');
              var last = parts[parts.length - 1].split('/');
              map[nm] = last.length >= 2 ? last[1] : last[0];
            }
            _wmsCaps = map; _wmsCapsAt = Date.now();
            return map;
          });

    return caps.then(function (map) {
      var t = map[sat.layer] || null;
      /* EUMETSAT stamps carry milliseconds (…:00.000Z) where GIBS does not.
         Keep whatever the service said — reformatting is how you invent a
         timestamp the service has never heard of. */
      if (t) _times[sat.layer] = { t: t, at: Date.now() };
      return t;
    }).catch(function () { return null; });
  }

  /* Newest frame for a satellite, whichever service it comes from. Resolves null
     on any failure, and callers must treat that as "cannot show imagery" rather
     than falling back to a service default — see the timestamp trap above.

     For GIBS the Domain element is a comma-separated list of ISO periods and the
     end of the last one is the most recent imagery. */
  function newestTime(sat) {
    if (sat.kind === 'wms') return wmsNewest(sat);

    var c = _times[sat.layer];
    if (c && (Date.now() - c.at) < TIME_TTL) return Promise.resolve(c.t);

    var url = ROOT + '1.0.0/' + sat.layer + '/default/' + sat.set + '/all/all.xml';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('DescribeDomains ' + r.status);
      return r.text();
    }).then(function (xml) {
      var m = xml.match(/<Domain>([^<]*)<\/Domain>/);
      if (!m) return null;
      var periods = m[1].split(',');
      var last = periods[periods.length - 1].split('/');
      var t = last.length >= 2 ? last[1] : last[0];
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(t)) return null;
      _times[sat.layer] = { t: t, at: Date.now() };
      return t;
    }).catch(function () { return null; });
  }

  /* `iso` shifted back by n cadence steps, snapped to the cadence grid. GIBS
     only holds frames on that grid, so an unsnapped time is a guaranteed miss. */
  function stepBack(iso, n) {
    var ms = Date.parse(iso);
    if (!isFinite(ms)) return null;
    ms -= n * STEP_MIN * 60000;
    ms = Math.floor(ms / (STEP_MIN * 60000)) * (STEP_MIN * 60000);
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /* First frame at or before `newest` that actually has a tile. Probes a single
     tile the satellite can definitely see (its own sub-point at z=2) rather than
     trusting the catalogue. Resolves null if nothing in MAX_STEPS loads — the
     caller then shows nothing, which is the honest outcome. */
  function firstLiveFrame(sat, newest) {
    var n = 0;
    function attempt() {
      if (n > MAX_STEPS) return Promise.resolve(null);
      var t = stepBack(newest, n++);
      if (!t) return Promise.resolve(null);
      var z = 2;
      var x = Math.floor((((sat.lon + 180) % 360 + 360) % 360) / 360 * (1 << z));
      var url = ROOT + sat.layer + '/default/' + t + '/' + sat.set +
                '/' + z + '/1/' + x + '.' + sat.ext;
      return fetch(url, { method: 'GET' }).then(function (r) {
        return r.ok ? t : attempt();
      }).catch(function () { return attempt(); });
    }
    return attempt();
  }

  function tileTemplate(sat, time) {
    if (sat.kind === 'wms') {
      /* WMS 1.3.0. CRS=EPSG:3857 takes bbox as minx,miny,maxx,maxy in metres,
         which is what MapLibre's {bbox-epsg-3857} substitutes. The notorious
         1.3.0 axis-order flip applies to EPSG:4326 (lat,lon) — using 4326 here
         without swapping returns an empty image and no error. Stay on 3857. */
      return WMS + '?service=WMS&version=1.3.0&request=GetMap' +
        '&layers=' + encodeURIComponent(sat.layer) +
        '&styles=&format=image%2Fpng&transparent=true' +
        '&crs=EPSG%3A3857&width=256&height=256' +
        '&bbox={bbox-epsg-3857}' +
        (time ? '&time=' + encodeURIComponent(time) : '');
    }
    /* WMTS REST order is {TileMatrix}/{TileRow}/{TileCol}; MapLibre supplies
       {z}/{x}/{y}, so row is y and column is x — transposed relative to how the
       placeholders read left to right. Getting this backwards yields imagery
       that loads without error and is mirrored about the diagonal. */
    return ROOT + sat.layer + '/default/' + time + '/' + sat.set +
           '/{z}/{y}/{x}.' + sat.ext;
  }

  /* ----------------------------------------------------------------- layer */

  function removeLayer() {
    if (!_map) return;
    try { if (_map.getLayer(LAYER))  _map.removeLayer(LAYER); } catch (e) {}
    try { if (_map.getSource(SRC))   _map.removeSource(SRC); } catch (e) {}
    _cur = null;
  }

  /* Swap in the imagery for wherever the map is now looking. Safe to call on
     every moveend: it returns early unless the satellite or the frame changed,
     so panning within one disk costs nothing.

     No beforeId is needed. Paths and the shadow are drawn by deck.gl through
     MapboxOverlay with interleaved:false, which renders in its own canvas above
     the entire MapLibre map — so no raster layer added here can ever cover them. */
  function refresh() {
    if (!_on || !_map) return Promise.resolve(false);

    var sat = pick(_map.getCenter().lng);
    if (!sat) { removeLayer(); return Promise.resolve(false); }

    return newestTime(sat).then(function (newest) {
      if (!newest) return null;
      /* The step-back dance exists because GIBS publishes a catalogue entry
         before the tiles land. WMS renders on demand from what the service
         actually holds, so its advertised newest time is authoritative and
         probing backwards would just cost a request. */
      return sat.kind === 'wms' ? newest : firstLiveFrame(sat, newest);
    }).then(function (time) {
      if (!_on) return false;
      if (!time) { removeLayer(); return false; }        /* never fall back to default */

      var key = sat.id + '|' + time;
      if (_cur === key) return true;
      removeLayer();

      _map.addSource(SRC, {
        type: 'raster', tiles: [tileTemplate(sat, time)],
        tileSize: 256, attribution: CREDIT
      });
      _map.addLayer({ id: LAYER, type: 'raster', source: SRC,
                      paint: { 'raster-opacity': OPACITY,
                               'raster-fade-duration': 0 } });
      _cur = key;
      return true;
    });
  }

  function on(map) {
    _map = map; _on = true;
    return refresh();
  }

  function off() {
    _on = false;
    removeLayer();
  }

  function isOn() { return _on; }

  /* Frame currently displayed, for the caption strip. Imagery runs over an hour
     behind, and a user standing under cloud deserves to know whether they are
     looking at ten minutes ago or two hours ago. */
  function shownTime() {
    return _cur ? _cur.split('|')[1] : null;
  }

  /* Does the current satellite show anything after dark? False for Himawari,
     whose only verified layer is a visible band. A caption that does not say
     this lets a black Pacific read as a cloudless one. */
  function hasNight(lon) {
    var s = pick(lon);
    return s ? !!s.night : null;
  }

  window.Satellite = {
    version: '2026-08-15c',
    CREDIT: CREDIT,
    on: on,
    off: off,
    isOn: isOn,
    refresh: refresh,
    coverage: coverage,
    shownTime: shownTime,
    hasNight: hasNight,
    /* For tests and console work. */
    _pick: pick,
    _sats: function () { return SATS.slice(); },
    _template: tileTemplate,
    _stepBack: stepBack
  };
})();
