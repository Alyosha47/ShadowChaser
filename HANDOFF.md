# followtheshadow — HANDOFF

Single authoritative status + knowledge document. **Organised by TOPIC, one home per fact.**
`TODO.md` owns the open task list; this file owns status, architecture, derivations and lessons.
Do not duplicate between them.

**Repo:** github.com/Alyosha47/ShadowChaser — active branch **`maplibre`**.
**Site:** followtheshadow.com/app

> ### THE FILING RULE — read before adding to this file
> This document was restructured on 2026-08-12 because it had grown two filing systems at once:
> topical sections (1–12) plus a session log (13–17). Every durable fact ended up with two homes,
> and the two drifted. §10.3 declared the contact-angle maths "CLOSED, do not re-litigate" while
> §16.1 recorded it as wrong; §8.4 and §16.3 each described half of marker occlusion. A whole
> session's knowledge (§16) was declared lost when it was sitting in a commit.
>
> **So: a session does not get a section.** When work lands, fold it into the topical section that
> owns that subject — correcting or replacing what is there — and add one dated line to the CHANGE
> LOG at the end. If you catch yourself writing "supersedes §X", stop and edit §X instead.

---

## 1. WHAT THIS PROJECT IS

An **offline-capable eclipse-path PWA**. A Python generator computes shadow-path JSON from
Besselian elements for ~11,898 eclipses; a vanilla-JS frontend renders them on a MapLibre globe
with deck.gl geometry.

**Non-negotiable standard: ships only when every case is correct vs Xavier Jubier's KMZ ground
truth.**

User's goal: *"readable, comprehensible, not over-engineered, elegant, tidy, and genius"* — and it
must work fully offline in the field.

---

## 2. HOW TO WORK WITH THIS USER (load-bearing)

- **BE EXTREMELY CONCISE.** Reference docs like this are the exception; chat is not.
- **ONE step at a time.** Don't pile up instructions or interleave threads of work.
- **NEVER break working code.** `node -c` proves syntax, not behaviour.
- **NEVER GUESS. Verify.** Read the repo/library/API. If you can't verify, say so. *(Corollary
  earned 2026-08-12: before declaring anything lost, look in git.)*
- **Don't solve problems by throwing away solutions.** Never quit; root-cause it.
- **TIDY, CHAFFLESS, PATCHLESS code.** Replace structures whole. Three guards on a path = the
  structure is wrong.
- **DON'T over-engineer.** The simple boring obvious version is usually right. Look for the
  platform-native solution before writing code.
- **Recommend ONE solution.** Don't present menus as a stalling tactic — but don't make
  UI/default/precision decisions unilaterally either.
- **Don't say "you're right" reflexively.** If the user pushes back, honestly re-examine — don't
  fold instantly, don't dig in.
