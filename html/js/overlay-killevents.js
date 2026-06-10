/* ── [FEATURE: kill-events] ── */

var killEventPlaying = false;
var killEventCurrent = null; /* video filename currently playing */
const killEventQueue = []; /* each entry: { src, priority, playerIdx, playerName } */

const killOverlayEl = document.getElementById('kill-event-overlay');
const killVideoEl   = document.getElementById('kill-event-video');

killVideoEl.addEventListener('ended', function() {
  killOverlayEl.style.display = 'none';
  killEventPlaying = false;
  killEventCurrent = null;
  playNextKillEvent();
});

/* safety net: if video stalls or errors, don't get stuck */
killVideoEl.addEventListener('error', function() {
  killOverlayEl.style.display = 'none';
  killEventPlaying = false;
  killEventCurrent = null;
  playNextKillEvent();
});

function playNextKillEvent() {
  if (killEventPlaying || killEventQueue.length === 0) return;
  killEventPlaying = true;
  var entry = killEventQueue.shift();
  killEventCurrent = entry.video;
  killVideoEl.src = 'assets/motion/' + entry.video;
  killOverlayEl.style.display = 'block';
  killVideoEl.play().catch(function() {
    killOverlayEl.style.display = 'none';
    killEventPlaying = false;
    playNextKillEvent();
  });
}

/* receive kill event trigger from dashboard preview postMessage */
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'killevent') {
    enqueueKillEvent(e.data.video, e.data.priority || 1, null, null);
  }
});

function enqueueKillEvent(video, priority, playerIdx, playerName) {
  if (!featureEnabled.killevents) return;
  /* deduplicate: don't queue if same video is already playing or already queued */
  if (killEventCurrent === video) return;
  if (killEventQueue.some(function(e) { return e.video === video; })) return;
  killEventQueue.push({ video: video, priority: priority, playerIdx: playerIdx || null, playerName: playerName || null });
  playNextKillEvent();
}
