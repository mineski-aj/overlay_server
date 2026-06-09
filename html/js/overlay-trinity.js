/* ── [FEATURE: trinity] ── */
function getTrinityPositions(side) {
  const top1 = (90 - TI_SZ1) / 2;
  const top2 = 5;
  if (side === 'left') {
    return {
      p1: [38, 38 + TI_SZ1 + TI_GAP1, 38 + (TI_SZ1 + TI_GAP1) * 2],
      p2: [81, 81 + TI_SZ2 + TI_GAP2, 81 + (TI_SZ2 + TI_GAP2) * 2],
      top1, top2,
    };
  } else {
    const p1x3 = WORK_W - 38 - TI_SZ1;
    const p1x2 = p1x3 - TI_GAP1 - TI_SZ1;
    const p1x1 = p1x2 - TI_GAP1 - TI_SZ1;
    const p2x3 = WORK_W - 81 - TI_SZ2;
    const p2x2 = p2x3 - TI_GAP2 - TI_SZ2;
    const p2x1 = p2x2 - TI_GAP2 - TI_SZ2;
    return { p1: [p1x1, p1x2, p1x3], p2: [p2x1, p2x2, p2x3], top1, top2 };
  }
}

function buildTrinityOverlay(i) {
  const side   = i <= 5 ? 'left' : 'right';
  const pos    = i <= 5 ? i - 1 : i - 6;
  const offXVal = side === 'left' ? 'translateX(-400px)' : 'translateX(400px)';
  const el   = document.createElement('div');
  el.className = `overlay-container ${side} item-overlay item-overlay-${side}`;
  el.id = `trinity-overlay-p${i}`;
  el.style.top       = `${PLAYER_TOPS[pos]}px`;
  el.style.transform = offXVal;
  el.style.setProperty('--offX', offXVal);
  el.innerHTML = `
    <img class="item-hero-img" src="" alt="" />
    <div class="item-work-area">
      <div class="item-flash"></div>
      <div class="item-glow-ring"></div>
      <div class="item-glow-ring"></div>
      <img class="trinity-item" src="" alt="" />
      <img class="trinity-item" src="" alt="" />
      <img class="trinity-item" src="" alt="" />
      <div class="trinity-priority-plate">
        <span class="item-priority-first">CORE ITEMS</span>
        <span class="item-priority-label">ACHIEVED</span>
      </div>
    </div>`;
  el.style.display = 'none';
  document.getElementById('scene').insertBefore(el, document.getElementById('conceal-overlay'));
  trinityRefs[i] = {
    c:        el,
    flash:    el.querySelector('.item-flash'),
    rings:    el.querySelectorAll('.item-glow-ring'),
    priority: el.querySelector('.trinity-priority-plate'),
    items:    el.querySelectorAll('.trinity-item'),
    hero:     el.querySelector('.item-hero-img'),
    prFirst:  el.querySelector('.item-priority-first'),
  };
}

function resetTrinity(i) {
  const side    = i <= 5 ? 'left' : 'right';
  const offXVal = side === 'left' ? 'translateX(-400px)' : 'translateX(400px)';
  const { c, flash, rings, priority, items } = trinityRefs[i];
  c.classList.remove('sliding-in', 'sliding-out', 'sliding-out-fade');
  c.style.animation  = '';
  c.style.transition = 'none'; c.style.opacity = ''; c.style.transform = offXVal;
  items.forEach(el => {
    el.style.transition = 'none'; el.style.animation = 'none';
    el.style.opacity = '0'; el.style.transform = 'scale(0.5) rotate(-15deg)';
    el.style.filter  = ''; el.style.width = `${TI_SZ1}px`; el.style.height = `${TI_SZ1}px`;
    el.style.top = ''; el.style.left = '';
  });
  flash.style.animation = 'none'; flash.style.opacity = '0'; flash.style.transform = 'scale(0)';
  rings.forEach(r => {
    r.style.animation = 'none'; r.style.opacity = '0'; r.style.transform = 'scale(0)';
  });
  priority.style.transition = 'none'; priority.style.opacity = '0'; priority.style.transform = 'translateY(-16px)';
}

