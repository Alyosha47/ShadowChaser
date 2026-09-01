/**
 * eclipse.js
 * ──────────────────────────────────────────────────────────────────────────
 * Solar eclipse local circumstances — Besselian element calculator.
 *
 * Implements the method of O'Byrne, McCann, Meeus, and Jubier, as described
 * in Meeus "Astronomical Algorithms" Ch. 54 (Willmann-Bell, 2nd ed. 1998)
 * and the NASA Five Millennium Canon of Solar Eclipses (Espenak & Meeus).
 *
 *
 * ── CORRECTNESS NOTES ───────────────────────────────────────────────────────
 *
 * Three details that are commonly wrong in other implementations:
 *
 *   1.  H = μ − λ_west − 0.00417807 · ΔT_seconds
 *       Longitude must be west-positive. The constant 0.00417807 °/s bakes
 *       the TDT→UT Earth-rotation correction directly into the hour angle.
 *
 *   2.  L₁ʹ = L₁ − ζ · tan f₁,   L₂ʹ = L₂ − ζ · tan f₂
 *       Shadow radii must be corrected for the observer's distance along the
 *       shadow axis (ζ). Using raw L₁/L₂ gives wrong eclipse duration.
 *
 *   3.  Contact times found via Newton–Raphson with L₁ʹ/L₂ʹ and velocity
 *       components (a, b) — not by bisection on raw shadow distance.
 *
 *
 * ── PUBLIC API ───────────────────────────────────────────────────────────────
 *
 *   computeEclipse(rec, lat, lon, alt)  →  result
 *
 *     rec   Besselian record object (see "Record fields" below).
 *     lat   Observer latitude,  decimal degrees, north positive.
 *     lon   Observer longitude, decimal degrees, east positive.
 *     alt   Observer altitude,  metres above the ellipsoid.
 *
 *   Returns:
 *     visible      {boolean}      false if the eclipse is not visible here
 *     type         {string}       'total' | 'annular' | 'hybrid' | 'partial'
 *     mag          {number}       eclipse magnitude at maximum
 *     osc          {number}       obscuration percentage (0–100)
 *     tMax         {number}       UT of maximum eclipse, decimal hours
 *     sun          {alt, az}      sun position at maximum, degrees
 *     C1–C4        {ut, sun}      contact times (decimal UT hours) and sun
 *                                 positions; null where the contact doesn't occur
 *     durCentral   {number|null}  totality / annularity duration, seconds
 *     durPartial   {number|null}  partial-phase duration, seconds
 *
 *   Two lower-level functions are also exported for custom use:
 *
 *   findMaximum(rec, lat, lonWest, alt, dT_s)             →  t (TDT offset)
 *   fundamentalArgs(rec, t, lat, lonWest, alt, dT_s)      →  argument object
 *   sunAltAz(args, lat)                                   →  { alt, az }
 *
 *
 * ── RECORD FIELDS ────────────────────────────────────────────────────────────
 *
 *   From the Espenak Five Millennium Canon CSV / JSON:
 *
 *     t0          reference epoch, decimal hours TDT
 *     dt          ΔT in seconds
 *     x0–x3       shadow x-coordinate polynomial coefficients
 *     y0–y3       shadow y-coordinate polynomial coefficients
 *     d0–d2       declination polynomial coefficients
 *     mu0–mu2     Greenwich Hour Angle polynomial coefficients
 *     l10–l12     penumbral radius polynomial coefficients
 *     l20–l22     umbral/antumbral radius polynomial coefficients
 *     tan_f1      tan of penumbral cone half-angle
 *     tan_f2      tan of umbral/antumbral cone half-angle
 *
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   Plain <script> tag:
 *     <script src="eclipse.js"></script>
 *     <script>
 *       var result = computeEclipse(record, 51.5, -0.12, 10);
 *     </script>
 *
 *   ES module:
 *     import { computeEclipse } from './eclipse.js';
 *
 *   Node.js / CommonJS:
 *     const { computeEclipse } = require('./eclipse.js');
 *
 *
 * ── ACCURACY ────────────────────────────────────────────────────────────────
 *
 *   Contact times agree with Jubier and besselianelements.com to within ~5 s
 *   when using the same Besselian elements and ΔT value. Small residual
 *   differences come from each tool using slightly different element values
 *   derived from independent ephemeris runs, not from algorithm differences.
 *
 *
 * Released under the MIT licence.
 * ──────────────────────────────────────────────────────────────────────────
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var api = factory();
    root.computeEclipse   = api.computeEclipse;
    root.fundamentalArgs  = api.fundamentalArgs;
    root.sunAltAz         = api.sunAltAz;
    root.findMaximum      = api.findMaximum;
    root.sampleEclipseAt  = api.sampleEclipseAt;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG = Math.PI / 180;


  /* ── Internal helper ─────────────────────────────────────────────────── */

  /** Evaluate a Besselian polynomial: c[0] + c[1]t + c[2]t² + c[3]t³ */
  function poly(c, t) {
    return c[0] + c[1]*t + c[2]*t*t + (c[3] || 0)*t*t*t;
  }


  /* ── Core computation ────────────────────────────────────────────────── */

  /**
   * Compute all Besselian fundamental arguments for the observer at TDT
   * offset t from t0.  Every other calculation in this module calls this.
   *
   * @param {Object} rec      Eclipse record (Espenak format)
   * @param {number} t        TDT offset from t0, decimal hours
   * @param {number} lat      Observer latitude,  decimal degrees, N positive
   * @param {number} lonWest  Observer longitude, decimal degrees, W positive
   * @param {number} alt      Observer altitude,  metres
   * @param {number} dT_s     ΔT, seconds
   *
   * @returns {Object}
   *   X, Y    shadow axis position in the fundamental plane
   *   d       shadow axis declination, degrees
   *   H       local hour angle of the shadow axis, degrees
   *   L1p     corrected penumbral radius (Earth radii)
   *   L2p     corrected umbral radius (negative for total eclipse)
   *   u, v    shadow displacement from observer in fundamental plane
   *   a, b    time derivatives of u and v
   *   n       shadow speed relative to observer, √(a²+b²)
   */
  function fundamentalArgs(rec, t, lat, lonWest, alt, dT_s) {

    /* Besselian elements at time t */
    var X  = poly([rec.x0,  rec.x1,  rec.x2,  rec.x3 ], t);
    var Y  = poly([rec.y0,  rec.y1,  rec.y2,  rec.y3 ], t);
    var d  = poly([rec.d0,  rec.d1,  rec.d2,  0       ], t);
    var M  = poly([rec.mu0, rec.mu1, rec.mu2, 0       ], t);
    var L1 = poly([rec.l10, rec.l11, rec.l12, 0       ], t);
    var L2 = poly([rec.l20, rec.l21, rec.l22, 0       ], t);
    var Xp = rec.x1 + 2*rec.x2*t + 3*rec.x3*t*t;
    var Yp = rec.y1 + 2*rec.y2*t + 3*rec.y3*t*t;

    /* Local hour angle.
       0.00417807 °/s converts ΔT seconds to degrees of Earth rotation,
       correcting for the TDT–UT difference. */
    var H = M - lonWest - 0.00417807 * dT_s;

    /* Geocentric observer coordinates (Meeus §54, eq. 54.1).
       0.99664719 = 1 − Earth's flattening (IAU). */
    var phi = lat * DEG;
    var u1  = Math.atan(0.99664719 * Math.tan(phi)) / DEG;
    var rsp = 0.99664719 * Math.sin(u1*DEG) + (alt / 6378140) * Math.sin(phi);
    var rcp = Math.cos(u1*DEG)               + (alt / 6378140) * Math.cos(phi);

    /* Observer position in the fundamental plane */
    var Hrad = H * DEG;
    var drad = d * DEG;
    var xi   =  rcp * Math.sin(Hrad);
    var eta  =  rsp * Math.cos(drad) - rcp * Math.cos(Hrad) * Math.sin(drad);
    var zeta =  rsp * Math.sin(drad) + rcp * Math.cos(Hrad) * Math.cos(drad);

    /* Time derivatives of observer position */
    var xip  = 0.01745329 * rec.mu1 * rcp * Math.cos(Hrad);
    var etap = 0.01745329 * (rec.mu1 * xi * Math.sin(drad) - zeta * rec.d1);

    /* Corrected shadow radii.
       Without the ζ·tan f correction, eclipse duration is wrong. */
    var L1p = L1 - zeta * rec.tan_f1;
    var L2p = L2 - zeta * rec.tan_f2;

    /* Shadow displacement and velocity relative to observer */
    var u = X - xi;
    var v = Y - eta;
    var a = Xp - xip;
    var b = Yp - etap;
    var n = Math.sqrt(a*a + b*b);

    return { X:X, Y:Y, d:d, H:H, L1p:L1p, L2p:L2p, u:u, v:v, a:a, b:b, n:n };
  }


  /**
   * Find the TDT offset of maximum eclipse (minimum shadow distance)
   * via Newton–Raphson.
   */
  function findMaximum(rec, lat, lonWest, alt, dT_s) {
    var t = 0;
    for (var i = 0; i < 50; i++) {
      var o   = fundamentalArgs(rec, t, lat, lonWest, alt, dT_s);
      var tau = -(o.u*o.a + o.v*o.b) / (o.n * o.n);
      t += tau;
      if (Math.abs(tau) < 1e-9) break;
    }
    return t;
  }


  /**
   * Find a single contact time via Newton–Raphson.
   *
   * @param {number}  tApprox   starting estimate (TDT offset from t0)
   * @param {boolean} useUmbra  true → umbral contact (C2/C3); false → penumbral (C1/C4)
   * @param {number}  sign      −1 for ingress (C1, C2); +1 for egress (C3, C4)
   * @returns {number|null}     TDT offset, or null if no contact exists
   */
  function findContact(rec, tApprox, lat, lonWest, alt, dT_s, useUmbra, sign) {
    var tc = tApprox;
    for (var i = 0; i < 30; i++) {
      var fc   = fundamentalArgs(rec, tc, lat, lonWest, alt, dT_s);
      var Lp   = useUmbra ? fc.L2p : fc.L1p;
      var absL = Math.abs(Lp);
      if (absL < 1e-10) return null;
      var S    = (fc.a*fc.v - fc.u*fc.b) / (fc.n * absL);
      var disc = 1 - S*S;
      if (disc < 0) return null;
      var tau  = -(fc.u*fc.a + fc.v*fc.b) / (fc.n*fc.n)
               + sign * absL / fc.n * Math.sqrt(disc);
      tc += tau;
      if (Math.abs(tau) < 1e-9) return tc;
    }
    return null;
  }


  /* ── Public utility ──────────────────────────────────────────────────── */

  /**
   * Compute Sun altitude and azimuth from a fundamentalArgs result.
   *
   * @param {Object} o    return value of fundamentalArgs()
   * @param {number} lat  observer latitude, decimal degrees
   * @returns {{ alt: number, az: number }}
   */
  function sunAltAz(o, lat) {
    var phi  = lat * DEG;
    var H    = o.H * DEG;
    var dec  = o.d * DEG;
    var sinA = Math.sin(phi)*Math.sin(dec) + Math.cos(phi)*Math.cos(dec)*Math.cos(H);
    var alt  = Math.asin(Math.max(-1, Math.min(1, sinA))) / DEG;
    var cosZ = (Math.sin(dec) - sinA*Math.sin(phi))
             / (Math.cos(alt*DEG) * Math.cos(phi) + 1e-14);
    var az   = Math.acos(Math.max(-1, Math.min(1, cosZ))) / DEG;
    if (Math.sin(H) > 0) az = 360 - az;
    return { alt: Math.round(alt*10)/10, az: Math.round(az*10)/10 };
  }


  /* ── Main public function ────────────────────────────────────────────── */

  
