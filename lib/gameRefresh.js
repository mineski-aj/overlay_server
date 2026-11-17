// lib/gameRefresh.js — how often the Game (battledata) API is polled, in ms.
// Stored in data/game_refresh.json, edited from Settings -> "Game API Refresh Rate"
// (GET/POST /api/game-refresh). lib/pollers.js re-reads it before every poll, so a change
// applies on the very next tick; pages read it through html/js/game-refresh.js.
const fs   = require('fs');
const path = require('path');

const FILE    = path.join(__dirname, '..', 'data', 'game_refresh.json');
const DEFAULT_MS = 150;
const MIN_MS  = 50;
const MAX_MS  = 5000;

const clamp = (n) => Math.min(MAX_MS, Math.max(MIN_MS, Math.round(n)));

let cached = null, cachedAt = 0;
function getGameRefreshMs() {
  const now = Date.now();
  if (cached !== null && now - cachedAt < 500) return cached;   // pollers call this every tick
  let ms = DEFAULT_MS;
  try {
    const v = Number(JSON.parse(fs.readFileSync(FILE, 'utf8')).ms);
    if (isFinite(v) && v > 0) ms = clamp(v);
  } catch (e) { /* missing/corrupt file -> default */ }
  cached = ms; cachedAt = now;
  return ms;
}

function setGameRefreshMs(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) throw new Error('ms must be a positive number');
  const ms = clamp(n);
  fs.writeFileSync(FILE, JSON.stringify({ ms }));
  cached = ms; cachedAt = Date.now();
  return ms;
}

module.exports = { getGameRefreshMs, setGameRefreshMs, DEFAULT_MS, MIN_MS, MAX_MS };
