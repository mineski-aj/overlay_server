/* ── [FEATURE: conceal-overlay] ── */
(function initConcealRefs() {
  ['left', 'right'].forEach(side => {
    const id     = side === 'right' ? 'conceal-overlay-r' : 'conceal-overlay';
    const offXVal = side === 'right' ? 'translateX(300px)' : 'translateX(-300px)';
    const el     = document.getElementById(id);
    el.style.setProperty('--offX', offXVal);
    concealRefs[side] = {
      c:    el,
      cw:   el.querySelector('.conceal-word'),
      cwi:  el.querySelector('.conceal-word-inner'),
      aw:   el.querySelector('.activated-word'),
      img:  el.querySelector('.conceal-circle img'),
    };
  });
})();

const ROAMING_BOOT_CATS = {
  conceal:   new Set(['1511','3511','3521','3531','3541','3551','3561','3571']),
  encourage: new Set(['1512','3512','3522','3532','3542','3552','3562','3572']),
  favor:     new Set(['1513','3513','3523','3533','3543','3553','3563','3573']),
  direhit:   new Set(['1514','3514','3524','3534','3544','3554','3564','3574']),
};
const CONCEAL_CAT_LABEL = { conceal: 'CONCEAL', encourage: 'ENCOURAGE', favor: 'FAVOR', direhit: 'DIRE HIT' };
const CONCEAL_CAT_IMG   = { conceal: 'assets/conceal.webp', encourage: 'assets/encourage.webp', favor: 'assets/favor.webp', direhit: 'assets/direhit.webp' };

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
  const rtMap = { conceal: 'conceal', encourage: 'encourage', favor: 'favor', direhit: 'direhit', 'dire hit': 'direhit' };
  for (const key of SEAT_KEYS) {
    const seat = camp[key];
    if (!seat || !seat.roaming_type) continue;
    const cat = rtMap[seat.roaming_type.toLowerCase()];
    if (cat) return cat;
  }
  return 'conceal';
}

function resetConceal(side) {
  const offXVal = side === 'right' ? 'translateX(300px)' : 'translateX(-300px)';
  const { c, cw, cwi, aw } = concealRefs[side];
  c.classList.remove('sliding-in', 'sliding-out', 'sliding-out-fade');
  c.style.animation  = '';
  c.style.transition = 'none'; c.style.opacity = ''; c.style.transform  = offXVal;
  c.style.display    = 'none';
  cw.style.transition = 'none'; cw.style.opacity   = '0';
  cw.style.transform  = 'translateY(10px)';
  cwi.style.animation = 'none';
  aw.style.transition = 'none'; aw.style.opacity   = '0';
  aw.style.transform  = 'translateY(20px)';
}

function triggerConceal(category, side) {
  if (side === undefined) side = 'left';
  if (isPlayingConceal[side]) return;
  isPlayingConceal[side] = true;
  const btnId = side === 'right' ? 'conceal-trigger-btn-r' : 'conceal-trigger-btn';
  const btn   = document.getElementById(btnId);
  if (btn) btn.disabled = true;
  const { c, cw, cwi, aw, img } = concealRefs[side];

  let outerGuard;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    resetConceal(side);
    isPlayingConceal[side] = false;
    if (btn) btn.disabled = false;
    playNextQueued(side === 'left' ? 4 : 9);
  };
  outerGuard = setTimeout(cleanup, 5000);

  resetConceal(side);
  c.style.display    = 'block';
  img.src            = CONCEAL_CAT_IMG[category] || '';
  cwi.textContent    = CONCEAL_CAT_LABEL[category] || 'CONCEAL';
  c.style.transform  = '';
  c.classList.add('sliding-in');

  setTimeout(() => {
    cw.style.opacity    = '1';
    cwi.style.animation = 'lvlPunch 0.55s cubic-bezier(0.22,1,0.36,1) forwards, shimmer 0.55s ease forwards';
  }, 500);

  setTimeout(() => {
    cwi.style.animation = 'none';
    cw.style.transition = 'none';
    cw.style.opacity    = '1'; cw.style.transform = 'translateY(10px)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cw.style.transition = 'transform 0.4s cubic-bezier(0.22,1,0.36,1)';
      cw.style.transform  = 'translateY(0)';
      aw.style.transition = 'opacity 0.35s ease, transform 0.4s cubic-bezier(0.22,1,0.36,1)';
      aw.style.opacity    = '1'; aw.style.transform = 'translateY(0)';
    }));
  }, 1050);

  setTimeout(() => {
    slideOut(c, cleanup);
  }, 3200);
}

function buildConcealDebugButtons(playerIdx, side) {
  const triggerId = side === 'right' ? 'conceal-trigger-btn-r' : 'conceal-trigger-btn';
  const rowId     = side === 'right' ? 'conceal-cat-row-r'     : 'conceal-cat-row';

  document.getElementById(triggerId).addEventListener('click', async () => {
    try {
      const data  = lastData || await fetchData();
      const campId = side === 'left' ? 1 : 2;
      const camp  = (data.camp_list || []).find(c => c.campid === campId);
      if (camp) { triggerConceal(getCampRoamingCategory(camp), side); return; }
    } catch(e) {}
    triggerConceal('conceal', side);
  });

  const row = document.getElementById(rowId);
  ['conceal','encourage','favor','direhit'].forEach(cat => {
    const b = document.createElement('button');
    b.className = 'debug-btn'; b.textContent = CONCEAL_CAT_LABEL[cat];
    b.addEventListener('click', async () => {
      try {
        const data = lastData || await fetchData();
        const r    = getPlayer(data, playerIdx);
        if (r) { triggerConceal(cat, side); return; }
      } catch(e) {}
      triggerConceal(cat, side);
    });
    row.appendChild(b);
  });
}
