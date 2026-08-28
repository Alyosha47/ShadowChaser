#!/usr/bin/env node
/* split_remote_units.js — ShadowChaser
 *
 * THE PROBLEM
 * -----------
 * `today+ total france` returned the total eclipse of 2045-08-12, which does
 * not go anywhere near France. It crosses FRENCH GUIANA, and Natural Earth's
 * "France" is one shape containing the overseas departments — Guiana, Réunion,
 * Guadeloupe, Martinique, Mayotte. Legally correct, practically useless: nobody
 * typing "france" means South America.
 *
 * The same trap sits under the Netherlands (Caribbean Netherlands) and New
 * Zealand (Tokelau).
 *
 * THE FIX
 * -------
 * Natural Earth's MAP UNITS file splits those countries. Rebuild the affected
 * outlines from it: the country keeps its own landmass, and each remote unit
 * becomes a searchable entry in its own right — `french guiana` and `réunion`
 * work now, which they never did.
 *
 * WHY 2500 km, AND WHY IT IS NOT ARBITRARY
 * ----------------------------------------
 * Map units also split things that must NOT be split: the UK into England /
 * Scotland / Wales / N. Ireland, Belgium into three regions, Serbia into two.
 * Swapping the file wholesale would break `united kingdom`.
 *
 * The distinction is geographic, not political. Measured, every split unit's
 * distance from its country's main landmass:
 *
 *      40–1699 km   Fed. of Bos. & Herz., Brussels, Barbuda, Gaza, Vojvodina,
 *                   N. Ireland, Wales, England, Zanzibar, Bougainville,
 *                   Christmas I., Jan Mayen, Madeira, Svalbard, AZORES 1699
 *      ---- nothing at all between 1699 and 4886 ----
 *     4886–9146 km  Tokelau, Caribbean Netherlands, Guadeloupe, Martinique,
 *                   FRENCH GUIANA 7206, Mayotte, Réunion 9146
 *
 * The threshold sits in an empty gap rather than cutting through a cluster, so
 * nothing is marginal and no judgement call is doing hidden work. Below it, a
 * unit is part of its country's own neighbourhood; above it, it is a different
 * continent that happens to share a government.
 *
 * INDICES ARE APPEND-ONLY
 * -----------------------
 * data/country_index.json.gz keys each country by its POSITION in the names array.
 * Reshaped countries keep their existing position and appended units go on the
 * end, so every one of the other 231 countries' precomputed rows stays valid
 * and only 10 need recomputing — about 4% of the work, minutes instead of the
 * ~45 the full build takes. Renumbering would silently invalidate the entire
 * index while leaving it looking perfectly well-formed.
 *
 * USAGE
 *   node "data build tools/split_remote_units.js" [path/to/ne_50m_admin_0_map_units.geojson]
 *
 * Writes data/basemap/countries.geojson.gz and prints the indices that must be
 * recomputed, for gen_country_index.js --only.
 */

'use strict';

var fs = require('fs'), zlib = require('zlib'), path = require('path'), https = require('https');

var ROOT   = path.join(__dirname, '..');
var TARGET = path.join(ROOT, 'data', 'basemap', 'countries.geojson.gz');
var NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/'
           + 'master/geojson/ne_50m_admin_0_map_units.geojson';

var REMOTE_KM = 2500;
var JUNK = { '-99': 1, '-': 1, '': 1 };

/* ------------------------------------------------------------------ utils */

function get(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      var b = ''; res.setEncoding('utf8');
      res.on('data', function (d) { b += d; });
      res.on('end', function () { resolve(b); });
    }).on('error', reject);
  });
}

function centroid(geom) {
  var sx = 0, sy = 0, n = 0;
  (function walk(c) {
    if (typeof c[0] === 'number') { sx += c[0]; sy += c[1]; n++; return; }
    for (var i = 0; i < c.length; i++) walk(c[i]);
  })(geom.coordinates);
  return { x: sx / n, y: sy / n, n: n };
}

