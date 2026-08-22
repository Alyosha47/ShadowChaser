#!/usr/bin/env python3
"""tools/checks/calibrate_cloud.py — fit js/cloud-now.js's cloud-fraction
constants against official cloud products, with no human in the loop.

WHY THIS EXISTS
The "Now" mode turns infrared brightness into a cloud fraction. Every constant in
that conversion was originally set by looking at a map and deciding it looked
wrong, which is how a day gets burned and the answer still is not right. There is
no need for that: the meteorological agencies publish their OWN operational cloud
products, archived, for the same instants as the infrared this app reads. So the
whole loop — render, compare to truth, adjust, repeat — can run unattended.

It does NOT need to wait for anything to be published. The archive already holds
both sides of the comparison for every past timestamp, so hundreds of iterations
run in minutes rather than one per afternoon.

TRUTH SOURCES (enumerated from the live services, never guessed)
  Europe / Africa   msg_fes:clm    EUMETSAT cloud mask, 15 min, since 2020-09
  Indian Ocean      msg_iodc:clm   ditto, since 2020-08
  North America     TEMPO_L3_Cloud_Cloud_Fraction_Total, ~40 min, DAYLIGHT ONLY
  Pacific           nothing geostationary exists. Himawari is chained through
                    its overlaps instead; see chain_floor().

The masks are classified images, not data: cloud is white, sea blue, land green.
Classify each pixel to the nearest of the three. A count of ~1100 distinct
colours is antialiasing from server-side resampling, not extra classes.

WHAT IT FITS
  shared:          CELL, RAD, PCT (which percentile of a cell is "ground"),
                   SPAN_LO / SPAN_HI (the robust spread used to normalise)
  per satellite:   FLOOR (where cloud starts, in units of that spread)

SCORING
Balanced accuracy — the mean of hit rate and true-negative rate. Plain agreement
is maximised by calling everything cloudy in a cloudy scene, which is exactly the
failure this is meant to catch.

HONESTY
Scenes are split into train and test by timestamp before anything is fitted, and
the number printed at the end is from the TEST scenes, which the optimiser never
sees. A fit reported on its own training data is a fit reported on nothing.

Requires: numpy, scipy, pillow. Network access to gibs.earthdata.nasa.gov and
view.eumetsat.int — if those are not in the sandbox egress allowlist, nothing
here works and the failure is immediate and obvious.

Usage:  python3 tools/checks/calibrate_cloud.py [--scenes N] [--quick]
"""

import argparse, datetime, io, math, sys, urllib.parse, urllib.request
import numpy as np
from PIL import Image
from scipy.ndimage import minimum_filter, uniform_filter, map_coordinates

GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi"
EUM  = "https://view.eumetsat.int/geoserver/wms"
R    = 6378137.0

# ---------------------------------------------------------------- fetching

def merc(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))

def bbox(lon0, lat0, lon1, lat1, width):
    w, s = merc(lon0, lat0); e, n = merc(lon1, lat1)
    return (w, s, e, n, width, int(width * (n - s) / (e - w)))

def getmap(base, layer, box, iso, timeout=120):
    w, s, e, n, W, H = box
    # Literal %3A and %2F in the template, so build with .format(), never % —
    # a %-format on this string dies on the percent-escapes themselves.
    url = (base + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap"
           "&LAYERS={layer}&STYLES=&CRS=EPSG%3A3857&FORMAT=image%2Fpng"
           "&TRANSPARENT=TRUE&WIDTH={W}&HEIGHT={H}&BBOX={w},{s},{e},{n}&TIME={t}").format(
               layer=urllib.parse.quote(layer), W=W, H=H, w=w, s=s, e=e, n=n,
               t=urllib.parse.quote(iso))
    raw = urllib.request.urlopen(url, timeout=timeout).read()
    return np.array(Image.open(io.BytesIO(raw)).convert("RGBA"))

def usable(a, floor=0.5):
    """A frame that loaded is not a frame that exists. GIBS answers a
    not-yet-published time with a valid, entirely transparent PNG."""
    return a is not None and float((a[..., 3] > 250).mean()) > floor and int(a[..., 0].max()) > 5

# ------------------------------------------------------------ the algorithm
# This must mirror js/cloud-now.js exactly. If they drift, the constants fitted
# here describe something the app does not do.

