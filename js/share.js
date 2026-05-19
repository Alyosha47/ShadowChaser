/* ── Share ───────────────────────────────────────────────────────────── */

function buildShareText() {
  if (!selectedEntry) return '';
  var lines = [];
  var e = selectedEntry;
  var typeLabel = typeName((e.eclipse_type||'P')[0]);

  lines.push('Solar Eclipse — ' + fmtDate(e) + ' (' + typeLabel + ')');
  lines.push('');

  /* Global */
  lines.push('Greatest eclipse: ' + (e.td_ge || '--') + ' UT');
  if (e.lat_dd_ge != null && e.lng_dd_ge != null)
    lines.push('GE location: ' + coordStr(e.lat_dd_ge, e.lng_dd_ge));
  if (e.magnitude != null) lines.push('Magnitude: ' + e.magnitude.toFixed(4));
  if (e.central_duration) lines.push('Central duration: ' + e.central_duration);
  if (e.path_width) lines.push('Path width: ' + e.path_width.toFixed(0) + ' km');

  /* Local */
  var coords = parseCoords();
  if (coords && localResult && localResult.visible) {
    var r = localResult;
    lines.push('');
    lines.push('Local (' + coordStr(coords.lat, coords.lon) + ')');
    lines.push('Type: ' + typeName(r.type[0].toUpperCase()));
    lines.push('Magnitude: ' + r.mag.toFixed(4) + '  Obscuration: ' + r.osc.toFixed(1) + '%');
    if (r.C1) lines.push('C1 (partial begins): ' + fmtUT(r.C1.ut) + ' UT');
    if (r.C2) lines.push('C2 (umbral begins):  ' + fmtUT(r.C2.ut) + ' UT');
    lines.push('Maximum:             ' + fmtUT(r.tMax) + ' UT');
    if (r.C3) lines.push('C3 (umbral ends):    ' + fmtUT(r.C3.ut) + ' UT');
    if (r.C4) lines.push('C4 (partial ends):   ' + fmtUT(r.C4.ut) + ' UT');
  }

  lines.push('');
  lines.push(window.location.href);
  return lines.join('\n');
}

function copyShareText() {
  var text = document.getElementById('share-text').value;
  navigator.clipboard.writeText(text).then(function () {
    var btn = document.querySelector('.share-modal-btns .btn-primary');
    var orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = orig; }, 1500);
  }).catch(function () {});
}

function shareEclipse() {
  var text = buildShareText();

  /* Grab map screenshot */
  var canvas = map && map.getCanvas ? map.getCanvas() : null;
  var imageFile = null;

  function doShare() {
    if (navigator.share) {
      var shareData = { title: 'ShadowChaser', text: text, url: window.location.href };
      if (imageFile) shareData.files = [imageFile];
      navigator.share(shareData).catch(function (err) {
        if (err.name !== 'AbortError') fallbackShare(text);
      });
    } else {
      fallbackShare(text);
    }
  }

  if (canvas) {
    try {
      canvas.toBlob(function (blob) {
        if (blob) {
          imageFile = new File([blob], 'eclipse-path.png', { type: 'image/png' });
          /* Check browser supports sharing files */
          if (navigator.canShare && !navigator.canShare({ files: [imageFile] })) {
            imageFile = null;
          }
        }
        doShare();
      }, 'image/png');
    } catch (e) {
      doShare();
    }
  } else {
    doShare();
  }
}

function fallbackShare(text) {
  document.getElementById('share-text').value = text;
  document.getElementById('share-modal-backdrop').classList.add('open');
}

/* Close modal on backdrop click */
document.getElementById('share-modal-backdrop').addEventListener('click', function (e) {
  if (e.target === this) this.classList.remove('open');
});
