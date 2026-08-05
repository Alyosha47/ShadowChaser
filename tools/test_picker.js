const ROOT = require('path').join(__dirname, '..', '..');  /* repo root, wherever this is run from */
/* Exercise the collapsible basemap picker's click logic without loading the
   whole of map.js (which needs maplibre/deck). We re-create the exact handler
   wiring from renderBasemapPicker and drive it. */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const R = ROOT + '/';

const src = fs.readFileSync(R + 'js/map.js', 'utf8');
const css = fs.readFileSync(R + 'css/app.css', 'utf8');

let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { console.log('  FAIL ' + n + (x ? '  → ' + x : '')); fails++; } };

// ── 1. Static checks on the source
console.log('1. source wiring');
ok('_pickerCollapsible defined', /function _pickerCollapsible/.test(src));
ok('uses the 899px breakpoint', /max-width: 899px/.test(src));
ok('first tap expands, returns early', /classList\.add\('expanded'\);\s*\n\s*return;/.test(src));
ok('outside-tap dismissal registered', /document\.addEventListener\('click'[\s\S]{0,400}remove\('expanded'\)/.test(src));
ok('collapsed tiles collapse to zero width (animatable, not display:none)',
   /\.basemap-picker:not\(\.expanded\) \.basemap-opt:not\(\.active\) \{[^}]*width:\s*0/.test(css));
ok('the collapse is transitioned', /\.basemap-picker \.basemap-opt \{[^}]*transition:\s*width/.test(css));
ok('collapse rule is inside the mobile query',
   /max-width: 899px\)[\s\S]{0,900}\.basemap-picker:not\(\.expanded\)/.test(css));
ok('desktop rule untouched (tiles still 2.6rem)', /\.basemap-opt \{\s*\n\s*width:\s*2\.6rem/.test(css));

// ── 2. Behavioural: rebuild the handler and drive it
console.log('\n2. click behaviour');
const dom = new JSDOM(`<div id="basemap-picker" class="basemap-picker">
  <button class="basemap-opt active" data-key="esri_street"></button>
  <button class="basemap-opt" data-key="opentopo"></button>
  <button class="basemap-opt" data-key="esri_imagery"></button>
</div><div id="elsewhere"></div>`, { pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window, doc = w.document;

let narrow = true, offline = false, setCalls = [];
w.matchMedia = q => ({ matches: /max-width: 899px/.test(q) ? narrow : !narrow });
w.eval(`
  var _offline = false, setCalls = [];
  function isOffline(){ return _offline; }
  window._scSetBasemap = function(k){ setCalls.push(k); };
  function _pickerCollapsible(){ return window.matchMedia('(max-width: 899px)').matches; }
  var host = document.getElementById('basemap-picker');
  host.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.basemap-opt') : null;
    if (!b || isOffline()) return;
    if (_pickerCollapsible() && !host.classList.contains('expanded')) {
      host.classList.add('expanded');
      return;
    }
    host.classList.remove('expanded');
    window._scSetBasemap(b.dataset.key);
  });
  document.addEventListener('click', function (e) {
    if (!host.classList.contains('expanded')) return;
    if (e.target && e.target.closest && e.target.closest('#basemap-picker')) return;
    host.classList.remove('expanded');
  }, true);
`);
const host = doc.getElementById('basemap-picker');
const opts = [...doc.querySelectorAll('.basemap-opt')];
const click = el => el.dispatchEvent(new w.Event('click', { bubbles: true }));

ok('starts collapsed', !host.classList.contains('expanded'));
click(opts[0]);
ok('mobile: first tap expands', host.classList.contains('expanded'));
ok('mobile: first tap does NOT change basemap', w.setCalls.length === 0, JSON.stringify(w.setCalls));
click(opts[1]);
ok('mobile: second tap selects', w.setCalls.join() === 'opentopo', JSON.stringify(w.setCalls));
ok('mobile: collapses after selecting', !host.classList.contains('expanded'));

console.log('\n3. outside tap');
click(opts[0]);
ok('expanded again', host.classList.contains('expanded'));
click(doc.getElementById('elsewhere'));
ok('outside tap collapses', !host.classList.contains('expanded'));
ok('outside tap made no selection', w.setCalls.length === 1, JSON.stringify(w.setCalls));

console.log('\n4. desktop path');
narrow = false;
w.setCalls.length = 0;
click(opts[2]);
ok('desktop: single tap selects immediately', w.setCalls.join() === 'esri_imagery', JSON.stringify(w.setCalls));
ok('desktop: never expands', !host.classList.contains('expanded'));

console.log('\n5. offline');
narrow = true;
w.eval('_offline = true;');
w.setCalls.length = 0;
click(opts[0]);
ok('offline: no expand', !host.classList.contains('expanded'));
ok('offline: no selection', w.setCalls.length === 0);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
