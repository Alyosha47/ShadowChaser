/* ── Terrain-shadow map wiring ──────────────────────────────────────────
   Wires the drop-in shadow engine (js/shadow-layer.js, window.createShadowLayer)
   into the eclipse map: a "Shadows" toggle on the map, a bottom time-scrubber
   (a ruler whose strip slides past a fixed centre needle), and shadows cast for
   the selected eclipse's date, opening at its greatest-eclipse instant.

   ONLINE-ONLY: the engine streams Terrarium DEM tiles, so the toggle greys out
   whenever isOffline() is true.

   TIME SYNC: setShadowTime(ms) is the SINGLE owner of "what instant are the
   shadows cast for". The scrubber, the SUNTRACK slider and the contact-times
   rows all route through it, so the three stay in step; _drivingSunTrack guards
   the one path that could otherwise feed back.

   STATE MACHINE:
     _shadowArmed   — the user wants shadows (the toggle is on).
     _shadowShowing — the layer is actually up AND the map is in Mercator.
   Armed-but-not-showing happens when zoomed out past SHADOW_MIN_ZOOM (the globe
   is kept and a "zoom in" hint shown) or when offline. updateShadowVisibility()
   reconciles the two on every toggle and every zoom.

   Globals consumed (defined elsewhere, resolved at call time): map, mapReady,
   selectedEntry, isOffline (map.js); loadChunk (state.js); parseCoords
   (search-ui.js); computeEclipse (eclipse.js); window.sunTrackJump (details.js).
   Depends on window.createShadowLayer (js/shadow-layer.js). */

/* ---- tuning constants ---- */
var SHADOW_MIN_ZOOM   = 6;                         /* below this zoom: keep globe, show hint */
var SHADOW_PX_PER_MIN = 6;                         /* horizontal scale of the scrubber ruler */
var SHADOW_TINT       = [0.02, 0.05, 0.16, 0.55];  /* deep navy; alpha (index 3) = strength  */
                                                   /* A constant, not a setting: the slider that
                                                      drove it is gone and this value is the one
                                                      that looked right. Change it here.        */

/* ---- state ---- */
var _shadowLayer       = null;   /* the live custom layer, or null                */
var _shadowArmed       = false;  /* user intent: shadows toggled on               */
var _shadowShowing     = false;  /* layer up + map in Mercator                    */
var _shadowWin         = null;   /* {t0ms,t1ms,maxms,curms} for the selection      */
var _shadowWinKey      = null;   /* eclipse the window was computed for            */
var _shadowLocKey      = null;   /* observer location the window was anchored for  */
var _rulerWinKey       = null;   /* window the ruler ticks were built for          */
var _drivingSunTrack   = false;  /* guard: a SUNTRACK-originated move is applied    */
var _shadowZoomHandler = null;   /* map 'zoom' listener installed while armed      */
var _shadowStyleHooked = false;  /* style.load reattach hook installed once        */

/* Zero-pad to two digits. */
function _p2(n) { return (n < 10 ? '0' : '') + n; }

/* Build the shadow layer for an instant. Supersampling (true 2x2 sub-pixel
   coverage) is on; the engine itself gates the cost to where speckle appears
   and to idle frames. */
function _makeShadowLayer(timeMs) {
  _shadowLayer = createShadowLayer({ time: timeMs, shadowColor: SHADOW_TINT, ss: true });
  return _shadowLayer;
}

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

/* Readout: date line + time line. Follows the SAME local/UT choice as the
   contact table and SUNTRACK — details.js owns _timeMode, tabs.js owns the
   offset (device zone, or an explicit pick in Settings), so all three agree and
   none of them needs an observer pin to show local time. */
