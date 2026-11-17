/* html/js/game-refresh.js — the Game API refresh rate (Settings -> "Game API Refresh Rate",
   default 150ms, GET /api/game-refresh). Include near the top of any page that polls the game feed.

     GameRefresh.ms()        current interval in ms
     GameRefresh.loop(fn)    run fn forever: await it, wait ms(), repeat — never overlaps itself, and a
                             changed Settings value applies on the next iteration. Returns { stop() }.

   The first read is a synchronous XHR (same trick as theme-apply.js) so a page's first poll already uses the
   right rate; afterwards the value is re-read every 10s, so a Settings change reaches open pages within 10s. */
(function () {
  var DEFAULT_MS = 150, MIN_MS = 50, MAX_MS = 5000, ms = DEFAULT_MS;
  function accept(v) { v = Number(v); if (isFinite(v) && v > 0) ms = Math.min(MAX_MS, Math.max(MIN_MS, Math.round(v))); }
  try {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/game-refresh', false);
    x.timeout = 1500;
    x.send();
    if (x.status === 200) accept(JSON.parse(x.responseText).ms);
  } catch (e) { /* keep default */ }
  function refresh() {
    try {
      fetch('/api/game-refresh', { cache: 'no-store' }).then(function (r) { return r.json(); })
        .then(function (j) { accept(j.ms); }).catch(function () {});
    } catch (e) {}
  }
  setInterval(refresh, 10000);
  window.GameRefresh = {
    ms: function () { return ms; },
    loop: function (fn) {
      var stopped = false, timer = null;
      function tick() {
        if (stopped) return;
        var p; try { p = fn(); } catch (e) { p = null; }
        Promise.resolve(p).catch(function () {}).then(function () { if (!stopped) timer = setTimeout(tick, ms); });
      }
      tick();
      return { stop: function () { stopped = true; clearTimeout(timer); } };
    },
  };
})();
