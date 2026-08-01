# GREATEST DURATION — handoff for the all-eclipse calculation

Status: **not started.** This documents a feature we deliberately deferred, and
the groundwork already in the tree. Written 2026-07-28.

---

## 1. What already shipped (and what didn't)

Shipped: `tools/noncentral_durations.py` computes the longest totality for the
**94** eclipses that have *no central line*, writes three sparse fields into
`data/index.json`, and `details.js:maxDurationRows()` surfaces them.

Deferred: computing greatest duration for **all ~11,900** eclipses.

The two were deliberately kept apart. The 94 fix a visible falsehood (a
`00m00s` where minutes of totality exist). The all-eclipse version is a new
feature with a much higher validation burden. Don't entangle them.

## 2. Why the bigger calculation is worth doing

**Greatest eclipse ≠ greatest duration.** Greatest eclipse is where the shadow
axis passes closest to the Earth's *centre*. Longest totality is somewhere else
entirely — a different question with a different answer. Espenak's canon treats
them as separate quantities; `duration_secs` is the duration at greatest
eclipse, not the maximum.

Measured on 25 modern eclipses by hill-climbing from GE:

```
extra seconds vs GE:   median 0.07s    max 49.8s
distance GE → max:     median 190 km   max 10,686 km

2002-06   GE 22.8s  ->  72.6s   (+49.8s, 7681 km away)
1999-02   GE 39.6s  ->  78.6s   (+39.0s, 9550 km away)
```

Usually negligible. Occasionally a minute, most of a hemisphere away. "Where and
when is this eclipse at its longest?" is a question eclipse chasers genuinely
ask, and it is not one click away on Jubier.

**Treat those numbers as indicative, not established.** They came from a hill
climb, and the multi-thousand-km excursions are plausible but unverified — see
§5.

## 3. The machinery that already exists

- `js/eclipse.js` — the Besselian engine. `computeEclipse(rec, lat, lonEast,
  altMetres)` returns `durCentral` (seconds of totality/annularity) among much
  else. UMD, so it also `require()`s cleanly under Node.
- `tools/noncentral_durations.py` — a faithful Python port of the same maths
  (`fundamental_args`, `find_maximum`, `find_contact`), plus:
  - `totality_seconds(rec, lat, lon)` — the objective function you want.
  - `refine(rec, lat, lon, step)` — pattern search, shrinking to ~1 m.
  - `limb_seeds(rec)` — geometric seeding for non-central cases.
  - `validate()` — the correctness gate. See §4.
- Data: `data/index.json` (11,898 records, with `_chunk`), and the Besselian
  elements in `data/besselian/<chunk>.json`.

The Python and JS produce identical results; that agreement is itself the check
that the port is faithful. If you change one, re-check the other.

## 4. Validation — read this before trusting any number

`validate()` compares our duration at greatest eclipse against Espenak's
`duration_secs`, **grouped by ΔT source**. Grouping is essential:

```
ΔT source                                n    median   within 1s
Espenak-Meeus                         3839    0.187s       72.6%
SMH2016 LOD extrapolation             1320    2.033s       42.5%
SMH2016 LOD extrapolation (ancient)    453   31.946s        6.0%
USNO observed                           74    0.040s      100.0%  <- gate
USNO predicted                          12    0.072s      100.0%  <- gate
USNO observed (nearby)                   1    0.022s      100.0%  <- gate
```

**The low figures are not bugs.** This project deliberately replaced Espenak's
ΔT with better sources (see Settings → Sources). Espenak computed
`duration_secs` with his ΔT; we evaluate with ours. A ΔT difference rotates the
Earth under the shadow, sliding the evaluation point off the central line, so
the duration measured there collapses. Disagreement is the ΔT upgrade *working*.

Proof, if you doubt it — restoring a ΔT offset recovers Espenak's value exactly:

```
-947-11   Espenak 511.9s   ours 93.8s   ->  511.9s with ΔT +1060s
-798-11   Espenak 653.2s   ours 239.0s  ->  653.1s with ΔT +1020s
-1127-07  Espenak 490.8s   ours 117.7s  ->  490.8s with ΔT +1180s
```

