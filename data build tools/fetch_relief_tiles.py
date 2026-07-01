#!/usr/bin/env python3
"""
Fetch Esri World Shaded Relief tiles for ShadowChaser's OFFLINE basemap.
PARALLEL version — fetches many tiles at once (latency-bound otherwise).

Run locally (needs internet):
    python3 "data build tools/fetch_relief_tiles.py"

Writes to:   data/basemap/relief_tiles/{z}/{y}/{x}.jpg
Re-runnable: skips tiles already on disk. Resumable: kill and rerun anytime.
Prints total size at the end.

MAX_Z 6 ≈ sub-country/regional detail. Bump to 7 for finer (~4x more tiles).
WORKERS: parallel requests. 12 is polite+fast; lower it if Esri starts failing.

If World_Shaded_Relief 404s, swap SERVICE for: World_Hillshade | World_Terrain_Base
"""
import os, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

SERVICE = "World_Shaded_Relief"
BASE    = f"https://server.arcgisonline.com/ArcGIS/rest/services/{SERVICE}/MapServer/tile/"
MAX_Z   = 6
WORKERS = 12
OUT     = os.path.join(os.path.dirname(__file__), "..", "data", "basemap", "relief_tiles")
HEADERS = {"User-Agent": "ShadowChaser-offline-cache/1.0"}

def fetch_one(z, y, x, retries=3):
    path = os.path.join(OUT, str(z), str(y), f"{x}.jpg")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return "skip"
    url = f"{BASE}{z}/{y}/{x}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(data)
            return "got"
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "404"
            time.sleep(0.5 * (attempt + 1))
        except Exception:
            time.sleep(0.5 * (attempt + 1))
    return "fail"

def main():
    tiles = [(z, y, x) for z in range(MAX_Z + 1)
                       for y in range(2 ** z)
                       for x in range(2 ** z)]
    print(f"{len(tiles)} tiles total (z0-{MAX_Z}), {WORKERS} workers…", flush=True)
    counts = {"got": 0, "skip": 0, "404": 0, "fail": 0}
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = {ex.submit(fetch_one, z, y, x): (z, y, x) for (z, y, x) in tiles}
        for fut in as_completed(futures):
            counts[fut.result()] += 1
            done += 1
            if done % 500 == 0:
                print(f"  {done}/{len(tiles)}  got={counts['got']} skip={counts['skip']} fail={counts['fail']}", flush=True)

    total = 0
    for root, _, files in os.walk(OUT):
        for fn in files:
            total += os.path.getsize(os.path.join(root, fn))
    print(f"\nDone. got={counts['got']} skip={counts['skip']} 404={counts['404']} fail={counts['fail']}")
    print(f"Total cache size: {total/1e6:.1f} MB at {OUT}")
    if counts["fail"]:
        print("Some tiles failed — just rerun; it resumes and retries the gaps.")

if __name__ == "__main__":
    main()
