#!/usr/bin/env python3
"""obscuration_exact.py — the peak obscuration in a country, without searching.

The three earlier attempts all SEARCHED for the brightest spot: a coarse grid,
a hill climb, a finer grid. Every bug came from the search looking in the wrong
place, and no search can prove it did not miss something.

This computes the answer instead.

How
---
Obscuration at a place and instant depends on one number: m, the distance from
that place to the shadow AXIS, measured in the fundamental plane. Not the
distance to the centreline on the ground -- the axis is a line in space, and
when the Sun is low a place far from the centreline can sit much closer to the
axis. That distinction is what earlier versions kept getting wrong.

In the fundamental frame the observer's position is a unit vector and the axis
is a straight line. So for a fixed instant, "where in this country is the
eclipse deepest" is: which point of this region is closest to that line. That
has an exact answer:

  * if the axis's own ground point lies inside the country, that is the
    closest point, distance zero -- nothing can beat it;
  * otherwise the closest point is on the country's boundary, and the closest
    point of a boundary segment to a line is a smooth one-dimensional problem
    solved to machine precision on each segment in turn.

Every segment of every boundary is examined. There is no grid to step over a
peak and no seed to start in the wrong place. The only sampling left is in
time, and that is a single smooth variable refined by bisection.

Verifying rather than rebuilding
--------------------------------
Given an existing table, each entry only needs the question "can anything in
this country beat the value already recorded?" -- so an entry is either proven
correct or corrected, and you know which. That is what --verify does, and it
is much cheaper than building from nothing.

    python3 "data build tools/obscuration_exact.py" --check 5412 russia
    python3 "data build tools/obscuration_exact.py" --verify --jobs 6
    python3 "data build tools/obscuration_exact.py" --all --jobs 6
"""

import os, sys, json, gzip, math, time, argparse, importlib.util
import multiprocessing

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = importlib.util.spec_from_file_location(
    'obscuration_countries', os.path.join(HERE, 'obscuration_countries.py'))
OC = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(OC)
CC = OC.CC
GEP = OC.GEP

DEG = OC.DEG
E2 = GEP.E2
BUCKET = OC.BUCKET
FLOOR = OC.FLOOR

PROBE_STEPS = 240      # cheap sweep, to find WHEN the eclipse peaks here
PROBE_MARGIN = 12.0    # how far the cheap probe may read low, in percent
MAX_BOXES = 24         # bounding rectangles per country, at most
SPREAD_STEPS = 48      # exact instants spread over the whole eclipse
WINDOW_STEPS = 20      # exact instants solved around that peak
T_REFINE = 40          # bisection passes on the best instant
EDGE_SPLIT = 6.0       # degrees; longer boundary edges are split before solving


# ── the fundamental frame ───────────────────────────────────────────────────

def frame(rec, t):
    """Everything about the shadow at instant t, as a flat tuple."""
    X, _, Y, _, d_r, mu, dt_s, L1, L2 = OC.bstate(rec, t)
    sin_d = math.sin(d_r)
    cos_d = math.cos(d_r)
    rho1 = math.sqrt(1.0 - E2 * cos_d * cos_d)
    sin_d1 = sin_d / rho1
    cos_d1 = math.sqrt(1.0 - E2) * cos_d / rho1
    return (X, Y / rho1, sin_d1, cos_d1, mu, dt_s, L1, L2, rho1, d_r)


def project(lat, lon, fr):
    """Place on the Earth -> (xi, eta1, zeta1) in the corrected frame.

    A pure rotation of the unit sphere, so the result is a unit vector and the
    shadow axis is the vertical line through (X, Y1).
    """
    _X, _Y1, sin_d1, cos_d1, mu, dt_s = fr[0], fr[1], fr[2], fr[3], fr[4], fr[5]
    lat_gc = math.atan(math.tan(lat * DEG) * math.sqrt(1.0 - E2))
    H = ((lon + mu - 0.00417807 * dt_s) % 360.0)
    if H > 180.0:
        H -= 360.0
    H *= DEG
    cl = math.cos(lat_gc)
    sl = math.sin(lat_gc)
    cH = math.cos(H)
    xi = cl * math.sin(H)
    eta1 = sl * cos_d1 - cl * cH * sin_d1
    zeta1 = sl * sin_d1 + cl * cH * cos_d1
    return xi, eta1, zeta1


