# ShadowChaser — Backlog (durable pool)

## What this file is — and how it relates to the handoff
**Two documents, one job each. They must not duplicate.**
- **`HANDOFF_<date>.md`** owns *current status*: what changed this session, what is
  deployed, how things work now, what's closed, what's next. It is rewritten/dated each
  session. It is the source of truth for whether something is done.
- **`BACKLOG.md`** (this file) owns *durable detail*: bugs not yet fixed, open UX
  questions and their deliberations, the feature idea-pool, performance/data notes, and
  the refactor ledger. It accretes slowly and is pruned, not rewritten.

**Rules to keep them from drifting (this is what went wrong before):**
1. When an item here is fixed, **delete it from here** — the handoff records the closure.
   Do not leave "DONE" tombstones in the backlog.
2. Do **not** restate status here. If the handoff says #R3 is open, this file only holds
   the *candidate fixes / detail* for #R3, not its status.
3. The handoff references this file by item ("4 candidate approaches in BACKLOG.md");
   that detail lives here so the handoff stays scannable.

Last touched: 2026-06-16 — replaced "Corridor sampling artifacts" with the root-caused
"Umbral grazing-tip zigzag" entry (envelope+chord root cause; proven cone–spheroid contour
fix; the N/S-split blocker + rejected approaches + next idea; audit-triggered interim).
Added "Penumbra threshold offset" detail. Added the "Path unification" vision under
FEATURES — HARD. The bisector was removed this session (no backlog entry needed; closure in
handoff).

Last pruned: 2026-06-02 (later session — removed completed infra: MapLibre vendoring and
the PWA/service-worker keystone, both now done; updated #R4 offline story and the scan
note to reflect the SW; added the pro full-offline-download feature idea and the
connectivity-module refactor trigger). Earlier same-day prune removed everything closed
through that session — V-angle, offline antimeridian/seam/marker/elevation fixes,
contact-icon set, city search, list defaults, June 1954 icon, mobile initial-zoom,
brightness slider, About mailto/Android, and the implemented "decided behavioral changes".

---

## BUGS — open (detail; status in handoff)

- **Umbral grazing-tip zigzag (generator).** On grazing eclipses the umbral N/S limit
  shows a large gap (300–1200 km) paired with a ~150–177° fold at one or both ends. Audit
  signature: `gap NNN km at idx X->X+1` together with `interior turn ~150–177° at idx X`.
  Affects roughly half of eclipses (any with a grazing tip).
  **Root cause (PROVEN):** the umbral limit is traced by an envelope-of-moving-shadow method
  (`umbral_pts`: perpendicular offset from the axis + tangency angle + zeta fixed-point) plus
  a straight-chord extension (`_extend_to_green`) to the green terminus. The envelope
  correctly traces the limit until the shadow axis leaves Earth's disk (|C|→1) at the grazing
  tip — past that no axis-on-disk point exists, so the envelope returns None ~hundreds of km
  short of where totality actually ends (at the terminator/green line). The straight chord
  bridging that real-totality stretch IS the zigzag. (This supersedes the older "corridor
  sampling artifact / perpendicular-bisect" framing — same visible defect, now fully
  root-caused.)
  **Fix (PROVEN sub-km, prototyped):** trace the umbral limit directly as the cone–spheroid
  intersection contour — the zero level set of the ever-total depth field
  h(lat,lon) = max over time t of (|L2 − zeta·tan_f2| − m), where m = hypot(xi−X,(eta−Y)/rho1)
  and (xi,eta,zeta)=`_geo_to_fund`. Same predictor–corrector tracer as `green_curve`, just a
  different field. Validated: 2017 N 0.28 / S 0.15 km vs Jubier; 1144 BCE (a zigzag eclipse)
  traces ONE clean component reaching the grazing tip, max consecutive gap 25 km (= tracer
  step) vs the old 950 km chord. Build ~7–28 s/eclipse. Prototype + WIP integration exist in
  the dev scratch (not shipped).
  **THE ONE BLOCKER — N/S split (pure polyline topology, not physics):** the contour traces
  as a single closed loop (the corridor outline). It must be cut into the two named limits.
  Simple-geometry eclipses (e.g. 2033) split perfectly (worst-turn 2°). Corridor-shaped ones
  do not yet. Four approaches tried and REJECTED:
   1. Global longitude sort — scrambles limits that double back in longitude at high lat.
   2. Centreline-side classification — FAILS: the loop crosses the centreline side 4× not 2×,
      because near the tips the limit extends past the centreline ends (spurious flips).
   3. Longest-run-per-side — discards half of each limit.
   4. Farthest-apart-pair as the two tips — on a thin corridor the diameter lands on the SAME
      long side, not the two opposite tips.
  **NEXT approach (untried):** find the two true tips as maximum-curvature pinch points (where
  the tangent reverses ~180° over a short arc), or a principled curve-bisection — NOT max
  pairwise distance, NOT centreline side. Once split cleanly: re-validate the full 11-eclipse
  limit table vs Jubier (must stay sub-km, tips improved) AND re-run the BCE audit (zigzag
  reports must clear with no new artifacts) before replacing the envelope. Remove the dead
  envelope + `_extend_to_green` only after the contour proves out everywhere.
  **Interim option:** audit-triggered targeted repair — detect the zigzag signature and
  re-run ONLY flagged eclipses with the contour method as a fallback (envelope for the clean
  majority). The flagged ones are mostly simple grazers, exactly where the split already
  works. Bridges the shipped envelope and the contour fix without needing a universal splitter.

