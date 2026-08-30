#!/usr/bin/env node
/* gen_country_index.js — ShadowChaser
 *
 * Builds data/country_index.json.gz: for every eclipse, which countries see it
 * and how much of the Sun each one loses at its best-placed spot.
 *
 * WHY A PRECOMPUTED TABLE
 * -----------------------
 * A city is one point, so a search runs the eclipse maths once per eclipse. A
 * country is an AREA, and the answer wanted is the best spot anywhere inside
 * it. Measured 2026-08-24 (tools/checks/bench_country.js): doing that live cost
 * 24x a city scan for Chile and 354x for Russia, which is over a minute. It is
 * not a runtime problem that can be optimised; it is a build-time problem.
 *
 * WHAT EACH ENTRY MEANS
 * ---------------------
 *   index[catNo][countryIdx] = obscuration in 5% steps, 4..20  (20 = 100%)
 *   negative                 = the CENTRAL PATH crossed this country
 *
 * The sign carries the central-path bit. It is needed because obscuration alone
 * cannot distinguish an ANNULAR path — which peaks near 95%, never 100 — from a
 * merely very deep partial. Without it, `chile annular` could not be answered.
 *
 * TWO METHODS, AND WHY BOTH
 * -------------------------
 * 1. SAMPLING for obscuration. A grid of points inside each country, best wins.
 *    Fine for partial eclipses: the penumbra is thousands of km across and
 *    cannot fall between 3 deg samples.
 *
 * 2. EXACT GEOMETRY for the central path. The umbral corridor is often under
 *    150 km wide, so a 3 deg grid walks straight over one clipping the corner
 *    of a country. `umbra_n` and `umbra_s` ARE the real edges of that corridor,
 *    so testing the country against that band catches a graze properly.
 *    Verified against 1999-08-11: the band returns all 17 countries of the
 *    historical path including Serbia and the UK (Cornwall only), and correctly
 *    excludes Italy, which it passed just north of.
 *
 * Where (2) fires it OVERRULES (1): a country the central path crossed is
 * recorded at full obscuration for its type, whatever the sampling found.
 *
 * WHY NOT USE THE PENUMBRAL LIMITS THE SAME WAY
 * ---------------------------------------------
 * Asked and tested 2026-08-24. Only 87 of 225 eclipses in 2001-2100 store BOTH
 * penumbral limits; for the other 137 one edge runs off the sunlit side of the
 * Earth and the region is closed by the terminator instead. js/map.js already
 * refuses to FILL that region for exactly this reason ("the closed-ring
 * assembly across penumbra +- terminator joins is not always well-defined").
 * An assembly bug there would silently drop countries from search results with
 * nothing to notice it; sampling is approximate but never silently empty.
 * Assembling a fillable penumbral region is worth doing as its own job, and
 * this table is the test it would have to match.
 *
 * SIZE
 * ----
 * 5% buckets and a 20% floor, measured: ~846 KB gzipped for all 11,898
 * eclipses, against ~1359 KB at 1% and whole numbers. Precached, not fetched
 * per country, because the app must work offline in a field.
 *
 * USAGE
 *   node "data build tools/gen_country_index.js"              # all centuries
 *   node "data build tools/gen_country_index.js" --century 2001_2100
 *   node "data build tools/gen_country_index.js" --verify     # 1999 self-test
 */

'use strict';

var fs = require('fs'), zlib = require('zlib'), path = require('path'), vm = require('vm');

var ROOT     = path.join(__dirname, '..');
var OUT      = path.join(ROOT, 'data', 'country_index.json.gz');
var VERSION  = '2026-08-24a';

var FLOOR    = 20;    /* below this, drop the entry entirely */
var BUCKET   = 5;     /* obscuration granularity, percent   */
var COARSE   = 3.0;   /* deg, first pass over a country     */
var FINE     = 0.75;  /* deg, refinement around a hit       */
var COARSE_CAP = 400;
var FINE_CAP   = 600;

