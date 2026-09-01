#!/usr/bin/env python3
"""compare_obscuration.py — do the two independent tables agree?

    python3 "data build tools/compare_obscuration.py"

Prints how many entries differ, in which direction, and the worst offenders.
Any disagreement is a bug in one of them; the brute-force table is the one to
trust when they differ, because it has no seeding heuristic to get wrong.
"""

import os, json, gzip, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def load(p):
    with gzip.open(p, 'rt', encoding='utf8') as fh:
        return json.load(fh)['obscuration']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fast', default=os.path.join(ROOT, 'data/obscuration_countries.json.gz'))
    ap.add_argument('--brute', default=os.path.join(ROOT, 'data/obscuration_brute.json.gz'))
    ap.add_argument('--index', default=os.path.join(ROOT, 'data/country_index.json.gz'))
    ap.add_argument('--show', type=int, default=25)
    args = ap.parse_args()

    fast = load(args.fast)
    brute = load(args.brute)
    with gzip.open(args.index, 'rt') as fh:
        names = json.load(fh)['names']

    cats = sorted(set(fast) | set(brute))
    same = fast_low = fast_high = only_fast = only_brute = 0
    worst = []
    for cat in cats:
        f = fast.get(cat, {})
        b = brute.get(cat, {})
        for ci in set(f) | set(b):
            fv, bv = f.get(ci), b.get(ci)
            if fv is None:
                only_brute += 1
                worst.append((abs(bv), cat, ci, '-', bv))
            elif bv is None:
                only_fast += 1
                worst.append((abs(fv), cat, ci, fv, '-'))
            elif fv == bv:
                same += 1
            else:
                if abs(fv) < abs(bv):
                    fast_low += 1
                else:
                    fast_high += 1
                worst.append((abs(abs(fv) - abs(bv)), cat, ci, fv, bv))

    total = same + fast_low + fast_high + only_fast + only_brute
    print('entries compared    %d' % total)
    print('identical           %d  (%.3f%%)' % (same, 100.0 * same / max(total, 1)))
    print('fast LOWER          %d   <- fast version missing peaks' % fast_low)
    print('fast HIGHER         %d   <- brute grid stepped over a peak' % fast_high)
    print('only in fast        %d' % only_fast)
    print('only in brute       %d' % only_brute)

    if worst:
        worst.sort(reverse=True)
        print('\nbiggest disagreements:')
        for (_d, cat, ci, fv, bv) in worst[:args.show]:
            nm = names[int(ci)] if int(ci) < len(names) else ci
            print('  cat %-7s %-26s fast %-4s brute %-4s' % (cat, nm, fv, bv))


if __name__ == '__main__':
    main()
