"""tools/checks/calib.py — shared helpers for the cloud-layer harness.

Used by mkframes.py and the ad-hoc validation scripts. Nothing here is part of
the app; it exists so the assistant can fetch real imagery and LOOK at what the
module draws, which is the one thing that would have saved three days.

Needs: numpy, pillow. Network access to gibs.earthdata.nasa.gov and
view.eumetsat.int — if those are not in the sandbox egress allowlist, nothing
here works and the failure is immediate.

Companion data files, both in this directory:
  cmap.json          GIBS Clean_Longwave_Infrared_Window_Band, [r,g,b,degC] x237.
                     Refetch from
                     https://gibs.earthdata.nasa.gov/colormaps/v1.3/Clean_Longwave_Infrared_Window_Band.xml
  eum_temp_lut.json  greyscale -> degC for mtg_fd:ir105_hrfi and msg_iodc:ir108,
                     quantile-matched against GOES temperature in the overlap
                     each shares. EUMETSAT publishes no temperature scale, so
                     these are derived; monotone by construction.
"""

import io, json, math, os, urllib.request
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi"
EUM  = "https://view.eumetsat.int/geoserver/wms"
R    = 6378137.0

# ---------------------------------------------------------------- geometry

def merc(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))

def inv_merc(y):
    return math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)

def box(lon0, lat0, lon1, lat1, w=360):
    """(west, south, east, north, width, height) in EPSG:3857 metres."""
    W, S = merc(lon0, lat0); E, N = merc(lon1, lat1)
    return W, S, E, N, w, int(w * (N - S) / (E - W))

# ---------------------------------------------------------------- fetching

def get(url, timeout=120):
    raw = urllib.request.urlopen(url, timeout=timeout).read()
    return np.array(Image.open(io.BytesIO(raw)).convert("RGBA"))

def _getmap(base, layer, b, iso, timeout=120):
    W, S, E, N, w, h = b
    # NOTE: EPSG:3857 for both services. The WMS 1.3.0 axis flip applies to
    # EPSG:4326 (lat,lon); using 4326 without swapping returns an empty image
    # and NO error. EUMETSAT advertises only 4326 and serves 3857 correctly.
    return get(base + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap"
               "&LAYERS=" + urllib.parse.quote(layer) +
               "&STYLES=&CRS=EPSG%3A3857&FORMAT=image%2Fpng&TRANSPARENT=TRUE"
               "&WIDTH={w}&HEIGHT={h}&BBOX={W},{S},{E},{N}&TIME={t}".format(
                   w=w, h=h, W=W, S=S, E=E, N=N, t=urllib.parse.quote(iso)),
               timeout=timeout)

import urllib.parse  # noqa: E402  (used above)

def goes(b, iso, layer="GOES-East_ABI_Band13_Clean_Infrared", timeout=120):
    return _getmap(GIBS, layer, b, iso, timeout)

def eum(b, iso, layer="msg_fes:ir108", timeout=120):
    return _getmap(EUM, layer, b, iso, timeout)

def usable(a, floor=0.5):
    """A frame that loaded is not a frame that exists: GIBS answers a
    not-yet-published time with a valid, entirely transparent PNG. Test pixels."""
    return a is not None and float((a[..., 3] > 250).mean()) > floor and int(a[..., 0].max()) > 5

# ------------------------------------------------------------ temperature

CMAP = np.array(json.load(open(os.path.join(HERE, "cmap.json"))), float)
EUM_T = {k: np.array(v) for k, v in
         json.load(open(os.path.join(HERE, "eum_temp_lut.json"))).items()}

# Colour entries only. A pixel that is coloured at all is colder than about
# -12C by construction; searching the whole table lets a desaturated blend land
# on a GREY entry, and every grey entry is warm — measured, coloured pixels
# decoding as high as +39C, which punched white holes through storm cores.
_COLD = CMAP[CMAP[:, 3] < -11.5]

# The tabulated grey ramp stops at 179 while GOES sends greys to 197. Nearest
# matching past the end returned grey 190 -> +54C. The ramp is linear to within
# 0.24C over its 138 entries, so decode greys from the line and extrapolate.
GREY_A, GREY_B = -0.38598, 57.2375

def decode_gibs(rgb):
    """GIBS RGB -> degrees C. Mirrors tempOf() in js/satellite.js."""
    r = rgb[..., 0].astype(int); g = rgb[..., 1].astype(int); b = rgb[..., 2].astype(int)
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    grey = (mx - mn) <= 12          # saturation, not channel differences
    f = np.stack([r, g, b], -1).reshape(-1, 3).astype(float)
    d = ((f[:, None, :] - _COLD[None, :, :3]) ** 2).sum(2)
    cold = _COLD[d.argmin(1), 3].reshape(r.shape)
    return np.where(grey, GREY_A * ((r + g + b) / 3.0) + GREY_B, cold)

def decode_eum(rgb, which):
    """EUMETSAT greyscale -> degrees C. `which` is 'mtg' or 'iodc'."""
    v = rgb[..., :3].astype(float).mean(2)
    return EUM_T[which][np.clip(v, 0, 255).astype(int)]

# Kept for the older validation scripts: nearest entry over the WHOLE table,
# plus the match distance. Do NOT use this to decode imagery — see decode_gibs.
_KEYS = CMAP[:, :3].astype(np.int16)
_VALS = CMAP[:, 3]

def decode(rgb):
    f = rgb[..., :3].reshape(-1, 3).astype(np.int16)
    d = ((f[:, None, :] - _KEYS[None, :, :]) ** 2).sum(2)
    i = d.argmin(1)
    return _VALS[i].reshape(rgb.shape[:2]), np.sqrt(d.min(1)).reshape(rgb.shape[:2])

# ---------------------------------------------------------------- scoring

MASK_CLASSES = [(255, 255, 255), (0, 0, 255), (0, 255, 0)]   # cloud, sea, land

def mask_truth(a):
    """EUMETSAT msg_fes:clm / msg_iodc:clm -> (is_cloud, valid). Classify to the
    nearest of the three classes; thresholding costs ~3% because server-side
    resampling blends class edges."""
    c = a[..., :3].astype(int)
    d = np.stack([((c - np.array(t)) ** 2).sum(2) for t in MASK_CLASSES], 0)
    return (d.argmin(0) == 0), (a[..., 3] > 250)

def balanced_accuracy(pred, truth, valid):
    """Mean of hit rate and true-negative rate. Plain agreement is maximised by
    calling a cloudy scene entirely cloudy, which is the failure being hunted."""
    p, t = pred[valid], truth[valid]
    if t.sum() < 50 or (~t).sum() < 50:
        return None
    return 0.5 * (float(p[t].mean()) + float((~p[~t]).mean()))
