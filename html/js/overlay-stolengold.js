/* ── [FEATURE: stolen-gold] "Jungle Resource Stolen" banner ──────────
   A single top-of-screen banner (NOT per-player) showing how much
   jungle gold, purple buff, and orange buff each camp has stolen from
   the other side's jungle (camp_list[].jungle_stolen — see
   reference_mlbb_api.md memory). Two independent ways this banner can
   be visible, layered on top of each other:

   1. MANUAL — sgAnimateIn()/sgAnimateOut(), driven by the dashboard
      Control tab's Stolen Gold toggle (checkOverlays pattern, same
      shape as Item Check/Emblem Check/Gold Diff Check). Stays up until
      explicitly hidden. Tracked here as sgManualOn.
   2. AUTO — fires on its own at four fixed game_time checkpoints
      (2:05, 5:05, 8:05, 12:05), armable/disarmable from the dashboard
      like Level 15/Objective Spawn (featureEnabled.stolengold), and
      stays up for a tunable duration (/api/stolengold-duration) before
      auto-hiding. Detection is self-contained in this file
      (registerPollHandler at the bottom), same as
      overlay-objectivespawn.js, rather than living in
      overlay-debug.js's shared poll handler. Tracked here as
      sgAutoPlaying/sgAutoQueued.

   Visibility is computed in sgSync() as sgManualOn || sgAutoPlaying —
   never set the CSS class directly anywhere else. This is deliberate:
   an in-progress auto pop-up must NEVER be cut short. If the dashboard's
   manual hide is clicked while sgAutoPlaying is still true, sgSync()
   sees sgAutoPlaying still true and keeps the banner up — the manual
   hide "sticks" (sgManualOn is now false) but only actually takes
   visible effect once the auto pop-up's own duration timer finishes
   and flips sgAutoPlaying back to false. An auto pop-up also never
   fires while the banner is already up manually.

   Cold-start guard: a threshold already in the past on this page's very
   first poll (e.g. the overlay was opened/refreshed mid-game) is marked
   fired WITHOUT enqueuing an animation — only an actually-OBSERVED
   positive crossing between two polls fires the auto pop-up. Detection
   keeps running even while featureEnabled.stolengold is false, so a
   threshold crossed while disarmed is consumed silently instead of
   bursting out the moment the feature is re-armed (same reasoning as
   overlay-objectivespawn.js's turtle/lord scheduling). */

var STOLENGOLD_THRESHOLDS = [125, 305, 485, 725]; /* 2:05, 5:05, 8:05, 12:05 */
var sgFiredThresholds = {};
var sgPrevGameTime = null;

var sgOverlayEl = document.getElementById('stolengold-overlay');
var sgEls = {
  c1purple: document.getElementById('sg-c1-purple'),
  c1orange: document.getElementById('sg-c1-orange'),
  c1gold:   document.getElementById('sg-c1-gold'),
  c2purple: document.getElementById('sg-c2-purple'),
  c2orange: document.getElementById('sg-c2-orange'),
  c2gold:   document.getElementById('sg-c2-gold'),
};

var sgShouldShow  = false; /* mirrors sgManualOn || sgAutoPlaying — set only by sgSync() */
var sgManualOn    = false; /* mirrors the dashboard's persistent toggle */
var sgAutoPlaying = false; /* an auto pop-up is currently in its on-screen window */
var sgAutoQueued  = false; /* another threshold fired while one auto pop-up still playing */

function sgFormatGold(g) {
  g = g || 0;
  return g >= 1000 ? (g / 1000).toFixed(1) + 'k' : String(g);
}

/* Shrink-to-fit for the gold columns (wider values like "12.5k" can
   overflow the narrower 38px buff-count columns' default size). */
function sgFitValue(el, maxSize, minSize) {
  var size = maxSize;
  el.style.fontSize = size + 'px';
  while (el.scrollWidth > el.clientWidth && size > minSize) {
    el.style.fontSize = (--size) + 'px';
  }
}

