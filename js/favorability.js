/* js/favorability.js — the favorability overlay (#F6). Build step 1.
 *
 * WHAT IT SHOWS
 *   ONE composite score, green -> red, for "how good is this spot for watching
 *   THIS eclipse". Cloud and terrain already have their own overlays; this is
 *   the single number that blends them. Drawn ONLY inside the central path
 *   (total and annular), so everything outside the corridor is transparent and
 *   the basemap reads through.
 *
 *     S = C^0.60 * D^0.40 * A^0.15
 *
 *   C  clear-sky, 1 - cloud fraction, from the existing ERA5 climatology.
 *   D  totality duration / this eclipse's longest, 0..1.
 *   A  sun altitude, clamp((alt - 2) / (15 - 2), 0, 1): flat above ~15 deg,
 *      falling below ~10, zero on the horizon.
 *
 *   MULTIPLICATIVE, not a weighted sum: a sum lets a cloud-locked 4-minute
 *   valley outrank a clear 2-minute ridge. The concave exponents give the
 *   diminishing returns that plain expected-seconds (C*D) gets wrong — the
 *   first second of totality is worth far more than the 240th.
 *
 *   0.60/0.40 are CALIBRATED, fitted to the user's own answers on eight
 *   forced-choice pairs. 0.15 on A is a starting point and was never fitted;
 *   the pairs held sun height equal deliberately. See TODO #F6.
 *
 * HOW A CELL IS SCORED — READ THIS BEFORE CHANGING THE INNER LOOP
 *   NOT with computeEclipse(). That was the original plan and it is 26.5 us per
 *   call, which measured 1,043 ms for one Iberia-sized viewport and 11.4 s for
 *   the world canvas — four and forty-five seconds respectively on a phone.
 *
 *   The cost is entirely in machinery this layer throws away: C1/C4 contacts,
 *   the visible-window clip, five getSun calls and four limb angles. Everything
 *   the score needs falls out of findMaximum() + fundamentalArgs(), which is
 *   1.10 us — the SAME two functions computeEclipse itself starts with:
 *
 *     membership  m < |L2'|          the identical comparison computeEclipse makes
 *     duration    2*sqrt(L2'^2 - m^2) / n     Besselian semi-duration
 *     altitude    sunAltAz(o, lat)   from the args object we already hold
 *
 *   MEASURED against the engine, four eclipses (2024, 2026, 2027 annular, 2028):
 *   duration median error 0.00-0.18 s, p95 <= 0.43 s. Of 442 corridor cells on
 *   2028 only 4 differ by over a second, and every one has sun altitude <= 0.1
 *   deg, where A is exactly zero and the score is zero anyway. The disagreement
 *   is computeEclipse CLIPPING duration at sunset, which is deliberate there and
 *   irrelevant here. Same for altitude: 23 of 806 cells differ, highest altitude
 *   involved 0.0 deg.
 *
 *   This is NOT the chord approximation the scoping note rejected. That one
 *   assumed a shape (dur_centre * sqrt(1-(d/w)^2)). This is the same physics
 *   from the same fundamental arguments, and it keeps the hard zero at the path
 *   limits — sqrt(L2'^2 - m^2) goes to zero exactly where the umbra edge is.
 *   Result: 103 ms for the Iberia viewport instead of 1,043.
 *
 * THERE IS NO CORRIDOR POLYGON, AND THERE MUST NOT BE ONE
 *   The only question this layer asks is "is THIS cell central?", and the two
 *   primitives above answer it per cell. Four previous attempts to build a
 *   corridor RING all failed on polar paths, because when a corridor crosses a
 *   pole the north and south limits swap sides and the ring wraps instead of
 *   closing. map.js has corridor fill deliberately disabled for the same reason.
 *   Per-cell membership never builds a ring, so none of that can happen. See
 *   TODO #F6 for the full ledger before you are tempted.
 *
 *   NB the membership test here is on the GEOMETRY (sign of L2'), not on
 *   computeEclipse's `type` string. That string promotes total/annular to
 *   'hybrid' for hybrid eclipses, so testing it would silently drop all 569
 *   hybrids in the catalogue.
 *
 * NORMALISATION — PER ECLIPSE, ALWAYS, AND ON THE COMPOSITE
 *   The colour means "best spot for THIS eclipse", never "this eclipse beats
 *   that one". Green on the 2028 map and green on the 1997 map therefore do not
 *   mean the same thing, and the legend has to say so.
 *
 *   TWO stretches, and missing the second one is what made the first version
 *   render a uniformly orange ribbon with no green anywhere. D is divided by the
 *   longest totality on this path — and then the COMPOSITE is stretched across
 *   the path's own 2nd-98th percentile. Without that second step the score keeps
 *   whatever absolute value the cloud allows, and on 2026-08-12 the whole track
 *   is cloudy (93% Arctic, 82% Iceland, 36% in Spain at its best), so the raw
 *   composite topped out at 0.70 and the good end of the ramp was unreachable.
 *   Stretch the composite ONCE, at the end — never C and D separately, which
 *   would amplify whichever term is flat into false contrast.
 *
 * STRUCTURE
 *   Cloned structurally from cloud-average.js, whose every trap was paid for
 *   once already: two canvases with exactly one visible, _safeSize()'s
 *   power-of-two guard, canvas sized to the data, _drawnKey so a canvas drawn
 *   for another eclipse is never reused, and _againForce so a deferred forced
 *   render stays forced. Do not "simplify" any of those away.
 */
