// lib/matchState.js — match state, persisted to match_state.json
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'match_state.json');

const DEFAULT = {
  home:     { teamId: '', name: 'Home Team', short: 'HME', score: 0, lineup: [] },
  away:     { teamId: '', name: 'Away Team', short: 'AWY', score: 0, lineup: [] },
  series:   'BO5',
  game:     1,
  match:    1,
  swapped:  false,
  official: false,
  week:     1,
  day:      1,
  patch:    'Decisive Battle 420',
  hosts:    ['None', 'None', 'None'],
  casters:  ['None', 'None', 'None'],
  countdownLabel: 'SHOW STARTS IN',
  countdownLabelAuto: true,
  goodbyeLabel:   'SEE YOU TOMORROW',
  todayMatches: [
    { team1Id: '', team1Name: '', team1Short: '', team2Id: '', team2Name: '', team2Short: '', score1: 0, score2: 0, vsDisplay: 'VS', time: '2:30 PM' },
    { team1Id: '', team1Name: '', team1Short: '', team2Id: '', team2Name: '', team2Short: '', score1: 0, score2: 0, vsDisplay: 'VS', time: '5:00 PM' },
    { team1Id: '', team1Name: '', team1Short: '', team2Id: '', team2Name: '', team2Short: '', score1: 0, score2: 0, vsDisplay: 'VS', time: '7:30 PM' },
  ],
  tomorrowMatches: [
    { team1Id: '', team1Name: '', team1Short: '', team2Id: '', team2Name: '', team2Short: '', vsDisplay: 'VS', time: '2:30 PM' },
    { team1Id: '', team1Name: '', team1Short: '', team2Id: '', team2Name: '', team2Short: '', vsDisplay: 'VS', time: '5:00 PM' },
    { team1Id: '', team1Name: '', team1Short: '', team2Id: '', team2Name: '', team2Short: '', vsDisplay: 'VS', time: '7:30 PM' },
  ],
};

let current = Object.assign({}, DEFAULT);

if (fs.existsSync(FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    // Migrate old teamA/teamB/blueTeam format
    if (loaded.teamA && !loaded.home) {
      current = {
        home:    Object.assign({ teamId: '', lineup: [] }, loaded.teamA),
        away:    Object.assign({ teamId: '', lineup: [] }, loaded.teamB || { name: 'Away Team', short: 'AWY', score: 0 }),
        series:  loaded.series  || DEFAULT.series,
        game:    loaded.game    || DEFAULT.game,
        swapped: loaded.blueTeam === 'B',
      };
    } else {
      current = loaded;
    }
    // Fill in any fields added to DEFAULT that aren't in the saved file
    for (const k of Object.keys(DEFAULT)) {
      if (!(k in current)) current[k] = DEFAULT[k];
    }
  } catch (e) {
    console.warn('[match] Could not parse match_state.json, using defaults');
  }
}

const sseClients = [];

function get() { return current; }

function set(patch) {
  current = deepMerge(current, patch);
  try { fs.writeFileSync(FILE, JSON.stringify(current, null, 2)); }
  catch (e) { console.warn('[match] Could not write match_state.json'); }
  broadcast();
}

function addClient(res) {
  sseClients.push(res);
  res.write(`data: ${JSON.stringify(current)}\n\n`);
}

function removeClient(res) {
  const i = sseClients.indexOf(res);
  if (i !== -1) sseClients.splice(i, 1);
}

function broadcast() {
  const msg = `data: ${JSON.stringify(current)}\n\n`;
  sseClients.forEach(c => c.write(msg));
}

function deepMerge(base, patch) {
  const out = Object.assign({}, base);
  for (const k of Object.keys(patch)) {
    if (patch[k] !== null && typeof patch[k] === 'object' && !Array.isArray(patch[k]) &&
        base[k]  !== null && typeof base[k]  === 'object') {
      out[k] = Object.assign({}, base[k], patch[k]);
    } else {
      out[k] = patch[k];
    }
  }
  return out;
}

module.exports = { get, set, addClient, removeClient };
