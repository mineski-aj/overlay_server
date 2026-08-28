/* ── [FEATURE: sidegolddistricheck] ─────────────────────────────────
   "Side Gold Distri" — a one-lane gold breakdown matchup (blue player
   vs red player for whichever role the API currently returns), NOT
   the standard ranked-10-player list the other side-*-check panels
   use, so this one is its own bespoke file rather than a
   createSideCheck() config (see overlay-sidecheck-core.js) — same
   pattern as overlay-golddiffcheck.js. Reuses the shared .sidecheck-
   clip/.sidecheck-overlay shell + sidestatback.png background +
   "GOLD DISTRIBUTION" header text (createSideCheck's usual bg/header
   build steps, done by hand here since we're not calling the factory).
   See the .sgdc-* CSS block in mploverlay_v7.css for full layout
   notes.

   Data source: /api/golddistri-data (own proxy + own low-frequency
   poll, same reasoning as golddiff-check's lastData / mpltag.html's
   playerh2h poll — this is an aggregate stat comparison, not a
   per-second live value, so it's fetched independently of the main
   game poll and already sitting in memory the instant Show is
   pressed). The endpoint returns an array of one role-matchup object
   ({camp1, camp2, role}); we just render entries[0] as-is — no role
   selector, matching "behaves the same as the other side checks"
   (a plain show/hide toggle, not Player H2H's per-role trigger
   family). campid 1 = camp1 = blue/home/left, 2 = camp2 = red/away/
   right, same convention as everywhere else in this project. */

/* This API's own `role` field uses short forms ("exp", "jungler",
   "mid", "roam", "gold") — different from the main game API's
   ROLE_ORDER convention ("exp_laner", "jungler", "mid_laner",
   "roamer", "gold_laner", see overlay-core.js). Both map onto the
   same role/<LABEL>.png icon set. */
const SGDC_ROLE_SHORT_LABEL = {
  exp:     'EXP LANER',
  jungler: 'JUNGLER',
  mid:     'MID LANER',
  roam:    'ROAMER',
  gold:    'GOLD LANER',
};
const SGDC_ROLE_LABEL = {
  exp_laner:  'EXP LANER',
  jungler:    'JUNGLER',
  mid_laner:  'MID LANER',
  roamer:     'ROAMER',
  gold_laner: 'GOLD LANER',
};

/* Cross-check fallback — same idea as sidekdadistricheck's
   skdcFindLevel: this API's own `role` value only reliably resolves
   via SGDC_ROLE_SHORT_LABEL above; if it doesn't (a value we don't
   recognize), search the live game-state poll (overlay-core.js's
   global `lastData`) for a seat with the same name, across both
   camps, and use ITS `role` field instead (already in the
   SGDC_ROLE_LABEL/ROLE_ORDER form). */
function sgdcFindRoleByName(name) {
  if (!lastData || !lastData.camp_list || !name) return null;
  for (const camp of lastData.camp_list) {
    for (let s = 1; s <= 5; s++) {
      const seat = camp['seat_' + s];
      if (seat && seat.name === name) return seat.role || null;
    }
  }
  return null;
}

/* Returns '' (not a guessed/possibly-404 URL) when the role can't be
   resolved either way, so the caller can leave the <img> with no src
   instead of showing a broken-image icon. */
function sgdcRoleIconSrc(role, camp1, camp2) {
  let label = SGDC_ROLE_SHORT_LABEL[role];
  if (!label) {
    const crossRole = sgdcFindRoleByName(camp1 && camp1.name) || sgdcFindRoleByName(camp2 && camp2.name);
    label = crossRole && SGDC_ROLE_LABEL[crossRole];
  }
  return label ? `role/${encodeURIComponent(label)}.png` : '';
}

/* /photos/LEFT/<ign>_LEFT_resized.png (home) / /photos/RIGHT/<ign>_RIGHT_resized.png
   (away) — same convention as mplfs.html's wlPhotoUrl (Waiting Lobby
   spotlight), just the lower-res /photos folder instead of /hires. */
