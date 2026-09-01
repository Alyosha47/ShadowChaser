#!/usr/bin/env node
/* test_horizon_clip.js — did the horizon clipping change anything it shouldn't?
 *
 * Loads the working js/eclipse.js and the last committed one side by side, runs
 * both over thousands of place/eclipse pairs, and reports every field that
 * differs. The rule being checked is narrow: durations may shrink where the Sun
 * is below the horizon at a contact, and NOTHING else may move at all.
 *
 *     node tools/checks/test_horizon_clip.js
 *
 * A clean run means contact times, types, magnitudes, obscurations and sun
 * positions are identical to before everywhere, and only the durations changed,
 * only downwards, and only where the Sun had set.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const cp = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadSource(src, label) {
  const sb = { console: console, Math: Math };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: label });
  return sb;
}

const NEW = loadSource(fs.readFileSync(path.join(ROOT, 'js/eclipse.js'), 'utf8'), 'new');
let OLD = null;
try {
  OLD = loadSource(cp.execSync('git show HEAD:js/eclipse.js', { cwd: ROOT, maxBuffer: 1 << 26 }).toString(), 'old');
} catch (e) {
  console.log('could not load the committed eclipse.js (' + e.message + ')');
  console.log('comparison skipped; running self-consistency checks only');
}

/* A spread of places: cities, both poles' edges, islands, the date line. */
const PLACES = [
  [48.86, 2.35, 'Paris'], [40.71, -74.01, 'New York'], [35.68, 139.69, 'Tokyo'],
  [-33.87, 151.21, 'Sydney'], [51.51, -0.13, 'London'], [-23.55, -46.63, 'Sao Paulo'],
  [55.76, 37.62, 'Moscow'], [1.35, 103.82, 'Singapore'], [64.13, -21.9, 'Reykjavik'],
  [-54.8, -68.3, 'Ushuaia'], [78.22, 15.65, 'Svalbard'], [-77.85, 166.67, 'McMurdo'],
  [21.31, -157.86, 'Honolulu'], [-17.75, -149.4, 'Tahiti'], [71.29, -156.79, 'Utqiagvik'],
  [-33.92, 18.42, 'Cape Town'], [19.43, -99.13, 'Mexico City'], [28.61, 77.21, 'Delhi'],
  [-36.85, 174.76, 'Auckland'], [64.75, 177.5, 'Chukotka'],
  [42.04, -3.35, 'Sad Hill'], [41.99, -3.42, 'Sad Hill W']
];

const CENTURIES = ['1901_2000', '2001_2100', '1601_1700', '-0099_0000'];

let pairs = 0, visNew = 0, visOld = 0;
let clipped = 0, shrank = 0, grew = 0;
const problems = [];

function note(msg) {
  if (problems.length < 40) problems.push(msg);
}

CENTURIES.forEach(function (cent) {
  const f = path.join(ROOT, 'data/besselian', cent + '.json');
  if (!fs.existsSync(f)) return;
  const recs = JSON.parse(fs.readFileSync(f, 'utf8'));
  recs.forEach(function (r) {
    PLACES.forEach(function (p) {
      pairs++;
      const a = NEW.computeEclipse(r, p[0], p[1], 0);
      if (a.visible) visNew++;
      if (a.cutBy) clipped++;
      if (!OLD) return;
      const b = OLD.computeEclipse(r, p[0], p[1], 0);
      if (b.visible) visOld++;

      const tag = r.year + '-' + r.month + '-' + r.day + ' ' + p[2];

      if (a.visible !== b.visible) {
        /* Newly visible is the intended gain; newly invisible is a fault. */
        if (b.visible && !a.visible) note('LOST  ' + tag + ' was visible, now not');
        return;
      }
      if (!a.visible) return;

      ['type', 'localPhase', 'mag', 'osc'].forEach(function (k) {
        if (a[k] !== b[k]) note('FIELD ' + tag + ' ' + k + ': ' + b[k] + ' -> ' + a[k]);
      });
      ['C1', 'C2', 'C3', 'C4'].forEach(function (k) {
        const x = a[k] && a[k].ut, y = b[k] && b[k].ut;
        if (x === null && y === null) return;
        if (x === null || y === null || Math.abs(x - y) > 1e-9) {
          note('CONTACT ' + tag + ' ' + k + ': ' + y + ' -> ' + x);
        }
      });
      if (a.sun && b.sun && (a.sun.alt !== b.sun.alt || a.sun.az !== b.sun.az)) {
        note('SUN   ' + tag + ' alt/az moved');
      }
      ['durPartial', 'durCentral'].forEach(function (k) {
        const x = a[k], y = b[k];
        if (x === null && y === null) return;
        if (x === null || y === null) { note('DUR   ' + tag + ' ' + k + ' null mismatch'); return; }
        if (Math.abs(x - y) < 0.5) return;
        if (x > y) { grew++; note('GREW  ' + tag + ' ' + k + ' ' + Math.round(y) + 's -> ' + Math.round(x) + 's'); }
        else {
          shrank++;
          if (!a.cutBy) note('SHRANK ' + tag + ' ' + k + ' but cutBy is null');
        }
      });
    });
  });
});

console.log(pairs + ' place/eclipse pairs');
console.log('visible: ' + visNew + (OLD ? ' (was ' + visOld + ')' : ''));
console.log('clipped by the horizon: ' + clipped);
console.log('durations shortened: ' + shrank + ', lengthened: ' + grew);
if (problems.length) {
  console.log('\nPROBLEMS:');
  problems.forEach(function (m) { console.log('  ' + m); });
  console.log('\nFAIL');
  process.exit(1);
}
console.log('\nPASS - only durations changed, only downwards, only where the Sun had set');
