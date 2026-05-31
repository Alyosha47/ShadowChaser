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

Last pruned: 2026-05-31 (removed everything closed through that session — V-angle,
offline antimeridian/seam/marker/elevation fixes, contact-icon set, city search, list
defaults, June 1954 icon, mobile initial-zoom, brightness slider, About mailto/Android,
and the implemented "decided behavioral changes").

---

## BUGS — open (detail; status in handoff)

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

- **#R4 / offline story.** Offline basemap not working on mobile is one symptom of a
  larger gap: front-loading the basemap only succeeds when reachable via a local server;
  true-offline (phone with no signal) leaves no map. The whole offline story needs a
  rethink → ties to PWA / service worker + vendoring MapLibre locally (see Infra). Mobile
  symptom parked until desktop is stable.

- **Locate-pin (📍, top-right of map).** Brave blocks geolocation by default (allow in
  `brave://settings/content/location`). Also `setStatus('Locating…')` writes to
  `#status-msg`, which lives in the Search tab → no visible feedback when on the Map tab.
  No code fix attempted; needs map-context feedback.

- **Slow first load from local-disk server** — minutes vs seconds. Profile what's
  blocking; likely a chunk-fetch pattern.

- **Date label hard to see on map (esp. mobile)** — placement/contrast; previously
  intersected the (now-removed) brightness slider. Reposition.

- **Scan ignores non-location filters** — always scans all 5 centuries regardless of
  other active filters. Pre-existing.

- **GE dot skew (VERIFY).** Greatest-eclipse dot was reported offset from where it should
  be. Unconfirmed whether still present after this session's marker work — verify before
  spending effort; remove if gone.

---

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
- **Magnitude ovals fade at high zoom (decided, not yet built).** The semi-transparent
  magnitude ovals (partial-eclipse shading rings) should fade out as the user zooms in —
  once they would either darken the specific point being inspected, or cover enough screen
  real estate that the shading becomes counterproductive rather than informative. Fade by
  zoom level (and/or by fraction of viewport covered); the ovals are most useful at
  global/regional zoom and just get in the way close up. NB this is the *oval* fill
  (#R3-related but separate from the onion-ring bug); coordinate with whatever fill
  decision #R3 lands on.
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
- Banner size — distinguish web mode vs app mode (currently large in both).
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
- **Vendor MapLibre locally** — currently loaded from unpkg CDN (`maplibre-gl@5.5.0`),
  which breaks true offline. Must become a local file.
- **PWA / service worker** — the keystone for offline-in-the-field.
- **Production bundling** (single JS/CSS) — relevant given the offline goal.
- **Offline city labels** — MapLibre symbol layers need PBF glyphs; system fonts aren't
  available to the WebGL renderer, so offline is dots-only. Bundle Noto Sans PBF glyphs
  (~2–3MB) or find an alternative.

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
