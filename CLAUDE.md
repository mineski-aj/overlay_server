# overlay_server — instruction manual

MLBB esports broadcast overlay system. Each overlay is a browser-source HTML page (OBS/vMix) driven by live game data and controlled from a central dashboard. Read this before touching anything.

## Running it

`node server.js` (or `npm start`), port 3000. Dashboard `/html/dashboard.html`; overlays under `/html/`.

**`routes/*.js` and `lib/*.js` are NOT hot-reloaded — restart required.** `html/*.html` changes apply on next page load. If you edit a route/lib file, say so and ask before restarting: the server is usually the user's own terminal process; never kill/relaunch silently. (Editing a `*_api_url.json` on-disk shape while old route code was loaded once served the raw `{live,web,debug}` shape instead of `{url}`.)

## Map

- `server.js` — Express entrypoint; mounts `routes/`. `routes/*.js` — API endpoints.
- `html/mplfs.html` — main scoreboard/scene overlay (full-screen "scenes": MVP, Final Team, Waiting Lobby, Line-Up, Casters, Standings...). New scenes go here.
- `html/heatmap.html` — standalone always-up copy of mplfs's Post Heatmap scene (transparent 1920x1080). Generated once from the scene; **edit directly now, hand-port scene fixes**. Fills from `/api/heatmap-config` + `/positions` + game feed, loops, re-pulls at loop wrap and on SSE `heatmap_config`. Uses shared SharedWorker SSE (`theme`, `heatmap_config`, `reload`) and the SAME saved Edit-tab overrides as mplfs (`mplfs` bucket, `#hm-*`/`.hm-*`/`#hmst-*`), so "Post Heatmap · mplfs" in Edit positions both.
  - Style: dashboard Control → Heatmap → "Heatmap Style" (brightness, contrast, per-heat-stop brightness (`hmBuildCmap`), kill/death/assist marker sizes via CSS vars, Player Photo Shown/Hidden (`.hm-nophoto` on `<html>`)). `GET/POST /api/heatmap-style` (routes/devapi.js, `heatmap_style.json`, clamped) broadcasts SSE `heatmap_style` → `hmApplyStyle`. mplfs scene unaffected.
  - Show/hide (GPU saver): checkOverlays key `heatmappage` (`/overlay/heatmappage/show|hide`, SSE `heatmappage`). **Hidden by default** (`display:none`, no RAF/fetches). `?preview=1` copies are always shown. `heatmappage`/`heatmap_style` are in `KNOWN_EVENTS`.
- `html/mpltag.html` — lower thirds / small "tags" (Map Selection, L3 Lobby, Player H2H). Same 1920x1080 transparent conventions; multiple tags can show at once (no `activeFeature` slot). New tags go here.
- `html/dashboard.html` — control panel: SHOW/HIDE/PREVIEW per feature + **Edit tab** (drag/resize/font editor, persisted to `overlay_styles.json` via `routes/overlayStyles.js`).
- `html/match-dashboard.html`, `map-selection-dashboard.html`, `standings-dashboard.html` — always-mounted iframes in the dashboard; use `html/js/relay-client.js` not their own `EventSource`.
- `html/js/overlay-shared-worker.js` + `overlay-sse-shim.js` — the ONE real `/overlay/events` connection per browser (SharedWorker). Every overlay page uses `createOverlaySSE()`, never `new EventSource(...)`.
- `html/led_overlay.html`, `Led_draft.html`, `js/led-events.js` — 2532x1024 LED-wall pages (see LED).
- `html/DraftIndexV2.html`; `js/hero-web.js` (WebP hero portraits w/ PNG fallback for mplfs/mploverlay_v7); `js/theme-apply.js` (global theme → `data-theme` on `<html>`).
- Asset folders: `heromvp/ herohighlights/ hero/ items/ role/ logos/ emblem/ photos/ hires/` (by asset type).
- Root `*.json` (`match_state`, `positions_live`, `overlay_styles`, `mainroster`, `theme`...) are live state; don't hand-edit.
- Cross-project memory: `/Users/ajsarmiento/.claude/projects/-Users-ajsarmiento/memory/` (`reference_mlbb_api.md` for main-info API shape; `feedback_*` for UI rules).

## Dashboard architecture — tabs, iframes, connection budget

`dashboard.html` is one page with `.page` divs (Match Board, Map Selection, Standings, Roster, Sponsors, Dynamic, Control, Edit, Settings) switched by class toggling — most stay mounted.
- **Always-mounted:** Match Board, Map Selection, Standings iframes (stay synced in background).
- **Released on navigate-away:** Control's `#preview-iframe` and Edit's `#edit-iframe` reset `src` to `about:blank` on top-level tab switch (`tabBtns` handler).

**Unload an iframe with `src = 'about:blank'`, never `''`** — empty string resolves to the parent page and loads it recursively.

**Why:** HTTP/1.1 caps ~6 connections per host for the whole browser. Persistent `EventSource`s from always-mounted tabs / separate overlay pages exhaust it; extra requests queue forever with no error ("dashboard hangs").

**Fix: SharedWorker** holds the single `EventSource('/overlay/events')` and rebroadcasts named events via `postMessage`; `createOverlaySSE()` exposes the same `addEventListener/.onopen/.onerror/.close` API. Migrated: dashboard, mplfs, ENTVC, mpltag, Draft, DraftIndex, `overlay-debug.js` (mploverlay_v7). **Not migrated: `html/fights.html`** (non-standard host/baseUrl + manual reconnect; needs individual verification). dashboard.html's own relay (`relayCache`/`relayIframeIds`/`relaySend`, `connectRelay` in iframes) still fans one page's connection to its iframes and composes with the worker.

**New overlay page needing SSE:** include `overlay-sse-shim.js`, call `createOverlaySSE()`. **New named event:** add to `KNOWN_EVENTS` in `overlay-shared-worker.js` (else it silently never arrives) AND **bump `OVERLAY_WORKER_VERSION` in `overlay-sse-shim.js`** (workers are reused by exact URL; already-open tabs/OBS sources keep the old worker otherwise). Required on any change to `overlay-shared-worker.js`. Currently v38.

**Before calling a feature done, verify the Control-tab toggle AND the real SSE round-trip** — `curl /overlay/<key>/show` only proves the route exists. Load a fresh browser context, click the real Control toggle, confirm a *separate* tab reacts.

## LED wall pages — `led_overlay.html`, `Led_draft.html`, `js/led-events.js`

Two always-on 2532x1024 sources: a gold-framed 1024 square each side (`assets/led/goldborder.png`, 12px ring) + two 242px **mid panels** (`#mid-left/#mid-right`: logo + tricode + 4 stat boxes, art `sidebacker.png`). LED Overlay = 10 player plates; LED Draft = draft cards. Both are Control-tab entries with `previewSize: [2532,1024]` and the same `extraActions` (HOME/SWAP + four mid-panel Show/Hide pairs). Data: `/api/gamedata-proxy`, `/feed` (BPM), `/api/winrate-probability` (routes/proxy.js), `/proxy/predictions`. HOME/SWAP = SSE `led_side` via `/led/home|swap`. Not wired: Edit-tab positioning, Preview buttons. `routes/led.js` holds all `/led/*`.

**Auto side (`js/led-autoside.js`):** Match Board HOME = left square, AWAY = right, regardless of camp — only if BOTH game-feed camps match the Match Board teams (`team_simple_name`/`team_name` vs `/match/state` `short`/`name`, case-insensitive). `LedAutoSide.resolve(camp_list)` → swapped / not / `null`. Pages keep `manualSwap` and `autoSwap`; `applySwap()` uses `autoSwap` when non-null. Spellings must match or it silently falls back to manual.

**Server restart pending** (ask first): `lib/state.js` (`led_*` toggles, `checkOverlays.led_draftpred`, `ledDraftPhotoMode`), `routes/overlay.js` (`VALID_FEATURES` +`led_*`, `led_skypiercer`), `routes/proxy.js`, `routes/led.js`. No `KNOWN_EVENTS` change needed — everything rides `led_side|led_health|led_win|led_fight|led_draftpred|featuretoggle|theme` with new `action` values. Keep it so, and make listeners ignore unknown actions (an old `else → hide` fall-through hid the panel on every photo-mode toggle).

