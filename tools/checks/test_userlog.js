const ROOT = require('path').join(__dirname, '..', '..');  /* repo root, wherever this is run from */
/* Exercise js/userlog.js against the real index.html DOM, with the real
   search_parser and format modules, and a minimal shim for the rest. */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const R = ROOT + '/';

const html = fs.readFileSync(R + 'index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://x.test/' });
const w = dom.window;

// ── localStorage shim (jsdom has one, but keep it explicit/inspectable)
const store = {};
Object.defineProperty(w, 'localStorage', {
  value: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  }, configurable: true
});

let NARROW = false;
w.matchMedia = q => ({ matches: /max-width: 899px/.test(q) ? NARROW : !NARROW });

function run(file) { w.eval(fs.readFileSync(R + file, 'utf8')); }

// Real modules the log leans on.
run('js/search-parser.js');
run('js/format.js');
run('js/state.js');

// ── Minimal shims for modules we're not loading.
w.eval(`
  var statusLog = [];
  function setStatus(m, err) { statusLog.push([m, !!err]); }
  var selectCalls = [];
  function selectEclipse(y,m,d){ selectCalls.push([y,m,d]);
    for (var i=0;i<eclipseIndex.length;i++){var e=eclipseIndex[i];
      if(e.year===y&&e.month===m&&e.day===d){selectedEntry=e;break;}} }
  var renderDataCalls = 0;
  function renderData(){ renderDataCalls++; }
  function onSearchChanged(skip){ currentFilter = parseSearch(document.getElementById('search').value); }
  function parseCoords(){ return currentFilter && currentFilter.coords ? currentFilter.coords : null; }
  function lookupElevationAndTz(){}
  var switchCalls = [];
  function switchTab(t){ switchCalls.push(t); }
  var switchCalls = [];
  function switchTab(t){ switchCalls.push(t); }
`);

run('js/userlog.js');

// ── Fixtures: three real catalogue records, cat_no as FLOATS like index.json.
const idx = JSON.parse(fs.readFileSync(R + 'data/index.json', 'utf8'));
const pick = [];
for (const e of idx) {
  if (e.year === 1999 && e.month === 8) pick.push(e);
  if (e.year === 2024 && e.month === 4) pick.push(e);
  if (e.year === 2026 && e.month === 8) pick.push(e);
}
w.eclipseIndex = pick;
console.log('fixtures:', pick.map(e => `${e.year}-${e.month} cat_no=${e.cat_no} (${typeof e.cat_no})`));

let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  PASS ' + name);
  else { console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); fails++; }
}

// ── 1. Key derivation from float cat_no
console.log('\n1. key derivation');
const k0 = w.scLogKey(pick[0]);
ok('float cat_no yields integer string', /^\d+$/.test(k0), k0);
ok('no decimal point in key', k0.indexOf('.') === -1, k0);

// ── 2. Save / unsave via presence
console.log('\n2. save toggles presence');
w.selectedEntry = pick[0];
w.currentFilter = w.parseSearch('');
ok('not saved initially', !w.scLogHas(k0));
w.scLogToggle(pick[0]);
ok('saved after toggle', w.scLogHas(k0));
ok('no `saved` field written', !('saved' in w.scLogGet(k0)), JSON.stringify(w.scLogGet(k0)));
ok('ts written', typeof w.scLogGet(k0).ts === 'number');
ok('no loc when no coords set', !w.scLogGet(k0).loc);
w.scLogToggle(pick[0]);
ok('unsaved deletes entry', !w.scLogHas(k0));
ok('count back to 0', w.scLogCount() === 0);