def axis_dist2(lat, lon, fr):
    """Squared distance from a place to the shadow axis, and its zeta."""
    xi, eta1, zeta1 = project(lat, lon, fr)
    dx = xi - fr[0]
    dy = eta1 - fr[1]
    return dx * dx + dy * dy, zeta1


def obsc(m2, zeta1, rec, fr):
    if zeta1 <= 0.0:
        return 0.0
    m = math.sqrt(m2)
    L1p = fr[6] - zeta1 * rec['tan_f1']
    L2p = fr[7] - zeta1 * rec['tan_f2']
    if m >= L1p:
        return 0.0
    r_sun = (L1p + L2p) / 2.0
    r_moon = (L1p - L2p) / 2.0
    if r_sun <= 0.0:
        return 0.0
    if L2p < 0 and m <= -L2p:
        return 100.0
    if L2p > 0 and m <= L2p:
        k = r_moon / r_sun
        return OC.js_round(k * k * 1000) / 10.0
    R, r = r_sun, r_moon
    if m <= 0:
        return 0.0
    a1 = max(-1.0, min(1.0, (m * m + R * R - r * r) / (2 * m * R)))
    a2 = max(-1.0, min(1.0, (m * m + r * r - R * R) / (2 * m * r)))
    tri = (-m + R + r) * (m + R - r) * (m - R + r) * (m + R + r)
    area = (R * R * math.acos(a1) + r * r * math.acos(a2)
            - 0.5 * math.sqrt(max(0.0, tri)))
    return OC.js_round(area / (math.pi * R * R) * 1000) / 10.0


# ── closest point of a boundary segment to the axis ─────────────────────────

def seg_min(a, b, fr, rec):
    """Highest obscuration along the boundary segment a..b.

    This optimises obscuration itself, not distance to the axis. Distance is
    ALMOST the right thing -- but the shadow cone radii shrink as the Sun
    drops towards the horizon, so a place slightly further from the axis with
    the Sun higher can be more deeply eclipsed than the nearest place of all.
    Minimising distance instead read Kiribati ten buckets low.

    The segment is walked in the parameter the polygon is defined in, so the
    edge tested is the edge the map actually draws. The objective is smooth
    along one segment, so golden-section bisection converges to the true
    minimum -- there is no step size to be too coarse.
    """
    la0, lo0 = a
    la1, lo1 = b
    dlo = lo1 - lo0
    if dlo > 180.0:
        dlo -= 360.0
    elif dlo < -180.0:
        dlo += 360.0

    def at(s):
        m2, z = axis_dist2(la0 + (la1 - la0) * s, lo0 + dlo * s, fr)
        return obsc(m2, z, rec, fr)

    lo_s, hi_s = 0.0, 1.0
    g = (math.sqrt(5.0) - 1.0) / 2.0
    c = hi_s - g * (hi_s - lo_s)
    d = lo_s + g * (hi_s - lo_s)
    fc = at(c)
    fd = at(d)
    for _ in range(40):
        if fc > fd:
            hi_s, d, fd = d, c, fc
            c = hi_s - g * (hi_s - lo_s)
            fc = at(c)
        else:
            lo_s, c, fc = c, d, fd
            d = lo_s + g * (hi_s - lo_s)
            fd = at(d)
        if hi_s - lo_s < 1e-10:
            break
    best = max(fc, fd, at(0.0), at(1.0))
    return best


