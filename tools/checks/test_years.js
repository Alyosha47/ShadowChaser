/* test_years.js — BCE/CE. The catalogue uses ASTRONOMICAL years (0 = 1 BCE,
   -762 = 763 BCE; the Assyrian eclipse of 15 June 763 BCE is stored as -762).
   Until 2026-09-24 the app showed year 0 as "0 ce", put every BCE date a year
   late, and "1 ce" also matched 1 BCE. From the repo root:
     node tools/checks/test_years.js */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '../..');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d !== undefined ? '  → ' + d : '')); } }

var sb = { MONTHS: ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/format.js'), 'utf8') + ';this.__fd = fmtDate;', sb);
function d(y) { return sb.__fd({ year: y, month: 6, day: 15 }).replace(/[\u2009\u202f]/g, ' '); }
console.log('1. the date shown');
ok('year 1 is 1 ce', d(1) === 'Jun 15, 1 ce', d(1));
ok('year 0 is 1 bce, not "0 ce"', d(0) === 'Jun 15, 1 bce', d(0));
ok('year -1 is 2 bce', d(-1) === 'Jun 15, 2 bce', d(-1));
ok('year -762 is 763 bce (the Assyrian eclipse)', d(-762) === 'Jun 15, 763 bce', d(-762));
var idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
ok('the catalogue really stores 15 June 763 BCE as -762 (total)',
   idx.some(function (r) { return r.year === -762 && r.month === 6 && r.day === 15 && r.eclipse_type[0] === 'T'; }));

console.log('\n2. what a typed year means');
var P = require(path.join(ROOT, 'js/search-parser.js'));
function yrs(q) { var f = P.parseSearch(q); return JSON.stringify(f && f.years); }
ok('"1 ce" is year 1 only', yrs('1 ce') === '{"min":1,"max":1}', yrs('1 ce'));
ok('"1 bce" is year 0 only', yrs('1 bce') === '{"min":0,"max":0}', yrs('1 bce'));
ok('"763 bce" is year -762', yrs('763 bce') === '{"min":-762,"max":-762}', yrs('763 bce'));
ok('"1bce-1ce" spans years 0..1', yrs('1bce-1ce') === '{"min":0,"max":1}', yrs('1bce-1ce'));
ok('a bare "974" still means 974 ce OR 974 bce', yrs('974') === '{"min":-973,"max":974,"exactPair":true}', yrs('974'));

console.log('\n3. end to end: what the list shows');
/* parseSearch alone was not enough: "1bce-1ce" parsed the right years but left
   its "-" as free text, which matched nothing, so the list was empty. */
function list(q) { return P.applyFilter(idx, P.parseSearch(q)).map(function (e) { return e.year + '-' + e.month + '-' + e.day; }).join(' '); }
var both = '0-6-20 0-7-19 0-12-14 1-6-10 1-12-3';
['1bce-1ce', '1 bce - 1 ce', '1 bce 1 ce', '1bce \u2013 1ce'].forEach(function (q) {
  ok('"' + q + '" lists the five eclipses of 1 BCE and 1 CE', list(q) === both, list(q));
});
ok('"1 ce" lists only the two of 1 CE', list('1 ce') === '1-6-10 1-12-3', list('1 ce'));
ok('"1900-1905" is unaffected (13)', P.applyFilter(idx, P.parseSearch('1900-1905')).length === 13);

console.log('\n4. the search written back (a map tap rewrites it with the coordinates)');
/* "2bce 1ce" came back as "-1-1 (lat, lon)", which reads as nothing (2026-09-24). */
['2bce 1ce', '1bce', '763 bce', '5ce', '500bce-100bce', '1900-1905', '974', 'before -499'].forEach(function (q) {
  var f = P.parseSearch(q), back = P.filterToString(f), f2 = P.parseSearch(back);
  ok('"' + q + '" -> "' + back + '" reads back to the same years, nothing left over',
     JSON.stringify(f.years) === JSON.stringify(f2.years) && !f2.text, JSON.stringify(f2.years) + ' text=' + JSON.stringify(f2.text));
});
var withCoords = P.filterToString(Object.assign({}, P.parseSearch('2bce 1ce'), { coords: { lat: -76.22282, lon: 107.28814 } }));
ok('after a map tap: "' + withCoords + '" still lists 2 BCE-1 CE eclipses',
   P.parseSearch(withCoords).years && P.parseSearch(withCoords).years.min === -1 && P.parseSearch(withCoords).years.max === 1, withCoords);

console.log('\n5. every search example the Instructions print, typed exactly as printed');
/* The Instructions show ranges with an en dash and list "50+" and "95–" as
   OBSCURATION. Until 2026-09-25 en dashes matched nothing, "50+"/"95–" were
   read as years, "1994-now" meant today onward, and "before 500 bce" matched
   nothing. [query, expected list length, what must have been parsed] */
[['today', 2332, 'today'], ['1994-now', 72, 'years'], ['2026', 2, 'years'],
 ['2026\u20132030', 12, 'years'], ['1994+', 2404, 'years'], ['1994\u2013', 9496, 'years'],
 ['after 2100', 2166, 'years'], ['before 500', 5941, 'years'], ['44BC', 2, 'years'],
 ['10BCE\u201310CE', 51, 'years'], ['aug 28', 36, 'days'], ['saros 126', 72, 'saros'],
 ['total', 3742, 'types'], ['>80', 8209, 'obscRange'], ['50+', 9267, 'obscRange'],
 ['<30', 1856, 'obscRange'], ['95\u2013', 6507, 'obscRange'],
 ['before 500 bce', 3596, 'years'], ['after 500bce', 8304, 'years'], ['500bce+', 8304, 'years'],
 ['50ce+', 7000, 'years']].forEach(function (c) {
  var f = P.parseSearch(c[0]), n = P.applyFilter(idx, f).length;
  ok('"' + c[0] + '" -> ' + c[2] + ', ' + c[1] + ' eclipses, nothing left over',
     n === c[1] && !f.text && f[c[2]] != null, n + ' eclipses, text=' + JSON.stringify(f.text));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
