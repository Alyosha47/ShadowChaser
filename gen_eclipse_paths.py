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
    python3 gen_eclipse_paths.py --data-dir ./data --out-dir ./data/paths
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


def _bisect_edge(rec, p0_lat, p0_lon, perp_bearing_rad, level,
                 search_m=300_000, iters=40):
    """Bisect along a great-circle perpendicular from p0 to find where
    max_magnitude crosses `level`. p0 must have max_magnitude > level.
    Returns (lat, lon) or None."""
    R_E = R_EARTH_M
    def at_dist(d):
        ang = d / R_E
        lat0 = p0_lat * DEG; lon0 = p0_lon * DEG
        sin_lat2 = math.sin(lat0)*math.cos(ang) + math.cos(lat0)*math.sin(ang)*math.cos(perp_bearing_rad)
        lat2 = math.asin(max(-1, min(1, sin_lat2)))
        lon2 = lon0 + math.atan2(math.sin(perp_bearing_rad)*math.sin(ang)*math.cos(lat0),
                                  math.cos(ang) - math.sin(lat0)*sin_lat2)
        return (lat2/DEG, ((lon2/DEG + 180) % 360) - 180)
    if _max_magnitude(rec, p0_lat, p0_lon) <= level:
        return None
    p_hi = at_dist(search_m)
    if _max_magnitude(rec, p_hi[0], p_hi[1]) >= level:
        return None
    d_lo, d_hi = 0.0, float(search_m)
    for _ in range(iters):
        d_mid = (d_lo + d_hi) / 2
        p_mid = at_dist(d_mid)
        if _max_magnitude(rec, p_mid[0], p_mid[1]) >= level:
            d_lo = d_mid
        else:
            d_hi = d_mid
    return at_dist((d_lo + d_hi) / 2)


def penumbral_pts(rec, t):
    """Penumbra north/south geographic limit points at time t.

    Same magnitude-based method as umbral_pts, but bisects out to the
    penumbra edge (magnitude = epsilon, just barely partial eclipse).
    Search range is much larger (~6000km half-width vs umbra's ~100km).
    """
    cl = centreline_pt(rec, t)
    if cl is None: return None, None
    cl_a = centreline_pt(rec, t - 0.0001)
    cl_b = centreline_pt(rec, t + 0.0001)
    if cl_a is None or cl_b is None: return None, None

    lat1 = cl_a[0]*DEG; lat2 = cl_b[0]*DEG
    dlon = (cl_b[1] - cl_a[1])*DEG
    bx = math.sin(dlon)*math.cos(lat2)
    by = math.cos(lat1)*math.sin(lat2) - math.sin(lat1)*math.cos(lat2)*math.cos(dlon)
    bearing = math.atan2(bx, by)
    perp_n = bearing - math.pi/2
    perp_s = bearing + math.pi/2

    # Wider time window for penumbra (slow-moving, large extent)
    t_lo = max(rec['tmin'], t - 0.5)
    t_hi = min(rec['tmax'], t + 0.5)
    N_T = 60
    bstates = []
    for i in range(N_T):
        ti = t_lo + (t_hi - t_lo) * i / (N_T - 1)
        bstates.append((ti, bstate(rec, ti)))

    LEVEL = 1e-9  # just barely positive magnitude = penumbra edge
    n = _bisect_edge_cached(rec, cl[0], cl[1], perp_n, LEVEL, bstates,
                             search_m=8_000_000, iters=30)
    s = _bisect_edge_cached(rec, cl[0], cl[1], perp_s, LEVEL, bstates,
                             search_m=8_000_000, iters=30)
    return n, s


