/* search-countries.js — country search support for ShadowChaser
 * ============================================================================
 *
 * Answers two questions the rest of the app asks:
 *
 *   lookupCountry('chile')        -> { idx, name }  or null
 *   countryOsc(catNo, idx)        -> { osc, central } or null
 *
 * WHY A PRECOMPUTED INDEX AND NOT A LIVE SCAN
 * -------------------------------------------
 * A city is one point, so a search runs the eclipse maths once per eclipse. A
 * country is an AREA and the answer wanted is the best-placed spot anywhere
 * inside it. Measured 2026-08-24 (tools/checks/bench_country.js): live, that
 * cost 24x a city scan for Chile and 354x for Russia — over a minute. Coarse-
 * to-fine sampling did not rescue it, because the coarse pass has to touch
 * every sample point on every eclipse before it can reject anything, so a big
 * country pays its full cost on the misses too.
 *
 * So the work happens offline in "data build tools/gen_country_index.js" and
 * this module reads the result. There is no runtime eclipse maths here at all.
 *
 * THE ENCODING
 * ------------
 *   index[catNo][countryIdx] = obscuration in 5% steps (4..20, so 20 = 100%)
 *   NEGATIVE                 = the CENTRAL PATH crossed this country
 *
 * The sign is separate from the magnitude because obscuration alone cannot
 * tell an ANNULAR path from a very deep partial: an annular peaks near 95% and
 * never reaches 100. Without the sign, `chile annular` would be unanswerable.
 * For a TOTAL the magnitude is lifted to 100% wherever the sign is set, because
 * totality on the central path is 100% by definition — the sampled grid can
 * and does miss narrow corridors (1999-08-11 clipped Cornwall, and sampling
 * only reached 95% for the UK while the exact path test correctly flagged it).
 *
 * A 20% FLOOR is applied at build time: entries below it are dropped. Nobody
 * searches for a 4% eclipse, and it took the file from ~1359 KB to ~650 KB.
 * The consequence to remember is that ABSENT MEANS "under 20%", NOT "invisible".
 *
 * OFFLINE
 * -------
 * The index is precached by sw.js with everything else, deliberately, rather
 * than fetched per country. A per-country fetch is exactly what fails in a
 * field with no signal, which is the situation this app exists for.
 */

