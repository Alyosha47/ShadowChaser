/* ── Data loading ────────────────────────────────────────────────────── */

var chunkCache   = {};
var chunkLoading = {};   /* in-flight fetches, keyed by chunk */

/* Two caches, not one. `chunkCache` holds RESOLVED data; `chunkLoading` holds the
   in-flight promise. Without the second, every caller that arrives while a fetch
   is still in flight sees an empty cache and starts its own fetch — N concurrent
   scans meant N identical downloads of every century. Returning the pending
   promise collapses them to one. (Same pattern as `basemapLoading` in map.js.) */
function loadChunk(key) {
  if (chunkCache[key])   return Promise.resolve(chunkCache[key]);
  if (chunkLoading[key]) return chunkLoading[key];
  var url = DATA_BASE + '/besselian/' + key + '.json?v=' + BUILD;
  if (window.scLoading) window.scLoading(1);
  var p = fetch(url).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' \u2014 ' + key + '.json');
    return r.json();
  }).then(function (data) {
    chunkCache[key] = data;
    delete chunkLoading[key];
    if (window.scLoading) window.scLoading(-1);
    return data;
  }).catch(function (err) {
    delete chunkLoading[key];   /* clear on failure so a later call can retry */
    if (window.scLoading) window.scLoading(-1);
    throw err;                  /* callers already handle rejection */
  });
  chunkLoading[key] = p;
  return p;
}


/* ── AppState ────────────────────────────────────────────────────────── */
/* Single object holding all shared cross-file state, with event subscriptions.
   The old `var foo` globals (selectedEntry, mapReady, etc.) are kept working
   via getter/setter shims on `window` so no call sites need to change yet. */

var AppState = (function () {
  var data = {
    eclipseIndex:    [],
    selectedEntry:   null,
    activeTab:       'map',
    sidebarTab:      'eclipse',
    locationResults: null,
    scanCache:       {},
    scanCancelFlag:  false,
    currentFilter:   parseSearch(''),
    localResult:     null,
    _lookedUpAlt:    null,
    map:             null,
    mapReady:        false
  };
  var listeners = {};

  return {
    get: function (key) { return data[key]; },
    set: function (key, value) {
      if (data[key] === value) return;
      data[key] = value;
      (listeners[key] || []).forEach(function (fn) {
        try { fn(value); } catch (e) { console.error('AppState listener for ' + key, e); }
      });
    },
    on: function (key, fn) {
      (listeners[key] = listeners[key] || []).push(fn);
    }
  };
})();

/* Forwarding shims: keep existing global reads/writes working unchanged. */
['eclipseIndex','selectedEntry','activeTab','sidebarTab','locationResults','scanCache',
 'scanCancelFlag','currentFilter','localResult','_lookedUpAlt','map','mapReady']
  .forEach(function (key) {
    Object.defineProperty(window, key, {
      get: function ()  { return AppState.get(key); },
      set: function (v) { AppState.set(key, v); },
      configurable: true
    });
  });
