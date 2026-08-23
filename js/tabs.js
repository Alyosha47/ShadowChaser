/* ── Tab navigation ──────────────────────────────────────────────────── */

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.tab-panel').forEach(function (p) {
    p.classList.toggle('active', p.id === 'tab-' + name);
  });
  if (name === 'map') onMapTabActivated();
}

document.querySelectorAll('.tab-btn').forEach(function (b) {
  b.addEventListener('click', function () { switchTab(b.dataset.tab); });
});


/* ── Sidebar sub-tab navigation (desktop only) ──────────────────────────
   CSS uses body[data-sidebar-tab] to choose which panel is visible.
   Buttons are present in DOM on all viewports but hidden on mobile. */

function switchSidebarTab(name) {
  sidebarTab = name;
}

AppState.on('sidebarTab', function (name) {
  document.body.setAttribute('data-sidebar-tab', name);
  document.querySelectorAll('.sidebar-tab-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.sidebarTab === name);
  });
});

document.querySelectorAll('.sidebar-tab-btn').forEach(function (b) {
  b.addEventListener('click', function () { switchSidebarTab(b.dataset.sidebarTab); });
});

/* Set initial data attribute (sidebarTab default is 'eclipse'). */
document.body.setAttribute('data-sidebar-tab', sidebarTab);


/* ── Sidebar drag-to-resize (desktop only) ───────────────────────────────
   Sets --sidebar-w on the root element; CSS clamps it (min-width/max-width
   on .sidebar), so the drag math itself doesn't need to enforce the limits
   precisely. Not persisted — resets to the 360px default on reload, by
   design (session-only). */
(function () {
  var handle = document.getElementById('sidebar-resize-handle');
  var sidebar = document.querySelector('.sidebar');
  if (!handle || !sidebar) return;

  var dragging = false;
  var startX, startW;

  var MIN_W = 360, MAX_W = 720;   /* must match .sidebar's min-width/max-width in app.css */

  function onMove(e) {
    if (!dragging) return;
    var dx = startX - e.clientX;   /* handle is on the LEFT edge, so dragging
                                       left (dx > 0) widens the sidebar */
    var w  = startW + dx;
    /* Clamp here, not just in CSS: the handle's own position tracks this var
       directly (see .sidebar-resize-handle in app.css), so if we let the var
       run past the sidebar's rendered min/max, the handle drifts away from
       the edge it's supposed to hug once the sidebar stops growing. */
    if (w < MIN_W) w = MIN_W;
    if (w > MAX_W) w = MAX_W;
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  }
  handle.addEventListener('pointerdown', function (e) {
    dragging = true;
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();
  });
})();


/* ── Timezone selector ───────────────────────────────────────────────── */

/* Compact list of common named zones with their standard UTC offsets (hours).
   Used for display and fallback offset calculation.                        */
