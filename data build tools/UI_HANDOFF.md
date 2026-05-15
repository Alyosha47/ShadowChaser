# UI HANDOFF — eclipse path data

This document describes the JSON structure of the eclipse path files,
along with the gotchas, accuracy limits, and rendering recommendations
the UI needs to know.

The path-generation work is **done**. The data files described below
are the input to the UI work. Do not regenerate them; do not modify
the generator.

---

## File layout

50 chunk files, one per century, gzipped:

```
data/paths/paths_-1999_-1900.json.gz
data/paths/paths_-1899_-1800.json.gz
...
data/paths/paths_2901_3000.json.gz
```

Each file is gzipped JSON, ~3-4 MB compressed, ~8 MB raw.
**Total: ~200 MB compressed for 5 millennia.**

Decompression at app load: standard `pako` (JS) or platform gunzip.

---

## Top-level structure

Each file is a **dict keyed by `cat_no` string**:

```json
{
  "9681": { ...record... },
  "9682": { ...record... },
  ...
}
```

`cat_no` is the NASA five-digit eclipse catalog number. It's a stable,
globally unique identifier — use it as the primary key in your UI.

---

## Record structure

```json
{
  "cat_no":           9681,
  "year":             2017,
  "month":            8,
  "day":              21,
  "type":             "T",
  "ge":               [-87.6556, 36.9667],
  "centreline":       [ [[lon,lat], [lon,lat], ...], ... ],
  "umbra_n":          [ [[lon,lat], ...], ... ],
  "umbra_s":          [ [[lon,lat], ...], ... ],
  "umbra_ovals":      [ [[lon,lat], [lon,lat], ...], ... ],
  "penumbra_n":       [ [[lon,lat], ...], ... ],
  "penumbra_s":       [ [[lon,lat], ...], ... ],
  "terminator_first": [ [[lon,lat], ...], ... ],
  "terminator_last":  [ [[lon,lat], ...], ... ]
}
```

### Field reference

| Field | Meaning |
|---|---|
| `cat_no` | NASA catalog number |
| `year`, `month`, `day` | Calendar date of eclipse (UT) |
| `type` | `"T"` total, `"A"` annular, `"H"` hybrid, `"P"` partial |
| `ge` | `[lon, lat]` of greatest eclipse point |
| All curve fields | List of segments; each segment is a list of `[lon, lat]` vertices |

### Curve fields explained

Every curve field is a **list of polyline segments**. Most curves are
a single segment; some are split (e.g. polar wraparound). Always
iterate.

```js
for (const segment of record.centreline) {
  drawPolyline(segment);   // segment is [[lon,lat], [lon,lat], ...]
}
```

| Field | What it is | Render as |
|---|---|---|
| `centreline` | Path of shadow axis on Earth | Solid line |
| `umbra_n` / `umbra_s` | North/south edges of totality (or annularity) | Solid lines, slightly outside centerline |
| `umbra_ovals` | Closed disk perimeters at fixed time intervals — the actual umbra footprint at instants in time | Filled or outlined polygons |
| `penumbra_n` / `penumbra_s` | Outer edges of where any partial eclipse is visible | Dashed/faint lines |
| `terminator_first` / `terminator_last` | Sunrise/sunset boundary lemniscates — the closed loops where the eclipse is in progress at sunrise (first) or sunset (last) | Closed polygon outlines |

For partial eclipses (`type: "P"`):
- `centreline`, `umbra_n`, `umbra_s`, `umbra_ovals` will all be empty `[]`
- Only `penumbra_n/s` and `terminator_first/last` have data

---

## Coordinate order

**All coordinates are `[lon, lat]`** — both single points (`ge`) and
polyline/polygon vertices in every curve field. This matches what
MapLibre / Leaflet / Mapbox / most map libraries expect, so no
normalization needed.

---

## ⚠️ Longitude wraparound

Some curves (especially `terminator_first` / `terminator_last`) cross
the antimeridian. The data may contain longitude values **outside
[-180, 180]** — e.g. `lon = -293°` is a valid point representing the
same physical location as `lon = +67°`.

