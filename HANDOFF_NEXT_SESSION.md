# ShadowChaser — Session Handoff (read this FIRST, in full, before doing anything)

You are continuing work on **ShadowChaser**, an offline eclipse-calculator web app
(deployed at followtheshadow.com). This document is the complete state. Do not ask the
user where the repo is, what we're doing, or what's left — it is all here. Read it
entirely before touching anything.

────────────────────────────────────────────────────────────────────────
## 0. HOW TO WORK WITH THIS USER (non-negotiable — they have repeated these many times)
────────────────────────────────────────────────────────────────────────
- **BE EXTREMELY CONCISE.** Default to one line unless they ask for more. They are
  chronically frustrated by verbosity. Do not pad, do not over-explain, do not
  re-summarize what you just did at length. Answer, then stop.
- **NO PATCHES. ROOT-CAUSE FIXES ONLY.** Do not paper over symptoms (no dedup hacks,
  no blanket filters, no "drop the bad points" band-aids, no magic-number tuning).
  If you catch yourself tuning a constant until tests pass, STOP — that is the
  anti-pattern they reject. Find the actual cause.
- **NEVER GUESS. NEVER QUIT.** If you don't know, investigate (the data is all here).
  Do not give up on a problem or suggest abandoning a working approach.
- **NEVER BREAK WORKING CODE.** Verify before and after every change.
- **GIVE WHOLE FILES, never sed/patch fragments for the user to apply.**
- **ONE canonical generator** — never create suffixed copies (no _v2, _new, etc.).
- Bump BUILD on every front-end change (see §4).
- The user verifies in-app, then commits themselves. You cannot run git in their real
  repo (your sandbox is separate). Hand them paste-ready commit blocks proactively at
  clean checkpoints. Exclude the generator from commits unless it is validated.
- Do not psychoanalyze, do not flatter, do not thank them for messaging.

────────────────────────────────────────────────────────────────────────
## 1. WHAT THE APP IS
────────────────────────────────────────────────────────────────────────
Offline-capable web app that, for any solar eclipse, computes and maps the shadow
paths and shows local circumstances for any point. Two parts:

**(a) Python generator** — `data build tools/gen_eclipse_paths.py`. Reads Besselian
elements, computes for each eclipse: umbral north/south limits, centreline, penumbral
limits, terminator curves, the green "Maximum-on-Horizon" line, and umbra ovals.
Outputs gzipped JSON path files. Validated against Xavier Jubier's KMZ reference
solutions (sub-km is the standard).

**(b) JS front-end** — deck.gl map + a details sidebar panel. Renders the paths and,
for a chosen location, an interactive sun-track diagram + contact-times table + local
circumstances.

────────────────────────────────────────────────────────────────────────
## 2. REPO + FILE LOCATIONS
────────────────────────────────────────────────────────────────────────
GitHub: github.com/Alyosha47/ShadowChaser
In this sandbox the working copy is at: `/home/claude/ShadowChaser/`

Key files:
- Generator (THE canonical one): `data build tools/gen_eclipse_paths.py`
- Renderer (deck.gl): `js/map.js`
- Details panel + sun-track: `js/details.js`
- Eclipse solver (computeEclipse, sampleEclipseAt, fundamentalArgs): `js/eclipse.js`
- Formatting helpers: `js/format.js`
- Coordinate/search parser: `js/search_parser.js`
- Other JS: state.js, local.js, search.js, list.js, tabs.js, url.js, init.js
- CSS: `css/app.css`
- App shell + BUILD string: `index.html`
- Besselian input data: `data/besselian/{century}.json` (e.g. 2001_2100.json,
  1901_2000.json, 1101_1200.json, ... including BCE chunks like -399_-300.json)
- Generated path output: `data/paths/` (what the app loads)
- Jubier KMZ ground truth: `data build tools/kmz_extracted/` (1999, 2017, 2023×2) AND
  `/mnt/user-data/uploads/` (2024, 2026, 2027, 2033, 2045, 2049, 2060, 2061, 2097,
  and the three test cases 1154, 1526, 1773 — all *.kmz)

Docs (keep to this two-file system + the progress log):
- `HANDOFF.md` — long-term knowledge/status
- `TODO.md` — single task list
- `SPLITTER_PROGRESS.md` (in /mnt/user-data/outputs) — detailed log of the cone-limit
  splitter work. READ THIS for the deep technical history of the current open problem.
- This file — the session handoff.