var TZ_ZONES = [
  { label: 'Auto (from location)', value: 'auto' },
  { label: 'UTC±0',                value: 'UTC',                    off:  0    },
  { label: 'UTC−12  (IDLW)',       value: 'Etc/GMT+12',             off: -12   },
  { label: 'UTC−11  (SST)',        value: 'Pacific/Pago_Pago',      off: -11   },
  { label: 'UTC−10  (HST)',        value: 'Pacific/Honolulu',       off: -10   },
  { label: 'UTC−9   (AKST)',       value: 'America/Anchorage',      off: -9    },
  { label: 'UTC−8   (PST)',        value: 'America/Los_Angeles',    off: -8    },
  { label: 'UTC−7   (MST)',        value: 'America/Denver',         off: -7    },
  { label: 'UTC−6   (CST)',        value: 'America/Chicago',        off: -6    },
  { label: 'UTC−5   (EST)',        value: 'America/New_York',       off: -5    },
  { label: 'UTC−4   (AST)',        value: 'America/Halifax',        off: -4    },
  { label: 'UTC−3   (BRT)',        value: 'America/Sao_Paulo',      off: -3    },
  { label: 'UTC−2',                value: 'Etc/GMT+2',              off: -2    },
  { label: 'UTC−1   (CVT)',        value: 'Atlantic/Cape_Verde',    off: -1    },
  { label: 'UTC+1   (CET)',        value: 'Europe/Paris',           off:  1    },
  { label: 'UTC+2   (EET)',        value: 'Europe/Helsinki',        off:  2    },
  { label: 'UTC+3   (MSK)',        value: 'Europe/Moscow',          off:  3    },
  { label: 'UTC+3:30 (IRST)',      value: 'Asia/Tehran',            off:  3.5  },
  { label: 'UTC+4   (GST)',        value: 'Asia/Dubai',             off:  4    },
  { label: 'UTC+4:30 (AFT)',       value: 'Asia/Kabul',             off:  4.5  },
  { label: 'UTC+5   (PKT)',        value: 'Asia/Karachi',           off:  5    },
  { label: 'UTC+5:30 (IST)',       value: 'Asia/Kolkata',           off:  5.5  },
  { label: 'UTC+5:45 (NPT)',       value: 'Asia/Kathmandu',         off:  5.75 },
  { label: 'UTC+6   (BST)',        value: 'Asia/Dhaka',             off:  6    },
  { label: 'UTC+6:30 (MMT)',       value: 'Asia/Yangon',            off:  6.5  },
  { label: 'UTC+7   (ICT)',        value: 'Asia/Bangkok',           off:  7    },
  { label: 'UTC+8   (CST)',        value: 'Asia/Shanghai',          off:  8    },
  { label: 'UTC+9   (JST)',        value: 'Asia/Tokyo',             off:  9    },
  { label: 'UTC+9:30 (ACST)',      value: 'Australia/Darwin',       off:  9.5  },
  { label: 'UTC+10  (AEST)',       value: 'Australia/Sydney',       off:  10   },
  { label: 'UTC+11  (SBT)',        value: 'Pacific/Guadalcanal',    off:  11   },
  { label: 'UTC+12  (NZST)',       value: 'Pacific/Auckland',       off:  12   },
  { label: 'UTC+13  (TOT)',        value: 'Pacific/Tongatapu',      off:  13   },
  { label: 'UTC+14  (LINT)',       value: 'Pacific/Kiritimati',     off:  14   },
];

/* THE timezone selection. Formerly a <select id="tz"> in Settings, which the
   contacts-table header already duplicated inline, one tap from the times it
   governs. When the control went, the element stayed on as a hidden value
   holder — a DOM node used as a variable, which is what this is instead.

   'auto' unless a shared link carries #tz=. TZ_ZONES above is still the lookup
   from that value to an offset, and is still what validates one arriving from a
   URL: setTz refuses anything not in the table, so a hand-edited link cannot put
   the app into a zone it cannot resolve. */
var _tzChoice = 'auto';

function getTz()  { return _tzChoice; }
function setTz(v) {
  if (v === 'auto' || TZ_ZONES.some(function (z) { return z.value === v; })) {
    _tzChoice = v;
    return true;
  }
  return false;
}

/** Return UTC offset in decimal hours for the current tz selection */
function getTzOffset() {
  var val = _tzChoice;
  if (val === 'auto') return getAutoTzOffset();
  var zone = TZ_ZONES.find(function (z) { return z.value === val; });
  return zone ? zone.off : 0;
}

/** Derive UTC offset from the device timezone or fallback to longitude */
function getAutoTzOffset() {
  /* If we have a device timezone string, use it */
  if (window._deviceTz) {
    try {
      var now = new Date();
      var fmt = new Intl.DateTimeFormat('en', {
        timeZone: window._deviceTz,
        timeZoneName: 'shortOffset'
      });
      var parts = fmt.formatToParts(now);
      var off = parts.find(function (p) { return p.type === 'timeZoneName'; });
      if (off) {
        var m = off.value.match(/GMT([+-])(\d+)(?::(\d+))?/);
        if (m) {
          var h = parseInt(m[2], 10) * (m[1] === '-' ? -1 : 1);
          var min = m[3] ? parseInt(m[3], 10) / 60 : 0;
          return h + (h < 0 ? -min : min);
        }
      }
    } catch(e) {}
  }
  /* Fallback: estimate from longitude */
  var c = parseCoords();
  if (c) return Math.round((c.lon / 15) * 2) / 2;
  return 0;
}


