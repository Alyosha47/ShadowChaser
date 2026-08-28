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
      var tMaxRel = res.tMax - rec.t0 + dT_s / 3600;
      var ss   = computeSunriseSunset(rec, c.lat, c.lon, alt, tMaxRel);
      function toUT(t) { return t !== null ? rec.t0 + t - dT_s / 3600 : null; }
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

    /* Order: Summary → Contact Times → Sun Track → Global.
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

    + '<div class="detail-sub-h">Sun Track</div>'
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
    buildSunTrack(rec, coords.lat, coords.lon, alt, localResult, tz);
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

/* Interactive sun-track diagram: the Sun's path across the sky (x = azimuth,
   y = altitude) over the eclipse window C1→C4, with a time slider that scrubs
   a Sun marker along the arc and draws the Moon's bite at that instant. Pure
   SVG + one range input; no external deps. */
function buildSunTrack(rec, lat, lon, altM, res, tz) {
  var host = document.getElementById('suntrack');
  if (!host || typeof sampleEclipseAt !== 'function') return;
  if (res.C1 == null || res.C1.ut == null || res.C4 == null || res.C4.ut == null) {
    host.innerHTML = '<div class="note">Sun track unavailable.</div>'; return;
  }

  /* Eclipse window with a small margin so C1/C4 aren't flush at the edges. */
  var t0 = res.C1.ut, t1 = res.C4.ut;
  if (t1 < t0) t1 += 24;                       /* crossed UT midnight */
  var span = t1 - t0, marg = span * 0.06;
  var ta = t0 - marg, tb = t1 + marg;

  /* Sample the arc on a single uniform time grid. Contacts are NOT inserted into
     the curve — mixing a uniform grid with injected contact times produced
     near-coincident points (and a visible kink) on grazers where contacts bunch.
     Contact positions for the marks/slider are computed directly from their UT
     via sampleEclipseAt, independent of the curve sampling. */
  var N = 240;
  var pts = [];
  for (var i = 0; i <= N; i++) {
    var t = ta + (tb - ta) * i / N;
    var s = sampleEclipseAt(rec, lat, lon, altM, t);
    pts.push({ t: t, az: s.az, alt: s.alt, mag: s.mag, sep: s.sep,
               moonRatio: s.moonRatio, v: s.v });
  }
  /* Map a contact UT to its position along the uniform grid (fractional index),
     used to place the slider exactly at a contact without distorting the curve. */
  function indexForUT(ut) {
    if (ut == null) return -1;
    var u = ut; if (u < t0 - 0.001) u += 24;
    var frac = (u - ta) / (tb - ta) * N;
    return Math.max(0, Math.min(N, Math.round(frac)));
  }

  /* Plot extents (pad a little). */
  var azs = pts.map(function (p) { return p.az; });
  var alts = pts.map(function (p) { return p.alt; });
  /* azimuth may wrap through 360; unwrap relative to the first sample */
  var az0 = azs[0];
  var uaz = azs.map(function (a) {
    while (a - az0 >  180) a -= 360;
    while (a - az0 < -180) a += 360;
    return a;
  });
  var minA = Math.min.apply(null, uaz), maxA = Math.max.apply(null, uaz);
  var minH = Math.min(0, Math.min.apply(null, alts));
  var maxH = Math.max.apply(null, alts);
  var padA = Math.max(1, (maxA - minA) * 0.04);
  var padH = Math.max(1, (maxH - minH) * 0.05);
  minA -= padA; maxA += padA; maxH += padH;
  minH = Math.min(minH, 0);

  var W = 320, H = 200, L = 8, R = 8, T = 16, B = 16;
  function px(uazi) { return L + (uazi - minA) / (maxA - minA) * (W - L - R); }
  function py(alti) { return T + (1 - (alti - minH) / (maxH - minH)) * (H - T - B); }

  /* Track polyline (unwrapped azimuth). */
  var d = '';
  for (var j = 0; j < pts.length; j++) {
    d += (j ? 'L' : 'M') + px(uaz[j]).toFixed(1) + ' ' + py(pts[j].alt).toFixed(1) + ' ';
  }

  /* Horizon line (alt = 0) if in view. */
  var horizon = '';
  if (minH <= 0 && maxH >= 0) {
    var hy = py(0);
    horizon = '<line x1="' + L + '" y1="' + hy.toFixed(1) + '" x2="' + (W - R)
            + '" y2="' + hy.toFixed(1) + '" class="st-horizon"/>'
            + '<text x="' + (W - R) + '" y="' + (hy - 3).toFixed(1)
            + '" class="st-hlbl" text-anchor="end">horizon</text>';
  }

  /* Contact tick marks on the track. */
  var marks = '';
  var placed = [];                              /* [{x, side}] to de-collide labels */
  [['C1', res.C1], ['C2', res.C2], ['C3', res.C3], ['C4', res.C4]].forEach(function (c) {
    if (!c[1] || c[1].ut == null) return;
    var k = indexForUT(c[1].ut);
    var mx = px(uaz[k]), my = py(pts[k].alt);
    /* Default label above the point; if another label is within ~16px, put this
       one below instead so C2/C3 (close together) don't overlap. */
    var below = placed.some(function (q) { return Math.abs(q.x - mx) < 16; });
    var ly = below ? my + 13 : my - 7;
    placed.push({ x: mx });
    marks += '<circle cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1)
           + '" r="2.6" class="st-contact"/>'
           + '<text x="' + mx.toFixed(1) + '" y="' + ly.toFixed(1)
           + '" class="st-clbl" text-anchor="middle">' + c[0] + '</text>';
  });

  host.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="st-svg" preserveAspectRatio="xMidYMid meet">'
    +   '<defs><linearGradient id="st-sky" x1="0" y1="0" x2="0" y2="1">'
    +     '<stop id="st-sky0" offset="0%"/><stop id="st-sky1" offset="100%"/>'
    +   '</linearGradient></defs>'
    +   '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="6" fill="url(#st-sky)"/>'
    +   horizon
    +   '<path d="' + d.trim() + '" class="st-track"/>'
    +   marks
    +   '<g id="st-marker"></g>'
    + '</svg>'
    + '<input id="st-slider" type="range" min="0" max="' + N + '" value="' + indexForUT(res.tMax != null ? res.tMax : (t0 + span / 2)) + '" step="1" class="st-slider"/>'
    + '<div id="st-readout" class="st-readout"></div>';

  var slider = document.getElementById('st-slider');
  var marker = document.getElementById('st-marker');
  var readout = document.getElementById('st-readout');
  var sky0 = document.getElementById('st-sky0');
  var sky1 = document.getElementById('st-sky1');

  /* Sky colour as a function of how deep the eclipse is at this instant.
     Uncovered sky is normal daylight; as magnitude rises the sky dims and
     cools, going to deep twilight/near-night at totality — the real
     experience of the light draining out as the Moon covers the Sun.
     Returns [topColor, bottomColor]. */
  function skyColors(mag) {
    function mix(a, b, t) {
      t = Math.max(0, Math.min(1, t));
      return 'rgb(' + Math.round(a[0]+(b[0]-a[0])*t) + ',' + Math.round(a[1]+(b[1]-a[1])*t)
           + ',' + Math.round(a[2]+(b[2]-a[2])*t) + ')';
    }
    var dayTop=[64,132,196],   dayBot=[150,194,224];
    var darkTop=[14,16,34],    darkBot=[34,30,52];
    /* Light falls off slowly then fast near totality (perceptual ~mag^3). */
    var t = Math.pow(Math.max(0, Math.min(1, mag)), 3);
    return [ mix(dayTop, darkTop, t), mix(dayBot, darkBot, t) ];
  }

  function fmtHM(ut) {
    var local = (_timeMode !== 'ut') && (typeof tz === 'number');
    var u = ((ut + (local ? tz : 0)) % 24 + 24) % 24;
    var hh = Math.floor(u), mm = Math.floor((u - hh) * 60);
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
         + (local ? ' local' : ' UT');
  }

  function draw(i) {
    var p = pts[i];
    var cx = px(uaz[i]), cy = py(p.alt), r = 12;
    /* Sky background tracks how deep the eclipse is right now. */
    var sc = skyColors(p.mag);
    sky0.setAttribute('stop-color', sc[0]);
    sky1.setAttribute('stop-color', sc[1]);
    /* Sun disc + Moon bite. The Moon overlaps from direction V (clockwise from
       zenith = up); offset the moon-disc centre by the uncovered fraction so
       the visible crescent matches the magnitude. */
    var sun = '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r + '" class="st-sun"/>';
    /* Moon is always present; its centre sits `sep` sun-radii from the Sun in
       direction V (clockwise from up). sep 0 = concentric (totality), sep 2 =
       discs just touching (C1/C4), sep > 2 = clear of the Sun. So it slides in
       before C1 and out after C4 instead of blinking on/off. */
    var ang = p.v * Math.PI / 180;
    var off = p.sep * r;
    var mx = cx + off * Math.sin(ang);
    var my = cy - off * Math.cos(ang);
    var rMoon = r * (p.moonRatio || 1);            /* <1 annular, >1 total */
    var moon = '<circle cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="' + rMoon.toFixed(1) + '" class="st-moon"/>';
    marker.innerHTML = sun + moon;
    var azDisp = ((p.az % 360) + 360) % 360;
    readout.textContent = fmtHM(p.t)
      + '  \u00b7  alt ' + p.alt.toFixed(1) + '\u00b0'
      + '  \u00b7  az ' + azDisp.toFixed(1) + '\u00b0'
      + (p.mag > 0 ? '  \u00b7  mag ' + p.mag.toFixed(3) : '');
  }

  slider.addEventListener('input', function () {
    var i = parseInt(slider.value, 10);
    draw(i);
    /* Drive terrain shadows from the sun-track slider (no-op if shadows off). */
    if (typeof shadowTimeFromSunTrack === 'function') shadowTimeFromSunTrack(pts[i].t);
  });
  draw(parseInt(slider.value, 10));

  /* Let the contact-time rows jump the slider to a given UT — lands exactly on
     the injected contact datapoint. */
  window.sunTrackJump = function (ut) {
    var k = indexForUT(ut);
    if (k < 0) return;
    slider.value = k;
    draw(k);
    slider.focus();
  };
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

