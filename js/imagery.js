/* imagery.js — LIVE SATELLITE PICTURE ("Photo", #F2d)
 *
 * The third cloud mode, and the simplest of the three. Average is a climatology,
 * Now is a MEASUREMENT of cloud derived from infrared, and this is a PHOTOGRAPH:
 * the composited geostationary view, drawn as imagery rather than as an overlay.
 *
 * WHY IT EXISTS, given Now already does something cleverer. Scored against
 * EUMETSAT's operational mask, Now finds about half the cloud that is there and
 * about a third of it over sea (HANDOFF §10A.8) — infrared cannot see cloud near
 * the temperature of the surface beneath it, and shallow scattered cumulus over
 * warm water is exactly that. Side by side over the Gulf, the picture shows a sky
 * full of small cloud and the inferred layer shows most of it as clear. No amount
 * of tuning closes that: it is a limit of the measurement, not of the model.
 *
 * WHAT IT COSTS. The basemap is hidden where imagery covers, because clear sky in
 * a picture is a COLOUR, not transparency — that is approach #1 in §10A.9, and it
 * is only acceptable here because the track, the umbra and the location pin are
 * drawn by deck.gl ABOVE every MapLibre layer, so they survive. Nothing samples a
 * picture either: Cloud.sampleAt() returns a number and this cannot.
 *
 * SO IT COMPLEMENTS Now, it does not replace it. The picture is what to look at;
 * Now is what to read a value from. Both stay.
 *
 * GEOMETRY IS BORROWED, NOT REWRITTEN. viewBox() and weightAt() come from
 * satellite.js, so the globe-projection sizing (§10A.5), the dateline inset on
 * BOTH edges, and the per-half satellite choice are shared rather than
 * reimplemented — every one of those was a bug that cost a day, and having two
 * copies of the answer is how one of them comes back.
 */