### `led-events.js` (IIFE)
Fed by `LedEvents.onData(gameData)` / `setSwapped(bool)`.
- **Plate events** (First Item Priority, Trinity, Quick Swap, Level 15, Conceal, Sky Piercer): v7 "eventer" style 502x89 card over the item row (`assets/led/eventback.png`), wipes in from the plate's outer edge, one-at-a-time per plate with per-type queue, safety-net timeout, shared `runCard()`. Right plates' item bar is 16px further right (`.camp2 .led-evt-clip { left: 257px }`). Armed by own keys `led_items|led_trinity|led_swap|led_lvl15|led_conceal|led_skypiercer`. Prev state tracked per SEAT. `runCard(..., p2fn)` checks core-item phase 2 at 1.5s (`timingFor()`). Lord Advantage not ported.
- **Mid-panel features**: Team Health / Win Probability / Team Fight / Draft Predict via SSE `led_health|led_win|led_fight|led_draftpred`. Panels start `display:none` set INLINE (guards test `style.display === 'none'`).
- **Team Health**: transform-only bar (`.thp-fill` slides, `.thp-fill-in` counter-slides), red `.thp-ghost` trail, green heal flash.
- **Mid-panel reel**: only the lower region (y 357..1024) reels; features live in `#led-reel-window` (667px) and drop in pushing `.mp-stats-inner` down; keyframes offset by exactly 667px (`ledReelIn/Out`, `ledMidOut/Back`). MutationObserver toggles `led-mid-out/back`, `led-reel-on`. `.mid-panel::after` (`sidebacker_plain.png`) covers baked dividers during the reel.
- **Draft Predict** = Draft.html's v3 engine (`dp*` mirrors `dp3*`); hero art from `candidates[].heroName` via `heronames.json`; reveals from `/proxy/predictions` `draftState`; polls from page load; **Show stays up until Hide**; both columns cleared on new draft/Show/SWAP; state remembered server-side (`checkOverlays.led_draftpred`). Not ported: plate gate, AI bubble. Dashboard test relay (Draft Overlay card ▶ buttons, checkbox "Also send to LED Overlay (live)") fires `/led/draftpredtest-reveal|slot` → SSE `led_draftpred` `test_reveal|test_slot`; polling suspended 15s per click.
- Debug panel (`` ` ``): per-event/plate triggers, side-panel Show/Hide, DP test picks.

### LED Overlay specifics
KDA column centres: left 295.7/376.2/456.7, right mirrored. Items update with `item-pop`. Mid panels fall back to `assets/mpl2026logo.png` when `logos/<TEAM>.png` missing (dataset flag — `cache-bust.js` appends `?v=` to every `img.src`, never compare `img.src`).

### Performance rules (keep)
- Raster, not JS, was the cost: per-frame things (EKG, heart pulse) need their OWN compositor layers (`will-change: transform` on BOTH `.ekg-zone-led` and `.heart-bpm`).
- EKG lines are 62x28 `<canvas>` (`drawEkg`), not SVG; ~30fps cap; flat idle line not redrawn. Don't go back to animating SVG `d`.
- Death timer: write text only when the second changes; toggle class only on state change.
- Poll paths write-if-changed (`setText`), cache image src in `dataset.src`, skip unchanged `setHP`.
- No canvas/rAF for hidden panels; no always-on `<video>`; create media lazily.
- Measure: Tracing `devtools.timeline,disabled-by-default-devtools.timeline,cc,gpu`, `Profiler`, MutationObserver attr-write counts, `Paint` clips. Bisect by hiding elements and re-tracing.

### LED Draft (`Led_draft.html`)
Per camp a 1000x1000 box at (12,12): header 163 (logo · slanted tricode block · series-score bars) + transparent middle 564 + player row 273 (5x200). Colour follows CAMP (blue=1, red=2); layout follows SIDE (`.side-left/.side-right`, flipped by HOME/SWAP; right = left mirrored via `scaleX(-1)` on header with logo/tricode un-flipped). Data = Draft.html's feed (`/api/draft-url`, `normalizeDraftPayload`, changed `BattleID` reloads), `/match/state` for bars, game feed for mid stats.
Slots: idle FRONT photo on CSS gold plate → picking turn: PICKING video + glow (NO role icon — user removed it with role-assignment code and `/api/draft-roles`; don't re-add) → FRONT → VICTORY → pick: `HERO_PICK_DRAFT_<id>.webm` matte-wipe reveal erases photo/glow, then hero-name strip pops up. Glow/PICKING video are Draft.html's per-theme defaults (`assets/motion/picking{blue,red}.webm`, already real alpha) — don't re-tint/re-bake.
**Photo source** is LED-Draft-only (`state.ledDraftPhotoMode`, `/led/draft-photo-mode[/:mode]`, SSE `led_draftpred` `photo_mode`): `live` matches names, `placeholder` = fixed stand-ins (camp1 → 0-4, camp2 → 5-9). Deliberately NOT Draft.html's `/overlay/draft-photo-mode`. Debug panel has photo-source buttons + draft sim (`__drSim`; must reuse the live battle id or the page reloads). Not ported: ban plates, timer bar, status text, map bug, coach row, Draft Stats/buff badges. File was assembled by a throwaway generator — **edit directly**.
**Perf:** idle cost = 10 looping hero webms. `?heroloops=N` plays each N times then holds last frame (~90% less GPU); default loops forever.

### Testing LED pages without a live feed
Throwaway Node mock server (static files + mutable `/api/gamedata-proxy`, `/proxy/predictions`, `/api/draft-url`, `/match/state`, `/api/player-photos`, `/led/*`, `/__push?event=&data=` for SSE) + headless Edge over raw CDP. Replay `predictions_test.json` for Draft Predict; `sub-info_sample.json` has U+00A0/U+2028 (strip before `JSON.parse`). Gotchas: `pkill -f` must match how the mock launched; never `curl` big JSON without `| head`; heredoc JS regexes can turn escapes into literal chars.

## ENTVC.html — EN broadcast mirror of Waiting TVC/Lobby

A mostly-duplicate copy of mplfs's Waiting TVC, Waiting Lobby, Today's/Tomorrow's Schedule, Standings scenes.

**Standing rule: any change to Waiting TVC in mplfs.html (features, CSS/animation, graphics, settings, future updates) must be mirrored into ENTVC.html.** Waiting Lobby edits stay mplfs-only unless the user asks. EN Casters positioning is independent (own `ws-encasters-*` selectors, Edit config `entvc_encasters`) — don't fold in.
- **Position/size edits:** automatic — both files share the `mplfs` bucket in `overlay_styles.json` for identical selectors.
- **Everything else:** hand-port to both (independent script blocks). New shared *tunable*: small dedicated JSON file + route like `credits_speed.json` (`/api/credits-speed`), fetched fresh on each show by both.

## Working from pasted design-tool CSS

Extract only `left/top/width/height` from each block; ignore background colors, z-index, radius etc. (export noise; the real background is an asset the user names). Nesting matters: "inside this container" → child `left/top` are relative to the parent, build as a positioned child.

## Scene architecture

Each scene is one full-screen container in `mplfs.html`:
```css
#foo-page { position:absolute; top:0; left:0; width:1920px; height:1080px; display:none; overflow:hidden; background:transparent; opacity:0; transition:opacity 400ms ease; }
#foo-page.foo-on { display:block; }
#foo-page.foo-visible { opacity:1; }
```
```js
async function showFooScene() {
  const dataPromise = fooFetchData();
  await transitionTo('foo');
  const data = await dataPromise;
  if (activeFeature !== 'foo') return;      // superseded mid-await
  fooApply(data);
  await preloadMedia(fooPage.querySelectorAll('img, video'), 1500);
  if (activeFeature !== 'foo') return;
  showSceneVideo('foo');
  fooPage.classList.add('foo-on'); void fooPage.offsetWidth; fooPage.classList.add('foo-visible');
}
function hideFooScene() {
  activeFeature = null; fooPage.classList.remove('foo-visible');
  return new Promise(r => setTimeout(() => { fooPage.classList.remove('foo-on'); hideSceneVideo(); r(); }, 420));
}
```
Never hide on `animationend` — use `setTimeout` + `activeFeature` guard (memory: `feedback_overlay_animations.md`).

## The #1 rule: every element is independently editable

Every image/video/text gets its own id/class and own absolute position; never nest in a shared positioning wrapper. To make an element editable, THREE places must use the exact same selector string (a miss = dead row):
1. **DOM** in `mplfs.html`.
2. **`..._DEFAULTS`** in `dashboard.html` — `{left,top,width,height[,fontSize]}` keyed by selector.
3. **`..._ELEMENTS`** in `dashboard.html` — `{group,id,name}`; `group` also drives arrow-key group nudging, so give an element its own unique `group` unless it should move with siblings.

Then register in `EDIT_CONFIGS`:
```js
mplfs_foo: { label:'Foo Scene · mplfs', file:'mplfs.html', styleFile:'mplfs', defaultsKey:'sb_edit_defaults_mplfs_foo', elements:FOO_ELEMENTS, defaults:FOO_DEFAULTS, showFn:'showFooScene' },
```

## Local debug card (`mplfs.html`, toggle with `` ` ``)

```html
<div class="feature-card"><div class="feature-card-label">Foo Scene</div><div class="feature-card-btns">
  <button class="dbg-btn show" onclick="showFooScene()">▶ SHOW</button>
  <button class="dbg-btn hide" onclick="hideFooScene()">■ HIDE</button>
  <button class="dbg-btn preview" id="preview-foo" onclick="toggleLocalPreview('foo', this)">◈ PREVIEW</button>
</div></div>
```
Also add `'foo'` to `toggleLocalPreview`'s and `window.previewTrigger`'s if-chains. Local-only (no other tabs/OBS). If the card has an enable toggle, read real server state on open (memory: `feedback_feature_toggle_state.md`).

## Live control (SSE) — 6-layer chain; all must use the same feature key

1. **`routes/overlay.js`** show/hide routes: set `state.mplfsScene.activeFeature` ('foo' / null), write `event: foo\ndata: {"action":"show"|"hide"}\n\n` to every `state.overlayClients`, respond `{ok:true,action}` with `Cache-Control: no-store`. All scenes share `GET /overlay/events`; `GET /overlay/mplfs-scene` returns `state.mplfsScene`.
2. **`mplfs.html` `connectSSE()`** listener: show → close config-bar debug, `setTimeout(showFooScene,100)`; hide → `hideActiveFeature()`.
3. **`hideActiveFeature()`**: `if (prev === 'foo') return hideFooScene();`
4. **`restoreScene()`**: `else if (scene.activeFeature === 'foo') showFooScene();`
5. **`dashboard.html` `OVERLAYS` → `id:'mplfs'` `features`**: `{ name:'Foo Scene', show:'/overlay/foo/show', hide:'/overlay/foo/hide' }` (generates buttons).
6. **`MPLFS_ACTIVE_FEATURE_MAP`** (`foo:'foo'`; key auto-extracted from `feat.show.split('/')[2]`) — separate from step 5; forgetting it leaves the "Showing" indicator permanently wrong with no error.

## checkOverlays pattern (simple independent on/off panels)

For single independent panels (Draft whole-scene, mploverlay_v7 scoreboard/player UI/item/emblem/golddiff checks/side-*-checks):
1. `lib/state.js`: boolean per key in `state.checkOverlays`.
2. `routes/overlay.js`: `GET /overlay/<key>/show|hide` flipping state + broadcasting a named SSE event. The four side-*-checks share ONE event `sidecheck` with a `check` field — do that for families only.
3. Restore: `GET /overlay/check-overlays` returns the whole object; page and dashboard fetch once on load.
4. Client `sse.addEventListener('<key>', ...)` toggling a CSS class.
5. Dashboard: add `{name,key}` to the overlay's `checkToggles` (auto-generates toggle + copy-route buttons). For a single whole-scene toggle use plain `show`/`hide` fields on the `OVERLAYS` entry.

**Default state matters:** if normally ON (scoreboard, player UI, Draft), default CSS to the SHOWN position and add a "hidden" class when told to hide — else every load flashes blank during the restore fetch.

**A hide animation must clear the WHOLE box** (e.g. `#scoreboard-overlay` hide is `translateY(-1080px)`, not the top bar's -130px). Re-check when adding children to an existing show/hide layer.

### Universal "hide all in a group"
One route in `routes/overlay.js` that flips every key and re-broadcasts each panel's OWN existing event/payload (no new event, no client changes). Wire via `extraActions` (not `checkToggles`).

### Dashboard must live-sync via SSE
`dashboard.html`'s `dashboardSSE` (right after `toggleMplfsFeature`) updates `featureStates`/`checkOverlayStates`/`mplfsSceneState` from SSE payloads. **Any new show/hide feature MUST get a listener there**, else its button drifts out of sync silently. Click handlers (`toggleFeature`, `toggleCheckOverlay`, `toggleMplfsFeature`) only fire the request; SSE echo updates UI.

## `mploverlay_v7.html` — modular per-feature files, two feature shapes

Thin shell loading one `<script>` per feature (`overlay-lvl15/items/trinity/swap/conceal/killevents/objectivespawn/fights/itemcheck/emblemcheck/golddiffcheck/sidecheck-core + 4 side*check/playerui .js`) plus shared `overlay-core.js` (state, polling engine, data tables) and `overlay-debug.js` (debug bar, the SSE connection, most auto-trigger detection). New features get their own `.js` + `<script>` tag.

**Shape 1 — persistent on/off panel:** checkOverlays pattern + naming prefix (`icBuildPanel/icAnimateIn/icAnimateOut` for itemcheck, `ecc*`, `gdc*`); side-checks add to `SIDE_CHECK_HANDLERS` in `overlay-debug.js`; listener in `overlay-debug.js` IIFE.

**Shape 2 — automatic per-player reactive effect** (Lvl15, Item Pickup, Trinity, Swap, Conceal, Kill Events, Objective Spawn, Sky Piercer, Lord Advantage): fires from `masterPoll()` (1s, `overlay-core.js`), armable from dashboard, queued per player.
1. **Arm toggle:** key in `VALID_FEATURES` (`routes/overlay.js`, generic route `/overlay/feature/:feature/:action`), default in `featureEnabled` (`overlay-core.js` — skipping this is what actually breaks it; the generic `featuretoggle` listener only writes keys already present), `{name,feature}` in dashboard `featureToggles`.
2. **Detection** in `registerPollHandler` in `overlay-debug.js`: compare against `prevXxx`, gate on `featureEnabled.yourFeature`.
3. **`triggerYourFeature(i,...)`** modeled on `triggerLvl15`: guard `isPlayingX[i]`; once-only `cleanup()` that resets visuals, clears the flag and **calls `playNextQueued(i)`**; safety-net `setTimeout(cleanup, a bit longer than the animation)`.
4. **Mutual exclusion:** `isPlayingX = {}` + `xQueue = {}` in `overlay-core.js`, add to `isAnyPlaying(i)` OR-chain and an `else if` in `playNextQueued(i)`.
5. **Debug bar:** `▶ Pn` buttons in `overlay-debug.js` + `<div id="tab-x">`/`<button data-tab="x">` in the HTML.
6. **Preview Tester** (`previewDebugTester: true` on `mploverlay7`): add a branch to `window.iframeTest(playerIdx, feature)`'s manual dispatch chain.
7. Verify from a real poll tick, not just the debug button (which bypasses detection).

`killEventTrigger: true` (video picker + Live/Random photo toggle) is bespoke to kill events.

### Features added later (unverified against a live feed unless noted)
- **Sky Piercer Stacks** (`js/overlay-skypiercer.js`, key `skypiercer`): Item Pickup card (label SKY PIERCER, `Items/2014.png`, "N STACKS") at stack 3, 5, 7… (largest odd ≥3 ≤ stack; a drop re-arms; first poll baseline). Stack from `player.extra_param.sky_piercer_stack.stack` (fallback `player.sky_piercer_stack`) — `getSkyPiercerStack()`; real path unconfirmed. Wired into `isAnyPlaying`/`playNextQueued`/`resetGameState` (`typeof`-guarded), debug tab, `iframeTest`, Preview Tester.
- **Lord Advantage** (`js/overlay-lordadv.js`, key `lordadv`): panel under each camp's tricode (`#lordadv-c1` left 338 / `#lordadv-c2` left 1218, top 78, 290x58), first child of `#scoreboard-overlay`. Shows +GOLD/KILLS/TURRET for 90s (`LORDADV_SHOW_MS`) from when the Lord dies, once per (camp, `begin_time`) — triggers when `camp_list[].kill_lord_advantage.begin_time` appears (not `end_time`), numbers live (also `data.kill_lord_advantage[campid]`). KILLS/TURRET = `score`/`kill_tower` diffs between snapshots. Not in Edit tab. Debug tab has inputs.
- **Trinity + First Item Priority phase 2** (`coreItemPhase2()` in `overlay-trinity.js`): after 1.5s the title becomes a timing line, held to ~4.2s. Trinity: `time ▲/▼ 33s FASTER/SLOWER` from `player.extra_param.core_item` (or `player.core_item`); First Item: arrow + seconds only (`.trn-p2-notime`) from `first_item`. `no_data`/zero times/zero diff → null → card leaves at 2.4s. `late` = slower. Looked up from `lastData` at the 1.5s swap. Green `#0b6b2a` on purpose. CSS `.trn-p2*`, `.trn-phase2`, `.trn-slower`. Debug "PHASE 2" dropdown. `core_item` parent path unconfirmed.

## mplfs.html scene notes

### Team Line-Up V2 (`lineupv2_blue|red`)
Per-side `featureToggles` V1/V2 button (`versionToggle` field). V2 swaps Phase 1's group photo for 5 polaroids (`photos/Dynamic/2_CROPPED BUT NOT BNW/<TRI>_<ign>.jpg`; TRI = Match Board `short`) dropping at jittered spots/tilts (`LU_POL_STAGGER_MS`, `LU_POL_HOLD_MS`), then Phase 2 as normal. `luApplyPolaroids` / `luPlayPolaroidIntro`; 404s dropped; none load → V1. Not Edit-tab elements. Needs restart (`VALID_FEATURES`, `lib/state.js`).

### Credit Reel V2 (`credits_v2`)
Same reel in a 480px panel at x=1440 (`#credits-viewport-v2`/`#credits-scroll-v2`, `#credits-fade-v2` x 960..1440). Background clipped: `showSceneVideo('credits')` sets `clip-path: inset(0 0 0 1440px)` (`svSetClip`; other scenes clear it); `crShowImpl` clips `#bg-video`. Edit config `mplfs_credits_v2`. Needs restart.

### MVP Scene V2 (`mvp_v2`)
`#mvp-page.mv-v2`: same background loop, no signature photo, smaller hero; OF THE GAME / "MATCH n - GAME n" keep V1 colours. Elements animate in `MV_V2_ELEMENTS_DELAY_MS` (1000ms) after trigger (`mvV2*` keyframes). V2 CSS is `!important`; Edit rows `mplfs_mvp_v2` (`MV2_*`) save under `html #mvp-page.mv-v2 <id>`. Reuses V1's Feather/Intensity. `mplfs_mvp` showFn is `showMvpSceneV1`. Needs restart.

### MVP Highlights V2 (`hl_v2`)
`#highlights-page.hl-v2`: no signature photo (and playoffs corner graphic `#hl-playoffs-coverer` hidden); `hlApply` skips the photo. Class set in `hlShowImpl`, removed on hide. `showHighlights` follows the toggle; `showHighlightsV1/V2` force it (Edit config previews V1). Needs restart.

### Team Hexagon — playoffs "V3"
Playoffs-only re-layout (CSS block "Playoffs — Team Head to Head V3"): header strip (inline SVG) with team logos only; centre panel `#th-po-center`; radar centre (960,504) R=261, 8 rings (`thR()`/`thCy()`, `TH_PO_AXES`); 2 groups x 3 bars (`setThBar` sets `data-lead`). Player panels (535x887, `.th-player`): `photos/Dynamic/3_CROPPED BNW/<TRI>_<ign>.webp` (`thBnwUrl`) + team-hue `screen` tint + frame + coloured `hires/LEFT|RIGHT` cutout. `thSwapPlayoffs` eases both images over the previous pair. No Edit config; CSS/SVG art (old `playoffs_hexa*` mostly unused; name plates still `playoffs_hexabluename/redname.png`).

### Post Gold Distribution (`post_golddistri`, internal `golddistri`)
Post-family (compact Matchboard, middle/player boards off; in `POST_FEATURES` + `COMPACT_MATCHBOARD_FEATURES`). Five lane columns (EXP/JUNGLE/MID/ROAM/GOLD), camp1 blue left. Data `/api/postinfo-proxy` `hero_list[].gold_map` (keys: 1 minions, 2 jungle, 3 turtle+lord, 4 turrets, 5 roam equip, 6 kills+assists, 9 roam vision; roam shows 5 and 9), `total_money`, GPM = total_money/minutes. Lane from game feed `seat.role` matched by NAME (fallback seat order) — differing spellings can mis-lane. Edit config `mplfs_golddistri` (`#pgd-cols` as one unit). Needs restart.

### Post Kill Events (`post_killevents`, internal `killevents`)
Same board handling. Left OBJECTIVES (TURTLE/LORD/TURRET/PURPLE/ORANGE/LITHO) from Post-Info `camp_list` (`kill_totoise` (sic), `kill_lord`, `kill_tower`, `blue_buff_num`=purple, `red_buff_num`=orange, `crab_kill_num`=litho + `*_time_list`), split bar. Right: `assets/postkill/killmap.webp` with hero portraits at kill positions (`/events` x `/positions` → `ckmGameToLocal`, same as Consolidated Post 2). Map name/icon like `fetchCmbData`. Edit config `mplfs_killevents`. Needs restart.

### Post H2H page 2 — gold distribution
Page 1 role stats; page 2 gold distribution for the same role's two players (MINIONS/JUNGLE CREEPS/TURTLE+LORD/TURRETS/KILLS+ASSISTS, +ROAM EQUIP/VISION for roamer → `#p2h-page.p2h-dense`, 80px pitch, `#p2h-sponsor` y=966). `gold_map` matched by NAME then heroid. `GET /overlay/p2hpage/1|2` (state `p2hPage`, SSE `p2hpage`, dashboard buttons); fresh show resets to page 1 (not from `?preview=1`). Title font-fitted by canvas measure. Needs restart.
**Playoffs phase-2 photo** (`p2hApplyCard`): as Post 4 Key below — B&W crop (`thBnwUrl`, TRI = camp `team_simple_name`), greyscale + `.p2h-photo-tint` (blue home/red away, screen) fading in with `.p2h-posed`; `.p2h-bnw` only while crop used; missing → signature portrait.

### Post 4 Key — playoffs
- **Taller box (+120px):** `.p4k-photo-box` 416x536, cards 416x629, everything below moved down 120 (`.p4k-crop`/`.p4k-name-box` top 477, `.p4k-stat-box` 525, `.p4k-value-box` 524), seeded in `mplfs::playoffs`. Art `bigfour*.png` (416x509) extended on a canvas at show time (`p4kExtendedArt`; `p4kApplyCard` returns a promise `fetchPost4KeyData` awaits). Card bottom y=1002 (baked "LAKAS NG PINAS" text at y≈1034).
- **Phase-2 photo:** B&W crop `photos/Dynamic/3_CROPPED BNW/<TRI>_<ign>.webp` (TRI from camp `team_simple_name`, added per seat in `fetchPost4KeyData`) with grayscale+contrast and `.p4k-photo-tint` corner gradient (`screen`), shown only while `.p4k-bnw`, fades in with `.p4k-posed`; fallback = signature portrait. Read at card-fill time.

### Playoffs header bar text (Today's/Tomorrow's/Waiting TVC/Lobby)
`MPL PH S18 PLAYOFFS` / `SEASON 18 PLAYOFFS` + `DAY n` on the baked bar of `S18_Header_playoffs*.png` (924x158; at y=140 black x 199-599, gold 601-727). 30px, centred in those sections (`#ts-season/#ts-week`, `#tw-*`, `.ws-po-phase/.ws-po-day`), nowrap. The `mplfs::playoffs` Edit bucket had pinned 34px `!important` (moved to 30 in `overlay_styles.json`). ENTVC's `#ws-week-label` uses identical rules.

### Match Board under playoffs (match-dashboard.html)
Day spinner to **5** (regular 3), Week counter hidden, preview line `D#`, no "next week". Iframe re-polls `/api/theme` every 4s. mplfs Tomorrow's (`computeTomorrowWeekDay`, `twTitleText`) is playoffs-aware (day+1, no wrap). Stored `week` untouched.
**Matches per day (playoffs):** Days 1-3 = 2, Days 4-5 = 1. Match Board `poMatchCount(day)` greys extra cards (Tomorrow's looks at day+1), Match picker hides Match 2 on Days 4-5 and Match 3 always, current match clamped. mplfs: `buildTsMatches` (`poCount`), `msToTomorrowMatchRows` (tomorrow day ≥4 or a GRAND FINALS label on match 1 → 1 row). Today's single row seeded as `#ts-matches.tsm-count-1` in `mplfs::playoffs` (left 131, top 521); no Edit config for 1-match layouts. `routes/overlay.js` Today's highlight cycle follows the same count (restart). **Waiting TVC list** (`#ws-matches`, mplfs + ENTVC, `poWsCount` in `updateWsFromState`) 1 box on Days 4-5; positions keyed to `.wsm-count-2` are seeded for `.wsm-count-1`, except `#ws-matches.wsm-count-1` top 370 (centred between header bottom y218 and SHOW STARTS IN y806).
**Waiting TVC playoffs logos** (`#ws-matches .wsm-logo-l/r`): `MatchBox_*.png` logo areas are slanted 125px parallelograms; slot centres x 165.5 left / 404.5 right (slot `left` 100/339, width 131), logos 96x96. Regular/10th Anniversary unchanged.

### Team Line-Up / Waiting Lobby — WebP photos & CPU
`luApplyPlayers` (`luSetPhoto`) and Waiting Lobby swap use `hires/<POSE>_web/<ign>_<POSE>.webp` (~60KB, `hiresWebUrl()`), PNG fallback (`wlPhotoUrl` unchanged; Team Hexagon also uses it). Photos cost ~0; steady cost was two full-screen 1080p60 VP9 videos (shared `playoffsbg_theme.webm` ~190ms/s, lineup corner shapes ~150ms/s). **`PoShapes` corner-shapes overlay REMOVED entirely** (webm still on disk, unused). Per-team intro webms (9-24MB) and stinger only run in Phase 0. No ffmpeg here (installing needs user OK).
**Playoffs layout:** player boxes `.lu-player-N` (`mplfs::playoffs`) have `top = 1080 - height` (230/230/180/230/230 for 850/850/900/850/850) so players touch the bottom edge; name tags shifted +53/+59/+49/+54/+52; `playoffs_bottomfeather.png` `display:none`; `.lu-po-logobox` unchanged. Keep top+height = 1080 when resizing.
**Playoffs stinger:** `LU_STINGER_SRC_BY_THEME.playoffs` = `/assets/lineup/playoffs/lineupstinger.webm` (Blue and Red; `getLuStingerSrc()`); per-team intros unchanged; read at Phase 0 start.

### Playoffs Waiting TVC QR
`#ws-qr` (`assets/Waiting Screen TVC/playoffs/QR.png`, box 962,45 162x162) and `#ws-qr-text` (SHARE / YOUR / FEEDBACK!, General Sans 800 22px, left 1126 top 48, black): independent playoffs-only elements (`display:none` elsewhere), mirrored in mplfs AND ENTVC. Edit: "Today's Matches · Waiting TVC" config (`WS_MATCHES_*`, groups "Playoffs QR"/"Playoffs QR Text").

### Final Team logo (`#ft-mpl-logo`)
Playoffs: `[data-theme="playoffs"] #ft-mpl-logo { content: url('/assets/mpl2026logo.png') }` (no sun burst). Regular/10th still `assets/postgame/mpl_logo.png`. Box stays 270x270.

### Sponsor loops share one resume point (`js/sponsor-cursor.js`)
Every sponsor loop (mplfs Waiting TVC `runWsSponsorLoop`, Waiting Lobby `runWlSponsorLoop`, `makeSponsorLoop` for Today's/Tomorrow's/Bracket/Consolidated Post 2/Post H2H/Middle Board; ENTVC Waiting TVC) starts at `SponsorCursor.start(len)` and calls `SponsorCursor.aired(idx)` when a sponsor goes on air. A NEW loop must use both or it restarts at #1. Running loops keep their own index; page-level state resets on reload.

### Bracket
- **Eliminated/winner glow (`brApplyData`):** series decided when a side reaches `brWinsNeeded` (BO5→3, BO7→4, none→BO5). Loser: all four slot pieces get `.br-defeated` (`grayscale(1) brightness(.5)`, 600ms, static filter). Winner path over `bracket_lines.png` glows (`.br-glow-on`, clipped copies per `BR_PATHS`, gold drop-shadow, opacity-only pulse — never animate the filter on the 3D plane). Only winner connectors glow (M1/M2→M3/M4, M3/M4→M5, M6→M7, M5/M7→M8). Merely leading keeps old `*_win` art. Rides the bracket `data` SSE refresh.
- **Pose moves (vMix frame-skip):** while off base pose (`brApplyPose`, `brAnimActive`) trophy video and playoffs sponsor loop are stopped after fade-out (`brTrophyPoseSync`, `brSponsorPoseSync`); `#br-trophy/#br-header/#br-sponsor` have `will-change: opacity`.
- **`showSceneVideo` skips re-assigning an unchanged src** (checks `getAttribute('src')`) — re-assigning restarts demux/decoder init.
- **Playoffs timing:** leaving base pose, the tilt starts `BR_BG_LEAD_MS` (550ms) after trophy/header/sponsor fades; return is mirrored (tilt first, then `surround()` `durMs+60`ms later, `brRestoreTimer`). Angle→angle and slider edits (durMs 0) and other themes move immediately. `brMoveTimer` cleared by every `brApplyPose` and hide.
- **Playoffs background:** `playoffsbg_theme.webm` always (`SCENE_VIDEO_SRC_BY_THEME.playoffs.bracket`; `bracket_anim` same file, `brSyncBg` never swaps). `#br-header-bg` (`HEADER BG_1920x250.webm`, playoffs only, at 0,0, behind `#br-header`) fades (opacity base?1:0, 500ms, `surround()`), played on base, paused ~560ms after fade-out (`brHeaderBgSync`).
- **Pre-warming bg videos was tried and REVERTED** (46 → 103 slow frames) — don't re-add. Remaining lever (delay bg swap to move end) changes visible timing; user hasn't chosen it.
- Measurement gotcha: orphaned headless Edge processes starve CPU/server and fake stutter — kill leftovers first (by the harness `--user-data-dir`/debug port, never by app name; memory `feedback_dont_pkill_edge.md`).

### MPL L3 Lobby strip (`mpltag.html`, key `l3lobby`)
Strip only (timer, sponsor loop, 2 players + plates, match box; four corner-HUD lines removed). **SUPERFAN ticker** (`#l3l-superfan`, 899x51 at left 12/top 788, z 9 in front of photos, slides with `.l3l-in`): fixed "MPL PH SUPERFAN CITY" label + scrolling Dynamic-tab text via `/api/dynamic-content`, `applySuperfan()`. Edit row group "L3 Lobby Superfan" in `mpltag_l3lobby`: left/top/width — the fixed `.l3l-sf-inner` scales to width/899 (`fitSuperfan`, ResizeObserver).
**vMix swap stutter fix:** overlay-only 640x640 WebPs in `hires_l3/LEFT|RIGHT/<ign>_LEFT|RIGHT.webp` (PNG fallback on error — **a NEW player photo needs a `hires_l3` copy**); `preloadLineup()` pre-decodes; fade waits for `img.decode()`; both players swap together in one `requestAnimationFrame` once BOTH decoded; `.l3l-player` has `contain: layout style`, photo layers `will-change: opacity, transform`. Biggest remaining cost: the 1920x1080 `playoffsbg_theme.webm` of which only the bottom 227px is visible.

### Gold Graph Check / Live Win Rate
- **Playoffs gold title bar:** `assets/ingame/playoffs/graph_header.png` = Regular `graph_header.png` (887x60) with only the white title trapezoid recoloured gold (x 200-690). Picked by theme at build time in `overlay-goldgraphcheck.js` (also `overlay-livewinrate.js`). Title sheen is a `background-clip:text` highlight. Regenerated by canvas recolour script — redo if Regular art changes.
- **Static time checkpoints:** fixed minutes **2, 5, 8, 12, 15, then +3 each** (`ggcMarkMinute`/`lwrMarkMinute`; `GGC_FIXED_MARKS`/`LWR_FIXED_MARKS` = 24 groups). Drawn only once reached. Last group (`*_MARK_COUNT - 1`) is the live "now" point (dot + number only); a checkpoint within 46px yields to it. No 0:00 mark. x-axis 0 → now. Boxes touch above ~45 min.
- **Live Win Rate** (`js/overlay-livewinrate.js`, key `livewinrate`): Gold Graph's shell plotting the Winrate API (Settings → Winrate API, `winrate_api_url.json`, `/api/winrate-url`) `{camp1:[%],camp2:[%],time:[s]}` every 10s game time (sum 100), via `/api/winrate-proxy` (routes/devapi.js, 1s cache). One line = camp1 % around a 50% midline (blue above/red below). Standard checkOverlays wiring + `bottomoverlays/hide`, `KNOWN_EVENTS` (worker v31), `dashboardSSE` key list, Edit config `mploverlay_v7_livewinrate`. Not restored on page load. Needs restart.

### Playoffs kill events (mploverlay_v7, `overlay-killevents.js`)
`assets/ingame/playoffs/motion/*.webm` are the "updated" set (old in `motion/old/`); they have NO baked sponsor. Sponsors via the normal element (`KILL_EVENT_SPONSOR_LOGO`: doublekill + turtleslain = Smart, triplekill = Visa white). `mploverlay_v7::playoffs` box `#kill-event-sponsor-logo-clip` 1202,778 182x102; `killEventApplySponsorFit` fits Visa inline. Logo pops in with the player popup, not the video's timing.

### Playoffs Lord / Turtle spawn videos
`objSpawnPlayNext` picks `assets/ingame/playoffs/lordspawn.webm`/`turtlespawn.webm` under playoffs (10th: `assets/ingame/anniversary/`, Regular `assets/ingame/`), read at each spawn.

### Draft Index V2 (`DraftIndexV2.html`)
Same `draftindex` SSE event / `/overlay/draftindex-state` as `DraftIndex.html`; dashboard "Draft Index v2" has the same routes; Edit styles from the `DraftIndex` bucket. Strips = role-icon + name cells (seat_1..5), heroes `posthero/<heroid>_POST_HERO.png` (natural 326x188, rest blurred copy), reveal 2s after show, hold 4s, windows close. `DV2_SHOW_CHROME` false (webm band/container art transparent). **Cards are compositor-only (vMix stutter fix):** art painted ONCE to `<canvas>` (`dv2PaintCard`); open/close = skewed `overflow:hidden` box via `scaleX` with counter-transformed inner (`dv2WindowFrames`); flash = overlay opacity. Don't reintroduce animated `clip-path`/`filter`, live `blur()` or `mask-image`.

## Control-tab Preview — fully isolated from real broadcast state

- **`previewButton: true`** (mplfs scenes, mpltag): page already loaded in `#preview-iframe`; "◈ Preview" calls `iw.contentWindow.previewTrigger(event,'show'|'hide')` — local only.
- **`deferredPreview: true`** (only Draft Overlay): heavy page; iframe stays `about:blank` with a placeholder until "◈ Preview" loads it with `?preview=1`; toggling off unloads. Its real Show/Hide toggle is fully decoupled.

**A `?preview=1` page must decouple itself from real broadcast:**
1. Don't react to real SSE show/hide or restore-on-load: Draft.html uses `PREVIEW_ONLY = /[?&]preview=1(?:&|$)/.test(location.search)`; mplfs uses `isPreviewFrame` (reuse, don't add a second flag). Visibility driven only by `window.previewTrigger(event, action)`.
2. No side effect may reach the real server: e.g. mplfs `syncBoard()` must skip its `fetch()` when `isPreviewFrame` (shipped bug: previewing Post scenes flipped real `/overlay/matchboard/show`). To let the dashboard see a result use `window.parent.postMessage({...}, location.origin)` (receiver: `previewToggleRegistry`).

**`previewTrigger`'s dispatch is a hand-maintained `if (event === '...')` chain** — a missing branch silently does nothing. External event name (from the route) often ≠ internal `activeFeature` name (`post_stats` vs `stats`, `final_team` vs `finalteam`, `team_lineup_blue` vs `lineupblue`). The authoritative mapping is the page's real SSE listener — check it, don't infer.

**Only one Preview active at a time** (one iframe). `buildPreviewToggleBtn(eventName)` is the shared factory (don't hand-roll); `activePreviewOff` holds the active button's `turnOff()` and activating another calls it first. **`previewToggleRegistry`** = passive setters per eventName for implied activations (e.g. Post Hearts lighting Matchboard's button); must NOT go through `activePreviewOff`. `activePreviewOff`, `previewToggleRegistry`, `draftPreviewActive`, `mplfsLiveBadge`, `mapSelectTagBadge` and any ref into `#control-panel-body` are reset at the top of `buildControlBody()` — reset any NEW cross-render state there too.

## API Mode — LIVE / WEB / DEBUG url sets (`lib/apiMode.js`)

Settings' 9 per-API URL fields (Game, Standings, Draft, Draft Recap, HRM, Team Hexagon, MVP Highlights, Draft Index, Post-Info) each store `live`/`web`/`debug`, switched by one global mode (`api_mode.json`, `getApiMode()/setApiMode()`). Apply writes to the active mode; flipping modes needs an explicit confirm (changes all 9 endpoints server-wide). **All reads/writes of the 9 JSON files (`game_api_url.json`, ...) MUST go through `lib/apiMode.js` `readUrlForMode(file, default)`/`writeUrlForMode(file, url)`** — never `fs.readFileSync` + `.url` (shape is `{live,web,debug}`); `lib/pollers.js` and `lib/hrmPoller.js` also read them. A 4th mode: update `API_MODES` in `lib/apiMode.js` AND `dashboard.html` + its 3 `.api-mode-seg-btn[data-mode]` buttons (unenforced copies).

## Theme system — Regular / 10th Anniversary / Playoffs

Settings **Broadcast Theme** is a `<select>` (`#theme-select`; a segmented control overflowed on "10TH ANNIVERSARY"), with `window.confirm()` first (cancel reverts to `currentTheme`). Value `regular|10th_anniversary|playoffs` in `theme.json`, via `GET/POST /api/theme` (routes/devapi.js; POST validates against `THEME_VALID` and broadcasts SSE `theme` over `state.overlayClients`). `'theme'` is in `KNOWN_EVENTS`. Every SSE-connected page has `sse.addEventListener('theme', e => applyTheme(JSON.parse(e.data).theme))`.

**`js/theme-apply.js`** is included on EVERY broadcast-source page right after `cache-bust.js` (before `overlay-sse-shim.js`), even pages with no SSE (those update on reload). It reads `/api/theme` on load and sets `data-theme` on `<html>`; exposes `applyTheme()`/`THEME_VALUES`. **The initial read is a deliberately SYNCHRONOUS XHR, not `fetch()`** — other scripts build scene content at top level (e.g. `buildWsSponsor();`) and read `data-theme` immediately; async made `wsTvcAsset()` silently fall back to Regular every load. Code reading the theme at load needs nothing special. If "right theme, wrong asset" resurfaces, suspect a new async gap before the theme is known.

**4th theme / rename:** update `THEME_VALID` (routes/devapi.js), `THEME_VALUES` (theme-apply.js), and in dashboard.html `THEME_VALUES`, `THEME_LABELS`, a new `<option>`.

**Themes are cosmetic by default — a reskin, not a feature** (asset, color, font, image; never behavior, timing, layout, which elements exist) unless the user explicitly states a behavioral difference. Structural/feature/bugfix work applies to every theme uniformly. If tempted to branch behavior on `data-theme` for a non-skin, confirm first. (Playoffs has a deliberate exception, below.)

**Opt-in CSS per theme**, scoped to theme + selector: `[data-theme="10th_anniversary"] #foo-title { ... }`. Works when Regular has no competing rule. **When Regular already sets the same property, use a CSS custom property** instead of a competing rule (specificity, `!important` Edit overrides make it silently fail):
```css
[data-theme="10th_anniversary"] { --anniv-accent: #6c4614; }
.foo-label { color: var(--anniv-accent, #0a0a0a); }
```
Define once near the top (see `--anniv-accent`); a differently-named variable only for a genuinely different value. **Never write "everything except regular" (`:not([data-theme="regular"])`)** — always scope to the specific theme(s). Elements with no themed rule keep Regular styling under every theme.

**JS-driven cosmetic props** use a lookup table keyed by theme with a Regular fallback:
```js
const SCENE_VIDEO_SRC_BY_THEME = { '10th_anniversary': { waiting: '/assets/annivloopsun.webm', lobby: '/assets/annivloopsun.webm' } };
function getSceneVideoSrc(f) { const t = document.documentElement.getAttribute('data-theme') || 'regular'; return (SCENE_VIDEO_SRC_BY_THEME[t] && SCENE_VIDEO_SRC_BY_THEME[t][f]) || SCENE_VIDEO_SRC[f]; }
```
List only differing pairs. Decided once when the scene's background starts — a mid-scene theme switch applies on the next show.

### Playoffs universal sponsor box (mplfs.html)
Every playoffs sponsor box shares ONE layout: gold header strip with the live category (OFFICIAL SPONSOR…) over a white logo area; CSS block "PLAYOFFS UNIVERSAL SPONSOR BOX" next to `.sponsor-cat-label`, written against shared classes (`.sponsor-cat-label`, `.wl-sponsor-loop`/`.ws-sponsor-loop`, `.wl-sponsor-bg`/`.wsm-sponsor-bg`), never a per-scene id. Used by Waiting TVC, Waiting Lobby, Today's, Bracket (`#br-sponsor` on `#bracket-page`, outside the tilting container), ENTVC Waiting TVC (own mirrored copy); Tomorrow's, Post H2H, Consolidated Post 2, Middle Board inherit it. **For any new/reworked playoffs scene with a sponsor box, use it — don't restyle.** Standard markup (`.sponsor-cat-label` + `.wl-sponsor-loop`, as `buildTsSponsor`); per-scene work is position/size only: add the selector to the "Default box size" rule (296x120 box, 37px strip, 296x83 logo area) and seed position in `mplfs::playoffs` of `overlay_styles.json` (Regular's saved override would win as `!important`). Post H2H / Middle Board / Consolidated Post 2 sizes are `!important` (CP2 311 wide, 311x120 under the Kill Map, excluded from the shared logo Edit row, `:not(#cp2-sponsor-img)`).
**Edit:** each Edit config with a sponsor box gets group "Playoffs Sponsor" row **Sponsor Logo (all playoffs boxes)** via `addPlayoffsSponsorEdit()` in dashboard.html — edits the shared loop classes so one change affects every playoffs box (ENTVC too). Selector is `html[data-theme=playoffs]`-scoped (unquoted value on purpose). Only the first matching img is click-draggable; use sidebar/inputs/arrows. A new scene's Edit config must be added to the pairs list in the `forEach` above `var EDIT_CONFIGS`. `sponsors.html`'s left box still side-by-side; its playoffs-only 3rd box (`.po-sponsor`, `?sponsorspage=1`) is header-strip with own CSS copy.

### Playoffs theme — working notes (read before touching any playoffs scene)

**Playoffs may be a full per-scene re-layout** (the user supplies a reference image + `assets/<scene>/playoffs/` folder). Scope to `[data-theme="playoffs"]`; Regular and 10th Anniversary stay exactly as they were. User-spelled behavior ("always 2 matches", "1 match when match 1 is GRAND FINALS") is intentional.

**Conventions**
- Assets in a `playoffs/` sub-folder with the **same filenames**; swap via `content: url(...)` on a static `<img>`, a `background-image` rule, or a theme-picked directory in JS (`gdcAssetDir`, `icAssetDir`, `mbAsset()`). Check the new file's pixel size first.
- **Gold** `#edc555` → `#d0a43e` vertical gradient. Black text on gold/white, white on blue/red; drop dark glow when text turns black.
- **Seed positions in `"<file>::playoffs"` buckets** (`mplfs::playoffs`, `Draft::playoffs`...) — Regular's `!important` saved overrides win over plain playoffs CSS.
- JS-built panels (v7 checks, mpltag Map Selection, Draft ban slots) read `data-theme` once at build time — switch applies on next reload.

**Open / not provided (don't invent art):** star-match scoreboard art (`ingamepng2_<SUFFIX>.png` in `assets/ingame/playoffs/`), Side Selection card (`blueselect/redselect.png`) in mpltag, `mapdetail_v2.png` for Draft's map panel, Draft player plate backs/hero name banners/picking webms, playoffs Post H2H sponsor rework, ban-selection red glow and `bluepickbg1/redpickbg1.webm` in Draft, real team photos for `photos/Playoffs Sched/` (APBR, TWIS missing → placeholder).

**Server restart pending (ask first):** `routes/overlay.js` (schedule highlight cycle, `VALID_FEATURES` for `skypiercer`/`lordadv`/`heatmappage`/`led_*`), `lib/state.js` (`featureToggles`, state keys), `routes/devapi.js` (`superfan_text` default + POST whitelist, `/api/heatmap-style`, `/api/winrate-proxy`), `routes/proxy.js`, `routes/led.js`.

**Scenes already reworked for playoffs (mplfs unless noted):** MVP Scene, MVP Highlights, Team Hexagon, Today's/Tomorrow's (forced 2 rows, stage label + open-house fields on Match Board, `photos/Playoffs Sched/<TRI>_sched.png`, animated `GOLD BG W HOLDER` webm playing only while shown), Waiting TVC (+ENTVC; corner HUD baked into the looping webm; SUPERFAN ticker from Dynamic tab "Superfan Ticker") and Waiting Lobby (mplfs only; player bottom feather), Team Line-Up (feather PNG, `photos/groupbg_playoffs/` wordmarks), Bracket, Final Team, Consolidated Post 2 (pages 1-3, gold tracks), Post Match Board VICTORY plaques; v7 scoreboard/match-info (stage label)/map box (`assets/ingame/playoffs/mapbacker.png`)/gold-diff/item/emblem/side-stat checks/player UI/event-pickup backgrounds; `Draft.html` (background, triangles, ban icon fade, gold timer + pick glow, gradient-map Draft Stats, `#121212` role icons, map container); `DraftIndex.html`; `sponsors.html`, `sponsortv.html`, `ingame_blue/red.html`, `mpltag.html` Map Selection.

**Things that bit us**
- **Bulk CSS removal by script can leave orphan declarations** (the next rule gets dropped; the SUPERFAN ticker lost `position:absolute`). After bulk removal, render the scene and diff neighbours — the syntax check only parses JS.
- **Apostrophes in asset paths** (`/assets/Today's Schedule/...`) break inline `onerror="...'...'"` → use `%27`.
- **Re-assigning `<img src>` to a missing file every poll flickers.** Remember applied/missing URLs (`sbSetImgWithFallback` in `overlay-scoreboard.js`); any "try star art, fall back to plain" code must too.
- **`cache-bust.js` appends `?v=` to every image src** — never compare `img.src`; use a flag/dataset (`mvSetImgWithFallback`, `hero-web.js`).
- **`transform` on a clipped parent doesn't change layout** — for scaled groups (`#stv-matches`, mpltag Map Selection at 6-7 games) set layout at native size and scale around a fixed origin. mpltag Map Selection scales down for games 6-7 (`applyMapselScale`, origin 29px/1028px, 0.84 at 6, 0.72 at 7).
- **Draft Stats gradient map** = `backdrop-filter: url(#po-gradmap)` (SVG feColorMatrix + feComponentTransfer); if vMix fails, fall back to `grayscale() sepia()`.
- Waiting Lobby stays mplfs-only; Waiting TVC mirrors to ENTVC (hand-port).

**Hero art:** `hero_web/HERO_<id>_KOTAK.webp` (512px) replaces 1000px `hero/` PNGs in mplfs and mploverlay_v7 via `js/hero-web.js` (`heroWebUrl(id)` + capture-phase `error` fallback to PNG). **`Draft.html` deliberately keeps `hero/thumb/` (200px PNG)** — regenerate `hero/thumb` when a new hero is added. mploverlay_v5/v6, fights, mpltag, arrangement-dashboard still use PNGs.

### The Edit tab is theme-scoped
`overlay_styles.json` (`routes/overlayStyles.js`, `GET/POST /api/overlay-styles`, `POST /api/overlay-nudge`) is `{ [file]: { [selector]: {left,top,width,height,fontSize} } }`; overrides are injected as `!important` `<style>` rules. Reads/writes use themed bucket keys via `lib/theme.js` `getTheme()`: Regular uses plain `file`, other themes `` `${file}::${theme}` `` (e.g. `mplfs::10th_anniversary`). GET merges per selector: a selector customized under the active theme wins outright (whole box); untouched ones fall back to Regular. Nudges seed a new themed entry from Regular's current value first. No client change needed (merge is server-side). Dragging under one theme never affects another. **When "my theme CSS isn't taking", check `overlay_styles.json` for a stale override on that selector first.**

### Never size/fit by measuring a possibly-hidden element — use Canvas `measureText()`
`scrollWidth`/`clientWidth`/`getBoundingClientRect()` are meaningless under a `display:none` ancestor. Example bug: Waiting TVC Hosts/Casters name row (`populateWsTalentBox` → `buildAnnivNameBox`, 10th only) ran from `updateWsFromState()` before the scene was shown, so the shrink-to-fit check silently passed and the full-size row overflowed once shown. Fix: a detached canvas context:
```js
let _annivMeasureCtx = null;
function annivTextWidth(text, font) { if (!_annivMeasureCtx) _annivMeasureCtx = document.createElement('canvas').getContext('2d'); _annivMeasureCtx.font = font; return _annivMeasureCtx.measureText(text).width; }
```
Compute natural width from measured text + known star/gap widths, apply `Math.min(1, boxWidth/naturalWidth)` as one `transform: scale()` on a wrapper. General rule: don't compute from a live layout that might not exist yet (same class as the theme-apply race and the Edit-tab live-sync gap).

### "Copy/use the exact same X" = copy EVERY themed treatment tied to X
Before finishing, grep for every themed rule scoped to X's id/class family (asset src, background removal, recolor, reposition), not just the obvious background image. Example: copying Waiting TVC's sponsor box art missed its per-ID anniversary rule removing the label's white plate and recolouring text (`#ws-sponsor-cat`/`#wl-sponsor-cat`, `background-color: transparent` + `color: var(--anniv-accent, ...)`), costing a round trip.

## Video-heavy overlays — permanent decoding is a sustained cost

Full-res 60fps VP9 loops that `autoplay`+`loop` and never pause cost GPU/CPU the whole broadcast.
1. **`#bg-video`** (`bgloop.webm`) lost `autoplay`; it now sits paused on its first frame.
2. **`#scene-video-0/1`** (crossfading per-scene backgrounds via `SCENE_VIDEO_SRC`) are `.pause()`d ~400ms after removing `sv-visible` on hide (matches the CSS fade-out), `.play()`ed on re-show. The guard checks the captured element's own class, not the shared `sceneVideoVisible` flag.

**`showSceneVideo(feature)` lives in `transitionToImpl()` AFTER `hideActiveFeature()` is awaited** — at the top it swung `sceneVideoLayer`/`currentSceneVideoSrc` before the outgoing scene's delayed `hideSceneVideo()` ran, hiding the new layer. Still starts before the data fetch.

**A missing `SCENE_VIDEO_SRC` entry is a silent no-op** (`timeline` was missing for ages because `#bg-video` masked it). Guard by map membership `if (SCENE_VIDEO_SRC[newFeature]) showSceneVideo(newFeature);`, never a hardcoded exception list. `richguy` is legitimately absent (own full-bleed art).

**Bake masks into real alpha offline** instead of per-frame JS: Draft.html's hero-pick reveal used a per-pixel `getImageData` loop (~0.43ms/frame); now pre-baked:
```
ffmpeg -i in.webm -vf "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255-((77*r(X,Y)+150*g(X,Y)+29*b(X,Y))/256)'" -c:v libvpx-vp9 -pix_fmt yuva420p -lossless 1 out.webm
```
then `drawImage(hero)` → `globalCompositeOperation='destination-in'` → `drawImage(alphaMatte)` (~86x cheaper, pixel-exact). Verify with `-c:v libvpx-vp9` on the DECODE side too (default decoder ignores alpha and reports fully opaque). Doesn't generalize to non-multiply combos (Draft's player-photo erase uses `Math.min(ownAlpha, matteAlpha)` and stays on JS).

## Data & assets

- `hlFetchMvp()`/`hlExtractPlayer()` hit `game-mvp/view` (repointable via Settings → `/api/highlights-url`); match/game number from `/match/state`.
- `campid`: `1` = blue/left/team1, `2` = red/right/team2 everywhere (memory `reference_mlbb_api.md`).
- Assets by id: `/heromvp/MVP_<heroid>.png`, `/herohighlights/<heroid>heromvp.png`, `/items/<id>.png`, `/role/<role>.png`, `/logos/<TRICODE>.png`, `/emblem/square_<id>_RUNES.png`; signature photo `hlPhotoUrl(name)`.
- Any `fetch()` of runtime-changing JSON needs `{ cache: 'no-store' }` (memory `feedback_fetch_cache.md`) — hard refresh doesn't bypass fetch cache.
- A NEW player needs a `hires_l3` WebP (L3 Lobby) and a `photos/Dynamic/3_CROPPED BNW/<TRI>_<ign>.webp` crop (Team Hexagon, Post 4 Key, Post H2H) or it silently falls back.

## Fonts & text fitting

**Anton** (black `#0a0a0a`) — big display numbers/titles (KDA/GPM/KP%, "OF THE GAME", scene titles). **General Sans** — labels/names (700 names, 600 small uppercase labels). Never-overflow text uses a shrink-to-fit helper (`maxSize` ≈ box height for display numbers, `minSize` ≈ half of max):
```js
function fooFitValue(el, maxSize, minSize) { let s = maxSize; el.style.fontSize = s+'px'; while (el.scrollWidth > el.clientWidth && s > minSize) el.style.fontSize = (--s)+'px'; }
```
(Only when the element is visible — see the `measureText()` section.)

## Master checklist — adding a new feature (every miss below is silent and has shipped)

### A. New `mplfs.html` scene (full-screen, shares `activeFeature`)
1. Copy the closest existing scene (MVP Scene = most complete).
2. CSS `#foo-page` + one absolutely-positioned rule per element (#1 rule). 3. HTML container + children.
4. JS: fetch → apply (set src/text, call fit helpers) → `showFooScene`/`hideFooScene` per Scene architecture.
5. **Background loop:** add `foo: '/assets/bgloopXXX.webm'` to `SCENE_VIDEO_SRC` if the scene wants the ambient background (match siblings — all Post scenes use `bgloopwaves2.webm`); if it has its own full-bleed art, add nothing.
6. **Post-family boards:** Post-style scenes go in `POST_FEATURES` in `transitionToImpl`; decide middle/player board handling (most show both; `post4key`/`consolidated_post` special-case). Normal full-screen scenes use the `else` branch (hides all three boards).
7. Edit tab: `FOO_DEFAULTS`, `FOO_ELEMENTS`, `EDIT_CONFIGS`.
8. Optional local debug card.
9. Live-control wiring, all six layers (above) with the same key.
10. **Preview:** add a branch to `previewTrigger` for the SAME event name as step 9's listener (most commonly forgotten: Credit Reel, Post Stats, Consolidated Post/2 shipped without it). Preview button, copy-route buttons and Showing/Hidden toggle all come from the step-9 `features` entry — don't hand-write them.
10b. **Event log verdict:** add to `olScenes` at the bottom of mplfs's main script (event key + internal `active` name), else no 🟢/🟡/🔴 line in the Logs tab or load status on the Control button.
11. New named SSE event → `KNOWN_EVENTS` + bump `OVERLAY_WORKER_VERSION`.
12. Sanity: grep every id/class in `FOO_ELEMENTS`/`FOO_DEFAULTS` against the real markup and the feature-key across steps 9-10.
13. Syntax-check every touched file:
```
node -e "const fs=require('fs');for(const f of ['html/mplfs.html','html/dashboard.html']){const s=fs.readFileSync(f,'utf8');[...s.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].forEach((m,i)=>{try{new Function(m[1])}catch(e){console.log(f,i,e.message)}})}"
```
14. Verify live in a real browser (not just curl): click the real Control toggle and confirm a *separate* tab reacts; click "◈ Preview" and confirm it shows ONLY in the iframe and `curl /overlay/mplfs-scene` did NOT change; if boards are touched, confirm `/overlay/mplfs-scene` still reflects reality after switching scenes (`syncBoard()` class of bug); click each copy-route button and check the copied URL.

### B. New `mpltag.html` tag (no `activeFeature` slot)
1. HTML/CSS (#1 rule). 2. Server: `state.checkOverlays` boolean + `/overlay/<key>/show|hide` broadcasting a named event. 3. Client listener toggling a class/animation. 4. Dashboard `checkToggles` `{name,key}`. 5. If repeated "Show" does something other than on/off (like `mapselecttag` revealing one more item), use plain `show`/`hide` on the `OVERLAYS` entry plus a `mapSelectTagStatus`-style pill. 6. **Preview:** mpltag has its own `previewTrigger` (only `mapselecttag` today) — add a branch, set `previewButton: true` if wanted. Player H2H previews are per-role (`preview: {event, action, group}` on `extraActions` → `buildPreviewToggleBtn(event, {showAction, group})`) with its own `PH2H_PREVIEW_ONLY` flag. **The rest of mpltag has no preview isolation flag** — anything beyond local DOM/CSS (fetch, shared state) will leak into real state when previewed unless you add a guard. 7. Syntax-check + live-verify as A.13-14.

### C. New `Draft.html`-style whole-scene toggle
1. Server: bespoke boolean (`state.draftActive`-style) or a `checkOverlays` entry. 2. `/overlay/<key>/show|hide` (+ `/overlay/<key>-state` restore route if bespoke). 3. Dashboard plain `show`/`hide` on the `OVERLAYS` entry (`toggleShowHide: true` for the single pill; see Draft Overlay for `draftShowState`/`applyDraftShowBtn` and its dedicated `dashboardSSE` listener — a bespoke boolean isn't in the generic `checkOverlays` loop). 4. Heavy page (would double GPU if live in vMix + in the preview iframe) → `deferredPreview: true`, plus `window.previewTrigger` AND `PREVIEW_ONLY` guard (else it does nothing or mirrors real state). 5. Syntax-check + live-verify, incl. the iframe genuinely returning to `about:blank`.

### D. New `mploverlay_v7.html` feature
Decide the shape (see v7 section): persistent panel → checkOverlays pattern; reactive effect → the 7-step list. Then A.13-14.

## Event log — Logs tab + Control-tab load status

`lib/eventLog.js` (2000-entry ring + daily `logs/events-YYYY-MM-DD.jsonl`, gitignored), `routes/eventLog.js` (`POST /api/event-log`, `GET /api/event-log?since=<id>`, `/days`, `/download?day=`). Line format: `🟢 [14:32:05 - 2026-10-09] - <source> · <text>` (green/yellow/red = success/warning/crucial).
- **Server:** pollers (`lib/pollers.js`, `lib/hrmPoller.js`) call `eventLog.health(key,label,'ok'|'slow'|'down',info)` — logs only on state CHANGES (2 consecutive failures / 3 slow ticks). Route logs every `/overlay/<key>/show|hide` and `/overlay/events` connect/disconnect.
- **Pages:** `js/event-log-client.js` (after `theme-apply.js` on mplfs/ENTVC/mpltag/Draft/DraftIndex/mploverlay_v7/dashboard) auto-reports failed/slow (>2s) fetches, broken media, JS errors; `OverlayLog.warn/.critical`; `OverlayLog.wrapScenes({...})` (mplfs `olScenes`) logs ONE verdict per show (boards `child: true` are folded in; not done in 15s → 🔴 with in-flight requests). `?preview=1` pages report as `preview`.
- **Must stay zero-cost:** never await or branch on logging; wrappers pass through return values/errors; batches flush ≤ every 2s on idle; unreachable server drops entries.

## Verifying with a real browser (no Playwright dependency)

Headless Edge over raw CDP:
```
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless=new --remote-debugging-port=9222 --user-data-dir=/path/to/scratch/profile --autoplay-policy=no-user-gesture-required about:blank &
```
From Node: `fetch('http://localhost:9222/json')` → `webSocketDebuggerUrl` → native `WebSocket` → `Page.navigate`/`Runtime.evaluate`. `--headless=new --virtual-time-budget=N --dump-dom` suits short synchronous checks; for video/`setTimeout`-paced work use a long-lived process with real sleeps (virtual time doesn't advance video decode). Kill only the test instance by debug port, never by app name.

- **Preview renders real data:** `mplfs.html?preview=1` + `window.previewTrigger(event,'show')` (e.g. `final_team`, `consolidated_post_2`, `today_schedule`); `Draft.html?preview=1` + `previewTrigger('draft','show')`. `DraftIndex*.html` has no preview mode (restores from `/overlay/draftindex-state`).
- **mpltag.html:** regex `<script>` extraction false-fails on a comment containing `<script`; to drive internals slice the IIFE by `indexOf` and append `window.__t = {...}` before `restore(); connectSSE();`.
- Stub fetches with `Page.addScriptToEvaluateOnNewDocument` replacing `window.fetch` for specific URLs. Jump to a scene's end state by adding the CSS class the animation would add (`dstats-in`, `ft-reveal`). Crop screenshots with `Page.captureScreenshot` `clip`, upscale with PIL.
- **Frame-time:** rAF gap logger; headless showed no >40ms frames even when the user saw hitches — "no big main-thread stalls", not proof of smoothness in vMix. Measure under `Emulation.setCPUThrottlingRate` ~20x with Tracing + rAF logger.
- **Never leave real shared state changed after a test** (`state.mplfsScene`/`checkOverlays`/`draftActive`/`api_mode.json`/the 9 `*_api_url.json`): capture before, restore after (`curl .../fs/hide` fully resets mplfs scene state). Prefer an isolated harness: extract the real `<script>` content into a scratch page, append `window.__test = {...}`, drive it. Use `node --check file.js` (not `require`) for `lib/`/`routes/` files that start pollers at require-time.
- Gotcha: never `await` a `Runtime.evaluate` that sets `location.href` (hangs) — wrap in `setTimeout(...,10);1`.

## vMix performance lessons (headless Edge can't reproduce vMix)

- **Cheap:** compositor-only animation (transform/opacity), `will-change` own layers, canvas pre-paint, WebP with PNG fallback, `img.decode()` before a fade, staggered swaps, pausing hidden videos.
- **Expensive:** full-screen 1080p60 VP9 loops (dominant idle cost), big PNG decode at swap time, animated SVG `d`/mask/clip-path/filter, repainting the big tilting container.
- **Always A/B** — a plausible optimisation can be worse (bracket pre-warm). Revert what doesn't measure better. No ffmpeg on this machine.

## Tunnel / remote viewers (branch M8)

Public tunnel (Cloudflare) viewers are detected by `isRemoteRequest()` in `server.js`; they get gzip, WebP swaps from `.webcache` (`Tools/build-remote-webp.js`), revalidate-only caching, and server proxies instead of LAN APIs (`/api/gamedata-proxy`, `/api/draft-proxy`, `/api/draft-recap-proxy`). The "is remote" check is copy-pasted in `server.js`, `Draft.html`, `overlay-core.js`, `cache-bust.js`.
- **Player photos are WebP only (M8).** The `hires/<POSE>/*.png` and `photos/<POSE>/*_resized.png` originals were moved out of the repo (backup: `~/overlay_server_png_backup_2026-10-30`; also in `main`'s git history). Use `hires/<POSE>_web/<ign>_<POSE>.webp`, `photos/<POSE>/<ign>_<POSE>_resized.webp`, `hires_l3/<SIDE>/<ign>_<SIDE>.webp`; the server photo-list routes (`/api/player-photos`, `/api/signature-photos`, `/api/photo-manifest`, `/api/hires-front-names`) read `.webp`. A NEW player needs these WebPs (PIL can make them: `Image.save(..., 'WEBP', quality=92, method=6)`; ffmpeg here has no libwebp). `Rich Guy` (`photos/<name>_FRONT.png`) was already broken.
- **Hires gate (`lib/remoteAssets.js`, now only a safety net for old PNG URLs):** remote `/hires/<POSE>/<f>.png` is answered with `/hires/<POSE>_web/<f>.webp` (same URL, `image/webp`) or 404 — never the ~1MB PNG. A NEW player photo needs its `_web` copy or remote viewers get 404. Videos/photos/`hires*` get `max-age=86400` remotely (`remoteCacheControl`).
- **Prewarm:** `html/prewarm.html` (+ `?auto=1&sets=...&theme=...`) downloads sets from `GET /api/prewarm-manifest` (`routes/prewarm.js`, `lib/prewarm.js`): draft hero pick videos, scene backgrounds (parsed from mplfs/ENTVC `SCENE_VIDEO_SRC*` tables, theme-aware), `players-all` (every player photo in the URL form each page requests: `hires/<POSE>_web` WebPs, `hires_l3`, `photos/<POSE>` PNGs, BNW crops, PNG-form FRONT/SIGNATURE) + the lighter `photos` subset (draft FRONT/VICTORY, kill-event signatures), kill-event videos; optional large `lineup`, `matchcard`. Manifest URLs are the exact page URLs (cache-key match). Changed files (mtime) are re-fetched with `cache:'reload'`. The cache belongs to the browser that ran it — OBS/vMix browser sources need prewarm loaded in the same app (unverified). Needs a server restart (new route + middleware).
- ffmpeg exists (Homebrew) with libvpx-vp9 but **no libwebp**, so `build-remote-webp.js` can't run on this machine.

## Handoff state

**Nothing is committed** (git dirty before this work; `hires_l3/` untracked). Don't commit unless asked. **Server restart pending** — see lists above; ask the user first. Open/offered but not requested: L3 Lobby bg video re-cut (needs ffmpeg), optionally `hires/*_web` instead of `hires_l3`, WebP copies of Team Line-Up group/bg PNGs, Final Team plain logo for Regular/10th.
