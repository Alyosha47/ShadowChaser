# Desirability overlay — feature handoff

**This is scoping output, not a third document.** Fold it into `TODO.md` as one feature entry
and delete this file. `HANDOFF.md` and `TODO.md` are the only two docs (see THE FILING RULE).

Everything below marked **MEASURED** was verified against `main` at commit `386ce5d` on
2026-09-01, by running the real code and real data. Everything marked **UNVERIFIED** was not.

---

## 1. What the feature is

A third map overlay: **one composite score**, green→red, for "how good is this spot for
watching *this* eclipse". Not a stack of layers — cloud and terrain already have their own
overlays. This is the single number that blends them.

Drawn only inside the **central path** (umbral / antumbral corridor). Total and annular only.
No penumbra. The button is disabled for non-central eclipses.

### The score

```
S = C^0.60 · D^0.40 · A^0.15        with a hard VETO where terrain blocks the sun
```

- **C** — clear-sky term, from the existing cloud climatology, 0–1.
- **D** — totality duration ÷ this eclipse's maximum duration, 0–1.
- **A** — sun-altitude term, small weight. `A = clamp((alt − 2) / (15 − 2), 0, 1)`, i.e. flat
  above ~15–20°, falling below ~10°, zero at the horizon. `computeEclipse` already returns
  `sun.alt`, so it is free. The 0.15 exponent is a **starting point, not calibrated** — the
  eight forced-choice pairs held sun height equal deliberately, so it was not fitted. Tune by
  eye against the Spain 2026 reference map.
- **VETO** — sun below the *terrain* horizon. **Not** a low score. Same red family as the
  ramp's worst, but **darker and fully opaque** where the ramp's worst is lighter and slightly
  translucent. One extra LUT entry, no hatch, no new hue.

Multiplicative, not a weighted sum: a sum lets a cloud-locked 4-minute valley outrank a clear
2-minute ridge. The concave exponents apply diminishing returns — the first second of totality
is worth far more than the 240th, which plain expected-seconds (`C · D`) gets wrong.

**The exponents 0.60 / 0.40 are CALIBRATED, not invented.** They were fitted to the user's own
answers on eight forced-choice pairs (duration vs clear-sky odds, sun height held equal), run
2026-09-01. Cloud carries the larger exponent because it spans 0→1 while D only spans
edge→centre, and because chasers optimise weather first.

