#!/usr/bin/env python3
"""
validate_paths.py
────────────────────────────────────────────────────────────────────────────
Our eclipse curves against Xavier Jubier's KMZs. Ours are computed fresh by
the app's own engine, js/pathgen.js (run through node — assistant tool, the
user has no Node). There are no path files any more.

Jubier's longitudes are shifted by the ΔT difference before measuring
(HANDOFF §9.5): add (ΔT_ours − ΔT_his) × 0.0041781 °/s. Without it every
curve reads km off even for modern eclipses (2024: 69.2 s vs 74.0 s).

Distance = each of HIS vertices to the nearest of OUR segments, in metres.
So a residual can be his sampling as much as our error (HANDOFF §9.6).

Usage (from the repo root)
-----
  python3 "data build tools/validate_paths.py" --kmz "reference kmz/TSE_2024_04_08.kmz"
  python3 "data build tools/validate_paths.py" --all            # every reference KMZ
  python3 "data build tools/validate_paths.py" --kmz X.kmz --list

The date comes from the KMZ filename (TSE_2024_04_08, ASE_-0797_11_07);
--year/--month/--day override it.

Curve types: centreline, umbra, penumbra, terminator, green, magnitude.
────────────────────────────────────────────────────────────────────────────
"""

import argparse
import html
import json
import math
import re
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
KMZ_DIR = REPO / 'reference kmz'
DEG_PER_S = 0.0041781          # Earth's rotation, degrees of longitude per second of ΔT

# ── Curve-type registry ───────────────────────────────────────────────────
# name → (our fields, Jubier placemark names). 'magnitude' is handled per level.

CURVE_TYPES = {
    'centreline': (['centreline'], ['Central Line']),
    'umbra':      (['umbra_n', 'umbra_s'], ['Northern Limit', 'Southern Limit']),
    'penumbra':   (['penumbra_n', 'penumbra_s'],
                   ['Penumbra Northern Limit', 'Penumbra Southern Limit']),
    # Jubier: two loops normally, one for high-gamma figure-8 cases.
    'terminator': (['terminator_first', 'terminator_last'],
                   ['Sun Rise/Set Eastern Curve', 'Sun Rise/Set Western Curve', 'Sun Rise/Set Curve']),
    'green':      (['green_curve'],
                   ['Maximum on Horizon Eastern Curve', 'Maximum on Horizon Western Curve',
                    'Maximum on Horizon Curve']),
    'magnitude':  (None, None),
}
MAG_SIDE = {'n': 'Northern', 's': 'Southern'}


# ── KML parsing ───────────────────────────────────────────────────────────

def _findall_anywhere(root, tag):
    return [e for e in root.iter()
            if (e.tag.split('}')[-1] if '}' in e.tag else e.tag) == tag]


def parse_coords(coord_text):
    pts = []
    for tok in coord_text.replace('\n', ' ').split():
        parts = tok.split(',')
        if len(parts) >= 2:
            try:
                pts.append([float(parts[0]), float(parts[1])])
            except ValueError:
                pass
    return pts


def collect_placemarks(root):
    out = []
    for pm in _findall_anywhere(root, 'Placemark'):
        name_elem = next((e for e in pm if e.tag.endswith('name')), None)
        name = (name_elem.text or '').strip() if name_elem is not None else ''
        for coord_elem in _findall_anywhere(pm, 'coordinates'):
            pts = parse_coords(coord_elem.text or '')
            if len(pts) >= 2:
                out.append((name, pts))
    return out


# ── Geometry ──────────────────────────────────────────────────────────────

R_EARTH = 6371008.8


def _segments(polys):
    """All segments of our polylines as two (N,2) arrays of lon/lat."""
    a, b = [], []
    for poly in polys:
        if len(poly) >= 2:
            q = np.asarray(poly, float)
            a.append(q[:-1]); b.append(q[1:])
    return (np.concatenate(a), np.concatenate(b)) if a else (None, None)