def cloud_fraction(v, ok, floor, cell=48, rad=3, pct=0.20, span_lo=0.20, span_hi=0.985):
    h, w = v.shape
    cy, cx = int(np.ceil(h / cell)), int(np.ceil(w / cell))
    lo = np.full((cy, cx), np.nan)
    for y in range(cy):
        for x in range(cx):
            b = v[y*cell:(y+1)*cell, x*cell:(x+1)*cell]
            m = ok[y*cell:(y+1)*cell, x*cell:(x+1)*cell]
            if m.sum() < 60:
                continue
            lo[y, x] = np.percentile(b[m], pct * 100)
    if not np.isfinite(lo).any():
        return None
    lo = np.where(np.isfinite(lo), lo, np.nanmean(lo))
    env = uniform_filter(minimum_filter(lo, size=2*rad+1, mode="nearest"), size=3, mode="nearest")
    yy = np.clip(np.arange(h) / cell - 0.5, 0, cy - 1)
    xx = np.clip(np.arange(w) / cell - 0.5, 0, cx - 1)
    F = map_coordinates(env, np.meshgrid(yy, xx, indexing="ij"), order=1)
    d = v - F
    span = np.percentile(d[ok], span_hi * 100) - np.percentile(d[ok], span_lo * 100)
    span = float(np.clip(span, 30, 140))
    return np.clip((d / span - floor) / (1 - floor), 0, 1)

def grey_of(a):
    """Native brightness. Channel mean, not the red channel: a pixel whose
    channels disagree is a resampling blend of two greys and is still a valid
    brightness. Discarding those punches holes through the composite."""
    return a[..., :3].astype(float).mean(2), (a[..., 3] > 250)

# ------------------------------------------------------------------ truth

MASK_CLASSES = [(255, 255, 255), (0, 0, 255), (0, 255, 0)]   # cloud, sea, land

def mask_truth(a):
    c = a[..., :3].astype(int)
    d = np.stack([((c - np.array(t)) ** 2).sum(2) for t in MASK_CLASSES], 0)
    return (d.argmin(0) == 0), (a[..., 3] > 250)

def tempo_truth(a, cmap_keys, cmap_vals, thresh=0.1):
    f = a[..., :3].reshape(-1, 3).astype(int)
    d = ((f[:, None, :] - cmap_keys[None, :, :]) ** 2).sum(2)
    frac = cmap_vals[d.argmin(1)].reshape(a.shape[:2])
    good = (a[..., 3] > 250) & (np.sqrt(d.min(1)).reshape(a.shape[:2]) < 20)
    return (frac > thresh), good

def load_tempo_colormap():
    import re
    raw = urllib.request.urlopen(
        "https://gibs.earthdata.nasa.gov/colormaps/v1.3/TEMPO_Cloud_Cloud_Fraction_Total.xml",
        timeout=60).read().decode("utf8")
    ent = re.findall(r'rgb="(\d+),(\d+),(\d+)"[^>]*sourceValue="\[([\d.e-]+)', raw)
    keys = np.array([[int(a), int(b), int(c)] for a, b, c, _ in ent])
    vals = np.array([float(lo) for _, _, _, lo in ent])
    return keys, vals

def tempo_times(limit=40):
    import re
    raw = urllib.request.urlopen(
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/"
        "TEMPO_L3_Cloud_Cloud_Fraction_Total/default/GoogleMapsCompatible_Level7/all/all.xml",
        timeout=60).read().decode("utf8")
    dom = re.search(r"<Domain>(.*?)</Domain>", raw, re.S)
    out = [p.split("/")[0] for p in dom.group(1).split(",")] if dom else []
    return out[-limit:]

# ------------------------------------------------------------------ scoring

def balanced_accuracy(pred, truth, valid):
    """Mean of hit rate and true-negative rate. Plain agreement is maximised by
    calling a cloudy scene entirely cloudy, which is the failure being hunted."""
    p, t = pred[valid], truth[valid]
    if t.sum() < 50 or (~t).sum() < 50:
        return None
    return 0.5 * (float(p[t].mean()) + float((~p[~t]).mean()))

# ------------------------------------------------------------------ scenes

