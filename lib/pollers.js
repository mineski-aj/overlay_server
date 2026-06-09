// lib/pollers.js — httpGet, pollGameAPI, pollH2H
const http  = require("http");
const https = require("https");
const fs    = require("fs");

const {
  GAME_API, MAIN_API, POLL_MS,
  POSITIONS_FILE, MAX_EVENTS, MAX_POS_LOG,
} = require('./config');
const state  = require('./state');
const { players } = require('./config');
const {
  applySwap,
  resetForNewGame,
  tickStats,
  tickSimulation,
  tickFight,
  snapshotObjective,
  snapshotClash,
  saveFightsToDisk,
  savePositionsToDisk,
  buildPostgamePayload,
  writePostgame,
} = require('./game');
const { buildLeagueStats } = require('./feeds');
const { countItems, ITEM_NAMES, TIER3_ITEMS } = require('./items');

// ── HTTP GET (follows one redirect) ──────────────────────────────────────────
function httpGet(url, cb) {
  const mod = url.startsWith("https://") ? https : http;
  return mod.get(url, (res) => {
    if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 308) && res.headers.location) {
      console.log(`[HTTP] Redirect ${res.statusCode} → ${res.headers.location}`);
      res.resume();
      httpGet(res.headers.location, cb);
      return;
    }
    cb(res);
  });
}

