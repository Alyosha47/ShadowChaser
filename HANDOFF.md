# ShadowChaser — Session Handoff — 2026-07-13 (standalone, authoritative)

> ## ▶ START HERE (next session) — this block is self-sufficient; you need nothing else to begin
>
> ### What this project is
> ShadowChaser (followtheshadow.com/app) — an **offline-capable eclipse-path PWA**. A Python
> generator computes shadow-path JSON from Besselian elements for ~11,898 eclipses; a vanilla-JS
> frontend renders them on a **CesiumJS globe**. Standard, non-negotiable: **ships only when every
> case is correct vs Xavier Jubier's KMZ ground truth.**
>
> **The v2 Cesium migration is DONE.** Anything below (or in older sections) describing MapLibre +
> deck.gl as the renderer is HISTORICAL — `js/map_maplibre.js` is a vestigial file, not in use.
> Cesium was chosen because it renders on the true WGS84 ellipsoid (retiring a whole class of
> seam/pole bugs) and because it natively supports the **terrain/shadow work that is the next big
> feature**.
>
> ### Where things are (don't ask Guy — it's here)
> - **Repo:** github.com/Alyosha47/ShadowChaser — **working branch `cesium`** (NOT `main`).
> - **Cesium is vendored** at `vendor/cesium-1.121/` and is **gitignored** (not in your clone).
> - **You (assistant) get a FRESH throwaway clone each session.** It does NOT reflect Guy's local
>   state or BUILD. Never trust your clone for `git log`/BUILD/commit state.
>
> ### HOW TO DELIVER WORK — read this, it is not what older sections say
> **Do NOT hand Guy git commands. He does not use them and has said so.** He works from files.
> - Deliver the **changed files themselves**, ready to drop into their folders
>   (`js/*.js` → `js/`, `css/app.css` → `css/`, `index.html` + `sw.js` → repo root).
> - **Deploying is a MANUAL file upload** to followtheshadow.com/app (Bluehost/Apache). Git commits
>   do NOT deploy. Guy has a one-click sync, but must first save each file into its local folder —
>   **that is the tedious part, so keep the number of changed files down and say plainly which
>   files changed and where each one goes.**
> - He **declined** a zip bundle (feared it would overwrite whole folders). Don't push it again.
> - **After every upload the server files must be `chmod 644`** — new uploads land 600 and 403,
>   which shows up as a mysteriously blank/broken map. This has bitten twice.
>
> ### BUILD + the service worker (this cost a whole night — internalize it)
> `index.html` holds `var BUILD = 'YYYY-MM-DD'+letter` — **the single source of truth** — and
> `?v=BUILD` is appended to `js/*`, `css/*` and `data/*` fetches. **Bump BUILD on every deploy.**
> `sw.js` serves cache-first with `ignoreSearch`, so an unbumped BUILD masks your change behind the
> old cached copy. **First move when "it broke again" with no console error:** Application →
> Service Workers → Unregister / Clear site data → hard reload. (Guy already does this between
> builds as a matter of course.)
> - **Caveat:** the `?v=` on the `<script>` tags is hardcoded per-tag and has DRIFTED before — some
>   were pinned at an old date and would have served stale copies of edited files. When you bump
>   BUILD, bump **every** `?v=` in `index.html` with it.
>
> ### Cardinal rules (full list in §CRITICAL USER PREFERENCES — these are load-bearing)
> - **BE EXTREMELY CONCISE.** Reference docs like this are the exception; chat is not. Do NOT
>   repeat long sections across replies — it wastes his time and your context.
> - **ONE step at a time.** Don't pile up instructions or interleave threads of work.
> - **NEVER break working code.** `node -c` proves syntax, not behaviour.
> - **NEVER GUESS.** Measure. Read the code. If you can't verify, say so.
> - **Don't make UI/default decisions unilaterally.** Recommend one option; don't stall with menus.
> - **Don't solve problems by throwing away solutions.** Never quit; root-cause it.
> - **Never assume he's tired.** Never do Mac-side debugging of the iPhone (settled; don't re-raise).
>
> ### 🧭 THE STANDING RULE (earned expensively — see TODO)
> **Before writing per-frame code or geometry tricks to fake a visual effect, NAME the Cesium API
> that should do it. If you can't name one, say so out loud rather than hacking silently.**
> Two proofs: the land fill was floated as a *primitive over* the globe (→ clamp-to-ground → the
> iOS crash) when the answer was **imagery**, i.e. part of the surface; and the eclipse paths were
> *lifted* to win a depth fight when the answer was **`depthFailMaterial`**, at zero geometric cost.
> **Corollary — beware "safety rails":** constants added as harmless guards became the DOMINANT
> term twice (a 2 km arrow floor at street zoom; a screen floor that overrode a ground cap). If two
> limits can fight, decide which must win and check the arithmetic at BOTH extremes.
>
> ### Current state (2026-07-13, branch `cesium`, BUILD 2026-07-13g)
> - **OFFLINE WORKS on iOS** — the multi-week crisis is CLOSED and banked. See §CESIUM ERA below
>   for the five root causes; do not re-derive them.
> - **The map is cosmetically finished.** Sun arrow, push-pin marker, borders, city labels, umbra
>   ovals, polar holes, tabs, basemap picker, load bar — all landed and user-verified.
> - **The code got SMALLER.** The land fill and the raster→vector crossfade were **deleted**; both
>   platforms now run identical data and identical vector code. Two axes of platform divergence gone.
> - **Math + path generation remain DONE and banked** (umbral-limit topology, V-angle, spherical
>   metric). Untouched by the Cesium work.
>
> ### What's next (priority)
> 1. **Topographic shadow overlay (#F4)** — THE next big feature, and the reason for Cesium.
>    Needs real scoping: terrain provider, and the big question of **offline terrain data**.
> 2. **Full-catalog audit — the pre-ship GATE** (~11,898 eclipses). Spot-checks proved insufficient.
> 3. Smaller: preload the three About-link eclipses; border-fade via native API; HANDOFF/TODO upkeep.
>
> ### The two task docs
> - **TODO.md** — the task list (has a "Shipped this session — do not re-open" block; trust it).
> - **THIS file** — knowledge & status: how things work, what's closed, derivations, lessons.

**Last updated:** 2026-07-13 — Cesium era: offline crisis closed; full cosmetics pass; land
fill + crossfade deleted. BUILD 2026-07-13g. Prior 2026-06-24: umbral-limit topology closed,
antimeridian regression fixed with a spherical metric, Cesium chosen for v2 (GEN_VERSION
2026-06-24h). Earlier sessions (path generator, V-angle, PWA/service worker, vendoring) are
below and remain valid EXCEPT where they describe MapLibre rendering.
**Repo:** github.com/Alyosha47/ShadowChaser (branch `cesium`)

---

## TABLE OF CONTENTS

- **§SESSION 2026-07-10 → 07-13 — THE CESIUM ERA** ← START HERE for anything map-related.
  Offline closed (5 root causes), verified traps, what was deleted, the duplicate-download
  situation, and the map's current state. **Supersedes every MapLibre-era rendering section below.**
- **▶ START HERE** (top) — operating manual: repo, run/commit commands, BUILD+SW cache, cardinal
  rules, current state, what's next, hardest-won lessons.
- **Session logs** (most recent first): §SESSION 2026-06-24 (umbral-limit topology closed; mapping
  diagnosed) · §SESSION 2026-06-16 (path-generator advances) · §SESSION 2026-06-07.
- **§CRITICAL USER PREFERENCES** — the full cardinal-rules list. Read before coding.
- **§WHEN TO USE OPUS VS SONNET**
- **§REPOSITORY STRUCTURE** — the file tree.
- **§CRITICAL OPERATIONAL NOTES**
- **§OFFLINE GLOBE — DATA & RENDERING** — basemap pipeline, oval/zoom machinery, the 2026-05-31 work.
- **§FOUNDATION — VENDORING** — why libs are vendored (service-worker prerequisite).
- **§THE V-ANGLE DERIVATION** — authoritative; do NOT re-litigate.
- **§CURRENT STATE OF FEATURES** — what's working.
- **§OUTSTANDING ITEMS — PRIORITIZED** (note: live task list is TODO.md).
- **§RECURRING ANTI-PATTERNS** — read before coding.
- **§TECHNICAL CAVEATS / GOTCHAS**
- **§DEPLOY CHECKLIST**
- **§SERVICE WORKER / PWA** — the offline architecture (sw.js, caching strategy).
- **§AFTER — the frontier.**

**Document map (two files, one job each — do not duplicate):** THIS handoff owns *current
status* — what changed, what's deployed, how things work, what's closed, what's next; it
is dated and rewritten each session. **`TODO.md`** owns *durable detail* — open bugs'
candidate fixes, UX-question deliberations, the feature idea-pool, perf/data notes, and
the refactor ledger; it accretes and is pruned, never restates status. When this handoff
says "candidates in TODO.md," the detail is there. When an item is fixed, it is deleted
from TODO.md (the handoff records the closure) — no "DONE" tombstones in the TODO.

---

## SESSION 2026-07-10 → 07-13 — THE CESIUM ERA (offline closed; map finished)

### 1. THE OFFLINE CRISIS — CLOSED. Five root causes (do not re-derive)
The multi-week iOS offline failure was **five separate bugs**, not one:

1. **iOS never reports offline.** `navigator.onLine` lies, and the `offline` event does not fire.
   Replaced with an **active probe** (`PROBE_URL` = an Esri z0 tile) every 5 s, with a 3 s
   `AbortController` timeout — iOS *hangs* rather than failing an offline fetch — and cache-busted
   (iOS ignores `no-store`). One `_online` boolean drives `applyOnlineState()`.
   **Negatives are DEBOUNCED** (`NEG_PROBES_TO_GO_OFFLINE = 2`): a single timed-out probe must not
   flip the app, or a slow load oscillates offline↔online and rebuilds everything repeatedly.
   Positives are trusted instantly; `navigator.onLine === false` is trusted instantly.
2. **Offline reload hung** — Cesium's geometry **Workers** weren't precached. `sw.js` now precaches
   ~107 Cesium worker/asset files.
3. **iOS killed the renderer on tab-backgrounding** — the cause was Cesium's default render-pipeline
   **framebuffers**, not our data. Mobile now disables skyBox, skyAtmosphere, FXAA, and MSAA=1.
4. **`f.globe` render crash + gappy paths** — caused by **CLAMP-TO-GROUND** on iOS. Removed entirely.
5. **Land fill swallowed the labels** — a floating primitive coplanar with the surface fights
   everything. Solved by making land part of the **globe surface** (NE2 imagery). *(This whole
   layer has since been deleted — see §4.)*

Also: in-flight fetch dedup (`chunkLoading`, `pathLoading`) killed a network storm; and a "missing
land" bug was **server file permissions** (uploads land 600 → 403). `chmod 644` after every upload.

### 2. ARCHITECTURE — `map.js`
All platform branching lives in **ONE** `IS_MOBILE` const feeding a declarative **`PROFILE`**
object (resolution, MSAA, FXAA, sky, tile cache, raster, dataSuffix, cityMaxRank…). Do not scatter
`isWide()`-style checks back through the file — collapsing them was a hard-won win.
As of this session **desktop and mobile load identical vector data (50 m) and run identical vector
code**; the `landFill`, `eagerVectors` and `_lo`-dataset divergences are all GONE.

### 3. ⛔ VERIFIED TRAPS (each cost real time — do not re-attempt)
- **Do NOT re-add clamp-to-ground on iOS.** (`f.globe` crash + path gaps.) Plain height-0 geometry
  and depth-tested billboards are fine; only the *classification clamp* is banned.
- **Do NOT lift the eclipse paths off the ground.** They sit at EXACTLY height 0. Lift parallaxes
  them by `height × tan(view angle)` — a 50 m lift is 29 m of displacement at 30°, which is
  meaningless noise on a centreline computed to ~15 m. If something occludes them, use
  **`depthFailMaterial`** (already in place). *This is the science; it is not negotiable.*
- **Do NOT bother disabling OIT on mobile** — tried, didn't help. The framebuffer cuts did.
- **Do NOT "fix" the duplicate downloads inside `sw.js` without care.** See §5.
- **Do NOT make NE2 lazy.** Tried; it made the offline raster depend on the probe, and a probe
  timeout under load oscillated offline↔online → a 45-second double load. NE2 is eager and resident.

### 4. WHAT WAS DELETED (the codebase got smaller)
- **The vector land fill** — it was the mobile OOM, and mobile had already abandoned it.
- **The raster→vector crossfade** — the per-frame `band()` alpha ramp. It only engaged at zooms
  where the view was undifferentiated green anyway, and it was the most bug-prone machinery in the
  file. NE2 is now simply *the* offline surface, always opaque, at every zoom. Crisp detail at depth
  comes from the vector **lines** (borders/rivers/lakes/cities), which are always on.
- `buildFill()`, the `land.geojson` fetch and precache, and the 110 m `_lo` vector set.

### 5. KNOWN, MEASURED, NOT-YET-FIXED: duplicate downloads
Every asset downloads **twice** on a build change (~317 requests, 22 MB). Cause: the page requests
`js/map.js?v=BUILD` while `sw.js`'s precache lists say bare `js/map.js` — two URLs, two downloads.
**It is PRE-EXISTING** (present throughout the successful offline milestone) and **harmless**: the
network panel shows the SW-initiated fetches served from `(disk cache)` in 2–9 ms; load is ~11 s,
DOMContentLoaded ~950 ms.
**Two failed fixes — do not repeat:**
- A single-flight `fetchOnce()` inside `sw.js`: **structurally impossible.** Guy clears site data
  between builds, so no SW controls the page at load — the page's fetches never reach the handler.
- Making the SW precache the versioned URLs + `'reload'`→`'default'`: **broke the eclipse paths.**
  Reverted (branch `sw-dedupe`, unmerged).
**The real fix, for a calm dedicated session:** stop precaching what the page fetches for itself
(the fetch handler already caches on demand); precache only what the page never requests (Cesium
Workers/Assets, out-of-range data). `sw.js` is the most fragile file in the project — treat it so.

### 6. THE MAP AS IT NOW STANDS
Sun arrow (red surface geometry, filled dart, **constant 44 px** via `camera.getPixelSize()`, ground
cap 300 km, base pinned at height 0 so it can't parallax off the marker — it points at the **Sun's
azimuth at maximum**, not at the centreline) · **push-pin** observer marker (canvas billboard,
bottom-anchored so the *tip* is the coordinate, contact dot; a drop-shadow was tried and rejected as
a smudge) · orange GE diamond · flat city dots · warm-charcoal borders that fade with zoom-out ·
city labels drawn **whole** (`disableDepthTestDistance: Infinity`) with a per-city
**`EllipsoidalOccluder`** horizon test — this fixed both the half-eaten labels ("Mexico City" → "TY",
caused by depth-testing the label quad at the limb) and the whole-hemisphere blink (caused by a hard
distance cutoff firing on thousands of labels at once) · umbra ovals fade · **polar holes**: every
Web-Mercator source truncates at ±85.0511°, so NE2 showed through underneath as a mismatched patch;
fixed with a filler **imagery layer** slotted at the tile layer's index (never on top, never under
NE2), its colour **SAMPLED at runtime from each provider's own z=0 tile** — correct for any basemap,
now and future · basemap picker (7 free providers, live swap) · 1 px load crawlbar · Details-tab
throb on new location.

