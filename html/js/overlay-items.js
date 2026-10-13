/* ── First item priority "eventer" overlay ── */
function buildItemOverlay(i) {
  const side = i <= 5 ? 'home' : 'away';
  const pos  = i <= 5 ? i - 1 : i - 6;

  const clip = document.createElement('div');
  clip.className = side === 'away' ? 'evt-clip away' : 'evt-clip';
  clip.id = `fip-evt-${i}`;
  clip.style.left = (side === 'home' ? EVT_LEFT_HOME : EVT_LEFT_AWAY) + 'px';
  clip.style.top  = EVT_TOPS[pos] + 'px';

  const card = document.createElement('div');
  card.className = 'evt-card';

  const bg = document.createElement('img');
  bg.className = 'evt-bg';
  bg.src = document.documentElement.getAttribute('data-theme') === 'playoffs' ? 'assets/ingame/playoffs/ui/palyoffs_uistatback.png' : 'assets/ingame/eventerback.png';
  bg.alt = '';

  const label = document.createElement('span');
  label.className = 'evt-label';
  label.textContent = 'FIRST ITEM PRIORITY';

  const time = document.createElement('div');
  time.className = 'fip-time';
  const timeNum = document.createElement('span');
  timeNum.className = 'fip-time-num';
  timeNum.textContent = '--:--';
  const timeUnit = document.createElement('span');
  timeUnit.className = 'fip-time-unit';
  timeUnit.textContent = 'MIN';
  time.appendChild(timeNum);
  time.appendChild(timeUnit);

  const itemBox = document.createElement('div');
  itemBox.className = 'evt-item-box';
  itemBox.style.left = '109px';
  const itemIcon = document.createElement('img');
  itemIcon.className = 'evt-item-icon';
  itemIcon.alt = '';
  const sheen = document.createElement('div');
  sheen.className = 'evt-sheen';
  itemBox.appendChild(itemIcon);
  itemBox.appendChild(sheen);

  /* Phase 2 — same card/CSS as Trinity's (.trn-p2 / .trn-phase2 / .trn-slower in mploverlay_v7.css) */
  const p2 = document.createElement('div');
  p2.className = 'trn-p2 trn-p2-notime';   // time is already shown on the card, so phase 2 is arrow + seconds only
  const p2Time = document.createElement('span'); p2Time.className = 'trn-p2-time';
  const p2Arrow = document.createElement('span'); p2Arrow.className = 'trn-p2-arrow';
  const p2Text = document.createElement('span'); p2Text.className = 'trn-p2-text';
  p2.appendChild(p2Time); p2.appendChild(p2Arrow); p2.appendChild(p2Text);

  card.appendChild(bg);
  card.appendChild(label);
  card.appendChild(p2);
  card.appendChild(time);
  card.appendChild(itemBox);
  clip.appendChild(card);
  document.getElementById('scene').insertBefore(clip, document.getElementById('player-ui-overlay'));

  itemRefs[i] = { clip, timeNum, itemIcon, sheen, p2Time, p2Arrow, p2Text };
}

function resetItem(i) {
  const { clip, sheen } = itemRefs[i];
  clip.classList.remove('evt-in', 'trn-phase2');
  sheen.classList.remove('sweep');
}

/* First-item timing from the game feed: player.extra_param.first_item (or player.first_item) =
   { build_rate, difference (negative = faster), fastestTime, heroid, item, status: 'faster'|'late'|'no_data'|..., time }.
   Same phase-2 logic as Trinity's core_item (coreItemPhase2 in overlay-trinity.js). */
const FIRST_ITEM_KEYS = ['first_item'];
function getFirstItemData(player) {
  if (!player) return null;
  const ep = player.extra_param || {};
  for (const k of FIRST_ITEM_KEYS) { if (ep[k] && typeof ep[k] === 'object') return ep[k]; if (player[k] && typeof player[k] === 'object') return player[k]; }
  return null;
}

/* core: undefined = look it up in the latest poll when phase 2 is due, null = force "no data", object = use it */
function triggerItem(i, itemId, timeStr, core) {
  if (isPlayingItem[i]) return;
  isPlayingItem[i] = true;
  const btn = document.querySelector(`.item-debug-btn[data-player="${i}"]`);
  if (btn) btn.disabled = true;
  const { clip, timeNum, itemIcon, sheen, p2Time, p2Arrow, p2Text } = itemRefs[i];

  let outerGuard;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    resetItem(i);
    clip.style.display = 'none';
    isPlayingItem[i]    = false;
    if (btn) btn.disabled = false;
    playNextQueued(i);
  };
  outerGuard = setTimeout(cleanup, 6500);

  timeNum.textContent = timeStr || '--:--';
  itemIcon.src = itemId ? `Items/${itemId}.png` : '';
  resetItem(i);
  clip.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    clip.classList.add('evt-in');
  }));

  setTimeout(() => { sheen.classList.add('sweep'); }, 400); /* right after the slide-in settles */

  /* Phase 2 decided 1.5s in (lets a feed that publishes the timing a poll late still land); no data -> leaves at 2.4s as before. */
  setTimeout(() => {
    if (cleanedUp) return;
    let c = core;
    if (c === undefined) {
      const r = lastData ? getPlayerArranged(lastData, i) : null;
      c = r ? getFirstItemData(r.player) : null;
    }
    const p2 = coreItemPhase2(c);   // shared with overlay-trinity.js
    if (!p2) return;
    p2Time.textContent  = p2.timeStr;
    p2Arrow.textContent = p2.slower ? '▼' : '▲';
    p2Text.textContent  = p2.text;
    clip.classList.toggle('trn-slower', p2.slower);
    clip.classList.add('trn-phase2');
  }, 1500);

  const leave = () => {
    if (cleanedUp) return;
    clip.classList.remove('evt-in');
    setTimeout(cleanup, 350);
  };
  setTimeout(() => { if (!clip.classList.contains('trn-phase2')) leave(); }, 2400);
  setTimeout(() => { if (clip.classList.contains('trn-phase2')) leave(); }, 4200);
}
