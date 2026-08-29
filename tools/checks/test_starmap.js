/* test_starmap.js — planets and bright stars (js/starmap.js)
 *
 * The point of this suite is section 2, THE SUN GATE.
 *
 * The app already knows exactly where the Sun is at every eclipse, by a route
 * that shares no code with starmap.js: Espenak's Besselian elements. For each
 * record `d0` is the declination of the shadow axis and `mu0` its Greenwich
 * ephemeris hour angle, and the shadow axis is the Moon-to-Sun line, which
 * during an eclipse differs from the geocentric Sun direction by at most about
 * 9 arcsec — the axis passes within an Earth radius of the geocentre, over 1 AU.
 *
 * So the catalogue is a ~10 arcsec reference for the Sun's apparent position:
 *
 *     Dec = d0            RA = theta(TD) - mu0
 *
 * starmap.js must reproduce both at all 11,898 eclipses from -1999 to +3000. One
 * number exercises the whole chain — proleptic Julian calendar and the
 * Gregorian switch, Julian date, ΔT, sidereal time, the truncated VSOP87 Earth
 * series, the Vondrak obliquity, and the reconciliation between VSOP87D's
 * equinox of date and Vondrak's. Nothing else feeds it, so when it fails the
 * arcsec figure tells you which of those moved.
 *
 * The budget is 360 arcsec (0.1 deg), which is half a pixel at the totality
 * view's 5.3 px/deg. Observed worst is ~23 arcsec, so there is 16x of room;
 * if this ever creeps past ~100, something is wrong even though it still passes.
 *
 * ⚠ t0 IS NOT ALWAYS ON THE RECORD'S DATE. It is the whole TD hour nearest
 * greatest eclipse, so a record whose greatest eclipse is at 23:5x carries
 * t0 = 0 meaning midnight of the FOLLOWING day. 221 records are like this, all
 * with greatest eclipse in the 23:00 UT hour. This gate is what found it, and
 * eclipse.js now normalises it too via refT0() — section 3 checks that.
 */

'use strict';

var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '../..');
var Starmap = require(path.join(ROOT, 'js/starmap.js'));
var Ecl = require(path.join(ROOT, 'js/eclipse.js'));
var pass = 0, fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  → ' + detail : '')); }
}

var D = Math.PI / 180;
function sepArcsec(ra1, de1, ra2, de2) {
  function v(ra, de) {
    return [Math.cos(de*D)*Math.cos(ra*D), Math.cos(de*D)*Math.sin(ra*D), Math.sin(de*D)];
  }
  var a = v(ra1, de1), b = v(ra2, de2);
  var c = Math.max(-1, Math.min(1, a[0]*b[0] + a[1]*b[1] + a[2]*b[2]));
  return Math.acos(c) / D * 3600;
}

var dir = path.join(ROOT, 'data/besselian');
var recs = [];
fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) {
  recs = recs.concat(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
});

/* ── 1. calendar and Julian date ───────────────────────────────────────── */
console.log('\n1. calendar');
ok('J2000 epoch', Starmap.jdFromDate(2000, 1, 1) === 2451544.5);
ok('last Julian day 1582-10-04', Starmap.jdFromDate(1582, 10, 4) === 2299159.5);
ok('first Gregorian day 1582-10-15 is the NEXT JD', Starmap.jdFromDate(1582, 10, 15) === 2299160.5);

var jdWorst = 0;
recs.forEach(function (r) {
  if (r.julian_date == null || !r.td_ge) return;
  var p = r.td_ge.split(':').map(Number);
  var ours = Starmap.jdFromDate(r.year, r.month, r.day) + (p[0] + p[1]/60 + p[2]/3600) / 24;
  jdWorst = Math.max(jdWorst, Math.abs(ours - r.julian_date) * 86400);
});
ok('our JD matches the catalogue at all ' + recs.length + ' records (< 60 s)',
   jdWorst < 60, jdWorst.toFixed(1) + ' s');

