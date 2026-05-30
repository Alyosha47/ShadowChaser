/* ── Formatting utilities ────────────────────────────────────────────── */
/* Note: DATA_BASE and BUILD are defined inline in index.html (next to the
   <meta name="build"> tag) so cache-busting works on the external JS files
   themselves. Update both the meta tag and the inline var on ship. */

var MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun',
              'Jul','Aug','Sep','Oct','Nov','Dec'];

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function fmtUT(h) {
  if (h === null || h === undefined || isNaN(h)) return '--';
  h = ((h % 24) + 24) % 24;
  var hh = Math.floor(h);
  var mm = Math.floor((h - hh) * 60);
  var ss = Math.round(((h - hh) * 60 - mm) * 60);
  if (ss >= 60) { ss -= 60; mm++; }
  if (mm >= 60) { mm -= 60; hh++; }
  return pad(hh % 24) + ':' + pad(mm) + ':' + pad(ss);
}

/* Day-aware time formatter. Renders `h` (decimal hours) as HH:MM:SS, and
   appends ` (±Nd)` when the floor-divided day differs from `anchor`'s day.
   Used by the contact-times table so events that fall on the previous or
   next calendar day relative to the eclipse maximum are unambiguous. */
function fmtUTAnchored(h, anchor) {
  if (h === null || h === undefined || isNaN(h)) return '--';
  var dayOff = Math.floor(h / 24) - Math.floor((anchor != null ? anchor : h) / 24);
  var s = fmtUT(h);
  if (dayOff !== 0) {
    var sign = dayOff > 0 ? '+' : '\u2212';   /* real minus, not hyphen */
    s += '<sup class="day-off">' + sign + Math.abs(dayOff) + '</sup>';
  }
  return s;
}

function fmtLocal(h, off) {
  return (h === null || h === undefined) ? '--' : fmtUT(h + off);
}
function fmtLocalAnchored(h, off, anchor) {
  return (h === null || h === undefined) ? '--'
    : fmtUTAnchored(h + off, anchor != null ? anchor + off : null);
}

function fmtDur(s) {
  if (!s || s <= 0) return '--';
  var m   = Math.floor(s / 60);
  var sec = Math.round(s % 60);
  return m > 0 ? m + 'm\u2009' + pad(sec) + 's' : sec + 's';
}

function fmtAng(a) {
  return (a !== null && a !== undefined) ? a.toFixed(1) + '\u00b0' : '--';
}

function fmtDate(e) {
  var y = e.year < 0
    ? Math.abs(e.year) + '\u202fbce'
    : e.year + '\u202fce';
  return MONTHS[e.month] + '\u2009' + e.day + ',\u2009' + y;
}

function typeName(t) {
  return { T:'Total', A:'Annular', H:'Hybrid', P:'Partial',
           total:'Total', annular:'Annular', hybrid:'Hybrid', partial:'Partial' }[t] || t;
}

/**
 * eclipseIcon — unified inline-SVG renderer for all eclipse icons.
 *
 * Single icon family for the search list and the contact-times table.
 * One palette, one coordinate system, one viewBox. Returns an SVG string.
 *
 * Options:
 *   type      'T'|'A'|'H'|'P'           — eclipse type
 *   phase     'MAX'|'C1'|'C2'|'C3'|'C4' — optional; MAX or omitted = the
 *             list-style "shape of the eclipse"; C-codes draw the
 *             contact-specific geometry below.
 *   magnitude number 0..~1.05           — optional; drives the Partial
 *             offset and the Hybrid (none — fixed). Ignored otherwise.
 *   angle     degrees, zenith-relative clockwise — required for C1-C4.
 *             0 = up, 90 = right, 180 = down, 270 = left.
 *   size      pixels (default 32)
 *
 * Render modes by (phase, type):
 *   MAX/T          dark moon disk + soft white corona halo
 *   MAX/A          dark interior + orange ring stroke
 *   MAX/H          left half = corona; right half = annular ring
 *   MAX/P          orange sun + moon offset by (1 − magnitude)
 *   C2/C3, any T   diamond ring: dark disk + faint corona + bright bead at angle
 *   C2/C3, any A   dark disk + orange ring + bright bead at angle (annular bead)
 *   C1/C4          moon offset by ~0.95 sun-radii in `angle` direction
 *                  (Sun-with-bite, orientation reflects contact direction)
 */
