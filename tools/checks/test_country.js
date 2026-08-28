/* test_country.js — country search
 *
 * Runs the REAL parser and the REAL index against eclipses whose paths are
 * documented history, so a wrong answer is checkable against the world rather
 * than against itself.
 */

'use strict';

var fs = require('fs'), path = require('path'), zlib = require('zlib'), vm = require('vm');
var ROOT = path.join(__dirname, '../..');
var pass = 0, fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); }
}

/* ── load the index and build the sandbox the parser expects ───────────── */
var idxData = JSON.parse(zlib.gunzipSync(
  fs.readFileSync(path.join(ROOT, 'data/country_index.json.gz'))).toString());
var outlines = JSON.parse(zlib.gunzipSync(
  fs.readFileSync(path.join(ROOT, 'data/basemap/countries.geojson.gz'))).toString());

var sb = { console: console, Math: Math, Date: Date, isNaN: isNaN,
           parseFloat: parseFloat, parseInt: parseInt, JSON: JSON,
           fetch: function () { return Promise.reject(new Error('no network in tests')); } };
sb.window = sb; sb.self = sb; sb.globalThis = sb;
/* CITIES TOO. Without them lookupCity is undefined, country wins every tie by
   walkover, and section 7 would "pass" while testing nothing. */
var cities = JSON.parse(zlib.gunzipSync(
  fs.readFileSync(path.join(ROOT, 'data/basemap/cities.geojson.gz'))).toString());
sb.basemapData = { countries: outlines, cities: cities };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/search-cities.js'), 'utf8'), sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/search-countries.js'), 'utf8'), sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/search-parser.js'), 'utf8'), sb);

/* Inject the index directly — the fetch path is exercised in the browser, and
   what this suite is testing is the LOOKUP and FILTER logic. */
vm.runInContext('Countries.__setIndex = function (i) { };', sb);
sb.eval = null;
/* search-countries.js keeps _index private, so drive it through the same door the
   fetch would: re-run the module body with a pre-seeded loader is fragile, so
   instead assert through the public API after forcing the private state via a
   tiny shim appended to the module source. */
var src = fs.readFileSync(path.join(ROOT, 'js/search-countries.js'), 'utf8')
  .replace('return {\n    load: load,',
           'return {\n    __seed: function (i) { _index = i; },\n    load: load,');
vm.runInContext(src, sb);
sb.Countries.__seed(idxData.index);

var parseSearch = sb.parseSearch, applyFilter = sb.applyFilter,
    filterToString = sb.filterToString;

/* ── eclipse records for the years we assert on ────────────────────────── */
function century(c) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/besselian/' + c + '.json'), 'utf8'));
}
var ENTRIES = century('1901_2000').concat(century('2001_2100'));

function search(q) {
  var f = parseSearch(q);
  return { filter: f, results: applyFilter(ENTRIES, f) };
}
function has(res, y, m, d) {
  return res.some(function (e) { return e.year === y && e.month === m && e.day === d; });
}

console.log('\n1. a country name is recognised, and does not leak into freetext');
var f1 = parseSearch('chile total');
ok('chile resolves to a country', f1.country === 'chile', 'got ' + f1.country);
ok('countryIdx is set', typeof f1.countryIdx === 'number');
ok('the name is consumed, not left as text', !/chile/.test(f1.text || ''),
   'text was "' + f1.text + '"');
ok('the type still parses', (f1.types || []).indexOf('total') >= 0);

console.log('\n2. aliases from Natural Earth, not a hand-written list');
['usa', 'us', 'united states', 'united states of america'].forEach(function (a) {
  var f = parseSearch(a + ' total');
  ok('"' + a + '" resolves', f.countryIdx != null, 'country=' + f.country);
});

console.log('\n3. "<country> total" means the CENTRAL PATH crossed it');
/* 1999-08-11 is the best-documented path in living memory: Cornwall, northern
   France, central Europe, Turkey, Iran, India. Italy sat just SOUTH of it. */
