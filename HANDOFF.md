# ShadowChaser — Session Handoff

**Last updated:** 2026-05-29, end of long Opus session
**Repo:** github.com/Alyosha47/ShadowChaser
**Current HEAD:** `0f5bb4d` (Pass D cleanup: extract CSS, remove vestigial transparency overrides, --pin-red token)
**Current BUILD constant:** `2026-05-19l` (in index.html `<meta name="build">` and as `?v=` cache-buster on all script/CSS tags)

---

## CRITICAL USER PREFERENCES (read first, violate at peril)

These are repeatedly violated by the assistant and the user is genuinely frustrated by it:

- **Be EXTREMELY CONCISE.** No preambles, postambles, lengthy explanations. "blah" / "blah blah" = stop being verbose.
- **NEVER break working code.** Test before claiming a fix. The user has been gaslit by false "this is fixed" claims.
- **TIDY, CLEAN, CHAFFLESS, PATCHLESS code.** No layered modifiers, no special cases on top of special cases. Replace structures whole, don't add patches.
- **DON'T reflexively backlog things** — push through bugs when possible.
- **DON'T over-engineer.** "The simple boring obvious version" is usually right. NO GYMNASTICS.
- **DON'T make decisions without consulting the user** (e.g. dropping precision, choosing default behavior, fundamental UI choices).
- **ALL time is honest diagnosis time**, not just when invoked. Don't guess in a confident voice; admit uncertainty.
- **Goal: app must work fully offline in the field.** PWA/service worker eventually.
- **Current model: Claude Opus 4.7** (appropriate for design/architecture work, NOT polish/mechanical work — user prefers to hand off to Sonnet for those).
- **Stop telling the user to stop / take a break.** User decides when done. Saying "we've made good progress, want to call it" reads as lazy.
- **When the user shows frustration:** stop, take an actual root-cause fix, don't keep iterating-on-iterations.
- **Don't tell the user "you're right" reflexively** — only when they actually are.
- **When suggesting solutions, recommend ONE** — don't present options as a stalling tactic. Decide and go.
- **If the user pushes back, don't fold immediately** — but also don't dig in. Honestly re-examine.

---

## WHEN TO USE OPUS VS SONNET

The user wants to budget Opus for tasks where it's genuinely better. Recent agreed taxonomy:

**Opus is worth it for:**
- Personal list scoping (schema, storage, UI integration, edge cases)
- Weather overlay scoping (data source, layer rendering, online/offline)
- V-angle math for contact icons (Meeus Ch 14 derivation needs real reasoning)
- Global vs local eclipse-type semantics (UX design with no obvious right answer)
- Anything touching multiple files where architecture matters

**Sonnet handles fine:**
- Antimeridian elegant centering (defined algorithm, ~5 lines)
- Corona irregular+brighter (SVG tweak)
- Misc polish (instruction layout, label renames, contrast nudges)
- The "drop the word sun, use rise/set" change
- The "more contrasty tab tones / chrome strip" change
- Most bug-fix follow-ups in code that's now untangled
- File splitting if ever wanted (mechanical)

---

## REPOSITORY STRUCTURE

```
ShadowChaser/
├── index.html          (~318 lines; HTML only — CSS now external)
├── deck.min.js         (vendor, local)
├── BACKLOG.md          (detailed feature/bug backlog with categories)
├── HANDOFF.md          (this file)
├── css/
│   └── app.css         (~1075 lines, all styles)
└── js/
    ├── cities.js       (lookupCity, lazy-built index from basemapData.cities)
    ├── details.js      (renderData, buildContactRows, contactIcon, lookupElevationAndTz; module-locals: _timeMode, _lastLookupCoords)
    ├── eclipse.js      (computeEclipse, fundamentalArgs, sunAltAz, findMaximum, findContact — strict-mode UMD)
    ├── format.js       (fmt*, fmtUTAnchored, fmtLocalAnchored, eclipseIcon (unified), typeIcon thin wrapper, horizonIcon)
    ├── init.js         (page bootstrap; calls buildTzSelect, initMap, fetch index.json)
    ├── list.js         (renderList, selectEclipse)
    ├── local.js        (computeLocal, computeSunriseSunset, findHorizonCrossing, scanLocation, clearLocationFilter; module-local: _currentRec)
    ├── map.js          (845 lines; deck.gl + MapLibre; many module-level vars for map drawing state)
    ├── search.js       (parseCoords, onSearchChanged, autoGrowSearch [now empty/unused — field-sizing CSS does it])
    ├── search_parser.js (pure parser, UMD-wrapped, strict-mode; parseSearch, applyFilter, filterToString)
    ├── share.js        (share modal)
    ├── state.js        (chunkCache, AppState with get/set/on, forwarding shims to window globals)
    ├── tabs.js         (switchTab, switchSidebarTab, TZ_ZONES)
    ├── tz_lookup.js    (third-party offline timezone lookup, strict-mode, single bundled string)
    └── url.js          (pushState, restoreFromHash, event wiring for search/buttons/keydown)
```

