/* ── User log — saved & seen eclipses ─────────────────────────────────────
   One localStorage key, one object, keyed by catalogue number.

     sc.log = { v:1, entries: { "9518": { seen, loc, ts }, ... } }

   PRESENCE IS "SAVED". There is no `saved` field — an entry exists because the
   user saved it, and unsaving deletes the entry. `seen` is likewise stored only
   when true, so an entry with nothing but a `ts` is the wishlist case
   (saved, not yet seen). Everything except `ts` is optional.

   `loc` is [lon, lat] — the app's order everywhere else (see `ge`, path data).
   Do not store {lat,lon} here; a silent flip would look perfectly plausible.

   Keys are the catalogue number as a STRING of a rounded integer. index.json
   stores cat_no as a float (1.0, 9518.0), so String(rec.cat_no) would give
   "9518" on some paths and "9518.0" on others. scLogKey() is the only place
   allowed to make a key — always go through it.                               */

var SC_LOG_KEY      = 'sc.log';
var SC_LOG_VERSION  = 1;

var _scLog     = null;   /* in-memory copy; the store of record is localStorage */
var _scLogById = null;   /* cat_no string → eclipseIndex entry, built lazily */


/* ── Store ─────────────────────────────────────────────────────────────── */

function scLogLoad() {
  if (_scLog) return _scLog;
  try {
    var raw = localStorage.getItem(SC_LOG_KEY);
    var obj = raw ? JSON.parse(raw) : null;
    if (obj && obj.entries && typeof obj.entries === 'object') {
      _scLog = { v: obj.v || SC_LOG_VERSION, entries: obj.entries };
    } else {
      _scLog = { v: SC_LOG_VERSION, entries: {} };
    }
  } catch (e) {
    /* Corrupt or unavailable storage must not take the app down — start empty
       and let the next write try again. */
    console.warn('sc.log unreadable, starting empty', e);
    _scLog = { v: SC_LOG_VERSION, entries: {} };
  }
  return _scLog;
}

function scLogSave() {
  try {
    localStorage.setItem(SC_LOG_KEY, JSON.stringify(scLogLoad()));
    return true;
  } catch (e) {
    console.warn('sc.log could not be saved', e);
    if (typeof setStatus === 'function') {
      setStatus('Could not save \u2014 device storage is full or blocked.', true);
    }
    return false;
  }
}

/* The ONLY way to make a key. See the header note about float cat_no. */
function scLogKey(entry) {
  if (!entry) return null;
  var c = entry.cat_no;
  if (c === null || c === undefined) return null;
  return String(Math.round(c));
}

function scLogGet(key)  { return scLogLoad().entries[key] || null; }
function scLogHas(key)  { return !!scLogLoad().entries[key]; }
function scLogCount()   { return Object.keys(scLogLoad().entries).length; }

/* Save (create) or unsave (delete). Returns the new saved state. */
function scLogToggle(entry) {
  var k = scLogKey(entry);
  if (!k) return false;
  var log = scLogLoad();
  if (log.entries[k]) {
    delete log.entries[k];
  } else {
    var e = { ts: Date.now() };
    /* Capture wherever the user is standing right now, if anywhere. A saved
       eclipse with no location is entirely normal — that's the wishlist. */
    var c = (typeof parseCoords === 'function') ? parseCoords() : null;
    if (c) e.loc = [c.lon, c.lat];
    log.entries[k] = e;
  }
  scLogSave();
  scLogRefreshAll();
  return !!log.entries[k];
}

function scLogSetSeen(key, seen) {
  var e = scLogGet(key);
  if (!e) return;
  if (seen) e.seen = true; else delete e.seen;   /* absent means not seen */
  e.ts = Date.now();
  scLogSave();
  scLogRefreshAll();
}

function scLogSetLoc(key, lon, lat) {
  var e = scLogGet(key);
  if (!e) return;
  e.loc = [lon, lat];
  e.ts  = Date.now();
  scLogSave();
  scLogRefreshAll();
}

function scLogRemove(key) {
  var log = scLogLoad();
  if (!log.entries[key]) return;
  delete log.entries[key];
  scLogSave();
  scLogRefreshAll();
}


/* ── Catalogue lookup ──────────────────────────────────────────────────── */

