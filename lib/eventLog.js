// lib/eventLog.js — the event log behind the dashboard's Logs tab and the
// Control tab's per-scene load status (🟢 loaded / 🟡 warnings / 🔴 failed).
//
// Entries come from two places:
//   - overlay pages, via html/js/event-log-client.js → POST /api/event-log
//     (scene load verdicts, failed/slow fetches, broken images, JS errors)
//   - the server itself (upstream API pollers going down/slow/recovering,
//     show/hide routes being hit) via add()/health() below
//
// Designed to cost the live show nothing: everything is in-memory, the disk
// write is batched + async (never blocks a request), and nothing here is
// ever awaited by a route that serves an overlay.

const fs   = require('fs');
const path = require('path');

const LOG_DIR       = process.env.EVENT_LOG_DIR || path.join(__dirname, '..', 'logs');
const MAX_ENTRIES   = 2000;              // in-memory ring buffer
const MAX_FILE_BYTES = 50 * 1024 * 1024; // per day; stop appending past this
const FLUSH_MS      = 2000;
const LEVELS        = ['success', 'warning', 'critical'];
const LEVEL_RANK    = { success: 0, warning: 1, critical: 2 };

// Changes every server start, so the dashboard can tell "ids reset because
// the server restarted" apart from "no new entries".
const BOOT_ID = Date.now().toString(36);

let nextId = 1;
const entries = [];
// status['mplfs:post_hearts']['live:ab12'] = latest verdict entry
const status = {};

let pendingLines = [];
let flushTimer = null;
const fileBytes = {}; // day -> bytes written (seeded from disk on first write)

function str(v, max) {
  if (v == null) return '';
  v = String(v);
  return v.length > max ? v.slice(0, max) + '…' : v;
}

function dayOf(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function add(raw) {
  const e = {
    id:       nextId++,
    ts:       Number.isFinite(raw.ts) ? raw.ts : Date.now(),
    level:    LEVELS.includes(raw.level) ? raw.level : 'warning',
    msg:      str(raw.msg, 400),
    page:     str(raw.page || 'server', 40),
    kind:     str(raw.kind || '', 20),        // live | preview | embedded | server
    instance: str(raw.instance || '', 12),
    scene:    str(raw.scene || '', 60),
    ms:       Number.isFinite(raw.ms) ? Math.round(raw.ms) : undefined,
    detail:   str(raw.detail || '', 1000),
    count:    Number.isFinite(raw.count) && raw.count > 1 ? raw.count : undefined,
    verdict:  raw.verdict === true || undefined,
  };
  // Server-side clock is authoritative for ordering; keep the client's own
  // timestamp only if it's sane (within a minute), else a page with a
  // wrong clock would scramble the timeline.
  if (Math.abs(e.ts - Date.now()) > 60000) e.ts = Date.now();

  entries.push(e);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  if (e.verdict && e.scene) {
    const key = e.page + ':' + e.scene;
    (status[key] = status[key] || {})[e.kind + ':' + e.instance] = e;
  }

  pendingLines.push(e);
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  return e;
}

function flush() {
  flushTimer = null;
  const batch = pendingLines;
  pendingLines = [];
  if (!batch.length) return;
  const byDay = {};
  batch.forEach(e => { (byDay[dayOf(e.ts)] = byDay[dayOf(e.ts)] || []).push(JSON.stringify(e)); });
  fs.mkdir(LOG_DIR, { recursive: true }, (err) => {
    if (err) return;
    Object.keys(byDay).forEach(day => {
      const file = path.join(LOG_DIR, 'events-' + day + '.jsonl');
      const text = byDay[day].join('\n') + '\n';
      const write = () => {
        if (fileBytes[day] > MAX_FILE_BYTES) return;
        fileBytes[day] += Buffer.byteLength(text);
        fs.appendFile(file, text, () => {});
      };
      if (fileBytes[day] !== undefined) return write();
      fs.stat(file, (e2, st) => { fileBytes[day] = e2 ? 0 : st.size; write(); });
    });
  });
}

function since(id, limit) {
  const out = [];
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    if (entries[i].id <= id) break;
    out.push(entries[i]);
  }
  return out.reverse();
}

