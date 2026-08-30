/* test_search_types.js — what a type word MEANS in a search
 *
 * ONE RULE: a type word means what the SELECTED PLACE saw.
 *
 *   no place        the eclipse's own global type
 *   a point         local_type — "total" is "total from here"
 *   a country       its own type; with an obscuration range, the global type,
 *                   because a country is an area and "what it saw" is otherwise
 *                   ambiguous ("chile total >50" = a total eclipse, of which
 *                   Chile got at least 50%)
 *
 * This file exists because that rule was violated in two places at once and the
 * result looked, from the outside, like the search was simply broken:
 *
 *   1. The LIST drew the global type while the FILTER matched the local one.
 *      From St. Louis the list showed 115 hybrid icons and typing "hybrid"
 *      returned 0 — every one of those is a partial from there. Same word, two
 *      meanings, in the same panel.
 *   2. An obscuration range flipped a POINT to global types, so "partial >70"
 *      meant "globally partial, and over 70% here" and excluded 2017-08-21 —
 *      a 100% partial at St. Louis and the single most interesting answer.
 *
 * Both fixed 2026-08-29w. The assertions below are the rule, written down.
 */

'use strict';

var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '../..');
var E = require(path.join(ROOT, 'js/eclipse.js'));
var pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  \u2192 ' + detail : '')); }
}

/* Load the parser the way the browser does. */
var sb = { console: console, Math: Math, Date: Date, JSON: JSON, String: String,
           Number: Number, Array: Array, Object: Object, RegExp: RegExp,
           isNaN: isNaN, parseFloat: parseFloat, parseInt: parseInt };
sb.window = sb; sb.self = sb;
sb.localStorage = { getItem: function () { return null; }, setItem: function () {} };
vm.createContext(sb);
['js/format.js', 'js/eclipse.js', 'js/search-cities.js', 'js/search-countries.js',
 'js/search-parser.js'].forEach(function (f) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f }); }
  catch (e) { /* optional deps */ }
});

/* A real point scan, built exactly as local.js builds one. St. Louis is the
   case that exposed both bugs: the 2017 umbral limit runs through the city, so
   it sees a great many near-total partials and very few totals. */
var idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
var byDate = {};
idx.forEach(function (e) { byDate[e.year + '/' + e.month + '/' + e.day] = e; });

var LAT = 38.627, LON = -90.199, LONW = 90.199;
var scan = [];
fs.readdirSync(path.join(ROOT, 'data/besselian'))
  .filter(function (f) { return /\.json$/.test(f); })
  .forEach(function (f) {
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data/besselian', f), 'utf8')).forEach(function (rec) {
      var tMax = E.findMaximum(rec, LAT, LONW, 0, rec.dt);
      var oMax = E.fundamentalArgs(rec, tMax, LAT, LONW, 0, rec.dt);
      if (Math.sqrt(oMax.u * oMax.u + oMax.v * oMax.v) >= Math.abs(oMax.L1p)) return;
      var r = E.computeEclipse(rec, LAT, LON, 0);
      if (!r.visible) return;
      var entry = byDate[rec.year + '/' + rec.month + '/' + rec.day];
      if (!entry) return;
      scan.push(Object.assign({}, entry,
        { local_type: r.type, local_mag: r.mag, local_osc: r.osc }));
    });
  });

function count(q) { return sb.applyFilter(scan, sb.parseSearch(q)).length; }
function has(q, y, m, d) {
  return sb.applyFilter(scan, sb.parseSearch(q))
           .some(function (e) { return e.year === y && e.month === m && e.day === d; });
}

console.log('\n1. the scan itself');
ok('St. Louis sees a large mixed set', scan.length > 1000, String(scan.length));

console.log('\n2. a type word means what THIS PLACE saw');
/* The counts must equal the local_type tally exactly — that is the rule. */
var tally = {};
scan.forEach(function (e) { tally[e.local_type] = (tally[e.local_type] || 0) + 1; });
['total', 'annular', 'partial', 'hybrid'].forEach(function (t) {
  ok('"' + t + '" matches the local tally (' + (tally[t] || 0) + ')',
     count(t) === (tally[t] || 0), count(t) + ' vs ' + (tally[t] || 0));
});

console.log('\n3. the LIST ICON must agree with the FILTER');
/* search-list.js draws typeCode(local_type || eclipse_type). If it ever goes
   back to the global type, these counts diverge and the panel contradicts
   itself: 115 hybrid icons that "hybrid" cannot find. */
var iconTally = {};
scan.forEach(function (e) {
  var c = String(e.local_type || e.eclipse_type).charAt(0).toUpperCase();
  iconTally[c] = (iconTally[c] || 0) + 1;
});
var listSrc = fs.readFileSync(path.join(ROOT, 'js/search-list.js'), 'utf8');
ok('search-list.js draws the LOCAL type',
   /typeCode\(e\.local_type \|\| e\.eclipse_type/.test(listSrc));
ok('icon counts equal filter counts, type by type',
   (iconTally.T || 0) === count('total') &&
   (iconTally.A || 0) === count('annular') &&
   (iconTally.P || 0) === count('partial') &&
   (iconTally.H || 0) === count('hybrid'),
   JSON.stringify(iconTally));

console.log('\n4. an obscuration range does NOT change what a type means at a point');
ok('"partial >70" includes 2017-08-21 (100% partial at St. Louis)',
   has('partial >70', 2017, 8, 21));
ok('"partial >70" is a subset of "partial"', count('partial >70') < count('partial'));
ok('"partial >70" is not empty and not everything',
   count('partial >70') > 50 && count('partial >70') < count('partial'),
   String(count('partial >70')));
ok('"total" still excludes 2017 here — the pin is 3.4 km north of the limit',
   !has('total', 2017, 8, 21));
ok('adding a range never widens a type', count('partial >0') <= count('partial'));

console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
