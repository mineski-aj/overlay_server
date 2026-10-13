/* ── Trinity (core items / marksman trinity) "eventer" overlay ── */
const TRINITY_ITEM_LEFTS = [7, 55, 103]; /* measured off eventtrinityguide.png */

function buildTrinityOverlay(i) {
  const side = i <= 5 ? 'home' : 'away';
  const pos  = i <= 5 ? i - 1 : i - 6;

  const clip = document.createElement('div');
  clip.className = side === 'away' ? 'evt-clip away' : 'evt-clip';
  clip.id = `trinity-evt-${i}`;
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
  label.textContent = 'CORE ITEMS ACHIEVED';

  /* Phase 2 (only when the game feed has core_item timing data): TIME  ▲/▼  12s FASTER/SLOWER,
     sits exactly over the label strip and replaces it. */
  const p2 = document.createElement('div');
  p2.className = 'trn-p2';
  const p2Time = document.createElement('span'); p2Time.className = 'trn-p2-time';
  const p2Arrow = document.createElement('span'); p2Arrow.className = 'trn-p2-arrow';
  const p2Text = document.createElement('span'); p2Text.className = 'trn-p2-text';
  p2.appendChild(p2Time); p2.appendChild(p2Arrow); p2.appendChild(p2Text);

  card.appendChild(bg);
  card.appendChild(label);
  card.appendChild(p2);

  const items = TRINITY_ITEM_LEFTS.map(left => {
    const itemBox = document.createElement('div');
    itemBox.className = 'evt-item-box';
    itemBox.style.left = `${left}px`;
    const itemIcon = document.createElement('img');
    itemIcon.className = 'evt-item-icon';
    itemIcon.alt = '';
    const sheen = document.createElement('div');
    sheen.className = 'evt-sheen';
    itemBox.appendChild(itemIcon);
    itemBox.appendChild(sheen);
    card.appendChild(itemBox);
    return { itemIcon, sheen };
  });

  clip.appendChild(card);
  document.getElementById('scene').insertBefore(clip, document.getElementById('player-ui-overlay'));

  trinityRefs[i] = { clip, label, items, p2, p2Time, p2Arrow, p2Text };
}

function resetTrinity(i) {
  const { clip, items } = trinityRefs[i];
  clip.classList.remove('evt-in', 'trn-phase2');
  items.forEach(({ sheen }) => sheen.classList.remove('sweep'));
}

/* core_item = { difference, fastestTime, status: 'late'|'no_data'|..., time, item_1..3 } from the game feed
   (player.extra_param.core_item or player.core_item). Returns the phase-2 view model or null (no data). */
function getCoreItem(player) {
  return (player && ((player.extra_param && player.extra_param.core_item) || player.core_item)) || null;
}
function coreItemPhase2(core) {
  if (!core || core.status === 'no_data') return null;
  const time = parseInt(core.time) || 0, fastest = parseInt(core.fastestTime) || 0;
  let diff = Math.abs(parseInt(core.difference) || 0);
  if (!time || !fastest) return null;
  if (!diff) diff = Math.abs(time - fastest);
  if (!diff) return null;
  const slower = core.status === 'late' ? true : (time > fastest);
  const m = Math.floor(time / 60), s = time % 60;
  return { timeStr: m + ':' + String(s).padStart(2, '0'), slower, text: diff + 's ' + (slower ? 'SLOWER' : 'FASTER') };
}

/* core: undefined = look it up in the latest poll when phase 2 is due, null = force "no data", object = use it */
function triggerTrinity(i, t3ItemIds, label, core) {
  if (isPlayingTrinity[i]) return;
  isPlayingTrinity[i] = true;
  const btn = document.querySelector(`.trinity-debug-btn[data-player="${i}"]`);
  if (btn) btn.disabled = true;
  const { clip, label: labelEl, items, p2Time, p2Arrow, p2Text } = trinityRefs[i];

  let outerGuard;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    resetTrinity(i);
    clip.style.display  = 'none';
    isPlayingTrinity[i]  = false;
    if (btn) btn.disabled = false;
    playNextQueued(i);
  };
  outerGuard = setTimeout(cleanup, 6500);

  const isMarksman = label === 'MARKSMAN TRINITY';
  labelEl.textContent = label || 'CORE ITEMS ACHIEVED';
  labelEl.classList.toggle('big', isMarksman);
  items.forEach(({ itemIcon }, idx) => {
    itemIcon.src = t3ItemIds[idx] ? `Items/${t3ItemIds[idx]}.png` : '';
  });
  resetTrinity(i);
  clip.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    clip.classList.add('evt-in');
  }));

  items.forEach(({ sheen }, idx) => {
    setTimeout(() => { sheen.classList.add('sweep'); }, 400 + idx * 120);
  });

  /* Phase 2 is decided at the swap moment (1.5s in) so a feed that publishes core_item a poll after the
     trinity itself still gets picked up; no data -> the card leaves at the usual 2.4s, exactly as before. */
  setTimeout(() => {
    if (cleanedUp) return;
    let c = core;
    if (c === undefined) {
      const r = lastData ? getPlayerArranged(lastData, i) : null;
      c = r ? getCoreItem(r.player) : null;
    }
    const p2 = coreItemPhase2(c);
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
  setTimeout(() => { if (!clip.classList.contains('trn-phase2')) leave(); }, 2400);   // no data: leaves as before
  setTimeout(() => { if (clip.classList.contains('trn-phase2')) leave(); }, 4200);    // phase 2 holds ~1.8s more
}
