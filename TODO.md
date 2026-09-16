# ShadowChaser — TODO (the single task list)

## What this file is — and how it relates to the handoff
**Two documents, one job each. They must not duplicate.**
- **`HANDOFF.md`** owns *knowledge & current status*: what changed this session, what is
  deployed, how things work now, the hard-won derivations and lessons, what's closed. It is
  the source of truth for whether something is done and for HOW things work.
- **`TODO.md`** (this file) owns *everything still to do*, with its detail inline: open bugs
  and their candidate fixes, UX questions and deliberations, the feature pool, perf/data
  notes, the refactor ledger — ordered by priority. It accretes and is pruned, not rewritten.

**Rules to keep them from drifting:**
0. **There is no third document.** One was tried and lasted a day (see below). If HANDOFF is hard to
   navigate, fix its §0 index; if this file is, prune it. Do not start another.
1. When an item here is done, **delete it** — HANDOFF records the closure. No "DONE" tombstones.
2. Don't restate narrative status here; keep the task + its detail. HANDOFF holds the story.
3. One coherent change at a time; bump BUILD on every deploy AND every path rebuild.

Last touched: 2026-08-24 — Photo's repeating tiles deleted from the priority list (closed 2026-08-22c, HANDOFF §10A.8d); this list had said OPEN for two days. Previously: 2026-08-20 — **`Photo` rebuilt on MapLibre raster tiles and all three cloud modes
working** (HANDOFF §10A.8c). Also this session: `START-HERE.md` was folded into HANDOFF and deleted —
it had become a third home for facts that already had two, and within a day it and HANDOFF §6
disagreed about which branch was live. **There are two documents: `HANDOFF.md` and this one.**
HANDOFF §3 no longer carries a task list; everything open is here.

## PRIORITY ORDER (suggested re-entry)

*(Priorities are the USER's to set — this is a suggestion. The map is stable and cosmetically
finished; offline works; terrain shadows are done and wired in.)*

1. **#F6 favorability overlay — COMPLETE, nothing outstanding blocks anything.** Listed first only
   so the deliberate leftovers below are seen before anyone reopens it. All four steps shipped, renamed
   from "desirability" 2026-09-11a. Left deliberately, none of it blocking:
   - **A tidy pass, offered and not yet taken.** Two named smells: `_lastD` is a SIDE CHANNEL —
     `_raw()` writes it as a side effect and `_draw()` reads it for the edge fade, which is
     invisible coupling that will break when someone reorders the calls; and there are nine tuning
     constants (`MARGIN`, `BUDGET`, `BUDGET_MOVE`, `MOVE_ZOOM_DRIFT`, `MAX_PX`, `MIN_PX`, `PX_DIV`,
     `EDGE_FADE`, `MASK_DEG`) each individually justified but collectively a control panel, with
     interactions nobody has written down. No behaviour change; the 122 assertions hold it still.
   - **THE WEIGHTS ARE CALIBRATED. LEAVE THEM ALONE.** Re-fitted 2026-09-13 against ELEVEN
     forced-choice pairs; the shipped values are the best available fit. The ceiling is **6 of 8** —
     no power law, and no convex "risk of missing it" variant tried, does better, because two pairs
     mutually dominate (one option better on BOTH axes yet the other chosen). Ratios achieving 6 of
     8 span **1.12 to 2.59**; we ship **1.50**. **Raising the cloud weight makes it WORSE** (0.70 ->
     5 of 8, 0.80 -> 4 of 8). That was proposed and withdrawn once already — do not re-propose it
     without re-running the fit. The two remaining mismatches are coin-toss pairs; more pairs fit
     noise.
     **The Greenland-vs-Spain complaint that drove this did not survive a blind test:** with the
     place names removed the user chose 136s at 45% cloud over 104s at 39% — Greenland over Burgos,
     the ranking being objected to. Anderson's text agrees, calling the icecap the best weather
     prospect on the northern half of the track.
   - **`P_A` (sun altitude, 0.35) is NOT calibrated.** The eight forced-choice pairs held sun height
     equal on purpose, so nothing in the fit constrains it. First knob to reach for if altitude ever
     feels wrong. `ALT_HI` went 18 -> 10 -> 7.5 by eye in one session.
   - **The two remaining forced-choice pairs.** #2 and #6 could not be reconciled with the other six
     (see the calibration note below); three more pairs would settle it.
   - **The veto is one instant for the whole viewport**, the local maximum at the centre, re-centred
     on every settle. Measured spread across a screen: 8 min at zoom 6, 2 at zoom 8, 30 s at zoom
     10. Fine as it stands; if it ever is not, the shadow engine paints per frame, so a wide view
     could be split into horizontal bands with their own times.
   - **`cloud-average.js` raw `rec.t0` vs `refT0(rec)` — FIXED 2026-09-13, item closed.** Flagged
     2026-09-10. It was real but mild: `_slotFor()` used the raw `t0`, so for the 221 catalogue
     records whose stored `t0` sits a day from `td_ge`, `u` landed 24 h from `utGE`, `TCLAMP`
     rejected it as suspected, and the slot fell back to GREATEST-ECLIPSE time instead of the local
     maximum — never a 24 h error, but the wrong time of day by up to `TCLAMP`. Tokyo on the
     2012-05-20 annular read the 09–12 slice for an eclipse at 07:00 local: 66% against 69%. Hong
     Kong 76% against 79%. Now calls `refT0` with the same `typeof` guard as line 245. Verified
     across 2001–2100 at Tokyo: exactly the 4 midnight-crossers in that century change slot, the
     other 220 are byte-identical. Suite unchanged.
2. **`Now` takes ~15 s on first load** — the only remaining defect a user in a field would notice.
   Measured, and the obvious fix has already been tried and reverted. Detail under **#F2c** below;
   read it before touching anything.
3. **Evaluate a non-GIBS imagery source** — the single change that improves every complaint at once:
   freshness, resolution and reliability. Detail under **#F2c**.
4. ~~**#F1b**~~ **FIXED 2026-09-16a — see HANDOFF §11.4.** The diagnosis below was built on the
  test's truncated 5-item output and is WRONG about the causes; kept only as history.
  #F1c (the last 46 broken bands) **also FIXED 2026-09-16b.** What remains is the generator itself:
  **§9.5 chords in the path data** — see #F1d.
  ~~DIAGNOSED 2026-09-13. IT IS TWO BUGS WITH OPPOSITE SIGNS.~~
  Measured by running `buildBands` over the 11 named failures and comparing the limb data, the drawn
  band and the drawn midline (all as max |latitude|):

  | eclipse | limbs | band | midline |
  |---|---|---|---|
  | 691-05-03 | 89.99 | 89.73 | 83.81 |
  | -1180-06-16 | 89.49 | **89.78** | 88.19 |
  | -1444-08-23 | 88.85 | **89.74** | 86.49 |
  | -1678-08-31 | 89.68 | **89.86** | 88.91 |
  | -1877-05-15 | 88.96 | **89.46** | 87.22 |
  | -1831-06-14 | 89.47 | **89.75** | 87.78 |
  | -1361-03-12 | 76.95 | 52.20 | **64.35** |
  | -1850-12-09 | 89.99 | 72.40 | **80.95** |
  | -1962-12-16 | 89.99 | 77.57 | **82.20** |
  | 1769-06-04 | 89.99 | 78.57 | **79.98** |
  | 1979-08-22 | 77.33 | 63.43 | **69.38** |

  **BUG 1 — the band OVERSHOOTS (5 records, the "extended past its limbs" failure).** The band runs
  up to 0.9 deg PAST the poleward limit of any measured limb. `repairDegenerate` rebuilds a
  cross-section as `centre +- lastW/2` square to the track; near the pole that places points beyond
  where any limb was measured, so the band invents corridor. Fix: clamp the rebuilt cross-section so
  it cannot exceed the measured limb extent.

  **BUG 2 — the band UNDERSHOOTS (5 records, the "centreline with no band" failure).** Opposite
  sign: the band stops far short of the limbs (-1361-03-12 at 52.20 against limbs at 76.95) while
  the midline carries on past it — which is exactly what "centreline drawn where there is no band"
  means. The midline comes from the `pairs` list; the band comes from the QUADS; quads are being
  DROPPED somewhere the cross-sections survive. The midline trim at the end of `buildBands` only
  walks back over `.rebuilt` sections, so it has no idea a quad was discarded. Fix: trim the midline
  to the band that was actually DRAWN, not to the cross-sections that were computed.

  **691-05-03 is the >8% coverage failure and sits in group 1** — treat it as the same bug and
  re-check coverage after, rather than as a third thing.

  **Do NOT "extend the limbs to the pole".** `tshirt.js` (~line 618) carries two contradictory
  comments — one proposing it, one recording that it was tried and reverted because in a projection
  where the pole is a point the two extensions converge into a ragged notch the centreline pokes
  through. Someone went back and forth and left both. Delete the stale one when this is fixed.

  **Safety property that makes this tractable:** the three assertions are pure consistency checks
  over the whole catalogue, so any change that fixes these 11 without altering the other 11,887 is
  provably safe — diff the drawn geometry across every record before and after.

  Original note:
   finish the t-shirt geometry** — 3 failing catalogue assertions in the polar tail.
   Deliberately NOT first: least visible, most likely to consume a whole session. Read HANDOFF §11.4.
5. **Search temporal tokens** — needs a design decision before any code. Not currently bothering him.
6. Remaining open bugs → UX deliberations → Features.

## MAP COSMETICS — mostly DONE (2026-07-12/13). What remains:
- ~~**Limb not perfectly round**~~ **NOT APPLICABLE TO THIS BRANCH — struck 2026-09-13.** It
  described a faceted globe silhouette fixable by lowering `maximumScreenSpaceError`, which is
  CESIUM's API. There is no Cesium here and no globe projection in `map.js` — the live map is flat
  Web Mercator, so there is no limb to be faceted. `maximumScreenSpaceError` appears nowhere in the
  tree. Only relevant if the dormant `cesium` branch is ever revived.
- **Raster sharpness ceiling.** NE2 is now `ne2_mercator.jpg`, 4096x4096 (Web Mercator, not the
  old 4096x2048 equirect — see HANDOFF §7.2), so it's sharper than before but still soft at
  close-in views. 8192x8192 would be a large GPU-texture jump on the platform we fought an OOM
  on, so DO NOT just swap the image. The right answer is a **tile pyramid** (only visible tiles
  resident). Revisit only if the softness actually bothers you in the field.
- **Thunderforest Landscape basemap** — needs an **API key**, which for a static PWA must sit in
  client-side code where anyone can read it. Same for Stadia/Stamen and Mapbox. Decide whether
  that's acceptable. Free/no-key providers already ship in the Settings picker (Esri x5,
  OpenTopoMap, OSM). Menu: https://leaflet-extras.github.io/leaflet-providers/preview/
