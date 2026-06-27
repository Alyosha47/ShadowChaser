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

Last touched: 2026-06-27 — UI/copy pass mostly closed out (see below for what's left); map
camera logic for GE-centering and map-click behavior fixed; starfield.js added. The pre-ship
gate (full-catalog audit) and the v2 map paradigm (Cesium) remain the two big non-UI items.

---

## PRIORITY ORDER (suggested re-entry)
1. **Search temporal tokens** — needs a design decision before any code (see below).
2. **Full-catalog audit — the pre-ship GATE** (see PRE-SHIP GATE). The real blocker to
   shipping; the 2028/2041 regression proved spot-checks insufficient.
3. **Remaining small UI items** (date label visibility, clear-location control — see below).
4. **v2 — map paradigm (Cesium) + cosmetics** (see V2 — DEFERRED).
5. **Mobile UX / layout pass** (interdependent — one sitting).
6. Open bugs → UX deliberations → Features.

---

## OPEN — UI / COPY

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
  Decide the model first, then align the example text (line ~237). The underlying asymmetry Guy
  noticed (`today+` exists; `now-` semantics are murky) gets resolved by whichever model wins.

- **Date label hard to see on map (esp. mobile)** — placement/contrast; previously
  intersected the (now-removed) brightness slider. Reposition.

- **Instructions note: online/offline is reload-only.** Add a line explaining the map picks
  online/offline at load; switching networks needs a page reload. (Related to the "Online /
  offline maps." paragraph, already trimmed.)

- **Dropped pin as a real 3-D-ish icon with a shadow (NOT a flat marker).** NB: emoji + SVG
  teardrop both failed before (floating position, wrong anchor/scale); reverted to a red dot.
  Needs a proper MapLibre symbol-layer approach — first understand why GeoJSON symbol layers
  were abandoned.

- **Umbra ovals: blink-off vs fade (revisit after living with it).** They blink off at zoom ≥ 7
  (`OVAL_HIDE_ZOOM` in map.js; `visible` toggled on the `zoom` event via `layer.clone`).
  Switching to a gradual alpha fade is the same machinery, just more `setProps` through the
  fade band. Live with the blink; switch to fade only if the cutoff feels abrupt. Threshold is
  a one-number change.

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
  to see" + the map-click microsheet); (d) map-tab mobile-vs-desktop disambiguation —
  desktop: map is ever-present, the tab is a placeholder for future features; mobile: the tab
  IS the map → different look/behaviour.
- **Banner wastes too much vertical space on mobile** — screen space is precious on a phone;
  the banner is too tall. Tighten it for mobile (and distinguish web mode vs app/PWA mode —
  currently large in both). Reclaim the space for the map.
- Make map date more visible on mobile; move eclipse date to an overlay in desktop mode (and
  hide the redundant desktop map-status/date overlays now that the sidebar shows them).
- **Mobile map-click microsheet** — with no sidebar on mobile, a map click gives no inline
  "this is what changed." Add a small dismissable bottom-of-map sheet showing at least umbral
  duration for the clicked point.

---

## ⛔ DO NOT DO (verified traps — recorded so they aren't re-attempted)
- **Do NOT rename the `ep.centreline` DATA KEY → `centerline`.** This is the internal JSON key
  emitted by the generator and read by `map.js` (plus the layer id) — distinct from the visible
  tolerances-table label (already changed; see refactor ledger / handoff). Renaming the key
  requires changing generator output, regenerating EVERY path file, and changing the reader in
  lockstep: a breaking refactor for zero user-visible payoff. If American spelling everywhere is
  ever wanted, it's a deliberate v2 refactor, not a quick fix.

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

## V2 — DEFERRED (decided 2026-06-24; revisit as a deliberate upgrade, not pre-ship)
- **Map paradigm → CesiumJS.** The recurring seam/pole rendering pain is architectural: both
  current renderers (MapLibre globe via geojson-vt, and deck.gl SolidPolygonLayer) triangulate
  fills in flat lon/lat and wrap to the globe, so poles + the antimeridian are singularities in
  the *renderer*, not the data (MapLibre has a documented "hole past 85°"; deck.gl inverts a
  pole-containing polygon). Cesium renders on the true WGS84 ellipsoid — no flat-projection
  singularities, fills poles natively. Apache-2.0 / free (ion optional; blank the token to run
  without it), loads GeoJSON/KML natively, offline local basemaps keep working (online adds
  streamed imagery). Scoped to the **map layer only** (`js/map.js` + script tags in index.html);
  the Besselian math, catalog, search, list, details are untouched. This single move retires the
  whole seam/pole bug class and the two items below.
- **Pole-encircling umbra-oval fills.** Currently the pole-encircling ring is SKIPPED (not
  drawn) — better than the inside-out fill it used to render (e.g. Jan 2094, ring winds a full
  360° at lat −88 to −89.8). Cesium fills it properly as a polar cap. Normal + antimeridian
  ovals already fill fine on the current renderer.
- **Online Antarctica wedge** (OpenFreeMap "liberty", `ONLINE_STYLE_URL`). Their land polygon
  isn't wound/split for globe mode the way our local basemap is, so it wedges at the pole — only
  visible on south-pole views, and only online (offline is fine). Can't edit their tiles; stopgap
  is to overlay our correctly-wound local Antarctica fill over their style (needs a colour match,
  un-eyeballable from the build box). Cesium fixes it for free.
- **Cosmetic terminus-join kinks** — 1533 / 1563 / 1587 (small joins). And **1522** is a bumpy
  mid-latitude grazer (γ +0.995, not polar) — livable. Low priority polish.

---

## BUGS — open (detail; status in handoff)
- **Residual terminus polish (low priority — rare, cosmetic, NOT a regen blocker).** Only the
  grazing hybrid remains: 1986-10-03 (γ=+0.993) traces but the totality corridor is so tiny
  (~22 pts) it renders kinked. Candidate fix: densify the cone trace when a limb returns under
  ~40 pts. Gentle-tip decliners (e.g. −1294T, 2027) fall to the envelope but it is SMOOTH at
  gentle tips (0–1°), so those are harmless, not bugs.
- **Penumbra threshold offset (low priority — user accepts "close").** Our penumbra limit
  sits ~7–10 km INSIDE Jubier's, asymmetric N/S. At Jubier's penumbra points our magnitude
  reads exactly 0, so their edge is just outside ours. Dropping the cone-narrowing term
  (m = L1 instead of L1 − zeta·tan_f1) fixes the north side but worsens the south — so it is
  NOT a single term. The asymmetry suggests a direction-dependent (refraction/limb) term. The
  implicit-contour penumbra prototype reaches ~9 km (better than the shipped ~15–25 km
  envelope). Pursue only if chasing sub-km everywhere; otherwise the penumbra is "naturally
  fuzzy" and close is fine. Eventually migrate penumbra onto the implicit engine as
  {max magnitude = 0}.
- **#R5 iOS pinch-zoom not blocked.** `user-scalable=no` is deliberately ignored by iOS
  Safari (accessibility, since iOS 10). Real fix: `touch-action: pan-y` on the scrollable
  panels (allows scroll, blocks pinch) while LEAVING the map container alone (the map needs
  pinch to zoom). Must test on a real iPhone — iOS touch handling is finicky.
- **#R4 / offline story.** Desktop true-offline is SOLVED (service worker caches the app shell
  + globe basemap + 1900–2100 eclipse data; verified offline in Incognito). Remaining: a
  real-device airplane-mode test on the phone (the actual field scenario), and the
  installed-PWA experience (splash/icons — provisional icons exist; final art pending). If
  mobile shows a gap, it's likely an install/registration or viewport detail, not the caching
  design.
- **Locate-pin (📍, top-right of map).** Brave blocks geolocation by default (allow in
  `brave://settings/content/location`). Also `setStatus('Locating…')` writes to `#status-msg`,
  which lives in the Search tab → no visible feedback when on the Map tab. No code fix
  attempted; needs map-context feedback.
- **Safari geolocation fails; installed PWA works.** Locate-pin works in the installed app but
  not in Safari. Check secure-context / permissions / Brave default block vs the code path.
  Related to the locate-pin note above.
- **Slow first load from local-disk server** — minutes vs seconds. Profile what's blocking;
  likely a chunk-fetch pattern.
- **Scan ignores non-location filters** — always scans all 5 centuries regardless of other
  active filters. Pre-existing. (NB: offline this is harmless noise rather than errors — the
  SW precaches all 50 besselian centuries, so the scan finds every chunk offline. The
  inefficiency of scanning all centuries when filters could narrow it remains.)

---

## OPEN UX QUESTIONS (deliberation; decide before coding)
*(Mobile map-click microsheet moved up into the Mobile UX pass.)*
- Reserved for future deliberations — keep this section as the home for "decide before coding"
  questions so they don't get lost in the feature pool.

---

## FEATURES — EASY
- Server-side share page seedling lives under MEDIUM; keep EASY for genuinely small adds.
- Make map date more visible on mobile (see Mobile UX pass).
- Thumbnail path map per list row (small SVG) — MOBILE ONLY (not desktop).
- Century scroller on the mobile right edge.
- KMZ download.

## FEATURES — MEDIUM
- Server-side share page (`followtheshadow.com/share?e=XXXXX`) — static HTML reading the
  existing JSON, rendering a formatted summary + map image. The only way past the plain-text
  ceiling of `navigator.share`/`mailto` (no tables/images/HTML otherwise). Also the home for
  "prettier share" visual polish (the share.js rewrite handled the functional/format cleanup).
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
  hodgepodge. Uniformly validatable against Jubier by cross-track distance. PHASED: migrate one
  curve at a time, validate, swap in only when it beats the incumbent everywhere, retire legacy
  only after. Suggested two-branch discipline: freeze the shipped generator (bugfix-only) as
  the stable truth; develop the unified engine as the experimental successor. ~4–6 phased
  sessions. Next phase: penumbra onto the engine.
- **#F2 Cloud-cover / weather overlay** — the killer feature. Forecast (near-term) +
  climatology (far-future); needs data-source choice, globe-layer rendering, online/offline
  behavior, controls, perf. ~2 sessions of design before code.
- **#F3 Animated shadow on globe with time slider** — scrub the umbra/penumbra in real time.
  Most on-brand feature.
- **#F4 Topographic shadow overlay** — terrain shadows at the observer location.
- **#F1 Personal "ShadowChaser log"** — eclipses visited / wishlist; schema, localStorage (or
  future sync), UI in list/details, "been there" vs "want to go", merge with selection state.

