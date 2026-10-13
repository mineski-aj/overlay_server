// routes/led.js — all /led/* routes
const express = require('express');
const router  = express.Router();
const state   = require('../lib/state');

const noStore = { "Cache-Control": "no-store" };

router.get('/led/home', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: led_side\ndata: {"side":"home"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, side: "home" });
});

router.get('/led/swap', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: led_side\ndata: {"side":"swap"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, side: "swap" });
});

router.get('/led/fightshow', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: led_fight\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, action: "show" });
});

router.get('/led/fighthide', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: led_fight\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, action: "hide" });
});

router.get('/led/draftpredshow', (req, res) => {
  state.checkOverlays.led_draftpred = true;   // restore-on-load, same as draftpredict3
  state.overlayClients.forEach(c => { try { c.write('event: led_draftpred\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, action: "show" });
});

router.get('/led/draftpredhide', (req, res) => {
  state.checkOverlays.led_draftpred = false;   // restore-on-load, same as draftpredict3
  state.overlayClients.forEach(c => { try { c.write('event: led_draftpred\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, action: "hide" });
});

router.get('/led/winshow', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: led_win\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, action: "show" });
});

router.get('/led/winhide', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: led_win\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, action: "hide" });
});

router.get('/led/healthshow', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: led_health\ndata: {"action":"show"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, action: "show" });
});

router.get('/led/healthhide', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: led_health\ndata: {"action":"hide"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, action: "hide" });
});

// Draft Predict test hooks — fired by the dashboard's "Test Draft Predict v3"
// button / per-slot grid (Draft Overlay card) so they can drive the LED page
// too. Rides the existing led_draftpred SSE event (new `action` values only),
// so no KNOWN_EVENTS / worker-version change is needed.
router.get('/led/draftpredtest-reveal', (req, res) => {
  state.overlayClients.forEach(c => { try { c.write('event: led_draftpred\ndata: {"action":"test_reveal"}\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, action: "test_reveal" });
});

router.get('/led/draftpredtest-slot', (req, res) => {
  const slot = parseInt(req.query.slot, 10);
  const mode = req.query.mode;
  if (!(slot >= 1 && slot <= 20) || !['show', 'settle'].includes(mode)) {
    return res.status(400).set(noStore).json({ ok: false, error: 'slot 1-20 and mode show|settle required' });
  }
  const payload = JSON.stringify({ action: 'test_slot', slot, mode });
  state.overlayClients.forEach(c => { try { c.write('event: led_draftpred\ndata: ' + payload + '\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, action: "test_slot", slot, mode });
});

// Led_draft.html player-photo source — its OWN switch (not the shared
// /overlay/draft-photo-mode that Draft.html reads), so toggling it for the LED
// wall can never change what Draft.html shows. 'placeholder' gives every seat a
// fixed stand-in photo regardless of the lineup the draft API reports. Rides the
// existing led_draftpred SSE event (action 'photo_mode') — no new event name.
router.get('/led/draft-photo-mode', (req, res) => {
  res.set(noStore).json({ mode: state.ledDraftPhotoMode });
});
router.get('/led/draft-photo-mode/:mode', (req, res) => {
  const mode = req.params.mode;
  if (mode !== 'live' && mode !== 'placeholder') {
    return res.status(400).set(noStore).json({ ok: false, error: 'mode must be live|placeholder' });
  }
  state.ledDraftPhotoMode = mode;
  const payload = JSON.stringify({ action: 'photo_mode', mode });
  state.overlayClients.forEach(c => { try { c.write('event: led_draftpred\ndata: ' + payload + '\n\n'); } catch {} });
  res.set(noStore).json({ ok: true, mode });
});

module.exports = router;