### Script load order (in index.html)
```
maplibre-gl.js (CDN!)       ← OFFLINE GOAL VIOLATION; backlog item
deck.min.js (local)
tz_lookup.js (local)
format.js, state.js, tabs.js, cities.js, search_parser.js, eclipse.js,
search.js, list.js, local.js, details.js, share.js, map.js, url.js, init.js
```

All app scripts use `?v=2026-05-19l` cache-buster. **MapLibre is from unpkg CDN** — breaks offline; needs to become local; backlogged.

---

## CRITICAL OPERATIONAL NOTES

### Deploy chmod issue (HARD-LEARNED, REPEAT-OFFENDER)
- Bluehost (or any shared host) deploy: **files often land at chmod 600 (owner-only). Web server can't read → 403 on every js/css file.**
- Fix on server: `chmod 755` for directories, `chmod 644` for files.
- Symptom: page partly loads (HTML, CDN libs) but app scripts get 403 silently. Mobile shows blank below tabs, nothing reacts.
- Diagnostic check: load `https://your-url/js/search_parser.js` directly in browser. 403 = permissions; 200 with code = fine.

### Cross-origin error masking
- iOS Safari masks CDN-loaded script errors as `error @ ?:?` (blank message, no source) due to CORS.
- When debugging mobile with an on-screen error reporter, filter out `!e.message && !e.filename` to ignore CDN noise and surface real same-origin errors.

### Map-click recently broken and fixed
- Deck.gl's overlay canvas was capturing pointer events before MapLibre could see them.
- **Fix:** after `map.addControl(deckOverlay)` at line ~264 in map.js:
  ```js
  var dc = document.getElementById('deckgl-overlay');
  if (dc) dc.style.pointerEvents = 'none';
  ```
- This is **uncommitted** at handoff time. Needs `git add js/map.js && git commit -m "Fix map-click: disable pointer-events on deck.gl overlay so MapLibre receives the event"`.

---

## CURRENT STATE OF FEATURES (what's working)

### Search system
- Tokenized search with multiple filters: year ranges, months, days, type, magnitude/obscuration, saros, coordinates, cities, today/now.
- Year syntax: `2026`, `2026-2030`, `1994+` (onward), `1994-` (up to), `1994-now`, `after 2100`, `before 500`, `44BC`, `10BCE`.
- Cities: `paris`, `tokyo`, `new york` (longest-match-first, 3-word max). City sets location.
- Map-click clears `filter.city` so city doesn't re-resolve over clicked coords.
- Coords display in field at 5 decimal places (house-accurate, user explicit preference).
- Search field is now a `<textarea>` with `field-sizing: content` CSS (no JS auto-grow needed).

### List
- Defaults centered on today (250 before / 250 after for blank filter).
- Selected eclipse stays selected when search blanked.
- Icons use global eclipse type (not local) — June 1954 case fixed.

### Eclipse icons (the visual identity)
- **Unified function:** `eclipseIcon({type, phase, magnitude, angle, size})` in format.js. ONE function does:
  - List/MAX icons: total = dark moon + corona halo; annular = open orange ring on dark; hybrid = half corona / half ring; partial = orange sun + offset moon (offset scales with magnitude, clamped 0.18–0.92).
  - Contact icons C1/C4: crescent at angle.
  - Contact icons C2/C3: diamond ring with bead at angle (white bead for total, orange for annular).
- 32px icons, viewBox 36, sun radius 9.
- Palette: SUN `#e8a04a`, MOON `#0a0c10`, HALO `#dde3ec`.
- Sunrise/sunset icons: half-disc on horizon + 3 rays; sunset is sunrise flipped vertically via `transform="translate(0,VB) scale(1,-1)"`. Horizon line is sun-yellow.
- `typeIcon` and `contactIcon` are thin wrappers over `eclipseIcon`.

