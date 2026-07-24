# ShadowChaser terrain shadows — HANDOFF (v56, 2026-07-24)

Single-file app: `shadows.html` (MapLibre + raw WebGL custom layer).
`shadows_v53.html` is a known-good rollback from before the LOD-chain work.

## 1. ARCHITECTURE (v50 rewrite — the shademap-class design)

The v34–v49 rotate/scan/shade pipeline is GONE. Do not resurrect it; its single
coarse atlas re-gridded twice was the root of every artefact era (staircase
coasts, streak combs, mask wisps, breathing shadows).

Current pipeline:

- PASS 1: DEM tiles → **NEAR atlas** (viewport × NEAR_MULT at the finest
  affordable z) + **FAR atlas** (viewport + 2×reach at whatever z fits
  TILE_BUDGET). Both 2048², built by the same `copyInto()`.
- PASS 2: far atlas → max height (8× reduction chain) → `terrainMax`, damped
  one 250 m step per rebuild (kills the hmax→reach→z→tiles→hmax oscillation).
- `buildCoarse()`: far atlas → 4×/16×/64× **block-max mip levels** (one 4×
  reduction shader, chained).
- PASS 3: **per-pixel ray march** in the shade shader, at screen resolution.

### The march (shade shader), per screen pixel
- h0 from the near atlas (fall back far outside it).
- TRUE spherical solar altitude from the subsolar point uniforms
  (`sunSub()` in JS; cross-checked vs `sunAltAz` to 6e-15 deg), plus
  Sæmundsson refraction in-shader. Valid at every zoom (the earlier linear
  model drew a straight terminator at world zoom).
- Lighting = `fLit` (fraction of the 0.266° solar disc above the local
  horizon) × (1 − terrain blockage). Night is fLit→0: a persistent veil, the
  terminator sweeps organically at its real ~60 km penumbral width. No time
  cutoff exists; night pixels early-out in a few steps.
- Blocked test: `h(s) − s·tanA − s²/(2R) > h0`, tanA at the receiver.
  The s²/2R term is the exact separable curved-earth correction (derivation in
  the v43 header comment; verified numerically, 0 disagreements to 0.05°/270 km).