- **When asked "is this OCD-tidy/elegant?"** — honest audit, both sides, never reflexive yes.
- **Never assume he's tired. Never suggest stopping.** The user decides when done.
- Never do Mac-side debugging of the iPhone (settled; don't re-raise).
- **He uses git** — branches, commits and pushes from the command line. He still prefers receiving
  **finished files** ready to drop into their folders.

### The standing rule (earned expensively)
**Before writing per-frame code or geometry tricks to fake a visual effect, NAME the library API
that should do it. If you can't name one, say so out loud rather than hacking silently.**
Proofs: the land fill was floated as a primitive *over* the globe (→ clamp-to-ground → iOS crash)
when the answer was **imagery**; eclipse paths were *lifted* to win a depth fight when the answer
was **`depthFailMaterial`**; a hand-rolled 90° horizon test when MapLibre shipped
`isLocationOccluded` (§7.4).
**Corollary — beware "safety rails":** constants added as harmless guards became the DOMINANT term
twice (a 2 km arrow floor at street zoom; a screen floor overriding a ground cap). If two limits can
fight, decide which must win and check the arithmetic at BOTH extremes.

### Validation rules (each earned by a real failure)
- **One test site is not validation.** A formula with a folded constant must be checked where that
  constant is *not* accidentally correct. The contact-angle bug (§9.3) survived a "CLOSED" verdict
  for months because the only validation site had the Sun near the zenith, where the wrong form and
  the right one agree.
- **Validate by running the real pipeline**, not by feeding published numbers into a formula by
  hand. A mid-session spot-check that did the latter looked 175° wrong; the bug was in the check.
- **When debugging something visual, LOOK at it.** Rasterise and render. Days were lost on the
  poster measuring polygon area and quad widths — proxies that moved while the picture stayed wrong.

### Recurring anti-patterns (user's own words)
1. *"You waste my money."* — reflexive over-engineering on simple tasks (the textarea-autogrow saga,
   resolved by one line of CSS). Platform-native first.
2. *"Why undo what I asked explicitly?"* — address the complication, don't pivot away.
3. *"You are gaslighting me."* — no false "fixed" claims.
4. *"Let's call it for today."* — never say it.
5. *"Patchy patchy I don't like it."* — replace whole.
6. *"You keep over-complicating."*
7. *"At what point do we do structural work?"* — refactor when it earns its keep, not pre-emptively.

### Opus vs Sonnet
**Opus:** feature scoping, multi-file architecture, UX with no obvious right answer, hard math.
**Sonnet:** SVG/CSS polish, label renames, contrast nudges, mechanical file splitting, most bug-fix
follow-ups in the now-untangled code.

### Assistant's clone caveat
The assistant works in a fresh throwaway `git clone` each session. It does **not** reflect the
user's local state or BUILD. **Never trust the assistant's clone for `git log` / BUILD / commit
state.** The user's working copy is authoritative — but the *remote* is authoritative for history,
and is where a lost session goes to be found.

---

## 3. STATUS — WHAT IS OPEN

Everything not listed here is done and covered in its topical section.

### Housekeeping, one command each

### Open bugs
- **#R5 pinch-zoom on iOS not blocked** — `user-scalable=no` is ignored by iOS Safari. Fix:
  `touch-action: pan-y` on scrollable panels but NOT the map container. Needs a real iPhone to
  confirm, so it is the user's to verify. **The only open bug on the list.**
- **`tools/checks/test_tshirt.js` fails exactly 3 catalogue-wide assertions** — one band over 8% of
  the map, some bands extended past their limbs without cause, some centrelines drawn where the band
  doesn't reach. All in the polar tail; date from the polar work and were never resolved (§11.4).
- **Ross Ice Shelf seam (Antarctica)** — a cut from the coast to the pole and back. Ruled out as a
  stroke problem: the Antarctic ring has 8 points, 6 at lat −89.999, cut at lon −180, and both of
  `seamFreeLines`' tests should already catch it. So it is very likely the globe-projection **fill**,
  which `seamFreeLines` explicitly leaves alone. Different mechanism, real work. User can live with
  it.
- **Umbral grazing-tip zigzag** — root-caused and a fix proven, blocked on one sub-problem (§9.5).

### Chaff — CLEARED 2026-08-12
Nothing outstanding. Cleared this session: `js/map_works.js` (a 1,756-line hand-kept backup of
`map.js`, committed in `e1eb7f6`) — the duplicate-file trap that cost a session on the generator and
one on 1957; git is the backup.

*Cleared earlier, confirmed absent on a fresh clone — do not go looking:* `data/basemap/ne2.jpg`,
`data/basemap/ocean.geojson.gz`, `vendor/shademap.umd.min.js`,
`data/paths/paths_1501_1600_kinked.json.gz`, and the whole `spikes/` directory.

**`.gitignore` must keep `vendor/cesium-1.121/`. Do not remove it.** Cesium is out of `sw.js` and out
of the repo, but the folder is still in the user's WORKING COPY — drop the line and `git add -A`
offers to push the entire library. *(This file once called that line "harmless residue"; the user
acted on it and hit exactly that. Verify against the working copy, not the repo, before calling any
ignore rule obsolete.)*

### Unverified / unresolved
- **`addPin` gap.** The Cesium renderer exposed `addPin`; the MapLibre renderer does not — confirmed,
  no occurrence anywhere in `js/`. Never investigated: it is not known whether anything wants it.
- **The dead `MAP_JS_BUILD` guard.** `index.html` (~line 624) tests `window.MAP_JS_BUILD` to warn
  about a stale `map.js`, but nothing sets it, so the warning can never fire. Still present. Harmless
  — but `test_hygiene.js`'s build-stamp check now does this job properly, so it is deletable.
- **Cesium ion token.** No token pattern matches anywhere on the `maplibre` branch (`spikes/`, where
  it supposedly lived, is gone). But Cesium still exists in the user's working copy and the `cesium`
  branch is untested — before that branch is ever published, restrict the token to
  `followtheshadow.com` in the ion console, or rotate it.
- **`data/basemap/states.geojson.gz`** is precached in `sw.js` (CORE) but `map.js` never references
  it. Either a layer was dropped and the precache entry left behind, or it is pending use. Worth one
  look before the next `sw.js` change.

### Not done, by choice — in rough priority order
1. **Scan ignores non-location filters.** Filter by date/type BEFORE loading chunks instead of
   walking ~30 of them on every first scan. No user-visible change, no data restructuring.
2. **Forecast half of #F2** — near-term, online, one eclipse. The climatology half shipped.
3. **Cloud indicators in the details panel** — depends on `Cloud.sampleAt` (§10.7).
4. **Search by country.** Requested 2026-08-13, not yet scoped. The pieces exist —
   `countries.geojson.gz` is already precached, and `search_parser.js` already does
   longest-match-first multi-word matching for cities — so it is plausible rather than easy. The real
   question is semantics, and it is the same one #F5 asks: "total eclipses in Chile" means the path
   crossed the country, which is a polygon test against path geometry, not a point lookup like a
   city. Decide that before writing anything.
5. **Greatest duration for all ~11,900 eclipses.** GE ≠ greatest duration even for ordinary eclipses
   (median +0.07 s, max +49.8 s and 10,686 km away). Needs a trustworthy global search, not the hill
   climb used for the 94 non-central ones. Full handoff in **`GREATEST-DURATION.md`** (repo root) —
   read it before starting.
6. **#F3 animated shadow with time slider** — scrub umbra/penumbra in real time; most on-brand.
7. **#F5 global-vs-local eclipse-type search semantics** — "1960+ total St. Louis": total globally +
   visible, vs total AS SEEN from STL. Four options in TODO. Settle this and #4 together.
8. **Duplicate downloads** (§12.4) — measured, harmless, has a known real fix.

### Polish queued (Sonnet-grade)
Merge "Coordinates" + "City" into one "Location" section (caveat: the parser doesn't handle
bracketed multi-word cities yet); move the eclipse date to an overlay on desktop and make it more
visible on mobile; distinguish web vs app banner size; server-side share page
`followtheshadow.com/share?e=XXXXX` (the only way past the plain-text ceiling of
`navigator.share`/`mailto`); Global Circumstances panel is tall.

### Deferred infrastructure
Production bundling (single JS/CSS). Offline city **labels**: MapLibre symbol layers need PBF glyphs
(system fonts are unavailable to WebGL), so offline is dots-only today — bundling Noto Sans PBF is
~2–3 MB. CSS module split (only after a build step). `map.js` single-file size. Shrinking git
history of `data/paths/` (~274 MB) needs a destructive `git filter-repo` + force-push.

### Explicitly dropped — do not resurrect
- **"Overlay sheet pattern."** Premised on three overlays arriving at once, each growing its own
  control cluster. That premise is gone: the shadow scrubber stays where it is, shadow-on-globe is
  shelved, cloud cover shipped without one. Building a generic control pattern for imagined
  consumers produces an abstraction that fits none of them. `.sheet` already exists, works, and has
  a real consumer in the poster.
- **A MODIS/ERA5 cloud bias blend** — scoped, and real work for a refinement smaller than the gap
  between two valleys (§10.1).
- **Closed and not to be re-raised:** #F4 terrain shadows (done, §8); #P1 observer-pin cluster;
  #P2 paths through the far side of the globe; #R4 offline basemap on mobile; #R3 polar corridor
  "onion ring"; #R1 city labels fading through the globe. The whole globe-occlusion family is
  closed.

---

## 4. DELIVERY, BUILD & DEPLOY

### Delivering work
Hand over the **changed files themselves**, ready to drop into their folders (`js/*.js` → `js/`,
`css/app.css` → `css/`, `index.html` + `sw.js` → repo root). Deploying is a **manual file upload**
to followtheshadow.com/app (Bluehost/Apache); git commits do NOT deploy. He has a one-click sync but
must first save each file into its local folder — **that is the tedious part, so keep the number of
changed files down and say plainly which files changed and where each goes.** He **declined** a zip
bundle; don't push it again.

### BUILD — the assistant stamps it; the user has no Node
**The user does not have Node installed.** `tools/set_build.js` and the test suite are ASSISTANT
tools, run in the assistant's throwaway clone. **So the assistant bumps BUILD and hands over a
re-stamped `index.html` with every delivery that touches any js / css / sw file.** Shipping a changed
`sw.js` without it ships nothing — the worker is registered as `sw.js?v=BUILD`.

### BUILD — how the stamp works
`index.html` holds `var BUILD = 'YYYY-MM-DD'+letter` and calls itself the single source of truth.
**It isn't.** The `?v=` on the stylesheet and on all 18 `<script src>` tags are separate literals.
Bump `var BUILD` alone and you rename the service-worker cache while every asset URL still points at
the old string — and because `sw.js` matches with `ignoreSearch:true`, the stale copies keep being
served. **A whole session's work was invisible to the user this way.** Warning about the drift in
prose did not prevent it, because it was a manual instruction.

```
node tools/set_build.js 2026-08-09c   # explicit
node tools/set_build.js               # bump today's trailing letter
```
(21 asset stamps as of 2026-08-13.)

It rewrites the declaration and **every** `?v=` stamp. The stamp pattern is deliberately blind to
the old value — a file left behind at an older build is exactly the failure it exists to end. A
build from an earlier day restarts at `a`. `tools/checks/test_hygiene.js` asserts every stamp
matches BUILD, so drift fails the suite whether or not the tool was used.

**Rejected: deriving the tags from BUILD at runtime.** `document.write`-ing the script tags is the
obvious fix. Chrome intervenes against parser-blocking scripts injected by `document.write` on slow
connections and simply refuses to load them — for a field app on a bad network that is a blank page
in exactly the conditions it exists for. Static tags stay; the typing becomes mechanical.

Vendored files in `vendor/` take **no** `?v=BUILD` — version lives in the filename.

### Deploy checklist
Assistant: replace files → `node tools/set_build.js` → `node tools/checks/run.js` → hand over every
changed file INCLUDING `index.html`. User: drop files into their folders → hard-refresh → verify on
server → on a real device, check the local globe shows and a map click doesn't error.

### Permissions (THE most expensive operational lesson)
The iOS "black map" was **not** an iOS or MapLibre bug — it was **production file permissions.** New
folders uploaded without world-execute → the server returns **403** for everything inside (basemap
`.gz` 403, MapLibre script 403 → `maplibregl is undefined` → black map). Tell-tale: works on
localhost, fails on the server; 403 not 404.
**Fix: `chmod 755` on new directories, `644` on files, after every upload.** You only hit this when
a deploy creates a NEW folder. Diagnostic: open `https://your-url/js/search_parser.js` directly —
403 = permissions, 200 = fine. (`data/cloud/` is the most recent new folder; it must be 755 or it
serves 403s that look like a broken layer.)

### When "it broke again" with no console error
Application → Service Workers → Unregister / Clear site data → hard reload. With the service worker,
a hard refresh alone is **not** enough. Clean room = fresh **Incognito** window. A wedged
normal-profile worker clears via `brave://serviceworker-internals` → Unregister, or a browser
restart; on iOS, Settings → Safari → Advanced → Website Data → delete the site. Deleting a cache by
hand does NOT re-trigger `install`. On a real BUILD bump in production this is automatic
(`updateViaCache:'none'` + cache name keyed to BUILD; `activate` deletes the old cache).

### Diagnosing on iOS (no built-in console)
Temporarily drop `<script src="https://cdn.jsdelivr.net/npm/eruda"></script><script>eruda.init()</script>`
into `<head>` for an on-screen console/Network panel. Remove after. (eruda's Network tab shows
fetch/XHR only, not `<script>` or SW script tags.)

---

## 5. REPOSITORY STRUCTURE

```
ShadowChaser/
├── index.html          (HTML only; CSS external; holds BUILD constant)
├── sw.js               (service worker — the most fragile file in the project)
├── manifest.webmanifest
├── .gitignore          (data/paths/, .DS_Store, *.pyc, __pycache__/)
├── HANDOFF.md          (this file — status & knowledge)
├── TODO.md             (open task list)
├── PARITY.md           (maplibre ⇄ cesium branch sync rules)
├── DESIGN_SPEC_cesium_map.md   (pin / arrow / palette values — ported, still authoritative)
├── shadow-layer-README.md      (terrain-shadow engine API + integration notes)
├── shadow-layer-example.html   (minimal standalone wiring of the engine)
├── vendor/
│   ├── maplibre-gl-csp-5.5.0.js + maplibre-gl-csp-worker-5.5.0.js   (official CSP build)
│   ├── maplibre-gl-5.5.0.css
│   └── deck.min.js
├── css/app.css         (all styles; never put vendor CSS here)
├── fonts/              (JetBrains Mono, Cormorant Garamond woff2)
├── icons/              (icon-192/512; splash sizes documented in icons/splash/README.md)
├── data/
│   ├── basemap/        ne2_mercator.jpg (offline relief), land / countries
│   │                   (antimeridian-split), lakes, rivers, cities, states  (.gz)
│   ├── besselian/      per-century element records — SOURCE OF TRUTH, git-tracked
│   ├── cloud/          96 cloud_MM_HH.webp climatology slices (§10)
│   └── paths/          generated *.json.gz corridors — NOT git-tracked (build artifacts)
├── data build tools/   gen_eclipse_paths.py — the canonical generator
│                       noncentral_durations.py (§9.6); gen_cloud_climatology.py +
│                       encode_cloud.py (cloud pipeline); delta_t / update_dt / verify_dt;
│                       validate_paths.py, validate_terminators.py, inspect_term_gaps.py
│                       ⚠ audit_paths.py is MISSING from the repo (§9.7)
│                       ⚠ gen_eclipse_paths_13f.py is a DUPLICATE GENERATOR (§9)
├── tools/              set_build.js — the only way to bump BUILD (§4)
│                       checks/ — headless test suites + run.js (§13); the depth
│                       matters, they resolve paths two levels up
├── GREATEST-DURATION.md   handoff for the all-eclipse version (repo ROOT, not docs/)
└── js/
    ├── cities.js       lookupCity, lazy index from basemapData.cities
    ├── cloud.js        CLOUD OVERLAY — climatology layer, palette, sampleAt (§10)
    ├── satellite.js    LIVE CLOUD — geostationary IR, temperature model (§10A)
    ├── cloudbar.js     the Average | Now mode strip (§10A.1)
    ├── details.js      renderData, buildContactRows, contactIcon, lookupElevationAndTz
    ├── eclipse.js      computeEclipse, fundamentalArgs, sunAltAz, findMaximum, findContact,
    │                   getV(t,interior)   — strict-mode UMD
    ├── format.js       fmt*, fmtUTAnchored, fmtLocalAnchored, eclipseIcon, horizonIcon
    ├── init.js         bootstrap; initMap, fetch index.json
    ├── list.js         renderList, selectEclipse (←/→ arrow-key navigation)
    ├── local.js        computeLocal, computeSunriseSunset, findHorizonCrossing, scanLocation
    ├── map.js          THE RENDERER — MapLibre + deck.gl; isOffline, seamFreeLines,
    │                   registerMarker, updateMarkerOcclusion, updateOvalVisibility, _deckLayers
    ├── search.js       parseCoords, onSearchChanged
    ├── search_parser.js pure parser, UMD, strict-mode
    ├── shadow-layer.js  TERRAIN-SHADOW ENGINE — createShadowLayer() MapLibre custom layer;
    │                    GPU DEM raymarch + supersampling. Mercator-only. Don't rebuild (§8).
    ├── shadow-layer.ORIGINAL.js  pristine v64 engine backup — NOT loaded (§8)
    ├── shadow-ui.js     TERRAIN-SHADOW INTEGRATION — toggle, ruler scrubber, 3-way time sync,
    │                    projection flip, online gating. setShadowTime owner. SHADOW_TINT.
    ├── share.js        share modal/sheet (tabstop format)
    ├── state.js        chunkCache, AppState get/set/on + window forwarding shims
    ├── tabs.js         switchTab, switchSidebarTab, TZ_ZONES, getTz/setTz
    ├── tshirt.js       poster generator (§11.4)
    ├── tz_lookup.js    3rd-party offline timezone lookup, bundled
    ├── url.js          pushState, restoreFromHash, event wiring
    └── userlog.js      the saved/seen log — store, panel, row actions (§11.3)
```

**Script load order** (from `index.html`) — vendor CSS, MapLibre CSP JS, `setWorkerUrl`,
`deck.min.js` + `window.DeckGL = window.deck`, `js/tz_lookup.js`, `css/app.css?v=BUILD`,
`search_parser` + `eclipse` (in head); then at body end: format, state, cities, tabs, search, list,
local, details, url, map, **shadow-layer, shadow-ui**, cloud, tshirt, share, init. (Shadow scripts
load right after `map.js` — they use its globals — and before `share.js`/`init.js`.)

**All runtime dependencies are local — no CDN in the shipped app.** That is the prerequisite that
lets the service worker cache everything. (`data build tools/*.html` still reference unpkg; they are
dev scratch, not shipped.) Vendor convention: version in the filename, self-cache-busting, no
`?v=BUILD`, vendor CSS never in `css/`.

---

## 6. THE RENDERER STORY — READ BEFORE TOUCHING THE MAP

The app was migrated MapLibre → Cesium and then **reverted to MapLibre**. The migration was
recommended on a false premise and cost months.

| Claim made | Reality (tested 2026-07-18) |
|---|---|
| "Cesium natively does shademap-style terrain shadows" | **FALSE.** Native shadow map (`viewer.shadows` + `ShadowMode.ENABLED`) breaks at low sun angles — big black square artifacts — exactly the eclipse case. Even tuned (tight `maximumDistance`, 4096 map, lighting off) it works only close-in and top-down, and shadows vanish above ~24.3 km camera altitude. |
| "Cesium is the reason the shadow feature is possible" | The technique that works (per-pixel GPU raymarch) was **never Cesium-native**. It is how shademap.app works, and shademap ships as a **MapLibre/Mapbox plugin** — i.e. it was always available on the stack we left. |
| Cesium's real benefit | **Genuine:** a true WGS84 sphere retires antimeridian/pole seam bugs. That is why branch `cesium` is preserved, not deleted. |

**Do not re-recommend Cesium for shadows. Do not assert that a library does something "natively"
without verifying it first.** This is the single most expensive lesson in the project's history.

### Branches
- **`maplibre`** — active, pushed. MapLibre GL 5.5.0 (CSP build) + deck.gl.
- **`cesium`** — preserved, functional, heavier. Kept for the seam-free sphere.
- **`PARITY.md`** (repo root) — shared vs renderer-only files, and known behavioural differences.
  **Follow it** or the branches silently diverge.
- `sw-dedupe` — abandoned experiment, unmerged (§12.4).

### Renderer wiring (already done — don't re-break)
- `index.html` loads `vendor/maplibre-gl-csp-5.5.0.js`, and **`maplibregl.setWorkerUrl(...)` must run
  before any map is constructed**.
- It also loads `vendor/deck.min.js` and aliases `window.DeckGL = window.deck` (the bundle exports
  `deck`; the renderer calls `DeckGL`). **All eclipse geometry is deck.gl** (`PathLayer` /
  `SolidPolygonLayer`), not MapLibre — forget deck.gl and the map renders with no paths at all.
- `js/map.js` **is** the live MapLibre renderer (formerly `map_maplibre.js`).
- Pin / sun arrow / GE-marker designs were ported from the Cesium build; exact values in
  **`DESIGN_SPEC_cesium_map.md`**. Pin scales with zoom (mirrors Cesium
  `scaleByDistance(5.0e5→1.0, 2.0e7→0.45)`); arrow has a 300 km world cap with a 0.55 minimum scale;
  `transform-origin: 50% 100%` so the pin scales about its tip.

### Standard regression test for any shadow/sun work
Eclipse **2026-08-12**, observer **41.9851°N, 3.4186°W**, greatest eclipse there **18:28:41 UTC**,
**sun altitude 7.8°, azimuth 282.9°**, totality ~1m45s. Deliberately a very low sun — the case that
broke Cesium's native shadows, so it is the right test.

---

## 7. THE MAP — HOW IT WORKS

### 7.1 THERE IS NO `setStyle` ANYWHERE. KEEP IT THAT WAY.
The style is built **once** and never replaced. It contains the local (offline) layers **and** the
online basemap together. Going offline hides a layer; changing basemap retargets a source's tiles.
Nothing rebuilds the style.

This replaced four divergent `setStyle` call sites that each behaved differently depending on how
they were reached. That divergence caused two bugs that looked unrelated and took several wrong
patches to understand:
- **Eclipse paths drawing through the globe.** A full style rebuild costs the deck.gl overlay its
  globe state, after which it stops hiding far-side geometry. This is why it appeared after an
  offline→online swap but never on a fresh load of the same style.
- **A blank/black globe.** `setStyle` defaults to *diffing* old against new. Between two raster
  basemaps that is fine; local↔online changes seven geojson sources, an image source and the
  projection at once, and the differ left nothing rendering.

`diff: false` fixed the second and *caused* the first. Both failure modes are now gone by
construction rather than by guard. **If you reintroduce `setStyle`, you reintroduce both.**

Deleted, not disabled: `mountStyle()`, `_basemapStyle()`, `_localStyle`, `ONLINE_STYLE_URL`, and the
OpenFreeMap tint block (which with a merged style would have recoloured our *own* layers).

**The constraint that makes this possible: every offered basemap is RASTER.** Adding a vector style
to `PICKER_KEYS` brings the whole swap problem back. Noted at `BASEMAPS`.

Key functions in `js/map.js`: `syncBasemapLayers()` — the single owner of both basemap layers'
tiles, zoom ranges and visibility, called at startup, on connectivity change, and on basemap
selection; `applyOnlineState()` — decides *what* should be showing, delegates.

### 7.2 Offline basemap: NE2 relief, and fixing the DATA not the renderer

**`data/basemap/ne2_mercator.jpg`** (4096×4096). A MapLibre `image` source maps its corners linearly
in **Web Mercator**, so the old 4096×2048 equirectangular `ne2.jpg` could not be used as-is: a
plate-carrée image slides every latitude — mildly at the equator, grossly at the poles.

Layer order: `land-fill → lakes → relief → coastline → borders → rivers → cities`. Fills sit *below*
the relief deliberately, as a fallback if the image fails; lines sit above so they stay crisp.
`land-fill` and `lakes` are a **matched fallback pair** — removing one leaves the fallback
half-broken.

**Relief fades at high zoom.** The image is the whole world at 256 px tiles, i.e. native zoom 4. By
z8 it is upscaled 16× and carries no information, only a smear the path edge, pin and sun arrow must
compete with. So
`'raster-opacity': ['interpolate',['linear'],['zoom'], 3.5,1, 9,0.35]` — beginning just before the
imagery stops being real, spread over 5½ levels so no step is visible. It stops at **0.35, not 0**:
a residual tint keeps the coarse desert/vegetation/ocean colouring and still *reads* as imagery.
Going fully flat would make the map look authoritative exactly where it is least accurate — the
vector coast is ~4 km between vertices, wrong by kilometres at that zoom too. No online check
needed: online basemap tiles draw above this layer and hide it entirely. The fade is what makes the
`land-fill`/`lakes` pair visible in normal operation.
*Known, in TODO: the polar ice caps are opaque fills drawn ABOVE `relief`, so past ±85° the map
stays solid ice-white while everything else eases back. Defensible — it IS ice.*

**Polar caps.** Mercator is undefined at the poles, so the relief stops at ±85.0511° and you saw
straight through. Capped in ice-white, with two traps hit on the way:
- **Not ±90** — latitude 90 is infinity in Mercator; a ring touching it projects to invalid geometry
  and the fill *silently fails to draw*. Use ±89.999. (`land.geojson` uses the same value for
  Antarctica, for the same reason.)
- **Two half-rings, split at longitude 0** — a single ring around a pole encloses the antimeridian,
  MapLibre cannot tell which side is interior, so it filled half the cap and *which* half changed
  with rotation.

**Antimeridian polygons.** A ring crossing ±180° or wrapping a pole triangulates the wrong way
(circumpolar stripes, wrong-hemisphere fills, malformed Antarctica). `land.geojson.gz` and
`countries.geojson.gz` were regenerated with the Python `antimeridian` package:
```python
import gzip, json, warnings, antimeridian
d = json.load(gzip.open(src))
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    fixed = antimeridian.fix_geojson(d)        # ±180 split + winding + pole caps
gzip.open(src,"wt",compresslevel=9).write(json.dumps(fixed,separators=(",",":")))
```
Verify: no consecutive ring vertices with |Δlon| > 180 (got 0 in both). `lakes`/`rivers` were
already clean. NB `fix_multi_polygon` chokes on a pole-wrapping polygon-with-holes; use
`fix_geojson` on the FeatureCollection.

**Seam-free STROKES (`seamFreeLines`).** The ±180 split inserts edges along the meridian and a ring
of points at the pole — correct for FILL, wrong for `line` layers (meridian lines over land, a
circle at the south pole). `seamFreeLines(fc)` rebuilds outlines as LineStrings, breaking on seam
edges (both endpoints |lon|≈180, same side) and polar-cap edges (both |lat|≥89.9). Fill keeps the
split polygons; `coast` and the border line source get seam-free lines.

**Coastline graticule.** `land.geojson` ships clipped to a 5° grid (3,350 polygons; 10% of its
83,008 vertices lie exactly on a 5° line), so extracting ring edges as coastline drew every internal
cut — a graticule over every continent. `seamFreeLines(fc, dropShared)` drops **duplicated**
segments: an artificial cut is shared by the two cells either side and appears twice, real coastline
appears once. Verified exactly: all 2,756 duplicated segments lie on a 5° line, and the only
grid-aligned singletons are at ±180, already handled. **`dropShared` must stay OFF for `countries`**
— adjacent nations legitimately share 19,099 border segments, and dropping those erases every
internal border.

### 7.3 Connectivity — one owner
`map.js` owns `isOffline()`:
```js
function isOffline(){ return _forceOffline || _probedOffline === true || navigator.onLine === false; }
```
**iOS never reports offline** — `navigator.onLine` lies and the `offline` event doesn't fire. So an
**active probe** runs on a 15 s poll (plus events) with a 3 s `AbortController` timeout (iOS *hangs*
rather than failing an offline fetch) and a cache-bust param (iOS ignores `no-store` for `no-cors`).
**Negatives are DEBOUNCED** — two consecutive failures before flipping offline, or a slow load
oscillates offline↔online and rebuilds everything repeatedly during service-worker precache. A first
failure re-probes in 3 s, so a real drop shows in ~3 s rather than 30. Positives are trusted
instantly; `navigator.onLine === false` is trusted instantly. `_forceOffline` is the debug toggle
(`forceOfflineMap(on)`).
**Route every new network-gated feature through `isOffline()`** — don't re-derive offline state
inline. The elevation lookup in `details.js` already does.

### 7.4 Markers: occlusion, and the registration rule
HTML markers are DOM overlays. MapLibre v5 fades an occluded marker to `opacityWhenCovered` (0.2)
but leaves it faintly visible **and still clickable** — so a far-side marker could capture a click
meant for the surface. Use MapLibre's own globe-aware test as the SINGLE predicate driving BOTH
visibility and pointer events, so the two can never disagree:
```js
var occluded = map.transform.isLocationOccluded(m.getLngLat());
el.style.visibility    = occluded ? 'hidden' : 'visible';
el.style.pointerEvents = occluded ? 'none'   : 'auto';
```
*(The first version hand-rolled a 90° great-circle cull, which diverged from the true perspective
horizon — a globe shows slightly* less *than a hemisphere — leaving a band where a marker was
visually behind the globe yet judged front-side. MapLibre 5.5.0 was in use the whole time. **Read
the platform API before hand-rolling trig.**)*

**The lifecycle matters as much as the predicate.** The sweep runs on `render`, and **adding a
marker does not cause a render** — so a marker created while the camera was idle was never tested
and sat at 0.2 opacity: faintly visible *through* the globe, and clickable. Found by pressing the
log's jump-to arrow on the already-selected eclipse when it was round the back.

So: the per-marker test is `applyMarkerOcclusion(m)`, and **`registerMarker(list, m)` is THE single
registration point** — it pushes and immediately tests. **Nothing pushes to
`mapMarkers`/`pathMarkers` directly** (observer pin, sun arrow and GE diamond all go through it).
The `render` sweep then only has to keep up with camera movement. **Keep it that way — the structure
is the guarantee.** A fully-WebGL marker (deck.gl IconLayer) is not warranted: blocked by
`interleaved:false` and deck.gl's polar triangulation bug.

### 7.5 Basemap picker and the two-source basemaps
Basemap picker top right; `_scSetBasemap()` is the single entry point. Three options: Street, Topo,
Sat; `PICKER_KEYS` is the picker order. **Default is `esri_street`**; `_basemapKey()` resolves
anything off the picker to it, so no stored key can leave the picker with nothing lit.

Swatches are inline SVG map fragments. Live provider tiles were tried first (Google's approach — show
the thing, not a metaphor) and **failed**: at 44 px a zoomed-out topo tile is indistinguishable from
a street tile. Text labels were also tried and rejected by the user. Three iterations; don't
re-litigate without reading this.

**Two-source basemaps.** Any `BASEMAPS` entry may carry `nearUrl`/`nearFrom`/`nearMax`/`nearAttr`.
Topo flies over **Esri Topographic** and lands on **OpenTopoMap at z9.5**. OpenTopoMap is really two
maps: saturated shaded relief at low zoom, then an abrupt switch to a classic paper sheet at
**9.45**. The paper sheet is the good part; 9.5 sits just past *their* break — a fact about a third
party's cartography, so it may move.

**The handover uses an OPACITY STEP on `['zoom']`, not layer zoom ranges.** MapLibre tests a layer's
zoom range against each **tile's** zoom, and on a globe the on-screen tiles are not all at the same
zoom — so range-based switching drew both maps at once, in patches. `['zoom']` is one scalar for the
frame. `step`, not `interpolate`: these are two different cartographies and cross-fading looks like
a fault. Zoom ranges are still set, one level wider each side, purely to keep us off OpenTopoMap's
servers at global zoom (their usage policy asks).

**Switching to Topo while zoomed hard in left the map blank until the user moved it.** Topo is the
only basemap with a `nearUrl`, so it is the only switch that also flips `basemap-near` from
`visibility:none` to `visible` — and MapLibre does not load tiles for a source no visible layer
uses. `setTiles()` → `RasterTileSource.load()` is async: it awaits the TileJSON, THEN calls
`clearTiles()`. So the cache is cleared and never refilled, because refilling waits on a transform
change. Satellite (no near layer) was always fine, which is the clue that identifies it.
Current fix (`refreshBasemapTiles` / `nudgeMapTransform`): after the source reports content, apply a
1e-4 zoom delta — below a pixel at any zoom, but a real transform change. **This is acknowledged as
a workaround.** MapLibre recomputes `sourceCache.used` inside `Style.update()` from
`!layer.isHidden(zoom)`; the principled fix is almost certainly ORDERING — make the layer visible
BEFORE retargeting the source, so `setTiles` acts on a cache that is already used. One line moved.
Try that first if this ever misbehaves.

### 7.6 Path colours follow the basemap
`pathPalette()` in `js/map.js` is the **single** definition of every path colour, read by all
consumers — penumbra, umbra, centreline, green curve, and both umbra-oval colours. They were
previously RGB literals at six scattered call sites, which is how they drifted.

Each basemap declares its own tone via a `dark` flag in `BASEMAPS`; the palette never tests for
particular keys. Satellite is the only dark one. Offline is always the light case (NE2 is pale).
Adding a basemap means adding one flag.

**`SolidPolygonLayer` FILLS ONLY — it has no stroke.** `stroked` and `getLineColor` are
`PolygonLayer` props and were being silently ignored, so the umbra ovals never had an outline on any
basemap. The outline is now its own `PathLayer`, sharing the id prefix `umbra-ovals` so
`updateOvalVisibility()` toggles fill and outline together (it matches on prefix — keep it that
way). On dark bases the fill is dropped (`ovalFillAlpha: 0`, and `filled` follows it so deck.gl
skips the pass entirely) and only the outline draws.

### 7.7 Umbra ovals hide at high zoom
Ovals are useful zoomed out but obscure the point being inspected up close, so they hide past
`OVAL_HIDE_ZOOM` (=7). The `umbra-ovals` SolidPolygonLayer is built with
`visible: map.getZoom() < OVAL_HIDE_ZOOM`; a `map.on('zoom', …)` listener `clone()`s that one layer
into a fresh array (deck.gl diffs by reference) and re-pushes via `setDeckLayers`, which retains the
array in `_deckLayers` for targeted swaps.
- **KEY DECK.GL FACT:** deck.gl does **not** re-evaluate accessors (`getFillColor` etc.) on zoom.
  Accessors are cached as GPU attributes and only re-run on an explicit `setProps`/`updateTrigger`.
  `getFillColor: () => alpha(zoom)` computes once and freezes. Any zoom-reactive styling must be
  driven by a zoom listener calling setProps. (deck.gl 9.3.3.)
- Open feel question in TODO: blink vs gradual fade. User is living with the blink first.

### 7.8 Camera
- **On eclipse select with no observer pin**, unwrap all path longitudes into a continuous window
  anchored on the greatest-eclipse meridian, then one `fitBounds`:
```js
var anchor = (ep.ge && ep.ge[0] != null) ? ep.ge[0] : allPts[0][0];
var lons = allPts.map(p => anchor + (((p[0]-anchor)%360+540)%360-180));
// fitBounds [minLon,minLat]..[maxLon,maxLat], padding 40, maxZoom 6, duration 800
```
  This replaced an old `lonSpan>180 → flyTo(GE)` two-branch patch. **Design note:** with no pin the
  globe intentionally frames the WHOLE path centred on the path midpoint (not GE) — deliberate and
  preferred. The observer-set branch (`flyTo(coords, zoom≥4)`) is unchanged.
- Every eclipse change re-frames to `defaultZoom()`, centred on the pin if set, else the eclipse.
  `_framedEntry` (camera) is deliberately **separate** from `_lastEntry` (shadow hook), and only
  advances once the camera has moved on a *visible* map — that is what makes mobile deep links frame
  correctly when the user later opens the Map tab.
- **Locate** (`js/url.js`): `easeTo({center, zoom: max(current, 6), duration: 1200})` — on a globe
  that means rotating the Earth round to the pin. **Never zooms back out**, so a user already
  looking closely keeps their view. Same pattern as `onMapClick`, the other "user set the pin
  explicitly" path.
- **Log jump-to** (`scLogGoto`): `updateMapState`'s framing fires only when the selected eclipse
  actually *changes*, so the arrow on the already-selected entry moved nothing — and if that eclipse
  was round the back it stayed there. Now `easeTo({center, duration: 800})`, **after** `switchTab`
  so the map is on screen, **zoom deliberately untouched**. Centre is the saved location, else the
  entry's `lng_dd_ge`/`lat_dd_ge` — the earlier version handled only the saved-location case, so an
  entry logged without a location never rotated at all.

### 7.9 Marker and pointer plumbing
- **Map-click pointer events.** deck.gl's overlay canvas captured pointer events before MapLibre saw
  them. Fix, live: after `map.addControl(deckOverlay)`, set `#deckgl-overlay { pointer-events: none }`.
  Keep it.
- `.maplibregl-marker { z-index: 3 }` — deck.gl's overlay is added via `addControl`, so it lands in
  a `.maplibregl-ctrl-*` container with `z-index: 2`, and markers (no z-index at all) drew *under*
  the eclipse paths.
- **Do not set `position` on a marker wrapper.** `.maplibregl-marker` is `position: absolute`;
  overriding it to `relative` drops the wrapper into normal flow, where a preceding in-flow marker
  shifts it off its coordinate.
- Pin was darting to the container's top-left while zooming: `updateArrowScale` wrote `transform`
  onto the **marker element**, erasing MapLibre's own positioning. The pin is now wrapped (like the
  arrow) so MapLibre owns the wrapper and we scale the child. Pin geometry is
  `PIN_W`/`PIN_H`/`PIN_TIP_Y` — art and anchoring read the same constants, so the tip cannot drift
  from the point.
