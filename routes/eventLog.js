// routes/eventLog.js — HTTP side of lib/eventLog.js (dashboard Logs tab +
// Control-tab scene status). See that file for the design.
const express  = require('express');
const eventLog = require('../lib/eventLog');
const state    = require('../lib/state');

const router = express.Router();

// Timeline of what was pressed and when: every /overlay/<key>/show|hide
// (dashboard buttons, vMix/Companion shortcuts, curl — all of them) gets a
// line, plus how many overlay pages were connected to receive it. Logged
// after the response is sent, so it never adds latency to the route itself.
const SHOW_HIDE_RE = /^\/overlay\/([a-z0-9_]+)\/(show|hide)$/i;
router.use((req, res, next) => {
  const m = SHOW_HIDE_RE.exec(req.path);
  if (!m) return next();
  const t0 = Date.now();
  res.on('finish', () => {
    const clients = (state.overlayClients || []).length;
    const ok = res.statusCode < 400;
    eventLog.add({
      level: !ok ? 'critical' : (clients === 0 ? 'warning' : 'success'),
      page: 'server', kind: 'server', scene: m[1],
      msg: (m[2].toLowerCase() === 'show' ? '▶ SHOW ' : '■ HIDE ') + m[1] +
        (!ok ? ' failed (HTTP ' + res.statusCode + ')'
             : clients === 0 ? ' sent, but no overlay page is connected to receive it'
             : ' sent'),
      ms: Date.now() - t0,
    });
  });
  next();
});

// Live-update connections. Every overlay page in a browser shares ONE
// /overlay/events connection (overlay-shared-worker.js), so each line here
// is effectively "a machine/browser (vMix, the control PC, …) connected or
// dropped". The actual handler stays in routes/overlay.js; this only observes.
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}
router.get('/overlay/events', (req, res, next) => {
  const from = String(req.socket.remoteAddress || '?').replace(/^::ffff:/, '');
  const t0 = Date.now();
  eventLog.add({
    level: 'success', page: 'server', kind: 'server',
    msg: 'Overlay browser connected from ' + from + ' (' + ((state.overlayClients || []).length + 1) + ' connected)',
  });
  req.on('close', () => setImmediate(() => {
    eventLog.add({
      level: 'warning', page: 'server', kind: 'server',
      msg: 'Overlay browser disconnected from ' + from + ' after ' + fmtDuration(Date.now() - t0) +
        ' (' + (state.overlayClients || []).length + ' still connected)',
    });
  }));
  next();
});

// Overlay pages report here in batches (html/js/event-log-client.js).
router.post('/api/event-log', (req, res) => {
  const list = Array.isArray((req.body || {}).entries) ? req.body.entries.slice(0, 50) : [];
  list.forEach(e => { if (e && typeof e === 'object' && e.msg) eventLog.add(e); });
  res.set('Cache-Control', 'no-store').json({ ok: true });
});

// Dashboard poll: entries newer than ?since=<id> plus the per-scene status.
router.get('/api/event-log', (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  res.set('Cache-Control', 'no-store').json({
    boot: eventLog.BOOT_ID,
    entries: eventLog.since(since, 500),
    status: eventLog.statusSummary(),
  });
});

router.get('/api/event-log/days', (req, res) => {
  eventLog.listDays(days => res.set('Cache-Control', 'no-store').json({ days }));
});

// Full day as plain text, same 🟢 [time - date] - text format as the tab.
router.get('/api/event-log/download', (req, res) => {
  const day = String(req.query.day || '');
  eventLog.readDay(day, list => {
    if (!list) return res.status(404).send('No log for ' + day);
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="overlay-events-' + day + '.txt"',
      'Cache-Control': 'no-store',
    }).send('﻿' + list.map(eventLog.formatLine).join('\n') + '\n');
  });
});

module.exports = router;
