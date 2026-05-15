#!/usr/bin/env python3
"""
gen_eclipse_paths.py
────────────────────────────────────────────────────────────────────────────
Generate eclipse shadow path files from Besselian element chunks.

For each eclipse produces five curves:
  centreline    — sub-shadow surface track
  umbra_n/s     — northern/southern umbral (totality/annularity) limits
  penumbra_n/s  — northern/southern penumbral (any eclipse) limits

Output: one JSON file per century chunk, e.g. data/paths/paths_1901_2000.json
Each file is a dict keyed by cat_no (as string).

Partial eclipses are skipped (no umbral corridor; penumbral limits can be
computed client-side on demand if ever needed).

Antimeridian crossings are split into separate polyline segments.

All coordinates are [lon, lat] (GeoJSON order), east-positive, 4 d.p.

Usage:
    python3 gen_eclipse_paths.py [--data-dir ./data] [--out-dir ./data/paths]
────────────────────────────────────────────────────────────────────────────
"""

import json, gzip, math, os, argparse, glob

# ── Constants ─────────────────────────────────────────────────────────────

DEG = math.pi / 180
F   = 1 / 298.257223563        # WGS84 flattening
E2  = 2*F - F*F                # first eccentricity squared
STEP_MINUTES  = 1               # path sampling interval
LIMIT_RES     = 720             # angular resolution for umbral limit sweep
PENUMBRA_RES  = 180             # angular resolution for penumbral limit sweep


# ── Besselian polynomial ───────────────────────────────────────────────────

def poly(c, t):
    return c[0] + c[1]*t + c[2]*t*t + (c[3] if len(c) > 3 else 0)*t*t*t


# ── Sub-shadow surface point ───────────────────────────────────────────────

def sub_shadow_point(rec, t):
    """
    Geographic point directly under the shadow axis at TDT offset t from t0.
    Returns (lat_deg, lon_deg_east) or None if shadow misses Earth.
    """
    X  = poly([rec['x0'], rec['x1'], rec['x2'], rec['x3']], t)
    Y  = poly([rec['y0'], rec['y1'], rec['y2'], rec['y3']], t)
    d  = poly([rec['d0'], rec['d1'], rec['d2'], 0], t)
    mu = poly([rec['mu0'],rec['mu1'],rec['mu2'], 0], t)
    if X*X + Y*Y >= 1.0:
        return None
    d_r  = d * DEG
    zeta = math.sqrt(max(0.0, 1.0 - X*X - Y*Y))
    # Geocentric latitude of sub-shadow point
    lat_gc = math.asin(max(-1.0, min(1.0, Y*math.cos(d_r) + zeta*math.sin(d_r))))
    # Geodetic latitude (WGS84)
    lat_gd = math.atan(math.tan(lat_gc) / (1.0 - E2))
    # Hour angle of shadow axis at surface point, then east longitude
    H_deg  = math.degrees(math.atan2(X, zeta*math.cos(d_r) - Y*math.sin(d_r)))
    lon_e  = (H_deg - mu + 0.00417807 * rec['dt'] + 180.0) % 360.0 - 180.0
    return (math.degrees(lat_gd), lon_e)


# ── Shadow cone limit points ───────────────────────────────────────────────

def limit_points(rec, t, use_umbra, limit_res=720):
    """
    Northern and southern surface points of the shadow cone edge at time t.
    use_umbra=True  → umbral/antumbral limit (L2, tan_f2)
    use_umbra=False → penumbral limit        (L1, tan_f1)

    Returns ((lat_n, lon_n), (lat_s, lon_s)); either may be None.
    """
    X  = poly([rec['x0'], rec['x1'], rec['x2'], rec['x3']], t)
    Y  = poly([rec['y0'], rec['y1'], rec['y2'], rec['y3']], t)
    d  = poly([rec['d0'], rec['d1'], rec['d2'], 0], t)
    mu = poly([rec['mu0'],rec['mu1'],rec['mu2'], 0], t)
    L  = poly([rec['l20'],rec['l21'],rec['l22'], 0], t) if use_umbra \
         else poly([rec['l10'],rec['l11'],rec['l12'], 0], t)
    absL = abs(L)
    d_r  = d * DEG
    dt_s = rec['dt']

    best_n = best_s = None
    best_lat_n, best_lat_s = -999.0, 999.0

    # Sweep the limit circle in the fundamental plane
    N = limit_res
    for i in range(N):
        q   = 2.0 * math.pi * i / N
        xi  = X + absL * math.sin(q)
        eta = Y + absL * math.cos(q)
        r2  = xi*xi + eta*eta
        if r2 >= 1.0:
            continue
        zeta   = math.sqrt(1.0 - r2)
        lat_gc = math.asin(max(-1.0, min(1.0,
                     eta*math.cos(d_r) + zeta*math.sin(d_r))))
        lat_gd = math.atan(math.tan(lat_gc) / (1.0 - E2))
        H_deg  = math.degrees(math.atan2(xi,
                     zeta*math.cos(d_r) - eta*math.sin(d_r)))
        lon_e  = (H_deg - mu + 0.00417807*dt_s + 180.0) % 360.0 - 180.0
        lat_d  = math.degrees(lat_gd)
        if lat_d > best_lat_n:
            best_lat_n = lat_d; best_n = (lat_d, lon_e)
        if lat_d < best_lat_s:
            best_lat_s = lat_d; best_s = (lat_d, lon_e)

    return best_n, best_s


