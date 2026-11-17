// lib/rawAdapter.js — turns the RAW battle feed (M8 V2: camp_list[].player_list[] +
// data.incre_event_list) into the enriched shape every overlay/server module was
// written against (camp_list[].seat_1..seat_5 + derived fields).
//
// Applied at the two places the game feed enters the server: pollGameAPI()
// (lib/pollers.js) and /api/gamedata-proxy?fresh=1 (routes/devapi.js). Pages never
// see the raw shape. A payload that already has seat_N (old format) passes through
// untouched, and any failure returns the original payload — the adapter must never
// take the poller down.
//
// Seat order = lane order, same as the old API: seat_1 EXP, 2 JUNGLE, 3 MID,
// 4 ROAM, 5 GOLD. The raw feed has NO role field, so roles are inferred (see
// resolveRoles) — that part is deliberately isolated so the real pos/role tracking
// rules for this branch can replace it.
//
// Fields that cannot be rebuilt from the raw feed are left absent (or empty) rather
// than invented: hit_rate (null upstream -> []), rank_*, emblem_list / last_emblem.
const fs   = require('fs');
const path = require('path');

const ROLES = ['exp_laner', 'jungler', 'mid_laner', 'roamer', 'gold_laner'];
const SPELL_RETRIBUTION = 20020;

// ── static lookups ───────────────────────────────────────────────────────────
let _heroNames = null;
function heroName(id) {
  if (!_heroNames) {
    _heroNames = {};
    try {
      JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'heronames.json'), 'utf8'))
        .forEach(h => { _heroNames[h.id] = h.name; });
    } catch (e) { /* names stay empty */ }
  }
  return _heroNames[id] || '';
}

// Roam boot families (same id sets as overlay-conceal.js / led-events.js).
const ROAM_CATS = {
  Conceal:   ['1511','3511','3521','3531','3541','3551','3561','3571'],
  Encourage: ['1512','3512','3522','3532','3542','3552','3562','3572'],
  Favor:     ['1513','3513','3523','3533','3543','3553','3563','3573'],
  'Dire Hit':['1514','3514','3524','3534','3544','3554','3564','3574'],
};
function roamingType(equipIds) {
  for (const id of equipIds || []) {
    for (const [name, ids] of Object.entries(ROAM_CATS)) if (ids.includes(String(id))) return name;
  }
  return 'None';
}

// Cumulative EXP needed to REACH each level (index = level). Levels 13-15 are
// measured from the old API's own level_percent (13 -> 12612, 14 -> 14558,
// 15/max -> 16660); levels 2-12 are a smooth quadratic fit through those anchors,
// so level_percent / level_eta below level 13 are ESTIMATES.
const XP_AT = (() => {
  const S13 = 12612, S14 = 14558, S15 = 16660;
  const d13 = S14 - S13, d14 = S15 - S14;
  // d(L) = a + b*L + c*L^2 ; d(13)=d13, d(14)=d14, sum_{L=1..12} d(L) = S13
  const s1 = 78, s2 = 650; // sum L, sum L^2 for L=1..12
  // unknowns a,b,c: [1 13 169][a]   [d13]
  //                 [1 14 196][b] = [d14]
  //                 [12 s1 s2][c]   [S13]
  const M = [[1, 13, 169, d13], [1, 14, 196, d14], [12, s1, s2, S13]];
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; }
  }
  const [a, b, c] = [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  const t = [0, 0]; // t[1] = 0 (level 1), t[2] = d(1) ...
  for (let L = 1; L <= 12; L++) t[L + 1] = t[L] + Math.max(1, a + b * L + c * L * L);
  t[13] = S13; t[14] = S14; t[15] = S15;
  return t;
})();

// ── per-game memory (reset when the battleid changes) ────────────────────────
const mem = { battleid: null, roles: {}, reached: {}, unknownMarkers: new Set() };
function resetMem(battleid) { mem.battleid = battleid; mem.roles = {}; mem.reached = {}; }