/* ── 2. THE SUN GATE ───────────────────────────────────────────────────── */
console.log('\n2. the sun gate');
var BUDGET = 360;
var n = 0, sum = 0, worst = { sep: -1 }, over = 0;
recs.forEach(function (r) {
  if (r.mu0 == null || r.d0 == null || r.t0 == null || !r.td_ge) return;
  var p = r.td_ge.split(':').map(Number), tge = p[0] + p[1]/60 + p[2]/3600;
  var t0 = r.t0;                                  /* see the header warning */
  if (tge - t0 > 12) t0 += 24; else if (t0 - tge > 12) t0 -= 24;
  var jdTT = Starmap.jdFromDate(r.year, r.month, r.day) + t0 / 24;
  var got = Starmap.sunRaDec(r, t0 - (r.dt || 0) / 3600);
  var refRa = ((Starmap.gmst(jdTT) - r.mu0) % 360 + 360) % 360;
  var s = sepArcsec(refRa, r.d0, got.ra, got.dec);
  n++; sum += s;
  if (s > BUDGET) over++;
  if (s > worst.sep) worst = { sep: s, y: r.year, m: r.month, d: r.day };
});
console.log('       ' + n + ' eclipses, -1999 to +3000: mean ' + (sum/n).toFixed(1)
          + '"  worst ' + worst.sep.toFixed(1) + '" at ' + worst.y + '-' + worst.m + '-' + worst.d);
ok('every eclipse inside the ' + BUDGET + '" budget', over === 0, over + ' over');
ok('worst case leaves 3x headroom', worst.sep < BUDGET / 3, worst.sep.toFixed(1) + '"');
ok('mean stays at the reference floor (< 15")', sum/n < 15, (sum/n).toFixed(1) + '"');

/* ── 3. agreement with eclipse.js ──────────────────────────────────────── */
/* Different route to the same Sun: if these drift apart, the totality view's
   objects would be positioned around a Sun the arc has drawn elsewhere. */
console.log('\n3. starmap.js vs eclipse.js');
var altWorst = 0, cases = 0, midWorst = 0, midCases = 0;
recs.filter(function (r) { return r.year >= 1900 && r.year <= 2100; }).forEach(function (r) {
  var res = Ecl.computeEclipse(r, r.lat_dd_ge, r.lng_dd_ge, 0);
  if (!res || res.visible === false || res.tMax == null) return;
  var s = Ecl.sampleEclipseAt(r, r.lat_dd_ge, r.lng_dd_ge, 0, res.tMax);
  var rd = Starmap.sunRaDec(r, res.tMax);
  var lst = Starmap.gmst(Starmap.jdFromDate(r.year, r.month, r.day) + res.tMax / 24) + r.lng_dd_ge;
  var H = (lst - rd.ra) * D, phi = r.lat_dd_ge * D, dec = rd.dec * D;
  var alt = Math.asin(Math.max(-1, Math.min(1,
    Math.sin(phi)*Math.sin(dec) + Math.cos(phi)*Math.cos(dec)*Math.cos(H)))) / D;
  var e = Math.abs(alt - s.alt);
  var p = r.td_ge.split(':').map(Number);
  if (Math.abs((p[0] + p[1]/60 + p[2]/3600) - r.t0) > 12) {
    midWorst = Math.max(midWorst, e); midCases++;      /* the t0 records */
  } else {
    altWorst = Math.max(altWorst, e); cases++;
  }
});
ok('sun altitude agrees to 0.005 deg across ' + cases + ' modern eclipses',
   altWorst < 0.005, altWorst.toFixed(5) + ' deg');

/* The near-midnight records USED to disagree by ~0.4 deg, because eclipse.js
   read t0 = 0 as midnight starting the record's date when it means midnight
   ending it. Fixed 2026-08-29c by eclipse.js's refT0(); they now agree to the
   same tolerance as everything else. If this ever starts failing again, refT0
   has been bypassed at one of its six call sites — see HANDOFF. */
