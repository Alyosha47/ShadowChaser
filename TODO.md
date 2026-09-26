# followtheshadow — TODO

The open task list. **`HANDOFF.md` owns knowledge and status; this file owns what is still to do.**
- Done → delete it here, record it in HANDOFF's change log. No tombstones.
- No third document.
- Priorities are the user's to set; the order below is a suggestion.

Last rewritten 2026-09-22 against commit `2227720` (BUILD `2026-09-22a`); tidied 2026-09-25 (live BUILD `2026-09-25n`).

---

## 1. Suggested order

1. **The public repo (§2)** — it is public now, with files §8 says must not be published.
2. **Launch blockers:** the Safari-wedge watch (§3); the licence items left in §1b are not blockers.
3. **#F4 "Cache this spot"** — offline for field use. §6.
4. **True-colour Himawari for Photo** (§4.2) — pays off for 2028 (Australia), not 2027.
5. Bugs (§3), then features (§6).
- **#F2b cloud forecast (§5): SHELVED by the user 2026-09-25.**

---

## 1b. Licence terms (checked 2026-09-25; details in HANDOFF §7.5 and the 25n change log)

- **OpenStreetMap (Street, and the terrain shadow's water mask): allowed as used.** Credit shown,
  normal viewing only. **Never offline/prefetch** — #F4 must not cache OSM tiles.
- **Esri (Topo zoomed out, Sat, Street's backup): no account, which Esri's terms want. MANAGED, not
  solved** — the watchdog switches to stand-ins and emails the owner if Esri refuses us. The full fix,
  if ever wanted: a free ArcGIS Location Platform key (2M basemap tiles/month free, then pay-per-use;
  restrict it to the domain; renew at least yearly; different tile URLs, ~1 h of work).
- **OpenTopoMap (Topo close in): UNCHECKED.** The user is comfortable leaving it for now.
- **Sentinel-2 cloudless 2017 (Sat stand-in): CC BY 4.0, credited.** Fine.
- **Open-Meteo elevation fallback.** Free API is non-commercial; if the site becomes commercial (ads,
  donations, sales) it needs a paid plan. So would OSM's goodwill (their policy warns donation-seeking
  services that access may be withdrawn).
- **EUMETSAT near-real-time — PARKED by the user (2026-09-25).** Not expected to be an issue; if EUMETSAT
  ever raises it, answer then, or drop the live cloud modes (useful about one day a year). Note it covers
  BOTH `Now` and `Pic` — both show minutes-old Meteosat frames via `sat.php`.

---

## 2. Chores — yours

- **THE GITHUB REPO IS PUBLIC — decide what to do (found 2026-09-25).** Anyone can clone it (verified
  anonymously; GitHub reports `visibility: public`). It contains what §8 says must NOT be published:
  Jubier's 53 reference KMZs (`reference kmz/`), `.nova/` (reveals the hosting account path), and
  `followtheshadow-log-20260922.json` (may hold personal locations). The simplest step is making it
  private in GitHub's settings (Settings → General → Danger Zone → Change visibility); §8's plan then
  holds as written. Removing files alone does not help — they stay in the history.
- **Commit the 25k–25n files** (`index.html`, `js/map.js`, `report.php`) — the repo is behind live.
  `report.php` sends to `app@followtheshadow.com`, already public on the About page, so it commits as-is.

---

## 3. Bugs
- **iOS home-screen app in landscape — check once.** The bottom-strip fix (status bar `default`,
  HANDOFF change log 25l) was verified in portrait only.
- **iOS Safari wedged after a deploy (2026-09-23) — WATCH; blocks launch only if it recurs.** After a
  day of seven BUILD bumps (22b → 23e), the user's iPhone (Safari) showed a white page with the progress
  bar stuck at ~40% for 5+ minutes; the globe never appeared. Deleting the site's data (Settings →
  Safari → Advanced → Website Data) fixed it at once, so it was stored state, not the current files.
  Server normal throughout (0.1–0.4 s); Chromium emulating an iPhone loaded the same build fine three
  times. Possibly an artefact of rapid-fire deploys (updates overlapping while ~20 MB of offline data
  was still downloading). **Passes so far: 1** (25k, 2026-09-25, no freeze). **Test in normal use:** after each ordinary single deploy, open the site on
  the iPhone. Fine across a few → low priority. Stalls after ONE deploy → real, blocks launch, and needs
  Safari's own view (desktop Safari or the iPhone on a Mac's Web Inspector).
