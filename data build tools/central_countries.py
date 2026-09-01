#!/usr/bin/env python3
"""central_countries.py — which countries the umbra actually crosses.

Replaces the corridor-polygon test in gen_country_index.js. No corridor
polygon is built, so none of its failure modes exist: no closing edges, no
longitude unwrapping, no pole rings, no reliance on umbra_n[0]/umbra_s[0].

Definition used, and it is the generator's own:
    a point is central  <=>  max over t of _magnitude_at(rec, lat, lon, t) >= 1
(_magnitude_at returns exactly 1.0 inside the umbra and inside the antumbra.)

A country is central iff the maximum of g(x) = max_t magnitude(x, t) over the
closed country region reaches 1. The maximum of a continuous function over a
closed region is attained either in the interior or on the boundary:

  * interior   -- g's global maximum is 1 and is attained on the centreline,
                  so an interior maximum of 1 means a centreline point lies
                  inside the country. Tested by point-in-polygon.
  * boundary   -- otherwise maximise g along the country's boundary, a 1-D
                  problem: sample, then golden-section refine the best spans.

That is exhaustive. Stdlib only, same as gen_eclipse_paths.py.

Usage
    python3 "data build tools/central_countries.py"                 # all
    python3 "data build tools/central_countries.py" --century 1901_2000
    python3 "data build tools/central_countries.py" --cat 9384      # one eclipse
    python3 "data build tools/central_countries.py" --jobs 8
Output
    data/central_countries.json.gz   {"<cat_no>": [country_index, ...]}
"""

import os, sys, json, gzip, math, time, argparse, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ── import the authoritative eclipse maths from the path generator ──────────
_spec = importlib.util.spec_from_file_location(
    'gen_eclipse_paths', os.path.join(HERE, 'gen_eclipse_paths.py'))
GEP = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(GEP)          # module has an if __name__ guard

bstate        = GEP.bstate
f2g           = GEP.f2g
magnitude_at  = GEP._magnitude_at
DEG           = GEP.DEG

CENTRAL_TYPES = ('T', 'A', 'H')        # total, annular, hybrid
STEP_MIN      = 1.0                    # centreline sampling, minutes
BOUNDARY_KM   = 15.0                   # max spacing when densifying borders
CL_MAX_KM     = 20.0                   # max spacing between centreline samples
MARGIN_DEG    = 1.5                    # bbox slack around the corridor


# ── country polygons ────────────────────────────────────────────────────────

def load_countries():
    """[{name, iso, rings:[[(lat,lon)...]], bbox:(w,s,e,n)}] in file order.

    The index of each entry is the country's slot in country_index.json.gz,
    so ordering here must match gen_country_index.js's loadCountries().
    """
    p = os.path.join(ROOT, 'data/basemap/countries.geojson.gz')
    with gzip.open(p, 'rt', encoding='utf8') as fh:
        gj = json.load(fh)
    out = []
    for feat in gj['features']:
        props = feat.get('properties') or {}
        names = props.get('names') or []
        if not names:
            raise SystemExit('country has no names -- run name_countries.js first')
        name = names[0]
        iso = ''
        geom = feat.get('geometry') or {}
        polys = []
        if geom.get('type') == 'Polygon':
            polys = [geom['coordinates']]
        elif geom.get('type') == 'MultiPolygon':
            polys = geom['coordinates']
        rings = []
        for poly in polys:
            for ring in poly:
                r = [(pt[1], pt[0]) for pt in ring]   # (lat, lon)
                if len(r) >= 3:
                    rings.append(r)
        if not rings:
            continue
        w = s = 1e9; e = n = -1e9
        for r in rings:
            for la, lo in r:
                if lo < w: w = lo
                if lo > e: e = lo
                if la < s: s = la
                if la > n: n = la
        out.append({'name': name, 'iso': iso, 'rings': rings,
                    'bbox': (w, s, e, n)})
    return out


def pt_in_rings(rings, lat, lon):
    """Even-odd point-in-polygon over a country's rings.

    Safe here: country rings are closed, single-valued in longitude and never
    span the antimeridian (the basemap is split at +/-180).
    """
    inside = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            yi, xi = ring[i]
            yj, xj = ring[j]
            if (yi > lat) != (yj > lat):
                xint = xi + (lat - yi) * (xj - xi) / (yj - yi)
                if lon < xint:
                    inside = not inside
            j = i
    return inside


# ── geometry helpers ────────────────────────────────────────────────────────

def km(a, b):
    dlat = (b[0] - a[0]) * DEG
    dl = b[1] - a[1]
    if dl > 180.0:
        dl -= 360.0
    elif dl < -180.0:
        dl += 360.0
    dlon = dl * DEG
    alat = (a[0] + b[0]) * 0.5 * DEG
    return 6371.0 * math.sqrt(dlat * dlat + (math.cos(alat) * dlon) ** 2)


