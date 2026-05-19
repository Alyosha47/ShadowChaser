/* ── Data loading ────────────────────────────────────────────────────── */

var chunkCache = {};

function loadChunk(key) {
  if (chunkCache[key]) return Promise.resolve(chunkCache[key]);
  var url = DATA_BASE + '/besselian/' + key + '.json?v=' + BUILD;
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' \u2014 ' + key + '.json');
    return r.json();
  }).then(function (data) {
    chunkCache[key] = data;
    return data;
  });
}


/* ── UI state ────────────────────────────────────────────────────────── */

var eclipseIndex    = [];
var selectedEntry   = null;
var activeTab       = 'map';
var locationResults = null;
var scanCache       = {};
var scanCancelFlag  = false;
var currentFilter   = parseSearch('');
var localResult     = null;   // last computeEclipse result for current location
var _lookedUpAlt    = null;   // elevation fetched for the current coords (not in search field)


