/* test_clearsky.js — sat-clearsky.php must build EXACTLY the reference the phone
   builds. Its decode is a copy of tempOf()/buildCube() in js/cloud-now.js, and
   two copies drift. This runs both over every colour step the test can afford
   and over every grey both Meteosat tables use, and checks the grid, the
   bounding box and the satellite list match.  Needs `php` on the PATH (the
   container has it; a missing php reports CANNOT RUN, not a failure).
   From the repo root:  node tools/checks/test_clearsky.js */
var fs = require('fs'), path = require('path'), vm = require('vm');
var execFileSync = require('child_process').execFileSync;
var ROOT = path.join(__dirname, '../..');
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + detail : '')); }
}

var js = fs.readFileSync(path.join(ROOT, 'js/cloud-now.js'), 'utf8');
var php = fs.readFileSync(path.join(ROOT, 'sat-clearsky.php'), 'utf8');
var sb = { window: {}, console: { log: function () {}, warn: function () {} } };
vm.createContext(sb); vm.runInContext(js, sb);
var S = sb.window.Satellite;

console.log('1. the decode: PHP copy against js/cloud-now.js');
var out = execFileSync('php', [path.join(ROOT, 'sat-clearsky.php'), 'decode-table'],
                       { maxBuffer: 64 << 20 }).toString().trim().split('\n').map(Number);
S._buildCube();
var cmapSat = { temp: 'cmap' }, d = new Uint8ClampedArray(4), k = 0, worst = 0, where = '', n = 0;
for (var r = 0; r < 256; r += 3) for (var g = 0; g < 256; g += 3) for (var b = 0; b < 256; b += 3) {
  d[0] = r; d[1] = g; d[2] = b; d[3] = 255;
  var e = Math.abs(S._tempOf(cmapSat, d, 0) - out[k++]); n++;
  if (!(e <= worst)) { worst = e; where = r + ',' + g + ',' + b; }
}
/* 1e-5, not 0: the phone's cube is a Float32Array, PHP's a double, so -30.9 is
   -30.899998 on one side. The file stores tenths of a degree. */
ok('GIBS colour map: ' + n + ' colours agree', worst < 1e-5, 'worst ' + worst + ' at rgb ' + where);
['mtg', 'iodc'].forEach(function (t) {
  var w2 = 0, at = -1;
  for (var v = 0; v < 256; v++) {
    d[0] = d[1] = d[2] = v;
    var e2 = Math.abs(S._tempOf({ temp: t }, d, 0) - out[k++]);
    if (!(e2 <= w2)) { w2 = e2; at = v; }
  }
  ok('Meteosat table ' + t + ': all 256 greys agree', w2 < 1e-9, 'worst ' + w2 + ' at grey ' + at);
});
ok('nothing left over in the PHP output', k === out.length, k + ' read of ' + out.length);

console.log('\n2. the grid and the satellites');
var m = /\$W = (\d+); \$H = (\d+);/.exec(php);
ok('grid 1024 wide, as BG_W', m && +m[1] === 1024 && /var BG_W = 1024;/.test(js));
ok('grid height as the phone computes it (566)', m && +m[2] === 566);
var jsBox = /return \{ w: (-?\d+), e: (-?\d+), s: (-?\d+), n: (-?\d+) \};/.exec(js);
ok('grid name carries the same box as bgBox()', jsBox &&
   php.indexOf("$GRID = $W . 'x' . $H . ':" + [jsBox[1], jsBox[2], jsBox[3], jsBox[4]].join(',') + "'") >= 0);
var u = S._url(S._sats()[0], '2026-01-01T00:00:00Z', { w: -180, e: 180, s: -70, n: 70 }, 1024, 566);
var jsBbox = decodeURIComponent(/BBOX=([^&]+)/.exec(u)[1]);
ok('BBOX string identical to the phone\'s', php.indexOf("$BBOX = '" + jsBbox + "'") >= 0, jsBbox);
S._sats().forEach(function (s) {
  var re = new RegExp("'" + s.id + "'\\s*=> array\\('svc' => '" + s.svc + "',\\s*'temp' => '" + s.temp +
                      "',\\s*'layer' => '" + s.layer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'\\)");
  ok('satellite ' + s.id + ': same service, decode and layer', re.test(php));
});
ok('ten frames, as BG_FRAMES', /\$FRAMES = 10;/.test(php) && /var BG_FRAMES = 10;/.test(js));
ok('frames one day apart, as BG_GAP_MIN', /\$n \* 86400/.test(php) && /var BG_GAP_MIN = 1440;/.test(js));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
