# MPL Overlay Server — Instructions
**Version:** 1.0  
**File:** mploverlay_instructionsV1.md

---

## Golden Rule

**Never remove existing routes, features, or functionality when making edits.**  
Only touch what is explicitly requested. If a task requires editing a block of code that contains unrelated features, preserve them exactly. When in doubt, make the smallest possible change.

---

## Server Overview

**File:** `server.js`  
**Port:** 3000  
**Stack:** Node.js, plain `http` module, no frameworks

---

## All Routes — Do Not Remove

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/bpm` | Receive BPM from Android watches |
| GET | `/bpm` | Latest single BPM reading |
| GET | `/bpm/log` | BPM history log (`?limit=N`) |
| GET | `/feed` | Flat vmix-style BPM array |
| GET | `/feed/vmix` | Alias for `/feed` |
| GET | `/feed/order` | Camp-ordered feed with swap logic |
| GET | `/events` | Per-player K/D/A + objective events |
| GET | `/positions` | Map position log (`?camp=&seat=&from=&to=`) |
| GET | `/postgame` | Last completed game stats |
| GET | `/stats/league` | All-time league stats + current matchup |
| GET | `/fights` | Completed fight recaps (`?last=N`) |
| GET | `/fights-static` | Serves `fights.json` for debug mode |
| GET | `/fights-overlay` | Serves `fights.html` |
| GET | `/hero/:filename` | Serves hero icon images from `/hero/` folder |
| GET | `/` | Server dashboard (auto-refreshes) |
| GET | `/overlay/events` | SSE stream — all overlays connect here |
| GET | `/meter/show` | Sends `event: meter` `cmd:show` via SSE → triggers `heart_stopping_moment_v14.html` |
| GET | `/meter/hide` | Sends `event: meter` `cmd:hide` via SSE → triggers `heart_stopping_moment_v14.html` |
| GET | `/meter/plus` | Sends `event: meter` `cmd:plus` — increments meter level |
| GET | `/meter/minus` | Sends `event: meter` `cmd:minus` — decrements meter level |
| GET | `/meter/clear` | Sends `event: meter` `cmd:clear` — resets meter level to 0 |
| GET | `/overlay/fights/show` | Sends `event: fights` `action:show` via SSE + sets pending action |
| GET | `/overlay/fights/hide` | Sends `event: fights` `action:hide` via SSE + sets pending action |
| GET | `/overlay/fights/pending` | Polled by `fights.html` every 500ms — returns and clears pending show/hide action |
| GET | `/overlay/slot1–slot10` | Sends `event: show` with slot to SSE clients |
| GET | `/overlay/hide` | Sends `event: hide` to SSE clients |

---

## SSE Architecture

All overlays connect to one shared SSE stream at `/overlay/events`.  
Different overlays listen for different named events:

- `event: meter` → `heart_stopping_moment_v14.html` (BPM meter overlay)
- `event: fights` → `fights.html` (fight recap overlay) — also uses 500ms poll fallback
- `event: show` / `event: hide` → general player BPM overlays

**Do not collapse or merge these event types.**

---

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Main server — all logic, routes, polling, fight detection |
| `fights.html` | Fight recap overlay — 905×286px, served at `/fights-overlay` |
| `fights.json` | Static fight data for debug mode in `fights.html` |
| `fights_live.json` | Persisted fight log — survives server restarts |
| `config.json` | API URLs (`game_api`, `main_api`) |
| `postgame.json` | Latest postgame snapshot (live pointer) |
| `postgames/` | Archived postgame JSON files |
| `hero/` | Hero icon images (`HERO_{id}_KOTAK.png`) |
| `/Users/ajsarmiento/Desktop/heartstop/heart_stopping_moment_v14.html` | BPM meter overlay — **outside this directory** |

---

## Fight Detection Rules

- A fight starts when any player's `dmg_out` increases between ticks
- A fight closes after **3 seconds** of no damage activity (`FIGHT_GAP_S = 3`)
- Fights shorter than **5 seconds** are discarded as skirmishes
- Fights are persisted to `fights_live.json` and restored on server restart
- BPM is sampled every tick during a fight (swap-aware via `activeCampMap`)

---

## Postgame Recording Window

Postgames are only written to disk between **13:50 and 01:00 local time**.  
Games outside this window are skipped (test games). The check is in `writePostgame()`.

---

## Camp Swap Logic

- `activeCampMap` is always the authoritative camp→player mapping
- It is updated by `applySwap()` based on comparing game API camp tricodes against the main API
- All fight BPM sampling, position logging, and player name mapping use `activeCampMap`
- **Never hardcode camp1 = watches 1–5** — always go through `activeCampMap`

---

## Editing Rules

1. **Never remove a route.** If a route needs changing, modify only what is needed.
2. **Never overwrite a large block** unless every line in it has been reviewed.
3. **Restart the server** after any `server.js` change. HTML changes do not need a restart.
4. **fights.html** is served fresh on every request — no restart needed for HTML/CSS/JS changes.
5. **Do not flush `fights_live.json`** on server start — it is intentionally restored.
6. **Do not flush `positionLog`** on game start — only flush when state leaves `end` with a new `battleid`.
