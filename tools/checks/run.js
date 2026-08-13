#!/usr/bin/env node
/* Run every check. From the repo root:  node tools/checks/run.js
   Needs jsdom:  npm i jsdom   (dev-only; the app itself has no build step). */
const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = ['test_hygiene', 'test_details', 'test_userlog', 'test_picker', 'test_tshirt'];
let failed = 0;

for (const s of SUITES) {
  process.stdout.write(s.padEnd(16));
  try {
    execFileSync(process.execPath, [path.join(__dirname, s + '.js')], { stdio: 'pipe' });
    console.log('PASS');
  } catch (e) {
    failed++;
    console.log('FAIL');
    process.stdout.write(e.stdout ? e.stdout.toString() : '');
  }
}
console.log(failed ? `\n${failed} suite(s) failing` : '\nAll suites pass');
process.exit(failed ? 1 : 0);
