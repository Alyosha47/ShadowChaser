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
    start = Math.max(0, anchor - 50);
    shown = items.slice(start, start + 500);
  }

  var html = shown.map(function (e) {
    var tc  = locationResults !== null
            ? typeCode(e.local_type || 'P')
            : typeCode(e.eclipse_type || 'P');
    var sel = selectedEntry
           && selectedEntry.year===e.year
           && selectedEntry.month===e.month
           && selectedEntry.day===e.day;
    var dur = e.duration_secs > 0 ? fmtDur(e.duration_secs) : '--';
    return '<div class="eclipse-item' + (sel ? ' selected' : '') + '"'
         + (sel ? ' onclick="clearSelection()"' : ' onclick="selectEclipse(' + e.year + ',' + e.month + ',' + e.day + ')"')
         + '>'
         + '<span style="display:flex;align-items:center;justify-content:center">' + typeIcon(tc) + '</span>'
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

  if (!currentFilter.text && !currentFilter.types && !currentFilter.years &&
      !currentFilter.months && !selectedEntry && locationResults === null) {
    var scrollIdx = anchor - start;
    setTimeout(function () {
      var child = list.children[scrollIdx];
      if (child) list.scrollTop = child.offsetTop;
    }, 60);
  }
}


/* ── Eclipse selection ───────────────────────────────────────────────── */

function selectEclipse(y, m, d) {
  var found = null;
  for (var i = 0; i < eclipseIndex.length; i++) {
    var e = eclipseIndex[i];
    if (e.year===y && e.month===m && e.day===d) { found = e; break; }
  }
  selectedEntry = found;
  updateHeaderSelection();
  renderList();
  if (selectedEntry) {
    computeLocal();
    switchTab('eclipse');
  } else {
    updateEclipseTabState();
  }
}

function clearSelection() {
  selectedEntry = null;
  localResult   = null;
  updateHeaderSelection();
  renderList();
  updateEclipseTabState();
}

function updateEclipseTabState() {
  var panel       = document.getElementById('data-panel');
  var placeholder = document.getElementById('eclipse-placeholder');
  if (selectedEntry) {
    panel.style.display       = '';
    placeholder.style.display = 'none';
  } else {
    panel.style.display       = 'none';
    placeholder.style.display = '';
  }
}

function updateHeaderSelection() {
  _renderMapStatus();
}

