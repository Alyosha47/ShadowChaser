const ROOT = require('path').join(__dirname, '..', '..');  /* repo root, wherever this is run from */
/* T-shirt map module: the ported projection maths, band construction and SVG
   output, plus the sheet markup contract. */
const fs = require('fs');
const zlib = require('zlib');
const { JSDOM } = require('jsdom');

let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { console.log('  FAIL ' + n + (x ? '  → ' + x : '')); fails++; } };

const html = fs.readFileSync(ROOT + '/index.html', 'utf8');
const dom  = new JSDOM(html, { runScripts: 'outside-only' });
const w    = dom.window, doc = w.document;

w.eval('var DATA_BASE="data", BUILD="t";'
     + 'function loadPathChunk(){return Promise.resolve(null);}'
     + 'function scLogRows(){return [];} function scLogPicked(){return false;}'
     + 'function setStatus(){}');
w.eval(fs.readFileSync(ROOT + '/js/tshirt.js', 'utf8'));
const I = w._tsInternals;

console.log('1. isolation');
ok('exports present', !!w.tsOpen && !!w.tsRedraw && !!w.tsExportSVG && !!I);
/* The ported code uses top-level const; a duplicate const in another script is
   a fatal SyntaxError, not a shadow. The IIFE is what prevents that. */
ok('no globals leaked', ['PALETTES','PROJS','DEG','ROB','NE'].every(n => typeof w[n] === 'undefined'),
   ['PALETTES','PROJS','DEG','ROB','NE'].filter(n => typeof w[n] !== 'undefined').join(','));
ok('does not clobber map.js loadPathChunk',
   !/function loadPathChunk/.test(fs.readFileSync(ROOT + '/js/tshirt.js', 'utf8')));

console.log('\n2. sheet markup matches the module');
const themes = [...doc.getElementById('ts-theme').options].map(o => o.value);
const projs  = [...doc.getElementById('ts-proj').options].map(o => o.value);
ok('every theme option resolves to a palette', themes.every(t => t in I.PALETTES),
   themes.filter(t => !(t in I.PALETTES)).join(','));
ok('every projection option resolves', projs.every(p => p in I.PROJS),
   projs.filter(p => !(p in I.PROJS)).join(','));
ok('seven projections offered', projs.length === 7, String(projs.length));
ok('four themes offered (kraft and riso removed)', themes.length === 4, String(themes.length));
const centres = [...doc.getElementById('ts-centre').options].map(o => o.value);
ok('four central meridians offered', centres.length === 4, centres.join(','));

console.log('\n3. projection maths');
ok('all map (0,0) to the origin',
   projs.every(p => { const o = I.PROJS[p].project(0, 0); return Math.abs(o[0]) < 0.01 && Math.abs(o[1]) < 0.01; }));
ok('north pole is screen-up (negative y)', I.PROJS.robinson.project(0, 90)[1] < 0);
ok('lon 180 lies east of centre', I.PROJS.natearth.project(180, 0)[0] > 0);
/* Mollweide's Newton step divides by 2+2cos(2th), zero at the poles — it
   returned NaN at lat +-90 in the original tool and is clamped in the port. */
let nonFinite = [];
for (const p of projs)
  for (let lo = -180; lo <= 180; lo += 15)
    for (let la = -90; la <= 90; la += 15)
      if (!I.PROJS[p].project(lo, la).every(Number.isFinite)) nonFinite.push(`${p}(${lo},${la})`);
ok('no projection returns NaN anywhere on a 15-degree global grid',
   nonFinite.length === 0, nonFinite.slice(0, 5).join(' '));
ok('Mollweide is finite at both poles',
   I.PROJS.mollweide.project(0, 90).every(Number.isFinite) &&
   I.PROJS.mollweide.project(0, -90).every(Number.isFinite));

console.log('\n4. antimeridian split');
/* splitEdge normalises into ±180 and cuts where the jump exceeds 180 — this is
   what removes the need for a polygon clipping library. */
const crossing = [[170,10],[178,11],[-178,12],[-170,13]];
const segs = I.splitEdge(crossing);
ok('a crossing path is split in two', segs.length === 2, String(segs.length));
ok('no segment spans the seam',
   segs.every(s => s.every((p, i) => i === 0 || Math.abs(p[0] - s[i-1][0]) <= 180)));
ok('a non-crossing path stays whole', I.splitEdge([[10,0],[20,1],[30,2]]).length === 1);

