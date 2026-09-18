#!/usr/bin/env python3
"""splice_umbral_limits.py -- replace chorded umbral limits in built path chunks.

WHY. The shipped umbral limits come from perpendicular_limits (a march out from
the centreline). Where the path curls tightly near a pole, the inner limit is
not reachable that way and the built data bridges it with one straight step of
300 km or more (33 eclipses in the 2026-07-13j build; 1979-08-22's south limit
opened with 1,178 km). HANDOFF sec. 9.5.

WHAT. For those records only, the umbral limits are re-traced on the same
implicit-field engine as the penumbra (penumbral_limits_field) and the green line:

    limit = zero contour of  D(lat,lon) = max_t ( |L2 - zeta*tan_f2| - axis distance )

in the true fundamental frame, ungated by the horizon. The traced contour is
kept where the sun is up at the point's own maximum (which ends every limb on
the green line), cut into limbs where the side of the shadow's motion changes,
and labelled N/S by that side -- the same rule the penumbra uses. Endpoints are
bisected onto the exact break. Output then goes through the generator's own
post-processing for umbral limbs (pole convention, unwrap, despur, DP 10 m,
5 dp), so the stored form matches every other record.

SAFETY. Only records with an umbral-limit step > CHORD_KM are touched; every
other record is written back byte-identical (the chunk JSON round-trips
exactly). Re-running is a no-op once no chords remain.

VALIDATED (2026-09-17) against Jubier, worst point, old -> new:
    1979-08-22  181 km -> 0.25 km    2654-12-01  430 km -> 0.38 km
    -797-11-07  323 km -> 0.23 km    (the last two with Jubier's DeltaT removed)
and on 7 unaffected references (HANDOFF sec. 9.5; 2017-02-26 median 85 m -> 16 m).

RETIRE THIS when the field method goes into gen_eclipse_paths.py itself; until
then a full regeneration brings the chords back.

Usage (repo root):
    python3 "data build tools/splice_umbral_limits.py"            # scan + write in place
    python3 "data build tools/splice_umbral_limits.py" --dry-run  # list only
"""
import argparse, glob, gzip, importlib.util, json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
_sp = importlib.util.spec_from_file_location("gen", os.path.join(HERE, "gen_eclipse_paths.py"))
G = importlib.util.module_from_spec(_sp); _sp.loader.exec_module(G)

CHORD_KM = 300.0
STEP_KM = 10.0
POLE_LAT = 89.9          # _split_at_pole's threshold
POLE_ANCHOR = 89.99      # unwrap()'s synthetic pole vertex


# ── the field ─────────────────────────────────────────────────────────────
def _g(rec, lat, lon, t):
    X, _, Y, _, d_r, mu, dt_s, _, L2 = G.bstate(rec, t)
    xi, eta, zeta, _ = G._geo_to_fund(lat, lon, d_r, mu, dt_s)
    return abs(L2 - zeta * rec['tan_f2']) - math.hypot(xi - X, eta - Y), zeta

def depth(rec, lat, lon, N=96):
    """(D, t at max, zeta at max). Coarse scan then ternary refine, as _pen_depth."""
    tmin, tmax = rec['tmin'], rec['tmax']
    bt = tmin; bg = -1e9
    for i in range(N + 1):
        t = tmin + (tmax - tmin) * i / N
        g, _ = _g(rec, lat, lon, t)
        if g > bg: bg, bt = g, t
    a = max(tmin, bt - (tmax - tmin) / N); b = min(tmax, bt + (tmax - tmin) / N)
    for _ in range(40):
        m1 = a + (b - a) / 3; m2 = b - (b - a) / 3
        if _g(rec, lat, lon, m1)[0] < _g(rec, lat, lon, m2)[0]: a = m1
        else: b = m2
    ts = (a + b) / 2
    g, z = _g(rec, lat, lon, ts)
    return g, ts, z