def distances_m(pts, polys):
    """Each point to the nearest segment, local-ENU, antimeridian-safe."""
    A, B = _segments(polys)
    out = []
    for lon, lat in pts:
        c = max(0.01, math.cos(math.radians(lat)))
        def proj(q):
            dl = (q[:, 0] - lon + 180.0) % 360.0 - 180.0
            return np.stack([np.radians(dl) * c, np.radians(q[:, 1] - lat)], 1) * R_EARTH
        a, b = proj(A), proj(B)
        ab = b - a
        L = (ab * ab).sum(1)
        t = np.where(L > 0, np.clip(-(a * ab).sum(1) / np.where(L > 0, L, 1), 0, 1), 0)
        d = a + ab * t[:, None]
        out.append(float(np.sqrt((d * d).sum(1)).min()))
    return out


def min_distance_to_polylines(p, polys):
    """One point to the nearest segment (used by check_regen.py)."""
    return distances_m([p], polys)[0]


# ── Our curves, from js/pathgen.js ────────────────────────────────────────

NODE = r"""
(function () {
const P = require(process.argv[1] + '/js/pathgen.js');
const [y, m, d] = process.argv.slice(2).map(Number);
const fs = require('fs'), dir = process.argv[1] + '/data/besselian/';
for (const f of fs.readdirSync(dir).filter(f => /^-?\d+_-?\d+\.json$/.test(f))) {
  const [a, b] = f.replace('.json', '').split(/_(?=-?\d)/).map(Number);
  if (y < a || y > b) continue;
  const rec = JSON.parse(fs.readFileSync(dir + f, 'utf8')).find(r => r.year === y && r.month === m && r.day === d);
  if (!rec) break;
  const path = P.eclipse_path(JSON.parse(JSON.stringify(rec)));
  const mag = P.eclipse_magnitude_curves(JSON.parse(JSON.stringify(rec)));
  process.stdout.write(JSON.stringify({ dt: rec.dt, type: rec.eclipse_type, version: P.VERSION, path, mag }));
  return;   /* not process.exit(): it truncates a piped stdout at 128 kB */
}
process.exitCode = 3;
})();
"""


def compute(year, month, day):
    r = subprocess.run(['node', '-e', NODE, str(REPO), str(year), str(month), str(day)],
                       capture_output=True, text=True)
    if r.returncode == 3:
        sys.exit(f'No eclipse {year}-{month:02d}-{day:02d} in data/besselian')
    if r.returncode:
        sys.exit('node failed:\n' + r.stderr)
    return json.loads(r.stdout)


def split_flat(line):
    """green_curve is a FLAT [lon,lat] list with null delimiters (HANDOFF §14)."""
    segs, cur = [], []
    for p in line or []:
        if p is None:
            if cur: segs.append(cur)
            cur = []
        else:
            cur.append(p)
    if cur: segs.append(cur)
    return segs


def ours_for(res, fields):
    out = []
    for f in fields:
        v = res['path'].get(f) or []
        if f == 'green_curve':
            out += split_flat(v)
        else:
            out += [s for s in v if s]
    return out


# ── Jubier side ───────────────────────────────────────────────────────────

def kmz_text(kmz_path):
    with zipfile.ZipFile(kmz_path) as z:
        n = [x for x in z.namelist() if x.lower().endswith('.kml')]
        return z.read('doc.kml' if 'doc.kml' in n else n[0]).decode('utf8', 'replace')


def open_kml(kmz_path):
    """Parsed KML root (used by check_regen.py)."""
    return ET.fromstring(kmz_text(kmz_path).encode('utf8'))


def jubier_dt(text):
    m = re.search(r'\u0394\s*T[^0-9\-+]*([-+]?[\d,]*\.?\d+)\s*s', html.unescape(text))
    if not m:
        sys.exit('No ΔT found in the KMZ description')
    return float(m.group(1).replace(',', ''))


