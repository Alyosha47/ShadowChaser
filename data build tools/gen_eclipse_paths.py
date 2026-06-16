#!/usr/bin/env python3
"""
gen_eclipse_paths.py  —  ShadowChaser
Generates eclipse path JSON from Besselian element chunk files.

Outputs per eclipse:
  - centreline, umbra_n, umbra_s  (umbral corridor + centreline)
  - umbra_ovals                   (umbral footprint params at intervals)
  - penumbra_n, penumbra_s        (geographic outer limits of penumbral shadow)
  - terminator_first, last        (sunrise/sunset line at P1 and P4 times)
  - ge                            (greatest eclipse point)

All features verified against Jubier / NASA reference data.

Usage:
    python3 gen_eclipse_paths.py --data-dir ./data/besselian --out-dir ./data/paths
    python3 gen_eclipse_paths.py --year 1994
    python3 gen_eclipse_paths.py --test
"""

import argparse, gzip as _gz, glob, json, math, os

# ── Constants ──────────────────────────────────────────────────────────────
DEG           = math.pi / 180.0
E2            = 2.0/298.257223563 - (1.0/298.257223563)**2
R_EARTH_M     = 6378137.0  # WGS84 equatorial radius (metres)
R             = 6371.0    # km
STEP_MIN      = 1         # minutes between path samples
TERM_STEP_MIN = 0.1       # finer step for terminator curves (was 0.5; gave ~80 km median vertex spacing → 6 km cross-track error)
PEN_N         = 720       # L1-circle sample points (penumbra sweep)
MIN_SEG       = 10        # minimum points to retain a segment
OVAL_STEP_MIN = 10        # minutes between umbral oval samples


# ── Polynomial evaluator ───────────────────────────────────────────────────

def poly(c, t):
    v = c[0] + c[1]*t + c[2]*t*t
    if len(c) > 3: v += c[3]*t*t*t
    return v


# ── Besselian state ────────────────────────────────────────────────────────

def bstate(rec, t):
    """All Besselian quantities at time t (hours from GE epoch)."""
    X   = poly([rec['x0'], rec['x1'], rec['x2'], rec['x3']], t)
    Xp  = poly([rec['x1'], 2*rec['x2'], 3*rec['x3'], 0],    t)
    Y   = poly([rec['y0'], rec['y1'], rec['y2'], rec['y3']], t)
    Yp  = poly([rec['y1'], 2*rec['y2'], 3*rec['y3'], 0],    t)
    d_r = poly([rec['d0'], rec['d1'], rec['d2'], 0],         t) * DEG
    mu  = poly([rec['mu0'], rec['mu1'], rec['mu2'], 0],      t)
    L1  = poly([rec['l10'], rec['l11'], rec['l12'], 0],  t)
    L2  = poly([rec['l20'], rec['l21'], rec['l22'], 0],  t)
    return X, Xp, Y, Yp, d_r, mu, rec['dt'], L1, L2


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
    against Jubier.

    Returns (lat_geodetic_deg, lon_deg) or None if (xi, eta) is outside
    the (corrected) Earth disk.
    """
    sin_d = math.sin(d_r); cos_d = math.cos(d_r)
    # Earth-flattening corrections
    rho1 = math.sqrt(1.0 - E2 * cos_d * cos_d)
    rho2 = math.sqrt(1.0 - E2 * sin_d * sin_d)
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


# ── Umbral limits (perpendicular-to-velocity offset) ───────────────────────

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


def _magnitude_at(rec, lat, lon, t):
    """Eclipse magnitude at geographic (lat, lon) at time t.
    Uses Bessel formula: (L1' - m) / (L1' + L2') where L1', L2' are cone radii
    at the observer's axial position. Returns 0 to 1."""
    X, _, Y, _, d_r, mu, dt_s, L1, L2 = bstate(rec, t)
    xi_p, eta_p, zeta_p, rho1 = _geo_to_fund(lat, lon, d_r, mu, dt_s)
    if zeta_p <= 0: return 0.0
    dx = xi_p - X
    dy = (eta_p - Y) / rho1
    m = math.sqrt(dx*dx + dy*dy)
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
        if fval(R) >= 0.0: return _gc_step(lat, lon, b_out, R)
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
    point-to-point chaining) and matches Jubier to sub-km, including polar
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
        # Pure magnitude=1 envelope. No disk-edge-clip splice: Jubier's limit
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


