#!/usr/bin/env python3
"""
validate_terminators.py
────────────────────────────────────────────────────────────────────────────
Cross-track validation of our terminator lemniscates against Jubier KMZ
curves.

Usage
-----
1. Discover what Jubier calls the curves in a given KMZ:

       python3 validate_terminators.py --kmz kmz_extracted/TSE_2017_08_21.kmz \
                                        --list

   Prints every Placemark <name> with its vertex count.  Look for names
   that obviously refer to sunrise/sunset boundary loops — e.g.
   "Sunrise Curve", "Sunset Curve", "Eclipse Begins/Ends at Sunrise",
   etc.  Some Jubier KMZs use one big closed loop; others use two.

2. Validate against named curves:

       python3 validate_terminators.py \
           --kmz   kmz_extracted/TSE_2017_08_21.kmz \
           --paths paths/paths_2001_2100.json \
           --year  2017 --month 8 --day 21 \
           --curves "Sun Rise/Set Eastern Curve" "Sun Rise/Set Western Curve"

   Prints cross-track median / 90th / max metres for each named curve
   against whichever of terminator_first / terminator_last is closer.

   For 2017-style eclipses (penumbra has both N and S limits) Jubier
   uses two loops with the names above.  For high-gamma eclipses with
   a single penumbra limit (e.g. 1999) the two loops are merged into
   one figure-8 named just "Sun Rise/Set Curve".  --curves AUTO will
   match either convention.

No third-party deps — uses only Python's stdlib (zipfile, xml.etree).
────────────────────────────────────────────────────────────────────────────
"""

import argparse
import json
import math
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


# ── KML parsing ───────────────────────────────────────────────────────────

KML_NS = '{http://www.opengis.net/kml/2.2}'

# Some Jubier KMZ versions omit the namespace; try both.
def _findall_anywhere(root, tag):
    out = []
    for elem in root.iter():
        ltag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
        if ltag == tag:
            out.append(elem)
    return out


def open_kml(kmz_path):
    """Return parsed XML root from a .kmz (zipped KML) or raw .kml file."""
    p = Path(kmz_path)
    if p.suffix.lower() == '.kml':
        return ET.parse(p).getroot()
    with zipfile.ZipFile(p) as z:
        # Prefer doc.kml; fall back to first .kml inside the archive.
        names = z.namelist()
        kml_names = [n for n in names if n.lower().endswith('.kml')]
        if not kml_names:
            sys.exit(f'No .kml inside {kmz_path}')
        target = 'doc.kml' if 'doc.kml' in kml_names else kml_names[0]
        with z.open(target) as f:
            return ET.parse(f).getroot()


def parse_coords(coord_text):
    """KML <coordinates> string  →  list of [lon, lat] (drops altitude)."""
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
    """Return [(name, [[lon,lat], ...]), ...] for every Placemark with a
    LineString or LinearRing.  Multi-geometry placemarks are flattened
    (each geometry becomes its own entry, sharing the placemark name)."""
    out = []
    for pm in _findall_anywhere(root, 'Placemark'):
        name_elem = next((e for e in pm if e.tag.endswith('name')), None)
        name = (name_elem.text or '').strip() if name_elem is not None else ''
        for coord_elem in _findall_anywhere(pm, 'coordinates'):
            pts = parse_coords(coord_elem.text or '')
            if len(pts) >= 2:
                out.append((name, pts))
    return out


# ── Geometry: cross-track distance ────────────────────────────────────────

R_EARTH = 6371008.8   # mean Earth radius in metres (IUGG)


def lonlat_to_ecef(lon_deg, lat_deg):
    lon = math.radians(lon_deg)
    lat = math.radians(lat_deg)
    cl, sl = math.cos(lat), math.sin(lat)
    return (R_EARTH * cl * math.cos(lon),
            R_EARTH * cl * math.sin(lon),
            R_EARTH * sl)


