/* ── [FEATURE: scoreboard] — always-on ingame scoreboard overlay ── */

(function buildScoreboard() {
  var overlay = document.createElement('div');
  overlay.id = 'scoreboard-overlay';

  var bg = document.createElement('img');
  bg.id  = 'scoreboard-bg';
  bg.src = 'assets/ingame/ingamepng.png';
  bg.alt = '';
  overlay.appendChild(bg);

  var gt = document.createElement('div');
  gt.id          = 'scoreboard-gametime';
  gt.textContent = '00:00';
  overlay.appendChild(gt);

  var k1 = document.createElement('div');
  k1.id = 'scoreboard-kills-c1';
  var k1v = document.createElement('span'); k1v.className = 'sb-kval'; k1v.textContent = '0';
  k1.appendChild(k1v);
  overlay.appendChild(k1);

  var k2 = document.createElement('div');
  k2.id = 'scoreboard-kills-c2';
  var k2v = document.createElement('span'); k2v.className = 'sb-kval'; k2v.textContent = '0';
  k2.appendChild(k2v);
  overlay.appendChild(k2);

  var t1 = document.createElement('div');
  t1.id          = 'scoreboard-tricode-c1';
  t1.textContent = '';
  overlay.appendChild(t1);

  var t2 = document.createElement('div');
  t2.id          = 'scoreboard-tricode-c2';
  t2.textContent = '';
  overlay.appendChild(t2);

  var g1 = document.createElement('div');
  g1.id          = 'scoreboard-gold-c1';
  g1.textContent = '';
  overlay.appendChild(g1);

  var g2 = document.createElement('div');
  g2.id          = 'scoreboard-gold-c2';
  g2.textContent = '';
  overlay.appendChild(g2);

  var tw1 = document.createElement('div');
  tw1.id          = 'scoreboard-tower-c1';
  tw1.textContent = '0';
  overlay.appendChild(tw1);

  var lo1 = document.createElement('div');
  lo1.id          = 'scoreboard-lord-c1';
  lo1.textContent = '0';
  overlay.appendChild(lo1);

  var tu1 = document.createElement('div');
  tu1.id          = 'scoreboard-turtle-c1';
  tu1.textContent = '0';
  overlay.appendChild(tu1);

  var tw2 = document.createElement('div');
  tw2.id          = 'scoreboard-tower-c2';
  tw2.textContent = '0';
  overlay.appendChild(tw2);

  var lo2 = document.createElement('div');
  lo2.id          = 'scoreboard-lord-c2';
  lo2.textContent = '0';
  overlay.appendChild(lo2);

  var tu2 = document.createElement('div');
  tu2.id          = 'scoreboard-turtle-c2';
  tu2.textContent = '0';
  overlay.appendChild(tu2);

  var gl1 = document.createElement('div');
  gl1.id = 'sb-goldlead-c1';
  overlay.appendChild(gl1);

  var gl2 = document.createElement('div');
  gl2.id = 'sb-goldlead-c2';
  overlay.appendChild(gl2);

  var ms1 = document.createElement('div');
  ms1.id = 'sb-score-c1';
  overlay.appendChild(ms1);

  var ms2 = document.createElement('div');
  ms2.id = 'sb-score-c2';
  overlay.appendChild(ms2);

  var sbSponBox = document.createElement('div');
  sbSponBox.id = 'sb-sponsor-loop';
  var sbSponImg = document.createElement('img');
  sbSponImg.id  = 'sb-sponsor-img';
  sbSponBox.appendChild(sbSponImg);
  overlay.appendChild(sbSponBox);

  /* Team logo containers — fallback circle shown until img loads */
  var logo1 = document.createElement('div');
  logo1.id = 'sb-logo-c1';
  var logo1fb = document.createElement('div'); logo1fb.className = 'sb-logo-fallback';
  var logo1img = document.createElement('img'); logo1img.className = 'sb-logo-img'; logo1img.alt = '';
  logo1img.style.display = 'none';
  logo1img.onload  = function() { this.style.display = 'block'; logo1fb.style.display = 'none'; };
  logo1img.onerror = function() { this.style.display = 'none';  logo1fb.style.display = ''; };
  logo1.appendChild(logo1fb); logo1.appendChild(logo1img);
  overlay.appendChild(logo1);

  var logo2 = document.createElement('div');
  logo2.id = 'sb-logo-c2';
  var logo2fb = document.createElement('div'); logo2fb.className = 'sb-logo-fallback';
  var logo2img = document.createElement('img'); logo2img.className = 'sb-logo-img'; logo2img.alt = '';
  logo2img.style.display = 'none';
  logo2img.onload  = function() { this.style.display = 'block'; logo2fb.style.display = 'none'; };
  logo2img.onerror = function() { this.style.display = 'none';  logo2fb.style.display = ''; };
  logo2.appendChild(logo2fb); logo2.appendChild(logo2img);
  overlay.appendChild(logo2);

  /* Insert as first child of scene — always behind every other feature */
  var scene = document.getElementById('scene');
  scene.insertBefore(overlay, scene.firstChild);
})();

