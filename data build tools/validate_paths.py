#!/usr/bin/env python3
"""
validate_paths.py
────────────────────────────────────────────────────────────────────────────
Cross-track validation of any of our eclipse path curves against Jubier
KMZ curves. Works for totals, annulars, hybrids, and partials.

Usage
-----
List what's in a KMZ first if you're unsure of curve names:

    python3 validate_paths.py --kmz path/to/foo.kmz --list

Validate a specific curve type:

    python3 validate_paths.py \\
        --kmz   kmz_extracted/TSE_2017_08_21.kmz \\
        --paths data/paths/paths_2001_2100.json.gz \\
        --year  2017 --month 8 --day 21 \\
        --curve centreline

Validate ALL curve types in one go (recommended for full picture):

    python3 validate_paths.py \\
        --kmz   kmz_extracted/ASE_2023_10_14.kmz \\
        --paths data/paths/paths_2001_2100.json.gz \\
        --year  2023 --month 10 --day 14 \\
        --curve all

Curve types
-----------
  centreline   — central line
  umbra        — umbra/antumbra N+S limits combined
  penumbra     — penumbra N+S limits combined
  terminator   — sunrise/sunset lemniscates
  all          — every curve type that has data on both sides

Reads .json or .json.gz path files transparently.
────────────────────────────────────────────────────────────────────────────
"""

import argparse
import gzip
import json
import math
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


# ── Curve-type registry ───────────────────────────────────────────────────
# Maps a curve-type name to:
#   (path-JSON fields to combine for "ours",
#    Jubier placemark names to combine for "theirs")

CURVE_TYPES = {
    'centreline': (
        ['centreline'],
        ['Central Line'],
    ),
    'umbra': (
        ['umbra_n', 'umbra_s'],
        ['Northern Limit', 'Southern Limit'],
    ),
    'penumbra': (
        ['penumbra_n', 'penumbra_s'],
        ['Penumbra Northern Limit', 'Penumbra Southern Limit'],
    ),
    'terminator': (
        ['terminator_first', 'terminator_last'],
        # Jubier uses two-loop names for typical eclipses, single-loop
        # name for high-gamma figure-8 cases. Match either.
        ['Sun Rise/Set Eastern Curve',
         'Sun Rise/Set Western Curve',
         'Sun Rise/Set Curve'],
    ),
}


# ── KML parsing ───────────────────────────────────────────────────────────

def _findall_anywhere(root, tag):
    return [e for e in root.iter()
            if (e.tag.split('}')[-1] if '}' in e.tag else e.tag) == tag]


def open_kml(kmz_path):
    p = Path(kmz_path)
    if p.suffix.lower() == '.kml':
        return ET.parse(p).getroot()
    with zipfile.ZipFile(p) as z:
        names = z.namelist()
        kml_names = [n for n in names if n.lower().endswith('.kml')]
        if not kml_names:
            sys.exit(f'No .kml inside {kmz_path}')
        target = 'doc.kml' if 'doc.kml' in kml_names else kml_names[0]
        with z.open(target) as f:
            return ET.parse(f).getroot()


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


def point_to_segment_m(p, a, b):
    """Wrap-safe local-ENU point-to-segment distance."""
    lat0 = math.radians(p[1])
    cos_lat0 = max(0.01, math.cos(lat0))
    def _wrap_dlon(q_lon_deg):
        d = (q_lon_deg - p[0] + 180.0) % 360.0 - 180.0
        return math.radians(d)
    def proj(q):
        return (R_EARTH * _wrap_dlon(q[0]) * cos_lat0,
                R_EARTH * (math.radians(q[1]) - lat0))
    ax, ay = proj(a); bx, by = proj(b)
    dx, dy = bx - ax, by - ay
    seg2 = dx*dx + dy*dy
    if seg2 < 1e-12:
        return math.hypot(ax, ay)
    t = max(0.0, min(1.0, -(ax*dx + ay*dy) / seg2))
    return math.hypot(ax + t*dx, ay + t*dy)


def min_distance_to_polylines(p, polys):
    best = float('inf')
    for poly in polys:
        if len(poly) < 2:
            continue
        for i in range(len(poly) - 1):
            d = point_to_segment_m(p, poly[i], poly[i+1])
            if d < best:
                best = d
    return best


# ── Path JSON loading ─────────────────────────────────────────────────────

