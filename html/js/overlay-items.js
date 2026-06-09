/* ── Item pickup v2 ── */
function buildItemOverlay(i) {
  const side   = i <= 5 ? 'left' : 'right';
  const pos    = i <= 5 ? i - 1 : i - 6;
  const offXVal = side === 'left' ? 'translateX(-400px)' : 'translateX(400px)';
  const el   = document.createElement('div');
  el.className = `overlay-container ${side} item-overlay item-overlay-${side}`;
  el.id = `item-overlay-p${i}`;
  el.style.top       = `${PLAYER_TOPS[pos]}px`;
  el.style.transform = offXVal;
  el.style.setProperty('--offX', offXVal);
  el.innerHTML = `
    <img class="item-hero-img" src="" alt="" />
    <div class="item-work-area">
      <div class="item-flash"></div>
      <div class="item-glow-ring"></div>
      <div class="item-glow-ring"></div>
      <img class="item-t3-icon" src="" alt="" />
      <div class="item-nameplate">
        <div class="item-role-square"><img class="item-role-icon" src="" alt="" /></div>
        <span class="item-player-name"></span>
      </div>
      <div class="item-priority-plate">
        <span class="item-priority-first">FIRST ITEM</span>
        <span class="item-priority-label">PRIORITY</span>
      </div>
    </div>`;
  el.style.display = 'none';
  document.getElementById('scene').insertBefore(el, document.getElementById('conceal-overlay'));
  itemRefs[i] = {
    c:        el,
    work:     el.querySelector('.item-work-area'),
    t3:       el.querySelector('.item-t3-icon'),
    flash:    el.querySelector('.item-flash'),
    rings:    el.querySelectorAll('.item-glow-ring'),
    namepl:   el.querySelector('.item-nameplate'),
    priority: el.querySelector('.item-priority-plate'),
    hero:     el.querySelector('.item-hero-img'),
    roleIcon: el.querySelector('.item-role-icon'),
    nameEl:   el.querySelector('.item-player-name'),
    prFirst:  el.querySelector('.item-priority-first'),
  };
}

function resetItem(i) {
  const side    = i <= 5 ? 'left' : 'right';
  const offXVal = side === 'left' ? 'translateX(-400px)' : 'translateX(400px)';
  const { c, work, t3, flash, rings, namepl, priority } = itemRefs[i];
  c.classList.remove('sliding-in', 'sliding-out', 'sliding-out-fade');
  c.style.animation  = '';
  c.style.transition = 'none'; c.style.opacity = ''; c.style.transform = offXVal;
  work.querySelectorAll('.recipe-item').forEach(el => el.remove());
  t3.style.transition = 'none'; t3.style.animation = 'none';
  t3.style.transform  = 'scale(0)'; t3.style.opacity = '0'; t3.style.filter = '';
  t3.style.width = '65px'; t3.style.height = '65px';
  t3.style.top   = '12.5px'; t3.style.left = '';
  flash.style.animation = 'none'; flash.style.opacity = '0'; flash.style.transform = 'scale(0)';
  rings.forEach(r => {
    r.style.animation = 'none'; r.style.opacity = '0'; r.style.transform = 'scale(0)';
  });
  namepl.style.transition   = 'none'; namepl.style.opacity   = '0'; namepl.style.transform   = 'translateY(16px)';
  priority.style.transition = 'none'; priority.style.opacity = '0'; priority.style.transform = 'translateY(-16px)';
}

