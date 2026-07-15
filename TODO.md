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

Last touched: 2026-07-11 — **Cesium migration landed and mobile offline works** (survives
backgrounding + offline reload; seamless online↔offline). map.js consolidated to one `PROFILE`.
Mobile offline basemap = NE2; sun-arrow rebuilt as flat surface geometry. What remains on the
map is cosmetic polish (below). The two big non-map items still stand: search temporal tokens
and the full-catalog pre-ship audit.

---

## PRIORITY ORDER (suggested re-entry)
*(The map is stable and cosmetically finished as of 2026-07-13/14. Offline works. The cosmetics
backlog that used to sit at #1 is closed — see "Shipped this session".)*
1. **#F4 Topographic shadow overlay** — THE next big feature, and the reason for the Cesium
   migration. Needs real scoping first: terrain provider, and the large open question of
   **offline terrain data**. Deserves its own thread.
2. **Label-free basemaps + our own labels** — one change that fixes the truncated tile labels
   ("MAD"/"LON"), the patchy per-tile detail, AND placename language. See OPEN — UI / COPY.
3. **Full-catalog audit — the pre-ship GATE** (see PRE-SHIP GATE). The real blocker to shipping;
   the 2028/2041 regression proved spot-checks insufficient.
4. **On-map control strip** (basemap / clouds / shadows) — decide the model before building; it
   likely makes the desktop Map panel redundant.
5. **Search temporal tokens** — needs a design decision before any code.
6. **Mobile UX / layout pass** (interdependent — one sitting).
7. Open bugs → UX deliberations → Features.

---

## MAP COSMETICS — mostly DONE (2026-07-12/13). What remains:
- **Limb not perfectly round** — the globe silhouette shows slight facets at grazing angle
  (ellipsoid tessellation). Only improvable with finer globe geometry (lower
  `maximumScreenSpaceError`) at a memory cost. Low priority; decide if worth it.
- **Raster sharpness ceiling.** NE2 is 4096x2048 (9.8 km/px) via SingleTileImageryProvider, so it
  is soft below ~300 km views. 8192x4096 would be ~134 MB of GPU texture — a 4x jump on the very
  platform we fought an OOM on, so DO NOT just swap the image. The right answer is a **tile
  pyramid** (only visible tiles resident). Revisit only if the softness actually bothers you in
  the field.
- **Biome-blob basemap (optional style).** Posterizing NE2 to a few flat colours gives
  forest/desert/tundra blobs at the same texture cost. A style choice, parked.
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

- **Truncated basemap labels ("MAD" for Madrid, "LON" for London) + patchy detail (western US
  loses its states).** DIAGNOSED, not fixed. These labels are **baked into the raster tiles**. On a
  globe, Cesium requests a different LOD per tile depending on distance from the camera, so a word
  spanning a tile boundary can straddle two DIFFERENT zoom levels and get cut; and areas further
  round the curve are served coarser tiles, losing their detail. **Inherent to any raster basemap
  with pre-rendered labels on a 3D globe — no tuning fixes it.**
  **The proper fix:** switch to **label-free base tiles** (Esri publishes Light Gray *Base* and
  Imagery without labels — that's what its separate "Reference" overlays are for) and render the
  labels OURSELVES. Our vector city labels are already LOD-independent and correctly
  horizon-culled; they're merely hidden while online. This would also make labels consistent
  across every basemap and give us control over language (see below). Worth doing properly.

- **OpenStreetMap shows local-language placenames** (Москва, 北京). There is **no free English-only
  OSM raster** — the standard tiles are baked with local names, and that's a property of the tile
  images, not something a client can override. Options: (a) accept it; (b) use Esri's tiles, which
  are largely English; (c) the real answer — go label-free + draw our own labels (above), where we
  control the language entirely. Keyed vector providers (MapTiler etc.) can do English-only, but
  need an API key.

- **Where do map options belong?** Currently in Settings; the desktop **Map panel does nothing**.
  Guy's thought: put a discreet **street / topo / satellite toggle on the map itself** (a real win
  on mobile), and later small toggles for **clouds** and **shadows** — which would make the Map
  panel redundant on desktop. Decide the model before building: an on-map control strip is the
  natural home for layer toggles, and it scales to the coming overlays.

- **Should HYBRID eclipses match a search for "total"?** They ARE total along part of their path
  (569 of 11,898). Arguments: a chaser searching "total" near a location would want a hybrid that
  is total *there*; against: it muddies a precise term, and hybrids are already their own type.
  Middle path: include hybrids in "total" results but label them clearly as hybrid, OR make
  totality-at-the-chosen-location the criterion when a location is set. **Needs a decision, not a
  guess — it changes what the app claims.**

- **Search temporal tokens — open-ended *backward* ranges are useless (the "1999-" / "now-"
  problem). NEEDS A DESIGN DECISION — do not code yet.** Today a trailing-dash range like
  `1999-` lists ascending from the catalog's START (year ~1 or earlier), so the user drowns in
  ancient eclipses and never reaches 1999. **Constraint from Guy: the list must ALWAYS read the
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

## MOBILE UX / LAYOUT PASS (interdependent — one sitting)
- (a) Banner + tabs permanent, immobile, unscalable on mobile/PWA (pairs with #R5 pinch-zoom
  — don't scroll away or zoom); (b) move tabs to screen BOTTOM on mobile/PWA for thumb reach;
  (c) single-line date/duration bar pinned at the bottom on mobile (overlaps "date label hard
  to see" + the map-click microsheet); (d) map-tab mobile-vs-desktop disambiguation — SEE the
  "Where do map options belong?" item under OPEN — UI / COPY: the likely answer is an on-map
  control strip (basemap / clouds / shadows), which would make the desktop Map panel redundant.
- **Mobile map-click microsheet** — with no sidebar on mobile, a map click gives no inline
  "this is what changed." Add a small dismissable bottom-of-map sheet showing at least umbral
  duration for the clicked point.

---

## 🧭 STANDING RULE — USE CESIUM'S API BEFORE HAND-ROLLING
Most of the churn in this project came from treating Cesium as a dumb renderer to outsmart,
rather than an engine with a considered API. Two costly examples:
- The land fill was floated as a **primitive over** the globe, whose occlusion of labels then led
  to clamp-to-ground and the iOS crash. The answer was to make it **imagery** — i.e. part of the
  globe surface. Days lost.
- Eclipse paths were **lifted** off the ground to win a depth fight against border lines, which
  parallaxed them across the surface. `depthFailMaterial` does exactly this, at zero geometric cost.

**Rule: before writing per-frame code or geometry tricks to fake a visual effect, name the Cesium
API that should do it. If you can't name one, say so out loud rather than hacking silently.**

**Corollary — beware "safety rails".** Several bugs this session were constants added as harmless
guards that quietly became the DOMINANT term: a 2 km arrow floor (at street zoom the whole view is
2 km, so the arrow filled the screen); a 16 px screen floor applied AFTER a 300 km ground cap (at
globe zoom the floor was larger than the cap, so `Math.max` threw the cap away and the arrow
spanned Africa). If two limits can fight, write down which one must win — and check the arithmetic
at BOTH extremes, not just the one you were looking at.
The tell is any code running every frame to simulate something the engine likely does natively.

### Audit: hand-rolled effects vs the native API
DONE — and the rule paid for itself immediately:
- ~~NE2↔vector crossfade~~ — **deleted outright**. The hand-rolled `band()` alpha ramp existed to
  hand over to a vector land fill that was itself the mobile OOM. Removing both was the fix.
- ~~Marker/label occlusion at the limb~~ — now `EllipsoidalOccluder`, the native horizon test.
  Fixed the half-eaten labels ("Mexico City" → "TY") and the hemisphere blink in one move.
- ~~Sun-arrow sizing~~ — now `camera.getPixelSize()`, the engine's own metres-per-pixel. My
  hand-rolled frustum trig was simply wrong and produced arrows many times the requested size.

STILL HAND-ROLLED (audit when convenient):
- **Border fade with zoom** — we poke `material.uniforms.color.alpha` every frame. Primitives
  support distance-based appearance natively.
- **Arrow geometry rebuild** — the arrow is still surface geometry recomputed per frame via
  `CallbackProperty`. A `Billboard` with `scaleByDistance` would be GPU-side and free — IF the
  limb/occlusion problem is solved properly rather than by hand. The sizing is now correct, so
  this is an optimisation, not a bug fix.

---

## ⛔ DO NOT DO (verified traps — recorded so they aren't re-attempted)
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

## PRE-SHIP GATE — FULL-CATALOG AUDIT
Build all ~11,898 with the current generator and flag central eclipses with empty/stub umbra
limbs, gross limb asymmetry, or wild interior turns. Fold the checks INTO the regen
(per-eclipse flags appended to an `_audit.txt` beside the chunks) so it costs zero extra build
time. The 2028/2041 regressions proved spot-checks miss things; this turns one-eclipse luck
into systematic coverage. No ground-truth comparison — it surfaces *suspicious* cases by
internal consistency for eyeballing vs Jubier. The generator already prints an `interior turn`
flag on any umbra limb >30°, so residual zigzags self-report during regen — the audit
generalizes that into a saved, catalog-wide report.

---

## MAP — remaining Cesium correctness (not cosmetic)
- **Pole-encircling umbra-oval fills.** The pole-encircling ring was SKIPPED on the old
  renderer. Cesium fills the ellipsoid natively; verify polar-cap ovals (e.g. Jan 2094) now
  fill correctly and remove the skip if so.
- **Cosmetic terminus-join kinks** — 1533 / 1563 / 1587 (small joins); **1522** is a bumpy
  mid-latitude grazer (γ +0.995) — livable. Low priority polish.

---

## BUGS — open (detail; status in handoff)
- **Residual terminus polish (low priority — rare, cosmetic, NOT a regen blocker).** Only the
  grazing hybrid remains: 1986-10-03 (γ=+0.993) traces but the totality corridor is so tiny
  (~22 pts) it renders kinked. Candidate fix: densify the cone trace when a limb returns under
  ~40 pts. Gentle-tip decliners fall to the envelope but it is SMOOTH at gentle tips, so those
  are harmless.
- **Penumbra threshold offset (low priority — user accepts "close").** Our penumbra limit
  sits ~7–10 km INSIDE Jubier's, asymmetric N/S. NOT a single term (dropping the cone-narrowing
  term fixes north, worsens south) — suggests a direction-dependent (refraction/limb) term. The
  implicit-contour penumbra prototype reaches ~9 km. Pursue only if chasing sub-km everywhere;
  otherwise "naturally fuzzy" is fine. Eventually migrate penumbra onto the implicit engine as
  {max magnitude = 0}.
- **#R5 iOS pinch-zoom not blocked.** `user-scalable=no` is deliberately ignored by iOS Safari.
  Real fix: `touch-action: pan-y` on the scrollable panels (allows scroll, blocks pinch) while
  LEAVING the map container alone (the map needs pinch to zoom). Must test on a real iPhone.
- **Locate-pin (📍, top-right of map).** Brave blocks geolocation by default. Also
  `setStatus('Locating…')` writes to `#status-msg` in the Search tab → no visible feedback on
  the Map tab. Needs map-context feedback.
- **Safari geolocation fails; installed PWA works.** Check secure-context / permissions / Brave
  default block vs the code path. Related to the locate-pin note.
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

## OPEN UX QUESTIONS (deliberation; decide before coding)
- **Probe backoff (agreed, not yet built).** The connectivity probe fires every 5 s forever — a
  radio wake-up on mobile (battery, more than bytes). Negatives are already DEBOUNCED (2 consecutive
  failures) so a single timeout can't flip the app. The agreed improvement: poll at 5 s for ~30 s
  after any state change, then relax to 20–30 s while the state is stable. Fast detection when it
  matters, near-zero cost otherwise. Contained: one timer, no change to the detection logic.

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
- **#F2 Cloud-cover / weather overlay** — the killer feature. Forecast (near-term) +
  climatology (far-future); needs data-source choice, globe-layer rendering, online/offline
  behavior, controls, perf. ~2 sessions of design before code.
- **#F3 Animated shadow on globe with time slider** — scrub the umbra/penumbra in real time.
  Most on-brand feature. (Cesium's the reason we migrated — this is now buildable.)
- **#F4 Topographic shadow overlay** — terrain shadows at the observer location.
- **#F1 Personal "ShadowChaser log"** — eclipses visited / wishlist; schema, localStorage (or
  future sync), UI in list/details, "been there" vs "want to go", merge with selection state.

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
  the install list at all; precache only what the page never requests (Cesium Workers/Assets,
  out-of-range besselian/paths). Then measure the network panel again. Do this calmly, on a
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
- **Open-source prep** — licensing/attribution: Cesium (Apache-2.0), Natural Earth (public
  domain), NASA Blue Marble, eclipse data (Espenak/Meeus).
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
  - **Connectivity state** — now a real subsystem: active probe (3 s timeout, cache-busted, 5 s
    interval), debounced negatives, `_forceOffline`, and `applyOnlineState()` driving imagery,
    vectors and the pole filler. It has outgrown being scattered in `map.js`. A *second*
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
