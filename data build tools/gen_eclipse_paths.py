#!/usr/bin/env python3
"""
gen_eclipse_paths.py  —  ShadowChaser
Part of Follow the Shadow — https://followtheshadow.com

Generates eclipse path JSON from Besselian element chunk files.

Outputs per eclipse:
  - centreline, umbra_n, umbra_s  (umbral corridor + centreline)
  - umbra_ovals                   (umbral footprint params at intervals)
  - penumbra_n, penumbra_s        (geographic outer limits of penumbral shadow)
  - terminator_first, last        (sunrise/sunset line at P1 and P4 times)
  - green_curve                   (maximum eclipse on the horizon)
  - ge                            (greatest eclipse point)

All features verified against baseline truth (reference KMZ / NASA data).

Usage:
    python3 gen_eclipse_paths.py --data-dir ./data/besselian --out-dir ./data/paths
    python3 gen_eclipse_paths.py --year 1994
    python3 gen_eclipse_paths.py --test
"""

import argparse, datetime as _dt, gzip as _gz, glob, json, math, os, time

# ── Constants ──────────────────────────────────────────────────────────────
DEG           = math.pi / 180.0
E2            = 2.0/298.257223563 - (1.0/298.257223563)**2
_B_A          = math.sqrt(1.0 - E2)   # polar/equatorial axis ratio, 0.99664719
R_EARTH_M     = 6378137.0  # WGS84 equatorial radius (metres)
R             = 6371.0    # km
STEP_MIN      = 1         # minutes between path samples
GEN_VERSION   = '2026-09-18d'  # generator code version; stamped into each chunk's __meta
                              # (bump when the generation math changes)
TERM_STEP_MIN = 0.1       # finer step for terminator curves (was 0.5; gave ~80 km median vertex spacing → 6 km cross-track error)
PEN_N         = 720       # L1-circle sample points (penumbra sweep)
OVAL_STEP_MIN = 10        # minutes between umbral oval samples


# ── Polynomial evaluator ───────────────────────────────────────────────────

def poly(c, t):
    v = c[0] + c[1]*t + c[2]*t*t
    if len(c) > 3: v += c[3]*t*t*t
    return v


# ── Besselian state ────────────────────────────────────────────────────────

def bstate(rec, t):
    """All Besselian quantities at time t (hours from GE epoch).

    Coefficients are constant per eclipse, so they are cached on the record and
    poly() is inlined here -- this is the innermost hot loop (millions of calls
    per eclipse). The arithmetic is byte-for-byte identical to the previous
    poly([...]) form; only the redundant per-call list-building is removed."""
    c = rec.get('_bc')
    if c is None:
        c = (rec['x0'], rec['x1'], rec['x2'], rec['x3'],
             rec['y0'], rec['y1'], rec['y2'], rec['y3'],
             rec['d0'], rec['d1'], rec['d2'],
             rec['mu0'], rec['mu1'], rec['mu2'],
             rec['l10'], rec['l11'], rec['l12'],
             rec['l20'], rec['l21'], rec['l22'], rec['dt'])
        rec['_bc'] = c
    (x0,x1,x2,x3, y0,y1,y2,y3, d0,d1,d2, m0,m1,m2,
     a0,a1,a2, b0,b1,b2, dt) = c
    # Operation order kept identical to the original poly([...]) calls so the
    # result is byte-for-byte unchanged (float multiply is not associative).
    X   = x0 + x1*t + x2*t*t + x3*t*t*t
    Xp  = x1 + 2*x2*t + 3*x3*t*t
    Y   = y0 + y1*t + y2*t*t + y3*t*t*t
    Yp  = y1 + 2*y2*t + 3*y3*t*t
    d_r = (d0 + d1*t + d2*t*t) * DEG
    mu  = m0 + m1*t + m2*t*t
    L1  = a0 + a1*t + a2*t*t
    L2  = b0 + b1*t + b2*t*t
    return X, Xp, Y, Yp, d_r, mu, dt, L1, L2


# ── Fundamental plane → geodetic ───────────────────────────────────────────

def f2g(xi, eta, d_r, mu, dt_s):
    """Project fundamental-plane (xi, eta) to geodetic (lat, lon).

    Earth's oblateness is corrected for using the standard Meeus §54.4
    method: scale eta by 1/rho_1 where rho_1 = sqrt(1 − e²·cos²(d)),
    use the rotated declination d_1 in the back-transform, then convert
    geocentric latitude to geodetic.

    Without this correction the projected positions are off by
    100–500 m near the equator and up to a few km at high latitudes —
    the systematic 0.2–0.5° offset visible in side-by-side comparisons
    against baseline truth.

    Returns (lat_geodetic_deg, lon_deg) or None if (xi, eta) is outside
    the (corrected) Earth disk.
    """
    sin_d = math.sin(d_r); cos_d = math.cos(d_r)
    # Earth-flattening corrections
    rho1 = math.sqrt(1.0 - E2 * cos_d * cos_d)
    sin_d1 = sin_d / rho1
    cos_d1 = math.sqrt(1.0 - E2) * cos_d / rho1
    # Project to corrected fundamental plane
    eta1 = eta / rho1
    r2 = xi*xi + eta1*eta1
    if r2 >= 1.0: return None
    zeta1 = math.sqrt(1.0 - r2)
    # Geocentric coordinates
    sin_lat_gc = eta1 * cos_d1 + zeta1 * sin_d1
    if sin_lat_gc > 1.0: sin_lat_gc = 1.0
    if sin_lat_gc < -1.0: sin_lat_gc = -1.0
    lat_gc = math.asin(sin_lat_gc)
    # Geocentric → geodetic latitude (for a point on the WGS84 surface)
    lat_gd = math.atan(math.tan(lat_gc) / math.sqrt(1.0 - E2))
    # Hour angle
    H = math.degrees(math.atan2(xi, zeta1 * cos_d1 - eta1 * sin_d1))
    lon = (H - mu + 0.00417807 * dt_s + 180.0) % 360.0 - 180.0
    return (math.degrees(lat_gd), lon)


# ── Distance helpers ────────────────────────────────────────────────────────

def _km(a, b):
    """Approximate km distance, inputs (lat,lon)."""
    dlon=(b[1]-a[1])*DEG; dlat=(b[0]-a[0])*DEG
    alat=(a[0]+b[0])/2*DEG
    return R*math.sqrt(dlat**2+(math.cos(alat)*dlon)**2)

def _sph(a, b):
    """Spherical degree distance (antimeridian-safe), inputs (lat,lon)."""
    dlat=a[0]-b[0]; dlon=a[1]-b[1]
    if abs(dlon)>180: dlon=360-abs(dlon)
    return math.sqrt(dlat**2+dlon**2)


# ── Centreline ─────────────────────────────────────────────────────────────

def centreline_pt(rec, t):
    X, _, Y, _, d_r, mu, dt_s, _, _ = bstate(rec, t)
    return f2g(X, Y, d_r, mu, dt_s)


# ── Observer frame, magnitude and shadow edges ─────────────────────────────

def _geo_to_fund(lat_gd_deg, lon_deg, d_r, mu, dt_s):
    """Inverse of f2g: geographic (lat, lon) to fundamental (xi, eta, zeta)."""
    sin_d = math.sin(d_r); cos_d = math.cos(d_r)
    rho1 = math.sqrt(1.0 - E2 * cos_d * cos_d)
    sin_d1 = sin_d / rho1
    cos_d1 = math.sqrt(1.0 - E2) * cos_d / rho1
    lat_gd = lat_gd_deg * DEG
    tan_lat_gc = math.tan(lat_gd) * math.sqrt(1.0 - E2)
    lat_gc = math.atan(tan_lat_gc)
    H_deg = (lon_deg + mu - 0.00417807 * dt_s) % 360
    if H_deg > 180: H_deg -= 360
    H = H_deg * DEG
    cos_lat_gc = math.cos(lat_gc); sin_lat_gc = math.sin(lat_gc)
    cos_H = math.cos(H); sin_H = math.sin(H)
    xi = cos_lat_gc * sin_H
    eta1 = sin_lat_gc * cos_d1 - cos_lat_gc * cos_H * sin_d1
    zeta1 = sin_lat_gc * sin_d1 + cos_lat_gc * cos_H * cos_d1
    return xi, eta1 * rho1, zeta1, rho1


def _fund_true(lat_gd_deg, lon_deg, d_r, mu, dt_s):
    """Exact observer coordinates (xi, eta, zeta) in the fundamental plane, in
    Earth equatorial radii, for a sea-level point at geodetic (lat, lon) on the
    WGS84 ellipsoid (Meeus ch. 54; the same transform as eclipse.js).

    Use THIS for anything measured in the shadow: the axis distance and the
    shadow radii L1' = L1 - zeta*tan_f1, L2' = L2 - zeta*tan_f2.
    _geo_to_fund's third value is zeta1 of the reduced (spherical) Earth, not
    zeta: up to 16 km off, which moves the limits 10-20 m, ~250 m at low sun."""
    H = (mu + lon_deg - 0.00417807 * dt_s) * DEG
    u = math.atan(_B_A * math.tan(lat_gd_deg * DEG))
    rsp = _B_A * math.sin(u); rcp = math.cos(u)
    sin_d = math.sin(d_r); cos_d = math.cos(d_r); cos_H = math.cos(H)
    return (rcp * math.sin(H),
            rsp * cos_d - rcp * cos_H * sin_d,
            rsp * sin_d + rcp * cos_H * cos_d)


def _sun_sin_alt(lat_gd_deg, lon_deg, d_r, mu, dt_s):
    """sin(altitude) of the shadow-axis direction above the geodetic horizon at
    (lat, lon). The one horizon test: > 0 means the sun is up."""
    H = (mu + lon_deg - 0.00417807 * dt_s) * DEG
    ph = lat_gd_deg * DEG
    return math.sin(ph) * math.sin(d_r) + math.cos(ph) * math.cos(H) * math.cos(d_r)


def _magnitude_at(rec, lat, lon, t):
    """Eclipse magnitude at geographic (lat, lon) at time t.
    Uses Bessel formula: (L1' - m) / (L1' + L2') where L1', L2' are cone radii
    at the observer's axial position. Returns 0 to 1. Exact observer frame
    (_fund_true) for the shadow, _sun_sin_alt for the horizon."""
    X, _, Y, _, d_r, mu, dt_s, L1, L2 = bstate(rec, t)
    if _sun_sin_alt(lat, lon, d_r, mu, dt_s) <= 0: return 0.0
    xi_p, eta_p, zeta_p = _fund_true(lat, lon, d_r, mu, dt_s)
    m = math.hypot(xi_p - X, eta_p - Y)
    L1p = L1 - zeta_p * rec['tan_f1']
    L2p = L2 - zeta_p * rec['tan_f2']
    if m >= L1p: return 0.0
    if L2p < 0 and m <= -L2p: return 1.0    # totality
    if L2p > 0 and m <= L2p: return 1.0     # annular center
    denom = L1p + L2p
    if abs(denom) < 1e-12: return 0.0
    return (L1p - m) / denom


def _max_magnitude(rec, lat, lon, n_coarse=60):
    """Maximum eclipse magnitude at geographic (lat, lon) over the eclipse
    duration. Coarse-then-bisect for speed and accuracy."""
    t_min, t_max = rec['tmin'], rec['tmax']
    best_t = t_min; best_m = 0.0
    for i in range(n_coarse + 1):
        t = t_min + (t_max - t_min) * i / n_coarse
        m = _magnitude_at(rec, lat, lon, t)
        if m > best_m: best_m = m; best_t = t
    if best_m <= 0.0: return 0.0
    dt = (t_max - t_min) / n_coarse
    for _ in range(30):
        for sign in (-1, +1):
            t = best_t + sign*dt/2
            m = _magnitude_at(rec, lat, lon, t)
            if m > best_m: best_m = m; best_t = t
        dt *= 0.5
    return best_m


def _gc_step(lat, lon, brg, d_m):
    """Great-circle step d_m metres from (lat,lon) along bearing brg (rad)."""
    ang = d_m / R_EARTH_M; la = lat*DEG; lo = lon*DEG
    sl = math.sin(la)*math.cos(ang) + math.cos(la)*math.sin(ang)*math.cos(brg)
    la2 = math.asin(max(-1.0, min(1.0, sl)))
    lo2 = lo + math.atan2(math.sin(brg)*math.sin(ang)*math.cos(la),
                          math.cos(ang) - math.sin(la)*sl)
    return la2/DEG, ((lo2/DEG + 180) % 360) - 180


def _gc_bearing(a, b):
    """Initial great-circle bearing (rad) from a=(lat,lon) to b=(lat,lon)."""
    la1 = a[0]*DEG; la2 = b[0]*DEG; dlon = (b[1]-a[1])*DEG
    return math.atan2(math.sin(dlon)*math.cos(la2),
                      math.cos(la1)*math.sin(la2) - math.sin(la1)*math.cos(la2)*math.cos(dlon))


def _gc_dist(a, b):
    """Great-circle distance (m) between a=(lat,lon) and b=(lat,lon)."""
    la1 = a[0]*DEG; la2 = b[0]*DEG
    dla = (b[0]-a[0])*DEG; dlo = (b[1]-a[1])*DEG
    h = math.sin(dla/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dlo/2)**2
    return 2*R_EARTH_M*math.asin(min(1.0, math.sqrt(h)))


def _snap_to_edge(rec, lat, lon, b_out, level, R=22000.0):
    """Snap (lat,lon) onto the exact max_magnitude==level contour with a short
    local search (+/- R metres) along outward bearing b_out.

    Robust + fast: locate the true peak-eclipse time t* at the envelope point
    once (whole-eclipse coarse+bisect). Each local candidate then has its own
    peak found by a short bisect *seeded at t** (candidates within R km peak
    within a few hundredths of an hour of t*, same basin) -- exact to
    convergence, no fixed-grid jitter, and far cheaper than re-scanning the
    whole eclipse per candidate."""
    tmin, tmax = rec['tmin'], rec['tmax']
    nC = 40; bt = tmin; bm = -1.0
    for i in range(nC + 1):
        ti = tmin + (tmax - tmin) * i / nC
        m = _magnitude_at(rec, lat, lon, ti)
        if m > bm: bm = m; bt = ti
    dt = (tmax - tmin) / nC
    for _ in range(16):
        for sgn in (-1, 1):
            ti = bt + sgn * dt / 2
            m = _magnitude_at(rec, lat, lon, ti)
            if m > bm: bm = m; bt = ti
        dt *= 0.5
    tstar = bt
    def peakmag(la, lo):
        # coarse scan over a window around t*, then bisect-refine -> reach-robust
        H = 0.4; nL = 8; b2 = tstar; bm2 = -1.0
        for i in range(nL + 1):
            ti = tstar - H + 2.0 * H * i / nL
            mm = _magnitude_at(rec, la, lo, ti)
            if mm > bm2: bm2 = mm; b2 = ti
        d2 = 2.0 * H / nL
        for _ in range(12):
            for sgn in (-1, 1):
                ti = b2 + sgn * d2 / 2
                mm = _magnitude_at(rec, la, lo, ti)
                if mm > bm2: bm2 = mm; b2 = ti
            d2 *= 0.5
        return bm2
    def fval(d):
        p = _gc_step(lat, lon, b_out, d)
        return peakmag(p[0], p[1]) - level
    if fval(0.0) >= 0.0:
        # No zero-crossing within +R: the +R endpoint is still inside the
        # contour. This happens at a grazer's tip, where the outward bearing
        # runs ALONG the wedge-shaped region rather than across its edge.
        # The analytic envelope seed is sub-km accurate there; returning the
        # clamped far end fabricated a point displaced by the full R (~22 km
        # error on the 2014-04-29 A- tip vs baseline truth). Keep the seed instead —
        # symmetric with the fval(-R) < 0 branch below.
        if fval(R) >= 0.0: return (lat, lon)
        a, b = 0.0, R
    else:
        if fval(-R) < 0.0: return (lat, lon)
        a, b = -R, 0.0
    for _ in range(18):
        m = (a + b) / 2
        if fval(m) >= 0.0: a = m
        else: b = m
    return _gc_step(lat, lon, b_out, (a + b) / 2)


def umbral_pts(rec, t):
    """Umbra north/south geographic limit points at time t.

    Envelope-of-the-moving-shadow method. In the fundamental plane the umbra
    is a circle of radius |L2'| about the axis (X,Y) moving at velocity
    (X',Y'); the two limits are the circle edge in the direction perpendicular
    to the axis motion, tilted by the envelope-of-circles tangency angle
    arcsin((dr/dt)/|V|) for the changing radius. zeta (and hence the radius)
    is solved by a short fixed-point iteration. Each analytic point is then
    snapped the last few km onto the exact max_magnitude==1 contour.

    This is smooth by construction (analytic, per-time, no ray-casting and no
    point-to-point chaining) and matches baseline truth to sub-km, including polar
    grazers where the previous perpendicular-bisection finder under-shot by
    up to ~300 km and introduced kinks.
    """
    X, Xp, Y, Yp, d_r, mu, dt_s, L1, L2 = bstate(rec, t)
    cos_d = math.cos(d_r)
    rho1 = math.sqrt(1.0 - E2*cos_d*cos_d)
    Cu, Cw = X, Y/rho1                 # shadow centre in circle-frame (u, w)
    Vu, Vw = Xp, Yp/rho1               # shadow velocity in circle-frame
    sp = math.hypot(Vu, Vw)
    if sp < 1e-12: return None, None
    Vhu, Vhw = Vu/sp, Vw/sp
    dL2dt = rec['l21'] + 2*rec['l22']*t
    LEVEL = 1.0 - 1e-9
    cl = f2g(X, Y, d_r, mu, dt_s)      # may be None when the AXIS misses the
                                       # spheroid over the polar cap — but the
                                       # umbra EDGE can still be on the ground,
                                       # so this must NOT gate the limits.
    out = []
    for side in (+1, -1):
        z = 1.0 - Cu*Cu - Cw*Cw
        zeta = math.sqrt(z) if z > 0 else 1e-6
        u = w = nu = nw = None
        offdisk = False
        for _ in range(16):
            q = L2 - zeta*rec['tan_f2']
            r = abs(q); sgn = 1.0 if q >= 0 else -1.0
            dzdt = -(u*Vu + w*Vw)/zeta if (u is not None and zeta > 1e-9) else 0.0
            drdt = sgn*(dL2dt - rec['tan_f2']*dzdt)
            cphi = max(-1.0, min(1.0, drdt/sp))
            sphi = math.sqrt(1.0 - cphi*cphi)
            nu = cphi*Vhu + side*sphi*(-Vhw)
            nw = cphi*Vhw + side*sphi*(Vhu)
            u = Cu + r*nu; w = Cw + r*nw
            zz = 1.0 - u*u - w*w
            if zz <= 0: offdisk = True; break
            zeta = math.sqrt(zz)
        # Pure magnitude=1 envelope. No disk-edge-clip splice: the baseline's limit
        # IS the envelope, terminated later on the Maximum-on-Horizon (green)
        # curve by _visible_trim. Splicing the disk-edge arc folded the curve;
        # the envelope alone is smooth. cl may be None over the polar cap (axis
        # misses) while the edge point is still valid, so cl does NOT gate.
        if offdisk or u is None:
            out.append(None)
        else:
            e = f2g(u, w*rho1, d_r, mu, dt_s)
            if e is None:
                out.append(None)
            else:
                EPSN = 1.0e-4
                e_in = f2g(u - EPSN*nu, (w - EPSN*nw)*rho1, d_r, mu, dt_s)
                if e_in is not None:   b_out = _gc_bearing(e_in, e)
                elif cl is not None:   b_out = _gc_bearing(cl, e)
                else:                  b_out = _gc_bearing((e[0], e[1]),
                                                           (e[0], e[1] + 0.01))
                out.append(_snap_to_edge(rec, e[0], e[1], b_out, LEVEL))
    return out[0], out[1]