// ── formatting helpers ───────────────────────────────────────────────────────
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const fmtMMSS = (s) => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const fmtK = (v) => (Math.round(v / 10) / 100 + 'k');                     // 10498 -> "10.5k", 9158 -> "9.16k"
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

// ── role resolution (REPLACE ME with the M8 V2 pos/role tracking rules) ──────
// Strong signals, locked per game the first time they appear:
//   jungler = Retribution spell (20020)           roamer = only player with gold_map[5] (roam equipment)
// Then the gold laner = most minion gold (gold_map[1]) among the rest (locked at 4:00).
// EXP vs MID cannot be told apart from one snapshot: provisional = lower pos -> EXP.
function resolveRoles(players, gameTime) {
  const roles = {};                                   // roleid -> role
  const locked = mem.roles;
  const free = players.filter(p => !locked[p.roleid]);
  const taken = new Set(Object.values(locked));
  players.forEach(p => { if (locked[p.roleid]) roles[p.roleid] = locked[p.roleid]; });

  const pick = (list, score) => list.reduce((best, p) => (score(p) > (best ? score(best) : -Infinity) ? p : best), null);
  const gm = (p, k) => num((p.gold_map || {})[k]);

  if (!taken.has('jungler')) {
    const j = pick(free.filter(p => p.skillid === SPELL_RETRIBUTION), p => gm(p, 2));
    if (j) { locked[j.roleid] = roles[j.roleid] = 'jungler'; taken.add('jungler'); }
  }
  if (!taken.has('roamer')) {
    const r = pick(players.filter(p => !roles[p.roleid] && gm(p, 5) > 0), p => gm(p, 5));
    if (r) { locked[r.roleid] = roles[r.roleid] = 'roamer'; taken.add('roamer'); }
  }
  if (!taken.has('gold_laner') && gameTime >= 120) {
    const rest = players.filter(p => !roles[p.roleid]);
    const g = rest.length ? pick(rest, p => gm(p, 1)) : null;
    if (g && gm(g, 1) > 0) {
      roles[g.roleid] = 'gold_laner';
      if (gameTime >= 240) { locked[g.roleid] = 'gold_laner'; taken.add('gold_laner'); }
    }
  }
  // Whatever is left fills the remaining lanes in pos order (EXP, MID, then any gap).
  const left = players.filter(p => !roles[p.roleid]).sort((a, b) => num(a.pos) - num(b.pos));
  const used = new Set(Object.values(roles));
  const order = ['exp_laner', 'mid_laner', 'jungler', 'roamer', 'gold_laner'].filter(r => !used.has(r));
  left.forEach((p, i) => { if (order[i]) roles[p.roleid] = order[i]; });
  return roles;
}

// ── events -> per-player counters ────────────────────────────────────────────
const MARKER_KEY = {
  first_blood: 'first_blood', double_kill: 'double_kill', triple_kill: 'triple_kill',
  quadra_kill: 'quadra_kill', penta_kill: 'penta_kill',
  lengendary: 'legendary', legendary: 'legendary',   // upstream spells it "lengendary"
};
function eventCounters(events) {
  const c = {};                                         // "camp:name" -> counters
  const get = (camp, name) => (c[camp + ':' + name] = c[camp + ':' + name] ||
    { first_blood: 0, double_kill: 0, triple_kill: 0, quadra_kill: 0, penta_kill: 0, legendary: 0, kill_lord: 0, kill_tortoise: 0, steal: 0 });
  for (const e of events || []) {
    if (e.event_type === 'kill_hero') {
      const t = get(e.killer_camp, e.killer_name);
      for (const m of e.extra_param || []) {
        if (MARKER_KEY[m]) t[MARKER_KEY[m]]++;
        else if (!mem.unknownMarkers.has(m)) { mem.unknownMarkers.add(m); console.log('[rawAdapter] unknown kill_hero marker:', m); }
      }
    } else if (e.event_type === 'kill_boss') {
      const t = get(e.killer_camp, e.killer_name);
      if (e.boss_name === 'tortoise') t.kill_tortoise++;
      else if (e.boss_name === 'lord') t.kill_lord++;
    }
  }
  return c;
}

