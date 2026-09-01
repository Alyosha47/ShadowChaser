#!/usr/bin/env python3
"""build_country_index.py — assemble data/country_index.json.gz.

Takes the two computed tables and writes the file the app reads:

    data/obscuration_countries.json.gz   how much sun was covered  (magnitude)
    data/central_countries.json.gz       did the umbra cross it     (sign)

Encoding, unchanged from gen_country_index.js: obscuration/5 rounded, 4..20,
where 20 is 100%. A NEGATIVE value means the central path crossed that country.
Total eclipses are lifted to 100% where central, same rule as before.

The country name list and __meta are carried over from the existing index so
country order cannot drift.

    python3 "data build tools/build_country_index.py"
    python3 "data build tools/build_country_index.py" --dry-run
"""

import os, json, gzip, time, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUCKET = 5
FULL = round(100 / BUCKET)
FLOOR = 20


def load(p):
    with gzip.open(p, 'rt', encoding='utf8') as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--obsc', default=os.path.join(ROOT, 'data/obscuration_countries.json.gz'))
    ap.add_argument('--central', default=os.path.join(ROOT, 'data/central_countries.json.gz'))
    ap.add_argument('--brute', default=os.path.join(ROOT, 'data/obscuration_brute.json.gz'),
                    help='second obscuration table; the higher reading wins')
    ap.add_argument('--no-brute', dest='brute', action='store_const', const=None)
    ap.add_argument('--index', default=os.path.join(ROOT, 'data/country_index.json.gz'))
    ap.add_argument('--out')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    obsc = load(args.obsc)['obscuration']

    # Both obscuration tables measure real points, so neither can overstate:
    # a reading of X proves some point in that country reaches X. Every error
    # either finds is a MISS, always too low. So where two independently
    # computed tables are available, the higher reading is the better one,
    # entry by entry. They fail in different places -- the fast search misses
    # peaks its seeding never looked at, the brute grid steps over peaks
    # narrower than its spacing -- and both fail most often at high latitude.
    if args.brute and os.path.exists(args.brute):
        other = load(args.brute)['obscuration']
        gained = raised = 0
        for cat, row in other.items():
            mine = obsc.setdefault(cat, {})
            for ci, v in row.items():
                v = abs(int(v))
                if ci not in mine:
                    mine[ci] = v
                    gained += 1
                elif v > abs(int(mine[ci])):
                    mine[ci] = v
                    raised += 1
        print('merged in %s: %d entries added, %d raised'
              % (os.path.basename(args.brute), gained, raised))
    central = load(args.central)['central']
    old = load(args.index)
    names = old['names']

    typeof = {}
    bdir = os.path.join(ROOT, 'data/besselian')
    for f in sorted(os.listdir(bdir)):
        if f.endswith('.json'):
            with open(os.path.join(bdir, f), encoding='utf8') as fh:
                for r in json.load(fh):
                    typeof[str(int(r['cat_no']))] = str(r.get('eclipse_type') or '')[:1]

    index = {}
    for cat, row in obsc.items():
        hits = set(str(i) for i in central.get(cat, []))
        is_total = typeof.get(cat) == 'T'
        out = {}
        for ci, v in row.items():
            v = abs(int(v))
            if ci in hits:
                out[ci] = -(FULL if is_total else v)
            elif v * BUCKET >= FLOOR:
                out[ci] = v
        # a country the umbra crossed must appear even if the sampling missed it
        for ci in hits:
            if ci not in out:
                out[ci] = -FULL
        if out:
            index[cat] = out

    o = old['index']
    n_old = sum(len(r) for r in o.values())
    n_new = sum(len(r) for r in index.values())
    c_old = sum(1 for r in o.values() for v in r.values() if v < 0)
    c_new = sum(1 for r in index.values() for v in r.values() if v < 0)
    lower = sum(1 for cat, r in index.items() for ci, v in r.items()
                if ci in o.get(cat, {}) and abs(v) < abs(o[cat][ci]))
    dropped = sum(1 for cat, r in o.items() for ci in r
                  if ci not in index.get(cat, {}))
    print('eclipses      %d -> %d' % (len(o), len(index)))
    print('entries       %d -> %d' % (n_old, n_new))
    print('central       %d -> %d' % (c_old, c_new))
    print('went DOWN     %d   (each one needs checking)' % lower)
    print('disappeared   %d' % dropped)

    if args.dry_run:
        return
    payload = {'__meta': dict(old.get('__meta') or {}), 'names': names, 'index': index}
    payload['__meta'].update({
        'built': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'obscuration_source': 'obscuration_countries.py',
        'central_source': 'central_countries.py',
        'bucket': BUCKET, 'floor': FLOOR})
    dest = args.out or args.index
    with gzip.open(dest, 'wt', encoding='utf8') as fh:
        json.dump(payload, fh)
    print('wrote %s' % dest)


if __name__ == '__main__':
    main()
