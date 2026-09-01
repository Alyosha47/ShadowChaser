#!/usr/bin/env python3
"""audit_obscuration.py — settle disagreements between the old and new tables.

Every country whose obscuration went DOWN is either a real error in the old
table or a miss in the new one. This tests a random sample of them the slow
way: every point of a fine grid across the country, plus every border vertex,
no shortcuts. Whichever table matches brute force is the right one.

    python3 "data build tools/audit_obscuration.py" --n 40
    python3 "data build tools/audit_obscuration.py" --n 40 --dropped
"""

import os, sys, json, gzip, random, argparse, importlib.util, time
import multiprocessing

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = importlib.util.spec_from_file_location(
    'obscuration_countries', os.path.join(HERE, 'obscuration_countries.py'))
OC = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(OC)
CC = OC.CC


def brute(rec, C, step=0.4):
    pts = []
    for ring in C['rings']:
        pts += ring[::max(1, len(ring) // 500)]
    w, s, e, n = C['bbox']
    la = s
    while la <= n:
        lo = w
        while lo <= e:
            if CC.pt_in_rings(C['rings'], la, lo):
                pts.append((la, lo))
            lo += step
        la += step
    best = 0.0
    for (la, lo) in pts:
        v = OC.max_osc(rec, la, lo, rec['tmin'], rec['tmax'])
        if isinstance(v, tuple):      # newer obscuration_countries.py also
            v = v[0]                  # returns the time of the peak
        if v > best:
            best = v
    return best


_SHARED = {}


def _check(job):
    cat, ci, ov, nv = job
    rec = _SHARED['recs'].get(cat)
    if rec is None:
        return None
    truth = brute(rec, _SHARED['countries'][int(ci)])
    return (cat, ci, ov, nv, truth, OC.js_round(truth / 5))


def _init(recs, countries):
    _SHARED['recs'] = recs
    _SHARED['countries'] = countries


def _run_parallel(sample, recs, countries, names, jobs):
    """Every candidate, across processes. Each worker keeps its own copy of the
    country polygons; they are read-only and cheap enough to duplicate."""
    print('checking all %d on %d processes' % (len(sample), jobs), flush=True)
    new_right = old_right = neither = 0
    bad = []
    t0 = time.time()
    with multiprocessing.Pool(jobs, initializer=_init,
                              initargs=(recs, countries)) as pool:
        for i, res in enumerate(pool.imap_unordered(_check, sample, chunksize=4)):
            if res is None:
                continue
            cat, ci, ov, nv, truth, tb = res
            if tb == nv:
                new_right += 1
            elif tb == ov:
                old_right += 1
                bad.append((cat, names[int(ci)], ov, nv, truth))
            else:
                neither += 1
                bad.append((cat, names[int(ci)], ov, nv, truth))
            if i % 50 == 0:
                sys.stderr.write('\r  %d/%d  %.0fs   ' % (i, len(sample), time.time() - t0))
                sys.stderr.flush()
    sys.stderr.write('\r')
    for (cat, nm, ov, nv, truth) in bad:
        print('  MISS  cat %-7s %-26s old %2d  new %2d  truth %.1f%%'
              % (cat, nm, ov, nv, truth))
    total = new_right + old_right + neither
    print('\nnew correct %d of %d  (%.2f%%)   old correct %d   neither %d   %.0fs'
          % (new_right, total, 100.0 * new_right / max(total, 1),
             old_right, neither, time.time() - t0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--old', default=os.path.join(ROOT, 'data/country_index.json.gz'))
    ap.add_argument('--obsc', default=os.path.join(ROOT, 'data/obscuration_countries.json.gz'))
    ap.add_argument('--n', type=int, default=30)
    ap.add_argument('--dropped', action='store_true',
                    help='audit entries the new table lost, not ones that fell')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--all', action='store_true',
                    help='check every candidate, not a sample')
    ap.add_argument('--jobs', '-j', type=int, default=0,
                    help='processes to use with --all')
    args = ap.parse_args()

    with gzip.open(args.old, 'rt') as fh:
        old = json.load(fh)
    with gzip.open(args.obsc, 'rt') as fh:
        new = json.load(fh)['obscuration']
    oi, names = old['index'], old['names']

    recs = {}
    bdir = os.path.join(ROOT, 'data/besselian')
    for f in sorted(os.listdir(bdir)):
        if f.endswith('.json'):
            with open(os.path.join(bdir, f), encoding='utf8') as fh:
                for r in json.load(fh):
                    recs[str(int(r['cat_no']))] = r

    cases = []
    for cat, row in oi.items():
        nrow = new.get(cat)
        if nrow is None:
            continue
        for ci, ov in row.items():
            ov = abs(ov)
            nv = abs(int(nrow.get(ci, 0)))
            if args.dropped:
                if ci not in nrow:
                    cases.append((cat, ci, ov, 0))
            elif ci in nrow and nv < ov:
                cases.append((cat, ci, ov, nv))

    print('%d candidate cases' % len(cases))
    if args.all:
        sample = cases
    else:
        random.seed(args.seed)
        sample = random.sample(cases, min(args.n, len(cases)))

    countries = CC.load_countries()
    if args.all and (args.jobs or 0) > 1:
        _run_parallel(sample, recs, countries, names, args.jobs)
        return
    old_right = new_right = neither = 0
    t0 = time.time()
    for (cat, ci, ov, nv) in sample:
        rec = recs.get(cat)
        if rec is None:
            continue
        truth = brute(rec, countries[int(ci)])
        # Must round the way the builder and the app do. Python's round() is
        # banker's rounding, so an exact 82.5% (16.5 buckets) came out 16 here
        # and 17 in the table, and the audit reported a disagreement that did
        # not exist.
        tb = OC.js_round(truth / 5)
        if tb == nv:
            verdict = 'NEW right'
            new_right += 1
        elif tb == ov:
            verdict = 'OLD right  <-- new table is missing the peak'
            old_right += 1
        else:
            verdict = 'neither (%d)' % tb
            neither += 1
        print('%-7s %-26s old %2d  new %2d  truth %5.1f%% (%2d)  %s'
              % (cat, names[int(ci)], ov, nv, truth, tb, verdict), flush=True)

    print('\nnew correct %d, old correct %d, neither %d  (%.0fs)'
          % (new_right, old_right, neither, time.time() - t0))


if __name__ == '__main__':
    main()
