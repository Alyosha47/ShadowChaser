# What each file in "data build tools" does

Written 2026-08-31. Nothing here runs in the app — these build the data files
in `data/` that the app then reads.

---

## Eclipse paths

**gen_eclipse_paths.py** — the big one, and the source of truth for the maths.
Turns Besselian elements into every curve the app draws: centreline, umbral
limits, umbral footprints, penumbral limits, terminators, greatest eclipse.
Writes `data/paths/paths_*.json.gz`. Everything else that needs eclipse
geometry imports from here rather than reimplementing it.

**gen_eclipse_paths_13f.py** — an older version, kept as a reference (version
stamp 2026-07-13f). Not used by anything.

**validate_paths.py** — checks our path curves against Jubier's KMZ files.
Works for totals, annulars, hybrids and partials.

**validate_terminators.py** — the same idea for the sunrise/sunset curves.

**inspect_term_gaps.py** — small diagnostic. Looks for suspiciously big jumps
between neighbouring points in a terminator polyline.

**noncentral_durations.py** — fills a gap in Espenak's catalogue. When the
shadow axis misses the Earth entirely there is no central line, so the
duration field is 0 even though totality does happen somewhere on the limb.
This works out the real answer for the 94 eclipses affected.

---

## Catalogue and time

**espenak_5000.csv** — Espenak's five-millennium catalogue. The raw input.

**split_eclipse_data.py** — splits that CSV into per-century JSON chunks plus
an index, so the app can load a century at a time.

**delta_t.py** — a library, not run directly. All the ΔT (TT − UT) maths for
−1999 to +3000. The only file to touch if the ΔT formula ever changes.

**verify_dt.py** — run before anything ΔT-related. Spot-checks `delta_t.py`
against known reference values. Needs no data files or network.

**update_dt.py** — patches ΔT values into the century chunks, taking the best
available source for each date: USNO observed, USNO predicted, then the
Espenak–Meeus polynomial.

**deltat.data.txt / deltat.preds.txt** — the USNO observed and predicted
tables that `update_dt.py` reads.

---

## Countries

**name_countries.js** — the country outlines shipped with empty properties;
the names were lost when the file went through the antimeridian package. This
puts them back. Everything country-related depends on having been run.

**split_remote_units.js** — separates overseas territories from their parent
country. Natural Earth's "France" includes French Guiana, so `total france`
was matching an eclipse over South America.

**gen_country_index.js** — the original builder for `country_index.json.gz`.
Still the reference for what the file means: value = obscuration in 5% steps
(4..20, where 20 is 100%), and a negative value means the central path crossed
that country. **Its central-path test is the bug we spent this week on** — see
below. Its obscuration sampling used a 3° grid, which steps over peaks.

**repair_country_index_longitudes.js** — a one-off repair run 2026-08-29 for
the antimeridian corridor bug. Kept for the record only.

---

## Countries — the replacements (added 2026-08-30/31)

These replace what `gen_country_index.js` did, computed from the physics
rather than from corridor polygons.

**central_countries.py** — decides, per eclipse, which countries the umbra
actually crossed. Maximises eclipse magnitude over each country's area; the
country is central if the peak reaches 1.0. Builds no corridor polygon, so
none of the old failure modes exist. Writes `data/central_countries.json.gz`.

**verify_central.py** — audits those verdicts one at a time, the slow way:
interior grid plus every border vertex, then a climb. Used to check the
result rather than to produce it.

**apply_central.py** — writes just the central flags into an existing
`country_index.json.gz`, leaving the obscuration numbers alone. Superseded by
`build_country_index.py` but harmless.

**obscuration_countries.py** — the fast obscuration builder. Starts from the
same 3° grid the old code used, so it can never do worse, then climbs uphill
and walks the coastline to find the true peak. Writes per-century parts, then
merges. Roughly 13 hours on one core; use `--jobs`.

**obscuration_brute.py** — the same answer with no cleverness at all. Measures
every 0.4° grid node and every border vertex in every country. Slower (about
20 hours on 6 cores) and exists to check the fast version, not to replace it.

**compare_obscuration.py** — diffs the two obscuration tables and lists
disagreements. Anything it flags is a real bug in one of them.

**audit_obscuration.py** — takes a random sample of entries where the new
table went *lower* than the old one and brute-forces the truth, so you can see
which table was right.

**build_country_index.py** — assembles the final `country_index.json.gz` from
the obscuration table and the central table. Run with `--dry-run` first.

---

## Cloud overlay

**gen_cloud_climatology.py** — downloads ERA5 cloud cover as a 1991–2020
climatology for one month and collapses it into 8 local-solar-time slices.

**encode_cloud.py** — turns those into the WebP tiles the app loads.

---

## Reference material

**Fifty_Year_Canon_of_Solar_Eclipses.pdf** — Espenak reference document.

**jubier_1994.json / jubier_1999.json / jubier_2017.json** — Jubier's curves
for three eclipses, used by the validation scripts as ground truth.

**how to run century-splitter.txt** — notes on the ΔT and splitting workflow.

**how to run local site.txt** — `python3 -m http.server 8000` from the repo
root, then localhost:8000.

---

## Normal order of things

Catalogue and time first, then paths, then countries:

1. `verify_dt.py` → `update_dt.py`
2. `split_eclipse_data.py`
3. `gen_eclipse_paths.py`, checked with `validate_paths.py`
4. `name_countries.js`, `split_remote_units.js`
5. `central_countries.py` and `obscuration_countries.py`
6. `build_country_index.py`

Cloud is independent of all of it.
