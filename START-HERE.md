# START HERE — session handoff, 2026-08-08

**This is not the project handoff.** `HANDOFF.md` in the repo is, and it is
current: §15 was written this session and covers everything below in technical
detail. This file only carries what HANDOFF.md cannot — the state of the
working copy, what is half-finished, and how to work with this person.

Read this, then `HANDOFF.md` §15 and `TODO.md`'s priority order. Nothing else
needs catching up on.

---

## 1. First actions, in order

1. **Clone fresh.** `git clone` the repo, `maplibre` branch. The previous
   session worked from a clone taken at commit `cd63408` and drifted for a full
   day; twice it reported files as missing that were actually on the remote.
2. **`git status` and `git log --oneline -5`.** The user applied this session's
   changes by hand from zip files, so the repo may or may not contain them, and
   may contain his own edits on top. **Do not assume; look.**
3. **`node tools/checks/run.js`** (needs `npm i jsdom` once). Five suites.
   Expect `test_tshirt` to fail with exactly 3 assertions — see §3 below. If
   anything else fails, that is new and worth reporting before doing any work.

---

## 2. What shipped this session

All documented in `HANDOFF.md` §14–15. Briefly:

- **App renamed to `followtheshadow`** throughout. Internal localStorage keys
  (`sc.log`, `sc_shadow_opacity`) deliberately unchanged.
- **User log** (`js/userlog.js`) — saved/seen eclipses, per-entry locations,
  export/import, a Log tab on mobile and in the sidebar.
- **T-shirt poster** (`js/tshirt.js`) — multi-eclipse map from the log, seven
  projections, four palettes, SVG/PNG export, pinch-zoom, opened in a reusable
  `.sheet` overlay.
- **Catalogue audit** (`data build tools/audit_paths.py`) — the pre-ship gate,
  run and passed.
- **Test suites** (`tools/checks/`) — five, with a runner.
- **Cesium purge from `sw.js`**, which exposed two real offline bugs:
  MapLibre/deck.gl and `land.geojson.gz` were never precached. A fresh install
  that went offline before first use had no map. **This was the single most
  valuable find of the session.**
- **iOS**: scrubber clear of the home-indicator gesture zone, tab bar clear of
  the notch, sheet dismissal, share-sheet error banner suppressed, splash
  images (28 sizes) and icons.

BUILD in the working copy is `2026-08-08h`.

---

## 3. What is NOT finished

**`tools/checks/test_tshirt.js` fails exactly 3 assertions.** All in the
poster's polar tail:

```
NO band in the whole catalogue covers over 8% of the map  → 691-05-03
a band is extended past its limbs ONLY toward the pole    → -1180-06-16, -1444-08-23, …
no centreline is drawn where there is no band             → -1361-03-12, -1850-12-09, …
```

`TODO.md` #F1b. **Before touching it, read `HANDOFF.md` §15.3**, which records
which approaches were tried and produce visibly worse output. This consumed
most of a day and is the least visible remaining work — TODO deliberately
ranks it third.

**Splash images exist but the `<link>` tags may not be installed** depending on
which zips the user applied. 28 files in `icons/splash/`, 28 tags in
`index.html`. `icons/splash/README.md` has the size table.

**`.gitignore` still lists `vendor/cesium-1.121/`**, which no longer exists.

---

## 4. Working agreement — read this properly

The last session went badly in a specific, avoidable way, and the user ended it
angry. The failures were not hard problems; they were method.

**Do exactly what is asked. Nothing adjacent.** A request to remove a paragraph
is not a licence to audit the surrounding code, remove dead handlers, or tidy
CSS. Twice this session a two-line request became a five-file change, and once
it broke the page. If something adjacent looks wrong, *say so in one sentence*
and let the user decide.

**Never claim verification you have not done.** Say what was checked and how —
"tag balance is 0", not "it works". The user caught several claims that were
technically true about a proxy and false about the thing he could see.

**For anything visual, LOOK AT IT.** `cairosvg` and `PIL` are available; render
the SVG to PNG and view it. Days were lost measuring polygon area while the
picture stayed obviously wrong. Every defect the user reported was found within
minutes of actually rendering.

**After any structural HTML edit, check tag balance.** One command:

```bash
python3 -c "
import re; s=open('index.html').read(); d=0
for m in re.finditer(r'<(/?)(div|details)\b[^>]*>', s): d += -1 if m.group(1) else 1
print('balance', d)"
```

Deleting an opening tag and leaving its closing tag broke the settings panel
layout this session and took several rounds to find.

**Do not patch a symptom.** When a change causes a visual problem, the cause is
almost always the change, not the pre-existing CSS. A `:last-child` override
was added to compensate for a block placed in the wrong container; both were
later reverted. Fix the placement.

**Deliver only the files that changed**, and say which are one-line edits.
Bundling docs with an artwork request meant overwriting `TODO.md` to install a
splash screen.

**The user's preferences, verbatim:** be concise; never break working code;
don't fall down rabbit holes; remember what ground has been covered; never
guess; never give up; say if a different model would serve better. He has
limited time and is paying for tokens. Long autonomous investigations are not
welcome unless he asks for one.

---

## 5. Where to pick up

`TODO.md` priority order, unchanged:

1. **Settings → Info.** Rename the tab; drop the timezone control (redundant —
   the contacts table toggles time mode inline); move the shadow slider to the
   overlay it drives. Small, self-contained, visible.
2. **Overlay sheet pattern.** Three overlays are coming. The `.sheet` component
   already exists and is deliberately generic — reuse it rather than growing
   three bespoke control clusters.
3. **#F1b** — finish the poster geometry.
4. Search temporal tokens; then open bugs → UX → features.

Also open, from the last hour of the session: revisit icon orientations and the
sun track together, and decide whether the displayed date should follow the
UT/local toggle.
