"""Does rounding the background timestamps change what the map calls cloud?

Builds the clear-sky reference TWICE from the same live frame:
  exact   - the shipped stamps (now - n days, snapped to the satellite step)
  shifted - the same stamps moved by OFFSET minutes, the worst case of rounding
Then reports the cloud fraction each produces, using the app's own depression
rule, and the per-pixel disagreement.
"""
import sys, json, math, base64, datetime
import numpy as np
import os; HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from calib import goes, eum

R = 6378137.0
def mY(l): return R * math.log(math.tan(math.pi / 4 + l * math.pi / 360))

SATS = {
 'goes-east': dict(id='goes-east', lon=-75.2, svc='gibs', step=10,
                   layer='GOES-East_ABI_Band13_Clean_Infrared'),
 'himawari':  dict(id='himawari', lon=140.7, svc='gibs', step=10,
                   layer='Himawari_AHI_Band13_Clean_Infrared'),
}
GA, GB = -0.38598, 57.2375
cm = np.array(json.load(open(os.path.join(HERE, 'cmap.json'))), float)
cold = cm[cm[:, 3] < -11.5]

def temp(a):
    r = a[..., 0].astype(int); g = a[..., 1].astype(int); b = a[..., 2].astype(int)
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    grey = (mx - mn) <= 12
    f = np.stack([r, g, b], -1).reshape(-1, 3).astype(float)
    d = ((f[:, None, :] - cold[None, :, :3]) ** 2).sum(2)
    return np.where(grey, GA * ((r + g + b) / 3.0) + GB, cold[d.argmin(1), 3].reshape(r.shape))

def fetch(sat, bx, pw, ph, when):
    b = (R * math.radians(bx['w']), mY(bx['s']), R * math.radians(bx['e']), mY(bx['n']), pw, ph)
    for k in range(0, 7):
        t = when - datetime.timedelta(minutes=sat['step'] * k)
        t = t.replace(second=0, microsecond=0, minute=t.minute // sat['step'] * sat['step'])
        iso = t.strftime("%Y-%m-%dT%H:%M:00Z")
        try:
            a = goes(b, iso, sat['layer'])
        except Exception:
            continue
        if (a[..., 3] > 250).mean() > 0.02:
            return a, iso
    return None, None

def build(sat, box, pw, ph, base, offset_min, days=10):
    """Second-warmest of `days` past frames, same clock time each day."""
    st = []
    for n in range(1, days + 1):
        when = base - datetime.timedelta(minutes=n * 1440 - offset_min)
        a, _ = fetch(sat, box, pw, ph, when)
        if a is None: continue
        st.append(np.where(a[..., 3] > 250, temp(a), -999.0))
    if not st: return None
    S = np.sort(np.stack(st), axis=0)
    sec = S[-2] if len(st) > 1 else S[-1]
    return np.where(sec < -900, S[-1], sec)

satname, lon, lat, offset = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
sat = SATS[satname]
span = 40.0
box = {'w': lon - span / 2, 'e': lon + span / 2, 's': lat - span / 4, 'n': lat + span / 4}
pw = 512
ph = int(round(pw * (mY(box['n']) - mY(box['s'])) / (R * math.radians(box['e'] - box['w']))))

now = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
live, liveiso = fetch(sat, box, pw, ph, now)
if live is None:
    print("no live frame"); sys.exit(1)
Tlive = np.where(live[..., 3] > 250, temp(live), np.nan)
print("live frame %s  %dx%d  box %s" % (liveiso, pw, ph, {k: round(v, 1) for k, v in box.items()}))

A = build(sat, box, pw, ph, now, 0)
B = build(sat, box, pw, ph, now, offset)
if A is None or B is None:
    print("background build failed"); sys.exit(1)

valid = ~np.isnan(Tlive)
print("ground reference differs by: mean %.2f degC, 95th pct %.2f, max %.2f"
      % (np.abs(A - B)[valid].mean(),
         np.percentile(np.abs(A - B)[valid], 95),
         np.abs(A - B)[valid].max()))

for thr in (2.0, 4.0, 8.0):
    ca = ((A - Tlive) > thr)[valid].mean() * 100
    cb = ((B - Tlive) > thr)[valid].mean() * 100
    dis = (((A - Tlive) > thr) != ((B - Tlive) > thr))[valid].mean() * 100
    print("  depression > %4.1f degC: cloud %5.1f%% exact vs %5.1f%% shifted   "
          "pixels that disagree %4.1f%%" % (thr, ca, cb, dis))
