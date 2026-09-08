/* ─────────────────────────────────────────────────────────────────────────
   KMZ EXPORT — one eclipse per file, openable in Google Earth OFFLINE.

   WHAT THIS IS FOR
   ----------------
   Jubier's KMZ has a live feature: centre the view anywhere and a server
   computes local circumstances for that spot on demand. That needs a backend.
   This app is static hosting with no Node available, so the trade is made in
   the other direction: circumstances are computed HERE, in the browser, at
   download time, and frozen into the file. Every dot carries its own contact
   times, and they work in a field with no signal — which is the situation the
   app exists for. The cost is that only the dots have numbers; the balloon
   link back into the app covers anywhere in between.

   If a compute endpoint ever exists (a Cloudflare Worker running eclipse.js
   unmodified is the cheap route), add a <NetworkLink> with
   viewRefreshMode="onStop" and viewFormat="lon=[lookatLon]&lat=[lookatLat]".
   Nothing else here needs to change.

   FORMAT
   ------
   A KMZ is a ZIP holding doc.kml. We write the ZIP by hand — 60 lines, no
   library, which is what keeps the app dependency-free and offline-capable.
   Compression is CompressionStream('deflate-raw'), available in exactly the
   browsers that already have DecompressionStream, which path chunks require:
   nothing new is demanded of the browser. If it is missing we still emit a
   valid ZIP with stored (uncompressed) entries rather than failing.
   ───────────────────────────────────────────────────────────────────────── */

/* Dots along the centreline, in kilometres. Spacing is by DISTANCE, not by
   degrees of longitude: 0.5° is ~55 km at the equator and ~15 km at 70°N, so
   a degree-based rule bunches dots exactly where paths are longest. 100 km
   gives 60–120 dots for a typical path and ~40 kB of balloons. */
var KMZ_DOT_KM = 100;

var _kmzBusy = false;

/* ── ZIP ──────────────────────────────────────────────────────────────── */

var _crcTable = null;
function _crc32(bytes) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) crc = _crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _deflateRaw(bytes) {
  /* Stored fallback keeps the export working on a browser without
     CompressionStream instead of throwing at the last step. */
  if (typeof CompressionStream !== 'function') return Promise.resolve(null);
  try {
    var cs = new CompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Response(stream).arrayBuffer()
      .then(function (buf) { return new Uint8Array(buf); })
      .catch(function () { return null; });
  } catch (e) { return Promise.resolve(null); }
}

/* Marker icon, embedded IN the archive. Google Earth's default placemark is a
   pushpin, and the only way to change it is an <Icon><href>. A maps.google.com
   URL renders as nothing with no signal, so the image travels inside the KMZ
   instead and is referenced as a relative path — offline-safe, 197 bytes.
   Deliberately WHITE: IconStyle <color> multiplies, so one white diamond tints
   to any colour and each style picks its own. */
var KMZ_DIAMOND_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAjElEQVR42s2XSwrAIAwFPZen7g1T'
+ 'Crpq6yfmM8LbOgNqTIqIlMycblBbUgQe8NVSowU6vC+1hAX8SMIKrpawhKskrOHbEh7wLQkv+LKE'
+ 'J3xJwhs+lYiADyWi4L8SkfBPiWj4SwIjkH4EiEuIeIaIQoQoxYjPCPEdIxoSREuGaEoRbTliMEGM'
+ 'Zojh1CQ3kOaTcMWHBSoAAAAASUVORK5CYII=';