function km(a, b) {
  var R = 6371, t = Math.PI / 180;
  var dLat = (b.y - a.y) * t, dLon = (b.x - a.x) * t;
  var h = Math.pow(Math.sin(dLat / 2), 2)
        + Math.cos(a.y * t) * Math.cos(b.y * t) * Math.pow(Math.sin(dLon / 2), 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function aliasesOf(p, extra) {
  var raw = [p.NAME, p.NAME_LONG, p.GEOUNIT, p.SUBUNIT, p.ADMIN,
             p.FORMAL_EN, p.ABBREV, p.ISO_A2, p.ISO_A3].concat(extra || []);
  var seen = {}, out = [];
  raw.forEach(function (v) {
    if (typeof v !== 'string') return;
    v = v.trim();
    if (JUNK[v]) return;
    var forms = [v];
    if (v.indexOf('.') >= 0) forms.push(v.replace(/\./g, ''));
    /* Accented names must ALSO be reachable unaccented: nobody types Réunion
       with the accent on a phone keyboard. */
    var plain = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (plain !== v) forms.push(plain);
    forms.forEach(function (f) {
      var k = f.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!k || JUNK[k] || seen[k]) return;
      seen[k] = 1; out.push(k);
    });
  });
  return out;
}

/* ------------------------------------------------------------------- main */

function main(localPath) {
  var load = localPath ? Promise.resolve(fs.readFileSync(localPath, 'utf8'))
                       : (console.log('Downloading Natural Earth map units...'), get(NE_URL));

  return load.then(function (txt) {
    var units = JSON.parse(txt).features;
    var ours  = JSON.parse(zlib.gunzipSync(fs.readFileSync(TARGET)).toString());

    /* Group units by ADMIN and find, for each, the ones that are REMOTE. */
    var byAdmin = {};
    units.forEach(function (f) {
      var a = f.properties.ADMIN;
      (byAdmin[a] = byAdmin[a] || []).push(f);
    });

    var plans = [];
    Object.keys(byAdmin).forEach(function (admin) {
      var us = byAdmin[admin];
      if (us.length < 2) return;
      var cs = us.map(function (f) { return { f: f, c: centroid(f.geometry) }; });
      cs.sort(function (a, b) { return b.c.n - a.c.n; });      /* biggest = the mainland */
      var main = cs[0];
      var remote = cs.slice(1).filter(function (x) { return km(main.c, x.c) >= REMOTE_KM; });
      if (!remote.length) return;                              /* UK, Belgium, Serbia... */
      plans.push({ admin: admin, keep: cs.filter(function (x) {
                     return remote.indexOf(x) < 0; }), remote: remote });
    });

    if (!plans.length) { console.log('nothing to split'); return; }

    console.log('countries with REMOTE units (>= ' + REMOTE_KM + ' km):\n');
    var changed = [], appended = [];

    plans.forEach(function (plan) {
      /* Find the existing feature by alias, so its POSITION is preserved. */
      var idx = -1;
      for (var i = 0; i < ours.features.length && idx < 0; i++) {
        var ns = (ours.features[i].properties.names) || [];
        if (ns.indexOf(plan.admin.toLowerCase()) >= 0) idx = i;
      }
      if (idx < 0) {
        console.log('  ' + plan.admin + ' — NOT FOUND in the shipped outlines, skipped');
        return;
      }

      /* Rebuild the country from the units that stay with it. */
      var parts = [];
      plan.keep.forEach(function (x) {
        var g = x.f.geometry;
        if (g.type === 'Polygon') parts.push(g.coordinates);
        else g.coordinates.forEach(function (p) { parts.push(p); });
      });
      ours.features[idx].geometry = { type: 'MultiPolygon', coordinates: parts };
      ours.features[idx].properties = {
        names: aliasesOf(plan.keep[0].f.properties, [plan.admin])
      };
      changed.push({ i: idx, name: plan.admin });
      console.log('  ' + plan.admin + '  (position ' + idx + ', reshaped to '
                  + plan.keep.length + ' unit(s))');

      plan.remote.forEach(function (x) {
        var g = x.f.geometry;
        var coords = (g.type === 'Polygon') ? [g.coordinates] : g.coordinates;
        ours.features.push({
          type: 'Feature',
          properties: { names: aliasesOf(x.f.properties) },
          geometry: { type: 'MultiPolygon', coordinates: coords }
        });
        appended.push({ i: ours.features.length - 1, name: x.f.properties.NAME });
        console.log('      + ' + String(Math.round(km(plan.keep[0].c ||
                      centroid(plan.keep[0].f.geometry), x.c))).padStart(5)
                    + ' km  ' + x.f.properties.NAME
                    + '  -> new position ' + (ours.features.length - 1));
      });
    });

    /* Nothing may be left nameless: a nameless outline is silently
       unsearchable, with no symptom but wrong results. */
    var nameless = ours.features.filter(function (f) {
      return !f.properties || !f.properties.names || !f.properties.names.length;
    }).length;
    if (nameless) {
      console.error('\nREFUSING TO WRITE: ' + nameless + ' outline(s) have no name.');
      process.exit(1);
    }

    var gz = zlib.gzipSync(JSON.stringify(ours), { level: 9 });
    fs.writeFileSync(TARGET, gz);
    console.log('\nwrote ' + TARGET + '  ('
                + (gz.length / 1024).toFixed(0) + ' KB, '
                + ours.features.length + ' outlines)');

    var all = changed.concat(appended).map(function (x) { return x.i; })
                     .sort(function (a, b) { return a - b; });
    console.log('\nRECOMPUTE THESE POSITIONS — every other country\'s rows stay valid:');
    console.log('  node "data build tools/gen_country_index.js" --only ' + all.join(','));
  });
}

main(process.argv[2]).catch(function (e) {
  console.error(e.message || e);
  process.exit(1);
});