function sgApplyData(data) {
  if (!sgShouldShow) return;
  var camp1 = data && (data.camp_list || []).find(function(c) { return c.campid === 1; });
  var camp2 = data && (data.camp_list || []).find(function(c) { return c.campid === 2; });
  var js1 = (camp1 && camp1.jungle_stolen) || { monster_gold: 0, orange_buffer_num: 0, purple_buffer_num: 0 };
  var js2 = (camp2 && camp2.jungle_stolen) || { monster_gold: 0, orange_buffer_num: 0, purple_buffer_num: 0 };

  sgEls.c1purple.textContent = js1.purple_buffer_num || 0;
  sgEls.c1orange.textContent = js1.orange_buffer_num || 0;
  sgEls.c1gold.textContent   = sgFormatGold(js1.monster_gold);
  sgEls.c2purple.textContent = js2.purple_buffer_num || 0;
  sgEls.c2orange.textContent = js2.orange_buffer_num || 0;
  sgEls.c2gold.textContent   = sgFormatGold(js2.monster_gold);

  sgFitValue(sgEls.c1gold, 30, 14);
  sgFitValue(sgEls.c2gold, 30, 14);
}
registerPollHandler(sgApplyData);

/* Single source of truth for on-screen visibility — see file header. */
function sgSync() {
  sgShouldShow = sgManualOn || sgAutoPlaying;
  if (sgShouldShow) {
    sgApplyData(lastData || {});
    sgOverlayEl.classList.add('sg-in');
  } else {
    sgOverlayEl.classList.remove('sg-in');
  }
}

/* ── Manual show/hide (dashboard Control tab / debug SHOW-HIDE) ── */
function sgAnimateIn() {
  sgManualOn = true;
  sgSync();
}

function sgAnimateOut() {
  sgManualOn = false;
  sgSync(); /* no-op visually if an auto pop-up is still mid-duration */
}

/* ── Auto pop-up (2:05/5:05/8:05/12:05 game_time) ── */

/* Duration fetched fresh every time the banner is about to auto-show,
   same pattern as Credit Reel's credits_speed.json (/api/credits-speed) —
   tuning it from Dashboard Control affects the very next fire. */
function sgGetDuration() {
  return fetch('/api/stolengold-duration', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(d) { return (d && d.duration) || 8; })
    .catch(function() { return 8; });
}

function sgPlayAuto() {
  sgAutoPlaying = true;
  sgSync();
  sgGetDuration().then(function(durationSec) {
    setTimeout(function() {
      sgAutoPlaying = false;
      sgSync(); /* stays visible here if sgManualOn was turned on meanwhile */
      if (sgAutoQueued) { sgAutoQueued = false; sgPlayAuto(); }
    }, durationSec * 1000);
  });
}

function sgAutoTrigger() {
  if (!featureEnabled.stolengold) return;
  if (sgManualOn) return; /* already up manually, no need to pop up */
  if (sgAutoPlaying) { sgAutoQueued = true; return; }
  sgPlayAuto();
}

function sgUpdate(data) {
  var gameTime = data.game_time;
  if (typeof gameTime !== 'number') return;

  STOLENGOLD_THRESHOLDS.forEach(function(t) {
    if (sgFiredThresholds[t]) return;
    if (sgPrevGameTime != null && sgPrevGameTime < t && gameTime >= t) {
      sgFiredThresholds[t] = true;
      sgAutoTrigger();
    } else if (sgPrevGameTime == null && gameTime >= t) {
      /* cold start already past this checkpoint — suppress, don't fire */
      sgFiredThresholds[t] = true;
    }
  });
  sgPrevGameTime = gameTime;
}
registerPollHandler(sgUpdate);

window.sgAnimateIn  = sgAnimateIn;
window.sgAnimateOut = sgAnimateOut;