---

## SESSION 2026-06-24 (what changed) — UMBRAL-LIMIT TOPOLOGY CLOSED; MAPPING DIAGNOSED

**State: math/mapping called DONE.** Every eclipse inspected across the 16th and 21st
centuries renders correctly. Path generator is `data build tools/gen_eclipse_paths.py`,
**GEN_VERSION 2026-06-24h**; frontend **BUILD 2026-06-24i**.

### Umbral-limit topology — the full space of limb shapes now handled
Worked through every umbral-limit "topology" against Jubier and fixed each at root:
- **Near-pole loops** (1533): depth field switched from ever-total (`_cone_depth`) to
  **local-in-time peak** (`dep_local`, hill-climb to the nearest local max of g(t)). Closes
  the loop-interior gap. `perpendicular_limits` now takes per-point times; march cap 600 km.
- **Terminus completion** (`_terminate_on_green`): every limb ends exactly on the green line
  at its analytic `_GREEN_TERMINI` tip (mag→1 ∩ alt→0 is a tangency the iterative march
  cannot reach, so the exact corner is supplied). Corrected the global ~18–25 km terminus
  shortfall on ALL central eclipses → 0–3 km of Jubier, and removed the 1533 curl.
- **Non-central grazers + central one-limit** (Tn/Ts, A±/An/As): dispatch on the type-code
  2nd char; analytic `umbra_pts` walk per limb, **each over its OWN validity interval**
  (walking both over a shared interval under-samples the shorter limb to nothing). Fixed
  1511/1523/1529/1552/1569/1598 (were blank/stub) and the two-limb cases 1547/1554/1565.
- **Pole-transit split** (`_split_at_pole`): breaks a limb where two consecutive points are
  both at |lat|≥89.9 (a spurious across-pole connector). Fixed 1591.

### The `_terminate_on_green` regression — and the principled fix (the hard lesson)
A first cut of terminus completion **gutted normal eclipses** whose ends sit at
sunrise/sunset rather than a polar tip — **2028-07-22** (mainstream Australian total) and
**2041-04-30** both collapsed to 2-point stubs. Two wrong turns before the real cause:
a half-of-the-limb guard (a patch) and a sun-altitude gate (the data showed it does NOT
separate the cases — overlapping values). **Root cause: a planar (lon,lat) distance metric.**
2028's umbra crosses the antimeridian, so its endpoint (lon 180.8) and true terminus
(lon −179.5) are 14 km apart on the globe but ~360° apart on a plane → it matched the wrong
(far) terminus and truncated the limb. **Fix = the correct spherical metric (`_gc_dist`)
throughout, plus an end-correspondence guard** (a terminus completes only the end on whose
half its closest approach falls — handles the case where an end has no terminus at all, e.g.
an umbra that lifts off mid-disc, as in 2041). Verified: 2028/2041 back to full, 1533 tip
still exact at (−152, 62), zero gutted across a 10-eclipse spread (1203→2501).
**Lesson: on a sphere, use a spherical metric; a planar nearest-neighbour silently fails at
the antimeridian. And do not ship a terminus-completion change without the broad no-gut check.**

