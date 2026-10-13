/* ── led-autoside.js ── Match Board HOME/AWAY decides the LED wall side ──
   Match Board home is ALWAYS the left LED square, away ALWAYS the right —
   but only when both camps in the game feed match the Match Board's two teams
   (tricode or full name, case-insensitive). Otherwise resolve() returns null
   and the page keeps its manual HOME/SWAP state.
   LedAutoSide.resolve(camp_list) -> true (swapped: camp 2 on the left),
   false (camp 1 on the left) or null (can't tell). */
(function () {
  let ms = null, lastFetch = 0;
  function refresh() {
    const now = Date.now();
    if (now - lastFetch < 3000) return;
    lastFetch = now;
    fetch('/match/state', { cache: 'no-store' }).then(r => r.json()).then(s => { ms = s; }).catch(() => {});
  }
  const norm = v => String(v || '').trim().toUpperCase();
  function teamKeys(t) { return [norm(t && t.short), norm(t && t.name)].filter(Boolean); }
  function campMatches(camp, team) {
    const keys = teamKeys(team);
    return [norm(camp.team_simple_name), norm(camp.team_name)].some(k => k && keys.includes(k));
  }
  function resolve(campList) {
    refresh();
    if (!ms || !Array.isArray(campList)) return null;
    const home = ms.home || ms.teamA, away = ms.away || ms.teamB;
    if (!home || !away) return null;
    const c1 = campList.find(c => c.campid === 1), c2 = campList.find(c => c.campid === 2);
    if (!c1 || !c2) return null;
    if (campMatches(c1, home) && campMatches(c2, away) && !campMatches(c1, away) && !campMatches(c2, home)) return false;
    if (campMatches(c1, away) && campMatches(c2, home) && !campMatches(c1, home) && !campMatches(c2, away)) return true;
    return null;
  }
  window.LedAutoSide = { resolve };
})();