def umbral_pts(rec, t):
    """Umbra north/south geographic limit points at time t.

    Method: walk along centreline at this t, find the perpendicular bearing
    to the centreline ground motion, then bisect along that perpendicular
    to find where the maximum eclipse magnitude (over all t in eclipse)
    equals 1.0 - epsilon. This is the proper boundary of the totality
    region — the locus of points that *just barely* see totality.

    Compared to the bessel-perp formula (which approximates the umbra
    boundary as perpendicular-to-velocity), this magnitude-based method
    handles polar grazers and edge geometry correctly and gives sub-200m
    accuracy where bessel-perp gave 1-3km.

    Optimization: precompute Bessel state (X, Y, d, mu, L1, L2, etc.) at a
    grid of t values within a tight window around `t`, then evaluate
    magnitude at many candidate (lat, lon) points using the cached state.
    A point near centreline at time t experiences max eclipse near time t,
    so a tight window suffices.
    """
    cl = centreline_pt(rec, t)
    if cl is None: return None, None
    cl_a = centreline_pt(rec, t - 0.0001)
    cl_b = centreline_pt(rec, t + 0.0001)
    if cl_a is None or cl_b is None: return None, None

    lat1 = cl_a[0]*DEG; lat2 = cl_b[0]*DEG
    dlon = (cl_b[1] - cl_a[1])*DEG
    bx = math.sin(dlon)*math.cos(lat2)
    by = math.cos(lat1)*math.sin(lat2) - math.sin(lat1)*math.cos(lat2)*math.cos(dlon)
    bearing = math.atan2(bx, by)
    perp_n = bearing - math.pi/2
    perp_s = bearing + math.pi/2

    # Precompute bstate at 25 t values within window
    t_lo = max(rec['tmin'], t - 0.02)
    t_hi = min(rec['tmax'], t + 0.02)
    N_T = 25
    bstates = []
    for i in range(N_T):
        ti = t_lo + (t_hi - t_lo) * i / (N_T - 1)
        bstates.append((ti, bstate(rec, ti)))

    LEVEL = 1.0 - 1e-9
    n = _bisect_edge_cached(rec, cl[0], cl[1], perp_n, LEVEL, bstates)
    s = _bisect_edge_cached(rec, cl[0], cl[1], perp_s, LEVEL, bstates)
    return n, s


def _max_magnitude_cached(rec, lat, lon, bstates):
    """Max magnitude using precomputed bstate values."""
    tan_f1 = rec['tan_f1']
    tan_f2 = rec['tan_f2']
    sqrt1mE2 = math.sqrt(1.0 - E2)
    lat_gd = lat * DEG
    tan_lat_gc = math.tan(lat_gd) * sqrt1mE2
    lat_gc = math.atan(tan_lat_gc)
    cos_lat_gc = math.cos(lat_gc)
    sin_lat_gc = math.sin(lat_gc)
    
    best_m = 0.0
    for ti, bs in bstates:
        X, _, Y, _, d_r, mu, dt_s, L1, L2 = bs
        cos_d = math.cos(d_r); sin_d = math.sin(d_r)
        rho1 = math.sqrt(1.0 - E2 * cos_d * cos_d)
        sin_d1 = sin_d / rho1
        cos_d1 = sqrt1mE2 * cos_d / rho1
        H_deg = (lon + mu - 0.00417807 * dt_s) % 360
        if H_deg > 180: H_deg -= 360
        H = H_deg * DEG
        cos_H = math.cos(H); sin_H = math.sin(H)
        zeta_p = sin_lat_gc * sin_d1 + cos_lat_gc * cos_H * cos_d1
        if zeta_p <= 0: continue
        xi_p = cos_lat_gc * sin_H
        eta_p = (sin_lat_gc * cos_d1 - cos_lat_gc * cos_H * sin_d1) * rho1
        dx = xi_p - X
        dy = (eta_p - Y) / rho1
        m_dist = math.sqrt(dx*dx + dy*dy)
        L1p = L1 - zeta_p * tan_f1
        L2p = L2 - zeta_p * tan_f2
        if m_dist >= L1p: continue
        if L2p < 0 and m_dist <= -L2p:
            return 1.0
        if L2p > 0 and m_dist <= L2p:
            return 1.0
        denom = L1p + L2p
        if abs(denom) < 1e-12: continue
        mag = (L1p - m_dist) / denom
        if mag > best_m: best_m = mag
        if best_m >= 1.0: return 1.0
    return best_m