function sgdcPhotoSrc(name, side) {
  if (!name) return '';
  const folder = side === 'home' ? 'LEFT' : 'RIGHT';
  return `/photos/${folder}/${encodeURIComponent(name + '_' + folder + '_resized.png')}`;
}

/* posthero/<heroid>_POST_HERO.png — same asset convention as
   ingame_red.html/ingame_blue.html's hero portraits. */
function sgdcHeroSrc(heroid) {
  return heroid ? `posthero/${heroid}_POST_HERO.png` : '';
}

function sgdcFormatGold(v) {
  return Math.round(v || 0).toLocaleString('en-US');
}

/* Count-up tween for the stat value numbers — same shape as golddiff-
   check's gdcCountTo/gdcEaseOutCubic. On reveal every row is snapped to
   0 first (sgdcResetToZero), so this ticks up from zero; on a later
   poll while already shown it just tweens from whatever's currently
   displayed to the new value instead of jumping. */
const SGDC_COUNT_MS = 700;
function sgdcEaseOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function sgdcCountTo(el, from, to) {
  const startTime = performance.now();
  cancelAnimationFrame(el._sgdcRaf);
  function tick(now) {
    const t = Math.min(1, (now - startTime) / SGDC_COUNT_MS);
    const eased = sgdcEaseOutCubic(t);
    el.textContent = sgdcFormatGold(from + (to - from) * eased);
    if (t < 1) el._sgdcRaf = requestAnimationFrame(tick);
    else        el.textContent = sgdcFormatGold(to);
  }
  el._sgdcRaf = requestAnimationFrame(tick);
}

/* Two-line stat labels — everything but the last word on line 1, the
   last word on line 2 (e.g. "KILLS & ASSISTS" → "KILLS &" / "ASSISTS"),
   single-word labels stay on one line. */
function sgdcSplitLabel(label) {
  const words = label.split(' ');
  if (words.length <= 1) return [label];
  return [words.slice(0, -1).join(' '), words[words.length - 1]];
}

/* 7 stat rows — row 1 is the seat's own total gold; rows 2-7 read a
   sector out of gold_map (keys "1"-"9" in the API; "7"/"8"/"9" aren't
   used by any of the 7 rows — "9" (Roam Vision) was the 8th row, cut). */
const SGDC_STATS = [
  { label: 'TOTAL GOLD',       key: null  },
  { label: 'KILLS & ASSISTS',  key: '6'   },
  { label: 'JUNGLE CREEPS',    key: '2'   },
  { label: 'MINIONS',          key: '1'   },
  { label: 'TURRETS',          key: '4'   },
  { label: 'TURTLES & LORD',   key: '3'   },
  { label: 'ROAM EQUIP',       key: '5'   },
].map(s => ({
  ...s,
  raw: seat => (s.key === null ? (seat && seat.gold) : (seat && seat.gold_map && seat.gold_map[s.key])) || 0,
}));

/* First row top / last row top given directly (276 / 526) — gap
   between rows is derived from those two anchors rather than a fixed
   3px, so the 7 rows land exactly on both given positions. */
const SGDC_ROW_TOP0    = 276;
const SGDC_ROW_LAST_TOP = 526;
const SGDC_ROW_H       = 39;
const SGDC_ROW_GAP     = (SGDC_ROW_LAST_TOP - SGDC_ROW_TOP0 - (SGDC_STATS.length - 1) * SGDC_ROW_H) / (SGDC_STATS.length - 1);

let sgdcShouldShow     = false;
let sgdcOutTimer       = null;
let sgdcLastData       = null; /* most recent /api/golddistri-data response (the whole array) */
let sgdcWaitingForData = false;
let sgdcRefs           = null;

