/* ── Event wiring ────────────────────────────────────────────────────── */

/* Search field — live filtering, Enter triggers location scan if coords present */
document.getElementById('search').addEventListener('input', onSearchChanged);

document.getElementById('search').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  var c = parseCoords();
  if (c) {
    scanLocation();
    /* Also trigger elevation + tz lookup */
    lookupElevationAndTz(c.lat, c.lon);
  }
});

document.getElementById('btn-search-clear').addEventListener('click', function () {
  document.getElementById('search').value = '';
  onSearchChanged();
});

/* Tapping the search field shows the list */
document.getElementById('search').addEventListener('focus', function () {
  /* no-op: search tab shows list by design */
});

/* Arrow button toggles between list and detail */


['total','annular','hybrid','partial'].forEach(function (t) {
  document.getElementById('pill-' + t).addEventListener('click', function () {
    toggleTypePill(t);
  });
});

document.getElementById('pill-today').addEventListener('click', toggleTodayPill);

document.getElementById('partial-min').addEventListener('input', function () {
  var val = parseInt(this.value, 10);
  document.getElementById('partial-min-label').textContent = '>' + val + '%';
  /* Update obscRange in search field if partial is active */
  var f = parseSearch(document.getElementById('search').value);
  if (f.types && f.types.indexOf('partial') >= 0) {
    var tmp = Object.assign({}, f, { obscRange: val > 0 ? { min: val, max: 100 } : null });
    document.getElementById('search').value = filterToString(tmp);
    onSearchChanged();
  }
});

document.getElementById('pill-loc').addEventListener('click', clearLocationFilter);

document.getElementById('btn-scan-cancel').addEventListener('click', function () {
  scanCancelFlag = true;
});

document.getElementById('btn-locate').addEventListener('click', function () {
  if (!navigator.geolocation) { setStatus('Geolocation not available.', true); return; }
  setStatus('Locating\u2026');
  navigator.geolocation.getCurrentPosition(function (pos) {
    try { window._deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e) {}
    setStatus('');
    var lat = pos.coords.latitude;
    var lon = pos.coords.longitude;
    var search = document.getElementById('search');
    var f = parseSearch(search.value);
    search.value = filterToString(Object.assign({}, f, { coords: { lat: lat, lon: lon } }));
    onSearchChanged(true);
    lookupElevationAndTz(lat, lon);
    if (eclipseIndex.length) scanLocation();
    if (selectedEntry) {
      computeLocal().then(function (out) {
        if (!out) return;
        clearMapMarkers();
        addObserverMarker(lat, lon, out.result.visible ? out.result.sun.az : null);
      });
    } else {
      clearMapMarkers();
      addObserverMarker(lat, lon, null);
    }
  }, function () {
    setStatus('Location unavailable.', true);
  }, { enableHighAccuracy: true, timeout: 15000 });
});

/* Settings accordion — only one group open at a time */
(function () {
  var groups = ['sg-about', 'sg-instructions', 'sg-settings'];
  groups.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('toggle', function () {
      if (el.open) {
        groups.forEach(function (otherId) {
          if (otherId !== id) {
            var other = document.getElementById(otherId);
            if (other && other.open) other.open = false;
          }
        });
      }
    });
  });
})();

document.getElementById('tz').addEventListener('change', function () {
  pushState();
  if (selectedEntry && localResult) renderData();
});


/* ── URL sharing ─────────────────────────────────────────────────────── */

/**
 * Encode current state into the URL hash.
 * Format: #e=CAT_NO&q=SEARCH_STRING&tz=TIMEZONE
 * cat_no uniquely identifies the eclipse.
 * q is the full search string (includes coords, alt, types etc).
 * tz is the selected timezone value.
 */
function pushState() {
  var parts = [];
  if (selectedEntry && selectedEntry.cat_no != null) {
    parts.push('e=' + Math.round(selectedEntry.cat_no));
  }
  var q = document.getElementById('search').value.trim();
  if (q) parts.push('q=' + encodeURIComponent(q));
  var tz = document.getElementById('tz').value;
  if (tz !== 'auto') parts.push('tz=' + encodeURIComponent(tz));
  var hash = parts.length ? '#' + parts.join('&') : '#';
  /* Use replaceState to avoid polluting browser history on every keystroke */
  if (window.location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
}

/**
 * Parse the URL hash and return { catNo, q, tz } — any may be null.
 */
function readHash() {
  var hash = window.location.hash.slice(1);
  if (!hash) return {};
  var out = {};
  hash.split('&').forEach(function (part) {
    var eq = part.indexOf('=');
    if (eq < 0) return;
    var k = part.slice(0, eq);
    var v = decodeURIComponent(part.slice(eq + 1));
    if (k === 'e')  out.catNo = parseInt(v, 10);
    if (k === 'q')  out.q     = v;
    if (k === 'tz') out.tz    = v;
  });
  return out;
}

/**
 * Restore state from URL hash after the index is loaded.
 * Called once at startup, after eclipseIndex is populated.
 */
function restoreFromHash() {
  var h = readHash();

  /* Restore timezone */
  if (h.tz) {
    var sel = document.getElementById('tz');
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === h.tz) { sel.value = h.tz; break; }
    }
  }

  /* Restore search string (overrides default) */
  if (h.q) {
    document.getElementById('search').value = h.q;
  }

  /* Restore selected eclipse before onSearchChanged so pushState keeps e= */
  if (h.catNo) {
    for (var i = 0; i < eclipseIndex.length; i++) {
      var e = eclipseIndex[i];
      if (e.cat_no != null && Math.round(e.cat_no) === h.catNo) {
        selectedEntry = e;
        break;
      }
    }
  }

  /* Apply search filter (skipCompute=true; we call computeLocal below) */
  onSearchChanged(true);

  /* If coords are in the restored search, trigger scan */
  if (currentFilter.coords && eclipseIndex.length) scanLocation();

  /* Now render with selectedEntry set */
  if (selectedEntry) {
    updateHeaderSelection();
    renderList();
    computeLocal();
    if (mapReady) updateMapState();
  }
}



