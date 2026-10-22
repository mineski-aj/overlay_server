/* ── [FEATURE: lordadv] Lord advantage recap ──────────────────────────
   The moment a camp kills the Lord, a small panel pops up under that camp's
   tricode (blue = camp 1 on the left, red = camp 2 on the right) showing what
   the Lord window is earning: +GOLD, KILLS, TURRET. It stays for LORDADV_SHOW_MS
   (90 s) and its numbers update LIVE on every poll while it is up.
   TRIGGER: the poll where camp_list[].kill_lord goes up for a camp (the first poll of a page is only a baseline). The panel shows
   immediately, starts ticking, and is hidden after LORDADV_SHOW_MS. TICK: GOLD = camp_list[].kill_lord_advantage.gold (live) once the
   API publishes that window (begin_time at/after the kill; 0 until then); KILLS / TURRET = the camp's score / kill_tower gains since
   the kill (the API only gives tower HP), from lordAdvHistory snapshots, one per poll, trimmed to the last ~15 min.
   Lives inside #scoreboard-overlay (slides with the scoreboard). Detection is
   self-contained here (registerPollHandler at the bottom). Armable from the
   dashboard (featureEnabled.lordadv). */
var LORDADV_SHOW_MS = 90000;   // 1 min 30 s on air once triggered (was 7 s)
var lordAdvHistory  = [];            // [{ t, kills:{1,2}, towers:{1,2} }]
var lordAdvSeen     = {};            // "campid:begin" -> true
var lordAdvFirstPoll = true;
var lordAdvHideTimers = {};
var lordAdvActive = {};              // camp -> { key, begin } while its panel is up (drives the live updates)
var lordAdvEls = {};

(function buildLordAdv() {
  var overlay = document.getElementById('scoreboard-overlay');
  if (!overlay) return;
  [1, 2].forEach(function (camp) {
    var el = document.createElement('div');
    el.id = 'lordadv-c' + camp;
    el.className = 'lordadv ' + (camp === 1 ? 'lordadv-blue' : 'lordadv-red');
    el.innerHTML =
      '<div class="lordadv-bar"></div>' +
      '<div class="lordadv-icon"></div>' +
      '<div class="lordadv-title">ADVANTAGE</div>' +
      '<div class="lordadv-stat lordadv-gold"><span class="lordadv-num">+0</span><span class="lordadv-lbl">GOLD</span></div>' +
      '<div class="lordadv-stat lordadv-kills"><span class="lordadv-num">0</span><span class="lordadv-lbl">KILLS</span></div>' +
      '<div class="lordadv-stat lordadv-turret"><span class="lordadv-num">0</span><span class="lordadv-lbl">TURRET</span></div>';
    /* behind the scoreboard art, like the stolen-gold banner: first child, ahead of #scoreboard-bg */
    overlay.insertBefore(el, overlay.firstChild);
    lordAdvEls[camp] = {
      root: el,
      gold:   el.querySelector('.lordadv-gold .lordadv-num'),
      kills:  el.querySelector('.lordadv-kills .lordadv-num'),
      turret: el.querySelector('.lordadv-turret .lordadv-num'),
    };
  });
})();

function setLordAdvValues(camp, gold, kills, turrets) {
  var e = lordAdvEls[camp];
  if (!e) return;
  var g = '+' + formatGold(Math.max(0, gold || 0)), k = String(Math.max(0, kills || 0)), t = String(Math.max(0, turrets || 0));
  if (e.gold.textContent   !== g) e.gold.textContent   = g;     // write-if-changed (polled every second)
  if (e.kills.textContent  !== k) e.kills.textContent  = k;
  if (e.turret.textContent !== t) e.turret.textContent = t;
}
function showLordAdv(camp, gold, kills, turrets, ms) {
  var e = lordAdvEls[camp];
  if (!e) return;
  setLordAdvValues(camp, gold, kills, turrets);
  clearTimeout(lordAdvHideTimers[camp]);
  e.root.classList.add('lordadv-in');
  lordAdvHideTimers[camp] = setTimeout(function () { hideLordAdv(camp); }, ms || LORDADV_SHOW_MS);
}
function hideLordAdv(camp) {
  var e = lordAdvEls[camp];
  if (!e) return;
  clearTimeout(lordAdvHideTimers[camp]);
  lordAdvActive[camp] = null;
  e.root.classList.remove('lordadv-in');
}

