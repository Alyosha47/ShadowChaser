/* ── Render inline data panel ────────────────────────────────────────── */

/* Time-display mode for the contact-times table: 'local' (default) or 'ut'.
   Persisted in localStorage so the user's choice survives reload. */
var _timeMode = (function () {
  try { return localStorage.getItem('sc.timeMode') || 'local'; }
  catch (e) { return 'local'; }
})();
function setTimeMode(m) {
  _timeMode = (m === 'ut') ? 'ut' : 'local';
  try { localStorage.setItem('sc.timeMode', _timeMode); } catch (e) {}
  renderData();
}

function buildContactRows(rec, res, lbl, tz) {
  var type = res.type ? res.type[0].toUpperCase() : 'P';
  var rows = [];
  /* All event times are decimal-hour UT. fmtTime turns them into HH:MM:SS in
     whichever mode is active, with a (±Nd) suffix for events that fall on a
     different calendar day than tMax. */
  var anchor = res.tMax;
  function fmtTime(ut) {
    return _timeMode === 'ut'
      ? fmtUTAnchored(ut, anchor)
      : fmtLocalAnchored(ut, tz, anchor);
  }

  function pushContact(phase, c, cls) {
    if (!c || c.ut === null || c.ut === undefined) return;
    var s = c.sun || {};
    rows.push({ ut: c.ut, html:
        '<tr' + (cls ? ' class="' + cls + '"' : '') + '>'
      + '<td>' + contactIcon(phase, type, c.v) + ' ' + phase + '</td>'
      + '<td>' + fmtTime(c.ut)       + '</td>'
      + '<td>' + fmtAng(s.alt)       + '</td>'
      + '<td>' + fmtAng(s.az)        + '</td>'
      + '</tr>' });
  }

  pushContact('C1', res.C1, '');
  pushContact('C2', res.C2, 'row-umbral');
  rows.push({ ut: res.tMax, html:
      '<tr class="row-max"><td>' + contactIcon('MAX', type, null) + ' MAX</td>'
    + '<td>' + fmtTime(res.tMax)     + '</td>'
    + '<td>' + fmtAng(res.sun.alt)   + '</td>'
    + '<td>' + fmtAng(res.sun.az)    + '</td></tr>' });
  pushContact('C3', res.C3, 'row-umbral');
  pushContact('C4', res.C4, '');

  if (rec) {
    var c = parseCoords();
    if (c) {
      var dT_s = rec.dt;
      var lonW = -c.lon;
      var alt  = _lookedUpAlt || 0;
      var tMaxRel = res.tMax - rec.t0 + dT_s / 3600;
      var ss   = computeSunriseSunset(rec, c.lat, c.lon, alt, tMaxRel);
      function toUT(t) { return t !== null ? rec.t0 + t - dT_s / 3600 : null; }
      function pushHorizon(label, t, ut, rising) {
        if (ut === null) return;
        var az = sunAltAz(fundamentalArgs(rec, t, c.lat, lonW, alt, dT_s), c.lat).az;
        rows.push({ ut: ut, html:
            '<tr><td>' + horizonIcon(rising) + ' ' + label + '</td>'
          + '<td>' + fmtTime(ut)       + '</td>'
          + '<td>0\u00b0</td>'
          + '<td>' + fmtAng(az)        + '</td></tr>' });
      }
      pushHorizon('Rise', ss.rise, toUT(ss.rise), true);
      pushHorizon('Set',  ss.set,  toUT(ss.set),  false);
    }
  }

  rows.sort(function (a, b) { return a.ut - b.ut; });
  return rows.map(function (r) { return r.html; }).join('');
}

