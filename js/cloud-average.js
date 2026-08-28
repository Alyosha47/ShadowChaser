/* js/cloud-average.js — historical cloud-cover overlay (#F2, climatology half).
 *
 * WHAT IT SHOWS
 *   ERA5 total cloud cover, 1991-2020 mean, 0.5 deg, for the selected eclipse's
 *   month — sampled at each point's own LOCAL SOLAR TIME at the moment the
 *   eclipse PEAKS THERE. That is the whole point: over land the diurnal cloud
 *   swing is 10-30 percentage points, so a monthly mean answers a question
 *   nobody asked.
 *
 *   Note "peaks there", not "at greatest eclipse". The shadow takes ~3 h to
 *   cross the globe, so anchoring every longitude to the instant of greatest
 *   eclipse mis-times the ends of the track by up to 90 minutes — half a slice.
 *   Local maximum is defined anywhere the eclipse is visible at all, partial
 *   included, so the whole map is coloured by its own local peak.
 *
 *   Arrival times come from findMaximum() on a coarse grid over the viewport,
 *   bilinearly interpolated. Measured against direct engine calls over the 2026
 *   track: a 13x7 grid is within 15 SECONDS everywhere, against 3-hour slices.
 *   Denser grids buy precision the data cannot use. Away from the eclipse, or
 *   with no Besselian record loaded, it falls back to the greatest-eclipse
 *   instant so the far side of the world still reads sensibly.
 *
 * DATA
 *   data/cloud/cloud_MM_HH.webp — 12 months x 8 local-solar-hour slices,
 *   720x361 equirectangular, north-first, value = fraction * 250, red channel.
 *   At most 16 files are ever fetched (two bracketing months x 8 slices),
 *   ~33 KB each; they are cached for the session.
 *
 * WHY A CANVAS SOURCE, NOT AN IMAGE SOURCE
 *   The layer is rebuilt to the CURRENT VIEWPORT on moveend. A single
 *   world-sized image at any sane resolution puts Iberia in ~70 pixels, which
 *   is a smear at country zoom. Drawing the visible bbox instead means we always
 *   sample the source data at screen resolution and never upscale. Building the
 *   canvas ourselves also means it is drawn directly in Mercator, so the
 *   plate-carree trap documented on the `relief` source in map.js cannot bite.
 *
 * WHERE IT SITS
 *   Top of the MapLibre stack, at 0.7 opacity. NOT below 'coast-line': the
 *   online basemap rasters are pushed above the whole vector stack, so anything
 *   under them is invisible whenever a basemap is selected. Top-of-stack is the
 *   only insertion point that works both online and offline, and it needs no
 *   change to syncBasemapLayers(). deck.gl renders above all MapLibre layers
 *   (MapboxOverlay, interleaved:false), so the limb lines and central line stay
 *   on top regardless — which is what keeps red-on-red legible.
 *
 * HONEST LIMITS, worth repeating to anyone who extends this:
 *   - Mean cloud amount is NOT the probability of seeing totality. 50% can be
 *     half-covered every day or clear on half of them.
 *   - 0.5 deg is ~55 km. Sea breezes, lee clearing and valley fog are invisible.
 *   - The shadow itself suppresses afternoon convection, so afternoon readings
 *     are mildly pessimistic on the day. In your favour.
 */