var r3 = search('serbia total').results;
ok('serbia total includes 1999-08-11', has(r3, 1999, 8, 11));
var uk = search('united kingdom total').results;
ok('uk total includes 1999-08-11 (clipped Cornwall)', has(uk, 1999, 8, 11));
var it = search('italy total').results;
ok('italy total EXCLUDES 1999-08-11 (it was partial there)', !has(it, 1999, 8, 11));

console.log('\n4. the graze is why exact geometry is used, not the sampled grid');
/* The UK's totality corridor was far narrower than the 3 deg sample spacing.
   If this ever fails, the exact path test has been dropped and sampling alone
   is deciding — which silently loses grazes. */
var ukRow = sb.Countries.countryOsc(
  ENTRIES.find(function (e) { return e.year === 1999 && e.month === 8 && e.day === 11; }).cat_no,
  parseSearch('united kingdom').countryIdx);
ok('uk is flagged central for 1999', ukRow && ukRow.central === true);
ok('and lifted to 100%, not the sampled 95%', ukRow && ukRow.osc === 100,
   ukRow ? ukRow.osc + '%' : 'no row');

console.log('\n5. an obscuration filter WIDENS "total" to the global type');
/* Same rule cities already follow: with a range present, "total" means total
   SOMEWHERE and the range says what the country actually got. So Italy — 95%
   partial in 1999 — must now appear. */
var it2 = search('italy total >90').results;
ok('italy total >90 INCLUDES 1999-08-11', has(it2, 1999, 8, 11));
var it3 = search('italy total >98').results;
ok('italy total >98 EXCLUDES it (95% is not 98)', !has(it3, 1999, 8, 11));

console.log('\n6. annular is not total');
/* 2023-10-14 crossed the USA as an ANNULAR. It must answer to "annular" and
   must NOT answer to "total" — this is what the sign bit buys. */
var us = search('usa annular').results;
ok('usa annular includes 2023-10-14', has(us, 2023, 10, 14));
var usT = search('usa total').results;
ok('usa total EXCLUDES 2023-10-14', !has(usT, 2023, 10, 14));
ok('usa total INCLUDES 2024-04-08', has(usT, 2024, 4, 8));

console.log('\n7. a city still beats a country of the same name');
/* Every existing search must keep meaning what it meant.
   SINGAPORE, not Mexico: the city list holds "Mexico City", not "Mexico", so
   `mexico` was never a collision and asserting on it tested nothing. Singapore
   is genuinely both a city and a country and is the real tie. */
var fm = parseSearch('singapore total');
ok('"singapore" still resolves as a city', !!fm.city,
   'city=' + fm.city + ' country=' + fm.country);
ok('and "mexico" reaches the COUNTRY, since no city is called that',
   parseSearch('mexico total').country === 'mexico',
   'country=' + parseSearch('mexico total').country);
var fc = parseSearch('singapore country total');
ok('"mexico country" forces the country', !!fc.country && !fc.city,
   'city=' + fc.city + ' country=' + fc.country);
ok('the word "country" is consumed', !/country/.test(fc.text || ''),
   'text was "' + fc.text + '"');

console.log('\n8. the index is DECOMPRESSED before parsing');
/* Shipped broken 2026-08-25a: search-countries.js called r.json() straight on the
   response. The file is stored gzipped and served as-is, so the browser hands
   back raw deflate bytes and JSON.parse dies on byte one:
     "Unexpected token '\u001f'... is not valid JSON"
   The whole suite passed anyway, because these tests seed the index directly
   and never exercise the fetch. So assert on the SOURCE: it must pipe through
   DecompressionStream, exactly as map.js's fetchGz does for every other .gz. */
var csrc = fs.readFileSync(path.join(ROOT, 'js/search-countries.js'), 'utf8');
ok('search-countries.js gunzips the index',
   /DecompressionStream\(\s*'gzip'\s*\)/.test(csrc));
