# MPL Overlay Server — Instructions
**Version:** 1.1  
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
| GET | `/hero/:filename` | Serves hero icon images from `hero/` folder |
| GET | `/items/:filename` | Serves item images from `items/` folder |
| GET | `/role/:filename` | Serves role icon images from `role/` folder (filenames have spaces, e.g. `GOLD LANER.png`) |
| GET | `/richguy/:filename` | Serves richguy overlay assets from `richguy/` folder |
| GET | `/logos/:filename` | Serves team logo images from `logos/` folder (named by tricode, e.g. `RORA.png`) |
| GET | `/photos/:filename` | Serves player photo images from `photos/` folder (e.g. `KarlTzy_FRONT.png`) |
| GET | `/proxy/predictions` | Proxies to draftpredict API (`r3z8c353h3.ap-southeast-1.awsapprunner.com`) — passes `?authKey=&judgeId=` through |
| GET | `/proxy/richguy?host=X` | Server-side proxy to `http://{host}/api/gold_vs_gold_sector` — avoids CORS when fetching from `mplfs.html` |
| GET | `/overlay/draftpredict/show` | Shows the draft predict overlay and starts the data poller |
| GET | `/overlay/draftpredict/hide` | Hides the draft predict overlay and stops the data poller |
| GET | `/overlay/draftpredict/poll` | Polled by `draftpredict.html` every 500ms — returns and clears pending commands as `{ commands: [] }` |
| GET | `/` | Server dashboard (auto-refreshes) |
| GET | `/overlay/events` | SSE stream — all overlays connect here |
| GET | `/meter/show` | Sends `event: meter` `cmd:show` via SSE |
| GET | `/meter/hide` | Sends `event: meter` `cmd:hide` via SSE |
| GET | `/meter/plus` | Sends `event: meter` `cmd:plus` — increments meter level |
| GET | `/meter/minus` | Sends `event: meter` `cmd:minus` — decrements meter level |
| GET | `/meter/clear` | Sends `event: meter` `cmd:clear` — resets meter level to 0 |
| GET | `/overlay/fights/show` | Sends `event: fights` `action:show` via SSE + sets pending action |
| GET | `/overlay/fights/hide` | Sends `event: fights` `action:hide` via SSE + sets pending action |
| GET | `/overlay/fights/pending` | Polled by `fights.html` every 500ms — returns and clears pending show/hide action |
| GET | `/overlay/post_hearts/show` | Sends `event: post_hearts` `action:show` via SSE |
| GET | `/overlay/post_hearts/hide` | Sends `event: post_hearts` `action:hide` via SSE |
| GET | `/overlay/post_richguy/show` | Sends `event: post_richguy` `action:show` via SSE |
| GET | `/overlay/post_richguy/hide` | Sends `event: post_richguy` `action:hide` via SSE |
| GET | `/overlay/post_itemline/show` | Sends `event: post_itemline` `action:show` via SSE |
| GET | `/overlay/post_itemline/hide` | Sends `event: post_itemline` `action:hide` via SSE |
| GET | `/overlay/fs/hide` | Sends `event: fs_hide` via SSE — hides ALL overlays on `mplfs.html` |
| GET | `/overlay/slot1–slot10` | Sends `event: show` with slot to SSE clients |
| GET | `/overlay/hide` | Sends `event: hide` to SSE clients |

---

## SSE Architecture

All overlays connect to one shared SSE stream at `/overlay/events`.  
Different overlays listen for different named events:

- `event: meter` → `heart_stopping_moment_v14.html` (BPM meter overlay)
- `event: fights` → `fights.html` (fight recap overlay) — also uses 500ms poll fallback at `/overlay/fights/pending`
- `event: show` / `event: hide` → general player BPM overlays
- `event: post_hearts` → `mplfs.html` (postgame hearts BPM overlay)
- `event: post_richguy` → `mplfs.html` (richguy postgame gold stats overlay)
- `event: post_itemline` → `mplfs.html` (item timeline overlay)
- `event: fs_hide` → `mplfs.html` — triggers hide on ALL three overlays on the page simultaneously

**Do not collapse or merge these event types.**

---

## Key Files