function triggerTrinity(i, heroId, t3ItemIds, playerName, seatNum, label) {
  if (isPlayingTrinity[i]) return;
  isPlayingTrinity[i] = true;
  const trinityBtn = document.querySelector(`.trinity-debug-btn[data-player="${i}"]`);
  if (trinityBtn) trinityBtn.disabled = true;

  const side = i <= 5 ? 'left' : 'right';
  const pos  = getTrinityPositions(side);
  const { c, flash, rings, priority, items, hero, prFirst } = trinityRefs[i];

  let outerGuard;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    resetTrinity(i);
    c.style.display    = 'none';
    c.style.willChange = '';
    isPlayingTrinity[i] = false;
    if (trinityBtn) trinityBtn.disabled = false;
    playNextQueued(i);
  };
  outerGuard = setTimeout(cleanup, 6500);

  c.style.display    = 'block';
  c.style.willChange = 'transform';
  hero.src = heroId ? `hero/HERO_${heroId}_KOTAK.png` : '';
  items.forEach((el, idx) => { el.src = t3ItemIds[idx] ? `Items/${t3ItemIds[idx]}.png` : ''; });
  prFirst.textContent = label || trinityLabel(seatNum, t3ItemIds);
  resetTrinity(i);

  items.forEach((el, idx) => {
    el.style.left = `${pos.p1[idx]}px`; el.style.top = `${pos.top1}px`;
    el.style.width = `${TI_SZ1}px`;     el.style.height = `${TI_SZ1}px`;
  });

  const flashLeft = pos.p1[0] + (TI_SZ1 * 3 + TI_GAP1 * 2) / 2 - 40;
  flash.style.left = `${flashLeft}px`;
  rings.forEach(r => r.style.left = `${flashLeft}px`);

  c.style.transform = '';
  c.classList.add('sliding-in');

  items.forEach((el, idx) => {
    setTimeout(() => {
      el.style.animation = 'trinityItemIn 0.65s cubic-bezier(0.22,1,0.36,1) forwards';
    }, 300 + idx * 110);
  });

  setTimeout(() => {
    items.forEach(el => {
      el.style.opacity   = '1';
      el.style.transform = 'scale(1)';
      el.style.animation = 'trinityGlow 1.0s ease-in-out infinite';
    });
  }, 1150);

  setTimeout(() => { flash.style.animation = 'trinityFlash 0.62s ease-out forwards'; }, 1200);
  setTimeout(() => { rings[0].style.animation = 'trinityRing 0.75s ease-out forwards'; }, 1230);
  setTimeout(() => { rings[1].style.animation = 'trinityRing 0.75s ease-out forwards'; }, 1380);

  const phase2At = 2150;
  setTimeout(() => {
    items.forEach(el => {
      el.style.animation = 'none';
      el.style.transform = 'translate(0,0) scale(1)'; el.style.opacity = '1';
      el.style.filter    = '';
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ease   = '0.45s cubic-bezier(0.22,1,0.36,1)';
      const scaleF = TI_SZ2 / TI_SZ1;
      const dy     = (pos.top2 + TI_SZ2 / 2) - (pos.top1 + TI_SZ1 / 2);
      items.forEach((el, idx) => {
        const dx = (pos.p2[idx] + TI_SZ2 / 2) - (pos.p1[idx] + TI_SZ1 / 2);
        el.style.transition = `transform ${ease}`;
        el.style.transform  = `translate(${dx}px,${dy}px) scale(${scaleF})`;
      });
      priority.style.transition = `opacity 0.38s ease, transform ${ease}`;
      priority.style.opacity    = '1'; priority.style.transform = 'translateY(0)';
    }));
  }, phase2At);

  const slideOutAt = phase2At + 2300;
  setTimeout(() => {
    items.forEach(el => { el.style.animation = 'none'; el.style.transition = 'none'; });
    slideOut(c, cleanup);
  }, slideOutAt);
}
