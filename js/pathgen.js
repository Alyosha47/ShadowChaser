/* pathgen.js — eclipse path generator (JavaScript port of gen_eclipse_paths.py) */
/* pathgen.js — Follow the Shadow — https://followtheshadow.com
 *
 * Computes a solar eclipse's complete path from its Besselian elements, on the
 * device: centreline, umbral limits (N/S), umbral ovals, penumbral limits,
 * sunrise/sunset terminator curves, the maximum-on-horizon ("green") curve and
 * greatest eclipse. The output is the path record the app draws.
 *
 * Method: every limit is the zero contour of a continuous field over the Earth
 * (e.g. "deepest umbral immersion this point ever gets"), traced by one contour
 * tracer; hybrid pinches, horizon ends and grazing limbs fall out of the same
 * method. A JavaScript port of gen_eclipse_paths.py (generator 2026-09-18d),
 * verified against its output for all 11,898 eclipses, then improved.
 *
 *   PathGen.eclipse_path(rec) -> path          (rec: one Besselian record)
 *   PathGen.VERSION                            (bump when output changes: it keys the device cache)
 *
 * Runs in a Web Worker (pathgen-worker.js) or on the main thread.
 */
(function (root) {
'use strict';
var PATHGEN_VERSION = '2026-09-20c';

/* Python's round(x, n): correctly rounded, exact ties to even. */
function pyround(x, n) {
  if (!isFinite(x)) return x;
  var neg = x < 0, a = Math.abs(x), s = a.toFixed(Math.min(100, n + 60));
  var dot = s.indexOf('.'), head = s.slice(0, dot + 1 + n), tail = s.slice(dot + 1 + n);
  var up;
  if (tail[0] > '5') up = true;
  else if (tail[0] < '5') up = false;
  else if (/[1-9]/.test(tail.slice(1))) up = true;
  else { var last = head[head.length - 1]; up = (last === '.' ? +head[head.length - 2] : +last) % 2 === 1; }
  var v = parseFloat(head.endsWith('.') ? head.slice(0, -1) : head);
  if (up) v = parseFloat((v + Math.pow(10, -n)).toFixed(n));
  return neg ? -v : v;
}

function pteq(a, b) { return a[0] === b[0] && a[1] === b[1]; }

/* [lon, lat] list made continuous across the antimeridian and pole-aware */
function unwrap(pts, lat_thresh, lon_jump, pole_lat) {
  if (lat_thresh === undefined) lat_thresh = 80.0;
  if (lon_jump === undefined) lon_jump = 30.0;
  if (pole_lat === undefined) pole_lat = 89.99;
  if (!pts || !pts.length) return [];
  var out = [[pts[0][0], pts[0][1]]], i;
  for (i = 1; i < pts.length; i++) {
    var prev_lon = out[out.length - 1][0], curr_lon = pts[i][0], diff = curr_lon - prev_lon;
    if (diff > 180) curr_lon -= 360; else if (diff < -180) curr_lon += 360;
    out.push([curr_lon, pts[i][1]]);
  }
  var is_closed = out.length >= 2 && pteq(out[0], out[out.length - 1]);
  var body = is_closed ? out.slice(0, -1) : out, transits = {};
  var any = false;
  for (i = 1; i < body.length; i++) {
    var pl1 = body[i - 1][1], pl2 = body[i][1];
    if (Math.abs(pl1) <= lat_thresh || Math.abs(pl2) <= lat_thresh) continue;
    var dlon = body[i][0] - body[i - 1][0];
    if (Math.abs(dlon) <= lon_jump) continue;
    var p1r = pl1 * DEG, p2r = pl2 * DEG, dlr = dlon * DEG;
    var a = Math.pow(Math.sin((p2r - p1r) / 2), 2) + Math.cos(p1r) * Math.cos(p2r) * Math.pow(Math.sin(dlr / 2), 2);
    var gc_deg = 2 * Math.asin(Math.sqrt(clamp(a, 0.0, 1.0))) / DEG;
    if (gc_deg < Math.abs(dlon)) { transits[i] = true; any = true; }
  }
  if (!any) return out;
  var nb = [];
  body.forEach(function (p, j) {
    if (transits[j]) {
      var pl = (body[j - 1][1] + p[1]) > 0 ? pole_lat : -pole_lat;
      nb.push([body[j - 1][0], pl]); nb.push([p[0], pl]);
    }
    nb.push(p);
  });
  if (is_closed && nb.length) nb.push([nb[0][0], nb[0][1]]);
  return nb;
}
/* umbral.js — prototype port of gen_eclipse_paths.py's umbral_limits_field.
   Faithful line-by-line translation; Python semantics made explicit:
   pmod() = Python %, and every tuple/None check spelled out. */

var DEG = Math.PI / 180;
var E2 = 2.0 / 298.257223563 - Math.pow(1.0 / 298.257223563, 2);
var B_A = Math.sqrt(1.0 - E2);
var R_EARTH_M = 6378137.0;
var NIGHT_SIN_ALT = -0.2, UMB_STEP_KM = 10.0, UMB_MAXPTS = 20000, ANCHOR_KM = 5.0;
var STEP_MIN = 1, PEN_N = 720, OVAL_STEP_MIN = 10, TERM_STEP_MIN = 0.1;
var PINCH_HW_KM = 0.05, PINCH_JOIN_KM = 60.0, UMB_MAX_STEP_KM = 30.0;

function pmod(a, n) { var r = a % n; return r < 0 ? r + n : r; }   /* Python % */
function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function stride(arr, k) { var o = []; for (var i = 0; i < arr.length; i += k) o.push(arr[i]); return o; }

/* ── Besselian state ───────────────────────────────────────────────────── */
function bstate(rec, t) {
  var c = rec._bc;
  if (!c) c = rec._bc = [rec.x0, rec.x1, rec.x2, rec.x3, rec.y0, rec.y1, rec.y2, rec.y3,
    rec.d0, rec.d1, rec.d2, rec.mu0, rec.mu1, rec.mu2, rec.l10, rec.l11, rec.l12,
    rec.l20, rec.l21, rec.l22, rec.dt];
  var X = c[0] + c[1] * t + c[2] * t * t + c[3] * t * t * t;
  var Xp = c[1] + 2 * c[2] * t + 3 * c[3] * t * t;
  var Y = c[4] + c[5] * t + c[6] * t * t + c[7] * t * t * t;
  var Yp = c[5] + 2 * c[6] * t + 3 * c[7] * t * t;
  var d_r = (c[8] + c[9] * t + c[10] * t * t) * DEG;
  var mu = c[11] + c[12] * t + c[13] * t * t;
  var L1 = c[14] + c[15] * t + c[16] * t * t;
  var L2 = c[17] + c[18] * t + c[19] * t * t;
  return [X, Xp, Y, Yp, d_r, mu, c[20], L1, L2];
}

/* fundamental plane -> geodetic [lat, lon], or null off the disk */
function f2g(xi, eta, d_r, mu, dt_s) {
  var sin_d = Math.sin(d_r), cos_d = Math.cos(d_r);
  var rho1 = Math.sqrt(1.0 - E2 * cos_d * cos_d);
  var sin_d1 = sin_d / rho1, cos_d1 = Math.sqrt(1.0 - E2) * cos_d / rho1;
  var eta1 = eta / rho1, r2 = xi * xi + eta1 * eta1;
  if (r2 >= 1.0) return null;
  var zeta1 = Math.sqrt(1.0 - r2);
  var s = clamp(eta1 * cos_d1 + zeta1 * sin_d1, -1.0, 1.0);
  var lat_gc = Math.asin(s);
  var lat_gd = Math.atan(Math.tan(lat_gc) / Math.sqrt(1.0 - E2));
  var H = Math.atan2(xi, zeta1 * cos_d1 - eta1 * sin_d1) / DEG;
  var lon = pmod(H - mu + 0.00417807 * dt_s + 180.0, 360.0) - 180.0;
  return [lat_gd / DEG, lon];
}
function centreline_pt(rec, t) { var b = bstate(rec, t); return f2g(b[0], b[2], b[4], b[5], b[6]); }

function fund_true(lat, lon, d_r, mu, dt_s) {
  var H = (mu + lon - 0.00417807 * dt_s) * DEG;
  var u = Math.atan(B_A * Math.tan(lat * DEG));
  var rsp = B_A * Math.sin(u), rcp = Math.cos(u);
  var sin_d = Math.sin(d_r), cos_d = Math.cos(d_r), cos_H = Math.cos(H);
  return [rcp * Math.sin(H), rsp * cos_d - rcp * cos_H * sin_d, rsp * sin_d + rcp * cos_H * cos_d];
}
function sun_sin_alt(lat, lon, d_r, mu, dt_s) {
  var H = (mu + lon - 0.00417807 * dt_s) * DEG, ph = lat * DEG;
  return Math.sin(ph) * Math.sin(d_r) + Math.cos(ph) * Math.cos(H) * Math.cos(d_r);
}
function magnitude_at(rec, lat, lon, t) {
  var b = bstate(rec, t), X = b[0], Y = b[2], d_r = b[4], mu = b[5], dt_s = b[6], L1 = b[7], L2 = b[8];
  if (sun_sin_alt(lat, lon, d_r, mu, dt_s) <= 0) return 0.0;
  var f = fund_true(lat, lon, d_r, mu, dt_s);
  var m = Math.hypot(f[0] - X, f[1] - Y);
  var L1p = L1 - f[2] * rec.tan_f1, L2p = L2 - f[2] * rec.tan_f2;
  if (m >= L1p) return 0.0;
  if (L2p < 0 && m <= -L2p) return 1.0;
  if (L2p > 0 && m <= L2p) return 1.0;
  var denom = L1p + L2p;
  if (Math.abs(denom) < 1e-12) return 0.0;
  return (L1p - m) / denom;
}

/* ── geodesics (points are [lat, lon]) ─────────────────────────────────── */
function gc_step(lat, lon, brg, d_m) {
  var ang = d_m / R_EARTH_M, la = lat * DEG, lo = lon * DEG;
  var sl = Math.sin(la) * Math.cos(ang) + Math.cos(la) * Math.sin(ang) * Math.cos(brg);
  var la2 = Math.asin(clamp(sl, -1.0, 1.0));
  var lo2 = lo + Math.atan2(Math.sin(brg) * Math.sin(ang) * Math.cos(la), Math.cos(ang) - Math.sin(la) * sl);
  return [la2 / DEG, pmod(lo2 / DEG + 180, 360) - 180];
}
function gc_bearing(a, b) {
  var la1 = a[0] * DEG, la2 = b[0] * DEG, dlon = (b[1] - a[1]) * DEG;
  return Math.atan2(Math.sin(dlon) * Math.cos(la2),
    Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlon));
}
function gc_dist(a, b) {
  var la1 = a[0] * DEG, la2 = b[0] * DEG, dla = (b[0] - a[0]) * DEG, dlo = (b[1] - a[1]) * DEG;
  var h = Math.pow(Math.sin(dla / 2), 2) + Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin(dlo / 2), 2);
  return 2 * R_EARTH_M * Math.asin(Math.min(1.0, Math.sqrt(h)));
}