---

## PERFORMANCE / DATA
- **Path JSON size — curve thinning (RDP).** Full-loop traces + pole tips added points (e.g.
  1526 umbra 178→368 pts). Reduce size WITHOUT losing accuracy via Douglas–Peucker (RDP)
  decimation per curve at a sub-cartographic tolerance (~200–500 m, far below visible-at-max-
  zoom). Removes redundant points on straight/gently-curved spans while preserving sharp tips.
  Apply to centreline + umbra limits; penumbra (already 2 dp) and terminators are candidates.
  Expected 30–60% smaller, zero visible change. Verify post-thin curves stay within tolerance
  of pre-thin (re-check tip cusps). Secondary (only if RDP insufficient): delta-encode coords
  before gzip; or spline-fit to coefficients (higher effort — needs a front-end evaluator;
  prefer RDP first).
- Frontload-cache a hot range (e.g. 1900–2100) so common selections are instant. *(Largely
  done by the SW precache; keep as a note for any further hot-range tuning.)*
- Path thumbnails for list rows — feasibility/size for 5 centuries of tiny scaled flat-map
  paths; could be cheap if simplified.
- Drop or make-optional pre-1000 CE eclipses — cost/benefit on load/data shed.
- **Trim unused Cormorant Garamond weights.** Re-check against the NEW (current, first-person)
  About text — confirm which weights it actually uses before trimming.

