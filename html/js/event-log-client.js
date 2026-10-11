/* html/js/event-log-client.js — reports this page's problems and scene load
   results to the server's event log (dashboard → Logs tab, and the 🟢/🟡/🔴
   status next to each scene on the Control tab). See lib/eventLog.js.

   Automatic, on any page that includes this file:
     - failed requests (network error / HTTP 4xx-5xx) and slow ones (>2s)
     - images/videos that fail to load
     - uncaught JS errors and unhandled promise rejections
     - one "page opened" line per real (non-preview) page load

   Opt-in, per page:
     OverlayLog.wrapScenes({ eventKey: { fn: 'showFoo', label: 'Foo' } })
       → times every call to window.showFoo and logs ONE verdict line when it
         finishes: 🟢 loaded / 🟡 loaded with warnings / 🔴 failed.
     OverlayLog.warn(msg) / OverlayLog.critical(msg) / OverlayLog.success(msg)
       → explicit lines from page code (e.g. "no photo for player X").

   ZERO-COST RULE — this must never slow down or break a scene:
     - nothing a scene does ever waits on logging; entries are queued and sent
       in one small batch at most every 2s, when the browser is idle
     - every hook is wrapped in try/catch, and wrapped functions return the
       ORIGINAL return value / rethrow the ORIGINAL error untouched
     - if the server doesn't have the log route (not restarted yet) or is
       unreachable, sending backs off and queued entries are just dropped
     - repeats of the same message within 30s are collapsed into one (×N)
*/
(function () {
  if (window.OverlayLog) return;

  var ENDPOINT      = '/api/event-log';
  var FLUSH_MS      = 2000;
  var SLOW_FETCH_MS = 2000;
  var DEDUPE_MS     = 30000;
  var GRACE_MS      = 700;    // keep collecting late image errors after a scene resolves
  var CHILD_WAIT_MS = 8000;   // max a scene waits on boards it triggered
  var TIMEOUT_MS    = 15000;  // a scene still not done after this = failed
  var MAX_QUEUE     = 100;
  var MAX_PER_MIN   = 60;
  var RANK = { success: 0, warning: 1, critical: 2 };

  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  var page = (location.pathname.split('/').pop() || 'page').replace(/\.html?$/i, '') || 'page';
  var kind = 'live';
  try {
    if (new URLSearchParams(location.search).get('preview') === '1') kind = 'preview';
    else if (window.top !== window) kind = 'embedded';
  } catch (e) { kind = 'embedded'; }
  var ua = navigator.userAgent || '';
  var host = /vmix/i.test(ua) ? 'vMix' : /obs/i.test(ua) ? 'OBS' : 'Browser';
  var instance = host + '-' + Math.random().toString(36).slice(2, 6);

  var queue = [];
  var flushTimer = null;
  var pausedUntil = 0;
  var dedupe = {};
  var sentThisMinute = 0, minuteStart = Date.now(), droppedThisMinute = 0;

  function now() { return Date.now(); }

  function shortUrl(u) {
    try {
      var url = new URL(u, location.href);
      var p = url.origin === location.origin ? url.pathname : url.host + url.pathname;
      try { p = decodeURIComponent(p); } catch (e) {}
      return p.length > 120 ? '…' + p.slice(-119) : p;
    } catch (e) { return String(u).slice(0, 120); }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      if (window.requestIdleCallback) window.requestIdleCallback(flush, { timeout: 2000 });
      else flush();
    }, FLUSH_MS);
  }

  function flush() {
    if (!queue.length || !origFetch) return;
    if (now() < pausedUntil) { queue = []; return; }
    var batch = queue.splice(0, 50);
    try {
      origFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: batch }),
        keepalive: true,
        cache: 'no-store',
      }).then(function (r) {
        // 404 = server not restarted with the log route yet. Back off.
        if (!r.ok) { pausedUntil = now() + 60000; queue = []; }
      }, function () { pausedUntil = now() + 10000; queue = []; });
    } catch (e) {}
    if (queue.length) scheduleFlush();
  }

  function send(entry) {
    try {
      var t = now();
      if (t - minuteStart > 60000) {
        if (droppedThisMinute) {
          queue.push(base({ level: 'warning', msg: droppedThisMinute + ' log lines dropped (more than ' + MAX_PER_MIN + '/min from this page)' }));
        }
        minuteStart = t; sentThisMinute = 0; droppedThisMinute = 0;
      }
      if (++sentThisMinute > MAX_PER_MIN && !entry.verdict) { droppedThisMinute++; return; }
      queue.push(entry);
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
      scheduleFlush();
    } catch (e) {}
  }

  function base(o) {
    o.ts = now(); o.page = page; o.kind = kind; o.instance = instance;
    return o;
  }

  // A standalone line, with repeats collapsed (×N). opts.key groups messages
  // that differ only in a timing number (e.g. the same failing URL).
  function line(level, msg, opts) {
    opts = opts || {};
    var key = level + '|' + (opts.key || msg);
    var d = dedupe[key], t = now();
    if (d && t - d.last < DEDUPE_MS) { d.suppressed++; return; }
    var count = d && d.suppressed ? d.suppressed + 1 : undefined;
    dedupe[key] = { last: t, suppressed: 0 };
    send(base({ level: level, msg: msg, scene: opts.scene, detail: opts.detail, ms: opts.ms, count: count }));
  }

  /* ── Scene sessions ───────────────────────────────────────────────── */
  var open = [];

  // Problems that happen while a scene is loading are folded into that
  // scene's single verdict line instead of being logged one by one.
  function report(level, msg, key) {
    try {
      key = key || msg;
      var live = open.filter(function (s) { return !s.finalized && !s.sealed; });
      if (live.length) {
        live.forEach(function (s) {
          var same = s.issues.filter(function (i) { return i.key === key; })[0];
          if (same) same.count++;
          else if (s.issues.length < 30) s.issues.push({ level: level, msg: msg, key: key, count: 1 });
          if (RANK[level] > RANK[s.worst]) s.worst = level;
        });
        return;
      }
      line(level, msg, { key: key });
    } catch (e) {}
  }

  // Requests currently in flight — named in a "did not finish loading"
  // verdict, since a hung request is the usual reason a scene never finishes.
  var inflight = {}, inflightSeq = 0;

  function beginScene(key, cfg) {
    var s = {
      key: key, label: cfg.label || key, child: !!cfg.child, check: cfg.check,
      t0: performance.now(), issues: [], worst: 'success', children: [],
      done: false, finalized: false, error: null, supersededBy: null, timedOut: false,
    };
    open.forEach(function (o) {
      if (o.finalized) return;
      if (s.child) { if (!o.child) o.children.push(s); }
      else if (!o.child) {
        if (!o.done) o.supersededBy = s.label;
        else o.sealed = true; // finished loading; the new scene's problems aren't its problems
      }
    });
    open.push(s);
    s.timeoutMs = cfg.timeoutMs || TIMEOUT_MS;
    s.timeout = setTimeout(function () { s.timedOut = true; finalize(s); }, s.timeoutMs);
    return s;
  }

  function endScene(s, err) {
    if (s.done) return;
    s.done = true;
    s.ms = performance.now() - s.t0;
    s.error = err || null;
    // Judge "did it actually end up on screen" NOW, the moment the show
    // finished — by the end of the grace window another scene may
    // legitimately have taken over.
    if (!s.error && !s.supersededBy && s.check) { try { s.cancelled = s.check(); } catch (e) {} }
    var t = s.ms;
    setTimeout(function () { waitChildren(s, t); }, GRACE_MS);
  }

  function waitChildren(s, startedWaitAt) {
    if (s.finalized) return;
    var pending = s.children.some(function (c) { return !c.finalized; });
    if (pending && performance.now() - s.t0 - startedWaitAt < CHILD_WAIT_MS) {
      setTimeout(function () { waitChildren(s, startedWaitAt); }, 250);
      return;
    }
    finalize(s);
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function finalize(s) {
    if (s.finalized) return;
    s.finalized = true;
    clearTimeout(s.timeout);
    open.splice(open.indexOf(s), 1);

    var secs = ((s.ms != null ? s.ms : performance.now() - s.t0) / 1000).toFixed(2) + 's';
    var level, msg;
    var errs = s.issues.filter(function (i) { return i.level === 'critical'; });
    var warns = s.issues.filter(function (i) { return i.level === 'warning'; });
    var cancelled = s.timedOut ? null : s.cancelled;

    if (s.error) {
      level = 'critical';
      msg = s.label + ' failed to load — ' + (s.error.message || String(s.error));
    } else if (s.timedOut) {
      level = 'critical';
      msg = s.label + ' did not finish loading within ' + (s.timeoutMs / 1000) + 's';
    } else if (s.supersededBy) {
      level = 'warning';
      msg = s.label + ' was replaced by ' + s.supersededBy + ' before it finished loading (' + secs + ')';
    } else if (cancelled) {
      level = 'warning';
      msg = s.label + ' — ' + cancelled + ' (' + secs + ')';
    } else if (errs.length) {
      level = 'critical';
      msg = s.label + ' loaded in ' + secs + ' with ' + plural(errs.length, 'error') +
        (warns.length ? ' and ' + plural(warns.length, 'warning') : '') + ' — ' + errs[0].msg;
    } else if (warns.length) {
      level = 'warning';
      msg = s.label + ' loaded in ' + secs + ' with ' + plural(warns.length, 'warning') + ' — ' + warns[0].msg;
    } else {
      level = 'success';
      msg = s.label + ' loaded in ' + secs;
    }
    var lines = s.issues.map(function (i) { return (i.level === 'critical' ? '✖ ' : '⚠ ') + i.msg + (i.count > 1 ? ' (×' + i.count + ')' : ''); });
    if (s.timedOut) {
      var waiting = Object.keys(inflight).map(function (k) { return inflight[k]; })
        .filter(function (f) { return f.t0 >= s.t0; })
        .map(function (f) { return '⏳ still waiting on ' + f.url + ' (' + ((performance.now() - f.t0) / 1000).toFixed(1) + 's)'; });
      lines = waiting.length ? waiting.concat(lines)
        : ['⏳ no request pending — stuck waiting on something else (animation, video or image load)'].concat(lines);
    }
    send(base({ level: level, msg: msg, scene: s.key, ms: s.ms, detail: lines.join('\n'), verdict: true }));
  }

  /* ── Automatic capture ─────────────────────────────────────────────── */
  if (origFetch) {
    window.fetch = function (input, init) {
      var p = origFetch(input, init);
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (url.indexOf(ENDPOINT) !== -1) return p;
        var t0 = performance.now(), su = shortUrl(url), id = ++inflightSeq;
        inflight[id] = { url: su, t0: t0 };
        p.then(function (r) {
          delete inflight[id];
          var ms = Math.round(performance.now() - t0);
          if (!r.ok) report(r.status >= 500 ? 'critical' : 'warning', 'Request failed: ' + su + ' (HTTP ' + r.status + ', ' + ms + 'ms)', 'req|' + su + '|' + r.status);
          else if (ms > SLOW_FETCH_MS) report('warning', 'Slow request: ' + su + ' took ' + (ms / 1000).toFixed(1) + 's', 'slow|' + su);
        }, function (err) {
          delete inflight[id];
          if (err && err.name === 'AbortError') return;
          report('critical', 'Request failed: ' + su + ' — ' + ((err && err.message) || 'network error'), 'req|' + su + '|err');
        });
      } catch (e) {}
      return p;
    };
  }

  window.addEventListener('error', function (ev) {
    try {
      var t = ev.target;
      if (t && t !== window && t.tagName) {
        // Resource load failure (doesn't bubble — this is the capture phase).
        var tag = t.tagName;
        if (tag !== 'IMG' && tag !== 'VIDEO' && tag !== 'AUDIO' && tag !== 'SOURCE') return;
        var src = t.currentSrc || t.src || t.getAttribute('src') || '';
        // An empty/blank src resolves to the page or its <base href="/"> —
        // that's "no image set", not a broken asset.
        if (!src || src === location.href || src === document.baseURI || /^(about|data|blob):/.test(src)) return;
        if (!(t.getAttribute('src') || '').trim() && tag !== 'VIDEO') return;
        report('warning', (tag === 'IMG' ? 'Image' : 'Video') + ' failed to load: ' + shortUrl(src));
        return;
      }
      var where = ev.filename ? ' (' + shortUrl(ev.filename) + ':' + ev.lineno + ')' : '';
      report('critical', 'JS error: ' + (ev.message || 'unknown') + where);
    } catch (e) {}
  }, true);

  window.addEventListener('unhandledrejection', function (ev) {
    try {
      var r = ev.reason;
      if (r && r.name === 'AbortError') return;
      report('critical', 'Unhandled error: ' + ((r && (r.message || r.toString())) || 'promise rejected'));
    } catch (e) {}
  });

  if (kind === 'live') {
    window.addEventListener('load', function () {
      try { line('success', 'Page opened (' + host + ', ready in ' + (performance.now() / 1000).toFixed(1) + 's)'); } catch (e) {}
    });
  }

  /* ── Public API ───────────────────────────────────────────────────── */
  window.OverlayLog = {
    success:  function (msg, opts) { line('success', msg, opts); },
    warn:     function (msg) { report('warning', msg); },
    critical: function (msg) { report('critical', msg); },

    // map: { eventKey: { fn: 'globalFnName', label, child?, skipIf?, check? } }
    //   eventKey — the Control tab's route key (/overlay/<eventKey>/show),
    //              so the dashboard can put the verdict next to that button
    //   child    — a board/sub-part another scene triggers; doesn't count as
    //              "replacing" the current scene, and that scene's verdict
    //              waits for it
    //   skipIf() — true = this call is a no-op (already showing), don't time it
    //   check()  — after loading, return a string if the scene ended up NOT
    //              showing (e.g. hidden mid-load), else null
    //   timeoutMs — override the 15s "never finished" limit (long intros)
    wrapScenes: function (map) {
      Object.keys(map).forEach(function (key) {
        var cfg = map[key];
        var orig = window[cfg.fn];
        if (typeof orig !== 'function' || orig.__olWrapped) return;
        var wrapped = function () {
          var s = null;
          try { if (!(cfg.skipIf && cfg.skipIf())) s = beginScene(key, cfg); } catch (e) {}
          var r;
          try { r = orig.apply(this, arguments); }
          catch (err) { if (s) { try { endScene(s, err); } catch (e) {} } throw err; }
          if (s) {
            try {
              if (r && typeof r.then === 'function') r.then(function () { endScene(s); }, function (err) { endScene(s, err || new Error('rejected')); });
              else endScene(s);
            } catch (e) {}
          }
          return r;
        };
        wrapped.__olWrapped = true;
        window[cfg.fn] = wrapped;
      });
    },
  };
})();
