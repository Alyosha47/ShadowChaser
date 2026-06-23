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

Last touched: 2026-06-20 — SOLVED the umbral grazing-tip zigzag: cone-limit splitter
(single-trace closed contours + max-curvature tip detection + horizon-clip to the green line
+ envelope-agreement guard). Validated sub-km across 18 eclipses spanning every type (total,
annular, hybrid, polar grazer, dateline, wide). Recalibrated the Tolerances panel to the
measured numbers (umbra 0.1–2.5 km, penumbra 10–30 km any type, sun lobes 1–7 km, grazers
~1 km). The path-accuracy arc is essentially closed; next field is open.

---

## PRIORITY ORDER (suggested re-entry)
1. Bank state: commit the generator (cone-limit splitter + seed hill-climb + horizon-clip
   longest-run fix + __meta stamp, GEN_VERSION 2026-06-20c), index.html (Tolerances + BUILD
   2026-06-20b + map.js cache-bust), and js/map.js (settings-panel mapclick). Run the full
   regen (every century incl. ANCIENT/BCE) watching umbra interior-turn audits; ancient
   zigzags validated fixed on a BCE-totals sample.
2. Trivial cleanups: map.js bisector comment.
3. Path unification, phased — Phase 1 (umbra splitter) DONE; next is penumbra onto the
   implicit engine (§Path unification).
4. Mobile UX/layout pass (§Mobile). 5. Remaining bugs. 6. UX decisions. 7. Features.

---

## BUGS — open (detail; status in handoff)
- **FIXED 2026-06-20 — ancient/BCE umbral zigzag (root-caused, two stacked bugs).** Kept
  here only as a pointer until the full regen confirms it; delete after. (1) `_cone_seed`
  trusted the catalog greatest-eclipse coordinate as an inside-totality start; high-ΔT ancient
  eclipses put GE hundreds of km off the generator's OWN shadow axis (−1213: ΔT≈7.8h, ~255 km),
  so the seed bailed and the WHOLE ancient range fell to the zigzagging envelope. Fix: hill-
  climb the depth field to the generator's own deepest point. (2) `_cone_clip_horizon` trimmed
  below-horizon points only from the endpoint inward; when the tip apex sits at alt≈0 with the
  N→S join-dip bracketed just inside, the dip survived as a ~58° kink. Fix: keep the longest
  above-horizon run. Validated: −1213 T+A clean (0.4°); modern identical (1773 0.11/0.13);
  7 BCE totals γ −0.87..+0.92 all 0–2°. GEN_VERSION 2026-06-20c.

- **Residual terminus polish (low priority — rare, cosmetic, NOT a regen blocker).** Only the
  grazing hybrid remains: 1986-10-03 (γ=+0.993) traces but the totality corridor is so tiny
  (~22 pts) it renders kinked. Candidate fix: densify the cone trace when a limb returns under
  ~40 pts. Gentle-tip decliners (e.g. −1294T, 2027) fall to the envelope but it is SMOOTH at
  gentle tips (0–1°), so those are harmless, not bugs. The generator's audit pass prints an
  `interior turn` flag on any umbra limb >30°, so residual zigzags self-report during regen.

- **Penumbra threshold offset (low priority — user accepts "close").** Our penumbra limit
  sits ~7–10 km INSIDE Jubier's, asymmetric N/S. At Jubier's penumbra points our magnitude
  reads exactly 0, so their edge is just outside ours. Dropping the cone-narrowing term
  (m = L1 instead of L1 − zeta·tan_f1) fixes the north side but worsens the south — so it is
  NOT a single term. The asymmetry suggests a direction-dependent (refraction/limb) term.
  The implicit-contour penumbra prototype reaches ~9 km (better than the shipped ~15–25 km
  envelope). Pursue only if chasing sub-km everywhere; otherwise the penumbra is "naturally
  fuzzy" and close is fine. Eventually migrate penumbra onto the implicit engine as
  {max magnitude = 0}.

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

- **Safari geolocation fails; installed PWA works.** Locate-pin works in the installed app
  but not in Safari. Check secure-context / permissions / Brave default block vs the code
  path. Related to the locate-pin note above.

- **Slow first load from local-disk server** — minutes vs seconds. Profile what's
  blocking; likely a chunk-fetch pattern.

- **Date label hard to see on map (esp. mobile)** — placement/contrast; previously
  intersected the (now-removed) brightness slider. Reposition.

- **Scan ignores non-location filters** — always scans all 5 centuries regardless of
  other active filters. Pre-existing. (NB: offline this is now harmless noise rather than
  errors — the SW precaches all 50 besselian centuries, so the scan finds every chunk
  offline. The inefficiency of scanning all centuries when filters could narrow it remains.)

---

## REVISIT AFTER LIVING WITH IT (decide once it's been used a while)
- **Umbra ovals: blink-off vs fade.** Currently they blink off at zoom ≥ 7
  (`OVAL_HIDE_ZOOM` in map.js; `visible` prop toggled on the `zoom` event via
  `layer.clone`). Switching to a gradual alpha fade is the same machinery, just more
  `setProps` calls through the fade band — not wasteful, purely a feel preference. Live
  with the blink; switch to fade only if the cutoff feels abrupt. Threshold is a
  one-number change.

## OPEN UX QUESTIONS (deliberation; decide before coding)

- **Mobile map-click microsheet** — with no sidebar on mobile, a map click gives no inline
  "this is what changed." Add a small dismissable bottom-of-map sheet showing at least
  umbral duration for the clicked point.

---

## FEATURES — EASY
- **Instructions note: online/offline is reload-only.** Add a line to the instructions
  explaining the map picks online/offline at load; switching networks needs a page reload.
- **Mobile UX / layout pass (interdependent — one sitting).** (a) Banner + tabs permanent,
  immobile, unscalable on mobile/PWA (pairs with #R5 pinch-zoom — don't scroll away or
  zoom); (b) move tabs to screen BOTTOM on mobile/PWA for thumb reach; (c) single-line
  date/duration bar pinned at the bottom on mobile (overlaps "date label hard to see" +
  the map-click microsheet); (d) map-tab mobile-vs-desktop disambiguation — desktop: map is
  ever-present, the tab is a placeholder for future features; mobile: the tab IS the map →
  different look/behaviour.
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
- Splash / title page for installed-PWA mode; app icon; app logo / eclipse symbol.
- Night-sky-during-totality view — planets/comets/bright stars near the Sun at totality,
  positioned for the selected eclipse.

## FEATURES — HARD
- **Path unification — all curves on one implicit-field engine (architectural vision).**
  Every path = the zero level set of a scalar field evaluated at each ground point's own
  moment of greatest eclipse, traced by one shared predictor–corrector:
    green     = {sun altitude at max = 0}        (DONE — sub-km)
    umbra     = {ever-total depth = 0}           (DONE 2026-06-20 — cone-limit splitter, sub-km)
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
  experimental successor. ~4–6 phased sessions. Order: (1) umbra splitter — DONE; (2)
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
- Thumbnail path map per list row (small SVG) — MOBILE ONLY (not desktop).
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
