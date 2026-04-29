const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");

// pick http or https based on URL prefix, follow one redirect automatically
function httpGet(url, cb) {
  const mod = url.startsWith("https://") ? https : http;
  return mod.get(url, (res) => {
    if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 308) && res.headers.location) {
      console.log(`[HTTP] Redirect ${res.statusCode} → ${res.headers.location}`);
      res.resume(); // drain the redirect body
      httpGet(res.headers.location, cb);
      return;
    }
    cb(res);
  });
}

const PORT         = 3000;
const POLL_MS      = 1000;
const POSTGAME_DIR   = path.join(__dirname, "postgames");
const POSITIONS_FILE = path.join(__dirname, "positions_live.json");
const FIGHTS_FILE    = path.join(__dirname, "fights_live.json");

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, "config.json");
if (!fs.existsSync(CONFIG_PATH)) {
  console.error("[CONFIG] config.json not found. Creating default...");
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    game_api: "http://10.88.120.72:5001/api/sub-info/",
    main_api: "http://10.88.120.72:5001/api/main/"
  }, null, 2));
}
let config   = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
let GAME_API = config.game_api;
let MAIN_API = config.main_api || config.h2h_api || "http://10.88.120.72:5001/api/main/";
console.log(`[CONFIG] game_api = ${GAME_API}`);
console.log(`[CONFIG] main_api = ${MAIN_API}`);

if (!fs.existsSync(POSTGAME_DIR)) fs.mkdirSync(POSTGAME_DIR);

// ── PLAYERS ───────────────────────────────────────────────────────────────────
const players = {
  player1:  { name: "Player 1",  team: "team1", slot: "player1",  role: "EXP"    },
  player2:  { name: "Player 2",  team: "team1", slot: "player2",  role: "JUNGLE" },
  player3:  { name: "Player 3",  team: "team1", slot: "player3",  role: "MID"    },
  player4:  { name: "Player 4",  team: "team1", slot: "player4",  role: "ROAM"   },
  player5:  { name: "Player 5",  team: "team1", slot: "player5",  role: "GOLD"   },
  player6:  { name: "Player 6",  team: "team2", slot: "player6",  role: "GOLD"   },
  player7:  { name: "Player 7",  team: "team2", slot: "player7",  role: "ROAM"   },
  player8:  { name: "Player 8",  team: "team2", slot: "player8",  role: "MID"    },
  player9:  { name: "Player 9",  team: "team2", slot: "player9",  role: "JUNGLE" },
  player10: { name: "Player 10", team: "team2", slot: "player10", role: "EXP"    },
};

// ── ROLE DISPLAY NAMES ───────────────────────────────────────────────────────
const ROLE_DISPLAY = {
  "EXP":    "EXP LANER",
  "JUNGLE": "JUNGLER",
  "MID":    "MID LANER",
  "ROAM":   "ROAMER",
  "GOLD":   "GOLD LANER",
};

// ── CAMP ORDER ────────────────────────────────────────────────────────────────
const CAMP_MAP = {
  camp1: [
    { pid: "player1",  watch: 1  },
    { pid: "player2",  watch: 2  },
    { pid: "player3",  watch: 3  },
    { pid: "player4",  watch: 4  },
    { pid: "player5",  watch: 5  },
  ],
  camp2: [
    { pid: "player10", watch: 10 },
    { pid: "player9",  watch: 9  },
    { pid: "player8",  watch: 8  },
    { pid: "player7",  watch: 7  },
    { pid: "player6",  watch: 6  },
  ],
};

// ── ACTIVE CAMP MAP (may be swapped per game) ────────────────────────────────
// camp1Pids = watches 1-5, camp2Pids = watches 10-6 (default, no swap)
let campSwapped = false;
let activeCampMap = {
  camp1: [...CAMP_MAP.camp1],
  camp2: [...CAMP_MAP.camp2],
};
let campTricodes = { camp1: null, camp2: null };  // set from H2H + game API

function applySwap(swapped) {
  if (swapped === campSwapped) return;
  campSwapped = swapped;
  if (swapped) {
    activeCampMap = { camp1: [...CAMP_MAP.camp2], camp2: [...CAMP_MAP.camp1] };
    console.log("[CAMP] Sides swapped — watch10-6 = camp1, watch1-5 = camp2");
  } else {
    activeCampMap = { camp1: [...CAMP_MAP.camp1], camp2: [...CAMP_MAP.camp2] };
    console.log("[CAMP] Sides normal — watch1-5 = camp1, watch10-6 = camp2");
  }
}

// ── LIVE READINGS (always on) ─────────────────────────────────────────────────
const readings = {};
for (const [pid, info] of Object.entries(players)) {
  readings[pid] = { ...info, bpm: null, last_bpm: null, simulated_bpm: null, status: "disconnected", last_seen: null };
}

const log = [];
const MAX_LOG = 1000;

// ── GAME STATE ────────────────────────────────────────────────────────────────
let gameState = {
  state:         "unknown",
  battleid:      null,
  game_time_s:   0,
  game_time_fmt: "00:00",
  paused:        false,
};

// ── PLAYER NAMES (from game API, keyed by pos 1-10) ──────────────────────────
// pos matches the physical watch number (pos 1 = watch1, pos 6 = watch6, etc.)
let playerNames = {};         // live, updated every poll
let postgamePlayerNames = {}; // snapshot saved at game end
let bpmOnEnd = {};            // { pid: bpm } snapshot at exact moment state → "end"

// ── STATS (reset per game, accumulate only while playing + not paused) ─────────
function freshPlayerStats() {
  const s = {};
  for (const pid of Object.keys(players)) {
    s[pid] = {
      bpm_samples:           [],  // all valid bpm values recorded while playing
      ticks_above_120:       0,   // 1-second ticks where bpm > 120
      ticks_total:           0,   // 1-second ticks with a valid bpm signal
      objective_bpm_samples: [],  // bpm values snapshotted at lord/turtle kills
    };
  }
  return s;
}
let stats = freshPlayerStats();

// ── OBJECTIVE TRACKING ────────────────────────────────────────────────────────
let prevKillLord   = 0;
let prevKillTurtle = 0;

// ── CLASH TRACKING ────────────────────────────────────────────────────────────
// A clash = a single game tick where total kills across both camps increments by 3+
// We store per-camp avg BPM snapshots for each clash event
let clashSnapshots = [];   // [{ game_time, camp1_avg, camp2_avg, kill_jump }]
let prevTotalKills = 0;

// ── OVERLAY SSE CLIENTS ───────────────────────────────────────────────────────
const overlayClients = [];
setInterval(() => {
  overlayClients.forEach(c => { try { c.write(': heartbeat\n\n'); } catch {} });
}, 15000);

// ── GAME EVENTS (per-player K/D/A + objectives with camp attribution) ─────────
let gameEvents   = [];   // [{ time_s, time_fmt, type, slot?, camp? }]
const MAX_EVENTS = 500;

// ── POSITION LOG (all players, every poll while playing) ──────────────────────
let positionLog = [];    // [{ game_time_s, camp, seat, x, y }]
const MAX_POS_LOG = 50000; // ~30min × 10 players × 1s = 18k; headroom for long games
let posWriteCounter = 0;   // periodic disk flush counter
let prevSeatKDA  = {};   // `${campKey}-${seatNum}` → { kills, assists, deaths }
let prevC1Lord   = 0, prevC2Lord   = 0;
let prevC1Turtle = 0, prevC2Turtle = 0;

// ── FIGHT TRACKING ───────────────────────────────────────────────────────────
let activeFight    = null;   // fight currently in progress
let fightLog       = [];     // completed fights this game
let fightIdSeq     = 0;      // monotonic, survives game resets (unique per server run)
let lastPlayerSnap = {};     // `${campid}-${seat}` → { campid, seat, name, hero, stats }
const MAX_FIGHTS   = 100;
const FIGHT_GAP_S  = 3;      // seconds of no damage activity before fight is closed

// ── RTF → JSON PARSER (for /fights-static) ───────────────────────────────────
function parseRtfToJson(rtfPath) {
  let s = fs.readFileSync(rtfPath, 'utf8');
  // unicode: \uc0\uNNNN or \uNNNN
  s = s.replace(/\\uc0\s*/g, '');
  s = s.replace(/\\u(-?\d+)\s?/g, (_, n) => {
    const cp = parseInt(n);
    return String.fromCodePoint(cp < 0 ? cp + 65536 : cp);
  });
  // protect escaped braces (JSON braces that RTF escaped)
  s = s.replace(/\\\{/g, '\x01');
  s = s.replace(/\\\}/g, '\x02');
  // remove RTF groups (unescaped { ... }) iteratively innermost-first
  let prev;
  do { prev = s; s = s.replace(/\{[^{}]*\}/g, ''); } while (s !== prev);
  // remove RTF control words and line continuations
  s = s.replace(/\\[a-zA-Z]+\*?(-?\d+)?\s?/g, '');
  s = s.replace(/\\\n/g, '').replace(/\\/g, '');
  // restore JSON braces
  s = s.replace(/\x01/g, '{').replace(/\x02/g, '}');
  // extract JSON object
  s = s.trim();
  return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
}