### Contact-times table
- Local time is default; "Local" / "UT" header cell is a clickable toggle.
- Mode persisted in localStorage as `sc.timeMode`.
- Events that fall on a different calendar day than tMax show a small dim superscript: `09:06:48⁺¹` style.
- Sort by raw UT (real chronological order), display anchored to tMax's day.
- Sunrise/sunset picker: rise BEFORE tMax (most recent prior), set AFTER (soonest subsequent), search window ±18h centered on tMaxRel. Fall back to nearest if no event on requested side.
- Three formatters: `fmtUT` (mod-24), `fmtUTAnchored` (with day suffix), `fmtLocal`, `fmtLocalAnchored`.
- `_currentRec` cached in local.js so renderData can rebuild contact rows after pill toggles / URL restore without recomputing.

### Tabs
- Folder convention: active tab matches panel surface, opens into it; inactive tabs are bg2 (recessed).
- Container `.sidebar-tabs` provides the divider line (its `border-bottom`).
- Active tab uses `margin-bottom: -1px` to overlap the divider, with bg matching panel.
- A tab never has its own bottom border.
- **User flag:** could be more contrasty; chrome strip around/above tabs could be more distinct.

### Details panel
- Section sections (`#tab-eclipse`, `#data-panel`) are transparent — inherit sidebar surface, no cascade fights.
- Title shows the unified `eclipseIcon` before the date (no "total"/"annular" text label).
- Title padding: `0.25rem 0 0.5rem` (aligned with panel content edge).
- Share button uses `margin-left: auto` (flex layout).

### Map
- MapLibre globe view + deck.gl overlay for eclipse paths.
- Antimeridian camera patch: paths with lon-span >180° fall back to flyTo GE point instead of fitBounds. **User flagged: not elegant; elegant version pending.**
- Cap lines (umbra paths) shifted by ±360° to take the short path across antimeridian.
- Density of city names + features controlled by zoom level.
- Mobile starts zoomed out (`zoom: 0.6` on narrow viewport).

### State management (AppState)
- `js/state.js` has `AppState` with `get`/`set`/`on` methods.
- Forwarding shims on `window` make every legacy global silently route through AppState — call sites unchanged.
- Keys in AppState: `eclipseIndex, selectedEntry, activeTab, sidebarTab, locationResults, scanCache, scanCancelFlag, currentFilter, localResult, _lookedUpAlt, map, mapReady`.
- **`AppState.on()` exists but is not wired** to any actual subscriptions — manual re-renders still required after state changes.
- **Pass C "tidy" was NOT completed.** `_currentRec` (local.js) and `_timeMode` (details.js) remain module-locals. The user and assistant decided this is fine — moving them gives no functional benefit without wiring subscribers; only do when a real feature demands it.

### Pass D — CSS split
- **Phase 1 DONE (committed):** inline `<style>` block extracted to `css/app.css`. index.html dropped from 1393 to 318 lines.
- **Phase 2 SKIPPED:** further splitting into modules would help dev navigability but adds HTTP requests with no production bundler. User correctly identified this as not warranted.
- Cleanups done in Phase 1:
  - Removed vestigial `#tab-eclipse { background: transparent }` and `#data-panel { background: transparent }` (inherit by default now).
  - Added `--pin-red` token; replaced 4 raw `#cc2200` instances.

### CSS anti-cascade principles (logged in BACKLOG.md under Pass D)
1. **Inherit, don't re-declare.** Set surface colours on containers; children stay `transparent` unless they need their own (clickable header, table row striping).
2. **One token source.** Colours from `--bg/bg2/bg3/gold/...` vars, no raw hex.
3. **No ID selectors for styling.** Use classes for flat predictable specificity.
4. **Split by concern.** (Deferred phase 2.)

---

## COMMITTED HISTORY (recent, newest first)

