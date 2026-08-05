/* ── Coordinate parsing — reads from currentFilter ───────────────────── */

/* Literal "(lat, lon)" in the search box. Used only to detect a stale cache,
   not to parse — parseSearch remains the single parser. */
var COORD_RE = /\(\s*[-+]?\d+(?:\.\d+)?\s*,\s*[-+]?\d+(?:\.\d+)?\s*\)/;

function parseCoords() {
  /* Coordinates come from the search field via currentFilter, which is a CACHE
     of parseSearch(search.value) refreshed by onSearchChanged. If anything ever
     leaves the two out of step, the input is the truth and the cache is wrong —
     and the failure is silent and confusing: the map draws the pin (it re-reads
     on redraw) while the details panel shows "enter coordinates", because
     whichever consumer ran while the cache was stale never re-ran.
     So: when the cache says "no coordinates" but the box plainly contains a
     pair, re-parse and repair. Guarded by the regex so this costs nothing on
     the normal path and can never invent a location that wasn't typed. */
  if (currentFilter && currentFilter.coords) return currentFilter.coords;

  var el = document.getElementById('search');
  if (el && COORD_RE.test(el.value)) {
    var fresh = parseSearch(el.value);
    if (fresh && fresh.coords) {
      currentFilter = fresh;
      return fresh.coords;
    }
  }
  return null;
}


/* ── Search and filter ───────────────────────────────────────────────── */

var _scanDebounceTimer = null;

/* Search field height grows automatically via CSS `field-sizing: content`.
   No JS height management needed. */

function onSearchChanged(skipCompute) {
  var s         = document.getElementById('search');
  var raw       = s.value;
  var hadCoords = !!(currentFilter && currentFilter.coords);
  currentFilter = parseSearch(raw);
  var hasCoords = !!currentFilter.coords;

  /* Coords just removed — clear all location-specific state */
  if (hadCoords && !hasCoords) {
    locationResults = null;
    _lookedUpAlt    = null;
    document.getElementById('pill-loc').style.display = 'none';
    document.getElementById('scan-bar').style.display = 'none';
    localResult     = null;
  }

  updatePillStates();
  updateCoordsStatus();
  renderList();
  pushState();

  if (!skipCompute) {
    if (hasCoords) computeLocal();
    else           renderData();
  }

  /* Coords come from this search input (DOM, not AppState) — explicit redraw. */
  redrawIfMapVisible();

  /* Auto-scan: debounce 800ms after typing stops */
  clearTimeout(_scanDebounceTimer);
  if (hasCoords && eclipseIndex.length) {
    _scanDebounceTimer = setTimeout(function () {
      lookupElevationAndTz(currentFilter.coords.lat, currentFilter.coords.lon);
      scanLocation();
    }, 800);
  }
}

/* The location filter pill IS the coordinate readout — it used to say
   "Location filter" while the actual coordinates sat on a separate line below
   the hints, which is two elements for one fact. The pill still clears the
   filter when clicked; the x is kept so that remains obvious. */
function updateCoordsStatus() {
  var pill = document.getElementById('pill-loc');
  if (!pill) return;
  var c = currentFilter.coords;
  if (!c) { pill.innerHTML = '&times;&nbsp;Location filter'; return; }
  var latS = c.lat >= 0 ? c.lat.toFixed(3)+'\u00b0N' : Math.abs(c.lat).toFixed(3)+'\u00b0S';
  var lonS = c.lon >= 0 ? c.lon.toFixed(3)+'\u00b0E' : Math.abs(c.lon).toFixed(3)+'\u00b0W';
  var alt  = _lookedUpAlt ? '\u2002\u00b7\u2002' + _lookedUpAlt + '\u2009m' : '';
  /* A place NAME beats coordinates when we have one — the parser keeps
     filter.city and this used to throw it away. */
  var body = currentFilter.city
           ? currentFilter.city + '\u2002\u00b7\u2002' + latS + '\u2002' + lonS + alt
           : latS + '\u2002' + lonS + alt;
  pill.innerHTML = '&times;&nbsp;' + body.replace(/&/g, '&amp;').replace(/</g, '&lt;');
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

