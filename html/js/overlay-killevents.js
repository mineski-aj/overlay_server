/* ── [FEATURE: kill-events] ── */

var killEventPlaying = false;
var killEventCurrent = null; /* video filename currently playing */
const killEventQueue = []; /* each entry: { src, priority, playerIdx, playerName, role } */

const killOverlayEl     = document.getElementById('kill-event-overlay');
const killVideoEl       = document.getElementById('kill-event-video');
const killPhotoClipEl   = document.getElementById('kill-event-photo-clip');
const killPhotoEl       = document.getElementById('kill-event-photo');
const killNametagClipEl = document.getElementById('kill-event-nametag-clip');
const killNametagBgEl   = document.getElementById('kill-event-nametag-text');
const killNameEl        = document.getElementById('kill-event-name');
const killRoleIconEl    = document.getElementById('kill-event-role-icon');

/* Pop timing — start delayed 300ms after the trigger, held up for 1.3s,
   then pops back down. KILL_POP_EXIT_MS must track the exit transition
   duration in mploverlay_v7.css so the overlay hide (below) never cuts
   the pop-down transition short. */
var KILL_POP_DELAY_MS = 300;
var KILL_POP_HOLD_MS  = 1300;
var KILL_POP_EXIT_MS  = 300;

/* Must track #kill-event-photo-clip.ke-in #kill-event-photo's transition
   duration in mploverlay_v7.css — the bounce fires right as the slide-up lands. */
var KILL_POP_ENTER_MS = 480;

/* Rectangle_3 (name text box) is 151px wide — leave a small margin so
   shrink-to-fit text never touches the plate art's edges. */
var KILL_NAME_MAX_W = 139;

var killShowTimer      = null; /* pending: about to pop in */
var killBounceTimer    = null; /* pending: about to play the settle bounce */
var killHoldTimer      = null; /* pending: about to pop back out */
var killPopCycleEndsAt = 0;    /* Date.now() timestamp when the pop-down transition finishes */
var killEventToken      = 0;   /* bumped each time a new video starts, to void stale deferred hides */

function killEventPhotoSrc(playerName) {
  return 'photos/SIGNATURE/' + encodeURIComponent(playerName) + '_SIGNATURE_resized.png';
}

function killNametagBgSrc(camp) {
  return 'assets/ingame/kill' + (camp === 'red' ? 'red' : 'blue') + 'back.png';
}

/* Shrink-to-fit text (binary search font-size) — same approach as
   sbFitText/eccFitName/etc. elsewhere, so a long IGN never overflows
   Rectangle_3's 151×30 box. */
function killFitNameMeasure(el) {
  el.style.fontSize = '16px';
  if (el.scrollWidth <= KILL_NAME_MAX_W) return;
  var lo = 8, hi = 16;
  while (hi - lo > 0.5) {
    var mid = (lo + hi) / 2;
    el.style.fontSize = mid + 'px';
    if (el.scrollWidth <= KILL_NAME_MAX_W) lo = mid; else hi = mid;
  }
  el.style.fontSize = lo + 'px';
}
function killFitName(el) {
  killFitNameMeasure(el);
  /* General Sans loads async (font-display:block) — if a kill event fires
     before it's ready, the fit above measures against fallback-font glyphs
     and can under-size the text. Re-measure once the real face is in. */
  if (document.fonts && document.fonts.status !== 'loaded') {
    document.fonts.ready.then(function() { killFitNameMeasure(el); });
  }
}

function clearKillTimers() {
  if (killShowTimer)   { clearTimeout(killShowTimer);   killShowTimer   = null; }
  if (killBounceTimer) { clearTimeout(killBounceTimer); killBounceTimer = null; }
  if (killHoldTimer)   { clearTimeout(killHoldTimer);   killHoldTimer   = null; }
  killPhotoEl.classList.remove('ke-bounce');
}