// ── POSTGAME META ─────────────────────────────────────────────────────────────
let currentBattleId = null;
let gameStartTime   = null;

// ── RESET FOR NEW GAME ────────────────────────────────────────────────────────
function resetForNewGame(battleid) {
  stats            = freshPlayerStats();
  prevKillLord     = 0;
  prevKillTurtle   = 0;
  clashSnapshots   = [];
  prevTotalKills   = 0;
  gameEvents       = [];
  // positionLog intentionally NOT cleared here — kept until state leaves "end" with a new battleid
  activeFight      = null;
  fightLog         = [];
  saveFightsToDisk();
  lastPlayerSnap   = {};
  prevSeatKDA      = {};
  prevC1Lord       = 0; prevC2Lord   = 0;
  prevC1Turtle     = 0; prevC2Turtle = 0;
  currentBattleId  = battleid;
  gameStartTime    = new Date().toISOString();
  console.log(`[GAME] New game detected — battleid=${battleid}`);
}

// ── FIGHT PERSISTENCE ────────────────────────────────────────────────────────
function saveFightsToDisk() {
  try {
    fs.writeFileSync(FIGHTS_FILE, JSON.stringify({ battleid: currentBattleId, fights: fightLog }));
  } catch (e) {
    console.warn("[FIGHTS] Could not save to disk:", e.message);
  }
}

// ── POSITION PERSISTENCE ─────────────────────────────────────────────────────
function savePositionsToDisk() {
  try {
    fs.writeFileSync(POSITIONS_FILE, JSON.stringify({ battleid: currentBattleId, positions: positionLog }));
  } catch (e) {
    console.warn("[POSITIONS] Could not save to disk:", e.message);
  }
}

// ── FIGHT DETECTION & RECAP ──────────────────────────────────────────────────
function extractSeatStats(seat) {
  const ep = seat.extra_param || {};
  // filter hit_rate to real skills only (skillid "0" = unknown/passive)
  const hr = (seat.hit_rate || []).filter(sk => sk.skillid && sk.skillid !== "0" && sk.skill_name !== "Unknown");
  return {
    dmg_out:     seat.total_damage     ?? 0,  // hero damage dealt  ← confirmed field name
    dmg_in:      seat.total_hurt       ?? 0,  // damage received    ← confirmed field name
    gold:        seat.gold             ?? 0,
    kills:       seat.kill_num         ?? 0,
    deaths:      seat.dead_num         ?? 0,
    assists:     seat.assist_num       ?? 0,
    heal_self:   seat.total_heal       ?? 0,
    heal_other:  seat.total_heal_other ?? 0,
    control_ms:  seat.control_time_ms  ?? 0,  // CC time in ms
    skills:      hr.reduce((s, sk) => s + (sk.cast_times || 0), 0),
    hit_rate:    hr,
    multi_kills: {
      double: ep.double_kill || 0,
      triple: ep.triple_kill || 0,
      quadra: ep.quadra_kill || 0,
      penta:  ep.penta_kill  || 0,
    },
  };
}

function computeSkillsDelta(finalHR, baseHR) {
  const result = [];
  for (const fsk of (finalHR || [])) {
    const bsk   = (baseHR || []).find(s => s.skillid === fsk.skillid) || { cast_times: 0, hit_times: 0 };
    const casts = Math.max(0, (fsk.cast_times || 0) - (bsk.cast_times || 0));
    const hits  = Math.max(0, (fsk.hit_times  || 0) - (bsk.hit_times  || 0));
    result.push({
      skill_name: fsk.skill_name,
      casts,
      hits,
      hit_pct: casts > 0 ? Math.round((hits / casts) * 100) : 0,
    });
  }
  return result;
}

function tickFight(camps, game_time_s, game_time_fmt) {
  const now = {};
  for (const camp of camps) {
    if (camp.campid !== 1 && camp.campid !== 2) continue;
    for (let s = 1; s <= 5; s++) {
      const seat = camp[`seat_${s}`];
      if (!seat) continue;
      const key = `${camp.campid}-${s}`;
      const heroArr = Array.isArray(seat.hero_name) ? seat.hero_name : null;
      now[key] = {
        campid:  camp.campid,
        seat:    s,
        name:    seat.name || null,
        hero:    heroArr ? (heroArr[0] || null) : (seat.hero_name || null),
        hero_id: seat.hero_id ?? seat.heroid ?? (heroArr ? (heroArr[1] || null) : null) ?? null,
        stats:   extractSeatStats(seat),
      };
    }
  }

  // activity = any player's hero damage dealt went up since last snapshot
  let anyActivity = false;
  for (const [key, p] of Object.entries(now)) {
    const prev = lastPlayerSnap[key];
    if (prev && p.stats.dmg_out > prev.stats.dmg_out) { anyActivity = true; break; }
  }

  if (anyActivity) {
    if (!activeFight) {
      activeFight = {
        id:             ++fightIdSeq,
        start_time_s:   game_time_s,
        start_time_fmt: game_time_fmt,
        last_active_s:  game_time_s,
        baseline:       JSON.parse(JSON.stringify(lastPlayerSnap)),
      };
      console.log(`[FIGHT] Started — id=${activeFight.id} at ${game_time_fmt}`);
    } else {
      activeFight.last_active_s = game_time_s;
    }
  }

  // close fight after FIGHT_GAP_S seconds of no damage activity
  if (activeFight && (game_time_s - activeFight.last_active_s) >= FIGHT_GAP_S) {
    closeFight(activeFight, now);
    activeFight = null;
  }

  lastPlayerSnap = now;
}