def _umbral_limb_endpoints(rec, t):
    """Two points where the L2 (umbral) circle crosses Earth's disk edge."""
    X, _, Y, _, d_r, mu, dt_s, _, L2 = bstate(rec, t)
    d = math.sqrt(X*X+Y*Y)
    if d < 1e-9: return None, None
    a = (1.0 - L2*L2 + d*d) / (2*d)
    disc = 1.0 - a*a
    if disc < 0: return None, None
    h = math.sqrt(disc)
    p2x=a*X/d; p2y=a*Y/d
    x3=p2x+h*(Y/d); y3=p2y-h*(X/d)
    x4=p2x-h*(Y/d); y4=p2y+h*(X/d)
    eps=1e-7
    return (f2g(x3*(1-eps), y3*(1-eps), d_r, mu, dt_s),
            f2g(x4*(1-eps), y4*(1-eps), d_r, mu, dt_s))


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

def _despur_segment(seg, spur_km=5.0, dup_km=0.5):
    """Remove degenerate spurs / duplicate vertices from a corridor polyline
    (list of [lon,lat]). A 'spur' is a vertex whose two NEIGHBOURS are within
    spur_km of each other — the corridor steps out and returns to ~the same spot
    (e.g. an over-the-pole whisker). Because the neighbours coincide the spur
    encloses ~zero area, so removal is LOSSLESS. Normal sampling (~16 km spacing)
    is never eligible, so a clean path is returned unchanged. A guard refuses any
    change that would increase the worst interior turn."""
    if len(seg) < 5:
        return seg
    def _hav(a, b):
        la1, la2 = a[1]*DEG, b[1]*DEG; dl = (b[0]-a[0])*DEG
        h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dl/2)**2
        return R*2*math.asin(math.sqrt(max(0.0, min(1.0, h))))
    def _brg(a, b):
        la1, la2 = a[1]*DEG, b[1]*DEG; dl = (b[0]-a[0])*DEG
        return math.atan2(math.sin(dl)*math.cos(la2),
                          math.cos(la1)*math.sin(la2)-math.sin(la1)*math.cos(la2)*math.cos(dl))
    def _worst(s):
        w = 0.0
        for i in range(1, len(s)-1):
            d = abs(_brg(s[i], s[i+1]) - _brg(s[i-1], s[i])); d = min(d, 2*math.pi-d)
            if d > w: w = d
        return w
    out = [list(p) for p in seg]
    i = 1
    while 1 <= i < len(out)-1:
        if _hav(out[i-1], out[i+1]) < spur_km and _hav(out[i-1], out[i]) >= dup_km:
            out.pop(i); i = max(1, i-1)
        else:
            i += 1
    j = 0
    while j < len(out)-1:
        if _hav(out[j], out[j+1]) < dup_km: out.pop(j+1)
        else: j += 1
    if len(out) == len(seg):
        return seg
    if _worst(out) > _worst(seg) + 0.5*DEG:   # guard: never worsen the worst turn
        return seg
    return out

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


