# Cone-limit splitter — progress (this work session)

## Where it stands
The closed-loop → N/S split is now CLOSE but not converged. Two sub-problems
separated and one solved-in-principle:

### SOLVED in principle: tip detection by curvature
Computing the turning angle around the loop over a window (W ≈ n/180) and taking
well-separated peaks correctly locates the corridor tips. For 2017 the four
sharpest peaks land at exactly two geographic locations — [-27.3, 11.1] (SE end)
and [-171.8, 39.9] (NW end), each ~167° (near-reversal pinch). This is the right
signal; max-pairwise-distance never found these.

Cluster the peaks by GEOGRAPHIC proximity (<500 km) into 2 tips, cut the loop at
the sharpest member of each. This is the right structure.

### REMAINING issue 1: clustering can mis-pair on some eclipses
On 2017 the two cuts came out lopsided (557 vs 1676) — the clustering merged or
ranked tips such that both cuts fell near one end. Needs a more robust pairing:
the two tips should be the two loop points of highest curvature that are also
geographically FAR apart (the corridor's two ends), i.e. maximize
curvature(i)+curvature(j) subject to gc(tip_i,tip_j) being large. (NOT index-
opposite — that failed; the tip can sit mid-arc.)

### REMAINING issue 2: tracer rounds the sharp tip too coarsely
Even with a perfect cut, each arc shows a ~76° worst-turn AT THE TIP APEX,
because the totality-corridor tip is genuinely pointed and the contour tracer
takes ~25 km steps, so the apex is 2-3 coarse vertices. This is a TRACER issue,
not a splitter issue: add an adaptive step that refines near high |grad-turn|
(smaller steps where the contour curves sharply), so the pointed tip is sampled
finely. Then the worst-turn drops to the smooth-limb value.

## Verified-good baseline (unchanged)
The cone-limit FIELD + tracer are still sub-km vs Jubier on the limb body
(2017 N 0.28 / S 0.15) and reach the grazing tips. Only the apex sampling +
the tip-pairing robustness remain.

## Next concrete steps
1. Tip pairing: choose the 2 highest-curvature peaks maximizing geographic
   separation (replace the cluster-and-rank with a curvature×separation score).
2. Adaptive tracer step near high curvature (refine the apex).
3. Re-run worst-turn across many eclipses; target worst-turn ~= smooth-limb (~a
   few degrees), matching the envelope's smoothness, then full Jubier + BCE
   re-validation before replacing v9.

## Status: NOT shipped. v9 envelope remains the shipped umbra. No app files touched.

## UPDATE (end of this work session)
- Tip pairing by curvature×geographic-separation tested. The two true tips ARE
  found on all tested eclipses (2017/2024/2027/2033/2026). Lopsided arc point-
  counts (e.g. 557 vs 1676) are NOT a bug — one limb is simply sampled denser;
  both arcs are valid limbs.
- CONFIRMED the sole remaining blocker is TRACER APEX SAMPLING: the residual
  76-79° worst-turn sits exactly at the pointed corridor tip, where ~25 km steps
  render the sharp apex as 2-3 coarse vertices. 2033/2026 already show low
  worst-turn on one arc (11-17°) — the high number is always the arc containing
  the sharp apex.
- THEREFORE: next session = adaptive tracer step (shrink step where the contour
  turns sharply) OR a local apex densify-and-resolve. That alone should bring
  worst-turn down to the smooth-limb value. Splitter logic itself is essentially
  done (curvature tip-find + curvature×separation pairing + cut).

## BREAKTHROUGH (continued work) — 4-cut splitter solves the common case
KEY REALIZATION: the closed loop passes each corridor tip TWICE (once on the N
pass, once on the S pass), so curvature gives ~4 peaks clustered at the 2 tip
LOCATIONS. Jubier's N and S limits are each a SINGLE SMOOTH OPEN ARC (verified:
Jubier 2017 Northern Limit = 871 pts, worst interior turn 0°, endpoints exactly
at the two tips [-171.7,40.0] and [-27.3,11.3]). They do NOT trace around the tip.