function closeFight(fight, finalSnap) {
  const end_time_s   = fight.last_active_s;
  const em           = String(Math.floor(end_time_s / 60)).padStart(2, "0");
  const es           = String(end_time_s % 60).padStart(2, "0");
  const end_time_fmt = `${em}:${es}`;
  const duration_s   = Math.max(1, end_time_s - fight.start_time_s);

  if (duration_s < 5) {
    console.log(`[FIGHT] Discarded — id=${fight.id} dur=${duration_s}s (skirmish)`);
    return;
  }

  const players = [];
  for (const [key, p] of Object.entries(finalSnap)) {
    const base = fight.baseline[key];
    if (!base) continue;
    const b = base.stats;
    const mk_f = p.stats.multi_kills || {};
    const mk_b = b.multi_kills || {};
    players.push({
      camp:        p.campid,
      seat:        p.seat,
      name:        p.name,
      hero:        p.hero,
      hero_id:     p.hero_id ?? null,
      dmg_dealt:   Math.max(0, p.stats.dmg_out    - (b.dmg_out    || 0)),
      dmg_rcvd:    Math.max(0, p.stats.dmg_in     - (b.dmg_in     || 0)),
      gold_earned: Math.max(0, p.stats.gold       - (b.gold       || 0)),
      kills:       Math.max(0, p.stats.kills      - (b.kills      || 0)),
      deaths:      Math.max(0, p.stats.deaths     - (b.deaths     || 0)),
      assists:     Math.max(0, p.stats.assists    - (b.assists    || 0)),
      skills_used: Math.max(0, p.stats.skills     - (b.skills     || 0)),
      heal_self:   Math.max(0, p.stats.heal_self  - (b.heal_self  || 0)),
      heal_other:  Math.max(0, p.stats.heal_other - (b.heal_other || 0)),
      control_ms:  Math.max(0, p.stats.control_ms - (b.control_ms || 0)),
      multi_kills: {
        double: Math.max(0, (mk_f.double || 0) - (mk_b.double || 0)),
        triple: Math.max(0, (mk_f.triple || 0) - (mk_b.triple || 0)),
        quadra: Math.max(0, (mk_f.quadra || 0) - (mk_b.quadra || 0)),
        penta:  Math.max(0, (mk_f.penta  || 0) - (mk_b.penta  || 0)),
      },
      skills_detail: computeSkillsDelta(p.stats.hit_rate, b.hit_rate),
    });
  }
  players.sort((a, b) => a.camp - b.camp || a.seat - b.seat);

  // team roll-ups
  const c1p     = players.filter(p => p.camp === 1);
  const c2p     = players.filter(p => p.camp === 2);
  const sum     = (arr, f) => arr.reduce((t, p) => t + p[f], 0);
  const c1_kills  = sum(c1p, 'kills'),     c2_kills   = sum(c2p, 'kills');
  const c1_deaths = sum(c1p, 'deaths'),    c2_deaths  = sum(c2p, 'deaths');
  const c1_dmg    = sum(c1p, 'dmg_dealt'), c2_dmg     = sum(c2p, 'dmg_dealt');
  const c1_rcvd   = sum(c1p, 'dmg_rcvd'), c2_rcvd    = sum(c2p, 'dmg_rcvd');
  const c1_cc_s   = Math.round(sum(c1p, 'control_ms') / 1000);
  const c2_cc_s   = Math.round(sum(c2p, 'control_ms') / 1000);
  const total_kills = c1_kills + c2_kills;

  // enrich each player with derived per-fight stats
  for (const p of players) {
    const teamDmg   = p.camp === 1 ? c1_dmg   : c2_dmg;
    const teamKills = p.camp === 1 ? c1_kills  : c2_kills;
    p.dmg_share          = teamDmg   > 0 ? Math.round((p.dmg_dealt / teamDmg)   * 100) : 0;
    p.kill_participation = teamKills > 0 ? Math.round(((p.kills + p.assists) / teamKills) * 100) : 0;
    p.dps                = Math.round(p.dmg_dealt / duration_s);
    p.control_s          = +(p.control_ms / 1000).toFixed(1);
    p.survived           = p.deaths === 0;
  }

  const winning_camp = c1_kills  > c2_kills  ? 1 : c2_kills  > c1_kills  ? 2 : null;
  const mvp          = players.reduce((a, p) => (!a || p.dmg_dealt  > a.dmg_dealt)  ? p : a, null);
  const top_absorber = players.reduce((a, p) => (!a || p.dmg_rcvd   > a.dmg_rcvd)   ? p : a, null);
  const most_kills   = players.reduce((a, p) => (!a || p.kills      > a.kills)      ? p : a, null);
  const top_healer   = players.reduce((a, p) => (!a || (p.heal_self + p.heal_other) > (a.heal_self + a.heal_other)) ? p : a, null);

  const recap = {
    id:             fight.id,
    start_time_s:   fight.start_time_s,
    start_time_fmt: fight.start_time_fmt,
    end_time_s,
    end_time_fmt,
    duration_s,
    summary: {
      total_kills,
      camp1_kills:     c1_kills,
      camp2_kills:     c2_kills,
      camp1_deaths:    c1_deaths,
      camp2_deaths:    c2_deaths,
      camp1_dmg:       c1_dmg,
      camp2_dmg:       c2_dmg,
      camp1_dmg_rcvd:  c1_rcvd,
      camp2_dmg_rcvd:  c2_rcvd,
      camp1_cc_s:      c1_cc_s,
      camp2_cc_s:      c2_cc_s,
      dominant_camp:   c1_dmg   > c2_dmg   ? 1 : c2_dmg   > c1_dmg   ? 2 : null,
      winning_camp,
      damage_ratio:    c2_dmg   > 0        ? +(c1_dmg / c2_dmg).toFixed(2) : null,
      mvp: mvp && mvp.dmg_dealt > 0
        ? { name: mvp.name, hero: mvp.hero, camp: mvp.camp, dmg_dealt: mvp.dmg_dealt, dps: mvp.dps }
        : null,
      top_damage_absorber: top_absorber && top_absorber.dmg_rcvd > 0
        ? { name: top_absorber.name, hero: top_absorber.hero, camp: top_absorber.camp, dmg_rcvd: top_absorber.dmg_rcvd }
        : null,
      top_killer: most_kills && most_kills.kills > 0
        ? { name: most_kills.name, hero: most_kills.hero, camp: most_kills.camp, kills: most_kills.kills }
        : null,
      top_healer: top_healer && (top_healer.heal_self + top_healer.heal_other) > 0
        ? { name: top_healer.name, hero: top_healer.hero, camp: top_healer.camp, heal_self: top_healer.heal_self, heal_other: top_healer.heal_other }
        : null,
    },
    players,
  };

  fightLog.push(recap);
  if (fightLog.length > MAX_FIGHTS) fightLog.splice(0, fightLog.length - MAX_FIGHTS);
  saveFightsToDisk();
  console.log(`[FIGHT] Closed — id=${fight.id} dur=${duration_s}s kills=${total_kills} winner=${winning_camp ? 'camp' + winning_camp : 'draw'}`);
}

// ── COMPUTE DERIVED STATS FOR ONE PLAYER ─────────────────────────────────────
function deriveStats(pid) {
  const s   = stats[pid];
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  const avg_bpm      = avg(s.bpm_samples);
  const peak_bpm     = s.bpm_samples.length ? Math.max(...s.bpm_samples) : null;
  const pct_above_120 = s.ticks_total > 0
    ? Math.round((s.ticks_above_120 / s.ticks_total) * 100) + "%"
    : null;
  const avg_bpm_at_objectives  = avg(s.objective_bpm_samples);
  const peak_bpm_at_objectives = s.objective_bpm_samples.length
    ? Math.max(...s.objective_bpm_samples)
    : null;

  return { avg_bpm, peak_bpm, pct_above_120, avg_bpm_at_objectives, peak_bpm_at_objectives };
}

// ── TICK STATS (called every poll while playing + not paused) ─────────────────
function tickStats() {
  for (const pid of Object.keys(players)) {
    const r = readings[pid];
    if (r.bpm === null || r.status !== "ok") continue;
    stats[pid].bpm_samples.push(r.bpm);
    stats[pid].ticks_total++;
    if (r.bpm > 120) stats[pid].ticks_above_120++;
  }
}

// ── TICK SIMULATION (disconnected players dance around avg_bpm) ──────────────
function tickSimulation() {
  for (const pid of Object.keys(players)) {
    const r = readings[pid];
    if (r.status === "ok") {
      // connected — clear any simulated value
      r.simulated_bpm = null;
      continue;
    }
    // get avg from stats; fall back to last_bpm if no stats yet
    const d   = deriveStats(pid);
    const base = d.avg_bpm || r.last_bpm;
    if (base === null) {
      r.simulated_bpm = null;
      continue;
    }
    // dance ±5 around base, nudge from previous simulated value for smoothness
    const prev  = r.simulated_bpm !== null ? r.simulated_bpm : base;
    const nudge = (Math.random() * 6 - 3);          // -3 to +3 per tick
    const drift = (base - prev) * 0.3;              // pull back toward base
    const next  = Math.round(prev + nudge + drift);
    r.simulated_bpm = Math.max(base - 8, Math.min(base + 8, next));
  }
}

// ── SNAPSHOT BPM AT OBJECTIVE ─────────────────────────────────────────────────
function snapshotObjective(type, game_time_fmt) {
  console.log(`[OBJECTIVE] ${type} kill at ${game_time_fmt}`);
  for (const pid of Object.keys(players)) {
    const r = readings[pid];
    if (r.bpm !== null && r.status === "ok") {
      stats[pid].objective_bpm_samples.push(r.bpm);
    }
  }
}

// ── SNAPSHOT CLASH ───────────────────────────────────────────────────────────
function snapshotClash(game_time_fmt, kill_jump) {
  const avg = (pids) => {
    const vals = pids
      .map(({ pid }) => readings[pid])
      .filter(r => r.bpm !== null && r.status === "ok")
      .map(r => r.bpm);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };

  clashSnapshots.push({
    game_time:  game_time_fmt,
    kill_jump,
    camp1_avg_bpm: avg(activeCampMap.camp1),
    camp2_avg_bpm: avg(activeCampMap.camp2),
  });
}

// ── BUILD CLASH SUMMARY ───────────────────────────────────────────────────────
function buildClashSummary() {
  const avg = (arr) => arr.length
    ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
    : null;

  const c1vals = clashSnapshots.map(s => s.camp1_avg_bpm).filter(v => v !== null);
  const c2vals = clashSnapshots.map(s => s.camp2_avg_bpm).filter(v => v !== null);

  return {
    clash_count:              clashSnapshots.length > 0 ? clashSnapshots.length : null,
    camp1_avg_bpm_in_clashes: avg(c1vals),
    camp2_avg_bpm_in_clashes: avg(c2vals),
    clashes:                  clashSnapshots,
  };
}

