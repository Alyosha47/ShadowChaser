#!/usr/bin/env python3
"""apply_central.py — write the central-path flags into country_index.json.gz.

Reads data/central_countries.json.gz (built by central_countries.py) and sets
the sign of every entry in data/country_index.json.gz to match it. Obscuration
magnitudes are never changed except where a country is central but was absent
from the row, or where a total eclipse's central entry has to be lifted to
100% -- both rules copied from gen_country_index.js so this stays consistent
with a full regenerate.

    value = obscuration / 5, range 4..20  (20 = 100%)
    NEGATIVE = the umbral path crossed this country

Usage
    python3 "data build tools/apply_central.py"            # writes in place
    python3 "data build tools/apply_central.py" --dry-run   # report only
"""

import os, sys, json, gzip, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUCKET = 5
FULL = round(100 / BUCKET)          # 20


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--central', default=os.path.join(ROOT, 'data/central_countries.json.gz'))
    ap.add_argument('--index', default=os.path.join(ROOT, 'data/country_index.json.gz'))
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    with gzip.open(args.central, 'rt', encoding='utf8') as fh:
        central = json.load(fh)['central']
    with gzip.open(args.index, 'rt', encoding='utf8') as fh:
        payload = json.load(fh)
    index = payload['index']
    names = payload['names']

    # eclipse type per cat_no, for the total-eclipse lift rule
    typeof = {}
    bdir = os.path.join(ROOT, 'data/besselian')
    for f in sorted(os.listdir(bdir)):
        if not f.endswith('.json'):
            continue
        with open(os.path.join(bdir, f), encoding='utf8') as fh:
            for r in json.load(fh):
                typeof[str(int(r['cat_no']))] = str(r.get('eclipse_type') or '')[:1]

    added = removed = created = lifted = 0
    touched = set()

    for cat, hits in central.items():
        row = index.get(cat)
        if row is None:
            if hits:
                row = index[cat] = {}
            else:
                continue
        want = set(str(i) for i in hits)
        is_total = typeof.get(cat) == 'T'

        for ci in list(row.keys()):
            v = row[ci]
            if ci in want:
                if v > 0:
                    added += 1
                    touched.add(cat)
                mag = FULL if is_total else abs(v)
                if is_total and abs(v) != FULL:
                    lifted += 1
                row[ci] = -abs(mag)
            else:
                if v < 0:
                    removed += 1
                    touched.add(cat)
                row[ci] = abs(v)

        for ci in want:
            if ci not in row:
                row[ci] = -FULL
                created += 1
                added += 1
                touched.add(cat)

    print('eclipses changed      : %d' % len(touched))
    print('countries made central: %d  (of which newly added rows: %d)' % (added, created))
    print('countries un-flagged  : %d' % removed)
    print('total entries lifted  : %d' % lifted)

    if args.dry_run:
        return

    meta = payload.setdefault('__meta', {})
    meta['central_source'] = 'central_countries.py'
    with gzip.open(args.index, 'wt', encoding='utf8') as fh:
        json.dump(payload, fh)
    print('wrote %s' % args.index)


if __name__ == '__main__':
    main()
