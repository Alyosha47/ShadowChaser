# QA — Corridor kink audit (2026-06-07)

**What:** systematic scan of the umbra corridor (`umbra_n`/`umbra_s`) for interior kinks —
the "kinky and weird" artifact first noticed on 2611-09-28. Feeds BACKLOG → "Corridor
sampling artifacts."

**Why kinks are bugs, not data:** an eclipse path is a smooth shadow on a sphere; there are
no real corners. Every corridor vertex is a true magnitude-1 point (verified separately), so
a sharp interior turn is the perpendicular-bisect method landing on a valid-but-displaced
boundary point — a sampling artifact, not a wrong location.

## Method
- Metric: worst **interior** turn angle (degrees) on the real `build_path` adaptive-walk
  corridor, endpoints excluded (path ends are grazing/degenerate and not the concern).
- Faithful, not proxy: a fast uniform-time sampling proxy was tried first and **rejected** —
  uneven time spacing manufactures false kinks (it over-reported ~40% of eclipses; the real
  rate is ~2–3%). Only the adaptive-walk corridor from `build_path` is trustworthy.
- Threshold: flag ≥ 20°. (Smooth eclipses measure ~0–3°, e.g. 2017-08-21 = 1°.)
- Scope this pass: **350 central eclipses** — all of 1901–2100 (262, complete) plus 88 of
  2601–2700 (partial). Pre-1900 and most far-future centuries NOT yet swept (build_path is
  ~2 s/eclipse → a full 5000-yr sweep is ~4 h; the modern era is what users hit and is
  representative).

## Result — prevalence ~2–3%
Kinks are **rare**, not pervasive. 8 of 350 audited flagged ≥ 20° interior:

| Eclipse      | Interior kink | Notes                                              |
|--------------|---------------|----------------------------------------------------|
| 1939-04-19   | **180°**      | Worst found — a full reversal. Best fix exemplar.  |
| 2611-09-28   | 98°           | The originally-reported case (N limit).            |
| 2097-11-04   | 90°           |                                                    |
| 2033-03-30   | 56°           |                                                    |
| 1979-08-22   | 31°           |                                                    |
| 1909-06-17   | 27°           |                                                    |
| 2026-02-17   | 23°           | Annular.                                           |
| 1932-03-07   | 21°           |                                                    |

Note: this is the **kink** metric (corridor smoothness). It is separate from the **tip
protrusion** metric — 2026-08-12 (the oval-tip case) does NOT appear here because its
corridor is smooth (~2.8°); its issue is along-track oval overhang, a different artifact.

## Takeaways
- The ~2–3% rate supports the **"polish, not correctness"** classification: the data is
  accurate everywhere; a handful of eclipses per century have a cosmetic corridor kink.
- **1939-04-19 (180°)** and **2611-09-28 (98°)** are the two cleanest test exemplars for any
  future fix (the guarded local kink re-solve in BACKLOG) — if a fix smooths both to the
  ~1–3° smooth baseline while leaving 2017-08-21 byte-identical, it works.
- Decision input for the envelope rewrite: this is an edge-case set (≈ a dozen across the
  swept span), not a systemic failure — weigh effort accordingly.

## To extend (optional)
Re-run the faithful audit (`build_path` interior worst-turn, threshold 20°) over the
unswept centuries to get a complete 5000-yr list. ~2 s/eclipse, ~140 central/century;
resumable. Not done here for time.
