/* ── [FEATURE: skypiercer] Sky Piercer stacks "eventer" ──
   Same shell as Item Pickup (overlay-items.js): label SKY PIERCER, the
   Sky Piercer icon (Items/2014.png), and "<N> STACKS" where the time sits.
   Fires per player whenever the stack value changes (shown 3s; each further change updates the number and adds 1s). The stack
   count comes from the game feed: player.extra_param.sky_piercer_stack.stack
   (falls back to player.sky_piercer_stack.stack). */
const SKYPIERCER_ITEM_ID = '2014';
const skyPiercerRefs     = {};
const isPlayingSkyPiercer = {};
const skyPiercerQueue    = {};
const prevSkyPiercerMilestone = {};   // per player: last seen stack value

function getSkyPiercerStack(player) {
  const o = (player && player.extra_param && player.extra_param.sky_piercer_stack) || (player && player.sky_piercer_stack);
  return o ? (parseInt(o.stack) || 0) : 0;
}

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

const SKYPIERCER_SHOW_MS   = 3000;  // visible time after the first change
const SKYPIERCER_EXTEND_MS = 1000;  // added each time the stack value changes while it's up
const skyPiercerState = {};         // per player: { endAt, timer }

function skyPiercerSchedule(i, cleanup) {
  const st = skyPiercerState[i];
  const { clip } = skyPiercerRefs[i];
  clearTimeout(st.timer);
  st.timer = setTimeout(() => {
    clip.classList.remove('evt-in');
    st.timer = setTimeout(cleanup, 350);
  }, Math.max(0, st.endAt - Date.now()));
}

/* Already up: just swap the number and push the hide time out by 1s (no re-animation). */
function triggerSkyPiercer(i, stacks) {
  if (isPlayingSkyPiercer[i]) {
    const st = skyPiercerState[i];
    skyPiercerRefs[i].timeNum.textContent = String(stacks);
    st.endAt += SKYPIERCER_EXTEND_MS;
    skyPiercerSchedule(i, st.cleanup);
    return;
  }
  isPlayingSkyPiercer[i] = true;
  const btn = document.querySelector(`.skp-debug-btn[data-player="${i}"]`);
  if (btn) btn.disabled = true;
  const { clip, timeNum, sheen } = skyPiercerRefs[i];

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    const st = skyPiercerState[i];
    if (st) { clearTimeout(st.timer); delete skyPiercerState[i]; }
    resetSkyPiercer(i);
    clip.style.display = 'none';
    isPlayingSkyPiercer[i] = false;
    if (btn) btn.disabled = false;
    playNextQueued(i);
  };
  skyPiercerState[i] = { endAt: Date.now() + SKYPIERCER_SHOW_MS, timer: null, cleanup };

  timeNum.textContent = String(stacks);
  resetSkyPiercer(i);
  clip.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    clip.classList.add('evt-in');
  }));

  setTimeout(() => { if (!cleanedUp) sheen.classList.add('sweep'); }, 400);
  skyPiercerSchedule(i, cleanup);
}

/* Live detection — called from overlay-debug.js's poll handler for each player.
   Fires whenever player.extra_param.sky_piercer_stack.stack changes to a value > 0. */
function checkSkyPiercer(pidx, player) {
  const stack = getSkyPiercerStack(player);
  const prev = prevSkyPiercerMilestone[pidx];
  prevSkyPiercerMilestone[pidx] = stack;
  if (prev === undefined) return;          // first poll: baseline only
  if (stack === prev || stack <= 0) return; // unchanged, or reset to 0 (death / item sold)
  if (!featureEnabled.skypiercer) return;
  if (isPlayingSkyPiercer[pidx]) triggerSkyPiercer(pidx, stack);          // already up: update + extend
  else if (isAnyPlaying(pidx)) skyPiercerQueue[pidx] = { stacks: stack };
  else triggerSkyPiercer(pidx, stack);
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
    if (isAnyPlaying(i) && !isPlayingSkyPiercer[i]) skyPiercerQueue[i] = { stacks: n }; else triggerSkyPiercer(i, n);
  });
  document.getElementById(i <= 5 ? 'skp-team-left' : 'skp-team-right').appendChild(btn);
}