function _b64ToBytes(b64) {
  var bin = atob(b64), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* Build a ZIP from several entries. Local headers + central directory + EOCD,
   all little-endian. No zip64: these files are kilobytes. */
function _zipFiles(entries) {
  return Promise.all(entries.map(function (e) {
    return _deflateRaw(e.bytes).then(function (d) {
      return { name: e.name, raw: e.bytes, body: d || e.bytes, method: d ? 8 : 0 };
    });
  })).then(function (items) {
    var out = [], dir = [];
    function push(a, v, n) { for (var i = 0; i < n; i++) a.push((v >>> (i * 8)) & 0xFF); }

    items.forEach(function (it) {
      var nameB = new TextEncoder().encode(it.name);
      var crc = _crc32(it.raw);
      var offset = out.length;

      push(out, 0x04034B50, 4); push(out, 20, 2); push(out, 0, 2); push(out, it.method, 2);
      push(out, 0, 2); push(out, 0, 2);
      push(out, crc, 4); push(out, it.body.length, 4); push(out, it.raw.length, 4);
      push(out, nameB.length, 2); push(out, 0, 2);
      for (var i = 0; i < nameB.length; i++) out.push(nameB[i]);
      for (var j = 0; j < it.body.length; j++) out.push(it.body[j]);

      push(dir, 0x02014B50, 4); push(dir, 20, 2); push(dir, 20, 2); push(dir, 0, 2);
      push(dir, it.method, 2); push(dir, 0, 2); push(dir, 0, 2);
      push(dir, crc, 4); push(dir, it.body.length, 4); push(dir, it.raw.length, 4);
      push(dir, nameB.length, 2); push(dir, 0, 2); push(dir, 0, 2); push(dir, 0, 2);
      push(dir, 0, 2); push(dir, 0, 4); push(dir, offset, 4);
      for (var k = 0; k < nameB.length; k++) dir.push(nameB[k]);
    });

    var central = out.length;
    for (var m = 0; m < dir.length; m++) out.push(dir[m]);
    push(out, 0x06054B50, 4); push(out, 0, 2); push(out, 0, 2);
    push(out, items.length, 2); push(out, items.length, 2);
    push(out, dir.length, 4); push(out, central, 4); push(out, 0, 2);

    return new Blob([new Uint8Array(out)], { type: 'application/vnd.google-earth.kmz' });
  });
}

/* ── Geometry helpers ─────────────────────────────────────────────────── */

function _kmzHaversineKm(a, b) {
  var R = 6371.0088, rad = Math.PI / 180;
  var dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  var la1 = a[1] * rad, la2 = b[1] * rad;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function _kmzEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* The path record stores curves in TWO shapes, and mixing them up produces
   coordinates like "undefined,undefined,0" that Google Earth silently drops:
     - penumbra/umbra/terminator: an array of SEGMENTS, each an array of [lon,lat]
     - green_curve:               a FLAT [lon,lat] list with `null` delimiters
       between components (a two-blob eclipse has two, a figure-8 one loop)
   Several keys are also legitimately EMPTY for a given eclipse — 1961 has no
   penumbra_n and no terminator_last — so every consumer must tolerate absence.
   Both shapes are normalised here, and every result is additionally split where
   longitude jumps more than 180°: with tessellate=1 an antimeridian wrap draws
   a line straight across the globe, the same streak map.js guards against. */
function _kmzNormSegs(v) {
  if (!v || !v.length) return [];
  var segs = [];
  var first = null;
  for (var i = 0; i < v.length && first === null; i++) if (v[i] !== null) first = v[i];
  if (first === null) return [];

  if (Array.isArray(first[0])) {
    segs = v.filter(function (s) { return s && s.length > 1; });
  } else {
    var cur = [];
    for (var j = 0; j < v.length; j++) {
      if (v[j] === null) { if (cur.length > 1) segs.push(cur); cur = []; continue; }
      cur.push(v[j]);
    }
    if (cur.length > 1) segs.push(cur);
  }

  var out = [];
  for (var k = 0; k < segs.length; k++) {
    var run = [segs[k][0]];
    for (var m = 1; m < segs[k].length; m++) {
      var p = segs[k][m], prev = run[run.length - 1];
      if (Math.abs(p[0] - prev[0]) > 180) { if (run.length > 1) out.push(run); run = [p]; }
      else run.push(p);
    }
    if (run.length > 1) out.push(run);
  }
  return out;
}

function _kmzLines(segsIn, styleId, name) {
  var segs = _kmzNormSegs(segsIn);
  if (!segs.length) return '';
  var out = '';
  for (var i = 0; i < segs.length; i++) {
    var seg = segs[i];
    var coords = '';
    for (var j = 0; j < seg.length; j++) coords += seg[j][0] + ',' + seg[j][1] + ',0 ';
    out += '<Placemark><name>' + _kmzEsc(name) + '</name>'
         + '<styleUrl>#' + styleId + '</styleUrl>'
         + '<LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode>'
         + '<coordinates>' + coords.trim() + '</coordinates></LineString></Placemark>\n';
  }
  return out;
}

/* ── Local time per dot ───────────────────────────────────────────────────
   The file cannot re-render itself later, so whatever zone we bake in is what
   the user reads in the field. UT is therefore always shown — unambiguous, and
   correct for every dot. Local time is shown ALONGSIDE it, resolved per dot
   from tz_lookup + Intl, because a path can cross a dozen zones and a single
   offset would be wrong for most of it.
   Pre-1900 we do not pretend: tzdb carries local-mean-time for those dates,
   which is not what anyone means by "local time", so we fall back to the
   longitude's mean solar offset and SAY so in the label. */
function _kmzLocalOffset(lat, lon, entry) {
  if (entry.year < 1900 || typeof tzlookup !== 'function') {
    return { off: Math.round(lon / 15 * 60) / 60, label: 'LMT' };
  }
  try {
    var zone = tzlookup(lat, lon);
    var d = new Date(Date.UTC(entry.year, entry.month - 1, entry.day, 12, 0, 0));
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
    var p = {}, parts = dtf.formatToParts(d);
    for (var i = 0; i < parts.length; i++) p[parts[i].type] = parts[i].value;
    var asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    return { off: Math.round((asUTC - d.getTime()) / 60000) / 60, label: zone };
  } catch (e) {
    return { off: Math.round(lon / 15 * 60) / 60, label: 'LMT' };
  }
}

function _kmzOffStr(off) {
  var s = off < 0 ? '\u2212' : '+', a = Math.abs(off);
  var h = Math.floor(a), m = Math.round((a - h) * 60);
  return 'UTC' + s + pad(h) + ':' + pad(m);
}

/* ── Balloon ──────────────────────────────────────────────────────────── */

function _kmzBalloon(r, lat, lon, entry, appUrl) {
  var z = _kmzLocalOffset(lat, lon, entry);
  var rows = [
    ['C1  first contact', r.C1],
    ['C2  totality begins', r.C2],
    ['Max', null],
    ['C3  totality ends', r.C3],
    ['C4  last contact', r.C4]
  ];
  var html = '<![CDATA['
    + '<div style="font:13px/1.5 sans-serif">'
    + '<b>' + _kmzEsc(fmtDate(entry)) + '</b><br>'
    + _kmzEsc(lat.toFixed(4)) + ', ' + _kmzEsc(lon.toFixed(4)) + '<br><br>'
    + '<table cellpadding="3" style="border-collapse:collapse">'
    + '<tr><th align="left"></th><th align="left">UT</th>'
    + '<th align="left">' + _kmzEsc(z.label) + '</th></tr>';

  for (var i = 0; i < rows.length; i++) {
    var label = rows[i][0], c = rows[i][1];
    var ut = c ? c.ut : r.tMax;
    if (ut === null || ut === undefined) continue;
    html += '<tr><td>' + label + '</td><td>' + fmtUT(ut) + '</td><td>'
          + fmtUT(ut + z.off) + '</td></tr>';
  }
  html += '</table><br>'
    + (r.durCentral ? '<b>Duration ' + fmtDur(r.durCentral) + '</b><br>' : '')
    + 'Sun ' + fmtAng(r.sun.alt) + ' altitude, ' + fmtAng(r.sun.az) + ' azimuth<br>'
    + 'Obscuration ' + (r.osc != null ? r.osc.toFixed(1) : '--') + '%<br>'
    + '<small>' + _kmzEsc(z.label) + ' ' + _kmzOffStr(z.off)
    + (z.label === 'LMT' ? ' (mean solar time \u2014 no zone data this far back)' : '')
    + '</small><br><br>'
    + '<a href="' + appUrl + '">Open this spot in ShadowChaser</a>'
    + '</div>]]>';
  return html;
}

/* ── Assembly ─────────────────────────────────────────────────────────── */

function _kmzFilename(entry) {
  var t = typeCode(entry.eclipse_type);            /* T/A/H/P from 19 variants */
  var y = entry.year < 0 ? 'bce' + pad(Math.abs(entry.year)) : String(entry.year);
  while (y.length < 4 && entry.year >= 0) y = '0' + y;
  return y + pad(entry.month) + pad(entry.day) + '_' + t + 'SE.kmz';
}

function _kmzDoc(entry, ep, rec, appBase) {
  var name = fmtDate(entry) + ' \u2014 ' + typeName(entry.eclipse_type);
  var kml =
    '<?xml version="1.0" encoding="UTF-8"?>\n'
  + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n'
  + '<name>' + _kmzEsc(name) + '</name>\n'
  /* ORANGE THROUGHOUT. Blue and green vanished against terrain and ocean in
     Google Earth, which renders its own basemap under these lines — nothing
     like the app's dark globe. Orange survives both. The families are separated
     by WIDTH and ALPHA instead of hue, since hue is now spent:
       centreline  2.6  opaque      — the thing you navigate to
       umbra       1.8  opaque red  — the only non-orange, it bounds totality
       penumbra    1.3  ~80%        — outer limits, present but recessive
       horizon     1.5  opaque      — sunrise/sunset maximum */
  + '<Style id="centre"><LineStyle><color>ff0080ff</color><width>2.6</width></LineStyle></Style>\n'
  + '<Style id="umbra"><LineStyle><color>ff2020e0</color><width>1.8</width></LineStyle></Style>\n'
  + '<Style id="penumbra"><LineStyle><color>cc40a0ff</color><width>1.3</width></LineStyle></Style>\n'
  + '<Style id="horizon"><LineStyle><color>ff30b0ff</color><width>1.5</width></LineStyle></Style>\n'
  + '<Style id="oval"><LineStyle><color>ff00ffff</color><width>1.1</width></LineStyle></Style>\n'
  /* hotSpot 0.5/0.5 on BOTH marker styles. Google Earth anchors a custom icon
     at its BOTTOM CENTRE by default — correct for a pushpin whose tip is the
     point, wrong for a symmetrical diamond, which then floats half its height
     above the centreline it is supposed to sit on. */
  + '<Style id="dot"><IconStyle><scale>0.5</scale><color>ff0080ff</color>'
  + '<Icon><href>files/diamond.png</href></Icon>'
  + '<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle>'
  + '<LabelStyle><scale>0</scale></LabelStyle></Style>\n'
  + '<Style id="ge"><IconStyle><scale>1.0</scale><color>ff2020e0</color>'
  + '<Icon><href>files/diamond.png</href></Icon>'
  + '<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle></Style>\n';

  /* Path first in the tree: it is what the file is for. */
  kml += '<Folder><name>Central path</name>\n'
      +  _kmzLines(ep.centreline,  'centre',   'Centreline')
      +  _kmzLines(ep.umbra_n,     'umbra',    'Umbra north limit')
      +  _kmzLines(ep.umbra_s,     'umbra',    'Umbra south limit')
      +  '</Folder>\n';

  /* Penumbra and terminator limits: where a partial eclipse is visible at all,
     and where it is cut by sunrise/sunset. Any of these can be absent — 1961
     has no penumbra_n and no terminator_last — and _kmzLines emits nothing for
     an empty key rather than an empty folder entry. */
  kml += '<Folder><name>Penumbral &amp; terminator limits</name>\n'
      +  _kmzLines(ep.penumbra_n,       'penumbra', 'Penumbra north limit')
      +  _kmzLines(ep.penumbra_s,       'penumbra', 'Penumbra south limit')
      +  _kmzLines(ep.terminator_first, 'penumbra', 'Eclipse begins at sunrise/sunset')
      +  _kmzLines(ep.terminator_last,  'penumbra', 'Eclipse ends at sunrise/sunset')
      +  '</Folder>\n';

  /* Maximum eclipse on the horizon — the green curve. Flat list with null
     delimiters; _kmzNormSegs handles the shape. */
  var horizon = _kmzLines(ep.green_curve, 'horizon', 'Maximum eclipse at sunrise/sunset');
  if (horizon) kml += '<Folder><name>Maximum on the horizon</name>\n' + horizon + '</Folder>\n';

  /* The umbra's own footprint at intervals — the shadow itself, rather than the
     track it sweeps. Collapsed: it clutters the path at low zoom. */
  var ovals = _kmzLines(ep.umbra_ovals, 'oval', 'Umbra outline');
  if (ovals) kml += '<Folder><name>Shadow footprints</name><open>0</open>\n' + ovals + '</Folder>\n';

  /* Circumstances: one dot per KMZ_DOT_KM along the centreline, each carrying
     its own precomputed contact times. This is the whole point of the file. */
  var dots = '', count = 0;
  if (ep.centreline && rec) {
    var acc = KMZ_DOT_KM;                 /* emit at the first vertex too */
    var prev = null;
    for (var s = 0; s < ep.centreline.length; s++) {
      var seg = ep.centreline[s];
      for (var i = 0; i < seg.length; i++) {
        var p = seg[i];
        if (prev) acc += _kmzHaversineKm(prev, p);
        prev = p;
        if (acc < KMZ_DOT_KM) continue;
        acc = 0;
        var r;
        try { r = computeEclipse(rec, p[1], p[0], 0); } catch (e) { continue; }
        if (!r || !r.visible) continue;
        var url = appBase + '#e=' + Math.round(entry.cat_no)
                + '&amp;q=' + encodeURIComponent(entry.year + ' ('
                + p[1].toFixed(5) + ', ' + p[0].toFixed(5) + ')');
        dots += '<Placemark><name>' + fmtUT(r.tMax) + ' UT</name>'
             +  '<styleUrl>#dot</styleUrl>'
             +  '<description>' + _kmzBalloon(r, p[1], p[0], entry, url) + '</description>'
             +  '<Point><coordinates>' + p[0] + ',' + p[1] + ',0</coordinates></Point>'
             +  '</Placemark>\n';
        count++;
      }
    }
  }
  kml += '<Folder><name>Circumstances (' + count + ' points)</name>\n' + dots + '</Folder>\n';

  if (ep.ge && ep.ge[0] != null) {
    var geBalloon = '';
    if (rec) {
      try {
        var gr = computeEclipse(rec, ep.ge[1], ep.ge[0], 0);
        if (gr && gr.visible) {
          geBalloon = '<description>'
            + _kmzBalloon(gr, ep.ge[1], ep.ge[0], entry,
                appBase + '#e=' + Math.round(entry.cat_no) + '&amp;q='
                + encodeURIComponent(entry.year + ' (' + ep.ge[1].toFixed(5)
                + ', ' + ep.ge[0].toFixed(5) + ')'))
            + '</description>';
        }
      } catch (e) {}
    }
    kml += '<Folder><name>Greatest eclipse</name>'
        +  '<Placemark><name>Greatest eclipse</name><styleUrl>#ge</styleUrl>'
        +  geBalloon
        +  '<Point><coordinates>'
        +  ep.ge[0] + ',' + ep.ge[1] + ',0</coordinates></Point></Placemark></Folder>\n';
  }


  return kml + '</Document></kml>\n';
}

/* ── Entry point (button) ─────────────────────────────────────────────── */

function downloadKmz() {
  if (_kmzBusy || !selectedEntry) return;
  var entry = selectedEntry;
  _kmzBusy = true;
  if (window.scLoading) window.scLoading(1);

  var appBase = location.origin + location.pathname;

  Promise.all([loadPathChunk(entry), loadChunk(entry._chunk)]).then(function (res) {
    var pathData = res[0], chunk = res[1];
    var ep = pathData && pathData[String(Math.round(entry.cat_no))];
    if (!ep) throw new Error('path data unavailable');

    var rec = null;
    for (var i = 0; i < chunk.length; i++) {
      if (chunk[i].year === entry.year && chunk[i].month === entry.month
       && chunk[i].day === entry.day) { rec = chunk[i]; break; }
    }

    var kml = _kmzDoc(entry, ep, rec, appBase);
    return _zipFiles([
      { name: 'doc.kml',          bytes: new TextEncoder().encode(kml) },
      { name: 'files/diamond.png', bytes: _b64ToBytes(KMZ_DIAMOND_B64) }
    ]);
  }).then(function (blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = _kmzFilename(entry);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* Revoking immediately can cancel the download in some browsers. */
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }).catch(function (err) {
    console.error('KMZ export failed', err);
    if (typeof setStatus === 'function') setStatus('Could not build KMZ \u2014 ' + err.message, true);
  }).then(function () {
    _kmzBusy = false;
    if (window.scLoading) window.scLoading(-1);
  });
}

if (typeof module === 'object' && module.exports) {
  module.exports = { _crc32: _crc32, _kmzHaversineKm: _kmzHaversineKm };
}