- **City dots lie flat on the sphere:** `'circle-pitch-alignment': 'map'`. The default `viewport`
  billboards every dot to face the camera, so near the limb — where the surface is edge-on — discs
  stood proud of the silhouette and the terminator crawled over a rash of them. Aligned to the map a
  limb dot foreshortens to a sliver and goes. `'circle-pitch-scale': 'viewport'` stays, so the
  radius remains the screen-pixel size the zoom ramp specifies; `map` would swell them at low zoom.
- Mobile attribution collapses behind an (i): `attributionControl: { compact: true }` plus CSS below
  900 px. MapLibre otherwise decides from container width and leaves it inline.
- **Console noise that is not ours:** a READ-usage buffer warning on every zoom/scroll, then "WebGL:
  too many errors" at 256 — Chrome's per-context throttle. Our only `readPixels` is a one-off 1×1
  terrain-height probe in `shadow-layer.js`, and we set no
  `pickable`/`onHover`/`queryRenderedFeatures` anywhere. No lever; ignore.
- **iOS Safari cross-origin error masking.** CDN-loaded script errors surface as `error @ ?:?` with
  blank message and source (iOS reports a bare `Script error.` with no filename or line, which carries
  no information and is not ours). In an on-screen error reporter, filter `!e.message && !e.filename` to
  drop that noise and surface real same-origin errors. iOS raises one every time its share sheet is
  used — that was the red banner during "Add to Home Screen".

---

## 8. TERRAIN SHADOWS (#F4) — DONE AND WIRED IN

**Status: COMPLETE.** Spike (v4) → study app (v50–v64) → extracted drop-in module → wired into the
eclipse app. The engine is finished and shipped as `js/shadow-layer.js`. **Do not rebuild it. Do not
relitigate build-vs-buy** (our own GPU raymarch, no API key, no $25/mo).

### 8.1 The deliverable
- **`shadow-layer.js`** — a MapLibre custom layer, `createShadowLayer(options)` →
  `map.addLayer(layer)`. Fetches its own free Terrarium DEM tiles; needs only to sit above the layer
  you want shadowed. API: `setTime(Date|ms)`, `getTime()`,
  `setOptions({selfTest,showElevation,shadowColor,onStatus,onLog})`.
- **`shadow-layer-example.html`** — minimal working wiring (map + time slider).
- **`shadow-layer-README.md`** — full API + integration notes.
- **`js/shadow-layer.ORIGINAL.js`** — the pristine byte-for-byte v64 engine as first committed
  (`ba1c20f`), in `js/`, not loaded. The shipped engine differs from it by **supersampling only** —
  verified by diff. Keep it as the safety net; if a shadow change ever misbehaves, diff against it.
- The standalone study remains as `shadows_v64.html` (VERSION `v64`) for reference/debugging.

### 8.2 Architecture (v50+ engine)
Per-screen-pixel ray-march (NOT the old rotate/re-grid scan — that caused staircase coasts, streak
combs, mask wisps; removed at v50). Three passes:
- **PASS 1** — Terrarium DEM tiles → a **NEAR atlas** (fine, viewport×`NEAR_MULT`) + a **FAR atlas**
  (coarse, whole shadow reach). RGB-encoded metres, bilinear on decode. `NEAREST` texture filtering
  throughout (linear blends the encoding → garbage).
- **PASS 2** — far atlas → max-height reduction (sizes next frame) + 4×/16×/64× block-max **mip
  chains** for both atlases.
- **PASS 3** — per screen pixel, march toward the sun; near atlas while inside it, far beyond; step
  grows 3%/sample; hierarchical prune-then-resolve (a block-max level may only PROVE a span clear
  and skip it — casters always resolved at full bilinear). Lit pixels `discard`; shadowed draw
  `SHADOW_RGBA`.

Key constants (top of module): `DEM_Z_MAX=13`, `MARCH_STEPS=300`, `MARCH_GROW=0.03`,
`NEAR_CASTER_M=8000`, `NEAR_MULT`, `TILE_BUDGET`, `NEAR_BUDGET`, `ATLAS_MAX`, `SHADOW_RGBA`.

### 8.3 Correctness (established, verified)
- Spherical-earth curvature (`s²/2R`) + **atmospheric refraction** (apparent sun casts the shadows)
  in the altitude test.
- Water-aware: Terrarium bathymetry is negative; heights clamp `max(h,0)` so underwater terrain
  doesn't cast; coastal cliffs still cast onto water; DEM-sharp boundaries, shadows cross water.
- Twilight veil is altitude-gated (v62): lit terrain stays bright through grazing sun, terrain
  shadows carry the sunset, fades to night only at disc-set (the old disc-fraction veil washed
  detail + blinked to night).
- Verified against closed-form geometry (`selfTest` overlay) and an independent CPU march (0
  structural misses / 0 false positives). Coarse hierarchical march == exhaustive per-texel march, 0
  pixel difference.
- **Extraction integrity:** headless GL harness render **diff vs v64 = 0 pixels**; `shadeVS`/
  `shadeFS`/`copyVS`/`maxFS` shaders identical. Only the wrapper changed (removed self-hosted map,
  OSM basemap, DOM UI, the global `window.onerror` hijack; guarded `window.matchMedia`; routed time
  through `this.timeMs`/`setTime()`; captured `map` in `onAdd`). No global side-effects.

### 8.4 Gotchas already solved — DO NOT RE-BREAK
- `NEAREST` filtering on every encoded texture.
- `max(h,0)` sea-level clamp (bathymetry).
- `tan(alt)` floored at `alt=0.05°` (no infinite ray near horizon).
- MapLibre v5 custom-layer render signature is an options object; matrix at
  `args.defaultProjectionData.mainMatrix` (probe `||args.mainMatrix||args.matrix`).
- Mercator y grows southward → sun dir `(sin(az), -cos(az))`.
- Metres per mercator unit at φ: `40075016.686·cos(φ)`.
- Near-branch clearance may only skip within the near rect (bound the DDA skip at the rect exit) —
  otherwise a skip crosses the seam and steps over a far-atlas caster.

### 8.5 The shademap comparison — SETTLED, from reading Ted's actual source
Ted open-sourced his engine (`ted-piotrowski/leaflet-shadow-simulator`). Findings, all measured:
- **Ted's shadow layer outputs a FLAT colour** (`#01112f`, 0.7 opacity) — the same kind of overlay
  as ours. The 3D relief look in shademap.app is its **basemap**, not its shadow.
- **Our terrain shadows ≈ Ted's** — his exact march vs ours agree ~96–98% on the same bare DEM; the
  residual is discretization scatter, not detail he has and we lack.
- The visible richness of shademap is **(a) DSM tree/building shadows** (his
  `getDSMElevationFromSampler2D` samples a surface model from paid/proprietary, user-provided data)
  and **(b) a shaded-relief basemap**. Both live OUTSIDE the shadow layer.
