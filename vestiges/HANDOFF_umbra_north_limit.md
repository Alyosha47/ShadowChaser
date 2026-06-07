# HANDOFF — Truncated north umbral limit (path generator)

**Scope of this thread: ONE bug.** The northern umbral limit of some eclipses is
traced only part of its true length, producing a short north edge paired with a
full-length south edge. Do not refactor anything else. Do not touch the web app —
the renderer is faithfully drawing bad data.

---

## 1. The symptom (confirmed)

For the **total eclipse of 2600-05-05** (a North-Atlantic path: Greenland → Iceland
→ UK/Norway), the rendered umbral corridor is lopsided: the **north limit line stops
about halfway** along the path while the **south limit runs full length**. The
closed-fill polygon and the eastern end-cap then make extreme diagonal contortions to
connect the short north edge to the far end of the south edge.

This was initially mis-diagnosed (twice) as a renderer bug. It is **not**. The path
DATA itself is asymmetric.

## 2. Proof it is a data bug, not a rendering bug

Path data lives in `ShadowChaser/data/paths/paths_2501_2600.json.gz`, keyed by
catalogue index string. **The correct record for 2600-05-05 is key `10926`** (NOT
`10705` — `index.json` ordering does NOT match the paths-file keys; always confirm a
record by its own `year`/`month`/`day` fields, not by index position).

Measured directly from the gz (each edge is a list of segments; `[0]` is the only
segment for this record):

```
key 10926, type T, 2600-05-05
  umbra_s (south limit): 388 pts, lon[-92.7, +9.7], lat[45.5, 82.3]   <- full arc
  umbra_n (north limit): 111 pts, lon[-15.8, -3.6], lat[48.1, 59.0]   <- short stub
```

The south edge spans ~100° of longitude and reaches lat 82°; the north edge covers
only ~12° of longitude and never leaves the UK/Iceland region. In reality the two
umbral limits should run roughly parallel for the whole length of the path. The north
limit is being **cut short during generation**.

Quick repro:
```python
import gzip, json
d = json.load(gzip.open('ShadowChaser/data/paths/paths_2501_2600.json.gz'))
ep = next(ep for ep in d.values()
          if ep.get('year')==2600 and ep.get('month')==5 and ep.get('day')==5)
print(len(ep['umbra_n'][0]), len(ep['umbra_s'][0]))   # -> 111 388  (should be ~equal)
```

## 3. Where the bug lives — the generator

File: **`ShadowChaser/data build tools/gen_eclipse_paths.py`** (~82 KB). The umbral
corridor is built by walking the centreline in time and, at each time step, finding
the north and south limit points perpendicular to the centreline's ground track.

Key functions (line numbers approximate, from the May-31 version):

- **`umbral_pts(rec, t)`** (~line 333): for one time `t`, computes the centreline
  point, the perpendicular bearings (`perp_n = bearing - π/2`, `perp_s = bearing +
  π/2`), then calls the bisector once for each side:
  ```
  LEVEL = 1.0 - 1e-9
  n = _bisect_edge_cached(rec, cl[0], cl[1], perp_n, LEVEL, bstates)
  s = _bisect_edge_cached(rec, cl[0], cl[1], perp_s, LEVEL, bstates)
  return n, s
  ```
- **`_bisect_edge` / `_bisect_edge_cached`** (~line 184 / ~line 345): bisects outward
  from the centreline along the perpendicular great circle to find where max-eclipse
  magnitude crosses `LEVEL` (= 1.0, the totality boundary). **Critical early-outs:**
  ```
  if _max_magnitude(rec, p0_lat, p0_lon) <= level: return None      # centreline not total
  p_hi = at_dist(search_m)                                          # search_m defaults 300_000 m
  if _max_magnitude(rec, p_hi) >= level: return None                # still total at search edge
  ```
  i.e. it returns **None** if the far end of the search window is still inside
  totality (umbra wider than the 300 km search half-width), or if the centreline
  itself isn't total at that `t`.
- **`_max_magnitude_cached`** (~line 301): evaluates eclipse magnitude at a point over
  a cached grid of Bessel states. Note the **`if zeta_p <= 0: continue`** guard — it
  skips times when the point is below the horizon (sun not up). At high latitude /
  near the terminator, this can make the magnitude come back < LEVEL on one side.
