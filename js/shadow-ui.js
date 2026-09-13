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

/* VETO tint, for when the favorability layer borrows this engine (TODO #F6
   step 3). It must NOT be the same red as the bottom of the score ramp: the
   ramp's worst is a bad place, this is an impossible one, and the two would
   otherwise change meaning silently at the zoom where the veto appears. Darker
   and fully opaque against the ramp's lighter, translucent worst. */
var VETO_TINT         = [0.30, 0.02, 0.04, 0.92];
var _vetoMode         = false;   /* engine borrowed by the favorability layer  */
var _vetoTime         = null;    /* pinned instant: the LOCAL maximum          */
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
  /* ss:false in veto mode is DELIBERATE and must stay explicit. The module
     default is false but this call site passes true, and supersampling would
     give the veto mask soft fractional edges where it has to be a hard binary:
     a place either has the sun blocked or it does not. */
  _shadowLayer = createShadowLayer({
    time: timeMs,
    shadowColor: _vetoMode ? VETO_TINT : SHADOW_TINT,
    ss: _vetoMode ? false : true
  });
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
      var _t0 = (typeof refT0 === 'function') ? refT0(rec) : rec.t0;
      t0ms = tdToMs(_t0 + rec.tmin);
      t1ms = tdToMs(_t0 + rec.tmax);
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
/* modes: 'off' hides it, 'hint' shows it greyed, anything else SHOWS it.
   That last clause is a trap — a misspelt or invented mode name displays the
   scrubber rather than failing — and it cost a release: veto mode passed 'hide',
   which is not a mode, so the scrubber stayed up on an overlay whose time the
   user is not allowed to choose. Unknown names are now treated as 'off' and
   complain, because showing a control by accident is the worse direction. */
