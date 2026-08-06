/* ── [FEATURE: golddiff-check] ────────────────────────────────────
   Coordinates below are measured directly off
   assets/ingame/golddiffback.png (858×286) and golddiffguide.png —
   see the CSS block in mploverlay_v7.css for the full measurement
   notes. 5 rows (one per lane), using the shared getPlayerByRole()
   from overlay-core.js to resolve lane → seat (seat_N isn't reliably
   lane-ordered).

   Bar-fill % is each side's share of (home+away) gold for that lane —
   a comparison, not an absolute amount. Assumption, not a spec'd
   game-data field. */
const GDC_ROW_TOPS      = [30, 82, 133, 185, 236]; /* relative to the bg image; +60 for chip offset */
const GDC_ROW_H         = 32;
const GDC_HOME_PORT_X   = 63;
const GDC_HOME_BAR_X    = 89;
const GDC_HOME_BAR_W    = 271;
const GDC_AWAY_BAR_X    = 500;
const GDC_AWAY_BAR_W    = 270;
const GDC_AWAY_PORT_X   = 770;
const GDC_REVEAL_DELAY  = 350; /* matches the slide-in duration — bars/numbers/smart flourish all fire together once the slide finishes */
const GDC_COUNT_MS      = 700;

let gdcShouldShow = false;
let gdcOutTimer   = null;
let gdcPriming    = false;
let gdcRevealTimer = null;
const gdcRefs     = [];

function gdcFormatGoldK(v) {
  return ((v || 0) / 1000).toFixed(1) + 'K';
}
function gdcFormatDiffK(v) {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return sign + (Math.abs(v || 0) / 1000).toFixed(1) + 'K';
}

function gdcEaseOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function gdcCountTo(el, from, to, formatFn) {
  const startTime = performance.now();
  const startVal  = from;
  cancelAnimationFrame(el._gdcRaf);
  function tick(now) {
    const t = Math.min(1, (now - startTime) / GDC_COUNT_MS);
    const eased = gdcEaseOutCubic(t);
    const val = startVal + (to - startVal) * eased;
    el.textContent = formatFn(val);
    if (t < 1) el._gdcRaf = requestAnimationFrame(tick);
    else       el.textContent = formatFn(to);
  }
  el._gdcRaf = requestAnimationFrame(tick);
}

