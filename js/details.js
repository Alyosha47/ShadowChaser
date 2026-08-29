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
  /* The shadow scrubber shows the same clock, so it flips with us. */
  if (typeof shadowOnTimeModeChange === 'function') shadowOnTimeModeChange();
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
        '<tr' + (cls ? ' class="' + cls + ' ct-row"' : ' class="ct-row"')
      + ' onclick="scOnContactRow(' + c.ut + ')">'
      + '<td>' + contactIcon(phase, type, c.v) + ' ' + phase + '</td>'
      + '<td>' + fmtTime(c.ut)       + '</td>'
      + '<td>' + fmtAng(s.alt)       + '</td>'
      + '<td>' + fmtAng(s.az)        + '</td>'
      + '</tr>' });
  }

  pushContact('C1', res.C1, '');
  pushContact('C2', res.C2, 'row-umbral');
  rows.push({ ut: res.tMax, html:
      '<tr class="row-max ct-row" onclick="scOnContactRow(' + res.tMax + ')"><td>' + contactIcon('MAX', type, null) + ' MAX</td>'
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
      var _t0 = (typeof refT0 === 'function') ? refT0(rec) : rec.t0;
      var tMaxRel = res.tMax - _t0 + dT_s / 3600;
      var ss   = computeSunriseSunset(rec, c.lat, c.lon, alt, tMaxRel);
      function toUT(t) { return t !== null ? _t0 + t - dT_s / 3600 : null; }
      function pushHorizon(label, t, ut, rising) {
        if (ut === null) return;
        var az = sunAltAz(fundamentalArgs(rec, t, c.lat, lonW, alt, dT_s), c.lat).az;
        rows.push({ ut: ut, html:
            '<tr class="ct-row" onclick="scOnContactRow(' + ut + ')"><td>' + horizonIcon(rising) + ' ' + label + '</td>'
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
  /* Per-eclipse browser title — helps tabs, history, and shared-link previews. */
  try {
    var _e = selectedEntry;
    var _iso = _e.year + '-' + String(_e.month).padStart(2, '0') + '-' + String(_e.day).padStart(2, '0');
    var _tc = { T: 'TSE', A: 'ASE', H: 'HSE', P: 'PSE' }[(_e.eclipse_type || 'P')[0]] || 'SE';
    document.title = _tc + ' ' + _iso + ' \u2014 followtheshadow';
  } catch (e) {}
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

  /* The standard share mark (box with an arrow leaving the top) has no Unicode
     codepoint — the old &#x2197; was a plain north-east arrow standing in for
     it. Inline SVG, same approach as the hamburger and person tab icons.
     `currentColor` so it inherits .icon-btn's colour and its hover state. */
  var shareIcon =
    '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor"'
  + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M10 2.7V12.3"/>'
  + '<path d="M6.7 6L10 2.7L13.3 6"/>'
  + '<path d="M6.6 8.5H5a1.4 1.4 0 0 0-1.4 1.4v6.1A1.4 1.4 0 0 0 5 17.4h10a1.4 1.4 0'
  +   ' 0 0 1.4-1.4V9.9A1.4 1.4 0 0 0 15 8.5h-1.6"/>'
  + '</svg>';

  html = '<div class="detail-title">'
       + '<span class="detail-title-icon">' + titleIcon + '</span>'
       + '<span class="detail-title-date">' + fmtDate(selectedEntry) + '</span>'
       + '<span class="detail-actions">'
       +   '<button class="icon-btn" onclick="shareEclipse()"'
       +     ' title="Share this eclipse" aria-label="Share this eclipse">'
       +     shareIcon + '</button>'
       +   (typeof scLogSaveButtonHtml === 'function' ? scLogSaveButtonHtml() : '')
       + '</span>'
       + '</div>'

       + '<div class="detail-section-h">Local Circumstances</div>'
       + (locLine ? '<div class="detail-subloc">@ ' + locLine + '</div>' : '');

  if (!coords) {
    html += '<div class="no-location">Enter coordinates in the search field, or tap the map to choose a location.</div>';
  } else if (!localResult) {
    /* Only surface "Computing…" when the data chunk is genuinely still loading.
       When it's already cached the result lands within the same frame, so the
       text would just flash — skip it then. */
    var _chunkLoading = !(selectedEntry && selectedEntry._chunk
                          && typeof chunkCache !== 'undefined' && chunkCache[selectedEntry._chunk]);
    if (_chunkLoading) {
      html += '<div class="no-location">Computing\u2026</div>';
    }
  } else if (!localResult.visible) {
    html += '<div class="no-eclipse">\uD83C\uDF11 Not visible from here \u2014 the Sun is below the horizon during this eclipse.</div>';
  } else {
    var res = localResult;
    var durType = (res.type === 'hybrid' && res.localPhase) ? res.localPhase : res.type;
    var lbl = typeName(durType[0].toUpperCase());

    /* Order: Summary → Contact Times → Sky Tracker → Global.
       The summary leads because it answers the one question you open the panel
       with — how long, how deep — in five rows. The contact times are what you
       act on once you've decided the eclipse is worth acting on, and the track
       supports them. Global circumstances are reference, so they stay last.

       No heading on the summary: it sits directly beneath "Local Circumstances"
       and the location line, which already name it. It only needed one back
       when it had been pushed down past the contacts and the track, out of
       reach of that heading. If it ever moves again, give it one back. */
    var localSummary =
      '<div class="circs-grid">'
    +   (res.durCentral ? row('Duration (' + lbl.toLowerCase() + ')', fmtDur(res.durCentral)) : '')
    +   (res.durPartial ? row('Partial duration', fmtDur(res.durPartial)) : '')
    +   row('Magnitude',           res.mag.toFixed(4))
    +   row('Obscuration',         res.osc.toFixed(1) + '%')
    +   row('Sun alt / az at max', fmtAng(res.sun.alt) + ' / ' + fmtAng(res.sun.az))
    /* CLEAR SKY, not cloud cover — the inverse of what the climatology stores.
       Every other number in this block is one you want to be HIGH (duration,
       magnitude, obscuration, altitude); a cloud figure would be the only one
       you want low, and mixing the two directions in a column of percentages
       is how a 90% gets read as good news when it means the opposite.
       Filled asynchronously, and last in the block because it is the one row
       that says nothing about the eclipse itself. */
    +   row('Clear sky', '<span id="cloud-odds">\u2026</span>')
    + '</div>';

    html +=
      localSummary
    + '<div class="detail-sub-h">Contact Times</div>'
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
    +   '<span class="tm-switch" onclick="setTimeMode(\''
    +   (_timeMode === 'ut' ? 'local' : 'ut') + '\')">'
    +   (_timeMode === 'ut' ? 'Switch to local time' : 'Switch to UT')
    +   '</span>'
    +   (_timeMode === 'ut'
          ? ''
          : (tz === 0 ? ' \u00b7 local = UT here' : ' \u00b7 local time (' + tzStr + ')'))
    + '</div>'

    + '<div class="detail-sub-h">Sky Tracker</div>'
    + '<div id="suntrack"></div>';
  }

  /* ── Global Circumstances (reference data — least actionable, so last) ── */
  html += '<div class="detail-section-h">Global Circumstances</div>'
       + '<div class="circs-grid">'
       +   row('Greatest eclipse (UT)', selectedEntry.td_ge || '--')
       +   row('GE location',           coordStr(selectedEntry.lat_dd_ge, selectedEntry.lng_dd_ge))
       +   row('Sun alt / az at GE',    fmtAng(selectedEntry.sun_alt) + ' / ' + fmtAng(selectedEntry.sun_azm))
       +   row('Magnitude',             selectedEntry.magnitude != null ? selectedEntry.magnitude.toFixed(4) : '--')
       +   (selectedEntry.path_width      ? row('Path width',   selectedEntry.path_width.toFixed(0) + '\u2009km') : '')
       +   maxDurationRows(selectedEntry)
       +   row('Saros', selectedEntry.saros
                       + (selectedEntry.nSeq && selectedEntry.nSer
                          ? ': ' + selectedEntry.nSeq + '/' + selectedEntry.nSer : ''))
       +   row('\u0394T', dtVal.toFixed(1) + '\u2009s')
       + '</div>';

  inner.innerHTML = html;

  if (coords && localResult && localResult.visible && rec) {
    /* buildSunTrack lives in starmap-ui.js. If that file did not load, say so
       in the panel instead of throwing — an exception here takes out the whole
       Local Circumstances section, which is far more than the diagram. */
    if (typeof buildSunTrack === 'function') {
      buildSunTrack(rec, coords.lat, coords.lon, alt, localResult, tz);
    } else {
      var _st = document.getElementById('suntrack');
      if (_st) _st.innerHTML = '<div class="note">Sky Tracker unavailable '
                             + '(js/starmap-ui.js did not load).</div>';
    }
    fillCloudOdds(coords.lat, coords.lon);
  }
}


/* Fill the "Typical cloud" row once the climatology slices are in.
 *
 * ASYNC because the cloud data is only loaded when something asks for it, and
 * the details panel must render immediately rather than wait on four image
 * decodes. The row shows "…" until this lands, then the figure or an em dash.
 *
 * The number is HISTORICAL AVERAGE CLOUD COVER, not a forecast: this spot, this
 * time of day, this time of year, averaged over the satellite record. For an
 * eclipse in 2085 that is the only kind of answer there is, and for one next
 * month it is still not a forecast — so the label says "typical" and the note
 * says what it is. Overstating this would be the worst thing the row could do:
 * someone books a trip on it.
 *
 * Guarded against a stale fill: the panel can re-render while the slices are
 * loading (tap a different eclipse, move the pin), so the element is looked up
 * AFTER the await and the coordinates are re-checked. Without that, an old
 * request lands on the new panel and quietly shows the wrong place's weather.
 */
function fillCloudOdds(lat, lon) {
  var el = document.getElementById('cloud-odds');
  if (!el) return;
  if (typeof Cloud === 'undefined' || !Cloud.ensureAt) { el.textContent = '\u2013'; return; }

  var want = lat.toFixed(4) + ',' + lon.toFixed(4);
  el.setAttribute('data-for', want);

  Cloud.ensureAt(lon, lat).then(function (v) {
    var now = document.getElementById('cloud-odds');
    if (!now || now.getAttribute('data-for') !== want) return;   /* superseded */
    if (v == null || !isFinite(v)) { now.textContent = '\u2013'; return; }
    /* The climatology stores CLOUD fraction; the row shows its inverse. */
    now.textContent = Math.round((1 - v) * 100) + '%';
    now.title = 'Historically clear sky here at this time of day and year, from '
              + 'the satellite record \u2014 a long-run average, NOT a forecast.';
  }).catch(function () {
    var now = document.getElementById('cloud-odds');
    if (now && now.getAttribute('data-for') === want) now.textContent = '\u2013';
  });
}


/* Espenak's `central_duration` is the duration ON THE CENTRAL LINE. 94 eclipses
   in the catalogue have no central line at all — the shadow axis misses the Earth
   (|gamma| > 1) while the cone's edge still clips the limb — so the field is
   structurally undefined and the canon serialises it as "00m00s". Rendering that
   as a duration is simply wrong: those eclipses DO have totality, sometimes for
   minutes, just nowhere near an axis. (Jubier shows 0 for the same reason: same
   catalogue, same definition.)

   tools/noncentral_durations.py precomputes the real figure into index.json for
   exactly those records. The patch is sparse — a record without the field means
   "use the catalogue value" — so this helper is also the feature detector.

   NOTE: greatest eclipse and greatest DURATION are different points on ordinary
   eclipses too, occasionally by a minute and thousands of km. We don't surface
   that yet; see docs/GREATEST-DURATION.md. Keep this row's label honest about
   which of the two it means. */
function maxDurationRows(e) {
  if (e.max_duration_secs != null) {
    return row('Central line', '\u2013:\u2013\u2013')
         + row('Longest totality', fmtDur(e.max_duration_secs) + ' \u00b7 computed')
         + row('Longest at', coordStr(e.max_duration_lat, e.max_duration_lon));
  }
  return e.central_duration ? row('Max duration', e.central_duration) : '';
}


function row(label, value) {
  return '<div class="circ-row"><span class="l">' + label + '</span><span class="v">' + value + '</span></div>';
}


/* Contact-time row / MAX row click: jump the SUNTRACK slider AND (if terrain
   shadows are on) the shadow time to that instant. Module-level so it exists
   even when the sun-track panel didn't render. */
window.scOnContactRow = function (ut) {
  if (typeof window.sunTrackJump === 'function') window.sunTrackJump(ut);
  if (typeof shadowTimeFromSunTrack === 'function') shadowTimeFromSunTrack(ut);
};

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

  /* Elevation — Open-Elevation API (online only). Skip entirely when offline:
     the request would just fail and surface a network error on map click. The
     tz lookup above is fully local and has already run. */
  if (isOffline()) return;
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

