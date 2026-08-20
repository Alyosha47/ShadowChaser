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
/* Was: assert _cube is absent. That banned the colour cube, which is now how
   temperature is decoded — GIBS renders tops colder than about -12 C through a
   COLOURED section, so a grey-only ramp cannot read the deepest cloud at all.
   The test outlived the design it was written against and failed on every run,
   which protects nothing. What still matters is the rule the cube must obey:
   coloured pixels may only match coloured entries, or a desaturated pixel at a
   colour boundary lands on a grey entry, every grey entry is warm, and the
   coldest storm cores decode as clear sky. */
ok('the colour cube is built from cold entries only',
   /_cube/.test(code) && /c\[3\] >= -11\.5.*continue/.test(code));

console.log('\n3. requests cannot silently return an empty image');
var g = S._url(sats[0], '2026-08-16T11:30:00Z', '0,0,1,1', 8, 8);
var e = S._url(sats[2], '2026-08-16T11:45:00.000Z', '0,0,1,1', 8, 8);
ok('GIBS request is EPSG:3857', /EPSG%3A3857/.test(g));
/* EUMETSAT now goes through sat.php, which chooses the CRS itself (it stopped
   sending access-control-allow-origin and Now must read the pixels). So the
   client URL carries no CRS at all, and the assertion belongs on the proxy. */
ok('EUMETSAT request goes same-origin through sat.php', /^\/sat\.php\?s=eum&/.test(e));
ok('sat.php asks upstream for EPSG:3857',
   /CRS=EPSG%3A3857/.test(require('fs').readFileSync(path.join(__dirname, '../../sat.php'), 'utf8')));
ok('nothing anywhere asks for 4326 — the axis flip returns blank with no error',
   !/4326/.test(code));
ok('never falls back to a service default frame', !/time=default/i.test(code));
ok('EUMETSAT stamps keep their milliseconds', /00\.000Z/.test(e));
ok('GIBS stamps do not gain milliseconds', !/\.\d{3}Z/.test(g));
/* Was: grep for msg_fes%3Air108, a layer this module no longer requests. It
   tested the encoding by naming one specific layer, so replacing the layer
   silently retired the check. Ask the question directly instead. */
ok('colons in the layer name are encoded',
   e.indexOf('%3A') > -1 && !/LAYERS=[^&]*:/.test(e));

ok('no weight-based alpha fade — it erased Iceland, which is on the 2026 track',
   !/WFADE/.test(code));

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

console.log('\n8. the ramp is red, and that was argued for');
/* Was: assert the ramp is read from Cloud.stops(). That was the 2026-08-16
   decision and 2026-08-17 overturned it — Average's ramp is for a climatology
   on its own; this layer sits over live basemaps where white vanishes on the
   street and topographic styles, and blue is what every basemap already paints
   the ocean it mostly covers. Red was chosen knowing it partly clashes with the
   track and umbra, because those are thin lines over a filled area. Guard the
   decision that stands, not the one it replaced. */
var stops = (code.match(/\[\s*0\.00\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/) || []).slice(1).map(Number);
var deep = (code.match(/\[\s*1\.00\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/) || []).slice(1).map(Number);
ok('the ramp has both ends', stops.length === 3 && deep.length === 3);
ok('red dominates at both ends — not blue, which every basemap paints the sea',
   stops[0] > stops[2] && deep[0] > deep[2], stops.join(',') + ' / ' + deep.join(','));
ok('the deep end is not white — it vanished on the pale basemaps',
   !(deep[0] > 240 && deep[1] > 240 && deep[2] > 240), deep.join(','));
ok('opacity does not start at zero — a thin deck blocks totality too',
   !/o\[p \+ 3\] = 0\b/.test(code));

console.log('\n8b. the deleted patches stay deleted');
/* By mid-2026-08-17 this file carried a median filter, an edge feather, a share
   threshold, a shade floor, three opacity curves and a spatial ground search —
   each added to answer one screenshot, together most of the file and most of its
   errors. They were removed and the model written down instead. The handoff
   claims this suite fails if any returns; it did not, because the assertions
   were never written. They are now. */
[['median filter', /median/i],
 ['edge feather', /feather/i],
 ['share threshold', /share\s*(Thr|threshold)/i],
 ['shade floor', /shade\s*Floor/i],
 ['spatial ground search', /neighbourSearch|warmestNeighbour|groundSearch/i]
].forEach(function (h) {
  ok('no ' + h[0] + ' — patching instead of modelling is what cost the session',
     !h[1].test(code));
});

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
