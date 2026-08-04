// routes/overlay.js — SSE + all /overlay/* + /meter/*
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const state   = require('../lib/state');

// Local state for draftpredict commands
const _draftpredictCmds = [];

// GET /api/player-photos — basenames with both FRONT and VICTORY photos available
const PHOTOS_DIR = path.join(__dirname, '..', 'photos');
let _playerPhotoNames = null;
router.get('/api/player-photos', (req, res) => {
  if (!_playerPhotoNames) {
    try {
      const front = fs.readdirSync(path.join(PHOTOS_DIR, 'FRONT'))
        .filter(f => f.endsWith('_FRONT_resized.png'))
        .map(f => f.slice(0, -'_FRONT_resized.png'.length));
      const victorySet = new Set(
        fs.readdirSync(path.join(PHOTOS_DIR, 'VICTORY'))
          .filter(f => f.endsWith('_VICTORY_resized.png'))
          .map(f => f.slice(0, -'_VICTORY_resized.png'.length))
      );
      _playerPhotoNames = front.filter(n => victorySet.has(n));
    } catch (e) {
      _playerPhotoNames = [];
    }
  }
  res.set({ 'Cache-Control': 'no-store' }).json({ names: _playerPhotoNames });
});

// GET /overlay/draft-photo-mode — current player-photo source ('live' | 'random')
router.get('/overlay/draft-photo-mode', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json({ mode: state.draftPhotoMode });
});

// GET /overlay/draft-photo-mode/:mode — set mode, broadcast to connected overlays
router.get('/overlay/draft-photo-mode/:mode', (req, res) => {
  const mode = req.params.mode;
  if (mode !== 'live' && mode !== 'random') {
    return res.status(400).json({ ok: false, error: 'unknown mode' });
  }
  state.draftPhotoMode = mode;
  const payload = JSON.stringify({ mode });
  state.overlayClients.forEach(c => { try { c.write(`event: draftphotomode\ndata: ${payload}\n\n`); } catch {} });
  res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, mode });
});

// SSE heartbeat
setInterval(() => {
  state.overlayClients.forEach(c => { try { c.write(': heartbeat\n\n'); } catch {} });
}, 15000);

// GET /overlay/events — SSE stream
router.get('/overlay/events', (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.writeHead(200);
  res.write(': connected\n\n');
  state.overlayClients.push(res);
  req.on("close", () => {
    const i = state.overlayClients.indexOf(res);
    if (i !== -1) state.overlayClients.splice(i, 1);
  });
});

// GET /meter/show|hide|plus|minus|clear
router.get('/meter/:cmd', (req, res) => {
  const cmd = req.params.cmd;
  if (["show", "hide", "plus", "minus", "clear"].includes(cmd)) {
    state.overlayClients.forEach(c => { try { c.write(`event: meter\ndata: {"cmd":"${cmd}"}\n\n`); } catch {} });
    res.set({ "Cache-Control": "no-store" }).json({ ok: true, cmd });
  } else {
    res.status(404).json({ error: "unknown meter command" });
  }
});

// GET /api/draft-roles — returns server-locked player→role assignments for current battleid
router.get('/api/draft-roles', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json(state.draftRoles);
});