// ── HIGHLIGHTS BUILDER ───────────────────────────────────────────────────────
function buildHighlights(nameSource) {
  let candidates = [];
  for (const [campKey, entries] of Object.entries(activeCampMap)) {
    entries.forEach(({ pid, watch }, i) => {
      const d = deriveStats(pid);
      candidates.push({
        camp:                  campKey,
        player:                `player${i + 1}`,
        player_name:           nameSource[watch] || null,
        slot:                  `slot${watch}`,
        name:                  `watch${watch}`,
        role:                  ROLE_DISPLAY[players[pid].role] || players[pid].role,
        avg_bpm:                  d.avg_bpm,
        peak_bpm:                 d.peak_bpm,
        pct_above_120:            d.pct_above_120,
        avg_bpm_at_objectives:    d.avg_bpm_at_objectives,
        peak_bpm_at_objectives:   d.peak_bpm_at_objectives,
      });
    });
  }

  const withAvg  = candidates.filter(c => c.avg_bpm !== null);
  const withPeak = candidates.filter(c => c.peak_bpm !== null);
  const withObj  = candidates.filter(c => c.avg_bpm_at_objectives !== null);
  const withPeakObj = candidates.filter(c => c.peak_bpm_at_objectives !== null);

  const pick = (arr, fn) => arr.length ? arr.reduce(fn) : null;

  const lowest_avg_bpm              = pick(withAvg,     (a, b) => a.avg_bpm < b.avg_bpm ? a : b);
  const highest_avg_bpm             = pick(withAvg,     (a, b) => a.avg_bpm > b.avg_bpm ? a : b);
  const highest_peak_bpm            = pick(withPeak,    (a, b) => a.peak_bpm > b.peak_bpm ? a : b);
  const lowest_avg_at_objectives    = pick(withObj,     (a, b) => a.avg_bpm_at_objectives < b.avg_bpm_at_objectives ? a : b);
  const highest_peak_at_objectives  = pick(withPeakObj, (a, b) => a.peak_bpm_at_objectives > b.peak_bpm_at_objectives ? a : b);

  return { lowest_avg_bpm, highest_avg_bpm, highest_peak_bpm, lowest_avg_at_objectives, highest_peak_at_objectives };
}

// ── WRITE POSTGAME FILE ───────────────────────────────────────────────────────
function buildPostgamePayload(data) {
  const campResult = {};
  for (const [campKey, entries] of Object.entries(activeCampMap)) {
    campResult[campKey] = entries.map(({ pid, watch }, i) => {
      const d = deriveStats(pid);
      return {
        [`player${i + 1}`]: {
          slot:                    `slot${watch}`,
          name:                    `watch${watch}`,
          player_name:             postgamePlayerNames[watch] || playerNames[watch] || null,
          role:                    ROLE_DISPLAY[players[pid].role] || players[pid].role,
          avg_bpm:                 d.avg_bpm,
          peak_bpm:                d.peak_bpm,
          pct_above_120:           d.pct_above_120,
          avg_bpm_at_objectives:   d.avg_bpm_at_objectives,
          peak_bpm_at_objectives:  d.peak_bpm_at_objectives,
          bpm_on_end:              bpmOnEnd[pid] || null,
        },
      };
    });
  }

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  return {
    battleid:        currentBattleId,
    date:            dateStr,
    game_start_time: gameStartTime,
    game_end_time:   now.toISOString(),
    game_duration:   gameState.game_time_fmt || null,
    camp1_tricode:   campTricodes.camp1,
    camp2_tricode:   campTricodes.camp2,
    camp1: {
      tricode: campTricodes.camp1,
      players: campResult.camp1,
    },
    camp2: {
      tricode: campTricodes.camp2,
      players: campResult.camp2,
    },
    highlights:      buildHighlights(postgamePlayerNames),
    clashes:         buildClashSummary(),
  };
}

function buildHomeAwayPayload(payload) {
  // Build archive version using home/away from main API (never swapped)
  const mainData = buildLeagueStats._h2hCache;
  if (!mainData) return payload; // fallback to camp structure if no main data

  const ROLES = ['EXP LANER', 'JUNGLER', 'MID LANER', 'ROAMER', 'GOLD LANER'];

  const buildTeam = (teamData, campObj) => {
    const tricode   = (teamData.CAMP_CODE || "").toUpperCase().trim();
    const campCode  = teamData.CAMP_CODE || null;
    const campName  = teamData.CAMP_NAME || null;
    const players   = [];

    // match seat_1..5 from main API to watch stats from campObj
    for (let s = 1; s <= 5; s++) {
      const playerName = teamData[`seat_${s}`] || null;
      const role       = teamData[`LINEUP_ROLE_${s}`] || ROLES[s - 1];

      // find this player in campObj.players by player_name
      let stats = null;
      if (campObj && campObj.players) {
        for (const pObj of campObj.players) {
          const p = Object.values(pObj)[0];
          if (p && p.player_name === playerName) { stats = p; break; }
        }
      }

      players.push({
        [`player${s}`]: {
          player_name:             playerName,
          role,
          avg_bpm:                 stats ? stats.avg_bpm               : null,
          peak_bpm:                stats ? stats.peak_bpm              : null,
          pct_above_120:           stats ? stats.pct_above_120         : null,
          avg_bpm_at_objectives:   stats ? stats.avg_bpm_at_objectives : null,
          peak_bpm_at_objectives:  stats ? stats.peak_bpm_at_objectives: null,
          bpm_on_end:              stats ? stats.bpm_on_end            : null,
        }
      });
    }
    return { tricode, camp_code: campCode, camp_name: campName, players };
  };

  // determine which camp in payload corresponds to home (team1) and away (team2)
  const t1code = (mainData.team1 && mainData.team1.CAMP_CODE || "").toUpperCase().trim();
  const camp1Tricode = (payload.camp1 && payload.camp1.tricode || "").toUpperCase().trim();
  const homeIscamp1  = camp1Tricode === t1code;

  const homeCamp = homeIscamp1 ? payload.camp1 : payload.camp2;
  const awayCamp = homeIscamp1 ? payload.camp2 : payload.camp1;

  return {
    battleid:        payload.battleid,
    date:            payload.date,
    game_start_time: payload.game_start_time,
    game_end_time:   payload.game_end_time,
    game_duration:   payload.game_duration,
    home: buildTeam(mainData.team1, homeCamp),
    away: buildTeam(mainData.team2, awayCamp),
    highlights:      payload.highlights,
    clashes:         payload.clashes,
  };
}

function writePostgame(payload) {
  const liveJson    = JSON.stringify(payload, null, 2);
  const archivePayload = buildHomeAwayPayload(payload);
  const archiveJson = JSON.stringify(archivePayload, null, 2);
  const date = payload.date || "unknown";
  const base = `postgame_${currentBattleId}_${date}`;

  // find a non-conflicting filename
  let filename = `${base}.json`;
  let counter  = 2;
  while (fs.existsSync(path.join(POSTGAME_DIR, filename))) {
    filename = `${base}_${counter}.json`;
    counter++;
  }

  // latest pointer stays as camp1/camp2 (for /feed/order compatibility)
  fs.writeFileSync(path.join(__dirname, "postgame.json"), liveJson);

  // archive is always home/away (clean for league stats)
  fs.writeFileSync(path.join(POSTGAME_DIR, filename), archiveJson);

  console.log(`[POSTGAME] Written — ${filename}`);
}

// ── MAIN API POLLER (camp swap + lineup) ─────────────────────────────────────
function pollH2H(force = false) {
  // don't re-evaluate sides while a game is live — they're locked
  // unless forced (e.g. on server startup)
  if (!force && gameState.state === "play") return;

  httpGet(MAIN_API, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      if (res.statusCode !== 200) {
        console.warn(`[MAIN] HTTP ${res.statusCode} from ${MAIN_API} — body: ${body.slice(0, 200)}`);
        return;
      }
      try {
        const json       = JSON.parse(body);
        const mainTricode = (json.team1 && (json.team1.CAMP_CODE || "")).toUpperCase().trim();
        if (!mainTricode) return;

        // get camp1 tricode from game API state (team_simple_name)
        const gameCamp1 = gameState.campNames && gameState.campNames.camp1
          ? gameState.campNames.camp1.toUpperCase().trim()
          : null;

        if (!gameCamp1) return;

        // if game's camp1 tricode does NOT match main team1 CAMP_CODE, sides are swapped
        const needsSwap   = gameCamp1 !== mainTricode;
        const mainTricode2 = (json.team2 && (json.team2.CAMP_CODE || "")).toUpperCase().trim();
        if (needsSwap) {
          campTricodes = { camp1: mainTricode2 || gameCamp1, camp2: mainTricode };
        } else {
          campTricodes = { camp1: mainTricode, camp2: mainTricode2 || gameState.campNames?.camp2?.toUpperCase().trim() || null };
        }
        applySwap(needsSwap);
        // cache full main API data for league stats current matchup + postgame archive
        buildLeagueStats._h2hCache = json;
        console.log(`[MAIN] team1_code="${mainTricode}" game_camp1="${gameCamp1}" swapped=${needsSwap}`);
      } catch (e) {
        console.warn("[MAIN] Parse error:", e.message);
      }
    });
  }).on("error", (e) => {
    console.warn("[MAIN] API unreachable:", e.message);
  });
}

