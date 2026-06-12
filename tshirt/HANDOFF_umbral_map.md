# Handoff — Umbral Path Flat Map (projections + palettes + print export)

## What this is
A standalone, self-contained HTML tool that draws the **umbral paths** (shaded strips) of
total / annular / hybrid solar eclipses on a flat world map. Built from the ShadowChaser
project's existing path data. **This is NOT the ShadowChaser app** — it reuses only the data.

Current deliverable: `umbral_paths.html` (one file, no CDN, inline SVG). Working and correct.

## New scope (this handoff)
Add **multiple map projections** and **multiple color schemes**, geared toward producing
**posters and t-shirt prints**. Plus **export** (SVG + high-res PNG). Everything else stays.

This is a Sonnet-appropriate task: transform math + palette tokens + an export button. No new
data work, no unresolved design questions.

---

## Data: where it comes from
Raw files in the public repo (network-allowed):
- `https://raw.githubusercontent.com/Alyosha47/ShadowChaser/main/data/paths/paths_1901_2000.json.gz`
- `.../paths/paths_2001_2100.json.gz`  (one gz file per century, ~5MB each)

Each is `{ cat_no: record }`, 224 records/century. Relevant record fields:
- `year, month, day, type` — type is `T/A/H` (+ variants like `T+,A-,Am,As,An,H3`). First letter
  is the class. Partials (`P,Pb,Pe`) have **no umbra** and are excluded.
- `umbra_n`, `umbra_s` — north / south edges of the umbral band. Each is a **list of polylines**
  (almost always length 1); a polyline is a list of `[lon, lat]`.
- (Unused here: `centreline`, `ge`, `umbra_ovals`, `penumbra_*`, `terminator_*`, `bisector`.)

## ⚠️ Critical gotcha — longitudes are pre-UNWRAPPED
Path longitudes are stored **continuous**, so they run **past ±180°** (e.g. 2012-05-20 reaches
259°, 2012-11-13 reaches 280°). There is **no ±180 jump to detect** — values just keep climbing.
If you plot raw, those paths run off the right edge and never reappear. **Any projection change
must keep handling this.** Do the wrap in geographic (lon/lat) space *before* projecting.

---

## How the current build works (pipeline, all done in Python at build time)
1. Load both gz files; keep records whose `year` is in the requested list and whose `type[0]`
   is `T/A/H`.
2. Build each band as a **closed strip**: `ring = umbra_n[0] + reversed(umbra_s[0])`.
3. `shapely` `simplify(0.12)` to cut point count (~700→~40 per edge).
4. **Wrap/split into world bounds**: for `k in (-1,0,1)`, `translate(poly, xoff=360*k)`,
   `.intersection(box(-180,-90,180,90))`, then `unary_union`. Result = 1–2 pieces, each fully
   inside [-180,180]. (7 of the current 24 split into 2 pieces.)
5. Round to 2 dp; emit JSON.

Reference eclipse set currently baked in (years): 1994,1995,1997,1998,1999,2001,2009,2012,
2015,2016,2017,2023,2024 → 24 umbral eclipses.

## Embedded data schema (inside the HTML)
```
{ "land":  [ [ [[lon,lat],...] ], ... ],          // simplified land polygons, exteriors only
  "bands": [ { "id":"9511", "date":"2012-05-20", "year":2012,
               "type":"annular",                   // total | annular | hybrid
               "pieces": [ [[lon,lat],...], ... ]   // 1+ closed rings, all within [-180,180]
             }, ... ] }
```