ok('and does not call .json() on the raw response',
   !/return\s+r\.json\(\)/.test(csrc));

console.log('\n9. the country SURVIVES a round-trip through filterToString');
/* Every pill rebuilds the search box from the filter. filterToString did not
   emit `country`, so clicking "annular" on "france total" rewrote the box as
   bare "annular" — the country silently vanished and the search quietly
   widened to the whole world. Reported 2026-08-25.
   Round-tripping is the real test: string -> filter -> string -> filter. */
var f9 = parseSearch('france total');
var s9 = filterToString(f9);
ok('the rebuilt string still names france', /france/.test(s9), 'got "' + s9 + '"');
var f9b = parseSearch(s9);
ok('and it re-parses back to the same country', f9b.country === 'france',
   'country=' + f9b.country);
ok('with the type intact', (f9b.types || []).indexOf('total') >= 0);

/* Swapping the type is exactly what the pill does. */
f9.types = ['annular'];
var f9c = parseSearch(filterToString(f9));
ok('swapping the type keeps the country', f9c.country === 'france',
   'country=' + f9c.country + ' from "' + filterToString(f9) + '"');

/* A name shared with a city must not silently flip to the city on rebuild. */
var fs9 = parseSearch('singapore country total');
var rs9 = parseSearch(filterToString(fs9));
ok('a city-named country stays a country through the round-trip',
   rs9.country === 'singapore' && !rs9.city,
   'city=' + rs9.city + ' country=' + rs9.country);

console.log('\n10. a country AFTER a city is a qualifier, not a filter');
/* "paris france total" is how people write a place. Before 2026-08-25e the
   country fell through to freetext, where it was matched as a substring
   against the date/year/saros, and the search returned ZERO results. */
var q10 = parseSearch('paris france total');
ok('the city still wins', q10.city === 'Paris', 'city=' + q10.city);
ok('the country is consumed, not left as text', !q10.text,
   'leftover "' + q10.text + '"');
ok('and is not applied as a second filter', !q10.country,
   'country=' + q10.country);
ok('so it returns the same as the city alone',
   applyFilter(ENTRIES, q10).length === applyFilter(ENTRIES, parseSearch('paris total')).length);
ok('a MULTI-WORD country qualifier is consumed too',
   !parseSearch('tokyo united states total').text,
   'leftover "' + parseSearch('tokyo united states total').text + '"');
ok('the qualifier survives a pill rebuild', /france/.test(filterToString(q10)),
   'rebuilt "' + filterToString(q10) + '"');
/* An unknown word must STILL be left alone — the qualifier rule must not turn
   into "swallow anything after a city". */
ok('a non-country word after a city is still freetext',
   parseSearch('chicago xyzzy total').text === 'xyzzy',
   'leftover "' + parseSearch('chicago xyzzy total').text + '"');

console.log('\n11. multi-word city names resolve by START of name');
/* The dataset holds full official names, so `new york` matched nothing and the
   walk fell through to `york` — ENGLAND, 53.96N. Silent and plausible, and the
   manual listed `new york` as a worked example. Fixed 2026-08-25g. */
var ny = parseSearch('new york total');
ok('"new york" finds New York City', ny.city === 'New York City', 'city=' + ny.city);
ok('and not York, England', !(ny.coords && ny.coords.lat > 50),
   ny.coords ? 'lat ' + ny.coords.lat : 'no coords');
ok('nothing is left over', !ny.text, 'leftover "' + ny.text + '"');
['ho chi minh', 'mexico city', 'cape town'].forEach(function (n) {
  ok('"' + n + '" resolves', !!parseSearch(n + ' total').city,
     'city=' + parseSearch(n + ' total').city);
});

console.log('\n12. and the prefix rule does NOT over-reach');
/* Each of these worked before the fallback existed and must be untouched. */
ok('"mexico" is still the COUNTRY, not Mexico City',
   parseSearch('mexico total').country === 'mexico' && !parseSearch('mexico total').city,
   'city=' + parseSearch('mexico total').city);
