# ShadowChaser — build 2026-07-10l — “OFFLINE WORKS”

Milestone: the Cesium map now works fully **offline on iOS Safari** — the platform
that had been failing for weeks. Survives tab-backgrounding, survives an offline
reload, and switches online↔offline seamlessly with no reload.

## Files in this commit
- `js/map.js`   — the map layer (all the work below)
- `index.html`  — build stamp `2026-07-10l`, on-screen error catcher, script `?v=` bump
- `sw.js`       — service-worker precache (Cesium workers + basemap) so offline reload works
- `js/state.js` — in-flight chunk-load de-duplication (network-storm fix)
- `TODO.md`     — consolidated (TODO2 folded in; done items removed; cosmetics queued)

Deploy note: files are uploaded manually to followtheshadow.com/app
(`map.js`→`js/`, `sw.js`+`index.html`→root). NE2 (`data/basemap/ne2.jpg`) is already
on the server; no new data asset this build.

## What made offline finally work (the real root causes)
1. **iOS never reports offline.** `navigator.onLine` lies and the `offline` event
   doesn’t fire on Safari. Replaced with an **active probe** to the Esri tile origin
   (3 s AbortController timeout because iOS *hangs* on offline fetch; cache-busted
   because iOS ignores `no-store`). One `_online` boolean drives everything.
2. **Offline reload hung.** Cesium’s geometry Web Workers weren’t precached, so an
   offline reload hung waiting for them. `sw.js` now precaches the Cesium worker set +
   basemap, with bounded install concurrency and fail-fast on uncached offline fetches.
3. **iOS renderer got killed on backgrounding.** The culprit was Cesium’s default
   render-pipeline framebuffers, not our data. On mobile we now disable the **skybox,
   atmosphere, FXAA**, and drop **MSAA** to 1. (We also briefly disabled OIT chasing this;
   it didn’t help and there’s no evidence it broke anything — left at its default.)
4. **`f.globe` render crash + gappy paths.** Caused by **clamp-to-ground**
   (`CLAMP_TO_GROUND` / `clampToGround`) on iOS. Removed entirely.
5. **Land fill vs labels.** A floating fill primitive swallowed labels; clamp (its fix)
   crashed iOS. Solved by making land part of the **globe surface** — the mobile offline
   basemap is NE2 imagery, which can’t occlude overlays and is depth-correct at the limb.

## Also in this milestone
- **Online mobile quality restored** — earlier memory hacks (coarse globe, tiny tile
  cache) only degraded the *online* map; reverted to Cesium defaults → smooth again.
- **map.js consolidated** — every scattered `isWide()` branch collapsed into one
  declarative `PROFILE` object (mobile vs desktop render + data settings, decided once).
- **Sun arrow** rebuilt as **flat surface geometry** (shaft + barbs drawn on the globe)
  instead of a screen-space billboard that poked into space at the limb.
- **On-screen error catcher** in `index.html` — surfaces real errors + WebGL
  context-loss on the phone (no Mac needed for debugging).

## Known follow-ups (see TODO.md “MAP COSMETICS”)
Arrow restyle (red + elegant head + live min/max sizing), GE diamond marker, push-pin
observer marker, mobile default zoom + zoom sensitivity, details→hamburger icon,
smaller city dots, raster sharpness ceiling, limb faceting.

## Traps recorded (do NOT re-attempt — see TODO.md “⛔ DO NOT DO”)
- Do **not** re-add clamp-to-ground on iOS (offline `f.globe` crash + path gaps).
- Disabling order-independent translucency on mobile is pointless — tried it, it didn’t fix
  backgrounding (the framebuffer cuts did) and there’s no evidence it broke anything.
