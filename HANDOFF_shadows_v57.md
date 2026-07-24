# ShadowChaser terrain shadows — HANDOFF (v57, 2026-07-24)

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
- **Caster-side detail** is coarse beyond ~0.5 km of ray: this is the whole
  remaining visual gap with shademap. Fully diagnosed and specced as the #1
  next task — see §5.
- Distant casters narrower than ~3% of their distance soften (LOD trade,
  shademap-equivalent).
- Desktop-first memory: v57 raised near-field accuracy (NEAR_MULT 1.2,
  NEAR_BUDGET 170, TILE_CACHE_MAX 380 — ~190 MB peak with OSM siblings). That
  is the whole shademap sharpness gap: same DEM lineage, they just spend more
  resolution near the viewer. A clearly marked comment at the constants tells
  Opus the exact previous values to revert to if phones struggle
  (1.6 / 90 / 300); nothing else depends on them.
- MapLibre world copies: our layer draws one world width; night band absent
  on wrapped copies at z<2.

## 5. NEXT TASK — #1 PRIORITY: fine casters (closes the shademap detail gap)

**Symptom.** Side-by-side with shademap at the same place/time (Contreras, ES,
2026-08-12 19:06 UTC; Ullapool 20:0x UTC), our shadows are correct in position,
length and physics but their *silhouettes* are rounded blobs where shademap
shows dendritic, ridge-shaped detail. This is NOT a data-source difference
(both ~30 m SRTM/NASADEM lineage) and NOT a physics difference (ours is
stricter — see §2.9).

**Diagnosis (settled, no further investigation needed).** Shadow shape is the
projected silhouette of terrain 1–20 km up-sun. In our march the NEAR atlas
(`u_dem0`, texel `u_t0`, currently texN 13–36 m) is consulted only while the
stride still equals one near texel:

    shade shader, ~line 491:
      float strN = max(u_t0, s*u_grow);
      if (qn && strN <= u_t0*1.001) { h = hN(q0,u_px); st = u_t0; }
      else { ...far/coarse branch... }

With `MARCH_GROW = 0.03`, that condition fails once `s > u_t0/0.03 ≈ 33·u_t0`
— i.e. after roughly 430 m of ray at texN 13 m. **Every caster beyond ~0.5 km
is therefore read from the FAR atlas at texF 54–163 m**, which smooths exactly
the ridge structure that shapes the shadow. Receiver-side detail (h0,
coastlines, AA) is already fine; only the caster side is coarse.

The near-only-at-unit-stride rule is itself correct and must be kept — a
stride larger than the texel skips casters (bilinear peaks have ~1-texel
support). The fix is not to relax it but to give the NEAR atlas the same
prune-then-resolve machinery the far atlas already has.

**Implementation plan (~30 lines, all mechanical; mirrors existing code).**

1. `resize()` (~line 610): allocate near max-mip targets alongside the far
   ones, e.g. `['nearC1','nearC2']` at `px/4` and `px/16`. Cost is trivial
   (2048²→1 MB + 64 KB per level).
2. `buildCoarse()` (~line 777) already chains 4× reductions over
   `this.atlas`. Generalise it to `buildMips(gl, srcTex, keys)` and call it
   twice: once for the far atlas (existing call sites ~878 and ~923) and once
   for the near atlas — the near call goes in the `readyN===listN.length`
   rebuild branch (~line 928), right after `copyInto(gl,this.near,...)`.
   When `goodN` is null (self-test path) the near mips must not be sampled;
   the existing `nearTex = this.goodN ? this.near.tex : this.atlas.tex`
   fallback at ~line 940 shows the pattern — pass a `u_hasNearMip` float or
   simply bind the far mips as the near ones in that case.
3. Shader: add `uniform sampler2D u_n1, u_n2;` (texture units 5 and 6 —
   units 0–4 are taken: near, far, c1, c2, c3), plus the matching
   `U('u_n1')/U('u_n2')` locations (~line 570) and binds (~line 954).
4. Rewrite the branch at ~line 491 so that **membership in the near rect, not
   stride, selects the atlas**:

       if (qn) {
         // near branch — same three-way rule as the far branch
         float rayH = s*tanA + s*s*curv + h0;
         float str  = max(u_t0, s*u_grow);
         if (str <= u_t0*1.001) { h = hN(q0,u_px); st = u_t0; }
         else {
           float C  = (str <= 4.0*u_t0) ? 4.0 : 16.0;
           float hm = (C == 4.0) ? decodeH(texture2D(u_n1,q0))
                                 : decodeH(texture2D(u_n2,q0));
           if (hm <= rayH) { h = -1e9; st = ddaExit(q0*u_px, C) * u_t0; }
           else            { h = hN(q0,u_px); st = u_t0; }   // resolve fine
         }
       } else { ...existing far branch, unchanged... }

   Note `ddaExit` takes far-texel units today (`q1*u_px`, scaled by `u_t1`);
   for the near branch pass `q0*u_px` and scale by `u_t0`. It is already
   generic — no change needed inside it.

**Invariants that MUST survive (each was a shipped bug — see §2.5–2.7).**
- Coarse/max levels PRUNE ONLY. Never take `h` from a max level; it may only
  prove `hm <= rayH` and skip.
- Max levels are POINT-sampled (`texture2D` + `decodeH`), never bilinear.
- A proven-clear skip advances only to the tested cell's DDA exit boundary,
  never a fixed width.
- The near→far handover stays continuous: when the ray leaves the near rect
  mid-flight, the far branch picks up at the same `s` (it already does; the
  `qn` test with 0.003 margins is the boundary).

**Verification before shipping.**
- Reuse the CPU traversal harness from the v55 session (5 random worlds ×
  3000 rays, two-resolution version this time): require 0 structural misses
  and 0 structural false positives vs an exact per-texel march, and report
  max step count — budget is `MARCH_STEPS = 300`; expect ≲200.
- `glslangValidator` both shade variants (fwidth + fallback) as in every
  session; the extraction one-liner is in the session log.
- Visual A/B at the two repro views above against the shademap screenshots.
  Success = dendritic ridge shadows, no new beading, no blink while scrubbing.

**Expected side benefit.** The residual sub-texel scalloping in §4 is
partly a far-atlas phase artefact on near casters; resolving those at 13 m
should reduce it. If it survives, apply §4 fix (a) — snap fine-branch samples
to texel centres along the ray — but only after this task, and measure first.

**If it goes wrong**, `shadows_v53.html` is the last pre-LOD-chain good build
and `shadows.html` (v57) is the current one; both are known-good starting
points. Do not re-introduce the pre-v50 rotate/scan pipeline (§1).

## 6. META-LESSONS (unchanged from the old handoff, repeatedly re-earned)
Build the instrument before the theory. Measure from the user's screenshots
(fjord fill heights and the water colour were both decoded from PNGs).
Simulate traversal changes on CPU before shipping (caught the fixed-width
skip bug pre-user). Classification is nonlinear: classify, then interpolate.
Conservative structures are only conservative if every property (point
sampling, cell-bounded skips) is preserved. When a symptom survives three
patches, the architecture is the bug (v50).
