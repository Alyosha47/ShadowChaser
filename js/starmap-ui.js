/**
 * starmap-ui.js
 * ──────────────────────────────────────────────────────────────────────────
 * The sun-track diagram: the Sun's path across the sky over C1→C4, the Moon's
 * bite at any instant, and — during totality — the planets and bright stars
 * around it. Rendering only. All the astronomy comes from starmap.js
 * (object positions) and eclipse.js (the Sun and Moon).
 *
 * Split out of details.js on 2026-08-29b to match the pattern every other
 * feature here follows: <thing>.js computes, <thing>-ui.js draws.
 *   shadow-layer.js / shadow-ui.js     cloud-average.js / cloud-ui.js
 *
 * Depends on, all resolved at call time so load order does not matter:
 *   sampleEclipseAt, computeEclipse   eclipse.js
 *   Starmap.skyAt                     starmap.js   (optional — degrades)
 *   shadowTimeFromSunTrack            shadow-ui.js (optional)
 *   _timeMode                         details.js
 * Publishes window.sunTrackJump, which shadow-ui.js drives.
 *
 * ⚠ THE PROJECTION IS NOT AN AZIMUTH/ALTITUDE CHART. See the note on it below
 * before changing anything: four earlier builds broke because azimuth degrees
 * were mistaken for sky degrees.
 */

/* Interactive sun-track diagram: the Sun's path across a TRUE-SCALE PATCH OF
   SKY over the eclipse window C1→C4, with a time slider that scrubs a Sun
   marker along the arc and draws the Moon's bite at that instant. During
   totality the naked-eye planets and bright stars appear around it, at their
   real angular separations. Pure SVG + one range input; no external deps.

   ⚠ It is NOT an azimuth/altitude chart, which is what it was until
   2026-08-29a. See the note on the projection below before changing it. */
