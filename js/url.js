/* ── Event wiring ────────────────────────────────────────────────────── */

/* Search field — live filtering. Height grows automatically via CSS
   field-sizing: content (set on .search-box textarea). */
document.getElementById('search').addEventListener('input', onSearchChanged);

document.getElementById('search').addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  /* Textarea would insert a newline; we want Enter to submit-style instead. */
  e.preventDefault();
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
  if (!navigator.geolocation) { setStatus('Geolocation not available.', true); setMapStatus('Geolocation not available.', true); return; }
  setStatus('Locating\u2026'); setMapStatus('Locating\u2026');
  navigator.geolocation.getCurrentPosition(function (pos) {
    try { window._deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e) {}
    setStatus(''); setMapStatus('');
    var lat = pos.coords.latitude;
    var lon = pos.coords.longitude;
    /* Bring the camera to the pin — on a globe that means rotating the Earth
       round to it — and zoom in if we're further out than LOCATE_ZOOM. Never
       zooms back OUT, so a user already looking closely keeps their view.
       Same easeTo pattern as onMapClick, which is the other "user set the
       pin explicitly" path. */
    var LOCATE_ZOOM = 6;
    if (map) map.easeTo({ center: [lon, lat],
                          zoom: Math.max(map.getZoom(), LOCATE_ZOOM),
                          duration: 1200 });
    var search = document.getElementById('search');
    var f = parseSearch(search.value);
    search.value = filterToString(Object.assign({}, f, { coords: { lat: lat, lon: lon } }));
    onSearchChanged(true);
    lookupElevationAndTz(lat, lon);
    if (eclipseIndex.length) scanLocation();
    computeLocal().then(function (out) {
      if (!out) return;
      clearMapMarkers();
      addObserverMarker(lat, lon, out.result.visible ? out.result.sun.az : null);
      /* Same "fresh circumstances are waiting in Details" signal onMapClick
         gives after a pin placement — missing here meant GPS-set locations
         never throbbed the tab on mobile, only map taps did, even though
         both land the user on the identical Details content. */
      if (window.matchMedia('(min-width: 900px)').matches) {
        if (sidebarTab === 'search') sidebarTab = 'eclipse';
      } else if (typeof window.scFlagFreshDetails === 'function') {
        window.scFlagFreshDetails();
      }
    });
  }, function (err) {
    /* Surface WHY it failed — on Safari it's usually a permission denial
       (code 1), which behaves differently than in the installed PWA. */
    var msg = 'Location unavailable.';
    if (err) {
      if (err.code === 1) msg = 'Location permission denied. Enable it in Settings \u2192 Safari \u2192 Location, or in the address-bar site settings.';
      else if (err.code === 2) msg = 'Location unavailable (position could not be determined).';
      else if (err.code === 3) msg = 'Location timed out. Try again.';
    }
    setStatus(msg, true); setMapStatus(msg, true);
  }, { enableHighAccuracy: true, timeout: 15000 });
});

/* Accordion: tapping one group closes the others. On desktop, CSS keeps
   the headers hidden so this never fires from user action. */
(function () {
  var ready = false;
  setTimeout(function () { ready = true; }, 0);
  var groups = ['sg-about', 'sg-instructions', 'sg-data'];
  groups.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('toggle', function () {
      if (!ready || !el.open) return;
      groups.forEach(function (otherId) {
        if (otherId === id) return;
        var other = document.getElementById(otherId);
        if (other && other.open) other.open = false;
      });
    });
  });
})();


/* ── URL sharing ─────────────────────────────────────────────────────── */

/**
 * Encode current state into the URL hash.
 * Format: #e=CAT_NO&q=SEARCH_STRING&tz=TIMEZONE
 * cat_no uniquely identifies the eclipse.
 * q is the full search string (includes coords, alt, types etc).
 * tz is the selected timezone value.
 */
function pushState() {
  if (!selectedEntry) return;   /* nothing to push yet (init-time only) */
  var parts = [];
  if (selectedEntry.cat_no != null) {
    parts.push('e=' + Math.round(selectedEntry.cat_no));
  }
  var q = document.getElementById('search').value.trim();
  if (q) parts.push('q=' + encodeURIComponent(q));
  var tz = getTz();
  if (tz !== 'auto') parts.push('tz=' + encodeURIComponent(tz));
  /* Cloud overlay, so a copied URL carries what is actually on the map. Omitted
     when the overlay is off, which is also what makes turning it off stick: the
     next pushState simply stops emitting the key. */
  var cm = (window.CloudBar && window.CloudBar.mode) ? window.CloudBar.mode() : null;
  if (cm) parts.push('cloud=' + cm);
  var hash = parts.length ? '#' + parts.join('&') : '';
  /* Use replaceState to avoid polluting browser history on every keystroke */
  /* When hash is empty, compare against '' (current hash) — browser may report '' or '#'. */
  var current = window.location.hash;
  if (current !== hash && !(current === '#' && hash === '')) {
    history.replaceState(null, '', hash || window.location.pathname + window.location.search);
  }
}