// ── GAME API POLLER ───────────────────────────────────────────────────────────
let lastWrittenBattleId = null;
let hasSeenPlay         = false;  // must see "play" before writing any postgame this session

function pollGameAPI() {
  httpGet(GAME_API, (res) => {
    let body = "";
    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      if (res.statusCode !== 200) {
        console.warn(`[POLL] HTTP ${res.statusCode} from ${GAME_API} — body: ${body.slice(0, 200)}`);
        return;
      }
      try {
        const json = JSON.parse(body);
        const data = json.data;
        if (!data) { console.warn("[POLL] No data field in response"); return; }

        const state      = data.state;
        const battleid   = String(data.battleid || json.dataid || "");
        const game_time_s   = data.game_time || 0;
        const _mm = String(Math.floor(game_time_s / 60)).padStart(2, "0");
        const _ss = String(game_time_s % 60).padStart(2, "0");
        const game_time_fmt = `${_mm}:${_ss}`;
        const paused     = data.paused || data.banpick_paused || false;

        console.log(`[POLL] state=${state} battleid=${battleid} time=${game_time_fmt} paused=${paused}`);

        // log all unique states we see so we can confirm the exact string
        if (state && state !== pollGameAPI._lastLoggedState) {
          console.log(`[STATE CHANGE] → "${state}"`);
          pollGameAPI._lastLoggedState = state;
        }

        // snapshot before any mutation so we can detect transitions
        const prevState    = gameState.state;
        const prevBattleId = currentBattleId;

        // detect new game (new battleid)
        if (battleid && battleid !== currentBattleId) {
          resetForNewGame(battleid);
        }

        // flush positionLog only when both conditions are true simultaneously:
        // the state just left "end" AND the battleid changed — this keeps the last
        // game's positions queryable through the entire "end" state
        if (prevState === "end" && state !== "end" && battleid !== prevBattleId) {
          positionLog = [];
          posWriteCounter = 0;
          try { if (fs.existsSync(POSITIONS_FILE)) fs.unlinkSync(POSITIONS_FILE); } catch {}
          console.log("[POSITIONS] Flushed — new game started after end state");
        }

        // extract team tricodes and player names from camp_list (seats structure)
        // normal:  game_camp1 seat_1..5 → watch1..5,  game_camp2 seat_1..5 → watch10..6
        // swapped: game_camp1 seat_1..5 → watch10..6, game_camp2 seat_1..5 → watch1..5
        const camps = data.camp_list || [];
        const campNames = {};
        const freshNames = {};
        const watchesNormal   = [1, 2, 3, 4, 5];
        const watchesReversed = [10, 9, 8, 7, 6];
        for (const camp of camps) {
          if (camp.campid === 1) {
            campNames.camp1 = camp.team_simple_name || "";
            if (!campTricodes.camp1 && camp.team_simple_name) campTricodes.camp1 = camp.team_simple_name.toUpperCase().trim();
            const watchNums = campSwapped ? watchesReversed : watchesNormal;
            for (let s = 1; s <= 5; s++) {
              const p = camp[`seat_${s}`];
              if (p && p.name) freshNames[watchNums[s - 1]] = p.name;
            }
          }
          if (camp.campid === 2) {
            campNames.camp2 = camp.team_simple_name || "";
            if (!campTricodes.camp2 && camp.team_simple_name) campTricodes.camp2 = camp.team_simple_name.toUpperCase().trim();
            const watchNums = campSwapped ? watchesNormal : watchesReversed;
            for (let s = 1; s <= 5; s++) {
              const p = camp[`seat_${s}`];
              if (p && p.name) freshNames[watchNums[s - 1]] = p.name;
            }
          }
        }
        if (Object.keys(freshNames).length > 0) playerNames = freshNames;
        gameState = { state, battleid, game_time_s, game_time_fmt, paused, campNames };

        // accumulate stats only while playing and not paused
        if (state === "play") hasSeenPlay = true;
        if (state === "play" && !paused) {
          tickStats();

          // detect lord / turtle kills (per camp for overlay attribution)
          const c1data    = camps.find(c => c.campid === 1) || {};
          const c2data    = camps.find(c => c.campid === 2) || {};
          const c1LordNow = c1data.kill_lord     || 0;
          const c2LordNow = c2data.kill_lord     || 0;
          const c1TurtNow = c1data.kill_tortoise || 0;
          const c2TurtNow = c2data.kill_tortoise || 0;
          const totalLord   = c1LordNow + c2LordNow;
          const totalTurtle = c1TurtNow + c2TurtNow;

          if (c1LordNow > prevC1Lord) {
            console.log(`[EVENT] LORD kill by camp1 at ${game_time_fmt}`);
            snapshotObjective("LORD", game_time_fmt);
            for (let i = 0; i < c1LordNow - prevC1Lord; i++)
              gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'lord', camp: 'camp1' });
            prevC1Lord = c1LordNow;
          }
          if (c2LordNow > prevC2Lord) {
            console.log(`[EVENT] LORD kill by camp2 at ${game_time_fmt}`);
            snapshotObjective("LORD", game_time_fmt);
            for (let i = 0; i < c2LordNow - prevC2Lord; i++)
              gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'lord', camp: 'camp2' });
            prevC2Lord = c2LordNow;
          }
          if (c1TurtNow > prevC1Turtle) {
            console.log(`[EVENT] TURTLE kill by camp1 at ${game_time_fmt}`);
            snapshotObjective("TURTLE", game_time_fmt);
            for (let i = 0; i < c1TurtNow - prevC1Turtle; i++)
              gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'turtle', camp: 'camp1' });
            prevC1Turtle = c1TurtNow;
          }
          if (c2TurtNow > prevC2Turtle) {
            console.log(`[EVENT] TURTLE kill by camp2 at ${game_time_fmt}`);
            snapshotObjective("TURTLE", game_time_fmt);
            for (let i = 0; i < c2TurtNow - prevC2Turtle; i++)
              gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'turtle', camp: 'camp2' });
            prevC2Turtle = c2TurtNow;
          }
          prevKillLord   = totalLord;
          prevKillTurtle = totalTurtle;

          // per-player K/D/A events from seat data
          for (const camp of camps) {
            const campKey = camp.campid === 1 ? 'camp1' : camp.campid === 2 ? 'camp2' : null;
            if (!campKey) continue;
            const watchNums = (campKey === 'camp1')
              ? (campSwapped ? [10, 9, 8, 7, 6] : [1, 2, 3, 4, 5])
              : (campSwapped ? [1, 2, 3, 4, 5]  : [10, 9, 8, 7, 6]);
            for (let s = 1; s <= 5; s++) {
              const seat = camp[`seat_${s}`];
              if (!seat) continue;
              const watch   = watchNums[s - 1];
              const statKey = `${campKey}-${s}`;
              const prev    = prevSeatKDA[statKey] || { kills: 0, assists: 0, deaths: 0 };
              const curK    = seat.kill_num   ?? 0;
              const curA    = seat.assist_num ?? 0;
              const curD    = seat.dead_num   ?? 0;
              for (let i = 0; i < curK - prev.kills;   i++)
                gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'kill',   slot: `slot${watch}` });
              for (let i = 0; i < curA - prev.assists; i++)
                gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'assist', slot: `slot${watch}` });
              for (let i = 0; i < curD - prev.deaths;  i++)
                gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'death',  slot: `slot${watch}` });
              prevSeatKDA[statKey] = { kills: curK, assists: curA, deaths: curD };
            }
          }
          if (gameEvents.length > MAX_EVENTS) gameEvents.splice(0, gameEvents.length - MAX_EVENTS);

          // detect clashes: total kills across both camps jumped by 3+
          const totalKills = camps.reduce((a, c) => a + (c.score || 0), 0);
          const killJump   = totalKills - prevTotalKills;
          if (killJump >= 3) {
            console.log(`[EVENT] CLASH detected at ${game_time_fmt} (kill jump: +${killJump})`);
            snapshotClash(game_time_fmt, killJump);
          }
          prevTotalKills = totalKills;
        }

        // record map positions for all players every poll while game is live
        if (state === "play") {
          for (const camp of camps) {
            if (camp.campid !== 1 && camp.campid !== 2) continue;
            for (let s = 1; s <= 5; s++) {
              const seat = camp[`seat_${s}`];
              if (!seat || !seat.map_pos) continue;
              positionLog.push({
                game_time_s,
                camp: camp.campid,
                seat: s,
                x: seat.map_pos.x,
                y: seat.map_pos.y,
              });
            }
          }
          if (positionLog.length > MAX_POS_LOG) positionLog.splice(0, positionLog.length - MAX_POS_LOG);
          // persist to disk every 60 polls so a mid-game restart doesn't lose everything
          if (++posWriteCounter % 60 === 0) savePositionsToDisk();
        }

        // fight detection — runs every play-state poll (paused or not; game_time won't
        // advance while paused so the gap timeout naturally holds)
        if (state === "play") tickFight(camps, game_time_s, game_time_fmt);

        // persist positions to disk on first transition to "end"
        if (state === "end" && gameState.state !== "end") savePositionsToDisk();

        // write postgame when state = "end", but only if we saw "play" this session
        // and haven't already written for this battleid
        if (state === "end" && hasSeenPlay && battleid && battleid !== lastWrittenBattleId) {
          console.log(`[POSTGAME] Writing postgame for battleid=${battleid}`);
          postgamePlayerNames = { ...playerNames };
          bpmOnEnd = {};
          for (const pid of Object.keys(players)) {
            const r = readings[pid];
            bpmOnEnd[pid] = r.bpm !== null ? r.bpm : r.last_bpm;
          }
          try {
            const payload = buildPostgamePayload(data);
            writePostgame(payload);
            lastWrittenBattleId = battleid;
          } catch (e) {
            console.error("[POSTGAME] Failed to write:", e.message);
          }
        } else if (state === "end" && !hasSeenPlay) {
          console.log(`[POSTGAME] Skipping — server started at "end", waiting for a live game first`);
        } else if (state === "end" && battleid === lastWrittenBattleId) {
          // already written, silent
        }

      } catch (e) {
        console.error("[POLL] Parse error:", e.message);
      }
    });
  }).on("error", (e) => {
    console.warn("[POLL] Game API unreachable:", e.message);
  });
}

