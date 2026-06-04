# ShadowChaser — Session Handoff — 2026-05-31 (standalone, authoritative)

> ## ▶ START HERE (next session)
> **State:** all work below is DONE and VERIFIED. The **service worker / PWA is now built
> and working** (offline shell + globe + eclipse data, verified offline in a clean
> Incognito window) — see §"SERVICE WORKER / PWA — DONE" at the bottom for exactly how it
> works and how to test it. As of this writing it is **tested on the local server but NOT
> yet committed/pushed** — confirm the working tree is committed (the §DEPLOY CHECKLIST
> commit block) and do the real-device airplane-mode test before treating it as deployed.
> **The single next task is: a real-device offline field test** (phone, airplane mode,
> relaunch → globe + present-day eclipse with no signal). After that passes, the offline
> foundation is genuinely complete and the frontier is feature scoping (#F2 cloud-cover is
> the killer feature — USER's call, ~2 sessions of design first). See §"AFTER — the frontier".
> **Before writing code:** skim §CRITICAL USER PREFERENCES and §RECURRING ANTI-PATTERNS —
> they are the difference between a good session and a frustrating one.

**Last updated:** 2026-05-31 (later session, Opus 4.8) — built the service worker / PWA
(offline app shell, manifest, provisional icons), fixed `isOffline()` to honor the
connectivity probe (was trusting `navigator.onLine`, which lies offline). Prior same-day
session: offline-globe fixes, V-angle math, far-side markers, oval blink-off, vendoring.
**Repo:** github.com/Alyosha47/ShadowChaser
**This document is complete and self-contained.** It supersedes all prior `HANDOFF*.md`
files (the dated ones in repo root — `HANDOFF-2026_05_18b.md`, `HANDOFF-2026_05_19.md` —
are stale and can be archived/deleted).
**BUILD cache-buster:** lives in `index.html` as `var BUILD = '...'` (currently
`2026-05-31a`) and is appended as `?v=BUILD` to every `js/*` and `data/*` fetch. **Bump it
on every deploy** (convention: `YYYY-MM-DD` + letter). If a fix "doesn't appear," 90% of
the time BUILD wasn't bumped or the browser wasn't hard-refreshed. NB vendored libs in
`vendor/` deliberately carry NO `?v=` — their version is in the filename.

**Document map (two files, one job each — do not duplicate):** THIS handoff owns *current
status* — what changed, what's deployed, how things work, what's closed, what's next; it
is dated and rewritten each session. **`BACKLOG.md`** owns *durable detail* — open bugs'
candidate fixes, UX-question deliberations, the feature idea-pool, perf/data notes, and
the refactor ledger; it accretes and is pruned, never restates status. When this handoff
says "candidates in BACKLOG.md," the detail is there. When an item is fixed, it is deleted
from BACKLOG.md (the handoff records the closure) — no "DONE" tombstones in the backlog.

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
├── BACKLOG.md          (durable detail — bugs' candidate fixes, UX questions, features)
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
│   └── besselian/      (per-century eclipse element records, e.g. 2001_2100.json)
├── data build tools/   (dev scratch — index good.html, test1999.html still ref unpkg;
│                        NOT shipped, ignore for the offline goal)
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
- **Open choice (BACKLOG → "REVISIT AFTER LIVING WITH IT"):** blink vs gradual fade. Fade
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

### Real bugs still open
- The desktop real-bug tier is **clear.** #R1 (below) was reclassified to polish.
- **#R3 Polar eclipse corridor "onion-ring" (deck.gl).** 1950-09-12 corridor + ovals
  render as polar onion rings. deck.gl SolidPolygonLayer mis-triangulates polar polygons
  even with clean unwrapped data. Current workaround: corridor fill DISABLED (path lines
  only); ovals still filled. 4 candidate approaches in BACKLOG.md. NOT trivial. (Related:
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
  4 options in BACKLOG.md.

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

## OPEN STYLE/UX QUESTIONS (in BACKLOG.md "OPEN UX QUESTIONS")

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
git add index.html sw.js manifest.webmanifest map.js js/map.js \
        icons/icon-192.png icons/icon-512.png HANDOFF.md BACKLOG.md
git commit -m "Service worker + PWA: offline shell, globe & 1900–2100 eclipse data; isOffline probe fix"
git push
```
(`map.js` lives at `js/map.js` — adjust the path to match your tree; `favicon.ico` already
tracked.)

---

## ▶ SERVICE WORKER / PWA — DONE (2026-05-31)

**What it does:** a true offline (no-signal) reload now loads the app from Cache Storage
instead of the browser's offline dinosaur. Verified offline (DevTools → Offline, Incognito):
globe renders, present-day eclipse draws, map-click gives local circumstances, per-century
scan works — no crashes.

**Files:** `sw.js` (repo root), `manifest.webmanifest` (root), `icons/icon-192.png` +
`icons/icon-512.png` (provisional total-eclipse glyph — replace with final art later),
registration + `<link rel="manifest">` + `theme-color` in `index.html`.

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
- **CORE (atomic `addAll`):** index.html, favicon, css, all js, vendor, the 6 *used* fonts,
  basemap `*.gz`, and `data/index.json`. Essential shell — if any fail, install fails.
- **DATA (best-effort loop):** ALL 50 besselian centuries (~9.5MB, cheap — makes scan +
  local circumstances work offline for any era) + paths for **1900–2100 only**
  (`paths_1901_2000`, `paths_2001_2100`; paths are ~6MB/century, ~274MB for the full set).
  A flaky file here can't wipe the shell; anything outside the range is cached on demand
  when viewed online. (User's decision: this + last century, for birthdays etc.)
- **Fetch:** non-GET and all cross-origin (raster tiles, `generate_204` probe, elevation
  API) pass straight through, untouched. Navigations serve cached `index.html`. Same-origin
  GETs are cache-first (ignoreSearch) then cache-on-demand; offline misses return a quiet
  504 instead of throwing.

**The one expected console line offline:** a single `generate_204` ERR at startup — that
IS the connectivity detector doing its job (an unfailing probe can't detect failure). It
fires once; map re-init while offline skips it. Per-click elevation errors were a separate
bug, fixed via `isOffline()` (see §Connectivity).

**Blob-worker/CSP:** no CSP was added, so MapLibre's inline `blob:` worker is unaffected.
If a CSP is ever added, it must allow `worker-src blob:` and `script-src blob:`.

**The painful lesson (don't repeat):** most of the session's pain was *worker update
flakiness during dev*, not the code. Symptoms (old log format persisting, error stuck at a
line number, cache empty after manual deletion) all meant the old worker was still running.
Deleting a cache by hand does NOT re-trigger `install`. The reliable clean room is a fresh
Incognito window; the reliable diagnostic is the install log line
(`[SW] shadowchaser-<BUILD>: shell + 52/52 field-data cached`).

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