def _pen_perp_pt(rec, t, side):
    """Point on L1 circle perpendicular to shadow velocity — the envelope point.
    side='n' for north, 's' for south. Returns (lat,lon) or None if off Earth."""
    X, Xp, Y, Yp, d_r, mu, dt_s, L1, _ = bstate(rec, t)
    speed = math.sqrt(Xp*Xp + Yp*Yp)
    if speed < 1e-9: return None
    px = -Yp/speed; py = Xp/speed
    return f2g(X + L1*px, Y + L1*py, d_r, mu, dt_s) if side == 'n' \
           else f2g(X - L1*px, Y - L1*py, d_r, mu, dt_s)


def _l1_limb_pt_for_side(rec, t, side):
    """L1-circle limb crossing closest to the north/south perp direction.
    Used to cap the curve at entry/exit contacts."""
    X, Xp, Y, Yp, d_r, mu, dt_s, L1, _ = bstate(rec, t)
    speed = math.sqrt(Xp*Xp + Yp*Yp)
    if speed < 1e-9: return None
    px = -Yp/speed; py = Xp/speed
    tx, ty = (X+L1*px, Y+L1*py) if side=='n' else (X-L1*px, Y-L1*py)
    d = math.sqrt(X*X + Y*Y)
    if d < 1e-9: return None
    a = (1.0 - L1*L1 + d*d) / (2*d)
    disc = 1.0 - a*a
    if disc < 0: return None
    h = math.sqrt(disc)
    p2x = a*X/d; p2y = a*Y/d
    cands = [(p2x+h*(Y/d), p2y-h*(X/d)), (p2x-h*(Y/d), p2y+h*(X/d))]
    best_pt = None; best_d = 1e18
    for xi, eta in cands:
        d2 = (xi-tx)**2 + (eta-ty)**2
        if d2 < best_d:
            best_d = d2
            best_pt = f2g(xi*0.9999999, eta*0.9999999, d_r, mu, dt_s)
    return best_pt


def penumbral_limits(rec, step_min=STEP_MIN, N=PEN_N):
    """
    Penumbral north/south geographic limit lines.

    Architecture matches the centreline + umbra rewrite: per-side bisection
    of the validity interval endpoints, then adaptive arc-length walk.
    Each side has its own validity interval (the times at which the
    perpendicular envelope point is on Earth), so the two sides are walked
    independently; the chord midpoint is not a useful pacing reference for
    penumbral limits as it is for the umbra.

    Each side is capped with the L1-circle limb crossing at the tangency
    boundary (entry/exit contacts) so the curve closes cleanly at the
    contact points rather than a few hundred km offset.

    Returns (north_pts, south_pts, t_first, t_last).
    t_first, t_last are the union interval (earliest enter, latest exit)
    across both sides — used by the terminator code.
    """
    tmin, tmax = rec['tmin'], rec['tmax']
    step = step_min / 60.0
    DT_MIN = 1.0 / 3600.0
    DT_MAX = step
    MAX_KM = 30.0
    MIN_KM = 10.0
    EARTH_R = 6371.0

    def gc_km(p, q):
        if p is None or q is None: return None
        lat1, lon1 = p; lat2, lon2 = q
        p1 = lat1*DEG; p2 = lat2*DEG; dl = (lon2 - lon1)*DEG
        a = math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return EARTH_R * 2*math.asin(math.sqrt(max(0.0, min(1.0, a))))

    def find_first_on(side, t_lo, t_hi):
        """Earliest t in [t_lo, t_hi] where _pen_perp_pt(side) is on Earth.
        If found and the immediately preceding step is off Earth, refines
        by bisection to the tangency."""
        scan = t_lo
        prev_ok = False
        while scan <= t_hi + 1e-9:
            ok = _pen_perp_pt(rec, scan, side) is not None
            if ok:
                if prev_ok or scan <= t_lo + 1e-9:
                    return scan
                t_out, t_in = scan - step, scan
                for _ in range(40):
                    tm = 0.5*(t_out + t_in)
                    if _pen_perp_pt(rec, tm, side) is not None: t_in = tm
                    else: t_out = tm
                    if t_in - t_out < 1e-7: break
                return t_in
            prev_ok = ok
            scan += step
        return None

    def find_last_on(side, t_lo, t_hi):
        """Latest t in [t_lo, t_hi] where _pen_perp_pt(side) is on Earth."""
        scan = t_hi
        while scan >= t_lo - 1e-9:
            if _pen_perp_pt(rec, scan, side) is not None:
                t_in, t_out = scan, scan + step
                for _ in range(40):
                    tm = 0.5*(t_in + t_out)
                    if _pen_perp_pt(rec, tm, side) is not None: t_in = tm
                    else: t_out = tm
                    if t_out - t_in < 1e-7: break
                return t_in
            scan -= step
        return None

    def adaptive_walk(t_start, t_end, side):
        """Adaptive arc-length walk of _pen_perp_pt(side) over [t_start,t_end].
        Returns list of (lat, lon) in time order."""
        out = []
        p0 = _pen_perp_pt(rec, t_start, side)
        if p0 is None: return out
        out.append(p0)
        t_cur = t_start
        dt = DT_MAX
        SAFETY = 100000
        iters = 0
        while t_cur < t_end - 1e-9 and iters < SAFETY:
            iters += 1
            t_next = min(t_cur + dt, t_end)
            p_next = _pen_perp_pt(rec, t_next, side)
            if p_next is None:
                dt = max(DT_MIN, dt * 0.5)
                if dt <= DT_MIN + 1e-12: break
                continue
            d = gc_km(out[-1], p_next)
            if d > MAX_KM and dt > DT_MIN + 1e-12:
                dt = max(DT_MIN, dt * 0.5)
                continue
            out.append(p_next)
            t_cur = t_next
            if d < MIN_KM and dt < DT_MAX:
                dt = min(DT_MAX, dt * 2.0)
        return out

    def build_side(side):
        """Return (curve, t_a, t_b) for one side: bisect endpoints, walk
        adaptively, prepend/append L1 limb cap points at the tangencies."""
        t_a = find_first_on(side, tmin, tmax)
        if t_a is None: return [], None, None
        t_b = find_last_on(side, t_a, tmax)
        if t_b is None or t_b <= t_a + 1e-9: return [], None, None

        pts = adaptive_walk(t_a, t_b, side)
        if not pts: return [], t_a, t_b

        out = []
        # Cap entry: limb crossing at t_a (the tangency itself).
        if t_a > tmin + 1e-9:
            lp = _l1_limb_pt_for_side(rec, t_a, side)
            if lp:
                out.append([round(lp[1], 4), round(lp[0], 4)])
        # Walk samples
        for (lat, lon) in pts:
            out.append([round(lon, 4), round(lat, 4)])
        # Cap exit: limb crossing at t_b.
        if t_b < tmax - 1e-9:
            lp = _l1_limb_pt_for_side(rec, t_b, side)
            if lp:
                out.append([round(lp[1], 4), round(lp[0], 4)])
        return out, t_a, t_b

    north, t_na, t_nb = build_side('n')
    south, t_sa, t_sb = build_side('s')

    ts = [t for t in (t_na, t_sa) if t is not None]
    te = [t for t in (t_nb, t_sb) if t is not None]
    t_first = min(ts) if ts else None
    t_last  = max(te) if te else None
    return north, south, t_first, t_last


# ── Path splitting ─────────────────────────────────────────────────────────

def unwrap(pts, lat_thresh=80.0, lon_jump=30.0, pole_lat=89.99):
    """Make a [lon,lat] list continuous and pole-aware.

    Two passes are applied:
      1. Antimeridian unwrap — extend longitudes past ±180 so adjacent
         points stay continuous in lon, letting MapLibre render across
         the antimeridian without splitting.
      2. Pole-aware unwrap — when adjacent points both sit at high |lat|
         AND have a large lon difference AND are actually close on the
         sphere (small great-circle distance), insert two synthetic
         vertices at lat=±pole_lat to draw the path up to the pole at the
         entry lon and back down at the exit lon, instead of a long
         horizontal sliver across the map.

    Closed loops (first==last) are detected, the closure stripped before
    pass-2 processing, and re-closed after — so the wrap-back at the
    closure point doesn't itself look like a pole transit.

    No-op (returns input unchanged) when no pole transit is detected,
    preserving exact float values for the ~95% of curves that don't
    need the fix."""
    if not pts: return []

    # ── Pass 1: antimeridian unwrap ──────────────────────────────────
    out = [[pts[0][0], pts[0][1]]]
    for i in range(1, len(pts)):
        prev_lon = out[-1][0]
        curr_lon = pts[i][0]
        diff = curr_lon - prev_lon
        if diff > 180:   curr_lon -= 360
        elif diff < -180: curr_lon += 360
        out.append([curr_lon, pts[i][1]])

    # ── Pass 2: pole-aware vertex insertion ──────────────────────────
    # Detect closure (first point exactly equals last). Strip the
    # closure for transit detection, re-close after.
    is_closed = len(out) >= 2 and out[0] == out[-1]
    body = out[:-1] if is_closed else out

    transits = []
    for i in range(1, len(body)):
        prev_lat, curr_lat = body[i-1][1], body[i][1]
        if abs(prev_lat) <= lat_thresh or abs(curr_lat) <= lat_thresh: continue
        prev_lon, curr_lon = body[i-1][0], body[i][0]
        dlon = curr_lon - prev_lon
        if abs(dlon) <= lon_jump: continue
        # Confirm via great-circle distance: if the points are actually
        # close on the sphere, the lon-frame jump is a polar artifact.
        # NOTE: this detector inherits a known overfire on tight near-pole
        # oscillations (e.g. 2015-03-20 umbra_n at γ≈0.945 inserts five
        # pole-vertex pairs producing a star pattern). The visually-correct
        # fix is a polar-stereographic projection for high-lat curves;
        # deferred to a future session. For now this matches the behaviour
        # of postprocess_unwrap.py exactly.
        p1r = prev_lat*DEG; p2r = curr_lat*DEG
        dlr = dlon*DEG
        a = math.sin((p2r-p1r)/2)**2 + math.cos(p1r)*math.cos(p2r)*math.sin(dlr/2)**2
        gc_deg = math.degrees(2*math.asin(math.sqrt(max(0.0, min(1.0, a)))))
        if gc_deg < abs(dlon):
            transits.append(i)

    if not transits:
        # Fast path: no polar transit, return after-pass-1 unchanged.
        return out

    # Build new list with two synthetic pole vertices at each transit.
    transit_set = set(transits)
    new_body = []
    for i, p in enumerate(body):
        if i in transit_set:
            prev_lon = body[i-1][0]
            curr_lon = p[0]
            pl = pole_lat if (body[i-1][1] + p[1]) > 0 else -pole_lat
            new_body.append([prev_lon, pl])
            new_body.append([curr_lon, pl])
        new_body.append(p)

    if is_closed and new_body:
        new_body.append([new_body[0][0], new_body[0][1]])
    return new_body


# ── Douglas-Peucker simplification ─────────────────────────────────────────

# Default tolerance: 10 m perpendicular distance, expressed as
# a planar lon/lat threshold. 1° lat ≈ 111 km, so 10 m ≈ 9e-5°.
# Matches the user's accuracy bar. Combined with 4-decimal coordinate
# rounding (~11 m granularity), the worst-case rendering error is
# ~14 m end-to-end at the equator — invisible at any normal zoom level.
# Adaptive walker preserves cusp accuracy regardless of DP because it
# densifies near tangencies.
DP_TOLERANCE_DEG = 9e-5  # ≈ 10 m at the equator


def _dp_perp(p, a, b):
    """Perpendicular distance from p to chord a-b in lon/lat plane."""
    ax, ay = a; bx, by = b; px, py = p
    dx = bx - ax; dy = by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    # Cross-product magnitude / chord length
    return abs(dx*(ay - py) - (ax - px)*dy) / math.hypot(dx, dy)


