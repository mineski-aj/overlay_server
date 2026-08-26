/* ── [FEATURE: sidekdadistricheck] ────────────────────────────────
   "Side KDA Distri" — a featured/selected player card (photo, level,
   hero, big KDA, nameplate) plus 5 enemy-lane stat bars below. Own
   bespoke file, same reasoning as overlay-sidegolddistricheck.js (not
   the ranked-10-list createSideCheck() shape). Reuses the shared
   .sidecheck-clip/.sidecheck-overlay shell + sidestatback.png +
   "KDA DISTRIBUTION" header. See the .skdc-* CSS block in
   mploverlay_v7.css for full layout notes.

   Data source: /api/kdadistri-data (own proxy + own low-frequency
   poll, same reasoning as sidegolddistricheck's /api/golddistri-data).
   Response shape: { selected: {...featured player...}, distribution:
   [...5 enemy-lane entries...] }. campid 1 = blue/left, 2 = red/right,
   same convention as everywhere else in this project.

   Hero level isn't in this API at all — cross-referenced from the
   main game-state poll's own `lastData` global (overlay-core.js),
   matching selected.camp + selected.name against that camp's 5 seats;
   blank if no match (e.g. the poll hasn't started, or a name mismatch). */

function skdcCampClass(camp) {
  return camp === 1 ? 'skdc-camp-blue' : 'skdc-camp-red';
}

/* /photos/SIGNATURE/<name>_SIGNATURE_resized.png — same convention as
   overlay-killevents.js's killEventPhotoSrc, for the featured player. */
function skdcSignaturePhotoSrc(name) {
  if (!name) return '';
  return `/photos/SIGNATURE/${encodeURIComponent(name)}_SIGNATURE_resized.png`;
}
/* /photos/FRONT/<name>_FRONT_resized.png for the 5 stat-bar photos —
   always FRONT regardless of that row's own camp (unlike
   sidegolddistricheck's LEFT/RIGHT-per-side sgdcPhotoSrc; this box is
   always in the same physical position within its row, not tied to
   team side). */
function skdcSidePhotoSrc(name) {
  if (!name) return '';
  return `/photos/FRONT/${encodeURIComponent(name + '_FRONT_resized.png')}`;
}
function skdcHeroSrc(heroid) {
  return heroid ? `hero/HERO_${heroid}_KOTAK.png` : '';
}
/* "Exp Laner" / "Gold Laner" / etc already match role/EXP LANER.png
   etc's naming exactly once uppercased — no lookup table needed. */
function skdcRoleIconSrc(role) {
  return role ? `role/${encodeURIComponent(role.toUpperCase())}.png` : '';
}

/* Cross-references the live game-state poll (overlay-core.js's global
   `lastData`) for the featured player's hero level — not present in
   this panel's own API at all. Same camp + same name, first match
   across that camp's 5 seats; null (→ blank) if nothing matches. */
function skdcFindLevel(camp, name) {
  if (!lastData || !lastData.camp_list || !name) return null;
  const campObj = lastData.camp_list.find(c => c.campid === camp);
  if (!campObj) return null;
  for (let s = 1; s <= 5; s++) {
    const seat = campObj['seat_' + s];
    if (seat && seat.name === name) return parseInt(seat.level) || null;
  }
  return null;
}

let skdcShouldShow     = false;
let skdcOutTimer       = null;
let skdcLastData       = null; /* most recent /api/kdadistri-data response ({selected, distribution}) */
let skdcWaitingForData = false;
let skdcRefs           = null;

