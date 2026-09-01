#!/usr/bin/env python3
"""apply_exact_corrections.py — apply only the raises from an exact run.

A reading is a measurement of a real point, so it can only ever be too LOW,
never too high. That makes the direction of a disagreement meaningful:

  * exact reads HIGHER  -> it found a point the table missed. A real fix.
  * exact reads LOWER   -> the exact pass missed a point the table found.
                           The table is right. Ignore it.

So this applies raises and ignores drops, and says how many of each it saw.
"""
import json, gzip, argparse, os

ap = argparse.ArgumentParser()
ap.add_argument('--fixes', default='data/exact_corrections.json')
ap.add_argument('--index', default='data/country_index.json.gz')
ap.add_argument('--dry-run', action='store_true')
a = ap.parse_args()

fixes = json.load(open(a.fixes, encoding='utf8'))
d = json.load(gzip.open(a.index, 'rt', encoding='utf8'))
idx = d['index']

raised = dropped = missing = 0
for f in fixes:
    row = idx.get(f['cat'])
    if row is None or f['country'] not in row:
        missing += 1
        continue
    cur = row[f['country']]
    # Both conditions: the exact pass must have read higher than the value it
    # was checking, AND higher than whatever is in the index now. The second
    # guard stops the file being applied to a different build of the table.
    if f['is'] > f['was'] and f['is'] > abs(cur):
        row[f['country']] = -f['is'] if cur < 0 else f['is']
        raised += 1
        print('  raise  cat %-7s %-24s %d -> %d  (%.1f%%)'
              % (f['cat'], f['name'], f['was'], f['is'], f['percent']))
    else:
        dropped += 1

print('\n%d raised (real finds), %d lower readings ignored, %d not in index'
      % (raised, dropped, missing))
if not a.dry_run:
    json.dump(d, gzip.open(a.index, 'wt', encoding='utf8'))
    print('wrote %s' % a.index)