(function () {
  'use strict';

  var SRC = 'cloud', LAYER = 'cloud';

  /* A second, permanent WORLD canvas sits underneath the detail one. It is drawn
     once per eclipse and never redrawn for pan or zoom, so it always covers the
     screen no matter how fast you move. Chasing redraw speed could never fix the
     bare edges: zooming out doubles the viewport instantly, so no margin and no
     frame budget can keep ahead of it. With a base layer there is nothing to
     keep ahead of — the worst case becomes a change of resolution, not a gap.
     Exactly one of the two is visible at a time (see _swap), because two stacked
     translucent copies of the same field composite to 0.91 rather than 0.7. */
  var SRC_B = 'cloud-base', LAYER_B = 'cloud-base';

  /* Source grid. Must match encode_cloud.py. Asserted on first decode. */
  var NLON = 720, NLAT = 361, DEG = 0.5;
  var NSLICE = 8, LST_STEP = 3;          /* slices every 3 h of local solar time */
  var SCALE = 250;                       /* pixel value = fraction * SCALE       */

  var LAT_MAX = 85.0511287798066;        /* Mercator limit                       */
  var MAX_PX  = 1024;                    /* canvas cap; see _render() note       */
  var MIN_PX  = 96;
  var OVER    = 6;                       /* canvas px per source cell            */
  var MARGIN  = 0.35;                    /* render this much beyond the viewport */

  /* MapLibre's raster renderer binds tile textures with LINEAR_MIPMAP_NEAREST and
     only falls back to LINEAR when Texture.isSizePowerOfTwo() is false — i.e.
     when the texture is NOT square-and-power-of-two. CanvasSource builds its
     texture without useMipmap, so no mipmaps are ever generated. Hand it a
     square power-of-two canvas (1024x1024 is trivially easy to hit when both
     dimensions clamp to the cap) and the texture is incomplete: WebGL samples it
     as black, which reads on screen as a flat grey veil over the whole map.
     Verified against Texture.bind()/isSizePowerOfTwo() in maplibre-gl 5.5.0.
     Nudging one dimension by a pixel is invisible and sidesteps it entirely. */
  function _safeSize(w, h) {
    var pot = function (v) { return (Math.log(v) / Math.LN2) % 1 === 0; };
    if (w === h && pot(w)) h -= 1;
    return [w, h];
  }
  var OPACITY = 0.7;
  var TGRID_X = 13, TGRID_Y = 7;   /* arrival-time grid; see header for why    */
  var BGRID_X = 25, BGRID_Y = 13;  /* denser, for the world-spanning base      */
  var BASE_PX = 1024;
  var TCLAMP  = 3;                 /* hours either side of GE a local max may  */
                                   /* land. Beyond that the root-find has run  */
                                   /* off the end of the eclipse, not found a  */
                                   /* real peak.                               */

  var _on = false, _canvas = null, _src = null;

  /* Coast/border lines re-drawn ABOVE the cloud layer, and only while it is on.
     They reuse the existing 'coast'/'countries' sources — no extra fetch, no
     extra geometry, just two more line draws over data already on the GPU.
     Only while it is on, because an online basemap raster carries its own
     coastlines: Natural Earth will not register exactly with Esri's, so leaving
     these up permanently would show as doubled lines at high zoom. Colours are
     read from the live style rather than hardcoded, so they follow the palette.  */
  var RELINE = [
    { id: 'cloud-coast',     src: 'coast',     from: 'coast-line',     width: 0.7 },
    { id: 'cloud-countries', src: 'countries', from: 'countries-line', width: 0.5 }
  ];

  function _addLines() {
    RELINE.forEach(function (L) {
      try {
        if (!map.getSource(L.src) || map.getLayer(L.id)) return;
        var colour = map.getLayer(L.from)
                   ? map.getPaintProperty(L.from, 'line-color') : '#6a8870';
        map.addLayer({ id: L.id, type: 'line', source: L.src,
          paint: { 'line-color': colour, 'line-width': L.width, 'line-opacity': 0.9 } });
      } catch (e) {}
    });
  }

  function _removeLines() {
    RELINE.forEach(function (L) {
      try { if (map && map.getLayer(L.id)) map.removeLayer(L.id); } catch (e) {}
    });
  }
  var _slices = {};                      /* 'MM_HH' -> Uint8Array(NLAT*NLON)     */
  var _work = null;                      /* reused Float32Array intermediate     */
  var _lut = null;
  var _busy = false, _again = false;
  var _img = null;                       /* reused ImageData; see _draw()        */
  var _drawn = null;                     /* box last rendered, incl. margin      */
  var _drawnZoom = -1;
  var _canvasB = null, _srcB = null;
  var _baseKey = '';                     /* eclipse the base canvas was drawn for */
  var _drawnKey = '';                    /* eclipse the DETAIL canvas was drawn for */
  var _againForce = false;               /* a deferred render that must not be skipped */
  var _moving = false;
  var _lastRec = null;                   /* Besselian rec from the last render  */

  /* ---------------------------------------------------------------- palette */

  /* Jay Anderson's scale, matched to his colour bar: blue clear -> green ->
     cream -> orange -> dark red cloudy, in 5% classes. Banded, not smooth, for
     two reasons: you can read a value off the map without probing it, and it
     tells the truth about 0.5 deg data instead of implying detail we lack. */
  var STOPS = [
    [0.00,  45,  78, 145], [0.10,  62, 110, 180], [0.20, 110, 160, 205],
    [0.30, 165, 200, 225], [0.40, 120, 190, 120], [0.50,  70, 165,  75],
    [0.55, 150, 205, 120], [0.60, 240, 240, 205], [0.70, 250, 220, 150],
    [0.80, 240, 150,  90], [0.90, 205,  70,  50], [1.00, 135,  20,  28]
  ];

  /* One 256-entry lookup table, built once. Banding, ramp interpolation and
     clamping all collapse into a single array read in the pixel loop. */
  function _buildLut() {
    var lut = new Uint8Array(256 * 3), v, f, q, i, k, t;
    for (v = 0; v < 256; v++) {
      f = Math.min(1, v / SCALE);
      q = Math.min(1, Math.floor(f * 20) / 20 + 0.025);   /* 5% classes */
      for (i = 1; i < STOPS.length && STOPS[i][0] < q; i++) {}
      k = STOPS[i - 1];
      var n = STOPS[Math.min(i, STOPS.length - 1)];
      t = (n[0] === k[0]) ? 0 : (q - k[0]) / (n[0] - k[0]);
      lut[v * 3]     = k[1] + (n[1] - k[1]) * t;
      lut[v * 3 + 1] = k[2] + (n[2] - k[2]) * t;
      lut[v * 3 + 2] = k[3] + (n[3] - k[3]) * t;
    }
    return lut;
  }

  /* ------------------------------------------------------------- data load */

  function _pad(n) { return (n < 10 ? '0' : '') + n; }

  function _key(month, slice) { return _pad(month) + '_' + _pad(slice * LST_STEP); }

  /* Decode one WebP to a plain Uint8Array of the red channel. A detached canvas
     is fine here — it never enters the document. */
  function _loadSlice(month, slice) {
    var k = _key(month, slice);
    if (_slices[k]) return Promise.resolve(_slices[k]);
    return new Promise(function (resolve, reject) {   /* never rejects on 404 */
      var img = new Image();
      img.onload = function () {
        if (img.width !== NLON || img.height !== NLAT) {
          reject(new Error('cloud slice ' + k + ' is ' + img.width + 'x' +
                           img.height + ', expected ' + NLON + 'x' + NLAT));
          return;
        }
        var c = document.createElement('canvas');
        c.width = NLON; c.height = NLAT;
        var cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0);
        var px = cx.getImageData(0, 0, NLON, NLAT).data;
        var out = new Uint8Array(NLAT * NLON);
        for (var i = 0, n = out.length; i < n; i++) out[i] = px[i * 4];
        _slices[k] = out;
        resolve(out);
      };
      /* Resolve null rather than reject: a month we do not have yet must
         degrade to the neighbouring month, not kill the layer. */
      img.onerror = function () { resolve(null); };
      img.src = DATA_BASE + '/cloud/cloud_' + k + '.webp?v=' + BUILD;
    });
  }

  /* Besselian record for the selected eclipse. loadChunk() caches both the
     resolved data and the in-flight promise, so this is free after the first
     call and never duplicates a fetch. Resolves null rather than rejecting:
     without a record we still draw, just anchored on greatest eclipse. */
  function _loadRec(entry) {
    if (!entry || typeof loadChunk !== 'function') return Promise.resolve(null);
    return loadChunk(entry._chunk).then(function (chunk) {
      for (var i = 0; i < chunk.length; i++) {
        var r = chunk[i];
        if (r.year === entry.year && r.month === entry.month && r.day === entry.day) return r;
      }
      return null;
    }).catch(function () { return null; });
  }

  /* UT hour of local maximum eclipse on a coarse lat/lon grid over the bbox.
     findMaximum() returns a TDT offset from rec.t0; the UT conversion is the
     same one computeEclipse() uses. Longitude goes in west-positive. */
  function _timeGrid(rec, box, utGE, NX, NY) {
    NX = NX || TGRID_X; NY = NY || TGRID_Y;
    var g = new Float64Array(NX * NY), i, j;
    if (!rec || typeof findMaximum !== 'function') { g.fill(utGE); return g; }
    var dT = rec.dt;
    for (j = 0; j < NY; j++) {
      var lat = box.s + (box.n - box.s) * (NY === 1 ? 0 : j / (NY - 1));
      for (i = 0; i < NX; i++) {
        var lon = box.w + (box.e - box.w) * (NX === 1 ? 0 : i / (NX - 1));
        var ut = utGE;
        try {
          var t = findMaximum(rec, lat, -lon, 0, dT);
          if (isFinite(t)) {
            ut = rec.t0 + t - dT / 3600;
            if (!(Math.abs(ut - utGE) <= TCLAMP)) ut = utGE;
          }
        } catch (e) {}
        g[j * NX + i] = ut;
      }
    }
    return g;
  }

  /* -------------------------------------------------------------- geometry */

  function _hmsToHours(s) {
    if (typeof s === 'number') return s;
    if (typeof s !== 'string') return null;
    var p = s.split(':');
    var h = parseFloat(p[0]) || 0;
    var m = p.length > 1 ? (parseFloat(p[1]) || 0) : 0;
    var sec = p.length > 2 ? (parseFloat(p[2]) || 0) : 0;
    return h + m / 60 + sec / 3600;
  }

  var DIM = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  /* Continuous month position, so 1 Aug and 31 Aug are not the same map. Month
     m's mean is centred on m + 0.5; blend across that. */
  function _monthBlend(month, day) {
    var t = (month - 1) + (Math.max(1, day || 15) - 0.5) / DIM[month - 1] - 0.5;
    var m0 = Math.floor(t), w = t - m0;
    return { m0: ((m0 % 12) + 12) % 12 + 1, m1: ((m0 + 1) % 12 + 12) % 12 + 1, w: w };
  }

  function _mercY(lat) {
    return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  }
  function _invMercY(y) {
    return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
  }

  /* Visible lon/lat box, clamped to the world and to the Mercator limit. On the
     globe at low zoom getBounds() can wrap or exceed the world; in that case the
     whole world is the honest answer and also the cheap one. */
  function _bbox() {
    var b = map.getBounds();
    var w = b.getWest(), e = b.getEast(),
        s = b.getSouth(), n = b.getNorth();
    if (!(e > w) || (e - w) > 355) { w = -180; e = 180; }

    /* Render beyond the viewport so ordinary panning stays inside what is
       already drawn and needs no redraw at all. Cheap now that the canvas is
       sized to the data rather than the screen. */
    var mx = (e - w) * MARGIN, my = (n - s) * MARGIN;
    w -= mx; e += mx; s -= my; n += my;
    if (e - w >= 360) { w = -180; e = 180; }

    return {
      w: w, e: e,
      s: Math.max(-LAT_MAX, Math.min(LAT_MAX, s)),
      n: Math.max(-LAT_MAX, Math.min(LAT_MAX, n))
    };
  }

  /* True when what is already on screen still covers the viewport, so a pan or
     a nudge needs no work at all. Zoom is included because the canvas is sized
     to the zoom: staying inside the drawn box at a very different scale would
     mean rendering the data at the wrong resolution. */
  function _covered() {
    if (!_drawn) return false;
    /* Geometry alone cannot answer "is this still valid" — it says nothing about
       WHICH eclipse the pixels are for. Jumping from the log used to leave the
       old eclipse's overlay in place: the jump kicks a render, `selectedEntry`
       changes while that one is still in flight, and the queued redraw then
       found the box unchanged and skipped. The box was right and the month was
       wrong. */
    if (_drawnKey !== _eclipseKey(selectedEntry)) return false;
    if (Math.abs(map.getZoom() - _drawnZoom) > 0.25) return false;
    var b = map.getBounds();
    var w = b.getWest(), e = b.getEast();
    if (!(e > w) || (e - w) > 355) return _drawn.e - _drawn.w >= 359.9;
    return w >= _drawn.w && e <= _drawn.e &&
           b.getSouth() >= _drawn.s && b.getNorth() <= _drawn.n;
  }

  /* ---------------------------------------------------------------- render */

  /* Two-stage, and deliberately so. Blending 16 source arrays per output pixel
     would be ~16 reads x 1M pixels. Doing the slice/month blend once per SOURCE
     ROW into an intermediate, then resampling rows, is ~8M reads instead of
     ~26M — the difference between a hitch and a frame on a phone. */
  function _draw(slices, wm, tgrid, box, W, H, NX, NY) {
    NX = NX || TGRID_X; NY = NY || TGRID_Y;
    var x, y, i, r;

    /* Per-column: source column pair + weight, the column's longitude/15 (its
       offset from UT to local solar time), and its position in the time grid. */
    var c0 = new Int32Array(W), c1 = new Int32Array(W), wc = new Float32Array(W),
        lonH = new Float32Array(W), gx0 = new Int32Array(W), gwx = new Float32Array(W);
    for (x = 0; x < W; x++) {
      var lon = box.w + (x + 0.5) / W * (box.e - box.w);
      var sc = (lon + 180) / DEG - 0.5;
      var fc = Math.floor(sc);
      c0[x] = ((fc % NLON) + NLON) % NLON;
      c1[x] = (c0[x] + 1) % NLON;
      wc[x] = sc - fc;
      lonH[x] = lon / 15;
      var fx = (box.e === box.w) ? 0 : (lon - box.w) / (box.e - box.w) * (NX - 1);
      var ix = Math.floor(fx); if (ix < 0) ix = 0; if (ix > NX - 2) ix = NX - 2;
      gx0[x] = ix; gwx[x] = fx - ix;
    }

    /* Only the source rows the viewport actually covers. At country zoom that is
       ~20 rows of 361, which more than pays for the per-pixel time lookup. */
    var rMin = Math.floor((90 - box.n) / DEG) - 1, rMax = Math.ceil((90 - box.s) / DEG) + 1;
    if (rMin < 0) rMin = 0;
    if (rMax > NLAT - 1) rMax = NLAT - 1;

    /* Stage 1 — slice + month + longitude blend, at full source latitude. */
    if (!_work || _work.length < NLAT * W) _work = new Float32Array(NLAT * W);
    var work = _work, base;
    var latSpan = (box.n === box.s) ? 1 : (box.n - box.s);
    for (r = rMin; r <= rMax; r++) {
      base = r * NLON;
      var wbase = r * W;

      /* Time-grid row weights depend only on latitude — hoisted out of x. */
      var lat = 90 - r * DEG;
      var fy = (lat - box.s) / latSpan * (NY - 1);
      var iy = Math.floor(fy); if (iy < 0) iy = 0; if (iy > NY - 2) iy = NY - 2;
      var wy = fy - iy;
      if (wy < 0) wy = 0; if (wy > 1) wy = 1;
      var gA = iy * NX, gB = (iy + 1) * NX;

      for (x = 0; x < W; x++) {
        /* UT of local maximum here, then this point's own local solar time. */
        var ix = gx0[x], wx = gwx[x];
        var ut = (tgrid[gA + ix] * (1 - wx) + tgrid[gA + ix + 1] * wx) * (1 - wy) +
                 (tgrid[gB + ix] * (1 - wx) + tgrid[gB + ix + 1] * wx) * wy;
        var lst = (ut + lonH[x]) % 24; if (lst < 0) lst += 24;
        var si = lst / LST_STEP, fs = Math.floor(si);
        var sA = fs % NSLICE, sB = (sA + 1) % NSLICE, wsx = si - fs;

        var a = c0[x], b = c1[x], t = wc[x];
        var A = slices.m0[sA], B = slices.m0[sB];
        var v0 = (A[base + a] * (1 - t) + A[base + b] * t) * (1 - wsx) +
                 (B[base + a] * (1 - t) + B[base + b] * t) * wsx;
        var C = slices.m1[sA], D = slices.m1[sB];
        var v1 = (C[base + a] * (1 - t) + C[base + b] * t) * (1 - wsx) +
                 (D[base + a] * (1 - t) + D[base + b] * t) * wsx;
        work[wbase + x] = v0 * (1 - wm) + v1 * wm;
      }
    }

    /* Stage 2 — Mercator rows, colourised through the LUT. */
    var ctx = _canvas.getContext('2d');
    /* Reused across redraws. A fresh createImageData() every moveend is 4 MB of
       garbage per pan at full size, which the collector eventually charges for
       mid-gesture. */
    if (!_img || _img.width !== W || _img.height !== H) _img = ctx.createImageData(W, H);
    var img = _img, out = img.data;
    var yN = _mercY(box.n), yS = _mercY(box.s);
    for (y = 0; y < H; y++) {
      var my = yN + (y + 0.5) / H * (yS - yN);
      var lat = _invMercY(my);
      var sr = (90 - lat) / DEG;
      var fr = Math.floor(sr);
      if (fr < rMin) fr = rMin; if (fr > rMax - 1) fr = rMax - 1;
      if (fr < 0) fr = 0; if (fr > NLAT - 2) fr = NLAT - 2;
      var t2 = sr - fr;
      var rowA = fr * W, rowB = (fr + 1) * W, o = y * W * 4;
      for (x = 0; x < W; x++) {
        var v = work[rowA + x] * (1 - t2) + work[rowB + x] * t2;
        i = (v < 0 ? 0 : v > 255 ? 255 : v | 0) * 3;
        out[o]     = _lut[i];
        out[o + 1] = _lut[i + 1];
        out[o + 2] = _lut[i + 2];
        out[o + 3] = 255;
        o += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* Show exactly one of the two layers. Stacking them would composite 0.7 over
     0.7 to 0.91 and read as a darkening every time the detail canvas appeared. */
  function _swap(showDetail) {
    try {
      if (map.getLayer(LAYER_B))
        map.setLayoutProperty(LAYER_B, 'visibility', showDetail ? 'none' : 'visible');
      if (map.getLayer(LAYER))
        map.setLayoutProperty(LAYER, 'visibility', showDetail ? 'visible' : 'none');
    } catch (e) {}
  }

  /* World canvas, drawn once per eclipse and never for pan or zoom. Denser time
     grid than the detail pass because it spans 360 degrees, not a viewport. */
  function _renderBase(slices, wm, bessel, utGE, key) {
    if (_baseKey === key && map.getLayer(LAYER_B)) return;
    var box = { w: -180, e: 180, s: -LAT_MAX, n: LAT_MAX };
    if (!_canvasB) _canvasB = document.createElement('canvas');
    var wh = _safeSize(BASE_PX, BASE_PX), W = wh[0], H = wh[1];
    _canvasB.width = W; _canvasB.height = H;

    var keepImg = _img; _img = null;        /* do not clobber the detail buffer */
    var keepCv = _canvas; _canvas = _canvasB;
    _draw(slices, wm, _timeGrid(bessel, box, utGE, BGRID_X, BGRID_Y),
          box, W, H, BGRID_X, BGRID_Y);
    _canvas = keepCv; _img = keepImg;

    var coords = [[box.w, box.n], [box.e, box.n], [box.e, box.s], [box.w, box.s]];
    if (!map.getSource(SRC_B)) {
      map.addSource(SRC_B, { type: 'canvas', canvas: _canvasB,
                             coordinates: coords, animate: false });
      map.addLayer({ id: LAYER_B, type: 'raster', source: SRC_B,
                     paint: { 'raster-opacity': OPACITY, 'raster-fade-duration': 0 } });
      _srcB = map.getSource(SRC_B);
    } else {
      _srcB.play(); _srcB.pause();
    }
    _baseKey = key;
  }

  /* NOT _key — that name was already taken by the slice cache key at the top of
     this file, and declaring it twice in one scope silently redefined it: every
     _loadSlice() lookup started returning garbage and the whole layer disabled
     itself. Guarded in test_hygiene now. */
  function _eclipseKey(e) {
    return e ? e.year + '_' + e.month + '_' + e.day : '';
  }

  function _render(force) {
    if (!_on || !map || !mapReady || !selectedEntry) return;
    if (!force && _covered()) return;
    /* A FORCED render must stay forced when it is deferred. Replaying it
       unforced let `_covered()` throw it away against a box the in-flight
       render had just repopulated — the log-jump staleness above. */
    if (_busy) { _again = true; if (force) _againForce = true; return; }
    _busy = true;

    var rec = selectedEntry;
    var utGE = _hmsToHours(rec.td_ge);
    if (utGE === null) { _busy = false; return; }
    var mb = _monthBlend(rec.month, rec.day);

    var need = [], s;
    for (s = 0; s < NSLICE; s++) { need.push(_loadSlice(mb.m0, s)); }
    for (s = 0; s < NSLICE; s++) { need.push(_loadSlice(mb.m1, s)); }
    need.push(_loadRec(rec));

    Promise.all(need).then(function (arr) {
      if (!_on) return;
      var bessel = arr[arr.length - 1];
      _lastRec = bessel;
      var a0 = arr.slice(0, NSLICE), a1 = arr.slice(NSLICE, NSLICE * 2);
      var have0 = a0.every(Boolean), have1 = a1.every(Boolean);
      if (!have0 && !have1) {
        console.warn('[cloud] no data for month ' + mb.m0 + ' or ' + mb.m1 +
                     ' — run gen_cloud_climatology.py for those months');
        _disable();
        return;
      }
      /* One month missing is not fatal: fall back to the neighbour rather than
         blanking the map. Only both missing is a real failure. */
      var slices = { m0: have0 ? a0 : a1, m1: have1 ? a1 : a0 };
      var wm = (have0 && have1) ? mb.w : 0;
      var box = _bbox();

      /* Canvas sized to the DATA, not the screen. Over Iberia the viewport holds
         ~38 source cells of 0.5 deg; rendering those into 1024 px was a 27-fold
         oversample per axis — a million pixels of honest work carrying no
         information. OVER px per cell keeps every bit of what the data contains
         and lets the GPU's linear filter do the upscale for free, which also
         means a pan looks soft rather than blocky between redraws.
         Zoomed all the way out this still asks for 720*OVER and clamps to
         MAX_PX, so world view loses nothing it had before. */
      var lonSpan = box.e - box.w;
      var mercSpan = _mercY(box.n) - _mercY(box.s);
      var W = Math.round(lonSpan / DEG * OVER);
      W = Math.max(MIN_PX, Math.min(MAX_PX, W));
      var H = Math.round(W * mercSpan / (lonSpan * Math.PI / 180));
      H = Math.max(MIN_PX, Math.min(MAX_PX, H));

      var wh2 = _safeSize(W, H); W = wh2[0]; H = wh2[1];
      if (_canvas.width !== W)  _canvas.width  = W;
      if (_canvas.height !== H) _canvas.height = H;

      /* Base first: it must exist below the detail layer, and it is what covers
         the screen whenever the detail canvas does not. */
      _renderBase(slices, wm, bessel, utGE,
                  rec.year + '_' + rec.month + '_' + rec.day);
      _draw(slices, wm, _timeGrid(bessel, box, utGE), box, W, H);

      var coords = [[box.w, box.n], [box.e, box.n], [box.e, box.s], [box.w, box.s]];
      if (!map.getSource(SRC)) {
        map.addSource(SRC, { type: 'canvas', canvas: _canvas,
                             coordinates: coords, animate: false });
        map.addLayer({ id: LAYER, type: 'raster', source: SRC,
                       paint: { 'raster-opacity': OPACITY,
                                'raster-fade-duration': 0 } });
        _src = map.getSource(SRC);
        _addLines();          /* after the cloud layer, so they sit above it */
      } else {
        _src.setCoordinates(coords);
        /* animate:false means prepare() only re-uploads the texture on resize or
           while playing. play()+pause() forces exactly one upload. Verified
           against CanvasSource.prepare() in maplibre-gl 5.5.0. */
        _src.play(); _src.pause();
      }
      _drawn = box; _drawnZoom = map.getZoom(); _drawnKey = _eclipseKey(rec);
      _swap(!_moving);
    }).catch(function (err) {
      console.warn('[cloud]', err && err.message || err);
      _disable();
    }).then(function () {
      _busy = false;
      if (_again) { _again = false; var f = _againForce; _againForce = false; _render(f); }
    });
  }

  /* ---------------------------------------------------------------- public */

  /* WHICH month pair and WHICH pair of local-solar-time slices a point needs.
     Extracted so that sampleAt() and ensureAt() cannot drift: if the loader
     fetched a different slice than the sampler reads, the readout would sit at
     "—" forever with nothing to show why. */
  function _slotFor(lon, lat) {
    if (!selectedEntry) return null;
    var utGE = _hmsToHours(selectedEntry.td_ge);
    if (utGE === null) return null;
    var mb = _monthBlend(selectedEntry.month, selectedEntry.day);
    /* Same local-maximum timing as the map. _lastRec is whatever the last render
       resolved; without it this falls back to greatest eclipse exactly as the
       map does, so the number can never disagree with the colour under it. */
    var ut = utGE;
    if (_lastRec && typeof findMaximum === 'function') {
      try {
        var tt = findMaximum(_lastRec, lat, -lon, 0, _lastRec.dt);
        if (isFinite(tt)) {
          var u = _lastRec.t0 + tt - _lastRec.dt / 3600;
          if (Math.abs(u - utGE) <= TCLAMP) ut = u;
        }
      } catch (e) {}
    }
    var lst = ((ut + lon / 15) % 24 + 24) % 24;
    var si = lst / LST_STEP, fs = Math.floor(si);
    return { mb: mb, fs: fs, ws: si - fs };
  }

  /* Cloud fraction 0..1 at a point, or null. Same blend as the map, so the
     number in a readout can never disagree with the colour under the cursor. */
  function sampleAt(lon, lat) {
    var slot = _slotFor(lon, lat);
    if (!slot) return null;
    var mb = slot.mb, fs = slot.fs, ws = slot.ws;
    var sc = (((lon + 180) % 360 + 360) % 360) / DEG - 0.5;
    var fc = Math.floor(sc), wc = sc - fc;
    var a = ((fc % NLON) + NLON) % NLON, b = (a + 1) % NLON;
    var sr = (90 - Math.max(-90, Math.min(90, lat))) / DEG;
    var fr = Math.max(0, Math.min(NLAT - 2, Math.floor(sr))), wr = sr - fr;

    function bil(arr) {
      if (!arr) return null;
      var p = fr * NLON, q = (fr + 1) * NLON;
      return (arr[p + a] * (1 - wc) + arr[p + b] * wc) * (1 - wr) +
             (arr[q + a] * (1 - wc) + arr[q + b] * wc) * wr;
    }
    function month(m) {
      var A = _slices[_key(m, fs % NSLICE)], B = _slices[_key(m, (fs + 1) % NSLICE)];
      if (!A || !B) return null;
      return bil(A) * (1 - ws) + bil(B) * ws;
    }
    var v0 = month(mb.m0), v1 = month(mb.m1);
    if (v0 === null && v1 === null) return null;
    if (v0 === null) return v1 / SCALE;
    if (v1 === null) return v0 / SCALE;
    return (v0 * (1 - mb.w) + v1 * mb.w) / SCALE;
  }

  /* Load exactly the slices ONE POINT needs, then sample it.
     The details panel wants a cloud figure without the overlay being on, and
     the overlay is what normally populates _slices — so without this,
     sampleAt() returns null for anyone who has not toggled the map layer.
     Four slices at most (two months x two time slices), each ~35 KB and all 96
     precached by sw.js, so this is a cache read rather than a download and it
     works offline. */
  function ensureAt(lon, lat) {
    var slot = _slotFor(lon, lat);
    if (!slot) return Promise.resolve(null);
    var a = slot.fs % NSLICE, b = (slot.fs + 1) % NSLICE;
    var want = [[slot.mb.m0, a], [slot.mb.m0, b],
                [slot.mb.m1, a], [slot.mb.m1, b]];
    return Promise.all(want.map(function (p) { return _loadSlice(p[0], p[1]); }))
      .then(function () { return sampleAt(lon, lat); })
      .catch(function () { return null; });
  }

  function _enable() {
    if (_on) return;
    if (!selectedEntry) return;
    _on = true;
    if (!_lut) _lut = _buildLut();
    if (!_canvas) { _canvas = document.createElement('canvas'); _canvas.width = 2; _canvas.height = 2; }
    _syncBtn();
    _render(true);
  }

  function _disable() {
    _on = false;
    _removeLines();
    /* ONE try PER REMOVAL. All four used to share a single try with a silent
       catch, and MapLibre throws on removeSource when a layer still references
       the source — so one throw skipped every removal after it and the catch
       swallowed the reason. Simulated against a map that throws where MapLibre
       does, a throw on removeSource('cloud') left cloud-base still painted while
       the button reported off. cloud-now.js already tears down this way. */
    try { if (map && map.getLayer(LAYER))    map.removeLayer(LAYER); }    catch (e) {}
    try { if (map && map.getSource(SRC))     map.removeSource(SRC); }     catch (e) {}
    try { if (map && map.getLayer(LAYER_B))  map.removeLayer(LAYER_B); }  catch (e) {}
    try { if (map && map.getSource(SRC_B))   map.removeSource(SRC_B); }   catch (e) {}
    _src = null; _srcB = null; _baseKey = ''; _drawnKey = ''; _moving = false;
    _drawn = null; _drawnZoom = -1;
    _syncBtn();
  }

  function _syncBtn() {
    var b = document.getElementById('btn-cloud');
    if (!b) return;
    /* CloudBar owns the button's pressed state once it exists, because "on" then
       means "some cloud mode is showing", which may be satellite rather than
       this layer. Leaving both to write it would make the two fight on toggle. */
    if (window.CloudBar) return;
    b.setAttribute('aria-pressed', _on ? 'true' : 'false');
    b.title = _on ? 'Cloud cover — hide'
                  : 'Mean cloud cover at the eclipse hour (ERA5 1991-2020)';
  }

  function toggle() { if (_on) _disable(); else _enable(); }

  /* ------------------------------------------------------------------ wire */

  (function () {
    var b = document.getElementById('btn-cloud');
    if (b) {
      b.removeAttribute('aria-disabled');
      b.addEventListener('click', function (e) {
        e.preventDefault();
        /* Delegate when the mode strip is present. The strip turns this layer on
           and off among others, so it must own the click; without a strip the
           button stays exactly the plain toggle it has always been. */
        if (window.CloudBar && CloudBar.handleButton) CloudBar.handleButton();
        else toggle();
      });
    }
    _syncBtn();

    /* Viewport-follow. moveend only — redrawing during the gesture would fight
       the map for the main thread on a phone, and the layer is stretched by
       MapLibre in the meantime, which reads as motion blur rather than as a bug. */
    if (typeof AppState !== 'undefined') {
      AppState.on('selectedEntry', function () {
        _drawn = null; _baseKey = ''; _drawnKey = '';   /* new eclipse — nothing is still valid */
        if (_on) _render(true);
      });
      AppState.on('mapReady', function () {
        if (!map || !map.on) return;

        /* While a gesture runs, show the world canvas and do no work at all: it
           already covers every possible viewport, so nothing can outrun it. The
           detail canvas comes back at moveend. This is why chasing redraw speed
           was the wrong fix — zooming out doubles the viewport in one frame, and
           no margin or frame budget can stay ahead of that. */
        map.on('movestart', function () {
          if (!_on) return;
          _moving = true;
          _swap(false);
        });

        map.on('moveend', function () {
          if (!_on) return;
          _moving = false;
          _render(true);          /* always redraw: the detail canvas is stale */
        });
      });
    }
  })();

  /* Bump on every change. The script tags carry a hardcoded ?v= and the service
     worker is cache-first with ignoreSearch, so "is this the file I just
     uploaded?" is otherwise unanswerable from the console. Check Cloud.version. */
  window.Cloud = { version: '2026-08-25a',
                   toggle: toggle, sampleAt: sampleAt, ensureAt: ensureAt,
                   enable: _enable, disable: _disable,
                   /* The legend must be built from the same numbers the pixels
                      are, or the bar and the map drift apart silently. */
                   stops: function () { return STOPS.slice(); },
                   isOn: function () { return _on; } };
})();