console.log('\n5. end to end on real catalogue data');
const chunk = JSON.parse(zlib.gunzipSync(fs.readFileSync(ROOT + '/data/paths/paths_2001_2100.json.gz')));
const recs = Object.keys(chunk).filter(k => k !== '__meta').map(k => chunk[k])
  .filter(r => 'TAH'.includes((r.type || '')[0]) && r.umbra_n && r.umbra_s).slice(0, 5);
const bands = I.buildBands(recs);
/* One-limit eclipses (A+, An, As, Tn, Ts, T+, T- — ~187 of them) have only one
   umbral edge, so no band can be built and they are excluded by design. The
   record still HAS an umbra_n key, holding an empty array, which is why the
   filter alone doesn't catch them. See TODO #F1a. */
const oneLimit = recs.filter(r => !(r.umbra_n[0] || []).length || !(r.umbra_s[0] || []).length);
ok('bands built for every two-limit record',
   bands.length === recs.length - oneLimit.length,
   `${bands.length} bands from ${recs.length} records, ${oneLimit.length} one-limit`);
ok('one-limit eclipses are dropped, not drawn empty',
   oneLimit.every(r => I.buildBands([r]).length === 0));
ok('every band has pieces', bands.every(b => b.pieces.length > 0));
ok('types mapped to palette keys', bands.every(b => ['total','annular','hybrid'].includes(b.type)));
ok('sorted by date', bands.map(b => b.date).join() === bands.map(b => b.date).sort().join());
/* Partials have no umbral band and must be dropped, not drawn empty. */
const partial = Object.keys(chunk).filter(k => k !== '__meta').map(k => chunk[k])
  .find(r => (r.type || '')[0] === 'P');
if (partial) ok('partials are excluded', I.buildBands([partial]).length === 0);

console.log('\n6. SVG output');
for (const p of projs) {
  const svg = I.renderSVG(bands, p, 'tshirt');
  ok(`${p} renders clean`, svg.startsWith('<svg') && svg.endsWith('</svg>') && !/NaN/.test(svg));
}
const svg = I.renderSVG(bands, 'natearth', 'tshirt');
ok('draws a band path per band', (svg.match(/class="band"/g) || []).length >= bands.length,
   String((svg.match(/class="band"/g) || []).length));
/* The original hides BOTH the frame outline and the graticule
   (.frame{display:none}, .graticule{display:none}); an earlier draft of the
   port drew them, which is why the maps looked busy and wrong. */
ok('no visible frame outline', !/class="frame"/.test(svg));
ok('no graticule', !/graticule/.test(svg));
/* Clipping to the projection disc is what stops a wrapping band streaking
   across the whole canvas — the "broken paths" symptom. */
ok('a clipPath is defined', /<clipPath id="tsClip">/.test(svg));
ok('land, bands and labels are all clipped',
   (svg.match(/clip-path="url\(#tsClip\)"/g) || []).length === 3,
   String((svg.match(/clip-path="url\(#tsClip\)"/g) || []).length));
ok('bands carry the palette blend mode', /mix-blend-mode:/.test(svg));
ok('empty selection yields no bands', !/class="band"/.test(I.renderSVG([], 'plate', 'midnight', [], [])));

console.log('\n7. the pieces an earlier draft lost');
const land  = I.landRings({ land: JSON.parse(zlib.gunzipSync(
                 fs.readFileSync(ROOT + '/data/basemap/land.geojson.gz'))) });
const marks = [[-3.4186, 41.9851], [139.69, 35.68]];
ok('land rings extracted from the app basemap', land.length > 1000, String(land.length));
for (const p of projs) {
  const full = I.renderSVG(bands, p, 'tshirt', land, marks);
  const n = re => (full.match(re) || []).length;
  ok(`${p}: land + centrelines + labels + marks`,
     n(/class="land"/g) > 100 && n(/class="cline"/g) > 0 &&
     n(/<textPath/g) > 0 && n(/class="mark"/g) === marks.length && !/NaN/.test(full),
     `land ${n(/class="land"/g)} cl ${n(/class="cline"/g)} lbl ${n(/<textPath/g)} mark ${n(/class="mark"/g)}`);
}
/* projectPiece breaks the path with M at an antimeridian jump and closes once;
   splitAndProject+pathFromPts closes EVERY segment with Z, which is what
   mangled Plate Carree in the first draft. */