────────────────────────────────────────────────────────────────────────
## 3. CURRENT STATE — WHAT IS DONE AND COMMITTED
────────────────────────────────────────────────────────────────────────
Front-end is at **BUILD 2026-06-16r**, committed and up to date in the user's repo.
The following are DONE, verified, and committed:

- Interactive sun-track diagram in the details panel (Sun's sky path over the eclipse
  window, horizon, contact marks C1/C2/MAX/C3/C4, time-slider scrubbing with live Moon
  bite, sky dimming by eclipse magnitude, UT/local toggle).
- **Sun-track UT-midnight bug FIXED** (root cause): for eclipses whose maximum is near
  UT 00:00 (e.g. 1957-04-30), a `((t%24)+24)%24` wrap turned pre-midnight sample times
  into ~23.99h, placing samples a full day off → altitude jump (a kink) + misaligned
  darkening. Fix: pass continuous UT to `sampleEclipseAt` (it does t0-relative math),
  no modulo wrap. Also moved to a single uniform 240-pt sampling grid (no injected
  contact points); contacts positioned via `indexForUT`. Verified: 1957 max-turn
  77.9°→0.0°, normal eclipses unaffected.
- Contact-table rows are clickable to jump the slider to that contact.
- Per-eclipse browser title: "TSE/ASE/HSE/PSE YYYY-MM-DD — ShadowChaser" (ISO date).
- aria-labels on icon buttons; map-status moved from inline style to `.map-status`.
- Panel density tightened; time-mode toggle is a clickable "Switch to UT/Local" link.
- Centreline render width set to 1.5 (consistent with all other paths).
- DMS parser accepts true prime/double-prime U+2032/U+2033 (e.g. 77°33′18.2″N).
- "No lunar limb correction" note moved below the Tolerances table; online/offline
  reload note moved into the Instructions section.
- Generator parallelization: `--jobs N` flag (`--jobs 0` = all cores). PROVEN
  byte-identical to serial output. Per century chunk: ~1 hr serial, ~8 min on 8 cores
  (224 eclipses, ~147 central at 8–34s each; partials ~0.1s). ALWAYS use `--jobs 0`
  for rebuilds. This is committed/safe.

────────────────────────────────────────────────────────────────────────
## 4. BUILD-BUMP + COMMIT POLICY
────────────────────────────────────────────────────────────────────────
- On ANY front-end change, bump BUILD in index.html — it appears in TWO places:
  `var BUILD = 'YYYY-MM-DDx'` AND `<meta name="build" content="YYYY-MM-DDx">`. Bump
  BOTH. It is a cache-buster; stale .gz/CSS load otherwise. Current: 2026-06-16r →
  next change becomes 2026-06-16s, etc.
- After changes, copy modified files to `/mnt/user-data/outputs/` and present_files them.
- Provide a paste-ready commit block. EXCLUDE `gen_eclipse_paths.py` from commits until
  it is fully validated (see §5). Exclude `mockup_panel.html` (throwaway).

────────────────────────────────────────────────────────────────────────
## 5. THE ONE OPEN PROBLEM — umbral-limit zigzag / cone-limit splitter
────────────────────────────────────────────────────────────────────────
### Background
The umbral N/S limits are the edges of the totality/annularity corridor. The OLD
("envelope") method walks each limit outward and uses `_extend_to_green` to reach the
terminus — but that step projects a STRAIGHT CHORD past the green line, which on some
eclipses folds back on itself = the visible **zigzag** (a fold at the corridor tip).

The FIX in progress: compute the limits as the zero contour of an "ever-total depth
field" (the cone–spheroid intersection), traced as a closed loop, then SPLIT that loop
into the two clean N/S limbs. This is in the generator as `cone_limit_split(rec)` and
the helpers `_cone_depth/_cone_grad/_cone_correct/_cone_trace/_cone_seed/
_cone_worst_turn/_cone_gc` (just before `build_path`). It is wired into `build_path`:
after the envelope un/us are built, it calls `cone_limit_split`; if that returns clean
limbs they replace un/us, otherwise the envelope is kept (safe fallback, no regression).
There is an accept gate: limbs are only used if both have worst interior turn ≤ 20°
(`accept_deg`). A cheap pre-filter skips the cone attempt when |GE latitude| > 70
(polar eclipses always fall back). `_cone_trace` is bounded (maxpts) so it can't hang.