### Mapping/rendering — diagnosed, NOT migrated (the big realization)
The recurring seam/pole rendering pain was traced to a single architectural fact: **both
renderers in the stack triangulate fills in flat lon/lat and wrap to the globe**, so poles
and the antimeridian are singularities in the *renderer*, not the data. MapLibre's GeoJSON
fill uses geojson-vt (Mercator-internal, documented "hole past 85°"); deck.gl's
SolidPolygonLayer inverts a polygon that contains a pole. Findings:
- **Two basemaps**: online = OpenFreeMap "liberty" vector tiles (`ONLINE_STYLE_URL`);
  offline = the local GeoJSON bundle. **The Antarctica wedge is ONLINE-only** — the offline
  land was already preprocessed (correctly-wound, antimeridian-split) and renders fine. A
  latitude-clip of the offline land was tried and **reverted as unnecessary** (it fixed a map
  that wasn't broken and added a pole hole). *Always confirm which basemap is live before
  editing basemap data.*
- **Pole-enclosing umbra ovals** can't be *filled* by either renderer; degraded to an
  **outline** (a line across the pole renders fine) instead of inside-out or blank. Normal and
  antimeridian ovals still fill (antimeridian ones split into in-range halves).
- **Decision: Cesium (v2)** is the principled cure — it renders on the true WGS84 ellipsoid,
  no flat-projection seam/pole singularities, fills poles natively. Apache-2.0/free, ion
  optional, offline basemaps keep working, scoped to the map layer only. Deferred to v2; the
  online Antarctica wedge and the pole-oval fill both resolve there. (See TODO v2 list.)

### Also this session
- **Arrow-key navigation** (`list.js`): ←/→ step prev/next through the current filtered list.
- **Run timers** (generator): per-century elapsed line + a per-run total across centuries.
- **Dead-code cleanup, byte-identical verified.** Generator −171 lines (`_v3u`, `_cross3`,
  `cone_limit_split`, the superseded nested `_extend_to_green`); `map.js` −44
  (`corridorToPolygonData`, leftover from the disabled corridor fill). Output proven
  byte-identical across 13 eclipses / 5 centuries, so GEN_VERSION stays 24h (drop-in, no regen).

### What remains (in TODO.md)
The pre-ship gate is the **full-catalog audit** (build all ~11,898, flag stub/asymmetric/
wild-turn umbra limbs) — foldable INTO the regen (per-eclipse flags to a report, no extra
runtime). The 2028 regression proved spot-checks miss things. Plus the v2 map work and the
small UI items. Residual cosmetics: 1533/1563/1587 terminus-join kinks, 1522 bumpy grazer.

---

## SESSION 2026-06-16 (what changed) — PATH GENERATOR ADVANCES

### Green line (Maximum-on-Horizon) — now a sub-km implicit-contour trace
The green curve is traced as the zero level set of {sun altitude at greatest eclipse = 0}
via a predictor–corrector (seed on sign change, step along the tangent, Newton-correct onto
the contour). Validated **sub-km vs Jubier's "Maximum on Horizon" curves** (2017 0.8 km,
2024 1.8 km median). This is the first path built on the general implicit-field engine that
the whole path family is intended to migrate onto (see §UNIFICATION VISION).

### Bisector removed (redundant)
Our old `_bisector_curves` was meant to be the Max-on-Horizon curve but measured 33–43 km
off Jubier. The green line does the same curve at sub-km, so the bisector was dead weight.
**Removed** from the generator: `_bisector_from_lemniscate`, `_bisector_curves`, the build
call, the `'bisector'` output field, and its rounding entry. The renderer never drew it
(only a stale comment at map.js ~L796 — flagged for cleanup, harmless).

### All path types validated vs Jubier (Phase-0 validation pass)
| Curve        | vs Jubier            | Verdict                                  |
|--------------|----------------------|------------------------------------------|
| Umbra limits | sub-km               | good EXCEPT grazing-tip zigzag (below)   |
| Green line   | sub-km (0.4–1.8 km)  | good                                     |
| Terminator   | 3–5 km (Sun Rise/Set)| good                                     |
| Penumbra     | ~9 km                | close; user accepts (naturally fuzzy)    |
| Bisector     | (removed)            | redundant w/ green                       |
Penumbra detail: our edge sits ~7–10 km INSIDE Jubier's, asymmetric N/S — a boundary-
definition (threshold) difference on a genuinely fuzzy edge, NOT random error. User is
satisfied with "close." Detail in TODO.

### Grazing-tip zigzag — root-caused AND fix proven (splitter remaining)
The umbral limits use an envelope-of-moving-shadow method + a straight-chord extension to
the green terminus. On grazing eclipses the envelope stops where the shadow axis leaves
Earth's disk (|C|→1); totality continues to the terminator, and the chord bridging that
real-totality stretch is the visible zigzag (signature in audits: `gap NNN km` + `interior
turn ~150–177°` at an end). Affects ~half of eclipses.
- **Proven fix:** trace the umbral limit as the cone–spheroid intersection contour — the
  zero level set of the ever-total depth field h(lat,lon) = max_t(|L2 − ζ·tan_f2| − m),
  same engine as the green line. Validated **sub-km vs Jubier** (2017 N 0.28 / S 0.15) AND
  reaches the grazing tips (1144 BCE: max gap 25 km = tracer step, vs the old 950 km chord).
- **The one blocker:** splitting the traced closed contour loop into the two named N/S limit
  polylines. Simple-geometry eclipses (2033) split perfectly (worst-turn 2°); corridor-
  shaped ones do not yet. Four splitter approaches tried and rejected — full ledger +
  next-approach (maximum-curvature tip detection) in TODO "Umbral grazing-tip zigzag".
- WIP integration saved (sandbox); NOT shipped. v9 envelope remains the shipped umbra.

### REVERTED: a latitude-relabelling "fix" that broke clean eclipses
A change to `umbral_pts` relabelling N/S by geographic latitude (instead of the fixed side
index) was shipped without full validation and caused 150–170° folds on 2017, 2026, 2002.
**Reverted.** Lesson re-learned the hard way: never ship an umbral-limit change without the
full multi-eclipse worst-turn check. The shipped generator = the validated v9 lineage.

### BUILD cache-buster — the "1957 missing path" saga
Reported: 1957-04-30 (annular grazer) showed no umbral path. Traced end-to-end: the data
was CORRECT (a valid single-sided antumbral path; grazers legitimately have only one limit),
the generator was correct, the file was correct — the app served a STALE cached `.gz`
because `BUILD` had not been bumped after the rebuild. Bumping BUILD fixed it. This is now a
standing rule (see BUILD note above) and the build assistant bumps BUILD automatically.

### Confirmed-correct (not bugs)
- One-limit grazers (1957 April annular N-only, October total other-side-only) — correct.
- Terminator "blob twist" near poles (2006, 2023, 2041) — the sunrise/sunset lemniscate is a
  closed teardrop that self-closes; correct geometry, matches Jubier/Espenak.

---

---

## SESSION 2026-06-07 (what changed)

### Path generator corrected & adopted — `data build tools/gen_eclipse_paths.py`
The prior working file was an older copy; the corrected version (developed in a previous
session as "v2") is now the single canonical generator (renamed over the old one, committed
`61d05fc`). Two real fixes vs the old file:
- **Umbra `search_m` scales with path width** (`max(path_width_km · 500 · 1.5, 300 km)`)
  instead of a fixed 300 km. At high gamma / high latitude the umbra bows asymmetrically and
  one limit sits >300 km from the centreline; the fixed window truncated the **north umbral
  limit** (canonical case 2600-05-05, path key 10926: N limit was 111 pts / 12° lon vs S
  limit 388 pts / 100°). Now traced full-length.
- **Oval bisect stops at the terminator** (`zeta=0`) instead of overshooting below the
  horizon — fixes wildly-placed oval points near the limb.
There is now exactly ONE generator file; the old duplicate caused a session of chasing the
wrong baseline. Do not reintroduce a `_v2`/`_v3` suffix — version history is git's job.

