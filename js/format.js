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

function fmtLocal(h, off) {
  return (h === null || h === undefined) ? '--' : fmtUT(h + off);
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

/* Render Moon-Sun geometry as an inline SVG.
   x, y : Moon center offset from Sun center, in Sun radii (0,0 = centered)
   k    : Moon/Sun apparent size ratio (~0.97 = annular, ~1.03 = total)
   type : 'T'/'A'/'H'/'P' — drives corona vs ring decoration when overlapping
   size : pixel dimension of the SVG (square) */
/* Diamond-ring icon: dark Moon disk fully covering the Sun, faint corona
   ring, single bright bead at position angle p (degrees from celestial
   north going east). Used for C2/C3 contacts. */
function drawDiamondRing(v, size) {
  var s = size || 18;
  var cx = 14, cy = 14;
  var R  = 7;                                    /* Moon/Sun radius */
  var rad = v * Math.PI / 180;                   /* V: zenith-relative, clockwise */
  var beadR = R + 0.7;                            /* sit bead on the corona ring */
  var beadX = cx + beadR * Math.sin(rad);
  var beadY = cy - beadR * Math.cos(rad);

  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 28 28">'
       + '<defs><filter id="dr' + s + '" x="-100%" y="-100%" width="300%" height="300%">'
       +   '<feGaussianBlur in="SourceGraphic" stdDeviation="0.8"/></filter></defs>'
       /* Faint corona ring (white, low opacity) */
       + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R + 1.4) + '" fill="none" stroke="#fff" stroke-width="0.6" opacity="0.7"/>'
       /* Dark Moon disk */
       + '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="#0a0c10"/>'
       /* Bright bead at p, with a small halo for the "diamond" glint */
       + '<circle cx="' + beadX.toFixed(2) + '" cy="' + beadY.toFixed(2) + '" r="2.4" fill="#fff" filter="url(#dr' + s + ')"/>'
       + '<circle cx="' + beadX.toFixed(2) + '" cy="' + beadY.toFixed(2) + '" r="1.4" fill="#fff"/>'
       + '</svg>';
}

function drawEclipseGeometry(x, y, k, type, size) {
  var s = size || 18;
  /* Coord system: Sun radius = 7 in a 28-unit viewBox. Sun fills ~50% of the
     icon; viewBox is wide enough for contact-icon offsets (Moon center up to
     ~1 Sun radius from Sun center) plus the corona for Total. */
  var R   = 7;
  var cx  = 14, cy = 14;
  var mr  = R * (k || 1);
  var mx  = cx + (x || 0) * R;
  var my  = cy + (y || 0) * R;

  var sunFill = '#e8c98e';                       /* sun visible disk */
  var bg      = '#0a0c10';                       /* background — matches app */
  var moonFill = bg;                              /* moon = silhouette = bg */

  var overlapping = Math.hypot(x||0, y||0) < (1 + (k||1));
  var centered    = Math.hypot(x||0, y||0) < 0.05;

  var parts = [];

  /* Total or Hybrid: corona glow when Moon is centered on Sun.
     Hybrid is depicted as a total with a small bright ring showing through
     the Moon's silhouette (it's annular at horizon, total near noon). */
  if ((type === 'T' || type === 'H') && centered) {
    parts.push('<defs><filter id="cg' + s + '" x="-100%" y="-100%" width="300%" height="300%">' +
               '<feGaussianBlur in="SourceGraphic" stdDeviation="2.5"/></filter></defs>');
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (R + 1) + '" fill="#fff" filter="url(#cg' + s + ')"/>');
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (R + 1) + '" fill="#fff" filter="url(#cg' + s + ')"/>');
  }

  /* Sun disk */
  parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + sunFill + '"/>');

  /* Annular: brighter rim shows through (Moon smaller than Sun, ring visible) */
  if (type === 'A' && centered) {
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="#e07820"/>');
  }

  /* Moon disk (only if overlapping or near Sun) */
  if (overlapping || Math.hypot(x||0, y||0) < 2.5) {
    parts.push('<circle cx="' + mx.toFixed(2) + '" cy="' + my.toFixed(2) +
               '" r="' + mr.toFixed(2) + '" fill="' + moonFill + '"/>');
  }

  /* Hybrid: small bright ring showing through the Moon (annular component) */
  if (type === 'H' && centered) {
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (R * 0.55) + '" fill="#e07820"/>');
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (R * 0.40) + '" fill="' + bg + '"/>');
  }

  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 28 28">' +
         parts.join('') + '</svg>';
}

function typeIcon(tc) {
  /* Used by the search list. Renders the eclipse at maximum (Moon centered).
     Annular k=0.94 makes the ring visible; total k=1.04 hides the Sun;
     partial k=1.0 with offset shows a crescent. */
  switch (tc) {
    case 'T': return drawEclipseGeometry(0,    0, 1.04, 'T', 22);
    case 'A': return drawEclipseGeometry(0,    0, 0.94, 'A', 20);
    case 'H': return drawEclipseGeometry(0,    0, 1.00, 'H', 22);
    default:  return drawEclipseGeometry(0.45, 0, 1.00, 'P', 20);
  }
}


function typeCode(t) {
  /* Normalise to single uppercase letter for CSS class */
  if (!t) return 'P';
  if (t.length === 1) return t.toUpperCase();
  return t[0].toUpperCase();
}

/* Sunrise: sun cresting above horizon (mostly hidden, top visible).
   Sunset:  sun half-dipped below horizon (about to vanish, bottom hidden). */
function horizonIcon(rising) {
  /* viewBox 28x28, horizon at y=18.
     Rising:  sun centered at y=20 (mostly below horizon, ~30% above)
     Setting: sun centered at y=16 (mostly above horizon, ~30% below) */
  var cy = rising ? 20 : 16;
  return '<svg width="22" height="22" viewBox="0 0 28 28">'
       + '<defs><clipPath id="hc' + (rising?'r':'s') + '">'
       +   '<rect x="0" y="0" width="28" height="18"/>'
       + '</clipPath></defs>'
       /* Sun (clipped to above-horizon only) */
       + '<circle cx="14" cy="' + cy + '" r="6" fill="#e8c98e" clip-path="url(#hc' + (rising?'r':'s') + ')"/>'
       /* Horizon line */
       + '<line x1="2" y1="18" x2="26" y2="18" stroke="#7e8fa0" stroke-width="1.5"/>'
       + '</svg>';
}