// ── RESTORE FIGHTS FROM LAST SESSION ─────────────────────────────────────────
if (fs.existsSync(FIGHTS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(FIGHTS_FILE, "utf8"));
    if (saved.battleid && Array.isArray(saved.fights) && saved.fights.length > 0) {
      fightLog        = saved.fights;
      fightIdSeq      = Math.max(...saved.fights.map(f => f.id), 0);
      currentBattleId = saved.battleid;
      console.log(`[FIGHTS] Restored ${fightLog.length} fights from disk (battleid=${currentBattleId})`);
    }
  } catch (e) {
    console.warn("[FIGHTS] Could not restore from disk:", e.message);
  }
}

// ── RESTORE POSITIONS FROM LAST SESSION ──────────────────────────────────────
if (fs.existsSync(POSITIONS_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf8"));
    if (saved.battleid && Array.isArray(saved.positions) && saved.positions.length > 0) {
      positionLog     = saved.positions;
      currentBattleId = saved.battleid;
      console.log(`[POSITIONS] Restored ${positionLog.length} positions from disk (battleid=${currentBattleId})`);
    }
  } catch (e) {
    console.warn("[POSITIONS] Could not restore from disk:", e.message);
  }
}

setInterval(pollGameAPI, POLL_MS);
setInterval(pollH2H, 5000);
setInterval(tickSimulation, POLL_MS);
pollGameAPI();
pollH2H(true);  // force run once on startup regardless of game state
tickSimulation();

// ── FEED BUILDERS ─────────────────────────────────────────────────────────────
function buildVmix() {
  return Object.values(readings).map((r) => ({
    bpm:           r.status === "ok" ? r.bpm : (r.simulated_bpm !== null ? r.simulated_bpm : r.last_bpm),
    bpm_simulated: r.status !== "ok" && r.simulated_bpm !== null,
    name:          r.name,
    role:          r.role,
    slot:          r.slot,
    status:        r.status,
    team:          r.team,
  }));
}

function buildCampFeed() {
  const mapCamp = (entries) =>
    entries.map(({ pid, watch }, i) => {
      const r = readings[pid];
      const d = deriveStats(pid);
      return {
        [`player${i + 1}`]: {
          // live always
          slot:        `slot${watch}`,
          name:        `watch${watch}`,
          player_name: playerNames[watch] || null,
          role:        ROLE_DISPLAY[players[pid].role] || players[pid].role,
          bpm:         r.status === "ok"
                       ? r.bpm
                       : (r.simulated_bpm !== null ? r.simulated_bpm : r.last_bpm),
          bpm_simulated: r.status !== "ok" && r.simulated_bpm !== null,
          status:      r.status,
          // resets per game, accumulates only while playing
          avg_bpm:                 d.avg_bpm,
          peak_bpm:                d.peak_bpm,
          pct_above_120:           d.pct_above_120,
          avg_bpm_at_objectives:   d.avg_bpm_at_objectives,
          peak_bpm_at_objectives:  d.peak_bpm_at_objectives,
        },
      };
    });

  return {
    game: {
      state:         gameState.state,
      game_time:     gameState.game_time_fmt,
      battleid:      gameState.battleid,
      camp_swapped:  campSwapped,
      camp1_tricode: (gameState.campNames && gameState.campNames.camp1) ? gameState.campNames.camp1.toUpperCase().trim() : campTricodes.camp1,
      camp2_tricode: (gameState.campNames && gameState.campNames.camp2) ? gameState.campNames.camp2.toUpperCase().trim() : campTricodes.camp2,
    },
    camp1: {
      tricode: campSwapped
        ? (gameState.campNames && gameState.campNames.camp2 ? gameState.campNames.camp2.toUpperCase().trim() : campTricodes.camp2)
        : (gameState.campNames && gameState.campNames.camp1 ? gameState.campNames.camp1.toUpperCase().trim() : campTricodes.camp1),
      players: mapCamp(activeCampMap.camp1),
    },
    camp2: {
      tricode: campSwapped
        ? (gameState.campNames && gameState.campNames.camp1 ? gameState.campNames.camp1.toUpperCase().trim() : campTricodes.camp1)
        : (gameState.campNames && gameState.campNames.camp2 ? gameState.campNames.camp2.toUpperCase().trim() : campTricodes.camp2),
      players: mapCamp(activeCampMap.camp2),
    },
    highlights: buildHighlights(playerNames),
    clashes:    buildClashSummary(),
  };
}


// ── LEAGUE STATS BUILDER ──────────────────────────────────────────────────────
const ROLE_ORDER = ['EXP LANER', 'JUNGLER', 'MID LANER', 'ROAMER', 'GOLD LANER'];

