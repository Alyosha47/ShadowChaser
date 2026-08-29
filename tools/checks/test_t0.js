/* test_t0.js — eclipse.js's refT0() normalisation
 *
 * `t0` is the whole TD hour nearest greatest eclipse, so `t0 = 0` on a record
 * peaking at 23:5x means midnight of the FOLLOWING day. Read literally it puts
 * the eclipse 24 hours early. refT0() fixes that; this suite pins BOTH halves:
 * that the affected records moved, and — the part that actually matters — that
 * nothing else did.
 */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '../..');
var E = require(path.join(ROOT, 'js/eclipse.js'));
var pass = 0, fail = 0;
function ok(l, c, d) { if (c) { pass++; console.log('  PASS ' + l); }
                       else { fail++; console.log('  FAIL ' + l + (d ? '  \u2192 ' + d : '')); } }

var recs = [];
fs.readdirSync(path.join(ROOT, 'data/besselian')).filter(function (f) { return /\.json$/.test(f); })
  .forEach(function (f) {
    recs = recs.concat(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/besselian', f), 'utf8')));
  });

function tge(r) { var p = (r.td_ge || '0:0:0').split(':').map(Number); return p[0] + p[1]/60 + p[2]/3600; }

console.log('\n1. which records refT0 changes');
var moved = recs.filter(function (r) { return E.refT0(r) !== r.t0; });
var expect = recs.filter(function (r) { return Math.abs(tge(r) - r.t0) > 12; });
ok('exactly 221 records are normalised', moved.length === 221, String(moved.length));
ok('they are exactly the near-midnight ones, no more no less',
   moved.length === expect.length &&
   moved.every(function (r) { return Math.abs(tge(r) - r.t0) > 12; }));
ok('every one has greatest eclipse in the 23:00 UT hour',
   moved.every(function (r) { return Math.floor(tge(r)) === 23; }));
ok('the other ' + (recs.length - moved.length) + ' are left completely alone',
   recs.filter(function (r) { return E.refT0(r) === r.t0; }).length === recs.length - 221);

console.log('\n2. the reference epoch always lands near greatest eclipse');
/* This is the property that makes the fix correct: t0 is supposed to be the
   whole hour NEAREST greatest eclipse, so |refT0 - td_ge| can never exceed 12. */
var worst = 0;
recs.forEach(function (r) { worst = Math.max(worst, Math.abs(E.refT0(r) - tge(r))); });
ok('|refT0 - td_ge| <= 12 h for all ' + recs.length + ' records', worst <= 12, worst.toFixed(2) + ' h');

console.log('\n3. the 2012-05-20 annular, the well-known affected case');
var r12 = recs.find(function (r) { return r.year === 2012 && r.month === 5 && r.day === 20; });
ok('refT0 reads 24, not 0', E.refT0(r12) === 24, String(E.refT0(r12)));
var base = Date.UTC(2012, 4, 20), dtH = r12.dt / 3600;
function ms(td) { return base + (td - dtH) * 3600e3; }
var geMs = ms(tge(r12)), w0 = ms(E.refT0(r12) + r12.tmin), w1 = ms(E.refT0(r12) + r12.tmax);
ok('greatest eclipse falls INSIDE the scrubber window', geMs >= w0 && geMs <= w1,
   new Date(geMs).toISOString() + ' vs ' + new Date(w0).toISOString() + '..' + new Date(w1).toISOString());
var red = E.computeEclipse(r12, 40.59, -122.39, 0);
ok('Redding CA maximum is on 2012-05-21, not the 20th',
   new Date(base + red.tMax * 3600e3).toISOString().slice(0, 10) === '2012-05-21',
   new Date(base + red.tMax * 3600e3).toISOString());

console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
