/* tools/checks/test_satellite.js — js/satellite.js, the parts that need no map
 * and no network. Resolves its input two levels up, like every suite here.
 *
 * REWRITTEN for the composite architecture. The old suite asserted things that
 * no longer exist: pick(), per-longitude satellite choice, WMTS templates,
 * GeoColor layer names. It is not repairable, because what it tested was the
 * design that failed.
 *
 * The failure mode this guards against is unchanged and still nasty: a wrong
 * layer identifier, a stale timestamp, a non-monotone calibration or a texture
 * MapLibre samples as black all render with NO error. On a tool for deciding
 * where to stand under an eclipse, a blank cloud layer reads as "clear sky
 * everywhere", which is the most dangerous thing this app can say.
 */
'use strict';

var fs = require('fs'), path = require('path'), vm = require('vm');
var pass = 0, fail = 0;
function ok(n, c, x) {
  if (c) { pass++; console.log('  PASS ' + n); }
  else { fail++; console.log('  FAIL ' + n + (x ? '  \u2192 ' + x : '')); }
}

var src = fs.readFileSync(path.join(__dirname, '../../js/satellite.js'), 'utf8');
var sb = { window: {}, console: console,
           fetch: function () { throw new Error('tests must not hit the network'); } };
vm.createContext(sb); vm.runInContext(src, sb);
var S = sb.window.Satellite;

/* Comments describe failures as often as they cause them, so assertions about
   what the file does must never be able to match its own prose. An early suite
   "proved" nothing was proxied by matching the comment warning against it. */
var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\n1. module shape');
ok('exports on window.Satellite', !!S);
ok('carries a version stamp', !!S && /^\d{4}-\d{2}-\d{2}[a-z]+$/.test(S.version), S && S.version);
ok('credits both providers', !!S && /GIBS/.test(S.CREDIT) && /EUMETSAT/.test(S.CREDIT));
ok('loads without touching the DOM', true);   /* it composites on a canvas, but only
                                                 lazily — proved by this file running */

console.log('\n2. only enumerated layer names ship');
var sats = S._sats(), ids = sats.map(function (s) { return s.id; });
ok('five satellites', sats.length === 5, String(sats.length));
ok('every sub-point is on the equator ring', sats.every(function (s) {
  return Math.abs(s.lon) <= 180 && isFinite(s.lon);
}));
ok('all layers are infrared, none are imagery products',
   sats.every(function (s) { return /ir10|Clean_Infrared/i.test(s.layer); }),
   sats.map(function (s) { return s.layer; }).join(' '));
ok('no GeoColor anywhere — it is a picture, not a field',
   !/GeoColor/i.test(code));
ok('no palette decode survives — it compressed Himawari 117 levels to 49',
   !/CMAP|_cube/.test(code));

console.log('\n3. requests cannot silently return an empty image');
var g = S._url(sats[0], '2026-08-16T11:30:00Z', '0,0,1,1', 8, 8);
var e = S._url(sats[2], '2026-08-16T11:45:00.000Z', '0,0,1,1', 8, 8);
ok('GIBS request is EPSG:3857', /EPSG%3A3857/.test(g));
ok('EUMETSAT request is EPSG:3857', /EPSG%3A3857/.test(e));
ok('nothing anywhere asks for 4326 — the axis flip returns blank with no error',
   !/4326/.test(code));
ok('never falls back to a service default frame', !/time=default/i.test(code));
ok('EUMETSAT stamps keep their milliseconds', /00\.000Z/.test(e));
ok('GIBS stamps do not gain milliseconds', !/\.\d{3}Z/.test(g));
ok('colons in the layer name are encoded', /msg_fes%3Air108/.test(e));

console.log('\n4. calibration tables are usable');
var luts = S._luts, k, lut, i, mono, inRange;
ok('GOES-East has no LUT, because it is the reference scale', !luts['goes-east']);
ok('every other satellite has one',
   ids.filter(function (id) { return id !== 'goes-east'; })
      .every(function (id) { return !!luts[id]; }));
for (k in luts) {
  lut = luts[k]; mono = true; inRange = true;
  for (i = 1; i < lut.length; i++) if (lut[i] < lut[i - 1]) mono = false;
  for (i = 0; i < lut.length; i++) if (!(lut[i] >= 0 && lut[i] <= 255)) inRange = false;
  ok(k + ' LUT has 256 entries', lut.length === 256, String(lut.length));
  ok(k + ' LUT is monotone — a fold would map two brightnesses to one value', mono);
  ok(k + ' LUT stays in 0-255', inRange);
}