// ── per-player enrichment ────────────────────────────────────────────────────
function buildSeat(p, role, camp, opp, d, counters) {
  const gameTime = num(d.game_time);
  const dead = !!p.dead;
  const gm = p.gold_map || {};
  const level = num(p.level) || 1;
  const exp = num(p.exp);

  // level progress
  const base = XP_AT[Math.min(level, 15)] || 0, next = XP_AT[level + 1];
  const maxed = level >= 15;
  const levelPct = maxed ? 100 : Math.max(0, Math.min(100, Math.round(((exp - base) / (next - base)) * 100)));
  // level_eta = when the player reaches MAX level (15): already there -> the game time it was
  // first seen at 15 (first poll that showed it); otherwise now + remaining exp at the average
  // exp rate so far (matches the old API's numbers).
  let eta;
  if (maxed) {
    const rk = p.roleid + ':15';
    if (mem.reached[rk] === undefined) mem.reached[rk] = gameTime;
    eta = fmtMMSS(mem.reached[rk]);
  } else {
    const rate = gameTime > 0 ? exp / gameTime : 0;     // exp per second so far
    eta = rate > 0 ? fmtMMSS(gameTime + (XP_AT[15] - exp) / rate) : '--:--';
  }

  const ep = counters || {};
  const seat = Object.assign({}, p, {
    role,
    hero_name: [heroName(p.heroid)],
    equip_list: (p.equip_list || []).map(id => ({ value: id, image_Square: '/assets/game/items/' + id + '.png', image_circle: '/assets/game/items/' + id + '.png' })),
    hit_rate: Array.isArray(p.hit_rate) ? p.hit_rate : [],
    level_percent: levelPct,
    exp_current_target: maxed ? 'MAX-LEVEL' : levelPct + '%',
    level_eta: eta,
    health_percent: pct(num(p.cur_health_point), num(p.max_health_point)),
    mana_percent:   pct(num(p.cur_mana), num(p.max_mana)),
    revive_left_time_show: dead ? num(p.revive_left_time) : '',
    ultimate_ready: String(num(p.major_left_time) === 0),
    kda_rate: (num(p.kill_num) + num(p.assist_num)) / Math.max(1, num(p.dead_num)),
    goldrate: (camp.total_money > 0 ? +((num(p.gold) / camp.total_money) * 100).toFixed(2) : 0) + '%',   // "27.1%", trailing zeros trimmed like the old API
    goldDiffPlayer: String(opp ? num(p.gold) - num(opp.gold) : 0),
    dmg_tkn_death: num(p.total_hurt) / Math.max(1, num(p.dead_num)),
    dmg_dealt_gold: num(p.gold) > 0 ? num(p.total_damage) / num(p.gold) : 0,
    roaming_type: roamingType(p.equip_list),
    rune_map_1: (p.rune_map || {})['1'], rune_map_2: (p.rune_map || {})['2'], rune_map_3: (p.rune_map || {})['3'],
    extra_param: {
      double_kill: ep.double_kill || 0, first_blood: ep.first_blood || 0,
      goldk: fmtK(num(p.gold)), gpm: gameTime > 0 ? Math.round((num(p.gold) * 60) / gameTime) : 0,
      herodead: p.heroid + '_' + (dead ? 'True' : 'False'),
      kda: num(p.kill_num) + '/' + num(p.dead_num) + '/' + num(p.assist_num),
      kill_lord: ep.kill_lord || 0, kill_tortoise: ep.kill_tortoise || 0,
      legendary: ep.legendary || 0, namedead: p.name + '_' + (dead ? 'True' : 'False'),
      penta_kill: ep.penta_kill || 0, quadra_kill: ep.quadra_kill || 0, steal: ep.steal || 0, triple_kill: ep.triple_kill || 0,
    },
  });
  for (let k = 1; k <= 9; k++) seat['gold_map_' + k] = num(gm[k]);
  seat.gold_map_passive = num(gm.passive);
  return seat;
}

