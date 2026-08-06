/* ── [FEATURE: sidegold-check] ─────────────────────────────────────
   Ranks all 10 players by total gold earned. See
   overlay-sidecheck-core.js for the shared panel/animation logic and
   the .sidecheck-* CSS block in mploverlay_v7.css for layout notes. */
const sgcPanel = createSideCheck({
  clipId:     'sidegold-check-clip',
  overlayId:  'sidegold-check-overlay',
  headerText: 'GOLD RANKING',
  statField:  'gold',
  formatStat: seat => sidecheckFormatK(seat && seat.gold),
});

function sgcAnimateIn()  { sgcPanel.animateIn(); }
function sgcAnimateOut() { sgcPanel.animateOut(); }
