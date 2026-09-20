/* pathgen.js — eclipse path generator (JavaScript port of gen_eclipse_paths.py) */

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
'use strict';

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
  var min_km = o.min_km !== undefined ? o.min_km : 4.0, max_turn = 12.0;
  var width = o.width || null, min_width = o.min_width || 0.0;
  var tol = o.tol !== undefined ? o.tol : 1e-6, accept = o.accept !== undefined ? o.accept : 2e-5;
  var PROBE = 2000.0, pr = PROBE;
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
        if (hw < min_width) break;
        var cap = 0.3 * hw;
        if (turn) cap = Math.max(cap, Math.sqrt(0.6 * hw * last / (turn * DEG)));
        step = Math.max(0.05, Math.min(step, cap));
        pr = Math.min(PROBE, 250.0 * hw);
      }
      var p2 = gc_step(la, lo, tb, step * 1000.0);
      var cr = correct(p2[0], p2[1]);
      if (!cr[2]) break;
      var la2 = cr[0], lo2 = cr[1];
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
  function side_at(la, lo) { var ts = umb_depth(rec, la, lo)[1]; return umb_side(rec, la, lo, ts) > 0; }
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
      min_width: PINCH_HW_KM, tol: 1e-10, accept: 1e-9 });
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

  north.concat(south).forEach(function (arc) {
    [0, -1].forEach(function (k) {
      var e = k === 0 ? arc[0] : arc[arc.length - 1], lo = e[0], la = e[1];
      for (var pi = 0; pi < pinches.length; pi++) {
        var pl = pinches[pi][0], po = pinches[pi][1], tp = pinches[pi][2], d = gc_dist([la, lo], [pl, po]);
        if (1.0 < d && d < PINCH_JOIN_KM * 1e3) {
          var te = umb_depth(rec, la, lo)[1], m = Math.floor(d / 5e3), fill = [];
          for (var jj = 1; jj <= m; jj++) { var c = centreline_pt(rec, te + (tp - te) * jj / (m + 1)); if (c) fill.push([c[1], c[0]]); }
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
    return [Math.asin(clamp(bz, -1.0, 1.0)) / DEG, bdist];
  }
  var PEN = Math.abs(bstate(rec, (tmin + tmax) / 2.0)[7]) * 1.005;
  function grad(lat, lon) {
    var h = 0.02;
    return [(field(lat + h, lon)[0] - field(lat - h, lon)[0]) / (2 * h),
            (field(lat, lon + h)[0] - field(lat, lon - h)[0]) / (2 * h)];
  }
  function correct(lat, lon) {
    for (var i = 0; i < 12; i++) {
      var f = field(lat, lon)[0];
      if (Math.abs(f) < 0.003) return [lat, lon, true];
      var g = grad(lat, lon), g2 = g[0] * g[0] + g[1] * g[1];
      if (g2 < 1e-12) return [lat, lon, false];
      lat -= f * g[0] / g2; lon -= f * g[1] / g2;
    }
    return [lat, lon, Math.abs(field(lat, lon)[0]) < 0.02];
  }
  function trace(seed) {
    var step_km = 35.0, maxpts = 4000;
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
        if (field(la2, lo2)[1] > PEN) break;
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

/* ── Terminator lemniscates (penumbra ∩ sunrise/sunset line) ───────────── */
function f2g_term(xi, eta, d_r, mu, dt_s) {
  var lat_gc = Math.asin(clamp(eta * Math.cos(d_r), -1.0, 1.0));
  var lat_gd = Math.atan(Math.tan(lat_gc) / Math.sqrt(1.0 - E2));
  var H = Math.atan2(xi, -eta * Math.sin(d_r)) / DEG;
  return [lat_gd / DEG, pmod(H - mu + 0.00417807 * dt_s + 180.0, 360.0) - 180.0];
}
function term_crossings_at(rec, t) {
  var b = bstate(rec, t), X = b[0], Y = b[2], L1 = b[7], D2 = X * X + Y * Y;
  if (D2 < 1e-18) return null;
  var D = Math.sqrt(D2), k = (D2 + 1.0 - L1 * L1) * 0.5, kd = k / D;
  if (Math.abs(kd) > 1.0) return null;
  var h = Math.sqrt(Math.max(0.0, 1.0 - kd * kd)), cx = X / D, cy = Y / D, nx = -Y / D, ny = X / D;
  return [cx * kd + nx * h, cy * kd + ny * h, cx * kd - nx * h, cy * kd - ny * h, X, Y, b[4], b[5], b[6], L1];
}
function term_tangency_time(rec, t_out, t_in) {
  var tol = 1e-7;
  function kd_excess(t) {
    var b = bstate(rec, t), X = b[0], Y = b[2], L1 = b[7], D = Math.sqrt(X * X + Y * Y);
    if (D < 1e-18) return -1.0;
    return Math.abs((D * D + 1.0 - L1 * L1) / (2.0 * D)) - 1.0;
  }
  var lo = t_out, hi = t_in;
  for (var i = 0; i < 60; i++) {
    var mid = 0.5 * (lo + hi);
    if (kd_excess(mid) > 0) lo = mid; else hi = mid;
    if (Math.abs(hi - lo) < tol) break;
  }
  return 0.5 * (lo + hi);
}
function term_tangent_point(rec, t, polish) {
  if (polish === undefined) polish = true;
  var b = bstate(rec, t), X = b[0], Y = b[2], L1 = b[7], D = Math.sqrt(X * X + Y * Y);
  if (D < 1e-18) return null;
  var kd = clamp((D * D + 1.0 - L1 * L1) / (2.0 * D), -1.0, 1.0);
  var ll = f2g_term(X / D * kd, Y / D * kd, b[4], b[5], b[6]);
  return polish ? rs_exact(rec, t, ll) : ll;
}
function gcd_m(A, B) {            /* haversine metres, [lat, lon] */
  var dla = (B[0] - A[0]) * DEG, dlo = (B[1] - A[1]) * DEG;
  var h = Math.pow(Math.sin(dla / 2), 2) + Math.cos(A[0] * DEG) * Math.cos(B[0] * DEG) * Math.pow(Math.sin(dlo / 2), 2);
  return 2.0 * R_EARTH_M * Math.asin(Math.min(1.0, Math.sqrt(Math.abs(h))));
}
function rs_exact(rec, t, ll, keep_seed, cap_km) {
  if (ll === null || ll === undefined) return null;
  keep_seed = !!keep_seed; if (cap_km === undefined) cap_km = null;
  var lat = ll[0], lon = ll[1];
  function accept(la2, lo2) {
    if (cap_km === null) return [la2, lo2];
    var dla = (la2 - ll[0]) * DEG, dlo = (lo2 - ll[1]) * DEG;
    var h = Math.pow(Math.sin(dla / 2), 2) + Math.cos(ll[0] * DEG) * Math.cos(la2 * DEG) * Math.pow(Math.sin(dlo / 2), 2);
    var moved = 6371.0 * 2.0 * Math.asin(Math.min(1.0, Math.sqrt(Math.abs(h))));
    if (moved <= cap_km) return [la2, lo2];
    return keep_seed ? ll : null;
  }
  var H = 800.0, r0 = pen_g(rec, lat, lon, t), g0 = r0[0], z0 = r0[1], res = Math.hypot(g0, z0);
  for (var it = 0; it < 30; it++) {
    if (Math.abs(z0) < 1e-8 && Math.abs(g0) < 1e-8) return accept(lat, lon);
    var p, N, S, E, W;
    p = gc_step(lat, lon, 0.0, H); N = pen_g(rec, p[0], p[1], t);
    p = gc_step(lat, lon, Math.PI, H); S = pen_g(rec, p[0], p[1], t);
    p = gc_step(lat, lon, Math.PI / 2, H); E = pen_g(rec, p[0], p[1], t);
    p = gc_step(lat, lon, -Math.PI / 2, H); W = pen_g(rec, p[0], p[1], t);
    var a11 = (N[0] - S[0]) / (2 * H), a12 = (E[0] - W[0]) / (2 * H), a21 = (N[1] - S[1]) / (2 * H), a22 = (E[1] - W[1]) / (2 * H);
    var det = a11 * a22 - a12 * a21;
    if (Math.abs(det) < 1e-30) break;
    var dn = (-g0 * a22 + z0 * a12) / det, de = (-z0 * a11 + g0 * a21) / det;
    var stepm = Math.hypot(dn, de), brg = Math.atan2(de, dn), la2, lo2, g2, z2, r2, found = false;
    for (var bt = 0; bt < 6; bt++) {
      var q = gc_step(lat, lon, brg, stepm); la2 = q[0]; lo2 = q[1];
      var rr = pen_g(rec, la2, lo2, t); g2 = rr[0]; z2 = rr[1]; r2 = Math.hypot(g2, z2);
      if (r2 < res) { found = true; break; }
      stepm *= 0.5;
    }
    if (!found) break;                                  /* Python for-else */
    lat = la2; lon = lo2; g0 = g2; z0 = z2; res = r2;
  }
  if (Math.abs(z0) < 1e-6 && Math.abs(g0) < 1e-6) return accept(lat, lon);
  var qq = rs_ring_solve(rec, t, ll);
  if (qq !== null) return accept(qq[0], qq[1]);
  return keep_seed ? ll : null;
}
function rs_ring_solve(rec, t, ll) {
  var H = 800.0;
  function zg(la, lo) { return pen_g(rec, la, lo, t); }
  function zgrad_brg(la, lo) {
    var p, zN, zS, zE, zW;
    p = gc_step(la, lo, 0.0, H); zN = zg(p[0], p[1])[1];
    p = gc_step(la, lo, Math.PI, H); zS = zg(p[0], p[1])[1];
    p = gc_step(la, lo, Math.PI / 2, H); zE = zg(p[0], p[1])[1];
    p = gc_step(la, lo, -Math.PI / 2, H); zW = zg(p[0], p[1])[1];
    var gN = (zN - zS) / (2 * H), gE = (zE - zW) / (2 * H), m = Math.hypot(gN, gE);
    return m > 1e-15 ? [Math.atan2(gE, gN), m] : [null, 0.0];
  }
  function on_ring(la, lo) {
    for (var i = 0; i < 10; i++) {
      var z = zg(la, lo)[1];
      if (Math.abs(z) < 1e-9) return [la, lo, true];
      var bm = zgrad_brg(la, lo);
      if (bm[0] === null) return [la, lo, false];
      var p = gc_step(la, lo, bm[0], -z / bm[1]); la = p[0]; lo = p[1];
    }
    return [la, lo, Math.abs(zg(la, lo)[1]) < 1e-7];
  }
  var r0 = on_ring(ll[0], ll[1]);
  if (!r0[2]) return null;
  var la0 = r0[0], lo0 = r0[1];
  function ring_step(la, lo, brg, d_m) {
    var p = gc_step(la, lo, brg, d_m), r = on_ring(p[0], p[1]);
    return r[2] ? [r[0], r[1]] : null;
  }
  var b0 = zgrad_brg(la0, lo0)[0];
  if (b0 === null) return null;
  var tang = b0 + Math.PI / 2, g0 = zg(la0, lo0)[0], best = null, STEPK = 8e3;
  var signs = [1.0, -1.0];
  for (var si = 0; si < 2; si++) {
    var sgn = signs[si], prev = [la0, lo0], pg = g0, samples = [[[la0, lo0], g0]];
    for (var k = 0; k < 40; k++) {
      var q = ring_step(prev[0], prev[1], sgn > 0 ? tang : tang + Math.PI, STEPK);
      if (q === null) break;
      var qg = zg(q[0], q[1])[0];
      samples.push([q, qg]);
      if ((qg < 0.0) !== (pg < 0.0)) { best = [prev, q, pg]; break; }
      prev = q; pg = qg;
    }
    if (best) break;
    if (samples.length >= 3) {
      var mi = 1;
      for (var s = 2; s < samples.length - 1; s++) if (samples[s][1] > samples[mi][1]) mi = s;   /* first max */
      if (samples[mi][1] > samples[0][1]) {
        var A2 = samples[mi - 1][0], B2 = samples[mi + 1][0];
        for (var it = 0; it < 18; it++) {
          var brg_ab = gc_bearing(A2, B2), d_ab = gcd_m(A2, B2);
          var m1 = ring_step(A2[0], A2[1], brg_ab, d_ab / 3.0), m2 = ring_step(A2[0], A2[1], brg_ab, 2.0 * d_ab / 3.0);
          if (m1 === null || m2 === null) break;
          if (zg(m1[0], m1[1])[0] < zg(m2[0], m2[1])[0]) A2 = m1; else B2 = m2;
        }
        if (zg(A2[0], A2[1])[0] > 0.0) {
          var i0 = Math.max(0, mi - 1);
          best = [samples[i0][0], A2, samples[i0][1]];
          if (best[2] > 0.0) best = [samples[0][0], A2, samples[0][1]];
          break;
        }
      }
    }
  }
  if (best === null) return null;
  var A = best[0], B = best[1], ga = best[2];
  for (var j = 0; j < 24; j++) {
    var bab = gc_bearing(A, B), dab = gcd_m(A, B);
    if (dab < 2.0) break;
    var M = ring_step(A[0], A[1], bab, dab / 2.0);
    if (M === null) break;
    if ((zg(M[0], M[1])[0] < 0.0) === (ga < 0.0)) { A = M; ga = zg(M[0], M[1])[0]; } else B = M;
  }
  var gz = zg(A[0], A[1]);
  return (Math.abs(gz[1]) < 1e-6 && Math.abs(gz[0]) < 1e-5) ? [A[0], A[1]] : null;
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

function terminator_curves(rec, t_first, t_last, step_min) {
  if (step_min === undefined) step_min = STEP_MIN;
  var EXT = 1.0, tmin = rec.tmin - EXT, tmax = rec.tmax + EXT, tstep = step_min / 60.0;
  var runs = [], cur = [], t = tmin;
  while (t <= tmax + 1e-9) {
    var r = term_crossings_at(rec, t);
    if (r !== null) cur.push([t].concat(r));
    else if (cur.length) { runs.push(cur); cur = []; }
    t += tstep;
  }
  if (cur.length) runs.push(cur);
  if (!runs.length) return [[], []];
  function tip_densify(t_far, t_tan, polish) {
    var n = 24; if (polish === undefined) polish = true;
    var out = [];
    for (var k = 1; k <= n; k++) {
      var frac = k / (n + 1), biased = 1.0 - Math.pow(1.0 - frac, 2), t_s = t_far + (t_tan - t_far) * biased;
      var rr = term_crossings_at(rec, t_s);
      if (rr === null) continue;
      var pa = f2g_term(rr[0], rr[1], rr[6], rr[7], rr[8]), pb = f2g_term(rr[2], rr[3], rr[6], rr[7], rr[8]);
      if (polish) { pa = rs_exact(rec, t_s, pa); pb = rs_exact(rec, t_s, pb); }
      out.push([pa ? [pa[1], pa[0]] : null, pb ? [pb[1], pb[0]] : null]);
    }
    return out;
  }
  function trim_tail(run_, kd_thresh) {
    if (!run_.length) return [];
    for (var i = run_.length - 1; i >= 0; i--) {
      var X = run_[i][5], Y = run_[i][6], L1 = run_[i][10], D = Math.sqrt(X * X + Y * Y);
      if (Math.abs((D * D + 1.0 - L1 * L1) / (2.0 * D)) <= kd_thresh) return run_.slice(0, i + 1);
    }
    return [];
  }
  var KD_THRESH = 0.99, loops = [];
  runs.forEach(function (run_orig) {
    var after_tail = trim_tail(run_orig, KD_THRESH);
    var after_head = trim_tail(after_tail.slice().reverse(), KD_THRESH).reverse();
    var run = after_head.length >= 2 ? after_head : run_orig;
    var t_first_samp = run[0][0], t_last_samp = run[run.length - 1][0];
    var t_start_tan = null, tip_start = null, t_end_tan = null, tip_end = null;
    var t_prev_start = run_orig[0][0] - tstep;
    if (t_prev_start >= tmin - 1e-12 && term_crossings_at(rec, t_prev_start) === null) {
      t_start_tan = term_tangency_time(rec, t_prev_start, run_orig[0][0]); tip_start = term_tangent_point(rec, t_start_tan);
    }
    var t_next_end = run_orig[run_orig.length - 1][0] + tstep;
    if (t_next_end <= tmax + 1e-12 && term_crossings_at(rec, t_next_end) === null) {
      t_end_tan = term_tangency_time(rec, t_next_end, run_orig[run_orig.length - 1][0]); tip_end = term_tangent_point(rec, t_end_tan);
    }
    function branch_pt(ti, branch) {
      var rr = term_crossings_at(rec, ti);
      if (rr === null) return null;
      return branch === 'a' ? rs_exact(rec, ti, f2g_term(rr[0], rr[1], rr[6], rr[7], rr[8]))
                            : rs_exact(rec, ti, f2g_term(rr[2], rr[3], rr[6], rr[7], rr[8]));
    }
    function pinch_edge(t_good, t_bad, branch) {
      var best = null;
      for (var i = 0; i < 14; i++) {
        var tm = 0.5 * (t_good + t_bad), p = branch_pt(tm, branch);
        if (p) { t_good = tm; best = p; } else t_bad = tm;
      }
      return best;
    }
    function pinch_ladder(t_far, t_bad, branch) {
      var tip = pinch_edge(t_far, t_bad, branch);
      return tip ? [[tip[1], tip[0]]] : [];
    }
    var res_a = [], res_b = [];
    run.forEach(function (s) {
      res_a.push([s[0], rs_exact(rec, s[0], f2g_term(s[1], s[2], s[7], s[8], s[9]), true, 60.0)]);
      res_b.push([s[0], rs_exact(rec, s[0], f2g_term(s[3], s[4], s[7], s[8], s[9]), true, 60.0)]);
    });
    var curve_a = [], curve_b = [];
    [[res_a, curve_a, 'a'], [res_b, curve_b, 'b']].forEach(function (x) {
      var res = x[0], curve = x[1], branch = x[2];
      res.forEach(function (tp, k) {
        var ti = tp[0], p = tp[1];
        if (p !== null) {
          if (k > 0 && res[k - 1][1] === null && curve.length)
            Array.prototype.push.apply(curve, pinch_ladder(ti, res[k - 1][0], branch).reverse());
          curve.push([p[1], p[0]]);
        } else if (k > 0 && res[k - 1][1] !== null) {
          Array.prototype.push.apply(curve, pinch_ladder(res[k - 1][0], ti, branch));
        }
      });
    });
    function split(dens) {
      return [dens.filter(function (d) { return d[0] !== null; }).map(function (d) { return d[0]; }),
              dens.filter(function (d) { return d[1] !== null; }).map(function (d) { return d[1]; })];
    }
    var sd_a = [], sd_b = [], ed_a = [], ed_b = [], sp;
    if (t_start_tan !== null) { sp = split(tip_densify(t_first_samp, t_start_tan).reverse()); sd_a = sp[0]; sd_b = sp[1]; }
    if (t_end_tan !== null) { sp = split(tip_densify(t_last_samp, t_end_tan)); ed_a = sp[0]; ed_b = sp[1]; }
    if (t_end_tan !== null) {
      Array.prototype.push.apply(ed_a, pinch_ladder(t_last_samp, t_end_tan, 'a'));
      Array.prototype.push.apply(ed_b, pinch_ladder(t_last_samp, t_end_tan, 'b'));
    }
    if (t_start_tan !== null) {
      sd_a = pinch_ladder(t_first_samp, t_start_tan, 'a').reverse().concat(sd_a);
      sd_b = pinch_ladder(t_first_samp, t_start_tan, 'b').reverse().concat(sd_b);
    }
    function chain_gap(chain) {
      var pts = chain.filter(function (q) { return q !== null; }), worst = 0.0;
      for (var i = 0; i < pts.length - 1; i++) {
        var h = Math.pow(Math.sin((pts[i + 1][1] - pts[i][1]) * DEG / 2), 2) + Math.cos(pts[i][1] * DEG) * Math.cos(pts[i + 1][1] * DEG) * Math.pow(Math.sin((pts[i + 1][0] - pts[i][0]) * DEG / 2), 2);
        worst = Math.max(worst, 6371.0 * 2.0 * Math.asin(Math.min(1.0, Math.sqrt(Math.abs(h)))));
      }
      return worst;
    }
    function ll_(tp) { return tp ? [tp[1], tp[0]] : null; }
    var SEAM_MAX = 220.0;
    if (t_end_tan !== null) {
      var chainE = curve_a.slice(-1).concat(ed_a, [ll_(tip_end)], ed_b.slice().reverse(), curve_b.slice(-1));
      if (chain_gap(chainE) > SEAM_MAX) {
        sp = split(tip_densify(t_last_samp, t_end_tan, false)); ed_a = sp[0]; ed_b = sp[1];
        tip_end = term_tangent_point(rec, t_end_tan, false);
      }
    }
    if (t_start_tan !== null) {
      var chainS = curve_b.slice(0, 1).concat(sd_b.slice().reverse(), [ll_(tip_start)], sd_a, curve_a.slice(0, 1));
      if (chain_gap(chainS) > SEAM_MAX) {
        sp = split(tip_densify(t_first_samp, t_start_tan, false).reverse()); sd_a = sp[0]; sd_b = sp[1];
        tip_start = term_tangent_point(rec, t_start_tan, false);
      }
    }
    var full_a = sd_a.concat(curve_a, ed_a), full_b = sd_b.concat(curve_b, ed_b);
    var loop = [];
    if (tip_start) loop.push([tip_start[1], tip_start[0]]);
    Array.prototype.push.apply(loop, full_a);
    if (tip_end) loop.push([tip_end[1], tip_end[0]]);
    Array.prototype.push.apply(loop, full_b.slice().reverse());
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
function bisect_umbra_at_t(rec, p_lat, p_lon, bearing_rad, t, search_m, iters) {
  if (search_m === undefined) search_m = 400000; if (iters === undefined) iters = 24;
  var R_E = R_EARTH_M, lat0 = p_lat * DEG, lon0 = p_lon * DEG, cos_lat0 = Math.cos(lat0), sin_lat0 = Math.sin(lat0);
  var cos_b = Math.cos(bearing_rad), sin_b = Math.sin(bearing_rad);
  var b = bstate(rec, t), d_r = b[4], mu = b[5], dt_s = b[6];
  var sin_d = Math.sin(d_r), cos_d = Math.cos(d_r), rho1 = Math.sqrt(1.0 - E2 * cos_d * cos_d);
  var sin_d1 = sin_d / rho1, cos_d1 = Math.sqrt(1.0 - E2) * cos_d / rho1;
  function at_dist(d) {
    var ang = d / R_E, s2 = clamp(sin_lat0 * Math.cos(ang) + cos_lat0 * Math.sin(ang) * cos_b, -1.0, 1.0), lat2 = Math.asin(s2);
    var lon2 = lon0 + Math.atan2(sin_b * Math.sin(ang) * cos_lat0, Math.cos(ang) - sin_lat0 * s2);
    return [lat2 / DEG, pmod(lon2 / DEG + 180, 360) - 180];
  }
  function zeta_at(ll) {
    var lat_gc = Math.atan(Math.tan(ll[0] * DEG) * Math.sqrt(1.0 - E2));
    var H_deg = pmod(ll[1] + mu - 0.00417807 * dt_s, 360);
    if (H_deg > 180) H_deg -= 360;
    return Math.sin(lat_gc) * sin_d1 + Math.cos(lat_gc) * Math.cos(H_deg * DEG) * cos_d1;
  }
  if (magnitude_at(rec, p_lat, p_lon, t) < 1.0 - 1e-9) return null;
  var HALF_CIRC = Math.PI * R_E, term_m = HALF_CIRC, i;
  if (!(zeta_at(at_dist(HALF_CIRC)) > 0)) {
    var tlo = 0.0, thi = HALF_CIRC;
    for (i = 0; i < iters; i++) { var tm = 0.5 * (tlo + thi); if (zeta_at(at_dist(tm)) > 0) tlo = tm; else thi = tm; }
    term_m = tlo;
  }
  var lo = 0.0, hi = Math.min(search_m, term_m), q;
  q = at_dist(hi); if (magnitude_at(rec, q[0], q[1], t) >= 1.0 - 1e-9) hi = term_m;
  q = at_dist(hi); if (magnitude_at(rec, q[0], q[1], t) >= 1.0 - 1e-9) return at_dist(term_m);
  for (i = 0; i < iters; i++) {
    var mid = 0.5 * (lo + hi); q = at_dist(mid);
    if (magnitude_at(rec, q[0], q[1], t) >= 1.0 - 1e-9) lo = mid; else hi = mid;
  }
  return at_dist(0.5 * (lo + hi));
}
function umbra_ovals(rec, oval_step_min, N) {
  if (oval_step_min === undefined) oval_step_min = OVAL_STEP_MIN; if (N === undefined) N = 48;
  var step = oval_step_min / 60.0, half_width_m = (rec.path_width || 0) * 500.0;
  var oval_search_m = Math.max(half_width_m * 1.5, 400000), ovals = [], t = rec.tmin;
  while (t <= rec.tmax + 1e-9) {
    var cl = centreline_pt(rec, t);
    if (cl === null) { t += step; continue; }
    var cl_lat = cl[0], cl_lon = cl[1];
    if (magnitude_at(rec, cl_lat, cl_lon, t) < 1.0 - 1e-9) { t += step; continue; }
    var raw = [], bad = false, i;
    for (i = 0; i < N; i++) {
      var bearing = 2.0 * Math.PI * i / N, edge = bisect_umbra_at_t(rec, cl_lat, cl_lon, bearing, t, oval_search_m);
      if (edge === null) { bad = true; break; }
      raw.push([bearing, edge[0], edge[1]]);
    }
    if (bad || raw.length < 3) { t += step; continue; }
    var MAX_DEG = 0.3;
    for (var pass = 0; pass < 4; pass++) {
      var refined = [raw[0]], changed = false;
      for (var j = 1; j < raw.length; j++) {
        var a = refined[refined.length - 1], c = raw[j];
        if (Math.sqrt(Math.pow(c[1] - a[1], 2) + Math.pow(c[2] - a[2], 2)) > MAX_DEG) {
          var b_mid = (a[0] + c[0]) / 2, e = bisect_umbra_at_t(rec, cl_lat, cl_lon, b_mid, t, oval_search_m);
          if (e) { refined.push([b_mid, e[0], e[1]]); changed = true; }
        }
        refined.push(c);
      }
      raw = refined;
      if (!changed) break;
    }
    var ring = raw.map(function (p) { return [pyround(p[2], 4), pyround(p[1], 4)]; });
    ring.push(ring[0]);
    ovals.push(ring);
    t += step;
  }
  return ovals;
}

/* ── Simplification, pole split, rounding ──────────────────────────────── */
function dp_perp(p, a, b) {
  var dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / Math.hypot(dx, dy);
}
function simplify_dp(pts, tol) {
  var n = pts.length, max_segment_km = 200.0, i, k;
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
    for (i = lo + 1; i < hi; i++) { var d = dp_perp(pts[i], a, b); if (d > worst_d) { worst_d = d; worst_i = i; } }
    if (worst_d > tol) { keep[worst_i] = true; stack.push([lo, worst_i]); stack.push([worst_i, hi]); }
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
    if (k === 'green_curve' && Array.isArray(v))
      result[k] = v.map(function (p) { return p === null ? null : [pyround(p[0], 3), pyround(p[1], 3)]; });
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
  ['centreline', 'umbra_n', 'umbra_s', 'umbra_ovals'].forEach(function (f) { result[f] = result[f].map(function (s) { return simplify_dp(s, DP_TIGHT); }); });
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
  bstate: bstate, f2g: f2g, centreline_pt: centreline_pt,
  umbral_limits_field: umbral_limits_field, umbral_limits_valid: umbral_limits_valid, umb_depth: umb_depth,
  green_curve: green_curve, penumbra_both: penumbra_both, pyround: pyround, terminators_test: terminators_test, umbra_ovals: umbra_ovals, compute_ge: compute_ge, eclipse_path: eclipse_path
};
if (typeof module !== 'undefined') module.exports = api;
if (typeof self !== 'undefined') self.PathGen = api;