def date_from_name(kmz_path):
    m = re.search(r'_(-?\d+)_(\d\d)_(\d\d)', Path(kmz_path).stem)
    return tuple(map(int, m.groups())) if m else None


def stats(v):
    s = sorted(v); n = len(s)
    if not n: return None
    q = lambda f: s[min(n - 1, int(round(f * (n - 1))))]
    return {'n': n, 'median': q(0.5), 'p95': q(0.95), 'max': s[-1]}


def fmt(st):
    return f'med {st["median"]:9.1f} m   p95 {st["p95"]:9.1f} m   max {st["max"]:10.1f} m'


def comparisons(res, placemarks):
    """Yield (label, jubier_name, n_pts, stats) per Jubier curve we can match."""
    byname = {}
    for name, pts in placemarks:
        byname.setdefault(name, pts)
    for ct, (fields, names) in CURVE_TYPES.items():
        if ct == 'magnitude':
            for c in res['mag']:
                name = f'{c["level"]:.1f} Magnitude {MAG_SIDE[c["side"]]} Curve'
                if name in byname and len(c['line']) >= 2:
                    pts = byname[name]
                    yield ct, name, len(pts), stats(distances_m(pts, [c['line']]))
            continue
        ours = ours_for(res, fields)
        if not ours:
            continue
        for name in names:
            if name in byname:
                pts = byname[name]
                pts = pts[:-1] if len(pts) > 1 and pts[0] == pts[-1] else pts
                yield ct, name, len(pts), stats(distances_m(pts, ours))


def validate(kmz_path, date=None, curve='all', quiet=False):
    text = kmz_text(kmz_path)
    root = ET.fromstring(text.encode('utf8'))
    date = date or date_from_name(kmz_path)
    if not date:
        sys.exit(f'No date in {kmz_path}; pass --year --month --day')
    res = compute(*date)
    shift = (res['dt'] - jubier_dt(text)) * DEG_PER_S
    placemarks = [(n, [[p[0] + shift, p[1]] for p in pts]) for n, pts in collect_placemarks(root)]
    rows = [r for r in comparisons(res, placemarks) if curve in ('all', r[0])]
    if not quiet:
        y, m, d = date
        print(f'Eclipse {y}-{m:02d}-{d:02d} ({res["type"]})  vs  {Path(kmz_path).name}'
              f'   [pathgen {res["version"]}, ΔT shift {shift * 3600 / DEG_PER_S / 3600:+.1f} s]\n')
        for ct, name, n, st in rows:
            print(f'  {ct:10s} {name:36s} {n:5d} pts  {fmt(st)}')
        print()
    return rows


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--kmz')
    ap.add_argument('--all', action='store_true', help='every KMZ in "reference kmz/"')
    ap.add_argument('--year', type=int); ap.add_argument('--month', type=int); ap.add_argument('--day', type=int)
    ap.add_argument('--curve', default='all', choices=list(CURVE_TYPES) + ['all'])
    ap.add_argument('--list', action='store_true', help='list the KMZ placemarks and exit')
    a = ap.parse_args()

    if a.all:
        summary = {}
        for k in sorted(KMZ_DIR.glob('*.kmz')):
            for ct, name, n, st in validate(k, curve=a.curve):
                summary.setdefault(ct, []).append(st['median'])
        print('Per-curve medians across all references (median of medians / worst median):')
        for ct, v in summary.items():
            s = sorted(v)
            print(f'  {ct:10s} {len(v):3d} curves   {s[len(s) // 2]:9.1f} m   {s[-1]:10.1f} m')
        return
    if not a.kmz:
        sys.exit('--kmz or --all required')
    if a.list:
        for name, pts in collect_placemarks(ET.fromstring(kmz_text(a.kmz).encode('utf8'))):
            print(f'  {len(pts):5d} pts  "{name}"')
        return
    date = (a.year, a.month, a.day) if a.year is not None else None
    validate(a.kmz, date, a.curve)


if __name__ == '__main__':
    main()