def _bisect_edge_cached(rec, p0_lat, p0_lon, perp_bearing_rad, level, bstates,
                         search_m=300_000, iters=22):
    """Bisect along perpendicular using cached bstate values."""
    R_E = R_EARTH_M
    cos_b = math.cos(perp_bearing_rad)
    sin_b = math.sin(perp_bearing_rad)
    lat0 = p0_lat * DEG; lon0 = p0_lon * DEG
    sin_lat0 = math.sin(lat0); cos_lat0 = math.cos(lat0)
    def at_dist(d):
        ang = d / R_E
        sin_ang = math.sin(ang); cos_ang = math.cos(ang)
        sin_lat2 = sin_lat0 * cos_ang + cos_lat0 * sin_ang * cos_b
        lat2 = math.asin(max(-1, min(1, sin_lat2)))
        lon2 = lon0 + math.atan2(sin_b * sin_ang * cos_lat0,
                                  cos_ang - sin_lat0 * sin_lat2)
        return (lat2/DEG, ((lon2/DEG + 180) % 360) - 180)
    if _max_magnitude_cached(rec, p0_lat, p0_lon, bstates) <= level:
        return None
    p_hi = at_dist(search_m)
    if _max_magnitude_cached(rec, p_hi[0], p_hi[1], bstates) >= level:
        return None
    d_lo, d_hi = 0.0, float(search_m)
    for _ in range(iters):
        d_mid = (d_lo + d_hi) / 2
        p_mid = at_dist(d_mid)
        if _max_magnitude_cached(rec, p_mid[0], p_mid[1], bstates) >= level:
            d_lo = d_mid
        else:
            d_hi = d_mid
    return at_dist((d_lo + d_hi) / 2)


# ── Umbral limb-crossing endpoints (horn tips) ────────────────────────────

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


def _umbral_tip_time(rec, entry=True):
    """Binary-search the time when the umbral shadow first/last touches Earth."""
    step = 1/60.0
    times = []
    t = rec['tmin']
    while t <= rec['tmax']+1e-9:
        times.append(t); t += step
    last_on = None
    for ti in times:
        if centreline_pt(rec, ti) is not None:
            last_on = ti
            if entry: break
    if last_on is None: return None
    if entry: t_in, t_out = last_on, last_on - step
    else: t_in, t_out = last_on, last_on + step
    for _ in range(40):
        tm = (t_out+t_in)/2.0
        if centreline_pt(rec, tm) is not None: t_in = tm
        else: t_out = tm
        if abs(t_in-t_out) < 1e-5: break
    return (t_out+t_in)/2.0


# ── Penumbra arc helpers ───────────────────────────────────────────────────

def pen_arc(rec, t, N=PEN_N):
    """Visible arc of penumbral (L1) circle at time t. Returns [] if off Earth."""
    X, _, Y, _, d_r, mu, dt_s, L1, _ = bstate(rec, t)
    vis = []
    for i in range(N):
        q = 2.0*math.pi*i/N
        pt = f2g(X+L1*math.sin(q), Y+L1*math.cos(q), d_r, mu, dt_s)
        if pt: vis.append((i, pt[0], pt[1]))
    if not vis: return []
    idx = [v[0] for v in vis]
    max_gap=0; gap_after=0
    for i in range(len(idx)):
        gap=(idx[(i+1)%len(idx)]-idx[i])%N
        if gap>max_gap: max_gap=gap; gap_after=i
    start=(gap_after+1)%len(vis)
    ordered=vis[start:]+vis[:start]
    return [(v[1],v[2]) for v in ordered]


def _pen_contact_times(rec, step_min=STEP_MIN):
    """Binary-search exact first and last times penumbra touches Earth."""
    step = step_min/60.0
    times=[]; t=rec['tmin']
    while t<=rec['tmax']+1e-9: times.append(t); t+=step
    first_i=last_i=None
    for i,ti in enumerate(times):
        if pen_arc(rec,ti):
            if first_i is None: first_i=i
            last_i=i
    if first_i is None: return None,None
    def _bisect(t_out,t_in):
        for _ in range(30):
            tm=(t_out+t_in)/2.0
            if pen_arc(rec,tm): t_in=tm
            else: t_out=tm
            if abs(t_in-t_out)<1e-4: break
        return t_in
    t_first=_bisect(times[first_i-1] if first_i>0 else rec['tmin']-step, times[first_i])
    t_last =_bisect(times[last_i+1] if last_i<len(times)-1 else rec['tmax']+step, times[last_i])
    return t_first, t_last


# ── Penumbral limits (geographic envelope) ────────────────────────────────

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


def _bisect_pen_side(rec, t_out, t_in, side, want_on):
    for _ in range(40):
        tm = (t_out+t_in)/2.0
        pt = _pen_perp_pt(rec, tm, side)
        if (pt is not None) == want_on: t_in = tm
        else: t_out = tm
        if abs(t_in-t_out) < 1e-5: break
    return t_in


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

def _gdist(a, b):
    dlon=(b[0]-a[0])*DEG; dlat=(b[1]-a[1])*DEG
    alat=(a[1]+b[1])/2*DEG
    return R*math.sqrt(dlat**2+(math.cos(alat)*dlon)**2)