function sgdcBuildSide(side) {
  const cropBox = document.createElement('div');
  cropBox.className = 'sgdc-photo-crop sgdc-photo-crop-' + side;
  const photo = document.createElement('img');
  photo.className = 'sgdc-photo sgdc-photo-' + side;
  photo.alt = '';
  photo.onerror = () => { photo.onerror = null; photo.removeAttribute('src'); };
  cropBox.appendChild(photo);

  const plate = document.createElement('div');
  plate.className = 'sgdc-plate sgdc-plate-' + side;
  const name = document.createElement('span');
  name.className = 'sgdc-name';
  plate.appendChild(name);

  return { cropBox, photo, plate, name };
}

function sgdcBuildPanel() {
  const overlay = document.getElementById('sidegolddistri-check-overlay');
  if (!overlay) return;

  const bg = document.createElement('img');
  bg.className = 'sidecheck-bg';
  bg.src = 'assets/ingame/sidestatback.png';
  bg.alt = '';
  overlay.appendChild(bg);

  const header = document.createElement('div');
  header.className = 'sidecheck-header';
  header.textContent = 'GOLD DISTRIBUTION';
  overlay.appendChild(header);

  const distri = document.createElement('div');
  distri.className = 'sgdc-distriback';

  const home = sgdcBuildSide('home');
  const away = sgdcBuildSide('away');

  const roleBadge = document.createElement('div');
  roleBadge.className = 'sgdc-role-badge';
  const roleIcon = document.createElement('img');
  roleIcon.className = 'sgdc-role-icon';
  roleIcon.alt = '';
  roleIcon.onerror = () => { roleIcon.onerror = null; roleIcon.removeAttribute('src'); };
  roleBadge.appendChild(roleIcon);

  distri.appendChild(home.cropBox);
  distri.appendChild(away.cropBox);
  distri.appendChild(home.plate);
  distri.appendChild(away.plate);
  distri.appendChild(roleBadge);
  overlay.appendChild(distri);

  /* Hero crops — sit directly below distriback (panel-frame
     coordinates, not nested inside it), one per side. */
  function buildHero(side) {
    const img = document.createElement('img');
    img.className = 'sgdc-hero sgdc-hero-' + side;
    img.alt = '';
    img.onerror = () => { img.onerror = null; img.removeAttribute('src'); };
    overlay.appendChild(img);
    return img;
  }
  const heroHome = buildHero('home');
  const heroAway = buildHero('away');

  const rows = SGDC_STATS.map((stat, i) => {
    const row = document.createElement('div');
    row.className = 'sgdc-stat-row';
    row.style.top = (SGDC_ROW_TOP0 + i * (SGDC_ROW_H + SGDC_ROW_GAP)) + 'px';

    const left = document.createElement('div');
    left.className = 'sgdc-stat-value sgdc-stat-home';

    const label = document.createElement('div');
    label.className = 'sgdc-stat-label';
    sgdcSplitLabel(stat.label).forEach(line => {
      const span = document.createElement('span');
      span.textContent = line;
      label.appendChild(span);
    });

    const right = document.createElement('div');
    right.className = 'sgdc-stat-value sgdc-stat-away';

    row.appendChild(left);
    row.appendChild(label);
    row.appendChild(right);
    overlay.appendChild(row);
    return { left, right, leftVal: 0, rightVal: 0 };
  });

  sgdcRefs = { home, away, roleIcon, heroHome, heroAway, rows };
}
sgdcBuildPanel();