function renderData(rec, _tz, _lat, _lon) {
  if (!selectedEntry) return;   /* nothing to render yet (init-time only) */
  /* Fall back to the cached Besselian record for this eclipse — callers
     that re-render without recomputing (pill toggles, URL restore) don't
     need to know about rec, but the contact-times table needs it. */
  if (!rec && typeof _currentRec !== 'undefined') rec = _currentRec;
  var panel = document.getElementById('data-panel');
  var inner = document.getElementById('data-inner');
  var tz    = getTzOffset();
  var tzStr = tz >= 0 ? 'UTC+' + tz : 'UTC' + tz;


  /* ΔT — use besselian chunk values when loaded (after computeLocal),
     fall back to formula for display before a location is set. */
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

  /* ── Local Circumstances ───────────────────────────────────────── */
  var coords = parseCoords();
  var f      = parseSearch(document.getElementById('search').value);
  var alt    = _lookedUpAlt || 0;
  var locLine = coords
    ? (coords.lat >= 0 ? coords.lat.toFixed(4)+'\u00b0N' : Math.abs(coords.lat).toFixed(4)+'\u00b0S')
      + '\u2002' + (coords.lon >= 0 ? coords.lon.toFixed(4)+'\u00b0E' : Math.abs(coords.lon).toFixed(4)+'\u00b0W')
      + (alt > 0 ? '\u2002\u00b7\u2002' + alt + '\u2009m' : '')
      + '\u2002\u00b7\u2002' + tzStr
    : '';

  var typeChar = (selectedEntry.eclipse_type||'P')[0].toUpperCase();
  var titleIcon = eclipseIcon({ type: typeChar, magnitude: selectedEntry.magnitude, size: 32 });

  html = '<div class="detail-title">'
       + '<span class="detail-title-icon">' + titleIcon + '</span>'
       + fmtDate(selectedEntry)
       + '<button class="share-btn" onclick="shareEclipse()">&#x2197; Share</button>'
       + '</div>'

       + '<div class="detail-section-h">Local Circumstances</div>'
       + (locLine ? '<div class="detail-subloc">@ ' + locLine + '</div>' : '');

  if (!coords) {
    html += '<div class="no-location">Enter coordinates in the search field, or tap the map to choose a location.</div>';
  } else if (!localResult) {
    html += '<div class="no-location">Computing\u2026</div>';
  } else if (!localResult.visible) {
    html += '<div class="no-eclipse">\uD83C\uDF11 Not visible from this location.</div>';
  } else {
    var res = localResult;
    var lbl = typeName(res.type[0].toUpperCase());

    html +=
      '<table class="detail-table"><tbody>'
    +   (res.durCentral ? row('Duration (' + lbl.toLowerCase() + ')', fmtDur(res.durCentral)) : '')
    +   (res.durPartial ? row('Partial duration', fmtDur(res.durPartial)) : '')
    +   row('Magnitude',           res.mag.toFixed(4))
    +   row('Obscuration',         res.osc.toFixed(1) + '%')
    +   row('Sun alt / az at max', fmtAng(res.sun.alt) + ' / ' + fmtAng(res.sun.az))
    + '</tbody></table>'

    + '<div class="detail-section-h">Contact Times</div>'
    + '<table class="contacts-table"><thead><tr>'
    + '<th>Event</th>'
    + '<th class="time-mode-toggle" onclick="setTimeMode(\''
    +   (_timeMode === 'ut' ? 'local' : 'ut') + '\')" '
    +   'title="Switch between local time and UT">'
    +   (_timeMode === 'ut' ? 'UT' : 'Local')
    + '</th>'
    + '<th>Alt</th><th>Az</th>'
    + '</tr></thead><tbody>'
    + buildContactRows(rec, res, lbl, tz)
    + '</tbody></table>'
    + '<div class="contacts-note">'
    +   (_timeMode === 'ut'
          ? 'UT shown. Tap header for local. Day offsets in parentheses.'
          : (tz === 0
              ? 'Local time = UT here.'
              : 'Local time (' + tzStr + '). Tap header for UT.'))
    + '</div>'

    + (rec ? '<div class="note">No lunar limb correction applied.</div>' : '');
  }

  /* ── Global Circumstances (reference data — least actionable, so last) ── */
  html += '<div class="detail-section-h">Global Circumstances</div>'
       + '<table class="detail-table"><tbody>'
       +   row('Greatest eclipse (UT)', selectedEntry.td_ge || '--')
       +   row('GE location',           coordStr(selectedEntry.lat_dd_ge, selectedEntry.lng_dd_ge))
       +   row('Sun alt / az at GE',    fmtAng(selectedEntry.sun_alt) + ' / ' + fmtAng(selectedEntry.sun_azm))
       +   row('Magnitude',             selectedEntry.magnitude != null ? selectedEntry.magnitude.toFixed(4) : '--')
       +   (selectedEntry.path_width      ? row('Path width',   selectedEntry.path_width.toFixed(0) + '\u2009km') : '')
       +   (selectedEntry.central_duration? row('Max duration', selectedEntry.central_duration) : '')
       +   row('Saros', selectedEntry.saros
                       + (selectedEntry.nSeq && selectedEntry.nSer
                          ? ': ' + selectedEntry.nSeq + '/' + selectedEntry.nSer : ''))
       +   row('\u0394T', dtVal.toFixed(1) + '\u2009s')
       + '</tbody></table>';

  inner.innerHTML = html;
}


function row(label, value) {
  return '<tr><td class="l">' + label + '</td><td class="v">' + value + '</td></tr>';
}

function contactIcon(phase, type, v) {
  /* Thin wrapper over eclipseIcon for the contact-times table. v is the
     position angle from local zenith, clockwise (Jubier's V convention). */
  return eclipseIcon({ type: type, phase: phase, angle: v, size: 26 });
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
      if (localResult) renderData();
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
      computeLocal();
    })
    .catch(function () {});
}