/* ------------------------------------------------------------- geometry */

function ringsOf(geom) {
  var out = [];
  (function walk(c) {
    if (typeof c[0][0] === 'number') { out.push(c); return; }
    for (var i = 0; i < c.length; i++) walk(c[i]);
  })(geom.coordinates);
  return out;
}

function bboxOf(rings) {
  var b = { w: 180, e: -180, s: 90, n: -90 };
  for (var k = 0; k < rings.length; k++)
    for (var i = 0; i < rings[k].length; i++) {
      var p = rings[k][i];
      if (p[0] < b.w) b.w = p[0];
      if (p[0] > b.e) b.e = p[0];
      if (p[1] < b.s) b.s = p[1];
      if (p[1] > b.n) b.n = p[1];
    }
  return b;
}

function ptInRings(rings, lon, lat) {
  var c = false;
  for (var k = 0; k < rings.length; k++) {
    var r = rings[k];
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      if (((r[i][1] > lat) !== (r[j][1] > lat)) &&
          (lon < (r[j][0] - r[i][0]) * (lat - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]))
        c = !c;
    }
  }
  return c;
}

function segCross(a, b, c, d) {
  function o(p, q, r) {
    var v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
    return v === 0 ? 0 : (v > 0 ? 1 : 2);
  }
  return o(a,b,c) !== o(a,b,d) && o(c,d,a) !== o(c,d,b);
}

/* Does the umbral band touch this country? Three ways in, cheapest first.
   The THIRD is the graze: neither shape has a vertex inside the other, but
   their edges cross. That is the case a sampled grid misses. */
function bandTouches(band, bandBox, C) {
  if (C.bbox.e < bandBox.w || C.bbox.w > bandBox.e ||
      C.bbox.n < bandBox.s || C.bbox.s > bandBox.n) return false;

  var i, r, ring, j;
  for (i = 0; i < band.length; i++)
    if (ptInRings(C.rings, band[i][0], band[i][1])) return true;

  for (r = 0; r < C.rings.length; r++)
    for (i = 0; i < C.rings[r].length; i++)
      if (ptInRings([band], C.rings[r][i][0], C.rings[r][i][1])) return true;

  for (i = 1; i < band.length; i++)
    for (r = 0; r < C.rings.length; r++) {
      ring = C.rings[r];
      for (j = 1; j < ring.length; j++)
        if (segCross(band[i-1], band[i], ring[j-1], ring[j])) return true;
    }
  return false;
}

/* Build the umbral corridor as polygons that can actually be tested against
   country borders in [-180,180].

   ⚠ THE TWO UMBRA LIMITS DO NOT ALWAYS SHARE A LONGITUDE CONVENTION.
   gen_eclipse_paths unwraps each limit along its own track, so a path crossing
   the antimeridian can come back with the north limit at 176..356 and the south
   limit at -179..-5 — one corridor, written two ways. Concatenating them raw
   gives a polygon spanning -179..356, a ring around the planet, and every
   country on Earth intersects it. That is how 2453-09-03 came to be flagged
   central in 108 countries including Andorra, where it is a 59.8% partial.

   Unwrap both onto one continuous convention, then return the corridor shifted
   into each 360 deg window, because after unwrapping it can sit outside the
   range the country polygons occupy. */
function bandWindows(un, us) {
  var ref = un[0][0];
  function unwrap(arr) {
    return arr.map(function (pt) {
      var x = pt[0];
      while (x - ref >  180) x -= 360;
      while (x - ref < -180) x += 360;
      return [x, pt[1]];
    });
  }
  var cont = unwrap(un).concat(unwrap(us).slice().reverse());
  return [-360, 0, 360].map(function (d) {
    var band = cont.map(function (pt) { return [pt[0] + d, pt[1]]; });
    var bb = { w: 180, e: -180, s: 90, n: -90 };
    for (var q = 0; q < band.length; q++) {
      if (band[q][0] < bb.w) bb.w = band[q][0];
      if (band[q][0] > bb.e) bb.e = band[q][0];
      if (band[q][1] < bb.s) bb.s = band[q][1];
      if (band[q][1] > bb.n) bb.n = band[q][1];
    }
    return { band: band, bb: bb };
  });
}

