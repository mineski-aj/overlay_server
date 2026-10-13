/* ── [FEATURE: teamfight-check] ─────────────────────────────────
   "Live Team Fight" — a live damage-split bar. Shares the item-check
   panel's 887px width and its fixed-clip / sliding-inner pattern (see
   the #teamfight-check-* block in mploverlay_v7.css).

   Damage is measured from the moment the panel is shown, same as the
   LED Overlay's Team Fight Damage: each show takes a snapshot of every
   player's total_damage (tfcSnap), and the bar/totals only count what
   was dealt since. Re-showing the panel therefore resets it to zero.

   Layout: label container on top ([blue total] TEAM FIGHT DAMAGE [red
   total]), then one bar split blue-left / red-right. Each side's
   per-player segments stay in fixed seat order (seat 1 leftmost) and just
   grow/shift via CSS transitions as damage comes in — no re-ranking. */
const TFC_W       = 887;
const TFC_SEG_TXT_MIN  = 38;   /* px — hide the damage number below this width */
const TFC_PORTRAIT     = 44;

let tfcShouldShow = false;
let tfcOutTimer   = null;
let tfcSnap       = null;      /* { playerIdx: total_damage at show time } */
const tfcRefs     = {};        /* playerIdx -> { seg, txt, portrait } */
const tfcTotals   = { b: 0, r: 0 };       /* target (real) totals */
const tfcShown    = { b: 0, r: 0 };       /* ticker's currently displayed values */
let tfcTickRaf    = 0;
let tfcBlueEl, tfcRedEl;

function tfcFmtSeg(n) {
  if (n <= 0) return '';
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
}

function tfcBuildPanel() {
  const overlay = document.getElementById('teamfight-check-overlay');
  if (!overlay) return;

  const label = document.createElement('div');
  label.className = 'tfc-label';
  tfcBlueEl = document.createElement('span');
  tfcBlueEl.className = 'tfc-total tfc-total-blue';
  tfcBlueEl.textContent = '0';
  const title = document.createElement('span');
  title.className = 'tfc-title';
  title.textContent = 'TEAM FIGHT DAMAGE';
  tfcRedEl = document.createElement('span');
  tfcRedEl.className = 'tfc-total tfc-total-red';
  tfcRedEl.textContent = '0';
  label.append(tfcBlueEl, title, tfcRedEl);
  overlay.appendChild(label);

  const bar = document.createElement('div');
  bar.className = 'tfc-bar';
  overlay.appendChild(bar);

  for (let i = 1; i <= 10; i++) {
    const camp = i <= 5 ? 'blue' : 'red';
    const seg = document.createElement('div');
    seg.className = 'tfc-seg tfc-' + camp;
    const txt = document.createElement('span');
    txt.className = 'tfc-seg-txt';
    seg.appendChild(txt);
    bar.appendChild(seg);

    const portrait = document.createElement('img');
    portrait.className = 'tfc-portrait tfc-' + camp;
    portrait.alt = '';
    portrait.onerror = () => { portrait.onerror = null; portrait.removeAttribute('src'); };
    overlay.appendChild(portrait);

    tfcRefs[i] = { seg, txt, portrait };
  }
}
tfcBuildPanel();

function tfcTakeSnap(data) {
  tfcSnap = {};
  for (let i = 1; i <= 10; i++) {
    const r = getPlayer(data, i);
    tfcSnap[i] = r ? (parseInt(r.player.total_damage) || 0) : 0;
  }
}

/* Lays out one side in fixed seat order (seat 1 leftmost) — segments grow
   in place and never re-rank, so nothing swaps position mid-fight. */
function tfcLayoutSide(entries, startX, scale) {
  const order = entries;
  let x = startX;
  order.forEach(e => {
    const w = e.dmg * scale;
    const ref = tfcRefs[e.i];
    ref.seg.style.left  = x + 'px';
    ref.seg.style.width = w + 'px';
    ref.txt.textContent = tfcFmtSeg(e.dmg);
    ref.txt.style.opacity = w >= TFC_SEG_TXT_MIN ? '1' : '0';
    ref.portrait.style.left = (x + w / 2 - TFC_PORTRAIT / 2) + 'px';
    ref.portrait.style.opacity = w >= 1 ? '1' : '0';
    ref.portrait.classList.toggle('tfc-dead', !!e.dead);
    x += w;
  });
}