- Levers tested and RULED OUT as the gap: DEM resolution (3 independent tests, no visible effect),
  shadow bias (matching Ted's 0.0005 recovers detail but adds equal false shadow — net loss), stride
  growth, per-pixel supersampling *for detail* (looked worse — dirty/blurry), and the MapLibre
  `raster-dem` hillshade basemap (coast/tile-seam zigzags).

**If more richness is ever wanted (optional, NOT needed to ship):** DSM data is the only thing proven
to close the gap — **Meta/WRI 1 m** (AWS `dataforgood-fb-data`) and **ETH GlobalCanopyHeight 10 m**
(CC-BY), both commercial-use-OK. They ship as cloud-optimized GeoTIFFs, not XYZ tiles → a
preprocessing pipeline (fetch → reproject → encode Terrarium-style PNGs → serve) plus a shader change
adding canopy height to terrain height before casting. A data-engineering task. A relief basemap is
the host app's concern and does not change the calculation.

### 8.6 Integration — `js/shadow-ui.js`
All integration logic lives in `shadow-ui.js` (~443 lines); the engine gained supersampling and
nothing else.

- **On-map toggle** — a `◐` button top-left (`#btn-shadow`). Greyed out with an explanatory `title`
  when `isOffline()` (the engine streams DEM tiles → online-only); there is also a note in
  Settings→Instructions. (A yin-yang was considered and rejected: `◐` is literally lit/unlit, and a
  hard circle beside the soft `☁` cloud button separates at a glance where two round blobs would
  not.)
- **State machine** (documented atop the file): `_shadowArmed` (user toggled on) vs `_shadowShowing`
  (layer up AND map in Mercator). `updateShadowVisibility()` reconciles them on every toggle and
  zoom.
- **PROJECTION — the load-bearing integration fact.** The engine's vertex shader hands MapLibre a
  **flat-Mercator** quad (`gl_Position = u_matrix * vec4(merc,0,1)`). On the app's **globe**
  projection MapLibre's matrix does not warp that flat quad onto the sphere, so it renders as a
  **sheet floating in space**. Fix: **flip the whole map to `mercator` while shadows are shown, back
  to `globe` when off or zoomed out.** At the zoom you view terrain shadows the two projections look
  near-identical and the seam bugs the globe exists to avoid don't occur that far in. `setProjection`
  is cheap (no style reload). The globe-aware alternative (port the shader to MapLibre's
  `projectTile`) was rejected: the raymarch assumes a linear screen↔mercator mapping, so it is a
  re-architecture, not a wrap. Deferred, not needed.
- **Zoom gate** — `SHADOW_MIN_ZOOM = 6`. Armed + zoom ≥ 6 → Mercator + layer + scrubber. Armed +
  zoomed out → keep the globe, drop the layer, show a "zoom in to reveal terrain shadows" hint.
- **A new eclipse disarms shadows** (different place, date and time; the camera is also pulling below
  `SHADOW_MIN_ZOOM` anyway).
- **TIME.** Opens at the **greatest-eclipse instant** from the Besselian record's `td_ge` (a
  `"HH:MM:SS"` TD string → UT = TD − ΔT → absolute ms on the record's date). If an **observer pin**
  is set and the eclipse is visible there, it anchors on that **location's local maximum** instead
  (`computeEclipse(...).tMax`, already UT). Re-anchors when the eclipse OR the pin changes; leaves a
  manual scrub alone otherwise. Scrubber window = event span (`tmin`/`tmax`); Rise/Set clamp to that
  window — deliberately not widened.
- **SCRUBBER** — a flush, full-width bottom bar (34 px). Left: selected date over time (two lines).
  Right: a **ruler whose time strip slides past a fixed gold centre needle** (not a range input).
  Drag / wheel (±5 min) / arrow keys. `SHADOW_PX_PER_MIN = 6`. It follows the Local/UT toggle —
  display-only shift, shadow time stays absolute ms. Ruler tick *boundaries* are computed in the
  displayed timescale so labels land on clean 5-minute local marks even in a :30/:45 zone, and the
  shift is part of `_rulerWinKey` so a mode flip rebuilds them. Readout width is pinned in `ch` —
  otherwise "local" vs "UTC" changes width and the ruler slides under the static needle.
- **THREE-WAY TIME SYNC.** `setShadowTime(ms)` is the SINGLE owner. The on-map scrubber, the SUNTRACK
  slider, and the contact-times rows (C1–C4, MAX, **and** Rise/Set) all move through it. Plumbing:
  `window.shadowTimeFromSunTrack(ut)` (SUNTRACK → shadow, guarded so it doesn't bounce back) and
  `window.scOnContactRow(ut)` (row click → SUNTRACK + shadow). One re-entrancy guard
  `_drivingSunTrack`; loop-free because `sunTrackJump` sets the slider without firing `input`.
  **`details.js` was edited for this — SHARED per PARITY.md.** The edits are all `typeof`-guarded, so
  cherry-picking `details.js` to the **cesium** branch is safe.
- **BASEMAP-SWAP SURVIVAL.** `_scSetBasemap` uses `setStyle`, which wipes custom layers and resets
  projection; `shadow-ui` re-adds the layer and reasserts Mercator on `style.load` if shadows were
  showing. (This work also fixed a latent bug: `map.js`'s `style.load` re-registered the
  `render`/`zoom` listeners on every call, stacking them on each basemap swap. Now guarded with
  `_mapEventsWired`. It also restored the never-ported `_scSetBasemap`/`_scRecenter` — the basemap
  picker was dead on the maplibre branch.)
- **STRENGTH is a constant, not a control.** `SHADOW_TINT` in `shadow-ui.js`. The Settings slider and
  its `sc_shadow_opacity` localStorage key were deleted — one number nobody needed to argue with.

**SUPERSAMPLING — the speckle fix** (this is a *different problem* from the detail experiment ruled
out in §8.5). The grazing-sun / low-zoom **speckle** is *threshold aliasing*: each pixel's single
march ray point-samples a binary in/out field with real sub-pixel structure, so neighbours flip
lit/dark. Confirmed by elimination — coarsening the DEM (`demRatio` up to 5×) and widening the edge
ramp (`edgeBoost`) both **failed** (speckle is terrain-scale-independent), and both were reverted out
of the engine. The fix is **true 2×2 sub-pixel supersampling**: a copy of the march, `occAt()`,
sampled at four sub-pixel offsets and averaged → the grey is the pixel's *actual fractional shadow
coverage* (physical AA, positions unchanged, edges crisp). **On by default**, made affordable by two
gates:
- **Where:** only when zoom < `SS_ZOOM_MAX` (12) **or** sun altitude < `SS_SUN_MAX` (18°). Zoomed in
  under a high sun a single ray is already clean.
- **When:** **idle only** — single ray during pan/zoom/scrub (`this._moving`, set by map `move`/
  `zoom` + `setTime`, cleared ~130 ms after motion stops with a repaint). This is what restored
  smooth panning. When SS is on the redundant inline centre march is skipped (4×, not 5×).
  `onRemove` detaches the motion listeners (no leak across basemap swaps).

Engine additions for this: `occAt()`, uniforms `u_ss`/`u_pixM`, the `SS_ZOOM_MAX`/`SS_SUN_MAX`
consts + gate, the `_moving` machinery, `onRemove`, and `opts.ss`. **Nothing else changed** — the
default path is bit-identical when `u_ss=0`. No console dev-knobs remain
(`scShadowRatio`/`scShadowEdge`/`scShadowSuper` were scaffolding, removed).

**Regression pass:** toggle shadows on/off; scrub and confirm SUNTRACK + contact rows track (and
vice-versa); click Rise/Set; swap basemap with shadows on (they reappear); go offline (button greys);
pan/zoom-in should be smooth, the accurate 4× frame arriving on settle.

---

## 9. ECLIPSE MATH & PATH GENERATION

Generator: `data build tools/gen_eclipse_paths.py` — **exactly one generator file**. Do not
reintroduce a `_v2`/`_v3` suffix; version history is git's job. (A duplicate old copy once cost a
whole session chasing the wrong baseline.)

**`gen_eclipse_paths_13f.py` sits beside it. KEEP IT — it is not a stray copy.** Checked 2026-08-13:
- As a *generator* it is superseded. `GEN_VERSION = '2026-07-13f'` against the shipped `13j`, which
  is what every built chunk is stamped with. Never generate from it. (File dates agree: the shipped
  generator is Jul 16 2026, `_13f` is Jul 14. But **settle it on `GEN_VERSION`, which is inside the
  file, not on mtime** — mtime records the last write to that path, so a copied or restored file
  carries a date that says nothing about its contents.)
- But it is **not a subset**. It carries five functions the shipped generator does not:
  `_cone_seed`, `_cone_trace`, `_cone_gc`, `_cone_clip_horizon`, `_cone_worst_turn` — the
  cone–spheroid contour tracer, i.e. **the proven fix for the umbral grazing-tip zigzag (§9.5)**.
  This file IS the "WIP saved in sandbox, not shipped" that §9.5 refers to. Deleting it as chaff
  throws away the hard half of an open bug.

Not yet checked: whether the WIP is complete apart from the N/S splitter §9.5 is blocked on. Do that
before starting §9.5 from scratch.

### 9.1 Validation vs Jubier
| Curve | vs Jubier | Verdict |
|---|---|---|
| Umbra limits | sub-km | good except grazing-tip zigzag (§9.5) |
| Green line (Max-on-Horizon) | 0.4–1.8 km | good |
| Terminator (Sun Rise/Set) | 3–5 km | good |
| Penumbra | ~9 km | close; user accepts (naturally fuzzy) |
| Bisector | removed | redundant with green |

The **green line** is traced as the zero level set of {sun altitude at greatest eclipse = 0} via a
predictor–corrector (seed on sign change, step along the tangent, Newton-correct onto the contour).
It is the first path built on the general implicit-field engine the whole path family is intended to
migrate onto. The old `_bisector_curves` measured 33–43 km off and was removed wholesale.
Penumbra detail: our edge sits ~7–10 km INSIDE Jubier's, asymmetric N/S — a boundary-definition
(threshold) difference on a genuinely fuzzy edge, **not** random error.

### 9.2 Umbral-limit topology — CLOSED
Every limb shape now handled; each fixed at root:
- **Near-pole loops** (1533): depth field switched from ever-total (`_cone_depth`) to **local-in-time
  peak** (`dep_local`, hill-climb to the nearest local max of g(t)), closing the loop-interior gap.
  `perpendicular_limits` takes per-point times; march cap 600 km.
- **Terminus completion** (`_terminate_on_green`): every limb ends exactly on the green line at its
  analytic `_GREEN_TERMINI` tip (mag→1 ∩ alt→0 is a tangency the iterative march can't reach, so the
  exact corner is supplied). Corrected a global ~18–25 km terminus shortfall on ALL central eclipses
  → 0–3 km of Jubier.
- **Non-central grazers + central one-limit** (Tn/Ts, A±/An/As): dispatch on the type-code 2nd char;
  analytic `umbra_pts` walk per limb, **each over its OWN validity interval** (a shared interval
  under-samples the shorter limb to nothing). Fixed 1511/1523/1529/1552/1569/1598 and the two-limb
  cases 1547/1554/1565.
- **Pole-transit split** (`_split_at_pole`): breaks a limb where two consecutive points are both at
  |lat|≥89.9 (a spurious across-pole connector). Fixed 1591.
- **Umbra `search_m` scales with path width** (`max(path_width_km · 500 · 1.5, 300 km)`) — a fixed
  300 km window truncated the north umbral limit at high gamma/latitude (canonical case 2600-05-05).
- **Oval bisect stops at the terminator** (`zeta=0`) instead of overshooting below the horizon.

**The `_terminate_on_green` regression — the hard lesson.** A first cut gutted normal eclipses whose
ends sit at sunrise/sunset rather than a polar tip: **2028-07-22** and **2041-04-30** both collapsed
to 2-point stubs. Two wrong turns first (a half-of-the-limb guard; a sun-altitude gate — the data
showed it does NOT separate the cases). **Root cause: a planar (lon,lat) distance metric.** 2028's
umbra crosses the antimeridian, so its endpoint (lon 180.8) and true terminus (lon −179.5) are 14 km
apart on the globe but ~360° apart on a plane → matched the wrong terminus and truncated the limb.
**Fix = the correct spherical metric (`_gc_dist`) throughout, plus an end-correspondence guard** (a
terminus completes only the end on whose half its closest approach falls — handles ends with no
terminus at all, e.g. an umbra that lifts off mid-disc, as in 2041). Verified across 1203→2501, zero
gutted. **On a sphere, use a spherical metric. And never ship a terminus-completion change without
the broad no-gut check.**

Similarly **REVERTED**: relabelling N/S by geographic latitude instead of the fixed side index —
caused 150–170° folds on 2017, 2026, 2002. The shipped generator is the validated v9 lineage.

### 9.3 The V-angle (contact limb angle) — CORRECTED 2026-08-09
`eclipseIcon` draws the bead at `bx = cx + r·sin(V°)`, `by = cy − r·cos(V°)`, so **V is degrees
CLOCKWISE FROM ZENITH** (0 = top, 90 = right).

```
q = atan2( sin H , tan φ · cos δ − sin δ · cos H )      (Meeus 14.1, parallactic)
P = atan2(u, v)                                          (contact PA from celestial north, CCW-east)
V = q − P
if interior contact (C2 or C3):  V += 180
```
Subtracting q rotates from the celestial-north frame into the zenith frame; the negation converts the
astronomical PA (CCW-east, on-sky) into the icon's clockwise-from-top screen convention. Call sites:
`getV()` and the limb-angle block in `computeEclipse`, both in `js/eclipse.js`.

**⚠ The form this replaced was wrong in two ways at once**, and shipped for months under a "CLOSED,
do not re-litigate" banner:
```
WRONG:  q = atan2( sin H , cos φ · tan δ − sin φ · cos H )    ← φ and δ transposed
        V = 180 − P − q                                        ← exact only when q = −90°
```
The old offset drifts by **2(q + 90°)** everywhere else. It survived because the single validation
site (2023-04-20, 8.356°S 127.063°E) has the Sun near the zenith, where q ≈ −90° and both forms agree
to ~1°. At **2012-11-13 from 16.609°S 145.997°E**, q ≈ −105° and every icon was ~30° out — one whole
clock hour.

Verification of the current form, on the discriminating site, against two independent references:
```
vs Jubier V column (clock, ours/his)   C1 10.9/10.8  C2 5.5/5.5  C3 10.4/10.3
                                       C4  5.1/5.1   MAX 2.0/2.0     [2012-11-13]
vs Stellarium Sun/Moon az/alt offsets  05:51 local expected 326.6° cw, got 326.6
                                       07:39 local expected 151.6, got 151.5
2023-04-20 reference, unchanged        345.1 / 92.0 / 288.8
```

**The unit trap that defeated earlier sessions, still true:** Jubier prints **P** in degrees (0–360)
and **V** with no degree sign (0–12). **Jubier's V is a CLOCK POSITION**, so the icon target in
degrees is `Jubier_V_clock × 30`. Sessions that compared our degrees to the 0–12 value concluded the
maths was broken — it was the units.

**Why the interior +180 flip is principled, not an overfit:** `u = X−ξ`, `v = Y−η` is the shadow-axis
displacement from the observer. At C1/C4 the observer is at the penumbra edge and (u,v) is
well-defined. At C2/C3 the observer is ~on the axis, so (u,v)→~0, `atan2` is unstable and lands on the
OPPOSITE limb. Physically the bead is the Moon's leading edge going in (C2) and trailing edge going
out (C3) — opposite limbs. Callers: `getV(tC2,true)`, `getV(tC3,true)`.

**Two lessons, both expensive.** (1) *One validation site is not validation* — a formula with a folded
constant must be checked where that constant is not accidentally correct. (2) *Validate by running the
real pipeline*: a mid-session spot-check fed Jubier's published P into the formula by hand and looked
175° wrong; the bug was in the check.

### 9.4 Obscuration — use the right solid
Obscuration is the **two-circle lens area**, not a circular segment. The search filter derived it from
magnitude by treating the Moon's limb as a **straight edge** and ran badly low everywhere: magnitude
0.9657 (2015-03-20 from 57.910°N 5.165°W, truly **96.6%** obscured) came out as **76.6%**, so `>90`
and `>80` both missed an eclipse that `>70` found.

Two paths now:
- **Scanned rows carry the real thing.** `computeEclipse` already computes the exact lens area for two
  *different*-sized circles; `scanLocation` propagates it as **`local_osc`** (`js/local.js`) and the
  filter uses it directly.
- **Catalogue-only rows** have magnitude alone, and obscuration **cannot** be recovered from magnitude
  without the radius ratio. Assume equal discs — the exact lens area for k = 1, within a couple of
  points across the range that matters:
  `sep = 2 − 2·mag;  osc = (2·acos(sep/2) − (sep/2)·√(4 − sep²)) / π`.

"Obscuration" is the canonical term throughout the UI.

### 9.5 OPEN: umbral grazing-tip zigzag (generator)
On grazing eclipses (~half of all) the umbral N/S limit shows a 300–1200 km gap plus a ~150–177° fold
at one or both ends. **Root cause PROVEN:** the envelope-of-moving-shadow method stops where the
shadow axis leaves Earth's disk (|C|→1); totality continues to the terminator, and the straight chord
bridging that real stretch is the zigzag.
**Fix PROVEN:** trace the umbral limit as the cone–spheroid intersection contour — the zero level set
of h(lat,lon) = max_t(|L2 − ζ·tan_f2| − m), the same engine as the green line. Sub-km vs Jubier
(2017 N 0.28 / S 0.15) and it reaches the tips (1144 BCE: max gap 25 km = the tracer step, vs the old
950 km chord).
**One blocker:** splitting the traced closed contour loop into clean N/S polylines. Simple eclipses
(2033) split perfectly (worst turn 2°); corridor-shaped ones do not yet. Four splitter approaches
tried and rejected; next idea is maximum-curvature tip detection. Full ledger in TODO. WIP saved in
sandbox, NOT shipped — the v9 envelope remains the shipped umbra.
*(For the record, corridor vertices are themselves accurate: every one evaluates to magnitude 1.0000
via `_max_magnitude`. The visible tip protrusions and kinks are sampling artifacts of the
perpendicular bisect, and the user's physical principle — a shadow on a sphere is always smooth, so
any kink is method, not geometry — is the right frame.)*

### 9.6 Non-central eclipse durations — SHIPPED
`data build tools/noncentral_durations.py` (stdlib only; run from the repo root). **Already run with `--write`;
`data/index.json` is patched.** Re-running is safe and idempotent.

94 eclipses have **no central line** — the shadow axis misses the Earth (|γ| > 1) while the cone's
edge still clips the limb. Espenak's `central_duration` is *defined* on that line, so the canon
records 0; Jubier shows 0 for the same reason. **Neither is in error** — the quantity doesn't exist.
The script answers the different question, "how long is totality at its longest, anywhere?", by
searching the surface using the app's own Besselian maths.
*2 Nov 1967: 104.8 s at 62.699°S, 25.489°W — not zero.*

Sparse fields on those 94 records only: `max_duration_secs`, `max_duration_lat`, `max_duration_lon`.
`duration_secs` is **untouched** — Espenak's answer to a different question, and it stays
attributable. Absence of the fields means "use the catalogue value", so `details.js:maxDurationRows()`
is also the feature detector.

**READ THIS BEFORE JUDGING THE VALIDATION OUTPUT.** PASS 1 compares us to Espenak grouped by ΔT
source, and the low numbers are **not bugs** — they are this project's ΔT upgrade working:
```
USNO observed / predicted    87   100.0% within 1s   <- THE GATE (median 40 ms)
Espenak-Meeus              3839    72.6%
SMH2016 LOD extrapolation  1320    42.5%
SMH2016 (ancient)           453     6.0%
```
Where ΔT was replaced we *should* disagree: his figure used the old ΔT. A ΔT difference rotates the
Earth under the shadow, sliding the sample point off the central line, so the duration there
collapses. Proof — restoring an offset recovers his value exactly (−947-11: 511.9 s vs our 93.8 s →
511.9 s at ΔT +1060 s). Within the Espenak-Meeus rows, agreement degrades monotonically with |ΔT| and
nothing else: 100% below 38 s of ΔT, 30% above 13,000 s. **Gate on the USNO rows only.** If that drops
below ~99%, the maths broke.

### 9.7 The pre-ship GATE — RUN AND PASSED, CLOSED
All 50 chunks were regenerated on generator `2026-07-13j`, then swept by **`data build
tools/audit_paths.py`** — a read-only pass over the built `.json.gz` chunks (seconds, no rebuild).

**⚠ `audit_paths.py` IS NOT IN THE REPO** (checked 2026-08-13 — no file, no git history on this
branch). The gate below was genuinely run and passed, but the script that ran it is gone, so it
cannot be re-run after the next generator change. Recover it from wherever it was written, or
rebuild it to the spec in this section. **The spec below is now the only surviving copy.**

**Result: 11,898 eclipses, 7,851 central. Zero stub or missing limbs on two-limit eclipses, zero
gross N/S asymmetry, no stale chunks.** The 2028/2041 failure mode is confirmed absent
catalogue-wide. Only two eclipses flagged — `332-03-13` and `2485-12-07`, both `A+`, both
deliberately won't-fix; detail, Jubier measurements and the candidate fix are in TODO.

**Why a separate script rather than more generator checks.** The generator's in-run AUDIT pass checks
only vertex GAPS (>350 km) and INTERIOR TURNS (>30°) on curves that already exist. `audit_curve()`
returns early on `len < 2`, and a 2-point stub has no interior vertex to turn at — so a missing or
stubbed limb passes it in total silence. **That is exactly how 2028/2041 hid.** The three structural
checks the generator cannot make are STUB, ONELIMB and ASYM, and they live in the script.

The script classifies **verbatim from the generator** — `is_central` = type[0] in T/A/H, `one_limit`
= type[1] in `n s - +`, a real limb = ≥3 points — so the two cannot drift on what they mean by a
limb. **If those definitions ever change in `gen_eclipse_paths.py`, change them in `audit_paths.py`
in the same commit.** It also flags any chunk not built by the majority generator version, which
catches the stale-`.gz` trap that once cost a session on 1957.

Re-run after any generator change touching limb construction:
`python3 "data build tools/audit_paths.py" --report audit_report.txt`

### 9.8 Confirmed correct — not bugs
- One-limit grazers (1957-04-30 annular N-only; 1957 October total other-side-only).
- Terminator "blob twist" near poles (2006, 2023, 2041) — the sunrise/sunset lemniscate is a closed
  teardrop that self-closes; matches Jubier/Espenak.
- The 1957 "missing path" saga was a **stale cached `.gz`** because BUILD wasn't bumped after a
  rebuild. Data, generator and file were all correct.

### 9.9 Repo bloat
`data/paths/` (~274 MB of `.gz`) was git-tracked, so every regeneration committed a fresh full copy
forever (gzip can't delta-compress). Paths are build artifacts; source of truth is `data/besselian/`
+ the generator, and deploy is SFTP. `.gitignore` + `git rm -r --cached data/paths` stops growth but
does not shrink existing history (that needs a destructive `git filter-repo` + force-push —
deferred).

---

## 10. CLOUD-COVER OVERLAY (#F2, climatology half) — SHIPPED

The `☁` button draws mean historical cloud cover for the selected eclipse, sampled at each point's
own local solar time at the moment the eclipse peaks *there*. `js/cloud.js`, ~700 lines,
self-contained. **The live half is §10A; the forecast half (#F2b) is lost and unstarted.**

### 10.1 Data and the pipeline
**ERA5 total cloud cover, 1991–2020 mean, 0.5°, by hour of day.** Three stages:
1. `data build tools/gen_cloud_climatology.py MM` — 24 CDS requests (one per UTC hour), ~310 MB
   cached per month in `_cloud_cache/`, collapsed to 8 **local-solar-time** slices (00,03…21) →
   `data/cloud/cloud_MM.npz`, 1.2 MB.
2. `data build tools/encode_cloud.py` — all months at once → 96 `cloud_MM_HH.webp`, 720×361,
   value = fraction × 250, red channel. **~3.3 MB total, the whole shipped payload.**
3. The app fetches at most 16 (two bracketing months × 8 slices) and caches for the session.

**Ship only the `.webp`.** `.npz` are build intermediates the browser cannot read; the netCDF cache
is disposable once `.webp` exist. Both are gitignored.

**q95 WebP was chosen by measurement, not taste**: mean error 0.31 percentage points, p99 1.2, worst
3.6 — inside ERA5's own bias against observed cloud, at a third of lossless bytes. Alternatives
measured: PNG lossless 9.29 MB, PNG quantised 7.57, WebP lossless 7.99, WebP q95 3.14.

**Why ERA5 and not MODIS.** MODIS is *observed* where ERA5 is *modelled*, which sounds decisive until
you notice a polar orbiter sees each place at two fixed local times (Terra ~10:30, Aqua ~13:30)
forever. The 2026 eclipse is at 20:27 local in Spain, where the Sahara data shows cloud running 3–4×
its mid-morning value. Time of day is the larger error for eclipse work, so the diurnal cycle won.

### 10.2 Why local solar time, and why not greatest eclipse
Over land the diurnal cloud swing is 10–30 percentage points, so a monthly mean answers a question
nobody asked. A single UT instant is equally wrong: the shadow takes ~3 h to cross the globe and every
longitude meets it at a different local hour.

The first version used `UT(greatest eclipse) + lon/15`. That mis-times the ends of a track by up to
90 minutes — half a slice. **Now each point uses `findMaximum()`**, the same engine as everything
else, on a 13×7 grid over the viewport, bilinearly interpolated. Measured against direct engine calls
over the 2026 track: 13×7 is within **15 seconds everywhere** (9×5 within 32 s; 33×17 within 2 s).
Denser grids buy precision the 3-hour slices cannot use.

Effect on 2026-08-12 (GE 17:47:06 UT): Reykjavík +2 min, N Spain **+43 min**, Lisbon +49 min. Spain
moves from a nominal 17:34 solar to 18:16 — the pre-dusk convective collapse, not the afternoon peak.
Cross-check: Spain's totality is ~20:30 CEST = 18:30 UT, matching the computed local maximum exactly.

Local maximum is defined **anywhere the eclipse is visible at all**, partial included, so the whole
map is coloured by its own local peak. Beyond ±3 h from GE the root-find has run off the end of the
eclipse rather than found a peak, and that point falls back to the old formula — as does everything
if no Besselian record loads.

### 10.3 Rendering — two canvases, and why
**Canvas sources, not image sources**, so the raster is built directly in Mercator and the
plate-carrée trap on the `relief` source (§7.2) cannot bite.

**There are two.** A world-spanning base canvas drawn once per eclipse, and a sharp viewport canvas on
top. `movestart` shows the base and does no work; `moveend` redraws the detail canvas and swaps back.
**Exactly one is visible at a time** — two stacked 0.7-opacity copies composite to 0.91 and read as a
darkening flicker.

This design replaced three failed attempts at the same symptom (bare map at the edges while panning):
a 35% render margin, canvas sizing driven by data, and half-resolution mid-gesture draws. **All three
were chasing an unwinnable race** — zooming out doubles the viewport in one frame, so no margin and no
frame budget can stay ahead of it. With a base layer there is nothing to stay ahead of; the worst case
becomes a change of resolution. *Do not delete the base layer to "simplify" this.* The sizing work was
kept because it makes redraws genuinely cheap; the half-res path was removed.

**Canvas is sized to the DATA, not the screen** — `OVER` px per 0.5° source cell, clamped to
`MIN_PX`/`MAX_PX`. Over Iberia that is 288×237 rather than 1024×1023: a 27-fold oversample per axis
was a million pixels of honest work carrying no information. World zoom still asks for 720×OVER and
clamps, so it loses nothing.

**⚠ The power-of-two trap.** MapLibre binds raster tile textures with `LINEAR_MIPMAP_NEAREST` and only
falls back to `LINEAR` when `Texture.isSizePowerOfTwo()` is false — i.e. when NOT square-and-
power-of-two. `CanvasSource` builds its texture without `useMipmap`, so no mipmaps exist. Hand it a
1024×1024 canvas and the texture is incomplete: **WebGL samples it as black, which reads as a flat
grey veil over the entire map.** `_safeSize()` drops one pixel off the height to avoid it. Verified
against maplibre-gl 5.5.0 source. **The veil is not "fixed", it is held shut by that one line** —
which looks exactly like tidy-up bait, since it turns a clean 1024×1024 into an odd 1024×1023 for no
locally visible reason. World zoom lands on the bad case every time. Do not remove it, and do not
"round the canvas to a neat power of two" as an optimisation.

Redraw idiom is `src.play(); src.pause()` — with `animate:false`, `prepare()` only re-uploads on
resize or while playing.

### 10.4 Layer placement
**Top of the MapLibre stack, 0.7 opacity.** Not below `coast-line`: the online basemap rasters are
pushed above the whole vector stack, so anything under them is invisible whenever a basemap is
selected. Top-of-stack is the only insertion point that works both online and offline, and it needs no
change to `syncBasemapLayers()`.

deck.gl renders above all MapLibre layers (`MapboxOverlay`, `interleaved:false`), so limb lines and the
central line stay on top regardless — which is what keeps red-on-red legible where Jay Anderson's own
maps struggle.

Coast and border lines are **re-drawn above the cloud layer, and only while it is on**, reusing the
existing `coast`/`countries` sources (no extra fetch, two extra line draws). Only while it is on,
because an online basemap carries its own coastlines and Natural Earth will not register exactly with
Esri's. Additive layers were chosen over `moveLayer()` deliberately: reordering means the cloud toggle
owns knowledge of the style's ordering and mutates shared state, where duplicates can only ever add and
remove what they created.

### 10.5 Palette
Jay Anderson's scale, matched to his colour bar: blue (clear) → green → cream → orange → dark red
(cloudy), in **5% classes**. Banded, not smooth, for two reasons: a value can be read off the map
without probing, and it tells the truth about 0.5° data instead of implying detail we lack. Anderson's
own bar is stepped too. Built once into a 256-entry LUT, so banding, interpolation and clamping
collapse to one array read per pixel.

Validated against Anderson's published 2026 map, same frame and palette: Greenland ice green,
Norwegian/Barents Seas deep red, the sharp cut across the Mediterranean, Iberia and France orange,
Iceland pale, Svalbard red. Large-scale agreement on every feature. His is a different projection and a
different kind of climatology — expect a few points of local disagreement and treat neither as ground
truth for a hillside.

### 10.6 Honest limits — repeat these to anyone extending it
- **Mean cloud amount is NOT the probability of seeing totality.** 50% can be half-covered every day or
  clear on half of them. Any UI wording must not imply odds.
- **0.5° is ~55 km.** Sea breezes, lee-of-mountain clearing and valley fog are invisible. Good for
  choosing a region months out; useless for choosing a hillside 48 h out, which is a forecast job.
- **Afternoon readings are mildly pessimistic on the day**: the shadow itself suppresses convection. In
  the user's favour.
- ERA5 is reanalysis — real history through a model. Cloud is the field where the gap between grid
  resolution and *effective* resolution is widest, which is why 0.25° was rejected: it would render
  detail the model cannot see, and invented sharpness is worse than visible coarseness on a tool for
  choosing where to stand.

### 10.7 State and gotchas
- `Cloud.version` — **bump it on every change.** Script tags carry a hardcoded `?v=` and the SW is
  cache-first with `ignoreSearch`, so "am I running the file I just uploaded?" is otherwise
  unanswerable. A whole debugging round was spent on this.
- `Cloud.sampleAt(lon, lat)` returns cloud fraction 0–1 at a point using the same blend and the same
  local-maximum timing as the map, so a readout can never disagree with the colour under it.
  **Returns null until the layer has rendered once** (it reads the loaded slices). The details-panel
  item in TODO depends on this.
- A month that 404s **degrades to its neighbour** rather than killing the layer; only both missing
  disables it, with a console warning naming the months. Found because 12 August blends July and
  August, and July did not exist yet.
- `data/cloud/` must be **755 on the server** or it serves 403s that look like a broken layer (§4).
- **Precached since 2026-08-13** — all 96 slices (~3.3 MB) in the best-effort DATA loop, never CORE.
  Not a subset: the layer needs 16, but *which* 16 depends on the eclipse picked in the field, so a
  subset works for some eclipses offline and not others — worse than either extreme.

---

## 10A. LIVE CLOUD — "Now" (#F2c) — WORKING, NOT FINISHED

`js/satellite.js` (~1070 lines) draws **current** cloud from geostationary infrared, as an overlay
over the basemap. `js/cloudbar.js` is the mode strip that chooses between this and §10's
climatology. Four days and roughly ninety versions went into it (2026-08-15 → 18); this section
replaces the four `SESSION-2026-08-*.md` files, which contradicted each other in resolved ways and
have been deleted. Where they disagreed, what follows is the surviving answer.

### 10A.1 The mode strip — SETTLED, don't redesign

`☁` keeps its single job: overlay on or off. The strip below it carries the colour bar, the source
credit and a two-cell segmented control, `Average | Now`.

- **A 3-state cycling button was rejected.** "Now" is unavailable offline and outside coverage, so a
  cycle would contain a dead state — silently skipped or a no-op tap.
- **The mode switch IS the source label**, so there is only ever one statement of which dataset is
  showing. Cells grey individually with an explanatory `title`.
- `Average` gained a legend at the same time; §10.5 justified banding the palette on the grounds that
  a value can be read off the map, which was not true without a colour bar. The gradient is built
  from `Cloud.stops()`, not copied, so bar and pixels cannot drift.
- Adding a third mode later is a third cell, not a redesign.
- `js/cloud.js` changed in three places only, all additive: it delegates the button click *if*
  `CloudBar` exists, stops writing `aria-pressed` *if* `CloudBar` exists, and exports
  `enable`/`disable`/`stops`. Delete `cloudbar.js` and the button reverts to the toggle it was.

### 10A.2 The model — four steps, every constant traced to a measurement

1. **Pixels → brightness TEMPERATURE, not brightness.** GIBS renders GOES and Himawari as a grey ramp
   *plus a coloured section for tops colder than about −12 °C*, so brightness is **not monotonic in
   temperature**: measured over North America, the deepest tops (−90…−50 °C) average channel value
   131 while mid cloud (−20…0 °C) averages 163 and bare ground 112. Any rule written on brightness
   erases the deepest cloud.
2. **Cloud = depression below that pixel's own clear-sky temperature.**
3. **Depression → probability**, from a curve measured against EUMETSAT's operational mask.
4. **Satellites combined by viewing geometry**, `cos³` to the limb.

Rendering: opacity is the probability, colour is the depression (cloud-top height). Drawn only where
P ≥ 0.5 — "more likely cloud than not". At P > 0.02 it painted 96.8% of a real view; at 0.5, 66.4%,
which is the observed global cloud fraction.

**The palette is red and that was argued.** Not white — sat24's clouds read white because its
background is black; on the near-white street and topographic basemaps white vanishes. Not blue —
every basemap paints the sea blue and most of what this layer covers is ocean. Red is accepted with a
partial clash against track and umbra, because those are thin lines over a filled area. Opacity must
not start at zero: a thin deck blocks totality as completely as a thunderstorm. An earlier decision
to borrow `Cloud.stops()` was overturned by this; `test_satellite.js` §8 now guards the red.

### 10A.3 The temperature decode has two silent traps

- **Greys above 178.** The published colour map tabulates its grey ramp only to 179; GOES routinely
  sends greys to 197. Nearest-colour matching those against the full table returned **grey 190 →
  +54 °C** and **grey 182 → −64 °C** — the coldest greys decoding as *hot*. The tabulated ramp is
  linear to within 0.24 °C over its 138 entries, so greys are decoded from that line and
  extrapolated: `T = -0.38598 * grey + 57.2375`.
- **Coloured pixels must only match coloured entries.** A desaturated blend at a colour boundary
  lands nearest a *grey* entry, and every grey entry is warm — measured, coloured pixels decoding as
  high as **+39 °C**. That turned the coldest storm cores into clear sky and punched white holes
  through them. The cube is built from entries colder than −11.5 °C only, and the grey test is on
  **saturation** (`max−min ≤ 12`), not channel differences, so antialiasing between two greys still
  reads as grey.

### 10A.4 The clear-sky reference — TEMPORAL, never spatial

Cloud moves; terrain does not. The clear-sky value of a pixel is the warmest that pixel has been
across recent frames — specifically the **second**-warmest, so one bad scan line cannot set it.

- **Spatial reference cannot work.** Taking it from neighbouring pixels cannot distinguish cold cloud
  from cold ground, so every highland reads as cloud. Denver, at 1600 m and plainly sunny, sat 5.9 °C
  below the warmest land within reach and was drawn as cloud; against a temporal background it sits
  1.1 °C below its own value and is correctly clear.
- **Nothing spatial belongs on top of it.** An intermediate version kept a cell percentile and a
  neighbour search as well — warmest of warmest of warmest — and painted **81%** of the United States
  against a visible band saying 20%. Using the background directly: **22%**.
- **Frames must be a DAY apart, not hours.** At 4-hour spacing, cloud that sits over a place for an
  afternoon becomes its own clear-sky value and the storm punches holes in itself.
- **`BG_FRAMES = 10`, not 4** *(raised 2026-08-18)*. Four days is not enough where weather sits still.
  Measured over the Gulf and Caribbean at zoom 5, holding imagery constant and swapping only the
  background: inside a storm the reference read **4.6 °C against 11.4 °C two pixels outside it**, so
  the storm was measured against its own tops and hollowed out. Drawn area 29.1% at four days,
  **36.2% at ten**, and the large holes close. The published method (bispectral composite threshold,
  Jedlovec et al.) uses twenty days; ten is a compromise with the request count.
- **`BG_TTL` is 6 hours**, not 30 minutes — it is built from frames a day apart, so half an hour was
  far shorter than anything it measures and just made an idle browser refetch ten frames per
  satellite for no change. The long TTL is what makes ten frames affordable.
- **The grid is the WHOLE WORLD at `BG_W = 1024`.** Sized to the satellite (`lon ± 80°`) it wrapped
  past 180° for Himawari and both GOES, and the wrap fallback then requested the world at the *same
  pixel width* — three of five satellites measuring cloud against a field four times coarser than
  their own imagery. **That was the "Minecraft blocks", and the missing slices were its off-disc
  gaps.** One fixed world grid has no wrap case to get wrong. Anything that makes this box
  zoom- or path-dependent must key the cache on the box too, or a zoomed grid gets silently reused
  at hemisphere zoom.

### 10A.5 Geometry — the four traps

- **`map.getBounds()` is unusable in globe projection.** It reports the whole world at almost any
  zoom. `cloud.js` guards this by falling back to the entire globe, harmless for a climatology and
  fatal here: the module was fetching **five satellites at world extent on every pan**. The box comes
  from zoom and centre arithmetically — MapLibre's world is exactly `512 * 2^zoom` pixels across.
- **But that arithmetic is Mercator's, and this map is a globe** *(fixed 2026-08-18)*. A sphere
  compresses toward its limb and shows far more longitude than `512 * 2^z` implies. At zoom 2 on a
  745 px canvas the Mercator box is 170° where the globe shows 183°; at zoom 2.2, 148° against 171°.
  The outer slice was never requested and appeared only when rotation carried it inboard. `viewBox()`
  now takes the **maximum** of the Mercator figure and a globe figure — sphere radius on screen is
  `worldPx / 2π`, a point at angle θ lands at `radius·sin θ`, so the visible half-angle is
  `asin(min(1, halfCanvas / radius))`, divided by `cos(latitude)`. Only applied when the map reports
  globe projection; the two converge above zoom 3.
- **Satellites are chosen per ANTIMERIDIAN HALF, not per view.** Chosen for the whole view, a Pacific
  view asked Meteosat about the far side of the world; those return an empty image, indistinguishable
  from a not-yet-published frame, so each burned the full step-back retry. Measured: **45 requests →
  15**.
- **Never request a bbox whose west edge is at or beyond −179.92°** *(found 2026-08-18)*. GIBS returns
  the leftmost **~10% of the image blank** — 49 of 494 columns for GOES-West, the same 10% at 247, 494
  and 988 px wide, and the same again from −185. The reply is otherwise geometrically correct
  (cross-correlation against an inset request gives a best shift of 0 px). **That was the vertical
  stripe down the dateline**, and it was in neither `bgAt` nor `srcX`. The western half is now inset by
  one canvas pixel — one pixel rather than a fixed angle because the threshold scales with the
  request.

### 10A.6 Performance — measure the phase, then fix it

`Satellite.diagnose().timing` reports `{probe, img, bg, decode, compose, place, total}`. Parallel
phases report their slowest instance; `decode` sums, because `getImageData` is serial on the main
thread. **Every performance claim made from the shape of the code was wrong; every one from a number
held.** The instrumentation stays for that reason.

Fixed in order, each after measuring:

- **Sequential fetch chain → parallel.** Frames were fetched one at a time, justified as phone memory
   — but `compose()` needs every frame's pixels at once, so `out[]` holds them all either way and the
  chain bought nothing while costing the *sum* of the requests. Real 8-job Pacific view: **5.9s →
  1.0s**. Imagery also no longer waits on `Promise.all(warm)` for the backgrounds.
- **`bgAt` was 89% of the entire render.** Not the bilinear read — it recomputed `mercY(box.n)`,
  `mercY(box.s)` and `mercY(lat)` on every one of 1.3 million calls, and `mercY` is a log of a tan.
  None of it varies per pixel: two are constants, the third depends only on the row. Now precomputed
  into per-column and per-row tables once per compose, keyed on grid geometry. **6.6s → 0.49s.**
- **The probe walk was 91% of a fetch** (10673 ms of 11709 ms on a phone). Finding the newest
  published frame now happens at **64×32 at the satellite's sub-point**, all candidate times fired at
  once rather than one round trip per unpublished frame, both GIBS endpoints in parallel, newest
  wins. Live GIBS, 6 satellite-endpoint pairs: **4.9s → 2.0s**.
- **The probe is cached per satellite for half a step and shared between callers.** It ran per *job*,
  so a dateline-split view asked the same satellite twice, and nothing was cached, so every pan
  re-asked. The answer is a property of the clock, not the view. Harness: 40 probe requests on first
  render, **0 after a pan**, 40 again after `invalidate()` — which clears the cache deliberately,
  since its whole purpose is to find a newer frame.
- **The limb case.** When the probe has confirmed a frame is published, an empty full-size fetch means
  the satellite cannot see that box — geometry, not timing. The walk is capped at 2 attempts instead
  of `MAX_STEPS`, so rediscovering that a limb is a limb costs 2 hemisphere PNGs, not 8.

**Not done:** every pan is a fresh URL, so nothing is ever reused from the browser cache. Snapping the
fetch box to a grid would fix it but changes the geometry passed to `compose`/`place` — verify through
the harness before shipping.

### 10A.7 Freshness — GIBS is the floor

Measured 2026-08-18: **EUMETSAT `mtg_fd` and `msg_iodc` run ~12 min behind. GIBS GOES-East, GOES-West
and Himawari run 18–50 min behind, and it jitters.** The module already asks for the newest and walks
back; the lag is NASA's republication, not ours.

- The `nrt` endpoint serves **no** geostationary pixels. Dead.
- `best` and `all` render **byte-identically** (same-frame RGB difference 0.000) but are independent
  caches with different frames populated. Over 9 observations, 3 had one endpoint a full 10-minute
  step ahead of the other, **in both directions**. Mean saving 3.3 min, never more than one step —
  small, but it comes free with the parallel probe. *(An earlier claim of 10–20 min came from two
  single-instant snapshots and was wrong.)*
- Getting GOES to ~5 min means leaving GIBS — CIRA RAMMB SLIDER or NOAA's AWS ABI buckets. Neither has
  been tested; neither host is in the assistant's egress allowlist.
- `eps:m02_*` advertise a 2021 timestamp — that instrument is dead. Any code trusting the newest
  advertised frame without a sanity check will silently render five-year-old data.
- **An empty frame is not an error.** GIBS answers a not-yet-published time with a valid, entirely
  transparent PNG; Himawari was measured returning three in a row. Test the PIXELS. A dropped
  satellite is a hole and **a hole reads as clear sky.**

### 10A.8 What this cannot do yet

- **THE LAYER FINDS ABOUT HALF THE CLOUD, AND THE ERROR IS ONE-DIRECTIONAL.** Scored against
  EUMETSAT's operational mask `msg_fes:clm` on 2026-08-18, three scenes at 22:15Z, scoring only
  pixels the mask actually classifies (opaque, and within 60 of one of its three colours — a box
  wider than Meteosat's disc otherwise scores against nothing and reports a fake 23% false-alarm
  rate):

  | scene | mask cloud | ours | detected | over sea | over land | false alarm |
  |---|---|---|---|---|---|---|
  | Benguela stratocumulus | 49.0% | 26.4% | **51%** | 37% | 60% | 1% |
  | N Atlantic 45°N | 42.9% | 34.1% | **49%** | 30% | 56% | 2% |
  | ITCZ / Gulf of Guinea | 36.5% | 21.5% | **49%** | 41% | 54% | 1% |

  49–51% detection across a stratus deck, a mid-latitude storm track and deep tropical convection is
  the detector, not a regional quirk. **The 1–2% false-alarm rate is the important number**: this is
  not mis-tuning that a threshold would fix, it is cloud the physics cannot see. Infrared cannot
  detect cloud near the temperature of the surface beneath it, which is why sea is worst.

  **The consequence is that the map reads CLEARER THAN REALITY**, and for a tool that tells someone
  where to stand for four minutes that is the dangerous direction — a user sees a gap in the red and
  drives to it. Note also that all three scenes are at night, and EUMETSAT's mask uses visible
  channels by day, so the gap probably widens in daylight, which is when eclipses happen.

  **In DAYLIGHT it is worse**, and daylight is when eclipses happen — same Benguela box at 11:45Z:
  mask 54.9% cloud, ours 25.1%, detection **43%** (sea 29%). EUMETSAT's mask uses visible channels
  by day, so it sees more and we do not.

  **TWO FIXES WERE TESTED ON 2026-08-18 AND BOTH ARE DEAD. Do not re-attempt either.**

  1. **The visible band does not contain the missing cloud.** `msg_fes:vis006` is 100% greyscale,
     no palette to decode, 0–252 — so it is easy to use and useless here. The cloud we miss has
     visible brightness *below* that of pixels the mask calls clear (median 32 against 40; cloud we
     DO find is 95). Sun-angle correcting to reflectance — dividing by cos(solar zenith), computed
     per pixel — does not separate them either (missed cloud 45.8, clear 51.8). Every threshold
     swept, raw or corrected, over sea or everywhere, raised false alarms faster than detection.
     **The missing cloud is DARK, so it is not the thick low deck the theory assumed.**
  2. **The clear-sky reference is not contaminated, and sea-surface temperature will not fix it.**
     The theory was that a permanent stratocumulus deck becomes its own reference. Measured against
     `GHRSST_L4_MUR_Sea_Surface_Temperature` (an L4 analysis, gap-free by construction, colour map
     at `/colormaps/v1.3/GHRSST_Sea_Surface_Temperature.xml`, 213 entries): over mask-clear sea the
     true surface is **23.2 °C**, our reference **9.6 °C** — but our IR pixel value is **9.4 °C**.
     The reference matches the imagery almost exactly. It is not cloud; the whole infrared scale
     sits about 13 °C below the true surface, **on both providers** (GOES over the Gulf: −13.6 °C at
     SST 26–29). A shared offset like that CANCELS in `depression = background − pixel`, which is
     why the layer works at all, and means SST buys nothing.

  **What the numbers actually say.** The cloud we miss has a median depression of **0.0 °C** — 80%
  of it lies within 1 °C of its own clear-sky value, against a median of 16 °C for cloud we find.
  It is invisible to infrared *and* dark in visible. Lowering the draw threshold does not recover
  it: at `dT ≥ 1 °C` detection reaches only 42% while false alarms go from 17% to 38%.

  **The "it is only partial cloud" escape was checked and does not hold.** `msg_fes:clm`'s own
  abstract in GetCapabilities gives **four classes: clear sky over water, clear sky over land,
  cloud, and not processed (off disc)**. There is no "cloud contaminated" class — white means
  cloud. (GetFeatureInfo returns only the rendered RGB, so the abstract is the way to check this.)
  **The 43–51% detection figure therefore stands.** The layer genuinely finds about half the cloud
  a purpose-built operational mask finds, and about a third of it over sea.

  **No cause has been established and two candidate fixes are dead.** What is known: the missing
  cloud is at 0.0 °C depression, dark in visible, and unreachable by lowering the threshold. Anyone
  picking this up starts from there, not from a hypothesis this file has already buried.

  If a fix is ever found it must **ADD** cloud, never gate: gating on the coarse mask was tried and
  produced tile edges. Re-score the same three scenes afterwards — the target is detection up with
  false alarm still in single figures.
- **Nothing above ~65°N.** Geostationary satellites sit on the equator and `cos³` to the limb leaves
  nothing at high latitude. Measured weights on the **2026-08-12 track**: Arctic 80°N **none**;
  N Greenland 78°N goes-east 0.000; C Greenland 72°N 0.001; Reykjavik 64°N mtg 0.015. **The Greenland
  leg of the track this app exists for is blank.** Extending the background grid past 70° does not
  help — there is no usable imagery to extend onto. See §10A.8b: polar orbiters are the obvious
  answer and the obvious way of using them was tested and does not work.
#### 10A.8b Polar orbiters — TESTED 2026-08-18, THE DATA IS GOOD AND THE METHOD DOES NOT TRANSFER

Do not spend a session assuming this is a straightforward extension. Everything up to the model works;
the model itself fails, and it fails for a structural reason that no amount of tuning fixes.

**What checked out:**
- `VIIRS_NOAA20/SNPP_Brightness_Temp_BandI5_Day` (11.45 µm) and `MODIS_*_Brightness_Temp_Band31_*`
  (11 µm) — the same physical quantity as GOES Band 13, so step 1 of the model is unchanged.
- **The colour maps are published and clean**, which was the make-or-break unknown:
  `https://gibs.earthdata.nasa.gov/colormaps/v1.3/VIIRS_Brightness_Temp_BandI5.xml` and
  `.../MODIS_Brightness_Temp_Band31.xml`, 256 entries, `rgb="..."` against `value="(180.0,180.6]"` in
  KELVIN directly. 255 usable entries, **no duplicate RGBs**, monotonic −92.8 → +66.5 °C, only 14
  greyish entries. Better than the GOES map, which had to be reverse-engineered and extrapolated past
  entry 179. Note these are NOT linked from WMTSCapabilities and are NOT named after the layer — the
  directory index at `/colormaps/v1.3/` is how to find them.
- **100% coverage** over a Greenland/Iceland box (−60…5°E, 58…82°N) on every one of 11 consecutive days.
- **Seams are small.** Worst column step 3.0 °C, worst row 4.7 °C, against 1.3–1.5 °C typical — a ratio
  of about 2, i.e. within natural variability, not a hard granule edge. Decoded to temperature the
  image reads as genuine weather.

**What failed.** Running the shipped four-step model on it — same temporal second-warmest background,
same logistic — gives **30.5% drawn at a 4-day background and 55.8% at 10 days**, and neither is
coherent cloud. It is speckle. Note the direction: a deeper background made it **worse**, the opposite
of the geostationary result in §10A.4, which is the signal that this is not a tuning problem.

**Why, and this is the part that matters.** The clear-sky reference assumes *the same pixel at the same
time of day*. A geostationary satellite delivers exactly that by construction. A polar orbiter's daily
mosaic is stitched from whichever passes crossed, at whatever local time each swath happened to fall,
so consecutive "days" are not comparable observations. On top of that, at high latitude in summer the
surface itself moves — melt, snow, sea ice — faster than a multi-day reference can track. The
depression signal averaged 5.0 °C against a reference noisier than that.

**Next thing to try, untested:** `VIIRS_SNPP/NOAA20_Cloud_Top_Height_Day|Night` and
`MODIS_*_Cloud_Top_Temp_*`. These are retrieved cloud products — NASA has already done the detection,
using a bispectral test rather than a temporal one — so they sidestep the clear-sky reference entirely.
That makes the polar zone a *different detector* feeding the same renderer, not an extension of this
one, and it should be scoped as such. A bispectral test on the raw bands is the alternative.

**Meanwhile the layer says nothing above 65°N rather than something wrong, which is the correct
interim.** A hole reads as clear sky, so if this is ever wired, its own failure mode must be checked
against the same rule.

- **Single-pixel speckle at high zoom.** The background grid is 0.35° (~39 km) while a screen pixel at
  zoom 5 is ~4 km, so a coarse reference smoothed under fine imagery rings at cloud edges. Deepening
  the background *increased* the small-hole count (1244 → 1499) because more area is drawn. The fix is
  resolution, not days — raising `BG_W` is the low-risk half (2048 = 0.18°, ~46 MB across five
  satellites in Float32; 4096 is 185 MB and not viable on a phone). *An earlier measurement said a
  finer background changes only 9% of pixels and was not worth it — that was taken at hemisphere zoom,
  where it barely matters, and the conclusion did not generalise.*
- **Himawari has no Dust product**, so the three-product recipe does not transfer to the Pacific. Air
  Mass is the candidate substitute and is untested.

### 10A.9 Approaches already tried and abandoned — DO NOT RE-ATTEMPT

| # | Approach | Why it failed |
|---|---|---|
| 1 | Provider imagery as plain raster tiles | Every product is a PICTURE where clear sky is a COLOUR. Replaces the basemap instead of annotating it. |
| 2 | Viewport-shaped canvas, alpha rebuilt in-browser | `map.getBounds()` is meaningless in globe projection. |
| 3 | Fixed whole-world canvas | `animate:false` makes MapLibre snapshot a canvas source **once**; later remaps updated pixels nobody re-read. |
| 4 | `addProtocol`, per-tile satellite choice + alpha remap | Geometry correct, but providers render "IR 10.8 µm" with different greyscale stretches — identical cloud got different alpha either side of a tile edge. |
| 5 | Four full-disc layers stacked at full opacity | Coverage by stacking works, but the four products look nothing like each other. |

**The lesson under all five: thresholding continuous brightness cannot work, because the correct floor
differs per provider.** The floor differing is not a blocker, it is the *specification* — measure each
satellite's own range. `matteason`'s fixed `interpolate(72, 178, …)` is tuned to EUMETSAT and
meaningless for GOES; a measured 2nd/98th percentile per satellite took the seam brightness delta from
>100/255 to **18.7/255**. Off-disc pixels (`alpha < 250` and `red === 0`) must be excluded first or
they drag the floor to 0.

**Also rejected:** NOAA GMGSI via LibreWXR (visible brightness steps at its own satellite boundaries,
~22°W and over eastern Europe, and an hour behind); RainViewer satellite (free tier is past radar
only); `matteason`'s `clouds-alpha.png` (global, real alpha, CC0, CORS, four resolutions — but
**updates every 3 hours**, and the merged `mumi:*` products it is built from lag 150 min while the
per-satellite ones are 12–30 min). **Compositing sat24-style pictures is approach #1**: sat24's
clarity *is* its black background, and this layer must annotate a basemap you still have to read.

**`addProtocol` produced correct data but never displayed** — 16 OK / 0 failed, mean alpha 180/255,
and rendered nothing. Cause never found. MapLibre **image sources** work and are used. Worth one more
attempt someday knowing the data path is provably fine and the fault is in the display wiring.

### 10A.10 The harness — this is what actually protects the feature

- `tools/checks/mkframes.py LON LAT ZOOM out.json` — fetches a real multi-satellite composite for that
  view, including each satellite's daily backgrounds, exactly as the module builds them.
- `tools/checks/fullpreview.js out.json out.ppm` — runs the **shipped** `compose()` from
  `js/satellite.js` on those pixels, reports drawn percentage and empty columns, and writes an image.
  Convert with PIL and **look at it**.
- `tools/checks/calib.py`, `cmap.json`, `eum_temp_lut.json` are its dependencies. They were missing
  from the repo until 2026-08-18, which made the harness unrunnable for anyone but the author.
- `tools/checks/calibrate_cloud.py` scores the module against EUMETSAT's operational mask over
  held-out scenes with no human in the loop.

**The byte-compare is the regression test, and it is WITHIN-SESSION.** Build a scene with
`mkframes.py`, render it, change one thing, render again, `cmp` the two PPMs. Identical output means
the change was safe; a difference must be explainable before shipping. That caught a north-edge
behaviour change no assertion would have.

Nothing here can be kept between sessions. The frame JSON holds every satellite's raw pixels plus ten
days of background — `f_pac2.json` was 64 MB — so it does not belong in the repo, and a baseline built
from live imagery is stale within minutes anyway because the weather moves. **Build fresh scenes each
session before touching `compose()`.** The three worth building, because each has caught something:
a Pacific view straddling the dateline (`mkframes.py 175 20 2.2`), a North America view
(`-112 40 4.2`), and a south-polar one (`150 -68 1.6`). Add a high-zoom convective scene
(`-88 22 5.0`) if the work touches the clear-sky reference.

**`test_satellite.js` was rewritten 2026-08-18** — it had been testing an architecture two rewrites
old (`_luts`, `_floors`, `_raster`, none of which exist) and crashed at line 82, so sections 7–10 had
**never run once** while the runner reported it as one of "6 suites failing". It now passes 45/45 and
guards the five deleted patches (median filter, edge feather, share threshold, shade floor, spatial
ground search) which the previous handoff claimed it guarded and did not. `test_forecast` was removed
from `run.js`: neither it nor `js/forecast.js` was ever committed, and both are lost — **#F2b starts
from scratch.**

### 10A.11 Teardown, refresh and state

- **`cloud.js` `_disable()` puts each removal in its OWN `try`** *(fixed 2026-08-18)*. All four shared
  one try with a silent catch, and MapLibre throws on `removeSource` while a layer still references
  the source — so one throw skipped every removal after it and left `cloud-base` painted while the
  button reported off. Simulated: a throw on `removeSource('cloud')` left three objects behind;
  per-pair it leaves only the one that threw. `satellite.js` already tore down this way.
- **`cloudbar.js` owns the refresh loop** — a 5-minute `invalidate()`, skipped while the tab is hidden
  with the missed tick run on return. `satellite.js` has **no timer**; one was briefly added there on
  the strength of grepping that file alone and concluding the feature never refreshed. It did.
- **The frame age ticks on its own**, every 30 s, rewriting only that text node so the mode buttons
  are never rebuilt under a finger mid-tap. It used to be written once when a refresh completed, so
  "14 min ago" still read "14 min ago" an hour later — worse than showing nothing, because it looks
  live. A countdown to the next refresh was considered and rejected: it answers "when will this
  update" when the question is "how old is what I am looking at".
- **`Satellite.onFrame` only pushes** — there is no removal — so `cloudbar.js` registers its listener
  once, not on every switch to Now.

### 10A.12 Process lessons specific to this feature

- **LOOK AT THE OUTPUT.** Sixty-odd versions across three days were written from the user's
  description of a screenshot, because the assistant framed the problem as "there is a bug in the
  code" instead of "I cannot see the output". The container has PIL and the `view` tool renders a PNG.
  The first time the composite was actually built and looked at, it immediately showed a defect the
  user had never reported and no description would have produced.
- **Do not describe or interpret the user's screen.** Three separate claims about what was on it were
  false, including one where the basemap had been removed two versions earlier by the assistant
  itself. Instrument the page, ask for the number, act on the number.
- **Enumerate, never guess a layer name.** EUMETSAT's cloud masks were found by listing all 116
  layers; six GIBS names were guessed, all missed, and the wrong conclusion drawn until enumeration
  settled it.
- **Check the harness before the module.** A Python reproduction had its own gap bug and two rounds
  were spent hunting a defect that did not exist in `satellite.js`.
- **Isolate before attributing.** The 18.7/255 seam delta was presented as a calibration result while
  a timestamp gap sat unaddressed in the same log. The attribution was probably right, but not
  earned. Relatedly: a "EUMETSAT is 90–110 min stale" conclusion came from comparing an 11:00Z frame
  against the user's 12:26 **local** clock. A clock is as checkable as a pixel.
- **Fix the layer the numbers point at.** Two rounds of this feature's optimisation went into the
  network while the CPU was the bottleneck, and a third into the CPU while the probe was.

---

## 11. UI, FEATURES & VISUAL LANGUAGE

### 11.1 Working today
- **Search** — tokenized filters: year ranges (`2026`, `2026-2030`, `1994+`, `after 2100`, `44BC`,
  `10BCE`), months, days, type, magnitude/obscuration, saros, coordinates, cities, today/now. Cities
  longest-match-first (3-word max). Coords at 5 decimals (explicit user pref). Search-range setting
  (Modern / ±500y / Extended / All), persisted, bypassed when an explicit year filter is present.
- **List** — centred on today (250 either side when unfiltered); selection persists when the search is
  blanked; icons use GLOBAL eclipse type; ←/→ arrow-key navigation.
- **Eclipse icons** — unified `eclipseIcon({type, phase, magnitude, angle, size})`: total = moon+corona,
  annular = orange ring, hybrid = half/half, partial = sun + offset moon; C1/C4 crescent, C2/C3 diamond
  bead at `angle` (§9.3). viewBox 36, sun r 9; SUN `#e8a04a`, MOON `#0a0c10`, HALO `#dde3ec`. Rise/Set
  = half-disc on horizon + rays (sunset is sunrise flipped).
- **Contact-times table** — local default, header cell toggles Local/UT, persisted as `sc.timeMode`.
  Sorted by absolute decimal-hour UT; display appends `(±Nd)` for events on a different calendar day
  than MAX. Rise before tMax / Set after, ±18 h window.
- **Details panel** — order is Local Circumstances → (location line, summary table) → Contact Times →
  Sun Track → Global Circumstances. The summary has **no heading of its own** — it sits directly under
  "Local Circumstances", which already names it. It only needed one during the period it was pushed
  below the contacts and track; if it moves again, give it one back. Title actions are icon-only (share
  mark, save star), both SVG. **The star is SVG, not a glyph**: a text glyph centres on its LINE BOX,
  which includes ascender and descender space, so it sat visibly high in a flex-centred square no
  matter what line-height was set. Details tab throbs on a new map location (`scFlagFreshDetails()`).
- **Search panel** — the hint strip under the box was removed (it duplicated the placeholder), as was
  the separate coordinate readout: **the location filter pill now IS the coordinate readout**, showing
  the place name or coordinates. `#coords-status` no longer exists.
  `parseCoords()` **self-heals**: `currentFilter` is a cache of `parseSearch(search.value)` refreshed by
  `onSearchChanged`, and if the two fall out of step the failure is silent and confusing — the map
  draws the pin (it re-reads on redraw) while the details panel says "enter coordinates". When the
  cache says "no coordinates" but the box plainly contains a pair, it re-parses and repairs. Guarded by
  a literal regex, so it costs nothing normally and cannot invent a location. **The underlying trigger
  was never reproduced** — if this recurs, the stale cache was not the mechanism, which is itself worth
  knowing.
- **Tabs** — folder convention (active tab matches panel surface, inactive recessed; container provides
  the divider; active overlaps with `margin-bottom:-1px`; a tab never has its own bottom border).
  **There is no Map tab on desktop** — `app.css` hides `.tab-bar` above 900 px. Mobile has FIVE tabs
  (Search, Map, Details, Log, Info); the sidebar has four (Search, Details, Log, Info). Both use
  `flex: 1`, so adding one needed no CSS. The 900 px branches in JS are load-bearing and must stay.
- **Share** — tabstop-aligned text: header, GE block (duration/time/location/magnitude), path width,
  local circumstances, URL, credit. Share-link encoding (`e=` + coords only, not full search state).
  About has a mailto bug-report link and an Android note. **About's story deep links are relative**
  (`#e=…&q=…`, not `https://followtheshadow.com/app/#…`) — absolute ones leave the app, and offline
  leave it for nothing.
- **The map's cosmetics are finished** — sun arrow, push-pin observer marker (tip = the coordinate),
  orange GE diamond, city dots and labels, borders that fade with zoom-out, umbra ovals, basemap picker,
  load crawlbar. Exact values in `DESIGN_SPEC_cesium_map.md`. The sun arrow points at the **Sun's
  azimuth at maximum**, not along the centreline. A pin drop-shadow was tried and rejected as a smudge.
- **State** — `AppState` get/set/on plus window forwarding shims. `AppState.on()` exists but is **not**
  wired to subscribers; manual re-renders still required. Module-locals `_currentRec`, `_timeMode`
  deliberately left in place.

### 11.2 The Info tab (formerly Settings)
Almost nothing in it was a setting, so it is now **Info** (`ⓘ`) on mobile and in the sidebar. **Only the
label changed** — the `data-tab` / `id` / `class` hooks all still say `settings` on purpose; renaming
them touches `tabs.js`, `url.js` and the CSS for no user-visible gain.

Two controls were deleted outright:
- **Shadow strength** → the constant `SHADOW_TINT` in `shadow-ui.js` (§8.6).
- **Timezone `<select>`** → gone from the UI, not from the app. The contacts table toggles UT/local
  inline, one tap from the times it governs, which made the row a second way to say the same thing where
  nobody looks. The selection now lives in **`_tzChoice` in `tabs.js`, via `getTz()`/`setTz(v)`** —
  keeping a hidden `<select>` as a value holder would have been a DOM node used as a variable. `setTz`
  **validates against `TZ_ZONES`** and ignores anything else, so a hand-edited `#tz=` link leaves the app
  on `auto` rather than in a zone it cannot resolve. `buildTzSelect()` and its `init.js` call are gone;
  `pushState`, `restoreFromHash` and `buildShareUrl` all route through `getTz`/`setTz`, so shared links
  still carry the zone.

### 11.3 The user log (#F1) — SHIPPED
`js/userlog.js`. One localStorage key, one object, keyed by catalogue number:

    sc.log = { v:1, entries: { "9518": { seen, loc, ts }, ... } }

**PRESENCE IS "SAVED".** There is no `saved` field — an entry exists because the user saved it, and
unsaving DELETES the entry. `seen` is likewise stored only when true, so an entry holding nothing but a
`ts` is the wishlist case. Everything except `ts` is optional. There is no note field (tried, removed as
clutter, never shipped to anyone).

**`loc` is `[lon, lat]`** — the app's order everywhere else (`ge`, path data). A flip here would look
entirely plausible and be wrong forever; it is asserted in the tests.

**Keys go through `scLogKey()` and nowhere else.** `index.json` stores `cat_no` as a float, so a bare
`String(rec.cat_no)` yields "9518" on one path and "9518.0" on another.

**Row layout is a two-row grid**, `"ico date acts" / "ico loc loc"`, so the coordinate line spans the
full width beneath the buttons. It was flex first, which squeezed the coordinates into whatever the
icons left over and truncated them. **The column left of the type icon is deliberately empty and
reserved for the t-shirt selection checkboxes** — commented in both `app.css` and the render function.

**Four row actions**, all inline, no expander: flag (seen — it *fills*, not a checkbox, since a checkbox
there would collide with the t-shirt selection control), pencil, bin, arrow.

**The pencil is inert unless the current location differs from the saved one.** That is the whole safety
property: opening a saved eclipse to look at it from somewhere else must never quietly overwrite where
the user actually stood. Committing is always explicit.

**Row tap and travel are SEPARATE.** `scLogGoto` restores the location, selects the eclipse, switches to
the map on a phone, and moves the camera (§7.8). They were one gesture at first, which on mobile meant a
tap both expanded the row and hid the panel it had just opened.

**Circumstances** (obscuration, and duration when central) come from `computeEclipse` — the same function
`computeLocal` uses. Async only because the Besselian record may sit in an unloaded chunk; a failed load
caches the miss so it isn't retried every render.

**Toolbar — four icon buttons** (`tshirt`, tri-state pick, `download`, `upload`), replacing five text
buttons, each carrying `title` **and** `aria-label` since the glyph is now the whole label.
All/None collapsed into **one tri-state checkbox** (`pickNone`/`pickSome`/`pickAll` — identical box, only
the mark inside changes). It shows what the selection *is* and clicking does the obvious thing: anything
short of all → all; all → none. Two buttons could not show state, and one of them was always a no-op.
*Known wart, in TODO:* `tsOpen` reads an empty pick set as "use everything", so *none* and *all* send the
poster the same instruction — only the dash state actually narrows it. The control now *displays* a
distinction it does not have. **Fix in `tsOpen` if it ever matters, not in the toolbar.**

### 11.4 T-shirt poster (#F1a) — SHIPPED, with a known rough edge
`js/tshirt.js`, opened from the Log panel's "Make map" button; selection is the checkbox column in each
log row. Seven projections, four palettes, SVG + PNG export, pinch-zoom, in the reusable `.sheet`
overlay. Land comes from the app's own precached `land.geojson.gz`, not a 1.9 MB embed. Path records come
through map.js's existing `loadPathChunk`.

**The geometry took days and is still not perfect.** The corridor is built as a ribbon of per-timestep
quads (not one closed polygon — that flooded polar caps and tore at the seam). Limbs are paired by TIME,
not proximity. Steps wider than Espenak's maximum path width (1419 km = 12.8°) are dropped as failed
pairings. Degenerate cross-sections near a pole are rebuilt from the centreline. Three assertions still
fail (§3).

**Two approaches tried and REJECTED, do not re-attempt without reading why:**
- *One closed polygon, fill it.* Looks obviously right; produces a huge wrong wedge with the centreline
  outside it. Verified by rendering.
- *Extending limbs to the pole.* Produces a ragged notch and a pinch the centreline escapes through,
  because in point-pole projections the two extensions converge.

**The method that actually works for debugging this: rasterise the SVG and LOOK at it.** `cairosvg` +
`PIL`. Days were lost measuring polygon area and quad widths — proxies that moved while the picture
stayed wrong. Every defect was found within minutes of rendering.

### 11.5 Visual language — DECIDED, enforced by tests
Four decisions, taken after an audit of every rule in `app.css`. Two were reversed after seeing them on
screen; both reversals are recorded so they aren't redone.

**Weights.** Only faces that exist: serif 300, mono 400/700/800. Four rules previously asked for 500 or
600, which have no face — 500 rounds DOWN to 400 (a no-op) and 600 UP to 700. A "make this slightly
bolder" change sat in the stylesheet for a whole session doing nothing. **Never write a weight without a
matching `@font-face`.**

**Gold — one meaning per token.**
- `--gold` = the SELECTED / current thing. Exceptions: `.app-title`, `.app-header::before` (branding),
  and the heading tiers.
- `--gold2` = DATA VALUES (`.detail-table .v`, type colours, readouts).
- `--gold-dim` = never text. Non-interactive only: disabled fill, progress fill, `.badge-total`'s type
  colour, the sun-track frame.
- `--edge` (#9a8a63) = interactive edges: hover, focus, active outline. `--gold-dim` managed only 2.93:1
  against the basemap picker's own background, so those outlines were invisible on exactly the controls
  that needed them; `--edge` is 5.77:1.

**Headings — REVERSED once.** First attempt made them grey and separated the tiers by weight. On screen
that was worse. **Both tiers are GOLD; SIZE carries the hierarchy** — `.detail-section-h` 0.92rem/700,
`.detail-sub-h` 0.72rem/700, against `.detail-table .l` at 0.66rem/400 grey. Serif italic was also tried
for the sub tier and looked wrong against the mono stack. Do not re-attempt either.

**Rules.** Headings carry none. One separator treatment (`1px var(--border)`), replacing three. Left bar
= selection. Gold is never a horizontal rule.

**Icons — REVERSED.** Search/Map/Info were converted from emoji to SVG so they'd inherit `currentColor`;
the colour emoji read better at tab size and were restored. `.tab-icon-svg` still uses `currentColor`, so
the SVG tabs (Details, Log) follow the active state.

All of the above is asserted in `test_hygiene.js` §7. Two documented exceptions: `.pill-loc` is a
selected state whose class name doesn't say so, and `.shadow-center::after` uses borders to draw the
needle's arrowhead, not as a separator.

**CSS generally** — all in `css/app.css`. Inherit, don't re-declare; one token source
(`--bg/bg2/bg3/gold/--pin-red`), no raw hex, no ID selectors for styling. CSS keyframe filter lists
**must contain the same functions in the same order at every stop**, or the browser interpolates
*discretely* and the colour snaps.

### 11.6 iOS specifics
- **Scrubber vs the home indicator.** The panel runs to `bottom: 0` so no map shows beneath it; the
  CONTROLS are lifted by `padding-bottom: env(safe-area-inset-bottom)` (+8 px in standalone). At
  bottom:0 with no padding, dragging the scrubber switched apps.
- **Sheet dismissal.** Four ways out: the "× Close" button (LABELLED — a bare glyph was not read as an
  exit), backdrop tap, Escape, swipe-down. Only the labelled button is genuinely discoverable; the rest
  are conveniences.
- **Splash images are NOT declared.** iOS ignores any `apple-touch-startup-image` whose pixel size
  doesn't match the device exactly, so full coverage needs 28 files. Sizes and naming are in
  `icons/splash/README.md`. Until the artwork exists there are no tags — declaring links to absent files
  is exactly the Cesium mistake (§12.2). The home-screen ICON already works: iOS 16.4+ takes it from the
  manifest.
- The app is named **followtheshadow** throughout: page title, `apple-mobile-web-app-title`,
  `.app-title`, manifest `name`/`short_name`, the offline page, share text, log export filename, module
  headers, and the SW cache (`followtheshadow-<BUILD>`). **NOT renamed, deliberately:** the localStorage
  keys (`sc.log`, `sc.timeMode`). They are invisible, and renaming them wipes the log for no gain.

---

## 12. SERVICE WORKER / PWA

A true no-signal reload loads the app from Cache Storage. Verified offline: globe renders, present-day
eclipse draws, map-click gives local circumstances, per-century scan works.
**`sw.js` is the most fragile file in the project — treat it so.**

### 12.1 Design (deliberately simple)
- **One version source.** `VERSION` is read from the registration URL (`sw.js?v=BUILD`), so BUILD stays
  the only number. Cache name = `followtheshadow-<BUILD>`; `activate` deletes every other cache.
- **`ignoreSearch` on all cache lookups.** The cache name already pins the build, so precache URLs are
  query-free and `foo.js?v=BUILD` matches cached `foo.js`. This killed a long-running phantom-cache-miss
  bug (the "blue marble, no land" symptom).
- **`updateViaCache:'none'`** on registration, or stale HTTP-cached worker code never updates.
- **Navigations are network-first, time-bounded.** Online → fresh index.html, so a deploy is picked up
  immediately and registers the new worker (no manual clear). If the device reports offline, serve the
  cached shell instantly; otherwise race the fetch against a 2.5 s timer and fall back to cache.
  (Cache-first navigation caused "the old worker won't update"; a no-timeout network-first froze the page
  when iOS left an offline fetch hanging. This handles both.)
- **CORE (atomic `addAll`):** index.html, favicon, css, all js, vendor (MapLibre CSP build + worker,
  deck.gl), the 6 used fonts, basemap `*.gz` including `land.geojson.gz`, `data/index.json`. Any failure
  fails install.
- **DATA (best-effort loop):** all 50 besselian centuries (~9.5 MB — makes scan + local circumstances
  work offline for any era) + paths for **1900–2100 only** (paths are ~6 MB per century, ~274 MB for the
  full set). Outside that range, cached on demand when viewed online. User's decision: this era + last
  century, for birthdays etc.
- **Fetch (non-nav):** non-GET and all cross-origin (raster tiles, connectivity probe, elevation API,
  Terrarium DEM tiles) pass straight through. Same-origin GETs are cache-first (ignoreSearch) then
  cache-on-demand; offline misses return a quiet 504.
- **The one expected console line offline:** a single probe ERR at startup — that IS the connectivity
  detector doing its job. It fires once.
- **CSP:** none is set. If one is ever added, allow `worker-src 'self'` plus the worker URL (the CSP
  build loads its worker from a real file, not a blob).

### 12.2 The lesson: a precache list can lie silently
`vendor/cesium-1.121/` **did not exist**, but `sw.js` still listed the engine entry in CORE and a ~130-file
worker array. `precache()` swallows failures, so this was invisible: every install fired ~130 doomed
requests. Removing it exposed what the list was *missing* — **MapLibre and deck.gl were never precached**
(~1.9 MB of the engine actually in use, cached only opportunistically after first load, so a fresh install
that went offline before then had NO MAP), and **`land.geojson.gz` wasn't either**, despite `map.js`
marking it required.

There is now a check that every path in CORE exists on disk. **If you add a vendor path, verify the file
is there** — that is the whole lesson.

### 12.3 Adding to the precache
New data goes in the **best-effort DATA loop, never CORE `addAll`** — a CORE failure fails the whole
install. This is the open cloud-layer item (§3).

### 12.4 Known, measured, NOT fixed: duplicate downloads
Every asset downloads **twice** on a build change (~317 requests, 22 MB). Cause: the page requests
`js/map.js?v=BUILD` while `sw.js`'s precache lists say bare `js/map.js` — two URLs, two downloads.
**Pre-existing** (present throughout the successful offline milestone) and **harmless**: SW-initiated
fetches are served from `(disk cache)` in 2–9 ms; load ~11 s, DOMContentLoaded ~950 ms.
**Two failed fixes — do not repeat:** (a) a single-flight `fetchOnce()` inside `sw.js` is *structurally
impossible* — site data is cleared between builds, so no SW controls the page at load and the page's
fetches never reach the handler; (b) precaching versioned URLs + `'reload'`→`'default'` **broke the
eclipse paths** (reverted, branch `sw-dedupe`).
**The real fix, for a calm dedicated session:** stop precaching what the page fetches for itself (the
fetch handler already caches on demand); precache only what the page never requests.

---

## 13. TESTS — `tools/checks/`

Headless, no browser. `node tools/checks/run.js` (needs `npm i jsdom` once). **Assistant-only — the
user has no Node.**

**The suites live in `tools/checks/`; `set_build.js` stays in `tools/`.** They resolve their inputs
as `../../css/app.css`, so that depth is load-bearing — flattened into `tools/` (where they sat until
2026-08-13) all five die with ENOENT before asserting anything, and `run.js` reports it as
"5 suite(s) failing", which reads like a real regression rather than a path problem. When the count
looks wrong, run a suite directly: `run.js` prints only the tally on a crash. They exist because several
decisions in this document were made, silently undone, and re-litigated.

- `test_hygiene.js` — orphaned comments, duplicate selectors, unused classes, rules filed under the wrong
  banner, **the visual-language rules** (§11.5), the **DOM contract** (every `getElementById` must resolve
  to an id in index.html or one the JS creates), and the **build stamp** (every js/css asset must carry
  the current BUILD).
- `test_details.js` — heading tiers, title actions, no wrapping.
- `test_userlog.js` — store semantics, `[lon,lat]` order, the explicit-commit gate, row vs goto
  separation, escaping, corrupt-storage resilience.
- `test_picker.js` — the collapsible basemap picker's two-tap behaviour, offline, desktop.
- `test_tshirt.js` — **expect exactly 3 failures** (§3). Anything else failing is new and worth reporting
  before doing any work.
- `test_satellite.js` — the live-cloud module: exports, enumerated layer names, EPSG:3857 on both
  services, stamp formats, the red ramp, the five deleted patches, coverage geometry, the contract
  `cloudbar.js` calls, staleness. **Passes 45/45 as of 2026-08-18** (§10A.10).

**`run.js` now says CANNOT RUN when a suite could not start** — a missing module, an ENOENT, or a
crash before the first assertion — and counts those separately from real failures. It was reporting
both as "N suite(s) failing", which is how `test_details`, `test_userlog` and `test_picker` sat
unexplained for a week while being **nothing but a missing `npm i jsdom`** in a fresh clone. The same
tally also hid `test_satellite` crashing on line 82. When the runner cannot tell a setup problem from
a regression, nobody reads it.

**A suite that always fails protects nothing.** `test_satellite.js` spent days counted among "6 suites
failing" while it was in fact crashing at line 82 against exports deleted two rewrites earlier, so its
last four sections had never executed once. When a suite fails, read *which* assertion before assuming
a real regression — and if it tests something that no longer exists, rewrite it rather than leaving it
red. `test_forecast` was listed in `run.js` with no file behind it at all.

**The DOM-contract and build-stamp checks were added after a real failure**: `#coords-status` was removed
from the markup and `search.js` rewritten to stop using it, but BUILD was not bumped — so the service
worker served the cached old `search.js` against the new HTML. One throw inside `onSearchChanged` aborted
everything downstream: blank details panel, no map pin. **Touching any js/css without bumping BUILD now
fails a test.**

---

## 14. QUICK GOTCHA INDEX

- `eclipse_type` — first letter uppercase, drives icon selection. Magnitudes: totals ~1.00–1.08,
  annulars ~0.85–0.99, partials 0–1.
- `rec.t0` is **TDT decimal hours**, not UT. `UT = t0 + t − dT/3600`; dT in seconds.
- Obscuration is a two-circle **lens**, never a circular segment (§9.4).
- Jubier's printed **V** is a clock position (0–12); degrees = clock × 30 (§9.3).
- `isOffline()` in `map.js` is the single connectivity owner (§7.3).
- Strict-mode pure modules: `tz_lookup.js`, `search_parser.js`, `eclipse.js`.
- MapLibre globe ≠ Mercator; antimeridian/polar bugs differ. GeoJSON symbol layers were abandoned
  (geojson-vt antimeridian/polar issues). deck.gl has its own polar triangulator bug.
- deck.gl accessors don't react to zoom without `setProps`/`updateTrigger` (§7.7).
- `field-sizing: content` powers the search textarea autogrow (no JS).
- localStorage keys: `sc.log`, `sc.timeMode`, plus the search-range setting.
- `window.matchMedia('(min-width: 900px)')` chooses the initial map zoom (desktop vs mobile).
- Vendored libs: version in the filename, **no** `?v=BUILD`. Bump BUILD only with `tools/set_build.js`.
- Terrarium DEM tiles are cross-origin — they pass straight through the service worker.
- **There is no `setStyle` in the codebase. Do not add one** (§7.1).
- MapLibre layer zoom ranges are tested per **tile**; on a globe, on-screen tiles differ in zoom. Use an
  opacity expression on `['zoom']` to switch things per frame (§7.5).
- Latitude ±90 is infinity in Mercator — rings touching it silently fail to draw. Use ±89.999. And never
  ring a pole in one polygon: split at longitude 0 (§7.2).
- `SolidPolygonLayer` has no stroke; `stroked`/`getLineColor` are silently ignored (§7.6).
- GIBS blanks the leftmost ~10% of any GetMap whose west edge is at or beyond −179.92°. Inset the
  antimeridian half by one pixel (§10A.5).
- `viewBox()` must size the fetch box by GLOBE geometry, not `512·2^z`, or the limb is never fetched
  (§10A.5).
- A GIBS frame that is not yet published returns a valid, fully transparent PNG with 200 OK. Test the
  pixels; a dropped satellite is a hole and a hole reads as clear sky (§10A.7).
- GIBS renders GOES/Himawari infrared through a grey ramp PLUS colour below ~−12 °C, so brightness is
  not monotonic in temperature (§10A.2).
- The clear-sky reference is temporal, never spatial, and needs ~10 days or storms hollow themselves
  out (§10A.4).
- Geostationary sees nothing above ~65°N — the 2026 track's Greenland leg is blank (§10A.8).
- A MapLibre `image` source maps corners linearly in **Web Mercator** — feed it a reprojected raster, not
  plate carrée (§7.2).
- A `CanvasSource` texture that is square AND power-of-two samples as black (§10.3).
- `pathPalette()` owns every path colour; basemaps declare `dark` (§7.6).
- Don't set `position` on a MapLibre marker wrapper (§7.9).
- Nothing pushes to `mapMarkers`/`pathMarkers` except `registerMarker` (§7.4).
- Low ΔT-era agreement in `noncentral_durations.py` is the ΔT upgrade working, not a bug. Gate on the
  USNO rows (§9.6).
- The generator's in-run AUDIT checks gaps and turns only — a missing or 2-point-stub limb passes it
  silently. Structural limb checks live in `audit_paths.py` (§9.7).

---

## 15. CHANGE LOG

One line per session. **The knowledge lives in the topical sections above; this is only a trail.**

- **2026-08-18** — Live cloud (#F2c) made usable (§10A). Dateline stripe traced to a GIBS bbox-edge
  bug, not our geometry; render 13× faster (`bgAt` was 89% of it); fetch parallelised and the frame
  probe cached; globe-vs-Mercator fetch box fixed; storm hollowing traced to a 4-day clear-sky
  reference and fixed at 10; polar extrapolation removed; `cloud.js` teardown fixed (the ☁-off bug);
  frame age now ticks. `test_satellite.js` rewritten — it had been testing an architecture two
  rewrites old and sections 7–10 had never run. `test_forecast` and `js/forecast.js` confirmed lost.
  The four `SESSION-2026-08-*.md` files were folded into §10A and deleted.
- **2026-08-13** — Cloud slices precached; `js/cloud.js`, `shadow-layer.js`, `shadow-ui.js` found
  missing from CORE and added (§12). BUILD `2026-08-13a`. **Deployed and verified on iOS**: Safari
  site data cleared, loaded online, installed standalone, went offline — cloud layer renders, and
  renders for an eclipse in a different month, so all 96 slices landed. Found while verifying: test suites are in
  the wrong directory and cannot run (§13), `audit_paths.py` is missing (§9.7), a duplicate generator
  is back (§9), and the user has no Node (§4).
- **2026-08-12** — HANDOFF restructured from session-log to topical, one home per fact (see THE FILING
  RULE at the top). §16 recovered from commit `e1eb7f6` after a previous session declared it lost without
  checking git.
- **2026-08-11** — Cloud-cover climatology overlay shipped (§10). Commit `e8e3c75`.
- **2026-08-09** — Contact angles corrected (§9.3); obscuration solid fixed (§9.4); marker registration
  restructured (§7.4); relief fade + flat city dots (§7.2, §7.9); camera moves on locate and log jump-to
  (§7.8); log toolbar to four icons (§11.3); Settings → Info, shadow slider and tz select deleted
  (§11.2); About deep links made relative (§11.1); `tools/set_build.js` (§4). Commit `e1eb7f6`.
- **2026-08-06** — Renamed to followtheshadow; t-shirt poster shipped (§11.4); Cesium purged from `sw.js`,
  exposing two real precache gaps (§12.2); iOS fixes (§11.6). Commit `eaafa70`.
- **2026-08-05** — User log shipped (§11.3); visual language decided and test-enforced (§11.5); catalogue
  audit run and passed (§9.7); test suites (§13). Commit `cd7601d`.
- **2026-07-29** — One style, no `setStyle` (§7.1); NE2 offline relief (§7.2); on-map basemap picker
  (§7.5); adaptive path colours (§7.6); non-central durations (§9.6). Commit `b3e0ef2`.
- **2026-07-28** — Terrain shadows wired into the app (§8.6). Commits `a1f0a53`, `3327bee`.
- **2026-07-18** — Cesium reverted; MapLibre restored (§6). Commit `b53dfc1`.
