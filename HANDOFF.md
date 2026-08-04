# ShadowChaser — HANDOFF (consolidated 2026-07-19; §4 terrain shadows WIRED IN 2026-07-28;
#   §13 basemap/connectivity rewrite + non-central durations 2026-07-29;
#   §11 pre-ship GATE run and PASSED 2026-08-04)

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

1. ~~Dead shademap code with a live key.~~ **RESOLVED — verified gone 2026-07-29.** No
   `SHADEMAP_KEY`, `initShadeMap`, `toggleShade` etc. anywhere in `js/`, and no
   `vendor/shademap.umd.min.js`. Only comment mentions remain in `shadow-layer.js` and
   `spikes/`, which are legitimate history. **This entry was stale; do not go looking.**
2. **`addPin` gap — still unverified.** The Cesium renderer exposed `addPin`; the MapLibre
   renderer does not. Not investigated in the 2026-07-29 session.
3. **Cesium ion token is committed** in the spike files. Restrict it to
   `followtheshadow.com` in the ion console before any public release, or rotate it.
4. **Ross Ice Shelf seam (Antarctica) — OPEN, deliberately deferred.** A cut runs from the
   coast to the pole and back. Long-standing; one of the reasons Cesium was tried.
   Investigated 2026-07-29 far enough to rule out the obvious cause: the Antarctic ring has
   8 points, 6 at lat −89.999, with the cut at lon −180, and **both** of `seamFreeLines`'
   tests (seam and pole) should already catch it. So the artefact is very likely the
   globe-projection **fill**, not the stroked outline — `seamFreeLines` rebuilds outlines
   only and explicitly leaves fill alone. Different mechanism, real work. User can live
   with it.
5. **`data/basemap/ne2.jpg` is now unreferenced** — superseded by `ne2_mercator.jpg`
   (see §13.2). Safe to delete.
6. **The dead `MAP_JS_BUILD` guard.** `index.html` tests `window.MAP_JS_BUILD` to warn about
   a stale `map.js`, but nothing ever sets it, so the warning can never fire. Harmless.
7. **`data/paths/paths_1501_1600_kinked.json.gz` is a stray** — a ~5 MB comparison copy left
   from the June kink work, still on generator `2026-06-24h` while every live chunk is on
   `2026-07-13j`. Nothing loads it (the app resolves chunks by the `paths_YYYY_YYYY` name), but
   an out-of-date `.gz` sitting in `data/paths/` is precisely the trap that cost a session on
   1957. **Delete it.** `audit_paths.py` reports it as a STALE CHUNK until it's gone.

### Standard regression test for any shadow/sun work
Eclipse **2026-08-12**, observer **41.9851°N, 3.4186°W**, greatest eclipse there
**18:28:41 UTC**, **sun altitude 7.8°, azimuth 282.9°**, totality ~1m45s. Deliberately a
very low sun — the case that broke Cesium's native shadows, so it is the right test.

---

## 4. TERRAIN SHADOWS (#F4) — COMPLETE, MODULE **WIRED INTO THE APP** (2026-07-28)

**Status: DONE and integrated.** The terrain-shadow feature went spike (v4) → study
app (v50–v64) → **extracted drop-in module** → **wired into the eclipse app**
(2026-07-28; BUILD `2026-07-27r`). The engine is finished and shipped as
`shadow-layer.js`. Do not rebuild it. Do not relitigate build-vs-buy (our own GPU
raymarch, no API key, no $25/mo). **The wiring/integration is §4's "Wiring into the
eclipse app — DONE" subsection below — read it before touching shadow code.**

### The deliverable
- **`shadow-layer.js`** — a MapLibre custom layer, `createShadowLayer(options)` →
  `map.addLayer(layer)`. Fetches its own free Terrarium DEM tiles; needs only to
  sit above the layer you want shadowed. API: `setTime(Date|ms)`, `getTime()`,
  `setOptions({selfTest,showElevation,shadowColor,onStatus,onLog})`.
- **`shadow-layer-example.html`** — minimal working wiring (map + time slider).
- **`shadow-layer-README.md`** — full API + integration notes.
- The standalone study remains as **`shadows_v64.html`** (VERSION `v64`) for
  reference/debugging (self-hosted map + UI + self-test checkbox).

### Extraction integrity (verified, don't second-guess)
The module's shadow ENGINE is byte-for-byte v64: `shadeVS/shadeFS/copyVS/maxFS`
shaders IDENTICAL, `_render` march logic identical modulo the documented swaps.
Headless GL harness render **diff vs v64 = 0 pixels**. Only the wrapper changed:
removed self-hosted map + OSM basemap, removed DOM UI (slider/checkboxes/status),
removed the global `window.onerror` hijack, guarded `window.matchMedia` for
SSR/headless, routed time through `this.timeMs`/`setTime()`, captured `map` in
`onAdd`. No global side-effects; clean drop-in.

