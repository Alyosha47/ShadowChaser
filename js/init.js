/* ── Initialisation ──────────────────────────────────────────────────── */

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
    } else {
      onSearchChanged();
      selectNextEclipse();
    }
    /* Paths are computed on the device (paths.js). Once the page has settled,
       compute and cache in idle time the eclipses a user is likeliest to open,
       so they are instant, offline too: the logged ones and the next six. */
    setTimeout(function () {
      if (typeof warmPaths !== 'function') return;
      var now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth() + 1, d = now.getUTCDate();
      var next = eclipseIndex.filter(function (e) {
        return e.year > y || (e.year === y && (e.month > m || (e.month === m && e.day >= d)));
      }).slice(0, 6);
      var logged = (typeof scLogRows === 'function') ? scLogRows().map(function (r) { return r.rec; }) : [];
      warmPaths(logged.concat(next));
    }, 4000);
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