def _term_tangent_point(rec, t):
    """At |kd|=1 both crossings collapse to one point on the unit circle."""
    X, _Xp, Y, _Yp, d_r, mu, dt_s, L1, _L2 = bstate(rec, t)
    D = math.sqrt(X*X + Y*Y)
    if D < 1e-18: return None
    kd = (D*D + 1.0 - L1*L1) / (2.0*D)
    kd = max(-1.0, min(1.0, kd))
    cx, cy = X/D, Y/D
    return _f2g_term(cx*kd, cy*kd, d_r, mu, dt_s)


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

    def _tip_densify(t_far, t_tan, n=24):
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

        # curve_a / curve_b from the trimmed run.
        curve_a, curve_b = [], []
        for (_ti, xi_a, eta_a, xi_b, eta_b, _X, _Y, d_r, mu, dt_s, _L1) in run:
            pa = _f2g_term(xi_a, eta_a, d_r, mu, dt_s)
            pb = _f2g_term(xi_b, eta_b, d_r, mu, dt_s)
            if pa: curve_a.append([pa[1], pa[0]])
            if pb: curve_b.append([pb[1], pb[0]])

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
    """Maximum-on-Horizon curve (Jubier's green line): the locus of ground
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
    by the same code, each reaching its true tips. Verified against Jubier's
    published curve to ~0.3 km median.

    Returns a flat list of [lon, lat]; separate components are delimited by a
    None sentinel so the renderer draws them as distinct polylines."""
    tmin = rec['tmin']; tmax = rec['tmax']

    def field(lat, lon):
        # (sun altitude deg at max eclipse, min axis distance) at this point.
        def adz(t):
            X, _, Y, _, d_r, mu, dt_s, L1, L2 = bstate(rec, t)
            xi, eta, zeta, rho1 = _geo_to_fund(lat, lon, d_r, mu, dt_s)
            if zeta is None: return 1e18, -1.0
            return math.hypot(xi - X, (eta - Y)/rho1), zeta
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
    MAX_KM   = 30.0    # match Jubier's sampling density (~30 km/sample)
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

    def umbra_pair(t):
        n, s = umbral_pts(rec, t)
        if n is None or s is None:
            lp1, lp2 = _umbral_limb_endpoints(rec, t)
            if lp1 and lp2:
                if n is None: n = lp1 if lp1[0] > lp2[0] else lp2
                if s is None: s = lp2 if lp1[0] > lp2[0] else lp1
        return n, s

    def find_first_valid(t_lo, t_hi, want_centreline=True):
        # Find the earliest t in [t_lo, t_hi] where the relevant function is
        # defined. Works for both centreline (None outside the eclipse) and
        # umbra limb (always defined for central eclipses, so this returns
        # t_lo immediately).
        scan = t_lo
        prev_ok = False
        while scan <= t_hi + 1e-9:
            if want_centreline:
                ok = centreline_pt(rec, scan) is not None
            else:
                n, s = umbra_pair(scan)
                ok = n is not None and s is not None
            if ok:
                if prev_ok or scan <= t_lo + 1e-9:
                    return scan
                # bisect between (scan - step, scan) for tangency precision
                t_out, t_in = scan - step, scan
                for _ in range(40):
                    tm = 0.5*(t_out + t_in)
                    if want_centreline:
                        valid = centreline_pt(rec, tm) is not None
                    else:
                        n, s = umbra_pair(tm)
                        valid = n is not None and s is not None
                    if valid: t_in = tm
                    else: t_out = tm
                    if t_in - t_out < 1e-7: break
                return t_in
            prev_ok = ok
            scan += step
        return None

    def find_last_valid(t_lo, t_hi, want_centreline=True):
        scan = t_hi
        while scan >= t_lo - 1e-9:
            if want_centreline:
                ok = centreline_pt(rec, scan) is not None
            else:
                n, s = umbra_pair(scan)
                ok = n is not None and s is not None
            if ok:
                # bisect between (scan, scan + step) for tangency
                t_in, t_out = scan, scan + step
                for _ in range(40):
                    tm = 0.5*(t_in + t_out)
                    if want_centreline:
                        valid = centreline_pt(rec, tm) is not None
                    else:
                        n, s = umbra_pair(tm)
                        valid = n is not None and s is not None
                    if valid: t_in = tm
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

    def adaptive_walk_pair(t_start, t_end, pair_sampler, k_max=MAX_KM, k_min=MIN_KM):
        # Like adaptive_walk but for a pair of curves (n, s) walked together.
        # pair_sampler(t) -> (n_pt, s_pt) or (None, None)
        # Step size tracks max(|Δn|, |Δs|) so that whichever curve has the
        # higher local velocity governs the sampling — important near cusps
        # where n and s move at radically different speeds.
        out = []
        n0, s0 = pair_sampler(t_start)
        if n0 is None or s0 is None: return out
        out.append((t_start, n0, s0))
        t_cur = t_start
        dt = DT_MAX
        iters = 0
        SAFETY = 100000
        while t_cur < t_end - 1e-9 and iters < SAFETY:
            iters += 1
            t_next = min(t_cur + dt, t_end)
            n_next, s_next = pair_sampler(t_next)
            if n_next is None or s_next is None:
                dt = max(DT_MIN, dt * 0.5)
                if dt <= DT_MIN + 1e-12: break
                continue
            d_n = gc_km(out[-1][1], n_next)
            d_s = gc_km(out[-1][2], s_next)
            d = max(d_n or 0, d_s or 0)
            if d > k_max and dt > DT_MIN + 1e-12:
                dt = max(DT_MIN, dt * 0.5)
                continue
            out.append((t_next, n_next, s_next))
            t_cur = t_next
            if d < k_min and dt < DT_MAX:
                dt = min(DT_MAX, dt * 2.0)
        return out

    cl, un, us = [], [], []
    if is_central:
        _GREEN = green_curve(rec)
        # True limit termini: where the magnitude=1 contour meets the green line
        # (alt=0). Found as the points where eclipse magnitude crosses 1.0 ALONG
        # the green line (well-conditioned — no cusp stall). _GREEN is a flat
        # list of [lon,lat] with None delimiters between components, so skip any
        # pair that spans a delimiter.
        _GREEN_TERMINI = []
        for _i in range(len(_GREEN) - 1):
            _g0, _g1 = _GREEN[_i], _GREEN[_i+1]
            if _g0 is None or _g1 is None: continue
            _m0 = _max_magnitude(rec, _g0[1], _g0[0])
            _m1 = _max_magnitude(rec, _g1[1], _g1[0])
            if (_m0 >= 1.0) != (_m1 >= 1.0):
                _a, _b = _g0, _g1; _s0 = _m0 >= 1.0
                for _ in range(22):
                    _m = ((_a[0]+_b[0])/2.0, (_a[1]+_b[1])/2.0)
                    if (_max_magnitude(rec, _m[1], _m[0]) >= 1.0) == _s0:
                        _a = _m
                    else:
                        _b = _m
                _GREEN_TERMINI.append([(_a[0]+_b[0])/2.0, (_a[1]+_b[1])/2.0])
        # Each curve has its own validity interval — they DIFFER, sometimes
        # by 5+ minutes near tangencies, which means the umbra walker must
        # bisect each side separately. Sharing the centreline interval was
        # the bug that produced asymmetric umbra termination (one limb
        # crawling past the other) on 1997, 2017, and many high-γ totals.
        t_cA = find_first_valid(tmin, tmax, want_centreline=True)
        t_cB = find_last_valid(tmin, tmax, want_centreline=True)

        def _max_sun_alt(lat, lon):
            # Sun altitude (deg) at this ground point at the instant of ITS OWN
            # maximum eclipse. >=0 => eclipse visible (sun up) at max. The locus
            # where ==0 is Jubier's "Maximum on Horizon" curve; he terminates
            # every limit and the centreline there (visible-totality).
            def adz(t):
                X, _, Y, _, d_r, mu, dt_s, L1, L2 = bstate(rec, t)
                xi, eta, zeta, rho1 = _geo_to_fund(lat, lon, d_r, mu, dt_s)
                if zeta is None: return 1e18, -1.0
                return math.hypot(xi - X, (eta - Y)/rho1), zeta
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
            # Maximum-on-Horizon (green) curve, Jubier's universal rule. No-op
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

        def _extend_to_green(walk, side):
            # Extend each undershooting limit end to its true terminus (a
            # _GREEN_TERMINI point: magnitude=1 ∩ alt=0). Coordinate order is
            # CRITICAL: _gc_bearing/_gc_dist take (lat,lon); walk points are
            # (t,lat,lon) and termini are [lon,lat], so build (lat,lon) tuples
            # explicitly. Match by trajectory: among termini AHEAD of the end
            # (aligned with its outward bearing) pick the one giving the
            # smallest seam turn — that continues the limit; the other end of a
            # tiny tip arc would invert it (bowtie). Only extend ends that
            # genuinely undershoot (sun still above horizon); ends already on the
            # green line (alt~0) are the terminus and are left alone.
            if len(walk) < 3 or not _GREEN_TERMINI: return walk
            out = list(walk)
            def angdiff(a, b):
                d = abs(math.degrees(a - b)) % 360.0
                return min(d, 360.0 - d)
            for end in (-1, 0):
                anchor = out[end]
                a_ll = (anchor[1], anchor[2])              # (lat, lon)
                if _max_sun_alt(anchor[1], anchor[2]) < 0.5:
                    continue                                # already at terminus
                nb = out[2] if end == 0 else out[-3]
                nb_ll = (nb[1], nb[2])                     # (lat, lon)
                out_brg = _gc_bearing(nb_ll, a_ll)         # outward direction
                imm = out[1] if end == 0 else out[-2]
                imm_ll = (imm[1], imm[2])                  # (lat, lon)
                imm_brg = _gc_bearing(imm_ll, a_ll)        # immediate heading
                best = None; bestscore = 1e18
                for term in _GREEN_TERMINI:
                    t_ll = (term[1], term[0])              # (lat, lon)
                    d = _gc_dist(a_ll, t_ll)
                    if d < 30000.0 or d > 2000000.0: continue
                    t_brg = _gc_bearing(a_ll, t_ll)
                    ang = angdiff(out_brg, t_brg)
                    if ang > 20.0: continue                # not ahead
                    seam = angdiff(imm_brg, t_brg)         # turn at the join
                    score = seam + 0.25*ang
                    if score < bestscore: bestscore = score; best = term
                if best is not None:
                    P = (anchor[0], best[1], best[0])      # (t, lat, lon)
                    if end == 0: out.insert(0, P)
                    else: out.append(P)
            return out

        # Per-side bisection for umbra n and s
        def _umbra_n_pt(t):
            n, s = umbral_pts(rec, t)
            return n
        def _umbra_s_pt(t):
            n, s = umbral_pts(rec, t)
            return s

        def find_first_for(fn):
            """Earliest t in [tmin, tmax] where fn(t) is not None,
            refined by 40-iter bisection."""
            scan = tmin
            step = STEP_MIN / 60.0
            prev_ok = False
            while scan <= tmax + 1e-9:
                ok = fn(scan) is not None
                if ok:
                    if prev_ok or scan <= tmin + 1e-9:
                        return scan
                    t_out, t_in = scan - step, scan
                    for _ in range(40):
                        tm = 0.5*(t_out + t_in)
                        if fn(tm) is not None: t_in = tm
                        else: t_out = tm
                        if t_in - t_out < 1e-7: break
                    return t_in
                prev_ok = ok
                scan += step
            return None

        def find_last_for(fn):
            scan = tmax
            step = STEP_MIN / 60.0
            while scan >= tmin - 1e-9:
                if fn(scan) is not None:
                    t_in, t_out = scan, scan + step
                    for _ in range(40):
                        tm = 0.5*(t_in + t_out)
                        if fn(tm) is not None: t_in = tm
                        else: t_out = tm
                        if t_out - t_in < 1e-7: break
                    return t_in
                scan -= step
            return None

        t_nA = find_first_for(_umbra_n_pt)
        t_nB = find_last_for(_umbra_n_pt)
        t_sA = find_first_for(_umbra_s_pt)
        t_sB = find_last_for(_umbra_s_pt)

        # Walk centreline over its own valid interval.
        if t_cA is not None and t_cB is not None and t_cB > t_cA + 1e-9:
            walk = _visible_trim(adaptive_walk(t_cA, t_cB, lambda t: centreline_pt(rec, t)))
        else:
            walk = []
        for (_, lat, lon) in walk:
            cl.append([round(lon, 5), round(lat, 5)])

        # Walk umbra n and s over their own intervals, independently.
        if t_nA is not None and t_nB is not None and t_nB > t_nA + 1e-9:
            n_walk = _extend_to_green(_visible_trim(adaptive_walk(t_nA, t_nB, _umbra_n_pt)), +1)
        else:
            n_walk = []
        for (_, lat, lon) in n_walk:
            un.append([round(lon, 5), round(lat, 5)])
        if t_sA is not None and t_sB is not None and t_sB > t_sA + 1e-9:
            s_walk = _extend_to_green(_visible_trim(adaptive_walk(t_sA, t_sB, _umbra_s_pt)), -1)
        else:
            s_walk = []
        for (_, lat, lon) in s_walk:
            us.append([round(lon, 5), round(lat, 5)])

        # ── Tip caps ────────────────────────────────────────────────────
        # The envelope limits truncate a little short of each grazing tip
        # (their perpendicular offset runs off the disk). Close each end by
        # tracing the umbral-limit zero contour from one side's truncated end
        # around the tip to the other side's end. This is a single C1 curve
        # (no envelope/terminator seam), so it joins both sides smoothly. The
        # trace is self-validating: if it fails to close or is not smooth, it
        # is discarded and that end simply stays truncated -- the proven
        # envelope is never harmed.
        # Tips are OPEN: each umbral limit ends at its true terminus on the
        # green (Maximum-on-Horizon) line via _extend_to_green; no cap bridges
        # the north and south limits. This matches Jubier's universal model
        # (verified across all test KMZs).
    else:
        # Partial / non-central eclipse: only the centreline is meaningful,
        # and even that only where the axis hits Earth. (Often empty.)
        t_cA = find_first_valid(tmin, tmax, want_centreline=True)
        t_cB = find_last_valid(tmin, tmax, want_centreline=True)
        if t_cA is not None and t_cB is not None and t_cB > t_cA + 1e-9:
            walk = adaptive_walk(t_cA, t_cB, lambda t: centreline_pt(rec, t))
            for (_, lat, lon) in walk:
                cl.append([round(lon, 5), round(lat, 5)])

    cl_segs = [cl] if cl else []
    un_segs = [un] if un else []
    us_segs = [us] if us else []

    # Unwrap all three curves so they are continuous past the antimeridian
    cl_segs = [unwrap(cl_segs[0])] if cl_segs else []
    un_segs = [unwrap(un_segs[0])] if un_segs else []
    us_segs = [unwrap(us_segs[0])] if us_segs else []

    # Remove degenerate spurs / duplicate vertices from the corridor limits
    # (lossless — only coincident-neighbour spurs; clean paths unchanged)
    un_segs = [_despur_segment(un_segs[0])] if un_segs else []
    us_segs = [_despur_segment(us_segs[0])] if us_segs else []

    # ── Penumbral limits ───────────────────────────────────────────────
    pn, ps, t_first, t_last = penumbral_limits(rec, step_min, pen_n)

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
        v1 = (b[0]-a[0], b[1]-a[1])
        v2 = (c[0]-b[0], c[1]-b[1])
        n1 = math.hypot(*v1); n2 = math.hypot(*v2)
        if n1 < 1e-9 or n2 < 1e-9: return 0.0
        cs = max(-1.0, min(1.0, (v1[0]*v2[0]+v1[1]*v2[1])/(n1*n2)))
        return math.degrees(math.acos(cs))
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

