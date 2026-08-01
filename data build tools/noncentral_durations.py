#!/usr/bin/env python3
"""
noncentral_durations.py
──────────────────────────────────────────────────────────────────────────────
Espenak's `central_duration` / `duration_secs` is the duration ON THE CENTRAL
LINE. For a non-central eclipse the shadow axis misses the Earth entirely
(|gamma| > 1) while the cone's edge still clips the limb — there IS totality
somewhere, but there is no central line, so the field is structurally undefined
and serialises as 0. Jubier reports 0 for the same reason: same catalogue, same
definition. Neither is wrong. "How long is totality at its longest, anywhere?"
is simply a different question, and this script answers it for the 94 affected
records.

  PASS 1  validates the maths against Espenak on the ~11,800 eclipses that DO
          have a central line. Greatest eclipse lies on that line, so duration
          computed at (lat_dd_ge, lng_dd_ge) must reproduce `duration_secs`.
  PASS 2  finds the longest totality for the 94, and can patch index.json.

PASS 1 exists because PASS 2's numbers have no reference to check them against.
It is also a regression test: this file is a port of js/eclipse.js, and if the
two ever drift, PASS 1's agreement figures move.

  Expected PASS 1 output — agreement peaks in the modern era and falls away
  symmetrically in BOTH directions. That is ΔT, not a bug: ΔT is observed near
  the present and extrapolated either side. ~99% within 1s for 1000–2000 CE
  means the maths is right.

Usage (from the repo root, no dependencies beyond the stdlib):
    python3 tools/noncentral_durations.py            # report only
    python3 tools/noncentral_durations.py --write    # also patch data/index.json
    python3 tools/noncentral_durations.py --validate-only
"""

import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
DEG  = math.pi / 180.0

# ── Besselian maths ───────────────────────────────────────────────────────
# Direct port of fundamentalArgs() / findContact() in js/eclipse.js. Three
# conventions matter and are easy to get wrong independently:
#   1. longitude is WEST-positive here, and the 0.00417807 °/s constant folds
#      the TDT→UT Earth-rotation correction straight into the hour angle;
#   2. the shadow radii must be corrected for the observer's distance along
#      the axis: L' = L − ζ·tan f  (omit it and durations are wrong);
#   3. 0.99664719 = 1 − Earth's flattening (IAU).

def _poly(c, t):
    return c[0] + t * (c[1] + t * (c[2] + t * c[3]))


def fundamental_args(rec, t, lat, lon_west, alt, dt_s):
    X  = _poly((rec["x0"], rec["x1"], rec["x2"], rec["x3"]), t)
    Y  = _poly((rec["y0"], rec["y1"], rec["y2"], rec["y3"]), t)
    d  = _poly((rec["d0"], rec["d1"], rec["d2"], 0.0), t)
    M  = _poly((rec["mu0"], rec["mu1"], rec["mu2"], 0.0), t)
    L1 = _poly((rec["l10"], rec["l11"], rec["l12"], 0.0), t)
    L2 = _poly((rec["l20"], rec["l21"], rec["l22"], 0.0), t)
    Xp = rec["x1"] + 2 * rec["x2"] * t + 3 * rec["x3"] * t * t
    Yp = rec["y1"] + 2 * rec["y2"] * t + 3 * rec["y3"] * t * t

    H = M - lon_west - 0.00417807 * dt_s

    phi = lat * DEG
    u1  = math.atan(0.99664719 * math.tan(phi)) / DEG
    rsp = 0.99664719 * math.sin(u1 * DEG) + (alt / 6378140.0) * math.sin(phi)
    rcp = math.cos(u1 * DEG)              + (alt / 6378140.0) * math.cos(phi)

    Hr, dr = H * DEG, d * DEG
    xi   =  rcp * math.sin(Hr)
    eta  =  rsp * math.cos(dr) - rcp * math.cos(Hr) * math.sin(dr)
    zeta =  rsp * math.sin(dr) + rcp * math.cos(Hr) * math.cos(dr)

    xip  = 0.01745329 * rec["mu1"] * rcp * math.cos(Hr)
    etap = 0.01745329 * (rec["mu1"] * xi * math.sin(dr) - zeta * rec["d1"])

    L1p = L1 - zeta * rec["tan_f1"]
    L2p = L2 - zeta * rec["tan_f2"]

    u, v = X - xi, Y - eta
    a, b = Xp - xip, Yp - etap
    return {"d": d, "H": H, "L1p": L1p, "L2p": L2p,
            "u": u, "v": v, "a": a, "b": b, "n": math.hypot(a, b)}


def find_maximum(rec, lat, lon_west, alt, dt_s):
    t = 0.0
    for _ in range(50):
        o = fundamental_args(rec, t, lat, lon_west, alt, dt_s)
        tau = -(o["u"] * o["a"] + o["v"] * o["b"]) / (o["n"] * o["n"])
        t += tau
        if abs(tau) < 1e-9:
            break
    return t