var _SC_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function _shadowTzMode() {
  return (window._timeMode !== 'ut' && typeof getTzOffset === 'function') ? 'local' : 'ut';
}
/* Whole-ms shift applied for DISPLAY only; shadow time itself stays absolute. */
function _shadowTzShift() {
  if (_shadowTzMode() === 'ut') return 0;
  var off = getTzOffset();
  return (typeof off === 'number' && isFinite(off)) ? off * 3600000 : 0;
}
function _fmtShadowDate(ms) {
  var d = new Date(ms + _shadowTzShift());
  return d.getUTCDate() + ' ' + _SC_MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
function _fmtShadowTime(ms) {
  var d = new Date(ms + _shadowTzShift());
  return _p2(d.getUTCHours()) + ':' + _p2(d.getUTCMinutes())
       + (_shadowTzMode() === 'ut' ? ' UTC' : ' local');
}

/* THE single owner of shadow time. Clamps to the window, updates the engine,
   the slider position and the readout. Everything that wants to move the
   shadow time routes through here. */
function setShadowTime(ms) {
  if (!_shadowWin) return;
  ms = Math.max(_shadowWin.t0ms, Math.min(_shadowWin.t1ms, ms));
  _shadowWin.curms = ms;

  if (_shadowLayer) _shadowLayer.setTime(ms);

  /* Position the scrubber ruler: the time strip slides so the current instant
     sits under the fixed centre needle. */
  var winKey = _shadowWin.t0ms + '_' + _shadowWin.t1ms + '_' + _shadowTzShift();
  if (_rulerWinKey !== winKey) _renderRulerTicks();
  _positionRuler(ms);

  var cd = document.getElementById('shadow-date');
  if (cd) cd.textContent = _fmtShadowDate(ms);
  var ck = document.getElementById('shadow-clock');
  if (ck) ck.textContent = _fmtShadowTime(ms);

  /* Drive the SUNTRACK slider to match (clamped to its own window by
     indexForUT). Skipped when the move originated FROM SUNTRACK, so it doesn't
     bounce back. sunTrackJump sets the slider without firing 'input', so this is
     loop-free. */
  if (!_drivingSunTrack && typeof window.sunTrackJump === 'function' && selectedEntry
      && document.getElementById('st-slider')) {
    var b = Date.UTC(selectedEntry.year, selectedEntry.month - 1, selectedEntry.day);
    try { window.sunTrackJump((ms - b) / 3600e3); } catch (e) {}
  }
}

/* Convenience for callers (SUNTRACK / contact rows) that speak in UT decimal
   hours for the selected eclipse rather than absolute ms. */
function setShadowTimeUT(utHours) {
  if (!_shadowWin || !selectedEntry) return;
  var base = Date.UTC(selectedEntry.year, selectedEntry.month - 1, selectedEntry.day);
  setShadowTime(base + utHours * 3600e3);
}

/* Entry point for SUNTRACK-originated changes: moves the shadow time but marks
   the move so the owner doesn't jump SUNTRACK back onto itself. */
function shadowTimeFromSunTrack(utHours) {
  _drivingSunTrack = true;
  try { setShadowTimeUT(utHours); } finally { _drivingSunTrack = false; }
}
if (typeof window !== 'undefined') window.shadowTimeFromSunTrack = shadowTimeFromSunTrack;

/* Build the ruler's tick strip for the current window: a minor tick every 5
   minutes, a labelled major tick every 15. Called when the window changes. */
function _renderRulerTicks() {
  var ruler = document.getElementById('shadow-ruler');
  if (!ruler || !_shadowWin) return;
  var t0 = _shadowWin.t0ms, t1 = _shadowWin.t1ms;
  ruler.style.width = ((t1 - t0) / 60000 * SHADOW_PX_PER_MIN) + 'px';
  /* Tick BOUNDARIES are found in the displayed timescale, so labels land on
     clean 5-minute local marks even in a :30 or :45 zone. Positions are a
     difference, so the shift cancels and the geometry is unchanged. */
  var sh = _shadowTzShift();
  var d0 = t0 + sh, d1 = t1 + sh;
  var startMin = Math.ceil(d0 / 60000 / 5) * 5;
  var endMin   = Math.floor(d1 / 60000);
  var html = '';
  for (var m = startMin; m <= endMin; m += 5) {
    var dms = m * 60000;
    var x   = (dms - d0) / 60000 * SHADOW_PX_PER_MIN;
    var major = (m % 15 === 0);
    html += '<div class="shadow-tick' + (major ? ' major' : '') + '" style="left:' + x.toFixed(1) + 'px"></div>';
    if (major) {
      var d = new Date(dms);
      html += '<div class="shadow-tick-label" style="left:' + x.toFixed(1) + 'px">'
            + _p2(d.getUTCHours()) + ':' + _p2(d.getUTCMinutes()) + '</div>';
    }
  }
  ruler.innerHTML = html;
  _rulerWinKey = t0 + '_' + t1 + '_' + sh;
}

/* Slide the strip so `ms` sits under the centre needle. */
function _positionRuler(ms) {
  var wrap  = document.getElementById('shadow-ruler-wrap');
  var ruler = document.getElementById('shadow-ruler');
  if (!wrap || !ruler || !_shadowWin) return;
  var offPx = (ms - _shadowWin.t0ms) / 60000 * SHADOW_PX_PER_MIN;
  ruler.style.transform = 'translateX(' + (wrap.clientWidth / 2 - offPx) + 'px)';
}

function _shadowTimelineEl()  { return document.getElementById('shadow-timeline'); }
function _shadowBtnEl()       { return document.getElementById('btn-shadow'); }

/* Timeline has three modes: 'off' (hidden), 'show' (readout + ruler), and
   'hint' (armed but zoomed too far out — the .hint class swaps in a static
   "zoom in" prompt). */
function _renderTimeline(mode) {
  var tl = _shadowTimelineEl(); if (!tl) return;
  if (mode === 'off') { tl.hidden = true; return; }
  tl.hidden = false;
  if (mode === 'hint') tl.classList.add('hint');
  else                 tl.classList.remove('hint');
}

/* Arm shadows: the user WANTS shadows. Whether they SHOW right now depends on
   zoom (see updateShadowVisibility). Precompute the window so the first zoom-in
   is instant. */
function enableShadows() {
  if (!map || !mapReady || !selectedEntry) return;
  if (typeof createShadowLayer !== 'function') return;
  if (isOffline()) { refreshShadowAvailability(); return; }

  _shadowArmed = true;
  _syncShadowButton();
  _attachShadowZoom();

  computeShadowWindow(selectedEntry).then(function (win) {
    if (!_shadowArmed || !win) return;
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
  _shadowArmed = false;
  _shadowShowing = false;
  _detachShadowZoom();
  try { if (map && map.getLayer && map.getLayer('shadow')) map.removeLayer('shadow'); } catch (e) {}
  setMapProjection('globe');
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
  if (!_shadowArmed || !map || !mapReady) return;
  if (isOffline()) { _hideShadowKeepArmed('off'); return; }
  if (map.getZoom() >= SHADOW_MIN_ZOOM) _showShadowNow();
  else                                  _hideShadowKeepArmed('hint');
}

function _showShadowNow() {
  setMapProjection('mercator');
  if (!_shadowWin) {                        /* window still loading — defer */
    computeShadowWindow(selectedEntry).then(function (win) {
      if (!_shadowArmed || !win) return;
      _shadowWin = win; _shadowWinKey = selectedEntry;
      if (map.getZoom() >= SHADOW_MIN_ZOOM) _showShadowNow();
    });
    return;
  }
  if (!_shadowLayer) {
    _makeShadowLayer(_shadowWin.curms);
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
  setMapProjection('globe');
  _shadowShowing = false;
  _renderTimeline(mode || 'off');
}

function _attachShadowZoom() {
  if (_shadowZoomHandler || !map) return;
  _shadowZoomHandler = function () { updateShadowVisibility(); };
  map.on('zoom', _shadowZoomHandler);

  /* Kept as a safety net. The style is now built once and never replaced —
     going offline hides a layer, changing basemap retargets a source — so
     style.load should fire only at startup, when shadows can't be showing.
     If anything ever does rebuild the style, this restores the shadow layer and
     Mercator rather than leaving them silently dropped. Attached once. */
  if (!_shadowStyleHooked) {
    _shadowStyleHooked = true;
    map.on('style.load', function () {
      if (!_shadowShowing) return;
      setMapProjection('mercator');
      _makeShadowLayer(_shadowWin ? _shadowWin.curms : Date.now());
      try { if (!map.getLayer('shadow')) map.addLayer(_shadowLayer); } catch (e) {}
      if (_shadowWin) setShadowTime(_shadowWin.curms);
    });
  }
}
function _detachShadowZoom() {
  if (_shadowZoomHandler && map) { try { map.off('zoom', _shadowZoomHandler); } catch (e) {} }
  _shadowZoomHandler = null;
}

function toggleShadows() {
  if (isOffline()) return;
  if (_shadowArmed) disableShadows(); else enableShadows();
}

/* Called (via a one-line hook in map.js updateMapState) whenever the map
   redraws. A NEW ECLIPSE disarms shadows outright; an observer-location change
   re-anchors the shadow time to the local max. On unrelated redraws it leaves
   the user's scrubbed time alone. */
function shadowOnEclipseChange(isNewEclipse) {
  if (!_shadowArmed) return;
  /* A different eclipse is a different part of the world on a different date at
     a different time — the shadows on screen belong to the old one. The camera
     is also pulling back to the resting zoom, which is below SHADOW_MIN_ZOOM, so
     staying armed would only leave a "zoom in to reveal" hint nobody asked for.
     Disarm cleanly (this also restores the globe projection); the Shadows button
     puts them back in one tap. */
  if (isNewEclipse) { disableShadows(); return; }
  var coords  = (typeof parseCoords === 'function') ? parseCoords() : null;
  var locKey  = coords ? (coords.lat.toFixed(4) + ',' + coords.lon.toFixed(4)) : null;
  if (_shadowWinKey === selectedEntry && locKey === _shadowLocKey) return;
  computeShadowWindow(selectedEntry).then(function (win) {
    if (!_shadowArmed || !win) return;
    _shadowWin    = win;
    _shadowWinKey = selectedEntry;
    _shadowLocKey = locKey;
    if (_shadowShowing) setShadowTime(win.maxms);
  });
}

/* Called from setTimeMode() in details.js when the user flips local/UT. Shadow
   time is absolute and doesn't move — only its presentation does — so replaying
   the current instant through the single owner refreshes the readout, and the
   shift now in the ruler cache key makes it rebuild the tick labels too. */
function shadowOnTimeModeChange() {
  if (!_shadowWin || _shadowWin.curms == null) return;
  setShadowTime(_shadowWin.curms);
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
  if (off && _shadowArmed) disableShadows();
}

function _syncShadowButton() {
  var btn = _shadowBtnEl();
  if (btn) btn.setAttribute('aria-pressed', _shadowArmed ? 'true' : 'false');
}

/* Wire DOM once it exists. */
function initShadowUI() {
  var btn = _shadowBtnEl();
  if (btn && !btn._scWired) {
    btn._scWired = true;
    btn.addEventListener('click', toggleShadows);
  }
  var wrap = document.getElementById('shadow-ruler-wrap');
  if (wrap && !wrap._scWired) {
    wrap._scWired = true;
    var msPerPx = 60000 / SHADOW_PX_PER_MIN;
    var dragging = false, startX = 0, startMs = 0;
    wrap.addEventListener('pointerdown', function (ev) {
      if (!_shadowWin) return;
      dragging = true; startX = ev.clientX; startMs = _shadowWin.curms;
      try { wrap.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    wrap.addEventListener('pointermove', function (ev) {
      if (!dragging || !_shadowWin) return;
      setShadowTime(startMs - (ev.clientX - startX) * msPerPx);
    });
    function endDrag(ev) { dragging = false; try { wrap.releasePointerCapture(ev.pointerId); } catch (e) {} }
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);
    wrap.addEventListener('wheel', function (ev) {
      if (!_shadowWin) return;
      ev.preventDefault();
      setShadowTime(_shadowWin.curms + (ev.deltaY > 0 ? 1 : -1) * 5 * 60000);
    }, { passive: false });
    wrap.addEventListener('keydown', function (ev) {
      if (!_shadowWin) return;
      if (ev.key === 'ArrowLeft')  { setShadowTime(_shadowWin.curms - 60000); ev.preventDefault(); }
      if (ev.key === 'ArrowRight') { setShadowTime(_shadowWin.curms + 60000); ev.preventDefault(); }
    });
  }
  refreshShadowAvailability();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online',  refreshShadowAvailability);
  window.addEventListener('offline', refreshShadowAvailability);
  window.addEventListener('resize', function () {
    if (_shadowShowing && _shadowWin) _positionRuler(_shadowWin.curms);
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShadowUI);
  } else {
    initShadowUI();
  }
}
