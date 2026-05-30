/* ── Share ───────────────────────────────────────────────────────────── */

function buildShareUrl() {
  var parts = [];
  if (selectedEntry && selectedEntry.cat_no != null)
    parts.push('e=' + Math.round(selectedEntry.cat_no));
  var coords = parseCoords();
  if (coords)
    parts.push('q=' + encodeURIComponent('(' + coords.lat.toFixed(5) + ',' + coords.lon.toFixed(5) + ')'));
  var tz = document.getElementById('tz').value;
  if (tz !== 'auto') parts.push('tz=' + encodeURIComponent(tz));
  var base = window.location.origin + window.location.pathname;
  return parts.length ? base + '#' + parts.join('&') : base;
}

function buildShareText() {
  var e = selectedEntry;
  var typeLabel = typeName((e.eclipse_type || 'P')[0]);
  var coords = parseCoords();
  var T = '\t';
  var lines = [];

  lines.push(fmtDate(e) + ' \u2014 ' + typeLabel + ' Solar Eclipse');
  lines.push('');
  lines.push('Greatest Eclipse:');
  if (e.central_duration)              lines.push(T + 'Duration:' + T  + e.central_duration);
  if (e.td_ge)                         lines.push(T + 'Time:' + T + T  + e.td_ge + ' UT');
  if (e.lat_dd_ge != null && e.lng_dd_ge != null)
                                       lines.push(T + 'Location:' + T  + coordStr(e.lat_dd_ge, e.lng_dd_ge));
  if (e.magnitude != null)             lines.push(T + 'Magnitude:' + T + e.magnitude.toFixed(4));
  if (e.path_width)                  { lines.push(''); lines.push('Path width:' + T + T + e.path_width.toFixed(0) + ' km'); }

  if (coords && localResult && localResult.visible) {
    var r = localResult;
    lines.push('');
    lines.push('At ' + coordStr(coords.lat, coords.lon) + ':');
    lines.push(T + 'Type:' + T + T        + typeName(r.type[0].toUpperCase()));
    lines.push(T + 'Magnitude:' + T       + r.mag.toFixed(4));
    lines.push(T + 'Obscuration:' + T     + r.osc.toFixed(1) + '%');
    if (r.C1) lines.push(T + 'C1 partial:' + T + fmtUT(r.C1.ut) + ' UT');
    if (r.C2) lines.push(T + 'C2 total:' + T + T + fmtUT(r.C2.ut) + ' UT');
              lines.push(T + 'Maximum:' + T + T   + fmtUT(r.tMax)  + ' UT');
    if (r.C3) lines.push(T + 'C3 total:' + T + T + fmtUT(r.C3.ut) + ' UT');
    if (r.C4) lines.push(T + 'C4 partial:' + T   + fmtUT(r.C4.ut) + ' UT');
  }

  lines.push('');
  lines.push(buildShareUrl());
  lines.push('');
  lines.push('ShadowChaser app by followtheshadow.com');
  return lines.join('\n');
}

function copyShareText() {
  var text = document.getElementById('share-text').value;
  navigator.clipboard.writeText(text).then(function () {
    var btn = document.getElementById('share-copy-btn');
    var orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = orig; }, 1500);
  }).catch(function () {});
}

function shareEclipse() {
  var text = buildShareText();

  if (navigator.share) {
    navigator.share({ text: text }).catch(function (err) {
      if (err.name !== 'AbortError') openFallbackModal(text);
    });
  } else {
    openFallbackModal(text);
  }
}

function openFallbackModal(text) {
  document.getElementById('share-text').value = text;
  document.getElementById('share-modal-backdrop').classList.add('open');
}

/* Close modal on backdrop click */
document.getElementById('share-modal-backdrop').addEventListener('click', function (e) {
  if (e.target === this) this.classList.remove('open');
});
