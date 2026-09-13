# shadow-layer archive — the files have similar names and DIFFERENT jobs

This folder is the **shadow-layer archive**. It predates the favorability work and outlives it.
The canonical copy of this table is **HANDOFF.md §8.1a**; it is repeated here because the folder is
where someone stands when they are about to restore the wrong file.

| file | what it is | use |
|---|---|---|
| `../js/shadow-layer.js` (live, not here) | the shipped engine, 1243 lines | live |
| `shadow-layer_PRE-MASK.js` | copy of the shipped file taken immediately before the mask work | **the rollback target, and what to diff against** |
| `shadow-layer.ORIGINAL.js` | the v64 **extraction**, 1157 lines, no supersampling | provenance ONLY |
| `shadows_v64_FINAL.html` | the original standalone study the engine came from | provenance |

**MEASURED 2026-09-08:**

- `shadow-layer_PRE-MASK.js` is **byte-identical** to the shipped engine. The mask work
  (TODO #F6, build step 4) has not started.
- `shadow-layer.ORIGINAL.js` differs from the shipped engine by **92 lines, and that is the
  supersampling** (HANDOFF §8.6). **Restoring `ORIGINAL` silently deletes it.** It is a provenance
  record, not a safety net. `PRE-MASK` is the file you restore from.

Nothing in this folder is loaded by `index.html` or listed in `sw.js` CORE — and **no test asserts
that**, so do not let a file in here acquire a `<script>` tag by accident.

The last backup of this kind vanished in a commit titled "refactored handoff". That is why the
folder is named the way it is, and why this file exists.
