# ShadowChaser — HANDOFF (consolidated 2026-07-19)

Single authoritative status + knowledge document. Supersedes all prior HANDOFF versions and
the 2026-07-18 correction block. `TODO.md` owns durable task detail; this file owns status,
architecture, derivations and lessons. Do not duplicate between them.

**Repo:** github.com/Alyosha47/ShadowChaser — active branch **`maplibre`**.
**Site:** followtheshadow.com/app

---

## 1. WHAT THIS PROJECT IS

An **offline-capable eclipse-path PWA**. A Python generator computes shadow-path JSON from
Besselian elements for ~11,898 eclipses; a vanilla-JS frontend renders them on a MapLibre
globe with deck.gl geometry.

**Non-negotiable standard: ships only when every case is correct vs Xavier Jubier's KMZ
ground truth.**

User's goal: *"readable, comprehensible, not over-engineered, elegant, tidy, and genius"* —
and it must work fully offline in the field.

---

## 2. THE RENDERER STORY — READ BEFORE TOUCHING THE MAP

The app was migrated MapLibre → Cesium and then **reverted to MapLibre**. The migration was
recommended on a false premise and cost months.

| Claim made | Reality (tested 2026-07-18) |
|---|---|
| "Cesium natively does shademap-style terrain shadows" | **FALSE.** Native shadow map (`viewer.shadows` + `ShadowMode.ENABLED`) breaks at low sun angles — big black square artifacts — exactly the eclipse case. Even tuned (tight `maximumDistance`, 4096 map, lighting off) it works only close-in and top-down, and shadows vanish above ~24.3 km camera altitude. |
| "Cesium is the reason the shadow feature is possible" | The technique that works (per-pixel GPU raymarch) was **never Cesium-native**. It is how shademap.app works, and shademap ships as a **MapLibre/Mapbox plugin** — i.e. it was always available on the stack we left. |
| Cesium's real benefit | **Genuine:** a true WGS84 sphere retires antimeridian/pole seam bugs. That is why branch `cesium` is preserved, not deleted. |

**Do not re-recommend Cesium for shadows. Do not assert that a library does something
"natively" without verifying it first.** This is the single most expensive lesson in the
project's history.

### Branches
- **`maplibre`** — active, pushed. MapLibre GL 5.5.0 (CSP build) + deck.gl.
- **`cesium`** — preserved, functional, heavier. Kept for the seam-free sphere.
- **`PARITY.md`** (repo root) — shared vs renderer-only files, and known behavioural
  differences. **Follow it** or the branches silently diverge.
- `sw-dedupe` — abandoned experiment, unmerged (see §9.3).

### Renderer wiring (already done — don't re-break)
- `index.html` loads `vendor/maplibre-gl-csp-5.5.0.js`, and **`maplibregl.setWorkerUrl(...)`
  must run before any map is constructed**.
- It also loads `vendor/deck.min.js` and aliases `window.DeckGL = window.deck` (the bundle
  exports `deck`; the renderer calls `DeckGL`). **All eclipse geometry is deck.gl**
  (`PathLayer` / `SolidPolygonLayer`), not MapLibre — forget deck.gl and the map renders
  with no paths at all.
- `js/map.js` **is** the live MapLibre renderer (formerly `map_maplibre.js`).
- Pin / sun arrow / GE-marker designs were ported from the Cesium build; exact values in
  **`DESIGN_SPEC_cesium_map.md`**. Pin scales with zoom (mirrors Cesium
  `scaleByDistance(5.0e5→1.0, 2.0e7→0.45)`); arrow has a 300 km world cap with a 0.55
  minimum scale; `transform-origin: 50% 100%` so the pin scales about its tip.

---

## 3. LOOSE ENDS — OPEN, RECORDED NOWHERE ELSE

1. **Dead shademap code with a live key in `js/map.js`.** Wired up before the decision to
   build our own raymarch. Inert (off by default, fails soft if the library is absent) but
   it is dead code carrying an API key. **Recommend deleting** `SHADEMAP_KEY`,
   `initShadeMap`, `setShadeDate`, `setShadeVisible`, `toggleShade`, `isPositionInSun`, and
   the `vendor/shademap.umd.min.js` script tag in `index.html`. The key is localhost-only;
   shademap quoted **$25/month** for custom domains, which is why we built our own.
2. **`addPin` gap — UNRESOLVED.** The Cesium renderer exposed `addPin`; the MapLibre
   renderer does not, and ~3 call sites elsewhere in the app call it. Verify whether this is
   actually breaking anything, then reconcile.
3. **Cesium ion token is committed** in the spike files. Restrict it to
   `followtheshadow.com` in the ion console before any public release, or rotate it.

### Standard regression test for any shadow/sun work
Eclipse **2026-08-12**, observer **41.9851°N, 3.4186°W**, greatest eclipse there
**18:28:41 UTC**, **sun altitude 7.8°, azimuth 282.9°**, totality ~1m45s. Deliberately a
very low sun — the case that broke Cesium's native shadows, so it is the right test.

---

## 4. TERRAIN SHADOWS (#F4) — WORKING SPIKE

`spikes/raymarch.html` — **our own GPU terrain-shadow raymarch. No API key, no dependency,
no $25/mo.** User-confirmed: renders correctly over an OSM basemap, smooth, shadows lengthen
and sweep as the time slider moves. Current spike header reads **v4 (sea-level clamp)**.

The build-vs-buy decision is **made** — shademap works and is turnkey, but ShadowChaser is
being given away free. Don't relitigate.

