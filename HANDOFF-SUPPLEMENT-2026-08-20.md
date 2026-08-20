# HANDOFF SUPPLEMENT — 2026-08-20

Append to HANDOFF.md. Covers §4 (Photo) and the parts of §10A (Now) that changed.
Written after a long, bad session: read the **Traps** section before touching
anything, because three of today's regressions were re-discoveries of things that
were already known or already tried.

Final build of the session: **`2026-08-20r`**.
Files that ship: `index.html`, `js/imagery.js`, `js/satellite.js`,
`js/cloudbar.js`, `sat.php`.

---

## 1. Photo is now MapLibre raster tiles, not a compositor

`js/imagery.js` went from 758 lines to ~300. The hand-rolled compositor is gone.

**Deleted:** `compose()`, `readPixels()`, `hasContent()`, the dateline split, the
weight blend, night-alternate machinery, the lit-fraction gate, the JPEG black
test, desaturation, the whole-globe wrap.

**Replaced by:** one MapLibre `raster` source per satellite. GIBS discs use the
cached WMTS path (`/wmts/epsg3857/best/{layer}/default/{time}/GoogleMapsCompatible_Level{n}/{z}/{y}/{x}.png`);
EUMETSAT uses a `{bbox-epsg-3857}` WMS template through `sat.php`.

Tiling, caching, wrapping past the antemeridian, progressive zoom and pan are now
the platform's job. Every symptom that cost days — 20-second pans, bare limb, the
antemeridian seam, black wedges, ragged terminator, speckle — came from the
compositor and disappeared with it.

**Why Photo never needed it:** `Now` reads pixels to decode infrared into a
temperature and genuinely requires a canvas. Photo only ever *displays* pixels.
It inherited the compositor by being written as a copy of `satellite.js`.

**Measured:** WMTS vs WMS at browser-like concurrency (24 tiles, 6 at a time):
WMTS 1.6s / 0 blanks, WMS 3.3s. GIBS WMS renders every tile on demand; at low
zoom MapLibre asks for hundreds, they fill the six-connection-per-host budget,
GIBS blanks under load, and **everything else queued behind them on that host** —
including `Now`'s requests. Never point Photo at GIBS WMS again.

---

## 2. `sat.php` — same-origin proxy (new file, site root)

**Why it exists:** on 2026-08-20 EUMETSAT stopped sending
`access-control-allow-origin` on GetMap. Verified by re-running the
byte-identical URL that had carried the header the previous evening: present on
GetCapabilities, absent on 10 of 10 GetMap calls across four endpoints, with and
without an `Origin` header. `Now` must read those pixels, so no header meant no
Meteosat and a blank central Africa.

Served from the site, a fetch to `sat.php` is same-origin and CORS never applies.

**It takes discrete WMS parameters, not a URL.** Two earlier shapes were refused
by Bluehost's mod_security *before reaching PHP*:
- `?u=https://…` — matches on the scheme.
- `?q=<long base64>` — matches on the opaque blob. A short `?q=abc` passed, so it
  was the blob, not the file.

Current interface:
- `sat.php?s={eum|gibs}&l={layer}&b={bbox}&w=&h=&t={ISO}` → image
- `sat.php?s=…&l=…&f=newest` → the newest published frame time, as text

Service and layer are chosen from **fixed allowlists inside the file**, so it
cannot be aimed anywhere else. Frames are immutable once published, so images are
disk-cached 15 min and frame-time answers 4 min.

**`f=newest` matters.** The client used to probe 8 candidate timestamps in
parallel — one round trip against GIBS, but 8 PHP processes per disc through the
proxy, 16 for two discs, and shared hosting runs only a handful at once. They
queued and `Now` took ~15s. Resolved server-side it is one request, cached.

**When EUMETSAT restores CORS,** `sat.php` can be bypassed by reverting the `eum`
branches in `url()` (satellite.js) and `wms()` (imagery.js). Keeping the proxy is
probably wiser — it also caches and it survives the next provider that does this.

---

## 3. Tile retry via `addProtocol` (the blank-patchwork fix)

**MapLibre never re-requests a failed tile.** GIBS drops roughly one request in
five (§3). One transient 404 therefore leaves a **permanent hole** until the
source is rebuilt — this was the map filling with blank squares.

Proven from a live console log: tiles that 404'd in the browser returned 200 from
a clean fetch seconds later, **including `z0/0/0`**, which covers the whole world
and cannot be a genuine gap. All zoom levels 0–7 return 200 on-disc.

Fixed with `maplibregl.addProtocol('sctile', …)` — MapLibre's own extension
point. Two retries with backoff; a tile still missing after that returns a
**transparent PNG**, not an error, because most remaining ones are real (a disc
is a circle, the tile grid is square). That also silences the console noise.

Covered by `test_imagery.js`: a tile failing twice then succeeding is recovered;
one that never succeeds yields a transparent PNG.

---

## 4. `viewBox()` — the globe branch had never run (satellite.js)

```js
var c = m.getCenter(), …;
var worldPx = …, m = 1 + 2 * MARGIN;   // ← m was the MAP; now it is a number
try { globe = !!(m.getProjection && …); } catch (e) {}   // always threw
```

`m` was reassigned from the map to the margin multiplier, so `m.getProjection`
threw, the `catch` swallowed it, and `globe` was **always false**. The entire
globe-widening arithmetic below it was dead code for as long as it has existed.
That is why rotating the globe kept finding areas that had never been requested.

