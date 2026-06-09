// lib/matchState.js — match state, persisted to match_state.json
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'match_state.json');

const DEFAULT = {
  teamA:   { name: 'Team A', short: 'TMA', score: 0 },
  teamB:   { name: 'Team B', short: 'TMB', score: 0 },
  series:  'BO5',
  game:    1,
  blueTeam: 'A',
};

let current = DEFAULT;

if (fs.existsSync(FILE)) {
  try { current = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { console.warn('[match] Could not parse match_state.json, using defaults'); }
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
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) &&
        base[k]  && typeof base[k]  === 'object') {
      out[k] = Object.assign({}, base[k], patch[k]);
    } else {
      out[k] = patch[k];
    }
  }
  return out;
}

module.exports = { get, set, addClient, removeClient };