/* ── Scoreboard show/hide with animation ── */
function sbHandleToggle(enabled) {
  var el = document.getElementById('scoreboard-overlay');
  if (!el) return;
  if (enabled) {
    el.style.transition = 'transform 0.5s ease-out, opacity 0.5s ease-out';
    el.classList.add('sb-on');
  } else {
    el.style.transition = 'transform 0.35s ease-in, opacity 0.35s ease-in';
    el.classList.remove('sb-on');
  }
}

/* Apply initial state after features are synced (small delay for fetch) */
setTimeout(function() {
  sbHandleToggle(featureEnabled.scoreboard !== false);
}, 120);

function formatGold(g) {
  if (g < 1000) return String(g);
  return (g / 1000).toFixed(1) + 'k';
}

/* ── Local timer (smooth game clock) ── */
var _sb = {
  running:    false,
  startMs:    0,       // Date.now() at last sync point
  offsetSec:  0,       // game_time seconds at last sync point
  frozenSec:  0,       // display value when paused
  prevApi:    -1,      // last seen api game_time
  sameCount:  0,       // consecutive polls with identical api time
  syncTick:   0,       // polls since last drift-sync
  PAUSE_AT:   2,       // same-time polls before pausing local timer
  SYNC_EVERY: 10,      // drift-check every N polls
  DRIFT_MAX:  2,       // seconds of allowed drift before snap
};

function _sbNow() {
  if (!_sb.running) return _sb.frozenSec;
  return _sb.offsetSec + (Date.now() - _sb.startMs) / 1000;
}

function _sbSetAt(sec) {
  _sb.offsetSec = sec;
  _sb.startMs   = Date.now();
}

/* 100ms tick — only redraws when the displayed second changes */
var _sbLastSec = -1;
setInterval(function() {
  var sec = Math.floor(_sbNow());
  if (sec < 0) sec = 0;
  if (sec === _sbLastSec) return;
  _sbLastSec = sec;
  var el = document.getElementById('scoreboard-gametime');
  if (el) el.textContent = formatTime(sec);
}, 100);

