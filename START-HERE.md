# START HERE — session handoff, 2026-08-20

**Read this whole file before you type anything to the user.** He should not have
to tell you where the repo is, what was done, or how he likes to work. It is all
below, and being asked is a direct cost to him.

`HANDOFF.md` is the project handoff and it is current. **§10A is the live-cloud
feature and it is long, because five days went into it.** This file carries only
what HANDOFF.md cannot: the state of the working copy, what is half-finished, and
how to work with this person.

---

## 0. THE FACTS YOU WOULD OTHERWISE ASK FOR

- **Repo:** `https://github.com/Alyosha47/ShadowChaser.git`
- **Branch: `main`.** `maplibre` and `cesium` were consolidated into `main` on
  2026-08-19 and `main` is now the default. If you find yourself on `maplibre`,
  your clone is stale. `cesium` is dead; it is tagged `archive/cesium`.
- **Clone deep, not shallow.** `--depth N` silently truncates history. I once
  told the user his branches had unrelated histories on the strength of a
  `--depth 3` clone. They did not. It cost him an hour of fear about losing
  months of work.
- **The app is deployed BY HAND.** The user uploads files to his own server from
  a local folder. GitHub Pages exists but is not the live site.
- **He does not edit files. You do.** Never hand him a patch, a diff, or an
  instruction to change a line. Produce the whole file, every time.
- **Live site:** followtheshadow.com

### Before any work

1. Clone fresh from `main`. `git log --oneline -5`. He applies changes by hand,
   so the repo may lag what he is actually running.
2. `npm i jsdom` once, then `node tools/checks/run.js`.
   **Expect exactly one failing suite: `test_tshirt`, with exactly 3
   assertions.** Everything else passes. The runner distinguishes `CANNOT RUN`
   (setup) from `FAIL` (regression) — if you see CANNOT RUN, fix that first.
   Three suites were once reported as failing for a week when they were only
   missing `jsdom`.
3. `node --check` on any JS you touch. There is no bundler; a syntax error ships.

---

## 1. NETWORK ACCESS — CHECK THIS FIRST, IT DECIDES HOW YOU WORK

Your sandbox can reach the imagery services directly. Verify before anything
else, because the whole working method depends on it:

```
curl -s -o /dev/null -w "%{http_code}\n" "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&REQUEST=GetCapabilities"
curl -s -o /dev/null -w "%{http_code}\n" "https://view.eumetsat.int/geoserver/wms?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0"
```

Both should be 200. A 403 with `x-deny-reason: host_not_allowed` means the
allowlist is stale — and **it appears to be fixed at session start, so a
mid-session addition does not take effect.**

**The user added `rammb-slider.cira.colostate.edu` and `www.accuweather.com` at
the very end of the last session; they were still blocked there. They should work
for you. Confirming that is the first job — see §4.**

Without direct access, every fact about a live service travels through the user
uploading a probe page and describing a screenshot. That loop is why one feature
took five days.

---

## 2. WHAT IS RUNNING

`BUILD 2026-08-20u`. `satellite.js 2026-08-20a`, `imagery.js 2026-08-20b`,
`cloudbar.js 2026-08-20a`.

The cloud overlay has **three modes** in one strip (`js/cloudbar.js`):

| mode | module | what it is |
|---|---|---|
| **Average** | `js/cloud.js` | ERA5 climatology, precached, works offline. Shipped 2026-08-11. |
| **Now** | `js/satellite.js` | Cloud *inferred* from geostationary infrared. A measurement. |
| **Photo** | `js/imagery.js` | The satellite picture itself, as MapLibre raster tiles. |

**All three work.** Photo was rebuilt on 2026-08-20: the hand-rolled compositor
is gone and MapLibre does the tiling. **Do not reintroduce a compositor for
Photo** — `Now` needs a canvas because it reads pixels to decode temperature;
Photo only displays them, and inherited the compositor by being written as a
copy of `satellite.js` (HANDOFF §10A.8c).

Fixed 2026-08-20, all in HANDOFF §10A — **do not go hunting for these again**:
Photo's mismatched-patch band down the Atlantic (extents, not tiles); the blank
slice over China (no satellite was assigned there); the greyscale hemisphere
(quality ordering); the blank hairline at 70.7°E; blank tile squares (MapLibre
never retries); EUMETSAT losing CORS (`sat.php`); and `viewBox()`'s globe branch,
which had never once executed.

