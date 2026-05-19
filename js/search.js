/* ── Coordinate parsing — reads from currentFilter ───────────────────── */

function parseCoords() {
  /* Coordinates come from the search field via currentFilter */
  return currentFilter && currentFilter.coords ? currentFilter.coords : null;
}


/* ── Search and filter ───────────────────────────────────────────────── */

var _scanDebounceTimer = null;

function onSearchChanged(skipCompute) {
  var raw       = document.getElementById('search').value;
  var hadCoords = !!(currentFilter && currentFilter.coords);
  currentFilter = parseSearch(raw);
  var hasCoords = !!currentFilter.coords;

  /* Coords just removed — clear all location-specific state */
  if (hadCoords && !hasCoords) {
    locationResults = null;
    _lookedUpAlt    = null;
    document.getElementById('pill-loc').style.display = 'none';
    document.getElementById('scan-bar').style.display = 'none';
    if (selectedEntry) { localResult = null; }
  }

  updatePillStates();
  updateCoordsStatus();
  renderList();
  pushState();

  if (!skipCompute) {
    if (selectedEntry && hasCoords) computeLocal();
    else if (selectedEntry && !hasCoords) renderData();
  }

  syncMapIfVisible();

  /* Auto-scan: debounce 800ms after typing stops */
  clearTimeout(_scanDebounceTimer);
  if (hasCoords && eclipseIndex.length) {
    _scanDebounceTimer = setTimeout(function () {
      lookupElevationAndTz(currentFilter.coords.lat, currentFilter.coords.lon);
      scanLocation();
    }, 800);
  }
}

function updateCoordsStatus() {
  var el = document.getElementById('coords-status');
  var c  = currentFilter.coords;
  if (!c) { el.textContent = ''; return; }
  var latS   = c.lat >= 0 ? c.lat.toFixed(5)+'\u00b0N' : Math.abs(c.lat).toFixed(5)+'\u00b0S';
  var lonS   = c.lon >= 0 ? c.lon.toFixed(5)+'\u00b0E' : Math.abs(c.lon).toFixed(5)+'\u00b0W';
  var effAlt = _lookedUpAlt;
  var alt    = effAlt ? ' \u00b7 ' + effAlt + '\u2009m' : '';
  el.textContent = latS + '\u2002' + lonS + alt;
  el.style.color = 'var(--text-dim)';
}

function updatePillStates() {
  var types = currentFilter.types || [];
  ['total','annular','hybrid','partial'].forEach(function (t) {
    document.getElementById('pill-' + t).classList.toggle('active', types.indexOf(t) >= 0);
  });
  /* today+ pill */
  document.getElementById('pill-today').classList.toggle('active', !!currentFilter.today);
  /* Partial slider — only visible when partial is active */
  var partialActive = types.indexOf('partial') >= 0;
  document.getElementById('partial-slider-wrap').style.display = partialActive ? '' : 'none';
}

function toggleTodayPill() {
  var search = document.getElementById('search');
  var f = parseSearch(search.value);
  if (f.today) {
    /* Remove today+ — set years to null */
    var tmp = Object.assign({}, f, { today: false, years: null });
    search.value = filterToString(tmp);
  } else {
    var tmp = Object.assign({}, f, { today: true,
      years: { min: new Date().getFullYear(), max: 3000,
               todayMonth: new Date().getMonth()+1, todayDay: new Date().getDate() } });
    search.value = filterToString(tmp);
  }
  onSearchChanged();
}

function toggleTypePill(t) {
  var search = document.getElementById('search');
  var f = parseSearch(search.value);
  var types = f.types ? f.types.slice() : [];
  var idx   = types.indexOf(t);
  if (idx >= 0) {
    types.splice(idx, 1);
    /* If removing partial, also remove obscuration threshold */
    if (t === 'partial') {
      var tmp = Object.assign({}, f, { types: types.length ? types : null, obscRange: null });
      search.value = filterToString(tmp);
      onSearchChanged();
      return;
    }
  } else {
    types.push(t);
    /* If adding partial, apply the current slider value */
    if (t === 'partial') {
      var sliderVal = parseInt(document.getElementById('partial-min').value, 10);
      var tmp = Object.assign({}, f, {
        types: types,
        obscRange: sliderVal > 0 ? { min: sliderVal, max: 100 } : null
      });
      search.value = filterToString(tmp);
      onSearchChanged();
      return;
    }
  }
  var tmp = Object.assign({}, f, { types: types.length ? types : null });
  search.value = filterToString(tmp);
  onSearchChanged();
}