**Known inconsistency, recorded deliberately.** A single power law predicts the answers flip
from short-and-clear to long-and-cloudy exactly once as the trade steepens. The user's answers
flipped three times; two (pairs #2 and #6) cannot be reconciled with the other six. Sorting the
answers by the *size* of the clear-sky gap reveals a cleaner rule than any exponent:

- clear-sky gap of 8–10 points → user took the longer, cloudier option
- clear-sky gap of 15+ points → user took the clearer, shorter option

i.e. **small cloud differences are ignored, then a switch flips once the gap is real.**

The user confirmed this is his actual reasoning, in his words: *small variations in cloud
likelihood are close to equivalent, so if there's a compelling enough jump in duration he'll
take it — but a real delta in cloud-threat scares him toward the clear sky.*

It is also defensible on grounds he did not have in front of him: the cloud figure is a
climatological mean on ~55 km cells and §10.6 already warns it is not a probability, so an
8-point difference between neighbouring cells is inside the noise.

**Do NOT build a deadband in v1** — it would make the map blotchy and adds a second mechanism to
debug. Ship 0.60 / 0.40. Revisit only if the map visibly ranks spots on differences too small to
mean anything. Three more forced-choice pairs would settle #2 vs #6 if it becomes worth it.

### Normalisation — decided

**Per eclipse, always.** The colour means "best spot *for this eclipse*", never "this eclipse
is better than that one". Consequence to accept: green on the 2028 map and green on the 1997
map do not mean the same thing, so the legend must say "compared to the rest of this path"
and not imply an absolute scale.

Plus a **Whole path / This view** mode (user's idea, and a good one). Whole path is the
default and never moves. This view restretches the ramp to the min/max currently on screen,
so that once you have chosen Spain over Greenland you can still see contrast within Spain.

Make it a **mode, not a button**. A "recalibrate now" button goes stale the moment you pan and
nothing tells you. A mode makes colours-move-on-pan the stated behaviour, so it cannot read as
a bug. Debounce on `moveend`, not during the drag. Stretch on the 2nd–98th percentile, not
min/max, or one anomalous cell owns the ramp. Restretch the **composite score once** — never
rescale C and D separately, which would amplify whichever term happens to be flat into false
contrast.

### Rejected, with reasons

- **Land mask** — withdrawn. 2031 is total over no land at all. At sea the horizon is
  genuinely clear and both other terms are fully meaningful. A boat is a viewing location.
- **Elevation bonus** — double-counts cloud, and mountains make their own weather.
- **Road/settlement access** — no data.

### Fourth term — DECIDED, include at small weight

**Sun altitude, separate from terrain.** A 4° sun means heavy extinction and horizon murk even
over open sea. The reference site (eclipse.lluisgasso.com) weights it first. Suggested shape:
flat above ~20°, falling below ~10°. `computeEclipse` already returns `sun.alt`, so it is free.

---

## 1a. `shadow-layer-building-DO-NOT-DELETE/` — the shadow-layer archive

This folder is the **shadow-layer archive**, not a desirability archive. It predates this
feature and outlives it. Several files there have similar names and **different jobs**; the
last backup silently vanished in a commit titled "refactored handoff", so this is written down.

| file | what it is | use |
|---|---|---|
| `js/shadow-layer.js` (live, not in the folder) | the shipped engine, 1243 lines | live |
| `shadow-layer_PRE-MASK.js` | copy of the shipped file taken immediately before the mask work | **the rollback target** |
| `shadow-layer.ORIGINAL.js` | the v64 **extraction**, 1157 lines, no supersampling | provenance |
| the v64 study files | the original standalone study the engine came from | provenance |

**MEASURED:** `ORIGINAL` and the shipped file differ by 92 lines — that is the supersampling.
**Restoring `ORIGINAL` would silently delete supersampling.** It is a provenance record, not a
safety net. `PRE-MASK` is the file you restore from and diff against.

Nothing in the folder is loaded by `index.html` or listed in `sw.js` CORE, and **no test checks
that it isn't**. Keep a `README.md` in the folder carrying this table.

---

## 2. MEASURED findings — these change the plan

### 2.1 Duration is cheap. Compute it exactly, per cell. No approximation.

**MEASURED:** `computeEclipse` costs **4.9 µs per call** (Node 22, warmed, 30k calls, points
inside the 2026 path).

| corridor cells | desktop | mobile (~4×) |
|---|---|---|
| 2,000 | 10 ms | 40 ms |
| 10,000 | 49 ms | 200 ms |
| 70,000 | 346 ms | 1.4 s |

The corridor is a ribbon, so a viewport canvas of the size `cloud-average.js` uses over Iberia
(288×237 = 68k cells) contains far fewer corridor cells than that.

**Consequences.** Two earlier proposals are now dead and should not be resurrected:

- The chord approximation `dur ≈ dur_centre · √(1−(d/w)²)` is **unnecessary**. Don't build it.
- The 13×7 interpolation grid (§10.2's trick, which cloud uses for *timing*) is **unnecessary
  for duration**. Call `computeEclipse` per cell and get the exact answer, including the hard
  zero at the path limits that any interpolation would have smeared.

**NO GENERATOR CHANGES.** Paths are paths; they carry no durations and do not need to.

### 2.2 The `alt` argument is not optional

**MEASURED:** `computeEclipse(rec, 42.5, -2.0)` with `alt` omitted returns `type:'annular'`
and `mag: NaN` for 2026-08-12 in northern Spain. With `alt` explicitly `0` it correctly
returns `type:'total'`, `mag 1.03276`, `durCentral 64.5 s`.

`local.js:29` always passes `_lookedUpAlt || 0`, so the app never hits this. Any new caller
must pass `alt`. Worth a line in HANDOFF §9.

*(Aside, not this feature's problem: `osc` came back as exactly `100` for a point with
`mag 0.9986`, which should be ~99.x. That is the obscuration work happening in the user's
other thread. Flagged, not touched.)*

### 2.3 There is NO corridor polygon. Do not build one.

**This section replaces an earlier draft that sent the reader into a known tar pit. Read it
before writing any corridor code.**

The score layer is a **raster**. The only question it ever asks is *"is THIS cell inside the
central path?"* — and `computeEclipse` already answers that directly:

```js
var r = computeEclipse(rec, lat, lon, 0);          // alt is NOT optional, see 2.2
var inCorridor = r.visible && (r.type === 'total' || r.type === 'annular');
```

**MEASURED.** 2026-08-12 rasterized this way over a deliberately oversized grid
(440 x 260 = 114,400 cells spanning 180 deg of longitude, far larger than any real viewport)
took **417 ms in Node**. The result is a clean ribbon: correct over the pole, no flat bar, no
fold, no self-crossing. A real viewport canvas is smaller than this.

**It costs nothing extra.** The layer is already calling `computeEclipse` per cell for
duration (§2.1). The same return value carries the membership test. One call, both answers.

**What this deletes from the plan.** All of the following were scaffolding for a polygon that
should not exist. Do not build any of them:

- limb pairing (`umbra_n` + reversed `umbra_s`)
- the 360-degree branch-alignment fix
- joining or de-forking multi-segment limbs
- the area-ratio sanity guard
- Sutherland-Hodgman clipping against the Mercator latitude limit

**Why the polygon approach fails, so nobody retries it.** `map.js` (~line 1713) has corridor
fill **deliberately disabled**: *"SolidPolygonLayer triangulates the corridor as a flat lon/lat
polygon. Paths that pass near a pole or cross the antimeridian produce wrong fills."* The full
diagnosis is in the **deleted `BACKLOG.md`** (`git show de95fda^:BACKLOG.md`), which records
that four prior elegant attempts — `signedLonWinding`, `polarCapRing`, `splitAtAntimeridian`,
tiled-corridor — **each fixed one case and broke others**.

This assistant independently walked into the same wall while scoping, and the findings are
worth recording because they show it is not a shallow bug:

- **MEASURED:** the two limbs are stored with their own longitude continuation and can land in
  different 360-degree branches (2072-09-12: north limb +111..+169, south limb -134..-228).
  Aligning them fixes *some* paths.
- **MEASURED:** multi-segment limbs are usually ONE curve cut at a seam, not two branches.
  2097-11-04's north limb splits at latitude -89.99 with its two ends **1 km apart** —
  contiguous. A "longest segment wins" rule discards 78 real points and closes the ring across
  7,000 km, manufacturing a bowtie. (1979-08-22 is the opposite case: two south segments
  sharing an identical start point, a true fork.) So the rule has to be a *test*, not a
  preference — and even then:
- **MEASURED, and decisive:** after fixing both of the above, a rendered contact sheet of 24
  corridors still showed roughly **9 broken fills, every one of them a polar path — including
  2026-08-12**. Proper latitude clipping (not clamping) did **not** help. The reason is
  structural: when a corridor crosses a pole the north and south limits **swap sides**, so the
  ring wraps instead of closing. A polar corridor is not a simple lon/lat polygon and no amount
  of vertex bookkeeping makes it one.

Per-cell membership sidesteps every one of these because it never builds a ring.

**The existing outline is unaffected.** deck.gl continues to draw `umbra_n` / `umbra_s` /
`centreline` exactly as today. This section governs only how the score layer decides which
cells to paint. §9.5's grazing-tip zigzag also stays where it is, an independent backlog item;
it is visible in the 1979-08-22 outline and is not this feature's problem.

**One-limit grazers** still need excluding — they have no interior. Identify them from the type
code exactly as `audit_paths.py` does (`one_limit` = `type[1] in "n s - +"`), or simply let the
membership test find no qualifying cells, which it will.

### 2.4 The terrain half needs NO changes to `shadow-layer.js`

**MEASURED** from source:

- `setOptions({shadowColor})` — line 1231 copies into `SHADOW_RGBA`; line 1233 calls
  `triggerRepaint()`. Takes RGBA, so alpha is available. **Works today.**
- `setTime()` — line 1219, also repaints.
- So: borrow the existing engine, set it to veto red, pin its time to the local maximum, hide
  the scrubber. **Zero engine changes.**

**Gotcha:** `SHADOW_RGBA` is a **module-level array, not per-instance**. Two live layers would
share one tint, last write winning. Harmless given the decision below.

**Decision (user's): ONE overlay at a time.** Desirability mode and shadow mode are mutually
exclusive presentations of the same engine. Whoever owns it sets colour and time. This is also
what makes the module-level tint safe.

**Gotcha:** the module default is `ss:false` but `shadow-ui.js:54` passes `ss:true`, so shadow
edges carry *fractional* coverage. For a hard binary veto mask, pass `ss:false` explicitly.
(HANDOFF §8.6 and the README disagreed on this; the corrected README now states both.)

### 2.5a Cloud data is precached but NOT decoded — one export must be added

**MEASURED.** `sw.js` precaches all 96 cloud WebPs (12 months x 8 local-solar-time slices,
~3.3 MB) — but as **DATA, never CORE**, deliberately, so a failed cloud fetch cannot fail the
install. On disk, offline-safe, no download needed.

**Cached on disk is not loaded in memory.** `_slices` starts empty every session.
`_loadSlice()` (line 186) decodes a WebP through a canvas into a `Uint8Array`, and only two
things call it:

- `_render()` (lines 489–490) — the bulk load, 16 slices (8 per month x 2 bracketing months).
  Runs **only when the cloud overlay is switched on**.
- `ensureAt()` (line 620) — 4 slices, for **one point**. Built for the details panel.

`Cloud.sampleAt()` returns `null` if neither has run. The desirability layer needs the bulk set
with the cloud overlay **off**, and `window.Cloud` (line 733) exports only
`toggle, sampleAt, ensureAt, enable, disable, stops, isOn`.

**The change: add one export to `cloud-average.js`.** No network, no new data — ~16 cache reads
and decodes, once, when desirability is first switched on.

```js
/* Bulk-load the slices for the selected eclipse without turning the overlay on.
   sampleAt() returns null until these are decoded; _render() is what normally
   does it, and desirability needs them with the cloud layer off. */
function ensureSlices() {
  var rec = selectedEntry;
  if (!rec) return Promise.resolve(false);
  var mb = _monthBlend(rec.month, rec.day);
  var need = [];
  for (var s = 0; s < NSLICE; s++) { need.push(_loadSlice(mb.m0, s)); }
  for (s = 0; s < NSLICE; s++)     { need.push(_loadSlice(mb.m1, s)); }
  return Promise.all(need).then(function () { return true; })
                          .catch(function () { return false; });
}
```

Add `ensureSlices: ensureSlices` to the `window.Cloud` object and **bump `Cloud.version`**
(§10.7 — otherwise "am I running the file I just uploaded?" is unanswerable).

Additive, touches no existing path. But it IS a change to shipped code, and it was not in the
original plan — it belongs in the build order, not discovered on day one.

### 2.5b The score layer works on the globe. The terrain veto does not.

**MEASURED.** `cloud-average.js` contains **no projection flip**. Its `_bbox()` (line 286)
explicitly handles the globe: when `getBounds()` wraps or exceeds the world at low zoom it
falls back to the whole world, *"the honest answer and also the cheap one"*.

By contrast `shadow-ui.js` calls `setMapProjection('mercator')` on show (line 297) and
`setMapProjection('globe')` on hide (lines 276, 321).

**So the score layer inherits globe support for free**, and only the terrain veto forces
Mercator. This reinforces the tiering rather than complicating it: **score everywhere, on
either projection; terrain veto at high zoom, Mercator, online.**

### 2.5 Clipping the shadow mask to the corridor — MapLibre has no built-in

**MEASURED** against maplibre-gl-js v5.5.0 source: there is **no `clip` layer type**. Layer
types are background, circle, fill, fill-extrusion, heatmap, hillshade, line, raster, symbol,
custom. (Mapbox GL JS v3 has one; MapLibre does not.) Stencil clipping exists in `painter.ts`
but is internal, used for tile bounds and 3D overlap, and custom layers are explicitly told
not to rely on it. **There is no wheel to reuse — do not go looking for one.**

Options considered:

- **Inverse-polygon fill above the mask** — REJECTED by the user. It would cover the whole
  world outside the corridor, hiding the basemap.
- **`gl.scissor`** — rectangles only. A corridor is not a rectangle. Dead.
- **A mask texture in the shader** — the remaining option, and it is small.

**The shader change, if it is done.** `shadeFS` already has a precedent: the `u_elev` block
(~line 588) is an early-return branch keyed on a uniform, and the shader already ends in a
`discard`. The corridor test is:

```glsl
uniform sampler2D u_mask;
uniform float u_hasMask;
// at the top of main():
if (u_hasMask > 0.5 && texture2D(u_mask, v_uv).a < 0.5) discard;
```

plus binding the texture in `render()`. `v_uv` is the atlas rect in Mercator, which is exactly
what the score canvas already covers — so the score canvas **is** the mask, and the corridor
geometry is solved once, by the score layer, for both purposes.

**Why this is safe despite §8's "do not rebuild".** With `u_hasMask` at 0 the shader is
bit-identical to today. That makes the same **zero-pixel diff** proof available that §8.3 used
for the original extraction and that validated the supersampling work. Restore
`js/shadow-layer.ORIGINAL.js` (dot, not underscore) as the deeper floor — note it is the v64
extraction, so a diff against it will show the supersampling additions too; the zero-pixel
proof for this work is against the **current shipped engine with the mask off**.

**This is a change to the most carefully guarded file in the project. Get explicit sign-off,
and land it with the diff proof in the same commit.**

---

## 3. Architecture

Two new files, matching the existing naming convention
(`cloud-average.js`/`cloud-ui.js`, `shadow-layer.js`/`shadow-ui.js`):

- **`js/desirability.js`** — the score. Computes C and D, clips to the corridor, palette LUT,
  `sampleAt(lon,lat)`. Rendering cloned **structurally** from `cloud-average.js`.
- **`js/desirability-ui.js`** — the button, the Whole path / This view mode, the legend, and
  the borrowing of the shadow engine. Talks to `shadow-ui.js`, **not** into `shadow-layer.js`.

### Why the UI file owns the engine handover

`desirability.js` cannot get terrain data from `shadow-layer.js`, because **the engine is a
paintbrush, not a sensor** — it draws and discards, and exposes no query. So at high zoom
terrain is not an *input* to the score; it is a mask *above* it. Coordinating two renderers is
legitimately a UI job, and is exactly what `cloud-ui.js` already does across three cloud
modules without doing any meteorology itself.

**Borrowing the shadow engine — RESOLVED, and simpler than first thought.**

**Decision (user's): ONE overlay on at a time, always.** That removes the contention entirely.
There is no shared-ownership problem to design around — whichever mode is live owns the colour,
the time and the projection. What remains is ordinary sequencing at the handover.

**MEASURED** — `shadow-ui.js` is plain top-level script scope (no IIFE), so its functions are
callable globals. The relevant ones:

| function | line | what it does |
|---|---|---|
| `updateShadowVisibility()` | 289 | the single decider: armed + zoom ≥ 6 + online → show, else hide |
| `_showShadowNow()` | 296 | `setMapProjection('mercator')`, add layer, show scrubber, `setShadowTime` |
| `_hideShadowKeepArmed(mode)` | 319 | remove layer, `setMapProjection('globe')`, `_renderTimeline(mode)` |
| `computeShadowWindow(entry)` | 74 | returns the time window; **`maxms` is greatest-eclipse (GLOBAL)** |
| `SHADOW_MIN_ZOOM` | 28 | 6 |

Three things to get right, all of them sequencing:

1. **Do not call the underscore internals from `desirability-ui.js`.** Add one entry point to
   `shadow-ui.js` (e.g. `showShadowAsVeto(timeMs)` / `restoreShadowMode()`) and call that. Same
   reason the score layer talks to `shadow-ui.js` and not into `shadow-layer.js`.
2. **The time is NOT `computeShadowWindow().maxms`.** That is **greatest eclipse, global** — one
   instant for the whole planet. The veto needs the **local** maximum for what is on screen.
   `computeEclipse(rec, lat, lon, 0).tMax` at the viewport centre is the right source.
   **UNVERIFIED:** how much the local maximum varies across a zoom-6 viewport. Measure once; if
   it is a minute or two, viewport-centre is fine and the mask can be recomputed on `moveend`.
3. **The handover must land clean.** Desirability off → shadows on must restore the projection,
   the scrubber and the tint. Desirability on → shadows off must hide the scrubber and pin the
   time. The failure modes are the obvious ones: map stuck in Mercator, scrubber orphaned, or
   shadows vanishing with the wrong layer.

Also inherit `shadow-ui.js`'s existing gates rather than reinventing them: `isOffline()` hides
the layer (line 291), and below `SHADOW_MIN_ZOOM` it hides while staying armed. The veto simply
does not exist offline or at low zoom — which is exactly the tiering in §2.5b.

### What to clone from `cloud-average.js` — and what NOT to touch

Reuse the structure wholesale; every trap in it was paid for once already:

- **Two canvases** (world base + sharp viewport detail), exactly one visible at a time.
  §10.3 — do not "simplify" by deleting the base layer; three previous attempts at the
  same symptom were chasing an unwinnable race.
- **`_safeSize()`** — drops one pixel off the height. This is the power-of-two trap: a
  1024×1024 `CanvasSource` texture samples as black and reads as a grey veil over the whole
  map. It looks exactly like tidy-up bait. **Keep it.**
- **Canvas sized to the DATA, not the screen** (`OVER` px per source cell, clamped
  `MIN_PX`/`MAX_PX`).
- **`_drawnKey`** — `_covered()` must compare the eclipse the canvas was drawn for, not just
  the box and zoom. §10.5 documents this shipping the wrong month's overlay twice.
- **`_againForce`** — a deferred render that was forced stays forced. Both ends, or the trap
  stays armed.
- **Layer placement**: top of the MapLibre stack. deck.gl draws above everything anyway, so
  the track and umbra survive.
- **A `version` constant, bumped on every change** (§10.7) — otherwise "am I running the file
  I just uploaded?" is unanswerable.

`Cloud.sampleAt(lon, lat)` (line 594) is the model for the readout, including its
**returns null until the layer has rendered once** behaviour and the `ensureAt` variant.

### Palette — needs a decision

Green→red for the ramp, matching the reference site and distinct from cloud's blue→red
(Anderson's scale, which *means* cloud). The **veto colour must sit off the ramp** — the ramp
already ends in red-orange. Deep crimson, or a hatch, or full opacity where the ramp is 0.7.
§11.5's visual language is test-enforced; get a look before committing.

### The zoom handover must be visible

Below the shadow layer's zoom gate the terrain term is absent; above it, the veto mask
appears. The score under the cursor will change. Not a bug, but it needs saying — a legend
line naming which visibility source is live, the way the cloud mode strip names its source.

---

## 4. Build order

0. **`cloud-average.js`: add `ensureSlices()` and bump `Cloud.version`** (§2.5a). One export,
   additive. Nothing else works without it — `sampleAt()` returns null.
1. **`desirability.js`** — C × D × A, cells selected by per-cell membership (§2.3, **no
   polygon**), palette, `sampleAt`. Ships alone, works
   offline, works on the globe, useful immediately.
2. **`desirability-ui.js`** — button, Whole path / This view, legend, readout in Details.
3. **Borrow the shadow engine** at high zoom via a new `shadow-ui.js` entry point: veto red,
   `ss:false`, time pinned to the **local** maximum. No changes to `shadow-layer.js`.
4. **The mask uniform** (§2.5), with the zero-pixel diff proof in the same commit.
   **SIGNED OFF** — the user has taken his own `PRE-MASK` copy.
5. **Deferred, a separate project: the precomputed horizon field.** See below.

### Estimate

**Two to four working days for steps 0–3.** Steps 1 and 2 are a structural clone of work already
debugged; step 3 is settings on an existing engine; step 0 is one export.

The estimate came down because the corridor polygon — which was the entire source of variance,
and which §2.3 shows is a documented multi-attempt tar pit — turned out to be unnecessary. Every
remaining unknown has been measured: duration cost, the shader API, the cloud-slice gap, globe
support, and the `alt` argument. That is the difference between this estimate and the Cesium one.

### Tests

`tools/checks/` gets `test_desirability.js`. Assert:

- the score is 0 outside the corridor — `computeEclipse` at a point known to be partial
  (40.4, -3.7 for 2026-08-12 returns `type:'partial'`) yields no score;
- **the polar case works**: 2026-08-12 sampled across the Arctic leg returns `total` cells with
  no gap and no wrap. This is the regression guard against anyone reintroducing a polygon;
- one-limit grazers produce no cells;
- `computeEclipse` is always called with an explicit `alt` (§2.2);
- `_drawnKey` rejects a canvas drawn for another eclipse (§10.5).

Expect `test_tshirt`'s 3 failing assertions as the unchanged baseline.

---

## 5. Deferred: the precomputed horizon field

Terrain visibility at **path scale** cannot be computed live, and the reason is not cost —
it is that at zoom 3 one pixel is ~100 km while a 3 km mountain at a 3° sun casts a shadow
~57 km long, i.e. less than one pixel. The DEM atlas degrades with it. The question has no
per-pixel answer at that scale.

The answerable question is *what fraction of this ~1 km cell has a clear view*, and it is
answered by a field with **no time in it**: for each cell, the terrain horizon altitude at
each of ~16 compass bearings. Ray-cast once, offline, from a real 30 m DEM. At runtime:

```
blocked = sun.alt < horizon(cell, sun.az)
```

`computeEclipse` already returns `sun.alt` and `sun.az`. The sun moves; the mountain does not.
This works at every zoom, works offline, and yields a **number**, so it feeds the score and
`sampleAt()` rather than only painting pixels.

**Why it is deferred:** size. Global, 16 bearings, one byte each, against a current total
payload of 3.3 MB of cloud slices. Ocean is zeros and flat land nearly so, so it compresses,
but the raw figure has **not been sized** and that sizing is the first task. Generate it for
one region first — wherever the next eclipse of interest lands — prove the score works with a
real visibility term, then decide about global.

Honest limits to carry forward: it is a **fixed-observer, ground-level** horizon (a 10 m tower
beats it), and at ~1 km a valley floor and the ridge above it share one answer. Storing the
**best** horizon per cell rather than the mean makes it read as "there is a good spot here",
which is the honest claim for a planning tool and matches what the reference site achieves by
only plotting real viewpoints.

---

## 6. Decision log — all closed

1. ~~The exponents~~ — **DECIDED: 0.60 / 0.40**, calibrated from the user's own forced-choice
   answers. See §1.
3. ~~The veto colour~~ — **DECIDED.** Same red family as the ramp's worst, but **darker and
   fully opaque** where the ramp's worst is lighter and slightly translucent. One extra LUT
   entry. No hatch, no new hue. Rationale: the terrain veto only exists at zoom ≥6 and online,
   so an identical red would silently change meaning on zoom; and the bottom of the ramp is
   already occupied by path-edge slivers where you'd catch a few seconds of totality, which is
   a poor spot rather than an impossible one.
4. ~~The end-cap wedges~~ — **MOOT.** They were an artefact of joining limb endpoints into a
   ring. Per-cell membership (§2.3) has no endpoints and no chord, so there is no wedge.
5. ~~Polar corridors in Mercator~~ — **MOOT for the score layer.** Per-cell membership is
   correct over the pole (verified by render). The map itself still stops at ~85°N, exactly as
   the basemap does — nothing to fix, and nothing to accept.
6. ~~Sun altitude as a fourth term~~ — **DECIDED: include, small weight.** Flat above ~20°,
   falling below ~10°. `computeEclipse` already returns `sun.alt`, so it is free.
7. ~~The `u_mask` shader change~~ — **SIGNED OFF.** The user has taken his own `PRE-MASK` copy
   into `shadow-layer-building-DO-NOT-DELETE/`. Still land it with the zero-pixel diff proof in
   the same commit.

**Nothing is left open. The next thread can start at build step 0.**

**One item is still UNVERIFIED** and should be measured early rather than assumed: how much the
**local** maximum varies across a zoom-6 viewport (§3). It affects only the terrain veto, and it
is a five-minute measurement in the browser rig.

The corridor risk that dominated earlier drafts is **gone**, not deferred — §2.3 removes the
polygon entirely rather than working around it.
