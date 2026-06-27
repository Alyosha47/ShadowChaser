/* Static starfield for the void behind the globe.
 *
 * Approach: draw the stars once to an OFFSCREEN canvas, then set that canvas as
 * the document body's background-image. We do it this way because the body
 * background is empirically what shows through the transparent map in the void
 * around the globe — the same mechanism that displayed the earlier CSS stars.
 * Setting it inline from JS also means it wins over whatever app.css is cached.
 *
 * It is generated ONCE on load and again only on resize (debounced) — there is no
 * animation loop, so after the first paint it costs nothing at runtime.
 *
 * Decorative only. Tunables marked TUNE.
 */
(function () {
  'use strict';

  /* TUNE: lower = more stars (1 star per N CSS pixels²). */
  var DENSITY_DIVISOR = 2400;
  var BASE_COLOR      = '#0a0c0f';   /* matches --bg so the void is seamless */

  function makeStars(w, h) {
    var n = Math.max(40, Math.round((w * h) / DENSITY_DIVISOR));
    var stars = [];
    for (var i = 0; i < n; i++) {
      var roll = Math.random();
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        /* Mostly tiny; a few mid; rare bright — the hierarchy that stops it
           reading as uniform "dust". */
        r: roll > 0.985 ? 1.7 : roll > 0.90 ? 1.1 : 0.7,
        a: 0.22 + Math.pow(Math.random(), 2) * 0.7,   /* biased faint */
        tint: roll > 0.93 ? '205,222,255' : roll > 0.86 ? '255,245,226' : '255,255,255'
      });
    }
    return stars;
  }

  function render(w, h) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);   /* cap for dataURL size */
    var c = document.createElement('canvas');
    c.width  = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = BASE_COLOR;
    ctx.fillRect(0, 0, w, h);

    var stars = makeStars(w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (s.r >= 1.7) {                                   /* soft glow, brightest only */
        var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 4.5);
        g.addColorStop(0, 'rgba(' + s.tint + ',' + (s.a * 0.45).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + s.tint + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + s.tint + ',' + s.a.toFixed(3) + ')';
      ctx.fill();
    }
    return c;
  }

  function apply() {
    var w = window.innerWidth, h = window.innerHeight;
    var url = render(w, h).toDataURL('image/png');
    var b = document.body.style;
    /* Inline longhands override any app.css background (old or new). */
    b.backgroundColor    = BASE_COLOR;
    b.backgroundImage    = 'url(' + url + ')';
    b.backgroundSize     = w + 'px ' + h + 'px';
    b.backgroundRepeat   = 'no-repeat';
    b.backgroundPosition = 'top left';
    b.backgroundAttachment = 'fixed';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }

  /* Regenerate only on resize — debounced, one-shot, NOT a per-frame loop. */
  var t;
  window.addEventListener('resize', function () {
    clearTimeout(t);
    t = setTimeout(apply, 150);
  });
})();
