/* ── [FEATURE: item-check] ──────────────────────────────────────
   Coordinates below are measured directly off
   assets/ingame/ingameitemback.png (1072×286) — see the CSS block
   in mploverlay_v7.css for the full measurement notes. */
const IC_ROW_TOPS       = [11, 66, 122, 177, 232];
const IC_HOME_ITEM_X    = [241, 194, 147, 101, 54, 7]; /* index 0 = closest to portrait */
const IC_AWAY_ITEM_X    = [787, 834, 881, 927, 974, 1021];
const IC_HOME_PORTRAIT_X = 373;
const IC_AWAY_PORTRAIT_X = 656;

let icShouldShow = false;
let icOutTimer   = null;
const icRefs     = {};

function icFormatGold(g) {
  return ((g || 0) / 1000).toFixed(1) + 'K';
}

function icBuildRow(i) {
  const side     = i <= 5 ? 'home' : 'away';
  const seatIdx  = i <= 5 ? i - 1 : i - 6;
  const top      = IC_ROW_TOPS[seatIdx];
  const portraitX = side === 'home' ? IC_HOME_PORTRAIT_X : IC_AWAY_PORTRAIT_X;
  const itemXs    = side === 'home' ? IC_HOME_ITEM_X     : IC_AWAY_ITEM_X;

  const portrait = document.createElement('img');
  portrait.className = 'ic-portrait';
  portrait.style.left = portraitX + 'px';
  portrait.style.top  = top + 'px';
  portrait.alt = '';
  portrait.onerror = () => { portrait.onerror = null; portrait.removeAttribute('src'); };

  /* No icon here — the background art already has the gold icon baked in
     per row (see mploverlay_v7.css .ic-gold comment). Text only, positioned
     right up against it via the .ic-gold-home/.ic-gold-away CSS classes. */
  const gold = document.createElement('div');
  gold.className = 'ic-gold ' + (side === 'home' ? 'ic-gold-home' : 'ic-gold-away');
  gold.style.top = top + 'px';

  const text = document.createElement('span');
  text.className = 'ic-gold-text';
  text.textContent = '0.0K';
  gold.appendChild(text);

  const items = [];
  for (let s = 0; s < 6; s++) {
    const item = document.createElement('img');
    item.className = 'ic-item-slot';
    item.style.left = itemXs[s] + 'px';
    item.style.top  = top + 'px';
    item.alt = '';
    item.onerror = () => { item.onerror = null; item.src = 'items/99999.png'; };
    items.push(item);
  }

  icRefs[i] = { portrait, gold, goldText: text, items };
  return [portrait, gold, ...items];
}

function icBuildPanel() {
  const overlay = document.getElementById('item-check-overlay');
  if (!overlay) return;

  const bg = document.createElement('img');
  bg.className = 'ic-bg';
  bg.src = '/assets/ingame/ingameitemback.png';
  bg.alt = '';
  overlay.appendChild(bg);

  const middle = document.createElement('img');
  middle.className = 'ic-middle';
  middle.src = '/assets/ingame/ingameitemmiddle.png';
  middle.alt = '';
  overlay.appendChild(middle);
  icRefs.middle = middle;

  for (let i = 1; i <= 10; i++) {
    icBuildRow(i).forEach(el => overlay.appendChild(el));
  }
}
icBuildPanel();

function icUpdate(data) {
  if (!icShouldShow) return;
  for (let i = 1; i <= 10; i++) {
    const r   = getPlayer(data, i);
    const ref = icRefs[i];
    if (!r || !r.player || !ref) continue;

    const heroId = r.player.heroid;
    if (heroId) ref.portrait.src = `hero/HERO_${heroId}_KOTAK.png`;
    else        ref.portrait.removeAttribute('src');

    ref.goldText.textContent = icFormatGold(r.player.gold);

    for (let s = 0; s < 6; s++) {
      const id = r.equipIds[s] || '99999';
      ref.items[s].src = `items/${id}.png`;
    }
  }
}
registerPollHandler(icUpdate);

/* Waits for every <img> under `overlay` to finish loading (or errors, or
   maxWaitMs elapses) — same shape as mplfs.html's preloadMedia(). On a
   freshly-reloaded page none of the ~60 item/portrait icons are cached
   yet, so setting all their src at once and immediately starting the
   slide-in transition let the burst of first-time image decodes stall
   the main thread right on the transition's opening frames, making it
   look like it "pops in" partway instead of sliding from the start.
   Once every icon is cached (every show after the first), there's
   nothing to wait on and this resolves immediately. */
function icPreloadImages(overlay, maxWaitMs) {
  const els = overlay.querySelectorAll('img');
  return Promise.all(Array.from(els).map(el => new Promise(resolve => {
    if (!el.getAttribute('src') || el.complete) return resolve();
    el.addEventListener('load', resolve, { once: true });
    el.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, maxWaitMs);
  })));
}

async function icAnimateIn() {
  icShouldShow = true;
  clearTimeout(icOutTimer);
  const clip    = document.getElementById('item-check-clip');
  const overlay = document.getElementById('item-check-overlay');

  if (lastData) icUpdate(lastData);
  await icPreloadImages(overlay, 900);
  if (!icShouldShow) return; /* hidden again while we were preloading */

  clip.style.display = 'block';
  /* Double rAF (same technique as slideOut() in overlay-core.js) so the
     browser commits a full style+layout+paint pass at the base rule's
     translateY(286px) before .ic-in changes it — going from display:none
     straight to the "in" transform in the same tick can otherwise skip
     the transition entirely. */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.classList.add('ic-in');
  }));

  /* Subtle bounce on the middle branding panel once the 350ms slide-in
     finishes */
  setTimeout(() => {
    if (!icShouldShow) return;
    icRefs.middle.classList.remove('ic-bounce');
    void icRefs.middle.offsetWidth;
    icRefs.middle.classList.add('ic-bounce');
  }, 350);
}

function icAnimateOut() {
  icShouldShow = false;
  const clip    = document.getElementById('item-check-clip');
  const overlay = document.getElementById('item-check-overlay');
  /* Just remove .ic-in — the transition lives on the base rule, so this
     animates back to it smoothly instead of snapping instantly with
     nothing left to transition (that was the earlier "stall" bug). */
  overlay.classList.remove('ic-in');
  clearTimeout(icOutTimer);
  icOutTimer = setTimeout(() => {
    clip.style.display = 'none';
  }, 350);
  /* Resume any kill events that queued up while this panel was blocking
     them (see killEventsBlocked() in overlay-killevents.js). */
  playNextKillEvent();
}