```
0f5bb4d  Pass D cleanup: extract CSS, remove vestigial transparency overrides, --pin-red token
4b10101  Pass D phase 1: extract inline CSS to css/app.css
b6697fb  Contact-times: local-time default with UT toggle, day-offset display, rise-before/set-after picker, _currentRec cache for re-renders
72f5997  Search textarea with field-sizing; tab tonal hierarchy; transparent detail sections; antimeridian camera patch; backlog updates
49b7fd0  Fix antimeridian camera swing on eclipse select
b5dd0aa  Remove mobile debug probes; cache-bust all scripts; backlog pinch-zoom root cause
e34f631  Unified eclipseIcon, list icon styling, sunrise/sunset, city search, list defaults, June 1954, cap-line wrap
703f9ef  City lookup in search; list defaults; June 1954 icon fix; cap-line wraparound; corridor fill disabled
ad67d85  Contact icons, settings restructure, density rewrite, mobile zoom-out, hybrid icon
1472082  Desktop sidebar layout: 2-column with 4 sub-tabs (Search/Details/Map/Settings)
ba3fb31  Pre-sidebar checkpoint
... (earlier history exists, see git log)
```

## UNCOMMITTED AT HANDOFF
- `js/map.js`: Sonnet's pointer-events fix (3 lines after deck.gl overlay creation).
- `.DS_Store` files (macOS noise, ignore or .gitignore).

---

## OUTSTANDING ITEMS — PRIORITIZED

### Real bugs (functional issues that bite)

1. **Antimeridian camera centering — elegant version.** Current patch (lon-span > 180 → flyTo GE) works but isn't elegant. The right version uses `wrapContinuous` on combined path points, computes min/max in continuous-longitude space, one code path for all paths. ~5 lines. **Test eclipse: Nov 14 2031** (hybrid crossing the Pacific). Sonnet-grade work.

2. **Contact-icon V-angle math is wrong.** Icons render correct phase TYPE (crescent/ring/corona) but rotation doesn't match Jubier's preview. Observed pattern: C1 & C4 horizontally flipped vs Jubier; C2 & C3 vertically flipped. Different axes per phase pair → specific sign/quadrant error in V derivation, not uniform offset. Our P (Besselian position angle) matches Jubier exactly; V = P - q is wrong; q (parallactic angle) needs Meeus Ch 14 derivation. **REMINDER set for Monday June 1** to use remaining weekly compute. Opus-grade work (real math).

   **Diagnostic data from 2026-05-29 attempt** (test case: 2023-04-20 eclipse, observer 8.36°S 127.06°E, Timor):
   - Jubier's truth values: **C1=11.5°, C2=3.1°, C3=9.5°, C4=2.1°**
   - Our output with q = atan2(sin H, cos φ · tan δ − sin φ · cos H) (Meeus 14.1, textbook form):
     **C1=14.87°, C2=88.66°, C3=250.59°, C4=292.54°**
   - C1 is close (~3° off), the others are wildly different. This pattern (one contact close, others way off by non-uniform amounts) is NOT consistent with a simple sign error in q alone. Likely there's also a sign/quadrant problem with P at the inner-cone contacts (C2/C3) and at egress (C4). The direction-to-moon from observer is (-u, -v), not (u, v) — `P = atan2(o.u, o.v)` may be wrong by a sign or contact-specific.
   - Jubier's preview images include a small **red dot** on the Sun — that's the actual contact point on the Sun's limb, the datum V refers to. The grey/yellow moon/sun positions show the overall geometry but the red dot is the V reference.
   - DO NOT guess at sign flips. This needs a careful trace from Meeus Ch 14 with numerical example. Each "obvious" sign flip can fix one contact and break another (see C1-vs-others above).

3. **Polar eclipse rendering — corridor onion-ring bug.** 1950 Sep 12 corridor + ovals render as polar onion rings. Many attempts to fix elegantly broke other eclipses (signedLonWinding, polarCapRing, splitAtAntimeridian, tiled-corridor). Diagnosis: deck.gl's SolidPolygonLayer triangulates polar polygons incorrectly even with clean unwrapped vertex data. Current workaround: corridor fill disabled (path lines only); ovals stay filled. Backlogged with diagnosis and 4 candidate fix approaches. NOT TRIVIAL.

4. **City names fade through earth on globe spin.** Labels aren't depth-tested against globe so they show through the back. MapLibre globe quirk. Real but fiddly.

5. **Pinch-zoom on iOS not blocked.** `user-scalable=no` deliberately ignored by iOS Safari (accessibility, since iOS 10). Fix: `touch-action: pan-y` on scrollable panels but NOT on the map container (map needs pinch). Backlogged with root cause and approach.

6. **Offline mode broken on mobile basemap.** Confirmed; needs investigation.

7. **Offline globe transparency** (pin clicks through to opposite side).

