#!/usr/bin/env python3
"""obscuration_countries.py — peak eclipse obscuration in every country.

Companion to central_countries.py. That script answers the yes/no question
(did the umbra cross this country). This one answers the how-much question,
and it replaces the 3-degree grid sample in gen_country_index.js, which takes
the best of a scattering of nodes and can miss the true peak by a long way.

Method. Obscuration falls off monotonically with distance from the shadow
axis, so the highest obscuration in a country is at whichever of its points
comes closest to the axis track. That point is found geometrically, then a
local climb walks to the true peak. No grid, no floor on the search itself.

The obscuration formula is transcribed from js/eclipse.js so the table and the
app agree to the last decimal:

    total    -> 100
    annular  -> (r_moon / r_sun)^2 * 100
    partial  -> lens area of two unequal circles / area of the Sun's disk

Output values are obscuration/5 rounded, range 4..20 (20 = 100%), matching
the existing table's encoding. The sign is NOT set here -- run
central_countries.py for that, then apply_central.py.

Usage
    python3 "data build tools/obscuration_countries.py" --benchmark
    python3 "data build tools/obscuration_countries.py" "--century=1901_2000" \\
            "--out=data/.obsc_parts/1901_2000.json.gz"
    python3 "data build tools/obscuration_countries.py" --all --parts data/.obsc_parts
    python3 "data build tools/obscuration_countries.py" --merge data/.obsc_parts \\
            "--out=data/obscuration_countries.json.gz"

--all is resumable: a century whose part file already exists is skipped, so a
killed run costs one century rather than the whole build.
"""

import os, sys, json, gzip, math, time, argparse, importlib.util
import multiprocessing

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = importlib.util.spec_from_file_location(
    'central_countries', os.path.join(HERE, 'central_countries.py'))
CC = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(CC)

GEP = CC.GEP
bstate = CC.bstate
geo_to_fund = GEP._geo_to_fund
DEG = CC.DEG
km = CC.km

BUCKET = 5        # same encoding as gen_country_index.js
FLOOR = 20        # percent; below this the entry is dropped entirely
T_PAD = 0.5       # hours either side of a known peak time to re-search
COARSE = 3.0      # degrees, the grid gen_country_index.js used
COARSE_CAP = 400  # widen the grid rather than exceed this many nodes
REACH_KM = 8000.0 # a country further than this from the track cannot reach 20%


# ── obscuration at a point and instant, transcribed from js/eclipse.js ──────

def js_round(x):
    """Round half AWAY from zero, the way JavaScript's Math.round does.

    Python's round() is banker's rounding: round(4.5) is 4, not 5. The app
    buckets with Math.round, so using Python's default put every exact half
    bucket one step below what the app expects -- a country at 22.5% obscured
    landed in bucket 4 here and bucket 5 there.
    """
    return int(math.floor(x + 0.5)) if x >= 0 else -int(math.floor(-x + 0.5))


def osc_at(rec, lat, lon, t):
    X, _, Y, _, d_r, mu, dt_s, L1, L2 = bstate(rec, t)
    xi, eta, zeta, rho1 = geo_to_fund(lat, lon, d_r, mu, dt_s)
    if zeta <= 0:
        return 0.0                       # Sun below the horizon
    dx = xi - X
    dy = (eta - Y) / rho1
    m = math.sqrt(dx * dx + dy * dy)
    L1p = L1 - zeta * rec['tan_f1']
    L2p = L2 - zeta * rec['tan_f2']
    if m >= L1p:
        return 0.0                       # outside the penumbra
    r_sun = (L1p + L2p) / 2.0
    r_moon = (L1p - L2p) / 2.0
    if r_sun <= 0:
        return 0.0
    if L2p < 0 and m <= -L2p:
        return 100.0                     # total
    if L2p > 0 and m <= L2p:
        k = r_moon / r_sun               # annular
        return js_round(k * k * 1000) / 10.0
    R = r_sun
    r = r_moon
    if m <= 0:
        return 0.0
    a1 = (m * m + R * R - r * r) / (2 * m * R)
    a2 = (m * m + r * r - R * R) / (2 * m * r)
    a1 = max(-1.0, min(1.0, a1))
    a2 = max(-1.0, min(1.0, a2))
    tri = (-m + R + r) * (m + R - r) * (m - R + r) * (m + R + r)
    area = (R * R * math.acos(a1) + r * r * math.acos(a2)
            - 0.5 * math.sqrt(max(0.0, tri)))
    return js_round(area / (math.pi * R * R) * 1000) / 10.0