- **Penumbra threshold offset (low priority — user accepts "close").** Our penumbra limit
  sits ~7–10 km INSIDE Jubier's, asymmetric N/S. At Jubier's penumbra points our magnitude
  reads exactly 0, so their edge is just outside ours. Dropping the cone-narrowing term
  (m = L1 instead of L1 − zeta·tan_f1) fixes the north side but worsens the south — so it is
  NOT a single term. The asymmetry suggests a direction-dependent (refraction/limb) term.
  The implicit-contour penumbra prototype reaches ~9 km (better than the shipped ~15–25 km
  envelope). Pursue only if chasing sub-km everywhere; otherwise the penumbra is "naturally
  fuzzy" and close is fine. Eventually migrate penumbra onto the implicit engine as
  {max magnitude = 0}.

- **#R3 1950 polar "onion-ring" (deck.gl SolidPolygonLayer).** Path *lines* render fine;
  corridor + oval *fills* whose vertices lie in a polar region render as phantom
  concentric rings (canonical case: 1950-09-12). Underlying data is correct (no longitude
  jumps; vertices step smoothly near the pole). Current workaround: corridor fill
  disabled, ovals still filled. **Candidate fixes to evaluate:**
   1. Split corridor and ovals at the antimeridian before passing to SolidPolygonLayer.
   2. For polygons touching the polar cap, replace with a true polar-cap polygon
      (vertices + the pole point).
   3. Outline-only render for affected polygons.
   4. Switch to GeoJsonLayer with proper GeoJSON Polygon types + antimeridian splitting.
  Affects any eclipse whose path crosses a pole. NOT trivial — prior elegant attempts
  (signedLonWinding, polarCapRing, splitAtAntimeridian, tiled-corridor) each fixed one
  case and broke others. (Note: the same triangulator weakness is why markers aren't
  moved into WebGL — see handoff far-side-marker note.) User: leave as-is for now.

- **#R5 iOS pinch-zoom not blocked.** `user-scalable=no` is deliberately ignored by iOS
  Safari (accessibility, since iOS 10). Real fix: `touch-action: pan-y` on the scrollable
  panels (allows scroll, blocks pinch) while LEAVING the map container alone (the map
  needs pinch to zoom). Must test on a real iPhone — iOS touch handling is finicky.

- **#R4 / offline story.** Desktop true-offline is now SOLVED (service worker caches the
  app shell + globe basemap + 1900–2100 eclipse data; verified offline in Incognito).
  Remaining: a real-device airplane-mode test on the phone (the actual field scenario), and
  the installed-PWA experience (splash/icons — provisional icons exist; final art pending).
  If mobile shows a gap, it's likely an install/registration or viewport detail, not the
  caching design.

- **Locate-pin (📍, top-right of map).** Brave blocks geolocation by default (allow in
  `brave://settings/content/location`). Also `setStatus('Locating…')` writes to
  `#status-msg`, which lives in the Search tab → no visible feedback when on the Map tab.
  No code fix attempted; needs map-context feedback.

- **Slow first load from local-disk server** — minutes vs seconds. Profile what's
  blocking; likely a chunk-fetch pattern.

- **Date label hard to see on map (esp. mobile)** — placement/contrast; previously
  intersected the (now-removed) brightness slider. Reposition.

- **Scan ignores non-location filters** — always scans all 5 centuries regardless of
  other active filters. Pre-existing. (NB: offline this is now harmless noise rather than
  errors — the SW precaches all 50 besselian centuries, so the scan finds every chunk
  offline. The inefficiency of scanning all centuries when filters could narrow it remains.)