# ── Antimeridian split ─────────────────────────────────────────────────────

def split_antimeridian(points):
    """
    Split a list of [lon, lat] at ±180° crossings.
    Returns a list of segments, each with ≥2 points.
    """
    if not points:
        return []
    segs, cur = [], [points[0]]
    for i in range(1, len(points)):
        if abs(points[i][0] - points[i-1][0]) > 180.0:
            if len(cur) >= 2:
                segs.append(cur)
            cur = [points[i]]
        else:
            cur.append(points[i])
    if len(cur) >= 2:
        segs.append(cur)
    return segs


# ── Build path for one record ──────────────────────────────────────────────

def build_path(rec, step_minutes=STEP_MINUTES, limit_res=LIMIT_RES, penumbra_res=PENUMBRA_RES):
    tmin = rec['tmin']
    tmax = rec['tmax']
    step = step_minutes / 60.0

    cl, un, us, pn, ps = [], [], [], [], []

    t = tmin
    while t <= tmax + 1e-9:
        pt = sub_shadow_point(rec, t)
        if pt:
            cl.append([round(pt[1], 3), round(pt[0], 3)])

        n, s = limit_points(rec, t, use_umbra=True,  limit_res=limit_res)
        if n: un.append([round(n[1], 3), round(n[0], 3)])
        if s: us.append([round(s[1], 3), round(s[0], 3)])

        n, s = limit_points(rec, t, use_umbra=False, limit_res=penumbra_res)
        if n: pn.append([round(n[1], 3), round(n[0], 3)])
        if s: ps.append([round(s[1], 3), round(s[0], 3)])

        t += step

    return {
        'cat_no':       int(float(rec['cat_no'])) if rec.get('cat_no') is not None else None,
        'year':         rec['year'],
        'month':        rec['month'],
        'day':          rec['day'],
        'type':         rec.get('eclipse_type', '?'),
        'ge':           [round(rec.get('lng_dd_ge', 0.0), 4),
                         round(rec.get('lat_dd_ge', 0.0), 4)],
        'centreline':   split_antimeridian(cl),
        'umbra_n':      split_antimeridian(un),
        'umbra_s':      split_antimeridian(us),
        'penumbra_n':   split_antimeridian(pn),
        'penumbra_s':   split_antimeridian(ps),
    }


# ── Process a century chunk ────────────────────────────────────────────────

def process_chunk(chunk_path, out_dir, step_minutes=STEP_MINUTES, limit_res=LIMIT_RES, penumbra_res=PENUMBRA_RES):
    with open(chunk_path) as f:
        records = json.load(f)

    chunk_name = os.path.splitext(os.path.basename(chunk_path))[0]
    out_path   = os.path.join(out_dir, f'paths_{chunk_name}.json')

    paths = {}
    print(f"  {chunk_name}: {len(records)} eclipses → {out_path}")

    for rec in records:
        key = str(int(float(rec['cat_no']))) if rec.get('cat_no') is not None else \
              f"{rec['year']}_{rec['month']}_{rec['day']}"
        paths[key] = build_path(rec, step_minutes, limit_res, penumbra_res)

    with open(out_path, 'w') as f:
        json.dump(paths, f, separators=(',', ':'))

    raw  = os.path.getsize(out_path)
    with open(out_path, 'rb') as f:
        gz_size = len(gzip.compress(f.read()))
    print(f"    {raw/1024:.0f} KB raw, {gz_size/1024:.0f} KB gzipped, "
          f"{len(paths)} paths written")


# ── CLI ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Generate eclipse path files')
    parser.add_argument('--data-dir', default='./data',
                        help='Directory containing Besselian chunk JSON files')
    parser.add_argument('--out-dir', default='./data/paths',
                        help='Output directory for path chunk files')
    parser.add_argument('--step', type=float, default=1.0,
                        help='Time step in minutes between path samples (default 1)')
    parser.add_argument('--limit-res', type=int, default=720,
                        help='Points around limit circle for umbral curves (default 720)')
    parser.add_argument('--penumbra-res', type=int, default=180,
                        help='Points around limit circle for penumbral curves (default 180)')
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    chunks = sorted(glob.glob(os.path.join(args.data_dir, '*.json')))
    # exclude index.json
    chunks = [c for c in chunks if os.path.basename(c) != 'index.json']

    if not chunks:
        print(f'No chunk files found in {args.data_dir}')
        return

    print(f'Found {len(chunks)} chunk(s) in {args.data_dir}  '
          f'(step={args.step}m, limit-res={args.limit_res}, penumbra-res={args.penumbra_res})')
    for c in chunks:
        process_chunk(c, args.out_dir, args.step, args.limit_res, args.penumbra_res)
    print('Done.')