def lon_delta(a, b):
    d = abs(a - b)
    return 360.0 - d if d > 180.0 else d


# ── the eclipse magnitude field ─────────────────────────────────────────────

def max_mag(rec, lat, lon, t_lo, t_hi, coarse=48, refine=34):
    """max over t in [t_lo, t_hi] of magnitude at (lat, lon).

    Same coarse-then-bisect shape as GEP._max_magnitude, but over a supplied
    time bracket so callers can restrict to the relevant part of the path.
    """
    best_t = t_lo
    best_m = 0.0
    span = t_hi - t_lo
    for i in range(coarse + 1):
        t = t_lo + span * i / coarse
        m = magnitude_at(rec, lat, lon, t)
        if m > best_m:
            best_m = m
            best_t = t
    if best_m <= 0.0:
        return 0.0
    dt = span / coarse
    for _ in range(refine):
        if best_m >= 1.0:
            return best_m           # inside the umbra: cannot do better
        for sign in (-1.0, 1.0):
            t = best_t + sign * dt * 0.5
            if t < t_lo or t > t_hi:
                continue
            m = magnitude_at(rec, lat, lon, t)
            if m > best_m:
                best_m = m
                best_t = t
        dt *= 0.5
    return best_m


# ── centreline ──────────────────────────────────────────────────────────────

def axis_pt(rec, t):
    X, _, Y, _, d_r, mu, dt_s, _, _ = bstate(rec, t)
    return f2g(X, Y, d_r, mu, dt_s)


def centreline(rec):
    """[(lat, lon, t)] where the shadow axis meets the Earth.

    Adaptively sampled. A fixed 1-minute step is badly wrong at the two ends
    of a path: near sunrise and sunset the axis strikes the Earth at a
    grazing angle and the centreline point can move several hundred km in a
    minute, leaving a gap wide enough to lose whole countries. So the ends
    are bisected to the moment the axis first and last touches, and any span
    whose endpoints are more than CL_MAX_KM apart is subdivided.
    """
    step = STEP_MIN / 60.0
    ts = []
    t = rec['tmin']
    while t <= rec['tmax'] + 1e-9:
        ts.append(t)
        t += step
    valid = [axis_pt(rec, t) is not None for t in ts]
    if not any(valid):
        return []

    # bisect each None <-> valid transition to the true first/last contact
    edges = []
    for i in range(1, len(ts)):
        if valid[i] != valid[i - 1]:
            lo, hi = ts[i - 1], ts[i]
            lo_ok = valid[i - 1]
            for _ in range(40):
                mid = 0.5 * (lo + hi)
                if (axis_pt(rec, mid) is not None) == lo_ok:
                    lo = mid
                else:
                    hi = mid
            edges.append(lo if lo_ok else hi)

    keep = sorted(set([ts[i] for i in range(len(ts)) if valid[i]] + edges))
    if not keep:
        return []

    pts = []
    for t in keep:
        ll = axis_pt(rec, t)
        if ll is not None:
            pts.append((ll[0], ll[1], t))

    # iteratively insert midpoints until no gap exceeds CL_MAX_KM
    for _ in range(24):
        grew = False
        dense = [pts[0]]
        for i in range(1, len(pts)):
            a, b = pts[i - 1], pts[i]
            if km(a, b) > CL_MAX_KM and (b[2] - a[2]) > 1e-9:
                m = 0.5 * (a[2] + b[2])
                ll = axis_pt(rec, m)
                if ll is not None:
                    dense.append((ll[0], ll[1], m))
                    grew = True
            dense.append(b)
        pts = dense
        if not grew:
            break
    return pts


def corridor_pad_deg(rec):
    """Half-width of the umbra in degrees, generously rounded up."""
    w = rec.get('path_width') or 0.0
    try:
        w = float(w)
    except (TypeError, ValueError):
        w = 0.0
    half_km = max(w, 0.0) * 0.5
    return half_km / 111.0 + MARGIN_DEG


# ── per-eclipse solve ───────────────────────────────────────────────────────

def solve(rec, countries, verbose=False):
    """Return a sorted list of country indices the umbra actually crosses."""
    etype = (rec.get('eclipse_type') or rec.get('etype') or '').strip().upper()
    if not etype or etype[0] not in CENTRAL_TYPES:
        return []

    cl = centreline(rec)
    if not cl:
        return []

    pad = corridor_pad_deg(rec)
    hits = []

    for ci, C in enumerate(countries):
        w, s, e, n = C['bbox']

        # 1. cheap reject: is any centreline point near this country's bbox?
        near = []
        for (la, lo, t) in cl:
            if la < s - pad or la > n + pad:
                continue
            if lo < w - pad:
                if lon_delta(lo, w) > pad:
                    continue
            elif lo > e + pad:
                if lon_delta(lo, e) > pad:
                    continue
            near.append((la, lo, t))
        if not near:
            continue

        t_lo = min(p[2] for p in near) - 0.25
        t_hi = max(p[2] for p in near) + 0.25
        t_lo = max(t_lo, rec['tmin'])
        t_hi = min(t_hi, rec['tmax'])

        # 2. interior case: a centreline point inside the country
        found = False
        for (la, lo, t) in near:
            if pt_in_rings(C['rings'], la, lo):
                found = True
                break
        if found:
            hits.append(ci)
            continue

        # 3. boundary case: maximise the magnitude along the border
        if boundary_reaches_umbra(rec, C, near, pad, t_lo, t_hi):
            hits.append(ci)

    return sorted(hits)