- The per-time walk that calls `umbral_pts` and assembles points into the `umbra_n` /
  `umbra_s` segment lists is the loop around **~line 401 / ~line 444** (find where
  `umbral_pts` is called and where `None` returns are handled — that is the prime
  suspect for the short north edge: a stretch of `None` north points being dropped or
  ending the segment early while the south side keeps returning valid points).

## 4. Leading hypotheses (in priority order)

1. **North side hits `None` for a run of time steps and the segment is terminated
   early**, while the south side keeps resolving. Likely causes inside that run:
   - `_bisect_edge` `search_m` (300 km half-width) too small where the **north umbral
     limit bows far from the centreline** (high-latitude grazing geometry → very wide
     or very asymmetric umbra). The `p_hi still total → return None` branch would then
     fire and silently drop the point.
   - `_max_magnitude_cached`'s **`zeta_p <= 0` horizon guard** zeroing magnitude on the
     north side near the sunrise/sunset terminator (this is a high-lat path), so the
     bisector never sees a `>= LEVEL` anchor and returns None.
2. **Perpendicular bearing degeneracy**: near the pole / where the centreline ground
   track turns sharply, `perp_n` may point the bisector in a direction that leaves
   totality immediately, so the north edge collapses.
3. **The segment-assembly/cleanup step drops north points** (look for any code near
   line 696/733/815/849 that filters, RDP-simplifies, or splits edges and could
   asymmetrically discard the north list — search for "umbra_n" handling).

## 5. What "fixed" looks like — acceptance criteria

- For 2600-05-05 (key 10926): `umbra_n` and `umbra_s` should have **comparable length
  and longitude span** (both running roughly Greenland→UK), not 111 vs 388 pts over
  12° vs 100°.
- The corridor fill renders as a clean band with a short, sane end-cap (verify in the
  app once regenerated, or just check that north/south endpoints are near each other
  at BOTH ends of the path).
- **Regression sweep**: this is unlikely to be unique to one eclipse. After fixing,
  scan all century chunks for the same asymmetry and report how many records were
  affected:
  ```python
  import gzip, json, glob
  for f in sorted(glob.glob('ShadowChaser/data/paths/paths_*.json.gz')):
      d = json.load(gzip.open(f))
      for k, ep in d.items():
          if not isinstance(ep, dict): continue
          n, s = ep.get('umbra_n'), ep.get('umbra_s')
          if not (n and s and n[0] and s[0]): continue
          ln = sum(len(seg) for seg in n); ls = sum(len(seg) for seg in s)
          if ln and ls and (max(ln, ls) / min(ln, ls) > 2.0):
              print(f, k, ep.get('year'), ep.get('month'), ep.get('day'),
                    'n', ln, 's', ls)
  ```
  A length ratio > 2 is a strong tell. Expect a cluster of high-gamma / high-latitude
  totals (the geometry where one umbral limit swings far from the centreline).

## 6. Guardrails / process (learned the hard way)

- **Verify the record by its own date fields**, never by index position. `index.json`
  order ≠ paths-file key order.
- **Confirm hypotheses against the actual numbers before changing code.** Two earlier
  theories (multi-segment collapse; antimeridian seam) were killed by one data dump
  each. Dump and look first.
- Validators already exist — use them: `validate_paths.py`, `validate_terminators.py`,
  `inspect_term_gaps.py`. Consider adding a north/south length-symmetry check to
  `validate_paths.py` so this can't regress silently.
- Regenerating is expensive (the full path set is large and the generator is slow).
  Develop against a **single record / single century** first; only do a full rebuild
  once the fix and the regression sweep agree.
- Espenak source catalogue: `espenak_5000.csv`. ΔT handling: `delta_t.py` + the
  `deltat.*` files (a far-future date like 2600 leans on ΔT extrapolation — worth
  ruling in/out, but the symmetry of the bug, south fine / north short, points at the
  edge tracer, not ΔT, since ΔT would shift BOTH limits together).

## 7. First concrete step for the new thread

Instrument `umbral_pts` for record 10926 only: log, per time step, whether `n` and `s`
each came back as a point or `None`, plus the centreline lat/lon and the perpendicular
distance found. The time range where `n` flips to `None` while `s` stays valid is the
bug's location. From there, determine whether it's the `search_m` half-width, the
`zeta_p<=0` horizon guard, or bearing degeneracy — then fix that one cause.
