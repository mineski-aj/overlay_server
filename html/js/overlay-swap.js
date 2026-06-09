/* ── [FEATURE: swap] ── */
function getSwapPositions(side) {
  const rowW   = SW_SZ1 * 2 + SW_GAP;
  const startX = (WORK_W - rowW) / 2;
  const topY   = (90 - SW_SZ1) / 2;
  if (side === 'left') {
    return { oldLeft: startX, newLeft: startX + SW_SZ1 + SW_GAP, topY };
  } else {
    return { oldLeft: startX + SW_SZ1 + SW_GAP, newLeft: startX, topY };
  }
}

function buildSwapOverlay(i) {
  const side    = i <= 5 ? 'left' : 'right';
  const pos     = i <= 5 ? i - 1 : i - 6;
  const offXVal = side === 'left' ? 'translateX(-400px)' : 'translateX(400px)';
  const el      = document.createElement('div');
  el.className  = `overlay-container ${side} item-overlay item-overlay-${side}`;
  el.id         = `swap-overlay-p${i}`;
  el.style.top  = `${PLAYER_TOPS[pos]}px`;
  el.style.transform = offXVal;
  el.style.setProperty('--offX', offXVal);
  const arrowColor  = side === 'left' ? '#005bff' : '#e80b00';
  const iconCenterX = (WORK_W - SW_SZ1 * 2 - SW_GAP) / 2 + SW_SZ1 + SW_GAP / 2;
  const iconTopY    = (90 - SW_SZ1) / 2 + SW_SZ1 / 2 - 13;
  el.innerHTML = `
    <img class="item-hero-img" src="" alt="" />
    <div class="item-work-area">
      <div class="item-flash"></div>
      <div class="item-glow-ring"></div>
      <div class="item-glow-ring"></div>
      <img class="swap-item" src="" alt="" />
      <img class="swap-item" src="" alt="" />
      <svg class="swap-arrow-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"
           style="left:${iconCenterX - 17}px; top:28px">
        <path d="M 6.4 13.7 A 15 15 0 0 1 32.3 11.4 L 31.6 16.9 L 26.6 15.4 A 8 8 0 0 0 12.8 16.6 Z" fill="${arrowColor}"/>
        <path d="M 33.6 26.3 A 15 15 0 0 1 7.7 28.6 L 8.4 23.1 L 13.5 24.6 A 8 8 0 0 0 27.3 23.4 Z" fill="${arrowColor}"/>
      </svg>
      <div class="item-nameplate">
        <div class="item-role-square"><img class="item-role-icon" src="" alt="" /></div>
        <span class="item-player-name"></span>
      </div>
      <div class="swap-priority-plate">
        <span class="swap-label">QUICK SWAP!</span>
      </div>
    </div>`;
  el.style.display = 'none';
  document.getElementById('scene').insertBefore(el, document.getElementById('conceal-overlay'));
  swapRefs[i] = {
    c:        el,
    flash:    el.querySelector('.item-flash'),
    rings:    el.querySelectorAll('.item-glow-ring'),
    priority: el.querySelector('.swap-priority-plate'),
    items:    el.querySelectorAll('.swap-item'),
    hero:     el.querySelector('.item-hero-img'),
    swapIcon: el.querySelector('.swap-arrow-icon'),
    namepl:   el.querySelector('.item-nameplate'),
    roleIcon: el.querySelector('.item-role-icon'),
    nameEl:   el.querySelector('.item-player-name'),
  };
}

function resetSwap(i) {
  const side    = i <= 5 ? 'left' : 'right';
  const offXVal = side === 'left' ? 'translateX(-400px)' : 'translateX(400px)';
  const { c, flash, rings, priority, items, swapIcon, namepl } = swapRefs[i];
  c.classList.remove('sliding-in', 'sliding-out', 'sliding-out-fade');
  c.style.animation  = '';
  c.style.transition = 'none'; c.style.transform = offXVal; c.style.opacity = '';
  items.forEach(el => {
    el.style.transition = 'none'; el.style.animation = 'none';
    el.style.opacity = '0'; el.style.transform = 'scale(0.5) rotate(-15deg)';
    el.style.filter  = ''; el.style.width  = `${SW_SZ1}px`; el.style.height = `${SW_SZ1}px`;
    el.style.top = ''; el.style.left = ''; el.style.willChange = '';
  });
  flash.style.animation = 'none'; flash.style.opacity = '0'; flash.style.transform = 'scale(0)';
  rings.forEach(r => { r.style.animation = 'none'; r.style.opacity = '0'; r.style.transform = 'scale(0)'; });
  swapIcon.style.transition = 'none'; swapIcon.style.animation = 'none';
  swapIcon.style.opacity = '0'; swapIcon.style.transform = 'scale(0.5)'; swapIcon.style.filter = ''; swapIcon.style.willChange = '';
  namepl.style.transition = 'none'; namepl.style.opacity = '0'; namepl.style.transform = 'translateY(16px)';
  priority.style.transition = 'none'; priority.style.opacity = '0'; priority.style.transform = 'translateY(-16px)';
}