/* cat_no string → eclipseIndex entry. Built on first use and cached; rebuilt
   if the index grew (it loads asynchronously at startup). */
function scLogIndexById() {
  if (_scLogById && _scLogById._n === eclipseIndex.length) return _scLogById;
  var m = { _n: eclipseIndex.length };
  for (var i = 0; i < eclipseIndex.length; i++) {
    var k = scLogKey(eclipseIndex[i]);
    if (k) m[k] = eclipseIndex[i];
  }
  _scLogById = m;
  return m;
}

/* Log entries joined to their catalogue records, in date order. Entries whose
   eclipse isn't in the index yet are skipped rather than dropped from storage —
   the index may simply not have finished loading. */
function scLogRows() {
  var byId = scLogIndexById();
  var log  = scLogLoad();
  var rows = [];
  for (var k in log.entries) {
    if (!log.entries.hasOwnProperty(k)) continue;
    var rec = byId[k];
    if (!rec) continue;
    rows.push({ key: k, entry: log.entries[k], rec: rec });
  }
  rows.sort(function (a, b) {
    return (a.rec.year - b.rec.year)
        || (a.rec.month - b.rec.month)
        || (a.rec.day - b.rec.day);
  });
  return rows;
}


/* ── Formatting helpers ────────────────────────────────────────────────── */

function scLogFmtLoc(loc) {
  if (!loc) return '';
  var lon = loc[0], lat = loc[1];
  return (lat >= 0 ? lat.toFixed(3) + '\u00b0N' : Math.abs(lat).toFixed(3) + '\u00b0S')
       + '\u2002'
       + (lon >= 0 ? lon.toFixed(3) + '\u00b0E' : Math.abs(lon).toFixed(3) + '\u00b0W');
}

function scLogEsc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/* ── Panel rendering ───────────────────────────────────────────────────── */

/* ── Row icons ─────────────────────────────────────────────────────────
   Inline SVG, `currentColor` so each inherits its button's state colour.
   Stroked at 1.5 to sit at the same weight as the share mark in the detail
   title. The flag FILLS when seen — a lit flag, not a checkbox. */
var SC_ICON = {
  flag:  '<path d="M5.4 3.2V17"/><path d="M5.4 4.4h9.2l-2.1 3.2 2.1 3.2H5.4z"/>',
  star:  '<path d="M10 2.8l2.35 4.76 5.25.76-3.8 3.7.9 5.23L10 14.78l-4.7 2.47'
       + '.9-5.23-3.8-3.7 5.25-.76z"/>',
  edit:  '<path d="M13.4 3.6l3 3-8.8 8.8L4 17l1.6-3.6z"/>',
  trash: '<path d="M4.5 6.2h11"/><path d="M8.2 6.2V4.6a.8.8 0 0 1 .8-.8h2a.8.8 0'
       + ' 0 1 .8.8v1.6"/><path d="M6.4 6.2 7.2 16.2a1 1 0 0 0 1 .9h3.6a1 1 0 0 0'
       + ' 1-.9L13.6 6.2"/>',
  goto:  '<path d="M4 10h11.2"/><path d="M11.4 6.2 15.2 10l-3.8 3.8"/>'
};

function scIcon(name, filled) {
  return '<svg viewBox="0 0 20 20" aria-hidden="true" stroke="currentColor"'
       + ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'
       + ' fill="' + (filled ? 'currentColor' : 'none') + '">'
       + SC_ICON[name] + '</svg>';
}

/* ── Local circumstances for a saved location ──────────────────────────
   Each row with a location shows what the eclipse actually does THERE:
   obscuration and, if it's central at that spot, totality/annularity length.
   That needs the Besselian record, which lives in a chunk that may not be
   loaded, so this is async and fills in after the first paint rather than
   holding the whole panel back.

   Cached by cat_no + rounded coordinates: the answer only changes if the saved
   location moves, and rounding to 4dp (~11 m) keeps a re-render from missing
   the cache on floating-point noise. */
var _scLocalCache = {};

/* Which rows are ticked for the t-shirt map. Deliberately NOT persisted: it is
   a transient choice about one poster, not part of the log. Empty means "all",
   handled by tsOpen. */