function bandHits(windows, C) {
  for (var i = 0; i < windows.length; i++)
    if (bandTouches(windows[i].band, windows[i].bb, C)) return true;
  return false;
}

/* --------------------------------------------------------------- inputs */

function loadCountries() {
  var cg = JSON.parse(zlib.gunzipSync(
    fs.readFileSync(path.join(ROOT, 'data/basemap/countries.geojson.gz'))).toString());
  return cg.features.map(function (f, i) {
    var rings = ringsOf(f.geometry);
    var names = (f.properties && f.properties.names) || [];
    if (!names.length)
      throw new Error('country ' + i + ' has no names — run name_countries.js first');
    return { idx: i, name: names[0], rings: rings, bbox: bboxOf(rings) };
  });
}

function loadEngine() {
  var sb = { window: {}, Math: Math, Date: Date, isNaN: isNaN,
             console: { log: function(){}, warn: function(){}, error: function(){} } };
  sb.self = sb.window; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/eclipse.js'), 'utf8'), sb);
  var E = sb.window.Eclipse || sb.window;
  if (!E.computeEclipse) throw new Error('js/eclipse.js did not expose computeEclipse');
  return E;
}

/* Grid of points inside a country. Cached per country per spacing, because it
   is reused for every one of the ~11,898 eclipses.

   TWO CORRECTIONS, both found 2026-08-25 while splitting the overseas units:

   1. ANTIMERIDIAN. New Zealand, Fiji and Kiribati straddle +-180, so their
      bounding box spans the ENTIRE globe and a west-to-east walk steps across
      the empty Atlantic finding nothing. Those three are re-walked in a 0..360
      frame, where their real extent is a few degrees wide again.

   2. THE FALLBACK WAS THE BBOX CENTRE, which for those same three is in the
      South Atlantic — the exact opposite side of the world from the country.
      It is now a real VERTEX-derived point, which is on or beside the country
      by construction and cannot be somewhere else entirely.

   164 of 248 countries are smaller than a 3 deg cell and get one point. That is
   fine and not worth chasing: the penumbra is thousands of km across, so one
   well-placed point represents a small country to well within the 5% buckets
   the index stores. What was NOT fine was the point being in the wrong ocean. */
function gridFor(C, step, cap) {
  var b = C.bbox, pts = [];
  var wraps = (b.e - b.w) > 180;

  if (!wraps) {
    for (var lat = b.s; lat <= b.n && pts.length < cap; lat += step)
      for (var lon = b.w; lon <= b.e && pts.length < cap; lon += step)
        if (ptInRings(C.rings, lon, lat)) pts.push([lat, lon]);
  } else {
    /* Re-derive the extent with every longitude pushed into 0..360, so the
       country is contiguous again, then convert each hit back. */
    var lo360 = 360, hi360 = 0;
    C.rings.forEach(function (r) {
      r.forEach(function (p) {
        var x = (p[0] + 360) % 360;
        if (x < lo360) lo360 = x;
        if (x > hi360) hi360 = x;
      });
    });
    for (var la = b.s; la <= b.n && pts.length < cap; la += step)
      for (var x = lo360; x <= hi360 && pts.length < cap; x += step) {
        var real = x > 180 ? x - 360 : x;
        if (ptInRings(C.rings, real, la)) pts.push([la, real]);
      }
  }

  if (!pts.length) {
    /* A real point ON the shape, not the middle of its bounding box. Take the
       vertex mean of the largest ring: for any convex-ish landmass that is
       inside it, and for anything else it is at worst just offshore. */
    var big = null;
    C.rings.forEach(function (r) { if (!big || r.length > big.length) big = r; });
    var sx = 0, sy = 0;
    big.forEach(function (p) { sx += p[0]; sy += p[1]; });
    pts.push([sy / big.length, sx / big.length]);
  }
  return pts;
}