8. **Offline circum-south-polar ring near Lusaka** (specific bug).

9. **Elevation server error on offline map click.**

10. **Contact-times sort bug (possibly residual).** User saw sunset 10:24, sunrise 22:15, C1 23:58 ordering on a UT-day-crossing eclipse. Diagnosed: `fmtUT` mod-24 was hiding day info. **Fixed** by anchored formatters + day-offset suffix + rise-before/set-after picker. May need verification on the specific 2042 eclipse user originally reported.

### Bigger features needing scoping (Opus-grade)

11. **Personal list / "ShadowChaser log".** Track eclipses visited and on wishlist. Needs: schema design, localStorage (or future sync), UI integration with list/details, "been there" vs "want to go" semantics, merge logic with eclipse selection state. Reference image user shared: simple list with icons, dates, types — clean.

12. **Weather overlay.** The killer feature. Forecast cloud cover for near-term eclipses, historical climatology for far-future. Needs: data source choice (weather API + climatology dataset), layer rendering on the globe, online/offline behavior, UI controls, performance. About 2 sessions of design before code.

13. **Animated shadow on globe with time slider.** Scrub through the eclipse with umbra/penumbra moving in real time. The feature most aligned with the app's name (ShadowChaser). Already in BACKLOG.md line 226.

14. **Topographic shadow overlay.** Terrain shadows at observer location (how high moon-shadow falls relative to mountains). BACKLOG.md line 225.

15. **Global vs local eclipse-type semantics in search.** "1960+ total St. Louis" should distinguish "total globally + visible from STL" vs "total as seen FROM STL". 1979 was total globally but partial from STL — currently excluded by `total` filter. Four design options logged in BACKLOG.md OPEN UX QUESTIONS section. Real UX design problem.

### Polish queued (Sonnet-grade unless noted)

16. **Tabs more contrasty + chrome strip more distinct.** User just flagged. The bg2 chrome strip and bg vs bg2 tab tones are too close in value.

17. **"Sunrise" / "Sunset" labels → "Rise" / "Sun" set (drop the redundant "sun" — icons already convey it).**

18. **Corona slightly irregular + brighter.** User asked for this earlier; assistant kept skipping it. Small SVG tweak in `eclipseIcon` for the total/hybrid render.

19. **Search-syntax labels & layout cleanup.** "Coordinates" → "Location" (shorter); decide canonical term for Obscuration/Partiality; 3-col example layout is too wide for narrow sidebar. CAVEAT: both words appear in multiple surfaces (details panel, map popup, share text, parser comments) — decide canonical term first, change everywhere consistently. Logged in OPEN UX QUESTIONS.

20. **Merge Coordinates + City instruction section into one "Location" section.** Proposed copy: "Requires parens" / "Enter manually, tap map to set pin, or use 📍" / examples / note "multi-word cities in brackets". CAVEAT: parser doesn't currently handle bracketed city names — adds parens → coords-parse-fail → try as city. Small code change.

21. **Search-range setting** (in Settings tab). Options: "Modern era (1500–2500)" default / "Past 500 years" / "Past 2 millennia" / "All". Filters eclipseIndex at search time — doesn't reload data. Big perf win (~11,800 entries → ~2,400). Explicit year-range in search auto-overrides.

22. **Move eclipse date to overlay in desktop mode.**

23. **Dropped pin** — real 3-D-ish icon with shadow instead of flat marker.

24. **Banner size** — distinguish web mode vs. app mode.

25. **Make map date more visible on mobile.**

26. **Tabular formatting for share text.**

27. **Prettier share modal/sheet.**

28. **Share link encoding** — if eclipse selected, drop full search state from URL (just `e=` + coords).

29. **Bug report form (mailto link) in About.**

30. **About text additions:** "Tuned to iPhone and never tested on Android, let us know if you have any suggestions".

### Deferred infrastructure

31. **MapLibre from CDN must become local for offline goal.** Critical for field use.

32. **PWA / service worker.** Keystone for offline-in-the-field goal.

33. **Production bundling** (single JS/CSS file). Relevant given offline goal.

34. **Pass C subscription wiring.** AppState.on() exists but no subscribers. Wire up when a feature demands it; don't pre-emptively rewire.

35. **Pass D phase 2** (CSS module split). Mechanical, useful for dev nav, only after a build step exists.

36. **Refactor Pass C — init-time precondition guards remain in pushState, updateMapState, renderData.** Labeled `// init-time only`. Legitimate "no eclipse selected yet" checks; keep them.