def split_path(pts, max_gap=500, min_seg=MIN_SEG):
    """Split [lon,lat] list at antimeridian crossings and large gaps.
    Antimeridian crossings always split regardless of min_seg."""
    if not pts: return []
    segs, cur = [], [pts[0]]
    for i in range(1,len(pts)):
        p,q=pts[i-1],pts[i]
        antimeridian = abs(q[0]-p[0]) > 180.0
        if antimeridian or _gdist(p,q)>max_gap:
            if len(cur)>=min_seg or antimeridian: segs.append(cur)
            cur=[q]
        else: cur.append(q)
    if len(cur)>=min_seg: segs.append(cur)
    return segs

def split_lon(pts, min_seg=5):
    """Split [lon,lat] list only at antimeridian crossings."""
    if not pts: return []
    segs, cur = [], [pts[0]]
    for i in range(1,len(pts)):
        p,q=pts[i-1],pts[i]
        if abs(q[0]-p[0])>180.0:
            if len(cur)>=min_seg: segs.append(cur)
            cur=[q]
        else: cur.append(q)
    if len(cur)>=min_seg: segs.append(cur)
    return segs


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
    """
    R_E = R_EARTH_M
    lat0 = p_lat * DEG; lon0 = p_lon * DEG
    cos_lat0 = math.cos(lat0); sin_lat0 = math.sin(lat0)
    cos_b = math.cos(bearing_rad); sin_b = math.sin(bearing_rad)

    def at_dist(d):
        ang = d / R_E
        sin_lat2 = sin_lat0*math.cos(ang) + cos_lat0*math.sin(ang)*cos_b
        sin_lat2 = max(-1.0, min(1.0, sin_lat2))
        lat2 = math.asin(sin_lat2)
        lon2 = lon0 + math.atan2(sin_b*math.sin(ang)*cos_lat0,
                                  math.cos(ang) - sin_lat0*sin_lat2)
        return (lat2/DEG, ((lon2/DEG + 180) % 360) - 180)

    # Confirm starting point is inside (mag == 1.0)
    if _magnitude_at(rec, p_lat, p_lon, t) < 1.0 - 1e-9:
        return None

    # Probe outward to find a point outside
    lo = 0.0
    hi = search_m
    if _magnitude_at(rec, *at_dist(hi), t) >= 1.0 - 1e-9:
        return None  # umbra extends past search distance — caller will skip

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

        ring = []
        bad = False
        for i in range(N):
            bearing = 2.0 * math.pi * i / N
            edge = _bisect_umbra_at_t(rec, cl_lat, cl_lon, bearing, t)
            if edge is None:
                bad = True; break
            ring.append([round(edge[1], 4), round(edge[0], 4)])
        if not bad and len(ring) >= 3:
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




def _bisector_curves(rec, t_first, t_last, step_min=TERM_STEP_MIN,
                     term_first=None, term_last=None):
    """Maximum-eclipse-on-horizon curves.

    For each time t, the smaller-|s| root of the perpendicular-to-shadow
    line intersection with the unit circle gives the geographically valid
    bisector point. For two-blob eclipses (both term_first and term_last
    present), the raw sweep is split at its polar peak and each half is
    bounded to its lemniscate's bbox.

    Note: the bisector starts at ~lat 1.5° for blob-1 of some eclipses
    (e.g. 1998). The extension to the blob's southern cusp (-33°) runs
    through the terminator lemniscate and is handled by the UI when
    assembling the penumbra polygon.

    Returns list of segments (one per blob).
    """
    if t_first is None or t_last is None:
        return []

    step = step_min / 60.0

    def _bbox(segs):
        if not segs: return None
        lats = [p[1] for s in segs for p in s]
        lons = [((p[0]+180)%360)-180 for s in segs for p in s]
        return min(lats)-0.5, max(lats)+0.5, min(lons)-0.5, max(lons)+0.5

    def _in_bbox(pt, bb):
        if not bb: return True
        return bb[0] <= pt[1] <= bb[1] and bb[2] <= ((pt[0]+180)%360)-180 <= bb[3]

    def _sweep(t_lo, t_hi, bb=None):
        pts = []
        t = t_lo
        while t <= t_hi + 1e-9:
            X,Xp,Y,Yp,d_r,mu,dt_s,_,_ = bstate(rec, t)
            a = Xp*Xp + Yp*Yp
            if a < 1e-18: t += step; continue
            b = 2.0*(Y*Xp - X*Yp); c = X*X + Y*Y - 1.0
            disc = b*b - 4.0*a*c
            sq = math.sqrt(max(0.0, disc))
            sp = (-b+sq)/(2*a); sm = (-b-sq)/(2*a)
            s = sp if abs(sp) <= abs(sm) else sm
            xi = X - s*Yp; eta = Y + s*Xp
            pt = _f2g_term(xi, eta, d_r, mu, dt_s)
            if pt:
                e = [round(pt[1], 4), round(pt[0], 4)]
                if _in_bbox(e, bb):
                    pts.append(e)
            t += step
        return pts

    is_two_blob = bool(term_first) and bool(term_last)

    if is_two_blob:
        raw = _sweep(t_first, t_last)
        if not raw: return []
        peak_i = max(range(len(raw)), key=lambda i: raw[i][1])
        mid_split = 0.1 * len(raw) < peak_i < 0.9 * len(raw)
        bb_f = _bbox(term_first); bb_l = _bbox(term_last)
        t_split = t_first + peak_i * step
        if mid_split:
            s0 = _sweep(t_first, t_split, bb_f)
            s1 = _sweep(t_split+step, t_last, bb_l)
        else:
            full = _sweep(t_first, t_last)
            s0 = [p for p in full if _in_bbox(p, bb_f)]
            s1 = [p for p in full if _in_bbox(p, bb_l)]
        return [s for s in [s0, s1] if len(s) >= 2]
    else:
        return [_sweep(t_first, t_last)]


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
            # Accept
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
        # Each curve has its own validity interval — they DIFFER, sometimes
        # by 5+ minutes near tangencies, which means the umbra walker must
        # bisect each side separately. Sharing the centreline interval was
        # the bug that produced asymmetric umbra termination (one limb
        # crawling past the other) on 1997, 2017, and many high-γ totals.
        t_cA = find_first_valid(tmin, tmax, want_centreline=True)
        t_cB = find_last_valid(tmin, tmax, want_centreline=True)

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
            walk = adaptive_walk(t_cA, t_cB, lambda t: centreline_pt(rec, t))
        else:
            walk = []
        for (_, lat, lon) in walk:
            cl.append([round(lon, 5), round(lat, 5)])

        # Walk umbra n and s over their own intervals, independently.
        if t_nA is not None and t_nB is not None and t_nB > t_nA + 1e-9:
            n_walk = adaptive_walk(t_nA, t_nB, _umbra_n_pt)
        else:
            n_walk = []
        for (_, lat, lon) in n_walk:
            un.append([round(lon, 5), round(lat, 5)])
        if t_sA is not None and t_sB is not None and t_sB > t_sA + 1e-9:
            s_walk = adaptive_walk(t_sA, t_sB, _umbra_s_pt)
        else:
            s_walk = []
        for (_, lat, lon) in s_walk:
            us.append([round(lon, 5), round(lat, 5)])
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

    # ── Penumbral limits ───────────────────────────────────────────────
    pn, ps, t_first, t_last = penumbral_limits(rec, step_min, pen_n)

    # ── Terminators: sunrise/sunset boundary loops of penumbral shadow ──
    if t_first is not None and t_last is not None:
        term_first, term_last = _terminator_curves(rec, t_first, t_last, TERM_STEP_MIN)
        bisector = _bisector_curves(rec, t_first, t_last, TERM_STEP_MIN,
                                     term_first, term_last)
    else:
        term_first = term_last = []
        bisector = []

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
        'bisector':         bisector,
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
    for fld in ('penumbra_n', 'penumbra_s', 'terminator_first', 'terminator_last', 'bisector'):
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
    Low-accuracy curves (penumbra, bisectors) use 2 dp (~1 km) since
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
        'bisector':         2,
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
        if k in PREC and isinstance(v, list):
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
    for rec in records:
        cat=rec.get('cat_no')
        key=str(int(float(cat))) if cat is not None else f"{rec['year']}_{rec['month']}_{rec['day']}"
        paths[key]=_round_path(build_path(rec, step_min, pen_n))
    raw_bytes = json.dumps(paths, separators=(',',':')).encode()
    with _gz.open(out_path, 'wb', compresslevel=9) as f:
        f.write(raw_bytes)
    on_disk = os.path.getsize(out_path)
    print(f'    {len(raw_bytes)//1024}KB raw  {on_disk//1024}KB gz  '
          f'{len(paths)} paths → {out_path}')


# ── CLI ────────────────────────────────────────────────────────────────────

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--data-dir',default='./data')
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


