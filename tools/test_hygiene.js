const ROOT = require('path').join(__dirname, '..', '..');  /* repo root, wherever this is run from */
/* Structural hygiene checks on app.css. These exist because comment cruft and
   misfiled rules crept in over several rounds of edits and nothing caught it. */
const fs = require('fs');
const css = fs.readFileSync(ROOT + '/css/app.css', 'utf8');
const det = fs.readFileSync(ROOT + '/js/details.js', 'utf8');

let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { console.log('  FAIL ' + n + (x ? '  → ' + x : '')); fails++; } };

console.log('1. no stacked/orphaned comments');
// Two block comments back to back = the first usually describes a rule that has
// since moved, i.e. an orphan. EXCEPTION: a section banner (/* -- Name -- */)
// legitimately precedes a rule's own comment, so those pairs are allowed.
const BANNER = /\/\*\s*\u2500+[^*]*\*\//;
const stacked = [];
for (const m of css.matchAll(/\/\*[\s\S]*?\*\/\s*\n\s*\/\*/g)) {
  const first = m[0].slice(0, m[0].lastIndexOf('/*'));
  if (BANNER.test(first)) continue;              // banner + rule doc is fine
  stacked.push(css.slice(0, m.index).split('\n').length);
}
// Four of these predate this session and live in unrelated map/marker CSS.
const PRE_EXISTING = 4;
ok('no NEW orphaned comments',
   stacked.length <= PRE_EXISTING,
   stacked.length ? `${stacked.length} found (expected <= ${PRE_EXISTING} pre-existing), lines ` + stacked.join(', ') : '');

console.log('\n2. duplicate selectors');
// Strip @media blocks first: a responsive override of the same selector is
// intentional, not a duplicate definition.
let base = css, out = '', i = 0;
while (true) {
  const at = base.indexOf('@media', i);
  if (at < 0) { out += base.slice(i); break; }
  out += base.slice(i, at);
  let depth = 0, j = base.indexOf('{', at);
  for (let k = j; k < base.length; k++) {
    if (base[k] === '{') depth++;
    else if (base[k] === '}') { depth--; if (!depth) { i = k + 1; break; } }
  }
}
const sels = [...out.matchAll(/^\s{0,6}(\.[a-z][\w-]*(?:\.[\w-]+)?)\s*\{/gm)].map(m => m[1]);
const dupes = sels.filter((s, i2) => sels.indexOf(s) !== i2);
ok('no selector block defined twice outside media queries',
   dupes.length === 0, [...new Set(dupes)].join(', '));

console.log('\n3. every class in the CSS is used somewhere');
const js = ['details','userlog','map','list','share','shadow-ui','tabs','search','local','url','init']
  .map(n => { try { return fs.readFileSync(`${ROOT}/js/${n}.js`, 'utf8'); } catch { return ''; } })
  .join('\n') + fs.readFileSync(ROOT + '/index.html', 'utf8');
const declared = [...new Set([...css.matchAll(/\.((?:detail|log|icon)[\w-]*)/g)].map(m => m[1]))];
const unused = declared.filter(c => !new RegExp('\\b' + c + '\\b').test(js));
ok('no orphaned detail-/log-/icon- classes', unused.length === 0, unused.join(', '));

console.log('\n4. sub-heading vs the table label column');
const sub = css.match(/\.detail-sub-h \{[^}]*\}/)[0];
const lbl = css.match(/\.detail-table \.l \{[^}]*\}/)[0];
const secBlk = css.match(/\.detail-section-h \{[^}]*\}/)[0];
const grab = (b, p) => { const m = b.match(new RegExp(p + ':\\s*([^;]+);')); return m ? m[1].trim() : null; };
console.log(`     section-h : ${grab(secBlk,'color')} / ${grab(secBlk,'font-size')} / ${grab(secBlk,'font-weight')}`);
console.log(`     sub-h     : ${grab(sub,'color')} / ${grab(sub,'font-size')} / ${grab(sub,'font-weight')}`);
console.log(`     label     : ${grab(lbl,'color')} / ${grab(lbl,'font-size')} / ${grab(lbl,'font-weight') || '400 (inherited)'}`);
// They now share a colour deliberately — WEIGHT is what separates a heading
// from a label, so that colour is free to mean something else entirely.
ok('sub-h is BOLD', grab(sub,'font-weight') === '700');
ok('label is NOT bold', (grab(lbl,'font-weight') || '400') === '400');
ok('sub-h is larger than the label',
   parseFloat(grab(sub,'font-size')) > parseFloat(grab(lbl,'font-size')));