function skdcBuildPanel() {
  const overlay = document.getElementById('sidekdadistri-check-overlay');
  if (!overlay) return;

  const bg = document.createElement('img');
  bg.className = 'sidecheck-bg';
  bg.src = 'assets/ingame/sidestatback.png';
  bg.alt = '';
  overlay.appendChild(bg);

  const header = document.createElement('div');
  header.className = 'sidecheck-header';
  header.textContent = 'KDA DISTRIBUTION';
  overlay.appendChild(header);

  const square = document.createElement('div');
  square.className = 'skdc-square';
  const photo = document.createElement('img');
  photo.className = 'skdc-photo';
  photo.alt = '';
  photo.onerror = () => { photo.onerror = null; photo.removeAttribute('src'); };
  square.appendChild(photo);
  overlay.appendChild(square);

  const level = document.createElement('div');
  level.className = 'skdc-level';
  overlay.appendChild(level);

  const hero = document.createElement('img');
  hero.className = 'skdc-hero';
  hero.alt = '';
  hero.onerror = () => { hero.onerror = null; hero.removeAttribute('src'); };
  overlay.appendChild(hero);

  const roleBadge = document.createElement('div');
  roleBadge.className = 'skdc-role-badge';
  const roleBadgeIcon = document.createElement('img');
  roleBadgeIcon.className = 'skdc-role-badge-icon';
  roleBadgeIcon.alt = '';
  roleBadge.appendChild(roleBadgeIcon);
  overlay.appendChild(roleBadge);

  const kdaLabel = document.createElement('div');
  kdaLabel.className = 'skdc-kda-label';
  kdaLabel.textContent = 'KDA';
  overlay.appendChild(kdaLabel);

  const kdaValue = document.createElement('div');
  kdaValue.className = 'skdc-kda-value';
  overlay.appendChild(kdaValue);

  const nameplate = document.createElement('div');
  nameplate.className = 'skdc-nameplate';
  const nameplateName = document.createElement('span');
  nameplateName.className = 'skdc-nameplate-name';
  nameplate.appendChild(nameplateName);
  overlay.appendChild(nameplate);

  const versus = document.createElement('div');
  versus.className = 'skdc-versus';
  versus.textContent = 'VERSUS';
  overlay.appendChild(versus);

  /* First stat-row top (240) / last (500) given directly — gap is
     derived from those two anchors, same approach as
     sidegolddistricheck's stat rows. */
  const ROW_TOP0    = 240;
  const ROW_LAST_TOP = 500;
  const ROW_H       = 62;
  const ROW_COUNT   = 5;
  const ROW_GAP     = (ROW_LAST_TOP - ROW_TOP0 - (ROW_COUNT - 1) * ROW_H) / (ROW_COUNT - 1);

  const rows = [];
  for (let i = 0; i < ROW_COUNT; i++) {
    const row = document.createElement('div');
    row.className = 'skdc-stat-row';
    row.style.top = (ROW_TOP0 + i * (ROW_H + ROW_GAP)) + 'px';

    const photobox = document.createElement('div');
    photobox.className = 'skdc-stat-photobox';
    const statPhoto = document.createElement('img');
    statPhoto.className = 'skdc-stat-photo';
    statPhoto.alt = '';
    statPhoto.onerror = () => { statPhoto.onerror = null; statPhoto.removeAttribute('src'); };
    photobox.appendChild(statPhoto);

    const statHero = document.createElement('img');
    statHero.className = 'skdc-stat-hero';
    statHero.alt = '';
    statHero.onerror = () => { statHero.onerror = null; statHero.removeAttribute('src'); };

    const statRole = document.createElement('img');
    statRole.className = 'skdc-stat-role';
    statRole.alt = '';

    const statName = document.createElement('div');
    statName.className = 'skdc-stat-name';

    const statKdaLabel = document.createElement('div');
    statKdaLabel.className = 'skdc-stat-kda-label';
    statKdaLabel.textContent = 'KDA';

    const statKdaValue = document.createElement('div');
    statKdaValue.className = 'skdc-stat-kda-value';
    const kK = document.createElement('span');
    const kSep1 = document.createElement('span');
    kSep1.textContent = ' / ';
    const kD = document.createElement('span');
    const kSep2 = document.createElement('span');
    kSep2.textContent = ' / ';
    const kA = document.createElement('span');
    statKdaValue.appendChild(kK);
    statKdaValue.appendChild(kSep1);
    statKdaValue.appendChild(kD);
    statKdaValue.appendChild(kSep2);
    statKdaValue.appendChild(kA);

    row.appendChild(photobox);
    row.appendChild(statHero);
    row.appendChild(statRole);
    row.appendChild(statName);
    row.appendChild(statKdaLabel);
    row.appendChild(statKdaValue);
    overlay.appendChild(row);

    rows.push({ row, photobox, statPhoto, statHero, statRole, statName, kK, kD, kA });
  }

  skdcRefs = { square, photo, level, hero, roleBadgeIcon, kdaValue, nameplate, nameplateName, rows };
}
skdcBuildPanel();