var Countries = (function () {
  'use strict';

  var BUCKET = 5;          /* must match the generator; asserted on load */

  var _names   = null;     /* [countryIdx] -> canonical display name       */
  var _alias   = null;     /* 'chile' -> countryIdx, from the basemap file */
  var _index   = null;     /* catNo -> { countryIdx: bucketed obscuration } */
  var _indexLoading = null;
  var _aliasLoading = null;
  var _failed       = false;

  /* ── loading ─────────────────────────────────────────────────────────── */

  /* Aliases come from the basemap outlines map.js ALREADY fetched and parsed
     into basemapData.countries — the same piggyback search-cities.js uses. Fetching
     countries.geojson.gz again here would pull 720 KB twice and hold two
     copies of 241 polygons in memory for nothing.
     Names were attached to that file by "data build tools/name_countries.js";
     before that every feature had EMPTY properties, which is the actual reason
     country search was impossible rather than merely unwritten.
     Built lazily and cached, because the basemap may not have arrived yet. */
  /* If the basemap has not arrived (or never will — the map may fail while the
     LIST still works perfectly well), fetch the outlines directly. The service
     worker has them cached either way, so this is a cache hit, not a second
     download over the network. Country search must not depend on the map
     succeeding: they are different features. */
  function _fetchAliases() {
    if (_aliasLoading) return _aliasLoading;
    var base = (typeof DATA_BASE === 'string') ? DATA_BASE : 'data';
    var url = base + '/basemap/countries.geojson.gz'
            + (typeof BUILD === 'string' ? '?v=' + BUILD : '');
    _aliasLoading = fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('countries.geojson.gz ' + r.status);
        return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
      })
      .then(function (gj) {
        _fromGeoJson(gj);
        if (typeof onSearchChanged === 'function') onSearchChanged(true);
      })
      .catch(function (e) {
        if (window.console) console.warn('country aliases unavailable:', e.message);
      });
    return _aliasLoading;
  }

  function _fromGeoJson(gj) {
    if (!gj || !gj.features) return false;
    var alias = {}, names = [];
    gj.features.forEach(function (f, i) {
      var ns = (f.properties && f.properties.names) || [];
      names[i] = ns[0] || '?';
      ns.forEach(function (n) {
        /* FIRST alias wins. Natural Earth reuses a few short forms across
           dependencies, and silently reassigning would make a country
           unsearchable with no symptom other than wrong results. */
        if (!(n in alias)) alias[n] = i;
      });
    });
    if (!names.length) return false;
    _alias = alias;
    _names = names;
    return true;
  }

  function _buildAliases() {
    if (_alias) return true;
    var gj = (typeof basemapData !== 'undefined' && basemapData) ? basemapData.countries : null;
    if (gj && _fromGeoJson(gj)) return true;
    _fetchAliases();          /* async; the search re-runs when it lands */
    return false;
  }

  function _loadIndex() {
    if (_indexLoading) return _indexLoading;
    var base = (typeof DATA_BASE === 'string') ? DATA_BASE : 'data';
    var url = base + '/country_index.json.gz'
            + (typeof BUILD === 'string' ? '?v=' + BUILD : '');
    /* GUNZIP IT. The file is stored gzipped and served as-is — Bluehost does
       not set Content-Encoding on it — so the browser hands back raw deflate
       bytes and r.json() dies on the first one ("Unexpected token"). Every
       other .gz in the app goes through map.js's fetchGz for exactly this
       reason; the same two lines are repeated here rather than depending on
       map.js having loaded first. */
    _indexLoading = fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('country_index.json.gz ' + r.status);
        return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
      })
      .then(function (d) {
        if (!d || !d.index) throw new Error('country index malformed');
        /* If the generator's bucket size ever changes and this does not, every
           obscuration in the app silently scales wrong. Fail loudly instead. */
        if (d.__meta && d.__meta.bucket && d.__meta.bucket !== BUCKET)
          throw new Error('country index bucket is ' + d.__meta.bucket
                          + ' but search-countries.js expects ' + BUCKET);
        _index = d.index;
        if (!_names && d.names) _names = d.names;
        if (window.console) console.log('country index loaded: '
          + Object.keys(_index).length + ' eclipses');
        /* Do NOT build aliases here. _buildAliases falls back to fetching the
           720 KB outlines when basemapData is absent — and at this point on a
           COLD load it always is, so this raced map.js for the same file and
           downloaded it twice, competing with a 33 MB precache. Aliases are
           built lazily on the first lookup instead, by which time map.js has
           normally supplied them for free. */
        /* The index arrived after the first parse, so a country token in the
           search box could not resolve. Re-run, exactly as map.js does when
           the city list lands. */
        if (typeof onSearchChanged === 'function') onSearchChanged(true);
      })
      .catch(function (e) {
        _failed = true;
        if (window.console) console.warn('country search unavailable:', e.message);
        /* Swallowed on purpose: country search degrades to "no matches", it
           does not take the rest of the search down with it. */
      });
    return _indexLoading;
  }

  function load() { return _loadIndex(); }

  function ready() {
    if (_failed || !_index) return false;
    if (!_alias && !_buildAliases()) return false;
    return true;
  }

  /* ── lookup ──────────────────────────────────────────────────────────── */

  /* Name -> country, or null. Case and spacing insensitive; punctuation is
     stripped so 'U.S.A.' and 'USA' both land. */
  function lookupCountry(name) {
    if (!name) return null;
    if (!_alias && !_buildAliases()) return null;   /* basemap not loaded yet */
    var k = String(name).toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
    if (!(k in _alias)) return null;
    var i = _alias[k];
    return { idx: i, name: _names[i] };
  }

  /* What did this country get from this eclipse?
       { osc: 0..100, central: bool }   or null if under the 20% floor.
     REMEMBER: null means "under 20%", not "not visible". */
  function countryOsc(catNo, idx) {
    if (!_index) return null;
    var row = _index[String(catNo)];
    if (!row) return null;
    var v = row[String(idx)];
    if (v === undefined) return null;
    return { osc: Math.abs(v) * BUCKET, central: v < 0 };
  }

  /* The local TYPE for a country, mirroring what local.js derives for a point.
     A country is on the central path or it is not; if it is, it sees the
     eclipse's own central type, and if it is not, it sees a partial however
     deep. `raw` is the catalogue eclipse_type. */
  function countryType(catNo, idx, raw) {
    var r = countryOsc(catNo, idx);
    if (!r) return null;
    if (!r.central) return 'Partial';
    var c = String(raw || '').charAt(0);
    if (c === 'T') return 'Total';
    if (c === 'A') return 'Annular';
    if (c === 'H') return 'Hybrid';
    return 'Partial';
  }

  return {
    load: load,
    ready: ready,
    lookupCountry: lookupCountry,
    countryOsc: countryOsc,
    countryType: countryType,
    nameOf: function (i) { return _names ? _names[i] : null; }
  };
})();

/* Global shims, matching how lookupCity is reached from the parser. */
function lookupCountry(n) { return Countries.lookupCountry(n); }

/* Start the fetch after the page is UP, not while it is loading.

   Shipped broken 2026-08-25b: the only caller of Countries.load() sat inside
   map.js's loadBasemapData(), which runs from initMap(). Land on a search
   instead of the map — a shared URL like #e=9594&q=France%20total — and the
   index was never requested at all, so `lookupCountry` returned null, "France"
   fell through to freetext, and the search found nothing with no error.

   Then DOMContentLoaded proved too EARLY: a cold install pulls ~33 MB and this
   650 KB was queued against the shell. `load` plus an idle callback puts it
   behind everything the first paint needs, which costs nothing — the file is
   precached, so by the time anyone types a country name it is a cache read
   either way, and a search that arrives first re-runs itself when the index
   lands.

   The ALIASES come from basemapData.countries and are built lazily on the
   first lookup, never eagerly: the fallback fetches the 720 KB outlines, and
   at load time basemapData is always absent, so building them here raced
   map.js for the same file and pulled it down twice. */
if (typeof window !== 'undefined' && window.addEventListener) {
  var _kickCountries = function () {
    if (window.requestIdleCallback)
      window.requestIdleCallback(function () { Countries.load(); }, { timeout: 5000 });
    else setTimeout(function () { Countries.load(); }, 1200);
  };
  if (document.readyState === 'complete') _kickCountries();
  else window.addEventListener('load', _kickCountries);
}