# Lat/lon precision in output JSON. 5 decimals ≈ 1 m at the equator;
# 4 decimals ≈ 11 m. 5 is well below cartographic relevance and roughly
# halves raw JSON size before gzip.
_COORD_DECIMALS = 5

def _round_coords(obj):
    """Recursively round any [lon, lat] pair (or list of them) in obj."""
    if isinstance(obj, list):
        if (len(obj) == 2 and all(isinstance(x, (int, float)) for x in obj)):
            return [round(obj[0], _COORD_DECIMALS),
                    round(obj[1], _COORD_DECIMALS)]
        return [_round_coords(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _round_coords(v) for k, v in obj.items()}
    return obj


def _round_path(path):
    """Round each field to its appropriate coordinate precision.

    High-accuracy curves (centreline, umbra) keep 5 dp (~1 m).
    Ovals keep 4 dp (~11 m).
    ge keeps 4 dp.
    Low-accuracy curves (penumbra) use 2 dp (~1 km) since
    they're already 20-100 km off — extra precision is wasted bytes.
    Terminators keep 4 dp.
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
        'penumbra_n':       2,
        'penumbra_s':       2,
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


def process_chunk(path, out_dir, step_min, pen_n):
    with open(path) as f: records=json.load(f)
    name=os.path.splitext(os.path.basename(path))[0]
    out_path=os.path.join(out_dir,f'paths_{name}.json.gz')
    paths={}
    print(f'  {name}: {len(records)} eclipses')
    n = len(records)
    for i, rec in enumerate(records):
        cat=rec.get('cat_no')
        key=str(int(float(cat))) if cat is not None else f"{rec['year']}_{rec['month']}_{rec['day']}"
        print(f"\r    {i+1}/{n}  {rec['year']}-{rec['month']:02d}-{rec['day']:02d}   ",
              end="", flush=True)
        paths[key]=_round_path(build_path(rec, step_min, pen_n))
    print(f"\r    {n}/{n}  done{' '*20}")
    raw_bytes = json.dumps(paths, separators=(',',':')).encode()
    with _gz.open(out_path, 'wb', compresslevel=9) as f:
        f.write(raw_bytes)
    on_disk = os.path.getsize(out_path)
    print(f'    {len(raw_bytes)//1024}KB raw  {on_disk//1024}KB gz  '
          f'{len(paths)} paths → {out_path}')


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
    args=p.parse_args()
    if args.test: run_tests(); return
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
    for c in chunks: process_chunk(c, args.out_dir, args.step, args.pen_n)
    print('Done.')


# ── Tests ──────────────────────────────────────────────────────────────────

def run_tests():
    cases=[
        ('2017 Aug 21 Total',{
            # NOTE: x0,y0,mu0 derived from Jubier KMZ GE coordinates.
            # The Five Millennium Canon has mu0≈163.8° which is wrong;
            # correct values below were back-solved from ge=(−87.664°,36.966°).
            "year":2017,"month":8,"day":21,"cat_no":9681,"eclipse_type":"T",
            "lat_dd_ge":36.96635,"lng_dd_ge":-87.66410,
            "dt":70.3,"tmin":-3.0,"tmax":3.0,
            "x0":-0.136480,"x1":0.5406427,"x2":1.15e-05,"x3":-8.87e-06,
            "y0":0.493227,"y1":-0.1463278,"y2":-0.0000970,"y3":2.28e-06,
            "d0":11.73621,"d1":-0.013293,"d2":-3e-06,
            "mu0":89.23713,"mu1":15.00402,"mu2":0.0,
            "l10":0.537050,"l11":0.0001254,"l12":-1.21e-05,
            "l20":-0.009928,"l21":0.0001251,"l22":-1.21e-05,
        }),
        ('1999 Aug 11 Total',{
            "year":1999,"month":8,"day":11,"cat_no":9506,"eclipse_type":"T",
            "lat_dd_ge":45.07591,"lng_dd_ge":24.29834,
            "dt":63.7,"tmin":-3.0,"tmax":3.0,
            "x0":0.070042,"x1":0.5443035,"x2":-4.06e-05,"x3":-8.06e-06,
            "y0":0.502841,"y1":-0.1184929,"y2":-0.0001158,"y3":1.69e-06,
            "d0":15.32734,"d1":-0.012035,"d2":-3e-06,
            "mu0":343.68741,"mu1":15.00298,"mu2":0.0,
            "l10":0.542469,"l11":0.0001168,"l12":-1.17e-05,
            "l20":-0.00365,"l21":0.0001163,"l22":-1.16e-05,
        }),
        ('1994 Nov 3 Total',{
            "year":1994,"month":11,"day":3,"cat_no":9496,"eclipse_type":"T",
            "lat_dd_ge":-35.35609,"lng_dd_ge":-34.22272,
            "dt":60.6,"tmin":-3.0,"tmax":3.0,
            "x0":0.11255,"x1":0.5687827,"x2":2.07e-05,"x3":-9.66e-06,
            "y0":-0.38557,"y1":-0.1257803,"y2":0.0001233,"y3":2.05e-06,
            "d0":-15.10091,"d1":-0.012686,"d2":3e-06,
            "mu0":34.10425,"mu1":15.00142,"mu2":0.0,
            "l10":0.536597,"l11":-3.14e-05,"l12":-1.3e-05,
            "l20":-0.009493,"l21":-3.12e-05,"l22":-1.3e-05,
        }),
    ]

    def flat(segs): return [p for s in segs for p in s]
    def max_jump(segs):
        w=0
        for seg in segs:
            for i in range(1,len(seg)):
                dlon=abs(seg[i][0]-seg[i-1][0])
                if dlon>180: dlon=360-dlon
                dlat=abs(seg[i][1]-seg[i-1][1])
                alat=(seg[i][1]+seg[i-1][1])/2*DEG
                d=R*math.sqrt((dlat*DEG)**2+(math.cos(alat)*dlon*DEG)**2)
                if d>w: w=d
        return w

    for label,rec in cases:
        path=build_path(rec)
        un_f=flat(path['umbra_n']); us_f=flat(path['umbra_s'])
        pn_f=flat(path['penumbra_n']); ps_f=flat(path['penumbra_s'])
        print(f'\n{label}:')
        ge=path['ge']
        print(f'  GE: {ge[0]:.4f}, {ge[1]:.4f}')
        print(f'  Centreline:  {sum(len(s) for s in path["centreline"])} pts '
              f' {len(path["centreline"])} segs')
        print(f'  Umbra N:     {len(un_f)} pts  {len(path["umbra_n"])} segs'
              f'  max_jump={max_jump(path["umbra_n"]):.0f}km')
        print(f'  Umbra S:     {len(us_f)} pts  {len(path["umbra_s"])} segs'
              f'  max_jump={max_jump(path["umbra_s"]):.0f}km')
        print(f'  Umbra ovals: {len(path.get("umbra_ovals",[]))} @ {OVAL_STEP_MIN}min')
        pn_lat = f'{min(p[1] for p in pn_f):.1f}° to {max(p[1] for p in pn_f):.1f}°' if pn_f else 'empty'
        ps_lat = f'{min(p[1] for p in ps_f):.1f}° to {max(p[1] for p in ps_f):.1f}°' if ps_f else 'empty'
        print(f'  Penumbra N:  {len(pn_f)} pts  {len(path["penumbra_n"])} segs  lat {pn_lat}')
        print(f'  Penumbra S:  {len(ps_f)} pts  {len(path["penumbra_s"])} segs  lat {ps_lat}')
        tf=flat(path['terminator_first']); tl=flat(path['terminator_last'])
        print(f'  Term first:  {len(tf)} pts  {len(path["terminator_first"])} segs')
        print(f'  Term last:   {len(tl)} pts  {len(path["terminator_last"])} segs')
        # Corridor width check
        if un_f and us_f:
            mid=len(un_f)//2
            n_pt=(un_f[mid][1],un_f[mid][0]); s_pt=None
            best=1e9
            for p in us_f:
                d=_sph(n_pt,(p[1],p[0]))
                if d<best: best=d; s_pt=(p[1],p[0])
            print(f'  Corridor width: {_km(n_pt,s_pt):.1f} km at midpoint')
        raw=json.dumps({str(path['cat_no']):path},separators=(',',':')).encode()
        print(f'  Size: {len(raw)//1024}KB raw  {len(_gz.compress(raw))//1024}KB gz')


if __name__=='__main__':
    import sys
    if '--test' in sys.argv: run_tests()
    else: main()


