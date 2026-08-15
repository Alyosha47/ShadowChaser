/* tools/checks/test_satellite.js — js/satellite.js, the parts that need no map
 * and no network. Resolves its input two levels up, like every suite here.
 *
 * The failure mode this guards against is specific and nasty: a wrong layer
 * identifier, a stale timestamp or a transposed row/col all render as a blank or
 * mirrored layer with NO error. On a tool for deciding where to stand under an
 * eclipse, a blank cloud layer reads as "clear sky everywhere".
 */
'use strict';

var fs = require('fs'), path = require('path'), vm = require('vm');
var pass = 0, fail = 0;
function ok(n, c, x) {
  if (c) { pass++; console.log('  PASS ' + n); }
  else { fail++; console.log('  FAIL ' + n + (x ? '  → ' + x : '')); }
}

var src = fs.readFileSync(path.join(__dirname, '../../js/satellite.js'), 'utf8');
var sb = { window: {}, console: console,
           fetch: function () { throw new Error('tests must not hit the network'); } };
vm.createContext(sb); vm.runInContext(src, sb);
var S = sb.window.Satellite;

console.log('\n1. module shape');
ok('exports on window.Satellite', !!S);
ok('carries a version stamp', !!S && /^\d{4}-\d{2}-\d{2}[a-z]$/.test(S.version), S && S.version);
ok('carries the GIBS credit', !!S && /GIBS/.test(S.CREDIT));
ok('touches no DOM', !/document\.|getElementById|addEventListener/.test(src));

console.log('\n2. only verified constants ship');
var sats = S._sats();
ok('every satellite names a layer', sats.every(function (x) { return !!x.layer; }));
/* set/ext are WMTS-only: a WMS GetMap carries format and size as query
   parameters instead, so requiring them of every entry is a category error. */
ok('every WMTS satellite has a matrix set and format',
   sats.filter(function (x) { return x.kind === 'wmts'; })
       .every(function (x) { return x.set && x.ext; }));
ok('no WMS satellite carries WMTS-only fields',
   sats.filter(function (x) { return x.kind === 'wms'; })
       .every(function (x) { return !x.set && !x.ext; }));
ok('no layer is left as a placeholder',
   sats.every(function (s) { return !/TODO|XXX|FIXME|\?\?/.test(s.layer); }));
ok('the probe page still exists for re-verification',
   fs.existsSync(path.join(__dirname, 'verify_gibs.html')),
   'the constants above are only trustworthy while the probe can re-check them');

console.log('\n3. satellite selection by longitude');
ok('Florida picks GOES-East', S._pick(-81).id === 'goes-east', String(S._pick(-81)));
ok('Hawaii picks GOES-West', S._pick(-157).id === 'goes-west', String(S._pick(-157)));
ok('London picks Meteosat', S._pick(0).id === 'mtg');
ok('Cairo picks Meteosat or IODC',
   ['mtg', 'iodc'].indexOf(S._pick(31).id) >= 0, String(S._pick(31).id));
ok('Delhi picks IODC', S._pick(77).id === 'iodc', String(S._pick(77).id));
ok('Tokyo picks Himawari', S._pick(139).id === 'himawari');
/* -179 is 41 deg from Himawari and 42 from GOES-West, so Himawari wins — it
   genuinely has the better view of the dateline. The point of the assertion is
   that the wrap arithmetic picks the NEARER satellite rather than falling over. */
ok('the antimeridian picks the nearer satellite, not nothing',
   S._pick(-179).id === 'himawari', String(S._pick(-179) && S._pick(-179).id));
ok('just east of GOES-West sub-point still picks GOES-West',
   S._pick(-120).id === 'goes-west');
ok('longitudes beyond +/-180 are wrapped, not clamped',
   S._pick(-433).id === 'goes-east', '-433 wraps to -73, which GOES-East sees');
ok('+/-180 agree', String(S._pick(180)) === String(S._pick(-180)));

console.log('\n4. coverage reports a reason');
ok('covered longitude says ok', S.coverage(-90).ok);
/* COVERAGE IS NOW GLOBAL — five sub-points, every gap inside a half-width.
   Sweep the whole world rather than spot-checking: a hole here shows as a blank
   map, which on this tool reads as clear sky. */
var holes = [];
for (var L = -180; L < 180; L += 1) { if (!S.coverage(L).ok) holes.push(L); }
ok('no longitude anywhere is uncovered', holes.length === 0,
   holes.length ? holes.length + ' uncovered, e.g. ' + holes.slice(0, 5).join(', ') : '');

