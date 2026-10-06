// routes/bracket.js — Bracket scene (mplfs.html) show/hide + 3D pose bank.
//
// The scene is one 1920x1080 plane that can be tilted in 3D. A "pose" is
// { rx, ry, rz, scale, x, y, persp } (degrees / unitless scale / px).
// bracket_config.json holds:
//   base       — the original pose the scene fades in at
//   keyframes  — banked poses A, B, C... visited by pressing Show again
//   duration   — ms for each pose-to-pose transition
// Show while already live advances base -> A -> B -> C -> base (wraps).
// `step` (0 = base, 1..n = keyframes[step-1]) lives in memory only, and
// resets whenever the scene is hidden or freshly shown.
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const state   = require('../lib/state');

// Playoffs bracket match data (teams + scores) — entered in the Standings
// dashboard's Playoffs Bracket tab, read by the overlay. File holds
//   m        — raw controller state { [matchId]: { a, b, sa, sb } }
//   resolved — what the overlay draws: { [matchId]: { a, b, sa, sb } } with
//              a/b already resolved to tricodes ('' = TBD) so the overlay
//              never re-implements the winner/loser-of-match logic.
const DATA_FILE = path.join(__dirname, '..', 'bracket_data.json');
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return { m: {}, resolved: {} }; }
}
function dashboardPassword() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')).dashboard_password || ''; }
  catch (e) { return ''; }
}

const CONFIG_FILE = path.join(__dirname, '..', 'bracket_config.json');
const DEFAULT_POSE = { rx: 0, ry: 0, rz: 0, scale: 1, x: 0, y: 0, persp: 1500 };
const DEFAULT_CONFIG = { base: DEFAULT_POSE, keyframes: [], duration: 1200 };

let step = 0;
let livePose = null; // unsaved slider edits, null = nothing being edited

const num = (v, lo, hi, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};
function cleanPose(p) {
  p = p || {};
  return {
    rx:    num(p.rx, -180, 180, 0),
    ry:    num(p.ry, -180, 180, 0),
    rz:    num(p.rz, -180, 180, 0),
    scale: num(p.scale, 0.1, 5, 1),
    x:     num(p.x, -3000, 3000, 0),
    y:     num(p.y, -3000, 3000, 0),
    persp: num(p.persp, 200, 10000, 1500),
  };
}
function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      base: cleanPose(c.base),
      keyframes: Array.isArray(c.keyframes) ? c.keyframes.slice(0, 26).map(cleanPose) : [],
      duration: num(c.duration, 0, 10000, 1200),
    };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}
function poseForStep(cfg, s) {
  return s > 0 && cfg.keyframes[s - 1] ? cfg.keyframes[s - 1] : cfg.base;
}
function broadcast(payload) {
  const msg = 'event: bracket\ndata: ' + JSON.stringify(payload) + '\n\n';
  state.overlayClients.forEach(c => { try { c.write(msg); } catch {} });
}

router.get('/api/bracket-config', (req, res) => {
  const cfg = readConfig();
  if (step > cfg.keyframes.length) step = 0;
  res.set('Cache-Control', 'no-store').json({
    ...cfg,
    step,
    pose: livePose || poseForStep(cfg, step),
  });
});

router.get('/api/bracket-data', (req, res) => {
  res.set('Cache-Control', 'no-store').json(readData());
});

// POST { token, m, resolved } — same dashboard password as standings/match state.
router.post('/api/bracket-data', (req, res) => {
  const b = req.body || {};
  const pw = dashboardPassword();
  if (!b.token || b.token !== pw) return res.status(401).json({ ok: false });
  const clean = { m: b.m && typeof b.m === 'object' ? b.m : {}, resolved: b.resolved && typeof b.resolved === 'object' ? b.resolved : {} };
  fs.writeFileSync(DATA_FILE, JSON.stringify(clean, null, 2));
  broadcast({ action: 'data' });
  res.set('Cache-Control', 'no-store').json({ ok: true });
});

// POST { base?, keyframes?, duration? } — partial update of the saved bank.
router.post('/api/bracket-config', (req, res) => {
  const b = req.body || {};
  const cfg = readConfig();
  if (b.base) cfg.base = cleanPose(b.base);
  if (Array.isArray(b.keyframes)) cfg.keyframes = b.keyframes.slice(0, 26).map(cleanPose);
  if (b.duration !== undefined) cfg.duration = num(b.duration, 0, 10000, 1200);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  if (step > cfg.keyframes.length) step = 0;
  res.set('Cache-Control', 'no-store').json({ ok: true, ...cfg, step });
});

// POST { pose } — live slider edit. Not saved; just pushed to every client
// that currently has the Bracket scene up, with no transition.
router.post('/api/bracket-live', (req, res) => {
  livePose = cleanPose((req.body || {}).pose);
  broadcast({ action: 'pose', pose: livePose, duration: 0 });
  res.json({ ok: true });
});

// GET /overlay/bracket/goto/:n — jump straight to base (0) or a banked pose,
// animated. Used by the dashboard's per-position "Go" buttons.
router.get('/overlay/bracket/goto/:n', (req, res) => {
  const cfg = readConfig();
  const n = parseInt(req.params.n, 10);
  if (!(n >= 0 && n <= cfg.keyframes.length)) return res.status(400).json({ ok: false });
  step = n;
  livePose = null;
  broadcast({ action: 'pose', pose: poseForStep(cfg, step), duration: cfg.duration, step });
  res.set('Cache-Control', 'no-store').json({ ok: true, step });
});

// Show: fresh show fades in at base; Show again while live advances a step.
router.get('/overlay/bracket/show', (req, res) => {
  const cfg = readConfig();
  const advance = state.mplfsScene.activeFeature === 'bracket';
  state.mplfsScene.activeFeature = 'bracket';
  step = advance ? (step + 1) % (cfg.keyframes.length + 1) : 0;
  livePose = null;
  broadcast({ action: 'show', advance, step, pose: poseForStep(cfg, step), duration: cfg.duration });
  res.set('Cache-Control', 'no-store').json({ ok: true, action: 'show', step });
});

router.get('/overlay/bracket/hide', (req, res) => {
  state.mplfsScene.activeFeature = null;
  step = 0;
  livePose = null;
  broadcast({ action: 'hide' });
  res.set('Cache-Control', 'no-store').json({ ok: true, action: 'hide' });
});

module.exports = router;