(function () {
  'use strict';

  var SRC = 'sat-photo', LAYER = 'sat-photo';
  var MAX_PX = 1024, MIN_PX = 256, MARGIN = 0.15;
  var TTL = 5 * 60 * 1000, MAX_STEPS = 8, MAX_AGE_MIN = 180;
  var CUT = 0.16;                    /* same limb cutoff as the infrared model */

  /* One entry per orbital slot. NOTE THE PACIFIC: Himawari has no colour product
     in GIBS at all — no GeoColor, no natural-colour RGB — so it carries the red
     visible band, which is greyscale and, being reflected sunlight, is BLACK AT
     NIGHT. The Pacific therefore looks different from everywhere else by day and
     goes dark by night. That is a real hole in this mode and it is not fixable
     from GIBS; zoom.earth and similar sites use JMA's own imagery for that slot.
     Recorded here rather than discovered later. */
  var SATS = [
    { id: 'goes-east', name: 'GOES-East',   lon:  -75.2, svc: 'gibs', step: 10,
      layer: 'GOES-East_ABI_GeoColor',            fmt: 'image/jpeg' },
    { id: 'goes-west', name: 'GOES-West',   lon: -137.0, svc: 'gibs', step: 10,
      layer: 'GOES-West_ABI_GeoColor',            fmt: 'image/jpeg' },
    { id: 'mtg',       name: 'Meteosat 0\u00b0', lon: 0.0, svc: 'eum', step: 10,
      layer: 'mtg_fd:rgb_geocolour',              fmt: 'image/png' },
    { id: 'iodc',      name: 'Meteosat IODC', lon:  45.5, svc: 'eum', step: 15,
      layer: 'msg_iodc:rgb_natural',              fmt: 'image/png' },
    { id: 'himawari',  name: 'Himawari',     lon: 140.7, svc: 'gibs', step: 10,
      layer: 'Himawari_AHI_Band3_Red_Visible_1km', fmt: 'image/png', mono: true }
  ];

  var GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
  var EUM  = 'https://view.eumetsat.int/geoserver/wms';
  var R = 6378137.0;
  var CREDIT = 'NASA GIBS \u00b7 EUMETSAT';

  var _map = null, _on = false, _cv = null, _ctx = null, _src = null;
  var _scratch = null, _sctx = null;
  var _busy = false, _again = false, _pending = null;
  var _at = 0, _drawn = null, _drawnZoom = -1, _stamps = [], _missing = [], _err = '';
  var _listeners = [], _probeCache = {};

  /* satellite.js is a hard dependency and is named through window rather than
     as a bare global, so a load failure is a clean "unavailable" instead of a
     ReferenceError thrown from inside a promise where nothing reports it. */
  function SAT() { return window.Satellite; }
  function ready() { return !!(window.Satellite && window.Satellite._viewBox); }

  function mercY(lat) {
    return R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  }

  /* ------------------------------------------------------------- requests */

  function stamp(sat, ms) {
    var d = new Date(ms);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var s = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
            'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':00';
    /* EUMETSAT stamps carry milliseconds and GIBS stamps must not — reformatting
       either way invents a time the service has never heard of, and the reply is
       an empty image with no error (§10A.7). */
    return s + (sat.svc === 'eum' ? '.000Z' : 'Z');
  }

  function url(sat, iso, box, w, h) {
    return (sat.svc === 'gibs' ? GIBS : EUM) +
      '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
      '&LAYERS=' + encodeURIComponent(sat.layer) +
      '&STYLES=&CRS=EPSG%3A3857&FORMAT=' + encodeURIComponent(sat.fmt) +
      (sat.fmt === 'image/png' ? '&TRANSPARENT=TRUE' : '') +
      '&WIDTH=' + w + '&HEIGHT=' + h +
      '&BBOX=' + [R * box.w * Math.PI / 180, mercY(box.s),
                  R * box.e * Math.PI / 180, mercY(box.n)].join(',') +
      '&TIME=' + encodeURIComponent(iso);
  }

  function loadImage(u) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('img')); };
      im.src = u;
    });
  }

  function readPixels(img, w, h) {
    if (!_scratch) {
      _scratch = document.createElement('canvas');
      _sctx = _scratch.getContext('2d', { willReadFrequently: true });
    }
    if (_scratch.width !== w) _scratch.width = w;
    if (_scratch.height !== h) _scratch.height = h;
    _sctx.clearRect(0, 0, w, h);
    _sctx.drawImage(img, 0, 0, w, h);
    return _sctx.getImageData(0, 0, w, h).data;
  }

  /* A JPEG has no alpha, so "is there data here" cannot be asked of the alpha
     channel for the GeoColor layers. Off-disc and unpublished both come back as
     pure black instead, and a black frame is indistinguishable from night —
     which is why the test is on VARIATION, not on darkness. An unpublished frame
     is uniform; a real one, day or night, is not. */
  function hasContent(d, w, h) {
    var n, i, v, mn = 255, mx = 0, seen = 0;
    for (i = 0; i < w * h; i += 37) {
      n = i * 4;
      if (d[n + 3] < 250) continue;
      v = (d[n] + d[n + 1] + d[n + 2]) / 3;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      seen++;
    }
    return seen > 50 && (mx - mn) > 12;
  }

  function probe(sat) {
    var rec = _probeCache[sat.id];
    if (rec && rec.pending) return rec.pending;
    if (rec && (Date.now() - rec.when) < sat.step * 30000) return Promise.resolve(rec.hit);

    var step = sat.step * 60000;
    var box = { w: sat.lon - 10, e: sat.lon + 10, s: -5, n: 5 };
    var start = Math.floor(Date.now() / step) * step, tries = [], k, t;
    for (k = 0; k < MAX_STEPS; k++) {
      t = start - k * step;
      if ((Date.now() - t) / 60000 > MAX_AGE_MIN) break;
      tries.push(t);
    }
    /* All candidate times at once — one round trip instead of one per
       unpublished frame, exactly as §10A.6 established for the infrared side. */
    var p = Promise.all(tries.map(function (at) {
      return loadImage(url(sat, stamp(sat, at), box, 64, 32)).then(function (im) {
        return hasContent(readPixels(im, 64, 32), 64, 32) ? at : 0;
      }, function () { return 0; });
    })).then(function (r) {
      var best = 0, i;
      for (i = 0; i < r.length; i++) if (r[i] > best) best = r[i];
      var hit = best ? { at: best } : null;
      _probeCache[sat.id] = { hit: hit, when: Date.now() };
      return hit;
    }, function () { delete _probeCache[sat.id]; return null; });
    _probeCache[sat.id] = { pending: p };
    return p;
  }

  function frameFor(sat, box, w, h) {
    return probe(sat).then(function (hit) {
      var step = sat.step * 60000, n = 0;
      var ms = hit ? hit.at : Math.floor((Date.now() - step) / step) * step;
      var limit = hit ? 2 : MAX_STEPS;
      function attempt() {
        if (n >= limit) return null;
        var t = ms - (n++) * step;
        if ((Date.now() - t) / 60000 > MAX_AGE_MIN) return null;
        var iso = stamp(sat, t);
        return loadImage(url(sat, iso, box, w, h)).then(function (im) {
          var d = readPixels(im, w, h);
          if (!hasContent(d, w, h)) return attempt();
          return { iso: iso, at: t, d: d, sat: sat };
        }, attempt);
      }
      return Promise.resolve().then(attempt);
    });
  }

  /* ------------------------------------------------------------ compositing */

  function compose(box, w, h, frames) {
    var img = _ctx.createImageData(w, h), o = img.data;
    var acc = new Float32Array(w * h * 3), wsum = new Float32Array(w * h);
    var lats = new Float64Array(h), lonOf = new Float64Array(w);
    var i, j, k, q, n2, wt, lat, lon, fr, d, pw, span, rel, sat;
    var srcX = new Int32Array(w), wts = new Float64Array(w);

    var yN = mercY(box.n), yS = mercY(box.s);
    for (j = 0; j < h; j++) {
      lat = 2 * Math.atan(Math.exp((yN - (yN - yS) * (j + 0.5) / h) / R)) - Math.PI / 2;
      lats[j] = Math.cos(lat);
      lonOf[j] = 0;
    }
    var latOf = new Float64Array(h);
    for (j = 0; j < h; j++) {
      latOf[j] = (2 * Math.atan(Math.exp((yN - (yN - yS) * (j + 0.5) / h) / R)) - Math.PI / 2) * 180 / Math.PI;
    }
    for (i = 0; i < w; i++) lonOf[i] = box.w + (i + 0.5) / w * (box.e - box.w);

    for (k = 0; k < frames.length; k++) {
      fr = frames[k];
      if (!fr) continue;
      d = fr.d; pw = fr.pw; sat = fr.sat;
      span = fr.box.e - fr.box.w;
      for (i = 0; i < w; i++) {
        lon = lonOf[i];
        rel = lon - fr.box.w;
        rel -= Math.floor(rel / 360) * 360;
        if (rel < 0 || rel >= span) { srcX[i] = -1; continue; }
        srcX[i] = Math.min(pw - 1, (rel / span * pw) | 0);
        wts[i] = Math.cos(((lon - sat.lon + 540) % 360 - 180) * Math.PI / 180);
      }
      for (j = 0; j < h; j++) {
        lat = lats[j];
        for (i = 0; i < w; i++) {
          if (srcX[i] < 0) continue;
          wt = lat * wts[i] - CUT;
          if (wt <= 0) continue;
          wt = wt * wt * wt;
          n2 = (j * pw + srcX[i]) * 4;
          /* Transparent or dead-black source is off-disc, not sky. Blending it
             would pull a dark wedge across the limb of the neighbour. */
          if (d[n2 + 3] < 250) continue;
          if (d[n2] + d[n2 + 1] + d[n2 + 2] < 12) continue;
          q = j * w + i;
          acc[q * 3]     += wt * d[n2];
          acc[q * 3 + 1] += wt * d[n2 + 1];
          acc[q * 3 + 2] += wt * d[n2 + 2];
          wsum[q] += wt;
        }
      }
    }

    var painted = 0;
    for (q = 0; q < w * h; q++) {
      k = q * 4;
      if (wsum[q] <= 0) { o[k + 3] = 0; continue; }
      o[k]     = acc[q * 3] / wsum[q];
      o[k + 1] = acc[q * 3 + 1] / wsum[q];
      o[k + 2] = acc[q * 3 + 2] / wsum[q];
      o[k + 3] = 255;
      painted++;
    }
    if (_cv) {
      if (_cv.width !== w) _cv.width = w;
      if (_cv.height !== h) _cv.height = h;
    }
    _ctx.putImageData(img, 0, 0);
    return painted / (w * h);
  }

  function place(box) {
    var c = [[box.w, box.n], [box.e, box.n], [box.e, box.s], [box.w, box.s]];
    if (_map.getSource(SRC)) { _src.setCoordinates(c); _src.play(); _src.pause(); }
    else {
      _map.addSource(SRC, { type: 'canvas', canvas: _cv, coordinates: c,
                            animate: false, attribution: CREDIT });
      _map.addLayer({ id: LAYER, type: 'raster', source: SRC,
                      paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } });
      _src = _map.getSource(SRC);
    }
    try { _map.setLayoutProperty(LAYER, 'visibility', 'visible'); } catch (e) {}
  }

  function removeLayer() {
    /* One try per removal: MapLibre throws on removeSource while a layer still
       references it, and a single shared try leaves the rest in place (§10A.11). */
    try { if (_map && _map.getLayer(LAYER)) _map.removeLayer(LAYER); } catch (e) {}
    try { if (_map && _map.getSource(SRC)) _map.removeSource(SRC); } catch (e) {}
    _src = null; _drawn = null; _drawnZoom = -1;
  }

  /* ------------------------------------------------------------------ pass */

  function render() {
    var box = SAT()._viewBox(_map), el = _map.getCanvas();
    var aspect = (mercY(box.n) - mercY(box.s)) / (R * (box.e - box.w) * Math.PI / 180);
    var w = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(el.width)));
    var h = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(w * aspect)));
    if (h < MIN_PX) h = MIN_PX;
    if (!_cv) { _cv = document.createElement('canvas'); _ctx = _cv.getContext('2d'); }

    /* BOTH dateline edges inset by one canvas pixel. A bbox touching ±180 makes
       GIBS drop about 10% of the image from that edge — 67 columns measured on
       one Himawari request — and it does it at the east edge as well as the west
       (§10A.5). Two separate vertical gaps came from getting this wrong. */
    var parts = [], eps = (box.e - box.w) / w;
    if (box.e > 180) {
      parts.push({ w: box.w, e: 180 - eps, s: box.s, n: box.n });
      parts.push({ w: -180 + eps, e: box.e - 360, s: box.s, n: box.n });
    } else if (box.w < -180) {
      parts.push({ w: box.w + 360, e: 180 - eps, s: box.s, n: box.n });
      parts.push({ w: -180 + eps, e: box.e, s: box.s, n: box.n });
    } else parts.push(box);

    /* Satellites are chosen PER HALF, never for the whole view: chosen for the
       view, a Pacific pan asks Meteosat about the far side of the world and each
       reply is an empty image that burns a full retry (§10A.5). */
    var jobs = [], p, s;
    for (p = 0; p < parts.length; p++) {
      for (s = 0; s < SATS.length; s++) {
        if (visible(SATS[s], parts[p])) jobs.push({ sat: SATS[s], box: parts[p] });
      }
    }

    var out = new Array(jobs.length), runs = [];
    function run(job, idx) {
      var pw = Math.max(64, Math.round((job.box.e - job.box.w) / (box.e - box.w) * w));
      return frameFor(job.sat, job.box, pw, h).then(function (fr) {
        if (fr) { fr.box = job.box; fr.pw = pw; }
        out[idx] = fr || null;
      }, function () { out[idx] = null; });
    }
    for (p = 0; p < jobs.length; p++) runs.push(run(jobs[p], p));

    return Promise.all(runs).then(function () {
      var frames = out, any = false, seen = {}, i;
      _missing = [];
      for (i = 0; i < frames.length; i++) {
        if (frames[i]) { any = true; seen[frames[i].sat.id] = frames[i].iso; }
      }
      for (i = 0; i < jobs.length; i++) {
        if (!seen[jobs[i].sat.id] && _missing.indexOf(jobs[i].sat.name) < 0) {
          _missing.push(jobs[i].sat.name);
        }
      }
      _stamps = Object.keys(seen).map(function (k) { return seen[k]; });
      if (!any) { _err = 'no imagery published'; return false; }
      if (!_on) return false;
      compose(box, w, h, frames);
      place(box);
      _drawn = box; _drawnZoom = _map.getZoom(); _at = Date.now(); _err = '';
      return true;
    });
  }

  function visible(sat, box) {
    var mid = (box.w + box.e) / 2, lat = (box.s + box.n) / 2;
    var a = SAT()._weightAt(sat, mid, lat);
    var b = SAT()._weightAt(sat, box.w, lat);
    var c = SAT()._weightAt(sat, box.e, lat);
    return a > 0 || b > 0 || c > 0;
  }

  function covered() {
    if (!_drawn) return false;
    if (Math.abs(_map.getZoom() - _drawnZoom) > 0.25) return false;
    var b = SAT()._viewBox(_map);
    return b.w >= _drawn.w && b.e <= _drawn.e && b.s >= _drawn.s && b.n <= _drawn.n;
  }

  function refresh(force) {
    if (!_on || !_map) return Promise.resolve(false);
    if (!force && covered() && (Date.now() - _at) < TTL) return Promise.resolve(true);
    if (_busy) { _again = true; return Promise.resolve(true); }
    _busy = true;
    return render().then(function (v) {
      _busy = false;
      announce();
      if (_again) { _again = false; return refresh(false); }
      return v;
    }, function () { _busy = false; return false; });
  }

  function announce() {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](); } catch (e) {}
    }
  }

  function onMoveEnd() {
    if (_pending) clearTimeout(_pending);
    _pending = setTimeout(function () { _pending = null; refresh(false); }, 200);
  }

  function on(map) {
    if (!ready()) { _err = 'satellite.js not loaded'; return Promise.resolve(false); }
    _map = map; _on = true;
    _map.on('moveend', onMoveEnd);
    return refresh(true);
  }

  function off() {
    _on = false; _stamps = []; _at = 0; _again = false;
    if (_pending) { clearTimeout(_pending); _pending = null; }
    if (_map) _map.off('moveend', onMoveEnd);
    removeLayer();
  }

  function shownTime() {
    if (!_stamps.length) return null;
    var best = _stamps[0], i;
    for (i = 1; i < _stamps.length; i++) if (_stamps[i] < best) best = _stamps[i];
    return best;
  }

  window.Imagery = {
    version: '2026-08-19b',
    CREDIT: CREDIT,
    on: on, off: off,
    isOn: function () { return _on; },
    refresh: refresh,
    onFrame: function (fn) { if (typeof fn === 'function') _listeners.push(fn); },
    missing: function () { return _missing.slice(); },
    invalidate: function () {
      if (_busy) return Promise.resolve(false);
      _probeCache = {}; _at = 0; _drawn = null;
      return refresh(true).then(function (v) { return v; }, function () { return false; });
    },
    shownTime: shownTime,
    error: function () { return _err; },
    diagnose: function () {
      return { frames: _stamps.length, missing: _missing.slice(), drawn: _drawn,
               busy: _busy, layer: !!(_map && _map.getLayer(LAYER)) };
    },
    _sats: function () { return SATS.slice(); }
  };
})();
