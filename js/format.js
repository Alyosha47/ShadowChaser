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

function typeIcon(tc) {
  /* Each icon is a self-contained SVG. Hybrid uses masks (not clipPath)
     so the blurred glow isn't hard-cropped by the mask boundary. */
  switch (tc) {
    case 'T':
      /* Total — double-layered white glow, padded viewBox so blur isn't clipped */
      return '<svg width="22" height="22" viewBox="-3 -3 24 24" title="Total">'
           + '<defs><filter id="tg" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="4"/></filter></defs>'
           + '<circle cx="9" cy="9" r="8" fill="#fff" filter="url(#tg)"/>'
           + '<circle cx="9" cy="9" r="8" fill="#fff" filter="url(#tg)"/>'
           + '<circle cx="9" cy="9" r="7" fill="#0a0c10"/>'
           + '</svg>';
    case 'A':
      /* Annular — thin orange ring */
      return '<svg width="20" height="20" viewBox="0 0 18 18" title="Annular">'
           + '<circle cx="9" cy="9" r="8" fill="#e07820"/>'
           + '<circle cx="9" cy="9" r="5.5" fill="#0a0c10"/>'
           + '</svg>';
    case 'H':
      /* Hybrid — full glow unclipped, black semicircle left (total), orange ring right (annular) */
      return '<svg width="22" height="22" viewBox="-3 -3 24 24" title="Hybrid">'
           + '<defs><filter id="hg" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur in="SourceGraphic" stdDeviation="4"/></filter></defs>'
           + '<circle cx="9" cy="9" r="8" fill="#fff" filter="url(#hg)"/>'
           + '<circle cx="9" cy="9" r="8" fill="#fff" filter="url(#hg)"/>'
           + '<path d="M9,2 A7,7 0 0,0 9,16 Z" fill="#0a0c10"/>'
           + '<path d="M9,2 A7,7 0 0,1 9,16 Z" fill="#e07820"/>'
           + '<circle cx="9" cy="9" r="5.5" fill="#0a0c10"/>'
           + '</svg>';
    default:
      /* Partial — grey crescent */
      return '<svg width="20" height="20" viewBox="0 0 18 18" title="Partial">'
           + '<circle cx="9" cy="9" r="8" fill="#7e8fa0"/>'
           + '<circle cx="13" cy="9" r="6.5" fill="#0a0c10"/>'
           + '</svg>';
  }
}


function typeCode(t) {
  /* Normalise to single uppercase letter for CSS class */
  if (!t) return 'P';
  if (t.length === 1) return t.toUpperCase();
  return t[0].toUpperCase();
}

