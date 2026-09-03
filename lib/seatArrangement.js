// lib/seatArrangement.js — per-camp seat_1..seat_5 display-order override.
//
// Deliberately NOT applied server-side (unlike the sibling project this was
// ported from, which patches /api/gamedata-proxy for every consumer). Here
// it's scoped narrowly to a handful of mploverlay_v7.html features (Player
// UI, Item Pickup, Trinity, Quick Swap, Level 15) via a client-side resolver
// (getPlayerArranged() in overlay-core.js) — everything else (Scoreboard,
// Item Check, Emblem Check, Gold Diff/Graph Check, the side-checks, Match
// Board, Kill Events, Objective Spawn) keeps reading seats exactly as the
// API sends them. That's why this file only needs read/write/validate, not
// a payload-remapping helper.
const fs   = require('fs');
const path = require('path');

const SEAT_ARRANGEMENT_FILE = path.join(__dirname, '..', 'seat_arrangement.json');
const IDENTITY = [1, 2, 3, 4, 5];
const DEFAULT_ARRANGEMENT = { camp1: IDENTITY.slice(), camp2: IDENTITY.slice() };

function isValidPerm(perm) {
  return Array.isArray(perm) && perm.length === 5 &&
    IDENTITY.every((n) => perm.includes(n)) &&
    perm.every((n) => IDENTITY.includes(n));
}

// Sanitizes anything read from disk (or posted by the dashboard) back to a
// guaranteed-valid { camp1, camp2 } shape — a malformed/hand-edited file
// falls back to identity per-camp rather than ever producing an undefined
// seat downstream.
function sanitize(raw) {
  const camp1 = raw && isValidPerm(raw.camp1) ? raw.camp1 : IDENTITY.slice();
  const camp2 = raw && isValidPerm(raw.camp2) ? raw.camp2 : IDENTITY.slice();
  return { camp1, camp2 };
}

function readArrangement() {
  try {
    return sanitize(JSON.parse(fs.readFileSync(SEAT_ARRANGEMENT_FILE, 'utf8')));
  } catch (e) {
    return { camp1: IDENTITY.slice(), camp2: IDENTITY.slice() };
  }
}

function writeArrangement(arrangement) {
  const clean = sanitize(arrangement);
  fs.writeFileSync(SEAT_ARRANGEMENT_FILE, JSON.stringify(clean));
  return clean;
}

module.exports = {
  DEFAULT_ARRANGEMENT,
  readArrangement,
  writeArrangement,
  isValidPerm,
};