var _scPicked = {};
function scLogPicked(key)       { return !!_scPicked[key]; }
function scLogPick(key, on)     { if (on) _scPicked[key] = true; else delete _scPicked[key];
                                  renderLogList(); }
function scLogPickAll(on) {
  _scPicked = {};
  if (on) scLogRows().forEach(function (r) { _scPicked[r.key] = true; });
  renderLogList();
}

function scLogLocalKey(key, loc) {
  return key + '@' + loc[0].toFixed(4) + ',' + loc[1].toFixed(4);
}

function scLogLocal(key, loc) {
  return _scLocalCache[scLogLocalKey(key, loc)] || null;
}

/* Fire off whatever is missing, then redraw once they've all settled. */
function scLogFillLocal(rows) {
  var want = rows.filter(function (r) {
    return r.entry.loc && !(scLogLocalKey(r.key, r.entry.loc) in _scLocalCache);
  });
  if (!want.length || typeof loadChunk !== 'function'
      || typeof computeEclipse !== 'function') return;

  Promise.all(want.map(function (r) {
    var ck = r.rec._chunk;
    if (!ck) return Promise.resolve();
    return loadChunk(ck).then(function (recs) {
      var rec = null;
      for (var i = 0; i < recs.length; i++) {
        if (recs[i].year === r.rec.year && recs[i].month === r.rec.month
            && recs[i].day === r.rec.day) { rec = recs[i]; break; }
      }
      var out = null;
      if (rec) {
        try {
          var res = computeEclipse(rec, r.entry.loc[1], r.entry.loc[0], 0);
          if (res && res.visible) {
            out = { osc: res.osc, dur: res.durCentral, type: res.type };
          }
        } catch (e) { /* a bad record must not take the panel down */ }
      }
      /* Cache the null too, so a miss isn't retried on every render. */
      _scLocalCache[scLogLocalKey(r.key, r.entry.loc)] = out || { none: true };
    }).catch(function () {
      _scLocalCache[scLogLocalKey(r.key, r.entry.loc)] = { none: true };
    });
  })).then(function () { renderLogList(); });
}