/* ── envelope seeds ────────────────────────────────────────────────────── */
function snap_to_edge(rec, lat, lon, b_out, level, Rs) {
  if (Rs === undefined) Rs = 22000.0;
  var tmin = rec.tmin, tmax = rec.tmax, nC = 40, bt = tmin, bm = -1.0, i, ti, m, s;
  for (i = 0; i <= nC; i++) { ti = tmin + (tmax - tmin) * i / nC; m = magnitude_at(rec, lat, lon, ti); if (m > bm) { bm = m; bt = ti; } }
  var dt = (tmax - tmin) / nC;
  for (i = 0; i < 16; i++) {
    for (s = -1; s <= 1; s += 2) { ti = bt + s * dt / 2; m = magnitude_at(rec, lat, lon, ti); if (m > bm) { bm = m; bt = ti; } }
    dt *= 0.5;
  }
  var tstar = bt;
  function peakmag(la, lo) {
    var H = 0.4, nL = 8, b2 = tstar, bm2 = -1.0, k, tt, mm, sg;
    for (k = 0; k <= nL; k++) { tt = tstar - H + 2.0 * H * k / nL; mm = magnitude_at(rec, la, lo, tt); if (mm > bm2) { bm2 = mm; b2 = tt; } }
    var d2 = 2.0 * H / nL;
    for (k = 0; k < 12; k++) {
      for (sg = -1; sg <= 1; sg += 2) { tt = b2 + sg * d2 / 2; mm = magnitude_at(rec, la, lo, tt); if (mm > bm2) { bm2 = mm; b2 = tt; } }
      d2 *= 0.5;
    }
    return bm2;
  }
  function fval(d) { var p = gc_step(lat, lon, b_out, d); return peakmag(p[0], p[1]) - level; }
  var a, b;
  if (fval(0.0) >= 0.0) { if (fval(Rs) >= 0.0) return [lat, lon]; a = 0.0; b = Rs; }
  else { if (fval(-Rs) < 0.0) return [lat, lon]; a = -Rs; b = 0.0; }
  for (i = 0; i < 18; i++) { var mid = (a + b) / 2; if (fval(mid) >= 0.0) a = mid; else b = mid; }
  return gc_step(lat, lon, b_out, (a + b) / 2);
}

function umbral_pts(rec, t) {
  var bs = bstate(rec, t), X = bs[0], Xp = bs[1], Y = bs[2], Yp = bs[3], d_r = bs[4], mu = bs[5], dt_s = bs[6], L2 = bs[8];
  var cos_d = Math.cos(d_r), rho1 = Math.sqrt(1.0 - E2 * cos_d * cos_d);
  var Cu = X, Cw = Y / rho1, Vu = Xp, Vw = Yp / rho1, sp = Math.hypot(Vu, Vw);
  if (sp < 1e-12) return [null, null];
  var Vhu = Vu / sp, Vhw = Vw / sp, dL2dt = rec.l21 + 2 * rec.l22 * t, LEVEL = 1.0 - 1e-9;
  var cl = f2g(X, Y, d_r, mu, dt_s), out = [];
  [1, -1].forEach(function (side) {
    var z = 1.0 - Cu * Cu - Cw * Cw, zeta = z > 0 ? Math.sqrt(z) : 1e-6;
    var u = null, w = null, nu = null, nw = null, offdisk = false;
    for (var it = 0; it < 16; it++) {
      var q = L2 - zeta * rec.tan_f2, r = Math.abs(q), sgn = q >= 0 ? 1.0 : -1.0;
      var dzdt = (u !== null && zeta > 1e-9) ? -(u * Vu + w * Vw) / zeta : 0.0;
      var drdt = sgn * (dL2dt - rec.tan_f2 * dzdt);
      var cphi = clamp(drdt / sp, -1.0, 1.0), sphi = Math.sqrt(1.0 - cphi * cphi);
      nu = cphi * Vhu + side * sphi * (-Vhw); nw = cphi * Vhw + side * sphi * Vhu;
      u = Cu + r * nu; w = Cw + r * nw;
      var zz = 1.0 - u * u - w * w;
      if (zz <= 0) { offdisk = true; break; }
      zeta = Math.sqrt(zz);
    }
    if (offdisk || u === null) { out.push(null); return; }
    var e = f2g(u, w * rho1, d_r, mu, dt_s);
    if (e === null) { out.push(null); return; }
    var EPSN = 1.0e-4, e_in = f2g(u - EPSN * nu, (w - EPSN * nw) * rho1, d_r, mu, dt_s), b_out;
    if (e_in !== null) b_out = gc_bearing(e_in, e);
    else if (cl !== null) b_out = gc_bearing(cl, e);
    else b_out = gc_bearing([e[0], e[1]], [e[0], e[1] + 0.01]);
    out.push(snap_to_edge(rec, e[0], e[1], b_out, LEVEL));
  });
  return out;
}

/* ── contour tracer ────────────────────────────────────────────────────── */
function trace_zero(field, seed, o) {
  o = o || {};
  var step_km = o.step_km !== undefined ? o.step_km : 30.0, maxpts = o.maxpts !== undefined ? o.maxpts : 3000;
  var min_km = o.min_km !== undefined ? o.min_km : 4.0, max_turn = o.max_turn !== undefined ? o.max_turn : 12.0;
  var width = o.width || null, min_width = o.min_width || null;   /* (la, lo) -> km, or null */
  var side = o.side || null;          /* (la, lo) -> which side of the shadow's track; must not change */
  var tol = o.tol !== undefined ? o.tol : 1e-6, accept = o.accept !== undefined ? o.accept : 2e-5;
  var PROBE = o.probe_m !== undefined ? o.probe_m : 2000.0, pr = PROBE;   /* gradient probe, metres */
  function gc_km(la1, lo1, la2, lo2) {
    var h = Math.pow(Math.sin((la2 - la1) * DEG / 2), 2) + Math.cos(la1 * DEG) * Math.cos(la2 * DEG) * Math.pow(Math.sin((lo2 - lo1) * DEG / 2), 2);
    return 6371.0 * 2.0 * Math.asin(Math.min(1.0, Math.sqrt(Math.abs(h))));
  }
  function gradb(la, lo) {
    var h = pr, p;
    p = gc_step(la, lo, 0.0, h); var fN = field(p[0], p[1]);
    p = gc_step(la, lo, Math.PI, h); var fS = field(p[0], p[1]);
    p = gc_step(la, lo, Math.PI / 2, h); var fE = field(p[0], p[1]);
    p = gc_step(la, lo, -Math.PI / 2, h); var fW = field(p[0], p[1]);
    if (fN === null || fS === null || fE === null || fW === null) return [null, 0.0];
    var gN = (fN - fS) / (2 * h), gE = (fE - fW) / (2 * h);
    return [Math.atan2(gE, gN), Math.hypot(gN, gE)];
  }
  function correct(la, lo) {
    for (var i = 0; i < 14; i++) {
      var f = field(la, lo);
      if (f === null) return [la, lo, false];
      if (Math.abs(f) < tol) return [la, lo, true];
      var bg = gradb(la, lo);
      if (bg[0] === null || bg[1] < 1e-15) return [la, lo, false];
      var p = gc_step(la, lo, bg[0], -f / bg[1]); la = p[0]; lo = p[1];
    }
    var f2 = field(la, lo);
    return [la, lo, f2 !== null && Math.abs(f2) < accept];
  }
  function seg_km(la1, lo1, la2, lo2, p) {
    var c = Math.cos(la1 * DEG) * 111.195;
    function xy(la, lo) { return [(pmod(lo - lo1 + 180.0, 360.0) - 180.0) * c, (la - la1) * 111.195]; }
    var B = xy(la2, lo2), P = xy(p[0], p[1]), L = B[0] * B[0] + B[1] * B[1];
    var u = L > 0 ? clamp((P[0] * B[0] + P[1] * B[1]) / L, 0.0, 1.0) : 0.0;
    return Math.hypot(P[0] - u * B[0], P[1] - u * B[1]);
  }
  function one(sign) {
    var la = seed[0], lo = seed[1], prevb = null, out = [], step = step_km, last = step_km;
    var my_side = side ? side(la, lo) : null;
    if (width) pr = Math.min(PROBE, 250.0 * width(la, lo, 1.0 / R_EARTH_M));
    var closed = false, walked = 0.0, hw = 0;
    for (var k = 0; k < maxpts; k++) {
      var bg = gradb(la, lo), b = bg[0], g = bg[1];
      if (b === null || g < 1e-15) break;
      var tb = b + sign * Math.PI / 2, turn = null;
      if (prevb !== null) {
        turn = Math.abs((pmod(tb - prevb + Math.PI, 2 * Math.PI) - Math.PI) / DEG);
        if (turn > max_turn && step > min_km) step = Math.max(min_km, step * 0.5);
        else if (turn < max_turn * 0.4 && step < step_km) step = Math.min(step_km, step * 1.5);
      }
      if (width) {
        hw = width(la, lo, g);
        if (min_width && hw < min_width(la, lo)) break;         /* beside a hybrid's pinch */
        var cap = 0.3 * hw;
        if (turn) cap = Math.max(cap, Math.sqrt(0.6 * hw * last / (turn * DEG)));
        step = Math.max(0.05, Math.min(step, cap));
        pr = Math.min(PROBE, 250.0 * hw);
      }
      var p2 = gc_step(la, lo, tb, step * 1000.0);
      var cr = correct(p2[0], p2[1]);
      if (!cr[2]) break;
      var la2 = cr[0], lo2 = cr[1];
      /* A step that lands on the other limb is too long for this corridor
         (it narrows during the step, near a pinch): halve it and retry. */
      if (side && side(la2, lo2) !== my_side) {
        if (step <= 0.05) break;
        step = Math.max(0.05, step * 0.5); prevb = null; k--; continue;
      }
      walked += step;
      if (walked > 10.0 * step_km &&
          (width ? seg_km(la, lo, la2, lo2, seed) < Math.min(0.75 * step, 0.5 * hw)
                 : gc_km(la2, lo2, seed[0], seed[1]) < 0.75 * step_km)) { closed = true; break; }
      out.push([lo2, la2]); prevb = tb; la = la2; lo = lo2; last = step;
    }
    return [out, closed];
  }
  var f = one(+1);
  if (f[1]) return [[[seed[1], seed[0]]].concat(f[0]), true];
  var bk = one(-1)[0];
  return [bk.slice().reverse().concat([[seed[1], seed[0]]], f[0]), false];
}

/* ── the umbral depth field ────────────────────────────────────────────── */
function umb_g(rec, lat, lon, t) {
  var b = bstate(rec, t), f = fund_true(lat, lon, b[4], b[5], b[6]);
  return Math.abs(b[8] - f[2] * rec.tan_f2) - Math.hypot(f[0] - b[0], f[1] - b[2]);
}
function umb_depth(rec, lat, lon, t0) {
  var N = 96, tmin = rec.tmin, tmax = rec.tmax, W = (tmax - tmin) / N, bt, i;
  var warm = (t0 !== undefined && t0 !== null);
  if (!warm) {
    bt = tmin; var bg = -1e9;
    for (i = 0; i <= N; i++) { var t = tmin + (tmax - tmin) * i / N, g = umb_g(rec, lat, lon, t); if (g > bg) { bg = g; bt = t; } }
  } else bt = t0;
  var a = Math.max(tmin, bt - W), b = Math.min(tmax, bt + W), a0 = a, b0 = b;
  for (i = 0; i < 40; i++) {
    var m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (umb_g(rec, lat, lon, m1) < umb_g(rec, lat, lon, m2)) a = m1; else b = m2;
  }
  var ts = (a + b) / 2;
  if (warm && ((ts - a0 < 1e-3 * W && a0 > tmin) || (b0 - ts < 1e-3 * W && b0 < tmax)))
    return umb_depth(rec, lat, lon);
  var s = bstate(rec, ts);
  return [umb_g(rec, lat, lon, ts), ts, sun_sin_alt(lat, lon, s[4], s[5], s[6])];
}
function umb_side(rec, lat, lon, ts) {
  var b = bstate(rec, ts), f = fund_true(lat, lon, b[4], b[5], b[6]);
  return ((f[0] - b[0]) * (-b[3]) + (f[1] - b[2]) * b[1]) / (Math.hypot(b[1], b[3]) || 1e-12);
}
function umb_correct(rec, lat, lon) {
  function f(la, lo) { return umb_depth(rec, la, lo)[0]; }
  for (var it = 0; it < 40; it++) {
    var dd = umb_depth(rec, lat, lon), v = dd[0], ts = dd[1];
    if (Math.abs(v) < 1e-10) return [lat, lon];
    var b = bstate(rec, ts);
    var w = Math.abs(b[8] - fund_true(lat, lon, b[4], b[5], b[6])[2] * rec.tan_f2) * R_EARTH_M;
    var H = Math.max(0.05, Math.min(2000.0, 0.25 * w)), p;
    p = gc_step(lat, lon, 0.0, H); var fN = f(p[0], p[1]);
    p = gc_step(lat, lon, Math.PI, H); var fS = f(p[0], p[1]);
    p = gc_step(lat, lon, Math.PI / 2, H); var fE = f(p[0], p[1]);
    p = gc_step(lat, lon, -Math.PI / 2, H); var fW = f(p[0], p[1]);
    var gN = (fN - fS) / (2 * H), gE = (fE - fW) / (2 * H), g2 = gN * gN + gE * gE;
    if (g2 < 1e-30) return null;
    var dist = -v / Math.sqrt(g2);
    if (Math.abs(dist) > 500e3) return null;
    if (w > 0) dist = clamp(dist, -0.5 * w, 0.5 * w);
    p = gc_step(lat, lon, Math.atan2(gE, gN), dist); lat = p[0]; lon = p[1];
  }
  return Math.abs(f(lat, lon)) < 1e-9 ? [lat, lon] : null;
}

