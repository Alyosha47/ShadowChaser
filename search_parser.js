/**
 * search_parser.js  —  ShadowChaser
 * ──────────────────────────────────────────────────────────────────────────
 * Unified search parser and filter for the eclipse catalogue.
 *
 * SUPPORTED SYNTAX (any combination, any order):
 *
 *   Today:        today         from today's date forward
 *                 today+        same as today
 *
 *   Years:        2026          single year
 *                 2026-2030     year range
 *                 after 2050    open-ended range
 *                 before 1000   open-ended range
 *                 2026 2030     two bare years → treated as range
 *
 *   Months:       apr / april   substring match — any token containing
 *                               a month name or abbreviation
 *
 *   Days:         28            day number (only meaningful with a month)
 *
 *   Saros:        saros 126     requires the word "saros"
 *                 s155          or "s" immediately followed by digits, no space
 *
 *   Types:        total annular hybrid partial   one or more, AND logic
 *
 *   Obscuration:  >50  50+  <50  50-   with or without %
 *
 *   Duration:     >2m  >90s  <3m30s  2m+   central duration only
 *
 *   Coordinates:  (44.858, 0.082)            decimal
 *                 (51°30'26"N, 0°07'40"W)    DMS
 *                 (51 30 26 N, 0 07 40 W)    DMS spaces
 *                 (51d30m26sN, 0d07m40sW)    DMS abbreviated
 *                 (51°30.44'N, 0°7.67'W)     degrees + decimal minutes
 *
 *   Freetext:     anything remaining after token extraction
 *
 * CONFLICT RULES:
 *   - Two years            → treated as year range (min–max)
 *   - Two months           → both included (AND)
 *   - Two types            → both included (AND)
 *   - Two saros numbers    → last wins
 *   - Two coordinate pairs → last wins
 *   - Two obscuration ranges → last wins
 *
 * PUBLIC API:
 *   parseSearch(str)              → filter object
 *   applyFilter(entries, filter)  → filtered array
 *   filterToString(filter)        → canonical search string
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var api = factory();
    root.parseSearch    = api.parseSearch;
    root.applyFilter    = api.applyFilter;
    root.filterToString = api.filterToString;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Month tables ────────────────────────────────────────────────────── */

  var MONTH_NAMES = [
    'january','february','march','april','may','june',
    'july','august','september','october','november','december'
  ];
  var MONTH_ABBR = MONTH_NAMES.map(function (m) { return m.slice(0, 3); });
  var MONTH_DISP = ['','Jan','Feb','Mar','Apr','May','Jun',
                    'Jul','Aug','Sep','Oct','Nov','Dec'];

  /**
   * Substring month match: if token contains a month abbreviation, return
   * that month number (1-12), else null.
   * e.g. 'april' → 4,  'apr' → 4,  'april2026' → 4,  'foo' → null
   */
  function monthNumSubstr(token) {
    var t = token.toLowerCase();
    for (var i = 0; i < MONTH_ABBR.length; i++) {
      if (t.indexOf(MONTH_ABBR[i]) >= 0) return i + 1;
    }
    return null;
  }

  /** Single-letter eclipse type code → full name */
  var TYPE_MAP = { T:'total', A:'annular', H:'hybrid', P:'partial' };


  /* ── DMS coordinate parser ───────────────────────────────────────────── */

  function parseSingleCoord(s) {
    s = s.trim();

    // Decimal with optional ° and hemisphere: -0.1278 or 0.1278W or 49.48°N or 104.01°E
    var dec = s.match(/^([+-]?\d+\.?\d*)\s*°?\s*([NSEW]?)$/i);
    if (dec) {
      var v = parseFloat(dec[1]);
      var h = dec[2].toUpperCase();
      if (h === 'S' || h === 'W') v = -Math.abs(v);
      return isNaN(v) ? null : v;
    }

    // Flexible DMS: deg° min' sec" [NSEW] — spaces optional, sec may be decimal, quote optional
    // Matches: 51°30'26"N  51° 30' 26.00" N  51d30m26sN  023° 08' 09.00" W
    var dms = s.match(/^(\d+)[°d]\s*(\d+)\s*['`\u2019\u02bc]\s*(\d+\.?\d*)\s*[""""\u201d]?\s*([NSEW])$/i);
    if (dms) {
      var val = parseFloat(dms[1]) + parseFloat(dms[2])/60 + parseFloat(dms[3])/3600;
      if (/[SW]/i.test(dms[4])) val = -val;
      return val;
    }

    // Degrees + decimal minutes: 51°30.44'N (with optional spaces)
    var ddm = s.match(/^(\d+)[°d]\s*(\d+\.?\d*)\s*['`\u2019\u02bc]\s*([NSEW])$/i);
    if (ddm) {
      var val = parseFloat(ddm[1]) + parseFloat(ddm[2]) / 60;
      if (/[SW]/i.test(ddm[3])) val = -val;
      return val;
    }

    // DMS abbreviated: 51d30m26sN
    var dms2 = s.match(/^(\d+)d(\d+)m(\d+\.?\d*)s([NSEW])$/i);
    if (dms2) {
      var val = parseFloat(dms2[1]) + parseFloat(dms2[2])/60 + parseFloat(dms2[3])/3600;
      if (/[SW]/i.test(dms2[4])) val = -val;
      return val;
    }

    // DMS spaces: 51 30 26 N
    var dms3 = s.match(/^(\d+)\s+(\d+)\s+(\d+\.?\d*)\s+([NSEW])$/i);
    if (dms3) {
      var val = parseFloat(dms3[1]) + parseFloat(dms3[2])/60 + parseFloat(dms3[3])/3600;
      if (/[SW]/i.test(dms3[4])) val = -val;
      return val;
    }

    return null;
  }

  function parseCoordPair(inner) {
    // Strategy 1: comma-separated (standard)
    var commaIdx = inner.indexOf(',');
    if (commaIdx > 0) {
      var first  = inner.slice(0, commaIdx).trim();
      var second = inner.slice(commaIdx + 1).trim();
      var a = parseSingleCoord(first);
      var b = parseSingleCoord(second);
      if (a !== null && b !== null) {
        // If both have hemisphere letters, use them to assign lat/lon
        var ha = first.match(/[NSEW]/i);
        var hb = second.match(/[NSEW]/i);
        if (ha && hb) {
          var lat, lon;
          if (/[NS]/i.test(ha[0])) { lat=a; lon=b; } else { lat=b; lon=a; }
          if (lat>=-90 && lat<=90 && lon>=-180 && lon<=180) return {lat:lat, lon:lon};
        }
        // No hemisphere letters — assume lat, lon order
        if (a>=-90 && a<=90 && b>=-180 && b<=180) return {lat:a, lon:b};
      }
    }

    // Strategy 2: space-separated pair where each coord ends with a hemisphere letter
    // e.g. "023° 08' 09.00" W 65° 35' 14.61" N"
    var parts = inner.split(/(?<=[NSEW])\s+(?=\d)/i);
    if (parts.length === 2) {
      var a = parseSingleCoord(parts[0].trim());
      var b = parseSingleCoord(parts[1].trim());
      if (a !== null && b !== null) {
        var ha = parts[0].match(/[NSEW]/i);
        var hb = parts[1].match(/[NSEW]/i);
        if (ha && hb) {
          var lat, lon;
          if (/[NS]/i.test(ha[0])) { lat=a; lon=b; } else { lat=b; lon=a; }
          if (lat>=-90 && lat<=90 && lon>=-180 && lon<=180) return {lat:lat, lon:lon};
        }
      }
    }

    return null;
  }


  /* ── Main parser ─────────────────────────────────────────────────────── */

  function parseSearch(str) {
    var now = new Date();
    var filter = {
      text:      '',
      today:     false,  // true when today+ used
      years:     null,
      months:    null,
      days:      null,
      saros:     null,
      types:     null,
      coords:    null,
      obscRange: null
    };

    if (!str || !str.trim()) return filter;

    var s = str;

    /* 1. Coordinates — extract (…) blocks first */
    s = s.replace(/\(([^)]+)\)/g, function (match, inner) {
      var c = parseCoordPair(inner);
      if (c) { filter.coords = c; return ' '; }
      return match;
    });

    /* 2. Duration — must precede altitude (both use 'm') and obscuration (both use '<>')
       Tokens: >2m  >2m30s  >90s  2m+  2m30s+  95s-  <3m30s               */
    s = s.replace(/[<>]\d+m(?:\d+s?)?|\d+m(?:\d+s?)?[+\-]|[<>]\d+s\b|\d+s\b[+\-]/gi, function(tok) {
      /* Parse operator and value */
      var op   = tok[0];
      var hasFront = (op === '<' || op === '>');
      var hasBack  = !hasFront;
      if (hasBack) op = tok[tok.length-1];
      var body = hasFront ? tok.slice(1) : tok.slice(0, -1);
      /* Parse minutes + seconds from body */
      var mm = body.match(/^(\d+)m(?:(\d+)s?)?$/) || body.match(/^(\d+)s$/);
      if (!mm) return tok;
      var secs;
      if (body.match(/s$/i) && !body.match(/m/i)) {
        secs = parseInt(mm[1], 10);
      } else {
        secs = parseInt(mm[1], 10) * 60 + (mm[2] ? parseInt(mm[2], 10) : 0);
      }
      var isMin = (op === '>') || (op === '+');
      filter.durRange = isMin ? {min:secs, max:99999} : {min:0, max:secs};
      return ' ';
    });

    /* 3. Saros */
    s = s.replace(/\bsaros\s+(\d+)\b/gi, function (_, n) {
      filter.saros = parseInt(n, 10); return ' ';
    });
    s = s.replace(/\bs(\d+)\b/gi, function (_, n) {
      filter.saros = parseInt(n, 10); return ' ';
    });

    /* 4. Today / today+ — match the whole token including optional + */
    s = s.replace(/\btoday\+?/gi, function () {
      filter.today = true;
      filter.years = {
        min: now.getFullYear(),
        max: 3000,
        todayMonth: now.getMonth() + 1,
        todayDay:   now.getDate()
      };
      return ' ';
    });

    /* 5. Year ranges — BEFORE obscuration */
    if (!filter.today) {
      s = s.replace(/\bafter\s+(-?\d{1,4})\b/gi, function (_, y) {
        filter.years = { min: parseInt(y, 10), max: 3000 }; return ' ';
      });
      s = s.replace(/\bbefore\s+(-?\d{1,4})\b/gi, function (_, y) {
        filter.years = { min: -1999, max: parseInt(y, 10) }; return ' ';
      });
      s = s.replace(/\b(\d{1,4})-(\d{1,4})\b/g, function (full, a, b) {
        var ya = parseInt(a, 10), yb = parseInt(b, 10);
        if (ya > 31 || yb > 31) {
          filter.years = { min: Math.min(ya, yb), max: Math.max(ya, yb) };
          return ' ';
        }
        return full;
      });
    }

    /* 6. Obscuration */
    s = s.replace(/([<>])(\d+\.?\d*)%?/g, function (_, op, n) {
      var v = parseFloat(n);
      filter.obscRange = op === '>' ? { min: v, max: 100 } : { min: 0, max: v };
      return ' ';
    });
    s = s.replace(/(\d+\.?\d*)%?\s*([+-])/g, function (_, n, op) {
      var v = parseFloat(n);
      filter.obscRange = op === '+' ? { min: v, max: 100 } : { min: 0, max: v };
      return ' ';
    });

    /* 8. Eclipse types — full word or unambiguous prefix (min 2 chars) */
    ['total','annular','hybrid','partial'].forEach(function (t) {
      var re = new RegExp('\\b' + t + '\\b', 'gi');
      if (re.test(s)) {
        filter.types = filter.types || [];
        if (filter.types.indexOf(t) < 0) filter.types.push(t);
        s = s.replace(re, ' ');
        return;
      }
      /* Prefix match: "to" → total, "an" → annular, "hy" → hybrid, "pa" → partial */
      var pre = new RegExp('\\b' + t.slice(0,2) + '[a-z]*\\b', 'gi');
      s = s.replace(pre, function (m) {
        if (t.indexOf(m.toLowerCase()) === 0 && m.length >= 2) {
          filter.types = filter.types || [];
          if (filter.types.indexOf(t) < 0) filter.types.push(t);
          return ' ';
        }
        return m;
      });
    });

    /* 8. Month names — substring match per whitespace-delimited token */
    s = s.replace(/\S+/g, function (token) {
      var n = monthNumSubstr(token);
      if (n !== null) {
        filter.months = filter.months || [];
        if (filter.months.indexOf(n) < 0) filter.months.push(n);
        return ' ';
      }
      return token;
    });

    /* 9. Bare numbers — years and days */
    var yearBuf = [];

    /* BCE/BC → negative astronomical year (10BC → -9); AD/CE → positive.
       Must be before bare-number parsing so "10BC" doesn't partially match. */
    s = s.replace(/\b(\d{1,4})\s*(?:bce?|bc)\b/gi, function (_, n) {
      yearBuf.push(-(parseInt(n, 10) - 1)); return ' ';
    });
    s = s.replace(/\b(\d{1,4})\s*(?:ad|ce)\b/gi, function (_, n) {
      yearBuf.push(parseInt(n, 10)); return ' ';
    });

    /* Negative years: -1500, -500 etc — must be handled before bare positive numbers */
    s = s.replace(/(^|[\s,])(-\d{1,4})\b/g, function (match, pre, n) {
      var v = parseInt(n, 10);
      if (v >= -1999 && v < 0) { yearBuf.push(v); return pre + ' '; }
      return match;
    });

    /* Negative year ranges: -500-2000 or -1000--500 */
    s = s.replace(/(-\d{1,4})-(-?\d{1,4})\b/g, function (match, a, b) {
      var ya = parseInt(a, 10), yb = parseInt(b, 10);
      if (!filter.years) {
        filter.years = { min: Math.min(ya,yb), max: Math.max(ya,yb) };
        return ' ';
      }
      return match;
    });

    s = s.replace(/\b(\d+)\b/g, function (full, n) {
      var v = parseInt(n, 10);
      if (n.length === 4 || (v > 31 && v <= 3000)) {
        yearBuf.push(v);
        return ' ';
      }
      if (v >= 1 && v <= 31) {
        filter.days = filter.days || [];
        if (filter.days.indexOf(v) < 0) filter.days.push(v);
        return ' ';
      }
      return full;
    });

    if (!filter.today) {
      if (yearBuf.length === 1 && !filter.years) {
        var y = yearBuf[0];
        /* A bare positive year matches both CE and BCE equivalents.
           974 CE = astronomical year 974; 974 BCE = astronomical year -973.
           Store both as explicit year values rather than a range. */
        filter.years = y > 0
          ? { min: -(y - 1), max: y, exactPair: true }
          : { min: y, max: y };
      } else if (yearBuf.length >= 2 && !filter.years) {
        filter.years = {
          min: Math.min.apply(null, yearBuf),
          max: Math.max.apply(null, yearBuf)
        };
      }
    }

    if (!filter.months) filter.days = null;

    /* 10. Remaining → freetext */
    filter.text = s.replace(/\s+/g, ' ').trim();

    return filter;
  }


  /* ── Filter application ──────────────────────────────────────────────── */

  function applyFilter(entries, filter) {
    var now = new Date();
    return entries.filter(function (e) {

      /* Year / today */
      if (filter.years) {
        if (filter.years.exactPair) {
          /* Single bare positive year typed — match CE year and BCE equivalent only */
          if (e.year !== filter.years.max && e.year !== filter.years.min) return false;
        } else {
          if (e.year < filter.years.min || e.year > filter.years.max) return false;
        }
        /* today+ : also exclude past dates within the current year */
        if (filter.today && filter.years.todayMonth) {
          if (e.year === filter.years.min) {
            if (e.month < filter.years.todayMonth) return false;
            if (e.month === filter.years.todayMonth &&
                e.day   <  filter.years.todayDay) return false;
          }
        }
      }

      /* Month */
      if (filter.months && filter.months.length) {
        if (filter.months.indexOf(e.month) < 0) return false;
      }

      /* Day */
      if (filter.days && filter.days.length && filter.months && filter.months.length) {
        if (filter.days.indexOf(e.day) < 0) return false;
      }

      /* Saros */
      if (filter.saros !== null) {
        if (e.saros !== filter.saros) return false;
      }

      /* Type — eclipse_type can be a single letter (T/A/H/P) or a subtype
         like Tm, As, H3, Pb. Classify by the first character. */
      if (filter.types && filter.types.length) {
        var raw  = e.local_type || e.eclipse_type || '';
        var full = TYPE_MAP[raw.charAt(0).toUpperCase()] || raw.toLowerCase();
        if (filter.types.indexOf(full) < 0) return false;
      }

      /* Duration (central duration only — partials have dur=0 or null) */
      if (filter.durRange) {
        var dur = e.local_dur != null ? e.local_dur
                : e.duration_secs != null ? e.duration_secs : null;
        if (!dur || dur <= 0) {
          if (filter.durRange.min > 0) return false;
        } else {
          if (dur < filter.durRange.min || dur > filter.durRange.max) return false;
        }
      }

      /* Obscuration */
      if (filter.obscRange) {
        var mag = e.local_mag != null ? e.local_mag
                : e.magnitude   != null ? e.magnitude : null;
        if (mag === null) return false;
        var osc = mag >= 1 ? 100
                : Math.round((Math.acos(1 - 2*mag) - Math.sin(Math.acos(1 - 2*mag))) / Math.PI * 100);
        if (osc < filter.obscRange.min || osc > filter.obscRange.max) return false;
      }

      /* Freetext */
      if (filter.text) {
        var term    = filter.text.toLowerCase();
        var dateStr = (MONTH_DISP[e.month] + ' ' + e.day + ' ' + e.year).toLowerCase();
        if (dateStr.indexOf(term) < 0 &&
            String(e.year).indexOf(term) < 0 &&
            String(e.saros).indexOf(term) < 0) return false;
      }

      return true;
    });
  }


  /* ── Filter → canonical string ───────────────────────────────────────── */

  function filterToString(filter) {
    var parts = [];

    if (filter.today) {
      parts.push('today+');
    } else if (filter.years) {
      if (filter.years.min === filter.years.max) {
        parts.push(String(filter.years.min));
      } else if (filter.years.min === -1999) {
        parts.push('before ' + filter.years.max);
      } else if (filter.years.max === 3000) {
        parts.push('after ' + filter.years.min);
      } else {
        parts.push(filter.years.min + '-' + filter.years.max);
      }
    }

    if (filter.months && filter.months.length) {
      filter.months.forEach(function (m) { parts.push(MONTH_DISP[m].toLowerCase()); });
    }
    if (filter.days && filter.days.length) {
      filter.days.forEach(function (d) { parts.push(String(d)); });
    }
    if (filter.saros !== null) {
      parts.push('saros ' + filter.saros);
    }
    if (filter.types && filter.types.length) {
      filter.types.forEach(function (t) { parts.push(t); });
    }
    if (filter.durRange) {
      var fmtDurToken = function(secs) {
        var m = Math.floor(secs/60), s = secs % 60;
        return m > 0 ? m + 'm' + (s ? s + 's' : '') : s + 's';
      };
      if (filter.durRange.max === 99999) parts.push('>' + fmtDurToken(filter.durRange.min));
      else                               parts.push('<' + fmtDurToken(filter.durRange.max));
    }

    if (filter.obscRange) {
      if (filter.obscRange.max === 100) {
        parts.push('>' + filter.obscRange.min + '%');
      } else {
        parts.push('<' + filter.obscRange.max + '%');
      }
    }
    if (filter.coords) {
      parts.push('(' + filter.coords.lat.toFixed(5) + ', ' + filter.coords.lon.toFixed(5) + ')');
    }
    if (filter.text) parts.push(filter.text);

    return parts.join(' ');
  }


  /* ── Exports ─────────────────────────────────────────────────────────── */

  return {
    parseSearch:    parseSearch,
    applyFilter:    applyFilter,
    filterToString: filterToString
  };

}));