registerPollHandler(function(data) {
  var k1 = document.getElementById('scoreboard-kills-c1');
  var k2 = document.getElementById('scoreboard-kills-c2');

  var apiSec = data.game_time || 0;

  if (apiSec === 0) {
    /* Game not started / ended — reset */
    if (_sb.running || _sb.frozenSec > 0) {
      _sb.running = false; _sb.frozenSec = 0;
      _sb.prevApi = -1;    _sb.sameCount = 0;
    }
  } else if (!_sb.running && _sb.frozenSec === 0) {
    /* First positive time seen — start local timer */
    _sbSetAt(apiSec);
    _sb.running = true; _sb.frozenSec = apiSec;
    _sb.prevApi = apiSec; _sb.sameCount = 0;
  } else if (apiSec === _sb.prevApi) {
    /* Time not advancing — count toward pause */
    _sb.sameCount++;
    if (_sb.sameCount >= _sb.PAUSE_AT && _sb.running) {
      _sb.frozenSec = Math.round(_sbNow());
      _sb.running   = false;
    }
  } else {
    /* Time advanced */
    if (!_sb.running) {
      /* Resume from pause */
      _sbSetAt(apiSec);
      _sb.running = true;
    } else {
      /* Drift-sync check every SYNC_EVERY polls */
      _sb.syncTick++;
      if (_sb.syncTick >= _sb.SYNC_EVERY) {
        _sb.syncTick = 0;
        if (Math.abs(Math.floor(_sbNow()) - apiSec) > _sb.DRIFT_MAX) {
          _sbSetAt(apiSec);
        }
      }
    }
    _sb.sameCount = 0;
    _sb.prevApi   = apiSec;
    _sb.frozenSec = apiSec;
  }

  var camps = data.camp_list || [];
  var c1 = camps.find(function(c) { return c.campid === 1; });
  var c2 = camps.find(function(c) { return c.campid === 2; });

  sbUpdateKill('scoreboard-kills-c1', c1 ? (c1.score != null ? c1.score : 0) : 0);
  sbUpdateKill('scoreboard-kills-c2', c2 ? (c2.score != null ? c2.score : 0) : 0);

  var t1 = document.getElementById('scoreboard-tricode-c1');
  var t2 = document.getElementById('scoreboard-tricode-c2');
  if (t1 && c1) {
    var name1 = c1.team_simple_name || '';
    if (name1) t1.textContent = name1.toUpperCase();
  }
  if (t2 && c2) {
    var name2 = c2.team_simple_name || '';
    if (name2) t2.textContent = name2.toUpperCase();
  }

  /* Team logos — only reload when team name changes */
  var li1 = document.getElementById('sb-logo-c1');
  var li2 = document.getElementById('sb-logo-c2');
  if (li1) {
    var limg1  = li1.querySelector('.sb-logo-img');
    var lname1 = c1 ? (c1.team_simple_name || '').toUpperCase() : '';
    if (limg1 && lname1 && limg1.dataset.team !== lname1) {
      limg1.dataset.team    = lname1;
      limg1.style.display   = 'none';
      limg1.src             = '/logos/' + lname1 + '.png';
    }
  }
  if (li2) {
    var limg2  = li2.querySelector('.sb-logo-img');
    var lname2 = c2 ? (c2.team_simple_name || '').toUpperCase() : '';
    if (limg2 && lname2 && limg2.dataset.team !== lname2) {
      limg2.dataset.team    = lname2;
      limg2.style.display   = 'none';
      limg2.src             = '/logos/' + lname2 + '.png';
    }
  }

  var tw1 = document.getElementById('scoreboard-tower-c1');
  var lo1 = document.getElementById('scoreboard-lord-c1');
  var tu1 = document.getElementById('scoreboard-turtle-c1');
  var tw1 = document.getElementById('scoreboard-tower-c1');
  var lo1 = document.getElementById('scoreboard-lord-c1');
  var tu1 = document.getElementById('scoreboard-turtle-c1');
  var tw2 = document.getElementById('scoreboard-tower-c2');
  var lo2 = document.getElementById('scoreboard-lord-c2');
  var tu2 = document.getElementById('scoreboard-turtle-c2');
  if (c1) {
    if (tw1) tw1.textContent = c1.kill_tower    != null ? c1.kill_tower    : 0;
    if (lo1) lo1.textContent = c1.kill_lord     != null ? c1.kill_lord     : 0;
    if (tu1) tu1.textContent = c1.kill_tortoise != null ? c1.kill_tortoise : 0;
  }
  if (c2) {
    if (tw2) tw2.textContent = c2.kill_tower    != null ? c2.kill_tower    : 0;
    if (lo2) lo2.textContent = c2.kill_lord     != null ? c2.kill_lord     : 0;
    if (tu2) tu2.textContent = c2.kill_tortoise != null ? c2.kill_tortoise : 0;
  }

  var g1 = document.getElementById('scoreboard-gold-c1');
  var g2 = document.getElementById('scoreboard-gold-c2');
  var total1 = 0, total2 = 0;
  if (c1) { for (var s = 1; s <= 5; s++) { var seat = c1['seat_' + s]; if (seat) total1 += seat.gold || 0; } }
  if (c2) { for (var s = 1; s <= 5; s++) { var seat = c2['seat_' + s]; if (seat) total2 += seat.gold || 0; } }
  if (g1) g1.textContent = c1 ? formatGold(total1) : '';
  if (g2) g2.textContent = c2 ? formatGold(total2) : '';
  sbUpdateGoldLead(total1, total2);
});

/* ── Kill score flip animation ── */
var _sbKillVals = {};

function sbUpdateKill(id, newVal) {
  newVal = String(newVal);
  if (_sbKillVals[id] === newVal) return;
  _sbKillVals[id] = newVal;

  var container = document.getElementById(id);
  if (!container) return;

  /* purge any stale spans left over from backgrounded-tab missed animationends */
  var all = container.querySelectorAll('.sb-kval');
  var current = all[all.length - 1] || null;
  for (var i = 0; i < all.length - 1; i++) {
    if (all[i].parentNode) all[i].parentNode.removeChild(all[i]);
  }
  if (!current) return;

  /* entering digit — behind the exiting one */
  var next = document.createElement('span');
  next.className = 'sb-kval';
  next.style.zIndex = '1';
  next.style.animation = 'sb-k-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards';
  next.textContent = newVal;
  container.appendChild(next);

  /* exiting digit — stays on top while it falls */
  current.style.zIndex = '2';
  current.style.animation = 'sb-k-out 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards';
  var removed = false;
  function removeOld() {
    if (removed) return;
    removed = true;
    if (current.parentNode) current.parentNode.removeChild(current);
  }
  current.addEventListener('animationend', removeOld, { once: true });
  setTimeout(removeOld, 400);
}

/* ── Gold lead indicator ── */
var _glSide = null;