function triggerSwap(i, heroId, soldId, boughtId, playerName, seatNum) {
  if (isPlayingSwap[i]) return;
  isPlayingSwap[i] = true;
  const swapBtn = document.querySelector(`.swap-debug-btn[data-player="${i}"]`);
  if (swapBtn) swapBtn.disabled = true;

  const side = i <= 5 ? 'left' : 'right';
  const pos  = getSwapPositions(side);
  const { c, flash, rings, priority, items, hero, swapIcon, namepl, roleIcon, nameEl } = swapRefs[i];
  const [oldItem, newItem] = items;

  let outerGuard;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    resetSwap(i);
    c.style.display    = 'none';
    c.style.willChange = '';
    isPlayingSwap[i]   = false;
    if (swapBtn) swapBtn.disabled = false;
    playNextQueued(i);
  };
  outerGuard = setTimeout(cleanup, 6500);

  c.style.display    = 'block';
  c.style.willChange = 'transform';
  items.forEach(el => { el.style.willChange = 'transform, opacity'; });
  swapIcon.style.willChange = 'transform, opacity, filter';
  hero.src           = heroId   ? `hero/HERO_${heroId}_KOTAK.png` : '';
  oldItem.src        = soldId   ? `Items/${soldId}.png`           : '';
  newItem.src        = boughtId ? `Items/${boughtId}.png`         : '';
  roleIcon.src       = ROLE_ICONS[seatNum] || '';
  nameEl.textContent = (playerName || '').toUpperCase();
  fitPlayerName(nameEl);
  resetSwap(i);

  const { oldLeft, newLeft, topY } = pos;
  oldItem.style.left = `${oldLeft}px`; oldItem.style.top = `${topY}px`;
  oldItem.style.width = `${SW_SZ1}px`; oldItem.style.height = `${SW_SZ1}px`;
  newItem.style.left = `${newLeft}px`; newItem.style.top = `${topY}px`;
  newItem.style.width = `${SW_SZ1}px`; newItem.style.height = `${SW_SZ1}px`;

  const rowCenterX = (WORK_W - SW_SZ1 * 2 - SW_GAP) / 2 + SW_SZ1 + SW_GAP / 2;
  flash.style.left = `${rowCenterX - 40}px`;
  rings.forEach(r => r.style.left = `${rowCenterX - 40}px`);

  c.style.transform = '';
  c.classList.add('sliding-in');

  setTimeout(() => {
    oldItem.style.animation = 'trinityItemIn 0.65s cubic-bezier(0.22,1,0.36,1) forwards';
  }, 300);

  setTimeout(() => {
    newItem.style.filter    = 'drop-shadow(0 0 6px rgba(255,200,60,0.75))';
    newItem.style.animation = 'trinityItemIn 0.65s cubic-bezier(0.22,1,0.36,1) forwards';
  }, 410);

  setTimeout(() => {
    swapIcon.style.transition = 'none';
    swapIcon.style.opacity    = '1';
    swapIcon.style.transform  = 'scale(1)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      swapIcon.style.animation = 'lvlPunch 0.45s cubic-bezier(0.22,1,0.36,1) forwards';
      swapIcon.style.filter    = 'drop-shadow(0 0 6px rgba(255,220,60,0.9))';
    }));
  }, 780);

  const centerLeft = (WORK_W - SW_SZ1) / 2;
  setTimeout(() => {
    swapIcon.style.animation  = 'none';
    swapIcon.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    [oldItem, newItem].forEach(el => {
      el.style.opacity   = '1';
      el.style.transform = 'scale(1)';
      el.style.animation = 'none';
    });

    requestAnimationFrame(() => requestAnimationFrame(() => {
      swapIcon.style.opacity   = '0';
      swapIcon.style.transform = 'scale(0.6)';

      oldItem.style.transition = 'transform 0.35s cubic-bezier(0.6,0,0.9,0.5), opacity 0.3s ease 0.05s';
      oldItem.style.transform  = 'scale(0.1) rotate(160deg)';
      oldItem.style.opacity    = '0';

      const dx = centerLeft - newLeft;
      newItem.style.transition = 'transform 0.4s cubic-bezier(0.22,1,0.36,1)';
      newItem.style.transform  = `translateX(${dx}px)`;
    }));
  }, 1050);

  setTimeout(() => { flash.style.animation = 'trinityFlash 0.62s ease-out forwards'; }, 1400);
  setTimeout(() => { rings[0].style.animation = 'trinityRing 0.75s ease-out forwards'; }, 1430);
  setTimeout(() => { rings[1].style.animation = 'trinityRing 0.75s ease-out forwards'; }, 1560);

  const dx0 = centerLeft - newLeft;
  setTimeout(() => {
    newItem.style.transition = 'none';
    newItem.style.transform  = `translateX(${dx0}px)`;
    newItem.style.opacity    = '1';
    newItem.style.animation  = 'trinityGlow 1.0s ease-in-out infinite';
  }, 1500);

  const phase2At = 2200;
  setTimeout(() => {
    newItem.style.animation  = 'none';
    newItem.style.transition = 'none';
    newItem.style.left       = `${centerLeft}px`;
    newItem.style.transform  = 'scale(1)';
    newItem.style.opacity    = '1';
    newItem.style.filter     = '';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ease   = '0.45s cubic-bezier(0.22,1,0.36,1)';
      const p2Left = side === 'left' ? 194 : 2;
      const scale  = 86 / SW_SZ1;
      const dx2    = p2Left - centerLeft + (86 - SW_SZ1) / 2;
      newItem.style.transition  = `transform ${ease}`;
      newItem.style.transform   = `translate(${dx2}px, 0) scale(${scale})`;
      namepl.style.transition   = `opacity 0.38s ease, transform ${ease}`;
      namepl.style.opacity      = '1'; namepl.style.transform = 'translateY(0)';
      priority.style.transition = `opacity 0.38s ease, transform ${ease}`;
      priority.style.opacity    = '1'; priority.style.transform = 'translateY(0)';
    }));
  }, phase2At);

  setTimeout(() => {
    newItem.style.animation  = 'none';
    newItem.style.transition = 'none';
    slideOut(c, cleanup);
  }, phase2At + 2250);
}
