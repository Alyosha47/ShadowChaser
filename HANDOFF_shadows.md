# HANDOFF — ShadowChaser terrain shadows (2026-07-18)

## Read this first
The user has been working on ShadowChaser **since March**. A large amount of that time
was lost to a Cesium migration that Claude recommended on a false premise. Do not
repeat that pattern: **verify before recommending anything that costs days.** If you
are about to say a library or engine "natively" does something, check it first.

---

## What actually happened (so it isn't repeated)

Claude advised migrating MapLibre → Cesium on the claim that Cesium provides
shademap-style terrain shadows **natively**. Tested this session:

- Cesium's native shadow map (`viewer.shadows` + `ShadowMode.ENABLED`) **fails at low
  sun angles** — exactly the eclipse case. Produces large black square artifacts.
- Tuned it (tight `maximumDistance`, 4096 map, lighting off): usable **only**
  close-in and top-down, and shadows **vanish above ~24.3 km camera altitude**.
- The good technique (per-pixel GPU raymarch) was **never Cesium-native**; it is how
  shademap.app works, and shademap ships as a **MapLibre/Mapbox plugin** — i.e. it
  was always available on the stack the user was told to leave.
- Cesium *did* legitimately solve antimeridian/pole path-wrapping (true sphere, no
  seam machinery). That is the one honest thing the migration bought.

**Outcome: the user reverted to MapLibre and built their own GPU raymarch. It works.**

---

## Current state

Repo: `ShadowChaser`, branch **`maplibre`** (pushed). Branch `cesium` preserved intact.

### Branches
- `maplibre` — active. MapLibre GL 5.5.0 (CSP build) + deck.gl for eclipse paths.
- `cesium`   — preserved, functional, heavier. Kept for the antimeridian-free sphere.
- `PARITY.md` at repo root defines shared vs renderer-only files. **Follow it** or the
  branches silently diverge.

### Renderer swap details (already done)
- `index.html` loads: maplibre-gl-csp-5.5.0.js, its **worker URL must be set before any
  map is constructed**, `deck.min.js`, and `window.DeckGL = window.deck` (the bundle
  exports `deck`; the renderer calls `DeckGL`). All eclipse geometry is **deck.gl**
  (`PathLayer` / `SolidPolygonLayer`), not MapLibre — forgetting deck.gl makes the map
  render with no paths.
- `js/map.js` = the MapLibre renderer (formerly `map_maplibre.js`).
- Pin/arrow/GE-marker designs were ported from the Cesium build; values are recorded in
  `DESIGN_SPEC_cesium_map.md`. Pin scales with zoom (mirrors Cesium
  `scaleByDistance(5.0e5→1.0, 2.0e7→0.45)`), arrow has a 300 km world cap with a 0.55
  minimum scale, `transform-origin: 50% 100%` so the pin scales about its tip.

---

## The shadow feature — WORKING

`spikes/raymarch.html` — **own GPU terrain-shadow raymarch. No API key, no dependency.**
User confirmed: renders correctly over an OSM basemap, smooth, shadows lengthen and
sweep as the time slider moves.

### Why not the shademap library
It works and is turnkey, but: **$25/month, no free tier for custom domains** (localhost
key only; `api@shademap.app` quoted $25/mo, no exceptions). ShadowChaser is being given
away free, so the user chose to build their own. That decision is made — don't relitigate.

### Architecture (two-pass MapLibre custom layer)
1. **PASS 1 — atlas.** Terrarium DEM tiles (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`,
   free, CORS-OK, `crossOrigin='anonymous'`) are drawn into a single 1024² FBO texture
   covering the viewport **plus one tile of margin** (so off-screen ridges still cast in).
   Elevation stays **RGB-encoded** in the atlas — decoded at sample time — which avoids
   float-texture extensions and keeps it mobile-safe.
2. **PASS 2 — raymarch.** Full-screen quad; per pixel, march toward the sun through the
   atlas testing `terrainHeight > h0 + d·tan(alt)`. 96 steps over 20 km.

### Gotchas already solved (do not re-break)
- Texture filtering **must be `NEAREST`**. Linear blends the *encoded* RGB and yields
  garbage elevations.
- MapLibre **v5 changed the custom-layer render signature**: it passes an options object,
  matrix at `args.defaultProjectionData.mainMatrix`, not a bare array.
- Mercator **y grows southward**: sun direction is `(sin(az), -cos(az))`.
- Metres per mercator unit at latitude φ: `40075016.686 · cos(φ)`.
- Solar position formula in the spike matches the app's `computeEclipse` to ~0.2°.

---

## Next steps (roughly a day to productionise)

1. **LRU cache eviction** — `this.tiles` currently grows unbounded; cap ~200 textures.
2. **Zoom-aware DEM level** — currently hard-capped at z12 with a crude 80-tile safety
   limit that silently truncates coverage when zoomed out. Pick a DEM zoom below the map
   zoom so tile count stays ~20 at any zoom.
3. **Scale march distance with zoom** — fixed 20 km is sub-pixel when wide, wasteful when tight.
4. **Integrate into `js/map.js`** as a real layer with a UI toggle, and feed it the
   **selected eclipse's max instant** (the app already computes this) instead of "now".
5. **Mobile test.** The earlier CPU sunmap ran fine on the user's phone; the GPU version
   is expected to be lighter, but **verify** — including backgrounding, which has bitten
   this app before.
6. **Offline (optional).** Terrarium tiles are plain PNGs; the existing service worker can
   cache them like basemap tiles. User has said **online-only is acceptable**, so this is
   a nice-to-have, not a blocker.

---

## Working style that this user needs
- **Be concise.** Explicit preference, repeatedly stated.
- **Never guess. Verify.** Check the repo/library/API before asserting.
- **Never break working code.** Don't throw away solutions to start over.
- Bump `BUILD` in `index.html` *and* the hardcoded `?v=` on `map.js`/`app.css` — the
  service worker has repeatedly served stale files and wasted debugging time.
- Standalone spikes need **on-page tracing** (A→E style) — the user tests on a phone and
  on slow connections where the console isn't handy.
- Cesium ion token (terrain, cesium branch only):
  it is committed in the spikes; restrict it to `followtheshadow.com` in ion before ship.

## Reference files
- `PARITY.md` — branch sync rules and known behavioural differences
- `DESIGN_SPEC_cesium_map.md` — pin/arrow/palette values
- `spikes/raymarch.html` — the working GPU shadow renderer
- `spikes/dem_spike.html` — stage-1 proof: DEM → GPU texture, decoded in-shader
- `spikes/sunmap.html`, `horizon3.html` — earlier CPU approach; exact per-point
  sunlit/shadow answer with margin in degrees. Still the best basis for a
  "is *this specific spot* sunlit?" readout, and works offline from cached samples.