function sbUpdateGoldLead(total1, total2) {
  var el1 = document.getElementById('sb-goldlead-c1');
  var el2 = document.getElementById('sb-goldlead-c2');
  if (!el1 || !el2) return;

  var diff    = total1 - total2;
  var newSide = diff > 0 ? 'c1' : diff < 0 ? 'c2' : null;
  var amount  = '+' + formatGold(Math.abs(diff));

  if (newSide === null) {
    var hideSide = _glSide;
    _glSide = null;
    if (hideSide) {
      var hideEl = hideSide === 'c1' ? el1 : el2;
      hideEl.style.animation = 'sb-gl-out-' + hideSide + ' 0.3s ease-in forwards';
    }
    return;
  }

  var newEl = newSide === 'c1' ? el1 : el2;

  if (newSide === _glSide) {
    newEl.textContent = amount;
    return;
  }

  var oldSide = _glSide;
  var oldEl   = oldSide === 'c1' ? el1 : oldSide === 'c2' ? el2 : null;
  _glSide = newSide;

  if (oldEl) {
    oldEl.style.animation = 'sb-gl-out-' + oldSide + ' 0.3s ease-in forwards';
    setTimeout(function() {
      oldEl.style.animation = 'none';
      newEl.textContent = amount;
      newEl.style.animation = 'sb-gl-in-' + newSide + ' 0.4s ease-out forwards';
    }, 320);
  } else {
    newEl.textContent = amount;
    newEl.style.animation = 'sb-gl-in-' + newSide + ' 0.4s ease-out forwards';
  }
}

/* ── Match score bars ── */
function sbRenderBars(container, total, scored, fromRight) {
  container.innerHTML = '';
  for (var i = 0; i < total; i++) {
    var bar = document.createElement('div');
    bar.className = 'sb-score-bar';
    var filled = fromRight ? (i >= total - scored) : (i < scored);
    if (filled) bar.classList.add('filled');
    container.appendChild(bar);
  }
}

function sbPollMatchState() {
  fetch('/match/state', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(s) {
      var maxWins = Math.ceil(parseInt((s.series || 'BO3').replace('BO', '')) / 2);
      var home    = s.home || s.teamA;
      var away    = s.away || s.teamB;
      var swapped = s.swapped !== undefined ? s.swapped : (s.blueTeam === 'B');
      var c1Team  = swapped ? away : home;
      var c2Team  = swapped ? home : away;
      sbRenderBars(document.getElementById('sb-score-c1'), maxWins, c1Team.score, true);
      sbRenderBars(document.getElementById('sb-score-c2'), maxWins, c2Team.score, false);
    })
    .catch(function() {});
}

sbPollMatchState();
setInterval(sbPollMatchState, 3000);

/* ── Sponsor loop ── */
(function() {
  var SPONSORS = [];
  var idx = 0;

  function runLoop() {
    var img = document.getElementById('sb-sponsor-img');
    (function next() {
      var s = SPONSORS[idx];
      img.className = '';
      img.src = s.src;
      void img.offsetWidth;
      img.classList.add('sb-spon-in');

      function onIn(ev) {
        if (ev.propertyName !== 'transform') return;
        img.removeEventListener('transitionend', onIn);
        setTimeout(function() {
          img.classList.remove('sb-spon-in');
          img.classList.add('sb-spon-out');
          function onOut(ev) {
            if (ev.propertyName !== 'transform') return;
            img.removeEventListener('transitionend', onOut);
            idx = (idx + 1) % SPONSORS.length;
            next();
          }
          img.addEventListener('transitionend', onOut);
        }, s.dur);
      }
      img.addEventListener('transitionend', onIn);
    })();
  }

  fetch('/api/sponsors')
    .then(function(r) { return r.json(); })
    .then(function(list) {
      if (!list || !list.length) return;
      SPONSORS = list;
      runLoop();
    })
    .catch(function() {});
})();

/* ── Load saved position/style overrides from dashboard editor ── */
(function loadSbOverrides() {
  fetch('/api/overlay-styles?file=mploverlay_v7')
    .then(function(r) { return r.json(); })
    .then(function(styles) {
      if (!styles || !Object.keys(styles).length) return;
      var css = Object.keys(styles).map(function(sel) {
        var props = styles[sel];
        var decls = Object.keys(props).map(function(prop) {
          var cssProp = prop === 'fontSize' ? 'font-size' : prop;
          return cssProp + ':' + props[prop] + ' !important';
        }).join(';');
        return sel + '{' + decls + '}';
      }).join('\n');
      var style = document.createElement('style');
      style.id = 'sb-overrides';
      style.textContent = css;
      document.head.appendChild(style);
    })
    .catch(function() {});
})();