/**
 * The reference epoch to use for a record, in decimal TDT hours from 0h on the
 * record's own calendar date.
 *
 * ⚠ THIS IS NOT ALWAYS rec.t0, AND THAT IS THE WHOLE POINT.
 *
 * Espenak's `t0` is the whole TD hour nearest greatest eclipse, and the
 * Besselian polynomials are valid over tmin..tmax around it (normally ±3 h).
 * When greatest eclipse falls at 23:5x, the nearest whole hour is 24 — and the
 * catalogue writes that as 0. Read literally, `t0 = 0` means midnight STARTING
 * the record's date when it means midnight ENDING it, and everything derived
 * from it lands 24 hours early.
 *
 * 221 of the 11,898 records are affected. Every one has greatest eclipse inside
 * the 23:00 UT hour — nothing else can trigger it. Six fall in 2000-2100:
 * 2002-06-10, 2012-05-20, 2045-02-16, 2047-12-16, 2052-09-22, 2057-07-01.
 *
 * The symptom was easy to miss because contact times print modulo 24 and so
 * still looked right. What broke was shadow-ui.js, which built its scrubber
 * window from t0 + tmin/tmax (a day early) and its anchor from td_ge (correct),
 * putting the greatest-eclipse instant 20.9 h outside its own window.
 *
 * Found by tools/checks/test_starmap.js, whose Sun gate compares against
 * Espenak's own d0/mu0 and could not reconcile these records.
 */