function tfcUpdate(data) {
  if (!tfcShouldShow) return;
  if (!tfcSnap) tfcTakeSnap(data);

  const blue = [], red = [];
  for (let i = 1; i <= 10; i++) {
    const r = getPlayer(data, i);
    if (!r || !r.player) continue;
    const dmg = Math.max(0, (parseInt(r.player.total_damage) || 0) - (tfcSnap[i] || 0));
    const heroId = r.player.heroid;
    const ref = tfcRefs[i];
    if (heroId && ref.portrait.dataset.id !== String(heroId)) {
      ref.portrait.dataset.id = String(heroId);
      ref.portrait.src = heroWebUrl(heroId);
    }
    (i <= 5 ? blue : red).push({ i, dmg, dead: !!r.player.dead });
  }

  const b = blue.reduce((t, e) => t + e.dmg, 0);
  const r = red.reduce((t, e) => t + e.dmg, 0);
  const total = b + r;
  const scale = total > 0 ? TFC_W / total : 0;
  tfcLayoutSide(blue, 0, scale);
  tfcLayoutSide(red, b * scale, scale);

  tfcTotals.b = b; tfcTotals.r = r;
  tfcStartTicker();
}

/* Ticker: eases each displayed total toward its real value — only runs
   while something is still catching up, so an idle panel costs nothing. */
function tfcStartTicker() {
  if (tfcTickRaf) return;
  const step = () => {
    tfcTickRaf = 0;
    let moving = false;
    [['b', tfcBlueEl], ['r', tfcRedEl]].forEach(([k, el]) => {
      const diff = tfcTotals[k] - tfcShown[k];
      if (diff !== 0) {
        const inc = Math.sign(diff) * Math.max(1, Math.ceil(Math.abs(diff) * 0.12));
        tfcShown[k] += inc;
        if (Math.sign(tfcTotals[k] - tfcShown[k]) !== Math.sign(diff)) tfcShown[k] = tfcTotals[k];
        el.textContent = tfcShown[k].toLocaleString('en-US');
        moving = true;
      }
    });
    if (moving && tfcShouldShow) tfcTickRaf = requestAnimationFrame(step);
  };
  tfcTickRaf = requestAnimationFrame(step);
}

function tfcResetVisuals() {
  tfcSnap = null;
  tfcTotals.b = tfcTotals.r = tfcShown.b = tfcShown.r = 0;
  tfcBlueEl.textContent = '0';
  tfcRedEl.textContent = '0';
  for (let i = 1; i <= 10; i++) {
    const ref = tfcRefs[i];
    ref.seg.classList.add('tfc-notrans');
    ref.portrait.classList.add('tfc-notrans');
    ref.seg.style.width = '0px';
    ref.txt.textContent = '';
    ref.portrait.style.opacity = '0';
  }
  void document.getElementById('teamfight-check-overlay').offsetWidth;
  for (let i = 1; i <= 10; i++) {
    tfcRefs[i].seg.classList.remove('tfc-notrans');
    tfcRefs[i].portrait.classList.remove('tfc-notrans');
  }
}

function tfcAnimateIn() {
  tfcShouldShow = true;
  clearTimeout(tfcOutTimer);
  const clip    = document.getElementById('teamfight-check-clip');
  const overlay = document.getElementById('teamfight-check-overlay');

  tfcResetVisuals();
  document.getElementById('kill-event-overlay').classList.add('ke-shift-up');
  if (lastData) { tfcTakeSnap(lastData); tfcUpdate(lastData); }

  clip.style.display = 'block';
  /* Double rAF so the hidden-state transform is committed before .tfc-in
     changes it (same technique as icAnimateIn). */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (tfcShouldShow) overlay.classList.add('tfc-in');
  }));
}

function tfcAnimateOut() {
  tfcShouldShow = false;
  const clip    = document.getElementById('teamfight-check-clip');
  const overlay = document.getElementById('teamfight-check-overlay');
  overlay.classList.remove('tfc-in');
  document.getElementById('kill-event-overlay').classList.remove('ke-shift-up');
  clearTimeout(tfcOutTimer);
  tfcOutTimer = setTimeout(() => {
    if (!tfcShouldShow) clip.style.display = 'none';
  }, 350);
  playNextKillEvent();
}

registerPollHandler(tfcUpdate);
