// routes/devapi.js — GET /api/sub-info/
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');

router.get('/api/sub-info', (req, res) => {
  const samplePath = path.join(__dirname, '..', 'sub-info_sample.json');
  try {
    const data = fs.readFileSync(samplePath, "utf8");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (e) {
    res.status(500).json({ error: "sub-info_sample.json not found" });
  }
});

// Also handle trailing slash variant
router.get('/api/sub-info/', (req, res) => {
  const samplePath = path.join(__dirname, '..', 'sub-info_sample.json');
  try {
    const data = fs.readFileSync(samplePath, "utf8");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (e) {
    res.status(500).json({ error: "sub-info_sample.json not found" });
  }
});

// Returns list of sponsor files from assets/sponsors/
// Filename format: name<N>.ext  where N = display duration in seconds (default 3)
router.get('/api/sponsors', (req, res) => {
  const dir = path.join(__dirname, '..', 'assets', 'sponsors');
  try {
    const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f));
    const sponsors = files.map(f => {
      const m = f.match(/(\d+)\.[^.]+$/);
      return { src: 'assets/sponsors/' + f, dur: m ? parseInt(m[1], 10) * 1000 : 3000 };
    });
    sponsors.sort(function(a, b) { return b.dur - a.dur; });
    res.json(sponsors);
  } catch (e) {
    res.status(500).json({ error: 'sponsors folder not found' });
  }
});

// Game API base URL — GET to read, POST { url } to update
const GAME_URL_FILE = path.join(__dirname, '..', 'game_api_url.json');

router.get('/api/game-url', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(GAME_URL_FILE, 'utf8')));
  } catch (e) {
    res.json({ url: '' });
  }
});

router.post('/api/game-url', (req, res) => {
  const url = ((req.body || {}).url || '').trim().replace(/\/$/, '');
  fs.writeFileSync(GAME_URL_FILE, JSON.stringify({ url }));
  res.json({ ok: true, url });
});

module.exports = router;
