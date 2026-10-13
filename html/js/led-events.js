/* ── led-events.js ── LED Overlay in-game events + side panels ──
   Ported from MPL_LED/led_events.html into led_overlay.html.
   • Plate events (First Item Priority, Trinity, Quick Swap, Level 15,
     Conceal) use the mploverlay_v7 "eventer" look/behavior: a card that
     wipes in from the plate's outer edge, label + value, item sheen,
     one-at-a-time per player with queueing, per-event arm/disarm from the
     dashboard (led_items / led_trinity / led_swap / led_lvl15 /
     led_conceal feature toggles).
   • Team HP / Win Probability / Team Fight / Draft Predict panels between
     the two plate columns, driven by SSE show/hide (led_health / led_win /
     led_fight / led_draftpred).
   led_overlay.html feeds game data in via LedEvents.onData(data) from its
   own poll and HOME/SWAP via LedEvents.setSwapped(bool). Wrapped in an IIFE
   because led_overlay's own inline script declares globals with the same
   names (isSwapped, normalizeId...). */
(function () {
'use strict';

const TIER3_IDS = new Set([
  '2006','2008','2009','2011','2013','2014',
  '2106','2107','2108','2110','2112',
  '2207','2208','2212',
  '3001','3002','3003','3004','3005','3006','3007','3008','3009','3012','3013','3014','3015',
  '3101','3102','3103','3104','3105','3106','3108','3109','3110','3111','3112','3113',
  '3201','3202','3203','3204','3205','3206','3207','3208','3209','3210','3212',
]);
const MARKSMAN_TRINITY_IDS = new Set(['2006','2008','2009']);
const TRINITY_DEBUG_ITEMS  = ['3001','3101','3201'];
const SWAP_DEBUG_BOUGHT    = '3207';

const ROAMING_BOOT_CATS = {
  conceal:   new Set(['1511','3511','3521','3531','3541','3551','3561','3571']),
  encourage: new Set(['1512','3512','3522','3532','3542','3552','3562','3572']),
  favor:     new Set(['1513','3513','3523','3533','3543','3553','3563','3573']),
  direhit:   new Set(['1514','3514','3524','3534','3544','3554','3564','3574']),
};
const CONCEAL_CAT_LABEL = { conceal:'CONCEAL', encourage:'ENCOURAGE', favor:'FAVOR', direhit:'DIRE HIT' };
const CONCEAL_CAT_IMG   = { conceal:'assets/conceal.webp', encourage:'assets/encourage.webp', favor:'assets/favor.webp', direhit:'assets/direhit.webp' };

/* ── Feature toggles (dashboard Control tab → /overlay/feature/led_xxx/enable|disable) ── */
const featureEnabled = { led_items: true, led_trinity: true, led_swap: true, led_lvl15: true, led_conceal: true, led_skypiercer: true };
fetch('/overlay/features', { cache: 'no-store' }).then(r => r.json()).then(d => {
  if (d && typeof d === 'object') Object.keys(featureEnabled).forEach(k => { if (k in d) featureEnabled[k] = !!d[k]; });
}).catch(() => {});

/* ── State ── */
let isSwapped = false;
let lastData  = null;
let prevBattleId = null;
const pollHandlers = [];
function registerPollHandler(fn) { pollHandlers.push(fn); }

function getApiUrl() { return '/api/gamedata-proxy'; }
function formatTime(s) {
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
function normalizeId(val) {
  if (val == null || val === '' || val === 0 || val === '0') return null;
  const s = String(val);
  return (s === '9999' || s === '99999') ? null : s;
}
/* plate = fixed on-screen slot 1..10 (1-5 left column, 6-10 right column);
   seat = stable player identity (camp1 1-5, camp2 6-10). */
function seatToPlate(seat) {
  if (!isSwapped) return seat;
  return seat <= 5 ? seat + 5 : seat - 5;
}
function concealPlateForCamp(campId) {
  return seatToPlate(campId === 1 ? 4 : 9);
}
function getPlayerFromSeat(data, seat) {
  const campId  = seat <= 5 ? 1 : 2;
  const seatNum = seat <= 5 ? seat : seat - 5;
  const camp = (data.camp_list || []).find(c => c.campid === campId);
  return camp?.[`seat_${seatNum}`] ?? null;
}

/* ─────────────────────────────────────────────
   SIDE PANELS (Team HP / Win Prob / Team Fight / Draft Predict)
───────────────────────────────────────────── */
/* ─────────────────────────────────────────────
   FEATURE 1: TEAM HP BAR
───────────────────────────────────────────── */
const THB_H = 650;
const thpSt = {
  left:  { pct:null, track:null, fill:null, fillIn:null, ghost:null, flash:null, cur:1.0, gval:1.0, gtimer:null, healTimer:null },
  right: { pct:null, track:null, fill:null, fillIn:null, ghost:null, flash:null, cur:1.0, gval:1.0, gtimer:null, healTimer:null },
};
const THP_EASE = 'transform 0.5s cubic-bezier(0.22,1,0.36,1)';

/* Slide the fill window down by (1-frac) of the track and counter-slide the
   gradient inside it (see CSS) — compositor-only, nothing repaints. */
function thpPlace(s, frac, animate) {
  const off = ((1 - frac) * THB_H).toFixed(1);
  s.fill.style.transition   = animate ? THP_EASE : 'none';
  s.fillIn.style.transition = animate ? THP_EASE : 'none';
  s.fill.style.transform    = `translateY(${off}px)`;
  s.fillIn.style.transform  = `translateY(-${off}px)`;
  const mid = frac <= 0.5, low = frac <= 0.25;
  s.track.classList.toggle('thp-mid', mid && !low);
  s.track.classList.toggle('thp-low', low);
  s.pct.classList.toggle('thp-pct-low', low);
}
function thpPlaceGhost(s, frac, animate) {
  s.ghost.style.transition = animate ? 'transform 0.45s ease-in' : 'none';
  s.ghost.style.transform  = `translateY(${((1 - frac) * THB_H).toFixed(1)}px)`;
}

function initThpRefs() {
  ['left','right'].forEach(side => {
    const s = thpSt[side];
    s.ghost  = document.getElementById(`thp-ghost-${side}`);
    s.pct    = document.getElementById(`thp-pct-${side}`);
    s.track  = document.getElementById(`thp-track-${side}`);
    s.fill   = document.getElementById(`thp-fill-${side}`);
    s.fillIn = document.getElementById(`thp-fillin-${side}`);
    s.flash  = document.getElementById(`thp-flash-${side}`);
    thpPlace(s, 1, false); thpPlaceGhost(s, 1, false);
  });
}

function setTeamHP(side, frac) {
  const s = thpSt[side];
  if (!s.fill) return;
  frac = Math.max(0, Math.min(1, frac));
  if (frac < s.cur - 0.001) {
    // hit: the bar drops now; the red trail holds the old level, then catches up
    s.gval = Math.max(s.gval, s.cur);
    s.cur  = frac;
    clearTimeout(s.healTimer);
    thpPlace(s, frac, true);
    thpPlaceGhost(s, s.gval, false);
    clearTimeout(s.gtimer);
    s.gtimer = setTimeout(() => { thpPlaceGhost(s, s.cur, true); s.gval = s.cur; }, 550);
  } else if (frac > s.cur + 0.001) {
    // heal: short green flash, then the bar rises
    s.flash.classList.remove('thp-flashing');
    void s.flash.offsetWidth;
    s.flash.classList.add('thp-flashing');
    clearTimeout(s.healTimer);
    s.healTimer = setTimeout(() => {
      s.cur = s.gval = frac;
      clearTimeout(s.gtimer);
      thpPlace(s, frac, true);
      thpPlaceGhost(s, frac, false);
    }, 200);
  } else {
    return;
  }
  s.pct.textContent = Math.round(frac * 100) + '%';
}

function resetTeamHP(side) {
  const s = thpSt[side];
  s.cur = 1.0; s.gval = 1.0; clearTimeout(s.gtimer); clearTimeout(s.healTimer);
  if (s.fill) { thpPlace(s, 1, false); thpPlaceGhost(s, 1, false); }
  if (s.pct)  s.pct.textContent = '100%';
}

function showTeamHP() {
  hideWinRate(); hideTeamFight(); hideDraftPredict();
  const el = document.getElementById('feature-teamhp');
  el.style.display = 'block';
  el.classList.remove('thp-leaving', 'thp-entering');
  void el.offsetWidth;
  el.classList.add('thp-entering');
  // bars rise from empty to the current value once the reel has mostly landed
  ['left','right'].forEach(side => {
    const s = thpSt[side];
    const target = s.cur;
    clearTimeout(s.gtimer); clearTimeout(s.healTimer);
    thpPlace(s, 0, false); thpPlaceGhost(s, 0, false);
    s.pct.textContent = '0%';
    setTimeout(() => {
      thpPlace(s, target, true); thpPlaceGhost(s, target, false);
      s.pct.textContent = Math.round(target * 100) + '%';
    }, 450);
  });
}
function hideTeamHP() {
  const el = document.getElementById('feature-teamhp');
  if (getComputedStyle(el).display === 'none') return;
  el.classList.remove('thp-entering', 'thp-leaving');
  void el.offsetWidth;
  el.classList.add('thp-leaving');
  el.addEventListener('animationend', () => {
    if (!el.classList.contains('thp-leaving')) return;   // re-shown mid-exit
    el.style.display = 'none';
    el.classList.remove('thp-leaving');
  }, { once: true });
}

registerPollHandler(function(data) {
  const feat = document.getElementById('feature-teamhp');
  if (!feat || feat.style.display === 'none') return;
  const camps = data.camp_list || [];
  const getCampFrac = id => {
    const camp = camps.find(c => c.campid === id);
    if (!camp) return null;
    let cur = 0, max = 0;
    for (let s = 1; s <= 5; s++) {
      const seat = camp[`seat_${s}`];
      if (!seat) continue;
      cur += seat.cur_health_point || 0;
      max += seat.max_health_point || 0;
    }
    return max > 0 ? cur / max : null;
  };
  const lf = getCampFrac(isSwapped ? 2 : 1);
  const rf = getCampFrac(isSwapped ? 1 : 2);
  if (lf !== null) setTeamHP('left',  lf);
  if (rf !== null) setTeamHP('right', rf);
});

/* ─────────────────────────────────────────────
   FEATURE 2: WIN PROBABILITY
───────────────────────────────────────────── */
const wprSt = {
  left:  { track:null, bar:null, ghost:null, pct:null, cur:0.5, gval:0.5, gtimer:null },
  right: { track:null, bar:null, ghost:null, pct:null, cur:0.5, gval:0.5, gtimer:null },
};

function initWprRefs() {
  ['left','right'].forEach(s => {
    wprSt[s].track = document.getElementById(`wpr-track-${s}`);
    wprSt[s].bar   = document.getElementById(`wpr-bar-${s}`);
    wprSt[s].ghost = document.getElementById(`wpr-ghost-${s}`);
    wprSt[s].pct   = document.getElementById(`wpr-pct-${s}`);
  });
}

function setWinRate(side, frac) {
  const s = wprSt[side];
  if (!s.bar) return;
  frac = Math.max(0, Math.min(1, frac));
  if (frac < s.cur - 0.001) {
    s.gval = Math.max(s.gval, s.cur);
    s.cur  = frac;
    s.ghost.style.transition = 'none';
    s.ghost.style.height     = (s.gval * 100) + '%';
    s.bar.style.height       = (frac * 100) + '%';
    s.pct.textContent        = Math.round(frac * 100) + '%';
    clearTimeout(s.gtimer);
    s.gtimer = setTimeout(() => {
      s.ghost.style.transition = 'height 0.45s ease-in';
      s.ghost.style.height     = (s.cur * 100) + '%';
      s.gval = s.cur;
    }, 550);
  } else if (frac > s.cur + 0.001) {
    const glowClass = side === 'left' ? 'wpr-gain-blue' : 'wpr-gain-red';
    s.track.classList.remove(glowClass);
    void s.track.offsetWidth;
    s.track.classList.add(glowClass);
    const target = frac;
    setTimeout(() => {
      s.cur  = target;
      s.gval = target;
      clearTimeout(s.gtimer);
      s.ghost.style.transition = 'none';
      s.ghost.style.height     = (target * 100) + '%';
      s.bar.style.height       = (target * 100) + '%';
      s.pct.textContent        = Math.round(target * 100) + '%';
    }, 350);
  }
}

function resetWinRate(side) {
  const s = wprSt[side];
  s.cur = 0.5; s.gval = 0.5; clearTimeout(s.gtimer);
  if (s.ghost) { s.ghost.style.transition = 'none'; s.ghost.style.height = '50%'; }
  if (s.bar)   { s.bar.style.transition = 'none'; s.bar.style.height = '50%'; requestAnimationFrame(() => { s.bar.style.transition = ''; }); }
  if (s.pct)   s.pct.textContent = '50%';
  if (s.track) { s.track.classList.remove('wpr-gain-blue','wpr-gain-red'); }
}

async function showWinRate() {
  hideTeamHP(); hideTeamFight(); hideDraftPredict();
  const el = document.getElementById('feature-winrate');
  el.style.display = 'block';
  el.classList.remove('wpr-leaving','wpr-entering');
  void el.offsetWidth;
  el.classList.add('wpr-entering');
  // fetch fresh data before powering up bars
  try {
    const res  = await fetch('/api/winrate-probability', { cache: 'no-store' });
    const json = await res.json();
    if (json.status === 'success' && json.last_data) {
      const d = json.last_data;
      wprSt.left.cur  = isSwapped ? d.t2_probability / 100 : d.t1_probability / 100;
      wprSt.right.cur = isSwapped ? d.t1_probability / 100 : d.t2_probability / 100;
      wprSt.left.gval  = wprSt.left.cur;
      wprSt.right.gval = wprSt.right.cur;
    }
  } catch(e) {}
  ['left','right'].forEach(side => {
    const s = wprSt[side];
    const target = s.cur;
    s.bar.style.transition   = 'none';
    s.ghost.style.transition = 'none';
    s.bar.style.height   = '0%';
    s.ghost.style.height = '0%';
    if (s.pct) s.pct.textContent = '0%';
    setTimeout(() => {
      s.bar.style.transition = 'height 0.7s cubic-bezier(0.22,1,0.36,1)';
      s.bar.style.height   = (target * 100) + '%';
      s.ghost.style.height = (target * 100) + '%';
      if (s.pct) s.pct.textContent = Math.round(target * 100) + '%';
      setTimeout(() => { s.bar.style.transition = ''; }, 700);
    }, 280);
  });
}

function hideWinRate() {
  const el = document.getElementById('feature-winrate');
  if (getComputedStyle(el).display === 'none') return;
  el.classList.remove('wpr-entering','wpr-leaving');
  void el.offsetWidth;
  el.classList.add('wpr-leaving');
  el.addEventListener('animationend', () => {
    if (!el.classList.contains('wpr-leaving')) return;   // re-shown mid-exit
    el.style.display = 'none';
    el.classList.remove('wpr-leaving');
  }, { once: true });
}

let wprFetching = false;
async function pollWinRate() {
  const el = document.getElementById('feature-winrate');
  if (!el || el.style.display === 'none') return;
  if (wprFetching) return;
  wprFetching = true;
  try {
    const res  = await fetch('/api/winrate-probability', { cache: 'no-store' });
    const json = await res.json();
    if (json.status === 'success' && json.last_data) {
      const d = json.last_data;
      setWinRate('left',  isSwapped ? d.t2_probability / 100 : d.t1_probability / 100);
      setWinRate('right', isSwapped ? d.t1_probability / 100 : d.t2_probability / 100);
    }
  } catch(e) {}
  wprFetching = false;
}

/* ─────────────────────────────────────────────
   FEATURE 3: TEAMFIGHT DAMAGE
───────────────────────────────────────────── */
const tfdSt    = { left:{ segs:[] }, right:{ segs:[] } };
let   tfdSnap  = {};
let   tfdSimTimer = null;

function initTfdSlots() {
  ['left','right'].forEach(side => {
    const col = document.getElementById(`tfd-col-${side}`);
    col.innerHTML = '';
    tfdSt[side].segs = [];
    for (let i = 0; i < 5; i++) {
      const seg  = document.createElement('div'); seg.className = 'tfd-seg';
      const hero = document.createElement('img'); hero.className = 'tfd-seg-hero'; hero.alt = '';
      hero.onerror = () => { hero.style.opacity = '0'; };
      const dmg  = document.createElement('span'); dmg.className = 'tfd-seg-dmg';
      seg.appendChild(hero); seg.appendChild(dmg);
      col.appendChild(seg);
      tfdSt[side].segs.push({ seg, hero, dmg });
    }
  });
}

function tfdTakeSnap(data) {
  tfdSnap = {};
  (data.camp_list || []).forEach(camp => {
    for (let s = 1; s <= 5; s++) {
      const p = camp[`seat_${s}`];
      tfdSnap[`${camp.campid}_${s}`] = p?.total_damage || 0;
    }
  });
}

function renderTfd(data) {
  const feat = document.getElementById('feature-teamfight');
  if (!feat || feat.style.display === 'none') return;
  const TFD_H = 650, HERO_MIN = 52, DMG_MIN = 28;
  const leftCamp  = isSwapped ? 2 : 1;
  const rightCamp = isSwapped ? 1 : 2;
  ['left','right'].forEach(side => {
    const campId = side === 'left' ? leftCamp : rightCamp;
    const camp   = (data.camp_list || []).find(c => c.campid === campId);
    if (!camp) return;
    const entries = [];
    for (let s = 1; s <= 5; s++) {
      const p   = camp[`seat_${s}`];
      const key = `${campId}_${s}`;
      const base = tfdSnap[key] ?? (p?.total_damage || 0);
      entries.push({
        heroid: p?.heroid || null,
        dead:   p?.dead   || false,
        dmg:    p ? Math.max(0, (p.total_damage || 0) - base) : 0,
      });
    }
    const totalDmg = entries.reduce((t, e) => t + e.dmg, 0);
    let cumBottom = 0;
    entries.forEach((e, i) => {
      const { seg, hero, dmg: dmgEl } = tfdSt[side].segs[i];
      const h = totalDmg > 0 ? (e.dmg / totalDmg) * TFD_H : 0;
      seg.style.bottom = cumBottom + 'px';
      seg.style.height = h + 'px';
      if (h >= 1) cumBottom += h;
      if (e.heroid && hero.dataset.id !== String(e.heroid)) {
        hero.dataset.id = String(e.heroid);
        hero.src = `posthero/${e.heroid}_POST_HERO.png`;
      }
      hero.className = 'tfd-seg-hero' + (e.dead ? ' dead' : '');
      hero.style.opacity = h >= HERO_MIN ? '1' : '0';
      dmgEl.textContent = e.dmg >= 1000
        ? (e.dmg / 1000).toFixed(1) + 'k'
        : e.dmg > 0 ? String(Math.round(e.dmg)) : '';
      dmgEl.style.opacity = h >= DMG_MIN ? '1' : '0';
    });
  });
}

async function showTeamFight() {
  hideTeamHP(); hideWinRate(); hideDraftPredict();
  const el = document.getElementById('feature-teamfight');
  el.style.display = 'block';
  el.classList.remove('tfd-leaving','tfd-entering');
  void el.offsetWidth;
  el.classList.add('tfd-entering');
  // reset segs to 0 (no transition on reset)
  ['left','right'].forEach(side => {
    tfdSt[side].segs.forEach(({ seg, hero, dmg }) => {
      seg.style.transition = 'none';
      seg.style.height = '0px'; seg.style.bottom = '0px';
      dmg.textContent = ''; dmg.style.opacity = '0';
      hero.src = ''; hero.style.opacity = '0'; delete hero.dataset.id;
      requestAnimationFrame(() => { seg.style.transition = ''; });
    });
  });
  // take damage snapshot so deltas start from 0
  let data = lastData;
  if (!data) {
    try {
      const res = await fetch(getApiUrl(), { cache: 'no-store' });
      const json = await res.json();
      if (json?.data?.camp_list) data = json.data;
    } catch(e) {}
  }
  if (data) {
    tfdTakeSnap(data);
    // pre-load hero portraits (hidden until segment grows tall enough)
    const leftCamp  = isSwapped ? 2 : 1;
    const rightCamp = isSwapped ? 1 : 2;
    ['left','right'].forEach(side => {
      const campId = side === 'left' ? leftCamp : rightCamp;
      const camp   = (data.camp_list || []).find(c => c.campid === campId);
      if (!camp) return;
      for (let s = 1; s <= 5; s++) {
        const p = camp[`seat_${s}`];
        if (!p?.heroid) continue;
        const { hero } = tfdSt[side].segs[s - 1];
        hero.dataset.id = String(p.heroid);
        hero.src = `posthero/${p.heroid}_POST_HERO.png`;
      }
    });
  }
}

function hideTeamFight() {
  const el = document.getElementById('feature-teamfight');
  if (getComputedStyle(el).display === 'none') return;
  el.classList.remove('tfd-entering','tfd-leaving');
  void el.offsetWidth;
  el.classList.add('tfd-leaving');
  el.addEventListener('animationend', () => {
    if (!el.classList.contains('tfd-leaving')) return;   // re-shown mid-exit
    el.style.display = 'none';
    el.classList.remove('tfd-leaving');
  }, { once: true });
}

registerPollHandler(function(data) { renderTfd(data); });

// ════════════════════════════════════════════════════════
//  FEATURE 4: DRAFT PREDICT
// ════════════════════════════════════════════════════════
/* Hero art: candidates[].heroName → heronames.json id → posthero/<id>_POST_HERO.png
   (replaces the old hand-maintained hex-heroId → number table). Names are matched
   case-insensitively; punctuation/spacing must match, e.g. "Yi Sun-shin". */
const DP_HERO_ID_BY_NAME = {};
function dpHeroArt(name) {
  const id = DP_HERO_ID_BY_NAME[String(name || '').trim().toLowerCase()];
  return id ? `posthero/${id}_POST_HERO.png` : null;
}
function dpFillArt(el) {
  const img = el.querySelector('img');
  const src = dpHeroArt(el.dataset.heroName);
  if (img && src && img.dataset.src !== src) { img.dataset.src = src; img.style.opacity = ''; img.src = src; }
}
fetch('/heronames.json', { cache: 'no-store' }).then(r => r.json()).then(list => {
  (list || []).forEach(h => { if (h && h.name) DP_HERO_ID_BY_NAME[String(h.name).trim().toLowerCase()] = h.id; });
  // cards built before the names arrived get their art now
  [dpLeftC, dpRightC].forEach(c => { if (c) c.cardEls.forEach(dpFillArt); });
}).catch(err => console.error('LED Draft Predict: could not load heronames.json', err));

const DP_CARD_H  = 74;   // 70px card + 4px gap
const DP_VIEW_H  = 650;
const DP_FADE_PX = 50;

function createDpCarousel(colEl) {
  const c = {
    cardEls:[], cardOffsets:[], scrollPos:0,
    state:'stopped', raf:null,
    pickedIdx:-1, clearTimer:null, onPickDone:null,
    isAnimating:false, _clearMs:4500, loadedSlot:null,
  };

  function applyPositions() {
    const N = c.cardEls.length;
    if (!N) return;
    const SET_H = N * DP_CARD_H;
    const inMotion = c.state === 'roulette' || c.state === 'settling';
    c.cardEls.forEach((el, i) => {
      let y = c.cardOffsets[i] - c.scrollPos;
      if (y + 70 < 0)     { c.cardOffsets[i] += SET_H; y += SET_H; }
      if (y > DP_VIEW_H)  { c.cardOffsets[i] -= SET_H; y -= SET_H; }
      el.style.setProperty('--ty', `${y}px`);
      el.style.transform = `translateY(${y}px)`;
      if (inMotion) {
        const tT = Math.min(1, Math.max(0, (y + DP_FADE_PX) / DP_FADE_PX));
        const tB = Math.min(1, Math.max(0, (DP_VIEW_H - y) / DP_FADE_PX));
        el.style.opacity = String(Math.min(tT, tB));
      } else {
        el.style.opacity = '';
      }
    });
  }

  function triggerPress() {
    const chosen = c.cardEls[c.pickedIdx];
    if (!chosen) return;
    c.cardEls.forEach((el, i) => { if (i !== c.pickedIdx) el.classList.add('dp-dimmed'); });
    chosen.classList.add('dp-pressing');
    setTimeout(() => { chosen.classList.remove('dp-pressing'); chosen.classList.add('dp-chosen'); }, 90);
    c.clearTimer = setTimeout(() => {
      c.cardEls.forEach(el => el.classList.remove('dp-dimmed','dp-pressing','dp-chosen'));
      c.isAnimating = false;
      if (c.onPickDone) c.onPickDone();
    }, c._clearMs);
  }

  function tick() {
    if (c.state === 'roulette') {
      c.scrollPos -= 0.5;
    } else if (c.state === 'settling') {
      const tgtY      = DP_VIEW_H / 2 - 35;
      const tgtScroll = c.cardOffsets[c.pickedIdx] - tgtY;
      const diff      = tgtScroll - c.scrollPos;
      c.scrollPos += diff * 0.10;
      if (Math.abs(diff) < 0.6) {
        c.scrollPos = tgtScroll;
        c.state = 'picked';
        applyPositions();
        triggerPress();
        return;
      }
    }
    applyPositions();
    if (c.state === 'roulette' || c.state === 'settling') c.raf = requestAnimationFrame(tick);
  }

  c.init = function(candidates) {
    colEl.querySelectorAll('.dp-card').forEach(el => el.remove());
    c.cardEls = []; c.cardOffsets = []; c.scrollPos = 0;
    const fadeBotEl = colEl.querySelector('.dp-fade-bot');
    candidates.forEach((cand, i) => {
      const el  = document.createElement('div');
      el.className    = 'dp-card';
      el.dataset.heroId = cand.heroId;
      el.dataset.heroName = cand.heroName || '';
      el.innerHTML = `
        <div class="dp-card-portrait">
          <img alt="" onerror="this.style.opacity='0'">
        </div>
        <div class="dp-card-body">
          <div class="dp-card-pct">${cand.probability.toFixed(1)}%</div>
        </div>
        <div class="dp-rank-badge ${i<5?'rank-top':'rank-low'}"><span class="dp-rank-num">${i+1}</span></div>`;
      if (fadeBotEl) colEl.insertBefore(el, fadeBotEl);
      else colEl.appendChild(el);
      dpFillArt(el);
      c.cardEls.push(el);
      c.cardOffsets.push(i * DP_CARD_H);
    });
    const startOff = DP_VIEW_H / 2 - (candidates.length * DP_CARD_H) / 2;
    c.cardOffsets = c.cardOffsets.map(o => o + startOff);
    applyPositions();
  };

  c.startRoulette = function() {
    cancelAnimationFrame(c.raf); clearTimeout(c.clearTimer);
    c.cardEls.forEach(el => { el.classList.remove('dp-dimmed','dp-pressing','dp-chosen'); el.style.opacity=''; });
    c.state = 'roulette'; c.isAnimating = false;
    c.raf = requestAnimationFrame(tick);
  };

  c.settle = function(heroId, onDone, clearMs) {
    c._clearMs = clearMs || 4500;
    const idx = c.cardEls.findIndex(el => el.dataset.heroId === heroId);
    if (idx === -1) { c.startRoulette(); if (onDone) setTimeout(onDone, c._clearMs); return; }
    c.pickedIdx = idx; c.onPickDone = onDone || null; c.isAnimating = true;
    c.state = 'settling';
    cancelAnimationFrame(c.raf);
    c.raf = requestAnimationFrame(tick);
  };

  c.reset = function() { clearTimeout(c.clearTimer); c.startRoulette(); };
  c.stop  = function() {
    cancelAnimationFrame(c.raf); clearTimeout(c.clearTimer);
    c.state = 'stopped'; c.isAnimating = false;
  };

  return c;
}

// ── Draft Predict state ──────────────────────────────────────────────
// Engine = Draft.html's Draft Predict v3 (dp3*), ported for the LED wall:
//  • hero art resolved from candidates[].heroName via heronames.json (no
//    hand-maintained id table);
//  • "what got picked/banned" is read from THIS SAME /proxy/predictions
//    response's own draftState — new heroIds are matched to their prediction
//    slot by elimination (a same-side double turn can confirm out of order);
//  • the active prediction is derived from draftState counts, not currentSlot;
//  • polls from page load (hidden or not), so a later Show never replays
//    history; dpUserHidden only gates what's drawn;
//  • in-flight guard + 8s timeout, draft-key change resets, queued reveals are
//    never dropped, a carousel only trusts its loaded pool when it IS the
//    entry's slot (loadedSlot);
//  • server-side shown/hidden state (checkOverlays.led_draftpred) restored on
//    load.
// Left out on purpose (Draft.html-only): the plate gate (waits on Draft.html's
// player plates) and the AI rationale bubble.
let dpLeftC = null, dpRightC = null;
let dpActiveData = null, dpPrevData = null, dpDisplayedRef = null;
let dpPickQueue = [], dpPrevKey = null, dpDisplayedSlot = null;
let dpUserHidden = true, dpFetchInFlight = false;
let dpTestActive = false, dpTestTimer = null, dpTestUsedFake = false;
const DP_NO_MATCH_ROULETTE_MS = 1800;   // an unpredicted pick still gets a believable spin
const DP_POLL_MS = 3000;

function dpGetCol(apiSide) {
  const blue = String(apiSide).toUpperCase() === 'BLUE';
  if (!isSwapped) return blue ? 'left' : 'right';
  return blue ? 'right' : 'left';
}
function dpCarouselFor(side) { return dpGetCol(side) === 'left' ? dpLeftC : dpRightC; }
function dpTeamName(side, data) {
  return String(side).toUpperCase() === 'BLUE' ? data?.blueTeam?.name : data?.redTeam?.name;
}
function dpHalt() {
  [dpLeftC, dpRightC].forEach(c => { if (c) { clearTimeout(c.clearTimer); c.stop(); } });
}

/* Empty both columns. Done on a new draft / Show / SWAP so the side that is NOT
   active doesn't keep showing the previous game's final pool. Mid-draft the
   inactive side deliberately keeps its last result until its turn comes. */
function dpClearColumns() {
  [dpLeftC, dpRightC].forEach(c => { if (c) { c.init([]); c.loadedSlot = null; } });
  dpSetHeader('left', 'PREDICT', ''); dpSetHeader('right', 'PREDICT', '');
}

function dpSetHeader(col, teamName, type) {
  const teamEl = document.getElementById(`dp-team-${col}`);
  const typeEl = document.getElementById(`dp-type-${col}`);
  if (teamEl) teamEl.textContent = teamName || '—';
  if (typeEl) typeEl.textContent = type || '';
}

function dpShowFeature() {
  const feat = document.getElementById('feature-draftpredict');
  if (getComputedStyle(feat).display !== 'none' && !feat.classList.contains('dp-leaving')) return;
  feat.style.display = 'block';
  feat.classList.remove('dp-leaving', 'dp-entering');
  void feat.offsetWidth;
  feat.classList.add('dp-entering');
}
function dpHideFeature() {
  const feat = document.getElementById('feature-draftpredict');
  if (getComputedStyle(feat).display === 'none') return;
  feat.classList.remove('dp-entering', 'dp-leaving');
  void feat.offsetWidth;
  feat.classList.add('dp-leaving');
  feat.addEventListener('animationend', () => {
    if (!feat.classList.contains('dp-leaving')) return;   // re-shown mid-exit
    feat.style.display = 'none';
    feat.classList.remove('dp-leaving');
  }, { once: true });
}
/* ── Active prediction: the first prediction (slot order) whose side+type
   still has more predictions than decided heroes. Not currentSlot. ── */
function dpDeriveActive(data) {
  const ds = (data && data.draftState) || {};
  const sorted = ((data && data.predictions) || []).slice().sort((a, b) => a.slot - b.slot);
  const counts = {
    BLUE_BAN:  (ds.blueBans  || []).length, RED_BAN:   (ds.redBans   || []).length,
    BLUE_PICK: (ds.bluePicks || []).length, RED_PICK:  (ds.redPicks  || []).length,
  };
  const seen = { BLUE_BAN: 0, RED_BAN: 0, BLUE_PICK: 0, RED_PICK: 0 };
  for (const p of sorted) {
    const key = p.side + '_' + p.type;
    if (seen[key] === undefined) continue;
    if (seen[key] >= counts[key]) return p;
    seen[key]++;
  }
  return null;
}

/* What to put on the reel. v3 returns nothing once the draft is over and hides
   its panel; on the LED a Show must stay up until Hide is pressed, so fall back
   to the current / last prediction (same as the old LED panel did). */
function dpPickToShow(data) {
  const active = dpDeriveActive(data);
  if (active) return active;
  const preds = (data && data.predictions) || [];
  return preds.find(p => p.slot === data.currentSlot) || preds[preds.length - 1] || null;
}

function dpDraftKey(data) {
  if (data.battleId) return String(data.battleId);
  const r = data.roomName || '', b = data.blueTeam?.name || '', rd = data.redTeam?.name || '';
  if (!r && !b && !rd) return null;
  return r + '|' + b + '|' + rd;
}

function dpRenderPrediction(pred, data) {
  dpDisplayedSlot = pred.slot;
  const col = dpGetCol(pred.side);
  const c   = dpCarouselFor(pred.side);
  dpSetHeader(col, dpTeamName(pred.side, data), pred.type);
  c.init(pred.candidates.slice(0, 10));
  c.loadedSlot = pred.slot;   // which slot's pool is physically loaded (see dpProcessQueue)
  // only spin while visible — a hidden panel must not run a requestAnimationFrame loop
  if (!dpUserHidden) { c.startRoulette(); dpShowFeature(); }
}

/* ── Rationale text is only used as slot EVIDENCE here: it opens with the
   hero it's about, which pins a hero to its slot when draftState alone is
   ambiguous (same as v3). The bubble itself isn't shown on the LED. ── */
function dpIsValidRationale(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim().toLowerCase();
  return !!t && t !== 'null' && t !== 'undefined';
}
function dpHeroNames(preds) {
  const map = {};
  (preds || []).forEach(p => (p.candidates || []).forEach(c => {
    if (c.heroId && c.heroName) map[c.heroId] = String(c.heroName).trim().toLowerCase();
  }));
  return map;
}
function dpRationaleSubject(rationale, names) {
  if (!dpIsValidRationale(rationale)) return null;
  const t = rationale.trim().toLowerCase();
  let best = null, bestLen = 0;
  Object.keys(names).forEach(id => {
    const n = names[id];
    if (n.length <= bestLen || t.indexOf(n) !== 0) return;
    const next = t.charAt(n.length);
    if (next && /[a-z0-9]/.test(next)) return;   // "ling" must not match "lingwen"
    best = id; bestLen = n.length;
  });
  return best;
}

/* ── Reveal detection — walk THIS response's draftState for heroIds we
   haven't revealed yet (by id, not array position: the API doesn't
   guarantee append order), and resolve each to its prediction slot by
   elimination over everything decided so far for that side+type. ── */
function dpDetectReveal(newData) {
  if (!dpDisplayedRef) return false;
  const ns = newData.draftState || {};
  const predictionsSrc = newData.predictions || dpPrevData?.predictions || [];
  const added = [];

  function resolveSideType(fullHeroIds, side, type) {
    const sortedSameType = predictionsSrc.slice().sort((a, b) => a.slot - b.slot)
      .filter(p => p.side === side && p.type === type);
    const assigned = fullHeroIds.map(() => -1);
    const predUsed = sortedSameType.map(() => false);

    // strongest evidence first: a slot whose rationale is about this exact hero
    const rNames = dpHeroNames(predictionsSrc);
    for (let rh = 0; rh < fullHeroIds.length; rh++) {
      for (let rp = 0; rp < sortedSameType.length; rp++) {
        if (predUsed[rp]) continue;
        if (dpRationaleSubject(sortedSameType[rp].rationale, rNames) === fullHeroIds[rh]) {
          assigned[rh] = rp; predUsed[rp] = true; break;
        }
      }
    }
    // elimination: a hero that fits exactly one still-open slot claims it
    let changed = true;
    while (changed) {
      changed = false;
      for (let hi = 0; hi < fullHeroIds.length; hi++) {
        if (assigned[hi] !== -1) continue;
        const matches = [];
        for (let pi = 0; pi < sortedSameType.length; pi++) {
          if (predUsed[pi]) continue;
          if ((sortedSameType[pi].candidates || []).some(c => c.heroId === fullHeroIds[hi])) matches.push(pi);
        }
        if (matches.length === 1) { assigned[hi] = matches[0]; predUsed[matches[0]] = true; changed = true; }
      }
    }
    // whatever is left (genuinely ambiguous / unpredicted): next free slot in order
    let nextFree = 0;
    const nextFreeIdx = () => {
      while (nextFree < predUsed.length && predUsed[nextFree]) nextFree++;
      return nextFree < predUsed.length ? nextFree : -1;
    };
    for (let hi2 = 0; hi2 < fullHeroIds.length; hi2++) {
      if (assigned[hi2] !== -1) continue;
      const fi = nextFreeIdx();
      if (fi !== -1) { assigned[hi2] = fi; predUsed[fi] = true; nextFree = fi + 1; }
    }
    return fullHeroIds.map((heroId, k) => ({
      heroId, pred: assigned[k] !== -1 ? sortedSameType[assigned[k]] : null, occurrence: assigned[k],
    }));
  }

  function collect(arrName, side, type) {
    const newArr = ns[arrName] || [];
    const knownIds = dpDisplayedRef[arrName] || [];
    if (newArr.length <= knownIds.length) return;
    // "new" = a heroId we haven't revealed, NOT "whatever sits past the old length"
    resolveSideType(newArr, side, type)
      .filter(r => knownIds.indexOf(r.heroId) === -1)
      .forEach(r => added.push({ heroId: r.heroId, side: side.toLowerCase(), type: type.toLowerCase(),
                                 pred: r.pred, occurrence: r.occurrence }));
  }
  collect('bluePicks', 'BLUE', 'PICK');
  collect('redPicks',  'RED',  'PICK');
  collect('blueBans',  'BLUE', 'BAN');
  collect('redBans',   'RED',  'BAN');
  if (!added.length) return false;

  dpDisplayedRef = JSON.parse(JSON.stringify(ns));
  if (dpUserHidden) return true;   // consumed silently; nothing is drawn while hidden

  added.sort((a, b) => (a.pred ? a.pred.slot : 999) - (b.pred ? b.pred.slot : 999));
  const wasAnimating = (dpLeftC && dpLeftC.isAnimating) || (dpRightC && dpRightC.isAnimating);
  const wasIdle = dpPickQueue.length === 0 && !wasAnimating;
  if (wasIdle) {
    // a long backlog (reconnect after a gap) only plays its newest reveal
    dpPickQueue = added.length <= 2 ? added : [added[added.length - 1]];
    dpProcessQueue(newData);
  } else {
    dpPickQueue = dpPickQueue.concat(added);   // never drop a queued reveal
  }
  return true;
}

function dpProcessQueue(fallbackData) {
  if (!dpPickQueue.length) return;
  const entry = dpPickQueue[0];
  const next  = dpPickQueue[1];
  const consecutive = next && next.side === entry.side && next.type === entry.type;
  const clearMs = consecutive ? 2000 : 4500;   // LED holds the result longer than v3 (no bubble to wait on)

  const targetC = dpCarouselFor(entry.side);
  if (!targetC) { dpPickQueue.shift(); dpProcessQueue(fallbackData); return; }
  if (!dpUserHidden) dpShowFeature();

  const advance = () => {
    dpPickQueue.shift();
    const data = dpActiveData || fallbackData;
    if (dpPickQueue.length) { dpProcessQueue(data); return; }
    const latest = dpPickToShow(data);
    if (latest) dpRenderPrediction(latest, data);
  };

  // "the hero is already in the carousel" only counts when the loaded pool IS
  // this entry's slot — a strong candidate often sits in two slots' top 10
  const predSlot = entry.pred ? entry.pred.slot : null;
  let idx = -1;
  if (predSlot != null && targetC.loadedSlot === predSlot) {
    idx = targetC.cardEls.findIndex(el => el.dataset.heroId === entry.heroId);
  }
  if (idx === -1) {
    const data2 = dpActiveData || fallbackData;
    const sidePred = entry.pred;
    if (sidePred && targetC.loadedSlot !== sidePred.slot) {
      dpSetHeader(dpGetCol(sidePred.side), dpTeamName(sidePred.side, data2), sidePred.type);
      targetC.init(sidePred.candidates.slice(0, 10));
      targetC.loadedSlot = sidePred.slot;
      dpDisplayedSlot = sidePred.slot;
    }
    idx = targetC.cardEls.findIndex(el => el.dataset.heroId === entry.heroId);
  }

  if (idx === -1) {
    // the real pick isn't among the AI's candidates: let this slot's pool spin
    // for a believable stretch, then move on without settling on a card
    const hasPool = !dpUserHidden && entry.pred && targetC.loadedSlot === entry.pred.slot && targetC.cardEls.length;
    if (hasPool) {
      targetC.startRoulette();
      setTimeout(() => { targetC.stop(); advance(); }, DP_NO_MATCH_ROULETTE_MS);
    } else {
      advance();
    }
    return;
  }
  const wasRouletting = targetC.state === 'roulette';
  if (!wasRouletting) targetC.startRoulette();
  setTimeout(() => targetC.settle(entry.heroId, advance, clearMs), wasRouletting ? 0 : 400);
}

function dpApplyData(data) {
  dpActiveData = data;
  dpPrevData = null;
  dpPickQueue = [];
  dpDisplayedRef = JSON.parse(JSON.stringify(data.draftState || {}));
  dpClearColumns();
  const latest = dpPickToShow(data);
  if (latest) dpRenderPrediction(latest, data);
}

function dpFetchLive() {
  if (dpTestActive) return;    // a dashboard test owns the screen — don't let a poll overwrite it
  if (dpFetchInFlight) return;
  dpFetchInFlight = true;
  fetch('/proxy/predictions', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(data => {
      const key = dpDraftKey(data);
      const isNewDraft = dpPrevData && dpPrevKey && key && key !== dpPrevKey;
      if (!dpPrevData || isNewDraft) {
        if (isNewDraft) { dpHalt(); dpPickQueue = []; }
        dpApplyData(data);
      } else {
        dpDetectReveal(data);
        dpActiveData = data;
      }
      if (key) dpPrevKey = key;
      dpPrevData = data;
    })
    .catch(() => {})
    .finally(() => { dpFetchInFlight = false; });
}

/* ── Remote control: show / hide (SSE led_draftpred, Control tab, debug) ── */
function dpApplyCmd(action) {
  if (action === 'show') {
    dpHalt(); dpPickQueue = [];
    dpUserHidden = false;
    dpClearColumns();
    const latest = dpActiveData && dpPickToShow(dpActiveData);
    if (latest) dpRenderPrediction(latest, dpActiveData);
    else dpShowFeature();
  } else if (action === 'hide') {
    dpHalt(); dpPickQueue = [];
    dpUserHidden = true;
    dpHideFeature();
  }
}
function showDraftPredict() {
  hideTeamHP(); hideWinRate(); hideTeamFight();
  dpApplyCmd('show');
}
function hideDraftPredict() { dpApplyCmd('hide'); }

/* ── Dashboard test hooks (Control tab → Draft Overlay → Test Draft Predict v3 /
   slot grid → "Also send to LED Overlay"). Same contract as Draft.html's
   __dp3TestReveal / __dp3TestSlot. Real polling is suspended for 15s after each
   click (re-extended per click) so the result can actually be seen; real
   draftState bookkeeping (dpDisplayedRef / dpPrevData) is never touched. ── */
function dpHoldTest() {
  dpTestActive = true;
  clearTimeout(dpTestTimer);
  dpTestTimer = setTimeout(() => {
    dpTestActive = false;
    // the fixture demo put FAKE candidates on the wall: once its window is over,
    // let the next poll re-apply the real feed instead of leaving them up
    if (dpTestUsedFake) { dpTestUsedFake = false; dpPrevData = null; }
  }, 15000);
}

function dpTestSlot(slotNum, mode) {
  const data  = dpActiveData;
  const pred  = ((data && data.predictions) || []).find(p => p.slot === Number(slotNum));
  if (!pred) return;                       // no live predictions[] entry for this slot (yet)
  dpHoldTest();
  dpUserHidden = false;
  hideTeamHP(); hideWinRate(); hideTeamFight();
  const targetC = dpCarouselFor(pred.side);
  if (mode === 'show') {
    // that slot just became the active one: panel up, reel spinning on its real top 10
    dpHalt(); dpPickQueue = [];
    dpRenderPrediction(pred, data);
  } else if (mode === 'settle') {
    // force a reveal onto the slot's #1-ranked real candidate
    const cands = pred.candidates.slice(0, 10);
    if (!cands.length) return;
    if (targetC.loadedSlot !== pred.slot) { dpHalt(); dpPickQueue = []; dpRenderPrediction(pred, data); }
    dpShowFeature();
    const wasRouletting = targetC.state === 'roulette';
    if (!wasRouletting) targetC.startRoulette();
    setTimeout(() => targetC.settle(cands[0].heroId, null, 4500), wasRouletting ? 0 : 400);
  }
}

function dpTestReveal() {
  const BLUE_NAMES = ['Fanny', 'Marcel', 'Hirara', 'Baxia', 'Valentina', 'Yve', 'Freya', 'Zhuxin', 'Kalea', 'Khaleed'];
  const RED_NAMES  = ['Atlas', 'Belerick', 'Claude', 'Novaria', 'Rafaela', 'Brody', 'Moskov', 'Clint', 'Eudora', 'Ruby'];
  const fake = (prefix, names) => names.map((n, i) => ({ heroId: prefix + '_' + i, heroName: n, probability: 28 - i * 2.4 }));
  const bluePred  = { slot: 1, side: 'BLUE', type: 'BAN', candidates: fake('ledblue',  BLUE_NAMES), rationale: null };
  const redPred   = { slot: 2, side: 'RED',  type: 'BAN', candidates: fake('ledred',   RED_NAMES),  rationale: null };
  // a 3rd, permanently-undecided slot keeps the derived active prediction non-empty
  // after red settles, so the demo doesn't blank itself mid-hold
  const thirdPred = { slot: 3, side: 'BLUE', type: 'BAN', candidates: fake('ledblue3', BLUE_NAMES), rationale: null };
  const fakeData = {
    blueTeam: { name: 'BLUE' }, redTeam: { name: 'RED' }, currentSlot: 3,
    predictions: [bluePred, redPred, thirdPred],
    draftState: { blueBans: ['ledblue_2'], redBans: ['ledred_3'], bluePicks: [], redPicks: [] },
  };
  dpHoldTest();
  hideTeamHP(); hideWinRate(); hideTeamFight();
  dpHalt(); dpClearColumns();
  dpActiveData = fakeData;
  dpTestUsedFake = true;
  dpUserHidden = false;
  dpShowFeature();
  dpPickQueue = [
    { heroId: 'ledblue_2', side: 'blue', type: 'ban', pred: bluePred, occurrence: 0 },
    { heroId: 'ledred_3',  side: 'red',  type: 'ban', pred: redPred,  occurrence: 0 },
  ];
  dpProcessQueue(fakeData);
}

/* HOME/SWAP flips which column is which team: reload the active prediction
   into the right column instead of leaving it under the wrong team. */
function dpOnSwap() {
  if (dpUserHidden || !dpActiveData) return;
  dpHalt(); dpPickQueue = [];
  dpClearColumns();
  const latest = dpPickToShow(dpActiveData);
  if (latest) dpRenderPrediction(latest, dpActiveData);
}


/* ─────────────────────────────────────────────
   PLATE EVENTS — mploverlay_v7 "eventer" style
   One card per plate (built by JS into #plate-N). Per-player:
   isPlaying guard + one queue slot per event type; cleanup() always
   runs once and drains the queue (playNextQueued), with a safety-net
   timeout in case the normal path never fires — same contract as
   overlay-lvl15.js's triggerLvl15 reference.
───────────────────────────────────────────── */
const isPlaying    = {};   // plate → bool
const queueItem    = {};   // plate → payload
const queueTrinity = {};
const queueSwap    = {};
const queueLvl15   = {};
const queueConceal = {};   // campId → payload
const queueSky     = {};   // plate → payload (Sky Piercer stacks)
const prevSkyMilestone = {};   // seat → highest Sky Piercer milestone already shown (0 = none)

const SWAP_ARROW = c => `<svg viewBox="0 0 40 40" width="100%" height="100%">` +
  `<path d="M 6.4 13.7 A 15 15 0 0 1 32.3 11.4 L 31.6 16.9 L 26.6 15.4 A 8 8 0 0 0 12.8 16.6 Z" fill="${c}"/>` +
  `<path d="M 33.6 26.3 A 15 15 0 0 1 7.7 28.6 L 8.4 23.1 L 13.5 24.6 A 8 8 0 0 0 27.3 23.4 Z" fill="${c}"/></svg>`;

const evRefs = {};
function buildPlateEvent(n) {
  const plate = document.getElementById(`plate-${n}`);
  if (!plate) return;
  const clip = document.createElement('div');
  clip.className = 'led-evt-clip';
  clip.id = `led-evt-${n}`;
  const card = document.createElement('div');
  card.className = 'led-evt-card';
  card.innerHTML =
    `<img class="led-evt-bg" src="assets/led/eventback.png" alt="">` +
    `<span class="led-evt-label"></span>` +
    `<span class="led-evt-value"></span>` +
    `<div class="led-evt-time"><span class="led-evt-time-num">--:--</span><span class="led-evt-time-unit">MIN</span></div>` +
    `<div class="led-evt-p2"><span class="led-evt-p2-time"></span><span class="led-evt-p2-line"><span class="led-evt-p2-arrow"></span><span class="led-evt-p2-text"></span></span></div>` +
    [0,1,2].map(i => `<div class="led-evt-box" data-i="${i}"><img class="led-evt-icon" alt=""><div class="led-evt-sheen"></div></div>`).join('') +
    `<div class="led-evt-swapicon">${SWAP_ARROW(n >= 6 ? '#e80b00' : '#005bff')}</div>`;
  clip.appendChild(card);
  plate.appendChild(clip);
  evRefs[n] = {
    clip,
    label:    card.querySelector('.led-evt-label'),
    value:    card.querySelector('.led-evt-value'),
    timeNum:  card.querySelector('.led-evt-time-num'),
    timeUnit: card.querySelector('.led-evt-time-unit'),
    p2Time:   card.querySelector('.led-evt-p2-time'),
    p2Arrow:  card.querySelector('.led-evt-p2-arrow'),
    p2Text:   card.querySelector('.led-evt-p2-text'),
    boxes:    [...card.querySelectorAll('.led-evt-box')],
    icons:    [...card.querySelectorAll('.led-evt-icon')],
    sheens:   [...card.querySelectorAll('.led-evt-sheen')],
    swapIcon: card.querySelector('.led-evt-swapicon'),
  };
  isPlaying[n] = false;
}

function setIcon(img, src, fallback) {
  img.onerror = () => { img.onerror = null; img.src = fallback || 'items/99999.png'; };
  img.src = src;
}
function itemIcon(img, id) { setIcon(img, id ? `items/${id}.png` : 'items/99999.png'); }

function resetCard(r) {
  r.clip.classList.remove('evt-in', 'led-p2', 'led-slower');
  r.timeUnit.textContent = 'MIN';
  r.sheens.forEach(s => s.classList.remove('sweep'));
  r.boxes.forEach(b => b.classList.remove('swap-out', 'swap-center'));
  r.swapIcon.classList.remove('swap-out');
  r.icons.forEach(i => i.classList.remove('dimmed'));
}

/* Core-item timing (Trinity's core_item / First Item Priority's first_item, same shape):
   { difference (neg = faster), fastestTime, status: 'faster'|'late'|'no_data'|…, time }.
   Returns { timeStr, slower, text } or null when there is nothing to show. */
function coreItemPhase2(core) {
  if (!core || core.status === 'no_data') return null;
  const time = parseInt(core.time) || 0, fastest = parseInt(core.fastestTime) || 0;
  let diff = Math.abs(parseInt(core.difference) || 0);
  if (!time || !fastest) return null;
  if (!diff) diff = Math.abs(time - fastest);
  if (!diff) return null;
  const slower = core.status === 'late' ? true : (time > fastest);
  return { timeStr: Math.floor(time / 60) + ':' + String(time % 60).padStart(2, '0'), slower, text: diff + 's ' + (slower ? 'SLOWER' : 'FASTER') };
}
function getTimingData(player, key) {
  return (player && ((player.extra_param && player.extra_param[key]) || player[key])) || null;
}
/* p2fn for runCard: p.core given (debug) → use it (null = force no data); else read the latest poll for that plate's seat */
function timingFor(plate, p, key) {
  if (p.core !== undefined) return coreItemPhase2(p.core);
  const pl = lastData ? getPlayerFromSeat(lastData, seatToPlate(plate)) : null;   // seatToPlate is its own inverse
  return coreItemPhase2(getTimingData(pl, key));
}

/* Shared runner: show → hold 2400ms → wipe out 350ms → cleanup.
   Optional p2fn: checked 1.5s in; if it returns a view model the title strip fades to the timing line
   (phase 2) and the card holds until 4200ms instead; null → leaves at 2400ms exactly as before. */
function runCard(plate, kind, guardMs, setup, schedule, p2fn) {
  const r = evRefs[plate];
  if (!r) return;                 // Led_draft.html has no player plates, so no plate events to show
  isPlaying[plate] = true;
  const timers = [];
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    timers.forEach(clearTimeout);
    resetCard(r);
    r.clip.style.display = 'none';
    isPlaying[plate] = false;
    playNextQueued(plate);
  };
  later(cleanup, p2fn ? guardMs + 3000 : guardMs);          // safety net

  resetCard(r);
  r.clip.dataset.kind = kind;
  setup(r);
  r.clip.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => r.clip.classList.add('evt-in')));
  schedule(r, later);
  const leave = () => { r.clip.classList.remove('evt-in'); later(cleanup, 350); };
  if (p2fn) {
    later(() => {
      let m = null;
      try { m = p2fn(); } catch (e) {}
      if (!m) return;
      r.p2Time.textContent  = m.timeStr;
      r.p2Arrow.textContent = m.slower ? '▼' : '▲';
      r.p2Text.textContent  = m.text;
      r.clip.classList.toggle('led-slower', m.slower);
      r.clip.classList.add('led-p2');
    }, 1500);
    later(() => { if (!r.clip.classList.contains('led-p2')) leave(); }, 2400);
    later(() => { if (r.clip.classList.contains('led-p2')) leave(); }, 4200);
  } else {
    later(leave, 2400);
  }
}

function playNextQueued(plate) {
  if (queueTrinity[plate]) {
    const q = queueTrinity[plate]; delete queueTrinity[plate];
    setTimeout(() => triggerTrinity(plate, q), 300);
  } else if (queueSwap[plate]) {
    const q = queueSwap[plate]; delete queueSwap[plate];
    setTimeout(() => triggerSwap(plate, q), 300);
  } else if (queueItem[plate]) {
    const q = queueItem[plate]; delete queueItem[plate];
    setTimeout(() => triggerItem(plate, q), 300);
  } else if (queueSky[plate]) {
    const q = queueSky[plate]; delete queueSky[plate];
    setTimeout(() => triggerSkyPiercer(plate, q), 300);
  } else if (queueLvl15[plate]) {
    const q = queueLvl15[plate]; delete queueLvl15[plate];
    setTimeout(() => triggerLvl15(plate, q), 300);
  } else {
    const campId = [1, 2].find(cid => concealPlateForCamp(cid) === plate);
    if (campId && queueConceal[campId]) {
      const q = queueConceal[campId]; delete queueConceal[campId];
      setTimeout(() => triggerConceal(campId, q), 300);
    }
  }
}

function triggerItem(plate, p) {
  if (isPlaying[plate]) { queueItem[plate] = p; return; }
  runCard(plate, 'item', 3500, r => {
    r.label.textContent   = 'FIRST ITEM PRIORITY';
    r.timeNum.textContent = p.timeStr || '--:--';
    itemIcon(r.icons[0], p.itemId);
  }, (r, later) => later(() => r.sheens[0].classList.add('sweep'), 400), () => timingFor(plate, p, 'first_item'));
}

/* Sky Piercer stacks: same card as First Item Priority, "N STACKS" in the time slot. Fires at stack 3, 5, 7, … */
const SKYPIERCER_ITEM_ID = '2014';
function getSkyPiercerStack(player) {
  const o = (player && player.extra_param && player.extra_param.sky_piercer_stack) || (player && player.sky_piercer_stack);
  return o ? (parseInt(o.stack) || 0) : 0;
}
function skyPiercerMilestone(stack) { return stack >= 3 ? (stack % 2 ? stack : stack - 1) : 0; }
function triggerSkyPiercer(plate, p) {
  if (isPlaying[plate]) { queueSky[plate] = p; return; }
  runCard(plate, 'skypiercer', 3500, r => {
    r.label.textContent    = 'SKY PIERCER';
    r.timeNum.textContent  = String(p.stacks);
    r.timeUnit.textContent = 'STACKS';
    itemIcon(r.icons[0], SKYPIERCER_ITEM_ID);
  }, (r, later) => later(() => r.sheens[0].classList.add('sweep'), 400));
}

function isMarksmanTrinity(ids) {
  const s = new Set(ids);
  return MARKSMAN_TRINITY_IDS.size === s.size && [...MARKSMAN_TRINITY_IDS].every(id => s.has(id));
}
function trinityLabel(seatNum, t3ItemIds) {
  return (seatNum === 5 && isMarksmanTrinity(t3ItemIds)) ? 'MARKSMAN TRINITY' : 'CORE ITEMS ACHIEVED';
}
function triggerTrinity(plate, p) {
  if (isPlaying[plate]) { queueTrinity[plate] = p; return; }
  runCard(plate, 'trinity', 3500, r => {
    r.label.textContent = p.label || 'CORE ITEMS ACHIEVED';
    r.label.classList.toggle('big', p.label === 'MARKSMAN TRINITY');
    r.icons.forEach((img, i) => itemIcon(img, p.t3ItemIds[i]));
  }, (r, later) => r.sheens.forEach((sh, i) => later(() => sh.classList.add('sweep'), 400 + i * 120)), () => timingFor(plate, p, 'core_item'));
}

function triggerSwap(plate, p) {
  if (isPlaying[plate]) { queueSwap[plate] = p; return; }
  runCard(plate, 'swap', 4000, r => {
    r.label.textContent = 'QUICK SWAP';
    itemIcon(r.icons[0], p.soldId);
    r.icons[0].classList.add('dimmed');           // the item being replaced — 20% darker
    itemIcon(r.icons[1], p.boughtId);
  }, (r, later) => {
    later(() => {                                  // sold item out, bought item recenters
      r.boxes[0].classList.add('swap-out');
      r.boxes[1].classList.add('swap-center');
      r.swapIcon.classList.add('swap-out');
    }, 450);
    later(() => r.sheens[1].classList.add('sweep'), 850);
  });
}

function triggerLvl15(plate, p) {
  if (isPlaying[plate]) { queueLvl15[plate] = p; return; }
  runCard(plate, 'lvl15', 3500, r => {
    r.label.textContent = 'LEVEL 15 ACHIEVED IN';
    r.value.textContent = `${p.timeStr || '--:--'} MIN`;
  }, () => {});
}

function triggerConceal(campId, p) {
  const plate = concealPlateForCamp(campId);
  if (isPlaying[plate]) { queueConceal[campId] = p; return; }
  runCard(plate, 'conceal', 3500, r => {
    r.label.textContent   = `${CONCEAL_CAT_LABEL[p.category] || 'CONCEAL'} ACTIVATED`;
    r.timeNum.textContent = p.timeStr || '--:--';
    setIcon(r.icons[0], CONCEAL_CAT_IMG[p.category] || CONCEAL_CAT_IMG.conceal, '');
  }, (r, later) => later(() => r.sheens[0].classList.add('sweep'), 400));
}

/* ── Roaming-boot category detection (Conceal) ── */
function detectRoamingBootCat(itemId) {
  for (const [cat, ids] of Object.entries(ROAMING_BOOT_CATS)) {
    if (ids.has(String(itemId))) return cat;
  }
  return null;
}
function getCampRoamingCategory(camp) {
  const SEAT_KEYS = ['seat_1','seat_2','seat_3','seat_4','seat_5'];
  for (const key of SEAT_KEYS) {
    const seat = camp[key];
    if (!seat) continue;
    for (const item of (seat.equip_list || []).slice(0, 6)) {
      const cat = detectRoamingBootCat(item.value);
      if (cat) return cat;
    }
  }
  const rtMap = { conceal:'conceal', encourage:'encourage', favor:'favor', direhit:'direhit', 'dire hit':'direhit' };
  for (const key of SEAT_KEYS) {
    const seat = camp[key];
    if (!seat?.roaming_type) continue;
    const cat = rtMap[seat.roaming_type.toLowerCase()];
    if (cat) return cat;
  }
  return 'conceal';
}

/* ─────────────────────────────────────────────
   DETECTION — per-seat previous state (stable across HOME/SWAP flips),
   each event gated by its own led_* feature toggle.
───────────────────────────────────────────── */
const trinityFired     = {};   // seat → bool
const prevEquipState   = {};   // seat → string[]
const prevLevel        = {};   // seat → int
const prevTotalDamage  = {};   // seat → int
const combatHistory    = {};   // seat → int[]
const prevBlessingGold = {};   // campId → int

function resetGameState() {
  for (let s = 1; s <= 10; s++) {
    trinityFired[s] = false;
    delete prevLevel[s]; delete prevEquipState[s]; delete prevTotalDamage[s]; delete prevSkyMilestone[s];
    combatHistory[s] = [];
  }
  for (let p = 1; p <= 10; p++) {
    delete queueItem[p]; delete queueSky[p]; delete queueTrinity[p]; delete queueSwap[p]; delete queueLvl15[p];
  }
  [1, 2].forEach(c => { delete prevBlessingGold[c]; delete queueConceal[c]; });
}

registerPollHandler(function (data) {
  const timeStr = formatTime(data.game_time || 0);
  for (let seat = 1; seat <= 10; seat++) {
    const player = getPlayerFromSeat(data, seat);
    if (!player) continue;
    const plate   = seatToPlate(seat);
    const seatNum = seat <= 5 ? seat : seat - 5;
    const equipIds = (player.equip_list || []).slice(0, 6)
      .map(e => normalizeId(e?.value)).filter(Boolean);

    const dmg = parseInt(player.total_damage) || 0;
    if (prevTotalDamage[seat] !== undefined) {
      const delta = dmg - prevTotalDamage[seat];
      if (!combatHistory[seat]) combatHistory[seat] = [];
      combatHistory[seat].push(delta > 0 ? delta : 0);
      if (combatHistory[seat].length > 3) combatHistory[seat].shift();
    }
    prevTotalDamage[seat] = dmg;

    const prev = prevEquipState[seat];
    if (prev) {
      const currentT3 = equipIds.filter(id => TIER3_IDS.has(id));
      const prevT3    = prev.filter(id => TIER3_IDS.has(id));

      if (!trinityFired[seat]) {
        if (currentT3.length === 3 && prevT3.length === 2) {
          trinityFired[seat] = true;
          if (featureEnabled.led_trinity)
            triggerTrinity(plate, { t3ItemIds: currentT3, label: trinityLabel(seatNum, currentT3) });
        } else if (currentT3.length === 1 && prevT3.length === 0 && featureEnabled.led_items) {
          const newItemId = equipIds.find(id => TIER3_IDS.has(id) && !prev.includes(id));
          if (newItemId) triggerItem(plate, { itemId: newItemId, timeStr });
        }
      }

      const soldT3   = prevT3.filter(id => !currentT3.includes(id));
      const boughtT3 = currentT3.filter(id => !prevT3.includes(id));
      if (featureEnabled.led_swap && soldT3.length === 1 && boughtT3.length === 1 &&
          combatHistory[seat]?.some(d => d > 0)) {
        triggerSwap(plate, { soldId: soldT3[0], boughtId: boughtT3[0] });
      }
    }
    prevEquipState[seat] = [...equipIds];

    const lvl     = parseInt(player.level) || 0;
    const prevLvl = prevLevel[seat];
    if (featureEnabled.led_lvl15 && prevLvl !== undefined && prevLvl < 15 && lvl >= 15) {
      triggerLvl15(plate, { timeStr });
    }
    prevLevel[seat] = lvl;

    /* Sky Piercer stacks: first poll = baseline; a drop re-arms (death / item sold) */
    const skyMs = skyPiercerMilestone(getSkyPiercerStack(player));
    const skyPrev = prevSkyMilestone[seat];
    if (skyPrev === undefined || skyMs < skyPrev) prevSkyMilestone[seat] = skyMs;
    else if (skyMs > skyPrev) {
      prevSkyMilestone[seat] = skyMs;
      if (featureEnabled.led_skypiercer) triggerSkyPiercer(plate, { stacks: skyMs });
    }
  }

  for (const campId of [1, 2]) {
    const camp = (data.camp_list || []).find(c => c.campid === campId);
    if (!camp) continue;
    const bg   = camp.blessing_gold || 0;
    const prev = prevBlessingGold[campId];
    if (featureEnabled.led_conceal && prev !== undefined && prev < 1000 && bg >= 1000) {
      triggerConceal(campId, { category: getCampRoamingCategory(camp), timeStr });
    }
    prevBlessingGold[campId] = bg;
  }
});

/* ─────────────────────────────────────────────
   MID-PANEL REEL — keeps the default mid panels (logo + team name) in step
   with the feature panels' ledReelIn/ledReelOut (see led_overlay.html CSS).
   Watches the four feature elements: while any is showing (display on and
   not in its *-leaving phase) the default panels sit pushed below the
   frame; when none is, they drop back in from the top. A direct switch
   A → B leaves the defaults alone (A drops out, B drops in).
───────────────────────────────────────────── */
(function initMidReel() {
  const feats = ['feature-teamhp', 'feature-winrate', 'feature-teamfight', 'feature-draftpredict']
    .map(id => document.getElementById(id)).filter(Boolean);
  const win   = document.getElementById('led-reel-window');
  const mids  = ['mid-left', 'mid-right'].map(id => document.getElementById(id)).filter(Boolean);
  if (!feats.length || !mids.length) return;
  let pushed = false;
  const anyActive = () => feats.some(f =>
    getComputedStyle(f).display !== 'none' && !/-leaving\b/.test(f.className));
  const sync = () => {
    const want = anyActive();
    if (want === pushed) return;
    pushed = want;
    if (win) win.classList.toggle('led-reel-on', pushed);
    mids.forEach(m => {
      m.classList.remove('led-mid-out', 'led-mid-back');
      void m.offsetWidth;
      if (pushed) m.classList.add('led-mid-out');
      else {
        m.classList.add('led-mid-back');
        m.addEventListener('animationend', () => m.classList.remove('led-mid-back'), { once: true });
      }
    });
  };
  const mo = new MutationObserver(sync);
  feats.forEach(f => mo.observe(f, { attributes: true, attributeFilter: ['class', 'style'] }));
})();

/* ─────────────────────────────────────────────
   PUBLIC HOOKS (called by led_overlay.html)
───────────────────────────────────────────── */
function onData(data) {
  if (!data || !data.camp_list) return;
  const bid = data.battleid || data.roomname || null;
  if (bid && prevBattleId && bid !== prevBattleId) resetGameState();
  if (bid) prevBattleId = bid;
  lastData = data;
  pollHandlers.forEach(fn => { try { fn(data); } catch (e) {} });
}
function setSwapped(v) { const ch = isSwapped !== !!v; isSwapped = !!v; if (ch) dpOnSwap(); }

/* ─────────────────────────────────────────────
   SSE — panel show/hide + event arm/disarm
───────────────────────────────────────────── */
const ledSse = createOverlaySSE();
const bindShowHide = (name, show, hide) => ledSse.addEventListener(name, e => {
  try { const d = JSON.parse(e.data); if (d.action === 'show') show(); else hide(); } catch {}
});
bindShowHide('led_health',    showTeamHP,       hideTeamHP);
bindShowHide('led_win',       showWinRate,      hideWinRate);
bindShowHide('led_fight',     showTeamFight,    hideTeamFight);
ledSse.addEventListener('led_draftpred', e => {
  try {
    const d = JSON.parse(e.data);
    if (d.action === 'show') showDraftPredict();
    else if (d.action === 'test_reveal') dpTestReveal();
    else if (d.action === 'test_slot') dpTestSlot(d.slot, d.mode);
    else if (d.action === 'hide') hideDraftPredict();
    // any other action (e.g. Led_draft's 'photo_mode') is not for this panel — ignore it
  } catch {}
});
ledSse.addEventListener('featuretoggle', e => {
  try {
    const d = JSON.parse(e.data);
    if (d.feature in featureEnabled) featureEnabled[d.feature] = !!d.enabled;
  } catch {}
});

/* ─────────────────────────────────────────────
   DEBUG UI — appended to led_overlay's ` panel
───────────────────────────────────────────── */
function dbgLivePlayer(plate) {
  return lastData ? getPlayerFromSeat(lastData, isSwapped ? (plate <= 5 ? plate + 5 : plate - 5) : plate) : null;
}
function dbgT3s(plate) {
  const pl = dbgLivePlayer(plate);
  return ((pl && pl.equip_list) || []).slice(0, 6).map(e => normalizeId(e?.value)).filter(id => id && TIER3_IDS.has(id));
}
function dbgTime() { return formatTime((lastData && lastData.game_time) || 0); }

function buildDebugUI() {
  const panel = document.getElementById('debug-panel');
  if (!panel) return;
  const hint = panel.querySelector('.dbg-hint');
  const wrap = document.createElement('div');
  const title = t => { const d = document.createElement('div'); d.className = 'dbg-title'; d.style.marginTop = '12px'; d.textContent = t; wrap.appendChild(d); };
  const row = (cls) => { const d = document.createElement('div'); d.className = 'dbg-row'; if (cls) d.style.flexWrap = 'wrap'; wrap.appendChild(d); return d; };
  const btn = (parent, text, fn, cls) => { const b = document.createElement('div'); b.className = 'dbg-btn ' + (cls || ''); b.textContent = text; b.addEventListener('click', fn); parent.appendChild(b); return b; };
  const perPlate = (name, fn) => {
    title(name);
    [[1, 5], [6, 10]].forEach(([a, z]) => { const r = row(); for (let n = a; n <= z; n++) btn(r, 'P' + n, () => fn(n), n <= 5 ? '' : 'red'); });
  };

  if (document.getElementById('plate-1')) {   // plate-event buttons only make sense where plates exist
  title('Plate events — armed toggles live in the dashboard Control tab');
  perPlate('First item priority', n => triggerItem(n, { itemId: dbgT3s(n)[0] || '3001', timeStr: dbgTime() }));
  perPlate('Item priority · fake 24s FASTER', n => triggerItem(n, { itemId: dbgT3s(n)[0] || '3001', timeStr: dbgTime(), core: { status: 'faster', time: 215, fastestTime: 239, difference: -24 } }));
  perPlate('Item priority · fake 12s SLOWER', n => triggerItem(n, { itemId: dbgT3s(n)[0] || '3001', timeStr: dbgTime(), core: { status: 'late', time: 539, fastestTime: 527, difference: 12 } }));
  perPlate('Sky Piercer (stacks 3)', n => triggerSkyPiercer(n, { stacks: 3 }));
  perPlate('Sky Piercer (stacks 12)', n => triggerSkyPiercer(n, { stacks: 12 }));
  perPlate('Trinity', n => {
    const t = [...dbgT3s(n), ...TRINITY_DEBUG_ITEMS].slice(0, 3);
    triggerTrinity(n, { t3ItemIds: t, label: trinityLabel(n <= 5 ? n : n - 5, t) });
  });
  perPlate('Trinity · fake 33s FASTER', n => triggerTrinity(n, { t3ItemIds: [...TRINITY_DEBUG_ITEMS], label: 'CORE ITEMS ACHIEVED', core: { status: 'faster', time: 500, fastestTime: 533, difference: -33 } }));
  perPlate('Trinity · fake 12s SLOWER', n => triggerTrinity(n, { t3ItemIds: [...TRINITY_DEBUG_ITEMS], label: 'CORE ITEMS ACHIEVED', core: { status: 'late', time: 539, fastestTime: 527, difference: 12 } }));
  const mk = row();
  btn(mk, 'Marksman trinity (P5)', () => triggerTrinity(5, { t3ItemIds: [...MARKSMAN_TRINITY_IDS], label: 'MARKSMAN TRINITY' }), 'purple');
  perPlate('Quick swap', n => triggerSwap(n, { soldId: dbgT3s(n)[0] || '3001', boughtId: SWAP_DEBUG_BOUGHT }));
  perPlate('Level 15', n => triggerLvl15(n, { timeStr: dbgTime() }));
  title('Conceal (camp 1 = P4, camp 2 = P9)');
  [1, 2].forEach(c => {
    const r = row(true);
    btn(r, 'C' + c + ' API', () => {
      const camp = lastData && (lastData.camp_list || []).find(x => x.campid === c);
      triggerConceal(c, { category: camp ? getCampRoamingCategory(camp) : 'conceal', timeStr: dbgTime() });
    }, 'orange');
    Object.keys(CONCEAL_CAT_LABEL).forEach(cat => btn(r, CONCEAL_CAT_LABEL[cat], () => triggerConceal(c, { category: cat, timeStr: dbgTime() }), c === 1 ? '' : 'red'));
  });

  }

  title('Side panels');
  const pr = (label, show, hide) => { const r = row(); btn(r, label + ' SHOW', show, 'green'); btn(r, 'HIDE', hide, 'red'); };
  pr('Team HP', showTeamHP, hideTeamHP);
  pr('Win Prob', showWinRate, hideWinRate);
  pr('Team Fight', showTeamFight, hideTeamFight);
  pr('Draft Predict', showDraftPredict, hideDraftPredict);
  const hp = row(true);
  btn(hp, 'HP L −15%', () => setTeamHP('left',  thpSt.left.cur  - 0.15));
  btn(hp, 'HP R −15%', () => setTeamHP('right', thpSt.right.cur - 0.15));
  btn(hp, 'HP reset', () => { resetTeamHP('left'); resetTeamHP('right'); });
  const wp = row(true);
  btn(wp, 'WIN L +10%', () => setWinRate('left',  Math.min(1, wprSt.left.cur  + 0.10)));
  btn(wp, 'WIN R +10%', () => setWinRate('right', Math.min(1, wprSt.right.cur + 0.10)));
  btn(wp, 'WIN reset', () => { resetWinRate('left'); resetWinRate('right'); });
  const dp = row(true);
  btn(dp, 'DP pick #1', () => dpTestPick(1));
  btn(dp, 'DP pick #3', () => dpTestPick(3));
  btn(dp, 'DP reset', () => { [dpLeftC, dpRightC].forEach(c => { if (c) c.reset(); }); });

  panel.insertBefore(wrap, hint);
}

function dpTestPick(rank) {
  const c = dpLeftC?.state === 'roulette' ? dpLeftC
          : dpRightC?.state === 'roulette' ? dpRightC
          : dpLeftC?.cardEls.length ? dpLeftC : dpRightC;
  if (!c || !c.cardEls.length) return;
  if (c.state === 'settling' || c.state === 'picked') { c.reset(); setTimeout(() => dpTestPick(rank), 100); return; }
  const idx = Math.min(rank - 1, c.cardEls.length - 1);
  c.settle(c.cardEls[idx].dataset.heroId, null);
}

/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
for (let n = 1; n <= 10; n++) { buildPlateEvent(n); trinityFired[n] = false; combatHistory[n] = []; }
/* The panels start hidden via CSS, but several guards below (renderTfd, the
   Team HP poll handler, pollWinRate) test el.style.display === 'none' — which
   is false until the first show. Without this they ran while invisible, and
   pollWinRate hit the server every second for nothing. */
['feature-teamhp', 'feature-winrate', 'feature-teamfight', 'feature-draftpredict']
  .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
initThpRefs();
initWprRefs();
initTfdSlots();
dpLeftC  = createDpCarousel(document.getElementById('dp-col-left'));
dpRightC = createDpCarousel(document.getElementById('dp-col-right'));
/* v3 operating model: poll from load (shown or not) so a later Show never
   replays history; restore the server-side shown state on (re)load. */
fetch('/overlay/check-overlays', { cache: 'no-store' }).then(r => r.json())
  .then(d => { if (d && d.led_draftpred) dpApplyCmd('show'); }).catch(() => {});
dpFetchLive();
setInterval(dpFetchLive, DP_POLL_MS);
setInterval(pollWinRate, 1000);
buildDebugUI();

window.LedEvents = { onData, setSwapped };
})();