| File | Purpose |
|------|---------|
| `server.js` | Main server — all logic, routes, polling, fight detection |
| `mplfs.html` | Combined overlay page — post_hearts, post_richguy, post_itemline all in one |
| `fights.html` | Fight recap overlay — 905×286px, served at `/fights-overlay` |
| `fights.json` | Static fight data for debug mode in `fights.html` |
| `fights_live.json` | Persisted fight log — survives server restarts |
| `config.json` | API URLs (`game_api`, `main_api`) |
| `postgame.json` | Latest postgame snapshot (live pointer) |
| `postgames/` | Archived postgame JSON files |
| `hero/` | Hero icon images (`HERO_{id}_KOTAK.png`) |
| `items/` | Item icon images (`{item_id}.png`) |
| `role/` | Role icon images — filenames have spaces: `GOLD LANER.png`, `EXP LANER.png`, `MID LANER.png`, `ROAMER.png`, `JUNGLER.png` |
| `richguy/` | Richguy overlay assets: `richcontainer.png`, `ignblue.png`, `ignred.png` |
| `logos/` | Team logo PNGs named by tricode (e.g. `RORA.png`, `FLCN.png`) |
| `photos/` | Player cutout photos (e.g. `KarlTzy_FRONT.png`) |
| `items.json` | Item ID → name mapping (edit this, not server.js) |
| `/Users/ajsarmiento/Desktop/draftpredict/draftpredict.html` | Draft predict overlay — **outside this directory**; polls `/proxy/predictions` and `/overlay/draftpredict/poll` |
| `/Users/ajsarmiento/Desktop/heartstop/heart_stopping_moment_v14.html` | BPM meter overlay — **outside this directory** |

---

## mplfs.html Overlay Sections

`mplfs.html` hosts three overlay scenes on a 1920×1080 broadcast canvas (transparent background):

### post_hearts
- Shows per-player BPM hearts at postgame
- SSE: `event: post_hearts` `action: show|hide`
- Guard: if already hidden, hide does nothing (no re-animation)

### post_richguy
- Postgame gold breakdown overlay with 8 richcontainers + IGN name tags
- Data pulled from external API via `/proxy/richguy?host=X` + `/postgame` for tricodes
- Background-polled every 5s into `rgCache` — show is instant, no wait
- If no cache yet, show does nothing (no placeholder)
- **GOLD_LABELS** (container order → gold_map key):
  1. MINION GOLD → key `"1"`
  2. KILLS / ASSISTS → key `"6"`
  3. JUNGLE CREEPS → key `"2"`
  4. TURTLE / LORD → key `"3"`
  5. TURRET GOLD → key `"4"`
  6. ROAM EQUIP → key `"5"`
  7. TOTAL GOLD (no delta) — from `winner.gold`
  8. GPM (no delta) — from `winner.gpm`
- Delta: green if positive, red if negative, hidden if zero
- Role icons served from `/role/` — filenames matched fuzzy via `roleFile()` (checks `.includes()` for gold/exp/mid/roam/jung)
- Team logos from `/logos/{tricode}.png`
- SSE: `event: post_richguy` `action: show|hide`

### post_itemline
- Item timeline overlay per player
- SSE: `event: post_itemline` `action: show|hide`

### fs_hide
- `/overlay/fs/hide` broadcasts `event: fs_hide` which hides all three scenes simultaneously

---

## Proxy Route

`/proxy/richguy?host=X` proxies to `http://{host}/api/gold_vs_gold_sector`.  
Uses `async/await` inside an IIFE `(async () => { ... })()` because the `http.createServer` callback is synchronous.  
Default host: `theapi.dpdns.org`.

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
7. **Static file routes** (`/hero/`, `/items/`, `/role/`, `/richguy/`, `/logos/`, `/photos/`) all require a `fs.existsSync` 404 check before streaming — never skip this.
8. **Route ordering matters** — specific routes (`/fights-static`, `/fights-overlay`, `/overlay/post_richguy/*`, `/overlay/fs/hide`, `/overlay/draftpredict/*`, etc.) must appear **before** the generic catch-alls (`/fights`, `/overlay/*`).
9. **`_draftpredictCmds`** is a module-level array (`const _draftpredictCmds = []`) at the top of `server.js`. `toggle` and `fetch` push to it; `poll` splices and returns it. No persistence — commands are lost on server restart.