function refT0(rec) {
  var t0 = rec.t0;
  var p = (rec.td_ge || '').split(':');
  if (p.length === 3) {
    var tge = (+p[0]) + (+p[1]) / 60 + (+p[2]) / 3600;
    if (tge - t0 > 12) t0 += 24;
    else if (t0 - tge > 12) t0 -= 24;
  }
  return t0;
}

  /**
   * Sun altitude in degrees, unrounded.
   *
   * sunAltAz rounds to 0.1 deg, which near the horizon is about a minute of
   * time — too coarse to bisect a rise or set against.
   */
  function sunAltRaw(rec, t, lat, lonWest, alt, dT_s) {
    var o   = fundamentalArgs(rec, t, lat, lonWest, alt, dT_s);
    var phi = lat * DEG, H = o.H * DEG, dec = o.d * DEG;
    var s   = Math.sin(phi)*Math.sin(dec) + Math.cos(phi)*Math.cos(dec)*Math.cos(H);
    return Math.asin(Math.max(-1, Math.min(1, s))) / DEG;
  }

  /**
   * The stretch of this eclipse during which the Sun is above the horizon here.
   *
   * An eclipse is only an eclipse to someone who can see it, so a phase that
   * arrives after the Sun has set did not happen for this observer. At the two
   * ends of every path the shadow crosses the terminator, and there the Sun can
   * set (or rise) part way through: at 64.5S 66.5W on 1646-07-12 the Sun set 90%
   * covered and totality followed underground.
   *
   * Returns the visible window and which end, if either, was cut short by the
   * horizon. Null if the Sun is down for the whole eclipse.
   *
   * @returns {?{lo:number, hi:number, cutLo:boolean, cutHi:boolean}}
   */
  function visibleWindow(rec, lat, lonWest, alt, dT_s, tC1, tC4) {
    if (tC1 === null || tC4 === null || tC4 <= tC1) return null;
    function up(t) { return sunAltRaw(rec, t, lat, lonWest, alt, dT_s) > 0; }

    var upLo = up(tC1), upHi = up(tC4);
    if (upLo && upHi) return { lo: tC1, hi: tC4, cutLo: false, cutHi: false };

    /* Find a moment in between with the Sun up. The altitude turns over at most
       once across an eclipse's few hours, so a modest scan cannot miss it. */
    var inside = null;
    for (var k = 1; k < 240; k++) {
      var t = tC1 + (tC4 - tC1) * k / 240;
      if (up(t)) { inside = t; break; }
    }
    if (inside === null) return null;          /* Sun down throughout */

    function edge(a, b) {                      /* a up, b down -> crossing */
      for (var i = 0; i < 60; i++) {
        var m = (a + b) / 2;
        if (up(m)) a = m; else b = m;
      }
      return a;
    }
    var lo = upLo ? tC1 : edge(inside, tC1);
    var hi = upHi ? tC4 : edge(inside, tC4);
    return { lo: lo, hi: hi, cutLo: !upLo, cutHi: !upHi };
  }