function renderLogList() {
  var el = document.getElementById('log-list');
  if (!el) return;

  var rows = scLogRows();

  if (!rows.length) {
    el.innerHTML =
      '<div class="log-empty">'
    + '<p>No eclipses saved yet.</p>'
    + '<p class="log-empty-hint">Pick an eclipse, then press <strong>\u2606</strong> '
    + 'on the Details panel. If you have a location set, it is saved with it.</p>'
    + '</div>';
    scLogRenderTools();
    return;
  }

  var seenCount = 0;
  for (var i = 0; i < rows.length; i++) if (rows[i].entry.seen) seenCount++;

  var html = '<div class="log-summary">'
           + rows.length + ' saved \u00b7 ' + seenCount + ' seen'
           + '</div>';

  /* Whatever location the app is currently pointed at. The edit pencil commits
     THIS onto the row — it is the only way a saved location changes, so an
     eclipse opened merely to look at from somewhere else can't quietly
     overwrite where you actually stood. */
  var cur = (typeof parseCoords === 'function') ? parseCoords() : null;

  html += rows.map(function (r) {
    var rec = r.rec, e = r.entry;
    var tc  = typeCode(rec.eclipse_type || 'P');
    var ico = typeIcon(tc, rec.magnitude);
    var sel = selectedEntry && scLogKey(selectedEntry) === r.key;

    var same = !!cur && !!e.loc
            && Math.abs(cur.lon - e.loc[0]) < 1e-6
            && Math.abs(cur.lat - e.loc[1]) < 1e-6;

    var editTitle = !cur
      ? 'Set a location on the map first, then this will save it here'
      : (same ? 'Already saved at your current location'
              : 'Save your current location (' + scLogFmtLoc([cur.lon, cur.lat]) + ') here');

    /* What the eclipse actually does at the saved spot. Absent until the
       chunk loads (see scLogFillLocal), and absent for good if the eclipse
       isn't visible from there. */
    var loc0    = scLogLocal(r.key, e.loc || [0, 0]);
    var locBits = '';
    if (e.loc && loc0 && !loc0.none) {
      locBits = loc0.osc.toFixed(0) + '%';
      if (loc0.dur) locBits += '\u2002\u00b7\u2002' + fmtDur(loc0.dur);
    }

    /* No expander. Every action is on the row: flag = seen, pencil = update
       the location in place, bin = remove, arrow = go to it. The coordinates
       used to appear both here and again in the panel below; there is one
       copy now, and the pencil edits that copy.
       The LEFT edge is deliberately left to the type icon alone — the t-shirt
       selection checkboxes will live there, so nothing else may claim it. */
    return ''
    + '<div class="log-item' + (sel ? ' selected' : '') + '">'
    + '  <div class="log-row">'
    + '    <input type="checkbox" class="log-pick" ' + (scLogPicked(r.key) ? 'checked' : '')
    + '      onchange="scLogPick(\'' + r.key + '\', this.checked)"'
    + '      title="Include on the t-shirt map" aria-label="Include on the map">'
    + '    <span class="log-ico">' + ico + '</span>'
    + '    <div class="log-date">' + fmtDate(rec) + '</div>'
    + '    <div class="log-acts">'
    + '      <button class="log-act log-flag' + (e.seen ? ' on' : '') + '"'
    + '        onclick="scLogSetSeen(\'' + r.key + '\', ' + (e.seen ? 'false' : 'true') + ')"'
    + '        title="' + (e.seen ? 'Seen \u2014 tap to unmark' : 'Not seen yet \u2014 tap to mark as seen') + '"'
    + '        aria-pressed="' + (e.seen ? 'true' : 'false') + '"'
    + '        aria-label="Seen">' + scIcon('flag', !!e.seen) + '</button>'
    + '      <button class="log-act log-del" onclick="scLogRemove(\'' + r.key + '\')"'
    + '        title="Remove from your log" aria-label="Remove from your log">'
    +          scIcon('trash') + '</button>'
    + '      <button class="log-act log-goto" onclick="scLogGoto(\'' + r.key + '\')"'
    + '        title="Show this eclipse on the map" aria-label="Show on map">'
    +          scIcon('goto') + '</button>'
    + '    </div>'
    + '    <div class="log-loc">'
    + '      <span class="log-coords' + (e.loc ? '' : ' none') + '">'
    +          (e.loc ? scLogFmtLoc(e.loc) : 'no location') + '</span>'
    + '      <button class="log-act log-edit-btn" onclick="scLogCommitLoc(\'' + r.key + '\')"'
    + '        title="' + scLogEsc(editTitle) + '" aria-label="Update saved location"'
    + (cur && !same ? '' : ' disabled') + '>' + scIcon('edit') + '</button>'
    + (locBits ? '      <span class="log-circ">' + locBits + '</span>' : '')
    + '    </div>'
    + '  </div>'
    + '</div>';
  }).join('');

  el.innerHTML = html;
  scLogRenderTools();
  scLogFillLocal(rows);
}

/* Export / import live under the list. For an offline app with no account this
   is the entire backup story, and the single-blob shape makes it two lines. */
function scLogRenderTools() {
  var el = document.getElementById('log-tools');
  if (!el) return;
  el.innerHTML =
    '<button class="log-btn log-btn-map" onclick="tsOpen()">Make map</button>'
  + '<button class="log-btn" onclick="scLogPickAll(true)">All</button>'
  + '<button class="log-btn" onclick="scLogPickAll(false)">None</button>'
  + '<button class="log-btn" onclick="scLogExport()">\u2913 Export</button>'
  + '<button class="log-btn" onclick="scLogImportPrompt()">\u2912 Import</button>';
}


/* ── Row interactions ──────────────────────────────────────────────────── */

/* Travel to the eclipse: restore the saved location into the search box (the
   app's single location mechanism), select the eclipse, and on a phone bring
   the map forward. On desktop the map is always visible, so the tab stays put
   and the row keeps its place. */