def load_paths(paths_json):
    with open(paths_json, 'rb') as f:
        head = f.read(2)
    if head == b'\x1f\x8b':
        with gzip.open(paths_json, 'rt') as f:
            data = json.load(f)
    else:
        with open(paths_json) as f:
            data = json.load(f)
    if isinstance(data, dict):
        for k in ('eclipses', 'records', 'paths'):
            if k in data and isinstance(data[k], list):
                data = data[k]
                break
        else:
            if all(isinstance(v, dict) for v in data.values()):
                data = list(data.values())
    if not isinstance(data, list):
        sys.exit(f'Unexpected paths JSON structure in {paths_json}')
    return data


def find_record(paths_data, year, month, day):
    for rec in paths_data:
        if rec.get('year') == year and rec.get('month') == month and rec.get('day') == day:
            return rec
    sys.exit(f'No eclipse {year:04d}-{month:02d}-{day:02d} in path data')


# ── Validation pass ───────────────────────────────────────────────────────

def stats(values):
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    median = s[n // 2] if n % 2 else 0.5 * (s[n//2 - 1] + s[n//2])
    p90 = s[min(n - 1, int(round(0.9 * (n - 1))))]
    return {'n': n, 'median': median, 'p90': p90, 'max': s[-1]}


def validate_curve_type(rec, placemarks, curve_type):
    """Returns (header_str, results_str) or (None, skip_reason)."""
    our_fields, jubier_names = CURVE_TYPES[curve_type]

    ours = []
    for fld in our_fields:
        for seg in rec.get(fld) or []:
            ours.append(seg)
    if not ours:
        return None, f'no "{curve_type}" data in record'

    # Substring (case-insensitive) match against Jubier names. Avoid
    # accidentally matching "Penumbra Northern Limit" when looking for
    # "Northern Limit": require the Jubier name to START with the target,
    # OR match exactly. Falls back to substring otherwise.
    matched = []
    for target in jubier_names:
        for (name, pts) in placemarks:
            if name == target:
                matched.append((name, pts))
    if not matched:
        return None, (f'no Jubier curves named any of '
                      f'{jubier_names!r} in this KMZ')

    seen = set()
    all_ds = []
    per_curve = []
    for (name, pts) in matched:
        if name in seen:
            continue
        seen.add(name)
        uniq = pts[:-1] if (len(pts) > 1 and pts[0] == pts[-1]) else pts
        ds = [min_distance_to_polylines(p, ours) for p in uniq]
        all_ds.extend(ds)
        per_curve.append((name, len(uniq), stats(ds)))

    n_our_pts = sum(len(s) for s in ours)
    header = (f'  [{curve_type}] our {len(ours)} segment(s)/{n_our_pts} pts  '
              f'vs Jubier {len(matched)} curve(s)/{len(all_ds)} pts')
    lines = [header]
    for name, n, st in per_curve:
        if st:
            lines.append(f'    "{name}" ({n} pts): '
                         f'med {st["median"]:8.1f} m   '
                         f'90th {st["p90"]:8.1f} m   '
                         f'max {st["max"]:9.1f} m')
    if len(per_curve) > 1 and all_ds:
        st = stats(all_ds)
        lines.append(f'    overall ({st["n"]} pts):     '
                     f'med {st["median"]:8.1f} m   '
                     f'90th {st["p90"]:8.1f} m   '
                     f'max {st["max"]:9.1f} m')
    return '\n'.join(lines), None


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--kmz', required=True)
    ap.add_argument('--paths')
    ap.add_argument('--year', type=int)
    ap.add_argument('--month', type=int)
    ap.add_argument('--day', type=int)
    ap.add_argument('--curve', default='all',
                    choices=list(CURVE_TYPES.keys()) + ['all'],
                    help='Which curve type to validate (default: all)')
    ap.add_argument('--list', action='store_true',
                    help='List every Jubier placemark + vertex count, then exit')
    args = ap.parse_args()

    root = open_kml(args.kmz)
    placemarks = collect_placemarks(root)

    if args.list:
        print(f'Placemarks in {args.kmz}:')
        for name, pts in placemarks:
            print(f'  {len(pts):5d} pts  "{name}"')
        return

    if not (args.paths and args.year and args.month and args.day):
        sys.exit('--paths, --year, --month, --day required for validation '
                 '(or use --list to inspect KMZ)')

    paths_data = load_paths(args.paths)
    rec = find_record(paths_data, args.year, args.month, args.day)
    print(f'Eclipse {args.year}-{args.month:02d}-{args.day:02d} '
          f'({rec.get("type", "?")})  vs  {Path(args.kmz).name}\n')

    types_to_run = list(CURVE_TYPES.keys()) if args.curve == 'all' else [args.curve]
    for ct in types_to_run:
        result, skip = validate_curve_type(rec, placemarks, ct)
        if skip:
            print(f'  [{ct}] skipped: {skip}')
        else:
            print(result)
        print()


if __name__ == '__main__':
    main()
