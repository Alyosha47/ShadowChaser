#!/usr/bin/env python3
"""Read-only catalog audit of generated path chunks.

Complements the generator's own in-run AUDIT pass, which checks only vertex
GAPS (>350 km) and INTERIOR TURNS (>30 deg) on curves that already exist. A
limb that is missing entirely, or reduced to a 2-point stub, passes that pass
silently -- audit_curve() returns early on len < 2 and a 2-point line has no
interior vertex to turn at. That is exactly how the 2028/2041 regression hid.

So this adds the three structural checks the generator cannot make:

  STUB     a two-limit central eclipse with a missing or <3-point umbral limb
  ONELIMB  a one-limit central eclipse with no umbral limb at all
  ASYM     a two-limit central eclipse whose N and S limbs differ grossly in
           great-circle length, with no type-code reason to

Classification follows the generator verbatim (gen_eclipse_paths.py):
    is_central  = type[0] in T A H
    one_limit   = is_central and type[1] in n s - +
    a real limb = >= 3 points summed across its segments
so the audit and the builder cannot drift apart on what they mean by a limb.

No ground truth is consulted. This surfaces SUSPICIOUS eclipses by internal
consistency; each hit is then eyeballed against Jubier.

Usage:  python3 "data build tools/audit_paths.py" [--paths-dir data/paths]
                                                  [--asym N] [--report FILE]
Exit status is 0 whether or not anomalies are found -- it is a report, not a
gate that fails a build.
"""

import argparse
import glob
import gzip
import json
import math
import os
from collections import defaultdict

DEG = math.pi / 180.0
MIN_LIMB_PTS = 3      # the generator's own _present() threshold
ASYM_RATIO = 10.0     # longer limb / shorter limb, by great-circle length


def gc_km(a, b):
    """Great-circle distance in km between [lon, lat] points."""
    la1, la2 = a[1] * DEG, b[1] * DEG
    dl = (((b[0] - a[0] + 180.0) % 360.0) - 180.0) * DEG
    h = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin(dl / 2) ** 2)
    return 6371.0 * 2.0 * math.asin(min(1.0, math.sqrt(abs(h))))


def seg_len_km(segs):
    """Summed great-circle length of a list of polyline segments."""
    total = 0.0
    for seg in segs or []:
        for i in range(len(seg) - 1):
            total += gc_km(seg[i], seg[i + 1])
    return total


def n_pts(segs):
    return sum(len(s) for s in (segs or []))


def audit_record(v, asym_ratio=ASYM_RATIO):
    """Return a list of (code, detail) anomalies for one eclipse record."""
    et = v.get('type') or '?'
    is_central = bool(et) and et[0] in ('T', 'A', 'H')
    if not is_central:
        return []
    one_limit = len(et) > 1 and et[1] in ('n', 's', '-', '+')

    un, us = v.get('umbra_n'), v.get('umbra_s')
    pn, ps = n_pts(un), n_pts(us)
    has_n, has_s = pn >= MIN_LIMB_PTS, ps >= MIN_LIMB_PTS
    hits = []

    if one_limit:
        # Exactly one umbral edge meets Earth. None at all is the failure.
        if not (has_n or has_s):
            hits.append(('ONELIMB', f'no umbral limb (n={pn} s={ps} pts)'))
        return hits

    # Two-limit central eclipse: both limbs must exist.
    if not has_n or not has_s:
        missing = 'N' if not has_n else ''
        missing += 'S' if not has_s else ''
        hits.append(('STUB', f'limb {missing} missing/stub (n={pn} s={ps} pts)'))
        return hits          # asymmetry is meaningless once a limb is gone

    ln, ls = seg_len_km(un), seg_len_km(us)
    lo, hi = min(ln, ls), max(ln, ls)
    if lo > 0 and hi / lo > asym_ratio:
        hits.append(('ASYM', f'N {ln:.0f} km vs S {ls:.0f} km '
                             f'(ratio {hi / lo:.1f}x)'))
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--paths-dir', default='data/paths')
    ap.add_argument('--asym', type=float, default=ASYM_RATIO,
                    help='flag N/S length ratio above this (default 10)')
    ap.add_argument('--report', default=None,
                    help='also write the report to this file')
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.paths_dir, '*.json.gz')))
    if not files:
        raise SystemExit(f'no chunks found in {args.paths_dir}')

    lines = []
    def out(s=''):
        print(s)
        lines.append(s)

    total = 0
    central = 0
    by_type = defaultdict(int)
    hits = []
    gen_of = {}

    for f in files:
        with gzip.open(f) as fh:
            chunk = json.load(fh)
        meta = chunk.get('__meta') or {}
        gen_of[os.path.basename(f)] = meta.get('generator') or 'unknown'
        for k, v in chunk.items():
            if k == '__meta':
                continue
            total += 1
            et = v.get('type') or '?'
            by_type[et] += 1
            if et and et[0] in ('T', 'A', 'H'):
                central += 1
            for code, detail in audit_record(v, args.asym):
                hits.append((code, v.get('year'), v.get('month'), v.get('day'),
                             et, v.get('cat_no'), detail))

    # A chunk left behind by an older generator serves stale curves silently --
    # the "missing path" saga was exactly this. Majority version wins.
    tally = defaultdict(int)
    for g in gen_of.values():
        tally[g] += 1
    current = max(tally, key=lambda g: tally[g])
    stale = sorted(n for n, g in gen_of.items() if g != current)

    out(f'chunks    : {len(files)}')
    out(f'generator : {current}')
    out(f'eclipses  : {total}   central (T/A/H): {central}')
    out(f'asym ratio: {args.asym}x    limb threshold: {MIN_LIMB_PTS} pts')
    out()

    if stale:
        out(f'STALE CHUNKS ({len(stale)}) -- not built by {current}:')
        for n in stale:
            out(f'  {n}  ({gen_of[n]})')
        out()

    if not hits:
        out('NO ANOMALIES. Every central eclipse has the umbral limbs its '
            'type code implies, and no two-limit eclipse is grossly '
            'asymmetric.')
    else:
        counts = defaultdict(int)
        for h in hits:
            counts[h[0]] += 1
        out('ANOMALIES: ' + '  '.join(f'{c}={n}' for c, n in
                                      sorted(counts.items())))
        out()
        for code, y, m, d, et, cat, detail in sorted(hits,
                                                     key=lambda h: (h[0], h[1])):
            out(f'  {code:8s} {y:>5d}-{m:02d}-{d:02d}  {et:<3s} '
                f'cat {cat}  {detail}')

    out()
    out('type census:')
    for t, n in sorted(by_type.items(), key=lambda x: -x[1]):
        out(f'  {t:<3s} {n:>5d}')

    if args.report:
        with open(args.report, 'w') as fh:
            fh.write('\n'.join(lines) + '\n')
        print(f'\nreport written to {args.report}')


if __name__ == '__main__':
    main()