function gdcBuildRow(lane) {
  const top = 60 + GDC_ROW_TOPS[lane - 1];

  const homePortrait = document.createElement('img');
  homePortrait.className = 'gdc-portrait';
  homePortrait.style.left = GDC_HOME_PORT_X + 'px';
  homePortrait.style.top  = top + 'px';
  homePortrait.alt = '';
  homePortrait.onerror = () => { homePortrait.onerror = null; homePortrait.removeAttribute('src'); };

  const homeTrack = document.createElement('div');
  homeTrack.className = 'gdc-bar-track';
  homeTrack.style.left  = GDC_HOME_BAR_X + 'px';
  homeTrack.style.width = GDC_HOME_BAR_W + 'px';
  homeTrack.style.top   = top + 'px';
  const homeFill = document.createElement('div');
  homeFill.className = 'gdc-bar-fill gdc-fill-home';
  const homeText = document.createElement('div');
  homeText.className = 'gdc-bar-text gdc-text-home';
  const homeIcon = document.createElement('img');
  homeIcon.className = 'gdc-gold-icon';
  homeIcon.src = 'assets/ingame/golddifficon.png';
  homeIcon.alt = '';
  const homeAmount = document.createElement('span');
  homeAmount.textContent = gdcFormatGoldK(0);
  homeText.appendChild(homeIcon);
  homeText.appendChild(homeAmount);
  homeTrack.appendChild(homeFill);
  homeTrack.appendChild(homeText);

  const diffZone = document.createElement('div');
  diffZone.className = 'gdc-diffzone';
  diffZone.style.top = top + 'px';
  const triHome = document.createElement('span');
  triHome.className = 'gdc-tri gdc-tri-home';
  triHome.textContent = '◀'; /* ◀ */
  const diffNum = document.createElement('span');
  diffNum.textContent = gdcFormatDiffK(0);
  const triAway = document.createElement('span');
  triAway.className = 'gdc-tri gdc-tri-away';
  triAway.textContent = '▶'; /* ▶ */
  diffZone.appendChild(triHome);
  diffZone.appendChild(diffNum);
  diffZone.appendChild(triAway);

  const awayTrack = document.createElement('div');
  awayTrack.className = 'gdc-bar-track';
  awayTrack.style.left  = GDC_AWAY_BAR_X + 'px';
  awayTrack.style.width = GDC_AWAY_BAR_W + 'px';
  awayTrack.style.top   = top + 'px';
  const awayFill = document.createElement('div');
  awayFill.className = 'gdc-bar-fill gdc-fill-away';
  const awayText = document.createElement('div');
  awayText.className = 'gdc-bar-text gdc-text-away';
  const awayIcon = document.createElement('img');
  awayIcon.className = 'gdc-gold-icon';
  awayIcon.src = 'assets/ingame/golddifficon.png';
  awayIcon.alt = '';
  const awayAmount = document.createElement('span');
  awayAmount.textContent = gdcFormatGoldK(0);
  awayText.appendChild(awayIcon);
  awayText.appendChild(awayAmount);
  awayTrack.appendChild(awayFill);
  awayTrack.appendChild(awayText);

  const awayPortrait = document.createElement('img');
  awayPortrait.className = 'gdc-portrait';
  awayPortrait.style.left = GDC_AWAY_PORT_X + 'px';
  awayPortrait.style.top  = top + 'px';
  awayPortrait.alt = '';
  awayPortrait.onerror = () => { awayPortrait.onerror = null; awayPortrait.removeAttribute('src'); };

  gdcRefs[lane] = {
    homePortrait, homeFill, homeAmount,
    diffNum, triHome, triAway,
    awayFill, awayAmount, awayPortrait,
    homeGold: 0, awayGold: 0,
  };

  return [homePortrait, homeTrack, diffZone, awayTrack, awayPortrait];
}

function gdcBuildPanel() {
  const overlay = document.getElementById('golddiff-check-overlay');
  if (!overlay) return;

  const bg = document.createElement('img');
  bg.className = 'gdc-bg';
  bg.src = 'assets/ingame/golddiffback.png';
  bg.alt = '';
  overlay.appendChild(bg);

  const smart = document.createElement('div');
  smart.className = 'gdc-smart';
  smart.id = 'gdc-smart';
  const smartImg = document.createElement('img');
  smartImg.className = 'gdc-smart-img';
  smartImg.src = 'assets/ingame/golddiffsmart.png';
  smartImg.alt = '';
  const smartSheen = document.createElement('div');
  smartSheen.className = 'gdc-smart-sheen';
  smart.appendChild(smartImg);
  smart.appendChild(smartSheen);
  overlay.appendChild(smart);

  for (let lane = 1; lane <= 5; lane++) {
    gdcBuildRow(lane).forEach(el => overlay.appendChild(el));
  }
}
gdcBuildPanel();