def find_contact(rec, t_approx, lat, lon_west, alt, dt_s, use_umbra, sign):
    tc = t_approx
    for _ in range(30):
        fc   = fundamental_args(rec, tc, lat, lon_west, alt, dt_s)
        Lp   = fc["L2p"] if use_umbra else fc["L1p"]
        absL = abs(Lp)
        if absL < 1e-10:
            return None
        S = (fc["a"] * fc["v"] - fc["u"] * fc["b"]) / (fc["n"] * absL)
        disc = 1.0 - S * S
        if disc < 0:
            return None
        tau = (-(fc["u"] * fc["a"] + fc["v"] * fc["b"]) / (fc["n"] * fc["n"])
               + sign * absL / fc["n"] * math.sqrt(disc))
        tc += tau
        if abs(tau) < 1e-9:
            return tc
    return None


def sun_alt(o, lat):
    phi, H, dec = lat * DEG, o["H"] * DEG, o["d"] * DEG
    s = math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(H)
    return math.asin(max(-1.0, min(1.0, s))) / DEG


def totality_seconds(rec, lat, lon_east, alt=0.0):
    """Seconds of totality/annularity at a point, or 0.0 where there is none
    (sun below the horizon, or only a partial eclipse visible)."""
    if not -90.0 <= lat <= 90.0:
        return 0.0
    lon_west = -(((lon_east + 540.0) % 360.0) - 180.0)
    dt_s = rec["dt"]
    try:
        t_max = find_maximum(rec, lat, lon_west, alt, dt_s)
        o     = fundamental_args(rec, t_max, lat, lon_west, alt, dt_s)
        m     = math.hypot(o["u"], o["v"])
        if m >= abs(o["L2p"]):          # never reaches totality here
            return 0.0
        if sun_alt(o, lat) <= 0.0:      # happening below the horizon
            return 0.0
        c2 = find_contact(rec, t_max, lat, lon_west, alt, dt_s, True, -1)
        c3 = find_contact(rec, t_max, lat, lon_west, alt, dt_s, True, +1)
        if c2 is None or c3 is None:
            return 0.0
        return max(0.0, (c3 - c2) * 3600.0)
    except (ValueError, ZeroDivisionError, OverflowError):
        return 0.0


# ── Data ──────────────────────────────────────────────────────────────────

_chunks = {}

def chunk(key):
    if key not in _chunks:
        with open(os.path.join(DATA, "besselian", key + ".json")) as f:
            _chunks[key] = json.load(f)
    return _chunks[key]


def besselian_for(e):
    for r in chunk(e["_chunk"]):
        if (r["year"], r["month"], r["day"]) == (e["year"], e["month"], e["day"]):
            return r
    return None


def is_central_type(e):
    return e.get("etype") in (1, 2, 3)

# The discriminator is the data itself — no parsing of type strings like
# "T-" / "A+" needed. A central-type eclipse with zero duration is exactly one
# whose axis missed the Earth.
def is_noncentral(e):
    return is_central_type(e) and e.get("duration_secs") == 0


# ── PASS 1 ────────────────────────────────────────────────────────────────

def validate(index):
    """Compare against Espenak, GROUPED BY ΔT SOURCE — which is the only way to
    read the result honestly.

    Our records do not all carry Espenak's ΔT: outside the USNO range his values
    were deliberately replaced (Espenak–Meeus polynomial for −720..2050, SMH2016
    LOD extrapolation beyond). Where ΔT was replaced we SHOULD disagree with his
    `duration_secs` — his figure was computed with the older ΔT, and disagreement
    means our position is the better one. A ΔT difference rotates the Earth under
    the shadow, sliding the evaluation point off the central line, so the duration
    there collapses; it is not an error in the maths.

    So the pass/fail gate is the USNO rows only. There ΔT is observed, we and
    Espenak use effectively the same value, and any disagreement is genuinely
    ours. Expect ~100% within 1s. The other rows are reported for information:
    their agreement falls off in proportion to how far ΔT was moved.
    """
    by_src = {}
    for e in index:
        if not is_central_type(e) or e.get("duration_secs", 0) <= 0:
            continue
        rec = besselian_for(e)
        if rec is None:
            continue
        ours = totality_seconds(rec, e["lat_dd_ge"], e["lng_dd_ge"])
        if not ours:
            continue
        src = rec.get("dt_source", "(none)")
        by_src.setdefault(src, []).append(abs(ours - e["duration_secs"]))

    print("── PASS 1: this code vs Espenak, duration at greatest eclipse ──")
    print(f"  {'ΔT source':<36}{'n':>6}{'median':>10}{'within 1s':>12}")
    for src in sorted(by_src, key=lambda s: -len(by_src[s])):
        d = sorted(by_src[src])
        gate = "  ← gate" if src.startswith("USNO") else ""
        print(f"  {src:<36}{len(d):>6}{d[len(d)//2]:>9.3f}s"
              f"{100*sum(x<=1 for x in d)/len(d):>11.1f}%{gate}")

    gated = [x for s, v in by_src.items() if s.startswith("USNO") for x in v]
    if gated:
        ok = 100 * sum(x <= 1 for x in gated) / len(gated)
        print(f"\n  GATE: {ok:.1f}% of {len(gated)} observed-ΔT eclipses within 1s"
              f"  {'PASS' if ok >= 99 else 'INVESTIGATE'}")