// GET /overlay/fights/show
router.get('/overlay/fights/show', (req, res) => {
  state.fightsPendingAction = { action: "show", ts: Date.now() };
  state.overlayClients.forEach(c => { try { c.write('event: fights\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/fights/hide
router.get('/overlay/fights/hide', (req, res) => {
  state.fightsPendingAction = { action: "hide", ts: Date.now() };
  state.overlayClients.forEach(c => { try { c.write('event: fights\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/fights/pending
router.get('/overlay/fights/pending', (req, res) => {
  const p = state.fightsPendingAction;
  state.fightsPendingAction = null;
  res.set({ "Cache-Control": "no-store" }).json(p || { action: null });
});

// GET /overlay/post_hearts/show
router.get('/overlay/post_hearts/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.middleboard = true;
  state.mplfsScene.playerboard = true;
  state.mplfsScene.activeFeature = 'hearts';
  state.overlayClients.forEach(c => {
    try {
      c.write('event: matchboard\ndata: {"action":"show"}\n\n');
      c.write('event: middleboard\ndata: {"action":"show"}\n\n');
      c.write('event: playerboard\ndata: {"action":"show"}\n\n');
      c.write('event: post_hearts\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_hearts/hide
router.get('/overlay/post_hearts/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_hearts\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_richguy/show
router.get('/overlay/post_richguy/show', (req, res) => {
  state.mplfsScene.activeFeature = 'richguy';
  state.overlayClients.forEach(c => { try { c.write('event: post_richguy\ndata: {"action":"show","data":{}}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_richguy/hide
router.get('/overlay/post_richguy/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_richguy\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/waiting_tvc/show
router.get('/overlay/waiting_tvc/show', (req, res) => {
  state.mplfsScene.activeFeature = 'waiting';
  state.overlayClients.forEach(c => { try { c.write('event: waiting_tvc\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/waiting_tvc/hide
router.get('/overlay/waiting_tvc/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: waiting_tvc\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/waiting_lobby/show
router.get('/overlay/waiting_lobby/show', (req, res) => {
  state.mplfsScene.activeFeature = 'lobby';
  state.overlayClients.forEach(c => { try { c.write('event: waiting_lobby\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/waiting_lobby/hide
router.get('/overlay/waiting_lobby/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: waiting_lobby\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/today_schedule/show
router.get('/overlay/today_schedule/show', (req, res) => {
  state.mplfsScene.activeFeature = 'schedule';
  state.overlayClients.forEach(c => { try { c.write('event: today_schedule\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/today_schedule/hide
router.get('/overlay/today_schedule/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: today_schedule\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/standings/show
router.get('/overlay/standings/show', (req, res) => {
  state.mplfsScene.activeFeature = 'standings';
  state.overlayClients.forEach(c => { try { c.write('event: standings\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/standings/hide
router.get('/overlay/standings/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: standings\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/fs/debugoff
router.get('/overlay/fs/debugoff', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: fs_debugoff\ndata: {}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true });
});

// GET /overlay/matchboard/show
router.get('/overlay/matchboard/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.overlayClients.forEach(c => { try { c.write('event: matchboard\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/matchboard/hide
router.get('/overlay/matchboard/hide', (req, res) => {
  state.mplfsScene.matchboard = false;
  state.overlayClients.forEach(c => { try { c.write('event: matchboard\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/playerboard/show
router.get('/overlay/playerboard/show', (req, res) => {
  state.mplfsScene.playerboard = true;
  state.overlayClients.forEach(c => { try { c.write('event: playerboard\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/playerboard/hide
router.get('/overlay/playerboard/hide', (req, res) => {
  state.mplfsScene.playerboard = false;
  state.overlayClients.forEach(c => { try { c.write('event: playerboard\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/middleboard/show
router.get('/overlay/middleboard/show', (req, res) => {
  state.mplfsScene.middleboard = true;
  state.overlayClients.forEach(c => { try { c.write('event: middleboard\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/middleboard/hide
router.get('/overlay/middleboard/hide', (req, res) => {
  state.mplfsScene.middleboard = false;
  state.overlayClients.forEach(c => { try { c.write('event: middleboard\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/fs/hide
router.get('/overlay/fs/hide', (req, res) => {
  state.mplfsScene = { matchboard: false, middleboard: false, playerboard: false, activeFeature: null };
  state.overlayClients.forEach(c => {
    try {
      c.write('event: matchboard\ndata: {"action":"hide"}\n\n');
      c.write('event: middleboard\ndata: {"action":"hide"}\n\n');
      c.write('event: playerboard\ndata: {"action":"hide"}\n\n');
      c.write('event: fs_hide\ndata: {}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true });
});

// GET /overlay/mplfs-scene — current mplfs display state for restore-on-load
router.get('/overlay/mplfs-scene', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json(state.mplfsScene);
});

// GET /overlay/post_itemline/itemin
router.get('/overlay/post_itemline/itemin', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: post_itemline_itemin\ndata: {}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true });
});

// GET /overlay/post_itemline/itemout
router.get('/overlay/post_itemline/itemout', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: post_itemline_itemout\ndata: {}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true });
});

// GET /overlay/post_itemline/show
router.get('/overlay/post_itemline/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.activeFeature = 'itemline';
  state.overlayClients.forEach(c => {
    try {
      c.write('event: matchboard\ndata: {"action":"show"}\n\n');
      c.write('event: post_itemline\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_itemline/hide
router.get('/overlay/post_itemline/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_itemline\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_emblems/show
router.get('/overlay/post_emblems/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.middleboard = true;
  state.mplfsScene.playerboard = true;
  state.mplfsScene.activeFeature = 'emblems';
  state.overlayClients.forEach(c => {
    try {
      c.write('event: matchboard\ndata: {"action":"show"}\n\n');
      c.write('event: middleboard\ndata: {"action":"show"}\n\n');
      c.write('event: playerboard\ndata: {"action":"show"}\n\n');
      c.write('event: post_emblems\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_emblems/hide
router.get('/overlay/post_emblems/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_emblems\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_items/show
router.get('/overlay/post_items/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.middleboard = true;
  state.mplfsScene.playerboard = true;
  state.mplfsScene.activeFeature = 'items';
  state.overlayClients.forEach(c => {
    try {
      c.write('event: matchboard\ndata: {"action":"show"}\n\n');
      c.write('event: middleboard\ndata: {"action":"show"}\n\n');
      c.write('event: playerboard\ndata: {"action":"show"}\n\n');
      c.write('event: post_items\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_items/hide
router.get('/overlay/post_items/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_items\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/post_stats/show
router.get('/overlay/post_stats/show', (req, res) => {
  state.mplfsScene.matchboard = true;
  state.mplfsScene.middleboard = true;
  state.mplfsScene.playerboard = true;
  state.mplfsScene.activeFeature = 'stats';
  state.overlayClients.forEach(c => {
    try {
      c.write('event: matchboard\ndata: {"action":"show"}\n\n');
      c.write('event: middleboard\ndata: {"action":"show"}\n\n');
      c.write('event: playerboard\ndata: {"action":"show"}\n\n');
      c.write('event: post_stats\ndata: {"action":"show"}\n\n');
    } catch {}
  });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "show" });
});

// GET /overlay/post_stats/hide
router.get('/overlay/post_stats/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  state.overlayClients.forEach(c => { try { c.write('event: post_stats\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: "hide" });
});

// GET /overlay/draftpredict/show|hide|poll
router.get('/overlay/draftpredict/:cmd', (req, res) => {
  const cmd = req.params.cmd;
  res.set({ "Cache-Control": "no-store" });
  if (cmd === "show" || cmd === "hide") {
    _draftpredictCmds.push(cmd);
    state.overlayClients.forEach(c => { try { c.write(`event: draftpredict\ndata: {"cmd":"${cmd}"}\n\n`); } catch {} });
    res.json({ ok: true });
  } else if (cmd === "poll") {
    const cmds = _draftpredictCmds.splice(0);
    res.json({ commands: cmds });
  } else {
    res.status(404).json({});
  }
});

// GET /overlay/debugoff — hide debug bars on all overlays
router.get('/overlay/debugoff', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: debugoff\ndata: {}\n\n'); } catch {} });
  res.set({ 'Cache-Control': 'no-store' }).json({ ok: true });
});

// GET /overlay/features — return current feature toggle states
router.get('/overlay/features', (req, res) => {
  res.set({ 'Cache-Control': 'no-store' }).json(state.featureToggles);
});

// GET /overlay/feature/:feature/enable|disable
const VALID_FEATURES = ['scoreboard','killevents','items','trinity','swap','lvl15','conceal','fights','debugphotos'];
router.get('/overlay/feature/:feature/:action', (req, res) => {
  const { feature, action } = req.params;
  if (!VALID_FEATURES.includes(feature) || !['enable','disable'].includes(action)) {
    return res.status(400).json({ ok: false, error: 'unknown feature or action' });
  }
  const enabled = action === 'enable';
  state.featureToggles[feature] = enabled;
  const payload = JSON.stringify({ feature, enabled });
  state.overlayClients.forEach(c => { try { c.write(`event: featuretoggle\ndata: ${payload}\n\n`); } catch {} });
  res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, feature, enabled });
});

// GET /overlay/killevent — broadcast a kill event video to all overlays
const KILL_EVENT_PRIORITIES = {
  'firstblood.webm': 1, 'doublekill.webm': 2, 'triplekill.webm': 3,
  'maniac.webm': 4, 'savage.webm': 5,
  'lordslain.webm': 1, 'turtleslain.webm': 1, 'wipedout.webm': 3,
};
router.get('/overlay/killevent', (req, res) => {
  const video = req.query.video;
  if (!video || !KILL_EVENT_PRIORITIES[video]) {
    return res.status(400).json({ ok: false, error: 'unknown video' });
  }
  const priority = KILL_EVENT_PRIORITIES[video];
  const payload = JSON.stringify({ video, priority, playerIdx: null, playerName: null });
  state.overlayClients.forEach(c => { try { c.write(`event: killevent\ndata: ${payload}\n\n`); } catch {} });
  res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, video });
});

// GET/POST /overlay/:slot — generic show/hide slot handler (must be LAST)
router.all('/overlay/:slot', (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const slot = req.params.slot.replace(/\/+$/, '');
  if (slot === "hide") {
    state.overlayClients.forEach(c => { try { c.write('event: hide\ndata: {}\n\n'); } catch {} });
  } else {
    const msg = `event: show\ndata: ${JSON.stringify({ slot })}\n\n`;
    state.overlayClients.forEach(c => { try { c.write(msg); } catch {} });
  }
  res.set({ "Cache-Control": "no-store" }).json({ ok: true, action: slot === "hide" ? "hide" : "show", slot });
});

module.exports = router;
