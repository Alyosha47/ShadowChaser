# HANDOFF — Umbral corridor limits do not envelope all oval points

**Scope:** One geometric bug. The umbral path limits (umbra_n, umbra_s) do not fully contain all points of the umbral ovals at the same timestamp. Visually: at end-of-path, the last oval's eastern tip protrudes beyond the corridor lines.

**Do not touch anything else.** The oval smoothing, truncation fix, and all other generator code is working correctly in `gen_eclipse_paths_v2.py`.

---

## 1. The symptom (confirmed)

For the **2026-08-12 total eclipse** (Spain path), oval 8 (the last oval, at t=0.5h from GE) has its eastern tip at approximately lon=-0.22, lat=41.95. The nearest corridor north limit point at that longitude is at lat=41.77 — **0.18° (≈20 km) south** of the oval tip. The oval visibly protrudes beyond the corridor line on the map.

This is not a rendering bug. The data is wrong.

## 2. Why it is wrong — the root cause

`umbral_pts(rec, t)` computes the corridor north and south limit points by bisecting **perpendicular to the centreline ground track**. This is correct and produces stable, smooth corridor lines for most of the path.

But at the end of the path (t=0.5 for 2026), the shadow ellipse is **highly elongated along-track**. The perpendicular direction (bearing 35.9°) intersects the umbral boundary at 144 km from the centreline. The **true maximum projection** of the corridor in the shadow's north-axis direction is at bearing 100° — 64° from perpendicular — giving 247 km.

Both 144 km and 247 km are on the correct max-over-time magnitude=1 contour. The perpendicular bisect finds a local maximum, not the global one. The global maximum is the correct corridor point.

Key numbers for 2026-08-12 at t=0.5:
- Centreline bearing: 125.9°
- perp_n direction: 35.9°
- Perpendicular bisect result: lat=43.71, lon=-4.20, proj=144 km
- True north extreme: lat=42.11, lon=-0.41, proj=247 km, at bearing 100°
- Oval 8 eastern tip: lat=41.95, lon=-0.22 (247 km projects to this)

## 3. What was tried and why it failed

### 3a. Post-hoc merge of oval extremes into corridor walk
Extract axis-extreme point from each stored oval, replace the nearest corridor walk point.

**Why it fails:** The adaptive_walk does not land on exact oval timestamps. Even when nearest-point matching is used, replacing a walk point with a geometrically distant oval extreme creates a discontinuity (spike) in the corridor line because the surrounding walk points were computed by perpendicular bisect at different times.

### 3b. Stateful arc search (seed from previous bearing)
At each timestep, search ±30° or ±90° around the previous timestep's winning bearing.

**Why it fails:** The max-over-time magnitude contour has **two local maxima** in the perp_n projection direction (one near 36°, one near 100°). The seed drifts between them causing 180° turns. The search arc needs to be wide enough to find the true maximum (64° away) but narrow enough to stay stable — these constraints are incompatible.

### 3c. Full 360° sweep of `_bisect_edge_cached`
Sample all bearings using the max-over-time bisector, take maximum projection.

**Why it fails:** The max-over-time contour is non-convex. Different bearings find different local maxima. As t progresses, the global maximum in the perp_n direction jumps between lobes, causing large discontinuities (180° turns, 8000+ km jumps). This affects even well-behaved eclipses like 2017.

### 3d. Full 360° sweep of `_bisect_umbra_at_t`
Sample all bearings using the instant-t bisector, take maximum projection.

**Why it fails:** The instant-t shadow at t=0.5 is enormous (the shadow is leaving Earth) — bisecting in some directions finds a point 541 km away. The corridor is the max-over-time envelope which gives 247 km in that direction. Using instant-t overshoots wildly at the path extremes, producing polar-scale jumps.

### 3e. Distance cap + lat-range guard on the sweep
Only accept sweep points within 2-3x the perp bisect distance AND within GE±30° latitude.

**Why it fails:** The true north extreme at bearing 100° is 541 km (instant-t) from the centreline while the perp bisect gives 144 km (max-t). The ratio is 3.75x — any cap that blocks polar runaways also blocks the legitimate improvement. These two failure modes cannot be separated by distance alone.

## 4. The correct path forward

The problem is that `umbral_pts` is trying to find the extreme of a non-convex contour by sampling in one direction. The contour must be traced continuously.

### The correct algorithm

The max-over-time magnitude=1 contour at time t is a closed curve (the "true umbral oval" in the max-magnitude sense). To find the true north limit point at time t:

1. Start from the perpendicular bisect result (a known point on the contour).
2. **Walk along the contour** in both directions by small angular steps from the centreline, checking at each step whether the projection onto perp_n increases.
3. Stop when projection begins to decrease in both directions — that is the global maximum.