## How it renders now
- Inline SVG, `viewBox="-180 -90 360 180"`, `preserveAspectRatio="xMidYMid meet"`.
- Projection = **plate carrée**: a point `[lon,lat]` → SVG `(lon, -lat)`. That's the whole transform.
- Sidebar = clickable list (one row per eclipse, toggles all of that band's pieces), All/None,
  legend. Bands use `mix-blend-mode:screen` so overlaps read as additive light.
- Palette is a set of CSS variables in `:root` (`--ocean,--land,--land-stroke,--graticule,
  --total,--annular,--hybrid,--bg`).

---

## TASK 1 — Projections
Make projection selectable. Replace the single `point→(lon,-lat)` map with a `project(lon,lat)`
function per projection, applied to **land, bands (each piece), graticule, and frame**.

Two viable routes:

**A. Vendor `d3-geo` (recommended).** It gives Robinson, Mollweide, Natural Earth, Winkel Tripel,
equirectangular, etc., and crucially handles antimeridian cutting itself via `d3.geoPath()`.
If you go this way you can feed GeoJSON and **let d3 do the splitting** — but keep the lon-unwrap
note in mind for the raw umbra coords (convert them to GeoJSON polygons first; d3 will cut them).
Vendor the file locally (download `d3-geo` + `d3-geo-projection` UMD builds, inline them) to keep
the no-CDN/offline constraint. ~tens of KB.

**B. Hand-rolled projections (no dependency).** Each is a small closed-form formula on (λ,φ):
equirectangular (have), Mercator (clamp |lat|), Mollweide, Robinson (table-interpolated),
Winkel Tripel. Keep the existing Python wrap/split step (it's projection-independent because it
works in lon space) and just change the JS `project()`. The frame/graticule must be redrawn per
projection (e.g. Mollweide's elliptical boundary). More code than A; fully offline; no deps.

Recommended projection menu for posters: **Equirectangular, Robinson, Mollweide, Winkel Tripel,
Natural Earth.** (Skip globe/orthographic — that's the old app's job and not "flat".)

Note: SVG `viewBox` must change per projection (each has its own bounds/aspect ratio).

## TASK 2 — Color schemes (palettes)
Define palettes as objects and swap the CSS variables on selection. Each palette sets:
`bg, ocean, land, land-stroke, graticule, total, annular, hybrid`.

Suggested poster/print-ready themes (vary them — these are starting points):
- **Midnight** (current): dark navy ocean, gold/orange/violet bands, screen blend.
- **Blueprint**: deep blue ground, cyan land strokes, white/amber bands — technical-drawing look.
- **Kraft/Solar**: warm cream ground, muted brown land, red-orange-gold bands — great on natural
  t-shirts.
- **Mono Ink**: white ground, hairline black land, solid black bands with pattern fills to
  distinguish type (since one color) — ideal for **1-color screenprint**.
- **Riso**: 2–3 flat spot colors, no blend mode, slight registration offset for charm.

**T-shirt/screenprint constraints to honor:** for print themes, drop `mix-blend-mode:screen`
(printers can't do additive light), use **flat opaque fills**, and keep total ink colors low
(1–4 spot colors). Offer a per-type **pattern/hatch fill** option so types stay distinguishable
in a single-color print.

## TASK 3 — Export
- **SVG download:** the map already *is* SVG. Clone `#map`, inline computed colors (resolve the
  CSS vars to literals so it's portable), strip interactivity, serialize, download. This is the
  print master — vector, scales to any poster size.
- **PNG (high-res):** render the SVG to a large canvas (e.g. 4000–6000px long edge for poster DPI)
  and download. Offer transparent vs. colored background.
- Export should exclude the sidebar/legend (or offer "with/without legend & title").

## Nice-to-haves (optional, low priority)
- Title/subtitle text fields baked into the export (e.g. "Solar Eclipses 1994–2024").
- Adjustable band opacity / stroke weight.
- The clickable list currently only holds the 24 reference eclipses; opening it to the full
  catalogue is a separate task (load full century files, build a searchable list) — out of scope
  here.

## Build/run notes
- Python deps used at build time: `shapely`, (`matplotlib` only for sanity-check renders).
- The HTML is fully self-contained — no build step to view it, just open in a browser.
- Keep it one file, no CDN. Don't break the working plate-carrée path while adding the rest.
