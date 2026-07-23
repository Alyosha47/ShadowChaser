# HANDOFF — ShadowChaser terrain shadows (2026-07-23)

Standalone. Everything needed to pick this up cold. Supersedes the shadow section of the
2026-07-18 handoff. The user should not have to explain any of this.

**Current build:** `spikes/shadows.html` (v34). 33 KB, self-contained, no dependency beyond
MapLibre. Previous working build `spikes/raymarch.html` (v9) is preserved and also runs.

**Goal:** shademap.app-quality terrain shadows, free, offline-capable, no API key.
**The user's directive: do not abandon this.** It is demonstrably achievable — shademap does
it on the same devices. We are close, with specific bugs listed in §5.

---

## 1. WHY THIS EXISTS

ShadowChaser shows eclipse paths. At totality the sun is often low, and terrain shadow
determines whether an observer actually sees the event. shademap.app does this well but costs
$25/month with no free tier for custom domains, and ShadowChaser is given away free. So we
build our own.

Elevation source: **Terrarium** tiles,
`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` — free, CORS-OK,
`crossOrigin='anonymous'`. Encoding: `metres = r*256 + g + b/256 − 32768`, negative over ocean.

---

## 2. THE METHOD (v34) — read this before touching the code

Every ray in the scene shares one sun vector. Write `g = h − s·tan(alt)`, where `s` is
distance along the sun direction. Pixel *i* is shadowed iff some *j* upstream satisfies
`h_j > h_i + (s_j − s_i)·tan(alt)`, which rearranges to simply **`g_j > g_i`**.

So the whole problem is *"is there a larger g ahead of me along this line?"* — a **running
maximum**. A running maximum over a texture is a **doubling scan**: shift by 1 texel and take
the max, then 2, then 4 … `log2(N)` passes cover the width. The shadow test is then ONE
lookup: no loop, no step size, no sampling artefacts at any sun angle, and **cost independent
of sun altitude**. That last property is why this was chosen over marching (see §7).

Shifts must be a **whole number of texels**, or each pixel snaps its own way and the maximum
propagates along differing staircases (visible as blocks). So the field is built **rotated**,
with the sun along +x, and every shift is exactly `(2^k, 0)`.

Five passes:

| pass | what |
|---|---|
| 1 | DEM tiles → atlas (bilinear on **decoded metres**) |
| 2 | atlas → max height (8×8 reduction to 1 texel, read back; sizes the next frame) |
| 3 | atlas → `g`, resampled into sun-aligned axes |
| 4 | doubling scan along +x, ping-pong |
| 5 | shade: rotate the pixel, one lookup |

---

## 3. VERIFIED FACTS — measured, not inferred. Do not re-derive these.

- **Terrarium's ocean IS negative bathymetry.** Probes returned −81.41, −3.89, −17.92,
  −271.5, −357.43, −369.54, −2060.39 m. Our clamp stores exactly `rgb(128,0,0)` = **0.000 m**.
  The sea is perfectly flat in our height field and cannot cast.
- **Our encode/decode round-trip is exact.** Tested across every encodable value: worst error
  **0.0000 m**. `g` packing round-trips to 1.3e-7 of full range (sub-metre at every sun angle).
- **Terrarium z11/z12 tiles are 256 px and genuinely detailed** — 49/49 distinct values in a
  7×7 block spanning 280 m. They are NOT upsampled from coarser data.
