/* ── Terrain-shadow map wiring ──────────────────────────────────────────
   Wires the drop-in shadow engine (js/shadow-layer.js, exposes
   window.createShadowLayer) into the eclipse map:

   - a "Shadows" toggle button on the map (top-left);
   - a time scrubber across the bottom of the map;
   - shadows are cast for the SELECTED eclipse's date, opening at its
     greatest-eclipse instant (from the Besselian record's td_ge).

   ONLINE-ONLY: the layer fetches Terrarium DEM tiles, so the toggle is
   disabled (greyed) whenever isOffline() reports no connection.

   setShadowTime(ms) is the SINGLE owner of "what instant are the shadows
   cast for". The on-map slider calls it today; the SUNTRACK slider and the
   contact-times rows will call the same function when their links are wired,
   so those three controls stay in sync through one place (with one
   re-entrancy guard) rather than N pairwise links.

   Globals consumed (all defined by other modules, resolved at call time):
     map, mapReady, selectedEntry            (map.js)
     isOffline()                             (map.js)
     loadChunk()                             (state.js)
   Depends on window.createShadowLayer       (js/shadow-layer.js) */

var _shadowLayer = null;     /* the live custom layer, or null when off      */
var _shadowOn    = false;    /* ARMED: user's toggle intent                  */
var _shadowShowing = false;  /* layer currently up + map in mercator          */
var _shadowWin   = null;     /* {t0ms,t1ms,maxms,curms} absolute-ms window    */
var _shadowSync  = false;    /* re-entrancy guard for setShadowTime           */
var _shadowWinKey = null;    /* which eclipse _shadowWin was computed for     */
var _shadowLocKey = null;    /* which observer location it was anchored for   */
var _shadowZoomHandler = null;

/* Below this zoom the globe stays; terrain shadows read only when zoomed in,
   so we don't sacrifice the sphere to show shadows nobody could see. Nudge to
   taste. */
var SHADOW_MIN_ZOOM = 6.5;

/* Shadow tint — deep navy, matches the engine default; kept here so the app
   owns the look in one place. */
var SHADOW_TINT = [0.02, 0.05, 0.16, 0.55];

/* Parse a "HH:MM:SS" (or "HH:MM") clock string to decimal hours. */
function _hmsToHours(s) {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string') return null;
  var p = s.split(':');
  if (!p.length) return null;
  var h = parseFloat(p[0]) || 0;
  var m = p.length > 1 ? (parseFloat(p[1]) || 0) : 0;
  var sec = p.length > 2 ? (parseFloat(p[2]) || 0) : 0;
  return h + m / 60 + sec / 3600;
}

/* Compute the shadow window (event span + greatest-eclipse instant) for an
   eclipse, as absolute epoch-ms, from its Besselian record. Everything is in
   TD hours in the record; UT = TD − ΔT, then anchored on the record's date.
   Pure ms arithmetic on a UTC-midnight base handles any midnight rollover. */
function computeShadowWindow(entry) {
  return loadChunk(entry._chunk).then(function (chunk) {
    var rec = null;
    for (var i = 0; i < chunk.length; i++) {
      var r = chunk[i];
      if (r.year === entry.year && r.month === entry.month && r.day === entry.day) { rec = r; break; }
    }
    if (!rec) return null;

    var base = Date.UTC(rec.year, rec.month - 1, rec.day);   /* UTC midnight, ms */
    var dtH  = (rec.dt || 0) / 3600;                          /* ΔT in hours      */
    function tdToMs(tdHours) { return base + (tdHours - dtH) * 3600e3; }

    /* Greatest-eclipse instant (GLOBAL). */
    var geH = _hmsToHours(rec.td_ge);
    var maxms = (geH != null) ? tdToMs(geH) : null;

    /* Event window: tmin/tmax are TD-hour offsets from t0. */
    var t0ms, t1ms;
    if (rec.tmin != null && rec.tmax != null) {
      t0ms = tdToMs(rec.t0 + rec.tmin);
      t1ms = tdToMs(rec.t0 + rec.tmax);
      if (t1ms < t0ms) { var tmp = t0ms; t0ms = t1ms; t1ms = tmp; }
    } else if (maxms != null) {
      t0ms = maxms - 3 * 3600e3; t1ms = maxms + 3 * 3600e3;
    } else {
      return null;
    }

    /* If an observer location is set and the eclipse is visible there, anchor on
       the LOCAL maximum instead of the global greatest eclipse. computeEclipse's
       tMax is already UT decimal hours (toUT), so no ΔT term here. */
    var coords = (typeof parseCoords === 'function') ? parseCoords() : null;
    if (coords) {
      try {
        var lr = computeEclipse(rec, coords.lat, coords.lon, 0);
        if (lr && lr.visible && lr.tMax != null) maxms = base + lr.tMax * 3600e3;
      } catch (e) {}
    }

    if (maxms == null) maxms = (t0ms + t1ms) / 2;
    maxms = Math.max(t0ms, Math.min(t1ms, maxms));

    return { t0ms: t0ms, t1ms: t1ms, maxms: maxms, curms: maxms };
  });
}