/* ── Settings sub-sections: scroll the opened one to the top ────────────────
   The groups are native <details>. Opening one lower down collapses nothing, but
   the sections above it keep their height, so the newly-opened panel opens BELOW
   the fold and you land mid-way through it. On open, bring its header to the top
   of the scrolling panel so you start reading at the beginning. */
document.querySelectorAll('#tab-settings details.settings-group').forEach(function (d) {
  d.addEventListener('toggle', function () {
    if (!d.open) return;
    var panel = document.getElementById('tab-settings');
    if (!panel) return;
    /* Wait a frame so the expanded height is laid out before we scroll. scrollIntoView
       on the <summary> is robust regardless of which ancestor actually scrolls — the
       earlier panel.scrollTo() jumped (blinked) because it targeted the wrong box. */
    requestAnimationFrame(function () {
      var hdr = d.querySelector('summary') || d;
      if (hdr.scrollIntoView) hdr.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
});

/* The online basemap picker used to live here, driving a <select> in Settings.
   It now sits on the map itself (top right) as live tile thumbnails — see
   renderBasemapPicker() in js/map.js. _scSetBasemap() is still the single entry
   point for changing basemap, so anything else that needs to should call it. */

/* ── About-text deep links ─────────────────────────────────────────────────
   Links like #e=9408&q=… already apply via the hashchange handler, but the user is
   sitting in Settings/About and sees nothing happen. Jump them to Search (where the
   query and its results are) so the link visibly does something. */
document.addEventListener('click', function (ev) {
  var a = ev.target.closest && ev.target.closest('a[href*="#e="]');
  if (!a) return;
  /* Move the user to the results. Desktop has its OWN sidebar tab system — driving only
     switchTab() left desktop users staring at the About text. */
  setTimeout(function () {
    if (typeof switchTab === 'function') switchTab('search');
    if (typeof switchSidebarTab === 'function') switchSidebarTab('search');
  }, 0);

  /* Recentre the globe only ONCE THE HASH HAS ACTUALLY BEEN APPLIED.
     A setTimeout(0) fires BEFORE the browser's hashchange event, so recentring there ran
     while `selectedEntry` was still the PREVIOUS eclipse — the camera flew to the last
     eclipse while the new path was drawn. That is the "always one step behind" bug.
     Listening for hashchange guarantees the new selection exists first. Our listener is
     registered here, after url.js's, so it runs after restoreFromHash(). */
  window.addEventListener('hashchange', function once() {
    window.removeEventListener('hashchange', once);
    setTimeout(function () { if (window._scRecenter) window._scRecenter(); }, 0);
  });
});

/* ── Install prompt ────────────────────────────────────────────────────────
   Android/Chrome fire `beforeinstallprompt` and can be installed programmatically.
   iOS Safari CANNOT — installation is only possible via the Share sheet, so there we
   show the manual steps rather than a button that would do nothing. */
(function () {
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
  });
  var link = document.getElementById('install-link');
  if (!link) return;
  link.addEventListener('click', function (ev) {
    ev.preventDefault();
    if (deferred) { deferred.prompt(); deferred = null; return; }
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    link.insertAdjacentHTML('afterend', isIOS
      ? '<span class="install-steps"> Tap the Share button, then <em>Add to Home Screen</em>.</span>'
      : '<span class="install-steps"> Open your browser menu and choose <em>Install app</em> / <em>Add to Home screen</em>.</span>');
    link.style.display = 'none';
  });
})();
