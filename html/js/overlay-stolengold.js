/* ── [FEATURE: stolen-gold] "Jungle Resource Stolen" banner ──────────
   A single top-of-screen banner (NOT per-player) showing how much
   jungle gold, purple buff, and orange buff each camp has stolen from
   the other side's jungle (camp_list[].jungle_stolen — see
   reference_mlbb_api.md memory). Manually shown/hidden from the
   dashboard Control tab (checkOverlays pattern, same shape as Item
   Check/Emblem Check/Gold Diff Check) — no auto-trigger, no game_time
   gating. sgApplyData is itself the registered poll handler (gated on
   sgShouldShow, same as overlay-itemcheck.js's icUpdate) so the
   numbers keep refreshing live for as long as the banner stays up. */

var sgOverlayEl = document.getElementById('stolengold-overlay');
var sgEls = {
  c1purple: document.getElementById('sg-c1-purple'),
  c1orange: document.getElementById('sg-c1-orange'),
  c1gold:   document.getElementById('sg-c1-gold'),
  c2purple: document.getElementById('sg-c2-purple'),
  c2orange: document.getElementById('sg-c2-orange'),
  c2gold:   document.getElementById('sg-c2-gold'),
};

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

var sgShouldShow = false;

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

function sgAnimateIn() {
  sgShouldShow = true;
  sgApplyData(lastData || {});
  sgOverlayEl.classList.add('sg-in');
}

function sgAnimateOut() {
  sgShouldShow = false;
  sgOverlayEl.classList.remove('sg-in');
}

window.sgAnimateIn  = sgAnimateIn;
window.sgAnimateOut = sgAnimateOut;
