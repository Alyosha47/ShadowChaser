/* js/satellite.js — live satellite cloud, the "Now" mode (#F2c).
 *
 * DATA + LAYER, no UI. js/cloud.js is the sibling that owns the climatology
 * field; the two are mutually exclusive at the control level, not here.
 *
 * WHAT THIS SHOWS, AND WHERE EACH PART COMES FROM
 *
 *   WHERE the cloud is        EUMETSAT's operational cloud mask, where it exists
 *   HOW THICK it looks        geostationary infrared, everywhere
 *
 * Those are two different questions and they have two different best answers.
 *
 * EXTENT — msg_fes:clm and msg_iodc:clm are classified products: EUMETSAT has
 * already decided, per pixel, cloud or not, using channels and thresholds this
 * app cannot match from a rendered greyscale image. Cloud is white, sea blue,
 * land green; 0.1% of pixels fall outside those three, measured. Where a mask is
 * published there is no reason to infer what somebody else has measured. That
 * covers Europe, Africa, the Middle East and the Indian Ocean — both the 2026
 * and 2027 tracks.
 *
 * SHADING — the mask is binary, and "cloudy" covers both thin haze you can see
 * the sun through and a storm top you cannot. Infrared brightness stands in for
 * cloud-top height, so it separates those. It is used INSIDE the mask, never to
 * decide the boundary.
 *
 * The Americas and the Pacific have no published geostationary cloud mask —
 * checked by enumeration, not assumed — so infrared alone decides both questions
 * there, and is honestly worse for it.
 *
 * RESOLUTION, which was the whole problem before. An earlier version composited
 * a fixed 2048-pixel world raster once per frame and never redrew on move. At
 * that size the north coast of Spain is FORTY-SIX PIXELS WIDE, so a real cloud
 * deck over it averaged away to almost nothing, and the map said clear when
 * every other tool said cloudy. The canvas now follows the viewport, exactly as
 * cloud.js's detail canvas does, so what is requested is what is drawn.
 *
 * That fixed raster existed because of a belief that map.getBounds() is
 * meaningless in globe projection. It is not: cloud.js has always used it, and
 * simply detects the degenerate case — bounds that wrap, or span more than 355
 * degrees — and falls back to the whole world, which at that zoom is also the
 * cheap answer. Same guard here.
 *
 * THE CLEAR-SKY FLOOR CANNOT COME FROM THE VIEWPORT. Infrared brightness is
 * surface temperature wherever there is no cloud, so the floor is measured as
 * the warmest ground nearby — and "nearby" has to mean about twenty degrees. A
 * viewport zoomed onto a coastline under a frontal band contains no visible
 * ground at all, so its floor would land inside the cloud and the cloud would
 * erase itself. The floors are therefore measured once on a whole-world pass and
 * sampled by the detail pass. Surface temperature varies slowly; cloud does not.
 * That asymmetry is the only reason any of this works.
 *
 * EVERY CONSTANT WAS MEASURED AGAINST THE LIVE SERVICES, NOT RECALLED, and the
 * infrared floors were fitted by tools/checks/calibrate_cloud.py against the
 * agencies' own cloud products. Never guess a layer identifier: a wrong one
 * fails as a silently blank layer, and on this map blank reads as CLEAR SKY.
 */