// One summary per scene for the Control tab: the most recent verdict from a
// real (non-preview) instance, worsened by any other live instance that
// reported on that same show within 10s of it (vMix and a browser tab both
// showing the same scene — if either failed, the pill says so). Preview
// instances are summarised separately so a preview click never looks like
// the real broadcast.
function statusSummary() {
  const out = {};
  Object.keys(status).forEach(key => {
    const all = Object.values(status[key]);
    const pick = (list) => {
      if (!list.length) return null;
      const latest = list.reduce((a, b) => (b.ts > a.ts ? b : a));
      const near = list.filter(x => latest.ts - x.ts < 10000);
      const worst = near.reduce((a, b) => (LEVEL_RANK[b.level] > LEVEL_RANK[a.level] ? b : a));
      return { level: worst.level, msg: worst.msg, ts: latest.ts, ms: worst.ms, instances: near.length };
    };
    out[key] = {
      live:    pick(all.filter(x => x.kind === 'live')),
      preview: pick(all.filter(x => x.kind !== 'live')),
    };
  });
  return out;
}

// Server-side upstream health: logs only on state CHANGES (ok → down,
// down → ok, ok → slow …), never on every poll tick, and needs a couple of
// consecutive bad ticks first so a single blip isn't reported as an outage.
const healthState = {};
const DOWN_AFTER = 2, SLOW_AFTER = 3;
// opts.quietStart: don't log the first "ok" (for checks where "connected"
// means nothing, e.g. our own data processing succeeding).
function health(key, label, result, info, opts) {
  opts = opts || {};
  const h = healthState[key] = healthState[key] || { state: null, bad: 0, slow: 0, since: Date.now() };
  let next = result;
  if (result === 'down') { h.bad++; h.slow = 0; if (h.bad < DOWN_AFTER) return; }
  else if (result === 'slow') { h.slow++; h.bad = 0; if (h.slow < SLOW_AFTER) return; }
  else { h.bad = 0; h.slow = 0; }
  if (next === h.state) return;
  const prev = h.state;
  const downFor = Math.round((Date.now() - h.since) / 1000);
  h.state = next;
  h.since = Date.now();
  if (next === 'down') {
    add({ level: 'critical', page: 'server', kind: 'server', msg: label + (opts.quietStart ? ' failing — ' : ' unreachable — ') + (info || 'no response') });
  } else if (next === 'slow') {
    add({ level: 'warning', page: 'server', kind: 'server', msg: label + ' is slow (' + info + ')' });
  } else if (prev === 'down' || prev === 'slow') {
    add({ level: 'success', page: 'server', kind: 'server', msg: label + ' recovered after ' + downFor + 's' + (prev === 'slow' ? ' of slowness' : ' down') });
  } else if (prev === null && !opts.quietStart) {
    add({ level: 'success', page: 'server', kind: 'server', msg: label + ' connected' });
  }
}

function listDays(cb) {
  fs.readdir(LOG_DIR, (err, files) => {
    if (err) return cb([]);
    cb(files.map(f => (/^events-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f) || [])[1]).filter(Boolean).sort().reverse());
  });
}

function readDay(day, cb) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return cb(null);
  fs.readFile(path.join(LOG_DIR, 'events-' + day + '.jsonl'), 'utf8', (err, text) => {
    if (err) return cb(null);
    const list = [];
    text.split('\n').forEach(line => { if (line) { try { list.push(JSON.parse(line)); } catch {} } });
    cb(list);
  });
}

const EMOJI = { success: '🟢', warning: '🟡', critical: '🔴' };
// Same line format the dashboard renders:  🟢 [14:32:05 - 2026-10-09] - text
function formatLine(e) {
  const d = new Date(e.ts);
  const time = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
  const src = e.page === 'server' ? 'Server' : e.page + (e.kind ? ' (' + e.kind + ')' : '');
  return EMOJI[e.level] + ' [' + time + ' - ' + dayOf(e.ts) + '] - ' + src + ' · ' + e.msg +
    (e.count ? ' (×' + e.count + ')' : '') + (e.detail ? '\n      ' + e.detail.replace(/\n/g, '\n      ') : '');
}

module.exports = { add, health, since, statusSummary, listDays, readDay, formatLine, BOOT_ID };