---

## INFRA (durable; keystones of the offline goal)
- **Production bundling** (single JS/CSS) — relevant given the offline goal. NB the service
  worker now precaches the individual files fine, so this is optimization, not a blocker.
- **Offline city labels** — MapLibre symbol layers need PBF glyphs; system fonts aren't
  available to the WebGL renderer, so offline is dots-only. Bundle Noto Sans PBF glyphs
  (~2–3MB) or find an alternative. (The basemap dots/borders themselves are now cached offline
  by the service worker.)
- **Pro "download everything for the field" toggle** — a Settings option (while online) to
  precache the *full* paths set (~274MB) so any eclipse, any era draws offline. Today the SW
  caches only the 1900–2100 path range + all besselian; out-of-range eclipses draw offline
  only if viewed online first. Deferred deliberately: the load-once-online → cached-forever
  behavior already covers the realistic field case, and a full-download toggle needs progress
  UI, quota handling, partial-failure recovery, and a clear-cache control. Build only if a real
  user asks. (Dedicated-iPad "extreme offline" scenario lives here too.)

---

## REFACTOR LEDGER
- **Pass A** ✓ (2026-05-21) — split inline script into `js/` modules.
- **Pass B** ✓ (2026-05-21) — event-driven AppState (AppState + forwarding shims; URL
  auto-update via event; map subsystem event-driven, 9 mapReady guards → 1).