(function () {
  'use strict';

  var SRC = 'favor', LAYER = 'favor';
  var SRC_B = 'favor-base', LAYER_B = 'favor-base';

  /* Exponents. 0.60/0.40 calibrated; 0.15 a starting point (TODO #F6). */
  var P_C = 0.60, P_D = 0.40, P_A = 0.35;

  /* Sun-altitude term: zero at ALT_LO, flat from ALT_HI up.

     THE SHAPE MATTERS MORE THAN THE WEIGHT, and the first cut got it backwards.
     With ALT_LO 2, ALT_HI 15 and P_A 0.15 the term ran 0.89 at 7.8 deg, 0.76 at
     4, 0.59 at 2.4 — then 0.00 at 0.8. Flat, flat, flat, cliff: the exponent
     flattened everything above the floor and the floor did all the work, so each
     end of the path finished in a blunt dark-red stub, "like a cigarette
     filter". Zero at the TRUE horizon with a longer ramp and a steeper exponent
     glides instead: 0.75 / 0.59 / 0.49 / 0.34 over the same stretch, reaching
     zero only where the sun does.

     ALT_HI is 7.5, on the user's judgement (2026-09-08f/g). **A low sun is not a
     bad eclipse.** Early-morning and late-afternoon eclipses are perfectly good,
     and the original 18-degree ramp was quietly taxing every one of them: it
     dropped Burgos on 2026-08-12, at a sun of 8.2 deg, to 0.76 on this term.
     Altitude should bite only where extinction and horizon murk genuinely do,
     which is the last few degrees. Resulting shape: flat to 7.5, 0.93 at 6,
     0.80 at 4, 0.68 at 2.5, 0.49 at 1, and 0 only at the true horizon.

     P_A is NOT calibrated. The eight forced-choice pairs held sun height equal
     on purpose, so nothing in the fit constrains it; it is the first knob to
     reach for if altitude ever feels over- or under-weighted. */
  var ALT_LO = 0, ALT_HI = 7.5;

  var LAT_MAX = 85.0511287798066;        /* Mercator limit                     */
  /* Detail canvas size. A FIXED cap is the wrong instrument and was the cause of
     the jagged low-zoom edge: the cost here is not the number of pixels, it is
     the number of pixels NEAR THE CORRIDOR, and that varies enormously with
     zoom. Measured on the same view at 1024 / 2048 / 3072 px: zoomed OUT, where
     the ribbon is a thread in a wide frame, 84 / 97 / 177 ms — doubling is
     nearly free. Zoomed IN, where the corridor fills the screen, the same
     doubling costs about four times as much.
     So the cap is set per render from a BUDGET, using the mask to estimate how
     much of this particular box is corridor. Zoomed out that spends the budget
     on resolution; zoomed in it spends it on area, which is the right trade both
     ways round. */
  var MAX_PX  = 2048;                    /* hard ceiling, memory not time      */
  var MIN_PX  = 96;
  var PX_DIV  = 1;                       /* screen px per canvas px            */
  var BUDGET  = 260000;                  /* target engine calls per render     */
  /* Mid-gesture budget. While zooming there is only ever ONE canvas, drawn for
     wherever the map last stopped, so a zoom-in stretches it and it goes to soft
     blobs — the upscaling signature, not coarse pixels. Real map tiles avoid
     this by having a set per zoom level; the cheap equivalent is to redraw
     during the gesture at a fraction of the cost, so the picture stays roughly
     matched to the zoom and the final render at moveend sharpens it. */
  var BUDGET_MOVE = 130000;
  /* How far the view must drift from what is drawn before a mid-gesture redraw,
     in zoom levels. This and BUDGET_MOVE are the two ends of one trade, and both
     ends are visible to the user: redraw OFTEN and CHEAP and the ribbon goes
     coarse and chunky while dragging; redraw RARELY and WELL and the old canvas
     is stretched a bit further before it is replaced. 130k/0.9 is the second,
     after 55k/0.6 was reported as "noticeably more rough and jagged while
     dragging". Neither is a correctness question — turn these two numbers if the
     balance ever feels wrong. */
  var MOVE_ZOOM_DRIFT = 0.9;
  var MARGIN  = 0.35;
  var OPACITY = 0.75;

  /* EDGE FADE. The outermost pixels of the ribbon are the path LIMIT, where
     totality length goes to zero. Those score below the 2nd percentile, clamp to
     exactly 0, and 0 is the darkest colour on the ramp — so a thin line of the
     darkest brown-red ran along both limbs. At low zoom that fringe is a whole
     fat pixel wide, which is both the "jagged" edge and the "burnt" look.
     It is also wrong on its own terms: a spot with two seconds of totality is
     not the worst place on the path, it is barely on it. So the last stretch of
     duration fades out in ALPHA instead of darkening — which gives a soft edge
     at any zoom without supersampling, and stops the limb reading as a drawn
     border. Expressed as a fraction of this path's longest totality. */
  var EDGE_FADE = 0.06;

  /* World canvas. It was 512 when every cell cost an engine call — the corridor
     mask has since taken the world pass from 413 ms to about 21, so this can be
     four times sharper for a fraction of the original price. It is the fallback
     shown when a gesture leaves the drawn box, so it wants to be as good as it
     can cheaply be. MEASURED: 512 -> 64 ms, 1024 -> 73 ms, 2048 -> 284 ms. 1024
     is nearly free; 2048 quadruples the cost for one more doubling and would be
     over a second on a phone, and it is a low-zoom fallback, not the main view. */
  var BASE_PX = 1024;

  /* Same power-of-two trap as the cloud layer: MapLibre binds CanvasSource
     textures with LINEAR_MIPMAP_NEAREST and only falls back to LINEAR when the
     texture is NOT square-and-power-of-two, and CanvasSource builds no mipmaps.
     A square power-of-two canvas samples as BLACK — a grey veil over the map.
     Dropping one pixel is invisible and sidesteps it. Verified in maplibre-gl
     5.5.0. This looks exactly like tidy-up bait. It is not. */
  function _safeSize(w, h) {
    var pot = function (v) { return (Math.log(v) / Math.LN2) % 1 === 0; };
    if (w === h && pot(w)) h -= 1;
    return [w, h];
  }

  var _on = false;
  var _canvas = null, _src = null, _canvasB = null, _srcB = null;
  var _lut = null, _img = null;
  var _busy = false, _again = false, _againForce = false;
  var _drawn = null, _drawnZoom = -1, _drawnKey = '', _baseKey = '';
  var _moving = false;
  var _rec = null;                       /* Besselian record, current eclipse  */
  var _recKey = '';
  var _pathMax = 0;                      /* longest totality on this path, s   */
  var _pathLo = 0, _pathHi = 1;          /* composite 2nd/98th pct on this path */
  var _mode = 'path';                    /* 'path' | 'view' (step 2 drives it) */
  var _viewLo = 0, _viewHi = 1;          /* stretch for 'view' mode            */

  /* ---------------------------------------------------------------- palette */

  /* Red (worst) -> orange -> yellow -> green -> blue (best): Anderson's spectral
     scale reversed, chosen 2026-09-10 so this layer matches the convention
     eclipse chasers already read on cloud maps.

     Known trade, taken deliberately. A spectral ramp is a RAINBOW, and rainbows
     order badly: the eye does not rank hues, so apparent boundaries appear where
     the HUE turns rather than where the data changes, and luminance is not
     monotonic so it collapses in greyscale. Red-green is also the common
     colour-blind pair. A two-hue red->blue ramp (see 2026-09-10e) avoids all
     three and was built and rendered first. Familiarity won, on the argument
     that the audience already reads this scale on Anderson's own maps.

     It DOES sit close to the cloud layer's blue->red. That was the reason the
     first version was green: to be unmistakably a different quantity. The
     directions agree though — blue is the good end on both — so the risk is the
     two being confused for each other rather than being read backwards. If that
     ever bites, change this, not the cloud layer, which uses Anderson's scale
     and MEANS cloud.
     Banded in 5% classes for the same reason the cloud palette is: a value can
     be read off the map, and it tells the truth about what the inputs can
     actually resolve instead of implying detail we lack. */
  var STOPS = [
    [0.00, 140,  26,  36], [0.12, 190,  50,  42], [0.25, 226, 104,  52],
    [0.38, 244, 166,  68], [0.50, 250, 214, 106], [0.61, 214, 220, 112],
    [0.72, 130, 190,  92], [0.83,  62, 160, 128], [0.92,  44, 128, 176],
    [1.00,  22,  70, 144]
  ];

  function _buildLut() {
    var lut = new Uint8Array(256 * 3), v, f, q, i, k, n, t;
    for (v = 0; v < 256; v++) {
      f = v / 255;
      /* SMOOTH, not banded. The cloud layer bands into 5% classes so a value can
         be read off the map, and that is right for a physical quantity. This is
         a RANK along one path, not a number anyone reads, and banding it made
         the ribbon break into soft lens-shaped blobs once MapLibre upscaled the
         canvas — which read as blur rather than as classes. */
      q = f;
      for (i = 1; i < STOPS.length && STOPS[i][0] < q; i++) {}
      k = STOPS[i - 1];
      n = STOPS[Math.min(i, STOPS.length - 1)];
      t = (n[0] === k[0]) ? 0 : (q - k[0]) / (n[0] - k[0]);
      lut[v * 3]     = k[1] + (n[1] - k[1]) * t;
      lut[v * 3 + 1] = k[2] + (n[2] - k[2]) * t;
      lut[v * 3 + 2] = k[3] + (n[3] - k[3]) * t;
    }
    return lut;
  }

  /* ------------------------------------------------------------- the score */

  /* Central-eclipse circumstances at one point, or null outside the corridor.
     lon is EAST-POSITIVE (as the app uses everywhere); the primitives take
     west-positive, hence the negation — eclipse.js:370 does the same internally.
     Returns duration in seconds and sun altitude in degrees.

     alt (the observer's ELEVATION, 4th arg) is passed explicitly as 0. It is not
     optional: omit it and the arithmetic goes NaN and the point silently reads
     as "not visible", so the whole corridor would quietly vanish. */
  function _cell(lat, lon) {
    var lw = -lon;
    var t = findMaximum(_rec, lat, lw, 0, _rec.dt);
    if (!isFinite(t)) return null;
    var o = fundamentalArgs(_rec, t, lat, lw, 0, _rec.dt);
    var m = Math.sqrt(o.u * o.u + o.v * o.v);
    var absL2 = Math.abs(o.L2p);
    if (!(m < absL2)) return null;          /* outside the umbra/antumbra */

    /* THE SUN MUST BE UP. This is not a nicety — without it the layer draws a
       band right round the planet.

       (u,v) is the observer's offset from the shadow AXIS projected onto the
       fundamental plane, and that projection cannot tell which SIDE of the Earth
       the observer is on. The axis extended through the globe emerges on the far
       side, so the antipodal region reads as "on the axis" and passes m < |L2'|
       while sitting in the middle of the night. Measured on 2026-08-12: 38N 40E
       (Armenia) passes the geometry with the sun at MINUS 20.5 degrees, and
       computeEclipse — which does its own horizon work through visibleWindow() —
       correctly calls it not visible.

       It was invisible in testing because such a cell scores exactly 0 (A is 0
       below the horizon) and 0 is a legitimate colour: the ramp's worst, dark
       red. So the bug painted a confident dark-red ring through Turkey and Iran
       rather than showing as an obvious glitch. A score of zero and no eclipse
       at all are different answers and must look different. */
    var sun = sunAltAz(o, lat);
    if (!(sun.alt > 0)) return null;

    /* Besselian semi-duration. Goes to zero exactly at the path limit, which is
       the hard edge any interpolated grid would have smeared. */
    var dur = 2 * Math.sqrt(absL2 * absL2 - m * m) / o.n * 3600;
    return { dur: dur, alt: sun.alt };
  }

  /* The composite, 0..1, or -1 outside the corridor. Cloud is sampled through
     Cloud.sampleAt so the number can never disagree with the cloud overlay's own
     colour; if the climatology is unavailable the cloud term drops out rather
     than the score reading falsely good. */
  var _lastD = 0;          /* D of the cell _raw() last looked at — see _draw */
  var _samples = new Float32Array(200000), _nsamp = 0, _ns = 0;

  function _raw(lat, lon, maxDur) {
    var c = _cell(lat, lon);
    if (!c) { _lastD = 0; return -1; }
    var D = maxDur > 0 ? Math.min(1, c.dur / maxDur) : 0;
    _lastD = D;
    var A = (c.alt - ALT_LO) / (ALT_HI - ALT_LO);
    A = A < 0 ? 0 : A > 1 ? 1 : A;
    var cloud = (typeof Cloud !== 'undefined' && Cloud.sampleAt)
              ? Cloud.sampleAt(lon, lat) : null;
    var C = (cloud === null || cloud === undefined) ? null : 1 - cloud;
    var s = Math.pow(D, P_D) * Math.pow(A, P_A);
    if (C !== null) s *= Math.pow(Math.max(0, C), P_C);
    return s > 1 ? 1 : s;
  }

  /* The value that is COLOURED: the raw composite stretched across this path's
     own 2nd-98th percentile, so green always means "the best this eclipse
     offers" and red "the worst". -1 stays -1 (outside the corridor). */
  function _score(lat, lon) {
    var s = _raw(lat, lon, _pathMax);
    if (s < 0) return -1;
    var lo = _pathLo, hi = _pathHi;
    if (!(hi > lo)) return s;
    s = (s - lo) / (hi - lo);
    return s < 0 ? 0 : s > 1 ? 1 : s;
  }

  /* Whole-path normalisation. Sweeps the globe coarsely ONCE per eclipse and
     records the longest totality and the 2nd/98th percentile of the COMPOSITE
     score along the path.

     Both halves matter, and the second one is the reason the first version of
     this layer rendered a uniformly orange ribbon with no green anywhere.
     Normalising only D leaves the composite at whatever absolute value the cloud
     happens to allow — and on 2026-08-12 the whole track is cloudy: 93% in the
     Arctic, 82% over Iceland, 36% in northern Spain at best. So C never
     approached 1, the composite topped out near 0.7, and the good end of the
     ramp was unreachable. The colour is supposed to mean "best spot FOR THIS
     ECLIPSE", which is a statement about the rest of the path, not an absolute.

     Percentiles, not min/max: one anomalous cell would otherwise own the ramp.
     The composite is stretched ONCE, at the end — never C and D separately,
     which would amplify whichever term happens to be flat into false contrast. */
  function _measurePath() {
    var durMax = 0, vals = [], lat, lon, c;
    for (lat = -88; lat <= 88; lat += 0.5) {
      for (lon = -180; lon < 180; lon += 0.5) {
        if (!_near(lat, lon)) continue;
        c = _cell(lat, lon);
        if (c && c.dur > durMax) durMax = c.dur;
      }
    }
    if (!(durMax > 0)) return { durMax: 0, lo: 0, hi: 1 };
    for (lat = -88; lat <= 88; lat += 0.5) {
      for (lon = -180; lon < 180; lon += 0.5) {
        if (!_near(lat, lon)) continue;
        var s = _raw(lat, lon, durMax);
        if (s >= 0) vals.push(s);
      }
    }
    if (vals.length < 8) return { durMax: durMax, lo: 0, hi: 1 };
    vals.sort(function (a, b) { return a - b; });
    var lo = vals[Math.floor(vals.length * 0.02)];
    var hi = vals[Math.floor(vals.length * 0.98)];
    if (!(hi > lo)) { lo = vals[0]; hi = vals[vals.length - 1]; }
    if (!(hi > lo)) { lo = 0; hi = 1; }
    return { durMax: durMax, lo: lo, hi: hi };
  }

  /* ------------------------------------------------------------- geometry */

  function _mercY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
  function _invMercY(y) { return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; }

  function _eclipseKey(e) { return e ? e.year + '_' + e.month + '_' + e.day : ''; }

  /* Visible box, clamped. On the globe at low zoom getBounds() can wrap or
     exceed the world, and then the whole world is both the honest answer and the
     cheap one — the same fallback cloud-average.js uses, which is why this layer
     inherits globe support for free. */
  function _bbox() {
    var b = map.getBounds();
    var w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
    if (!(e > w) || (e - w) > 355) { w = -180; e = 180; }

    /* NOW SHRINK TO WHERE THERE IS ACTUALLY SOMETHING TO DRAW.

       getBounds() is NOT wrong, and an earlier fix here that treated it as wrong
       was a patch. On the globe you are looking at a spherical CAP, and the
       lat/lon rectangle enclosing a cap is legitimately vast — near the limb you
       really can see 111 degrees of longitude. Clamping it to a zoom-derived
       span would have left the edges of the globe with no overlay at all.

       The real mistake was the question. This layer does not need a box covering
       what the user can SEE; it needs one covering where there is CORRIDOR, and
       everything else is transparent whatever we do. The mask already knows
       exactly where that is, so intersect with it. Nothing is hidden, because
       nothing outside the corridor was ever drawn.

       What this fixes, all downstream of the same box: the canvas covered a
       continent to draw a ribbon; the resolution budget divided itself across
       that whole area; and "This view" restretched to nearly the entire path and
       so appeared to do nothing. Measured on the sea between Iceland and the UK:
       box 111 degrees wide, corridor within it about 20. */
    var cb = _corridorBox(w, e, s, n);
    if (cb) { w = cb.w; e = cb.e; s = cb.s; n = cb.n; }

    var mx = (e - w) * MARGIN, my = (n - s) * MARGIN;
    w -= mx; e += mx; s -= my; n += my;
    if (e - w >= 360) { w = -180; e = 180; }
    return { w: w, e: e,
             s: Math.max(-LAT_MAX, Math.min(LAT_MAX, s)),
             n: Math.max(-LAT_MAX, Math.min(LAT_MAX, n)) };
  }

  /* Is the drawn canvas still COVERING the view — ignoring zoom?

     Different question from _covered(). That one asks "is this still good enough
     to keep, or must I redraw", and a zoom change means the pixels are too
     coarse. This asks only "does it still cover the screen", which is what
     decides whether the detail canvas can stay VISIBLE during a gesture.

     The canvas is georeferenced, so MapLibre stretches it correctly at any zoom.
     Swapping to the coarse world canvas the moment a gesture starts — which is
     what this layer did at first, cloned from the cloud layer — throws away a
     perfectly good image and shows a 512px world canvas blown up instead. That
     is the blockiness during zoom and pan: not the render, the fallback. */
  function _stillCovers() {
    if (!_drawn || _drawnKey !== _eclipseKey(selectedEntry)) return false;
    var b = map.getBounds();
    var w = b.getWest(), e = b.getEast();
    if (!(e > w) || (e - w) > 355) return _drawn.e - _drawn.w >= 359.9;
    return w >= _drawn.w && e <= _drawn.e &&
           b.getSouth() >= _drawn.s && b.getNorth() <= _drawn.n;
  }

  /* Geometry alone cannot answer "is this still valid" — it says nothing about
     WHICH eclipse the pixels are for. The cloud layer shipped the wrong month's
     overlay twice for exactly this reason (HANDOFF 10.5). */
  function _covered() {
    if (!_drawn) return false;
    if (_drawnKey !== _eclipseKey(selectedEntry)) return false;
    if (Math.abs(map.getZoom() - _drawnZoom) > 0.25) return false;
    var b = map.getBounds();
    var w = b.getWest(), e = b.getEast();
    if (!(e > w) || (e - w) > 355) return _drawn.e - _drawn.w >= 359.9;
    return w >= _drawn.w && e <= _drawn.e &&
           b.getSouth() >= _drawn.s && b.getNorth() <= _drawn.n;
  }

  /* ---------------------------------------------------------------- render */

  /* Score every pixel of one canvas. Rows are Mercator, so the latitude comes
     back through the inverse projection exactly as the cloud layer does.
     Outside the corridor alpha stays 0 and the basemap shows through. */
  /* ---------------------------------------------------------- corridor mask */

  /* WHERE THE CORRIDOR IS, cheaply, so the engine is only ever asked about cells
     that could plausibly be in it.

     The engine answers "is this cell central?" in ~1.1 us, which is fine for a
     ribbon and ruinous for the empty 90% of a frame around it. But the corridor
     geometry is already in the path record the map draws — `ep.centreline` — so
     we do not have to discover it by brute force.

     This stamps a disc along the centreline into a coarse lat/lon bitmap. It is
     deliberately a SUPERSET: the engine still decides membership, so the mask
     only has to avoid excluding anything real. Getting it slightly too big costs
     a few wasted calls; getting it too small drops path silently, so every
     rounding here goes outward.

     NOT A POLYGON. No ring, no winding, no antimeridian join, none of the things
     that defeated four previous corridor attempts — just proximity to a
     polyline, which has no topology to get wrong at a pole. */
  var MASK_DEG = 0.25;                    /* mask cell size                     */
  var MASK_NLAT = Math.round(180 / MASK_DEG), MASK_NLON = Math.round(360 / MASK_DEG);
  var _mask = null, _maskKey = '';

  function _segPoints(curve) {
    /* Curves are arrays of segments; green_curve is the odd one out but we do
       not use it. Tolerate either shape rather than assume. */
    var out = [];
    if (!curve) return out;
    if (typeof curve[0] === 'number') return out;
    curve.forEach(function (seg) {
      if (!seg) return;
      if (typeof seg[0] === 'number') { out.push(seg); return; }
      seg.forEach(function (p) { if (p && p.length >= 2) out.push(p); });
    });
    return out;
  }

  function _buildMask(ep) {
    var mid = _segPoints(ep && ep.centreline);
    if (!mid.length) return null;              /* no centreline -> no mask */

    /* Corridor half-width, measured from the record rather than assumed: the
       widest gap between the centreline and a limb. Annular paths run far wider
       than total ones, so a constant would be wrong for one or the other. */
    var lim = _segPoints(ep && ep.umbra_n).concat(_segPoints(ep && ep.umbra_s));
    var halfDeg = 0;
    for (var i = 0; i < mid.length; i += Math.max(1, Math.floor(mid.length / 60))) {
      var best = Infinity;
      for (var j = 0; j < lim.length; j += Math.max(1, Math.floor(lim.length / 200))) {
        var dla = lim[j][1] - mid[i][1];
        var dlo = (lim[j][0] - mid[i][0]) * Math.cos(mid[i][1] * Math.PI / 180);
        var d = dla * dla + dlo * dlo;
        if (d < best) best = d;
      }
      if (best < Infinity) { best = Math.sqrt(best); if (best > halfDeg) halfDeg = best; }
    }
    /* Generous, and floored: a grazing path can report a hairline width, and the
       engine is the thing that actually decides. */
    var padDeg = Math.max(2 * MASK_DEG, halfDeg * 1.10) + MASK_DEG;

    var m = new Uint8Array(MASK_NLAT * MASK_NLON);
    mid.forEach(function (p) {
      var lat = p[1], lon = p[0];
      if (!isFinite(lat) || !isFinite(lon)) return;
      var rLat = padDeg;
      /* Longitude degrees per km blow up toward the pole. Above 85 the whole
         longitude row is marked — cheap, and the alternative is an arithmetic
         edge case exactly where this project's corridors are hardest. */
      var cl = Math.cos(lat * Math.PI / 180);
      var rLon = (Math.abs(lat) > 85 || cl < 0.02) ? 999 : padDeg / cl;
      var y0 = Math.floor((90 - (lat + rLat)) / MASK_DEG);
      var y1 = Math.ceil((90 - (lat - rLat)) / MASK_DEG);
      if (y0 < 0) y0 = 0; if (y1 > MASK_NLAT - 1) y1 = MASK_NLAT - 1;
      for (var y = y0; y <= y1; y++) {
        if (rLon >= 180) { m.fill(1, y * MASK_NLON, (y + 1) * MASK_NLON); continue; }
        var x0 = Math.floor((lon - rLon + 180) / MASK_DEG);
        var x1 = Math.ceil((lon + rLon + 180) / MASK_DEG);
        for (var x = x0; x <= x1; x++) {
          m[y * MASK_NLON + (((x % MASK_NLON) + MASK_NLON) % MASK_NLON)] = 1;
        }
      }
    });
    return m;
  }

  /* Bounding box of the corridor WITHIN the given box, from the mask, or null if
     there is no mask or no corridor in view. Works at mask resolution, which is
     one array read per cell — thousands of them, microseconds. Rounded OUTWARD
     by a cell so the corridor is never clipped by its own bounding box. */
  function _corridorBox(w, e, s, n) {
    if (!_mask) return null;
    var lo = 1e9, hi = -1e9, so = 1e9, no = -1e9, found = false;
    var stepLat = Math.max(MASK_DEG, (n - s) / 400);
    var stepLon = Math.max(MASK_DEG, (e - w) / 400);
    for (var lat = s; lat <= n; lat += stepLat) {
      for (var lon = w; lon <= e; lon += stepLon) {
        if (!_near(lat, lon)) continue;
        found = true;
        if (lon < lo) lo = lon; if (lon > hi) hi = lon;
        if (lat < so) so = lat; if (lat > no) no = lat;
      }
    }
    if (!found) return null;
    var padLat = Math.max(MASK_DEG, stepLat), padLon = Math.max(MASK_DEG, stepLon);
    return { w: Math.max(w, lo - padLon), e: Math.min(e, hi + padLon),
             s: Math.max(s, so - padLat), n: Math.min(n, no + padLat) };
  }

  function _near(lat, lon) {
    if (!_mask) return true;                   /* no mask -> ask the engine */
    var y = Math.floor((90 - lat) / MASK_DEG);
    if (y < 0) y = 0; if (y > MASK_NLAT - 1) y = MASK_NLAT - 1;
    var x = Math.floor((((lon + 180) % 360 + 360) % 360) / MASK_DEG) % MASK_NLON;
    return _mask[y * MASK_NLON + x] === 1;
  }

  /* Fraction of a box that the corridor mask marks. Coarse on purpose: it only
     has to size a canvas, and it must stay far cheaper than what it is deciding
     about. Returns 1 when there is no mask, which yields the smallest canvas —
     the safe direction, since without a mask every pixel costs an engine call. */
  function _maskFraction(box) {
    if (!_mask) return 1;
    var N = 64, hit = 0, i, j;
    var yN = _mercY(box.n), yS = _mercY(box.s);
    for (j = 0; j < N; j++) {
      var lat = _invMercY(yN + (j + 0.5) / N * (yS - yN));
      for (i = 0; i < N; i++) {
        if (_near(lat, box.w + (i + 0.5) / N * (box.e - box.w))) hit++;
      }
    }
    return hit / (N * N);
  }

  /* ---------------------------------------------------------------- render */

  /* Score the canvas. TWO cheap filters in front of the expensive one, because
     the engine costs ~1.1 us a cell and everything else here costs nanoseconds:

       1. the corridor MASK — is this cell anywhere near the centreline? One
          array read. Rejects 75-90% of a frame outright.
       2. a coarse LATTICE inside the mask — the engine at block resolution,
          finding the true ribbon, which is narrower than the mask band.

     Only blocks the lattice actually hit (plus one block of dilation) are scored
     per pixel. Neither filter alone is enough: the mask is a geometric envelope
     and stays about twice as wide as the real corridor, while a bare lattice
     pays engine calls across the whole empty frame to discover it is empty.

     THE FAILURE MODE HERE IS SILENT — a ribbon thinner than the lattice spacing
     would drop stretches of path with no error at all, looking like a data
     fault. So the block size is derived in DEGREES, not pixels: a central path
     is ~2 deg across at its narrowest, the lattice is held at or below 0.4 deg
     and floored at 2 px. Zoomed out that leaves little to skip, which is
     correct — that is exactly when the ribbon is a few pixels wide. */
  function _draw(cv, box, W, H, collect) {
    var ctx = cv.getContext('2d');
    if (!_img || _img.width !== W || _img.height !== H) _img = ctx.createImageData(W, H);
    var img = _img, out = img.data;
    out.fill(0);
    var yN = _mercY(box.n), yS = _mercY(box.s);
    var lo = 1, hi = 0, x, y;
    if (collect) { _nsamp = 0; _ns = 0; }

    var lons = new Float64Array(W), lats = new Float64Array(H);
    for (x = 0; x < W; x++) lons[x] = box.w + (x + 0.5) / W * (box.e - box.w);
    for (y = 0; y < H; y++) lats[y] = _invMercY(yN + (y + 0.5) / H * (yS - yN));

    var degPerPx = Math.abs(box.e - box.w) / W;
    var BS = Math.floor(0.4 / (degPerPx || 1e-9));
    if (!(BS > 1)) BS = 2;
    if (BS > 24) BS = 24;

    var bw = Math.ceil(W / BS), bh = Math.ceil(H / BS);
    var flag = new Uint8Array(bw * bh), bx, by;

    for (by = 0; by < bh; by++) {
      for (bx = 0; bx < bw; bx++) {
        var px = Math.min(W - 1, bx * BS + (BS >> 1));
        var py = Math.min(H - 1, by * BS + (BS >> 1));
        if (_near(lats[py], lons[px]) && _cell(lats[py], lons[px])) {
          flag[by * bw + bx] = 1; continue;
        }
        px = Math.min(W - 1, bx * BS); py = Math.min(H - 1, by * BS);
        if (_near(lats[py], lons[px]) && _cell(lats[py], lons[px])) flag[by * bw + bx] = 1;
      }
    }

    /* Dilate by one block, so a ribbon clipping a block's corner is not shaved
       off at the edge of what gets refined. */
    var grow = new Uint8Array(bw * bh);
    for (by = 0; by < bh; by++) {
      for (bx = 0; bx < bw; bx++) {
        if (!flag[by * bw + bx]) continue;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = bx + dx, ny = by + dy;
            if (nx >= 0 && nx < bw && ny >= 0 && ny < bh) grow[ny * bw + nx] = 1;
          }
        }
      }
    }

    for (by = 0; by < bh; by++) {
      for (bx = 0; bx < bw; bx++) {
        if (!grow[by * bw + bx]) continue;
        var x1 = Math.min(W, bx * BS + BS), y1 = Math.min(H, by * BS + BS);
        for (y = by * BS; y < y1; y++) {
          var lat = lats[y], o = (y * W + bx * BS) * 4;
          for (x = bx * BS; x < x1; x++, o += 4) {
            if (!_near(lat, lons[x])) continue;
            var s = _score(lat, lons[x]);
            if (s < 0) continue;                 /* already transparent */
            if (collect) {
              if (s < lo) lo = s;
              if (s > hi) hi = s;
              /* Every 4th cell is plenty to find a percentile and keeps this
                 array small. MIN/MAX alone is what the first cut used, and one
                 anomalous cell at either end then owns the whole ramp. */
              if ((_ns & 3) === 0 && _nsamp < _samples.length) _samples[_nsamp++] = s;
              _ns++;
            }
            /* 'view' mode restretches again, to what is on screen. Applied here
               and not in _score(), because sampleAt() must keep answering on the
               stable whole-path scale whatever the map happens to be showing. */
            var v = s;
            if (_mode === 'view' && _viewHi > _viewLo) {
              v = (s - _viewLo) / (_viewHi - _viewLo);
              v = v < 0 ? 0 : v > 1 ? 1 : v;
            }
            var i = (v * 255) | 0; i = (i < 0 ? 0 : i > 255 ? 255 : i) * 3;
            var a = _lastD / EDGE_FADE;
            out[o] = _lut[i]; out[o + 1] = _lut[i + 1]; out[o + 2] = _lut[i + 2];
            out[o + 3] = a >= 1 ? 255 : (a * 255) | 0;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    if (!collect || _nsamp < 32) return { lo: lo, hi: hi, n: _nsamp };
    /* 2nd-98th percentile of what is actually on screen. */
    var v = Array.prototype.slice.call(_samples.subarray(0, _nsamp));
    v.sort(function (a, b) { return a - b; });
    return { lo: v[Math.floor(_nsamp * 0.02)], hi: v[Math.floor(_nsamp * 0.98)], n: _nsamp };
  }

  /* Exactly one of the two layers is visible. Stacking them composites 0.75 over
     0.75 to 0.94 and reads as a darkening flicker every time the detail canvas
     appears. */
  function _swap(showDetail) {
    var det = showDetail === true ? 'visible' : 'none';
    /* null means NEITHER — used while a new eclipse loads, when both canvases
       still hold the previous one's corridor. */
    var base = showDetail === false ? 'visible' : 'none';
    try {
      if (map.getLayer(LAYER_B)) map.setLayoutProperty(LAYER_B, 'visibility', base);
      if (map.getLayer(LAYER))   map.setLayoutProperty(LAYER, 'visibility', det);
    } catch (e) {}
  }

  /* World canvas, drawn once per eclipse and never for pan or zoom. It is what
     covers the screen during a gesture, so there is nothing to outrun: zooming
     out doubles the viewport in one frame and no margin can stay ahead of that.
     Do not delete it to "simplify" — three previous attempts at the same symptom
     on the cloud layer were chasing an unwinnable race (HANDOFF 10.3). */
  function _renderBase(key) {
    if (_baseKey === key && map.getLayer(LAYER_B)) return;
    var box = { w: -180, e: 180, s: -LAT_MAX, n: LAT_MAX };
    if (!_canvasB) _canvasB = document.createElement('canvas');
    var wh = _safeSize(BASE_PX, BASE_PX), W = wh[0], H = wh[1];
    _canvasB.width = W; _canvasB.height = H;

    var keep = _img; _img = null;          /* do not clobber the detail buffer */
    _draw(_canvasB, box, W, H, false);
    _img = keep;

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

  /* Besselian record for the selected eclipse. loadChunk() caches the data and
     the in-flight promise, so this is free after the first call. */
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

  /* Load and cache everything the SCORE needs for one eclipse: the Besselian
     record, the cloud slices, the corridor mask, and the per-eclipse
     normalisation. Resolves true when a score can be computed.

     Separated out because the score is wanted in two places, and only one of
     them draws: the overlay, and the Details panel's row, which has to work with
     the overlay switched OFF — exactly as `Clear sky` works without the cloud
     overlay, via Cloud.ensureAt. Everything here is cached against the eclipse
     key, so the second caller is free. */
  function _prepare(entry) {
    var key = _eclipseKey(entry);
    var want = [_loadRec(entry)];
    want.push((typeof Cloud !== 'undefined' && Cloud.ensureSlices)
              ? Cloud.ensureSlices() : Promise.resolve(false));
    /* The corridor geometry the map already draws, for the proximity mask.
       Resolves null rather than rejecting: without it _near() returns true
       everywhere and the score is correct, just slower to compute. */
    want.push((typeof loadPathChunk === 'function')
      ? loadPathChunk(entry).then(function (pd) {
          return pd && pd[String(Math.round(entry.cat_no))];
        }).catch(function () { return null; })
      : Promise.resolve(null));

    return Promise.all(want).then(function (res) {
      if (!res[0]) return false;
      _rec = res[0];
      if (_maskKey !== key) { _mask = _buildMask(res[2]); _maskKey = key; }
      if (_recKey !== key) {
        var st = _measurePath();
        _pathMax = st.durMax; _pathLo = st.lo; _pathHi = st.hi; _recKey = key;
      }
      return _pathMax > 0;
    });
  }

  /* Score at one point WITHOUT the overlay being on — the Details panel's row.
     Mirrors Cloud.ensureAt's contract: resolves the value, or null outside the
     corridor / when there is nothing to compute. */
  function ensureAt(lon, lat) {
    if (!selectedEntry) return Promise.resolve(null);
    return _prepare(selectedEntry).then(function (ok) {
      return ok ? detailAt(lon, lat) : null;
    }).catch(function () { return null; });
  }

  function _render(force) {
    if (!_on || !map || !mapReady || !selectedEntry) return;
    if (!force && _covered()) return;
    /* A forced render must STAY forced when deferred: replaying it unforced lets
       _covered() throw it away against a box the in-flight render just
       repopulated. Both ends, or the trap stays armed (HANDOFF 10.5). */
    if (_busy) { _again = true; if (force) _againForce = true; return; }
    _busy = true;

    var entry = selectedEntry, key = _eclipseKey(entry);

    /* Cloud slices AND the Besselian record. ensureSlices() also populates the
       cloud module's _lastRec, without which its sampleAt() would time every
       point at greatest eclipse instead of its own local maximum — up to 90
       minutes out at the ends of a track (HANDOFF 10.2, 10.7). */
    _prepare(entry).then(function (ok) {
      if (!_on) return;
      /* THE ECLIPSE MAY HAVE CHANGED WHILE WE WERE LOADING. _prepare awaits three
         fetches; if the user has since picked another eclipse, everything below
         would paint the PREVIOUS corridor and mark it current — the same
         stale-canvas problem _swap(null) exists to prevent, arriving a moment
         later by another route. The queued re-render is already waiting to do the
         right one. */
      if (_eclipseKey(selectedEntry) !== key) return;
      if (!ok) { _disable(); return; }   /* no record, or no central path */

      _renderBase(key);

      var box = _bbox();
      /* Canvas sized well below the screen, because cost here is PER CELL and
         the score varies smoothly. MAX_PX 288 is ~100 ms; the GPU's linear
         filter does the upscale for free. */
      var cv = map.getCanvas();
      /* The box is (1 + 2*MARGIN) times the viewport, so the canvas has to be
         scaled by that too or PX_DIV silently means a third of what it says. */
      var Wd = Math.round((cv.clientWidth || 800) / PX_DIV * (1 + 2 * MARGIN));
      var lonSpan = box.e - box.w, mercSpan = _mercY(box.n) - _mercY(box.s);
      var aspect = mercSpan / (lonSpan * Math.PI / 180);   /* H / W */

      /* How much of THIS box is near the corridor? A coarse sweep of the mask —
         a few thousand array reads, microseconds — turns the fixed cap into a
         budget. Floored so a sliver of path cannot ask for an infinite canvas. */
      var frac = _maskFraction(box);
      var nMax = (_moving ? BUDGET_MOVE : BUDGET) / Math.max(frac, 0.004);
      var wMax = Math.sqrt(nMax / Math.max(aspect, 0.02));

      var W = Math.round(Math.min(Wd, wMax, MAX_PX));
      W = Math.max(MIN_PX, W);
      var H = Math.round(W * aspect);
      H = Math.max(MIN_PX, Math.min(MAX_PX, H));
      var wh = _safeSize(W, H); W = wh[0]; H = wh[1];

      if (!_canvas) _canvas = document.createElement('canvas');
      if (_canvas.width !== W)  _canvas.width  = W;
      if (_canvas.height !== H) _canvas.height = H;

      /* 'view' mode restretches to what is on screen. Two passes: measure, then
         draw. Stretch on the 2nd-98th percentile would need the sample kept —
         for now min/max of the visible corridor, which step 2 refines. Always
         restretch the COMPOSITE, never C and D separately: that would amplify
         whichever term happens to be flat into false contrast. */
      /* View mode costs TWO passes. Mid-gesture that is the wrong place to spend
         it: keep the stretch from the last resting render and paint once. The
         colours are then a frame behind during the drag and correct the moment
         it stops, which is far less visible than the extra coarseness paying for
         a second pass would buy. */
      if (_mode === 'view' && !_moving) {
        /* Two passes: measure what is on screen, then paint to it. The first
           pass paints with the PREVIOUS stretch, so it is not wasted if the
           range has not moved — which is why the repaint is conditional. Without
           that guard every view-mode render costs double, and this layer is
           already the most expensive thing on the map. */
        var r = _draw(_canvas, box, W, H, true);
        if (r.hi > r.lo &&
            (Math.abs(r.lo - _viewLo) > 0.02 || Math.abs(r.hi - _viewHi) > 0.02)) {
          _viewLo = r.lo; _viewHi = r.hi;
          _draw(_canvas, box, W, H, false);
        }
      } else {
        _draw(_canvas, box, W, H, false);
      }

      var coords = [[box.w, box.n], [box.e, box.n], [box.e, box.s], [box.w, box.s]];
      if (!map.getSource(SRC)) {
        map.addSource(SRC, { type: 'canvas', canvas: _canvas,
                             coordinates: coords, animate: false });
        map.addLayer({ id: LAYER, type: 'raster', source: SRC,
                       paint: { 'raster-opacity': OPACITY, 'raster-fade-duration': 0 } });
        _src = map.getSource(SRC);
      } else {
        _src.setCoordinates(coords);
        /* animate:false means prepare() only re-uploads on resize or while
           playing; play()+pause() forces exactly one upload. */
        _src.play(); _src.pause();
      }
      _drawn = box; _drawnZoom = map.getZoom(); _drawnKey = key;
      /* Show the canvas we just drew. It was `!_moving` when the only render
         happened after the gesture — with mid-gesture redraws that rule would
         hide the fresh canvas and show the coarse world one instead, which is
         the opposite of the point. */
      _swap(_moving ? _stillCovers() : true);
      /* Now, not at enable: the ovals disappear in the same frame the score
         appears, rather than a few hundred ms earlier. */
      _refreshOvals();
      /* Terrain veto on top, if the zoom and the connection allow it. Cheap when
         already up — setVetoTime() repoints without a rebuild. */
      if (!_moving) {
        _syncVeto();
        /* Redraw the legend AFTER the veto has been applied. Its last line
           reports whether terrain is live, and it was previously rendered when
           the button was pressed — before this point — so it kept saying "No
           terrain" over a map that plainly had terrain on it. Anything that
           reports on an async result has to be told when that result lands. */
        try { if (window.FavorBar && FavorBar.render) FavorBar.render(); } catch (e) {}
      }
    }).catch(function (err) {
      console.warn('[favorability]', err && err.message || err);
      _disable();
    }).then(function () {
      _busy = false;
      if (_again) { _again = false; var f = _againForce; _againForce = false; _render(f); }
    });
  }

  /* ------------------------------------------------------- the terrain veto */

  /* THE SHADOW ENGINE IS A PAINTBRUSH, NOT A SENSOR. It draws terrain shadow and
     discards the result; it exposes no query, so at high zoom terrain is not an
     INPUT to the score but a mask painted over it. That is why this lives in the
     layer rather than in the maths, and why the score itself never changes when
     the veto appears.

     The instant the veto is drawn for is the LOCAL maximum at the point of
     interest — NOT computeShadowWindow().maxms, which is greatest eclipse: one
     instant for the whole planet, and up to 90 minutes wrong at the ends of a
     track (§10.2). Ninety minutes of the sun's motion is an entirely different
     set of shadows, so the wrong one would veto the wrong ground while looking
     perfectly plausible. */
  function _localMaxMs() {
    if (!_rec || !map) return null;
    var c = map.getCenter();
    var lat = c.lat, lon = c.lng;
    var lw = -lon;
    var t = findMaximum(_rec, lat, lw, 0, _rec.dt);
    if (!isFinite(t)) return null;
    /* TDT offset -> UT hours -> a real instant, the same conversion
       computeEclipse uses: UT = t0 + t - dT/3600. */
    var utH = refT0(_rec) + t - _rec.dt / 3600;
    return Date.UTC(_rec.year, _rec.month - 1, _rec.day) + utH * 3600000;
  }

  /* Ask shadow-ui to dress the engine as a veto, or hand it back. Returns what
     actually happened so the legend can say which visibility source is live —
     it is NOT a bug that the score means something slightly different above and
     below the zoom threshold, but it must be visible that it does. */
  function _syncVeto() {
    if (typeof showShadowAsVeto !== 'function') return false;
    /* ARMED, not showing: the borrow survives a zoom-out, so handing the engine
       back has to test that rather than whether anything is on screen. */
    var armed = (typeof isVetoArmed === 'function') ? isVetoArmed() : false;
    if (!_on) {
      if (armed) restoreShadowMode();
      return false;
    }
    var t = _localMaxMs();
    if (t === null) return false;
    if (armed) { setVetoTime(t); return true; }
    return showShadowAsVeto(t);
  }

  /* Could the veto be shown right now? Zoom and connectivity, asked of the same
     gates shadow-ui enforces rather than duplicated here — so the panel can
     explain WHY the switch is dead instead of just looking broken. */
  function vetoAvailable() {
    if (typeof showShadowAsVeto !== 'function' || !map) return false;
    if (typeof isOffline === 'function' && isOffline()) return false;
    if (typeof SHADOW_MIN_ZOOM === 'number' && map.getZoom() < SHADOW_MIN_ZOOM) return false;
    return true;
  }

  function vetoActive() {
    return !!(typeof isShadowVeto === 'function' && isShadowVeto());
  }

  /* ---------------------------------------------------------------- public */

  /* Score at one point, or null outside the corridor / before the layer has the
     data it needs. Deliberately mirrors Cloud.sampleAt's contract, including
     returning null rather than a plausible zero. */
  function sampleAt(lon, lat) {
    if (!_rec || !(_pathMax > 0)) return null;
    var s = _score(lat, lon);
    return s < 0 ? null : s;
  }

  /* The parts behind the number, for a readout that has to explain itself. */
  function detailAt(lon, lat) {
    if (!_rec) return null;
    var c = _cell(lat, lon);
    if (!c) return null;
    var cloud = (typeof Cloud !== 'undefined' && Cloud.sampleAt)
              ? Cloud.sampleAt(lon, lat) : null;
    return { duration: c.dur, altitude: c.alt,
             cloud: cloud, pathMax: _pathMax,
             score: _score(lat, lon), raw: _raw(lat, lon, _pathMax) };
  }

  function setMode(m) {
    if (m !== 'path' && m !== 'view') return;
    if (m === _mode) return;
    _mode = m;
    if (_on) _render(true);
  }
  function getMode() { return _mode; }

  function _enable() {
    if (_on) return;
    if (!selectedEntry) return;
    _on = true;
    if (!_lut) _lut = _buildLut();
    /* NOT _refreshOvals() here. _render() is async — it loads the record, the
       cloud slices and the path chunk, then builds the mask and measures the
       whole path, which is a few hundred ms. Hiding the ovals up front left a
       visible hole where they had gone and the score had not yet arrived. The
       ovals go when the first pixels land, in _render's success path. */
    _render(true);
  }

  /* The umbra footprint ovals are drawn along this same corridor below zoom 7 and
     read as blotches over the score. map.js's ovalsVisible() now asks whether
     this layer is on, but nothing repaints on its own — the deck layers only
     rebuild on zoom or a new eclipse. So say so on every toggle.
     An earlier attempt reached into map.js's _deckLayers from here instead. It
     appeared to work and then silently came undone at the next redraw, because
     the rule lived in one place and the rebuild read another. */
  function _refreshOvals() {
    try {
      if (typeof updateOvalVisibility === 'function') updateOvalVisibility();
    } catch (e) {}
  }

  /* ONE try PER REMOVAL. MapLibre throws on removeSource while a layer still
     references the source, so a shared try would skip every removal after the
     first throw and leave the base canvas painted while the button says off. */
  function _disable() {
    _on = false;
    try { if (map && map.getLayer(LAYER))   map.removeLayer(LAYER); }   catch (e) {}
    try { if (map && map.getSource(SRC))    map.removeSource(SRC); }    catch (e) {}
    try { if (map && map.getLayer(LAYER_B)) map.removeLayer(LAYER_B); } catch (e) {}
    try { if (map && map.getSource(SRC_B))  map.removeSource(SRC_B); }  catch (e) {}
    _src = null; _srcB = null;
    _drawn = null; _drawnZoom = -1; _drawnKey = ''; _baseKey = ''; _moving = false;
    /* Hand the engine back BEFORE the ovals repaint: restoreShadowMode() puts the
       map back on the globe, and deck layers are rebuilt by that. */
    /* isVetoArmed, not vetoActive: below the zoom threshold the engine is still
       borrowed while drawing nothing, and it must still be handed back. */
    try {
      if (typeof isVetoArmed === 'function' && isVetoArmed()) restoreShadowMode();
    } catch (e) {}
    _refreshOvals();
  }

  function toggle() { if (_on) _disable(); else _enable(); }

  /* ------------------------------------------------------------------ wire */

  (function () {
    if (typeof AppState === 'undefined') return;

    AppState.on('selectedEntry', function () {
      /* New eclipse: nothing drawn is still valid, and the normalisation, the
         mask and the record all belong to the old one. */
      _drawn = null; _drawnKey = ''; _baseKey = '';
      _rec = null; _recKey = ''; _pathMax = 0; _pathLo = 0; _pathHi = 1;
      _mask = null; _maskKey = '';
      if (!_on) return;
      /* HIDE BOTH CANVASES IMMEDIATELY. The redraw is async and takes a few
         hundred ms, and until it lands these canvases hold the PREVIOUS
         eclipse's corridor — so the map showed the new path drawn under the old
         score, then swapped late. A blank corridor for a moment is honest; the
         wrong corridor is not. */
      _swap(null);
      _render(true);
    });

    AppState.on('mapReady', function () {
      if (!map || !map.on) return;
      map.on('movestart', function () {
        if (!_on) return;
        _moving = true;
        /* Keep the sharp canvas for as long as it still covers the screen. Only
           a gesture that leaves the drawn box needs the world canvas. */
        _swap(_stillCovers());
      });
      map.on('move', function () {
        if (!_on || !_moving) return;
        _swap(_stillCovers());
        /* Redraw mid-gesture once the view has drifted far enough from what is
           drawn — either zoomed past what the canvas can honestly represent, or
           panned out of the box. _busy self-throttles, so this cannot pile up:
           at most one gesture render is in flight at a time. */
        if (_busy) return;
        if (Math.abs(map.getZoom() - _drawnZoom) > MOVE_ZOOM_DRIFT || !_stillCovers()) _render(true);
      });
      map.on('moveend', function () {
        if (!_on) return;
        _moving = false;
        _render(true);
      });
    });
  })();

  /* Bump on every change. Script tags carry a hardcoded ?v= and the service
     worker is cache-first with ignoreSearch, so "is this the file I just
     uploaded?" is otherwise unanswerable from the console. */
  window.Favorability = {
    version: '2026-09-11c',
    toggle: toggle, enable: _enable, disable: _disable,
    sampleAt: sampleAt, detailAt: detailAt,
    setMode: setMode, getMode: getMode,
    stops: function () { return STOPS.slice(); },
    ensureAt: ensureAt,
    vetoActive: vetoActive, vetoAvailable: vetoAvailable,
    /* Console diagnostic. "This view" is hard to judge by eye — a restretch that
       does nothing and a restretch that does a little look the same — so the
       numbers are readable rather than guessable. */
    debug: function () {
      return { mode: _mode, on: _on,
               viewLo: _viewLo, viewHi: _viewHi,
               pathLo: _pathLo, pathHi: _pathHi, pathMax: _pathMax,
               samples: _nsamp, drawn: _drawn };
    },
    isOn: function () { return _on; },
    pathMax: function () { return _pathMax; }
  };
})();
