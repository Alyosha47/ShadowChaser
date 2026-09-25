/* tools/checks/test_satellite.js — js/cloud-now.js, the parts that need no map
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

var src = fs.readFileSync(path.join(__dirname, '../../js/cloud-now.js'), 'utf8');
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

console.log('\n9. the contract js/cloud-ui.js actually calls');
/* This suite once passed while the strip threw on its first click, because the
   API was checked against a stale copy of cloud-now.js in the repo rather than
   against its only caller. Every name cloud-ui.js reaches for is asserted here.
   If cloudbar grows a call, add it to this list, not to a comment. */
['on', 'off', 'isOn', 'onFrame', 'shownTime', 'missing', 'invalidate', 'CREDIT']
  .forEach(function (name) {
    ok('exports ' + name, S[name] !== undefined, 'cloud-ui.js calls Satellite.' + name);
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

console.log('\n11. the caption credits fit on ONE line');
/* Both live modes print CREDIT as the last caption line. #cloudbar is
   max-width 12rem with 0.4rem padding and a 1px border, so the text column is
   12*16 - 2*6.4 - 2 = 177px. JetBrains Mono Regular is 600/1000 em advance for
   every glyph, at .cloudbar-note's 0.65rem = 10.4px, so 6.24px per character
   and 28 characters fit. `Now`'s credit began 'Imagery NASA EOSDIS GIBS ·
   EUMETSAT' — 35 chars, 218px — and wrapped, which made `Now` a line taller
   than `Pic`. The strip changing height on mode switch was reported twice.
   Character count is the whole test because the face is MONOSPACED. */
var BUDGET = 28;
[['cloud-now.js (Now)',   src],
 ['cloud-photo.js (Pic)', fs.readFileSync(path.join(__dirname, '../../js/cloud-photo.js'), 'utf8')]].forEach(function (pair) {
  var m = pair[1].match(/var CREDIT\s*=\s*'((?:[^'\\]|\\.)*)'/);
  if (!m) { ok(pair[0] + ' declares a CREDIT', false); return; }
  var text = m[1].replace(/\\u00b7/g, '\u00b7');
  ok(pair[0] + ' credit fits one line', text.length <= BUDGET,
     text.length + ' chars (budget ' + BUDGET + '): ' + text);
});

console.log('\n12. the clear-sky reference: hourly, blended to the FRAME\'s time');
/* It was kept for six hours: a six-hour-old reference read the ground 10.7 C too
   cold at midday and dropped the cloud found from 69% to 41% (2026-09-22). Then
   it followed the clock, which sits 18-50 min from GIBS's published frame. Now:
   one reference per clock hour, the two around the frame's time blended. Runs the
   SHIPPED background() with only the network and pixel reads stubbed, a clock
   the test moves, and every stub frame reading as its own hour, so the blend is
   checkable by value. */
