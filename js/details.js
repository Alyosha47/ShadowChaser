/* ── Render inline data panel ────────────────────────────────────────── */

function buildContactRows(rec, res, lbl, tz) {
  var contactRows = contactRow('C1 \u2014 Partial begins',     res.C1, '')
    + contactRow('C2 \u2014 ' + lbl + ' begins', res.C2, 'row-umbral')
    + '<tr class="row-max"><td>Maximum eclipse</td>'
    + '<td>' + fmtUT(res.tMax)        + '</td>'
    + '<td>' + fmtLocal(res.tMax, tz) + '</td>'
    + '<td>' + fmtAng(res.sun.alt)    + '</td>'
    + '<td>' + fmtAng(res.sun.az)     + '</td></tr>'
    + contactRow('C3 \u2014 ' + lbl + ' ends',  res.C3, 'row-umbral')
    + contactRow('C4 \u2014 Partial ends',        res.C4, '');

  if (!rec) return contactRows;
  var c = parseCoords();
  if (!c) return contactRows;

  var dT_s = rec.dt;
  var lonW = -c.lon;
  var alt  = _lookedUpAlt || 0;
  var ss   = computeSunriseSunset(rec, c.lat, c.lon, alt);

  function toUT(t) { return t !== null ? rec.t0 + t - dT_s / 3600 : null; }
  function horizonRow(label, t, ut) {
    if (ut === null) return '';
    var az = sunAltAz(fundamentalArgs(rec, t, c.lat, lonW, alt, dT_s), c.lat).az;
    return '<tr><td>' + label + '</td>'
      + '<td>' + fmtUT(ut)        + '</td>'
      + '<td>' + fmtLocal(ut, tz) + '</td>'
      + '<td>0\u00b0</td>'
      + '<td>' + fmtAng(az)       + '</td></tr>';
  }

  return horizonRow('Sunrise', ss.rise, toUT(ss.rise))
    + contactRows
    + horizonRow('Sunset', ss.set, toUT(ss.set));
}