function eclipseIcon(opts) {
  var type  = (opts.type  || 'P').toUpperCase();
  var phase = (opts.phase || 'MAX').toUpperCase();
  var mag   = (typeof opts.magnitude === 'number') ? opts.magnitude : null;
  var ang   = (typeof opts.angle     === 'number') ? opts.angle     : null;
  var SIZE  = opts.size || 32;

  /* Coordinate system — same for every icon so the family stays consistent.
     36-unit viewBox, sun radius 9 (50% of viewBox), so corona has room. */
  var VB = 36, R = 9, cx = 18, cy = 18;

  /* Palette — used across all icons in the family. */
  var SUN  = '#e8a04a';   /* warm orange — sun disk / annular ring */
  var MOON = '#0a0c10';   /* matches app background — silhouette */
  var HALO = '#dde3ec';   /* soft white — corona */

  /* Unique-id suffix for SVG filter ids (multiple icons on one page). */
  var fid = (eclipseIcon._n = (eclipseIcon._n || 0) + 1);

  var head = '<svg width="' + SIZE + '" height="' + SIZE + '" viewBox="0 0 ' + VB + ' ' + VB + '">';
  var foot = '</svg>';

  /* Convenience builders for the shared visual primitives. */
  function coronaDef() {
    return '<defs><filter id="cg' + fid + '" x="-50%" y="-50%" width="200%" height="200%">'
         +   '<feGaussianBlur stdDeviation="2.2"/>'
         + '</filter></defs>';
  }
  function coronaCircle(clip) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R + 4.2) + '" fill="' + HALO
         + '" filter="url(#cg' + fid + ')" opacity="1.0"'
         + (clip ? ' clip-path="url(#' + clip + ')"' : '') + '/>';
  }

  function moonDisk(clip) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + MOON + '"'
         + (clip ? ' clip-path="url(#' + clip + ')"' : '') + '/>';
  }
  function annularRing(clip) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R - 0.5) + '" fill="' + MOON
         + '" stroke="' + SUN + '" stroke-width="1.8"'
         + (clip ? ' clip-path="url(#' + clip + ')"' : '') + '/>';
  }

  /* ── C2 / C3: diamond ring ───────────────────────────────────────────
     Dark moon fully covering, single bright bead glinting at the limb
     at position `angle`. For annular contact, the bead sits on the
     orange ring instead of pure white. */
  if ((phase === 'C2' || phase === 'C3') && ang !== null) {
    var rad   = ang * Math.PI / 180;
    var beadR = R + 0.7;
    var bx    = cx + beadR * Math.sin(rad);
    var by    = cy - beadR * Math.cos(rad);
    var beadColor = (type === 'A') ? SUN : HALO;
    return head
         + '<defs><filter id="cg' + fid + '" x="-100%" y="-100%" width="300%" height="300%">'
         +   '<feGaussianBlur stdDeviation="0.8"/></filter></defs>'
         /* Faint corona / ring outline */
         + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R + 1.4) + '" fill="none"'
         +   ' stroke="' + (type === 'A' ? SUN : HALO) + '" stroke-width="0.6" opacity="0.7"/>'
         /* Dark moon */
         + moonDisk()
         /* Diamond bead */
         + '<circle cx="' + bx.toFixed(2) + '" cy="' + by.toFixed(2)
         +   '" r="2.4" fill="' + beadColor + '" filter="url(#cg' + fid + ')"/>'
         + '<circle cx="' + bx.toFixed(2) + '" cy="' + by.toFixed(2)
         +   '" r="1.4" fill="' + beadColor + '"/>'
         + foot;
  }

  /* ── C1 / C4: moon overlapping sun's limb at `angle` ─────────────────
     Show the sun with a crescent bite. Orientation reflects contact dir. */
  if ((phase === 'C1' || phase === 'C4') && ang !== null) {
    var rad2 = ang * Math.PI / 180;
    var d    = 0.95;
    var mx   = cx + d * R * Math.sin(rad2);
    var my   = cy - d * R * Math.cos(rad2);
    return head
         + '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + SUN + '"/>'
         + '<circle cx="' + mx.toFixed(2) + '" cy="' + my.toFixed(2) + '" r="' + R + '" fill="' + MOON + '"/>'
         + foot;
  }

  /* ── MAX (or no phase given): list-row-style icons per type ─────────── */

  switch (type) {
    case 'T':
      return head + coronaDef() + coronaCircle() + moonDisk() + foot;

    case 'A':
      return head + annularRing() + foot;

    case 'H': {
      /* Left half = corona; right half = annular ring. Distinct from T and A. */
      var lc = 'hl' + fid, rc = 'hr' + fid;
      return head
           + '<defs>'
           +   '<filter id="cg' + fid + '" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6"/></filter>'
           +   '<clipPath id="' + lc + '"><rect x="0" y="0" width="' + cx + '" height="' + VB + '"/></clipPath>'
           +   '<clipPath id="' + rc + '"><rect x="' + cx + '" y="0" width="' + (VB - cx) + '" height="' + VB + '"/></clipPath>'
           + '</defs>'
           + coronaCircle(lc)
           + annularRing(rc)
           + moonDisk(lc)
           + foot;
    }

    default: {
      /* Partial: orange sun + moon offset by (1 − magnitude), clamped. */
      var m  = (mag !== null) ? mag : 0.5;
      var dd = Math.max(0.18, Math.min(0.92, 1 - m));
      var mxP = cx + dd * R;
      return head
           + '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + SUN + '"/>'
           + '<circle cx="' + mxP + '" cy="' + cy + '" r="' + R + '" fill="' + MOON + '"/>'
           + foot;
    }
  }
}