function showKillEventPlayer(playerName, role, camp) {
  clearKillTimers();
  /* if a previous popup is still up, slide it out first — the new photo/name/role
     only get swapped in once it's fully hidden, so we never swap the image mid-slide */
  killPhotoClipEl.classList.remove('ke-in');
  killNametagClipEl.classList.remove('ke-in');

  killShowTimer = setTimeout(function() {
    killShowTimer = null;
    killPhotoEl.src = killEventPhotoSrc(playerName);
    killNametagBgEl.style.backgroundImage = 'url(' + killNametagBgSrc(camp) + ')';
    killNameEl.textContent = playerName;
    killFitName(killNameEl);
    if (role && ROLE_ICONS[role]) {
      killRoleIconEl.src = ROLE_ICONS[role];
      killRoleIconEl.style.display = '';
    } else {
      killRoleIconEl.removeAttribute('src');
      killRoleIconEl.style.display = 'none';
    }
    killPhotoClipEl.classList.add('ke-in');
    killNametagClipEl.classList.add('ke-in');
    killBounceTimer = setTimeout(function() {
      killBounceTimer = null;
      killPhotoEl.classList.remove('ke-bounce');
      void killPhotoEl.offsetWidth;
      killPhotoEl.classList.add('ke-bounce');
    }, KILL_POP_ENTER_MS);
    killHoldTimer = setTimeout(function() {
      killHoldTimer = null;
      killPhotoClipEl.classList.remove('ke-in');
      killNametagClipEl.classList.remove('ke-in');
    }, KILL_POP_HOLD_MS);
  }, KILL_POP_DELAY_MS);

  killPopCycleEndsAt = Date.now() + KILL_POP_DELAY_MS + KILL_POP_HOLD_MS + KILL_POP_EXIT_MS;
}

function hideKillEventPlayer() {
  clearKillTimers();
  killPhotoClipEl.classList.remove('ke-in');
  killNametagClipEl.classList.remove('ke-in');
  killPopCycleEndsAt = 0;
}

/* Defers hiding #kill-event-overlay until the player popup (if any) has
   fully finished its pop-down transition, instead of yanking it away
   mid-animation the instant the video ends. Guarded by a token so a
   stale deferred hide can never clobber a video that started after it. */
function scheduleOverlayHide() {
  var token     = killEventToken;
  var remaining = killPopCycleEndsAt - Date.now();
  function finish() {
    if (killEventToken === token) killOverlayEl.style.display = 'none';
  }
  if (remaining > 0) setTimeout(finish, remaining);
  else finish();
}

killVideoEl.addEventListener('ended', function() {
  scheduleOverlayHide();
  killEventPlaying = false;
  killEventCurrent = null;
  playNextKillEvent();
});

/* safety net: if video stalls or errors, don't get stuck */
killVideoEl.addEventListener('error', function() {
  scheduleOverlayHide();
  hideKillEventPlayer();
  killEventPlaying = false;
  killEventCurrent = null;
  playNextKillEvent();
});

function playNextKillEvent() {
  if (killEventPlaying || killEventQueue.length === 0) return;
  killEventPlaying = true;
  killEventToken++;
  var entry = killEventQueue.shift();
  killEventCurrent = entry.video;
  killVideoEl.src = 'assets/motion/' + entry.video;
  killOverlayEl.style.display = 'block';
  if (entry.playerName) showKillEventPlayer(entry.playerName, entry.role, entry.camp);
  else hideKillEventPlayer();
  killVideoEl.play().catch(function() {
    scheduleOverlayHide();
    hideKillEventPlayer();
    killEventPlaying = false;
    playNextKillEvent();
  });
}

/* receive kill event trigger from dashboard preview postMessage */
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'killevent') {
    enqueueKillEvent(e.data.video, e.data.priority || 1, null, null, null, null);
  }
});

function enqueueKillEvent(video, priority, playerIdx, playerName, role, camp) {
  if (!featureEnabled.killevents) return;
  /* deduplicate: don't queue if same video is already playing or already queued */
  if (killEventCurrent === video) return;
  if (killEventQueue.some(function(e) { return e.video === video; })) return;
  killEventQueue.push({ video: video, priority: priority, playerIdx: playerIdx || null, playerName: playerName || null, role: role || null, camp: camp || null });
  playNextKillEvent();
}