function buildLeagueStats() {
  // 1. Read all postgame files, dedupe by battleid keeping latest iteration
  const files = fs.readdirSync(POSTGAME_DIR).filter(f => f.endsWith('.json'));

  // group by battleid
  const byBattle = {};
  for (const fname of files) {
    // filename: postgame_{battleid}_{date}.json or postgame_{battleid}_{date}_{N}.json
    const match = fname.match(/^postgame_([^_]+(?:_[^_]+)*)_(\d{4}-\d{2}-\d{2})(?:_(\d+))?\.json$/);
    if (!match) continue;
    const battleid  = match[1];
    const iteration = match[3] ? parseInt(match[3]) : 1;
    if (!byBattle[battleid] || iteration > byBattle[battleid].iteration) {
      byBattle[battleid] = { fname, iteration };
    }
  }

  // 2. Parse each deduplicated file
  const games = [];
  for (const { fname } of Object.values(byBattle)) {
    try {
      const raw = fs.readFileSync(path.join(POSTGAME_DIR, fname), 'utf8');
      games.push(JSON.parse(raw));
    } catch (e) {
      console.warn(`[LEAGUE] Could not parse ${fname}:`, e.message);
    }
  }

  // 3. Build current matchup from H2H API + league stats (pre-match talking points)
  // H2H tells us who is playing; league stats give historical BPM context per player
  let currentMatchup = null;
  try {
    const h2hRaw = fs.readFileSync
      ? null : null; // placeholder — we fetch synchronously below
  } catch(e) {}

  // We use the cached h2hLastData if available (set by pollH2H)
  const h2hData = buildLeagueStats._h2hCache || null;

  if (h2hData) {
    const buildMatchupTeam = (teamData, leagueTeams) => {
      const tricode = (teamData.tricode || '').toUpperCase().trim();
      const teamLeague = leagueTeams.find(t => t.tricode === tricode);
      const leaguePlayers = teamLeague ? teamLeague.players : [];

      // Build player list from league stats, ordered by role
      const players = leaguePlayers.map(lp => ({
        player_name:            lp.player_name,
        role:                   lp.role,
        games_played:           lp.games_played,
        avg_bpm:                lp.avg_bpm,
        peak_bpm_ever:          lp.peak_bpm_ever,
        avg_pct_above_120:      lp.avg_pct_above_120,
        avg_bpm_at_objectives:  lp.avg_bpm_at_objectives,
        peak_bpm_at_objectives: lp.peak_bpm_at_objectives,
      }));

      return { tricode, players };
    };

    // We need league teams already built — pass them in after aggregation
    // so we defer final assembly to after step 5
    currentMatchup = { _team1: h2hData.team1, _team2: h2hData.team2, _pending: true };
  }

  // 4. Aggregate league stats per player per team
  // playerKey = tricode + player_name
  const teamMap = {};  // { tricode: { player_name: { ...accumulated } } }

  for (const game of games) {
    for (const campKey of ['camp1', 'camp2', 'home', 'away']) {
      const campObj = game[campKey];
      if (!campObj || !campObj.players) continue;
      const tricode = campObj.tricode || campObj.camp_code || null;
      if (!tricode) continue;
      if (!teamMap[tricode]) teamMap[tricode] = {};

      // support both array-of-objects (camp) and flat array (home/away)
      const playerList = Array.isArray(campObj.players)
        ? campObj.players.map(p => typeof p === 'object' && !p.player_name ? Object.values(p)[0] : p)
        : [];
      for (const p of playerList) {
        if (!p || !p.player_name) continue;
        const name = p.player_name;
        if (!teamMap[tricode][name]) {
          teamMap[tricode][name] = {
            player_name:              name,
            role:                     p.role || null,
            games_played:             0,
            avg_bpm_samples:          [],
            peak_bpm_ever:            null,
            pct_above_120_samples:    [],
            avg_bpm_at_obj_samples:   [],
            peak_bpm_at_obj_ever:     null,
          };
        }
        const acc = teamMap[tricode][name];
        // update role to latest seen
        if (p.role) acc.role = p.role;
        // only count game if player had valid data
        if (p.avg_bpm !== null && p.avg_bpm !== undefined) {
          acc.games_played++;
          acc.avg_bpm_samples.push(p.avg_bpm);
        }
        if (p.peak_bpm !== null && p.peak_bpm !== undefined) {
          acc.peak_bpm_ever = acc.peak_bpm_ever === null ? p.peak_bpm : Math.max(acc.peak_bpm_ever, p.peak_bpm);
        }
        if (p.pct_above_120 !== null && p.pct_above_120 !== undefined) {
          const pct = parseInt(p.pct_above_120);
          if (!isNaN(pct)) acc.pct_above_120_samples.push(pct);
        }
        if (p.avg_bpm_at_objectives !== null && p.avg_bpm_at_objectives !== undefined) {
          acc.avg_bpm_at_obj_samples.push(p.avg_bpm_at_objectives);
        }
        if (p.peak_bpm_at_objectives !== null && p.peak_bpm_at_objectives !== undefined) {
          acc.peak_bpm_at_obj_ever = acc.peak_bpm_at_obj_ever === null
            ? p.peak_bpm_at_objectives
            : Math.max(acc.peak_bpm_at_obj_ever, p.peak_bpm_at_objectives);
        }
      }
    }
  }

  // 5. Finalize averages and sort
  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  const teams = Object.entries(teamMap).map(([tricode, players]) => {
    const sorted = Object.values(players)
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
      .map(acc => ({
        player_name:            acc.player_name,
        role:                   acc.role,
        games_played:           acc.games_played,
        avg_bpm:                avg(acc.avg_bpm_samples),
        peak_bpm_ever:          acc.peak_bpm_ever,
        avg_pct_above_120:      acc.pct_above_120_samples.length ? avg(acc.pct_above_120_samples) + "%" : null,
        avg_bpm_at_objectives:  avg(acc.avg_bpm_at_obj_samples),
        peak_bpm_at_objectives: acc.peak_bpm_at_obj_ever,
      }));
    return { tricode, players: sorted };
  });

  // Finalize current_matchup now that league teams are built
  if (currentMatchup && currentMatchup._pending) {
    const t1 = currentMatchup._team1;
    const t2 = currentMatchup._team2;
    const buildMatchupTeam = (teamData) => {
      const tricode = ((teamData && teamData.tricode) || '').toUpperCase().trim();
      const teamLeague = teams.find(t => t.tricode === tricode);
      const leaguePlayers = teamLeague ? teamLeague.players : [];
      return {
        tricode,
        team_name: (teamData && (teamData.CAMP_NAME || teamData['TEAM NAME'])) || null,
        players: leaguePlayers.map(lp => ({
          player_name:            lp.player_name,
          role:                   lp.role,
          games_played:           lp.games_played,
          avg_bpm:                lp.avg_bpm,
          peak_bpm_ever:          lp.peak_bpm_ever,
          avg_pct_above_120:      lp.avg_pct_above_120,
          avg_bpm_at_objectives:  lp.avg_bpm_at_objectives,
          peak_bpm_at_objectives: lp.peak_bpm_at_objectives,
        })),
      };
    };
    currentMatchup = {
      home: buildMatchupTeam(t1),
      away: buildMatchupTeam(t2),
    };
  }

  return {
    current_matchup: currentMatchup || { error: "H2H data not yet available" },
    league_stats: {
      games_recorded: games.length,
      teams,
    },
  };
}

