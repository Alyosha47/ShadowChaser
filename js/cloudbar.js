/* js/cloudbar.js — the cloud overlay's caption strip and mode switch.
 *
 * WHAT PROBLEM THIS SOLVES. There are now two cloud datasets that render as
 * similar coloured washes over the same map: a 30-year climatological mean
 * (js/cloud.js) and live satellite imagery (js/satellite.js). Two things follow.
 *
 *   1. The user must always know WHICH they are looking at. Two datasets that
 *      look alike cannot be distinguished by an icon — the same lesson as the
 *      basemap swatches, where a zoomed-out topo tile and a street tile were
 *      indistinguishable at 44 px. Words, or nothing.
 *   2. The climatology has never had a LEGEND, which quietly undercut the whole
 *      argument for banding its palette: bands exist so a value can be read off
 *      the map without probing, and that is not true without a colour bar.
 *
 * Both are the same piece of furniture, so it is built once: a strip that
 * appears under the overlay buttons whenever cloud is showing, carrying the
 * legend, the source credit, and the mode switch.
 *
 * WHY THE MODE SWITCH IS THE SOURCE LABEL. Making the label itself the control
 * means the thing that says what you are looking at is the thing you press to
 * change it. A separate switch elsewhere would need its own label, and then
 * there would be two places stating the mode, which is one more than can stay
 * in agreement.
 *
 * REJECTED: cycling the cloud button through three states. "Now" is unavailable
 * offline and outside satellite coverage, so a cycle would frequently contain a
 * dead state — either silently skipped, and surprising when it reappears, or a
 * no-op tap. Instead the button keeps its single job (cloud on or off) and the
 * cells grey individually with a reason, exactly as the shadow button does
 * offline. Adding a third mode later is a third cell, not a redesign.
 *
 * OWNERSHIP. This module owns the button's pressed state and the mode; cloud.js
 * and satellite.js own their own layers and know nothing about each other.
 */