- **Measured terrain max over the Highlands: 1250–1500 m.** Matches reality.
- **Solar position matches shademap to 0.1°.** At 57.91571, −5.21769 on 2026-08-12T19:29Z we
  compute alt 4.4° / az 291.1°; shademap displays 4.5° / 291.2°. *(Note: shademap displays
  local time. 08:29 PM shown = 19:29 UTC. An hour's confusion here wasted a comparison.)*
- **The scan agrees with closed-form geometry.** Single centred cylinder, full day, all
  azimuths: hairline disagreement only (one texel, unavoidable — sampled field vs exact formula).
- **The scan agrees with an independent per-pixel march over the same atlas** on real terrain:
  hairline magenta at shadow edges only, no regions. Two independent implementations.
- **Doubling-scan coverage is complete**: seed{1} plus `log2(PX)` levels covers offsets
  1…PX with **zero gaps** (verified for 1024 and 2048).
- **The rotation round-trips to 6.8e-13 texels**, and **zero** atlas pixels fall outside the
  rotated texture (3000 random azimuths × 15 points). `k = |ux|+|uy|` is the exact
  normalisation that makes this true.
- **Mercator must be clamped to ±85.05112878.** `getBounds()` reports ±90 when zoomed out;
  unclamped the span evaluates to **Infinity** → NaN → nothing discards → the whole world
  renders as shadow. Clamped, the max span is exactly 1.0 (one world).

---

## 4. DEAD THEORIES — each was investigated and disproved. DO NOT RE-CHASE.

1. **"Terrarium's ocean is raised / bumpy water casts false shadows."** FALSE. The sea clamps
   to exactly 0.000. Four versions were built on this. All wasted.
2. **"Colour-space conversion on texture upload corrupts the red channel (256 m error)."**
   FALSE as diagnosed. The `pixelStorei(UNPACK_COLORSPACE_CONVERSION_WEBGL, NONE)` calls are
   in the code and are correct practice for data textures — keep them — but they fixed
   nothing observed. **The 256 m discrepancy was colour management in the debug probe**, which
   read tiles through a 2D canvas (`getImageData` colour-manages). Reading the same tile via
   `createImageBitmap(blob,{colorSpaceConversion:'none'})` made source and atlas agree
   (9.40 m vs 11.09 m). The renderer was correct throughout.
3. **"The DEM is upsampled from 90 m SRTM, so plateaus cause the blockiness."** FALSE — 49/49
   distinct values in a 7×7 block.
4. **"The Isle Martin shadow blob is a DEM spike."** FALSE. It appears **identically in v9
   (marching) and v34 (scan)** — two implementations sharing no shadow code. Leading
   explanation, unconfirmed: it is a **real detached shadow**. A ray grazing a peak descends
   as it travels; the hillside below the peak is higher than the ray so stays lit; the sea
   surface further on is below the ray so is shadowed. Lit slope, gap, shadow patch on water.
   Ben Mòr Coigach (~743 m) is WNW and at 4.4° reaches ~10 km, which lands there.
5. **"Rasterise Natural Earth coastline as a water mask."** TRIED, MADE IT WORSE. NE is
   ~1 km scale; Ullapool's fjords are finer. It swallowed real islands (erasing true shadows)
   and missed sea lochs (leaving false ones). Reverted.

**Meta-lesson, stated plainly because it cost two days:** every one of the above was a
confident diagnosis offered *before* measurement, and every one was killed by the first
measurement taken. The only findings that survived are the ones in §3, all of which came
from an instrument rather than from reasoning. **Build the instrument first.**

---

## 5. OPEN BUGS — precise symptoms, leading hypotheses, and the test for each

### BUG A — self-test cylinders invisible (BLOCKER; fix this first)
**Symptom:** with `self-test` ticked, *parts of two cylinders' shadows* render but **no
cylinders**. Zooming out to find them makes the shadows vanish too.

**Why it blocks everything:** the self-test is the only thing that can verify the engine.
While it is broken, no other fix is falsifiable. Three attempts (v32, v33, v34) failed.

**Where to look.** The same `TEST_OFF` values feed two shaders:
- source (`pTest`): `vec2 p = gl_FragCoord.xy − u_px*0.5;` then `length(p − u_o*u_px) < u_R`
- analytic (`pShade`): `vec2 d = v_uv*u_px − u_px*0.5;` then `length(d − u_s*u_px) < u_R`

These are asserted to be the same space but that has **never been verified**.
`gl_FragCoord.y` is bottom-up in the framebuffer; `v_uv` comes from the vertex shader mapping
`a_pos` across the atlas rect. Trace whether `gl_FragCoord.y = 0` really corresponds to
`v_uv.y = 0`. **A y-flip between them would produce exactly this symptom**: cylinders drawn
at the mirrored position, so the analytic disc test fires where nothing was drawn and the
scan finds shadow from cylinders elsewhere.

**Test:** temporarily make the source shader write a value that depends only on
`gl_FragCoord.y` (e.g. `h = 500·step(u_px.y*0.5, gl_FragCoord.y)`), then have the shade pass
colour by `v_uv.y`. If the height step and the colour split disagree about which half is
which, the flip is confirmed.

### BUG B — axis-aligned (H/V) zigzag hugging coastlines, at ALL sun altitudes including noon
**Symptom:** staircase artefacts along coastlines. Present in **both v9 and v34**.
Axis-aligned, therefore **grid-related, not sun-related** (the scan is sun-aligned and would
produce diagonal artefacts).

**Shared code between the two builds:** the tile→atlas copy pass, the Terrarium decode, and
the atlas grid itself. That is where it must be.

**Leading hypothesis (untested):** it may be **geometrically correct one-texel shadow,
aliased**. At noon with `texelM ≈ 30 m`, `T = texelM·tan(45°) ≈ 30 m` of ray rise per texel.
A 50 m coastal cliff one texel from a sea pixel satisfies `50 > 0 + 30`, so the sea texel
*is* shadowed — correctly. A genuine 1–2 texel dark fringe follows every coast, and because
it is one texel wide it renders as an H/V staircase. Shademap shows this less because its
effective texel is screen resolution (~9 m), so the same fringe is sub-pixel.

**Second hypothesis:** the copy pass bilinear reads `CLAMP_TO_EDGE` at tile borders instead
of the neighbouring tile's data, producing a half-texel seam at every tile boundary. Tile
boundaries are axis-aligned; coastlines have the largest height gradient so show it first.

**Test that separates them:** render the atlas height field directly (the removed "show
elevation" mode) and look at a coastline. Staircase visible in the *heights* → hypothesis 2
(copy-pass seam). Heights smooth but shadows staircased → hypothesis 1 (correct-but-aliased),
and the fix is resolution, not correctness.

### BUG C — shadows switch off at ~1.5–1.9° sun altitude
**Working as designed, but the design costs the last ~20 minutes before sunset**, which is
eclipse-relevant. It is the single-sun-vector validity gate (§6). `SUN_LEN_TOL = 0.25` caps
shadow-length error at 25%; at 1.8° that allows only 0.45° of sun-altitude variation across
the view. **This threshold is a product decision, not a technical one** — the user should
set it. Raising it trades honesty for coverage; the alternative is per-pixel sun vectors,
which is the correct fix and is not hard (compute lat/lon per pixel in the shade pass).

---

## 6. CONSTRAINTS AND TRADE-OFFS, with numbers

### Reach vs resolution — the central tension
The computed area must contain every blocker that can reach the view, so it is sized by
`terrainMax / tan(alt)`, **not by zoom**. Sizing it to the viewport (as builds before v26 did)
silently truncated every shadow longer than the screen — which at low sun is all of them.

With `terrainMax` measured at 1250 m (vs assuming 9000 m), at latitude 58, 2048² atlas:

| sun alt | longest shadow | computed area | texel | (texel if assuming 9000 m) |
|---|---|---|---|---|
| 45° | 1.3 km | 53 km | 26 m | 28 m |
| 12° | 5.9 km | 62 km | 30 m | 61 m |
| 3.6° | 20 km | 90 km | 44 m | 159 m |
| 1.8° | 40 km | 130 km | 63 m | 299 m |
| 0.5° | 143 km | 336 km | 164 m | 1027 m |

Measuring the real max is a **4–6× resolution gain at low sun**. It is done on the GPU
(8×8 reduction chain, single-pixel readback). An earlier main-thread version using
`getImageData` caused visible judder — **do not do it that way**.

### Memory
Three full-size buffers (atlas + ping + pong). 2048² ≈ 50 MB; 4096² ≈ 200 MB, not viable on
iOS. `ATLAS_MAX` is 2048 on desktop, 1024 on mobile (`min-width: 900px`).
**Marching needs only one buffer**, so it could run a larger atlas at the same memory —
that is the scan's one real cost, and it is why our texel is ~2–3× shademap's.

### Below ~2° sun, no flat-plane model is correct — including shademap's
Shadows run 30–100 km, the Earth curves measurably over that distance, and the sun's altitude
genuinely differs between caster and receiver. Getting this right needs a spherical model.
Out of scope; record it as a known limit.

---

## 7. WHY THE SCAN RATHER THAN MARCHING

`spikes/raymarch.html` (v9) marches per pixel and works. It is preserved.

- **Marching cost rises as the sun drops** (longer shadows, more steps) — exactly the eclipse
  case. Its failure mode is scalloped, disc-chained shadow edges at low sun, which the user
  confirmed is severe.
- **Scan cost is constant** and it has no step size to alias against, so those artefacts
  cannot occur. Verified twice (§3).
- Trade: three buffers instead of one, hence a coarser texel.

The user re-tested v9 on 2026-07-23 and confirmed **severe scalloping** and that the Isle
Martin blob **appears there too**. That settled the choice in favour of the scan.

---

## 8. THE INSTRUMENTS — rebuild these, do not work without them

v34 ships only the self-test. The others were removed to get the file readable, but **each
one produced a finding in §3 or killed a theory in §4**. Rebuild any of them the moment a
question needs measuring, rather than reasoning about it:

- **`show elevation`** — draws the height field as greyscale. Settles "is this the data or
  the renderer?" in one screenshot. **Needed for BUG B.**
- **`compare scan vs march`** — runs a plain per-pixel march in the *same shader* over the
  *same atlas* and paints disagreement magenta. This is what proved the scan correct on real
  terrain. Slow (512 steps × 4 taps) but it is an instrument, not a mode.
- **click-to-probe** — reports the elevation at a point from our atlas (5×5 neighbourhood,
  `readPixels`) and from the source tile. **The source read MUST use
  `createImageBitmap(blob,{colorSpaceConversion:'none'})`, never a 2D canvas** — see §4.2.
  A marker showing where the click landed is essential; two probes were misread without it.
- **caster tracer** — walks upsun through the atlas and reports what blocked the ray
  (distance, height, lat/lon). Must sample **bilinearly**, matching the shader; a
  nearest-texel walk steps over narrow ridges and produces false "LIT" answers.

**On-page tracing is mandatory** — the user tests on a phone and slow connections where the
console is unavailable. Keep the A→E log lines. In v34 the log is hidden but auto-opens on
any `✗`, and tapping the status line toggles it.

---

## 9. RECOMMENDED ORDER OF WORK

1. **Fix BUG A.** Nothing else is verifiable until the self-test works. Start with the y-flip
   test in §5A.
2. **Confirm the engine** with the working self-test: four off-centre cylinders, shadows
   attached to their own bases, all parallel, hairline magenta only.
3. **Diagnose BUG B** with the elevation view. This is the visible-quality blocker and the
   test in §5B separates the two hypotheses in one screenshot.
4. **Decide BUG C** with the user — threshold, or per-pixel sun vectors.
5. **iOS.** Never yet tested on the current build. Three things: memory at 1024² atlas;
   frame rate; and **backgrounding** — iOS can drop the WebGL context, and nothing currently
   rebuilds the textures. The user's handoff notes backgrounding has bitten this app before.
6. **Integrate** into `js/map.js` as a real layer with a UI toggle, fed the **selected
   eclipse's max instant** (the app already computes it) rather than a slider. Keep the
   self-test in the spike, not the app.
7. **Optional:** the two-grid design — a fine atlas near the viewer plus a coarse one for
   distant casters, taking whichever answers first. This removes the reach/resolution trade
   rather than tuning it. Bounded work, roughly a day.

---

## 10. FILE MAP

- `spikes/shadows.html` — **v34, current.** Five passes, self-test, 33 KB.
- `spikes/raymarch.html` — v9, marching, working, preserved. 18 KB.
- `spikes/dem_spike.html` — stage-1 proof: DEM → GPU texture, decoded in-shader.
- `spikes/sunmap.html`, `spikes/horizon3.html` — CPU per-point horizon calculation. **Exact
  at any sun altitude, no atlas, works offline.** This is the right basis for a "is *this
  spot* sunlit?" readout, and is complementary to the shadow map rather than a replacement.

### Gotchas baked into the current build — do not re-break
- **NEAREST filtering everywhere.** Every texture holds *encoded numbers*; linear filtering
  blends the encoding, not the value. Interpolation is done in-shader on decoded metres.
- **`pixelStorei` colour conversion OFF** before every DEM upload. Correct practice even
  though it fixed nothing observed.
- **MapLibre v5 custom-layer signature**: options object; matrix at
  `args.defaultProjectionData.mainMatrix`, not a bare array.
- **Mercator y grows southward** → sun direction is `(sin az, −cos az)`.
- **Metres per mercator unit at latitude φ**: `40075016.686 · cos(φ)`.
- **Atlas rect padded to square** and origin snapped to a whole texel — the scan walks a
  straight line, so anisotropic texels would bend it, and snapping means panning *translates*
  the grid instead of rebuilding it.
- **Off-atlas reads in the scan return the range minimum**, not `CLAMP_TO_EDGE`, which would
  smear the border value inward and streak shadows from the edge.
- **The scan seed takes only the shifted sample**, so a pixel never shadows itself.
- **Rebuild the atlas only when every tile is in hand**; hold the last complete one meanwhile.
  A half-filled atlas makes shadows blink and shift while zooming.
- **A failed tile counts as resolved**, or one dead tile freezes the atlas forever.
- **`terrainMax` is quantised to 250 m steps**, or the atlas size chases its own contents
  frame to frame.
- Terrarium tiles are cross-origin and pass straight through the service worker.