### Repo de-bloated — generated paths no longer tracked
`data/paths/` (~274 MB of `*.json.gz`) was git-tracked, so every regeneration committed a
fresh full copy into history forever (gzip can't delta-compress). Paths are **build
artifacts** — source of truth is `data/besselian/` + the generator, and deploy is via SFTP,
not git. So: added `.gitignore` (`data/paths/`, `.DS_Store`, `*.pyc`, `__pycache__/`) and
`git rm -r --cached data/paths` (files stay on disk; only untracked). This stops growth; it
does NOT shrink existing history (that needs a destructive `git filter-repo --path
data/paths --invert-paths` + force-push — deferred unless the ~274 MB actually hurts).

### Corridor sampling-artifact bug — characterized, NOT fixed (detail in TODO)
The umbra corridor (`umbra_n`/`umbra_s`) is built by bisecting **perpendicular to the
centreline** at each time step. This is **accurate** — every corridor vertex evaluates to
magnitude = 1.0000 (verified via `_max_magnitude`). But perpendicular-from-centreline
under-samples the true totality boundary at awkward geometry, in two visible ways:
- **Elongated-end tip protrusion** (2026-08-12): the last ovals are hugely elongated
  along-track (~650 km major axis); their along-track tips pierce the corridor flank by up
  to ~25 km (15 oval pts outside the polygon; 2017 has 13 too — benign caps). The protruding
  points are themselves true magnitude-1 points the polyline chords past.
- **Persistent kinks** (2611-09-28 N limit ~98°, 1001-03-27): the perpendicular bisect lands
  on a valid mag-1 point displaced from the smooth trend. Finer sampling reduces but doesn't
  remove it (~60° residual). The bearing finite-diff (dt=0.0001 h ≈ 0.36 s) adds noise.
**Physical truth (USER): eclipse paths are always smooth — a shadow on a sphere — so any
kink is a method artifact, not real geometry.** Four accurate-fix strategies were built and
tested on real data, all rejected (contour-walk → pole spikes; perpendicular level-set
refinement → wrong-axis spikes; sparse-oval polygon union → junction notches; dense-oval
union → polar lon/lat degeneracy). A global bearing-dt change is **whack-a-mole** (dt=0.001
fixed 2611 but regressed 1001-03-27). The genuine fix is a spherical-geometry **envelope
trace** (large, deferred). A **safe partial** is spec'd in TODO (guarded local kink
re-solve, monotone-safe post-pass). Verdict: the dataset is accurate; this is polish. See
TODO "Corridor sampling artifacts" for the full ledger and the candidate fix.

---

## CRITICAL USER PREFERENCES (read first, violate at peril)

Repeatedly violated in the past; the user is genuinely frustrated by it:

- **Be EXTREMELY CONCISE.** No preambles, postambles, lengthy explanations.
- **NEVER break working code.** Test/verify before claiming a fix. The user has been
  burned by false "this is fixed" claims.
- **TIDY, CLEAN, CHAFFLESS, PATCHLESS code.** No layered modifiers, no special cases on
  top of special cases. Replace structures whole; don't add patches. If a code path
  needs three guards, the structure is wrong.
- **DON'T reflexively backlog** — push through bugs when possible.
- **DON'T over-engineer.** "The simple boring obvious version" is usually right. NO
  GYMNASTICS. Look for the platform-native solution before writing code.
- **DON'T make decisions without consulting the user** (dropping precision, default
  behavior, fundamental UI choices).
- **ALL time is honest diagnosis time.** Don't guess in a confident voice; admit
  uncertainty. Verify by running the real pipeline, not a hand-substituted shortcut.
- **Goal: app must work fully offline in the field.** PWA/service worker eventually.
- **Model:** this session was **Claude Opus 4.8** (prior docs said 4.7). Opus for
  design/architecture/math; the user prefers to hand polish/mechanical work to Sonnet.
- **Don't tell the user to stop / take a break.** The user decides when done.
- **When the user shows frustration:** stop, take an actual root-cause fix, don't
  iterate-on-iterations.
- **Don't say "you're right" reflexively** — only when they actually are.
- **Recommend ONE solution** — don't present options as a stalling tactic. Decide and go.
- **If the user pushes back, don't fold immediately** — but don't dig in either. Honestly
  re-examine. (This session: doubted the interior V-flip after a bad spot-check, then
  re-examined by running the real code and confirmed it. That is the right loop.)
- **When the user asks "is this OCD-tidy/elegant?"** do an honest audit — report both
  what IS tidy and what ISN'T. Never reflexively "yes."

---

## WHEN TO USE OPUS VS SONNET

**Opus is worth it for:** personal-list scoping; weather-overlay scoping; multi-file
architecture; UX with no obvious right answer (global-vs-local eclipse-type semantics).
The **V-angle math is now DONE** (was the canonical Opus item).

**Sonnet handles fine:** SVG/CSS polish, label renames, contrast nudges, mechanical
file splitting, and most bug-fix follow-ups in the (now untangled) code.

---

## REPOSITORY STRUCTURE

```
ShadowChaser/
├── index.html          (HTML only; CSS external; holds BUILD constant)
├── .gitignore          (data/paths/, .DS_Store, *.pyc, __pycache__/ — added 2026-06-07)
├── TODO.md          (durable detail — bugs' candidate fixes, UX questions, features)
├── HANDOFF.md          (this file)
├── HANDOFF-2026_05_18b.md, HANDOFF-2026_05_19.md  (STALE — archive/delete)
├── vendor/             (all third-party libs — added 2026-05-31)
│   ├── maplibre-gl-5.5.0.js   (924KB; version in filename; no ?v=)
│   ├── maplibre-gl-5.5.0.css  (69KB)
│   └── deck.min.js            (moved here from repo root 2026-05-31)
├── css/
│   └── app.css         (all styles, ~1075 lines; YOURS — never put vendor CSS here)
├── fonts/              (JetBrains Mono, Cormorant Garamond woff2)
├── data/
│   ├── basemap/        (offline globe GeoJSON, gzipped)
│   │   ├── land.geojson.gz       (antimeridian-split — see "Offline globe")
│   │   ├── countries.geojson.gz  (antimeridian-split)
│   │   ├── lakes.geojson.gz       (clean)
│   │   ├── rivers.geojson.gz      (clean)
│   │   ├── cities.geojson.gz
│   │   └── ocean.geojson.gz       (ORPHANED — fetch removed; safe to delete)
│   ├── besselian/      (per-century eclipse element records, e.g. 2001_2100.json) — SOURCE
│   │                    OF TRUTH for paths; tracked in git
│   └── paths/          (generated *.json.gz corridors — NOT git-tracked as of 2026-06-07;
│                        build artifacts, regenerate from besselian + generator, deploy SFTP)
├── data build tools/   (dev scratch; also holds gen_eclipse_paths.py — the canonical,
│                        corrected path generator (see §SESSION 2026-06-07). The .html files
│                        still ref unpkg; NOT shipped, ignore for the offline goal)
└── js/
    ├── cities.js       (lookupCity, lazy index from basemapData.cities)
    ├── details.js      (renderData, buildContactRows, contactIcon, lookupElevationAndTz;
    │                    module-locals: _timeMode, _lastLookupCoords)
    ├── eclipse.js      (computeEclipse, fundamentalArgs, sunAltAz, findMaximum,
    │                    findContact, getV(t,interior) — strict-mode UMD)
    ├── format.js       (fmt*, fmtUTAnchored, fmtLocalAnchored, eclipseIcon (unified),
    │                    typeIcon/contactIcon thin wrappers, horizonIcon)
    ├── init.js         (bootstrap; buildTzSelect, initMap, fetch index.json)
    ├── list.js         (renderList, selectEclipse)
    ├── local.js        (computeLocal, computeSunriseSunset, findHorizonCrossing,
    │                    scanLocation, clearLocationFilter; module-local: _currentRec)
    ├── map.js          (deck.gl + MapLibre; offline basemap; many module-level vars;
    │                    isOffline, seamFreeLines, updateMarkerOcclusion,
    │                    updateOvalVisibility, _deckLayers retainer)
    ├── search.js       (parseCoords, onSearchChanged; textarea autogrow is field-sizing CSS)
    ├── search_parser.js (pure parser, UMD, strict-mode; parseSearch, applyFilter,
    │                    filterToString)
    ├── share.js        (share modal/sheet — rewritten 2026-05-30, tabstop format)
    ├── state.js        (chunkCache, AppState get/set/on + window forwarding shims)
    ├── tabs.js         (switchTab, switchSidebarTab, TZ_ZONES)
    ├── tz_lookup.js    (3rd-party offline timezone lookup, strict-mode, bundled)
    └── url.js          (pushState, restoreFromHash, event wiring)
```

### Script load order (index.html `<head>`, exact)
```
vendor/maplibre-gl-5.5.0.css   (stylesheet)
vendor/maplibre-gl-5.5.0.js    ← NOW LOCAL (was unpkg CDN until 2026-05-31)
vendor/deck.min.js             (local)
js/tz_lookup.js                (local)
css/app.css?v=BUILD
…then (body end) format.js, state.js, tabs.js, cities.js, search_parser.js, eclipse.js,
search.js, list.js, local.js, details.js, share.js, map.js, url.js, init.js
```
**All runtime dependencies are now local** — there is no CDN dependency left in the shipped
app. (The two files in `data build tools/` still reference unpkg, but they are dev scratch,
not shipped.) This is the prerequisite that makes a service worker able to cache everything.

---

## CRITICAL OPERATIONAL NOTES