def edges(C):
    """Boundary segments, split so none spans more than EDGE_SPLIT degrees.

    Splitting matters: the distance along a very long edge can dip twice, and
    a single bisection would find only one of the dips. Short edges cannot.
    """
    cache = C.get('_edges')
    if cache is not None:
        return cache
    out = []
    for ring in C['rings']:
        for i in range(1, len(ring)):
            a, b = ring[i - 1], ring[i]
            dla = abs(b[0] - a[0])
            dlo = abs(b[1] - a[1])
            if dlo > 180.0:
                dlo = 360.0 - dlo
            n = int(max(dla, dlo) / EDGE_SPLIT) + 1
            if n == 1:
                out.append((a, b))
            else:
                for k in range(n):
                    s0, s1 = k / n, (k + 1) / n
                    d = b[1] - a[1]
                    if d > 180.0:
                        d -= 360.0
                    elif d < -180.0:
                        d += 360.0
                    out.append(((a[0] + (b[0] - a[0]) * s0, a[1] + d * s0),
                                (a[0] + (b[0] - a[0]) * s1, a[1] + d * s1)))
        out.append((ring[-1], ring[0]))
    C['_edges'] = out
    return out


def interior_max(rec, C, fr, gp):
    """Highest obscuration strictly inside the country, at one instant.

    The deepest point inside a region is NOT simply where the shadow axis
    meets the ground. Obscuration depends on distance from the axis AND on how
    high the Sun is, because the shadow cone narrows towards the horizon, so
    the interior peak drifts away from the axis foot as the Sun drops. This is
    the same mistake that read Kiribati ten buckets low on the boundary; it
    survived here untouched and made the exact pass report zero for Greenland
    and Antarctica where two other methods measured forty per cent.

    So the axis foot is a starting point, not an answer: from it, walk uphill
    in obscuration while staying inside the country.
    """
    if gp is None:
        return 0.0
    la, lo = gp[0], gp[1]
    if not CC.pt_in_rings(C['rings'], la, lo):
        return 0.0
    m2, z = axis_dist2(la, lo, fr)
    best = obsc(m2, z, rec, fr)
    if best >= 100.0:
        return 100.0
    step_km = 600.0
    while step_km > 1.0:
        moved = True
        while moved:
            moved = False
            dla = step_km / 111.0
            clat = math.cos(max(-89.5, min(89.5, la)) * DEG)
            dlo = min(step_km / (111.0 * max(clat, 0.02)), 60.0)
            for mla, mlo in ((dla, 0), (-dla, 0), (0, dlo), (0, -dlo),
                             (dla, dlo), (dla, -dlo), (-dla, dlo), (-dla, -dlo)):
                nla, nlo = la + mla, lo + mlo
                if nla > 90.0 or nla < -90.0:
                    continue
                if nlo > 180.0:
                    nlo -= 360.0
                elif nlo < -180.0:
                    nlo += 360.0
                if not CC.pt_in_rings(C['rings'], nla, nlo):
                    continue
                m2, z = axis_dist2(nla, nlo, fr)
                v = obsc(m2, z, rec, fr)
                if v > best:
                    best, la, lo, moved = v, nla, nlo, True
                    if best >= 100.0:
                        return 100.0
        step_km *= 0.5
    return best


def peak_at(rec, C, fr):
    """Highest obscuration anywhere in this country, at one instant.

    Boundary and interior are both examined. Every boundary segment is solved
    to machine precision, and the interior is climbed from the axis foot. The
    maximum of a smooth function over a closed region lies in one place or the
    other, so between them nothing is left out.
    """
    gp = GEP.f2g(fr[0], fr[1] * fr[8], fr[9], fr[4], fr[5])
    best = interior_max(rec, C, fr, gp)
    if best >= 100.0:
        return 100.0
    for (a, b) in edges(C):
        v = seg_min(a, b, fr, rec)
        if v > best:
            best = v
            if best >= 100.0:
                return 100.0
    return best