function scLogGoto(key) {
  var rec = scLogIndexById()[key];
  var e   = scLogGet(key);
  if (!rec) return;

  if (e && e.loc) {
    var search = document.getElementById('search');
    var f      = parseSearch(search.value);
    search.value = filterToString(Object.assign({}, f, {
      coords: { lat: e.loc[1], lon: e.loc[0] },
      city:   null
    }));
    onSearchChanged(true);
    if (typeof lookupElevationAndTz === 'function') {
      lookupElevationAndTz(e.loc[1], e.loc[0]);
    }
  }
  selectEclipse(rec.year, rec.month, rec.day);

  /* Phone only. Guarded because a missing matchMedia would otherwise throw
     here and abandon the goto after the map has already been pointed at the
     eclipse — leaving the app half-moved. */
  if (typeof switchTab === 'function'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 899px)').matches) {
    switchTab('map');
  }
}

/* Commit the search box's current coordinates onto the entry. */
function scLogCommitLoc(key) {
  var c = (typeof parseCoords === 'function') ? parseCoords() : null;
  if (!c) return;
  scLogSetLoc(key, c.lon, c.lat);
}


/* ── Save button (Details panel) ───────────────────────────────────────── */

/* Called by renderData() so the button's state always matches the store. */
function scLogSaveButtonHtml() {
  if (!selectedEntry) return '';
  var k     = scLogKey(selectedEntry);
  if (!k) return '';
  var saved = scLogHas(k);
  return '<button class="icon-btn log-save-btn' + (saved ? ' saved' : '') + '"'
       + ' onclick="scLogToggleSelected()"'
       + ' title="' + (saved ? 'Saved to your log \u2014 tap to remove' : 'Save to your log') + '"'
       + ' aria-label="' + (saved ? 'Remove from your log' : 'Save to your log') + '"'
       + ' aria-pressed="' + (saved ? 'true' : 'false') + '">'
       + scIcon('star', saved) + '</button>';
}

function scLogToggleSelected() {
  if (!selectedEntry) return;
  var nowSaved = scLogToggle(selectedEntry);
  if (typeof setStatus === 'function') {
    setStatus(nowSaved ? 'Saved to your log.' : 'Removed from your log.');
  }
}


/* ── Export / import ───────────────────────────────────────────────────── */

function scLogExport() {
  var blob = new Blob([JSON.stringify(scLogLoad(), null, 2)],
                      { type: 'application/json' });
  var a    = document.createElement('a');
  var d    = new Date();
  a.href     = URL.createObjectURL(blob);
  a.download = 'shadowchaser-log-' + d.getFullYear()
             + String(d.getMonth() + 1).padStart(2, '0')
             + String(d.getDate()).padStart(2, '0') + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
}

function scLogImportPrompt() {
  var inp = document.createElement('input');
  inp.type   = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = function () {
    var f = inp.files && inp.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var obj = JSON.parse(fr.result);
        if (!obj || !obj.entries) throw new Error('not a ShadowChaser log');
        var merged = scLogLoad();
        var added  = 0, updated = 0;
        for (var k in obj.entries) {
          if (!obj.entries.hasOwnProperty(k)) continue;
          var incoming = obj.entries[k];
          var existing = merged.entries[k];
          /* Last write wins, which is what `ts` is for. */
          if (!existing)                                   { merged.entries[k] = incoming; added++; }
          else if ((incoming.ts || 0) > (existing.ts || 0)) { merged.entries[k] = incoming; updated++; }
        }
        scLogSave();
        scLogRefreshAll();
        if (typeof setStatus === 'function') {
          setStatus('Imported \u2014 ' + added + ' added, ' + updated + ' updated.');
        }
      } catch (e) {
        if (typeof setStatus === 'function') setStatus('Could not read that log file.', true);
      }
    };
    fr.readAsText(f);
  };
  inp.click();
}


/* ── Refresh ───────────────────────────────────────────────────────────── */

/* One entry point for "the log changed" so no caller has to know which pieces
   of UI reflect it. */
function scLogRefreshAll() {
  renderLogList();
  if (typeof renderData === 'function' && selectedEntry) renderData();
}

/* Keep the panel honest when the eclipse or the location changes elsewhere:
   the open row's "update location" button depends on the search box, and the
   selected highlight depends on selectedEntry. */
AppState.on('selectedEntry', function () { renderLogList(); });
AppState.on('currentFilter', function () { renderLogList(); });
AppState.on('eclipseIndex',  function () { renderLogList(); });

/* Scripts sit at the end of <body>, so the panel is already in the DOM. Draw
   the empty state now rather than waiting for the first state change. */
renderLogList();