function skdcApplyData(data) {
  if (!skdcRefs) return;
  const selected = data && data.selected;
  const distribution = (data && data.distribution) || [];

  const camp = selected && selected.camp;
  const campClass = skdcCampClass(camp || 1);

  skdcRefs.square.classList.remove('skdc-camp-blue', 'skdc-camp-red');
  skdcRefs.square.classList.add(campClass);
  skdcRefs.photo.src = skdcSignaturePhotoSrc(selected && selected.name);

  const lvl = selected ? skdcFindLevel(selected.camp, selected.name) : null;
  skdcRefs.level.textContent = lvl ? lvl : '';

  skdcRefs.hero.src = skdcHeroSrc(selected && selected.heroid);
  skdcRefs.roleBadgeIcon.src = skdcRoleIconSrc(selected && selected.role);
  skdcRefs.kdaValue.textContent = (selected && selected.kda) || '';

  skdcRefs.nameplate.classList.remove('skdc-camp-blue', 'skdc-camp-red');
  skdcRefs.nameplate.classList.add(campClass);
  skdcRefs.nameplateName.textContent = ((selected && selected.name) || '').toUpperCase();

  skdcRefs.rows.forEach((ref, i) => {
    const entry = distribution[i];
    const rowCampClass = skdcCampClass((entry && entry.camp) || 1);

    ref.row.classList.remove('skdc-camp-blue', 'skdc-camp-red');
    ref.row.classList.add(rowCampClass);
    ref.photobox.classList.remove('skdc-camp-blue', 'skdc-camp-red');
    ref.photobox.classList.add(rowCampClass);

    ref.statPhoto.src = skdcSidePhotoSrc(entry && entry.enemy_name);
    ref.statHero.src  = skdcHeroSrc(entry && entry.heroid);
    ref.statRole.src  = skdcRoleIconSrc(entry && entry.role);
    ref.statName.textContent = ((entry && entry.enemy_name) || '').toUpperCase();

    /* Per the user's explicit instruction: NOT parsed from the `kda`
       string — K/D/A come from these three separate fields instead. */
    const k = (entry && entry.killed_by_selected) || 0;
    const d = (entry && entry.selector_died) || 0;
    const a = (entry && entry.killed_assists_by_selected) || 0;
    ref.kK.textContent = k;
    ref.kD.textContent = d;
    ref.kA.textContent = a;
    ref.kD.classList.toggle('skdc-death-nonzero', d > 0);
  });
}

function skdcPoll() {
  fetch('/api/kdadistri-data', { cache: 'no-store' }).then(r => r.json()).then(data => {
    skdcLastData = data;
    if (skdcWaitingForData && skdcShouldShow) {
      skdcWaitingForData = false;
      skdcStartReveal();
    } else if (skdcShouldShow) {
      skdcApplyData(data);
    }
  }).catch(() => {});
}
skdcPoll();
setInterval(skdcPoll, 5000);

function skdcStartReveal() {
  const clip    = document.getElementById('sidekdadistri-check-clip');
  const overlay = document.getElementById('sidekdadistri-check-overlay');
  skdcApplyData(skdcLastData);
  clip.style.display = 'block';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.classList.add('sidecheck-in');
  }));
}

function skdcAnimateIn() {
  skdcShouldShow = true;
  clearTimeout(skdcOutTimer);
  if (!skdcLastData) {
    /* No poll data yet — hold off instead of popping in blank;
       skdcPoll() starts the reveal itself once data lands. */
    skdcWaitingForData = true;
    return;
  }
  skdcWaitingForData = false;
  skdcStartReveal();
}

function skdcAnimateOut() {
  skdcShouldShow = false;
  skdcWaitingForData = false;
  const clip    = document.getElementById('sidekdadistri-check-clip');
  const overlay = document.getElementById('sidekdadistri-check-overlay');
  overlay.classList.remove('sidecheck-in');
  clearTimeout(skdcOutTimer);
  skdcOutTimer = setTimeout(() => { clip.style.display = 'none'; }, 350);
}
