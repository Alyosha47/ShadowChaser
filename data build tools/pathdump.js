#!/usr/bin/env node
/* pathdump.js — write the path catalogue computed by a given js/pathgen.js as
   chunk files check_regen.py can read (paths_A_B.json.gz: {cat_no: record,
   __meta: {generator}}). There are no path files in the app any more; this is
   how two versions of the engine are compared. Assistant tool (needs Node).

   From the repo root:
     git show HEAD:js/pathgen.js > /tmp/pathgen_base.js
     node "data build tools/pathdump.js" /tmp/pathgen_base.js /tmp/base 1901 2100
     node "data build tools/pathdump.js" js/pathgen.js        /tmp/new  1901 2100
     python3 "data build tools/check_regen.py" --base /tmp/base --new /tmp/new

   Year range is optional (default: the whole catalogue, which takes hours).
   A chunk is written only if at least one of its eclipses falls in the range. */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [engine, out, from, to] = process.argv.slice(2);
if (!engine || !out) { console.error('usage: pathdump.js <pathgen.js> <outdir> [fromYear toYear]'); process.exit(2); }
const P = require(path.resolve(engine));
const lo = from === undefined ? -Infinity : +from, hi = to === undefined ? Infinity : +to;
const dir = path.join(__dirname, '..', 'data', 'besselian');
fs.mkdirSync(out, { recursive: true });
let n = 0; const t0 = Date.now();
for (const f of fs.readdirSync(dir).filter(f => /^-?\d+_-?\d+\.json$/.test(f))) {
  const recs = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).filter(r => r.year >= lo && r.year <= hi);
  if (!recs.length) continue;
  const chunk = { __meta: { generator: P.VERSION } };
  for (const r of recs) { chunk[String(r.cat_no)] = P.eclipse_path(JSON.parse(JSON.stringify(r))); n++; }
  fs.writeFileSync(path.join(out, 'paths_' + f.replace('.json', '') + '.json.gz'), zlib.gzipSync(JSON.stringify(chunk)));
  console.log(f, recs.length, 'eclipses', ((Date.now() - t0) / 1000).toFixed(0) + ' s');
}
console.log(n, 'eclipses written, engine', P.VERSION);
