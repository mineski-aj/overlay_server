// lib/state.js — all mutable state, initialized from config
const { players, CAMP_MAP } = require('./config');

function freshPlayerStats() {
  const s = {};
  for (const pid of Object.keys(players)) {
    s[pid] = {
      bpm_samples:           [],
      ticks_above_120:       0,
      ticks_total:           0,
      objective_bpm_samples: [],
    };
  }
  return s;
}

// Initialize readings from players
const readings = {};
for (const [pid, info] of Object.entries(players)) {
  readings[pid] = { ...info, bpm: null, last_bpm: null, simulated_bpm: null, status: "disconnected", last_seen: null };
}

const state = {
  readings,
  gameState: { state: "unknown", battleid: null, game_time_s: 0, game_time_fmt: "00:00", paused: false },
  campSwapped: false,
  activeCampMap: { camp1: [...CAMP_MAP.camp1], camp2: [...CAMP_MAP.camp2] },
  campTricodes: { camp1: null, camp2: null },
  log: [],
  playerNames: {},
  postgamePlayerNames: {},
  bpmOnEnd: {},
  stats: freshPlayerStats(),
  prevKillLord: 0, prevKillTurtle: 0,
  clashSnapshots: [], prevTotalKills: 0,
  activeFight: null, fightLog: [], fightIdSeq: 0, lastPlayerSnap: {},
  prevSeatKDA: {}, itemLog: {}, prevItemCounts: {},
  prevC1Lord: 0, prevC2Lord: 0, prevC1Turtle: 0, prevC2Turtle: 0,
  gameEvents: [], positionLog: [], posWriteCounter: 0,
  overlayClients: [], fightsPendingAction: null,
  mplfsScene: { matchboard: false, middleboard: false, playerboard: false, activeFeature: null },
  featureToggles: {
    scoreboard: true,
    killevents: true,
    items:      true,
    trinity:    true,
    swap:       true,
    lvl15:      true,
    conceal:    true,
    fights:     true,
  },
  prevKillEventCounts: {},
  draftRoles: { battleid: null, roles: {} },
  currentBattleId: null, gameStartTime: null,
  lastWrittenBattleId: null, hasSeenPlay: false,
  freshPlayerStats,
};

module.exports = state;