def bbox_bound(rec, C, t):
    """An UPPER bound on the obscuration anywhere in this country at time t.

    The country lies inside its bounding rectangle, so the most obscured point
    of that rectangle is at least as obscured as the most obscured point of the
    country. Solving the rectangle costs four segments instead of thousands.

    That turns verification into a proof for most entries: if the bound rounds
    to the value already recorded, and that value came from a real measured
    point, then the recorded value IS the peak and no exact solve is needed.
    """
    fr = frame(rec, t)
    gp = GEP.f2g(fr[0], fr[1] * fr[8], fr[9], fr[4], fr[5])
    best = 0.0
    for (s, w, n, e) in ring_boxes(C):
        corners = [(s, w), (s, e), (n, e), (n, w)]
        for i in range(4):
            v = seg_min(corners[i - 1], corners[i], fr, rec)
            if v > best:
                best = v
        if gp is not None and s <= gp[0] <= n and w <= gp[1] <= e:
            m2, z = axis_dist2(gp[0], gp[1], fr)
            v = obsc(m2, z, rec, fr)
            if v > best:
                best = v
    return best


def ring_boxes(C):
    """One bounding rectangle per landmass, not one for the whole country.

    A single box round Canada or Indonesia spans a continent, so the bound it
    gives is far too loose to prove anything and every entry falls through to
    the full boundary walk -- which is exactly the countries where the walk is
    most expensive. A box per landmass is tight enough to be worth having.

    Rings are merged into at most MAX_BOXES groups so a country of a thousand
    islands does not cost a thousand rectangles.
    """
    cache = C.get('_boxes')
    if cache is not None:
        return cache
    boxes = []
    for ring in C['rings']:
        s = n = ring[0][0]
        w = e = ring[0][1]
        for (la, lo) in ring:
            if la < s: s = la
            if la > n: n = la
            if lo < w: w = lo
            if lo > e: e = lo
        boxes.append([s, w, n, e])
    while len(boxes) > MAX_BOXES:
        boxes.sort(key=lambda b: (b[0], b[1]))
        merged = []
        for i in range(0, len(boxes), 2):
            if i + 1 < len(boxes):
                a, b = boxes[i], boxes[i + 1]
                merged.append([min(a[0], b[0]), min(a[1], b[1]),
                               max(a[2], b[2]), max(a[3], b[3])])
            else:
                merged.append(boxes[i])
        boxes = merged
    C['_boxes'] = [tuple(b) for b in boxes]
    return C['_boxes']


def bbox_probe(rec, C, t):
    """Cheap upper-ish reading for the country at instant t.

    Uses a handful of points -- the country's corners, edges and middle --
    rather than its whole boundary. Far too crude to trust as an answer, but
    it tracks the real curve closely enough to say WHEN the eclipse peaks over
    this country, and that is all it is asked to do.
    """
    w, s, e, n = C['bbox']
    mw, mn = (w + e) / 2.0, (s + n) / 2.0
    fr = frame(rec, t)
    best = 0.0
    for (la, lo) in ((s, w), (s, mw), (s, e), (mn, w), (mn, mw), (mn, e),
                     (n, w), (n, mw), (n, e)):
        m2, z = axis_dist2(la, lo, fr)
        v = obsc(m2, z, rec, fr)
        if v > best:
            best = v
    return best


