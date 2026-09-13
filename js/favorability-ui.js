/* js/favorability-ui.js — the controls for the favorability overlay (#F6).
 *
 * WHAT IT OWNS
 *   The `◎` map button, the caption strip below it (legend + normalisation mode),
 *   and the handover with the other overlays. It does no scoring: that is all in
 *   `js/favorability.js`, exactly as `cloud-ui.js` coordinates three cloud
 *   modules without doing any meteorology itself.
 *
 * ONE OVERLAY AT A TIME
 *   Favorability, cloud and terrain shadows are three readings of the same map
 *   and stack into mush. Turning this on turns the cloud overlay off, and vice
 *   versa — the cloud layer's own DATA is still used (the score reads
 *   Cloud.sampleAt), it is just not painted underneath. That distinction is why
 *   the score does not need the cloud overlay switched on to work.
 *
 * WHOLE PATH vs THIS VIEW — A MODE, NOT A BUTTON
 *   Whole path is the default and never moves: the ramp is pinned to the whole
 *   corridor, so a colour means the same thing wherever you pan. This view
 *   restretches to what is on screen, so that once you have chosen Spain over
 *   Greenland you can still see contrast within Spain.
 *
 *   Deliberately a MODE and not a "recalibrate now" button: a button goes stale
 *   the moment you pan and nothing tells you, whereas a mode makes
 *   colours-move-when-you-move the stated behaviour, so it cannot read as a bug.
 */
(function () {
  'use strict';

  var BAR = 'favorbar', BTN = 'btn-favor';
  var _mode = 'path';
  /* Terrain is NOT optional. It was briefly a switch in this panel, and before
     that reachable only through the Shadows button; both were wrong. It is part
     of what the overlay MEANS — a spot with a mountain in the way is not a good
     spot — so there is nothing to choose. It appears when the zoom and the
     connection allow, and the legend's last line says which of the two states
     you are in. */

  function D() { return window.Favorability; }
  function btn() { return document.getElementById(BTN); }
  function bar() { return document.getElementById(BAR); }

  /* The legend gradient is built from the layer's OWN stops, never copied, so
     the bar and the pixels cannot drift apart. Same rule as the cloud legend. */
  function gradientCss() {
    var d = D();
    if (!d || !d.stops) return 'linear-gradient(90deg,#7a1c20,#26943e)';
    return 'linear-gradient(90deg,' + d.stops().map(function (s) {
      return 'rgb(' + s[1] + ',' + s[2] + ',' + s[3] + ') ' + (s[0] * 100) + '%';
    }).join(',') + ')';
  }

  function render() {
    var b = bar(), d = D();
    if (!b) return;
    if (!d || !d.isOn()) { b.hidden = true; b.innerHTML = ''; return; }
    b.hidden = false;

    /* Is terrain live right now? The last line of the note reports it, and the
       veto is applied asynchronously, which is why the layer calls back into
       render() once it has landed. */
    var veto = !!(d.vetoActive && d.vetoActive());

    var p = [];
    p.push('<div class="cloudbar-modes">' +
           '<button type="button" class="cloudbar-cell' + (_mode === 'path' ? ' active' : '') +
             '" data-dmode="path" title="Colour compared with the whole central path">Whole path</button>' +
           '<button type="button" class="cloudbar-cell' + (_mode === 'view' ? ' active' : '') +
             '" data-dmode="view" title="Restretch the colours to what is on screen">This view</button>' +
           '</div>');
    p.push('<div class="cloudbar-legend">' +
           '<span class="cloudbar-end">worse</span>' +
           '<span class="cloudbar-ramp" style="background:' + gradientCss() + '"></span>' +
           '<span class="cloudbar-end">better</span></div>');
    /* The inputs are NAMED, not weighted. Percentages were asked for and
       measured first: they are not fixed. How much each term moves the score
       depends entirely on the eclipse — duration is 18% of the effect on
       2026-08-12 and 42% on 2031-11-14, because what dominates is whichever
       input has the widest spread along that particular path. A fixed number in
       the legend would be wrong on most eclipses. The formula is in the
       Instructions, where it can be stated exactly. */
    p.push('<div class="cloudbar-info"><div class="cloudbar-note">' +
           (_mode === 'path'
             ? 'Location favorability eclipse-wide.'
             : 'Rescaled to this view; changes as you pan.') +
           '<br>Based on duration, cloud avg, and sun alt.' +
           /* The veto is drawn for ONE instant — the local maximum at the centre
              of the view — and it re-centres every time the map settles. Across
              a zoom-6 screen that spans about 8 minutes, 2 at zoom 8, 30 seconds
              by zoom 10, so it is always timed to what is in front of you. That
              is why the scrubber is off here, but a shadow that moves when you
              pan needs saying out loud or it reads as a fault. */
           (veto ? '<br><strong>Dark red:</strong> terrain blocks the sun.'
                 : '<br>No terrain \u2014 zoom in for that.') +
           '</div></div>');
    b.innerHTML = p.join('');

    Array.prototype.forEach.call(b.querySelectorAll('[data-dmode]'), function (el) {
      el.addEventListener('click', function () { setMode(el.getAttribute('data-dmode')); });
    });
  }

  function setMode(m) {
    if (m !== 'path' && m !== 'view') return;
    _mode = m;
    if (D() && D().setMode) D().setMode(m);
    render();
  }

  function sync() {
    var e = btn(), d = D();
    if (!e) return;
    e.setAttribute('aria-pressed', (d && d.isOn()) ? 'true' : 'false');
  }

  function enable() {
    var d = D();
    if (!d) return;
    /* Cloud paints the same map and the two composite into mush. Its DATA is
       still used by the score — only the painted layer goes. */
    try {
      if (window.CloudBar && CloudBar.setMode) CloudBar.setMode(null);
      else if (window.Cloud && Cloud.isOn && Cloud.isOn()) Cloud.disable();
    } catch (err) {}
    /* Terrain shadows too — they paint the same corridor. This also restores the
       globe projection, which shadow mode flips to Mercator. */
    try {
      if (typeof disableShadows === 'function' && typeof _shadowArmed !== 'undefined' && _shadowArmed) {
        disableShadows();
      } else if (typeof window.disableShadows === 'function' && window._shadowArmed) {
        window.disableShadows();
      }
    } catch (err2) {}

    d.setMode(_mode);
    d.enable();
    sync(); render();
  }

  function disable() {
    if (D()) D().disable();
    sync(); render();
  }

  function toggle() { (D() && D().isOn()) ? disable() : enable(); }

  (function wire() {
    var e = btn();
    if (e) e.addEventListener('click', function (ev) { ev.preventDefault(); toggle(); });
    sync();

    /* A new eclipse re-renders the strip: the mode survives, but the legend's
       claim ("the best THIS eclipse offers") is about the new path now. */
    if (typeof AppState !== 'undefined') {
      AppState.on('selectedEntry', function () { sync(); render(); });
    }
    /* The veto appears and disappears on zoom, and the legend's last line
       changes with it, so the strip has to be rebuilt when the map settles. */
    if (typeof map !== 'undefined' && map && map.on) {
      map.on('moveend', function () { if (D() && D().isOn()) render(); });
    }
  })();

  window.FavorBar = {
    version: '2026-09-11a',
    toggle: toggle, enable: enable, disable: disable,
    setMode: setMode, getMode: function () { return _mode; },
    render: render
  };
})();
