// routes/proxy.js — GET /proxy/*
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const { readUrlForMode } = require('../lib/apiMode');

// Draft Predict API URL (Settings → Draft Predict API) — the full upstream
// URL including authKey/judgeId, not just a base + forwarded querystring,
// since judgeId changes per match. See routes/devapi.js's /api/predictions-url.
const PREDICTIONS_URL_FILE = path.join(__dirname, '..', 'predictions_api_url.json');
const PREDICTIONS_URL_DEFAULT = 'https://r3z8c353h3.ap-southeast-1.awsapprunner.com/api/live/predictions?authKey=18a86b9d-a35f-40d9-94ce-726779b3514a&judgeId=1370583970';
const FIXTURE_FILE = path.join(__dirname, '..', 'predictions_test.json');

// GET /proxy/predictions — proxy to the Draft Predict API, avoiding CORS.
//
// No URL configured in Settings (the field left blank) → serve
// predictions_test.json's candidate/probability lists instead of
// erroring, flagged with _localFallback so Draft.html knows to override
// draftState with the REAL draft actually happening on its own feed
// (dpTrackRealDraftSeat) rather than the file's own canned draftState —
// "which slot is active" always tracks the real draft; only the
// candidate content is borrowed from the file. See Draft.html's
// dpFetchLive for the client half of this.
router.get('/proxy/predictions', async (req, res) => {
  const upstream = readUrlForMode(PREDICTIONS_URL_FILE, PREDICTIONS_URL_DEFAULT).trim();
  if (!upstream) {
    try {
      const data = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'));
      return res.set('Cache-Control', 'no-store').json(Object.assign({}, data, { _localFallback: true }));
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }
  try {
    const r    = await fetch(upstream);
    const data = await r.json();
    res.set('Cache-Control', 'no-store').json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /proxy/richguy?host=theapi.dpdns.org — server-side proxy to avoid CORS
router.get('/proxy/richguy', async (req, res) => {
  const host = req.query.host || "theapi.dpdns.org";
  try {
    const upstream = await fetch(`http://${host}/api/gold_vs_gold_sector`);
    const data = await upstream.json();
    res.set("Access-Control-Allow-Origin", "*").json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