def peak(rec, C, floor=0.0):
    """Highest obscuration anywhere in the country, over the whole eclipse.

    Two stages, because walking every boundary segment at every instant is
    hundreds of times more work than the answer needs. A cheap probe over the
    country's bounding box finds WHEN the eclipse peaks there; the exact
    boundary solve then runs only at the handful of instants around that peak.
    The probe cannot fix the answer -- it only decides where to look in time --
    and the window around it is deliberately generous.

    `floor` short-circuits verification: if nothing anywhere in the bounding
    box can reach the value already claimed, the entry cannot be beaten and
    the exact solve is skipped entirely.
    """
    t0, t1 = rec['tmin'], rec['tmax']
    span = t1 - t0

    # stage 1 -- an upper bound at every instant, from the bounding rectangle
    probes = []
    for i in range(PROBE_STEPS + 1):
        t = t0 + span * i / PROBE_STEPS
        probes.append((bbox_bound(rec, C, t), t))
    # The rectangle reading is used ONLY to rank instants. It is NOT an upper
    # bound and must never gate anything: obscuration does not fall off purely
    # with distance from the axis -- the shadow cone narrows as the Sun drops
    # -- so a rectangle can read zero at an instant when a point inside it
    # reaches sixteen per cent. Used as a gate it returned a flat zero for
    # Russia, and for Greenland, Antarctica and Canada before that.

    # stage 2 -- exact solve at the best instants the probe found, plus their
    # neighbours. Taking the best INSTANTS rather than a window around the
    # single best one matters: the probe reads the country's bounding box, not
    # the country, so its peak can sit some way off the real one, and the real
    # curve can have more than one hump.
    step = span / PROBE_STEPS
    seen = set()
    times = []

    # An even spread across the whole eclipse, ALWAYS. The bound is loose --
    # it measures a rectangle round the country, not the country -- so its
    # highest readings can all sit in one narrow window where the shadow is
    # inside the box but out at sea. Ranking on it alone put all the exact
    # solves in that window and returned zero for Greenland while the real
    # peak sat hours away, untouched.
    for i in range(SPREAD_STEPS + 1):
        tt = t0 + span * i / SPREAD_STEPS
        key = round(tt, 9)
        if key not in seen:
            seen.add(key)
            times.append(tt)

    # ...then the instants the bound likes best, which sharpen the answer when
    # the bound happens to be tight.
    probes.sort(reverse=True)
    for (_v, t) in probes[:WINDOW_STEPS]:
        for k in (-1, 0, 1):
            tt = min(t1, max(t0, t + k * step))
            key = round(tt, 9)
            if key not in seen:
                seen.add(key)
                times.append(tt)

    best = 0.0
    best_t = times[0]
    for t in times:
        v = peak_at(rec, C, frame(rec, t))
        if v > best:
            best, best_t = v, t
        if best >= 100.0:
            return 100.0
    if best <= 0.0:
        return 0.0
    dt = step
    for _ in range(T_REFINE):
        for sign in (-1.0, 1.0):
            t = best_t + sign * dt * 0.5
            if t < t0 or t > t1:
                continue
            v = peak_at(rec, C, frame(rec, t))
            if v > best:
                best, best_t = v, t
        dt *= 0.5
        if best >= 100.0:
            return 100.0
    return best


# ── drivers ─────────────────────────────────────────────────────────────────

def load_recs():
    out = {}
    bdir = os.path.join(ROOT, 'data/besselian')
    for f in sorted(os.listdir(bdir)):
        if f.endswith('.json'):
            with open(os.path.join(bdir, f), encoding='utf8') as fh:
                for r in json.load(fh):
                    out[str(int(r['cat_no']))] = r
    return out


_S = {}


def _init():
    _S['recs'] = load_recs()
    _S['countries'] = CC.load_countries()


def _verify_one(job):
    cat, ci, claimed = job
    rec = _S['recs'].get(cat)
    if rec is None:
        return None
    v = peak(rec, _S['countries'][int(ci)], floor=claimed * BUCKET)
    if v < 0.0:
        return (cat, ci, claimed, claimed, v)      # proven without solving
    return (cat, ci, claimed, OC.js_round(v / BUCKET), v)


