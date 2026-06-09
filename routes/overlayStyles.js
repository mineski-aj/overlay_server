// routes/overlayStyles.js — GET/POST /api/overlay-styles
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

const STYLES_FILE = path.join(__dirname, '..', 'overlay_styles.json');

function load() {
  try { return JSON.parse(fs.readFileSync(STYLES_FILE, 'utf8')); }
  catch (e) { return {}; }
}

router.get('/api/overlay-styles', function (req, res) {
  var file   = req.query.file || '';
  var styles = load();
  res.json(styles[file] || {});
});

router.post('/api/overlay-styles', function (req, res) {
  var body   = req.body || {};
  var file   = body.file;
  var styles = body.styles;
  if (!file || !styles) return res.status(400).json({ error: 'missing file or styles' });
  var all    = load();
  all[file]  = styles;
  fs.writeFileSync(STYLES_FILE, JSON.stringify(all, null, 2));
  res.json({ ok: true });
});

module.exports = router;