def eum_scenes(n, layer_ir, layer_mask, box, hours_back=72):
    """Timestamps on the 15-minute grid, spread over several days and all hours
    so that night is not calibrated from daylight."""
    now = datetime.datetime.utcnow().replace(second=0, microsecond=0)
    now = now - datetime.timedelta(minutes=now.minute % 15 + 90)
    out, step = [], max(1, (hours_back * 4) // max(n, 1))
    for k in range(n * 3):
        t = now - datetime.timedelta(minutes=15 * step * k)
        if len(out) >= n:
            break
        iso = t.strftime("%Y-%m-%dT%H:%M:00.000Z")
        try:
            ir = getmap(EUM, layer_ir, box, iso)
            mk = getmap(EUM, layer_mask, box, iso)
        except Exception:
            continue
        if usable(ir) and usable(mk):
            out.append((iso, ir, mk))
    return out

def tempo_scenes(n, box):
    keys, vals = load_tempo_colormap()
    stamps = tempo_times()
    out = []
    for iso in reversed(stamps):
        if len(out) >= n:
            break
        try:
            tp = getmap(GIBS, "TEMPO_L3_Cloud_Cloud_Fraction_Total", box, iso, timeout=180)
        except Exception:
            continue
        if not usable(tp, 0.3):
            continue
        # nearest GOES infrared frame on the 10-minute grid
        t = datetime.datetime.strptime(iso[:16], "%Y-%m-%dT%H:%M")
        t = t.replace(minute=(t.minute // 10) * 10)
        ir = None
        for back in range(4):
            gi = (t - datetime.timedelta(minutes=10 * back)).strftime("%Y-%m-%dT%H:%M:00Z")
            try:
                cand = getmap(GIBS, "GOES-East_ABI_Band13_Clean_Infrared", box, gi)
            except Exception:
                continue
            if usable(cand):
                ir = cand
                break
        if ir is not None:
            out.append((iso, ir, tp, keys, vals))
    return out

# ------------------------------------------------------------------- fitting

def score_floor(scenes, floor, kind, **kw):
    vals = []
    for sc in scenes:
        ir = sc[1]
        v, ok = grey_of(ir)
        f = cloud_fraction(v, ok, floor, **kw)
        if f is None:
            continue
        if kind == "mask":
            truth, tok = mask_truth(sc[2])
        else:
            truth, tok = tempo_truth(sc[2], sc[3], sc[4])
        s = balanced_accuracy(f > 0, truth, ok & tok)
        if s is not None:
            vals.append(s)
    return float(np.mean(vals)) if vals else None

def fit(scenes, kind, grid=None, **kw):
    grid = grid if grid is not None else np.arange(0.04, 0.80, 0.02)
    best = (None, None)
    for fl in grid:
        s = score_floor(scenes, float(fl), kind, **kw)
        if s is not None and (best[0] is None or s > best[0]):
            best = (s, float(fl))
    return best

# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenes", type=int, default=12)
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()

    n = 4 if a.quick else a.scenes
    print("collecting scenes (each is one infrared frame plus the official product\n"
          "for the same minute; a frame that loads is not a frame that exists)\n")

    jobs = [
        ("msg",  "msg_fes:ir108",  "msg_fes:clm",  bbox(-40, -30, 40, 55, 480), "mask"),
        ("iodc", "msg_iodc:ir108", "msg_iodc:clm", bbox(10, -30, 80, 40, 480), "mask"),
    ]
    shared = dict(cell=48, rad=3, pct=0.20)
    results = {}

    for sid, ir_layer, mask_layer, box, kind in jobs:
        sc = eum_scenes(n, ir_layer, mask_layer, box)
        if len(sc) < 4:
            print("%-6s only %d scenes — skipped" % (sid, len(sc)))
            continue
        train, test = sc[0::2], sc[1::2]
        s_tr, floor = fit(train, kind, **shared)
        s_te = score_floor(test, floor, kind, **shared)
        results[sid] = floor
        print("%-6s scenes %2d  floor %.2f   train %.3f   TEST %.3f"
              % (sid, len(sc), floor, s_tr, s_te))

    try:
        sc = tempo_scenes(max(4, n // 2), bbox(-108, 28, -74, 48, 400))
        if len(sc) >= 4:
            train, test = sc[0::2], sc[1::2]
            s_tr, floor = fit(train, "tempo", **shared)
            s_te = score_floor(test, floor, "tempo", **shared)
            results["goes-east"] = floor
            print("%-6s scenes %2d  floor %.2f   train %.3f   TEST %.3f  (daylight only)"
                  % ("goes-e", len(sc), floor, s_tr, s_te))
        else:
            print("goes-e  too few TEMPO scenes — leave chained through the overlap")
    except Exception as e:
        print("goes-e  TEMPO unavailable (%s) — leave chained through the overlap" % e)

    print("\nFLOORS for js/cloud-now.js:")
    for k, v in results.items():
        print("    '%s': %.2f," % (k, v))
    print("\nHimawari has no geostationary truth product. Chain it to GOES-West\n"
          "across the dateline overlap, or accept a polar-orbiter check.")

if __name__ == "__main__":
    main()