(function () {
  'use strict';

  var GIBS   = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';
  var EUM    = 'https://view.eumetsat.int/geoserver/wms';
  var CREDIT = 'Imagery NASA EOSDIS GIBS \u00b7 EUMETSAT';

  /* Both services speak WMS 1.3.0 with CRS=EPSG:3857 and bbox in metres, which
     is why there is one request builder. The 1.3.0 axis-order flip applies to
     EPSG:4326 (lat,lon); using 4326 without swapping returns an empty image and
     NO error. EUMETSAT's capabilities advertise only 4326 for these layers and
     serve 3857 correctly anyway — verified against the live service. */

  /* mask: the agency's own classified cloud product, where one is published.
     floor: where cloud starts in units of that satellite's own local spread,
     fitted against msg_fes:clm, msg_iodc:clm and TEMPO cloud fraction by
     tools/checks/calibrate_cloud.py — held-out balanced accuracy about 0.80.
     Rerun the script rather than nudging these by eye. */
  var SATS = [
    { id: 'goes-east', name: 'GOES-East',        lon:  -75.2, svc: 'gibs', step: 10, floor: 0.58,
      layer: 'GOES-East_ABI_Band13_Clean_Infrared' },
    { id: 'goes-west', name: 'GOES-West',        lon: -137.0, svc: 'gibs', step: 10, floor: 0.60,
      layer: 'GOES-West_ABI_Band13_Clean_Infrared' },
    /* Two instruments at 0 degrees, and each is used for what it is best at.
       The MASK is only published for MSG/SEVIRI, and it is COARSE: it loses
       three times as much detail as the infrared under a 4x downsample (9.4
       against 3.1), which is precisely the blockiness that made cloud edges look
       like tiles. Meteosat Third Generation's high-rate infrared is finer AND
       fresher — measured 19 minutes old against SEVIRI's 29 — so it draws the
       texture while SEVIRI's mask decides the extent. */
    { id: 'msg',       name: 'Meteosat 0\u00b0', lon:    0.0, svc: 'eum',  step: 15, floor: 0.22,
      layer: 'msg_fes:ir108',  mask: 'msg_fes:clm', shade: 'mtg_fd:ir105_hrfi' },
    { id: 'iodc',      name: 'Meteosat IODC',    lon:   45.5, svc: 'eum',  step: 15, floor: 0.19,
      layer: 'msg_iodc:ir108', mask: 'msg_iodc:clm' },
    { id: 'himawari',  name: 'Himawari',         lon:  140.7, svc: 'gibs', step: 10, floor: 0.32,
      layer: 'Himawari_AHI_Band13_Clean_Infrared' }
  ];

  /* NO PALETTE DECODE. GIBS renders Himawari's Band13 through the infrared
     colour map where it renders the GOES pair as greyscale. An earlier version
     decoded it back to temperature through the published table; the table is
     exactly invertible so the decode was correct, and it was still wrong,
     because it compressed Himawari's useful range from 117 levels to 49 and the
     satellite could no longer read as cloudy as its neighbours. Raw channel-mean
     brightness matches GOES-West across the dateline. Never convert into a
     narrower representation on the way to a derived quantity. */

  var SRC_B = 'sat-now-base', LAYER_B = 'sat-now-base';
  var SRC   = 'sat-now',      LAYER   = 'sat-now';
  var OPACITY = 0.85;

  var R = 6378137, MAXY = 20037508.342789244;
  var LAT_MAX = 85.0511287798066;
  var BASE_W  = 1536;          /* world pass: floors, spans, and the fallback draw */
  var MAX_PX  = 1100;          /* detail canvas cap */
  var MIN_PX  = 256;
  var MARGIN  = 0.18;   /* smaller margin = fewer pixels per fetch = quicker catch-up */          /* render beyond the viewport so small pans are free */
  var CUT     = 0.16;          /* cos of the limb angle, ~81 degrees */

  /* Floor cells are sized in DEGREES, not pixels, because they describe ground.
     Twelve degrees of search is what it takes for a cell in the middle of a
     storm to reach ground somebody can see; at three degrees the interior of a
     cloud mass sets its own floor and hollows itself out. Measured. */
  var CELL_DEG = 4, RAD_DEG = 20, PCT = 0.10;

  var TTL = 5 * 60 * 1000;
  var MAX_AGE_MIN = 180;
  var MAX_STEPS = 10;

  var _on = false, _map = null, _busy = false, _again = false;
  var _stamps = [], _missing = [], _err = null, _listeners = [];
  var _lut = null, _at = 0, _painted = 0;
  var _floors = {};            /* satellite id -> { g, cx, cy, span } in lon/lat  */
  var _cvB = null, _ctxB = null, _srcB = null, _drawnBase = false;
  var _cv = null, _ctx = null, _src = null, _drawn = null, _drawnZoom = 0;
  var _scratch = null, _sctx = null;

  /* ------------------------------------------------------------- projection */

  function mercY(lat) { return R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
  function invMercY(y) { return (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI; }

  function safeSize(w, h) {
    /* MapLibre binds with LINEAR_MIPMAP_NEAREST and only falls back to LINEAR
       when the size is NOT square-and-power-of-two. No mipmaps exist here, so a
       1024x1024 texture samples as BLACK — a grey veil over the whole map. Same
       trap as Cloud._safeSize(). Do not tidy this into a neat square. */
    var pot = function (v) { return (Math.log(v) / Math.LN2) % 1 === 0; };
    if (w === h && pot(w)) h -= 1;
    return [w, h];
  }

  /* Visible lon/lat box. On the globe at low zoom getBounds() can wrap or exceed
     the world; the whole world is then both the honest answer and the cheap one.
     This guard is lifted from cloud.js, which has been shipping it — an earlier
     version of this file avoided getBounds() entirely on the belief that it is
     meaningless in globe projection, and paid for it with a fixed world raster
     in which a coastline is forty pixels wide. */
  function viewBox() {
    var b = _map.getBounds();
    var w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
    if (!(e > w) || (e - w) > 355) { w = -180; e = 180; }
    var mx = (e - w) * MARGIN, my = (n - s) * MARGIN;
    w -= mx; e += mx; s -= my; n += my;
    if (e - w >= 360) { w = -180; e = 180; }
    return { w: w, e: e,
             s: Math.max(-LAT_MAX, Math.min(LAT_MAX, s)),
             n: Math.max(-LAT_MAX, Math.min(LAT_MAX, n)) };
  }

  function covered() {
    if (!_drawn) return false;
    if (Math.abs(_map.getZoom() - _drawnZoom) > 0.25) return false;
    var b = _map.getBounds(), w = b.getWest(), e = b.getEast();
    if (!(e > w) || (e - w) > 355) return _drawn.e - _drawn.w >= 359.9;
    return w >= _drawn.w && e <= _drawn.e &&
           b.getSouth() >= _drawn.s && b.getNorth() <= _drawn.n;
  }

  /* ---------------------------------------------------------------- fetching */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function stamp(sat, ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
           'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':00' +
           (sat.svc === 'eum' ? '.000Z' : 'Z');   /* EUMETSAT stamps carry milliseconds
                                                     where GIBS does not; reformatting
                                                     invents a time neither has heard of */
  }

  function url(sat, layer, iso, box, w, h) {
    var W = R * box.w * Math.PI / 180, E = R * box.e * Math.PI / 180;
    return (sat.svc === 'gibs' ? GIBS : EUM) +
      '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap' +
      '&LAYERS=' + encodeURIComponent(layer) +
      '&STYLES=&CRS=EPSG%3A3857&FORMAT=image%2Fpng&TRANSPARENT=TRUE' +
      '&WIDTH=' + w + '&HEIGHT=' + h +
      '&BBOX=' + W + ',' + mercY(box.s) + ',' + E + ',' + mercY(box.n) +
      '&TIME=' + encodeURIComponent(iso);
  }

  function loadImage(u) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.crossOrigin = 'anonymous';   /* both services send permissive CORS; without
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

  function lit(d, stride) {
    var n = 0, m = 0, p;
    for (p = 3; p < d.length; p += 4 * stride) { m++; if (d[p] > 250) n++; }
    return m ? n / m : 0;
  }

  /* THE CATALOGUE LEADS PUBLICATION, and an empty frame is not an error. GIBS
     answers a not-yet-published time with a valid, entirely transparent PNG —
     200 OK, onload fires, nothing in it. Measured: Himawari returned three such
     frames in a row, ten minutes apart, before a real one. Retrying only on
     failure therefore accepts the blank and drops a satellite, and a dropped
     satellite is a hole, and a hole reads as CLEAR SKY. Test the PIXELS. */
  function frameFor(sat, box, w, h) {
    var n = 0;
    var ms = Date.now() - sat.step * 60000;
    ms = Math.floor(ms / (sat.step * 60000)) * (sat.step * 60000);

    function attempt() {
      if (n >= MAX_STEPS) return null;
      var t = ms - (n++) * sat.step * 60000;
      if ((Date.now() - t) / 60000 > MAX_AGE_MIN) return null;
      var iso = stamp(sat, t);
      return loadImage(url(sat, sat.layer, iso, box, w, h)).then(function (im) {
        var d = readPixels(im, w, h);
        if (lit(d, 61) < 0.01) return attempt();
        return { iso: iso, at: t, ir: d };
      }, attempt);
    }
    return Promise.resolve().then(attempt);
  }

  /* The mask is fetched at the SAME instant as the infrared it will gate, not at
     its own newest frame. They are both 15-minute products from the same
     instrument; taking them from different times would draw one scene's extent
     around another scene's shading. */
  function maskFor(sat, iso, box, w, h) {
    if (!sat.mask) return Promise.resolve(null);
    return loadImage(url(sat, sat.mask, iso, box, w, h)).then(function (im) {
      var d = readPixels(im, w, h);
      return lit(d, 61) > 0.5 ? d : null;
    }, function () { return null; });
  }

  /* The finer instrument, stepped back on its own cadence. Optional by design:
     if it is unavailable the coarser infrared already in hand still shades, so a
     missing frame costs sharpness and never costs the layer. */
  function shadeFor(sat, box, w, h) {
    if (!sat.shade) return Promise.resolve(null);
    var n = 0, step = 10;
    var ms = Math.floor((Date.now() - step * 60000) / (step * 60000)) * (step * 60000);
    function attempt() {
      if (n >= 6) return null;
      var t = ms - (n++) * step * 60000;
      var iso = stamp(sat, t);
      return loadImage(url(sat, sat.shade, iso, box, w, h)).then(function (im) {
        var d = readPixels(im, w, h);
        return lit(d, 61) < 0.3 ? attempt() : d;
      }, attempt);
    }
    return Promise.resolve().then(attempt);
  }

  /* --------------------------------------------------------------- the field */

  /* Cloud is white, sea blue, land green — three classes, and a pixel is
     whichever it is NEAREST. A plain "all channels above 170" test looked
     equivalent and cost 3% agreement in the Atlantic, because server-side
     resampling blends class edges and a blended pixel fails a threshold while
     still being unambiguously nearest one class. Classify, do not threshold. */
  function isCloud(d, p) {
    var r = d[p], g = d[p + 1], b = d[p + 2];
    var dw = (255 - r) * (255 - r) + (255 - g) * (255 - g) + (255 - b) * (255 - b);
    var db = r * r + g * g + (255 - b) * (255 - b);
    var dg = r * r + (255 - g) * (255 - g) + b * b;
    return dw <= db && dw <= dg;
  }

  function grey(d, p) {
    /* Channel mean. A pixel whose channels disagree is a resampling blend of two
       greys and is still a perfectly good brightness; an earlier version
       discarded those — 8.8% of a measured frame — punching transparent holes
       the basemap showed through as speckle. */
    return (d[p] + d[p + 1] + d[p + 2]) / 3;
  }

  /* Floors and spans, measured once per refresh on a whole-world pass and
     sampled thereafter. Stored against lon/lat so the detail pass can read them
     at any zoom. */
  /* Cloud-top brightness percentiles among pixels the MASK calls cloud, measured
     on the world pass so the shading means the same thing wherever you look.
     Measured on a live frame: p10 40, p95 213. */
  function cloudRange(d, mk, w, h) {
    var sm = [], q = 0, i, j, p;
    for (j = 0; j < h; j += 2) for (i = 0; i < w; i += 2) {
      p = (j * w + i) * 4;
      if (d[p + 3] > 250 && isCloud(mk, p)) sm[q++] = grey(d, p);
    }
    if (q < 500) return null;
    sm.sort(function (a, b) { return a - b; });
    return { lo: sm[Math.floor(q * 0.10)], hi: sm[Math.floor(q * 0.95)] };
  }

  function buildFloors(sat, d, w, h, box) {
    var cx = Math.max(2, Math.round((box.e - box.w) / CELL_DEG));
    var cy = Math.max(2, Math.round((box.n - box.s) / CELL_DEG));
    var lo = new Float32Array(cx * cy), i, j, x, y, p, n, k, vals;
    var bw = w / cx, bh = h / cy, buf = new Float32Array(Math.ceil(bw + 1) * Math.ceil(bh + 1));

    for (y = 0; y < cy; y++) for (x = 0; x < cx; x++) {
      n = 0;
      for (j = Math.floor(y * bh); j < Math.min(h, (y + 1) * bh); j++)
        for (i = Math.floor(x * bw); i < Math.min(w, (x + 1) * bw); i++) {
          p = (j * w + i) * 4;
          if (d[p + 3] > 250) buf[n++] = grey(d, p);
        }
      if (n < 40) { lo[y * cx + x] = NaN; continue; }
      vals = Array.prototype.slice.call(buf.subarray(0, n)).sort(function (a, b) { return a - b; });
      lo[y * cx + x] = vals[Math.floor(n * PCT)];
    }

    /* Warmest cell within RAD_DEG. Wide on purpose: at one cell every neighbour
       of a cell inside a storm is also overcast, the floor lands in cloud, and
       the middle of the storm reads as clearer than its own edges. */
    var rad = Math.max(1, Math.round(RAD_DEG / CELL_DEG));
    var env = new Float32Array(cx * cy), m;
    for (y = 0; y < cy; y++) for (x = 0; x < cx; x++) {
      m = Infinity;
      for (j = Math.max(0, y - rad); j <= Math.min(cy - 1, y + rad); j++)
        for (i = Math.max(0, x - rad); i <= Math.min(cx - 1, x + rad); i++) {
          k = lo[j * cx + i];
          if (isFinite(k) && k < m) m = k;
        }
      env[y * cx + x] = m;
    }
    var fill = NaN;
    for (k = 0; k < env.length; k++) if (isFinite(env[k])) { fill = env[k]; break; }
    for (k = 0; k < env.length; k++) if (!isFinite(env[k])) env[k] = fill;

    /* Robust spread of above-ground brightness, sampled rather than fully sorted:
       a full sort per satellite per refresh is a freeze on a phone. */
    var sm = [], q = 0;
    for (j = 0; j < h; j += 3) for (i = 0; i < w; i += 3) {
      p = (j * w + i) * 4;
      if (d[p + 3] > 250) sm[q++] = grey(d, p) - sampleGrid({ g: env, cx: cx, cy: cy }, i / w, j / h);
    }
    var span = 70;
    if (q > 200) {
      sm.sort(function (a, b) { return a - b; });
      span = sm[Math.floor(q * 0.985)] - sm[Math.floor(q * 0.20)];
      span = Math.max(30, Math.min(140, span));
    }
    return { g: env, cx: cx, cy: cy, span: span, box: box, cloudLo: 60, cloudHi: 200 };
  }

  /* Bilinear read at fractional position, which is what turns coarse cells into
     a smooth field rather than visible blocks. */
  function sampleGrid(gr, u, v) {
    var fx = u * gr.cx - 0.5, fy = v * gr.cy - 0.5;
    var x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    var x1 = x0 + 1, y1 = y0 + 1;
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 > gr.cx - 1) x1 = gr.cx - 1;
    if (y1 > gr.cy - 1) y1 = gr.cy - 1;
    if (x0 > gr.cx - 1) x0 = gr.cx - 1;
    if (y0 > gr.cy - 1) y0 = gr.cy - 1;
    var a0 = gr.g[y0 * gr.cx + x0] * (1 - tx) + gr.g[y0 * gr.cx + x1] * tx;
    var a1 = gr.g[y1 * gr.cx + x0] * (1 - tx) + gr.g[y1 * gr.cx + x1] * tx;
    return a0 * (1 - ty) + a1 * ty;
  }

  /* Where in the stored world floor grid does this detail pixel fall. */
  function floorLookup(gr, lon, lat) {
    var u = (lon - gr.box.w) / (gr.box.e - gr.box.w);
    var v = (mercY(gr.box.n) - mercY(lat)) / (mercY(gr.box.n) - mercY(gr.box.s));
    return sampleGrid(gr, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
  }

  /* ---------------------------------------------------------------- drawing */

  /* Low-precision solar elevation — a few tenths of a degree, which is far more
     than a day/night test needs, and no dependency on the eclipse ephemeris.

     WHY THIS IS HERE. EUMETSAT's cloud mask uses visible channels by day and
     infrared alone by night. Over hot desert after sunset the surface cools fast
     and unevenly and the mask over-flags badly: measured over the Sahara
     interior on two consecutive days, 15-23% cloud through daylight rising to
     47-55% at 20Z. That is not weather. So the mask is taken at its word while
     the sun is up — including every eclipse, which is by definition daytime —
     and after dark it must be corroborated by an actual infrared signal. */
  function solarAlt(lon, lat, ms) {
    var d = ms / 86400000 + 2440587.5 - 2451545.0;
    var g = (357.529 + 0.98560028 * d) * Math.PI / 180;
    var q = (280.459 + 0.98564736 * d) * Math.PI / 180;
    var L = q + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
    var e = (23.439 - 0.00000036 * d) * Math.PI / 180;
    var dec = Math.asin(Math.sin(e) * Math.sin(L));
    var gmst = 18.697374558 + 24.06570982441908 * d;
    var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    var lst = ((gmst % 24) * 15 + lon) * Math.PI / 180;
    var ha = lst - ra;
    var la = lat * Math.PI / 180;
    return Math.asin(Math.sin(la) * Math.sin(dec) +
                     Math.cos(la) * Math.cos(dec) * Math.cos(ha)) * 180 / Math.PI;
  }

  function weightAt(sat, lon, lat) {
    var d = Math.abs(((lon - sat.lon + 540) % 360) - 180) * Math.PI / 180;
    var c = Math.cos(lat * Math.PI / 180) * Math.cos(d) - CUT;
    return c > 0 ? c * c * c : 0;
  }

  /* Which satellites can see any part of this box. At eclipse-track zoom that is
     usually one or two, so a redraw costs two or three requests, not seven. */
  function visible(box) {
    var out = [], i, s, best, lon, lat;
    for (i = 0; i < SATS.length; i++) {
      s = SATS[i]; best = 0;
      for (lon = box.w; lon <= box.e + 1e-9; lon += Math.max(1, (box.e - box.w) / 8))
        for (lat = box.s; lat <= box.n + 1e-9; lat += Math.max(1, (box.n - box.s) / 8))
          best = Math.max(best, weightAt(s, lon, lat));
      if (best > 0) out.push(s);
    }
    return out;
  }

  function buildPalette() {
    if (_lut) return true;
    /* NOW DOES NOT USE AVERAGE'S RAMP, and the reason is what the two colours
       MEAN. Average's blue-green-cream-orange-red encodes a PERCENTAGE, read off
       a legend: every hue is a number you look up. Now encodes one thing —
       there is cloud here, this thick — and running that through a five-hue
       ramp produced a map that read as a mishmash of unrelated colours with no
       legend to decode it.

       So: one hue, light to dark. Ordering is obvious without a legend, it
       cannot be confused with Average, and it stays out of the orange-red the
       eclipse track and the umbra are drawn in — cloud must never compete with
       the path for attention, and it must never be mistaken for it. */
    var STOPS = [[0.00, 214, 226, 236],
                 [0.35, 150, 174, 196],
                 [0.70,  86, 112, 141],
                 [1.00,  38,  52,  78]];
    var lut = new Uint8Array(256 * 3), v, q, i, k, n, t;
    for (v = 0; v < 256; v++) {
      q = v / 255;
      for (i = 1; i < STOPS.length && STOPS[i][0] < q; i++) {}
      k = STOPS[i - 1]; n = STOPS[Math.min(i, STOPS.length - 1)];
      t = (n[0] === k[0]) ? 0 : (q - k[0]) / (n[0] - k[0]);
      lut[v * 3]     = k[1] + (n[1] - k[1]) * t;
      lut[v * 3 + 1] = k[2] + (n[2] - k[2]) * t;
      lut[v * 3 + 2] = k[3] + (n[3] - k[3]) * t;
    }
    _lut = lut;
    return true;
  }

  var MIN_SHADE = 0.16;   /* mask-confirmed cloud is never fully invisible, but the
                             floor is low: an earlier 0.35 painted every flagged
                             pixel at the same shade and blanketed whole countries
                             in one flat colour regardless of signal */
  var NIGHT_ANOM = 12;    /* after dark the mask must be corroborated by this many
                             brightness counts above local ground; see solarAlt */   /* a masked-cloud pixel is never fainter than this: the
                             agency says there IS cloud there, and infrared
                             under-reads thin and low cloud, which is exactly the
                             cloud that ruins an eclipse */
  var SHADE_GAMMA = 0.55; /* WHY A CURVE AT ALL. Cloud-top brightness is normalised
                             against the WHOLE WORLD's cloud tops, so that the same
                             colour means the same thing over Spain as over the
                             ITCZ. The cost is that mid-latitude cloud sits near
                             the bottom of a distribution dominated by tropical
                             convection: measured over a real Spanish cloud deck,
                             the shading spanned 0.28 to 0.35 — visually flat. The
                             gamma spreads that to 0.28-0.54 while keeping the
                             ordering and the cross-region comparability.

                             SAY WHAT THIS IS. Infrared measures how COLD the top
                             is, not how much light gets through. Thin cirrus you
                             can see the sun through scores worse than a solid low
                             stratus deck that blocks it entirely. EUMETSAT
                             publishes no optical-thickness product — checked by
                             enumerating all 25 msg_fes layers — so this is the
                             best available and it is an indicator, not a
                             forecast. The EXTENT is exact; the shading is not. */

  function compose(box, w, h, sats, frames, out) {
    var acc = new Float32Array(w * h), wsum = new Float32Array(w * h);
    var mAcc = new Float32Array(w * h), mSum = new Float32Array(w * h);
    var si, sat, fr, d, mk, gr, i, j, q, p, f, wt, lat, lon, anom, sunUp, msum1 = false, sd;
    var yTop = mercY(box.n), yBot = mercY(box.s);

    /* PASS ONE — EXTENT, and only masked satellites get a vote.
       In the Atlantic, where a masked and an unmasked satellite see the same
       sky, the mask reported 44.2% cloud and GOES-East's infrared 8.7%. That is
       not a tuning error: over ocean, low marine stratocumulus is nearly as warm
       as the sea beneath it, so a single infrared window CANNOT see it, and
       refitting the floor against the mask moved the score by 0.001. Letting
       infrared vote alongside a mask therefore does not average two opinions, it
       dilutes a measurement with a blind spot — which is what punched holes
       through solid cloud masses and left the rest too pale to read. */
    for (si = 0; si < sats.length; si++) {
      sat = sats[si]; fr = frames[si];
      if (!fr || !fr.mask) continue;
      d = fr.ir; mk = fr.mask;
      for (j = 0; j < h; j++) {
        lat = invMercY(yTop - (j + 0.5) / h * (yTop - yBot));
        for (i = 0; i < w; i++) {
          q = j * w + i; p = q * 4;
          if (mk[p + 3] < 250) continue;
          lon = box.w + (i + 0.5) / w * (box.e - box.w);
          wt = weightAt(sat, lon, lat);
          if (wt <= 0) continue;
          mAcc[q] += wt * (isCloud(mk, p) ? 1 : 0); mSum[q] += wt; msum1 = true;
        }
      }
    }

    /* SOFTEN THE MASK BEFORE IT IS USED. It arrives coarser than the infrared
       and upsampled nearest-neighbour, so its yes/no boundary lands on visible
       tile edges — the blockiness that stops this looking like weather. A short
       box blur over the verdict turns those steps into a ramp, which is also
       honest: at the mask's own resolution the boundary genuinely is uncertain
       to about a pixel. */
    if (msum1) {
      var sm = new Float32Array(w * h), sw = new Float32Array(w * h), rr, cc, qq;
      for (j = 0; j < h; j++) for (i = 0; i < w; i++) {
        q = j * w + i;
        if (mSum[q] <= 0) continue;
        for (rr = Math.max(0, j - 1); rr <= Math.min(h - 1, j + 1); rr++)
          for (cc = Math.max(0, i - 1); cc <= Math.min(w - 1, i + 1); cc++) {
            qq = rr * w + cc;
            if (mSum[qq] > 0) { sm[q] += mAcc[qq] / mSum[qq]; sw[q] += 1; }
          }
      }
      for (q = 0; q < w * h; q++) if (sw[q] > 0) mAcc[q] = sm[q] / sw[q] * mSum[q];
    }

    /* The sun's altitude changes by less than a degree across a few dozen
       pixels, so it is sampled on a coarse grid instead of computed per pixel.
       Per-pixel it was millions of trigonometric calls per redraw — the reason a
       pan took so long to catch up. */
    var SG = 24, sgx = Math.ceil(w / SG) + 1, sgy = Math.ceil(h / SG) + 1;
    var sun = new Float32Array(sgx * sgy), gx, gy, tms = 0, cnt = 0;
    for (si = 0; si < frames.length; si++) if (frames[si]) { tms += frames[si].at; cnt++; }
    tms = cnt ? tms / cnt : Date.now();
    for (gy = 0; gy < sgy; gy++) {
      lat = invMercY(yTop - Math.min(1, (gy * SG) / h) * (yTop - yBot));
      for (gx = 0; gx < sgx; gx++) {
        lon = box.w + Math.min(1, (gx * SG) / w) * (box.e - box.w);
        sun[gy * sgx + gx] = solarAlt(lon, lat, tms);
      }
    }

    /* PASS TWO — shading, and extent where nothing has classified it. */
    for (si = 0; si < sats.length; si++) {
      sat = sats[si]; fr = frames[si];
      if (!fr) continue;
      d = fr.ir; mk = fr.mask; gr = _floors[sat.id];
      for (j = 0; j < h; j++) {
        lat = invMercY(yTop - (j + 0.5) / h * (yTop - yBot));
        for (i = 0; i < w; i++) {
          q = j * w + i; p = q * 4;
          if (d[p + 3] < 250) continue;
          lon = box.w + (i + 0.5) / w * (box.e - box.w);
          wt = weightAt(sat, lon, lat);
          if (wt <= 0) continue;
          sunUp = sun[((j / SG) | 0) * sgx + ((i / SG) | 0)] > 3;

          if (mSum[q] > 0) {
            /* A mask covers this pixel. Every satellite may still contribute
               SHADING — cloud-top brightness ranked against the world's cloud
               tops, so one colour means one thing everywhere — but the mask
               alone decides whether there is cloud to shade. */
            var gate = mAcc[q] / mSum[q];
            if (gate < 0.35) continue;
            sd = fr.shade || d;
            /* How far above local clear ground this pixel sits. That IS the
               shading — faint cloud has to look faint, or a mask flag with no
               signal behind it blankets a continent in one flat colour. */
            anom = gr ? grey(sd, p) - floorLookup(gr, lon, lat) : 0;
            if (anom < (sunUp ? 0 : NIGHT_ANOM)) continue;
            f = anom / 90;
            if (f < 0) f = 0; else if (f > 1) f = 1;
            f = MIN_SHADE + (1 - MIN_SHADE) * Math.pow(f, SHADE_GAMMA);
            if (gate < 1) f *= 0.35 + 0.65 * gate;   /* soft edge, not a tile edge */
          } else {
            /* No mask published here — the Americas and the Pacific — so
               infrared decides extent too, from its distance above the local
               clear-sky ground. It will UNDER-REPORT low cloud over ocean for
               the reason above; that is a real limitation of this half of the
               map, not a bug to tune away. */
            f = gr ? ((grey(d, p) - floorLookup(gr, lon, lat)) / gr.span - sat.floor) / (1 - sat.floor) : 0;
            if (f < 0) f = 0; else if (f > 1) f = 1;
          }
          acc[q] += wt * f; wsum[q] += wt;
        }
      }
    }

    var img = out.createImageData(w, h), o = img.data, k, litpx = 0, npx = 0;
    for (q = 0, p = 0; q < w * h; q++, p += 4) {
      if (wsum[q] <= 0) continue;
      f = acc[q] / wsum[q];
      if (f <= 0) continue;
      if (f > 1) f = 1;
      k = (f * 255) | 0;
      o[p] = _lut[k * 3]; o[p + 1] = _lut[k * 3 + 1]; o[p + 2] = _lut[k * 3 + 2];
      /* CLOUD THAT IS THERE MUST LOOK LIKE IT IS THERE. Alpha rising from zero
         with the shading made thin cloud a white ghost on a pale basemap —
         present in the data, invisible on screen, which is the same as absent
         and more dangerous because it looks considered. Anything drawn at all
         starts at 60% and climbs from there; the SHADING carries how thick, the
         opacity only carries that something is there. */
      o[p + 3] = 255 * (0.60 + 0.40 * f);
    }
    for (p = 3; p < o.length; p += 4 * 97) { npx++; if (o[p] > 0) litpx++; }
    _painted = npx ? litpx / npx : 0;
    out.putImageData(img, 0, 0);
  }

  /* Fetch one satellite's infrared and, where published, its cloud mask for the
     same instant. Sequential across satellites, because several full-size PNGs
     in flight at once is a lot of memory on a phone. */
  function gather(sats, box, w, h) {
    var out = [], i = 0;
    function next() {
      if (i >= sats.length) return out;
      var sat = sats[i++];
      return frameFor(sat, box, w, h).then(function (fr) {
        if (!fr) { out.push(null); return next(); }
        return maskFor(sat, fr.iso, box, w, h).then(function (mk) {
          fr.mask = mk; fr.sat = sat;
          return shadeFor(sat, box, w, h).then(function (sh) {
            fr.shade = sh; out.push(fr);
            return next();
          });
        });
      }, function () { out.push(null); return next(); });
    }
    return Promise.resolve().then(next);
  }

  /* ----------------------------------------------------------------- passes */

  /* World pass. Measures every satellite's clear-sky floor and spread — the part
     that CANNOT be done from a viewport — and draws the fallback layer shown
     while a gesture is in flight. */
  function basePass() {
    var box = { w: -180, e: 180, s: -75, n: 75 };
    var wh = safeSize(BASE_W, Math.round(BASE_W * mercY(75) / MAXY));
    var w = wh[0], h = wh[1];
    if (!_cvB) { _cvB = document.createElement('canvas'); _ctxB = _cvB.getContext('2d'); }
    _cvB.width = w; _cvB.height = h;

    return gather(SATS, box, w, h).then(function (frames) {
      var stamps = [], i;
      for (i = 0; i < SATS.length; i++) {
        if (!frames[i]) continue;
        _floors[SATS[i].id] = buildFloors(SATS[i], frames[i].ir, w, h, box);
        if (frames[i].mask) {
          var cr = cloudRange(frames[i].ir, frames[i].mask, w, h);
          if (cr && cr.hi - cr.lo > 20) {
            _floors[SATS[i].id].cloudLo = cr.lo;
            _floors[SATS[i].id].cloudHi = cr.hi;
          }
        }
        stamps.push({ id: SATS[i].id, name: SATS[i].name, iso: frames[i].iso, at: frames[i].at });
      }
      _missing = SATS.filter(function (s) {
        for (var k = 0; k < stamps.length; k++) if (stamps[k].id === s.id) return false;
        return true;
      }).map(function (s) { return s.name; });
      if (!stamps.length) return false;
      _stamps = stamps;
      compose(box, w, h, SATS, frames, _ctxB);
      placeBase(box);
      _drawnBase = true;
      _at = Date.now();
      return true;
    });
  }

  /* Detail pass. What is on screen, at the resolution it is on screen. */
  function detailPass() {
    var box = viewBox();
    var el = _map.getCanvas();
    var aspect = (mercY(box.n) - mercY(box.s)) /
                 (R * (box.e - box.w) * Math.PI / 180);
    var w = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(el.width)));
    var h = Math.max(MIN_PX, Math.min(MAX_PX, Math.round(w * aspect)));
    var wh = safeSize(w, h); w = wh[0]; h = wh[1];
    if (!_cv) { _cv = document.createElement('canvas'); _ctx = _cv.getContext('2d'); }
    if (_cv.width !== w) _cv.width = w;
    if (_cv.height !== h) _cv.height = h;

    var sats = visible(box);
    return gather(sats, box, w, h).then(function (frames) {
      var i, any = false;
      for (i = 0; i < frames.length; i++) if (frames[i]) any = true;
      if (!any) return false;
      compose(box, w, h, sats, frames, _ctx);
      placeDetail(box);
      _drawn = box; _drawnZoom = _map.getZoom();
      return true;
    });
  }

  /* ------------------------------------------------------------------ layer */

  function coords(box) {
    return [[box.w, box.n], [box.e, box.n], [box.e, box.s], [box.w, box.s]];
  }

  /* CANVAS SOURCES, not image sources. An image source has to re-fetch and
     re-decode a data URL before anything appears, and was measured here
     producing a correct canvas and a blank map. cloud.js puts a whole-world
     raster on this same map through a canvas source against this same MapLibre.
     animate:false means prepare() only re-uploads on resize or while playing, so
     every later repaint would update pixels nobody re-reads — play() then
     pause() forces exactly one upload. Do not simplify that pair away. */
  function placeBase(box) {
    if (_map.getSource(SRC_B)) { _srcB.setCoordinates(coords(box)); _srcB.play(); _srcB.pause(); return; }
    _map.addSource(SRC_B, { type: 'canvas', canvas: _cvB, coordinates: coords(box),
                            animate: false, attribution: CREDIT });
    _map.addLayer({ id: LAYER_B, type: 'raster', source: SRC_B,
                    paint: { 'raster-opacity': OPACITY, 'raster-fade-duration': 0 } });
    _srcB = _map.getSource(SRC_B);
  }

  function placeDetail(box) {
    if (_map.getSource(SRC)) { _src.setCoordinates(coords(box)); _src.play(); _src.pause(); }
    else {
      _map.addSource(SRC, { type: 'canvas', canvas: _cv, coordinates: coords(box), animate: false });
      _map.addLayer({ id: LAYER, type: 'raster', source: SRC,
                      paint: { 'raster-opacity': OPACITY, 'raster-fade-duration': 0 } });
      _src = _map.getSource(SRC);
    }
    try { _map.setLayoutProperty(LAYER, 'visibility', 'visible'); } catch (e) {}
    /* AND HIDE THE WORLD PASS. It is a 1536-pixel fallback for gestures, not a
       second opinion. Left visible it shows through everywhere the sharp layer
       is transparent — which is everywhere the sky is clear — so a blurry low
       resolution composite reappeared underneath as a grey wash, and its coarse
       cloud edges read as extra cloud that the detail pass had correctly
       decided was not there. Two layers of the same field is never right. */
    try { if (_map.getLayer(LAYER_B)) _map.setLayoutProperty(LAYER_B, 'visibility', 'none'); } catch (e) {}
  }

  function removeLayer() {
    if (!_map) return;
    var ids = [[LAYER, SRC], [LAYER_B, SRC_B]];
    for (var i = 0; i < ids.length; i++) {
      try { if (_map.getLayer(ids[i][0])) _map.removeLayer(ids[i][0]); } catch (e) {}
      try { if (_map.getSource(ids[i][1])) _map.removeSource(ids[i][1]); } catch (e) {}
    }
    _src = null; _srcB = null; _drawn = null; _drawnBase = false;
  }

  /* ----------------------------------------------------------------- public */

  function announce() {
    for (var i = 0; i < _listeners.length; i++) { try { _listeners[i](); } catch (e) {} }
  }

  function refresh(force) {
    if (!_on || !_map) return Promise.resolve(false);
    if (_busy) { _again = true; return Promise.resolve(true); }
    if (!force && _drawnBase && covered() && (Date.now() - _at) < TTL) return Promise.resolve(true);
    if (!buildPalette()) return Promise.resolve(false);
    _busy = true; _err = null;

    var stale = !_drawnBase || (Date.now() - _at) >= TTL || force;
    return Promise.resolve()
      .then(function () { return stale ? basePass() : true; })
      .then(function () { return detailPass(); })
      .then(function (ok) {
        _busy = false; announce();
        if (_again) { _again = false; return refresh(false); }
        return ok;
      }, function (e) {
        _busy = false; _err = String(e); announce();
        if (_again) { _again = false; return refresh(false); }
        return false;
      });
  }

  function onMoveStart() {
    /* Show the world pass while a gesture runs and do no work at all; the detail
       canvas comes back at moveend. Chasing redraw speed during a drag is how
       the previous attempts ended up racing themselves. */
    try {
      if (!_on) return;
      if (_map.getLayer(LAYER_B)) _map.setLayoutProperty(LAYER_B, 'visibility', 'visible');
      if (_map.getLayer(LAYER)) _map.setLayoutProperty(LAYER, 'visibility', 'none');
    } catch (e) {}
  }
  /* Debounced. A pinch-zoom fires moveend repeatedly, and each one previously
     started a fresh round of requests that the next immediately superseded —
     which is most of why catching up took so long. One redraw, after the hand
     has left the screen. */
  var _pending = null;
  function onMoveEnd() {
    if (!_on) return;
    if (_pending) clearTimeout(_pending);
    _pending = setTimeout(function () { _pending = null; refresh(false); }, 220);
  }

  function on(map) {
    _map = map; _on = true;
    _map.on('movestart', onMoveStart);
    _map.on('moveend', onMoveEnd);
    return refresh(true);
  }

  function off() {
    _on = false; _stamps = []; _at = 0;
    if (_pending) { clearTimeout(_pending); _pending = null; }
    if (_map) { _map.off('movestart', onMoveStart); _map.off('moveend', onMoveEnd); }
    removeLayer();
  }

  function isOn() { return _on; }
  function onFrame(fn) { if (typeof fn === 'function') _listeners.push(fn); }
  function missing() { return _missing.slice(); }

  function invalidate() {
    if (_busy) return Promise.resolve(false);
    _at = 0; _drawn = null; _drawnBase = false;
    return refresh(true).then(function (v) { return v; }, function () { return false; });
  }

  /* Answered from the geometry, and it needs the LATITUDE as well as the
     longitude — the ring covers every longitude but runs out of sky toward the
     poles, so there is no longitude-only answer. */
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
     band: the drive is often decided at 3 a.m. The MASK works after dark too —
     EUMETSAT's cloud mask is not a daylight product. */
  function hasNight() { return true; }

  window.Satellite = {
    version: '2026-08-17a',
    CREDIT: CREDIT,
    on: on, off: off, isOn: isOn, refresh: refresh,
    onFrame: onFrame, missing: missing, invalidate: invalidate,
    coverage: coverage, shownTime: shownTime, hasNight: hasNight,
    frames: function () { return _stamps.slice(); },
    error: function () { return _err; },
    diagnose: function () {
      return { painted: _painted, frames: _stamps.length, missing: _missing.slice(),
               drawn: _drawn, base: _drawnBase, busy: _busy,
               layer: !!(_map && _map.getLayer(LAYER)),
               source: !!(_map && _map.getSource(SRC)), error: _err };
    },
    /* For tests and console work. */
    _sats: function () { return SATS.slice(); },
    _floors: function () {
      var o = {}, i;
      for (i = 0; i < SATS.length; i++) o[SATS[i].id] = SATS[i].floor;
      return o;
    },
    _url: url,
    _viewBox: function () { return viewBox(); }
  };
})();