// ── main entry ───────────────────────────────────────────────────────────────
function normalizeGameFeed(json) {
  try {
    const d = json && json.data;
    if (!d || !Array.isArray(d.camp_list)) return json;
    const raw = d.camp_list.some(c => Array.isArray(c.player_list) && !c.seat_1);
    if (!raw) return json;                                  // old enriched format

    const battleid = String(d.battleid || json.dataid || '');
    if (battleid !== mem.battleid) resetMem(battleid);
    const gameTime = num(d.game_time);
    const counters = eventCounters(d.incre_event_list);

    const camps = d.camp_list.map(c => {
      if (!Array.isArray(c.player_list) || c.judger || (c.campid !== 1 && c.campid !== 2)) return c;
      const players = c.player_list.filter(p => !p.judger).sort((a, b) => num(a.pos) - num(b.pos)).slice(0, 5);
      return { camp: c, players };
    });

    // roles per camp first (the gold-diff pairing needs both)
    const seatsByCamp = {};
    camps.forEach(x => {
      if (!x.camp) return;
      const roles = resolveRoles(x.players, gameTime);
      const bySeat = {};
      x.players.forEach(p => { const i = ROLES.indexOf(roles[p.roleid]); if (i >= 0) bySeat[i + 1] = p; });
      seatsByCamp[x.camp.campid] = bySeat;
    });

    const out = camps.map(x => {
      if (!x.camp) return x;
      const c = x.camp;
      const oppId = c.campid === 1 ? 2 : 1;
      const o = Object.assign({}, c);
      let dealt = 0, taken = 0, heal = 0, tower = 0;
      for (let s = 1; s <= 5; s++) {
        const p = seatsByCamp[c.campid][s];
        if (!p) continue;
        o['seat_' + s] = buildSeat(p, ROLES[s - 1], c, (seatsByCamp[oppId] || {})[s], d, counters[c.campid + ':' + p.name]);
        dealt += num(p.total_damage); taken += num(p.total_hurt); heal += num(p.total_heal); tower += num(p.total_damage_tower);
      }
      o.team_total_damage_dealt = dealt; o.team_total_damage_taken = taken;
      o.team_total_heal = heal; o.team_total_tower_damage = tower;
      o.total_money_k = fmtK(num(c.total_money));
      // Conceal trigger: roam-equipment gold (gold_map[5]) of the camp's roamer.
      o.blessing_gold = Math.max(0, ...c.player_list.map(p => num((p.gold_map || {})[5])));
      o.kill_lord_advantage = Array.isArray(c.kill_lord_advantage)
        ? (c.kill_lord_advantage[c.kill_lord_advantage.length - 1] || null) : (c.kill_lord_advantage || null);
      if (Array.isArray(c.enemy_area_get)) {
        const a = c.enemy_area_get;
        o.enemy_area_get = {
          end_time: a.reduce((m, w) => Math.max(m, num(w.end_time)), 0),
          monster_gold: a.reduce((s, w) => s + num(w.monster_gold), 0),
          orange_buffer_num: a.reduce((s, w) => s + num(w.orange_buffer_num), 0),
          purple_buffer_num: a.reduce((s, w) => s + num(w.purple_buffer_num), 0),
        };
        // Stolen Gold overlay reads camp.jungle_stolen: what this camp took from the ENEMY jungle = the
        // same running totals as enemy_area_get.
        o.jungle_stolen = { monster_gold: o.enemy_area_get.monster_gold, orange_buffer_num: o.enemy_area_get.orange_buffer_num, purple_buffer_num: o.enemy_area_get.purple_buffer_num };
      }
      return o;
    });

    return Object.assign({}, json, { data: Object.assign({}, d, { camp_list: out }) });
  } catch (e) {
    console.warn('[rawAdapter] normalize failed, passing raw payload through:', e.message);
    return json;
  }
}

module.exports = { normalizeGameFeed, ROLES, XP_AT, resolveRoles };