### Architecture (v50+ engine, current)
Per-screen-pixel ray-march (NOT the old rotate/re-grid scan — that caused staircase
coasts, streak combs, mask wisps; removed at v50). Three passes:
- **PASS 1** — Terrarium DEM tiles → a **NEAR atlas** (fine, viewport×`NEAR_MULT`)
  + a **FAR atlas** (coarse, whole shadow reach). RGB-encoded metres, bilinear on
  decode. `NEAREST` texture filtering throughout (linear blends the encoding →
  garbage).
- **PASS 2** — far atlas → max-height reduction (sizes next frame) + 4×/16×/64×
  block-max **mip chains** for both atlases.
- **PASS 3** — per screen pixel, march toward the sun; near atlas while inside it,
  far beyond; step grows 3%/sample; hierarchical prune-then-resolve (a block-max
  level may only PROVE a span clear and skip it — casters always resolved at full
  bilinear). Lit pixels `discard`; shadowed draw `SHADOW_RGBA`.

Key constants (top of module): `DEM_Z_MAX=13`, `MARCH_STEPS=300`, `MARCH_GROW=0.03`,
`NEAR_CASTER_M=8000` (native-res caster reach up-sun), `NEAR_MULT`, `TILE_BUDGET`,
`NEAR_BUDGET`, `ATLAS_MAX`, `SHADOW_RGBA`.

### Correctness (established, verified)
- Spherical-earth curvature (`s²/2R`) + **atmospheric refraction** (apparent sun
  casts the shadows) in the altitude test.
- Water-aware: Terrarium bathymetry is negative; heights clamp `max(h,0)` so
  underwater terrain doesn't cast; coastal cliffs still cast onto water; DEM-sharp
  boundaries, shadows cross water.
- Twilight veil is altitude-gated (v62): lit terrain stays bright through grazing
  sun, terrain shadows carry the sunset, fades to night only at disc-set (the old
  disc-fraction veil washed detail + blinked to night — fixed).
- Verified against closed-form geometry (`selfTest` overlay) and an independent CPU
  march (0 structural misses / 0 false positives). Coarse hierarchical march ==
  exhaustive per-texel march, 0 pixel difference.

### Gotchas already solved — DO NOT RE-BREAK
- `NEAREST` filtering on every encoded texture.
- `max(h,0)` sea-level clamp (bathymetry).
- `tan(alt)` floored at `alt=0.05°` (no infinite ray near horizon).
- MapLibre v5 custom-layer render signature is an options object; matrix at
  `args.defaultProjectionData.mainMatrix` (probe `||args.mainMatrix||args.matrix`).
- Mercator y grows southward → sun dir `(sin(az), -cos(az))`.
- Metres per mercator unit at φ: `40075016.686·cos(φ)`.
- Near-branch clearance may only skip within the near rect (bound the DDA skip at
  the rect exit) — otherwise a skip crosses the seam and steps over a far-atlas
  caster (last invariant violations traced to this).

### The shademap comparison — SETTLED, from reading Ted's actual source
Ted open-sourced his engine (`ted-piotrowski/leaflet-shadow-simulator`). Read it
directly (`ted.js` in the sandbox). Findings, all measured, not guessed:
- **Ted's shadow layer outputs a FLAT color** (`#01112f`, 0.7 opacity) — same kind
  of overlay as ours. The 3D relief look in shademap.app is its **basemap**, not
  its shadow.
- **Our terrain shadows ≈ Ted's** — his exact march vs ours agree ~96–98% on the
  same bare DEM; the residual is discretization scatter, not detail he has and we
  lack.
- The visible richness of shademap over ours is **(a) DSM tree/building shadows**
  (his `getDSMElevationFromSampler2D` samples a surface model — trees + buildings —
  from paid/proprietary data; his README confirms canopy/DSM sources are
  user-provided) and **(b) a shaded-relief basemap**. Both live OUTSIDE the shadow
  layer.