/* Format an absolute instant for the scrubber readout (UTC — unambiguous and
   location-independent; SUNTRACK already handles local time at a pin). */
function _fmtShadowClock(ms) {
  var d = new Date(ms);
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate())
       + '\u2002' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ' UTC';
}

/* THE single owner of shadow time. Clamps to the window, updates the engine,
   the slider position and the readout. Everything that wants to move the
   shadow time routes through here. */
function setShadowTime(ms) {
  if (!_shadowWin) return;
  ms = Math.max(_shadowWin.t0ms, Math.min(_shadowWin.t1ms, ms));
  _shadowWin.curms = ms;

  if (_shadowLayer) _shadowLayer.setTime(ms);

  _shadowSync = true;
  var sl = document.getElementById('shadow-slider');
  if (sl) {
    var span = _shadowWin.t1ms - _shadowWin.t0ms;
    sl.value = span > 0 ? Math.round((ms - _shadowWin.t0ms) / span * 1000) : 500;
  }
  _shadowSync = false;

  var ck = document.getElementById('shadow-clock');
  if (ck) ck.textContent = _fmtShadowClock(ms);
}

/* Convenience for future callers (SUNTRACK / contact rows) that speak in UT
   decimal hours for the selected eclipse rather than absolute ms. */
function setShadowTimeUT(utHours) {
  if (!_shadowWin || !selectedEntry) return;
  var base = Date.UTC(selectedEntry.year, selectedEntry.month - 1, selectedEntry.day);
  setShadowTime(base + utHours * 3600e3);
}

function _shadowTimelineEl()  { return document.getElementById('shadow-timeline'); }
function _shadowBtnEl()       { return document.getElementById('btn-shadow'); }

/* Timeline has three modes: 'off' (hidden), 'show' (slider + clock), and
   'hint' (armed but zoomed too far out — a "zoom in" prompt in place of the
   controls). */
function _renderTimeline(mode) {
  var tl = _shadowTimelineEl(); if (!tl) return;
  var sl = document.getElementById('shadow-slider');
  var ck = document.getElementById('shadow-clock');
  if (mode === 'off') { tl.hidden = true; return; }
  tl.hidden = false;
  if (mode === 'hint') {
    if (sl) sl.style.display = 'none';
    if (ck) { ck.textContent = 'Zoom in to reveal terrain shadows'; ck.style.textAlign = 'center'; ck.style.flex = '1'; }
  } else {                                   /* 'show' */
    if (sl) sl.style.display = '';
    if (ck) { ck.style.textAlign = ''; ck.style.flex = ''; }
  }
}

/* Arm shadows: the user WANTS shadows. Whether they SHOW right now depends on
   zoom (see updateShadowVisibility). Precompute the window so the first zoom-in
   is instant. */
function enableShadows() {
  if (!map || !mapReady || !selectedEntry) return;
  if (typeof createShadowLayer !== 'function') return;
  if (isOffline()) { refreshShadowAvailability(); return; }

  _shadowOn = true;
  _syncShadowButton();
  _attachShadowZoom();

  computeShadowWindow(selectedEntry).then(function (win) {
    if (!_shadowOn || !win) return;
    _shadowWin    = win;
    _shadowWinKey = selectedEntry;
    var c = (typeof parseCoords === 'function') ? parseCoords() : null;
    _shadowLocKey = c ? (c.lat.toFixed(4) + ',' + c.lon.toFixed(4)) : null;
    updateShadowVisibility();
  });
  updateShadowVisibility();      /* immediate: shadows if zoomed in, else hint */
}

/* Disarm: remove the layer, restore the globe, hide the scrubber. */
function disableShadows() {
  _shadowOn = false;
  _shadowShowing = false;
  _detachShadowZoom();
  try { if (map && map.getLayer && map.getLayer('shadow')) map.removeLayer('shadow'); } catch (e) {}
  try { if (map) map.setProjection({ type: 'globe' }); } catch (e) {}
  _shadowLayer  = null;
  _shadowWin    = null;
  _shadowWinKey = null;
  _shadowLocKey = null;
  _renderTimeline('off');
  _syncShadowButton();
}

/* The single decider: given we're armed, should shadows be showing right now?
   Above the zoom threshold → Mercator + layer + scrubber. Below → keep the
   globe, drop the layer, show the "zoom in" hint. Called on toggle and on every
   zoom. */