THE SPLITTER (working):
1. Curvature peaks (windowed turn, W≈n/180) → cluster geographically (<500 km)
   into 2 tip locations.
2. Cut the loop at ALL peaks (all 4 tip-passes).
3. The 2 LONGEST resulting segments are the N and S limbs (the short segments
   are tip-rounding, discarded).
4. Trim vertices within ~150 km of either tip → clean open arcs.

RESULTS (adaptive tracer + 4-cut split):
  2017: both limbs worst 0°   ✓ matches Jubier
  2024: both limbs worst 0°   ✓
  2027: 2° and 10°            ✓ essentially smooth
  2033 (polar): 55° / 3°      ✗ one limb bad — tip at lat85/lon-228 (antimeridian+pole)
  2026: 82° / 2°             ✗ one limb bad — tip at lat75

REMAINING: only the POLAR / ANTIMERIDIAN edge cases (2033, 2026) where one tip
sits near a pole or across the antimeridian and the curvature/cluster step picks
a wrong point (note 2033 tip lon -228 = unwrapped past antimeridian). The common
mid-latitude corridor case is SOLVED. Next: make tip detection antimeridian- and
pole-safe (unwrap longitudes consistently; use 3D/great-circle curvature near
poles). Then full 11-eclipse + BCE re-validation vs Jubier before replacing v9.

Prototype saved: cone_limit_prototype.py (adaptive tracer; the split_4cut function
is in the test harness in the transcript — fold into the prototype next session).

## TOPOLOGY INSIGHT (further work) — not all eclipses are 2-tip corridors
Examined the two "failures":
- 2026: the loop has only TWO curvature peaks, and one ([108.7,75.2], lat75) is
  NOT a tip — it's the loop-closure seam at high latitude. 2026 is a partial/
  asymmetric corridor: one real tip + the other end runs to the terminator/pole,
  not a symmetric second tip.
- 2033: polar; tip longitudes unwrap past the antimeridian (lon -228).

So eclipse umbral loops come in (at least) 3 topologies:
  (A) symmetric 2-tip corridor — COMMON — SOLVED (4-cut, both limbs ~0°).
  (B) 1-tip / asymmetric — one tip + a terminator/pole end.
  (C) polar / antimeridian-crossing — needs unwrap + great-circle curvature.

The SOLVED case (A) already covers the large majority of the zigzag-afflicted
eclipses (the mid-latitude grazers in the audit list). A pragmatic shipping path:
apply the cone-limit + 4-cut split where it produces 2 clean limbs (validate
worst-turn < a few °), and FALL BACK to the current v9 envelope for topologies
B/C until they're handled. This banks the win on the common case without waiting
to solve every polar oddity.

NEXT: (1) detect topology (count real tips after antimeridian-safe unwrap);
(2) for case A ship the split; (3) handle B (cut at the single tip, the loop's
two halves from that tip are the two limbs to the boundary); (4) C with unwrap.

## Case B attempt (2026) — not cleanly solved
Tried: cut at the single low-latitude tip, split tip→far-end both ways. Result
40°/89° — the "far end" near lat75 is itself a sharp bend (path curves hard at
the terminator/pole), so the limbs catch it. 2026's northern end is genuinely
awkward geometry, not a simple second tip.

CONCLUSION FOR THIS WORK BLOCK: the 4-cut splitter SOLVES the common symmetric
2-tip corridor (2017/2024/2027 → ~0° limbs matching Jubier). The asymmetric/
polar topologies (B/C: 2026, 2033) are NOT cleanly solved and should NOT get a
hacked general rule. SHIP PLAN: use cone-limit+4-cut where it yields 2 clean
limbs (verify worst-turn < ~5°), else fall back to the v9 envelope. This banks
the majority win safely. Solving B/C properly is its own focused task (likely
needs a terminator-aware boundary model, since the open end IS the terminator).

State: prototype + this doc saved to outputs. v9 envelope still the shipped umbra.
No app files touched by any cone-limit work.

