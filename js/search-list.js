/* ── Eclipse list ────────────────────────────────────────────────────── */

var _listItems = [];   /* the current filtered+ordered list, for arrow nav */
var _lastListSig = null;   /* what the list last CONTAINED — see the scroll note */

function currentYear() { return new Date().getFullYear(); }

function renderList() {
  var list = document.getElementById('eclipse-list');

  /* Coords set but scan not yet complete — show neutral waiting state */
  if (currentFilter.coords && locationResults === null) {
    list.innerHTML = '<div class="list-status" style="color:var(--text-dim)">Finding eclipses at this location\u2026</div>';
    return;
  }

  var source = locationResults !== null ? locationResults : eclipseIndex;

  /* The "Search range" dropdown was removed on 2026-08-29v, and with it the
     whole range restriction and the "None in 1500–2500, widen it below" message
     that existed to explain it. It was a DISPLAY filter only — it skipped no
     chunks and no computation, saving 0.206 ms against 0.058 ms — while its
     default silently hid every eclipse outside 1500–2500. That was actively
     misleading: St. Louis has 12 total eclipses and the default showed none,
     because the last was 1442 and the next is 2505. A year in the search box
     does the same job and says so: "1500-2500". */
  var items  = applyFilter(source, currentFilter);
  _listItems = items;   /* keep in sync for arrow-key navigation */

  if (items.length === 0) {
    list.innerHTML = '<div class="list-status">No eclipses match</div>';
    return;
  }

  /* Anchor = the first eclipse from today onwards, in EVERY list, filtered or
     not. Previously only unfiltered lists were anchored, so "total" opened on
     eclipses from 1999 BC and you had to scroll for years to reach anything you
     could actually go and see. -1 means the whole list is in the past. */
  var now = new Date();
  var cy = now.getFullYear(), cm = now.getMonth() + 1, cd = now.getDate();
  var anchor = -1;
  for (var i = 0; i < items.length; i++) {
    var e = items[i];
    if (e.year > cy || (e.year === cy && e.month > cm) ||
        (e.year === cy && e.month === cm && e.day >= cd)) { anchor = i; break; }
  }

  /* Keep 250 rows of history above the anchor so the past is still reachable by
     scrolling up, and cap the window at 500 rows. */
  var start = anchor < 0 ? Math.max(0, items.length - 500)
                         : Math.max(0, anchor - 250);
  var shown = items.slice(start, start + 500);

  var html = shown.map(function (e, idx) {
    /* Show the type AS SEEN FROM THE SELECTED LOCATION when there is one.
       The filter already matches on local_type (search-parser.js), so showing
       the GLOBAL type here made the list contradict its own search box: from
       St. Louis the list drew 115 hybrid icons while "hybrid" returned 0,
       because every one of those hybrids is a partial from there. Same object,
       same word, two different meanings. Now they agree. */
    var tc  = typeCode(e.local_type || e.eclipse_type || 'P');
    var ico = typeIcon(tc, e.magnitude);
    var sel = selectedEntry
           && selectedEntry.year===e.year
           && selectedEntry.month===e.month
           && selectedEntry.day===e.day;
    var dur = e.duration_secs > 0 ? fmtDur(e.duration_secs) : '--';
    return '<div class="eclipse-item' + (sel ? ' selected' : '') + '"'
         + (start + idx === anchor ? ' data-anchor="1"' : '')
         + (sel ? '' : ' onclick="selectEclipse(' + e.year + ',' + e.month + ',' + e.day + ')"')
         + '>'
         + '<span style="display:flex;align-items:center;justify-content:center">' + ico + '</span>'
         + '<span>' + fmtDate(e) + '</span>'
         + '<span style="text-align:right;padding-right:.25rem">' + dur + '</span>'
         + '</div>';
  }).join('');

  if (items.length > 500) {
    html += '<div class="list-status" style="color:var(--gold-dim)">'
          + (items.length - 500) + ' more \u2014 narrow your search to see them'
          + '</div>';
  }

  var prevScroll = list.scrollTop;
  list.innerHTML = html;

  /* Put the next eclipse from today at the top.

     ⚠ ONLY WHEN THE LIST ITSELF CHANGED. renderList() also runs on every
     selection — clicking a row re-renders to move the highlight — so scrolling
     unconditionally would yank the user back to today the moment they clicked
     an eclipse in 1850. The signature below deliberately ignores which row is
     selected and tracks only what the list CONTAINS. */
  var sig = items.length + '|' + start + '|' + anchor + '|'
          + (items[0] ? items[0].year + '.' + items[0].month + '.' + items[0].day : '')
          + '|' + (locationResults !== null);
  if (sig !== _lastListSig) {
    _lastListSig = sig;
    var a = list.querySelector('[data-anchor="1"]');
    /* Measure against the list's own box. offsetTop is relative to the nearest
       POSITIONED ancestor, which is not this container, so it overshot — the
       next eclipse was 2027 and the list opened on 2029. Rects are exact
       regardless of where the positioning context happens to be. */
    if (a) list.scrollTop += a.getBoundingClientRect().top - list.getBoundingClientRect().top;
    else   list.scrollTop = 0;
  } else {
    /* Same contents, so no re-anchoring — but innerHTML above has just reset
       scrollTop to 0, which threw the user to the top of the list on every
       re-render that did not change what the list holds (moving the selection
       highlight, or country data arriving a moment after the first paint).
       With a country search that top is 250 rows of history back, so "france"
       opened on 1118 CE instead of today. Put the scroll back where it was. */
    list.scrollTop = prevScroll;
  }
}


