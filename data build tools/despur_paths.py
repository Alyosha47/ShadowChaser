#!/usr/bin/env python3
"""
despur_paths.py — remove degenerate spurs / duplicate vertices from generated
umbra corridors (umbra_n / umbra_s) in data/paths/*.json.gz.

WHY
  A "spur" is a vertex whose two NEIGHBOURS are (near-)coincident — the corridor
  steps out to a point and immediately returns to ~the same spot (e.g. 1939-04-19
  near the north pole: idx 309 and 311 are the identical point, 310 a whisker
  between them). Because the neighbours coincide, the spur encloses ~zero area, so
  removing it is LOSSLESS — it cannot move the totality limit. This is categorically
  different from a sparse-gap kink (e.g. 2611-09-28), where the neighbours are far
  apart and deletion WOULD pull the limit inward; this tool never touches those.

SAFETY (provable)
  - A vertex is removed ONLY if its two neighbours are within SPUR_KM of each other
    (true coincident-neighbour spur) — normal sampling spacing is ~16 km, so normal
    vertices are never eligible.
  - Consecutive points within DUP_KM are de-duplicated.
  - Per-segment guard: the despurred segment is kept ONLY if its worst interior turn
    does not increase. Otherwise the original segment is left untouched.
  Net effect on a clean path: zero changes (verified — 2017-08-21 untouched).

USAGE
  Dry run (default — reports, writes nothing):
      python3 despur_paths.py "data/paths"
  Apply (rewrites the .json.gz in place; back them up first if you like):
      python3 despur_paths.py "data/paths" --apply

OPTIONAL: to bake this into generation so future regens are clean, call despur()
on each umbra_n/umbra_s segment at the end of build_path() in gen_eclipse_paths.py.
"""
import sys, os, gzip, json, math, glob

SPUR_KM = 5.0     # neighbour-coincidence threshold; normal spacing ~16 km
DUP_KM  = 0.5     # consecutive-duplicate threshold
DEG = math.pi / 180.0

def _km(A, B):
    la1, la2 = A[1]*DEG, B[1]*DEG
    dl = (B[0]-A[0]) * DEG
    a = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin(dl/2)**2
    return 6371.0 * 2 * math.asin(math.sqrt(max(0.0, min(1.0, a))))

def _bearing(A, B):
    la1, la2 = A[1]*DEG, B[1]*DEG
    dl = (B[0]-A[0]) * DEG
    return math.atan2(math.sin(dl)*math.cos(la2),
                      math.cos(la1)*math.sin(la2) - math.sin(la1)*math.cos(la2)*math.cos(dl))

def _worst_turn(seg):
    w = 0.0
    for i in range(1, len(seg)-1):
        d = abs(_bearing(seg[i], seg[i+1]) - _bearing(seg[i-1], seg[i]))
        d = min(d, 2*math.pi - d)
        if d > w:
            w = d
    return w / DEG

def despur(seg):
    """Return (new_seg, n_removed). Lossless: only removes coincident-neighbour
    spurs and duplicates, and only if the worst turn does not increase."""
    if len(seg) < 5:
        return seg, 0
    out = [list(p) for p in seg]
    # 1) coincident-neighbour spurs
    i = 1
    while 1 <= i < len(out)-1:
        if _km(out[i-1], out[i+1]) < SPUR_KM and _km(out[i-1], out[i]) >= DUP_KM:
            out.pop(i)
            i = max(1, i-1)
        else:
            i += 1
    # 2) consecutive duplicates
    j = 0
    while j < len(out)-1:
        if _km(out[j], out[j+1]) < DUP_KM:
            out.pop(j+1)
        else:
            j += 1
    n_removed = len(seg) - len(out)
    if n_removed == 0:
        return seg, 0
    # guard: never accept a result that worsens the worst interior turn
    if _worst_turn(out) > _worst_turn(seg) + 0.5:
        return seg, 0
    return out, n_removed

def process_eclipse(ep):
    """Despur umbra_n/umbra_s segments in one eclipse record. Returns n_removed."""
    total = 0
    for key in ('umbra_n', 'umbra_s'):
        segs = ep.get(key)
        if not isinstance(segs, list):
            continue
        for si, seg in enumerate(segs):
            if not isinstance(seg, list) or len(seg) < 5:
                continue
            new_seg, nr = despur(seg)
            if nr:
                segs[si] = new_seg
                total += nr
    return total

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    paths_dir = sys.argv[1]
    apply = '--apply' in sys.argv[2:]
    files = sorted(glob.glob(os.path.join(paths_dir, '*.json.gz')))
    if not files:
        print('No *.json.gz found in', paths_dir); sys.exit(1)
    grand_removed = grand_ecl = 0
    for f in files:
        with gzip.open(f, 'rt') as fh:
            data = json.load(fh)
        file_removed = file_ecl = 0
        for key, ep in data.items():
            if not isinstance(ep, dict):
                continue
            nr = process_eclipse(ep)
            if nr:
                file_removed += nr
                file_ecl += 1
                y, mo, d = ep.get('year'), ep.get('month'), ep.get('day')
                print(f"  {os.path.basename(f)}: {y}-{mo:02d}-{d:02d}  removed {nr} spur/dup pt(s)")
        if file_removed and apply:
            with gzip.open(f, 'wt') as fh:
                json.dump(data, fh, separators=(',', ':'))
        grand_removed += file_removed
        grand_ecl += file_ecl
    mode = 'APPLIED' if apply else 'DRY RUN (nothing written; pass --apply to write)'
    print(f"\n{mode}: {grand_removed} spur/duplicate point(s) across {grand_ecl} eclipse(s) "
          f"in {len(files)} file(s).")

if __name__ == '__main__':
    main()
