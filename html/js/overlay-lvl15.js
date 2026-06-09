/* ── Level 15 overlay ── */
function buildLvl15Overlay(i) {
  const side   = i <= 5 ? 'left' : 'right';
  const pos    = i <= 5 ? i - 1 : i - 6;
  const offXVal = side === 'left' ? 'translateX(-320px)' : 'translateX(320px)';
  const el   = document.createElement('div');
  el.className = `overlay-container ${side} lvl15-v2`;
  el.id = `overlay-p${i}`;
  el.style.top       = `${PLAYER_TOPS[pos]}px`;
  el.style.transform = offXVal;
  el.style.setProperty('--offX', offXVal);
  el.innerHTML = `
    <img class="lvl15-hero" src="" alt="" />
    <div class="lvl15-content">
      <span class="lvl15-word"><span class="lvl15-word-inner">LEVEL 15</span></span>
      <div class="lvl15-time-block">
        <span class="time-reached-label">REACHED AT</span>
        <span class="time-reached-value">--:--</span>
      </div>
    </div>`;
  el.style.display = 'none';
  document.getElementById('scene').insertBefore(el, document.getElementById('conceal-overlay'));
  lvl15Refs[i] = {
    c:       el,
    word:    el.querySelector('.lvl15-word'),
    wInner:  el.querySelector('.lvl15-word-inner'),
    tb:      el.querySelector('.lvl15-time-block'),
    hero:    el.querySelector('.lvl15-hero'),
    timeVal: el.querySelector('.time-reached-value'),
  };
}

function resetLvl15(i) {
  const side    = i <= 5 ? 'left' : 'right';
  const offXVal = side === 'left' ? 'translateX(-320px)' : 'translateX(320px)';
  const { c, word, wInner, tb } = lvl15Refs[i];
  c.classList.remove('sliding-in', 'sliding-out', 'sliding-out-fade');
  c.style.animation  = '';
  c.style.transition = 'none'; c.style.opacity = '';
  c.style.transform  = offXVal;
  word.style.transition  = 'none'; word.style.animation = 'none';
  word.style.opacity     = '0';    word.style.transform = 'translateY(15px)';
  word.style.fontSize    = '32px';
  wInner.style.animation = 'none';
  tb.style.transition    = 'none'; tb.style.opacity     = '0';
  tb.style.transform     = 'translateY(16px)';
}

function triggerLvl15(i, timeStr, heroId) {
  if (isPlayingLvl[i]) return;
  isPlayingLvl[i] = true;
  const btn = document.querySelector(`.debug-btn[data-player="${i}"]`);
  if (btn) btn.disabled = true;
  const { c, word, wInner, tb, hero, timeVal } = lvl15Refs[i];

  let outerGuard;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(outerGuard);
    resetLvl15(i);
    c.style.display  = 'none';
    isPlayingLvl[i]  = false;
    if (btn) btn.disabled = false;
    playNextQueued(i);
  };
  outerGuard = setTimeout(cleanup, 5000);

  c.style.display    = 'block';
  hero.src           = heroId ? `hero/HERO_${heroId}_KOTAK.png` : '';
  timeVal.textContent = timeStr || '--:--';
  resetLvl15(i);
  c.style.transform  = '';
  c.classList.add('sliding-in');

  setTimeout(() => {
    word.style.opacity  = '1';
    wInner.style.animation = 'lvlPunch 0.55s cubic-bezier(0.22,1,0.36,1) forwards, shimmer 0.55s ease forwards';
  }, 250);

  setTimeout(() => {
    wInner.style.animation = 'none';
    word.style.transition  = 'none';
    word.style.opacity     = '1'; word.style.transform = 'translateY(15px) scale(1)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      word.style.transition = 'transform 0.4s cubic-bezier(0.22,1,0.36,1)';
      word.style.transform  = 'translateY(0) scale(0.625)';
      tb.style.transition   = 'opacity 0.35s ease, transform 0.4s cubic-bezier(0.22,1,0.36,1)';
      tb.style.opacity      = '1'; tb.style.transform = 'translateY(0)';
    }));
  }, 1100);

  setTimeout(() => {
    word.style.animation  = 'none';
    wInner.style.animation = 'none';
    tb.style.animation    = 'none';
    slideOut(c, cleanup);
  }, 3200);
}
