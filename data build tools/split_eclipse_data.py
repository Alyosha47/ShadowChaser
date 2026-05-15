#!/usr/bin/env python3
"""
split_eclipse_data.py
---------------------
Splits Espenak's 5000-year eclipse CSV into per-century JSON chunks
and a lightweight index file for fast browsing.

Usage:
    python split_eclipse_data.py <input.csv> <output_dir>

Example:
    python split_eclipse_data.py espenak_5000.csv ./data

Output:
    <output_dir>/index.json          — lightweight catalogue (date, type, mag, gamma, location)
    <output_dir>/-2000_-1901.json    — full Besselian elements for that century
    <output_dir>/-1900_-1801.json
    ...
    <output_dir>/2000_2099.json
    ...etc
"""

import csv
import json
import os
import sys


# ─── Args ─────────────────────────────────────────────────────────────────────

if len(sys.argv) != 3:
    print("Usage: python split_eclipse_data.py <input.csv> <output_dir>")
    sys.exit(1)

input_file  = sys.argv[1]
output_dir  = sys.argv[2]

if not os.path.exists(input_file):
    print(f"Input file not found: {input_file}")
    sys.exit(1)

os.makedirs(output_dir, exist_ok=True)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def coerce(val):
    """Convert string to int or float if possible, else return stripped string."""
    val = val.strip().strip('"')
    if val == '':
        return None
    try:
        as_int = int(val)
        # Only return int if the value has no decimal point
        if '.' not in val:
            return as_int
    except ValueError:
        pass
    try:
        return float(val)
    except ValueError:
        return val


def century_key(year):
    """
    Return century bucket key aligned to dataset origin year (-1999).
    Buckets are 100-year spans: -1999..-1900, -1899..-1800, ..., 2900..3000

    Strategy: offset year by 1999 so that -1999 maps to 0,
    then floor-divide by 100, then reverse the offset.

        offset     = year + 1999
        bucket_num = floor(offset / 100)
        start      = bucket_num * 100 - 1999
        end        = start + 99
    """
    offset     = year + 1999
    bucket_num = offset // 100
    start      = bucket_num * 100 - 1999
    end        = start + 99
    return f"{start}_{end}"


# ─── Read & parse CSV ─────────────────────────────────────────────────────────

print(f"Reading {input_file} ...")

records = []
skipped = 0

with open(input_file, newline='', encoding='utf-8-sig') as f:
    # Use Python's csv module — handles mixed quoting robustly
    reader = csv.DictReader(f)
    header = reader.fieldnames
    print(f"Columns ({len(header)}): {', '.join(header)}")

    for row in reader:
        try:
            rec = {k: coerce(v) for k, v in row.items()}
            records.append(rec)
        except Exception as e:
            skipped += 1

print(f"Parsed {len(records):,} records. Skipped {skipped} malformed rows.")


# ─── Group by century ─────────────────────────────────────────────────────────

centuries = {}
for rec in records:
    key = century_key(rec['year'])
    if key not in centuries:
        centuries[key] = []
    centuries[key].append(rec)

print(f"Found {len(centuries)} century buckets.")

# Sanity check — print first and last few bucket names
sorted_keys = sorted(centuries.keys(), key=lambda k: int(k.split('_')[0]))
print(f"  First buckets : {sorted_keys[:3]}")
print(f"  Last buckets  : {sorted_keys[-3:]}")


# ─── Write century chunk files ────────────────────────────────────────────────

print("Writing century JSON files...")
chunk_sizes = []

for key in sorted_keys:
    recs     = centuries[key]
    out_path = os.path.join(output_dir, f"{key}.json")
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(recs, f, separators=(',', ':'))
    size = os.path.getsize(out_path)
    chunk_sizes.append(size)

print(f"Wrote {len(centuries)} century files.")


# ─── Build lightweight index ──────────────────────────────────────────────────

# Only include fields needed for browsing — keeps index small
INDEX_FIELDS = [
    'year', 'month', 'day', 'td_ge',
    'eclipse_type', 'etype',
    'gamma', 'magnitude',
    'lat_dd_ge', 'lng_dd_ge',
    'sun_alt', 'sun_azm',
    'path_width', 'central_duration', 'duration_secs',
    'saros', 'luna_num', 'cat_no',
    'julian_date', 't0',
    'nSeq', 'nSer'
]

print("Building index...")
index = []
for rec in records:
    entry = {f: rec[f] for f in INDEX_FIELDS if f in rec}
    entry['_chunk'] = century_key(rec['year'])
    index.append(entry)

index_path = os.path.join(output_dir, 'index.json')
with open(index_path, 'w', encoding='utf-8') as f:
    json.dump(index, f, separators=(',', ':'))

index_size_kb = os.path.getsize(index_path) / 1024


# ─── Summary ──────────────────────────────────────────────────────────────────

avg_kb = sum(chunk_sizes) / len(chunk_sizes) / 1024
max_kb = max(chunk_sizes) / 1024
min_kb = min(chunk_sizes) / 1024

print(f"\n✓ Done. Output summary:")
print(f"  Directory : {os.path.abspath(output_dir)}")
print(f"  Index     : index.json ({index_size_kb:.1f} KB)")
print(f"  Chunks    : {len(centuries)} century files")
print(f"  Min chunk : {min_kb:.1f} KB")
print(f"  Avg chunk : {avg_kb:.1f} KB")
print(f"  Max chunk : {max_kb:.1f} KB")