const seamRing = [[170,10],[178,11],[-178,12],[-170,13],[-170,8],[178,7],[170,8]];
const d = I.projectPiece(seamRing, I.PROJS.plate);
ok('projectPiece breaks at the seam instead of closing across it',
   (d.match(/M/g) || []).length >= 2, d.slice(0, 60));
ok('a date label is present for each band with a centreline',
   (I.renderSVG(bands, 'plate', 'tshirt', land, marks).match(/<textPath/g) || []).length
     === bands.filter(b => b.clSegs && b.clSegs.length).length);

console.log('\n8. the ribbon');
/* The corridor is built as a RIBBON of quads — one per step of a monotonic walk
   pairing each north vertex with the south vertex across from it — not as a
   single closed polygon. That removes every global-geometry special case:
   winding, antimeridian, polar caps. These assertions guard the properties the
   ribbon guarantees, so nobody reintroduces the polygon model. */
/* Angular separation between two lon/lat points, degrees. */
const angSep = (a, b) => {
  const D = Math.PI/180, la1 = a[1]*D, la2 = b[1]*D, dl = (b[0]-a[0])*D;
  return Math.acos(Math.max(-1, Math.min(1,
    Math.sin(la1)*Math.sin(la2) + Math.cos(la1)*Math.cos(la2)*Math.cos(dl)))) / D;
};
const angSpan = q => {
  let m = 0;
  for (let i = 0; i < q.length; i++)
    for (let j = i+1; j < q.length; j++) m = Math.max(m, angSep(q[i], q[j]));
  return m;
};

const areaPct = b => {
  let A = 0;
  for (const q of b.pieces) {
    let a = 0;
    for (let i = 0; i < q.length; i++) { const k = (i+1) % q.length;
      a += q[i][0]*q[k][1] - q[k][0]*q[i][1]; }
    A += Math.abs(a/2);
  }
  return A / (360*180) * 100;
};
const allRecs = Object.keys(chunk).filter(k => k !== '__meta').map(k => chunk[k]);
const byDate = (recs, y, m, d) => recs.find(r => r.year===y && r.month===m && r.day===d);
const load = f => JSON.parse(zlib.gunzipSync(fs.readFileSync(`${ROOT}/data/paths/${f}.json.gz`)));

ok('every piece is a quad', I.buildBands([byDate(allRecs, 2017, 8, 21)])[0]
     .pieces.every(q => q.length === 4));

/* The limbs are sampled independently and a limb running off the disc is much
   shorter than its partner — 109-02-17 has 564 north points to 90 south.
   Pairing by array-index fraction joined unrelated points and made quads 357
   degrees wide. The walk pairs by position instead. */
const b109 = I.buildBands([byDate(Object.keys(load('paths_101_200'))
  .filter(k => k !== '__meta').map(k => load('paths_101_200')[k]), 109, 2, 17)])[0];
ok('109-02-17 (564 vs 90 points) is sane', areaPct(b109) < 3, areaPct(b109).toFixed(2) + '%');

/* The three cases reported broken, in order. */
for (const [file, y, m, d, label] of [
      ['paths_2001_2100', 2015, 3, 20, 'ends at the pole'],
      ['paths_2701_2800', 2753, 7, 22, 'encircles the pole'],
      ['paths_2801_2900', 2806, 4, 10, 'encircles the pole']]) {
  const ch = load(file);
  const rec = Object.keys(ch).filter(k => k !== '__meta').map(k => ch[k])
    .find(r => r.year===y && r.month===m && r.day===d);
  const b = I.buildBands([rec])[0];
  ok(`${b.date} (${label}) covers a plausible area`, areaPct(b) < 3, areaPct(b).toFixed(2) + '%');
  /* Longitude width is meaningless at a pole, where every longitude is the
     same place — a legitimate polar quad spans a wide lon range. The real test
     is ANGULAR size: Espenak's widest path is 1419 km (12.8 deg), so no quad
     should exceed that by much. */
  ok(`${b.date} has no quad wider than a real corridor`,
     b.pieces.every(q => angSpan(q) <= 20), String(Math.max(...b.pieces.map(angSpan)).toFixed(1)));
}

/* An ordinary band's quads are a couple of degrees across; if that ever grows,
   the pairing has drifted. */
const b2017 = I.buildBands([byDate(allRecs, 2017, 8, 21)])[0];
ok('an ordinary band has narrow quads',
   Math.max(...b2017.pieces.map(q => {
     const xs = q.map(p => p[0]); return Math.max(...xs) - Math.min(...xs);
   })) < 5);