- **Hierarchical traversal** (the part that took three tries to get right):
  - stride proposal `str = max(texF, 0.03·s)` picks a level: far(bilinear) /
    C1(4×) / C2(16×) / C3(64×).
  - Coarse block-max levels may only PROVE CLEARANCE (hm ≤ rayH ⇒ skip to the
    tested cell's DDA exit boundary, `ddaExit()`); if they can't prove it,
    probe C1, else resolve exactly with a far bilinear sample at stride texF.
    Coarse levels NEVER occlude, and are point-sampled only.
  - Near atlas serves only at unit stride (bigger strides skip fine casters).
  - CPU simulation (5 worlds × 3000 rays vs exact per-texel march):
    0 structural misses, 0 structural false positives, ≤114 steps to full
    reach; residual ~0.1% are sub-texel sampling-phase cases (see §4).
- Edge AA: `fwidth`-normalised (~1.5 px), width floored at 0.6 m against
  dither; WebGL2 exposes derivatives as core (getExtension returns null —
  that cost us a blurry release once). Link status of the fwidth build is
  VERIFIED, with an automatic narrow-smoothstep fallback. Acne bias capped
  (`min(texN,150)`), or world-zoom texels produce km-scale biases.

### Water (data hygiene only — there is NO display mask anymore)
Shadows cross water; that is correct and the user wants it. The only water
logic lives in the copy pass:
- Terrarium fills sea lochs with phantom LAND up to ~190 m (measured from the
  elevation instrument, 2026-07-24) and holds ~3 km spikes in open ocean
  (the "hmax 3750" phantom, which also cast the fake Ullapool tongue).
- Rule: an OSM-basemap pixel is "watery" if it is the water fill #aad3df OR
  bluish (b>r+0.02 ∧ b≥g ∧ b>0.3 — catches sea labels/ferry dashes; verified
  against the palette). If the 5×5 watery fraction >0.5, the surface is flat
  at its 5×5 minimum height; below SEA_MAX_M=200 it is sea → height forced 0.
  Thin rivers fail the fraction gate. This kills the fill and the spikes.
- OSM tiles ride along with each DEM tile (same URLs as the basemap → browser
  cache; failure degrades to the raw<0.5 m DEM test).

### GL hygiene (the corrupted/doubled-canvas class)
- All our draws use our own VAO (else we rewrite MapLibre's attribute
  pointers). Async tile uploads save/restore TEXTURE_BINDING_2D and reset
  UNPACK state. `render()` is wrapped: an exception logs once instead of
  aborting MapLibre's frame housekeeping.

## 2. DEAD THEORIES — measured, do not re-chase
1. Natural Earth / project geojson water masks: 1–4 km quantised, useless for
   fjords (measured twice).
2. Height-threshold sea detection: lochs are POSITIVE in Terrarium.
3. Bilinear-then-classify water flags: one steep coastal tap drags the mix;
   classify per tap, interpolate the indicator.
4. Display-masking water at all: product decision reversed — shadows cross
   water; masking caused wisps/minecraft coasts and misclassification wars.
5. Coarse block-max AS OCCLUDER (v54): 10 km silhouettes shadowed the whole
   sea, blinking with reach. Prune-only (v55).
6. Fixed-width proven-clear skips: cross into untested cells → misses.
   DDA exit boundaries only.
7. Bilinear sampling of max levels: undershoots between block centres →
   phase beads. Point-sample max levels.
8. Global fade / altitude cutoff at sunset: replaced by per-pixel disc
   fraction; nothing to re-add.
9. shademap parity on shadow length near the horizon: they use the GEOMETRIC
   sun (their UI read 0.2° when apparent was ~0.7°); we use the refracted
   apparent sun. Deliberate divergence; a toggle would be one uniform.

## 3. INSTRUMENTS
- **Self-test** checkbox: analytic cylinder stadiums vs live pipeline
  (magenta = mismatch). Run at MID-DAY altitudes; growing strides erode
  distant tips at grazing sun (documented in-shader). Q=0 in synth.
- **Show elevation**: terrain exactly as the march reads it (near atlas),
  20 m contours, steel-blue = flattened sea, RED = h>2500 m (phantom-data
  tripwire).
- **Probe** (click / probe-centre button): Terrarium PNG vs atlas readback in
  metres, with DELTA. First diagnostic for any height question.
- Status line: apparent+geometric alt, az, zN/zF, tile counts, texN/texF,
  hmax, reach. Tap it to open the log; `✗` lines name failures (shader link,
  render exceptions, no-matrix).

## 4. KNOWN RESIDUALS (accepted for now)
- **Faint scalloping** on long shadow edges. The structural causes are fixed;
  the remainder matches the simulated ~0.1% sub-texel class: fine-resolution
  samples land at OFF-GRID s (stride accumulates through variable skips), and
  bilinear reads next to a 1-texel summit vary with phase. Two candidate
  fixes for a future session, in order: (a) snap fine-branch samples to far
  texel centres along the ray; (b) 2-tap max (±0.5 texel along-ray) in the
  fine branch. Expected cost: small; test against the bead screenshots at
  2026-08-12 ~20:00 UTC, Ullapool.
- Distant casters narrower than ~3% of their distance soften (LOD trade,
  shademap-equivalent).
- Desktop-first memory: tile cache 300 (~150 MB with OSM siblings). Mobile
  budget untouned.
- MapLibre world copies: our layer draws one world width; night band absent
  on wrapped copies at z<2.

## 5. META-LESSONS (unchanged from the old handoff, repeatedly re-earned)
Build the instrument before the theory. Measure from the user's screenshots
(fjord fill heights and the water colour were both decoded from PNGs).
Simulate traversal changes on CPU before shipping (caught the fixed-width
skip bug pre-user). Classification is nonlinear: classify, then interpolate.
Conservative structures are only conservative if every property (point
sampling, cell-bounded skips) is preserved. When a symptom survives three
patches, the architecture is the bug (v50).
