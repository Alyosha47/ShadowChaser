/* js/satellite.js — live satellite cloud, the "Now" mode (#F2c).
 *
 * DATA + LAYER, no UI. js/cloud.js is the sibling that owns the climatology.
 *
 * ONE FETCH, ONE STRETCH, ONE CANVAS. This is deliberately much smaller than
 * what it replaces, and it is smaller because the elaborate version was not
 * better. What it replaces derived a cloud FRACTION: a classified cloud mask for
 * extent, a second high-rate instrument for texture, a clear-sky ground field
 * measured on a whole-world pass, per-satellite floors fitted against three
 * agencies' products. That version scored 0.796 against EUMETSAT's operational
 * cloud mask. Plain infrared through one fixed threshold scores 0.817 on the
 * same comparison — better, from a single request, with no world pass, no floor
 * field, and no per-pixel lookups. Measured, not assumed.
 *
 * It also LOOKS like weather, which the derived version never did. Infrared IS a
 * picture of cloud-top temperature; rendering it directly keeps every wisp and
 * edge the instrument saw. A composite of a coarse classified extent and a
 * shading term is a diagram of cloud, and reads like one.
 *
 * WHAT IS LOST, said plainly: infrared cannot see low cloud that is nearly as
 * warm as the ground beneath it, and low stratus is exactly what ruins an
 * eclipse. The cloud mask can see it, and this file no longer asks. That is a
 * real trade and it was made for speed and legibility. If it needs to come back,
 * bring it back as one extra optional request that ADDS cloud, never as a gate
 * that removes it — gating on a coarse mask is what produced tile edges.
 *
 * THE STRETCH IS ANCHORED LOCALLY, AND THIS MATTERS MORE THAN ANY OTHER LINE.
 * A single stretch for the whole disc does not work, and the failure is total
 * rather than gradual. Measured: with a disc-wide anchor of 73, the Cantabrian
 * coast — whose infrared runs 31 to 45 — rendered NOTHING AT ALL. Not faint;
 * zero pixels. The disc's percentiles are dominated by tropical cloud, and
 * Spain at night sits entirely underneath them.
 *
 * So the warm anchor is the 10th percentile of the image actually fetched, which
 * costs one subsampled sort and no extra request, and the width is a fixed
 * number of counts above it. Fixed width is what stops a clear scene from
 * being stretched into fake cloud: "this pixel is N counts colder than nearby
 * ground" means the same thing in every view. Width is per satellite because
 * the providers' greyscales differ — half of each one's own disc range, which is
 * the ratio that was checked against EUMETSAT's mask.
 *
 * THERE IS NO THRESHOLD. There was, and it was the problem. Every version of
 * this that decided "cloud or not" and then coloured the answer produced
 * something that read as a diagram: hard edges where the threshold fell, flat
 * areas where it did not, and a cliff at the boundary — 0.15 drew the Cantabrian
 * coast at 64%, 0.20 drew it at 7%.
 *
 * Infrared already IS the picture. Bright is cold is cloud; dark is warm is
 * ground. So brightness goes straight to opacity, thin cloud comes out faint
 * because it IS faint, and nothing has to be decided. That is why sat24 and the
 * rest look like weather: they are not classifying anything, they are showing
 * the measurement.
 *
 * Never guess a layer identifier. A wrong one fails as a silently blank layer,
 * and on this map blank reads as CLEAR SKY.
 */
