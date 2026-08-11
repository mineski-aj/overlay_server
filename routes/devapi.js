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

// Credit Reel content — plain text, edited from the dashboard's Edit tab
// (or by hand-editing this file / pasting into the textarea) and rendered
// by mplfs.html's crParseText(). GET to read, POST { text } to update.
const CREDITS_TEXT_FILE = path.join(__dirname, '..', 'credits_reel.txt');

router.get('/api/credits-text', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').type('text/plain').send(fs.readFileSync(CREDITS_TEXT_FILE, 'utf8'));
  } catch (e) {
    res.set('Cache-Control', 'no-store').type('text/plain').send('');
  }
});

router.post('/api/credits-text', (req, res) => {
  const text = (req.body || {}).text || '';
  fs.writeFileSync(CREDITS_TEXT_FILE, text);
  res.json({ ok: true });
});

// Credit Reel scroll speed, in px/sec — GET to read, POST { speed } to update
const CREDITS_SPEED_FILE = path.join(__dirname, '..', 'credits_speed.json');

router.get('/api/credits-speed', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(JSON.parse(fs.readFileSync(CREDITS_SPEED_FILE, 'utf8')));
  } catch (e) {
    res.set('Cache-Control', 'no-store').json({ speed: 90 });
  }
});

router.post('/api/credits-speed', (req, res) => {
  const speed = Math.max(10, Math.min(1000, Number((req.body || {}).speed) || 90));
  fs.writeFileSync(CREDITS_SPEED_FILE, JSON.stringify({ speed }));
  res.json({ ok: true, speed });
});

// Credit Reel font sizes, in px — GET to read, POST { headingSize, bodySize } to update
const CREDITS_STYLE_FILE = path.join(__dirname, '..', 'credits_style.json');

router.get('/api/credits-style', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(JSON.parse(fs.readFileSync(CREDITS_STYLE_FILE, 'utf8')));
  } catch (e) {
    res.set('Cache-Control', 'no-store').json({ headingSize: 40, bodySize: 24 });
  }
});

