/* ── [FEATURE: fight-recap] ── */
var allFights  = [];
var debugIdx   = -1;
var feedData   = null;
var lastActionTs = 0;
var fightPollTimer = null;

var fightOverlay = document.getElementById('fight-overlay');

function fightAnimateIn() {
  fightOverlay.style.display = 'flex';
  fightOverlay.classList.remove('out');
  fightOverlay.style.opacity    = '';
  fightOverlay.style.visibility = '';
  void fightOverlay.offsetWidth;
  fightOverlay.classList.add('in');
}

function fightAnimateOut() {
  fightOverlay.classList.remove('in');
  fightOverlay.classList.add('out');
  fightOverlay.addEventListener('animationend', () => {
    fightOverlay.classList.remove('out');
    fightOverlay.style.opacity    = '0';
    fightOverlay.style.visibility = 'hidden';
    fightOverlay.style.display    = 'none';
  }, { once: true });
}

function fmtDmg(n) {
  if (!n) return '0';
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function fmtDur(s) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function ccBadge(control_s) {
  if (!control_s || control_s < 3) return '';
  const svg = `<svg width="18" height="18" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="10" fill="#7c3aed"/>
    <circle cx="10" cy="10" r="5.5" fill="none" stroke="#fff" stroke-width="1.3"/>
    <line x1="10" y1="10" x2="10" y2="6.2" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="10" y1="10" x2="12.8" y2="10" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`;
  return `<div class="cc-badge">${svg}<span class="cc-count">${Math.round(control_s)}s CC</span></div>`;
}

function killBadge(kills) {
  if (!kills || kills <= 0) return '';
  const svg = `<svg width="18" height="18" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="10" fill="#000"/>
    <g transform="rotate(45 10 10)" fill="#fff">
      <polygon points="10,2 11,6 10.5,12 9.5,12 9,6"/>
      <rect x="6.5" y="12" width="7" height="1.5" rx="0.5"/>
      <rect x="9.25" y="13.5" width="1.5" height="3" rx="0.5"/>
      <rect x="8.5" y="16.5" width="3" height="1.5" rx="0.75"/>
    </g>
  </svg>`;
  const count = kills > 1 ? `<span class="kill-count">x${kills}</span>` : '';
  return `<div class="kill-badge">${svg}${count}</div>`;
}

var _fightMc = document.createElement('canvas').getContext('2d');
var FIGHT_NAME_MAX_W = 76;

function calcNameSize(name) {
  _fightMc.font = `600 15px 'General Sans', system-ui, sans-serif`;
  var w = _fightMc.measureText(name).width;
  if (w <= FIGHT_NAME_MAX_W) return 15;
  return Math.max(7, Math.floor(15 * FIGHT_NAME_MAX_W / w));
}

function fightHeroImgUrl(id) {
  if (!id) return null;
  return `hero/HERO_${id}_KOTAK.png`;
}

function renderFight(fight, feed) {
  document.getElementById('fight-time').textContent = fight.start_time_fmt;
  document.getElementById('fight-dur').textContent  = fmtDur(fight.duration_s) + ' Fight Duration';

  var c1 = fight.players.filter(p => p.camp === 1).sort((a, b) => a.seat - b.seat);
  var c2 = fight.players.filter(p => p.camp === 2).sort((a, b) => a.seat - b.seat);
  var maxDmg = Math.max(1, ...fight.players.map(p => p.dmg_dealt));

  function rowHTML(p) {
    var bar      = Math.round((p.dmg_dealt / maxDmg) * 100);
    var imgUrl   = fightHeroImgUrl(p.hero_id);
    var heroEl   = imgUrl
      ? `<img class="hero-img" src="${imgUrl}" alt="${p.hero || ''}">`
      : `<div class="hero-placeholder">${(p.hero || '?').charAt(0)}</div>`;
    var name     = p.name || '—';
    var fontSize = calcNameSize(name);
    return `<div class="player-row${p.survived ? '' : ' dead'}">
      ${heroEl}
      <div class="p-name" style="font-size:${fontSize}px">${name}</div>
      <div class="badges">${ccBadge(p.control_s)}${killBadge(p.kills)}</div>
      <div class="dmg-area">
        <div class="dmg-bar-bg"><div class="dmg-bar-fill" style="width:${bar}%"></div></div>
        <div class="dmg-num">${fmtDmg(p.dmg_dealt)}</div>
        <div class="dmg-pct">${p.dmg_share}%</div>
      </div>
    </div>`;
  }

  document.getElementById('camp1').innerHTML = c1.map(rowHTML).join('');
  document.getElementById('camp2').innerHTML = c2.map(rowHTML).join('');

  var c1gold = c1.reduce((sum, p) => sum + (p.gold_earned || 0), 0);
  var c2gold = c2.reduce((sum, p) => sum + (p.gold_earned || 0), 0);
  document.getElementById('c1-gold').textContent = c1gold.toLocaleString();
  document.getElementById('c2-gold').textContent = c2gold.toLocaleString();
}

async function fightPoll() {
  try {
    var [fightRes, feedRes] = await Promise.all([
      fetch('/fights?all=1'),
      fetch('/feed/order').catch(() => null),
    ]);
    var fightData = await fightRes.json();
    feedData  = feedRes ? await feedRes.json().catch(() => null) : null;
    allFights = fightData.fights || [];

    if (allFights.length) {
      debugIdx = allFights.length - 1;
    }
  } catch (e) {}
}

async function pollAction() {
  try {
    var r = await fetch('/overlay/fights/pending');
    var { action, ts } = await r.json();
    if (action && ts && ts !== lastActionTs) {
      lastActionTs = ts;
      if (action === 'show') {
        if (allFights.length) { debugIdx = allFights.length - 1; renderFight(allFights[debugIdx], feedData); }
        fightAnimateIn();
      } else if (action === 'hide') {
        fightAnimateOut();
      }
    }
  } catch {}
}

function setMode(m) {
  clearInterval(fightPollTimer);
  allFights = [];
  debugIdx  = -1;
  fightPoll();
  fightPollTimer = setInterval(fightPoll, 2000);
}

setInterval(pollAction, 500);
pollAction();
setMode('live');
