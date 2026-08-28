#!/usr/bin/env node
/* name_countries.js — attach country NAMES to data/basemap/countries.geojson.gz
 *
 * WHY THIS EXISTS
 * ---------------
 * countries.geojson.gz ships 241 outlines with EMPTY properties. The names were
 * lost when the file was put through the Python `antimeridian` package
 * (HANDOFF §"Antimeridian polygons"), and without them "eclipses in Chile"
 * has nothing to match "Chile" against.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does NOT regenerate the geometry. The shipped outlines carry the ±180
 * split, the corrected winding and the pole caps that make Antarctica and the
 * poles render at all — regenerating from Natural Earth would throw that away
 * to gain nothing. Every coordinate is passed through untouched; only
 * `properties` is written.
 *
 * HOW THE MATCH WORKS
 * -------------------
 * The shipped file was derived from Natural Earth 1:50m Admin 0 (241 features
 * against their 242), so the shapes correspond one-to-one. They are paired by
 * CENTROID, nearest wins, each Natural Earth feature usable once.
 *
 * 240 of 241 pair within 1.0 deg. The one that does not is FIJI, and that is
 * the antimeridian fix doing its job: Fiji straddles ±180, the split rewrote it
 * to span the whole -180..180 range, and its centroid moved ~2.5 deg as a
 * result. It is matched on its latitude band instead, which is unambiguous
 * because no other Natural Earth country sits between 21.7S and 12.5S while
 * touching the antimeridian.
 *
 * ALIASES come from Natural Earth's own columns, not a hand-written list that
 * would rot: NAME, NAME_LONG, ADMIN, FORMAL_EN, ABBREV, ISO_A2, ISO_A3. That is
 * where "USA", "US", "United States of America" and "U.S.A." all come from for
 * free. Aliases are lowercased and de-duplicated; junk values Natural Earth
 * uses for missing data ('-99', '-') are dropped.
 *
 * USAGE
 *   node "data build tools/name_countries.js" [path/to/ne_50m_admin_0_countries.geojson]
 *
 * If the Natural Earth path is omitted it is downloaded from the public-domain
 * nvkelso/natural-earth-vector repo on GitHub.
 *
 * Rerunnable: reads and writes the same .gz, and re-running on an already-named
 * file simply rewrites the same names.
 */

'use strict';

var fs   = require('fs');
var zlib = require('zlib');
var path = require('path');
var https = require('https');

var ROOT   = path.join(__dirname, '..');
var TARGET = path.join(ROOT, 'data', 'basemap', 'countries.geojson.gz');
var NE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/'
           + 'master/geojson/ne_50m_admin_0_countries.geojson';

/* Natural Earth writes these where it has no value. They must never become
   searchable aliases: '-99' matching a country would be a very odd bug. */
var JUNK = { '-99': 1, '-': 1, '': 1 };

/* ------------------------------------------------------------------ helpers */

function get(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      var buf = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { buf += d; });
      res.on('end', function () { resolve(buf); });
    }).on('error', reject);
  });
}

/* Centroid of every coordinate in the feature, plus its bounding box. The
   centroid is a vertex mean rather than an area centroid deliberately: both
   files came from the same vertices, so the same crude measure on both sides
   pairs them exactly, and an area centroid would not survive the pole caps. */
function stats(feature) {
  var sx = 0, sy = 0, n = 0;
  var mnx = 180, mxx = -180, mny = 90, mxy = -90;
  (function walk(c) {
    if (typeof c[0] === 'number') {
      sx += c[0]; sy += c[1]; n++;
      if (c[0] < mnx) mnx = c[0];
      if (c[0] > mxx) mxx = c[0];
      if (c[1] < mny) mny = c[1];
      if (c[1] > mxy) mxy = c[1];
      return;
    }
    for (var i = 0; i < c.length; i++) walk(c[i]);
  })(feature.geometry.coordinates);
  return { x: sx / n, y: sy / n, mnx: mnx, mxx: mxx, mny: mny, mxy: mxy };
}

function aliasesOf(p) {
  var raw = [p.NAME, p.NAME_LONG, p.ADMIN, p.FORMAL_EN, p.ABBREV,
             p.ISO_A2, p.ISO_A3, p.BRK_NAME, p.NAME_CIAWF];
  var seen = {}, out = [];
  for (var i = 0; i < raw.length; i++) {
    var v = raw[i];
    if (typeof v !== 'string') continue;
    v = v.trim();
    if (JUNK[v]) continue;
    /* Natural Earth's ABBREV carries the dotted forms ('U.S.A.'). Keep BOTH
       that and an undotted version, because people type it either way. */
    var forms = [v];
    if (v.indexOf('.') >= 0) forms.push(v.replace(/\./g, ''));
    for (var k = 0; k < forms.length; k++) {
      var f = forms[k].toLowerCase().replace(/\s+/g, ' ').trim();
      if (!f || JUNK[f] || seen[f]) continue;
      seen[f] = 1;
      out.push(f);
    }
  }
  return out;
}