function triggerItem(i, heroId, recipeIds, newItemId, playerName, seatNum) {
  if (isPlayingItem[i]) return;
  isPlayingItem[i] = true;
  const itemBtn = document.querySelector(`.item-debug-btn[data-player="${i}"]`);
  if (itemBtn) itemBtn.disabled = true;

  const side         = i <= 5 ? 'left' : 'right';
  const t3Phase2Left = side === 'left' ? '194px' : '2px';
  const { c, work, t3, flash, rings, namepl, priority, hero, roleIcon, nameEl } = itemRefs[i];

  let outerGuard;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    resetItem(i);
    c.style.display    = 'none';
    c.style.willChange = '';
    isPlayingItem[i]   = false;
    if (itemBtn) itemBtn.disabled = false;
    playNextQueued(i);
  };
  outerGuard = setTimeout(cleanup, 6500);

  c.style.display    = 'block';
  c.style.willChange = 'transform';
  hero.src     = heroId ? `hero/HERO_${heroId}_KOTAK.png` : '';
  roleIcon.src = ROLE_ICONS[seatNum] || '';
  nameEl.textContent = (playerName || '').toUpperCase();
  fitPlayerName(nameEl);
  t3.src = `Items/${newItemId}.png`;
  resetItem(i);

  const n       = recipeIds.length;
  const gap     = 11;
  const rowW    = n > 0 ? n * ITEM_SZ + (n - 1) * gap : 0;
  const itemPad = side === 'left' ? 20 : 5;
  const startX  = itemPad + (ITEM_WORK - rowW) / 2;
  const centerX = itemPad + (ITEM_WORK - ITEM_SZ) / 2;

  const recipeEls = recipeIds.map((id, idx) => {
    const img = document.createElement('img');
    img.className = 'recipe-item';
    img.src = `Items/${id}.png`; img.alt = id;
    const itemLeft = startX + idx * (ITEM_SZ + gap);
    img.style.left = `${itemLeft}px`;
    work.insertBefore(img, flash);
    return { el: img, startX: itemLeft };
  });
  t3.style.left = `${centerX}px`;

  c.style.transform = '';
  c.classList.add('sliding-in');

  if (n > 0) {
    setTimeout(() => {
      recipeEls.forEach(({ el }, idx) => {
        el.style.transitionDelay = `${idx * 0.07}s`;
        el.style.transition = 'opacity 0.3s ease, transform 0.35s cubic-bezier(0.22,1,0.36,1)';
        el.style.opacity    = '1';
        el.style.transform  = 'scale(1)';
        el.style.filter     = 'drop-shadow(0 0 5px rgba(255,180,50,0.55))';
      });
    }, 300);

    setTimeout(() => {
      recipeEls.forEach(({ el }) => {
        el.style.transition = 'transform 0.18s ease';
        el.style.filter     = 'drop-shadow(0 0 10px rgba(255,210,50,1))';
        el.style.transform  = 'scale(1.12)';
      });
    }, 1020);

    setTimeout(() => {
      recipeEls.forEach(({ el, startX: sx }, idx) => {
        const dx  = centerX - sx;
        const rot = idx % 2 === 0 ? 160 : -160;
        el.style.transitionDelay = '0s';
        el.style.transition = 'transform 0.38s cubic-bezier(0.6,0,0.9,0.5), opacity 0.3s ease 0.06s';
        el.style.transform  = `translateX(${dx}px) scale(0.15) rotate(${rot}deg)`;
        el.style.opacity    = '0';
        el.style.filter     = '';
      });
    }, 1100);

    setTimeout(() => {
      flash.style.animation = 'flashBurst 0.52s ease-out forwards';
    }, 1440);

    setTimeout(() => { rings[0].style.animation = 'glowRing 0.65s ease-out forwards'; }, 1470);
    setTimeout(() => { rings[1].style.animation = 'glowRing 0.65s ease-out forwards'; }, 1590);
  }

  const punchAt = n > 0 ? 1500 : 300;
  setTimeout(() => {
    t3.style.animation = 'itemPunch 0.6s cubic-bezier(0.22,1,0.36,1) forwards';
  }, punchAt);

  const glowAt = punchAt + 700;
  setTimeout(() => {
    t3.style.animation = 't3Glow 1.6s ease-in-out infinite';
    t3.style.transform = 'scale(1)'; t3.style.opacity = '1';
  }, glowAt);

  const phase2At = glowAt + 400;
  setTimeout(() => {
    t3.style.animation = 'none';
    t3.style.transform = 'translate(0,0) scale(1)'; t3.style.opacity = '1';
    t3.style.filter    = '';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ease = '0.45s cubic-bezier(0.22,1,0.36,1)';
      const p2dx = parseFloat(t3Phase2Left) - centerX + 10.5;
      t3.style.transition = `transform ${ease}`;
      t3.style.transform  = `translate(${p2dx}px,0) scale(${86/65})`;
      namepl.style.transition   = `opacity 0.38s ease, transform ${ease}`;
      namepl.style.opacity      = '1'; namepl.style.transform = 'translateY(0)';
      priority.style.transition = `opacity 0.38s ease, transform ${ease}`;
      priority.style.opacity    = '1'; priority.style.transform = 'translateY(0)';
    }));
  }, phase2At);

  const slideOutAt = phase2At + 2000;
  setTimeout(() => {
    t3.style.animation = 'none';
    recipeEls.forEach(({ el }) => { el.style.animation = 'none'; });
    t3.style.transition = 'none';
    slideOut(c, cleanup);
  }, slideOutAt);
}