37. **map.js is 845 lines, single file.** Could split — low priority.

38. **Locate-pin offline feedback.**

39. **Mobile microsheet on map-click.**

40. **City zoom-into-position cap.**

41. **Slow first load from local-disk server** (minutes vs seconds — profile what's actually blocking).

42. **Local-time toggle on UT header** — **DONE.** (Was queued; landed in commit b6697fb.)

---

## RECURRING ANTI-PATTERNS (FOR FUTURE ASSISTANT)

Things the user has called out repeatedly this session:

1. **"You waste my money."** Reflexive over-engineering on simple tasks. The textarea autogrow saga: dozens of turns of scrollHeight math, rows-incrementing loops, padding calculations, DOMContentLoaded gymnastics. Resolved in one line of CSS: `field-sizing: content`. Look for the platform-native solution before writing code.

2. **"Why do you undo what I asked explicitly to do?"** The tab-tone saga: user said "active lighter, panel lighter to match." Assistant kept retreating to "active dark, panel dark" when complications arose, instead of completing the user's actual instruction. Hold the line on what the user asked for; if complications emerge, address them, don't pivot.

3. **"You are gaslighting me."** False "this is fixed" claims. Don't claim a fix without verification. If you can't verify (no console access), say so explicitly.

4. **Stop suggesting "let's call it for today."** User decides when done. Reads as laziness.

5. **"Patchy patchy I don't like it."** Adding modifiers/special-cases on top of broken structures. Replace whole, don't patch. If a code path needs three guards, the structure is wrong.

6. **"You keep over-complicating."** The boring obvious version first. Always.

7. **"At what point do we do the structural work."** The user wants clean code throughout, but is realistic about when refactoring earns its keep vs. is premature. Pass C subscription wiring is the canonical example: mechanism exists, don't wire it until a feature demands it.

8. **"Is this all OCD-level tidy optimized elegant?"** When the user asks this, do an honest audit and report — both what IS tidy and what ISN'T. Don't reflexively say "yes."

---

## OPEN STYLE/UX QUESTIONS LOGGED FOR DECISION

(In BACKLOG.md under "OPEN UX QUESTIONS" — not yet resolved.)

1. Brightness slider — useful? Move to Settings sub-tab if kept.
2. Circumstances panel density — Global Circumstances is tall.
3. Search-syntax labels (Coordinates/Location, Obscuration/Partiality).
4. Merge Coordinates + City into "Location" section.
5. Global vs local eclipse-type semantics.

---

## TECHNICAL CAVEATS / GOTCHAS

- **The `eclipse_type` field on entries:** first letter is uppercase, drives icon selection. Magnitudes: totals ~1.00-1.08, annulars ~0.85-0.99, partials 0-1.
- **`rec.t0` is TDT decimal hours**, not UT. To convert: `UT = t0 + t - dT/3600`. dT is in seconds.
- **Strict-mode files** (tz_lookup, search_parser, eclipse) are pure modules; can't accidentally create globals via bare assignment.
- **MapLibre globe view ≠ Mercator.** Antimeridian/polar bugs differ. GeoJSON was abandoned (geojson-vt antimeridian + polar issues); now using deck.gl SolidPolygonLayer (different triangulator bugs).
- **`field-sizing: content` CSS** — used for search textarea autogrow. Supported in Chrome/Edge/recent Safari. Older browsers fall back gracefully to single-row.
- **localStorage `sc.timeMode`** — only persisted user setting currently. More to come (search-range setting, personal list, etc.).
- **`window.matchMedia('(min-width: 900px)')`** — used in map.js to choose initial zoom (desktop 2, mobile 0.6).

---

## IMMEDIATE NEXT STEP

Commit Sonnet's map-click fix:
```
git add js/map.js
git commit -m "Fix map-click: disable pointer-events on deck.gl overlay so MapLibre receives the event"
git push
```

Then user picks the next direction. Recent ask list (newest first):

- Add to UI-easy backlog: drop "Sun" prefix, use "rise"/"set"; more contrasty tab tones + chrome strip.
- Verify antimeridian eclipse demo (Nov 14 2031).
- Honor shadow-mapping items already in backlog (animated shadow on globe, topographic shadow).

User-stated big-picture goal: "readable, comprehensible, not over-engineered, elegant, tidy, and genius."
