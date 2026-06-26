/* ── Eclipse list ────────────────────────────────────────────────────── */

var _listItems = [];   /* the current filtered+ordered list, for arrow nav */

function currentYear() { return new Date().getFullYear(); }

function renderList() {
  var list = document.getElementById('eclipse-list');

  /* Coords set but scan not yet complete — show neutral waiting state */
  if (currentFilter.coords && locationResults === null) {
    list.innerHTML = '<div class="list-status" style="color:var(--text-dim)">Finding eclipses at this location\u2026</div>';
    return;
  }

  var source = locationResults !== null ? locationResults : eclipseIndex;

  /* Apply search-range restriction unless the user has an explicit year filter */
  if (!currentFilter.years) {
    var RANGES = { modern: [1500, 2500], past500: [currentYear() - 500, currentYear() + 100],
                   twomill: [-1000, 3000] };
    var rng = RANGES[searchRange];
    if (rng) source = source.filter(function (e) { return e.year >= rng[0] && e.year <= rng[1]; });
  }

  var items  = applyFilter(source, currentFilter);
  _listItems = items;   /* keep in sync for arrow-key navigation */

  if (items.length === 0) {
    list.innerHTML = '<div class="list-status">No eclipses match</div>';
    return;
  }

  var shown, start, anchor = 0;
  if (locationResults !== null || currentFilter.text ||
      currentFilter.types || currentFilter.years || currentFilter.months ||
      currentFilter.saros !== null || currentFilter.obscRange) {
    start = 0;
    shown = items.slice(0, 500);
  } else {
    var now = new Date();
    var cy = now.getFullYear(), cm = now.getMonth()+1, cd = now.getDate();
    for (var i = 0; i < items.length; i++) {
      var e = items[i];
      if (e.year > cy || (e.year===cy && e.month>cm) ||
          (e.year===cy && e.month===cm && e.day>=cd)) { anchor=i; break; }
    }
    /* Center the 500-row window on today so the user can browse both
       past and future eclipses without typing a filter. */
    start = Math.max(0, anchor - 250);
    shown = items.slice(start, start + 500);
  }

  var html = shown.map(function (e) {
    var tc  = typeCode(e.eclipse_type || 'P');
    var ico = typeIcon(tc, e.magnitude);
    var sel = selectedEntry
           && selectedEntry.year===e.year
           && selectedEntry.month===e.month
           && selectedEntry.day===e.day;
    var dur = e.duration_secs > 0 ? fmtDur(e.duration_secs) : '--';
    return '<div class="eclipse-item' + (sel ? ' selected' : '') + '"'
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

  list.innerHTML = html;
  /* No scroll here: the list never moves on its own. */
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
  /* Mobile: switch to Details panel. Desktop: stay where the user is —
     selecting from the list while on Search is part of the exploration flow. */
  if (!window.matchMedia('(min-width: 900px)').matches) switchTab('eclipse');
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

