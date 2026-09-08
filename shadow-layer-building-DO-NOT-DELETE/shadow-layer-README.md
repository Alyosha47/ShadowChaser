# ShadowLayer — drop-in terrain shadow layer for MapLibre GL JS

A single-file MapLibre **custom layer** that renders terrain (bare-earth) sun
shadows over your existing map. Extracted from the ShadowChaser **v64** study;
the shaders and atlas build are **byte-for-byte the study's** and the march math
is unchanged — verified pixel-identical output. Only the study's self-hosted map,
DOM UI, and time slider were removed and replaced with a small API. See
[Provenance](#provenance--integrity) for exactly what changed.

## Files
- `shadow-layer.js` — the module (exposes `createShadowLayer`; also CommonJS `module.exports`).
- `shadow-layer-example.html` — minimal working integration (map + slider).
- `js/shadow-layer.ORIGINAL.js` — the pristine v64 extraction, not loaded. Note the
  filename uses a **dot**, not an underscore.
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
| `demUrlBase` | string | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/` | `{z}/{x}/{y}.png` DEM tile base URL |
| `ss` | bool | `false` | 2×2 supersampled shadow edges (see below). **The module default is `false`, but the app passes `ss:true`** — `shadow-ui.js` constructs the layer with it on. |
| `selfTest` | bool | `false` | draw the analytic self-test overlay (dev) |
| `showElevation` | bool | `false` | elevation debug tint (dev) |
| `onStatus` | `fn(text)` | none | receive the per-frame status string |
| `onLog` | `fn(msg)` | none | receive diagnostic log lines |

**instance methods:**
- `shadow.setTime(Date | ms)` — update the instant; triggers a repaint. Returns `this`.
- `shadow.getTime()` → epoch-ms.
- `shadow.setOptions({...})` — update any of `ss`, `selfTest`, `showElevation`, `onStatus`, `onLog`, `shadowColor`; repaints. Returns `this`.
  **`shadowColor` writes to the module-level `SHADOW_RGBA`, not to the instance.**
  With one layer that is invisible; with two live layers they would share a tint,
  the last write winning. Recolouring the layer for a different mode is therefore
  supported and cheap — running two differently-coloured layers at once is not.
- `onRemove` is implemented: `map.removeLayer('shadow')` detaches the internal
  move/zoom listeners and clears the idle timer.

## Supersampling (`ss`)
Off by default. When on, each pixel's shadow value is the average of four
sub-pixel ray-marches (`occAt()` on a 2×2 grid), so partially-shadowed pixels get
their **true fractional coverage** rather than a single-sample edge estimate.
This is physical anti-aliasing, not an edge blur, and it removes the speckle that
appears when one ray per pixel undersamples the terrain.

Cost is gated so it only runs where it helps:
- `SS_ZOOM_MAX` (12) — above this zoom a single ray is already clean.
- `SS_SUN_MAX` (18°) — below this sun altitude shadows graze, so supersample anyway.
- During pan, zoom, or time scrubbing the layer drops to a single ray; ~130 ms
  after motion stops it repaints once at full supersampling.

With `ss:false` the shader takes the original single-ray path.

The app runs with `ss:true`, so in practice shadow edges carry fractional
coverage rather than a hard in/out boundary. Anything layered on top of this
that wants a **binary** mask should pass `ss:false` explicitly.

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
- `SS_ZOOM_MAX` (12), `SS_SUN_MAX` (18) — where supersampling engages.
- `SHADOW_RGBA` — default tint (or pass `shadowColor`).

## Provenance / integrity
In the **extraction** (`shadow-layer.ORIGINAL.js`) the shaders
(`shadeVS/shadeFS/copyVS/maxFS`) and the atlas-build path are byte-identical to
v64. `_render` is *not* byte-identical: the march math is untouched, but the
inputs were rewired off the DOM — `map.getBounds/getCenter` → `this.map.…`,
`BASE+offsetMin*60000` → `this.timeMs`, and the two checkbox reads → `this.opts`.
The same rewiring (plus `window.matchMedia` → a guarded `_mm`, and the removal of
the map constructor, `#log`/`window.onerror`, slider, and click-probe) is why the
file as a whole differs from v64 even though the engine does not.
Verified: **harness render diff vs v64 = 0 pixels.**

The current `shadow-layer.js` is that extraction **plus supersampling** — purely
additive (`occAt()`, the `u_ss`/`u_pixM` uniforms, the motion gate, `onRemove`);
nothing was removed. The fragment shader is therefore no longer byte-identical to
v64: the single-ray march is now wrapped in `if(u_ss<0.5||u_synth>0.5)`. With
`ss:false` that branch is taken and the march is the study's, unchanged.
