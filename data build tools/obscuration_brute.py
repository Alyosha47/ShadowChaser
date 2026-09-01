#!/usr/bin/env python3
"""obscuration_brute.py — the slow, dumb, independent answer.

Same output as obscuration_countries.py, computed with no cleverness: cover
every country with a fine grid, measure the eclipse obscuration at every node
and at every border vertex, take the highest, then climb from it to catch a
peak sitting between nodes.

There is no seeding heuristic here, and that is the entire point. Every bug
found in the fast version was a seeding bug -- ranking candidates by ground
distance to the shadow track, looking at only one landmass, walking only one
coastline ring. None of those mistakes are possible when you simply measure
everywhere.

It exists to check the fast version, not to replace it. Run both, then:

    python3 "data build tools/compare_obscuration.py"

Grid spacing is 0.4 degrees, about 45 km, plus every border vertex, plus a
climb from the best node. The old generator used 3 degrees and no borders.

Usage -- identical to obscuration_countries.py:
    python3 "data build tools/obscuration_brute.py" --benchmark
    python3 "data build tools/obscuration_brute.py" --all --jobs 6
    python3 "data build tools/obscuration_brute.py" --merge data/.brute_parts \\
            "--out=data/obscuration_brute.json.gz"
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

GRID_DEG = 0.4        # about 45 km
THIN_KM = 12.0        # closest two kept border vertices may be
SKIP_BELOW = 10.0     # skip the border scan if the grid never got this high
BUCKET = OC.BUCKET
FLOOR = OC.FLOOR
REACH_KM = OC.REACH_KM
REACH_DEG = REACH_KM / 111.0


def sample_points(C):
    """Grid nodes inside the country, and border vertices. Cached, separately.

    Border vertices are thinned to no closer than THIN_KM apart. A coastline
    can carry a vertex every few hundred metres, which is far finer than the
    obscuration field ever varies, so keeping them all costs a great deal and
    measures nothing new.
    """
    cache = C.get('_brute')
    if cache is not None:
        return cache
    border = []
    for ring in C['rings']:
        last = None
        for v in ring:
            if last is None or CC.km(last, v) >= THIN_KM:
                border.append(v)
                last = v
        if len(border) < 3:                      # tiny island: keep it whole
            border.extend(ring)
    grid = []
    w, s, e, n = C['bbox']
    la = s
    while la <= n + 1e-9:
        lo = w
        while lo <= e + 1e-9:
            if CC.pt_in_rings(C['rings'], la, lo):
                grid.append((la, lo))
            lo += GRID_DEG
        la += GRID_DEG
    C['_brute'] = (grid, border)
    return C['_brute']


def near_track(pts, thin, box):
    """Drop points that cannot reach the floor: too far from the shadow.

    A cheap latitude/longitude box around the whole track rejects most points
    with two comparisons, before any distance is computed.
    """
    s, n, w, e, wraps = box
    out = []
    for p in pts:
        if p[0] < s or p[0] > n:
            continue
        if not wraps and (p[1] < w or p[1] > e):
            continue
        for (cla, clo, _t) in thin:
            if abs(p[0] - cla) > REACH_DEG:
                continue
            if CC.km(p, (cla, clo)) <= REACH_KM:
                out.append(p)
                break
    return out


def track_box(thin):
    pad = REACH_DEG
    la = [p[0] for p in thin]
    lo = [p[1] for p in thin]
    s, n = max(-90.0, min(la) - pad), min(90.0, max(la) + pad)
    span = max(lo) - min(lo)
    wraps = span > 180.0 or (max(lo) + pad > 180.0) or (min(lo) - pad < -180.0)
    return (s, n, min(lo) - pad, max(lo) + pad, wraps)


def climb(rec, C, la, lo, best, hint):
    """Refine from the best sampled point, in case the peak fell between nodes.

    Steps in kilometres so it behaves the same near the poles as at the
    equator, and accepts points on the border as well as inside, since a peak
    is very often on a coastline.
    """
    step_km = GRID_DEG * 111.0
    while step_km > 0.5:
        moved = True
        while moved:
            moved = False
            dla = step_km / 111.0
            clat = math.cos(max(-89.5, min(89.5, la)) * OC.DEG)
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
                v, vt = OC.max_osc(rec, nla, nlo, rec['tmin'], rec['tmax'],
                                   t_hint=hint)
                if v > best:
                    best, la, lo, hint, moved = v, nla, nlo, vt, True
                    if best >= 100.0:
                        return 100.0
        step_km *= 0.5
    return best


SCAN_COARSE = 48      # time samples used while scanning for the best place
SCAN_SLACK = 3.0      # percentage points the coarse scan may undervalue by
SHORT_CAP = 500       # most places worth re-measuring, worst case


def solve(rec, countries):
    """Peak obscuration per country, measured everywhere, no seeding.

    Two passes over the same complete point set. The scan pass measures every
    point but samples time coarsely, which is enough to rank places against
    each other. The shortlist is then re-measured at full time precision, and
    the winner is climbed from, in case the true peak sits between grid nodes.
    Nothing is skipped on a guess about where the peak ought to be.
    """
    cl = CC.centreline(rec) or OC.axis_free_track(rec)
    if not cl:
        return {}
    tstride = max(1, len(cl) // 120)
    thin = cl[::tstride]
    box = track_box(thin)
    t_lo, t_hi = rec['tmin'], rec['tmax']

    row = {}
    for ci, C in enumerate(countries):
        if OC.far_from_track(C, thin):
            continue
        grid, border = sample_points(C)
        pts = near_track(grid, thin, box) + near_track(border, thin, box)
        if not pts:
            continue

        shortlist = []
        for p in pts:
            v, _vt = OC.max_osc(rec, p[0], p[1], t_lo, t_hi,
                                coarse=SCAN_COARSE, refine=0)
            if v > 0.0:
                shortlist.append((-v, p))
        if not shortlist:
            continue
        shortlist.sort(key=lambda x: x[0])
        # The coarse scan only ever UNDER-states a point, so ranking on it and
        # keeping the top few can drop the real winner: for India the true
        # peak scanned 0.9 points low and finished outside the top 60. Keep
        # everything within the scan's margin of error instead of a fixed
        # number of places.
        cutoff = -shortlist[0][0] - SCAN_SLACK
        shortlist = [x for x in shortlist if -x[0] >= cutoff][:SHORT_CAP]

        best = 0.0
        bp = None
        hint = None
        for (_nv, p) in shortlist:
            v, vt = OC.max_osc(rec, p[0], p[1], t_lo, t_hi)
            if v > best:
                best, bp, hint = v, p, vt
                if best >= 100.0:
                    break
        if bp is None or best <= 0.0:
            continue
        if best < 100.0:
            best = climb(rec, C, bp[0], bp[1], best, hint)
        if best >= FLOOR:
            row[str(ci)] = OC.js_round(best / BUCKET)
    return row


def run_century(cent, countries, out_path, quiet=False):
    with open(os.path.join(ROOT, 'data/besselian', cent + '.json'),
              encoding='utf8') as fh:
        recs = json.load(fh)
    res = {}
    t0 = time.time()
    for i, rec in enumerate(recs):
        res[str(int(rec['cat_no']))] = solve(rec, countries)
        if not quiet and i % 5 == 0:
            el = time.time() - t0
            sys.stderr.write('\r  %s  %d/%d  %.0fs elapsed, ~%.0fs left   '
                             % (cent, i, len(recs), el,
                                el / max(i, 1) * (len(recs) - i)))
            sys.stderr.flush()
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    tmp = out_path + '.tmp'
    with gzip.open(tmp, 'wt', encoding='utf8') as fh:
        json.dump(res, fh)
    os.replace(tmp, out_path)      # so a killed run never leaves a half file
    sys.stderr.write('\r  %s done  %d eclipses  %.0fs\n'
                     % (cent, len(recs), time.time() - t0))
    sys.stderr.flush()


def _worker(job):
    cent, parts = job
    sys.stderr.write('  start %s\n' % cent)
    sys.stderr.flush()
    run_century(cent, CC.load_countries(),
                os.path.join(parts, cent + '.json.gz'), quiet=True)
    return cent


def centuries():
    d = os.path.join(ROOT, 'data/besselian')
    return sorted(f[:-5] for f in os.listdir(d) if f.endswith('.json'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--century')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--parts', default=os.path.join(ROOT, 'data/.brute_parts'))
    ap.add_argument('--merge')
    ap.add_argument('--out')
    ap.add_argument('--benchmark', action='store_true')
    ap.add_argument('--jobs', '-j', type=int, default=0)
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    if args.merge:
        out = {}
        for f in sorted(os.listdir(args.merge)):
            if f.endswith('.json.gz'):
                with gzip.open(os.path.join(args.merge, f), 'rt') as fh:
                    out.update(json.load(fh))
        dest = args.out or os.path.join(ROOT, 'data/obscuration_brute.json.gz')
        with gzip.open(dest, 'wt', encoding='utf8') as fh:
            json.dump({'__meta': {'generator': 'obscuration_brute.py',
                                  'grid_deg': GRID_DEG,
                                  'built': time.strftime('%Y-%m-%d'),
                                  'eclipses': len(out)},
                       'obscuration': out}, fh)
        print('merged %d eclipses -> %s' % (len(out), dest))
        return

    countries = CC.load_countries()
    sys.stderr.write('countries: %d\n' % len(countries))

    if args.benchmark:
        # a spread across the catalogue, not ten cheap modern ones
        cents = centuries()
        picks = [cents[0], cents[len(cents) // 3], cents[2 * len(cents) // 3],
                 cents[-1]]
        recs = []
        for c in picks:
            with open(os.path.join(ROOT, 'data/besselian', c + '.json'),
                      encoding='utf8') as fh:
                recs += json.load(fh)[:3]
        t0 = time.time()
        for rec in recs:
            solve(rec, countries)
        per = (time.time() - t0) / len(recs)
        print('%.2fs per eclipse -> about %.1f hours for 11,898 on one core'
              % (per, per * 11898 / 3600.0))
        return

    if args.all:
        todo = [c for c in centuries()
                if not os.path.exists(os.path.join(args.parts, c + '.json.gz'))]
        if not todo:
            print('nothing to do; %s is already complete' % args.parts)
            return
        os.makedirs(args.parts, exist_ok=True)
        jobs = args.jobs or 1
        if jobs > 1:
            print('%d centuries on %d processes' % (len(todo), jobs), flush=True)
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
