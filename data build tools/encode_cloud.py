#!/usr/bin/env python3
"""
encode_cloud.py — turn a cloud_MM.npz into the 8 WebP slices the app loads.

Goes in:  data build tools/
Run from: repo root, after gen_cloud_climatology.py

    python "data build tools/encode_cloud.py" 8        # one month
    python "data build tools/encode_cloud.py"          # every npz present

Writes    data/cloud/cloud_MM_HH.webp   (HH = local solar hour, 00..21 step 3)
Grid is 720x361, equirectangular, north-first, cell-centred on 0.5 deg.
Pixel value = cloud fraction * 250.  The app reads the red channel.

q=95 was chosen by measurement, not taste: mean error 0.31 percentage points,
p99 1.2, worst 3.6 — comfortably inside ERA5's own bias against observed cloud,
at a third the bytes of lossless. Do not "improve" it to lossless without
re-checking the payload budget in the service worker.
"""

import sys, pathlib, numpy as np
from PIL import Image

QUALITY = 95
OUTDIR  = pathlib.Path("data/cloud")


def encode(npz_path):
    z      = np.load(npz_path)
    data   = z["data"]                      # (8, 361, 720) uint8
    hours  = z["lst_hours"]
    month  = int(z["month"])
    OUTDIR.mkdir(parents=True, exist_ok=True)

    total = 0
    for i, h in enumerate(hours):
        out = OUTDIR / f"cloud_{month:02d}_{int(h):02d}.webp"
        Image.fromarray(data[i], mode="L").save(
            out, format="WEBP", quality=QUALITY, method=6)
        total += out.stat().st_size
    print(f"month {month:02d}: {len(hours)} files, {total/1024:.0f} KB")
    return total


if __name__ == "__main__":
    if len(sys.argv) > 1:
        paths = [OUTDIR / f"cloud_{int(sys.argv[1]):02d}.npz"]
    else:
        paths = sorted(OUTDIR.glob("cloud_[0-9][0-9].npz"))
    if not paths:
        sys.exit("no cloud_MM.npz found in data/cloud/")
    grand = sum(encode(p) for p in paths)
    print(f"total {grand/1048576:.2f} MB")
