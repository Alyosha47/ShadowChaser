# The unified limit method (validated prototype) — the road to one pure method

## What it is
Replace BOTH the closed-contour cone trace AND the legacy perpendicular-offset envelope
with a single method:

> Parametrize the umbral limits by the **centreline** (which we already compute reliably for
> every case, verified against KMZ). For each centreline point, find the north and south limit
> by marching **perpendicular to the path until the depth field crosses zero**, then bisecting.
> Keep limit points where the sun is above the horizon.

Because it walks the *continuous* depth field (`abs(L2p) - m`) outward from the reliable
centreline, it has no closed-loop topology to get wrong: the hybrid pinch (limits converge to
the centreline, width→0, continuous), the pole (centreline is fine at the pole; the march is
local), and the grazing-annular empty side (one side never clears the horizon) all fall out
for free.

## Validation (prototype vs Jubier KMZ) — every kernel, one method
| case | type | PERP N / S | KMZ truth | 
|---|---|---|---|
| 2017 | total | 13817 / 13836 | ~13800 ✓ |
| 2024 | total | 14680 / 14766 | (matches current 14696/14783) ✓ |
| 1773 | total | 11349 / 11217 | (matches 11371/11213) ✓ |
| 1526 | annular | 4311 / 4407 | 4342 / 4428 ✓ (better than old trace) |
| 1552 | grazing annular | 3013 / **empty** | 3019 / none ✓ |
| 1543 | **hybrid** | 13349 / 13331 | 13344 / 13340 ✓ (was truncated+jumping) |
| 1585 | **hybrid** | 13278 | 13292 ✓ (was crossing) |
| 1522 | **pole** | 7815 / 7645 | 7826 / 7686 ✓ (**north fold gone**) |
| 2009 | total | 15121 / 15835 | 15141 / 15079 (N ✓; S right shape+ends, jittery) |

All hard kernels dissolve. Endpoints and shape match KMZ even where present length differs.

## 2009 discrepancy — RESOLVED (was the last unknown)
Correctly assigned by latitude, BOTH limbs coincide with Jubier point-for-point:
north mean 3km offset (max 10), south mean 10km (max 66 in one spot). The +756km on the
south is therefore NOT a positioning error — it's small per-point lateral wiggle from
numerical noise in the depth eval's time-search, inflating arc length on a curve that sits on
Jubier's line. Windowing the tangent does NOT fix it (the noise is in the depth crossing, not
the direction); a smoothing/RDP pass does. NOTE: smoothing MUST unwrap longitude across the
antimeridian first — a naive moving-average across the ±180 seam explodes the length (verified
the hard way: 2009 smoothed to 54,000km because it crosses lon 180). No remaining unknowns.

## Remaining refinements before it can replace the core (NOT rethinking — polishing)
1. **Curve denoising.** The perpendicular hits carry small lateral jitter that inflates arc
   length (2009 S: +756km, same endpoints/shape). Use a more stable tangent (fit over a small
   window rather than nearest neighbours) and/or a light smoothing+RDP pass. This ALSO solves
   the file-size growth — smooth curves decimate well.
2. **N/S labelling.** "Higher mean-lat = north" flips for some Antarctic paths (2003 swapped
   N/S — harmless cosmetically, same curves, but fix the assignment, e.g. by signed offset
   side relative to travel + the path's hemisphere).
3. **2542 two-vs-one.** PERP finds two limits where the old contour trace emptied one. Decide
   correctness (PERP is likely more right; needs a grazing KMZ to confirm) — adjust the
   below-horizon/empty rule accordingly.
4. **Edge handling.** Antimeridian unwrap on the output curves; split into segments if a limit
   dips below the horizon mid-path; terminate exactly on the green (Max-on-Horizon) line.
5. **Performance.** The march does many depth evals; reuse the fast bstate, coarse-then-bisect,
   cap the march, and (optionally) vectorise.
6. **Integrate + full no-regression**, then DELETE the contour trace, the envelope, the guard,
   and suppress-fold. One pure method, no fallback — purity reached.

## Status
The hard question — does one principled method handle all cases? — is answered YES, validated
against five KMZs spanning total/annular/grazing/hybrid/pole. The integration is the next
focused phase; it should be done carefully with full no-regression, not rushed, because it
replaces the core extraction for all 11,898 eclipses.

---

## INTEGRATION — DONE & VALIDATED (generator 2026-06-22a)
`perpendicular_limits(rec, centreline)` is wired into `build_path`, replacing the
cone-contour split + acceptance guard. The envelope-era suppress-fold is removed
(perp marches from a smooth centreline, so it structurally cannot zigzag-fold; a
sharp turn is a legitimate tip cusp). March capped at 400 km (umbral half-width
never exceeds ~135 km). Multi-segment output (gap-splitting at below-horizon runs)
flows through unwrap / despur / DP unchanged.

VALIDATION (UNI vs working 21c, end-to-end build_path, DP-simplified output):
- Kernels FIXED: 1543 hybrid 7278→13296/13331 (truth 13344/13340); 1522 pole
  N 15591→7810 (truth 7826); 1552 grazing one-limb preserved; 1526 annular 4310/4406.
- Normal cases PRESERVED: 2017, 2024, 2501, 2502, 2001-06, 2001-12, 1901-05, 1901-11,
  1502-04, 1502-10, 102 — all 0% total-corridor divergence vs the working generator.
- Two regression flags root-caused to the suppress-fold false-positive (1001-09-20
  total 0/0→10271/9857; 2001-12-14 annular S 0→12973), fixed by its removal.

## REMAINING (specified, no unknowns)
1. PERFORMANCE + PURITY (same task): the dead envelope walk still runs alongside the
   march (~2× the old per-build time → a regen would exceed the ~14 h budget). DELETE
   the envelope walk + _cone_trace + cone_limit_split (now uncalled) so build does the
   march ONLY. Optional further speedup: reuse the centreline peak-time across each
   perpendicular (avoids re-searching t* every depth eval).
2. N/S LABELLING on near-meridional paths (e.g. 1001-03-27): mean-latitude rule swaps
   N/S vs the old generator. Curves are correct; label only. Decide a path-direction
   based rule (limit on the left/right of travel) for the degenerate meridional case.
3. GREEN-LINE TERMINATION: limits end ~1% short of the green (Maximum-on-Horizon)
   curve (e.g. 1526 4310 vs 4342). Minor.
4. FULL CATALOG no-regression, THEN the deletions in (1) → purity reached.
