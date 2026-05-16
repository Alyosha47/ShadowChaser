#!/usr/bin/env python3
"""
update_dt.py
────────────────────────────────────────────────────────────────────────────
Patches the delta_T values in your eclipse century chunk files with the
best available values across the full -1999 to +3000 range.

Sources used (in order of preference for any given date):
  1. USNO monthly observed    1973-present         (~0.1s, authoritative)
  2. USNO quarterly predicted present-~2050        (well-modelled, +/-1s)
  3. Espenak-Meeus polynomial -720 to 2050         (valid range, +/-4s)
  4. SMH 2016 LOD integral    year > 2050          (state of the art)
  5. SMH 2016 LOD integral    year < -720          (state of the art)

SMH 2016 = Stephenson, Morrison & Hohenkerk (2016) + Morrison et al (2021).
Calibrated to match Jubier's value at 2299 (752.7s). This replaces the
old Morrison-Stephenson 2004 simple parabola which gave ~714s at 2299.

Usage (run from anywhere — paths are relative to script location):
  python3 "data build tools/update_dt.py"
  python3 "data build tools/update_dt.py" --dry-run
  python3 "data build tools/update_dt.py" --dry-run --year 2299

Requires delta_t.py in the same directory as this script.
────────────────────────────────────────────────────────────────────────────
"""

import argparse
import json
import sys
import urllib.request
from pathlib import Path

from delta_t import formula_dt, source_name


# ── USNO source URLs ──────────────────────────────────────────────────────

URL_OBSERVED  = 'https://maia.usno.navy.mil/ser7/deltat.data'
URL_PREDICTED = 'https://maia.usno.navy.mil/ser7/deltat.preds'

HERE     = Path(__file__).parent
DATA_DIR = HERE / '..' / 'data' / 'besselian'


# ── Fetch ─────────────────────────────────────────────────────────────────

def fetch(url):
    print(f'  Fetching {url}')
    with urllib.request.urlopen(url, timeout=20) as r:
        return r.read().decode('utf-8', errors='replace')


# ── Parse USNO files ──────────────────────────────────────────────────────

def parse_observed(text):
    """deltat.data -> {(year, month): dt_seconds}"""
    table = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        try:
            table[(int(parts[0]), int(parts[1]))] = float(parts[3])
        except ValueError:
            continue
    return table


def parse_predicted(text):
    """deltat.preds -> {decimal_year: dt_seconds}"""
    table = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 3 or parts[0] == 'MJD':
            continue
        try:
            table[float(parts[1])] = float(parts[2])
        except ValueError:
            continue
    return table


# ── delta_T lookup ────────────────────────────────────────────────────────

def best_dt(year, month, observed, predicted):
    """
    Return best delta_T (seconds) for a given year and month.

    Priority:
      1. Exact monthly USNO observed
      2. Nearest observed month within +/-3 months
      3. Nearest predicted quarter within +/-6 months
      4. Formula (SMH2016 or Espenak-Meeus via delta_t.formula_dt)
    """
    # 1. Exact observed
    if (year, month) in observed:
        return observed[(year, month)], 'USNO observed'

    # 2. Nearest observed within +/-3 months
    best_val, best_dist = None, 4
    for (y, m), dt in observed.items():
        dist = abs((y - year) * 12 + (m - month))
        if dist < best_dist:
            best_dist, best_val = dist, dt
    if best_val is not None:
        return best_val, 'USNO observed (nearby)'

    # 3. Nearest predicted quarter within +/-6 months
    target = year + (month - 0.5) / 12
    best_val, best_dist = None, 0.51
    for y_f, dt in predicted.items():
        dist = abs(y_f - target)
        if dist < best_dist:
            best_dist, best_val = dist, dt
    if best_val is not None:
        return best_val, 'USNO predicted'

    # 4. Formula
    return formula_dt(year), source_name(year)


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dry-run', action='store_true',
                        help='print changes without writing any files')
    parser.add_argument('--year', type=int, default=None,
                        help='filter dry-run output to a specific year')
    args = parser.parse_args()

    if not DATA_DIR.exists():
        sys.exit(f'Error: {DATA_DIR.resolve()} not found.')

    chunk_files = sorted(p for p in DATA_DIR.glob('*.json'))
    if not chunk_files:
        sys.exit(f'Error: no century chunk files found in {DATA_DIR.resolve()}')

    print('Downloading USNO delta_T tables...')
    try:
        observed  = parse_observed(fetch(URL_OBSERVED))
        predicted = parse_predicted(fetch(URL_PREDICTED))
    except Exception as e:
        sys.exit(f'Download failed: {e}')

    obs_years = sorted(set(k[0] for k in observed))
    pred_years = sorted(predicted.keys())
    print(f'  Observed:  {len(observed)} monthly values '
          f'({obs_years[0]}-{obs_years[-1]})')
    print(f'  Predicted: {len(predicted)} quarterly values '
          f'({pred_years[0]:.1f}-{pred_years[-1]:.1f})\n')

    total_records = 0
    total_patched = 0

    for path in chunk_files:
        with open(path) as f:
            chunk = json.load(f)

        patched = 0
        for rec in chunk:
            y, m, orig = rec.get('year'), rec.get('month'), rec.get('dt')
            if y is None or m is None:
                continue

            new_dt, src = best_dt(y, m, observed, predicted)
            new_dt = round(new_dt, 1)

            changed = orig is None or abs(new_dt - orig) >= 0.05
            needs_source = 'dt_source' not in rec

            if changed or needs_source:
                if changed and args.dry_run:
                    if args.year is None or y == args.year:
                        orig_str = f'{orig:.1f}s' if orig is not None else 'None'
                        print(f'  {y}-{m:02d}  {orig_str} -> {new_dt:.1f}s  [{src}]')
                if changed:
                    rec['dt'] = new_dt
                rec['dt_source'] = src
                patched += 1

        total_records += len(chunk)
        total_patched += patched

        if patched and not args.dry_run:
            with open(path, 'w') as f:
                json.dump(chunk, f, separators=(',', ':'))
            print(f'  {path.name}: {patched} records updated')

    print(f'\n{"Would write" if args.dry_run else "Wrote"} '
          f'dt_source to {total_patched} of {total_records} records '
          f'across {len(chunk_files)} files.')


if __name__ == '__main__':
    main()
