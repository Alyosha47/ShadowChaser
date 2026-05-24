/* ── Local circumstances computation ────────────────────────────────── */

function computeLocal() {
  if (!selectedEntry) return Promise.resolve(null);
  var coords = parseCoords();
  if (!coords) { renderData(); return Promise.resolve(null); }

  var lat = coords.lat;
  var lon = coords.lon;
  var f   = parseSearch(document.getElementById('search').value);
  var alt = _lookedUpAlt || 0;
  var tz  = getTzOffset();

  return loadChunk(selectedEntry._chunk).then(function (chunk) {
    var rec = null;
    for (var i = 0; i < chunk.length; i++) {
      var r = chunk[i];
      if (r.year===selectedEntry.year && r.month===selectedEntry.month
       && r.day===selectedEntry.day) { rec=r; break; }
    }
    if (!rec) { setStatus('Record not found in data chunk.', true); return null; }

    try {
      localResult = computeEclipse(rec, lat, lon, alt);
      renderData(rec, tz, lat, lon);
      setStatus('', false);
      return { rec: rec, result: localResult };
    } catch (err) {
      setStatus('Computation error: ' + err.message, true);
      console.error(err);
      return null;
    }
  }).catch(function (err) {
    setStatus('Failed to load data: ' + err.message, true);
    console.error(err);
    return null;
  });
}


/* ── Sunrise / Sunset ────────────────────────────────────────────────── */

/* Binary-search for the UT offset (hours from t0) when sun altitude = 0.
   Returns null if the sun doesn't cross the horizon in the search window. */
