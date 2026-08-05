# ShadowChaser — TODO (the single task list)

## What this file is — and how it relates to the handoff
**Two documents, one job each. They must not duplicate.**
- **`HANDOFF.md`** owns *knowledge & current status*: what changed this session, what is
  deployed, how things work now, the hard-won derivations and lessons, what's closed. It is
  the source of truth for whether something is done and for HOW things work.
- **`TODO.md`** (this file) owns *everything still to do*, with its detail inline: open bugs
  and their candidate fixes, UX questions and deliberations, the feature pool, perf/data
  notes, the refactor ledger — ordered by priority. It accretes and is pruned, not rewritten.

**Rules to keep them from drifting:**
1. When an item here is done, **delete it** — HANDOFF records the closure. No "DONE" tombstones.
2. Don't restate narrative status here; keep the task + its detail. HANDOFF holds the story.
3. One coherent change at a time; bump BUILD on every deploy AND every path rebuild.

Last touched: 2026-08-05 — **user log (#F1) SHIPPED** (`js/userlog.js`, HANDOFF §14.1) and the
**visual language DECIDED and enforced** (HANDOFF §14.2, `test_hygiene.js` §7). Also: basemap
picker collapses on phones and animates open; Topo-at-high-zoom blank fixed (§14.3); search
hint strip and separate coordinate line removed, the location pill now carries the
coordinates; `parseCoords` self-heals a stale filter cache (§14.6); four headless test suites
in `tools/checks/` (§14.4), including DOM-contract and BUILD-stamp checks added after a real
cache-skew failure. BUILD is now `2026-08-05d`.

Prior: 2026-08-04 — **full-catalog audit RUN AND PASSED** (`data build tools/
audit_paths.py`, read-only over the built chunks): 11,898 eclipses, 7,851 central, **zero**
stub or missing limbs on two-limit eclipses, zero gross N/S asymmetry, all 50 chunks on
generator `2026-07-13j`. Only two hits, both `A+` and both won't-fix (see BUGS). The pre-ship
gate is closed.

Prior: 2026-07-29 — basemap/connectivity rewrite (one raster style, live
online/offline swap, on-map basemap picker) + non-central eclipse durations shipped
(full detail HANDOFF §13). Pin cluster (#P1: draw order, zoom drift, tip anchor, commit
f25ff90/HANDOFF §13.6) and paths-through-the-planet (#P2) both resolved — the whole
deck.gl draw-order/occlusion batch from the 2026-07-28 shadow work is now closed.

Prior note (2026-07-11): Cesium migration landed and mobile offline works; map.js
consolidated to one `PROFILE`. (Superseded — the app reverted to MapLibre; see
HANDOFF §2. Kept for history.)

---

## PRIORITY ORDER (suggested re-entry)
*(The map is stable and cosmetically finished as of 2026-07-13/14. Offline works. Terrain
shadows are DONE and wired in (HANDOFF §4). Priorities are the USER's to set — this is a
suggestion.)*
1. **#F1a t-shirt / multi-eclipse map module** — the log shipped, so this is unblocked and
   is the next build. See FEATURES — HARD.
2. **Settings → Info.** Almost nothing in that tab is a setting: the timezone control is
   redundant (the contacts-table header already toggles time mode inline) and the shadow
   slider belongs with the overlay it drives, not in a settings list. Rename, drop the
   timezone row, rehome the slider.
3. **Overlay sheet pattern.** Three overlays are coming; the iOS sheet paradigm applied on
   desktop too. The share modal is already that pattern — reuse it rather than growing three
   bespoke control clusters competing with the basemap picker for the top strip. Do this
   ONCE, before the overlays land.
4. **Search temporal tokens** — needs a design decision before any code (low priority; not
   currently bothering the user).
5. Remaining open bugs → UX deliberations → Features.

---

## MAP COSMETICS — mostly DONE (2026-07-12/13). What remains:
- **Limb not perfectly round** — the globe silhouette shows slight facets at grazing angle
  (ellipsoid tessellation). Only improvable with finer globe geometry (lower
  `maximumScreenSpaceError`) at a memory cost. Low priority; decide if worth it.
- **Raster sharpness ceiling.** NE2 is now `ne2_mercator.jpg`, 4096x4096 (Web Mercator, not the
  old 4096x2048 equirect — see HANDOFF §13.2), so it's sharper than before but still soft at
  close-in views. 8192x8192 would be a large GPU-texture jump on the platform we fought an OOM
  on, so DO NOT just swap the image. The right answer is a **tile pyramid** (only visible tiles
  resident). Revisit only if the softness actually bothers you in the field.
- **Thunderforest Landscape basemap** — needs an **API key**, which for a static PWA must sit in
  client-side code where anyone can read it. Same for Stadia/Stamen and Mapbox. Decide whether
  that's acceptable. Free/no-key providers already ship in the Settings picker (Esri x5,
  OpenTopoMap, OSM). Menu: https://leaflet-extras.github.io/leaflet-providers/preview/
- **Preload the three About-link eclipses.** Their chunks load on demand, so the 10th-century
  Ouagadougou link makes you wait. Preloading whole centuries is overkill; the right fix is to
  generate three small per-eclipse extract files at build time and special-case their load.
  A build-step change, not a code tweak — do it deliberately.
- **A second "travel this way" arrow?** The sun arrow points at the SUN's azimuth at maximum
  (from the pinned location). A field user might also want the direction to the CENTRELINE —
  i.e. the shortest hop to gain totality. Different quantity, roughly perpendicular; would need
  to be visually distinct so the two are never confused. Deliberate before building.

### Shipped this session (do not re-open)
Sun arrow (red, filled dart, per-frame constant screen size, base locked to the pin) · push-pin
observer marker with contact dot · orange GE diamond with distance scaling · flat city dots (no
outline rings) · dark warm-charcoal borders that fade with zoom-out · 50m borders on BOTH
platforms (Andorra has borders again) · umbra ovals fade instead of blinking · city labels drawn
whole + per-city EllipsoidalOccluder horizon test (no more half-eaten "TY", no hemisphere blink) ·
hamburger Details icon (SVG, gold) · tab order Search/Map/Details/Settings on both layouts ·
settings sub-tab order + scroll-to-top + app-standard text size · online basemap picker (7
providers, live swap) · polar hole filler (sub-tile imagery layer, colour SAMPLED from each
provider's own z=0 tile) · load crawlbar · Details-tab throb on new location · date label to the
corner · About-text deep links (select + recentre) · placename kept beside coords · clear-location
actually clears · landscape space reclaim · mobile install note · banner slimmed.

---

## OPEN — UI / COPY

- **Where do map options belong? — MOSTLY DECIDED, shipped 2026-07-29.** On-map controls now
  exist: basemap picker top-right (Street/Topo/Sat), shadow/cloud toggles top-left (HANDOFF
  §13.3). Desktop Map sub-tab still holds only the force-offline toggle — decide if that's worth
  folding into the on-map strip too, or leave it.

- **Should HYBRID eclipses match a search for "total"?** They ARE total along part of their path
  (569 of 11,898). Arguments: a chaser searching "total" near a location would want a hybrid that
  is total *there*; against: it muddies a precise term, and hybrids are already their own type.
  Middle path: include hybrids in "total" results but label them clearly as hybrid, OR make
  totality-at-the-chosen-location the criterion when a location is set. **Needs a decision, not a
  guess — it changes what the app claims.**

- **Search temporal tokens — open-ended *backward* ranges are useless (the "1999-" / "now-"
  problem). NEEDS A DESIGN DECISION — do not code yet. Low priority.** Today a trailing-dash range
  like `1999-` lists ascending from the catalog's START (year ~1 or earlier), so the user drowns
  in ancient eclipses and never reaches 1999. **Constraint from Guy: the list must ALWAYS read the
  same direction — no query-dependent sort flipping.** So the fix is NOT "sort descending for
  backward ranges." Open options to weigh (consult before implementing):
    (a) Auto-scroll/jump the list to the anchor year so the relevant region is on screen, while
        keeping the global ascending order intact.
    (b) Default the open end to a bounded window (e.g. `1999-` = the N years before 1999) instead
        of all-of-history.
    (c) Drop/disallow the bare trailing-dash form and steer users to explicit ranges
        (`1950-1999`).
    (d) Keep ascending but show a result count / "showing first N of M" + a way to page toward
        the anchor.
  Decide the model first, then align the example text. The underlying asymmetry Guy noticed
  (`today+` exists; `now-` semantics are murky) gets resolved by whichever model wins.

---

## VERIFY (logic — handle with care; not pure copy)
- **Offline timezone for odd zones (Gander −3:30, Nepal +5:45).** Timezones resolve offline
  via the **tz-lookup** polygon DB, which DOES return the correct IANA zone (`America/St_Johns`,
  `Asia/Kathmandu`). The open question is whether details.js applies the half/quarter-hour
  offset (and historical/future DST for the eclipse date) correctly. Verify with a Gander and
  a Kathmandu test case across a couple of eras before declaring it handled.

---

---

---

## 🧭 STANDING RULE — USE THE RENDERER'S API BEFORE HAND-ROLLING
*(Active renderer is **MapLibre + deck.gl** (`js/map.js`). The dormant `cesium` branch is
parity-only — see PARITY.md. The canonical, renderer-neutral statement of this rule lives in
HANDOFF §5; this is the task-side reminder + the outstanding tech debt.)*

**Rule: before writing per-frame code or geometry tricks to fake a visual effect, name the
API (MapLibre / deck.gl on the live app; Cesium on that branch) that should do it. If you can't
name one, say so out loud rather than hacking silently.** Most churn in this project came from
treating the renderer as a dumb surface to outsmart rather than an engine with a considered API.

**Corollary — beware "safety rails" (renderer-agnostic).** Constants added as harmless guards
have twice become the DOMINANT term: a 2 km arrow floor (at street zoom the whole view is ~2 km,
so the arrow filled the screen); a 16 px screen floor applied AFTER a 300 km ground cap (at globe
zoom the floor exceeded the cap, so `Math.max` threw the cap away and the arrow spanned Africa).
If two limits can fight, write down which must win — and check the arithmetic at BOTH extremes.

### Hand-rolled tech debt on the **cesium branch** (dormant — does NOT apply to the live MapLibre app)
Recorded so it isn't lost if that branch is ever revived. These name Cesium primitives with no
MapLibre equivalent; do not port them to `map.js`.
- **Border fade with zoom** — pokes `material.uniforms.color.alpha` every frame; Cesium
  primitives support distance-based appearance natively.
- **Arrow geometry rebuild** — surface geometry recomputed per frame via `CallbackProperty`; a
  `Billboard` with `scaleByDistance` would be GPU-side and free, IF the limb/occlusion problem is
  solved by the engine rather than by hand.

*(The live MapLibre renderer has its own equivalents — e.g. globe occlusion via
`map.transform.isLocationOccluded`, see HANDOFF §8.4. The whole globe-occlusion family — #P2
(paths through the planet) and #R1 (city labels) — is now closed.)*

---

## ⛔ DO NOT DO (verified traps — recorded so they aren't re-attempted)
*(Some traps below name **Cesium** primitives — `CLAMP_TO_GROUND`, `depthFailMaterial`,
order-independent translucency. Those apply to the dormant `cesium` branch only; the live
MapLibre+deck.gl app can't hit them; the equivalent occlusion/depth question (#P2) is now fixed.
The data-key and safety-rail traps are renderer-agnostic.)*
- **Do NOT rename the `ep.centreline` DATA KEY → `centerline`.** Internal JSON key emitted by
  the generator and read by `map.js` (plus the layer id) — distinct from the visible label.
  Renaming requires changing generator output, regenerating EVERY path file, and changing the
  reader in lockstep: a breaking refactor for zero user-visible payoff.
- **Do NOT re-add clamp-to-ground on iOS.** `heightReference: CLAMP_TO_GROUND` and
  `clampToGround: true` (the *classification* kind) crash iOS Safari on the offline transition
  (`f.globe` render error) and gap polylines at certain zooms. Confirmed isolated: desktop runs
  the fill primitive fine, so the fill was never the crasher — clamp was. Occlusion/limb
  problems must be solved another way (basemap-as-globe-surface, or depth-tested surface
  geometry). NOTE the distinction: plain height-0 geometry we DO use — `clampToGround: false`
  polylines (arrow, paths) and depth-tested billboards/points (markers, dots) — is fine; only
  the classification clamp is banned.
- **Do NOT lift the eclipse paths off the ground.** They are drawn at EXACTLY height 0. Any lift
  parallaxes them across the surface by `height × tan(view angle)`: a 2.5 km lift (tried) displaces
  the path by **4.3 km** at 60°; even a 50 m lift is 29 m at 30° — meaningless noise on a centreline
  computed to ~15 m. **This corrupts the measurement the app exists to make.** If something occludes
  a path, use `depthFailMaterial` (already in place), which costs zero geometric offset.
- **Do NOT re-add a screen-size FLOOR to the sun arrow.** A `Math.max(L, MIN_PX × mpp)` applied
  after the ground CAP is LARGER than the cap at globe zoom, so it throws the cap away and the
  arrow spans a continent. The CAP must be the last word. (Likewise a 2 km absolute floor became
  the dominant term at street zoom, where the whole view is ~2 km, and the arrow filled the
  screen.) **Beware any constant added as a "safety rail": check the arithmetic at BOTH extremes.**
- **Don't bother disabling order-independent translucency on mobile.** We tried it chasing the
  backgrounding crash; it did NOT help (the framebuffer cuts — skybox/atmosphere/FXAA/MSAA off
  — did). No evidence it broke anything either — it's simply pointless. Left at default.

---

## BUGS — open (detail; status in handoff)
- **Two eclipses with a missing umbral sliver — WON'T FIX for now; documented so it isn't
  rediscovered.** `332-03-13` (cat 5554) and `2485-12-07` (cat 10668), both type `A+`, are the
  only two central eclipses in all 11,898 that produce NO umbral limb at all. Verified against
  Jubier's KMZs: he draws a single tiny annular edge for each — **50.8 km / 14 pts** (332) and
  **117.4 km / 37 pts** (2485), plus one terminus point tacked on either end (164 km and 222 km
  end-to-end). His "Northern Umbra Limit" and "Southern Limit" are the *same curve reversed*,
  point-for-point — consistent with `A+` meaning one edge only. Everything else on both records
  is correct (penumbra, green curve, terminators).
  **Rarity:** these are the two smallest umbral footprints in the catalog. A normal `A+` peer
  traces 100–240 points, and both 332 (γ 1.00358) and 2485 (γ 1.02422) sit inside the peer γ
  range, so it is NOT a marginality cutoff — 332 is a milder non-central than peers at γ 1.02
  that trace fine.
  **If it ever needs fixing:** the one-limit branch in `build_path` samples `tmin..tmax` at
  **1201 fixed steps** and requires `len(_tn) >= 2` before it will walk a limb. On an arc this
  short the annular phase may fall between samples, so the walk never starts. **Untested
  hypothesis — instrument `umbra_pair` over both records' t-ranges to confirm before coding.**
  If confirmed, the fix is a scale-aware resample of that interval, the same principle as the
  existing narrow-band densification (`NARROW_KM`) — not a new mechanism. Do NOT widen the
  1201-step sampling globally; that costs every eclipse to serve two.
  **Regression test if attempted:** the other 33 `A+` records must be byte-identical after.
- **Penumbra threshold offset (low priority — user accepts "close").** Our penumbra limit
  sits ~7–10 km INSIDE Jubier's, asymmetric N/S. NOT a single term (dropping the cone-narrowing
  term fixes north, worsens south) — suggests a direction-dependent (refraction/limb) term. The
  implicit-contour penumbra prototype reaches ~9 km. Pursue only if chasing sub-km everywhere;
  otherwise "naturally fuzzy" is fine. Eventually migrate penumbra onto the implicit engine as
  {max magnitude = 0}.
- **#R5 iOS pinch-zoom not blocked.** `user-scalable=no` is deliberately ignored by iOS Safari.
  Real fix: `touch-action: pan-y` on the scrollable panels (allows scroll, blocks pinch) while
  LEAVING the map container alone (the map needs pinch to zoom). Must test on a real iPhone.
- **Safari geolocation fails; installed PWA works.** Check secure-context / permissions / Brave
  default block vs the code path.
- **Slow first load from local-disk server** — minutes vs seconds. *(Partly explained: every asset
  downloads TWICE on a build change — see PERFORMANCE / DATA. That is pre-existing and mostly
  served from disk cache in production (~11 s load, DOMContentLoaded ~950 ms), so profile the
  LOCAL-server case specifically before assuming it's the same cause.)* Profile the chunk-fetch
  pattern.
- **Scan ignores non-location filters** — always scans all 5 centuries regardless of other
  *(This is the REAL scan win. Measured alternative — splitting partials into separate files —
  saves only ~1% of payload and was rejected. Filtering by date/type BEFORE loading chunks would
  cut far more, cost nothing in user confusion, and needs no data restructuring. First scan after a
  map click walks ~30 chunks; subsequent scans are in-memory and free.)*
  Original note:
  active filters. Pre-existing; harmless offline (SW precaches all besselian centuries) but
  inefficient.

---

---

## FEATURES — EASY
- Thumbnail path map per list row (small SVG) — MOBILE ONLY (not desktop).
- Century scroller on the mobile right edge.
- KMZ download.

## FEATURES — MEDIUM
- **Compass built into the sky tracker.** Guy has ideas for how it should function and look —
  discuss the design before coding.
- Server-side share page (`followtheshadow.com/share?e=XXXXX`) — static HTML reading the
  existing JSON, rendering a formatted summary + map image. The only way past the plain-text
  ceiling of `navigator.share`/`mailto`. Also the home for "prettier share" visual polish.
- Splash / title page for installed-PWA mode; app icon; app logo / eclipse symbol.
- Night-sky-during-totality view — planets/comets/bright stars near the Sun at totality,
  positioned for the selected eclipse.

## FEATURES — HARD
- **Greatest duration for ALL eclipses (not just the 94).** ⇒ **Handoff exists:
  `docs/GREATEST-DURATION.md` — read it first, don't re-derive any of this.**
  Greatest eclipse ≠ greatest duration: GE is where the axis passes closest to the Earth's
  *centre*; longest totality is elsewhere. Espenak's `duration_secs` is the duration at GE,
  not the maximum. Measured on 25 modern eclipses: median +0.07 s (negligible) but max
  +49.8 s and up to 10,686 km away (2002-06: GE 22.8 s → 72.6 s). So "where and when is this
  eclipse at its longest" is a real, unanswered question, and not one click away on Jubier.
  DONE already: the 94 eclipses with *no central line* (`tools/noncentral_durations.py`,
  surfaced by `details.js:maxDurationRows()`). This item is the general case.
  The hard part is NOT the astronomy — `totality_seconds()` already gives duration at a
  point, validated to 40 ms against Espenak on observed-ΔT eclipses. The hard part is a
  trustworthy *global search*: the duration surface is a long curved ridge along the central
  line, and the hill climb used for the 94 can stall on it or wander. Handoff §5 proposes
  parametrising by time along the central line (1-D scan) instead of searching lat/lon (2-D).
  Also decide storage: 3 fields × 11,900 records ≈ 400 KB on an index.json that already
  loads at startup — may belong in the Besselian chunks instead. Budget hours, make it
  resumable, and spot-check 2017-08-21 / 2024-04-08 against published values first.
- **Path unification — all curves on one implicit-field engine (architectural vision).** Every
  path = the zero level set of a scalar field evaluated at each ground point's own moment of
  greatest eclipse, traced by one shared predictor–corrector:
    green     = {sun altitude at max = 0}        (DONE — sub-km)
    umbra     = {ever-total depth = 0}           (current: perpendicular_limits + analytic dispatch)
    penumbra  = {max magnitude = 0}              (prototype ~9 km)
    mag isolines = {max magnitude = c}           (enables Jubier's 0.2/0.4/0.6/0.8 curves free)
    centreline = ridge of the depth field        (max-finder, not a zero — mild extra work)
    terminator/sunrise-set = intersection of two conditions
  One engine parameterized by field + level (+ intersection mode) replaces the current
  hodgepodge. PHASED: migrate one curve at a time, validate, swap in only when it beats the
  incumbent everywhere. Suggested two-branch discipline: freeze the shipped generator
  (bugfix-only) as stable truth; develop the unified engine as experimental successor.
  ~4–6 phased sessions. Next phase: penumbra onto the engine.
- **#F2 Cloud-cover / weather overlay** — the killer feature. **TWO data paths, one overlay,
  with the handover driven by days-to-eclipse.** Climatology (median cloud fraction for that
  date and place) is the base layer and the only thing available months or years out — it is
  what makes a site *choosable* in advance. **But inside about a week of an eclipse, switch to
  live forecast data if a freely available source exists** — no key, no quota, cacheable for
  offline. That week is when a chaser actually commits to travel, and climatology is worthless
  at that range; a 40%-cloudy-in-August average tells you nothing about next Tuesday.
  Still needs data-source choice (the whole feature turns on what can be fetched for free),
  globe-layer rendering, online/offline behaviour, controls, perf. ~2 sessions of design
  before code.
- **#F3 Animated shadow on globe with time slider** — scrub the umbra/penumbra across the map in
  real time. Most on-brand feature. Distinct from the terrain-shadow scrubber that shipped:
  that scrubs *terrain* shadows at one place; #F3 animates the *umbra/penumbra footprint*
  sweeping the Earth. The terrain-shadow scrubber (`shadow-ui.js` `setShadowTime` owner) is a
  clean precedent for the time-plumbing.
- **#F1a T-shirt / multi-eclipse map module — NEXT, and now unblocked.** The log shipped
  (HANDOFF §14.1), so `scLogRows()` exists and the selection source is real. Port
  `tshirt/umbral_paths.html` into `js/` as a module.
  **It is a smaller job than tshirt/HANDOFF_umbral_map.md implies** — that doc describes the
  ORIGINAL Python/shapely build. The tool already has a working runtime JS path: `fetchAll()`
  pulls the `.json.gz` chunks, `DecompressionStream` unzips, `buildBands()` builds the rings,
  and **`splitEdge()` already handles the antimeridian** by normalising into ±180 and cutting
  where the jump exceeds 180°. No clipping library, no shapely, nothing to vendor.
  What actually changes:
  - **Data source.** Swap `fetchAll()`'s two hardcoded raw.githubusercontent URLs for the
    app's `loadChunk()`. This is the change that matters: as written it is network-only and
    hits GitHub, which breaks the offline promise. Reading the precached chunks also drops the
    decompress step entirely.
  - **Selection.** Replace the year-range filter with the saved log. Selection checkboxes go
    in the column left of the type icon in each log row — **that column is already reserved
    and commented for exactly this** (`app.css` `.log-row`, and the render function).
  - **Locations.** New, and small: project each entry's `[lon, lat]` through the same
    `project()` the bands use, draw a dot. Only entries that have a `loc`.
  - **Export.** Already there, unchanged.
  Two pre-existing quirks worth knowing before porting, both in the current tool:
  - `buildBands` pairs `nSegs[i]` with `sSegs[i]` by index under `Math.min`. If a band's north
    and south edges split into different segment counts at the antimeridian, pieces are
    silently dropped — a wrong-map-no-error failure.
  - The filter requires BOTH `umbra_n` and `umbra_s`, so every one-limit eclipse (`A+`, `Tn`,
    `As`… ~187 of them) is excluded outright. Fine for a t-shirt, but it is a choice rather
    than an accident.

---

## PERFORMANCE / DATA
- **Splitting partial eclipses into separate on-request files: MEASURED, NOT WORTH IT.**
  Partials are 4,200 of 11,898 (35.3%) — but only ~3.5 MB of the 10.1 MB besselian cache, and they
  have NO central path, so they add ~nothing to the 274 MB of path data that dominates storage.
  Net saving ≈ 1% of total payload, in exchange for a new loading mode, a UI affordance, and
  "why can't I find my eclipse?" confusion (partials are exactly what a birthday/location search
  expects to return). The real scan win is the item below — filter BEFORE loading chunks.
- **Every asset downloads TWICE on a build change (real, measured, PRE-EXISTING).** The page
  requests `js/map.js?v=BUILD`; `sw.js`'s precache lists say `js/map.js`. Different URLs → two
  network fetches, for scripts, basemap layers, and every besselian/path chunk. Confirmed in the
  network panel (~317 requests, 22 MB). It has ALWAYS been there — it was present throughout the
  successful offline milestone — so it is wasteful, not breaking.
  **Two failed attempts (do not repeat):** (a) deferring the DATA precache to a post-load "warm"
  pass — fixed nothing for the shell/scripts; (b) a single-flight `fetchOnce()` in the SW keyed on
  the tag-free URL — CANNOT work, because on a build change the page is controlled by the OLD
  service worker while the NEW one installs and precaches in a separate scope: the two never share
  an in-flight map.
  **The actual fix (for a dedicated session):** stop precaching anything the PAGE fetches for
  itself. The fetch handler already caches on demand, so the shell scripts/CSS don't need to be in
  the install list at all; precache only what the page never requests (the MapLibre CSP **worker**
  + vendor assets, out-of-range besselian/paths). Then measure the network panel again. Do this
  calmly, on a
  branch, with an offline test after — `sw.js` is the most fragile file in the project.
- **Path JSON size — curve thinning (RDP).** Full-loop traces + pole tips added points. Reduce
  size WITHOUT losing accuracy via Douglas–Peucker decimation per curve at ~200–500 m (far
  below visible-at-max-zoom). Apply to centreline + umbra limits; penumbra + terminators are
  candidates. Expected 30–60% smaller, zero visible change. Verify post-thin curves stay within
  tolerance (re-check tip cusps). Secondary: delta-encode coords before gzip.
- Path thumbnails for list rows — feasibility/size for 5 centuries of tiny scaled flat-map
  paths.
- Drop or make-optional pre-1000 CE eclipses — cost/benefit on load/data shed.
- **Trim unused Cormorant Garamond weights** — re-check against the current (first-person)
  About text before trimming.

---

## INFRA (durable; keystones of the offline goal)
- **Git-LFS vs GitHub-release bundle** for the large path-chunk files — decide before
  open-sourcing.
- **Open-source prep** — licensing/attribution for the **live stack**: MapLibre GL JS (BSD-3),
  deck.gl (MIT), Natural Earth (public domain), NASA Blue Marble, eclipse data (Espenak/Meeus),
  Terrarium DEM tiles (the shadow engine's source). (The dormant `cesium` branch additionally
  carries Cesium, Apache-2.0 — only relevant if that branch is ever shipped.)
- **Production bundling** (single JS/CSS) — optimization, not a blocker (SW precaches
  individual files fine).
- **"Download everything for the field" toggle** — a Settings option (while online) to precache
  the *full* paths set (~274 MB) so any eclipse, any era draws offline. Today the SW caches the
  1900–2100 range + all besselian; out-of-range eclipses draw offline only if viewed online
  first. Needs progress UI, quota handling, partial-failure recovery, clear-cache control.
  Build only if a real user asks.

---

## REFACTOR LEDGER
- **Pass A** ✓ — split inline script into `js/` modules.
- **Pass B** ✓ — event-driven AppState.
- **Always-selected eclipse** ✓ — removed deselect UI and most null branches.
- **map.js platform consolidation** ✓ (2026-07-11) — scattered `isWide()` branches collapsed
  into one declarative `PROFILE` (render + data settings, decided once). Two layout-only
  media queries left live intentionally.
- **Pass C** — deferred. Tackle when a feature/bug motivates it:
  - Init-time preconditions patchy: three "init-time only" early-returns exist because events
    fire before `selectNextEclipse` completes. Fix: wire selection before subscribers, or
    buffer events until init completes.
  - Search input still DOM-driven (not on AppState).
  - `map.js` still large/single-file (split deferred until a bug motivates it). Still carries
    dead `corridorToPolygonData` (harmless; remove only as part of a real verified refactor).
    Also `sunArrowImage()` is now unused (billboard arrow replaced by surface geometry) —
    remove in the next map.js cleanup pass.
  - `AppState.on()` exists but has no subscribers — wire only when a feature demands it.
  - **Connectivity state** — now a real subsystem (post 2026-07-29 rewrite): active probe (3 s
    timeout, cache-busted, 15 s poll + event-driven, 3 s reprobe on failure), two-strike debounce,
    `_forceOffline`, and `applyOnlineState()` driving imagery, vectors and the pole filler. Still
    lives in `js/map.js`, not yet promoted to its own module. A *second*
    connectivity-dependent feature (cloud-cover #F2) is the trigger to promote it to a module
    with periodic re-probe + subscribers.
  - **Comment cleanup pass on map.js** — several build-to-build war-story comments could be
    condensed now that the approach is settled.

---

## LEGACY GENERATOR NOTES — "ROAD TO PURITY" (SUPERSEDED; reference only)
> **⚠ Describes the older *cone-limit-splitter* approach (generator ~2026-06-21c).** The
> shipped generator now produces umbral limits via `perpendicular_limits` (with `dep_local`) +
> analytic `umbra_pts` dispatch + exact green-line termini (`_terminate_on_green`); the dead
> `cone_limit_split` was removed. The pole-kernel / sliver / threshold concerns below MAY be
> obsolete — **reconcile against current code before acting.** Preserved so the reasoning isn't
> lost.

1. **Pole kernel — 1522-class.** The (old) cone trace SPURS BACK near ±86°, so the limb folds
   at the pole. Fix idea: dense near-pole resampling / pole-aware corrector.
2. **Sub-resolution slivers — the 8** (|γ|≈1, lat 61–75°). Cone returned None on contours
   smaller than the 25 km step. Fix idea: scale-aware step + closure + min-length.
3. **Retire the envelope + guard + suppress-fold** — only after 1 & 2, with a full-catalog
   no-regression pass.
4. **Derive/remove threshold gates** — 50 km median, 30° fold, 20° accept, 150 km tip-trim,
   0.3° closure tol. Derive from geometry where possible.
5. **Optional perf — bound the runaway trace.** Low value now that imap_unordered stops the
   straggler stall.
