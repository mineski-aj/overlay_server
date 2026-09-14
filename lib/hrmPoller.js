// lib/hrmPoller.js — polls the external HRM Server for live BPM readings
const fs   = require("fs");
const path = require("path");
const state = require("./state");
const { players } = require("./config");

const HRM_URL_FILE = path.join(__dirname, "..", "hrm_api_url.json");
const { readUrlForMode } = require("./apiMode");

let _warnedNoUrl = false;

function getHrmUrl() {
  return readUrlForMode(HRM_URL_FILE, "").trim().replace(/\/$/, "");
}

function markAllDisconnected() {
  for (const pid of Object.keys(players)) {
    const r = state.readings[pid];
    if (r) r.status = "disconnected";
  }
}

// Called on a raw setInterval(pollHrmReadings, 1000) in lib/pollers.js,
// which doesn't know or care whether the previous tick finished — without
// this guard, an unreachable HRM server (silently dropped packets, not a
// fast connection-refused) would pile up one more overlapping hung fetch
// every second, forever, since plain fetch() has no default timeout.
// AbortSignal.timeout() below bounds each individual attempt; this flag
// additionally stops new ones from starting while one is still in flight.
// Same lesson as lib/pollers.js's HTTP_GET_TIMEOUT_MS / pollPostInfo._inFlight.
let _inFlight = false;

async function pollHrmReadings() {
  if (_inFlight) return;
  const url = getHrmUrl();
  if (!url) {
    if (!_warnedNoUrl) {
      console.warn("[HRM] No HRM server URL configured — set it from the dashboard Settings tab");
      _warnedNoUrl = true;
    }
    return;
  }

  _inFlight = true;
  try {
    const r = await fetch(`${url}/readings`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const readings = await r.json();
    if (!Array.isArray(readings)) throw new Error("unexpected response shape");

    for (const reading of readings) {
      const pid = reading.slot;
      if (!pid || !state.readings[pid]) continue;
      state.readings[pid] = {
        ...state.readings[pid],
        name:      reading.name,
        team:      reading.team,
        role:      reading.role,
        slot:      reading.slot,
        bpm:       reading.bpm,
        last_bpm:  reading.last_bpm,
        status:    reading.status,
        last_seen: reading.last_seen,
      };
    }
  } catch (e) {
    console.warn("[HRM] Unreachable:", e.message);
    markAllDisconnected();
  } finally {
    _inFlight = false;
  }
}

module.exports = { pollHrmReadings };