router.post('/api/credits-style', (req, res) => {
  const headingSize = Math.max(8, Math.min(200, Number((req.body || {}).headingSize) || 40));
  const bodySize     = Math.max(8, Math.min(200, Number((req.body || {}).bodySize) || 24));
  fs.writeFileSync(CREDITS_STYLE_FILE, JSON.stringify({ headingSize, bodySize }));
  res.json({ ok: true, headingSize, bodySize });
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

// Player photo manifest — returns available filenames per pose for client-side lookup
const PHOTOS_DIR = path.join(__dirname, '..', 'photos');

// GET /api/signature-photos — player names (igns) with a SIGNATURE cutout
// available in photos/SIGNATURE/, e.g. for the kill-event photo popup.
// Filename convention: <ign>_SIGNATURE_resized.png
router.get('/api/signature-photos', (req, res) => {
  try {
    const names = fs.readdirSync(path.join(PHOTOS_DIR, 'SIGNATURE'))
      .filter(f => f.endsWith('_SIGNATURE_resized.png'))
      .map(f => f.slice(0, -'_SIGNATURE_resized.png'.length));
    res.set('Cache-Control', 'no-store').json({ names });
  } catch (e) {
    res.status(500).json({ names: [] });
  }
});

router.get('/api/photo-manifest', (req, res) => {
  try {
    const poses = ['VICTORY', 'DEFEAT'];
    const manifest = {};
    for (const pose of poses) {
      const dir = path.join(PHOTOS_DIR, pose);
      try {
        manifest[pose] = fs.readdirSync(dir).filter(f => /\.png$/i.test(f));
      } catch { manifest[pose] = []; }
    }
    res.set('Cache-Control', 'no-store').json(manifest);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dynamic content — GET to read, POST { ph_ticker, en_ticker, ph_headline, en_headline } to update
const DYNAMIC_FILE = path.join(__dirname, '..', 'dynamic_content.json');
const DYNAMIC_DEFAULTS = { ph_ticker: '', en_ticker: '', ph_headline: '', en_headline: '' };

router.get('/api/dynamic-content', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(JSON.parse(fs.readFileSync(DYNAMIC_FILE, 'utf8')));
  } catch {
    res.set('Cache-Control', 'no-store').json(DYNAMIC_DEFAULTS);
  }
});

router.post('/api/dynamic-content', (req, res) => {
  const b = req.body || {};
  const data = {
    ph_ticker:   String(b.ph_ticker   || ''),
    en_ticker:   String(b.en_ticker   || ''),
    ph_headline: String(b.ph_headline || ''),
    en_headline: String(b.en_headline || ''),
  };
  fs.writeFileSync(DYNAMIC_FILE, JSON.stringify(data, null, 2));
  res.set('Cache-Control', 'no-store').json({ ok: true, data });
});

// Server-side proxy — fetches game API and returns JSON, avoids browser CORS issues
router.get('/api/gamedata-proxy', async (req, res) => {
  try {
    const stored = JSON.parse(fs.readFileSync(GAME_URL_FILE, 'utf8'));
    const gameUrl = (stored.url || '').trim();
    if (!gameUrl) return res.status(404).json({ error: 'no game URL configured' });
    const r = await fetch(gameUrl);
    if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
    const data = await r.json();
    res.set('Cache-Control', 'no-store').json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Team Head to Head (Team Hexagon) API base URL — GET to read, POST { url } to update
const HEXAGON_URL_FILE    = path.join(__dirname, '..', 'hexagon_api_url.json');
const HEXAGON_URL_DEFAULT = 'https://theapi.dpdns.org/api/teamh2h/';

router.get('/api/hexagon-url', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(HEXAGON_URL_FILE, 'utf8')));
  } catch (e) {
    res.json({ url: HEXAGON_URL_DEFAULT });
  }
});

router.post('/api/hexagon-url', (req, res) => {
  const url = ((req.body || {}).url || '').trim();
  fs.writeFileSync(HEXAGON_URL_FILE, JSON.stringify({ url }));
  res.json({ ok: true, url });
});

// Server-side proxy — fetches the Team Head to Head API and returns JSON, avoids browser CORS issues
router.get('/api/hexagon-data', async (req, res) => {
  try {
    let stored;
    try { stored = JSON.parse(fs.readFileSync(HEXAGON_URL_FILE, 'utf8')); } catch (e) { stored = {}; }
    const url = (stored.url || HEXAGON_URL_DEFAULT).trim();
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
    const data = await r.json();
    res.set('Cache-Control', 'no-store').json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// MVP Highlights (game-mvp/view) API base URL — GET to read, POST { url } to update
const HIGHLIGHTS_URL_FILE    = path.join(__dirname, '..', 'highlights_api_url.json');
const HIGHLIGHTS_URL_DEFAULT = 'https://theapi.dpdns.org/api/game-mvp/view/';

router.get('/api/highlights-url', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(HIGHLIGHTS_URL_FILE, 'utf8')));
  } catch (e) {
    res.json({ url: HIGHLIGHTS_URL_DEFAULT });
  }
});

router.post('/api/highlights-url', (req, res) => {
  const url = ((req.body || {}).url || '').trim();
  fs.writeFileSync(HIGHLIGHTS_URL_FILE, JSON.stringify({ url }));
  res.json({ ok: true, url });
});

// Server-side proxy — fetches the MVP Highlights API and returns JSON, avoids browser CORS issues
router.get('/api/highlights-data', async (req, res) => {
  try {
    let stored;
    try { stored = JSON.parse(fs.readFileSync(HIGHLIGHTS_URL_FILE, 'utf8')); } catch (e) { stored = {}; }
    const url = (stored.url || HIGHLIGHTS_URL_DEFAULT).trim();
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
    const data = await r.json();
    res.set('Cache-Control', 'no-store').json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