### Deploy chmod (HARD-LEARNED, REPEAT OFFENDER)
- Shared-host deploys often land files at chmod 600 (owner-only) → web server 403s every
  js/css silently → page partly loads (HTML + CDN libs) but app is dead below the tabs.
- Fix on server: dirs `chmod 755`, files `chmod 644`.
- Diagnostic: open `https://your-url/js/search_parser.js` directly — 403 = permissions,
  200 with code = fine.

### iOS Safari cross-origin error masking
- CDN-loaded script errors show as `error @ ?:?` (blank message/source) due to CORS.
- In an on-screen error reporter, filter `!e.message && !e.filename` to drop CDN noise
  and surface real same-origin errors.

### Throwaway-clone caveat (for the assistant)
- The assistant works in a fresh `git clone` each session; it does NOT contain commits
  made in the user's own working copy, and its BUILD value is whatever the assistant last
  wrote. **Do not trust the assistant's clone for git log / BUILD state.** The user's
  working copy is authoritative.

### Map-click pointer events (resolved long ago — documented so it isn't "rediscovered")
- deck.gl's overlay canvas captured pointer events before MapLibre saw them. Fix (live):
  after `map.addControl(deckOverlay)`, set `#deckgl-overlay { pointer-events: none }`.
  Keep this; removing it re-breaks map clicks.

---

## OFFLINE GLOBE — DATA & RENDERING (consolidated; the 2026-05-31 work)
> ⚠️ **HISTORICAL — MapLibre + deck.gl era.** The renderer is now CesiumJS and the offline
> architecture was rebuilt from scratch (see §CESIUM ERA). Read this for the *data* decisions
> (Natural Earth tiers, NE2 raster) and the reasoning, NOT for the rendering approach.

The offline path uses local gzipped GeoJSON as a MapLibre **globe**-projection basemap,
with an active connectivity probe that upgrades to the online style when reachable.

### Single source of truth for connectivity
`map.js` owns `isOffline()`:
```js
function isOffline() { return _forceOffline || _probedOffline === true || navigator.onLine === false; }
```
- `_forceOffline` is the debug toggle (`forceOfflineMap(on)`).
- `_probedOffline` is set from the `generate_204` probe verdict in `initMap` (the probe is
  the source of truth — `navigator.onLine` stays `true` under DevTools throttle and on many
  real devices with no connection). An `online` event clears it so we re-probe rather than
  stay stuck. **This was the fix**: previously `isOffline()` trusted `navigator.onLine`
  alone, so the elevation lookup fired (and console-errored) on every offline map click.
- Both the connectivity probe AND the elevation lookup (`details.js`) consult `isOffline()`.
  Route any new network-gated feature through it; don't re-derive offline state inline.
- A known-offline state also skips the 1.5s `generate_204` probe timeout on map re-init.

### Antimeridian / polar FILL fix (data, not code)
On a globe, a polygon ring that crosses ±180° or wraps a pole triangulates the fill the
wrong way (circumpolar stripes, wrong-hemisphere fills, malformed Antarctica). **Fix the
data, not the renderer.** `land.geojson.gz` and `countries.geojson.gz` were regenerated
with the Python `antimeridian` package:
```python
import gzip, json, warnings, antimeridian
d = json.load(gzip.open(src))
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    fixed = antimeridian.fix_geojson(d)        # ±180 split + winding + pole caps
gzip.open(src,"wt",compresslevel=9).write(json.dumps(fixed,separators=(",",":")))
```
Verify with: no consecutive ring vertices having |Δlon| > 180 (got 0 in both). `lakes`
and `rivers` were already clean. **`ocean.geojson.gz` is unused** (no ocean-fill layer;
the background color is the ocean) — its dead fetch was removed; the file is orphaned and
deletable. NB `fix_multi_polygon` chokes on a pole-wrapping polygon-with-holes (ocean);
use `fix_geojson` on the FeatureCollection if you ever need it.

### Seam-free STROKES (`seamFreeLines` in map.js)
The ±180 split inserts edges along the meridian and a ring of points at the pole —
correct for FILL, but the coastline/border `line` layers were stroking them (meridian
lines over land, a circle at the south pole). `seamFreeLines(fc)` rebuilds outlines as
LineStrings, breaking the path on seam edges (both endpoints |lon|≈180, same side) and
polar-cap edges (both |lat|≥89.9). Fill keeps the split polygons; `coast` and the border
line source are fed seam-free lines. Verified: 0 seam/pole/antimeridian edges in the
output, coastlines intact.

### Far-side marker occlusion (`updateMarkerOcclusion` in map.js)
HTML markers (observer dot+arrow, greatest-eclipse dot) are DOM overlays. MapLibre v5
fades an occluded marker to `opacityWhenCovered` (default 0.2) but leaves it faintly
visible AND still clickable — so a far-side marker could be seen through the globe and
could capture a click meant for the surface (pin placement). On every `render`, use
**MapLibre's own globe-aware test `map.transform.isLocationOccluded(lngLat)`** as the
SINGLE predicate driving BOTH `visibility` and `pointerEvents`:
```js
var occluded = map.transform.isLocationOccluded(m.getLngLat());
el.style.visibility    = occluded ? 'hidden' : 'visible';
el.style.pointerEvents = occluded ? 'none'   : 'auto';
```
- **History/lesson:** the first version used a hand-rolled 90° great-circle cull. That
  diverged from the true perspective horizon (a globe shows slightly less than a
  hemisphere), leaving a band where a marker was visually behind the globe yet still
  judged front-side → faintly visible (MapLibre's 0.2) and clickable (recentered instead
  of placing a pin). Replaced wholesale with the library's authoritative test; visual and
  click decisions now use one predicate so they cannot disagree. MapLibre v5.5.0 was in
  use the whole time — `isLocationOccluded` should have been used from the start. Read the
  platform API before hand-rolling trig.
- A fully-WebGL marker (deck.gl IconLayer w/ depth) would be even more native but is not
  warranted: blocked by `interleaved:false`, deck.gl's polar triangulation bug (#R3), and
  the CSS arrow being trivial as DOM. The DOM-marker + `isLocationOccluded` approach is
  the right level. **Both halves of the old far-side issue (visual + click) are CLOSED.**

### Antimeridian CAMERA centering (elegant single path — `map.js`)
On eclipse select with no observer pin, unwrap all path longitudes into a continuous
window anchored on the greatest-eclipse meridian, then one `fitBounds`:
```js
var anchor = (ep.ge && ep.ge[0] != null) ? ep.ge[0] : allPts[0][0];
var lons = allPts.map(p => anchor + (((p[0]-anchor)%360+540)%360-180));
// fitBounds [minLon,minLat]..[maxLon,maxLat], padding 40, maxZoom 6, duration 800
```
Replaced the old `lonSpan>180 → flyTo(GE)` two-branch patch. Crossing paths frame tightly
over the dateline; non-crossing paths unchanged. **Design note:** with no pin, the globe
intentionally frames the WHOLE path centered on the path midpoint (not GE) — deliberate
and preferred. The observer-set branch (`flyTo(coords, zoom≥4)`) is unchanged.

### Umbra ovals blink off at high zoom (`updateOvalVisibility` in map.js)
The semi-transparent umbra/magnitude ovals are useful zoomed out but obscure the point
being inspected up close, so they hide past `OVAL_HIDE_ZOOM` (=7). Mechanism: the
`umbra-ovals` SolidPolygonLayer is built with `visible: map.getZoom() < OVAL_HIDE_ZOOM`,
and a `map.on('zoom', updateOvalVisibility)` listener flips just that layer's `visible`
when the threshold is crossed — it `clone()`s the one layer into a fresh array (deck.gl
diffs by reference) and re-pushes via `setDeckLayers`. Markers are MapLibre objects, not
deck layers, so they're untouched. `setDeckLayers` now retains the array in `_deckLayers`
so the listener can do a targeted swap without a full rebuild.
- **KEY DECK.GL FACT (cost me a wrong first attempt):** deck.gl does NOT re-evaluate
  accessors (`getFillColor` etc.) on zoom by itself — accessors are cached as GPU
  attributes and only re-run on an explicit `setProps`/`updateTrigger`. A pure
  `getFillColor: () => alpha(zoom)` computes once and freezes. Any zoom-reactive styling
  MUST be driven by a zoom listener calling setProps. (deck.gl 9.3.3.)
- **Open choice (TODO → "REVISIT AFTER LIVING WITH IT"):** blink vs gradual fade. Fade
  is the same machinery with more setProps calls through a band; purely a feel preference.
  User is living with the blink first. Threshold is a one-number change.

---

## FOUNDATION — VENDORING (2026-05-31; prerequisite for the service worker)
**MapLibre and deck.gl are now served locally from `vendor/`, not from a CDN.**
- Was: `index.html` loaded `maplibre-gl@5.5.0` JS+CSS from `unpkg.com`. A cold offline load
  therefore had local basemap DATA but no rendering ENGINE → blank map.
- Now: `vendor/maplibre-gl-5.5.0.js` (924KB), `vendor/maplibre-gl-5.5.0.css` (69KB), and
  `vendor/deck.min.js` (moved from repo root). Three `index.html` lines repointed. No code
  changes — `maplibregl.*` is a global regardless of source.