function umbral_limits_valid(north, south, two_limit) {
  if (two_limit && !(north.length && south.length)) return false;
  var all = north.concat(south);
  for (var i = 0; i < all.length; i++)
    for (var j = 1; j < all[i].length; j++) {
      var p = all[i][j - 1], q = all[i][j];
      if (gc_dist([p[1], p[0]], [q[1], q[0]]) > UMB_MAX_STEP_KM * 1e3) return false;
    }
  return true;
}

function drop_retraced(arcs) {
  var tol_km = 1.0, frac = 0.9;
  function v(lon, lat) { return [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function ang(a, b) { return Math.acos(clamp(dot(a, b), -1.0, 1.0)); }
  function seg_km(P, A, B) {
    var n = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]], nn = Math.sqrt(dot(n, n));
    if (nn < 1e-15) return 6371.0 * Math.min(ang(P, A), ang(P, B));
    var xt = Math.asin(clamp(dot(P, n) / nn, -1.0, 1.0)), ab = ang(A, B), c = Math.max(1e-15, Math.cos(xt));
    if (Math.acos(clamp(Math.cos(ang(P, A)) / c, -1.0, 1.0)) <= ab && Math.acos(clamp(Math.cos(ang(P, B)) / c, -1.0, 1.0)) <= ab)
      return 6371.0 * Math.abs(xt);
    return 6371.0 * Math.min(ang(P, A), ang(P, B));
  }
  var keep = [];
  var sorted = arcs.map(function (a, i) { return [a, i]; })
    .sort(function (x, y) { return y[0].length - x[0].length || x[1] - y[1]; }).map(function (x) { return x[0]; });
  sorted.forEach(function (a) {
    var smp = stride(a, Math.max(1, Math.floor(a.length / 30))).map(function (p) { return v(p[0], p[1]); }), dup = false;
    for (var ki = 0; ki < keep.length && !dup; ki++) {
      var kv = keep[ki].map(function (p) { return v(p[0], p[1]); }), near = 0;
      smp.forEach(function (P) {
        var best = Infinity;
        for (var m = 0; m < kv.length - 1; m++) best = Math.min(best, seg_km(P, kv[m], kv[m + 1]));
        if (best < tol_km) near++;
      });
      if (near >= frac * smp.length) dup = true;
    }
    if (!dup) keep.push(a);
  });
  return keep;
}

function umb_deep_pt(rec, t) {
  var b = bstate(rec, t), d_r = b[4], rho1 = Math.sqrt(1.0 - E2 * Math.pow(Math.cos(d_r), 2));
  var u = b[0], w = b[2] / rho1, m = Math.hypot(u, w), k = m > 0 ? Math.min(1.0, (1.0 - 1e-9) / m) : 1.0;
  return f2g(u * k, w * k * rho1, d_r, b[5], b[6]);
}
function umb_march_seeds(rec, n_seed) {
  var n_scan = 2000, max_km = 3000.0, tmin = rec.tmin, tmax = rec.tmax, dt = (tmax - tmin) / n_scan, inside = [], i;
  for (i = 0; i <= n_scan; i++) {
    var t = tmin + dt * i, p = umb_deep_pt(rec, t);
    if (p && umb_g(rec, p[0], p[1], t) > 0) inside.push([t, p]);
  }
  var out = [];
  stride(inside, Math.max(1, Math.floor(inside.length / n_seed))).forEach(function (tp) {
    var t = tp[0], p = tp[1], a = umb_deep_pt(rec, t - dt), b = umb_deep_pt(rec, t + dt);
    if (!(a && b)) return;
    var brg = gc_bearing(a, b);
    [1, -1].forEach(function (side) {
      var bb = brg + side * Math.PI / 2, lo = 0.0, hi = null, d = 2e3, q, r;
      while (d <= max_km * 1e3) {
        q = gc_step(p[0], p[1], bb, d); r = umb_depth(rec, q[0], q[1]);
        if (r[2] <= NIGHT_SIN_ALT) break;
        if (r[0] < 0) { hi = d; break; }
        lo = d; d *= 2;
      }
      if (hi === null) return;
      while (hi - lo > 1.0) {
        var m = (lo + hi) / 2; q = gc_step(p[0], p[1], bb, m);
        if (umb_depth(rec, q[0], q[1])[0] > 0) lo = m; else hi = m;
      }
      out.push(gc_step(p[0], p[1], bb, lo));
    });
  });
  return out;
}
function umb_pinches(rec) {
  var n_scan = 2000, tmin = rec.tmin, tmax = rec.tmax;
  function q(t) {
    var b = bstate(rec, t), p = f2g(b[0], b[2], b[4], b[5], b[6]);
    if (p === null) return [null, null];
    return [b[8] - fund_true(p[0], p[1], b[4], b[5], b[6])[2] * rec.tan_f2, p];
  }
  var out = [], prev = null;
  for (var i = 0; i <= n_scan; i++) {
    var t = tmin + (tmax - tmin) * i / n_scan, r = q(t), v = r[0];
    if (v !== null && prev !== null && (v > 0) !== (prev[0] > 0)) {
      var a = prev[1], b = t, va = prev[0];
      for (var k = 0; k < 50; k++) {
        var m = (a + b) / 2, rm = q(m);
        if (rm[0] === null) break;
        if ((rm[0] > 0) === (va > 0)) { a = m; va = rm[0]; } else b = m;
      }
      var tp = (a + b) / 2, pp = q(tp)[1];
      if (pp !== null) out.push([pp[0], pp[1], tp]);
    }
    prev = v !== null ? [v, t] : null;
  }
  return out;
}

