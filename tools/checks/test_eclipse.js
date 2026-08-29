/* test_eclipse.js — invariants of eclipse.js
 *
 * Section 1-3: refT0() normalisation
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

/* ── 4. the type / localPhase contract ─────────────────────────────────── */
/* `type` is the DISPLAY BADGE and `localPhase` is what actually happened at the
   observer's spot. For a hybrid they differ: type says 'hybrid' everywhere
   along the path while localPhase says 'total' or 'annular' depending where you
   stood. Anything deciding behaviour — obscuration, centrality, whether the sky
   goes dark — must read localPhase. Branching on `type` silently mishandles all
   569 hybrids, and has done so twice. */
console.log('\n4. type vs localPhase');
var hyb = recs.filter(function (r) { return (r.eclipse_type || '')[0] === 'H' && r.lat_dd_ge != null; });
var evaluated = 0, badOsc = [], badDur = [], badCentral = [];
hyb.forEach(function (r) {
  var res = E.computeEclipse(r, r.lat_dd_ge, r.lng_dd_ge, 0);
  if (!res || res.visible === false) return;
  evaluated++;
  if (res.localPhase === 'total' && res.osc !== 100) badOsc.push(r.year + ' osc=' + res.osc);
  if (res.localPhase === 'annular' && !(res.osc > 0 && res.osc < 100)) badOsc.push(r.year + ' ann osc=' + res.osc);
  if ((res.localPhase === 'total' || res.localPhase === 'annular') && !(res.durCentral > 0))
    badDur.push(r.year + ' durCentral=' + res.durCentral);
  if (res.localPhase === 'total' && !(res.C2 && res.C3)) badCentral.push(String(r.year));
});
ok('all ' + evaluated + ' visible hybrids report obscuration correctly',
   badOsc.length === 0, badOsc.slice(0, 4).join('; '));
ok('hybrids get a central duration, not just a partial one',
   badDur.length === 0, badDur.slice(0, 4).join('; '));
ok('hybrids that are locally total have C2 and C3',
   badCentral.length === 0, badCentral.slice(0, 4).join('; '));

/* The badge must still read 'hybrid' — that behaviour is deliberate and
   details.js line ~176 depends on it for the duration row. */
var exm = recs.find(function (r) { return r.year === 2023 && r.month === 4 && r.day === 20; });
var e2 = E.computeEclipse(exm, -21.9, 114.1, 0);
ok('2023-04-20 Exmouth: badge stays hybrid, local phase is total',
   e2.type === 'hybrid' && e2.localPhase === 'total', e2.type + '/' + e2.localPhase);
ok('...and it reports 100% obscuration with a real totality duration',
   e2.osc === 100 && e2.durCentral > 0, e2.osc + '%, ' + e2.durCentral.toFixed(1) + ' s');

/* Nothing in eclipse.js should branch on the badge any more. */
var src = fs.readFileSync(path.join(ROOT, 'js/eclipse.js'), 'utf8');
ok('eclipse.js no longer special-cases the string \'hybrid\' in its logic',
   (src.match(/type === 'hybrid'/g) || []).length === 0,
   String((src.match(/type === 'hybrid'/g) || []).length) + ' occurrences');

console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'all ' + pass + ' passed'));
process.exit(fail ? 1 : 0);
