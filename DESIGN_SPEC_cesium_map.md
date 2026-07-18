# ShadowChaser — Cesium map.js design details (portable spec)
Extracted from js/map.js on the `cesium` branch, so the pin/arrow/palette can be
re-applied on any renderer. Line numbers are for reference only.

## Observer pin  (pinImage(), ~L1018–1087)
Hand-drawn canvas billboard, 44×66px, TIP = exact coordinate (verticalOrigin BOTTOM).
- Contact dot at tip: radius 3.2, fill rgba(30,26,22,0.92), stroke rgba(255,255,255,0.9) @1.1px
- Needle: tapering quad, half-width nw=2.4, fill #7a7c82, outline #232120 @1px; highlight streak #e2e4e9 @0.8px
- Collar: ellipse rx=headR*0.44, ry=2.4, fill #696970, outline #232120 @0.8px
- Head: dark rim #280a04 (r=headR+1.2); red face #cc2200 (r=12); white ring rgba(255,255,255,0.92) @1.6px;
        specular highlight dot rgba(255,255,255,0.47) upper-left (r=headR*0.30)
- Geometry: W=44 H=66, cx=22, headR=12, headY=15, neckY≈24.4, tipY=64

## Sun arrow  (~L1089–1215)
Flat geometry draped ON the globe (not a screen billboard). CONSTANT on-screen size via
camera.getPixelSize (metres-per-device-pixel), scaled by DPR.
- ARROW_COL '#cc2200'
- ARROW_PX 44         (on-screen total length, px, constant at all zoom)
- ARROW_MAX_M 3.0e5   (world cap 300 km)
- HEAD_FRAC 0.30      (head = 30% of length, stem 70%)
- HEAD_WIDTH 0.42     (head half-width / head length)
- LIFT_FRAC 0.06      (lift above surface / length; clears z-fighting, no parallax)

## Greatest-eclipse marker  (~L1240)
Orange diamond #f08a1e, canvas billboard (drawn once, cached). Distinct from red observer/arrow.

## Path palettes  (two, auto-switched by active basemap)  (~L1344–1356)
PATH_WIDTH 1.4 (solid, no casing). Umbra corridor fills at alpha 70.
Ovals fade with zoom: OVAL_HIDE_HEIGHT 6.0e6 m (full), OVAL_FADE_LO 3.5e6 m (gone).

PAL_SAT   (offline satellite — bright on dark ocean/varied land):
  penumbra [120,180,255]  umbraT [245,140,30]  umbraA [80,160,255]
  ovalTline [255,185,95]  ovalAline [140,190,255]  centre [255,60,40]  green [70,215,85]

PAL_STREET (online street — deep, on pale backgrounds):
  penumbra [28,92,205]   umbraT [200,92,0]    umbraA [18,70,175]
  ovalTline [205,110,25] ovalAline [40,92,200] centre [200,26,14]   green [0,140,22]

## Base map palette (COL)  (~L96–102, 421, 432)
OCEAN #b8d0e8  LAND #d4e8c8  BORDER #4a4640  COAST #6a8870  RIVER #90b8d8  CITY #c8a96e
globe.baseColor #a4c7db (sampled from NE2 ocean)   backgroundColor #05070f (space)

## City markers (~L782–812)
BillboardCollection; point pixelSize by rank {1:4, 2:3, 3:2.5} else 2.5; color = COL.CITY;
disableDepthTestDistance = Infinity (draw whole, never depth-clipped); label billboards centered.

## Mobile / perf notes baked into the Cesium version
- resolutionScale capped at min(DPR,2)  (native DPR OOM'd on iOS)
- scene.sun.show=false; enableTilt=false (axis-style spin only)
- pin/arrow live in js/map.js; eclipse math + path data live in eclipse.js / details.js / data/paths (renderer-independent)
