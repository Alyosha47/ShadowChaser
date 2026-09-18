#!/usr/bin/env python3
"""check_regen.py -- compare a freshly generated path catalogue with the deployed one.

Read-only. Run it after a full regeneration, BEFORE deploying:

    python3 "data build tools/check_regen.py" --new data/paths --base /path/to/deployed/paths

Four sections, each a plain report:

  A. INVENTORY  same chunks, same eclipses, same fields; generator version of every chunk.
  B. STRUCTURE  audit_paths.py's checks (STUB / ONELIMB / ASYM), umbral steps > 250 km, a limb
                stored twice, more than two segments on one side -- listed only where the NEW
                data is worse than the base.
  C. CHANGE     for every eclipse and curve, how far the new curve moved from the old one
                (sampled vertices -> nearest old segment), bucketed, with the largest movers;
                umbral limits whose N/S names swapped; every curve that appeared or disappeared.
  D. JUBIER     every KMZ in --kmz-dir: median and worst distance, old and new, per curve,
                with Jubier's DeltaT difference removed (HANDOFF sec. 9.5).

Nothing here decides pass/fail by itself: large movers are expected where the generator was
wrong (the 33 former chord eclipses, polar limits). The report is read, and movers are rendered
and looked at, before anything ships.
"""
import argparse, glob, gzip, json, math, os, re, sys, zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import audit_paths as AP        # noqa: E402
import validate_paths as VP     # noqa: E402

try:
    import numpy as np
except ImportError:
    sys.exit('check_regen.py needs numpy (pip install numpy)')

DEG = math.pi / 180.0
R_KM = 6371.0
SEG_CURVES = ('centreline', 'umbra_n', 'umbra_s', 'penumbra_n', 'penumbra_s',
              'terminator_first', 'terminator_last')
FLAT_CURVES = ('green_curve',)          # flat [lon,lat] list with None delimiters
DT_DEG_PER_S = 0.0041780746


def load_dir(d):
    out = {}
    for f in sorted(glob.glob(os.path.join(d, '*.json.gz'))):
        with gzip.open(f) as fh:
            out[os.path.basename(f)] = json.load(fh)
    if not out:
        sys.exit(f'no chunks in {d}')
    return out


def tag(r):
    return f"{r['year']}-{r['month']:02d}-{r['day']:02d} {r.get('type', '?')}"


def segments(r, field):
    v = r.get(field)
    if not v:
        return []
    if field in FLAT_CURVES:
        segs, cur = [], []
        for p in v:
            if p is None or p[0] is None:
                if len(cur) > 1: segs.append(cur)
                cur = []
            else:
                cur.append(p)
        if len(cur) > 1: segs.append(cur)
        return segs
    return [s for s in v if len(s) > 1]


def unit(pts):
    a = np.asarray(pts, dtype=float) * DEG
    return np.stack([np.cos(a[:, 1]) * np.cos(a[:, 0]),
                     np.cos(a[:, 1]) * np.sin(a[:, 0]),
                     np.sin(a[:, 1])], axis=1)


