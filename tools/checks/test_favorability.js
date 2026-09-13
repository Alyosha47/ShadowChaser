/* tools/checks/test_favorability.js — js/favorability.js, the parts that need
 * no map. Resolves its input two levels up, like every suite here.
 *
 * WHAT THIS IS REALLY GUARDING
 *   The score layer decides which cells are inside the CENTRAL PATH by asking
 *   the eclipse engine per cell. Four previous attempts to answer that with a
 *   corridor POLYGON all failed on polar paths, and map.js still has corridor
 *   fill disabled because of it. Section 3 below is the regression guard against
 *   anyone reintroducing a ring: it samples the 2026-08-12 Arctic leg, which is
 *   exactly the case every polygon approach broke on.
 *
 *   The other failure mode is quiet wrongness. A duration that is silently 20%
 *   low, or a corridor that silently excludes hybrids, renders perfectly and
 *   tells someone to stand in the wrong field. So section 2 checks the score's
 *   own arithmetic against the FULL engine rather than against itself.
 */
'use strict';

var fs = require('fs'), path = require('path'), vm = require('vm');
var pass = 0, fail = 0;
function ok(n, c, x) {
  if (c) { pass++; console.log('  PASS ' + n); }
  else { fail++; console.log('  FAIL ' + n + (x ? '  \u2192 ' + x : '')); }
}

var ROOT = path.join(__dirname, '../..');
var src = fs.readFileSync(path.join(ROOT, 'js/favorability.js'), 'utf8');
var ec  = require(path.join(ROOT, 'js/eclipse.js'));

/* The module wires itself to AppState and expects map globals. Give it neither:
   every wiring block is guarded, so it must load cleanly headless. */
var sb = { window: {}, console: console,
           findMaximum: ec.findMaximum,
           fundamentalArgs: ec.fundamentalArgs,
           sunAltAz: ec.sunAltAz,
           fetch: function () { throw new Error('tests must not hit the network'); } };
vm.createContext(sb);
vm.runInContext(src, sb);
var D = sb.window.Favorability;

/* Comments describe failures as often as they cause them, so assertions about
   what the file DOES must never be able to match its own prose. */
var code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

var chunk = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/besselian/2001_2100.json'), 'utf8'));
function rec(y, m, d) {
  return chunk.find(function (r) { return r.year === y && r.month === m && r.day === d; });
}
var R2026 = rec(2026, 8, 12);

/* The module's own cell maths, re-expressed here from the SAME primitives, so
   the suite can exercise the physics without a map. If these drift apart the
   comparisons below stop meaning anything, so section 2 pins them to the full
   engine, which is the independent reference. */
function cell(r, lat, lon) {
  var lw = -lon;
  var t = ec.findMaximum(r, lat, lw, 0, r.dt);
  if (!isFinite(t)) return null;
  var o = ec.fundamentalArgs(r, t, lat, lw, 0, r.dt);
  var m = Math.sqrt(o.u * o.u + o.v * o.v), a2 = Math.abs(o.L2p);
  if (!(m < a2)) return null;
  var s = ec.sunAltAz(o, lat);
  if (!(s.alt > 0)) return null;          /* antipodal shadow — see section 3 */
  return { dur: 2 * Math.sqrt(a2 * a2 - m * m) / o.n * 3600, alt: s.alt };
}

console.log('\n1. module shape');
ok('exports on window.Favorability', !!D);
ok('carries a version stamp', !!D && /^\d{4}-\d{2}-\d{2}[a-z]+$/.test(D.version), D && D.version);
ok('loads with no map and no DOM', true);          /* proved by getting here */
ok('exposes sampleAt for the readout', !!D && typeof D.sampleAt === 'function');
ok('sampleAt returns null before any render', !!D && D.sampleAt(-3.4, 42) === null);
ok('exposes the palette so a legend cannot drift from the pixels',
   !!D && Array.isArray(D.stops()) && D.stops().length > 2);
ok('starts in whole-path normalisation', !!D && D.getMode() === 'path');
ok('exposes a debug readout for the view stretch', !!D && typeof D.debug === 'function');
ok('debug reports the mode and both stretches',
   (function () { var d = D && D.debug(); return !!d && 'viewLo' in d && 'pathLo' in d && 'mode' in d; })());
/* "This view" stretches on the 2nd-98th PERCENTILE of what is on screen. Min/max
   lets one anomalous cell own the ramp, and the limb cells sit at ~0, so min is
   almost always 0 and the stretch does less than it looks like it should. */
ok('view mode stretches on percentiles, not min/max',
   /_nsamp \* 0\.02/.test(code) && /_nsamp \* 0\.98/.test(code));
ok('the view repaint is skipped when the range has not moved',
   /Math\.abs\(r\.lo - _viewLo\) > /.test(code));