- **Preload the three About-link eclipses.** Their chunks load on demand, so the 10th-century
  Ouagadougou link makes you wait. Preloading whole centuries is overkill; the right fix is to
  generate three small per-eclipse extract files at build time and special-case their load.
  A build-step change, not a code tweak — do it deliberately.
- **A second "travel this way" arrow?** The sun arrow points at the SUN's azimuth at maximum
  (from the pinned location). A field user might also want the direction to the CENTRELINE —
  i.e. the shortest hop to gain totality. Different quantity, roughly perpendicular; would need
  to be visually distinct so the two are never confused. Deliberate before building.

### Shipped this session (do not re-open)
Sun arrow (red, filled dart, per-frame constant screen size, base locked to the pin) · push-pin
observer marker with contact dot · orange GE diamond with distance scaling · flat city dots (no
outline rings) · dark warm-charcoal borders that fade with zoom-out · 50m borders on BOTH
platforms (Andorra has borders again) · umbra ovals fade instead of blinking · city labels drawn
whole + per-city EllipsoidalOccluder horizon test (no more half-eaten "TY", no hemisphere blink) ·
hamburger Details icon (SVG, gold) · tab order Search/Map/Details/Settings on both layouts ·
settings sub-tab order + scroll-to-top + app-standard text size · online basemap picker (7
providers, live swap) · polar hole filler (sub-tile imagery layer, colour SAMPLED from each
provider's own z=0 tile) · load crawlbar · Details-tab throb on new location · date label to the
corner · About-text deep links (select + recentre) · placename kept beside coords · clear-location
actually clears · landscape space reclaim · mobile install note · banner slimmed.

---

## OPEN — UI / COPY
- **Share output — STYLING AND FORMAT, not content. Narrowed 2026-09-13.** The old item called the
  output thin and asked what a shared eclipse should carry. `buildShareText` answers that: date,
  type, greatest-eclipse duration/time/location/magnitude, path width, and the SENDER's full local
  circumstances including all four contact times. **What the user wants explored is how it LOOKS** —
  styling and the formatting of the shared information, which is currently tab-aligned plain text.
  That ceiling is the transport, not the code: `navigator.share`/`mailto` carry plain text only, so
  anything richer needs the server-side share page (see Polish queued), which also carries the one
  piece of CONTENT still missing — a map image.

- **Poster picks: none and all send the same instruction.** `tsOpen` reads an empty pick set as
  "use everything", so the log toolbar's tri-state checkbox has two states that mean the same
  thing to the poster — only the dash (some picked) actually narrows it. Harmless today, but the
  control now *shows* the distinction it does not have. Fix in `tsOpen` if it ever matters, not
  in the toolbar (HANDOFF §11.3).

- ~~**Polar ice caps do not participate in the relief fade.**~~ **DECLINED 2026-09-13 — built,
  tested, reverted as unobservable. See DECIDED AGAINST.** Original note: They are opaque fills drawn ABOVE
  `relief`, so past ±85° the map stays solid ice-white while everything else eases back to the
  flat vector fills at high zoom (HANDOFF §7.2). Defensible — it IS ice — and rarely visited,
  but it is an inconsistency in a deliberate visual rule.

- ~~**Should HYBRID eclipses match a search for "total"?**~~ **DECIDED AND BUILT 2026-09-13.**
  Yes, and for `annular` too — hybrid literally means total along part of the path and annular
  along the rest, so a chaser shown nothing has had a wrong answer, not a precise one. One branch in
  `search-parser.js`'s `filter.types` test; hybrids are still LABELLED hybrid, only what they MATCH
  widened. Only the global-type path changed — with a location set, `e.local_type` already decided
  it at the point and `eclipse.js` promotes a hybrid there deliberately.
  Measured over the full catalogue: `total` 3173 -> 3742, `annular` 3956 -> 4525, `hybrid` and
  `partial` unchanged, all +569 = every hybrid, counted once.
  *The AND worry flagged when this was scoped was unfounded:* `total annular` returned 7129 before
  the change, exactly 3173 + 3956, so two type words were always a UNION. Nothing to settle.
- **Search temporal tokens — open-ended *backward* ranges are useless (the "1999-" / "now-"
  problem). NEEDS A DESIGN DECISION — do not code yet. Low priority.** Today a trailing-dash range
  like `1999-` lists ascending from the catalog's START (year ~1 or earlier), so the user drowns
  in ancient eclipses and never reaches 1999. **Constraint from Guy: the list must ALWAYS read the
  same direction — no query-dependent sort flipping.** So the fix is NOT "sort descending for
  backward ranges." Open options to weigh (consult before implementing):
    (a) Auto-scroll/jump the list to the anchor year so the relevant region is on screen, while
        keeping the global ascending order intact.
    (b) Default the open end to a bounded window (e.g. `1999-` = the N years before 1999) instead
        of all-of-history.
    (c) Drop/disallow the bare trailing-dash form and steer users to explicit ranges
        (`1950-1999`).
    (d) Keep ascending but show a result count / "showing first N of M" + a way to page toward
        the anchor.
  Decide the model first, then align the example text. The underlying asymmetry Guy noticed
  (`today+` exists; `now-` semantics are murky) gets resolved by whichever model wins.

---

## VERIFY (logic — handle with care; not pure copy)
- ~~**Offline timezone for odd zones (Gander −3:30, Nepal +5:45).**~~ **VERIFIED AND HALF OF IT WAS
  BROKEN — FIXED 2026-09-13. Item closed.** `tz-lookup` returns the right IANA zone, and the
  half/quarter-hour handling was fine: the `shortOffset` regex in `getAutoTzOffset` parses minutes,
  so −3:30 and +5:45 came through correctly. **The DATE handling was wrong.** The function resolved
  the zone at `new Date()`, so every eclipse got the offset in force TODAY. Measured: Gander
  2038-01-05 showed −2:30 instead of −3:30 (a full hour — today is in daylight time, January is
  not), and Kathmandu 1955-06-20 showed +5:45 instead of +5:30 (the zone moved in 1986). Silent,
  and it landed in the contact times. Fixed with `tzRefDate()` in `tabs.js`, which resolves at the
  selected eclipse's date at midday UTC — midday so a changeover is never straddled, and the year
  set via `setUTCFullYear` because `Date.UTC(y,...)` maps years 0–99 onto 1900–1999 and this
  catalogue runs to −1999. No call site changed; falls back to now when nothing is selected, which
  is what all four callers got before. Verified against both eras for both zones plus Cornwall 1999
  and a −1999 record.

---

---

---

## 🧭 STANDING RULE — USE THE RENDERER'S API BEFORE HAND-ROLLING
*(Active renderer is **MapLibre + deck.gl** (`js/map.js`). The dormant `cesium` branch is
parity-only — see PARITY.md. The canonical, renderer-neutral statement of this rule lives in
HANDOFF §5; this is the task-side reminder + the outstanding tech debt.)*

**Rule: before writing per-frame code or geometry tricks to fake a visual effect, name the
API (MapLibre / deck.gl on the live app; Cesium on that branch) that should do it. If you can't
name one, say so out loud rather than hacking silently.** Most churn in this project came from
treating the renderer as a dumb surface to outsmart rather than an engine with a considered API.

**Corollary — beware "safety rails" (renderer-agnostic).** Constants added as harmless guards
have twice become the DOMINANT term: a 2 km arrow floor (at street zoom the whole view is ~2 km,
so the arrow filled the screen); a 16 px screen floor applied AFTER a 300 km ground cap (at globe
zoom the floor exceeded the cap, so `Math.max` threw the cap away and the arrow spanned Africa).
If two limits can fight, write down which must win — and check the arithmetic at BOTH extremes.

### Hand-rolled tech debt on the **cesium branch** (dormant — does NOT apply to the live MapLibre app)
Recorded so it isn't lost if that branch is ever revived. These name Cesium primitives with no
MapLibre equivalent; do not port them to `map.js`.
- **Border fade with zoom** — pokes `material.uniforms.color.alpha` every frame; Cesium
  primitives support distance-based appearance natively.
- **Arrow geometry rebuild** — surface geometry recomputed per frame via `CallbackProperty`; a
  `Billboard` with `scaleByDistance` would be GPU-side and free, IF the limb/occlusion problem is
  solved by the engine rather than by hand.

*(The live MapLibre renderer has its own equivalents — e.g. globe occlusion via
`map.transform.isLocationOccluded`, see HANDOFF §8.4. The whole globe-occlusion family — #P2
(paths through the planet) and #R1 (city labels) — is now closed.)*

---

## ⛔ DO NOT DO (verified traps — recorded so they aren't re-attempted)
*(Some traps below name **Cesium** primitives — `CLAMP_TO_GROUND`, `depthFailMaterial`,
order-independent translucency. Those apply to the dormant `cesium` branch only; the live
MapLibre+deck.gl app can't hit them; the equivalent occlusion/depth question (#P2) is now fixed.
The data-key and safety-rail traps are renderer-agnostic.)*
- **Do NOT rename the `ep.centreline` DATA KEY → `centerline`.** Internal JSON key emitted by
  the generator and read by `map.js` (plus the layer id) — distinct from the visible label.
  Renaming requires changing generator output, regenerating EVERY path file, and changing the
  reader in lockstep: a breaking refactor for zero user-visible payoff.
- **Do NOT re-add clamp-to-ground on iOS.** `heightReference: CLAMP_TO_GROUND` and
  `clampToGround: true` (the *classification* kind) crash iOS Safari on the offline transition
  (`f.globe` render error) and gap polylines at certain zooms. Confirmed isolated: desktop runs
  the fill primitive fine, so the fill was never the crasher — clamp was. Occlusion/limb
  problems must be solved another way (basemap-as-globe-surface, or depth-tested surface
  geometry). NOTE the distinction: plain height-0 geometry we DO use — `clampToGround: false`
  polylines (arrow, paths) and depth-tested billboards/points (markers, dots) — is fine; only
  the classification clamp is banned.
- **Do NOT lift the eclipse paths off the ground.** They are drawn at EXACTLY height 0. Any lift
  parallaxes them across the surface by `height × tan(view angle)`: a 2.5 km lift (tried) displaces
  the path by **4.3 km** at 60°; even a 50 m lift is 29 m at 30° — meaningless noise on a centreline
  computed to ~15 m. **This corrupts the measurement the app exists to make.** If something occludes
  a path, use `depthFailMaterial` (already in place), which costs zero geometric offset.
- **Do NOT re-add a screen-size FLOOR to the sun arrow.** A `Math.max(L, MIN_PX × mpp)` applied
  after the ground CAP is LARGER than the cap at globe zoom, so it throws the cap away and the
  arrow spans a continent. The CAP must be the last word. (Likewise a 2 km absolute floor became
  the dominant term at street zoom, where the whole view is ~2 km, and the arrow filled the
  screen.) **Beware any constant added as a "safety rail": check the arithmetic at BOTH extremes.**
- **Don't bother disabling order-independent translucency on mobile.** We tried it chasing the
  backgrounding crash; it did NOT help (the framebuffer cuts — skybox/atmosphere/FXAA/MSAA off
  — did). No evidence it broke anything either — it's simply pointless. Left at default.

---

## BUGS — open (detail; status in handoff)
- ~~The country index marks far too many countries "central"~~ FIXED 2026-08-30a. Cause: the two
  umbra limits arrive in different longitude conventions, so `un.concat(us.reversed())` made a
  polygon ringing the planet. Generator fixed (`bandWindows()`, both copies); shipped index
  repaired, central entries 1,918 → 367. Andorra now 60% not-central against a computed 59.8%.
- **⚠ STILL WRONG: some eclipses claim absurdly many central countries.** Their central paths
  ENCIRCLE A POLE. A corridor that wraps 360 deg of longitude around the pole cannot be represented
  as a simple lon/lat polygon, so no amount of unwrapping fixes it — it needs a spherical
  containment test (or an explicit polar cap case).
  **Counts re-measured against the shipped `central_countries.json.gz`, 2026-09-13** (the old note
  said "two eclipses claim 55 and 42" and "46 claim 26-40" — both have drifted, and nothing in the
  change log says why, so trust these): worst is **cat 2190 at 42**, then 654 at 39, 790 at 38,
  9157 at 35, 519 at 34. **One** record above 40, **44** above 25. No record claims 55 any more.
  Some of the 25-40 band is probably the same bug in milder form.
- **Two eclipses with a missing umbral sliver — WON'T FIX for now; documented so it isn't
  rediscovered.** `332-03-13` (cat 5554) and `2485-12-07` (cat 10668), both type `A+`, are the
  only two central eclipses in all 11,898 that produce NO umbral limb at all. Verified against
  Jubier's KMZs: he draws a single tiny annular edge for each — **50.8 km / 14 pts** (332) and
  **117.4 km / 37 pts** (2485), plus one terminus point tacked on either end (164 km and 222 km
  end-to-end). His "Northern Umbra Limit" and "Southern Limit" are the *same curve reversed*,
  point-for-point — consistent with `A+` meaning one edge only. Everything else on both records
  is correct (penumbra, green curve, terminators).
  **Rarity:** these are the two smallest umbral footprints in the catalog. A normal `A+` peer
  traces 100–240 points, and both 332 (γ 1.00358) and 2485 (γ 1.02422) sit inside the peer γ
  range, so it is NOT a marginality cutoff — 332 is a milder non-central than peers at γ 1.02
  that trace fine.
  **If it ever needs fixing:** the one-limit branch in `build_path` samples `tmin..tmax` at
  **1201 fixed steps** and requires `len(_tn) >= 2` before it will walk a limb. On an arc this
  short the annular phase may fall between samples, so the walk never starts. **Untested
  hypothesis — instrument `umbra_pair` over both records' t-ranges to confirm before coding.**
  If confirmed, the fix is a scale-aware resample of that interval, the same principle as the
  existing narrow-band densification (`NARROW_KM`) — not a new mechanism. Do NOT widen the
  1201-step sampling globally; that costs every eclipse to serve two.
  **Regression test if attempted:** the other 33 `A+` records must be byte-identical after.
- **Penumbra threshold offset (low priority — user accepts "close").** Our penumbra limit
  sits ~7–10 km INSIDE Jubier's, asymmetric N/S. NOT a single term (dropping the cone-narrowing
  term fixes north, worsens south) — suggests a direction-dependent (refraction/limb) term. The
  implicit-contour penumbra prototype reaches ~9 km. Pursue only if chasing sub-km everywhere;
  otherwise "naturally fuzzy" is fine. Eventually migrate penumbra onto the implicit engine as
  {max magnitude = 0}.
- **Safari geolocation fails; installed PWA works.** Check secure-context / permissions / Brave
  default block vs the code path.
- **Slow first load from local-disk server** — minutes vs seconds. *(Partly explained: every asset
  downloads TWICE on a build change — see PERFORMANCE / DATA. That is pre-existing and mostly
  served from disk cache in production (~11 s load, DOMContentLoaded ~950 ms), so profile the
  LOCAL-server case specifically before assuming it's the same cause.)* Profile the chunk-fetch
  pattern.
- ~~Scan's O(n²) index lookup~~ FIXED 2026-08-29p — 232 ms → 65 ms. It walked all 11,898 index
  entries per hit (10.2 M comparisons) to resolve a date; now a map. Result list proven identical
  at twelve locations. This was never in this file; the item below is the *other*, larger win.
- **Scan ignores non-location filters** — **DECLINED 2026-09-13, see DECIDED AGAINST.** The scan
  walks all 50 chunks whatever else is typed; a date filter could cut it to one. Left alone because
  the win is unmeasurable and the downside is silent wrong answers.

---

---

## FEATURES — EASY
- ~~**Viewing conditions in the details panel.**~~ **CLOSED 2026-09-13. Cloud half SHIPPED, terrain
  half DECLINED — do not re-propose either.**
  The cloud indicator is live: `fillCloudOdds()` in `details.js` renders a "Typical cloud" row via
  `Cloud.ensureAt`, shown as CLEAR SKY to match the other rows' direction, alongside the
  Favorability row. The three cautions this item carried were all honoured — it fetches on demand
  rather than rendering a silent zero, the wording avoids implying odds, and the tooltip states the
  0.5 deg resolution.
  **The terrain indicator was considered and rejected, 2026-09-13.** Not for difficulty: `occAt` in
  the shader already returns exactly the wanted 1/0 per point, and `readPixels` of a 1x1 target is a
  pattern the layer already uses for `terrainMax`. The blocker is the ATLAS. The march needs
  elevation along the sun ray — tens of km at eclipse sun angles, capped at the grazing horizon
  `sqrt(2*R*h)` — and the atlas is built from what the MAP has loaded, so a details-panel row would
  be silent at exactly the wide zoom where someone is choosing where to go. Making it honest means a
  standalone probe: own DEM fetch along the corridor, own small atlas, own 1x1 march. A few hours,
  online-only, and **the user decided it is not wanted in the details panel.** `details.js` already
  says so in the Favorability tooltip ("No terrain: a ridge blocking the sun is not counted here"),
  which is the agreed answer.
- Thumbnail path map per list row (small SVG) — MOBILE ONLY (not desktop). *(Was listed twice;
  the PERFORMANCE copy was merged here 2026-09-13. Its question stands: check feasibility and
  total size for tiny scaled flat-map paths across all 5 centuries before building.)*
- Century scroller on the mobile right edge.
- ~~KMZ download.~~ **DONE 2026-09-02b** — `js/kmz.js`, globe button in the details panel.
  One eclipse per file (`YYYYMMDD_TSE.kmz`), path + penumbral/terminator limits + horizon curve +
  shadow footprints + greatest eclipse, and a circumstances balloon every 100 km along the
  centreline, all precomputed so the file works with no signal. See HANDOFF §10B for the gotchas.
  - **Deliberately NOT live.** Jubier computes circumstances for the view centre on demand via a
    `NetworkLink`; that needs a server, and Bluehost has no Node (checked). If a Cloudflare Worker
    ever exists, `eclipse.js` runs on it unmodified and the NetworkLink is ~10 lines.
  - Open if wanted later: dots across the umbra WIDTH as well as along the centreline (`KMZ_DOT_KM`
    is a constant, not a rewrite), and a dark outline under each line if orange still fights the
    basemap — KML has no stroke-outline, so it means drawing each curve twice.

## FEATURES — MEDIUM
- **#F6 FAVORABILITY OVERLAY — COMPLETE as scoped, 2026-09-11.** All four build steps shipped
  (2026-09-08a through 2026-09-11c); renamed from "desirability" at 2026-09-11a. The remaining
  items are listed under PRIORITY ORDER #2 and none of them block anything. **Everything below is
  kept as the RECORD of what was decided and why** — the calibration, the rejected approaches, and
  in particular the corridor-polygon ledger, which exists to stop a fifth attempt at it.
  A third map overlay: **one composite score**, green→red, for "how good is this spot for watching
  *this* eclipse". Not a stack of layers — cloud and terrain have their own overlays; this is the
  single number that blends them. Drawn only inside the **central path**, total and annular only, no
  penumbra; the button is disabled for non-central eclipses.

  **The score.** `S = C^0.60 · D^0.40 · A^0.15`, with a hard VETO where terrain blocks the sun.
  C = clear-sky from the existing climatology (0–1); D = totality duration ÷ this eclipse's maximum;
  A = sun altitude, `clamp((alt − 2) / (15 − 2), 0, 1)` — flat above ~15–20°, falling below ~10°,
  zero at the horizon. Multiplicative, not a weighted sum: a sum lets a cloud-locked 4-minute valley
  outrank a clear 2-minute ridge, and the concave exponents give the diminishing returns that plain
  expected-seconds (`C · D`) gets wrong — the first second of totality is worth far more than the
  240th.
  - **0.60 / 0.40 are CALIBRATED, not invented** — fitted to the user's own answers on eight
    forced-choice pairs (duration vs clear-sky odds, sun height held equal), run 2026-09-01. Cloud
    carries the larger exponent because it spans 0→1 while D only spans edge→centre.
  - **0.15 on A is a STARTING POINT, not calibrated** — the pairs held sun height equal deliberately,
    so it was never fitted. Tune by eye against the Spain 2026 reference map.
  - **Known inconsistency, recorded deliberately.** A single power law predicts the answers flip once
    as the trade steepens; the user's flipped three times, and pairs #2 and #6 cannot be reconciled
    with the other six. Sorting by the SIZE of the clear-sky gap gives a cleaner rule: a gap of 8–10
    points → he took the longer, cloudier option; 15+ points → he took the clearer, shorter one. I.e.
    small cloud differences are ignored, then a switch flips once the gap is real. He confirmed that
    is his actual reasoning. It is also defensible on grounds he did not have in front of him: §10.6
    says the cloud figure is a climatological mean on ~55 km cells and not a probability, so 8 points
    between neighbouring cells is inside the noise. **Do NOT build a deadband in v1** — blotchy map,
    second mechanism to debug. Ship 0.60/0.40; revisit only if the map visibly ranks spots on
    differences too small to mean anything. Three more forced-choice pairs would settle #2 vs #6.
  - **VETO is not a low score.** Same red family as the ramp's worst but **darker and fully opaque**
    where the ramp's worst is lighter and slightly translucent. One extra LUT entry, no hatch, no new
    hue. Rationale: the veto only exists at zoom ≥6 and online, so an identical red would silently
    change meaning on zoom; and the bottom of the ramp is already occupied by path-edge slivers,
    which are a poor spot rather than an impossible one.

  **Normalisation — decided. Per eclipse, always.** The colour means "best spot *for this eclipse*",
  never "this eclipse beats that one". Consequence to accept: green on the 2028 map and green on the
  1997 map do not mean the same thing, so the legend must say "compared to the rest of this path".
  Plus a **Whole path / This view** mode — whole path is the default and never moves; this view
  restretches to what is on screen, so once you have chosen Spain over Greenland you can still see
  contrast within Spain. **A mode, not a button**: a "recalibrate now" button goes stale the moment
  you pan with nothing to tell you, where a mode makes colours-move-on-pan the stated behaviour.
  Debounce on `moveend`, stretch on the 2nd–98th percentile (one anomalous cell would own min/max),
  and restretch the **composite once** — never rescale C and D separately, which amplifies whichever
  term is flat into false contrast.

  **THERE IS NO CORRIDOR POLYGON. DO NOT BUILD ONE.** The layer is a raster and only ever asks "is
  THIS cell in the central path?", which `computeEclipse` answers directly:
  `var r = computeEclipse(rec, lat, lon, 0); var inCorridor = r.visible && (r.type === 'total' || r.type === 'annular');`
  (`alt` is not optional — HANDOFF §9.0.) It costs nothing extra: the layer is already calling
  `computeEclipse` per cell for duration, and one call carries both answers. **MEASURED:** 2026-08-12
  rasterised over a deliberately oversized 440×260 grid spanning 180° of longitude took **417 ms in
  Node**, and the result is a clean ribbon — correct over the pole, no flat bar, no fold, no
  self-crossing. A real viewport is smaller. So do not build limb pairing, 360° branch alignment,
  limb de-forking, an area-ratio guard, or Sutherland–Hodgman clipping: all were scaffolding for a
  polygon that should not exist. `map.js` (~line 1713) already has corridor fill deliberately
  disabled for this reason, and the deleted `BACKLOG.md` (`git show de95fda^:BACKLOG.md`) records
  four prior elegant attempts that each fixed one case and broke others. Scoping 2026-09-01 walked
  into the same wall independently and measured why it is structural, not shallow: the two limbs can
  land in different 360° branches (2072-09-12: north +111..+169, south −134..−228); multi-segment
  limbs are usually ONE curve cut at a seam, not two branches (2097-11-04 splits at latitude −89.99
  with its ends 1 km apart, so "longest segment wins" discards 78 real points and closes the ring
  across 7,000 km, manufacturing a bowtie — while 1979-08-22 is a true fork, so the rule must be a
  test, not a preference); and after fixing both, a contact sheet of 24 corridors still showed ~9
  broken fills, **every one a polar path, including 2026-08-12**. Proper latitude clipping did not
  help, because when a corridor crosses a pole the north and south limits swap sides and the ring
  wraps instead of closing. **Also note the chord approximation and the 13×7 interpolation grid are
  both unnecessary** — call `computeEclipse` per cell and get the exact answer, including the hard
  zero at the path limits that any interpolation would smear. **NO GENERATOR CHANGES**: paths carry
  no durations and do not need to. The existing deck.gl outline is untouched by all of this.
  One-limit grazers have no interior and are excluded automatically (the membership test simply finds
  no qualifying cells).

  **Architecture.** Two files, matching the existing convention: `js/favorability.js` (the score,
  palette LUT, `sampleAt`; rendering cloned **structurally** from `cloud-average.js`) and
  `js/favorability-ui.js` (button, mode, legend, and the borrowing of the shadow engine — it talks to
  `shadow-ui.js`, **never into `shadow-layer.js`**). The UI file owns the engine handover because
  **the shadow engine is a paintbrush, not a sensor**: it draws and discards and exposes no query, so
  at high zoom terrain is not an input to the score but a mask above it. Coordinating two renderers
  is a UI job, exactly as `cloud-ui.js` already does across three cloud modules.
  - **Clone from `cloud-average.js` and do not "simplify"**: two canvases (§10.3), `_safeSize()` (the
    power-of-two black-texture trap), canvas sized to the DATA, `_drawnKey` (§10.5), `_againForce`,
    top-of-stack placement, and a `version` constant bumped on every change (§10.7).
    `Cloud.sampleAt` (incl. its returns-null-until-rendered behaviour) is the model for the readout.
  - **The terrain half needs NO changes to `shadow-layer.js`.** `setOptions({shadowColor})` takes
    RGBA and repaints; `setTime()` repaints. Borrow the engine, set it to veto red, pin its time, hide
    the scrubber. **Pass `ss:false` explicitly** — the module default is false but `shadow-ui.js:54`
    passes true, which would give the veto mask fractional edges instead of a hard binary.
    `SHADOW_RGBA` is module-level, not per-instance, which is safe only because of the next line.
  - **Decision (user's): ONE overlay at a time.** Favorability and shadow mode are mutually exclusive
    presentations of the same engine; whoever owns it sets colour, time and projection.
  - **The score layer works on the globe; the terrain veto does not.** `cloud-average.js` has no
    projection flip and its `_bbox()` handles the globe; `shadow-ui.js` forces Mercator. So: **score
    everywhere on either projection, terrain veto at high zoom, Mercator, online.** Inherit
    `shadow-ui.js`'s existing gates (`isOffline()` hides at line 291; below `SHADOW_MIN_ZOOM` it hides
    while staying armed) rather than reinventing them.
  - **The zoom handover must be VISIBLE.** Below the shadow zoom gate the terrain term is absent;
    above it the veto appears, and the score under the cursor changes. Not a bug, but it needs a
    legend line naming which visibility source is live, the way the cloud mode strip names its source.
  - **Add ONE entry point to `shadow-ui.js`** (e.g. `showShadowAsVeto(timeMs)` / `restoreShadowMode()`)
    — do not call its underscore internals. The time is **NOT** `computeShadowWindow().maxms`, which
    is greatest eclipse, GLOBAL: one instant for the whole planet. The veto needs the **local**
    maximum, `computeEclipse(rec, lat, lon, 0).tMax` at the viewport centre. The handover must land
    clean both ways — failure modes are map stuck in Mercator, orphaned scrubber, shadows vanishing
    with the wrong layer.
  - **Palette needs a look before committing.** Green→red for the ramp, distinct from cloud's
    blue→red (Anderson's scale, which *means* cloud). §11.5's visual language is test-enforced.

  **THE PER-CELL COST WAS WRONG BY 5x, AND THE FIX IS LOAD-BEARING — see HANDOFF §9.0.**
  The note claimed `computeEclipse` was 4.9 us and concluded exact-per-cell was affordable. Measured
  2026-09-08 it is **26.5 us inside the path**: 1,043 ms for one Iberia viewport, 11,385 ms for the
  world canvas — four and forty-five seconds on a phone. The score now uses `findMaximum` +
  `fundamentalArgs` (**1.10 us**, the two calls `computeEclipse` itself opens with) plus the
  Besselian semi-duration `2*sqrt(L2'^2 - m^2)/n`. **103 ms** and **1,522 ms**. Duration error
  against the full engine is 0.00-0.18 s median, p95 <= 0.43 s, and every disagreement over a second
  is a horizon cell where A is 0 and the score is 0 anyway. This is NOT the rejected chord
  approximation: same physics, same fundamental arguments, and it keeps the hard zero at the limits.
  **Two dead lines in the note's own snippet**, both fixed here: `computeEclipse` promotes central
  types to `'hybrid'`, so its `type==='total'||type==='annular'` test silently dropped all 569
  hybrids; and an omitted `alt` returns `{visible:false}`, not `annular`/`NaN`.

  **Build order.**
  0. DONE 2026-09-08a — `Cloud.ensureSlices()` + version bump (HANDOFF §10.7).
  1. DONE 2026-09-08b — `js/favorability.js`: per-cell membership, C x D x A, palette,
     `sampleAt`/`detailAt`, two canvases, whole-path normalisation, `setMode('path'|'view')` hook.
     Wired into `index.html` + `sw.js` CORE. `tools/checks/test_favorability.js`, 26/26, registered
     in `run.js`. Verified by RENDERING it: the 2026 polar loop closes, the Iberia ribbon grades
     green at the centreline to yellow at the limbs, 2027's long African totality is green in the
     middle and red at the sunrise/sunset ends. No bowtie, no wedge, no polar fold.
     **The antipodal-shadow bug (fixed 2026-09-08c, HANDOFF §15) is the one to know about**: the
     fundamental-plane projection cannot tell which side of the Earth you are on, so the far side
     passed the membership test at night and drew a dark-red ring round the world. A `sun.alt > 0`
     test fixes it. It hid because score 0 is a legitimate colour, so it looked like an answer
     rather than a fault — **zero and "no eclipse here" must never render the same.**
     **Known gaps left for later, deliberately:** no button (step 2); the terrain veto is step 3;
     `'view'` mode stretches on min/max, not the 2nd-98th percentile, so one anomalous cell can own
     the ramp — fix when the UI can exercise it; and the A exponent 0.15 produces a visible hard
     edge where sun altitude crosses 2 deg and the score snaps to zero — a blunt dark-red cap at
     each end of the path. FIXED 2026-09-08e — the shape was wrong, not the weight; ALT_LO/ALT_HI
     are now 0/18 with P_A 0.35 (HANDOFF SS15). P_A remains uncalibrated and is the obvious knob if
     sun height ever feels over- or under-weighted.
     **Resolution is a TIME budget, not a quality dial** — the cost is per cell: 288 px 146 ms,
     384 px 175 ms, 512 px 289 ms, roughly 4x each on a phone. Shipped at 384. To go sharper, do a
     two-level pass (score coarsely, refine only blocks containing corridor) rather than paying for
     a viewport that is mostly empty.
  2. DONE 2026-09-08h — `js/favorability-ui.js`: the bullseye map button, the Whole path / This
     view mode strip, and the legend, reusing `#cloudbar`'s box and cell classes so there is one
     styling to maintain. **One overlay at a time, wired BOTH ways** — favorability drops the cloud
     overlay and any cloud mode drops favorability; the guard in `cloud-ui.js` is `window.FavorBar &&`
     so deleting the UI file leaves cloud working unchanged. The score still READS the climatology
     when it is not painted, which is why it needs no cloud layer switched on.
     **Still to do here, agreed with the user 2026-09-08:**
       - DONE 2026-09-10g — **step 3, the terrain veto** (HANDOFF SS15).
       - DONE 2026-09-10m — **the legend wording** (the user's), and the full Instructions entry
         with the formula. No percentages in the legend: the weights are not fixed, they depend on
         which input has the widest spread along that particular path (measured: duration is 18% of
         the effect on 2026-08-12 and 42% on 2031-11-14).
       - DONE 2026-09-10c — **"This view" mode**, stretching on the 2nd-98th percentile.
       - DONE 2026-09-11b — the score row in the Details panel, with the inputs on hover.
         `details.js` edited (SHARED per PARITY.md), both additions typeof-guarded.
  3. Borrow the shadow engine at high zoom via the new `shadow-ui.js` entry point: veto red,
     `ss:false`, time pinned to the LOCAL maximum. No changes to `shadow-layer.js`.
  4. The `u_mask` uniform in `shadeFS` — **SIGNED OFF** (the user has taken his own `PRE-MASK` copy,
     HANDOFF §8.1a). `uniform sampler2D u_mask; uniform float u_hasMask;` and at the top of `main()`:
     `if (u_hasMask > 0.5 && texture2D(u_mask, v_uv).a < 0.5) discard;` plus binding the texture in
     `render()`. `v_uv` is the atlas rect in Mercator, which is what the score canvas already covers —
     so the score canvas **is** the mask and the corridor is solved once for both purposes. With
     `u_hasMask` at 0 the shader is bit-identical to today, which makes the **zero-pixel diff** proof
     available; land it in the same commit, diffed against `PRE-MASK` (NOT against `ORIGINAL` — that
     would show the supersampling too). MapLibre has no `clip` layer type and `gl.scissor` is
     rectangles only; an inverse-polygon fill was rejected by the user as it hides the basemap.

  **Estimate: two to four working days for steps 1–3.** Steps 1–2 are a structural clone of debugged
  work; step 3 is settings on an existing engine. The estimate came down because the corridor polygon
  — the entire source of variance — turned out to be unnecessary.

  **Tests** — `tools/checks/test_favorability.js`: score is 0 outside the corridor (40.4, −3.7 for
  2026-08-12 returns `type:'partial'`); **the polar case works** — 2026-08-12 across the Arctic leg
  returns `total` cells with no gap and no wrap, which is the regression guard against anyone
  reintroducing a polygon; one-limit grazers produce no cells; `computeEclipse` is always called with
  an explicit `alt`; `_drawnKey` rejects a canvas drawn for another eclipse.

  **Rejected, with reasons:** land mask (2031 is total over no land at all; at sea the horizon is
  genuinely clear and a boat is a viewing location); elevation bonus (double-counts cloud, and
  mountains make their own weather); road/settlement access (no data).

  **STILL UNVERIFIED, and it is a five-minute measurement in the browser rig:** how much the LOCAL
  maximum varies across a zoom-6 viewport. It affects only the terrain veto — if it is a minute or
  two, viewport-centre is fine and the mask can be recomputed on `moveend`.

- **#F6b DEFERRED, a separate project: the precomputed horizon field.**
  Terrain visibility at **path scale** cannot be computed live, and the reason is not cost: at zoom 3
  one pixel is ~100 km while a 3 km mountain at a 3° sun casts a shadow ~57 km long — less than one
  pixel, and the DEM atlas degrades with it. The question has no per-pixel answer at that scale.
  The answerable question is *what fraction of this ~1 km cell has a clear view*, and it is answered
  by a field with **no time in it**: per cell, the terrain horizon altitude at each of ~16 compass
  bearings, ray-cast once, offline, from a real 30 m DEM. At runtime
  `blocked = sun.alt < horizon(cell, sun.az)` — and `computeEclipse` already returns both. Works at
  every zoom, works offline, and yields a **number**, so it feeds the score and `sampleAt()` rather
  than only painting pixels.
  **Why deferred: size, and it has NOT been sized — that is the first task.** Global, 16 bearings, one
  byte each, against a current payload of 3.3 MB of cloud slices. Ocean is zeros and flat land nearly
  so, so it compresses. Generate it for one region first, prove the score works with a real visibility
  term, then decide about global. Honest limits to carry forward: it is a **fixed-observer,
  ground-level** horizon (a 10 m tower beats it), and at ~1 km a valley floor and the ridge above it
  share one answer. Storing the **best** horizon per cell rather than the mean makes it read as "there
  is a good spot here", which is the honest claim for a planning tool.

- **#F4 "Cache this spot" — offline tiles around the pin.** With a location and an eclipse
  selected, one press downloads basemap and terrain tiles for a small box round the pin, so the
  detail you need on the day survives having no signal. Plan at home, navigate in a field.

  **DESIGN DECISION, already taken — 10 km radius, max zoom 15.** Everything about whether this
  is a button or a project follows from those two numbers, so do not quietly widen them.
  A tile covers `40075·cos(φ) / 2^z` km, and because that shrinks in BOTH axes the count scales
  as **1/cos²φ** — Scotland costs 2.5× Ecuador for the same box. For a 20 km box, one raster
  layer, all zooms up to the cap, at ~40 KB/tile:

  | max z | ground res | equator | lat 45 | lat 57 |
  |---|---|---|---|---|
  | 14 | 2.4 m/px | 161 · 6 MB | 243 · 9 MB | 404 · 16 MB |
  | **15** | **1.2 m/px** | **485 · 19 MB** | **868 · 34 MB** | **1,428 · 56 MB** |
  | 16 | 0.6 m/px | 1,641 · 64 MB | 3,172 · 124 MB | 5,272 · 206 MB |
  | 17 | 0.3 m/px | 6,130 · 239 MB | 12,008 · 469 MB | 20,156 · 787 MB |

  z15 shows the field you will park in. z16 quadruples the cost for detail nobody uses at 4 a.m.
  **Terrain is nearly free on top** — Terrarium tops out ~z15 and shadows do not need better
  than z13, so ~115 tiles / 4 MB.

  **The one real blocker is `sw.js:117`:**
  ```js
  if (url.origin !== self.location.origin) return;   // online Esri tiles etc. → untouched
  ```
  Every basemap is Esri or OSM and terrain is `s3.amazonaws.com/elevation-tiles-prod/terrarium/`
  — all cross-origin, all currently passed straight through, so nothing cached would ever be
  served back. That line is also the current guarantee that the SW never interferes with live
  tiles, so the branch that replaces it wants care and its own test.

  **The rest, in order:** bbox → tile list (~15 lines of arithmetic); fetch with concurrency into
  a named cache — **reuse `precache()` in sw.js, do not write a second one**; cancellable
  progress UI, because a minute of downloading must be stoppable; and per-area "cached · 34 MB ·
  delete". At tens of MB per spot that is enough — a storage MANAGER would be over-building, but
  shipping with no way to see or delete what was stored turns a good feature into a phone that
  quietly fills up.

- **Compass built into the sky tracker.** Guy has ideas for how it should function and look —
  discuss the design before coding.
- Server-side share page (`followtheshadow.com/share?e=XXXXX`) — static HTML reading the
  existing JSON, rendering a formatted summary + map image. The only way past the plain-text
  ceiling of `navigator.share`/`mailto`. Also the home for "prettier share" visual polish.
- Splash / title page for installed-PWA mode; app icon; app logo / eclipse symbol.
- ~~Night-sky-during-totality view — planets/bright stars near the Sun at totality~~ DONE
  2026-08-28f (`js/starmap.js` + the sun track's own frame in details.js). COMETS were dropped deliberately, not forgotten: they need
  per-apparition orbital elements, so a static file cannot carry one, and a comet bright enough
  to matter during totality is a once-in-decades accident. Do not re-add without a data source.
- ~~`eclipse.js` places 221 eclipses 24 hours early~~ FIXED 2026-08-29c via `refT0()`, proven by
  a before/after diff of all 11,898 records (11,677 byte-identical, 221 changed, zero surprises).
  Regression suite: `tools/checks/test_t0.js`. See HANDOFF §2026-08-29c.

## MOVED FROM HANDOFF §3 on 2026-08-20 — file these properly next time you are in here

These were duplicated in both documents and had begun to disagree. They are verbatim from HANDOFF and
belong under the headings above; folding them in is a five-minute job for whoever is next.

### Open, measured, not fixed
- **`Now` takes ~15 s on first load.** This is the only remaining defect a user in a field would
  notice. **THE BYTE BUDGET, measured 2026-09-13 — the fifteen seconds is the BACKGROUND, not the
  picture.** A cold start over the Atlantic fetches ~2.6 MB of visible frames (4 satellites ×
  ~650 kB at 1024 px) and **~13.5 MB of clear-sky reference** (`BG_FRAMES` = 10 past frames per
  satellite × ~337 kB at the world box). ~16 MB total. Attack the 13.5 MB or do not bother.

  **The August diagnosis was WRONG and has been corrected in place.** It said a fixed fetch box
  tears the picture because `background()` builds its field against the VIEW box. `bgBox()` returns
  a fixed world box and has since the world-grid change; the background was never the cause. The
  real constraint was in `compose()`: it mapped **columns** by longitude but assumed **rows** line
  up 1:1 with the view (`n2 = j * pw + srcX[i]`), so any frame not on the view's exact box was
  vertically mis-registered. Proven with `mkframes.py` + `fullpreview.js`: a 10°-snapped fetch box
  rendered at mean abs diff 29.0 against the shipped baseline; with rows mapped by latitude it
  drops to 3.9 (residual = resample + minutes of cloud motion), and the patched `compose()` is
  **byte-identical (0.0) on the current view-box path**. ~8 lines, mirrors the existing column code
  and `bgTables()`. NOT YET APPLIED — it buys nothing until the fetch box changes, and on its own
  it only converts *repeat* views into browser-cache hits (measured: GIBS answers a repeat URL no
  faster than a shifted one, ~0.5–0.9 s either way from a datacentre, so the canonical-URL win is a
  **client/proxy cache** win, not a server one).

- **DEAD END, measured 2026-09-13 — do not retry: rounding the background timestamps.** The 13.5 MB
  is re-fetched by every session because each frame is stamped `Date.now()` snapped to `sat.step`,
  so the URLs churn every 10 minutes for imagery of ground that does not move. Rounding the stamps
  to a coarse grid would make them stable across days and users and cut a warm cold-start from
  ~16 MB to ~2.6 MB. **It destroys the measurement.** The reference is deliberately the same clock
  time on each of 10 past days because clear-sky ground temperature is dominated by time of day, and
  the method reads a few degrees of depression. Tested over Australian desert shortly after local
  dawn (Himawari, 113–153E, 34S–14N, live frame 2026-09-13T22:40Z), against the shipped exact-stamp
  reference, at the `>4 degC` depression threshold:

  | stamp shift | reference differs (mean) | cloud, exact | cloud, shifted | pixels flipped |
  |---|---|---|---|---|
  | 30 min | 1.86 °C | 39.0% | 70.1% | 31.3% |
  | 60 min | 3.65 °C | 39.0% | 79.7% | 40.8% |
  | 90 min | 5.38 °C | 27.2% | 80.5% | 53.4% |

  Ocean is far more forgiving (Philippine Sea, 90 min: 42.9% → 44.6%, 3.3% flipped) — **test over
  land at dawn or the result will look safe and is not.** Harness: `tools/checks/bgtest.py`.

  **The one route left that keeps the accuracy:** have the server build the reference field once per
  satellite per stamp and serve the finished field, instead of every phone fetching 10 frames and
  computing the second-warmest itself. That moves 13.5 MB of fetch into one small download. Not
  scoped. Cheaper partial moves: fewer than 10 past frames, or a coarser background grid — both
  trade accuracy for bytes and both need the same dawn-over-land test before shipping.

### Not done, by choice — in rough priority order
1. **Forecast half of #F2** — near-term, online, one eclipse. The climatology half shipped.
   **Scoped 2026-09-13, read #F2b before starting:** the quota objection was wrong arithmetic
   (corridor ~300 points, not a 19,200-point bounding box), the shape is agreed, and the first job
   is one curl of `api.open-meteo.com` — newly allowlisted, still untested.
2. **Greatest duration for all ~11,900 eclipses.** GE ≠ greatest duration even for ordinary eclipses
   (median +0.07 s, max +49.8 s and 10,686 km away). Needs a trustworthy global search, not the hill
   climb used for the 94 non-central ones. Full handoff in **`GREATEST-DURATION.md`** (repo root) —
   read it before starting.
3. **Duplicate downloads** (§12.4) — **shell half FIXED, SHIPPED AND VERIFIED LIVE 2026-09-13**
   (0 duplicated, was 30). Only the DATA (besselian/path) chunks remain, and they have never been
   measured separately. Re-measure before assuming there is anything left to fix.

### DECIDED AGAINST — do not re-propose
Each of these was live on a list above and was killed deliberately. The reason is recorded so the
next session does not re-derive the idea and pitch it back. Re-open only if the reason changes.

- **#F3 animated shadow with time slider.** Declined 2026-09-13. It was ranked "most on-brand" and
  the machinery is largely in place — the umbra ovals are already computed and drawn as a string
  along the path, and `shadow-ui.js` `setShadowTime` already owns "what instant are we showing".
  **It is a demo, not a tool: nobody chooses where to stand by watching the shadow move.** The two
  open design questions, recorded in case it is ever revived for its own sake: the ovals sit at
  fixed intervals, so scrubbing between them either stutters or needs shapes computed live (that
  choice is the difference between an afternoon and a session); and the existing slider is scoped
  to a location and a narrow window around local maximum, while this one spans the hours-long
  global eclipse, so it is one slider with two modes or two sliders that fight.
- **Terrain-shadow indicator in the details panel.** Declined 2026-09-13 by the user — the panel
  does not need it. Full reasoning under FEATURES — EASY: the shader's `occAt` already returns the
  1/0, and the 1x1 `readPixels` pattern exists, but the atlas is tied to the map view, so an honest
  version needs a standalone DEM probe. `details.js` already says out loud in the Favorability
  tooltip that terrain is not counted, and that is the agreed answer.
- **Star on a saved eclipse updating its location instead of unsaving.** Declined 2026-09-13 by
  the user: the star is a plain toggle and should stay one. Off + click saves, with or without a
  location; on + click removes from the log. Nothing further to design.
  *A gap was raised and turned out not to exist:* an eclipse saved with NO location can be given one
  later — the Log row's PENCIL sets a saved eclipse's location to the current map pin, and the
  manual already documents it. Nothing outstanding.
  *Done 2026-09-13:* the manual's log section now states the toggle explicitly (save / remove) and
  points at the pencil for location changes.
- **Fading the polar ice caps with the relief.** Built, tested and REVERTED 2026-09-13. The caps
  sit at opacity 1 while the relief fades from 3.5 to 9, so past ±85° the map stays solid ice-white
  while everything else eases back — a real inconsistency in a deliberate rule (HANDOFF §7.2), and
  the fix was one expression copied from `relief`. **Reverted because it is not observable:** by the
  zoom where the relief has faded, the caps are off screen, and at the 85° seam the online raster
  basemap has taken over anyway. Against zero visible benefit it left two opacity expressions that
  had to be kept in step for ever. Do not rebuild it; if the polar look is ever revisited, revisit
  it as a *look* and not as consistency housekeeping.
- **Splitting partial eclipses into separate on-request files.** Declined — MEASURED, not a
  preference. Partials are 4,200 of 11,898 (35.3%) but only ~3.5 MB of the 10.1 MB besselian cache,
  and having no central path they add ~nothing to the 263 MB of path data that dominates storage.
  Net saving ~1% of payload, in exchange for a new loading mode, a UI affordance, and "why can't I
  find my eclipse?" confusion — partials are exactly what a birthday or location search expects to
  return. *(Its old closing line pointed at chunk-filtering as "the real scan win"; that was
  declined 2026-09-13 too — see the entry below.)*
- **Scan ignores non-location filters (filter chunks before loading).** Declined 2026-09-13.
  `scanLocation` parses the filter into `f` and never uses it, so a location scan walks all 50
  besselian chunks even for "2026-2030 total", which needs one. The fix is obvious and the code even
  keeps `f` around for it. **Declined on payoff, not difficulty:** the chunks are precached by the
  SW and stay parsed in `chunkCache` for the session, and the maths is ~90 ms for all 11,898
  records, so there is nothing a user could notice. Against that, the comment at `local.js:155` is
  right — a filter bug makes eclipses VANISH from results silently, and a slow right answer beats a
  fast wrong one. If it is ever revived it needs its own build plus a result-set diff over a few
  hundred query shapes, and the cache key must gain the chunk set or a widened filter will reuse a
  partial scan.
- **Rounding the `Now` background timestamps to make them cacheable.** Not a preference — MEASURED
  to destroy the cloud reading. Table and method under "Open, measured, not fixed". A 30-minute
  shift takes cloud from 39.0% to 70.1% over desert at dawn. Ocean hides it, so any retest must be
  over land at dawn (`tools/checks/bgtest.py`).

*(#F5, global-vs-local eclipse-type search semantics, was struck 2026-09-13: the shipped code
answers it and the answer is the intended one. `search-parser.js` ~line 553 states the rule — a type
word means what the SELECTED PLACE saw; a country, being an area, uses its own type without a range
("total chile" = the central path crossed Chile) and the GLOBAL type with one ("chile total >50" = a
total eclipse of which Chile got at least 50%). The central-path test is exact path-vs-border
geometry, not the sampled grid. Confirmed as correct by the user. **Known limit, deliberate:** the
country table drops anything under 20% obscuration to hold the file at ~650 KB, so "chile >10"
cannot match.)*

### Polish queued (Sonnet-grade)
Merge "Coordinates" + "City" into one "Location" section (caveat: the parser doesn't handle
bracketed multi-word cities yet); move the eclipse date to an overlay on desktop and make it more
visible on mobile; distinguish web vs app banner size; server-side share page
`followtheshadow.com/share?e=XXXXX` (the only way past the plain-text ceiling of
`navigator.share`/`mailto`) — **this is where the two open share wants land: a MAP IMAGE, and
styled/reformatted presentation of the shared information rather than tab-aligned plain text**; Global Circumstances panel is tall.

### Deferred infrastructure
Production bundling (single JS/CSS). Offline city **labels**: MapLibre symbol layers need PBF glyphs
(system fonts are unavailable to WebGL), so offline is dots-only today — bundling Noto Sans PBF is
~2–3 MB. CSS module split (only after a build step). `map.js` single-file size. Shrinking git
history of `data/paths/` (~274 MB) needs a destructive `git filter-repo` + force-push.


### #F2c — live cloud, the two real jobs

**1. `Now`'s ~15 s first load.** See "Open, measured, not fixed" immediately above — read it before
touching this, the August diagnosis there was wrong and the byte budget has since been measured.
Short version: 13.5 MB of the ~16 MB cold start is the clear-sky reference, the timestamp-rounding
fix for it is a measured dead end, and the `compose()` row-mapping blocker is solved but unapplied.
Verify anything here with `fullpreview.js` before shipping — build a fresh scene, change one thing,
`cmp` the two PPMs (HANDOFF §10A.10) — and any change to the reference with `bgtest.py` over land
at dawn.

**2. Evaluate a non-GIBS imagery source.** GIBS is NASA's *archive and visualisation* service, not an
operational weather feed — zoom.earth and AccuWeather do not use it. We do, because it was the only
source verified to work from a browser with CORS, no key, and one request. It is 18–50 min behind and
drops roughly one request in five (HANDOFF §3, §10A.7).

In order, and **report what you measure before writing any code**:

1. **Confirm `rammb-slider.cira.colostate.edu` is reachable** — it and `www.accuweather.com` were
   added to the allowlist at the very end of 2026-08-19 and were still blocked in that session.
   CIRA's SLIDER serves GOES *and* Himawari at roughly 5 minutes' latency. **It is also the only
   known route to a true-colour Himawari**, which is the one thing that would close `Photo`'s
   greyscale band — but its tiles are in the satellite's own fixed-grid projection, not Web Mercator,
   so it is a **reprojection job, not a source swap**. Establish that before promising it.
2. **Find out what shape it is.** Expect pre-rendered JPEG tiles on a directory-style URL scheme —
   *not* WMS, so no `BBOX`. Note HANDOFF §10A.9: `addProtocol` once produced provably correct data
   that never displayed and the cause was never found. The fault was in the display wiring, not the
   data path. `Photo` now uses `addProtocol` successfully for retry, so that ground is less unknown
   than it was.
3. **CORS decides how far it goes.** Without permissive headers we cannot read pixels — but `Photo`
   only *displays* pixels, so SLIDER may serve `Photo` even where it cannot serve `Now`. And
   `sat.php` already exists as a same-origin proxy if reading is needed (HANDOFF §10A.7b).
4. `www.accuweather.com` was allowlisted so you can see what they actually pull instead of guessing.

---

## FEATURES — HARD
- **Greatest duration for ALL eclipses (not just the 94).** ⇒ **Handoff exists:
  `docs/GREATEST-DURATION.md` — read it first, don't re-derive any of this.**
  Greatest eclipse ≠ greatest duration: GE is where the axis passes closest to the Earth's
  *centre*; longest totality is elsewhere. Espenak's `duration_secs` is the duration at GE,
  not the maximum. Measured on 25 modern eclipses: median +0.07 s (negligible) but max
  +49.8 s and up to 10,686 km away (2002-06: GE 22.8 s → 72.6 s). So "where and when is this
  eclipse at its longest" is a real, unanswered question, and not one click away on Jubier.
  DONE already: the 94 eclipses with *no central line* (`tools/noncentral_durations.py`,
  surfaced by `details.js:maxDurationRows()`). This item is the general case.
  The hard part is NOT the astronomy — `totality_seconds()` already gives duration at a
  point, validated to 40 ms against Espenak on observed-ΔT eclipses. The hard part is a
  trustworthy *global search*: the duration surface is a long curved ridge along the central
  line, and the hill climb used for the 94 can stall on it or wander. Handoff §5 proposes
  parametrising by time along the central line (1-D scan) instead of searching lat/lon (2-D).
  Also decide storage: 3 fields × 11,900 records ≈ 400 KB on an index.json that already
  loads at startup — may belong in the Besselian chunks instead. Budget hours, make it
  resumable, and spot-check 2017-08-21 / 2024-04-08 against published values first.
- **Path unification — all curves on one implicit-field engine (architectural vision).** Every
  path = the zero level set of a scalar field evaluated at each ground point's own moment of
  greatest eclipse, traced by one shared predictor–corrector:
    green     = {sun altitude at max = 0}        (DONE — sub-km)
    umbra     = {ever-total depth = 0}           (current: perpendicular_limits + analytic dispatch)
    penumbra  = {max magnitude = 0}              (prototype ~9 km)
    mag isolines = {max magnitude = c}           (enables Jubier's 0.2/0.4/0.6/0.8 curves free)
    centreline = ridge of the depth field        (max-finder, not a zero — mild extra work)
    terminator/sunrise-set = intersection of two conditions
  One engine parameterized by field + level (+ intersection mode) replaces the current
  hodgepodge. PHASED: migrate one curve at a time, validate, swap in only when it beats the
  incumbent everywhere. Suggested two-branch discipline: freeze the shipped generator
  (bugfix-only) as stable truth; develop the unified engine as experimental successor.
  ~4–6 phased sessions. Next phase: penumbra onto the engine.
- **#F2c Live cloud — FINISH IT.** Working and shipped-ish; HANDOFF §10A has the whole model,
  every trap, and the harness. Remaining, in the order they matter:
  1. **The visible band by day, to ADD low cloud.** Measured 2026-08-18 against EUMETSAT's
     operational mask over three scenes: **the layer finds only ~49% of the cloud, and 30–41%
     of it over sea, at a 1–2% false-alarm rate** (HANDOFF §10A.8 has the table). So it is not
     mis-tuned — it is blind to cloud near the surface temperature, and **the map therefore
     reads clearer than reality**, which is the dangerous direction for a tool that tells
     someone where to stand. A total eclipse is always in daylight along the track and
     `hasNight()` already knows the terminator.

     **BUT: the visible band was tested 2026-08-18 and does NOT contain the missing cloud, and
     neither does a sea-surface-temperature reference. Both are dead ends — read HANDOFF §10A.8
     before touching this.** The missing cloud is dark in visible and sits at 0.0 °C depression in
     infrared, i.e. invisible to both. The mask has only four classes — clear over water, clear over
     land, cloud, not processed — so "it is only partial cloud" does not explain it. **The 49%
     figure is real and no cause is known.** Do not start from a theory; start from the three
     measured facts in §10A.8.
  2. **Speckle at high zoom** — the clear-sky grid is 39 km under 4 km imagery. Raising `BG_W`
     to 2048 is the low-risk half (0.18°, ~46 MB across five satellites; 4096 is 185 MB and not
     viable on a phone). Making the grid follow zoom is the thorough fix and is the riskiest
     change left — §10A.4 records that a non-world grid is what produced the "Minecraft blocks",
     and the cache would have to key on the box.
  3. **Cache-friendly URLs.** Every pan is a fresh bbox, so nothing is ever reused from the
     browser cache. Snapping the fetch box to a grid fixes it but moves the geometry `compose`
     and `place` receive — verify through the harness (§10A.10) before shipping.
  4. **A fresher GOES than GIBS.** ~20–40 min is GIBS's floor. CIRA RAMMB SLIDER (~5 min) and
     NOAA's AWS ABI buckets are the candidates; neither is tested, and the assistant needs
     `rammb-slider.cira.colostate.edu` in its egress allowlist to measure it (§10A.7).
  5. **PARKED — cloud above 65°N.** The Greenland leg of the 2026 track is blank and stays
     blank. Geostationary cannot see it; polar orbiters can, and **the obvious way of using
     them was tested on 2026-08-18 and does not work** — the thermal data and its colour maps
     are good, but the temporal clear-sky reference is meaningless for a satellite that
     revisits at a different local time each pass, and a deeper background made it worse
     rather than better. Full numbers in HANDOFF §10A.8b; **read it before picking this up.**
     The untested route is `VIIRS_*_Cloud_Top_Height_*` / `MODIS_*_Cloud_Top_Temp_*`, where
     NASA has already done the detection with a bispectral test — that is a *second detector
     feeding the same renderer*, not an extension of the existing one, and should be scoped as
     its own feature. A hole reads as clear sky, so whatever ships must be checked against that
     rule too.
- **#F2b Cloud-cover — the FORECAST half. STARTS FROM SCRATCH.**
  **SCOPED 2026-09-13. The quota objection below was the wrong arithmetic — read this first.**
  The 19,200-point figure came from gridding the path's BOUNDING BOX (120°×40° at 0.5°). The
  feature does not need a box, it needs a CORRIDOR: ~100 samples along a 10,000 km path × 3 across
  the width ≈ **300 points**, ~60× cheaper. At 10,000/day that is ~3% of one render, and the quota
  is **per user IP** — the calls run in the browser, so it is the chaser's allowance, not the site's.
  Corridor sampling is what makes this fit; do not re-derive it from a bounding box.
  **`api.open-meteo.com` was added to the container allowlist 2026-09-13 but AFTER that session's
  network was fixed, so it is still untested from a container. First job next session: curl it.**
  Two unknowns, both answerable in an hour with the host reachable:
  1. Does the free tier permit a public site like followtheshadow.com, or is it non-commercial only?
     Licensing, not technical, and it is the one that can kill the feature outright.
  2. Does one request accept many coordinates, or does `calculateQueryWeight()` still charge per
     location and sum? That decides 300 calls vs a handful.
  **What it should look like (agreed with the user 2026-09-13) — build this shape or none:**
  a third cell on the `Average | Now` strip, live only inside ~a week of the eclipse. It recolours
  the **corridor only**, each point shaded for **its own local maximum**, so the far end of the path
  shows its afternoon while the near end shows its morning. The details panel swaps climatology for
  the forecast at that spot's actual totality time. And the line that justifies the whole feature:
  **the clearest point on the path within a few hours' drive, and how far.** That is the chaser's
  real decision and nothing else on the internet can answer it, because no weather service knows
  where the path is.
  **What NOT to build:** a single forecast number for the user's location. Every weather app does
  that better, with radar and hourly detail and a brand the user already trusts. As a one-location
  readout this feature is an inferior copy and should not ship at all.
  *Prior history:* `js/forecast.js` and `tools/checks/test_forecast.js` were written 2026-08-15,
  never wired into `index.html`, never committed, and are **lost** — confirmed against git
  2026-08-18. `test_forecast` has been removed from `run.js`. What was learned before they vanished:
  Open-Meteo's own `calculateQueryWeight()` charges **at least one call per location, and
  locations sum** — batching 400 points into one request was 400 calls, not one. 600/min,
  5,000/hr, 10,000/day, per-user-IP because the calls run in the browser.
  The original framing, still correct: **Inside about a week of an eclipse, switch to live
  forecast data if a freely available source exists** — no key, no quota, cacheable for
  offline. That week is when a chaser commits to travel, and climatology is worthless at
  that range: a 40%-cloudy-in-August average tells you nothing about next Tuesday. The
  handover should be driven by days-to-eclipse. Rendering is solved twice over — `js/cloud-average.js`
  owns a canvas layer, a palette and a point sampler, `js/cloud-now.js` owns a live overlay
  and the `Average | Now` strip is a third cell away from carrying a forecast (§10A.1).
  **The open question is entirely the data source**, and it is harder than the climatology one was: forecasts are current-state
  services with quotas, where ERA5 was a one-time static download. Do not start by writing
  code. Note the timing subtlety already solved for climatology (HANDOFF §10.2) applies here too —
  a forecast must be sampled at each point's own local maximum, not at greatest eclipse.
- **#F3 Animated shadow on globe with time slider** — **DECLINED 2026-09-13, see DECIDED AGAINST.**
  Scrub the umbra/penumbra across the map in real time. Distinct from the terrain-shadow scrubber that shipped:
  that scrubs *terrain* shadows at one place; #F3 animates the *umbra/penumbra footprint*
  sweeping the Earth. The terrain-shadow scrubber (`shadow-ui.js` `setShadowTime` owner) is a
  clean precedent for the time-plumbing.
- ~~**#F1c Poster — last broken bands.**~~ **FIXED 2026-09-16b** (HANDOFF §11.4).
- **#F1d Path data — §9.5 chords (generator). The user wants this fixed.** ~30 eclipses have a limb
  bridged by one straight step of 300 km+ (1979-08-22 south limit: 10.6°); it shows on the MAIN MAP
  too. Scan: any step >300 km in `umbra_n`/`umbra_s`. **First job: reconcile the contradictory notes**
  — HANDOFF §9 says `gen_eclipse_paths_13f.py` holds an unfinished cone tracer fix blocked on the N/S
  splitter; the LEGACY notes in this file say the cone approach was removed. Size the work only after
  that. **Safety plan the user agreed to in principle:** regenerate ONLY the affected eclipses in a
  sandbox, audit (`audit_paths.py`, `validate_paths.py`, Jubier where available), splice just those
  records into the chunks — every other record stays byte-identical. He is wary: weeks went into the
  generator. Note ~16 horizon-bounded grazers (807-02-11, 1547-11-12…) are real geometry, not chords.
- ~~**#F1b T-shirt poster — finish the geometry.**~~ **FIXED 2026-09-16a.** SHIPPED and usable (HANDOFF §11.4), but
  `tools/checks/test_tshirt.js` **fails 3 catalogue-wide assertions**: one band over 8% of the
  map, some bands drawn past their own limbs, some centrelines drawn where the band doesn't
  reach. All in the polar tail, all from the same root: near a pole the corridor's
  cross-section degenerates (for 2015-03-20 the last pair is 164° apart in longitude but 3.7°
  apart on the globe).
  **Before touching it, read HANDOFF §11.4 — two obvious-looking approaches were tried and produce
  visibly worse output.** And rasterise the SVG and LOOK; measuring polygon area cost days.
- **Splash images.** 28 PNGs, sizes in `icons/splash/README.md`, then add the `<link>` tags.
  One design exported at many sizes — or hand a master image over and have it generated.
  Cosmetic: without it iOS opens on the manifest background colour, which matches the app.

---

## DATA CORRECTNESS
- **#F7 ERA5 cloud vs observed cloud — MUCH SMALLER THAN THIS ENTRY ORIGINALLY CLAIMED, and
  probably not worth doing. Re-measured 2026-09-13.**

  **The original claim was wrong and is corrected here rather than deleted, because the mistake is
  more instructive than the item.** It asserted a systematic ~15-point compression (too cloudy over
  Spain, too clear over Iceland) and put itself at the top of the priority list on that basis. That
  came from reading colours off a JPEG of Anderson's map by eye. It does not survive contact with
  his PUBLISHED NUMBERS:

  | place | Anderson (text) | ours | error |
  |---|---|---|---|
  | Spain centreline | ~35% | 39% | +4 |
  | Zaragoza / Ebro | "below 30%" | 32% | ~+2 |
  | Soria-Logrono | 35-45% | 42% | inside |
  | Reykjavik | 71% | 77% | +6 |
  | Ittoqqortoormiit | 65% | 66% | +1 |
  | Scoresby Sund (deep) | 45% | 57% | +12 |
  | Taymyr coast | 75% | 81% | +6 |

  Mean error ~5 points, mixed sign, no systematic compression. **Anderson explicitly warns against
  reading his own colours** — of Figure 8 he writes that the colours "seem to promise dismal
  prospects for the mountains, but the actual measurements range from 35 to 45 percent". That is
  exactly the trap, and it was fallen into twice in one session.

  **If it is ever picked up**, the route is known and it is NOT a fitted bias curve:
  - Anderson's source is named on every figure: **CM SAF / EUMETSAT**, polar-orbiting satellites.
    That is **CLARA-A3**, and it is on the **Copernicus CDS** — the same account and the same
    `cdsapi` already used for ERA5. Dataset `satellite-cloud-properties`, family CLARA-A3, origin
    EUMETSAT, 0.25 deg (finer than our 0.5). Licence is plain **CC-BY** since 2 July 2025, so it
    needs an attribution line, which Anderson himself gives as "Data: CM SAF/EUMETSAT".
  - **The blocker is TIME OF DAY.** CLARA comes from polar orbiters with fixed overpass times, so it
    exists only as monthly or daily means — there is no hour-of-day breakdown and there cannot be.
    Our whole pipeline is 8 local-solar-time slices, and that is not decoration: **measured, Burgos
    swings 54% at dawn to 37% at midday, a 17-point spread**, larger than the error we would be
    fixing. Switching to CLARA buys ~5 points of accuracy and costs 17 points of diurnal signal.
  - A hybrid (CLARA for the level, ERA5 for the shape of the day) was considered and is NOT
    recommended without checking how CLARA's monthly means are actually built from its overpasses —
    scaling a full day to match an average of two overpasses is not obviously meaningful.

## PERFORMANCE / DATA
- ~~**Every asset downloads TWICE on a build change.**~~ **FIXED, SHIPPED AND VERIFIED ON THE LIVE
  SITE 2026-09-13 for the SHELL** (build 2026-09-14c: 31 of 53 CORE entries stamped, **0 files
  fetched twice, was 30**). The DATA half is untouched and unmeasured — see the end of this entry.
  The page requested `js/map.js?v=BUILD` while `CORE` listed `js/map.js` — different URLs, two
  network fetches — and `cache: 'reload'` forced a network hit even when the browser had the bytes
  a moment earlier. **Measured against the LIVE site: 30 of 53 CORE entries overlapped** (every
  `js/` file, `css/app.css`, `icons/mark-dark-512.png`).
  **The fix:** stamp exactly those at INSTALL time and precache them with `default`; everything else
  keeps `reload`. Two things make it safe and both must hold — `CACHE` carries `VERSION`, so each
  build has its own store and a stamped entry can never reach a later build; and `default` is only
  safe BECAUSE the URL is unique per build. **Do not relax the stamp while keeping the mode.**
  `CORE` itself is deliberately NOT rewritten (`test_hygiene` checks it by bare name) and
  `index.html` stays bare, because the shell fallback matches it literally.
  *The old note proposed dropping shell files from the install list altogether, relying on the
  fetch handler. Rejected: that trades a duplicate download for a first-visit offline hole.*
  **Two earlier attempts, still worth not repeating:** deferring the DATA precache to a post-load
  warm pass (fixed nothing for the shell); and a single-flight `fetchOnce()` keyed on the tag-free
  URL (cannot work — on a build change the page is controlled by the OLD worker while the NEW one
  installs in a separate scope, so they never share an in-flight map).
  **Still open:** the besselian/path chunks in `DATA`. Those were part of the original ~317-request,
  22 MB measurement and this change does not touch them. Re-measure before striking this item.
- **Path JSON size — curve thinning (RDP).** Full-loop traces + pole tips added points. Reduce
  size WITHOUT losing accuracy via Douglas–Peucker decimation per curve at ~200–500 m (far
  below visible-at-max-zoom). Apply to centreline + umbra limits; penumbra + terminators are
  candidates. Expected 30–60% smaller, zero visible change. Verify post-thin curves stay within
  tolerance (re-check tip cusps). Secondary: delta-encode coords before gzip.
- Drop or make-optional pre-1000 CE eclipses — cost/benefit on load/data shed.

---

## INFRA (durable; keystones of the offline goal)
- **Cache skew is a solved problem now, but only if the tool is used.** `node tools/set_build.js`
  rewrites `var BUILD` and all 20 `?v=` stamps together. Bumping BUILD by hand renames the SW
  cache while leaving every asset URL on the old string, and `sw.js` matches with
  `ignoreSearch: true`, so the old files keep being served. This cost a full session (HANDOFF
  HANDOFF §4). `test_hygiene` fails on drift.
- **Git-LFS vs GitHub-release bundle** for the large path-chunk files — decide before
  open-sourcing.
- **Open-source prep** — licensing/attribution for the **live stack**: MapLibre GL JS (BSD-3),
  deck.gl (MIT), Natural Earth (public domain), NASA Blue Marble, eclipse data (Espenak/Meeus),
  Terrarium DEM tiles (the shadow engine's source). (The dormant `cesium` branch additionally
  carries Cesium, Apache-2.0 — only relevant if that branch is ever shipped.)
- **Production bundling** (single JS/CSS) — optimization, not a blocker (SW precaches
  individual files fine).
- **"Download everything for the field" toggle** — a Settings option (while online) to precache
  the *full* paths set (~263 MB of paths; ~285 MB with the besselian data) so any eclipse, any era draws offline. Today the SW caches the
  1900–2100 range + all besselian; out-of-range eclipses draw offline only if viewed online
  first. Needs progress UI, quota handling, partial-failure recovery, clear-cache control.
  Build only if a real user asks.

---

## REFACTOR LEDGER
- **Pass A** ✓ — split inline script into `js/` modules.
- **Pass B** ✓ — event-driven AppState.
- **Always-selected eclipse** ✓ — removed deselect UI and most null branches.
- **map.js platform consolidation** ✓ (2026-07-11) — scattered `isWide()` branches collapsed
  into one declarative `PROFILE` (render + data settings, decided once). Two layout-only
  media queries left live intentionally.
- **Pass C** — deferred. Tackle when a feature/bug motivates it:
  - Init-time preconditions patchy: three "init-time only" early-returns exist because events
    fire before `selectNextEclipse` completes. Fix: wire selection before subscribers, or
    buffer events until init completes.
  - Search input still DOM-driven (not on AppState).
  - `map.js` still large/single-file (split deferred until a bug motivates it). The two dead
    functions once listed here, `corridorToPolygonData` and `sunArrowImage()`, are GONE —
    both went with the MapLibre renderer restore (b53dfc1). Verified 2026-09-02: no
    references anywhere in the tree. Nothing to clean up in a future map.js pass.
  - `AppState.on()` — **now has real subscribers** (`js/map.js` redraws, `js/cloud-average.js`).
    No longer speculative; leave it.
  - **Connectivity state** — now a real subsystem (post 2026-07-29 rewrite): active probe (3 s
    timeout, cache-busted, 15 s poll + event-driven, 3 s reprobe on failure), two-strike debounce,
    `_forceOffline`, and `applyOnlineState()` driving imagery, vectors and the pole filler. Still
    lives in `js/map.js`, not yet promoted to its own module. The stated trigger was a
    *second* connectivity-dependent feature. **Cloud climatology did NOT become one** — it is
    static files, precacheable, no connectivity logic at all. **#F2b (forecast) will be the
    real trigger**, since it genuinely needs online/offline handover. Do not promote before
    then; the module would have one consumer and imagined requirements.
  - **Comment cleanup pass on map.js** — several build-to-build war-story comments could be
    condensed now that the approach is settled.

---

## LEGACY GENERATOR NOTES — "ROAD TO PURITY" (SUPERSEDED; reference only)
> **⚠ Describes the older *cone-limit-splitter* approach (generator ~2026-06-21c).** The
> shipped generator now produces umbral limits via `perpendicular_limits` (with `dep_local`) +
> analytic `umbra_pts` dispatch + exact green-line termini (`_terminate_on_green`); the dead
> `cone_limit_split` was removed. The pole-kernel / sliver / threshold concerns below MAY be
> obsolete — **reconcile against current code before acting.** Preserved so the reasoning isn't
> lost.

1. **Pole kernel — 1522-class.** The (old) cone trace SPURS BACK near ±86°, so the limb folds
   at the pole. Fix idea: dense near-pole resampling / pole-aware corrector.
2. **Sub-resolution slivers — the 8** (|γ|≈1, lat 61–75°). Cone returned None on contours
   smaller than the 25 km step. Fix idea: scale-aware step + closure + min-length.
3. **Retire the envelope + guard + suppress-fold** — only after 1 & 2, with a full-catalog
   no-regression pass.
4. **Derive/remove threshold gates** — 50 km median, 30° fold, 20° accept, 150 km tip-trim,
   0.3° closure tol. Derive from geometry where possible.
5. **Optional perf — bound the runaway trace.** Low value now that imap_unordered stops the
   straggler stall.
