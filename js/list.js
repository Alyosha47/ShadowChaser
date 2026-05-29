/* ── Eclipse list ────────────────────────────────────────────────────── */

function renderList() {
  var list = document.getElementById('eclipse-list');

  /* Coords set but scan not yet complete — show neutral waiting state */
  if (currentFilter.coords && locationResults === null) {
    list.innerHTML = '<div class="list-status" style="color:var(--text-dim)">Finding eclipses at this location\u2026</div>';
    return;
  }

  var source = locationResults !== null ? locationResults : eclipseIndex;
  var items  = applyFilter(source, currentFilter);

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

  /* Center the list on the anchor row (today's row when unfiltered) so the
     user sees today instead of the start of the window. */
  if (anchor > 0) {
    var rowIdx = anchor - start;
    var rows   = list.querySelectorAll('.eclipse-item');
    if (rows[rowIdx]) {
      rows[rowIdx].scrollIntoView({ block: 'center' });
    }
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