function sgdcApplyData(data) {
  if (!sgdcRefs) return;
  const entry = Array.isArray(data) ? data[0] : null;
  const camp1 = entry && entry.camp1; /* blue / home / left */
  const camp2 = entry && entry.camp2; /* red / away / right */

  sgdcRefs.home.photo.src = sgdcPhotoSrc(camp1 && camp1.name, 'home');
  sgdcRefs.away.photo.src = sgdcPhotoSrc(camp2 && camp2.name, 'away');
  sgdcRefs.home.name.textContent = ((camp1 && camp1.name) || '').toUpperCase();
  sgdcRefs.away.name.textContent = ((camp2 && camp2.name) || '').toUpperCase();

  const roleIconSrc = sgdcRoleIconSrc(entry && entry.role, camp1, camp2);
  if (roleIconSrc) sgdcRefs.roleIcon.src = roleIconSrc;
  else sgdcRefs.roleIcon.removeAttribute('src');
  sgdcRefs.heroHome.src = sgdcHeroSrc(camp1 && camp1.heroid);
  sgdcRefs.heroAway.src = sgdcHeroSrc(camp2 && camp2.heroid);

  SGDC_STATS.forEach((stat, i) => {
    const ref = sgdcRefs.rows[i];
    const leftVal  = stat.raw(camp1);
    const rightVal = stat.raw(camp2);
    sgdcCountTo(ref.left,  ref.leftVal,  leftVal);
    sgdcCountTo(ref.right, ref.rightVal, rightVal);
    ref.leftVal  = leftVal;
    ref.rightVal = rightVal;

    /* Advantage highlight — bigger side's number goes team-colored,
       the other (and both, on a tie) stay the default black. Applied
       immediately against the final target values, independent of
       the count-up still animating toward them. */
    ref.left.classList.remove('sgdc-adv-blue');
    ref.right.classList.remove('sgdc-adv-red');
    if (leftVal > rightVal) ref.left.classList.add('sgdc-adv-blue');
    else if (rightVal > leftVal) ref.right.classList.add('sgdc-adv-red');
  });
}

/* Snaps every stat value back to 0 with no tween — called right before
   sgdcApplyData on reveal so the count-up in sgdcCountTo always starts
   from zero, instead of from whatever was left over from the last time
   this panel was shown. */
function sgdcResetToZero() {
  if (!sgdcRefs) return;
  sgdcRefs.rows.forEach(ref => {
    cancelAnimationFrame(ref.left._sgdcRaf);
    cancelAnimationFrame(ref.right._sgdcRaf);
    ref.left.textContent  = sgdcFormatGold(0);
    ref.right.textContent = sgdcFormatGold(0);
    ref.left.classList.remove('sgdc-adv-blue');
    ref.right.classList.remove('sgdc-adv-red');
    ref.leftVal  = 0;
    ref.rightVal = 0;
  });
}

function sgdcPoll() {
  fetch('/api/golddistri-data', { cache: 'no-store' }).then(r => r.json()).then(data => {
    sgdcLastData = data;
    if (sgdcWaitingForData && sgdcShouldShow) {
      sgdcWaitingForData = false;
      sgdcStartReveal();
    } else if (sgdcShouldShow) {
      sgdcApplyData(data);
    }
  }).catch(() => {});
}
sgdcPoll();
setInterval(sgdcPoll, 5000);

function sgdcStartReveal() {
  const clip    = document.getElementById('sidegolddistri-check-clip');
  const overlay = document.getElementById('sidegolddistri-check-overlay');
  sgdcResetToZero();
  sgdcApplyData(sgdcLastData);
  clip.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.classList.add('sidecheck-in');
  }));
}

function sgdcAnimateIn() {
  sgdcShouldShow = true;
  clearTimeout(sgdcOutTimer);
  if (!sgdcLastData) {
    /* No poll data yet (page just loaded) — hold off instead of
       popping in with a blank panel; sgdcPoll() starts the reveal
       itself the moment the first response lands. */
    sgdcWaitingForData = true;
    return;
  }
  sgdcWaitingForData = false;
  sgdcStartReveal();
}

function sgdcAnimateOut() {
  sgdcShouldShow = false;
  sgdcWaitingForData = false;
  const clip    = document.getElementById('sidegolddistri-check-clip');
  const overlay = document.getElementById('sidegolddistri-check-overlay');
  overlay.classList.remove('sidecheck-in');
  clearTimeout(sgdcOutTimer);
  sgdcOutTimer = setTimeout(() => { clip.style.display = 'none'; }, 350);
}
