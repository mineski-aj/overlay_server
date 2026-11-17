# overlay_server — instruction manual

MLBB (Mobile Legends: Bang Bang) esports broadcast overlay system. Each overlay is a browser-source HTML page (OBS/vMix reads it), driven by live game data and controlled from a central dashboard. Read this before touching anything.

## Running it

```
node server.js        # or: npm start   (port 3000; dashboard at /html/dashboard.html)
```
**`routes/*.js` and `lib/*.js` are NOT hot-reloaded — a restart is required.** `html/*.html` changes apply on next page load. If you edit a route or `lib/` file, say so and ask before restarting: the server is usually the user's own terminal process, never kill/relaunch it silently. Don't assume an earlier route edit is live — ask whether they've restarted.

Never `pkill` Edge by app name (see memory); kill only a test instance by debug port.
Don't commit unless asked.

## Map

- `server.js` — Express entrypoint, mounts `routes/`. `routes/*.js` = API endpoints. `lib/` = shared server code (`state.js`, `apiMode.js`, `theme.js`, `pollers.js`, `hrmPoller.js`, `eventLog.js`).
- `html/mplfs.html` — main scoreboard/scene overlay (full-screen "scenes": MVP, Final Team, Line-Up, Standings, Posts, …). `html/ENTVC.html` — EN broadcast mirror of Waiting TVC (see below).
- `html/mpltag.html` — small lower-third "tag" overlays (Map Selection, L3 Lobby…); several can be on screen at once (no shared `activeFeature`).
- `html/mploverlay_v7.html` — in-game overlay shell; one `js/overlay-*.js` per feature + `overlay-core.js` (state/polling) and `overlay-debug.js` (debug bar, SSE, most detection logic).
- `html/Draft.html`, `DraftIndex.html`, `DraftIndexV2.html` (same `draftindex` event/state; Edit styles from `DraftIndex` bucket), `html/heatmap.html` (standalone copy of mplfs's Post Heatmap — hand-port fixes), `html/led_overlay.html` + `Led_draft.html` + `js/led-events.js` (LED wall).
- `html/dashboard.html` — control panel (Control tab SHOW/HIDE/PREVIEW, Edit tab drag/resize editor persisted to `overlay_styles.json`). `match-dashboard.html`, `map-selection-dashboard.html`, `standings-dashboard.html` are always-mounted iframes in it.
- `html/js/overlay-shared-worker.js` + `overlay-sse-shim.js` — the ONE real `/overlay/events` connection per browser. `theme-apply.js` — global theme. `event-log-client.js` — Logs tab reporting. `hero-web.js` — WebP hero art w/ PNG fallback. `sponsor-cursor.js` — shared sponsor-loop resume point.
- **All assets live under `assets/`** (layout below). Nothing asset-like at repo root.
- **`data/`** holds every runtime JSON/txt file (`match_state`, `overlay_styles`, `theme`, `api_mode`, `config` (dashboard password), the `*_api_url.json` set, `mainroster`, `heronames`, `credits_reel.txt`, …) plus `data/postgames/`. Live state — don't hand-edit. Server code reads them as `path.join(__dirname, '..', 'data', '<file>')`; pages that fetch one directly use `/data/<file>` (`mainroster.json`, `heronames.json`). Repo root keeps only `server.js`, `package*.json`, `CLAUDE.md`.
- Cross-project memory: `/Users/ajsarmiento/.claude/projects/-Users-ajsarmiento/memory/` (`reference_mlbb_api.md` for the main-info API shape; `feedback_*` for UI rules).

## Asset layout (`assets/`) — put new files in the matching folder

```
assets/
  hero/      full/ (1000px PNG + thumb/ 200px)  web/ (512px WebP)  mvp/ mvp_web/  highlights/  post/  webm/ (HERO_PICK_DRAFT_<id>.webm)
  photo/     player photos by pose: FRONT DEFEAT LEFT RIGHT SIGNATURE VICTORY (+ placeholder.png, TALENTS, Group, groupbg*, Dynamic, "Playoffs Sched", broll)
             hires/<POSE>[_web]/  hires_l3/LEFT|RIGHT/  waiting_lobby/
  game/      items/ role/ spell/ emblem/ maps/      (game-data icons)
  team/      logos/<TRI>.png
  sponsor/   MAIN/ MY/ PH/ ID/ = 4 logo sets (each + white/); routes take ?set=, default MAIN — served by /api/sponsors (the scene art is overlay/sponsors)
  fonts/     Anton, General Sans
  webm/      shared background loops (bgloop*, annivloop*, phase2_*), motion/ (kill-event webms), playoffs/ (playoffsbg_*.webm)
  common/    shared images (mpl2026logo.png)
  overlay/   per-overlay art, one folder per scene: ingame (mploverlay_v7), draft, led, mvp, lineup, ... plus richguy/, post_heart/.
             Each has optional playoffs/ and anniversary/ theme subfolders (same filenames as Regular).
  _archive/  unreferenced old stuff (z_old, z_conversion scripts) — safe to delete
```
Server-side dirs that read from disk: `routes/devapi.js` (`SPONSORS_DIR`, `PHOTOS_DIR`, `LOGOS_DIR`), `routes/overlay.js` (`PHOTOS_DIR`, `HIRES_FRONT_DIR`). `Tools/optimize-images.js` JOBS use these paths too. Escaped-slash regexes (`hero-web.js`, `hiresWebUrl` in mplfs.html) hold paths as well — update them when moving things.

## Game feed adapter — M8 V2 raw battle feed (`lib/rawAdapter.js`)

On this branch the Game API is the RAW battle feed (`camp_list[].player_list[]` + `data.incre_event_list`, sample: `data/battledata_sample_m8.txt`). Every overlay still reads the old enriched shape (`seat_1..5`), so `normalizeGameFeed()` converts it in ONE place: `pollGameAPI` (lib/pollers.js) and `/api/gamedata-proxy?fresh=1` (routes/devapi.js). Pages never see raw. An already-enriched payload (has `seat_1`) passes through; any failure falls back to the raw payload. Referee camp (campid 5, `judger`) is left untouched.
- **Seat = lane:** seat_1 EXP, 2 JUNGLE, 3 MID, 4 ROAM, 5 GOLD (+ `role` string). The raw feed has NO role, so `resolveRoles()` infers it: jungler = Retribution (20020), roamer = only player with `gold_map[5]`, gold = most `gold_map[1]` among the rest (locked at 4:00), EXP/MID = lower `pos` first (**provisional guess — replace `resolveRoles` with the M8 V2 pos/role tracking rules**). Locks reset per battleid.
- **Derived:** `hero_name` (heronames.json), `equip_list` -> `{value,…}`, `extra_param` (kda/gpm/goldk, first_blood / multi-kills / legendary from `kill_hero` markers, kill_lord/kill_tortoise from `kill_boss`), `level_percent`/`level_eta` (XP table `XP_AT`: levels 13-15 measured, **2-12 are a fitted estimate**; eta = time to MAX level), health/mana %, `kda_rate`, `goldrate`, `goldDiffPlayer` (vs the opposite seat), `dmg_tkn_death`, `roaming_type` (roam boot ids), `rune_map_N`, team totals, `blessing_gold` (= camp's `gold_map[5]`, assumed), `kill_lord_advantage` (latest window), `enemy_area_get` (summed).
- **NOT recoverable (left absent/empty):** `hit_rate` (null upstream), `rank_*`, `emblem_list`, `last_emblem`. Unknown `kill_hero` markers are logged once (`[rawAdapter] unknown kill_hero marker`) — quadra/penta names are guesses.
- **mploverlay_v7 reads the feed ONLY through `/api/gamedata-proxy`** (`currentApiUrl` in overlay-core.js) — it used to fetch the upstream URL straight from the browser, which skipped this adapter entirely. Never point a page at the upstream URL.
- **Side Gold Distri / Side KDA Distri** no longer use their external APIs when the raw feed is active: `lib/feedDerived.js` builds `/api/golddistri-data` (one lane's two players, from `gold_map`) and `/api/kdadistri-data` (featured player vs the 5 enemy lanes, counted from `kill_hero` events — `killer_id`/`killed_id`/`assister[]` equal the players' `roleid`). The lane / featured player are chosen from the Ingame control buttons (`/overlay/distri/gold-role/:role`, `/overlay/distri/kda/:camp/:role`; default exp / blue EXP). `jungle_stolen` (Stolen Gold overlay) = summed `enemy_area_get`.
- **Cannot work on the raw feed:** Live Win Rate (needs the Winrate API's probability model), Trinity / First Item Priority "phase 2" core-item timing (`core_item`/`first_item`), Sky Piercer stacks (`sky_piercer_stack`), Gold Graph V2 (needs the Gold Info API; V1 works from the server's position log), skill-accuracy stats (`hit_rate`). They degrade silently (no panel / card without the timing line), no errors.
- **Testing without a live game:** point Settings → Game API (DEBUG) at `http://localhost:<port>/api/battledata-m8` (serves the raw sample through the same adapter). `lib/rawAdapter.js` is pure — require it in node to replay payloads offline.

## Game API refresh rate (Settings → Battledata API → "Refresh rate (ms)", default 150)

`data/game_refresh.json` `{ms}` (50–5000), `lib/gameRefresh.js`, `GET/POST /api/game-refresh`. **Server:** `pollGameAPI` is a self-rescheduling `setTimeout` that re-reads the value every tick (no restart to change it). Everything that counts "ticks" (BPM samples `tickStats`, `positionLog` + its save counter, `tickFight`, the per-tick console line) is gated on `secTick` = game second changed, so it behaves like the old 1s poll — keep new per-tick bookkeeping behind `secTick`. `/api/gamedata-proxy?fresh=1` serves the poller's cache when it is < max(1.5s, 4×refresh) old instead of hitting the upstream. **Pages:** include `html/js/game-refresh.js` and poll with `GameRefresh.loop(fn)` (awaits `fn`, waits `ms()`, never overlaps; re-reads the setting every 10s — no SharedWorker/KNOWN_EVENTS change). Wired: `overlay-debug.js` masterPoll (mploverlay_v7), `led_overlay.html`, `Led_draft.html`, `ingame_blue/red.html`. **Not** on it (deliberately): mplfs Middle/Player Board's 3s unified poll (it also hits postinfo + match state), Hearts/Richguy/Draft-Index pollers, and one-shot `fetch`es at scene show. Any NEW page that polls the game feed should use `GameRefresh.loop`, not `setInterval`.

## Dashboard architecture — connection budget and the SharedWorker

HTTP/1.1 caps a browser at ~6 connections per host, **shared across all tabs**. Too many persistent `EventSource`s makes requests queue forever (dashboard "hangs"). Solution: `overlay-shared-worker.js` holds the single real `EventSource('/overlay/events')` and rebroadcasts over `postMessage`; `createOverlaySSE()` (from `overlay-sse-shim.js`) exposes the same API subset (`addEventListener`, `.onopen`, `.onerror`, `.close()`).

- **Never `new EventSource(...)` on a new page** — include the shim and call `createOverlaySSE()`. (Not yet migrated: `fights.html`, deferred on purpose.)
- **New named SSE event → add it to `KNOWN_EVENTS` in the worker AND bump `OVERLAY_WORKER_VERSION` in the shim (currently ~38).** Workers are reused by exact URL; without the `?v=N` bump, already-open tabs/browser-sources keep the old worker and silently never get the event. Bump on any worker change.
- `dashboard.html` also fans its one connection out to its iframes via `relay-client.js` (`connectRelay`, `relayCache`/`relaySend`) — a separate, narrower layer than the worker.
- Control `#preview-iframe` and Edit `#edit-iframe` unload on tab switch. **To unload an iframe set `src = 'about:blank'`, never `''`** (empty string loads the parent page recursively).
- **The dashboard must live-sync via SSE:** `dashboardSSE` caches `featureStates` / `checkOverlayStates` / `mplfsSceneState`. Every new show/hide feature MUST get a listener there, or its toggle drifts out of sync silently. Click handlers only fire the request; the SSE echo updates the UI.
- **Done = verified in a real browser,** not `curl`: load a fresh page (new context, no stale worker), click the real Control-tab button, confirm a *separate* tab reacts.

## The #1 rule: every element is independently editable

Every image/video/text gets its own id/class and absolute position — never nested in a shared positioning wrapper — so it can be dragged in the Edit tab. Three things must use the exact same selector string (a miss = dead Edit row, no error):
1. the real `id`/`class` in the page DOM;
2. `..._DEFAULTS` in `dashboard.html` (`{left,top,width,height[,fontSize]}` keyed by selector);
3. `..._ELEMENTS` in `dashboard.html` (`{group,id,name}`).

`group` is functional: arrow-key nudging moves every element in the same group together — give an element its own group unless it should be tied to siblings. Register in `EDIT_CONFIGS`:
```js
mplfs_foo: { label:'Foo Scene · mplfs', file:'mplfs.html', styleFile:'mplfs',
  defaultsKey:'sb_edit_defaults_mplfs_foo', elements:FOO_ELEMENTS, defaults:FOO_DEFAULTS, showFn:'showFooScene' },
```
Pasted design-tool CSS: take **only `left/top/width/height`**; ignore colours, z-index, radius etc. (the real art is a named asset). Children are positioned relative to their named parent container, not the canvas.

## Scene architecture (mplfs.html)

Each scene is a 1920x1080 transparent container (`#foo-page`: `display:none; opacity:0; transition: opacity 400ms`; classes `foo-on` then `foo-visible`). Show: fetch data → `await transitionTo('foo')` → guard `activeFeature === 'foo'` → apply → `preloadMedia` → `showSceneVideo('foo')` → add `foo-on`, force reflow, add `foo-visible`. Hide: `activeFeature = null`, remove `foo-visible`, `setTimeout(~420ms)` to remove `foo-on` + `hideSceneVideo()`. **Never hide on `animationend`** — use setTimeout + the `activeFeature` guard.

Copy the closest existing scene (MVP Scene is the most complete) rather than starting blank.

## Checklist A — new mplfs.html scene (shares the `activeFeature` slot)

All steps use the **same feature key**; every miss is silent.
1. CSS container + per-element rules; HTML; JS (fetch → apply → show/hide as above). Text that must fit uses a shrink-to-fit helper (min size ≈ half of max).
2. **Background:** if it wants the shared ambient loop, add to `SCENE_VIDEO_SRC` (match sibling family, e.g. Posts use `bgloopwaves2.webm`). If it has its own full-bleed art, add nothing (the `if (SCENE_VIDEO_SRC[newFeature])` guard handles it — don't hardcode exception lists).
3. **Post-family:** add to `POST_FEATURES` in `transitionToImpl` and decide middle/player board handling (some special-case it).
4. Edit tab: `FOO_DEFAULTS`, `FOO_ELEMENTS`, `EDIT_CONFIGS`.
5. **Live control (6 layers):** (a) `routes/overlay.js` `/overlay/foo/show|hide` — set `state.mplfsScene.activeFeature`, write `event: foo` to every `state.overlayClients`; (b) `connectSSE()` listener in mplfs.html; (c) line in `hideActiveFeature()`; (d) line in `restoreScene()`; (e) `OVERLAYS` → `id:'mplfs'` → `features` entry in dashboard.html (generates SHOW/HIDE/Preview/copy buttons); (f) `MPLFS_ACTIVE_FEATURE_MAP` (key = `feat.show.split('/')[2]`) — forgetting only breaks the "● Showing" indicator.
6. **Preview:** add a branch to `window.previewTrigger`. The route/SSE event name often differs from the internal `activeFeature` name (`post_stats` vs `stats`, `final_team` vs `finalteam`, `team_lineup_blue` vs `lineupblue`) — read the real SSE listener, don't guess. Most commonly forgotten step.
7. **Event log verdict:** add to `olScenes` at the bottom of mplfs.html's main script.
8. New SSE event name → `KNOWN_EVENTS` + `OVERLAY_WORKER_VERSION` bump.
9. Grep every selector/key across files for mismatches. Syntax-check every touched file:
```
node -e "const fs=require('fs');for(const f of ['html/mplfs.html','html/dashboard.html']){const s=fs.readFileSync(f,'utf8');[...s.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].forEach((m,i)=>{try{new Function(m[1])}catch(e){console.log(f,i,e.message)}})}"
```
(`node --check` for `lib/`/`routes/` files — never `require` pollers, it hangs on timers.)
10. Verify live: real Control toggle → separate tab reacts; Preview shows only in the iframe and `curl /overlay/mplfs-scene` is unchanged; board state correct after switching scenes; copy buttons copy the right URL.

Optional local debug card: add a `feature-card` in mplfs.html's `` ` `` debug bar calling `showFooScene()`/`hideFooScene()`/`toggleLocalPreview('foo', this)` (also add `'foo'` to `toggleLocalPreview` and `previewTrigger` chains). Local only.

## Checklist B — checkOverlays pattern (independent on/off panels: tags, v7 panels, Draft)

1. Boolean in `state.checkOverlays` (`lib/state.js`). 2. `/overlay/<key>/show|hide` in `routes/overlay.js` broadcasting a named SSE event (families of near-identical panels share one event with a `check` field, e.g. `sidecheck`). 3. Restore via `GET /overlay/check-overlays`. 4. Client SSE listener toggling a CSS class. 5. Dashboard: `{name,key}` in `checkToggles` (auto toggle + copy buttons), or plain `show`/`hide` fields on the `OVERLAYS` entry for a single scene (`toggleShowHide: true` for a single pill). 6. `dashboardSSE` listener (see above). 7. New event → `KNOWN_EVENTS` + version bump.

- **Default state:** if normally *on*, default CSS to the shown position and add a "hidden" class when told — otherwise every load flashes blank during the restore fetch.
- **A hide animation must clear the whole layer** (`#scoreboard-overlay` hides with `translateY(-1080px)`); re-check when adding a lower child.
- **"Hide all in a group" buttons:** one server route flipping every key and re-broadcasting each panel's OWN existing event — no new event, no client change. Wire via `extraActions`.
- **mpltag.html:** has its own `previewTrigger` (only `mapselecttag` + Player H2H per-role) and NO preview isolation flag (except `PH2H_PREVIEW_ONLY`) — a tag doing anything beyond local DOM changes needs its own guard. Set `previewButton: true` if wanted.
- **Draft-style heavy pages:** `deferredPreview: true` (iframe stays `about:blank` until Preview pressed; page needs `previewTrigger` + `PREVIEW_ONLY` guard that skips real SSE and the restore fetch). Add a `GET /overlay/<key>-state` if using a bespoke boolean.

## Control-tab Preview — keep it isolated from real broadcast state

- `previewButton: true` → page is already loaded in the iframe; button calls `contentWindow.previewTrigger(event,'show'|'hide')` locally (no SSE).
- **Any `?preview=1` page must decouple from real state:** (1) don't auto-show/hide from real SSE or restore — mplfs uses `isPreviewFrame`, Draft uses `PREVIEW_ONLY`; (2) don't let side effects hit the server (e.g. `syncBoard()` must skip its `fetch` — this once flipped real vMix boards on a preview click). To tell the dashboard, use `window.parent.postMessage(..., location.origin)` (receiver: `previewToggleRegistry`).
- Only one Preview is active at a time: always build via `buildPreviewToggleBtn(eventName)` (uses `activePreviewOff`); `previewToggleRegistry` is for *passive* reflection and bypasses exclusivity.
- `activePreviewOff`, `previewToggleRegistry`, `draftPreviewActive`, `mplfsLiveBadge`, `mapSelectTagBadge` and any new cross-render state referencing `#control-panel-body` DOM must be reset at the top of `buildControlBody()`.
- Testing: `mplfs.html?preview=1` + `previewTrigger(event,'show')` renders a scene against the current feed safely. `Draft.html?preview=1` same. `DraftIndex*.html` has no preview mode.

## mploverlay_v7.html — two feature shapes

**Shape 1 — persistent panel:** checkOverlays pattern. Functions share a short prefix (`icBuildPanel/icAnimateIn/icAnimateOut` = item check, `ecc…`, `gdc…`). Side-checks share `SIDE_CHECK_HANDLERS` in `overlay-debug.js`.

**Shape 2 — automatic per-player reactive effect** (Lvl 15, Item Pickup, Trinity, Swap, Conceal, Kill Events, Objective Spawn, Sky Piercer, Lord Advantage). Fires from `masterPoll()` (1s), armable from the dashboard, queued per player. Steps:
1. Arm toggle: key in `VALID_FEATURES` (`routes/overlay.js`, generic `/overlay/feature/:feature/:action`), default in `featureEnabled` (`overlay-core.js`) — **forgetting this default is the real breakage** (the generic `featuretoggle` listener only updates existing keys) — and `{name,feature}` in dashboard `featureToggles` (+ `lib/state.js`).
2. Detection in `registerPollHandler` in `overlay-debug.js`: diff against a `prevXxx` object, gated on `featureEnabled.x`.
3. `triggerYourFeature(i,…)` shaped like `triggerLvl15`: re-entrancy guard on `isPlayingX[i]`; once-only `cleanup()` that resets visuals, clears the flag, and **calls `playNextQueued(i)`**; plus a safety `setTimeout(cleanup, a bit longer than the animation)`.
4. Mutual exclusion: `isPlayingX = {}`, `xQueue = {}` in `overlay-core.js`; add to `isAnyPlaying(i)` and an `else if` in `playNextQueued(i)`.
5. Debug bar: `▶ Pn` buttons + `tab-x`/`data-tab` markup in mploverlay_v7.html.
6. Preview Tester: branch in `window.iframeTest(playerIdx, feature)` (`previewDebugTester: true`).
7. Verify from a real poll tick — the debug button bypasses detection and proves nothing about step 2.

Feature notes (mostly unverified against a live feed):
- **Sky Piercer** (`overlay-skypiercer.js`): Item Pickup card at stack 3/5/7…; stack from `player.extra_param.sky_piercer_stack.stack` (real path never confirmed).
- **Lord Advantage** (`overlay-lordadv.js`): panel under each tricode for 90s from `camp_list[].kill_lord_advantage.begin_time`, live-updating GOLD/KILLS/TURRET; not in Edit tab.
- **Trinity / First Item Priority phase 2:** at 1.5s the title swaps to a core-item timing line (`coreItemPhase2()` in `overlay-trinity.js`; `core_item`/`first_item` paths unconfirmed); no data → card leaves at 2.4s as before.
- **Kill events:** `killEventTrigger` dashboard picker + Live/Random photo toggle are bespoke. Playoffs webms in `assets/overlay/ingame/playoffs/motion/` have no baked sponsor; sponsor logo is a separate element (`KILL_EVENT_SPONSOR_LOGO`, `killEventApplySponsorFit`).
- **Objective spawn:** `objSpawnPlayNext` picks lord/turtle webm per theme.
- **Gold Graph Check / Live Win Rate:** fixed checkpoints at 2, 5, 8, 12, 15 min then +3 (`ggcMarkMinute`/`lwrMarkMinute`); last group is the live "now" dot. Live Win Rate reads the Winrate API (`/api/winrate-proxy`, `{camp1,camp2,time}`); shares Gold Graph's art; neither restored on page load. Playoffs title art `assets/overlay/ingame/playoffs/graph_header.png` (recoloured Regular art — redo if Regular changes).

## ENTVC.html — mirror of Waiting TVC

`ENTVC.html` duplicates mplfs.html's Waiting TVC, Waiting Lobby, Today's/Tomorrow's Schedule, Standings. **Any Waiting TVC change in mplfs.html (features, CSS, art, tunables) must be hand-ported to ENTVC.html.** Waiting Lobby is NOT covered — mplfs-only unless the user asks. EN Casters uses its own `ws-encasters-*` selectors and `entvc_encasters` Edit config — independent on purpose. Position/size edits are automatic (both read the same `mplfs` bucket for shared selectors); a shared tunable value uses a small JSON file + route like `credits_speed.json` (`/api/credits-speed`).

## Theme system — Regular / 10th Anniversary / Playoffs

- One global value in `theme.json`, `GET/POST /api/theme` (`routes/devapi.js`, whitelist `THEME_VALID`), broadcast as SSE `theme`; Settings page `<select id="theme-select">` with confirm dialog.
- `html/js/theme-apply.js` (on EVERY broadcast page, after `cache-bust.js`) sets `data-theme` on `<html>`. Its initial read is a deliberately **synchronous XHR** so every later script can read `data-theme` at load time (async fetch caused wrong-asset-every-load bugs). Pages with a live SSE add `sse.addEventListener('theme', e => applyTheme(JSON.parse(e.data).theme))`.
- A 4th theme = update by hand: `THEME_VALID` (devapi.js), `THEME_VALUES` (theme-apply.js), `THEME_VALUES` + `THEME_LABELS` + a `<option>` (dashboard.html). Same for API modes (`API_MODES` in `lib/apiMode.js` + dashboard + 3 `.api-mode-seg-btn`s).
- **Themes are cosmetic by default** (look only — never behavior, timing, layout, or which elements exist). Exception: Playoffs may be a full per-scene re-layout when the user supplies a reference + `assets/<scene>/playoffs/`; do it scoped to `[data-theme="playoffs"]` and leave Regular/10th Anniversary untouched. If tempted to branch behavior on `data-theme` otherwise, confirm first.
- CSS: scope to the specific theme. **Never write `:not([data-theme="regular"])`** or gate on an absent attribute. Where Regular already sets the same property, use a CSS custom property (`--anniv-accent` with a `var()` fallback) instead of a competing rule. JS-picked values (video `src`, asset dirs) use a per-theme lookup table with fallback to Regular (`SCENE_VIDEO_SRC_BY_THEME`/`getSceneVideoSrc`, `gdcAssetDir`, `icAssetDir`, `mbAsset()`), decided at show/build time — theme switches apply on next show/reload.
- Playoffs assets live in a `playoffs/` subfolder with the same filenames as Regular. Check pixel size against the old file. Gold = `#edc555` → `#d0a43e`; black text on gold/white, white on blue/red.
- **"Copy exactly X" means every themed rule scoped to X's id/class family** (asset, background removal, recolour, reposition) — grep for all of them, not just the background image.

### Edit tab is theme-scoped
`overlay_styles.json` (`routes/overlayStyles.js`) stores `{[file]:{[selector]:{left,top,width,height,fontSize}}}`. Regular uses the plain `file` bucket; other themes use `file::theme` (`mplfs::playoffs`). GET merges per selector (themed wins, else Regular). Nudges seed a new themed entry from Regular first. Overrides are injected as `!important`, so **a Regular override beats a plain `[data-theme]` rule: when theme CSS "isn't taking" — or a playoffs `left/top/width/height` loses — check `overlay_styles.json` and seed the `<file>::playoffs` bucket.**

### Playoffs conventions
- **Universal sponsor box (mplfs.html):** every playoffs sponsor box shares one CSS block ("PLAYOFFS UNIVERSAL SPONSOR BOX") on the shared classes (`.sponsor-cat-label`, `.wl-/.ws-sponsor-loop`, `.wl-sponsor-bg`/`.wsm-sponsor-bg`) — never per-scene ids. Gold header strip with the sponsor category over a white logo area, 296x120 (37px strip). A new/reworked scene with a sponsor box uses the standard markup (as in `buildTsSponsor`), adds its selector to the "Default box size" rule, seeds position in `mplfs::playoffs`, and gets the Edit row from `addPlayoffsSponsorEdit()` (add its pair to the list above `var EDIT_CONFIGS`). That row edits all playoffs sponsor logos at once (except Consolidated Post 2's).
- **Sponsor loops** use `SponsorCursor.start(len)` / `SponsorCursor.aired(idx)` (`sponsor-cursor.js`) so scenes resume after the last sponsor aired; any new loop must too.
- **BNW photo crops:** `assets/photo/Dynamic/3_CROPPED BNW/<TRI>_<ign>.webp` (`thBnwUrl`) are used by Team Hexagon, Post 4 Key, and Post H2H under playoffs (greyscale + team-colour tint; missing crop → signature portrait). A new player needs this crop, plus `assets/photo/hires_l3/LEFT|RIGHT/<ign>_*.webp` for L3 Lobby, or it silently falls back.
- **Header bar text** (`MPL PH S18 PLAYOFFS` / `DAY n`): 30px, centred in the baked bar sections; Edit bucket once pinned 34px `!important`, so check the bucket.
- **Match counts (playoffs):** Days 1–3 = 2 matches, Days 4–5 = 1; Day spinner to 5, no Week counter. `poMatchCount(day)` (Match Board), `buildTsMatches`/`msToTomorrowMatchRows` (mplfs), `poWsCount` (Waiting TVC, both pages), Today's highlight cycle in `routes/overlay.js`. 1-match layouts are seeded in `mplfs::playoffs` with no Edit config.
- **Scenes already reworked for playoffs:** MVP Scene/Highlights, Team Hexagon, Today's/Tomorrow's Schedule, Waiting TVC (+ENTVC) and Lobby, Line-Up Blue/Red, Bracket, Final Team, Consolidated Post 2, Post Match Board plaques, v7 scoreboard/checks/player UI, Draft, DraftIndex, assets/sponsor/sponsortv/ingame_*, mpltag Map Selection.
- **Art not provided yet (don't invent):** star-match scoreboard art (`ingamepng2_<SUFFIX>.png`), Side Selection card (`blueselect/redselect.png`), `mapdetail_v2.png` for Draft, Draft player plate backs / hero name banners / picking webms, Post H2H sponsor rework, ban-selection red glow and `bluepickbg1/redpickbg1.webm`, `assets/photo/Playoffs Sched/` teams APBR and TWIS.
- **Player boxes stand on the bottom edge** in playoffs Line-Up (`top + height = 1080` for `.lu-player-N`); keep that if resizing.
- **Post 4 Key playoffs:** photo container +120px (cards 416x629); `p4kExtendedArt` stretches `bigfour*.png` on a canvas at show time. Bottom of card y=1002.
- **Final Team** playoffs uses the plain MPL logo (`#ft-mpl-logo` content override).
- **Playoffs Waiting TVC:** QR (`#ws-qr`, `#ws-qr-text`) mirrored in both pages; logos in `MatchBox_*` slanted areas (96x96, slot centres x 165.5/404.5). Team Line-Up stinger `LU_STINGER_SRC_BY_THEME.playoffs`.
- **Bracket:** playoffs background is always `playoffsbg_theme.webm`; `#br-header-bg` webm does the fading. Leaving base pose: bg/fades first, tilt `BR_BG_LEAD_MS` (550ms) later; return is mirrored. Decided series: loser `.br-defeated`, winner path glows (`.br-glow-on`, `BR_PATHS`, opacity-only pulse — never animate the filter on the 3D plane). Pre-warming bracket background videos was tried and **reverted** (worse).
- **Draft Stats gradient map** uses `backdrop-filter: url(#po-gradmap)`; if vMix fails to render it, fall back to a `grayscale() sepia()` chain.

## Other scene notes

- **Team Line-Up V2** (`lineupv2_blue/red`), **Credit Reel V2** (`credits_v2`), **MVP Scene V2** (`mvp_v2`), **MVP Highlights V2** (`hl_v2`): V1/V2 buttons via the `versionToggle` field on `features`; V2 = polaroid intro / 480px side panel at x=1440 / transparent-over-camera scene / no signature photo. Each has its own Edit config where needed (`mplfs_credits_v2`, `mplfs_mvp_v2` — V2 rows save under `html #mvp-page.mv-v2 <id>` to win over V1) and a forced-version `showXxxV1/V2` for the Edit preview.
- **Team Hexagon playoffs "V3"**: CSS/SVG re-layout (no Edit config); radar centre (960,504).
- **Post Gold Distribution** (`post_golddistri`): lanes matched to the game feed by player NAME — spelling mismatches between feeds put lanes wrong. **Post Kill Events** (`post_killevents`): objectives from Post-Info `camp_list`, kill map from `/events` × `/positions`. **Post H2H** page 2 = gold distribution; `GET /overlay/p2hpage/1|2`; each fresh show resets to page 1.
- **Post Heatmap / heatmap.html**: show/hide key `heatmappage` (hidden by default = no loop/fetch; `?preview=1` always shown); live style via `GET/POST /api/heatmap-style` + SSE `heatmap_style` (mplfs scene not affected).
- **Hero art:** `assets/hero/web/HERO_<id>_KOTAK.webp` via `hero-web.js` for mplfs/v7; **Draft.html deliberately keeps `assets/hero/full/thumb/`** (200px PNG) — regenerate it when a new hero is added.
- **DraftIndexV2:** hero cards are compositor-only (canvas pre-paint, `scaleX` window) — don't reintroduce animated `clip-path`/`filter`/CSS `blur()`/`mask-image` on them. `DV2_SHOW_CHROME` false.
- **L3 Lobby (`mpltag.html`, `l3lobby`):** Superfan ticker (`/api/dynamic-content`); player swap uses `img.decode()` and swaps both sides together (vMix stutter fix); `.l3l-sf-inner` scales uniformly via `fitSuperfan`.

## LED wall pages

Two 2532x1024 sources (`led_overlay.html`: 10 player plates; `Led_draft.html`: draft cards; plus 242px mid panels). Control-tab entries use `previewSize: [2532,1024]`; `routes/led.js` holds `/led/*`. Not wired: Edit-tab positioning, Preview buttons. Shared engine `js/led-events.js` (IIFE).

- **Side:** Match Board HOME = left square regardless of camp, via `LedAutoSide.resolve(camp_list)` (needs team spellings to match `/match/state`, else falls back to manual HOME/SWAP; `applySwap()` prefers `autoSwap` when non-null).
- **Events:** plate events (First Item, Trinity, Quick Swap, Lvl 15, Conceal, Sky Piercer) use their own `led_*` keys, armed independently of v7's; state tracked per SEAT so HOME/SWAP can't fire false events. Right plates' item bar is 16px further right (`.camp2 .led-evt-clip { left: 257px }`). Mid panels (Team Health / Win Probability / Team Fight / Draft Predict) via SSE `led_health|led_win|led_fight|led_draftpred`; start `display:none` set **inline** (guards test `style.display`); a reel animation covers only the lower region (y 357+). Lord Advantage not ported.
- **Rule:** features ride existing events with new `action` values; listeners must **ignore unknown actions** (an old else→hide once hid Draft Predict on every photo-mode toggle).
- **Draft Predict** = Draft.html's v3 engine; stays up until Hide; shown state persisted in `checkOverlays.led_draftpred`. Dashboard test buttons relay to the real LED instance via `/led/draftpredtest-reveal|slot`.
- **LED Draft:** colour follows CAMP, layout follows SIDE (right side = mirrored left). Player photo source is LED-only (`ledDraftPhotoMode`, `/led/draft-photo-mode`). Picking glow/video are Draft.html's per-theme defaults — don't re-tint/re-bake. No role icon / `/api/draft-roles` (user removed; don't re-add). Edit the file directly (generator was throwaway). Opt-in `?heroloops=N` limits hero-clip looping.
- **Perf rules:** raster (not JS) was the cost — per-frame animation needs its own compositor layer (`will-change: transform` on BOTH `.ekg-zone-led` and `.heart-bpm`); EKG lines are 62x28 `<canvas>`, not animated SVG `d`; write DOM only on change (death timer, `setText`, `dataset.src` — never compare `img.src`); no rAF/canvas/`<video>` for hidden panels, create media lazily.
- **Testing without a live feed:** throwaway Node mock of the server (static files + mutable `/api/gamedata-proxy`, `/proxy/predictions`, `/api/draft-url`, `/match/state`, `/api/player-photos`, `/led/*`, `/__push?event=&data=` for SSE) + headless Edge over CDP. Fixtures `predictions_test.json`, `sub-info_sample.json` (contains U+00A0/U+2028 — strip before `JSON.parse`). Gotchas: `pkill -f` must match how the mock was launched; never `curl` big JSON without `| head`.

## API Mode — LIVE / WEB / DEBUG (`lib/apiMode.js`)

Settings' 9 API URL fields (Game, Standings, Draft, Draft Recap, HRM, Team Hexagon, MVP Highlights, Draft Index, Post-Info) each store `{live, web, debug}` in their `*_api_url.json`; `api_mode.json` picks the active one; switching is server-wide and confirm-gated. **All reads/writes must use `readUrlForMode(file, default)` / `writeUrlForMode(file, url)`** — never read the file's `.url` directly. `lib/pollers.js` and `lib/hrmPoller.js` read these too. (Changing the on-disk shape while old route code is loaded once served the raw shape until restart.)

## Event log — Logs tab + Control-tab load status

`lib/eventLog.js` (ring of 2000 + `logs/events-YYYY-MM-DD.jsonl`) and `routes/eventLog.js` (`POST/GET /api/event-log`, `/days`, `/download`). Pollers call `eventLog.health(key,label,'ok'|'slow'|'down',info)` (logs only state changes). `event-log-client.js` auto-reports failed/slow fetches, broken media, JS errors; `OverlayLog.warn/critical` for explicit lines; `wrapScenes` (mplfs `olScenes`) gives one verdict per show. **Must stay zero-cost:** nothing awaits logging, never branch on it. `?preview=1` pages report as `preview`.

## Performance and rendering lessons (vMix)

- Headless Edge can't reproduce vMix; measure with `Emulation.setCPUThrottlingRate` ~20x + Tracing + rAF gap logger. **Always A/B** — plausible optimisations have made things worse; revert what doesn't measure better.
- **Cheap:** transform/opacity animation, `will-change` layers, canvas pre-paint, WebP copies with PNG fallback, `img.decode()` before fades, staggered swaps, pausing hidden videos. **Expensive:** full-screen 1080p60 VP9 loops (dominant idle cost), big PNG decode at swap time, animated SVG `d`/mask/clip-path/filter, repainting big tilting containers.
- **Videos:** never `autoplay` an idle full-res loop. `hideSceneVideo()` `.pause()`s ~400ms after fade-out (guard by the captured element's class); `showSceneVideo` skips re-assigning an unchanged `src` and is called in `transitionToImpl` **after** `hideActiveFeature()` is awaited (before, the outgoing scene's delayed hide killed the new layer). `#bg-video` is paused on first frame by design. The playoffs corner-shapes overlay was removed entirely.
- **Baked alpha:** Draft.html's hero reveal uses WebM with real alpha (pre-baked offline) + `destination-in` compositing instead of per-pixel JS. ffmpeg's default VP9 decoder ignores alpha — pass `-c:v libvpx-vp9` to verify. No ffmpeg on this machine (installing needs user OK), so videos can't be re-encoded here.
- **Never size/fit content by measuring a possibly-hidden element** (`scrollWidth/clientWidth/getBoundingClientRect` are meaningless under `display:none`). Use canvas `measureText()` (detached canvas, e.g. `annivTextWidth`) or compute from known values. Same bug class as the theme-apply race.

## Data, assets, fonts

- Game data: `campid` 1 = blue/left/team1, 2 = red/right/team2 everywhere. MVP data from `game-mvp/view` (`/api/highlights-url`, `hlFetchMvp`/`hlExtractPlayer`); match/game number from `/match/state`.
- Paths: `/assets/hero/mvp/MVP_<heroid>.png`, `/assets/hero/highlights/<heroid>heromvp.png`, `/assets/game/items/<id>.png`, `/assets/game/role/<role>.png`, `/assets/team/logos/<TRI>.png`, `/assets/game/emblem/square_<id>_RUNES.png`, player photo via `hlPhotoUrl(name)`.
- **Any `fetch()` of runtime-changing JSON needs `{ cache: 'no-store' }`** (hard refresh doesn't bypass fetch cache).
- **`cache-bust.js` appends `?v=` to every `img.src`** — never compare `img.src`; use a flag/`dataset`. Re-assigning an `<img src>` to a missing file every poll flickers; remember applied/missing URLs (`sbSetImgWithFallback`, `mvSetImgWithFallback`).
- Fonts: **Anton** (black `#0a0a0a`) for big numbers/titles; **General Sans** bold for names, semibold uppercase for labels.

## Gotchas

- Removing CSS with a script can leave orphan declarations that swallow the next rule — render the scene and check neighbours; the syntax check only parses JS.
- Apostrophes in asset paths (`/assets/overlay/Today's Schedule/…`) break inline `onerror="…'…'"` → write `%27`.
- `transform` on a clipped parent doesn't change layout — for scaled groups set the layout box at native size and scale around a fixed origin (mpltag Map Selection scales 0.84 / 0.72 at 6 / 7 games, `applyMapselScale`).
- Sequenced behaviour that reads a measurement, theme, or broadcast before it exists fails deterministically but looks flaky — look for the async gap.

## Verifying with a real browser (no Playwright dependency)

Headless Edge over raw CDP (Node has native `fetch`/`WebSocket`):
```
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless=new --remote-debugging-port=9222 \
  --user-data-dir=<scratch> --autoplay-policy=no-user-gesture-required about:blank &
```
Get the target's `webSocketDebuggerUrl` from `http://localhost:9222/json`, then `Page.navigate` / `Runtime.evaluate`. Use `--virtual-time-budget` only for short synchronous checks; for video or timer-paced work use a real background process and real sleeps. Never `await` a `Runtime.evaluate` that sets `location.href` (wrap in `setTimeout(...,10);1`). Kill orphaned harness Edge processes (by `--user-data-dir`) before trusting perf numbers.

**Tests must not leave real shared state changed** (`state.mplfsScene`, `checkOverlays`, `draftActive`, `api_mode.json`, the 9 `*_api_url.json`): capture first, restore after (`curl .../fs/hide` fully resets mplfs). Prefer an isolated harness: extract the real `<script>` from the file into a scratch page and expose internals via `window.__test`. Stub fetches via `Page.addScriptToEvaluateOnNewDocument`; jump to a scene's end state by adding its final CSS class. For mpltag.html, a regex `<script>` extraction fails on a comment containing `<script` (ignore) — slice the IIFE by `indexOf` and append `window.__t = {...}`.