function renderData(rec, _tz, _lat, _lon) {
  var panel = document.getElementById('data-panel');
  var inner = document.getElementById('data-inner');
  var tz    = getTzOffset();
  var tzStr = tz >= 0 ? 'UTC+' + tz : 'UTC' + tz;

  if (!selectedEntry) {
    inner.innerHTML = '';
    updateEclipseTabState();
    return;
  }

  updateEclipseTabState();

  var typeCode  = (selectedEntry.eclipse_type||'P')[0].toLowerCase();
  var typeLabel = typeName((selectedEntry.eclipse_type||'P')[0]);

  /* ΔT — use besselian chunk values when loaded (after computeLocal),
     fall back to formula for display before a location is set.
     dt_source comes from the chunk; formula fallback labels by year range. */
  function dtSourceFallback(year) {
    if (year > 2050)  return 'SMH\u202f2016 LOD extrapolation';
    if (year >= -720) return 'Espenak\u2013Meeus';
    return 'SMH\u202f2016 LOD (ancient)';
  }
  function formulaDt(year) {
    var t, u;
    if (year > 2050 || year < -720) { t=(year-2000)/100; return 8.37+153.25*t+32*t*t; }
    if (year >= 2010) { t=year-2000; return 62.92+0.32217*t+0.005589*t*t; }
    if (year >= 1986) { t=year-2000; return 63.86+0.3345*t-0.060374*t*t+0.0017275*Math.pow(t,3)+0.000651814*Math.pow(t,4)+0.00002373599*Math.pow(t,5); }
    if (year >= 1961) { t=year-1975; return 45.45+1.067*t-t*t/260-Math.pow(t,3)/718; }
    if (year >= 1941) { t=year-1950; return 29.07+0.407*t-t*t/233+Math.pow(t,3)/2547; }
    if (year >= 1920) { t=year-1920; return 21.20+0.84493*t-0.076100*t*t+0.0020936*Math.pow(t,3); }
    if (year >= 1900) { t=year-1900; return -2.79+1.494119*t-0.0598939*t*t+0.0061966*Math.pow(t,3)-0.000197*Math.pow(t,4); }
    if (year >= 1860) { t=year-1860; return 7.62+0.5737*t-0.251754*t*t+0.01680668*Math.pow(t,3)-0.0004473624*Math.pow(t,4)+Math.pow(t,5)/233174; }
    if (year >= 1800) { t=year-1800; return 13.72-0.332447*t+0.0068612*t*t+0.0041116*Math.pow(t,3)-0.00037436*Math.pow(t,4)+0.0000121272*Math.pow(t,5)-0.0000001699*Math.pow(t,6)+0.000000000875*Math.pow(t,7); }
    if (year >= 1700) { t=year-1700; return 8.83+0.1603*t-0.0059285*t*t+0.00013336*Math.pow(t,3)-Math.pow(t,4)/1174000; }
    if (year >= 1620) { t=year-1600; return 120.0-0.9808*t-0.01532*t*t+Math.pow(t,3)/7129; }
    if (year >= 500)  { u=(year-1000)/100; return 1574.2-556.01*u+71.23472*u*u+0.319781*Math.pow(u,3)-0.8503463*Math.pow(u,4)-0.005050998*Math.pow(u,5)+0.0083572073*Math.pow(u,6); }
    u=year/100; return 10583.6-1014.41*u+33.78311*u*u-5.952053*Math.pow(u,3)-0.1798452*Math.pow(u,4)+0.022174192*Math.pow(u,5)+0.0090316521*Math.pow(u,6);
  }
  var dtVal    = rec && rec.dt     != null ? rec.dt              : formulaDt(selectedEntry.year);
  var dtSrc    = rec && rec.dt_source      ? rec.dt_source       : dtSourceFallback(selectedEntry.year);
  var dtCell   = dataCell('\u0394T', dtVal.toFixed(1) + '\u2009s<div style="font-size:0.62rem;color:var(--text-dim);margin-top:0.15rem;font-family:var(--mono)">' + dtSrc + '</div>');

  var html = ''

  + '<div class="detail-title">' + fmtDate(selectedEntry) + '<span class="detail-title-type">' + typeLabel + '</span>'
  + '<button class="share-btn" onclick="shareEclipse()">&#x2197; Share</button>'
  + '</div>'

  + '<div class="top-section-header">Global Circumstances</div>'
  + '<div class="data-grid">'
  + dataCell('Eclipse type',           typeLabel)
  + dataCell('Greatest eclipse (UT)', selectedEntry.td_ge || '--')
  + dataCell('GE location',           coordStr(selectedEntry.lat_dd_ge, selectedEntry.lng_dd_ge))
  + dataCell('Sun altitude at GE',    fmtAng(selectedEntry.sun_alt))
  + dataCell('Sun azimuth at GE',     fmtAng(selectedEntry.sun_azm))
  + dataCell('Eclipse magnitude',     selectedEntry.magnitude != null ? selectedEntry.magnitude.toFixed(4) : '--', true)
  + dataCell('Gamma',                 selectedEntry.gamma     != null ? selectedEntry.gamma.toFixed(4)     : '--')
  + (selectedEntry.path_width      ? dataCell('Path width',        selectedEntry.path_width.toFixed(0) + '\u2009km') : '')
  + (selectedEntry.central_duration? dataCell('Central duration',  selectedEntry.central_duration, true) : '')
  + dataCell('Saros', selectedEntry.saros
               + (selectedEntry.nSeq && selectedEntry.nSer
                  ? ': ' + selectedEntry.nSeq + '/' + selectedEntry.nSer : ''))
  + dtCell
  + '</div>';

  /* ── Local Circumstances ─────────────────────────────────────────
     The header itself carries the coords/alt/tz so the readout takes
     one line less and the location is unambiguous at a glance. */
  var coords = parseCoords();
  var f      = parseSearch(document.getElementById('search').value);
  var alt    = _lookedUpAlt || 0;
  var locLine = coords
    ? (coords.lat >= 0 ? coords.lat.toFixed(4)+'\u00b0N' : Math.abs(coords.lat).toFixed(4)+'\u00b0S')
      + '\u2002' + (coords.lon >= 0 ? coords.lon.toFixed(4)+'\u00b0E' : Math.abs(coords.lon).toFixed(4)+'\u00b0W')
      + (alt > 0 ? '\u2002\u00b7\u2002' + alt + '\u2009m' : '')
      + '\u2002\u00b7\u2002' + tzStr
    : '';

  html += '<div class="local-section">';
  html += '<div class="top-section-header">'
        +   'Local Circumstances'
        +   (locLine ? '<span class="header-coords">@ ' + locLine + '</span>' : '')
        + '</div>';

  if (!coords) {
    html += '<div class="no-location">Enter coordinates in the search field, or tap the map to choose a location.</div>';
  } else if (!localResult) {
    html += '<div class="no-location">Computing\u2026</div>';
  } else if (!localResult.visible) {
    html += '<div class="no-eclipse">'
          + '<div style="font-size:1.5rem;margin-bottom:.35rem">\uD83C\uDF11</div>'
          + 'Not visible from this location.'
          + '</div>';
  } else {
    var res = localResult;
    var lbl = typeName(res.type[0].toUpperCase());

    html +=
      '<div class="data-grid">'
    + dataCell('Magnitude',           res.mag.toFixed(4), true)
    + dataCell('Obscuration',         res.osc.toFixed(1) + '%', true)
    + dataCell('Sun altitude at max', fmtAng(res.sun.alt))
    + dataCell('Sun azimuth at max',  fmtAng(res.sun.az))
    + (res.durCentral ? dataCell('Duration (' + lbl.toLowerCase() + ')', fmtDur(res.durCentral), true) : '')
    + (res.durPartial ? dataCell('Partial duration', fmtDur(res.durPartial)) : '')
    + '</div>'

    + '<div class="subsection-header" style="margin-top:0.75rem">Contact Times</div>'
    + '<table class="contacts-table"><thead><tr>'
    + '<th>Event</th><th>UT</th><th>' + tzStr + '</th><th>Sun alt</th><th>Sun az</th>'
    + '</tr></thead><tbody>'
    + buildContactRows(rec, res, lbl, tz)
    + '</tbody></table>'

    + (rec ? '<div class="note">No lunar limb correction applied.</div>' : '');


  }

  html += '</div>';
  inner.innerHTML = html;
}