// ── 3. Save captures the current location, in [lon,lat] order
console.log('\n3. location capture and order');
const search = w.document.getElementById('search');
search.value = w.filterToString(Object.assign({}, w.parseSearch(''), { coords: { lat: 41.9851, lon: -3.4186 } }));
w.onSearchChanged(true);
ok('parseCoords sees the box', !!w.parseCoords(), JSON.stringify(w.parseCoords()));
w.scLogToggle(pick[0]);
const e0 = w.scLogGet(k0);
ok('loc captured', Array.isArray(e0.loc), JSON.stringify(e0.loc));
ok('loc[0] is LONGITUDE', Math.abs(e0.loc[0] - (-3.4186)) < 1e-4, String(e0.loc[0]));
ok('loc[1] is LATITUDE',  Math.abs(e0.loc[1] - 41.9851) < 1e-4, String(e0.loc[1]));

// ── 4. seen is sparse
console.log('\n4. seen is sparse');
w.scLogSetSeen(k0, true);
ok('seen:true stored', w.scLogGet(k0).seen === true);
w.scLogSetSeen(k0, false);
ok('seen removed, not false', !('seen' in w.scLogGet(k0)), JSON.stringify(w.scLogGet(k0)));

// ── 5. the note field is gone and must stay gone
console.log('\n5. no note field');
ok('no scLogSetNote function', typeof w.scLogSetNote === 'undefined');
ok('nothing writes a note key', !('note' in (w.scLogGet(k0) || {})));

// ── 6. persistence round-trip through localStorage
console.log('\n6. persistence');
ok('written to sc.log key', !!store['sc.log']);
const reparsed = JSON.parse(store['sc.log']);
ok('v:1 on the outer object', reparsed.v === 1);
ok('entry survives serialisation', !!reparsed.entries[k0]);

// ── 7. panel renders
console.log('\n7. panel render');
w.scLogToggle(pick[1]);
w.renderLogList();
const listEl = w.document.getElementById('log-list');
ok('rows rendered', listEl.querySelectorAll('.log-item').length === 2,
   String(listEl.querySelectorAll('.log-item').length));
ok('summary counts shown', /2 saved/.test(listEl.textContent), listEl.textContent.slice(0, 60));
ok('date order (1999 before 2024)',
   listEl.textContent.indexOf('1999') < listEl.textContent.indexOf('2024'));

// ── 8. goto restores the saved location
console.log('\n8. goto');
const k1 = w.scLogKey(pick[1]);
w.scLogSetLoc(k1, 100.5, -20.25);
search.value = '';
w.onSearchChanged(true);
w.scLogGoto(k1);
const c = w.parseCoords();
ok('goto puts the entry location in the search box',
   !!c && Math.abs(c.lon - 100.5) < 1e-3 && Math.abs(c.lat + 20.25) < 1e-3, JSON.stringify(c));
ok('goto selects the eclipse', w.selectCalls.length > 0);

// ── 10. save button html reflects state
console.log('\n10. save button');
w.selectedEntry = pick[0];
// The star is SVG now (a text glyph centres on its line box, so it sat high
// in the button); "saved" is carried by fill, not by a different glyph.
ok('saved: filled star + pressed', /fill="currentColor"/.test(w.scLogSaveButtonHtml())
   && /aria-pressed="true"/.test(w.scLogSaveButtonHtml()));
w.selectedEntry = pick[2];
ok('unsaved: hollow star + not pressed', /fill="none"/.test(w.scLogSaveButtonHtml())
   && /aria-pressed="false"/.test(w.scLogSaveButtonHtml()));
ok('button is icon-only, no words', !/[A-Za-z]{3}</.test(w.scLogSaveButtonHtml()));

// ── 11. corrupt storage doesn't throw
console.log('\n11. resilience');
store['sc.log'] = '{not json';
w.eval('_scLog = null;');
let threw = false;
try { w.scLogLoad(); } catch (e) { threw = true; }
ok('corrupt JSON handled', !threw && w.scLogCount() === 0);

// ── 12. HTML escaping — the tooltip is the only user-influenced string left
console.log('\n12. escaping');
w.eval('_scLog = null;');
store['sc.log'] = JSON.stringify({ v: 1, entries: {} });
w.scLogToggle(pick[0]);
ok('scLogEsc neutralises markup',
   w.scLogEsc('<img src=x onerror=alert(1)>').indexOf('<img') === -1);
