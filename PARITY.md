# PARITY LEDGER — maplibre ⇄ cesium

Two branches, one app. Goal: **identically functional**, differing ONLY in renderer.
Every change below is either SHARED (must be mirrored) or RENDERER-ONLY (stays put).

## The rule
- Touching `eclipse.js`, `details.js`, `list.js`, `format.js`, `state.js`, `search*.js`,
  `url.js`, `local.js`, `tabs.js`, `init.js`, `data/**`, or the non-marker parts of
  `app.css` → **SHARED. Cherry-pick to the other branch.**
- Touching `js/map.js`, the loader block in `index.html`, or the marker block in
  `app.css` → **RENDERER-ONLY. Do not port; re-implement if needed.**

Cherry-pick a shared commit:  `git checkout <other-branch> && git cherry-pick <sha>`

---

## Files that DIVERGE by design (never straight-copy between branches)
| File | maplibre branch | cesium branch |
|---|---|---|
| `js/map.js` | MapLibre + deck.gl renderer (~1050 lines) | Cesium renderer (1479 lines) |
| `index.html` | maplibre-gl-csp + worker + deck.min.js | CESIUM_BASE_URL + Cesium.js |
| `css/app.css` | marker block only (`.observer-pin`, `.sun-arrow`, `.ge-diamond`) | same classes, Cesium-tuned |

Everything else in the repo should be **byte-identical across both branches.**

---

## Done on maplibre — NOT yet on cesium
_(nothing to port back yet: all of these restore parity WITH cesium)_

- [x] deck.gl loaded + `window.DeckGL = window.deck` alias (renderer-only)
- [x] MapLibre CSP worker URL wired before map construction (renderer-only)
- [x] Pin artwork ported from Cesium `pinImage()` (renderer-only, already matches)
- [x] Pin zoom-scaling ramp — mirrors Cesium `scaleByDistance(5.0e5→1.0, 2.0e7→0.45)`
      as MapLibre zoom 9→1.0, zoom 2→0.45 (renderer-only)
- [x] Arrow 300 km world cap + 0.55 min scale — mirrors Cesium `ARROW_MAX_M` (renderer-only)
- [x] GE marker orange diamond `#f08a1e` (renderer-only, already matches)

## Done on cesium — NOT yet on maplibre
- [ ] _(none yet)_

## KNOWN BEHAVIOURAL DIFFERENCES (structural, not bugs)
- **Antimeridian / poles**: cesium is a true sphere → no seam. maplibre is a Mercator
  plane → needs seam machinery (path splitting at ±180°, synthetic pole vertices at
  ±89.99°, containment checks that unwrap correctly). Test any path fix on BOTH.
  Historically buggy cases to re-check on maplibre: polar-transit paths, antimeridian
  crossings, `umbra_n None` containment false-negatives.
- **Weight**: cesium is much heavier to load than maplibre. Preference is maplibre
  unless cesium earns its place.
- **Terrain shadows**: cesium has real 3D terrain (native shadow map works close-in,
  top-down, fails at low sun). maplibre relies on the shademap library or a custom
  raymarch over DEM tiles. Shadow feature is **acceptable as online-only.**

## SPIKES (preserved, not in the app)
`spikes/` — shadow_spike, horizon3, horizon_grid, sunmap (CPU sunlit map, phone-verified),
probe/probe2 (diagnostics), DESIGN_SPEC_cesium_map.md (pin/arrow/palette values).

---

## Checklist before declaring branches "at parity"
- [ ] Same eclipse loads with same paths on both
- [ ] Pin tip lands on the exact coordinate at all zooms
- [ ] Sun arrow same length/direction at matched zoom
- [ ] GE diamond present and same colour
- [ ] Tabs, About text, search, share URLs behave identically
- [ ] Offline/SW behaviour equivalent
- [ ] Spot-check one antimeridian-crossing and one polar eclipse on maplibre