def max_osc(rec, lat, lon, t_lo, t_hi, coarse=36, refine=26, t_hint=None):
    """Peak obscuration at a fixed place, and the instant it happens.

    Neighbouring points peak within a few minutes of each other, so once one
    peak time is known the climb passes it back as t_hint and the time search
    narrows from the whole eclipse to a short window. That is most of the
    speed of this script.
    """
    if t_hint is not None:
        t_lo = max(t_lo, t_hint - T_PAD)
        t_hi = min(t_hi, t_hint + T_PAD)
        coarse = 10
    best_t = t_lo
    best = 0.0
    span = t_hi - t_lo
    if span <= 0:
        return osc_at(rec, lat, lon, t_lo), t_lo
    for i in range(coarse + 1):
        t = t_lo + span * i / coarse
        v = osc_at(rec, lat, lon, t)
        if v > best:
            best, best_t = v, t
    if best <= 0.0:
        return 0.0, best_t
    if best >= 100.0:
        return 100.0, best_t
    dt = span / coarse
    for _ in range(refine):
        for sign in (-1.0, 1.0):
            t = best_t + sign * dt * 0.5
            if t < t_lo or t > t_hi:
                continue
            v = osc_at(rec, lat, lon, t)
            if v > best:
                best, best_t = v, t
        dt *= 0.5
    return best, best_t


# ── nearest point of a country to the shadow axis track ────────────────────