// ── MAIN API POLLER ───────────────────────────────────────────────────────────
function pollH2H(force = false) {
  if (!force && state.gameState.state === "play") return;

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

        const gameCamp1 = state.gameState.campNames && state.gameState.campNames.camp1
          ? state.gameState.campNames.camp1.toUpperCase().trim()
          : null;

        if (!gameCamp1) return;

        const needsSwap    = gameCamp1 !== mainTricode;
        const mainTricode2 = (json.team2 && (json.team2.CAMP_CODE || "")).toUpperCase().trim();
        if (needsSwap) {
          state.campTricodes = { camp1: mainTricode2 || gameCamp1, camp2: mainTricode };
        } else {
          state.campTricodes = { camp1: mainTricode, camp2: mainTricode2 || state.gameState.campNames?.camp2?.toUpperCase().trim() || null };
        }
        applySwap(needsSwap);
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

// tracks which battleid has had its first item snapshot — prevents cold-start spam
let _itemsInitBattleId = null;

// ── Kill event definitions (ascending priority = playback order) ──────────────
const KILL_MULTI_DEFS = [
  { key: 'first_blood',   video: 'firstblood.webm',  priority: 1 },
  { key: 'double_kill',   video: 'doublekill.webm',  priority: 2 },
  { key: 'triple_kill',   video: 'triplekill.webm',  priority: 3 },
  { key: 'quadra_kill',   video: 'maniac.webm',      priority: 4 },
  { key: 'penta_kill',    video: 'savage.webm',      priority: 5 },
];
const KILL_OBJ_DEFS = [
  { key: 'kill_lord',     video: 'lordslain.webm',   priority: 1 },
  { key: 'kill_tortoise', video: 'turtleslain.webm', priority: 1 },
];
const ALL_KILL_DEFS = [...KILL_MULTI_DEFS, ...KILL_OBJ_DEFS];

function broadcastKillEvent(video, priority, playerIdx, playerName) {
  const payload = JSON.stringify({ video, priority, playerIdx, playerName: playerName || null });
  state.overlayClients.forEach(c => { try { c.write(`event: killevent\ndata: ${payload}\n\n`); } catch {} });
}

// ── GAME API POLLER ───────────────────────────────────────────────────────────
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

        const apiState      = data.state;
        const battleid      = String(data.battleid || json.dataid || "");
        const game_time_s   = data.game_time || 0;
        const _mm = String(Math.floor(game_time_s / 60)).padStart(2, "0");
        const _ss = String(game_time_s % 60).padStart(2, "0");
        const game_time_fmt = `${_mm}:${_ss}`;
        const paused        = data.paused || data.banpick_paused || false;

        console.log(`[POLL] state=${apiState} battleid=${battleid} time=${game_time_fmt} paused=${paused}`);

        if (apiState && apiState !== pollGameAPI._lastLoggedState) {
          console.log(`[STATE CHANGE] → "${apiState}"`);
          pollGameAPI._lastLoggedState = apiState;
        }

        const prevState    = state.gameState.state;
        const prevBattleId = state.currentBattleId;

        if (battleid && battleid !== state.currentBattleId) {
          resetForNewGame(battleid);
          state.prevKillEventCounts = {};
        }

        if (prevState === "end" && apiState !== "end" && battleid !== prevBattleId) {
          state.positionLog    = [];
          state.posWriteCounter = 0;
          try { if (fs.existsSync(POSITIONS_FILE)) fs.unlinkSync(POSITIONS_FILE); } catch {}
          console.log("[POSITIONS] Flushed — new game started after end state");
        }

        const camps = data.camp_list || [];
        const campNames = {};
        const freshNames = {};
        const watchesNormal   = [1, 2, 3, 4, 5];
        const watchesReversed = [10, 9, 8, 7, 6];
        for (const camp of camps) {
          if (camp.campid === 1) {
            campNames.camp1 = camp.team_simple_name || "";
            if (!state.campTricodes.camp1 && camp.team_simple_name) state.campTricodes.camp1 = camp.team_simple_name.toUpperCase().trim();
            const watchNums = state.campSwapped ? watchesReversed : watchesNormal;
            for (let s = 1; s <= 5; s++) {
              const p = camp[`seat_${s}`];
              if (p && p.name) freshNames[watchNums[s - 1]] = p.name;
            }
          }
          if (camp.campid === 2) {
            campNames.camp2 = camp.team_simple_name || "";
            if (!state.campTricodes.camp2 && camp.team_simple_name) state.campTricodes.camp2 = camp.team_simple_name.toUpperCase().trim();
            const watchNums = state.campSwapped ? watchesNormal : watchesReversed;
            for (let s = 1; s <= 5; s++) {
              const p = camp[`seat_${s}`];
              if (p && p.name) freshNames[watchNums[s - 1]] = p.name;
            }
          }
        }
        if (Object.keys(freshNames).length > 0) state.playerNames = freshNames;
        state.gameState = { state: apiState, battleid, game_time_s, game_time_fmt, paused, campNames };

        if (apiState === "play") state.hasSeenPlay = true;
        if (apiState === "play" && !paused) {
          tickStats();

          const c1data    = camps.find(c => c.campid === 1) || {};
          const c2data    = camps.find(c => c.campid === 2) || {};
          const c1LordNow = c1data.kill_lord     || 0;
          const c2LordNow = c2data.kill_lord     || 0;
          const c1TurtNow = c1data.kill_tortoise || 0;
          const c2TurtNow = c2data.kill_tortoise || 0;
          const totalLord   = c1LordNow + c2LordNow;
          const totalTurtle = c1TurtNow + c2TurtNow;

          if (c1LordNow > state.prevC1Lord) {
            console.log(`[EVENT] LORD kill by camp1 at ${game_time_fmt}`);
            snapshotObjective("LORD", game_time_fmt);
            for (let i = 0; i < c1LordNow - state.prevC1Lord; i++)
              state.gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'lord', camp: 'camp1' });
            state.prevC1Lord = c1LordNow;
          }
          if (c2LordNow > state.prevC2Lord) {
            console.log(`[EVENT] LORD kill by camp2 at ${game_time_fmt}`);
            snapshotObjective("LORD", game_time_fmt);
            for (let i = 0; i < c2LordNow - state.prevC2Lord; i++)
              state.gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'lord', camp: 'camp2' });
            state.prevC2Lord = c2LordNow;
          }
          if (c1TurtNow > state.prevC1Turtle) {
            console.log(`[EVENT] TURTLE kill by camp1 at ${game_time_fmt}`);
            snapshotObjective("TURTLE", game_time_fmt);
            for (let i = 0; i < c1TurtNow - state.prevC1Turtle; i++)
              state.gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'turtle', camp: 'camp1' });
            state.prevC1Turtle = c1TurtNow;
          }
          if (c2TurtNow > state.prevC2Turtle) {
            console.log(`[EVENT] TURTLE kill by camp2 at ${game_time_fmt}`);
            snapshotObjective("TURTLE", game_time_fmt);
            for (let i = 0; i < c2TurtNow - state.prevC2Turtle; i++)
              state.gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'turtle', camp: 'camp2' });
            state.prevC2Turtle = c2TurtNow;
          }
          state.prevKillLord   = totalLord;
          state.prevKillTurtle = totalTurtle;

          for (const camp of camps) {
            const campKey = camp.campid === 1 ? 'camp1' : camp.campid === 2 ? 'camp2' : null;
            if (!campKey) continue;
            const watchNums = (campKey === 'camp1')
              ? (state.campSwapped ? [10, 9, 8, 7, 6] : [1, 2, 3, 4, 5])
              : (state.campSwapped ? [1, 2, 3, 4, 5]  : [10, 9, 8, 7, 6]);
            for (let s = 1; s <= 5; s++) {
              const seat = camp[`seat_${s}`];
              if (!seat) continue;
              const watch   = watchNums[s - 1];
              const statKey = `${campKey}-${s}`;
              const prev    = state.prevSeatKDA[statKey] || { kills: 0, assists: 0, deaths: 0 };
              const curK    = seat.kill_num   ?? 0;
              const curA    = seat.assist_num ?? 0;
              const curD    = seat.dead_num   ?? 0;
              for (let i = 0; i < curK - prev.kills;   i++)
                state.gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'kill',   slot: `slot${watch}` });
              for (let i = 0; i < curA - prev.assists; i++)
                state.gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'assist', slot: `slot${watch}` });
              for (let i = 0; i < curD - prev.deaths;  i++)
                state.gameEvents.push({ time_s: game_time_s, time_fmt: game_time_fmt, type: 'death',  slot: `slot${watch}` });
              state.prevSeatKDA[statKey] = { kills: curK, assists: curA, deaths: curD };

              const pid = `player${watch}`;
              const currItems = countItems(seat.equip_list);
              if (_itemsInitBattleId !== battleid) {
                // first poll for this battleid — silent snapshot to avoid logging pre-existing items
                state.prevItemCounts[pid] = currItems;
              } else {
                const prevItems = state.prevItemCounts[pid] || {};
                for (const [idStr, cnt] of Object.entries(currItems)) {
                  const added = cnt - (prevItems[idStr] || 0);
                  for (let n = 0; n < added; n++) {
                    if (!state.itemLog[pid]) state.itemLog[pid] = [];
                    const iid = Number(idStr);
                    state.itemLog[pid].push({ game_time_s, game_time_fmt, item_id: iid, item_name: ITEM_NAMES[iid] || null, is_tier3: TIER3_ITEMS.has(iid) });
                    console.log(`[ITEMS] ${pid} bought item ${idStr} at ${game_time_fmt}`);
                  }
                }
                state.prevItemCounts[pid] = currItems;
              }
            }
          }
          if (state.gameEvents.length > MAX_EVENTS) state.gameEvents.splice(0, state.gameEvents.length - MAX_EVENTS);
          _itemsInitBattleId = battleid; // mark first play poll done for this game

          // ── Kill events detection ─────────────────────────────────────────
          const objFiredThisPoll = new Set();
          for (const camp of camps) {
            if (camp.campid !== 1 && camp.campid !== 2) continue;
            const cid = camp.campid;

            // Wipeout: all 5 players on this camp dead simultaneously
            const allDead = [1,2,3,4,5].every(s => camp[`seat_${s}`] && camp[`seat_${s}`].dead === true);
            if (allDead && !state.prevKillEventCounts[`wipeout_${cid}`]) {
              broadcastKillEvent('wipedout.webm', 3, null, null);
            }
            state.prevKillEventCounts[`wipeout_${cid}`] = allDead;

            for (let s = 1; s <= 5; s++) {
              const seat = camp[`seat_${s}`];
              if (!seat || !seat.extra_param) continue;
              const ep       = seat.extra_param;
              const seatKey  = `${cid}_${s}`;
              const pidx     = cid === 1 ? s : s + 5;

              if (!state.prevKillEventCounts[seatKey]) {
                // First poll for this seat — snapshot only, don't fire
                state.prevKillEventCounts[seatKey] = {};
                ALL_KILL_DEFS.forEach(d => { state.prevKillEventCounts[seatKey][d.key] = ep[d.key] || 0; });
                continue;
              }

              const prev = state.prevKillEventCounts[seatKey];

              // Multi-kills: broadcast each in ascending priority order
              for (const def of KILL_MULTI_DEFS) {
                if ((ep[def.key] || 0) > (prev[def.key] || 0)) {
                  broadcastKillEvent(def.video, def.priority, pidx, seat.name || null);
                }
              }

              // Objective kills: fire once per poll (first player found gets credit)
              for (const def of KILL_OBJ_DEFS) {
                if ((ep[def.key] || 0) > (prev[def.key] || 0) && !objFiredThisPoll.has(def.key)) {
                  objFiredThisPoll.add(def.key);
                  broadcastKillEvent(def.video, def.priority, pidx, seat.name || null);
                }
              }

              ALL_KILL_DEFS.forEach(d => { prev[d.key] = ep[d.key] || 0; });
            }
          }

          const totalKills = camps.reduce((a, c) => a + (c.score || 0), 0);
          const killJump   = totalKills - state.prevTotalKills;
          if (killJump >= 3) {
            console.log(`[EVENT] CLASH detected at ${game_time_fmt} (kill jump: +${killJump})`);
            snapshotClash(game_time_fmt, killJump);
          }
          state.prevTotalKills = totalKills;
        }

        if (apiState === "play") {
          for (const camp of camps) {
            if (camp.campid !== 1 && camp.campid !== 2) continue;
            for (let s = 1; s <= 5; s++) {
              const seat = camp[`seat_${s}`];
              if (!seat || !seat.map_pos) continue;
              state.positionLog.push({
                game_time_s,
                camp: camp.campid,
                seat: s,
                x: seat.map_pos.x,
                y: seat.map_pos.y,
              });
            }
          }
          if (state.positionLog.length > MAX_POS_LOG) state.positionLog.splice(0, state.positionLog.length - MAX_POS_LOG);
          if (++state.posWriteCounter % 60 === 0) savePositionsToDisk();
        }

        if (apiState === "play") tickFight(camps, game_time_s, game_time_fmt);

        if (apiState === "end" && state.gameState.state !== "end") savePositionsToDisk();

        if (apiState === "end" && state.hasSeenPlay && battleid && battleid !== state.lastWrittenBattleId) {
          console.log(`[POSTGAME] Writing postgame for battleid=${battleid}`);
          state.postgamePlayerNames = { ...state.playerNames };
          state.bpmOnEnd = {};
          for (const pid of Object.keys(players)) {
            const r = state.readings[pid];
            state.bpmOnEnd[pid] = r.bpm !== null ? r.bpm : r.last_bpm;
          }
          try {
            const payload = buildPostgamePayload(data);
            writePostgame(payload);
            state.lastWrittenBattleId = battleid;
          } catch (e) {
            console.error("[POSTGAME] Failed to write:", e.message);
          }
        } else if (apiState === "end" && !state.hasSeenPlay) {
          console.log(`[POSTGAME] Skipping — server started at "end", waiting for a live game first`);
        }
        // else if apiState === "end" && battleid === lastWrittenBattleId: already written, silent

      } catch (e) {
        console.error("[POLL] Parse error:", e.message);
      }
    });
  }).on("error", (e) => {
    console.warn("[POLL] Game API unreachable:", e.message);
  });
}

pollGameAPI._lastLoggedState = null;

// ── START POLLERS ─────────────────────────────────────────────────────────────
setInterval(pollGameAPI, POLL_MS);
setInterval(pollH2H, 5000);
setInterval(tickSimulation, POLL_MS);
pollGameAPI();
pollH2H(true);
tickSimulation();

module.exports = { httpGet, pollGameAPI, pollH2H };