/**
   * Compute full local eclipse circumstances for an observer.
   *
   * @param {Object} rec  Espenak eclipse record (see module header)
   * @param {number} lat  latitude,  decimal degrees, N positive
   * @param {number} lon  longitude, decimal degrees, E positive
   * @param {number} alt  altitude,  metres
   * @returns {Object}    result (see module header)
   */
  function computeEclipse(rec, lat, lon, alt) {
    var dT_s    = rec.dt;  /* ΔT in seconds                           */
    var lonWest = -lon;    /* east-positive input → west-positive      */

    /* Maximum eclipse */
    var tMax  = findMaximum(rec, lat, lonWest, alt, dT_s);
    var oMax  = fundamentalArgs(rec, tMax, lat, lonWest, alt, dT_s);
    var mDist = Math.sqrt(oMax.u*oMax.u + oMax.v*oMax.v);

    if (mDist >= Math.abs(oMax.L1p)) return { visible: false };

    /* Clip to what was above the horizon. Durations and contacts describe what
       an observer could watch, so the Sun setting part way through ends the
       eclipse here — and if the umbra arrived after that, this is a partial
       eclipse at this place, whatever the geometry says. Everything below is
       computed from the clipped maximum, so type, magnitude, obscuration and
       contacts stay consistent with each other. Observers who see the whole
       eclipse are unaffected: for them the window is the eclipse. */
    var pC1 = findContact(rec, tMax, lat, lonWest, alt, dT_s, false, -1);
    var pC4 = findContact(rec, tMax, lat, lonWest, alt, dT_s, false, +1);
    var win = visibleWindow(rec, lat, lonWest, alt, dT_s, pC1, pC4);
    if (!win) return { visible: false };

    var cutBy = win.cutLo ? 'sunrise' : (win.cutHi ? 'sunset' : null);
    if (tMax < win.lo || tMax > win.hi) {
      tMax  = (tMax < win.lo) ? win.lo : win.hi;
      oMax  = fundamentalArgs(rec, tMax, lat, lonWest, alt, dT_s);
      mDist = Math.sqrt(oMax.u*oMax.u + oMax.v*oMax.v);
      if (mDist >= Math.abs(oMax.L1p)) return { visible: false };
    }

    /* Eclipse type for this observer */
    var type;
    if      (mDist >= Math.abs(oMax.L1p)) type = 'none';
    else if (mDist >= Math.abs(oMax.L2p)) type = 'partial';
    else if (oMax.L2p < 0)                type = 'total';
    else                                   type = 'annular';

    if (type === 'none') return { visible: false };

    /* Hybrid promotion: if the global eclipse is hybrid (H), a central observer
       experiences whichever phase applies locally, but we label it hybrid so the
       UI can present the correct badge and type name. localPhase keeps the actual
       total/annular determination so callers (e.g. the duration row) can still say
       which phase applies at THIS point, instead of just "hybrid". */
    var localPhase = type;
    if ((rec.eclipse_type || '')[0] === 'H' && (type === 'total' || type === 'annular')) {
      type = 'hybrid';
    }

    /* Magnitude and obscuration.

       NASA convention (eclipse.gsfc.nasa.gov/SEhelp/SEglossary.html):
         - For partial eclipse: magnitude = fraction of Sun's diameter
           covered by Moon = (L1' - m) / (L1' + L2')   [signed L2']
         - For total or annular: magnitude is replaced by the diameter
           ratio R_moon / R_sun = (L1' - L2') / (L1' + L2')  [signed]
           This gives mag > 1 for total, mag < 1 for annular,
           independent of observer position within the central path.

       Note we use SIGNED L2p here, not absL2. L2 < 0 means total,
       L2 > 0 means annular. The two formulas are continuous at the
       umbra edge (m = |L2'|).

       Obscuration is the area-fraction of Sun covered by Moon — a
       different quantity from magnitude. Computed via the lens-area
       formula for two unequal circles. R_sun = (L1' + L2')/2,
       R_moon = (L1' - L2')/2. */
    var L1p = oMax.L1p;
    var L2p = oMax.L2p;
    var rSun  = (L1p + L2p) / 2;
    var rMoon = (L1p - L2p) / 2;
    var mag;
    if (localPhase === 'total' || localPhase === 'annular') {
      mag = rMoon / rSun;
    } else {
      mag = (L1p - mDist) / (L1p + L2p);
    }

    /* ⚠ TEST localPhase HERE, NOT type. A hybrid is relabelled 'hybrid' above
       even where it is locally total or annular, so a `type` test drops all 569
       hybrids into the partial branch below.

       That branch happens to produce the right answer anyway — with the
       observer central mDist tends to 0, both acos arguments clamp to ±1, and
       the triangle product goes negative so Math.max(0, ...) zeroes the root,
       leaving pi*R^2 for a total and pi*r^2 for an annular. Correct, but only
       because of the clamps: tighten them and 569 records silently go wrong,
       with no test to catch it. Branch explicitly instead. */
    var osc;
    if (localPhase === 'total') {
      osc = 100;
    } else if (localPhase === 'annular') {
      /* Moon entirely inside Sun's disk; covered area = π·R_moon² */
      var k = rMoon / rSun;
      osc = Math.round(k * k * 1000) / 10;
    } else {
      /* Lens area of two unequal circles separated by mDist. */
      var R = rSun, r = rMoon, m = mDist;
      var arg1 = (m*m + R*R - r*r) / (2*m*R);
      var arg2 = (m*m + r*r - R*R) / (2*m*r);
      arg1 = Math.max(-1, Math.min(1, arg1));
      arg2 = Math.max(-1, Math.min(1, arg2));
      var triProd = (-m+R+r) * (m+R-r) * (m-R+r) * (m+R+r);
      var area = R*R * Math.acos(arg1)
               + r*r * Math.acos(arg2)
               - 0.5 * Math.sqrt(Math.max(0, triProd));
      osc = Math.round(area / (Math.PI * R * R) * 1000) / 10;
    }

    /* Sun position at maximum */
    var sun = sunAltAz(oMax, lat);

    /* Eclipse is not observable if the Sun is below the horizon */
    /* The window test above already established that some of this eclipse was
       above the horizon, and tMax now sits inside that window, so this guard
       only ever fires on a rounding edge. Kept as a backstop. */
    if (sun.alt < 0) return { visible: false };

    /* Contact times (TDT offsets from t0) */
    /* Central = the observer is inside the umbra or antumbra, which is exactly
       what localPhase records. Listing 'hybrid' alongside was the same
       workaround for testing the display label instead of the local phase. */
    var isCentral = (localPhase === 'total' || localPhase === 'annular');
    var tC1 = findContact(rec, tMax, lat, lonWest, alt, dT_s, false, -1);
    var tC4 = findContact(rec, tMax, lat, lonWest, alt, dT_s, false, +1);
    var tC2 = isCentral ? findContact(rec, tMax, lat, lonWest, alt, dT_s, true, -1) : null;
    var tC3 = isCentral ? findContact(rec, tMax, lat, lonWest, alt, dT_s, true, +1) : null;

    /* Contacts keep their true times: C4 below the horizon is still a real
       event, and the sky track draws that part of the Sun's arc. It is the
       DURATIONS that stop at the horizon, because a duration is how long there
       was something to watch. So the visible window is kept separately and only
       the durations are measured against it. */
    var vLo = (tC1 === null || tC1 < win.lo) ? win.lo : tC1;
    var vHi = (tC4 === null || tC4 > win.hi) ? win.hi : tC4;
    var vC2 = (tC2 !== null && tC2 < win.lo) ? win.lo : tC2;
    var vC3 = (tC3 !== null && tC3 > win.hi) ? win.hi : tC3;

    /* Convert TDT offset to UT: UT = t0 + t − ΔT/3600 */
    var _t0 = refT0(rec);
    function toUT(t) { return t !== null ? _t0 + t - dT_s / 3600 : null; }

    /* Sun position at each contact */
    function getSun(t) {
      return t !== null
        ? sunAltAz(fundamentalArgs(rec, t, lat, lonWest, alt, dT_s), lat)
        : null;
    }

    /* Position angle V of the contact point on the Sun's limb, expressed as
       degrees CLOCKWISE FROM THE LOCAL ZENITH (12 o'clock = up) — the angle
       the contact-icon renderer consumes directly (bead at sin/−cos of V).

       Derivation:
         P = atan2(u, v)  — contact PA from celestial north, CCW (east).
         q = atan2(sin H, tan φ·cos δ − sin δ·cos H)  — Meeus 14.1 parallactic.
         V = q − P.
       Subtracting q rotates from the celestial-north frame into the zenith
       frame; the negation converts that astronomical PA (CCW-east, on-sky)
       into the icon's clockwise-from-top screen convention.

       CORRECTED 2026-08-08. The previous form was
         q = atan2(sin H, cos φ·tan δ − sin φ·cos H);  V = 180 − P − q
       — φ and δ transposed in q, and an offset that is exact only when
       q = −90°, drifting by 2(q + 90°) everywhere else. It survived because
       the one validation site (2023-04-20, 8.356°S 127.063°E, Sun near the
       zenith) happens to have q ≈ −90°, where both forms agree to ~1°. At
       2012-11-13 from 16.609°S 145.997°E, q ≈ −105° and every icon came out
       ~30° — one clock hour — off.

       Verification of this form:
         vs Jubier V column (clock)  C1 10.9/10.8  C2 5.5/5.5  C3 10.4/10.3
                                     C4 5.1/5.1    MAX 2.0/2.0   [2012-11-13]
         vs Stellarium Sun/Moon Az/Alt offsets, same site: 05:51 local
           expected 326.6° cw, got 326.6; 07:39 expected 151.6, got 151.5.
         The 2023-04-20 reference above is unchanged (345.1 / 92.0 / 288.8).

       NB Jubier's printed "V" column is a CLOCK POSITION (0–12, no degree
       sign), i.e. V_deg / 30. Earlier sessions compared our degrees against
       that clock value and concluded the math was wrong — it wasn't the angle,
       it was the units. P (incl. C2/C3) was correct all along.

       Exterior vs interior contacts: atan2(u, v) gives the shadow-axis
       direction, correct for the exterior contacts C1/C4 (bite on the side the
       Moon enters/leaves). At the interior contacts C2/C3 (totality boundary)
       the last/first bead of light is on the diametrically opposite limb, so P
       gets +180 there. Callers pass interior=true for C2/C3.

       Verification vs Jubier (clock×30):  C1 345/345  C2 93/93
       C3 285/285  C4 ~65/63  — within clock rounding (±3°) + alt/az rounding.

       o.H and o.d are in DEGREES from fundamentalArgs. */
    function getV(t, interior) {
      if (t === null) return null;
      var o    = fundamentalArgs(rec, t, lat, lonWest, alt, dT_s);
      var P    = Math.atan2(o.u, o.v);
      var latR = lat * Math.PI / 180;
      var H_r  = o.H * Math.PI / 180;
      var d_r  = o.d * Math.PI / 180;
      var q    = Math.atan2(Math.sin(H_r),
                            Math.tan(latR) * Math.cos(d_r) - Math.sin(d_r) * Math.cos(H_r));
      var V    = (q - P) * 180 / Math.PI;
      if (interior) V += 180;   /* C2/C3 bead on opposite limb — see above */
      return ((V % 360) + 360) % 360;
    }

    return {
      visible:    true,
      /* null normally; 'sunset' or 'sunrise' when the horizon cut this eclipse
         short here, so callers can say "90% at sunset" rather than presenting a
         clipped duration as the whole event. */
      cutBy:      cutBy,
      type:       type,
      localPhase: localPhase,
      mag:        Math.round(mag * 100000) / 100000,
      osc:        osc,
      sun:        sun,
      tMax:       toUT(tMax),
      C1:         { ut: toUT(tC1), sun: getSun(tC1), v: getV(tC1) },
      C2:         { ut: toUT(tC2), sun: getSun(tC2), v: getV(tC2, true) },
      C3:         { ut: toUT(tC3), sun: getSun(tC3), v: getV(tC3, true) },
      C4:         { ut: toUT(tC4), sun: getSun(tC4), v: getV(tC4) },
      /* Measured over the visible window, not the geometric one: at Sad Hill on
         2026-08-12 the Sun set with the eclipse still in progress, so there was
         100 minutes to watch even though C4 came later, underground. */
      durCentral: vC2 !== null && vC3 !== null ? (vC3 - vC2) * 3600 : null,
      durPartial: (toUT(vHi) - toUT(vLo)) * 3600
    };
  }


  /* Sample observer circumstances at an arbitrary UT (decimal hours), for the
     interactive sun-track diagram. Returns unrounded alt/az (deg), eclipse
     magnitude (fraction of solar diameter covered; <=0 when uneclipsed),
     limb-angle V (deg clockwise from zenith) for the moon-bite orientation,
     and the local phase. Mirrors computeEclipse's physics at a single time. */
  function sampleEclipseAt(rec, lat, lon, altM, t_ut) {
    var dT_s = rec.dt;
    var lonWest = -lon;
    var t = t_ut - refT0(rec) + dT_s / 3600;      /* UT → TDT offset from t0 */
    var o = fundamentalArgs(rec, t, lat, lonWest, altM, dT_s);
    /* unrounded alt/az */
    var phi = lat * DEG, H = o.H * DEG, dec = o.d * DEG;
    var sinA = Math.sin(phi)*Math.sin(dec) + Math.cos(phi)*Math.cos(dec)*Math.cos(H);
    var alt = Math.asin(Math.max(-1, Math.min(1, sinA))) / DEG;
    var cosZ = (Math.sin(dec) - sinA*Math.sin(phi))
             / (Math.cos(alt*DEG) * Math.cos(phi) + 1e-14);
    var az = Math.acos(Math.max(-1, Math.min(1, cosZ))) / DEG;
    if (Math.sin(H) > 0) az = 360 - az;
    /* magnitude (fraction of solar diameter); signed L2p */
    var m = Math.sqrt(o.u*o.u + o.v*o.v);
    var L1p = o.L1p, L2p = o.L2p;
    var mag = (L1p - m) / (L1p + L2p);            /* >0 only when m < L1p */
    if (mag < 0) mag = 0;
    var rSun = (L1p + L2p) / 2;                    /* sun radius, fundamental units */
    var sep  = rSun > 1e-9 ? m / rSun : 99;        /* centre separation in SUN RADII */
    var rmoon = (L1p - L2p) / 2;                   /* moon radius, fundamental units */
    var moonRatio = rSun > 1e-9 ? rmoon / rSun : 1; /* <1 annular, >1 total */
    var phase = (m >= Math.abs(L1p)) ? 'none'
              : (m >= Math.abs(L2p)) ? 'partial'
              : (L2p < 0)            ? 'total' : 'annular';
    /* limb angle V (clockwise from zenith) */
    var P = Math.atan2(o.u, o.v);
    var q = Math.atan2(Math.sin(H),
                       Math.tan(phi)*Math.cos(dec) - Math.sin(dec)*Math.cos(H));
    var V = (q - P) / DEG;
    V = ((V % 360) + 360) % 360;
    return { alt: alt, az: az, mag: mag, sep: sep, moonRatio: moonRatio, v: V, phase: phase };
  }


  /* ── Exports ─────────────────────────────────────────────────────────── */

  return {
    computeEclipse:  computeEclipse,
    refT0:           refT0,
    fundamentalArgs: fundamentalArgs,
    sunAltAz:        sunAltAz,
    findMaximum:     findMaximum,
    sampleEclipseAt: sampleEclipseAt
  };

}));