def country_points(C):
    """A grid over the country, plus one point per landmass. Cached.

    The grid is the same 3-degree sweep gen_country_index.js used, so the peak
    this script finds can never be worse than the one already in the table;
    the climb and the coastline walk then improve on it. Islands get a point
    each regardless of grid spacing, because a 3-degree grid steps clean over
    most of them.
    """
    cache = C.get('_pts')
    if cache is not None:
        return cache
    w, s, e, n = C['bbox']
    grid = []
    step = COARSE
    while True:
        grid = []
        la = s
        while la <= n + 1e-9:
            lo = w
            while lo <= e + 1e-9:
                if CC.pt_in_rings(C['rings'], la, lo):
                    grid.append((la, lo))
                lo += step
            la += step
        if len(grid) <= COARSE_CAP or step > 40.0:
            break
        step *= 1.5
    per_ring = []
    for ring in C['rings']:
        rs = max(1, len(ring) // 40)
        per_ring.append([ring[i] for i in range(0, len(ring), rs)])
    C['_pts'] = (grid, per_ring)
    return C['_pts']


def seed_points(C, cl, rec, n_seeds=3):
    """The few places in this country most likely to hold the peak.

    Every candidate is measured rather than guessed at. An earlier version
    ranked them by ground distance to the shadow track, which is wrong near
    the terminator -- what counts is distance from the axis in three
    dimensions, and at a low sun a place far from the track on the ground can
    be much closer to the axis. That cost a peak in northern Alaska sitting
    1,500 km from anything the distance ranking liked.
    """
    grid, per_ring = country_points(C)
    if not cl:
        return []
    stride = max(1, len(cl) // 16)
    marks = cl[::stride] or [cl[0]]

    cand = list(grid)
    for pts in per_ring:                 # nearest point of each landmass
        bd = 1e18
        bp = None
        for (la, lo) in pts:
            for (cla, clo, _t) in marks:
                d = CC.km((la, lo), (cla, clo))
                if d < bd:
                    bd, bp = d, (la, lo)
        if bp is not None:
            cand.append(bp)
    if not cand:
        return []

    scored = []
    for (la, lo) in cand:
        v, vt = max_osc(rec, la, lo, rec['tmin'], rec['tmax'], coarse=14, refine=4)
        if v > 0.0:
            scored.append((-v, la, lo, vt))
    scored.sort()
    return [(la, lo, vt) for (_v, la, lo, vt) in scored[:n_seeds]]


def climb(rec, C, seed, t_lo, t_hi):
    """Walk uphill in obscuration, staying inside the country.

    Steps are in kilometres, not degrees. A degree of longitude is 111 km at
    the equator and 4 km in north Greenland, so a degree-based pattern search
    crawls at the equator or stalls near the poles depending on which you tune
    it for. Kilometres behave the same everywhere.
    """
    la, lo, hint = seed
    best, hint = max_osc(rec, la, lo, t_lo, t_hi, t_hint=hint or None)
    step_km = 400.0
    while step_km > 0.5:
        moved = True
        while moved:
            moved = False
            dla = step_km / 111.0
            clat = math.cos(max(-89.5, min(89.5, la)) * DEG)
            dlo = step_km / (111.0 * max(clat, 0.02))
            if dlo > 60.0:
                dlo = 60.0
            for mla, mlo in ((dla, 0), (-dla, 0), (0, dlo), (0, -dlo),
                             (dla, dlo), (dla, -dlo), (-dla, dlo), (-dla, -dlo)):
                nla = la + mla
                nlo = lo + mlo
                if nla > 90.0 or nla < -90.0:
                    continue
                if nlo > 180.0:
                    nlo -= 360.0
                elif nlo < -180.0:
                    nlo += 360.0
                if not CC.pt_in_rings(C['rings'], nla, nlo):
                    continue
                v, vt = max_osc(rec, nla, nlo, t_lo, t_hi, t_hint=hint)
                if v > best:
                    best, la, lo, hint = v, nla, nlo, vt
                    moved = True
                    if best >= 100.0:
                        return 100.0
        step_km *= 0.5
    return best


def far_from_track(C, thin):
    """Cheap reject: no point of this country is within REACH_KM of the track.

    Obscuration falls away with distance from the shadow axis, so a country
    thousands of km clear of the track cannot reach the 20% floor and does not
    need any of the expensive work. Tested against the country's bounding box
    corners and edge midpoints, so it never rejects a country a corner of
    which is in range.
    """
    w, s, e, n = C['bbox']
    mw, mn = (w + e) / 2.0, (s + n) / 2.0
    probes = ((s, w), (s, e), (n, w), (n, e), (mn, mw),
              (s, mw), (n, mw), (mn, w), (mn, e))
    for (cla, clo, _t) in thin:
        for p in probes:
            if km(p, (cla, clo)) <= REACH_KM:
                return False
    return True


BORDER_BUDGET = 320   # border points measured per country, across all rings


def border_walk(rec, C, best, hint):
    """Maximise obscuration along the coastline, across every landmass.

    Where obscuration is low the best spot in a country is the bit of it
    nearest the shadow, and that is on the border, not inside; the interior
    climb cannot step there, because every trial point outside the polygon is
    rejected.

    Every ring is walked, not just the one nearest where the climb stopped.
    Ireland is two rings -- a small islet and the mainland -- and picking the
    nearest one landed on the islet and missed the real peak in Donegal.
    """
    rings = C['rings']
    total = sum(len(r) for r in rings) or 1
    bring = brack = None
    for ring in rings:
        share = max(6, int(BORDER_BUDGET * len(ring) / total))
        stride = max(1, len(ring) // share)
        for i in range(0, len(ring), stride):
            pla, plo = ring[i]
            v, vt = max_osc(rec, pla, plo, rec['tmin'], rec['tmax'])
            if v > best:
                best, hint, bring, brack = v, vt, ring, (i, stride)
    if bring is None:
        return best
    # refine between the winning vertex and its immediate neighbours
    i, stride = brack
    seg = bring[max(0, i - stride):min(len(bring), i + stride + 1)]
    for j in range(1, len(seg)):
        a1, b1 = seg[j - 1], seg[j]
        v, vt = max_osc(rec, a1[0], a1[1], rec['tmin'], rec['tmax'], t_hint=hint)
        if v > best:
            best, hint = v, vt
        d = km(a1, b1)
        n = min(int(d / 5.0), 8)
        for k in range(1, n + 1):
            f = k / (n + 1)
            v, vt = max_osc(rec, a1[0] + (b1[0] - a1[0]) * f,
                            a1[1] + (b1[1] - a1[1]) * f,
                            rec['tmin'], rec['tmax'], t_hint=hint)
            if v > best:
                best, hint = v, vt
    return best


def solve(rec, countries):
    """{country_index: obscuration/5} for one eclipse, floor applied."""
    cl = CC.centreline(rec)
    if not cl:
        cl = axis_free_track(rec)
    if not cl:
        return {}
    # thin the track once; used only for the cheap distance prune below
    tstride = max(1, len(cl) // 120)
    thin = cl[::tstride]

    row = {}
    for ci, C in enumerate(countries):
        if far_from_track(C, thin):
            continue
        seeds = seed_points(C, cl, rec)
        if not seeds:
            continue
        best = 0.0
        bseed = seeds[0]
        for sd in seeds:
            v = climb(rec, C, sd, rec['tmin'], rec['tmax'])
            if v > best:
                best, bseed = v, sd
            if best >= 100.0:
                break
        if 0.0 < best < 100.0:
            best = border_walk(rec, C, best, bseed[2] or None)
        if best >= FLOOR:
            row[str(ci)] = js_round(best / BUCKET)
    return row


def axis_free_track(rec):
    """A stand-in track for eclipses whose axis misses the Earth entirely.

    Partial eclipses have no centreline, but they still put 20%+ obscuration
    on real countries, so the seeding needs something to aim at: the point on
    Earth nearest the axis, sampled over the eclipse.
    """
    pts = []
    t = rec['tmin']
    step = 2.0 / 60.0
    while t <= rec['tmax'] + 1e-9:
        X, _, Y, _, d_r, mu, dt_s, _, _ = bstate(rec, t)
        rho1 = math.sqrt(1.0 - GEP.E2 * math.cos(d_r) ** 2)
        r = math.hypot(X, Y / rho1)
        if r > 0:
            k = 0.9995 / r if r > 0.9995 else 1.0
            ll = GEP.f2g(X * k, Y * k, d_r, mu, dt_s)
            if ll is not None:
                pts.append((ll[0], ll[1], t))
        t += step
    return pts


# ── driver ──────────────────────────────────────────────────────────────────

def centuries():
    d = os.path.join(ROOT, 'data/besselian')
    return sorted(f[:-5] for f in os.listdir(d) if f.endswith('.json'))


def run_century(cent, countries, out_path, quiet=False):
    with open(os.path.join(ROOT, 'data/besselian', cent + '.json'),
              encoding='utf8') as fh:
        recs = json.load(fh)
    res = {}
    t0 = time.time()
    for i, rec in enumerate(recs):
        res[str(int(rec['cat_no']))] = solve(rec, countries)
        if not quiet and i % 10 == 0:
            el = time.time() - t0
            eta = el / max(i, 1) * (len(recs) - i)
            sys.stderr.write('\r  %s  %d/%d  %.0fs elapsed, ~%.0fs left   '
                             % (cent, i, len(recs), el, eta))
            sys.stderr.flush()
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with gzip.open(out_path, 'wt', encoding='utf8') as fh:
        json.dump(res, fh)
    if not quiet:
        sys.stderr.write('\r  %s  done  %d eclipses  %.0fs\n'
                         % (cent, len(recs), time.time() - t0))


def _worker(job):
    """One century in its own process. Country polygons are loaded per worker
    because they cannot be shared cheaply across processes."""
    cent, parts = job
    run_century(cent, CC.load_countries(),
                os.path.join(parts, cent + '.json.gz'), quiet=True)
    return cent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--century')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--parts', default=os.path.join(ROOT, 'data/.obsc_parts'))
    ap.add_argument('--merge')
    ap.add_argument('--out')
    ap.add_argument('--benchmark', action='store_true')
    ap.add_argument('--jobs', '-j', type=int, default=0,
                    help='run this many centuries at once (try your core count)')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    if args.merge:
        out = {}
        for f in sorted(os.listdir(args.merge)):
            if f.endswith('.json.gz'):
                with gzip.open(os.path.join(args.merge, f), 'rt') as fh:
                    out.update(json.load(fh))
        dest = args.out or os.path.join(ROOT, 'data/obscuration_countries.json.gz')
        with gzip.open(dest, 'wt', encoding='utf8') as fh:
            json.dump({'__meta': {'generator': 'obscuration_countries.py',
                                  'built': time.strftime('%Y-%m-%d'),
                                  'bucket': BUCKET, 'floor': FLOOR,
                                  'eclipses': len(out)},
                       'obscuration': out}, fh)
        print('merged %d eclipses -> %s' % (len(out), dest))
        return

    countries = CC.load_countries()
    sys.stderr.write('countries: %d\n' % len(countries))

    if args.benchmark:
        with open(os.path.join(ROOT, 'data/besselian/1901_2000.json'),
                  encoding='utf8') as fh:
            recs = json.load(fh)[:10]
        t0 = time.time()
        for rec in recs:
            solve(rec, countries)
        per = (time.time() - t0) / len(recs)
        print('%.2fs per eclipse -> about %.1f hours for 11,898'
              % (per, per * 11898 / 3600.0))
        return

    if args.all:
        todo = [c for c in centuries()
                if not os.path.exists(os.path.join(args.parts, c + '.json.gz'))]
        if not todo:
            print('nothing to do; %s is already complete' % args.parts)
            return
        jobs = args.jobs or 1
        if jobs > 1:
            os.makedirs(args.parts, exist_ok=True)
            print('%d centuries on %d processes' % (len(todo), jobs))
            with multiprocessing.Pool(jobs) as pool:
                for done in pool.imap_unordered(
                        _worker, [(c, args.parts) for c in todo]):
                    print('  done %s' % done, flush=True)
        else:
            for cent in todo:
                run_century(cent, countries,
                            os.path.join(args.parts, cent + '.json.gz'),
                            args.quiet)
        print('all centuries built in %s' % args.parts)
        return

    if not args.century:
        ap.error('need --century, --all, --merge or --benchmark')
    dest = args.out or os.path.join(args.parts, args.century + '.json.gz')
    run_century(args.century, countries, dest, args.quiet)


if __name__ == '__main__':
    main()