ok('"york" is still York', parseSearch('york total').city === 'York',
   'city=' + parseSearch('york total').city);
ok('a bare "new" matches NOTHING (not New Delhi)',
   !parseSearch('new total').city, 'city=' + parseSearch('new total').city);
ok('a bare "san" matches NOTHING (not San Francisco)',
   !parseSearch('san total').city, 'city=' + parseSearch('san total').city);
ok('"paris" is still exact', parseSearch('paris total').city === 'Paris');
ok('a prefix hit still takes a country qualifier',
   !parseSearch('new york united states total').text,
   'leftover "' + parseSearch('new york united states total').text + '"');

console.log('\n13. a map click clears EVERY named location');
/* onMapClick rebuilds the box with explicit coords and must strip the named
   locations, or they re-resolve on the next parse and override the clicked
   point. It cleared `city` from the start; `country` and the qualifier were
   added later and it was not updated, so clicking the map with "chile total"
   in the box left Chile filtering the list and the click did nothing.
   Reported 2026-08-25. This asserts the SHAPE onMapClick builds. */
[['chile total', 'country'], ['paris total', 'city'],
 ['paris france total', 'cityQualifier']].forEach(function (pair) {
  var f = parseSearch(pair[0]);
  var cleared = Object.assign({}, f, {
    coords: { lat: 10, lon: 20 },
    city: null, country: null, countryIdx: null, cityQualifier: null
  });
  var rebuilt = filterToString(cleared);
  var reparsed = parseSearch(rebuilt);
  ok('"' + pair[0] + '" -> map click leaves no ' + pair[1],
     !reparsed.city && !reparsed.country && !reparsed.cityQualifier,
     'rebuilt "' + rebuilt + '" -> city=' + reparsed.city
     + ' country=' + reparsed.country);
  ok('  and the clicked coords survive',
     !!(reparsed.coords && Math.abs(reparsed.coords.lat - 10) < 0.01),
     JSON.stringify(reparsed.coords));
});
/* The type must NOT be lost — clicking the map should narrow the location,
   not throw away what kind of eclipse you were looking for. */
var kept = parseSearch(filterToString(Object.assign({}, parseSearch('chile total'), {
  coords: { lat: 10, lon: 20 }, city: null, country: null,
  countryIdx: null, cityQualifier: null })));
ok('the eclipse type survives a map click', (kept.types || []).indexOf('total') >= 0);

console.log('\n14. a country means its OWN LAND, not its overseas departments');
/* `today+ total france` returned 2045-08-12, which goes nowhere near France —
   it crosses FRENCH GUIANA, and Natural Earth's "France" was one shape holding
   the overseas departments. Legally right, practically useless. Reported
   2026-08-25; France, the Netherlands and New Zealand were rebuilt from the
   map-units file and the remote pieces became searchable in their own right. */
var f14 = search('france total').results;
ok('france total EXCLUDES 2045-08-12', !has(f14, 2045, 8, 12));
ok('but french guiana INCLUDES it',
   has(search('french guiana total').results, 2045, 8, 12));
ok('france total still has 1999-08-11', has(f14, 1999, 8, 11));
ok('reunion is searchable at all', search('reunion total').results.length > 0);
/* The politically-split countries must NOT have been split — map units break
   the UK into four and Belgium into three, and swapping the file wholesale
   would have quietly destroyed those searches. */
['united kingdom', 'belgium', 'portugal', 'norway'].forEach(function (n) {
  ok('"' + n + '" is still one searchable country',
     parseSearch(n + ' total').countryIdx != null);
});
ok('the uk still sees 1999-08-11 as total',
   has(search('united kingdom total').results, 1999, 8, 11));

console.log('\n15. the 20% floor is a known limit, not an accident');
var far = search('fiji total').results;
ok('a country search returns SOMETHING', search('japan total').results.length > 0);
ok('and not everything', search('japan total').results.length < ENTRIES.length);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