/* --------------------------------------------------------------- worker */

function buildCentury(century, COUNTRIES, COARSE_GRID, E, index, stats) {
  var pFile = path.join(ROOT, 'data/paths/paths_' + century + '.json.gz');
  var bFile = path.join(ROOT, 'data/besselian/' + century + '.json');
  if (!fs.existsSync(pFile) || !fs.existsSync(bFile)) return;

  var paths = JSON.parse(zlib.gunzipSync(fs.readFileSync(pFile)).toString());
  var bess  = {};
  JSON.parse(fs.readFileSync(bFile, 'utf8')).forEach(function (r) {
    bess[String(r.cat_no)] = r;
  });

  Object.keys(paths).forEach(function (key) {
    var p   = paths[key];
    var rec = bess[String(p.cat_no)];
    if (!rec) { stats.noRec++; return; }

    var row = {};

    /* ---- 1. sampled obscuration, coarse then refined ------------------ */
    for (var ci = 0; ci < COUNTRIES.length; ci++) {
      var C = COUNTRIES[ci], g = COARSE_GRID[ci];
      var best = 0, bLat = 0, bLon = 0;
      for (var i = 0; i < g.length; i++) {
        var r = E.computeEclipse(rec, g[i][0], g[i][1], 0);
        if (r && r.visible && r.osc > best) { best = r.osc; bLat = g[i][0]; bLon = g[i][1]; }
      }
      if (best < FLOOR - BUCKET) continue;   /* not close to the floor: skip refining */

      /* Refine around the winning coarse node. Cheap: only the handful of
         countries that got near the floor reach here. */
      for (var d = 0; d < 2; d++) {
        var step = COARSE / Math.pow(2, d + 1);
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          var la = bLat + dy * step, lo = bLon + dx * step;
          if (!ptInRings(C.rings, lo, la)) continue;
          var rr = E.computeEclipse(rec, la, lo, 0);
          if (rr && rr.visible && rr.osc > best) { best = rr.osc; }
        }
      }
      if (best >= FLOOR) row[ci] = Math.round(best / BUCKET);
    }

    /* ---- 2. exact central path, overrules the sampling ---------------- */
    var un = (p.umbra_n && p.umbra_n[0]) || null;
    var us = (p.umbra_s && p.umbra_s[0]) || null;
    if (un && us && un.length > 1 && us.length > 1) {
      /* See bandWindows() — the two limits can arrive in different longitude
         conventions, and the corridor must be tested in each 360 deg window. */
      var windows = bandWindows(un, us);
      for (var cj = 0; cj < COUNTRIES.length; cj++) {
        if (!bandHits(windows, COUNTRIES[cj])) continue;
        /* NEGATIVE = the central path crossed here. Magnitude stays the best
           obscuration found; for a total that is 20 (=100%), for an annular
           it is whatever the annular peak sampled to, which is the honest
           number and is why the SIGN and not the value carries this fact. */
        var mag = row[cj] || Math.round(100 / BUCKET);
        row[cj] = -Math.abs(mag);
        stats.central++;
      }
    }

    var n = Object.keys(row).length;
    if (n) { index[p.cat_no] = row; stats.entries += n; }
    stats.eclipses++;
    if (stats.eclipses % 200 === 0)
      process.stdout.write('\r  ' + stats.eclipses + ' eclipses, '
                           + stats.entries + ' entries...   ');
  });
}

/* ----------------------------------------------------------------- main */

function centuriesAvailable() {
  return fs.readdirSync(path.join(ROOT, 'data/besselian'))
    .filter(function (f) { return /\.json$/.test(f); })
    .map(function (f) { return f.replace(/\.json$/, ''); });
}

