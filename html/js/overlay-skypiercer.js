/* ── [FEATURE: skypiercer] Sky Piercer stacks "eventer" ──
   Same shell as Item Pickup (overlay-items.js): label SKY PIERCER, the
   Sky Piercer icon (Items/2014.png), and "<N> STACKS" where the time sits.
   Fires per player at stack 3, 5, 7, ... (every 2 stacks from 3). The stack
   count comes from the game feed: player.extra_param.sky_piercer_stack.stack
   (falls back to player.sky_piercer_stack.stack). */
const SKYPIERCER_ITEM_ID = '2014';
const skyPiercerRefs     = {};
const isPlayingSkyPiercer = {};
const skyPiercerQueue    = {};
const prevSkyPiercerMilestone = {};   // per player: highest milestone already shown (0 = none)

function getSkyPiercerStack(player) {
  const o = (player && player.extra_param && player.extra_param.sky_piercer_stack) || (player && player.sky_piercer_stack);
  return o ? (parseInt(o.stack) || 0) : 0;
}
/* 3 -> 3, 4 -> 3, 5 -> 5 ... ; below 3 -> 0 */
function skyPiercerMilestone(stack) { return stack >= 3 ? (stack % 2 ? stack : stack - 1) : 0; }

function buildSkyPiercerOverlay(i) {
  const side = i <= 5 ? 'home' : 'away';
  const pos  = i <= 5 ? i - 1 : i - 6;

  const clip = document.createElement('div');
  clip.className = side === 'away' ? 'evt-clip away' : 'evt-clip';
  clip.id = `skp-evt-${i}`;
  clip.style.left = (side === 'home' ? EVT_LEFT_HOME : EVT_LEFT_AWAY) + 'px';
  clip.style.top  = EVT_TOPS[pos] + 'px';

  const card = document.createElement('div');
  card.className = 'evt-card';

  const bg = document.createElement('img');
  bg.className = 'evt-bg';
  bg.src = document.documentElement.getAttribute('data-theme') === 'playoffs' ? 'assets/ingame/playoffs/ui/palyoffs_uistatback.png' : 'assets/ingame/eventerback.png';
  bg.alt = '';

  const label = document.createElement('span');
  label.className = 'evt-label skp-label';
  label.textContent = 'SKY PIERCER';

  const time = document.createElement('div');
  time.className = 'fip-time skp-time';
  const timeNum = document.createElement('span');
  timeNum.className = 'fip-time-num';
  timeNum.textContent = '--';
  const timeUnit = document.createElement('span');
  timeUnit.className = 'fip-time-unit';
  timeUnit.textContent = 'STACKS';
  time.appendChild(timeNum);
  time.appendChild(timeUnit);

  const itemBox = document.createElement('div');
  itemBox.className = 'evt-item-box';
  itemBox.style.left = '109px';
  const itemIcon = document.createElement('img');
  itemIcon.className = 'evt-item-icon';
  itemIcon.alt = '';
  itemIcon.src = `Items/${SKYPIERCER_ITEM_ID}.png`;
  const sheen = document.createElement('div');
  sheen.className = 'evt-sheen';
  itemBox.appendChild(itemIcon);
  itemBox.appendChild(sheen);

  card.appendChild(bg);
  card.appendChild(label);
  card.appendChild(time);
  card.appendChild(itemBox);
  clip.appendChild(card);
  document.getElementById('scene').insertBefore(clip, document.getElementById('player-ui-overlay'));

  skyPiercerRefs[i] = { clip, timeNum, itemIcon, sheen };
}

function resetSkyPiercer(i) {
  const { clip, sheen } = skyPiercerRefs[i];
  clip.classList.remove('evt-in');
  sheen.classList.remove('sweep');
}

function triggerSkyPiercer(i, stacks) {
  if (isPlayingSkyPiercer[i]) return;
  isPlayingSkyPiercer[i] = true;
  const btn = document.querySelector(`.skp-debug-btn[data-player="${i}"]`);
  if (btn) btn.disabled = true;
  const { clip, timeNum, sheen } = skyPiercerRefs[i];

  let outerGuard;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    resetSkyPiercer(i);
    clip.style.display = 'none';
    isPlayingSkyPiercer[i] = false;
    if (btn) btn.disabled = false;
    playNextQueued(i);
  };
  outerGuard = setTimeout(cleanup, 3500);

  timeNum.textContent = String(stacks);
  resetSkyPiercer(i);
  clip.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    clip.classList.add('evt-in');
  }));

  setTimeout(() => { sheen.classList.add('sweep'); }, 400);

  setTimeout(() => {
    clip.classList.remove('evt-in');
    setTimeout(cleanup, 350);
  }, 2400);
}

/* Live detection — called from overlay-debug.js's poll handler for each player. */
function checkSkyPiercer(pidx, player) {
  const ms = skyPiercerMilestone(getSkyPiercerStack(player));
  const prev = prevSkyPiercerMilestone[pidx];
  if (prev === undefined) { prevSkyPiercerMilestone[pidx] = ms; return; }   // first poll: baseline only
  if (ms < prev) { prevSkyPiercerMilestone[pidx] = ms; return; }            // stacks reset (death / item sold)
  if (ms > prev) {
    prevSkyPiercerMilestone[pidx] = ms;
    if (!featureEnabled.skypiercer) return;
    if (isAnyPlaying(pidx)) skyPiercerQueue[pidx] = { stacks: ms };
    else triggerSkyPiercer(pidx, ms);
  }
}

/* Debug buttons — stack count comes from the number box (default 3). */
for (let i = 1; i <= 10; i++) {
  buildSkyPiercerOverlay(i);
  const btn = document.createElement('button');
  btn.className = 'debug-btn skp-debug-btn';
  btn.dataset.player = i;
  btn.textContent = `▶ P${i}`;
  btn.addEventListener('click', () => {
    const n = parseInt(document.getElementById('skp-debug-stacks').value) || 3;
    if (isAnyPlaying(i)) skyPiercerQueue[i] = { stacks: n }; else triggerSkyPiercer(i, n);
  });
  document.getElementById(i <= 5 ? 'skp-team-left' : 'skp-team-right').appendChild(btn);
}