/**
 * Parse the URL hash and return { catNo, q, tz, cloud } — any may be null.
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
    if (k === 'cloud') out.cloud = v;
    if (k === 'shadow') out.shadow = v;
  });
  return out;
}

/* Cloud overlay from a link. CloudBar.setMode() is the single entry point and
   already owns enabling, tearing the other modes down and redrawing the strip —
   this only decides WHEN to call it.
   TIMING: on a cold load restoreFromHash() runs as soon as index.json lands,
   which can beat the map's `load` event. Cloud._enable() would then set its own
   `_on` flag and bail out of _render() on !mapReady, and nothing re-renders the
   overlay afterwards — the button would read ON over an empty map. So wait for
   mapReady when it isn't ready yet. AppState.on() has no removal, and mapReady
   goes false→true again if the map is ever re-initialised, so the listener
   disarms itself. */
var CLOUD_MODES = ['avg', 'now', 'photo'];
function applyCloudMode(mode) {
  if (CLOUD_MODES.indexOf(mode) < 0) return;   /* an unknown mode is not a mode */
  var done = false;
  function go() {
    if (done) return;
    done = true;
    if (window.CloudBar && window.CloudBar.setMode) window.CloudBar.setMode(mode);
  }
  if (mapReady) go();
  else AppState.on('mapReady', function (ready) { if (ready) go(); });
}

/* Terrain shadows from a link: `shadow=<zoom>` means ARM THEM AND GO THERE.
   enableShadows() only arms — below SHADOW_MIN_ZOOM (6) it shows the "zoom in"
   hint and no shadows — and the link's own recentre frames the whole path, which
   is far below that. So the zoom is part of the instruction, not a separate one.
   THREE THINGS FIGHT FOR THE CAMERA and this is the order that wins:
     - updateMapState() re-frames on a new eclipse, but only when the map is
       VISIBLE, and on mobile that can be after this runs (the framing is "owed"
       until the Map tab opens). So wait for a visible, ready map rather than
       flying at a hidden container.
     - Claiming _framedEntry stops the re-frame from pulling the camera straight
       back out to the resting zoom. tabs.js additionally skips its _scRecenter()
       for these links, which would have cleared that claim.
     - shadowOnEclipseChange() disarms on a new eclipse, so arming happens on
       moveend, after the selection and the camera have both settled. */
function applyShadowLink(zoom) {
  var z = parseFloat(zoom);
  if (!isFinite(z)) return;
  var done = false;
  function go() {
    if (done || !window.map || !mapReady) return;
    if (typeof isMapVisible === 'function' && !isMapVisible()) return;   /* try again on the next event */
    var c = (typeof parseCoords === 'function') ? parseCoords() : null;
    if (!c) return;
    done = true;
    if (typeof updateMapState === 'function') updateMapState._framedEntry = selectedEntry;
    map.once('moveend', function () {
      if (typeof enableShadows === 'function') enableShadows();
    });
    map.flyTo({ center: [c.lon, c.lat], zoom: z, duration: 1200 });
  }
  go();
  if (!done) {
    AppState.on('mapReady', go);
    AppState.on('activeTab', go);   /* mobile: the Map tab is what makes it visible */
  }
}

/* Auto-update URL when selection changes. Other triggers (search input, tz,
   scan completion, initial load) still call pushState explicitly. */
AppState.on('selectedEntry', pushState);

/**
 * Restore state from URL hash after the index is loaded.
 * Called once at startup, after eclipseIndex is populated.
 */
function restoreFromHash() {
  var h = readHash();

  /* Restore timezone. setTz validates against TZ_ZONES and ignores anything
     else, so an unknown zone in the link leaves the app on 'auto' rather than
     on a value nothing can resolve. */
  if (h.tz) setTz(h.tz);

  /* Restore search string (overrides default) */
  if (h.q) {
    document.getElementById('search').value = h.q;
  }

  /* Restore selected eclipse. If a catNo was specified, that overrides
     whatever is currently selected — including clearing to null if the
     catNo isn't in our catalogue (the fallback below picks a default). */
  if (h.catNo) {
    selectedEntry = null;
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

  /* If the hash referenced an eclipse we don't have, fall back to default. */
  if (!selectedEntry) selectNextEclipse();

  /* Render with the restored (or fallback) selection. Map redraw fires via
     AppState event; if mapReady isn't yet true, the mapReady subscription
     will redraw later. */
  updateHeaderSelection();
  renderList();
  computeLocal();

  /* Last, because the Average layer draws for the SELECTED eclipse and returns
     early without one.
     THE HASH DEFINES THE OVERLAY STATE, always — not only when it names an
     overlay. An earlier version cleared the other overlay only for links that
     carried `cloud=` or `shadow=`, on the reasoning that a plain link had no
     opinion; the result was that cloud cover switched on by the "cloud" link
     then rode along on top of every subsequent link, including the ones that
     rotate to somewhere else entirely. A deep link is a fresh start.
     Only hash navigation reaches here — pushState uses replaceState, which
     fires no hashchange — so this never fights a toggle the user just pressed. */
  if (!h.cloud && window.CloudBar && window.CloudBar.mode && window.CloudBar.mode()) {
    window.CloudBar.setMode(null);
  }
  if (!h.shadow && typeof disableShadows === 'function' &&
      typeof _shadowArmed !== 'undefined' && _shadowArmed) {
    disableShadows();   /* guarded: it also forces the globe projection back on */
  }
  if (h.cloud)  applyCloudMode(h.cloud);
  if (h.shadow) applyShadowLink(h.shadow);
}

/* Re-apply state when the user edits the URL hash directly. pushState uses
   replaceState which does NOT fire hashchange, so there's no loop. */
window.addEventListener('hashchange', restoreFromHash);