Renamed to `pad`. At zoom 2 the globe branch now asks for 249° where Mercator
predicted 206°.

**Also:** at globe zoom the box is now the whole world
(`globe && lonSpan >= 200`). It was already asking for 249 of 360 degrees, so
this costs ~45% more pixels once and makes rotation free — the box stops moving
when you spin, `covered()` stays true, nothing refetches. Verified: spinning 140°
at zoom 2 leaves the box byte-identical.

---

## 5. Mode switching hides, it does not tear down

`cloudbar.js` called `Satellite.off()` / `Imagery.off()` when switching, which
discarded the composite and every fetched tile. Both modules now have
`hide()` / `show()` / `isHidden()` and toggle layer visibility. Their own
five-minute refresh keeps what reappears current. `off()` is still correct when
the cloud bar is dismissed entirely.

**Trap that bit once:** `ensureLayer()` in `satellite.js` ended with an
unconditional `setLayoutProperty(LAYER,'visibility','visible')`, and it runs on
every refresh — so `Now` un-hid itself **on top of Photo**. Any code path that
sets visibility must honour `_hidden`. Same applies to `addOne()` in
`imagery.js`, which sets `layout.visibility` from `_hidden` when rebuilding.

---

## 6. Photo's layer set — a taste decision, recorded

Photo draws **GOES-East, GOES-West, Meteosat geocolour** and nothing else.

Excluded, all commented in place with their correct config:
- `msg_iodc:rgb_natural` — paints vegetation cyan, desert pink.
- `Himawari_AHI_Band3_Red_Visible_1km` — greyscale, and blind at night.
- `Himawari_AHI_Band13_Clean_Infrared` — a rainbow temperature palette.
- `VIIRS_NOAA20_CorrectedReflectance_TrueColor` global base (`USE_BASE = false`).

Four different renderings stacked with a hard limb between each did not read as
one planet. The VIIRS base was worse in a specific way: it loaded first and
complete, so the picture snapped to a clean planet and was then **overpainted
disc by disc** as the live layers streamed in.

**Cost:** the Pacific, Asia and the Indian Ocean have no Photo coverage — bare
basemap. That is deliberate: a stale picture that looks current is worse than an
honest gap. `USE_BASE = true` restores the base if that trade is ever wrong.

Note the ordering rule: **SATS order is paint order**, and a raster layer cannot
vary per pixel, so the only control over an overlap is which disc is on top.
`span` bounds each disc so MapLibre never requests tiles the satellite cannot
see.

---

## 7. Harness

- **Deleted** `mkphoto.py`, `photopreview.js` — they drove `compose()`, which no
  longer exists.
- **Added** `tilepreview.js` — runs the *shipped* `imagery.js` against a fake map
  and the real network, then fetches the tile templates it installed and
  assembles a PNG. It duplicates no logic, deliberately: an earlier version
  re-implemented the frame walk-back, missed a fallback the module had, and
  reported a satellite missing that the module would have drawn.
  `node tools/checks/tilepreview.js 3 0 7 1 5 /tmp/world.png`
  It resolves `/sat.php` against `https://followtheshadow.com`, so it exercises
  the real proxy.
- **Fixed** `fullpreview.js` — had a hardcoded `repo/js/satellite.js` path and
  died silently anywhere but one directory.
- **Fixed** `mkframes.py` — could not find `cmap.json` unless run from
  `tools/checks/`.

`test_tshirt` still fails with exactly 3 assertions. That is the baseline; treat
anything else as a regression.

---

## 8. Open / unfixed

**`Now` takes ~15s on first load.** Measured on the live site: a full-size
EUMETSAT render is 3.1s at their end plus ~4s of Bluehost overhead = 7.3s cold,
0.13s cached, ×2 discs. The cache only helps when the URL repeats, and `Now`
requests a **view-shaped bbox**, so every pan is a new URL.

**The obvious fix was tried and it failed — do not repeat it blindly.** Fetching
EUMETSAT at a fixed full-disc box makes one canonical cacheable URL, and
`compose()` maps each frame by lat/lon through `fr.box`, so a larger box
composites fine. But **`background()` builds its clear-sky field against the VIEW
box**. A frame on a different box is sampled against the wrong background and the
picture tears into smeared horizontal bands. Reverted.

To attack it properly: move the background field onto the frame's own box first,
*then* fix the fetch box. Verify with `fullpreview.js` before shipping.

**Meteosat depends on `sat.php` staying up.** A `502` from it means EUMETSAT
failed upstream; the retry protocol now absorbs a transient one.

---

## 9. Verified vs not

**Verified against rendered output or a measured number:** tile scheme and CORS
for GIBS WMTS; WMTS-vs-WMS latency under concurrency; EUMETSAT CORS absence;
`sat.php` live timings; the retry protocol; the `viewBox` globe arithmetic;
rotation leaving the box unchanged; full-suite baseline.

**Only unit-tested, never seen in a browser by me:** the retry protocol under
real MapLibre; hide/show across a real mode switch; `f=newest` under real load.

**Standing rule that would have saved most of this session:** render it and look
at it. Every real defect today was found by looking at an image or a measured
number. Every wrong diagnosis came from reasoning about the code instead.