- **Always-selected eclipse** ✓ (2026-05-21) — removed deselect UI and most null branches;
  left three init-time preconditions in `pushState`, `updateMapState`, `renderData`.
- **Pass C** — deferred. To tackle when a feature/bug motivates it:
  - Init-time preconditions are patchy: the three "init-time only" early-returns exist because
    events fire before `selectNextEclipse` completes. Architectural fix: don't fire events for
    things that don't yet exist — wire selection before subscribers, or buffer events until
    init completes.
  - Search input still DOM-driven (not on AppState).
  - `map.js` still large/single-file (split deferred until a bug motivates it). Also still
    carries the dead `corridorToPolygonData` (harmless; left in place deliberately to avoid
    another over-eager cleanup — remove only as part of a real, verified map.js refactor).
  - Similar event wiring possible for list/details.
  - `AppState.on()` exists but has no subscribers — wire only when a feature demands it.
  - **Connectivity state** is three OR'd signals in `isOffline()` (`_forceOffline`,
    `_probedOffline`, `navigator.onLine`). Fine for one probe. If a *second* connectivity-
    dependent feature appears (e.g. cloud-cover #F2 needing live vs cached data), that's the
    trigger to promote it to a small connectivity module with periodic re-probe + subscribers.

---

## LEGACY GENERATOR NOTES — "ROAD TO PURITY" (SUPERSEDED; reference only)
> **⚠ This block describes the older *cone-limit-splitter* approach (generator ~2026-06-21c).**
> The shipped generator now produces umbral limits via `perpendicular_limits` (with
> `dep_local`) + analytic `umbra_pts` dispatch + exact green-line termini
> (`_terminate_on_green`); the dead `cone_limit_split` was removed. The 16th + 21st centuries
> inspect clean under the current approach. The pole-kernel / sliver / threshold concerns
> below MAY be obsolete or may persist in a different form — **reconcile against the current
> code before acting.** Preserved here so the reasoning isn't lost.

1. **Pole kernel — 1522-class.** The (old) cone trace SPURS BACK near ±86° (1522-09-19 north
   limb: body 180°, ~2× length), so the limb folds at the pole. Fix idea: dense near-pole
   resampling / pole-aware corrector. (NB current generator handles 1522 as a livable bumpy
   grazer — see V2 cosmetics.)
2. **Sub-resolution slivers — the 8** (|γ|≈1, lat 61–75°). Cone returned None on contours
   smaller than the 25 km step. Fix idea: scale-aware step + closure + min-length.
3. **Retire the envelope + guard + suppress-fold** — only after 1 & 2, with a full-catalog
   no-regression pass. (The current generator's relationship to the envelope differs; reconcile.)
4. **Derive/remove threshold gates** — 50 km median, 30° fold, 20° accept, 150 km tip-trim,
   0.3° closure tol. Some physical, some tuned — derive from geometry where possible.
5. **Optional perf — bound the runaway trace.** Set maxpts just above the longest legitimate
   accepted trace. Low value now that imap_unordered stops the straggler stall.
