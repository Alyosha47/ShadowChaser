#!/usr/bin/env node
/* Bump BUILD everywhere it appears in index.html, in one command.

   WHY THIS EXISTS
   ---------------
   index.html calls `var BUILD` "THE single source", but it isn't: the ?v= on
   the stylesheet and on all 18 <script src> tags are separate literals. Bumping
   BUILD alone renames the service-worker cache while every asset URL still
   points at the old string, and — because sw.js matches with ignoreSearch:true
   — the stale copies keep being served. A whole session's changes can appear to
   do nothing. That has now happened once, for real.

   WHY NOT MAKE THE TAGS DERIVE FROM BUILD AT RUNTIME
   --------------------------------------------------
   The obvious fix is to document.write the tags with '?v=' + BUILD. Don't.
   Chrome intervenes against parser-blocking scripts injected by document.write
   on slow connections and simply refuses to load them — which for a field app
   on a bad network means a blank page in exactly the conditions it exists for.
   Static tags stay; the typing becomes mechanical instead.

   USAGE
   -----
     node tools/set_build.js 2026-08-09c   set an explicit build
     node tools/set_build.js               bump today's trailing letter

   tools/test_hygiene.js asserts that every stamp matches BUILD, so drift is
   caught by the suite whether or not this tool was used.
*/

'use strict';
const fs   = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'index.html');

const html = fs.readFileSync(FILE, 'utf8');
const cur  = (html.match(/var BUILD\s*=\s*'([^']+)'/) || [])[1];
if (!cur) { console.error('No `var BUILD` found in index.html — aborting.'); process.exit(1); }

/* Next build: the argument, or today's date with the next free letter. A build
   from an earlier day restarts at 'a' rather than carrying yesterday's letter. */
function nextBuild() {
  const d     = new Date();
  const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
                                + '-' + String(d.getDate()).padStart(2, '0');
  const m = cur.match(/^(\d{4}-\d{2}-\d{2})([a-z]*)$/);
  if (!m || m[1] !== today) return today + 'a';
  const letter = m[2] || 'a';
  if (letter === 'z') { console.error('Ran out of letters for ' + today + '.'); process.exit(1); }
  return today + String.fromCharCode(letter.charCodeAt(letter.length - 1) + 1);
}

const next = process.argv[2] || nextBuild();
if (next === cur) { console.log('BUILD already ' + cur + ' — nothing to do.'); process.exit(0); }

/* Two forms to replace: the declaration, and every ?v=<something> stamp. The
   stamp pattern is deliberately blind to the old value — a file left behind at
   an older build is exactly the failure this tool exists to end. */
let out   = html.replace(/var BUILD(\s*)=(\s*)'[^']+'/, "var BUILD$1=$2'" + next + "'");
let count = 0;
out = out.replace(/(\?v=)[^"'&\s]+/g, (m, p) => { count++; return p + next; });

fs.writeFileSync(FILE, out);
console.log('BUILD ' + cur + ' → ' + next + '  (' + count + ' asset stamps rewritten)');
