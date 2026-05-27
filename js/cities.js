/**
 * cities.js  —  ShadowChaser
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

/* Look up a city name. Returns {name, lat, lon} or null. */
function lookupCity(name) {
  if (!_cityIndex) {
    _cityIndex = _buildCityIndex();
    if (!_cityIndex) return null;                /* basemap not loaded yet */
  }
  var hit = _cityIndex[_normalizeCityName(name)];
  return hit ? { name: hit.name, lat: hit.lat, lon: hit.lon } : null;
}
