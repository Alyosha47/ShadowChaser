# Checks

Headless test suites. No browser, no build step, no CI — run them by hand after
any change to `index.html`, `css/app.css` or `js/`.

```
npm i jsdom          # once; dev-only, the app itself has no dependencies
node tools/checks/run.js
```

Runs from any directory. Exit code is non-zero if anything fails.

## What each covers

| Suite | Covers |
|---|---|
| `test_hygiene.js` | Orphaned comments, duplicate selectors, unused classes, rules filed under the wrong section banner, **the visual-language rules** (HANDOFF §14.2), the **DOM contract**, the **BUILD stamp** |
| `test_details.js` | Details-panel heading tiers, icon-only title actions, the title not wrapping |
| `test_userlog.js` | Log store semantics, `[lon, lat]` order, the explicit-commit gate, row-tap vs goto, escaping, corrupt-storage resilience |
| `test_picker.js` | Collapsible basemap picker: two-tap on phones, one-tap on desktop, inert offline |

## Why these two exist in particular

**DOM contract** — every `getElementById` across all modules must resolve to an
id present in `index.html`, or one the JS creates itself. Removing an element
while a module still reaches for it throws, and an exception inside a hot path
like `onSearchChanged` aborts everything downstream of it: blank details panel,
no map pin, no obvious cause.

**BUILD stamp** — every js/css asset must carry the current `BUILD`. This is not
theoretical: `#coords-status` was removed from the markup and `search.js`
rewritten to stop using it, but `BUILD` was not bumped, so the service worker
served the cached old `search.js` against the new HTML. The app broke in exactly
the way above. **Touching any js/css without bumping BUILD now fails a test.**

## When a test fails

Decide which is wrong — the code or the test — and fix that one. Several of
these assertions encode DECISIONS (see HANDOFF §14.2), not preferences; if a
decision is genuinely reversed, change the assertion in the same commit and say
so in HANDOFF, or the next session will re-litigate it. Two reversals are
already recorded there: heading colour, and emoji vs SVG tab icons.