function buildSunTrack(rec, lat, lon, altM, res, tz) {
  var host = document.getElementById('suntrack');
  if (!host || typeof sampleEclipseAt !== 'function') return;
  if (res.C1 == null || res.C1.ut == null || res.C4 == null || res.C4.ut == null) {
    host.innerHTML = '<div class="note">Sky Tracker unavailable.</div>'; return;
  }

  /* Eclipse window with a small margin so C1/C4 aren't flush at the edges. */
  var t0 = res.C1.ut, t1 = res.C4.ut;
  if (t1 < t0) t1 += 24;                       /* crossed UT midnight */
  var span = t1 - t0, marg = span * 0.06;
  var ta = t0 - marg, tb = t1 + marg;

  /* Sample the arc on a single uniform time grid. Contacts are NOT inserted into
     the curve — mixing a uniform grid with injected contact times produced
     near-coincident points (and a visible kink) on grazers where contacts bunch.
     Contact positions for the marks/slider are computed directly from their UT
     via sampleEclipseAt, independent of the curve sampling. */
  var N = 240;
  var pts = [];
  for (var i = 0; i <= N; i++) {
    var t = ta + (tb - ta) * i / N;
    var s = sampleEclipseAt(rec, lat, lon, altM, t);
    pts.push({ t: t, az: s.az, alt: s.alt, mag: s.mag, sep: s.sep,
               moonRatio: s.moonRatio, v: s.v });
  }
  /* Map a contact UT to its position along the uniform grid (fractional index),
     used to place the slider exactly at a contact without distorting the curve. */
  function indexForUT(ut) {
    if (ut == null) return -1;
    var u = ut; if (u < t0 - 0.001) u += 24;
    var frac = (u - ta) / (tb - ta) * N;
    return Math.max(0, Math.min(N, Math.round(frac)));
  }

  /* ── Projection ───────────────────────────────────────────────────────────
     A TRUE-SCALE PATCH OF SKY, not an azimuth/altitude chart.

     This used to plot azimuth across and altitude up, which distorts: azimuth
     degrees shrink by cos(altitude), so the two axes had different px/deg and
     the C1..C4 arc appeared to span 24 deg at one eclipse and 171 at another —
     a 7.3x swing that made it impossible to put anything else in the frame at a
     believable position. In ACTUAL sky angle that same arc is 24 to 49 deg for
     every eclipse on Earth, a 2x swing, so one fixed isotropic scale fits them
     all with room left over for the stars.

     Azimuthal equidistant about the middle of the arc: distance from the centre
     of the frame is the true angular separation, in every direction. That is
     what lets the Sun, the Moon, the planets and the stars share one picture
     with no panning, no rescaling and nothing morphing into anything else. */
  var RAD = Math.PI / 180;
  function vec(a, z) {
    return [Math.cos(a*RAD)*Math.cos(z*RAD), Math.cos(a*RAD)*Math.sin(z*RAD), Math.sin(a*RAD)];
  }
  /* Centred on the Sun at MAXIMUM, so the objects are arranged around the thing
     the reader is looking at rather than around the midpoint of a time grid. */
  var mid = sampleEclipseAt(rec, lat, lon, altM, res.tMax);
  var C   = vec(mid.alt, mid.az);
  var E1  = [-Math.sin(mid.az*RAD), Math.cos(mid.az*RAD), 0];
  var E2  = [C[1]*E1[2]-C[2]*E1[1], C[2]*E1[0]-C[0]*E1[2], C[0]*E1[1]-C[1]*E1[0]];

  /* Offsets in degrees from the frame centre: +x right, +y up. */
  function offs(alt, az) {
    var w = vec(alt, az);
    var Z = w[0]*C[0]  + w[1]*C[1]  + w[2]*C[2];
    var X = w[0]*E1[0] + w[1]*E1[1] + w[2]*E1[2];
    var Y = w[0]*E2[0] + w[1]*E2[1] + w[2]*E2[2];
    var rho = Math.acos(Math.max(-1, Math.min(1, Z))) / RAD;
    var n = Math.sqrt(X*X + Y*Y) || 1;
    return { x: rho * X / n, y: rho * Y / n, sep: rho };
  }

  var W = 320, H = 200, L = 8, R = 8, T = 16, B = 16;
  var po = pts.map(function (p) { return offs(p.alt, p.az); });

  /* Will anything be drawn in the sky? Only where the Moon genuinely covers the
     Sun AT THIS LOCATION, which is res.localPhase === 'total' inside the path.

     ⚠ THREE WRONG GATES HAVE BEEN TRIED HERE. Do not invent a fourth.
       - `C2 && C3` alone — an ANNULAR has C2 and C3 too, those being the ring
         phase, and a rim of photosphere never gets dark enough to show a
         planet. All 142 annulars in 1900-2100 passed this.
       - `res.type === 'total'` — eclipse.js deliberately relabels a hybrid as
         'hybrid' even where the local phase IS total, so this silently excluded
         all 569 hybrids, Exmouth 2023 among them.
       - `moonRatio >= 1` — moonRatio compares the two apparent DISCS, and the
         Moon's is larger for everyone watching a total eclipse, in the path or
         not. It disagrees with the local phase at 1,463 of 8,765 sample points,
         every one of them an observer outside the path.

     `localPhase` is there for exactly this: eclipse.js keeps the real
     total/annular determination in it while `type` carries the display badge.
     With C2/C3 it is exact — cross-checked against moonRatio at all 5,721
     in-path observations in the catalogue, zero disagreements. */
  var showsSky = res.localPhase === 'total' && res.C2 && res.C3
                 && res.C2.ut != null && res.C3.ut != null
                 && typeof Starmap !== 'undefined';

  /* FIXED at 100 degrees whenever the sky is shown — the same for every
     eclipse, never auto-sized, so the picture means the same thing each time
     you look at it. Chosen by measuring:
     across 136 totals it shows a median of 7 objects, and it comfortably holds
     the C1..C4 arc, which is 24 to 49 degrees of true sky angle everywhere.

     THE FLOOR IS VENUS. Venus reaches 47 degrees from the Sun, and it is the
     one object essentially everybody sees during totality, so the half-field
     must clear that — 80 degrees was tried and lost Venus at the 2006 eclipse
     entirely.

     Not wider, even though more would fit. Totality is about as dark as deep
     twilight and the sky is NOT uniformly dark — there is a 360-degree sunset
     glow round the horizon — so in practice only things reasonably near the
     eclipse are actually visible. A 170-degree field would have been honest
     about geometry and dishonest about what you will see.

     WHEN NOTHING WILL BE DRAWN IN THE SKY the 100 degrees is dead space, so the
     frame closes down to the arc alone. That arc is 41 to 65 degrees of true sky
     across the whole catalogue, so this is a real gain — a partial or annular
     gets a track roughly twice the size, with no objects to crop. It is decided
     once, before anything is drawn, and never changes while you scrub. */
  var FIELD;
  if (showsSky) {
    FIELD = 100;
  } else {
    var reach = 0;
    for (var q = 0; q < po.length; q++) {
      reach = Math.max(reach, Math.abs(po[q].x), Math.abs(po[q].y) * 1.55);
    }
    FIELD = Math.max(30, Math.min(100, reach * 2 + 12));
  }
  var K = (W - L - R) / FIELD;                   /* px per degree of true sky */
  var CX = W / 2, CY = T + (H - T - B) / 2;
  function sx(dx) { return CX + dx * K; }
  function sy(dy) { return CY - dy * K; }

  /* Track polyline. */
  var d = '';
  for (var j = 0; j < pts.length; j++) {
    d += (j ? 'L' : 'M') + sx(po[j].x).toFixed(1) + ' ' + sy(po[j].y).toFixed(1) + ' ';
  }

  /* Horizon. In a true-scale sky patch this is a CURVE, not a line — it is a
     great circle seen in an azimuthal projection — so it is sampled in azimuth
     rather than drawn straight. Ground below it is shaded, which also tells you
     instantly when the Sun is setting into the eclipse. */
  var horizon = '', hpath = '', hstart = null, hend = null;
  for (var ha = mid.az - 130; ha <= mid.az + 130; ha += 4) {
    var ho = offs(0, ha);
    if (ho.sep > FIELD * 0.72) { continue; }
    var hx = sx(ho.x), hy = sy(ho.y);
    if (hx < -40 || hx > W + 40 || hy < -60 || hy > H + 60) continue;
    hpath += (hpath ? 'L' : 'M') + hx.toFixed(1) + ' ' + hy.toFixed(1) + ' ';
    if (hstart === null) hstart = [hx, hy];
    hend = [hx, hy];
  }
  if (hpath) {
    horizon = '<path d="' + hpath.trim() + 'L' + hend[0].toFixed(1) + ' ' + (H + 20)
            + ' L' + hstart[0].toFixed(1) + ' ' + (H + 20) + ' Z" class="st-ground"/>'
            + '<path d="' + hpath.trim() + '" class="st-horizon" fill="none"/>'
            + '<text x="' + (W - R) + '" y="' + Math.min(H - 4, Math.max(12, hend[1] - 4)).toFixed(1)
            + '" class="st-hlbl" text-anchor="end">horizon</text>';
  }

  /* Contact tick marks on the track. */
  var marks = '';
  var placed = [];                              /* [{x, side}] to de-collide labels */
  [['C1', res.C1], ['C2', res.C2], ['C3', res.C3], ['C4', res.C4]].forEach(function (c) {
    if (!c[1] || c[1].ut == null) return;
    var k = indexForUT(c[1].ut);
    var mx = sx(po[k].x), my = sy(po[k].y);
    /* Default label above the point; if another label is within ~16px, put this
       one below instead so C2/C3 (close together) don't overlap. */
    var below = placed.some(function (q) { return Math.abs(q.x - mx) < 16; });
    var ly = below ? my + 13 : my - 7;
    placed.push({ x: mx });
    marks += '<circle cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1)
           + '" r="2.6" class="st-contact"/>'
           + '<text x="' + mx.toFixed(1) + '" y="' + ly.toFixed(1)
           + '" class="st-clbl" text-anchor="middle">' + c[0] + '</text>';
  });

  host.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="st-svg" preserveAspectRatio="xMidYMid meet">'
    +   '<defs><linearGradient id="st-sky" x1="0" y1="0" x2="0" y2="1">'
    +     '<stop id="st-sky0" offset="0%"/><stop id="st-sky1" offset="100%"/>'
    +   '</linearGradient></defs>'
    +   '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="6" fill="url(#st-sky)"/>'
    +   horizon
    +   '<path d="' + d.trim() + '" class="st-track" fill="none"/>'
    +   marks
    +   '<g id="st-objects"></g>'
    +   '<g id="st-marker"></g>'
    + '</svg>'
    + '<input id="st-slider" type="range" min="0" max="' + N + '" value="' + indexForUT(res.tMax != null ? res.tMax : (t0 + span / 2)) + '" step="1" class="st-slider"/>'
    + '<div id="st-readout" class="st-readout"></div>';

  var slider = document.getElementById('st-slider');
  var marker = document.getElementById('st-marker');
  var readout = document.getElementById('st-readout');
  var objLayer = document.getElementById('st-objects');
  var sky0 = document.getElementById('st-sky0');
  var sky1 = document.getElementById('st-sky1');

  /* Sky colour as a function of how deep the eclipse is at this instant.
     Uncovered sky is normal daylight; as magnitude rises the sky dims and
     cools, going to deep twilight/near-night at totality — the real
     experience of the light draining out as the Moon covers the Sun.
     Returns [topColor, bottomColor]. */
  function skyColors(mag) {
    function mix(a, b, t) {
      t = Math.max(0, Math.min(1, t));
      return 'rgb(' + Math.round(a[0]+(b[0]-a[0])*t) + ',' + Math.round(a[1]+(b[1]-a[1])*t)
           + ',' + Math.round(a[2]+(b[2]-a[2])*t) + ')';
    }
    var dayTop=[64,132,196],   dayBot=[150,194,224];
    var darkTop=[14,16,34],    darkBot=[34,30,52];
    /* Light falls off slowly then fast near totality (perceptual ~mag^3). */
    var t = Math.pow(Math.max(0, Math.min(1, mag)), 3);
    return [ mix(dayTop, darkTop, t), mix(dayBot, darkBot, t) ];
  }

  function fmtHM(ut) {
    var local = (_timeMode !== 'ut') && (typeof tz === 'number');
    var u = ((ut + (local ? tz : 0)) % 24 + 24) % 24;
    var hh = Math.floor(u), mm = Math.floor((u - hh) * 60);
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
         + (local ? ' local' : ' UT');
  }

  /* ── Objects ──────────────────────────────────────────────────────────────
     Planets and bright stars, in the SAME frame and the SAME projection as the
     Sun's arc, so every separation on screen is a real separation in the sky.
     Positions are computed once, for the instant of maximum: over the couple of
     minutes they are visible the sky turns about half a degree, which is under
     a pixel here.

     Shown only between C2 and C3. Because the frame never moves or rescales,
     that is a plain opacity change — the earlier builds could not do this
     without the whole diagram lurching, which is exactly what they did. */
  var objSvg = '';
  if (showsSky) {
    try {
      var sunAtMax = sampleEclipseAt(rec, lat, lon, altM, res.tMax);
      var sky = Starmap.skyAt(rec, lat, lon, res.tMax);
      var lab = [];
      /* Closest first: an object near the Sun is the most interesting thing in
         the frame and must not lose its label to a brighter one further out. */
      sky = sky.filter(function (o) { return o.alt >= 0; }).map(function (o) {
        var oo = offs(o.alt, o.az);
        var so = offs(sunAtMax.alt, sunAtMax.az);
        var ddx = oo.x - so.x, ddy = oo.y - so.y;
        o._x = oo.x; o._y = oo.y; o._d = Math.sqrt(ddx*ddx + ddy*ddy);
        return o;
      });
      sky.sort(function (a, b) { return a._d - b._d; });
      for (var m = 0; m < sky.length; m++) {
        var ob = sky[m], ox = sx(ob._x), oy = sy(ob._y);
        if (ox < L || ox > W - R || oy < T || oy > H - B) continue;
        var orr = Math.max(1.1, Math.min(3.6, 2.6 - 0.45 * ob.mag));
        objSvg += '<circle cx="' + ox.toFixed(1) + '" cy="' + oy.toFixed(1)
                + '" r="' + orr.toFixed(1) + '" fill="'
                + (ob.kind === 'planet' ? '#ffeccc' : '#eef3ff') + '"/>';
        /* EVERY object gets a name. An unlabelled dot answers none of the
           question this diagram exists to answer. Labels are placed on
           whichever side is free and are kept inside the box; if there is
           genuinely no room the dot is dropped rather than left anonymous. */
        var tw = ob.name.length * 4.3 + 3, ty = oy - orr - 3.5, anchor2 = 'middle', tx = ox;
        if (tx - tw/2 < 2) { anchor2 = 'start'; tx = ox + orr + 3; ty = oy + 3; }
        else if (tx + tw/2 > W - 2) { anchor2 = 'end'; tx = ox - orr - 3; ty = oy + 3; }
        if (ty < 9) ty = oy + orr + 9;
        var bad = false;
        for (var z = 0; z < lab.length; z++) {
          if (Math.abs(lab[z][0] - tx) < (tw + lab[z][2]) / 2 && Math.abs(lab[z][1] - ty) < 10) { bad = true; break; }
        }
        if (bad) { objSvg = objSvg.slice(0, objSvg.lastIndexOf('<circle')); continue; }
        lab.push([tx, ty, tw]);
        objSvg += '<text x="' + tx.toFixed(1) + '" y="' + ty.toFixed(1)
                + '" class="st-olbl" text-anchor="' + anchor2 + '">' + ob.name + '</text>';
      }
    } catch (e) { objSvg = ''; }
  }
  var c2ut = res.C2 && res.C2.ut != null ? res.C2.ut : null;
  var c3ut = res.C3 && res.C3.ut != null ? res.C3.ut : null;
  objLayer.innerHTML = objSvg;

  function draw(i) {
    var p = pts[i];
    var cx = sx(po[i].x), cy = sy(po[i].y), r = 12;
    /* Objects appear for totality and only for totality. */
    var tt = p.t, inTot = false;
    if (c2ut != null && c3ut != null) {
      var a2 = c2ut, b3 = c3ut; if (b3 < a2) b3 += 24;
      var tv = tt < a2 - 0.001 ? tt + 24 : tt;
      inTot = tv >= a2 && tv <= b3;
    }
    objLayer.setAttribute('opacity', inTot ? '1' : '0');
    /* Sky background tracks how deep the eclipse is right now. */
    var sc = skyColors(p.mag);
    sky0.setAttribute('stop-color', sc[0]);
    sky1.setAttribute('stop-color', sc[1]);
    /* Sun disc + Moon bite. The Moon overlaps from direction V (clockwise from
       zenith = up); offset the moon-disc centre by the uncovered fraction so
       the visible crescent matches the magnitude. */
    var sun = '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r + '" class="st-sun"/>';
    /* Moon is always present; its centre sits `sep` sun-radii from the Sun in
       direction V (clockwise from up). sep 0 = concentric (totality), sep 2 =
       discs just touching (C1/C4), sep > 2 = clear of the Sun. So it slides in
       before C1 and out after C4 instead of blinking on/off. */
    var ang = p.v * Math.PI / 180;
    var off = p.sep * r;
    var mx = cx + off * Math.sin(ang);
    var my = cy - off * Math.cos(ang);
    var rMoon = r * (p.moonRatio || 1);            /* <1 annular, >1 total */
    var moon = '<circle cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="' + rMoon.toFixed(1) + '" class="st-moon"/>';
    marker.innerHTML = sun + moon;
    var azDisp = ((p.az % 360) + 360) % 360;
    readout.textContent = fmtHM(p.t)
      + '  \u00b7  alt ' + p.alt.toFixed(1) + '\u00b0'
      + '  \u00b7  az ' + azDisp.toFixed(1) + '\u00b0'
      + (p.mag > 0 ? '  \u00b7  mag ' + p.mag.toFixed(3) : '');
  }

  slider.addEventListener('input', function () {
    var i = parseInt(slider.value, 10);
    draw(i);
    /* Drive terrain shadows from the sun-track slider (no-op if shadows off). */
    if (typeof shadowTimeFromSunTrack === 'function') shadowTimeFromSunTrack(pts[i].t);
  });
  draw(parseInt(slider.value, 10));

  /* Let the contact-time rows jump the slider to a given UT — lands exactly on
     the injected contact datapoint. */
  window.sunTrackJump = function (ut) {
    var k = indexForUT(ut);
    if (k < 0) return;
    slider.value = k;
    draw(k);
    slider.focus();
  };
}
