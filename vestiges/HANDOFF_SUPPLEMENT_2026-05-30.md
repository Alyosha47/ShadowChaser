# Handoff Supplement — Session 2026-05-30
Build range: 2026-05-29a → 2026-05-30g

---

## What Actually Got Done

### ✅ Cosmetic / UI polish (solid, deployed)

- **Tab contrast** — tab bar darkened to `#070911`; active tab lifts to `#1a2030`; sidebar chrome strip `#040508` (darkest), unselected tabs `--bg2`, active `#1a2030`
- **Rise / Set labels** — "Sunrise"/"Sunset" → "Rise"/"Set" in details panel
- **Corona** — turbulence removed (too subtle); brightness and radius kept increased from previous session
- **Search instructions** — replaced 3-column table with clean 2-column CSS grid; gold token name left, examples right; all notes stripped; "Obscuration" restored as canonical term throughout
- **Search-range setting** — new select in Settings: Modern era / ±500 years / Extended / All; persisted to localStorage; bypassed when user has explicit year filter; note that smaller ranges search faster
- **Detail panel icon** — matched to list icon size (32px)
- **Contact times vertical alignment** — `vertical-align: middle` on SVG icons
- **Settings text** — unified to 0.72rem mono; selects explicitly sized to match
- **Map brightness slider** — removed
- **"Force offline map" toggle** — replaces the old map on/off switch; forces local GeoJSON basemap for debugging

### ✅ Share (solid, deployed)

- **share.js rewritten** — clean, no blob cruft, no duplicate URL, no title field
- **Share text format** — tabstop-aligned per spec: header, Greatest Eclipse block (Duration/Time/Location/Magnitude), Path width standalone, local circumstances block if coords set, blank lines between blocks, URL, credit
- **C2/C3 labels** — "umbral" → "total"
- **Credit line** — "ShadowChaser app by followtheshadow.com" at bottom only
- **About section** — mailto bug report link (`app@followtheshadow.com`), Android note added

### ✅ Map init architecture (solid)

- **probeOnline** — replaced with `generate_204` connectivity probe running in parallel with `loadBasemapData()` via `Promise.all`; no CORB risk; no wasted fetch
- **deckOverlay** — correctly nulled on map removal so it reinitialises cleanly after toggle
- **Offline map colors** — warm organic palette matching online tint (blue ocean, green land)
- **Globe fog** — `setFog()` applied to make atmosphere opaque; far-side markers no longer bleed through

---

## What Did NOT Get Done / Still Broken

### ❌ Observer marker pin
Attempted emoji (📍) and SVG teardrop — both failed (floating position, wrong anchor, wrong scale). **Reverted to original red dot.** Needs a proper MapLibre symbol layer approach, which requires resolving the reasons GeoJSON layers were abandoned (see previous handoff).

### ❌ Offline map polar artifacts
The land.geojson is a single MultiPolygon with one ring spanning 360° longitude — MapLibre fills the wrong side near the poles, producing circumpolar green stripes and a large erroneous fill across the North Atlantic. A Shapely-based clip/split was attempted but is not verified. **Needs proper data replacement** — the land.geojson should be replaced with correctly antimeridian-split data, ideally sourced from a globe-aware pipeline rather than patched in Python.

### ❌ Eclipse paths in offline mode
Not confirmed working. May resolve once polar artifact fix is confirmed.

### ❌ Share email formatting
Platform ceiling: `navigator.share` and `mailto:` both deliver plain text only. No tables, no images, no HTML. **Backlog item: server-side share page** at `followtheshadow.com/share?e=XXXXX` that renders a formatted HTML summary — simple static JS page, no backend needed.

### ❌ Offline city labels
MapLibre symbol layers require PBF glyph files — system fonts not available to WebGL renderer. **Backlog item: bundle Noto Sans PBF glyphs** (~2-3MB) for true offline labels. Currently dots only.

---

## Backlog Items Added This Session

1. **Server-side share page** — `followtheshadow.com/share?e=XXXXX`, static HTML, reads eclipse data from existing JSON, renders formatted summary with map image
2. **Offline city labels** — bundle PBF glyphs or find alternative offline font approach
3. **Observer pin** — proper MapLibre symbol layer implementation (understand why GeoJSON was abandoned first)
4. **Mobile debugging group** — map date visibility (#25) and other mobile-only items, park until desktop is stable

---

## Current Build
`2026-05-30g`

## Notes
- Session was frustrating and inefficient. Too many iterations on pin, share email, and offline map without clear diagnosis first.
- The offline map data quality (land.geojson) is the root cause of most remaining offline issues. Fix the data, not the code.