console.log('\n1b. eclipse.js must expose the SAME api to a browser as to Node');
/* THE GAP THIS CLOSES. eclipse.js is UMD. Every check in tools/checks runs under
   Node and takes the module.exports branch, so nothing here had ever executed
   the browser branch — which listed its globals BY HAND and had missed refT0.
   Result: favorability.js passed every test and threw "refT0 is not defined" in
   the browser. Load it the way a browser does and compare. */
(function () {
  var sb = {}; sb.self = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/eclipse.js'), 'utf8'), sb);
  var missing = Object.keys(ec).filter(function (k) { return typeof sb[k] !== typeof ec[k]; });
  ok('browser globals match the Node exports', missing.length === 0,
     missing.length ? 'missing: ' + missing.join(', ') : String(Object.keys(ec).length) + ' names');
  ok('refT0 in particular reaches the browser', typeof sb.refT0 === 'function');
})();

console.log('\n2. the score arithmetic, against the FULL engine');
/* HANDOFF 6's standard regression point: 2026-08-12 at 41.9851N 3.4186W,
   deliberately a very low sun — the case that broke Cesium's native shadows. */
var g = cell(R2026, 41.9851, -3.4186);
var full = ec.computeEclipse(R2026, 41.9851, -3.4186, 0);
ok('regression point is inside the corridor', !!g);
ok('duration matches the engine within 1 s',
   !!g && Math.abs(g.dur - full.durCentral) < 1,
   g && (g.dur.toFixed(2) + ' vs ' + full.durCentral.toFixed(2)));
ok('sun altitude matches the engine within 0.2 deg',
   !!g && Math.abs(g.alt - full.sun.alt) < 0.2,
   g && (g.alt + ' vs ' + full.sun.alt));

/* The whole design rests on the semi-duration formula agreeing with the engine
   everywhere the score is NON-ZERO. Where they disagree the sun is on the
   horizon, the engine is clipping duration at sunset, and A is exactly 0. */
var n = 0, bad = 0, worstAlt = -99;
for (var la = -88; la <= 88; la += 1.3) {
  for (var lo = -180; lo < 180; lo += 1.3) {
    var c = cell(R2026, la, lo);
    if (!c) continue;
    var f = ec.computeEclipse(R2026, la, lo, 0);
    if (!f.visible || !f.durCentral) continue;
    n++;
    if (Math.abs(c.dur - f.durCentral) > 1) {
      bad++;
      if (f.sun.alt > worstAlt) worstAlt = f.sun.alt;
    }
  }
}
ok('sampled a real corridor', n > 200, n + ' cells');
ok('every duration disagreement is a horizon cell, where A is 0',
   bad === 0 || worstAlt <= 2,
   bad + ' of ' + n + ' disagree, highest sun altitude ' + worstAlt.toFixed(1) + ' deg');

console.log('\n3. corridor membership — THE POLYGON REGRESSION GUARD');
/* A point known to be PARTIAL must score nothing. Madrid on 2026-08-12. */
var mad = ec.computeEclipse(R2026, 40.4, -3.7, 0);
ok('Madrid 2026-08-12 is partial, per the engine', mad.type === 'partial', mad.type);
ok('a partial point is NOT in the corridor', cell(R2026, 40.4, -3.7) === null);

/* THE POLAR CASE. 2026-08-12 runs over the Arctic, and this is precisely where
   every corridor-polygon attempt broke: crossing a pole the north and south
   limits swap sides, so a ring wraps instead of closing. Per-cell membership
   has no ring and must simply work. A GAP here means someone has reintroduced
   geometry that cannot survive the pole. */
var arctic = 0, gaps = 0, seen = false;
for (var lat2 = 68; lat2 <= 88; lat2 += 0.5) {
  var got = false;
  for (var lon2 = -180; lon2 < 180; lon2 += 0.5) {
    if (cell(R2026, lat2, lon2)) { got = true; arctic++; }
  }
  if (got) seen = true; else if (seen) gaps++;
}
ok('the Arctic leg has central cells', arctic > 100, arctic + ' cells above 68N');
ok('no gap in the polar corridor once it has started', gaps === 0, gaps + ' gap rows');

/* Longitude convention. eclipse.js takes EAST-POSITIVE and negates internally;
   getting this backwards puts the whole corridor in the wrong hemisphere and
   still renders a plausible-looking ribbon. */
ok('corridor is in the WEST at 42N (Spain), not the east',
   !!cell(R2026, 42, -3) && !cell(R2026, 42, 3));

/* THE ANTIPODAL SHADOW — this shipped once and drew a band right round the
   planet. (u,v) is the observer's offset from the shadow axis projected onto the
   fundamental plane, and that projection cannot tell which SIDE of the Earth the
   observer is on: the axis extended through the globe emerges on the far side,
   so the antipode passes m < |L2'| while sitting in the middle of the night.
   It hid because such a cell scores exactly 0, and 0 is a legitimate colour —
   the ramp's worst — so it painted a confident dark-red ring instead of an
   obvious glitch. A score of zero and no eclipse at all must look different. */