Fixed 2026-08-19, also documented there: the dateline stripe (a GIBS bbox bug at **both** ±180 edges, not our
geometry); render 13× faster (`bgAt` was 89% of it); parallel fetch; cached frame
probe; globe-vs-Mercator fetch sizing; storms hollowing themselves out; polar
extrapolation; the ☁-off bug (in `cloud.js`, not `satellite.js`); the
blank-on-every-pan (assigning canvas width clears the canvas); and two kinds of
corrupt GIBS frame.

---

## 3. KNOWN-FAILING AND KNOWN-LIMITED — none of these are new bugs

- **`test_tshirt`: exactly 3 failures.** Long-standing, not yours. It needs
  jsdom — `npm i jsdom` in a fresh clone, or four suites report CANNOT RUN,
  which is a setup problem and not a regression.
- **Photo logs 404s in the console and they are CORRECT.** They are the frame
  probe walking back through frames GIBS has not published yet, about five per
  satellite per five-minute refresh. Measured 2026-08-20: GOES-West's newest
  frame was 19:30Z at 20:25Z, and 20:00 onward 404'd at every zoom — whole
  frames, not corner tiles. Do not "fix" this (§10A.8c).
- **`Now` finds only ~49% of the cloud** an operational mask finds, ~30% of it
  over sea, at 1–2% false alarms (§10A.8, three scenes). **The map reads clearer
  than reality** — the dangerous direction for a tool that tells someone where to
  stand. Two candidate fixes, a visible channel and a sea-surface-temperature
  reference, were **tested and are dead**. Read §10A.8 before proposing either.
- **Nothing above ~65°N in `Now`.** Geostationary cannot see it; the 2026-08-12
  track's Greenland leg is blank. Polar orbiters were tested (§10A.8b) and the
  obvious method does not transfer. Parked deliberately.
- **`Photo` is capped at 1223 m/px.** GIBS serves GeoColor from
  `GoogleMapsCompatible_Level7` and that is its maximum, so a city view is
  visibly blocky. **A source limit, not a bug. Do not try to fix it in our code.**
- **`Photo` is greyscale from 70°E to 153°E** — China, Australia, the Indian
  Ocean edge. GIBS has no true-colour Himawari product at all (WMTSCapabilities
  enumerated 2026-08-20: Air Mass, Band13 infrared, Band3 red visible). We use
  Band13 because Band3 is reflected sunlight and paints a black rectangle at
  night. The band is already the smallest the available products allow — the
  greyscale disc is painted underneath and the colour discs cover it back to
  their own limb (§10A.8c). **Closing it needs a different source, not a code
  change.** That is §4 below.
- **GIBS is stale and unreliable.** 20–60 min behind. On 2026-08-19 it served a
  GOES-East frame with a slab of the disc missing — filled *opaque white*, which
  decodes to −91.6 °C, the coldest cloud there is — and another that was 92.6%
  white. Both are now rejected by `partlyWritten()`. It also returns a blank
  frame for a valid request roughly 1 time in 5.

---

## 4. THE JOB WAITING FOR YOU

**First, and it is short: `Now` takes ~15 s on its first load.** It is the only
remaining defect a user in a field would notice, it is measured, and the obvious
fix has already been tried and reverted — read HANDOFF §3 "Open, measured, not
fixed" before touching it, because the trap is that `background()` builds its
clear-sky field against the VIEW box.

**Then: evaluate a non-GIBS imagery source.** This is the single change that improves
every complaint the user has: freshness (GIBS 20–60 min against ~5 for
operational feeds), resolution, and reliability.

GIBS is NASA's *archive and visualisation* service, not an operational weather
feed. zoom.earth and AccuWeather do not use it. We do, because it was the only
source verified to work from a browser with CORS, no key, and one WMS request.

In order:

1. **Confirm `rammb-slider.cira.colostate.edu` is reachable** (§1). CIRA's SLIDER
   serves GOES *and* Himawari at roughly 5 minutes' latency. **It is also the
   only known route to a true-colour Himawari**, which is the one thing that
   would close Photo's greyscale band — but its tiles are in the satellite's own
   fixed-grid projection, not Web Mercator, so it is a reprojection job and not a
   source swap. Establish that before promising it.
2. **Find out what shape it is.** Expect pre-rendered JPEG tiles on a
   directory-style URL scheme in its own projection — *not* WMS, so no `BBOX`.
   That means placing tiles rather than compositing one image, closer to
   `addProtocol` than to what `imagery.js` does now. Note §10A.9: `addProtocol`
   once produced provably correct data that never displayed, and the cause was
   never found. The fault was in the display wiring, not the data path.