function verify(COUNTRIES) {
  /* The 1999-08-11 path is one of the best documented in living memory, so it
     is the right thing to check the exact test against. */
  var paths = JSON.parse(zlib.gunzipSync(
    fs.readFileSync(path.join(ROOT, 'data/paths/paths_1901_2000.json.gz'))).toString());
  var key = Object.keys(paths).find(function (k) {
    var p = paths[k];
    return p.year === 1999 && p.month === 8 && p.day === 11;
  });
  if (!key) { console.error('1999-08-11 not found'); process.exit(1); }
  var p = paths[key];
  var band = p.umbra_n[0].concat(p.umbra_s[0].slice().reverse());
  var bb = { w: 180, e: -180, s: 90, n: -90 };
  band.forEach(function (q) {
    if (q[0] < bb.w) bb.w = q[0]; if (q[0] > bb.e) bb.e = q[0];
    if (q[1] < bb.s) bb.s = q[1]; if (q[1] > bb.n) bb.n = q[1];
  });
  var got = COUNTRIES.filter(function (C) { return bandTouches(band, bb, C); })
                     .map(function (C) { return C.name; });
  var must = ['serbia','united kingdom','france','germany','hungary','romania',
              'bulgaria','turkey','iraq','iran','india','austria'];
  var mustNot = ['italy','spain','poland','greece'];
  var ok = true;
  must.forEach(function (n) {
    if (got.indexOf(n) < 0) { console.error('  MISSING: ' + n); ok = false; }
  });
  mustNot.forEach(function (n) {
    if (got.indexOf(n) >= 0) { console.error('  WRONGLY INCLUDED: ' + n); ok = false; }
  });
  console.log('1999-08-11 umbral band -> ' + got.length + ' countries');
  console.log(ok ? '  VERIFY PASS' : '  VERIFY FAIL');
  process.exit(ok ? 0 : 1);
}

