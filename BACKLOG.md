# ShadowChaser — Backlog / To-Discuss

Living list. Captured from May 19 handoff + 2026-05-21 session.
Not for action during the current refactor passes.

---

## BUGS

### Known, not yet fixed
- **June 1954 wrong icon** — total eclipse showing as partial in list.
  Investigate `eclipse_type` field in index data and/or `typeIcon()` logic.
- **1950 antimeridian / circumpolar wrapping** — path crosses antimeridian
  and renders incorrectly for both oval shading and umbral path. Likely needs
  improvement in `densifyGeodesic()` or path-rendering logic.
- **Locate pin (📍 top-right of map)** — Brave blocks geolocation by default
  (must allow in brave://settings/content/location). Also `setStatus('Locating…')`
  writes to `#status-msg` which is in the Search tab → no visible feedback when
  on Map tab. No code fix attempted yet.
- **Offline basemap not working on mobile** — separate investigation needed.

### Newly noted (2026-05-21)
- **GE dot skewed** — global maximum dot appears offset from where it should be.
- **Offline map antimeridian artifacts** — weird meridian seams and shading
  patches; some vanish depending on globe rotation.
- **Offline globe partly transparent** — pin click marker shows through the
  globe.
- **Offline circum-south-polar ring** — spurious ring rendered around ~Lusaka
  latitude in offline basemap.
- **Search list starts at 2003 when filter is blank** — should presumably show
  oldest first or current era. Investigate default ordering / pagination.
- **Console error from elevation server on map click when offline** — should
  short-circuit, not attempt the lookup.
- **Offline mode doesn't actually work** — frontloading the basemap only
  succeeds when reachable via local server; true-offline (e.g. phone with no
  signal) leaves no map. Whole offline story needs rethink.
- **Page can still be pinch-zoomed** — thought this was fixed previously.
- **Slow first load from local-disk server** — minutes vs. seconds. Profile
  what's actually blocking; likely a chunk-fetch pattern.
- **Date label hard to see on map (esp. mobile)** — intersects the brightness
  slider; needs different placement or contrast.

### Confirmed pre-existing
- **Scan ignores non-location filters** — always scans all 5 centuries.

---

## BEHAVIORAL CHANGES (decided)

- **Map tap on mobile** = place pin, stay on Map tab. (Desktop keeps current
  behavior — pin + overlay updates immediately since list is visible.)
- **Tab order** = Search · Details · Map · Settings  (reverse of current).
- **Always-selected eclipse** — app loads with the next total selected; user
  changes selection by picking another. Remove the × deselect button and
  tap-selected-list-item-to-deselect. `selectedEntry` is never null after
  initial load. Simplifies state, URL always has `e=`, removes null-branch
  rendering paths.
- **Desktop sidebar layout** — right column with three Photoshop-style tabs:
  Search · Details · Map (overlay controls). Map+details visible together;
  list pulled forward only when actively choosing.
  - Map click switches sidebar to Details only if Search is active.
  - Default sidebar tab on cold load: Details (eclipse is preselected).
  - Selecting an eclipse from the list does NOT auto-switch the sidebar.
    User stays on Search, explores via map, then taps Details/Map when ready.
  - Mobile: unchanged tab structure for now.

---

## OPEN UX QUESTIONS

- Brightness slider — is it useful? If kept, move to Settings tab?
- Global Circumstances / Local Circumstances — table format vs. current
  grid-of-blocks. Save space, or lose the visual variety that helps scanning?
- Accuracy section copy: "umbral errors less than centerline" — verify.
  Centerline error is ~15 m? Confirm and rewrite if wrong.
- **About text unreadable** — different/odd font. Switch to the same font as
  the rest of the app.
- **Date-range copy confusion** — is "1973–present" not already covered by
  "−720 to 2050"? Why list it separately?
- **"Near-term predictions"** — vague. These aren't fuzzy boundaries; just
  show a small table of year ranges with their source/accuracy.
- **Credits asymmetry** — offline basemap is credited, online basemap is not.
  Add online credit (or drop offline credit for consistency).
- **Instructions vs. Search Syntax** — are these meaningfully separate?
  Consider merging into one section.
- **Time zone instruction may be backwards** — verify the wording matches
  actual behaviour, then fix copy or behaviour.

---

## FEATURES — EASY

- Bug report form (mailto link) in About.
- About text additions: "Tuned to iPhone and never tested on Android, let us
  know if you have any suggestions".
- "Total somewhere, partial here" disambiguation in instructions
  (Mag > 99 distinction).
- Banner size — distinguish web mode vs. app mode (currently large in both).
- Make map date more visible on mobile (currently hard to find).
- Tabular formatting for share text.
- **Move eclipse date to overlay in desktop mode.**
- **Dropped pin** — make it a real 3-D-ish pin icon with a shadow instead of
  a flat marker.

---

## FEATURES — MEDIUM

- **Share link encoding** — if eclipse is selected, drop the full search state
  from URL (just `e=` + coords).
- **New eclipse icons** — diamond ring for total, obscuration percentage for
  partial (see screenshot examples from prior session).
- **Intelligent list scrolling** — scroll selected into view.
- **Lat/lon/alt editable** in local circumstances panel.
- **City name search.**
- **Contact icons** — match SE Guide style (see screenshot from 2026-05-21).
- **Splash / title page** for standalone-app (installed PWA) mode.
- **App icon** — design and wire up.
- **Logo / eclipse symbol** for the app itself.
- **Parabolic sun-track diagram** in Details panel, below the data grids.
- **Night-sky-during-totality view** — show planets/comets/bright stars near
  the sun at totality, with positions for the selected eclipse.

---

## FEATURES — HARD

- Thumbnail path map per eclipse in list (small SVG per row).
- Century scroller on mobile right edge.
- PWA / service worker.
- KMZ download.
- Cloud cover overlay.
- Topographic shadow overlay.
- **Animated shadow on globe with time slider** — scrub through the eclipse
  with the umbra/penumbra moving in real time.

---

## PERFORMANCE / DATA

- **Frontload-cache hot range** (e.g. 1900–2100) so common selections are
  instant.
- **Path thumbnails for list rows** — size estimate for 5 centuries of tiny
  scaled flatmap paths? Could be cheap if simplified.
- **Drop or make-optional pre-1000 CE eclipses** — how much load/data does
  that shed? Cost/benefit.

---

## REFACTOR — IN PROGRESS

- **Pass A** ✓ done (2026-05-21) — split inline script into js/ modules.
- **Pass B** ✓ done (2026-05-21) — event-driven AppState.
  - Step 1 ✓ AppState + forwarding shims.
  - Step 2 ✓ URL auto-updates via AppState event; settings accordion fixed.
  - Step 3 ✓ map subsystem event-driven; 9 mapReady guards collapsed to 1.
- **Pass C** — deferred. Loose ends: search input still DOM-driven (not on
  AppState); map.js still 833 lines (split deferred until a bug motivates it);
  similar event wiring possible for list/details. Likely tackled incrementally
  alongside backlog bugs rather than as a dedicated effort.