(async function () {
  var hooked = src.replace(/\n\}\)\(\);\s*$/,
    '\n  window.__t = { background: background, hours: function (id) { return Object.keys(_bgH[id] || {}).map(Number); },' +
    ' setLoad: function (f) { loadImage = f; }, setRead: function (f) { readPixels = f; }, setTemp: function (f) { tempOf = f; } };\n})();\n');
  ok('test hook installed', hooked !== src);
  var HR = 3600000, day0 = Date.UTC(2026, 8, 22);
  var clock = { t: day0 + 12 * HR + 50 * 60000 };
  var FakeDate = function (x) { return new Date(x === undefined ? clock.t : x); };
  FakeDate.now = function () { return clock.t; }; FakeDate.UTC = Date.UTC;
  var sb2 = { window: {}, console: { log: function () {}, warn: function () {} }, Date: FakeDate,
              fetch: function () { throw new Error('tests must not hit the network'); } };
  vm.createContext(sb2); vm.runInContext(hooked, sb2);
  var T = sb2.window.__t, fetches = 0, failing = false, held = {}, release = [];
  /* An hour listed in `held` never answers until released: proves the first
     draw does not wait for it. */
  T.setLoad(function (u) {
    fetches++;
    if (failing) return Promise.reject(new Error('x'));
    var hh = +decodeURIComponent(String(u)).match(/T(\d\d):/)[1];
    if (held[hh]) return new Promise(function (r) { release.push(function () { r({ u: String(u) }); }); });
    return Promise.resolve({ u: String(u) }); });
  function letGo() { held = {}; release.splice(0).forEach(function (f) { f(); }); return new Promise(function (r) { setTimeout(r, 20); }); }
  T.setRead(function (im, w, h) {
    var d = new Uint8Array(w * h * 4); for (var i = 3; i < d.length; i += 4) d[i] = 255;
    var m = decodeURIComponent(im.u).match(/T(\d\d):(\d\d)/); d.hh = +m[1] + m[2] / 60; return d; });
  T.setTemp(function (sat, d) { return d.hh; });
  var sat = { id: 'goes-east', step: 10, svc: 'gibs', lon: -75.2, temp: 'cmap' };
  function near(x, y) { return Math.abs(x - y) < 1e-4; }

  held[13] = true;
  var a0 = await T.background(sat, day0 + 12 * HR + 20 * 60000);
  ok('cold start, frame 12:20: drawn from the NEARER hour (12) while hour 13 has not answered',
     !!a0 && near(a0.T[0], 12), a0 && a0.T[0]);
  ok('... both hours requested: 10 + 9 (today\'s 13:00 not yet published)', fetches === 19, fetches + ' fetches');
  await letGo();
  var a = await T.background(sat, day0 + 12 * HR + 20 * 60000);
  ok('next render of the same frame: blended a third of the way, 12.333', !!a && near(a.T[0], 12 + 1 / 3) && fetches === 19, a && a.T[0]);
  var b = await T.background(sat, day0 + 12 * HR + 40 * 60000);
  ok('frame 12:40: same hours, nothing fetched', fetches === 19, fetches + ' fetches');
  ok('... blended two thirds: 12.667', !!b && near(b.T[0], 12 + 2 / 3), b && b.T[0]);
  ok('same frame again: the same field, not rebuilt', (await T.background(sat, day0 + 12 * HR + 40 * 60000)) === b);
  clock.t = day0 + 13 * HR + 40 * 60000;
  held[14] = true;
  var c0 = await T.background(sat, day0 + 13 * HR + 10 * 60000);
  ok('frame 13:10: nearer hour 13 is cached — drawn at once while hour 14 has not answered', !!c0 && near(c0.T[0], 13), c0 && c0.T[0]);
  await letGo();
  var c = await T.background(sat, day0 + 13 * HR + 10 * 60000);
  ok('... hour 14 fetched behind it (9 frames), then blended: 13.167', fetches === 28 && !!c && near(c.T[0], 13 + 1 / 6), fetches + ' fetches, ' + (c && c.T[0]));
  ok('only the two hours in use are kept', T.hours('goes-east').sort().join() === [13 * HR + day0, 14 * HR + day0].join(),
     T.hours('goes-east').map(function (h) { return (h - day0) / HR; }).join());
  clock.t = day0 + 16 * HR + 40 * 60000; failing = true;
  var d = await T.background(sat, day0 + 16 * HR + 10 * 60000);
  ok('both hours fail: the last field is kept (a missing one reads as clear sky)', d === c, String(d));
  failing = false;
  var e = await T.background(sat, day0 + 16 * HR + 10 * 60000);
  ok('... and the next call retries and succeeds', !!e && near(e.T[0], 16), e && e.T[0]);

  console.log('\n13. a satellite that went missing is retried soon (js/cloud-ui.js)');
  /* GIBS drops ~1 request in 5; when one satellite's all fail its band is blank
     for five minutes ("No Himawari", seen live 2026-09-23). Runs the SHIPPED
     retryMissing() with fake timers and a stub Satellite. */
  var cuSrc = fs.readFileSync(path.join(__dirname, '../../js/cloud-ui.js'), 'utf8');
  var cuHooked = cuSrc.replace(/function retryMissing\(\) \{/,
    'window.__cu = { retry: function () { return retryMissing(); }, mode: function (m) { _mode = m; }, n: function () { return _retries; } };\n  function retryMissing() {');
  ok('cloud-ui test hook installed', cuHooked !== cuSrc);
  var timers = [], inval = 0, miss = ['Himawari'];
  var sb3 = { window: {}, console: { log: function () {}, warn: function () {} },
    document: { readyState: 'loading', visibilityState: 'visible', addEventListener: function () {},
                getElementById: function () { return null; } },
    setTimeout: function (f, ms) { timers.push({ f: f, ms: ms }); return timers.length; },
    clearTimeout: function () {}, setInterval: function () {} };
  sb3.window.Satellite = { missing: function () { return miss.slice(); },
    invalidate: function () { inval++; return Promise.resolve(true); } };
  sb3.Satellite = sb3.window.Satellite;   /* in a browser window IS the global */
  vm.createContext(sb3); vm.runInContext(cuHooked, sb3);
  var CU = sb3.window.__cu;
  CU.mode('now'); CU.retry();
  ok('missing after a pass: one retry scheduled, at 30 s', timers.length === 1 && timers[0].ms === 30000, JSON.stringify(timers.map(function (t) { return t.ms; })));
  CU.retry();
  ok('... not doubled by a second announce', timers.length === 1);
  timers.shift().f(); await new Promise(function (r) { setTimeout(r, 5); });
  ok('the retry refreshes through invalidate()', inval === 1, inval);
  CU.retry();
  ok('still missing: a second retry, at 90 s', timers.length === 1 && timers[0].ms === 90000);
  timers.shift().f(); CU.retry();
  ok('then it stops — two retries per scheduled refresh', timers.length === 0 && inval === 2, inval);
  miss = []; CU.retry();
  ok('nothing missing: the count resets', CU.n() === 0);
  miss = ['Himawari']; CU.mode('avg'); CU.retry();
  ok('not in Now: no retry', timers.length === 0);
  CU.mode('now'); CU.retry(); CU.mode('photo'); timers.shift().f();
  ok('mode changed before it fired: no refresh', inval === 2, inval);

  console.log('\n14. the reference from sat-clearsky.php, and the fallback to the phone');
  /* The server builds the reference once per satellite-hour; the phone must use
     it when it is right and build its own on ANY problem, never draw nothing. */
  var zlib = require('zlib');
  var BW = 1024, BH = 566, GRID = BW + 'x' + BH + ':-180,180,-70,70';
  var i16 = new Int16Array(BW * BH);
  for (var q = 0; q < i16.length; q++) i16[q] = (q % 1000) - 500;
  i16[7] = -32768;
  var gzOK = zlib.gzipSync(Buffer.from(i16.buffer));
  async function run14(resp) {
    var hooked4 = src.replace(/\n\}\)\(\);\s*$/,
      '\n  window.__t = { hourRef: hourRef, setLoad: function (f) { loadImage = f; },' +
      ' setRead: function (f) { readPixels = f; }, setTemp: function (f) { tempOf = f; } };\n})();\n');
    var urls = [], loads = 0;
    var sb4 = { window: {}, console: { log: function () {}, warn: function () {} },
      Response: Response, DecompressionStream: DecompressionStream,
      fetch: function (u) {
        urls.push(u);
        if (!resp) return Promise.reject(new Error('offline'));
        return Promise.resolve({ ok: resp.status === 200, status: resp.status,
          headers: { get: function (k) { return k === 'X-Clearsky-Grid' ? resp.grid : null; } },
          body: new Response(resp.body).body });
      } };
    vm.createContext(sb4); vm.runInContext(hooked4, sb4);
    var T4 = sb4.window.__t;
    T4.setLoad(function () { loads++; return Promise.resolve({}); });
    T4.setRead(function (im, w, h) { var d = new Uint8Array(w * h * 4); for (var i = 3; i < d.length; i += 4) d[i] = 255; return d; });
    T4.setTemp(function () { return 7; });
    var H = Date.UTC(2026, 8, 22, 12);
    var rec = await T4.hourRef({ id: 'goes-east', step: 10, svc: 'gibs', temp: 'cmap', layer: 'x' }, H);
    return { rec: rec, urls: urls, loads: loads };
  }
  var a14 = await run14({ status: 200, grid: GRID, body: gzOK });
  ok('asks sat-clearsky.php for that satellite and hour', a14.urls[0] === '/sat-clearsky.php?s=goes-east&h=2026-09-22T12', a14.urls[0]);
  ok('server answer used: no frames fetched by the phone', a14.loads === 0 && a14.rec && a14.rec.src === 'server', a14.loads + ' ' + (a14.rec && a14.rec.src));
  ok('decoded: tenths of a degree, little-endian', a14.rec && a14.rec.T[0] === -50 && Math.abs(a14.rec.T[501] - 0.1) < 1e-6 && Math.abs(a14.rec.T[999] - 49.9) < 1e-5,
     a14.rec && [a14.rec.T[0], a14.rec.T[501], a14.rec.T[999]].join());
  ok('-32768 decodes as "no data" (-999), as the phone\'s own build', a14.rec && a14.rec.T[7] === -999);
  var cases = [['server error 502', { status: 502, grid: GRID, body: gzOK }],
               ['a different grid', { status: 200, grid: '512x283:-180,180,-70,70', body: gzOK }],
               ['a truncated file', { status: 200, grid: GRID, body: zlib.gzipSync(Buffer.alloc(1000)) }],
               ['not gzip at all', { status: 200, grid: GRID, body: Buffer.from('<html>error</html>') }],
               ['offline', null]];
  for (var c = 0; c < cases.length; c++) {
    var r14 = await run14(cases[c][1]);
    ok(cases[c][0] + ': falls back to building on the phone (10 frames)',
       r14.rec && r14.rec.src === 'phone' && r14.loads === 10 && r14.rec.T[0] === 7,
       (r14.rec && r14.rec.src) + ', ' + r14.loads + ' frames');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