function main() {
  var args = process.argv.slice(2);
  var COUNTRIES = loadCountries();

  if (args.indexOf('--verify') >= 0) return verify(COUNTRIES);

  /* BATCH MODE. The full build is ~55 min, which outruns any single shell
     invocation, and a backgrounded process gets reaped. So each century can be
     built on its own into data/.country_parts/, and --merge assembles them.
     Resumable: an existing part is skipped, so a killed run costs one century
     rather than the whole build. */
  var PARTS = path.join(ROOT, 'data', '.country_parts');
  var mi = args.indexOf('--merge');
  if (mi >= 0) return merge(COUNTRIES, PARTS);

  /* --only 93,96,160,...  Recompute JUST these country positions and patch
     them into the existing index, leaving every other country's rows alone.
     The index keys each country by its POSITION, so as long as positions are
     append-only this is exact, not an approximation — and it turns a ~45 min
     rebuild into a couple of minutes when a handful of outlines change
     (see split_remote_units.js). */
  var oi = args.indexOf('--only');
  if (oi >= 0) return onlyThese(COUNTRIES, args[oi + 1].split(',').map(Number));

  var ci = args.indexOf('--century');
  var list = ci >= 0 ? args.slice(ci + 1).filter(function (a) { return !/^--/.test(a); })
                     : centuriesAvailable();

  console.log('countries : ' + COUNTRIES.length);
  console.log('centuries : ' + list.length);
  console.log('floor ' + FLOOR + '%, buckets of ' + BUCKET + '%\n');

  var E = loadEngine();
  var COARSE_GRID = COUNTRIES.map(function (C) { return gridFor(C, COARSE, COARSE_CAP); });

  if (!fs.existsSync(PARTS)) fs.mkdirSync(PARTS, { recursive: true });

  list.forEach(function (c) {
    var out = path.join(PARTS, c + '.json');
    if (fs.existsSync(out)) { console.log('  ' + c + ' — already built, skipping'); return; }
    var index = {}, stats = { eclipses: 0, entries: 0, central: 0, noRec: 0 };
    var t0 = Date.now();
    buildCentury(c, COUNTRIES, COARSE_GRID, E, index, stats);
    fs.writeFileSync(out, JSON.stringify(index));
    console.log('\r  ' + c + '  ' + String(stats.eclipses).padStart(4) + ' eclipses  '
                + String(stats.entries).padStart(6) + ' entries  '
                + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  });

  var done = fs.readdirSync(PARTS).length;
  console.log('\nparts built: ' + done + ' of ' + centuriesAvailable().length);
  if (done >= centuriesAvailable().length)
    console.log('all centuries done — run with --merge to write the index');
}

function onlyThese(COUNTRIES, want) {
  var E = loadEngine();
  var grids = {};
  want.forEach(function (i) {
    if (!COUNTRIES[i]) throw new Error('no country at position ' + i);
    grids[i] = gridFor(COUNTRIES[i], COARSE, COARSE_CAP);
  });
  console.log('recomputing ' + want.length + ' of ' + COUNTRIES.length + ' countries:');
  want.forEach(function (i) {
    console.log('   ' + String(i).padStart(3) + '  ' + COUNTRIES[i].name
                + '  (' + grids[i].length + ' sample pts)');
  });

  var payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(OUT)).toString());
  var index = payload.index;
  var t0 = Date.now(), done = 0, wrote = 0;

  centuriesAvailable().forEach(function (century) {
    var pFile = path.join(ROOT, 'data/paths/paths_' + century + '.json.gz');
    var bFile = path.join(ROOT, 'data/besselian/' + century + '.json');
    if (!fs.existsSync(pFile) || !fs.existsSync(bFile)) return;
    var paths = JSON.parse(zlib.gunzipSync(fs.readFileSync(pFile)).toString());
    var bess = {};
    JSON.parse(fs.readFileSync(bFile, 'utf8')).forEach(function (r) { bess[String(r.cat_no)] = r; });

    Object.keys(paths).forEach(function (key) {
      var p = paths[key], rec = bess[String(p.cat_no)];
      if (!rec) return;
      var row = index[p.cat_no] || {};

      /* Clear only the positions being redone. Anything else in this row is
         another country's answer and must survive untouched. */
      want.forEach(function (i) { delete row[i]; });

      want.forEach(function (i) {
        var C = COUNTRIES[i], g = grids[i], best = 0, bLat = 0, bLon = 0;
        for (var q = 0; q < g.length; q++) {
          var r = E.computeEclipse(rec, g[q][0], g[q][1], 0);
          if (r && r.visible && r.osc > best) { best = r.osc; bLat = g[q][0]; bLon = g[q][1]; }
        }
        if (best < FLOOR - BUCKET) return;
        for (var d = 0; d < 2; d++) {
          var step = COARSE / Math.pow(2, d + 1);
          for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
            if (!dx && !dy) continue;
            var la = bLat + dy * step, lo = bLon + dx * step;
            if (!ptInRings(C.rings, lo, la)) continue;
            var rr = E.computeEclipse(rec, la, lo, 0);
            if (rr && rr.visible && rr.osc > best) best = rr.osc;
          }
        }
        if (best >= FLOOR) row[i] = Math.round(best / BUCKET);
      });

      /* Exact central path, same overrule as the full build — INCLUDING the
         longitude-convention fix. This block is a second copy of the logic
         above; if you change one, change both, or an incremental rebuild will
         quietly reintroduce the ring-around-the-planet bug. */
      var un = (p.umbra_n && p.umbra_n[0]) || null;
      var us = (p.umbra_s && p.umbra_s[0]) || null;
      if (un && us && un.length > 1 && us.length > 1) {
        var windows = bandWindows(un, us);
        var isTotal = String(rec.eclipse_type || '').charAt(0) === 'T';
        want.forEach(function (i) {
          if (!bandHits(windows, COUNTRIES[i])) return;
          var mag = isTotal ? Math.round(100 / BUCKET)
                            : (row[i] || Math.round(100 / BUCKET));
          row[i] = -Math.abs(mag);
        });
      }

      if (Object.keys(row).length) { index[p.cat_no] = row; wrote++; }
      else delete index[p.cat_no];
      done++;
    });
  });

  payload.names = COUNTRIES.map(function (C) { return C.name; });
  payload.__meta.built = new Date().toISOString().slice(0, 10);
  var json = JSON.stringify(payload);
  var gz = zlib.gzipSync(json, { level: 9 });
  fs.writeFileSync(OUT, gz);
  console.log('\neclipses visited      : ' + done);
  console.log('eclipses with entries : ' + Object.keys(index).length);
  console.log('time                  : ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  console.log('gzipped               : ' + (gz.length / 1024).toFixed(0) + ' KB');
  console.log('\nwrote ' + OUT);
}