ok('rendered rows contain no raw user markup',
   !/<img src=x/.test(w.document.getElementById('log-list').innerHTML));

/* ── 13. no expander: every action lives on the row ──────────────────── */
console.log('\n13. flat row, no pulldown');
w.eval('_scLog = null;');
store['sc.log'] = JSON.stringify({ v: 1, entries: {} });
w.scLogToggle(pick[0]);
const kA = w.scLogKey(pick[0]);
w.scLogSetLoc(kA, 55.5, -11.25);
w.selectCalls.length = 0;
search.value = ''; w.onSearchChanged(true);
w.renderLogList();
let H = w.document.getElementById('log-list').innerHTML;
ok('no expander state exists', typeof w._scLogExpanded === 'undefined');
ok('no row-click handler', typeof w.scLogRowClick === 'undefined');
ok('no textarea anywhere', !/<textarea/.test(H));
/* Exactly one checkbox per row: the t-shirt selection in the reserved left
   column. The old "seen" checkbox is gone — seen is the flag now. */
ok('one selection checkbox per row',
   (H.match(/type="checkbox"/g) || []).length === (H.match(/class="log-item/g) || []).length);
ok('the only checkbox is the picker', !/type="checkbox"[^>]*log-seen/.test(H));
ok('no full-width remove button', !/Remove from log</.test(H));
ok('coordinates appear exactly ONCE per row',
   (H.match(/11\.250\u00b0S/g) || []).length === 1,
   String((H.match(/11\.250\u00b0S/g) || []).length));

/* ── 14. the four row actions ────────────────────────────────────────── */
console.log('\n14. row actions');
ok('flag button present',  /class="log-act log-flag/.test(H));
ok('edit pencil present',  /class="log-act log-edit-btn/.test(H));
ok('trash present',        /class="log-act log-del/.test(H));
ok('goto present',         /class="log-act log-goto/.test(H));
ok('flag is unlit when unseen', !/log-flag on/.test(H) && /fill="none"/.test(H));
ok('pencil DISABLED with no current location', /log-edit-btn[^>]*disabled/.test(H));

w.scLogSetSeen(kA, true);
w.renderLogList();
H = w.document.getElementById('log-list').innerHTML;
ok('flag lights when seen', /log-act log-flag on/.test(H));
ok('lit flag is FILLED',    /fill="currentColor"/.test(H));
ok('flag exposes aria-pressed', /aria-pressed="true"/.test(H));

// Pencil enables only when the app is pointed somewhere different.
search.value = w.filterToString(Object.assign({}, w.parseSearch(''), { coords: { lat: 10, lon: 20 } }));
w.onSearchChanged(true);
w.renderLogList();
H = w.document.getElementById('log-list').innerHTML;
ok('pencil ENABLED once location differs', !/log-edit-btn[^>]*disabled/.test(H));
ok('stored loc unchanged until pencil pressed', w.scLogGet(kA).loc[0] === 55.5);
w.scLogCommitLoc(kA);
ok('pencil commits the new location',
   Math.abs(w.scLogGet(kA).loc[0] - 20) < 1e-6 && Math.abs(w.scLogGet(kA).loc[1] - 10) < 1e-6,
   JSON.stringify(w.scLogGet(kA).loc));

// goto still works from the row
w.selectCalls.length = 0;
w.scLogGoto(kA);
ok('goto selects the eclipse', w.selectCalls.length === 1);

/* ── 15. goto swaps to the map ONLY on a phone ───────────────────────── */
console.log('\n15. goto and the map tab');
w.switchCalls.length = 0;
NARROW = false;                      // desktop: map already visible
w.scLogGoto(kA);
ok('desktop: stays on the log panel', w.switchCalls.length === 0, JSON.stringify(w.switchCalls));
NARROW = true;                       // phone: map is a separate tab
w.switchCalls.length = 0;
w.scLogGoto(kA);
ok('phone: brings the map forward', w.switchCalls.join() === 'map', JSON.stringify(w.switchCalls));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
