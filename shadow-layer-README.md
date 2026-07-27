# ShadowLayer — drop-in terrain shadow layer for MapLibre GL JS

A single-file MapLibre **custom layer** that renders terrain (bare-earth) sun
shadows over your existing map. Extracted from the ShadowChaser **v64** study;
the shadow engine (DEM atlas, per-pixel ray-march, shaders) is **byte-for-byte
the study's** — verified pixel-identical output. Only the study's self-hosted
map, DOM UI, and time slider were removed and replaced with a small API.

## Files
- `shadow-layer.js` — the module (exposes `createShadowLayer`; also CommonJS `module.exports`).
- `shadow-layer-example.html` — minimal working integration (map + slider).
- this README.

## Quick start
```html
<script src="https://unpkg.com/maplibre-gl@5.5.0/dist/maplibre-gl.js"></script>
<script src="shadow-layer.js"></script>
<script>
  const map = new maplibregl.Map({ /* your map + your basemap */ });
  const shadow = createShadowLayer({ time: Date.now() });
  map.on('load', () => map.addLayer(shadow));   // add ABOVE the basemap
  // later, whenever your app's time changes:
  shadow.setTime(new Date());
</script>
```

## API
`createShadowLayer(options)` → a MapLibre custom layer (`id:'shadow'`).

**options** (all optional):
| option | type | default | meaning |
|---|---|---|---|
| `time` | `Date` \| epoch-ms | `Date.now()` | instant the shadows are cast for |
| `shadowColor` | `[r,g,b,a]` 0..1 | `[0.02,0.05,0.16,0.55]` | shadow tint + opacity |
| `demUrlBase` | string | AWS Terrarium | `{z}/{x}/{y}.png` DEM tile base URL |
| `selfTest` | bool | `false` | draw the analytic self-test overlay (dev) |
| `showElevation` | bool | `false` | elevation debug tint (dev) |
| `onStatus` | `fn(text)` | none | receive the per-frame status string |
| `onLog` | `fn(msg)` | none | receive diagnostic log lines |

**instance methods:**
- `shadow.setTime(Date | ms)` — update the instant; triggers a repaint. Returns `this`.
- `shadow.getTime()` → epoch-ms.
- `shadow.setOptions({...})` — update any of `selfTest`, `showElevation`, `onStatus`, `onLog`, `shadowColor`; repaints. Returns `this`.

## How it fits your app
- The layer **fetches its own DEM tiles** (Terrarium PNGs); it does **not** read
  your basemap's sources. It only needs to be added **above** whatever layer you
  want shadowed.
- It reads the map's current view (`getBounds`/`getCenter`) each frame and casts
  shadows for `time` at that location. Your app owns the map, the basemap, and
  the clock; the layer just draws shadows.
- No global handlers, no DOM required, no `window.onerror` hijack (removed), and
  `matchMedia` is guarded so it won't throw in SSR/headless.

## What this layer is (and isn't)
- **Is:** accurate bare-earth terrain shadows — spherical-earth curvature +
  atmospheric refraction (apparent sun), water-aware, DEM-sharp boundaries.
  Verified against closed-form geometry and an independent CPU march.
- **Isn't:** tree/building (DSM) shadows. Those need a canopy/surface dataset the
  study didn't have (e.g. Meta/WRI 1 m canopy, free but a separate data pipeline).
  The visual richness of shademap.app over this layer is substantially (a) its
  DSM tree/building shadows and (b) its shaded-relief basemap — both live
  **outside** this shadow layer. Over a relief basemap in your app, these shadows
  will read much closer to shademap.

## Config knobs (edit the constants at the top of the module if needed)
- `MARCH_STEPS` (300), `MARCH_GROW` (0.03) — march cost vs reach.
- `NEAR_CASTER_M` (8000) — how far up-sun native-resolution casters extend.
- `DEM_Z_MAX` (13), `TILE_BUDGET`, `NEAR_BUDGET`, `ATLAS_MAX` — resolution vs memory.
- `SHADOW_RGBA` — default tint (or pass `shadowColor`).

## Provenance / integrity
Shaders (`shadeVS/shadeFS/copyVS/maxFS`) and the `_render` march logic are
unchanged from v64. Extraction verified: **harness render diff vs v64 = 0 pixels.**
