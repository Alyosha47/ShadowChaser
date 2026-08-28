/**
 * search-cities.js  —  followtheshadow
 * ──────────────────────────────────────────────────────────────────────────
 * City lookup against the basemap's loaded cities GeoJSON. Used by the
 * search parser to let users type a city name in place of explicit coords:
 *   "1954 paris"   →   year 1954, location = Paris coords
 *
 * The cities data comes from Natural Earth's `populated_places` and is
 * loaded by map.js into `basemapData.cities` (a GeoJSON FeatureCollection
 * with `properties.name` and `geometry.coordinates`).
 *
 * The index is built lazily on first lookup, keyed by normalised
 * (lower-case, accent-stripped) names. If multiple cities share a name,
 * the one with the lowest `rank` field wins (Natural Earth uses 1 for
 * capitals/largest, larger numbers for smaller places).
 *
 * Returns null if the basemap hasn't loaded yet, or no match was found.
 * Callers should retry once basemap data becomes available.
 */

var _cityIndex = null;    /* built on first lookup, null until then */

function _normalizeCityName(s) {
  return (s || '').toString()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   /* strip accents */
    .trim();
}

function _buildCityIndex() {
  if (typeof basemapData === 'undefined' || !basemapData || !basemapData.cities) {
    return null;
  }
  var idx = {};
  var feats = basemapData.cities.features || [];
  for (var i = 0; i < feats.length; i++) {
    var f = feats[i];
    if (!f || !f.geometry || !f.properties || !f.properties.name) continue;
    var key  = _normalizeCityName(f.properties.name);
    if (!key) continue;
    var rank = (f.properties.rank != null) ? f.properties.rank : 99;
    var prev = idx[key];
    if (!prev || rank < prev.rank) {
      idx[key] = {
        name: f.properties.name,
        lon:  f.geometry.coordinates[0],
        lat:  f.geometry.coordinates[1],
        rank: rank,
      };
    }
  }
  return idx;
}

/* Look up a city name. Returns {name, lat, lon} or null.
   EXACT ONLY — the prefix fallback is a separate function, so that callers can
   put a country lookup between the two. `mexico` must keep meaning the COUNTRY
   even though "Mexico City" would prefix-match it. */
function lookupCity(name) {
  if (!_cityIndex) {
    _cityIndex = _buildCityIndex();
    if (!_cityIndex) return null;                /* basemap not loaded yet */
  }
  var hit = _cityIndex[_normalizeCityName(name)];
  return hit ? { name: hit.name, lat: hit.lat, lon: hit.lon } : null;
}

/* Fallback: match the START of a city name.
 *
 * The dataset uses full official names, so `new york` matched NOTHING and the
 * token walk fell back to `york` — the one in ENGLAND, at 53.96N. A wrong
 * answer that looks right, and the manual had listed `new york` as a worked
 * example the whole time. 58 cities end in "City" or "Town"; 51 of those have
 * an unambiguous short form (Mexico City, New York City, Ho Chi Minh City...).
 *
 * Three deliberate limits, each preventing a different kind of wrong answer:
 *
 *   MULTI-WORD ONLY. A single word stays exact, exactly as before. Otherwise
 *   `san` silently becomes San Francisco and one-word searches turn
 *   unpredictable — and every one of those searches works correctly today.
 *
 *   MUST BE UNIQUE. If the prefix fits two cities, return null. Better to find
 *   nothing than to pick one and be confidently wrong; the 7 ambiguous cases
 *   are exactly where a guess would be least forgivable.
 *
 *   WORD BOUNDARY. "new york" may match "New York City" but must not match
 *   "New Yorkshire" — a prefix that stops mid-word is a coincidence, not a name.
 *
 * Callers try exact, then country, then this.
 */
function lookupCityPrefix(name) {
  if (!_cityIndex) {
    _cityIndex = _buildCityIndex();
    if (!_cityIndex) return null;
  }
  var key = _normalizeCityName(name);
  if (!key || key.indexOf(' ') < 0) return null;   /* single words stay exact */

  var found = null;
  for (var k in _cityIndex) {
    if (k.length <= key.length) continue;
    if (k.indexOf(key) !== 0) continue;
    if (k.charAt(key.length) !== ' ') continue;    /* boundary, not mid-word */
    if (found && found.name !== _cityIndex[k].name) return null;   /* ambiguous */
    if (!found || _cityIndex[k].rank < found.rank) found = _cityIndex[k];
  }
  return found ? { name: found.name, lat: found.lat, lon: found.lon } : null;
}