ok('the ' + midCases + ' near-midnight records now agree too',
   midCases > 0 && midWorst < 0.005, midWorst.toFixed(5) + ' deg');

/* ── 4. the star catalogue ─────────────────────────────────────────────── */
/* The Sun gate cannot see the stars — it only proves the solar-system half.
   2017-08-21 is the check because its sky is documented everywhere: Regulus
   about 1 deg from the Sun, and the planets strung out either side. */
console.log('\n4. stars and planets, 2017-08-21 from Hopkinsville KY');
var r2017 = recs.find(function (r) { return r.year === 2017 && r.month === 8 && r.day === 21; });
var res2017 = Ecl.computeEclipse(r2017, 36.97, -87.65, 0);
var sun2017 = Starmap.sunRaDec(r2017, res2017.tMax);
var objects2017 = Starmap.skyAt(r2017, 36.97, -87.65, res2017.tMax);
function sepFromSun(name) {
  var o = objects2017.find(function (x) { return x.name === name; });
  return o ? sepArcsec(o.ra, o.dec, sun2017.ra, sun2017.dec) / 3600 : null;
}
/* 22, not 50. The cut is 1.5 mag because totality is deep-twilight dark, not
   night, and because a 2.0 cut listed Mirfak and Hamal — names that look
   authoritative and tell the reader nothing. */
ok('22 recognisable stars compiled in', Starmap.starCount === 22, String(Starmap.starCount));
ok('no bare catalogue designations in the star list',
   !Starmap.skyAt(r2017, 36.97, -87.65, 18.4).some(function (o) { return /\d/.test(o.name); }));
ok('it is a total eclipse there', res2017.type === 'total', res2017.type);
[['Regulus', 1.28], ['Mars', 8.27], ['Mercury', 10.43], ['Venus', 34.13], ['Jupiter', 51.32]]
  .forEach(function (c) {
    var got = sepFromSun(c[0]);
    ok(c[0] + ' is ' + c[1] + ' deg from the Sun',
       got != null && Math.abs(got - c[1]) < 0.15,
       got == null ? 'not found' : got.toFixed(2) + ' deg');
  });
/* Proper motion is not optional over this catalogue's span — without it
   Arcturus is 1.6 deg out at the far end, which is 8 px. */
var far = { year: -500, month: 6, day: 1, dt: 17190, t0: 12, td_ge: '12:00:00' };
var a2000 = Starmap.skyAt(Object.assign({}, far, { year: 2000 }), 40, 0, 12)
              .find(function (o) { return o.name === 'Arcturus'; });
var aFar = Starmap.skyAt(far, 40, 0, 12).find(function (o) { return o.name === 'Arcturus'; });
ok('Arcturus moves > 1 deg over 2500 years (proper motion applied)',
   a2000 && aFar && sepArcsec(a2000.ra, a2000.dec, aFar.ra, aFar.dec) / 3600 > 1,
   a2000 && aFar ? (sepArcsec(a2000.ra, a2000.dec, aFar.ra, aFar.dec)/3600).toFixed(2) + ' deg' : 'missing');

/* ── 5. the objects render IN the sun track ────────────────────────────── */
/* This took four attempts. Three of them tried to morph the sun track into a
   separate sky and failed, because the track plotted AZIMUTH degrees — which
   compress by cos(altitude), making the C1..C4 arc look like it spanned 24 deg
   at one eclipse and 171 at another. In true sky angle that arc is 24 to 49 deg
   everywhere, so one isotropic frame holds the arc AND the objects. These
   assertions exist so a fifth attempt cannot quietly undo that. */