def shift_km(new_segs, old_segs, samples=12):
    """Largest distance (km) from sampled new vertices to the old curve's segments."""
    if not new_segs or not old_segs:
        return None
    pts = [p for s in new_segs for p in s]
    pts = pts[::max(1, len(pts) // samples)]
    P = unit(pts)
    best = np.full(len(P), np.inf)
    for s in old_segs:
        A = unit(s[:-1]); B = unit(s[1:])
        n = np.cross(A, B); nn = np.linalg.norm(n, axis=1)
        ok = nn > 1e-15
        # distance to each vertex
        dv = np.arccos(np.clip(P @ unit(s).T, -1, 1))            # (np, nv)
        dmin = dv.min(axis=1)
        if ok.any():
            nu = n[ok] / nn[ok][:, None]
            xt = np.arcsin(np.clip(P @ nu.T, -1, 1))             # cross-track (np, ns)
            # foot of perpendicular lies within the segment?
            ca = np.clip(P @ A[ok].T, -1, 1); cb = np.clip(P @ B[ok].T, -1, 1)
            cxt = np.maximum(np.cos(xt), 1e-15)
            at = np.arccos(np.clip(ca / cxt, -1, 1)); bt = np.arccos(np.clip(cb / cxt, -1, 1))
            ab = np.arccos(np.clip(np.sum(A[ok] * B[ok], axis=1), -1, 1))
            inside = (at <= ab[None, :] + 1e-12) & (bt <= ab[None, :] + 1e-12)
            dseg = np.where(inside, np.abs(xt), np.inf).min(axis=1)
            dmin = np.minimum(dmin, dseg)
        best = np.minimum(best, dmin)
    return float(best.max()) * R_KM


def longest_step_km(segs):
    w = 0.0
    for s in segs:
        if len(s) < 2: continue
        U = unit(s)
        d = np.arccos(np.clip(np.sum(U[:-1] * U[1:], axis=1), -1, 1)).max() * R_KM
        w = max(w, float(d))
    return w


def structure_issues(r):
    out = []
    for code, detail in AP.audit_record(r):
        out.append(f'{code}: {detail}')
    for f in ('umbra_n', 'umbra_s'):
        segs = r.get(f) or []
        if segs and longest_step_km(segs) > 250:
            out.append(f'{f} step {longest_step_km(segs):.0f} km')
        ends = [(tuple(s[0]), tuple(s[-1])) for s in segs if s]
        if len(set(ends)) < len(ends):
            out.append(f'{f} has a segment stored twice')
        if len(segs) > 2:
            out.append(f'{f} has {len(segs)} segments')
    return out


def section_a(new, base):
    print('== A. INVENTORY')
    ok = True
    if set(new) != set(base):
        ok = False
        print('  chunk sets differ: only new', sorted(set(new) - set(base)),
              'only base', sorted(set(base) - set(new)))
    gens = defaultdict(int)
    for n, c in new.items():
        gens[(c.get('__meta') or {}).get('generator', 'unknown')] += 1
    print('  new generator versions:', dict(gens))
    for n in sorted(set(new) & set(base)):
        kn = set(new[n]) - {'__meta'}; kb = set(base[n]) - {'__meta'}
        if kn != kb:
            ok = False
            print(f'  {n}: eclipses differ (only new {len(kn - kb)}, only base {len(kb - kn)})')
            continue
        for k in kn:
            if set(new[n][k]) != set(base[n][k]):
                ok = False
                print(f'  {n} {tag(new[n][k])}: field set differs')
    print('  inventory', 'OK' if ok else 'HAS DIFFERENCES')


def section_b(new, base):
    print('\n== B. STRUCTURE (issues present in NEW but not in BASE)')
    worse = []
    for n in sorted(set(new) & set(base)):
        for k, r in new[n].items():
            if k == '__meta' or k not in base[n]: continue
            ni = set(structure_issues(r)); bi = set(structure_issues(base[n][k]))
            for i in sorted(ni - bi):
                worse.append(f'  {tag(r)}  {i}')
    print('\n'.join(worse) if worse else '  none')


def section_c(new, base, top=12):
    print('\n== C. CHANGE vs BASE (largest vertex shift per eclipse, km)')
    buckets = ('< 0.1', '0.1-1', '1-10', '10-100', '> 100')
    counts = {f: defaultdict(int) for f in SEG_CURVES + FLAT_CURVES}
    movers = {f: [] for f in SEG_CURVES + FLAT_CURVES}
    appeared, swapped = [], []
    for n in sorted(set(new) & set(base)):
        for k, r in new[n].items():
            if k == '__meta' or k not in base[n]: continue
            b = base[n][k]
            # N/S label swap: 13j named some polar limits the opposite way to Jubier (who names by
            # the side of the shadow's travel, as 17a does). Report a swap as a swap, then compare
            # each new limb with the old limb it actually corresponds to.
            un, us, bn, bs = (segments(r, 'umbra_n'), segments(r, 'umbra_s'),
                              segments(b, 'umbra_n'), segments(b, 'umbra_s'))
            if un and us and bn and bs:
                straight = max(shift_km(un, bn), shift_km(bn, un), shift_km(us, bs), shift_km(bs, us))
                crossed = max(shift_km(un, bs), shift_km(bs, un), shift_km(us, bn), shift_km(bn, us))
                if crossed < straight:
                    swapped.append(f'  {tag(r)}  (limbs {crossed:.1f} km apart once swapped)')
                    b = dict(b); b['umbra_n'], b['umbra_s'] = b['umbra_s'], b['umbra_n']
            for f in SEG_CURVES + FLAT_CURVES:
                sn, sb = segments(r, f), segments(b, f)
                if bool(sn) != bool(sb):
                    appeared.append(f'  {tag(r)}  {f} {"APPEARED" if sn else "DISAPPEARED"}')
                    continue
                if not sn: continue
                d = max(shift_km(sn, sb), shift_km(sb, sn))
                bk = buckets[0] if d < 0.1 else buckets[1] if d < 1 else buckets[2] if d < 10 \
                    else buckets[3] if d < 100 else buckets[4]
                counts[f][bk] += 1
                movers[f].append((d, tag(r)))
    print('  curve              ' + ''.join(f'{b:>9s}' for b in buckets))
    for f in SEG_CURVES + FLAT_CURVES:
        print(f'  {f:18s} ' + ''.join(f'{counts[f][b]:9d}' for b in buckets))
    for f in SEG_CURVES + FLAT_CURVES:
        m = sorted(movers[f], reverse=True)[:top]
        if m and m[0][0] >= 1.0:
            print(f'  largest {f}: ' + '; '.join(f'{t} {d:.1f}' for d, t in m if d >= 1.0))
    print(f'  N/S labels swapped relative to base ({len(swapped)}):')
    print('\n'.join(swapped) if swapped else '  none')
    print('  curves that appeared/disappeared:')
    print('\n'.join(appeared) if appeared else '  none')


def section_d(new, base, kmz_dir, bess_dir):
    print('\n== D. JUBIER (DeltaT removed; median / worst, metres)')
    if not kmz_dir or not os.path.isdir(kmz_dir):
        print('  skipped (no --kmz-dir)'); return
    dt = {}
    for f in glob.glob(os.path.join(bess_dir, '*.json')):
        try: recs = json.load(open(f))
        except Exception: continue
        if isinstance(recs, list):
            for r in recs:
                if isinstance(r, dict) and 'dt' in r:
                    dt[(r['year'], r['month'], r['day'])] = r['dt']
    def find(cat, y, m, d):
        for c in cat.values():
            for k, r in c.items():
                if k != '__meta' and (r['year'], r['month'], r['day']) == (y, m, d):
                    return r
    for kmz in sorted(glob.glob(os.path.join(kmz_dir, '*.kmz'))):
        mm = re.search(r'_(-?\d+)_(\d\d)_(\d\d)', os.path.basename(kmz))
        if not mm: continue
        y, mo, d = int(mm.group(1)), int(mm.group(2)), int(mm.group(3))
        rn, rb = find(new, y, mo, d), find(base, y, mo, d)
        if not rn or not rb or (y, mo, d) not in dt: continue
        z = zipfile.ZipFile(kmz)
        kml = z.read([x for x in z.namelist() if x.endswith('.kml')][0]).decode('utf-8', 'ignore')
        mdt = re.search(r'&Delta;T:&nbsp;(-?[0-9.]+)s', kml) or re.search(r'ΔT:\s*(-?[0-9.]+)s', kml)
        if not mdt: continue
        shift = (dt[(y, mo, d)] - float(mdt.group(1))) * DT_DEG_PER_S
        placemarks = VP.collect_placemarks(VP.open_kml(kmz))
        line = [f'  {y}-{mo:02d}-{d:02d} {rn.get("type", "?"):3s}']
        for ct, (fields, names) in VP.CURVE_TYPES.items():
            seen, jpts = set(), []
            for nm, pts in placemarks:          # exact names, first placemark of each, as validate_paths
                if nm in names and nm not in seen:
                    seen.add(nm)
                    uniq = pts[:-1] if len(pts) > 1 and pts[0] == pts[-1] else pts
                    jpts += [[p[0] + shift, p[1]] for p in uniq]
            if not jpts: continue
            res = []
            for r in (rb, rn):
                polys = [s for f in fields for s in segments(r, f)]
                if not polys: res.append(None); continue
                ds = sorted(VP.min_distance_to_polylines(p, polys) for p in jpts)
                res.append((ds[len(ds) // 2], ds[-1]))
            fmt = lambda t: '-' if t is None else f'{t[0]:.0f}/{t[1]:.0f}'
            line.append(f'{ct} {fmt(res[0])} -> {fmt(res[1])}')
        print('  '.join(line))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--new', required=True, help='freshly generated data/paths')
    ap.add_argument('--base', required=True, help='deployed data/paths to compare against')
    ap.add_argument('--kmz-dir', default='reference kmz')
    ap.add_argument('--besselian-dir', default='data/besselian')
    ap.add_argument('--skip', default='', help='comma list of sections to skip, e.g. C,D')
    a = ap.parse_args()
    skip = set(x.strip().upper() for x in a.skip.split(',') if x.strip())
    new, base = load_dir(a.new), load_dir(a.base)
    if 'A' not in skip: section_a(new, base)
    if 'B' not in skip: section_b(new, base)
    if 'C' not in skip: section_c(new, base)
    if 'D' not in skip: section_d(new, base, a.kmz_dir, a.besselian_dir)


if __name__ == '__main__':
    main()
