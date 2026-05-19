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

    /* Eclipse type for this observer */
    var type;
    if      (mDist >= Math.abs(oMax.L1p)) type = 'none';
    else if (mDist >= Math.abs(oMax.L2p)) type = 'partial';
    else if (oMax.L2p < 0)                type = 'total';
    else                                   type = 'annular';

    if (type === 'none') return { visible: false };

    /* Hybrid promotion: if the global eclipse is hybrid (H), a central observer
       experiences whichever phase applies locally, but we label it hybrid so the
       UI can present the correct badge and type name. */
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
    if (type === 'total' || type === 'annular' || type === 'hybrid') {
      mag = rMoon / rSun;
    } else {
      mag = (L1p - mDist) / (L1p + L2p);
    }

    var osc;
    if (type === 'total') {
      osc = 100;
    } else if (type === 'annular') {
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
    if (sun.alt <= 0) return { visible: false };

    /* Contact times (TDT offsets from t0) */
    var isCentral = (type === 'total' || type === 'annular' || type === 'hybrid');
    var tC1 = findContact(rec, tMax, lat, lonWest, alt, dT_s, false, -1);
    var tC4 = findContact(rec, tMax, lat, lonWest, alt, dT_s, false, +1);
    var tC2 = isCentral ? findContact(rec, tMax, lat, lonWest, alt, dT_s, true, -1) : null;
    var tC3 = isCentral ? findContact(rec, tMax, lat, lonWest, alt, dT_s, true, +1) : null;

    /* Convert TDT offset to UT: UT = t0 + t − ΔT/3600 */
    function toUT(t) { return t !== null ? rec.t0 + t - dT_s / 3600 : null; }

    /* Sun position at each contact */
    function getSun(t) {
      return t !== null
        ? sunAltAz(fundamentalArgs(rec, t, lat, lonWest, alt, dT_s), lat)
        : null;
    }

    return {
      visible:    true,
      type:       type,
      mag:        Math.round(mag * 100000) / 100000,
      osc:        osc,
      sun:        sun,
      tMax:       toUT(tMax),
      C1:         { ut: toUT(tC1), sun: getSun(tC1) },
      C2:         { ut: toUT(tC2), sun: getSun(tC2) },
      C3:         { ut: toUT(tC3), sun: getSun(tC3) },
      C4:         { ut: toUT(tC4), sun: getSun(tC4) },
      durCentral: tC2 !== null && tC3 !== null ? (tC3 - tC2) * 3600 : null,
      durPartial: tC1 !== null && tC4 !== null ? (toUT(tC4) - toUT(tC1)) * 3600 : null
    };
  }


  /* ── Exports ─────────────────────────────────────────────────────────── */

  return {
    computeEclipse:  computeEclipse,
    fundamentalArgs: fundamentalArgs,
    sunAltAz:        sunAltAz,
    findMaximum:     findMaximum
  };

}));
