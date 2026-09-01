#!/usr/bin/env python3
"""spot_check_exact.py — does the exact method agree with the table?

Picks entries at random from country_index.json.gz, works each one out from
scratch with obscuration_exact.py, and prints both side by side. No numbers to
remember and nothing to look up: the table supplies the expected answer.

    python3 "data build tools/spot_check_exact.py"            # 12 entries
    python3 "data build tools/spot_check_exact.py" --n 40
    python3 "data build tools/spot_check_exact.py" --big       # large countries

A disagreement where the exact method reads HIGHER is a real find: every value
in the table came from a measured point, so it can only ever be too low. A
disagreement where it reads LOWER means the exact method missed something and
is itself the thing at fault.
"""

import os, sys, json, gzip, random, argparse, importlib.util, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = importlib.util.spec_from_file_location(
    'obscuration_exact', os.path.join(HERE, 'obscuration_exact.py'))
EX = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(EX)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=12)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--big', action='store_true',
                    help='only countries with complicated coastlines')
    ap.add_argument('--index', default=os.path.join(ROOT, 'data/country_index.json.gz'))
    args = ap.parse_args()

    with gzip.open(args.index, 'rt') as fh:
        d = json.load(fh)
    names = d['names']
    countries = EX.CC.load_countries()
    recs = EX.load_recs()

    pool = []
    big = set()
    if args.big:
        for i, C in enumerate(countries):
            if len(C['rings']) >= 60 or len(EX.edges(C)) >= 1500:
                big.add(str(i))
    for cat, row in d['index'].items():
        if cat not in recs:
            continue
        for ci, v in row.items():
            if args.big and ci not in big:
                continue
            pool.append((cat, ci, abs(int(v))))
    if not pool:
        print('nothing to check')
        return

    random.seed(args.seed or int(time.time()))
    sample = random.sample(pool, min(args.n, len(pool)))

    agree = higher = lower = 0
    for (cat, ci, claimed) in sample:
        t0 = time.time()
        v = EX.peak(recs[cat], countries[int(ci)])
        got = EX.OC.js_round(v / EX.BUCKET)
        if got == claimed:
            verdict = 'agrees'
            agree += 1
        elif got > claimed:
            verdict = 'HIGHER -- table was missing a peak'
            higher += 1
        else:
            verdict = 'LOWER  -- exact method missed something'
            lower += 1
        print('%-7s %-26s table %2d   exact %2d (%.1f%%)  %-38s %.0fs'
              % (cat, names[int(ci)], claimed, got, v, verdict, time.time() - t0),
              flush=True)

    print('\n%d agree, %d exact higher, %d exact lower, out of %d'
          % (agree, higher, lower, len(sample)))
    if lower:
        print('the exact method has a bug -- do not run a full pass yet')
    elif higher:
        print('the table has %d wrong entries; a full pass is worth running' % higher)
    else:
        print('no disagreements in this sample')


if __name__ == '__main__':
    main()