// ── SERVER ────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // POST /bpm — receive from Android watches
  if (req.method === "POST" && req.url === "/bpm") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const bpm  = data.bpm;
        const pid  = data.player_id || "player1";

        if (!bpm || typeof bpm !== "number") {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "missing or invalid bpm" }));
          return;
        }

        const now = new Date().toISOString();
        if (readings[pid]) {
          readings[pid].bpm       = bpm;
          readings[pid].last_bpm  = bpm;
          readings[pid].status    = "ok";
          readings[pid].last_seen = now;
        }

        log.push({ player_id: pid, bpm, time: new Date().toLocaleTimeString() });
        if (log.length > MAX_LOG) log.shift();

        console.log(`[BPM] player=${pid} bpm=${bpm}`);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid JSON" }));
      }
    });
    return;
  }

  // GET /feed/order — camp-ordered feed with live stats
  if (req.method === "GET" && req.url === "/feed/order") {
    res.writeHead(200);
    res.end(JSON.stringify(buildCampFeed()));
    return;
  }

  // GET /feed — vmix-style flat array
  if (req.method === "GET" && (req.url === "/feed" || req.url === "/feed/vmix")) {
    res.writeHead(200);
    res.end(JSON.stringify(buildVmix()));
    return;
  }

  // GET /bpm — latest single reading
  if (req.method === "GET" && req.url === "/bpm") {
    const last = log[log.length - 1] || null;
    res.writeHead(200);
    res.end(JSON.stringify(last || { bpm: null, message: "No data yet" }));
    return;
  }

  // GET /bpm/log
  if (req.method === "GET" && req.url.startsWith("/bpm/log")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const limit  = parseInt(params.get("limit") || "100");
    const slice  = log.slice(-limit).reverse();
    res.writeHead(200);
    res.end(JSON.stringify({ count: slice.length, readings: slice }));
    return;
  }

  // GET /events — per-player K/D/A + objective events for current game
  if (req.method === "GET" && req.url.startsWith("/events")) {
    const params   = new URL(req.url, "http://localhost").searchParams;
    const since    = parseInt(params.get("since") || "0");
    const filtered = since > 0 ? gameEvents.filter(e => e.time_s >= since) : [...gameEvents];
    res.writeHead(200);
    res.end(JSON.stringify({
      game:   { state: gameState.state, battleid: gameState.battleid },
      events: filtered,
    }));
    return;
  }

  // GET /postgame — last completed game stats from file
  if (req.method === "GET" && req.url === "/postgame") {
    const file = path.join(__dirname, "postgame.json");
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "No postgame data yet" }));
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.writeHead(200);
    res.end(fs.readFileSync(file, "utf8"));
    return;
  }

  // GET /stats/league — current matchup + all-time league stats
  if (req.method === "GET" && req.url === "/stats/league") {
    try {
      const payload = buildLeagueStats();
      res.writeHead(200);
      res.end(JSON.stringify(payload));
    } catch (e) {
      console.error("[LEAGUE] Error:", e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /positions?camp=1&seat=2&from=0&to=600  (all params optional)
  if (req.method === "GET" && req.url.startsWith("/positions")) {
    const params     = new URL(req.url, "http://localhost").searchParams;
    const campFilter = params.has("camp") ? parseInt(params.get("camp")) : null;
    const seatFilter = params.has("seat") ? parseInt(params.get("seat")) : null;
    const from       = parseInt(params.get("from") ?? "0");
    const to         = parseInt(params.get("to")   ?? "99999");

    const filtered = positionLog.filter(p =>
      p.game_time_s >= from &&
      p.game_time_s <= to &&
      (campFilter === null || p.camp === campFilter) &&
      (seatFilter === null || p.seat === seatFilter)
    );

    res.writeHead(200);
    res.end(JSON.stringify({
      game:      { state: gameState.state, battleid: gameState.battleid, game_time: gameState.game_time_fmt },
      from,
      to,
      count:     filtered.length,
      positions: filtered,
    }));
    return;
  }

  // GET /hero/:filename — serve hero icon images
  if (req.method === "GET" && req.url.startsWith("/hero/")) {
    const filename = path.basename(req.url.slice("/hero/".length).split("?")[0]);
    const filePath = path.join(__dirname, "hero", filename);
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end("not found"); return; }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.writeHead(200);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // GET /fights-static — fights.json (for debug mode)
  if (req.method === "GET" && req.url === "/fights-static") {
    const file = path.join(__dirname, "fights.json");
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "fights.json not found" }));
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: "fights.json parse failed: " + e.message }));
    }
    return;
  }

  // GET /fights-overlay — fight recap overlay HTML
  if (req.method === "GET" && req.url === "/fights-overlay") {
    const file = path.join(__dirname, "fights.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "fights.html not found" }));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    res.end(fs.readFileSync(file, "utf8"));
    return;
  }

  // GET /fights?last=N — completed fight recaps this game, optional ?last=N for last N fights
  if (req.method === "GET" && req.url.startsWith("/fights")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const last   = params.has("last") ? parseInt(params.get("last")) : null;
    const list   = last ? fightLog.slice(-last) : [...fightLog];

    const active = activeFight ? {
      id:              activeFight.id,
      start_time_s:    activeFight.start_time_s,
      start_time_fmt:  activeFight.start_time_fmt,
      last_active_s:   activeFight.last_active_s,
      duration_so_far: gameState.game_time_s - activeFight.start_time_s,
    } : null;

    res.writeHead(200);
    res.end(JSON.stringify({
      game:         { state: gameState.state, battleid: gameState.battleid, game_time: gameState.game_time_fmt },
      active_fight: active,
      count:        list.length,
      fights:       list,
    }));
    return;
  }

  // GET / — dashboard
  if (req.method === "GET" && req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    const rows = buildVmix().map((p) => `
      <tr>
        <td>${p.slot}</td>
        <td>${p.name}</td>
        <td>${p.team}</td>
        <td style="color:#aaa;font-weight:bold">${p.role}</td>
        <td style="color:${p.status === "ok" ? "#1db954" : p.bpm_simulated ? "#f5a623" : "#555"};font-size:20px;font-weight:bold">
          ${p.bpm !== null && p.bpm !== undefined ? p.bpm : "--"}${p.bpm_simulated ? " ~" : ""}
        </td>
        <td>
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.status === "ok" ? "#1db954" : "#e53935"};margin-right:6px;"></span>
          <span style="color:${p.status === "ok" ? "#1db954" : "#e53935"}">${p.status}</span>
        </td>
      </tr>`).join("");
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>BPM Server</title>
        <meta http-equiv="refresh" content="2">
        <style>
          body { background:#0f0f0f; color:#fff; font-family:sans-serif; padding:40px; }
          h1 { color:#1db954; }
          table { border-collapse:collapse; width:100%; max-width:700px; }
          th,td { padding:10px 14px; border-bottom:1px solid #222; font-size:14px; text-align:left; }
          th { color:#555; }
          .meta { color:#555; font-size:12px; margin-top:20px; }
          .game-bar { background:#111; border:1px solid #222; border-radius:6px; padding:10px 16px; margin-bottom:24px; font-size:13px; color:#aaa; display:flex; gap:24px; }
          .game-bar span { color:#fff; font-weight:bold; }
        </style>
      </head>
      <body>
        <h1>💓 BPM Server</h1>
        <div class="game-bar">
          <div>State: <span id="gstate">${gameState.state}</span></div>
          <div>Game Time: <span>${gameState.game_time_fmt}</span></div>
          <div>Battle ID: <span>${gameState.battleid || "--"}</span></div>
        </div>
        <table>
          <tr><th>Slot</th><th>Name</th><th>Team</th><th>Role</th><th>BPM</th><th>Status</th></tr>
          ${rows}
        </table>
        <div class="meta">Auto-refreshes every 2s &nbsp;|&nbsp; GET /feed for JSON &nbsp;|&nbsp; GET /feed/order for camp stats &nbsp;|&nbsp; GET /postgame for last game</div>
      </body>
      </html>
    `);
    return;
  }

  // GET /overlay/events — SSE stream for show/hide triggers
  if (req.method === "GET" && req.url === "/overlay/events") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.writeHead(200);
    res.write(': connected\n\n');
    overlayClients.push(res);
    req.on("close", () => {
      const i = overlayClients.indexOf(res);
      if (i !== -1) overlayClients.splice(i, 1);
    });
    return;
  }

  // GET /overlay/fights/show — show fight recap overlay
  if (req.method === "GET" && req.url === "/overlay/fights/show") {
    overlayClients.forEach(c => { try { c.write('event: fights\ndata: {"action":"show"}\n\n'); } catch {} });
    res.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, action: "show" }));
    return;
  }

  // GET /overlay/fights/hide — hide fight recap overlay
  if (req.method === "GET" && req.url === "/overlay/fights/hide") {
    overlayClients.forEach(c => { try { c.write('event: fights\ndata: {"action":"hide"}\n\n'); } catch {} });
    res.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, action: "hide" }));
    return;
  }

  // GET or POST /overlay/slot1..slot10  → show player
  // GET or POST /overlay/hide           → hide overlay
  if ((req.method === "GET" || req.method === "POST" || req.method === "OPTIONS") && req.url.startsWith("/overlay/") && !req.url.startsWith("/overlay/events")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const slot = req.url.slice("/overlay/".length).split("?")[0].replace(/\/+$/, "");
    if (slot === "hide") {
      overlayClients.forEach(c => { try { c.write('event: hide\ndata: {}\n\n'); } catch {} });
    } else {
      const msg = `event: show\ndata: ${JSON.stringify({ slot })}\n\n`;
      overlayClients.forEach(c => { try { c.write(msg); } catch {} });
    }
    res.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, action: slot === "hide" ? "hide" : "show", slot }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("================================================");
  console.log(`  BPM Server running on :${PORT}`);
  console.log(`  Dashboard  → http://localhost:${PORT}/`);
  console.log(`  Feed       → http://localhost:${PORT}/feed`);
  console.log(`  Camp Feed  → http://localhost:${PORT}/feed/order`);
  console.log(`  Latest BPM → http://localhost:${PORT}/bpm`);
  console.log(`  BPM Log    → http://localhost:${PORT}/bpm/log`);
  console.log(`  Postgame   → http://localhost:${PORT}/postgame`);
  console.log(`  League     → http://localhost:${PORT}/stats/league`);
  console.log(`  Overlay    → GET  http://localhost:${PORT}/overlay/slot1  (show)`);
  console.log(`             → GET  http://localhost:${PORT}/overlay/hide   (hide)`);
  console.log(`  Fights OL  → GET  http://localhost:${PORT}/overlay/fights/show`);
  console.log(`             → GET  http://localhost:${PORT}/overlay/fights/hide`);
  console.log(`  Positions  → GET  http://localhost:${PORT}/positions`);
  console.log(`  Fights     → GET  http://localhost:${PORT}/fights`);
  console.log(`             →      ?last=N  for last N fights`);
  console.log(`             →      ?camp=1&seat=2&from=0&to=600`);
  console.log(`             →      camp 1|2  seat 1-5  from/to in seconds`);
  console.log("================================================");
});