function merge(COUNTRIES, PARTS) {
  var files = fs.readdirSync(PARTS).filter(function (f) { return /\.json$/.test(f); });
  var expect = centuriesAvailable().length;
  if (files.length < expect) {
    console.error('only ' + files.length + ' of ' + expect + ' centuries built.');
    console.error('REFUSING TO MERGE: a partial index is worse than none — searches');
    console.error('would silently return nothing for the missing millennia.');
    process.exit(1);
  }
  var index = {}, entries = 0;
  files.forEach(function (f) {
    var part = JSON.parse(fs.readFileSync(path.join(PARTS, f), 'utf8'));
    Object.keys(part).forEach(function (k) {
      index[k] = part[k];
      entries += Object.keys(part[k]).length;
    });
  });

  /* REPAIR PASS — a TOTAL eclipse whose central path crossed a country reaches
     100% there BY DEFINITION, whatever the sampled grid found.
     Caught 1999-08-11: totality clipped Cornwall, a corridor far narrower than
     the 3 deg sample spacing, so the exact band test flagged the UK as central
     while the sampling had only reached 95%. The flag was right and the number
     was wrong, and a search for `uk >98` would have missed it.
     ONLY type T is lifted. An ANNULAR path peaks near 95% and never reaches
     100, so its sampled value IS the honest number. A HYBRID is total along
     part of its track and annular along the rest, so a country may have seen
     only the annular portion — lifting it to 100 would be a guess, and the
     sampled figure is the safer answer. */
  var typeOf = {}, lifted = 0;
  centuriesAvailable().forEach(function (c) {
    JSON.parse(fs.readFileSync(path.join(ROOT, 'data/besselian/' + c + '.json'), 'utf8'))
      .forEach(function (r) { typeOf[String(r.cat_no)] = String(r.eclipse_type || '').charAt(0); });
  });
  var FULL = Math.round(100 / BUCKET);
  Object.keys(index).forEach(function (cat) {
    if (typeOf[cat] !== 'T') return;
    var row = index[cat];
    Object.keys(row).forEach(function (ci) {
      if (row[ci] < 0 && row[ci] > -FULL) { row[ci] = -FULL; lifted++; }
    });
  });
  console.log('central-path entries lifted to 100% : ' + lifted);

  var payload = {
    __meta: {
      version: VERSION,
      built: new Date().toISOString().slice(0, 10),
      floor: FLOOR,
      bucket: BUCKET,
      note: 'value = obscuration/bucket; NEGATIVE = central path crossed this country'
    },
    names: COUNTRIES.map(function (C) { return C.name; }),
    index: index
  };
  var json = JSON.stringify(payload);
  var gz = zlib.gzipSync(json, { level: 9 });
  fs.writeFileSync(OUT, gz);
  console.log('eclipses with entries : ' + Object.keys(index).length);
  console.log('country entries       : ' + entries);
  console.log('raw                   : ' + (json.length / 1024 / 1024).toFixed(2) + ' MB');
  console.log('gzipped               : ' + (gz.length / 1024).toFixed(0) + ' KB');
  console.log('\nwrote ' + OUT);
}

main();
