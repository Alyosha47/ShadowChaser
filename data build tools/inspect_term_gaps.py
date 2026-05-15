"""Look for big inter-vertex jumps in our terminator polyline.

Usage:
    python3 inspect_term_gaps.py data/paths/paths_1901_2000.json
"""
import json, math, sys

path_file = sys.argv[1]
with open(path_file) as f:
    d = json.load(f)

for v in d.values():
    if v.get('year') == 1999 and v.get('month') == 8 and v.get('day') == 11:
        for seg in v.get('terminator_first', []):
            jumps = []
            for i in range(len(seg)-1):
                dlon_raw = seg[i+1][0] - seg[i][0]
                dlat = seg[i+1][1] - seg[i][1]
                dlon_wrapped = (dlon_raw + 180) % 360 - 180
                gap_deg = math.hypot(dlon_wrapped, dlat)
                jumps.append((i, dlon_raw, dlat, gap_deg))
            jumps.sort(key=lambda x: -x[3])
            print(f'\nLargest 10 inter-vertex gaps (segment of {len(seg)} pts):')
            for i, dlon_raw, dlat, gap_deg in jumps[:10]:
                km = gap_deg * 111  # rough
                print(f'  vertex {i}→{i+1}: dlon_raw={dlon_raw:+8.2f}°  '
                      f'dlat={dlat:+6.2f}°  ≈{km:6.0f} km  '
                      f'[{seg[i][0]:.1f},{seg[i][1]:.1f}]→'
                      f'[{seg[i+1][0]:.1f},{seg[i+1][1]:.1f}]')
            gaps = sorted(j[3] for j in jumps)
            n = len(gaps)
            print(f'\nGap stats (degrees):  median={gaps[n//2]:.3f}°  '
                  f'90th={gaps[int(0.9*n)]:.3f}°  max={gaps[-1]:.3f}°')
            print(f'Gap stats (km approx): median={gaps[n//2]*111:.1f}  '
                  f'90th={gaps[int(0.9*n)]*111:.1f}  max={gaps[-1]*111:.1f}')
        break