/* ── umbral_limits_field ───────────────────────────────────────────────── */
function umbral_limits_field(rec) {
  var step_km = UMB_STEP_KM, n_seed_times = 48, tmin = rec.tmin, tmax = rec.tmax, seeds = [], i;
  for (i = 0; i <= n_seed_times; i++) {
    var np = umbral_pts(rec, tmin + (tmax - tmin) * i / n_seed_times);
    if (np[0] !== null) seeds.push(np[0]);
    if (np[1] !== null) seeds.push(np[1]);
  }
  seeds = seeds.concat(umb_march_seeds(rec, n_seed_times));
  var st = { a: null, t: null };
  function field(la, lo) {
    var r;
    if (st.a === null || gc_dist(st.a, [la, lo]) > ANCHOR_KM * 1e3) { r = umb_depth(rec, la, lo); st.a = [la, lo]; st.t = r[1]; }
    else r = umb_depth(rec, la, lo, st.t);
    return r[2] > NIGHT_SIN_ALT ? r[0] : null;
  }
  function width(la, lo, g) {
    var ts = umb_depth(rec, la, lo, st.t)[1], b = bstate(rec, ts), z = fund_true(la, lo, b[4], b[5], b[6])[2];
    return Math.abs(b[8] - z * rec.tan_f2) / g / 1000.0;
  }
  var pinches = umb_pinches(rec), comps = [], sides = {};
  /* Where a corridor thinner than PINCH_HW_KM ends the trace: beside a pinch,
     where it truly closes (the limb is then joined to the pinch point), and
     below the horizon, where nothing is drawn. A sunlit thin corridor is traced
     to its end: a near-hybrid total narrows to tens of metres at the horizon
     without closing, and stopping there left its limits short of the horizon
     (985-07-20: 4 km); tracing on into the night crawled for 20,000 steps. */
  function near_pinch_width(la, lo) {
    for (var i = 0; i < pinches.length; i++)
      if (gc_dist([la, lo], [pinches[i][0], pinches[i][1]]) < PINCH_JOIN_KM * 1e3) return PINCH_HW_KM;
    return umb_depth(rec, la, lo, st.t)[2] <= 0 ? PINCH_HW_KM : 0.0;
  }
  function side_at(la, lo) { var ts = umb_depth(rec, la, lo)[1]; return umb_side(rec, la, lo, ts) > 0; }
  function side_here(la, lo) { var ts = umb_depth(rec, la, lo, st.t)[1]; return umb_side(rec, la, lo, ts) > 0; }
  function traced(la, lo, d_m) {
    var near = [];
    comps.forEach(function (cc, k) { cc[0].forEach(function (q, j) { near.push([gc_dist([la, lo], [q[1], q[0]]), k, j]); }); });
    near.sort(function (x, y) { return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
    near = near.filter(function (x) { return x[0] < d_m; });
    if (!near.length) return false;
    var me = side_at(la, lo);
    for (var n = 0; n < near.length; n++) {
      var key = near[n][1] + ',' + near[n][2];
      if (!(key in sides)) { var q = comps[near[n][1]][0][near[n][2]]; sides[key] = side_at(q[1], q[0]); }
      if (sides[key] === me) return true;
    }
    return false;
  }
  seeds.forEach(function (sd) {
    if (traced(sd[0], sd[1], 60e3)) return;
    var c = umb_correct(rec, sd[0], sd[1]);
    if (c === null || traced(c[0], c[1], 3 * step_km * 1e3)) return;
    st.a = null;
    var tr = trace_zero(field, c, { step_km: step_km, min_km: 1.0, maxpts: UMB_MAXPTS, width: width,
      min_width: near_pinch_width, side: side_here, tol: 1e-10, accept: 1e-9 });
    if (tr[0].length >= 3) comps.push(tr);
  });

  var north = [], south = [];
  comps.forEach(function (cp) {
    var pts = cp[0], closed = cp[1], n = pts.length;
    var info = pts.map(function (p) { return umb_depth(rec, p[1], p[0]); });
    var lab = pts.map(function (p, j) { return [info[j][2] > 0, umb_side(rec, p[1], p[0], info[j][1]) > 0]; });
    function same(x, y) { return x[0] === y[0] && x[1] === y[1]; }
    var brk = [], j;
    for (j = 0; j < n; j++) if ((closed || j > 0) && !same(lab[j], lab[pmod(j - 1, n)])) brk.push(j);
    var runs = [];
    if (!brk.length) { var all = []; for (j = 0; j < n; j++) all.push(j); runs = [all]; }
    else if (closed) {
      for (var bi = 0; bi < brk.length; bi++) {
        var a = brk[bi], b = bi + 1 < brk.length ? brk[bi + 1] : brk[0] + n, r = [];
        for (j = a; j < b; j++) r.push(pmod(j, n));
        runs.push(r);
      }
    } else {
      var cuts = [0].concat(brk, [n]);
      for (var ci = 0; ci + 1 < cuts.length; ci++) { var rr = []; for (j = cuts[ci]; j < cuts[ci + 1]; j++) rr.push(j); runs.push(rr); }
    }
    function lab_at(lat, lon) { var d = umb_depth(rec, lat, lon); return [d[2] > 0, umb_side(rec, lat, lon, d[1]) > 0]; }
    function refine(j_in, j_out) {
      var A = [pts[j_in][1], pts[j_in][0]], B = [pts[j_out][1], pts[j_out][0]], L = lab[j_in];
      for (var k = 0; k < 30; k++) {
        var d = gc_dist(A, B);
        if (d < 1.0) break;
        var m = gc_step(A[0], A[1], gc_bearing(A, B), d / 2), c = umb_correct(rec, m[0], m[1]);
        if (c && gc_dist(c, m) <= d / 2) m = c;
        if (same(lab_at(m[0], m[1]), L)) A = m; else B = m;
      }
      return [A[1], A[0]];
    }
    runs.forEach(function (r) {
      if (r.length < 3 || !lab[r[0]][0]) return;
      var arc = r.map(function (k) { return pts[k]; });
      if (brk.length && (closed || r[0] > 0)) arc = [refine(r[0], pmod(r[0] - 1, n))].concat(arc);
      if (brk.length && (closed || r[r.length - 1] < n - 1)) arc = arc.concat([refine(r[r.length - 1], pmod(r[r.length - 1] + 1, n))]);
      if (info[r[0]][1] > info[r[r.length - 1]][1]) arc = arc.reverse();
      (lab[r[0]][1] ? north : south).push(arc);
    });
  });

  /* A limb that stopped beside a pinch (PINCH_HW_KM) is continued to it along
     the centreline: in that zone the limb is within PINCH_HW_KM of it, closing
     to 0 at the pinch. Both limbs reaching a pinch from the same side use the
     SAME centreline points (a fixed ~2 km grid from the pinch), so there they
     coincide exactly; sampled separately, two chords of one curve crossed. */
  var FILL_KM = 2.0;
  function pinch_fill(pl, po, tp, te) {
    var dir = te > tp ? 1 : -1, c0 = centreline_pt(rec, tp), c1 = centreline_pt(rec, tp + dir * 1e-4);
    if (!c0 || !c1) return [];
    var dt = dir * 1e-4 * FILL_KM * 1e3 / Math.max(1.0, gc_dist(c0, c1)), out = [];
    for (var t = tp + dt; (t - te) * dir < 0; t += dt) { var c = centreline_pt(rec, t); if (c) out.push([c[1], c[0]]); }
    return out;                                   /* ordered away from the pinch */
  }
  north.concat(south).forEach(function (arc) {
    [0, -1].forEach(function (k) {
      var e = k === 0 ? arc[0] : arc[arc.length - 1], lo = e[0], la = e[1];
      for (var pi = 0; pi < pinches.length; pi++) {
        var pl = pinches[pi][0], po = pinches[pi][1], tp = pinches[pi][2], d = gc_dist([la, lo], [pl, po]);
        if (d <= 1.0) { if (k === 0) arc[0] = [po, pl]; else arc[arc.length - 1] = [po, pl]; break; }  /* snap */
        if (d < PINCH_JOIN_KM * 1e3) {
          var fill = pinch_fill(pl, po, tp, umb_depth(rec, la, lo)[1]).reverse();   /* toward the pinch */
          fill.push([po, pl]);
          if (k === 0) Array.prototype.unshift.apply(arc, fill.reverse());
          else Array.prototype.push.apply(arc, fill);
          break;
        }
      }
    });
  });
  return [drop_retraced(north), drop_retraced(south)];
}


/* ── Maximum-on-Horizon ("green") curve ────────────────────────────────── */
function green_curve(rec) {
  var tmin = rec.tmin, tmax = rec.tmax;
  function field(lat, lon) {
    function adz(t) {
      var b = bstate(rec, t), f = fund_true(lat, lon, b[4], b[5], b[6]);
      return [Math.hypot(f[0] - b[0], f[1] - b[2]), sun_sin_alt(lat, lon, b[4], b[5], b[6])];
    }
    var N = 44, bt = tmin, bd = 1e18, i;
    for (i = 0; i <= N; i++) { var t = tmin + (tmax - tmin) * i / N, r = adz(t); if (r[0] < bd) { bd = r[0]; bt = t; } }
    var a = Math.max(tmin, bt - (tmax - tmin) / N), b = Math.min(tmax, bt + (tmax - tmin) / N), bz = -1.0, bdist = bd;
    for (i = 0; i < 26; i++) {
      var m1 = a + (b - a) / 3, m2 = b - (b - a) / 3, r1 = adz(m1), r2 = adz(m2);
      if (r1[0] < r2[0]) { b = m2; bz = r1[1]; bdist = r1[0]; }
      else { a = m1; bz = r2[1]; bdist = r2[0]; }
    }
    return [Math.asin(clamp(bz, -1.0, 1.0)) / DEG, bdist, (a + b) / 2];
  }
  /* inside the penumbra at its moment of maximum: this point sees an eclipse at all */
  function seen(lat, lon) {
    var f = field(lat, lon), b = bstate(rec, f[2]), z = fund_true(lat, lon, b[4], b[5], b[6])[2];
    return f[1] < b[7] - z * rec.tan_f1;
  }
  function grad(lat, lon) {
    var h = 0.02;
    return [(field(lat + h, lon)[0] - field(lat - h, lon)[0]) / (2 * h),
            (field(lat, lon + h)[0] - field(lat, lon - h)[0]) / (2 * h)];
  }
  function correct(lat, lon, tight) {
    /* The target is the sun's altitude in degrees at the point's own maximum:
       0.003 deg is ~330 m on the ground near the horizon, which is what this
       curve used to sit from Jubier's. */
    var goal = tight ? 1e-6 : 1e-5;
    for (var i = 0; i < (tight ? 40 : 25); i++) {
      var f = field(lat, lon)[0];
      if (Math.abs(f) < goal) return [lat, lon, true];
      var g = grad(lat, lon), g2 = g[0] * g[0] + g[1] * g[1];
      if (g2 < 1e-12) return [lat, lon, false];
      lat -= f * g[0] / g2; lon -= f * g[1] / g2;
    }
    return [lat, lon, Math.abs(field(lat, lon)[0]) < 1e-4];
  }
  function trace(seed) {
    var step_km = 20.0, maxpts = 8000;    /* 35 km chords bowed ~110 m off the curve */
    function one_dir(sign) {
      var la = seed[0], lo = seed[1], prevb = null, out = [];
      for (var k = 0; k < maxpts; k++) {
        var g = grad(la, lo), gn = Math.hypot(g[0], g[1]);
        if (gn < 1e-9) break;
        var klon = Math.cos(la * DEG) || 1e-9;
        var tla = -g[1], tlo = g[0], tn = Math.hypot(tla, tlo * klon);
        tla /= tn; tlo /= tn;
        var b = Math.atan2(tlo * klon, tla);
        if (prevb !== null && Math.abs(pmod(b - prevb + Math.PI, 2 * Math.PI) - Math.PI) > Math.PI / 2) {
          tla = -tla; tlo = -tlo; b = b + Math.PI;
        }
        var c = correct(la + sign * step_km / 111.0 * tla, lo + sign * step_km / 111.0 * tlo);
        if (!c[2]) break;
        var la2 = c[0], lo2 = c[1];
        if (!seen(la2, lo2)) {
          /* The curve ends where the eclipse stops being seen at all: on the
             penumbral limit at the horizon, the same point where the limit and
             the sunrise/sunset curve meet. Bisect onto it, each trial pulled back
             onto the curve. (Stopping at a fixed radius one step out overshot
             by 4-85 km: 2017-08-21.) */
          var A = [la, lo], B = [la2, lo2];
          for (var it = 0; it < 30; it++) {
            var mc = correct((A[0] + B[0]) / 2, A[1] + (pmod(B[1] - A[1] + 180, 360) - 180) / 2, true);
            if (!mc[2]) break;
            if (seen(mc[0], mc[1])) A = [mc[0], mc[1]]; else B = [mc[0], mc[1]];
          }
          if (A[0] !== la || A[1] !== lo) out.push([A[1], A[0]]);
          break;
        }
        out.push([lo2, la2]); prevb = b; la = la2; lo = lo2;
        if (out.length > 5 && Math.abs(la2 - seed[0]) < 0.4 && Math.abs(pmod(lo2 - seed[1] + 180, 360) - 180) < 0.4) break;
      }
      return out;
    }
    var fwd = one_dir(+1), bwd = one_dir(-1);
    return bwd.reverse().concat([[seed[1], seed[0]]], fwd);
  }
  var seeds = [];
  for (var lat = -85; lat < 86; lat += 3) {
    var prev = null, prevok = false;
    for (var lon = -180; lon < 181; lon += 3) {
      var fr = field(lat, lon), a = fr[0], ok = fr[1] < 0.6;
      if (prev !== null && prevok && ok && (prev >= 0) !== (a >= 0)) {
        var c = correct(lat, lon - 1.5);
        if (c[2]) seeds.push([c[0], c[1]]);
      }
      prev = a; prevok = ok;
    }
  }
  var comps = [];
  function near_existing(pt) {
    for (var i = 0; i < comps.length; i++)
      for (var j = 0; j < comps[i].length; j++) {
        var q = comps[i][j];
        if (Math.abs(q[1] - pt[0]) < 1.5 && Math.abs(pmod(q[0] - pt[1] + 180, 360) - 180) < 1.5) return true;
      }
    return false;
  }
  seeds.forEach(function (sd) {
    if (near_existing(sd)) return;
    var comp = trace(sd);
    if (comp.length >= 3) comps.push(comp);
  });
  var out = [];
  comps.forEach(function (comp, k) {
    if (k) out.push(null);
    comp.forEach(function (p) { out.push([pmod(p[0] + 180.0, 360.0) - 180.0, p[1]]); });
  });
  return out;
}

/* ── Penumbral limits: the walker (supplies first/last contact times and
      the seeds) and the implicit-field refinement ─────────────────────────── */
function pen_perp_pt(rec, t, side) {
  var b = bstate(rec, t), X = b[0], Xp = b[1], Y = b[2], Yp = b[3], L1 = b[7];
  var speed = Math.sqrt(Xp * Xp + Yp * Yp);
  if (speed < 1e-9) return null;
  var px = -Yp / speed, py = Xp / speed;
  return side === 'n' ? f2g(X + L1 * px, Y + L1 * py, b[4], b[5], b[6]) : f2g(X - L1 * px, Y - L1 * py, b[4], b[5], b[6]);
}
function l1_limb_pt_for_side(rec, t, side) {
  var b = bstate(rec, t), X = b[0], Xp = b[1], Y = b[2], Yp = b[3], L1 = b[7];
  var speed = Math.sqrt(Xp * Xp + Yp * Yp);
  if (speed < 1e-9) return null;
  var px = -Yp / speed, py = Xp / speed;
  var tx = side === 'n' ? X + L1 * px : X - L1 * px, ty = side === 'n' ? Y + L1 * py : Y - L1 * py;
  var d = Math.sqrt(X * X + Y * Y);
  if (d < 1e-9) return null;
  var a = (1.0 - L1 * L1 + d * d) / (2 * d), disc = 1.0 - a * a;
  if (disc < 0) return null;
  var h = Math.sqrt(disc), p2x = a * X / d, p2y = a * Y / d;
  var cands = [[p2x + h * (Y / d), p2y - h * (X / d)], [p2x - h * (Y / d), p2y + h * (X / d)]];
  var best_pt = null, best_d = 1e18;
  cands.forEach(function (c) {
    var d2 = Math.pow(c[0] - tx, 2) + Math.pow(c[1] - ty, 2);
    if (d2 < best_d) { best_d = d2; best_pt = f2g(c[0] * 0.9999999, c[1] * 0.9999999, b[4], b[5], b[6]); }
  });
  return best_pt;
}
function penumbral_limits(rec, step_min) {
  if (step_min === undefined) step_min = STEP_MIN;
  var tmin = rec.tmin, tmax = rec.tmax, step = step_min / 60.0;
  var DT_MIN = 1.0 / 3600.0, DT_MAX = step, MAX_KM = 30.0, MIN_KM = 10.0, EARTH_R = 6371.0;
  function gc_km(p, q) {
    if (p === null || q === null) return null;
    var p1 = p[0] * DEG, p2 = q[0] * DEG, dl = (q[1] - p[1]) * DEG;
    var a = Math.pow(Math.sin((p2 - p1) / 2), 2) + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin(dl / 2), 2);
    return EARTH_R * 2 * Math.asin(Math.sqrt(clamp(a, 0.0, 1.0)));
  }
  function find_first_on(side, t_lo, t_hi) {
    var scan = t_lo, prev_ok = false;
    while (scan <= t_hi + 1e-9) {
      var ok = pen_perp_pt(rec, scan, side) !== null;
      if (ok) {
        if (prev_ok || scan <= t_lo + 1e-9) return scan;
        var t_out = scan - step, t_in = scan;
        for (var i = 0; i < 40; i++) {
          var tm = 0.5 * (t_out + t_in);
          if (pen_perp_pt(rec, tm, side) !== null) t_in = tm; else t_out = tm;
          if (t_in - t_out < 1e-7) break;
        }
        return t_in;
      }
      prev_ok = ok; scan += step;
    }
    return null;
  }
  function find_last_on(side, t_lo, t_hi) {
    var scan = t_hi;
    while (scan >= t_lo - 1e-9) {
      if (pen_perp_pt(rec, scan, side) !== null) {
        var t_in = scan, t_out = scan + step;
        for (var i = 0; i < 40; i++) {
          var tm = 0.5 * (t_in + t_out);
          if (pen_perp_pt(rec, tm, side) !== null) t_in = tm; else t_out = tm;
          if (t_out - t_in < 1e-7) break;
        }
        return t_in;
      }
      scan -= step;
    }
    return null;
  }
  function adaptive_walk(t_start, t_end, side) {
    var out = [], p0 = pen_perp_pt(rec, t_start, side);
    if (p0 === null) return out;
    out.push(p0);
    var t_cur = t_start, dt = DT_MAX, SAFETY = 100000, iters = 0;
    while (t_cur < t_end - 1e-9 && iters < SAFETY) {
      iters++;
      var t_next = Math.min(t_cur + dt, t_end), p_next = pen_perp_pt(rec, t_next, side);
      if (p_next === null) { dt = Math.max(DT_MIN, dt * 0.5); if (dt <= DT_MIN + 1e-12) break; continue; }
      var d = gc_km(out[out.length - 1], p_next);
      if (d > MAX_KM && dt > DT_MIN + 1e-12) { dt = Math.max(DT_MIN, dt * 0.5); continue; }
      out.push(p_next); t_cur = t_next;
      if (d < MIN_KM && dt < DT_MAX) dt = Math.min(DT_MAX, dt * 2.0);
    }
    return out;
  }
  function build_side(side) {
    var t_a = find_first_on(side, tmin, tmax);
    if (t_a === null) return [[], null, null];
    var t_b = find_last_on(side, t_a, tmax);
    if (t_b === null || t_b <= t_a + 1e-9) return [[], null, null];
    var pts = adaptive_walk(t_a, t_b, side);
    if (!pts.length) return [[], t_a, t_b];
    var out = [], lp;
    if (t_a > tmin + 1e-9) { lp = l1_limb_pt_for_side(rec, t_a, side); if (lp) out.push([pyround(lp[1], 4), pyround(lp[0], 4)]); }
    pts.forEach(function (p) { out.push([pyround(p[1], 4), pyround(p[0], 4)]); });
    if (t_b < tmax - 1e-9) { lp = l1_limb_pt_for_side(rec, t_b, side); if (lp) out.push([pyround(lp[1], 4), pyround(lp[0], 4)]); }
    return [out, t_a, t_b];
  }
  var N = build_side('n'), S = build_side('s');
  var ts = [N[1], S[1]].filter(function (t) { return t !== null; }), te = [N[2], S[2]].filter(function (t) { return t !== null; });
  return [N[0], S[0], ts.length ? Math.min.apply(null, ts) : null, te.length ? Math.max.apply(null, te) : null];
}

function pen_g(rec, lat, lon, t) {
  var b = bstate(rec, t), f = fund_true(lat, lon, b[4], b[5], b[6]);
  return [(b[7] - f[2] * rec.tan_f1) - Math.hypot(f[0] - b[0], f[1] - b[2]), sun_sin_alt(lat, lon, b[4], b[5], b[6])];
}
function pen_depth(rec, lat, lon) {
  var tmin = rec.tmin, tmax = rec.tmax, N = 48, bt = tmin, bg = -1e9, i;
  for (i = 0; i <= N; i++) { var t = tmin + (tmax - tmin) * i / N, gg = pen_g(rec, lat, lon, t)[0]; if (gg > bg) { bg = gg; bt = t; } }
  var a = Math.max(tmin, bt - (tmax - tmin) / N), b = Math.min(tmax, bt + (tmax - tmin) / N);
  for (i = 0; i < 36; i++) {
    var m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
    if (pen_g(rec, lat, lon, m1)[0] < pen_g(rec, lat, lon, m2)[0]) a = m1; else b = m2;
  }
  var tstar = (a + b) / 2, r = pen_g(rec, lat, lon, tstar);
  return [r[0], tstar, r[1]];
}
function pen_grad(rec, lat, lon) {
  var h = 0.04;
  return [(pen_depth(rec, lat + h, lon)[0] - pen_depth(rec, lat - h, lon)[0]) / (2 * h),
          (pen_depth(rec, lat, lon + h)[0] - pen_depth(rec, lat, lon - h)[0]) / (2 * h)];
}
function pen_correct(rec, lat, lon) {
  for (var i = 0; i < 14; i++) {
    var f = pen_depth(rec, lat, lon)[0];
    if (Math.abs(f) < 1e-6) return [lat, lon, true];
    var g = pen_grad(rec, lat, lon), g2 = g[0] * g[0] + g[1] * g[1];
    if (g2 < 1e-16) return [lat, lon, false];
    lat -= f * g[0] / g2; lon -= f * g[1] / g2;
  }
  return [lat, lon, Math.abs(pen_depth(rec, lat, lon)[0]) < 2e-5];
}

function penumbral_limits_field(rec, pn_old, ps_old) {
  var ge_lat = rec.lat_dd_ge, ge_lon = rec.lng_dd_ge;
  if (ge_lat === undefined || ge_lat === null || ge_lon === undefined || ge_lon === null) return [pn_old, ps_old];
  var seeds = [], i, c;
  [pn_old, ps_old].forEach(function (old) {
    if (old && old.length >= 3) {
      var m = old[Math.floor(old.length / 2)], r = pen_correct(rec, m[1], m[0]);
      if (r[2]) seeds.push([r[0], r[1]]);
    }
  });
  var prev = null;
  for (i = 0; i < 181; i++) {
    var la = -90.0 + i * 1.0, d = pen_depth(rec, la, ge_lon)[0];
    if (prev !== null && (prev >= 0.0) !== (d >= 0.0)) { c = pen_correct(rec, la - 0.5, ge_lon); if (c[2]) seeds.push([c[0], c[1]]); }
    prev = d;
  }
  if (!seeds.length) return [pn_old, ps_old];
  var comps = [];
  function nearAny(la, lo, tol) {
    for (var a = 0; a < comps.length; a++) for (var b = 0; b < comps[a].length; b++) {
      var q = comps[a][b];
      if (Math.abs(q[1] - la) < tol && Math.abs(pmod(q[0] - lo + 180, 360) - 180) < tol) return true;
    }
    return false;
  }
  function dup(pts) {
    var near = 0, samp = stride(pts, Math.max(1, Math.floor(pts.length / 12)));
    samp.forEach(function (q) {
      for (var a = 0; a < comps.length; a++) for (var b = 0; b < comps[a].length; b++) {
        var v = comps[a][b];
        if (Math.abs(v[1] - q[1]) < 0.7 && Math.abs(pmod(v[0] - q[0] + 180, 360) - 180) < 0.7) { near++; return; }
      }
    });
    return near * 2 > samp.length;
  }
  seeds.forEach(function (sd) {
    if (nearAny(sd[0], sd[1], 0.6)) return;
    var tr = trace_zero(function (la, lo) { return pen_depth(rec, la, lo)[0]; }, sd);
    if (tr[0].length >= 8 && tr[1] && !dup(tr[0])) comps.push(tr[0]);
  });
  if (!comps.length) return [pn_old, ps_old];
  function circ(lon, lat) {
    var pd = pen_depth(rec, lat, lon), tstar = pd[1], zeta = pd[2];
    var b = bstate(rec, tstar), f = fund_true(lat, lon, b[4], b[5], b[6]);
    var sp = Math.hypot(b[1], b[3]) || 1e-12;
    return [tstar, zeta > 0.0, ((f[0] - b[0]) * (-b[3]) + (f[1] - b[2]) * b[1]) / sp > 0.0];
  }
  function gc_mid(A, B) {
    var brg = gc_bearing(A, B), dla = (B[0] - A[0]) * DEG, dlo = (B[1] - A[1]) * DEG;
    var h = Math.pow(Math.sin(dla / 2), 2) + Math.cos(A[0] * DEG) * Math.cos(B[0] * DEG) * Math.pow(Math.sin(dlo / 2), 2);
    var d = 2.0 * R_EARTH_M * Math.asin(Math.min(1.0, Math.sqrt(Math.abs(h))));
    return gc_step(A[0], A[1], brg, d / 2.0);
  }
  var arcs = [];
  comps.forEach(function (pts) {
    var cc = pts.map(function (p) { return circ(p[0], p[1]); }), n = pts.length;
    var vis = cc.map(function (x) { return x[1]; });
    var allv = vis.every(Boolean), anyv = vis.some(Boolean), runs = [], j;
    if (allv) { var r0 = []; for (j = 0; j < n; j++) r0.push(j); runs = [r0]; }
    else if (!anyv) return;
    else {
      var st = 0;
      while (vis[pmod(st - 1, n)]) st++;
      for (var k = 0; k < n; k++) {
        j = pmod(st + k, n);
        if (vis[j]) { if (!runs.length || !vis[pmod(j - 1, n)]) runs.push([]); runs[runs.length - 1].push(j); }
      }
    }
    function edge_refine(j_lit, j_dark) {
      var A = [pts[j_lit][1], pts[j_lit][0]], B = [pts[j_dark][1], pts[j_dark][0]];
      for (var it = 0; it < 14; it++) {
        var m = gc_mid(A, B), r = pen_correct(rec, m[0], m[1]);
        if (!r[2]) break;
        if (pen_depth(rec, r[0], r[1])[2] > 0.0) A = [r[0], r[1]]; else B = [r[0], r[1]];
      }
      return A;
    }
    runs.forEach(function (run) {
      if (run.length < 5) return;
      var arc = run.map(function (q) { return [pts[q][1], pts[q][0]]; });
      if (!allv) arc = [edge_refine(run[0], pmod(run[0] - 1, n))].concat(arc, [edge_refine(run[run.length - 1], pmod(run[run.length - 1] + 1, n))]);
      if (cc[run[0]][0] > cc[run[run.length - 1]][0]) arc = arc.reverse();
      var nv = run.filter(function (q) { return cc[q][2]; }).length;
      arcs.push([nv * 2 > run.length, arc]);
    });
  });
  function fmt(arc) { return arc.map(function (p) { return [pyround(p[1], 4), pyround(p[0], 4)]; }); }
  var new_n = arcs.filter(function (a) { return a[0]; }).map(function (a) { return a[1]; });
  var new_s = arcs.filter(function (a) { return !a[0]; }).map(function (a) { return a[1]; });
  var pn = new_n.length === 1 ? fmt(new_n[0]) : pn_old, ps = new_s.length === 1 ? fmt(new_s[0]) : ps_old;
  if (pn_old && pn_old.length && !new_n.length) pn = pn_old;
  if (ps_old && ps_old.length && !new_s.length) ps = ps_old;
  return [pn, ps];
}
function penumbra_both(rec) {           /* test helper: exactly build_path's sequence */
  var w = penumbral_limits(rec), f = penumbral_limits_field(rec, w[0], w[1]);
  return [f[0], f[1], w[2], w[3]];
}

function term_crossings_at(rec, t) {
  var b = bstate(rec, t), X = b[0], Y = b[2], L1 = b[7], D2 = X * X + Y * Y;
  if (D2 < 1e-18) return null;
  var D = Math.sqrt(D2), k = (D2 + 1.0 - L1 * L1) * 0.5, kd = k / D;
  if (Math.abs(kd) > 1.0) return null;
  var h = Math.sqrt(Math.max(0.0, 1.0 - kd * kd)), cx = X / D, cy = Y / D, nx = -Y / D, ny = X / D;
  return [cx * kd + nx * h, cy * kd + ny * h, cx * kd - nx * h, cy * kd - ny * h, X, Y, b[4], b[5], b[6], L1];
}
function insert_rs_junctions(rec, term_first, term_last, junctions) {
  function gc_km(a, b) {
    var h = Math.pow(Math.sin((b[1] - a[1]) * DEG / 2), 2) + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.pow(Math.sin((b[0] - a[0]) * DEG / 2), 2);
    return 6371.0 * 2.0 * Math.asin(Math.min(1.0, Math.sqrt(Math.abs(h))));
  }
  var loops = (term_first || []).concat(term_last || []).filter(function (c) { return c.length >= 4; });
  (junctions || []).forEach(function (J) {
    if (Math.abs(pen_depth(rec, J[1], J[0])[2]) > 5e-4) return;
    var best = null;
    loops.forEach(function (c) { for (var i = 0; i < c.length; i++) { var d = gc_km(J, c[i]); if (best === null || d < best[0]) best = [d, c, i]; } });
    if (best && 0.005 < best[0] && best[0] < 40.0) {
      var c = best[1], i = best[2], n = c.length;
      var j = gc_km(J, c[(i + 1) % n]) <= gc_km(J, c[pmod(i - 1, n)]) ? (i + 1) % n : i;
      c.splice(j, 0, [pyround(J[0], 4), pyround(J[1], 4)]);
    }
  });
}

/* Sunrise/sunset curves (the "lemniscates"): where the penumbra's edge meets
   the horizon, traced through time. At any instant the horizon (sun altitude
   0, geodetic) is exactly a great circle about the sub-solar point, so the
   meeting points are the roots of ONE function of one angle: the penumbral
   depth g(theta) going round that circle. g > 0 on one arc, which the two roots
   bound: branch a where g rises through 0 (increasing theta), branch b where it
   falls. The two branches meet at a tip exactly when the maximum of g on the
   circle touches 0, found by bisection in time; the tip is where that maximum
   lies. (Replaces a 2-D Newton solve that failed as the branches merged, and
   the rough fallback that then drew 2017-08-21's tips 100 km off, zigzagging.) */
function horizon_frame(rec, t) {
  var b = bstate(rec, t);
  return { t: t, plat: b[4] / DEG, plon: pmod(-b[5] + 0.00417807 * b[6] + 180, 360) - 180 };
}
function horizon_pt(F, th) { return gc_step(F.plat, F.plon, th, R_EARTH_M * Math.PI / 2); }
function horizon_g(rec, F, th) { var p = horizon_pt(F, th); return pen_g(rec, p[0], p[1], F.t)[0]; }
/* The arc of the horizon inside the penumbra at time F.t: {a, b, m} (radians),
   or null. `near` = a previous arc to search around (tracking), else a scan. */
function horizon_arc(rec, F, near) {
  function g(th) { return horizon_g(rec, F, th); }
  var m, lo, hi, i;
  if (near) {
    var w = Math.max(3 * (near.b - near.a) / 2, 0.01);
    lo = near.m - w; hi = near.m + w;
  } else {
    var N = 1440, best = -Infinity, bi = 0;
    for (i = 0; i < N; i++) { var v = g(2 * Math.PI * i / N); if (v > best) { best = v; bi = i; } }
    lo = 2 * Math.PI * (bi - 1) / N; hi = 2 * Math.PI * (bi + 1) / N;
  }
  for (i = 0; i < 60 && hi - lo > 1e-13; i++) {             /* golden: the arc's deepest point */
    var m1 = hi - 0.618033988749895 * (hi - lo), m2 = lo + 0.618033988749895 * (hi - lo);
    if (g(m1) < g(m2)) lo = m1; else hi = m2;
  }
  m = (lo + hi) / 2;
  if (!(g(m) > 0)) return null;
  function root(dir) {                                        /* step out from m until g < 0, then bisect */
    var s = near ? Math.max((near.b - near.a) / 8, 1e-6) : 2 * Math.PI / 1440, inn = m, out = null;
    for (var k = 0; k < 200; k++) {
      var th = inn + dir * s;
      if (Math.abs(th - m) > Math.PI) return null;
      if (g(th) <= 0) { out = th; break; }
      inn = th; s *= 1.6;
    }
    if (out === null) return null;
    for (var j = 0; j < 60 && Math.abs(out - inn) > 1e-13; j++) {
      var mid = (inn + out) / 2;
      if (g(mid) > 0) inn = mid; else out = mid;
    }
    return (inn + out) / 2;
  }
  var ra = root(-1), rb = root(+1);
  if (ra === null || rb === null) return null;
  return { a: ra, b: rb, m: m };
}

function terminator_curves(rec, t_first, t_last, step_min) {
  var EXT = 1.0, tmin = rec.tmin - EXT, tmax = rec.tmax + EXT, i;
  /* 1. Where, roughly, the penumbra meets the horizon at all (fundamental plane). */
  var runs = [], cur = null, dt0 = 1 / 60;
  for (var t = tmin; t <= tmax + 1e-9; t += dt0) {
    if (term_crossings_at(rec, t) !== null) { if (!cur) cur = [t, t]; cur[1] = t; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  if (!runs.length) return [[], []];
  var MAX_KM = 30.0, MIN_KM = 10.0, DT_MIN = 1e-7;
  function km(p, q) { return gc_dist(p, q) / 1000; }
  var loops = [];
  runs.forEach(function (run) {
    /* 2. Exactly: start inside the run, walk both ways in time, tracking the arc. */
    var t0 = (run[0] + run[1]) / 2, A0 = horizon_arc(rec, horizon_frame(rec, t0), null);
    if (!A0) {                                                 /* try the whole rough run */
      for (var tt = run[0]; tt <= run[1] && !A0; tt += dt0) { A0 = horizon_arc(rec, horizon_frame(rec, tt), null); if (A0) t0 = tt; }
      if (!A0) return;
    }
    function walk(dir) {                                       /* -> {pts:[{t,a,b}], tip} */
      var pts = [], t = t0, A = A0, F = horizon_frame(rec, t), dt = 1 / 60;
      pts.push({ t: t, A: A, F: F });
      while (true) {
        var tn = t + dir * dt;
        if (tn < tmin || tn > tmax) return { pts: pts, tip: null };
        var Fn = horizon_frame(rec, tn), An = horizon_arc(rec, Fn, A);
        if (!An) {
          if (dt > DT_MIN) { dt /= 2; continue; }
          /* the arc closed between t and tn: the tip, where g's maximum is 0 */
          return { pts: pts, tip: horizon_pt(F, A.m) };
        }
        var pa = horizon_pt(F, A.a), pb = horizon_pt(F, A.b), qa = horizon_pt(Fn, An.a), qb = horizon_pt(Fn, An.b);
        var d = Math.max(km(pa, qa), km(pb, qb));
        if (d > MAX_KM && dt > DT_MIN) { dt /= 2; continue; }
        pts.push({ t: tn, A: An, F: Fn }); t = tn; A = An; F = Fn;
        if (d < MIN_KM && dt < 1 / 60) dt = Math.min(1 / 60, dt * 2);
      }
    }
    var bw = walk(-1), fw = walk(+1);
    var seq = bw.pts.slice(1).reverse().concat(fw.pts);          /* time increasing */
    var ca = seq.map(function (s) { var p = horizon_pt(s.F, s.A.a); return [p[1], p[0]]; });
    var cb = seq.map(function (s) { var p = horizon_pt(s.F, s.A.b); return [p[1], p[0]]; });
    var loop = [];
    if (bw.tip) loop.push([bw.tip[1], bw.tip[0]]);
    Array.prototype.push.apply(loop, ca);
    if (fw.tip) loop.push([fw.tip[1], fw.tip[0]]);
    Array.prototype.push.apply(loop, cb.reverse());
    if (loop.length && !pteq(loop[0], loop[loop.length - 1])) loop.push(loop[0].slice());
    if (loop.length >= 4) loops.push(unwrap(loop));
  });
  if (!loops.length) return [[], []];
  if (loops.length === 1) return [[loops[0]], []];
  if (loops.length === 2) return [[loops[0]], [loops[1]]];
  return [[loops[0]], loops.slice(1)];
}
function terminators_test(rec) {      /* test helper: build_path's call sequence */
  var w = penumbral_limits(rec);
  if (w[2] === null || w[3] === null) return [[], []];
  return terminator_curves(rec, w[2], w[3], TERM_STEP_MIN);
}

/* ── Greatest eclipse and umbral ovals ─────────────────────────────────── */
function compute_ge(rec) {
  var tmin = rec.tmin, tmax = rec.tmax, n = 100000, step = (tmax - tmin) / n, best_d = 1e9, best_t = tmin, t = tmin;
  for (var i = 0; i <= n; i++) {
    var X = rec.x0 + rec.x1 * t + rec.x2 * t * t + rec.x3 * t * t * t;
    var Y = rec.y0 + rec.y1 * t + rec.y2 * t * t + rec.y3 * t * t * t;
    var d = X * X + Y * Y;
    if (d < best_d) { best_d = d; best_t = t; }
    t += step;
  }
  var pt = centreline_pt(rec, best_t);
  if (pt) return [pyround(pt[1], 4), pyround(pt[0], 4)];
  return [pyround(rec.lng_dd_ge !== undefined ? rec.lng_dd_ge : 0.0, 4), pyround(rec.lat_dd_ge !== undefined ? rec.lat_dd_ge : 0.0, 4)];
}
/* Umbral ovals: the umbra's footprint every OVAL_STEP_MIN minutes. Each is the
   zero contour of the instantaneous depth g = |L2'| - distance at that moment,
   traced like the limits; where the sun is down the oval is cut by the
   sunrise/sunset line, which in geodetic lat/lon is a great circle, so the cut
   is closed exactly along it. */
function umbra_ovals(rec, oval_step_min) {
  if (oval_step_min === undefined) oval_step_min = OVAL_STEP_MIN;
  var step = oval_step_min / 60.0, ovals = [], t = rec.tmin;
  while (t <= rec.tmax + 1e-9) {
    var cl = centreline_pt(rec, t);
    if (cl !== null && magnitude_at(rec, cl[0], cl[1], t) >= 1.0 - 1e-9) {
      var ring = oval_at(rec, t, cl);
      if (ring && ring.length >= 4) ovals.push(ring);
    }
    t += step;
  }
  return ovals;
}
function oval_at(rec, t, cl) {
  var b = bstate(rec, t), d_r = b[4], mu = b[5], dt_s = b[6];
  function sunup(la, lo) { return sun_sin_alt(la, lo, d_r, mu, dt_s) > 0; }
  function field(la, lo) { return sunup(la, lo) ? umb_g(rec, la, lo, t) : null; }
  /* seed: the edge along the first bearing that reaches it in daylight */
  var seed = null, r_m = 0;
  for (var k = 0; k < 8 && !seed; k++) {
    var brg = k * Math.PI / 4, lo_ = 0, hi = null, d = 1e3, q;
    while (d < 6e6) {
      q = gc_step(cl[0], cl[1], brg, d);
      if (!sunup(q[0], q[1])) break;
      if (umb_g(rec, q[0], q[1], t) < 0) { hi = d; break; }
      lo_ = d; d *= 1.5;
    }
    if (hi === null) continue;
    for (var it = 0; it < 60 && hi - lo_ > 0.01; it++) {
      var m = (lo_ + hi) / 2; q = gc_step(cl[0], cl[1], brg, m);
      if (umb_g(rec, q[0], q[1], t) > 0) lo_ = m; else hi = m;
    }
    seed = gc_step(cl[0], cl[1], brg, lo_); r_m = lo_;
  }
  if (!seed) return null;
  var stepkm = clamp(r_m / 1000 / 20, 0.001, 2.0);
  var tr = trace_zero(field, seed, { step_km: stepkm, min_km: stepkm / 20, max_turn: 3.0, maxpts: 8000,
                                     probe_m: Math.min(2000.0, 250.0 * stepkm),
                                     tol: 1e-10, accept: 1e-9 });
  var pts = tr[0];                                     /* [lon, lat] */
  if (pts.length < 3) return null;
  if (!tr[1]) {                                        /* cut by the horizon: close along it */
    var ea = pts[0], eb = pts[pts.length - 1], probe_km = stepkm * 2;
    function nearNight(e) {                           /* an open end must be beside the horizon */
      for (var a = 0; a < 8; a++) { var q = gc_step(e[1], e[0], a * Math.PI / 4, probe_km * 1000); if (!sunup(q[0], q[1])) return true; }
      return false;
    }
    if (!nearNight(ea) || !nearNight(eb)) return null;   /* the trace failed; draw nothing rather than a chord */
    /* carry each end exactly onto the horizon (edge and horizon meet there) */
    var e0 = to_horizon(pts[1], pts[0]), e1 = to_horizon(pts[pts.length - 2], pts[pts.length - 1]);
    pts.unshift(e0); pts.push(e1);
    var A = [pts[pts.length - 1][1], pts[pts.length - 1][0]], B = [pts[0][1], pts[0][0]];
    var dd = gc_dist(A, B), bb = gc_bearing(A, B), n = Math.max(1, Math.ceil(dd / (stepkm * 1000)));
    for (var j = 1; j < n; j++) { var c = gc_step(A[0], A[1], bb, dd * j / n); pts.push([c[1], c[0]]); }
  }
  /* from the sunlit end q (reached from p), walk on along the edge to where the
     sun's altitude is exactly zero: bisect the distance, each trial point put
     back on the edge (g = 0) by Newton */
  function onedge(la, lo) {
    for (var i = 0; i < 20; i++) {
      var g = umb_g(rec, la, lo, t);
      if (Math.abs(g) < 1e-11) break;
      var H = 5.0, p;
      p = gc_step(la, lo, 0, H); var gN = umb_g(rec, p[0], p[1], t);
      p = gc_step(la, lo, Math.PI, H); var gS = umb_g(rec, p[0], p[1], t);
      p = gc_step(la, lo, Math.PI / 2, H); var gE = umb_g(rec, p[0], p[1], t);
      p = gc_step(la, lo, -Math.PI / 2, H); var gW = umb_g(rec, p[0], p[1], t);
      var a = (gN - gS) / (2 * H), c = (gE - gW) / (2 * H), m = Math.hypot(a, c);
      if (m < 1e-18) break;
      p = gc_step(la, lo, Math.atan2(c, a), -g / m); la = p[0]; lo = p[1];
    }
    return [la, lo];
  }
  function to_horizon(p, q) {
    var Q = [q[1], q[0]], brg = gc_bearing([p[1], p[0]], Q), lo_ = 0, hi = stepkm * 2000, x;
    for (var j = 0; j < 40 && hi - lo_ > 0.1; j++) {
      var m = (lo_ + hi) / 2; x = gc_step(Q[0], Q[1], brg, m); x = onedge(x[0], x[1]);
      if (sunup(x[0], x[1])) lo_ = m; else hi = m;
    }
    x = gc_step(Q[0], Q[1], brg, lo_); x = onedge(x[0], x[1]);
    return [x[1], x[0]];
  }
  var ring = pts.map(function (p) { return [pyround(p[0], 4), pyround(p[1], 4)]; });
  ring.push(ring[0].slice());
  return ring;
}

/* ── Simplification, pole split, rounding ──────────────────────────────── */
function dp_perp(p, a, b) {
  var dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / Math.hypot(dx, dy);
}
/* Douglas-Peucker. tol is a number, or an array giving each vertex its own
   tolerance (a vertex is kept when its deviation / its tolerance is largest and
   exceeds 1; with one tolerance for all this is the classic algorithm). */
function simplify_dp(pts, tol) {
  var n = pts.length, max_segment_km = 200.0, i, k;
  var tl = Array.isArray(tol) ? tol : null;
  if (n < 3) return pts.slice();
  var keep = new Array(n).fill(false);
  keep[0] = keep[n - 1] = true;
  for (i = 1; i < n - 1; i++) if (Math.abs(pts[i][1]) >= 89.9) keep[i] = true;
  var forced = [], stack = [];
  for (i = 0; i < n; i++) if (keep[i]) forced.push(i);
  for (k = 0; k < forced.length - 1; k++) stack.push([forced[k], forced[k + 1]]);
  while (stack.length) {
    var seg = stack.pop(), lo = seg[0], hi = seg[1];
    if (hi <= lo + 1) continue;
    var a = pts[lo], b = pts[hi], worst_d = 0.0, worst_i = -1;
    for (i = lo + 1; i < hi; i++) {
      var d = tl ? dp_perp(pts[i], a, b) / tl[i] : dp_perp(pts[i], a, b);
      if (d > worst_d) { worst_d = d; worst_i = i; }
    }
    if (worst_d > (tl ? 1.0 : tol)) { keep[worst_i] = true; stack.push([lo, worst_i]); stack.push([worst_i, hi]); }
  }
  function gc_km_loc(p, q) {
    var p1 = p[1] * DEG, p2 = q[1] * DEG, dl = (q[0] - p[0]) * DEG;
    var h = Math.pow(Math.sin((p2 - p1) / 2), 2) + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin(dl / 2), 2);
    return 6371.0 * 2 * Math.asin(Math.sqrt(clamp(h, 0.0, 1.0)));
  }
  var changed = true;
  while (changed) {
    changed = false; forced = [];
    for (i = 0; i < n; i++) if (keep[i]) forced.push(i);
    for (k = 0; k < forced.length - 1; k++) {
      var l2 = forced[k], h2 = forced[k + 1];
      if (h2 <= l2 + 1) continue;
      if (gc_km_loc(pts[l2], pts[h2]) > max_segment_km) { keep[Math.floor((l2 + h2) / 2)] = true; changed = true; }
    }
  }
  return pts.filter(function (_, j) { return keep[j]; });
}
function split_at_pole(segs) {
  var out = [];
  segs.forEach(function (seg) {
    if (seg.length < 2) { out.push(seg); return; }
    var cur = [seg[0]];
    for (var i = 1; i < seg.length; i++) {
      if (Math.abs(seg[i][1]) >= 89.9 && Math.abs(seg[i - 1][1]) >= 89.9) { if (cur.length >= 2) out.push(cur); cur = [seg[i]]; }
      else cur.push(seg[i]);
    }
    if (cur.length >= 2) out.push(cur);
  });
  return out;
}
function round_path(path) {
  var PREC = { centreline: 5, umbra_n: 5, umbra_s: 5, umbra_ovals: 4, ge: 4, terminator_first: 4, terminator_last: 4, penumbra_n: 4, penumbra_s: 4 };
  var result = {};
  Object.keys(path).forEach(function (k) {
    var v = path[k];
    if (k === 'green_curve' && Array.isArray(v))      /* 5 dp like the other exact curves */
      result[k] = v.map(function (p) { return p === null ? null : [pyround(p[0], 5), pyround(p[1], 5)]; });
    else if (k in PREC && Array.isArray(v)) {
      var dp = PREC[k];
      if (k === 'ge') result[k] = v.length ? [pyround(v[0], dp), pyround(v[1], dp)] : v;
      else result[k] = v.map(function (seg) { return seg.map(function (p) { return [pyround(p[0], dp), pyround(p[1], dp)]; }); });
    } else result[k] = v;
  });
  return result;
}

/* ── One eclipse's complete path ───────────────────────────────────────── */
function build_path(rec) {
  var tmin = rec.tmin, tmax = rec.tmax, step = STEP_MIN / 60.0, et = rec.eclipse_type || '?';
  var is_central = !!et && 'TAH'.indexOf(et[0]) >= 0;
  var MAX_KM = 30.0, MIN_KM = 10.0, DT_MIN = 1.0 / 3600.0, DT_MAX = step, EARTH_R_KM = 6371.0, i;
  function gc_km(p, q) {
    if (p === null || q === null) return null;
    var p1 = p[0] * DEG, p2 = q[0] * DEG, dl = (q[1] - p[1]) * DEG;
    var a = Math.pow(Math.sin((p2 - p1) / 2), 2) + Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin(dl / 2), 2);
    return EARTH_R_KM * 2 * Math.asin(Math.sqrt(clamp(a, 0.0, 1.0)));
  }
  function find_first_valid(t_lo, t_hi) {
    var scan = t_lo, prev_ok = false;
    while (scan <= t_hi + 1e-9) {
      var ok = centreline_pt(rec, scan) !== null;
      if (ok) {
        if (prev_ok || scan <= t_lo + 1e-9) return scan;
        var t_out = scan - step, t_in = scan;
        for (var k = 0; k < 40; k++) {
          var tm = 0.5 * (t_out + t_in);
          if (centreline_pt(rec, tm) !== null) t_in = tm; else t_out = tm;
          if (t_in - t_out < 1e-7) break;
        }
        return t_in;
      }
      prev_ok = ok; scan += step;
    }
    return null;
  }
  function find_last_valid(t_lo, t_hi) {
    var scan = t_hi;
    while (scan >= t_lo - 1e-9) {
      if (centreline_pt(rec, scan) !== null) {
        var t_in = scan, t_out = scan + step;
        for (var k = 0; k < 40; k++) {
          var tm = 0.5 * (t_in + t_out);
          if (centreline_pt(rec, tm) !== null) t_in = tm; else t_out = tm;
          if (t_out - t_in < 1e-7) break;
        }
        return t_in;
      }
      scan -= step;
    }
    return null;
  }
  function adaptive_walk(t_start, t_end, sampler) {
    var out = [], p0 = sampler(t_start);
    if (p0 === null) return out;
    out.push([t_start, p0[0], p0[1]]);
    var t_cur = t_start, dt = DT_MAX, iters = 0;
    function fill(ta, pa, tb, pb, depth) {
      if (gc_km(pa, pb) <= MAX_KM || depth > 40 || (tb - ta) < 1e-10) { out.push([tb, pb[0], pb[1]]); return; }
      var tmid = 0.5 * (ta + tb), pmid = sampler(tmid);
      if (pmid === null) { out.push([tb, pb[0], pb[1]]); return; }
      fill(ta, pa, tmid, pmid, depth + 1); fill(tmid, pmid, tb, pb, depth + 1);
    }
    while (t_cur < t_end - 1e-9 && iters < 100000) {
      iters++;
      var t_next = Math.min(t_cur + dt, t_end), p_next = sampler(t_next);
      if (p_next === null) { dt = Math.max(DT_MIN, dt * 0.5); if (dt <= DT_MIN + 1e-12) break; continue; }
      var last = out[out.length - 1], d = gc_km([last[1], last[2]], p_next);
      if (d > MAX_KM && dt > DT_MIN + 1e-12) { dt = Math.max(DT_MIN, dt * 0.5); continue; }
      if (d > MAX_KM) fill(t_cur, [last[1], last[2]], t_next, p_next, 0);
      else out.push([t_next, p_next[0], p_next[1]]);
      t_cur = t_next;
      if (d < MIN_KM && dt < DT_MAX) dt = Math.min(DT_MAX, dt * 2.0);
    }
    return out;
  }
  var clp = function (t) { return centreline_pt(rec, t); };
  var cl = [], walk = [], GREEN = [], t_cA, t_cB;
  if (is_central) {
    GREEN = green_curve(rec);
    t_cA = find_first_valid(tmin, tmax); t_cB = find_last_valid(tmin, tmax);
    var max_sun_alt = function (lat, lon) {
      function adz(t) {
        var b = bstate(rec, t), f = fund_true(lat, lon, b[4], b[5], b[6]);
        return [Math.hypot(f[0] - b[0], f[1] - b[2]), sun_sin_alt(lat, lon, b[4], b[5], b[6])];
      }
      var N = 48, bt = tmin, bd = 1e18, k;
      for (k = 0; k <= N; k++) { var t = tmin + (tmax - tmin) * k / N, r = adz(t); if (r[0] < bd) { bd = r[0]; bt = t; } }
      var a = Math.max(tmin, bt - (tmax - tmin) / N), b = Math.min(tmax, bt + (tmax - tmin) / N), bz = -1.0;
      for (k = 0; k < 40; k++) {
        var m1 = a + (b - a) / 3, m2 = b - (b - a) / 3, r1 = adz(m1), r2 = adz(m2);
        if (r1[0] < r2[0]) { b = m2; bz = r1[1]; } else { a = m1; bz = r2[1]; }
      }
      return Math.asin(clamp(bz, -1.0, 1.0)) / DEG;
    };
    var visible_trim = function (w) {
      if (!w.length) return w;
      var vis = w.map(function (p) { return max_sun_alt(p[1], p[2]) >= 0.0; });
      if (vis.every(Boolean)) return w;
      var best_lo = 0, best_hi = 0, cur = null, v2 = vis.concat([false]);
      for (var k = 0; k < v2.length; k++) {
        if (v2[k] && cur === null) cur = k;
        else if (!v2[k] && cur !== null) { if (k - cur > best_hi - best_lo) { best_lo = cur; best_hi = k; } cur = null; }
      }
      return w.slice(best_lo, best_hi);
    };
    walk = (t_cA !== null && t_cB !== null && t_cB > t_cA + 1e-9) ? visible_trim(adaptive_walk(t_cA, t_cB, clp)) : [];
    walk.forEach(function (p) { cl.push([pyround(p[2], 5), pyround(p[1], 5)]); });
  } else {
    t_cA = find_first_valid(tmin, tmax); t_cB = find_last_valid(tmin, tmax);
    if (t_cA !== null && t_cB !== null && t_cB > t_cA + 1e-9)
      adaptive_walk(t_cA, t_cB, clp).forEach(function (p) { cl.push([pyround(p[2], 5), pyround(p[1], 5)]); });
  }
  var cl_segs = cl.length ? [cl] : [];
  var one_limit = is_central && et.length > 1 && 'ns-+'.indexOf(et[1]) >= 0;
  var n_segs = [], s_segs = [];
  if (is_central) {
    var tag = rec.year + '-' + rec.month + '-' + rec.day;
    try { var ul = umbral_limits_field(rec); n_segs = ul[0]; s_segs = ul[1]; }
    catch (e) { if (typeof console !== 'undefined') console.warn('UMBRAL LIMITS FAILED', tag, et, e); }
    if (!umbral_limits_valid(n_segs, s_segs, !one_limit) && typeof console !== 'undefined') console.warn('UMBRAL LIMITS INVALID', tag, et);
  }
  function r5(segs) { return segs.map(function (seg) { return seg.map(function (p) { return [pyround(p[0], 5), pyround(p[1], 5)]; }); }); }
  var un_segs = r5(n_segs), us_segs = r5(s_segs);
  if (is_central && !one_limit && cl.length >= 7) {
    var NARROW_KM = 12.0;
    if ((n_segs.length || s_segs.length) && walk.length >= 3) {
      var unf = [].concat.apply([], n_segs), usf = [].concat.apply([], s_segs);
      var gckm = function (a, b) {
        var h = Math.pow(Math.sin((b[1] - a[1]) * DEG / 2), 2) + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.pow(Math.sin((b[0] - a[0]) * DEG / 2), 2);
        return 6371.0 * 2.0 * Math.asin(Math.min(1.0, Math.sqrt(Math.abs(h))));
      };
      var width_at = function (lon, lat) {
        if (!unf.length || !usf.length) return 1e9;
        var dn = Infinity, ds = Infinity, k;
        for (k = 0; k < unf.length; k++) dn = Math.min(dn, gckm([lon, lat], unf[k]));
        for (k = 0; k < usf.length; k++) ds = Math.min(ds, gckm([lon, lat], usf[k]));
        return dn + ds;
      };
      var wds = walk.map(function (p) { return width_at(p[2], p[1]); });
      var in0 = 3, in1 = walk.length - 5, interior = wds.slice(in0, in1 + 1);
      if (interior.length && Math.min.apply(null, interior) < NARROW_KM) {
        var walk2 = [walk[0]];
        for (i = 0; i < walk.length - 1; i++) {
          var w0 = walk[i], w1 = walk[i + 1], w = Math.min(wds[i], wds[i + 1]);
          if (w < NARROW_KM && in0 <= i && i <= in1) {
            var span = gckm([w0[2], w0[1]], [w1[2], w1[1]]), target = Math.max(0.8, w / 1.5);
            var nsub = Math.min(40, Math.max(1, Math.ceil(span / target)));
            for (var k = 1; k < nsub; k++) {
              var tk = w0[0] + (w1[0] - w0[0]) * k / nsub, pk = centreline_pt(rec, tk);
              if (pk) walk2.push([tk, pk[0], pk[1]]);
            }
          }
          walk2.push(w1);
        }
        walk = walk2;
        cl = walk.map(function (p) { return [pyround(p[2], 5), pyround(p[1], 5)]; });
        cl_segs = [cl];
      }
    }
  }
  cl_segs = cl_segs.length ? [unwrap(cl_segs[0])] : [];
  un_segs = un_segs.map(function (s) { return unwrap(s); });
  us_segs = us_segs.map(function (s) { return unwrap(s); });
  cl_segs = split_at_pole(cl_segs); un_segs = split_at_pole(un_segs); us_segs = split_at_pole(us_segs);

  var pw = penumbral_limits(rec), t_first = pw[2], t_last = pw[3];
  var pf = penumbral_limits_field(rec, pw[0], pw[1]), pn = pf[0], ps = pf[1];
  var tc = (t_first !== null && t_last !== null) ? terminator_curves(rec, t_first, t_last, TERM_STEP_MIN) : [[], []];
  var result = {
    cat_no: (rec.cat_no !== undefined && rec.cat_no !== null) ? Math.trunc(parseFloat(rec.cat_no)) : null,
    year: rec.year, month: rec.month, day: rec.day, type: rec.eclipse_type || '?',
    ge: compute_ge(rec),
    centreline: cl_segs, umbra_n: un_segs, umbra_s: us_segs,
    umbra_ovals: is_central ? umbra_ovals(rec) : [],
    penumbra_n: (pn && pn.length) ? [unwrap(pn)] : [], penumbra_s: (ps && ps.length) ? [unwrap(ps)] : [],
    terminator_first: tc[0], terminator_last: tc[1],
    green_curve: is_central ? GREEN : []
  };
  var pnp = result.penumbra_n.length ? result.penumbra_n[0] : [], psp = result.penumbra_s.length ? result.penumbra_s[0] : [];
  var pen_n_start = pnp.length ? pnp[0] : null, pen_s_start = psp.length ? psp[0] : null;
  var pen_n_end = pnp.length ? pnp[pnp.length - 1] : null, pen_s_end = psp.length ? psp[psp.length - 1] : null;
  var DP_TIGHT = 9e-5, DP_LOOSE = 1.8e-3;
  /* A limit's tolerance is at most a quarter of the distance to the other limit:
     where a hybrid pinches, the corridor is only metres wide, and simplifying
     each limit to the usual 10 m let the drawn limits cross (1804-02-11). */
  function limit_tol(seg, others) {
    return seg.map(function (p) {
      var best = Infinity;                       /* squared distance to the other limit's segments */
      others.forEach(function (o) {
        for (var j = 0; j + 1 < o.length; j++) {
          var ax = pmod(o[j][0] - p[0] + 180, 360) - 180, ay = o[j][1] - p[1];
          var bx = ax + (o[j + 1][0] - o[j][0]), by = ay + (o[j + 1][1] - o[j][1]);
          var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
          var u = L > 0 ? clamp(-(ax * dx + ay * dy) / L, 0, 1) : 0, qx = ax + u * dx, qy = ay + u * dy;
          best = Math.min(best, qx * qx + qy * qy);
        }
      });
      return Math.max(1e-9, Math.min(DP_TIGHT, 0.25 * Math.sqrt(best)));
    });
  }
  ['centreline', 'umbra_ovals'].forEach(function (f) { result[f] = result[f].map(function (s) { return simplify_dp(s, DP_TIGHT); }); });
  var un = result.umbra_n, us = result.umbra_s;
  result.umbra_n = un.map(function (s) { return simplify_dp(s, us.length ? limit_tol(s, us) : DP_TIGHT); });
  result.umbra_s = us.map(function (s) { return simplify_dp(s, un.length ? limit_tol(s, un) : DP_TIGHT); });
  ['penumbra_n', 'penumbra_s', 'terminator_first', 'terminator_last'].forEach(function (f) { result[f] = result[f].map(function (s) { return simplify_dp(s, DP_LOOSE); }); });
  var juncs = [];
  [result.penumbra_n, result.penumbra_s].forEach(function (s) { if (s.length && s[0].length) juncs.push(s[0][0]); });
  [result.penumbra_n, result.penumbra_s].forEach(function (s) { if (s.length && s[0].length) juncs.push(s[0][s[0].length - 1]); });
  insert_rs_junctions(rec, result.terminator_first, result.terminator_last, juncs);
  function junction_idx(term_segs, ep) {
    if (!term_segs.length || !term_segs[0].length || !ep) return null;
    var seg = term_segs[0], best = Infinity, best_i = 0;
    for (var j = 0; j < seg.length; j++) {
      var dx = pmod(seg[j][0] - ep[0] + 180, 360) - 180, dy = seg[j][1] - ep[1], d = dx * dx + dy * dy;
      if (d < best) { best = d; best_i = j; }
    }
    return best_i;
  }
  result.terminator_first_n_idx = junction_idx(result.terminator_first, pen_n_start);
  result.terminator_first_s_idx = junction_idx(result.terminator_first, pen_s_start);
  result.terminator_last_n_idx = junction_idx(result.terminator_last, pen_n_end);
  result.terminator_last_s_idx = junction_idx(result.terminator_last, pen_s_end);
  return result;
}
/* The finished path exactly as the generator writes it. */
function eclipse_path(rec) { return round_path(build_path(rec)); }

var api = {
  VERSION: PATHGEN_VERSION,
  bstate: bstate, f2g: f2g, centreline_pt: centreline_pt,
  umbral_limits_field: umbral_limits_field, umbral_limits_valid: umbral_limits_valid, umb_depth: umb_depth,
  green_curve: green_curve, penumbra_both: penumbra_both, pyround: pyround, terminators_test: terminators_test, umbra_ovals: umbra_ovals, compute_ge: compute_ge, eclipse_path: eclipse_path, umb_g: umb_g, sun_sin_alt: sun_sin_alt, oval_at: oval_at, gc_dist: gc_dist
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.PathGen = api;
})(typeof self !== 'undefined' ? self : this);