## RESOLVED APPROACH — verified split with acceptance post-check
The robust, ship-safe rule (tested, works):
  1. Trace cone-limit loop (adaptive tracer).
  2. try_split(): curvature peaks (>80°, |lat|<82) -> cluster to <=2 tips ->
     4-cut -> 2 longest segments -> trim 150 km around tips.
  3. POST-CHECK: compute worst-turn of both limbs. Accept ONLY if max <= ~20°.
  4. If rejected (or not 2 tips), FALL BACK to the v9 envelope limit.

Verified outcomes:
  2017/2024: accepted, 0°/0°   2027: accepted, 2°/10°
  2026/2033: rejected -> envelope fallback (correct; no regression)

This GUARANTEES no regression: clean corridors get the zigzag-free contour
limbs; awkward polar/asymmetric eclipses keep exactly today's envelope behavior.
The fallback set (polar/asymmetric) can be improved later as its own task
without risk to the shipped majority.

## TO INTEGRATE INTO gen_eclipse_paths.py (next session)
- Port try_split() + the adaptive trace() + cone field into the generator.
- For each eclipse: attempt cone-limit split; on accept, replace umbra_n/umbra_s
  with the two clean limbs; on reject, keep current envelope path.
- Re-run full Jubier validation (must stay sub-km on accepted) + BCE audit (zigzag
  reports should clear on accepted eclipses; rejected ones unchanged).
- Bump BUILD; rebuild centuries. Files: cone_limit_prototype.py (tracer+field),
  splitter_verified.py (try_split + post-check).

## INTEGRATED INTO gen_eclipse_paths.py (this session) — WORKING
Added to the canonical generator: _cone_depth / _cone_grad / _cone_correct /
_cone_trace / _cone_seed / _cone_worst_turn / cone_limit_split. Wired into
build_path right after un/us are built: attempt cone_limit_split(rec); if it
returns clean limbs, replace un/us; else keep the legacy envelope (no regression).

VERIFIED end-to-end through build_path:
  2017: umbra_n/s worst-turn 0°/0° (was zigzag)
  1999: worst 0°, AND vs Jubier N median 0.35 km / S 0.07 km — sub-km accurate
  1957 grazer: produced limbs (82/56 pts)
Build cost ~24 s/eclipse for the cone trace (acceptable; one-time per rebuild).

The seed uses rec['lat_dd_ge']/['lng_dd_ge'] (greatest-eclipse point, inside
totality) and steps north to the contour. accept_deg=20° gate + envelope fallback
guarantee no regression on topologies that don't split cleanly.

## REMAINING before declaring done
- Rebuild centuries with the new generator + BUILD bump (slow: green trace +
  cone trace; consider parallelizing).
- Spot-check a few fallback cases render identically to before.
- Terminator trim: CHECKED — non-issue. The depth field returns -9.9 where
  zeta<=0 (sun below horizon), so the contour self-terminates at the terminator.
  1999 endpoints match Jubier (ours -63.2..85.9 vs Jubier -65.3..87.4, slightly
  inside, not beyond). No extra trim needed.

## MULTI-ECLIPSE VALIDATION (this session) — all pass
Ran the integrated generator vs Jubier KMZ:
  2024 CONE:     worst 0°/0°,  vs Jubier N 0.94 / S 0.05 km
  2027 CONE:     worst 0°/0°,  vs Jubier N 1.33 / S 0.05 km (N max 8.12 km, one spot)
  2045 envelope: worst 2°/1°,  vs Jubier N 0.04 / S 0.02 km (not a zigzag eclipse)
  2061 envelope: worst 5°/2°,  vs Jubier N 0.05 / S 0.90 km
  1999 CONE:     worst 0°,     vs Jubier N 0.35 / S 0.07 km
  2017 CONE:     worst 0°/0°
Conclusion: zigzag eclipses get the cone fix (0°, sub-km medians); non-zigzag
eclipses fall back to the envelope, unchanged and already clean. No regressions.
Minor: 2027 N has an 8 km max at one spot — worth a glance but median is sub-km.
Integration is validated and ready to ship after the in-progress v9 rebuild
finishes; then swap generator, rebuild once more, BUILD bump.