/* snapshot at or just before time t (falls back to the oldest one we have) */
function lordAdvSnapshotAt(t) {
  var pick = lordAdvHistory[0] || null;
  for (var i = 0; i < lordAdvHistory.length; i++) {
    if (lordAdvHistory[i].t <= t) pick = lordAdvHistory[i]; else break;
  }
  return pick;
}

function lordAdvFor(data, camp) {
  var c = (data.camp_list || []).find(function (x) { return x.campid === camp; });
  return (c && c.kill_lord_advantage) || (data.kill_lord_advantage && data.kill_lord_advantage[camp]) || null;
}

registerPollHandler(function (data) {
  var gt = data.game_time || 0;
  var cur = { t: gt, kills: {}, towers: {}, lords: {} };
  [1, 2].forEach(function (camp) {
    var c = (data.camp_list || []).find(function (x) { return x.campid === camp; });
    cur.kills[camp]  = c ? (parseInt(c.score) || 0) : 0;
    cur.towers[camp] = c ? (parseInt(c.kill_tower) || 0) : 0;
    cur.lords[camp]  = c ? (parseInt(c.kill_lord) || 0) : 0;
  });
  if (lordAdvHistory.length && gt < lordAdvHistory[lordAdvHistory.length - 1].t - 5) {   // new game
    lordAdvHistory = []; lordAdvSeen = {}; lordAdvFirstPoll = true;
    [1, 2].forEach(hideLordAdv);
  }
  var prev = lordAdvHistory.length ? lordAdvHistory[lordAdvHistory.length - 1] : null;
  lordAdvHistory.push(cur);
  while (lordAdvHistory.length > 1 && lordAdvHistory[0].t < gt - 900) lordAdvHistory.shift();

  [1, 2].forEach(function (camp) {
    /* TRIGGER: the moment this camp's Lord kill count goes up, show the panel right away and keep it for LORDADV_SHOW_MS.
       The first poll of a page is only a baseline (a page loaded mid-game never replays an old Lord). */
    if (prev && cur.lords[camp] > prev.lords[camp] && featureEnabled.lordadv) {
      lordAdvActive[camp] = { startT: gt, base: cur, begin: 0 };
      showLordAdv(camp, 0, 0, 0, LORDADV_SHOW_MS);
    }
    /* TICK: while it is up, gold = the API's live advantage gold for THIS kill (its begin_time is at/after the kill, so an older
       window's numbers are never picked up), kills / turrets = this camp's gains since the kill. */
    var act = lordAdvActive[camp];
    if (!act) return;
    var adv = lordAdvFor(data, camp);
    var mine = adv && adv.begin_time > 0 && adv.begin_time >= act.startT - 10;
    var a = act.base;
    if (mine) { var snap = lordAdvSnapshotAt(adv.begin_time); if (snap) a = snap; }
    var b = (mine && adv.end_time > 0 && gt >= adv.end_time) ? (lordAdvSnapshotAt(adv.end_time) || cur) : cur;
    setLordAdvValues(camp, mine ? (adv.gold || 0) : 0, b.kills[camp] - a.kills[camp], b.towers[camp] - a.towers[camp]);
  });
  lordAdvFirstPoll = false;
});

/* Debug tab */
(function () {
  var host = document.getElementById('lordadv-debug-btns');
  if (!host) return;
  [1, 2].forEach(function (camp) {
    var show = document.createElement('button');
    show.className = 'debug-btn';
    show.textContent = camp === 1 ? '▶ BLUE' : '▶ RED';
    show.addEventListener('click', function () {
      var v = function (id) { return parseInt(document.getElementById(id).value) || 0; };
      showLordAdv(camp, v('lordadv-dbg-gold'), v('lordadv-dbg-kills'), v('lordadv-dbg-turret'));
    });
    var hide = document.createElement('button');
    hide.className = 'debug-btn';
    hide.textContent = camp === 1 ? '■ BLUE' : '■ RED';
    hide.addEventListener('click', function () { hideLordAdv(camp); });
    host.appendChild(show); host.appendChild(hide);
  });
})();