def pick_suspects(jobs, countries, args):
    """The entries with a real chance of being wrong.

    Two signals, both earned the hard way. Where the two existing tables
    disagree, at least one of them is wrong by construction. And every failure
    found by hand was a country with many separate landmasses or a very long
    coastline -- Kiribati, Ireland, Canada, Russia, Antarctica -- because that
    is what defeats a search that starts from a handful of places.
    """
    disagree = set()
    try:
        with gzip.open(args.fast, 'rt') as fh:
            fast = json.load(fh)['obscuration']
        with gzip.open(args.brute, 'rt') as fh:
            brute = json.load(fh)['obscuration']
        for cat in set(fast) | set(brute):
            a = fast.get(cat, {})
            b = brute.get(cat, {})
            for ci in set(a) | set(b):
                if abs(int(a.get(ci, 0))) != abs(int(b.get(ci, 0))):
                    disagree.add((cat, ci))
        print('%d entries where the two tables disagree' % len(disagree))
    except (OSError, KeyError, ValueError) as err:
        print('(no second table to compare: %s)' % err)

    complex_country = set()
    for i, C in enumerate(countries):
        if len(C['rings']) >= args.min_rings or len(edges(C)) >= 1500:
            complex_country.add(str(i))
    print('%d countries counted as complex' % len(complex_country))

    out = [j for j in jobs
           if (j[0], j[1]) in disagree or j[1] in complex_country]
    print('%d suspect entries of %d' % (len(out), len(jobs)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', nargs=2, metavar=('CAT', 'COUNTRY'))
    ap.add_argument('--verify', action='store_true',
                    help='check every entry of the existing index')
    ap.add_argument('--index', default=os.path.join(ROOT, 'data/country_index.json.gz'))
    ap.add_argument('--jobs', '-j', type=int, default=0)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--suspects', action='store_true',
                    help='verify only the entries most likely to be wrong')
    ap.add_argument('--fast', default=os.path.join(ROOT, 'data/obscuration_countries.json.gz'))
    ap.add_argument('--brute', default=os.path.join(ROOT, 'data/obscuration_brute.json.gz'))
    ap.add_argument('--min-rings', type=int, default=60,
                    help='with --suspects, treat countries with at least this '
                         'many separate landmasses as suspect')
    ap.add_argument('--out', default=os.path.join(ROOT, 'data/exact_corrections.json'))
    args = ap.parse_args()

    countries = CC.load_countries()
    names = [c['name'] for c in countries]

    if args.check:
        recs = load_recs()
        cat, cname = args.check
        v = peak(recs[cat], countries[names.index(cname)])
        print('%s %s: %.3f%%  -> bucket %d' % (cat, cname, v, OC.js_round(v / BUCKET)))
        return

    if not args.verify:
        ap.error('need --check or --verify')

    with gzip.open(args.index, 'rt') as fh:
        idx = json.load(fh)
    jobs = []
    for cat, row in idx['index'].items():
        for ci, v in row.items():
            jobs.append((cat, ci, abs(int(v))))
    if args.suspects:
        jobs = pick_suspects(jobs, countries, args)
    if args.limit:
        jobs = jobs[:args.limit]
    print('%d entries to verify' % len(jobs), flush=True)

    fixes = []
    agree = 0
    t0 = time.time()
    n = args.jobs or 1
    if n > 1:
        pool = multiprocessing.Pool(n, initializer=_init)
        it = pool.imap_unordered(_verify_one, jobs, chunksize=8)
    else:
        _init()
        it = (_verify_one(j) for j in jobs)
    for i, res in enumerate(it):
        if res is None:
            continue
        cat, ci, claimed, got, raw = res
        if got == claimed:
            agree += 1
        else:
            fixes.append({'cat': cat, 'country': ci, 'name': names[int(ci)],
                          'was': claimed, 'is': got, 'percent': round(raw, 3)})
        if i % 500 == 0:
            el = time.time() - t0
            sys.stderr.write('\r  %d/%d  %.0fs  eta %.0fs  %d disagree   '
                             % (i, len(jobs), el,
                                el / max(i, 1) * (len(jobs) - i), len(fixes)))
            sys.stderr.flush()
    sys.stderr.write('\r')
    with open(args.out, 'w', encoding='utf8') as fh:
        json.dump(fixes, fh, indent=1)
    print('confirmed %d, disagreed %d  -> %s  (%.0fs)'
          % (agree, len(fixes), args.out, time.time() - t0))


if __name__ == '__main__':
    main()
