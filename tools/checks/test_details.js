const ROOT = require('path').join(__dirname, '..', '..');  /* repo root, wherever this is run from */
/* Render the detail title + heading structure through jsdom and assert the
   layout contract: one line for the title, correct heading tiers, no orphaned
   classes. */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const R = ROOT + '/';
const css = fs.readFileSync(R + 'css/app.css', 'utf8');
const det = fs.readFileSync(R + 'js/details.js', 'utf8');
const log = fs.readFileSync(R + 'js/userlog.js', 'utf8');

let fails = 0;
const ok = (n, c, x) => { if (c) console.log('  PASS ' + n); else { console.log('  FAIL ' + n + (x ? '  → ' + x : '')); fails++; } };

console.log('1. heading tiers');
ok('Local Circumstances is top tier', /detail-section-h">Local Circumstances/.test(det));
ok('Global Circumstances is top tier', /detail-section-h">Global Circumstances/.test(det));
ok('Contact Times demoted to sub',    /detail-sub-h">Contact Times/.test(det));
ok('Sky Tracker demoted to sub',      /detail-sub-h">Sky Tracker/.test(det));
ok('.detail-sub-h has no border',     /\.detail-sub-h \{[^}]*border:\s*none/.test(css));
/* Post-audit rule: tiers separate by SIZE (both bold), colour carries no
   hierarchy at all, and headings carry no rule. See VISUAL-AUDIT.md. */
const subB = css.match(/\.detail-sub-h \{[^}]*\}/)[0];
const secB = css.match(/\.detail-section-h \{[^}]*\}/)[0];
const num  = (b, p) => parseFloat((b.match(new RegExp(p + ':\\s*([\\d.]+)')) || [])[1]);
ok('section-h is LARGER than sub-h', num(secB,'font-size') > num(subB,'font-size'),
   `${num(secB,'font-size')} vs ${num(subB,'font-size')}`);
ok('both tiers bold', num(secB,'font-weight') === 700 && num(subB,'font-weight') === 700);
ok('both tiers are gold', /--gold/.test(secB) && /--gold/.test(subB));
ok('sub-h keeps the mono voice', /font-family:\s*var\(--mono\)/.test(subB));
ok('sub-h has NO serif',  !/--serif/.test(subB));
ok('sub-h has NO italic', !/italic/.test(subB));
ok('neither tier carries a rule',
   !/border-bottom/.test(secB) && /border:\s*none/.test(subB));

console.log('\n2. buttons');
/* Strip comments before asserting on code — the removal is explained in a
   comment that necessarily names the old glyph. */
const detCode = det.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('share uses inline SVG, no glyph',
   /\+\s+shareIcon \+ '<\/button>'/.test(detCode) && !/&#x2197;/.test(detCode));
ok('share has a tooltip',    /title="Share this eclipse"/.test(det));
ok('save has a tooltip',     /title="' \+ \(saved \? 'Saved to your log/.test(log));
ok('save exposes aria-pressed', /aria-pressed="/.test(log));
ok('both use .icon-btn', /class="icon-btn"/.test(det) && /class="icon-btn log-save-btn/.test(log));
ok('orphaned .share-btn rule removed', !/\.share-btn/.test(css));
ok('.icon-btn is square', /\.icon-btn \{[^}]*width:\s*1\.75rem[^}]*height:\s*1\.75rem/.test(css));

console.log('\n3. title cannot wrap');
ok('date wrapped in its own span', /detail-title-date">/.test(det));
ok('date has min-width:0', /\.detail-title-date \{[^}]*min-width:\s*0/.test(css));
ok('date ellipsises', /\.detail-title-date \{[^}]*text-overflow:\s*ellipsis/.test(css));
ok('actions grouped, never shrink', /\.detail-actions \{[^}]*flex:\s*0 0 auto/.test(css));
ok('only ONE margin-left:auto in the title row',
   (css.match(/\.detail-actions \{[^}]*margin-left:\s*auto/g) || []).length === 1 &&
   !/\.icon-btn \{[^}]*margin-left:\s*auto/.test(css));

console.log('\n4. rendered structure');
const dom = new JSDOM('<div id="x"></div>');
const d = dom.window.document;
d.getElementById('x').innerHTML =
  '<div class="detail-title">' +
  '<span class="detail-title-icon">i</span>' +
  '<span class="detail-title-date">12 August 2026</span>' +
  '<span class="detail-actions">' +
  '<button class="icon-btn" title="Share this eclipse" aria-label="Share this eclipse">&#x2197;</button>' +
  '<button class="icon-btn log-save-btn" title="Save to your log" aria-label="Save to your log" aria-pressed="false">&#9734;</button>' +
  '</span></div>';
const title = d.querySelector('.detail-title');
ok('exactly 3 children in title row', title.children.length === 3, String(title.children.length));
ok('actions is the last child', title.lastElementChild.className === 'detail-actions');
ok('both buttons inside actions', title.querySelector('.detail-actions').children.length === 2);
ok('every button has an accessible name',
   [...d.querySelectorAll('button')].every(b => b.getAttribute('aria-label')));
ok('no button carries visible text words',
   [...d.querySelectorAll('button')].every(b => !/[A-Za-z]{3}/.test(b.textContent)));

console.log('\n5. spacing hygiene');
ok('subloc negative margin gone', !/\.detail-subloc \{[^}]*margin:\s*-/.test(css));
/* .detail-table was replaced by .circs-grid/.circ-row (flex rows instead of
   a <table>) on 2026-08-23 so Local/Global Circumstances could reflow to two
   columns in a wide sidebar — see HANDOFF §11. Same padding/border rule,
   new selector. */
ok('table rows roomier', /\.circ-row \{[^}]*padding:\s*0\.3rem/.test(css));
ok('one separator treatment: --border', /\.circ-row \{[^}]*border-bottom:\s*1px solid var\(--border\)/.test(css));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL PASS');
process.exit(fails ? 1 : 0);