function gdcApplyRow(lane, homeSeat, awaySeat) {
  const ref = gdcRefs[lane];
  if (!ref) return;

  if (homeSeat && homeSeat.heroid) ref.homePortrait.src = `hero/HERO_${homeSeat.heroid}_KOTAK.png`;
  if (awaySeat && awaySeat.heroid) ref.awayPortrait.src = `hero/HERO_${awaySeat.heroid}_KOTAK.png`;

  const homeGold = (homeSeat && homeSeat.gold) || 0;
  const awayGold = (awaySeat && awaySeat.gold) || 0;
  const total    = homeGold + awayGold;
  const homePct  = total > 0 ? homeGold / total : 0.5;
  const awayPct  = total > 0 ? awayGold / total : 0.5;
  const diff     = homeGold - awayGold;

  ref.homeFill.style.width = (homePct * 100) + '%';
  ref.awayFill.style.width = (awayPct * 100) + '%';

  gdcCountTo(ref.homeAmount, ref.homeGold, homeGold, gdcFormatGoldK);
  gdcCountTo(ref.awayAmount, ref.awayGold, awayGold, gdcFormatGoldK);
  gdcCountTo(ref.diffNum, ref.homeGold - ref.awayGold, diff, gdcFormatDiffK);
  ref.homeGold = homeGold;
  ref.awayGold = awayGold;

  ref.triHome.classList.toggle('gdc-tri-on', diff > 0);
  ref.triAway.classList.toggle('gdc-tri-on', diff < 0);
}

function gdcApplyData(data) {
  if (!data) return;
  for (let lane = 1; lane <= 5; lane++) {
    const homeSeat = getPlayerByRole(data, 1, lane);
    const awaySeat = getPlayerByRole(data, 2, lane);
    gdcApplyRow(lane, homeSeat, awaySeat);
  }
}

function gdcUpdate(data) {
  if (!gdcShouldShow || gdcPriming) return;
  gdcApplyData(data);
}
registerPollHandler(gdcUpdate);

function gdcResetToZero() {
  for (let lane = 1; lane <= 5; lane++) {
    const ref = gdcRefs[lane];
    if (!ref) continue;
    const track = ref.homeFill.parentElement;
    /* Snap instantly — no growing from whatever the last session left
       behind — by disabling the transition for one frame. */
    [ref.homeFill, ref.awayFill].forEach(f => { f.style.transition = 'none'; });
    ref.homeFill.style.width = '0%';
    ref.awayFill.style.width = '0%';
    ref.homeAmount.textContent = gdcFormatGoldK(0);
    ref.awayAmount.textContent = gdcFormatGoldK(0);
    ref.diffNum.textContent    = gdcFormatDiffK(0);
    ref.triHome.classList.remove('gdc-tri-on');
    ref.triAway.classList.remove('gdc-tri-on');
    ref.homeGold = 0; ref.awayGold = 0;
    void track.offsetWidth; /* force reflow before re-enabling the transition */
    [ref.homeFill, ref.awayFill].forEach(f => { f.style.transition = ''; });
  }
}

function gdcPlaySmartFlourish() {
  const smart = document.getElementById('gdc-smart');
  if (!smart) return;
  smart.classList.remove('gdc-bounce-play', 'gdc-sheen-play');
  void smart.offsetWidth;
  smart.classList.add('gdc-bounce-play', 'gdc-sheen-play');
}

function gdcAnimateIn() {
  gdcShouldShow = true;
  gdcPriming    = true;
  clearTimeout(gdcOutTimer);
  clearTimeout(gdcRevealTimer);
  const clip    = document.getElementById('golddiff-check-clip');
  const overlay = document.getElementById('golddiff-check-overlay');
  clip.style.display = 'block';

  gdcResetToZero();

  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.classList.add('gdc-in');
  }));

  /* Bars grow, numbers count up, and the smart chip does its
     button-press + sheen — all fired together once the slide-in
     finishes. */
  gdcRevealTimer = setTimeout(() => {
    if (!gdcShouldShow) return;
    gdcPriming = false;
    gdcPlaySmartFlourish();
    if (lastData) gdcApplyData(lastData);
  }, GDC_REVEAL_DELAY);
}

function gdcAnimateOut() {
  gdcShouldShow = false;
  gdcPriming    = false;
  clearTimeout(gdcRevealTimer);
  const clip    = document.getElementById('golddiff-check-clip');
  const overlay = document.getElementById('golddiff-check-overlay');
  overlay.classList.remove('gdc-in');
  clearTimeout(gdcOutTimer);
  gdcOutTimer = setTimeout(() => {
    clip.style.display = 'none';
  }, 350);
}
