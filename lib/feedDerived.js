// lib/feedDerived.js — data for the ingame "Side Gold Distri" and "Side KDA Distri" panels, built straight
// from the raw battle feed (state.lastGameData after lib/rawAdapter.js) instead of the two external APIs the
// old setup used (Gold vs Gold Sector / Get Selection). Both panels poll the same URLs as before
// (/api/golddistri-data, /api/kdadistri-data) so no client code changed.
//
//   Gold Distri  -> the two players of ONE lane (role), gold + gold_map sectors     (role chosen from the dashboard)
//   KDA Distri   -> one FEATURED player vs the 5 enemy lanes: kills / deaths / assists between them, counted
//                   from the kill_hero events (killer_id / killed_id / assister[] are the players' roleids)
//                                                                                  (player chosen from the dashboard)
// The old "Get Selection" API took the featured player from whatever the observer had selected in-game; the raw
// feed has no such field, so the featured player is chosen from the dashboard instead (default: blue EXP).
const state = require('./state');

const SHORT_TO_SEAT = { exp: 1, jungler: 2, mid: 3, roam: 4, roamer: 4, gold: 5 };
const SEAT_ROLE_LABEL = ['Exp Laner', 'Jungler', 'Mid Laner', 'Roamer', 'Gold Laner'];   // skdcRoleIconSrc uppercases these
const SEAT_ROLE_SHORT = ['exp', 'jungler', 'mid', 'roam', 'gold'];

const sel = { distriRole: 'exp', kda: { camp: 1, seat: 1 } };

function setDistriRole(role) {
  if (!SHORT_TO_SEAT[role]) throw new Error('unknown role');
  sel.distriRole = role === 'roamer' ? 'roam' : role;
  return sel.distriRole;
}
function setKdaSelection(camp, role) {
  camp = Number(camp);
  if ((camp !== 1 && camp !== 2) || !SHORT_TO_SEAT[role]) throw new Error('unknown camp/role');
  sel.kda = { camp, seat: SHORT_TO_SEAT[role] };
  return { camp, role: SEAT_ROLE_SHORT[sel.kda.seat - 1] };
}
function getSelection() {
  return { distriRole: sel.distriRole, kda: { camp: sel.kda.camp, role: SEAT_ROLE_SHORT[sel.kda.seat - 1] } };
}

const hasRawFeed = () => !!(state.lastGameData && state.lastGameData.data && Array.isArray(state.lastGameData.data.incre_event_list));
const campOf = (d, id) => (d.camp_list || []).find(c => c.campid === id);

function goldDistri() {
  const d = state.lastGameData.data, seat = SHORT_TO_SEAT[sel.distriRole];
  const pick = (id) => {
    const p = (campOf(d, id) || {})['seat_' + seat];
    return p ? { name: p.name, heroid: p.heroid, gold: p.gold, gold_map: p.gold_map || {} } : null;
  };
  return [{ role: sel.distriRole, camp1: pick(1), camp2: pick(2) }];
}

function kdaDistri() {
  const d = state.lastGameData.data, ev = (d.incre_event_list || []).filter(e => e.event_type === 'kill_hero');
  const me = (campOf(d, sel.kda.camp) || {})['seat_' + sel.kda.seat];
  if (!me) return { selected: null, distribution: [] };
  const enemyCamp = campOf(d, sel.kda.camp === 1 ? 2 : 1) || {};
  const distribution = [];
  for (let s = 1; s <= 5; s++) {
    const e = enemyCamp['seat_' + s];
    if (!e) continue;
    distribution.push({
      camp: e.campid, enemy_name: e.name, heroid: e.heroid, role: SEAT_ROLE_LABEL[s - 1],
      killed_by_selected:         ev.filter(x => x.killer_id === me.roleid && x.killed_id === e.roleid).length,
      selector_died:              ev.filter(x => x.killer_id === e.roleid && x.killed_id === me.roleid).length,
      killed_assists_by_selected: ev.filter(x => x.killed_id === e.roleid && (x.assister || []).includes(me.roleid)).length,
    });
  }
  const k = me.kill_num || 0, dd = me.dead_num || 0, a = me.assist_num || 0;
  return {
    selected: { camp: me.campid, name: me.name, heroid: me.heroid, role: SEAT_ROLE_LABEL[sel.kda.seat - 1],
                kda: (+((k + a) / Math.max(1, dd)).toFixed(2)).toString() },
    distribution,
  };
}

module.exports = { hasRawFeed, goldDistri, kdaDistri, setDistriRole, setKdaSelection, getSelection, SEAT_ROLE_SHORT };