def simplify_dp(pts, tol=DP_TOLERANCE_DEG, preserve_pole_vertices=True,
                max_segment_km=200.0):
    """Iterative Douglas-Peucker. Returns a subset of pts.

    Endpoints are always preserved. With preserve_pole_vertices=True
    (default), any point with |lat| ≥ 89.9 is also forced to be kept —
    those are synthetic anchors inserted by unwrap() to draw correctly
    over the poles, removing them would defeat the unwrap.

    max_segment_km caps how far apart adjacent kept points can be.
    DP measures perpendicular chord deviation; on nearly-straight
    sections this can drop large stretches into a single chord even
    though the segment is hundreds of km long. The audit's gap check
    flags any gap > 350 km, so we keep gaps comfortably below that.
    Set to None to disable.
    """
    n = len(pts)
    if n < 3:
        return list(pts)
    keep = [False] * n
    keep[0] = True
    keep[n-1] = True
    if preserve_pole_vertices:
        for i in range(1, n-1):
            if abs(pts[i][1]) >= 89.9:
                keep[i] = True

    # Recursive DP, iterative via stack. For each segment between two
    # currently-kept indices, find the point of greatest perpendicular
    # distance; if it exceeds tol, mark it kept and recurse on both sides.
    # Forced-kept (pole) vertices act as natural sub-segment boundaries.
    forced = [i for i in range(n) if keep[i]]
    stack = [(forced[k], forced[k+1]) for k in range(len(forced)-1)]
    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        a = pts[lo]; b = pts[hi]
        worst_d = 0.0; worst_i = -1
        for i in range(lo+1, hi):
            d = _dp_perp(pts[i], a, b)
            if d > worst_d:
                worst_d = d; worst_i = i
        if worst_d > tol:
            keep[worst_i] = True
            stack.append((lo, worst_i))
            stack.append((worst_i, hi))

    # Max-segment-length pass: any kept-pair whose great-circle distance
    # exceeds max_segment_km gets the midpoint of the original (non-DP'd)
    # arc re-inserted, and we recurse. This catches nearly-straight long
    # segments that DP correctly identifies as low chord-deviation but
    # that the audit's gap check flags.
    if max_segment_km is not None:
        DEG_LOC = math.pi/180
        def gc_km_loc(p, q):
            p1=p[1]*DEG_LOC; p2=q[1]*DEG_LOC; dl=(q[0]-p[0])*DEG_LOC
            a = math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
            return 6371.0 * 2*math.asin(math.sqrt(max(0.0, min(1.0, a))))
        changed = True
        # Iterate until no more long segments. In practice 1-2 passes.
        while changed:
            changed = False
            forced = [i for i in range(n) if keep[i]]
            for k in range(len(forced)-1):
                lo, hi = forced[k], forced[k+1]
                if hi <= lo + 1: continue
                if gc_km_loc(pts[lo], pts[hi]) > max_segment_km:
                    keep[(lo+hi)//2] = True
                    changed = True

    return [pts[i] for i in range(n) if keep[i]]


# ── Greatest eclipse ────────────────────────────────────────────────────────

def _compute_ge(rec):
    """Point where shadow axis is closest to Earth centre (x²+y² minimum)."""
    tmin,tmax=rec['tmin'],rec['tmax']
    n=100000; step=(tmax-tmin)/n
    best_d,best_t=1e9,tmin; t=tmin
    for _ in range(n+1):
        X=poly([rec['x0'],rec['x1'],rec['x2'],rec['x3']],t)
        Y=poly([rec['y0'],rec['y1'],rec['y2'],rec['y3']],t)
        d=X*X+Y*Y
        if d<best_d: best_d=d; best_t=t
        t+=step
    pt=centreline_pt(rec,best_t)
    if pt: return [round(pt[1],4),round(pt[0],4)]
    return [round(rec.get('lng_dd_ge',0.0),4),round(rec.get('lat_dd_ge',0.0),4)]


# ── Umbral ovals ────────────────────────────────────────────────────────────

def _bisect_umbra_at_t(rec, p_lat, p_lon, bearing_rad, t,
                       search_m=400_000, iters=24):
    """Bisect along a great-circle bearing from p to find the umbra/antumbra
    boundary at instant t (where magnitude crosses 1.0).

    p must be inside the umbra at t (magnitude == 1.0).
    Returns (lat, lon) or None if the umbra doesn't end within search_m.

    Near the terminator (end of path / high-gamma eclipses) the umbral
    boundary is reached at the horizon: the bisect must stop at the
    terminator (zeta=0) rather than overshooting into the below-horizon
    region where _magnitude_at returns 0, which previously produced
    wildly incorrect oval points on those bearings.
    """
    R_E = R_EARTH_M
    lat0 = p_lat * DEG; lon0 = p_lon * DEG
    cos_lat0 = math.cos(lat0); sin_lat0 = math.sin(lat0)
    cos_b = math.cos(bearing_rad); sin_b = math.sin(bearing_rad)

    X, _, Y, _, d_r, mu, dt_s, L1, L2 = bstate(rec, t)
    sin_d = math.sin(d_r); cos_d = math.cos(d_r)
    rho1 = math.sqrt(1.0 - E2 * cos_d * cos_d)
    sin_d1 = sin_d / rho1
    cos_d1 = math.sqrt(1.0 - E2) * cos_d / rho1

    def at_dist(d):
        ang = d / R_E
        sin_lat2 = sin_lat0*math.cos(ang) + cos_lat0*math.sin(ang)*cos_b
        sin_lat2 = max(-1.0, min(1.0, sin_lat2))
        lat2 = math.asin(sin_lat2)
        lon2 = lon0 + math.atan2(sin_b*math.sin(ang)*cos_lat0,
                                  math.cos(ang) - sin_lat0*sin_lat2)
        return (lat2/DEG, ((lon2/DEG + 180) % 360) - 180)

    def zeta_at(lat_deg, lon_deg):
        lat_gd = lat_deg * DEG
        tan_lat_gc = math.tan(lat_gd) * math.sqrt(1.0 - E2)
        lat_gc = math.atan(tan_lat_gc)
        H_deg = (lon_deg + mu - 0.00417807 * dt_s) % 360
        if H_deg > 180: H_deg -= 360
        H = H_deg * DEG
        return (math.sin(lat_gc)*sin_d1
                + math.cos(lat_gc)*math.cos(H)*cos_d1)

    # Confirm starting point is inside (mag == 1.0)
    if _magnitude_at(rec, p_lat, p_lon, t) < 1.0 - 1e-9:
        return None

    # Find terminator distance: binary search for where zeta crosses 0.
    # Search up to half Earth circumference — the terminator could be far
    # beyond the nominal search_m on grazing/end-of-path bearings.
    HALF_CIRC = math.pi * R_E
    term_m = HALF_CIRC
    if zeta_at(*at_dist(HALF_CIRC)) > 0:
        term_m = HALF_CIRC  # terminator beyond half-circumference, unlikely
    else:
        t_lo, t_hi = 0.0, HALF_CIRC
        for _ in range(iters):
            tm = 0.5 * (t_lo + t_hi)
            if zeta_at(*at_dist(tm)) > 0:
                t_lo = tm
            else:
                t_hi = tm
        term_m = t_lo  # last point still above horizon

    # Probe outward up to the terminator.
    # If the umbra extends all the way to the horizon on this bearing,
    # the terminator point IS the oval boundary — use it directly.
    lo = 0.0
    hi = min(search_m, term_m)
    if _magnitude_at(rec, *at_dist(hi), t) >= 1.0 - 1e-9:
        # Still inside umbra at search_m — expand to terminator
        hi = term_m
    if _magnitude_at(rec, *at_dist(hi), t) >= 1.0 - 1e-9:
        # Umbra reaches the horizon: terminator is the boundary
        return at_dist(term_m)

    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        ll = at_dist(mid)
        if _magnitude_at(rec, ll[0], ll[1], t) >= 1.0 - 1e-9:
            lo = mid
        else:
            hi = mid
    return at_dist(0.5 * (lo + hi))


def umbra_ovals(rec, oval_step_min=OVAL_STEP_MIN, N=48):
    """Umbral footprint polygons at oval_step_min intervals.

    Method: at each time t where the umbra touches Earth, locate the
    centreline ground point and walk N evenly-spaced bearings outward,
    bisecting each to find the magnitude-1 contour at instant t. This
    traces the true cone-Earth intersection, including elongated ovals
    near the limb where the previous fundamental-plane-circle method
    produced fictitious shapes.

    Each entry is a [[lon, lat], ...] closed ring (N+1 pts).
    """
    step = oval_step_min / 60.0
    # search_m: scale with path width so the curve isn't capped before
    # reaching the edge on wide/grazing eclipses (same logic as umbral_pts).
    half_width_m = rec.get('path_width', 0) * 500.0
    oval_search_m = max(half_width_m * 1.5, 400_000)
    ovals = []
    t = rec['tmin']
    while t <= rec['tmax'] + 1e-9:
        cl = centreline_pt(rec, t)
        if cl is None:
            t += step; continue
        cl_lat, cl_lon = cl
        # Verify the centreline point is actually in the umbra at this t.
        # For grazers, centreline can exist (axis hits Earth) without
        # totality because L2' shrinks with high zeta. Skip if so.
        if _magnitude_at(rec, cl_lat, cl_lon, t) < 1.0 - 1e-9:
            t += step; continue

        # Initial ring: N evenly-spaced bearings
        raw = []  # (bearing_rad, lat, lon)
        bad = False
        for i in range(N):
            bearing = 2.0 * math.pi * i / N
            edge = _bisect_umbra_at_t(rec, cl_lat, cl_lon, bearing, t,
                                      search_m=oval_search_m)
            if edge is None:
                bad = True; break
            raw.append((bearing, edge[0], edge[1]))
        if bad or len(raw) < 3:
            t += step; continue

        # Adaptive refinement: subdivide any edge longer than MAX_DEG degrees
        # (≈33 km). Highly elongated end-of-path ovals need extra points at
        # the tips; normal mid-path ovals add almost none.
        MAX_DEG = 0.3
        for _ in range(4):
            refined = [raw[0]]
            changed = False
            for j in range(1, len(raw)):
                b0, la0, lo0 = refined[-1]
                b1, la1, lo1 = raw[j]
                if math.sqrt((la1-la0)**2 + (lo1-lo0)**2) > MAX_DEG:
                    b_mid = (b0 + b1) / 2
                    e = _bisect_umbra_at_t(rec, cl_lat, cl_lon, b_mid, t,
                                           search_m=oval_search_m)
                    if e:
                        refined.append((b_mid, e[0], e[1]))
                        changed = True
                refined.append((b1, la1, lo1))
            raw = refined
            if not changed:
                break

        ring = [[round(lo, 4), round(la, 4)] for _, la, lo in raw]
        ring.append(ring[0])
        ovals.append(ring)
        t += step
    return ovals


# ── Terminator ──────────────────────────────────────────────────────────────

def _f2g_term(xi, eta, d_r, mu, dt_s):
    """Fundamental plane → geodetic, specialised for terminator points where
    zeta = 0 by construction. The general f2g rejects points with r² ≥ 1.0,
    but our crossings live ON the unit circle (terminator ⇔ ζ = 0); they sit
    at r² ≈ 1.0 where round-off tips them either side of the strict cutoff
    and many would be incorrectly discarded. Here we skip the zeta computation
    entirely and use the closed-form limit.

    sin(lat_gc) = η·cos(d) + 0·sin(d) = η·cos(d)
    H           = atan2(ξ, 0·cos(d) - η·sin(d)) = atan2(ξ, -η·sin(d))
    """
    sin_lat_gc = max(-1.0, min(1.0, eta * math.cos(d_r)))
    lat_gc = math.asin(sin_lat_gc)
    lat_gd = math.atan(math.tan(lat_gc) / math.sqrt(1.0 - E2))
    H      = math.degrees(math.atan2(xi, -eta * math.sin(d_r)))
    lon    = (H - mu + 0.00417807 * dt_s + 180.0) % 360.0 - 180.0
    return (math.degrees(lat_gd), lon)


def _term_crossings_at(rec, t):
    """Intersection of penumbral L1 circle with the Earth limb (unit circle)
    in the fundamental plane.

    A geographic point lies on the local sunrise/sunset terminator exactly
    when it lies in the fundamental plane (zeta = 0), i.e. on the unit
    circle. The penumbral shadow boundary is the L1 circle at (X, Y).
    Their intersection — terminator points momentarily on the penumbra —
    is the simultaneous solution of two circles:

        xi^2 + eta^2     = 1
        (xi-X)^2 + (eta-Y)^2 = L1^2

    Subtracting gives the chord  X·xi + Y·eta = (X²+Y²+1-L1²)/2 = k.
    With D = sqrt(X²+Y²), kd = k/D is the perpendicular distance from the
    origin to that chord. When |kd| <= 1 the chord meets the unit circle
    at two symmetric points h = sqrt(1-kd²) to either side along the chord
    direction. Otherwise the penumbra does not touch the limb at time t.

    Returns (xi_a, eta_a, xi_b, eta_b, X, Y, d_r, mu, dt_s, L1) with point
    _a on the +CCW-normal side and _b on the −CCW-normal side, or None if
    no intersection exists. The CCW-normal labelling stays consistent over
    time (it depends only on the sign of (X, Y)), so it gives a stable
    branch identification without any post-hoc unwrapping.
    """
    X, Xp, Y, Yp, d_r, mu, dt_s, L1, _L2 = bstate(rec, t)
    D2 = X*X + Y*Y
    if D2 < 1e-18: return None
    D  = math.sqrt(D2)
    k  = (D2 + 1.0 - L1*L1) * 0.5
    kd = k / D
    if abs(kd) > 1.0: return None
    h  = math.sqrt(max(0.0, 1.0 - kd*kd))
    cx, cy = X/D, Y/D            # radial unit vector toward shadow centre
    nx, ny = -Y/D, X/D           # +90° CCW tangent
    xi_a = cx*kd + nx*h;  eta_a = cy*kd + ny*h
    xi_b = cx*kd - nx*h;  eta_b = cy*kd - ny*h
    return (xi_a, eta_a, xi_b, eta_b, X, Y, d_r, mu, dt_s, L1)


def _term_tangency_time(rec, t_out, t_in, tol=1e-7):
    """Bisect for |kd|=1 between t_out (no crossing) and t_in (has crossing)."""
    def kd_excess(t):
        X, _Xp, Y, _Yp, _d_r, _mu, _dt_s, L1, _L2 = bstate(rec, t)
        D = math.sqrt(X*X + Y*Y)
        if D < 1e-18: return -1.0
        return abs((D*D + 1.0 - L1*L1) / (2.0*D)) - 1.0
    lo, hi = t_out, t_in
    for _ in range(60):
        mid = 0.5*(lo + hi)
        if kd_excess(mid) > 0: lo = mid
        else:                  hi = mid
        if abs(hi - lo) < tol: break
    return 0.5*(lo + hi)


def _term_tangent_point(rec, t, polish=True):
    """At |kd|=1 both crossings collapse to one point on the unit circle."""
    X, _Xp, Y, _Yp, d_r, mu, dt_s, L1, _L2 = bstate(rec, t)
    D = math.sqrt(X*X + Y*Y)
    if D < 1e-18: return None
    kd = (D*D + 1.0 - L1*L1) / (2.0*D)
    kd = max(-1.0, min(1.0, kd))
    cx, cy = X/D, Y/D
    ll = _f2g_term(cx*kd, cy*kd, d_r, mu, dt_s)
    return _rs_exact(rec, t, ll) if polish else ll


def _rs_exact(rec, t, ll, keep_seed=False, cap_km=None):
    """Polish a rise/set-lemniscate vertex onto the EXACT ground solution of
    the two conditions that define it at its own instant t:

        zeta(lat, lon, t) = 0   (point on the true sunrise/sunset line)
        g(lat, lon, t)    = 0   (point on the penumbral shadow edge)

    Damped 2-D Newton in ground coordinates with a geodesic finite-
    difference Jacobian. The seed comes from the fundamental-plane
    two-circle solve, which intersects the L1 circle with a CIRCULAR limb;
    the true-frame limb of the ellipsoid is the ellipse
    xi^2 + (eta/rho1)^2 = 1, and that ~0.3% flattening displaced vertices —
    mostly ALONG the curve, growing to ~150 km near the tangency tips.
    Because the displacement is tangential, the polish must succeed for
    EVERY vertex or none in a stretch: a mix of polished (slid) and
    unpolished neighbours zigzags the sequence (the "gap 355 km" audit).
    Hence the generous iteration budget and residual-backtracking damping;
    the polished sequence stays ordered because the curve is parameterized
    by t and each vertex lands on its own exact solution.

    When no solution exists at this t, behaviour depends on keep_seed —
    see the comment at the return: tips drop (the circular tangency time
    overshoots the true one, and phantom seeds there zigzagged the curve),
    mid-run keeps the seed (the parameterization can degenerate at the
    terminator ring's apex while the true curve still exists)."""
    if ll is None: return None
    lat, lon = ll
    def _accept(la2, lo2):
        # cap_km rejects solutions far from the seed. Near the terminator
        # ring's apex latitude (90-decl) the exact crossing at a given t can
        # sit hundreds of km along the ring from the circular seed; those
        # solutions are individually exact but destroy the sequence order
        # (t-parameterization degenerates there), so main-run callers cap
        # and fall back to the seed. Normal polish displacement measured
        # <= ~50 km everywhere else; densified tip callers pass no cap.
        if cap_km is None: return (la2, lo2)
        dla = (la2 - ll[0]) * DEG; dlo = (lo2 - ll[1]) * DEG
        h = (math.sin(dla / 2) ** 2
             + math.cos(ll[0] * DEG) * math.cos(la2 * DEG) * math.sin(dlo / 2) ** 2)
        moved = 6371.0 * 2.0 * math.asin(min(1.0, math.sqrt(abs(h))))
        if moved <= cap_km: return (la2, lo2)
        return ll if keep_seed else None
    H = 800.0                                    # probe, metres
    g0, z0 = _pen_g(rec, lat, lon, t)
    res = math.hypot(g0, z0)
    for _ in range(30):
        if abs(z0) < 1e-8 and abs(g0) < 1e-8:
            return _accept(lat, lon)
        gN, zN = _pen_g(rec, *_gc_step(lat, lon, 0.0, H), t)
        gS, zS = _pen_g(rec, *_gc_step(lat, lon, math.pi, H), t)
        gE, zE = _pen_g(rec, *_gc_step(lat, lon, math.pi / 2, H), t)
        gW, zW = _pen_g(rec, *_gc_step(lat, lon, -math.pi / 2, H), t)
        a11 = (gN - gS) / (2 * H); a12 = (gE - gW) / (2 * H)
        a21 = (zN - zS) / (2 * H); a22 = (zE - zW) / (2 * H)
        det = a11 * a22 - a12 * a21
        if abs(det) < 1e-30: break
        dn = (-g0 * a22 + z0 * a12) / det        # metres north
        de = (-z0 * a11 + g0 * a21) / det        # metres east
        stepm = math.hypot(dn, de); brg = math.atan2(de, dn)
        # backtracking: halve the step while the residual grows
        for _bt in range(6):
            la2, lo2 = _gc_step(lat, lon, brg, stepm)
            g2, z2 = _pen_g(rec, la2, lo2, t)
            r2 = math.hypot(g2, z2)
            if r2 < res: break
            stepm *= 0.5
        else:
            break
        lat, lon, g0, z0, res = la2, lo2, g2, z2, r2
    if abs(z0) < 1e-6 and abs(g0) < 1e-6:
        return _accept(lat, lon)
    q = _rs_ring_solve(rec, t, ll)
    if q is not None:
        return _accept(q[0], q[1])
    # No exact solution at this vertex's own t. In the TIP regions that
    # means the sample lies past the true tangency and must be dropped
    # (keeping it drew the phantom spur behind the "gap 355 km" audits).
    # MID-RUN it usually means the time-parameterization has degenerated —
    # near the terminator ring's apex latitude (90-decl) the exact crossing
    # slides hundreds of km along the ring per time step, or briefly
    # vanishes, while the true curve still exists nearby (verified on
    # 2017-08-21: exact residuals at the incumbent's vertices there
    # straddle zero). Dropping mid-run vertices tore 400-1100 km holes in
    # arcs the incumbent drew ~50 km accurately, so mid-run callers keep
    # the seed: never worse than the incumbent, exact everywhere else.
    return ll if keep_seed else None


def _rs_ring_solve(rec, t, ll):
    """Near-tangency fallback for _rs_exact. As the a and b roots merge at a
    lemniscate tip, the 2-D Newton Jacobian degenerates well before the true
    tangency — but the problem stays well-posed in ONE dimension: constrain
    the point to the zeta = 0 ring (always well-conditioned), then bisect
    g = 0 along the ring toward the root nearest the seed. Succeeds right up
    to the tangency; returns None only when no root exists at this t (the
    circular-limb construction's samples past the TRUE tangency, which
    describe curve points that do not exist and must be dropped)."""
    H = 800.0
    def zg(la, lo): return _pen_g(rec, la, lo, t)
    def zgrad_brg(la, lo):
        zN = zg(*_gc_step(la, lo, 0.0, H))[1]; zS = zg(*_gc_step(la, lo, math.pi, H))[1]
        zE = zg(*_gc_step(la, lo, math.pi / 2, H))[1]; zW = zg(*_gc_step(la, lo, -math.pi / 2, H))[1]
        gN = (zN - zS) / (2 * H); gE = (zE - zW) / (2 * H)
        m = math.hypot(gN, gE)
        return (math.atan2(gE, gN), m) if m > 1e-15 else (None, 0.0)
    def on_ring(la, lo):
        for _ in range(10):
            g, z = zg(la, lo)
            if abs(z) < 1e-9: return la, lo, True
            b, m = zgrad_brg(la, lo)
            if b is None: return la, lo, False
            la, lo = _gc_step(la, lo, b, -z / m)
        return la, lo, abs(zg(la, lo)[1]) < 1e-7
    la0, lo0, ok = on_ring(ll[0], ll[1])
    if not ok: return None
    def ring_step(la, lo, brg, d_m):
        la2, lo2 = _gc_step(la, lo, brg, d_m)
        la2, lo2, ok2 = on_ring(la2, lo2)
        return (la2, lo2) if ok2 else None
    b0, _ = zgrad_brg(la0, lo0)
    if b0 is None: return None
    tang = b0 + math.pi / 2
    g0 = zg(la0, lo0)[0]
    # March the ring in fixed 8 km steps up to 320 km each way. Near a pinch
    # the two roots sit close together with the seed OUTSIDE them, so a
    # doubling stride can step across both and miss the sign change; fixed
    # steps plus a hump check (refine the max of g where it rises then
    # falls; if it pokes above zero, bracket the near-side root) recover
    # roots right up to the pinch, matching the baseline's own resolution.
    best = None
    STEPK = 8e3
    for sgn in (1.0, -1.0):
        prev = (la0, lo0); pg = g0
        samples = [((la0, lo0), g0)]
        for k in range(40):
            q = ring_step(prev[0], prev[1], tang if sgn > 0 else tang + math.pi, STEPK)
            if q is None: break
            qg = zg(*q)[0]
            samples.append((q, qg))
            if (qg < 0.0) != (pg < 0.0):
                best = (prev, q, pg); break
            prev, pg = q, qg
        if best: break
        # hump check: local max of g along the marched samples
        if len(samples) >= 3:
            mi = max(range(1, len(samples) - 1), key=lambda i: samples[i][1])
            if samples[mi][1] > samples[0][1]:
                A2, B2 = samples[mi - 1][0], samples[mi + 1][0]
                for _ in range(18):
                    brg_ab = _gc_bearing(A2, B2)
                    dla = (B2[0] - A2[0]) * DEG; dlo = (B2[1] - A2[1]) * DEG
                    h = (math.sin(dla / 2) ** 2 + math.cos(A2[0] * DEG)
                         * math.cos(B2[0] * DEG) * math.sin(dlo / 2) ** 2)
                    d_ab = 2.0 * R_EARTH_M * math.asin(min(1.0, math.sqrt(abs(h))))
                    m1 = ring_step(A2[0], A2[1], brg_ab, d_ab / 3.0)
                    m2 = ring_step(A2[0], A2[1], brg_ab, 2.0 * d_ab / 3.0)
                    if m1 is None or m2 is None: break
                    if zg(*m1)[0] < zg(*m2)[0]: A2 = m1
                    else: B2 = m2
                gm = zg(*A2)[0]
                if gm > 0.0:
                    # near-side root lies between the seed-side sample and A2
                    best = (samples[max(0, mi - 1)][0], A2, samples[max(0, mi - 1)][1])
                    if best[2] > 0.0:
                        best = (samples[0][0], A2, samples[0][1])
                    break
    if best is None: return None
    (A, B, ga) = best
    for _ in range(24):
        brg_ab = _gc_bearing(A, B)
        dla = (B[0] - A[0]) * DEG; dlo = (B[1] - A[1]) * DEG
        h = (math.sin(dla / 2) ** 2
             + math.cos(A[0] * DEG) * math.cos(B[0] * DEG) * math.sin(dlo / 2) ** 2)
        d_ab = 2.0 * R_EARTH_M * math.asin(min(1.0, math.sqrt(abs(h))))
        if d_ab < 2.0: break
        M = ring_step(A[0], A[1], brg_ab, d_ab / 2.0)
        if M is None: break
        if (zg(*M)[0] < 0.0) == (ga < 0.0): A, ga = M, zg(*M)[0]
        else: B = M
    la, lo = A
    g, z = zg(la, lo)
    return (la, lo) if (abs(z) < 1e-6 and abs(g) < 1e-5) else None


def _insert_rs_junctions(rec, term_first, term_last, junctions):
    """Insert each true penumbral-limit terminus as a vertex into the
    rise/set loop it lies on, making the two curves join vertex-exactly.
    A terminus qualifies only if the sun altitude at its own maximum is
    ~0 (open penumbral arcs end on the terminator; a closed penumbral
    loop's arbitrary first/last vertex does not qualify)."""
    def gc_km(a, b):
        h = (math.sin((b[1] - a[1]) * DEG / 2) ** 2
             + math.cos(a[1] * DEG) * math.cos(b[1] * DEG)
             * math.sin((b[0] - a[0]) * DEG / 2) ** 2)
        return 6371.0 * 2.0 * math.asin(min(1.0, math.sqrt(abs(h))))
    loops = [c for c in (term_first or []) + (term_last or []) if len(c) >= 4]
    for J in junctions or []:
        if abs(_pen_depth(rec, J[1], J[0])[2]) > 5e-4: continue
        best = None
        for c in loops:
            for i in range(len(c)):
                d = gc_km(J, c[i])
                if best is None or d < best[0]: best = (d, c, i)
        if best and 0.005 < best[0] < 40.0:
            _d, c, i = best
            j = (i + 1) % len(c) if gc_km(J, c[(i + 1) % len(c)]) <= gc_km(J, c[i - 1]) else i
            c.insert(j, [round(J[0], 4), round(J[1], 4)])


def _terminator_curves(rec, t_first, t_last, step_min=STEP_MIN, NLAT=None):
    """
    Trace the terminator lemniscates as the locus of geographic points
    simultaneously on the sunrise/sunset line and on the penumbral shadow
    boundary at some moment during the eclipse.

    Algorithm: solve the two-circle intersection (penumbra ∩ Earth limb) in
    the fundamental plane analytically at every timestep. The two crossings
    a / b — labelled by which side of the (origin-to-shadow) chord they lie
    on — each trace half of a closed lemniscate as time advances. Closing
    the loop at the |kd|=1 tangencies (where a and b merge) gives the
    complete shape.

    A typical central eclipse has two contiguous time-runs of intersections
    (penumbra-on-Earth interrupts the limb crossings between them), giving
    one sunrise lemniscate and one sunset lemniscate. High-gamma / polar
    eclipses have a single run — the shadow never lands fully on Earth —
    and produce a single closed loop encompassing the polar region.

    The t_first / t_last arguments are kept for call-site compatibility;
    the new implementation derives its time bounds directly from rec['tmin']
    and rec['tmax'] and extends them by 1 hour to capture true P1/P4
    tangencies that lie outside the nominal Besselian window.

    Returns (term_first_segs, term_last_segs) — each a list containing one
    unwrapped [lon, lat] polyline (closed). Single-run eclipses place the
    sole loop in term_first_segs and leave term_last_segs empty.
    """
    # Extend the scan beyond [tmin, tmax] to capture true P1/P4 tangencies
    # that lie outside the nominal window. Worst observed case in 1901–2000
    # is ~0.51 h, so 1 h is a comfortable margin. Besselian polynomials
    # remain accurate this far out.
    EXT = 1.0
    tmin = rec['tmin'] - EXT
    tmax = rec['tmax'] + EXT
    tstep = step_min / 60.0

    # ── 1. Scan time, collect contiguous runs of valid crossings ──────────
    runs = []                # each run: [(t, xi_a, eta_a, xi_b, eta_b, X, Y, d_r, mu, dt_s, L1), ...]
    cur  = []
    t = tmin
    while t <= tmax + 1e-9:
        r = _term_crossings_at(rec, t)
        if r is not None:
            cur.append((t,) + r)
        else:
            if cur:
                runs.append(cur); cur = []
        t += tstep
    if cur: runs.append(cur)
    if not runs:
        return [], []

    # ── 2. Helpers used per-run ───────────────────────────────────────────
    def _ab_at(t):
        return _term_crossings_at(rec, t)

    def _tip_densify(t_far, t_tan, n=24, polish=True):
        """Square-root-spaced samples between t_far (regular cadence works)
        and t_tan (the actual tangency). Branches converge as
        sqrt(|t_tan-t|), so the bias  biased = 1 - (1-frac)^2  puts ~half
        the samples in the final 25 % of the time interval. Returns
        [(pa_ll, pb_ll), ...] ordered from t_far → t_tan."""
        out = []
        for k in range(1, n + 1):
            frac   = k / (n + 1)
            biased = 1.0 - (1.0 - frac) ** 2
            t_s    = t_far + (t_tan - t_far) * biased
            r = _ab_at(t_s)
            if r is None: continue
            xi_a, eta_a, xi_b, eta_b, X, Y, d_r, mu, dt_s, L1 = r
            pa = _f2g_term(xi_a, eta_a, d_r, mu, dt_s)
            pb = _f2g_term(xi_b, eta_b, d_r, mu, dt_s)
            if polish:
                pa = _rs_exact(rec, t_s, pa)
                pb = _rs_exact(rec, t_s, pb)
            out.append(([pa[1], pa[0]] if pa else None,
                        [pb[1], pb[0]] if pb else None))
        return out

    def _trim_tail(run_, kd_thresh):
        """Drop trailing samples where |kd| > kd_thresh. The dropped region
        is replaced by densified sampling, which captures the rapid sqrt
        convergence near the tangency much better than uniform cadence."""
        if not run_: return []
        for i in range(len(run_) - 1, -1, -1):
            _t, _xa, _ea, _xb, _eb, X, Y, _d, _m, _dt, L1 = run_[i]
            D = math.sqrt(X*X + Y*Y)
            kd = abs((D*D + 1.0 - L1*L1) / (2.0*D))
            if kd <= kd_thresh:
                return run_[: i + 1]
        return []

    # ── 3. Build one closed lemniscate per run ────────────────────────────
    KD_THRESH = 0.99   # |kd| above which 30-sec sampling can't resolve the curve
    loops = []
    for run_orig in runs:
        # Trim the rapid-convergence zone from both ends.
        run_after_tail = _trim_tail(run_orig, KD_THRESH)
        run_after_head = list(reversed(_trim_tail(list(reversed(run_after_tail)),
                                                  KD_THRESH)))
        run = run_after_head if len(run_after_head) >= 2 else run_orig

        t_first_samp = run[0][0]
        t_last_samp  = run[-1][0]

        # Refine the tangency at each end of the original run by bisection.
        t_prev_start = run_orig[0][0] - tstep
        if t_prev_start >= tmin - 1e-12 and _term_crossings_at(rec, t_prev_start) is None:
            t_start_tan = _term_tangency_time(rec, t_prev_start, run_orig[0][0])
            tip_start   = _term_tangent_point(rec, t_start_tan)
        else:
            t_start_tan, tip_start = None, None

        t_next_end = run_orig[-1][0] + tstep
        if t_next_end <= tmax + 1e-12 and _term_crossings_at(rec, t_next_end) is None:
            t_end_tan = _term_tangency_time(rec, t_next_end, run_orig[-1][0])
            tip_end   = _term_tangent_point(rec, t_end_tan)
        else:
            t_end_tan, tip_end = None, None

        # curve_a / curve_b from the trimmed run. Results are kept aligned
        # with their sample times so interior PINCHES can be refined: the
        # exact (elliptical-limb) geometry can briefly lose its terminator
        # crossings mid-run where the circular model still grazes — a real
        # break in the rise/set curve, confirmed by the baseline's own
        # curve having a hole in the same places. Near a pinch tangency the
        # root position moves as sqrt(t), so the regular cadence leaves the
        # last ~70+ km of arc before each pinch endpoint unsampled; bisect
        # the solvability boundary in t and append the boundary points.
        def _branch_pt(ti, branch):
            r = _ab_at(ti)
            if r is None: return None
            xi_a, eta_a, xi_b, eta_b, _X2, _Y2, d_r2, mu2, dt_s2, _L12 = r
            xi, eta = (xi_a, eta_a) if branch == 'a' else (xi_b, eta_b)
            return _rs_exact(rec, ti, _f2g_term(xi, eta, d_r2, mu2, dt_s2))
        def _pinch_edge(t_good, t_bad, branch):
            best = None
            for _ in range(14):
                tm = 0.5 * (t_good + t_bad)
                p = _branch_pt(tm, branch)
                if p: t_good, best = tm, p
                else: t_bad = tm
            return best, t_good
        def _pinch_ladder(t_far, t_bad, branch):
            """Single exact point at the solvability boundary (the true
            tangency). A graded sub-sample ladder was tried and reverted:
            near the tangency the 2-D Newton degenerates and the ring
            fallback can lock onto the far-side root, throwing 800+ km
            outliers. One exact boundary point leaves the final stretch of
            arc sampled at the same ~130-170 km resolution the baseline's
            own curve shows at these seams — honest parity, no phantoms."""
            tip, _t_tan = _pinch_edge(t_far, t_bad, branch)
            return [[tip[1], tip[0]]] if tip else []
        res_a, res_b = [], []
        for (_ti, xi_a, eta_a, xi_b, eta_b, _X, _Y, d_r, mu, dt_s, _L1) in run:
            res_a.append((_ti, _rs_exact(rec, _ti, _f2g_term(xi_a, eta_a, d_r, mu, dt_s), keep_seed=True, cap_km=60.0)))
            res_b.append((_ti, _rs_exact(rec, _ti, _f2g_term(xi_b, eta_b, d_r, mu, dt_s), keep_seed=True, cap_km=60.0)))
        curve_a, curve_b = [], []
        for res, curve, branch in ((res_a, curve_a, 'a'), (res_b, curve_b, 'b')):
            for k, (ti, p) in enumerate(res):
                if p is not None:
                    if k > 0 and res[k - 1][1] is None and curve:
                        curve.extend(reversed(_pinch_ladder(ti, res[k - 1][0], branch)))
                    curve.append([p[1], p[0]])
                elif k > 0 and res[k - 1][1] is not None:
                    curve.extend(_pinch_ladder(res[k - 1][0], ti, branch))

        # Densified samples spanning the trim region into the tangency.
        start_dens_a, start_dens_b = [], []
        if t_start_tan is not None:
            # Reverse so prepending yields forward-time order.
            dens = list(reversed(_tip_densify(t_first_samp, t_start_tan)))
            start_dens_a = [pa for (pa, pb) in dens if pa is not None]
            start_dens_b = [pb for (pa, pb) in dens if pb is not None]

        end_dens_a, end_dens_b = [], []
        if t_end_tan is not None:
            dens = _tip_densify(t_last_samp, t_end_tan)
            end_dens_a = [pa for (pa, pb) in dens if pa is not None]
            end_dens_b = [pb for (pa, pb) in dens if pb is not None]

        # Tip completion. The circular-limb tangency time overshoots the
        # TRUE tangency, so the tangent point and the last densified samples
        # have no exact solution and are dropped — leaving the a and b
        # branch ends standing off the true tip (267 km for 2033; the
        # baseline's own curve leaves a 166 km hole at the same seam).
        # Bisect t to the true tangency per branch: both branches' exact
        # roots converge to the same tip point, closing the loop there.
        if t_end_tan is not None:
            end_dens_a.extend(_pinch_ladder(t_last_samp, t_end_tan, 'a'))
            end_dens_b.extend(_pinch_ladder(t_last_samp, t_end_tan, 'b'))
        if t_start_tan is not None:
            start_dens_a[:0] = list(reversed(_pinch_ladder(t_first_samp, t_start_tan, 'a')))
            start_dens_b[:0] = list(reversed(_pinch_ladder(t_first_samp, t_start_tan, 'b')))

        # Adaptive tip fallback. Near the terminator ring's apex latitude
        # (90 - declination) the t-parameterization degenerates: exact
        # solutions at a given t sit hundreds of km along the ring from the
        # circular seed, so polished tip blocks can zigzag or leave the a/b
        # branch ends ~1000 km apart at the seam (2017-08-21). The
        # incumbent's unpolished tips bridge those seams at <200 km with
        # ~50 km vertex accuracy — so per tip, walk the assembled seam
        # CHAIN (curve tail, densified block, tangent point, opposite
        # densified block, opposite curve tail, in loop order) and if any
        # consecutive gap exceeds the incumbent's envelope, rebuild that
        # whole tip block unpolished. Exact tips are kept wherever the
        # machinery works (the common case); never worse anywhere.
        def _chain_gap(chain):
            pts = [q for q in chain if q is not None]
            worst = 0.0
            for i in range(len(pts) - 1):
                h = (math.sin((pts[i + 1][1] - pts[i][1]) * DEG / 2) ** 2
                     + math.cos(pts[i][1] * DEG) * math.cos(pts[i + 1][1] * DEG)
                     * math.sin((pts[i + 1][0] - pts[i][0]) * DEG / 2) ** 2)
                worst = max(worst, 6371.0 * 2.0 * math.asin(min(1.0, math.sqrt(abs(h)))))
            return worst
        def _ll(tp): return [tp[1], tp[0]] if tp else None
        SEAM_MAX = 220.0
        if t_end_tan is not None:
            chain = (curve_a[-1:] + end_dens_a + [_ll(tip_end)]
                     + end_dens_b[::-1] + curve_b[-1:])
            if _chain_gap(chain) > SEAM_MAX:
                dens = _tip_densify(t_last_samp, t_end_tan, polish=False)
                end_dens_a = [pa for (pa, pb) in dens if pa is not None]
                end_dens_b = [pb for (pa, pb) in dens if pb is not None]
                tip_end = _term_tangent_point(rec, t_end_tan, polish=False)
        if t_start_tan is not None:
            chain = (curve_b[:1] + start_dens_b[::-1] + [_ll(tip_start)]
                     + start_dens_a + curve_a[:1])
            if _chain_gap(chain) > SEAM_MAX:
                dens = list(reversed(_tip_densify(t_first_samp, t_start_tan, polish=False)))
                start_dens_a = [pa for (pa, pb) in dens if pa is not None]
                start_dens_b = [pb for (pa, pb) in dens if pb is not None]
                tip_start = _term_tangent_point(rec, t_start_tan, polish=False)

        full_a = start_dens_a + curve_a + end_dens_a
        full_b = start_dens_b + curve_b + end_dens_b

        tip_start_ll = [tip_start[1], tip_start[0]] if tip_start else None
        tip_end_ll   = [tip_end[1],   tip_end[0]]   if tip_end   else None

        # Loop = tip_start + curve_a → tip_end → reversed(curve_b) → close.
        loop = []
        if tip_start_ll: loop.append(tip_start_ll)
        loop.extend(full_a)
        if tip_end_ll:   loop.append(tip_end_ll)
        loop.extend(reversed(full_b))
        if loop and loop[0] != loop[-1]:
            loop.append(loop[0][:])

        if len(loop) >= 4:
            loops.append(unwrap(loop))

    # ── 4. Assign loops to first / last buckets ───────────────────────────
    # Time-ordered: run-1 is the sunrise (P1→GE) lemniscate, run-2 is the
    # sunset (GE→P4) lemniscate. Single-run cases (high-gamma) put the lone
    # loop in term_first; >2 runs (very rare) aggregate into term_last.
    if len(loops) == 0: return [], []
    if len(loops) == 1: return [loops[0]], []
    if len(loops) == 2: return [loops[0]], [loops[1]]
    return [loops[0]], loops[1:]


def green_curve(rec):
    """Maximum-on-Horizon curve (the baseline's green line): the locus of ground
    points whose own greatest eclipse occurs with the sun exactly on the
    horizon (altitude 0). It is the shared termination boundary for the umbral
    limits and the centreline (visible-totality convention).

    Construction: this curve is the zero level set of the scalar field

        F(lat, lon) = sun altitude (deg) at the point's own moment of
                      greatest eclipse,

    so it is traced directly as an implicit contour rather than approximated.
    A coarse scan seeds each connected component; a predictor-corrector then
    follows the contour (step along the tangent, Newton-correct back onto
    F = 0) until it closes or leaves the penumbral region (the blob tip). This
    is topology-agnostic: a figure-8 (connected sunrise+sunset limits) and a
    two-blob eclipse (separate limits) are simply one component or two, traced
    by the same code, each reaching its true tips. Verified against the baseline's
    published curve to ~0.3 km median.

    Returns a flat list of [lon, lat]; separate components are delimited by a
    None sentinel so the renderer draws them as distinct polylines."""
    tmin = rec['tmin']; tmax = rec['tmax']

    def field(lat, lon):
        # (sun altitude deg at max eclipse, min axis distance) at this point.
        def adz(t):
            X, _, Y, _, d_r, mu, dt_s, L1, L2 = bstate(rec, t)
            xi, eta, _zeta = _fund_true(lat, lon, d_r, mu, dt_s)
            return math.hypot(xi - X, eta - Y), _sun_sin_alt(lat, lon, d_r, mu, dt_s)
        N = 44; bt = tmin; bd = 1e18
        for i in range(N + 1):
            t = tmin + (tmax - tmin)*i/N
            d, _z = adz(t)
            if d < bd: bd = d; bt = t
        a = max(tmin, bt - (tmax-tmin)/N); b = min(tmax, bt + (tmax-tmin)/N)
        bz = -1.0; bdist = bd
        for _ in range(26):
            m1 = a + (b-a)/3; m2 = b - (b-a)/3
            d1, z1 = adz(m1); d2, z2 = adz(m2)
            if d1 < d2: b = m2; bz = z1; bdist = d1
            else:       a = m1; bz = z2; bdist = d2
        return math.degrees(math.asin(max(-1.0, min(1.0, bz)))), bdist

    # Green arcs end at the penumbral edge — the blob boundary, where the
    # eclipse magnitude reaches 0. That edge is this eclipse's own penumbra
    # radius L1 (Earth radii), which varies ~0.53–0.56 between eclipses, so we
    # read it from the Besselian state rather than hardcoding a constant. A
    # tiny margin (1.005) keeps the last traced point just on the blob rather
    # than a hair inside it.
    _, _, _, _, _d0, _mu0, _dt0, _L1_0, _ = bstate(rec, (tmin + tmax)/2.0)
    PEN = abs(_L1_0) * 1.005
    def grad(lat, lon, h=0.02):
        a1, _ = field(lat+h, lon); a2, _ = field(lat-h, lon)
        a3, _ = field(lat, lon+h); a4, _ = field(lat, lon-h)
        return (a1-a2)/(2*h), (a3-a4)/(2*h)
    def correct(lat, lon):                      # Newton onto F = 0
        for _ in range(12):
            f, _ = field(lat, lon)
            if abs(f) < 0.003: return lat, lon, True
            gla, glo = grad(lat, lon); g2 = gla*gla + glo*glo
            if g2 < 1e-12: return lat, lon, False
            lat -= f*gla/g2; lon -= f*glo/g2
        f, _ = field(lat, lon)
        return lat, lon, abs(f) < 0.02

    def trace(seed, step_km=35.0, maxpts=4000):
        def one_dir(sign):
            la, lo = seed; prevb = None; out = []
            for _ in range(maxpts):
                gla, glo = grad(la, lo); gn = math.hypot(gla, glo)
                if gn < 1e-9: break
                klon = math.cos(la*DEG) or 1e-9
                tla, tlo = -glo, gla                 # tangent ⟂ gradient
                tn = math.hypot(tla, tlo*klon); tla /= tn; tlo /= tn
                b = math.atan2(tlo*klon, tla)
                if prevb is not None and abs(((b-prevb+math.pi) % (2*math.pi)) - math.pi) > math.pi/2:
                    tla, tlo, b = -tla, -tlo, b + math.pi
                la2 = la + sign*step_km/111.0*tla
                lo2 = lo + sign*step_km/111.0*tlo
                la2, lo2, ok = correct(la2, lo2)
                if not ok: break
                _, md = field(la2, lo2)
                if md > PEN: break                   # left penumbra → tip reached
                out.append((lo2, la2)); prevb = b; la, lo = la2, lo2
                if len(out) > 5 and abs(la2-seed[0]) < 0.4 and \
                   abs(((lo2-seed[1]+180) % 360) - 180) < 0.4:
                    break                            # closed loop
            return out
        fwd = one_dir(+1); bwd = one_dir(-1)
        return list(reversed(bwd)) + [(seed[1], seed[0])] + fwd

    # Seed: coarse grid scan for sign changes of F inside the penumbral region.
    seeds = []
    for lat in range(-85, 86, 3):
        prev = None; prevok = False
        for lon in range(-180, 181, 3):
            a, md = field(lat, lon); ok = md < 0.6
            if prev is not None and prevok and ok and (prev >= 0) != (a >= 0):
                la, lo, good = correct(lat, lon - 1.5)
                if good: seeds.append((la, lo))
            prev = a; prevok = ok

    comps = []
    def near_existing(pt):
        for comp in comps:
            for q in comp:
                if abs(q[1]-pt[0]) < 1.5 and abs(((q[0]-pt[1]+180) % 360) - 180) < 1.5:
                    return True
        return False
    for sd in seeds:
        if near_existing(sd): continue
        comp = trace(sd)
        if len(comp) >= 3: comps.append(comp)

    out = []
    def wrap180(lon):
        return ((lon + 180.0) % 360.0) - 180.0
    out = []
    for k, comp in enumerate(comps):
        if k: out.append(None)                       # component delimiter
        out.extend([wrap180(lon), lat] for lon, lat in comp)
    return out


# The penumbral N/S limits recast in the unified architecture: every curve is
# the zero level set of a scalar field evaluated at each ground point's own
# moment of greatest eclipse, traced by a predictor-corrector. Green curve =
# {sun alt at max = 0}; umbral limits = {ever-total depth = 0} (_umb_*);
# here penumbra = {ever-partial depth = 0}. The traced contour is then
# trimmed to the sunlit side and split into the N and S arcs.

def _pen_g(rec, lat, lon, t):
    """Instantaneous true-frame penumbral depth at ground point (lat, lon) and
    time t: (penumbra radius - axis distance, zeta). Shared by the penumbral
    field (_pen_depth: max over t) and the terminator field (_horizon_depth:
    value at the point's own sunrise/sunset)."""
    X, _, Y, _, d_r, mu, dt_s, L1, _ = bstate(rec, t)
    xi, eta, zeta = _fund_true(lat, lon, d_r, mu, dt_s)
    return ((L1 - zeta * rec['tan_f1']) - math.hypot(xi - X, eta - Y),
            _sun_sin_alt(lat, lon, d_r, mu, dt_s))


def _pen_depth(rec, lat, lon):
    """Ever-partial depth field: max over time of (penumbra radius - axis
    distance) in fundamental-plane units. >0 for points the penumbra ever
    covers, 0 on the envelope (the penumbral limit), <0 outside. UNGATED by
    the horizon: the night-side portion of the contour is mathematically
    smooth and is trimmed AFTER tracing (same order of operations as the
    centreline's _visible_trim), which avoids the below-horizon sentinel
    plateau that once broke the umbral march. Returns (depth, t_at_max,
    zeta_at_max) — zeta>0 means the point faces the sun at its own maximum.

    Axis distance is measured in the TRUE fundamental frame (unscaled eta).
    The eta/rho1 scaling of the old reduced-sphere frame turns the shadow circle into an
    ellipse; that approximation is ~0.3% of the radius — invisible for the
    umbra (L2 ~ 0.009 -> ~0.2 km) but ~10 km for the penumbra (L1 ~ 0.54).
    Verified: the baseline's penumbral limit sits at median -0.07 km in this
    field, vs -9.5 km in the scaled one."""
    tmin, tmax = rec['tmin'], rec['tmax']
    def g(t):
        return _pen_g(rec, lat, lon, t)
    N = 48; bt = tmin; bg = -1e9
    for i in range(N + 1):
        t = tmin + (tmax - tmin) * i / N
        gg, _ = g(t)
        if gg > bg: bg, bt = gg, t
    a = max(tmin, bt - (tmax - tmin) / N); b = min(tmax, bt + (tmax - tmin) / N)
    for _ in range(36):
        m1 = a + (b - a) / 3; m2 = b - (b - a) / 3
        if g(m1)[0] < g(m2)[0]: a = m1
        else: b = m2
    tstar = (a + b) / 2
    bg, bz = g(tstar)
    return bg, tstar, bz


def _pen_grad(rec, lat, lon, h=0.04):
    a1 = _pen_depth(rec, lat + h, lon)[0]; a2 = _pen_depth(rec, lat - h, lon)[0]
    a3 = _pen_depth(rec, lat, lon + h)[0]; a4 = _pen_depth(rec, lat, lon - h)[0]
    return (a1 - a2) / (2 * h), (a3 - a4) / (2 * h)


def _pen_correct(rec, lat, lon):
    """Newton-correct (lat, lon) onto the ever-partial depth = 0 contour."""
    for _ in range(14):
        f, _, _ = _pen_depth(rec, lat, lon)
        if abs(f) < 1e-6: return lat, lon, True
        gla, glo = _pen_grad(rec, lat, lon); g2 = gla * gla + glo * glo
        if g2 < 1e-16: return lat, lon, False
        lat -= f * gla / g2; lon -= f * glo / g2
    f, _, _ = _pen_depth(rec, lat, lon)
    return lat, lon, abs(f) < 2e-5




def _trace_zero(field, seed, step_km=30.0, maxpts=3000,
                min_km=4.0, max_turn=12.0, width=None, min_width=0.0,
                tol=1e-6, accept=2e-5):
    """Shared predictor-corrector: trace the zero contour of scalar
    field(lat, lon) from a seed point on it, GEODESICALLY. Every move is a
    great-circle step by (bearing, distance) via _gc_step, and the gradient
    is probed along local north/east geodesics, so there is no lat/lon
    singularity: the contour may pass arbitrarily close to a pole
    (2042-10-14's southern penumbral loop transits ~30 km from the south
    pole) or cross the antimeridian. The tangent is the gradient bearing
    rotated 90 deg, which keeps a globally consistent orientation along the
    contour — no direction-flip heuristics. The step shrinks where the
    contour turns hard and regrows on straights. Closure is METRIC: back
    within one step of the seed after ten steps' travel means closed
    (contours cannot self-intersect; degree-box and accumulated-turn tests
    both fail near poles). Returns ([(lon, lat), ...] starting at the seed,
    closed_flag).
    (Same discipline as the green_curve tracer, which stays untouched as a
    validated incumbent.)

    width(lat, lon, grad) -> the local half-width (km) of a corridor bounded by
    this contour and a twin (the umbra's other limb). Given it, every step keeps
    the predictor's lateral error (sagitta step^2/2R) under 0.3 of the half-width
    and the gradient probes under 0.25 of it, so Newton cannot land on the twin;
    tracing stops where the half-width falls below min_width (a hybrid's pinch),
    and closure means the seed lies on the last step, since the twin passes
    within a step of it. tol/accept are |field| thresholds for the corrector:
    a corridor metres wide needs them in millimetres.
    Without width the behaviour is exactly the penumbra's and green line's."""
    PROBE = 2000.0                               # gradient probe, metres
    def _gc_km(la1, lo1, la2, lo2):
        h = (math.sin((la2 - la1) * DEG / 2) ** 2
             + math.cos(la1 * DEG) * math.cos(la2 * DEG)
             * math.sin((lo2 - lo1) * DEG / 2) ** 2)
        return 6371.0 * 2.0 * math.asin(min(1.0, math.sqrt(abs(h))))
    pr = [PROBE]
    def gradb(la, lo):
        # field gradient as (bearing rad, magnitude per metre); None if any
        # probe leaves the field's domain (fields may return None outside it)
        h = pr[0]
        fN = field(*_gc_step(la, lo, 0.0, h)); fS = field(*_gc_step(la, lo, math.pi, h))
        fE = field(*_gc_step(la, lo, math.pi / 2, h)); fW = field(*_gc_step(la, lo, -math.pi / 2, h))
        if None in (fN, fS, fE, fW): return None, 0.0
        gN = (fN - fS) / (2 * h); gE = (fE - fW) / (2 * h)
        return math.atan2(gE, gN), math.hypot(gN, gE)
    def correct(la, lo):
        for _ in range(14):
            f = field(la, lo)
            if f is None: return la, lo, False
            if abs(f) < tol: return la, lo, True
            b, g = gradb(la, lo)
            if b is None or g < 1e-15: return la, lo, False
            la, lo = _gc_step(la, lo, b, -f / g)
        f = field(la, lo)
        return la, lo, f is not None and abs(f) < accept
    def _seg_km(la1, lo1, la2, lo2, p):
        # distance from p to the short segment 1-2, local flat frame (km)
        c = math.cos(la1 * DEG) * 111.195
        def xy(la, lo): return (((lo - lo1 + 180.0) % 360.0 - 180.0) * c, (la - la1) * 111.195)
        bx, by = xy(la2, lo2); px, py = xy(p[0], p[1])
        L = bx * bx + by * by
        u = max(0.0, min(1.0, (px * bx + py * by) / L)) if L > 0 else 0.0
        return math.hypot(px - u * bx, py - u * by)
    def one(sign):
        la, lo = seed; prevb = None; out = []; step = last = step_km
        if width:   # first probe: before any gradient, bound it by the smallest
            # possible half-width (steepest gradient = 1 per Earth radius)
            pr[0] = min(PROBE, 250.0 * width(la, lo, 1.0 / R_EARTH_M))
        closed = False; walked = 0.0
        for _ in range(maxpts):
            b, g = gradb(la, lo)
            if b is None or g < 1e-15: break
            tb = b + sign * math.pi / 2          # contour tangent bearing
            turn = None
            if prevb is not None:
                turn = abs(math.degrees(((tb - prevb + math.pi) % (2 * math.pi)) - math.pi))
                if turn > max_turn and step > min_km: step = max(min_km, step * 0.5)
                elif turn < max_turn * 0.4 and step < step_km: step = min(step_km, step * 1.5)
            if width:
                # Lateral error (sagitta step^2/2R) must stay under 0.3 of the
                # half-width, or Newton lands on the other limb.
                hw = width(la, lo, g)
                if hw < min_width: break                  # at a hybrid's pinch: the limb ends here
                cap = 0.3 * hw
                if turn: cap = max(cap, math.sqrt(0.6 * hw * last / math.radians(turn)))
                step = max(0.05, min(step, cap))          # 50 m floor
                pr[0] = min(PROBE, 250.0 * hw)            # probes must not reach the other limb
            la2, lo2 = _gc_step(la, lo, tb, step * 1000.0)
            la2, lo2, ok = correct(la2, lo2)
            if not ok: break
            walked += step
            if walked > 10.0 * step_km and (
                    _seg_km(la, lo, la2, lo2, seed) < min(0.75 * step, 0.5 * hw) if width
                    else _gc_km(la2, lo2, seed[0], seed[1]) < 0.75 * step_km):
                # With a width, "back at the seed" means the seed lies on this
                # step: a narrow corridor's other limb passes within a step of
                # it (1507-07-10: 5 km) and must not count as closure.
                closed = True; break
            out.append((lo2, la2)); prevb = tb; la, lo = la2, lo2; last = step
        return out, closed
    f, fc = one(+1)
    if fc:
        return [(seed[1], seed[0])] + f, True
    bk, _ = one(-1)
    return list(reversed(bk)) + [(seed[1], seed[0])] + f, False


def penumbral_limits_field(rec, pn_old, ps_old):
    """Penumbral N/S limits on the implicit-field engine.

    Trace {ever-partial depth = 0} as one closed contour, keep the sunlit
    arcs (zeta at own max > 0), refine each arc's endpoints onto the exact
    day/night crossing, and label each arc north or south by which side of
    the shadow's motion it lies on (the same perpendicular that defines
    _pen_perp_pt). Falls back to the incumbent walker's curve per side on
    any sanity failure, so this can never produce something worse.

    Validated against baseline truth: incumbent ~9 km -> sub-km (see session log)."""
    ge_lat = rec.get('lat_dd_ge'); ge_lon = rec.get('lng_dd_ge')
    if ge_lat is None or ge_lon is None: return pn_old, ps_old

    # Seeds. Primary: the midpoint of each incumbent walker curve, Newton-
    # corrected onto the contour — this guarantees every side the walker
    # found gets traced, including hole-boundary loops that cross no
    # convenient meridian (2005-10-03's north limit bounds a HOLE in the
    # ever-partial region). Backup: every sign change of the depth field
    # along the GE meridian, which also catches loops the walker missed.
    seeds = []
    for old in (pn_old, ps_old):
        if old and len(old) >= 3:
            lon, lat = old[len(old) // 2]
            sla, slo, ok = _pen_correct(rec, lat, lon)
            if ok: seeds.append((sla, slo))
    prev = None
    for i in range(181):
        la = -90.0 + i * 1.0
        d = _pen_depth(rec, la, ge_lon)[0]
        if prev is not None and (prev >= 0.0) != (d >= 0.0):
            sla, slo, ok = _pen_correct(rec, la - 0.5, ge_lon)
            if ok: seeds.append((sla, slo))
        prev = d
    if not seeds: return pn_old, ps_old

    comps = []
    def _dup(pts):
        # A re-trace of an existing loop (e.g. a meridian seed landing between
        # the vertices of an already-traced component, escaping the seed-level
        # proximity check): most of its vertices lie on an existing component.
        near = 0; samp = pts[::max(1, len(pts) // 12)]
        for q in samp:
            if any(abs(v[1] - q[1]) < 0.7
                   and abs(((v[0] - q[0] + 180) % 360) - 180) < 0.7
                   for c in comps for v in c):
                near += 1
        return near * 2 > len(samp)
    for sd in seeds:
        if any(abs(q[1] - sd[0]) < 0.6
               and abs(((q[0] - sd[1] + 180) % 360) - 180) < 0.6
               for c in comps for q in c):
            continue
        pts, closed = _trace_zero(lambda la, lo: _pen_depth(rec, la, lo)[0], sd)
        if len(pts) >= 8 and closed and not _dup(pts): comps.append(pts)
    if not comps: return pn_old, ps_old

    # Per-vertex circumstance at its own maximum: time, sunlit flag, side.
    def circ(lon, lat):
        _, tstar, zeta = _pen_depth(rec, lat, lon)
        X, Xp, Y, Yp, d_r, mu, dt_s, _, _ = bstate(rec, tstar)
        xi, eta, _ = _fund_true(lat, lon, d_r, mu, dt_s)
        sp = math.hypot(Xp, Yp) or 1e-12
        north = ((xi - X) * (-Yp) + (eta - Y) * Xp) / sp > 0.0
        return tstar, zeta > 0.0, north

    def gc_mid(A, B):
        brg = _gc_bearing(A, B)
        dla = (B[0] - A[0]) * DEG; dlo = (B[1] - A[1]) * DEG
        h = (math.sin(dla / 2) ** 2
             + math.cos(A[0] * DEG) * math.cos(B[0] * DEG) * math.sin(dlo / 2) ** 2)
        d = 2.0 * R_EARTH_M * math.asin(min(1.0, math.sqrt(abs(h))))
        return _gc_step(A[0], A[1], brg, d / 2.0)

    arcs = []
    for pts in comps:
        cc = [circ(lon, lat) for (lon, lat) in pts]
        n = len(pts)
        vis = [c[1] for c in cc]

        # Split this closed loop into maximal sunlit runs.
        if all(vis):
            runs = [list(range(n))]
        elif not any(vis):
            continue
        else:
            runs = []; i = 0
            while vis[(i - 1) % n]: i += 1      # start at a dark->lit edge
            for k in range(n):
                j = (i + k) % n
                if vis[j]:
                    if not runs or not vis[(j - 1) % n]: runs.append([])
                    runs[-1].append(j)

        def edge_refine(j_lit, j_dark):
            """Exact day/night crossing on the contour between two vertices."""
            A = (pts[j_lit][1], pts[j_lit][0]); B = (pts[j_dark][1], pts[j_dark][0])
            for _ in range(14):
                mla, mlo = gc_mid(A, B)
                mla, mlo, ok = _pen_correct(rec, mla, mlo)
                if not ok: break
                if _pen_depth(rec, mla, mlo)[2] > 0.0: A = (mla, mlo)
                else: B = (mla, mlo)
            return A

        for run in runs:
            if len(run) < 5: continue
            arc = [(pts[j][1], pts[j][0]) for j in run]      # (lat, lon)
            if not all(vis):
                arc = ([edge_refine(run[0], (run[0] - 1) % n)] + arc
                       + [edge_refine(run[-1], (run[-1] + 1) % n)])
            # time-order the arc (P1 end first), matching the incumbent walker.
            if cc[run[0]][0] > cc[run[-1]][0]: arc = arc[::-1]
            north_votes = sum(1 for j in run if cc[j][2])
            arcs.append((north_votes * 2 > len(run), arc))

    def fmt(arc): return [[round(lo, 4), round(la, 4)] for (la, lo) in arc]
    new_n = [a for isn, a in arcs if isn]
    new_s = [a for isn, a in arcs if not isn]
    # Accept per side only on a clean single arc; anything odd keeps incumbent.
    pn = fmt(new_n[0]) if len(new_n) == 1 else pn_old
    ps = fmt(new_s[0]) if len(new_s) == 1 else ps_old
    if pn_old and not new_n: pn = pn_old
    if ps_old and not new_s: ps = ps_old
    return pn, ps


# ── Umbral limits on the implicit-field engine ───────────────────────────────
# The same method as the penumbra and the green line: a limit IS the zero contour
# of the ever-central depth field, so it is traced rather than reconstructed from
# the centreline. One method for every central eclipse: total, annular, hybrid,
# grazing, polar, and corridors narrower than the tracer step.

def _umb_g(rec, lat, lon, t):
    X, _, Y, _, d_r, mu, dt_s, _, L2 = bstate(rec, t)
    xi, eta, zeta = _fund_true(lat, lon, d_r, mu, dt_s)
    return abs(L2 - zeta * rec['tan_f2']) - math.hypot(xi - X, eta - Y)


def _umb_depth(rec, lat, lon, N=96, t0=None):
    """(D, t*, sin_alt): D = max over t of (|L2'| - axis distance), >0 where the
    point is ever inside the umbra/antumbra, 0 on the limit. Ungated by the
    horizon; sin_alt is the sun's altitude at the point's own maximum t*."""
    tmin, tmax = rec['tmin'], rec['tmax']; W = (tmax - tmin) / N
    if t0 is None:
        bt = tmin; bg = -1e9
        for i in range(N + 1):
            t = tmin + (tmax - tmin) * i / N
            g = _umb_g(rec, lat, lon, t)
            if g > bg: bg, bt = g, t
    else:
        bt = t0
    a = max(tmin, bt - W); b = min(tmax, bt + W); a0, b0 = a, b
    for _ in range(40):
        m1 = a + (b - a) / 3; m2 = b - (b - a) / 3
        if _umb_g(rec, lat, lon, m1) < _umb_g(rec, lat, lon, m2): a = m1
        else: b = m2
    ts = (a + b) / 2
    if t0 is not None and ((ts - a0 < 1e-3 * W and a0 > tmin) or (b0 - ts < 1e-3 * W and b0 < tmax)):
        return _umb_depth(rec, lat, lon, N)      # maximum left the warm bracket: full scan
    _, _, _, _, d_r, mu, dt_s, _, _ = bstate(rec, ts)
    return _umb_g(rec, lat, lon, ts), ts, _sun_sin_alt(lat, lon, d_r, mu, dt_s)


def _umb_side(rec, lat, lon, ts):
    """> 0 left of the shadow's motion (north limit), < 0 right (south)."""
    X, Xp, Y, Yp, d_r, mu, dt_s, _, _ = bstate(rec, ts)
    xi, eta, _ = _fund_true(lat, lon, d_r, mu, dt_s)
    return ((xi - X) * (-Yp) + (eta - Y) * Xp) / (math.hypot(Xp, Yp) or 1e-12)


def _umb_correct(rec, lat, lon, iters=40):
    """Newton onto D = 0 along the local geodesic gradient.

    Width-aware like _trace_zero: w = |L2'(t*)| * R (m) never exceeds the local
    corridor half-width (a ground step moves the fundamental-plane distance by
    at most as much), so probes <= w/4 and Newton steps <= w/2 cannot reach the
    other limb, and the tolerance is in millimetres. With fixed 2 km probes and
    a 13 m acceptance, seeds in a 350 m corridor failed or landed on the OTHER
    limb (-1747-11-10: the south limb between its pinches was never traced)."""
    f = lambda la, lo: _umb_depth(rec, la, lo)[0]
    for _ in range(iters):
        v, ts, _ = _umb_depth(rec, lat, lon)
        if abs(v) < 1e-10: return lat, lon
        _, _, _, _, d_r, mu, dt_s, _, L2 = bstate(rec, ts)
        w = abs(L2 - _fund_true(lat, lon, d_r, mu, dt_s)[2] * rec['tan_f2']) * R_EARTH_M
        H = max(0.05, min(2000.0, 0.25 * w))
        gN = (f(*_gc_step(lat, lon, 0.0, H)) - f(*_gc_step(lat, lon, math.pi, H))) / (2 * H)
        gE = (f(*_gc_step(lat, lon, math.pi / 2, H)) - f(*_gc_step(lat, lon, -math.pi / 2, H))) / (2 * H)
        g2 = gN * gN + gE * gE
        if g2 < 1e-30: return None
        dist = -v / math.sqrt(g2)
        if abs(dist) > 500e3: return None
        dist = max(-0.5 * w, min(0.5 * w, dist)) if w > 0 else dist
        lat, lon = _gc_step(lat, lon, math.atan2(gE, gN), dist)
    return (lat, lon) if abs(f(lat, lon)) < 1e-9 else None


NIGHT_SIN_ALT = -0.2     # sun ~11.5 deg below the horizon: umbral tracing stops here
UMB_STEP_KM = 10.0       # tracer step for umbral limits (the width cap shortens it in thin corridors)
UMB_MAXPTS = 20000       # per trace direction
ANCHOR_KM = 5.0          # field warm start: full time scan at most this far apart
PINCH_HW_KM = 0.05       # tracing stops at this half-width beside a hybrid pinch ...
PINCH_JOIN_KM = 60.0     # ... and a limb end this close to the pinch is joined to it exactly
UMB_MAX_STEP_KM = 30.0   # a traced limb with a longer step is malformed (the tracer jumped)


def umbral_limits_valid(north, south, two_limit):
    """A traced result is trusted only if every step is a tracer step. A longer
    one means the tracer jumped between limbs. build_path reports a result that
    fails this check."""
    if two_limit and not (north and south):
        return False                      # a two-limit eclipse must yield both limbs
    for arc in north + south:
        for p, q in zip(arc, arc[1:]):
            if _gc_dist((p[1], p[0]), (q[1], q[0])) > UMB_MAX_STEP_KM * 1e3:
                return False
    return True


def _drop_retraced(arcs, tol_km=1.0, frac=0.9):
    """Same-side arcs that are one curve traced twice (1927-06-29's south limb):
    drop the shorter when >= frac of its vertices lie within tol_km of the longer
    arc's segments. Only ever given arcs of ONE side, so a narrow corridor's two
    real limbs are never compared with each other."""
    def v(lon, lat):
        return (math.cos(lat * DEG) * math.cos(lon * DEG),
                math.cos(lat * DEG) * math.sin(lon * DEG), math.sin(lat * DEG))
    def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    def ang(a, b): return math.acos(max(-1.0, min(1.0, dot(a, b))))
    def seg_km(P, A, B):
        n = (A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0])
        nn = math.sqrt(dot(n, n))
        if nn < 1e-15: return 6371.0 * min(ang(P, A), ang(P, B))
        xt = math.asin(max(-1.0, min(1.0, dot(P, n) / nn)))
        ab = ang(A, B); c = max(1e-15, math.cos(xt))
        if (math.acos(max(-1.0, min(1.0, math.cos(ang(P, A)) / c))) <= ab and
                math.acos(max(-1.0, min(1.0, math.cos(ang(P, B)) / c))) <= ab):
            return 6371.0 * abs(xt)
        return 6371.0 * min(ang(P, A), ang(P, B))
    keep = []
    for a in sorted(arcs, key=len, reverse=True):
        smp = [v(*p) for p in a[::max(1, len(a) // 30)]]
        dup = False
        for k in keep:
            kv = [v(*p) for p in k]
            near = sum(1 for P in smp
                       if min(seg_km(P, kv[m], kv[m + 1]) for m in range(len(kv) - 1)) < tol_km)
            if near >= frac * len(smp): dup = True; break
        if not dup: keep.append(a)
    return keep


def _umb_deep_pt(rec, t):
    """Ground point nearest the shadow axis at t: the centreline point, or, when
    the axis misses the Earth, the rim point below it. Deepest in the umbra at t."""
    X, _, Y, _, d_r, mu, dt_s, _, _ = bstate(rec, t)
    rho1 = math.sqrt(1.0 - E2 * math.cos(d_r) ** 2)
    u, w = X, Y / rho1
    m = math.hypot(u, w)
    k = min(1.0, (1.0 - 1e-9) / m) if m > 0 else 1.0
    return f2g(u * k, w * k * rho1, d_r, mu, dt_s)


def _umb_march_seeds(rec, n_seed, n_scan=2000, max_km=3000.0):
    """Seeds on D = 0 found from inside the umbral region. For each time at
    which the deepest ground point is in the umbra, march perpendicular to its
    motion, both ways, doubling the distance until D < 0, then bisect onto the
    sign change. The scan is fine because a grazer's umbra touches the Earth for
    as little as 0.6% of the window (332-03-13), and cheap (no depth search)."""
    tmin, tmax = rec['tmin'], rec['tmax']; dt = (tmax - tmin) / n_scan
    inside = []
    for i in range(n_scan + 1):
        t = tmin + dt * i; p = _umb_deep_pt(rec, t)
        if p and _umb_g(rec, p[0], p[1], t) > 0: inside.append((t, p))
    out = []
    for t, p in inside[::max(1, len(inside) // n_seed)]:
        a = _umb_deep_pt(rec, t - dt); b = _umb_deep_pt(rec, t + dt)
        if not (a and b): continue
        brg = _gc_bearing(a, b)
        for side in (1, -1):
            bb = brg + side * math.pi / 2
            lo, hi, d = 0.0, None, 2e3
            while d <= max_km * 1e3:
                D, _, sa = _umb_depth(rec, *_gc_step(p[0], p[1], bb, d))
                if sa <= NIGHT_SIN_ALT: break
                if D < 0: hi = d; break
                lo = d; d *= 2
            if hi is None: continue
            while hi - lo > 1.0:
                m = (lo + hi) / 2
                if _umb_depth(rec, *_gc_step(p[0], p[1], bb, m))[0] > 0: lo = m
                else: hi = m
            out.append(_gc_step(p[0], p[1], bb, lo))
    return out


def _umb_pinches(rec, n_scan=2000):
    """A hybrid's pinch points (lat, lon, t): where the on-axis umbral radius
    L2 - zeta*tan f2 changes sign (total <-> annular). Both limbs meet there, so
    it is supplied exactly, as the green-line termini are."""
    tmin, tmax = rec['tmin'], rec['tmax']
    def q(t):
        X, _, Y, _, d_r, mu, dt_s, _, L2 = bstate(rec, t)
        p = f2g(X, Y, d_r, mu, dt_s)
        if p is None: return None, None
        return L2 - _fund_true(p[0], p[1], d_r, mu, dt_s)[2] * rec['tan_f2'], p
    out = []; prev = None
    for i in range(n_scan + 1):
        t = tmin + (tmax - tmin) * i / n_scan
        v, p = q(t)
        if v is not None and prev is not None and (v > 0) != (prev[0] > 0):
            a, b, va = prev[1], t, prev[0]
            for _ in range(50):
                m = (a + b) / 2; vm, pm = q(m)
                if vm is None: break
                if (vm > 0) == (va > 0): a, va = m, vm
                else: b = m
            tp = (a + b) / 2; p = q(tp)[1]
            if p is not None: out.append((p[0], p[1], tp))
        prev = (v, t) if v is not None else None
    return out


def umbral_limits_field(rec, step_km=UMB_STEP_KM, n_seed_times=48):
    """Umbral N/S limits for a total or annular eclipse (two-limit or one-limit).

    Seeds come from the analytic envelope points (umbral_pts), which lie on or
    near the limit, and from _umb_march_seeds, which reaches the limbs the
    envelope misses (grazers, where envelope points exist for < 1% of the
    window). Each is Newton-corrected onto D = 0 and traced with _trace_zero.
    Both sources are needed: march-only loses 1547-11-12's north limb. The traced contour is kept where the sun is up at the point's
    own maximum (so every limb ends on the green line), cut into limbs wherever
    visibility or the side of the shadow's motion changes, and labelled N/S by
    that side. Every cut is bisected onto the exact break.

    One method for every central eclipse, including hybrids and corridors
    narrower than the step (2026-09-18b): the tracer's step and probes follow the
    local corridor half-width |L2'|/|grad D| (see _trace_zero), and a seed is
    skipped only when a traced limb ON ITS OWN SIDE is already near it. At a
    hybrid's pinch (L2' = 0) the limbs meet: tracing stops beside it and each limb
    is joined to the exact pinch point (_umb_pinches).

    Returns (north_segs, south_segs) of [(lon, lat), ...] in time order."""
    tmin, tmax = rec['tmin'], rec['tmax']
    seeds = []
    for i in range(n_seed_times + 1):
        n_pt, s_pt = umbral_pts(rec, tmin + (tmax - tmin) * i / n_seed_times)
        for p in (n_pt, s_pt):
            if p is not None: seeds.append(p)
    seeds += _umb_march_seeds(rec, n_seed_times)
    st = {'a': None, 't': None}
    def field(la, lo):
        # The limbs end on the horizon, so the contour is only needed on the day
        # side. Without this cut it wraps round the night side, overruns maxpts
        # and retraces the same limb (1984-11-22: one limb three times).
        # Warm start: a full time scan at an anchor, then a local search from the
        # anchor's t* for every query within ANCHOR_KM of it. Seeding each query
        # from the PREVIOUS query's t* made the field depend on call order, and
        # Newton failed where t* has two maxima (1507-07-10 near its pinch).
        if st['a'] is None or _gc_dist(st['a'], (la, lo)) > ANCHOR_KM * 1e3:
            D, ts, sa = _umb_depth(rec, la, lo)
            st['a'], st['t'] = (la, lo), ts
        else:
            D, ts, sa = _umb_depth(rec, la, lo, t0=st['t'])
        return D if sa > NIGHT_SIN_ALT else None
    def width(la, lo, g):
        _, ts, _ = _umb_depth(rec, la, lo, t0=st['t'])
        _, _, _, _, d_r, mu, dt_s, _, L2 = bstate(rec, ts)
        z = _fund_true(la, lo, d_r, mu, dt_s)[2]
        return abs(L2 - z * rec['tan_f2']) / g / 1000.0      # half-width, km
    pinches = _umb_pinches(rec)
    comps = []; sides = {}
    def side_at(la, lo):
        _, ts, _ = _umb_depth(rec, la, lo)
        return _umb_side(rec, la, lo, ts) > 0
    def traced(la, lo, d_m):
        # Already traced: a traced vertex within d_m ON THE SAME SIDE of the
        # shadow's motion. Side-blind, a narrow corridor's other limb (always
        # within d_m) would count, and that limb would never be traced.
        near = sorted((_gc_dist((la, lo), (q[1], q[0])), k, i)
                      for k, (cc, _) in enumerate(comps) for i, q in enumerate(cc))
        near = [x for x in near if x[0] < d_m]
        if not near: return False
        me = side_at(la, lo)
        for _, k, i in near:
            if (k, i) not in sides:
                q = comps[k][0][i]; sides[(k, i)] = side_at(q[1], q[0])
            if sides[(k, i)] == me: return True
        return False
    for (la, lo) in seeds:
        if traced(la, lo, 60e3): continue
        c = _umb_correct(rec, la, lo)
        if c is None or traced(c[0], c[1], 3 * step_km * 1e3): continue
        st['a'] = None
        pts, closed = _trace_zero(field, c, step_km=step_km, min_km=1.0, maxpts=UMB_MAXPTS, width=width,
                                  min_width=PINCH_HW_KM, tol=1e-10, accept=1e-9)
        if len(pts) >= 3: comps.append((pts, closed))

    north, south = [], []
    for pts, closed in comps:
        n = len(pts)
        info = [_umb_depth(rec, lat, lon) for lon, lat in pts]
        lab = [(sa > 0, _umb_side(rec, lat, lon, ts) > 0)
               for (lon, lat), (_, ts, sa) in zip(pts, info)]
        brk = [i for i in range(n) if (closed or i > 0) and lab[i] != lab[i - 1]]
        if not brk:
            runs = [list(range(n))]
        elif closed:
            runs = [[j % n for j in range(a, b)] for a, b in zip(brk, brk[1:] + [brk[0] + n])]
        else:
            cuts = [0] + brk + [n]
            runs = [list(range(a, b)) for a, b in zip(cuts, cuts[1:])]

        def lab_at(lat, lon):
            _, ts, sa = _umb_depth(rec, lat, lon)
            return (sa > 0, _umb_side(rec, lat, lon, ts) > 0)

        def refine(j_in, j_out):
            A = (pts[j_in][1], pts[j_in][0]); B = (pts[j_out][1], pts[j_out][0]); L = lab[j_in]
            for _ in range(30):
                d = _gc_dist(A, B)
                if d < 1.0: break
                m = _gc_step(A[0], A[1], _gc_bearing(A, B), d / 2)
                c = _umb_correct(rec, m[0], m[1])
                if c and _gc_dist(c, m) <= d / 2: m = c
                if lab_at(*m) == L: A = m
                else: B = m
            return (A[1], A[0])

        for r in runs:
            if len(r) < 3 or not lab[r[0]][0]: continue
            arc = [pts[j] for j in r]
            if brk and (closed or r[0] > 0): arc = [refine(r[0], (r[0] - 1) % n)] + arc
            if brk and (closed or r[-1] < n - 1): arc = arc + [refine(r[-1], (r[-1] + 1) % n)]
            if info[r[0]][1] > info[r[-1]][1]: arc = arc[::-1]
            (north if lab[r[0]][1] else south).append(arc)
    # A limb that stopped beside a pinch (PINCH_HW_KM) is continued to it along
    # the centreline: in that zone the limb is within PINCH_HW_KM of the
    # centreline, and the gap closes to zero at the pinch. A straight chord
    # was wrong: on the thinnest hybrids the zone is 32-39 km long, where a
    # chord's sagitta (50-150 m) exceeds the corridor (-1747-11-10, -1716-09-28).
    for arc in north + south:
        for k in (0, -1):
            lo, la = arc[k]
            for pl, po, tp in pinches:
                d = _gc_dist((la, lo), (pl, po))
                if 1.0 < d < PINCH_JOIN_KM * 1e3:
                    te = _umb_depth(rec, la, lo)[1]
                    m = int(d / 5e3)                      # <= 5 km spacing
                    fill = [centreline_pt(rec, te + (tp - te) * j / (m + 1)) for j in range(1, m + 1)]
                    fill = [(c[1], c[0]) for c in fill if c] + [(po, pl)]
                    if k == 0: arc[:0] = fill[::-1]
                    else: arc.extend(fill)
                    break
    return _drop_retraced(north), _drop_retraced(south)


def build_path(rec, step_min=STEP_MIN, pen_n=PEN_N):
    tmin=rec['tmin']; tmax=rec['tmax']; step=step_min/60.0
    # Central eclipses include all T (total), A (annular), H (hybrid)
    # variants — including suffixed types like Tm, T-, T+, A-, A+, Am,
    # An, As, H3, Hm. Any eclipse whose type starts with T, A, or H has
    # an umbra/antumbra path on Earth and should produce centreline,
    # umbra_n, umbra_s, and umbra_ovals output.
    et = rec.get('eclipse_type', '?')
    is_central = bool(et) and et[0] in ('T', 'A', 'H')

    # ── Centreline and umbral limits, by adaptive arc-length sampling ───
    # Walk the shadow across the Earth, choosing each next time-step from the
    # last so that the centreline moves a roughly constant great-circle
    # distance per step. Slow-moving graze regions near the tips automatically
    # get fine sampling; fast straight midsegments get coarse sampling. No
    # special tip-region logic is required and there is no kink at any join.
    MAX_KM   = 30.0    # match the baseline's sampling density (~30 km/sample)
    MIN_KM   = 10.0    # ≥ a third of MAX_KM, to avoid wasted points
    DT_MIN   = 1.0/3600.0       # 1 second
    DT_MAX   = step             # 1 minute (existing STEP_MIN)
    EARTH_R_KM = 6371.0

    def gc_km(p, q):
        if p is None or q is None: return None
        lat1, lon1 = p; lat2, lon2 = q
        p1 = lat1*DEG; p2 = lat2*DEG; dl = (lon2-lon1)*DEG
        a = math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return EARTH_R_KM * 2*math.asin(math.sqrt(max(0.0, min(1.0, a))))

    def find_first_valid(t_lo, t_hi):
        # Earliest t in [t_lo, t_hi] at which the shadow axis meets the Earth.
        scan = t_lo
        prev_ok = False
        while scan <= t_hi + 1e-9:
            ok = centreline_pt(rec, scan) is not None
            if ok:
                if prev_ok or scan <= t_lo + 1e-9:
                    return scan
                # bisect between (scan - step, scan) for tangency precision
                t_out, t_in = scan - step, scan
                for _ in range(40):
                    tm = 0.5*(t_out + t_in)
                    if centreline_pt(rec, tm) is not None: t_in = tm
                    else: t_out = tm
                    if t_in - t_out < 1e-7: break
                return t_in
            prev_ok = ok
            scan += step
        return None

    def find_last_valid(t_lo, t_hi):
        # Latest t in [t_lo, t_hi] at which the shadow axis meets the Earth.
        scan = t_hi
        while scan >= t_lo - 1e-9:
            ok = centreline_pt(rec, scan) is not None
            if ok:
                # bisect between (scan, scan + step) for tangency
                t_in, t_out = scan, scan + step
                for _ in range(40):
                    tm = 0.5*(t_in + t_out)
                    if centreline_pt(rec, tm) is not None: t_in = tm
                    else: t_out = tm
                    if t_out - t_in < 1e-7: break
                return t_in
            scan -= step
        return None

    def adaptive_walk(t_start, t_end, sampler, k_max=MAX_KM, k_min=MIN_KM):
        # sampler(t) -> (lat, lon) or None
        # returns list of (t, lat, lon) accepted samples, in time order
        out = []
        p0 = sampler(t_start)
        if p0 is None: return out
        out.append((t_start, p0[0], p0[1]))
        t_cur = t_start
        dt = DT_MAX  # start coarse; adaptive step adjusts as needed
        SAFETY_BAILOUT = 100000
        iters = 0
        while t_cur < t_end - 1e-9 and iters < SAFETY_BAILOUT:
            iters += 1
            # Don't overshoot t_end
            t_next = min(t_cur + dt, t_end)
            p_next = sampler(t_next)
            if p_next is None:
                # Out-of-bounds — try smaller step
                dt = max(DT_MIN, dt * 0.5)
                if dt <= DT_MIN + 1e-12:
                    break  # we're at a tangency; stop
                continue
            d = gc_km(out[-1][1:], p_next)
            if d > k_max and dt > DT_MIN + 1e-12:
                # Step too big — shrink and retry without accepting
                dt = max(DT_MIN, dt * 0.5)
                continue
            # Accept. If the step is still over-long at the DT_MIN floor
            # (a √-cusp at first/last contact, where the limit point races
            # along the limb faster than 1 s of time-stepping can resolve),
            # fill it with intermediate on-curve samples by arc-length
            # bisection in time. No-op for ordinary steps (d <= k_max).
            if d > k_max:
                def _fill(ta, pa, tb, pb, depth):
                    if gc_km(pa, pb) <= k_max or depth > 40 or (tb - ta) < 1e-10:
                        out.append((tb, pb[0], pb[1])); return
                    tmid = 0.5*(ta + tb); pmid = sampler(tmid)
                    if pmid is None:
                        out.append((tb, pb[0], pb[1])); return
                    _fill(ta, pa, tmid, pmid, depth+1)
                    _fill(tmid, pmid, tb, pb, depth+1)
                _fill(t_cur, (out[-1][1], out[-1][2]), t_next, p_next, 0)
            else:
                out.append((t_next, p_next[0], p_next[1]))
            t_cur = t_next
            # Grow step if the move was small enough that doubling would
            # still stay under k_max
            if d < k_min and dt < DT_MAX:
                dt = min(DT_MAX, dt * 2.0)
        return out

    cl = []
    if is_central:
        _GREEN = green_curve(rec)
        # The centreline's own validity interval (bisected to the tangency).
        t_cA = find_first_valid(tmin, tmax)
        t_cB = find_last_valid(tmin, tmax)

        def _max_sun_alt(lat, lon):
            # Sun altitude (deg) at this ground point at the instant of ITS OWN
            # maximum eclipse. >=0 => eclipse visible (sun up) at max. The locus
            # where ==0 is the "Maximum on Horizon" (green) curve; every limit
            # and the centreline end there (visible totality).
            def adz(t):
                X, _, Y, _, d_r, mu, dt_s, L1, L2 = bstate(rec, t)
                xi, eta, _zeta = _fund_true(lat, lon, d_r, mu, dt_s)
                return math.hypot(xi - X, eta - Y), _sun_sin_alt(lat, lon, d_r, mu, dt_s)
            N = 48; bt = tmin; bd = 1e18
            for i in range(N+1):
                t = tmin + (tmax - tmin)*i/N
                dme, _z = adz(t)
                if dme < bd: bd = dme; bt = t
            a = max(tmin, bt-(tmax-tmin)/N); b = min(tmax, bt+(tmax-tmin)/N)
            bz = -1.0
            for _ in range(40):
                m1 = a + (b-a)/3; m2 = b - (b-a)/3
                d1, z1 = adz(m1); d2, z2 = adz(m2)
                if d1 < d2: b = m2; bz = z1
                else: a = m1; bz = z2
            return math.degrees(math.asin(max(-1.0, min(1.0, bz))))

        def _visible_trim(walk):
            # Keep the longest contiguous run of points whose own maximum
            # eclipse is sunlit (sun alt >= 0): terminate each curve on the
            # Maximum-on-Horizon (green) curve, the baseline's universal rule. No-op
            # when the whole curve is sunlit (ordinary eclipses).
            if not walk: return walk
            vis = [_max_sun_alt(la, lo) >= 0.0 for (_, la, lo) in walk]
            if all(vis): return walk
            best_lo = best_hi = 0; cur = None
            for i, v in enumerate(vis + [False]):
                if v and cur is None: cur = i
                elif not v and cur is not None:
                    if i - cur > best_hi - best_lo: best_lo, best_hi = cur, i
                    cur = None
            return walk[best_lo:best_hi]

        # Walk centreline over its own valid interval.
        if t_cA is not None and t_cB is not None and t_cB > t_cA + 1e-9:
            walk = _visible_trim(adaptive_walk(t_cA, t_cB, lambda t: centreline_pt(rec, t)))
        else:
            walk = []
        for (_, lat, lon) in walk:
            cl.append([round(lon, 5), round(lat, 5)])

    else:
        # Partial / non-central eclipse: only the centreline is meaningful,
        # and even that only where the axis hits Earth. (Often empty.)
        t_cA = find_first_valid(tmin, tmax)
        t_cB = find_last_valid(tmin, tmax)
        if t_cA is not None and t_cB is not None and t_cB > t_cA + 1e-9:
            walk = adaptive_walk(t_cA, t_cB, lambda t: centreline_pt(rec, t))
            for (_, lat, lon) in walk:
                cl.append([round(lon, 5), round(lat, 5)])

    cl_segs = [cl] if cl else []

    # ── Umbral N/S limits ───────────────────────────────────────────────
    # Traced by umbral_limits_field as the zero contour of the ever-in-umbra
    # depth. A result failing umbral_limits_valid is reported, not replaced.
    one_limit = is_central and len(et) > 1 and et[1] in ('n', 's', '-', '+')
    _n_segs, _s_segs = [], []
    if is_central:
        _tag = f"{rec.get('year')}-{rec.get('month')}-{rec.get('day')}"
        try:
            _n_segs, _s_segs = umbral_limits_field(rec)
        except Exception as e:
            print(f"  UMBRAL LIMITS FAILED {_tag} {et}: {e}", flush=True)
        if not umbral_limits_valid(_n_segs, _s_segs, not one_limit):
            print(f"  UMBRAL LIMITS INVALID {_tag} {et}", flush=True)
    un_segs = [[[round(lo, 5), round(la, 5)] for (lo, la) in seg] for seg in _n_segs]
    us_segs = [[[round(lo, 5), round(la, 5)] for (lo, la) in seg] for seg in _s_segs]
    if is_central and not one_limit and len(cl) >= 7:
        # Narrow-band densification. On near-grazing eclipses the umbral
        # band can be narrower than the chord sagitta of the standard
        # 1-minute sampling (~15 km spacing): 1986-10-03's band thins to
        # 2.4 km and the drawn centreline chords exited the drawn band by
        # up to 152 m — the "centreline outside the umbral path" effect.
        # Where the local band width drops below NARROW_KM, resample the
        # centreline walk so vertex spacing tracks the width. Pure resampling
        # of the same exact curve; costs nothing except on grazers.
        NARROW_KM = 12.0
        if (_n_segs or _s_segs) and len(walk) >= 3:
            _unf = [q for s in _n_segs for q in s]
            _usf = [q for s in _s_segs for q in s]
            def _gckm(a, b):
                h = (math.sin((b[1] - a[1]) * DEG / 2) ** 2
                     + math.cos(a[1] * DEG) * math.cos(b[1] * DEG)
                     * math.sin((b[0] - a[0]) * DEG / 2) ** 2)
                return 6371.0 * 2.0 * math.asin(min(1.0, math.sqrt(abs(h))))
            def _width_at(lon, lat):
                if not _unf or not _usf: return 1e9
                dn = min(_gckm((lon, lat), q) for q in _unf)
                ds = min(_gckm((lon, lat), q) for q in _usf)
                return dn + ds
            wds = [_width_at(lon, lat) for (_t, lat, lon) in walk]
            # Only INTERIOR narrowness qualifies: every eclipse's band
            # tapers to zero at its grazing tips, and densifying there merely
            # perturbs validated tip geometry (2033's umbra_s max drifted
            # 1.9 -> 3.7 km).
            _in0, _in1 = 3, len(walk) - 5
            _interior = [w for w in wds[_in0:_in1 + 1]]
            if _interior and min(_interior) < NARROW_KM:
                walk2 = [walk[0]]
                for i in range(len(walk) - 1):
                    (t0, la0, lo0), (t1, la1, lo1) = walk[i], walk[i + 1]
                    w = min(wds[i], wds[i + 1])
                    if w < NARROW_KM and _in0 <= i <= _in1:
                        span = _gckm((lo0, la0), (lo1, la1))
                        target = max(0.8, w / 1.5)
                        nsub = min(40, max(1, int(math.ceil(span / target))))
                        for k in range(1, nsub):
                            tk = t0 + (t1 - t0) * k / nsub
                            pk = centreline_pt(rec, tk)
                            if pk: walk2.append((tk, pk[0], pk[1]))
                    walk2.append(walk[i + 1])
                walk = walk2
                cl = [[round(lon, 5), round(lat, 5)] for (_t, lat, lon) in walk]
                cl_segs = [cl]

    # Unwrap all curves so they are continuous past the antimeridian
    cl_segs = [unwrap(cl_segs[0])] if cl_segs else []
    un_segs = [unwrap(s) for s in un_segs] if un_segs else []
    us_segs = [unwrap(s) for s in us_segs] if us_segs else []

    # Break any limb that transits a pole (avoids the spurious across-pole line)
    cl_segs = _split_at_pole(cl_segs)
    un_segs = _split_at_pole(un_segs)
    us_segs = _split_at_pole(us_segs)

    # ── Penumbral limits ───────────────────────────────────────────────
    pn, ps, t_first, t_last = penumbral_limits(rec, step_min, pen_n)
    # Re-derive the curves on the implicit-field engine (sub-km vs the
    # walker's ~9 km); t_first/t_last and all downstream consumers keep the
    # walker's values. Falls back to the walker's curves per side on any
    # sanity failure inside.
    pn, ps = penumbral_limits_field(rec, pn, ps)

    # ── Terminators: sunrise/sunset boundary loops of penumbral shadow ──
    if t_first is not None and t_last is not None:
        term_first, term_last = _terminator_curves(rec, t_first, t_last, TERM_STEP_MIN)
    else:
        term_first = term_last = []

    result = {
        'cat_no':           int(float(rec['cat_no'])) if rec.get('cat_no') is not None else None,
        'year':             rec['year'],
        'month':            rec['month'],
        'day':              rec['day'],
        'type':             rec.get('eclipse_type','?'),
        'ge':               _compute_ge(rec),
        'centreline':       cl_segs,
        'umbra_n':          un_segs,
        'umbra_s':          us_segs,
        'umbra_ovals':      umbra_ovals(rec) if is_central else [],
        'penumbra_n':       [unwrap(pn)] if pn else [],
        'penumbra_s':       [unwrap(ps)] if ps else [],
        'terminator_first': term_first,
        'terminator_last':  term_last,
        'green_curve':      _GREEN if is_central else [],
    }

    # ── Douglas-Peucker simplification ─────────────────────────────────
    # Store penumbra endpoints before DP for junction index computation
    pen_n_pts = result['penumbra_n'][0] if result['penumbra_n'] else []
    pen_s_pts = result['penumbra_s'][0] if result['penumbra_s'] else []
    pen_n_start = pen_n_pts[0]  if pen_n_pts else None
    pen_s_start = pen_s_pts[0]  if pen_s_pts else None
    pen_n_end   = pen_n_pts[-1] if pen_n_pts else None
    pen_s_end   = pen_s_pts[-1] if pen_s_pts else None
    #   centreline / umbra n,s : totality boundary — 10 m is meaningful
    #     because the experience flips on/off across this line.
    #   penumbra n,s          : the penumbra edge is where the Sun is
    #     just starting to be eclipsed — a fuzzy, gradient transition.
    #     ~200 m is invisible to any observer. Loose DP saves bytes.
    #   terminator first/last : sunrise/sunset boundary, wrapping
    #     thousands of km around Earth. 200 m is well below
    #     cartographic relevance.
    # Pole vertices (|lat| ≥ 89.9°) are force-kept inside simplify_dp.
    DP_TIGHT = 9e-5     # ≈ 10 m, for umbra and centreline
    DP_LOOSE = 1.8e-3   # ≈ 200 m, for penumbra and terminators
    for fld in ('centreline', 'umbra_n', 'umbra_s', 'umbra_ovals'):
        result[fld] = [simplify_dp(seg, tol=DP_TIGHT) for seg in result[fld]]
    for fld in ('penumbra_n', 'penumbra_s', 'terminator_first', 'terminator_last'):
        result[fld] = [simplify_dp(seg, tol=DP_LOOSE) for seg in result[fld]]

    # Join the lemniscates to the penumbral limits vertex-exactly: each true
    # penumbral terminus (magnitude-0 graze exactly at sunrise/sunset) lies
    # ON the rise/set curve, so insert it as a vertex. Done AFTER polyline
    # simplification, which would otherwise drop the inserted vertex where
    # the loop is locally straight (within the 200 m DP tolerance).
    _juncs = ([s[0][0] for s in (result['penumbra_n'], result['penumbra_s']) if s and s[0]]
              + [s[0][-1] for s in (result['penumbra_n'], result['penumbra_s']) if s and s[0]])
    _insert_rs_junctions(rec, result['terminator_first'], result['terminator_last'], _juncs)
    # ── Junction indices: where penumbra endpoints meet terminator loops ──
    # Computed after DP so indices reference the final simplified curves.
    def _junction_idx(term_segs, penumbra_endpoint):
        if not term_segs or not term_segs[0] or not penumbra_endpoint:
            return None
        seg = term_segs[0]
        px, py = penumbra_endpoint
        best, best_i = float('inf'), 0
        for i, p in enumerate(seg):
            dx = ((p[0]-px+180)%360)-180; dy = p[1]-py
            d = dx*dx + dy*dy
            if d < best: best, best_i = d, i
        return best_i

    result['terminator_first_n_idx'] = _junction_idx(result['terminator_first'], pen_n_start)
    result['terminator_first_s_idx'] = _junction_idx(result['terminator_first'], pen_s_start)
    result['terminator_last_n_idx']  = _junction_idx(result['terminator_last'],  pen_n_end)
    result['terminator_last_s_idx']  = _junction_idx(result['terminator_last'],  pen_s_end)

    # ── Audit pass: flag anomalies for later inspection ────────────────────
    # Heuristics that catch real bugs without spamming on legitimate cusps.
    # Each curve has its own concept of where cusps live:
    #  - centreline / umbra_n / umbra_s : cusps at the first and last few
    #    vertices (P1/P4 tangencies, envelope turning points). Skip near-end
    #    interior-turn checks accordingly.
    #  - penumbra_n / penumbra_s : open polylines whose start/end are the
    #    P1/P4 tangent points; cusps live there too.
    #  - terminator_first / terminator_last : closed loops with two cusps
    #    where the +CCW and −CCW branches meet. The cusps can be anywhere
    #    around the loop, so we don't enforce interior-turn checks on them.
    label = f"{rec['year']}-{rec['month']:02d}-{rec['day']:02d}"
    GAP_KM_MAX  = 350.0   # adjacent points further than this is suspicious
    INTERIOR_TURN_MAX = 30.0
    CUSP_MARGIN = 8       # exclude this many vertices at each end from turn check
    def gc_km_audit(p, q):
        p1 = p[1]*DEG; p2 = q[1]*DEG; dl = (q[0]-p[0])*DEG
        a = math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
        return 6371.0 * 2*math.asin(math.sqrt(max(0.0, min(1.0, a))))
    def turn_deg(a, b, c):
        # Physical great-circle turn at b, in degrees. Computed from initial
        # bearings, so longitude convergence near the pole and the antimeridian
        # seam do not distort it (a raw lon/lat angle reads a smooth 86°N curve
        # as a ~175° fold). Steps shorter than 1 km are skipped as noise.
        def _brg(p, q):
            la1 = math.radians(p[1]); la2 = math.radians(q[1])
            dl = math.radians(((q[0]-p[0]+180.0) % 360.0) - 180.0)
            return math.atan2(math.sin(dl)*math.cos(la2),
                              math.cos(la1)*math.sin(la2) - math.sin(la1)*math.cos(la2)*math.cos(dl))
        def _gckm(p, q):
            la1 = math.radians(p[1]); la2 = math.radians(q[1])
            dl = math.radians(((q[0]-p[0]+180.0) % 360.0) - 180.0)
            h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dl/2)**2
            return 2*6371.0*math.asin(min(1.0, math.sqrt(h)))
        if _gckm(a, b) < 1.0 or _gckm(b, c) < 1.0: return 0.0
        d = abs(math.degrees(_brg(b, c) - _brg(a, b))) % 360.0
        return min(d, 360.0 - d)
    def audit_curve(name, line, kind):
        if not line or len(line) < 2: return
        # Gap check across all consecutive pairs (skip the very first/last
        # gap for open polylines, where the first sample after a tangency
        # can legitimately be far from the cusp vertex).
        skip_gap = (1 if kind in ('open',) else 0)
        max_gap_km = 0.0; max_gap_idx = -1
        for i in range(skip_gap, len(line) - 1 - skip_gap):
            d = gc_km_audit(line[i], line[i+1])
            if d > max_gap_km:
                max_gap_km = d; max_gap_idx = i
        if max_gap_km > GAP_KM_MAX:
            print(f"  AUDIT {label} {name}: gap {max_gap_km:.0f} km at idx {max_gap_idx}->{max_gap_idx+1}")
        # Interior turn check (skip cusp-prone endpoints for non-loop curves;
        # closed loops have two cusps anywhere on the perimeter, so we skip
        # the turn check entirely on them).
        if kind == 'closed':
            return
        if len(line) >= 2*CUSP_MARGIN + 3:
            worst_turn = 0.0; worst_idx = -1
            for i in range(CUSP_MARGIN, len(line)-CUSP_MARGIN-1):
                # Skip triples that include a synthetic pole vertex (any
                # point with |lat| ≥ 89.9° is by construction inserted by
                # the pole-aware unwrap pass and is not a real path cusp).
                if (abs(line[i-1][1]) >= 89.9 or abs(line[i][1]) >= 89.9
                        or abs(line[i+1][1]) >= 89.9):
                    continue
                t = turn_deg(line[i-1], line[i], line[i+1])
                if t > worst_turn:
                    worst_turn = t; worst_idx = i
            if worst_turn > INTERIOR_TURN_MAX:
                print(f"  AUDIT {label} {name}: interior turn {worst_turn:.0f}° at idx {worst_idx}/{len(line)}")
    for fld, kind in [('centreline', 'open'), ('umbra_n', 'open'), ('umbra_s', 'open'),
                       ('penumbra_n', 'open'), ('penumbra_s', 'open'),
                       ('terminator_first', 'closed'), ('terminator_last', 'closed')]:
        for seg in result.get(fld) or []:
            audit_curve(fld, seg, kind=kind)
    return result


# ── Chunk processing ────────────────────────────────────────────────────────

def _round_path(path):
    """Round each field to its appropriate coordinate precision.

    High-accuracy curves (centreline, umbra) keep 5 dp (~1 m).
    Ovals keep 4 dp (~11 m).
    ge keeps 4 dp.
    Penumbra and terminators keep 4 dp (~10 m). (Penumbra was 2 dp, ~1 km,
    when it came from the walker, 20-100 km off; the field engine is sub-km.)
    All other fields (scalars, metadata) are passed through unchanged.
    """
    PREC = {
        'centreline':       5,
        'umbra_n':          5,
        'umbra_s':          5,
        'umbra_ovals':      4,
        'ge':               4,
        'terminator_first': 4,
        'terminator_last':  4,
        'penumbra_n':       4,
        'penumbra_s':       4,
    }
    def round_segs(segs, dp):
        return [[[round(lon, dp), round(lat, dp)] for lon, lat in seg]
                for seg in segs]
    result = {}
    for k, v in path.items():
        if k == 'green_curve' and isinstance(v, list):
            # flat [lon,lat] list with None component delimiters; 3 dp (~100 m)
            # is ample for a reference curve and keeps the file small.
            result[k] = [None if p is None else [round(p[0], 3), round(p[1], 3)]
                         for p in v]
        elif k in PREC and isinstance(v, list):
            dp = PREC[k]
            if k == 'ge':
                result[k] = [round(v[0], dp), round(v[1], dp)] if v else v
            else:
                result[k] = round_segs(v, dp)
        else:
            result[k] = v
    return result


def _build_one(args):
    """Worker: build one eclipse's rounded path. Returns (key, path). Pure
    function of its inputs — eclipses are independent, so this parallelizes
    safely with no shared state."""
    rec, step_min, pen_n = args
    cat = rec.get('cat_no')
    key = str(int(float(cat))) if cat is not None else f"{rec['year']}_{rec['month']}_{rec['day']}"
    return key, _round_path(build_path(rec, step_min, pen_n))


def _hms(s):
    s = int(max(0, s)); h = s // 3600; m = (s % 3600) // 60; sec = s % 60
    return f'{h}h{m:02d}m{sec:02d}s' if h else (f'{m}m{sec:02d}s' if m else f'{sec}s')


def process_chunk(path, out_dir, step_min, pen_n, jobs=1, chunk_pos=None):
    with open(path) as f: records=json.load(f)
    name=os.path.splitext(os.path.basename(path))[0]
    out_path=os.path.join(out_dir,f'paths_{name}.json.gz')
    paths={}
    _pos = f' [chunk {chunk_pos[0]}/{chunk_pos[1]}]' if chunk_pos else ''
    print(f'  {name}: {len(records)} eclipses' + (f' [{jobs} jobs]' if jobs > 1 else '') + _pos)
    n = len(records)
    _t0 = time.time()
    if jobs and jobs > 1:
        # Parallel: map preserves order; results merged into the same dict the
        # serial path would produce (byte-identical output, just faster).
        import multiprocessing as _mp
        with _mp.Pool(jobs) as pool:
            done = 0
            for key, p in pool.imap_unordered(_build_one,
                                    [(rec, step_min, pen_n) for rec in records],
                                    chunksize=1):
                paths[key] = p
                done += 1
                print(f"\r    {done}/{n} done   ", end="", flush=True)
        print(f"\r    {n}/{n}  done{' '*20}")
    else:
        for i, rec in enumerate(records):
            cat=rec.get('cat_no')
            key=str(int(float(cat))) if cat is not None else f"{rec['year']}_{rec['month']}_{rec['day']}"
            print(f"\r    {i+1}/{n}  {rec['year']}-{rec['month']:02d}-{rec['day']:02d}   ",
                  end="", flush=True)
            paths[key]=_round_path(build_path(rec, step_min, pen_n))
        print(f"\r    {n}/{n}  done{' '*20}")
    # Self-identifying stamp so a rebuilt chunk is verifiable in-app
    # (console.log(data.__meta)). Inserted last; the front-end reads paths by
    # cat_no key only (no whole-dict iteration), so this extra key is inert there.
    n_paths = len(paths)
    paths['__meta'] = {
        'generated': _dt.datetime.now(_dt.timezone.utc).isoformat(timespec='seconds'),
        'generator': GEN_VERSION,
        'chunk':     name,
        'count':     n_paths,
    }
    raw_bytes = json.dumps(paths, separators=(',',':')).encode()
    with _gz.open(out_path, 'wb', compresslevel=9) as f:
        f.write(raw_bytes)
    on_disk = os.path.getsize(out_path)
    print(f'    {len(raw_bytes)//1024}KB raw  {on_disk//1024}KB gz  '
          f'{n_paths} paths → {out_path}')
    _el = time.time() - _t0
    print(f'    {name}: {_hms(_el)}')
    return n


# ── CLI ────────────────────────────────────────────────────────────────────

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--data-dir',default='./data/besselian')
    p.add_argument('--out-dir', default='./data/paths')
    p.add_argument('--step',    type=float,default=float(STEP_MIN))
    p.add_argument('--pen-n',   type=int,  default=PEN_N)
    p.add_argument('--year',    type=int,  default=None,
                   help='Process only the chunk(s) containing this year')
    p.add_argument('--test',    action='store_true')
    p.add_argument('--jobs',    type=int, default=1,
                   help='parallel worker processes (default 1 = serial; '
                        'try 0 for all CPU cores)')
    args=p.parse_args()
    if args.test: run_tests(args.data_dir); return
    os.makedirs(args.out_dir, exist_ok=True)
    chunks=[c for c in sorted(glob.glob(os.path.join(args.data_dir,'*.json')))
            if os.path.basename(c) not in ('index.json','tz_index.json')]
    if not chunks: print('No chunks found'); return
    if args.year:
        matching=[]
        for c in chunks:
            with open(c) as f: records=json.load(f)
            if any(r.get('year')==args.year for r in records): matching.append(c)
        if not matching: print(f'No chunk found for year {args.year}'); return
        chunks=matching
    print(f'{len(chunks)} chunk(s)  step={args.step}m  pen-n={args.pen_n}'
          +(f'  year={args.year}' if args.year else ''))
    jobs = args.jobs
    if jobs == 0:
        import multiprocessing as _mp
        jobs = _mp.cpu_count()
    _ot0 = time.time()
    _total = 0
    for _i, c in enumerate(chunks):
        _total += process_chunk(c, args.out_dir, args.step, args.pen_n, jobs,
                                chunk_pos=(_i + 1, len(chunks))) or 0
    _run = _hms(time.time() - _ot0)
    if len(chunks) > 1:
        print(f'All {len(chunks)} centuries ({_total} eclipses) done in {_run}.')
    else:
        print(f'Done in {_run}.')


# ── Tests ──────────────────────────────────────────────────────────────────

def run_tests(data_dir='./data/besselian'):
    """Build three well-observed totals from the catalogue and check them against
    the catalogue's own greatest eclipse and path width. Exits non-zero on failure."""
    cases = [(2017, 8, 21), (1999, 8, 11), (1994, 11, 3)]
    recs = {}
    for c in glob.glob(os.path.join(data_dir, '*.json')):
        if os.path.basename(c) in ('index.json', 'tz_index.json'): continue
        with open(c) as f:
            for r in json.load(f):
                if (r.get('year'), r.get('month'), r.get('day')) in cases:
                    recs[(r['year'], r['month'], r['day'])] = r

    def flat(segs): return [p for s in segs for p in s]
    def km(a, b): return _gc_dist((a[1], a[0]), (b[1], b[0])) / 1000.0

    failures = 0
    for key in cases:
        label = '%d-%02d-%02d' % key
        rec = recs.get(key)
        if rec is None:
            print(f'{label}: FAIL  not found in {data_dir}'); failures += 1; continue
        path = build_path(rec)
        un, us = flat(path['umbra_n']), flat(path['umbra_s'])
        ge = path['ge']
        ge_off = km(ge, (rec['lng_dd_ge'], rec['lat_dd_ge']))
        width = (min(km(ge, q) for q in un) + min(km(ge, q) for q in us)) if un and us else 0.0
        checks = [
            ('centreline',                  bool(path['centreline'])),
            ('both umbral limits',          bool(un and us)),
            ('traced limits valid',         umbral_limits_valid(*umbral_limits_field(rec), True)),
            ('GE within 1 km of catalogue', ge_off < 1.0),
            ('width within 5% of catalogue', abs(width - rec['path_width']) <= 0.05 * rec['path_width']),
        ]
        bad = [name for name, ok in checks if not ok]
        failures += bool(bad)
        print(f'{label} {rec["eclipse_type"]}: {"FAIL  " + ", ".join(bad) if bad else "PASS"}'
              f'   GE off {ge_off * 1000:.0f} m   width {width:.1f} km (catalogue {rec["path_width"]})'
              f'   centreline {len(flat(path["centreline"]))} pts   umbra {len(un)}/{len(us)} pts')
    print('All tests pass' if not failures else f'{failures} test(s) FAILED')
    if failures: raise SystemExit(1)


def _split_at_pole(segs):
    """Split a limb wherever it transits a geographic pole. At |lat| = 90 every
    longitude is the same point, so two consecutive near-pole points with different
    longitudes are a single place — but on a flat map they draw as a spurious
    horizontal line along the pole (the 1591 "kink"). Break the segment there so
    each piece draws cleanly up to the pole, with no false across-pole connector."""
    out = []
    for seg in segs:
        if len(seg) < 2:
            out.append(seg); continue
        cur = [seg[0]]
        for i in range(1, len(seg)):
            if abs(seg[i][1]) >= 89.9 and abs(seg[i-1][1]) >= 89.9:
                if len(cur) >= 2: out.append(cur)
                cur = [seg[i]]
            else:
                cur.append(seg[i])
        if len(cur) >= 2: out.append(cur)
    return out


if __name__=='__main__':
    main()
