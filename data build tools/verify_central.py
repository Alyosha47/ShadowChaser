#!/usr/bin/env python3
"""verify_central.py — independent check of single (eclipse, country) verdicts.

central_countries.py decides quickly, using a boundary argument. This checks
the same question the slow, dumb way: cover the country with an interior grid
AND its whole border, take the eclipse magnitude at every one of those points,
then climb from the best of them. If the peak reaches 1.0 the umbra touched
the country. Two independent searches agreeing is worth more than one.

    python3 "data build tools/verify_central.py" --cat 9324 --country "united states of america"
    python3 "data build tools/verify_central.py" --pairs pairs.txt     # "cat<TAB>country" per line
    python3 "data build tools/verify_central.py" --check-removals      # audit every un-flagging
"""

import os, sys, json, gzip, math, argparse, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = importlib.util.spec_from_file_location(
    'central_countries', os.path.join(HERE, 'central_countries.py'))
CC = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(CC)

GRID_DEG = 0.25


def load_recs():
    out = {}
    bdir = os.path.join(ROOT, 'data/besselian')
    for f in sorted(os.listdir(bdir)):
        if f.endswith('.json'):
            with open(os.path.join(bdir, f), encoding='utf8') as fh:
                for r in json.load(fh):
                    out[str(int(r['cat_no']))] = r
    return out


def peak(rec, C):
    """Highest eclipse magnitude anywhere in the country, and where."""
    cl = CC.centreline(rec)
    if not cl:
        return 0.0, None
    pad = CC.corridor_pad_deg(rec)
    w, s, e, n = C['bbox']
    near = [p for p in cl
            if s - pad <= p[0] <= n + pad and
            (w - pad <= p[1] <= e + pad or
             CC.lon_delta(p[1], w) <= pad or CC.lon_delta(p[1], e) <= pad)]
    if not near:
        return 0.0, None
    t_lo = max(min(p[2] for p in near) - 0.5, rec['tmin'])
    t_hi = min(max(p[2] for p in near) + 0.5, rec['tmax'])

    cands = []
    # every centreline point that falls inside the country
    for (la, lo, _t) in near:
        if CC.pt_in_rings(C['rings'], la, lo):
            return 1.0, (la, lo)
    # the whole border, densified
    for ring in C['rings']:
        prev = None
        for v in ring:
            if prev is not None and CC.km(prev, v) > 10.0:
                steps = int(CC.km(prev, v) / 10.0) + 1
                for k in range(1, steps):
                    f = k / steps
                    cands.append((prev[0] + (v[0] - prev[0]) * f,
                                  prev[1] + (v[1] - prev[1]) * f))
            cands.append(v)
            prev = v
    # an interior grid
    la = s
    while la <= n:
        lo = w
        while lo <= e:
            if CC.pt_in_rings(C['rings'], la, lo):
                cands.append((la, lo))
            lo += GRID_DEG
        la += GRID_DEG

    best = 0.0
    bp = None
    for (la, lo) in cands:
        for (cla, clo, _t) in near:
            if abs(la - cla) <= pad and CC.lon_delta(lo, clo) <= pad:
                break
        else:
            continue
        m = CC.max_mag(rec, la, lo, t_lo, t_hi)
        if m > best:
            best, bp = m, (la, lo)
        if best >= 1.0:
            return best, bp
    if bp is None:
        return 0.0, None

    la, lo = bp
    step = 0.10
    for _ in range(60):
        moved = False
        for dla in (-step, 0.0, step):
            for dlo in (-step, 0.0, step):
                if dla == 0.0 and dlo == 0.0:
                    continue
                if not CC.pt_in_rings(C['rings'], la + dla, lo + dlo):
                    continue
                m = CC.max_mag(rec, la + dla, lo + dlo, t_lo, t_hi)
                if m > best:
                    best, la, lo, moved = m, la + dla, lo + dlo, True
                    if best >= 1.0:
                        return best, (la, lo)
        if not moved:
            step *= 0.5
            if step < 5e-5:
                break
    return best, (la, lo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cat')
    ap.add_argument('--country')
    ap.add_argument('--pairs')
    ap.add_argument('--check-removals', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--skip', type=int, default=0)
    args = ap.parse_args()

    countries = CC.load_countries()
    names = [c['name'] for c in countries]
    recs = load_recs()

    pairs = []
    if args.cat and args.country:
        pairs.append((args.cat, args.country))
    elif args.pairs:
        with open(args.pairs, encoding='utf8') as fh:
            for line in fh:
                line = line.rstrip('\n')
                if line.strip():
                    a, b = line.split('\t')
                    pairs.append((a, b))
    elif args.check_removals:
        with gzip.open(os.path.join(ROOT, 'data/central_countries.json.gz'), 'rt') as fh:
            new = json.load(fh)['central']
        with gzip.open(os.path.join(ROOT, 'data/country_index.json.gz'), 'rt') as fh:
            old = json.load(fh)['index']
        for k, v in new.items():
            o = set(int(i) for i, x in (old.get(k) or {}).items() if x < 0)
            for i in sorted(o - set(v)):
                pairs.append((k, names[i]))
    else:
        ap.error('need --cat/--country, --pairs, or --check-removals')

    if args.skip:
        pairs = pairs[args.skip:]
    if args.limit:
        pairs = pairs[:args.limit]

    bad = 0
    for cat, cname in pairs:
        rec = recs.get(cat)
        if rec is None or cname not in names:
            print('%s\t%s\tUNKNOWN' % (cat, cname))
            continue
        C = countries[names.index(cname)]
        m, p = peak(rec, C)
        verdict = 'CENTRAL' if m >= 1.0 else 'not central'
        if m >= 1.0:
            bad += 1
        loc = '' if p is None else ' at %.3f,%.3f' % p
        print('%s\t%-28s\t%.5f\t%s%s' % (cat, cname, m, verdict, loc), flush=True)
    print('# %d of %d reach magnitude 1' % (bad, len(pairs)))


if __name__ == '__main__':
    main()