### How the split works (and where it's fragile)
The traced loop passes through each of the 2 corridor tips twice (4 curvature peaks at
2 tip locations). The splitter: find windowed-turning-angle peaks (>80°, |lat|<82) →
cluster geographically (<500 km) into 2 tips → refine each cut to the sharpest RAW
vertex near the windowed peak (true apex) → cut at ALL 4 passes → keep the 2 longest
segments → **apex-drop** (drop W points — the curvature-window half-width — from each
segment end, since the cut sits on the sharp apex) → unwrap longitudes
(antimeridian-safe) → label N/S by mean latitude. Accept only if worst-turn ≤ 20°.

### CURRENT VALIDATION (run vs the KMZ files; see §6 for how)
  2017-08-21: CONE  N 0.02/0.24 km  S 0.02/0.20 km   PERFECT, smooth
  1773-09-16: CONE  N 0.11/0.13 km  S 0.48/1.93 km   ZIGZAG FIXED this session
  2024-04-08: CONE  N 0.76/3.42 km  S 0.06/1.33 km   REGRESSED: N max 3.42 km (a tip
              straddle returned after the crossover-trim was removed)
  2027-08-02: envelope fallback (smooth, sub-km) — would prefer CONE
  1154-12-06: envelope, S worst-turn 177°  — STILL ZIGZAGS (not fixed)
  1526-01-13: envelope, S worst-turn 103°  — STILL FAILS (not fixed)
(Format above: "median/max km vs Jubier". worst-turn in degrees; ≤~1° = smooth.)