/* Thin wrappers — keep existing call sites working. */
function typeIcon(tc, magnitude) {
  return eclipseIcon({ type: tc, magnitude: magnitude });
}


function typeCode(t) {
  /* Normalise to single uppercase letter for CSS class */
  if (!t) return 'P';
  if (t.length === 1) return t.toUpperCase();
  return t[0].toUpperCase();
}

/* Sunrise / Sunset icons: half-sun sitting on the horizon line with three
   rays emanating outward. Sunset is the same shape flipped vertically so
   the half-disc sits *below* the horizon with rays pointing down. */
function horizonIcon(rising) {
  var SIZE = 32, VB = 36;
  var inner =
      /* Rays — emanating upward from sun's top */
      '<line x1="18" y1="6"   x2="18" y2="3"   stroke="#e8a04a" stroke-width="1.8" stroke-linecap="round"/>'
    + '<line x1="11.5" y1="9" x2="9"  y2="6.5" stroke="#e8a04a" stroke-width="1.8" stroke-linecap="round"/>'
    + '<line x1="24.5" y1="9" x2="27" y2="6.5" stroke="#e8a04a" stroke-width="1.8" stroke-linecap="round"/>'
    /* Half-disc sitting on horizon */
    + '<path d="M10,18 A8,8 0 0,1 26,18 Z" fill="#e8a04a"/>'
    /* Horizon line */
    + '<line x1="3" y1="18" x2="33" y2="18" stroke="#e8a04a" stroke-width="1.6" stroke-linecap="round"/>';

  return '<svg width="' + SIZE + '" height="' + SIZE + '" viewBox="0 0 ' + VB + ' ' + VB + '">'
       + (rising ? inner : '<g transform="translate(0,' + VB + ') scale(1,-1)">' + inner + '</g>')
       + '</svg>';
}