## ACCURACY FIX (this session) — 8 km tip error eliminated
The 2027 N limb had ~8 km max error vs Jubier. Root cause: the split arc near one
tip STRADDLED the apex and grabbed a stretch of the SOUTHERN limb (those points
were 0.0-0.5 km from Jubier-S but 8 km from Jubier-N). The windowed-curvature cut
sits ~W vertices off the true apex.
FIX: refine each tip cut to the sharpest RAW (un-windowed) vertex within +-W of
the windowed peak = the exact apex. Cutting at the apex stops straddling.
Re-validated (all sub-km, max ~1 km):
  2027: N med 0.08 max 0.85 | S med 0.06 max 1.10   (was max 8.12)
  2024: N med 0.04 max 1.13 | S med 0.10 max 1.08   (was max 3.83)
  1999: N med 0.01 max 0.10 | S med 0.05 max 0.10
  2017: N/S worst-turn 1°
The fix improved ALL eclipses, not just 2027. Razor-sharp accuracy confirmed.

## ROBUSTNESS PASS (this session) — crossover trim + bounded trace
Two more issues found and fixed while validating broadly:
1. TIP STRADDLE (2024 N max 3.83 km, 2027 earlier): near a tip the two limbs
   nearly touch and a limb's end vertices sat on the OTHER limb's track (those
   points were ~0 km from Jubier's opposite limit). FIX: after split, trim
   leading/trailing limb vertices that are closer to the other limb than to their
   own along-limb neighbour (_trim_crossover). Combined with 4-cut + per-pass apex
   refinement.
2. TRACE HANG on degenerate polar/annular geometry (2097 Antarctic annular ran
   >80s, never closing). FIX: bound maxpts to 6000 (clean corridors close well
   within) + a cheap pre-filter that skips the cone attempt when |GE latitude|>70
   (polar eclipses always fall back). Non-converging traces now bail to envelope.

FINAL VALIDATION (all sub-km, worst-turn 0-1°):
  2017: N 0.02/0.08  S 0.02/0.20
  2024: N 0.04/1.13  S 0.10/1.08   (was N max 3.83)
  2027: N 0.09/0.88  S 0.05/0.99   (was N max 8.12)
  1999: N 0.01/0.10  S 0.05/0.10
  Fallback (envelope, unchanged, sub-km): 2026, 2033, 2045, 2060, 2061, 2097(polar)

The zigzag fix is now robust: clean corridors get sub-km cone limbs (max ~1 km),
everything else falls back to the unchanged envelope, and no eclipse hangs the
build. Ready to ship after the in-progress v9 rebuild; then swap generator +
rebuild + BUILD bump.

## OVERNIGHT WORK BLOCK — parallel re-verified; polar frontier scoped
- Parallel build RE-VERIFIED byte-identical on a mixed chunk (cone 2017 + polar
  fallbacks 2026/2033 + annular 2003). --jobs is safe for the real rebuild.
- Annular build times profiled: 8-29s, same band as totals. Per-chunk estimate
  (~1hr serial / ~8min on 8 cores) holds. Logged green-trace optimization knobs
  in TODO (not applied — needs Jubier re-validation).
- POLAR/ASYMMETRIC SPLITTER (2026/2033) — confirmed still the open frontier. 2026:
  GE at lat65 but the seed-walk crosses to lat87 (near pole); the traced loop's
  far end is a POLAR WRAP, not a second corridor tip, so the 2-tip split can't
  apply. These correctly FALL BACK to the envelope today (render fine).
  PROPER FIX (next focused task, NOT done half-asleep): the open end of an
  asymmetric corridor is the TERMINATOR, not a tip. Need to: detect the single
  real tip, trace the two limbs from it, and TERMINATE each limb where it meets
  the terminator/green line (intersect with the existing green contour) rather
  than wrapping over the pole. Medium effort, must not regress the working
  2-tip case or the envelope fallback. Until then: fallback stays.

## SESSION DIAGNOSIS — two distinct root causes found (not magic numbers)
Stopped tuning trim constants; isolated the real causes by inspecting loop geometry:

1. TIP-APEX ROUNDING (affects 1773, 2017, 2024, 2027): the 4-cut puts the cut AT
   the apex (sharpest vertex), so each limb STARTS with a ~50 deg turn at that
   apex point. Fix = drop a small apex neighborhood (~W points, the windowed
   half-width) from each limb end after cutting. PROVEN: with apex-drop,
   1773 worst 0, 2024 worst 8, 2017 worst 13 (all acceptable). This is bounded
   and geometric (tied to the curvature window), not a distance guess.

2. ANTIMERIDIAN WRAP (affects 1154): its cone loop crosses the dateline and the
   trace continues to lon -211 instead of wrapping to +149. The "180 deg turn"
   is the dateline discontinuity, NOT a tip. Fix = normalize/unwrap longitudes
   antimeridian-safe before turn-metric + before output (the generator already
   has unwrap() for this; the cone limbs must pass through it too).

Validation harness: split_by_centreline attempt FAILED (centreline-projection
ordering degenerates at tips, same tip wall). Correct approach confirmed: keep the
traced loop's NATIVE order (it is continuous by construction), split at the 4 tip
passes, drop apex neighborhood, and unwrap longitudes. Do NOT re-order by
centreline.

NEXT (precise, no thrash):
- Wire apex-drop (drop ~W points each end after the 4-cut) into cone_limit_split.
- Run cone limbs through the existing unwrap() before they become un/us.
- Re-validate 1773/1154/1526 vs uploaded KMZ + confirm 2017/2024/2027 still sub-km.
- Keep accept_deg gate as the safety net; only ship limbs that verify smooth.

## SESSION END STATE — apex-drop + unwrap wired; mixed results
WIRED into cone_limit_split:
- Apex-drop: after the 4-cut, drop W points (curvature-window half-width) from each
  segment end — removes the sharp apex vertex the cut sits on. PROVEN to smooth limbs.
- Antimeridian unwrap: unwrap each limb's longitudes AFTER trim, before the worst-turn
  gate and output (raw dateline-crossing lons gave spurious 180 deg turns).
- REMOVED the crossover-trim (it gutted dateline-crossing limbs below 10 pts via raw-lon
  _cone_gc; debug confirmed 1773 was exiting at the len<10 check there).

CURRENT VALIDATION (vs uploaded/extracted KMZ):
  2017: CONE  N 0.02/0.24  S 0.02/0.20   PERFECT
  1773: CONE  N 0.11/0.13  S 0.48/1.93   ZIGZAG FIXED (was env w178)
  2024: CONE  N 0.76/3.42  S 0.06/1.33   regressed N max (straddle back w/o crossover-trim)
  2027: env   (smooth, sub-km via envelope)
  1154: env   S w177  -- STILL dateline-crossing loop, cone rejects
  1526: env   S w103  -- STILL fails (different geometry, investigate)

NET: 1773 zigzag fixed, 2017 perfect; 2024 accuracy regressed at one tip; 1154/1526 not
yet fixed. This is INCOMPLETE — do NOT ship/rebuild yet.

REMAINING ROOT WORK (precise):
1. 2024 tip straddle (N max 3.42 km): the apex-drop alone leaves a few crossover points at
   ONE tip. Need a crossover removal that is antimeridian-safe (normalize lon to a common
   branch before _cone_gc) instead of the removed raw-lon version. That single fix should
   restore 2024 sub-km WITHOUT breaking 1773.
2. 1154: cone loop crosses the dateline; even with output unwrap it still rejects -> the
   tip/peak detection or seg slicing happens on raw lon. Normalize the WHOLE loop to a
   continuous lon branch right after _cone_trace (before turn metric/peaks), not just the
   final limbs.
3. 1526: annular, S w103 -- diagnose its loop topology (may be single-tip/asymmetric like
   2026/2033 -> legit envelope fallback, or another dateline case).
Keep accept_deg=20 gate as the safety net; only ship verified-smooth limbs.