### Architecture — two-pass MapLibre custom layer
1. **PASS 1 — atlas.** Terrarium DEM tiles
   (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` — free,
   CORS-OK, `crossOrigin='anonymous'`) are drawn into a single **1024² FBO texture** covering
   the viewport **plus one tile of margin**, so off-screen ridges still cast in. Elevation
   stays **RGB-encoded** in the atlas and is decoded at sample time — this avoids
   float-texture extensions and keeps it mobile-safe.
2. **PASS 2 — raymarch.** Full-screen quad over the atlas rect. Per pixel, march toward the
   sun through the atlas testing `terrainHeight > h0 + d·tan(alt)`. **96 steps over 20 km.**
   Lit pixels `discard`; shadowed pixels draw `rgba(0.02,0.05,0.16,0.55)`.

Key constants: `DEM_Z_MAX=12`, `ATLAS=1024`, `MARCH_M=20000`, `STEPS=96`, shader loop capped
at 128 iterations with a `u_steps` break (WebGL1 needs a constant loop bound).

### Gotchas already solved — DO NOT RE-BREAK
- **Texture filtering must be `NEAREST`** (both tile textures and the atlas). Linear blends
  the *encoded* RGB and yields garbage elevations.
- **Terrarium encodes bathymetry as negative height.** The sea surface is flat, so the
  shader clamps `max(h, 0.0)` — otherwise underwater mountains cast shadows across the
  ocean. Coastal cliffs still cast onto water correctly. *(This is the v4 fix.)*
- **Sun below horizon:** `u_night` uniform paints a flat `rgba(0.02,0.03,0.10,0.55)` wash
  instead of marching, and `tan(alt)` is floored at `alt = 0.05°` so a near-zero altitude
  can't produce an infinite ray.
- **MapLibre v5 changed the custom-layer render signature** — it passes an options object;
  the matrix is at `args.defaultProjectionData.mainMatrix`, not a bare array. The spike
  probes `args.defaultProjectionData.mainMatrix || args.mainMatrix || args.matrix`.
- **Mercator y grows southward** → sun direction is `(sin(az), -cos(az))`.
- **Metres per mercator unit at latitude φ:** `40075016.686 · cos(φ)`.
- Solar position in the spike matches the app's `computeEclipse` to **~0.2°**.
- The spike carries **on-page A→E tracing** (`#log`). Keep that pattern in any standalone
  spike — the user tests on a phone and on slow connections where the console isn't handy.

### Next steps to productionise (~a day)
1. **LRU cache eviction** — `this.tiles` grows unbounded; cap ~200 textures.
2. **Zoom-aware DEM level** — currently hard-capped at z12 with a crude 80-tile safety limit
   that silently truncates coverage when zoomed out. Pick a DEM zoom below the map zoom so
   tile count stays ~20 at any zoom.
3. **Scale march distance with zoom** — fixed 20 km is sub-pixel when wide, wasteful when tight.
4. **Integrate into `js/map.js`** as a real layer with a UI toggle, fed the **selected
   eclipse's max instant** (the app already computes it) instead of "now".
5. **Mobile test.** The earlier CPU sunmap ran fine on the user's phone; the GPU version
   should be lighter, but **verify** — including backgrounding, which has bitten this app.
6. **Offline (optional).** Terrarium tiles are plain PNGs; `sw.js` could cache them like
   basemap tiles. User has said **online-only is acceptable**, so nice-to-have, not a blocker.

### Spike files
- `spikes/raymarch.html` — the working GPU shadow renderer (v4).
- `spikes/dem_spike.html` — stage-1 proof: DEM → GPU texture, decoded in-shader.
- `spikes/sunmap.html`, `spikes/horizon3.html` — earlier CPU approach; exact per-point
  sunlit/shadow answer with margin in degrees. Still the best basis for an
  "is *this specific spot* sunlit?" readout, and works offline from cached samples.

---

## 5. HOW TO WORK WITH THIS USER (load-bearing)

- **BE EXTREMELY CONCISE.** Reference docs like this are the exception; chat is not.
- **ONE step at a time.** Don't pile up instructions or interleave threads of work.
- **NEVER break working code.** `node -c` proves syntax, not behaviour.
- **NEVER GUESS. Verify.** Read the repo/library/API. If you can't verify, say so.
- **Don't solve problems by throwing away solutions.** Never quit; root-cause it.
- **TIDY, CHAFFLESS, PATCHLESS code.** Replace structures whole. Three guards on a path =
  the structure is wrong.
- **DON'T over-engineer.** The simple boring obvious version is usually right. Look for the
  platform-native solution before writing code.
- **Recommend ONE solution.** Don't present menus as a stalling tactic — but don't make
  UI/default/precision decisions unilaterally either.
- **Don't say "you're right" reflexively.** If the user pushes back, honestly re-examine —
  don't fold instantly, don't dig in.
- **When asked "is this OCD-tidy/elegant?"** — honest audit, both sides, never reflexive yes.
- **Never assume he's tired. Never suggest stopping.** The user decides when done.
- Never do Mac-side debugging of the iPhone (settled; don't re-raise).
- **He now uses git** — branches, commits and pushes from the command line. He still prefers
  receiving **finished files** ready to drop into their folders.

### The standing rule (earned expensively)
**Before writing per-frame code or geometry tricks to fake a visual effect, NAME the library
API that should do it. If you can't name one, say so out loud rather than hacking silently.**
Proofs: the land fill was floated as a primitive *over* the globe (→ clamp-to-ground → iOS
crash) when the answer was **imagery**; eclipse paths were *lifted* to win a depth fight when
the answer was **`depthFailMaterial`**. Same for `isLocationOccluded` (§8.4).
**Corollary — beware "safety rails":** constants added as harmless guards became the DOMINANT
term twice (a 2 km arrow floor at street zoom; a screen floor overriding a ground cap). If two
limits can fight, decide which must win and check the arithmetic at BOTH extremes.

### Recurring anti-patterns (user's own words)
1. *"You waste my money."* — reflexive over-engineering on simple tasks (the textarea-autogrow
   saga, resolved by one line of CSS). Platform-native first.
2. *"Why undo what I asked explicitly?"* — address the complication, don't pivot away.
3. *"You are gaslighting me."* — no false "fixed" claims.
4. *"Let's call it for today."* — never say it.
5. *"Patchy patchy I don't like it."* — replace whole.
6. *"You keep over-complicating."*
7. *"At what point do we do structural work?"* — refactor when it earns its keep, not pre-emptively.

### Opus vs Sonnet
**Opus:** feature scoping (#F1 personal log, #F2 weather overlay), multi-file architecture,
UX with no obvious right answer (#F5 global-vs-local semantics), hard math. *(The V-angle
math — the canonical Opus item — is DONE.)*
**Sonnet:** SVG/CSS polish, label renames, contrast nudges, mechanical file splitting, most
bug-fix follow-ups in the now-untangled code.

---

## 6. DELIVERY, BUILD & DEPLOY

### Delivering work
Hand over the **changed files themselves**, ready to drop into their folders
(`js/*.js` → `js/`, `css/app.css` → `css/`, `index.html` + `sw.js` → repo root). Deploying is
a **manual file upload** to followtheshadow.com/app (Bluehost/Apache); git commits do NOT
deploy. He has a one-click sync but must first save each file into its local folder — **that
is the tedious part, so keep the number of changed files down and say plainly which files
changed and where each goes.** He **declined** a zip bundle; don't push it again.

### BUILD + the service worker (this cost a whole night — internalize it)
`index.html` holds `var BUILD = 'YYYY-MM-DD'+letter` — the **single source of truth** — and
`?v=BUILD` is appended to `js/*`, `css/*` and `data/*` fetches. **Bump BUILD on every deploy.**
`sw.js` serves cache-first with `ignoreSearch`, so an unbumped BUILD masks your change behind
the old cached copy.
- **Caveat:** the `?v=` on `<script>` tags is hardcoded per-tag and **has drifted before** —
  some were pinned at an old date and served stale copies of edited files. When you bump
  BUILD, bump **every** `?v=` in `index.html` (the `<meta name="build">`, every `?v=`, and
  `var BUILD`).
- Vendored files in `vendor/` take **no** `?v=BUILD` — version lives in the filename.

### Deploy checklist
Replace files → bump BUILD everywhere → hard-refresh → verify on server → on a real device,
check the local globe shows and a map click doesn't error.

### Permissions (THE most expensive operational lesson)
The iOS "black map" was **not** an iOS or MapLibre bug — it was **production file
permissions.** New folders uploaded without world-execute → server returns **403** for
everything inside (basemap `.gz` 403, MapLibre script 403 → `maplibregl is undefined` → black
map). Tell-tale: works on localhost, fails on the server; 403 not 404.
**Fix: `chmod 755` on new directories, `644` on files, after every upload.** You only hit this
when a deploy creates a NEW folder. Diagnostic: open `https://your-url/js/search_parser.js`
directly — 403 = permissions, 200 = fine.

### When "it broke again" with no console error
Application → Service Workers → Unregister / Clear site data → hard reload. With the service
worker, a hard refresh alone is **not** enough. Clean room = fresh **Incognito** window. A
wedged normal-profile worker clears via `brave://serviceworker-internals` → Unregister, or a
browser restart; on iOS, Settings → Safari → Advanced → Website Data → delete the site.
Deleting a cache by hand does NOT re-trigger `install`. On a real BUILD bump in production
this is automatic (`updateViaCache:'none'` + cache name keyed to BUILD; `activate` deletes the
old cache).

### Diagnosing on iOS (no built-in console)
Temporarily drop `<script src="https://cdn.jsdelivr.net/npm/eruda"></script><script>eruda.init()</script>`
into `<head>` for an on-screen console/Network panel. Remove after. (eruda's Network tab shows
fetch/XHR only, not `<script>` or SW script tags.)

### Assistant's clone caveat
The assistant works in a fresh throwaway `git clone` each session. It does **not** reflect the
user's local state or BUILD. **Never trust the assistant's clone for `git log` / BUILD /
commit state.** The user's working copy is authoritative.

---

## 7. REPOSITORY STRUCTURE

```
ShadowChaser/
├── index.html          (HTML only; CSS external; holds BUILD constant)
├── sw.js               (service worker — the most fragile file in the project)
├── manifest.webmanifest
├── .gitignore          (data/paths/, .DS_Store, *.pyc, __pycache__/)
├── HANDOFF.md          (this file — status & knowledge)
├── TODO.md             (durable detail — candidate fixes, UX questions, feature pool)
├── PARITY.md           (maplibre ⇄ cesium branch sync rules)
├── DESIGN_SPEC_cesium_map.md   (pin / arrow / palette values — ported, still authoritative)
├── vendor/
│   ├── maplibre-gl-csp-5.5.0.js + maplibre-gl-csp-worker-5.5.0.js   (official CSP build)
│   ├── maplibre-gl-5.5.0.css
│   ├── deck.min.js
│   └── shademap.umd.min.js      (DEAD — slated for deletion, see §3.1)
├── css/app.css         (all styles; never put vendor CSS here)
├── fonts/              (JetBrains Mono, Cormorant Garamond woff2)
├── icons/              (icon-192.png, icon-512.png — provisional glyph)
├── spikes/             (raymarch.html, dem_spike.html, sunmap.html, horizon3.html)
├── data/
│   ├── basemap/        land / countries (antimeridian-split), lakes, rivers, cities  (.gz)
│   │                   ocean.geojson.gz is ORPHANED — safe to delete
│   ├── besselian/      per-century element records — SOURCE OF TRUTH, git-tracked
│   └── paths/          generated *.json.gz corridors — NOT git-tracked (build artifacts)
├── data build tools/   gen_eclipse_paths.py — the canonical generator (+ dev scratch)
└── js/
    ├── cities.js       lookupCity, lazy index from basemapData.cities
    ├── details.js      renderData, buildContactRows, contactIcon, lookupElevationAndTz
    ├── eclipse.js      computeEclipse, fundamentalArgs, sunAltAz, findMaximum, findContact,
    │                   getV(t,interior)   — strict-mode UMD
    ├── format.js       fmt*, fmtUTAnchored, fmtLocalAnchored, eclipseIcon, horizonIcon
    ├── init.js         bootstrap; buildTzSelect, initMap, fetch index.json
    ├── list.js         renderList, selectEclipse (←/→ arrow-key navigation)
    ├── local.js        computeLocal, computeSunriseSunset, findHorizonCrossing, scanLocation
    ├── map.js          THE RENDERER — MapLibre + deck.gl; isOffline, seamFreeLines,
    │                   updateMarkerOcclusion, updateOvalVisibility, _deckLayers retainer
    ├── search.js       parseCoords, onSearchChanged
    ├── search_parser.js pure parser, UMD, strict-mode
    ├── share.js        share modal/sheet (tabstop format)
    ├── state.js        chunkCache, AppState get/set/on + window forwarding shims
    ├── tabs.js         switchTab, switchSidebarTab, TZ_ZONES
    ├── tz_lookup.js    3rd-party offline timezone lookup, bundled
    └── url.js          pushState, restoreFromHash, event wiring
```

**Script load order** — vendor CSS, MapLibre CSP JS, `setWorkerUrl`, `deck.min.js` +
`window.DeckGL = window.deck`, `js/tz_lookup.js`, `css/app.css?v=BUILD`; then at body end:
format, state, tabs, cities, search_parser, eclipse, search, list, local, details, share,
map, url, init.

**All runtime dependencies are local — no CDN in the shipped app.** That is the prerequisite
that lets the service worker cache everything. (`data build tools/*.html` still reference
unpkg; they are dev scratch, not shipped.) Vendor convention: version in the filename,
self-cache-busting, no `?v=BUILD`, vendor CSS never in `css/`.

---

## 8. HOW THINGS WORK (banked knowledge)

### 8.1 Connectivity — one owner
`map.js` owns `isOffline()`:
```js
function isOffline(){ return _forceOffline || _probedOffline === true || navigator.onLine === false; }
```
**iOS never reports offline** — `navigator.onLine` lies and the `offline` event doesn't fire.
So an **active probe** runs every 5 s with a 3 s `AbortController` timeout (iOS *hangs*
rather than failing an offline fetch) and cache-busting (iOS ignores `no-store`).
**Negatives are DEBOUNCED** (2 consecutive failures before flipping offline): a single
timed-out probe must not flip the app, or a slow load oscillates offline↔online and rebuilds
everything repeatedly. Positives are trusted instantly; `navigator.onLine === false` is
trusted instantly. `_forceOffline` is the debug toggle (`forceOfflineMap(on)`).
**Route every new network-gated feature through `isOffline()`** — don't re-derive offline
state inline. The elevation lookup in `details.js` already does.

### 8.2 Offline basemap data — fix the DATA, not the renderer
A polygon ring crossing ±180° or wrapping a pole triangulates the wrong way (circumpolar
stripes, wrong-hemisphere fills, malformed Antarctica). `land.geojson.gz` and
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

**Seam-free STROKES (`seamFreeLines`).** The ±180 split inserts edges along the meridian and a
ring of points at the pole — correct for FILL, wrong for `line` layers (meridian lines over
land, a circle at the south pole). `seamFreeLines(fc)` rebuilds outlines as LineStrings,
breaking on seam edges (both endpoints |lon|≈180, same side) and polar-cap edges (both
|lat|≥89.9). Fill keeps the split polygons; `coast` and the border line source get seam-free
lines. Verified: 0 seam/pole edges, coastlines intact.

### 8.3 Antimeridian CAMERA centering (elegant single path)
On eclipse select with no observer pin, unwrap all path longitudes into a continuous window
anchored on the greatest-eclipse meridian, then one `fitBounds`:
```js
var anchor = (ep.ge && ep.ge[0] != null) ? ep.ge[0] : allPts[0][0];
var lons = allPts.map(p => anchor + (((p[0]-anchor)%360+540)%360-180));
// fitBounds [minLon,minLat]..[maxLon,maxLat], padding 40, maxZoom 6, duration 800
```
Replaced an old `lonSpan>180 → flyTo(GE)` two-branch patch. **Design note:** with no pin the
globe intentionally frames the WHOLE path centered on the path midpoint (not GE) — deliberate
and preferred. The observer-set branch (`flyTo(coords, zoom≥4)`) is unchanged.

### 8.4 Far-side marker occlusion (`updateMarkerOcclusion`)
HTML markers are DOM overlays. MapLibre v5 fades an occluded marker to `opacityWhenCovered`
(0.2) but leaves it faintly visible **and still clickable** — so a far-side marker could
capture a click meant for the surface. On every `render`, use MapLibre's own globe-aware test
as the SINGLE predicate driving BOTH visibility and pointer events:
```js
var occluded = map.transform.isLocationOccluded(m.getLngLat());
el.style.visibility    = occluded ? 'hidden' : 'visible';
el.style.pointerEvents = occluded ? 'none'   : 'auto';
```
**Lesson:** the first version hand-rolled a 90° great-circle cull, which diverged from the true
perspective horizon (a globe shows slightly *less* than a hemisphere) — leaving a band where a
marker was visually behind the globe yet judged front-side. MapLibre 5.5.0 was in use the whole
time; `isLocationOccluded` should have been used from the start. **Read the platform API before
hand-rolling trig.** Both halves (visual + click) are CLOSED. A fully-WebGL marker
(deck.gl IconLayer) is not warranted — blocked by `interleaved:false` and deck.gl's polar
triangulation bug (#R3).

### 8.5 Umbra ovals hide at high zoom (`updateOvalVisibility`)
Ovals are useful zoomed out but obscure the point being inspected up close, so they hide past
`OVAL_HIDE_ZOOM` (=7). The `umbra-ovals` SolidPolygonLayer is built with
`visible: map.getZoom() < OVAL_HIDE_ZOOM`; a `map.on('zoom', …)` listener `clone()`s that one
layer into a fresh array (deck.gl diffs by reference) and re-pushes via `setDeckLayers`, which
retains the array in `_deckLayers` for targeted swaps.
- **KEY DECK.GL FACT:** deck.gl does **not** re-evaluate accessors (`getFillColor` etc.) on
  zoom. Accessors are cached as GPU attributes and only re-run on an explicit
  `setProps`/`updateTrigger`. `getFillColor: () => alpha(zoom)` computes once and freezes.
  Any zoom-reactive styling must be driven by a zoom listener calling setProps. (deck.gl 9.3.3.)
- Open feel question in TODO: blink vs gradual fade. User is living with the blink first.

### 8.6 Map-click pointer events (resolved; documented so it isn't rediscovered)
deck.gl's overlay canvas captured pointer events before MapLibre saw them. Fix, live:
after `map.addControl(deckOverlay)`, set `#deckgl-overlay { pointer-events: none }`. Keep it.

### 8.7 iOS Safari cross-origin error masking
CDN-loaded script errors surface as `error @ ?:?` (blank message/source) due to CORS. In an
on-screen error reporter, filter `!e.message && !e.filename` to drop that noise and surface
real same-origin errors.

---

## 9. SERVICE WORKER / PWA (done 2026-05-31; still current)

A true no-signal reload loads the app from Cache Storage. Verified offline: globe renders,
present-day eclipse draws, map-click gives local circumstances, per-century scan works.

**Design (deliberately simple):**
- **One version source.** `VERSION` is read from the registration URL (`sw.js?v=BUILD`), so
  BUILD stays the only number. Cache name = `shadowchaser-<BUILD>`; `activate` deletes every
  other cache.
- **`ignoreSearch` on all cache lookups.** The cache name already pins the build, so precache
  URLs are query-free and `foo.js?v=BUILD` matches cached `foo.js`. This killed a long-running
  phantom-cache-miss bug (the "blue marble, no land" symptom).
- **`updateViaCache:'none'`** on registration, or stale HTTP-cached worker code never updates.
- **Navigations are network-first, time-bounded.** Online → fresh index.html, so a deploy is
  picked up immediately and registers the new worker (no manual clear). If the device reports
  offline, serve the cached shell instantly; otherwise race the fetch against a 2.5 s timer and
  fall back to cache. (Cache-first navigation caused "the old worker won't update"; a
  no-timeout network-first froze the page when iOS left an offline fetch hanging. This handles
  both.)
- **CORE (atomic `addAll`):** index.html, favicon, css, all js, vendor (CSP build + worker),
  the 6 used fonts, basemap `*.gz`, `data/index.json`. Any failure fails install.
- **DATA (best-effort loop):** all 50 besselian centuries (~9.5 MB — makes scan + local
  circumstances work offline for any era) + paths for **1900–2100 only** (paths are ~6 MB per
  century, ~274 MB for the full set). Outside that range, cached on demand when viewed online.
  User's decision: this era + last century, for birthdays etc.
- **Fetch (non-nav):** non-GET and all cross-origin (raster tiles, connectivity probe,
  elevation API, and now Terrarium DEM tiles) pass straight through. Same-origin GETs are
  cache-first (ignoreSearch) then cache-on-demand; offline misses return a quiet 504.
- **The one expected console line offline:** a single probe ERR at startup — that IS the
  connectivity detector doing its job. It fires once.
- **CSP:** none is set. If one is ever added, allow `worker-src 'self'` plus the worker URL
  (the CSP build loads its worker from a real file, not a blob).

### 9.1 Known, measured, NOT fixed: duplicate downloads
Every asset downloads **twice** on a build change (~317 requests, 22 MB). Cause: the page
requests `js/map.js?v=BUILD` while `sw.js`'s precache lists say bare `js/map.js` — two URLs,
two downloads. **Pre-existing** (present throughout the successful offline milestone) and
**harmless**: SW-initiated fetches are served from `(disk cache)` in 2–9 ms; load ~11 s,
DOMContentLoaded ~950 ms.
**Two failed fixes — do not repeat:** (a) a single-flight `fetchOnce()` inside `sw.js` is
*structurally impossible* — site data is cleared between builds, so no SW controls the page at
load and the page's fetches never reach the handler; (b) precaching versioned URLs +
`'reload'`→`'default'` **broke the eclipse paths** (reverted, branch `sw-dedupe`).
**The real fix, for a calm dedicated session:** stop precaching what the page fetches for
itself (the fetch handler already caches on demand); precache only what the page never
requests. **`sw.js` is the most fragile file in the project — treat it so.**

---

## 10. ECLIPSE MATH & PATH GENERATION — DONE AND BANKED

Generator: `data build tools/gen_eclipse_paths.py` — **exactly one generator file**. Do not
reintroduce a `_v2`/`_v3` suffix; version history is git's job. (A duplicate old copy once
cost a whole session chasing the wrong baseline.)

### 10.1 Validation vs Jubier
| Curve | vs Jubier | Verdict |
|---|---|---|
| Umbra limits | sub-km | good except grazing-tip zigzag (§10.4) |
| Green line (Max-on-Horizon) | 0.4–1.8 km | good |
| Terminator (Sun Rise/Set) | 3–5 km | good |
| Penumbra | ~9 km | close; user accepts (naturally fuzzy) |
| Bisector | removed | redundant with green |

The **green line** is traced as the zero level set of {sun altitude at greatest eclipse = 0}
via a predictor–corrector (seed on sign change, step along the tangent, Newton-correct onto the
contour). It is the first path built on the general implicit-field engine the whole path family
is intended to migrate onto. The old `_bisector_curves` measured 33–43 km off and was removed
wholesale.
Penumbra detail: our edge sits ~7–10 km INSIDE Jubier's, asymmetric N/S — a boundary-definition
(threshold) difference on a genuinely fuzzy edge, **not** random error.

### 10.2 Umbral-limit topology — CLOSED
Every limb shape now handled; each fixed at root:
- **Near-pole loops** (1533): depth field switched from ever-total (`_cone_depth`) to
  **local-in-time peak** (`dep_local`, hill-climb to the nearest local max of g(t)), closing the
  loop-interior gap. `perpendicular_limits` takes per-point times; march cap 600 km.
- **Terminus completion** (`_terminate_on_green`): every limb ends exactly on the green line at
  its analytic `_GREEN_TERMINI` tip (mag→1 ∩ alt→0 is a tangency the iterative march can't
  reach, so the exact corner is supplied). Corrected a global ~18–25 km terminus shortfall on
  ALL central eclipses → 0–3 km of Jubier.
- **Non-central grazers + central one-limit** (Tn/Ts, A±/An/As): dispatch on the type-code 2nd
  char; analytic `umbra_pts` walk per limb, **each over its OWN validity interval** (a shared
  interval under-samples the shorter limb to nothing). Fixed 1511/1523/1529/1552/1569/1598 and
  the two-limb cases 1547/1554/1565.
- **Pole-transit split** (`_split_at_pole`): breaks a limb where two consecutive points are both
  at |lat|≥89.9 (a spurious across-pole connector). Fixed 1591.
- **Umbra `search_m` scales with path width** (`max(path_width_km · 500 · 1.5, 300 km)`) — a
  fixed 300 km window truncated the north umbral limit at high gamma/latitude (canonical case
  2600-05-05).
- **Oval bisect stops at the terminator** (`zeta=0`) instead of overshooting below the horizon.

**The `_terminate_on_green` regression — the hard lesson.** A first cut gutted normal eclipses
whose ends sit at sunrise/sunset rather than a polar tip: **2028-07-22** and **2041-04-30** both
collapsed to 2-point stubs. Two wrong turns first (a half-of-the-limb guard; a sun-altitude
gate — the data showed it does NOT separate the cases). **Root cause: a planar (lon,lat)
distance metric.** 2028's umbra crosses the antimeridian, so its endpoint (lon 180.8) and true
terminus (lon −179.5) are 14 km apart on the globe but ~360° apart on a plane → matched the
wrong terminus and truncated the limb. **Fix = the correct spherical metric (`_gc_dist`)
throughout, plus an end-correspondence guard** (a terminus completes only the end on whose half
its closest approach falls — handles ends with no terminus at all, e.g. an umbra that lifts off
mid-disc, as in 2041). Verified across 1203→2501, zero gutted.
**Lesson: on a sphere, use a spherical metric. And never ship a terminus-completion change
without the broad no-gut check.**

Similarly **REVERTED**: relabelling N/S by geographic latitude instead of the fixed side index —
caused 150–170° folds on 2017, 2026, 2002. The shipped generator is the validated v9 lineage.

### 10.3 The V-angle derivation (authoritative — do NOT re-litigate)
`eclipseIcon` draws the bead at `bx = cx + r·sin(V°)`, `by = cy − r·cos(V°)`, so **V is degrees
CLOCKWISE FROM ZENITH** (0=top, 90=right).

**The unit trap that defeated prior sessions:** Jubier prints **P** in degrees (0–360) and **V**
with no degree sign (0–12). **Jubier's V is a CLOCK POSITION**, so the icon target in degrees is
`Jubier_V_clock × 30`. Prior sessions compared our degrees to the 0–12 value and concluded the
math was broken — it was the units.

```
q = atan2( sin H , cos φ · tan δ − sin φ · cos H )     (Meeus 14.1)
P = atan2(u, v)                                        (contact PA, CCW-east)
V = 180 − P − q                                        (normalize to [0,360))
if interior contact (C2 or C3):  V += 180
```
`180 − (…)` folds two conversions: subtract q to rotate north→zenith, and the negation maps the
astronomical PA (CCW-east, on-sky) to the icon's clockwise-from-top screen convention.

**Why the interior +180 flip is principled, not an overfit:** `u = X−ξ`, `v = Y−η` is the
shadow-axis displacement from the observer. At C1/C4 the observer is at the penumbra edge and
(u,v) is well-defined. At C2/C3 the observer is ~on the axis, so (u,v)→~0, `atan2` is unstable
and lands on the OPPOSITE limb. Physically the bead is the Moon's leading edge going in (C2) and
trailing edge going out (C3) — opposite limbs. Callers: `getV(tC2,true)`, `getV(tC3,true)`.
**Lesson:** a mid-session spot-check fed Jubier's *published* P into the formula and looked 175°
wrong — the bug was in the CHECK. Validate by running the real pipeline.

Validation (|err| vs Jubier clock×30; budget ≈ ±3° rounding):
```
2023-04-20 Timor 8.35625°S 127.06312°E   C1 0.1  C2 0.7  C3 4.2  C4 5.5
2024-04-08 Mazatlán 23.15708°N 106.37959°W  C1 10.5  C2 5.4  C3 4.3  C4 0.9
```
Both hemispheres, exterior + interior. **CLOSED.**

### 10.4 Open: umbral grazing-tip zigzag (generator)
On grazing eclipses (~half of all) the umbral N/S limit shows a 300–1200 km gap plus a
~150–177° fold at one or both ends. **Root cause PROVEN:** the envelope-of-moving-shadow method
stops where the shadow axis leaves Earth's disk (|C|→1); totality continues to the terminator,
and the straight chord bridging that real stretch is the zigzag.
**Fix PROVEN:** trace the umbral limit as the cone–spheroid intersection contour — the zero
level set of h(lat,lon) = max_t(|L2 − ζ·tan_f2| − m), the same engine as the green line.
Sub-km vs Jubier (2017 N 0.28 / S 0.15) and it reaches the tips (1144 BCE: max gap 25 km = the
tracer step, vs the old 950 km chord).
**One blocker:** splitting the traced closed contour loop into clean N/S polylines. Simple
eclipses (2033) split perfectly (worst turn 2°); corridor-shaped ones do not yet. Four splitter
approaches tried and rejected; next idea is maximum-curvature tip detection. Full ledger in
TODO "Umbral grazing-tip zigzag". WIP saved in sandbox, NOT shipped — v9 envelope remains the
shipped umbra. **This supersedes the old "Corridor sampling artifacts" entry** — same
phenomenon, now root-caused. (For the record, corridor vertices are themselves accurate: every
one evaluates to magnitude 1.0000 via `_max_magnitude`; the visible tip protrusions and kinks
are sampling artifacts of the perpendicular bisect, and the user's physical principle — a
shadow on a sphere is always smooth, so any kink is method, not geometry — is the right frame.)

### 10.5 Confirmed correct — not bugs
- One-limit grazers (1957-04-30 annular N-only; 1957 October total other-side-only).
- Terminator "blob twist" near poles (2006, 2023, 2041) — the sunrise/sunset lemniscate is a
  closed teardrop that self-closes; matches Jubier/Espenak.
- The 1957 "missing path" saga was a **stale cached `.gz`** because BUILD wasn't bumped after a
  rebuild. Data, generator and file were all correct.

### 10.6 Repo bloat
`data/paths/` (~274 MB of `.gz`) was git-tracked, so every regeneration committed a fresh full
copy forever (gzip can't delta-compress). Paths are build artifacts; source of truth is
`data/besselian/` + the generator, and deploy is SFTP. `.gitignore` + `git rm -r --cached
data/paths` stops growth but does not shrink existing history (that needs a destructive
`git filter-repo` + force-push — deferred).

---

## 11. FEATURE STATE

### Working
- **Search** — tokenized filters: year ranges (`2026`, `2026-2030`, `1994+`, `after 2100`,
  `44BC`, `10BCE`), months, days, type, magnitude/obscuration, saros, coordinates, cities,
  today/now. Cities longest-match-first (3-word max). Coords at 5 decimals (explicit user pref).
  Search-range setting (Modern / ±500y / Extended / All), persisted, bypassed when an explicit
  year filter is present. "Obscuration" is the canonical term throughout.
- **List** — centered on today (250 either side when unfiltered); selection persists when the
  search is blanked; icons use GLOBAL eclipse type; ←/→ arrow-key navigation.
- **Eclipse icons** — unified `eclipseIcon({type, phase, magnitude, angle, size})`: total =
  moon+corona, annular = orange ring, hybrid = half/half, partial = sun + offset moon; C1/C4
  crescent, C2/C3 diamond bead at `angle`. viewBox 36, sun r 9; SUN `#e8a04a`, MOON `#0a0c10`,
  HALO `#dde3ec`. Rise/Set = half-disc on horizon + rays (sunset is sunrise flipped).
- **Contact-times table** — local default, header cell toggles Local/UT, persisted as
  `sc.timeMode`. Sorted by absolute decimal-hour UT; display appends `(±Nd)` for events on a
  different calendar day than MAX. Rise before tMax / Set after, ±18 h window.
- **Tabs / Details** — folder convention (active tab matches panel surface, inactive recessed;
  container provides the divider; active overlaps with `margin-bottom:-1px`; a tab never has its
  own bottom border).
- **Share** — tabstop-aligned text: header, GE block (duration/time/location/magnitude), path
  width, local circumstances, URL, credit. Share-link encoding (`e=` + coords only, not full
  search state) is done. About has a mailto bug-report link and an Android note.
- **State** — `AppState` get/set/on plus window forwarding shims. `AppState.on()` exists but is
  **not** wired to subscribers; manual re-renders still required. Module-locals `_currentRec`,
  `_timeMode` deliberately left in place.
- **CSS** — all in `css/app.css`. Inherit, don't re-declare; one token source
  (`--bg/bg2/bg3/gold/--pin-red`), no raw hex, no ID selectors for styling.
- **The map's cosmetics are finished** — sun arrow, push-pin observer marker (tip = the
  coordinate), orange GE diamond, city dots and labels, borders that fade with zoom-out, umbra
  ovals, basemap picker, load crawlbar, Details-tab throb on new location. Exact values in
  `DESIGN_SPEC_cesium_map.md`. The sun arrow points at the **Sun's azimuth at maximum**, not
  along the centreline. A pin drop-shadow was tried and rejected as a smudge.

### Open bugs
- **#F4 terrain shadows** — spike works; needs productionising (§4).
- **#R3 polar corridor "onion ring" (deck.gl).** 1950-09-12 corridor + ovals render as polar
  onion rings; SolidPolygonLayer mis-triangulates polar polygons even with clean unwrapped
  data. Workaround: corridor fill DISABLED (path lines only); ovals still filled. 4 candidates
  in TODO. User has chosen to leave it.
- **#R4 offline basemap on mobile** — confirmed broken pre-revert; **re-verify on the maplibre
  branch** before spending time on it.
- **#R5 pinch-zoom on iOS not blocked** — `user-scalable=no` is ignored by iOS Safari. Fix:
  `touch-action: pan-y` on scrollable panels but NOT the map container.
- **#R1 (polish) city labels fade through the globe on spin** — WebGL symbol labels, not DOM
  markers, so the `isLocationOccluded` approach doesn't directly apply. Check what MapLibre v5
  offers for symbol-layer occlusion on globe before hand-rolling.
- **Ancient/BCE centuries not yet rebuilt** — still show pre-improvement data; rebuild + BUILD
  bump clears them.
- Eclipse paths in offline mode: not re-confirmed since the revert. Verify.

### The pre-ship GATE
**Full-catalog audit** of all ~11,898 eclipses — build everything, flag stub / asymmetric /
wild-turn umbra limbs. Foldable INTO the regen (per-eclipse flags to a report, no extra
runtime). The 2028 regression proved spot-checks are insufficient.

### Bigger features needing scoping (Opus-grade; direction is the USER's to set)
- **#F1 personal ShadowChaser log** — visited / wishlist; schema, localStorage, UI, merge with
  selection state.
- **#F2 weather / cloud-cover overlay** — the killer feature. Forecast (near-term) +
  climatology (far-future); data source, layer rendering, online/offline, controls, perf.
  ~2 sessions of design before code.
- **#F3 animated shadow with time slider** — scrub umbra/penumbra in real time; most on-brand.
- **#F5 global-vs-local eclipse-type search semantics** — "1960+ total St. Louis": total
  globally + visible, vs total AS SEEN from STL. 4 options in TODO.

### Polish queued (Sonnet-grade)
Merge "Coordinates" + "City" into one "Location" section (caveat: the parser doesn't handle
bracketed multi-word cities yet); move the eclipse date to an overlay on desktop and make it
more visible on mobile; distinguish web vs app banner size; server-side share page
`followtheshadow.com/share?e=XXXXX` (the only way past the plain-text ceiling of
`navigator.share`/`mailto`); Global Circumstances panel is tall; map-brightness slider was
removed (revisit only if needed).

### Deferred infrastructure
Production bundling (single JS/CSS). Offline city **labels**: MapLibre symbol layers need PBF
glyphs (system fonts are unavailable to WebGL), so offline is dots-only today — bundling Noto
Sans PBF is ~2–3 MB. CSS module split (only after a build step). `map.js` single-file size.

---

## 12. QUICK GOTCHA INDEX

- `eclipse_type` — first letter uppercase, drives icon selection. Magnitudes: totals
  ~1.00–1.08, annulars ~0.85–0.99, partials 0–1.
- `rec.t0` is **TDT decimal hours**, not UT. `UT = t0 + t − dT/3600`; dT in seconds.
- `isOffline()` in `map.js` is the single connectivity owner.
- Strict-mode pure modules: `tz_lookup.js`, `search_parser.js`, `eclipse.js`.
- MapLibre globe ≠ Mercator; antimeridian/polar bugs differ. GeoJSON symbol layers were
  abandoned (geojson-vt antimeridian/polar issues). deck.gl has its own polar triangulator bug.
- deck.gl accessors don't react to zoom without `setProps`/`updateTrigger` (§8.5).
- `field-sizing: content` powers the search textarea autogrow (no JS).
- localStorage keys: `sc.timeMode`, plus the search-range setting.
- `window.matchMedia('(min-width: 900px)')` chooses the initial map zoom (desktop vs mobile).
- Vendored libs: version in the filename, **no** `?v=BUILD`.
- Terrarium DEM tiles are cross-origin — they pass straight through the service worker.