# ── Test mode ─────────────────────────────────────────────────────────────

def test():
    """
    Run against the 1999 Aug 11 total eclipse.
    Replace the record below with your actual production record for that eclipse
    (copy it from your Besselian data chunk).
    """
    rec_1999 = {
        # ── REPLACE THIS WITH YOUR ACTUAL 1999 RECORD ──────────────────────
        # Copy the full record from your data chunk for 1999 Aug 11.
        # The values below are placeholders that will NOT give correct output.
        "year":1999,"month":8,"day":11,"cat_no":8975,
        "eclipse_type":"T",
        "lat_dd_ge": 45.07, "lng_dd_ge": 44.29,
        "dt": 63.8, "t0": 11.0, "tmin": -3.0, "tmax": 3.0,
        # ── Paste your x0..x3, y0..y3, d0..d2, mu0..mu2,
        #    l10..l12, l20..l22, tan_f1, tan_f2 here ──────────────────────
        "x0": 0.0, "x1": 0.0, "x2": 0.0, "x3": 0.0,
        "y0": 0.0, "y1": 0.0, "y2": 0.0, "y3": 0.0,
        "d0": 0.0, "d1": 0.0, "d2": 0.0,
        "mu0":0.0, "mu1":15.003, "mu2":0.0,
        "l10":0.535,"l11":0.0,"l12":0.0,
        "l20":-0.011,"l21":0.0,"l22":0.0,
        "tan_f1":0.0046,"tan_f2":0.0046,
    }

    # Also test 2026 which has known-correct elements
    rec_2026 = {
        "year":2026,"month":8,"day":12,"cat_no":9566,
        "eclipse_type":"T",
        "lat_dd_ge":65.22345,"lng_dd_ge":-25.21619,
        "dt":69.1,"t0":18.0,"tmin":-3.0,"tmax":3.0,
        "x0":0.475514,"x1":0.5189249,"x2":-7.73e-05,"x3":-8.04e-06,
        "y0":0.771183,"y1":-0.230168,"y2":-0.0001246,"y3":3.77e-06,
        "d0":14.79667,"d1":-0.012065,"d2":-3e-06,
        "mu0":88.74779,"mu1":15.00309,"mu2":0.0,
        "l10":0.537955,"l11":9.39e-05,"l12":-1.21e-05,
        "l20":-0.008142,"l21":9.35e-05,"l22":-1.21e-05,
        "tan_f1":0.0046141,"tan_f2":0.0045911,
    }

    for rec in [rec_2026, rec_1999]:
        label = f"{rec['year']} {rec['month']:02d} {rec['day']:02d}"
        if rec['x0'] == 0.0 and rec['year'] == 1999:
            print(f"\n{label}: *** PLACEHOLDER ELEMENTS — replace with real record ***")
            continue

        result = build_path(rec)
        cl = sum(len(s) for s in result['centreline'])
        un = sum(len(s) for s in result['umbra_n'])
        pn = sum(len(s) for s in result['penumbra_n'])
        js = json.dumps(result, separators=(',',':'))
        gz = gzip.compress(js.encode())

        print(f"\n{label} ({rec['eclipse_type']}):")
        print(f"  GE stored:      lon={result['ge'][0]}  lat={result['ge'][1]}")
        print(f"  Centreline pts: {cl}")
        print(f"  Umbra N pts:    {un}")
        print(f"  Penumbra N pts: {pn}")
        if result['centreline']:
            first = result['centreline'][0][0]
            last  = result['centreline'][-1][-1]
            print(f"  Path start:     lon={first[0]}  lat={first[1]}")
            print(f"  Path end:       lon={last[0]}   lat={last[1]}")
        print(f"  JSON:  {len(js)/1024:.1f} KB raw,  {len(gz)/1024:.1f} KB gzipped")

        out = f'/tmp/path_{int(float(rec["cat_no"]))}.json'
        with open(out, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"  Written: {out}")

        # Spot-check: GE point from path calc vs stored
        # Find tMax (min shadow distance from geocentre)
        t = 0.0
        for _ in range(50):
            X=poly([rec['x0'],rec['x1'],rec['x2'],rec['x3']],t)
            Y=poly([rec['y0'],rec['y1'],rec['y2'],rec['y3']],t)
            Xp=rec['x1']+2*rec['x2']*t+3*rec['x3']*t*t
            Yp=rec['y1']+2*rec['y2']*t+3*rec['y3']*t*t
            n2=Xp*Xp+Yp*Yp
            if n2 < 1e-20: break
            tau=-(X*Xp+Y*Yp)/n2
            t+=tau
            if abs(tau)<1e-9: break
        pt = sub_shadow_point(rec, t)
        if pt:
            dlat = pt[0] - rec['lat_dd_ge']
            dlon = pt[1] - rec['lng_dd_ge']
            print(f"  GE check:  computed lat={pt[0]:.3f} lon={pt[1]:.3f}  "
                  f"Δlat={dlat:+.3f}  Δlon={dlon:+.3f}")


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == '--test':
        test()
    else:
        main()
