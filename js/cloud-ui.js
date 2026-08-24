/* js/cloud-ui.js — the cloud overlay's caption strip and mode switch.
 *
 * WHAT PROBLEM THIS SOLVES. There are now two cloud datasets that render as
 * similar coloured washes over the same map: a 30-year climatological mean
 * (js/cloud-average.js) and live satellite imagery (js/cloud-now.js). Two things follow.
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
 * OWNERSHIP. This module owns the button's pressed state and the mode; cloud-average.js
 * and cloud-now.js own their own layers and know nothing about each other.
 */
(function () {
  'use strict';

  var MODES = ['avg', 'now', 'photo'];
  var LABEL = { avg: 'Average', now: 'Map', photo: 'Pic' };

  /* Icons for the mode buttons — inline SVG, not the Tabler web font: this is
     an offline-first PWA (see sw.js precache), so a CDN font is a dependency
     the app can't guarantee. These ARE Tabler's icons though — exact outline
     paths (chart-histogram / map-2 / camera), just self-hosted as raw markup
     instead of loaded from a font. currentColor so they pick up the same
     text-dim/gold/disabled coloring the text labels used. LABEL is kept as
     the accessible name (title attr + screen readers), not shown on screen. */
  var ICON = {
    avg:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M20 18v3"/><path d="M16 16v5"/><path d="M12 13v8"/><path d="M8 16v5"/><path d="M3 11c6 0 5 -5 9 -5s3 5 9 5"/></svg>',
    now:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 18.5l-3 -1.5l-6 3v-13l6 -3l6 3l6 -3v7.5"/><path d="M9 4v13"/><path d="M15 7v5.5"/><path d="M21.121 20.121a3 3 0 1 0 -4.242 0c.418 .419 1.125 1.045 2.121 1.879c1.051 -.89 1.759 -1.516 2.121 -1.879"/><path d="M19 18v.01"/></svg>',
    photo: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2"/><path d="M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/></svg>'
  };

  /* THE STRIP IS TWO-LEVEL, AND THE REASON IS THE TAXONOMY, NOT THE LOOK.
     Three equal cells said Average, Now and Photo were three peers. They are not:
     `avg` is ERA5 climatology, a different dataset and a different question, while
     `now` and `photo` are THE SAME MOMENT shown two ways — a readable field you can
     sample a number from, and a picture you cannot. So `now` and `photo` sit as
     sub-cells under a shared `Now` cap, and `avg` stands alone beside them.
     Two things fall out of the grouping for free:
       - Offline greys the CAP and both sub-cells as one unit carrying ONE reason,
         instead of two adjacent cells that each look independently broken.
       - Adding a fourth live representation later is a third sub-cell.
     Still NOT a cycle — see the rejection at the top of this file. `Now` is dead
     offline and outside coverage, so cycling would contain a silent dead tap. */
  var LIVE = ['now', 'photo'];

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
    /* HIDE, DO NOT TEAR DOWN. off() discards the composited canvas and every
       fetched tile, so switching back re-probed, re-fetched and re-composited a
       view that had been on screen seconds earlier. Both modules keep their
       pixels and toggle layer visibility instead, so going back and forth is
       instant. Their own five-minute refresh keeps what reappears current.
       off() is still the right call when the whole cloud bar is dismissed. */
    if (mode !== 'now' && window.Satellite && Satellite.isOn()) {
      if (Satellite.hide) Satellite.hide(); else Satellite.off();
    }
    if (mode !== 'photo' && window.Imagery && Imagery.isOn()) {
      if (Imagery.hide) Imagery.hide(); else Imagery.off();
    }

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
      if (Satellite.isOn() && Satellite.show) { Satellite.show(); render(); }
      else Satellite.on(map()).then(render);
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

  /* Called by cloud-average.js when the cloud button is pressed. The button's job is
     unchanged — overlay on or off — and the strip decides which mode that is. */
  function handleButton() { setMode(_mode ? null : _last); }

  /* ------------------------------------------------------------------ legend */

  /* A gradient built from cloud-average.js's own STOPS, so the bar and the pixels can
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
      /* NO source label here. It used to read "Geostationary satellites" /
         "Satellite imagery", which the CREDIT line below already says, and
         says more precisely. Worse, the longer of the two wrapped on a phone
         and made `Now` a line taller than `Pic` — the strip changed height on
         mode switch, which is what .cloudbar-info's min-height exists to stop.
         The line still appears when a satellite is DOWN, because that is the
         one thing here the credit can't tell you: a failed satellite leaves a
         hole, and a hole reads as clear sky. */
      if (gone.length) {
        parts.push('<div class="cloudbar-note">no ' + gone.join(', ') + '</div>');
      }
      parts.push('<div class="cloudbar-note" id="cloudbar-age">' +
        (t ? ageText(_shown) : '<span class="cloudbar-spinner"></span>loading…') + '</div>');
      parts.push('<div class="cloudbar-note cloudbar-credit">' +
                 (live ? live.CREDIT : '') + '</div>');
    }

    function cell(mo, extra) {
      var why = blocked(mo);
      return '<button type="button" class="cloudbar-cell' + (extra || '') +
             (mo === _mode ? ' active' : '') + '"' +
             ' title="' + (why || LABEL[mo]) + '"' +
             ' aria-label="' + LABEL[mo] + '"' +
             (why ? ' disabled' : '') +
             ' data-mode="' + mo + '">' + ICON[mo] + '</button>';
    }

    /* The cap is a LABEL, not a control. It was tempting to make it a button that
       selects the last-used live mode, but that reintroduces the dead tap the cycle
       was rejected for: offline, the cap would be the biggest target in the strip
       and would do nothing. It carries the group's state and its reason instead. */
    var deadNow = blocked('now'), deadPic = blocked('photo');
    var groupDead = deadNow && deadPic;
    var cap = '<div class="cloudbar-cap' +
              (LIVE.indexOf(_mode) !== -1 ? ' active' : '') +
              (groupDead ? ' blocked" title="' + deadNow : '"') +
              '">Now</div>';

    _host.innerHTML =
      '<div class="cloudbar-modes">' +
        cell('avg') +
        '<div class="cloudbar-group' + (groupDead ? ' blocked' : '') + '">' +
          cap +
          '<div class="cloudbar-subs">' +
            cell('now', ' cloudbar-sub cloudbar-sub-l') +
            cell('photo', ' cloudbar-sub cloudbar-sub-r') +
          '</div>' +
        '</div>' +
      '</div>' +
      /* Fixed min-height (see .cloudbar-info in app.css): every mode is now two
         lines — Average's legend + caption, and the live modes' age + credit —
         so this holds the floor rather than absorbing a difference. A DOWN
         satellite adds a third line and the box grows, which is wanted: that
         state should be conspicuous. */
      '<div class="cloudbar-info">' + parts.join('') + '</div>';
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
    version: '2026-08-22d',
    handleButton: handleButton,
    setMode: setMode,
    /* CALLED WHEN CONNECTIVITY CHANGES. Now and Photo are drawn `disabled` while
       offline (see blocked()), and nothing redrew the bar when the connection
       came back — so the two buttons stayed dead until something else happened
       to re-render. applyOnlineState() in map.js is the one place that knows the
       truth, and it now drives this the same way it drives the shadow toggle and
       the basemap picker. */
    refresh: render,
    mode: function () { return _mode; }
  };
})();