Walking along the contour means: given a point on the contour at bearing b from the centreline, the next contour point at bearing b+δ is found by a 1D bisect in the b+δ direction. This is cheap (one `_bisect_edge_cached` call per step) and guaranteed continuous.

The key insight: contour walking is inherently continuous because each step is seeded from the previous step's bearing. The catastrophic jumps seen in 3b-3e all arise from initialising the search from scratch at each timestep. Contour walking maintains state along the contour itself.

### Implementation sketch

```python
def umbral_pts_contour(rec, t, N_WALK=20, DELTA=math.pi/36):  # 5° steps
    """Find true north/south corridor limits by walking the magnitude=1 contour."""
    cl = centreline_pt(rec, t)
    if cl is None: return None, None
    # ... compute bearing, perp_n, perp_s, bstates as in umbral_pts ...
    
    # Start from perp bisect (known stable point on contour)
    n_perp, s_perp = umbral_pts(rec, t)
    if n_perp is None: return None, None
    
    # Find starting bearing for n (bearing from cl to n_perp)
    start_b_n = math.atan2(n_perp[1]-cl[1], n_perp[0]-cl[0])
    
    # Walk contour in +/- direction from start_b_n
    best_n_proj = ... # proj of n_perp onto perp_n
    best_n = n_perp
    for direction in [+1, -1]:
        b = start_b_n
        for step in range(N_WALK):
            b += direction * DELTA
            pt = _bisect_edge_cached(rec, cl[0], cl[1], b, LEVEL, bstates, ...)
            if pt is None: break
            proj = (pt[0]-cl[0])*cos(perp_n) + (pt[1]-cl[1])*sin(perp_n)
            if proj > best_n_proj:
                best_n_proj = proj; best_n = pt
            elif proj < best_n_proj - TOLERANCE:
                break  # past the maximum, stop
    
    # Repeat for south side
    ...
    return best_n, best_s
```

The `elif proj < best_n_proj - TOLERANCE` stop condition is crucial — it prevents walking past the maximum and onto a descending region. TOLERANCE should be ~0.001 radians (≈110 m) to ignore noise.

### Why this will work

- **Continuous**: each step seeds from the previous bearing → no jumps
- **Terminates correctly**: stops when projection starts decreasing
- **Cheap**: N_WALK=20 steps × 1 `_bisect_edge_cached` each = 20 extra calls per timestep (vs N_SWEEP=24 calls in the failed approach, but without instability)
- **Degrades gracefully**: if the contour has no off-perpendicular maximum (normal eclipses), the walk terminates after 1-2 steps and returns the perp bisect result unchanged

### Expected result for 2026-08-12

- At t=0.5: walk starts at bearing 35.9°, steps toward bearing 100° in 5° increments, projection increases from 144 km → 247 km over ~13 steps, then decreases → stops at bearing ~100° with pt=(42.11, -0.41)
- All other timesteps: walk terminates immediately (perp bisect IS the maximum)
- 2017 and other normal eclipses: unchanged (contour is nearly circular, perp bisect is the maximum)

## 5. Validation

After implementing, check:

```python
# 2026-08-12 key check
rec = ... # 2026-08-12
result = build_path(rec)
n = result['umbra_n'][0]; s = result['umbra_s'][0]
ovals = result['umbra_ovals']

# All ovals contained (wrapping-aware)
def contained(p, n, s):
    all_lons = [x[0] for x in n+s]
    lo, hi = min(all_lons), max(all_lons)
    return any(lo-0.2 <= p[0]+shift <= hi+0.2 for shift in [0, 360, -360])

assert all(contained(p, n, s) for ov in ovals for p in ov[:-1])

# No interior turns > 10°
def worst_turn(pts): ...  # see session code
assert worst_turn(n) < 10 and worst_turn(s) < 10

# 2017 unchanged
result17 = build_path(rec_2017)
assert worst_turn(result17['umbra_n'][0]) == 0
assert worst_turn(result17['umbra_s'][0]) == 0
```

## 6. Files

- `gen_eclipse_paths_v2.py` — current working generator (truncation fix + oval smoothing, clean baseline)
- `gen_eclipse_paths.py` — original (keep for reference)
- The contour-walk fix should be implemented as `gen_eclipse_paths_v3.py` until validated, then renamed

## 7. What NOT to do

- Do not use `_bisect_umbra_at_t` for corridor limits (instant-t, overshoots at path extremes)
- Do not sweep all 360° bearings statelessly (non-convex contour causes jumps)
- Do not replace walk points with oval-derived points post-hoc (creates spikes)
- Do not widen the bstate window beyond t±0.02h (breaks the cached bisect)
- Do not touch the oval generation, penumbral limits, terminator, or bisector code