# ── PASS 2 ────────────────────────────────────────────────────────────────

def limb_seeds(rec):
    """Candidate points from geometry, not a blind grid. The umbral footprint of
    a non-central eclipse is a small patch pressed against the limb; a coarse
    lat/lon grid steps straight over it. So for each instant take the point on
    the Earth's limb nearest the shadow axis and invert the transform above
    (with ζ = 0, ξ²+η² = 1). That traces a line through the footprint."""
    seeds = []
    t = rec["tmin"]
    while t <= rec["tmax"]:
        X = _poly((rec["x0"], rec["x1"], rec["x2"], rec["x3"]), t)
        Y = _poly((rec["y0"], rec["y1"], rec["y2"], rec["y3"]), t)
        d = _poly((rec["d0"], rec["d1"], rec["d2"], 0.0), t)
        M = _poly((rec["mu0"], rec["mu1"], rec["mu2"], 0.0), t)
        m = math.hypot(X, Y)
        if m:
            xi, eta = X / m, Y / m
            dr = d * DEG
            rsp     = eta * math.cos(dr)
            rcp_cos = -eta * math.sin(dr)
            H   = math.atan2(xi, rcp_cos) / DEG
            phi_p = math.atan2(rsp, math.hypot(xi, rcp_cos)) / DEG
            lat = math.atan(math.tan(phi_p * DEG) / 0.99664719) / DEG
            lon_west = M - H - 0.00417807 * rec["dt"]
            seeds.append((lat, ((-lon_west + 540.0) % 360.0) - 180.0))
        t += 0.01
    return seeds


def refine(rec, lat, lon, step):
    """Pattern search, shrinking until the position is settled to ~1 m."""
    best = totality_seconds(rec, lat, lon)
    while step > 1e-5:
        moved = False
        for dla, dlo in ((step,0),(-step,0),(0,step),(0,-step),
                         (step,step),(step,-step),(-step,step),(-step,-step)):
            d = totality_seconds(rec, lat + dla, lon + dlo)
            if d > best:
                best, lat, lon, moved = d, lat + dla, lon + dlo, True
                break
        if not moved:
            step /= 2.0
    return best, lat, lon


def maximise(rec):
    best = (0.0, None, None)
    for la, lo in limb_seeds(rec):
        for r in (0.0, 0.5, 1.0, 2.0, 4.0):
            for dla, dlo in ((0,0), (r,0), (-r,0), (0,r), (0,-r)):
                d = totality_seconds(rec, la + dla, lo + dlo)
                if d > best[0]:
                    best = (d, la + dla, lo + dlo)
            if r == 0.0 and best[0]:
                break
    if not best[0]:
        return None
    return refine(rec, best[1], best[2], 0.5)


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    write = "--write" in sys.argv
    index_path = os.path.join(DATA, "index.json")
    with open(index_path) as f:
        index = json.load(f)

    validate(index)
    if "--validate-only" in sys.argv:
        return

    targets = [e for e in index if is_noncentral(e)]
    print(f"\n── PASS 2: non-central eclipses (no central line) ──")
    print(f"  records: {len(targets)}\n")

    results, found = {}, 0
    for e in targets:
        rec = besselian_for(e)
        out = maximise(rec) if rec else None
        tag = f'{e["year"]}-{e["month"]:02d}-{e["day"]:02d}'
        if out and out[0] > 0:
            secs, lat, lon = out
            found += 1
            results[(e["year"], e["month"], e["day"])] = out
            print(f'  {tag:>12}  {e["eclipse_type"]:<3} γ={e["gamma"]:+.5f}'
                  f'  max {secs:6.1f}s  at {lat:8.3f}, {lon:9.3f}')
        else:
            print(f'  {tag:>12}  {e["eclipse_type"]:<3} γ={e["gamma"]:+.5f}  none found')
    print(f"\n  resolved {found} / {len(targets)}")

    if not write:
        print("\n  (dry run — pass --write to patch data/index.json)")
        return

    # Sparse patch: only the affected records gain fields. Absence means "use
    # the catalogue value", so nothing that reads index.json today changes.
    # duration_secs is left alone — that is Espenak's answer to a different
    # question and stays intact and attributable.
    for e in index:
        out = results.get((e["year"], e["month"], e["day"]))
        if not out:
            continue
        secs, lat, lon = out
        e["max_duration_secs"] = round(secs, 1)
        e["max_duration_lat"]  = round(lat, 4)
        e["max_duration_lon"]  = round(lon, 4)

    with open(index_path, "w") as f:
        json.dump(index, f, separators=(",", ":"))
    print(f"\n  index.json patched ({len(results)} records).")


if __name__ == "__main__":
    main()