- **GE dot skew (VERIFY).** Greatest-eclipse dot was reported offset from where it should
  be. Unconfirmed whether still present after this session's marker work — verify before
  spending effort; remove if gone.

---

## REVISIT AFTER LIVING WITH IT (decide once it's been used a while)
- **Umbra ovals: blink-off vs fade.** Currently they blink off at zoom ≥ 7
  (`OVAL_HIDE_ZOOM` in map.js; `visible` prop toggled on the `zoom` event via
  `layer.clone`). Switching to a gradual alpha fade is the same machinery, just more
  `setProps` calls through the fade band — not wasteful, purely a feel preference. Live
  with the blink; switch to fade only if the cutoff feels abrupt. Threshold is a
  one-number change.

## OPEN UX QUESTIONS (deliberation; decide before coding)

- **Coordinates → "Location" rename + merge.** Consider renaming "Coordinates" to
  "Location" and merging the Coordinates + City instruction sections into one. CAUTION:
  the term appears in details panel, map popup, share text, and parser comments — decide
  the canonical term first, change everywhere consistently. CAVEAT: the parser doesn't
  currently handle bracketed multi-word city names (small code change needed). (The
  "Obscuration" canonical term and the narrow 2-column example layout are already done.)
- **Instructions vs. Search-Syntax sections** — are these meaningfully separate? Consider
  merging into one.
- **Circumstances panel density** — Global Circumstances is tall; on map-click the user
  should see local circs change without scrolling. Either tighten cell sizes/line-heights
  or switch Global Circs to a compact list-table while keeping Local Circs as blocks.
- **GE-dot zoom behavior** — the dot scales up with zoom until it fills the screen. Cap
  its max size in pixel space rather than world space.
- **Mobile map-click microsheet** — with no sidebar on mobile, a map click gives no inline
  "this is what changed." Add a small dismissable bottom-of-map sheet showing at least
  umbral duration for the clicked point.