def side(rec, lat, lon, ts):
    """> 0 left of the shadow's motion (north), < 0 right."""
    X, Xp, Y, Yp, d_r, mu, dt_s, _, _ = G.bstate(rec, ts)
    xi, eta, _, _ = G._geo_to_fund(lat, lon, d_r, mu, dt_s)
    return ((xi - X) * (-Yp) + (eta - Y) * Xp) / (math.hypot(Xp, Yp) or 1e-12)

def correct(rec, lat, lon):
    f = lambda la, lo: depth(rec, la, lo)[0]
    for _ in range(20):
        v = f(lat, lon)
        if abs(v) < 1e-7: return lat, lon, True
        h = 0.01
        gN = (f(lat + h, lon) - f(lat - h, lon)) / (2 * h)
        gE = (f(lat, lon + h) - f(lat, lon - h)) / (2 * h)
        g2 = gN * gN + gE * gE
        if g2 < 1e-20: return lat, lon, False
        lat -= v * gN / g2; lon -= v * gE / g2
    return lat, lon, abs(f(lat, lon)) < 2e-6


# ── trace and cut ─────────────────────────────────────────────────────────
def limits(rec, seeds):
    """Returns (north_arcs, south_arcs), each arc [(lon, lat), ...] in time order."""
    comps = []
    for la, lo in seeds:
        sla, slo, ok = correct(rec, la, lo)
        if not ok: continue
        if any(G._gc_dist((sla, slo), (q[1], q[0])) / 1000.0 < 3 * STEP_KM
               for c, _ in comps for q in c):
            continue
        pts, closed = G._trace_zero(lambda a, b: depth(rec, a, b)[0], (sla, slo),
                                    step_km=STEP_KM, min_km=1.0, maxpts=6000)
        comps.append((pts, closed))
    north, south = [], []
    for pts, closed in comps:
        n = len(pts)
        info = [depth(rec, lat, lon) for lon, lat in pts]
        lab = [(z > 0, side(rec, lat, lon, ts) > 0) for (lon, lat), (_, ts, z) in zip(pts, info)]
        brk = [i for i in range(n) if (closed or i > 0) and lab[i] != lab[i - 1]]
        if not brk:
            runs = [list(range(n))]
        else:
            runs = [[j % n for j in range(a, b)]
                    for a, b in zip(brk, brk[1:] + [brk[0] + (n if closed else 0)])]
            if not closed:
                runs = [list(range(0, brk[0]))] + [r for r in runs if max(r) < n]

        def lab_at(lat, lon):
            _, ts, z = depth(rec, lat, lon)
            return (z > 0, side(rec, lat, lon, ts) > 0)

        def refine(j_in, j_out):
            """The exact break on the contour between a run's end vertex and its neighbour."""
            A = (pts[j_in][1], pts[j_in][0]); B = (pts[j_out][1], pts[j_out][0]); L = lab[j_in]
            for _ in range(30):
                d = G._gc_dist(A, B)
                if d < 1.0: break
                m = G._gc_step(A[0], A[1], G._gc_bearing(A, B), d / 2)
                ml, mo, ok = correct(rec, m[0], m[1])
                if not ok: break
                if lab_at(ml, mo) == L: A = (ml, mo)
                else: B = (ml, mo)
            return (A[1], A[0])

        for r in runs:
            if len(r) < 3 or not lab[r[0]][0]: continue
            arc = [pts[j] for j in r]
            if brk and (closed or r[0] > 0): arc = [refine(r[0], (r[0] - 1) % n)] + arc
            if brk and (closed or r[-1] < n - 1): arc = arc + [refine(r[-1], (r[-1] + 1) % n)]
            if info[r[0]][1] > info[r[-1]][1]: arc = arc[::-1]
            (north if lab[r[0]][1] else south).append(arc)
    return north, south


# ── stored form ───────────────────────────────────────────────────────────
def _nearest_lon(rec_path, p):
    best = None
    for s in rec_path['centreline'] + rec_path['umbra_n'] + rec_path['umbra_s']:
        for q in s:
            dd = abs(q[1] - p[1]) + abs(((q[0] - p[0] + 180) % 360) - 180)
            if best is None or dd < best[0]: best = (dd, q[0])
    return best[1]