ok('section-h is larger than sub-h',
   parseFloat(grab(secBlk,'font-size')) > parseFloat(grab(sub,'font-size')));
ok('headings are gold; the LABEL is not',
   [secBlk, sub].every(b => (grab(b,'color')||'').includes('gold'))
   && !(grab(lbl,'color')||'').includes('gold'));

console.log('\n5. rules filed under the right section header');
const logHdr = css.indexOf('User log panel');
const titleIdx = css.indexOf('.detail-title {');
const actIdx = css.indexOf('.detail-actions {');
const iconIdx = css.indexOf('.icon-btn {');
ok('.detail-actions sits with .detail-title, not the log panel',
   actIdx > titleIdx && actIdx < logHdr);
ok('.icon-btn sits with .detail-title, not the log panel',
   iconIdx > titleIdx && iconIdx < logHdr);
ok('.log-save-btn.saved stays in the log section',
   css.indexOf('.log-save-btn.saved') > logHdr);

console.log('\n6. details.js heading tiers still correct');
ok('two top-tier headings', (det.match(/detail-section-h">/g) || []).length === 2);
ok('two sub-tier headings',  (det.match(/detail-sub-h">/g) || []).length === 2);


/* ═══ VISUAL LANGUAGE RULES ═══════════════════════════════════════════════
   Decided deliberately; see VISUAL-AUDIT.md. Each rule below is enforced so a
   future edit can't quietly reintroduce the hodgepodge. */
console.log('\n7. visual language');

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(m => ({ sel: m[1].split('\n').map(x=>x.trim()).join(' ').trim(), d: m[2] }))
  .filter(b => b.sel && !b.sel.startsWith('@'));
const decl = (b, p) => {
  for (const l of b.d.split(';')) {
    const i = l.indexOf(':');
    if (i > 0 && l.slice(0, i).trim() === p) return l.slice(i + 1).trim();
  }
  return null;
};

// ── Decision 0: only faces that exist. serif 300; mono 400/700/800.
const weights = [...strip(css).matchAll(/font-weight:\s*(\d+)/g)].map(m => +m[1]);
ok('no font-weight that silently rounds to another face',
   weights.every(w => [300,400,700,800].includes(w)),
   [...new Set(weights.filter(w => ![300,400,700,800].includes(w)))].join(', '));

// ── Decision 1: one meaning per gold token.
const goldText = sel => blocks.filter(b => decl(b,'color') === `var(${sel})`).map(b => b.sel);
const BRANDING = ['.app-header::before', '.app-title'];   // deliberate exceptions
// .pill-loc marks the pill for the CURRENT location — a selected state whose
// class name doesn't say so.
const SELECTED = /(\.active|\.selected|\.saved|\.on|\.pill-loc|aria-pressed="true")/;
const HEADINGS = ['.detail-section-h', '.detail-sub-h', '.top-section-header',
                  '.sheet-title'];
const strays = goldText('--gold').filter(s =>
  !BRANDING.includes(s) && !HEADINGS.includes(s) && !SELECTED.test(s));
ok('--gold as text means SELECTED (or branding)', strays.length === 0, strays.join(', '));

ok('--gold-dim is never text', goldText('--gold-dim').length === 0,
   goldText('--gold-dim').join(', '));

// ── Decision 2: headings are size+weight, not colour.
const H = n => blocks.find(b => b.sel === n);
// Headings ARE gold (reversed after review); SIZE carries the hierarchy.
for (const n of ['.detail-section-h', '.detail-sub-h', '.top-section-header']) {
  const b = H(n);
  if (!b) { ok(`${n} exists`, false); continue; }
  ok(`${n} is gold`, (decl(b,'color') || '').includes('--gold'), decl(b,'color'));
}
ok('section > sub by size',
   parseFloat(decl(H('.detail-section-h'),'font-size')) >
   parseFloat(decl(H('.detail-sub-h'),'font-size')));
ok('both heading tiers are bold',
   decl(H('.detail-section-h'),'font-weight') === '700' &&
   decl(H('.detail-sub-h'),'font-weight') === '700');

// ── Decision 3: headings carry no rule; gold is not a separator.
ok('.detail-section-h has no underline', !/border/.test(H('.detail-section-h').d));
ok('.detail-sub-h has no underline', /border:\s*none/.test(H('.detail-sub-h').d));
// Pseudo-elements use borders to DRAW SHAPES (the scrubber needle's arrowhead
// is a border triangle), which is geometry, not a separator.
const goldSeparators = blocks.filter(b =>
  !b.sel.includes('::') &&
  ['border-bottom','border-top'].some(p => (decl(b,p)||'').includes('--gold')));
ok('no gold horizontal separators', goldSeparators.length === 0,
   goldSeparators.map(b=>b.sel).join(', '));

// ── Decision 4: no emoji in chrome; icons inherit colour.
const html = fs.readFileSync(ROOT + '/index.html', 'utf8');
// Emoji tab icons were reinstated after review — they read better at small
// sizes than the flat SVG set. Icons must still exist, whichever kind.
const tabLine = html.split('\n').filter(l => /class="tab-btn|class="sidebar-tab-btn/.test(l)).join('');
/* The BMP symbols are whitelisted one at a time as they get used: U+2699 gear,
   U+24D8 circled i. Both are icons by any reading — they simply sit outside the
   1F300+ pictographic block, so a range check alone misses them. */
const TAB_ICON = /<svg|[\u{1F300}-\u{1FAFF}\u{2699}\u{24D8}]/gu;
ok('every tab carries an icon of some kind',
   (tabLine.match(TAB_ICON) || []).length >= 9,
   String((tabLine.match(TAB_ICON) || []).length));

/* Portability: nothing may link to the deployed copy of the app itself. The
   three About deep links were absolute (followtheshadow.com/app/#e=…), so from
   a copy in any other folder — or offline — they silently jumped the user to
   production instead of driving the app they were sitting in. Bare '#e=…' works
   everywhere: the hashchange handler in url.js and the deep-link click handler
   in tabs.js both act on the current page. mailto: is fine, hence the anchor on
   href="http. */
const selfLinks = (html.match(/href="https?:\/\/(www\.)?followtheshadow\.com/g) || []);
ok('no absolute links back to the deployed app', selfLinks.length === 0,
   selfLinks.length + ' found');


/* ═══ DOM CONTRACT ════════════════════════════════════════════════════════
   Every element the JS reaches for must exist in index.html. Removing an
   element from the markup while a module still calls getElementById on it
   throws, and an exception inside a hot path like onSearchChanged aborts
   everything downstream of it — blank panel, no map pin, no obvious cause. */
console.log('\n8. DOM contract');

const JSFILES = ['search','userlog','details','map','list','local','url','init',
                 'tabs','share','shadow-ui','eclipse','cities','format','state'];
// Ids can come from the markup OR be built at runtime (the sun-track diagram
// and the deck.gl overlay both construct their own DOM), so collect both.
const sources = {};
for (const n of JSFILES) {
  try { sources[n] = fs.readFileSync(`${ROOT}/js/${n}.js`, 'utf8'); }
  catch { /* module may not exist */ }
}
const allJs = Object.values(sources).join('\n');
const known = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
for (const m of allJs.matchAll(/id=[\\]?["']([\w-]+)/g)) known.add(m[1]);
for (const m of allJs.matchAll(/\.id\s*=\s*'([^']+)'/g)) known.add(m[1]);

const missing = [];
for (const [n, src] of Object.entries(sources)) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of code.matchAll(/(?:(?:var|let|const)\s+(\w+)\s*=\s*)?document\.getElementById\(\s*'([^']+)'\s*\)/g)) {
    const [varName, id] = [m[1], m[2]];
    if (known.has(id)) continue;
    // A lookup whose result is null-checked is deliberate — some elements are
    // created by third-party code and may legitimately be absent.
    const after = code.slice(m.index, m.index + 200);
    if (varName && new RegExp(`if\\s*\\(\\s*!?${varName}\\b`).test(after)) continue;
    missing.push(`${n}.js → #${id}`);
  }
}
ok('no JS reaches for an element that does not exist',
   missing.length === 0, missing.join('; '));

/* Cache-busting: every JS/CSS asset must carry the current BUILD, or the
   service worker serves a stale module against fresh markup. */
const build = (html.match(/var BUILD\s*=\s*'([^']+)'/) || [])[1];
const stamped = [...html.matchAll(/(?:src|href)="(?:js|css)\/[^"?]+\?v=([^"]+)"/g)]
  .map(m => m[1]);
ok('BUILD is declared', !!build, build);
ok('every js/css asset carries the current BUILD',
   stamped.length > 0 && stamped.every(v => v === build),
   [...new Set(stamped.filter(v => v !== build))].join(', ') + ` (BUILD=${build})`);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