- **MapLibre worker:** the standard `dist/maplibre-gl.js` builds its worker from an inline
  **Blob** (verified in the bundle), so NO `workerUrl`/`setWorkerUrl` config is needed.
- **Vendor convention established:** all third-party libs live in `vendor/`; version is in
  the filename (self-documenting, self-cache-busting); NO `?v=BUILD` on vendor files. Your
  own files keep `?v=BUILD`. Vendor CSS does NOT go in `css/` (that's for YOUR styles).
- **Verify vendoring (the correct test):** reload online with DevTools→Network open;
  confirm `maplibre-gl-5.5.0.js` loads from your origin and there is NO `unpkg.com` request,
  and the map still draws. Do NOT use the Offline throttle to test this — that blocks
  `index.html` itself (the dinosaur), which is the service-worker's job, not vendoring's.
- **⚠ CSP caveat for the upcoming service worker:** the inline-Blob worker uses `blob:`
  URLs. Under a strict CSP you must allow `worker-src blob:` (and `script-src blob:`), OR
  switch to `vendor`’s `maplibre-gl-csp-worker.js` variant + `maplibregl.setWorkerUrl()`.
  This is the one thing that can silently break the map when the SW/CSP lands.

---

## THE V-ANGLE DERIVATION (authoritative — do NOT re-litigate)

Contact-icon orientation. Solved 2026-05-31, validated against Jubier in BOTH hemispheres.

### What the icon needs
`eclipseIcon` draws the bead/bite at `bx = cx + r·sin(V°)`, `by = cy − r·cos(V°)`. So
**V is degrees CLOCKWISE FROM TOP (zenith):** 0=top, 90=right, 180=bottom, 270=left.

### The unit trap that defeated prior sessions
Jubier's table prints **P** (degree sign, 0–360) and **V** (NO degree sign, 0–12).
**Jubier's "V" is a CLOCK POSITION, not degrees** (12=zenith, clockwise). Icon target in
degrees = `Jubier_V_clock × 30`. Prior sessions compared our degrees to the 0–12 value
and concluded the math was broken — it was the UNITS.

### The formula (`getV` in eclipse.js)
With `P = atan2(u, v)` (contact PA from celestial north, CCW=east — the existing,
correct value) and `q` = Meeus 14.1 parallactic angle:
```
q = atan2( sin H , cos φ · tan δ − sin φ · cos H )
V = 180 − P − q                  (degrees; normalize to [0,360))
if (interior contact: C2 or C3)  V += 180
```
`180 −(…)` folds two conversions: subtract q to rotate north→zenith frame, and the
`180−`/negation maps the astronomical PA (CCW-east, on-sky) to the icon's clockwise-from-
top screen convention. (Cross-checked against an independent vector parallactic
computation; the difference was a constant +180° frame offset already absorbed here.)

### Why the interior (+180) flip is PRINCIPLED, not an overfit
`u = X−ξ`, `v = Y−η` is the shadow-axis DISPLACEMENT from the observer. At exterior
contacts (C1/C4) the observer is at the penumbra edge, (u,v) well-defined, correct limb.
At interior contacts (C2/C3) the observer is ~on the axis (totality), so (u,v)→~0 and
`atan2(u,v)` is unstable and lands on the OPPOSITE limb. Physically (user's framing,
correct): the bead is the Moon's **leading edge on the way in (C2)** and **trailing edge
on the way out (C3)** — opposite limbs. The code's `atan2(u,v)` at C2/C3 equals
Jubier_P+180, so the +180 flip restores the true limb.
**LESSON:** a mid-session spot-check fed Jubier's PUBLISHED P into the formula and looked
175° wrong; that was the bug in the CHECK (Jubier P ≠ code's atan2(u,v) at interior
contacts). Running the ACTUAL `computeEclipse` confirmed the flip. Validate by running
the real pipeline.

Callers: `getV(tC2, true)`, `getV(tC3, true)`; C1/C4/MAX pass no flag.

### Validation (ran real `computeEclipse`; |err| vs Jubier clock×30; budget ≈ ±3° rounding)
```
2023-04-20  Timor  8.35625°S 127.06312°E  (hybrid, S hemisphere)
   C1 344.9/345 (0.1)  C2 92.3/93 (0.7)  C3 289.2/285 (4.2)  C4 68.5/63 (5.5)
2024-04-08  Mazatlán 23.15708°N -106.37959°W  (total, N hemisphere)
   C1 64.5/75 (10.5)   C2 279.6/285 (5.4)  C3 82.7/87 (4.3)   C4 336.9/336 (0.9)
```
Both hemispheres, exterior+interior. Largest residual (C1 2024, 10.5°≈0.35 clock-hr) is
within visual tolerance. **CLOSED.** Re-verify: `computeEclipse(rec, lat, lon, 0)`,
records in `data/besselian/2001_2100.json` (match year/month/day), compare `.C1..C4.v` to
the values above.

---

## CURRENT STATE OF FEATURES (what's working)
> ⚠️ Written pre-Cesium. The MATH and PATH-GENERATION entries remain accurate and banked. Any
> entry describing the MAP/rendering is superseded by §CESIUM ERA.

### Search
- Tokenized filters: year ranges, months, days, type, magnitude/obscuration, saros,
  coordinates, cities, today/now. Year syntax: `2026`, `2026-2030`, `1994+`, `1994-`,
  `1994-now`, `after 2100`, `before 500`, `44BC`, `10BCE`.
- Cities longest-match-first (3-word max); sets location. Map-click clears `filter.city`.
- Coords shown at 5 decimals (house-accurate, explicit user pref). Field is a `<textarea>`
  with `field-sizing: content` (no JS autogrow).
- **Search-range setting** (Settings): Modern era / ±500y / Extended / All; persisted to
  localStorage; bypassed when an explicit year filter is present; small ranges search
  faster. (2026-05-30)
- Search instructions: clean 2-column CSS grid (token name | examples); "Obscuration" is
  the canonical term throughout. (2026-05-30)

### List
- Centered on today (250 before/after for blank filter). Selection persists when search
  blanked. Icons use GLOBAL eclipse type (June 1954 case fixed).

### Eclipse icons (visual identity)
- Unified `eclipseIcon({type, phase, magnitude, angle, size})` in format.js: list/MAX
  (total=moon+corona, annular=orange ring, hybrid=half/half, partial=sun+offset moon),
  C1/C4 crescent at `angle`, C2/C3 diamond bead at `angle` (white=total, orange=annular).
- viewBox 36, sun r 9. Palette SUN `#e8a04a`, MOON `#0a0c10`, HALO `#dde3ec`.
- **Contact angle `V` now correct** (see V-angle section). `typeIcon`/`contactIcon` are
  thin wrappers.
- Corona brightness/radius increased; turbulence/irregularity was tried and reverted (too
  subtle). (2026-05-30)
- Rise/Set icons: half-disc on horizon + rays; sunset = sunrise flipped vertically.

### Contact-times table
- Local default; "Local"/"UT" header cell toggles; persisted as `sc.timeMode`.
- **Sort by absolute decimal-hour UT** (`rows.sort((a,b)=>a.ut-b.ut)`); display via
  `fmtUTAnchored`/`fmtLocalAnchored` which append `(±Nd)` for events on a different
  calendar day than MAX. No mod-24 value remains in the ordering path (the old sort bug is
  gone). Labels are "Rise"/"Set". (2026-05-30)
- Rise BEFORE tMax / Set AFTER, search window ±18h. `_currentRec` cached in local.js for
  re-renders after toggles/URL restore.

### Tabs / Details
- Folder convention: active tab matches panel surface; inactive recessed (bg2). Container
  provides the divider; active overlaps it with `margin-bottom:-1px`; a tab never has its
  own bottom border. Tab/chrome contrast was deepened 2026-05-30 (tab bar `#070911`,
  active `#1a2030`, chrome strip `#040508`).
- Detail sections transparent (inherit surface). Title shows `eclipseIcon` before the date
  (no text type label). Detail-panel icon matched to list size (32px). Share button
  `margin-left:auto`.

### Map
- MapLibre globe + deck.gl overlay for paths, **both vendored locally** (see Foundation).
- **Antimeridian camera is the elegant single-path version** (see Offline globe section).
  Cap/umbra lines shifted ±360° to take the short path across ±180. Feature density by
  zoom. Mobile starts zoomed out.
- **Offline globe** fills/strokes/markers fixed (see Offline globe section). Globe
  `setFog()` makes the atmosphere opaque so WebGL far-side geometry doesn't bleed.
- **Umbra ovals blink off past zoom 7** (`updateOvalVisibility`; see Offline globe section).
- **"Force offline map" toggle** forces the local GeoJSON basemap for debugging (this tests
  the basemap path; it does NOT test the engine-is-local fix — that's a Network check).

### Share (2026-05-30)
- `share.js` rewritten clean (no blob cruft, no duplicate URL, no title field). Tabstop-
  aligned text: header, Greatest-Eclipse block (Duration/Time/Location/Magnitude), Path
  width, local circumstances if coords set, URL, credit ("ShadowChaser app by
  followtheshadow.com"). C2/C3 labels "total". About has a mailto bug-report link
  (`app@followtheshadow.com`) and an Android note.

### State management (AppState)
- `state.js` `AppState` get/set/on + window forwarding shims (legacy globals route through
  AppState; call sites unchanged). `AppState.on()` exists but is NOT wired to subscribers —
  manual re-renders still required. Module-locals `_currentRec`, `_timeMode` deliberately
  left in place (no benefit to moving without subscribers).

### CSS
- Inline `<style>` extracted to `css/app.css` (index.html ~318 lines). Anti-cascade
  principles: inherit don't re-declare; one token source (`--bg/bg2/bg3/gold/--pin-red`),
  no raw hex; no ID selectors for styling. Further module split deferred (no bundler).

---

## OUTSTANDING ITEMS — PRIORITIZED

### Closed recently (do not reopen)
- Antimeridian camera elegant single-path; **V-angle math (validated both hemispheres)**;
  offline land/border antimeridian fill fix; seam-free coastline/border strokes; far-side
  marker visual culling; offline circum-south-polar ring; offline elevation error
  (`isOffline()` guard + single-owner refactor); contact-times UT-day-boundary sort
  (verified); dead `ocean` fetch removed; **far-side marker occlusion — BOTH visual and
  click, via `isLocationOccluded` (was #R2)**; **umbra ovals blink off past zoom 7**;
  **vendored MapLibre + deck.gl locally (dropped unpkg CDN — last runtime CDN dependency)**.
  Polish: tab/chrome contrast; Rise/Set labels; corona brightness; search-instruction
  layout + canonical "Obscuration"; search-range setting; share rewrite; About mailto +
  Android note; share-link encoding (e= + coords only, no full search state).
- **(2026-06-07) Truncated north umbral limit** — fixed by width-scaled `search_m` in the
  generator (was a fixed 300 km search window). **Below-horizon oval points** — fixed by
  stopping the oval bisect at the terminator. **Repo bloat** — `data/paths` untracked +
  `.gitignore` added. See §SESSION 2026-06-07.

### Real bugs still open
- The desktop real-bug tier is **clear** of correctness defects. The remaining path flaw is
  the grazing-tip zigzag, which has a PROVEN fix pending one polyline sub-problem.
- **Umbral grazing-tip zigzag (generator).** On grazing eclipses the umbral N/S limit shows
  a gap (300–1200 km) + ~150–177° fold at one/both ends. Root cause PROVEN: the envelope
  method stops where the shadow axis leaves Earth's disk; the straight-chord extension across
  the remaining real-totality stretch is the zigzag. Fix PROVEN: trace the umbral limit as
  the cone–spheroid intersection contour (field h = max_t(|L2−ζ·tan_f2|−m)=0) — sub-km vs
  Jubier AND reaches the tips. ONE blocker: splitting the traced closed loop into clean N/S
  limit polylines on corridor eclipses (simple ones like 2033 already split clean). Full
  ledger + next idea in TODO "Umbral grazing-tip zigzag". SUPERSEDES the old "Corridor
  sampling artifacts" entry (same phenomenon, now root-caused with a validated fix).
- **Ancient/BCE centuries not yet rebuilt** — still show pre-improvement data; rebuild +
  BUILD bump clears them.
- **#R3 Polar eclipse corridor "onion-ring" (deck.gl).** 1950-09-12 corridor + ovals
  render as polar onion rings. deck.gl SolidPolygonLayer mis-triangulates polar polygons
  even with clean unwrapped data. Current workaround: corridor fill DISABLED (path lines
  only); ovals still filled. 4 candidate approaches in TODO.md. NOT trivial. (Related:
  the same triangulator issue blocks moving markers into WebGL — see far-side note.)
  User has chosen to leave this as-is for now.
- **#R4 Offline mode broken on mobile basemap.** Confirmed; needs investigation.
  Mobile-only — park until desktop is stable.
- **#R5 Pinch-zoom on iOS not blocked.** `user-scalable=no` ignored by iOS Safari. Fix:
  `touch-action: pan-y` on scrollable panels but NOT the map container (map needs pinch).
- Eclipse paths in offline mode: not confirmed working; may already resolve post-fill-fix.
  Verify.

### Bigger features needing scoping (Opus-grade)
- **#F1 Personal "ShadowChaser log"** — eclipses visited / wishlist. Schema, localStorage
  (or future sync), UI in list/details, "been there" vs "want to go", merge with selection
  state.
- **#F2 Weather / cloud-cover overlay** — the killer feature. Forecast (near-term) +
  climatology (far-future); data source, globe layer rendering, online/offline, controls,
  perf. ~2 sessions of design first.
- **#F3 Animated shadow on globe with time slider** — scrub umbra/penumbra in real time;
  most on-brand feature.
- **#F4 Topographic shadow overlay** — terrain shadows at the observer location.
- **#F5 Global-vs-local eclipse-type search semantics** — "1960+ total St. Louis": total
  globally + visible vs total AS SEEN from STL (1979 total globally, partial from STL).
  4 options in TODO.md.

### Polish queued (Sonnet-grade)
- **#R1 (reclassified from real-bug → polish) City labels fade through the globe on
  spin.** WebGL symbol labels (PBF-glyph layer), NOT DOM markers, so the
  `updateMarkerOcclusion`/`isLocationOccluded` approach does not directly apply (that's
  for DOM markers). Annoying, not functional — user chose to defer. When tackled: first
  check what MapLibre v5 offers for symbol-layer occlusion on globe (read API before
  hand-rolling), else a hemisphere-keyed paint/visibility expression, else accept it.
- Merge "Coordinates" + "City" instructions into one "Location" section (CAVEAT: parser
  doesn't handle bracketed multi-word cities yet — small code change).
- Move eclipse date to overlay in desktop mode; make map date more visible on mobile
  (mobile group).
- Dropped pin as a real 3-D-ish icon w/ shadow (emoji + SVG teardrop both FAILED earlier —
  needs a proper MapLibre symbol layer; understand why GeoJSON symbol layers were
  abandoned first). Currently a red dot.
- Banner size: distinguish web vs app mode.
- Share: server-side share page `followtheshadow.com/share?e=XXXXX` (static HTML reading
  existing JSON, formatted summary + map image) — the only way to beat the plain-text
  ceiling of `navigator.share`/`mailto`. (In-app share-link encoding — e= + coords, no full
  search state — is DONE.)

### Deferred infrastructure
- ✅ **Vendor MapLibre locally** — DONE 2026-05-31 (see Foundation section). No CDN left.
- ✅ **PWA / service worker** — DONE 2026-05-31 (see §"SERVICE WORKER / PWA — DONE" at the
  bottom). Offline shell + globe + 1900–2100 eclipse data verified offline.
- Production bundling (single JS/CSS). Offline city labels: bundle Noto Sans PBF glyphs
  (~2–3MB) — MapLibre symbol layers need PBF glyphs; system fonts unavailable to WebGL, so
  offline is dots-only today. Pass C subscription wiring (only when a feature demands it).
  CSS module split (only after a build step). `map.js` single-file size (low priority).

---

## RECURRING ANTI-PATTERNS (for the future assistant)

1. **"You waste my money."** Reflexive over-engineering on simple tasks (the textarea-
   autogrow saga, resolved by one line of CSS). Platform-native first.
2. **"Why undo what I asked explicitly?"** Don't retreat from the user's stated direction
   when complications arise — address the complication, don't pivot.
3. **"You are gaslighting me."** No false "fixed" claims. If you can't verify, say so.
4. **Don't suggest "let's call it for today."** The user decides when done.
5. **"Patchy patchy I don't like it."** Replace whole, don't patch. Three guards on a path
   = wrong structure. (This session's `isOffline()` refactor is the positive example: one
   owner, no spread checks, no `typeof` crutches.)
6. **"You keep over-complicating."** Boring obvious version first.
7. **"At what point do we do structural work?"** Clean throughout, but refactor only when
   it earns its keep (Pass C subscription wiring: mechanism exists, don't wire pre-emptively).
8. **"Is this all OCD-tidy/elegant?"** Honest audit, both sides, never reflexive yes.

---

## TECHNICAL CAVEATS / GOTCHAS

- **`eclipse_type` field:** first letter uppercase, drives icon selection. Magnitudes:
  totals ~1.00–1.08, annulars ~0.85–0.99, partials 0–1.
- **`rec.t0` is TDT decimal hours**, not UT. `UT = t0 + t − dT/3600`; dT in seconds.
- **V-angle:** `V = 180 − P − q`, `+180` for interior contacts C2/C3 only; q is Meeus 14.1;
  P=`atan2(u,v)`; result is degrees clockwise from zenith. See full section above.
- **Offline basemap data pipeline:** regenerate antimeridian-broken layers with Python
  `antimeridian.fix_geojson`; verify 0 edges with |Δlon|>180. Fix the DATA, never patch the
  renderer.
- **`isOffline()`** (map.js) is the single connectivity owner — route any new network-
  gated feature through it, don't re-derive offline state inline.
- **Strict-mode files** (tz_lookup, search_parser, eclipse) are pure modules; no accidental
  globals.
- **MapLibre globe ≠ Mercator.** Antimeridian/polar bugs differ. GeoJSON symbol layers were
  abandoned (geojson-vt antimeridian/polar issues); deck.gl SolidPolygonLayer has its own
  polar triangulator bug (#R3).
- **`field-sizing: content`** powers the search textarea autogrow (Chrome/Edge/recent
  Safari; graceful single-row fallback).
- **localStorage keys:** `sc.timeMode`, plus the search-range setting. More to come.
- **`window.matchMedia('(min-width: 900px)')`** chooses initial map zoom (desktop vs mobile).
- **Vendored libs live in `vendor/`** (maplibre, deck), version in filename, NO `?v=BUILD`.
  Your own files keep `?v=BUILD`. Vendor CSS never goes in `css/`. MapLibre worker is an
  inline Blob → `blob:` URL (matters for CSP under the service worker).
- **deck.gl accessors don't react to zoom** without a `setProps`/`updateTrigger` driven by
  a zoom listener — accessors are cached as GPU attributes (deck.gl 9.3.3). See the umbra-
  oval blink-off for the pattern.

---

## OPEN STYLE/UX QUESTIONS (in TODO.md "OPEN UX QUESTIONS")

1. Map brightness — slider was removed; revisit only if needed.
2. Global Circumstances panel density (tall).
3. Canonical term decisions already partly resolved ("Obscuration" canonical; "Location"
   rename for the coords/city merge still pending).
4. Merge Coordinates + City into "Location".
5. Global-vs-local eclipse-type semantics (#F5).

---

## DEPLOY CHECKLIST (every change)
Replace files → **bump `BUILD` in index.html** (all three places: the `<meta name="build">`,
every `?v=` on js/css, and `var BUILD`) → hard-refresh → verify on server (`chmod 755`
dirs / `644` files if you get 403s) → on a real device, sanity-check that the local globe
shows and a map click doesn't error. Vendored files in `vendor/` don't take `?v=BUILD`.

**With the service worker, "hard refresh" is not enough to load new code** — the old
worker serves the cached shell. To force a new worker during dev: DevTools → Application →
Service Workers → tick *Update on reload*, or just test in a fresh **Incognito** window
(zero prior SW state — the reliable clean room). A normal-profile worker that's wedged
clears via `brave://serviceworker-internals` → Unregister, or a browser restart. On a real
BUILD bump in production this is automatic (`updateViaCache:'none'` + cache-name keyed to
BUILD; `activate` deletes the old cache).

**Commit (from repo root):**
```bash
git rm vendor/maplibre-gl-5.5.0.js            # the dead hand-rolled file
git add index.html sw.js manifest.webmanifest js/map.js \
        vendor/maplibre-gl-csp-5.5.0.js vendor/maplibre-gl-csp-worker-5.5.0.js \
        icons/icon-192.png icons/icon-512.png HANDOFF.md TODO.md
git commit -m "Service worker + PWA: offline shell, globe & 1900–2100 eclipse data; CSP MapLibre build; isOffline probe fix; network-first nav"
git push
```
(`favicon.ico` already tracked. After pushing/publishing, on the SERVER chmod any NEW
folders to 755 — see the permissions lesson below — or the phone gets 403s.)

---

## ▶ SERVICE WORKER / PWA — DONE (2026-05-31)

**What it does:** a true offline (no-signal) reload now loads the app from Cache Storage
instead of the browser's offline dinosaur. Verified offline (DevTools → Offline, Incognito):
globe renders, present-day eclipse draws, map-click gives local circumstances, per-century
scan works — no crashes.

**Files:** `sw.js` (repo root), `manifest.webmanifest` (root), `icons/icon-192.png` +
`icons/icon-512.png` (provisional total-eclipse glyph — replace with final art later),
registration + `<link rel="manifest">` + `theme-color` in `index.html`. **MapLibre is the
official CSP build** — `vendor/maplibre-gl-csp-5.5.0.js` + `vendor/maplibre-gl-csp-worker-5.5.0.js`,
wired with `maplibregl.setWorkerUrl('vendor/maplibre-gl-csp-worker-5.5.0.js')` in index.html.
(The earlier hand-rolled `vendor/maplibre-gl-5.5.0.js` is DELETED — its custom blob-worker
wrapper was fragile. The CSP build loads the worker from a real file. Both verified on
desktop + iOS.) BUILD is currently `2026-05-31c`.

**How `sw.js` works (the design, kept deliberately simple):**
- **One version source.** `VERSION` is read from the registration URL (`sw.js?v=BUILD`), so
  `BUILD` in index.html stays the *only* version number. Cache name = `shadowchaser-<BUILD>`;
  `activate` deletes every other cache. No second number to bump.
- **`ignoreSearch` on all cache lookups.** The cache name already pins the build, so precache
  URLs are query-free and a request for `foo.js?v=BUILD` matches cached `foo.js`. This killed
  a long-running bug where `?v=` mismatches between precache and page requests caused phantom
  cache misses (the "blue marble, no land" symptom).
- **`updateViaCache:'none'`** on the registration so the browser always fetches `sw.js`
  fresh — without it, stale HTTP-cached worker code wouldn't update.
- **Navigations are network-first, time-bounded.** Online → fresh index.html (so a new deploy
  is picked up immediately and registers the new worker — NO manual clear needed anymore). If
  the device reports offline, serve the cached shell instantly; otherwise race the fetch
  against a 2.5s timer and fall back to cache. (Cache-FIRST navigation was the original cause
  of "the old worker won't update" AND a no-timeout network-first froze the page when iOS left
  an offline fetch hanging — this handles both.)
- **CORE (atomic `addAll`):** index.html, favicon, css, all js, vendor (CSP build + worker),
  the 6 *used* fonts, basemap `*.gz`, and `data/index.json`. If any fail, install fails.
- **DATA (best-effort loop):** ALL 50 besselian centuries (~9.5MB, cheap — makes scan +
  local circumstances work offline for any era) + paths for **1900–2100 only**
  (`paths_1901_2000`, `paths_2001_2100`; paths are ~6MB/century, ~274MB for the full set).
  A flaky file here can't wipe the shell; anything outside the range is cached on demand
  when viewed online. (User's decision: this + last century, for birthdays etc.)
- **Fetch (non-nav):** non-GET and all cross-origin (raster tiles, `generate_204` probe,
  elevation API) pass straight through, untouched. Same-origin GETs are cache-first
  (ignoreSearch) then cache-on-demand; offline misses return a quiet 504 instead of throwing.

**The one expected console line offline:** a single `generate_204` ERR at startup — that
IS the connectivity detector doing its job (an unfailing probe can't detect failure). It
fires once. Per-click elevation errors were a separate bug, fixed via `isOffline()` (see
§Connectivity), now probe-backed.

**Blob-worker/CSP:** no CSP was added. If one is ever added, the CSP build still spawns a
worker — allow `worker-src 'self'` and the worker script URL.

**THE PERMISSIONS LESSON (this cost the most time — read it):** the iOS "black map" was NOT
an iOS or MapLibre bug. It was **production file permissions.** Nova uploaded the freshly-
created `vendor/` and `data/basemap/` folders without world-execute, so the web server
returned **403** for everything inside them (basemap `.gz` 403, the MapLibre script 403 →
`maplibregl is undefined` → black map). Tell-tale: it works on localhost (no perms) but
fails on the server; 403 (not 404) on assets. **Fix: chmod 755 on new directories, 644 on
files.** You only hit this when a deploy creates a NEW folder — file updates into existing
correct folders are fine. (If Nova's publish settings expose default permissions, set
dirs 755 / files 644 there to kill it permanently.)

**The worker-update lesson:** most of the session's pain was the old worker persisting. With
network-first navigation that's now self-healing online. But if a worker is ever truly
wedged: fresh Incognito (desktop) is the clean room; on iOS, Settings → Safari → Advanced →
Website Data → delete the site. Deleting a cache by hand does NOT re-trigger `install`.

**Diagnosing on iOS (no built-in console):** drop `<script src="https://cdn.jsdelivr.net/npm/eruda"></script><script>eruda.init()</script>`
into `<head>` temporarily — gives an on-screen console/Network panel on the phone. Remove
after. (eruda's Network tab shows fetch/XHR only, not `<script>`/SW script tags.)

---

## AFTER — the frontier
With the offline foundation complete, the next frontier is **feature scoping (Opus-grade):
#F1 personal log, #F2 weather/cloud-cover overlay, #F3 animated shadow.** #F2 is the killer
feature but ~2 sessions of design before code. These involve UX and data-source decisions
that are explicitly the USER's to make — confirm direction before building. Mobile bugs
(#R4 offline basemap, #R5 pinch-zoom) are parked until after; #R5 is a contained CSS fix
whenever wanted.

**User's big-picture goal:** "readable, comprehensible, not over-engineered, elegant,
tidy, and genius" — and the app must work fully offline in the field.