def stored(rec_path, arcs):
    """Generator's post-processing: at a pole passage end one segment at the pole on
    its entry longitude and start the next on its exit longitude (the convention of
    unwrap + _split_at_pole, applied per passage so a dense contour is cut once);
    unwrap across the antimeridian onto the record's existing longitude branch;
    despur; DP at 10 m; 5 dp."""
    segs = []
    for arc in arcs:
        pieces = [[]]; i = 0; n = len(arc)
        while i < n:
            lon, lat = arc[i]
            if abs(lat) >= POLE_LAT:
                j = i
                while j < n and abs(arc[j][1]) >= POLE_LAT: j += 1
                pl = POLE_ANCHOR if lat > 0 else -POLE_ANCHOR
                if pieces[-1]: pieces[-1].append([arc[i - 1][0] if i > 0 else lon, pl])
                pieces.append([[arc[j][0] if j < n else arc[j - 1][0], pl]])
                i = j; continue
            pieces[-1].append([lon, lat]); i += 1
        for p in pieces:
            if len(p) < 2: continue
            u = G.unwrap(p)
            k = round((_nearest_lon(rec_path, u[len(u) // 2]) - u[len(u) // 2][0]) / 360.0)
            segs.append([[x + 360 * k, y] for x, y in u])
    segs = [G._despur_segment(s) for s in segs]
    segs = [G.simplify_dp(s, tol=9e-5) for s in segs]
    return [[[round(x, 5), round(y, 5)] for x, y in s] for s in segs]


def worst_step_km(rec_path):
    w = 0.0
    for key in ('umbra_n', 'umbra_s'):
        for s in rec_path.get(key) or []:
            for p, q in zip(s, s[1:]):
                w = max(w, G._gc_dist((p[1], p[0]), (q[1], q[0])) / 1000.0)
    return w


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--paths-dir', default='data/paths')
    ap.add_argument('--besselian-dir', default='data/besselian')
    ap.add_argument('--out-dir', default=None, help='default: write in place')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    out_dir = args.out_dir or args.paths_dir
    os.makedirs(out_dir, exist_ok=True)

    recs = {}
    for f in glob.glob(os.path.join(args.besselian_dir, '*.json')):
        for r in json.load(open(f)):
            recs[str(int(r['cat_no']))] = r

    total = 0
    for f in sorted(glob.glob(os.path.join(args.paths_dir, '*.json.gz'))):
        chunk = json.loads(gzip.open(f).read())
        hits = [k for k, v in chunk.items() if k != '__meta' and worst_step_km(v) > CHORD_KM]
        if not hits: continue
        for k in hits:
            v = chunk[k]
            tag = f"{v['year']}-{v['month']:02d}-{v['day']:02d}"
            print(f'  {tag} {v["type"]:<3s} worst step {worst_step_km(v):.0f} km', flush=True)
            if args.dry_run: continue
            seeds = [(p[1], p[0]) for key in ('umbra_n', 'umbra_s')
                     for s in v[key] for p in s[::max(1, len(s) // 6)]]
            north, south = limits(recs[k], seeds)
            if bool(north) != bool(v['umbra_n']) or bool(south) != bool(v['umbra_s']):
                print(f'    SKIPPED: limb set changed (N {len(north)} S {len(south)}); left as built')
                continue
            v['umbra_n'] = stored(v, north)
            v['umbra_s'] = stored(v, south)
            print(f'    -> worst step {worst_step_km(v):.0f} km')
        total += len(hits)
        if not args.dry_run:
            with gzip.open(os.path.join(out_dir, os.path.basename(f)), 'wb', compresslevel=9) as fh:
                fh.write(json.dumps(chunk, separators=(',', ':')).encode())
    print(f'{total} record(s) {"found" if args.dry_run else "processed"}')


if __name__ == '__main__':
    main()