function dataCell(label, value, large) {
  return '<div class="data-cell">'
    + '<div class="data-cell-label">' + label + '</div>'
    + '<div class="data-cell-value' + (large ? ' large' : '') + '">' + value + '</div>'
    + '</div>';
}

function contactRow(label, c, cls) {
  if (!c || c.ut === null || c.ut === undefined) return '';
  var tz = getTzOffset();
  var s  = c.sun || {};
  return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>'
    + '<td>' + label + '</td>'
    + '<td>' + fmtUT(c.ut) + '</td>'
    + '<td>' + fmtLocal(c.ut, tz) + '</td>'
    + '<td>' + fmtAng(s.alt) + '</td>'
    + '<td>' + fmtAng(s.az)  + '</td>'
    + '</tr>';
}

function coordStr(lat, lon) {
  if (lat == null || lon == null) return '--';
  var ls = lat >= 0 ? lat.toFixed(2)+'\u00b0N' : Math.abs(lat).toFixed(2)+'\u00b0S';
  var ms = lon >= 0 ? lon.toFixed(2)+'\u00b0E' : Math.abs(lon).toFixed(2)+'\u00b0W';
  return ls + ' ' + ms;
}


/* ── Elevation + timezone auto-fill ──────────────────────────────────── */

var _lastLookupCoords = null;

function lookupElevationAndTz(lat, lon) {
  var key = lat.toFixed(3) + ',' + lon.toFixed(3);
  if (key === _lastLookupCoords) return;
  _lastLookupCoords = key;
  _lookedUpAlt = null;   // clear stale altitude from previous location

  /* Timezone — tz_lookup.js (offline, polygon-based, single bundled file) */
  if (typeof tzlookup === 'function') {
    var tzName = tzlookup(lat, lon);
    if (tzName) {
      window._deviceTz = tzName;
      if (selectedEntry && localResult) renderData();
    }
  }

  /* Elevation — Open-Elevation API (online only, silently fails offline).
     Stored on _lookedUpAlt and used as a fallback by local-circumstance
     calculations. Not written to the search string. */
  fetch('https://api.open-elevation.com/api/v1/lookup?locations=' + lat + ',' + lon)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.results || !d.results[0]) return;
      var elev = Math.round(d.results[0].elevation);
      if (elev <= 0) return;
      _lookedUpAlt = elev;
      updateCoordsStatus();
      if (selectedEntry) computeLocal();
    })
    .catch(function () {});
}