console.log('\n5. the silent-failure traps');
ok('WMTS row/col order is y then x, not x then y',
   /\{z\}\/\{y\}\/\{x\}/.test(src),
   'transposing these mirrors the imagery about the diagonal with no error');
ok('a real timestamp is required — never time=default',
   !/'default'\s*;|=\s*'default'/.test(src) && /never fall back to default/.test(src),
   'default is not necessarily recent, and a stale sky is worse than none');
ok('the timestamp is shape-checked before use',
   /\^\\d\{4\}-\\d\{2\}-\\d\{2\}T/.test(src));
ok('shownTime is exposed so staleness can be displayed', typeof S.shownTime === 'function');
ok('nothing is shown when the newest frame is unknown', /if \(!time\)/.test(src));

console.log('\n6. the ingest race — newest frame is not always live');
ok('stepBack subtracts one cadence step',
   S._stepBack('2026-08-14T23:20:00Z', 1) === '2026-08-14T23:10:00Z',
   String(S._stepBack('2026-08-14T23:20:00Z', 1)));
ok('stepBack snaps to the cadence grid, since GIBS holds no other frames',
   S._stepBack('2026-08-14T23:24:00Z', 0) === '2026-08-14T23:20:00Z',
   String(S._stepBack('2026-08-14T23:24:00Z', 0)));
ok('stepBack crosses an hour correctly',
   S._stepBack('2026-08-14T23:00:00Z', 1) === '2026-08-14T22:50:00Z');
ok('stepBack crosses midnight correctly',
   S._stepBack('2026-08-15T00:00:00Z', 1) === '2026-08-14T23:50:00Z');
ok('stepBack emits no milliseconds — GIBS wants seconds precision',
   !/\.\d{3}Z/.test(S._stepBack('2026-08-14T23:20:00Z', 2)));
ok('a bad timestamp yields null, not a wrong frame', S._stepBack('rubbish', 1) === null);
ok('the layer steps back rather than trusting the newest stamp',
   /firstLiveFrame/.test(src), 'the probe proved the newest frame is often not yet published');

console.log('\n7. night coverage is reported, not hidden');
ok('GOES has night imagery (GeoColor blends infrared)', S.hasNight(-75) === true);
ok('Himawari does NOT — its verified layer is visible-only', S.hasNight(140) === false,
   'a black Pacific must not be readable as a cloudless one');
ok('Meteosat GeoColour has night', S.hasNight(0) === true);
ok('IODC does NOT — natural colour only', S.hasNight(45.5) === false);

console.log('\n8. template building — two protocols');
function bySat(id) {
  for (var i = 0; i < sats.length; i++) if (sats[i].id === id) return sats[i];
  return null;
}
var wmts = S._template(bySat('goes-east'), '2026-08-14T22:40:00Z');
ok('WMTS template carries the verified layer', wmts.indexOf('GOES-East_ABI_GeoColor') > 0);
ok('WMTS template carries the verified matrix set', wmts.indexOf('GoogleMapsCompatible_Level7') > 0);
ok('WMTS template ends in the verified extension', wmts.slice(-4) === '.jpg');

var wms = S._template(bySat('mtg'), '2026-08-15T09:30:00.000Z');
ok('WMS template is a GetMap request', /request=GetMap/.test(wms));
ok('WMS template uses the bbox placeholder MapLibre substitutes',
   wms.indexOf('{bbox-epsg-3857}') > 0);
ok('WMS template asks for EPSG:3857, not 4326',
   /crs=EPSG%3A3857/.test(wms) && !/4326/.test(wms),
   '1.3.0 flips axis order for 4326 — an empty image with no error');
ok('WMS template preserves the millisecond stamp EUMETSAT reports',
   wms.indexOf('09%3A30%3A00.000Z') > 0, 'reformatting invents a time the service never had');
ok('every template is https', [wmts, wms].every(function (u) { return u.indexOf('https://') === 0; }),
   'the site is https; mixed content is blocked outright');

console.log('\n9. protocol routing');
ok('every satellite declares its protocol',
   sats.every(function (x) { return x.kind === 'wms' || x.kind === 'wmts'; }));
ok('step-back is applied to WMTS only', /kind === 'wms' \? newest : firstLiveFrame/.test(src),
   'WMS renders on demand, so its advertised time is authoritative');
ok('the EUMETSAT credit is carried alongside NASA', /EUMETSAT/.test(S.CREDIT));

console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'all ' + pass + ' passed'));
process.exitCode = fail ? 1 : 0;