- **Slow first load from a local-disk server** — minutes, against seconds live. Profile the local case
  specifically; do not assume it shares a cause with anything else.

---

## 4. Live cloud (`Now` / `Photo`)

### 4.1 Load and caching
- **Server-built reference: SHIPPED and live-confirmed 2026-09-23 (BUILD 23e, HANDOFF §10A.4).**
  Open: how a cold first load now feels on the phone (user's impression is enough).
- **Solved but unapplied:** `compose()` row mapping by latitude (~8 lines; byte-identical on today's
  path). Only useful once the fetch box is snapped to a grid, which makes repeat views cacheable.
- **Dead end — do not retry:** rounding background timestamps. Over desert at dawn a 30-min shift takes
  cloud 39% → 70%. Ocean hides it.

### 4.2 A non-GIBS source — CIRA SLIDER measured 2026-09-25
Freshness gain is small; the reason to do it is **true-colour Himawari for Photo** (closes the
greyscale band, 70–153°E). No gain over Europe/Africa (already Meteosat), so none for 2027.
Measured:
- Reachable from the container, 0.2–0.4 s. `rammb-slider…` 302s to `slider.cira.colostate.edu`.
- Latest list: `/data/json/{sat}/full_disk/geocolor/latest_times.json` (`timestamps_int`, newest first).
- Tiles: `/data/imagery/YYYY/MM/DD/{sat}---full_disk/geocolor/{YYYYMMDDhhmmss}/{zz}/{rrr}_{ccc}.png`
  (sats `himawari`, `goes-19`, `goes-18`). PNG, 688 px (Himawari), zoom 00–04 (05 → 404). Satellite
  fixed-grid projection → **reprojection job**.
- **No CORS header** → must go through `sat.php`.
- **Latency is NOT ~5 min:** newest full disk was 23 min old (GOES) and 33 min (Himawari).
- GOES GeoColor confirmed colour; Himawari was at night when tested — **re-check colour by day**
  (after ~00 UTC) before building.
- `www.accuweather.com` (allowlisted) not yet looked at.

### 4.3 Remaining, lower
- **Detection is ~49% of cloud (30–41% over sea), cause unknown.** Visible band and SST reference are
  both measured dead ends (HANDOFF §10A.8). Start from the three measured facts there, not a theory.
  Any fix must ADD cloud, never gate.
- **Speckle at high zoom** — 39 km reference under 4 km imagery. `BG_W` 2048 is the low-risk half
  (~46 MB); a zoom-following grid is the risky thorough fix (must key the cache on the box).
- **Parked: nothing above 65°N.** Polar orbiters tested; the method doesn't transfer (HANDOFF §10A.8b).
  Untested route: `VIIRS_*_Cloud_Top_Height_*` / `MODIS_*_Cloud_Top_Temp_*` — a second detector, its own
  feature.

---

## 5. #F2b Cloud forecast — SHELVED by the user 2026-09-25 (scope below kept for when it returns)

- **Shape (agreed 2026-09-13):** a third cell on the `Average | Now` strip, live only within ~a week of
  the eclipse. Recolours the **corridor only**, each point at **its own local maximum**. Details panel
  swaps climatology for forecast at that spot. Headline: **the clearest point on the path within a few
  hours' drive, and how far.**
- **Do not build** a single-location forecast readout — every weather app does it better.
- **Quota:** sample the corridor (~300 points), not the bounding box. Open-Meteo is 10,000/day
  **per user IP** (calls run in the browser) and charges at least one call per location.
- **First job:** curl `api.open-meteo.com` from the container. Then answer: (1) does the free tier allow
  a public site like this? (can kill the feature); (2) does a multi-location request still charge per
  location?
- `js/forecast.js` and its test were lost (never committed).
- This is the trigger to promote connectivity out of `map.js` into its own module (§8).

---

## 6. Features

### Medium
- **#F4 "Cache this spot" — offline tiles round the pin.** **Must not cache OpenStreetMap tiles**
  (their policy forbids offline/prefetch), so Street needs a source whose terms allow offline
  caching — not yet identified; Esri's terms on this are unchecked. Decided: **10 km radius, max z15**
  (~19 MB at the equator, ~56 MB at 57°; tile count scales as 1/cos²φ). Terrain adds ~4 MB.
  **Blocker: `sw.js` passes all cross-origin requests straight through**, and every basemap and DEM tile
  is cross-origin, so nothing cached would be served. That line is also what keeps the SW away from
  live tiles — the replacement branch needs care and its own test. Then: bbox → tile list; fetch into a
  named cache reusing `precache()`; cancellable progress; per-area "cached · 34 MB · delete".
- **Compass in the sky tracker.** The user has ideas — discuss before coding.
- **Server-side share page** (`followtheshadow.com/share?e=…`). The only way past plain-text
  `navigator.share`/`mailto`: styled output and a map image. What the user wants from share is
  **styling and format**, not more content.
- **Second "travel this way" arrow** — direction to the centreline (shortest hop to totality), distinct
  from the sun arrow. Design first.
- **Mobile list-row path thumbnails** (small SVG, mobile only). Check feasibility and size first.
- **Century scroller** on the mobile right edge.
- **Faster About-link eclipses.** Paths are now computed on the device; if the old-era About links still
  wait, add their entries to `warmPaths()`. Check whether they wait first.
- **KMZ, optional:** dots across the umbra width (`KMZ_DOT_KM` is a constant); dark outline under lines
  (KML has no stroke outline → draw each curve twice).

### Hard
- **Greatest duration for all ~11,900 eclipses.** GE ≠ longest totality (median +0.07 s, max +49.8 s and
  10,686 km away). The astronomy is solved; the hard part is a trustworthy global search along the ridge.
  **Handoff: `ON HOLD/GREATEST-DURATION.md` — read it first.** Decide storage (~400 KB on `index.json`,
  or in the besselian chunks). Spot-check 2017-08-21 and 2024-04-08 against published values first.
- **#F6b precomputed horizon field** (terrain visibility at path scale). Per ~1 km cell, the terrain
  horizon altitude at ~16 bearings, ray-cast offline from a 30 m DEM; at runtime
  `blocked = sun.alt < horizon(cell, sun.az)`. Works at every zoom and offline, and gives a number the
  score can use. **First task: size it** — build one region, prove it, then decide on global. Store the
  BEST horizon per cell. Limits: ground-level, fixed observer.

### #F6 favorability — complete; deliberate leftovers
- **Tidy pass, offered, not taken.** `_lastD` is a side channel (`_raw()` writes it, `_draw()` reads it);
  nine tuning constants with undocumented interactions. No behaviour change; the suite holds it still.
- **Weights 0.60/0.40 are calibrated — leave them.** Raising cloud scores worse (HANDOFF). `P_A` (sun
  altitude, 0.35) is NOT calibrated — first knob if altitude ever feels wrong. Three more forced-choice
  pairs would settle pairs #2 vs #6.
- The terrain veto is one instant per viewport (8 min spread at z6, 30 s at z10). Fine for now.

---

## 7. Design decisions needed · polish

**Needs a decision before code**
- **Search: open-ended backward ranges** (`1999-`, `now-`) list from the catalogue's start and bury the
  anchor. **Constraint: the list always reads the same direction.** Options: (a) auto-scroll to the
  anchor; (b) bound the open end to a window; (c) drop the bare trailing-dash form; (d) show "first N of
  M" with paging. Low priority.
- **Thunderforest / Stadia / Mapbox basemaps need an API key**, which a static PWA exposes. Acceptable?

**Polish (Sonnet-grade)**
- **Search clear (×) should refocus the search box.** The only reason to clear it is to type
  something else, so the keyboard/cursor should be ready straight away.
- **Favorability box on mobile: remove the text.** Keep only the buttons and the scale.
- Merge "Coordinates" + "City" into one "Location" section (the parser can't yet take bracketed
  multi-word cities).
- Eclipse date: overlay on desktop, more visible on mobile.
- Distinct banner size for web vs installed app.
- Global Circumstances panel is tall.
- App logo / eclipse symbol (the banner mark was removed 2026-08-23; HANDOFF §11.7 says how to rebuild).
- **Raster sharpness:** NE2 is soft close in. The answer is a tile pyramid, not a bigger image (GPU
  memory). Only if it bothers you in the field.

---

## 8. Infrastructure · refactor

- **Offline city labels** — MapLibre symbol layers need PBF glyphs; bundling Noto Sans is ~2–3 MB.
  Offline is dots-only today.
- **Open source, after launch (user's decision 2026-09-25: "the work must remain free for all").**
  - **Licence:** code AGPL-3.0 (a modified version run as a website must publish its source too; MIT
    lets it be closed, plain GPL does not cover websites). Our own derived data (country lists, cloud
    climatology, reference files we generate) CC BY-SA 4.0. Third-party parts keep their licences
    (MapLibre BSD-3, deck.gl MIT, tz-lookup CC0 + ODbL boundaries, fonts OFL; Copernicus notice kept).
  - **Must NOT be published:** Xavier Jubier's 53 reference KMZs (his work; link to his site instead);
    `.nova/` (reveals the hosting account path); check `files.zip` and `shadowchaser-log-*.json`
    (may hold personal locations). A scan on 2026-09-25 found no keys, passwords or tokens.
  - **History:** start the public repo FRESH from the tidied tree; keep this repo private as the full
    record (rewriting history would otherwise be needed to drop the files above).
  - **File banner:** a comment block at the top of every source file — a followtheshadow ASCII
    drawing plus a credit line (and the licence line). The user wants help drawing it; design it first,
    then apply by script to each file type's comment syntax (JS/CSS /* */, HTML <!-- -->, Python #, PHP).
  - The archived Cesium branch's ion token must be restricted or rotated before that branch is ever
    published (or leave the branch out).
- **Shrink git history** of the old `data/paths/` (~274 MB) — destructive `git filter-repo` + force-push.
- **Production bundling** (single JS/CSS) — optimisation, not a blocker.
- **Refactor, when a feature motivates it:**
  - Init-time early-returns exist because events fire before `selectNextEclipse` completes.
  - Search input is still DOM-driven, not on AppState.
  - `map.js` is large; its war-story comments could be condensed.
  - `url.js` is two jobs in one file: event wiring + URL state (HANDOFF §11.10). The GPS-locate and
    map-click handlers duplicate post-location logic.
  - Connectivity lives in `map.js`; promote it when #F2b lands, not before.

---

## 9. Decided against — do not re-propose

Re-open only if the stated reason changes.
- **#F3 animated umbra with time slider** — a demo, not a tool.
- **Terrain-shadow row in the Details panel** — an honest version needs its own DEM probe; the user
  doesn't want it there. The Favorability tooltip already says terrain isn't counted.
- **Star updating a saved location** — the star is a plain save/remove toggle; the Log pencil sets
  locations.
- **Fading the polar ice caps with the relief** — built, unobservable, reverted.
- **Splitting partials into separate files** — ~1% payload saving for real confusion.
- **Filtering scan chunks by non-location filters** — unmeasurable win, silent-wrong-answer risk.
- **Rounding `Now` background timestamps** — measured to destroy the reading (§4.1).
- **#F7 switching climatology to CLARA-A3** — ERA5 is only ~5 points off Anderson's published numbers,
  mixed sign; CLARA has no time of day, and the diurnal swing (Burgos 17 points) matters more.
