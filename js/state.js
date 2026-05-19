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


/* ── AppState ────────────────────────────────────────────────────────── */
/* Single object holding all shared cross-file state, with event subscriptions.
   The old `var foo` globals (selectedEntry, mapReady, etc.) are kept working
   via getter/setter shims on `window` so no call sites need to change yet. */

var AppState = (function () {
  var data = {
    eclipseIndex:    [],
    selectedEntry:   null,
    activeTab:       'map',
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
['eclipseIndex','selectedEntry','activeTab','locationResults','scanCache',
 'scanCancelFlag','currentFilter','localResult','_lookedUpAlt','map','mapReady']
  .forEach(function (key) {
    Object.defineProperty(window, key, {
      get: function ()  { return AppState.get(key); },
      set: function (v) { AppState.set(key, v); },
      configurable: true
    });
  });