ok('Armenia 38N 40E is night on 2026-08-12, per the engine',
   ec.computeEclipse(R2026, 38, 40, 0).visible === false);
ok('the antipodal shadow is NOT drawn as corridor', cell(R2026, 38, 40) === null);
ok('every corridor cell has the sun above the horizon',
   (function () {
     for (var la = -88; la <= 88; la += 1.7)
       for (var lo = -180; lo < 180; lo += 1.7) {
         var c = cell(R2026, la, lo);
         if (c && !(c.alt > 0)) return false;
       }
     return true;
   })());

/* Agreement with the full engine on membership. Anything below ~99% means the
   two have diverged on what "central" is. */
var both = 0, same = 0;
for (var la3 = -88; la3 <= 88; la3 += 1.5) {
  for (var lo3 = -180; lo3 < 180; lo3 += 1.5) {
    var mine = !!cell(R2026, la3, lo3);
    var f3 = ec.computeEclipse(R2026, la3, lo3, 0);
    var eng = f3.visible && (f3.type === 'total' || f3.type === 'annular' || f3.type === 'hybrid');
    if (mine || eng) { both++; if (mine === eng) same++; }
  }
}
ok('membership agrees with the full engine', both > 100 && same / both > 0.98,
   same + '/' + both + ' = ' + (100 * same / both).toFixed(1) + '%');