- **Global-vs-local eclipse-type search semantics (#F5)** — "1960+ total St. Louis"
  should distinguish "total globally + visible from STL" vs "total AS SEEN from STL"
  (1979 was total globally, partial from STL — currently excluded by the `total` filter).
  Four design options exist; this is the "total somewhere / partial here" (Mag>0.99)
  disambiguation. Real UX design problem.

---

## FEATURES — EASY
- **Banner wastes too much vertical space on mobile** — screen space is precious on a phone;
  the banner is too tall. Tighten it for mobile (and distinguish web mode vs app/PWA mode —
  currently large in both). Reclaim the space for the map.
- Make map date more visible on mobile; move eclipse date to an overlay in desktop mode
  (and hide the redundant desktop map-status/date overlays now that the sidebar shows
  them).
- Dropped pin as a real 3-D-ish icon with a shadow (NOT a flat marker). NB: emoji + SVG
  teardrop both failed in a prior session (floating position, wrong anchor/scale);
  reverted to a red dot. Needs a proper MapLibre symbol-layer approach — first understand
  why GeoJSON symbol layers were abandoned.

## FEATURES — MEDIUM
- Server-side share page (`followtheshadow.com/share?e=XXXXX`) — static HTML reading the
  existing JSON, rendering a formatted summary + map image. The only way past the
  plain-text ceiling of `navigator.share`/`mailto` (no tables/images/HTML otherwise).
  Also the home for "prettier share" visual polish (the share.js rewrite handled the
  functional/format cleanup).
- Editable lat/lon/alt in the local-circumstances panel (coords are currently editable
  only via the search field, not in the panel itself).
- Splash / title page for installed-PWA mode; app icon; app logo / eclipse symbol.
- Parabolic sun-track diagram in the Details panel, below the data grids.
- Night-sky-during-totality view — planets/comets/bright stars near the Sun at totality,
  positioned for the selected eclipse.

## FEATURES — HARD
- **Path unification — all curves on one implicit-field engine (architectural vision).**
  Every path = the zero level set of a scalar field evaluated at each ground point's own
  moment of greatest eclipse, traced by one shared predictor–corrector:
    green     = {sun altitude at max = 0}        (DONE — sub-km)
    umbra     = {ever-total depth = 0}           (proven; splitter pending — see zigzag bug)
    penumbra  = {max magnitude = 0}              (prototype ~9 km)
    mag isolines = {max magnitude = c}           (enables Jubier's 0.2/0.4/0.6/0.8 curves free)
    centreline = ridge of the depth field        (max-finder, not a zero — mild extra work)
    terminator/sunrise-set = intersection of two conditions
  One engine parameterized by field + level (+ intersection mode) replaces the current
  hodgepodge (envelope, perpendicular bisect, lemniscate constructions). Uniformly
  validatable against Jubier by cross-track distance. PHASED: migrate one curve at a time,
  validate, swap in only when it beats the incumbent everywhere, retire legacy only after.
  Evidence it works: green + umbra both hit sub-km via the same tracer across figure-8,
  two-blob, and polar topologies. Suggested two-branch discipline: freeze the shipped
  generator (bugfix-only) as the stable truth; develop the unified engine as the
  experimental successor. ~4–6 phased sessions. Order: (1) finish umbra splitter; (2)
  penumbra onto the engine; (3) terminator/centreline + unify the tracer + retire legacy.
- **#F2 Cloud-cover / weather overlay** — the killer feature. Forecast (near-term) +
  climatology (far-future); needs data-source choice, globe-layer rendering, online/
  offline behavior, controls, perf. ~2 sessions of design before code.
- **#F3 Animated shadow on globe with time slider** — scrub the umbra/penumbra in real
  time. Most on-brand feature.
- **#F4 Topographic shadow overlay** — terrain shadows at the observer location.
- **#F1 Personal "ShadowChaser log"** — eclipses visited / wishlist; schema, localStorage
  (or future sync), UI in list/details, "been there" vs "want to go", merge with selection
  state. (Reference: a clean list with icons, dates, types.)
- Thumbnail path map per list row (small SVG per row).
- Century scroller on the mobile right edge.
- KMZ download.

---

## PERFORMANCE / DATA
- Frontload-cache a hot range (e.g. 1900–2100) so common selections are instant.
- Path thumbnails for list rows — feasibility/size for 5 centuries of tiny scaled
  flat-map paths; could be cheap if simplified.
- Drop or make-optional pre-1000 CE eclipses — cost/benefit on load/data shed.
- Trim unused Cormorant Garamond weights — only `.app-title` uses weight 300; the other
  four loaded weights (400, 600, italics) are dead after the About-text font switch
  (~70% font-payload reduction).

---

## INFRA (durable; keystones of the offline goal)
- **Production bundling** (single JS/CSS) — relevant given the offline goal. NB the service
  worker now precaches the individual files fine, so this is optimization, not a blocker.
- **Offline city labels** — MapLibre symbol layers need PBF glyphs; system fonts aren't
  available to the WebGL renderer, so offline is dots-only. Bundle Noto Sans PBF glyphs
  (~2–3MB) or find an alternative. (The basemap dots/borders themselves are now cached
  offline by the service worker.)
- **Pro "download everything for the field" toggle** — a Settings option (while online) to
  precache the *full* paths set (~274MB) so any eclipse, any era draws offline. Today the SW
  caches only the 1900–2100 path range + all besselian; out-of-range eclipses draw offline
  only if viewed online first. Deferred deliberately: the load-once-online → cached-forever
  behavior already covers the realistic field case (you research an eclipse before chasing
  it), and a full-download toggle needs progress UI, quota handling, partial-failure
  recovery, and a clear-cache control. Build only if a real user asks. (Dedicated-iPad
  "extreme offline" scenario lives here too.)

---

## REFACTOR LEDGER
- **Pass A** ✓ (2026-05-21) — split inline script into `js/` modules.
- **Pass B** ✓ (2026-05-21) — event-driven AppState (AppState + forwarding shims; URL
  auto-update via event; map subsystem event-driven, 9 mapReady guards → 1).
- **Always-selected eclipse** ✓ (2026-05-21) — removed deselect UI and most null
  branches; left three init-time preconditions in `pushState`, `updateMapState`,
  `renderData`.
- **Pass C** — deferred. To tackle when a feature/bug motivates it:
  - Init-time preconditions are patchy: the three "init-time only" early-returns exist
    because events fire before `selectNextEclipse` completes. Architectural fix: don't
    fire events for things that don't yet exist — wire selection before subscribers, or
    buffer events until init completes.
  - Search input still DOM-driven (not on AppState).
  - `map.js` still large/single-file (split deferred until a bug motivates it).
  - Similar event wiring possible for list/details.
  - `AppState.on()` exists but has no subscribers — wire only when a feature demands it,
    don't pre-emptively rewire.
  - **Connectivity state** is three OR'd signals in `isOffline()` (`_forceOffline`,
    `_probedOffline`, `navigator.onLine`). Fine for one probe. If a *second*
    connectivity-dependent feature appears (e.g. cloud-cover #F2 needing live vs cached
    data), that's the trigger to promote it to a small connectivity module with periodic
    re-probe + subscribers — not before.