/* ── Eclipse selection ───────────────────────────────────────────────── */

function selectEclipse(y, m, d) {
  var found = null;
  for (var i = 0; i < eclipseIndex.length; i++) {
    var e = eclipseIndex[i];
    if (e.year===y && e.month===m && e.day===d) { found = e; break; }
  }
  if (!found) return;
  selectedEntry = found;
  _currentRec   = null;             /* invalidate old eclipse's Besselian rec */
  updateHeaderSelection();
  renderList();
  computeLocal();
  /* Mobile: jump to the MAP, which recentres on the chosen location (or the eclipse's
     greatest-eclipse point) — seeing the path land on the globe is the point of picking.
     Desktop: stay where the user is; the map is always visible beside the list anyway. */
  if (!window.matchMedia('(min-width: 900px)').matches) switchTab('map');
}

/* Pick the next upcoming total or annular eclipse from today's date.
   Used at cold start, and as fallback when a URL hash references an
   eclipse we don't have in the catalogue. Returns the entry, or null
   only if the catalogue is empty / has nothing after today. */
function selectNextEclipse() {
  var now = new Date();
  var ty = now.getFullYear(), tm = now.getMonth() + 1, td = now.getDate();
  for (var i = 0; i < eclipseIndex.length; i++) {
    var e  = eclipseIndex[i];
    var tc = (e.eclipse_type || '')[0].toUpperCase();
    if (tc !== 'T' && tc !== 'A') continue;
    if (e.year  <  ty)                                    continue;
    if (e.year === ty && e.month <  tm)                   continue;
    if (e.year === ty && e.month === tm && e.day < td)    continue;
    selectedEntry = e;
    updateHeaderSelection();
    renderList();
    computeLocal();
    return e;
  }
  return null;
}

function updateHeaderSelection() {
  _renderMapStatus();
}

/* ── Arrow-key navigation ────────────────────────────────────────────────
   Left/Right step to the previous/next eclipse in the CURRENT filtered list
   (chronological), so you can walk a search result quickly. Right = later. */
function stepEclipse(delta) {
  var items = _listItems;
  if (!items || !items.length || !selectedEntry) return;
  var idx = -1;
  for (var i = 0; i < items.length; i++) {
    if (items[i].year === selectedEntry.year &&
        items[i].month === selectedEntry.month &&
        items[i].day === selectedEntry.day) { idx = i; break; }
  }
  if (idx < 0) return;
  var next = idx + delta;
  if (next < 0 || next >= items.length) return;
  var e = items[next];
  selectEclipse(e.year, e.month, e.day);
  var row = document.querySelector('#eclipse-list .eclipse-item.selected');
  if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', function (ev) {
  if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
  var t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
            t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (ev.key === 'ArrowRight')      { ev.preventDefault(); stepEclipse(1); }
  else if (ev.key === 'ArrowLeft')  { ev.preventDefault(); stepEclipse(-1); }
});