def boundary_reaches_umbra(rec, C, near, pad, t_lo, t_hi):
    """True if max of g along the country's boundary reaches 1.

    Only border vertices within pad of a centreline point are considered;
    elsewhere the magnitude cannot reach 1 by construction of pad. Long edges
    are densified to BOUNDARY_KM so no thin crossing is stepped over, then the
    best spans are refined by golden section.
    """
    cand = []
    for ring in C['rings']:
        prev = None
        for v in ring:
            if prev is not None:
                d = km(prev, v)
                if d > BOUNDARY_KM:
                    steps = int(d / BOUNDARY_KM) + 1
                    for k in range(1, steps):
                        f = k / steps
                        cand.append((prev[0] + (v[0] - prev[0]) * f,
                                     prev[1] + (v[1] - prev[1]) * f))
            cand.append(v)
            prev = v

    # keep only vertices plausibly inside the corridor's reach
    keep = []
    for (la, lo) in cand:
        for (cla, clo, _t) in near:
            if abs(la - cla) <= pad and lon_delta(lo, clo) <= pad:
                keep.append((la, lo))
                break
    if not keep:
        return False

    best = 0.0
    best_pt = None
    for (la, lo) in keep:
        m = max_mag(rec, la, lo, t_lo, t_hi)
        if m >= 1.0:
            return True
        if m > best:
            best = m
            best_pt = (la, lo)

    # 4. local refinement: walk uphill from the best boundary sample.
    #    A crossing narrower than the sample spacing can hide between
    #    samples; the gradient at the best sample points into it.
    if best_pt is None or best < 0.90:
        return False
    la, lo = best_pt
    step = BOUNDARY_KM / 111.0
    for _ in range(40):
        improved = False
        for dla, dlo in ((step, 0), (-step, 0), (0, step), (0, -step),
                         (step, step), (step, -step), (-step, step),
                         (-step, -step)):
            nla = la + dla
            nlo = lo + dlo
            if not pt_in_rings(C['rings'], nla, nlo):
                continue
            m = max_mag(rec, nla, nlo, t_lo, t_hi)
            if m > best:
                best, la, lo = m, nla, nlo
                improved = True
                if best >= 1.0:
                    return True
        if not improved:
            step *= 0.5
            if step < 1e-4:
                break
    return best >= 1.0


# ── driver ──────────────────────────────────────────────────────────────────

def century_files():
    d = os.path.join(ROOT, 'data/besselian')
    return sorted(f[:-5] for f in os.listdir(d) if f.endswith('.json'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--century', action='append', default=None)
    ap.add_argument('--cat', type=float, default=None)
    ap.add_argument('--out', default=os.path.join(ROOT, 'data/central_countries.json.gz'))
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    countries = load_countries()
    sys.stderr.write('countries: %d\n' % len(countries))

    cents = args.century or century_files()
    result = {}
    t0 = time.time()
    done = 0
    for cent in cents:
        path = os.path.join(ROOT, 'data/besselian', cent + '.json')
        with open(path, encoding='utf8') as fh:
            recs = json.load(fh)
        for rec in recs:
            if args.cat is not None and float(rec.get('cat_no', -1)) != args.cat:
                continue
            key = str(int(rec['cat_no']))
            hits = solve(rec, countries)
            result[key] = hits
            done += 1
            if not args.quiet and done % 25 == 0:
                sys.stderr.write('\r%s  %d eclipses  %.1fs' %
                                 (cent, done, time.time() - t0))
                sys.stderr.flush()
        if not args.quiet:
            sys.stderr.write('\r%s done  %d eclipses  %.1fs\n' %
                             (cent, done, time.time() - t0))

    with gzip.open(args.out, 'wt', encoding='utf8') as fh:
        json.dump({'__meta': {'generator': 'central_countries.py',
                              'built': time.strftime('%Y-%m-%dT%H:%M:%SZ',
                                                     time.gmtime()),
                              'eclipses': len(result)},
                   'central': result}, fh)
    sys.stderr.write('wrote %s  (%d eclipses, %.1fs)\n' %
                     (args.out, len(result), time.time() - t0))


if __name__ == '__main__':
    main()