/* No band anywhere may flood the map. This is the check that would have caught
   every failure in this feature's history. */
let over = [];
for (const f of fs.readdirSync(`${ROOT}/data/paths`)
                  .filter(x => x.endsWith('.gz') && !x.includes('kinked'))) {
  const ch = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${ROOT}/data/paths/${f}`)));
  for (const r of Object.keys(ch).filter(k => k !== '__meta').map(k => ch[k])) {
    const b = I.buildBands([r])[0];
    if (b && areaPct(b) > 8) over.push(b.date);
  }
}
/* An eclipse band is a thin corridor; anything covering a large share of the
   map is wrong. 6% leaves room for the widest genuine near-polar bands, which
   look large in lon/lat because area there is compressed. */
ok('NO band in the whole catalogue covers over 8% of the map',
   over.length === 0, over.slice(0, 5).join(', '));

/* The band may be extended to the pole, but ONLY where the centreline runs
   past the limbs (the limb data has stopped and the corridor carries on), and
   only as far as the pole. Anywhere else, drawing past the limbs is inventing
   geometry — which is what produced a striped bar across the top of the map. */
let invented = [], bare = [];
for (const f of fs.readdirSync(`${ROOT}/data/paths`)
                  .filter(x => x.endsWith('.gz') && !x.includes('kinked'))) {
  const ch = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${ROOT}/data/paths/${f}`)));
  for (const r of Object.keys(ch).filter(k => k !== '__meta').map(k => ch[k])) {
    const b = I.buildBands([r])[0];
    if (!b) continue;
    const bandMax = Math.max(...b.pieces.flat().map(x => Math.abs(x[1])));
    const limbMax = Math.max(...r.umbra_n[0].concat(r.umbra_s[0]).map(x => Math.abs(x[1])));
    const cl = (r.centreline && r.centreline[0]) || [];
    const clMax = cl.length ? Math.max(...cl.map(x => Math.abs(x[1]))) : 0;
    if (bandMax > limbMax + 0.02 && !(clMax > limbMax + 0.05)) invented.push(b.date);
    if (bandMax > 90.001) invented.push(b.date + ' (past the pole)');
    /* And the inverse: never a centreline hanging in space with no band. */
    if (b.clSegs) {
      const drawn = Math.max(...b.clSegs.flat().map(x => Math.abs(x[1])));
      if (drawn > bandMax + 0.05) bare.push(b.date);
    }
  }
}
ok('a band is extended past its limbs ONLY toward the pole, and only when the centreline goes there',
   invented.length === 0, invented.slice(0, 5).join(', '));
ok('no centreline is drawn where there is no band',
   bare.length === 0, bare.slice(0, 5).join(', '));

console.log('\n9. sheet sizing');
/* This chain has broken twice, in both directions: with flex:1 1 auto the map
   overflowed the sheet, and with flex:1 1 0 but no definite height on the body
   the sheet collapsed to head+foot and showed no map at all. All four of these
   are load-bearing together. */
const css      = fs.readFileSync(ROOT + '/css/app.css', 'utf8');
const bodyRule = css.match(/\.sheet-body \{[^}]*\}/)[0];
const contRule = css.match(/\.sheet-content \{[^}]*\}/)[0];
ok('sheet-body has a DEFINITE height, not just max-height',
   /\n\s*height:\s*\d/.test(bodyRule), (bodyRule.match(/height:[^;]*/g) || []).join(' | '));
ok('sheet-content has flex-basis 0', /flex:\s*1 1 0/.test(contRule));
ok('sheet-content can shrink below content size', /min-height:\s*0/.test(contRule));
ok('svg is bounded in BOTH axes',
   /\.sheet-content svg \{[^}]*max-width:\s*100%[^}]*max-height:\s*100%/s.test(css));
ok('desktop sheet has a height too',
   /\.sheet-body \{[^}]*height:\s*\d+vh/s.test(css.slice(css.indexOf('@media (min-width: 900px)'))));
/* Restored after being lost in a block rewrite — without it these are bare
   browser-chrome buttons. */
ok('.log-btn has a base style', /\n\s*\.log-btn \{[^}]*background:/.test(css));
ok('log tools is a grid, so no button strands alone',
   /\.log-tools \{[^}]*display:\s*grid/s.test(css));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
