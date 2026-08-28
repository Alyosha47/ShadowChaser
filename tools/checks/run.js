#!/usr/bin/env node
/* Run every check. From the repo root:  node tools/checks/run.js
   Needs jsdom:  npm i jsdom   (dev-only; the app itself has no build step). */
const { execFileSync } = require('child_process');
const path = require('path');

/* test_forecast was listed here and its file was never committed, so the runner
   reported a failing suite that did not exist — noise that made "N suites
   failing" mean nothing. js/forecast.js went the same way: written 2026-08-15,
   never wired into index.html, never committed, now lost. #F2b starts from
   scratch. Put both back on this list when it is rewritten. */
const SUITES = ['test_hygiene', 'test_details', 'test_userlog', 'test_picker', 'test_tshirt', 'test_satellite', 'test_imagery', 'test_sw', 'test_country'];
let failed = 0, broken = 0;

/* A SUITE THAT CANNOT START IS NOT A SUITE THAT FAILED, and reporting both as
   "N suite(s) failing" is how three suites sat unexplained for a week: they were
   only ever missing jsdom, which a fresh clone never has. The same tally also
   hid test_satellite crashing on line 82 against exports deleted two rewrites
   earlier. If the runner cannot tell a setup problem from a regression, nobody
   reads it. ENOENT and a missing module are named and counted separately. */
function why(out) {
  const m = /Cannot find module '([^']+)'/.exec(out);
  if (m) return m[1] === 'jsdom' ? "jsdom not installed — run: npm i jsdom"
                                 : "missing module '" + m[1] + "'";
  if (/ENOENT/.test(out)) return 'a file it reads is missing — check the path depth (§13)';
  if (/^\s*(TypeError|ReferenceError|SyntaxError)/m.test(out))
    return 'crashed before asserting: ' + (/^\s*(\w*Error:[^\n]*)/m.exec(out) || [,'?'])[1];
  return null;
}

for (const s of SUITES) {
  process.stdout.write(s.padEnd(16));
  try {
    execFileSync(process.execPath, [path.join(__dirname, s + '.js')], { stdio: 'pipe' });
    console.log('PASS');
  } catch (e) {
    const out = (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '');
    const setup = why(out);
    if (setup) { broken++; console.log('CANNOT RUN — ' + setup); continue; }
    failed++;
    console.log('FAIL');
    process.stdout.write(e.stdout ? e.stdout.toString() : '');
  }
}
if (broken) console.log(`\n${broken} suite(s) COULD NOT RUN — fix that first; they are not regressions`);
console.log(failed ? `${failed} suite(s) failing` : (broken ? '' : '\nAll suites pass'));
process.exit(failed || broken ? 1 : 0);