- Levers tested and RULED OUT as the gap (each either no-op or a noise-trade):
  DEM resolution (3 independent tests, no visible effect), shadow bias (matching
  Ted's tiny 0.0005 recovers detail but adds equal false shadow — net loss),
  stride growth, per-pixel supersampling (looked *worse* — dirty/blurry), and the
  MapLibre `raster-dem` hillshade basemap (brought coast/tile-seam zigzags).

### If more shadow richness is ever wanted (future, optional — NOT needed to ship)
1. **DSM data.** Free canopy datasets exist and are commercial-use-OK — **Meta/WRI
   1 m** (AWS open data, bucket `dataforgood-fb-data`) and **ETH GlobalCanopyHeight
   10 m** (CC-BY). Both ship as **cloud-optimized GeoTIFFs**, not XYZ tiles → needs
   a preprocessing pipeline (fetch → reproject → encode Terrarium-style PNGs → serve)
   plus a shader change to add canopy height to terrain height before casting. This
   is the ONLY thing proven to visibly close the gap. It's a data-engineering task.
2. **Relief basemap** is the host app's concern, not this layer's — and does NOT
   change the shadow calculation (it's pixels drawn under the shadow). Over a relief
   basemap in the real app, these shadows will already read much closer to shademap.

### Wiring into the eclipse app — DONE (2026-07-28). BUILD `2026-07-27r`.
The module is fully integrated. All integration logic lives in a new file
**`js/shadow-ui.js`** (~443 lines, the only new file); the engine `shadow-layer.js`
gained a small, opt-in supersampling addition (below) and nothing else.

**Pristine engine backup:** `js/shadow-layer.ORIGINAL.js` (in `js/`, NOT the repo root as
earlier drafts of this doc claimed — verified 2026-07-29) is the
byte-for-byte v64 engine as first committed (`ba1c20f`). The shipped
`shadow-layer.js` differs from it by **supersampling only** — verified by diff.
Keep it as the safety net; if a shadow change ever misbehaves, diff against it.

**How it's wired:**
- **On-map toggle** — a "Shadows" button top-left of the map (`#btn-shadow`).
  Greyed out + explanatory `title` when `isOffline()` (the engine streams DEM
  tiles → online-only; there's also a note in Settings→Instructions).
- **State machine** (documented atop `shadow-ui.js`): `_shadowArmed` (user toggled
  on) vs `_shadowShowing` (layer up AND map in Mercator). `updateShadowVisibility()`
  reconciles them on every toggle and zoom.
- **PROJECTION — the load-bearing integration fact.** The engine's vertex shader
  hands MapLibre a **flat-Mercator** quad (`gl_Position = u_matrix * vec4(merc,0,1)`).
  On the app's **globe** projection MapLibre's matrix does not warp that flat quad
  onto the sphere, so it renders as a **sheet floating in space** (a "sinewave/
  parallelogram" pinned off in the ocean). Fix: **flip the whole map to `mercator`
  while shadows are shown, back to `globe` when off/zoomed-out.** At the zoom you
  view terrain shadows the two projections look near-identical and the seam bugs the
  globe exists to avoid don't occur that far in. `setProjection` is cheap (no style
  reload). The globe-aware alternative (port the shader to MapLibre's `projectTile`
  globe projection) was rejected: the raymarch assumes a linear screen↔mercator
  mapping, so it's a re-architecture, not a wrap. **Left as a deferred option; not
  needed.**
- **Zoom gate** — `SHADOW_MIN_ZOOM = 6`. Armed + zoom ≥ 6 → Mercator + layer +
  scrubber. Armed + zoomed out → keep the globe, drop the layer, show a "zoom in to
  reveal terrain shadows" hint in the bar.
- **TIME.** Opens at the **greatest-eclipse instant** from the Besselian record's
  `td_ge` (a `"HH:MM:SS"` TD string → UT = TD − ΔT → absolute ms on the record's
  date). If an **observer pin** is set and the eclipse is visible there, it anchors
  on that **location's local maximum** instead (`computeEclipse(...).tMax`, already
  UT). Re-anchors when the eclipse OR the pin changes; leaves a manual scrub alone
  otherwise. Scrubber window = event span (`tmin`/`tmax`). (Rise/Set clamp to that
  window — deliberately not widened.)
- **SCRUBBER** — a flush, full-width bottom bar (34px). Left: selected date over
  time (two lines, UTC). Right: a **ruler whose time strip slides past a fixed gold
  centre needle** (not a range input). Drag / wheel (±5 min) / arrow keys.
  `SHADOW_PX_PER_MIN = 6`.
- **THREE-WAY TIME SYNC.** `setShadowTime(ms)` is the SINGLE owner. The on-map
  scrubber, the SUNTRACK slider, and the contact-times rows (C1–C4, MAX, **and
  Rise/Set**) all move through it and stay in step. Plumbing:
  `window.shadowTimeFromSunTrack(ut)` (SUNTRACK slider → shadow, guarded so it
  doesn't bounce back) and `window.scOnContactRow(ut)` (a row click → SUNTRACK +
  shadow). One re-entrancy guard `_drivingSunTrack`; loop-free because
  `sunTrackJump` sets the slider without firing `input`. **`details.js` was edited
  for this — SHARED per PARITY.md.** The edits (row `onclick` → `scOnContactRow`,
  the SUNTRACK slider `input` → `shadowTimeFromSunTrack`, and a module-level
  `window.scOnContactRow`) are all `typeof`-guarded, so cherry-picking `details.js`
  to the **cesium** branch is safe — the shadow-ui globals simply won't exist there
  and the calls no-op.
- **BASEMAP-SWAP SURVIVAL.** `_scSetBasemap` uses `setStyle`, which wipes custom
  layers and resets projection. `shadow-ui` re-adds the shadow layer + reasserts
  Mercator on `style.load` if shadows were showing. (Also fixed a **latent
  pre-existing bug** found here: `map.js` `style.load` re-registered the
  `render`/`zoom` listeners on every call → they stacked on each basemap swap. Now
  guarded with `_mapEventsWired`. Also restored the never-ported `_scSetBasemap`/
  `_scRecenter` — the basemap picker was dead on the maplibre branch; see §11.)
- **STRENGTH.** Settings → "Shadow strength" slider drives the tint alpha live via
  `setOptions({shadowColor})`, persisted (`localStorage sc_shadow_opacity`).

**SUPERSAMPLING — the speckle fix (reconciles the "ruled out" note above).**
Earlier (§4 shademap comparison) supersampling was tried to add *detail* and looked
worse. That is a **different problem** from what shipped here. The grazing-sun / low-
zoom **speckle** is *threshold aliasing*: each pixel's single march ray point-samples
a binary in/out field that has real sub-pixel structure, so neighbours flip lit/dark.
Confirmed by elimination this session — coarsening the DEM (`demRatio` up to 5×) and
widening the edge ramp (`edgeBoost`) both **failed** (speckle is terrain-scale-
independent), so both experiments were **reverted out of the engine**. The fix is
**true 2×2 sub-pixel supersampling**: a copy of the march, `occAt()`, sampled at four
sub-pixel offsets and averaged → the grey is the pixel's *actual fractional shadow
coverage* (physical AA, positions unchanged, edges stay crisp). It's **on by default**
and made affordable by two gates, both in the engine:
- **Where:** only when zoom < `SS_ZOOM_MAX` (12) **or** sun altitude < `SS_SUN_MAX`
  (18°). Zoomed in under a high sun a single ray is already clean.
- **When:** **idle only** — single ray during pan/zoom/scrub (`this._moving`, set by
  map `move`/`zoom` + `setTime`, cleared ~130 ms after motion stops with a repaint).
  This is what restored smooth panning. `#2`: when SS is on the redundant inline
  center march is skipped (4×, not 5×). `onRemove` detaches the motion listeners
  (no leak across basemap swaps).
Engine additions for this: `occAt()`, uniforms `u_ss`/`u_pixM`, the
`SS_ZOOM_MAX`/`SS_SUN_MAX` consts + gate, the `_moving` machinery, `onRemove`, and
`opts.ss`. **Nothing else in the engine changed** (default path bit-identical when
`u_ss=0`).

**No console dev-knobs remain.** The `scShadowRatio`/`scShadowEdge`/`scShadowSuper`
tuning helpers were scaffolding and were removed in the tidy-up. If a user-facing
supersample toggle is ever wanted, it should be a proper Settings control (the engine
`ss` option is still there to drive it).

**Files touched this session, with PARITY class:**
- `js/shadow-ui.js` — NEW, renderer-only (map integration).
- `js/shadow-layer.js` — engine, renderer-only (supersampling addition; keep in sync
  with the cesium branch only if that branch ever adopts this engine).
- `js/map.js` — renderer-only (basemap picker restore, listener-stacking fix,
  one-line `shadowOnEclipseChange` hook in `updateMapState`).
- `js/details.js` — **SHARED** (sync hooks, guarded; cherry-pick to cesium).
- `index.html` — renderer-only loader block (script tags for shadow-layer/shadow-ui,
  the shadow DOM in the map tab, the Shadow-strength Settings row, offline note) +
  BUILD bump.
- `css/app.css` — new `.shadow-*` classes (scrubber/button). Treat as renderer-only.
- `shadow-layer.ORIGINAL.js` — NEW, the pristine-engine backup (not loaded).

**Regression pass before trusting a fresh clone:** toggle shadows on/off; scrub and
confirm SUNTRACK + contact rows track (and vice-versa); click Rise/Set; swap basemap
with shadows on (they reappear); go offline (button greys); pan/zoom-in should be
smooth, the accurate 4× frame arriving on settle.

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
├── shadow-layer-README.md      (terrain-shadow engine API + integration notes)
├── shadow-layer-example.html   (minimal standalone wiring of the engine)
│   └── shadow-layer.ORIGINAL.js  (pristine v64 engine backup; NOT loaded — in js/, see §4)
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
│   ├── basemap/   (+ ne2_mercator.jpg — the offline relief, §13.2)        land / countries (antimeridian-split), lakes, rivers, cities  (.gz)
│   │                   ocean.geojson.gz is ORPHANED — safe to delete
│   ├── besselian/      per-century element records — SOURCE OF TRUTH, git-tracked
│   └── paths/          generated *.json.gz corridors — NOT git-tracked (build artifacts)
├── data build tools/   gen_eclipse_paths.py — the canonical generator (+ dev scratch)
│                       audit_paths.py — read-only catalog audit, the pre-ship gate (§11)
├── tools/              noncentral_durations.py — non-central max durations (§13.5)
├── docs/               GREATEST-DURATION.md — handoff for the all-eclipse version
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
    ├── shadow-layer.js  TERRAIN-SHADOW ENGINE — createShadowLayer() MapLibre custom layer;
    │                    GPU DEM raymarch + supersampling. Mercator-only. Don't rebuild (§4).
    ├── shadow-ui.js     TERRAIN-SHADOW INTEGRATION — toggle, ruler scrubber, 3-way time sync,
    │                    projection flip, online gating, Settings strength. setShadowTime owner.
    ├── share.js        share modal/sheet (tabstop format)
    ├── state.js        chunkCache, AppState get/set/on + window forwarding shims
    ├── tabs.js         switchTab, switchSidebarTab, TZ_ZONES
    ├── tz_lookup.js    3rd-party offline timezone lookup, bundled
    └── url.js          pushState, restoreFromHash, event wiring
```

**Script load order** (from `index.html`) — vendor CSS, MapLibre CSP JS, `setWorkerUrl`,
`deck.min.js` + `window.DeckGL = window.deck`, `js/tz_lookup.js`, `css/app.css?v=BUILD`,
`search_parser` + `eclipse` (in head); then at body end: format, state, cities, tabs, search,
list, local, details, url, map, **shadow-layer, shadow-ui**, share, init. (Shadow scripts load
right after `map.js` — they use its globals — and before `share.js`/`init.js`.)

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
- **#F4 terrain shadows — COMPLETE & WIRED IN (2026-07-28).** No longer open. Shipped
  as the `shadow-layer.js` module and fully integrated into the app; see §4's "Wiring
  into the eclipse app — DONE" subsection for the whole integration. Only optional,
  non-blocking future work: DSM canopy data for tree/building shadows (§4).
- **#P1 observer pin — three issues, all NON-shadow, PARKED as a cluster** (surfaced
  while building shadows; batch them, likely shared root cause in the deck.gl marker /
  globe reprojection):
  (a) the pin renders **behind the eclipse path** (deck.gl draw order — path over
  marker);
  (b) while **zooming the globe** the pin **drifts toward the top-left corner and then
  snaps back** into place on settle (marker reprojection lagging the globe transform);
  (c) the pin **tip is not exactly on the location dot** (anchor/offset — note this
  contradicts the "tip = the coordinate" claim under Working; treat Working as stale
  on this point until fixed).
- **#P2 eclipse paths show THROUGH the far edge of the planet** (globe backface): path
  lines on the hemisphere facing away from the camera are visible through the limb.
  **This was corrected before in the past** (regression) — find the prior fix. Deck.gl
  layers over the globe need depth/horizon occlusion; related to #R1 (labels fade
  through the globe).
- **#R3 polar corridor "onion ring" (deck.gl).** 1950-09-12 corridor + ovals render as
  polar onion rings; SolidPolygonLayer mis-triangulates polar polygons even with clean
  unwrapped data. Workaround: corridor fill DISABLED (path lines only); ovals still
  filled. 4 candidates in TODO. User has chosen to leave it.
- **#R4 offline basemap on mobile** — confirmed broken pre-revert; **re-verify on the maplibre
  branch** before spending time on it.
- **#R5 pinch-zoom on iOS not blocked** — `user-scalable=no` is ignored by iOS Safari. Fix:
  `touch-action: pan-y` on scrollable panels but NOT the map container.
- **#R1 (polish) city labels fade through the globe on spin** — WebGL symbol labels, not DOM
  markers, so the `isLocationOccluded` approach doesn't directly apply. Check what MapLibre v5
  offers for symbol-layer occlusion on globe before hand-rolling. (Same family as #P2.)
- **Ancient/BCE centuries not yet rebuilt** — still show pre-improvement data; rebuild + BUILD
  bump clears them.
- Eclipse paths in offline mode: not re-confirmed since the revert. Verify.

### The pre-ship GATE — RUN AND PASSED (2026-08-04). CLOSED.
The full-catalog audit is done. All 50 chunks were regenerated on generator `2026-07-13j`, then
swept by **`data build tools/audit_paths.py`** — a read-only pass over the built `.json.gz`
chunks (seconds, no rebuild).

**Result: 11,898 eclipses, 7,851 central. Zero stub or missing limbs on two-limit eclipses,
zero gross N/S asymmetry, no stale chunks.** The 2028/2041 failure mode is confirmed absent
catalog-wide. Only two eclipses flagged — `332-03-13` and `2485-12-07`, both `A+`, both
deliberately won't-fix; the full detail, the Jubier measurements and the candidate fix are in
TODO under BUGS.

**Why a separate script rather than more generator checks.** The generator's in-run AUDIT pass
checks only vertex GAPS (>350 km) and INTERIOR TURNS (>30°) on curves that already exist.
`audit_curve()` returns early on `len < 2`, and a 2-point stub has no interior vertex to turn
at — so a missing or stubbed limb passes it in total silence. **That is exactly how 2028/2041
hid.** The three structural checks the generator cannot make are STUB, ONELIMB and ASYM, and
they live in the script.

The script classifies **verbatim from the generator** — `is_central` = type[0] in T/A/H,
`one_limit` = type[1] in `n s - +`, a real limb = ≥3 points — so the two cannot drift on what
they mean by a limb. **If those definitions ever change in `gen_eclipse_paths.py`, change them
in `audit_paths.py` in the same commit.** It also flags any chunk not built by the majority
generator version, which catches the stale-`.gz` trap that once cost a session on 1957.

Re-run it after any generator change touching limb construction:
`python3 "data build tools/audit_paths.py" --report audit_report.txt`

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
- **There is no `setStyle` in the codebase. Do not add one** (§13.1).
- MapLibre layer zoom ranges are tested per **tile**; on a globe, on-screen tiles differ in
  zoom. Use an opacity expression on `['zoom']` to switch things per frame (§13.3).
- Latitude ±90 is infinity in Mercator — rings touching it silently fail to draw. Use
  ±89.999. And never ring a pole in one polygon: split at longitude 0 (§13.2).
- `SolidPolygonLayer` has no stroke; `stroked`/`getLineColor` are silently ignored (§13.4).
- A MapLibre `image` source maps corners linearly in **Web Mercator** — feed it a
  reprojected raster, not plate carrée (§13.2).
- `pathPalette()` owns every path colour; basemaps declare `dark` (§13.4).
- Low ΔT-era agreement in `noncentral_durations.py` is the ΔT upgrade working, not a bug.
  Gate on the USNO rows (§13.5).
- The generator's in-run AUDIT checks gaps and turns only — a missing or 2-point-stub limb
  passes it silently. Structural limb checks live in `audit_paths.py` (§11).
- Don't set `position` on a MapLibre marker wrapper (§13.6).


---

## 13. BASEMAPS, CONNECTIVITY & NON-CENTRAL DURATIONS (2026-07-29)

A day of polish that turned into two structural rewrites. Read 13.1 before touching
anything to do with basemaps or online/offline — it undoes a lot of older advice.

### 13.1 THERE IS NO `setStyle` ANYWHERE. KEEP IT THAT WAY.

The style is built **once** and never replaced. It contains the local (offline) layers
**and** the online basemap together. Going offline hides a layer; changing basemap
retargets a source's tiles. Nothing rebuilds the style.

This replaced four divergent `setStyle` call sites that each behaved differently
depending on how they were reached. That divergence caused two bugs that looked
unrelated and took several wrong patches to understand:

- **Eclipse paths drawing through the globe.** A full style rebuild costs the deck.gl
  overlay its globe state, after which it stops hiding far-side geometry. This is why it
  appeared after an offline→online swap but never on a fresh load of the same style.
- **A blank/black globe.** `setStyle` defaults to *diffing* old against new. Between two
  raster basemaps that is fine; local↔online changes seven geojson sources, an image
  source and the projection at once, and the differ left nothing rendering. Switching
  basemap afterwards "fixed" it precisely because that was a diff it could handle.

`diff: false` fixed the second and *caused* the first. Both failure modes are now gone by
construction rather than by guard. **If you reintroduce `setStyle`, you reintroduce both.**

Deleted, not disabled: `mountStyle()`, `_basemapStyle()`, `_localStyle`,
`ONLINE_STYLE_URL`, and the OpenFreeMap tint block (which with a merged style would have
recoloured our *own* layers).

**The constraint that makes this possible: every offered basemap is RASTER.** Adding a
vector style to `PICKER_KEYS` brings the whole swap problem back. Noted at `BASEMAPS`.

Key functions in `js/map.js`:
- `syncBasemapLayers()` — the single owner of both basemap layers' tiles, zoom ranges and
  visibility. Called at startup, on connectivity change, and on basemap selection.
- `applyOnlineState()` — decides *what* should be showing; delegates.
- `probeConnectivity()` / `setOnline()` — ported from the cesium branch. 3 s timeout (an
  offline fetch on iOS *hangs* rather than rejecting), cache-bust param (iOS ignores
  `no-store` for `no-cors`), two-strike debounce on negatives (stops flapping during
  service-worker precache). 15 s poll plus events; a first failure re-probes in 3 s, so a
  real drop shows in ~3 s rather than 30.

### 13.2 OFFLINE BASEMAP IS NOW NE2 RELIEF

`data/basemap/ne2_mercator.jpg` (4096×4096). The old `ne2.jpg` was 4096×2048
**equirectangular**, was precached but never actually mounted by the map, and could not be
used as-is: a MapLibre `image` source maps its corners linearly in **Web Mercator**, so a
plate-carrée image slides every latitude — mildly at the equator, grossly at the poles.

Layer order: `land-fill → lakes → relief → coastline → borders → rivers → cities`. Fills
sit *below* the relief deliberately, as a fallback if the image fails; lines sit above so
they stay crisp. `lakes` is therefore invisible in normal operation — it and `land-fill`
are a matched fallback pair; removing one leaves the fallback half-broken.

**Polar caps.** Mercator is undefined at the poles, so the relief stops at ±85.0511° and
you saw straight through. Capped in ice-white, with two traps hit on the way:
- **Not ±90** — latitude 90 is infinity in Mercator; a ring touching it projects to
  invalid geometry and the fill *silently fails to draw*. Use ±89.999. (`land.geojson`
  uses the same value for Antarctica, for the same reason.)
- **Two half-rings, split at longitude 0** — a single ring around a pole encloses the
  antimeridian, and MapLibre cannot tell which side is interior, so it filled half the cap
  and *which* half changed with rotation.

**Coastline graticule.** `land.geojson` ships clipped to a 5° grid (3,350 polygons; 10% of
its 83,008 vertices lie exactly on a 5° line). Extracting ring edges as coastline drew
every internal cut — a graticule over every continent. `seamFreeLines(fc, dropShared)`
now drops **duplicated** segments: an artificial cut is shared by the two cells either
side and so appears twice, while real coastline appears once. Verified exactly: all 2,756
duplicated segments lie on a 5° line, and the only grid-aligned singletons are at ±180,
already handled. **`dropShared` must stay OFF for `countries`** — adjacent nations
legitimately share 19,099 border segments, and dropping those erases every internal border.

### 13.3 ON-MAP CONTROLS

Basemap picker (top right) replaced the Settings pulldown, which is gone along with its
handler in `tabs.js`. `_scSetBasemap()` remains the single entry point.

- Three options: Street, Topo, Sat. `PICKER_KEYS` is the picker order.
- **Default migrated to `esri_street`.** The old default `'osm'` named a vector style that
  is no longer reachable; `_basemapKey()` resolves anything off the picker to
  `esri_street`, so no stored key can leave the picker with nothing lit.
- Swatches are inline SVG map fragments. Live provider tiles were tried first (Google's
  approach — show the thing, not a metaphor) and **failed**: at 44 px a zoomed-out topo
  tile is indistinguishable from a street tile. Text labels were also tried and rejected by
  the user. Three iterations; don't re-litigate without reading this.
- **Two-source basemaps.** Any `BASEMAPS` entry may carry `nearUrl`/`nearFrom`/`nearMax`/
  `nearAttr`. Topo flies over **Esri Topographic** and lands on **OpenTopoMap at z9.5**.
  OpenTopoMap is really two maps: saturated shaded relief at low zoom, then an abrupt
  switch to a classic paper sheet at **9.45**. The paper sheet is the good part. 9.5 is
  chosen to sit just past *their* break — a fact about a third party's cartography, so it
  may move.
- **The handover uses an OPACITY STEP on `['zoom']`, not layer zoom ranges.** MapLibre
  tests a layer's zoom range against each **tile's** zoom, and on a globe the on-screen
  tiles are not all at the same zoom — so range-based switching drew both maps at once, in
  patches. `['zoom']` is one scalar for the frame. `step`, not `interpolate`: these are two
  different cartographies and cross-fading looks like a fault. Zoom ranges are still set,
  one level wider each side, purely to keep us off OpenTopoMap's servers at global zoom
  (their usage policy asks).

Overlay toggles (top left) are icon-only: `◐` shadows, `☁` cloud. **The cloud button is
present but deliberately inert** — visibly disabled, not silently dead. Its block in
`shadow-ui.js` is marked for wholesale replacement; id and CSS class are already right.
A yin-yang was considered for shadows and rejected: `◐` is literally lit/unlit, and a hard
circle beside a soft cloud separates at a glance where two round blobs would not.

### 13.4 PATH COLOURS FOLLOW THE BASEMAP

`pathPalette()` in `js/map.js` is the **single** definition of every path colour, read by
all consumers — penumbra, umbra, centreline, green curve, and both umbra-oval colours.
They were previously RGB literals at six scattered call sites, which is how they drifted.

Each basemap declares its own tone via a `dark` flag in `BASEMAPS`; the palette never tests
for particular keys. Satellite is the only dark one. Offline is always the light case (NE2
is pale). Adding a basemap means adding one flag.

**`SolidPolygonLayer` FILLS ONLY — it has no stroke.** `stroked` and `getLineColor` are
`PolygonLayer` props and were being silently ignored, so the umbra ovals never had an
outline on any basemap. The outline is now its own `PathLayer`, sharing the id prefix
`umbra-ovals` so `updateOvalVisibility()` toggles fill and outline together at
`OVAL_HIDE_ZOOM` (it matches on prefix — keep it that way). On dark bases the fill is
dropped (`ovalFillAlpha: 0`, and `filled` follows it so deck.gl skips the pass entirely)
and only the outline draws.

### 13.5 NON-CENTRAL ECLIPSE DURATIONS — SHIPPED

`tools/noncentral_durations.py` (stdlib only; run from the repo root). **Already run with
`--write`; `data/index.json` is patched.** Re-running is safe and idempotent.

94 eclipses have **no central line** — the shadow axis misses the Earth (|γ| > 1) while the
cone's edge still clips the limb. Espenak's `central_duration` is *defined* on that line,
so the canon records 0; Jubier shows 0 for the same reason. **Neither is in error** — the
quantity doesn't exist. The script answers the different question, "how long is totality at
its longest, anywhere?", by searching the surface using the app's own Besselian maths.

*2 Nov 1967: 104.8 s at 62.699°S, 25.489°W — not zero.*

Sparse fields on those 94 records only: `max_duration_secs`, `max_duration_lat`,
`max_duration_lon`. `duration_secs` is **untouched** — Espenak's answer to a different
question, and it stays attributable. Absence of the fields means "use the catalogue value",
so `details.js:maxDurationRows()` is also the feature detector.

**READ THIS BEFORE JUDGING THE VALIDATION OUTPUT.** PASS 1 compares us to Espenak grouped
by ΔT source, and the low numbers are **not bugs** — they are this project's ΔT upgrade
working:

```
USNO observed / predicted    87   100.0% within 1s   <- THE GATE (median 40 ms)
Espenak-Meeus              3839    72.6%
SMH2016 LOD extrapolation  1320    42.5%
SMH2016 (ancient)           453     6.0%
```

Where ΔT was replaced we *should* disagree: his figure used the old ΔT. A ΔT difference
rotates the Earth under the shadow, sliding the sample point off the central line, so the
duration there collapses. Proof — restoring an offset recovers his value exactly
(−947-11: 511.9 s vs our 93.8 s → 511.9 s at ΔT +1060 s). Within the Espenak-Meeus rows,
agreement degrades monotonically with |ΔT| and nothing else: 100% below 38 s of ΔT, 30%
above 13,000 s. **Gate on the USNO rows only.** If that drops below ~99%, the maths broke.

**Not done: greatest duration for all ~11,900 eclipses.** GE ≠ greatest duration even for
ordinary eclipses (measured: median +0.07 s, max +49.8 s and 10,686 km away). Deferred
deliberately — it needs a trustworthy global search, not the hill climb used for the 94.
Full handoff in **`docs/GREATEST-DURATION.md`**; read it before starting.

### 13.6 SMALLER THINGS

- Pin was darting to the container's top-left while zooming: `updateArrowScale` wrote
  `transform` onto the **marker element**, erasing MapLibre's own positioning. The pin is
  now wrapped (like the arrow) so MapLibre owns the wrapper and we scale the child. Pin
  geometry is `PIN_W`/`PIN_H`/`PIN_TIP_Y` — art and anchoring read the same constants, so
  the tip cannot drift from the point.
- `.maplibregl-marker { z-index: 3 }` — deck.gl's overlay is added via `addControl`, so it
  lands in a `.maplibregl-ctrl-*` container with `z-index: 2`, and markers (no z-index at
  all) drew *under* the eclipse paths.
- **Do not set `position` on a marker wrapper.** `.maplibregl-marker` is `position:
  absolute`; overriding it to `relative` drops the wrapper into normal flow, where a
  preceding in-flow marker shifts it off its coordinate.
- Camera: every eclipse change re-frames to `defaultZoom()`, centred on the pin if set,
  else the eclipse. `_framedEntry` (camera) is deliberately **separate** from `_lastEntry`
  (shadow hook), and only advances once the camera has moved on a *visible* map — that is
  what makes mobile deep links frame correctly when the user later opens the Map tab.
- New eclipse **disarms shadows** (different place, date and time; the camera is also
  pulling below `SHADOW_MIN_ZOOM` anyway).
- Shadow scrubber follows the Local/UT toggle. Display-only shift; shadow time stays
  absolute ms. Ruler tick *boundaries* are computed in the displayed timescale so labels
  land on clean 5-minute local marks even in a :30/:45 zone, and the shift is part of
  `_rulerWinKey` so a mode flip rebuilds them. Readout width is pinned in `ch` — otherwise
  "local" vs "UTC" changes width and the ruler slides under the static needle.
- Details tab throbs on a new map location (`scFlagFreshDetails()` existed and was simply
  never called). CSS keyframe filter lists **must contain the same functions in the same
  order at every stop**, or the browser interpolates *discretely* and the colour snaps.
- Mobile attribution collapses behind an (i): `attributionControl: { compact: true }` plus
  CSS below 900 px. MapLibre otherwise decides from container width and leaves it inline.
- Console noise: a READ-usage buffer warning on every zoom/scroll, then "WebGL: too many
  errors" at 256 — that second line is just Chrome's per-context throttle. **Not ours.**
  Our only `readPixels` is a one-off 1×1 terrain-height probe in `shadow-layer.js`, and we
  set no `pickable`/`onHover`/`queryRenderedFeatures` anywhere. No lever; ignore.
- There is **no Map tab on desktop** — `app.css` hides `.tab-bar` above 900 px. The desktop
  sidebar *does* have a Map sub-tab holding only the force-offline toggle; user asked to
  keep it for now. The 900 px branches in JS are load-bearing and must stay.

---