3. **CORS is the question that decides it.** Without permissive headers we cannot
   read pixels — but **`Photo` does not read pixels, it only displays them**, so
   SLIDER may serve `Photo` even if it cannot serve `Now`.
4. `www.accuweather.com` was allowlisted so you can see what they actually pull
   instead of guessing.

**Report what you measure before writing any code.** He has been burned
repeatedly by work started on an assumption.

Everything else outstanding is in `TODO.md` under `#F2c`, in priority order.

---

## 5. HOW TO WORK WITH THIS PERSON — read this twice

His standing instructions are in his settings and he should not have to repeat
them. He did, roughly ten times in one session, and it cost him money as well as
patience.

- **BE CONCISE. His default is 40 words.** When he says `tldr` he means it — he
  said it six times in one session and I overran every time. **Verbosity is
  billed to him.** A long explanation of a failure is still a failure.
- **Never tell him to stop, pause, or bank progress.** `NEVER GIVE UP` is a
  standing instruction, and suggesting he stop is the failure that ended two
  previous sessions. If something is cheap to check, **check it** — do not offer.
- **Never guess.** Enumerate, measure, or say you do not know. Every wrong turn
  in this feature came from reasoning about the shape of the code; every finding
  that held up came from a number.
- **Never describe or interpret his screen.** Instrument the page, ask for the
  number, act on the number.
- **Do not throw away working solutions.**
- **Do not make UI or default decisions unilaterally.** Present the trade-off.
- **Own mistakes plainly and briefly.** He responds well to a straight admission,
  badly to hedging, and does not want grovelling either.
- **Do not go down rabbit holes.** He asked "is it worth it"; I answered with one
  number and then spent an hour on three hypotheses he had not asked about, two
  of which I disproved myself. Answer the question asked. Offer the next step.
  Let him choose.

---

## 6. HOW TO ACTUALLY FIND BUGS HERE — the method that works

**Look at the output. You can.** The container has PIL and the `view` tool
renders a PNG. Sixty versions were shipped across three days without anyone
looking at a rendered composite. The first time it was done it immediately showed
a defect no description would have produced.

The harness is in `tools/checks/` and it is the point:

- `mkframes.py LON LAT ZOOM out.json` — fetches a real multi-satellite composite
  for that view, exactly as `satellite.js` builds it.
- `fullpreview.js out.json out.ppm` — runs the **shipped** `compose()` on those
  pixels, reports drawn percentage and empty columns, writes an image. Convert
  with PIL and **open it**.
- `mkphoto.py` / `photopreview.js` — the same pair for `Photo` mode.
- `test_imagery.js` — drives `Imagery.on()`/`off()` against a fake map and fake
  network. **Write one of these before shipping a module, not after.** `Photo`
  shipped verified only by compositing pixels offline, where no map object
  existed — and the map call was the one thing that was broken.

**The byte-compare is the regression test, and it is within-session.** Build a
scene, change one thing, render again, `cmp` the two PPMs. Identical means safe;
any difference must be explainable before shipping. Nothing survives between
sessions — the frame JSON is ~64 MB and live imagery is stale within minutes.

Scenes worth building, each of which has caught something real:
`mkframes.py 175 20 2.2` (dateline), `-112 40 4.2` (North America),
`150 -68 1.6` (south polar), `-88 22 5.0` (high-zoom convection).

**When the harness and the module disagree, check the harness first** — two
rounds were once spent hunting a defect that existed only in the test. And keep
them in step: `BG_FRAMES` was changed in the module and not in `mkframes.py`, so
the shipped configuration had never once been through the harness.

**Both live modules report phase timings.** `Satellite.diagnose().timing` and
`Imagery.diagnose().timing` give `{probe, img, decode, compose, total, px}`. Ask
for the number rather than theorising: this found the 89% `bgAt` cost and the 91%
probe cost, both of which had been optimised in the wrong place first.

---

## 7. DEPLOY

`HANDOFF.md` §4 has the checklist. In short: replace files → `node
tools/set_build.js` → `node tools/checks/run.js` → hand over **every** changed
file **including `index.html`**.

**Bumping BUILD is not optional.** The service worker is cache-first with
`ignoreSearch`, so without a bump his browser serves the old files and a whole
session's work appears to do nothing. That has happened for real. Use
`tools/set_build.js`; never edit the stamps by hand.
