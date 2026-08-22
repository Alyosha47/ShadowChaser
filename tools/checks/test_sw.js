/* test_sw.js — the service worker's cache-key rules.
 *
 * Exists because of ONE bug that cost a week: sw.js matched every same-origin
 * GET with { ignoreSearch: true }, and sat.php is same-origin. Per the Cache API
 * spec, ignoreSearch compares URLs with the query stripped, so
 *   /sat.php?...&b=<bboxA>...   and   /sat.php?...&b=<bboxB>...
 * are the SAME cache entry. The first EUMETSAT tile to land was then returned
 * for every other tile in the view, and MapLibre stretched that one picture into
 * each cell — Photo's grid of identical magnified tiles. The browser rig never
 * reproduced it because the rig registers no service worker.
 *
 * Run: node test_sw.js        (no dependencies)
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* The bail may be written as a regex test, so the SOURCE TEXT is `sat\.php`,
   not `sat.php`. Allow the backslash. */
const SATPHP = /sat\\?\.php/;

const SW = path.resolve(__dirname, '../../sw.js');   // suites live in tools/checks/
let pass = 0, fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

if (!fs.existsSync(SW)) {
  console.log('CANNOT RUN test_sw: sw.js not found at ' + SW);
  process.exit(2);
}
const src = fs.readFileSync(SW, 'utf8');
console.log('test_sw');

const fetchIdx = src.indexOf("addEventListener('fetch'");
ok('fetch handler found', fetchIdx !== -1);
const body = fetchIdx === -1 ? '' : src.slice(fetchIdx);

const satIdx   = body.search(SATPHP);
const matchIdx = body.search(/caches\.match\(\s*req\s*,\s*\{\s*ignoreSearch/);

/* 1. The bail exists inside the fetch handler. */
ok('fetch handler bails on sat.php', satIdx !== -1);

/* 2. It comes BEFORE the cache-first branch, or it protects nothing. */
ok('sat.php bail precedes the ignoreSearch cache-first match',
   satIdx !== -1 && matchIdx !== -1 && satIdx < matchIdx,
   'satIdx=' + satIdx + ' matchIdx=' + matchIdx);

/* 3. It actually RETURNS (passes through), not just mentions it in a comment. */
const satLine = body.split('\n')
  .filter(l => SATPHP.test(l) && /\breturn\b/.test(l) && !/^\s*[*/]/.test(l));
ok('the sat.php line passes the request through with a bare return',
   satLine.length > 0, 'no non-comment line matching sat.php + return');

/* 4. ignoreSearch must SURVIVE for everything else — it is what makes
      foo.js?v=BUILD match cached foo.js (HANDOFF §12.1). Deleting it would fix
      this bug and re-open the phantom-cache-miss one. */
ok('ignoreSearch still used for ordinary same-origin assets', matchIdx !== -1);

/* 5. No OTHER same-origin dynamic endpoint may appear without the same bail. */
const otherPhp = (src.match(/[A-Za-z0-9_-]+\.php/g) || []).filter(s => s !== 'sat.php');
ok('sat.php is the only .php endpoint referenced in sw.js', otherPhp.length === 0,
   otherPhp.join(', '));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