This is a generator-side artefact of the unwrap step that keeps
adjacent vertices in a polyline numerically continuous (so renderers
don't draw a horizontal line across the whole map at the seam).

**For most map libraries you DO want the unwrapped values** — they
prevent the seam-line bug. Just don't assume longitudes are in
[-180, 180] anywhere in your code. If you need to normalize a single
point for display (e.g. showing greatest-eclipse coords as text), do
`lon = ((lon + 180) % 360) - 180`.

---

## Accuracy & known limits

| Curve | Median error vs Jubier | Notes |
|---|---|---|
| `centreline` | 3–500 m | Sub-15 m for pre-2010 totals; ~250-500 m for recent eclipses (ΔT calibration choice) |
| `umbra_n` / `umbra_s` | 120–600 m | House-accurate. Endpoint vertices may be 50-80 km off (cosmetic, single point per curve) |
| `penumbra_n` / `penumbra_s` | 25 km (total), 100+ km (annular/hybrid) | Known limitation. Penumbra is a fuzzy boundary anyway |
| `terminator_first` / `terminator_last` | ~3 km median, ~10 km 90th, ~100 km at tangency tips | Known limitation, fuzzy boundary |

For the user experience, **what matters is centerline and umbra**, both of
which are house-accurate. Penumbra and terminator are imprecise but
they're physically fuzzy (~minutes of solar disk visibility transition)
so the error is invisible in practice.

### When NOT to trust the data

- **Polar grazers** (eclipses with `gamma > 0.95`) have larger umbra
  errors at the path entry/exit. 1997 was 7 km median, 35 km max.
- **Pre-1900 eclipses** have ΔT uncertainty in seconds (translates
  to km of ground-track uncertainty). Not a code bug; physics.
- **Post-2050 eclipses** use a long-term ΔT extrapolation
  (SMH 2016 LOD model). Increasingly speculative further out.
- **Annular/hybrid penumbra** is much worse than total (above table).

---

## Performance hints

- **Lazy load by century**: don't load all 50 chunks at startup. Load
  on demand based on what year range the user is browsing.
- **In-memory cache**: each century is ~8 MB raw. A LRU cache of
  3-5 centuries is plenty for a smooth browsing experience and
  costs ~30-40 MB of RAM.
- **Decompress on a worker thread**: `pako` parsing of an 8 MB JSON
  blob takes a noticeable fraction of a second on slower phones.
  Move it off the main thread.
- **Don't simplify further at runtime**: the data is already DP-simplified
  at the right tolerances per curve type. Re-simplifying loses fidelity
  for negligible perf gain.

---

## Sample record (truncated)

```json
{
  "cat_no": 9681,
  "year": 2017,
  "month": 8,
  "day": 21,
  "type": "T",
  "ge": [-87.6556, 36.9667],
  "centreline": [
    [[-128.93, 44.93], [-128.21, 44.74], [-127.49, 44.55], "..."]
  ],
  "umbra_n": [
    [[-129.41, 45.42], [-128.69, 45.23], "..."]
  ],
  "umbra_s": [
    [[-128.45, 44.43], [-127.74, 44.24], "..."]
  ],
  "umbra_ovals": [
    [[-129.41, 45.42], [-128.93, 44.93], "..."]
  ],
  "penumbra_n": [
    [[-180.00, 70.21], [-178.50, 70.18], "..."]
  ],
  "penumbra_s": [
    [[-180.00, 12.34], [-178.50, 12.41], "..."]
  ],
  "terminator_first": [
    [[-44.49, 30.34], [-44.78, 31.07], "..."]
  ],
  "terminator_last": [
    [[174.32, -13.96], [175.61, -13.42], "..."]
  ]
}
```

All coordinates above are `[lon, lat]`.

---

## Not included (yet)

These curves exist in Jubier's KMZs but are **not generated** by the
current code:

- Magnitude curves (0.2 / 0.4 / 0.6 / 0.8 northern + southern)
- Time-grid maximum-eclipse curves (every 30 min UT)
- "Maximum on horizon" bisector curves

If the UI needs them, the generator would need to be extended (~2-3 MB
per century gzipped extra). Not a blocker — most eclipse-chasing apps
ship without them.

---

## What to bring to the new chat

Paste this document, plus:
- Your existing JS / HTML files
- The map library you're using (MapLibre / Leaflet / etc.)
- A short statement of what's already working and what's next

Don't paste the path-generation code or the prior generator handoff.
That work is done and is irrelevant to UI work.