console.log('\n4b. cloud fraction is derived per satellite, in its own units');
var fl = S._floors();
ok('every satellite has its own floor', ids.every(function (id) { return fl[id] > 0; }),
   JSON.stringify(fl));
ok('GOES and Meteosat floors differ substantially — no single constant fits both',
   Math.abs(fl['goes-east'] - fl['msg']) > 0.25,
   fl['goes-east'] + ' vs ' + fl['msg']);
ok('no weight-based alpha fade — it erased Iceland, which is on the 2026 track',
   !/WFADE/.test(code));

console.log('\n5. every satellite is read in its own native units');
var cm = S._cmap;
ok('the colour map table is gone with the decode that used it', cm === undefined);

console.log('\n6. the raster cannot sample as black');
var r = S._raster();
function pow2(n) { return (n & (n - 1)) === 0; }
ok('raster is not square-and-power-of-two',
   !(r.w === r.h && pow2(r.w) && pow2(r.h)), r.w + 'x' + r.h);
ok('raster is wider than tall, as Mercator clipped in latitude must be', r.w > r.h);
ok('latitude clip matches where the ring stops seeing', r.latLimit === 75, String(r.latLimit));
/* The hole at the pole was a hard cut, not missing data. Assert the ring closes
   at every longitude out to the raster edge, so a scalloped gap cannot come back
   unnoticed the next time the limb angle is tuned. */
var worst = 90, lat, lon, c, best;
for (lat = 0; lat <= r.latLimit; lat += 1) {
  for (lon = -180; lon < 180; lon += 2) {
    if (!S.coverage(lon, lat).ok) { worst = Math.min(worst, lat); }
  }
}
ok('coverage reaches the raster edge at every longitude', worst >= r.latLimit,
   'first gap at ' + worst + ' deg');

console.log('\n7. coverage answers from geometry, and knows about latitude');
var holes = [], L;
for (L = -180; L < 180; L += 1) if (!S.coverage(L, 0).ok) holes.push(L);
ok('no gap in the ring at the equator', holes.length === 0, holes.slice(0, 8).join(','));
holes = [];
for (L = -180; L < 180; L += 1) if (!S.coverage(L, 60).ok) holes.push(L);
ok('no gap at 60 degrees, where the 2026 track runs', holes.length === 0, holes.slice(0, 8).join(','));
ok('reports honestly that there is nothing to show at the pole',
   !S.coverage(0, 85).ok && S.coverage(0, 85).reason === 'too-far-north');
ok('wraps longitudes rather than falling off the end',
   S.coverage(-433, 0).ok && String(S.coverage(180, 0).ok) === String(S.coverage(-180, 0).ok));

console.log('\n8. the palette is borrowed, never copied');
ok('reads Cloud.stops() rather than carrying its own stops', /Cloud\.stops\(\)/.test(code));
ok('no second stops table lives here', !/\[\s*0\.00\s*,/.test(code));
ok('stays off, rather than inventing a ramp, if Cloud is too old',
   /_err\s*=\s*'Cloud\.stops\(\) missing/.test(src));

console.log('\n9. the contract js/cloudbar.js actually calls');
/* This suite once passed while the strip threw on its first click, because the
   API was checked against a stale copy of satellite.js in the repo rather than
   against its only caller. Every name cloudbar.js reaches for is asserted here.
   If cloudbar grows a call, add it to this list, not to a comment. */
['on', 'off', 'isOn', 'onFrame', 'shownTime', 'missing', 'invalidate', 'CREDIT']
  .forEach(function (name) {
    ok('exports ' + name, S[name] !== undefined, 'cloudbar.js calls Satellite.' + name);
  });
ok('onFrame accepts a callback without a map', (function () {
  try { S.onFrame(function () {}); return true; } catch (err) { return false; }
})());
ok('missing() returns an array before any fetch', Object.prototype.toString.call(S.missing()) === '[object Array]');
ok('invalidate() returns a promise even with no map',
   S.invalidate() && typeof S.invalidate().then === 'function');

console.log('\n10. staleness is checked, not trusted');
ok('a maximum age is enforced', /MAX_AGE_MIN/.test(code));
ok('frames are stepped back through until one loads', /MAX_STEPS/.test(code));
ok('shownTime reports the frame over the map centre, not the global oldest',
   /getCenter\(\)/.test(code) && /bw/.test(code));
ok('and falls back to the oldest when there is no map to ask',
   /_stamps\[i\]\.at < t\.at/.test(code));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