(function () {
  'use strict';

  var MODES = ['avg', 'now', 'photo'];
  var LABEL = { avg: 'Average', now: 'Now', photo: 'Photo' };

  var _mode = null;        /* null = overlay off; otherwise one of MODES */
  var _last = 'avg';       /* mode to restore when switched back on      */
  var _host = null;
  var _shown = NaN;        /* frame time on screen, so the age can tick alone */
  var _missedTick = false; /* a refresh fell due while the tab was hidden     */
  var _framesWired = false;/* Satellite.onFrame pushes only — register once   */
  var _photoWired = false;/* same for Imagery                                */

  function map() { return (typeof window.map !== 'undefined') ? window.map : null; }

  function offline() { return typeof isOffline === 'function' && isOffline(); }

  /* ------------------------------------------------------------ availability */

  /* Why a mode cannot be shown, or null if it can. The reason is surfaced as the
     cell's title, because a control that greys out without saying why reads as
     broken rather than as unavailable. */
  function blocked(mode) {
    if (mode === 'avg') return null;        /* precached; always available */
    if (offline()) return 'Live cloud needs a connection';
    if (mode === 'photo') return window.Imagery ? null : 'Satellite photo unavailable';
    if (!window.Satellite) return 'Live cloud unavailable';
    var m = map();
    if (!m || !m.getCenter) return null;
    return null;                            /* four stacked disks: global */
  }

  /* --------------------------------------------------------------- switching */

  function apply(mode) {
    /* Tear the other one down first. Both layers over one map would composite
       into a third thing that means nothing. */
    if (mode !== 'avg' && window.Cloud && Cloud.isOn()) Cloud.disable();
    if (mode !== 'now' && window.Satellite && Satellite.isOn()) Satellite.off();
    if (mode !== 'photo' && window.Imagery && Imagery.isOn()) Imagery.off();

    if (mode === 'avg' && window.Cloud && !Cloud.isOn()) Cloud.enable();
    if (mode === 'now' && window.Satellite) {
      /* The frame time is not known until a tile has been fetched, which is
         well after on() resolves — so redraw the caption when it arrives.
         REGISTERED ONCE. Satellite.onFrame only pushes, it has no removal, so
         re-registering on every switch to Now left a listener behind each time
         and a long session ended up redrawing the strip once per stale closure.
         The listener is harmless when the mode is not 'now' — render() returns
         immediately in that case. */
      if (!_framesWired) { _framesWired = true; Satellite.onFrame(function () { render(); }); }
      Satellite.on(map()).then(render);
    }
    if (mode === 'photo' && window.Imagery) {
      if (!_photoWired) { _photoWired = true; Imagery.onFrame(function () { render(); }); }
      Imagery.on(map()).then(render);
    }
  }

  function setMode(mode) {
    if (mode && blocked(mode)) return;
    _mode = mode;
    if (mode) _last = mode;
    apply(mode);
    render();
  }

  /* Called by cloud.js when the cloud button is pressed. The button's job is
     unchanged — overlay on or off — and the strip decides which mode that is. */
  function handleButton() { setMode(_mode ? null : _last); }

  /* ------------------------------------------------------------------ legend */

  /* A gradient built from cloud.js's own STOPS, so the bar and the pixels can
     never disagree. Banded to the same 5% classes the map uses: a smooth ramp
     here would promise a precision the 0.5 deg data does not have. */
  function gradientCss() {
    if (!window.Cloud || !Cloud.stops) return '';
    var stops = Cloud.stops(), out = [];
    for (var i = 0; i < stops.length; i++) {
      var s = stops[i], c = 'rgb(' + s[1] + ',' + s[2] + ',' + s[3] + ')';
      var a = (i === 0) ? 0 : stops[i][0] * 100;
      var b = (i === stops.length - 1) ? 100 : stops[i + 1][0] * 100;
      out.push(c + ' ' + a + '% ' + b + '%');
    }
    return 'linear-gradient(to right,' + out.join(',') + ')';
  }

  /* How stale the imagery is. Geostationary frames run over an hour behind, and
     someone standing under cloud deserves to know whether they are looking at
     ten minutes ago or two hours. */
  function ageText(ms) {
    if (!isFinite(ms)) return '';
    var mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 0) return '';
    if (mins < 90) return mins + ' min ago';
    return Math.round(mins / 60) + ' h ago';
  }

  /* -------------------------------------------------------------- rendering */

  function render() {
    if (!_host) return;
    var b = document.getElementById('btn-cloud');
    if (b) {
      b.setAttribute('aria-pressed', _mode ? 'true' : 'false');
      b.title = _mode ? 'Cloud cover — hide' : 'Cloud cover';
    }

    _host.hidden = !_mode;
    if (!_mode) { _host.innerHTML = ''; return; }

    var parts = [];

    if (_mode === 'avg') {
      parts.push('<div class="cloudbar-legend">' +
                 '<span class="cloudbar-end">clear</span>' +
                 '<span class="cloudbar-ramp" style="background:' + gradientCss() + '"></span>' +
                 '<span class="cloudbar-end">cloudy</span></div>');
      parts.push('<div class="cloudbar-note">Mean cloud at the eclipse hour · ' +
                 'ERA5 1991&ndash;2020</div>');
    } else {
      /* Both live modes report the same three things — frame time, missing
         satellites, credit — so the caption asks whichever one is showing. */
      var live = (_mode === 'photo') ? window.Imagery : window.Satellite;
      var t = live && live.shownTime();
      var gone = live ? live.missing() : [];
      _shown = t ? Date.parse(t) : NaN;
      /* The age is its OWN line. On a phone it sat on the end of the satellite
         name and the missing-satellite list, and the three together wrapped. */
      parts.push('<div class="cloudbar-note">' +
        (_mode === 'photo' ? 'Satellite imagery' : 'Geostationary satellites') +
        /* A satellite that failed leaves a hole, and a hole reads as clear sky. */
        (gone.length ? ' · no ' + gone.join(', ') : '') + '</div>');
      parts.push('<div class="cloudbar-note" id="cloudbar-age">' +
        (t ? ageText(_shown) : 'loading…') + '</div>');
      parts.push('<div class="cloudbar-note cloudbar-credit">' +
                 (live ? live.CREDIT : '') + '</div>');
    }

    var cells = MODES.map(function (mo) {
      var why = blocked(mo);
      return '<button type="button" class="cloudbar-cell' +
             (mo === _mode ? ' active' : '') + '"' +
             (why ? ' disabled title="' + why + '"' : '') +
             ' data-mode="' + mo + '">' + LABEL[mo] + '</button>';
    }).join('');

    _host.innerHTML = '<div class="cloudbar-modes">' + cells + '</div>' + parts.join('');
  }

  /* ------------------------------------------------------------------- wire */

  function init() {
    _host = document.getElementById('cloudbar');
    if (!_host) return;

    _host.addEventListener('click', function (e) {
      var cell = e.target.closest ? e.target.closest('.cloudbar-cell') : null;
      if (!cell || cell.disabled) return;
      e.preventDefault();
      setMode(cell.getAttribute('data-mode'));
    });

    /* No moveend handler. The satellite layer is a fixed world canvas, so
       panning and zooming need no refetch and no re-projection — which is
       exactly what went wrong when it was viewport-shaped. Frames are refreshed
       on a timer instead, because new imagery arrives on the satellites' own
       schedule rather than on the user's. */
    /* THE AGE HAS TO TICK ON ITS OWN. It was written once, when a refresh
       completed, and then sat there: "14 min ago" still read "14 min ago" an
       hour later, which is worse than showing nothing because it looks live.
       A countdown to the next refresh was considered and rejected — it answers
       "when will this update" when the question is "how old is what I am looking
       at", and the answer to the second makes the first visible anyway. Only the
       text node is rewritten, so the mode buttons are never rebuilt under a
       finger mid-tap. */
    setInterval(function () {
      if ((_mode !== 'now' && _mode !== 'photo') || !isFinite(_shown)) return;
      var el = document.getElementById('cloudbar-age');
      if (el) el.textContent = ageText(_shown);
    }, 30 * 1000);

    /* MapLibre caches the remapped tiles, so a newer frame needs the source torn
       down and rebuilt — refresh() alone would be a no-op once it exists.

       Skipped while the tab is hidden: a backgrounded phone waking every five
       minutes to fetch several hemispheres is how a map gets uninstalled. The
       missed refresh runs on return rather than waiting out the next interval. */
    setInterval(function () {
      var lv = (_mode === 'photo') ? window.Imagery : (_mode === 'now' ? window.Satellite : null);
      if (!lv) return;
      if (document.visibilityState === 'hidden') { _missedTick = true; return; }
      _missedTick = false;
      lv.invalidate().then(render);
    }, 5 * 60 * 1000);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' || !_missedTick) return;
      var lv2 = (_mode === 'photo') ? window.Imagery : (_mode === 'now' ? window.Satellite : null);
      if (!lv2) return;
      _missedTick = false;
      lv2.invalidate().then(render);
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  /* Bump on every change. Script tags carry a hardcoded ?v= and the service
     worker is cache-first with ignoreSearch, so "is this the file I just
     uploaded?" is otherwise unanswerable from the console. */
  window.CloudBar = {
    version: '2026-08-17b',
    handleButton: handleButton,
    setMode: setMode,
    mode: function () { return _mode; }
  };
})();