function findHorizonCrossing(rec, lat, lonW, alt, dT_s, tStart, tEnd, rising) {
  var ALT_THRESH = 0.01;
  var MAX_ITER   = 40;
  var aStart = sunAltAz(fundamentalArgs(rec, tStart, lat, lonW, alt, dT_s), lat).alt;
  var aEnd   = sunAltAz(fundamentalArgs(rec, tEnd,   lat, lonW, alt, dT_s), lat).alt;
  if (rising  && !(aStart < 0 && aEnd > 0)) return null;
  if (!rising && !(aStart > 0 && aEnd < 0)) return null;
  var lo = tStart, hi = tEnd;
  for (var i = 0; i < MAX_ITER; i++) {
    var mid = (lo + hi) / 2;
    var a   = sunAltAz(fundamentalArgs(rec, mid, lat, lonW, alt, dT_s), lat).alt;
    if (Math.abs(a) < ALT_THRESH) return mid;
    if (rising ? (a < 0) : (a > 0)) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function computeSunriseSunset(rec, lat, lon, alt) {
  var dT_s  = rec.dt;
  var lonW  = -lon;  /* east-positive → west-positive for fundamentalArgs */
  var rise = null, set = null;
  for (var t = -18; t < 18; t++) {
    var a0 = sunAltAz(fundamentalArgs(rec, t,   lat, lonW, alt, dT_s), lat).alt;
    var a1 = sunAltAz(fundamentalArgs(rec, t+1, lat, lonW, alt, dT_s), lat).alt;
    if (rise === null && a0 < 0 && a1 > 0) rise = findHorizonCrossing(rec, lat, lonW, alt, dT_s, t, t+1, true);
    if (set  === null && a0 > 0 && a1 < 0) set  = findHorizonCrossing(rec, lat, lonW, alt, dT_s, t, t+1, false);
  }
  return { rise: rise, set: set };
}

function setStatus(msg, isErr) {
  var el = document.getElementById('status-msg');
  el.textContent = msg || '';
  el.className   = isErr ? 'err' : '';
}


/* ── Location scan ───────────────────────────────────────────────────── */

function clearLocationFilter() {
  locationResults = null;
  _lookedUpAlt    = null;
  /* Strip coords from the search field so the filter matches that state */
  var search = document.getElementById('search');
  var f = parseSearch(search.value);
  if (f.coords) {
    search.value = filterToString(Object.assign({}, f, { coords: null }));
    currentFilter = parseSearch(search.value);
  }
  document.getElementById('pill-loc').style.display = 'none';
  document.getElementById('scan-bar').style.display = 'none';
  updateCoordsStatus();
  renderList();
  if (selectedEntry) { localResult = null; renderData(); }
  /* Coords come from the DOM search input, not AppState — explicit redraw. */
  redrawIfMapVisible();
}

function scanLocation() {
  var coords = parseCoords();
  if (!coords) { setStatus('Enter valid coordinates before scanning.', true); return; }

  var lat = coords.lat;
  var lon = coords.lon;
  var f   = parseSearch(document.getElementById('search').value);
  var alt = _lookedUpAlt || 0;
  var cacheKey = lat.toFixed(1) + ',' + lon.toFixed(1) + ',' + Math.round(alt/100);

  if (scanCache[cacheKey]) {
    locationResults = scanCache[cacheKey];
    document.getElementById('pill-loc').style.display = '';
    renderList();
    return;
  }

  var chunkKeys = [], seen = {};
  for (var i = 0; i < eclipseIndex.length; i++) {
    var k = eclipseIndex[i]._chunk;
    if (k && !seen[k]) { seen[k]=true; chunkKeys.push(k); }
  }

  var results = [], chunksDone = 0;
  var totalChunks = chunkKeys.length;
  scanCancelFlag  = false;
  var lonWest     = -lon;

  document.getElementById('scan-bar').style.display = '';
  document.getElementById('pill-loc').style.display = 'none';
  document.getElementById('scan-fill').style.width  = '0%';
  document.getElementById('scan-msg').textContent   = 'Loading chunks\u2026';

  function processChunk(records) {
    for (var j = 0; j < records.length; j++) {
      if (scanCancelFlag) return;
      var rec  = records[j];
      var tMax = findMaximum(rec, lat, lonWest, alt, rec.dt);
      var oMax = fundamentalArgs(rec, tMax, lat, lonWest, alt, rec.dt);
      var dist = Math.sqrt(oMax.u*oMax.u + oMax.v*oMax.v);
      if (dist >= Math.abs(oMax.L1p)) continue;

      var r = computeEclipse(rec, lat, lon, alt);
      if (!r.visible) continue;

      var entry = null;
      for (var k = 0; k < eclipseIndex.length; k++) {
        var e = eclipseIndex[k];
        if (e.year===rec.year && e.month===rec.month && e.day===rec.day) { entry=e; break; }
      }
      if (!entry) continue;
      results.push(Object.assign({}, entry, { local_type: r.type, local_mag: r.mag }));
    }
  }

  function nextChunk(idx) {
    if (scanCancelFlag) {
      document.getElementById('scan-bar').style.display = 'none';
      return;
    }
    if (idx >= totalChunks) {
      results.sort(function (a,b) {
        if (a.year!==b.year)   return a.year-b.year;
        if (a.month!==b.month) return a.month-b.month;
        return a.day-b.day;
      });
      scanCache[cacheKey] = results;
      locationResults = results;
      document.getElementById('scan-bar').style.display = 'none';
      document.getElementById('pill-loc').style.display = '';
      document.getElementById('scan-msg').textContent = 'Scanning\u2026';
      renderList();
      /* Auto-select first eclipse in filtered results if none selected (don't switch tabs) */
      if (!selectedEntry && results.length) {
        var filtered = applyFilter(results, currentFilter);
        var pick = filtered.length ? filtered[0] : results[0];
        selectedEntry = pick;
        updateHeaderSelection();
        renderList();
        computeLocal();
        /* AppState events auto-fire pushState (url.js) and redrawIfMapVisible (map.js). */
      }
      return;
    }
    document.getElementById('scan-fill').style.width =
      Math.round(idx/totalChunks*100) + '%';
    document.getElementById('scan-msg').textContent =
      'Scanning ' + (idx+1) + '\u202f/\u202f' + totalChunks + ' chunks\u2026';

    loadChunk(chunkKeys[idx]).then(function (records) {
      processChunk(records);
      chunksDone++;
      setTimeout(function () { nextChunk(idx+1); }, 0);
    }).catch(function (err) {
      console.error('Scan chunk error:', err);
      setTimeout(function () { nextChunk(idx+1); }, 0);
    });
  }

  nextChunk(0);
}