(function () {
  'use strict';

  var GIBS   = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
  var EUM    = 'https://view.eumetsat.int/geoserver/wms';
  var CREDIT = 'Imagery NASA EOSDIS GIBS \u00b7 EUMETSAT';

  /* Both services speak WMS 1.3.0 with CRS=EPSG:3857 and bbox in metres, which
     is why there is one request builder. The 1.3.0 axis flip applies to
     EPSG:4326 (lat,lon); using 4326 without swapping returns an empty image and
     NO error. EUMETSAT advertises only 4326 for these layers and serves 3857
     correctly anyway — verified against the live service.

     mtg_fd:ir105_hrfi is Meteosat Third Generation's high-rate infrared: finer
     than SEVIRI's ir108 and fresher, measured 19 minutes old against 29. It is
     what sat24 and the other tools that look right are showing. */
  var SATS = [
    /* span: counts above local warm ground for fully opaque cloud. Half of each
       satellite's own 43rd-to-97th percentile disc range, measured 2026-08-17. */
    { id: 'goes-east', name: 'GOES-East',        lon:  -75.2, svc: 'gibs', step: 10, span: 35,
      layer: 'GOES-East_ABI_Band13_Clean_Infrared' },
    { id: 'goes-west', name: 'GOES-West',        lon: -137.0, svc: 'gibs', step: 10, span: 33,
      layer: 'GOES-West_ABI_Band13_Clean_Infrared' },
    { id: 'mtg',       name: 'Meteosat 0\u00b0', lon:    0.0, svc: 'eum',  step: 10, span: 70,
      layer: 'mtg_fd:ir105_hrfi' },
    { id: 'iodc',      name: 'Meteosat IODC',    lon:   45.5, svc: 'eum',  step: 15, span: 82,
      layer: 'msg_iodc:ir108' },
    { id: 'himawari',  name: 'Himawari',         lon:  140.7, svc: 'gibs', step: 10, span: 28,
      layer: 'Himawari_AHI_Band13_Clean_Infrared' }
  ];

  var SRC = 'sat-now', LAYER = 'sat-now';
  var R = 6378137, LAT_MAX = 85.0511287798066;
  var MAX_PX = 850,   /* 1100 measured at 1.6s per request against 0.5s at 850, for
                         detail no one can see at this zoom */ MIN_PX = 256, MARGIN = 0.18;
  var CUT = 0.16;            /* cos of the limb angle, ~81 degrees */
  var TTL = 5 * 60 * 1000;
  var MAX_AGE_MIN = 180, MAX_STEPS = 8;

  var _on = false, _map = null, _busy = false, _again = false, _pending = null;
  var _stamps = [], _missing = [], _err = null, _listeners = [];
  var _lut = null, _at = 0, _painted = 0;
  var _cv = null, _ctx = null, _src = null, _drawn = null, _drawnZoom = 0;
  var _scratch = null, _sctx = null;

  function mercY(lat) { return R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
  function invMercY(y) { return (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI; }

  /* MapLibre binds with LINEAR_MIPMAP_NEAREST and only falls back to LINEAR when
     the size is NOT square-and-power-of-two. No mipmaps exist here, so a
     1024x1024 texture samples as BLACK — a grey veil over the whole map. Same
     trap as Cloud._safeSize(). Do not tidy this into a neat square. */
  function safeSize(w, h) {
    var pot = function (v) { return (Math.log(v) / Math.LN2) % 1 === 0; };
    if (w === h && pot(w)) h -= 1;
    return [w, h];
  }

  /* THE BOX COMES FROM ZOOM AND CENTRE, NOT FROM getBounds().
     In globe projection getBounds() reports a span of the whole world at almost
     any zoom. cloud.js guards that by falling back to the entire globe, which is
     harmless for a global climatology and fatal here: zoomed into Spain this
     module was fetching FIVE satellites at world extent on every single pan.
     That one line was the fifteen-second wait, the coastline four pixels across,
     and the ring edge cutting off Greenland — all three at once, confirmed by
     diagnose() reporting drawn:{w:-180,e:180} while the map showed Iberia.

     MapLibre's scale is exact and needs no probing: the world is 512 * 2^zoom
     pixels across in both Mercator axes. Everything else follows from that and
     the canvas size. */
  function viewBox() {
    var c = _map.getCenter(), z = _map.getZoom(), el = _map.getCanvas();
    var worldPx = 512 * Math.pow(2, z);
    var m = 1 + 2 * MARGIN;
    var lonSpan = el.width / worldPx * 360 * m;
    var ySpan = el.height / worldPx * (2 * mercY(LAT_MAX)) * m;
    if (lonSpan >= 355) return { w: -180, e: 180, s: -LAT_MAX, n: LAT_MAX };
    var yc = mercY(Math.max(-LAT_MAX, Math.min(LAT_MAX, c.lat)));
    var n = invMercY(Math.min(mercY(LAT_MAX), yc + ySpan / 2));
    var s2 = invMercY(Math.max(mercY(-LAT_MAX), yc - ySpan / 2));
    var w = c.lng - lonSpan / 2, e = c.lng + lonSpan / 2;
    if (e - w >= 360) { w = -180; e = 180; }
    return { w: w, e: e, s: s2, n: n };
  }

  /* Same arithmetic as viewBox, for the same reason: getBounds() would report
     the view had jumped to the whole world and force a redraw every time. */
  function covered() {
    if (!_drawn) return false;
    if (Math.abs(_map.getZoom() - _drawnZoom) > 0.25) return false;
    var b = viewBox(), pad = (b.e - b.w) * MARGIN * 0.5;
    return (b.w + pad) >= _drawn.w && (b.e - pad) <= _drawn.e &&
           b.s >= _drawn.s && b.n <= _drawn.n;
  }

  /* ---------------------------------------------------------------- fetching */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function stamp(sat, ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
           'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':00' +
           (sat.svc === 'eum' ? '.000Z' : 'Z');   /* EUMETSAT carries milliseconds
                                                     where GIBS does not */
  }

  function url(sat, iso, box, w, h) {
    return (sat.svc === 'gibs' ? GIBS : EUM) +
      '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
      '&LAYERS=' + encodeURIComponent(sat.layer) +
      '&STYLES=&CRS=EPSG%3A3857&FORMAT=image%2Fpng&TRANSPARENT=TRUE' +
      '&WIDTH=' + w + '&HEIGHT=' + h +
      '&BBOX=' + (R * box.w * Math.PI / 180) + ',' + mercY(box.s) + ',' +
                 (R * box.e * Math.PI / 180) + ',' + mercY(box.n) +
      '&TIME=' + encodeURIComponent(iso);
  }

  function loadImage(u) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.crossOrigin = 'anonymous';    /* both services send permissive CORS; without
                                          this the pixels cannot be read back */
      im.onload = function () { res(im); };
      im.onerror = function () { rej(new Error('image')); };
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

  /* THE CATALOGUE LEADS PUBLICATION, and an empty frame is not an error. GIBS
     answers a not-yet-published time with a valid, entirely transparent PNG —
     200 OK, onload fires, nothing in it. Measured: Himawari returned three such
     frames in a row before a real one. Retrying only on failure accepts the
     blank and drops a satellite; a dropped satellite is a hole; a hole reads as
     CLEAR SKY. Test the PIXELS, never the response. */
  /* The newest published frame changes every few minutes, not every pan. Probing
     from "now" on each redraw re-walked the same two or three empty frames every
     time; starting from the last one known to have pixels turns that back into a
     single request. Re-probed from the top once it is older than one step. */
  var _lastGood = {};

  function frameFor(sat, box, w, h) {
    var n = 0;
    var ms = Math.floor((Date.now() - sat.step * 60000) / (sat.step * 60000)) * (sat.step * 60000);
    var seen = _lastGood[sat.id];
    if (seen && (Date.now() - seen) < (sat.step + 1) * 60000) ms = seen;
    function attempt() {
      if (n >= MAX_STEPS) return null;
      var t = ms - (n++) * sat.step * 60000;
      if ((Date.now() - t) / 60000 > MAX_AGE_MIN) return null;
      var iso = stamp(sat, t);
      return loadImage(url(sat, iso, box, w, h)).then(function (im) {
        var d = readPixels(im, w, h), p, lit = 0, m = 0;
        for (p = 3; p < d.length; p += 4 * 61) { m++; if (d[p] > 250) lit++; }
        if (lit / m < 0.01) return attempt();
        /* Local warm ground, from a subsample of this very image. Nothing else
           in this file needs a second request or a whole-world pass. */
        var sm = [], k = 0, x;
        for (x = 0; x < d.length; x += 4 * 23)
          if (d[x + 3] > 250) sm[k++] = (d[x] + d[x + 1] + d[x + 2]) / 3;
        sm.sort(function (a, b) { return a - b; });
        _lastGood[sat.id] = t;
        return { iso: iso, at: t, d: d, sat: sat, lo: k ? sm[(k * 0.10) | 0] : 0 };
      }, attempt);
    }
    return Promise.resolve().then(attempt);
  }

  /* ---------------------------------------------------------------- drawing */

  function weightAt(sat, lon, lat) {
    var d = Math.abs(((lon - sat.lon + 540) % 360) - 180) * Math.PI / 180;
    var c = Math.cos(lat * Math.PI / 180) * Math.cos(d) - CUT;
    return c > 0 ? c * c * c : 0;   /* reaches zero AT the limb rather than stepping
                                       off a cliff — every visible seam this module
                                       ever had was a discontinuity in a weight */
  }

  /* Which satellites are WORTH fetching for this box — not merely which can see
     a corner of it. That distinction was costing about ten seconds per pan.
     Over Spain three satellites have non-zero weight: MTG at 0.22, IODC at
     0.038, and GOES-East, scraping its own limb, at 0.00066. All three were
     fetched, sequentially, each with its own step-back probing, so two thirds of
     the wait bought a contribution of under half a percent.
     A satellite is kept if it is the best anywhere in the box, or contributes at
     least a fifth of the best — which keeps genuine two-satellite overlaps and
     drops limb-scrapers. */
  var SHARE = 0.20;

  function visible(box) {
    var w = [], i, s, best = 0, lon, lat, m,
        dl = Math.max(1, (box.e - box.w) / 6), dt = Math.max(1, (box.n - box.s) / 6);
    for (i = 0; i < SATS.length; i++) {
      s = SATS[i]; m = 0;
      for (lon = box.w; lon <= box.e + 1e-9; lon += dl)
        for (lat = box.s; lat <= box.n + 1e-9; lat += dt)
          m = Math.max(m, weightAt(s, lon, lat));
      w.push(m); if (m > best) best = m;
    }
    var out = [];
    for (i = 0; i < SATS.length; i++) if (w[i] > 0 && w[i] >= best * SHARE) out.push(SATS[i]);
    return out;
  }

  /* CLOUD IS WHITE. Not a ramp through four colours, not Average's five — white,
     the way it looks from orbit and the way every satellite picture in the world
     draws it, because the reader already knows what a cloud looks like and does
     not need a legend to decode one.
     Thin cloud carries a faint blue-grey so it separates from pale desert and
     from the light basemap; thick cloud goes to plain white. */
  function buildPalette() {
    if (_lut) return;
    /* RED, and not for aesthetic reasons. White was invisible on the near-white
       street and topographic maps. Blue-grey was worse in a way that is obvious
       once said: every basemap already renders water blue, and most of what this
       layer covers is ocean, so cloud and sea were the same colour.
       Red appears on no basemap as a large area. It costs a partial clash with
       the track and umbra, which are also warm — accepted deliberately, because
       those are thin line-work over a filled area and legibility of the cloud
       matters more. */
    var S = [[0.00, 246, 178, 168], [0.45, 226, 96, 78], [1.00, 158, 22, 22]];
    var lut = new Uint8Array(256 * 3), v, q, i, k, n, t;
    for (v = 0; v < 256; v++) {
      q = v / 255;
      for (i = 1; i < S.length && S[i][0] < q; i++) {}
      k = S[i - 1]; n = S[Math.min(i, S.length - 1)];
      t = (n[0] === k[0]) ? 0 : (q - k[0]) / (n[0] - k[0]);
      lut[v * 3] = k[1] + (n[1] - k[1]) * t;
      lut[v * 3 + 1] = k[2] + (n[2] - k[2]) * t;
      lut[v * 3 + 2] = k[3] + (n[3] - k[3]) * t;
    }
    _lut = lut;
  }

  function compose(box, w, h, frames) {
    var acc = new Float32Array(w * h), wsum = new Float32Array(w * h);
    var si, fr, sat, d, i, j, q, p, f, wt, lat, lon, scale;
    var yTop = mercY(box.n), yBot = mercY(box.s);
    var lats = new Float64Array(h), wts = new Float64Array(w), latsDone = false;

    for (si = 0; si < frames.length; si++) {
      fr = frames[si];
      if (!fr) continue;
      sat = fr.sat; d = fr.d; scale = 1 / sat.span;
      /* Weight separates into a latitude term and a longitude term, so it costs
         two arrays instead of a trig call per pixel. The per-pixel version was
         most of why a pan took seconds to catch up. */
      if (!latsDone) {
        for (j = 0; j < h; j++)
          lats[j] = Math.cos(invMercY(yTop - (j + 0.5) / h * (yTop - yBot)) * Math.PI / 180);
        latsDone = true;
      }
      for (i = 0; i < w; i++) {
        lon = box.w + (i + 0.5) / w * (box.e - box.w);
        wts[i] = Math.cos(Math.abs(((lon - sat.lon + 540) % 360) - 180) * Math.PI / 180);
      }
      for (j = 0; j < h; j++) {
        lat = lats[j];
        for (i = 0, q = j * w, p = q * 4; i < w; i++, q++, p += 4) {
          wt = lat * wts[i] - CUT;
          if (wt <= 0) continue;
          if (d[p + 3] < 250) continue;
          wt = wt * wt * wt;
          /* Channel mean, not the red channel: a pixel whose channels disagree is
             a resampling blend of two greys and is still a valid brightness.
             Discarding those punched transparent holes the basemap showed
             through as speckle — 8.8% of a measured frame. */
          f = ((d[p] + d[p + 1] + d[p + 2]) / 3 - fr.lo) * scale;
          if (f < 0) f = 0; else if (f > 1) f = 1;
          acc[q] += wt * f; wsum[q] += wt;
        }
      }
    }

    /* FEATHER THE COVERAGE EDGE, RELATIVE TO THE LATITUDE. Where the ring stops
       seeing, wsum falls to zero and the pixel simply vanished — a hard alpha
       cut, sampled at world-view resolution, which is what made the boundary
       near the poles look like saw teeth.

       The fade is against the BEST weight achievable at that latitude, never an
       absolute number. An earlier attempt used an absolute floor and multiplied
       Greenland by 0.02 and Iceland by 0.28 — both watched by two satellites,
       and Iceland is on the 2026 track. Relative, those score about 0.36 of the
       local best and stay fully drawn; only the true edge fades. */
    /* A 3x3 median before painting. Measured on a live Iberia frame: 316
       enclosed gaps in the raw field, median size FOUR PIXELS, falling to 129
       after the filter while cloud cover moves by 0.1% and 97% of the detail
       survives. Four-pixel speckle is instrument noise, not a patch of sky
       anyone could stand under, and it reads as holes punched in solid cloud. */
    var med = new Float32Array(w * h), nb = [0,0,0,0,0,0,0,0,0], nn, rr, cc, tmp, ii, jj;
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
      q = j * w + i;
      if (wsum[q] <= 0) { med[q] = -1; continue; }
      nn = 0;
      for (rr = j - 1; rr <= j + 1; rr++) {
        if (rr < 0 || rr >= h) continue;
        for (cc = i - 1; cc <= i + 1; cc++) {
          if (cc < 0 || cc >= w) continue;
          tmp = rr * w + cc;
          if (wsum[tmp] > 0) nb[nn++] = acc[tmp] / wsum[tmp];
        }
      }
      for (ii = 1; ii < nn; ii++) {
        tmp = nb[ii];
        for (jj = ii - 1; jj >= 0 && nb[jj] > tmp; jj--) nb[jj + 1] = nb[jj];
        nb[jj + 1] = tmp;
      }
      med[q] = nb[nn >> 1];
    }

    var wmax = new Float64Array(h);
    for (j = 0; j < h; j++) {
      f = lats[j] - CUT;                  /* lats[] holds cos(latitude) */
      wmax[j] = f > 0 ? f * f * f : 0;
    }

    var img = _ctx.createImageData(w, h), o = img.data, k, litpx = 0, npx = 0, edge;
    for (q = 0, p = 0; q < w * h; q++, p += 4) {
      if (wsum[q] <= 0) continue;
      j = (q / w) | 0;
      edge = wmax[j] > 0 ? wsum[q] / (wmax[j] * 0.08) : 1;
      if (edge > 1) edge = 1;
      f = med[q];
      if (f <= 0.02) continue;
      k = (f * 255) | 0;
      o[p] = _lut[k * 3]; o[p + 1] = _lut[k * 3 + 1]; o[p + 2] = _lut[k * 3 + 2];
      /* Opacity carries THAT there is cloud, colour carries how thick. Alpha
         rising from zero made thin cloud a white ghost on a pale basemap —
         present in the data, invisible on screen, which is worse than absent
         because it looks considered. */
      /* OPACITY IS NOT THE MEASUREMENT — VISIBILITY IS THE POINT. Mapping
         brightness straight to alpha is honest and useless: a low overcast deck
         is thin in infrared and came out nearly transparent, and a thin deck
         blocks totality exactly as completely as a thunderstorm does. What
         matters to someone deciding where to stand is that there IS cloud.
         So opacity saturates fast — anything past a whisper is at least 70%
         solid — and the COLOUR carries how thick it is. */
      o[p + 3] = 255 * Math.min(1, 0.70 + 0.30 * f) * Math.min(1, f / 0.06) * edge;
    }
    for (p = 3; p < o.length; p += 4 * 97) { npx++; if (o[p] > 0) litpx++; }
    _painted = npx ? litpx / npx : 0;
    _ctx.putImageData(img, 0, 0);
  }

  /* --------------------------------------------------------------- the pass */

  function render() {
    var box = viewBox();
    var el = _map.getCanvas();
    var aspect = (mercY(box.n) - mercY(box.s)) / (R * (box.e - box.w) * Math.PI / 180);
    var w = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(el.width)));
    var h = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(w * aspect)));
    var wh = safeSize(w, h); w = wh[0]; h = wh[1];
    if (!_cv) { _cv = document.createElement('canvas'); _ctx = _cv.getContext('2d'); }
    if (_cv.width !== w) _cv.width = w;
    if (_cv.height !== h) _cv.height = h;

    var sats = visible(box), out = [], i = 0;
    /* Sequential: several full-size PNGs in flight at once is a lot of memory on
       a phone, and each one's pixels are folded away before the next arrives. */
    function next() {
      if (i >= sats.length) return out;
      var sat = sats[i++];
      return frameFor(sat, box, w, h).then(function (fr) {
        out.push(fr || null);
        return next();
      }, function () { out.push(null); return next(); });
    }

    return Promise.resolve().then(next).then(function (frames) {
      var stamps = [], any = false, k;
      for (k = 0; k < frames.length; k++) {
        if (!frames[k]) continue;
        any = true;
        stamps.push({ id: sats[k].id, name: sats[k].name, iso: frames[k].iso, at: frames[k].at });
      }
      _missing = sats.filter(function (s) {
        for (var m = 0; m < stamps.length; m++) if (stamps[m].id === s.id) return false;
        return true;
      }).map(function (s) { return s.name; });
      if (!any) { _err = 'no satellite frames available'; return false; }
      /* off() may have fired while these requests were in the air. Without this
         the pass finishes, calls place(), and puts the layer back on a map the
         user has just switched away from — cloud that will not turn off. */
      if (!_on) return false;
      _stamps = stamps;
      compose(box, w, h, frames);
      place(box);
      _drawn = box; _drawnZoom = _map.getZoom(); _at = Date.now();
      return true;
    });
  }

  /* A CANVAS SOURCE, not an image source. An image source has to re-fetch and
     re-decode a data URL before anything appears, and was measured here
     producing a correct canvas and a blank map. cloud.js puts a whole-world
     raster on this same map through a canvas source. animate:false means
     prepare() only re-uploads on resize or while playing, so a later repaint
     would update pixels nobody re-reads — play() then pause() forces exactly one
     upload. Do not simplify that pair away. */
  function place(box) {
    var c = [[box.w, box.n], [box.e, box.n], [box.e, box.s], [box.w, box.s]];
    if (_map.getSource(SRC)) { _src.setCoordinates(c); _src.play(); _src.pause(); }
    else {
      _map.addSource(SRC, { type: 'canvas', canvas: _cv, coordinates: c,
                            animate: false, attribution: CREDIT });
      /* Top of the stack. Online basemap rasters are pushed above the whole
         vector stack, so anything below them is invisible whenever a basemap is
         selected. deck.gl draws the path and shadow above all MapLibre layers,
         so nothing here can cover them. */
      _map.addLayer({ id: LAYER, type: 'raster', source: SRC,
                      paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 0 } });
      _src = _map.getSource(SRC);
    }
    try { _map.setLayoutProperty(LAYER, 'visibility', 'visible'); } catch (e) {}
  }

  function removeLayer() {
    if (!_map) return;
    try { if (_map.getLayer(LAYER)) _map.removeLayer(LAYER); } catch (e) {}
    try { if (_map.getSource(SRC)) _map.removeSource(SRC); } catch (e) {}
    _src = null; _drawn = null;
  }

  /* ----------------------------------------------------------------- public */

  function announce() {
    for (var i = 0; i < _listeners.length; i++) { try { _listeners[i](); } catch (e) {} }
  }

  function refresh(force) {
    if (!_on || !_map) return Promise.resolve(false);
    if (_busy) { _again = true; return Promise.resolve(true); }
    if (!force && covered() && (Date.now() - _at) < TTL) return Promise.resolve(true);
    buildPalette();
    _busy = true; _err = null;
    return render().then(function (ok) {
      _busy = false; announce();
      if (_again) { _again = false; return refresh(false); }
      return ok;
    }, function (e) {
      _busy = false; _err = String(e); announce();
      if (_again) { _again = false; return refresh(false); }
      return false;
    });
  }

  /* Debounced. A pinch fires moveend repeatedly and each one used to start a
     round of requests the next immediately superseded, which is most of why
     catching up took so long. The layer stays put and stretches meanwhile —
     wrong by a fraction of a degree during the gesture, and instantly there. */
  function onMoveEnd() {
    if (!_on) return;
    if (_pending) clearTimeout(_pending);
    _pending = setTimeout(function () { _pending = null; refresh(false); }, 200);
  }

  function on(map) {
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

  function isOn() { return _on; }
  function onFrame(fn) { if (typeof fn === 'function') _listeners.push(fn); }
  function missing() { return _missing.slice(); }

  function invalidate() {
    if (_busy) return Promise.resolve(false);
    _at = 0; _drawn = null;
    return refresh(true).then(function (v) { return v; }, function () { return false; });
  }

  /* Needs the LATITUDE as well as the longitude: the ring covers every longitude
     but runs out of sky toward the poles, so there is no longitude-only answer. */
  function coverage(lon, lat) {
    for (var i = 0; i < SATS.length; i++) if (weightAt(SATS[i], lon, lat || 0) > 0) return { ok: true };
    return { ok: false, reason: Math.abs(lat || 0) > 60 ? 'too-far-north' : 'no-satellite' };
  }

  /* The age of what you are LOOKING AT. Reporting the oldest frame globally made
     Himawari, half an hour behind, label a European track. */
  function shownTime() {
    if (!_stamps.length) return null;
    var c = null, i, k, sat, best = null, bw = -1, w;
    try { c = _map && _map.getCenter(); } catch (e) { c = null; }
    if (c) {
      for (i = 0; i < _stamps.length; i++) {
        sat = null;
        for (k = 0; k < SATS.length; k++) if (SATS[k].id === _stamps[i].id) sat = SATS[k];
        if (!sat) continue;
        w = weightAt(sat, c.lng, c.lat);
        if (w > bw) { bw = w; best = _stamps[i]; }
      }
      if (best && bw > 0) return best.iso;
    }
    var t = _stamps[0];
    for (i = 1; i < _stamps.length; i++) if (_stamps[i].at < t.at) t = _stamps[i];
    return t.iso;
  }

  /* Infrared works after dark, which is why it is here rather than a visible
     band: the drive is often decided at 3 a.m. */
  function hasNight() { return true; }

  window.Satellite = {
    version: '2026-08-17h',
    CREDIT: CREDIT,
    on: on, off: off, isOn: isOn, refresh: refresh,
    onFrame: onFrame, missing: missing, invalidate: invalidate,
    coverage: coverage, shownTime: shownTime, hasNight: hasNight,
    frames: function () { return _stamps.slice(); },
    error: function () { return _err; },
    diagnose: function () {
      return { painted: _painted, frames: _stamps.length, missing: _missing.slice(),
               drawn: _drawn, busy: _busy,
               layer: !!(_map && _map.getLayer(LAYER)),
               source: !!(_map && _map.getSource(SRC)), error: _err };
    },
    _sats: function () { return SATS.slice(); },
    _url: url,
    _viewBox: function () { return viewBox(); }
  };
})();