def haversine_m(p1, p2):
    lon1, lat1 = math.radians(p1[0]), math.radians(p1[1])
    lon2, lat2 = math.radians(p2[0]), math.radians(p2[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2 * R_EARTH * math.asin(math.sqrt(a))


def point_to_segment_m(p, a, b):
    """Approximate point-to-segment distance on a sphere via local ENU.

    For terminator curves (≤ ~5000 km long, segments ≤ ~50 km), local
    flat-Earth projection at the query point's latitude is accurate to
    well under 1 m for the segment-distance values we care about.

    Wrap-safe: longitude differences are folded into [-180, 180] before
    scaling, so a Jubier vertex at lon=+170 and ours at lon=-190 are
    correctly recognised as the same physical point.
    """
    lon0 = math.radians(p[0]); lat0 = math.radians(p[1])
    cos_lat0 = max(0.01, math.cos(lat0))
    def _wrap_dlon(q_lon_deg):
        # Fold (q_lon - p_lon) into [-180, 180] degrees, then to radians.
        d = (q_lon_deg - p[0] + 180.0) % 360.0 - 180.0
        return math.radians(d)
    def proj(q):
        x = R_EARTH * _wrap_dlon(q[0]) * cos_lat0
        y = R_EARTH * (math.radians(q[1]) - lat0)
        return x, y
    ax, ay = proj(a)
    bx, by = proj(b)
    dx, dy = bx - ax, by - ay
    seg2 = dx*dx + dy*dy
    if seg2 < 1e-12:
        return math.hypot(ax, ay)
    t = max(0.0, min(1.0, -(ax*dx + ay*dy) / seg2))
    px, py = ax + t*dx, ay + t*dy
    return math.hypot(px, py)


def min_distance_to_polyline(p, poly):
    """Min metres from point p to any segment of polyline poly."""
    if len(poly) < 2:
        return float('inf')
    best = float('inf')
    for i in range(len(poly) - 1):
        d = point_to_segment_m(p, poly[i], poly[i+1])
        if d < best:
            best = d
    return best


# ── Match path JSON record ────────────────────────────────────────────────

def find_record(paths_json, year, month, day):
    """Find the eclipse record in a paths_*.json file by date.

    Supports three layouts:
      - list of records
      - dict with 'eclipses' / 'records' / 'paths' key holding a list
      - dict keyed by cat_no (string) with records as values
    """
    with open(paths_json, 'rb') as f:
        head = f.read(2)
    if head == b'\x1f\x8b':
        import gzip
        with gzip.open(paths_json, 'rt') as f:
            data = json.load(f)
    else:
        with open(paths_json) as f:
            data = json.load(f)
    if isinstance(data, dict):
        # Wrapper-key form.
        for k in ('eclipses', 'records', 'paths'):
            if k in data and isinstance(data[k], list):
                data = data[k]
                break
        else:
            # Cat_no-keyed form: take the values.
            if all(isinstance(v, dict) for v in data.values()):
                data = list(data.values())
    if not isinstance(data, list):
        sys.exit(f'Unexpected paths JSON structure in {paths_json}')
    for rec in data:
        if rec.get('year') == year and rec.get('month') == month and rec.get('day') == day:
            return rec
    sys.exit(f'No eclipse {year:04d}-{month:02d}-{day:02d} in {paths_json}')


# ── Validation pass ───────────────────────────────────────────────────────

def stats(values):
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    median = s[n // 2] if n % 2 else 0.5 * (s[n//2 - 1] + s[n//2])
    p90 = s[min(n - 1, int(round(0.9 * (n - 1))))]
    return {'n': n, 'median': median, 'p90': p90, 'max': s[-1]}


def best_match_distance(jubier_pt, ours_curves):
    """Min cross-track distance from jubier_pt to ANY of our terminator
    polylines (we don't know a priori which one corresponds to which)."""
    best = float('inf')
    for poly in ours_curves:
        d = min_distance_to_polyline(jubier_pt, poly)
        if d < best:
            best = d
    return best


# ── Main ──────────────────────────────────────────────────────────────────

# Jubier's actual placemark names for the sunrise/sunset lemniscates.
# - Two-loop case (most central eclipses): "Sun Rise/Set Eastern Curve"
#                                          "Sun Rise/Set Western Curve"
# - Figure-8 case (high-gamma single-limit eclipses): "Sun Rise/Set Curve"
# We deliberately exclude "Maximum on Horizon ... Curve" — those are the
# orange bisector curves, not what our terminator output represents.
AUTO_NAME_HINTS = [
    'Sun Rise/Set Eastern Curve',
    'Sun Rise/Set Western Curve',
    'Sun Rise/Set Curve',
]


def name_matches(name, target):
    # Exact match (case-insensitive) for AUTO defaults — substring elsewhere
    # would also match "Maximum on Horizon" curves which we don't want.
    return name.strip().lower() == target.strip().lower()


def name_substring_match(name, target):
    return target.lower() in name.lower()


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--kmz', required=True,
                    help='Path to a Jubier .kmz (or .kml) file')
    ap.add_argument('--paths',
                    help='Path to paths_*.json file with our generator output')
    ap.add_argument('--year',  type=int)
    ap.add_argument('--month', type=int)
    ap.add_argument('--day',   type=int)
    ap.add_argument('--curves', nargs='+',
                    help='KML placemark names to validate against. '
                         'Use AUTO to try common names. '
                         'Substring match, case-insensitive.')
    ap.add_argument('--list', action='store_true',
                    help='List every placemark name + vertex count, then exit')
    args = ap.parse_args()

    root = open_kml(args.kmz)
    placemarks = collect_placemarks(root)

    if args.list or not args.curves:
        print(f'Placemarks in {args.kmz}:')
        for name, pts in placemarks:
            print(f'  {len(pts):5d} pts  "{name}"')
        if args.list:
            return
        if not args.curves:
            sys.exit('\nProvide --curves <name> [<name> ...] (or --curves AUTO) to validate.')

    if not (args.paths and args.year and args.month and args.day):
        sys.exit('--paths, --year, --month, --day are required for validation.')

    rec = find_record(args.paths, args.year, args.month, args.day)
    ours_first = rec.get('terminator_first') or []
    ours_last  = rec.get('terminator_last')  or []
    ours_all   = list(ours_first) + list(ours_last)

    if not ours_all:
        sys.exit(f'No terminator curves in record for '
                 f'{args.year}-{args.month:02d}-{args.day:02d}')

    print(f'Eclipse {args.year}-{args.month:02d}-{args.day:02d} '
          f'({rec.get("type", "?")})')
    print(f'  Our terminator_first: {len(ours_first)} segment(s), '
          f'{sum(len(s) for s in ours_first)} pts total')
    print(f'  Our terminator_last:  {len(ours_last)} segment(s), '
          f'{sum(len(s) for s in ours_last)} pts total')
    print()

    # Resolve curve names.
    if len(args.curves) == 1 and args.curves[0].upper() == 'AUTO':
        targets = AUTO_NAME_HINTS
        matcher = name_matches               # exact (case-insensitive)
    else:
        targets = args.curves
        matcher = name_substring_match       # forgiving for typed names

    matched_any = False
    overall = []
    seen = set()
    for target in targets:
        matches = [(n, p) for (n, p) in placemarks if matcher(n, target)]
        if not matches:
            print(f'  [skip] no placemark matches "{target}"')
            continue
        matched_any = True
        for name, jubier_pts in matches:
            # AUTO mode: avoid double-counting if multiple hints match the
            # same placemark (shouldn't happen with current AUTO list, but
            # defensive).
            if name in seen:
                continue
            seen.add(name)
            # Drop trivial closures (last == first).
            uniq = jubier_pts[:-1] if (len(jubier_pts) > 1 and
                                        jubier_pts[0] == jubier_pts[-1]) else jubier_pts
            ds = [best_match_distance(p, ours_all) for p in uniq]
            st = stats(ds)
            overall.extend(ds)
            print(f'  Jubier "{name}" ({len(uniq)} vertices)')
            if st:
                print(f'    median: {st["median"]:8.1f} m   '
                      f'90th: {st["p90"]:8.1f} m   '
                      f'max: {st["max"]:8.1f} m')

    if not matched_any:
        print('No placemarks matched any of the provided curve names.')
        print('Re-run with --list to see what is in the KMZ.')
        return

    if overall and len(targets) > 1:
        st = stats(overall)
        print()
        print(f'  Overall (all matched curves combined, {st["n"]} vertices)')
        print(f'    median: {st["median"]:8.1f} m   '
              f'90th: {st["p90"]:8.1f} m   '
              f'max: {st["max"]:8.1f} m')


if __name__ == '__main__':
    main()