console.log('\n4. the traps this file must not lose');
ok('passes an explicit elevation to the engine, never omitting it',
   /findMaximum\(\s*_rec\s*,\s*lat\s*,\s*lw\s*,\s*0\s*,/.test(code) &&
   /fundamentalArgs\(\s*_rec\s*,\s*t\s*,\s*lat\s*,\s*lw\s*,\s*0\s*,/.test(code));
ok('membership is on the GEOMETRY, not on the type string (hybrids)',
   !/type\s*===\s*['"](total|annular)['"]/.test(code));
ok('rejects the antipodal shadow in the module itself',
   /sun\.alt\s*>\s*0/.test(code));
/* WORD BOUNDARIES MATTER HERE and cost two false failures. Unanchored, `ring`
   matches "String" and "during", and `polygon` had to be checked against code
   that legitimately mentions neither. An assertion that fires on correct code
   is worse than none — it trains you to ignore the suite. */
ok('builds NO corridor polygon',
   !/\bpolygon\b|\bring\b|\bwinding\b|antimeridianSplit/i.test(code));
ok('keeps the power-of-two canvas guard', /_safeSize/.test(code) && /h -= 1/.test(code));
ok('keeps _drawnKey, so a canvas drawn for another eclipse is rejected',
   /_drawnKey\s*!==\s*_eclipseKey/.test(code));
ok('keeps _againForce, so a deferred forced render stays forced',
   /_againForce/.test(code));
ok('keeps two canvases (base survives the gesture)',
   /_canvasB/.test(code) && /movestart/.test(code));
/* The detail canvas is georeferenced, so it stays correct at any zoom. Dropping
   to the coarse world canvas the instant a gesture starts — which is what this
   did at first — is what made pan and zoom look blocky. It must only fall back
   when the view actually LEAVES the drawn box. */
ok('keeps the sharp canvas while it still covers the view',
   /_stillCovers/.test(code) && /_swap\(_stillCovers\(\)\)/.test(code));
ok('re-checks coverage DURING the gesture, not just at its start',
   /map\.on\('move',/.test(code));
/* There is only ONE canvas, drawn for wherever the map last stopped, so a zoom
   stretches it into soft blobs — the upscaling signature. Real tiles have a set
   per zoom level; the cheap equivalent is a reduced-budget redraw mid-gesture. */
ok('redraws mid-gesture at a reduced budget',
   /BUDGET_MOVE/.test(code) && /_moving \? BUDGET_MOVE : BUDGET/.test(code));
ok('the mid-gesture trigger is a named knob, not a buried number',
   /MOVE_ZOOM_DRIFT/.test(code));
/* View mode costs two passes. Mid-gesture that is the wrong place to spend it —
   better a frame-old stretch than a coarser picture. */
ok('view mode takes its second pass only at rest',
   /_mode === 'view' && !_moving/.test(code));
ok('the mid-gesture redraw is throttled by _busy, so it cannot pile up',
   /if \(_busy\) return;[\s\S]{0,160}_render\(true\)/.test(code));
ok('a mid-gesture render SHOWS what it just drew',
   /_swap\(_moving \? _stillCovers\(\) : true\)/.test(code));
ok('tears down with ONE try per removal',
   (code.match(/try\s*\{[^}]*remove(Layer|Source)/g) || []).length >= 4);
ok('goes through Cloud.ensureSlices, not straight to sampleAt',
   /Cloud\.ensureSlices/.test(code));

console.log('\n4a. the corridor mask must never EXCLUDE real corridor');
/* The mask is a proximity envelope stamped along ep.centreline, used to reject
   cells before the engine is asked. It is a SUPERSET by design — the engine
   still decides membership — so the only fatal error is excluding something
   real, which would drop stretches of path with no error at all.
   Built from the module's own source, so the two cannot drift. */
(function () {
  var zlib = require('zlib'), gz = path.join(ROOT, 'data/paths/paths_2001_2100.json.gz');
  if (!fs.existsSync(gz)) {
    console.log('  SKIP  path chunks absent (they are build artefacts)');
    return;
  }
  var paths = JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)));
  var body = src.match(/var MASK_DEG[\s\S]*?function _near\(lat, lon\) \{[\s\S]*?\n  \}/);
  ok('the mask code is findable in the module', !!body);
  if (!body) return;
  var f = new Function(body[0] +
    '; return { build:_buildMask, near:_near, set:function(m){_mask=m;} };')();

  [[2026,8,12,'2026-08-12 polar'], [2027,8,2,'2027-08-02'],
   [2028,7,22,'2028-07-22'], [2031,11,14,'2031-11-14 hybrid']].forEach(function (t) {
    var r = rec(t[0], t[1], t[2]), ep = null, k;
    for (k in paths) {
      var e = paths[k];
      if (e.year === t[0] && e.month === t[1] && e.day === t[2]) { ep = e; break; }
    }
    if (!r || !ep) { console.log('  SKIP  ' + t[3] + ' not in this chunk'); return; }
    f.set(f.build(ep));
    var inside = 0, missed = 0;
    for (var la = -89; la <= 89; la += 0.6) {
      for (var lo = -180; lo < 180; lo += 0.6) {
        var c = cell(r, la, lo);
        if (!c) continue;
        inside++;
        if (!f.near(la, lo)) missed++;
      }
    }
    ok(t[3] + ': mask excludes no corridor cell', inside > 20 && missed === 0,
       missed + ' of ' + inside + ' missed');
  });
})();
/* \bring\b, not ring\b — the latter matches "during" and "rendering", which is
   how this assertion first failed against perfectly correct code. */
/* The render box is shrunk to where there IS corridor, not to a guess at what
   the user can see. getBounds() is NOT wrong on a globe — you are looking at a
   spherical cap and its lat/lon rectangle genuinely is vast — so clamping it to
   a zoom-derived span was a patch that would have left the limb undrawn. */
ok('the box is shrunk to the corridor, from the mask', /_corridorBox\(w, e, s, n\)/.test(code));
ok('the corridor box is padded OUTWARD so it cannot clip its own corridor',
   /lo - padLon/.test(code) && /hi \+ padLon/.test(code));
ok('no zoom-derived clamp on the viewport', !/512 \* Math\.pow\(2, map\.getZoom/.test(code));
ok('the mask is built from the centreline, not a polygon',
   /centreline/.test(code) && !/\bwinding\b|\bring\b|\bpolygon\b/i.test(code));
ok('polar longitudes fall back to the whole row rather than dividing by cos',
   /Math\.abs\(lat\) > 85/.test(code));

console.log('\n4b. the two-level draw must not skip corridor');
/* _draw() samples a coarse lattice and refines only blocks that touch the
   corridor. If the lattice is ever coarser than the ribbon is wide, whole
   stretches of path vanish with NO error — the failure would look like a data
   problem. BS is therefore derived in DEGREES, not pixels. This reproduces the
   lattice and asserts it finds every cell a full-resolution pass would. */
(function () {
  var W = 240, H = 200, w = -30, e = 10, so = 35, no = 68;
  function mY(l){ return Math.log(Math.tan(Math.PI/4 + l*Math.PI/360)); }
  function iY(y){ return (2*Math.atan(Math.exp(y)) - Math.PI/2)*180/Math.PI; }
  var lons = [], lats = [], yN = mY(no), yS = mY(so), x, y;
  for (x = 0; x < W; x++) lons.push(w + (x+0.5)/W*(e-w));
  for (y = 0; y < H; y++) lats.push(iY(yN + (y+0.5)/H*(yS-yN)));
  var full = 0;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) if (cell(R2026, lats[y], lons[x])) full++;

  var deg = Math.abs(e-w)/W, BS = Math.floor(0.4/deg);
  if (!(BS > 1)) BS = 2; if (BS > 24) BS = 24;
  var bw = Math.ceil(W/BS), bh = Math.ceil(H/BS), flag = new Uint8Array(bw*bh), bx, by;
  for (by = 0; by < bh; by++) for (bx = 0; bx < bw; bx++) {
    var px = Math.min(W-1, bx*BS + (BS>>1)), py = Math.min(H-1, by*BS + (BS>>1));
    if (cell(R2026, lats[py], lons[px])) { flag[by*bw+bx] = 1; continue; }
    px = Math.min(W-1, bx*BS); py = Math.min(H-1, by*BS);
    if (cell(R2026, lats[py], lons[px])) flag[by*bw+bx] = 1;
  }
  var grow = new Uint8Array(bw*bh);
  for (by = 0; by < bh; by++) for (bx = 0; bx < bw; bx++) {
    if (!flag[by*bw+bx]) continue;
    for (var dy=-1; dy<=1; dy++) for (var dx=-1; dx<=1; dx++) {
      var nx=bx+dx, ny=by+dy;
      if (nx>=0&&nx<bw&&ny>=0&&ny<bh) grow[ny*bw+nx]=1;
    }
  }
  var got = 0;
  for (by = 0; by < bh; by++) for (bx = 0; bx < bw; bx++) {
    if (!grow[by*bw+bx]) continue;
    var x1 = Math.min(W, bx*BS+BS), y1 = Math.min(H, by*BS+BS);
    for (y = by*BS; y < y1; y++) for (x = bx*BS; x < x1; x++)
      if (cell(R2026, lats[y], lons[x])) got++;
  }
  ok('the coarse lattice found real corridor', full > 500, full + ' cells');
  ok('two-level finds EVERY cell a full pass would', got === full, got + ' of ' + full);
})();
ok('block size is derived in degrees, not pixels', /0\.4\s*\/\s*\(?degPerPx/.test(code));
/* Canvas size is a BUDGET, not a fixed cap. A fixed cap is the wrong instrument:
   the cost is the pixels NEAR the corridor, not the pixels, and that swings with
   zoom. Measured on one view at 1024/2048/3072: zoomed out 84/97/177 ms —
   doubling nearly free; zoomed in the same doubling costs ~4x. */
ok('canvas size is set from a budget and the mask, not a fixed cap',
   /_maskFraction\(box\)/.test(code) && /BUDGET[A-Z_]*\)? \/ Math\.max\(frac/.test(code));
ok('the corridor fraction is floored, so a sliver cannot ask for an infinite canvas',
   /Math\.max\(frac, 0\.\d+\)/.test(code));
ok('no mask means the SMALLEST canvas, not the largest',
   /if \(!_mask\) return 1;/.test(code));
/* The limb is faded in alpha, not painted the darkest colour. At the path limit
   totality goes to zero, which clamps below the 2nd percentile and lands on the
   bottom of the ramp — a dark line along both limbs that read as burnt, and as
   jagged wherever a canvas pixel was fat. */
ok('the limb fades out in alpha rather than darkening',
   /EDGE_FADE/.test(code) && /out\[o \+ 3\] = a >= 1/.test(code));
ok('flagged blocks are dilated before refining', /grow\[/.test(code));

console.log('\n4c. the terrain veto (step 3)');
var shui = fs.readFileSync(path.join(ROOT, 'js/shadow-ui.js'), 'utf8');
var shcode = shui.replace(/\/\*[\s\S]*?\*\//g, '');
ok('shadow-ui exposes ONE entry point in each direction',
   /function showShadowAsVeto\(/.test(shcode) && /function restoreShadowMode\(/.test(shcode));
ok('the favorability layer does not call shadow-ui internals',
   !/_showShadowNow|_shadowArmed|_makeShadowLayer|_renderTimeline/.test(code));
/* ss:false is the one that looks like a tidy-up and is not. The module default
   is false but shadow-ui's own call site passes true, and supersampling would
   give the veto soft fractional edges where it must be a hard binary. */
ok('veto builds the layer with supersampling OFF, explicitly',
   /ss: _vetoMode \? false : true/.test(shcode));
ok('veto uses its own tint, not the score ramp\'s worst',
   /VETO_TINT/.test(shcode) && /_vetoMode \? VETO_TINT : SHADOW_TINT/.test(shcode));
/* 'off' is the real mode name. _renderTimeline treats 'off' and 'hint' specially
   and EVERY other value as show, so veto mode's invented 'hide' silently
   displayed the scrubber on an overlay whose time the user cannot choose. */
ok('the scrubber stays hidden in veto mode',
   /_renderTimeline\('off'\)/.test(shcode) &&
   /_renderTimeline\(_vetoMode \? 'off' : 'show'\)/.test(shcode));
ok('veto mode never passes an invented timeline mode',
   !/_renderTimeline\('hide'\)/.test(shcode));
ok('unknown timeline modes fail to OFF rather than showing the control',
   /mode !== 'off' && mode !== 'hint' && mode !== 'show'/.test(shcode));
/* These three facts MUST be stated somewhere, or the colours can be misread.
   They live in the Instructions now rather than the legend, which was shortened
   deliberately — so assert the documentation, not a particular sentence in the
   strip. What matters is that a user can find out; not where. */
(function () {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok('the instructions state that blue is relative to THIS path',
     /best this eclipse offers, not good in itself/i.test(html));
  ok('the instructions state that the veto time re-centres as you move',
     /re-centres as you move/.test(html));
  ok('the instructions give the formula',
     /about-formula/.test(html) && /min\(A\/7\.5, 1\)/.test(html) &&
     /2nd&ndash;98th percentile/.test(html));
  ok('the instructions name what it does NOT know',
     /roads, access, or local microclimate/i.test(html));
  ok('the quick line in Instructions mentions the overlay',
     /combined <strong>favorability<\/strong> score/.test(html));
})();
/* The instant is the LOCAL maximum. computeShadowWindow().maxms is greatest
   eclipse — ONE instant for the whole planet, up to 90 minutes out at the ends
   of a track, which is an entirely different set of shadows. */
ok('the veto time is the LOCAL maximum, not greatest eclipse',
   /_localMaxMs/.test(code) && /findMaximum\(_rec, lat, lw, 0, _rec\.dt\)/.test(code) &&
   !/maxms/.test(code));
ok('re-showing after a zoom keeps the pinned time',
   /_vetoMode && _vetoTime != null \? _vetoTime/.test(shcode));
/* "Borrowed" and "drawing" are different states and were conflated. Zooming out
   below SHADOW_MIN_ZOOM drops the layer but KEEPS the borrow so it resumes on
   the way back in — so the legend went on saying "terrain blocks the sun" over a
   map that had none. */
ok('isShadowVeto reports DRAWING, not merely borrowed',
   /_vetoMode && _shadowShowing/.test(shcode));
ok('there is a separate armed test for the handover', /function isVetoArmed/.test(shcode));
ok('the handover uses ARMED, so a hidden veto is still given back',
   /isVetoArmed\(\)\) restoreShadowMode\(\)/.test(code));

ok('terrain is not optional', !/_terrain/.test(code));
/* The legend's last line reports whether terrain is live, and the veto is
   applied asynchronously AFTER the panel is first drawn — so the panel has to be
   told when that lands or it keeps saying "No terrain" over a map that has it. */
ok('the legend is redrawn after the veto is applied',
   /_syncVeto\(\);[\s\S]{0,400}FavorBar\.render\(\)/.test(code));
/* The Shadows button reflects the USER'S shadow mode. While the engine is
   borrowed it must read OFF, or both buttons look on and pressing Shadows
   twice evicts this overlay instead of toggling its terrain. */
ok('the shadow button reads OFF while the engine is borrowed',
   /_shadowArmed && !_vetoMode/.test(shcode));
/* Read the file here rather than using `uicode`, which is declared further down
   in section 5: hoisted, so it is `undefined` at this point and every regex
   against it silently passes or fails on the string "undefined". */
(function () {
  var u = fs.readFileSync(path.join(ROOT, 'js/favorability-ui.js'), 'utf8');
  /* Terrain is NOT optional — it is part of what the overlay means. It was briefly
   a switch in this panel and before that reachable only via the Shadows button;
   both were wrong, and the switch also showed greyed-out while terrain was
   visibly on, because the panel is drawn BEFORE the async veto is applied. */
  ok('there is no terrain switch', !/dterrain/.test(u) && !/setTerrain/.test(u));
  ok('the legend says which visibility source is live',
     /vetoActive/.test(u) && /terrain blocks the sun/.test(u) && /No terrain/.test(u));
  ok('the legend names the inputs without claiming fixed weights',
     /Based on duration, cloud avg, and sun alt/.test(u) && !/\d\d% *Duration/i.test(u));
})();

console.log('\n4d. the Details panel row');
var det = fs.readFileSync(path.join(ROOT, 'js/details.js'), 'utf8');
ok('there is a Favorability row in Local Circumstances',
   /row\('Favorability'/.test(det) && /id="favor-score"/.test(det));
/* Outside the central path the row is not drawn at all — a dash is not worth the
   line. It must use the SAME test as the Duration row above it: two different
   ideas of "is this central" would let the panel show a duration with no score,
   or a score with no duration. */
ok('the row is gated on durCentral, like the Duration row',
   /res\.durCentral\s*\n?\s*\?\s*row\('Favorability'/.test(det));
ok('and it is not even requested for a partial point',
   /if \(res\.durCentral\) fillFavorability/.test(det));
ok('it is filled where the cloud row is filled',
   /fillCloudOdds\(coords\.lat, coords\.lon\);\s*\n\s*if \(res\.durCentral\) fillFavorability/.test(det));
/* The same stale-fill guard as fillCloudOdds. This row is a single unitless
   number, so a value from the previously selected point is completely
   undetectable by eye — worse than the cloud row, not better. */
ok('the element is re-looked-up AFTER the await and the point re-checked',
   /getAttribute\('data-for'\) !== want\) return;/.test(det));
ok('it works with the overlay OFF, via ensureAt', /Favorability\.ensureAt/.test(det));
/* `title` was tried first and is not fit for this: the browser delays it about a
   second, gives no visible hint that anything is there, and never shows at all on
   touch — so the explanation may as well not exist. */
/* Scoped to fillFavorability's own body — the Clear sky row above still uses
   `title`, legitimately for now, and an unscoped match hits that instead. */
(function () {
  var fn = det.slice(det.indexOf('function fillFavorability'), det.indexOf("/* Espenak"));
  ok('the explanation is a data-tip, not a title attribute',
     /setAttribute\('data-tip'/.test(fn) && !/\.title\s*=/.test(fn));
})();
ok('the value is marked and focusable, so it is discoverable and tappable',
   /class="circ-tip"/.test(det) && /tabindex="0"/.test(det));
(function () {
  var css = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');
  ok('the bubble is driven by the same attribute', /content:\s*attr\(data-tip\)/.test(css));
  ok('it opens on focus as well as hover', /\.circ-tip\[data-tip\]:focus::after/.test(css));
  /* The mark and the bubble are qualified on [data-tip]: these rows start as an
     ellipsis and a failed fill leaves a dash, and neither has anything to say. */
  ok('only rows that HAVE an explanation are marked',
     /\.circ-tip\[data-tip\]\s*\{/.test(css));
  ok('a failed fill clears any stale explanation',
     (det.match(/removeAttribute\('data-tip'\)/g) || []).length >= 3);
  ok('newlines in the tip are honoured', /white-space:\s*pre-line/.test(css));
  /* Match the RULE, not the word: an earlier draft used var(--panel, #10161d),
     and --panel does not exist, so it would silently have hardcoded a colour.
     The comment recording that must not itself trip the assertion. */
  var tip = css.slice(css.indexOf('.circ-tip[data-tip]::after'),
                      css.indexOf('.circ-tip[data-tip]:hover::after'));
  ok('it uses theme variables, not a hardcoded colour',
     /background:\s*var\(--bg3\)/.test(tip) && !/#[0-9a-f]{6}/i.test(tip.replace(/\/\*[\s\S]*?\*\//g, '')));
})();
ok('the hover names all three inputs',
   /Totality /.test(det) && /above the horizon/.test(det) && /Clear sky /.test(det));
ok('the hover says the score is RELATIVE to this path',
   /not an absolute score/.test(det));
ok('the hover says terrain is not in the number', /No terrain: a ridge/.test(det));
ok('cloud is shown as CLEAR sky, matching the row above it',
   /\(1 - d\.cloud\)/.test(det));
/* The layer must be able to answer without drawing. _prepare() is the shared
   load step; ensureAt uses it so the row does not require the overlay. */
ok('the layer exposes ensureAt', !!D && typeof D.ensureAt === 'function');
ok('load and render are separated', /function _prepare\(entry\)/.test(code) &&
   /_prepare\(entry\)\.then/.test(code));

console.log('\n5. the UI module');
var uisrc = fs.readFileSync(path.join(ROOT, 'js/favorability-ui.js'), 'utf8');
var sb2 = { window: { Favorability: D }, console: console,
            document: { getElementById: function () { return null; } } };
vm.createContext(sb2); vm.runInContext(uisrc, sb2);
var U = sb2.window.FavorBar;
var uicode = uisrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('exports on window.FavorBar', !!U);
ok('carries a version stamp', !!U && /^\d{4}-\d{2}-\d{2}[a-z]+$/.test(U.version), U && U.version);
ok('survives a DOM with none of its elements', true);   /* proved by getting here */
ok('defaults to whole-path normalisation', !!U && U.getMode() === 'path');
ok('does no scoring of its own',
   !/findMaximum|fundamentalArgs|Math\.pow/.test(uicode));
ok('builds the legend from the layer stops, never a copied gradient',
   /stops\(\)/.test(uicode));

/* One overlay at a time, BOTH directions — each was a separate edit and either
   one alone leaves the two layers able to stack. */
ok('turning favorability on drops the cloud overlay',
   /CloudBar\.setMode\(null\)|Cloud\.disable\(\)/.test(uicode));
var cloudui = fs.readFileSync(path.join(ROOT, 'js/cloud-ui.js'), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '');
ok('turning a cloud mode on drops favorability',
   /FavorBar\.disable\(\)/.test(cloudui));
ok('that guard is optional — cloud-ui still works without favorability',
   /window\.FavorBar\s*&&/.test(cloudui));

/* index.html and sw.js must agree, or the layer is simply absent offline. */
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
ok('button and strip exist in the markup',
   /id="btn-favor"/.test(html) && /id="favorbar"/.test(html));
ok('both scripts are loaded exactly once',
   (html.match(/js\/favorability\.js/g) || []).length === 1 &&
   (html.match(/js\/favorability-ui\.js/g) || []).length === 1);
ok('the UI loads AFTER the module it drives',
   html.indexOf('js/favorability-ui.js') > html.indexOf('js/favorability.js'));
ok('both are precached, or the layer vanishes offline',
   /'favorability'/.test(sw) && /'favorability-ui'/.test(sw));

/* All three overlays are exclusive, and each PAIR is a separate edit. Two of the
   six directions were missing when this was first shipped. */
var shadowui = fs.readFileSync(path.join(ROOT, 'js/shadow-ui.js'), 'utf8')
                 .replace(/\/\*[\s\S]*?\*\//g, '');
ok('turning shadows on drops favorability', /FavorBar\.disable\(\)/.test(shadowui));
ok('turning favorability on drops shadows', /disableShadows\(\)/.test(uicode));
/* The umbra footprint ovals were briefly hidden while this overlay was on, on a
   guess that they were the reported "blur". They were not — the cause was the
   canvas cap (see _draw's two-level note) — and the change was reverted. This
   asserts it STAYS reverted: the score layer has no business reaching into
   map.js's deck layers, and the next person seeing lozenges on the band should
   not re-derive the same wrong answer. */
/* The ovals ARE hidden while this overlay is on — but the rule lives in map.js's
   ovalsVisible(), the single point of truth that all three of its visibility
   decisions read. An earlier attempt set deck layer props from the favorability
   side; it appeared to work and came undone at the next redraw, because the rule
   was in one place and the rebuild read another. */
ok('does NOT set deck layer props from outside map.js',
   !/umbra-ovals/.test(uicode) && !/setDeckLayers/.test(uicode) &&
   !/umbra-ovals/.test(code) && !/setDeckLayers/.test(code));
var mapsrc = fs.readFileSync(path.join(ROOT, 'js/map.js'), 'utf8');
var mapcode = mapsrc.replace(/\/\*[\s\S]*?\*\//g, '');
ok('map.js decides oval visibility in ONE place',
   /function ovalsVisible/.test(mapcode) &&
   (mapcode.match(/getZoom\(\) [<>]=? OVAL_HIDE_ZOOM/g) || []).length === 1);
ok('that one place asks whether favorability is on',
   /ovalsVisible[\s\S]{0,200}Favorability/.test(mapcode));
ok('and it is guarded, so map.js works without the favorability files',
   /D && D\.isOn && D\.isOn\(\)/.test(mapcode));
/* WHEN it repaints matters as much as that it does. _render() is async and takes
   a few hundred ms, so hiding the ovals in _enable() left a visible hole where
   they had gone and the score had not yet arrived. They must go in the render's
   success path, in the same frame the first pixels land. */
/* Function BODY, not a character window — a window breaks the moment a comment
   is added nearby, which is exactly how this assertion failed once already. */
ok('ovals are repainted on disable', (function () {
  var body = code.match(/function _disable\(\)[\s\S]*?\n  \}/);
  return !!body && body[0].indexOf('_refreshOvals(') !== -1;
})());
/* Scoped to the FUNCTION BODY, not a character window. A window of N chars after
   "_on = true" also swallowed the _refreshOvals DEFINITION, which sits right
   after _enable once comments are stripped — the third regex in this suite to
   fail against correct code. Match the body, not the neighbourhood. */
(function () {
  var body = code.match(/function _enable\(\)[\s\S]*?\n  \}/);
  ok('_enable does NOT hide the ovals (the render is async)',
     !!body && body[0].indexOf('_refreshOvals(') === -1);
  ok('ovals are hidden when the score PAINTS',
     /_drawnKey = key;[\s\S]{0,200}_refreshOvals\(\)/.test(code));
})();
/* A new eclipse leaves BOTH canvases holding the previous corridor until the
   async redraw lands. Showing neither is honest; showing the old one is not. */
ok('a new eclipse hides both canvases immediately', /_swap\(null\)/.test(code));
/* And the other half of the same race: a render that started before the switch
   resolves AFTER it, and would paint the previous corridor and mark it current. */
ok('an in-flight render is abandoned if the eclipse changed under it',
   /_eclipseKey\(selectedEntry\) !== key\)\s*return;/.test(code));
ok('_swap has a three-way state, not a boolean',
   /showDetail === true/.test(code) && /showDetail === false/.test(code));

console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
