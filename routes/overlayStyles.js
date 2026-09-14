// routes/overlayStyles.js — GET/POST /api/overlay-styles
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const state   = require('../lib/state');
const { getTheme } = require('../lib/theme');

const STYLES_FILE = path.join(__dirname, '..', 'overlay_styles.json');

function load() {
  try { return JSON.parse(fs.readFileSync(STYLES_FILE, 'utf8')); }
  catch (e) { return {}; }
}

// Theme-scoped storage key for a given Edit config file. Regular theme
// keeps using the plain `file` bucket exactly as before this existed —
// full backward compatibility, nothing changes for anyone who never
// touches the Settings page's theme picker. A non-Regular theme gets its
// OWN bucket (`file::theme`), layered on top of the base bucket per
// selector, so an Edit-tab drag/resize made while 10th Anniversary (or
// Playoffs) is active never leaks into — or gets clobbered by — Regular's
// positions, and vice versa. See CLAUDE.md's "Theme system" section:
// "any change made in the dashboard's Edit tab only applies to the
// currently active theme."
function themedKey(file, theme) {
  return theme === 'regular' ? file : file + '::' + theme;
}

// Per-selector merge: a selector customized under the active theme wins
// outright (its whole {left,top,width,height,fontSize} box, not a
// property-by-property blend — Edit-tab saves always write a selector's
// complete box together); anything NOT customized under this theme falls
// back to Regular's value, so an element nobody has touched yet still
// shows up at its normal position instead of disappearing.
function mergedStyles(file, theme) {
  var base = load()[file] || {};
  if (theme === 'regular') return base;
  var themed = load()[themedKey(file, theme)] || {};
  return Object.assign({}, base, themed);
}

router.get('/api/overlay-styles', function (req, res) {
  var file = req.query.file || '';
  res.json(mergedStyles(file, getTheme()));
});

router.post('/api/overlay-styles', function (req, res) {
  var body   = req.body || {};
  var file   = body.file;
  var styles = body.styles;
  if (!file || !styles) return res.status(400).json({ error: 'missing file or styles' });
  var all = load();
  all[themedKey(file, getTheme())] = styles;
  fs.writeFileSync(STYLES_FILE, JSON.stringify(all, null, 2));
  /* Force every open overlay scene (mplfs.html, mploverlay_v7.html,
     Draft.html, DraftIndex.html, ENTVC.html — anywhere the html is
     loaded) to hard-reload so this save's position/size overrides take
     effect immediately, instead of waiting for a manual refresh. Safe
     to do unattended: edits are never made while a scene is live. */
  state.overlayClients.forEach(function (c) { try { c.write('event: reload\ndata: {}\n\n'); } catch (e) {} });
  res.json({ ok: true });
});

// POST /api/overlay-nudge — targeted single-selector position patch used by
// the dashboard Control tab's quick nudge buttons (MVP Scene/Highlights
// photo+hero repositioning). Persists the same way the Edit tab's Save
// does, but broadcasts a lightweight 'stylepatch' event instead of
// 'reload' — mplfs.html applies it live via CSS injection with no page
// reload, since the primary feedback loop here is the dashboard's own
// live preview iframe and a reload-triggered flash on every click would
// defeat the point of a quick nudge button.
router.post('/api/overlay-nudge', function (req, res) {
  var body     = req.body || {};
  var file     = body.file;
  var selector = body.selector;
  var props    = body.props;
  if (!file || !selector || !props) return res.status(400).json({ error: 'missing file, selector, or props' });
  var theme = getTheme();
  var key   = themedKey(file, theme);
  var all   = load();
  if (!all[key]) all[key] = {};
  if (!all[key][selector]) {
    // Nudges are relative (+/- a few px) — seed a brand-new themed entry
    // from Regular's current value so the first nudge under a non-Regular
    // theme adjusts from the visible position instead of from {}.
    all[key][selector] = Object.assign({}, (all[file] && all[file][selector]) || {});
  }
  Object.assign(all[key][selector], props);
  fs.writeFileSync(STYLES_FILE, JSON.stringify(all, null, 2));
  var payload = JSON.stringify({ file: file, selector: selector, props: props });
  state.overlayClients.forEach(function (c) { try { c.write('event: stylepatch\ndata: ' + payload + '\n\n'); } catch (e) {} });
  res.json({ ok: true });
});

module.exports = router;
