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

function buildTzSelect() {
  document.getElementById('tz').innerHTML = TZ_ZONES.map(function (z) {
    return '<option value="' + z.value + '">' + z.label + '</option>';
  }).join('');
}

/** Return UTC offset in decimal hours for the current tz selection */
function getTzOffset() {
  var sel = document.getElementById('tz');
  var val = sel.value;
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