/* -------------------------------------------------------------------- main */

function main(nePath) {
  var loadNE = nePath
    ? Promise.resolve(fs.readFileSync(nePath, 'utf8'))
    : (console.log('Downloading Natural Earth 1:50m Admin 0 (public domain)...'),
       get(NE_URL));

  return loadNE.then(function (neText) {
    var ne   = JSON.parse(neText);
    var ours = JSON.parse(zlib.gunzipSync(fs.readFileSync(TARGET)).toString('utf8'));

    console.log('shipped outlines : ' + ours.features.length);
    console.log('natural earth    : ' + ne.features.length);

    var A = ours.features.map(stats);
    var B = ne.features.map(stats);

    var taken = {}, matched = 0, unmatched = [];

    /* Pass 1 — nearest centroid, within 1.0 deg, each NE feature used once. */
    for (var i = 0; i < A.length; i++) {
      var best = -1, bd = Infinity;
      for (var j = 0; j < B.length; j++) {
        if (taken[j]) continue;
        var d = Math.hypot(A[i].x - B[j].x, A[i].y - B[j].y);
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0 && bd <= 1.0) {
        taken[best] = 1;
        ours.features[i].properties = { names: aliasesOf(ne.features[best].properties) };
        matched++;
      } else {
        unmatched.push(i);
      }
    }

    /* Pass 2 — the antimeridian cases. A shape the ±180 split rewrote spans the
       full -180..180 range, so its centroid is meaningless; its LATITUDE band is
       not, and no two countries share one while touching the antimeridian. */
    for (var u = 0; u < unmatched.length; u++) {
      var ai = unmatched[u], a = A[ai];
      var pick = -1, pd = Infinity;
      for (var m = 0; m < B.length; m++) {
        if (taken[m]) continue;
        var b = B[m];
        var touchesAM = b.mxx > 170 || b.mnx < -170;
        if (!touchesAM) continue;
        var dLat = Math.hypot(a.mny - b.mny, a.mxy - b.mxy);
        if (dLat < pd) { pd = dLat; pick = m; }
      }
      if (pick >= 0 && pd <= 5.0) {
        taken[pick] = 1;
        ours.features[ai].properties = { names: aliasesOf(ne.features[pick].properties) };
        matched++;
        console.log('  antimeridian match: idx ' + ai + ' -> '
                    + ne.features[pick].properties.NAME
                    + ' (lat band delta ' + pd.toFixed(2) + ')');
      } else {
        ours.features[ai].properties = { names: [] };
        console.log('  UNMATCHED: idx ' + ai + '  bbox lon '
                    + a.mnx.toFixed(1) + '..' + a.mxx.toFixed(1)
                    + '  lat ' + a.mny.toFixed(1) + '..' + a.mxy.toFixed(1));
      }
    }

    console.log('named            : ' + matched + ' of ' + ours.features.length);

    var nameless = ours.features.filter(function (f) {
      return !f.properties.names || !f.properties.names.length;
    }).length;
    if (nameless) {
      console.error('\nREFUSING TO WRITE: ' + nameless + ' outline(s) have no name.');
      console.error('A nameless country is silently unsearchable, which is the exact');
      console.error('failure this script exists to end. Fix the match, then rerun.');
      process.exit(1);
    }

    /* Spot-check a few that people actually type, so a silent mis-pairing
       (every shape named, but named WRONG) cannot pass unnoticed.
       PRINT THE BOUNDING BOX, NOT THE CENTROID. A centroid is nonsense for any
       shape the ±180 split rewrote: New Zealand's reads 147E, which is Tasmania,
       and the USA's is dragged to British Columbia by Alaska's vertex count.
       Both shapes are correct; the centroid was the wrong instrument. This
       printed a centroid on the first run and briefly looked like a bad match. */
    var probes = ['chile', 'united states of america', 'norway', 'fiji',
                  'new zealand', 'japan', 'australia'];
    console.log('\nspot check (bounding boxes):');
    probes.forEach(function (want) {
      var hit = -1;
      for (var q = 0; q < ours.features.length; q++) {
        if (ours.features[q].properties.names.indexOf(want) >= 0) { hit = q; break; }
      }
      if (hit < 0) { console.log('  ' + want + ' -> NOT FOUND'); return; }
      var s = A[hit];
      console.log('  ' + want + ' -> idx ' + hit
                  + '  lon ' + s.mnx.toFixed(1) + '..' + s.mxx.toFixed(1)
                  + '  lat ' + s.mny.toFixed(1) + '..' + s.mxy.toFixed(1));
    });

    var json = JSON.stringify(ours);
    var gz   = zlib.gzipSync(json, { level: 9 });
    fs.writeFileSync(TARGET, gz);
    console.log('\nwrote ' + TARGET + '  (' + (gz.length / 1024).toFixed(0) + ' KB gzipped)');
  });
}

main(process.argv[2]).catch(function (err) {
  console.error(err.message || err);
  process.exit(1);
});