And within the Espenak-Meeus rows, agreement degrades monotonically with |ΔT|
and nothing else — 100% below 38s of ΔT, 30% above 13,000s.

**So: gate on the USNO rows only.** There ΔT is observed, we and Espenak use
effectively the same value, and any disagreement is genuinely ours. It currently
reads 100% of 87 within 1s, median 40 ms. If that ever drops, the maths broke.

## 5. The hard part — a trustworthy global search

`refine()` is a hill climb. For this feature it is **not sufficient**, because:

- The duration surface has a long curved ridge along the central line. An
  axis-aligned pattern search can crawl the ridge slowly, stall on it, or wander
  thousands of km without reaching the true peak.
- The 7,000–10,000 km excursions in §2 are exactly the cases where you cannot
  tell "found a better distant maximum" from "wandered".
- Annular and hybrid eclipses can have duration maxima at both ends of the path.

Suggested approach, in preference order:

1. **Parametrise by time, not by lat/lon.** For each instant in `[tmin, tmax]`,
   the central line point is where the axis pierces the ellipsoid — solvable
   directly from the elements (invert the transform as `limb_seeds()` does, but
   with ζ from the sphere/ellipsoid intersection rather than ζ = 0). That turns a
   2-D search into a 1-D scan along the track, which is both fast and complete.
2. Scan that line at fine time steps, then golden-section refine around the best
   few local maxima — plural, because of the two-ended case.
3. Only then refine perpendicular to the track, which should move the answer
   very little if step 1 was right (the central line *is* the ridge).

For the 94 non-central eclipses there is no central line, so `limb_seeds()`
remains the correct seeding strategy — keep both paths.

**Cost:** ~11,900 eclipses. Budget hours, not minutes, and make it resumable —
write partial results as you go.

**Cross-check:** Espenak publishes greatest-duration figures for modern eclipses
in places other than the canon's `duration_secs`. Spot-check a handful of
well-known ones (2017-08-21, 2024-04-08) against published values before
trusting 11,900 numbers.

## 6. Storage and UI when you get there

Follow the pattern already set:

- Sparse fields in `index.json`, never overwriting `duration_secs` — that is
  Espenak's answer to a different question and must stay attributable.
- Current field names for the 94: `max_duration_secs`, `max_duration_lat`,
  `max_duration_lon`. If the all-eclipse version supersedes them, migrate
  deliberately; don't leave two overlapping conventions.
- `index.json` is 4.5 MB and loads at startup. Three fields × 11,900 records is
  roughly 400 KB — no longer negligible. Consider whether it belongs in the
  Besselian chunks (loaded on demand) instead, and accept that the detail panel
  would then need the chunk before it can render the row.
- `details.js:maxDurationRows()` is where it surfaces. Its comment already
  points here.
- Consider a distinct map marker for the greatest-duration point. Do **not**
  move the GE diamond: greatest eclipse is a defined catalogue quantity and
  relocating it would put us at odds with every other source.

## 7. Things that will bite you

- **`sun_alt = 0.0` at GE for non-central eclipses is correct**, not a data
  error. The axis misses the Earth, so the closest point is on the limb, with the
  sun exactly on the horizon. `computeEclipse` correctly returns
  `{visible:false}` there. Any search seeded only at GE will find nothing.
- **Longitude is west-positive inside `fundamental_args`**, east-positive at the
  public boundary. The wrapper flips it. Get this wrong and everything is
  mirrored.
- **`L' = L − ζ·tan f`** — the shadow radii must be corrected for the observer's
  distance along the axis. Omit it and durations are quietly wrong.
- **ΔT enters via the hour angle**, as `0.00417807 °/s × ΔT_seconds`. This is why
  ΔT differences show up as position errors rather than timing errors.
- Ancient longitudes carry real ΔT uncertainty. Ours are *better* than the
  canon's, but they are not exact, and no one's are.
