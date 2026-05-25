/* ── Initialisation ──────────────────────────────────────────────────── */

buildTzSelect();
initMap(); /* Map is the default tab — initialise immediately */

fetch(DATA_BASE + '/index.json?v=' + BUILD)
  .then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(function (data) {
    eclipseIndex = data.sort(function (a,b) {
      if (a.year!==b.year)   return a.year-b.year;
      if (a.month!==b.month) return a.month-b.month;
      return a.day-b.day;
    });
    /* Restore from URL hash if present, else apply default search */
    if (window.location.hash && window.location.hash.length > 1) {
      restoreFromHash();
      /* If the hash referenced an eclipse we don't have, fall back to default. */
      if (!selectedEntry) selectNextEclipse();
    } else {
      onSearchChanged();
      selectNextEclipse();
    }
    /* Silently request geolocation to pre-populate coords */
    if (navigator.geolocation && !currentFilter.coords) {
      navigator.geolocation.getCurrentPosition(function (pos) {
        try { window._deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e) {}
        var lat = pos.coords.latitude, lon = pos.coords.longitude;
        var search = document.getElementById('search');
        var f = parseSearch(search.value);
        if (!parseCoords()) {
          search.value = filterToString(Object.assign({}, f, { coords: { lat: lat, lon: lon } }));
          onSearchChanged();
          lookupElevationAndTz(lat, lon);
        }
      }, function () { /* silently ignore denial */ });
    }
  })
  .catch(function (err) {
    document.getElementById('eclipse-list').innerHTML =
      '<div class="list-status" style="color:var(--red)">Failed to load catalogue: ' + err.message + '</div>';
  });