function updateShadowVisibility() {
  if (!_shadowOn || !map || !mapReady) return;
  if (isOffline()) { _hideShadowKeepArmed('off'); return; }
  if (map.getZoom() >= SHADOW_MIN_ZOOM) _showShadowNow();
  else                                  _hideShadowKeepArmed('hint');
}

function _showShadowNow() {
  try { map.setProjection({ type: 'mercator' }); } catch (e) {}
  if (!_shadowWin) {                        /* window still loading — defer */
    computeShadowWindow(selectedEntry).then(function (win) {
      if (!_shadowOn || !win) return;
      _shadowWin = win; _shadowWinKey = selectedEntry;
      if (map.getZoom() >= SHADOW_MIN_ZOOM) _showShadowNow();
    });
    return;
  }
  if (!_shadowLayer) {
    _shadowLayer = createShadowLayer({ time: _shadowWin.curms, shadowColor: SHADOW_TINT });
  }
  try {
    if (!map.getLayer('shadow')) map.addLayer(_shadowLayer);
  } catch (e) { if (window.__scShowError) window.__scShowError('shadow', String(e)); }
  _shadowShowing = true;
  _renderTimeline('show');
  setShadowTime(_shadowWin.curms);
}

/* Drop the layer + return to the globe, but stay ARMED so shadows resume when
   the user zooms back in. */
function _hideShadowKeepArmed(mode) {
  try { if (map && map.getLayer && map.getLayer('shadow')) map.removeLayer('shadow'); } catch (e) {}
  try { if (map && map.getProjection && map.getProjection().type !== 'globe') map.setProjection({ type: 'globe' }); } catch (e) {}
  _shadowShowing = false;
  _renderTimeline(mode || 'off');
}

function _attachShadowZoom() {
  if (_shadowZoomHandler || !map) return;
  _shadowZoomHandler = function () { updateShadowVisibility(); };
  map.on('zoom', _shadowZoomHandler);
}
function _detachShadowZoom() {
  if (_shadowZoomHandler && map) { try { map.off('zoom', _shadowZoomHandler); } catch (e) {} }
  _shadowZoomHandler = null;
}

function toggleShadows() {
  if (isOffline()) return;
  if (_shadowOn) disableShadows(); else enableShadows();
}

/* Called (via a one-line hook in map.js updateMapState) whenever the map
   redraws for a selection. If shadows are on and the eclipse changed,
   recompute the window and re-anchor at the new greatest-eclipse instant. */
/* Called (via a one-line hook in map.js updateMapState) whenever the map
   redraws. Re-anchors the shadow time to the max — global, or LOCAL when an
   observer pin is set — whenever the eclipse OR the observer location changes.
   On unrelated redraws it leaves the user's scrubbed time alone. */
function shadowOnEclipseChange(isNewEclipse) {
  if (!_shadowOn) return;
  var coords  = (typeof parseCoords === 'function') ? parseCoords() : null;
  var locKey  = coords ? (coords.lat.toFixed(4) + ',' + coords.lon.toFixed(4)) : null;
  var changed = isNewEclipse || _shadowWinKey !== selectedEntry || locKey !== _shadowLocKey;
  if (!changed) return;
  computeShadowWindow(selectedEntry).then(function (win) {
    if (!_shadowOn || !win) return;
    _shadowWin    = win;
    _shadowWinKey = selectedEntry;
    _shadowLocKey = locKey;
    if (_shadowShowing) setShadowTime(win.maxms);
  });
}

/* Button + availability. Offline greys the toggle (and drops any live layer). */
function refreshShadowAvailability() {
  var off = (typeof isOffline === 'function') && isOffline();
  var btn = _shadowBtnEl();
  if (btn) {
    btn.disabled = off;
    btn.title = off
      ? 'Terrain shadows need a connection (they stream elevation tiles) \u2014 unavailable offline'
      : 'Terrain shadows at the selected eclipse';
  }
  if (off && _shadowOn) disableShadows();
}

function _syncShadowButton() {
  var btn = _shadowBtnEl();
  if (btn) btn.setAttribute('aria-pressed', _shadowOn ? 'true' : 'false');
}

/* Wire DOM once it exists. */
function initShadowUI() {
  var btn = _shadowBtnEl();
  if (btn && !btn._scWired) {
    btn._scWired = true;
    btn.addEventListener('click', toggleShadows);
  }
  var sl = document.getElementById('shadow-slider');
  if (sl && !sl._scWired) {
    sl._scWired = true;
    sl.addEventListener('input', function () {
      if (_shadowSync || !_shadowWin) return;
      var span = _shadowWin.t1ms - _shadowWin.t0ms;
      setShadowTime(_shadowWin.t0ms + (parseInt(sl.value, 10) / 1000) * span);
    });
  }
  refreshShadowAvailability();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online',  refreshShadowAvailability);
  window.addEventListener('offline', refreshShadowAvailability);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShadowUI);
  } else {
    initShadowUI();
  }
}