function _renderTimeline(mode) {
  var tl = _shadowTimelineEl(); if (!tl) return;
  if (mode !== 'off' && mode !== 'hint' && mode !== 'show') {
    if (window.console && console.warn) console.warn('[shadow-ui] unknown timeline mode:', mode);
    mode = 'off';
  }
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

  /* ONE OVERLAY AT A TIME. Favorability paints the same corridor and the two
     composite into mush. Guarded, so this file works unchanged without the
     favorability modules present. (Terrain will eventually feed the score as a
     veto — TODO #F6 step 3 — but that is the score BORROWING this engine, not
     the two layers being drawn at once.) */
  if (window.FavorBar && window.Favorability &&
      window.Favorability.isOn && window.Favorability.isOn()) {
    try { window.FavorBar.disable(); } catch (e) {}
  }

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

/* ---- borrowed by the favorability layer (TODO #F6 step 3) ----------------
   ONE entry point in each direction. The favorability modules must never call
   this file's underscore internals; everything they need is here.

   showShadowAsVeto(timeMs) arms the engine in veto dress: veto red, no
   supersampling, no scrubber, and the time PINNED to the instant given rather
   than driven by the scrubber. That time matters — see the caller. It is the
   LOCAL maximum at the point of interest, not computeShadowWindow().maxms,
   which is greatest eclipse: one instant for the whole planet, and up to 90
   minutes wrong at the ends of a track.

   Returns false when it cannot show — offline, or below the zoom threshold —
   so the caller can say so rather than silently showing an incomplete score. */
function showShadowAsVeto(timeMs) {
  if (!map || !mapReady || !selectedEntry) return false;
  if (typeof createShadowLayer !== 'function') return false;
  if (isOffline()) return false;
  if (map.getZoom() < SHADOW_MIN_ZOOM) return false;

  _vetoMode = true;
  _vetoTime = timeMs;

  /* Rebuild rather than recolour: shadowColor and ss are constructor options,
     and ss in particular is not a paint property that can be set later. */
  try { if (map.getLayer('shadow')) map.removeLayer('shadow'); } catch (e) {}
  _shadowLayer = null;

  _shadowArmed = true;
  _attachShadowZoom();
  setMapProjection('mercator');
  _makeShadowLayer(timeMs);
  try {
    if (!map.getLayer('shadow')) map.addLayer(_shadowLayer);
  } catch (e2) { if (window.__scShowError) window.__scShowError('shadow-veto', String(e2)); }
  _shadowShowing = true;
  /* 'off', NOT 'hide'. _renderTimeline understands 'off' and 'hint' and treats
     EVERY other value as show — so an invented mode name silently displays the
     scrubber instead of hiding it, which is exactly what 'hide' did. */
  _renderTimeline('off');             /* no scrubber: the time is not the user's */
  setShadowTime(timeMs);
  _syncShadowButton();
  return true;
}

/* Repoint the veto at a new instant without tearing the layer down — the local
   maximum moves as the map moves. Cheap; no rebuild. */
function setVetoTime(timeMs) {
  if (!_vetoMode || !_shadowShowing) return;
  _vetoTime = timeMs;
  setShadowTime(timeMs);
}

/* Hand the engine back. Always leaves it OFF rather than restoring whatever the
   user had before: the two overlays are mutually exclusive, so there is nothing
   to restore to, and silently re-arming normal shadows here would surprise. */
function restoreShadowMode() {
  _vetoMode = false;
  _vetoTime = null;
  disableShadows();
}

/* Is the veto actually DRAWING? Not the same as being armed. Zooming out below
   SHADOW_MIN_ZOOM calls _hideShadowKeepArmed(), which drops the layer but keeps
   the borrow alive so it resumes on the way back in — so `_vetoMode` alone stays
   true with nothing on screen, and the legend went on saying "Dark red: terrain
   blocks the sun" over a map that had none. */
function isShadowVeto() { return _vetoMode && _shadowShowing; }

/* Is the engine BORROWED, drawing or not? The handover needs this — the answer
   to "should I hand it back" is yes even while it is hidden. */
function isVetoArmed() { return _vetoMode; }

/* Disarm: remove the layer, restore the globe, hide the scrubber. */
function disableShadows() {
  _shadowArmed = false;
  _shadowShowing = false;
  _vetoMode = false; _vetoTime = null;
  _shadowLayer = null;   /* colour and ss are constructor options: force a rebuild */
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
  /* In veto mode the instant is PINNED by the borrower and the scrubber stays
     hidden — the time is not the user's to choose. This path is reached when
     zoom crosses back above the threshold, and without these two lines it would
     quietly revert the veto to a scrubbable greatest-eclipse shadow. */
  var t = _vetoMode && _vetoTime != null ? _vetoTime : _shadowWin.curms;
  if (!_shadowLayer) {
    _makeShadowLayer(t);
  }
  try {
    if (!map.getLayer('shadow')) map.addLayer(_shadowLayer);
  } catch (e) { if (window.__scShowError) window.__scShowError('shadow', String(e)); }
  _shadowShowing = true;
  _renderTimeline(_vetoMode ? 'off' : 'show');
  setShadowTime(t);
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
      var t = _vetoMode ? _vetoTime : (_shadowWin ? _shadowWin.curms : Date.now());
      _makeShadowLayer(t);
      try { if (!map.getLayer('shadow')) map.addLayer(_shadowLayer); } catch (e) {}
      if (t != null) setShadowTime(t);
    });
  }
}
function _detachShadowZoom() {
  if (_shadowZoomHandler && map) { try { map.off('zoom', _shadowZoomHandler); } catch (e) {} }
  _shadowZoomHandler = null;
}

function toggleShadows() {
  if (isOffline()) return;
  /* If the favorability layer is holding the engine, its own button owns the
     handover. Pressing Shadows here turns THAT off first, via the exclusivity
     already wired in enableShadows(). */
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

/* The Shadows button reflects the USER'S shadow mode, not whether the engine
   happens to be drawing. While the favorability layer has borrowed it, the
   button reads OFF — because pressing it does not turn that terrain off, it
   switches to the other overlay entirely. Lighting it up invited exactly that
   confusion: both buttons appeared on, and pressing Shadows twice evicted
   favorability instead of toggling its terrain. */
function _syncShadowButton() {
  var btn = _shadowBtnEl();
  if (btn) btn.setAttribute('aria-pressed', (_shadowArmed && !_vetoMode) ? 'true' : 'false');
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