### THE THREE REMAINING ROOT FIXES (precise, principled — NOT magic numbers)
1. **2024 tip straddle (N max 3.42 km).** Removing the old crossover-trim fixed 1773
   but let a few opposite-limb points re-appear at ONE tip of 2024 (they sit ~0 km from
   Jubier's OTHER limit). Re-introduce a crossover removal that is ANTIMERIDIAN-SAFE:
   normalize both limbs' longitudes to a common continuous branch BEFORE computing
   `_cone_gc` distances, then drop leading/trailing points closer to the other limb than
   to their own neighbour. The old version used raw lon and gutted dateline-crossing
   limbs (that's why it was removed). Do it on normalized lon and it should fix 2024
   WITHOUT breaking 1773.
2. **1154-12-06 still zigzags.** Its cone loop CROSSES THE ANTIMERIDIAN; the trace
   carries longitudes outside [-180,180] (e.g. −211). Peak detection / segment slicing
   run on raw lon, so the dateline jump reads as a spurious 180° and the split fails.
   Fix: normalize the WHOLE loop to a continuous longitude branch IMMEDIATELY after
   `_cone_trace` (before the turn metric and peak detection), not just the final limbs.
3. **1526-01-13 still fails (S 103°).** Annular. Diagnose its loop topology first
   (print the loop coarsely — see §6). It may be a legitimately single-tip / asymmetric
   geometry that SHOULD fall back to envelope (like 2026/2033 do), OR another dateline
   case. Determine which before "fixing" — do not force a split that isn't there.

Keep `accept_deg = 20°` as the safety gate throughout: only ship limbs that verify
smooth; everything else falls back to the (unchanged) envelope. That guarantees no
regression on the eclipses that already work.

### DO-NOT list for this problem (lessons from this session)
- Do NOT tune trim distances (150 km / 60 km / etc.) to make tests pass — that thrash
  is exactly the patch-pile the user rejects. The apex-drop (tied to the curvature
  window W) is the principled replacement; keep it.
- Do NOT re-order limb points by centreline projection — it degenerates at the tips
  (tried, failed). Keep the traced loop's NATIVE order (it's continuous by construction)
  and only split it.
- Do NOT inject contact points into curves or dedup by proximity — root-cause instead.

────────────────────────────────────────────────────────────────────────
## 6. HOW TO VALIDATE (exact method — use this every time)
────────────────────────────────────────────────────────────────────────
Load the generator as a module, build a path, compare to the matching Jubier KMZ.
Distances are 3D-unit-vector point-to-polyline great-circle (antimeridian/pole safe).

Skeleton (adapt as needed):
```python
import importlib.util, json, math, glob, zipfile, re, statistics, io, contextlib
s = importlib.util.spec_from_file_location('g','data build tools/gen_eclipse_paths.py')
g = importlib.util.module_from_spec(s); s.loader.exec_module(g)
# recs[(y,m,d)] = dict(record) from data/besselian/*.json
# grab(kmz_path,'Northern Limit'|'Southern Limit') -> list of (lon,lat)
# build: p = g.build_path(dict(recs[key]))   (wrap in redirect_stdout to silence)
#        un = p['umbra_n'][0]; us = p['umbra_s'][0]
# used cone? : g.cone_limit_split(dict(recs[key])) is not None
# worst-turn: max interior turning angle (deg), excluding |lat|>85
# accuracy: median & max of point-to-Jubier-polyline distance (km), sampling ~40 pts
# NB: normalize our lon to [-180,180] before comparing (cone limbs may be unwrapped)
```
Targets: worst-turn ≤ ~1° (smooth, no zigzag) AND sub-km median vs Jubier (max ≲ 1–2 km
acceptable, but investigate anything > ~2 km — it usually means a tip straddle).

To diagnose a loop's topology: trace it (`g._cone_trace(rec, g._cone_seed(rec))`) and
print every Nth point, plus the high-curvature clusters, to see tips vs dateline wraps.

────────────────────────────────────────────────────────────────────────
## 7. WORKFLOW TO FINISH AND SHIP THE GENERATOR
────────────────────────────────────────────────────────────────────────
1. Implement the three fixes in §5 in `data build tools/gen_eclipse_paths.py`
   (the canonical file). Verify imports after each edit.
2. Re-run the §6 validation on ALL of: 2017, 2024, 2027, 1773, 1154, 1526 (the cone
   cases) AND confirm fallbacks unchanged: 2026, 2033, 2045, 2060, 2061, 2097(polar),
   1999. Goal: every cone case smooth + sub-km; every fallback unchanged.
3. When all pass, copy to /mnt/user-data/outputs and tell the user it's ready.
4. The user then rebuilds ONE century to a scratch dir first, e.g.:
   `python3 "data build tools/gen_eclipse_paths.py" --year 2050 --out-dir ./data/paths_NEW --jobs 0`
   eyeballs it in-app, and only then overwrites `data/paths/` and rebuilds all centuries
   with `--jobs 0`. NOTE: `--year YYYY` builds the chunk containing that year;
   `--out-dir` controls output location. The user's installed app currently still shows
   OLD envelope paths everywhere (no cone rebuild has shipped yet) — expected.
5. Generator gets its OWN commit, separate from front-end, only after the user verifies.

────────────────────────────────────────────────────────────────────────
## 8. ACCURACY SCORECARD (current, vs Jubier)
────────────────────────────────────────────────────────────────────────
- Umbra limits: sub-km where cone applies and verifies; envelope fallback elsewhere
  (also sub-km, except it still ZIGZAGS on the unfixed cases 1154/1526 and any other
  tip-fold eclipse not yet covered by cone).
- Green / Max-on-Horizon line: sub-km (contour trace).
- Terminator: ~3–5 km. Penumbra: ~9 km (user accepts "close"). Centreline: width 1.5.
- Bisector line: removed (green supersedes it).

────────────────────────────────────────────────────────────────────────
## 9. DEFERRED / FUTURE (not now — do not start without the user asking)
────────────────────────────────────────────────────────────────────────
- Mobile UX/layout pass (one focused sitting). IMPORTANT: there are TWO tab bars in
  index.html — one desktop-only, one mobile-only. They are NOT duplication; tabs may
  behave differently on mobile. Do not merge them. Also #15: reconcile map date overlay
  vs redundant status during mobile testing.
- #6 separator standardization across panel/table (cosmetic; user said "next round").
- Green-trace optimization knobs (documented in TODO): inner time-search sample count
  (~44/step, the main cost), maxpts (4000), step size. ~2–3× speedup possible but each
  is accuracy-tuned — re-validate vs Jubier after any change. Not applied.
- Polar/asymmetric eclipses (2026, 2033) correctly fall back to envelope; their open end
  is the terminator, not a tip. Proper unification is a later task.
- Editable lat/lon/alt in panel: SKIPPED (map-click covers it).
- Server-side share page; PWA splash/icon; night-sky-during-totality view.

────────────────────────────────────────────────────────────────────────
## 10. FIRST ACTIONS FOR THE NEXT SESSION
────────────────────────────────────────────────────────────────────────
1. Read this file fully, then skim `SPLITTER_PROGRESS.md` for the deep history.
2. Confirm the generator imports cleanly.
3. Reproduce the §5 validation table so you trust the starting point.
4. Then implement the three §5 fixes in order (2024 crossover, 1154 loop-unwrap, 1526
   diagnosis), validating after each. Be concise with the user throughout.