console.log('\n5. objects in the sun track');
var JSDOM;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }
if (!JSDOM) {
  console.log('  SKIP jsdom not installed');
} else {
  var vm = require('vm');
  var dom = new JSDOM('<!doctype html><body><div id="suntrack"></div></body>',
                      { pretendToBeVisual: true });
  var sb = dom.window; sb._timeMode = 'ut'; sb.console = console;
  vm.createContext(sb);
  ['js/eclipse.js', 'js/starmap.js', 'js/details.js', 'js/starmap-ui.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
  });
  function track(rec, la, lo) {
    sb.document.getElementById('suntrack').innerHTML = '';
    var res = sb.computeEclipse(rec, la, lo, 0);
    sb.buildSunTrack(rec, la, lo, 0, res, 0);
    var sl = sb.document.getElementById('st-slider');
    var objs = sb.document.getElementById('st-objects');
    var N = Number(sl.max), on = [];
    for (var i = 0; i <= N; i++) {
      sl.value = String(i); sl.dispatchEvent(new sb.Event('input'));
      if (objs.getAttribute('opacity') === '1') on.push(i);
    }
    sl.value = sl.defaultValue;
    var names = Array.prototype.map.call(objs.querySelectorAll('text'),
                                         function (t) { return t.textContent; });
    var out = [];
    Array.prototype.forEach.call(objs.querySelectorAll('text'), function (t) {
      var x = Number(t.getAttribute('x')), y = Number(t.getAttribute('y'));
      var w = t.textContent.length * 4.3, a = t.getAttribute('text-anchor');
      var x0 = a === 'middle' ? x - w/2 : (a === 'end' ? x - w : x);
      if (x0 < 0 || x0 + w > 320 || y < 6 || y > 200) out.push(t.textContent);
    });
    return { names: names, on: on, N: N, outside: out,
             dots: objs.querySelectorAll('circle').length };
  }
  var r17 = recs.find(function (r) { return r.year === 2017 && r.month === 8 && r.day === 21; });
  var r26 = recs.find(function (r) { return r.year === 2026 && r.month === 8 && r.day === 12; });

  var hop = track(r17, 36.97, -87.65);
  ok('objects render inside the sun track', hop.dots > 2, hop.dots + ' dots');
  ok('EVERY object is named — no anonymous dots',
     hop.names.length === hop.dots, hop.names.length + ' labels for ' + hop.dots + ' dots');
  ok('no label is clipped by the frame', hop.outside.length === 0, hop.outside.join(','));
  /* Regulus was 1.28 deg from the Sun in 2017 — the closest naked-eye pass of
     any modern eclipse, and the reason objects are sorted by proximity. */
  ok('Regulus is labelled in 2017', hop.names.indexOf('Regulus') >= 0, hop.names.join(' | '));

  /* Only between C2 and C3, and that is a handful of steps out of 240 — which
     is fine ONLY because the frame no longer moves or rescales. */
  ok('objects appear only during totality',
     hop.on.length > 0 && hop.on.length < 20, hop.on.length + ' of ' + hop.N + ' steps');
  ok('objects are hidden at C1', hop.on.indexOf(0) === -1);

  /* HYBRIDS. eclipse.js relabels a hybrid as 'hybrid' even where the local
     phase is genuinely total, so any gate written against res.type silently
     excluded all 569 of them. The gate is moonRatio >= 1 for that reason. */
  var rHyb = recs.find(function (r) { return r.year === 2023 && r.month === 4 && r.day === 20; });
  var exmouth = track(rHyb, -21.9, 114.1);
  ok('a HYBRID shows objects where it is locally total (2023-04-20 Exmouth)',
     exmouth.on.length > 0 && exmouth.dots > 0, exmouth.dots + ' dots');

  /* ANNULARS have C2 and C3 as well — the ring phase — and must show nothing. */
  var rAnn = recs.find(function (r) { return r.year === 2028 && r.month === 1 && r.day === 26; });
  ok('an ANNULAR shows nothing (2028-01-26 Ecuador)',
     track(rAnn, -1.5, -78.5).on.length === 0);

  var paris = track(r26, 48.85, 2.35);
  ok('nothing appears where the eclipse is only partial',
     paris.on.length === 0, paris.on.length + ' steps');

  var spain = track(r26, 41.9851, -3.4186);
  ok('the same eclipse DOES show objects where it is total', spain.on.length > 0);
}

console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
